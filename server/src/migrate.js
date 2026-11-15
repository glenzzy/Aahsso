// Runs every .sql file in /migrations once, in name order.
// Used from the command line (npm run migrate) and automatically when the server starts,
// so a new feature's tables/columns always exist before any request uses them.
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate({ quiet = false } = {}) {
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(727274)'); // several server instances starting at once: one migrates, the others wait
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, run_at timestamptz DEFAULT now())');
    const dir = path.join(__dirname, '..', 'migrations');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const ran = [];
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      console.log('Running migration', f);
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      ran.push(f);
    }
    if (!quiet || ran.length) console.log('Migrations complete' + (ran.length ? ' (' + ran.join(', ') + ')' : ''));
    return ran;
  } finally {
    await c.query('SELECT pg_advisory_unlock(727274)').catch(() => { });
    c.release();
  }
}

module.exports = { migrate };

if (require.main === module) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
