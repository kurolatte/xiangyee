const express = require("express");
const router = express.Router();

// If Node < 18, uncomment the next 2 lines
// const fetch = (...args) => import("node-fetch").then(({default: fetch}) => fetch(...args));

router.get("/", async (req, res) => {
  try {
    const igBusinessId = process.env.IG_BUSINESS_ID;
    const token = process.env.IG_ACCESS_TOKEN;

    if (!igBusinessId || !token) {
      return res.status(500).json({
        error: "Missing IG_BUSINESS_ID or IG_ACCESS_TOKEN in environment variables."
      });
    }

    // Pull latest media (customize limit if you want more/less)
    const url =
      `https://graph.facebook.com/v19.0/${igBusinessId}/media` +
      `?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp` +
      `&limit=9&access_token=${encodeURIComponent(token)}`;

    const r = await fetch(url);
    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({
        error: "Instagram Graph API error",
        details: data
      });
    }

    // Convert to a clean frontend-friendly format
    const cleaned = (data.data || []).map((p) => ({
      id: p.id,
      caption: p.caption || "",
      media_type: p.media_type,
      // Use thumbnail for video posts
      media_url: p.media_type === "VIDEO"
        ? (p.thumbnail_url || p.media_url)
        : p.media_url,
      permalink: p.permalink,
      timestamp: p.timestamp
    }));

    res.json(cleaned);
  } catch (err) {
    console.error("IG route error:", err);
    res.status(500).json({ error: "Failed to load Instagram feed." });
  }
});

module.exports = router;
