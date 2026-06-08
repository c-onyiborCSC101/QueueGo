# Deploying PAU Smart Keke System

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
   - **Build command:** `npm install`
   - **Start command:** `npm start`
4. Environment variables:
   - `ADMIN_PASSWORD` — your admin password
   - `JWT_SECRET` — long random string
   - `SMS_PROVIDER` — `termii` for live SMS (see `SMS_SETUP.md`)
   - `TERMII_API_KEY` / `TERMII_SENDER_ID` — if using Termii
   - `PORT` — `3000` (Render sets this automatically)
5. Add a **persistent disk** mounted at `/opt/render/project/src/backend` so `database.db` survives restarts (optional but recommended).

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
