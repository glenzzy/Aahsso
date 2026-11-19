// API tests: Aahsso Bar & Resto — the QR menu, tickets, bills that take stock, roles, and the platform admin's control.
//   AAHSSO_URL=http://localhost:8080 DATABASE_URL=… node --test test/resto-api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Pool } = require('pg');
const KC = require('../public/compute.js');
const B = process.env.AAHSSO_URL || 'http://localhost:8080';
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const rnd = Math.random().toString(36).slice(2, 8);
test.after(() => db.end());
async function api(method, p, token, body) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token; if (body) headers['content-type'] = 'application/json';
  const r = await fetch(B + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}
const S = {};
let cookie = '';
const adm = async (method, p, body) => { const headers = { 'x-aahsso-admin': '1' }; if (cookie) headers.cookie = cookie; if (body) headers['content-type'] = 'application/json'; const r = await fetch(B + p, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/(__Host-aahsso_adm=[^;]*)/); if (m) cookie = m[1].endsWith('=') ? '' : m[1]; } const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() }; };
const fresh = () => db.query('UPDATE admin_sessions SET reauth_at = now() WHERE revoked_at IS NULL AND admin_id=(SELECT id FROM platform_admins WHERE email=$1)', [S.email]);

test('sign-up: a bar gets its menu key, categories and the Bar & Resto tools', async () => {
  const r = await api('POST', '/api/auth/register', null, { businessName: 'K Rooftop ' + rnd, name: 'Kemi', login: 'kemi' + rnd + '@resto.test', password: 'secret12', edition: 'resto', venueType: 'bar' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); S.o = r.body.token;
  const me = (await api('GET', '/api/me', S.o)).body; S.tid = me.tenant.id;
  assert.equal(me.edition, 'resto'); assert.equal(me.features.ship, false); assert.equal(me.features.onlineShop, false);
  assert.notEqual(me.features.tables, false, 'tables open in the trial'); assert.notEqual(me.features.qrOrders, false);
  const st = (await api('GET', '/api/data/settings', S.o)).body.docs.find((d) => d.id === 'main');
  assert.equal(st.venueType, 'bar'); assert.match(st.menuKey, /^[a-f0-9]{12}$/); assert.ok(st.menuCats.includes('Beers')); S.key = st.menuKey;
});

test('the owner sets up stock, menu, an area and a table', async () => {
  const P = (col, id, body) => api('PUT', '/api/data/' + col + '/' + id, S.o, body);
  assert.equal((await P('products', 'beer', { name: '33 Export 65cl', category: 'Food & Snacks' })).status, 200);
  assert.equal((await P('lots', 'l1', { productId: 'beer', qty: 24, unitCost: 450, currency: 'XAF', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-10' })).status, 200);
  assert.equal((await P('products', 'jw', { name: 'Johnnie Walker Red 70cl', category: 'Food & Snacks' })).status, 200);
  assert.equal((await P('lots', 'l2', { productId: 'jw', qty: 2, unitCost: 15000, currency: 'XAF', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-10' })).status, 200);
  assert.equal((await P('menu', 'm1', { name: '33 Export', category: 'Beers', price: 1000, kind: 'stock', uses: [{ productId: 'beer', qty: 1 }] })).status, 200);
  assert.equal((await P('menu', 'm2', { name: 'Shot of JW Red', category: 'Spirits', price: 1500, kind: 'portion', uses: [{ productId: 'jw', qty: 0.04 }] })).status, 200);
  assert.equal((await P('menu', 'm3', { name: 'Soya plate', category: 'Snacks', price: 2000, kind: 'plain', uses: [], soldOut: true })).status, 200);
  assert.equal((await P('areas', 'a1', { name: 'Terrace', waiterIds: [] })).status, 200);
  assert.equal((await P('tables', 't1', { label: 'T1', seats: 4, areaId: 'a1', token: 'Tok' + rnd + 'xyz' })).status, 200); S.tok = 'Tok' + rnd + 'xyz';
});

test('a customer scans the table: menu with server prices; orders by name only', async () => {
  const m = await api('GET', '/api/menu/' + S.key + '?t=' + S.tok); assert.equal(m.status, 200);
  assert.equal(m.body.table.label, 'T1'); assert.equal(m.body.canOrder, true); assert.equal(m.body.items.length, 3);
  assert.equal(m.body.items.find((i) => i.id === 'm3').soldOut, true, 'sold out by hand');
  const pub = (await api('GET', '/api/menu/' + S.key)).body; assert.equal(pub.table, null);
  assert.equal(pub.canOrder, true, 'the public menu link: the customer picks a table'); assert.deepEqual(pub.tables, [{ id: 't1', label: 'T1', area: 'Terrace' }]);
  assert.equal(m.body.tables.length, 0, 'a scanned table does not list the others');
  assert.equal((await api('GET', '/api/menu/ffffffffffff')).status, 404);
  assert.equal((await api('POST', '/api/menu/' + S.key + '/orders', null, { t: 'wrongtoken1', name: 'Ada', items: [{ menuId: 'm1', qty: 1 }] })).status, 400, 'needs a real table');
  assert.equal((await api('POST', '/api/menu/' + S.key + '/orders', null, { t: S.tok, name: 'Ada', items: [{ menuId: 'm3', qty: 1 }] })).status, 400, 'sold out');
  const o = await api('POST', '/api/menu/' + S.key + '/orders', null, { t: S.tok, name: 'Ada', device: 'dev1', items: [{ menuId: 'm1', qty: 2, price: 1 }, { menuId: 'm2', qty: 1 }] });
  assert.equal(o.status, 200, JSON.stringify(o.body)); assert.equal(o.body.total, 2 * 1000 + 1500, 'prices come from the server, not the phone');
  const o2 = await api('POST', '/api/menu/' + S.key + '/orders', null, { t: S.tok, name: 'Ben', device: 'dev2', items: [{ menuId: 'm1', qty: 1 }] }); assert.equal(o2.status, 200);
  const st = (await api('GET', '/api/menu/' + S.key + '/status?t=' + S.tok + '&d=dev1')).body;
  assert.equal(st.orders.length, 1, 'each phone sees its own orders'); assert.equal(st.orders[0].status, 'new'); assert.equal(st.total, 4500, 'the bill so far: the whole table');
  assert.equal((await api('POST', '/api/menu/' + S.key + '/call', null, { t: S.tok, kind: 'bill', name: 'Ada' })).status, 200);
  const tabs = (await api('GET', '/api/data/tabs', S.o)).body.docs; assert.equal(tabs.length, 1, 'one table, one bill'); assert.ok(tabs[0].billAskedAt); S.tab = tabs[0];
  const tbl = (await api('GET', '/api/data/tables', S.o)).body.docs[0]; assert.equal(tbl.call.kind, 'bill');
  S.orders = (await api('GET', '/api/data/rorders', S.o)).body.docs; assert.equal(S.orders.length, 2); assert.ok(S.orders.every((x) => x.status === 'new' && x.tableLabel === 'T1'));
});

test('a waiter (role) serves; the bill is a sale that takes bottles and shots from stock', async () => {
  const w = await api('POST', '/api/users', S.o, { name: 'Wale', login: 'wale' + rnd + '@resto.test', password: 'secret12', role: 'resto_waiter' }); assert.equal(w.status, 200, JSON.stringify(w.body));
  S.w = (await api('POST', '/api/auth/login', null, { login: 'wale' + rnd + '@resto.test', password: 'secret12' })).body.token;
  assert.equal((await api('PUT', '/api/data/menu/m9', S.w, { name: 'Hack', price: 1 })).status, 403, 'a waiter does not edit the menu');
  for (const o of S.orders) assert.equal((await api('PUT', '/api/data/rorders/' + o.id, S.w, Object.assign({}, o, { id: undefined, status: 'served', servedAt: new Date().toISOString() }))).status, 200);
  const raw = { products: (await api('GET', '/api/data/products', S.o)).body.docs, lots: (await api('GET', '/api/data/lots', S.o)).body.docs, sales: [], adjustments: [], settings: {} };
  const C = KC.computeAll(raw); const menu = (await api('GET', '/api/data/menu', S.o)).body.docs; const lines = KC.tabLines(S.tab, (await api('GET', '/api/data/rorders', S.o)).body.docs);
  assert.deepEqual(lines.map((l) => [l.menuId, l.qty]).sort(), [['m1', 3], ['m2', 1]]);
  const sale = { no: 'R' + rnd, date: '2026-11-18', createdAt: new Date().toISOString(), status: 'open', source: 'resto', tabId: S.tab.id, customerName: 'Table T1', payments: [{ id: 'p1', date: '2026-11-18', method: 'Cash', amount: 4500 }],
    lines: lines.map((l) => ({ productId: 'm:' + l.menuId, menuId: l.menuId, name: l.name, qty: l.qty, unitPrice: l.price, category: l.category, alloc: KC.allocMenu(C, raw.lots, menu.find((m) => m.id === l.menuId), l.qty, 'main') })) };
  const s = await api('PUT', '/api/data/sales/sr1', S.w, sale); assert.equal(s.status, 200, JSON.stringify(s.body));
  const C2 = KC.computeAll(Object.assign({}, raw, { sales: [Object.assign({ id: 'sr1' }, sale)] }));
  assert.equal(C2.prodX.beer.available, 21, '3 beers out'); assert.ok(Math.abs(C2.prodX.jw.available - 1.96) < 1e-6, 'one shot = 1/25 bottle');
  assert.equal(C2.saleX.sr1.cogs, 3 * 450 + 0.04 * 15000, 'cost of the bill'); assert.equal(C2.saleX.sr1.balance, 0);
  const f = KC.saleFacts(Object.assign({}, raw, { sales: [Object.assign({ id: 'sr1' }, sale)] }), C2, {}); assert.equal(f.find((x) => x.name === '33 Export').category, 'Beers', 'reports group by menu category');
  assert.equal((await api('PUT', '/api/data/tabs/' + S.tab.id, S.w, Object.assign({}, S.tab, { id: undefined, status: 'paid', saleIds: ['sr1'] }))).status, 200);
});

test('the stock runs out: the QR menu shows it sold out', async () => {
  const lots = (await api('GET', '/api/data/lots', S.o)).body.docs; const l1 = lots.find((l) => l.id === 'l1');
  assert.equal((await api('PUT', '/api/data/sales/sr2', S.o, { no: 'R2' + rnd, date: '2026-11-18', status: 'open', source: 'resto', payments: [{ id: 'p2', date: '2026-11-18', method: 'Cash', amount: 21000 }], lines: [{ productId: 'm:m1', menuId: 'm1', name: '33 Export', qty: 21, unitPrice: 1000, alloc: [{ lotId: l1.id, qty: 21 }] }] })).status, 200);
  const m = (await api('GET', '/api/menu/' + S.key + '?t=' + S.tok)).body; assert.equal(m.items.find((i) => i.id === 'm1').soldOut, true);
  assert.equal((await api('POST', '/api/menu/' + S.key + '/orders', null, { t: S.tok, name: 'Ada', items: [{ menuId: 'm1', qty: 1 }] })).status, 400);
});

test('the menu address is the venue name: /m/k-rooftop-…; old links and earlier addresses keep working', async () => {
  const set = () => api('GET', '/api/data/settings', S.o).then((r) => r.body.docs.find((d) => d.id === 'main'));
  const st = await set(); S.slug = 'k-rooftop-' + rnd; assert.equal(st.menuSlug, S.slug, 'made from the business name at sign-up');
  assert.equal((await api('GET', '/api/menu/' + S.slug)).status, 200, 'the API answers to the address');
  const old = await fetch(B + '/m/' + S.key, { redirect: 'manual' }); assert.equal(old.status, 301); assert.equal(old.headers.get('location'), '/m/' + S.slug, 'the old /m/<key> link goes to the address');
  assert.equal((await fetch(B + '/m/' + S.slug, { redirect: 'manual' })).status, 200);
  // a second venue with the same name gets name-2; it cannot take the first one's address
  const r2 = await api('POST', '/api/auth/register', null, { businessName: 'K Rooftop ' + rnd, name: 'Kofi', login: 'kofi' + rnd + '@resto.test', password: 'secret12', edition: 'resto' });
  const st2 = (await api('GET', '/api/data/settings', r2.body.token)).body.docs.find((d) => d.id === 'main'); assert.equal(st2.menuSlug, S.slug + '-2');
  const chk = (await api('GET', '/api/menu-address?slug=' + S.slug, r2.body.token)).body; assert.equal(chk.available, false); assert.equal(chk.suggestion, S.slug + '-2', 'its own address is free for it');
  const steal = await api('PUT', '/api/data/settings/main', r2.body.token, Object.assign({}, st2, { id: undefined, menuSlug: S.slug })); assert.equal(steal.status, 409, 'taken by another venue');
  assert.equal((await api('PUT', '/api/data/settings/main', S.o, Object.assign({}, st, { id: undefined, menuSlug: 'admin' }))).status, 400, 'reserved words refused');
  // the owner renames it: the new address works, the earlier one still opens the menu, and nobody else can take it
  const neu = 'sky-' + rnd; assert.equal((await api('PUT', '/api/data/settings/main', S.o, Object.assign({}, st, { id: undefined, menuSlug: neu }))).status, 200);
  const st3 = await set(); assert.equal(st3.menuSlug, neu); assert.deepEqual(st3.menuSlugsOld, [S.slug]); assert.equal(st3.menuKey, S.key, 'the table QR codes keep their key');
  assert.equal((await api('GET', '/api/menu/' + neu)).status, 200);
  const prev = await fetch(B + '/m/' + S.slug, { redirect: 'manual' }); assert.equal(prev.status, 301); assert.equal(prev.headers.get('location'), '/m/' + neu, 'the earlier address goes to the new one');
  assert.equal((await api('GET', '/api/menu-address?slug=' + S.slug, r2.body.token)).body.available, false, 'the earlier address stays with this venue');
  assert.equal((await api('PUT', '/api/data/settings/main', S.o, Object.assign({}, st3, { id: undefined, menuSlug: undefined, menuSlugsOld: ['someone-else'] }))).status, 200);
  const st4 = await set(); assert.equal(st4.menuSlug, neu, 'an older copy of the settings keeps the address'); assert.deepEqual(st4.menuSlugsOld, [S.slug], 'the list of earlier addresses cannot be written by the app');
  // a save made before the app had the settings (defaults only) cannot wipe the venue
  assert.equal((await api('PUT', '/api/data/settings/main', S.o, { businessName: '', menuKey: '' })).status, 200);
  const st5 = await set(); assert.equal(st5.businessName, 'K Rooftop ' + rnd, 'the name stays'); assert.equal(st5.menuKey, S.key, 'the table QR key stays'); assert.equal(st5.menuSlug, neu, 'the address stays');
});

test('the public menu link: the customer picks their table; the owner can switch that off', async () => {
  assert.equal((await api('POST', '/api/menu/' + S.key + '/orders', null, { name: 'Cleo', device: 'dev3', items: [{ menuId: 'm2', qty: 1 }] })).status, 400, 'no table chosen');
  assert.equal((await api('POST', '/api/menu/' + S.key + '/orders', null, { table: 'nope', name: 'Cleo', device: 'dev3', items: [{ menuId: 'm2', qty: 1 }] })).status, 400, 'no such table');
  const o = await api('POST', '/api/menu/' + S.key + '/orders', null, { table: 't1', name: 'Cleo', device: 'dev3', items: [{ menuId: 'm2', qty: 1 }] }); assert.equal(o.status, 200, JSON.stringify(o.body));
  const ro = (await api('GET', '/api/data/rorders', S.o)).body.docs.find((x) => x.customerName === 'Cleo'); assert.equal(ro.tableLabel, 'T1'); assert.equal(ro.status, 'new', 'the waiter still accepts it');
  const st = (await api('GET', '/api/menu/' + S.key + '/status?table=t1&d=dev3')).body; assert.equal(st.orders.length, 1); assert.equal(st.total, 1500);
  assert.equal((await api('POST', '/api/menu/' + S.key + '/call', null, { table: 't1', kind: 'waiter', name: 'Cleo', ring: 3200 })).status, 200);
  const rang = () => api('GET', '/api/data/tables', S.o).then((r) => r.body.docs.find((x) => x.id === 't1').call);
  assert.equal((await rang()).ring, 3200, 'staff ring the bell as long as the customer held it');
  await api('POST', '/api/menu/' + S.key + '/call', null, { table: 't1', kind: 'waiter', name: 'Cleo', ring: 999999 });
  assert.equal((await rang()).ring, 8000, 'never longer than 8 seconds');
  const set =(await api('GET', '/api/data/settings', S.o)).body.docs.find((d) => d.id === 'main');
  assert.equal((await api('PUT', '/api/data/settings/main', S.o, Object.assign({}, set, { id: undefined, pickTable: false }))).status, 200);
  const pub = (await api('GET', '/api/menu/' + S.key)).body; assert.equal(pub.canOrder, false, 'switched off: the link only shows the menu'); assert.deepEqual(pub.tables, []);
  assert.equal((await api('POST', '/api/menu/' + S.key + '/orders', null, { table: 't1', name: 'Cleo', items: [{ menuId: 'm2', qty: 1 }] })).status, 400, 'only the table QR code orders now');
  assert.equal((await api('POST', '/api/menu/' + S.key + '/orders', null, { t: S.tok, name: 'Cleo', device: 'dev3', items: [{ menuId: 'm2', qty: 1 }] })).status, 200, 'the table QR still works');
});

test('the platform admin controls it: a Resto plan without QR ordering or glasses, 1 table', async () => {
  S.email = 'rs' + rnd + '@aahsso.test';
  await db.query("UPDATE platform_admins SET role='admin' WHERE role='super'"); // test database only
  const out = execFileSync('node', [path.join(__dirname, '..', 'scripts', 'admin.js'), 'create', '--email', S.email, '--name', 'Resto Boss'], { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const temp = out.match(/\(shown once\):\s+(\S+)/)[1];
  await adm('POST', '/api/admin/auth/login', { email: S.email, password: temp }); await adm('POST', '/api/admin/auth/password', { current: temp, password: 'Correct-Horse-' + rnd }); await adm('POST', '/api/admin/auth/pin', { pin: '2580' }); await fresh();
  const pl = (await adm('GET', '/api/admin/plans')).body; const ed = pl.editions.find((e) => e.key === 'resto');
  assert.ok(ed.features.includes('qrOrders') && ed.features.includes('kds') && !ed.features.includes('ship'), 'the Bar & Resto tools are in its plan catalog');
  assert.ok(!pl.editions.find((e) => e.key === 'store').features.includes('tables'), 'and not in the Store one');
  assert.ok(pl.plans.some((p) => p.id === 'resto-starter' && p.edition === 'resto' && p.limits.maxTables === 10), 'seeded Resto Starter: 10 tables');
  assert.equal((await adm('POST', '/api/admin/plans', { edition: 'resto', name: 'No Venue ' + rnd, price_monthly: 2000, active: true, limits: {}, modules: {}, features: [] })).status, 400, 'a Bar & Resto plan must say which venue it is for');
  const r = await adm('POST', '/api/admin/plans', { edition: 'resto', venue: 'bar', name: 'Tiny Bar ' + rnd, price_monthly: 2000, active: true, public: false, limits: { maxTables: 1 }, modules: { qrOrders: false, portions: false }, features: [] });
  assert.equal(r.status, 200, JSON.stringify(r.body)); const pid = (await adm('GET', '/api/admin/plans')).body.plans.find((p) => p.name === 'Tiny Bar ' + rnd).id;
  assert.equal((await adm('POST', '/api/admin/tenants/' + S.tid + '/subscription', { action: 'change_plan', planId: pid, reason: 'resto test' })).status, 200);
  const me = (await api('GET', '/api/me', S.o)).body; assert.equal(me.features.qrOrders, false); assert.equal(me.limits.maxTables, 1);
  assert.equal((await api('GET', '/api/menu/' + S.key + '?t=' + S.tok)).body.canOrder, false, 'QR menu: view only');
  assert.equal((await api('POST', '/api/menu/' + S.key + '/orders', null, { t: S.tok, name: 'Ada', items: [{ menuId: 'm2', qty: 1 }] })).status, 403);
  const t2 = await api('PUT', '/api/data/tables/t2', S.o, { label: 'T2', seats: 2, token: 'Second' + rnd }); assert.equal(t2.status, 402); assert.match(t2.body.error, /1 tables/);
  assert.equal((await api('PUT', '/api/data/menu/m4', S.o, { name: 'Glass of red', price: 2500, kind: 'portion', uses: [{ productId: 'jw', qty: 0.2 }] })).status, 402, 'glasses are not in this plan');
  const t = (await adm('GET', '/api/admin/tenants/' + S.tid)).body; assert.equal(t.usage.maxTables, 1, 'admin sees 1 of 1 tables');
  // a per-business override switches QR ordering back on for this venue only
  await fresh(); const ov = await adm('POST', '/api/admin/tenants/' + S.tid + '/features', { modules: { qrOrders: true }, limits: {}, reason: 'pilot venue' });
  assert.equal(ov.status, 200, JSON.stringify(ov.body)); assert.notEqual((await api('GET', '/api/me', S.o)).body.features.qrOrders, false);
});

test('plans per venue: bars, restaurants, both — the venue follows the plan', async () => {
  const pl = (await adm('GET', '/api/admin/plans')).body;
  assert.deepEqual(pl.venues.map((v) => v.key), ['bar', 'restaurant', 'both']);
  const seeded = Object.fromEntries(pl.plans.filter((p) => p.edition === 'resto').map((p) => [p.id, p.venue]));
  assert.equal(seeded['bar-starter'], 'bar'); assert.equal(seeded['restaurant-business'], 'restaurant'); assert.equal(seeded['resto-starter'], 'both', 'the first plans are for bars & restaurants');
  assert.ok(pl.plans.filter((p) => p.edition !== 'resto').every((p) => p.venue === null), 'Brocan and Store plans have no venue');
  await fresh();
  const mk = async (venue, name) => { const r = await adm('POST', '/api/admin/plans', { edition: 'resto', venue, name: name + ' ' + rnd, price_monthly: 3000, active: true, public: true, limits: {}, modules: {}, features: [] }); assert.equal(r.status, 200, JSON.stringify(r.body)); return (await adm('GET', '/api/admin/plans')).body.plans.find((p) => p.name === name + ' ' + rnd); };
  const pub = await mk('bar', 'Pub Pro'); const kit = await mk('restaurant', 'Kitchen Pro'); const duo = await mk('both', 'Duo Pro');
  // the business (a bar) sees every venue's plans, each marked, and knows its own venue
  const b = (await api('GET', '/api/billing', S.o)).body; assert.equal(b.venue, 'bar');
  for (const p of [pub, kit, duo]) assert.equal(b.plans.find((x) => x.id === p.id).venue, p.venue);
  // it moves to a restaurant plan (paid, here set by the admin): the venue follows
  assert.equal((await adm('POST', '/api/admin/tenants/' + S.tid + '/subscription', { action: 'change_plan', planId: kit.id, reason: 'venue test' })).status, 200);
  const set = () => api('GET', '/api/data/settings', S.o).then((r) => r.body.docs.find((d) => d.id === 'main'));
  assert.equal((await set()).venueType, 'restaurant', 'the plan made it a restaurant');
  const me = (await api('GET', '/api/me', S.o)).body; assert.equal(me.subscription.planVenue, 'restaurant');
  assert.equal((await api('GET', '/api/billing', S.o)).body.venue, 'restaurant');
  // on a plan, the venue cannot be changed in the settings — only by choosing another plan
  const st = await set(); assert.equal((await api('PUT', '/api/data/settings/main', S.o, Object.assign({}, st, { id: undefined, venueType: 'both' }))).status, 200);
  assert.equal((await set()).venueType, 'restaurant', 'still the plan\'s venue');
  // choosing a plan for another venue makes an invoice; the venue changes only when that plan starts
  const ch = await api('POST', '/api/billing/choose', S.o, { planId: duo.id, cycle: 'monthly' }); assert.equal(ch.status, 200, JSON.stringify(ch.body)); assert.ok(ch.body.invoice);
  assert.equal((await set()).venueType, 'restaurant', 'not before it is paid');
  // a plan businesses use keeps its venue
  await fresh(); const ed = await adm('PUT', '/api/admin/plans/' + kit.id, Object.assign({}, kit, { venue: 'bar' })); assert.equal(ed.status, 400); assert.match(ed.body.error, /stays a plan for restaurants/);
  for (const p of [pub, kit, duo]) await adm('PUT', '/api/admin/plans/' + p.id, Object.assign({}, p, { public: false })); // keep the shared test database tidy
});

test('a Store or Brocan never gets the Bar & Resto tools', async () => {
  const r = await api('POST', '/api/auth/register', null, { businessName: 'Shop ' + rnd, name: 'Sam', login: 'sam' + rnd + '@shop.test', password: 'secret12', edition: 'store' });
  const me = (await api('GET', '/api/me', r.body.token)).body; assert.equal(me.features.tables, false); assert.equal(me.features.qrOrders, false);
  assert.equal((await api('PUT', '/api/data/menu/x', r.body.token, { name: 'Beer', price: 1 })).status, 402);
  assert.equal((await api('PUT', '/api/data/tables/x', r.body.token, { label: 'T1' })).status, 402);
});
