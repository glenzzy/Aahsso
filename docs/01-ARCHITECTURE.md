# 1. Architecture

Kargo is a multi-tenant SaaS for importers and resellers. It covers buying abroad (US/Europe), shipping by container, clearing customs, and selling from one or more branches in local currency.

## 1.1 One codebase, two ways to run it

```
                ┌──────────────────────────── public/ (frontend, plain JS, no build) ───────────────────────────┐
                │ index.html · styles.css · app-core.js · v-*.js (screens) · data.js (storage adapters)         │
                │ compute.js  ◄── ALL business rules: landed cost, stock, FIFO, prices, permissions, reports      │
                └───────────────┬───────────────────────────────────────────────┬───────────────────────────────┘
                                │ config.js = null                              │ config.js = { api: '' }
                     ┌──────────▼──────────┐                         ┌──────────▼──────────────────────────────┐
                     │ Prototype/preview   │                         │ server/ (Node 18+, Express, PostgreSQL) │
                     │ ArtifactStore:      │                         │ RestStore → /api/*  + SSE live updates  │
                     │ shared document DB, │                         │ JWT auth · roles · tenant isolation     │
                     │ users, file storage │                         │ compute.js re-used to VALIDATE writes   │
                     └─────────────────────┘                         └─────────────────────────────────────────┘
```

- **`compute.js`** is a UMD module that both the browser and Node can load. The server never trusts numbers sent by the browser. It recomputes stock, credit and price floors with the same code before accepting a sale, transfer or handover.
- **The frontend** is a single-page app without a framework. Screens are plain functions that return HTML strings, and events are delegated through `data-a` (click), `data-i` (input) and `data-c` (change) attributes. `render()` redraws the current screen when data changes, except while the user is typing in a form or has a sheet open.
- **The data layer (`data.js`)** has three adapters with the same interface: `subscribe`, `put`, `del`, `query`, `uploadImage` and `imageUrl`.
  - `RestStore` is used when `window.KARGO_CONFIG.api` is set (the SaaS build).
  - `ArtifactStore` is used only inside the client's claude.ai prototype. It is not needed for production and can be removed.
  - `LocalStore` keeps data on one device only. It runs when `public/` is opened from any static web server: a preview with no backend and no logins.

## 1.2 Data model style
Business records are **JSON documents** grouped by collection: products, lots, shipments, sales, and so on. The browser and the server use exactly the same shape (see `02-DATA-DICTIONARY.md`).

On PostgreSQL they live in one `documents` table keyed by `(tenant_id, collection, id)`. Tenants, users, images, audit history and reminder runs are proper relational tables. Reporting **views** (`v_sales`, `v_sale_lines`, `v_payments`, `v_lots`) flatten the JSON for SQL and BI tools.

Why documents? Two reasons:
- The app works offline: whole documents are queued and re-sent, and IDs are generated in the browser, so a retry is harmless.
- The hosted and SaaS builds can share one frontend with no translation layer.

Normalising later is possible; see the roadmap in `10-AUDIT-REPORT.md`.

## 1.3 Key flows
| Flow | Where the logic lives |
|---|---|
| Landed cost (goods + share of freight/customs, per lot) | `computeAll` → `lotX[id].landedUnit` |
| Stock per lot and per branch, in transit, oversold | `computeAll` → `lotX.byLoc`, `prodX.available / byLoc / moving / oversold` |
| Which lots a sale takes (FIFO by expiry, then purchase date; client orders first) | `allocate()` |
| Sale and transfer validation (server) | `validateSale()`, `validateTransfer()` under a per-tenant advisory lock |
| Prices (retail, minimum, wholesale, bulk) | `computeAll` → `prodX.priceMax / priceMin / priceWholesale`, `autoPrice()`, `priceFloor()` |
| Permissions | `PERMS`, `ROLES`, `rolesWith(settings.roles)`, `permsFor(member, roles)` |
| Reports and forecasts | `saleFacts`, `groupBy`, `summarize`, `inventoryHealth`, `projections` |
| Business assets (value, depreciation, gain/loss) | `assetValue`, `assetDepreciation`, `assetTotals`, `assetSchedule`, `assetCheck` |
| Activity log text | `describeChange(collection, before, after, lookups)` |
| Currency | `rateOf(settings, currency, shipment)`. Purchase side in any currency; sales side in base currency. |

## 1.4 Offline & sync
- Every write goes through `save()` in `app-core.js`. When the network fails, the write is queued in a **local outbox** (localStorage) and retried every 15 s and on the `online` event. Pending writes are overlaid on top of incoming data, so the screen never shows old values.
- A **cached copy** of all data is kept on the device, so the app opens instantly and keeps working.
- The SaaS build registers `public/sw.js` (a service worker), so the app shell opens even with no network.
- Conflicts: if a queued sale no longer fits in stock, the server refuses it (409) and the app tells the user. In the hosted build there is no server to refuse it, so the **oversold detector** flags any negative stock on Home and in Stock.

## 1.5 Live updates
SaaS: `GET /api/stream` (Server-Sent Events) pushes `{col, id}` after every write, and clients re-fetch that collection. The broadcast is in-process. With more than one server instance, replace it with PostgreSQL `LISTEN/NOTIFY` or Redis pub/sub (one function, `broadcast()`).

## 1.6 Files
```
public/            frontend (also copied to server/public with config.js = {api:''})
  compute.js       business rules (shared with server)
  data.js          storage adapters
  app-core.js      state, helpers, navigation, outbox, activity logger, permissions in the UI
  v-sell.js        POS, receipts, sales, payments, returns, customers picker
  v-stock.js       stock, prices, labels, purchases, containers, receiving, transfers
  v-other.js       home, customers, expenses, settings, backup/restore
  v-reports.js     11 report tabs, forecasts
  v-team.js        team, approvals, roles & permissions editor
  v-money.js       cash handover, suppliers & bills, reminders, branches, stock counts
  v-assets.js      business assets register: depreciation, running costs, move, sell / write off
  v-activity.js    activity log
  boot.js          start-up, login screen (SaaS), access gate
  sw.js, manifest.json   installable app + offline shell (SaaS)
server/
  src/index.js     API, auth, permissions, validation, SSE, images, activity, backup
  src/reminders.js automatic debt reminders + providers (WhatsApp Cloud API, Twilio, any SMS gateway)
  src/db.js, src/migrate.js
  migrations/      001…007 SQL
  scripts/         seed-demo.js, import-backup.js
  test/            compute.test.js (unit), api.test.js (integration + concurrency)
database/          schema.sql (all migrations), ERD
tests-e2e/         browser tests (Playwright)
docs/              this documentation
```
