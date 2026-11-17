# 3. REST API (SaaS build)

Base URL: the server itself (it also serves the frontend). JSON in and out. Auth: `Authorization: Bearer <JWT>` (valid 30 days). Errors come back as `{error: "message"}` with a proper status:
- 400: invalid input
- 401: not signed in or bad token. The app logs out on this code.
- 402: subscription inactive (reads and export still work)
- 403: no permission
- 404: not found
- 409: business rule broken (out of stock, over the credit limit, below the minimum price, a stale transfer)
- 429: rate limited

Rate limits:
- auth endpoints: 50 per 15 minutes per IP
- general: `API_RATE_PER_MIN` (default 1200) per IP

## Auth & account
| Method | Path | Body / notes |
|---|---|---|
| POST | /api/auth/register | `{businessName, name, login, password}` → creates a tenant + owner, returns `{token, user}` (password ≥ 6) |
| POST | /api/auth/login | `{login, password}` → `{token, user}` |
| GET | /api/me | Current user, tenant, effective permissions |
| POST | /api/me/password | `{current, password}` (new ≥ 6 chars). Wrong current password → 400 |

## Business data (all collections from the data dictionary)
| Method | Path | Notes |
|---|---|---|
| GET | /api/data/:col | Returns every document in the collection for this tenant. **Filtered by permission:** a rep without `salesAll` gets only their own sales (others become stubs used for stock maths); users without `costs` get lots and containers without cost fields; branch-restricted users see their branch. |
| PUT | /api/data/:col/:id | Create or replace a document (the body is the document). Needs one of the collection's write permissions (see 05). Writes to sales, transfers, handovers and audits are validated against current stock **inside a per-tenant advisory lock**, so two tills can't sell the last unit twice. The server also sets `createdBy`, payment `by/byId`, `expectedTotal` and transfer shortfall adjustments. |
| DELETE | /api/data/:col/:id | Only collections listed in DELETE_PERMS. Sales are never deleted; they are cancelled with a reason. |
| GET | /api/stream?token= | Server-Sent Events: `{col, id}` after each write in the tenant |

Collections include `assets` (permission `assets`; users without it receive an empty list; asset writes are validated and `disposal.bookValue` is recomputed by the server).

## Files, backup, people, log
| Method | Path | Notes |
|---|---|---|
| POST | /api/images | Raw image body (`Content-Type: image/jpeg|png|webp`, ≤ 5 MB; `stockEdit` or `purchases`) → `{id}` |
| GET | /api/images/:id | The image (tenant-checked) |
| GET | /api/export | Full JSON backup `{app:"aahsso", version, exportedAt, data: {collection: [docs]}}` (`export` permission) |
| POST | /api/import | Restore a backup (`settings` permission). Upserts every document in the file, in one transaction. |
| GET / POST / PATCH | /api/users, /api/users/:id | List, create, update staff (`team`). Escalation is blocked: you can't change your own permissions, a non-owner can't create admins or owners, and nobody can grant permissions they don't hold themselves. |
| GET | /api/activity?from&to&user&location&type&q | Readable activity log (`activity`) |
| GET | /api/audit?collection&id | Raw before/after history of one record |
| POST | /api/reminders/run | Send automatic reminders now (`reminders`) |
| GET | /api/reminders/provider | Which provider is configured |
| GET | /healthz | Liveness |

## Example: record a sale
```http
PUT /api/data/sales/s_lq2k9x
Authorization: Bearer eyJ...
{ "no":"S261107-K3P", "date":"2026-11-07", "locationId":"main",
  "customerId":"c_ab12", "customerName":"Mama Ngono",
  "lines":[{"productId":"p_oats","name":"Quaker Oats 4.5kg","qty":2,"unitPrice":9000,
            "alloc":[{"lotId":"l_77","qty":2}]}],
  "payments":[{"id":"pm1","date":"2026-11-07","method":"MTN MoMo","account":"677…","amount":10000}],
  "dueDate":"2026-11-21", "delivered":true }
```
- **200:** the stored document.
- **409:** for example "Only 1 left of Quaker Oats 4.5kg at Main" or "Over credit limit (limit 50 000, balance after sale 62 000)".

The client works out `alloc` with `KC.allocate()`. The server re-checks it with `KC.validateSale()`; if the lots are stale, the client re-allocates and sends again.
