const express = require("express");
const { poolPromise, sql } = require("../db");
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

// POST /api/reservations 
router.post("/", async (req, res) => {
  const parsed = ReservationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const pool = await poolPromise;
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
    const capResult = await pool.request()
      .input("d", sql.Date, r.reservation_date)
      .input("t", sql.Time, r.reservation_time)
      .query(`
        SELECT COUNT(*) AS cnt
        FROM dbo.reservations
        WHERE reservation_date = @d
          AND reservation_time = @t
      `);

    const existingCount = Number(capResult.recordset?.[0]?.cnt || 0);
    if (existingCount >= MAX_RES_PER_SLOT) {
      return res.status(400).json({
        error: "This time slot is fully booked. Please choose another time."
      });
    }

    const insertResult = await pool.request()
      .input("customer_name", sql.NVarChar, r.customer_name)
      .input("customer_phone", sql.NVarChar, r.customer_phone)
      .input("reservation_date", sql.Date, r.reservation_date)
      .input("reservation_time", sql.Time, r.reservation_time)
      .input("pax", sql.Int, r.pax)
      .input("notes", sql.NVarChar, r.notes || null)
      .query(`
        INSERT INTO dbo.reservations
          (customer_name, customer_phone, reservation_date, reservation_time, pax, notes)
        VALUES
          (@customer_name, @customer_phone, @reservation_date, @reservation_time, @pax, @notes);

        SELECT SCOPE_IDENTITY() AS id;
      `);

    return res.status(201).json({ reservation_id: insertResult.recordset[0].id });
  } catch (e) {
    console.error("POST /reservations error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/reservations/availability
// returns counts per time slot + maxPerSlot
router.get("/availability", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });

    const result = await pool.request()
      .input("d", sql.Date, date)
      .query(`
        SELECT
          CONVERT(varchar(5), reservation_time, 108) AS reservation_time, -- HH:MM
          COUNT(*) AS booked
        FROM dbo.reservations
        WHERE reservation_date = @d
        GROUP BY reservation_time
      `);

    return res.json({
      maxPerSlot: MAX_RES_PER_SLOT,
      counts: result.recordset
    });
  } catch (e) {
    console.error("GET /reservations/availability error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// PUBLIC: availability for a date (counts per time)
router.get("/availability", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });

    const result = await pool.request()
      .input("d", sql.Date, date)
      .query(`
        SELECT
          CONVERT(varchar(5), reservation_time, 108) AS reservation_time, -- HH:MM
          COUNT(*) AS booked
        FROM dbo.reservations
        WHERE reservation_date = @d
        GROUP BY reservation_time
      `);

    res.json({
      maxPerSlot: MAX_RES_PER_SLOT,
      counts: result.recordset
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// PUBLIC: list reservations (by date)
router.get("/", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { date } = req.query;

    const request = pool.request();

    let q = `
      SELECT
        id,
        customer_name,
        customer_phone,
        CONVERT(varchar(10), reservation_date, 23) AS reservation_date,   -- YYYY-MM-DD
        CONVERT(varchar(5),  reservation_time, 108) AS reservation_time,  -- HH:MM
        pax,
        notes,
        status,
        created_at,
        updated_at
      FROM dbo.reservations
      ORDER BY created_at DESC, id DESC
    `;

    if (date) {
      q = `
        SELECT
          id,
          customer_name,
          customer_phone,
          CONVERT(varchar(10), reservation_date, 23) AS reservation_date,
          CONVERT(varchar(5),  reservation_time, 108) AS reservation_time,
          pax,
          notes,
          status,
          created_at,
          updated_at
        FROM dbo.reservations
        WHERE reservation_date = @date
        ORDER BY reservation_time ASC, id ASC
      `;
      request.input("date", sql.Date, date);
    }

    const result = await request.query(q);
    res.json(result.recordset);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ADMIN: list reservations
router.get("/admin", requireAuth, async (req, res) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().query(`
      SELECT
        id,
        customer_name,
        customer_phone,
        CONVERT(varchar(10), reservation_date, 23) AS reservation_date,
        CONVERT(varchar(5),  reservation_time, 108) AS reservation_time,
        pax,
        notes,
        status,
        created_at,
        updated_at
      FROM dbo.reservations
      ORDER BY created_at DESC, id DESC
    `);
    res.json(r.recordset);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// PATCH /api/reservations/:id/status 
router.patch("/:id/status", async (req, res) => {
  try {
    const pool = await poolPromise;
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;

    const allowed = ["pending","confirmed","seated","completed","cancelled"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });

    const r = await pool.request()
      .input("status", sql.NVarChar, status)
      .input("id", sql.Int, id)
      .query("UPDATE dbo.reservations SET status=@status, updated_at=SYSDATETIME() WHERE id=@id");

    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: "Reservation not found" });
    return res.json({ message: "Reservation status updated" });
  } catch (e) {
    console.error("PATCH /reservations/:id/status error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// PUT /api/reservations/:id  (ADMIN)
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { status } = req.body || {};
    const allowed = ["pending","confirmed","seated","completed","cancelled"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });

    const pool = await poolPromise;
    const result = await pool.request()
      .input("id", sql.Int, parseInt(req.params.id, 10))
      .input("st", sql.NVarChar, status)
      .query(`
        UPDATE dbo.reservations
        SET status=@st, updated_at=SYSDATETIME()
        WHERE id=@id
      `);

    if (result.rowsAffected[0] === 0) return res.status(404).json({ error: "Reservation not found" });
    return res.json({ message: "updated" });
  } catch (e) {
    console.error("PUT /reservations/:id error:", e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
