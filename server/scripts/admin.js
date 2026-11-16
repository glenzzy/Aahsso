#!/usr/bin/env node
/* The Super Admin — the one platform admin created here (there is no sign-up page). Everyone else is added by the
 * Super Admin in the dashboard (Security → Admins).
 *   node scripts/admin.js create --email you@company.com --name "Your Name"   (only when there is no Super Admin yet)
 *   node scripts/admin.js list
 *   node scripts/admin.js transfer --email …         (make another admin the Super Admin; the current one becomes Admin)
 *   node scripts/admin.js reset-password --email …   (new temporary password; must be changed at next sign-in)
 *   node scripts/admin.js reset-2fa --email …        (the authenticator is set up again at next sign-in)
 *   node scripts/admin.js reset-pin --email …        (forgotten 4-digit PIN: a new one is created at the next visit)
 *   node scripts/admin.js disable --email … | enable --email … | unlock --email …
 * Each command is written to the admin audit log as done "from the server console". */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { migrate } = require('../src/migrate');

const args = process.argv.slice(2); const cmd = args[0];
const opt = (k) => { const i = args.indexOf('--' + k); return i > 0 ? args[i + 1] : undefined; };
const tempPassword = () => Array.from(crypto.randomBytes(18), (b) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 55]).join('').replace(/(.{6})(?=.)/g, '$1-');
const log = (action, email) => pool.query("INSERT INTO admin_audit (admin_email, action, target, details) VALUES ('server console', $1, $2, $3)", [action, email, JSON.stringify({ host: require('os').hostname() })]);
const die = (m) => { console.error('✖ ' + m); process.exit(1); };

(async () => {
  await migrate({ quiet: true });
  const email = String(opt('email') || '').trim().toLowerCase();
  const find = async () => { const a = (await pool.query('SELECT * FROM platform_admins WHERE email=$1', [email])).rows[0]; if (!a) die('No admin with the email ' + email); return a; };
  if (cmd === 'create') {
    const name = String(opt('name') || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die('Give a valid --email');
    if (name.length < 2) die('Give --name "Full Name"');
    const sup = (await pool.query("SELECT email FROM platform_admins WHERE role='super'")).rows[0];
    if (sup) die('A Super Admin already exists (' + sup.email + '). Other admins are added by the Super Admin in the dashboard (Security → Admins).');
    const pw = tempPassword();
    try { await pool.query("INSERT INTO platform_admins (email, name, role, password_hash, must_change_pw) VALUES ($1,$2,'super',$3,true)", [email, name, await bcrypt.hash(pw, 12)]); }
    catch (e) { if (e.code === '23505') die('An admin with this email already exists (or a Super Admin was just created)'); throw e; }
    await log('super_admin_created', email);
    console.log('\n✔ Super Admin created: ' + name + ' <' + email + '>');
    console.log('\n  Temporary password (shown once):  ' + pw);
    console.log('\n  At the first sign-in they choose a new password' + (process.env.ADMIN_REQUIRE_2FA === 'true' ? ' and set up an authenticator app' : '') + '. Other admins are added in the dashboard.\n');
  } else if (cmd === 'list') {
    const rows = (await pool.query('SELECT email, name, role, active, totp_enabled, last_login_at, locked_until FROM platform_admins ORDER BY created_at')).rows;
    if (!rows.length) console.log('No admins yet. Create one: node scripts/admin.js create --email … --name "…"');
    rows.forEach((a) => console.log((a.active ? '●' : '○') + ' ' + a.email.padEnd(32) + a.role.padEnd(9) + (a.totp_enabled ? '2FA on ' : '2FA not set ') + (a.locked_until && new Date(a.locked_until) > new Date() ? ' LOCKED' : '') + (a.last_login_at ? '  last sign-in ' + new Date(a.last_login_at).toISOString().slice(0, 16) : '')));
  } else if (cmd === 'transfer') {
    const a = await find(); if (a.role === 'super') die(email + ' is already the Super Admin');
    if (!a.active) die(email + ' is disabled — enable it first');
    const old = (await pool.query("SELECT email FROM platform_admins WHERE role='super'")).rows[0];
    await pool.query('BEGIN');
    await pool.query("UPDATE platform_admins SET role='admin' WHERE role='super'");
    await pool.query("UPDATE platform_admins SET role='super' WHERE id=$1", [a.id]);
    await pool.query('COMMIT');
    await log('super_admin_transferred', email); console.log('✔ ' + email + ' is now the Super Admin' + (old ? ' (' + old.email + ' is now an Admin)' : '') + '.');
  } else if (cmd === 'reset-password') {
    const a = await find(); const pw = tempPassword();
    await pool.query('UPDATE platform_admins SET password_hash=$2, must_change_pw=true, failed_attempts=0, locked_until=NULL WHERE id=$1', [a.id, await bcrypt.hash(pw, 12)]);
    await pool.query('UPDATE admin_sessions SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL', [a.id]);
    await log('admin_password_reset', email); console.log('✔ New temporary password for ' + email + ' (shown once):  ' + pw);
  } else if (cmd === 'reset-2fa') {
    const a = await find();
    await pool.query("UPDATE platform_admins SET totp_enabled=false, totp_secret=NULL, totp_last_step=NULL, recovery_codes='[]' WHERE id=$1", [a.id]);
    await pool.query('UPDATE admin_sessions SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL', [a.id]);
    await log('admin_reset_2fa', email); console.log('✔ ' + email + ' will set up the authenticator again at the next sign-in.');
  } else if (cmd === 'reset-pin') {
    const a = await find(); await pool.query('UPDATE platform_admins SET pin_hash=NULL, pin_set_at=NULL WHERE id=$1', [a.id]);
    await log('admin_reset_pin', email); console.log('✔ ' + email + ' will create a new 4-digit PIN at the next visit.');
  } else if (['disable', 'enable', 'unlock'].includes(cmd)) {
    const a = await find();
    if (cmd === 'disable') { await pool.query('UPDATE platform_admins SET active=false WHERE id=$1', [a.id]); await pool.query('UPDATE admin_sessions SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL', [a.id]); }
    if (cmd === 'enable') await pool.query('UPDATE platform_admins SET active=true WHERE id=$1', [a.id]);
    if (cmd === 'unlock') await pool.query('UPDATE platform_admins SET locked_until=NULL, failed_attempts=0 WHERE id=$1', [a.id]);
    await log('admin_' + cmd, email); console.log('✔ Done: ' + cmd + ' ' + email);
  } else {
    console.log('Usage:\n  node scripts/admin.js create --email you@company.com --name "Your Name"   (the one Super Admin)\n  node scripts/admin.js list\n  node scripts/admin.js transfer --email …\n  node scripts/admin.js reset-password --email …\n  node scripts/admin.js reset-2fa --email …\n  node scripts/admin.js reset-pin --email …\n  node scripts/admin.js disable|enable|unlock --email …');
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
