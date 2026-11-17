/* Aahsso — app core: state, helpers, UI primitives, navigation */
const { num } = KC;
const K = {
  store: null, info: { role: 'admin' }, me: { id: 'local', name: '' }, member: { role: 'owner' }, perms: {}, route: 'home', pending: false, sheets: [],
  raw: { audits: [], settings: {}, products: [], lots: [], shipments: [], customers: [], sales: [], adjustments: [], expenses: [], members: [], requests: [], locations: [], transfers: [], handovers: [], suppliers: [], bills: [], reminders: [], assets: [], staff: [], attendance: [], leaves: [], payroll: [], tills: [], losses: [], claims: [] },
  outbox: [], failed: [], loc: 'main',
  loaded: {}, C: null, sync: 'loading',
  ui: { stockFilter: 'all', stockCat: '', stockQ: '', salesRange: 'today', salesStatus: 'all', salesQ: '', posQ: '', posCat: '', buyQ: '', custQ: '', repTab: 'daily', repDate: '', repMonth: '', expanded: {} },
  cart: { lines: [], customerId: null, editingId: null, discount: 0 },
};
try { const c = JSON.parse(localStorage.getItem('aahsso-cart') || 'null'); if (c && c.lines) K.cart = c; } catch (e) { }
const saveCart = () => { try { localStorage.setItem('aahsso-cart', JSON.stringify(K.cart)); } catch (e) { } };

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const grp = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); // 25,000
const fmt = (n) => (n < 0 ? '−' : '') + grp(Math.abs(num(n)));
const baseSym = () => KC.currencySymbolOf(S());
const F = (n) => fmt(n) + ' ' + baseSym();
/* ---------- number inputs show thousands separators: 150,000 · 655.957 · 1,250.5 ----------
 * Every amount / quantity box (inputmode numeric or decimal) is grouped with commas when it appears,
 * when the app fills it, and while you type (the cursor stays where you are typing).
 * Values are read with num(), which ignores the commas. Phone / barcode boxes are not touched. */
const isNumIn = (el) => el && el.tagName === 'INPUT' && /^(numeric|decimal)$/.test(el.getAttribute('inputmode') || '') && !el.hasAttribute('data-nofmt');
function groupNum(v) {
  let s = String(v === undefined || v === null ? '' : v).replace(/[^\d.\-]/g, '');
  if (!s) return '';
  const neg = s[0] === '-'; s = s.replace(/-/g, '');
  const dot = s.indexOf('.'); let int = dot < 0 ? s : s.slice(0, dot); const dec = dot < 0 ? '' : '.' + s.slice(dot + 1).replace(/\./g, '');
  int = int.replace(/^0+(?=\d)/, '');
  return (neg ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + dec;
}
(() => {
  const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(HTMLInputElement.prototype, 'value', {
    configurable: true, enumerable: d.enumerable, get() { return d.get.call(this); },
    set(v) { d.set.call(this, isNumIn(this) ? groupNum(v) : v); },
  });
  // while typing: regroup and keep the cursor after the same number of digits
  document.addEventListener('input', (e) => {
    const el = e.target; if (!isNumIn(el)) return;
    const raw = d.get.call(el); const caret = el.selectionStart == null ? raw.length : el.selectionStart;
    const sig = raw.slice(0, caret).replace(/[^\d.\-]/g, '').length; const out = groupNum(raw);
    if (out === raw) return; d.set.call(el, out);
    let pos = 0, n = 0; while (pos < out.length && n < sig) { if (/[\d.\-]/.test(out[pos])) n++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch (err) { }
  }, true);
  // boxes drawn from HTML strings: group their starting value
  const fix = (root) => { if (!root || !root.querySelectorAll) return; (root.matches && isNumIn(root) ? [root] : []).concat(Array.from(root.querySelectorAll('input[inputmode=numeric],input[inputmode=decimal]'))).forEach((el) => { if (isNumIn(el)) { const v = d.get.call(el); const g = groupNum(v); if (g !== v) d.set.call(el, g); } }); };
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && fix(n)))).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => fix(document.body));
})();

const baseCode = () => S().currency || 'XAF';
const curSym = (c) => { c = c || 'USD'; if (c === baseCode()) return baseSym(); const k = KC.CURRENCIES.find((x) => x[0] === c); return k ? k[1] : c; };
/** Amount in any currency (purchase side). Sales & reports always use F() = base currency. */
const money = (v, c) => { c = c || 'USD'; if (c === baseCode()) return F(v); const sym = curSym(c); const s2 = num(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return sym.length <= 2 ? sym + s2 : s2 + ' ' + sym; };
const CUR_NAME = { USD: 'US dollars', EUR: 'Euros', GBP: 'British pounds', CAD: 'Canadian dollars', CNY: 'Chinese yuan', AED: 'UAE dirhams', NGN: 'Naira' };
const curOptions = () => [[baseCode(), baseSym() + ' (local)']].concat(Object.keys(S().fxRates || { USD: 600 }).filter((c) => c !== baseCode()).map((c) => [c, curSym(c) + ' · ' + (CUR_NAME[c] || c)]));
const usd = (n) => '$' + num(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pct = (n) => (isFinite(n) ? Math.round(n) : 0) + '%';
const pad2 = (n) => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const monthStr = (d = new Date()) => d.getFullYear() + '-' + pad2(d.getMonth() + 1);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (s) => { if (!s) return '—'; const [y, m, d] = String(s).slice(0, 10).split('-'); return +d + ' ' + MONTHS[+m - 1] + ' ' + y; };
const fmtDT = (iso) => { if (!iso) return '—'; const d = new Date(iso); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const daysUntil = (s) => s ? Math.round((new Date(s + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 864e5) : null;
const initials = (s) => String(s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const S = () => K.C ? K.C.S : Object.assign({}, KC.DEFAULT_SETTINGS, K.raw.settings);
const can = (p) => !!K.perms[p];
/** is this feature in the business's plan? (this-device / trial: everything is) */
const has = (f) => KC.featureOn(K.info && K.info.features, f);
const hasAny = (...fs) => KC.anyOn(K.info && K.info.features, fs);
/** page classes nf-<feature> for each feature that is off — the stylesheet hides those features' buttons */
function featureClasses() { const f = (K.info && K.info.features) || {}; KC.FEATURE_KEYS.forEach((k) => document.body.classList.toggle('nf-' + k, f[k] === false)); }
const isAdmin = () => can('settings') || can('team');
const seeCost = () => can('costs');
const roleLabel = () => (KC.rolesWith(S().roles)[(K.member || {}).role] || { label: 'Custom' }).label;
/** Sales this person may see: all, or only the ones they made. */
const visibleSales = () => can('salesAll') ? K.raw.sales : K.raw.sales.filter((s) => s.createdById && s.createdById === K.me.id);
function resolveAccessInner() {
  let m;
  if (K.info.mode === 'local' || K.info.mode === 'single') m = { role: 'owner' };
  else if (K.info.mode === 'saas') m = { role: K.info.user.role, perms: K.info.user.perms };
  else if (K.info.isOwner) m = { role: 'owner' };
  else m = K.raw.members.find((x) => x.id === K.me.id && x.active !== false) || null;
  const F = K.info && K.info.features;
  const base = KC.featureOn(F, 'customRoles') ? KC.permsFor(m, S().roles) : KC.permsFor(m && { role: m.role, active: m.active }, {}); // no custom roles in the plan → standard roles only
  K.member = m; K.perms = KC.permsWithFeatures(base, F); featureClasses();
}
function resolveAccess() { resolveAccessInner(); if (K.member && K.info.mode === 'saas' && K.info.user.locationId) K.member = Object.assign({}, K.member, { locationId: K.info.user.locationId }); fixLoc(); }
const allLocs = () => [{ id: 'main', name: S().mainLocationName || 'Main warehouse' }].concat(K.raw.locations.filter((l) => !l.archived).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
const locName = (id) => (allLocs().find((l) => l.id === (id || 'main')) || { name: 'Main warehouse' }).name;
const myLocs = () => can('allLocations') ? allLocs() : allLocs().filter((l) => l.id === ((K.member && K.member.locationId) || 'main'));
function fixLoc() { const ok = myLocs(); if (!ok.find((l) => l.id === K.loc)) K.loc = (ok[0] || { id: 'main' }).id; try { localStorage.setItem('aahsso-loc', K.loc); } catch (e) { } }
try { K.loc = localStorage.getItem('aahsso-loc') || 'main'; } catch (e) { }
const imgSrc = (ref) => !ref ? '' : String(ref).startsWith('data:') ? ref : (K.store && K.store.imageUrl ? K.store.imageUrl(ref) : '');
const CAT_COLORS = ['#0d5c63', '#b7791f', '#2f6fb3', '#7a4bb3', '#c2412d', '#1f8a4c', '#8a5a12', '#4a5868'];
const catColor = (c) => { let h = 0; String(c || '').split('').forEach((ch) => (h = (h * 31 + ch.charCodeAt(0)) >>> 0)); return CAT_COLORS[h % CAT_COLORS.length]; };
const thumb = (p, size = 40, radius = 10) => { const src = imgSrc(p && p.image); return src ? '<img class="thumb" src="' + esc(src) + '" alt="" loading="lazy" style="width:' + size + 'px;height:' + size + 'px;border-radius:' + radius + 'px">' : '<div class="thumb ph" style="width:' + size + 'px;height:' + size + 'px;border-radius:' + radius + 'px;background:' + catColor(p && p.category) + '">' + esc(initials(p && p.name)) + '</div>'; };
const byId = (col, id) => K.raw[col].find((x) => x.id === id);
const phoneWA = (p) => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 9 && d[0] === '6') d = '237' + d; return d; };
const saleDate = (s) => (s.date || s.createdAt || '').slice(0, 10);

function recompute() { K.C = KC.computeAll(K.raw); }

/* ---------- icons ---------- */
const IP = {
  truck: '<path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  sell: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.2a2 2 0 002 1.6h8.2a2 2 0 002-1.6L21 7H6"/>',
  sales: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  stock: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  buy: '<path d="M6 7h12l1 13H5L6 7z"/><path d="M9 7a3 3 0 016 0"/>',
  ship: '<path d="M3 17l2 4h14l2-4"/><path d="M4 17V9h16v8"/><path d="M8 9V5h8v4"/><path d="M8 13h.01M12 13h.01M16 13h.01"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14a6 6 0 013.5 6"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', chev: '<path d="M9 6l6 6-6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  wa: '<path d="M3 21l1.6-4.7A8.5 8.5 0 1120.5 12 8.5 8.5 0 018 19.6L3 21z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1.2-1.2 1.8.8c-.2 1-1 1.7-2 1.7-3 0-6.5-3.5-6.5-6.5 0-1 .7-1.8 1.7-2l.8 1.8L9 9.5z"/>',
  dl: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>', up: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>', copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h8"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  barcode: '<path d="M4 5v14M7 5v14M10 5v14M14 5v14M17 5v14M20 5v14"/>', alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 015 .8c0 1.7-2.5 2.2-2.5 3.8M12 17.2h.01"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>', logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  check: '<path d="M5 12l5 5 9-11"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', back: '<path d="M15 6l-6 6 6 6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>', cam: '<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="3.5"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9-9-9z"/><circle cx="8" cy="8" r="1.5"/>', undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
};
const ic = (n, cls = '') => '<svg class="i ' + cls + '" viewBox="0 0 24 24">' + (IP[n] || '') + '</svg>';

/* ---------- toast / confirm ---------- */
function toast(msg, bad) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), bad ? 4200 : 2400);
}
function confirmBox(msg, okLabel = 'Confirm', danger) {
  return new Promise((res) => {
    const el = openSheet({ title: 'Please confirm', body: '<p style="margin:0;font-size:15px">' + esc(msg) + '</p>', foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn grow ' + (danger ? 'danger' : 'pri') + '" id="cbOk">' + esc(okLabel) + '</button>', onClose: () => res(false) });
    $('#cbOk', el).onclick = () => { el._onClose = null; closeSheet(); res(true); };
  });
}

/* ---------- sheets ---------- */
function openSheet({ title, body, foot, wide, onClose, back }) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  scrim.innerHTML = '<div class="sheet' + (wide ? ' wide' : '') + '"><div class="sh">' + (back ? '<button class="icon-btn" data-a="sheetClose">' + ic('back') + '</button>' : '') + '<h2 class="grow ellipsis">' + esc(title || '') + '</h2><button class="icon-btn" data-a="sheetClose" aria-label="Close">' + ic('x') + '</button></div><div class="sb">' + (body || '') + '</div>' + (foot ? '<div class="sf">' + foot + '</div>' : '') + '</div>';
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeSheet(); });
  scrim._onClose = onClose;
  if (K.tour && typeof endTour === 'function') endTour(); // the person started working: the tour steps aside
  document.body.appendChild(scrim); K.sheets.push(scrim);
  document.body.style.overflow = 'hidden';
  return scrim;
}
function closeSheet() {
  const s = K.sheets.pop(); if (!s) return;
  s.remove(); if (s._onClose) s._onClose();
  if (!K.sheets.length) { document.body.style.overflow = ''; flush(); }
}
function setSheetBody(el, html) { $('.sb', el).innerHTML = html; }
function formVals(root) {
  const o = {};
  $$('[name]', root).forEach((el) => { if (el.type === 'checkbox') o[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else o[el.name] = el.value.trim(); });
  return o;
}

/* ---------- persistence (with offline outbox) ---------- */
const OB_KEY = () => 'aahsso-outbox-' + (K.info.mode || '') + '-' + ((K.info.tenant && K.info.tenant.id) || '');
function loadOutbox() { try { K.outbox = JSON.parse(localStorage.getItem(OB_KEY()) || '[]'); } catch (e) { K.outbox = []; } }
function persistOutbox() { if (K.info && K.info.supportView) { shellSync(); return; } try { localStorage.setItem(OB_KEY(), JSON.stringify(K.outbox)); } catch (e) { } shellSync(); }
const isNetErr = (e) => !e || ['unavailable', 'timeout', 'network'].includes(e.code) || e.name === 'TypeError' || /failed to fetch|network|load failed/i.test(String(e.message || ''));
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: 'timeout' }), ms))]);
function enqueue(col, id, data) {
  K.outbox = K.outbox.filter((o) => !(o.col === col && o.id === id));
  K.outbox.push({ col, id, data, at: new Date().toISOString() }); persistOutbox();
}
let _flushing = false;
async function flushOutbox() {
  if (_flushing || !K.outbox.length || !K.store) return; _flushing = true;
  try {
    while (K.outbox.length) {
      const o = K.outbox[0];
      try { if (o.data) await withTimeout(K.store.put(o.col, o.id, o.data), 15000); else await withTimeout(K.store.del(o.col, o.id), 15000); K.outbox.shift(); persistOutbox(); }
      catch (e) {
        if (isNetErr(e)) break;
        K.outbox.shift(); persistOutbox();
        K.failed.push({ col: o.col, id: o.id, data: o.data, error: e.message || e.code, details: e.details });
        toast('A change made offline could not be saved: ' + (e.message || e.code) + (o.col === 'sales' && o.data ? ' (sale ' + o.data.no + ')' : ''), true);
        if (K.store._refresh) K.store._refresh(o.col);
      }
    }
  } finally { _flushing = false; shellSync(); }
  if (!K.outbox.length) scheduleRender();
}
setInterval(flushOutbox, 15000);
window.addEventListener('online', () => setTimeout(flushOutbox, 500));
/** Overlay not-yet-synced writes on top of data arriving from the server. */
function applyOutbox(col, docs) {
  const mine = K.outbox.filter((o) => o.col === col); if (!mine.length) return docs;
  const m = new Map(docs.map((d) => [d.id, d]));
  mine.forEach((o) => { if (o.data) m.set(o.id, Object.assign({ id: o.id }, o.data)); else m.delete(o.id); });
  return Array.from(m.values());
}
async function save(col, obj) {
  const prev = col === 'settings' ? JSON.parse(JSON.stringify(K.raw.settings || {})) : (K.raw[col] || []).find((x) => x.id === obj.id);
  const prevCopy = prev ? JSON.parse(JSON.stringify(prev)) : null;
  obj.updatedAt = new Date().toISOString();
  if (!obj.createdAt) obj.createdAt = obj.updatedAt;
  const logIt = (off) => logActivity(col, prevCopy, JSON.parse(JSON.stringify(obj)), off);
  if (col !== 'settings') { const arr = K.raw[col]; const i = arr.findIndex((x) => x.id === obj.id); if (i >= 0) arr[i] = obj; else arr.push(obj); recompute(); }
  const copy = JSON.parse(JSON.stringify(obj));
  if (K.outbox.length || navigator.onLine === false) { enqueue(col, obj.id, copy); flushOutbox(); cacheSoon(); logIt(true); return true; }
  try { await putWithApprovals(col, obj, copy); cacheSoon(); logIt(); return true; }
  catch (e) {
    if (e && e.code === 'not_approved') { if (K.store._refresh) K.store._refresh(col); toast('Not saved — no manager approved it', true); return false; }
    if (isNetErr(e)) { enqueue(col, obj.id, copy); toast('Saved on this phone — will sync when the network is back'); cacheSoon(); logIt(true); return true; }
    console.error(e);
    if (K.store._refresh) K.store._refresh(col);
    toast(e && e.code === 'quota_exceeded' ? 'Storage is full — export a backup and archive old records.' : 'Could not save: ' + (e.message || e.code || 'error') + (e.details ? ' — ' + e.details.join('; ') : ''), true);
    return false;
  }
}
/* ---------- manager approval on the spot ----------
 * When the server answers "approval_required" (cancel, refund, discount, credit over the limit…), a manager picks their
 * name and types their PIN on this phone; the save is then sent again with that approval. One approval per action. */
async function putWithApprovals(col, obj, copy) {
  const toks = [];
  for (let i = 0; ; i++) {
    try { return await withTimeout(K.store.put(col, obj.id, toks.length ? Object.assign({}, copy, { approval: toks }) : copy), 12000); }
    catch (e) {
      if (!(e && e.code === 'approval_required' && e.details) || i >= 4) throw e;
      const t = await askApproval(e.details); if (!t) throw Object.assign(new Error('Not approved'), { code: 'not_approved' });
      toks.push(t);
    }
  }
}
const canOrAsk = (p) => can(p) || (K.info.mode === 'saas' && (can('sell') || can('payments'))); // allowed, or may ask a manager
const APPROVE_WHAT = { cancel: 'Cancel a sale or delete a payment', returns: 'Return items / refund', discount: 'Discount or price below the minimum', credit: 'Sell over the credit limit' };
async function askApproval(d) {
  let list = []; try { list = (await K.store.req('GET', '/api/approvers?action=' + encodeURIComponent(d.action))).approvers || []; } catch (e) { }
  const ready = list.filter((a) => a.pin);
  return new Promise((res) => {
    const sh = openSheet({ title: 'Manager approval', body: '<div class="appr-what"><span class="appr-ic">' + ic('key') + '</span><div><b>' + esc(APPROVE_WHAT[d.action] || 'Approval') + '</b><div class="small">' + esc(d.message || '') + '</div></div></div>' +
      (ready.length ? '<p class="small muted">Ask a manager to choose their name and type their PIN on this phone.</p>' +
        field('Manager', sel('apBy', ready.map((a) => [a.id, a.name]), ready[0].id)) + field('PIN', '<input class="inp appr-pin" name="apPin" type="password" inputmode="numeric" data-nofmt autocomplete="off" maxlength="6" placeholder="••••">') +
        '<div class="appr-err tiny" role="alert"></div>'
        : '<div class="alert bad">Nobody can approve this yet. ' + (list.length ? esc(list.map((a) => a.name).join(', ')) + ' must first set an approval PIN in <b>My profile</b>.' : 'An owner must give someone the "Approve risky actions" permission and that person sets a PIN in <b>My profile</b>.') + '</div>'),
      foot: '<button class="btn grow" data-a="sheetClose">Cancel</button>' + (ready.length ? '<button class="btn pri grow" id="apOk">' + ic('check', 'sm') + 'Approve</button>' : ''), onClose: () => res(null) });
    sh.classList.add('appr-sheet');
    const pin = $('[name=apPin]', sh); if (pin) { setTimeout(() => pin.focus(), 60); pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#apOk', sh).click(); }); }
    if ($('#apOk', sh)) $('#apOk', sh).onclick = async () => {
      const v = formVals(sh); const errEl = $('.appr-err', sh); errEl.textContent = '';
      if (!/^\d{4,6}$/.test(v.apPin || '')) { errEl.textContent = 'Type the 4 to 6 digit PIN'; pin.focus(); return; }
      try {
        const r = await K.store.req('POST', '/api/approvals', { approverId: v.apBy, pin: v.apPin, action: d.action, ref: d.ref });
        sh._onClose = null; closeSheet(); toast('Approved by ' + r.by); res(r.approval);
      } catch (e) { errEl.textContent = e.message || 'Could not approve'; pin.value = ''; pin.focus(); }
    };
  });
}
async function remove(col, id) {
  const prev = (K.raw[col] || []).find((x) => x.id === id); if (prev) logActivity(col, JSON.parse(JSON.stringify(prev)), null);
  K.raw[col] = K.raw[col].filter((x) => x.id !== id); recompute();
  if (K.outbox.length || navigator.onLine === false) { enqueue(col, id, null); flushOutbox(); return true; }
  try { await withTimeout(K.store.del(col, id), 12000); return true; }
  catch (e) { if (isNetErr(e)) { enqueue(col, id, null); return true; } toast('Could not delete: ' + (e.message || e.code), true); return false; }
}
/* cached copy of the data so the app opens instantly and keeps working when the connection drops */
const CACHE_KEY = () => 'aahsso-cache-' + (K.info.mode || '') + '-' + ((K.info.tenant && K.info.tenant.id) || '') + '-' + (K.me.id || '');
let _ct; function cacheSoon() { if (K.info && K.info.supportView) return; clearTimeout(_ct); _ct = setTimeout(() => { try { localStorage.setItem(CACHE_KEY(), JSON.stringify({ at: new Date().toISOString(), raw: K.raw })); } catch (e) { try { const lite = Object.assign({}, K.raw, { products: K.raw.products.map((p) => Object.assign({}, p, { image: String(p.image || '').startsWith('data:') ? '' : p.image })) }); localStorage.setItem(CACHE_KEY(), JSON.stringify({ at: new Date().toISOString(), raw: lite })); } catch (e2) { } } }, 1500); }
function loadCache() { if (K.info && K.info.supportView) return null; try { const c = JSON.parse(localStorage.getItem(CACHE_KEY()) || 'null'); if (c && c.raw) { Object.keys(K.raw).forEach((k) => { if (c.raw[k] !== undefined) K.raw[k] = c.raw[k]; }); return c.at; } } catch (e) { } return null; }
function shellSync() {
  const el = document.getElementById('sync'); if (!el) return;
  const n = K.outbox.length;
  if (n) { el.innerHTML = '<span class="dot warn"></span>' + n + ' to sync'; el.title = 'Saved on this phone. Will upload automatically when online.'; return; }
  const dot = K.sync === 'ok' ? '' : K.sync === 'local' ? 'warn' : K.sync === 'err' || K.sync === 'offline' ? 'bad' : 'warn';
  el.innerHTML = '<span class="dot ' + dot + '"></span>' + ({ ok: 'Synced', local: 'This device only', err: 'Offline', offline: 'Offline copy', loading: 'Loading…' }[K.sync] || '');
}
async function saveMany(col, list) { let ok = 0; for (const o of list) { if (await save(col, o)) ok++; } return ok; }

/* ---------- files (download / upload) ---------- */
async function saveFile(filename, blob) {
  if (window.claude && window.claude.use && !(window.AAHSSO_CONFIG && window.AAHSSO_CONFIG.api !== undefined)) {
    try {
      const d = await window.claude.use('downloads');
      if (d) { await d.save({ filename, data: blob }); return; }
    } catch (e) { if (e && e.code !== 'not_granted') { toast('Download was cancelled or refused'); return; } }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
/** Open the file chooser. Resolves with the file, or null if the person cancels (so buttons stop loading). */
function chooseFile(accept, capture) {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; if (capture) i.setAttribute('capture', capture);
    let done = false; const finish = (f) => { if (done) return; done = true; window.removeEventListener('focus', onFocus); res(f); };
    // older browsers have no 'cancel' event: when the window gets focus back and nothing was chosen, treat it as cancel
    const onFocus = () => setTimeout(() => { if (!i.files || !i.files.length) finish(null); }, 800);
    i.onchange = () => finish(i.files[0] || null);
    i.addEventListener('cancel', () => finish(null));
    setTimeout(() => window.addEventListener('focus', onFocus), 300);
    i.click();
  });
}
function pickFile(accept) { return chooseFile(accept); }
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Copied — paste it in WhatsApp'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Copy failed — long-press to copy', true); }
    ta.remove();
  }
}
function xlsxDownload(filename, sheets) { // sheets: {name: rows[]}
  if (!window.XLSX) { toast('Excel library still loading — try again in a moment', true); return; }
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([n, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': '' }]), n.slice(0, 31)));
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveFile(filename, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

/* ---------- navigation ---------- */
const NAV = [
  ['home', 'Home', 'home', () => true], ['sell', 'Sell', 'sell', () => can('sell')], ['sales', 'Sales', 'sales', () => can('sell') || can('salesAll') || can('payments')],
  ['orders', 'Online orders', 'sell', () => can('sell') || can('payments'), () => (K.raw.orders || []).filter((o) => o.status === 'new').length],
  ['stock', 'Stock & prices', 'stock', () => can('stockView') || can('stockEdit')], ['buy', 'Buy', 'buy', () => can('purchases')], ['ship', 'Ship', 'ship', () => can('containers')], ['receive', 'Receive', 'check', () => can('containers')],
  ['customers', 'Customers', 'users', () => can('customers') || can('sell')], ['reports', 'Reports', 'chart', () => can('reports')], ['expenses', 'Expenses', 'wallet', () => can('expenses')],
  ['cash', 'Cash handover', 'wallet', () => can('payments') || can('handover'), () => (K.raw.tills || []).filter((t) => t.toId === K.me.id && t.status === 'pending').length], ['suppliers', 'Suppliers & bills', 'buy', () => can('suppliers')], ['reminders', 'Debt reminders', 'wa', () => can('reminders')],
  ['assets', 'Assets', 'truck', () => can('assets')],
  ['claims', 'Returns & claims', 'undo', () => can('suppliers') || can('purchases') || can('containers') || can('stockEdit'), () => (K.raw.claims || []).filter((c) => c.status !== 'closed').length],
  ['transfers', 'Branch transfers', 'ship', () => can('transfers') || (allLocs().length > 1 && K.raw.transfers.some((t) => t.status === 'in_transit' && t.to === K.loc))],
  ['audit', 'Stock count', 'check', () => can('audit') || can('stockEdit')],
  ['losses', 'Losses', 'alert', () => can('lossReport') || can('stockEdit') || can('reports'), () => can('stockEdit') ? (K.raw.losses || []).filter((l) => l.status === 'pending').length : 0],
  ['promos', 'Promotions', 'tag', () => can('stockView') || can('stockEdit')],
  ['activity', 'Activity log', 'clock', () => true],
  ['staff', 'Attendance', 'clock', () => true],
  ['leave', 'Leave', 'clock', () => true, () => can('hr') ? (K.raw.leaves || []).filter((l) => l.status === 'requested').length : 0],
  ['payroll', 'Payroll', 'wallet', () => true],
  ['employees', 'Employees', 'users', () => can('hr') || can('payroll')],
  ['profile', 'My profile', 'user', () => true], ['billing', 'Billing & subscription', 'card', () => K.info.mode === 'saas' && canBilling()], ['plans', 'Choose your plan', 'card', () => K.info.mode === 'saas' && canBilling()], ['help', 'Help & support', 'help', () => true],
  ['team', 'Team & access', 'key', () => can('team')], ['settings', 'Settings', 'gear', () => can('settings') || can('export')],
];
const navOk = (r) => { if (!KC.routeFeatureOn(K.info && K.info.features, r)) return false; const n = NAV.find((x) => x[0] === r); return !n || n[3](); }; // pages of features outside the plan do not exist
/* The menu: 9 places. Related pages live as tabs inside one place (e.g. Sell = New sale · Sales · Online orders). */
const SECTIONS = [
  ['home', 'Home', 'home', ['home']],
  ['buy', 'Buy', 'buy', ['buy']],
  ['ship', 'Ship', 'ship', ['ship']],
  ['receive', 'Receive', 'check', ['receive']],
  ['sell', 'Sell', 'sell', ['sales', 'orders']],
  ['stock', 'Stock', 'stock', ['stock', 'promos', 'audit', 'losses', 'transfers']],
  ['customers', 'Customers', 'users', ['customers', 'reminders']],
  ['money', 'Money', 'wallet', ['expenses', 'cash', 'suppliers', 'claims', 'reports', 'assets']],
  ['people', 'Staff', 'clock', ['staff', 'leave', 'payroll', 'employees']],
  ['settings', 'Settings', 'gear', ['settings', 'team', 'activity']],
];
const TAB_LABEL = { sales: 'Sales', orders: 'Online orders', stock: 'Stock & prices', promos: 'Promotions', transfers: 'Branch transfers', audit: 'Stock count', losses: 'Losses', claims: 'Returns & claims', customers: 'Customers', reminders: 'Debt reminders', expenses: 'Expenses', cash: 'Cash handover', suppliers: 'Bills to pay', reports: 'Reports', assets: 'Assets', settings: 'Business', team: 'Team', activity: 'Activity log', staff: 'Attendance', leave: 'Leave', payroll: 'Payroll', employees: 'Employees' };
/** Routes of a section this person can open (transfers only when there is more than one branch). */
const secRoutes = (sec) => sec[3].filter((r) => navOk(r) && (r !== 'transfers' || allLocs().length > 1));
const secOf = (r) => SECTIONS.find((x) => x[3].includes(r)) || SECTIONS[0];
const secCount = (sec) => secRoutes(sec).reduce((a, r) => { const n = NAV.find((x) => x[0] === r); return a + (n && n[4] ? n[4]() || 0 : 0); }, 0);
const TITLES = Object.assign(Object.fromEntries(NAV.map((n) => [n[0], n[1]])), { pending: 'Access' });
/** Tabs at the top of a page whose section has several pages. */
function subTabs(r) {
  const sec = secOf(r); const rs = secRoutes(sec); if (rs.length < 2) return '';
  return '<nav class="subtabs" aria-label="' + esc(sec[1]) + '">' + rs.map((x) => { const n = NAV.find((y) => y[0] === x); const c = n && n[4] ? n[4]() : 0; return '<a href="#' + x + '" class="' + (x === r ? 'on' : '') + '"' + (x === r ? ' aria-current="page"' : '') + '>' + esc(TAB_LABEL[x] || TITLES[x]) + (c ? '<span class="nav-count">' + c + '</span>' : '') + '</a>'; }).join('') + '</nav>';
}
const ROUTE_ALIAS = { containers: 'ship', purchases: 'buy' }; // old links keep working
function go(r) { if (location.hash !== '#' + r) location.hash = r; else route(); }
function route() {
  const closeAll = () => { while (K.sheets.length) { const t = K.sheets.pop(); t.remove(); } document.body.style.overflow = ''; };
  let r = (location.hash || '#home').slice(1) || 'home';
  r = ROUTE_ALIAS[r] || r;
  // New sale is a modal: #sell opens it over the page you were on
  let openSale = false;
  if (r === 'sell') { openSale = true; r = K.route && VIEWS[K.route] && K.route !== 'pending' ? K.route : 'sales'; try { history.replaceState(null, '', '#' + r); } catch (e) { } }
  if (!VIEWS[r]) r = 'home';
  if (!K.member) r = 'pending';
  else if (!navOk(r)) r = 'home';
  // a real page change closes open windows; re-checking access on the same page (e.g. just after loading) keeps them
  if (K.route !== r || openSale || !K.sheets.length) closeAll();
  const same = K.route === r && openSale; K.route = r; if (!same) { window.scrollTo(0, 0); render(true); }
  if (openSale && K.member && can('sell')) A.newSale();
}
function logoHTML(cls = 'logo') { const s = S(); return '<div class="' + cls + '">' + (s.logo ? '<img src="' + esc(s.logo) + '" alt="">' : esc(initials(s.businessName).slice(0, 2))) + '</div>'; }
const navCount = (n) => { const c = n[4] ? n[4]() : 0; return c ? '<span class="nav-count" aria-label="' + c + ' new">' + c + '</span>' : ''; };
function shell() {
  const s = S();
  $('#side').innerHTML = '<div class="brandbox">' + logoHTML() + '<div><div class="bn">' + esc(s.businessName) + '</div><div class="tiny" style="color:#93a2b0">Import & sales manager</div></div></div>' +
    '<div class="navs">' + SECTIONS.map((sec) => { const rs = secRoutes(sec); if (!rs.length) return ''; const c = secCount(sec); return '<a class="nav' + (sec[3].includes(K.route) ? ' on' : '') + '" href="#' + rs[0] + '">' + ic(sec[2]) + sec[1] + (c ? '<span class="nav-count" aria-label="' + c + ' new">' + c + '</span>' : '') + '</a>'; }).join('') + '</div>' +
    '<div class="sp"></div><div class="who">' + esc(K.me.name || K.info.userLabel || '') + ' · ' + esc(roleLabel()) + '</div>';
  drawAvatar();
  if (!K.member) { $('#bnav').innerHTML = ''; $('#side').innerHTML = '<div class="brandbox">' + logoHTML() + '<div class="bn">' + esc(s.businessName) + '</div></div>'; $('#title').textContent = 'Access'; $('#tlogo').outerHTML = logoHTML('logo tlogo').replace('class="logo tlogo"', 'class="logo tlogo" id="tlogo"'); return; }
  const bn = [['home', 'Home', 'home'], ['buy', 'Buy', 'buy'], ['sell', 'Sell', 'sell'], ['stock', 'Stock', 'stock'], ['more', 'More', 'more']].filter((n) => n[0] === 'more' || navOk(n[0]));
  const inSec = SECTIONS.some((x) => x[3].includes(K.route)); // account pages (profile, billing, help) belong to no section
  const cur = inSec ? secOf(K.route)[0] : ''; const moreOn = inSec && !['home', 'buy', 'sell', 'stock'].includes(cur);
  $('#bnav').innerHTML = bn.map((n) => n[0] === 'more'
    ? '<a href="#" data-a="moreMenu" class="' + (moreOn ? 'on' : '') + '">' + ic('more') + '<span>More</span></a>'
    : '<a href="#' + n[0] + '" class="' + (n[0] === 'sell' ? 'sell ' : '') + (cur === n[0] ? 'on' : '') + '"><div class="ic">' + ic(n[2]) + '</div><span>' + n[1] + '</span></a>').join('');
  $('#tlogo').outerHTML = logoHTML('logo tlogo').replace('class="logo tlogo"', 'class="logo tlogo" id="tlogo"');
  $('#title').textContent = secOf(K.route)[1] === 'Home' && K.route !== 'home' ? TITLES[K.route] || '' : K.route === 'pending' ? 'Access' : secOf(K.route)[1];
  shellSync();
  if (K.tour && typeof tourMark === 'function') setTimeout(tourMark, 0);
  const lb = $('#locBtn'); if (lb) { const L = myLocs(); lb.classList.toggle('hide', allLocs().length < 2 || !has('branches')); lb.disabled = L.length < 2; lb.innerHTML = ic('home', 'sm') + '<span class="ellipsis" style="max-width:110px">' + esc(locName(K.loc)) + '</span>'; }
}

/* ---------- render ---------- */
function render(force) {
  if (force) K.viewDirty = false;
  // a form screen (e.g. Settings) with unsaved typing is never redrawn underneath the user
  if (!force && K.viewDirty) { K.pending = true; return; }
  if (!force && (K.sheets.length || (document.activeElement && document.activeElement.closest && document.activeElement.closest('#view') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)))) { K.pending = true; return; }
  K.pending = false;
  if (!K.C) recompute();
  shell();
  const v = VIEWS[K.route];
  $('#view').innerHTML = subTabs(K.route) + v.render();
  if (v.after) v.after();
  $('#fab').classList.toggle('hide', !['home', 'sales', 'customers'].includes(K.route));
}
let _rt; function scheduleRender() { clearTimeout(_rt); _rt = setTimeout(() => render(), 60); }
function flush() { if (K.pending) render(); }
function refreshSheets() { K.sheets.forEach((s) => s._refresh && s._refresh()); }
document.addEventListener('focusout', () => setTimeout(() => { if (!K.sheets.length) flush(); }, 250));

/* ---------- event delegation ---------- */
const A = {}; const I = {}; const CH = {};

/* ---------- loading state for EVERY button ----------
 * Whenever a click handler returns a promise (saving, signing in, uploading, exporting, waiting for a confirm…)
 * the clicked button goes into a loading state until the work is done: it is disabled at once (no double
 * submits), shows a spinner if the work takes more than a moment, and is marked aria-busy for screen readers.
 * Works for both data-a actions and buttons wired with `.onclick = async () => …` — no per-button code needed. */
const BUSY_MAX_MS = 120000; // safety net: never leave a button stuck if a promise never settles
function setBusy(el, on, wasDisabled) {
  if (!el) return;
  if (on) {
    if (el.dataset.busy) return;
    // remember the state from BEFORE the click: some handlers disable their own button first, and restoring
    // that would leave the button dead after a validation error
    el.dataset.busy = '1'; el._busyWasDisabled = wasDisabled === undefined ? !!el.disabled : !!wasDisabled;
    if ('disabled' in el) el.disabled = true;
    el.classList.add('is-busy'); el.setAttribute('aria-busy', 'true');
    el._busyT = setTimeout(() => setBusy(el, false), BUSY_MAX_MS);
  } else {
    if (!el.dataset.busy) return;
    delete el.dataset.busy; clearTimeout(el._busyT);
    if ('disabled' in el) el.disabled = el._busyWasDisabled;
    el.classList.remove('is-busy'); el.removeAttribute('aria-busy');
  }
}
/** If `ret` is a promise, keep `el` busy until it settles. Returns `ret` unchanged. */
function withBusy(el, ret, wasDisabled) {
  if (!el || !ret || typeof ret.then !== 'function') return ret;
  setBusy(el, true, wasDisabled);
  const done = () => setBusy(el, false);
  ret.then(done, done);
  return ret;
}
// buttons wired with el.onclick = async … : wrap the handler just before it runs (capture phase comes first)
document.addEventListener('click', (e) => {
  for (let n = e.target; n && n !== document; n = n.parentNode) {
    if (n.dataset && n.dataset.busy) { e.preventDefault(); e.stopImmediatePropagation(); return; } // already working
    const h = n.onclick;
    if (typeof h === 'function' && !h._busyWrapped) {
      const owner = n;
      const w = function (ev) { const was = !!owner.disabled; return withBusy(owner, h.call(this, ev), was); };
      w._busyWrapped = true; owner.onclick = w;
    }
  }
}, true);
// data-a actions
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const fn = A[el.dataset.a]; if (!fn) return;
  e.preventDefault(); e.stopPropagation();
  if (el.dataset.busy) return;
  const was = !!el.disabled;
  withBusy(el, fn(el, e), was);
});
['input', 'change'].forEach((ev) => document.addEventListener(ev, (e) => { if (e.target.closest && e.target.closest('#view') && VIEWS[K.route] && VIEWS[K.route].form && !e.target.closest('[data-a]')) K.viewDirty = true; }));
document.addEventListener('input', (e) => { const el = e.target.closest('[data-i]'); if (el && I[el.dataset.i]) I[el.dataset.i](el, e); });
document.addEventListener('change', (e) => { const el = e.target.closest('[data-c]'); if (el && CH[el.dataset.c]) CH[el.dataset.c](el, e); });
A.sheetClose = () => closeSheet();
A.go = (el) => { closeSheet(); go(el.dataset.r); };
A.toggleX = (el) => { const k = el.dataset.k; K.ui.expanded[k] = !K.ui.expanded[k]; render(true); };
A.moreMenu = () => {
  const list = SECTIONS.filter((sec) => !['home', 'buy', 'sell', 'stock'].includes(sec[0]) && secRoutes(sec).length);
  openSheet({ title: 'More', body: '<div class="card list">' + list.map((sec) => { const c = secCount(sec); return '<div class="li" data-a="go" data-r="' + secRoutes(sec)[0] + '"><div class="av ink">' + ic(sec[2]) + '</div><div class="grow t">' + sec[1] + '</div>' + (c ? '<span class="nav-count">' + c + '</span>' : '') + ic('chev', 'sm') + '</div>'; }).join('') + '</div>' });
};
const VIEWS = {};

/* small UI bits */
const kpi = (l, v, s, hero) => '<div class="card kpi' + (hero ? ' hero' : '') + '"><div class="l">' + l + '</div><div class="v money">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
const statusBadge = (st) => ({ paid: '<span class="badge ok">Paid</span>', partial: '<span class="badge warn">Deposit</span>', unpaid: '<span class="badge bad">Unpaid</span>', cancelled: '<span class="badge">Cancelled</span>' }[st] || '');
const sel = (name, opts, val, extra = '') => '<select class="inp" name="' + name + '" ' + extra + '>' + opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return '<option value="' + esc(v) + '"' + (String(v) === String(val ?? '') ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') + '</select>';
const field = (label, inner, cls = '') => '<label class="f ' + cls + '">' + label + inner + '</label>';
const inp = (name, val, attrs = '') => '<input class="inp" name="' + name + '" value="' + esc(val ?? '') + '" ' + attrs + '>';
const expiryBadge = (d) => { if (!d) return ''; const n = daysUntil(d); const w = num(S().expiryWarnDays) || 60; return n < 0 ? '<span class="badge bad">Expired ' + fmtDate(d) + '</span>' : n <= 30 ? '<span class="badge bad">Exp. ' + fmtDate(d) + '</span>' : n <= w ? '<span class="badge warn">Exp. ' + fmtDate(d) + '</span>' : '<span class="badge">Exp. ' + fmtDate(d) + '</span>'; };

/* ---------- photos ---------- */
async function resizeImage(file, max, q) {
  const url = URL.createObjectURL(file); const img = new Image(); img.src = url;
  try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw new Error('Could not read that image'); }
  const r = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
  c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return { dataUrl: c.toDataURL('image/jpeg', q), blob: await new Promise((res) => c.toBlob(res, 'image/jpeg', q)) };
}
/** Store a photo: uploads to file storage when available, else keeps a small inline copy. Returns the ref to save on the product. */
async function storePhoto(file) {
  const big = await resizeImage(file, 640, 0.78);
  if (K.store.uploadImage) { try { const id = await K.store.uploadImage(big.blob); if (id) return id; } catch (e) { console.warn('upload failed, using inline photo', e); } }
  return (await resizeImage(file, 260, 0.72)).dataUrl;
}
function photoPicker() { if (!has('photos')) { toast('Photos are not included in your plan', true); return Promise.resolve(null); } return chooseFile('image/*', 'environment'); }

document.addEventListener('error', (e) => { const t = e.target; if (t && t.tagName === 'IMG' && (t.classList.contains('thumb') || t.closest('.pimg'))) t.style.visibility = 'hidden'; }, true);

A.pickLoc = () => {
  const L = myLocs(); if (L.length < 2) return;
  openSheet({ title: 'Working at', body: '<div class="card list">' + L.map((l) => '<div class="li" data-a="setLoc" data-id="' + l.id + '"><div class="av' + (l.id === K.loc ? '' : ' ink') + '">' + ic('home', 'sm') + '</div><div class="grow t">' + esc(l.name) + '</div>' + (l.id === K.loc ? ic('check') : '') + '</div>').join('') + '</div><div class="tiny muted mt">Sales and stock counts use this location.</div>' });
};
A.setLoc = (el) => { K.loc = el.dataset.id; fixLoc(); closeSheet(); render(true); toast('Now working at ' + locName(K.loc)); };

/* ---------- activity log (hosted & this-device modes; the SaaS server keeps its own tamper-proof log) ---------- */
const DEVICE = (() => { try { let d = localStorage.getItem('aahsso-device'); if (!d) { d = 'd' + Math.random().toString(36).slice(2, 8); localStorage.setItem('aahsso-device', d); } return d; } catch (e) { return 'd0'; } })();
const actLookups = () => ({ product: (id) => (byId('products', id) || {}).name || 'item', customer: (id) => (byId('customers', id) || {}).name || 'customer', loc: (id) => locName(id), ship: (id) => (byId('shipments', id) || {}).name || 'container', supplier: (id) => (byId('suppliers', id) || {}).name || 'supplier', asset: (id) => (byId('assets', id) || {}).name || 'asset', role: (k) => (KC.rolesWith(S().roles)[k] || {}).label, F, money });
const logPath = (uidv) => 'log/' + String(uidv || 'anon').replace(/[^A-Za-z0-9_\-.:@+~]/g, '_') + '/d';
let _logT;
function logActivity(col, before, after, offline) {
  if (K.info.mode === 'saas' || !K.store || String(col).startsWith('log/') || col === 'requests') return;
  let lines; try { lines = KC.describeChange(col, before, after, actLookups()); } catch (e) { console.warn('describe', e); return; }
  if (!lines.length) return;
  const now = new Date(); const date = todayStr(now); const docId = date + '_' + DEVICE; const key = 'aahsso-log-' + docId + '-' + (K.me.id || '');
  let doc; try { doc = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { }
  if (!doc) doc = K._logDoc && K._logDoc.id === docId ? K._logDoc : { id: docId, date, uid: K.me.id || '', user: K.me.name || '', device: DEVICE, entries: [] };
  lines.forEach((l) => doc.entries.push(Object.assign({ at: now.toISOString(), uid: K.me.id || '', user: K.me.name || 'Owner', role: roleLabel(), loc: K.loc, col, id: (after || before || {}).id || '', device: DEVICE, offline: !!offline || navigator.onLine === false }, l)));
  if (doc.entries.length > 1500) doc.entries = doc.entries.slice(-1500);
  K._logDoc = doc; try { localStorage.setItem(key, JSON.stringify(doc)); } catch (e) { }
  clearTimeout(_logT); _logT = setTimeout(() => { const d = JSON.parse(JSON.stringify(K._logDoc)); const path = logPath(K.me.id); withTimeout(K.store.put(path, d.id, d), 12000).catch((e) => { if (isNetErr(e)) enqueue(path, d.id, d); }); }, 1500);
}
async function askReason(title, options, okLabel) {
  return new Promise((res) => {
    const sh = openSheet({ title, body: '<div class="col">' + field('Reason', sel('rsn', options, options[0])) + field('Details (optional)', inp('rsnNote', '')) + '</div>', foot: '<button class="btn grow" data-a="sheetClose">Back</button><button class="btn pri grow" id="rsnOk">' + esc(okLabel || 'Continue') + '</button>', onClose: () => res(null) });
    $('#rsnOk', sh).onclick = () => { const v = formVals(sh); sh._onClose = null; closeSheet(); res([v.rsn, v.rsnNote].filter(Boolean).join(' · ')); };
  });
}

/* ================= data tables (one component for every list in the app) =================
 * One value per column. Each table has a Compact view (the key columns, marked core) and a Full view (every column),
 * remembered per table on this device. Click a header to sort. Numbers are right-aligned with even-width digits.
 *
 * dataTable({
 *   id,                       unique id (also the wrapper element's id)
 *   rows,                     array of records
 *   cols: [{ k, label,        column key + header
 *            v: (r) => value, raw value — used for sorting and as the cell text when no html()
 *            html: (r) => '',  optional cell html (one value: text, a badge, a link…)
 *            num | money,      right-aligned numbers (money: formatted with fmt())
 *            core,             shown in Compact view
 *            wrap,             allow 2 lines (long text such as item lists); otherwise one line with … and a tooltip
 *            total: (rows) => html for the footer }],
 *   rowAttr: (r) => ' data-a="…" data-id="…"',  makes rows clickable
 *   rowClass: (r) => '',      e.g. 'cx' for cancelled
 *   expand: { key: (r) => 'k', html: (r) => '' },  optional detail row (toggled with data-a="toggleX")
 *   empty: 'html when there are no rows', limit: 300, footLabel: 'Total' })
 */
const DT_STORE = 'aahsso-tables';
function dtPrefs() { if (!K.ui.dt) { try { K.ui.dt = JSON.parse(localStorage.getItem(DT_STORE) || '{}') || {}; } catch (e) { K.ui.dt = {}; } } return K.ui.dt; }
function dtSet(id, patch) { const p = dtPrefs(); p[id] = Object.assign({}, p[id], patch); try { localStorage.setItem(DT_STORE, JSON.stringify(p)); } catch (e) { } }
const dtMode = (id) => (dtPrefs()[id] || {}).mode || 'compact';
function dataTable(cfg) {
  const { id, rows } = cfg; const pref = dtPrefs()[id] || {};
  const mode = cfg.bar === false ? 'compact' : dtMode(id); // a plain small table: its key columns only, no view switch
  const allCols = cfg.cols.filter(Boolean);
  const cols = mode === 'full' ? allCols : allCols.filter((c) => c.core);
  const hidden = allCols.length - cols.length;
  const cellText = (c, r) => { const v = c.v ? c.v(r) : ''; return v === null || v === undefined || v === '' ? '' : String(v); };
  let list = rows.slice();
  const sc = pref.sort && allCols.find((c) => c.k === pref.sort.k);
  if (sc) {
    const dir = pref.sort.dir === 'desc' ? -1 : 1;
    list.sort((a, b) => { const x = sc.v ? sc.v(a) : '', y = sc.v ? sc.v(b) : ''; if (x === y) return 0; if (x === '' || x === null || x === undefined) return 1; if (y === '' || y === null || y === undefined) return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' })) * dir; });
  }
  const limit = cfg.limit || 300; const shown = list.slice(0, limit);
  const isNum = (c) => c.num || c.money;
  const cell = (c, r) => {
    let inner;
    if (c.html) inner = c.html(r);
    else { const v = c.v ? c.v(r) : ''; inner = v === null || v === undefined || v === '' ? '<span class="dt-nil">—</span>' : c.money ? fmt(v) : typeof v === 'number' ? fmt(v) : esc(v); }
    const t = !isNum(c) && !c.html ? cellText(c, r) : '';
    return '<td class="' + [isNum(c) ? 'n' : '', c.wrap ? 'w' : '', c.cls || ''].filter(Boolean).join(' ') + '"' + (t && t.length > 18 ? ' title="' + esc(t) + '"' : '') + '>' + (c.wrap ? '<span class="dt-clamp">' + inner + '</span>' : inner) + '</td>';
  };
  const head = cols.map((c) => { const on = sc && sc.k === c.k; return '<th class="' + (isNum(c) ? 'n' : '') + (on ? ' on' : '') + '" data-a="dtSort" data-t="' + id + '" data-k="' + c.k + '" aria-sort="' + (on ? (pref.sort.dir === 'desc' ? 'descending' : 'ascending') : 'none') + '" title="Sort by ' + esc(c.label) + '">' + esc(c.label) + '<span class="dt-arrow">' + (on ? (pref.sort.dir === 'desc' ? '▼' : '▲') : '') + '</span></th>'; }).join('');
  const body = shown.map((r) => {
    const open = cfg.expand && K.ui.expanded[cfg.expand.key(r)];
    return '<tr class="' + [cfg.rowClass ? cfg.rowClass(r) : '', open ? 'open' : ''].filter(Boolean).join(' ') + '"' + (cfg.rowAttr ? cfg.rowAttr(r) : '') + '>' + cols.map((c) => cell(c, r)).join('') + '</tr>' +
      (open ? '<tr class="dt-detail"><td colspan="' + cols.length + '">' + cfg.expand.html(r) + '</td></tr>' : '');
  }).join('');
  const hasFoot = cols.some((c) => c.total);
  const foot = hasFoot ? '<tfoot><tr>' + cols.map((c, i) => '<td class="' + (isNum(c) ? 'n' : '') + '">' + (c.total ? c.total(list) : i === 0 ? (cfg.footLabel || 'Total') + ' · ' + fmt(list.length) : '') + '</td>').join('') + '</tr></tfoot>' : '';
  const bar = cfg.bar === false ? '' : '<div class="dt-bar"><span class="dt-count">' + fmt(list.length) + ' ' + (cfg.noun || 'row') + (list.length === 1 ? '' : 's') + (list.length > limit ? ' · showing first ' + limit : '') + '</span>' +
    '<span class="dt-cols">' + (hidden ? hidden + ' more column' + (hidden === 1 ? '' : 's') + ' in Full view' : mode === 'full' && allCols.some((c) => !c.core) ? 'All ' + allCols.length + ' columns' : '') + '</span>' +
    (allCols.some((c) => !c.core) ? '<div class="seg dt-mode" role="group" aria-label="Table view"><button type="button" class="' + (mode === 'compact' ? 'on' : '') + '" data-a="dtMode" data-t="' + id + '" data-v="compact" aria-pressed="' + (mode === 'compact') + '">Compact</button><button type="button" class="' + (mode === 'full' ? 'on' : '') + '" data-a="dtMode" data-t="' + id + '" data-v="full" aria-pressed="' + (mode === 'full') + '">Full view</button></div>' : '') + '</div>';
  return '<div class="card dt dt-' + mode + '" id="' + id + '">' + bar +
    (rows.length ? '<div class="dt-scroll"><table class="dt-t"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>' + foot + '</table></div>' : '<div class="empty">' + (cfg.empty || 'Nothing here yet.') + '</div>') + '</div>';
}
/** Redraw only one table (sorting / view toggle) without losing what is typed elsewhere on the page. */
const DT_REDRAW = {}; // id → function, for tables drawn outside a view's render() (e.g. loaded from the server)
function dtRefresh(id) {
  if (DT_REDRAW[id] && document.getElementById(id)) return DT_REDRAW[id]();
  const old = document.getElementById(id); if (!old || !VIEWS[K.route]) return render(true);
  const sheet = old.closest('.scrim');
  if (sheet && sheet._refresh) return sheet._refresh();
  const tmp = document.createElement('div'); tmp.innerHTML = VIEWS[K.route].render();
  const neu = tmp.querySelector('#' + CSS.escape(id)); if (neu) old.replaceWith(neu); else render(true);
}
A.dtMode = (el) => { dtSet(el.dataset.t, { mode: el.dataset.v }); dtRefresh(el.dataset.t); };
A.dtSort = (el) => {
  const id = el.dataset.t, k = el.dataset.k; const cur = (dtPrefs()[id] || {}).sort;
  // asc → desc → original order
  const next = !cur || cur.k !== k ? { k, dir: 'asc' } : cur.dir === 'asc' ? { k, dir: 'desc' } : null;
  dtSet(id, { sort: next }); dtRefresh(id);
};
/* small cell helpers */
const dtDate = (d) => d ? '<span class="nowrap">' + esc(fmtDate(d)) + '</span>' : '<span class="dt-nil">—</span>';
const dtNil = '<span class="dt-nil">—</span>';
const dtSum = (rows, f) => rows.reduce((a, r) => a + (num(f(r)) || 0), 0);
