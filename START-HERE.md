# Kargo — developer handover (start here)

**Client:** Bullekam SARL, Douala, Cameroon · contact@bullekam.com · www.bullekam.com  
**Product:** Kargo, a multi-tenant SaaS for import/resale businesses. It covers buying in the US (Costco, Walmart, Sam's Club, B-Stock auctions), US storage, containers Houston → Douala, landed cost, branches and warehouses, POS in FCFA (cash / MTN MoMo / Orange Money), credit and debt reminders, suppliers, cash handover, stock counts, business assets, reports and the activity log.

**You do not need any Claude account.** The client built and tested a working prototype on their own Claude account; it is not part of what you deploy. **Everything you need is in this folder:** the complete frontend, backend, database, documentation, demo data and tests. The app runs on any Node.js + PostgreSQL host.

---

## 1. Run it on your machine (10 minutes)

**With Docker** (recommended):
```bash
cd server
cp .env.example .env                       # then set JWT_SECRET to a long random string
docker compose up --build -d               # PostgreSQL + the app; database tables are created automatically
docker compose exec app node scripts/seed-demo.js     # demo business with realistic data
```
**Without Docker** (Node 18+ and PostgreSQL 14+ installed):
```bash
cd server && npm ci && cp .env.example .env     # set DATABASE_URL and JWT_SECRET
npm run migrate && npm run seed-demo && npm start
```

### Web links and logins (on your machine)
| What | Link |
|---|---|
| The app (phone, tablet or desktop browser) | **http://localhost:8080** |
| Health check | http://localhost:8080/healthz |
| API | http://localhost:8080/api/… (see `docs/03-API.md`) |

| Demo login | Password | Role | What they see |
|---|---|---|---|
| **demo@kargo.app** | demo1234 | Owner | Everything |
| **manager@kargo.app** | demo1234 | Manager | Everything except team & settings |
| **jenny@kargo.app** | demo1234 | Sales rep (Akwa shop) | Sell, payments, returns, customers, stock. Only her own sales; no costs, profit or assets. |

To use different demo credentials, set `DEMO_LOGIN` / `DEMO_PASS` before running the seed.
**Create business** on the login screen creates a brand-new, empty tenant. Its creator is the owner, and the trial length is set by `TRIAL_DAYS`.

### Quick look without a server (optional)
```bash
cd public && python3 -m http.server 8765      # or: npx serve public
```
Open http://localhost:8765. In this mode data is kept only in that browser: there are no logins and no team. It is useful to click through the screens, nothing more.

---

## 2. Put it online (production)

1. **Server:** any Node host. Render, Railway, Fly.io or a VPS can all build the `server/Dockerfile`. On start it runs the migrations, then the API, and serves the app.
2. **Database:** managed PostgreSQL 14+ (Neon, Supabase, Render, AWS RDS…). Set `DATABASE_URL`, plus `PGSSL=true` if SSL is required.
3. **Domain + HTTPS:** for example **https://kargo.bullekam.com**. HTTPS is required for the camera (photos, barcodes), for "Add to Home Screen" and for offline use.
4. **Environment variables:** listed in full in `docs/07-DEPLOYMENT.md`. The minimum is `DATABASE_URL` and `JWT_SECRET`.
5. **First real account:** open the site → **Create business** → "Bullekam Imports" (or the client's chosen name), signed up with the client's email. That person is the owner. The owner then adds staff under **Team & access**: name, login (email or phone), password, role and branch.
6. **Backups:** nightly `pg_dump` (managed Postgres usually includes this). Owners can also download a full JSON backup in Settings at any time.
7. **Do not** load the demo data into production, or delete it afterwards: `DELETE FROM tenants WHERE name='Demo Imports SARL';`

### Accounts and keys the client must provide (fill in)
| Item | Needed for | Value |
|---|---|---|
| Domain / sub-domain | Web address | __________________ |
| Hosting account | Running the app | __________________ |
| PostgreSQL database | Data | __________________ |
| `JWT_SECRET` (random, 32+ chars) | Logins | generate; keep secret |
| WhatsApp Cloud API (Meta) token, phone ID and approved template, **or** Twilio, **or** a local SMS gateway | Automatic debt reminders (optional; one-tap reminders work without it) | __________________ |
| Owner's email/phone for the first account | Owner login | __________________ |

---

## 3. Moving the client's existing data across

The client has already entered data in the prototype. To bring it over:
1. **Client:** in the current app, go to **Settings → Download full backup**. This gives a `.json` file with every record and photo, which the client sends to you.
2. **You:**
   - After step 5 above (the owner account exists), log in as the owner → **Settings → Restore from backup** → choose the file.
   - Or, on the server: `npm run import-backup -- kargo-backup.json owner@email.com`
3. Re-create staff logins under **Team & access**. Prototype users were Claude accounts, so they don't carry over.

The import never deletes anything; a record with the same id is overwritten, so it is safe to run it again with a newer backup just before go-live.

---

## 4. What is where

| Folder / file | Contents |
|---|---|
| `server/` | **Backend:** Node.js + Express + PostgreSQL API (`src/index.js`), reminders scheduler (`src/reminders.js`), migrations 001–007, demo seed, backup import, tests, Dockerfile, docker-compose |
| `server/public/` | **Frontend served by the backend.** Plain HTML/CSS/JavaScript with no build step, mobile-first and installable (PWA). `config.js = { api: '' }` |
| `public/` | The same frontend source (prototype build, `config.js = null`). Edit here, then copy into `server/public/` (keep its `config.js`). |
| `public/compute.js` | **All business rules**, shared by browser and server: landed cost, FIFO by expiry, prices, credit, stock per branch, permissions, depreciation, reports |
| `database/schema.sql` | Full database schema (all migrations, with reporting views) |
| `docs/` | 01 Architecture · 02 Data dictionary · 03 API · 04 Database + ERD · 05 Roles & permissions · 06 Business rules · 07 Deployment · 08 Testing · 09 Staff guide · 10 Audit report & roadmap · `screenshots/` |
| `tests-e2e/` | Browser tests (Playwright): 83-check full audit, 49-check assets test, SaaS flows |

**Code you can remove** if you never want the prototype mode: `ArtifactStore` in `data.js`, the `signedout` / `pending` screens in `boot.js` and the claude.ai hint in `v-team.js`. These only run inside claude.ai; in the server build they are inactive. Keep `LocalStore` if you want the no-server preview.

---

## 5. Check it works (acceptance)
```bash
cd server && npm test                                     # 21 unit tests (business rules)
KARGO_URL=http://localhost:8080 npm run test:api          # 19 API tests (use a throw-away database)
cd ../tests-e2e && see README.md                          # browser tests
```
Results at handover: **unit 21/21 · API 19/19 · browser audit 83/83 · assets 49/49 · SaaS flows pass**, with no JavaScript errors on any screen.

Then walk through it by hand with the demo logins:
1. **Buy:** Purchases → add a Costco line in USD, pack of 6, with a photo.
2. **Ship:** Containers → new container → add the purchase → add freight, BESC and customs costs → move it to received at a branch. Check Stock: the landed cost now includes the shipping share.
3. **Sell:** New sale → walk-in, pay by MoMo → receipt as WhatsApp/PDF. Then a credit sale to a named customer, then a return.
4. **Jenny (rep):** she sees only her sales and no costs. Close the day under Cash handover; the manager confirms it.
5. **Assets:** register a stacker, add a repair, sell it. Reports → Profit & loss shows the depreciation and the loss.
6. **Activity log:** shows who did what, where, when and why.
7. **Offline:** turn the network off, make a sale, turn it on, and it syncs.

## 6. Known limitations & next steps
See `docs/10-AUDIT-REPORT.md`. In short:
- Subscription billing (MoMo/OM via CinetPay or Flutterwave, or Stripe) is not wired yet.
- Automatic reminders need a provider account.
- For more than one server instance, use Postgres LISTEN/NOTIFY or Redis instead of the in-process live updates.
- For very large tenants, add `?since=` incremental sync and pagination.
- Public sign-up ("Create business") is open by design for SaaS. Restrict it if the client wants invite-only.
