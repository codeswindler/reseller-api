# Reseller Credit API

Express service for automatic SMS top-ups via **MPesa Paybill → Advanta Africa
Reseller Credit API**.

Clients pay to the configured paybill, entering their username as the account
reference. Safaricom sends a C2B callback, and the service automatically credits
their SMS account.

## Flow

```
Client pays to Paybill ──► Safaricom C2B Callback ──► This API ──► Advanta Credit API
(username as ref)           (confirmation URL)         (auto-credit)
```

## Setup

1. Copy `config/env.example` to `.env` and fill in your credentials.
2. Install dependencies and start:

```bash
npm install
npm start
```

3. Register your C2B URLs with Safaricom (run once):

```bash
curl -X POST http://localhost:3000/c2b/register
```

## Environment Variables

| Variable                 | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `ADVANTA_BASE_URL`       | Base URL of the Advanta SMS platform               |
| `ADVANTA_API_KEY`        | Your reseller API key                              |
| `ADVANTA_PARTNER_ID`     | Your reseller partner ID                           |
| `MPESA_ENV`              | `production` or `sandbox`                          |
| `MPESA_CONSUMER_KEY`     | Daraja API consumer key                            |
| `MPESA_CONSUMER_SECRET`  | Daraja API consumer secret                         |
| `MPESA_SHORTCODE`        | Your paybill number                                |
| `MPESA_CALLBACK_BASE_URL`| Public URL where Safaricom sends callbacks         |
| `PORT`                   | Server port (default `3000`)                       |

## Endpoints

### `GET /health`

Returns `{ "ok": true }`.

### `POST /c2b/register`

Registers validation and confirmation URLs with Safaricom. Run once after
deployment.

### `POST /c2b/validation`

Called by Safaricom before processing a payment. Accepts all payments.

### `POST /c2b/confirmation`

Called by Safaricom after a payment is completed. Extracts:
- `BillRefNumber` → client's username (`childID`)
- `TransAmount` → amount in KES

Then auto-credits the client via the Advanta Reseller Credit API.

### `POST /reseller/credit`

Directly credits a client (for manual/programmatic use).

**Request body:**

```json
{
  "childID": "client_username",
  "amount": 100
}
```

**Success response:**

```json
{
  "response-code": 200,
  "response-description": "Partner ID xxxx has been credited with 5 units",
  "prev-balance": "524.00",
  "sms-units": "5",
  "new-balance": "529.00"
}
```

## Important Notes

- Clients must enter their **exact reseller platform username** as the paybill
  account reference.
- The `amount` is in **KES** and is converted to SMS units at the configured
  rate (default: 1 KES = 1 SMS).
- All transactions are logged and recorded in the Advanta Credit History.
