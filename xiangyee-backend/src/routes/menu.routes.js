const express = require("express");
const { poolPromise, sql } = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { category } = req.query;

    let query = `
      SELECT
        id,
        name_en,
        name_cn,
        price,
        category,
        image_url
      FROM dbo.menu_items
      WHERE is_available = 1
      ORDER BY category, name_en
    `;

    const request = pool.request();

    if (category) {
      query = `
        SELECT
          id,
          name_en,
          name_cn,
          price,
          category,
          image_url
        FROM dbo.menu_items
        WHERE category = @category
          AND is_available = 1
        ORDER BY name_en
      `;
      request.input("category", sql.NVarChar, category);
    }

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
