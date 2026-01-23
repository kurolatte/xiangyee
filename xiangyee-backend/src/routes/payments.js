const express = require("express");
const router = express.Router();

// ✅ no uuid dependency
function makeRef() {
  return (
    "MOCK_" +
    Date.now().toString(36).toUpperCase() +
    "_" +
    Math.floor(Math.random() * 1000000).toString().padStart(6, "0")
  );
}

// Detect card brand (simple)
function detectBrand(cardNumber) {
  const n = cardNumber.replace(/\s+/g, "");
  if (/^4\d{12}(\d{3})?$/.test(n)) return "VISA";
  if (/^(5[1-5]\d{14})$/.test(n)) return "MASTERCARD";
  if (/^3[47]\d{13}$/.test(n)) return "AMEX";
  return "UNKNOWN";
}

// Luhn check
function luhnValid(num) {
  const s = num.replace(/\s+/g, "");
  if (!/^\d{12,19}$/.test(s)) return false;
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = parseInt(s[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

router.post("/charge", async (req, res) => {
  try {
    const { order_id, amount_cents, card_number } = req.body || {};

    if (!order_id || !amount_cents || !card_number) {
      return res
        .status(400)
        .json({ error: "Missing order_id / amount_cents / card_number" });
    }

    // 🔒 Currency locked to SGD
    const CURRENCY = "SGD";

    const card = String(card_number);
    const normalized = card.replace(/\s+/g, "");
    const last4 = normalized.slice(-4);
    const brand = detectBrand(card);

    const ok = Number(amount_cents) > 0; // ✅ ANY card number accepted

    return res.json({
      payment: {
        order_id,
        amount_cents: Number(amount_cents),
        currency: CURRENCY,
        card_brand: brand,
        card_last4: last4,
        status: ok ? "success" : "failed",
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
