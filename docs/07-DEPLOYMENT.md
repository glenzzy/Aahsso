# 7. Deployment

## 7.1 Quick start (Docker)
```bash
cd server
cp .env.example .env          # set JWT_SECRET to a long random string
docker compose up -d          # Postgres + API; runs migrations on start
# open http://localhost:8080 → "Create business"
# optional demo data:
docker compose exec app node scripts/seed-demo.js   # demo@aahsso.app / demo1234 (rep: jenny@aahsso.app / demo1234)
```

## 7.2 Without Docker
Node 18+ and PostgreSQL 14+:
```bash
cd server && npm ci && cp .env.example .env   # edit DATABASE_URL, JWT_SECRET
npm run migrate && npm start
```

## 7.3 Environment variables
| Variable | Required | Meaning |
|---|---|---|
| DATABASE_URL | ✓ | Postgres connection string |
| JWT_SECRET | ✓ | 16+ characters; changing it signs everyone out |
| PORT | | default 8080 |
| PGSSL | | `true` for managed Postgres needing SSL |
| CORS_ORIGINS | | Only if the frontend is hosted on another domain |
| TRIAL_DAYS | | Free trial for new businesses (default 30) |
| API_RATE_PER_MIN | | General rate limit (default 1200) |
| REMINDER_PROVIDER | | `console` (log only), `whatsapp`, `twilio`, `http` |
| WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE, WHATSAPP_LANG | | Meta WhatsApp Cloud API. Business-initiated messages need an **approved template** with 3 body variables: name, balance, due date. |
| TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM | | Twilio SMS (or WhatsApp with `TWILIO_FROM=whatsapp:+1…`) |
| SMS_HTTP_URL, SMS_HTTP_AUTH, SMS_SENDER | | Any SMS gateway accepting POST JSON `{to, message, sender}` (local gateways in Cameroon, Africa's Talking via a small adapter…) |
| REMINDERS_DISABLED | | `1` to switch the scheduler off (e.g. on extra instances) |
| MOMO_FEE_TABLES | | Optional JSON object overriding default MTN MoMo / Orange Money withdrawal fee tiers for new tenants (also editable per business in Settings) |

## 7.4 Hosting suggestions
- **Simplest:** Render, Railway or Fly.io running the Dockerfile, with managed Postgres (Neon, Supabase or the platform's own).
- **Domain + HTTPS:** HTTPS is required for camera access, installing the app and service workers.
- **Phones:** open the site and choose "Add to Home Screen". It installs like an app (manifest + service worker) and works offline.

## 7.5 Scaling notes
- One instance handles a typical shop group easily.
- **More than one instance** needs two changes:
  - Replace `broadcast()` (in-process SSE) with Postgres LISTEN/NOTIFY or Redis.
  - Run the reminder scheduler on one instance only (`REMINDERS_DISABLED=1` on the others).
- **Large tenants (100k+ sales):** add `?since=<updatedAt>` incremental sync and pagination to `GET /api/data/:col` (an index on `documents(tenant_id, collection, updated_at)` already exists).
- **Images:** they are stored in Postgres (bytea). Move them to S3 or R2 when the storage grows (one module).

## 7.6 Moving data from the hosted build
In the hosted app, go to Settings → Backup → download. Then either import it in the SaaS app (Settings → Restore) or run:
```bash
npm run import-backup -- aahsso-backup.json owner@email.com
```
