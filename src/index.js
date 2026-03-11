require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------------------
// Request logger
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`
    );
  });
  next();
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const {
  ADVANTA_BASE_URL,
  ADVANTA_API_KEY,
  ADVANTA_PARTNER_ID,
  PORT = 3000,
} = process.env;

// ---------------------------------------------------------------------------
// Reseller Credit Service
// ---------------------------------------------------------------------------

/**
 * Credit a sub-account / client with SMS units via the Advanta Africa
 * Reseller Credit API.
 *
 * POST {{ADVANTA_BASE_URL}}/api/services/credit
 *
 * @param {string} childID  – Client's username (sub-account)
 * @param {number|string} amount – Amount in Kenyan Shillings
 * @returns {Promise<object>} API response
 */
async function creditClient(childID, amount) {
  if (!ADVANTA_BASE_URL || !ADVANTA_API_KEY || !ADVANTA_PARTNER_ID) {
    throw new Error(
      "Missing ADVANTA_BASE_URL, ADVANTA_API_KEY, or ADVANTA_PARTNER_ID – check your .env file"
    );
  }

  const payload = {
    apikey: ADVANTA_API_KEY,
    partnerID: ADVANTA_PARTNER_ID,
    childID,
    amount: String(amount),
  };

  const url = `${ADVANTA_BASE_URL.replace(/\/$/, "")}/api/services/credit`;

  console.log("Crediting client:", { childID, amount, url });

  const response = await axios.post(url, payload, {
    headers: { "Content-Type": "application/json" },
  });

  return response.data;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Health check */
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * POST /reseller/credit
 *
 * Credits a client's account with SMS units.
 *
 * Request body:
 *   { "childID": "client_username", "amount": 100 }
 *
 * Success response (from Advanta):
 *   {
 *     "response-code": 200,
 *     "response-description": "Partner ID xxxx has been credited with 5 units",
 *     "prev-balance": "524.00",
 *     "sms-units": "5",
 *     "new-balance": "529.00"
 *   }
 *
 * Error response (from Advanta):
 *   {
 *     "response-code": 1005,
 *     "response-description": "The child acount is invalid. Kindly verify the details"
 *   }
 */
app.post("/reseller/credit", async (req, res) => {
  try {
    const { childID, amount } = req.body || {};

    if (!childID || amount === undefined || amount === null) {
      return res.status(400).json({
        "response-code": 400,
        "response-description":
          "childID and amount are required in the request body",
      });
    }

    if (isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({
        "response-code": 400,
        "response-description": "amount must be a positive number (KES)",
      });
    }

    const result = await creditClient(childID, amount);
    console.log("Credit response:", result);
    return res.json(result);
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data || {
      "response-code": status,
      "response-description": error.message,
    };
    console.error("Credit failed:", JSON.stringify(data));
    return res.status(status).json(data);
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Reseller Credit API running on port ${PORT}`);
});
