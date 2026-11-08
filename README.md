# Kargo: Import, Stock & Sales Manager (SaaS)

> **Developers: read [START-HERE.md](START-HERE.md) first.** It covers local links, demo logins, deployment, moving the client's data and acceptance checks. No Claude account is needed.

## 0. What's in this package (start here)

| Folder | What it is |
|---|---|
| `public/` | The complete frontend (plain HTML/CSS/JS, no build step). It is identical to the live hosted app. |
| `server/` | Backend: Node.js + Express + PostgreSQL API, which also serves the frontend from `server/public` (same code, `config.js = {api:''}`). Includes Dockerfile, docker-compose, migrations, tests, demo seed and backup import. |
| `database/schema.sql` | The full database schema (all migrations in order, with reporting views) |
| `docs/` | **Developer handover:** 01 Architecture · 02 Data dictionary · 03 API · 04 Database & ERD · 05 Permissions matrix · 06 Business rules · 07 Deployment & env vars · 08 Testing · 09 Staff guide · 10 Audit report & roadmap |
| `tests-e2e/` | Browser end-to-end tests (Playwright): an 83-check full audit, a 49-check assets test, plus SaaS flows |

**Try it in 3 commands:**
```bash
cd server && cp .env.example .env && JWT_SECRET=$(openssl rand -hex 32) docker compose up --build -d
docker compose exec app node scripts/seed-demo.js
# open http://localhost:8080 → demo@kargo.app / demo1234   (sales rep: jenny@kargo.app / demo1234)
```

**Test status at handover:** unit 21/21 · API 19/19 · browser audit 83/83 · assets e2e 49/49 + SaaS 8/8 · SaaS e2e pass.

Kargo is software for businesses that buy goods abroad (from stores like Costco, Walmart and Sam's Club, and from B-Stock and other auctions), ship them by container, clear them through customs and sell them locally. It covers purchases, containers, landed cost, stock, the sales counter (POS), deposits and reserved orders, returns, receipts, expenses and profit reports.

```
kargo/
├── public/      Frontend (plain HTML/CSS/JS, no build step). The same code runs in two modes:
│                 • prototype (client's claude.ai account, not deployed) → config.js = null
│                 • no-server preview in any browser → config.js = null (data stays in that browser)
│                 • SaaS server           → config.js = {api:''}   (uses this server's /api)
└── server/      Node.js + Express + PostgreSQL multi-tenant API. Serves server/public (a copy of public/)
```

## 1. Run it (developer quick start)

Requirements: Node 18+ and PostgreSQL 14+ (or Docker).

```bash
cd server
cp .env.example .env            # set DATABASE_URL and a long random JWT_SECRET
npm install
npm run migrate                 # creates tables + reporting views
npm start                       # http://localhost:8080
```

With Docker, `cd server && JWT_SECRET=$(openssl rand -hex 32) docker compose up --build` starts PostgreSQL and the app together.

Open the app, choose **Create business**, and you're the owner of a new tenant with a 30-day trial (`TRIAL_DAYS`).

### Move data from the hosted app
1. In the hosted app, go to **Settings → Download full backup**. This gives you a `.json` file.
2. Do either of the following:
   - In the SaaS app, go to **Settings → Restore from backup**.
   - From the command line, run `npm run import-backup -- /path/backup.json owner@email.com`.

Both apps use the same file format, and the import never deletes records. Records with the same ID are overwritten.

### Deploy
The API and frontend are one Node process. Any Node host works (Render, Railway, Fly.io, a VPS with PM2, etc.) with a managed PostgreSQL database. Set `PGSSL=true` if your database needs SSL. Put HTTPS in front. For more than one server instance, replace the in-memory SSE broadcast (`streams` in `src/index.js`) with PostgreSQL `LISTEN/NOTIFY` or Redis pub/sub.

## 2. Architecture

| Layer | Choice | Why |
|---|---|---|
| Business logic | `public/compute.js` (UMD) | **One file shared by the browser and the server.** It computes landed cost, FIFO stock, pricing and profit, so the numbers always match. |
| Storage | `documents(tenant_id, collection, id, data jsonb)` | The frontend's document shapes are stored as they are. Tenants, users and the audit log are relational. SQL views (`v_sales`, `v_sale_lines`, `v_payments`, `v_lots`, `v_products`, `v_customers`) flatten the JSON for reports and BI tools. |
| Auth | JWT (30 days) + bcrypt | Each user has a `login` (email or phone). The tenant always comes from the token, never from the request. |
| Live updates | Server-Sent Events `/api/stream` | Every device sees new sales and stock changes instantly. Clients also refresh every 60 seconds as a fallback. |
| Stock integrity | `pg_advisory_xact_lock(tenant)` + `KC.validateSale` | Two cashiers can't both sell the last item. An oversell returns `409` with details. |
| Audit | `audit_log` keeps the before-image of every change | Accountability for theft or mistakes: who changed what, and when. See `GET /api/audit`. |

### Roles & permissions
Permissions are defined once in `public/compute.js` (`PERMS`, `ROLES`, `permsFor`). Each person has a **role preset**, plus optional **per-person overrides**: any permission can be switched on or off for one person (`users.perms`, jsonb).

| Role | Default access |
|---|---|
| owner / admin | Everything |
| manager | Everything except team & settings |
| sales | Sell, take payments, returns, customers, see stock. **Only sees their own sales. No costs, profit, discounts below minimum, cancelling, or going over credit limits.** |
| viewer | Read-only: stock, all sales, reports |

These are enforced by the **server**, not just the screen:
- `sales` documents are filtered: users without `salesAll` get other people's sales as stock-only stubs (no customer, prices or payments).
- Users without `costs` receive lots and shipments with costs removed, and products with selling prices already computed. Their writes cannot change costs or prices.
- Sale writes check, field by field: `sell` (lines), `payments` (new payments), `returns`, `cancel` (cancelling or removing payments), `discount` (discount or price below minimum) and `credit` (going over a customer's credit limit). The author is always set from the token.

### Client orders, credit, units, photos
- **Client orders:** `lots.reservedFor = customerId`. Such stock is only sellable to that customer, and can be sold before it arrives (deposits while at sea). It is excluded from general stock and from demand forecasting.
- **Credit:** `customers.creditLimit` (empty means use `settings.defaultCreditLimit`; empty there means no limit). Checked in the UI and on the server.
- **Units:** `products.unit` (sold-by unit) plus `size` + `sizeUnit`, with automatic metric/imperial conversion (`convertSize`). Purchases accept "pack of N", which converts quantity and price into single sellable units.
- **Photos:** `POST /api/images` (stored in the `images` table, served at `/api/images/:id`). `products.image` holds the id, or an inline `data:` URL from backups.

### Locations, wholesale, cash handover, suppliers, offline, reminders
- **Locations:** the main location has the id `main`; others live in `locations`. Each lot's stock is tracked per location (`compute.js` → `lotX.byLoc`). It moves with `transfers` (`{from, to, lines:[{productId, qty, alloc}]}`), `sales.locationId` and `adjustments.locationId`. Containers unload into `shipments.locationId`. Staff can be tied to a location (`users.location_id`, or `members.locationId` in the hosted app). Without the `allLocations` permission the server only lets them sell at, or move stock out of, that location. Transfers are race-safe (tested with 25 concurrent requests).
- **Wholesale:** `priceWholesale` (fixed price) or `wholesaleMarkup` (default from settings), plus `bulkQty`. `KC.autoPrice` and `KC.priceFloor` apply the wholesale price automatically to Wholesale/Reseller customers or when a line reaches the bulk quantity. The server applies the same floor.
- **Cash handover:** the server stamps every payment with the user who recorded it (`payments[].byId`). A `handovers` document (`h_<date>_<userId>`) holds what the person declared by method, plus cash paid out. The server recomputes `expectedTotal` itself. Only users with `handover` can confirm, and staff only see their own handovers.
- **Suppliers & bills:** `suppliers` and `bills` (`{supplierId, amount, currency, dueDate, shipmentId, costId, payments[]}`). A bill can be created directly from a container cost ("not paid yet") or from a purchase ("on credit").
- **Offline:** the app queues every write in a local outbox when the network fails. It retries every 15 s and on reconnect, and shows "N to sync". A copy of the data stays on the device, so the app keeps working and opens instantly. IDs are generated in the browser, so re-sending is safe: the server treats a repeat as the same sale (tested). If stock ran out meanwhile, the server rejects the queued sale with 409 and the app tells the user. The SaaS build also registers `sw.js`, so the app opens with no network at all.
- **Debt reminders:** each sale has `dueDate` (defaulting to `creditDays`). `src/reminders.js` runs every 15 minutes and sends once per business per day at `settings.reminderHour`, when `settings.autoReminders` is on. It never reminds the same customer within `reminderEvery` days, and logs everything to `reminders`. Set the provider with environment variables:
  - `REMINDER_PROVIDER=console` (default, logs only)
  - `whatsapp`: Meta WhatsApp Cloud API. Needs `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID`. Set `WHATSAPP_TEMPLATE` to an approved template with 3 body variables (name, balance, due date); business-initiated messages require one.
  - `twilio`: needs `TWILIO_SID`, `TWILIO_TOKEN` and `TWILIO_FROM` (use `whatsapp:+…` for WhatsApp).
  - `http`: any SMS gateway, e.g. a Cameroon aggregator. Set `SMS_HTTP_URL`, plus `SMS_HTTP_AUTH` and `SMS_SENDER` if needed. The app POSTs `{to, message, sender}`.

  `POST /api/reminders/run {dryRun}` previews or sends on demand.

### Currencies, branch transfers, stock counts, editable roles
- **Currencies:** `settings.currency` (the base currency, e.g. XAF, XOF, NGN, RWF) plus `currencySymbol`, and `settings.fxRates` (`{USD: 600, EUR: 655.957}`). Containers can override with `shipments.fxRates`. A lot, cost or bill can be in any currency; `KC.rateOf` converts it to base. Everything on the sales side (prices, receipts, profit, reports) is in the base currency only.
- **Branch transfers:** a transfer starts `in_transit`. Stock leaves the source when it is sent and reaches the destination on `received`. Each line's `receivedQty` is entered by the receiving branch. The server keeps the sent quantities, and books any shortfall as `adjustments` with reason "Missing in transfer". The receiving branch's staff can receive without the full `transfers` permission.
- **Stock count (`audits`):** blind counting per branch is saved as the user types. On finish, the expected quantities are frozen (`lines[].system`). Approving (`stockEdit` only, enforced by the server) writes adjustments with the chosen reason: theft, unaccounted for, damaged… Return reasons are a fixed list (`KC.RETURN_REASONS`).
- **Editable roles:** `settings.roles` overrides the built-in roles or adds new ones (`{cashier:{label, perms:[…]}}`). `KC.rolesWith` / `permsFor(member, roles)` are used by both the app and the server. Migration 004 lets `users.role` hold a custom role key.

### Business assets
`assets` documents hold equipment, vehicles, tanks, furniture and land the business uses (not stock). `compute.js` provides `assetCost`, `assetValue`, `assetDepreciation`, `assetTotals`, `assetSchedule` and `assetCheck`. Depreciation is straight line, declining or none, starting on the purchase date with equal monthly charges. Monthly P&L adds depreciation and gain/loss on disposals. Repairs and fuel are `expenses` with `assetId`; credit purchases are `bills` with `assetId`. Permission: `assets`. The server rejects invalid assets and recomputes `disposal.bookValue`. Screen: `public/v-assets.js`. Business rules: docs/06 §6.12.

### Activity log (who did what, where, when, why)
- `KC.describeChange(collection, before, after, lookups)` turns any change into plain-language lines, e.g. "Cancelled sale S… — Why: Duplicate sale", "Removed 2 × Oats at Akwa shop — Why: Missing / theft", or "Received transfer T… — 1 unit(s) missing". The same function is used by the app and the server.
- **SaaS:** every write already lands in `audit_log`, which now also stores `after`, `user_name` and `location_id` (migration 005). `GET /api/activity?from&to` returns the readable history. Users without the `activity` permission only get their own entries. Staff cannot edit or delete the log.
- **Hosted app:** each person writes only their own log at `log/<userId>/d/<date>_<device>`. A database rule stops anyone else, the owner included, from changing it.
- Cancelling a sale and deleting a payment now require a reason. Returns, losses, transfers and stock counts record their reasons too.

### Reports (all computed in `compute.js`)
`saleFacts` → `groupBy`/`summarize` give sales by item, category, subcategory, staff member, customer, weekday, hour, week of month, month and year. `inventoryHealth` gives velocity, days of stock, sell-through, age and status (fast, steady, slow, not selling). `projections` gives month and year run-rate, stock-out dates, container break-even and buy-next-container suggestions.

### Tests
```bash
cd server
npm test                                            # 21 unit tests (compute.js), incl. a 20 000-sale volume test
KARGO_URL=http://localhost:8080 npm run test:api    # 19 API tests: permissions, concurrency races, credit, branches, wholesale,
                                                    # handover, bills, reminders, custom roles, transfers, activity, security
cd ../tests-e2e && see README.md                    # 83-check audit, 49-check assets test + SaaS flows
```

### Subscription
`tenants.plan`, `status`, `trial_ends_at` and `paid_until` are stored. When a subscription is inactive, all writes return `402`, but reading and export stay open so a business can always take its data out. **To build:** a billing integration (e.g. a MoMo/OM payment aggregator or Stripe) that sets `paid_until`, and a super-admin screen.

## 3. API

```
POST /api/auth/register  {businessName, name, login, password} → {token}   (full reference: docs/03-API.md)
POST /api/auth/login     {login, password} → {token}
GET  /api/me
GET  /api/data/:collection              → {docs:[...]}
PUT  /api/data/:collection/:id   body = document (validated; sales are stock-checked)
DELETE /api/data/:collection/:id        (sales cannot be deleted, only cancelled)
GET  /api/export  ·  POST /api/import   (backup JSON)
GET/POST/PATCH /api/users               (team: role + perms overrides)
POST /api/images · GET /api/images/:id  (product photos)
GET  /api/audit
GET  /api/stream?token=…                (SSE)
```
Collections are `settings` (doc `main`), `products`, `lots`, `shipments`, `customers`, `sales`, `adjustments`, `expenses`, `locations`, `transfers`, `handovers`, `suppliers`, `bills`, `reminders`, `audits` and `assets`. Every field is listed in `docs/02-DATA-DICTIONARY.md`.

## 4. Data model (document shapes)

- **products**: `{name, category, subcategory, condition, unit, size, sizeUnit, image, barcode, markup, minMarkup, priceMax, priceMin, archived}`. If `priceMax`/`priceMin` are empty, prices come from markup × average landed cost.
- **lots** (one purchase line): `{productId, purchaseDate, sourceType, vendor, poNumber, lotNumber, currency (USD, EUR, base…), regularPrice, unitCost, qty, expiry, condition, shipmentId, inWarehouse, locationId, reservedFor, recvMissing, recvDamaged}`
- **shipments** (containers): `{name, bookingNo, containerNo, sealNo, size, carrier, agent, origin, destination, status, fxRates, locationId, loadedAt, arrivedAt, clearedAt, receivedAt, costs:[{side US|CM, category, label, amount, currency, appliesTo all|goods|vehicles|<lotId>, paidTo, date}]}`
  - Status flow: `planning → loading → in_transit → at_port → cleared → received → closed`. Lots become sellable at `received`.
- **sales**: `{no, date, createdById, createdBy, customerId, customerName, customerPhone, discount, delivered, status open|cancelled, notes, lines:[{productId, name, qty, unitPrice, alloc:[{lotId, qty}], returns:[{qty, restock, alloc, reason}]}], payments:[{date, method, account, ref, amount}]}`
  - Payment status is derived: paid / partial (deposit) / unpaid. A reserved order is a sale with `delivered:false`; it holds its stock.
  - Refunds are negative payments.
- **adjustments**: `{date, productId, lotId, qty (negative = loss), reason}`
- **expenses**: `{date, category, amount, method, description}`
- **customers**: `{name, phone, whatsapp, email, city, type, creditLimit, notes}`

### Costing rules (in `compute.js`)
- Item cost in FCFA = unit price paid × the container's exchange rate (default 600).
- Each container cost is spread over its items **by purchase value**. A cost can be limited to goods only, vehicles only, or a single item (e.g. one car's customs).
- **Landed unit cost** = item cost + its share of shipping and customs ÷ quantity bought. Items missing or damaged on arrival are reported as losses at landed cost.
- Sales take stock **FIFO by earliest expiry, then oldest purchase**. Cost of goods sold uses each lot's *current* landed cost, so customs added after selling starts still shows up correctly in profit.

## 5. Suggested next steps for the developer
See `docs/10-AUDIT-REPORT.md` for known limitations and the full roadmap. In short:
1. Deploy on a domain with HTTPS and import the hosted backup.
2. Connect a reminder provider (WhatsApp Cloud API template, Twilio or a local SMS gateway).
3. Billing (CinetPay/Flutterwave for MoMo/OM, or Stripe) setting `tenants.paid_until`, plus a super-admin console.
4. Incremental sync (`?since=`) and pagination for very large tenants, and pub/sub for more than one server instance.
5. Camera barcode scanning (e.g. `@zxing/browser`). USB/Bluetooth scanners already work in the POS search box.
6. Optional: native app-store wrapper (Capacitor) with the same `public/` code.
