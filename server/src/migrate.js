// Runs every .sql file in /migrations once, in name order.
// Used from the command line (npm run migrate) and automatically when the server starts,
// so a new feature's tables/columns always exist before any request uses them.
//
// Serverless + a pooled database (Neon "-pooler", PgBouncer): outside a transaction each query may run on a different
// database connection, so a session lock (pg_advisory_lock) can be taken on one and never released on another — every
// new instance then waits forever. So:
//   1. fast path: when every migration is already applied (almost always), just one SELECT — no lock at all;
//   2. otherwise everything runs in ONE transaction with a transaction lock (pg_advisory_xact_lock), released by COMMIT /
//      ROLLBACK whatever connection the pooler picked, and a lock_timeout so nothing can wait forever.
// The lock key is new (727301): a session lock left behind by older code on key 727274 cannot block it.
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

const DIR = path.join(__dirname, '..', 'migrations');
const LOCK_KEY = 727301;

async function migrate({ quiet = false } = {}) {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  try {
    const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    if (files.every((f) => done.has(f))) { if (!quiet) console.log('Migrations complete — nothing to do'); return []; }
  } catch (e) { if (e.code !== '42P01') throw e; } // no schema_migrations table yet: a new database
  const c = await pool.connect(); const ran = [];
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout = '20s'"); // another instance migrating: wait for it, but never forever
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, run_at timestamptz DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name)); // again: another instance may have just done them
    for (const f of files) {
      if (done.has(f)) continue;
      console.log('Running migration', f);
      await c.query(fs.readFileSync(path.join(DIR, f), 'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      ran.push(f);
    }
    await c.query('COMMIT');
    if (!quiet || ran.length) console.log('Migrations complete' + (ran.length ? ' (' + ran.join(', ') + ')' : ''));
    return ran;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => { });
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { migrate };

if (require.main === module) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
