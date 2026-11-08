// Runs every .sql file in /migrations once, in name order.
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

(async () => {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, run_at timestamptz DEFAULT now())');
  const dir = path.join(__dirname, '..', 'migrations');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    console.log('Running migration', f);
    await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    await pool.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
  }
  console.log('Migrations complete');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
