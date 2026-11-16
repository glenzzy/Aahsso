'use strict';
/**
 * Mobile money (MTN MoMo, Orange Money) through pawaPay — https://docs.pawapay.io (API v2).
 *
 * Flow: the business picks an open invoice → we save a `processing` payment with our own depositId →
 * POST /v2/deposits → the payer approves on their phone with their PIN → pawaPay calls our callback.
 * The callback body is never trusted: we only take its depositId and ask pawaPay for the real status
 * and amount (GET /v2/deposits/{id}). A COMPLETED deposit whose amount and currency match the payment
 * marks it confirmed and starts / extends the subscription (billing.applyPayment), exactly once.
 * A sweep re-checks payments still processing, in case a callback is lost.
 */
const crypto = require('crypto');
const { q, tx, pool } = require('./db');
const B = require('./billing');
const mailer = require('./mailer');

/* ---------- configuration ---------- */
const cfg = () => {
  const sandbox = process.env.PAWAPAY_SANDBOX !== 'false'; // sandbox unless switched off on purpose
  return {
    token: String(process.env.PAWAPAY_API_TOKEN || '').trim(),
    sandbox,
    baseUrl: String(process.env.PAWAPAY_BASE_URL || (sandbox ? 'https://api.sandbox.pawapay.io' : 'https://api.pawapay.io')).replace(/\/+$/, ''),
    callbackSecret: String(process.env.PAWAPAY_CALLBACK_SECRET || '').trim(),
  };
};
const enabled = () => !!cfg().token;

/* Cameroon first. pawaPay "provider" codes; the currency is fixed by the country. */
const COUNTRY = { code: 'CMR', prefix: '237', currency: 'XAF' };
const NETWORKS = [
  { code: 'MTN_MOMO_CMR', label: 'MTN MoMo', method: 'MTN MoMo' },
  { code: 'ORANGE_CMR', label: 'Orange Money', method: 'Orange Money' },
];
const networkOf = (code) => NETWORKS.find((n) => n.code === code) || null;

/** '6 77 12 34 56', '+237677123456', '00237…' → '237677123456' (null when it is not a Cameroon mobile number) */
function normalizePhone(v) {
  let d = String(v || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9) d = COUNTRY.prefix + d;
  return /^2376\d{8}$/.test(d) ? d : null;
}
/** best guess of the network from the number (the payer can still change it) */
function guessNetwork(phone) {
  const n = normalizePhone(phone); if (!n) return null;
  const p3 = Number(n.slice(3, 6)), p2 = Number(n.slice(3, 5));
  if (p2 === 67 || (p3 >= 650 && p3 <= 654) || (p3 >= 680 && p3 <= 683)) return 'MTN_MOMO_CMR';
  if (p2 === 69 || (p3 >= 655 && p3 <= 659) || (p3 >= 686 && p3 <= 689)) return 'ORANGE_CMR';
  return null;
}

/* ---------- plain-language failure messages ---------- */
const MESSAGES = {
  PAYMENT_NOT_APPROVED: 'The payment was not approved on the phone in time. Try again and enter your PIN when asked.',
  INSUFFICIENT_BALANCE: 'There is not enough money on this mobile money account.',
  PAYER_NOT_FOUND: 'This number is not registered for this mobile money network. Check the number and the network.',
  PAYER_LIMIT_REACHED: 'This mobile money account has reached its limit. Contact your network or use another number.',
  WALLET_LIMIT_REACHED: 'This mobile money account has reached its limit. Contact your network or use another number.',
  PAYMENT_IN_PROGRESS: 'Another payment is already waiting on this phone. Approve or cancel it, then try again.',
  PROVIDER_TEMPORARILY_UNAVAILABLE: 'This mobile money network is not answering right now. Try again in a few minutes.',
  INVALID_PHONE_NUMBER: 'This phone number is not valid. Use a Cameroon mobile number, e.g. 6 77 12 34 56.',
  INVALID_PROVIDER: 'Choose MTN MoMo or Orange Money.',
  AMOUNT_OUT_OF_BOUNDS: 'This amount is above or below what the network accepts in one payment.',
  INVALID_AMOUNT: 'This amount cannot be paid by mobile money.',
  INVALID_CURRENCY: 'This currency cannot be paid by mobile money.',
  DEPOSITS_NOT_ALLOWED: 'Mobile money payments are not open yet. Use another way to pay.',
  UNSPECIFIED_FAILURE: 'The payment failed and the network did not say why. Try again.',
  UNKNOWN_ERROR: 'The payment failed. Try again, or use another way to pay.',
  NOT_FOUND: 'The mobile money network never received this payment. Try again.',
};
const friendly = (code, fallback) => MESSAGES[code] || (/AUTH|SIGNATURE|NO_AUTHENTICATION/.test(String(code)) ? 'Mobile money is not set up correctly. Use another way to pay; we have been told.' : fallback || MESSAGES.UNKNOWN_ERROR);

/* ---------- HTTP ---------- */
class PawaPayError extends Error { constructor(msg, status, code) { super(msg); this.status = status; this.code = code; } }
async function call(method, path, body) {
  const c = cfg(); if (!c.token) throw new PawaPayError('Mobile money is not set up', 503, 'NOT_CONFIGURED');
  let r;
  try {
    r = await fetch(c.baseUrl + path, { method, headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  } catch (e) { throw new PawaPayError('Could not reach mobile money: ' + e.message, 503, 'NETWORK'); } // unknown outcome: callers keep the payment processing
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  if (!r.ok) {
    const fr = (j && (j.failureReason || j.rejectionReason)) || {};
    const code = fr.failureCode || fr.rejectionCode || (j && (j.failureCode || j.errorCode)) || 'HTTP_' + r.status;
    console.error('[pawapay]', method, path.replace(/[0-9a-f-]{36}/, ':id'), r.status, code); // no phone numbers or tokens in logs
    throw new PawaPayError(friendly(code, fr.failureMessage), r.status, code);
  }
  return j;
}
/** POST /v2/deposits. Returns { depositId, status: ACCEPTED | REJECTED | DUPLICATE_IGNORED, failureReason? } */
const initiateDeposit = ({ depositId, amount, phone, provider, reference }) => call('POST', '/v2/deposits', {
  depositId, amount: String(Math.round(amount)), currency: COUNTRY.currency,
  payer: { type: 'MMO', accountDetails: { phoneNumber: phone, provider } },
  clientReferenceId: String(reference || '').slice(0, 60) || undefined,
  customerMessage: 'Kargo subscription', // 4–22 characters, shown on the payer's phone
});
/** GET /v2/deposits/{id} → the deposit, or null when pawaPay does not know it */
async function getDeposit(depositId) {
  const r = await call('GET', '/v2/deposits/' + encodeURIComponent(depositId));
  if (!r || r.status === 'NOT_FOUND') return null;
  return r.data || null;
}

/* ---------- callback authenticity ---------- */
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
/** Shared secret (?token= or x-callback-token) when PAWAPAY_CALLBACK_SECRET is set; Content-Digest when pawaPay sends one. */
function verifyCallback({ rawBody, headers, query }) {
  const secret = cfg().callbackSecret;
  if (secret) {
    const given = headers['x-callback-token'] || (query && query.token);
    if (!given || !same(given, secret)) return { ok: false, reason: 'bad token' };
  }
  const digest = headers['content-digest'];
  if (digest) {
    const m = /(sha-512|sha-256)=:([^:]+):/i.exec(String(digest)); if (!m) return { ok: false, reason: 'unsupported digest' };
    const want = crypto.createHash(m[1].toLowerCase() === 'sha-512' ? 'sha512' : 'sha256').update(rawBody || Buffer.alloc(0)).digest('base64');
    if (!same(want, m[2])) return { ok: false, reason: 'digest mismatch' };
  }
  return { ok: true };
}

/* ---------- payments ---------- */
const PAY_COLS = 'id, tenant_id, invoice_id, amount, currency, method, status, provider, provider_ref, network, failure, created_at, decided_at';
/**
 * Bring one local payment in line with pawaPay. Every transition is "only from processing", so the
 * callback and the status poll can race safely: the subscription is extended once.
 */
async function apply(p, dep) {
  if (!p || p.status !== 'processing') return p;
  if (!dep) {
    if (Date.now() - new Date(p.created_at).getTime() > 30 * 60e3) await fail(p, 'NOT_FOUND');
    return reload(p.id);
  }
  if (dep.status === 'COMPLETED') {
    const amountOk = Number(dep.amount) === Number(p.amount) && String(dep.currency || '').toUpperCase() === String(p.currency).toUpperCase();
    if (!amountOk) { // never activate on a different amount: hand it to the Kargo team
      const note = 'Mobile money paid ' + dep.amount + ' ' + dep.currency + ' — expected ' + p.amount + ' ' + p.currency + '. Check before confirming.';
      const r = await q("UPDATE payments SET status='pending', note=$2, provider_txn=$3 WHERE id=$1 AND status='processing' RETURNING id", [p.id, note, dep.providerTransactionId || null]);
      if (r.rowCount) { const t = (await q('SELECT name FROM tenants WHERE id=$1', [p.tenant_id])).rows[0] || {}; await B.mailAdmins(pool, 'payment_claim', mailer.T.paymentClaim({ business: t.name || '', by: 'Mobile money (automatic)', number: '', amount: dep.amount + ' ' + dep.currency, method: p.method, reference: p.provider_ref, paidOn: B.dayStr(new Date()) })).catch(() => {}); }
      return reload(p.id);
    }
    const inv = await tx(async (c) => {
      const won = await c.query("UPDATE payments SET status='confirmed', decided_at=now(), provider_txn=$2, failure=NULL WHERE id=$1 AND status='processing' RETURNING id", [p.id, dep.providerTransactionId || null]);
      if (!won.rowCount) return null; // someone else (callback vs poll) got there first
      return B.applyPayment(c, p.id);
    });
    if (inv && inv.status === 'paid') {
      await B.mailOwner(pool, p.tenant_id, 'payment_received', (o) => mailer.T.paymentReceived({ name: o.name, business: o.tenant_name, number: inv.number, amount: B.money(inv.amount, inv.currency), until: B.dayStr(inv.period_end), url: mailer.appUrl() }), 'paid:' + inv.id).catch((e) => console.error('[pawapay] receipt email', e.message));
    }
    return reload(p.id);
  }
  if (dep.status === 'FAILED') { await fail(p, (dep.failureReason || {}).failureCode, (dep.failureReason || {}).failureMessage); return reload(p.id); }
  return p; // ACCEPTED / SUBMITTED / PROCESSING / IN_RECONCILIATION: still waiting
}
const fail = (p, code, msg) => q("UPDATE payments SET status='failed', decided_at=now(), failure=$2 WHERE id=$1 AND status='processing'", [p.id, friendly(code, msg)]);
const reload = async (id) => (await q('SELECT ' + PAY_COLS + ' FROM payments WHERE id=$1', [id])).rows[0];

/** ask pawaPay about one processing payment and apply the answer (network problems leave it processing) */
async function refresh(p) {
  if (!p || p.status !== 'processing' || p.provider !== 'pawapay' || !enabled()) return p;
  let dep; try { dep = await getDeposit(p.provider_ref); } catch (e) { return p; }
  return apply(p, dep);
}
/** lost callbacks: re-check payments still processing (every few minutes, and in the daily job) */
async function sweep() {
  if (!enabled()) return { checked: 0 };
  const rows = (await q("SELECT " + PAY_COLS + " FROM payments WHERE provider='pawapay' AND status='processing' AND created_at < now() - interval '1 minute' AND created_at > now() - interval '7 days' ORDER BY created_at LIMIT 100")).rows;
  let done = 0; for (const p of rows) { const after = await refresh(p).catch(() => p); if (after && after.status !== 'processing') done++; }
  return { checked: rows.length, settled: done };
}
function startSweeper() {
  if (process.env.PAWAPAY_SWEEP_DISABLED === 'true') return;
  const tick = () => sweep().catch((e) => console.error('[pawapay] sweep', e.message));
  setInterval(tick, 5 * 60e3).unref(); setTimeout(tick, 45e3).unref();
}

/* ---------- routes ---------- */
function mount(app, { auth, wrap, err, guard, express }) {
  // pawaPay → us. Raw body (for Content-Digest); always re-query before acting. Non-2xx makes pawaPay retry.
  app.post('/api/pawapay/callback', express.raw({ type: '*/*', limit: '64kb' }), wrap(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const ok = verifyCallback({ rawBody: raw, headers: req.headers, query: req.query });
    if (!ok.ok) { console.warn('[pawapay] callback refused:', ok.reason); return res.status(401).json({ error: 'Unauthorized' }); }
    let body; try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }
    if (body && body.refundId) return res.json({ received: true });
    const depositId = body && typeof body.depositId === 'string' ? body.depositId : '';
    if (!/^[0-9a-f-]{36}$/i.test(depositId)) return res.status(400).json({ error: 'Invalid payload' });
    const p = (await q('SELECT ' + PAY_COLS + " FROM payments WHERE provider='pawapay' AND provider_ref=$1", [depositId])).rows[0];
    if (!p) return res.json({ received: true }); // not ours: acknowledge
    let dep; try { dep = await getDeposit(depositId); } catch (e) { return res.status(502).json({ error: 'Could not check the deposit' }); }
    if (dep && dep.depositId && dep.depositId !== depositId) return res.json({ received: true });
    await apply(p, dep);
    res.json({ received: true });
  }));

  // the business pays an open invoice with mobile money
  app.post('/api/billing/invoices/:id/momo', auth, guard, wrap(async (req, res) => {
    if (!enabled()) return err(res, 503, 'Mobile money payments are not available yet — use another way to pay');
    const tid = req.user.tenant_id; const b = req.body || {};
    const inv = (await q('SELECT * FROM invoices WHERE id::text=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!inv) return err(res, 404, 'Invoice not found'); if (inv.status !== 'open') return err(res, 400, 'This invoice is ' + (inv.status === 'paid' ? 'already paid' : 'cancelled'));
    if (String(inv.currency || 'XAF') !== COUNTRY.currency) return err(res, 400, 'This invoice cannot be paid by mobile money');
    const phone = normalizePhone(b.phone); if (!phone) return err(res, 400, MESSAGES.INVALID_PHONE_NUMBER);
    const net = networkOf(b.network); if (!net) return err(res, 400, MESSAGES.INVALID_PROVIDER);
    if ((await q("SELECT 1 FROM payments WHERE invoice_id=$1 AND status='pending'", [inv.id])).rowCount) return err(res, 409, 'You already reported a payment for this invoice — we are checking it');
    const paid = (await q("SELECT coalesce(sum(amount),0)::int AS s FROM payments WHERE invoice_id=$1 AND status='confirmed'", [inv.id])).rows[0].s;
    const due = inv.amount - paid; if (!(due > 0)) return err(res, 400, 'Nothing left to pay on this invoice');
    // one payment at a time per invoice: reuse a recent one still waiting for the PIN
    const live = (await q('SELECT ' + PAY_COLS + ", phone FROM payments WHERE invoice_id=$1 AND provider='pawapay' AND status='processing' ORDER BY created_at DESC LIMIT 1", [inv.id])).rows[0];
    if (live) {
      const fresh = await refresh(live);
      if (fresh && fresh.status === 'processing') {
        // the first request could still be approved: a second one now could charge twice
        const age = Date.now() - new Date(live.created_at).getTime();
        if (age < 10 * 60e3) {
          if (live.phone === phone && live.network === net.code && age < 3 * 60e3) return res.json({ payment: view(fresh), reused: true });
          return err(res, 409, 'A payment for this invoice is waiting for approval on ' + live.phone.replace(/^237/, '') + '. Approve it on that phone, or try again in a few minutes.');
        }
      }
      if (fresh && fresh.status === 'confirmed') return res.json({ payment: view(fresh) });
    }
    const depositId = crypto.randomUUID();
    const p = (await q("INSERT INTO payments (tenant_id, invoice_id, amount, currency, method, reference, paid_on, status, provider, provider_ref, phone, network, claimed_by) VALUES ($1,$2,$3,$4,$5,NULL,$6,'processing','pawapay',$7,$8,$9,$10) RETURNING " + PAY_COLS,
      [tid, inv.id, due, COUNTRY.currency, net.method, B.dayStr(new Date()), depositId, phone, net.code, req.user.name])).rows[0];
    let r;
    try { r = await initiateDeposit({ depositId, amount: due, phone, provider: net.code, reference: inv.number }); }
    catch (e) {
      if (e.code === 'NETWORK' || e.status >= 500) return res.status(202).json({ payment: view(p), message: 'We are waiting for the mobile money network. If your phone asks for your PIN, approve the payment.' }); // outcome unknown: the sweep settles it
      await fail(p, e.code, e.message); return err(res, 400, e.message);
    }
    if (r && r.status === 'REJECTED') { const fr = r.failureReason || r.rejectionReason || {}; await fail(p, fr.failureCode || fr.rejectionCode, fr.failureMessage || fr.rejectionMessage); return err(res, 400, friendly(fr.failureCode || fr.rejectionCode, fr.failureMessage)); }
    res.json({ payment: view(p) });
  }));

  // the Billing page asks while the payer approves on their phone
  app.get('/api/billing/momo/:paymentId', auth, guard, wrap(async (req, res) => {
    const p = (await q('SELECT ' + PAY_COLS + " FROM payments WHERE id::text=$1 AND tenant_id=$2 AND provider='pawapay'", [req.params.paymentId, req.user.tenant_id])).rows[0];
    if (!p) return err(res, 404, 'Payment not found');
    const after = await refresh(p);
    res.json({ payment: view(after) });
  }));
}
const view = (p) => p && { id: p.id, invoiceId: p.invoice_id, amount: p.amount, currency: p.currency, method: p.method, network: p.network, status: p.status, failure: p.failure || null, createdAt: p.created_at };
/** what the Billing page needs to show the mobile money form */
const publicInfo = () => ({ enabled: enabled(), sandbox: enabled() && cfg().sandbox, networks: NETWORKS.map(({ code, label }) => ({ code, label })), prefix: COUNTRY.prefix });

module.exports = { enabled, cfg, NETWORKS, normalizePhone, guessNetwork, friendly, verifyCallback, initiateDeposit, getDeposit, apply, refresh, sweep, startSweeper, mount, publicInfo, PawaPayError };
