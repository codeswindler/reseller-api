require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------------------
// Request logger
// ---------------------------------------------------------------------------
const getLocalTimestamp = () => {
  return new Date().toLocaleString("en-GB", {
    timeZone: "Africa/Nairobi",
    hour12: false,
  });
};

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    console.log(
      `[${getLocalTimestamp()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`
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
  ADVANTA_SHORTCODE,
  MPESA_ENV = "production",
  MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET,
  MPESA_SHORTCODE,
  MPESA_CALLBACK_BASE_URL,
  RESELLER_NAME = "Olickhom",
  PORT = 3000,
} = process.env;

const MPESA_BASE_URL =
  MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

// ---------------------------------------------------------------------------
// MPesa OAuth
// ---------------------------------------------------------------------------

/**
 * Get an OAuth access token from the Safaricom Daraja API.
 */
async function getAccessToken() {
  if (!MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET) {
    throw new Error("Missing MPESA_CONSUMER_KEY or MPESA_CONSUMER_SECRET");
  }
  const url = `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`;
  const response = await axios.get(url, {
    auth: {
      username: MPESA_CONSUMER_KEY,
      password: MPESA_CONSUMER_SECRET,
    },
  });
  return response.data.access_token;
}

// ---------------------------------------------------------------------------
// Reseller Credit Service
// ---------------------------------------------------------------------------

/**
 * Credit a sub-account / client with SMS units via the Advanta Africa
 * Reseller Credit API.
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

  console.log(`[${getLocalTimestamp()}] Crediting client:`, {
    childID,
    amount,
    url,
  });

  const response = await axios.post(url, payload, {
    headers: { "Content-Type": "application/json" },
  });

  return response.data;
}

/**
 * Send an SMS to a customer via the Advanta Africa sendotp API.
 * This is used for successful payment alerts.
 *
 * @param {string} mobile  – Recipient's phone number
 * @param {string} message – The message content
 */
async function sendSMS(mobile, message) {
  if (!ADVANTA_BASE_URL || !ADVANTA_API_KEY || !ADVANTA_PARTNER_ID || !ADVANTA_SHORTCODE) {
    console.error(`[${getLocalTimestamp()}] Skipped sending SMS: Missing Advanta credentials or Shortcode in .env`);
    return;
  }

  const mobileStr = String(mobile || "").trim();

  // Detect if the mobile is a Safaricom hash (hex string >= 30 chars)
  const isHashed = /^[0-9a-fA-F]+$/.test(mobileStr) && mobileStr.length >= 30;

  // Format phone for normal numbers; leave hash untouched
  let formattedMobile = mobileStr;
  if (!isHashed) {
    formattedMobile = formattedMobile.replace(/\D/g, "");
    if (formattedMobile.startsWith("0")) {
      formattedMobile = "254" + formattedMobile.substring(1);
    } else if (!formattedMobile.startsWith("254")) {
      formattedMobile = "254" + formattedMobile;
    }
  }

  const payload = {
    apikey: ADVANTA_API_KEY,
    partnerID: ADVANTA_PARTNER_ID,
    shortcode: ADVANTA_SHORTCODE,
    mobile: formattedMobile,
    message: message,
    hashed: isHashed,
  };

  const url = `${ADVANTA_BASE_URL.replace(/\/$/, "")}/api/services/sendotp`;

  try {
    console.log(`[${getLocalTimestamp()}] Sending SMS alert:`, {
      to: formattedMobile,
      isHashed,
      shortcode: ADVANTA_SHORTCODE,
    });
    const response = await axios.post(url, payload, { timeout: 10000 });
    console.log(`[${getLocalTimestamp()}] SMS response:`, JSON.stringify(response.data));
  } catch (error) {
    const errorData = error.response?.data || { error: error.message };
    console.error(`[${getLocalTimestamp()}] SMS FAILED:`, JSON.stringify(errorData));
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Health check */
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// MPesa C2B — URL Registration
// ---------------------------------------------------------------------------

/**
 * POST /c2b/register
 *
 * Registers the Validation and Confirmation URLs with Safaricom.
 * Call this once to set up callbacks for your paybill.
 */
app.post("/c2b/register", async (req, res) => {
  try {
    if (!MPESA_SHORTCODE || !MPESA_CALLBACK_BASE_URL) {
      return res.status(500).json({
        error: "Missing MPESA_SHORTCODE or MPESA_CALLBACK_BASE_URL in .env",
      });
    }

    const accessToken = await getAccessToken();
    const finalCallbackUrl = MPESA_CALLBACK_BASE_URL.startsWith("http")
      ? MPESA_CALLBACK_BASE_URL.replace(/\/$/, "")
      : `https://${MPESA_CALLBACK_BASE_URL.replace(/\/$/, "")}`;

    const payload = {
      ShortCode: MPESA_SHORTCODE,
      ResponseType: "Completed",
      ConfirmationURL: `${finalCallbackUrl}/c2b/confirmation`,
      ValidationURL: `${finalCallbackUrl}/c2b/validation`,
    };

    console.log(`[${getLocalTimestamp()}] Registering C2B URLs:`, payload);

    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/c2b/v2/registerurl`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(
      `[${getLocalTimestamp()}] C2B URL registration response:`,
      response.data
    );
    return res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data || { error: error.message };
    console.error(
      `[${getLocalTimestamp()}] C2B URL registration failed:`,
      JSON.stringify(data)
    );
    return res.status(status).json(data);
  }
});

// ---------------------------------------------------------------------------
// MPesa C2B — Validation (accepts all payments)
// ---------------------------------------------------------------------------

/**
 * POST /c2b/validation
 *
 * Safaricom calls this before processing a C2B payment.
 * We accept all payments by returning ResultCode 0.
 */
app.post("/c2b/validation", (req, res) => {
  console.log(
    `[${getLocalTimestamp()}] C2B Validation request:`,
    JSON.stringify(req.body)
  );
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

// ---------------------------------------------------------------------------
// MPesa C2B — Confirmation (auto-credit on payment)
// ---------------------------------------------------------------------------

/**
 * POST /c2b/confirmation
 *
 * Safaricom calls this after a C2B payment is completed.
 *
 * Payload fields we use:
 *   - BillRefNumber: client's username (childID)
 *   - TransAmount:   amount paid in KES
 *   - TransID:       MPesa transaction ID (for logging)
 *   - MSISDN:        payer's phone number (for logging)
 */
app.post("/c2b/confirmation", async (req, res) => {
  const payload = req.body || {};

  console.log(
    `[${getLocalTimestamp()}] C2B Confirmation received:`,
    JSON.stringify(payload)
  );

  const {
    BillRefNumber,
    TransAmount,
    TransID,
    MSISDN,
    FirstName,
  } = payload;

  // Always acknowledge Safaricom immediately
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });

  // Auto-credit the client
  if (!BillRefNumber || !TransAmount) {
    console.error("C2B Confirmation missing BillRefNumber or TransAmount — skipping credit");
    return;
  }

  try {
    console.log(
      `[${getLocalTimestamp()}] Auto-crediting: childID=${BillRefNumber}, ` +
      `amount=${TransAmount} KES, TransID=${TransID}, MSISDN=${MSISDN}, Name=${FirstName}`
    );

    const creditResult = await creditClient(BillRefNumber, TransAmount);

    console.log(
      `[${getLocalTimestamp()}] Auto-credit SUCCESS: TransID=${TransID}, ` +
      `childID=${BillRefNumber}, amount=${TransAmount} KES, result=`,
      creditResult
    );

    // Send auto-response SMS
    const units = creditResult["sms-units"] || "0";
    const balance = creditResult["new-balance"] || "0";
    const smsMessage = `Payment of KES ${TransAmount} received. ${units} SMS units credited to account ${BillRefNumber}. New balance: ${balance} units. Thank you!`;
    
    await sendSMS(MSISDN, smsMessage);
  } catch (error) {
    const errorData = error.response?.data || { error: error.message };
    console.error(
      `[${getLocalTimestamp()}] Auto-credit FAILED: TransID=${TransID}, ` +
      `childID=${BillRefNumber}, amount=${TransAmount} KES, error=`,
      JSON.stringify(errorData)
    );
  }
});

// ---------------------------------------------------------------------------
// Direct Credit Endpoint
// ---------------------------------------------------------------------------

/**
 * POST /reseller/credit
 *
 * Directly credits a client's account with SMS units.
 *
 * Request body:
 *   { "childID": "client_username", "amount": 100 }
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
    console.log(`[${getLocalTimestamp()}] Credit response:`, result);
    return res.json(result);
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data || {
      "response-code": status,
      "response-description": error.message,
    };
    console.error(`[${getLocalTimestamp()}] Credit failed:`, JSON.stringify(data));
    return res.status(status).json(data);
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(
    `[${getLocalTimestamp()}] ${RESELLER_NAME} Credit API running on port ${PORT}`
  );
});
