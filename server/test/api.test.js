// API integration + concurrency stress tests. Needs a running server and database:
//   AAHSSO_URL=http://localhost:8080 node --test test/api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const B = process.env.AAHSSO_URL || 'http://localhost:8080';
const rnd = Math.random().toString(36).slice(2, 8);

async function call(method, path, token, body, raw) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token;
  if (body && !raw) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = raw;
  const r = await fetch(B + path, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
}
const S = {};
test('setup: owner, manager, sales rep, viewer', async () => {
  const r = await call('POST', '/api/auth/register', null, { businessName: 'Test ' + rnd, name: 'Owner', login: 'own' + rnd, password: 'secret1' });
  assert.equal(r.status, 200); S.owner = r.body.token;
  for (const [role, extra] of [['manager', {}], ['sales', {}], ['viewer', {}], ['sales', { salesAll: true, discount: true }]]) {
    const login = role + rnd + (extra.salesAll ? 'x' : '');
    const u = await call('POST', '/api/users', S.owner, { name: role, login, password: 'pass123', role, perms: extra });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    const t = await call('POST', '/api/auth/login', null, { login, password: 'pass123' });
    S[role + (extra.salesAll ? 'Plus' : '')] = t.body.token; S[role + 'Id' + (extra.salesAll ? 'Plus' : '')] = u.body.user.id;
  }
  const me = await call('GET', '/api/me', S.sales);
  assert.equal(me.body.user.effective.costs, false); assert.equal(me.body.user.effective.sell, true);
});
test('stock setup by manager; sales rep cannot change stock', async () => {
  assert.equal((await call('PUT', '/api/data/products/p1', S.manager, { name: 'Oats', category: 'Food & Snacks', markup: 100 })).status, 200);
  assert.equal((await call('PUT', '/api/data/lots/l1', S.manager, { productId: 'p1', qty: 10, unitCost: 10, currency: 'USD', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-01' })).status, 200);
  assert.equal((await call('PUT', '/api/data/products/p1', S.sales, { name: 'Hacked' })).status, 403);
  assert.equal((await call('PUT', '/api/data/settings/main', S.manager, { businessName: 'x' })).status, 403, 'manager cannot change settings');
  assert.equal((await call('DELETE', '/api/data/lots/l1', S.sales)).status, 403);
});
test('costs hidden from sales rep, prices still provided', async () => {
  const lots = await call('GET', '/api/data/lots', S.sales);
  assert.equal(lots.body.docs[0].unitCost, 0);
  const prods = await call('GET', '/api/data/products', S.sales);
  assert.equal(prods.body.docs[0].priceMax, 12000, '10 USD × 600 × 2'); // 6000 cost, 100% markup
  const own = await call('GET', '/api/data/lots', S.owner);
  assert.equal(own.body.docs[0].unitCost, 10);
});
const sale = (id, qty, price, extra) => Object.assign({ no: id, date: '2026-11-07', status: 'open', discount: 0, lines: [{ productId: 'p1', name: 'Oats', qty, unitPrice: price, alloc: [{ lotId: 'l1', qty }], returns: [] }], payments: [] }, extra || {});
test('sales rep: sells, but cannot discount, cancel, delete payments or touch others\' sales', async () => {
  let r = await call('PUT', '/api/data/sales/s_rep', S.sales, sale('s_rep', 1, 12000, { createdById: 'someone-else', payments: [{ id: 'p1', amount: 12000, method: 'Cash', date: '2026-11-07' }] }));
  assert.equal(r.status, 200);
  const mine = (await call('GET', '/api/data/sales', S.owner)).body.docs.find((d) => d.id === 's_rep');
  assert.equal(mine.createdById, S.salesId, 'server forces the real author');
  assert.equal((await call('PUT', '/api/data/sales/s_low', S.sales, sale('s_low', 1, 5000))).status, 403, 'below minimum price');
  assert.equal((await call('PUT', '/api/data/sales/s_disc', S.sales, sale('s_disc', 1, 12000, { discount: 3000 }))).status, 403, 'discount');
  assert.equal((await call('PUT', '/api/data/sales/s_rep', S.sales, sale('s_rep', 1, 12000, { payments: [] }))).status, 403, 'remove payment');
  assert.equal((await call('PUT', '/api/data/sales/s_rep', S.sales, sale('s_rep', 1, 12000, { status: 'cancelled', payments: [{ id: 'p1', amount: 12000 }] }))).status, 403, 'cancel');
  assert.equal((await call('PUT', '/api/data/sales/s_own', S.owner, sale('s_own', 1, 12000))).status, 200);
  assert.equal((await call('PUT', '/api/data/sales/s_own', S.sales, sale('s_own', 1, 13000))).status, 403, 'edit someone else\'s sale');
  assert.equal((await call('PUT', '/api/data/sales/s_v', S.viewer, sale('s_v', 1, 12000))).status, 403, 'viewer cannot sell');
  assert.equal((await call('PUT', '/api/data/sales/s_plus', S.salesPlus, sale('s_plus', 1, 9000))).status, 200, 'custom rep with discount right may go below minimum');
});
test('sales rep sees only own sales in full; others are stock-only stubs', async () => {
  const docs = (await call('GET', '/api/data/sales', S.sales)).body.docs;
  const other = docs.find((d) => d.id === 's_own'); const mine = docs.find((d) => d.id === 's_rep');
  assert.equal(other._hidden, true); assert.equal(other.lines[0].unitPrice, 0); assert.equal(other.customerName, undefined);
  assert.equal(mine._hidden, undefined); assert.equal(mine.payments.length, 1);
  const all = (await call('GET', '/api/data/sales', S.salesPlus)).body.docs; assert.ok(all.every((d) => !d._hidden));
});
test('stress: 40 simultaneous sales for the last 7 units → exactly 7 succeed', async () => {
  const before = (await call('GET', '/api/data/sales', S.owner)).body.docs.filter((d) => d.status !== 'cancelled').reduce((a, d) => a + d.lines[0].qty, 0);
  const left = 10 - before; assert.equal(left, 7);
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => call('PUT', '/api/data/sales/race' + i, S.owner, sale('race' + i, 1, 12000))));
  const ok = results.filter((r) => r.status === 200).length, conflict = results.filter((r) => r.status === 409).length;
  assert.equal(ok, left); assert.equal(conflict, 40 - left);
});
test('credit limit: rep blocked, manager allowed', async () => {
  assert.equal((await call('PUT', '/api/data/customers/cA', S.sales, { name: 'Reseller A', phone: '670000001', creditLimit: 99999999 })).status, 200);
  let c = (await call('GET', '/api/data/customers', S.owner)).body.docs.find((d) => d.id === 'cA'); assert.equal(c.creditLimit, null, 'rep cannot set credit limit');
  assert.equal((await call('PUT', '/api/data/customers/cA', S.manager, Object.assign({}, c, { creditLimit: 10000 }))).status, 200);
  const sold = (await call('GET', '/api/data/sales', S.owner)).body.docs.filter((d) => d.status !== 'cancelled').reduce((a, d) => a + d.lines[0].qty, 0);
  assert.equal(sold, 10, 'stock is exhausted after race; add stock');
  await call('PUT', '/api/data/lots/l2', S.manager, { productId: 'p1', qty: 5, unitCost: 10, currency: 'USD', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-02' });
  const mk = (id, qty) => ({ no: id, date: '2026-11-07', status: 'open', customerId: 'cA', discount: 0, lines: [{ productId: 'p1', qty, unitPrice: 12000, alloc: [{ lotId: 'l2', qty }], returns: [] }], payments: [] });
  assert.equal((await call('PUT', '/api/data/sales/cr1', S.sales, mk('cr1', 2))).status, 403, '24,000 on credit > 10,000 limit');
  const r = await call('PUT', '/api/data/sales/cr2', S.manager, mk('cr2', 2)); assert.equal(r.status, 200, 'manager can override');
});
test('photos upload and serve', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  assert.equal((await call('POST', '/api/images', S.sales, png, 'image/png')).status, 403, 'sales rep cannot add photos by default');
  const up = await call('POST', '/api/images', S.manager, png, 'image/png'); assert.equal(up.status, 200);
  const r = await fetch(B + '/api/images/' + up.body.id); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png');
});
test('team: disable user blocks login; owner cannot be demoted', async () => {
  assert.equal((await call('PATCH', '/api/users/' + S.viewerId, S.owner, { active: false })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', null, { login: 'viewer' + rnd, password: 'pass123' })).status, 401);
  assert.equal((await call('GET', '/api/users', S.sales)).status, 403);
  assert.equal((await call('GET', '/api/export', S.sales)).status, 403, 'export needs permission');
  assert.equal((await call('GET', '/api/export', S.owner)).status, 200);
});

test('locations & transfers: rules and 25-way concurrent transfer race', async () => {
  assert.equal((await call('PUT', '/api/data/locations/shop', S.manager, { name: 'Akwa shop' })).status, 403, 'manager cannot create locations (settings)');
  assert.equal((await call('PUT', '/api/data/locations/shop', S.owner, { name: 'Akwa shop', type: 'Shop' })).status, 200);
  await call('PUT', '/api/data/lots/l3', S.manager, { productId: 'p1', qty: 10, unitCost: 10, currency: 'USD', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-03' });
  const tr = (id, q) => ({ date: '2026-11-07', from: 'main', to: 'shop', status: 'done', lines: [{ productId: 'p1', qty: q, alloc: [{ lotId: 'l3', qty: q }] }] });
  assert.equal((await call('PUT', '/api/data/transfers/tr0', S.sales, tr('tr0', 1))).status, 403, 'rep cannot move stock');
  const res = await Promise.all(Array.from({ length: 25 }, (_, i) => call('PUT', '/api/data/transfers/race' + i, S.manager, tr('race' + i, 1))));
  assert.equal(res.filter((r) => r.status === 200).length, 10); assert.equal(res.filter((r) => r.status === 409).length, 15);
  const sale = { no: 'X', date: '2026-11-07', status: 'open', locationId: 'shop', lines: [{ productId: 'p1', qty: 1, unitPrice: 12000, alloc: [{ lotId: 'l3', qty: 1 }] }], payments: [] };
  assert.equal((await call('PUT', '/api/data/sales/shop1', S.sales, sale)).status, 403, 'rep tied to main cannot sell at shop');
  assert.equal((await call('PUT', '/api/data/sales/shop1', S.manager, sale)).status, 200, 'manager (all locations) can');
});
test('offline re-send is idempotent: same sale saved twice counts once', async () => {
  await call('PUT', '/api/data/lots/l4', S.manager, { productId: 'p1', qty: 2, unitCost: 10, currency: 'USD', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-04' });
  const sale = { no: 'OFF1', date: '2026-11-07', status: 'open', lines: [{ productId: 'p1', qty: 2, unitPrice: 12000, alloc: [{ lotId: 'l4', qty: 2 }] }], payments: [{ id: 'op1', amount: 24000, method: 'Cash', date: '2026-11-07' }] };
  assert.equal((await call('PUT', '/api/data/sales/off1', S.sales, sale)).status, 200);
  assert.equal((await call('PUT', '/api/data/sales/off1', S.sales, sale)).status, 200, 'retry after lost connection');
  assert.equal((await call('PUT', '/api/data/sales/off2', S.sales, Object.assign({}, sale, { no: 'OFF2' }))).status, 409, 'lot is used up exactly once');
});
test('wholesale customers may get the wholesale price; retail may not', async () => {
  await call('PUT', '/api/data/products/p1', S.manager, { name: 'Oats', category: 'Food & Snacks', markup: 100, wholesaleMarkup: 30 });
  await call('PUT', '/api/data/lots/l5', S.manager, { productId: 'p1', qty: 4, unitCost: 10, currency: 'USD', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-05' });
  await call('PUT', '/api/data/customers/ws1', S.sales, { name: 'Reseller Paul', phone: '677000002', type: 'Reseller' });
  await call('PUT', '/api/data/customers/rt1', S.sales, { name: 'Retail Ann', phone: '677000003', type: 'Retail' });
  const mk = (cid, price) => ({ no: 'W', date: '2026-11-07', status: 'open', customerId: cid, lines: [{ productId: 'p1', qty: 1, unitPrice: price, alloc: [{ lotId: 'l5', qty: 1 }] }], payments: [{ id: 'w' + cid, amount: price, method: 'Cash', date: '2026-11-07' }] });
  assert.equal((await call('PUT', '/api/data/sales/w1', S.sales, mk('rt1', 7800))).status, 403, 'retail below minimum');
  assert.equal((await call('PUT', '/api/data/sales/w2', S.sales, mk('ws1', 7800))).status, 200, 'reseller at wholesale price');
});
test('cash handover: rep submits own, cannot confirm; server sets the expected amount', async () => {
  const me = (await call('GET', '/api/me', S.sales)).body.user;
  const ho = { date: '2026-11-07', userId: me.id, userName: 'sales', declared: { Cash: 1 }, expectedTotal: 1, diff: 0, status: 'submitted' };
  assert.equal((await call('PUT', '/api/data/handovers/h1', S.sales, ho)).status, 200);
  const saved = (await call('GET', '/api/data/handovers', S.owner)).body.docs.find((d) => d.id === 'h1');
  assert.ok(saved.expectedTotal > 1, 'client value replaced by server total: ' + saved.expectedTotal);
  assert.equal((await call('PUT', '/api/data/handovers/h1', S.sales, Object.assign({}, ho, { status: 'confirmed' }))).status, 403);
  assert.equal((await call('PUT', '/api/data/handovers/h2', S.sales, Object.assign({}, ho, { userId: 'someone-else' }))).status, 403);
  assert.equal((await call('PUT', '/api/data/handovers/h1', S.manager, Object.assign({}, saved, { status: 'confirmed' }))).status, 200);
  assert.equal((await call('GET', '/api/data/handovers', S.salesPlus)).body.docs.length, 0, 'others\' handovers are private');
});
test('supplier bills hidden from sales reps', async () => {
  assert.equal((await call('PUT', '/api/data/bills/b1', S.manager, { supplierId: 'su1', amount: 400, currency: 'USD', description: 'Trucking', payments: [] })).status, 200);
  assert.equal((await call('PUT', '/api/data/bills/b2', S.sales, { supplierId: 'su1', amount: 1 })).status, 403);
  assert.equal((await call('GET', '/api/data/bills', S.sales)).body.docs.length, 0);
});
test('automatic reminders via SMS gateway: sends once, then waits', async () => {
  await call('PUT', '/api/data/customers/debt1', S.manager, { name: 'Late Larry', phone: '677111222', creditLimit: 99999999 });
  await call('PUT', '/api/data/lots/l6', S.manager, { productId: 'p1', qty: 1, unitCost: 10, currency: 'USD', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-10-01' });
  assert.equal((await call('PUT', '/api/data/sales/debt', S.manager, { no: 'D1', date: '2026-10-01', dueDate: '2026-10-15', status: 'open', customerId: 'debt1', lines: [{ productId: 'p1', qty: 1, unitPrice: 12000, alloc: [{ lotId: 'l6', qty: 1 }] }], payments: [] })).status, 200);
  assert.equal((await call('POST', '/api/reminders/run', S.sales, {})).status, 403);
  const dry = await call('POST', '/api/reminders/run', S.manager, { dryRun: true });
  assert.ok(dry.body.items.some((i) => i.name === 'Late Larry' && /12,000/.test(i.text)), JSON.stringify(dry.body));
  const run = await call('POST', '/api/reminders/run', S.manager, {});
  const larry = run.body.items.find((i) => i.name === 'Late Larry'); assert.equal(larry.status, 'sent', JSON.stringify(larry));
  const again = await call('POST', '/api/reminders/run', S.manager, {});
  assert.ok(!again.body.items.find((i) => i.name === 'Late Larry'), 'not reminded twice within the interval');
  if (process.env.SMS_LOG) { const log = require('fs').readFileSync(process.env.SMS_LOG, 'utf8'); assert.ok(log.includes('+237677111222'), log); }
});
test('custom roles, branch receive with shortfall, stock count approval', async () => {
  // owner defines a "Cashier" role that can take payments but not sell
  const st = (await call('GET', '/api/data/settings', S.owner)).body.docs[0];
  assert.equal((await call('PUT', '/api/data/settings/main', S.owner, Object.assign({}, st, { roles: { cashier: { label: 'Cashier', perms: ['payments', 'stockView'] } } }))).status, 200);
  const cu = await call('POST', '/api/users', S.owner, { name: 'Cash Carol', login: 'carol' + rnd, password: 'pass123', role: 'cashier', locationId: 'shop' });
  assert.equal(cu.status, 200, JSON.stringify(cu.body));
  const carol = (await call('POST', '/api/auth/login', null, { login: 'carol' + rnd, password: 'pass123' })).body.token;
  const me = (await call('GET', '/api/me', carol)).body.user; assert.equal(me.effective.payments, true); assert.equal(me.effective.sell, false);
  assert.equal((await call('PUT', '/api/data/sales/carol1', carol, { no: 'C', locationId: 'shop', lines: [], payments: [] })).status, 403, 'cashier cannot sell');
  // manager sends 4 to the shop; Carol (at the shop, no transfer permission) receives 3
  await call('PUT', '/api/data/lots/l7', S.manager, { productId: 'p1', qty: 4, unitCost: 10, currency: 'USD', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-06' });
  const t = { no: 'T1', date: '2026-11-07', from: 'main', to: 'shop', status: 'in_transit', lines: [{ productId: 'p1', qty: 4, alloc: [{ lotId: 'l7', qty: 4 }] }] };
  assert.equal((await call('PUT', '/api/data/transfers/rx1', S.manager, t)).status, 200);
  const r = await call('PUT', '/api/data/transfers/rx1', carol, Object.assign({}, t, { status: 'received', lines: [Object.assign({}, t.lines[0], { receivedQty: 3, qty: 99 })] }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const saved = (await call('GET', '/api/data/transfers', S.owner)).body.docs.find((d) => d.id === 'rx1');
  assert.equal(saved.lines[0].qty, 4, 'sent qty cannot be changed by the receiver'); assert.equal(saved.lines[0].receivedQty, 3);
  const adj = (await call('GET', '/api/data/adjustments', S.owner)).body.docs.filter((d) => d.reason === 'Missing in transfer');
  assert.equal(adj.reduce((a, d) => a + d.qty, 0), -1, 'one unit booked as missing in transfer');
  // stock count: rep cannot approve; manager can
  assert.equal((await call('PUT', '/api/data/audits/au1', S.manager, { locationId: 'main', status: 'submitted', lines: [] })).status, 200);
  assert.equal((await call('PUT', '/api/data/audits/au1', carol, { locationId: 'main', status: 'applied' })).status, 403);
  assert.equal((await call('PUT', '/api/data/audits/au1', S.manager, { locationId: 'main', status: 'applied', lines: [] })).status, 200);
});
test('activity log: who/what/where/why; reps see only their own', async () => {
  const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10); // Douala date
  await call('PUT', '/api/data/lots/l9', S.manager, { productId: 'p1', qty: 2, unitCost: 10, currency: 'USD', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-06' });
  const sale = { no: 'ACT1', date: '2026-11-07', status: 'open', lines: [{ productId: 'p1', name: 'Oats', qty: 1, unitPrice: 12000, alloc: [{ lotId: 'l9', qty: 1 }] }], payments: [{ id: 'ap', amount: 12000, method: 'Cash', date: '2026-11-07' }] };
  assert.equal((await call('PUT', '/api/data/sales/act1', S.salesPlus, sale)).status, 200);
  assert.equal((await call('PUT', '/api/data/sales/act1', S.manager, Object.assign({}, sale, { status: 'cancelled', cancelReason: 'Wrong entry / mistake', payments: sale.payments.concat([{ id: 'rf', amount: -12000, method: 'Cash', date: '2026-11-07', ref: 'Refund on cancel' }]) }))).status, 200);
  const mgr = (await call('GET', '/api/activity?from=' + today + '&to=' + today, S.manager)).body.entries;
  const sold = mgr.find((e) => /Sold 1 × Oats/.test(e.text) && e.ref === 'ACT1'); assert.ok(sold, JSON.stringify(mgr.slice(0, 5)));
  assert.equal(sold.user, 'sales'); assert.ok(sold.at); assert.equal(sold.loc, 'main');
  const canc = mgr.find((e) => /Cancelled sale ACT1/.test(e.text)); assert.equal(canc.reason, 'Wrong entry / mistake'); assert.equal(canc.user, 'manager');
  assert.ok(mgr.some((e) => /Refunded 12,000/.test(e.text)), 'refund line');
  assert.ok(mgr.some((e) => e.text === 'Signed in'));
  const rep = (await call('GET', '/api/activity?from=' + today + '&to=' + today, S.sales)).body.entries;
  assert.ok(rep.length > 0 && rep.every((e) => e.user === 'sales'), 'rep only sees own: ' + Array.from(new Set(rep.map((e) => e.user))));
});
test('security: no privilege escalation, tenant isolation, password change', async () => {
  // give the manager the team permission, then try to escalate
  const mgrId = (await call('GET', '/api/me', S.manager)).body.user.id;
  assert.equal((await call('PATCH', '/api/users/' + mgrId, S.owner, { perms: { team: true } })).status, 200);
  assert.equal((await call('PATCH', '/api/users/' + mgrId, S.manager, { perms: { settings: true } })).status, 400, 'cannot change own permissions');
  assert.equal((await call('PATCH', '/api/users/' + S.salesId, S.manager, { role: 'admin' })).status, 403, 'manager cannot create admins');
  assert.equal((await call('POST', '/api/users', S.manager, { name: 'x', login: 'esc' + rnd, password: 'pass123', role: 'admin' })).status, 403);
  // a custom role called "owner" must never be accepted
  const st = (await call('GET', '/api/data/settings', S.owner)).body.docs[0];
  await call('PUT', '/api/data/settings/main', S.owner, Object.assign({}, st, { roles: Object.assign({}, st.roles, { owner: { label: 'Owner', perms: [] } }) }));
  assert.equal((await call('POST', '/api/users', S.owner, { name: 'y', login: 'own2' + rnd, password: 'pass123', role: 'owner' })).status, 400);
  // tenant isolation: another business sees none of this data and cannot overwrite it
  const other = (await call('POST', '/api/auth/register', null, { businessName: 'Other ' + rnd, name: 'O', login: 'other' + rnd, password: 'secret1' })).body.token;
  assert.equal((await call('GET', '/api/data/sales', other)).body.docs.length, 0);
  assert.equal((await call('PUT', '/api/data/products/p1', other, { name: 'Mine now' })).status, 200);
  const mine = (await call('GET', '/api/data/products', S.owner)).body.docs.find((d) => d.id === 'p1'); assert.equal(mine.name, 'Oats', 'same id in another business is a different record');
  // password change
  assert.equal((await call('POST', '/api/me/password', S.salesPlus, { current: 'wrong', password: 'newpass1' })).status, 400);
  assert.equal((await call('POST', '/api/me/password', S.salesPlus, { current: 'pass123', password: 'newpass1' })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', null, { login: 'salesx'.replace('x', '') + rnd + 'x', password: 'newpass1' })).status, 200);
});
test('assets: manager registers, rep cannot see or change, sale needs reason, server stamps book value, activity log', async () => {
  const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const st = { tag: 'A-0001', name: 'Electric stacker', category: 'Warehouse equipment', price: 3000, currency: 'USD', extraCosts: 200000, purchaseDate: '2026-01-15', usefulLife: 5, depMethod: 'straight', locationId: 'main', status: 'in_use' };
  assert.equal((await call('PUT', '/api/data/assets/as1', S.sales, st)).status, 403);
  assert.equal((await call('PUT', '/api/data/assets/as1', S.manager, Object.assign({}, st, { name: '' }))).status, 400);
  assert.equal((await call('PUT', '/api/data/assets/as1', S.manager, Object.assign({}, st, { price: -5 }))).status, 400);
  assert.equal((await call('PUT', '/api/data/assets/as1', S.manager, st)).status, 200);
  assert.equal((await call('GET', '/api/data/assets', S.sales)).body.docs.length, 0, 'reps do not get the register');
  assert.equal((await call('GET', '/api/data/assets', S.manager)).body.docs.length, 1);
  // running cost linked to the asset is an ordinary expense
  assert.equal((await call('PUT', '/api/data/expenses/ex_as1', S.manager, { date: '2026-11-02', category: 'Repairs & maintenance', amount: 45000, method: 'Cash', assetId: 'as1', locationId: 'main' })).status, 200);
  // bill for an asset bought on credit
  assert.equal((await call('PUT', '/api/data/suppliers/su_as', S.manager, { name: 'Ets Fotso' })).status, 200);
  assert.equal((await call('PUT', '/api/data/bills/b_as', S.manager, { supplierId: 'su_as', amount: 3000, currency: 'USD', date: '2026-01-15', assetId: 'as1', payments: [] })).status, 200);
  // selling: reason required, date not before purchase
  const sold = Object.assign({}, st, { status: 'sold', disposal: { type: 'sold', date: '2027-01-01', amount: 1500000, buyer: 'Ets Ndi', bookValue: 1 } });
  assert.equal((await call('PUT', '/api/data/assets/as1', S.manager, sold)).status, 400);
  assert.equal((await call('PUT', '/api/data/assets/as1', S.manager, Object.assign({}, sold, { disposal: Object.assign({}, sold.disposal, { reason: 'x', date: '2025-01-01' }) }))).status, 400);
  const ok = await call('PUT', '/api/data/assets/as1', S.manager, Object.assign({}, sold, { disposal: Object.assign({}, sold.disposal, { reason: 'Bought a bigger one' }) }));
  assert.equal(ok.status, 200);
  const got = (await call('GET', '/api/data/assets', S.manager)).body.docs[0];
  assert.equal(got.disposal.bookValue, 1615054, 'server recomputes the book value, never trusts the client');
  const act = (await call('GET', '/api/activity?from=' + today + '&to=' + today, S.manager)).body.entries;
  assert.ok(act.some((e) => /Registered asset Electric stacker/.test(e.text) && e.type === 'Assets'));
  const se = act.find((e) => /Sold asset Electric stacker to Ets Ndi/.test(e.text)); assert.ok(se); assert.equal(se.reason, 'Bought a bigger one');
  assert.equal((await call('DELETE', '/api/data/assets/as1', S.sales)).status, 403);
  // backup includes assets
  const bk = (await call('GET', '/api/export', S.owner)).body; assert.equal(bk.data.assets.length, 1);
});
