const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/admin/menu
 * See all menu items (including unavailable)
 */
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name_en, name_cn, price, category, is_available, image_url
      FROM menu_items
      ORDER BY category, name_en
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/admin/menu
 * Add new menu item
 */
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name_en, name_cn, price, category, image_url, is_available } = req.body;

    const result = await pool.query(
      `
      INSERT INTO menu_items (name_en, name_cn, price, category, image_url, is_available)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
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

    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PUT /api/admin/menu/:id
 * Edit menu item
 */
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
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
        is_available = COALESCE($6, is_available)
      WHERE id = $7
      RETURNING *
      `,
      [name_en, name_cn, price, category, image_url, is_available, id]
    );

    if (!result.rowCount) return res.status(404).json({ message: "Not found" });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * DELETE /api/admin/menu/:id
 * Remove from menu (soft delete)
 */
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);

    await pool.query(
      `UPDATE menu_items SET is_available = FALSE WHERE id = $1`,
      [id]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
