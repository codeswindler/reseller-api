require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "1mb" }));
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

const MPESA_ENV = process.env.MPESA_ENV || "sandbox";
const MPESA_BASE_URL =
  MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

const {
  MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET,
  MPESA_SHORTCODE,
  MPESA_PASSKEY,
  MPESA_CALLBACK_URL,
  JORITECH_BASE_URL,
  JORITECH_API_KEY,
  JORITECH_PARTNER_ID,
  PORT = 3000,
} = process.env;

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

function normalizePhoneNumber(value) {
  if (!value) return value;
  const digits = value.replace(/[^\d]/g, "");
  if (digits.startsWith("0")) {
    return `254${digits.slice(1)}`;
  }
  if (digits.startsWith("254")) {
    return digits;
  }
  return digits;
}

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

function buildPassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

async function creditResellerAccount(childID, amount) {
  if (!JORITECH_BASE_URL || !JORITECH_API_KEY || !JORITECH_PARTNER_ID) {
    throw new Error(
      "Missing JORITECH_BASE_URL, JORITECH_API_KEY, or JORITECH_PARTNER_ID"
    );
  }

  const payload = {
    apikey: JORITECH_API_KEY,
    partnerID: JORITECH_PARTNER_ID,
    childID,
    amount: String(amount),
  };

  const response = await axios.post(
    `${JORITECH_BASE_URL.replace(/\/$/, "")}/api/services/credit`,
    payload,
    {
      headers: { "Content-Type": "application/json" },
    }
  );

  return response.data;
}

const pendingCredits = new Map();

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/mpesa/stkpush", async (req, res) => {
  try {
    const {
      phoneNumber,
      amount,
      accountReference,
      childID,
      transactionDesc,
      transactionType = "CustomerPayBillOnline",
      partyB,
    } = req.body || {};

    if (!phoneNumber || !amount || !accountReference) {
      return res.status(400).json({
        error: "phoneNumber, amount, and accountReference are required",
      });
    }

    if (!MPESA_SHORTCODE || !MPESA_PASSKEY || !MPESA_CALLBACK_URL) {
      return res.status(500).json({
        error: "Missing MPESA_SHORTCODE, MPESA_PASSKEY, or MPESA_CALLBACK_URL",
      });
    }

    const timestamp = getTimestamp();
    const password = buildPassword(MPESA_SHORTCODE, MPESA_PASSKEY, timestamp);
    const accessToken = await getAccessToken();

    const payload = {
      BusinessShortCode: MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: transactionType,
      Amount: Number(amount),
      PartyA: normalizePhoneNumber(phoneNumber),
      PartyB: partyB || MPESA_SHORTCODE,
      PhoneNumber: normalizePhoneNumber(phoneNumber),
      CallBackURL: MPESA_CALLBACK_URL,
      AccountReference: String(accountReference),
      TransactionDesc: transactionDesc || "Client Paybill",
    };

    console.log("STK push request received:", {
      phoneNumber: normalizePhoneNumber(phoneNumber),
      amount: Number(amount),
      accountReference: String(accountReference),
      childID: childID || null,
    });

    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (childID && response.data?.CheckoutRequestID) {
      pendingCredits.set(response.data.CheckoutRequestID, {
        childID,
        amount: Number(amount),
      });
    }

    console.log("STK push response:", response.data);
    return res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    const responseData = error.response?.data;
    const errorDetails = {
      message: error.message,
      status,
      statusText: error.response?.statusText || null,
      data: responseData ?? null,
      headers: error.response?.headers || null,
      mpesaEnv: MPESA_ENV,
      mpesaBaseUrl: MPESA_BASE_URL,
    };
    console.error("STK push failed:", JSON.stringify(errorDetails));
    const data = responseData || { error: error.message };
    return res.status(status).json(data);
  }
});

app.post("/mpesa/callback", async (req, res) => {
  const payload = req.body;
  console.log("MPesa callback received:", JSON.stringify(payload));

  try {
    const callback = payload?.Body?.stkCallback;
    const isSuccess = callback?.ResultCode === 0;

    if (isSuccess && callback?.CheckoutRequestID) {
      const pending = pendingCredits.get(callback.CheckoutRequestID);
      if (pending) {
        const creditResponse = await creditResellerAccount(
          pending.childID,
          pending.amount
        );
        console.log("Reseller credited:", creditResponse);
        pendingCredits.delete(callback.CheckoutRequestID);
      }
    }
  } catch (error) {
    console.error("Failed to credit reseller:", error.message);
  }

  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

app.post("/reseller/credit", async (req, res) => {
  try {
    const { childID, amount } = req.body || {};
    if (!childID || !amount) {
      return res.status(400).json({ error: "childID and amount are required" });
    }

    const response = await creditResellerAccount(childID, amount);
    return res.json(response);
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data || { error: error.message };
    return res.status(status).json(data);
  }
});

app.listen(PORT, () => {
  console.log(`MPesa service running on port ${PORT}`);
});
