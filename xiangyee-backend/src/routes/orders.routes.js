// routes/orders.routes.js
const express = require("express");
const { poolPromise, sql } = require("../db");
const { z } = require("zod");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

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

/* =========================
   OPTIONAL: VERIFY "COLLECTED" CALL
   (recommended for customer-facing endpoints)

   If you DON'T want this verification, you can remove
   CollectedVerifySchema + the checks in /:id/collected.
========================= */
const CollectedVerifySchema = z.object({
  // customer will have order_no shown in UI
  order_no: z.string().min(3),
  // basic phone check
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

  let transaction;

  try {
    const pool = await poolPromise;
    transaction = new sql.Transaction(pool);

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    // ====== DAILY ORDER NUMBER ======
    const seqReq = new sql.Request(transaction);

    await seqReq.query(`
      IF EXISTS (
        SELECT 1 FROM dbo.daily_order_seq WITH (UPDLOCK, HOLDLOCK)
        WHERE seq_date = CAST(GETDATE() AS DATE)
      )
      BEGIN
        UPDATE dbo.daily_order_seq
        SET last_seq = last_seq + 1
        WHERE seq_date = CAST(GETDATE() AS DATE);
      END
      ELSE
      BEGIN
        INSERT INTO dbo.daily_order_seq (seq_date, last_seq)
        VALUES (CAST(GETDATE() AS DATE), 1);
      END
    `);

    const seqRes = await seqReq.query(`
      SELECT last_seq FROM dbo.daily_order_seq
      WHERE seq_date = CAST(GETDATE() AS DATE)
    `);

    const seq = seqRes.recordset?.[0]?.last_seq;
    if (!seq) throw new Error("Failed to generate daily sequence");

    const dateRes = await seqReq.query(
      `SELECT FORMAT(GETDATE(), 'yyyyMMdd') AS ymd`
    );
    const ymd = dateRes.recordset?.[0]?.ymd;

    const orderNo = `${ymd}-${String(seq).padStart(3, "0")}`;

    // ====== INSERT ORDER ======
    const orderInsert = await new sql.Request(transaction)
      .input("order_no", sql.NVarChar, orderNo)
      .input("customer_name", sql.NVarChar, customer_name)
      .input("customer_phone", sql.NVarChar, customer_phone)
      .input("order_type", sql.NVarChar, order_type)
      .input("table_no", sql.NVarChar, table_no || null)
      .input("notes", sql.NVarChar, notes || null)
      .query(`
        INSERT INTO dbo.orders
          (order_no, customer_name, customer_phone, order_type, table_no, notes, total_amount)
        OUTPUT INSERTED.id
        VALUES
          (@order_no, @customer_name, @customer_phone, @order_type, @table_no, @notes, 0)
      `);

    const orderId = orderInsert.recordset[0].id;

    // ====== INSERT ITEMS ======
    let total = 0;

    for (const it of items) {
      const menuRes = await new sql.Request(transaction)
        .input("mid", sql.Int, it.menu_item_id)
        .query(
          "SELECT price FROM dbo.menu_items WHERE id=@mid AND is_available=1"
        );

      const menuItem = menuRes.recordset[0];
      if (!menuItem) throw new Error("Menu item not found");

      const unitPrice = Number(menuItem.price);
      const lineTotal = unitPrice * it.quantity;
      total += lineTotal;

      await new sql.Request(transaction)
        .input("order_id", sql.Int, orderId)
        .input("menu_item_id", sql.Int, it.menu_item_id)
        .input("quantity", sql.Int, it.quantity)
        .input("unit_price", sql.Decimal(10, 2), unitPrice)
        .input("line_total", sql.Decimal(10, 2), lineTotal)
        .query(`
          INSERT INTO dbo.order_items
            (order_id, menu_item_id, quantity, unit_price, line_total)
          VALUES
            (@order_id, @menu_item_id, @quantity, @unit_price, @line_total)
        `);
    }

    await new sql.Request(transaction)
      .input("total_amount", sql.Decimal(10, 2), total)
      .input("id", sql.Int, orderId)
      .query("UPDATE dbo.orders SET total_amount=@total_amount WHERE id=@id");

    await transaction.commit();

    // ✅ RETURN ORDER NUMBER FOR CUSTOMER
    res.status(201).json({
      order_id: orderId,
      order_no: orderNo,
      total_amount: total,
    });
  } catch (e) {
    try {
      if (transaction) await transaction.rollback();
    } catch {}
    res.status(400).json({ error: e.message });
  }
});

/* =========================
   PUBLIC: TRACK ORDER
   GET /api/orders/track/:orderNo
========================= */
router.get("/track/:orderNo", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { orderNo } = req.params;

    const r = await pool
      .request()
      .input("order_no", sql.NVarChar, orderNo)
      .query(`
        SELECT order_no, status, created_at, updated_at
        FROM dbo.orders
        WHERE order_no=@order_no
      `);

    const order = r.recordset[0];
    if (!order) return res.status(404).json({ error: "Order not found" });

    res.json(order);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// MARK COLLECTED (customer clicks "I collected")
router.post("/:id/collected", async (req, res) => {
  try {
    const pool = await poolPromise;
    const id = parseInt(req.params.id, 10);

    // --- verification (recommended) ---
    const parsed = CollectedVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { order_no, customer_phone } = parsed.data;

    // Load order
    const orderRes = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "SELECT id, order_no, customer_phone, status FROM dbo.orders WHERE id=@id"
      );

    const order = orderRes.recordset[0];
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Verify identity
    if (
      String(order.order_no || "") !== String(order_no || "") ||
      String(order.customer_phone || "") !== String(customer_phone || "")
    ) {
      return res.status(403).json({ error: "Verification failed" });
    }

    const cur = String(order.status || "").toLowerCase();

    // Only allow READY -> COLLECTED
    if (cur !== "ready") {
      return res.status(400).json({
        error: `Cannot mark collected unless status is 'ready'. Current: '${order.status}'`,
      });
    }

    const r = await pool
      .request()
      .input("id", sql.Int, id)
      .query(`
        UPDATE dbo.orders
        SET status='collected', updated_at=SYSDATETIME()
        WHERE id=@id
      `);

    if (r.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Return updated order (with items)
    const updatedOrderRes = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT * FROM dbo.orders WHERE id=@id");

    const itemsRes = await pool
      .request()
      .input("id", sql.Int, id)
      .query(`
        SELECT oi.*, mi.name_en, mi.name_cn
        FROM dbo.order_items oi
        JOIN dbo.menu_items mi ON mi.id = oi.menu_item_id
        WHERE oi.order_id=@id
      `);

    res.json({ ...updatedOrderRes.recordset[0], items: itemsRes.recordset });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================
   PUBLIC: GET ORDER BY ID (TESTING)
========================= */
router.get("/:id", async (req, res) => {
  try {
    const pool = await poolPromise;
    const id = parseInt(req.params.id, 10);

    const orderRes = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT * FROM dbo.orders WHERE id=@id");

    const order = orderRes.recordset[0];
    if (!order) return res.status(404).json({ error: "Order not found" });

    const itemsRes = await pool
      .request()
      .input("id", sql.Int, id)
      .query(`
        SELECT oi.*, mi.name_en, mi.name_cn
        FROM dbo.order_items oi
        JOIN dbo.menu_items mi ON mi.id = oi.menu_item_id
        WHERE oi.order_id=@id
      `);

    res.json({ ...order, items: itemsRes.recordset });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================
   ADMIN: LIST ORDERS
========================= */
router.get("/", requireAuth, async (req, res) => {
  try {
    const pool = await poolPromise;
    const r = await pool
      .request()
      .query("SELECT * FROM dbo.orders ORDER BY created_at DESC");

    res.json(r.recordset);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================
   ADMIN: UPDATE STATUS
   (pending / ready / collected)
========================= */
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const pool = await poolPromise;
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;

    // ✅ include collected
    const allowed = ["pending", "ready", "collected"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const r = await pool
      .request()
      .input("status", sql.NVarChar, status)
      .input("id", sql.Int, id)
      .query(`
        UPDATE dbo.orders
        SET status=@status, updated_at=SYSDATETIME()
        WHERE id=@id
      `);

    if (r.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({ message: "Order status updated" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
