# Deploying QueueGo

## Local run

```bash
cd backend
cp .env.example .env
npm install
npm start
```

Open:

- http://localhost:3000/index.html (passenger)
- http://localhost:3000/driver.html (driver — PIN login)
- http://localhost:3000/admin.html (admin — password login)

**Default credentials**

| Role | Credential |
|------|------------|
| Admin | password `pauadmin` (or `ADMIN_PASSWORD` in `.env`) |
| Driver | PIN `1234` for newly registered drivers |

---

## Deploy on Render (recommended for FYP demo)

1. Push project to GitHub.
2. Create **Web Service** on [Render](https://render.com).
3. Settings:
   - **Root directory:** `backend`
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Node version:** `20` (or set env `NODE_VERSION=20`) — avoids sqlite3 GLIBC errors on Render
4. Environment variables:
   - `JWT_SECRET` — long random string (**keep the same value across deploys**)
   - `PASSWORD_PEPPER` — optional second secret for password hashing (recommended)
   - `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` — **auto-restore staff login after each deploy** (highly recommended on Render free tier)
   - `DEMO_PASSENGERS` — optional `Name:email:password|Name2:email2:password2` to restore passenger logins after redeploy
   - `DEMO_DRIVERS` — optional `Name:phone:pin|Name2:phone2:pin2` to restore drivers after redeploy
   - `ADMIN_PASSWORD` — your admin password
   - `SMS_PROVIDER` — `termii` for live SMS (see `SMS_SETUP.md`)
   - `TERMII_API_KEY` — from [termii.com](https://termii.com) dashboard
   - `TERMII_SENDER_ID` — approved sender (e.g. `QueueGo`)
   - `TERMII_CHANNEL` — `dnd` (transactional ride alerts)
   - `PUBLIC_URL` — `https://queuego.onrender.com` (links in SMS + webhook URL in logs)
   - `PORT` — `3000` (Render sets this automatically)

5. **Termii inbound webhook** — in [Termii webhook settings](https://accounts.termii.com/#/account/webhook/config), set:
   ```
   https://queuego.onrender.com/webhooks/sms/inbound
   ```
   Required for drivers to reply **1** (accept) or **0** (reject) by SMS.

6. Add a **persistent disk** mounted at `/var/data` and set `DATABASE_PATH=/var/data/database.db` so accounts survive restarts (**paid Render plan only**). On the **free tier**, use `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` instead — staff login is recreated automatically after each deploy.

---

## Why logins stop working after a deploy

On Render **free tier**, the SQLite file is **wiped on every redeploy**. That removes staff, driver, and passenger accounts.

**Fix (free tier):** set these in Render Environment:

| Variable | Example |
|----------|---------|
| `BOOTSTRAP_ADMIN_EMAIL` | `ops@pau.edu.ng` |
| `BOOTSTRAP_ADMIN_PASSWORD` | your chosen password |
| `JWT_SECRET` | a fixed random string (never change after first deploy) |

Optional — restore drivers automatically:

```
DEMO_DRIVERS=Richard:08066982086:1234|Paul:08012345678:1234
```

**Fix (paid tier):** attach a persistent disk and set `DATABASE_PATH=/var/data/database.db`.

Your live URLs will be:

- `https://your-app.onrender.com/index.html`
- `https://your-app.onrender.com/driver.html`
- `https://your-app.onrender.com/admin.html`

---

## Deploy on Railway

1. New project → Deploy from GitHub.
2. Set root to `backend`.
3. Start command: `npm start`
4. Add variables from `.env.example`.
5. Use Railway volume for SQLite file path if needed.

---

## Notes for viva

- Socket.IO removes constant 3-second polling; 15-second fallback remains if WebSocket fails.
- Passenger endpoints stay public; admin and driver actions require JWT tokens.
- SQLite is suitable for FYP; production would use PostgreSQL + backups.
