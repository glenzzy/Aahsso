'use strict';
/**
 * Mobile money (MTN MoMo, Orange Money) through Fapshi — https://docs.fapshi.com/en
 *
 * Payments happen in Aahsso's own Pay window: the payer types their number, we call POST /direct-pay and
 * they approve the prompt on their phone with their PIN. Fapshi's hosted payment page is not used.
 * Live accounts: Fapshi must activate Direct Pay first (sandbox works straight away).
 *
 * Fapshi has no idempotency key and gives the transaction id (transId) only in its answer, so we save
 * the payment first (our id is sent as externalId, the business as userId), then store the transId.
 * If the answer is lost, GET /transaction/{userId} finds it again by externalId.
 * The webhook body is never trusted: we take its transId and ask GET /payment-status/{transId}.
 * Fapshi sends each webhook once and never retries, so a sweep re-checks payments still waiting.
 * A SUCCESSFUL transaction for exactly the expected amount confirms the payment and starts / extends
 * the subscription (billing.applyPayment), exactly once.
 */
const crypto = require('crypto');
const { q, tx, pool } = require('./db');
const B = require('./billing');
const mailer = require('./mailer');

/* ---------- configuration ---------- */
const cfg = () => {
  const sandbox = process.env.FAPSHI_SANDBOX !== 'false'; // sandbox unless switched off on purpose
  return {
    apiUser: String(process.env.FAPSHI_API_USER || '').trim(),
    apiKey: String(process.env.FAPSHI_API_KEY || '').trim(),
    sandbox,
    baseUrl: String(process.env.FAPSHI_BASE_URL || (sandbox ? 'https://sandbox.fapshi.com' : 'https://live.fapshi.com')).replace(/\/+$/, ''),
    webhookSecret: String(process.env.FAPSHI_WEBHOOK_SECRET || '').trim(),
  };
};
const enabled = () => { const c = cfg(); return !!(c.apiUser && c.apiKey); };

const CURRENCY = 'XAF'; const MIN_AMOUNT = 100; const PREFIX = '237';
/* Fapshi "medium" values */
const NETWORKS = [
  { code: 'mtn', label: 'MTN MoMo', medium: 'mobile money' },
  { code: 'orange', label: 'Orange Money', medium: 'orange money' },
];
const networkOf = (code) => NETWORKS.find((n) => n.code === code) || null;
const networkOfMedium = (m) => NETWORKS.find((n) => n.medium === String(m || '').toLowerCase()) || null;

/** '6 77 12 34 56', '+237677123456', '00237…' → '677123456' (null when it is not a Cameroon mobile number) */
function normalizePhone(v) {
  let d = String(v || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 12 && d.startsWith(PREFIX)) d = d.slice(3);
  return /^6\d{8}$/.test(d) ? d : null;
}
/** the network from the number (MTN or Orange prefixes) */
function guessNetwork(phone) {
  const n = normalizePhone(phone); if (!n) return null;
  const p2 = Number(n.slice(0, 2)), p3 = Number(n.slice(0, 3));
  if (p2 === 67 || (p3 >= 650 && p3 <= 654) || (p3 >= 680 && p3 <= 683)) return 'mtn';
  if (p2 === 69 || (p3 >= 655 && p3 <= 659) || (p3 >= 686 && p3 <= 689)) return 'orange';
  return null;
}

/* ---------- plain-language messages ---------- */
const MSG = {
  FAILED: 'The payment did not go through — it was declined, cancelled, or not approved in time. Check your balance and try again.',
  EXPIRED: 'The payment request expired before it was approved. Try again.',
  NOT_FOUND: 'Fapshi never received this payment. Try again.',
  PHONE: 'This phone number is not valid. Use a Cameroon mobile number, e.g. 6 77 12 34 56.',
  NETWORK: 'Choose MTN MoMo or Orange Money.',
  SETUP: 'Mobile money is not set up correctly. Use another way to pay; we have been told.',
  DOWN: 'Fapshi is not answering right now. Try again in a few minutes, or use another way to pay.',
};
/** a Fapshi 4xx message for the payer (credentials / IP problems never show technical text) */
const friendly = (status, message) => {
  if (status === 401 || status === 403 || /credential|api ?key|api ?user|whitelist/i.test(String(message || ''))) return MSG.SETUP;
  if (status === 429) return 'Too many tries. Wait a minute and try again.';
  return message ? String(message).slice(0, 200) : 'The payment could not be started. Try again, or use another way to pay.';
};

/* ---------- HTTP ---------- */
class FapshiError extends Error { constructor(msg, status, code) { super(msg); this.status = status; this.code = code; } }
async function call(method, path, body) {
  const c = cfg(); if (!c.apiUser || !c.apiKey) throw new FapshiError('Mobile money is not set up', 503, 'NOT_CONFIGURED');
  let r;
  try {
    r = await fetch(c.baseUrl + path, { method, headers: Object.assign({ apiuser: c.apiUser, apikey: c.apiKey, Accept: 'application/json' }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  } catch (e) { throw new FapshiError(MSG.DOWN, 503, 'NETWORK'); } // outcome unknown: callers keep the payment waiting
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  if (!r.ok) {
    const m = j && typeof j.message === 'string' ? j.message : '';
    console.error('[fapshi]', method, path.replace(/^(\/(?:payment-status|transaction)\/).+$/, '$1:id'), r.status, m.slice(0, 120)); // no phone numbers or keys in logs
    if (r.status === 403 && path === '/direct-pay') console.error('[fapshi] Direct Pay is not activated on this Fapshi account (' + (c.sandbox ? 'sandbox' : 'live') + '). Ask Fapshi to activate it: https://www.fapshi.com/en/help-and-support/how-to-activate-direct-pay-for-your-fapshi-api');
    throw new FapshiError(r.status >= 500 ? MSG.DOWN : friendly(r.status, m), r.status, r.status >= 500 ? 'SERVER' : 'HTTP_' + r.status);
  }
  return j;
}
/** POST /direct-pay → { transId } (a prompt is sent to the phone) */
const directPay = ({ amount, phone, medium, name, email, externalId, userId, message }) =>
  call('POST', '/direct-pay', { amount: Math.round(amount), phone, medium, name: name || undefined, email: email || undefined, externalId, userId, message });
/** GET /payment-status/{transId} → the transaction, or null when Fapshi does not know it */
async function getStatus(transId) {
  try { return await call('GET', '/payment-status/' + encodeURIComponent(transId)); }
  catch (e) { if (e.status === 404) return null; throw e; }
}
/** GET /transaction/{userId} → find our payment by externalId (when the answer to direct-pay was lost) */
async function findByExternalId(userId, externalId) {
  const list = await call('GET', '/transaction/' + encodeURIComponent(userId));
  return (Array.isArray(list) ? list : []).find((t) => t && t.externalId === externalId) || null;
}
const expirePay = (transId) => call('POST', '/expire-pay', { transId });

/* ---------- webhook authenticity ---------- */
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
/** the static secret Fapshi sends in x-wh-secret, when FAPSHI_WEBHOOK_SECRET is set (the status is re-checked anyway) */
function verifyWebhook(headers) {
  const secret = cfg().webhookSecret; if (!secret) return true;
  const given = headers['x-wh-secret']; return !!given && same(given, secret);
}

/* ---------- payments ---------- */
const PAY_COLS = 'id, tenant_id, invoice_id, amount, currency, method, status, provider, provider_ref, network, phone, failure, created_at, decided_at';
const reload = async (id) => (await q('SELECT ' + PAY_COLS + ' FROM payments WHERE id=$1', [id])).rows[0];
const fail = (p, msg) => q("UPDATE payments SET status='failed', decided_at=now(), failure=$2 WHERE id=$1 AND status='processing'", [p.id, msg]);
/** tell the business's open apps that a payment moved on (set by the server: the live stream) — the Pay window updates at once */
const settled = (p, after) => { if (after && after.status !== 'processing' && typeof module.exports.onSettled === 'function') { try { module.exports.onSettled(p.tenant_id, after); } catch (e) { /* never block a payment */ } } return after; };
/** the last webhook Fapshi sent us, for the admin's Health page (is the webhook URL set and the secret right?) */
const noteWebhook = (ok, why) => q("INSERT INTO platform_settings (key, value) VALUES ('fapshiWebhook', $1) ON CONFLICT (key) DO UPDATE SET value = platform_settings.value || EXCLUDED.value, updated_at=now()",
  [JSON.stringify(ok ? { lastOkAt: new Date().toISOString() } : { lastRefusedAt: new Date().toISOString(), lastRefusedWhy: why })]).catch(() => {});

/**
 * Bring one local payment in line with Fapshi's transaction. Every change is "only from processing",
 * so the webhook, the page asking and the sweep can race safely: the subscription is extended once.
 */
async function apply(p, t) { return settled(p, await applyOne(p, t)); }
async function applyOne(p, t) {
  if (!p || p.status !== 'processing') return p;
  if (!t) {
    if (Date.now() - new Date(p.created_at).getTime() > 30 * 60e3) await fail(p, MSG.NOT_FOUND);
    return reload(p.id);
  }
  if (t.externalId && t.externalId !== p.id) return p; // not this payment
  const net = networkOfMedium(t.medium);
  if (t.status === 'SUCCESSFUL') {
    if (Number(t.amount) !== Number(p.amount)) { // never activate on a different amount: hand it to the Aahsso team
      const note = 'Mobile money paid ' + t.amount + ' ' + CURRENCY + ' — expected ' + p.amount + ' ' + p.currency + '. Check before confirming.';
      const r = await q("UPDATE payments SET status='pending', note=$2, provider_txn=$3 WHERE id=$1 AND status='processing' RETURNING id", [p.id, note, t.financialTransId || null]);
      if (r.rowCount) { const tn = (await q('SELECT name FROM tenants WHERE id=$1', [p.tenant_id])).rows[0] || {}; await B.mailAdmins(pool, 'payment_claim', mailer.T.paymentClaim({ business: tn.name || '', by: 'Mobile money (automatic)', number: '', amount: t.amount + ' ' + CURRENCY, method: p.method, reference: t.transId || p.provider_ref, paidOn: B.dayStr(new Date()) })).catch(() => {}); }
      return reload(p.id);
    }
    const inv = await tx(async (c) => {
      const won = await c.query("UPDATE payments SET status='confirmed', decided_at=now(), provider_txn=$2, failure=NULL, method=coalesce($3, method), network=coalesce($4, network) WHERE id=$1 AND status='processing' RETURNING id",
        [p.id, t.financialTransId || null, net ? net.label : null, net ? net.code : null]);
      if (!won.rowCount) return null; // someone else (webhook vs page vs sweep) got there first
      return B.applyPayment(c, p.id);
    });
    if (inv && inv.status === 'paid') {
      await B.mailOwner(pool, p.tenant_id, 'payment_received', (o) => mailer.T.paymentReceived({ name: o.name, business: o.tenant_name, number: inv.number, amount: B.money(inv.amount, inv.currency), until: B.dayStr(inv.period_end), url: mailer.appUrl() }), 'paid:' + inv.id).catch((e) => console.error('[fapshi] receipt email', e.message));
    }
    return reload(p.id);
  }
  if (t.status === 'FAILED' || t.status === 'EXPIRED') { await fail(p, MSG[t.status]); return reload(p.id); }
  return p; // CREATED / PENDING: still waiting
}

/**
 * Ask Fapshi about one waiting payment and apply the answer (problems reaching Fapshi leave it waiting).
 * Fapshi allows 6 status checks a minute per transaction, so a payment is checked at most every 12 s
 * (across all server instances: the database decides) unless `force` (the webhook).
 */
async function refresh(p, { force } = {}) {
  if (!p || p.status !== 'processing' || p.provider !== 'fapshi' || !enabled()) return p;
  if (!force) {
    const go = await q("UPDATE payments SET provider_checked_at=now() WHERE id=$1 AND (provider_checked_at IS NULL OR provider_checked_at < now() - interval '12 seconds') RETURNING id", [p.id]);
    if (!go.rowCount) return p;
  } else await q('UPDATE payments SET provider_checked_at=now() WHERE id=$1', [p.id]);
  try {
    if (!p.provider_ref) { // the answer to direct-pay never arrived: look it up by our id
      const t = await findByExternalId(p.tenant_id, p.id);
      if (t && t.transId) { await q('UPDATE payments SET provider_ref=$2 WHERE id=$1 AND provider_ref IS NULL', [p.id, t.transId]); p = Object.assign({}, p, { provider_ref: t.transId }); }
      return apply(p, t);
    }
    return apply(p, await getStatus(p.provider_ref));
  } catch (e) { return p; }
}
/** lost webhooks (Fapshi never retries): re-check payments still waiting — every few minutes, and in the daily job */
async function sweep() {
  if (!enabled()) return { checked: 0 };
  const rows = (await q("SELECT " + PAY_COLS + " FROM payments WHERE provider='fapshi' AND status='processing' AND created_at < now() - interval '1 minute' AND created_at > now() - interval '7 days' ORDER BY created_at LIMIT 100")).rows;
  let done = 0; for (const p of rows) { const after = await refresh(p).catch(() => p); if (after && after.status !== 'processing') done++; }
  // still unknown after a week: closed here
  await q("UPDATE payments SET status='failed', decided_at=now(), failure=$1 WHERE provider='fapshi' AND status='processing' AND created_at <= now() - interval '7 days'", [MSG.EXPIRED]);
  return { checked: rows.length, settled: done };
}
function startSweeper() {
  if (process.env.FAPSHI_SWEEP_DISABLED === 'true') return;
  const tick = () => sweep().catch((e) => console.error('[fapshi] sweep', e.message));
  setInterval(tick, 5 * 60e3).unref(); setTimeout(tick, 45e3).unref();
}

/* ---------- routes ---------- */
function mount(app, { auth, wrap, err, guard }) {
  // Fapshi → us when a transaction becomes SUCCESSFUL, FAILED or EXPIRED. Sent once, never retried:
  // answer 200 quickly; the status is always asked again before anything changes.
  app.post('/api/fapshi/webhook', wrap(async (req, res) => {
    if (!verifyWebhook(req.headers)) { console.warn('[fapshi] webhook refused: bad secret'); await noteWebhook(false, req.headers['x-wh-secret'] ? 'The secret Fapshi sent does not match FAPSHI_WEBHOOK_SECRET' : 'Fapshi sent no secret: set the same secret on the Fapshi dashboard, or remove FAPSHI_WEBHOOK_SECRET'); return res.status(401).json({ error: 'Unauthorized' }); }
    await noteWebhook(true);
    const b = req.body || {}; const transId = typeof b.transId === 'string' ? b.transId : '';
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(transId)) return res.status(400).json({ error: 'Invalid payload' });
    let p = (await q('SELECT ' + PAY_COLS + " FROM payments WHERE provider='fapshi' AND provider_ref=$1", [transId])).rows[0];
    if (!p && typeof b.externalId === 'string' && /^[0-9a-f-]{36}$/i.test(b.externalId)) { // the answer to direct-pay was lost: our id is the externalId
      p = (await q('SELECT ' + PAY_COLS + " FROM payments WHERE provider='fapshi' AND id::text=$1 AND provider_ref IS NULL", [b.externalId])).rows[0];
      if (p) { await q('UPDATE payments SET provider_ref=$2 WHERE id=$1 AND provider_ref IS NULL', [p.id, transId]); p.provider_ref = transId; }
    }
    if (!p) return res.json({ received: true }); // not ours: acknowledge
    // check before answering (on serverless hosts work after the answer may never run); Fapshi does not retry,
    // so a failure here still answers 200 and the sweep settles the payment later
    try { await q('UPDATE payments SET provider_checked_at=now() WHERE id=$1', [p.id]); await apply(p, await getStatus(transId)); }
    catch (e) { console.error('[fapshi] webhook check', e.message); }
    res.json({ received: true });
  }));

  // the business pays an open invoice with mobile money
  app.post('/api/billing/invoices/:id/momo', auth, guard, wrap(async (req, res) => {
    if (!enabled()) return err(res, 503, 'Mobile money payments are not available yet — use another way to pay');
    const tid = req.user.tenant_id; const b = req.body || {};
    const inv = (await q('SELECT * FROM invoices WHERE id::text=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!inv) return err(res, 404, 'Invoice not found'); if (inv.status !== 'open') return err(res, 400, 'This invoice is ' + (inv.status === 'paid' ? 'already paid' : 'cancelled'));
    if (String(inv.currency || CURRENCY) !== CURRENCY) return err(res, 400, 'This invoice cannot be paid by mobile money');
    const phone = normalizePhone(b.phone); if (!phone) return err(res, 400, MSG.PHONE);
    const net = networkOf(b.network) || networkOf(guessNetwork(phone)); if (!net) return err(res, 400, MSG.NETWORK);
    if ((await q("SELECT 1 FROM payments WHERE invoice_id=$1 AND status='pending'", [inv.id])).rowCount) return err(res, 409, 'You already reported a payment for this invoice — we are checking it');
    const paid = (await q("SELECT coalesce(sum(amount),0)::int AS s FROM payments WHERE invoice_id=$1 AND status='confirmed'", [inv.id])).rows[0].s;
    const due = inv.amount - paid; if (!(due > 0)) return err(res, 400, 'Nothing left to pay on this invoice');
    if (due < MIN_AMOUNT) return err(res, 400, 'Mobile money payments start at ' + MIN_AMOUNT + ' FCFA — use another way to pay');

    // one payment at a time per invoice
    const live = (await q('SELECT ' + PAY_COLS + ", provider_checked_at FROM payments WHERE invoice_id=$1 AND provider='fapshi' AND status='processing' ORDER BY created_at DESC LIMIT 1", [inv.id])).rows[0];
    if (live) {
      const fresh = await refresh(live);
      if (fresh && fresh.status === 'confirmed') return res.json({ payment: view(fresh) });
      if (fresh && fresh.status === 'processing') {
        const age = Date.now() - new Date(live.created_at).getTime();
        if (!live.phone) { // left over from Fapshi's payment page (no longer used): close it before starting again
          if (live.provider_ref) { try { await expirePay(live.provider_ref); } catch (e) { if (e.status !== 400) return err(res, 409, 'The last payment is still open. Try again in a few minutes.'); } }
          await fail(live, MSG.EXPIRED);
        } else if (age < 10 * 60e3) { // a prompt on a phone could still be approved: a second one now could charge twice
          if (live.phone === phone && live.network === net.code && age < 3 * 60e3) return res.json({ payment: view(fresh), reused: true });
          return err(res, 409, 'A payment for this invoice is waiting for approval on ' + live.phone + '. Approve it on that phone, or try again in a few minutes.');
        }
      }
    }

    const owner = (await q("SELECT email FROM users WHERE id=$1", [req.user.id])).rows[0] || {};
    const email = mailer.isEmail(owner.email) ? owner.email : undefined;
    const method = net.label;
    const p = (await q("INSERT INTO payments (tenant_id, invoice_id, amount, currency, method, reference, paid_on, status, provider, phone, network, claimed_by) VALUES ($1,$2,$3,$4,$5,NULL,$6,'processing','fapshi',$7,$8,$9) RETURNING " + PAY_COLS,
      [tid, inv.id, due, CURRENCY, method, B.dayStr(new Date()), phone, net.code, req.user.name])).rows[0];
    const common = { amount: due, externalId: p.id, userId: tid, message: 'Aahsso subscription — invoice ' + inv.number, email };
    let r;
    try {
      r = await directPay(Object.assign({ phone, medium: net.medium, name: req.user.name }, common));
    } catch (e) {
      console.warn('[fapshi] direct-pay not started', e.status || '', e.code || '', String(e.message || '').slice(0, 120));
      if (e.code === 'NETWORK' || e.code === 'SERVER') { // outcome unknown: the sweep finds it by our id
        return res.status(202).json({ payment: view(p), message: 'We are waiting for Fapshi. If your phone asks for your PIN, approve the payment.' });
      }
      await fail(p, e.message); return err(res, 400, e.message);
    }
    if (!r || !r.transId) { await fail(p, 'The payment could not be started. Try again.'); return err(res, 502, 'The payment could not be started. Try again, or use another way to pay.'); }
    const saved = (await q('UPDATE payments SET provider_ref=$2 WHERE id=$1 RETURNING ' + PAY_COLS, [p.id, r.transId])).rows[0];
    res.json({ payment: view(saved) });
  }));

  // the Billing page asks while the payer pays
  app.get('/api/billing/momo/:paymentId', auth, guard, wrap(async (req, res) => {
    const p = (await q('SELECT ' + PAY_COLS + " FROM payments WHERE id::text=$1 AND tenant_id=$2 AND provider='fapshi'", [req.params.paymentId, req.user.tenant_id])).rows[0];
    if (!p) return err(res, 404, 'Payment not found');
    res.json({ payment: view(await refresh(p)) });
  }));
}
const view = (p) => p && { id: p.id, invoiceId: p.invoice_id, amount: p.amount, currency: p.currency, method: p.method, network: p.network, status: p.status, failure: p.failure || null, phone: p.phone || null, createdAt: p.created_at };
/** what the Billing page needs to show the mobile money form */
const publicInfo = () => { const c = cfg(); return { enabled: enabled(), sandbox: enabled() && c.sandbox, networks: NETWORKS.map(({ code, label }) => ({ code, label })), prefix: PREFIX, min: MIN_AMOUNT }; };

module.exports = { onSettled: null, enabled, cfg, NETWORKS, normalizePhone, guessNetwork, friendly, verifyWebhook, directPay, getStatus, findByExternalId, expirePay, apply, refresh, sweep, startSweeper, mount, publicInfo, FapshiError, MSG };
