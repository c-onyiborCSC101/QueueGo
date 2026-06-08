# SMS notifications on driver assign

When a passenger request is **assigned** to a driver (auto-dispatch or admin reassign), the system sends an SMS to the **driver's phone** stored in the database.

## Demo mode (no API key)

Default `SMS_PROVIDER=console` prints the SMS in your terminal:

```bash
cd backend
npm start
```

Submit a ride with an available driver — watch the server console for:

```
--- SMS (demo mode) ---
To: 2348012345678
PAU Smart Keke: New ride assigned.
...
```

Use this for viva demos without spending on SMS credits.

---

## Live SMS with Termii (recommended in Nigeria)

1. Create an account at [https://termii.com](https://termii.com)
2. Get your **API key** from the dashboard
3. Register a **Sender ID** (e.g. `PAU Keke`) — may require approval
4. Fund your wallet (pay-as-you-go)
5. Create `backend/.env`:

```env
SMS_PROVIDER=termii
TERMII_API_KEY=your_actual_api_key
TERMII_SENDER_ID=PAU Keke
```

6. Restart the server: `npm start`

**Phone format:** drivers should be registered as `08012345678` or `2348012345678`.

---

## Live SMS with Africa's Talking

```env
SMS_PROVIDER=africastalking
AT_API_KEY=your_api_key
AT_USERNAME=your_username
```

---

## Driver welcome PIN (on registration)

When admin **registers a new driver**, a welcome SMS is sent with the driver portal link and PIN.

| `SMS_PROVIDER` | What happens |
|----------------|--------------|
| `console` (default) | Message prints in the **server terminal** — not to a real phone |
| `termii` / `africastalking` | Real SMS to the driver's phone |

---

## When SMS is sent

| Event | Driver SMS |
|-------|------------|
| Admin registers a new driver | Yes (welcome + PIN) |
| Passenger submits + driver auto-assigned | Yes |
| Waiting passenger auto-assigned after another ride completes | Yes |
| Admin **Reassign driver** | Yes (new driver) |
| Driver rejects (passenger back to waiting) | Only if another driver is assigned |

Passenger SMS is **not** implemented yet (no passenger phone field in the form). You can add that in a future sprint.

---

## Two-way SMS: Reply 1 = Accept, 0 = Reject

Assignment SMS now ends with:

```
Reply 1 = Accept
Reply 0 = Reject
```

When the driver texts back, the system updates the ride (same as the driver app).

### Test locally (demo mode — no real phone)

1. Submit a ride so a driver gets assigned (watch console for assign SMS).
2. In the **same terminal** where the server is running, type **`1`** then press **Enter** (or **`0`** to reject).

   You should see `[DEMO SMS] OK: Ride accepted...` and the passenger page updates.

3. **Or** in a **second terminal**, simulate the driver replying **1**:

```bash
curl -X POST http://localhost:3000/sms/simulate \
  -H "Content-Type: application/json" \
  -d '{"phone":"08087654321","message":"1"}'
```

Use the **exact phone** registered for that driver. Replace `1` with `0` to reject.

3. Check passenger page — status should change to **DRIVER ON THE WAY** after accept.

### Live SMS with Termii (inbound webhook)

Termii must forward incoming SMS to your server:

1. Expose your local server with [ngrok](https://ngrok.com) (for testing):
   ```bash
   ngrok http 3000
   ```
2. In Termii dashboard → **Webhook / Inbound SMS**, set URL to:
   ```
   https://YOUR-NGROK-ID.ngrok.io/webhooks/sms/inbound
   ```
3. Set `SMS_PROVIDER=termii` and your API key in `.env`.
4. Driver receives assign SMS → replies `1` or `0` → Termii POSTs to your webhook.

**Payload fields supported:** `phone`/`from`/`sender` + `message`/`text`.

### Africa's Talking

Set incoming SMS callback URL to:

```
https://your-domain.com/webhooks/sms/inbound
```

Uses `from` and `text` from their POST body.

---

## Disable SMS

```env
SMS_PROVIDER=off
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Nothing in console | Check driver has a valid `phone` in admin |
| Termii error | Verify API key, sender ID, wallet balance |
| Invalid phone | Use Nigerian format `080...` or `234...` |
| SMS not received | Check DND list; try Termii test number in their dashboard |
