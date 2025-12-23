const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, username, role }
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin")
    return res.status(403).json({ message: "Admin only" });
  next();
}

module.exports = { requireAuth, requireAdmin };
