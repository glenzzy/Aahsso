# 6. Business rules (the developer must keep these exactly)

All of these are implemented and unit-tested in `public/compute.js`. Change them there, and the browser, server and reports all follow.

## 6.1 The journey of goods
1. **Buy** (purchase = one lot). Bought in USD, EUR or another currency, at a Store, Auction (B-Stock manifest import), Online, Private seller, or Locally. "Pack of N" purchases are split into units, and a photo can be taken.
2. **US storage.** The lot has no container yet (`shipmentId=""`), so its stage is `us`.
3. **Container** (shipment). Lots are assigned to it, and the status moves through planning → loading → in_transit → at_port → cleared. Costs are added along the way:
   - US side: freight, trucking, loading, BESC, storage
   - Cameroon side: customs, port, demurrage, unloading, transport
4. **Receive.** The container is set to `received` and a branch is chosen. Missing or damaged units are recorded per lot (losses). Stock is now sellable at that branch.
5. **Sell** in base currency (FCFA by default).

Goods bought locally skip steps 2–4 (`inWarehouse=true`, `locationId`).

## 6.2 Landed cost (per unit, in base currency)
```
goods value of lot   = unitCost × qty × rate(lot.currency, container)
each container cost  → converted with the container's rate, then shared over the lots it applies to
                       (all / goods only / vehicles only / one specific lot) in proportion to goods value
landedUnit           = (goods value + shared costs) / qty
```
- `rateOf(settings, currency, shipment)`: the container's own rate if set, otherwise the settings rate (USD 600 by default), otherwise 1.
- **Cars:** add the car as a lot, and enter its customs with `appliesTo = <that lot>` so only the car carries it. When a car is bought for a client, it is a **client order** (`reservedFor`), so the full landed cost is charged to that client.

## 6.3 Prices
- Average landed cost per product = the average of its lots' `landedUnit`, weighted by quantity remaining.
- Each price below comes from an explicit price if set, otherwise from markup on the average cost, rounded **up** to `roundTo`:

| Price | Explicit field | Otherwise |
|---|---|---|
| Retail (max) | `priceMax` | avg × (1 + markup), default 100% |
| Minimum | `priceMin` | avg × (1 + minMarkup) |
| Wholesale | `priceWholesale` | avg × (1 + wholesaleMarkup) |

- Wholesale applies to **Wholesale/Reseller customers**, or to any line at or above `bulkQty`.
- Selling below the floor (the minimum, or wholesale for wholesale buyers) needs the `discount` permission.

## 6.4 Stock and FIFO
- Available at a branch = received − sold − returned-not-restocked − adjustments ± transfers. Stock in transit between branches counts at neither branch.
- `allocate()` takes stock from the lots that **expire first**, then the oldest purchase. If the customer has a client order lot, that lot is taken first. A lot reserved for one customer is never sold to another.
- Reserved orders (`delivered=false`) hold stock until they are delivered or cancelled.
- Returns can go back to stock (restock) or be written off. A reason is required: Damaged, Wrong item, Customer changed mind, Expired, Not as described, or Other.

## 6.5 Credit
- A walk-in customer must pay in full.
- A named customer can owe up to `creditLimit`. If that is null, `settings.defaultCreditLimit` applies; null there means unlimited, and 0 means cash only.
- A sale that pushes the balance over the limit needs the `credit` permission.
- The due date is the sale date + `creditDays`.
- Customer pages show the purchase history and balance; product pages show which customers bought the item, how often, and at what prices.

## 6.6 Cash handover (end of day)
- **Expected** = the payments **that staff member received** that day, per method (refunds are negative). The server computes this from its own `payments.byId`.
- The staff member declares what they hand over. The difference is shown, and a manager with `handover` confirms it.

## 6.7 Transfers & stock counts
- **Send:** stock leaves the source branch (`in_transit`).
- **Receive:** the receiver enters the received quantities. Any shortfall becomes a "Missing in transfer" loss adjustment, created by the server.
- **Stock count:**
  1. Choose a branch and category. A blind count hides the system quantities from the counter.
  2. Enter the counts and submit.
  3. A manager applies the count, and each difference becomes a "Stock count difference" adjustment valued at cost.

## 6.8 Losses
Losses are adjustments with a reason: Missing/theft, Unaccounted, Damaged, Expired, Missing in transfer, or Stock count difference. Container receiving shortfalls count too. The Losses report adds them up at landed cost.

## 6.9 Supplier payables
- A bill is money owed to a supplier: a store paid later, or a freight or clearing agent.
- A container cost marked "not paid yet" creates a bill automatically.
- Payments are added to the bill. Overdue bills appear on Home.

## 6.10 Reminders
- The template uses `{name} {balance} {due} {business} {momo} {receipts}`.
- **One tap:** WhatsApp (wa.me) or SMS, logged.
- **Automatic (SaaS):** daily at `reminderHour` in the `timezone`. Every customer with a balance gets a reminder, at most once every `reminderEvery` days, unless they are marked `noReminders`. It goes through the configured provider; see 07.

## 6.11 Currency
- **Purchase side:** any currency, with per-container rates.
- **Sales side:** the base currency only. Sales, reports, profit, handovers, expenses and credit are all in base currency.
- Changing the base currency (another country) relabels amounts. It does **not** convert old sales, so choose it at the start.

## 6.12 Business assets (equipment, vehicles, land…)
- **Full cost** = price × exchange rate (the asset's own rate, or the settings rate) + extra costs (shipping, customs, transport, installation). An asset bought abroad and shipped in a container carries its own shipping in extra costs; container costs are spread over goods for sale only.
- **Depreciation** starts on the purchase date (or the "started using it" date):
  - **Straight line:** (cost − residual) ÷ (life × 12) per month. The first month is charged only for the days after the start, and every later month gets the same amount, e.g. 2 000 000 over 5 years = 33 333 a month. The last year takes the remainder.
  - **Declining:** value × (1 − 2/life) per year, never below the residual.
  - **None:** land, or life 0.
  - Default life by type: vehicles 5, warehouse equipment 7, tanks 10, generators 5, computers 3, furniture 5, tools 5, buildings 20, land none.
- **Profit & loss** for a month includes "Depreciation of assets" (non-cash) and "Gain / loss on assets sold or written off". Repairs, fuel and insurance are ordinary expenses with `assetId`, so they are counted once.
- **Sell / write off:**
  - Sold: gain or loss = price − value in the books on that date.
  - Stolen, scrapped or given away: the whole book value is a loss.
  - A reason is required, and depreciation stops on that date.
  - Undo is possible with a reason; the previous disposal is kept.
- **Bought on credit:** a supplier bill is created with `assetId`.
- **Delete** is allowed only for an asset with no costs or bills and not sold (registered by mistake), and needs a reason. Otherwise it is sold or written off and stays in the register.
- Reminders: service, insurance, papers and warranty dates within 30 days appear on Home and Assets.

## 6.13 Activity log
Every write records who, when, which branch, what (in a readable sentence from `describeChange`), and why. A reason is asked for when deleting, cancelling, adjusting or changing a price, and the before/after values are kept. The SaaS build keeps this in `audit_log`, server-side.
