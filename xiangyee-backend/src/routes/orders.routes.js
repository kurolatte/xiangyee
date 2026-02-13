// routes/orders.routes.js
const express = require("express");
const { pool } = require("../db");
const { z } = require("zod");
const { requireAuth } = require("../middleware/auth");

// ADD: jwt for verifying SSE token (admin stream)
const jwt = require("jsonwebtoken");

const router = express.Router();

/* =========================
   HELPERS
========================= */

// Reusable: get order + items
async function fetchOrderWithItems(id) {
  const orderRes = await pool.query(`SELECT * FROM orders WHERE id = $1`, [id]);
  const order = orderRes.rows?.[0];
  if (!order) return null;

  const itemsRes = await pool.query(
    `
    SELECT
      oi.*,
      mi.name_en,
      mi.name_cn
    FROM order_items oi
    JOIN menu_items mi ON mi.id = oi.menu_item_id
    WHERE oi.order_id = $1
    ORDER BY oi.id ASC
    `,
    [id]
  );

  return { ...order, items: itemsRes.rows };
}

/* =========================
  SSE: CUSTOMER (PER ORDER)
  GET /api/orders/:id/stream
========================= */

const orderSseClients = new Map(); // orderId -> Set(res)

function sseSendMessage(res, data) {
  // default "message" event (what your index.html listens for)
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendToOrder(orderId, payload) {
  const set = orderSseClients.get(orderId);
  if (!set) return;
  for (const res of set) {
    try {
      sseSendMessage(res, payload);
    } catch {}
  }
}

// CUSTOMER: SSE STREAM
router.get("/:id(\\d+)/stream", async (req, res) => {
  const id = parseInt(req.params.id, 10);

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx: disable buffering
  res.flushHeaders?.();

  // register client
  if (!orderSseClients.has(id)) orderSseClients.set(id, new Set());
  orderSseClients.get(id).add(res);

  // send initial snapshot immediately
  try {
    const snapshot = await fetchOrderWithItems(id);
    if (snapshot) sseSendMessage(res, snapshot);
  } catch {}

  req.on("close", () => {
    const set = orderSseClients.get(id);
    if (set) {
      set.delete(res);
      if (set.size === 0) orderSseClients.delete(id);
    }
  });
});

/* =========================
  SSE: REAL-TIME PUSH (ADMIN)
  GET /api/orders/stream?token=JWT
========================= */

const sseClients = new Set();

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const client of sseClients) {
    try {
      sseSend(client, event, data);
    } catch {
      // ignore broken clients
    }
  }
}

// keep-alive ping (admin + customer)
setInterval(() => {
  // admin pings
  for (const client of sseClients) {
    try {
      client.write(`: ping\n\n`);
    } catch {}
  }

  // customer pings
  for (const set of orderSseClients.values()) {
    for (const res of set) {
      try {
        res.write(`: ping\n\n`);
      } catch {}
    }
  }
}, 25000);

/* =========================
   ADMIN: SSE STREAM
   GET /api/orders/stream?token=JWT
========================= */
router.get("/stream", (req, res) => {
  try {
    const token = String(req.query.token || "");
    if (!token) return res.status(401).json({ message: "No token" });

    // verify token
    jwt.verify(token, process.env.JWT_SECRET);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    sseSend(res, "connected", { ok: true, at: Date.now() });

    sseClients.add(res);

    req.on("close", () => {
      sseClients.delete(res);
    });
  } catch (e) {
    return res.status(401).json({ message: "Invalid token" });
  }
});

/* =========================
   ORDER VALIDATION
========================= */

const OrderSchema = z.object({
  customer_name: z.string().min(1),
  customer_phone: z.string().min(3),
  order_type: z.enum(["dine_in", "takeaway"]).default("takeaway"),
  table_no: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        menu_item_id: z.number().int(),
        quantity: z.number().int().min(1),
      })
    )
    .min(1),
});

const CollectedVerifySchema = z.object({
  order_no: z.string().min(3),
  customer_phone: z.string().min(3),
});

/* =========================
   PUBLIC: CREATE ORDER
   POST /api/orders
========================= */
router.post("/", async (req, res) => {
  const parsed = OrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { customer_name, customer_phone, order_type, table_no, notes, items } =
    parsed.data;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const seqUpsert = await client.query(
      `
      INSERT INTO daily_order_seq (seq_date, last_seq)
      VALUES (CURRENT_DATE, 1)
      ON CONFLICT (seq_date)
      DO UPDATE SET last_seq = daily_order_seq.last_seq + 1
      RETURNING last_seq;
      `
    );

    const seq = seqUpsert.rows?.[0]?.last_seq;
    if (!seq) throw new Error("Failed to generate daily sequence");

    const ymdRes = await client.query(`SELECT to_char(NOW(), 'YYYYMMDD') AS ymd`);
    const ymd = ymdRes.rows?.[0]?.ymd;
    const orderNo = `${ymd}-${String(seq).padStart(3, "0")}`;

    const orderInsert = await client.query(
      `
      INSERT INTO orders
        (order_no, customer_name, customer_phone, order_type, table_no, notes, total_amount)
      VALUES
        ($1, $2, $3, $4, $5, $6, 0)
      RETURNING id;
      `,
      [
        orderNo,
        customer_name,
        customer_phone,
        order_type,
        table_no || null,
        notes || null,
      ]
    );

    const orderId = orderInsert.rows?.[0]?.id;
    if (!orderId) throw new Error("Failed to create order");

    let total = 0;

    for (const it of items) {
      const menuRes = await client.query(
        `
        SELECT price
        FROM menu_items
        WHERE id = $1
          AND is_available = TRUE
        `,
        [it.menu_item_id]
      );

      const menuItem = menuRes.rows?.[0];
      if (!menuItem) throw new Error("Menu item not found");

      const unitPrice = Number(menuItem.price);
      const lineTotal = unitPrice * it.quantity;
      total += lineTotal;

      await client.query(
        `
        INSERT INTO order_items
          (order_id, menu_item_id, quantity, unit_price, line_total)
        VALUES
          ($1, $2, $3, $4, $5)
        `,
        [orderId, it.menu_item_id, it.quantity, unitPrice, lineTotal]
      );
    }

    await client.query(
      `
      UPDATE orders
      SET total_amount = $1, updated_at = NOW()
      WHERE id = $2
      `,
      [total, orderId]
    );

    await client.query("COMMIT");

    // ✅ ADMIN PUSH: order created
    broadcast("orders_updated", {
      action: "created",
      order_id: orderId,
      order_no: orderNo,
      at: Date.now(),
    });

    // ✅ CUSTOMER PUSH (optional): if customer already connected, send snapshot
    const snapshot = await fetchOrderWithItems(orderId);
    if (snapshot) sendToOrder(orderId, snapshot);

    return res.status(201).json({
      order_id: orderId,
      order_no: orderNo,
      total_amount: total,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

/* =========================
   PUBLIC: TRACK ORDER
   GET /api/orders/track/:orderNo
========================= */
router.get("/track/:orderNo", async (req, res) => {
  try {
    const { orderNo } = req.params;

    const r = await pool.query(
      `
      SELECT order_no, status, created_at, updated_at
      FROM orders
      WHERE order_no = $1
      `,
      [orderNo]
    );

    const order = r.rows?.[0];
    if (!order) return res.status(404).json({ error: "Order not found" });

    return res.json(order);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* =========================
   MARK COLLECTED (customer clicks "I collected")
   POST /api/orders/:id/collected
========================= */
router.post("/:id(\\d+)/collected", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const parsed = CollectedVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { order_no, customer_phone } = parsed.data;

    const orderRes = await pool.query(
      `
      SELECT id, order_no, customer_phone, status
      FROM orders
      WHERE id = $1
      `,
      [id]
    );

    const order = orderRes.rows?.[0];
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (
      String(order.order_no || "") !== String(order_no || "") ||
      String(order.customer_phone || "") !== String(customer_phone || "")
    ) {
      return res.status(403).json({ error: "Verification failed" });
    }

    const cur = String(order.status || "").toLowerCase();
    if (cur !== "ready") {
      return res.status(400).json({
        error: `Cannot mark collected unless status is 'ready'. Current: '${order.status}'`,
      });
    }

    const upd = await pool.query(
      `
      UPDATE orders
      SET status = 'collected', updated_at = NOW()
      WHERE id = $1
      `,
      [id]
    );

    if (upd.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    // ✅ ADMIN PUSH
    broadcast("orders_updated", {
      action: "collected",
      order_id: id,
      at: Date.now(),
    });

    // ✅ CUSTOMER PUSH: send updated snapshot immediately
    const updated = await fetchOrderWithItems(id);
    if (updated) sendToOrder(id, updated);

    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* =========================
   PUBLIC: GET ORDER BY ID (TESTING)
   GET /api/orders/:id
========================= */
router.get("/:id(\\d+)", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const order = await fetchOrderWithItems(id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    return res.json(order);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* =========================
   ADMIN: LIST ORDERS (WITH ITEMS)
   GET /api/orders/admin
========================= */
router.get("/admin", requireAuth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        o.*,
        COALESCE(
          json_agg(
            json_build_object(
              'menu_item_id', oi.menu_item_id,
              'quantity', oi.quantity,
              'unit_price', oi.unit_price,
              'line_total', oi.line_total,
              'name_en', mi.name_en,
              'name_cn', mi.name_cn
            )
            ORDER BY oi.id ASC
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'::json
        ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
      GROUP BY o.id
      ORDER BY o.id DESC
    `);

    return res.json(r.rows);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* =========================
   ADMIN: UPDATE STATUS
   PUT /api/orders/:id
========================= */
router.put("/:id(\\d+)", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;

    const allowed = ["pending", "ready", "collected"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const r = await pool.query(
      `
      UPDATE orders
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      `,
      [status, id]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    // ✅ ADMIN PUSH
    broadcast("orders_updated", {
      action: "status_updated",
      order_id: id,
      status,
      at: Date.now(),
    });

    // ✅ CUSTOMER PUSH: send updated snapshot immediately
    const updated = await fetchOrderWithItems(id);
    if (updated) sendToOrder(id, updated);

    return res.json({ message: "Order status updated" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
