// Seeds the Bar & Resto drinks catalog into the database (tables from migration 028).
//   npm run seed:drinks                      server/data/drinks-cm.json → DATABASE_URL
//   npm run seed:drinks -- path/to/file.json  another file (same format)
//   npm run seed:drinks -- --dry-run          only check the file and say what would change
// Safe to run again: drinks are added or updated by their code (sku); a drink no longer in the file is
// switched off (active = false), never deleted, because bars may already sell it.
// The file comes from the spreadsheet: python3 server/scripts/build-drinks-catalog.py
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { pool } = require('../src/db');
const { migrate } = require('../src/migrate');
const { seedDrinks, DEFAULT_FILE } = require('../src/drinks-seed');

const args = process.argv.slice(2); const dry = args.includes('--dry-run');
const file = path.resolve(args.find((a) => !a.startsWith('--')) || DEFAULT_FILE);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  await migrate({ quiet: true }); // the tables exist (migration 028)
  await seedDrinks({ file, dry, log: (m) => console.log(m) });
}

main().then(() => pool.end()).catch((e) => { console.error('Seeding the drinks catalog failed: ' + e.message); pool.end().finally(() => process.exit(1)); });
