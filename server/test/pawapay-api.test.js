// Mobile money (pawaPay) end to end, against a fake pawaPay started here. Needs a Kargo server started with:
//   PAWAPAY_API_TOKEN=pp_test PAWAPAY_BASE_URL=http://127.0.0.1:18091 PAWAPAY_CALLBACK_SECRET=cb-secret PAWAPAY_SWEEP_DISABLED=true CRON_SECRET=…
//   KARGO_URL=http://localhost:8080 DATABASE_URL=… CRON_SECRET=… node --test test/pawapay-api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { Pool } = require('pg');

const B = process.env.KARGO_URL || 'http://localhost:8080';
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const rnd = Math.random().toString(36).slice(2, 7);
const SECRET = 'cb-secret';

/* ---------- fake pawaPay ---------- */
const deposits = new Map(); let down = false; const seen = [];
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.headers.authorization !== 'Bearer pp_test') return send(401, { failureReason: { failureCode: 'AUTHENTICATION_ERROR', failureMessage: 'bad token' } });
    if (req.method === 'POST' && req.url === '/v2/deposits') {
      const d = JSON.parse(body); seen.push(d);
      if (down) return send(503, { error: 'down' });
      const phone = d.payer.accountDetails.phoneNumber;
      if (phone === '237670000009') return send(200, { depositId: d.depositId, status: 'REJECTED', failureReason: { failureCode: 'PAYER_NOT_FOUND', failureMessage: 'not found' } });
      deposits.set(d.depositId, { depositId: d.depositId, status: 'ACCEPTED', amount: d.amount, currency: d.currency, payer: d.payer, created: new Date().toISOString() });
      return send(200, { depositId: d.depositId, status: 'ACCEPTED', created: new Date().toISOString() });
    }
    const m = /^\/v2\/deposits\/([0-9a-f-]{36})$/.exec(req.url);
    if (req.method === 'GET' && m) { const d = deposits.get(m[1]); return d ? send(200, { status: 'FOUND', data: d }) : send(200, { status: 'NOT_FOUND' }); }
    send(404, {});
  });
});
const set = (id, patch) => deposits.set(id, Object.assign(deposits.get(id) || { depositId: id }, patch));

async function api(method, p, token, body, headers = {}) {
  const h = Object.assign({}, headers); if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json';
  const r = await fetch(B + p, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}
const callback = (depositId, extra = {}, token = SECRET) => api('POST', '/api/pawapay/callback' + (token ? '?token=' + token : ''), null, JSON.stringify(Object.assign({ depositId, status: 'COMPLETED', amount: '15000', currency: 'XAF' }, extra)), { 'content-type': 'application/json' });
const cron = () => fetch(B + '/api/cron/reminders', { headers: { Authorization: 'Bearer ' + process.env.CRON_SECRET } }).then((r) => r.json());
const S = {};

test.before(async () => {
  await new Promise((r) => fake.listen(18091, '127.0.0.1', r));
  await db.query("INSERT INTO plans (id, name, price_monthly, price_yearly, active, public, sort) VALUES ('momo-test', 'Momo Test', 15000, 150000, true, true, 99) ON CONFLICT (id) DO UPDATE SET price_monthly=15000, price_yearly=150000, active=true, public=true");
  const reg = await api('POST', '/api/auth/register', null, { businessName: 'Momo Shop ' + rnd, name: 'Mo Owner', login: 'momo' + rnd, password: 'secret1', email: 'momo' + rnd + '@shop.test' });
  assert.equal(reg.status, 200, JSON.stringify(reg.body)); S.t = reg.body.token;
  S.tid = (await db.query('SELECT tenant_id FROM users WHERE login=$1', ['momo' + rnd])).rows[0].tenant_id;
});
test.after(async () => { await db.query("UPDATE plans SET public=false WHERE id='momo-test'"); await db.end(); fake.close(); });

const newInvoice = async (cycle = 'monthly') => { const r = await api('POST', '/api/billing/choose', S.t, { planId: 'momo-test', cycle }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.invoice; };
const pay = (inv, phone = '677123456', network = 'MTN_MOMO_CMR') => api('POST', '/api/billing/invoices/' + inv.id + '/momo', S.t, { phone, network });
const sub = async () => (await db.query('SELECT status, plan_id, current_period_end FROM subscriptions WHERE tenant_id=$1', [S.tid])).rows[0];

test('Billing says mobile money is on, with MTN and Orange', async () => {
  const b = await api('GET', '/api/billing', S.t);
  assert.equal(b.body.momo.enabled, true); assert.equal(b.body.momo.prefix, '237');
  assert.deepEqual(b.body.momo.networks.map((n) => n.code), ['MTN_MOMO_CMR', 'ORANGE_CMR']);
});

test('pay → approve on the phone → callback (re-checked with pawaPay) → plan active, exactly once', async () => {
  const inv = await newInvoice(); S.inv1 = inv;
  assert.equal((await pay(inv, '12345')).status, 400, 'bad number');
  assert.equal((await pay(inv, '677123456', 'NEXTTEL_CMR')).status, 400, 'unknown network');
  const r = await pay(inv); assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = r.body.payment; assert.equal(p.status, 'processing'); assert.equal(p.amount, 15000);
  const sent = seen[seen.length - 1];
  assert.equal(sent.amount, '15000'); assert.equal(sent.currency, 'XAF'); assert.equal(sent.payer.accountDetails.phoneNumber, '237677123456'); assert.equal(sent.payer.accountDetails.provider, 'MTN_MOMO_CMR');
  const dep = (await db.query('SELECT provider_ref FROM payments WHERE id=$1', [p.id])).rows[0].provider_ref; S.dep1 = dep;
  // while waiting: same request reuses the payment, another number is refused (could charge twice), "I have paid" is refused
  const again = await pay(inv); assert.equal(again.body.payment.id, p.id); assert.equal(again.body.reused, true);
  assert.equal((await pay(inv, '699123456', 'ORANGE_CMR')).status, 409, 'second phone while the first can still approve');
  assert.equal((await api('POST', '/api/billing/invoices/' + inv.id + '/claim', S.t, { method: 'MTN MoMo', reference: 'ABCDEF123' })).status, 409);
  assert.equal((await api('POST', '/api/billing/invoices/' + inv.id + '/cancel', S.t)).status, 400, 'cannot cancel while paying');
  // callbacks: wrong secret refused; a forged "COMPLETED" body does nothing while pawaPay still says ACCEPTED
  assert.equal((await callback(dep, {}, 'wrong')).status, 401);
  assert.equal((await callback(dep, {}, null)).status, 401, 'no secret');
  assert.equal((await callback(dep)).status, 200);
  assert.equal((await api('GET', '/api/billing/momo/' + p.id, S.t)).body.payment.status, 'processing', 'forged body ignored');
  // the payer approves
  set(dep, { status: 'COMPLETED', providerTransactionId: 'MP' + rnd });
  assert.equal((await callback(dep)).status, 200);
  const st = (await api('GET', '/api/billing/momo/' + p.id, S.t)).body.payment; assert.equal(st.status, 'confirmed');
  const s1 = await sub(); assert.equal(s1.status, 'active'); assert.equal(s1.plan_id, 'momo-test');
  assert.equal((await db.query('SELECT status FROM invoices WHERE id=$1', [inv.id])).rows[0].status, 'paid');
  // callback again + poll again: no second month
  await callback(dep); await api('GET', '/api/billing/momo/' + p.id, S.t);
  assert.equal((await sub()).current_period_end.toISOString(), s1.current_period_end.toISOString(), 'paid once, extended once');
  const pay1 = (await db.query('SELECT status, provider_txn, method FROM payments WHERE id=$1', [p.id])).rows[0];
  assert.equal(pay1.provider_txn, 'MP' + rnd); assert.equal(pay1.method, 'MTN MoMo');
  const me = await api('GET', '/api/me', S.t); assert.ok(me.status === 200);
  const mails = await (await fetch('http://127.0.0.1:18090/_emails')).json();
  assert.ok(mails.some((m) => m.to.includes('momo' + rnd + '@shop.test') && /Payment received/.test(m.subject)), 'receipt emailed');
});

test('declined on the phone → failed with a plain reason; paying again works', async () => {
  const inv = await newInvoice('yearly'); S.inv2 = inv;
  const r = await pay(inv, '699123456', 'ORANGE_CMR'); assert.equal(r.status, 200);
  const dep = (await db.query('SELECT provider_ref FROM payments WHERE id=$1', [r.body.payment.id])).rows[0].provider_ref;
  assert.equal(seen[seen.length - 1].amount, '150000');
  set(dep, { status: 'FAILED', failureReason: { failureCode: 'INSUFFICIENT_BALANCE', failureMessage: 'x' } });
  const st = (await api('GET', '/api/billing/momo/' + r.body.payment.id, S.t)).body.payment;
  assert.equal(st.status, 'failed'); assert.match(st.failure, /not enough money/);
  const b = await api('GET', '/api/billing', S.t); assert.ok(b.body.payments.some((x) => x.id === st.id && x.status === 'failed' && x.failure));
  const r2 = await pay(inv, '699123456', 'ORANGE_CMR'); assert.equal(r2.status, 200); assert.notEqual(r2.body.payment.id, st.id, 'a new attempt');
  S.p2 = r2.body.payment.id;
});

test('pawaPay reports a different amount → not activated, sent to the Kargo team to check', async () => {
  const dep = (await db.query('SELECT provider_ref FROM payments WHERE id=$1', [S.p2])).rows[0].provider_ref;
  const before = await sub();
  set(dep, { status: 'COMPLETED', amount: '100' });
  await db.query("UPDATE payments SET created_at = now() - interval '2 minutes' WHERE id=$1", [S.p2]); // the sweep only looks at payments older than a minute
  const run = await cron(); assert.ok(run.emails.momo.checked >= 1, JSON.stringify(run.emails.momo)); // lost callback: the daily job finds it
  const p = (await db.query('SELECT status, note FROM payments WHERE id=$1', [S.p2])).rows[0];
  assert.equal(p.status, 'pending'); assert.match(p.note, /expected 150000/);
  assert.equal((await db.query('SELECT status FROM invoices WHERE id=$1', [S.inv2.id])).rows[0].status, 'open');
  assert.equal((await sub()).current_period_end.toISOString(), before.current_period_end.toISOString());
});

test('rejected at once, pawaPay down, and payments pawaPay never received', async () => {
  await db.query("UPDATE payments SET status='rejected' WHERE id=$1", [S.p2]); // the team rejected the odd one
  const inv = S.inv2;
  const rej = await pay(inv, '670000009'); assert.equal(rej.status, 400); assert.match(rej.body.error, /not registered/);
  assert.equal((await db.query("SELECT status FROM payments WHERE invoice_id=$1 ORDER BY created_at DESC LIMIT 1", [inv.id])).rows[0].status, 'failed');
  down = true; const r = await pay(inv); down = false;
  assert.equal(r.status, 202, 'outcome unknown: keep waiting'); assert.equal(r.body.payment.status, 'processing');
  // pawaPay never got it: after 30 minutes it is marked failed
  await db.query("UPDATE payments SET created_at = now() - interval '31 minutes' WHERE id=$1", [r.body.payment.id]);
  await cron();
  const p = (await db.query('SELECT status, failure FROM payments WHERE id=$1', [r.body.payment.id])).rows[0];
  assert.equal(p.status, 'failed'); assert.match(p.failure, /never received/);
});

test('callback: bad body, unknown deposit, changed body with a Content-Digest', async () => {
  assert.equal((await api('POST', '/api/pawapay/callback?token=' + SECRET, null, 'not json', { 'content-type': 'application/json' })).status, 400);
  assert.equal((await api('POST', '/api/pawapay/callback?token=' + SECRET, null, JSON.stringify({ depositId: 'x' }), { 'content-type': 'application/json' })).status, 400);
  assert.equal((await callback(crypto.randomUUID())).status, 200, 'unknown: acknowledged, nothing happens');
  const body = JSON.stringify({ depositId: S.dep1, status: 'COMPLETED' });
  const digest = 'sha-256=:' + crypto.createHash('sha256').update(body + ' ').digest('base64') + ':';
  assert.equal((await api('POST', '/api/pawapay/callback?token=' + SECRET, null, body, { 'content-type': 'application/json', 'content-digest': digest })).status, 401);
});

test('other businesses cannot see or pay your invoices', async () => {
  const other = await api('POST', '/api/auth/register', null, { businessName: 'Other ' + rnd, name: 'Ot', login: 'other' + rnd, password: 'secret1' });
  assert.equal((await api('POST', '/api/billing/invoices/' + S.inv2.id + '/momo', other.body.token, { phone: '677123456', network: 'MTN_MOMO_CMR' })).status, 404);
  const pid = (await db.query("SELECT id FROM payments WHERE tenant_id=$1 AND provider='pawapay' LIMIT 1", [S.tid])).rows[0].id;
  assert.equal((await api('GET', '/api/billing/momo/' + pid, other.body.token)).status, 404);
});
