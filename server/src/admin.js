/* Kargo platform admin (super admin). Security layers, outside in:
 *  1. Gate: served only on ADMIN_HOST (e.g. admin.example.com); optional IP allowlist (ADMIN_IP_ALLOWLIST) and
 *     Cloudflare Access check (CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD). Anything else gets a plain 404.
 *     In production (NODE_ENV=production) the admin is OFF unless ADMIN_HOST is set.
 *  2. Separate accounts (platform_admins). ONE Super Admin, created from the command line (node scripts/admin.js create …);
 *     every other admin is added by the Super Admin from the Security page.
 *  3. Password (+ authenticator code when ADMIN_REQUIRE_2FA=true — TODO: on by default later), lockout after 5 failures, email alerts.
 *  4. Server-side sessions in an httpOnly, Secure, SameSite=Strict __Host- cookie: 30 min idle, 8 h max, revocable.
 *  5. CSRF: custom header + Origin check on every change. Risky actions need the admin's 4-digit PIN again (5 min).
 *  6. Roles (super / admin / support / finance) and an append-only audit log of every action. */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const QR = require('qrcode');
const { q, tx, pool } = require('./db');
const totp = require('./totp');
const B = require('./billing');
const KC = require('../public/compute.js');
const mailer = require('./mailer');

const COOKIE = '__Host-kargo_adm';
// TODO(2FA): two-step sign-in (authenticator app + recovery codes) is switched OFF for now — admins sign in with
// email + password only, and risky actions ask for the password again. All the 2FA code below is kept;
// set ADMIN_REQUIRE_2FA=true to turn it back on (each admin then sets up their authenticator at the next sign-in).
const TWO_FA = () => process.env.ADMIN_REQUIRE_2FA === 'true';
const IDLE_MS = 30 * 60e3, MAX_MS = 8 * 3600e3, REAUTH_MS = 5 * 60e3, LOCK_AFTER = 5, LOCK_MIN = 15;
/* Admin permissions (granular). Roles are rows in admin_roles made of these; the Super Admin — not a role row — has them all
 * and is the only one who manages admins and roles ('admins.manage' is never part of a role). */
const ADMIN_PERMS = [
  ['overview.view', 'See the overview (revenue, sign-ups)', 'Dashboard'],
  ['tenants.view', 'See businesses and their details', 'Businesses'],
  ['subs.write', 'Change plans, extend trials and paid periods, cancel', 'Businesses'],
  ['tenants.features', 'Give a business its own features and limits', 'Businesses'],
  ['tenants.suspend', 'Suspend and reactivate businesses', 'Businesses'],
  ['tenants.impersonate', 'View a business as its owner (read-only)', 'Businesses'],
  ['tenants.resetOwner', 'Reset a business owner\'s password', 'Businesses'],
  ['billing', 'See invoices and payments', 'Billing'],
  ['billing.write', 'Create invoices, record and confirm payments', 'Billing'],
  ['billing.void', 'Void invoices', 'Billing'],
  ['plans.view', 'See plans and platform settings', 'Plans'],
  ['plans.write', 'Create and edit plans, prices and features', 'Plans'],
  ['settings.write', 'Change platform settings (payment details, trial, grace period)', 'Platform'],
  ['support', 'Read and answer support tickets', 'Platform'],
  ['health.view', 'See platform health', 'Platform'],
  ['audit.view', 'See the admin audit log', 'Platform'],
  ['export', 'Download CSV exports', 'Platform'],
];
const PERM_KEYS = ADMIN_PERMS.map((p) => p[0]);
/** a: the signed-in admin (with role_perms from admin_roles). The Super Admin can do everything. */
const can = (a, perm) => a.role === 'super' || (Array.isArray(a.role_perms) && a.role_perms.includes(perm));
const permsOf = (a) => (a.role === 'super' ? PERM_KEYS.concat(['admins.manage']) : (a.role_perms || []).filter((p) => PERM_KEYS.includes(p)));
const roleRow = async (id) => (await q('SELECT * FROM admin_roles WHERE id=$1', [id])).rows[0];
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const ADMIN_HOST = () => String(process.env.ADMIN_HOST || '').toLowerCase().trim();
const enabled = () => !!process.env.ADMIN_SECRET && process.env.ADMIN_SECRET.length >= 32 && !(process.env.NODE_ENV === 'production' && !ADMIN_HOST());
const isAdminPath = (p) => p === '/admin' || p.startsWith('/admin/') || p.startsWith('/api/admin/') || p === '/api/admin';
const notFound = (req, res) => (String(req.originalUrl || req.path).startsWith('/api/') ? res.status(404).json({ error: 'Not found' }) : res.status(404).type('text/plain').send('Not found'));
const clientIp = (req) => String(req.ip || '').replace(/^::ffff:/, '');

/* ---------- gate: host, IP allowlist, Cloudflare Access ---------- */
function ipAllowed(ip) {
  const list = String(process.env.ADMIN_IP_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return true;
  const toInt = (a) => a.split('.').reduce((n, o) => (n << 8) + (Number(o) & 255), 0) >>> 0;
  return list.some((rule) => {
    if (!rule.includes('/')) return rule === ip;
    const [base, bits] = rule.split('/'); if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(base)) return false;
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0; return (toInt(ip) & mask) === (toInt(base) & mask);
  });
}
let cfCerts = { at: 0, keys: {} };
async function cfAccessOk(req) {
  const team = process.env.CF_ACCESS_TEAM_DOMAIN, aud = process.env.CF_ACCESS_AUD;
  if (!team || !aud) return true; // not configured
  const token = req.get('cf-access-jwt-assertion'); if (!token) return false;
  try {
    if (Date.now() - cfCerts.at > 3600e3) {
      const r = await fetch('https://' + team + '/cdn-cgi/access/certs'); const j = await r.json(); const keys = {};
      (j.keys || []).forEach((k) => { keys[k.kid] = crypto.createPublicKey({ key: k, format: 'jwk' }).export({ type: 'spki', format: 'pem' }); });
      cfCerts = { at: Date.now(), keys };
    }
    const kid = (jwt.decode(token, { complete: true }) || {}).header?.kid; const pem = cfCerts.keys[kid]; if (!pem) return false;
    jwt.verify(token, pem, { algorithms: ['RS256'], audience: aud, issuer: 'https://' + team }); return true;
  } catch (e) { return false; }
}
/** Runs before everything else. On the admin host only the admin is served; elsewhere the admin does not exist. */
function gate(req, res, next) {
  const host = String(req.hostname || '').toLowerCase(); const AH = ADMIN_HOST(); const onAdminHost = AH && host === AH;
  if (onAdminHost && !isAdminPath(req.path)) {
    if (req.path === '/') return res.redirect(302, '/admin');
    if (req.path === '/robots.txt') return res.type('text/plain').send('User-agent: *\nDisallow: /\n');
    if (req.path === '/healthz') return next();
    return notFound(req, res); // the business app is not served on the admin host
  }
  if (!isAdminPath(req.path)) return next();
  if (!enabled() || (AH && !onAdminHost) || !ipAllowed(clientIp(req))) return notFound(req, res);
  cfAccessOk(req).then((ok) => (ok ? next() : notFound(req, res)), () => notFound(req, res));
}

/* ---------- headers on every admin response ---------- */
function headers(req, res, next) {
  res.set({
    'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  });
  next();
}

/* ---------- sessions ---------- */
const readCookie = (req) => { const m = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '=')); return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : ''; };
const setCookie = (res, v, maxAgeS) => res.append('Set-Cookie', COOKIE + '=' + v + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + maxAgeS);
async function newSession(req, res, adminId) {
  const tok = rand(32);
  await q('INSERT INTO admin_sessions (id, admin_id, expires_at, reauth_at, ip, user_agent) VALUES ($1,$2,$3,now(),$4,$5)', [sha(tok), adminId, new Date(Date.now() + MAX_MS), clientIp(req), String(req.get('user-agent') || '').slice(0, 300)]);
  setCookie(res, tok, MAX_MS / 1000);
}
async function auth(req, res, next) {
  const tok = readCookie(req); if (!tok) return notFound(req, res);
  const r = (await q(`SELECT s.id AS sid, s.reauth_at, s.last_seen_at, s.expires_at, s.revoked_at, a.*, ro.perms AS role_perms, ro.name AS role_name FROM admin_sessions s JOIN platform_admins a ON a.id = s.admin_id LEFT JOIN admin_roles ro ON ro.id = a.role WHERE s.id = $1`, [sha(tok)])).rows[0];
  const now = Date.now();
  if (!r || r.revoked_at || !r.active || new Date(r.expires_at).getTime() < now || now - new Date(r.last_seen_at).getTime() > IDLE_MS) { setCookie(res, '', 0); return notFound(req, res); }
  if (now - new Date(r.last_seen_at).getTime() > 60e3) q('UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1', [r.sid]).catch(() => { });
  req.admin = r; req.sid = r.sid;
  if (r.must_change_pw && !['/me', '/auth/password', '/auth/logout'].includes(req.path)) return res.status(403).json({ error: 'Choose a new password first', code: 'change_password' });
  if (!r.pin_hash && !TWO_FA() && !['/me', '/auth/password', '/auth/logout', '/auth/pin'].includes(req.path)) return res.status(403).json({ error: 'Create your 4-digit PIN first', code: 'set_pin' });
  next();
}
const need = (perm) => (req, res, next) => (can(req.admin, perm) ? next() : res.status(403).json({ error: 'Your admin role cannot do this' }));
const reauth = (req, res, next) => (req.admin.reauth_at && Date.now() - new Date(req.admin.reauth_at).getTime() < REAUTH_MS ? next() : res.status(403).json({ error: 'Confirm it is you', code: 'reauth' }));
function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-kargo-admin') !== '1') return res.status(403).json({ error: 'Blocked (missing request header)' });
  const origin = req.get('origin'); if (origin) { try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Blocked (wrong origin)' }); } catch (e) { return res.status(403).json({ error: 'Blocked' }); } }
  next();
}
async function audit(req, action, { tenantId, target, details, reason } = {}) {
  const a = req.admin || {};
  await q('INSERT INTO admin_audit (admin_id, admin_email, action, tenant_id, target, details, reason, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [a.id || null, a.email || (details && details.email) || null, action, tenantId || null, target || null, details ? JSON.stringify(details) : null, reason || null, clientIp(req), String(req.get('user-agent') || '').slice(0, 300)]);
}
/** 4 digits, and not an obvious one (0000, 1111, 1234, 4321…) */
function pinProblem(pin) {
  const p = String(pin || '');
  if (!/^\d{4}$/.test(p)) return 'The PIN must be exactly 4 digits';
  if (/^(\d)\1{3}$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p)) return 'Choose a PIN that is harder to guess (not 0000, 1111, 1234…)';
  return null;
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, status = 400, extra) => res.status(status).json(Object.assign({ error: msg }, extra || {}));
const needReason = (req, res) => { const r = String((req.body || {}).reason || '').trim(); if (r.length < 4) { bad(res, 'Give a reason (it is kept in the audit log)'); return null; } return r.slice(0, 300); };

/* ---------- login ---------- */
async function failed(req, a) {
  const n = (await q('UPDATE platform_admins SET failed_attempts = failed_attempts + 1 WHERE id=$1 RETURNING failed_attempts', [a.id])).rows[0].failed_attempts;
  if (n >= LOCK_AFTER) {
    await q("UPDATE platform_admins SET failed_attempts = 0, locked_until = now() + ($2 || ' minutes')::interval WHERE id=$1", [a.id, String(LOCK_MIN)]);
    await audit(Object.assign(req, { admin: null }), 'login_locked', { details: { email: a.email } });
    const mail = mailer.T.adminLocked({ name: a.name, email: a.email, ip: clientIp(req), minutes: LOCK_MIN });
    for (const to of new Set([a.email, process.env.ADMIN_ALERT_EMAIL].filter(Boolean))) await mailer.sendEmail(Object.assign({ to, kind: 'admin_locked' }, mail));
  }
}
const locked = (a) => a.locked_until && new Date(a.locked_until).getTime() > Date.now();
const DUMMY = '$2a$12$oFqdqXmCfOLI43kJYjgtzeGsHtq.GfACU2GAZTBMnWGMEsCeNtF0S'; // compared when the email is unknown, so timing is the same

module.exports = function mountAdmin(app, { tenantSecret }) {
  app.use(gate);
  const r = express.Router();
  r.use(['/admin', '/api/admin'], headers); // only admin responses get the strict headers
  const authLimiter = rateLimit({ windowMs: 15 * 60e3, max: Number(process.env.ADMIN_AUTH_RATE) || 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Wait a few minutes.' } });
  const apiLimiter = rateLimit({ windowMs: 60e3, max: 600, standardHeaders: true, legacyHeaders: false });
  r.use('/api/admin', apiLimiter, express.json({ limit: '200kb' }), csrf);

  /* the dashboard page itself */
  const dir = path.join(__dirname, '..', 'admin');
  r.get('/admin', (req, res) => res.sendFile(path.join(dir, 'index.html')));
  r.get('/admin/admin.js', (req, res) => res.type('application/javascript').sendFile(path.join(dir, 'admin.js')));
  r.get('/admin/admin.css', (req, res) => res.type('text/css').sendFile(path.join(dir, 'admin.css')));

  r.post('/api/admin/auth/login', authLimiter, wrap(async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase(); const pw = String((req.body || {}).password || '');
    const a = (await q('SELECT * FROM platform_admins WHERE email=$1', [email])).rows[0];
    if (a && locked(a)) return bad(res, 'Too many attempts. Try again in ' + LOCK_MIN + ' minutes.', 429);
    const ok = await bcrypt.compare(pw, a ? a.password_hash : DUMMY);
    if (!a || !a.active || !ok) { if (a) await failed(req, a); return bad(res, 'Wrong email or password', 401); }
    if (!TWO_FA()) { // TODO(2FA): password-only sign-in until two-step is turned back on
      const ua = String(req.get('user-agent') || '').slice(0, 300); const ip = clientIp(req);
      const seen = (await q('SELECT 1 FROM admin_sessions WHERE admin_id=$1 AND ip=$2 AND user_agent=$3 LIMIT 1', [a.id, ip, ua])).rowCount > 0;
      await q('UPDATE platform_admins SET failed_attempts=0, locked_until=NULL, last_login_at=now(), last_login_ip=$2 WHERE id=$1', [a.id, ip]);
      await newSession(req, res, a.id); req.admin = a; await audit(req, 'login');
      mailer.sendEmail(Object.assign({ to: a.email, kind: 'admin_login' }, mailer.T.adminLogin({ name: a.name, when: new Date().toUTCString(), ip, agent: ua, fresh: !seen }))).catch(() => { });
      return res.json({ next: 'done', mustChangePassword: a.must_change_pw });
    }
    const ticket = rand(32); const purpose = a.totp_enabled ? 'totp' : 'setup';
    await q("INSERT INTO admin_login_tickets (id, admin_id, purpose, expires_at) VALUES ($1,$2,$3, now() + interval '5 minutes')", [sha(ticket), a.id, purpose]);
    if (purpose === 'totp') return res.json({ next: 'totp', ticket });
    const secret = totp.newSecret(); await q('UPDATE platform_admins SET totp_secret=$2 WHERE id=$1', [a.id, totp.seal(secret)]);
    const url = totp.otpauthUrl(secret, a.email);
    res.json({ next: 'setup', ticket, secret: secret.replace(/(.{4})/g, '$1 ').trim(), otpauth: url, qr: await QR.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) });
  }));
  r.post('/api/admin/auth/verify', authLimiter, wrap(async (req, res) => {
    const { ticket, code, recoveryCode } = req.body || {};
    const t = (await q('SELECT * FROM admin_login_tickets WHERE id=$1 AND used_at IS NULL AND expires_at > now()', [sha(ticket || '')])).rows[0];
    if (!t) return bad(res, 'This sign-in expired. Start again.', 401);
    const a = (await q('SELECT * FROM platform_admins WHERE id=$1 AND active', [t.admin_id])).rows[0];
    if (!a) return bad(res, 'This sign-in expired. Start again.', 401);
    if (locked(a)) return bad(res, 'Too many attempts. Try again in ' + LOCK_MIN + ' minutes.', 429);
    let recovery = null, left = (a.recovery_codes || []).length;
    if (t.purpose === 'setup') {
      const step = totp.verify(totp.open(a.totp_secret), code, null);
      if (step === null) { await failed(req, a); return bad(res, 'That code is not right. Check the time on your phone and try the newest code.', 401); }
      const rc = totp.recoveryCodes(); recovery = rc.plain; left = rc.plain.length;
      await q('UPDATE platform_admins SET totp_enabled=true, totp_last_step=$2, recovery_codes=$3 WHERE id=$1', [a.id, step, JSON.stringify(rc.hashes)]);
    } else if (recoveryCode) {
      const h = totp.hashCode(recoveryCode); const codes = a.recovery_codes || [];
      if (!codes.includes(h)) { await failed(req, a); return bad(res, 'That recovery code is not valid', 401); }
      left = codes.length - 1; await q('UPDATE platform_admins SET recovery_codes=$2 WHERE id=$1', [a.id, JSON.stringify(codes.filter((x) => x !== h))]);
    } else {
      const step = totp.verify(totp.open(a.totp_secret), code, a.totp_last_step);
      if (step === null) { await failed(req, a); return bad(res, 'That code is not right (or was already used). Try the next one.', 401); }
      await q('UPDATE platform_admins SET totp_last_step=$2 WHERE id=$1', [a.id, step]);
    }
    await q('UPDATE admin_login_tickets SET used_at=now() WHERE id=$1', [t.id]);
    const ua = String(req.get('user-agent') || '').slice(0, 300); const ip = clientIp(req);
    const seen = (await q('SELECT 1 FROM admin_sessions WHERE admin_id=$1 AND ip=$2 AND user_agent=$3 LIMIT 1', [a.id, ip, ua])).rowCount > 0;
    await q('UPDATE platform_admins SET failed_attempts=0, locked_until=NULL, last_login_at=now(), last_login_ip=$2 WHERE id=$1', [a.id, ip]);
    await newSession(req, res, a.id);
    req.admin = a; await audit(req, recoveryCode ? 'login_recovery_code' : t.purpose === 'setup' ? 'login_2fa_setup' : 'login');
    mailer.sendEmail(Object.assign({ to: a.email, kind: 'admin_login' }, mailer.T.adminLogin({ name: a.name, when: new Date().toUTCString(), ip, agent: ua, fresh: !seen }))).catch(() => { });
    res.json({ ok: true, recoveryCodes: recovery, recoveryLeft: left, mustChangePassword: a.must_change_pw });
  }));

  const A = express.Router(); // everything below needs a session
  A.use(wrap(auth));
  A.get('/me', wrap(async (req, res) => {
    const a = req.admin;
    res.json({ twoFactor: TWO_FA(), admin: { id: a.id, email: a.email, name: a.name, role: a.role, mustChangePassword: a.must_change_pw, needsPin: !a.pin_hash && !TWO_FA(), recoveryLeft: (a.recovery_codes || []).length, perms: permsOf(a) },
      roleName: a.role === 'super' ? 'Super Admin' : a.role_name || a.role, security: a.role === 'super' ? securityChecks() : undefined });
  }));
  A.post('/auth/logout', wrap(async (req, res) => { await q('UPDATE admin_sessions SET revoked_at=now() WHERE id=$1', [req.sid]); setCookie(res, '', 0); await audit(req, 'logout'); res.json({ ok: true }); }));
  A.post('/auth/reauth', authLimiter, wrap(async (req, res) => {
    const a = (await q('SELECT * FROM platform_admins WHERE id=$1', [req.admin.id])).rows[0]; const { code, recoveryCode, pin } = req.body || {};
    if (locked(a)) return bad(res, 'Too many attempts. Try again later.', 429);
    if (!TWO_FA()) { // TODO(2FA): confirm risky actions with the admin's PIN until two-step is back
      if (!a.pin_hash) return bad(res, 'Create your 4-digit PIN first', 403, { code: 'set_pin' });
      if (!/^\d{4}$/.test(String(pin || '')) || !(await bcrypt.compare(String(pin), a.pin_hash))) { await failed(req, a); return bad(res, 'That PIN is not right', 401); }
      await q('UPDATE platform_admins SET failed_attempts=0 WHERE id=$1', [a.id]);
    } else if (recoveryCode) { const h = totp.hashCode(recoveryCode); if (!(a.recovery_codes || []).includes(h)) { await failed(req, a); return bad(res, 'That recovery code is not valid', 401); } await q('UPDATE platform_admins SET recovery_codes=$2 WHERE id=$1', [a.id, JSON.stringify(a.recovery_codes.filter((x) => x !== h))]); }
    else { const step = totp.verify(totp.open(a.totp_secret), code, a.totp_last_step); if (step === null) { await failed(req, a); return bad(res, 'That code is not right', 401); } await q('UPDATE platform_admins SET totp_last_step=$2, failed_attempts=0 WHERE id=$1', [a.id, step]); }
    await q('UPDATE admin_sessions SET reauth_at=now() WHERE id=$1', [req.sid]); res.json({ ok: true });
  }));
  A.post('/auth/password', authLimiter, wrap(async (req, res) => {
    const { current, password } = req.body || {}; const a = req.admin;
    if (!(await bcrypt.compare(String(current || ''), a.password_hash))) { await failed(req, a); return bad(res, 'Your current password is not right', 401); }
    const pw = String(password || '');
    if (pw.length < 12) return bad(res, 'Use at least 12 characters');
    if (pw.toLowerCase().includes(a.email.split('@')[0].toLowerCase()) || pw === current) return bad(res, 'Choose a password that is not your email or your old password');
    await q('UPDATE platform_admins SET password_hash=$2, must_change_pw=false WHERE id=$1', [a.id, await bcrypt.hash(pw, 12)]);
    await q('UPDATE admin_sessions SET revoked_at=now() WHERE admin_id=$1 AND id <> $2 AND revoked_at IS NULL', [a.id, req.sid]);
    await audit(req, 'password_changed'); res.json({ ok: true });
  }));
  /* create the PIN (first time) or change it (needs the password) */
  A.post('/auth/pin', authLimiter, wrap(async (req, res) => {
    const { pin, password } = req.body || {}; const a = (await q('SELECT * FROM platform_admins WHERE id=$1', [req.admin.id])).rows[0];
    if (a.pin_hash) { if (!(await bcrypt.compare(String(password || ''), a.password_hash))) { await failed(req, a); return bad(res, 'Your password is not right', 401); } }
    const why = pinProblem(pin); if (why) return bad(res, why);
    await q('UPDATE platform_admins SET pin_hash=$2, pin_set_at=now(), failed_attempts=0 WHERE id=$1', [a.id, await bcrypt.hash(String(pin), 12)]);
    await q('UPDATE admin_sessions SET reauth_at=now() WHERE id=$1', [req.sid]);
    await audit(req, a.pin_hash ? 'pin_changed' : 'pin_created'); res.json({ ok: true });
  }));
  A.post('/auth/recovery-codes', reauth, wrap(async (req, res) => {
    const rc = totp.recoveryCodes(); await q('UPDATE platform_admins SET recovery_codes=$2 WHERE id=$1', [req.admin.id, JSON.stringify(rc.hashes)]);
    await audit(req, 'recovery_codes_regenerated'); res.json({ recoveryCodes: rc.plain });
  }));

  /* ---------- overview ---------- */
  A.get('/overview', need('overview.view'), wrap(async (req, res) => {
    const one = async (sql, p) => (await q(sql, p || [])).rows[0];
    const statuses = Object.fromEntries((await q('SELECT status, count(*)::int AS n FROM subscriptions GROUP BY status')).rows.map((x) => [x.status, x.n]));
    res.json({
      statuses, tenants: (await one('SELECT count(*)::int AS n FROM tenants')).n,
      mrr: (await one("SELECT coalesce(sum(CASE WHEN cycle='yearly' THEN price/12.0 ELSE price END),0)::int AS v FROM subscriptions WHERE status IN ('active','past_due') AND price IS NOT NULL")).v,
      collectedMonth: (await one("SELECT coalesce(sum(amount),0)::int AS v FROM payments WHERE status='confirmed' AND date_trunc('month', paid_on) = date_trunc('month', now())")).v,
      revenue: (await q("SELECT to_char(date_trunc('month', paid_on),'YYYY-MM') AS m, sum(amount)::int AS v FROM payments WHERE status='confirmed' AND paid_on >= date_trunc('month', now()) - interval '5 months' GROUP BY 1 ORDER BY 1")).rows,
      signups30: (await one("SELECT count(*)::int AS n FROM tenants WHERE created_at > now() - interval '30 days'")).n,
      conversion: await one("SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM payments p WHERE p.tenant_id=t.id AND p.status='confirmed'))::int AS paid, count(*)::int AS total FROM tenants t WHERE created_at > now() - interval '180 days'"),
      lost30: (await one("SELECT count(*)::int AS n FROM subscriptions WHERE status IN ('expired','cancelled') AND updated_at > now() - interval '30 days' AND plan_id IS NOT NULL")).n,
      due: await one("SELECT count(*) FILTER (WHERE due_date <= current_date + 7)::int AS week, coalesce(sum(amount) FILTER (WHERE due_date <= current_date + 7),0)::int AS week_amount, count(*) FILTER (WHERE due_date < current_date)::int AS overdue FROM invoices WHERE status='open'"),
      pendingPayments: (await one("SELECT count(*)::int AS n FROM payments WHERE status='pending'")).n,
      openTickets: (await one("SELECT count(*)::int AS n FROM support_tickets WHERE status='open'")).n,
      recentSignups: (await q("SELECT t.id, t.name, t.created_at, s.status FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id=t.id ORDER BY t.created_at DESC LIMIT 8")).rows,
      recentPayments: (await q("SELECT p.id, p.amount, p.currency, p.method, p.paid_on, p.status, t.name AS tenant, t.id AS tenant_id FROM payments p JOIN tenants t ON t.id=p.tenant_id ORDER BY p.created_at DESC LIMIT 8")).rows,
    });
  }));

  /* ---------- businesses ---------- */
  const TENANT_LIST = `SELECT t.id, t.name, t.created_at, s.status, s.plan_id, p.name AS plan_name, s.cycle, s.price, s.trial_ends_at, s.current_period_end,
      (SELECT count(*)::int FROM users u WHERE u.tenant_id=t.id AND u.active) AS users,
      (SELECT max(at) FROM audit_log a WHERE a.tenant_id=t.id) AS last_activity, o.name AS owner_name, o.login AS owner_login, o.email AS owner_email
    FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id=t.id LEFT JOIN plans p ON p.id=s.plan_id
    LEFT JOIN LATERAL (SELECT name, login, email FROM users WHERE tenant_id=t.id AND role='owner' ORDER BY created_at LIMIT 1) o ON true
    WHERE ($1 = '' OR t.name ILIKE '%' || $1 || '%' OR o.login ILIKE '%' || $1 || '%' OR coalesce(o.email,'') ILIKE '%' || $1 || '%' OR o.name ILIKE '%' || $1 || '%')
      AND ($2 = '' OR s.status = $2) AND ($3 = '' OR s.plan_id = $3)`;
  A.get('/tenants', need('tenants.view'), wrap(async (req, res) => {
    const page = Math.max(0, Number(req.query.page) || 0); const qs = String(req.query.q || '').slice(0, 80).replace(/[%_]/g, '');
    const rows = (await q(TENANT_LIST + ' ORDER BY t.created_at DESC LIMIT 51 OFFSET $4', [qs, String(req.query.status || ''), String(req.query.plan || ''), page * 50])).rows;
    res.json({ tenants: rows.slice(0, 50), more: rows.length > 50 });
  }));
  async function tenantOr404(req, res) { const t = (await q('SELECT * FROM tenants WHERE id::text=$1', [req.params.id])).rows[0]; if (!t) bad(res, 'Business not found', 404); return t; }
  A.get('/tenants/:id', need('tenants.view'), wrap(async (req, res) => {
    const t = await tenantOr404(req, res); if (!t) return; const id = t.id;
    const st = (await q("SELECT data FROM documents WHERE tenant_id=$1 AND collection='settings' AND id='main'", [id])).rows[0];
    const counts = Object.fromEntries((await q("SELECT collection, count(*)::int AS n FROM documents WHERE tenant_id=$1 AND collection IN ('products','sales','customers','orders') GROUP BY collection", [id])).rows.map((x) => [x.collection, x.n]));
    const showMoney = can(req.admin, 'billing') || can(req.admin, 'subs.write');
    res.json({
      tenant: t, subscription: await B.getSub(pool, id), settings: st ? { businessName: st.data.businessName, phone: st.data.phone, address: st.data.address, currency: st.data.currency, shopSlug: st.data.shopSlug, shopEnabled: !!st.data.shopEnabled } : {},
      users: (await q('SELECT id, name, login, email, role, active, created_at, last_login_at FROM users WHERE tenant_id=$1 ORDER BY created_at', [id])).rows,
      usage: await B.usage(pool, id), limits: (await B.limitsFor(pool, id)).limits, features: (await B.limitsFor(pool, id)).features, catalog: KC.FEATURES, counts,
      invoices: showMoney || can(req.admin, 'tenants.view') ? (await q('SELECT i.*, p.name AS plan_name FROM invoices i LEFT JOIN plans p ON p.id=i.plan_id WHERE tenant_id=$1 ORDER BY issued_at DESC LIMIT 50', [id])).rows : [],
      payments: (await q('SELECT * FROM payments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [id])).rows,
      activity: (await q('SELECT at, user_name, action, collection, doc_id FROM audit_log WHERE tenant_id=$1 ORDER BY at DESC LIMIT 25', [id])).rows,
      tickets: (await q('SELECT id, topic, status, created_at, updated_at, user_name FROM support_tickets WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [id])).rows,
      adminLog: (await q('SELECT at, admin_email, action, reason, details FROM admin_audit WHERE tenant_id=$1 ORDER BY at DESC LIMIT 25', [id])).rows,
    });
  }));
  A.post('/tenants/:id/subscription', wrap(async (req, res) => {
    const t = await tenantOr404(req, res); if (!t) return; const b = req.body || {}; const act = b.action;
    const isSuspend = act === 'suspend' || act === 'reactivate';
    if (!can(req.admin, isSuspend ? 'tenants.suspend' : 'subs.write')) return bad(res, 'Your admin role cannot do this', 403);
    if (isSuspend && !(req.admin.reauth_at && Date.now() - new Date(req.admin.reauth_at).getTime() < REAUTH_MS)) return bad(res, 'Confirm it is you', 403, { code: 'reauth' });
    const s = await B.getSub(pool, t.id); if (!s) return bad(res, 'No subscription');
    const now = new Date(); const days = Math.round(Number(b.days)); let patch = {};
    const reason = String(b.reason || '').trim().slice(0, 300);
    if (['suspend', 'reactivate', 'cancel', 'change_plan'].includes(act) && reason.length < 4) return bad(res, 'Give a reason (it is kept in the audit log)');
    if (act === 'change_plan') {
      const plan = (await q('SELECT * FROM plans WHERE id=$1', [b.planId])).rows[0]; if (!plan) return bad(res, 'Choose a plan');
      const cycle = b.cycle === 'yearly' ? 'yearly' : 'monthly'; const price = b.price === '' || b.price === undefined || b.price === null ? plan['price_' + cycle] : Math.round(Number(b.price));
      if (price !== null && !(price >= 0)) return bad(res, 'Price must be 0 or more');
      const end = b.periodEnd ? new Date(b.periodEnd + 'T23:59:59Z') : s.current_period_end && new Date(s.current_period_end) > now ? new Date(s.current_period_end) : B.addPeriod(now, cycle);
      if (!(end > now)) return bad(res, 'The end date must be in the future');
      patch = { plan_id: plan.id, cycle, price, status: 'active', current_period_start: s.current_period_start || now, current_period_end: end, suspended_reason: null };
    } else if (act === 'extend_trial') {
      if (!(days >= 1 && days <= 365)) return bad(res, 'Days: 1 to 365'); if (s.plan_id && s.status !== 'trialing' && s.status !== 'expired') return bad(res, 'This business is not on a trial');
      const base = s.trial_ends_at && new Date(s.trial_ends_at) > now ? new Date(s.trial_ends_at) : now;
      patch = { status: 'trialing', trial_ends_at: new Date(base.getTime() + days * 864e5), plan_id: s.status === 'expired' && !s.current_period_end ? null : s.plan_id };
    } else if (act === 'extend_period') {
      if (!(days >= 1 && days <= 730)) return bad(res, 'Days: 1 to 730'); if (!s.plan_id) return bad(res, 'Choose a plan first (Change plan)');
      const base = s.current_period_end && new Date(s.current_period_end) > now ? new Date(s.current_period_end) : now;
      patch = { status: 'active', current_period_end: new Date(base.getTime() + days * 864e5), suspended_reason: null };
    } else if (act === 'suspend') patch = { status: 'suspended', suspended_reason: reason };
    else if (act === 'reactivate') {
      if (s.status !== 'suspended') return bad(res, 'This business is not suspended');
      const status = s.plan_id && s.current_period_end && new Date(s.current_period_end) > now ? 'active' : !s.plan_id && s.trial_ends_at && new Date(s.trial_ends_at) > now ? 'trialing' : 'expired';
      patch = { status, suspended_reason: null };
    } else if (act === 'cancel') { if (!s.plan_id) return bad(res, 'No paid plan to cancel'); patch = { status: 'cancelled' }; }
    else if (act === 'grace') { if (!(days >= 0 && days <= 60)) return bad(res, 'Grace days: 0 to 60'); patch = { grace_days: days }; }
    else return bad(res, 'Unknown action');
    await tx((c) => B.setSub(c, t.id, patch));
    await audit(req, 'subscription_' + act, { tenantId: t.id, target: t.name, reason, details: { before: { plan: s.plan_id, status: s.status, end: s.current_period_end, trial: s.trial_ends_at }, after: patch } });
    res.json({ ok: true, subscription: await B.getSub(pool, t.id) });
  }));
  /* a business's own deal on top of its plan: features switched on/off, other limits */
  A.post('/tenants/:id/features', need('tenants.features'), reauth, wrap(async (req, res) => {
    const t = await tenantOr404(req, res); if (!t) return; const b = req.body || {};
    const ov = { modules: {}, limits: {} }; const M = b.modules || {}, L = b.limits || {};
    KC.FEATURE_KEYS.forEach((k) => { if (M[k] === true || M[k] === false) ov.modules[k] = M[k]; }); // true = give it even if the plan doesn't; false = take it away
    Object.keys(B.COUNT_LIMITS).forEach((k) => { if (L[k] !== '' && L[k] !== null && L[k] !== undefined) { const v = Math.round(Number(L[k])); if (v >= 1) ov.limits[k] = v; } });
    const old = (await B.getSub(pool, t.id)) || {};
    await q('UPDATE subscriptions SET overrides=$2, updated_at=now() WHERE tenant_id=$1', [t.id, JSON.stringify(ov)]); B.invalidate(t.id);
    await audit(req, 'tenant_features', { tenantId: t.id, target: t.name, reason: String(b.reason || '').slice(0, 300), details: { before: old.overrides || {}, after: ov } });
    res.json({ ok: true, features: (await B.limitsFor(pool, t.id)).features });
  }));
  A.post('/tenants/:id/reset-owner-password', need('tenants.resetOwner'), reauth, wrap(async (req, res) => {
    const t = await tenantOr404(req, res); if (!t) return; const reason = needReason(req, res); if (!reason) return;
    const o = await B.ownerOf(pool, t.id); if (!o) return bad(res, 'This business has no active owner');
    const temp = Array.from(crypto.randomBytes(9), (x) => 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 54]).join('') + '-' + crypto.randomInt(10, 99);
    await q('UPDATE users SET password_hash=$2 WHERE id=$1', [o.id, await bcrypt.hash(temp, 10)]);
    await q("INSERT INTO audit_log (tenant_id, user_name, location_id, action, after) VALUES ($1, $2, 'main', 'support_password', $3)", [t.id, 'Kargo support', JSON.stringify({ reason, by: req.admin.name })]);
    const to = mailer.emailOf(o); let emailed = null;
    if (to) emailed = (await mailer.sendEmail(Object.assign({ to, kind: 'staff_password', tenantId: t.id }, mailer.T.staffAccount({ name: o.name, business: t.name, login: o.login, password: temp, role: 'owner', url: mailer.appUrl(), by: 'Kargo support', reset: true })))).status;
    await audit(req, 'owner_password_reset', { tenantId: t.id, target: o.login, reason });
    res.json({ ok: true, password: temp, login: o.login, emailed: emailed, emailTo: to || '' });
  }));
  A.post('/tenants/:id/view', need('tenants.impersonate'), reauth, wrap(async (req, res) => {
    const t = await tenantOr404(req, res); if (!t) return; const reason = needReason(req, res); if (!reason) return;
    const o = await B.ownerOf(pool, t.id); if (!o) return bad(res, 'This business has no active owner');
    const token = jwt.sign({ uid: o.id, imp: req.admin.id, impName: req.admin.name, ro: true }, tenantSecret, { expiresIn: '30m' });
    await q("INSERT INTO audit_log (tenant_id, user_name, location_id, action, after) VALUES ($1, $2, 'main', 'support_view', $3)", [t.id, 'Kargo support', JSON.stringify({ reason, by: req.admin.name })]);
    await audit(req, 'view_as_owner', { tenantId: t.id, target: t.name, reason });
    const base = (process.env.APP_URL || '').replace(/\/$/, '') || (req.protocol + '://' + req.get('host').replace(/^admin\./, ''));
    res.json({ url: base + '/#imp=' + token, expiresInMin: 30 });
  }));

  /* ---------- invoices & payments ---------- */
  const fail = (res, e) => bad(res, e.message, e.status || 500);
  A.post('/tenants/:id/invoices', need('billing.write'), wrap(async (req, res) => {
    const t = await tenantOr404(req, res); if (!t) return; const b = req.body || {};
    let inv; try { inv = await tx((c) => B.createInvoice(c, { tid: t.id, planId: b.planId, cycle: b.cycle, amount: b.amount, dueDays: b.dueDays, createdBy: req.admin.email })); } catch (e) { return fail(res, e); }
    if (b.send !== false) { const plan = (await q('SELECT * FROM plans WHERE id=$1', [inv.plan_id])).rows[0]; await B.mailOwner(pool, t.id, 'invoice', B.invoiceMail(inv, plan, await B.platformSettings(), mailer.appUrl()), 'invoice:' + inv.id); }
    await audit(req, 'invoice_created', { tenantId: t.id, target: inv.number, details: { amount: inv.amount, plan: inv.plan_id, cycle: inv.cycle } });
    res.json({ invoice: inv });
  }));
  A.post('/invoices/:id/void', need('billing.void'), reauth, wrap(async (req, res) => {
    const reason = needReason(req, res); if (!reason) return;
    const inv = (await q("UPDATE invoices SET status='void', void_reason=$2 WHERE id::text=$1 AND status='open' RETURNING *", [req.params.id, reason])).rows[0];
    if (!inv) return bad(res, 'Only an open invoice can be voided');
    await q("UPDATE payments SET status='rejected', decided_at=now(), note=coalesce(note,'') || ' (invoice voided)' WHERE invoice_id=$1 AND status='pending'", [inv.id]);
    await audit(req, 'invoice_voided', { tenantId: inv.tenant_id, target: inv.number, reason }); res.json({ ok: true });
  }));
  A.get('/invoices', need('billing'), wrap(async (req, res) => {
    const st = String(req.query.status || ''); const qs = String(req.query.q || '').replace(/[%_]/g, '').slice(0, 60);
    res.json({ invoices: (await q("SELECT i.*, t.name AS tenant, p.name AS plan_name FROM invoices i JOIN tenants t ON t.id=i.tenant_id LEFT JOIN plans p ON p.id=i.plan_id WHERE ($1='' OR i.status=$1 OR ($1='overdue' AND i.status='open' AND i.due_date < current_date)) AND ($2='' OR t.name ILIKE '%'||$2||'%' OR i.number ILIKE '%'||$2||'%') ORDER BY i.issued_at DESC LIMIT 300", [st, qs])).rows });
  }));
  A.get('/payments', need('billing'), wrap(async (req, res) => {
    const st = String(req.query.status || '');
    res.json({ payments: (await q("SELECT p.*, t.name AS tenant, i.number AS invoice_number, a.email AS recorded_by_email FROM payments p JOIN tenants t ON t.id=p.tenant_id LEFT JOIN invoices i ON i.id=p.invoice_id LEFT JOIN platform_admins a ON a.id=p.recorded_by WHERE ($1='' OR p.status=$1) ORDER BY p.created_at DESC LIMIT 300", [st])).rows });
  }));
  async function confirmed(req, p) {
    const inv = await tx((c) => B.applyPayment(c, p.id));
    if (inv && inv.status === 'paid') await B.mailOwner(pool, p.tenant_id, 'payment_received', (o) => mailer.T.paymentReceived({ name: o.name, business: o.tenant_name, number: inv.number, amount: B.money(inv.amount, inv.currency), until: B.dayStr(inv.period_end), url: mailer.appUrl() }), 'paid:' + inv.id);
    return inv;
  }
  A.post('/payments', need('billing.write'), wrap(async (req, res) => {
    const b = req.body || {}; const amount = Math.round(Number(b.amount));
    const t = (await q('SELECT id, name FROM tenants WHERE id::text=$1', [b.tenantId])).rows[0]; if (!t) return bad(res, 'Choose the business');
    if (!(amount > 0)) return bad(res, 'Amount must be more than 0'); if (!B.PAY_METHODS.includes(b.method)) return bad(res, 'Choose how they paid');
    const inv = b.invoiceId ? (await q("SELECT * FROM invoices WHERE id::text=$1 AND tenant_id=$2", [b.invoiceId, t.id])).rows[0] : null;
    if (b.invoiceId && (!inv || inv.status !== 'open')) return bad(res, 'Choose an open invoice of this business');
    let p; try { p = (await q("INSERT INTO payments (tenant_id, invoice_id, amount, currency, method, reference, paid_on, status, note, recorded_by, decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,now()) RETURNING *",
      [t.id, inv ? inv.id : null, amount, inv ? inv.currency : 'XAF', b.method, String(b.reference || '').trim().slice(0, 80) || null, /^\d{4}-\d{2}-\d{2}$/.test(String(b.paidOn)) ? b.paidOn : B.dayStr(new Date()), String(b.note || '').slice(0, 300) || null, req.admin.id])).rows[0]; }
    catch (e) { if (e.code === '23505') return bad(res, 'This transaction reference was already recorded', 409); throw e; }
    const after = await confirmed(req, p);
    await audit(req, 'payment_recorded', { tenantId: t.id, target: inv ? inv.number : '', details: { amount, method: b.method, reference: p.reference } });
    res.json({ payment: p, invoice: after });
  }));
  A.post('/payments/:id/:decision', need('billing.write'), wrap(async (req, res) => {
    const d = req.params.decision; if (!['confirm', 'reject'].includes(d)) return bad(res, 'Unknown action', 404);
    const reason = String((req.body || {}).reason || '').trim().slice(0, 300); if (d === 'reject' && reason.length < 4) return bad(res, 'Give a reason (the business will see it)');
    const p = (await q("UPDATE payments SET status=$2, recorded_by=$3, decided_at=now(), note=CASE WHEN $4 <> '' THEN $4 ELSE note END WHERE id::text=$1 AND status='pending' RETURNING *", [req.params.id, d === 'confirm' ? 'confirmed' : 'rejected', req.admin.id, reason])).rows[0];
    if (!p) return bad(res, 'This payment was already handled');
    const inv = d === 'confirm' ? await confirmed(req, p) : null;
    await audit(req, 'payment_' + d + 'ed', { tenantId: p.tenant_id, target: p.reference || '', reason, details: { amount: p.amount, method: p.method } });
    res.json({ ok: true, invoice: inv });
  }));

  /* ---------- plans ---------- */
  A.get('/plans', need('plans.view'), wrap(async (req, res) => {
    res.json({ plans: (await q("SELECT p.*, (SELECT count(*)::int FROM subscriptions s WHERE s.plan_id=p.id AND s.status IN ('active','past_due','cancelled')) AS subscribers FROM plans p ORDER BY sort, name")).rows, limitKeys: { counts: B.COUNT_LIMITS }, catalog: KC.FEATURES });
  }));
  function cleanPlan(b) {
    const intOrNull = (v) => (v === '' || v === null || v === undefined ? null : Math.round(Number(v)));
    const p = { name: String(b.name || '').trim().slice(0, 40), description: String(b.description || '').trim().slice(0, 200), price_monthly: intOrNull(b.price_monthly), price_yearly: intOrNull(b.price_yearly), active: b.active !== false, public: !!b.public, sort: Math.round(Number(b.sort) || 0), features: (Array.isArray(b.features) ? b.features : []).map((f) => String(f).trim().slice(0, 80)).filter(Boolean).slice(0, 12), limits: {}, modules: {} };
    if (p.name.length < 2) return { error: 'Give the plan a name' };
    if ([p.price_monthly, p.price_yearly].some((v) => v !== null && !(v >= 0))) return { error: 'Prices must be 0 or more' };
    const L = b.limits || {};
    Object.keys(B.COUNT_LIMITS).forEach((k) => { const v = intOrNull(L[k]); if (v !== null) p.limits[k] = Math.max(1, v); });
    const M = b.modules || {}; KC.FEATURE_KEYS.forEach((k) => { if (M[k] === false) p.modules[k] = false; }); // only what is OFF is stored
    return { p };
  }
  A.post('/plans', need('plans.write'), reauth, wrap(async (req, res) => {
    const id = String((req.body || {}).id || '').trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(id) || id === 'trial') return bad(res, 'Plan code: 2–30 lowercase letters, numbers or dashes (not "trial")');
    const { p, error } = cleanPlan(req.body || {}); if (error) return bad(res, error);
    try { await q('INSERT INTO plans (id, name, description, price_monthly, price_yearly, active, public, sort, features, limits, modules) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, p.name, p.description, p.price_monthly, p.price_yearly, p.active, p.public, p.sort, JSON.stringify(p.features), JSON.stringify(p.limits), JSON.stringify(p.modules)]); }
    catch (e) { if (e.code === '23505') return bad(res, 'A plan with this code already exists', 409); throw e; }
    await audit(req, 'plan_created', { target: id, details: p }); res.json({ ok: true });
  }));
  A.put('/plans/:id', need('plans.write'), reauth, wrap(async (req, res) => {
    const old = (await q('SELECT * FROM plans WHERE id=$1', [req.params.id])).rows[0]; if (!old) return bad(res, 'Plan not found', 404);
    const { p, error } = cleanPlan(req.body || {}); if (error) return bad(res, error);
    await q('UPDATE plans SET name=$2, description=$3, price_monthly=$4, price_yearly=$5, active=$6, public=$7, sort=$8, features=$9, limits=$10, modules=$11, updated_at=now() WHERE id=$1', [old.id, p.name, p.description, p.price_monthly, p.price_yearly, p.active, p.public, p.sort, JSON.stringify(p.features), JSON.stringify(p.limits), JSON.stringify(p.modules)]); B.invalidate();
    await audit(req, 'plan_updated', { target: old.id, details: { before: { price_monthly: old.price_monthly, price_yearly: old.price_yearly, limits: old.limits, modules: old.modules, active: old.active, public: old.public }, after: p } });
    res.json({ ok: true });
  }));

  /* ---------- platform settings ---------- */
  A.get('/settings', need('plans.view'), wrap(async (req, res) => res.json({ settings: await B.platformSettings() })));
  A.put('/settings', need('settings.write'), reauth, wrap(async (req, res) => {
    const b = req.body || {}; const pi = b.paymentInstructions || {}; const cut = (v, n) => String(v || '').trim().slice(0, n);
    const v = {
      paymentInstructions: { momoNumber: cut(pi.momoNumber, 30), momoName: cut(pi.momoName, 60), omNumber: cut(pi.omNumber, 30), omName: cut(pi.omName, 60), bank: cut(pi.bank, 200), note: cut(pi.note, 300) },
      graceDays: Math.min(60, Math.max(0, Math.round(Number(b.graceDays) || 0))),
      renewalNoticeDays: Math.min(30, Math.max(1, Math.round(Number(b.renewalNoticeDays) || 7))), invoiceDueDays: Math.min(60, Math.max(0, Math.round(Number(b.invoiceDueDays) || 0))),
    };
    for (const [k, val] of Object.entries(v)) await q('INSERT INTO platform_settings (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by', [k, JSON.stringify(val), req.admin.id]);
    await audit(req, 'settings_updated', { details: v }); res.json({ ok: true, settings: await B.platformSettings() });
  }));

  /* ---------- support ---------- */
  A.get('/support', need('support'), wrap(async (req, res) => {
    const st = String(req.query.status || '');
    res.json({ tickets: (await q("SELECT k.*, t.name AS tenant, (SELECT body FROM support_messages m WHERE m.ticket_id=k.id ORDER BY m.id DESC LIMIT 1) AS last FROM support_tickets k LEFT JOIN tenants t ON t.id=k.tenant_id WHERE ($1='' OR k.status=$1) ORDER BY k.updated_at DESC LIMIT 200", [st])).rows });
  }));
  A.get('/support/:id', need('support'), wrap(async (req, res) => {
    const k = (await q('SELECT k.*, t.name AS tenant FROM support_tickets k LEFT JOIN tenants t ON t.id=k.tenant_id WHERE k.id::text=$1', [req.params.id])).rows[0]; if (!k) return bad(res, 'Ticket not found', 404);
    res.json({ ticket: k, messages: (await q('SELECT * FROM support_messages WHERE ticket_id=$1 ORDER BY id', [k.id])).rows });
  }));
  A.post('/support/:id/reply', need('support'), wrap(async (req, res) => {
    const body = String((req.body || {}).body || '').trim(); if (body.length < 2) return bad(res, 'Write a reply');
    const k = (await q('SELECT * FROM support_tickets WHERE id::text=$1', [req.params.id])).rows[0]; if (!k) return bad(res, 'Ticket not found', 404);
    await q("INSERT INTO support_messages (ticket_id, author, admin_id, author_name, body) VALUES ($1,'admin',$2,$3,$4)", [k.id, req.admin.id, req.admin.name, body.slice(0, 5000)]);
    const status = (req.body || {}).close ? 'closed' : 'answered'; await q('UPDATE support_tickets SET status=$2, updated_at=now() WHERE id=$1', [k.id, status]);
    let emailed = 'no_email';
    if (k.email) emailed = (await mailer.sendEmail(Object.assign({ to: k.email, kind: 'support_reply', tenantId: k.tenant_id, replyTo: process.env.SUPPORT_EMAIL || undefined }, mailer.T.supportReply({ name: k.user_name || 'there', topic: k.topic, body, by: req.admin.name })))).status;
    await audit(req, 'support_reply', { tenantId: k.tenant_id, target: k.topic }); res.json({ ok: true, emailed });
  }));
  A.post('/support/:id/status', need('support'), wrap(async (req, res) => {
    const st = (req.body || {}).status; if (!['open', 'answered', 'closed'].includes(st)) return bad(res, 'Unknown status');
    await q('UPDATE support_tickets SET status=$2, updated_at=now() WHERE id::text=$1', [req.params.id, st]); res.json({ ok: true });
  }));

  /* ---------- platform health ---------- */
  function securityChecks() {
    return [
      ['Two-step sign-in (ADMIN_REQUIRE_2FA) — TODO', TWO_FA()],
      ['Admin served on its own host (ADMIN_HOST)', !!ADMIN_HOST()],
      ['Access gate in front (Cloudflare Access)', !!(process.env.CF_ACCESS_TEAM_DOMAIN && process.env.CF_ACCESS_AUD)],
      ['IP allowlist (ADMIN_IP_ALLOWLIST)', !!process.env.ADMIN_IP_ALLOWLIST],
      ['Security alerts email (ADMIN_ALERT_EMAIL)', !!process.env.ADMIN_ALERT_EMAIL],
      ['Emails can be sent (RESEND_API_KEY)', mailer.enabled()],
      ['Public app address set (APP_URL)', !!process.env.APP_URL],
    ].map(([label, ok]) => ({ label, ok }));
  }
  A.get('/health', need('health.view'), wrap(async (req, res) => {
    res.json({
      uptimeS: Math.round(process.uptime()), node: process.version, dbSize: (await q('SELECT pg_size_pretty(pg_database_size(current_database())) AS s')).rows[0].s,
      migrations: (await q('SELECT name, run_at FROM schema_migrations ORDER BY name DESC LIMIT 5')).rows,
      emails7d: Object.fromEntries((await q("SELECT status, count(*)::int AS n FROM email_log WHERE created_at > now() - interval '7 days' GROUP BY status")).rows.map((x) => [x.status, x.n])),
      emailFailures: (await q("SELECT created_at, kind, to_addr, error FROM email_log WHERE status='failed' ORDER BY created_at DESC LIMIT 10")).rows,
      reminderRuns: (await q('SELECT r.run_date, r.sent, t.name FROM reminder_runs r JOIN tenants t ON t.id=r.tenant_id ORDER BY r.at DESC LIMIT 10')).rows,
      security: securityChecks(),
    });
  }));

  /* ---------- admins, sessions, audit ---------- */
  A.get('/admins', wrap(async (req, res) => {
    const all = can(req.admin, 'admins.manage');
    res.json({ admins: (await q('SELECT id, email, name, role, active, totp_enabled, (pin_hash IS NOT NULL) AS has_pin, last_login_at, last_login_ip, locked_until, created_at, jsonb_array_length(recovery_codes) AS recovery_left FROM platform_admins WHERE $1 OR id=$2 ORDER BY created_at', [all, req.admin.id])).rows,
      sessions: (await q('SELECT s.id, s.admin_id, a.email, s.created_at, s.last_seen_at, s.ip, s.user_agent, (s.id = $3) AS current FROM admin_sessions s JOIN platform_admins a ON a.id=s.admin_id WHERE s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at > now() - interval \'30 minutes\' AND ($1 OR s.admin_id=$2) ORDER BY s.last_seen_at DESC', [all, req.admin.id, req.sid])).rows.map((x) => Object.assign(x, { id: x.id.slice(0, 16) })) });
  }));
  A.post('/sessions/:id/revoke', wrap(async (req, res) => {
    const all = can(req.admin, 'admins.manage');
    const r2 = await q("UPDATE admin_sessions SET revoked_at=now() WHERE left(id,16)=$1 AND revoked_at IS NULL AND ($2 OR admin_id=$3) RETURNING admin_id", [req.params.id, all, req.admin.id]);
    if (!r2.rowCount) return bad(res, 'Session not found', 404); await audit(req, 'session_revoked', { target: req.params.id }); res.json({ ok: true });
  }));
  /* admin roles (Super Admin only) */
  const cleanRole = (b) => ({ name: String(b.name || '').trim().slice(0, 40), description: String(b.description || '').trim().slice(0, 200), perms: (Array.isArray(b.perms) ? b.perms : []).filter((p) => PERM_KEYS.includes(p)) });
  A.get('/roles', wrap(async (req, res) => {
    res.json({ catalog: ADMIN_PERMS, roles: (await q('SELECT r.*, (SELECT count(*)::int FROM platform_admins a WHERE a.role = r.id) AS admins FROM admin_roles r ORDER BY builtin DESC, name')).rows });
  }));
  A.post('/roles', need('admins.manage'), reauth, wrap(async (req, res) => {
    const r = cleanRole(req.body || {}); if (r.name.length < 2) return bad(res, 'Give the role a name');
    if (!r.perms.length) return bad(res, 'Tick at least one permission');
    const id = r.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'role';
    if (id === 'super' || await roleRow(id)) return bad(res, 'A role with this name already exists', 409);
    await q('INSERT INTO admin_roles (id, name, description, perms) VALUES ($1,$2,$3,$4)', [id, r.name, r.description, JSON.stringify(r.perms)]);
    await audit(req, 'role_created', { target: id, details: r }); res.json({ ok: true, id });
  }));
  A.put('/roles/:id', need('admins.manage'), reauth, wrap(async (req, res) => {
    const old = await roleRow(req.params.id); if (!old) return bad(res, 'Role not found', 404);
    const r = cleanRole(req.body || {}); if (r.name.length < 2) return bad(res, 'Give the role a name'); if (!r.perms.length) return bad(res, 'Tick at least one permission');
    await q('UPDATE admin_roles SET name=$2, description=$3, perms=$4, updated_at=now() WHERE id=$1', [old.id, r.name, r.description, JSON.stringify(r.perms)]);
    await audit(req, 'role_updated', { target: old.id, details: { before: { name: old.name, perms: old.perms }, after: r } }); res.json({ ok: true });
  }));
  A.delete('/roles/:id', need('admins.manage'), reauth, wrap(async (req, res) => {
    const old = await roleRow(req.params.id); if (!old) return bad(res, 'Role not found', 404);
    if (old.builtin) return bad(res, 'Built-in roles cannot be deleted (you can change what they allow)');
    const used = (await q('SELECT count(*)::int AS n FROM platform_admins WHERE role=$1', [old.id])).rows[0].n; if (used) return bad(res, 'Move its ' + used + ' admin(s) to another role first');
    await q('DELETE FROM admin_roles WHERE id=$1', [old.id]); await audit(req, 'role_deleted', { target: old.id }); res.json({ ok: true });
  }));
  /* the Super Admin adds every other admin (temporary password, shown once and emailed; changed at first sign-in) */
  A.post('/admins', need('admins.manage'), reauth, wrap(async (req, res) => {
    const b = req.body || {}; const email = String(b.email || '').trim().toLowerCase(); const name = String(b.name || '').trim().slice(0, 80); const role = b.role;
    if (!mailer.isEmail(email)) return bad(res, 'Type a valid email address');
    if (name.length < 2) return bad(res, 'Type their full name');
    const roleR = role === 'super' ? null : await roleRow(String(role || '')); if (!roleR) return bad(res, 'Choose a role');
    const temp = Array.from(crypto.randomBytes(18), (x) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 55]).join('').replace(/(.{6})(?=.)/g, '$1-');
    let a; try { a = (await q('INSERT INTO platform_admins (email, name, role, password_hash, must_change_pw) VALUES ($1,$2,$3,$4,true) RETURNING id, email, name, role', [email, name, role, await bcrypt.hash(temp, 12)])).rows[0]; }
    catch (e) { if (e.code === '23505') return bad(res, 'An admin with this email already exists', 409); throw e; }
    const url = (ADMIN_HOST() ? 'https://' + ADMIN_HOST() : req.protocol + '://' + req.get('host')) + '/admin';
    let emailed = 'skipped';
    if (b.sendEmail !== false) emailed = (await mailer.sendEmail(Object.assign({ to: email, kind: 'admin_invite' }, mailer.T.adminInvite({ name, email, role: roleR.name, password: temp, url, by: req.admin.name })))).status;
    await audit(req, 'admin_created', { target: email, details: { role } });
    res.json({ admin: a, password: temp, emailed, url });
  }));
  A.post('/admins/:id/role', need('admins.manage'), reauth, wrap(async (req, res) => {
    const role = (req.body || {}).role; if (role === 'super' || !(await roleRow(String(role || '')))) return bad(res, 'Choose a role');
    if (req.params.id === req.admin.id) return bad(res, 'You cannot change your own role');
    const a = (await q('SELECT * FROM platform_admins WHERE id::text=$1', [req.params.id])).rows[0]; if (!a) return bad(res, 'Admin not found', 404);
    if (a.role === 'super') return bad(res, 'The Super Admin cannot be changed here');
    await q('UPDATE platform_admins SET role=$2 WHERE id=$1', [a.id, role]);
    await audit(req, 'admin_role_changed', { target: a.email, details: { from: a.role, to: role } }); res.json({ ok: true });
  }));
  A.post('/admins/:id/:act', need('admins.manage'), reauth, wrap(async (req, res) => {
    const act = req.params.act; if (!['deactivate', 'reactivate', 'reset-2fa', 'unlock', 'reset-pin'].includes(act)) return bad(res, 'Unknown action', 404);
    if (req.params.id === req.admin.id && act !== 'unlock') return bad(res, 'You cannot do this to your own account');
    const a = (await q('SELECT * FROM platform_admins WHERE id::text=$1', [req.params.id])).rows[0]; if (!a) return bad(res, 'Admin not found', 404);
    if (a.role === 'super') return bad(res, 'The Super Admin cannot be changed here');
    if (act === 'deactivate') { await q('UPDATE platform_admins SET active=false WHERE id=$1', [a.id]); await q('UPDATE admin_sessions SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL', [a.id]); }
    if (act === 'reactivate') await q('UPDATE platform_admins SET active=true WHERE id=$1', [a.id]);
    if (act === 'reset-2fa') { await q("UPDATE platform_admins SET totp_enabled=false, totp_secret=NULL, totp_last_step=NULL, recovery_codes='[]' WHERE id=$1", [a.id]); await q('UPDATE admin_sessions SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL', [a.id]); }
    if (act === 'unlock') await q('UPDATE platform_admins SET locked_until=NULL, failed_attempts=0 WHERE id=$1', [a.id]);
    if (act === 'reset-pin') await q('UPDATE platform_admins SET pin_hash=NULL, pin_set_at=NULL WHERE id=$1', [a.id]); // they create a new one at their next visit
    await audit(req, 'admin_' + act.replace('-', '_'), { target: a.email }); res.json({ ok: true });
  }));
  A.get('/audit', need('audit.view'), wrap(async (req, res) => {
    const act = String(req.query.action || ''), tid = String(req.query.tenant || ''), who = String(req.query.admin || '').toLowerCase();
    res.json({ entries: (await q("SELECT a.*, t.name AS tenant FROM admin_audit a LEFT JOIN tenants t ON t.id=a.tenant_id WHERE ($1='' OR a.action LIKE $1 || '%') AND ($2='' OR a.tenant_id::text=$2) AND ($3='' OR lower(a.admin_email)=$3) ORDER BY a.at DESC LIMIT 300", [act, tid, who])).rows });
  }));
  A.get('/export/:kind', wrap(async (req, res) => {
    const kind = req.params.kind; const perm = kind === 'tenants' ? 'tenants.view' : 'billing'; if (!can(req.admin, 'export') || !can(req.admin, perm)) return bad(res, 'Your admin role cannot do this', 403);
    const sql = { tenants: "SELECT t.name AS business, o.login AS owner_login, o.email AS owner_email, s.status, s.plan_id AS plan, s.cycle, s.price, s.trial_ends_at, s.current_period_end, t.created_at FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id=t.id LEFT JOIN LATERAL (SELECT login, email FROM users WHERE tenant_id=t.id AND role='owner' ORDER BY created_at LIMIT 1) o ON true ORDER BY t.created_at",
      invoices: "SELECT i.number, t.name AS business, i.plan_id AS plan, i.cycle, i.amount, i.currency, i.status, i.due_date, i.issued_at, i.paid_at, i.period_start, i.period_end FROM invoices i JOIN tenants t ON t.id=i.tenant_id ORDER BY i.issued_at",
      payments: "SELECT p.paid_on, t.name AS business, i.number AS invoice, p.amount, p.currency, p.method, p.reference, p.status, p.created_at FROM payments p JOIN tenants t ON t.id=p.tenant_id LEFT JOIN invoices i ON i.id=p.invoice_id ORDER BY p.created_at" }[kind];
    if (!sql) return bad(res, 'Unknown export', 404);
    const rows = (await q(sql)).rows; const cols = rows.length ? Object.keys(rows[0]) : [];
    const cell = (v) => { let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; // no spreadsheet formulas
    await audit(req, 'export_' + kind);
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="kargo-' + kind + '-' + B.dayStr(new Date()) + '.csv"').send([cols.join(',')].concat(rows.map((r0) => cols.map((c) => cell(r0[c])).join(','))).join('\n'));
  }));

  r.use('/api/admin', A);
  r.use('/api/admin', (req, res) => notFound(req, res));
  r.use('/admin', (req, res) => notFound(req, res));
  r.use((e, req, res, next) => { if (!isAdminPath(String(req.originalUrl || '').split('?')[0])) return next(e); console.error('[admin]', e); res.status(500).json({ error: 'Server error' }); });
  app.use(r);
};
module.exports.ADMIN_PERMS = ADMIN_PERMS;
module.exports.enabled = enabled;
