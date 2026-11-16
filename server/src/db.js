require('dotenv').config();
const { Pool } = require('pg');

// On Vercel many short-lived instances each get their own pool, so keep it small and let idle
// connections go quickly. Use your provider's *pooled* connection string there (Neon "-pooler" host,
// Supabase port 6543) so the database never runs out of connections.
const serverless = !!process.env.VERCEL;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX || (serverless ? 3 : 10)),
  idleTimeoutMillis: serverless ? 5000 : 300000, // a new connection to a far database costs ~2 s: keep them for 5 minutes on a normal server
  connectionTimeoutMillis: 10000,
});
pool.on('error', (e) => console.error('[db] idle client error', e.message)); // a dropped idle connection must not crash the process

const q = (text, params) => pool.query(text, params);

async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

module.exports = { pool, q, tx };
