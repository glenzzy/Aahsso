// Super admin + subscriptions API tests. Needs a server started with ADMIN_SECRET (and CRON_SECRET) and the same DATABASE_URL:
//   KARGO_URL=http://localhost:8080 DATABASE_URL=… CRON_SECRET=… node --test test/admin-api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const totp = require('../src/totp');
const { Pool } = require('pg');
const B = process.env.KARGO_URL || 'http://localhost:8080';
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const rnd = Math.random().toString(36).slice(2, 8);
const TWO = process.env.ADMIN_REQUIRE_2FA === 'true'; // TODO(2FA): two-step sign-in is off by default for now
const cron = () => fetch(B + '/api/cron/reminders', { headers: { Authorization: 'Bearer ' + process.env.CRON_SECRET } }).then((r) => r.json());

/** a tiny browser: keeps the admin cookie and sends the anti-CSRF header */
function adminClient() {
  let cookie = '';
  const call = async (method, p, body, extra = {}) => {
    const headers = Object.assign({ 'x-kargo-admin': '1' }, extra); if (cookie) headers.cookie = cookie; if (body) headers['content-type'] = 'application/json';
    const r = await fetch(B + p, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/(__Host-kargo_adm=[^;]*)/); if (m) cookie = m[1].endsWith('=') ? '' : m[1]; }
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), setCookie: sc, headers: r.headers };
  };
  return { call, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}
async function api(method, p, token, body) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token; if (body) headers['content-type'] = 'application/json';
  const r = await fetch(B + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}
const cli = (...args) => execFileSync('node', [path.join(__dirname, '..', 'scripts', 'admin.js'), ...args], { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); // errors land in the thrown message, not the console
const tempPw = (out) => out.match(/\(shown once\):\s+(\S+)/)[1];
/** full first sign-in: password → set up authenticator → change password. Returns {c, secret, recovery} */
async function firstSignIn(email, temp, newPw) {
  const c = adminClient();
  const l = await c.call('POST', '/api/admin/auth/login', { email, password: temp }); assert.equal(l.status, 200, JSON.stringify(l.body));
  if (!TWO) { assert.equal(l.body.next, 'done'); const pw0 = await c.call('POST', '/api/admin/auth/password', { current: temp, password: newPw }); assert.equal(pw0.status, 200, JSON.stringify(pw0.body)); return { c }; }
  assert.equal(l.body.next, 'setup');
  const secret = l.body.secret.replace(/\s/g, '');
  const v = await c.call('POST', '/api/admin/auth/verify', { ticket: l.body.ticket, code: totp.codeAt(secret, totp.stepNow()) }); assert.equal(v.status, 200, JSON.stringify(v.body));
  const pw = await c.call('POST', '/api/admin/auth/password', { current: temp, password: newPw }); assert.equal(pw.status, 200, JSON.stringify(pw.body));
  return { c, secret, recovery: v.body.recoveryCodes, verify: v };
}
const S = {};
test.after(() => db.end());
/** sign in an existing admin (n: which recovery code to use when two-step is on) */
async function signIn(c, n) {
  const l = await c.call('POST', '/api/admin/auth/login', { email: S.ownerEmail, password: S.pw }); assert.equal(l.status, 200, JSON.stringify(l.body));
  if (TWO) await c.call('POST', '/api/admin/auth/verify', { ticket: l.body.ticket, recoveryCode: S.recovery[n] });
}
/** confirm a risky action: password (two-step off) or a recovery code */
const reauthBody = (n) => (TWO ? { recoveryCode: S.recovery[n] } : { password: S.pw });
/** the Super Admin adds an admin in the dashboard; returns the temporary password */
async function addAdmin(email, name, role) {
  await db.query("UPDATE admin_sessions SET reauth_at = now() WHERE revoked_at IS NULL AND admin_id=(SELECT id FROM platform_admins WHERE email=$1)", [S.ownerEmail]);
  const r = await S.c.call('POST', '/api/admin/admins', { email, name, role, sendEmail: false }); assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

test('the admin does not exist for strangers or business users', async () => {
  const anon = await api('GET', '/api/admin/me'); assert.equal(anon.status, 404); assert.deepEqual(anon.body, { error: 'Not found' });
  const reg = await api('POST', '/api/auth/register', null, { businessName: 'Biz ' + rnd, name: 'Owner Biz', login: 'biz' + rnd, password: 'secret1', email: 'biz' + rnd + '@shop.test' });
  S.biz = reg.body.token;
  assert.equal((await api('GET', '/api/admin/overview', S.biz)).status, 404, 'a business token means nothing here');
  assert.equal((await api('GET', '/api/admin/nope')).status, 404);
  const app = await fetch(B + '/'); assert.equal(app.headers.get('content-security-policy'), null, 'the business app keeps its own headers'); assert.equal(app.headers.get('x-robots-tag'), null);
  const page = await fetch(B + '/admin'); assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow'); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('first sign-in: password' + (TWO ? ', authenticator setup, recovery codes' : ' only (two-step is off)') + ', forced password change', async () => {
  S.ownerEmail = 'boss' + rnd + '@kargo.test';
  await db.query("UPDATE platform_admins SET role='admin' WHERE role='super'"); // test database only: earlier runs left a Super Admin
  const out = cli('create', '--email', S.ownerEmail, '--name', 'Boss Owner'); S.temp = tempPw(out);
  assert.match(out, /Super Admin created/);
  assert.throws(() => cli('create', '--email', 'second' + rnd + '@kargo.test', '--name', 'Second Super'), /Super Admin already exists/, 'only one Super Admin');
  assert.match(cli('list'), new RegExp(S.ownerEmail));
  const c = adminClient();
  assert.equal((await c.call('POST', '/api/admin/auth/login', { email: S.ownerEmail, password: 'wrong-password' })).status, 401);
  assert.equal((await c.call('POST', '/api/admin/auth/login', { email: 'nobody@x.test', password: 'x' })).body.error, 'Wrong email or password', 'same answer for unknown emails');
  if (!TWO) {
    const l = await c.call('POST', '/api/admin/auth/login', { email: S.ownerEmail, password: S.temp });
    assert.equal(l.status, 200); assert.equal(l.body.next, 'done', 'no code asked while two-step is off'); assert.equal(l.body.mustChangePassword, true);
    assert.match(l.setCookie, /^__Host-kargo_adm=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800/);
  } else {
    const l = await c.call('POST', '/api/admin/auth/login', { email: S.ownerEmail, password: S.temp });
    assert.equal(l.body.next, 'setup'); assert.match(l.body.qr, /^<svg/); assert.match(l.body.otpauth, /^otpauth:\/\/totp\//);
    const secret = l.body.secret.replace(/\s/g, ''); S.secret = secret;
    assert.equal((await c.call('POST', '/api/admin/auth/verify', { ticket: l.body.ticket, code: '000000' })).status, 401);
    const v = await c.call('POST', '/api/admin/auth/verify', { ticket: l.body.ticket, code: totp.codeAt(secret, totp.stepNow()) });
    assert.equal(v.status, 200); assert.equal(v.body.recoveryCodes.length, 10); assert.equal(v.body.mustChangePassword, true); S.recovery = v.body.recoveryCodes;
    assert.match(v.setCookie, /^__Host-kargo_adm=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800/);
    const row = (await db.query('SELECT totp_secret, recovery_codes FROM platform_admins WHERE email=$1', [S.ownerEmail])).rows[0];
    assert.ok(row.totp_secret.startsWith('v1.') && !row.totp_secret.includes(secret), 'secret stored encrypted');
    assert.ok(!JSON.stringify(row.recovery_codes).includes(S.recovery[0]), 'recovery codes stored hashed');
    assert.equal((await c.call('POST', '/api/admin/auth/verify', { ticket: l.body.ticket, code: totp.codeAt(secret, totp.stepNow()) })).status, 401, 'a ticket works once');
  }
  // must change the password before anything else
  assert.equal((await c.call('GET', '/api/admin/overview')).body.code, 'change_password');
  assert.equal((await c.call('POST', '/api/admin/auth/password', { current: S.temp, password: 'short' })).status, 400);
  assert.equal((await c.call('POST', '/api/admin/auth/password', { current: S.temp, password: 'Correct-Horse-' + rnd }, { 'x-kargo-admin': '' })).status, 403, 'missing anti-CSRF header');
  assert.equal((await c.call('POST', '/api/admin/auth/password', { current: S.temp, password: 'Correct-Horse-' + rnd }, { origin: 'https://evil.example' })).status, 403, 'wrong origin');
  assert.equal((await c.call('POST', '/api/admin/auth/password', { current: S.temp, password: 'Correct-Horse-' + rnd })).status, 200);
  S.pw = 'Correct-Horse-' + rnd; S.c = c;
  assert.equal((await c.call('GET', '/api/admin/overview')).status, 200);
  const me = (await c.call('GET', '/api/admin/me')).body; assert.equal(me.admin.role, 'super'); assert.equal(me.roleName, 'Super Admin'); assert.ok(Array.isArray(me.security));
});

test('password-only sign-in (two-step off): no code needed, logout ends the session', { skip: TWO && 'two-step is on' }, async () => {
  const c = adminClient(); const l = await c.call('POST', '/api/admin/auth/login', { email: S.ownerEmail, password: S.pw });
  assert.equal(l.body.next, 'done'); assert.equal((await c.call('GET', '/api/admin/me')).body.twoFactor, false);
  assert.equal((await c.call('POST', '/api/admin/auth/verify', { ticket: 'x', code: '123456' })).status, 401, 'the code step is not a way in');
  assert.equal((await c.call('POST', '/api/admin/auth/logout')).status, 200); assert.equal((await c.call('GET', '/api/admin/me')).status, 404);
});
test('second sign-in needs a fresh code; codes cannot be reused; recovery code works once', { skip: !TWO && 'two-step sign-in is off (ADMIN_REQUIRE_2FA)' }, async () => {
  const c = adminClient();
  const l = await c.call('POST', '/api/admin/auth/login', { email: S.ownerEmail, password: S.pw }); assert.equal(l.body.next, 'totp');
  const used = (await db.query('SELECT totp_last_step FROM platform_admins WHERE email=$1', [S.ownerEmail])).rows[0].totp_last_step;
  assert.equal((await c.call('POST', '/api/admin/auth/verify', { ticket: l.body.ticket, code: totp.codeAt(S.secret, Number(used)) })).status, 401, 'the same code twice is refused');
  const v = await c.call('POST', '/api/admin/auth/verify', { ticket: l.body.ticket, recoveryCode: S.recovery[0].toLowerCase() });
  assert.equal(v.status, 200); assert.equal(v.body.recoveryLeft, 9);
  const l2 = await adminClient().call('POST', '/api/admin/auth/login', { email: S.ownerEmail, password: S.pw });
  assert.equal((await adminClient().call('POST', '/api/admin/auth/verify', { ticket: l2.body.ticket, recoveryCode: S.recovery[0] })).status, 401, 'recovery code used up');
  // log out ends the session on the server
  assert.equal((await c.call('POST', '/api/admin/auth/logout')).status, 200);
  assert.equal((await c.call('GET', '/api/admin/me')).status, 404);
});

test('sessions: idle timeout and revocation', async () => {
  const c = adminClient(); await signIn(c, 1);
  assert.equal((await c.call('GET', '/api/admin/me')).status, 200);
  await db.query("UPDATE admin_sessions SET last_seen_at = now() - interval '31 minutes' WHERE revoked_at IS NULL AND admin_id = (SELECT id FROM platform_admins WHERE email=$1)", [S.ownerEmail]);
  assert.equal((await c.call('GET', '/api/admin/me')).status, 404, 'idle 30 min → signed out');
  assert.equal((await S.c.call('GET', '/api/admin/me')).status, 404, 'other sessions too (they were idle in this test)');
  // sign in again for the rest of the tests
  const c2 = adminClient(); await signIn(c2, 2); S.c = c2;
  assert.equal((await c2.call('GET', '/api/admin/me')).status, 200);
});

test('plans: risky changes need the code again', async () => {
  await db.query("UPDATE admin_sessions SET reauth_at = now() - interval '10 minutes' WHERE revoked_at IS NULL");
  const plan = { name: 'Starter', description: 'One shop', price_monthly: 10000, price_yearly: 100000, active: true, public: true, sort: 1, features: ['1 shop', '2 team members'], limits: { maxUsers: 2, maxLocations: 1, onlineShop: false } };
  const r = await S.c.call('PUT', '/api/admin/plans/starter', plan); assert.equal(r.status, 403); assert.equal(r.body.code, 'reauth');
  if (!TWO) assert.equal((await S.c.call('POST', '/api/admin/auth/reauth', { password: 'wrong-' + rnd })).status, 401, 'wrong password');
  assert.equal((await S.c.call('POST', '/api/admin/auth/reauth', reauthBody(3))).status, 200);
  assert.equal((await S.c.call('PUT', '/api/admin/plans/starter', plan)).status, 200);
  assert.equal((await S.c.call('PUT', '/api/admin/plans/business', { name: 'Business', price_monthly: 25000, price_yearly: null, active: true, public: true, sort: 2, features: ['Branches'], limits: {} })).status, 200);
  assert.equal((await S.c.call('PUT', '/api/admin/plans/enterprise', { name: 'Enterprise', price_monthly: null, price_yearly: null, active: true, public: true })).status, 400, 'no price → cannot be shown');
  assert.equal((await S.c.call('POST', '/api/admin/plans', { id: 'trial', name: 'X', price_monthly: 1 })).status, 400);
  const plans = (await S.c.call('GET', '/api/admin/plans')).body.plans; assert.equal(plans.find((p) => p.id === 'starter').limits.maxUsers, 2);
});

test('business: trial → chooses a plan → reports payment → admin confirms → active with limits', async () => {
  const tid = (await db.query("SELECT tenant_id FROM users WHERE login=$1", ['biz' + rnd])).rows[0].tenant_id; S.tid = tid;
  let bill = (await api('GET', '/api/billing', S.biz)).body;
  assert.equal(bill.subscription.status, 'trialing'); assert.deepEqual(bill.plans.map((p) => p.id), ['starter', 'business']);
  // trial: no limits
  for (const n of [1, 2]) assert.equal((await api('POST', '/api/users', S.biz, { name: 'U' + n, login: 'u' + n + rnd, password: 'pass1234', role: 'sales', sendEmail: false })).status, 200);
  const ch = await api('POST', '/api/billing/choose', S.biz, { planId: 'starter', cycle: 'monthly' }); assert.equal(ch.status, 200); assert.equal(ch.body.invoice.amount, 10000);
  assert.equal((await api('POST', '/api/billing/choose', S.biz, { planId: 'starter', cycle: 'monthly' })).body.reused, true, 'no duplicate invoice');
  const inv = ch.body.invoice;
  assert.equal((await api('POST', '/api/billing/invoices/' + inv.id + '/claim', S.biz, { method: 'MTN MoMo', reference: '12' })).status, 400, 'reference required');
  assert.equal((await api('POST', '/api/billing/invoices/' + inv.id + '/claim', S.biz, { method: 'MTN MoMo', reference: 'MP' + rnd })).status, 200);
  assert.equal((await api('POST', '/api/billing/invoices/' + inv.id + '/claim', S.biz, { method: 'MTN MoMo', reference: 'MP2' + rnd })).status, 409, 'one pending claim at a time');
  const pend = (await S.c.call('GET', '/api/admin/payments?status=pending')).body.payments.find((p) => p.invoice_id === inv.id); assert.ok(pend);
  assert.equal((await S.c.call('POST', '/api/admin/payments/' + pend.id + '/confirm')).status, 200);
  bill = (await api('GET', '/api/billing', S.biz)).body;
  assert.equal(bill.subscription.status, 'active'); assert.equal(bill.subscription.planId, 'starter'); assert.equal(bill.subscription.price, 10000);
  const days = (new Date(bill.subscription.periodEnd) - Date.now()) / 864e5; assert.ok(days > 27 && days < 32, 'one month: ' + days);
  assert.equal(bill.invoices[0].status, 'paid');
  const me = (await api('GET', '/api/me', S.biz)).body; assert.equal(me.tenant.plan, 'starter'); assert.equal(me.subscription.status, 'active'); assert.equal(me.limits.maxUsers, 2);
  // limits now apply: 3 active users > 2
  const add = await api('POST', '/api/users', S.biz, { name: 'U3', login: 'u3' + rnd, password: 'pass1234', role: 'sales', sendEmail: false });
  assert.equal(add.status, 402); assert.equal(add.body.code, 'plan_limit'); assert.match(add.body.error, /allows 2 team members/);
  const shop = await api('PUT', '/api/data/settings/main', S.biz, { businessName: 'Biz', shopEnabled: true, shopSlug: 'biz-' + rnd });
  assert.equal(shop.status, 402); assert.match(shop.body.error, /online shop is not included/i);
  assert.equal((await api('PUT', '/api/data/locations/br1', S.biz, { name: 'Branch 1' })).status, 402, 'maxLocations 1 = main only');
  // the business is told by email
  const mails = await (await fetch('http://127.0.0.1:18090/_emails')).json();
  assert.ok(mails.some((m) => m.to.includes('biz' + rnd + '@shop.test') && /invoice/i.test(m.subject)), 'invoice emailed');
  assert.ok(mails.some((m) => m.to.includes('biz' + rnd + '@shop.test') && /Payment received/.test(m.subject)), 'receipt emailed');
  assert.ok(mails.some((m) => m.to.includes('alerts@kargo.test') && /Payment to check/.test(m.subject)), 'platform told about the claim');
});

test('admin: change plan, record payment, renewal keeps the price, suspend needs reason + code', async () => {
  assert.equal((await S.c.call('POST', '/api/admin/tenants/' + S.tid + '/subscription', { action: 'change_plan', planId: 'business', cycle: 'monthly' })).status, 400, 'reason required');
  assert.equal((await S.c.call('POST', '/api/admin/tenants/' + S.tid + '/subscription', { action: 'change_plan', planId: 'business', cycle: 'monthly', price: 20000, reason: 'Launch discount' })).status, 200);
  assert.equal((await api('POST', '/api/users', S.biz, { name: 'U3', login: 'u3' + rnd, password: 'pass1234', role: 'sales', sendEmail: false })).status, 200, 'no limit on Business');
  // price of the plan goes up: this business keeps 20,000 at renewal
  await db.query("UPDATE admin_sessions SET reauth_at = now() WHERE revoked_at IS NULL");
  assert.equal((await S.c.call('PUT', '/api/admin/plans/business', { name: 'Business', price_monthly: 30000, active: true, public: true, sort: 2, limits: {} })).status, 200);
  await db.query("UPDATE subscriptions SET current_period_end = now() + interval '3 days' WHERE tenant_id=$1", [S.tid]);
  const run1 = await cron(); assert.equal(run1.emails.billing.invoices >= 1, true, JSON.stringify(run1));
  await cron(); // a second run makes no second invoice
  const invs = (await db.query("SELECT * FROM invoices WHERE tenant_id=$1 AND plan_id='business'", [S.tid])).rows;
  assert.equal(invs.length, 1); assert.equal(invs[0].amount, 20000, 'renewal at the price they signed up for'); assert.equal(invs[0].created_by, 'system');
  // admin records the payment by hand → period extends from the current end
  const before = (await db.query('SELECT current_period_end FROM subscriptions WHERE tenant_id=$1', [S.tid])).rows[0].current_period_end;
  const pay = await S.c.call('POST', '/api/admin/payments', { tenantId: S.tid, invoiceId: invs[0].id, amount: 20000, method: 'Orange Money', reference: 'OM' + rnd, paidOn: '2026-11-16' });
  assert.equal(pay.status, 200, JSON.stringify(pay.body)); assert.equal(pay.body.invoice.status, 'paid');
  const after = (await db.query('SELECT current_period_end FROM subscriptions WHERE tenant_id=$1', [S.tid])).rows[0].current_period_end;
  assert.ok(new Date(after) - new Date(before) > 27 * 864e5, 'extended by a month from the old end');
  assert.equal((await S.c.call('POST', '/api/admin/payments', { tenantId: S.tid, amount: 500, method: 'Orange Money', reference: 'OM' + rnd })).status, 409, 'same reference twice');
  // suspend: needs a fresh code and a reason
  await db.query("UPDATE admin_sessions SET reauth_at = now() - interval '10 minutes' WHERE revoked_at IS NULL");
  assert.equal((await S.c.call('POST', '/api/admin/tenants/' + S.tid + '/subscription', { action: 'suspend', reason: 'Fraud check' })).body.code, 'reauth');
  await S.c.call('POST', '/api/admin/auth/reauth', reauthBody(4));
  assert.equal((await S.c.call('POST', '/api/admin/tenants/' + S.tid + '/subscription', { action: 'suspend', reason: 'Fraud check' })).status, 200);
  assert.equal((await api('PUT', '/api/data/products/px', S.biz, { name: 'X', category: 'Beauty' })).status, 402, 'suspended: cannot record');
  assert.equal((await api('GET', '/api/data/products', S.biz)).status, 200, 'suspended: can still read / export');
  assert.equal((await S.c.call('POST', '/api/admin/tenants/' + S.tid + '/subscription', { action: 'reactivate', reason: 'Cleared' })).status, 200);
  assert.equal((await api('PUT', '/api/data/products/px', S.biz, { name: 'X', category: 'Beauty' })).status, 200);
});

test('lifecycle: past due keeps working during grace, then read-only', async () => {
  await db.query("UPDATE subscriptions SET current_period_end = now() - interval '1 day' WHERE tenant_id=$1", [S.tid]);
  await cron(); assert.equal((await db.query('SELECT status FROM subscriptions WHERE tenant_id=$1', [S.tid])).rows[0].status, 'past_due');
  assert.equal((await api('PUT', '/api/data/products/py', S.biz, { name: 'Y', category: 'Beauty' })).status, 200, 'grace period');
  await db.query("UPDATE subscriptions SET current_period_end = now() - interval '9 days' WHERE tenant_id=$1", [S.tid]);
  await cron(); assert.equal((await db.query('SELECT status FROM subscriptions WHERE tenant_id=$1', [S.tid])).rows[0].status, 'expired');
  assert.equal((await api('PUT', '/api/data/products/pz', S.biz, { name: 'Z', category: 'Beauty' })).status, 402);
  assert.equal((await api('GET', '/api/billing', S.biz)).status, 200, 'an expired business can still open Billing to pay');
  await S.c.call('POST', '/api/admin/tenants/' + S.tid + '/subscription', { action: 'extend_period', days: 30 });
  assert.equal((await api('PUT', '/api/data/products/pz', S.biz, { name: 'Z', category: 'Beauty' })).status, 200, 'extended → works again');
  // a trial that ends
  const r2 = await api('POST', '/api/auth/register', null, { businessName: 'Trial ' + rnd, name: 'T', login: 'trial' + rnd, password: 'secret1' });
  const t2 = (await db.query('SELECT tenant_id FROM users WHERE login=$1', ['trial' + rnd])).rows[0].tenant_id;
  await db.query("UPDATE subscriptions SET trial_ends_at = now() - interval '1 hour' WHERE tenant_id=$1", [t2]); await cron();
  assert.equal((await db.query('SELECT status FROM subscriptions WHERE tenant_id=$1', [t2])).rows[0].status, 'expired');
  assert.equal((await api('PUT', '/api/data/products/p1', r2.body.token, { name: 'A', category: 'Beauty' })).status, 402);
  assert.equal((await S.c.call('POST', '/api/admin/tenants/' + t2 + '/subscription', { action: 'extend_trial', days: 7 })).status, 200);
  assert.equal((await api('PUT', '/api/data/products/p1', r2.body.token, { name: 'A', category: 'Beauty' })).status, 200, 'trial extended');
});

test('support view is read-only and visible to the business; owner password reset', async () => {
  await db.query("UPDATE admin_sessions SET reauth_at = now() WHERE revoked_at IS NULL");
  assert.equal((await S.c.call('POST', '/api/admin/tenants/' + S.tid + '/view', {})).status, 400, 'reason required');
  const v = await S.c.call('POST', '/api/admin/tenants/' + S.tid + '/view', { reason: 'Customer asked why a sale is missing' });
  assert.equal(v.status, 200); const tok = decodeURIComponent(v.body.url.split('#imp=')[1]);
  const me = await api('GET', '/api/me', tok); assert.equal(me.status, 200); assert.equal(me.body.supportView.by, 'Boss Owner');
  const w = await api('PUT', '/api/data/products/pq', tok, { name: 'Q' }); assert.equal(w.status, 403); assert.equal(w.body.code, 'read_only');
  const today = new Date().toISOString().slice(0, 10);
  const act = (await api('GET', '/api/activity?from=' + today + '&to=' + today, S.biz)).body;
  assert.ok(JSON.stringify(act).includes('Kargo support viewed your account'), 'the owner sees it in the activity log');
  const rp = await S.c.call('POST', '/api/admin/tenants/' + S.tid + '/reset-owner-password', { reason: 'Owner locked out, called support' });
  assert.equal(rp.status, 200); assert.equal((await api('POST', '/api/auth/login', null, { login: 'biz' + rnd, password: rp.body.password })).status, 200);
});

test('roles: support and finance only do their part; lockout after 5 failures', async () => {
  const sup = await addAdmin('sup' + rnd + '@kargo.test', 'Sam Support', 'support');
  const s = await firstSignIn('sup' + rnd + '@kargo.test', sup.password, 'Support-Pass-' + rnd);
  assert.equal((await s.c.call('GET', '/api/admin/tenants')).status, 200);
  assert.equal((await s.c.call('GET', '/api/admin/invoices')).status, 403, 'support: no billing');
  assert.equal((await s.c.call('PUT', '/api/admin/plans/starter', { name: 'Hack', price_monthly: 1 })).status, 403);
  assert.equal((await s.c.call('POST', '/api/admin/tenants/' + S.tid + '/subscription', { action: 'extend_period', days: 365 })).status, 403);
  assert.equal((await s.c.call('GET', '/api/admin/audit')).status, 403);
  const fin = await addAdmin('fin' + rnd + '@kargo.test', 'Fiona Finance', 'finance');
  const f = await firstSignIn('fin' + rnd + '@kargo.test', fin.password, 'Finance-Pass-' + rnd);
  assert.equal((await f.c.call('GET', '/api/admin/invoices')).status, 200);
  assert.equal((await f.c.call('POST', '/api/admin/tenants/' + S.tid + '/view', { reason: 'curious' })).status, 403, 'finance cannot view as owner');
  assert.equal((await f.c.call('GET', '/api/admin/support')).status, 403);
  // lockout
  const x = adminClient();
  for (let i = 0; i < 5; i++) assert.equal((await x.call('POST', '/api/admin/auth/login', { email: 'fin' + rnd + '@kargo.test', password: 'nope' + i })).status, 401);
  assert.equal((await x.call('POST', '/api/admin/auth/login', { email: 'fin' + rnd + '@kargo.test', password: 'Finance-Pass-' + rnd })).status, 429, 'locked even with the right password');
  const mails = await (await fetch('http://127.0.0.1:18090/_emails')).json();
  assert.ok(mails.some((m) => m.to.includes('alerts@kargo.test') && /locked/i.test(m.subject)), 'lockout alert');
  assert.ok(mails.some((m) => m.to.includes(S.ownerEmail) && /Sign-in to Kargo admin/.test(m.subject)), 'sign-in alert');
  cli('unlock', '--email', 'fin' + rnd + '@kargo.test');
});

test('only the Super Admin adds admins and changes roles; the Super Admin cannot be changed', async () => {
  await db.query("UPDATE admin_sessions SET reauth_at = now() - interval '10 minutes' WHERE revoked_at IS NULL");
  const body = { name: 'Nadia New', email: 'nadia' + rnd + '@kargo.test', role: 'support' };
  const r0 = await S.c.call('POST', '/api/admin/admins', body); assert.equal(r0.body.code, 'reauth', 'confirming is required');
  assert.equal((await S.c.call('POST', '/api/admin/auth/reauth', reauthBody(5))).status, 200);
  assert.equal((await S.c.call('POST', '/api/admin/admins', Object.assign({}, body, { email: 'bad' }))).status, 400);
  assert.equal((await S.c.call('POST', '/api/admin/admins', Object.assign({}, body, { role: 'god' }))).status, 400);
  const r = await S.c.call('POST', '/api/admin/admins', body); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.password.length >= 18); assert.equal(r.body.emailed, 'sent');
  const mails = await (await fetch('http://127.0.0.1:18090/_emails')).json();
  assert.ok(mails.some((m) => m.to.includes(body.email) && /admin account/i.test(m.subject) && m.html.includes(r.body.password)), 'invite emailed');
  assert.equal((await S.c.call('POST', '/api/admin/admins', body)).status, 409, 'no duplicates');
  // the new admin signs in and must choose a password first
  const n = await firstSignIn(body.email, r.body.password, 'Nadia-Own-Pass-' + rnd);
  assert.equal((await n.c.call('GET', '/api/admin/me')).body.admin.role, 'support');
  assert.equal((await n.c.call('POST', '/api/admin/admins', { name: 'Eve Evil', email: 'eve' + rnd + '@x.test', role: 'admin' })).status, 403, 'support cannot add admins');
  assert.equal((await S.c.call('POST', '/api/admin/admins', { name: 'Two Supers', email: 'two' + rnd + '@x.test', role: 'super' })).status, 400, 'no second Super Admin from the dashboard');
  // an Admin can do everything except manage admins
  const adm = await addAdmin('adm' + rnd + '@kargo.test', 'Ada Admin', 'admin');
  const ac = await firstSignIn('adm' + rnd + '@kargo.test', adm.password, 'Ada-Admin-Pass-' + rnd);
  assert.equal((await ac.c.call('GET', '/api/admin/invoices')).status, 200); assert.equal((await ac.c.call('GET', '/api/admin/plans')).status, 200);
  await db.query("UPDATE admin_sessions SET reauth_at = now() WHERE revoked_at IS NULL");
  assert.equal((await ac.c.call('POST', '/api/admin/admins', { name: 'Eve Evil', email: 'eve2' + rnd + '@x.test', role: 'support' })).status, 403, 'an Admin cannot add admins');
  assert.equal((await ac.c.call('POST', '/api/admin/admins/' + adm.admin.id + '/role', { role: 'support' })).status, 403);
  assert.equal((await ac.c.call('GET', '/api/admin/admins')).body.admins.length, 1, 'an Admin sees only their own account');
  // nobody changes the Super Admin from the dashboard
  const sup = (await S.c.call('GET', '/api/admin/me')).body.admin;
  const ids = (await S.c.call('GET', '/api/admin/admins')).body.admins; assert.ok(ids.some((x) => x.role === 'super'));
  assert.equal((await S.c.call('POST', '/api/admin/admins/' + sup.id + '/deactivate')).status, 400);
  // role change, and the last owner is protected
  const id = r.body.admin.id;
  assert.equal((await S.c.call('POST', '/api/admin/admins/' + id + '/role', { role: 'finance' })).status, 200);
  assert.equal((await n.c.call('GET', '/api/admin/invoices')).status, 200, 'now finance');
  assert.equal((await S.c.call('POST', '/api/admin/admins/' + sup.id + '/role', { role: 'support' })).status, 400, 'not your own role');
  const log = (await S.c.call('GET', '/api/admin/audit?action=admin_')).body.entries.map((e) => e.action);
  assert.ok(log.includes('admin_created') && log.includes('admin_role_changed'));
});
test('audit log is complete and cannot be edited; support inbox; CSV export is formula-safe', async () => {
  const log = (await S.c.call('GET', '/api/admin/audit')).body.entries.map((e) => e.action);
  for (const a of [TWO ? 'login_2fa_setup' : 'login', 'plan_updated', 'payment_confirmed', 'subscription_suspend', 'view_as_owner', 'owner_password_reset', 'login_locked', 'admin_created']) assert.ok(log.includes(a), 'audit has ' + a);
  await assert.rejects(db.query('DELETE FROM admin_audit'), /append-only/);
  await assert.rejects(db.query("UPDATE admin_audit SET action='x'"), /append-only/);
  // support
  assert.equal((await api('POST', '/api/support', S.biz, { topic: 'Something is not working', message: 'The PDF receipt is blank', page: 'sales' })).status, 200);
  const t = (await S.c.call('GET', '/api/admin/support?status=open')).body.tickets.find((k) => k.tenant_id === S.tid); assert.ok(t);
  const rep = await S.c.call('POST', '/api/admin/support/' + t.id + '/reply', { body: 'Fixed — please update the app.' }); assert.equal(rep.status, 200); assert.equal(rep.body.emailed, 'sent');
  assert.equal((await S.c.call('GET', '/api/admin/support/' + t.id)).body.messages.length, 2);
  // export
  await db.query("INSERT INTO payments (tenant_id, amount, method, reference, paid_on, status) VALUES ($1, 100, 'Cash', $2, current_date, 'confirmed')", [S.tid, '=HYPERLINK(' + rnd + ')']);
  const csv = await S.c.call('GET', '/api/admin/export/payments'); assert.equal(csv.status, 200); assert.ok(csv.body.includes("'=HYPERLINK(" + rnd + ")") && !/,=HYPERLINK/.test(csv.body));
});

test('ADMIN_HOST: the admin answers only on its host, and the business app never there', async () => {
  // a second server on the same database with ADMIN_HOST set
  const { spawn } = require('node:child_process');
  const srv = spawn('node', ['src/index.js'], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PORT: '18099', ADMIN_HOST: 'admin.kargo.test', REMINDERS_DISABLED: 'true', EMAILS_SCHEDULER_DISABLED: 'true' }), stdio: 'ignore' });
  try {
    const get = (host, p) => new Promise((res) => { const req = http.get({ host: '127.0.0.1', port: 18099, path: p, headers: { host } }, (r) => { r.resume(); res({ status: r.statusCode, location: r.headers.location }); }); req.on('error', () => res({ status: 0 })); });
    for (let i = 0; i < 50 && (await get('app.kargo.test', '/healthz')).status !== 200; i++) await new Promise((r) => setTimeout(r, 200));
    assert.equal((await get('app.kargo.test', '/admin')).status, 404, 'not on the business host');
    assert.equal((await get('app.kargo.test', '/api/admin/me')).status, 404);
    assert.equal((await get('admin.kargo.test', '/admin')).status, 200);
    const root = await get('admin.kargo.test', '/'); assert.equal(root.status, 302); assert.equal(root.location, '/admin');
    assert.equal((await get('admin.kargo.test', '/api/me')).status, 404, 'business API not on the admin host');
    assert.equal((await get('admin.kargo.test', '/index.html')).status, 404, 'business app not on the admin host');
  } finally { srv.kill(); }
});
