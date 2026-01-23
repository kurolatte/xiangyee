const express = require("express");
const router = express.Router();

function makeRef() {
  return (
    "MOCK_" +
    Date.now().toString(36).toUpperCase() +
    "_" +
    Math.floor(Math.random() * 1000000).toString().padStart(6, "0")
  );
}

function detectBrand(cardNumber) {
  const n = cardNumber.replace(/\s+/g, "");
  if (/^4\d{12}(\d{3})?$/.test(n)) return "VISA";
  if (/^(5[1-5]\d{14})$/.test(n)) return "MASTERCARD";
  if (/^3[47]\d{13}$/.test(n)) return "AMEX";
  return "UNKNOWN";
}

router.post("/charge", async (req, res) => {
  try {
    const { order_id, amount_cents, card_number } = req.body || {};

    if (!order_id || amount_cents == null || !card_number) {
      return res.status(400).json({
        error: "Missing order_id / amount_cents / card_number",
      });
    }

    const amount = Number(amount_cents);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount_cents" });
    }

    const CURRENCY = "SGD";

    const card = String(card_number);
    const normalized = card.replace(/\s+/g, "");

    if (!/^\d{16}$/.test(normalized)) {
      return res.status(400).json({
        error: "Card number must be exactly 16 digits",
      });
    }

    const last4 = normalized.slice(-4);
    const brand = detectBrand(card);

    const FAIL_CARD = "4242424242424242";
    const ok = normalized !== FAIL_CARD;

    return res.json({
      payment: {
        order_id,
        amount_cents: amount,
        currency: CURRENCY,
        card_brand: brand,
        card_last4: last4,
        status: ok ? "success" : "failed",
        failure_reason: ok ? null : "Mock card declined",
        transaction_ref: makeRef(),
        created_at: new Date().toISOString(),
      },
      message: ok ? "Payment successful (mock)" : "Payment failed (mock)",
    });
  } catch (err) {
    console.error("Mock payment error:", err);
    return res.status(500).json({ error: "Mock payment error" });
  }
});

module.exports = router;
