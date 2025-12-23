const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");

const router = express.Router();


router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: "username & password required" });
    }

    const r = await pool.query(
      `SELECT * FROM staff_users WHERE username = $1 LIMIT 1`,
      [username]
    );

    const user = r.rows?.[0];
    if (!user) return res.status(401).json({ message: "Invalid login" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: "Invalid login" });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({ token, role: user.role });
  } catch (e) {
    console.error("login error:", e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
