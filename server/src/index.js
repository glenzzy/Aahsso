/* Aahsso SaaS API + static frontend.
 * Multi-tenant: every row is scoped by tenant_id taken from the signed JWT, never from the request body. */
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { q, tx, pool } = require('./db');
const KC = require('../public/compute.js'); // same business logic as the browser
const mailer = require('./mailer');
const { migrate } = require('./migrate');
const billing = require('./billing');
const momo = require('./fapshi'); // mobile money (Fapshi)
const mountAdmin = require('./admin');
/* The database schema is brought up to date before the first request is served (also on Vercel, where there is no start
   script). If it fails, requests get a clear 503 instead of odd errors, and the next request tries again. */
let schemaReady = null;
const ensureSchema = () => (schemaReady = schemaReady || migrate({ quiet: true }).catch((e) => { schemaReady = null; throw e; }));
if (process.env.MOMO_FEE_TABLES) {
  try {
    const tables = JSON.parse(process.env.MOMO_FEE_TABLES);
    if (tables && typeof tables === 'object' && !Array.isArray(tables)) KC.DEFAULT_SETTINGS.momoFeeTables = tables;
    else console.warn('MOMO_FEE_TABLES ignored: expected a JSON object of method → tiers');
  } catch (e) { console.warn('MOMO_FEE_TABLES is not valid JSON:', e.message); }
}

const PORT = process.env.PORT || 8080;
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) { console.error('Set JWT_SECRET (16+ chars) in .env'); process.exit(1); }

const COLLECTIONS = ['settings', 'products', 'lots', 'shipments', 'customers', 'sales', 'adjustments', 'expenses', 'locations', 'transfers', 'handovers', 'suppliers', 'bills', 'reminders', 'audits', 'assets', 'orders', 'promos', 'staff', 'attendance', 'leaves', 'payroll', 'tills', 'losses', 'claims', 'menu', 'areas', 'tables', 'tabs', 'rorders', 'reservations'];
// Which permissions allow writing each collection (any one of them). Permission model lives in compute.js.
const WRITE_PERMS = {
  settings: ['settings'], products: ['stockEdit', 'purchases'], lots: ['purchases', 'containers'], shipments: ['containers'],
  adjustments: ['stockEdit'], expenses: ['expenses'], customers: ['customers', 'sell'], sales: ['sell', 'payments', 'returns', 'cancel'],
  locations: ['settings'], transfers: ['transfers'], handovers: ['payments', 'handover'], suppliers: ['suppliers', 'purchases', 'containers'],
  bills: ['suppliers', 'purchases', 'containers', 'assets'], reminders: ['reminders'], audits: ['audit', 'stockEdit'], assets: ['assets'],
  orders: ['sell', 'payments'], // online-shop orders: staff confirm / reject them
  promos: ['stockEdit'], // promotions: whoever sets prices
  staff: ['hr', 'payroll'], payroll: ['payroll'], tills: ['payments', 'handover'],
  losses: ['lossReport', 'stockEdit'], // staff report losses; a manager approves them (checked below)
  claims: ['suppliers', 'purchases', 'containers', 'stockEdit'], // returns to suppliers and claims: money owed back
  attendance: null, leaves: null, // everyone clocks in and asks for leave for themselves (checked below)
  // Bar & Resto
  menu: ['menu'], areas: ['tables'], tables: ['tables', 'serve', 'bills'], tabs: ['serve', 'bills'], rorders: ['serve', 'bills', 'kds'], reservations: ['reservations'],
};
const DELETE_PERMS = { menu: ['menu'], areas: ['tables'], tables: ['tables'], reservations: ['reservations'], products: ['stockEdit'], lots: ['purchases'], shipments: ['containers'], adjustments: ['stockEdit'], expenses: ['expenses'], customers: ['customers'], bills: ['suppliers'], suppliers: ['suppliers'], assets: ['assets'], orders: ['cancel'], promos: ['stockEdit'], staff: ['hr'], attendance: ['hr'], leaves: ['hr'], payroll: ['payroll'] };
const grp = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); // 25,000
const perms = (u) => {
  const f = u.features || {};
  const base = KC.featureOn(f, 'customRoles') ? KC.permsFor({ role: u.role, perms: u.perms || {} }, u.customRoles) : KC.permsFor({ role: u.role }, {}); // no custom roles in the plan → standard roles only
  return KC.permsWithFeatures(base, f); // a permission whose feature is not in the plan is never granted
};
/** 402 when none of the features is in the business's plan */
const planOff = (res, key) => err(res, 402, (billing.FEATURES[key] || 'This feature') + ' is not included in your plan. Upgrade in Billing & subscription to use it.', { code: 'plan_feature', feature: key });
const requireFeature = (...keys) => (req, res, next) => (KC.anyOn(req.user.features, keys) ? next() : err(res, 402, (billing.FEATURES[keys[0]] || 'This feature') + ' is not included in your plan. Upgrade in Billing & subscription to use it.', { code: 'plan_feature', feature: keys[0] }));
// a client may propose a transaction id (offline-created records); otherwise the server makes one
const TXN_RE = /^[A-Za-z0-9][A-Za-z0-9\-]{3,39}$/;
async function tenantSettings(c, tid) {
  const r = (await c.query("SELECT data FROM documents WHERE tenant_id=$1 AND collection='settings' AND id='main'", [tid])).rows[0];
  return Object.assign({}, KC.DEFAULT_SETTINGS, (r && r.data) || {});
}
const canU = (u, p) => !!perms(u)[p];
const anyU = (u, list) => (list || []).some((p) => canU(u, p));
const cleanEmail = (v) => (mailer.isEmail(v) ? String(v).trim().toLowerCase() : null);
const businessName = async (tid, fallback) => ((await tenantSettings(pool, tid)).businessName || fallback || 'your business');
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const ID_RE = /^[A-Za-z0-9_\-.:@+~]{1,120}$/;

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression({ filter: (req, res) => req.path !== '/api/stream' && compression.filter(req, res) })); // never buffer the live stream
const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (origins.length) app.use(cors({ origin: origins }));
app.use('/api/shop', express.json({ limit: '64kb' })); // public, no login: keep requests small
const jsonBody = express.json({ limit: '25mb' });
app.use(jsonBody);
app.use('/api', (req, res, next) => ensureSchema().then(() => next(), (e) => { console.error('[migrate]', e.message); err(res, 503, 'The server is updating its database. Please try again in a moment.'); }));
mountAdmin(app, { tenantSecret: SECRET, KC }); // platform admin: its own host, accounts, sessions — see src/admin.js

const err = (res, status, error, extra) => res.status(status).json(Object.assign({ error }, extra || {}));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sign = (u) => jwt.sign({ uid: u.id, tid: u.tenant_id, role: u.role }, SECRET, { expiresIn: '30d' });

/* ---------- auth ---------- */
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.AUTH_RATE) || 50 });
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: Number(process.env.API_RATE_PER_MIN || 1200), standardHeaders: true, legacyHeaders: false }));

/** What a new business starts with, by kind. A Bar & Resto gets its kind of venue, menu categories and the key of its QR menu. */
const num0 = (v) => Number(v) || 0;
function startSettings(edition, venueType) {
  if (edition === 'store') return { mainLocationName: KC.editionOf('store').loc.main };
  if (edition !== 'resto') return {};
  const vt = KC.VENUE_TYPES.some(([k]) => k === venueType) ? venueType : 'both';
  return { mainLocationName: KC.editionOf('resto').loc.main, venueType: vt, menuCats: KC.MENU_CATS[vt].slice(), menuKey: crypto.randomBytes(6).toString('hex'), qrOn: true };
}
/* ---------- Aahsso Bar & Resto: the menu address /m/<name> (unique on the platform; the old /m/<key> still works) ---------- */
async function menuSlugTaken(c, slug, tid) {
  return (await c.query("SELECT 1 FROM documents WHERE collection='settings' AND id='main' AND tenant_id <> $2 AND (lower(data->>'menuSlug')=$1 OR data->>'menuKey'=$1 OR (data->'menuSlugsOld') ? $1) LIMIT 1", [slug, tid])).rowCount > 0;
}
/** the first free menu address like the one asked for: name, name-2, name-3… */
async function freeMenuSlug(c, want, tid) {
  let base = KC.shopSlugify(want); if (KC.shopSlugError(base)) base = KC.shopSlugify((base || 'my') + '-menu');
  if (KC.shopSlugError(base)) base = 'menu-' + crypto.randomBytes(3).toString('hex');
  if (!(await menuSlugTaken(c, base, tid))) return base;
  const stem = base.slice(0, 36).replace(/-+$/, '');
  for (let n = 2; n < 500; n++) { const cand = stem + '-' + n; if (!(await menuSlugTaken(c, cand, tid))) return cand; }
  return stem + '-' + crypto.randomBytes(2).toString('hex');
}
/** Editions a new business can choose (the platform admin can close one for sign-ups). */
async function signupEditions() { const S = await billing.platformSettings(); return KC.EDITION_KEYS.filter((k) => (S.signup || {})[k] !== false); }
app.get('/api/signup-options', wrap(async (req, res) => {
  const open = await signupEditions();
  res.json({ editions: open.map((k) => { const e = KC.editionOf(k); return { key: e.key, label: e.label, tag: e.tag, points: e.points }; }) });
}));
app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  const { businessName, name, login, password, email } = req.body || {}; const venueType = String((req.body || {}).venueType || '');
  if (!businessName || !name || !login || !password) return err(res, 400, 'Business name, your name, login and password are required');
  const open = await signupEditions();
  const asked = String((req.body || {}).edition || '');
  const edition = asked || (open.includes('import') ? 'import' : open[0]); // an older app sends nothing: it only knew importers
  if (!open.includes(edition)) return err(res, 400, open.length === 1 ? KC.editionOf(asked).label + ' is not open for sign-up right now' : 'Choose what you will use Aahsso for');
  if (String(password).length < 6) return err(res, 400, 'Password must be at least 6 characters');
  const l = String(login).trim().toLowerCase();
  if ((await q('SELECT 1 FROM users WHERE login=$1', [l])).rowCount) return err(res, 409, 'This login is already registered');
  const days = billing.FREE_TRIAL_DAYS; // 5-day free trial
  const user = await tx(async (c) => {
    const t = (await c.query("INSERT INTO tenants(name, trial_ends_at, edition) VALUES ($1, now() + ($2 || ' days')::interval, $3) RETURNING id, trial_ends_at", [businessName, String(days), edition])).rows[0];
    await billing.ensureSub(c, t.id, t.trial_ends_at); await billing.syncTenant(c, t.id);
    const u = (await c.query("INSERT INTO users(tenant_id,name,login,password_hash,role,email) VALUES ($1,$2,$3,$4,'owner',$5) RETURNING *", [t.id, name, l, await bcrypt.hash(String(password), 10), cleanEmail(email)])).rows[0];
    const st0 = startSettings(edition, venueType); if (edition === 'resto') st0.menuSlug = await freeMenuSlug(c, businessName, t.id);
    await c.query("INSERT INTO documents(tenant_id,collection,id,data,updated_by) VALUES ($1,'settings','main',$2,$3)", [t.id, JSON.stringify(Object.assign({}, KC.DEFAULT_SETTINGS, { businessName }, st0)), u.id]);
    await c.query("INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action,after) VALUES ($1,$2,$3,'main','register',$4)", [t.id, u.id, name, JSON.stringify({ edition })]);
    return u;
  });
  const to = mailer.emailOf(user);
  if (to) await mailer.sendEmail(Object.assign({ to, kind: 'welcome', tenantId: user.tenant_id, dedupe: 'welcome:' + user.id }, mailer.T.welcomeOwner({ name, business: businessName, login: l, trialEnds: ymd(Date.now() + days * 864e5), url: mailer.appUrl(req) })));
  res.json({ token: sign(user) });
}));

/* ---------- forgot password: a one-time link by email (only a hash of the token is stored) ---------- */
const RESET_MINUTES = 60;
const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
app.post('/api/auth/forgot', authLimiter, wrap(async (req, res) => {
  const l = String((req.body || {}).login || '').trim().toLowerCase();
  const done = () => res.json({ ok: true, message: 'If this account has an email address, a reset link is on its way.' }); // same answer either way
  if (!l) return err(res, 400, 'Type your email or phone');
  const u = (await q('SELECT * FROM users WHERE active AND person_id IS NULL AND (login=$1 OR lower(email)=$1) ORDER BY created_at LIMIT 1', [l])).rows[0];
  const to = mailer.emailOf(u); if (!u || !to) return done();
  const recent = (await q("SELECT count(*)::int AS n FROM password_resets WHERE user_id=$1 AND created_at > now() - interval '1 hour'", [u.id])).rows[0].n;
  if (recent >= 5) return done();
  const token = crypto.randomBytes(32).toString('hex');
  await q("INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES ($1,$2, now() + ($3 || ' minutes')::interval)", [tokenHash(token), u.id, String(RESET_MINUTES)]);
  await mailer.sendEmail(Object.assign({ to, kind: 'password_reset', tenantId: u.tenant_id }, mailer.T.passwordReset({ name: u.name, url: mailer.appUrl(req) + '/?reset=' + token, minutes: RESET_MINUTES })));
  done();
}));
app.post('/api/auth/reset', authLimiter, wrap(async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !/^[0-9a-f]{64}$/.test(String(token))) return err(res, 400, 'This reset link is not valid. Ask for a new one.');
  if (!password || String(password).length < 6) return err(res, 400, 'Password must be at least 6 characters');
  const row = (await q('SELECT r.user_id FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=$1 AND r.used_at IS NULL AND r.expires_at > now() AND u.active', [tokenHash(token)])).rows[0];
  if (!row) return err(res, 400, 'This reset link has expired or was already used. Ask for a new one.');
  const u = await tx(async (c) => {
    await c.query('UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [row.user_id]); // this link and any older ones
    const x = (await c.query('UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING *', [await bcrypt.hash(String(password), 10), row.user_id])).rows[0];
    await c.query("INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action) VALUES ($1,$2,$3,$4,'password_reset')", [x.tenant_id, x.id, x.name, x.location_id || 'main']);
    return x;
  });
  const to = mailer.emailOf(u);
  if (to) await mailer.sendEmail(Object.assign({ to, kind: 'password_changed', tenantId: u.tenant_id }, mailer.T.passwordChanged({ name: u.name, business: await businessName(u.tenant_id), url: mailer.appUrl(req), when: new Date().toUTCString() })));
  res.json({ token: sign(u) });
}));

app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const { login, password } = req.body || {};
  const u = (await q('SELECT * FROM users WHERE login=$1 AND active', [String(login || '').trim().toLowerCase()])).rows[0];
  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) return err(res, 401, 'Wrong login or password');
  await q('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
  await q("INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action) VALUES ($1,$2,$3,$4,'login')", [u.tenant_id, u.id, u.name, u.location_id || 'main']);
  res.json({ token: sign(u) });
}));

async function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  try {
    let p; try { p = jwt.verify(token, SECRET); } catch (e) { return err(res, 401, 'Please sign in'); } // only a bad/expired token signs you out
    if (p.ro && !['GET', 'HEAD'].includes(req.method)) return err(res, 403, 'Aahsso support view is read-only — nothing can be changed', { code: 'read_only' });
    const u = (await q('SELECT u.id,u.tenant_id,u.name,coalesce(lp.login,u.login) AS login,u.email,u.role,u.perms,u.location_id,u.active,u.person_id,t.name AS tenant_name,t.edition,t.plan,t.status,t.trial_ends_at,t.paid_until,t.grace_days FROM users u JOIN tenants t ON t.id=u.tenant_id LEFT JOIN users lp ON lp.id=u.person_id WHERE u.id=$1', [p.uid])).rows[0];
    if (!u || !u.active) return err(res, 401, 'Session expired');
    const st = (await q("SELECT data->'roles' AS roles FROM documents WHERE tenant_id=$1 AND collection='settings' AND id='main'", [u.tenant_id])).rows[0];
    u.customRoles = (st && st.roles) || {};
    if (p.ro) u.supportView = { by: p.impName || 'Aahsso support', until: new Date(p.exp * 1000).toISOString() };
    u.ent = await billing.limitsFor(pool, u.tenant_id); u.features = u.ent.features; // what the plan includes
    req.user = u; next();
  } catch (e) { console.error('[auth]', e.message); return err(res, 500, 'Server error — please try again'); } // e.g. database down: keep the session
}
// Subscription gate: reading stays allowed so a business can always export its data.
function subscriptionOk(u) {
  if (u.status === 'suspended') return false;
  const now = Date.now();
  if (u.plan === 'trial') return !u.trial_ends_at || new Date(u.trial_ends_at).getTime() > now;
  return !u.paid_until || new Date(u.paid_until).getTime() > now - (u.grace_days ?? 7) * 864e5; // grace period after the paid period ends
}
const requireActive = (req, res, next) => subscriptionOk(req.user) ? next() : err(res, 402, 'Subscription inactive — renew to keep recording. You can still view and export your data.', { code: 'subscription' });
const requireRole = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : err(res, 403, 'Not allowed for your role');
const requirePerm = (p) => (req, res, next) => canU(req.user, p) ? next() : err(res, 403, 'You do not have permission for this');

app.post('/api/me/password', auth, authLimiter, wrap(async (req, res) => {
  const { current, password } = req.body || {};
  if (!password || String(password).length < 6) return err(res, 400, 'New password must be at least 6 characters');
  const pid = personOf(req.user); // a linked business: the password is the person's own
  const row = (await q('SELECT password_hash FROM users WHERE id=$1', [pid])).rows[0];
  if (!(await bcrypt.compare(String(current || ''), row.password_hash))) return err(res, 400, 'Current password is wrong', { code: 'bad_password' });
  await q('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(String(password), 10), pid]);
  const to = mailer.emailOf(req.user);
  if (to) await mailer.sendEmail(Object.assign({ to, kind: 'password_changed', tenantId: req.user.tenant_id }, mailer.T.passwordChanged({ name: req.user.name, business: await businessName(req.user.tenant_id, req.user.tenant_name), url: mailer.appUrl(req), when: new Date().toUTCString() })));
  res.json({ ok: true });
}));
/* own email address (notifications, password reset) */
app.patch('/api/me', auth, wrap(async (req, res) => {
  const { email, name } = req.body || {};
  if (email !== undefined && email !== '' && email !== null && !mailer.isEmail(email)) return err(res, 400, 'Type a valid email address');
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80)) return err(res, 400, 'Type your name (2 to 80 letters)');
  const pid = personOf(req.user); // the same person in each of their businesses
  if (email !== undefined) await q('UPDATE users SET email=$1 WHERE id=$2 OR person_id=$2', [cleanEmail(email), pid]);
  if (name !== undefined) await q('UPDATE users SET name=$1 WHERE id=$2 OR person_id=$2', [name.trim(), pid]);
  res.json({ ok: true, email: email !== undefined ? cleanEmail(email) : req.user.email || '', name: name !== undefined ? name.trim() : req.user.name });
}));
/* Help & Support: a message to the Aahsso team (by email, with the sender as reply-to) */
const SUPPORT = () => ({ email: process.env.SUPPORT_EMAIL || '', whatsapp: String(process.env.SUPPORT_WHATSAPP || '').replace(/[^\d]/g, '') });
const supportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
app.post('/api/support', auth, supportLimiter, wrap(async (req, res) => {
  const { topic, message, page } = req.body || {};
  const msg = String(message || '').trim();
  if (msg.length < 5) return err(res, 400, 'Tell us a bit more (at least a few words)');
  const to = SUPPORT().email; const u = req.user; const reply = mailer.emailOf(u);
  const tk = (await q('INSERT INTO support_tickets (tenant_id, user_id, user_name, email, topic, page) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [u.tenant_id, u.id, u.name, reply, String(topic || 'Question').slice(0, 80), String(page || '').slice(0, 60)])).rows[0];
  await q("INSERT INTO support_messages (ticket_id, author, author_name, body) VALUES ($1,'user',$2,$3)", [tk.id, u.name, msg.slice(0, 4000)]);
  if (!to || !mailer.enabled()) return res.json({ ok: true, replyTo: reply || '', ticket: tk.id });
  const r = await mailer.sendEmail(Object.assign({ to, kind: 'support', tenantId: u.tenant_id, replyTo: reply || undefined }, mailer.T.support({ business: u.tenant_name, from: u.name, login: u.login, email: reply || '', role: u.role, plan: u.plan + (u.status !== 'active' ? ' (' + u.status + ')' : ''), topic: String(topic || 'Question').slice(0, 80), message: msg.slice(0, 4000), page: String(page || '').slice(0, 60), tenantId: u.tenant_id })));
  res.json({ ok: true, replyTo: reply || '', ticket: tk.id, emailed: r.status }); // the ticket is saved even if the email failed
}));
billing.mountTenant(app, { auth, wrap, err, canU, tx, momo });
momo.mount(app, { auth, wrap, err, guard: (req, res, next) => (['owner', 'admin'].includes(req.user.role) || canU(req.user, 'settings') ? next() : err(res, 403, 'Only the owner or an admin can manage billing')) });
app.get('/api/email/status', auth, (req, res) => res.json({ enabled: mailer.enabled(), from: mailer.enabled() ? mailer.FROM() : '' }));
app.get('/api/me', auth, wrap(async (req, res) => {
  const u = req.user; const sub = await billing.getSub(pool, u.tenant_id); const lim = await billing.limitsFor(pool, u.tenant_id);
  const pin = (await q('SELECT approval_pin_hash IS NOT NULL AS has FROM users WHERE id=$1', [u.id])).rows[0];
  res.json({ user: { id: u.id, name: u.name, login: u.login, email: u.email || '', emailTo: mailer.emailOf(u) || '', role: u.role, perms: u.perms || {}, locationId: u.location_id || 'main', effective: perms(u), approvalPin: !!(pin && pin.has) }, tenant: { id: u.tenant_id, name: u.tenant_name, edition: KC.editionOf(u.edition).key, plan: u.plan, status: u.status, trialEndsAt: u.trial_ends_at, paidUntil: u.paid_until, active: subscriptionOk(u) }, emailEnabled: mailer.enabled(), support: SUPPORT(),
    subscription: sub ? { planId: sub.plan_id, planName: sub.plan_name, status: sub.status, statusLabel: billing.STATUS_LABEL[sub.status], cycle: sub.cycle, periodEnd: sub.current_period_end, trialEndsAt: sub.trial_ends_at } : null,
    edition: lim.edition, limits: lim.limits, features: lim.features, trial: !!lim.trial, supportView: u.supportView || null,
    businesses: u.supportView ? [] : await myBusinesses(u), canAddBusiness: !u.supportView && u.role === 'owner' });
}));

/* ---------- one person, several businesses (e.g. an Aahsso Brocan and an Aahsso Store) ----------
 * The person signs in once. Each extra business gets an owner account linked to them (users.person_id) with no login
 * of its own; switching hands out a session for that account. Password, name and email are shared. */
const personOf = (u) => u.person_id || u.id;
async function myBusinesses(u) {
  const pid = personOf(u);
  return (await q("SELECT u.tenant_id AS id, t.name, t.edition, u.role FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE (u.id=$1 OR u.person_id=$1) AND u.active ORDER BY u.created_at", [pid])).rows
    .map((b) => ({ id: b.id, name: b.name, edition: KC.editionOf(b.edition).key, label: KC.editionOf(b.edition).label, role: b.role, current: b.id === u.tenant_id }));
}
/** May this person add one more business of each kind? The plans of the businesses of that kind decide
 *  (Stores on an Aahsso Store plan, Warehouses on a Brocan plan; the most generous one counts; empty = no limit).
 *  The first business of a kind is always allowed. The platform cap (admin Settings) is a safety limit over all kinds. */
async function addRoom(mine) {
  const cap = (await billing.platformSettings()).maxBusinesses; const out = {};
  for (const ed of KC.EDITION_KEYS) {
    const same = mine.filter((b) => b.edition === ed); const word = (n) => KC.locWord(ed, n);
    // only businesses on a plan decide (a new one still on its free trial has no plan yet, and must not lift the limit)
    let max = Infinity, plan = '', planned = false;
    for (const b of same) {
      const l = await billing.limitsFor(pool, b.id); if (!l.plan) continue;
      const v = Number(l.limits.maxBusinesses); if (!planned) { max = 0; planned = true; }
      if (!v) { max = Infinity; break; } if (v > max) { max = v; plan = l.plan; }
    }
    if (mine.length >= cap) out[ed] = { ok: false, code: 'max_businesses', why: 'You can have up to ' + cap + ' businesses in all. Contact Aahsso support for more.' };
    else if (same.length >= max) out[ed] = { ok: false, code: 'plan_limit', max, used: same.length, why: 'Your ' + KC.editionOf(ed).label + ' plan' + (plan ? ' (' + plan + ')' : '') + ' allows ' + word(max) + ' — you have ' + same.length + '. Upgrade that plan in Billing & subscription to add more.' };
    else out[ed] = { ok: true, max: max === Infinity ? null : max, used: same.length };
  }
  return out;
}
app.get('/api/businesses/room', auth, wrap(async (req, res) => {
  if (req.user.supportView || req.user.role !== 'owner') return res.json({ room: {} });
  res.json({ room: await addRoom(await myBusinesses(req.user)) });
}));
const bizLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
app.post('/api/businesses', auth, bizLimiter, wrap(async (req, res) => {
  const u = req.user; const b = req.body || {};
  if (u.supportView) return err(res, 403, 'Not in the support view');
  if (u.role !== 'owner') return err(res, 403, 'Only the owner of a business can add another business');
  const name = String(b.businessName || '').trim().slice(0, 80); if (name.length < 2) return err(res, 400, 'Type the name of the new business');
  const open = await signupEditions(); const edition = String(b.edition || '');
  if (!KC.EDITION_KEYS.includes(edition)) return err(res, 400, 'Choose Aahsso Brocan or Aahsso Store');
  if (!open.includes(edition)) return err(res, 400, KC.editionOf(edition).label + ' is not open for new businesses right now');
  const mine = await myBusinesses(u); const room = (await addRoom(mine))[edition];
  if (!room.ok) return err(res, 402, room.why, { code: room.code });
  const pid = personOf(u); const me = (await q('SELECT name, email, login FROM users WHERE id=$1', [pid])).rows[0];
  const days = billing.FREE_TRIAL_DAYS;
  const user = await tx(async (c) => {
    const t = (await c.query("INSERT INTO tenants(name, trial_ends_at, edition) VALUES ($1, now() + ($2 || ' days')::interval, $3) RETURNING id, trial_ends_at", [name, String(days), edition])).rows[0];
    await billing.ensureSub(c, t.id, t.trial_ends_at); await billing.syncTenant(c, t.id);
    const x = (await c.query("INSERT INTO users(tenant_id,name,login,password_hash,role,email,person_id) VALUES ($1,$2,$3,$4,'owner',$5,$6) RETURNING *",
      [t.id, me.name, 'link:' + crypto.randomUUID(), await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10), mailer.emailOf(me), pid])).rows[0];
    const st0 = startSettings(edition, String(b.venueType || '')); if (edition === 'resto') st0.menuSlug = await freeMenuSlug(c, name, t.id);
    await c.query("INSERT INTO documents(tenant_id,collection,id,data,updated_by) VALUES ($1,'settings','main',$2,$3)", [t.id, JSON.stringify(Object.assign({}, KC.DEFAULT_SETTINGS, { businessName: name }, st0)), x.id]);
    await c.query("INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action,after) VALUES ($1,$2,$3,'main','register',$4)", [t.id, x.id, me.name, JSON.stringify({ edition, addedFrom: u.tenant_id })]);
    await c.query("INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action,after) VALUES ($1,$2,$3,'main','business_added',$4)", [u.tenant_id, u.id, u.name, JSON.stringify({ name, edition })]);
    return x;
  });
  res.json({ token: sign(user), business: { id: user.tenant_id, name, edition } });
}));
app.post('/api/businesses/switch', auth, wrap(async (req, res) => {
  const u = req.user; if (u.supportView) return err(res, 403, 'Not in the support view');
  const tid = String((req.body || {}).tenantId || '');
  const x = (await q('SELECT * FROM users WHERE tenant_id::text=$2 AND (id=$1 OR person_id=$1) AND active', [personOf(u), tid])).rows[0];
  if (!x) return err(res, 404, 'You do not have access to this business');
  await q('UPDATE users SET last_login_at=now() WHERE id=$1', [x.id]);
  await q("INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action) VALUES ($1,$2,$3,$4,'login')", [x.tenant_id, x.id, x.name, x.location_id || 'main']);
  res.json({ token: sign(x) });
}));

/* ---------- live updates (Server-Sent Events) ---------- */
// Two sources, so it works on one long-running server AND on Vercel (many short-lived instances):
//  1. in-memory push — instant when the writer and the listener are on the same instance;
//  2. the audit log in Postgres, checked every few seconds — reaches listeners on any instance.
// Each event carries the audit cursor as its id; when the stream is closed (Vercel time limit) the browser
// reconnects with Last-Event-ID and continues from there, so nothing is missed in between.
const streams = new Map(); // tenantId -> Set(res)
const STREAM_POLL_MS = Number(process.env.STREAM_POLL_MS || 3000);
const STREAM_MAX_MS = Number(process.env.STREAM_SECONDS || (process.env.VERCEL ? 50 : 0)) * 1000; // 0 = never close
const OVERLAP_MS = 20000; // a transaction may commit a little after its audit timestamp
// rows written alongside another collection without their own audit row
const ALSO_REFRESH = { transfers: ['adjustments'] };
app.get('/api/stream', auth, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const tid = req.user.tenant_id;
  const set = streams.get(tid) || new Set(); set.add(res); streams.set(tid, set);
  const lastId = Number(req.headers['last-event-id'] || req.query.since);
  let cursor = lastId > 0 && lastId > Date.now() - 24 * 3600e3 ? lastId : null; // null → start from the database's "now"
  const seen = new Map(); // audit id -> at (ms), only within the overlap window
  let closed = false, busy = false;
  const poll = async () => {
    if (closed || busy) return; busy = true;
    try {
      if (cursor === null) { cursor = Number((await q('SELECT (extract(epoch from now()) * 1000)::bigint AS ms')).rows[0].ms); busy = false; return; }
      const rows = (await q('SELECT id, collection, action, (extract(epoch from at) * 1000)::bigint AS ms FROM audit_log WHERE tenant_id=$1 AND at > to_timestamp($2 / 1000.0) ORDER BY at LIMIT 500', [tid, cursor - OVERLAP_MS])).rows;
      const cols = new Set(); let all = false;
      for (const r of rows) {
        const ms = Number(r.ms); if (ms > cursor) cursor = ms;
        if (seen.has(String(r.id))) continue; seen.set(String(r.id), ms);
        if (r.action === 'import') all = true;
        else if (r.collection) { cols.add(r.collection); (ALSO_REFRESH[r.collection] || []).forEach((c) => cols.add(c)); }
      }
      seen.forEach((ms, k) => { if (ms < cursor - OVERLAP_MS - 5000) seen.delete(k); });
      if (!closed && (all || cols.size)) {
        if (all) res.write('id: ' + cursor + '\ndata: {}\n\n');
        else cols.forEach((col) => res.write('id: ' + cursor + '\ndata: ' + JSON.stringify({ col }) + '\n\n'));
      }
    } catch (e) { console.warn('[stream] poll failed:', e.message); }
    busy = false;
  };
  const pollT = setInterval(poll, STREAM_POLL_MS);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  const stop = () => { if (closed) return; closed = true; clearInterval(pollT); clearInterval(ping); clearTimeout(endT); set.delete(res); };
  // close a little before the platform would kill the function; the browser reconnects with Last-Event-ID
  const endT = STREAM_MAX_MS ? setTimeout(async () => { await poll(); res.write('id: ' + cursor + '\n\n'); stop(); res.end(); }, STREAM_MAX_MS) : null;
  poll(); // start the cursor now, or catch up on whatever happened while reconnecting
  req.on('close', stop);
});
function broadcast(tid, col, id) { (streams.get(tid) || new Set()).forEach((r) => r.write('data: ' + JSON.stringify({ col, id }) + '\n\n')); }

/* ---------- data ---------- */
const colOk = (req, res, next) => COLLECTIONS.includes(req.params.col) ? next() : err(res, 404, 'Unknown collection');

app.get('/api/data/:col', auth, colOk, wrap(async (req, res) => {
  const u = req.user, col = req.params.col;
  const r = await q('SELECT id, data FROM documents WHERE tenant_id=$1 AND collection=$2', [u.tenant_id, col]);
  let docs = r.rows.map((x) => Object.assign({}, x.data, { id: x.id }));
  const P = perms(u);
  if (col === 'sales' && !P.salesAll) {
    // Other people's sales are reduced to what stock calculations need: no customers, prices or payments.
    docs = docs.map((d) => d.createdById === u.id ? d : { id: d.id, _hidden: true, status: d.status, date: d.date, createdById: d.createdById, locationId: d.locationId, // the branch: stock per branch depends on it
      lines: (d.lines || []).map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: 0, alloc: l.alloc, returns: (l.returns || []).map((x) => ({ qty: x.qty, restock: x.restock, alloc: x.alloc })) })), payments: [] });
  }
  if (!P.costs) {
    if (col === 'lots') docs = docs.map((d) => Object.assign({}, d, { unitCost: 0, unitTax: 0, regularPrice: null }));
    if (col === 'shipments') docs = docs.map((d) => Object.assign({}, d, { costs: [] }));
    if (col === 'products') {
      // Send selling prices already calculated, because this user cannot receive the costs they come from.
      const C = KC.computeAll(await loadAll(pool, u.tenant_id));
      docs = docs.map((d) => { const x = C.prodX[d.id] || {}; return Object.assign({}, d, { priceMax: x.priceMax || d.priceMax, priceMin: x.priceMin || d.priceMin, markup: null, minMarkup: null, priceHistory: (d.priceHistory || []).map((e) => Object.assign({}, e, { cost: null })) }); });
    }
    if (col === 'adjustments' || col === 'expenses') docs = col === 'expenses' && !P.expenses ? [] : docs;
  }
  if (col === 'expenses' && !P.expenses && !P.reports) docs = [];
  if ((col === 'bills' || col === 'suppliers') && !P.suppliers && !P.purchases && !P.containers && !P.assets) docs = [];
  if (col === 'handovers' && !P.handover) docs = docs.filter((d) => d.userId === u.id);
  if (col === 'orders' && !P.sell && !P.payments) docs = [];
  if (col === 'assets' && !P.assets) docs = [];
  if (KC.HIDDEN_WHEN_OFF.includes(col) && !KC.anyOn(u.features, KC.COLLECTION_FEATURE[col])) docs = []; // not in the plan
  const me = KC.staffIdOf(u.id);
  if (col === 'staff') docs = docs.map((d) => {
    if (d.id === me) return d; // your own file, salary included
    if (!P.hr && !P.payroll) return { id: d.id, name: d.name, title: d.title, userId: d.userId, active: d.active, locationId: d.locationId };
    return P.payroll ? d : Object.assign({}, d, { pay: undefined });
  });
  if (col === 'attendance' && !P.hr) docs = docs.filter((d) => d.staffId === me);
  if (col === 'leaves' && !P.hr) docs = docs.filter((d) => d.staffId === me || d.status === 'approved').map((d) => d.staffId === me ? d : { id: d.id, staffId: d.staffId, staffName: d.staffName, type: d.type === 'sick' ? 'other' : d.type, from: d.from, to: d.to, half: d.half, status: d.status });
  if (col === 'payroll' && !P.payroll) docs = docs.filter((d) => d.staffId === me && (d.type === 'advance' || d.status === 'paid'));
  if (col === 'tills' && !P.handover) docs = docs.filter((d) => d.fromId === u.id || d.toId === u.id);
  if (col === 'losses' && !P.stockEdit && !P.reports) docs = docs.filter((d) => d.reportedById === u.id);
  if (col === 'losses' && !P.costs) docs = docs.map((d) => Object.assign({}, d, { lines: (d.lines || []).map((l) => Object.assign({}, l, { unitCost: 0 })) }));
  res.json({ docs });
}));

async function loadAllSales(c, tid) {
  const r = await c.query("SELECT collection, id, data FROM documents WHERE tenant_id=$1 AND collection IN ('sales','tills')", [tid]);
  const out = { sales: [], tills: [] }; r.rows.forEach((x) => out[x.collection].push(Object.assign({}, x.data, { id: x.id }))); return out;
}
/** Plan limits on saved records. Returns {status: 402, error, code} or null. */
/** Stock counts. Counters' entries are merged (two people can count at once: the client sends countsPatch).
 *  In a handover only the incoming person accepts and only the outgoing person agrees (or disputes); someone without
 *  the stock-count permission may do nothing else. Approving, cancelling and charging a shortage need a manager. */
function auditRules(u, P, body, old) {
  const now = new Date().toISOString(); const counter = P.audit || P.stockEdit;
  if (!counter) { // a signer only: keep everything as it was except their own signature
    const h = Object.assign({}, old.handover); const nh = body.handover || {};
    if (u.id === h.toId && nh.toAcceptedAt && !h.toAcceptedAt) h.toAcceptedAt = now;
    if (u.id === h.fromId && (nh.fromAgreedAt || nh.fromDisputedAt) && !h.fromAgreedAt && !h.fromDisputedAt) { if (nh.fromDisputedAt) { h.fromDisputedAt = now; h.fromNote = String(nh.fromNote || '').slice(0, 500); } else h.fromAgreedAt = now; }
    for (const k of Object.keys(body)) delete body[k]; Object.assign(body, old, { handover: h }); return null;
  }
  if (old && ['applied', 'cancelled'].includes(old.status)) return { status: 409, error: 'This stock count is closed' };
  if (['applied', 'cancelled'].includes(body.status) && !P.stockEdit) return { status: 403, error: 'Only a manager can approve or cancel a stock count' };
  if (body.charge && !P.stockEdit) return { status: 403, error: 'Only a manager can charge a shortage' };
  if (old && old.status === 'draft' && body.status === 'draft' && body.countsPatch && typeof body.countsPatch === 'object') {
    const counts = Object.assign({}, old.counts);
    for (const [pid, n] of Object.entries(body.countsPatch)) { if (n === null) delete counts[pid]; else if (Number.isFinite(Number(n)) && Number(n) >= 0) counts[pid] = Math.floor(Number(n)); }
    body.counts = counts; body.counters = [...new Set([].concat(old.counters || [], u.name || []))].slice(0, 20);
  }
  delete body.countsPatch;
  if (old && old.handover) { // signatures belong to their owners
    const h = Object.assign({}, body.handover || old.handover); const o = old.handover;
    ['toAcceptedAt', 'fromAgreedAt', 'fromDisputedAt', 'fromNote'].forEach((k) => { h[k] = o[k]; });
    const nh = body.handover || {};
    if (u.id === o.toId && nh.toAcceptedAt && !o.toAcceptedAt && old.status === 'submitted') h.toAcceptedAt = now;
    if (u.id === o.fromId && old.status === 'submitted' && !o.fromAgreedAt && !o.fromDisputedAt) { if (nh.fromDisputedAt) { h.fromDisputedAt = now; h.fromNote = String(nh.fromNote || '').slice(0, 500); } else if (nh.fromAgreedAt) h.fromAgreedAt = now; }
    if (old.status !== 'draft') { h.fromId = o.fromId; h.fromName = o.fromName; h.toId = o.toId; h.toName = o.toName; }
    body.handover = h;
  } else if (body.handover) { delete body.handover.toAcceptedAt; delete body.handover.fromAgreedAt; delete body.handover.fromDisputedAt; }
  if (body.status === 'applied' && (!old || old.status !== 'applied')) Object.assign(body, { appliedAt: now, appliedBy: u.name, appliedById: u.id });
  return null;
}
/** Loss reports: anyone with lossReport may report one (always "pending"); only a manager (stockEdit) approves or
 *  rejects it, or records one that applies at once. Nothing changes once a loss is decided. */
function lossRules(u, P, body, old) {
  const now = new Date().toISOString(); const st = String(body.status || 'pending');
  if (!['pending', 'approved', 'rejected', 'withdrawn'].includes(st)) return { status: 400, error: 'Unknown status' };
  if (old && old.status !== 'pending') return { status: 409, error: 'This loss was already ' + old.status + ' — it cannot be changed' };
  if ((st === 'approved' || st === 'rejected') && !P.stockEdit) return { status: 403, error: 'Only a manager can approve or reject a loss' };
  if (old && old.reportedById !== u.id && !P.stockEdit) return { status: 403, error: 'You can only change your own loss reports' };
  if (st !== 'rejected' && st !== 'withdrawn') { const bad = KC.lossCheck(body); if (bad) return { status: 400, error: bad }; }
  if (st === 'rejected' && String(body.decisionNote || '').trim().length < 3) return { status: 400, error: 'Say why the loss is rejected' };
  if (!P.costs) { const was = new Map(((old && old.lines) || []).map((l) => [l.productId, l.unitCost])); (body.lines || []).forEach((l) => { l.unitCost = was.get(l.productId) || 0; }); } // costs come from a manager
  Object.assign(body, old ? { reportedById: old.reportedById, reportedBy: old.reportedBy, reportedAt: old.reportedAt, no: old.no } : { reportedById: u.id, reportedBy: u.name, reportedAt: now });
  if (!body.no || !TXN_RE.test(String(body.no))) body.no = KC.newTxnId('LS', body.date);
  if (st === 'approved' || st === 'rejected') Object.assign(body, { decidedById: u.id, decidedBy: u.name, decidedAt: now }); else { delete body.decidedById; delete body.decidedBy; delete body.decidedAt; }
  body.status = st; return null;
}
async function planGuard(c, u, col, body, old) {
  const F = u.features || {};
  const off = (keys) => !KC.anyOn(F, keys) && { status: 402, error: (billing.FEATURES[keys[0]] || 'This feature') + ' is not included in your plan. Upgrade in Billing & subscription to use it.', code: 'plan_feature', feature: keys[0] };
  if (KC.COLLECTION_FEATURE[col]) { const e = off(KC.COLLECTION_FEATURE[col]); if (e) return e; }
  if (col === 'locations' && !old) { const e = off(['branches']); if (e) return e; }
  if (col === 'sales' && body.delivery && body.delivery.mode && body.delivery.mode !== 'pickup' && !(old && old.delivery && old.delivery.mode === body.delivery.mode)) { const e = off(['delivery']); if (e) return e; }
  if (col === 'products' && body.image && body.image !== (old && old.image)) { const e = off(['photos']); if (e) return e; }
  if (col === 'settings' && JSON.stringify(body.roles || {}) !== JSON.stringify((old && old.roles) || {})) { const e = off(['customRoles']); if (e) return e; }
  // Bar & Resto: each extra is a plan feature the platform admin switches on or off
  if (col === 'menu' && body.kind === 'portion' && !(old && old.kind === 'portion')) { const e = off(['portions']); if (e) return e; }
  if (col === 'menu' && body.kind === 'recipe' && !(old && old.kind === 'recipe')) { const e = off(['recipes']); if (e) return e; }
  if (col === 'sales' && body.loyalty && !(old && old.loyalty)) { const e = off(['loyalty']); if (e) return e; }
  if (col === 'sales' && body.tabId && (num0(body.tip) > 0 || body.split) && !(old && old.tabId)) { const e = off(['tabsPlus']); if (e) return e; }
  if (col === 'settings') {
    if (body.happyHour && body.happyHour.on && !(old && old.happyHour && old.happyHour.on)) { const e = off(['happyHour']); if (e) return e; }
    if (body.payFirst && !(old && old.payFirst)) { const e = off(['payFirst']); if (e) return e; }
    if (body.loyaltyOn && !(old && old.loyaltyOn)) { const e = off(['loyalty']); if (e) return e; }
    if (num0(body.serviceCharge) > 0 && !(num0(old && old.serviceCharge) > 0)) { const e = off(['tabsPlus']); if (e) return e; }
  }
  if (col === 'tables' && (!old || old.archived) && !body.archived) return billing.checkLimit(c, u.tenant_id, 'maxTables');
  if (col === 'locations' && !old) return billing.checkLimit(c, u.tenant_id, 'maxLocations');
  if (col === 'products' && !old && !body.archived) return billing.checkLimit(c, u.tenant_id, 'maxProducts');
  if (col === 'products' && old && old.archived && !body.archived) return billing.checkLimit(c, u.tenant_id, 'maxProducts');
  if (col === 'settings') {
    if (body.shopEnabled && !(old && old.shopEnabled)) { const e = await billing.checkLimit(c, u.tenant_id, 'onlineShop'); if (e) return e; }
    if (body.autoReminders && !(old && old.autoReminders)) { const e = await billing.checkLimit(c, u.tenant_id, 'autoReminders'); if (e) return e; }
  }
  if (col === 'payroll') return billing.checkLimit(c, u.tenant_id, 'payroll');
  return null;
}
/** Server rules for staff records. Returns {status, error} to refuse, or null. May correct `body`. */
async function staffRules(c, u, P, col, id, body, old) {
  const me = KC.staffIdOf(u.id); const nowIso = new Date().toISOString(); const no = (status, error) => ({ status, error });
  if (col === 'attendance') {
    if (!body.staffId || !body.date || id !== 'at_' + body.date + '_' + body.staffId) return no(400, 'Invalid attendance record');
    const ev = Array.isArray(body.events) ? body.events : (body.events = []);
    if (ev.some((e) => !e || !KC.CLOCK[e.t])) return no(400, 'Unknown clock action');
    const before = (old && old.events) || [];
    // earlier events unchanged? (compare action and time only: the server adds who/when fields the phone may not have yet)
    const same = (o, n) => o.t === n.t && (o.fixed || Date.parse(o.at) === Date.parse(n.at));
    const appendOnly = ev.length >= before.length && before.every((e, i) => same(e, ev[i]));
    // a manager correcting someone's day (or their own, from the correction screen) sets the times as typed
    const correcting = P.hr && (body.staffId !== me || (body.editedAt && (!old || body.editedAt !== old.editedAt)));
    if (appendOnly && !correcting) {
      // a clock tap: keep the stored events, stamp the new ones with the server's clock where the phone's is off
      const now = Date.now(); const lastAt = before.length ? Date.parse(before[before.length - 1].at) : 0;
      const added = ev.slice(before.length).map((e) => ({ t: e.t, at: e.at }));
      for (const e of added) {
        const t = Date.parse(e.at);
        if (!t || t > now + 2 * 60e3 || t < now - 36 * 3600e3) { e.at = nowIso; e.fixed = true; } // the phone's clock is wrong
        else if (Math.abs(t - now) > 3 * 60e3) e.syncedAt = nowIso; // recorded offline, sent later
        if (Date.parse(e.at) < lastAt) return no(403, 'Clock times cannot be changed — ask a manager to correct them');
        e.byId = u.id; e.by = u.name;
      }
      body.events = before.concat(added);
      body.editedBy = old ? old.editedBy : undefined; body.editedAt = old ? old.editedAt : undefined;
    } else if (!correcting) return no(403, 'Clock times cannot be changed — ask a manager to correct them');
    else { body.events = ev.map((e) => Object.assign({}, e, { at: new Date(Date.parse(e.at) || Date.now()).toISOString() })).sort((x, y) => x.at.localeCompare(y.at)); body.editedBy = u.name; body.editedAt = nowIso; }
    if (!P.hr) {
      if (body.staffId !== me) return no(403, 'You can only clock in and out for yourself');
      body.userId = u.id; body.staffName = u.name; body.note = old ? old.note : body.note;
    }
  }
  if (col === 'leaves') {
    if (!body.staffId || !body.from || (body.to && body.to < body.from)) return no(400, 'Choose the first and last day');
    if (!KC.LEAVE_TYPES.some((t) => t[0] === body.type)) return no(400, 'Choose the type of leave');
    if (!P.hr) {
      if (body.staffId !== me || (old && old.staffId !== me)) return no(403, 'You can only ask for leave for yourself');
      if (!old && body.status !== 'requested') return no(403, 'A manager must approve leave');
      if (old && !(old.status === 'requested' && ['requested', 'cancelled'].includes(body.status))) return no(403, old.status === 'approved' ? 'This leave is approved — ask a manager to change it' : 'This request is closed');
      body.decidedBy = old ? old.decidedBy : undefined; body.decidedAt = old ? old.decidedAt : undefined;
      body.staffName = u.name; body.requestedById = u.id;
    } else {
      if (!body.staffName) body.staffName = (old && old.staffName) || (body.staffId === me ? u.name : '');
      if (['approved', 'rejected'].includes(body.status) && (!old || old.status !== body.status)) { body.decidedBy = u.name; body.decidedAt = nowIso; }
    }
  }
  if (col === 'staff' && !P.payroll) body.pay = old ? old.pay : undefined; // only payroll sees and sets salaries
  if (col === 'tills') {
    const clean = (o) => { const r = {}; Object.entries(o || {}).forEach(([m, v]) => { const n = Math.round(Number(v) || 0); if (m && n >= 0) r[String(m).slice(0, 40)] = n; }); return r; };
    if (!old) {
      if (body.fromId !== u.id && !P.handover) return no(403, 'You can only hand over your own till');
      if (!body.toId || body.toId === body.fromId) return no(400, 'Choose who takes over');
      const raw = await loadAllSales(c, u.tenant_id); raw.tills = raw.tills.filter((t) => t.id !== id);
      body.expected = KC.collectedBy(raw, body.fromId, body.date).by; // never trust the phone's own total
      body.counted = clean(body.counted); body.received = {}; body.status = 'pending';
      if (body.fromId === u.id) body.fromName = u.name; body.createdAt = nowIso;
      return null;
    }
    const keep = { fromId: old.fromId, fromName: old.fromName, toId: old.toId, toName: old.toName, date: old.date, expected: old.expected, counted: old.counted, createdAt: old.createdAt, locationId: old.locationId, note: old.note, payouts: old.payouts };
    if (old.status === 'pending' && ['accepted', 'disputed'].includes(body.status)) {
      if (old.toId !== u.id) return no(403, 'Only ' + (old.toName || 'the person taking over') + ' can accept this till');
      const received = clean(body.received);
      const same = Object.keys(Object.assign({}, old.counted, received)).every((m) => Math.abs((old.counted[m] || 0) - (received[m] || 0)) < 1);
      Object.assign(body, keep, { received, status: same ? 'accepted' : 'disputed', acceptedAt: nowIso, toName: u.name, receiveNote: String(body.receiveNote || '').slice(0, 300) });
    } else if (old.status === 'pending' && body.status === 'cancelled') {
      if (old.fromId !== u.id && !P.handover) return no(403, 'Only the person handing over can cancel');
      Object.assign(body, keep, { received: {}, cancelledAt: nowIso });
    } else if (old.status === 'disputed' && body.status === 'reviewed') {
      if (!P.handover) return no(403, 'Only a manager can close a disputed takeover');
      Object.assign(body, keep, { received: old.received, acceptedAt: old.acceptedAt, receiveNote: old.receiveNote, reviewedBy: u.name, reviewedAt: nowIso, reviewNote: String(body.reviewNote || '').slice(0, 300) });
    } else return no(403, 'This takeover is already ' + old.status);
  }
  return null;
}
async function loadAll(c, tid) {
  const r = await c.query("SELECT collection, id, data FROM documents WHERE tenant_id=$1 AND collection IN ('settings','products','lots','shipments','sales','adjustments','transfers','promos')", [tid]);
  const raw = { settings: {}, products: [], lots: [], shipments: [], sales: [], adjustments: [], transfers: [], promos: [] };
  r.rows.forEach((x) => { const d = Object.assign({}, x.data, { id: x.id }); if (x.collection === 'settings') { if (x.id === 'main') raw.settings = d; } else raw[x.collection].push(d); });
  return raw;
}

app.put('/api/data/:col/:id', auth, colOk, requireActive, wrap(async (req, res) => {
  const { col, id } = req.params; const u = req.user;
  if (KC.COLLECTION_FEATURE[col] && !KC.anyOn(u.features, KC.COLLECTION_FEATURE[col])) return planOff(res, KC.COLLECTION_FEATURE[col][0]); // the plan, not a permission
  let receiving = false;
  if (WRITE_PERMS[col] !== null && !anyU(u, WRITE_PERMS[col])) {
    // a branch may receive a transfer addressed to it without the full "move stock" permission
    if (col === 'transfers' && req.body && req.body.status === 'received') { const pr = (await q("SELECT data FROM documents WHERE tenant_id=$1 AND collection='transfers' AND id=$2", [u.tenant_id, id])).rows[0]; receiving = !!(pr && pr.data.status === 'in_transit' && pr.data.to === (u.location_id || 'main')); }
    // the people in a stock handover sign it on their own phone, even without the stock-count permission (checked below)
    if (col === 'audits') { const pr = (await q("SELECT data FROM documents WHERE tenant_id=$1 AND collection='audits' AND id=$2", [u.tenant_id, id])).rows[0]; const h = pr && pr.data.handover; receiving = !!(h && pr.data.status === 'submitted' && (h.toId === u.id || h.fromId === u.id)); }
    if (!receiving) return err(res, 403, 'You do not have permission to change ' + col);
  }
  if (!ID_RE.test(id)) return err(res, 400, 'Invalid id');
  const body = req.body; if (!body || typeof body !== 'object' || Array.isArray(body)) return err(res, 400, 'Body must be an object');
  delete body.id; if (col !== 'sales') delete body.approval;

  let result;
  try { result = await tx(async (c) => {
    // Serialize stock-affecting writes per tenant so two cashiers can't sell the same last item.
    if (['sales', 'adjustments', 'lots', 'shipments', 'transfers'].includes(col)) await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [u.tenant_id]);
    const prev = (await c.query('SELECT data FROM documents WHERE tenant_id=$1 AND collection=$2 AND id=$3 FOR UPDATE', [u.tenant_id, col, id])).rows[0];

    const P = perms(u);
    if (col === 'products' && !P.costs && prev) { body.priceMax = prev.data.priceMax ?? null; body.priceMin = prev.data.priceMin ?? null; body.markup = prev.data.markup ?? null; body.minMarkup = prev.data.minMarkup ?? null; body.priceHistory = prev.data.priceHistory || []; }
    if (col === 'lots' && !P.costs && prev) { body.unitCost = prev.data.unitCost; body.unitTax = prev.data.unitTax; body.regularPrice = prev.data.regularPrice; }
    if (col === 'shipments' && !P.costs && prev) body.costs = prev.data.costs || [];
    if (col === 'customers' && !P.credit && !P.settings) body.creditLimit = prev ? (prev.data.creditLimit ?? null) : null;
    if (col === 'handovers') {
      if (!P.handover) { if (body.userId !== u.id) return { status: 403, error: 'You can only submit your own handover' }; if (body.status === 'confirmed' || (prev && prev.data.status === 'confirmed')) return { status: 403, error: 'Only a manager can confirm a handover' }; }
      body.expectedTotal = KC.collectedBy(await loadAllSales(c, u.tenant_id), body.userId, body.date).total; // never trust the client's own total
    }
    if (col === 'audits') { const why = auditRules(u, P, body, prev ? prev.data : null); if (why) return why; }
    if (col === 'losses') { const why = lossRules(u, P, body, prev ? prev.data : null); if (why) return why; }
    if (col === 'claims') {
      const o = prev ? prev.data : null;
      if (o && o.status === 'closed') return { status: 409, error: 'This return or claim is closed' };
      if (!o && body.kind === 'return' && !P.stockEdit) return { status: 403, error: 'Only a manager can send stock back' };
      if (!(Number(body.amount) > 0)) return { status: 400, error: 'Type the amount you are owed' };
      Object.assign(body, o ? { by: o.by, byId: o.byId, kind: o.kind, lines: o.lines, no: o.no } : { by: u.name, byId: u.id });
      const oldR = new Map(((o && o.received) || []).map((r) => [r.id, r])); body.received = (Array.isArray(body.received) ? body.received : []).map((r) => oldR.get(r.id) || Object.assign({}, r, { by: u.name, amount: Math.max(0, Math.round(Number(r.amount) || 0)) })); // received money is never changed once recorded
      if (body.status === 'closed' && (!o || o.status !== 'closed')) Object.assign(body, { closedAt: new Date().toISOString(), closedBy: u.name });
    }
    const planErr = await planGuard(c, u, col, body, prev ? prev.data : null); if (planErr) return planErr;
    if (['attendance', 'leaves', 'tills', 'staff'].includes(col)) { const why = await staffRules(c, u, P, col, id, body, prev ? prev.data : null); if (why) return why; }
    if (col === 'settings') {
      const old = prev ? prev.data : {};
      if (body.shopSlug === undefined) { if (old.shopSlug) body.shopSlug = old.shopSlug; } // an older copy of the settings doesn't drop the address
      else if (body.shopSlug) {
        body.shopSlug = String(body.shopSlug).trim().toLowerCase();
        if (body.shopSlug !== old.shopSlug) {
          const bad = KC.shopSlugError(body.shopSlug); if (bad) return { status: 400, error: bad };
          if (await slugTaken(c, body.shopSlug, u.tenant_id)) return { status: 409, error: 'The address "' + body.shopSlug + '" is already used by another shop. Try ' + await freeSlug(c, body.shopSlug, u.tenant_id) };
        }
      } else body.shopSlug = '';
      if (body.menuSlug === undefined) { if (old.menuSlug) body.menuSlug = old.menuSlug; }
      else if (body.menuSlug) {
        body.menuSlug = String(body.menuSlug).trim().toLowerCase();
        if (body.menuSlug !== old.menuSlug) {
          const bad = KC.shopSlugError(body.menuSlug); if (bad) return { status: 400, error: bad.replace('your shop', 'your menu') };
          if (await menuSlugTaken(c, body.menuSlug, u.tenant_id)) return { status: 409, error: 'The menu address "' + body.menuSlug + '" is already used by another venue. Try ' + await freeMenuSlug(c, body.menuSlug, u.tenant_id) };
        }
      } else body.menuSlug = old.menuSlug || ''; // the menu keeps an address once it has one
      // earlier addresses keep opening the menu (posters, links shared on WhatsApp) — the last 5
      body.menuSlugsOld = (old.menuSlug && body.menuSlug !== old.menuSlug ? [old.menuSlug] : []).concat(Array.isArray(old.menuSlugsOld) ? old.menuSlugsOld : []).filter((x, i, a) => x && x !== body.menuSlug && a.indexOf(x) === i).slice(0, 5);
      if (old.menuKey && !body.menuKey) body.menuKey = old.menuKey; // printed table QR codes depend on it
      if (old.businessName && !String(body.businessName || '').trim()) body.businessName = old.businessName; // a business never loses its name to an early or partial save
    }
    if (col === 'bills') {
      // purchases: every bill has a transaction id; payments carry mode, txn id and MoMo charges (separate from amount)
      const old = prev ? prev.data : null;
      body.txnId = old ? KC.billTxnId(Object.assign({ id }, old)) : (TXN_RE.test(String(body.txnId || '')) ? String(body.txnId) : KC.newTxnId('PU', body.date));
      const oldPays = new Map(((old && old.payments) || []).map((p) => [p.id, p]));
      const S0 = await tenantSettings(c, u.tenant_id);
      for (const p of (body.payments = Array.isArray(body.payments) ? body.payments : [])) {
        const o = oldPays.get(p.id);
        if (o) { Object.assign(p, { amount: o.amount, fee: o.fee, method: o.method, ref: o.ref, account: o.account, date: o.date, by: o.by, byId: o.byId }); continue; }
        p.byId = u.id; p.by = u.name;
        p.fee = KC.isMobileMoney(p.method) && Number(p.amount) > 0 ? Math.max(0, Number(p.fee) || 0) : 0;
        p.ref = String(p.ref || '').trim(); p.account = String(p.account || '').trim();
        const payErr = KC.validatePayment(p, S0, 'purchase'); if (payErr) return { status: 400, error: payErr };
      }
    }
    if (col === 'shipments' && P.costs) {
      // container costs paid on the spot: same payment rules as purchases
      const oldCosts = new Map((((prev && prev.data.costs) || [])).map((k) => [k.id, k]));
      const S0 = await tenantSettings(c, u.tenant_id);
      for (const k of body.costs || []) {
        const o = oldCosts.get(k.id);
        if (o) { if (o.txnId) k.txnId = o.txnId; if (o.payment) k.payment = o.payment; continue; }
        if (!TXN_RE.test(String(k.txnId || ''))) k.txnId = KC.newTxnId('PU', k.date);
        if (k.payment) {
          const p = k.payment; p.byId = u.id; p.by = u.name;
          p.fee = KC.isMobileMoney(p.method) && Number(p.amount) > 0 ? Math.max(0, Number(p.fee) || 0) : 0;
          p.ref = String(p.ref || '').trim();
          const payErr = KC.validatePayment(p, S0, 'purchase'); if (payErr) return { status: 400, error: payErr };
        }
      }
    }
    if (col === 'assets') {
      const bad = KC.assetCheck(body); if (bad) return { status: 400, error: bad };
      if (KC.assetGone(body) && body.disposal && body.disposal.date) body.disposal.bookValue = Math.round(KC.assetBookOn(body, Object.assign({}, KC.DEFAULT_SETTINGS, ((await c.query("SELECT data FROM documents WHERE tenant_id=$1 AND collection='settings' AND id='main'", [u.tenant_id])).rows[0] || {}).data || {}), body.disposal.date));
    }
    if (col === 'transfers' && prev && prev.data.status === 'in_transit' && body.status === 'received') {
      if (!P.allLocations && !P.transfers && prev.data.to !== (u.location_id || 'main')) return { status: 403, error: 'Only the receiving branch can receive this transfer' };
      // keep what was sent; only the received quantities may change, and the server books any shortfall as a loss
      const sent = prev.data.lines || []; body.lines = sent.map((l, i) => Object.assign({}, l, { receivedQty: Math.max(0, Math.min(Number(l.qty), Number(((body.lines || [])[i] || {}).receivedQty ?? l.qty))) }));
      body.from = prev.data.from; body.to = prev.data.to; body.receivedById = u.id; body.receivedBy = u.name;
      for (const [li, l] of body.lines.entries()) { let miss = Number(l.qty) - Number(l.receivedQty); let ai = 0; for (const a of (l.alloc || []).slice().reverse()) { if (miss <= 0) break; const take = Math.min(miss, Number(a.qty)); miss -= take; await c.query(`INSERT INTO documents(tenant_id,collection,id,data,updated_by) VALUES ($1,'adjustments',$2,$3,$4) ON CONFLICT (tenant_id,collection,id) DO UPDATE SET data=EXCLUDED.data`, [u.tenant_id, 'a_tr_' + id + '_' + li + '_' + (ai++), JSON.stringify({ date: new Date().toISOString().slice(0, 10), productId: l.productId, lotId: a.lotId, qty: -take, locationId: body.to, reason: 'Missing in transfer', notes: 'Transfer ' + (body.no || id), by: u.name, byId: u.id }), u.id]); } }
    } else if (col === 'transfers') {
      const raw = await loadAll(c, u.tenant_id);
      if (!P.allLocations && body.from !== (u.location_id || 'main')) return { status: 403, error: 'You can only move stock out of your own location' };
      const problems = KC.validateTransfer(raw, Object.assign({}, body, { id }));
      if (problems.length) return { status: 409, error: 'Not enough stock', details: problems };
    }
    if (col === 'sales') {
      if (body.delivery) body.delivery = KC.cleanDelivery(body.delivery); else delete body.delivery;
      const old = prev ? prev.data : null;
      if (!P.allLocations && (body.locationId || 'main') !== (u.location_id || 'main')) return { status: 403, error: 'You can only sell at your own location' };
      if (!old) { body.createdById = u.id; body.createdBy = u.name; if (!P.sell) return { status: 403, error: 'You cannot make sales' }; }
      else {
        body.createdById = old.createdById; body.createdBy = old.createdBy;
        if (!P.salesAll && old.createdById !== u.id) return { status: 403, error: 'You can only change your own sales' };
      }
      // risky actions: refused unless allowed — by permission, or by a manager's approval on the spot (see /api/approvals)
      const RULES = Object.assign({}, KC.DEFAULT_SETTINGS.approvals, ((await tenantSettings(c, u.tenant_id)) || {}).approvals || {});
      const needs = []; const need = (action, error) => { if (!needs.some((n) => n.action === action)) needs.push({ action, error }); };
      if (old && old.status !== 'cancelled' && body.status === 'cancelled' && (!P.cancel || (RULES.cancel && !P.approve))) need('cancel', P.cancel ? 'Cancelling a sale needs a manager\'s approval' : 'You cannot cancel sales');
      const oldPays = new Set(((old && old.payments) || []).map((p) => p.id)), newPays = (body.payments || []);
      if (old && (old.payments || []).some((p) => !newPays.find((n) => n.id === p.id)) && (!P.cancel || (RULES.cancel && !P.approve))) need('cancel', P.cancel ? 'Deleting a payment needs a manager\'s approval' : 'You cannot remove payments');
      const refunded = newPays.filter((p) => !oldPays.has(p.id) && Number(p.amount) < 0).reduce((t, p) => t - Number(p.amount), 0);
      if (refunded > 0 && Number(RULES.refundAbove) > 0 && refunded > Number(RULES.refundAbove) && !P.approve) need(body.status === 'cancelled' ? 'cancel' : 'returns', 'A refund of ' + grp(refunded) + ' F needs a manager\'s approval');
      if (newPays.some((p) => !oldPays.has(p.id) && Number(p.amount) > 0) && !P.payments) return { status: 403, error: 'You cannot record payments' };
      // who collected the money is decided by the server (cash handover depends on it)
      newPays.forEach((p) => { if (!oldPays.has(p.id)) { p.byId = u.id; p.by = u.name; } else { const o = old.payments.find((x) => x.id === p.id); p.byId = o.byId; p.by = o.by; } });
      // load settings early so MoMo fee / txn-id rules use this tenant's tables
      const raw = await loadAll(c, u.tenant_id);
      const paySettings = Object.assign({}, KC.DEFAULT_SETTINGS, raw.settings || {});
      for (const p of newPays) {
        if (oldPays.has(p.id)) {
          const o = (old.payments || []).find((x) => x.id === p.id);
          if (o) { p.fee = o.fee; p.ref = o.ref; p.method = o.method; p.account = o.account; p.amount = o.amount; p.date = o.date; }
          continue;
        }
        p.fee = Math.max(0, Number(p.fee) || 0);
        if (!KC.isMobileMoney(p.method) || Number(p.amount) < 0) p.fee = 0;
        p.ref = String(p.ref || '').trim();
        const payErr = KC.validatePayment(p, paySettings);
        if (payErr) return { status: 400, error: payErr };
      }
      // every sale has a transaction id; once set it never changes
      body.txnId = old ? KC.saleTxnId(old) : (TXN_RE.test(String(body.txnId || '')) ? String(body.txnId) : KC.newTxnId('TX', body.date));
      const oldRet = JSON.stringify(((old && old.lines) || []).map((l) => l.returns || [])), newRet = JSON.stringify((body.lines || []).map((l) => l.returns || []));
      if (old && oldRet !== newRet && !P.returns) need('returns', 'You cannot process returns');
      const linesChanged = !old || JSON.stringify((old.lines || []).map((l) => [l.productId, l.qty, l.unitPrice])) !== JSON.stringify((body.lines || []).map((l) => [l.productId, l.qty, l.unitPrice]));
      if (linesChanged && !P.sell) return { status: 403, error: 'You cannot change sale items' };
      const pct = Number(RULES.discountPct) > 0 && !P.approve ? Number(RULES.discountPct) : 0;
      if (!P.discount || pct) {
        const C0 = KC.computeAll(raw);
        const cust = body.customerId ? ((await c.query("SELECT data FROM documents WHERE tenant_id=$1 AND collection='customers' AND id=$2", [u.tenant_id, body.customerId])).rows[0] || {}).data : null;
        const more = Number(body.discount || 0) > Number((old && old.discount) || 0);
        if (more && !P.discount) need('discount', 'You cannot give discounts');
        if (more && pct) { const sub = (body.lines || []).reduce((t, l) => t + Number(l.unitPrice) * Number(l.qty), 0); if (sub > 0 && Number(body.discount) / sub * 100 > pct + 0.01) need('discount', 'A discount above ' + pct + '% needs a manager\'s approval'); }
        for (const l of body.lines || []) {
          const before = old && (old.lines || []).find((o) => o.productId === l.productId);
          if ((before && Number(before.unitPrice) === Number(l.unitPrice)) || !C0.prodX[l.productId]) continue;
          if (!P.discount && Number(l.unitPrice) < KC.priceFloor(C0, l.productId, l.qty, cust) - 0.5) need('discount', 'Price for ' + (l.name || 'an item') + ' is below the minimum');
          const full = Number(C0.prodX[l.productId].priceMax) || 0;
          if (pct && full > 0 && (full - Number(l.unitPrice)) / full * 100 > pct + 0.01) need('discount', (l.name || 'An item') + ' is more than ' + pct + '% below its price — a manager must approve');
        }
      }
      const problems = KC.validateSale(raw, Object.assign({}, body, { id }));
      if (!problems.length && body.customerId && body.status !== 'cancelled' && !P.credit) {
        const cust = (await c.query("SELECT data FROM documents WHERE tenant_id=$1 AND collection='customers' AND id=$2", [u.tenant_id, body.customerId])).rows[0];
        const C1 = KC.computeAll(Object.assign({}, raw, { sales: raw.sales.filter((x) => x.id !== id).concat([Object.assign({}, body, { id })]) }));
        const lim = KC.creditLimitOf(C1.S, cust && cust.data);
        const owed = KC.customerBalance(Object.assign({}, raw, { sales: raw.sales.filter((x) => x.id !== id).concat([Object.assign({}, body, { id })]) }), C1, body.customerId);
        const before = KC.customerBalance(raw, KC.computeAll(raw), body.customerId);
        if (lim !== null && owed > lim + 0.5 && owed > before + 0.5) need('credit', 'Credit limit exceeded (' + grp(owed) + ' > ' + grp(lim) + ' F)');
      }
      if (problems.length) return { status: 409, error: 'Not enough stock', details: problems };
      // each risky action needs its own approval for this sale, from someone allowed to do it
      const given = [].concat(body.approval || []).map(readApproval).filter((a) => a && a.tid === u.tenant_id && a.for === u.id && a.ref === id); delete body.approval;
      body.approvals = ((old && old.approvals) || []).slice(0, 50);
      for (const n of needs) {
        const ok = given.find((a) => a.action === n.action);
        if (!ok) return { status: 403, error: n.error + ' — a manager must approve.', code: 'approval_required', details: { action: n.action, ref: id, message: n.error } };
        body.approvals.push({ action: n.action, byId: ok.by, by: ok.name, at: new Date().toISOString(), forId: u.id, for: u.name });
      }
      if (!body.approvals.length) delete body.approvals;
    }
    await c.query(`INSERT INTO documents(tenant_id,collection,id,data,updated_by,updated_at) VALUES ($1,$2,$3,$4,$5,now())
                   ON CONFLICT (tenant_id,collection,id) DO UPDATE SET data=EXCLUDED.data, updated_by=EXCLUDED.updated_by, updated_at=now()`, [u.tenant_id, col, id, JSON.stringify(body), u.id]);
    await c.query('INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action,collection,doc_id,before,after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [u.tenant_id, u.id, u.name, body.locationId || body.to || u.location_id || 'main', prev ? 'update' : 'create', col, id, prev ? JSON.stringify(prev.data) : null, JSON.stringify(body)]);
    return { ok: true };
  }); } catch (e) { if (e.code === '23505' && col === 'settings') return err(res, 409, 'This shop address was just taken by another shop. Choose another.'); throw e; }
  if (result.error) return err(res, result.status, result.error, result.code === 'approval_required' ? { code: result.code, details: result.details } : result.details ? { details: result.details } : result.code ? { code: result.code, limit: result.limit } : undefined);
  broadcast(u.tenant_id, col, id);
  res.json({ ok: true });
}));

app.delete('/api/data/:col/:id', auth, colOk, requireActive, wrap(async (req, res) => {
  const { col, id } = req.params; const u = req.user;
  if (KC.COLLECTION_FEATURE[col] && !KC.anyOn(u.features, KC.COLLECTION_FEATURE[col])) return planOff(res, KC.COLLECTION_FEATURE[col][0]);
  if (!anyU(u, DELETE_PERMS[col])) return err(res, 403, 'You do not have permission to delete ' + col);
  if (col === 'sales') return err(res, 400, 'Sales are never deleted — cancel them instead');
  if (col === 'settings') return err(res, 400, 'Settings cannot be deleted');
  const r = await tx(async (c) => {
    if (col === 'lots' || col === 'products') {
      const raw = await loadAll(c, u.tenant_id);
      const used = raw.sales.some((s) => (s.lines || []).some((l) => (col === 'products' ? l.productId === id : (l.alloc || []).some((a) => a.lotId === id))));
      if (used) return { status: 409, error: 'This record has sales and cannot be deleted' };
    }
    const prev = (await c.query('DELETE FROM documents WHERE tenant_id=$1 AND collection=$2 AND id=$3 RETURNING data', [u.tenant_id, col, id])).rows[0];
    if (prev) await c.query("INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action,collection,doc_id,before) VALUES ($1,$2,$3,$4,'delete',$5,$6,$7)", [u.tenant_id, u.id, u.name, u.location_id || 'main', col, id, JSON.stringify(prev.data)]);
    return { ok: true };
  });
  if (r.error) return err(res, r.status, r.error);
  broadcast(u.tenant_id, col, id);
  res.json({ ok: true });
}));

/* ---------- backup / restore (same file format as the hosted app) ---------- */
app.get('/api/export', auth, requireFeature('excel'), requirePerm('export'), wrap(async (req, res) => {
  const r = await q('SELECT collection, id, data FROM documents WHERE tenant_id=$1', [req.user.tenant_id]);
  const data = {}; COLLECTIONS.forEach((c) => (data[c] = []));
  r.rows.forEach((x) => data[x.collection] && data[x.collection].push(Object.assign({}, x.data, { id: x.id })));
  res.setHeader('Content-Disposition', 'attachment; filename="aahsso-backup.json"');
  res.json({ app: 'aahsso', version: 1, exportedAt: new Date().toISOString(), business: req.user.tenant_name, data });
}));
app.post('/api/import', auth, requireActive, requirePerm('settings'), wrap(async (req, res) => {
  const b = req.body; if (!b || !['aahsso', 'kargo'].includes(b.app) || !b.data) return err(res, 400, 'Not an Aahsso backup file');
  const n = await importBackup(req.user.tenant_id, req.user.id, b);
  COLLECTIONS.forEach((c) => broadcast(req.user.tenant_id, c));
  res.json({ ok: true, imported: n });
}));
async function importBackup(tid, uid, b) {
  return tx(async (c) => {
    let n = 0;
    for (const col of COLLECTIONS) for (const d of b.data[col] || []) {
      if (!d || !d.id || !ID_RE.test(d.id)) continue;
      const body = Object.assign({}, d); const id = col === 'settings' ? 'main' : body.id; delete body.id;
      await c.query(`INSERT INTO documents(tenant_id,collection,id,data,updated_by) VALUES ($1,$2,$3,$4,$5)
                     ON CONFLICT (tenant_id,collection,id) DO UPDATE SET data=EXCLUDED.data, updated_by=EXCLUDED.updated_by, updated_at=now()`, [tid, col, id, JSON.stringify(body), uid]);
      n++;
    }
    await c.query("INSERT INTO audit_log(tenant_id,user_id,action,doc_id) VALUES ($1,$2,'import',$3)", [tid, uid, String(n)]);
    return n;
  });
}

/* ---------- team management ---------- */
/* ---------- manager approval on the spot ----------
 * A cashier who may not cancel, refund, discount below the minimum or go over a credit limit (or who passes the limits
 * set in Settings → Approvals) asks a manager. The manager picks their name and types their PIN on the cashier's phone;
 * the server gives a short-lived approval for that one action on that one sale, and the sale records who approved. */
const APPROVAL_ACTIONS = { cancel: 'cancel', returns: 'returns', discount: 'discount', credit: 'credit' }; // action → the permission the approver needs
const b64u = (b) => Buffer.from(b).toString('base64url');
function approvalToken(p) { const body = b64u(JSON.stringify(p)); return body + '.' + crypto.createHmac('sha256', SECRET).update('approval:' + body).digest('base64url'); }
function readApproval(tok) {
  const [body, sig] = String(tok || '').split('.'); if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', SECRET).update('approval:' + body).digest('base64url');
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch (e) { return null; }
}
/** the permissions of another person of the same business (the approver) */
async function permsOf(id, me) {
  const r = (await q('SELECT id, name, role, perms, active, tenant_id, approval_pin_hash, approval_pin_fails, approval_pin_locked_until FROM users WHERE id::text=$1 AND tenant_id=$2', [String(id), me.tenant_id])).rows[0];
  if (!r || !r.active) return null;
  return { row: r, P: perms(Object.assign({}, r, { features: me.features, customRoles: me.customRoles })) };
}
app.get('/api/approvers', auth, wrap(async (req, res) => {
  const rows = (await q('SELECT id, name, role, perms, active, approval_pin_hash IS NOT NULL AS pin FROM users WHERE tenant_id=$1 AND active ORDER BY name', [req.user.tenant_id])).rows;
  const action = APPROVAL_ACTIONS[req.query.action] ? req.query.action : null;
  res.json({ approvers: rows.filter((r) => { const P = perms(Object.assign({}, r, { features: req.user.features, customRoles: req.user.customRoles })); return P.approve && (!action || P[APPROVAL_ACTIONS[action]]); }).map((r) => ({ id: r.id, name: r.name, pin: r.pin })) });
}));
app.post('/api/me/approval-pin', auth, authLimiter, wrap(async (req, res) => {
  const { password, pin } = req.body || {};
  if (!perms(req.user).approve) return err(res, 403, 'Only managers who approve for others need a PIN');
  if (!/^\d{4,6}$/.test(String(pin || ''))) return err(res, 400, 'The PIN is 4 to 6 digits');
  if (/^(\d)\1+$/.test(String(pin)) || '0123456789'.includes(String(pin)) || '9876543210'.includes(String(pin))) return err(res, 400, 'Choose a PIN that is harder to guess');
  const row = (await q('SELECT password_hash FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (!(await bcrypt.compare(String(password || ''), row.password_hash))) return err(res, 400, 'Your password is wrong', { code: 'bad_password' });
  await q('UPDATE users SET approval_pin_hash=$1, approval_pin_fails=0, approval_pin_locked_until=NULL WHERE id=$2', [await bcrypt.hash(String(pin), 10), req.user.id]);
  res.json({ ok: true });
}));
app.post('/api/approvals', auth, requireActive, authLimiter, wrap(async (req, res) => {
  const { approverId, pin, action, ref, why } = req.body || {}; const u = req.user;
  if (!APPROVAL_ACTIONS[action]) return err(res, 400, 'Unknown action');
  if (!ID_RE.test(String(ref || ''))) return err(res, 400, 'Missing record');
  const a = await permsOf(approverId, u); if (!a) return err(res, 404, 'Choose who approves');
  if (!a.P.approve || !a.P[APPROVAL_ACTIONS[action]]) return err(res, 403, a.row.name + ' cannot approve this');
  if (!a.row.approval_pin_hash) return err(res, 400, a.row.name + ' has no approval PIN yet — set it in My profile');
  if (a.row.approval_pin_locked_until && new Date(a.row.approval_pin_locked_until) > new Date()) return err(res, 429, 'Too many wrong PINs for ' + a.row.name + '. Try again after ' + new Date(a.row.approval_pin_locked_until).toTimeString().slice(0, 5) + '.');
  if (!(await bcrypt.compare(String(pin || ''), a.row.approval_pin_hash))) {
    const f = (a.row.approval_pin_fails || 0) + 1;
    await q("UPDATE users SET approval_pin_fails=$1, approval_pin_locked_until=CASE WHEN $3 THEN now() + interval '15 minutes' END WHERE id=$2", [f >= 5 ? 0 : f, a.row.id, f >= 5]);
    await q("INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action,after) VALUES ($1,$2,$3,$4,'approval_failed',$5)", [u.tenant_id, u.id, u.name, u.location_id || 'main', JSON.stringify({ approver: a.row.name, action, ref })]);
    return err(res, 400, f >= 5 ? 'Wrong PIN — locked for 15 minutes' : 'Wrong PIN (' + (5 - f) + ' tr' + (5 - f === 1 ? 'y' : 'ies') + ' left)');
  }
  await q('UPDATE users SET approval_pin_fails=0, approval_pin_locked_until=NULL WHERE id=$1', [a.row.id]);
  await q("INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action,after) VALUES ($1,$2,$3,$4,'approval',$5)", [u.tenant_id, a.row.id, a.row.name, u.location_id || 'main', JSON.stringify({ for: u.name, action, ref, why: String(why || '').slice(0, 200) })]);
  res.json({ approval: approvalToken({ tid: u.tenant_id, for: u.id, by: a.row.id, name: a.row.name, action, ref: String(ref), exp: Date.now() + 5 * 60e3 }), by: a.row.name });
}));
app.get('/api/team-names', auth, wrap(async (req, res) => {
  res.json({ people: (await q('SELECT id, name, role, location_id AS "locationId", active FROM users WHERE tenant_id=$1 ORDER BY name', [req.user.tenant_id])).rows });
}));
app.get('/api/users', auth, requirePerm('team'), wrap(async (req, res) => {
  res.json({ users: (await q('SELECT u.id,u.name,coalesce(p.login,u.login) AS login,u.email,u.role,u.perms,u.location_id AS "locationId",u.active,u.created_at,u.last_login_at FROM users u LEFT JOIN users p ON p.id=u.person_id WHERE u.tenant_id=$1 ORDER BY u.created_at', [req.user.tenant_id])).rows });
}));
const ROLE_OK_BASE = ['admin', 'manager', 'sales', 'viewer', 'resto_waiter', 'resto_cashier', 'resto_kitchen'];
const roleOk = (u, r) => r !== 'owner' && (ROLE_OK_BASE.includes(r) || (KC.featureOn(u.features, 'customRoles') && !!(u.customRoles && u.customRoles[r])));
const cleanPerms = (p, u) => { const o = {}; if (u && !KC.featureOn(u.features, 'customRoles')) return o; if (p && typeof p === 'object') KC.PERMS.forEach(([k]) => { if (k in p) o[k] = !!p[k]; }); return o; };
app.post('/api/users', auth, requireActive, requirePerm('team'), wrap(async (req, res) => {
  const { name, login, password, role, perms: pp, locationId, email, sendEmail } = req.body || {};
  if (!name || !login || !password || !roleOk(req.user, role)) return err(res, 400, 'name, login, password and role (admin|manager|sales|viewer) are required');
  if (email && !mailer.isEmail(email)) return err(res, 400, 'Type a valid email address (or leave it empty)');
  if (String(password).length < 6) return err(res, 400, 'Password must be at least 6 characters');
  if (role === 'admin' && req.user.role !== 'owner' && req.user.role !== 'admin') return err(res, 403, 'Only the owner or an admin can create admins');
  const lim = await billing.checkLimit(pool, req.user.tenant_id, 'maxUsers'); if (lim) return err(res, lim.status, lim.error, { code: lim.code, limit: lim.limit });
  try {
    const u = (await q('INSERT INTO users(tenant_id,name,login,password_hash,role,perms,location_id,email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,login,email,role,perms,location_id', [req.user.tenant_id, name, String(login).trim().toLowerCase(), await bcrypt.hash(String(password), 10), role, JSON.stringify(cleanPerms(pp, req.user)), locationId || 'main', cleanEmail(email)])).rows[0];
    res.json({ user: u, email: await staffEmail(req, u, String(password), sendEmail, false) });
  } catch (e) { if (e.code === '23505') return err(res, 409, 'Login already in use'); throw e; }
}));
app.patch('/api/users/:id', auth, requirePerm('team'), wrap(async (req, res) => {
  const { role, active, password, name, perms: pp, locationId, email, sendEmail } = req.body || {};
  if (email && !mailer.isEmail(email)) return err(res, 400, 'Type a valid email address (or leave it empty)');
  const target = (await q('SELECT * FROM users WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id])).rows[0];
  if (!target) return err(res, 404, 'User not found');
  if (target.role === 'owner' && req.user.role !== 'owner') return err(res, 403, 'Only the owner can change the owner');
  if (role && !roleOk(req.user, role)) return err(res, 400, 'Invalid role');
  if (target.id === req.user.id && (role || active === false || pp)) return err(res, 400, 'You cannot change your own role, permissions or disable yourself');
  if (role === 'admin' && !['owner', 'admin'].includes(req.user.role)) return err(res, 403, 'Only the owner or an admin can make someone an admin');
  if (target.role === 'admin' && !['owner', 'admin'].includes(req.user.role)) return err(res, 403, 'Only the owner or an admin can change an admin');
  if (active === true && !target.active) { const lim = await billing.checkLimit(pool, req.user.tenant_id, 'maxUsers'); if (lim) return err(res, lim.status, lim.error, { code: lim.code, limit: lim.limit }); }
  await q('UPDATE users SET role=COALESCE($1,role), active=COALESCE($2,active), name=COALESCE($3,name), password_hash=COALESCE($4,password_hash), perms=COALESCE($5,perms), location_id=COALESCE($6,location_id) WHERE id=$7',
    [target.role === 'owner' ? null : role || null, typeof active === 'boolean' && target.role !== 'owner' ? active : null, name || null, password ? await bcrypt.hash(String(password), 10) : null, pp && target.role !== 'owner' ? JSON.stringify(cleanPerms(pp, req.user)) : null, locationId || null, target.id]);
  if (email !== undefined) await q('UPDATE users SET email=$1 WHERE id=$2', [cleanEmail(email), target.id]);
  const after = (await q('SELECT * FROM users WHERE id=$1', [target.id])).rows[0];
  res.json({ ok: true, email: password ? await staffEmail(req, after, String(password), sendEmail, true) : null });
}));
/** Email a team member their login and password (new account, or a password reset by the owner / an admin). */
async function staffEmail(req, u, password, wanted, reset) {
  const to = mailer.emailOf(u);
  if (wanted === false) return { status: 'not_requested' };
  if (!to) return { status: 'no_email' };
  const r = await mailer.sendEmail(Object.assign({ to, kind: reset ? 'staff_password' : 'staff_account', tenantId: req.user.tenant_id }, mailer.T.staffAccount({ name: u.name, business: await businessName(req.user.tenant_id, req.user.tenant_name), login: u.login, password, role: u.role, url: mailer.appUrl(req), by: req.user.name, reset })));
  return { status: r.status, to, error: r.error || undefined };
}
/* plain-language activity history: who did what, where, when, why */
app.get('/api/activity', auth, requireFeature('activity'), wrap(async (req, res) => {
  const u = req.user; const from = String(req.query.from || new Date().toISOString().slice(0, 10)), to = String(req.query.to || from);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return err(res, 400, 'from/to must be YYYY-MM-DD');
  const all = canU(u, 'activity');
  const rows = (await q(`SELECT a.at, a.user_id, COALESCE(a.user_name, us.name) AS user_name, us.role, a.location_id, a.action, a.collection, a.doc_id, a.before, a.after FROM audit_log a LEFT JOIN users us ON us.id=a.user_id
    WHERE a.tenant_id=$1 AND (a.at AT TIME ZONE 'Africa/Douala')::date BETWEEN $2::date AND $3::date ${all ? '' : 'AND a.user_id=$4'} ORDER BY a.at DESC LIMIT 5000`, all ? [u.tenant_id, from, to] : [u.tenant_id, from, to, u.id])).rows;
  const docs = (await q("SELECT collection, id, data FROM documents WHERE tenant_id=$1 AND collection IN ('products','customers','locations','shipments','suppliers','settings','assets')", [u.tenant_id])).rows;
  const by = {}; docs.forEach((d) => ((by[d.collection] = by[d.collection] || {})[d.id] = d.data));
  const S = Object.assign({}, KC.DEFAULT_SETTINGS, (by.settings || {}).main || {});
  const sym = KC.currencySymbolOf(S); const F = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' ' + sym;
  const L = { product: (id) => ((by.products || {})[id] || {}).name || 'item', customer: (id) => ((by.customers || {})[id] || {}).name || 'customer', loc: (id) => (!id || id === 'main' ? S.mainLocationName || 'Main warehouse' : ((by.locations || {})[id] || {}).name || id), ship: (id) => ((by.shipments || {})[id] || {}).name || 'container', supplier: (id) => ((by.suppliers || {})[id] || {}).name || 'supplier', asset: (id) => ((by.assets || {})[id] || {}).name || 'asset', F, money: (v, c) => (c && c !== S.currency ? Number(v).toFixed(2) + ' ' + c : F(v)) };
  const roles = KC.rolesWith(u.customRoles); const entries = [];
  rows.forEach((r) => {
    const base = { at: new Date(r.at).toISOString(), uid: r.user_id, user: r.user_name || '—', role: (roles[r.role] || { label: r.role || '' }).label, loc: r.location_id || 'main', col: r.collection, id: r.doc_id };
    if (r.action === 'login') return entries.push(Object.assign(base, { type: 'Settings & team', text: 'Signed in' }));
    if (r.action === 'register') return entries.push(Object.assign(base, { type: 'Settings & team', text: 'Created the business account' }));
    if (r.action === 'support_view') return entries.push(Object.assign(base, { type: 'Settings & team', text: 'Aahsso support viewed your account (read-only)', reason: (r.after || {}).reason || '' }));
    if (r.action === 'support_password') return entries.push(Object.assign(base, { type: 'Settings & team', text: 'Aahsso support reset the owner password', reason: (r.after || {}).reason || '' }));
    if (r.action === 'import') return entries.push(Object.assign(base, { type: 'Settings & team', text: 'Restored a backup (' + r.doc_id + ' records)' }));
    if (!r.collection) return;
    let lines = []; try { lines = KC.describeChange(r.collection, r.before, r.action === 'delete' ? null : r.after || r.before, L); } catch (e) { lines = [{ type: KC.ACT_TYPES[r.collection] || r.collection, text: r.action + ' ' + r.collection }]; }
    if (!r.after && r.action !== 'delete' && !lines.length) lines = [{ type: KC.ACT_TYPES[r.collection] || r.collection, text: (r.action === 'create' ? 'Created ' : 'Changed ') + r.collection }];
    lines.forEach((l) => entries.push(Object.assign({}, base, l)));
  });
  res.json({ entries });
}));
app.get('/api/audit', auth, requirePerm('team'), wrap(async (req, res) => {
  res.json({ events: (await q('SELECT a.at,a.action,a.collection,a.doc_id,u.name AS user FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=$1 ORDER BY a.at DESC LIMIT 500', [req.user.tenant_id])).rows });
}));

/* ---------- a sale's receipt by email ---------- */
app.post('/api/sales/:id/email', auth, requireFeature('emailReceipts'), wrap(async (req, res) => {
  if (!anyU(req.user, ['sell', 'payments', 'salesAll'])) return err(res, 403, 'You do not have permission for this');
  const to = cleanEmail((req.body || {}).to); if (!to) return err(res, 400, 'Type a valid email address');
  const row = (await q("SELECT data FROM documents WHERE tenant_id=$1 AND collection='sales' AND id=$2", [req.user.tenant_id, req.params.id])).rows[0];
  if (!row) return err(res, 404, 'Sale not found');
  const sale = Object.assign({}, row.data, { id: req.params.id }); const st = await tenantSettings(pool, req.user.tenant_id);
  const r = await mailer.sendEmail(Object.assign({ to, kind: 'receipt', tenantId: req.user.tenant_id, replyTo: cleanEmail(st.email) || undefined }, mailer.T.receipt({ business: st.businessName, sale, totals: KC.saleTotals(sale), sym: KC.currencySymbolOf(st), phone: st.phone, address: st.address, footer: st.receiptFooter })));
  if (r.status === 'failed') return err(res, 502, 'The email could not be sent: ' + r.error);
  res.json({ ok: true, status: r.status, to });
}));

/* ---------- automatic debt reminders ---------- */
const reminders = require('./reminders');
app.post('/api/reminders/run', auth, requireActive, requireFeature('reminders'), requirePerm('reminders'), wrap(async (req, res) => {
  const out = await reminders.runForTenant(req.user.tenant_id, { dryRun: !!(req.body && req.body.dryRun), force: true, by: req.user.name });
  COLLECTIONS.forEach((c) => c === 'reminders' && broadcast(req.user.tenant_id, c));
  res.json(out);
}));
// Vercel Cron (vercel.json) calls this once a day; Vercel sends "Authorization: Bearer $CRON_SECRET".
app.get('/api/cron/reminders', wrap(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== 'Bearer ' + secret) return err(res, 401, 'Unauthorized');
  const done = await reminders.runDue({ anyHour: true });
  done.forEach((d) => broadcast(d.tenant, 'reminders'));
  const emails = await dailyEmails(mailer.appUrl(req));
  res.json({ ok: true, businesses: done.length, done, emails });
}));
app.get('/api/reminders/provider', auth, (req, res) => res.json({ provider: reminders.providerName(), email: mailer.enabled() }));
/** Daily emails: the owner hears 3 days before the free trial ends, and on the last day (each once). */
async function dailyEmails(url) {
  const rows = (await q("SELECT t.id, t.name, (t.trial_ends_at::date - now()::date) AS days FROM tenants t WHERE t.plan='trial' AND t.status <> 'suspended' AND t.trial_ends_at IS NOT NULL AND (t.trial_ends_at::date - now()::date) IN (3, 0)")).rows;
  let sent = 0;
  for (const t of rows) {
    const owners = (await q("SELECT * FROM users WHERE tenant_id=$1 AND role='owner' AND active", [t.id])).rows;
    for (const u of owners) {
      const to = mailer.emailOf(u); if (!to) continue;
      const r = await mailer.sendEmail(Object.assign({ to, kind: 'trial_ending', tenantId: t.id, dedupe: 'trial:' + t.id + ':' + t.days }, mailer.T.trialEnding({ name: u.name, business: await businessName(t.id, t.name), daysLeft: Number(t.days), url: url || mailer.appUrl() })));
      if (r.status === 'sent' || r.status === 'skipped') sent++;
    }
  }
  let bill = {}; try { bill = await billing.daily(url || mailer.appUrl()); } catch (e) { console.error('[billing] daily', e.message); }
  let mm = {}; try { mm = await momo.sweep(); } catch (e) { console.error('[fapshi] daily sweep', e.message); }
  return { trialEnding: sent, billing: bill, momo: mm };
}

/* ---------- product photos ---------- */
// product photos need the Photos feature; a photo proving a loss (?for=evidence) is always allowed to whoever reports losses
const photosOrEvidence = (req, res, next) => (req.query.for === 'evidence' ? next() : requireFeature('photos')(req, res, next));
app.post('/api/images', auth, requireActive, photosOrEvidence, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '4mb' }), wrap(async (req, res) => {
  if (!anyU(req.user, req.query.for === 'evidence' ? ['lossReport', 'stockEdit'] : ['stockEdit', 'purchases'])) return err(res, 403, 'You do not have permission to add photos');
  if (!Buffer.isBuffer(req.body) || !req.body.length) return err(res, 400, 'Send a JPEG, PNG or WebP image');
  const r = await q('INSERT INTO images(tenant_id,content_type,data) VALUES ($1,$2,$3) RETURNING id', [req.user.tenant_id, req.headers['content-type'], req.body]);
  res.json({ id: r.rows[0].id });
}));
app.get('/api/images/:id', wrap(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).end();
  const r = (await q('SELECT content_type, data FROM images WHERE id=$1', [req.params.id])).rows[0];
  if (!r) return res.status(404).end();
  res.set('Content-Type', r.content_type).set('Cache-Control', 'public, max-age=31536000, immutable').send(r.data);
}));


/* ---------- public online shop (no login): clients browse items in stock and send an order with their delivery details ---------- */
const SHOP_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,59}$/;
/** Is this shop address used by another business (as an address, or as an old shop key)? */
async function slugTaken(c, slug, tid) {
  return (await c.query("SELECT 1 FROM documents WHERE collection='settings' AND id='main' AND tenant_id <> $2 AND (lower(data->>'shopSlug')=$1 OR lower(data->>'shopId')=$1) LIMIT 1", [slug, tid])).rowCount > 0;
}
/** The first free address like the one asked for: name, name-2, name-3… */
async function freeSlug(c, slug, tid) {
  const base = slug.slice(0, 36).replace(/-+$/, '');
  for (let n = 2; n < 500; n++) { const cand = base + '-' + n; if (!(await slugTaken(c, cand, tid))) return cand; }
  return base + '-' + crypto.randomBytes(2).toString('hex');
}
app.get('/api/menu-address', auth, wrap(async (req, res) => {
  const slug = KC.shopSlugify(req.query.slug || '');
  const bad = KC.shopSlugError(slug);
  if (bad) return res.json({ slug, available: false, reason: bad.replace('your shop', 'your menu') });
  const taken = await menuSlugTaken(pool, slug, req.user.tenant_id);
  res.json({ slug, available: !taken, reason: taken ? 'Already used by another venue' : '', suggestion: taken ? await freeMenuSlug(pool, slug, req.user.tenant_id) : '' });
}));
app.get('/api/shop-address', auth, wrap(async (req, res) => {
  const slug = KC.shopSlugify(req.query.slug || '');
  const bad = KC.shopSlugError(slug);
  if (bad) return res.json({ slug, available: false, reason: bad });
  const taken = await slugTaken(pool, slug, req.user.tenant_id);
  res.json({ slug, available: !taken, reason: taken ? 'Already used by another shop' : '', suggestion: taken ? await freeSlug(pool, slug, req.user.tenant_id) : '' });
}));
const shopReadLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
const shopOrderLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: Number(process.env.SHOP_ORDERS_PER_10MIN || 15), standardHeaders: true, legacyHeaders: false, message: { error: 'Too many orders from this connection — please wait a few minutes' } });
async function shopTenant(key) {
  if (!SHOP_KEY_RE.test(String(key || ''))) return null;
  const r = await q("SELECT d.tenant_id, d.data FROM documents d JOIN tenants t ON t.id=d.tenant_id WHERE d.collection='settings' AND d.id='main' AND (lower(d.data->>'shopSlug')=lower($1) OR d.data->>'shopId'=$1) AND (d.data->>'shopEnabled')::boolean IS TRUE AND t.status <> 'suspended' LIMIT 1", [key]);
  if (!r.rows[0] || !KC.featureOn((await billing.limitsFor(pool, r.rows[0].tenant_id)).features, 'onlineShop')) return null; // not in the plan → the shop is closed
  return { tid: r.rows[0].tenant_id, settings: Object.assign({}, KC.DEFAULT_SETTINGS, r.rows[0].data) };
}
app.get('/api/shop/:key', shopReadLimiter, wrap(async (req, res) => {
  const t = await shopTenant(req.params.key); if (!t) return err(res, 404, 'This shop is not available');
  const raw = await loadAll(pool, t.tid); const C = KC.computeAll(raw); const st = t.settings;
  res.set('Cache-Control', 'no-store').json({
    business: { name: st.businessName, tagline: st.tagline || '', phone: st.phone || '', whatsapp: st.whatsapp || st.phone || '', address: st.address || '', logo: st.logo || '', currency: st.currency || 'XAF', symbol: KC.currencySymbolOf(st), message: st.shopMessage || '' },
    delivery: { modes: KC.DELIVERY_MODES, agencies: Array.isArray(st.shopAgencies) ? st.shopAgencies.slice(0, 30) : [] },
    items: KC.shopCatalog(raw, C).map(KC.publicItem),
  });
}));
app.post('/api/shop/:key/orders', shopOrderLimiter, wrap(async (req, res) => {
  const t = await shopTenant(req.params.key); if (!t) return err(res, 404, 'This shop is not available');
  const raw = await loadAll(pool, t.tid); const r = KC.validateShopOrder(req.body, KC.shopCatalog(raw, KC.computeAll(raw)));
  if (r.error) return err(res, 400, r.error);
  const d = new Date(); const id = 'o_' + crypto.randomBytes(9).toString('hex');
  const no = 'W' + String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
  const order = Object.assign({ no, status: 'new', source: 'shop', createdAt: d.toISOString(), updatedAt: d.toISOString() }, r.order);
  await tx(async (c) => {
    await c.query('INSERT INTO documents(tenant_id,collection,id,data) VALUES ($1,$2,$3,$4)', [t.tid, 'orders', id, JSON.stringify(order)]);
    // the audit row is what makes staff screens refresh (live stream) and shows in the activity log
    await c.query("INSERT INTO audit_log(tenant_id,user_name,location_id,action,collection,doc_id,after) VALUES ($1,'Online shop','main','create','orders',$2,$3)", [t.tid, id, JSON.stringify(order)]);
  });
  broadcast(t.tid, 'orders', id);
  const st = t.settings;
  if (st.emailOrders !== false) { // tell the owner and admins (each once per order)
    const staff = (await q("SELECT * FROM users WHERE tenant_id=$1 AND active AND role IN ('owner','admin')", [t.tid])).rows;
    const mail = mailer.T.newOrder({ business: st.businessName, order, url: mailer.appUrl(req), sym: KC.currencySymbolOf(st) });
    await Promise.all(staff.map((u) => mailer.emailOf(u) && mailer.sendEmail(Object.assign({ to: mailer.emailOf(u), kind: 'new_order', tenantId: t.tid, dedupe: 'order:' + id + ':' + u.id }, mail))));
  }
  res.json({ ok: true, no, total: order.subtotal, whatsapp: st.whatsapp || st.phone || '', business: st.businessName });
}));
/* ---------- Aahsso Bar & Resto: the QR menu at each table ----------
 * /t/<menuKey>/<tableToken> opens the menu with the table known; /m/<menuKey> is the venue's public menu, where the customer
 * picks their table (settings.pickTable, on by default) — or only browses when that is off.
 * Orders need the plan's QR ordering, the owner's switch (settings.qrOn) and a real table token. Prices come from the server. */
/* MENU_KEY_RE: the menu address (sky-lounge) or the venue key (hex) */
const MENU_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,59}$/; const TABLE_TOKEN_RE = /^[A-Za-z0-9]{6,32}$/;
const menuReadLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false });
const menuOrderLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: Number(process.env.MENU_ORDERS_PER_10MIN || 30), standardHeaders: true, legacyHeaders: false, message: { error: 'Too many orders from this phone — please ask your waiter' } });
const menuCallLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Please wait a moment — your waiter is on the way' } });
async function menuTenant(key) {
  if (!MENU_KEY_RE.test(String(key || ''))) return null;
  const r = (await q("SELECT d.tenant_id, d.data FROM documents d JOIN tenants t ON t.id=d.tenant_id WHERE d.collection='settings' AND d.id='main' AND (d.data->>'menuKey'=$1 OR lower(d.data->>'menuSlug')=lower($1) OR (d.data->'menuSlugsOld') ? lower($1)) AND t.edition='resto' ORDER BY (lower(d.data->>'menuSlug')=lower($1)) DESC LIMIT 1", [key])).rows[0];
  if (!r) return null; const ent = await billing.limitsFor(pool, r.tenant_id);
  if (!KC.anyOn(ent.features, ['tables', 'qrOrders', 'payFirst'])) return null; // no menu in the plan
  return { tid: r.tenant_id, settings: Object.assign({}, KC.DEFAULT_SETTINGS, r.data), features: ent.features };
}
async function loadCols(c, tid, cols) {
  const out = {}; cols.forEach((k) => (out[k] = []));
  (await c.query('SELECT collection, id, data FROM documents WHERE tenant_id=$1 AND collection = ANY($2)', [tid, cols])).rows.forEach((x) => out[x.collection].push(Object.assign({}, x.data, { id: x.id })));
  return out;
}
/** the live menu: prices now (happy hour), sold out by hand or by stock */
async function liveMenu(t) {
  const raw = await loadAll(pool, t.tid); const C = KC.computeAll(raw); const st = t.settings; const R = await loadCols(pool, t.tid, ['menu', 'tables', 'areas']);
  const hh = KC.featureOn(t.features, 'happyHour'); const now = new Date(); const vt = st.venueType || 'both';
  const items = R.menu.filter((m) => m.active !== false && m.name).map((m) => ({ id: m.id, name: m.name, category: m.category || 'Other', desc: m.desc || '', photo: m.photo || '', price: Number(m.price) || 0,
    priceNow: KC.menuPrice(m, st, now, hh), station: KC.stationOf(m, vt), soldOut: !!m.soldOut || KC.menuUnits(C, m, 'main') < 1, sort: Number(m.sort) || 0 }))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  return { st, items, tables: R.tables.filter((x) => !x.archived), areas: R.areas, hhOn: hh && KC.hhActive(st, now) };
}
const TABLE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const menuOrdersOn = (t) => t.settings.qrOn !== false && KC.featureOn(t.features, 'qrOrders');
/** customers may pick their table on the public menu link (/m/<key>) — the waiter still accepts each order */
const menuPickOn = (t) => menuOrdersOn(t) && t.settings.pickTable !== false;
/** the table: from its QR code (token), or picked from the list on the menu link (id) */
const menuTable = (tables, t, q) => {
  const live = tables.filter((x) => !x.archived); const token = String((q || {}).t || ''); const id = String((q || {}).table || '');
  if (TABLE_TOKEN_RE.test(token)) { const hit = live.find((x) => x.token === token); if (hit) return hit; }
  if (id && TABLE_ID_RE.test(id) && menuPickOn(t)) return live.find((x) => x.id === id) || null;
  return null;
};
async function putDoc(c, tid, col, id, data, who) {
  await c.query('INSERT INTO documents(tenant_id,collection,id,data) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,collection,id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()', [tid, col, id, JSON.stringify(data)]);
  await c.query("INSERT INTO audit_log(tenant_id,user_name,location_id,action,collection,doc_id,after) VALUES ($1,$2,'main','update',$3,$4,$5)", [tid, who, col, id, JSON.stringify(data)]);
}
app.get('/api/menu/:key', menuReadLimiter, wrap(async (req, res) => {
  const t = await menuTenant(req.params.key); if (!t) return err(res, 404, 'This menu is not available');
  const L = await liveMenu(t); const st = L.st; const table = menuTable(L.tables, t, req.query); const area = table && L.areas.find((a) => a.id === table.areaId);
  const cats = (st.menuCats || []).filter((c) => L.items.some((i) => i.category === c)).concat([...new Set(L.items.map((i) => i.category))].filter((c) => !(st.menuCats || []).includes(c)));
  res.set('Cache-Control', 'no-store').json({
    business: { name: st.businessName, tagline: st.tagline || '', logo: st.logo || '', symbol: KC.currencySymbolOf(st), venueType: st.venueType || 'both', phone: st.whatsapp || st.phone || '' },
    table: table ? { label: table.label, area: area ? area.name : '' } : null,
    canOrder: menuOrdersOn(t) && (!!table || menuPickOn(t)),
    tables: !req.query.t && menuPickOn(t) ? L.tables.slice().sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true })).map((x) => { const a = L.areas.find((y) => y.id === x.areaId); return { id: x.id, label: x.label, area: a ? a.name : '' }; }) : [],
    happyHour: L.hhOn ? { pct: Number(st.happyHour.pct) || 0, to: st.happyHour.to || '' } : null,
    cats, items: L.items.map((i) => ({ id: i.id, name: i.name, category: i.category, desc: i.desc, photo: i.photo, price: i.price, priceNow: i.priceNow, soldOut: i.soldOut })) });
}));
app.post('/api/menu/:key/orders', menuOrderLimiter, wrap(async (req, res) => {
  const t = await menuTenant(req.params.key); if (!t) return err(res, 404, 'This menu is not available');
  if (!menuOrdersOn(t)) return err(res, 403, 'Ordering from the menu is off — please call your waiter');
  const L = await liveMenu(t); const table = menuTable(L.tables, t, req.body); if (!table) return err(res, 400, menuPickOn(t) ? 'Choose your table to order' : 'Scan the QR code on your table to order');
  const r = KC.validateMenuOrder(req.body, L.items, L.st); if (r.error) return err(res, 400, r.error);
  const device = String((req.body || {}).device || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
  const area = L.areas.find((a) => a.id === table.areaId) || {};
  const waiters = table.waiterId ? [table.waiterId] : (area.waiterIds || []);
  const now = new Date().toISOString(); let tabId, orderId = 'ro_' + crypto.randomBytes(8).toString('hex'); const no = String(Math.floor(100 + Math.random() * 900));
  await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [t.tid + ':' + table.id]); // two phones at one table: one tab
    const open = (await c.query("SELECT id, data FROM documents WHERE tenant_id=$1 AND collection='tabs' AND data->>'tableId'=$2 AND data->>'status'='open' LIMIT 1", [t.tid, table.id])).rows[0];
    if (open) tabId = open.id;
    else { tabId = 'tb_' + crypto.randomBytes(8).toString('hex'); await putDoc(c, t.tid, 'tabs', tabId, { tableId: table.id, tableLabel: table.label, status: 'open', openedAt: now, customerName: r.name, waiterId: waiters.length === 1 ? waiters[0] : '', source: 'qr' }, 'QR menu'); }
    await putDoc(c, t.tid, 'rorders', orderId, { no, tabId, tableId: table.id, tableLabel: table.label, areaId: table.areaId || '', source: 'qr', customerName: r.name, note: r.note, device, waiterIds: waiters, waiterId: waiters.length === 1 ? waiters[0] : '', status: 'new', lines: r.lines, createdAt: now }, 'QR menu · ' + r.name);
  });
  broadcast(t.tid, 'tabs', tabId); broadcast(t.tid, 'rorders', orderId);
  res.json({ ok: true, no, orderId, total: r.lines.reduce((a, l) => a + l.qty * l.price, 0) });
}));
/** what this phone ordered at this table, and the bill so far */
app.get('/api/menu/:key/status', menuReadLimiter, wrap(async (req, res) => {
  const t = await menuTenant(req.params.key); if (!t) return err(res, 404, 'This menu is not available');
  const R = await loadCols(pool, t.tid, ['tables', 'tabs', 'rorders']); const table = menuTable(R.tables, t, req.query);
  if (!table) return res.json({ orders: [], total: 0 });
  const tab = R.tabs.find((x) => x.tableId === table.id && x.status === 'open'); const device = String(req.query.d || '');
  const mine = tab ? R.rorders.filter((o) => o.tabId === tab.id && device && o.device === device).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) : [];
  const total = tab ? KC.tabLines(tab, R.rorders).reduce((a, l) => a + l.qty * l.price, 0) : 0;
  res.set('Cache-Control', 'no-store').json({ orders: mine.map((o) => ({ no: o.no, status: o.status, reason: o.rejectReason || '', at: o.createdAt, lines: (o.lines || []).map((l) => ({ name: l.name, qty: l.qty })) })), total, billAsked: !!(tab && tab.billAskedAt), open: !!tab });
}));
app.post('/api/menu/:key/call', menuCallLimiter, wrap(async (req, res) => {
  const t = await menuTenant(req.params.key); if (!t) return err(res, 404, 'This menu is not available');
  const R = await loadCols(pool, t.tid, ['tables', 'tabs']); const b = req.body || {}; const table = menuTable(R.tables, t, b);
  if (!table) return err(res, 400, menuPickOn(t) ? 'Choose your table first' : 'Scan the QR code on your table');
  const kind = b.kind === 'bill' ? 'bill' : 'waiter'; const now = new Date().toISOString();
  const ring = Math.max(0, Math.min(8000, Math.round(Number(b.ring) || 0))); // how long the customer held the bell (ms): staff hear it as long
  await tx(async (c) => {
    await putDoc(c, t.tid, 'tables', table.id, Object.assign({}, table, { id: undefined, call: { kind, at: now, name: String(b.name || '').slice(0, 60), ring } }), 'QR menu');
    const tab = R.tabs.find((x) => x.tableId === table.id && x.status === 'open'); if (tab && kind === 'bill') await putDoc(c, t.tid, 'tabs', tab.id, Object.assign({}, tab, { id: undefined, billAskedAt: now }), 'QR menu');
  });
  broadcast(t.tid, 'tables', table.id); broadcast(t.tid, 'tabs', '');
  res.json({ ok: true });
}));
app.get('/t/:key/:token', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'menu.html')));
app.get('/m/:key', wrap(async (req, res) => {
  // the old /m/<key> link and differently-cased addresses go to the menu's current address
  const t = MENU_KEY_RE.test(req.params.key) ? await menuTenant(req.params.key) : null; const slug = t && t.settings.menuSlug;
  if (slug && slug !== req.params.key) return res.redirect(301, '/m/' + encodeURIComponent(slug) + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
  res.sendFile(path.join(__dirname, '..', 'public', 'menu.html'));
}));

// pretty shop link: /s/<key>
app.get('/s/:key', wrap(async (req, res) => {
  // old links (random key) and differently-cased addresses go to the shop's current address
  const t = SHOP_KEY_RE.test(req.params.key) ? await shopTenant(req.params.key) : null;
  const slug = t && t.settings.shopSlug;
  if (slug && slug !== req.params.key) return res.redirect(301, '/s/' + encodeURIComponent(slug) + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
  res.sendFile(path.join(__dirname, '..', 'public', 'shop.html'));
}));

/* ---------- frontend ---------- */
app.get('/healthz', (req, res) => res.json({ ok: true }));
// App code (html/js/css) must never be served stale after an update: browsers revalidate every time
// (a cheap 304 when unchanged). Icons/images can still be cached for an hour.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  setHeaders: (res, file) => { if (/\.(html|js|css|json)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); },
}));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((e, req, res, next) => {
  // body-parser errors are the client's fault: say so instead of a 500
  if (e && e.type === 'entity.too.large') return err(res, 413, 'Request too large');
  if (e && e.type === 'entity.parse.failed') return err(res, 400, 'Invalid JSON');
  console.error(e); err(res, 500, 'Server error');
});
if (require.main === module) ensureSchema().catch((e) => console.error('[migrate] at startup:', e.message));
if (require.main === module) { app.listen(PORT, () => console.log('Aahsso running on http://localhost:' + PORT)); reminders.startScheduler(); startEmailScheduler(); momo.startSweeper(); }
/** Daily emails (trial ending) without an external cron: checked every hour, each email goes out once (dedupe). */
function startEmailScheduler() {
  if (process.env.EMAILS_SCHEDULER_DISABLED === 'true') return;
  const tick = () => dailyEmails().catch((e) => console.error('[email] daily job error', e.message));
  setInterval(tick, 60 * 60 * 1000); setTimeout(tick, 30000);
}
module.exports = { app, importBackup };
