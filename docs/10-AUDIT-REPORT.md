# 10. End-to-end audit report (November 2026)

**Scope:** every screen on phone, tablet and desktop sizes; the full journey (US purchase → storage → container → costs → receive → sell → pay → return → report); every role; offline and resync; backup and restore; the server API's security, permissions and concurrency.

## 10.1 Gaps and issues found, and fixed
| # | Area | Issue | Fix |
|---|---|---|---|
| 1 | Settings | Uploading a logo redrew the page and lost unsaved edits | Form "dirty" guard; the logo refreshes without a full redraw |
| 2 | Stock | Stock could go negative (two offline tills selling the last unit) and nothing warned | **Oversold detector**: alert on Home and an "Oversold" filter in Stock. The server blocks it outright (advisory lock). |
| 3 | Reports | No branch filter | Branch filter on Daily, Monthly P&L and all range tabs |
| 4 | Expenses | Not linked to a branch, so branch P&L was wrong | Expenses carry `locationId` |
| 5 | Cancel | Refunds always defaulted to Cash | Refund per original payment method |
| 6 | Cash handover | Expected cash trusted the browser's "who received it" | The server stamps `payments.by/byId` and computes `expectedTotal` |
| 7 | Security | A manager could raise their own permissions, create an Owner, or name a custom role "owner" | Escalation checks on `/api/users` and the role editor |
| 8 | Accounts | No way to change your password | Settings → Account → change password (`/api/me/password`) |
| 9 | Activity log | Business sign-up not logged | `register` event |
| 10 | API | Only the login was rate-limited | General per-IP rate limit |
| 11 | Navigation | Sidebar overflowed on small laptops | Scrollable sidebar |
| 12 | Labels | "Add location" vs "Add branch" were inconsistent | Unified as "branch" |
| 13 | Database | Reporting views were basic | Migration 006: richer views + `updated_at` index |
| 14 | Custom roles | A database constraint rejected custom role names | Migration 004 |

### Added on 8 Nov 2026: business assets register
A new **Assets** screen covers equipment, vehicles, tanks, generators, furniture, computers and land:
- Cost in any currency plus extra costs, photo, serial/plate, branch and the person holding it.
- Straight-line, declining or no depreciation, with value today and a year-by-year schedule.
- Running costs linked to Expenses; reminders for service, insurance and papers.
- Sell or write off with gain/loss; undo; on-credit purchase → supplier bill.
- Profit & loss lines, Excel register, activity log, backup and restore, its own permission.
- The server validates every asset and recomputes the book value on disposal.
Testing found and fixed two things: the activity log said only "details edited" when a service date changed, and an asset bought today showed a loss on its first day.

## 10.2 Final results
- **Unit tests:** 21 / 21 pass.
- **API tests:** 19 / 19 pass, including the 40-way overselling race and the 25-way transfer race.
- **Browser audit:** 83 / 83 checks pass. **Assets:** 49 / 49 (hosted) and 8 / 8 (SaaS).
- **SaaS end-to-end and screen crawl:** pass, with no JavaScript errors on any screen.

## 10.3 Known limitations (by design or for the next phase)
1. **Hosted build trust model.** Permissions are enforced by the app, and a person can delete their own activity-log entries. That suits a trusted team. For untrusted staff, run the **SaaS build**, where the server enforces everything and the audit log is server-side and append-only.
2. **Automatic WhatsApp/SMS reminders** need a provider account: Meta WhatsApp Cloud API with an approved template, Twilio, or a local SMS gateway. One-tap reminders work with no account.
3. **Fully offline cold start** (opening the app with no network at all) is available in the SaaS PWA. The hosted build keeps working offline once it is open.
4. **Scale.** `GET /api/data/:col` returns the whole collection. Add `?since=` incremental sync and pagination beyond about 100k documents per tenant (the index is in place). Move images to S3/R2 when storage grows.
5. **Changing the base currency** relabels amounts and doesn't convert history. Choose it when setting up.
6. **Billing / subscriptions** for the SaaS (trial → paid) are not wired to a payment provider. The fields `plan`, `trial_ends_at` and `paid_until` exist on `tenants`, and `requireActive` blocks writes when they expire.

## 10.4 Suggested roadmap for the developer
1. Deploy the SaaS build (07) on a domain with HTTPS; import the hosted backup.
2. Connect a reminder provider and pick the WhatsApp template.
3. Add subscription billing (Stripe, or CinetPay/Flutterwave for MoMo/OM) to set `paid_until`.
4. Incremental sync (`?since=`) and multi-instance pub/sub when there are more tenants.
5. Optional: a native wrapper (Capacitor) for app stores, using the same `public/` code.
6. Optional: a MoMo/OM payment API so customers pay by a request sent to their phone, with the reference filled in automatically.
