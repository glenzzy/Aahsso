// Plan features (granular, hidden + refused when off) and admin roles (custom, granular). Needs a running server
// (ADMIN_SECRET set) and its database:
//   KARGO_URL=… DATABASE_URL=… ADMIN_SECRET=… node --test test/features-api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Pool } = require('pg');
const B = process.env.KARGO_URL || 'http://localhost:8080';
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const rnd = Math.random().toString(36).slice(2, 8);
test.after(() => db.end());

function adminClient() {
  let cookie = '';
  return async (method, p, body) => {
    const headers = { 'x-kargo-admin': '1' }; if (cookie) headers.cookie = cookie; if (body) headers['content-type'] = 'application/json';
    const r = await fetch(B + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/(__Host-kargo_adm=[^;]*)/); if (m) cookie = m[1]; }
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
}
async function api(method, p, token, body) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token; if (body) headers['content-type'] = 'application/json';
  const r = await fetch(B + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const S = {};
async function signIn(email, temp, pw) {
  const c = adminClient();
  assert.equal((await c('POST', '/api/admin/auth/login', { email, password: temp })).status, 200);
  assert.equal((await c('POST', '/api/admin/auth/password', { current: temp, password: pw })).status, 200);
  return c;
}
const fresh = () => db.query('UPDATE admin_sessions SET reauth_at = now() WHERE revoked_at IS NULL');

test('setup: a Super Admin, a business on a paid plan', async () => {
  await db.query("UPDATE platform_admins SET role='admin' WHERE role='super'"); // test database only
  const out = execFileSync('node', [path.join(__dirname, '..', 'scripts', 'admin.js'), 'create', '--email', 'sa' + rnd + '@kargo.test', '--name', 'Sam Super'], { env: process.env, encoding: 'utf8' });
  S.sa = await signIn('sa' + rnd + '@kargo.test', out.match(/\(shown once\):\s+(\S+)/)[1], 'Super-Pass-' + rnd);
  const r = await api('POST', '/api/auth/register', null, { businessName: 'Feat ' + rnd, name: 'Fola', login: 'fola' + rnd, password: 'secret1' }); S.biz = r.body.token;
  S.tid = (await db.query('SELECT tenant_id FROM users WHERE login=$1', ['fola' + rnd])).rows[0].tenant_id;
  const trial = (await api('GET', '/api/me', S.biz)).body; assert.deepEqual(trial.features, {}, 'free trial: everything on');
  await fresh();
  const plan = { id: 'mini' + rnd, name: 'Mini ' + rnd, price_monthly: 5000, active: true, public: false, limits: {},
    modules: { payroll: false, expenses: false, onlineShop: false, delivery: false, photos: false, customRoles: false, attendance: false, leave: false, activity: false, excel: false } };
  const p = await S.sa('POST', '/api/admin/plans', plan); assert.equal(p.status, 200, JSON.stringify(p.body));
  const plans = (await S.sa('GET', '/api/admin/plans')).body; assert.ok(plans.catalog.length >= 25);
  assert.equal(plans.plans.find((x) => x.id === plan.id).modules.payroll, false);
  assert.equal((await S.sa('POST', '/api/admin/tenants/' + S.tid + '/subscription', { action: 'change_plan', planId: plan.id, cycle: 'monthly', reason: 'feature test' })).status, 200);
});

test('features outside the plan: hidden from the app, refused by the server, permissions removed', async () => {
  const me = (await api('GET', '/api/me', S.biz)).body;
  for (const k of ['payroll', 'expenses', 'onlineShop', 'delivery', 'photos', 'customRoles', 'attendance', 'leave', 'activity', 'excel']) assert.equal(me.features[k], false, k + ' off');
  assert.equal(me.features.sell, undefined, 'sell stays on');
  assert.equal(me.user.effective.payroll, false); assert.equal(me.user.effective.expenses, false); assert.equal(me.user.effective.export, false); assert.equal(me.user.effective.activity, false);
  assert.equal(me.user.effective.sell, true, 'owner keeps everything that is in the plan');
  // writes refused
  const e = await api('PUT', '/api/data/expenses/e1', S.biz, { date: '2026-11-16', amount: 1000, category: 'Water' }); assert.equal(e.status, 402); assert.equal(e.body.code, 'plan_feature');
  assert.equal((await api('PUT', '/api/data/payroll/p1', S.biz, { type: 'advance', amount: 1 })).status, 402);
  assert.equal((await api('PUT', '/api/data/attendance/at_2026-11-16_u_x', S.biz, { staffId: 'u_x', date: '2026-11-16', events: [] })).status, 402);
  assert.equal((await api('PUT', '/api/data/settings/main', S.biz, { businessName: 'Feat', shopEnabled: true, shopSlug: 'feat-' + rnd })).status, 402, 'online shop');
  assert.equal((await api('PUT', '/api/data/settings/main', S.biz, { businessName: 'Feat', roles: { cashier: { label: 'Cashier', perms: ['sell'] } } })).status, 402, 'custom roles');
  await api('PUT', '/api/data/products/p1', S.biz, { name: 'Soap', category: 'Beauty', markup: 100 });
  assert.equal((await api('PUT', '/api/data/products/p2', S.biz, { name: 'Gel', category: 'Beauty', image: 'abc.jpg' })).status, 402, 'photos');
  const img = await fetch(B + '/api/images', { method: 'POST', headers: { Authorization: 'Bearer ' + S.biz, 'content-type': 'image/png' }, body: Buffer.from([137, 80, 78, 71]) });
  assert.equal(img.status, 402, 'photo upload');
  assert.equal((await api('GET', '/api/activity', S.biz)).status, 402, 'activity log');
  assert.equal((await api('GET', '/api/export', S.biz)).status, 402, 'backup download');
  await api('PUT', '/api/data/lots/l1', S.biz, { productId: 'p1', qty: 5, unitCost: 1, currency: 'USD', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-01' });
  const dl = await api('PUT', '/api/data/sales/s1', S.biz, { no: 'R1', date: '2026-11-16', status: 'open', lines: [{ productId: 'p1', qty: 1, unitPrice: 2000, alloc: [{ lotId: 'l1', qty: 1 }] }], payments: [], delivery: { mode: 'local', destination: 'Bonaberi', fee: 1000 } });
  assert.equal(dl.status, 402, 'delivery'); assert.match(dl.body.error, /Deliveries is not included/);
  assert.equal((await api('PUT', '/api/data/sales/s1', S.biz, { no: 'R1', date: '2026-11-16', status: 'open', lines: [{ productId: 'p1', qty: 1, unitPrice: 2000, alloc: [{ lotId: 'l1', qty: 1 }] }], payments: [] })).status, 200, 'a plain sale is fine');
  // team: no custom roles or per-person permissions
  const u = await api('POST', '/api/users', S.biz, { name: 'Cora', login: 'cora' + rnd, password: 'pass1234', role: 'sales', perms: { cancel: true }, sendEmail: false });
  assert.equal(u.status, 200); assert.deepEqual(u.body.user.perms, {}, 'per-person permissions dropped');
});

test('turning a feature back on (per-business override) restores it at once — data was kept', async () => {
  await db.query("INSERT INTO documents (tenant_id, collection, id, data) VALUES ($1, 'expenses', 'e_old', '{\"date\":\"2026-11-01\",\"amount\":500,\"category\":\"Water\"}') ON CONFLICT DO NOTHING", [S.tid]);
  assert.deepEqual((await api('GET', '/api/data/expenses', S.biz)).body.docs, [], 'records of a feature that is off are not sent');
  await fresh();
  assert.equal((await S.sa('POST', '/api/admin/tenants/' + S.tid + '/features', { modules: { expenses: true, sell: false }, limits: { maxUsers: 10 }, reason: 'Custom deal' })).status, 200);
  const me = (await api('GET', '/api/me', S.biz)).body;
  assert.equal(me.features.expenses, undefined, 'expenses on for this business'); assert.equal(me.features.sell, false, 'and point of sale taken away'); assert.equal(me.limits.maxUsers, 10);
  assert.equal((await api('GET', '/api/data/expenses', S.biz)).body.docs.length, 1, 'old expense visible again');
  assert.equal((await api('PUT', '/api/data/expenses/e2', S.biz, { date: '2026-11-16', amount: 100, category: 'Water' })).status, 200);
  assert.equal((await api('PUT', '/api/data/sales/s2', S.biz, { no: 'R2', date: '2026-11-16', status: 'open', lines: [], payments: [] })).status, 402, 'sell is off now');
  const d = (await S.sa('GET', '/api/admin/tenants/' + S.tid)).body; assert.equal(d.features.sell, false); assert.equal(d.subscription.overrides.modules.expenses, true);
  await fresh(); await S.sa('POST', '/api/admin/tenants/' + S.tid + '/features', { modules: {}, limits: {}, reason: 'back to plan' });
  assert.equal((await api('GET', '/api/me', S.biz)).body.features.expenses, false, 'back to the plan');
});

test('admin roles: the Super Admin creates granular roles; admins get exactly those permissions', async () => {
  await fresh();
  const roles = (await S.sa('GET', '/api/admin/roles')).body; assert.ok(roles.catalog.length >= 15); assert.ok(roles.roles.some((r) => r.id === 'support' && r.builtin));
  assert.equal((await S.sa('POST', '/api/admin/roles', { name: 'Nothing', perms: [] })).status, 400);
  const cr = await S.sa('POST', '/api/admin/roles', { name: 'Ledger ' + rnd, description: 'Reads invoices', perms: ['billing', 'overview.view', 'not.a.perm', 'admins.manage'] });
  assert.equal(cr.status, 200, JSON.stringify(cr.body)); const rid = cr.body.id;
  const role = (await S.sa('GET', '/api/admin/roles')).body.roles.find((r) => r.id === rid); assert.deepEqual(role.perms.sort(), ['billing', 'overview.view'], 'unknown and Super-Admin-only permissions are dropped');
  const add = await S.sa('POST', '/api/admin/admins', { name: 'Lena Ledger', email: 'lena' + rnd + '@kargo.test', role: rid, sendEmail: false }); assert.equal(add.status, 200, JSON.stringify(add.body));
  const lena = await signIn('lena' + rnd + '@kargo.test', add.body.password, 'Lena-Pass-' + rnd);
  const me = (await lena('GET', '/api/admin/me')).body; assert.equal(me.roleName, 'Ledger ' + rnd); assert.deepEqual(me.admin.perms.sort(), ['billing', 'overview.view']);
  assert.equal((await lena('GET', '/api/admin/invoices')).status, 200);
  assert.equal((await lena('GET', '/api/admin/overview')).status, 200);
  assert.equal((await lena('GET', '/api/admin/tenants')).status, 403, 'no businesses permission');
  assert.equal((await lena('POST', '/api/admin/payments', { tenantId: S.tid, amount: 1, method: 'Cash' })).status, 403, 'cannot record payments');
  assert.equal((await lena('GET', '/api/admin/export/invoices')).status, 403, 'no export permission');
  // the Super Admin widens the role: takes effect on the next request
  await fresh(); assert.equal((await S.sa('PUT', '/api/admin/roles/' + rid, { name: 'Ledger ' + rnd, perms: ['billing', 'overview.view', 'tenants.view'] })).status, 200);
  assert.equal((await lena('GET', '/api/admin/tenants')).status, 200, 'new permission works at once');
  assert.equal((await lena('POST', '/api/admin/roles', { name: 'Hack', perms: ['billing'] })).status, 403, 'only the Super Admin manages roles');
  assert.equal((await S.sa('DELETE', '/api/admin/roles/' + rid)).status, 400, 'in use');
  assert.equal((await S.sa('DELETE', '/api/admin/roles/support')).status, 400, 'built-in');
  // built-in roles can be adjusted too
  const sup = (await S.sa('GET', '/api/admin/roles')).body.roles.find((r) => r.id === 'support');
  assert.equal((await S.sa('PUT', '/api/admin/roles/support', { name: sup.name, description: sup.description, perms: sup.perms })).status, 200);
  const log = (await S.sa('GET', '/api/admin/audit?action=role_')).body.entries.map((x) => x.action); assert.ok(log.includes('role_created') && log.includes('role_updated'));
});
