/* Kargo SaaS API + static frontend.
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

const COLLECTIONS = ['settings', 'products', 'lots', 'shipments', 'customers', 'sales', 'adjustments', 'expenses', 'locations', 'transfers', 'handovers', 'suppliers', 'bills', 'reminders', 'audits', 'assets', 'orders', 'promos', 'staff', 'attendance', 'leaves', 'payroll', 'tills'];
// Which permissions allow writing each collection (any one of them). Permission model lives in compute.js.
const WRITE_PERMS = {
  settings: ['settings'], products: ['stockEdit', 'purchases'], lots: ['purchases', 'containers'], shipments: ['containers'],
  adjustments: ['stockEdit'], expenses: ['expenses'], customers: ['customers', 'sell'], sales: ['sell', 'payments', 'returns', 'cancel'],
  locations: ['settings'], transfers: ['transfers'], handovers: ['payments', 'handover'], suppliers: ['suppliers', 'purchases', 'containers'],
  bills: ['suppliers', 'purchases', 'containers', 'assets'], reminders: ['reminders'], audits: ['audit', 'stockEdit'], assets: ['assets'],
  orders: ['sell', 'payments'], // online-shop orders: staff confirm / reject them
  promos: ['stockEdit'], // promotions: whoever sets prices
  staff: ['hr', 'payroll'], payroll: ['payroll'], tills: ['payments', 'handover'],
  attendance: null, leaves: null, // everyone clocks in and asks for leave for themselves (checked below)
};
const DELETE_PERMS = { products: ['stockEdit'], lots: ['purchases'], shipments: ['containers'], adjustments: ['stockEdit'], expenses: ['expenses'], customers: ['customers'], bills: ['suppliers'], suppliers: ['suppliers'], assets: ['assets'], orders: ['cancel'], promos: ['stockEdit'], staff: ['hr'], attendance: ['hr'], leaves: ['hr'], payroll: ['payroll'] };
const grp = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); // 25,000
const perms = (u) => KC.permsFor({ role: u.role, perms: u.perms || {} }, u.customRoles);
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
app.use(express.json({ limit: '25mb' }));
app.use('/api', (req, res, next) => ensureSchema().then(() => next(), (e) => { console.error('[migrate]', e.message); err(res, 503, 'The server is updating its database. Please try again in a moment.'); }));

const err = (res, status, error, extra) => res.status(status).json(Object.assign({ error }, extra || {}));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sign = (u) => jwt.sign({ uid: u.id, tid: u.tenant_id, role: u.role }, SECRET, { expiresIn: '30d' });

/* ---------- auth ---------- */
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: Number(process.env.API_RATE_PER_MIN || 1200), standardHeaders: true, legacyHeaders: false }));

app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  const { businessName, name, login, password, email } = req.body || {};
  if (!businessName || !name || !login || !password) return err(res, 400, 'Business name, your name, login and password are required');
  if (String(password).length < 6) return err(res, 400, 'Password must be at least 6 characters');
  const l = String(login).trim().toLowerCase();
  if ((await q('SELECT 1 FROM users WHERE login=$1', [l])).rowCount) return err(res, 409, 'This login is already registered');
  const days = Number(process.env.TRIAL_DAYS || 30);
  const user = await tx(async (c) => {
    const t = (await c.query("INSERT INTO tenants(name, trial_ends_at) VALUES ($1, now() + ($2 || ' days')::interval) RETURNING id", [businessName, String(days)])).rows[0];
    const u = (await c.query("INSERT INTO users(tenant_id,name,login,password_hash,role,email) VALUES ($1,$2,$3,$4,'owner',$5) RETURNING *", [t.id, name, l, await bcrypt.hash(String(password), 10), cleanEmail(email)])).rows[0];
    await c.query("INSERT INTO documents(tenant_id,collection,id,data,updated_by) VALUES ($1,'settings','main',$2,$3)", [t.id, JSON.stringify(Object.assign({}, KC.DEFAULT_SETTINGS, { businessName })), u.id]);
    await c.query("INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action) VALUES ($1,$2,$3,'main','register')", [t.id, u.id, name]);
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
  const u = (await q('SELECT * FROM users WHERE active AND (login=$1 OR lower(email)=$1) ORDER BY created_at LIMIT 1', [l])).rows[0];
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
    const u = (await q('SELECT u.id,u.tenant_id,u.name,u.login,u.email,u.role,u.perms,u.location_id,u.active,t.name AS tenant_name,t.plan,t.status,t.trial_ends_at,t.paid_until FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=$1', [p.uid])).rows[0];
    if (!u || !u.active) return err(res, 401, 'Session expired');
    const st = (await q("SELECT data->'roles' AS roles FROM documents WHERE tenant_id=$1 AND collection='settings' AND id='main'", [u.tenant_id])).rows[0];
    u.customRoles = (st && st.roles) || {};
    req.user = u; next();
  } catch (e) { console.error('[auth]', e.message); return err(res, 500, 'Server error — please try again'); } // e.g. database down: keep the session
}
// Subscription gate: reading stays allowed so a business can always export its data.
function subscriptionOk(u) {
  if (u.status === 'suspended') return false;
  const now = Date.now();
  if (u.plan === 'trial') return !u.trial_ends_at || new Date(u.trial_ends_at).getTime() > now;
  return !u.paid_until || new Date(u.paid_until).getTime() > now - 7 * 864e5; // 7-day grace
}
const requireActive = (req, res, next) => subscriptionOk(req.user) ? next() : err(res, 402, 'Subscription inactive — renew to keep recording. You can still view and export your data.', { code: 'subscription' });
const requireRole = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : err(res, 403, 'Not allowed for your role');
const requirePerm = (p) => (req, res, next) => canU(req.user, p) ? next() : err(res, 403, 'You do not have permission for this');

app.post('/api/me/password', auth, authLimiter, wrap(async (req, res) => {
  const { current, password } = req.body || {};
  if (!password || String(password).length < 6) return err(res, 400, 'New password must be at least 6 characters');
  const row = (await q('SELECT password_hash FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (!(await bcrypt.compare(String(current || ''), row.password_hash))) return err(res, 400, 'Current password is wrong', { code: 'bad_password' });
  await q('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(String(password), 10), req.user.id]);
  const to = mailer.emailOf(req.user);
  if (to) await mailer.sendEmail(Object.assign({ to, kind: 'password_changed', tenantId: req.user.tenant_id }, mailer.T.passwordChanged({ name: req.user.name, business: await businessName(req.user.tenant_id, req.user.tenant_name), url: mailer.appUrl(req), when: new Date().toUTCString() })));
  res.json({ ok: true });
}));
/* own email address (notifications, password reset) */
app.patch('/api/me', auth, wrap(async (req, res) => {
  const { email } = req.body || {};
  if (email !== undefined && email !== '' && email !== null && !mailer.isEmail(email)) return err(res, 400, 'Type a valid email address');
  await q('UPDATE users SET email=$1 WHERE id=$2', [cleanEmail(email), req.user.id]);
  res.json({ ok: true, email: cleanEmail(email) });
}));
app.get('/api/email/status', auth, (req, res) => res.json({ enabled: mailer.enabled(), from: mailer.enabled() ? mailer.FROM() : '' }));
app.get('/api/me', auth, (req, res) => {
  const u = req.user;
  res.json({ user: { id: u.id, name: u.name, login: u.login, email: u.email || '', emailTo: mailer.emailOf(u) || '', role: u.role, perms: u.perms || {}, locationId: u.location_id || 'main', effective: perms(u) }, tenant: { id: u.tenant_id, name: u.tenant_name, plan: u.plan, status: u.status, trialEndsAt: u.trial_ends_at, paidUntil: u.paid_until, active: subscriptionOk(u) }, emailEnabled: mailer.enabled() });
});

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
    docs = docs.map((d) => d.createdById === u.id ? d : { id: d.id, _hidden: true, status: d.status, date: d.date, createdById: d.createdById,
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
  res.json({ docs });
}));

async function loadAllSales(c, tid) {
  const r = await c.query("SELECT collection, id, data FROM documents WHERE tenant_id=$1 AND collection IN ('sales','tills')", [tid]);
  const out = { sales: [], tills: [] }; r.rows.forEach((x) => out[x.collection].push(Object.assign({}, x.data, { id: x.id }))); return out;
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
  let receiving = false;
  if (WRITE_PERMS[col] !== null && !anyU(u, WRITE_PERMS[col])) {
    // a branch may receive a transfer addressed to it without the full "move stock" permission
    if (col === 'transfers' && req.body && req.body.status === 'received') { const pr = (await q("SELECT data FROM documents WHERE tenant_id=$1 AND collection='transfers' AND id=$2", [u.tenant_id, id])).rows[0]; receiving = !!(pr && pr.data.status === 'in_transit' && pr.data.to === (u.location_id || 'main')); }
    if (!receiving) return err(res, 403, 'You do not have permission to change ' + col);
  }
  if (!ID_RE.test(id)) return err(res, 400, 'Invalid id');
  const body = req.body; if (!body || typeof body !== 'object' || Array.isArray(body)) return err(res, 400, 'Body must be an object');
  delete body.id;

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
    if (col === 'audits' && body.status === 'applied' && !P.stockEdit) return { status: 403, error: 'Only a manager can approve a stock count' };
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
      if (old && old.status !== 'cancelled' && body.status === 'cancelled' && !P.cancel) return { status: 403, error: 'You cannot cancel sales' };
      const oldPays = new Set(((old && old.payments) || []).map((p) => p.id)), newPays = (body.payments || []);
      if (old && (old.payments || []).some((p) => !newPays.find((n) => n.id === p.id)) && !P.cancel) return { status: 403, error: 'You cannot remove payments' };
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
      if (old && oldRet !== newRet && !P.returns) return { status: 403, error: 'You cannot process returns' };
      const linesChanged = !old || JSON.stringify((old.lines || []).map((l) => [l.productId, l.qty, l.unitPrice])) !== JSON.stringify((body.lines || []).map((l) => [l.productId, l.qty, l.unitPrice]));
      if (linesChanged && !P.sell) return { status: 403, error: 'You cannot change sale items' };
      if (!P.discount) {
        if (Number(body.discount || 0) > Number((old && old.discount) || 0)) return { status: 403, error: 'You cannot give discounts' };
        const C0 = KC.computeAll(raw);
        const cust = body.customerId ? ((await c.query("SELECT data FROM documents WHERE tenant_id=$1 AND collection='customers' AND id=$2", [u.tenant_id, body.customerId])).rows[0] || {}).data : null;
        for (const l of body.lines || []) {
          const before = old && (old.lines || []).find((o) => o.productId === l.productId);
          if (before && Number(before.unitPrice) === Number(l.unitPrice)) continue;
          if (C0.prodX[l.productId] && Number(l.unitPrice) < KC.priceFloor(C0, l.productId, l.qty, cust) - 0.5) return { status: 403, error: 'Price for ' + (l.name || 'an item') + ' is below the minimum' };
        }
      }
      const problems = KC.validateSale(raw, Object.assign({}, body, { id }));
      if (!problems.length && body.customerId && body.status !== 'cancelled' && !P.credit) {
        const cust = (await c.query("SELECT data FROM documents WHERE tenant_id=$1 AND collection='customers' AND id=$2", [u.tenant_id, body.customerId])).rows[0];
        const C1 = KC.computeAll(Object.assign({}, raw, { sales: raw.sales.filter((x) => x.id !== id).concat([Object.assign({}, body, { id })]) }));
        const lim = KC.creditLimitOf(C1.S, cust && cust.data);
        const owed = KC.customerBalance(Object.assign({}, raw, { sales: raw.sales.filter((x) => x.id !== id).concat([Object.assign({}, body, { id })]) }), C1, body.customerId);
        const before = KC.customerBalance(raw, KC.computeAll(raw), body.customerId);
        if (lim !== null && owed > lim + 0.5 && owed > before + 0.5) return { status: 403, error: 'Credit limit exceeded (' + grp(owed) + ' > ' + grp(lim) + ' F). A manager must approve.' };
      }
      if (problems.length) return { status: 409, error: 'Not enough stock', details: problems };
    }
    await c.query(`INSERT INTO documents(tenant_id,collection,id,data,updated_by,updated_at) VALUES ($1,$2,$3,$4,$5,now())
                   ON CONFLICT (tenant_id,collection,id) DO UPDATE SET data=EXCLUDED.data, updated_by=EXCLUDED.updated_by, updated_at=now()`, [u.tenant_id, col, id, JSON.stringify(body), u.id]);
    await c.query('INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action,collection,doc_id,before,after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [u.tenant_id, u.id, u.name, body.locationId || body.to || u.location_id || 'main', prev ? 'update' : 'create', col, id, prev ? JSON.stringify(prev.data) : null, JSON.stringify(body)]);
    return { ok: true };
  }); } catch (e) { if (e.code === '23505' && col === 'settings') return err(res, 409, 'This shop address was just taken by another shop. Choose another.'); throw e; }
  if (result.error) return err(res, result.status, result.error, result.details ? { details: result.details } : undefined);
  broadcast(u.tenant_id, col, id);
  res.json({ ok: true });
}));

app.delete('/api/data/:col/:id', auth, colOk, requireActive, wrap(async (req, res) => {
  const { col, id } = req.params; const u = req.user;
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
app.get('/api/export', auth, requirePerm('export'), wrap(async (req, res) => {
  const r = await q('SELECT collection, id, data FROM documents WHERE tenant_id=$1', [req.user.tenant_id]);
  const data = {}; COLLECTIONS.forEach((c) => (data[c] = []));
  r.rows.forEach((x) => data[x.collection] && data[x.collection].push(Object.assign({}, x.data, { id: x.id })));
  res.setHeader('Content-Disposition', 'attachment; filename="kargo-backup.json"');
  res.json({ app: 'kargo', version: 1, exportedAt: new Date().toISOString(), business: req.user.tenant_name, data });
}));
app.post('/api/import', auth, requireActive, requirePerm('settings'), wrap(async (req, res) => {
  const b = req.body; if (!b || b.app !== 'kargo' || !b.data) return err(res, 400, 'Not a Kargo backup file');
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
app.get('/api/team-names', auth, wrap(async (req, res) => {
  res.json({ people: (await q('SELECT id, name, role, location_id AS "locationId", active FROM users WHERE tenant_id=$1 ORDER BY name', [req.user.tenant_id])).rows });
}));
app.get('/api/users', auth, requirePerm('team'), wrap(async (req, res) => {
  res.json({ users: (await q('SELECT id,name,login,email,role,perms,location_id AS "locationId",active,created_at,last_login_at FROM users WHERE tenant_id=$1 ORDER BY created_at', [req.user.tenant_id])).rows });
}));
const ROLE_OK_BASE = ['admin', 'manager', 'sales', 'viewer'];
const roleOk = (u, r) => r !== 'owner' && (ROLE_OK_BASE.includes(r) || !!(u.customRoles && u.customRoles[r]));
const cleanPerms = (p) => { const o = {}; if (p && typeof p === 'object') KC.PERMS.forEach(([k]) => { if (k in p) o[k] = !!p[k]; }); return o; };
app.post('/api/users', auth, requireActive, requirePerm('team'), wrap(async (req, res) => {
  const { name, login, password, role, perms: pp, locationId, email, sendEmail } = req.body || {};
  if (!name || !login || !password || !roleOk(req.user, role)) return err(res, 400, 'name, login, password and role (admin|manager|sales|viewer) are required');
  if (email && !mailer.isEmail(email)) return err(res, 400, 'Type a valid email address (or leave it empty)');
  if (String(password).length < 6) return err(res, 400, 'Password must be at least 6 characters');
  if (role === 'admin' && req.user.role !== 'owner' && req.user.role !== 'admin') return err(res, 403, 'Only the owner or an admin can create admins');
  try {
    const u = (await q('INSERT INTO users(tenant_id,name,login,password_hash,role,perms,location_id,email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,login,email,role,perms,location_id', [req.user.tenant_id, name, String(login).trim().toLowerCase(), await bcrypt.hash(String(password), 10), role, JSON.stringify(cleanPerms(pp)), locationId || 'main', cleanEmail(email)])).rows[0];
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
  await q('UPDATE users SET role=COALESCE($1,role), active=COALESCE($2,active), name=COALESCE($3,name), password_hash=COALESCE($4,password_hash), perms=COALESCE($5,perms), location_id=COALESCE($6,location_id) WHERE id=$7',
    [target.role === 'owner' ? null : role || null, typeof active === 'boolean' && target.role !== 'owner' ? active : null, name || null, password ? await bcrypt.hash(String(password), 10) : null, pp && target.role !== 'owner' ? JSON.stringify(cleanPerms(pp)) : null, locationId || null, target.id]);
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
app.get('/api/activity', auth, wrap(async (req, res) => {
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
app.post('/api/sales/:id/email', auth, wrap(async (req, res) => {
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
app.post('/api/reminders/run', auth, requireActive, requirePerm('reminders'), wrap(async (req, res) => {
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
  return { trialEnding: sent };
}

/* ---------- product photos ---------- */
app.post('/api/images', auth, requireActive, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '4mb' }), wrap(async (req, res) => {
  if (!anyU(req.user, ['stockEdit', 'purchases'])) return err(res, 403, 'You do not have permission to add photos');
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
  return r.rows[0] ? { tid: r.rows[0].tenant_id, settings: Object.assign({}, KC.DEFAULT_SETTINGS, r.rows[0].data) } : null;
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
if (require.main === module) { app.listen(PORT, () => console.log('Kargo running on http://localhost:' + PORT)); reminders.startScheduler(); startEmailScheduler(); }
/** Daily emails (trial ending) without an external cron: checked every hour, each email goes out once (dedupe). */
function startEmailScheduler() {
  if (process.env.EMAILS_SCHEDULER_DISABLED === 'true') return;
  const tick = () => dailyEmails().catch((e) => console.error('[email] daily job error', e.message));
  setInterval(tick, 60 * 60 * 1000); setTimeout(tick, 30000);
}
module.exports = { app, importBackup };
