# QueueGo SMS (Termii)

QueueGo sends **real SMS** to drivers when:

| Event | SMS content |
|-------|-------------|
| Admin registers a driver | Welcome message + driver portal link + **PIN** |
| Ride assigned to driver | Passenger, pickup, destination + **Reply 1 = Accept / 0 = Reject** |
| Driver replies by SMS | Confirmation text (accepted / rejected) |

Passenger SMS is not implemented yet (no passenger phone field).

---

## 1. Termii account setup

1. Sign up at [https://termii.com](https://termii.com)
2. Copy your **API key** from the dashboard
3. Register a **Sender ID** (3–11 characters, e.g. `QueueGo`) — approval may take a short while
4. Fund your wallet (pay-as-you-go; a few hundred naira is enough for FYP testing)
5. Register a **phone number** for inbound SMS in the Termii console (required for two-way replies)

---

## 2. Local development

Create `backend/.env`:

```env
SMS_PROVIDER=termii
TERMII_API_KEY=your_actual_api_key
TERMII_SENDER_ID=QueueGo
TERMII_CHANNEL=dnd
PUBLIC_URL=http://localhost:3000
```

Restart the server:

```bash
cd backend
npm install
npm start
```

Send a test SMS:

```bash
npm run test-sms -- 08012345678
```

---

## 3. Production on Render (queuego.onrender.com)

In **Render → Environment**, set:

| Variable | Value |
|----------|--------|
| `SMS_PROVIDER` | `termii` |
| `TERMII_API_KEY` | your Termii API key |
| `TERMII_SENDER_ID` | `QueueGo` (or your approved sender) |
| `TERMII_CHANNEL` | `dnd` (transactional — recommended for ride alerts) |
| `PUBLIC_URL` | `https://queuego.onrender.com` |

Redeploy after saving. Check **Logs** on startup — you should see:

```
SMS provider: termii
Termii sender: QueueGo (channel: dnd)
Termii inbound webhook → https://queuego.onrender.com/webhooks/sms/inbound
```

---

## 4. Inbound webhook (driver replies 1 / 0)

Drivers can accept or reject rides by replying to the assignment SMS. Termii must forward inbound messages to your server.

1. Open [Termii account → Webhook](https://accounts.termii.com/#/account/webhook/config)
2. Set the webhook URL to:

```
https://queuego.onrender.com/webhooks/sms/inbound
```

3. Save

When a driver texts **1** or **0**, Termii POSTs JSON like:

```json
{
  "type": "inbound",
  "sender": "2348012345678",
  "message": "1"
}
```

QueueGo updates the ride the same way as the driver web app.

**Test without a phone** (any environment):

```bash
curl -X POST https://queuego.onrender.com/sms/simulate \
  -H "Content-Type: application/json" \
  -d '{"phone":"08012345678","message":"1"}'
```

Use the driver's registered phone number.

---

## 5. Admin dashboard

After staff login, the admin page shows whether SMS is in **demo** or **Termii** mode and displays the inbound webhook URL when live.

When you register a driver with a phone number:

- **Termii:** PIN + portal link sent to their phone automatically
- **Console:** message prints in server logs only (for free local demos)

---

## Demo mode (no API key)

```env
SMS_PROVIDER=console
```

Assignment SMS prints in the terminal. Type **1** or **0** + Enter in that same terminal to simulate a driver reply.

---

## Disable SMS

```env
SMS_PROVIDER=off
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Driver didn't get PIN SMS | Check `TERMII_API_KEY`, sender ID approval, wallet balance |
| Ride alert not received | Confirm driver phone is unique and valid (`080…` or `234…`) |
| Reply 1/0 does nothing | Set inbound webhook URL in Termii; confirm `PUBLIC_URL` on Render |
| `Invalid phone` | Use Nigerian format `08012345678` |
| DND numbers | Use `TERMII_CHANNEL=dnd` for transactional delivery |
| Termii error in admin | Read Render logs for the exact API message |

Official Termii inbound docs: [developers.termii.com/incoming](https://developers.termii.com/incoming)
