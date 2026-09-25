# BANX — Premium WhatsApp Ban Service

Cyber red neon ban service website. 3 pages, real-time tracking, admin dashboard.

---

## Deploy on Render (recommended)

1. Push this folder to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` — just hit **Deploy**
5. After deploy, go to **Environment** tab and update:
   - `PAY_ACCT` → your real bank account number
   - `PAY_NAME` → your exact account name
   - `ADMIN_PASS` → change from default if you want

---

## Deploy on Vercel

1. Push this folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → New Project → import repo
3. Vercel picks up `vercel.json` automatically → Deploy
4. Go to **Settings → Environment Variables** and update:
   - `PAY_ACCT`, `PAY_NAME`, `PAY_BANK`, `ADMIN_PASS`

> **Note:** Vercel is serverless — data resets between cold starts.
> For persistent data on Vercel, add a free MongoDB Atlas or Supabase DB later.

---

## Local Development

```bash
npm install
node server.js
# Open http://localhost:3000
```

---

## Environment Variables

| Variable     | Default        | Description                    |
|--------------|----------------|--------------------------------|
| `ADMIN_PASS` | `Pasqua1264`   | Admin dashboard password       |
| `PAY_BANK`   | `GTBank`       | Bank name shown on payment tab |
| `PAY_NAME`   | `PASQUA TECH`  | Account name                   |
| `PAY_ACCT`   | `0000000000`   | Account number ⚠ update this  |
| `PORT`       | `3000`         | Server port                    |

---

## API Routes

| Method | Path                          | Auth    | Description             |
|--------|-------------------------------|---------|-------------------------|
| GET    | `/api/stats`                  | Public  | Homepage stats          |
| GET    | `/api/config`                 | Public  | Payment info            |
| GET    | `/api/requests/:id`           | Public  | Track one request       |
| POST   | `/api/requests`               | Public  | Submit new request      |
| POST   | `/api/requests/:id/notify-payment` | Public | User pays notify   |
| GET    | `/api/admin/requests`         | Admin   | All requests            |
| POST   | `/api/admin/requests`         | Admin   | Add request manually    |
| PATCH  | `/api/admin/requests/:id`     | Admin   | Update status           |
| DELETE | `/api/admin/requests/:id`     | Admin   | Delete request          |
| POST   | `/api/admin/verify`           | —       | Verify admin password   |

Admin routes require header: `x-admin-key: <ADMIN_PASS>`

---

**PASQUA TECH © 2025**
