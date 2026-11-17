// Mobile money (Fapshi) end to end, against a fake Fapshi started here (port 18091). Needs an Aahsso server with:
//   FAPSHI_API_USER=fu_test FAPSHI_API_KEY=fk_test FAPSHI_BASE_URL=http://127.0.0.1:18091 FAPSHI_WEBHOOK_SECRET=wh-secret FAPSHI_SWEEP_DISABLED=true CRON_SECRET=…
//   AAHSSO_URL=http://localhost:8080 DATABASE_URL=… CRON_SECRET=… node --test test/fapshi-api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { Pool } = require('pg');

const B = process.env.AAHSSO_URL || 'http://localhost:8080';
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const rnd = Math.random().toString(36).slice(2, 7);
const SECRET = 'wh-secret';

/* ---------- fake Fapshi ---------- */
const txns = new Map(); const sent = []; const statusCalls = {}; let down = false, loseAnswer = false;
const newId = () => crypto.randomBytes(6).toString('base64url').slice(0, 8);
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.headers.apiuser !== 'fu_test' || req.headers.apikey !== 'fk_test') return send(403, { message: 'Invalid API credentials' });
    if (req.method === 'GET' && body) return send(400, { message: 'GET requests must not have a body' });
    const d = body ? JSON.parse(body) : {};
    if (req.method === 'POST' && (req.url === '/initiate-pay' || req.url === '/direct-pay')) {
      sent.push(Object.assign({ path: req.url }, d));
      if (down) return send(503, { message: 'Service unavailable' });
      if (!Number.isInteger(d.amount) || d.amount < 100) return send(400, { message: 'amount must be an integer of at least 100' });
      if (d.externalId && !/^[a-zA-Z0-9\-_]{1,100}$/.test(d.externalId)) return send(400, { message: 'invalid externalId' });
      if (req.url === '/direct-pay' && d.phone === '670000009') return send(400, { message: 'Invalid phone number' });
      if (req.url === '/direct-pay' && !/^6\d{8}$/.test(String(d.phone))) return send(400, { message: 'phone must be 9 digits' });
      const transId = newId(); const direct = req.url === '/direct-pay';
      txns.set(transId, { transId, status: direct ? 'PENDING' : 'CREATED', medium: direct ? d.medium : undefined, serviceName: 'Aahsso', transType: 'Collection', amount: d.amount, revenue: Math.round(d.amount * 0.97), payerName: d.name, email: d.email, redirectUrl: d.redirectUrl, externalId: d.externalId, userId: d.userId, dateInitiated: new Date().toISOString() });
      if (loseAnswer) return send(502, { message: 'Bad gateway' }); // created at Fapshi, but our server never hears the transId
      return send(200, Object.assign({ message: 'Request successful', transId, dateInitiated: new Date().toISOString() }, direct ? {} : { link: 'https://checkout.fapshi.test/payment/' + transId }));
    }
    let m = /^\/payment-status\/([^/]+)$/.exec(req.url);
    if (req.method === 'GET' && m) { statusCalls[m[1]] = (statusCalls[m[1]] || 0) + 1; const t = txns.get(m[1]); return t ? send(200, t) : send(404, { message: 'Transaction not found' }); }
    m = /^\/transaction\/([^/]+)$/.exec(req.url);
    if (req.method === 'GET' && m) return send(200, [...txns.values()].filter((t) => t.userId === decodeURIComponent(m[1])));
    if (req.method === 'POST' && req.url === '/expire-pay') {
      const t = txns.get(d.transId); if (!t || !['CREATED', 'PENDING'].includes(t.status)) return send(400, { message: 'Link already expired' });
      t.status = 'EXPIRED'; return send(200, t);
    }
    send(404, { message: 'Not found' });
  });
});
const set = (id, patch) => Object.assign(txns.get(id), patch);

async function api(method, p, token, body, headers = {}, base = B) {
  const h = Object.assign({}, headers); if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json';
  const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}
const webhook = (t, secret = SECRET) => api('POST', '/api/fapshi/webhook', null, JSON.stringify(t), Object.assign({ 'content-type': 'application/json' }, secret ? { 'x-wh-secret': secret } : {}));
const cron = () => fetch(B + '/api/cron/reminders', { headers: { Authorization: 'Bearer ' + process.env.CRON_SECRET } }).then((r) => r.json());
/** the page asking for news (the 12-second limit per payment is cleared first, as if time had passed) */
const poll = async (id, token = S.t, base = B) => { await db.query('UPDATE payments SET provider_checked_at=NULL WHERE id=$1', [id]); return (await api('GET', '/api/billing/momo/' + id, token, undefined, {}, base)).body.payment; };
const S = {};
const business = async (tag) => {
  const reg = await api('POST', '/api/auth/register', null, { businessName: 'Momo ' + tag + ' ' + rnd, name: 'Mo Owner', login: tag + rnd, password: 'secret1', email: tag + rnd + '@shop.test' });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  return { t: reg.body.token, tid: (await db.query('SELECT tenant_id FROM users WHERE login=$1', [tag + rnd])).rows[0].tenant_id };
};

test.before(async () => {
  await new Promise((r) => fake.listen(18091, '127.0.0.1', r));
  await db.query("INSERT INTO plans (id, name, price_monthly, price_yearly, active, public, sort) VALUES ('momo-test', 'Momo Test', 15000, 150000, true, true, 99) ON CONFLICT (id) DO UPDATE SET price_monthly=15000, price_yearly=150000, active=true, public=true");
  Object.assign(S, await business('momo'));
});
test.after(async () => { await db.query("UPDATE plans SET public=false WHERE id='momo-test'"); await db.end(); fake.close(); });

const newInvoice = async (cycle = 'monthly', token = S.t) => { const r = await api('POST', '/api/billing/choose', token, { planId: 'momo-test', cycle }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.invoice; };
const pay = (inv, body = {}, token = S.t, base = B) => api('POST', '/api/billing/invoices/' + inv.id + '/momo', token, body, {}, base);
const sub = async (tid = S.tid) => (await db.query('SELECT status, plan_id, current_period_end FROM subscriptions WHERE tenant_id=$1', [tid])).rows[0];
const row = async (id) => (await db.query('SELECT * FROM payments WHERE id=$1', [id])).rows[0];

test('Billing says mobile money is on: MTN and Orange, sandbox', async () => {
  const b = await api('GET', '/api/billing', S.t);
  assert.equal(b.body.momo.enabled, true); assert.equal(b.body.momo.sandbox, true); assert.equal(b.body.momo.direct, undefined);
  assert.deepEqual(b.body.momo.networks.map((n) => n.code), ['mtn', 'orange']);
});

test('number → prompt on the phone → webhook (re-checked) → plan active, exactly once', async () => {
  const inv = await newInvoice(); S.inv1 = inv;
  assert.equal((await pay(inv)).status, 400, 'a number is needed');
  assert.equal((await pay(inv, { phone: '12345' })).status, 400, 'bad number');
  assert.equal((await pay(inv, { phone: '662123456' })).status, 400, 'not MTN or Orange');
  const r = await pay(inv, { phone: '+237 6 99 12 34 56' }); assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = r.body.payment; assert.equal(p.status, 'processing'); assert.equal(p.amount, 15000); assert.equal(p.network, 'orange'); assert.equal(p.phone, '699123456');
  assert.equal(r.body.link, undefined, 'no Fapshi page');
  const req = sent[sent.length - 1];
  assert.equal(req.path, '/direct-pay'); assert.equal(req.phone, '699123456'); assert.equal(req.medium, 'orange money'); assert.equal(req.amount, 15000);
  assert.equal(req.externalId, p.id); assert.equal(req.userId, S.tid); assert.equal(req.email, 'momo' + rnd + '@shop.test'); assert.match(req.message, /invoice/);
  const tr = (await row(p.id)).provider_ref; assert.ok(tr);
  // the same number again soon after: the same prompt, no second charge
  const n = sent.length; const again = await pay(inv, { phone: '699123456' }); assert.equal(again.body.payment.id, p.id); assert.equal(again.body.reused, true); assert.equal(sent.length, n, 'no new Fapshi request');
  assert.equal((await pay(inv, { phone: '677123456' })).status, 409, 'second phone while the first can still approve');
  assert.equal((await api('POST', '/api/billing/invoices/' + inv.id + '/claim', S.t, { method: 'MTN MoMo', reference: 'ABCDEF123' })).status, 409, '"I have paid" while paying');
  assert.equal((await api('POST', '/api/billing/invoices/' + inv.id + '/cancel', S.t)).status, 400, 'cannot cancel while paying');
  // webhooks: wrong / missing secret refused; a forged SUCCESSFUL body does nothing while Fapshi still says PENDING
  assert.equal((await webhook({ transId: tr, status: 'SUCCESSFUL' }, 'wrong')).status, 401);
  assert.equal((await webhook({ transId: tr, status: 'SUCCESSFUL' }, null)).status, 401);
  assert.equal((await webhook({ transId: tr, status: 'SUCCESSFUL', amount: 15000 })).status, 200);
  assert.equal((await row(p.id)).status, 'processing', 'forged body ignored');
  set(tr, { status: 'SUCCESSFUL', financialTransId: 'OM' + rnd, dateConfirmed: new Date().toISOString() });
  assert.equal((await webhook(txns.get(tr))).status, 200);
  const done = await row(p.id); assert.equal(done.status, 'confirmed'); assert.equal(done.provider_txn, 'OM' + rnd); assert.equal(done.method, 'Orange Money');
  const s1 = await sub(); assert.equal(s1.status, 'active'); assert.equal(s1.plan_id, 'momo-test');
  assert.equal((await db.query('SELECT status FROM invoices WHERE id=$1', [inv.id])).rows[0].status, 'paid');
  assert.equal((await poll(p.id)).status, 'confirmed');
  await webhook(txns.get(tr));
  assert.equal((await sub()).current_period_end.toISOString(), s1.current_period_end.toISOString(), 'paid once, extended once');
  const mails = await (await fetch('http://127.0.0.1:18090/_emails')).json();
  assert.ok(mails.some((m) => m.to.includes('momo' + rnd + '@shop.test') && /Payment received/.test(m.subject)), 'receipt emailed');
});

test('status checks stay within Fapshi\'s limit (6 a minute per transaction)', async () => {
  const inv = await newInvoice('yearly'); S.inv2 = inv;
  const r = await pay(inv, { phone: '677123456' }); const tr = (await row(r.body.payment.id)).provider_ref; S.p2 = r.body.payment.id; S.tr2 = tr;
  await db.query('UPDATE payments SET provider_checked_at=NULL WHERE id=$1', [S.p2]);
  const before = statusCalls[tr] || 0;
  for (let i = 0; i < 5; i++) assert.equal((await api('GET', '/api/billing/momo/' + S.p2, S.t)).body.payment.status, 'processing');
  assert.equal((statusCalls[tr] || 0) - before, 1, 'five quick questions from the page, one call to Fapshi');
});

test('expired / declined → plain reason, pay again; another phone allowed once the first prompt is old', async () => {
  set(S.tr2, { status: 'EXPIRED' });
  const st = await poll(S.p2); assert.equal(st.status, 'failed'); assert.match(st.failure, /expired/);
  const r2 = await pay(S.inv2, { phone: '677123456' }); assert.equal(r2.status, 200); assert.notEqual(r2.body.payment.id, S.p2, 'a new attempt');
  set((await row(r2.body.payment.id)).provider_ref, { status: 'FAILED' });
  const f = await poll(r2.body.payment.id); assert.equal(f.status, 'failed'); assert.match(f.failure, /did not go through/);
  const r3 = await pay(S.inv2, { phone: '677123456' }); assert.equal(r3.status, 200);
  await db.query("UPDATE payments SET created_at = now() - interval '11 minutes' WHERE id=$1", [r3.body.payment.id]);
  const r4 = await pay(S.inv2, { phone: '690000000' }); assert.equal(r4.status, 200, JSON.stringify(r4.body)); assert.notEqual(r4.body.payment.id, r3.body.payment.id);
  await db.query("UPDATE payments SET status='failed' WHERE id=$1", [r3.body.payment.id]);
  S.p4 = r4.body.payment.id; S.tr4 = (await row(S.p4)).provider_ref;
});

test('Fapshi reports a different amount → not activated, sent to the Aahsso team (lost webhook found by the daily job)', async () => {
  const before = await sub();
  set(S.tr4, { status: 'SUCCESSFUL', amount: 100 });
  await db.query("UPDATE payments SET created_at = now() - interval '2 minutes', provider_checked_at=NULL WHERE id=$1", [S.p4]); // the sweep only looks at payments older than a minute
  const run = await cron(); assert.ok(run.emails.momo.checked >= 1, JSON.stringify(run.emails.momo));
  const p = await row(S.p4); assert.equal(p.status, 'pending'); assert.match(p.note, /expected 150000/);
  assert.equal((await db.query('SELECT status FROM invoices WHERE id=$1', [S.inv2.id])).rows[0].status, 'open');
  assert.equal((await sub()).current_period_end.toISOString(), before.current_period_end.toISOString());
  await db.query("UPDATE payments SET status='rejected' WHERE id=$1", [S.p4]); // the team rejects the odd one
});

test('Fapshi refuses the number: plain message, nothing left waiting; minimum amount', async () => {
  const r = await pay(S.inv2, { phone: '670000009' }); assert.equal(r.status, 400); assert.match(r.body.error, /Invalid phone/);
  assert.equal((await db.query("SELECT status FROM payments WHERE invoice_id=$1 ORDER BY created_at DESC LIMIT 1", [S.inv2.id])).rows[0].status, 'failed');
  await db.query("UPDATE invoices SET amount=50 WHERE id=$1", [S.inv2.id]);
  const r2 = await pay(S.inv2, { phone: '677123456' }); assert.equal(r2.status, 400); assert.match(r2.body.error, /start at 100/);
  await db.query('UPDATE invoices SET amount=150000 WHERE id=$1', [S.inv2.id]);
});

test('webhook: bad body, unknown transaction', async () => {
  assert.equal((await api('POST', '/api/fapshi/webhook', null, 'not json', { 'content-type': 'application/json', 'x-wh-secret': SECRET })).status, 400);
  assert.equal((await webhook({ transId: '' })).status, 400);
  assert.equal((await webhook({ transId: 'unknown123', status: 'SUCCESSFUL' })).status, 200, 'unknown: acknowledged, nothing happens');
});

test('other businesses cannot see or pay your invoices', async () => {
  const other = await business('other');
  assert.equal((await pay(S.inv2, { phone: '677123456' }, other.t)).status, 404);
  assert.equal((await api('GET', '/api/billing/momo/' + S.p2, other.t)).status, 404);
});

test('answer lost → found again by our id; never received → failed after 30 minutes', async () => {
  const D = await business('direct2'); const inv = await newInvoice('monthly', D.t);
  loseAnswer = true; const r = await pay(inv, { phone: '699123456' }, D.t); loseAnswer = false;
  assert.equal(r.status, 202, 'outcome unknown: keep waiting'); const id = r.body.payment.id;
  assert.equal((await row(id)).provider_ref, null);
  const t = [...txns.values()].find((x) => x.externalId === id); assert.ok(t, 'Fapshi has it');
  set(t.transId, { status: 'SUCCESSFUL', financialTransId: 'OM2' + rnd });
  assert.equal((await poll(id, D.t)).status, 'confirmed', 'found by externalId, then confirmed'); assert.equal((await row(id)).provider_ref, t.transId);
  const inv2 = await newInvoice('yearly', D.t);
  down = true; const r2 = await pay(inv2, { phone: '677123456' }, D.t); down = false; assert.equal(r2.status, 202);
  [...txns.values()].filter((x) => x.externalId === r2.body.payment.id).forEach((x) => txns.delete(x.transId));
  await db.query("UPDATE payments SET created_at = now() - interval '31 minutes' WHERE id=$1", [r2.body.payment.id]);
  const f = await poll(r2.body.payment.id, D.t); assert.equal(f.status, 'failed'); assert.match(f.failure, /never received/);
});

test('a payment left open on the old Fapshi page is closed before paying by phone', async () => {
  const D = await business('legacy'); const inv = await newInvoice('monthly', D.t);
  const tr = 'old' + rnd; txns.set(tr, { transId: tr, status: 'CREATED', amount: 15000, userId: D.tid });
  const old = (await db.query("INSERT INTO payments (tenant_id, invoice_id, amount, currency, method, paid_on, status, provider, provider_ref) VALUES ($1,$2,15000,'XAF','Mobile Money',now()::date,'processing','fapshi',$3) RETURNING id", [D.tid, inv.id, tr])).rows[0].id;
  const r = await pay(inv, { phone: '677123456' }, D.t); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(txns.get(tr).status, 'EXPIRED', 'old page closed at Fapshi'); assert.equal((await row(old)).status, 'failed');
  assert.equal(r.body.payment.network, 'mtn');
});
