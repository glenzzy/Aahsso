# 5. Roles & permissions

Twenty-six permissions, defined in `compute.js → PERMS`. A user's effective permissions are worked out in three steps:
1. Start with the role's permissions. Roles are built in or custom, and can be edited in Team → Roles; they are stored in `settings.roles`.
2. Apply the per-user on/off overrides (`users.perms` / `members.perms`).
3. Owner and Admin always keep everything.

| Permission | Owner/Admin | Manager | Sales rep | Viewer |
|---|:-:|:-:|:-:|:-:|
| sell: make sales | ✓ | ✓ | ✓ | |
| salesAll: see everyone's sales (off = only own) | ✓ | ✓ | | ✓ |
| payments: record payments & deposits | ✓ | ✓ | ✓ | |
| discount: discounts / below minimum price | ✓ | ✓ | | |
| returns: returns & refunds | ✓ | ✓ | ✓ | |
| cancel: cancel sales, delete payments | ✓ | ✓ | | |
| customers: add & edit customers | ✓ | ✓ | ✓ | |
| credit: sell beyond credit limit | ✓ | ✓ | | |
| reminders: send payment reminders | ✓ | ✓ | | |
| stockView: see stock | ✓ | ✓ | ✓ | ✓ |
| stockEdit: adjust stock, prices, photos, labels | ✓ | ✓ | | |
| purchases: record purchases | ✓ | ✓ | | |
| containers: containers & shipping costs | ✓ | ✓ | | |
| transfers: move stock between branches | ✓ | ✓ | | |
| audit: stock counts | ✓ | ✓ | | |
| allLocations: work at all branches | ✓ | ✓ | | ✓ |
| costs: see costs, margins, profit | ✓ | ✓ | | |
| reports: reports & analytics | ✓ | ✓ | | ✓ |
| expenses: record expenses | ✓ | ✓ | | |
| handover: confirm staff cash handovers | ✓ | ✓ | | |
| suppliers: suppliers & bills | ✓ | ✓ | | |
| assets: business assets register | ✓ | ✓ | | |
| export: Excel & backups | ✓ | ✓ | | |
| activity: activity log | ✓ | ✓ | | |
| settings: business settings, branches | ✓ | | | |
| team: manage team & permissions | ✓ | | | |

## Where it is enforced
| Layer | SaaS build (production) | Prototype (client's claude.ai account) |
|---|---|---|
| Screens & buttons | `can()` hides menus, buttons and cost columns | same |
| Reading data | **Server** filters: own-sales stubs, cost fields stripped, branch filter, no assets without `assets` | App filters. The shared store's rules limit writes to settings/members/requests to admins and each person's activity log to its author. |
| Writing data | **Server** checks WRITE_PERMS per collection plus field-level rules: discounts below the floor need `discount`; over the limit needs `credit`; deleting payments needs `cancel`; a rep can't edit others' sales; branch-only users can't sell or transfer from other branches. | App checks the same rules |
| Stock/credit races | Advisory lock per tenant, then re-validation | Last write wins; the oversold detector flags it |
| Escalation | Can't edit own permissions; non-owners can't create owners/admins; nobody grants permissions they don't hold | Only admins can write `members` |

**For a strict multi-user deployment with untrusted staff, use the SaaS build.** There the server is the authority. In the hosted build the rules are enforced by the app, which is fine for a trusted team.
