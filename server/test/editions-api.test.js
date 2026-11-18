// API tests: the two kinds of business — Aahsso Brocan and Aahsso Store.
// Sign-up choice, what a Store business can and cannot do, plans per kind, and the platform admin switching a business.
// Needs a server started with ADMIN_SECRET and the same DATABASE_URL (like admin-api.test.js):
//   AAHSSO_URL=http://localhost:8080 DATABASE_URL=… node --test test/editions-api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Pool } = require('pg');
const B = process.env.AAHSSO_URL || 'http://localhost:8080';
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const rnd = Math.random().toString(36).slice(2, 8);
test.after(() => db.end());

async function api(method, p, token, body) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token; if (body) headers['content-type'] = 'application/json';
  const r = await fetch(B + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}
function adminClient() {
  let cookie = '';
  const call = async (method, p, body) => {
    const headers = { 'x-aahsso-admin': '1' }; if (cookie) headers.cookie = cookie; if (body) headers['content-type'] = 'application/json';
    const r = await fetch(B + p, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/(__Host-aahsso_adm=[^;]*)/); if (m) cookie = m[1].endsWith('=') ? '' : m[1]; }
    const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  return { call };
}
const S = {};
const reg = (extra) => api('POST', '/api/auth/register', null, Object.assign({ businessName: 'Shop ' + rnd, name: 'Owner', password: 'secret1' }, extra));
const fresh = () => db.query("UPDATE admin_sessions SET reauth_at = now() WHERE revoked_at IS NULL AND admin_id=(SELECT id FROM platform_admins WHERE email=$1)", [S.email]); // a risky action was just confirmed

test('setup: a Super Admin', async () => {
  S.email = 'ed' + rnd + '@aahsso.test';
  await db.query("UPDATE platform_admins SET role='admin' WHERE role='super'"); // test database only
  const out = execFileSync('node', [path.join(__dirname, '..', 'scripts', 'admin.js'), 'create', '--email', S.email, '--name', 'Ed Boss'], { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const temp = out.match(/\(shown once\):\s+(\S+)/)[1]; const c = adminClient();
  assert.equal((await c.call('POST', '/api/admin/auth/login', { email: S.email, password: temp })).status, 200);
  assert.equal((await c.call('POST', '/api/admin/auth/password', { current: temp, password: 'Correct-Horse-' + rnd })).status, 200);
  assert.equal((await c.call('POST', '/api/admin/auth/pin', { pin: '2580' })).status, 200);
  S.c = c;
  await fresh(); // both kinds open for sign-up (an earlier run may have closed one)
  const st = (await c.call('GET', '/api/admin/settings')).body.settings;
  assert.equal((await c.call('PUT', '/api/admin/settings', Object.assign({}, st, { signup: { import: true, store: true } }))).status, 200);
});

test('sign-up: a new business chooses Import or Store; an old app that sends nothing gets Import', async () => {
  const o = (await api('GET', '/api/signup-options')).body.editions;
  assert.deepEqual(o.map((e) => e.key), ['import', 'store']); assert.equal(o[1].label, 'Aahsso Store');
  assert.equal((await reg({ login: 'bad' + rnd, edition: 'nonsense' })).status, 400);
  const st = await reg({ login: 'st' + rnd, edition: 'store' }); assert.equal(st.status, 200); S.st = st.body.token;
  const me = (await api('GET', '/api/me', S.st)).body;
  assert.equal(me.edition, 'store'); assert.equal(me.tenant.edition, 'store');
  assert.equal(me.features.ship, false); assert.equal(me.features.receive, false, 'no Ship or Receive, even during the free trial');
  assert.notEqual(me.features.buy, false); assert.notEqual(me.features.payroll, false, 'everything else is open in the trial');
  S.stId = me.tenant.id;
  const old = await reg({ login: 'im' + rnd }); assert.equal(old.status, 200); S.im = old.body.token;
  const im = (await api('GET', '/api/me', S.im)).body; assert.equal(im.edition, 'import'); assert.notEqual(im.features.ship, false);
  S.imId = im.tenant.id;
});

test('a Store business buys locally and sells, but the server refuses shipments', async () => {
  assert.equal((await api('PUT', '/api/data/products/p1', S.st, { name: 'Rice 25kg', category: 'Food & Snacks', markup: 20 })).status, 200);
  assert.equal((await api('PUT', '/api/data/lots/l1', S.st, { productId: 'p1', qty: 10, unitCost: 15000, currency: 'XAF', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-10' })).status, 200, 'a local purchase');
  const sh = await api('PUT', '/api/data/shipments/sh1', S.st, { name: 'Container 1', status: 'planning' });
  assert.equal(sh.status, 402); assert.equal(sh.body.code, 'plan_feature');
  assert.equal((await api('PUT', '/api/data/shipments/sh1', S.im, { name: 'Container 1', status: 'planning' })).status, 200, 'an importer can');
});

test('plans belong to one kind: a Store business sees and buys only Store plans', async () => {
  await fresh();
  const mk = (id, edition, extra) => S.c.call('POST', '/api/admin/plans', Object.assign({ id, edition, name: id, description: '', price_monthly: 5000, price_yearly: null, active: true, public: true, sort: 50, limits: {}, modules: {}, features: [] }, extra));
  assert.equal((await mk('xi-' + rnd, 'import')).status, 200);
  assert.equal((await mk('xs-' + rnd, 'store', { modules: { ship: false, payroll: false } })).status, 200);
  assert.equal((await mk('xx-' + rnd, 'galaxy')).status, 400, 'an unknown kind');
  const pl = (await S.c.call('GET', '/api/admin/plans')).body;
  const xs = pl.plans.find((p) => p.id === 'xs-' + rnd); assert.equal(xs.edition, 'store'); assert.deepEqual(xs.modules, { payroll: false }, 'features a Store never has are not stored');
  assert.ok(!pl.editions.find((e) => e.key === 'store').features.includes('ship'));
  const bill = (await api('GET', '/api/billing', S.st)).body;
  assert.equal(bill.edition, 'store'); assert.ok(bill.plans.length && bill.plans.every((p) => p.edition === 'store'), 'only Store plans');
  assert.ok(!bill.catalog.some(([k]) => k === 'ship' || k === 'receive'), 'the comparison has no import features');
  assert.equal((await api('POST', '/api/billing/choose', S.st, { planId: 'xi-' + rnd })).status, 400, 'cannot buy an Import plan');
  const ok = await api('POST', '/api/billing/choose', S.st, { planId: 'xs-' + rnd }); assert.equal(ok.status, 200, JSON.stringify(ok.body)); S.inv = ok.body.invoice;
  assert.equal((await api('GET', '/api/billing', S.im)).body.plans.some((p) => p.edition === 'store'), false, 'importers never see Store plans');
  // the admin cannot put a Store business on an Import plan, nor invoice it
  const bad = await S.c.call('POST', '/api/admin/tenants/' + S.stId + '/subscription', { action: 'change_plan', planId: 'xi-' + rnd, reason: 'test move' });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /Switch its type first/);
  assert.equal((await S.c.call('POST', '/api/admin/tenants/' + S.stId + '/invoices', { planId: 'xi-' + rnd, cycle: 'monthly' })).status, 400);
  // a plan businesses use keeps its kind
  await fresh();
  const e = await S.c.call('PUT', '/api/admin/plans/xs-' + rnd, Object.assign({}, xs, { edition: 'import' })); assert.equal(e.status, 400); assert.match(e.body.error, /already use this plan/);
});

test('the platform admin switches a business between Store and Import — data kept, plan moved, old invoices voided', async () => {
  // put the Store business on its plan first
  assert.equal((await S.c.call('POST', '/api/admin/tenants/' + S.stId + '/subscription', { action: 'change_plan', planId: 'xs-' + rnd, reason: 'paid at the office' })).status, 200);
  const sw = (body) => S.c.call('POST', '/api/admin/tenants/' + S.stId + '/edition', body);
  await db.query("UPDATE admin_sessions SET reauth_at = now() - interval '1 hour' WHERE admin_id=(SELECT id FROM platform_admins WHERE email=$1)", [S.email]);
  assert.equal((await sw({ edition: 'import', planId: 'xi-' + rnd, reason: 'starts importing' })).body.code, 'reauth', 'a risky action: confirm it is you');
  await fresh();
  assert.equal((await sw({ edition: 'store', reason: 'same kind' })).status, 400);
  assert.equal((await sw({ edition: 'import', planId: 'xi-' + rnd })).status, 400, 'a reason is needed');
  assert.match((await sw({ edition: 'import', reason: 'starts importing' })).body.error, /choose its new Aahsso Brocan plan/);
  assert.equal((await sw({ edition: 'import', planId: 'xs-' + rnd, reason: 'starts importing' })).status, 400, 'the new plan must be of the new kind');
  const ok = await sw({ edition: 'import', planId: 'xi-' + rnd, reason: 'starts importing' }); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.voided, [S.inv.number], 'the open invoice for the Store plan is voided');
  const me = (await api('GET', '/api/me', S.st)).body; assert.equal(me.edition, 'import'); assert.notEqual(me.features.ship, false); assert.equal(me.subscription.planId, 'xi-' + rnd);
  assert.equal((await api('GET', '/api/data/products', S.st)).body.docs.length, 1, 'their items are all still there');
  const t = (await S.c.call('GET', '/api/admin/tenants/' + S.stId)).body; assert.equal(t.edition, 'import'); assert.equal(t.adminLog[0].action, 'tenant_edition');
  const list = (await S.c.call('GET', '/api/admin/tenants?edition=store&q=' + rnd)).body.tenants; assert.equal(list.length, 0, 'filter by kind');
  assert.ok((await S.c.call('GET', '/api/admin/overview')).body.editions.import >= 2);
});

test('sign-up can be closed for one kind; at least one stays open', async () => {
  await fresh();
  const st = (await S.c.call('GET', '/api/admin/settings')).body.settings;
  assert.equal((await S.c.call('PUT', '/api/admin/settings', Object.assign({}, st, { signup: { import: false, store: false } }))).status, 400);
  assert.equal((await S.c.call('PUT', '/api/admin/settings', Object.assign({}, st, { signup: { import: false, store: true } }))).status, 200);
  assert.deepEqual((await api('GET', '/api/signup-options')).body.editions.map((e) => e.key), ['store']);
  assert.equal((await reg({ login: 'cl' + rnd, edition: 'import' })).status, 400, 'Import is closed');
  const r = await reg({ login: 'cs' + rnd }); assert.equal(r.status, 200); assert.equal((await api('GET', '/api/me', r.body.token)).body.edition, 'store', 'nothing sent: the only open kind');
  await fresh(); assert.equal((await S.c.call('PUT', '/api/admin/settings', Object.assign({}, st, { signup: { import: true, store: true } }))).status, 200);
});
