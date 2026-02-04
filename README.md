# MPesa Paybill Service

Small Express service to trigger M-Pesa Paybill STK Push payments and receive
callbacks.

## Setup

1. Copy `config/env.example` to `.env` and fill in your credentials.
2. Install dependencies.
3. Start the server.

```bash
npm install
npm start
```

## Endpoints

### `POST /mpesa/stkpush`

Body:

```json
{
  "phoneNumber": "2547XXXXXXXX",
  "amount": 100,
  "accountReference": "CLIENT_ID_OR_INVOICE",
  "childID": "client_username",
  "transactionDesc": "Client Paybill"
}
```

### `POST /mpesa/callback`

Receives Safaricom callback payloads. If `childID` was provided in the STK
push, the service will credit the client via the Joritech Reseller Credit API.

### `POST /reseller/credit`

Directly credits a client using the Joritech Reseller Credit API.

```json
{
  "childID": "client_username",
  "amount": 100
}
```
