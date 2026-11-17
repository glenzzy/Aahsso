/* Subscriptions: plans & limits, invoices, payments, the daily lifecycle, and the business-side Billing API.
 * The tenants row keeps a copy of the current state (plan, status, trial_ends_at, paid_until, grace_days) so the
 * per-request check (subscriptionOk) stays one cheap query. syncTenant() writes that copy after every change. */
const { q, pool } = require('./db');
const KC = require('../public/compute.js');
const mailer = require('./mailer');

const COUNT_LIMITS = { maxUsers: 'team members', maxLocations: 'branches (including the main one)', maxProducts: 'items' };
const FEATURES = Object.fromEntries(KC.FEATURES.map(([k, l]) => [k, l])); // every business feature a plan can include
const LIMIT_KEYS = Object.keys(COUNT_LIMITS);
const FREE_TRIAL_DAYS = 5; // the free trial: after sign-up, and on a Free plan (fixed — not an env or admin setting)
/** a plan without any price is Free: choosing it starts the free trial (once per business) */
const isFree = (p) => p && (p.price_monthly === null || p.price_monthly === undefined) && (p.price_yearly === null || p.price_yearly === undefined);
const PAY_METHODS = ['MTN MoMo', 'Orange Money', 'Bank transfer', 'Cash', 'Other'];
const STATUS_LABEL = { trialing: 'Free trial', active: 'Active', past_due: 'Payment overdue', expired: 'Expired', suspended: 'Suspended', cancelled: 'Cancelled' };

/* ---------- platform settings ---------- */
const DEFAULTS = { paymentInstructions: { momoNumber: '', momoName: '', omNumber: '', omName: '', bank: '', note: '' }, graceDays: 7, renewalNoticeDays: 7, invoiceDueDays: 7 };
async function platformSettings(c = pool) {
  const rows = (await c.query('SELECT key, value FROM platform_settings')).rows;
  const o = JSON.parse(JSON.stringify(DEFAULTS)); rows.forEach((r) => { o[r.key] = r.value; });
  o.paymentInstructions = Object.assign({}, DEFAULTS.paymentInstructions, o.paymentInstructions || {});
  return o;
}

/* ---------- dates ---------- */
function addPeriod(d, cycle) {
  const x = new Date(d);
  if (cycle === 'yearly') { const m = x.getMonth(); x.setFullYear(x.getFullYear() + 1); if (x.getMonth() !== m) x.setDate(0); }
  else { const day = x.getDate(); x.setMonth(x.getMonth() + 1); if (x.getDate() < day) x.setDate(0); } // 31 Jan → 28/29 Feb
  return x;
}
const dayStr = (d) => new Date(d).toISOString().slice(0, 10);
const money = (n, cur) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' ' + (cur === 'XAF' || !cur ? 'FCFA' : cur);

/* ---------- subscription state ---------- */
async function getSub(c, tid) {
  return (await c.query('SELECT s.*, p.name AS plan_name, p.limits, p.modules, p.price_monthly, p.price_yearly, p.active AS plan_active FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1', [tid])).rows[0] || null;
}
async function ensureSub(c, tid, trialEndsAt) {
  await c.query("INSERT INTO subscriptions (tenant_id, status, trial_ends_at) VALUES ($1, 'trialing', $2) ON CONFLICT (tenant_id) DO NOTHING", [tid, trialEndsAt]);
}
/** Copy the subscription's state onto the tenants row (what each request checks). */
async function syncTenant(c, tid) {
  const s = await getSub(c, tid); if (!s) return;
  const now = Date.now(); const grace = Number(s.grace_days) || 7;
  const plan = s.status === 'trialing' || !s.plan_id ? 'trial' : s.plan_id;
  const status = s.status === 'suspended' ? 'suspended' : ['past_due', 'expired'].includes(s.status) ? 'past_due' : 'active';
  let trialEnds = s.trial_ends_at, paidUntil = s.current_period_end;
  if (s.status === 'expired') { // make sure access is really paused, even when an admin ends it early
    const cut = new Date(now - (grace + 1) * 864e5);
    if (plan === 'trial') trialEnds = trialEnds && new Date(trialEnds).getTime() < now ? trialEnds : new Date(now - 1000);
    else paidUntil = paidUntil && new Date(paidUntil) < cut ? paidUntil : cut;
  }
  await c.query('UPDATE tenants SET plan=$2, status=$3, trial_ends_at=$4, paid_until=$5, grace_days=$6 WHERE id=$1', [tid, plan, status, trialEnds, paidUntil, grace]);
}
async function setSub(c, tid, patch) {
  const keys = Object.keys(patch); if (!keys.length) return;
  await c.query('UPDATE subscriptions SET ' + keys.map((k, i) => k + '=$' + (i + 2)).join(', ') + ', updated_at=now() WHERE tenant_id=$1', [tid].concat(keys.map((k) => patch[k])));
  await syncTenant(c, tid); invalidate(tid);
}

/* ---------- what a business is entitled to: features + limits ---------- */
// Cached briefly: every request checks it. Plan or subscription changes clear the cache at once.
const entCache = new Map(); const ENT_TTL = 15e3;
function invalidate(tid) { if (tid) entCache.delete(tid); else entCache.clear(); }
/** {features: {key: false, …} (only the ones that are OFF), limits, plan, trial}. During the free trial every feature is on
 *  and nothing is limited; a business's own overrides (set by the platform admin) apply on top of its plan in every case. */
async function limitsFor(c, tid) {
  const hit = entCache.get(tid); if (hit && Date.now() - hit.at < ENT_TTL) return hit.v;
  const s = await getSub(c, tid); const ov = (s && s.overrides) || {};
  const trial = !s || s.status === 'trialing';
  const open = !s || !s.plan_id; // no plan chosen yet: everything is open (the free trial right after sign-up)
  const modules = Object.assign({}, open ? {} : (s.modules || {}), ov.modules || {});
  const features = {}; KC.FEATURE_KEYS.forEach((k) => { if (modules[k] === false) features[k] = false; });
  const limits = Object.assign({}, open ? {} : (s.limits || {}), ov.limits || {});
  Object.keys(limits).forEach((k) => { if (!COUNT_LIMITS[k] || limits[k] === null || limits[k] === '') delete limits[k]; });
  const v = { features, limits, plan: s && s.plan_name, trial };
  entCache.set(tid, { at: Date.now(), v }); return v;
}
/** null when the feature(s) are on; otherwise a 402 for "not in your plan" (any one of `keys` being on is enough) */
async function checkFeature(c, tid, keys) {
  keys = [].concat(keys); const { features, plan } = await limitsFor(c, tid);
  if (KC.anyOn(features, keys)) return null;
  return { status: 402, error: limitError(plan, keys[0]), code: 'plan_feature', feature: keys[0] };
}
async function usage(c, tid) {
  const r = (await c.query(`SELECT
      (SELECT count(*)::int FROM users WHERE tenant_id=$1 AND active) AS "maxUsers",
      (SELECT count(*)::int + 1 FROM documents WHERE tenant_id=$1 AND collection='locations' AND coalesce((data->>'archived')::boolean, false) = false) AS "maxLocations",
      (SELECT count(*)::int FROM documents WHERE tenant_id=$1 AND collection='products' AND coalesce((data->>'archived')::boolean, false) = false) AS "maxProducts"`, [tid])).rows[0];
  return r;
}
const limitError = (plan, key, max) => COUNT_LIMITS[key]
  ? 'Your plan' + (plan ? ' (' + plan + ')' : '') + ' allows ' + max + ' ' + COUNT_LIMITS[key] + '. Upgrade in Billing & subscription to add more.'
  : FEATURES[key] + ' is not included in your plan' + (plan ? ' (' + plan + ')' : '') + '. Upgrade in Billing & subscription to use it.';
/** null when allowed; otherwise {status: 402, error, code: 'plan_limit', limit} */
async function checkLimit(c, tid, key) {
  if (FEATURES[key]) return checkFeature(c, tid, key);
  const { limits, plan } = await limitsFor(c, tid); const v = limits[key];
  if (v === null || v === undefined || v === '') return null;
  const used = (await usage(c, tid))[key];
  return used >= Number(v) ? { status: 402, error: limitError(plan, key, Number(v)), code: 'plan_limit', limit: key, max: Number(v), used } : null;
}

/* ---------- invoices & payments ---------- */
async function createInvoice(c, { tid, planId, cycle, amount, createdBy, dueDays, periodStart }) {
  cycle = cycle === 'yearly' ? 'yearly' : 'monthly';
  const plan = (await c.query('SELECT * FROM plans WHERE id=$1', [planId])).rows[0]; if (!plan) throw Object.assign(new Error('Unknown plan'), { status: 400 });
  const s = await getSub(c, tid); const S = await platformSettings(c);
  let price = amount !== undefined && amount !== null && amount !== '' ? Math.round(Number(amount)) : null;
  if (price === null) price = s && s.plan_id === planId && s.cycle === cycle && s.price !== null && s.status !== 'trialing' ? s.price : plan['price_' + cycle]; // a renewal keeps the price they signed up at
  if (price === null || price === undefined || !(price >= 0)) throw Object.assign(new Error(plan.name + ' is not sold ' + (cycle === 'yearly' ? 'yearly' : 'monthly') + ' yet'), { status: 400 });
  const live = s && ['active', 'past_due'].includes(s.status) && s.current_period_end && new Date(s.current_period_end) > new Date() && s.plan_id === planId;
  const start = periodStart ? new Date(periodStart) : live ? new Date(s.current_period_end) : new Date();
  const seq = (await c.query("SELECT nextval('invoice_seq') AS n")).rows[0].n;
  const number = 'AHS-' + new Date().getFullYear() + '-' + seq;
  const due = new Date(Date.now() + (Number(dueDays ?? S.invoiceDueDays) || 0) * 864e5);
  return (await c.query('INSERT INTO invoices (number, tenant_id, plan_id, cycle, period_start, period_end, amount, currency, due_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
    [number, tid, planId, cycle, start, addPeriod(start, cycle), price, plan.currency || 'XAF', dayStr(due), createdBy || 'system'])).rows[0];
}
/** A confirmed payment: mark the invoice paid when covered, and start / extend the subscription. Returns the invoice. */
async function applyPayment(c, paymentId) {
  const p = (await c.query('SELECT * FROM payments WHERE id=$1', [paymentId])).rows[0];
  if (!p || p.status !== 'confirmed' || !p.invoice_id) return null;
  const inv = (await c.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [p.invoice_id])).rows[0];
  if (!inv || inv.status !== 'open') return inv;
  const paid = (await c.query("SELECT coalesce(sum(amount),0)::int AS s FROM payments WHERE invoice_id=$1 AND status='confirmed'", [inv.id])).rows[0].s;
  if (paid < inv.amount) return inv; // part payment: wait for the rest
  const s = await getSub(c, inv.tenant_id); const now = new Date();
  const live = s && ['active', 'past_due', 'cancelled'].includes(s.status) && s.current_period_end && new Date(s.current_period_end) > now && s.plan_id === inv.plan_id;
  const start = live ? new Date(s.current_period_end) : now; const end = addPeriod(start, inv.cycle);
  await c.query("UPDATE invoices SET status='paid', paid_at=now(), period_start=$2, period_end=$3 WHERE id=$1", [inv.id, start, end]);
  await setSub(c, inv.tenant_id, { plan_id: inv.plan_id, cycle: inv.cycle, price: inv.amount, currency: inv.currency, status: 'active', current_period_start: live ? s.current_period_start : start, current_period_end: end, suspended_reason: null });
  return Object.assign({}, inv, { status: 'paid', period_start: start, period_end: end });
}

/* ---------- emails ---------- */
async function ownerOf(c, tid) { return (await c.query("SELECT u.*, t.name AS tenant_name FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.tenant_id=$1 AND u.role='owner' AND u.active ORDER BY u.created_at LIMIT 1", [tid])).rows[0]; }
async function mailOwner(c, tid, kind, tpl, dedupe) {
  const o = await ownerOf(c, tid); const to = mailer.emailOf(o); if (!to) return { status: 'no_email' };
  return mailer.sendEmail(Object.assign({ to, kind, tenantId: tid, dedupe }, tpl(o)));
}
/** Owners/finance admins (and ADMIN_ALERT_EMAIL) for things the platform team must act on. */
async function mailAdmins(c, kind, mail, roles = ['super', 'admin', 'finance']) {
  const to = new Set((await c.query('SELECT email FROM platform_admins WHERE active AND role = ANY($1)', [roles])).rows.map((r) => r.email));
  if (process.env.ADMIN_ALERT_EMAIL) to.add(process.env.ADMIN_ALERT_EMAIL);
  for (const t of to) await mailer.sendEmail(Object.assign({ to: t, kind }, mail));
}
const invoiceMail = (inv, plan, S, url) => (o) => mailer.T.invoiceIssued({ name: o.name, business: o.tenant_name, number: inv.number, plan: plan.name + ' · ' + (inv.cycle === 'yearly' ? 'yearly' : 'monthly'), amount: money(inv.amount, inv.currency), due: dayStr(inv.due_date), period: dayStr(inv.period_start) + ' → ' + dayStr(inv.period_end), pay: S.paymentInstructions, url: url + '/#billing' });

/* ---------- the daily job: trials end, renewals are invoiced, overdue businesses go read-only ---------- */
async function daily(url) {
  const out = { expiredTrials: 0, pastDue: 0, expired: 0, invoices: 0, reminders: 0 };
  const S = await platformSettings();
  const subs = (await q("SELECT s.*, p.name AS plan_name FROM subscriptions s LEFT JOIN plans p ON p.id=s.plan_id WHERE s.status IN ('trialing','active','past_due','cancelled')")).rows;
  const now = Date.now();
  for (const s of subs) {
    const end = s.current_period_end ? new Date(s.current_period_end).getTime() : null; const grace = (Number(s.grace_days) || 7) * 864e5;
    if (s.status === 'trialing' && s.trial_ends_at && new Date(s.trial_ends_at).getTime() <= now) {
      await setSub(pool, s.tenant_id, { status: 'expired' }); out.expiredTrials++;
      await mailOwner(pool, s.tenant_id, 'sub_expired', (o) => mailer.T.subscriptionEnded({ name: o.name, business: o.tenant_name, trial: true, url: url + '/#billing' }), 'expired:' + s.tenant_id + ':trial');
      continue;
    }
    if ((s.status === 'active' || s.status === 'cancelled') && end && end <= now) {
      if (s.status === 'cancelled') { await setSub(pool, s.tenant_id, { status: 'expired' }); out.expired++; continue; }
      await setSub(pool, s.tenant_id, { status: 'past_due' }); out.pastDue++;
    }
    if (s.status === 'past_due' && end && end + grace <= now) {
      await setSub(pool, s.tenant_id, { status: 'expired' }); out.expired++;
      await mailOwner(pool, s.tenant_id, 'sub_expired', (o) => mailer.T.subscriptionEnded({ name: o.name, business: o.tenant_name, trial: false, url: url + '/#billing' }), 'expired:' + s.tenant_id + ':' + dayStr(s.current_period_end));
      continue;
    }
    // renewal invoice a few days before the period ends (once per period)
    if (['active', 'past_due'].includes(s.status) && s.plan_id && end && end - now <= (Number(S.renewalNoticeDays) || 7) * 864e5) {
      const has = (await q("SELECT 1 FROM invoices WHERE tenant_id=$1 AND status <> 'void' AND period_start >= $2::timestamptz - interval '1 day' LIMIT 1", [s.tenant_id, s.current_period_end])).rowCount;
      if (!has) {
        try {
          const inv = await createInvoice(pool, { tid: s.tenant_id, planId: s.plan_id, cycle: s.cycle, createdBy: 'system', periodStart: s.current_period_end, dueDays: Math.max(0, Math.ceil((end - now) / 864e5)) });
          const plan = (await q('SELECT * FROM plans WHERE id=$1', [s.plan_id])).rows[0]; out.invoices++;
          await mailOwner(pool, s.tenant_id, 'invoice', invoiceMail(inv, plan, S, url), 'invoice:' + inv.id);
        } catch (e) { console.error('[billing] renewal invoice', s.tenant_id, e.message); }
      }
    }
  }
  // reminders for open invoices: 3 days before, on the due date, and 3 days after
  const open = (await q("SELECT i.*, p.name AS plan_name FROM invoices i LEFT JOIN plans p ON p.id=i.plan_id WHERE i.status='open'")).rows;
  for (const inv of open) {
    const days = Math.round((new Date(dayStr(inv.due_date) + 'T00:00:00Z').getTime() - new Date(dayStr(new Date()) + 'T00:00:00Z').getTime()) / 864e5);
    if (![3, 0, -3].includes(days)) continue;
    const r = await mailOwner(pool, inv.tenant_id, 'invoice_reminder', (o) => mailer.T.invoiceReminder({ name: o.name, business: o.tenant_name, number: inv.number, amount: money(inv.amount, inv.currency), due: dayStr(inv.due_date), days, pay: S.paymentInstructions, url: url + '/#billing' }), 'invrem:' + inv.id + ':' + days);
    if (r.status === 'sent' || r.status === 'skipped') out.reminders++;
  }
  return out;
}

/* ---------- business side: Billing page ---------- */
function mountTenant(app, { auth, wrap, err, canU, tx, momo }) {
  const may = (u) => ['owner', 'admin'].includes(u.role) || canU(u, 'settings');
  const guard = (req, res, next) => (may(req.user) ? next() : err(res, 403, 'Only the owner or an admin can manage billing'));
  const plansPublic = async () => (await q('SELECT id, name, description, price_monthly, price_yearly, currency, limits, modules, features FROM plans WHERE active AND public ORDER BY sort, name')).rows;
  // (no requireActive: an expired business must still be able to pay)
  app.get('/api/billing', auth, guard, wrap(async (req, res) => {
    const tid = req.user.tenant_id; const s = await getSub(pool, tid); const S = await platformSettings();
    res.json({
      subscription: s && { planId: s.plan_id, planName: s.plan_name, status: s.status, statusLabel: STATUS_LABEL[s.status], cycle: s.cycle, price: s.price, currency: s.currency, trialEndsAt: s.trial_ends_at, periodEnd: s.current_period_end, graceDays: s.grace_days },
      limits: (await limitsFor(pool, tid)).limits, features: (await limitsFor(pool, tid)).features, catalog: KC.FEATURES, usage: await usage(pool, tid), plans: await plansPublic(),
      invoices: (await q('SELECT i.id, i.number, i.plan_id, p.name AS plan_name, i.cycle, i.period_start, i.period_end, i.amount, i.currency, i.status, i.due_date, i.issued_at, i.paid_at, i.created_by FROM invoices i LEFT JOIN plans p ON p.id=i.plan_id WHERE i.tenant_id=$1 ORDER BY i.issued_at DESC LIMIT 36', [tid])).rows,
      payments: (await q('SELECT id, invoice_id, amount, currency, method, reference, paid_on, status, provider, network, phone, failure, CASE WHEN status=\'processing\' THEN checkout_url END AS checkout_url, created_at FROM payments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 36', [tid])).rows,
      momo: momo ? momo.publicInfo() : { enabled: false },
      instructions: S.paymentInstructions, methods: PAY_METHODS, trialDays: FREE_TRIAL_DAYS, trialAvailable: !!s && s.status === 'trialing',
    });
  }));
  // the business picks a plan: an invoice to pay (reuses an open one for the same plan)
  app.post('/api/billing/choose', auth, guard, wrap(async (req, res) => {
    const { planId, cycle } = req.body || {}; const tid = req.user.tenant_id;
    const plan = (await q('SELECT * FROM plans WHERE id=$1 AND active AND public', [planId])).rows[0]; if (!plan) return err(res, 400, 'Choose one of the plans');
    const cyc = cycle === 'yearly' ? 'yearly' : 'monthly';
    if (isFree(plan)) { // Free = the free trial, with this plan's features
      const s = await getSub(pool, tid); const S0 = await platformSettings();
      if (!s || s.status !== 'trialing') return err(res, 400, s && s.plan_id && s.status === 'active' ? 'You already have a paid plan' : 'Your free trial has ended — choose a paid plan to continue');
      const ends = s.trial_ends_at && new Date(s.trial_ends_at) > new Date() ? s.trial_ends_at : new Date(Date.now() + FREE_TRIAL_DAYS * 864e5);
      await tx((c) => setSub(c, tid, { plan_id: plan.id, status: 'trialing', trial_ends_at: ends, price: 0 }));
      return res.json({ trial: true, plan: plan.name, trialEndsAt: ends });
    }
    const existing = (await q("SELECT * FROM invoices WHERE tenant_id=$1 AND status='open' AND plan_id=$2 AND cycle=$3 ORDER BY issued_at DESC LIMIT 1", [tid, planId, cyc])).rows[0];
    if (existing) return res.json({ invoice: existing, reused: true });
    let inv; try { inv = await tx((c) => createInvoice(c, { tid, planId, cycle: cyc, createdBy: 'owner' })); } catch (e) { return err(res, e.status || 500, e.message); }
    const S = await platformSettings();
    await mailOwner(pool, tid, 'invoice', invoiceMail(inv, plan, S, mailer.appUrl(req)), 'invoice:' + inv.id);
    res.json({ invoice: inv });
  }));
  // "I have paid": recorded as pending until the Aahsso team checks it
  app.post('/api/billing/invoices/:id/claim', auth, guard, wrap(async (req, res) => {
    const { method, reference, paidOn } = req.body || {}; const tid = req.user.tenant_id;
    const inv = (await q('SELECT * FROM invoices WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!inv) return err(res, 404, 'Invoice not found'); if (inv.status !== 'open') return err(res, 400, 'This invoice is ' + inv.status);
    if (!PAY_METHODS.includes(method)) return err(res, 400, 'Choose how you paid');
    const ref = String(reference || '').trim().slice(0, 80); if (method !== 'Cash' && ref.length < 4) return err(res, 400, 'Type the transaction reference from your payment message');
    if ((await q("SELECT 1 FROM payments WHERE invoice_id=$1 AND status='pending'", [inv.id])).rowCount) return err(res, 409, 'You already reported a payment for this invoice — we are checking it');
    if ((await q("SELECT 1 FROM payments WHERE invoice_id=$1 AND status='processing'", [inv.id])).rowCount) return err(res, 409, 'A mobile money payment for this invoice is waiting for approval on the phone');
    const on = /^\d{4}-\d{2}-\d{2}$/.test(String(paidOn || '')) ? paidOn : dayStr(new Date());
    let p; try { p = (await q("INSERT INTO payments (tenant_id, invoice_id, amount, currency, method, reference, paid_on, status, claimed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8) RETURNING *", [tid, inv.id, inv.amount, inv.currency, method, ref || null, on, req.user.name])).rows[0]; }
    catch (e) { if (e.code === '23505') return err(res, 409, 'This transaction reference was already used'); throw e; }
    await mailAdmins(pool, 'payment_claim', mailer.T.paymentClaim({ business: req.user.tenant_name, by: req.user.name, number: inv.number, amount: money(inv.amount, inv.currency), method, reference: ref, paidOn: on }));
    res.json({ ok: true, payment: p });
  }));
  app.post('/api/billing/invoices/:id/cancel', auth, guard, wrap(async (req, res) => {
    const inv = (await q("SELECT * FROM invoices WHERE id=$1 AND tenant_id=$2", [req.params.id, req.user.tenant_id])).rows[0];
    if (!inv || inv.status !== 'open' || inv.created_by !== 'owner') return err(res, 400, 'Only an invoice you asked for and have not paid can be cancelled');
    if ((await q("SELECT 1 FROM payments WHERE invoice_id=$1 AND status IN ('pending','processing','confirmed')", [inv.id])).rowCount) return err(res, 400, 'A payment is linked to this invoice');
    await q("UPDATE invoices SET status='void', void_reason='Cancelled by the business' WHERE id=$1", [inv.id]);
    res.json({ ok: true });
  }));
}

module.exports = { FREE_TRIAL_DAYS, isFree, COUNT_LIMITS, FEATURES, LIMIT_KEYS, PAY_METHODS, STATUS_LABEL, DEFAULTS, platformSettings, addPeriod, dayStr, money, invalidate, checkFeature, getSub, ensureSub, syncTenant, setSub, limitsFor, usage, checkLimit, createInvoice, applyPayment, ownerOf, mailOwner, mailAdmins, invoiceMail, daily, mountTenant };
