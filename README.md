# Rikisoft Reseller API

Express service for the **Advanta Africa Reseller Credit API** — transfer SMS
credits to your sub-accounts programmatically.

> You must be a reseller registered under Advanta Africa to use this API.

## Setup

1. Copy `config/env.example` to `.env` in the project root and fill in your
   credentials.
2. Install dependencies and start:

```bash
npm install
npm start
```

## Environment Variables

| Variable            | Description                                |
| ------------------- | ------------------------------------------ |
| `ADVANTA_BASE_URL`  | Base URL of the Advanta SMS platform       |
| `ADVANTA_API_KEY`   | Your reseller API key                      |
| `ADVANTA_PARTNER_ID`| Your reseller partner ID                   |
| `PORT`              | Server port (default `3000`)               |

## Endpoints

### `GET /health`

Returns `{ "ok": true }`.

### `POST /reseller/credit`

Credits a client (sub-account) with SMS units.

**Request body:**

```json
{
  "childID": "client_username",
  "amount": 100
}
```

- `childID` — the client's username
- `amount` — amount in Kenyan Shillings (converted to SMS units at the
  configured rate; defaults to 1 KES per SMS if no rate is set)

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

**Error response:**

```json
{
  "response-code": 1005,
  "response-description": "The child acount is invalid. Kindly verify the details"
}
```

## Important Notes

- The `apikey` and `partnerID` are read from your `.env` and sent automatically.
- The `amount` is in **Kenyan Shillings**; the system converts it to SMS units.
- Transactions are recorded in the Credit History section of the Advanta
  dashboard, just like manual credit loading.
