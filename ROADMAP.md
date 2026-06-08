# PAU Smart Keke — Development Roadmap

## Sprint status

| Sprint | Item | Status |
|--------|------|--------|
| Core | Auto-assign on submit | ✅ Done |
| Core | Driver portal (accept/reject/complete) | ✅ Done |
| Core | Admin monitoring + override | ✅ Done |
| Core | Ride history | ✅ Done |
| **2** | **Socket.IO live updates** | ✅ Done |
| **4** | **Auth (admin, driver PIN, passenger login)** | ✅ Done |
| **5** | Mobile-responsive UI | ✅ Partial |
| **6** | Deployment guide (Render/Railway) | ✅ Done (`DEPLOY.md`) |

## Architecture

- **Passenger** — public; Socket.IO room per ride ID
- **Driver** — JWT after PIN login; Socket.IO room per driver ID
- **Admin** — JWT after password; Socket.IO `rides:updated` broadcast
- **Dispatch** — automatic on `POST /request`; waiting queue fills when drivers complete/reject

## URLs

```bash
cd backend && npm start
```

| Page | URL |
|------|-----|
| Passenger | http://localhost:3000/index.html |
| Driver | http://localhost:3000/driver.html |
| Admin | http://localhost:3000/admin.html |

## Credentials (defaults)

- **Admin password:** `pauadmin` (env: `ADMIN_PASSWORD`)
- **Driver PIN:** `1234` (set when registering driver in admin)

## SMS on assign

- ✅ Driver SMS when ride is assigned (`backend/sms.js`)
- ✅ Two-way SMS: reply **1** = accept, **0** = reject (`POST /webhooks/sms/inbound`, `POST /sms/simulate`)
- Providers: `console` (demo), `termii`, `africastalking`
- Setup guide: `SMS_SETUP.md`

## Optional next steps

- Passenger SMS (add phone field to booking form)
- GPS-based nearest-driver matching
- USSD channel (document as future work)
