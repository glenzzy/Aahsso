# 8. Testing

| Suite | Command | What it covers | Result |
|---|---|---|---|
| Unit (business rules) | `cd server && npm test` | Landed cost allocation, car-only costs, multi-currency, FIFO by expiry, client orders, per-branch stock, transfers, oversold, wholesale & bulk prices, credit limits, permissions & custom roles, unit conversion, reports, forecasts, activity text | **21 / 21 pass** (incl. assets: cost, straight/declining, land, sale gain/loss, totals, permissions, log text) |
| API integration | start the server on a throw-away DB, then `AAHSSO_URL=http://localhost:8080 npm run test:api` | Register/login, tenant isolation, permission checks per collection, rep sees only own sales, cost stripping, **concurrency: 40 simultaneous sales for the last 7 units → exactly 7 succeed; 25-way transfer race**, credit limit, wholesale floor, branch restriction, handover expected totals, bills, reminders through a mock SMS gateway, custom roles, transfer receive with shortfall, activity log, privilege escalation blocked, password change, assets (permissions, validation, server-computed book value, activity, backup) | **19 / 19 pass** |
| End-to-end, hosted build | `cd tests-e2e && npm i && pip install -r requirements.txt && python e2e_audit.py` | Real browser (Playwright, phone + desktop sizes): every screen, the full journey from purchase to US storage, container, costs, receiving, sale, receipt, payments, returns and cancel, plus reps, branches, transfers, stock count, handover, bills, reminders, reports, activity log, backup → restore, offline outbox → resync | **83 checks, 0 failed** |
| End-to-end, assets (hosted) | `python e2e_assets.py` | Register in USD + extra costs with photo, on credit → bill, land, KPIs, search/filters, running cost → expenses, move/hand over, reminders on Home, P&L depreciation and sale loss, undo, stolen write-off, delete rules, offline + resync, Excel, activity log, backup/restore, rep has no access, phone + desktop | **49 checks, 0 failed** |
| End-to-end, SaaS build | `python e2e_saas.py`, `python e2e_saas_crawl.py`, `python e2e_saas_assets.py` (needs the server running on :8090) | Login, roles, live sync between two browsers, every screen without page errors | **pass** |

Before every release, run the unit, API and `e2e_audit.py` suites. Add a test whenever a business rule changes.

## Stress / load
- The API concurrency test covers the critical race: overselling.
- To load-test further, run `autocannon -c 50 -d 30 -H "Authorization: Bearer $T" http://localhost:8080/api/data/products` (and a PUT of sales with unique ids).
- Watch p95 latency and the Postgres connection count (the pool is 10 by default, in `db.js`).
