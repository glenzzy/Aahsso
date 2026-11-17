// Email (Resend) integration tests. Needs a running server pointed at a mock Resend API that records emails:
//   RESEND_API_KEY=re_test RESEND_API_URL=http://127.0.0.1:18090 APP_URL=http://app.test node src/index.js
//   AAHSSO_URL=http://localhost:8080 MOCK_RESEND=http://127.0.0.1:18090 node --test test/email.test.js
// The mock answers POST /emails, lists what it got at GET /_emails, and POST /_fail toggles failures.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = process.env.AAHSSO_URL || 'http://localhost:8080';
const M = process.env.MOCK_RESEND || 'http://127.0.0.1:18090';
const rnd = Math.random().toString(36).slice(2, 8);

async function call(method, path, token, body, extra = {}) {
  const headers = Object.assign({}, extra); if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(B + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const mails = async () => (await fetch(M + '/_emails')).json();
const mailsTo = async (to) => (await mails()).filter((m) => m.to.includes(to));
const S = {};

test('owner sign-up: welcome email', async () => {
  const r = await call('POST', '/api/auth/register', null, { businessName: 'Mail Shop ' + rnd, name: 'Ada', login: 'ada' + rnd + '@shop.test', password: 'secret1' });
  assert.equal(r.status, 200); S.owner = r.body.token;
  const m = await mailsTo('ada' + rnd + '@shop.test');
  assert.equal(m.length, 1); assert.match(m[0].subject, /welcome/i);
  assert.equal(m[0]._auth, 'Bearer re_test_key'); assert.match(m[0].from, /no-reply@mail\.test/);
  assert.ok(m[0].html.includes('http://app.test'), 'link to the app'); assert.ok(m[0].text, 'plain-text part');
  // a phone login with a separate email address
  const r2 = await call('POST', '/api/auth/register', null, { businessName: 'Phone Shop ' + rnd, name: 'Ben', login: '6' + Date.now().toString().slice(-8), password: 'secret1', email: 'ben' + rnd + '@shop.test' });
  assert.equal(r2.status, 200); assert.equal((await mailsTo('ben' + rnd + '@shop.test')).length, 1);
});

test('new employee gets their login and password by email', async () => {
  const r = await call('POST', '/api/users', S.owner, { name: 'Clara', login: 'clara' + rnd + '@shop.test', password: 'Clara#2026', role: 'sales' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.email.status, 'sent'); S.claraId = r.body.user.id;
  const m = (await mailsTo('clara' + rnd + '@shop.test'))[0];
  assert.ok(m, 'email sent'); assert.ok(m.html.includes('Clara#2026') && m.text.includes('Clara#2026'), 'password in the email');
  assert.ok(m.html.includes('clara' + rnd + '@shop.test'), 'login in the email'); assert.match(m.html, /Mail Shop/);
  // phone login + separate email
  const r2 = await call('POST', '/api/users', S.owner, { name: 'Dan', login: '67' + rnd.replace(/\D/g, '1').padEnd(7, '0'), password: 'dan12345', role: 'manager', email: 'Dan' + rnd + '@Shop.test' });
  assert.equal(r2.body.email.status, 'sent'); assert.equal(r2.body.email.to, 'dan' + rnd + '@shop.test'); S.danId = r2.body.user.id;
  // no email address at all
  const r3 = await call('POST', '/api/users', S.owner, { name: 'Eve', login: '68' + rnd.replace(/\D/g, '2').padEnd(7, '0'), password: 'eve12345', role: 'sales' });
  assert.equal(r3.body.email.status, 'no_email');
  // owner chose not to email
  const n = (await mails()).length;
  const r4 = await call('POST', '/api/users', S.owner, { name: 'Fay', login: 'fay' + rnd + '@shop.test', password: 'fay12345', role: 'sales', sendEmail: false });
  assert.equal(r4.body.email.status, 'not_requested'); assert.equal((await mails()).length, n);
  // bad address rejected
  assert.equal((await call('POST', '/api/users', S.owner, { name: 'G', login: 'g' + rnd, password: 'g1234567', role: 'sales', email: 'not-an-email' })).status, 400);
  // email listed for the team
  const list = (await call('GET', '/api/users', S.owner)).body.users;
  assert.equal(list.find((u) => u.id === S.danId).email, 'dan' + rnd + '@shop.test');
});

test('password set by the owner is emailed; edits without a password are not', async () => {
  const before = (await mailsTo('clara' + rnd + '@shop.test')).length;
  await call('PATCH', '/api/users/' + S.claraId, S.owner, { name: 'Clara B' });
  assert.equal((await mailsTo('clara' + rnd + '@shop.test')).length, before);
  const r = await call('PATCH', '/api/users/' + S.claraId, S.owner, { password: 'NewPass77' });
  assert.equal(r.body.email.status, 'sent');
  const m = (await mailsTo('clara' + rnd + '@shop.test')).pop(); assert.ok(m.html.includes('NewPass77')); assert.match(m.subject, /password/i);
  assert.equal((await call('POST', '/api/auth/login', null, { login: 'clara' + rnd + '@shop.test', password: 'NewPass77' })).status, 200);
});

test('a failed send is reported, not hidden', async () => {
  await fetch(M + '/_fail', { method: 'POST' });
  try {
    const r = await call('POST', '/api/users', S.owner, { name: 'Hal', login: 'hal' + rnd + '@shop.test', password: 'hal12345', role: 'sales' });
    assert.equal(r.status, 200, 'the account is still created'); assert.equal(r.body.email.status, 'failed'); assert.match(r.body.email.error, /not verified/);
  } finally { await fetch(M + '/_fail', { method: 'POST' }); }
});

test('forgot password → link by email → new password → signed in', async () => {
  const login = 'clara' + rnd + '@shop.test';
  const unknown = await call('POST', '/api/auth/forgot', null, { login: 'nobody' + rnd + '@x.test' });
  assert.equal(unknown.status, 200, 'same answer for unknown accounts');
  const r = await call('POST', '/api/auth/forgot', null, { login: login.toUpperCase() });
  assert.equal(r.status, 200);
  const m = (await mailsTo(login)).pop(); assert.match(m.subject, /reset/i);
  const token = (m.html.match(/\?reset=([0-9a-f]{64})/) || [])[1]; assert.ok(token, 'link with token');
  assert.ok(m.html.includes('http://app.test/?reset=' + token));
  assert.equal((await call('POST', '/api/auth/reset', null, { token, password: '123' })).status, 400, 'too short');
  const ok = await call('POST', '/api/auth/reset', null, { token, password: 'Reset2026' });
  assert.equal(ok.status, 200); assert.ok(ok.body.token);
  assert.equal((await call('POST', '/api/auth/reset', null, { token, password: 'Again2026' })).status, 400, 'link works once');
  assert.equal((await call('POST', '/api/auth/login', null, { login, password: 'Reset2026' })).status, 200);
  assert.match((await mailsTo(login)).pop().subject, /changed/i, 'security notice');
  // phone login: forgot by the separate email address works too
  const r2 = await call('POST', '/api/auth/forgot', null, { login: 'dan' + rnd + '@shop.test' });
  assert.equal(r2.status, 200); assert.match((await mailsTo('dan' + rnd + '@shop.test')).pop().subject, /reset/i);
  assert.equal((await call('POST', '/api/auth/reset', null, { token: 'f'.repeat(64), password: 'whatever1' })).status, 400, 'unknown token');
});

test('own email, password change notice, email status', async () => {
  const t = (await call('POST', '/api/auth/login', null, { login: 'clara' + rnd + '@shop.test', password: 'Reset2026' })).body.token;
  assert.equal((await call('PATCH', '/api/me', t, { email: 'bad' })).status, 400);
  assert.equal((await call('PATCH', '/api/me', t, { email: 'clara.home' + rnd + '@mail.test' })).status, 200);
  const me = (await call('GET', '/api/me', t)).body; assert.equal(me.user.email, 'clara.home' + rnd + '@mail.test'); assert.equal(me.emailEnabled, true);
  assert.equal((await call('POST', '/api/me/password', t, { current: 'Reset2026', password: 'Final2026' })).status, 200);
  assert.match((await mailsTo('clara.home' + rnd + '@mail.test')).pop().subject, /changed/i, 'goes to the new address');
  assert.equal((await call('GET', '/api/email/status', t)).body.enabled, true);
});

test('online order: owner and admins are emailed once; can be turned off', async () => {
  const shopId = 'mail' + rnd + 'shop';
  assert.equal((await call('PUT', '/api/data/settings/main', S.owner, { businessName: 'Mail Shop ' + rnd, shopId, shopEnabled: true })).status, 200);
  await call('PUT', '/api/data/products/p1', S.owner, { name: 'Shea butter', category: 'Beauty', markup: 100 });
  await call('PUT', '/api/data/lots/l1', S.owner, { productId: 'p1', qty: 10, unitCost: 10, currency: 'USD', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-01' });
  const admin = await call('POST', '/api/users', S.owner, { name: 'Ivy', login: 'ivy' + rnd + '@shop.test', password: 'ivy12345', role: 'admin', sendEmail: false });
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  const cat = (await call('GET', '/api/shop/' + shopId)).body; const item = (cat.items || cat.products || [])[0]; assert.ok(item, 'item in shop ' + JSON.stringify(cat).slice(0, 200));
  const order = { customer: { name: 'Joy Buyer', phone: '677112233' }, items: [{ productId: item.id, qty: 2 }], delivery: { mode: 'pickup' } };
  const o = await call('POST', '/api/shop/' + shopId + '/orders', null, order); assert.equal(o.status, 200, JSON.stringify(o.body));
  const own = (await mailsTo('ada' + rnd + '@shop.test')).pop(); assert.match(own.subject, /order/i); assert.ok(own.html.includes('Joy Buyer') && own.html.includes('Shea butter'));
  assert.ok((await mailsTo('ivy' + rnd + '@shop.test')).some((m) => /order/i.test(m.subject)), 'admin told too');
  assert.ok(!(await mailsTo('clara.home' + rnd + '@mail.test')).some((m) => /order/i.test(m.subject)), 'sales staff not emailed');
  // switched off
  const st = (await call('GET', '/api/data/settings', S.owner)).body.docs.find((d) => d.id === 'main');
  await call('PUT', '/api/data/settings/main', S.owner, Object.assign({}, st, { emailOrders: false }));
  const n = (await mails()).length;
  assert.equal((await call('POST', '/api/shop/' + shopId + '/orders', null, order)).status, 200);
  assert.equal((await mails()).length, n, 'no email when turned off');
});

test('receipt by email', async () => {
  const sale = { no: 'R-77', date: '2026-11-15', customerName: 'Joy Buyer', lines: [{ productId: 'p1', name: 'Shea butter', qty: 1, unitPrice: 15000 }], payments: [{ id: 'pm1', amount: 15000, method: 'Cash', date: '2026-11-15' }] };
  assert.equal((await call('PUT', '/api/data/sales/s_mail', S.owner, sale)).status, 200);
  assert.equal((await call('POST', '/api/sales/s_mail/email', S.owner, { to: 'nope' })).status, 400);
  assert.equal((await call('POST', '/api/sales/nosuch/email', S.owner, { to: 'joy' + rnd + '@buyer.test' })).status, 404);
  const r = await call('POST', '/api/sales/s_mail/email', S.owner, { to: 'joy' + rnd + '@buyer.test' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = (await mailsTo('joy' + rnd + '@buyer.test')).pop(); assert.match(m.subject, /R-77/); assert.ok(m.html.includes('Shea butter') && m.html.includes('15,000'));
});

test('debt reminder also goes to customers with an email', async () => {
  await call('PUT', '/api/data/customers/cJ', S.owner, { name: 'Joy Buyer', phone: '677112233', email: 'joy' + rnd + '@buyer.test' });
  const due = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
  const sale = { no: 'R-88', date: due, dueDate: due, customerId: 'cJ', customerName: 'Joy Buyer', lines: [{ productId: 'p1', name: 'Shea butter', qty: 1, unitPrice: 15000 }], payments: [] };
  assert.equal((await call('PUT', '/api/data/sales/s_debt', S.owner, sale)).status, 200);
  const r = await call('POST', '/api/reminders/run', S.owner, {}); assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = (await mailsTo('joy' + rnd + '@buyer.test')).filter((x) => /remind|owe|balance|payment/i.test(x.subject)); assert.equal(m.length, 1, 'one reminder email');
  assert.ok(m[0].html.includes('15,000'));
});
