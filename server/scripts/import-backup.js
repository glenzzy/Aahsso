// Load a backup file downloaded from the hosted app into a business account.
// Usage: node scripts/import-backup.js <backup.json> <owner-login>
require('dotenv').config();
const fs = require('fs');
const { q, pool } = require('../src/db');
const { importBackup } = require('../src/index');

(async () => {
  const [file, login] = process.argv.slice(2);
  if (!file || !login) { console.log('Usage: node scripts/import-backup.js <backup.json> <owner-login>'); process.exit(1); }
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (b.app !== 'kargo' || !b.data) throw new Error('Not a Kargo backup file');
  const u = (await q('SELECT id, tenant_id FROM users WHERE login=$1', [login.toLowerCase()])).rows[0];
  if (!u) throw new Error('No user with login ' + login + ' — register the business in the app first');
  const n = await importBackup(u.tenant_id, u.id, b);
  console.log('Imported', n, 'records into tenant', u.tenant_id);
  await pool.end(); process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
