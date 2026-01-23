// src/routes/instagram.js
const express = require("express");
const router = express.Router();

// In-memory cache (simple + effective)
let cache = { ts: 0, payload: null };
const TTL_MS = Number(process.env.IG_CACHE_TTL_MS || 5 * 60 * 1000); // 5 minutes

router.get("/media", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 8), 12);

    const IG_USER_ID = process.env.IG_USER_ID;
    const ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

    if (!IG_USER_ID || !ACCESS_TOKEN) {
      return res.status(500).send("Missing IG_USER_ID / IG_ACCESS_TOKEN in env.");
    }

    // Serve from cache
    if (cache.payload && Date.now() - cache.ts < TTL_MS) {
      return res.json(cache.payload);
    }

    // Instagram Graph API media list
    const fields = [
      "id",
      "caption",
      "media_type",
      "media_url",
      "thumbnail_url",
      "permalink",
      "timestamp",
    ].join(",");

    // Use graph.facebook.com for Instagram Graph API
    const url =
      `https://graph.facebook.com/v21.0/${encodeURIComponent(IG_USER_ID)}/media` +
      `?fields=${encodeURIComponent(fields)}` +
      `&limit=${encodeURIComponent(limit)}` +
      `&access_token=${encodeURIComponent(ACCESS_TOKEN)}`;

    const r = await fetch(url);
    const text = await r.text();

    if (!r.ok) {
      return res.status(r.status).send(text);
    }

    const json = JSON.parse(text);

    cache = { ts: Date.now(), payload: json };
    return res.json(json);
  } catch (err) {
    console.error("IG route error:", err);
    return res.status(500).send("Instagram route error");
  }
});

module.exports = router;
