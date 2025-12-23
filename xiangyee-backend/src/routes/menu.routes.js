const express = require("express");
const { pool } = require("../db");

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
          price,
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
        price,
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

module.exports = router;
