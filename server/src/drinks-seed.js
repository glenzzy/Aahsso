// Aahsso Bar & Resto: seeding the drinks catalog (tables from migration 028) from server/data/drinks-cm.json.
// Used by `npm run seed:drinks` and by the server, which fills an empty catalog on its own the first time it is asked.
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'drinks-cm.json');
const PACKS = ['Bottle', 'Glass', 'Can', 'Plastic', 'Carton', 'Served'];

function load(file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(d.items) || !d.items.length) throw new Error('No drinks in ' + file);
  const market = String(d.country || 'CM').toUpperCase(); const seen = new Set(); const bad = [];
  d.items.forEach((x, i) => {
    const at = 'row ' + (i + 1) + (x.sku ? ' (' + x.sku + ')' : '');
    if (!x.sku || !x.name || !x.cat) bad.push(at + ': code, name and category are required');
    if (seen.has(x.sku)) bad.push(at + ': code used twice'); seen.add(x.sku);
    if (x.pack && !PACKS.includes(x.pack)) bad.push(at + ': unknown packaging "' + x.pack + '" (RGB → Bottle, PET → Plastic)');
    ['ml', 'perCase', 'cost', 'priceBar', 'priceLounge', 'pourMl'].forEach((k) => { if (x[k] != null && !(Number(x[k]) >= 0)) bad.push(at + ': ' + k + ' is not a number'); });
  });
  if (bad.length) throw new Error('The file has problems:\n  ' + bad.slice(0, 20).join('\n  ') + (bad.length > 20 ? '\n  … and ' + (bad.length - 20) + ' more' : ''));
  return { d, market };
}
const int = (v) => (v == null || v === '' ? null : Math.round(Number(v)));
const numOr = (v) => (v == null || v === '' ? null : Number(v));
const txt = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());


/** add / update every drink in the file, switch off the ones no longer in it; returns what changed. One transaction. */
async function seedDrinks({ file = DEFAULT_FILE, dry = false, log = () => {} } = {}) {
  const { d, market } = load(file);
  log('Drinks catalog: ' + d.items.length + ' drinks for ' + market + ' from ' + path.relative(process.cwd(), file));
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(727275)'); // two seeds at once (script + server): one after the other
    const before = new Map((await c.query('SELECT sku, active FROM drinks_catalog WHERE market=$1', [market])).rows.map((r) => [r.sku, r.active]));
    let added = 0, updated = 0;
    for (const [i, x] of d.items.entries()) {
      const r = await c.query(`INSERT INTO drinks_catalog (sku, market, name, category, subcategory, brand, variant, volume_ml, packaging, returnable, units_per_case, abv, origin_country, region, grape_style, sweetness, producer, supplier, price_tier, cost_xaf, price_bar_xaf, price_lounge_xaf, by_glass, pour_ml, pours_per_unit, barcode, confidence, notes, active, sort, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30, now())
        ON CONFLICT (sku) DO UPDATE SET market=EXCLUDED.market, name=EXCLUDED.name, category=EXCLUDED.category, subcategory=EXCLUDED.subcategory, brand=EXCLUDED.brand, variant=EXCLUDED.variant, volume_ml=EXCLUDED.volume_ml, packaging=EXCLUDED.packaging, returnable=EXCLUDED.returnable, units_per_case=EXCLUDED.units_per_case, abv=EXCLUDED.abv, origin_country=EXCLUDED.origin_country, region=EXCLUDED.region, grape_style=EXCLUDED.grape_style, sweetness=EXCLUDED.sweetness, producer=EXCLUDED.producer, supplier=EXCLUDED.supplier, price_tier=EXCLUDED.price_tier, cost_xaf=EXCLUDED.cost_xaf, price_bar_xaf=EXCLUDED.price_bar_xaf, price_lounge_xaf=EXCLUDED.price_lounge_xaf, by_glass=EXCLUDED.by_glass, pour_ml=EXCLUDED.pour_ml, pours_per_unit=EXCLUDED.pours_per_unit, barcode=EXCLUDED.barcode, confidence=EXCLUDED.confidence, notes=EXCLUDED.notes, active=EXCLUDED.active, sort=EXCLUDED.sort, updated_at=now()
        RETURNING (xmax = 0) AS inserted`,
        [x.sku, market, txt(x.name), txt(x.cat), txt(x.sub), txt(x.brand), txt(x.variant), int(x.ml), txt(x.pack), !!x.returnable, int(x.perCase), numOr(x.abv), txt(x.country), txt(x.region), txt(x.grape), txt(x.sweetness), txt(x.producer), txt(x.supplier), txt(x.tier), int(x.cost), int(x.priceBar), int(x.priceLounge), !!x.byGlass, int(x.pourMl), numOr(x.pours), txt(x.barcode), txt(x.confidence), txt(x.notes), x.active !== false, i + 1]);
      if (r.rows[0].inserted) added++; else updated++;
    }
    const keep = d.items.map((x) => x.sku);
    const off = (await c.query('UPDATE drinks_catalog SET active=false, updated_at=now() WHERE market=$1 AND active AND NOT (sku = ANY($2)) RETURNING sku', [market, keep])).rows.map((r) => r.sku);
    const meta = { title: d.title, version: d.version, currency: d.currency || 'XAF', source: d.source, notes: d.notes || [], categories: (d.categories || []).map((x) => ({ name: x.name, subs: x.subs || [] })), packaging: d.packaging || [], priceTiers: d.priceTiers || [], sweetness: d.sweetness || [], confidence: d.confidence || [], suppliers: d.suppliers || [] };
    for (const [k, v] of Object.entries(meta)) if (v !== undefined) await c.query('INSERT INTO drinks_catalog_meta (market, key, value, updated_at) VALUES ($1,$2,$3, now()) ON CONFLICT (market, key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()', [market, k, JSON.stringify(v)]);
    const back = d.items.filter((x) => before.get(x.sku) === false && x.active !== false).length;
    if (dry) { await c.query('ROLLBACK'); log('Dry run — nothing saved.'); } else await c.query('COMMIT');
    log((dry ? 'Would add ' : 'Added ') + added + ', updated ' + updated + (back ? ' (' + back + ' switched back on)' : '') + ', switched off ' + off.length + (off.length ? ' (' + off.slice(0, 10).join(', ') + (off.length > 10 ? '…' : '') + ')' : '') + '.');
    const n = (await c.query('SELECT count(*)::int AS n, count(*) FILTER (WHERE active)::int AS a FROM drinks_catalog WHERE market=$1', [market])).rows[0];
    log('The catalog now has ' + n.a + ' active drinks' + (n.n > n.a ? ' (' + (n.n - n.a) + ' switched off)' : '') + '.');
    return { market, added, updated, off: off.length, active: n.a, dry };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}
module.exports = { seedDrinks, loadDrinksFile: load, DEFAULT_FILE };
