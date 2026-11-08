# End-to-end (browser) tests

These tests drive the real app in Chromium, on a phone and on a desktop screen size.

| Script | What it covers |
|---|---|
| `e2e_audit.py` | **83-check audit** of the hosted build. It covers every screen and flow: settings and logo, branches, purchases (pack split, photos, units), B-Stock manifest import with lot-cost spread, the container pipeline (costs, car-only customs, statuses, receiving losses), bulk pricing, barcode label PDF, POS (walk-in, MoMo, wholesale, deposit, reserved order, return, cancel), receipt PDF and WhatsApp, expenses, cash handover, supplier bills, reminders, branch transfer, stock count, all 11 report tabs plus Excel, backup → restore into an empty database, every screen on phone and desktop, sales-rep and custom-role access, oversold detection and the activity log. |
| `e2e_assets.py` | **49-check assets test**: register (USD + extra costs, photo, on credit → bill, land), value and schedule, running costs, move, reminders, P&L depreciation and sale loss, undo, write-off, delete rules, offline, Excel, activity, backup/restore, rep blocked, phone + desktop |
| `e2e_hosted.py` | Roles: an approval request, rep restrictions, client orders (car) and credit limits |
| `e2e_hosted2.py` | Branches and transfers with a shortfall, wholesale, offline sale and resync, handover, bills, reminders, stock count, currencies (€), custom role |
| `e2e_hosted3.py` | Activity log: who/what/where/why, filters, staff see only their own |
| `e2e_saas.py` / `e2e_saas_crawl.py` / `e2e_saas_assets.py` | The SaaS server build: register, team, photos stored on the server, costs hidden from reps, every screen for owner and rep, password change, server activity log |

```bash
pip install -r requirements.txt && playwright install chromium
npm install                                   # local copies of xlsx / jspdf / jsbarcode
(cd ../public && python3 -m http.server 8765)  # hosted build, in another terminal
python3 e2e_audit.py                           # exits non-zero on any failure or page error
# SaaS tests: start the server on :8090 (see docs/07-DEPLOYMENT.md), then
python3 e2e_saas.py && python3 e2e_saas_crawl.py
```
`shim.js` stands in for the claude.ai runtime (shared database, users, file storage, downloads), synced across tabs, so the hosted build can be tested anywhere.
