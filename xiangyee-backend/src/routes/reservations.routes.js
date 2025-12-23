const express = require("express");
const { pool } = require("../db");
const { z } = require("zod");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const MAX_RES_PER_SLOT = 5; // tables per time slot

const ReservationSchema = z.object({
  customer_name: z.string().min(1),
  customer_phone: z.string().min(3),
  reservation_date: z.string().min(8), // YYYY-MM-DD
  reservation_time: z.string().min(4), // HH:MM
  pax: z.number().int().min(1).max(6),
  notes: z.string().optional().nullable()
});

// --------------------
// POST /api/reservations
// --------------------
router.post("/", async (req, res) => {
  const parsed = ReservationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const r = parsed.data;

    // Past checks
    const bookingDateTime = new Date(`${r.reservation_date}T${r.reservation_time}`);
    const now = new Date();
    const todayStr = new Date().toISOString().slice(0, 10);

    if (r.reservation_date < todayStr) {
      return res.status(400).json({ error: "Cannot book a date in the past." });
    }

    const todayOnly = now.toISOString().slice(0, 10);
    if (r.reservation_date === todayOnly && bookingDateTime < now) {
      return res.status(400).json({ error: "Time already passed for today." });
    }

    // Operating hours
    const time = r.reservation_time; // "HH:MM"
    const inLunch = time >= "11:30" && time <= "14:30";
    const inDinner = time >= "17:30" && time <= "21:00";

    // Booking only allowed <= 19:00
    if (time > "19:00") {
      return res.status(400).json({ error: "Dinner reservations must be made before 7:00 PM." });
    }

    if (!inLunch && !inDinner) {
      return res.status(400).json({
        error: "Reservation must be within operating hours: 11:30–14:30 or 17:30–21:00."
      });
    }

    // Cap check
    const capResult = await pool.query(
      `
      SELECT COUNT(*)::int AS cnt
      FROM reservations
      WHERE reservation_date = $1::date
        AND reservation_time = $2::time
      `,
      [r.reservation_date, r.reservation_time]
    );

    const existingCount = Number(capResult.rows?.[0]?.cnt || 0);
    if (existingCount >= MAX_RES_PER_SLOT) {
      return res.status(400).json({
        error: "This time slot is fully booked. Please choose another time."
      });
    }

    // Insert + return id
    const insertResult = await pool.query(
      `
      INSERT INTO reservations
        (customer_name, customer_phone, reservation_date, reservation_time, pax, notes)
      VALUES
        ($1, $2, $3::date, $4::time, $5::int, $6)
      RETURNING id;
      `,
      [
        r.customer_name,
        r.customer_phone,
        r.reservation_date,
        r.reservation_time,
        r.pax,
        r.notes || null
      ]
    );

    return res.status(201).json({ reservation_id: insertResult.rows[0].id });
  } catch (e) {
    console.error("POST /reservations error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// --------------------
// GET /api/reservations/availability
// returns counts per time slot + maxPerSlot
// --------------------
router.get("/availability", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });

    const result = await pool.query(
      `
      SELECT
        to_char(reservation_time, 'HH24:MI') AS reservation_time,
        COUNT(*)::int AS booked
      FROM reservations
      WHERE reservation_date = $1::date
      GROUP BY reservation_time
      ORDER BY reservation_time ASC
      `,
      [date]
    );

    return res.json({
      maxPerSlot: MAX_RES_PER_SLOT,
      counts: result.rows
    });
  } catch (e) {
    console.error("GET /reservations/availability error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// --------------------
// PUBLIC: list reservations (optional by date)
// GET /api/reservations?date=YYYY-MM-DD
// --------------------
router.get("/", async (req, res) => {
  try {
    const { date } = req.query;

    if (date) {
      const result = await pool.query(
        `
        SELECT
          id,
          customer_name,
          customer_phone,
          to_char(reservation_date, 'YYYY-MM-DD') AS reservation_date,
          to_char(reservation_time, 'HH24:MI') AS reservation_time,
          pax,
          notes,
          status,
          created_at,
          updated_at
        FROM reservations
        WHERE reservation_date = $1::date
        ORDER BY reservation_time ASC, id ASC
        `,
        [date]
      );
      return res.json(result.rows);
    }

    const result = await pool.query(
      `
      SELECT
        id,
        customer_name,
        customer_phone,
        to_char(reservation_date, 'YYYY-MM-DD') AS reservation_date,
        to_char(reservation_time, 'HH24:MI') AS reservation_time,
        pax,
        notes,
        status,
        created_at,
        updated_at
      FROM reservations
      ORDER BY created_at DESC, id DESC
      `
    );

    return res.json(result.rows);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// --------------------
// ADMIN: list reservations
// GET /api/reservations/admin
// --------------------
router.get("/admin", requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `
      SELECT
        id,
        customer_name,
        customer_phone,
        to_char(reservation_date, 'YYYY-MM-DD') AS reservation_date,
        to_char(reservation_time, 'HH24:MI') AS reservation_time,
        pax,
        notes,
        status,
        created_at,
        updated_at
      FROM reservations
      ORDER BY created_at DESC, id DESC
      `
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --------------------
// PATCH /api/reservations/:id/status
// --------------------
router.patch("/:id/status", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;

    const allowed = ["pending", "confirmed", "seated", "completed", "cancelled"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });

    const r = await pool.query(
      `
      UPDATE reservations
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      `,
      [status, id]
    );

    if (r.rowCount === 0) return res.status(404).json({ error: "Reservation not found" });
    return res.json({ message: "Reservation status updated" });
  } catch (e) {
    console.error("PATCH /reservations/:id/status error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// --------------------
// PUT /api/reservations/:id (ADMIN)
// --------------------
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { status } = req.body || {};
    const allowed = ["pending", "confirmed", "seated", "completed", "cancelled"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });

    const id = parseInt(req.params.id, 10);

    const result = await pool.query(
      `
      UPDATE reservations
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      `,
      [status, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: "Reservation not found" });
    return res.json({ message: "updated" });
  } catch (e) {
    console.error("PUT /reservations/:id error:", e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
