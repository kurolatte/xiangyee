const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { poolPromise } = require("../db");

const router = express.Router();

// Seed admin once (run by visiting /api/auth/seed-admin in browser, then delete route)
router.get("/seed-admin", async (req, res) => {
  const pool = await poolPromise;
  const password_hash = await bcrypt.hash("admin123", 10);
  await pool.request()
    .input("u", "xiangyee_admin")
    .input("p", password_hash)
    .input("r", "admin")
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.staff_users WHERE username=@u)
      INSERT INTO dbo.staff_users(username,password_hash,role)
      VALUES(@u,@p,@r)
    `);

  res.json({ message: "Seeded admin: xiangyee_admin / admin123" });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ message: "username & password required" });

  const pool = await poolPromise;
  const r = await pool.request()
    .input("u", username)
    .query("SELECT TOP 1 * FROM dbo.staff_users WHERE username=@u");

  const user = r.recordset[0];
  if (!user) return res.status(401).json({ message: "Invalid login" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ message: "Invalid login" });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({ token, role: user.role });
});

module.exports = router;
