const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

// ✅ FIXED PATHS (because app.js is in /src)
const menuRoutes = require("./routes/menu.routes");
const orderRoutes = require("./routes/orders.routes");
const reservationRoutes = require("./routes/reservations.routes");
const adminMenu = require("./routes/menu.admin.routes");
const authRoutes = require("./routes/auth.routes");
const instagramRoutes = require("./routes/instagram.routes");

const app = express();

app.use(cors());
app.use(express.json());

// ✅ Serve frontend from /public (ONE LEVEL UP)
app.use(express.static(path.join(__dirname, "../public")));

// ✅ API routes
app.use("/api/menu", menuRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/reservations", reservationRoutes);
app.use("/api/admin/menu", );
app.use("/api/auth", authRoutes);
app.use("/api/instagram", instagramRoutes);

// ✅ Optional health check (safe)
app.get("/health", (req, res) => {
  res.send("Backend running");
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
