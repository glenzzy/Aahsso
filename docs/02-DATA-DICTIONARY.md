# 2. Data dictionary

Every record is a JSON document in one **collection**, with an `id` string generated in the browser (letters, digits, `_ - . : @ + ~`, at most 120 characters). Every document also gets `createdAt` and `updatedAt` (ISO timestamps). Dates are strings in `YYYY-MM-DD` form. Money on the **sales side** is always in the business's base currency (`settings.currency`, default XAF). Money on the **purchase side** carries its own `currency`.

On PostgreSQL every collection lives in `documents(tenant_id, collection, id, data jsonb)`.

## settings (single document, id `main`)
| Field | Type | Meaning |
|---|---|---|
| businessName, tagline, phone, address, logo | string (logo = data URL, ≤ 256 px) | Shown on receipts and the header |
| currency, currencySymbol | string | Base currency code (XAF, XOF, NGN, RWF, GHS, KES…) and receipt symbol |
| fxRates | `{USD: 600, EUR: 655.957, …}` | Value of 1 foreign unit in base currency (default rates) |
| fxRate | number | Legacy USD rate (kept equal to `fxRates.USD`) |
| defaultMarkup, minMarkup, wholesaleMarkup | % | Retail / minimum / wholesale markup on average landed cost |
| roundTo | number | Prices round UP to this step (e.g. 50) |
| bulkQty | int | Line quantity from which wholesale price applies (0 = off) |
| lowStock, expiryWarnDays | int | Alert thresholds |
| defaultCreditLimit | number or null | Credit limit for customers without their own (null = unlimited, 0 = cash only) |
| creditDays | int | Default "pay by" days for credit sales |
| momoAccounts | `[{method, number, label}]` | Receiving numbers offered at checkout |
| receiptFooter, reminderTemplate, reminderEvery | string, string, int | Receipt footer; reminder text with `{name} {balance} {due} {business} {momo} {receipts}`; days between reminders |
| autoReminders, reminderHour, timezone | bool, int, IANA tz | Server-side automatic reminders |
| categories | `{Category: [sub, …]}` | Product categories |
| vendors | string[] | Store suggestions |
| mainLocationName | string | Name of the main location (id `main`) |
| roles | `{key: {label, perms: [...]}}` | Edited built-in roles and custom roles |
| ownerId, ownerName, lastBackup | | Housekeeping |

## products (one per sellable item; condition is part of identity)
| Field | Type | Meaning |
|---|---|---|
| name, category, subcategory, condition | string | condition ∈ New, Open box, Used, Refurbished, Damaged / Parts |
| unit | string | Sold by: piece, pack, bag, kg, litre… |
| size, sizeUnit | number, string | e.g. 2.6 kg; metric/imperial shown automatically (`convertSize`) |
| image | string | File id (`/_blob/<id>` hosted, `/api/images/<id>` SaaS) or inline data URL |
| barcode | string | UPC scanned or generated (CODE128 labels) |
| markup, minMarkup, wholesaleMarkup | % or null | Override the settings |
| priceMax, priceMin, priceWholesale | number or null | Fixed prices (override markup) |
| bulkQty | int or null | Override the settings |
| archived, notes | bool, string | |

## lots (one purchase line = one batch of one product)
| Field | Type | Meaning |
|---|---|---|
| productId | id | → products |
| purchaseDate, sourceType, vendor, poNumber, lotNumber | | sourceType ∈ Store, Auction, Online, Private seller, Local (Cameroon) |
| currency, unitCost, regularPrice | string, number, number | Price paid per unit and shelf price (to measure the discount captured), in `currency` |
| qty | int | Units bought (after "pack of N" conversion) |
| expiry, condition, notes | | |
| shipmentId | id or "" | Container it travels in; "" = US storage |
| inWarehouse, locationId | bool, id | Bought locally: already in stock at that branch |
| recvMissing, recvDamaged | int | Recorded when the container is received (losses) |
| reservedFor | customer id | **Client order**: only that customer can buy it; it can be sold before arrival |
*Derived (not stored):* stage (us / transit / warehouse), landedUnit, received, available, byLoc{}, clientAvail, sold, revenue, cogs, lossX.

## shipments (containers)
| Field | Type | Meaning |
|---|---|---|
| name, bookingNo, containerNo, sealNo, size, carrier, agent, origin, destination, notes | string | |
| status | enum | planning → loading → in_transit → at_port → cleared → received → closed. Lots become sellable at `received`. |
| loadedAt, departedAt, arrivedAt, clearedAt, receivedAt | date | |
| locationId | id | Branch it was unloaded into |
| fxRates / fxRate | object / number | Exchange rates for this container (override settings) |
| costs[] | `{id, side: US/CM, category, label, amount, currency, appliesTo: all/goods/vehicles/<lotId>, paidTo, date, billed}` | Spread over lots by purchase value; `appliesTo` limits who carries it (e.g. car customs → that car only) |

## sales
| Field | Type | Meaning |
|---|---|---|
| no | string | Receipt number, e.g. `S261107-K3P` |
| txnId | string | Primary electronic transaction ID (first MoMo/OM/bank payment `ref`); set automatically |
| date, dueDate | date | Sale date; pay-by date when not fully paid |
| locationId | id | Branch where sold |
| customerId, customerName, customerPhone | | null id = walk-in (must pay in full) |
| createdBy, createdById | | **Set by the server** in SaaS |
| status | open / cancelled | Payment status is derived: paid, partial, unpaid |
| delivered | bool | false = reserved order waiting for pickup (stock is held) |
| discount, notes, cancelReason, cancelledBy, lastPaymentDeleteReason | | |
| lines[] | `{productId, name, qty, unitPrice, alloc: [{lotId, qty}], returns: [{id, date, qty, restock, alloc, reason, note, by, locationId}]}` | `alloc` = the exact lots taken (FIFO) |
| payments[] | `{id, date, method, account, ref, amount, fee, by, byId, at}` | `amount` pays the sale; `fee` is MoMo/OM withdrawal charges (separate). `ref` = transaction ID (required for MTN MoMo / Orange Money). Negative amount = refund. In SaaS, `byId`/`by` are set by the server. |

## customers
`name, phone, whatsapp, email, city, type (Retail / Wholesale / Reseller), creditLimit (null = default), notes, noReminders`

## adjustments (stock corrections & losses)
`date, productId, lotId, qty (negative = loss), locationId, reason, notes, by, byId`. Reason ∈ Missing / theft, Unaccounted for, Damaged, Expired, Missing in transfer, Stock count difference, Count correction, Found / extra, Own use / gift.

## transfers (between branches)
`no, date, from, to, reason, carrier, status (in_transit / received / cancelled), lines[{productId, qty, alloc, receivedQty}], by, byId, sentAt, receivedBy, receivedById, receivedAt, receiveNote`. Stock leaves `from` when sent and reaches `to` when received; shortfalls become adjustments.

## locations
`name, type (Shop / Warehouse / Market stall / Depot), address, archived`. The main location is the implicit id `main`.

## audits (stock counts)
`locationId, category, blind, status (draft / submitted / applied), counts {productId: qty}, lines[{productId, name, system, counted, unitCost}], startedAt, by, submittedAt, appliedAt, appliedBy, adjustments`

## handovers (end-of-day cash)
id `h_<date>_<userId>` · `date, userId, userName, locationId, expected {method: amount}, expectedTotal (server-computed), declared {method: amount}, payouts, payoutNote, notes, diff, status (submitted / confirmed), confirmedBy, confirmedAt`

## suppliers / bills
suppliers: `name, type, phone, notes` · bills: `supplierId, description, amount, currency, fxRate?, date, dueDate, shipmentId, costId, assetId, status (cancelled?), payments[{id, amount, method, date, ref, by}]`

## expenses
`date, category, amount (base currency), method, description, locationId, assetId?` (assetId links a repair, fuel or insurance cost to an asset)

## assets (things the business owns and uses, not for sale: stacker, forklift, truck, tank, generator, computers, land…)
| Field | Type | Meaning |
|---|---|---|
| tag | string | Asset number, auto `A-0001`, unique |
| name, category, condition, make, model, serialNo | string | category ∈ Vehicles, Warehouse equipment, Tanks & storage, Generators & power, Computers & phones, Furniture & fittings, Tools & machines, Buildings, Land, Other |
| image | string | Photo (same storage as product photos) |
| purchaseDate, vendor | date, string | |
| price, currency, fxRate | number, string, number | Price in any currency; `fxRate` blank = settings rate |
| extraCosts | number (base) | Shipping, customs, transport, installation |
| shipmentId | id | Container it came in (information only; its shipping goes in extraCosts, not container costs) |
| paidBy | string | Cash, MoMo, OM, bank… or "Not paid yet" (then a `bills` doc with `assetId` exists) |
| locationId, assignedTo | id, string | Where it is and who uses / keeps it |
| status | enum | in_use, idle, repair (owned) · sold, scrapped, stolen, donated (gone) |
| depMethod, usefulLife, residualValue, inServiceDate | enum, years, base amount, date | straight / declining / none; life defaults by category (Land 0 = none); start = inServiceDate or purchaseDate |
| nextServiceDate, insuranceUntil, registrationUntil, warrantyUntil | date | Reminders (Home + Assets within 30 days) |
| disposal | `{type, date, amount, method, buyer, reason, bookValue, by, at}` | Set when sold or written off. **bookValue is recomputed by the server.** |
| history[] | `{id, date, at, by, text, note}` | Moves, hand-overs, status changes |
| previousDisposal, reverseReason, lastMoveNote, deleteReason, notes | | |
*Derived:* cost, book value, accumulated depreciation, monthly charge, gain/loss (`compute.js → assetValue`).

## reminders (log of reminders sent)
`customerId, channel (whatsapp / sms / copied / log), balance, at, by, auto, status, error`

## Hosted-build-only collections
- `members/<userId>`: `{name, role, perms {perm: bool}, locationId, active, approvedAt, approvedBy}`
- `requests/<userId>`: `{name, at}` (an access request)
- `log/<userId>/d/<date>_<device>`: `{date, uid, user, device, entries: [activity entries]}`

## Relational tables (SaaS)
| Table | Columns |
|---|---|
| tenants | id, name, plan, status, trial_ends_at, paid_until, created_at |
| users | id, tenant_id, name, login (unique), password_hash, role, perms jsonb, location_id, active, created_at, last_login_at |
| documents | tenant_id, collection, id, data jsonb, updated_at, updated_by |
| audit_log | id, tenant_id, user_id, user_name, location_id, action, collection, doc_id, before jsonb, after jsonb, at |
| images | id, tenant_id, content_type, data bytea, created_at |
| reminder_runs | tenant_id, run_date, sent, at |
| schema_migrations | name, run_at |
