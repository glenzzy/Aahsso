// Copies the frontend from ../public into server/public (real files, no symlinks), so the server folder
// deploys on its own (Vercel, Docker). config.js is NOT copied: the server's version points the app at the API.
//   node scripts/sync-public.js          copy
//   node scripts/sync-public.js --check  only report differences (exit 1 if any)
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'public');
const DST = path.join(__dirname, '..', 'public');
const SKIP = new Set(['config.js']);
const check = process.argv.includes('--check');

if (!fs.existsSync(SRC)) { console.log('sync-public: no ../public folder here (already deployed copy) — nothing to do'); process.exit(0); }
let changed = 0;
for (const name of fs.readdirSync(SRC)) {
  if (SKIP.has(name)) continue;
  const from = path.join(SRC, name), to = path.join(DST, name);
  if (!fs.statSync(from).isFile()) continue;
  const a = fs.readFileSync(from);
  let isLink = false; try { isLink = fs.lstatSync(to).isSymbolicLink(); } catch (e) { }
  const b = !isLink && fs.existsSync(to) ? fs.readFileSync(to) : null;
  if (!isLink && b && a.equals(b)) continue;
  changed++;
  if (check) { console.log('out of date:', name, isLink ? '(symlink)' : ''); continue; }
  if (isLink) fs.unlinkSync(to);
  fs.writeFileSync(to, a);
  console.log('copied', name);
}
if (check && changed) { console.error(changed + ' file(s) differ — run: npm run sync-public'); process.exit(1); }
console.log(check ? 'server/public is up to date' : 'sync-public: ' + changed + ' file(s) updated');
