const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { category } = req.query;

    if (category) {
      const result = await pool.query(
        `
        SELECT
          id,
          name_en,
          name_cn,
          price::float8 AS price,
          category,
          image_url
        FROM menu_items
        WHERE category = $1
          AND is_available = TRUE
        ORDER BY name_en
        `,
        [category]
      );
      return res.json(result.rows);
    }

    const result = await pool.query(
      `
      SELECT
        id,
        name_en,
        name_cn,
        price::float8 AS price,
        category,
        image_url
      FROM menu_items
      WHERE is_available = TRUE
      ORDER BY category, name_en
      `
    );

    return res.json(result.rows);
  } catch (e) {
    console.error("GET /menu error:", e);
    return res.status(500).json({ error: e.message });
  }
});

router.get("/admin", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name_en,
        name_cn,
        price::float8 AS price,
        category,
        is_available,
        image_url
      FROM menu_items
      ORDER BY category, name_en
    `);

    return res.json(result.rows);
  } catch (e) {
    console.error("GET /menu/admin error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// Add new menu item
router.post("/admin", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name_en, name_cn, price, category, image_url, is_available } = req.body;

    if (!name_en || !name_cn || price == null) {
      return res.status(400).json({ error: "name_en, name_cn, price required" });
    }

    const result = await pool.query(
      `
      INSERT INTO menu_items (name_en, name_cn, price, category, image_url, is_available)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING
        id, name_en, name_cn, price::float8 AS price, category, is_available, image_url
      `,
      [
        name_en,
        name_cn,
        price,
        category || "Main Dishes",
        image_url || null,
        is_available ?? true
      ]
    );

    return res.json(result.rows[0]);
  } catch (e) {
    console.error("POST /menu/admin error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// Update menu item
router.put("/admin/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name_en, name_cn, price, category, image_url, is_available } = req.body;

    const result = await pool.query(
      `
      UPDATE menu_items
      SET
        name_en = COALESCE($1, name_en),
        name_cn = COALESCE($2, name_cn),
        price = COALESCE($3, price),
        category = COALESCE($4, category),
        image_url = COALESCE($5, image_url),
        is_available = COALESCE($6, is_available),
        updated_at = NOW()
      WHERE id = $7
      RETURNING
        id, name_en, name_cn, price::float8 AS price, category, is_available, image_url
      `,
      [
        name_en ?? null,
        name_cn ?? null,
        price ?? null,
        category ?? null,
        image_url ?? null,
        (typeof is_available === "boolean") ? is_available : null,
        id
      ]
    );

    if (!result.rowCount) return res.status(404).json({ error: "Not found" });
    return res.json(result.rows[0]);
  } catch (e) {
    console.error("PUT /menu/admin/:id error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// Remove menu item (soft delete: hide from public menu)
router.delete("/admin/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const result = await pool.query(
      `
      UPDATE menu_items
      SET is_available = FALSE, updated_at = NOW()
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (!result.rowCount) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /menu/admin/:id error:", e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
