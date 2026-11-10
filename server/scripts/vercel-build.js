// Vercel build step: refresh server/public if the shared ../public folder is available, then run database
// migrations — on production deploys only, so preview deploys never change the live database.
// Set MIGRATE_ON_BUILD=false to skip and run `npm run migrate` yourself instead.
const { execFileSync } = require('child_process');
const path = require('path');
const run = (file) => execFileSync(process.execPath, [path.join(__dirname, '..', file)], { stdio: 'inherit' });

run('scripts/sync-public.js');
const env = process.env.VERCEL_ENV || 'local';
if (env === 'production' && process.env.DATABASE_URL && process.env.MIGRATE_ON_BUILD !== 'false') run('src/migrate.js');
else console.log('vercel-build: skipping migrations (env=' + env + (process.env.DATABASE_URL ? '' : ', no DATABASE_URL') + ')');
