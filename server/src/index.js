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
const { q, tx, pool } = require('./db');
const KC = require('../public/compute.js'); // same business logic as the browser
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

const COLLECTIONS = ['settings', 'products', 'lots', 'shipments', 'customers', 'sales', 'adjustments', 'expenses', 'locations', 'transfers', 'handovers', 'suppliers', 'bills', 'reminders', 'audits', 'assets'];
// Which permissions allow writing each collection (any one of them). Permission model lives in compute.js.
const WRITE_PERMS = {
  settings: ['settings'], products: ['stockEdit', 'purchases'], lots: ['purchases', 'containers'], shipments: ['containers'],
  adjustments: ['stockEdit'], expenses: ['expenses'], customers: ['customers', 'sell'], sales: ['sell', 'payments', 'returns', 'cancel'],
  locations: ['settings'], transfers: ['transfers'], handovers: ['payments', 'handover'], suppliers: ['suppliers', 'purchases', 'containers'],
  bills: ['suppliers', 'purchases', 'containers', 'assets'], reminders: ['reminders'], audits: ['audit', 'stockEdit'], assets: ['assets'],
};
const DELETE_PERMS = { products: ['stockEdit'], lots: ['purchases'], shipments: ['containers'], adjustments: ['stockEdit'], expenses: ['expenses'], customers: ['customers'], bills: ['suppliers'], suppliers: ['suppliers'], assets: ['assets'] };
const perms = (u) => KC.permsFor({ role: u.role, perms: u.perms || {} }, u.customRoles);
// a client may propose a transaction id (offline-created records); otherwise the server makes one
const TXN_RE = /^[A-Za-z0-9][A-Za-z0-9\-]{3,39}$/;
async function tenantSettings(c, tid) {
  const r = (await c.query("SELECT data FROM documents WHERE tenant_id=$1 AND collection='settings' AND id='main'", [tid])).rows[0];
  return Object.assign({}, KC.DEFAULT_SETTINGS, (r && r.data) || {});
}
const canU = (u, p) => !!perms(u)[p];
const anyU = (u, list) => (list || []).some((p) => canU(u, p));
const ID_RE = /^[A-Za-z0-9_\-.:@+~]{1,120}$/;

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression({ filter: (req, res) => req.path !== '/api/stream' && compression.filter(req, res) })); // never buffer the live stream
const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (origins.length) app.use(cors({ origin: origins }));
app.use(express.json({ limit: '25mb' }));

const err = (res, status, error, extra) => res.status(status).json(Object.assign({ error }, extra || {}));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sign = (u) => jwt.sign({ uid: u.id, tid: u.tenant_id, role: u.role }, SECRET, { expiresIn: '30d' });

/* ---------- auth ---------- */
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: Number(process.env.API_RATE_PER_MIN || 1200), standardHeaders: true, legacyHeaders: false }));

app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  const { businessName, name, login, password } = req.body || {};
  if (!businessName || !name || !login || !password) return err(res, 400, 'Business name, your name, login and password are required');
  if (String(password).length < 6) return err(res, 400, 'Password must be at least 6 characters');
  const l = String(login).trim().toLowerCase();
  if ((await q('SELECT 1 FROM users WHERE login=$1', [l])).rowCount) return err(res, 409, 'This login is already registered');
  const days = Number(process.env.TRIAL_DAYS || 30);
  const user = await tx(async (c) => {
    const t = (await c.query("INSERT INTO tenants(name, trial_ends_at) VALUES ($1, now() + ($2 || ' days')::interval) RETURNING id", [businessName, String(days)])).rows[0];
    const u = (await c.query("INSERT INTO users(tenant_id,name,login,password_hash,role) VALUES ($1,$2,$3,$4,'owner') RETURNING *", [t.id, name, l, await bcrypt.hash(String(password), 10)])).rows[0];
    await c.query("INSERT INTO documents(tenant_id,collection,id,data,updated_by) VALUES ($1,'settings','main',$2,$3)", [t.id, JSON.stringify(Object.assign({}, KC.DEFAULT_SETTINGS, { businessName })), u.id]);
    await c.query("INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action) VALUES ($1,$2,$3,'main','register')", [t.id, u.id, name]);
    return u;
  });
  res.json({ token: sign(user) });
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
    const p = jwt.verify(token, SECRET);
    const u = (await q('SELECT u.id,u.tenant_id,u.name,u.login,u.role,u.perms,u.location_id,u.active,t.name AS tenant_name,t.plan,t.status,t.trial_ends_at,t.paid_until FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=$1', [p.uid])).rows[0];
    if (!u || !u.active) return err(res, 401, 'Session expired');
    const st = (await q("SELECT data->'roles' AS roles FROM documents WHERE tenant_id=$1 AND collection='settings' AND id='main'", [u.tenant_id])).rows[0];
    u.customRoles = (st && st.roles) || {};
    req.user = u; next();
  } catch (e) { return err(res, 401, 'Please sign in'); }
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
  res.json({ ok: true });
}));
app.get('/api/me', auth, (req, res) => {
  const u = req.user;
  res.json({ user: { id: u.id, name: u.name, login: u.login, role: u.role, perms: u.perms || {}, locationId: u.location_id || 'main', effective: perms(u) }, tenant: { id: u.tenant_id, name: u.tenant_name, plan: u.plan, status: u.status, trialEndsAt: u.trial_ends_at, paidUntil: u.paid_until, active: subscriptionOk(u) } });
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
    if (col === 'lots') docs = docs.map((d) => Object.assign({}, d, { unitCost: 0, regularPrice: null }));
    if (col === 'shipments') docs = docs.map((d) => Object.assign({}, d, { costs: [] }));
    if (col === 'products') {
      // Send selling prices already calculated, because this user cannot receive the costs they come from.
      const C = KC.computeAll(await loadAll(pool, u.tenant_id));
      docs = docs.map((d) => { const x = C.prodX[d.id] || {}; return Object.assign({}, d, { priceMax: x.priceMax || d.priceMax, priceMin: x.priceMin || d.priceMin, markup: null, minMarkup: null }); });
    }
    if (col === 'adjustments' || col === 'expenses') docs = col === 'expenses' && !P.expenses ? [] : docs;
  }
  if (col === 'expenses' && !P.expenses && !P.reports) docs = [];
  if ((col === 'bills' || col === 'suppliers') && !P.suppliers && !P.purchases && !P.containers && !P.assets) docs = [];
  if (col === 'handovers' && !P.handover) docs = docs.filter((d) => d.userId === u.id);
  if (col === 'assets' && !P.assets) docs = [];
  res.json({ docs });
}));

async function loadAllSales(c, tid) { const r = await c.query("SELECT id, data FROM documents WHERE tenant_id=$1 AND collection='sales'", [tid]); return { sales: r.rows.map((x) => Object.assign({}, x.data, { id: x.id })) }; }
async function loadAll(c, tid) {
  const r = await c.query("SELECT collection, id, data FROM documents WHERE tenant_id=$1 AND collection IN ('settings','products','lots','shipments','sales','adjustments','transfers')", [tid]);
  const raw = { settings: {}, products: [], lots: [], shipments: [], sales: [], adjustments: [], transfers: [] };
  r.rows.forEach((x) => { const d = Object.assign({}, x.data, { id: x.id }); if (x.collection === 'settings') { if (x.id === 'main') raw.settings = d; } else raw[x.collection].push(d); });
  return raw;
}

app.put('/api/data/:col/:id', auth, colOk, requireActive, wrap(async (req, res) => {
  const { col, id } = req.params; const u = req.user;
  let receiving = false;
  if (!anyU(u, WRITE_PERMS[col])) {
    // a branch may receive a transfer addressed to it without the full "move stock" permission
    if (col === 'transfers' && req.body && req.body.status === 'received') { const pr = (await q("SELECT data FROM documents WHERE tenant_id=$1 AND collection='transfers' AND id=$2", [u.tenant_id, id])).rows[0]; receiving = !!(pr && pr.data.status === 'in_transit' && pr.data.to === (u.location_id || 'main')); }
    if (!receiving) return err(res, 403, 'You do not have permission to change ' + col);
  }
  if (!ID_RE.test(id)) return err(res, 400, 'Invalid id');
  const body = req.body; if (!body || typeof body !== 'object' || Array.isArray(body)) return err(res, 400, 'Body must be an object');
  delete body.id;

  const result = await tx(async (c) => {
    // Serialize stock-affecting writes per tenant so two cashiers can't sell the same last item.
    if (['sales', 'adjustments', 'lots', 'shipments', 'transfers'].includes(col)) await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [u.tenant_id]);
    const prev = (await c.query('SELECT data FROM documents WHERE tenant_id=$1 AND collection=$2 AND id=$3 FOR UPDATE', [u.tenant_id, col, id])).rows[0];

    const P = perms(u);
    if (col === 'products' && !P.costs && prev) { body.priceMax = prev.data.priceMax ?? null; body.priceMin = prev.data.priceMin ?? null; body.markup = prev.data.markup ?? null; body.minMarkup = prev.data.minMarkup ?? null; }
    if (col === 'lots' && !P.costs && prev) { body.unitCost = prev.data.unitCost; body.regularPrice = prev.data.regularPrice; }
    if (col === 'shipments' && !P.costs && prev) body.costs = prev.data.costs || [];
    if (col === 'customers' && !P.credit && !P.settings) body.creditLimit = prev ? (prev.data.creditLimit ?? null) : null;
    if (col === 'handovers') {
      if (!P.handover) { if (body.userId !== u.id) return { status: 403, error: 'You can only submit your own handover' }; if (body.status === 'confirmed' || (prev && prev.data.status === 'confirmed')) return { status: 403, error: 'Only a manager can confirm a handover' }; }
      body.expectedTotal = KC.collectedBy(await loadAllSales(c, u.tenant_id), body.userId, body.date).total; // never trust the client's own total
    }
    if (col === 'audits' && body.status === 'applied' && !P.stockEdit) return { status: 403, error: 'Only a manager can approve a stock count' };
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
        if (lim !== null && owed > lim + 0.5 && owed > before + 0.5) return { status: 403, error: 'Credit limit exceeded (' + Math.round(owed) + ' > ' + Math.round(lim) + ' F). A manager must approve.' };
      }
      if (problems.length) return { status: 409, error: 'Not enough stock', details: problems };
    }
    await c.query(`INSERT INTO documents(tenant_id,collection,id,data,updated_by,updated_at) VALUES ($1,$2,$3,$4,$5,now())
                   ON CONFLICT (tenant_id,collection,id) DO UPDATE SET data=EXCLUDED.data, updated_by=EXCLUDED.updated_by, updated_at=now()`, [u.tenant_id, col, id, JSON.stringify(body), u.id]);
    await c.query('INSERT INTO audit_log(tenant_id,user_id,user_name,location_id,action,collection,doc_id,before,after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [u.tenant_id, u.id, u.name, body.locationId || body.to || u.location_id || 'main', prev ? 'update' : 'create', col, id, prev ? JSON.stringify(prev.data) : null, JSON.stringify(body)]);
    return { ok: true };
  });
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
app.get('/api/users', auth, requirePerm('team'), wrap(async (req, res) => {
  res.json({ users: (await q('SELECT id,name,login,role,perms,location_id AS "locationId",active,created_at,last_login_at FROM users WHERE tenant_id=$1 ORDER BY created_at', [req.user.tenant_id])).rows });
}));
const ROLE_OK_BASE = ['admin', 'manager', 'sales', 'viewer'];
const roleOk = (u, r) => r !== 'owner' && (ROLE_OK_BASE.includes(r) || !!(u.customRoles && u.customRoles[r]));
const cleanPerms = (p) => { const o = {}; if (p && typeof p === 'object') KC.PERMS.forEach(([k]) => { if (k in p) o[k] = !!p[k]; }); return o; };
app.post('/api/users', auth, requireActive, requirePerm('team'), wrap(async (req, res) => {
  const { name, login, password, role, perms: pp, locationId } = req.body || {};
  if (!name || !login || !password || !roleOk(req.user, role)) return err(res, 400, 'name, login, password and role (admin|manager|sales|viewer) are required');
  if (String(password).length < 6) return err(res, 400, 'Password must be at least 6 characters');
  if (role === 'admin' && req.user.role !== 'owner' && req.user.role !== 'admin') return err(res, 403, 'Only the owner or an admin can create admins');
  try {
    const u = (await q('INSERT INTO users(tenant_id,name,login,password_hash,role,perms,location_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,login,role,perms,location_id', [req.user.tenant_id, name, String(login).trim().toLowerCase(), await bcrypt.hash(String(password), 10), role, JSON.stringify(cleanPerms(pp)), locationId || 'main'])).rows[0];
    res.json({ user: u });
  } catch (e) { if (e.code === '23505') return err(res, 409, 'Login already in use'); throw e; }
}));
app.patch('/api/users/:id', auth, requirePerm('team'), wrap(async (req, res) => {
  const { role, active, password, name, perms: pp, locationId } = req.body || {};
  const target = (await q('SELECT * FROM users WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id])).rows[0];
  if (!target) return err(res, 404, 'User not found');
  if (target.role === 'owner' && req.user.role !== 'owner') return err(res, 403, 'Only the owner can change the owner');
  if (role && !roleOk(req.user, role)) return err(res, 400, 'Invalid role');
  if (target.id === req.user.id && (role || active === false || pp)) return err(res, 400, 'You cannot change your own role, permissions or disable yourself');
  if (role === 'admin' && !['owner', 'admin'].includes(req.user.role)) return err(res, 403, 'Only the owner or an admin can make someone an admin');
  if (target.role === 'admin' && !['owner', 'admin'].includes(req.user.role)) return err(res, 403, 'Only the owner or an admin can change an admin');
  await q('UPDATE users SET role=COALESCE($1,role), active=COALESCE($2,active), name=COALESCE($3,name), password_hash=COALESCE($4,password_hash), perms=COALESCE($5,perms), location_id=COALESCE($6,location_id) WHERE id=$7',
    [target.role === 'owner' ? null : role || null, typeof active === 'boolean' && target.role !== 'owner' ? active : null, name || null, password ? await bcrypt.hash(String(password), 10) : null, pp && target.role !== 'owner' ? JSON.stringify(cleanPerms(pp)) : null, locationId || null, target.id]);
  res.json({ ok: true });
}));
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
  const sym = S.currencySymbol || 'F'; const F = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ' + sym;
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
  res.json({ ok: true, businesses: done.length, done });
}));
app.get('/api/reminders/provider', auth, (req, res) => res.json({ provider: reminders.providerName() }));

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

/* ---------- frontend ---------- */
app.get('/healthz', (req, res) => res.json({ ok: true }));
// App code (html/js/css) must never be served stale after an update: browsers revalidate every time
// (a cheap 304 when unchanged). Icons/images can still be cached for an hour.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  setHeaders: (res, file) => { if (/\.(html|js|css|json)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); },
}));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((e, req, res, next) => { console.error(e); err(res, 500, 'Server error'); });
if (require.main === module) { app.listen(PORT, () => console.log('Kargo running on http://localhost:' + PORT)); reminders.startScheduler(); }
module.exports = { app, importBackup };
