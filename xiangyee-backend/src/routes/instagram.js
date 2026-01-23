// src/routes/instagram.js  (Instagram Basic Display API)
const express = require("express");
const router = express.Router();

// Simple in-memory cache
let cache = { ts: 0, payload: null };
const TTL_MS = Number(process.env.IG_CACHE_TTL_MS || 5 * 60 * 1000); // default 5 min

router.get("/media", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 8), 12);

    // Basic Display token (LONG-LIVED recommended)
    const ACCESS_TOKEN = (process.env.IG_BASIC_ACCESS_TOKEN || "").trim();
    if (!ACCESS_TOKEN) {
      return res.status(500).send("Missing IG_BASIC_ACCESS_TOKEN in env.");
    }

    // Serve from cache
    if (cache.payload && Date.now() - cache.ts < TTL_MS) {
      return res.json(cache.payload);
    }

    // Basic Display fields
    const fields = [
      "id",
      "caption",
      "media_type",
      "media_url",
      "permalink",
      "timestamp",
      // "thumbnail_url", // Basic Display: may not always be available; omit to be safe
    ].join(",");

    // Basic Display endpoint
    const url =
      `https://graph.instagram.com/me/media` +
      `?fields=${encodeURIComponent(fields)}` +
      `&limit=${encodeURIComponent(limit)}` +
      `&access_token=${encodeURIComponent(ACCESS_TOKEN)}`;

    const r = await fetch(url);
    const text = await r.text();

    if (!r.ok) {
      // Pass through IG errors so you can see them in frontend/backend logs
      return res.status(r.status).send(text);
    }

    const json = JSON.parse(text);

    cache = { ts: Date.now(), payload: json };
    return res.json(json);
  } catch (err) {
    console.error("IG Basic route error:", err);
    return res.status(500).send("Instagram route error");
  }
});

module.exports = router;
