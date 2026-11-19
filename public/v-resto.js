/* Aahsso Bar & Resto — tables, QR orders, waiters, kitchen & bar screens, menu, bills, reservations.
 * Records (all through the normal data API, so they sync, work offline and show in the activity log):
 *   menu         {name, category, price, station, kind: plain|stock|portion|recipe, uses:[{productId, qty}], desc, photo, soldOut, active}
 *   areas        {name, waiterIds:[userId]}            tables {label, seats, areaId, token, waiterId, call:{kind, at}}
 *   tabs         {tableId, tableLabel, status: open|paid|merged|void, customerName, waiterId, openedAt, billAskedAt, saleIds, deposit}
 *   rorders      {no, tabId, tableId, tableLabel, source: qr|staff|counter, customerName, waiterIds, waiterId, status: new|accepted|ready|served|rejected, lines, st:{kitchen,bar}}
 *   reservations {name, phone, date, time, people, areaId, tableId, deposit, depositMethod, status, note}
 * Paying a tab writes a normal sale (menu lines take their ingredients from stock), so stock, reports, cash and receipts all keep working. */

const isResto = () => !!K.info && K.info.edition === 'resto';
const venue = () => S().venueType || 'both';
const stations = () => KC.venueStations(venue());
const STATION = { kitchen: 'Kitchen', bar: 'Bar' };
const rMenu = () => (K.raw.menu || []).filter((m) => m.name);
const rAreas = () => (K.raw.areas || []).slice().sort((a, b) => num(a.sort) - num(b.sort) || String(a.name).localeCompare(b.name));
const rTables = () => (K.raw.tables || []).filter((t) => !t.archived).sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), undefined, { numeric: true }));
const openTab = (tableId) => (K.raw.tabs || []).find((t) => t.tableId === tableId && t.status === 'open');
const tabOrders = (tab) => (K.raw.rorders || []).filter((o) => o.tabId === tab.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
const menuById = (id) => (K.raw.menu || []).find((m) => m.id === id);
const areaName = (id) => (rAreas().find((a) => a.id === id) || {}).name || '';
const people = () => (typeof teamPeople === 'function' ? teamPeople() : []);
const personName = (id) => (people().find((p) => p.id === id) || {}).name || '';
const mins = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso || Date.now()).getTime()) / 60000));
const rAgo = (iso) => { const m = mins(iso); return m < 1 ? 'now' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
const lateMins = () => num(S().lateMins) || 15;
const priceNow = (m) => KC.menuPrice(m, S(), new Date(), has('happyHour'));
const hexId = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const tokenId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');
const tableLink = (t) => location.origin + '/t/' + S().menuKey + '/' + t.token;
const menuLink = () => location.origin + '/m/' + (S().menuSlug || S().menuKey);
const menuLinkShort = () => location.host + '/m/' + (S().menuSlug || S().menuKey);
/** a ticket is for me: assigned to me, to my area, or to nobody yet */
const forMe = (o) => o.waiterId === K.me.id || (!o.waiterId && (!(o.waiterIds || []).length || (o.waiterIds || []).includes(K.me.id)));
const isWaiterOnly = () => can('serve') && !can('tables') && !can('salesAll');

/* ---------- the QR menu needs a key; a venue switched in by the admin may not have one yet ---------- */
let _slugAsked = false;
/* settings are saved whole: never before the venue's own settings have arrived from the server,
   or the defaults ("My Business", no menu key) would overwrite them */
const settingsLoaded = () => K.sync === 'ok' && !!K.raw.settings && K.raw.settings.id === 'main';
async function ensureMenuKey() {
  if (!can('settings') || !settingsLoaded()) return S().menuKey;
  if (!S().menuKey) await saveSettings({ menuKey: hexId(6) });
  if (!S().menuSlug && !_slugAsked) { // venues made before menu addresses: one from the business name
    _slugAsked = true;
    try { const r = await K.store.req('GET', '/api/menu-address?slug=' + encodeURIComponent(S().businessName || 'menu')); const slug = r.available ? r.slug : r.suggestion; if (slug) await saveSettings({ menuSlug: slug }); } catch (e) { _slugAsked = false; }
  }
  return S().menuKey;
}

/* ================= live alerts: a new order, a call, a bill request ================= */
const _seen = { ro: null, kds: null, calls: null };
let _actx = null;
function ding(msg) {
  try { navigator.vibrate && navigator.vibrate([180, 90, 180]); } catch (e) { }
  try { _actx = _actx || new (window.AudioContext || window.webkitAudioContext)(); const o = _actx.createOscillator(); const g = _actx.createGain(); o.connect(g); g.connect(_actx.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.15, _actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, _actx.currentTime + 0.5); o.start(); o.stop(_actx.currentTime + 0.5); } catch (e) { }
  if (msg) toast(msg);
}
/** the staff device must be tapped once before the browser lets it ring: say so with a button that turns it on */
const bellWanted = () => isResto() && !!K.member && (can('serve') || can('bills')) && K.sync === 'ok';
function bellPrompt() {
  const el = document.getElementById('bellOn');
  if (!window.Bell || Bell.on() || !bellWanted()) { if (el) el.remove(); return; }
  if (el) return;
  const b = document.createElement('button'); b.id = 'bellOn'; b.type = 'button';
  b.innerHTML = '🔔 <span>Tap to turn on the table bell</span>';
  b.setAttribute('aria-label', 'Turn on the table bell: customers calling the waiter or asking for the bill ring here');
  const go = (e) => { e.preventDefault(); if (!b.isConnected && e.type === 'click') return; Bell.ring(0); b.remove(); toast('Table bell on — this device rings when a customer calls'); };
  b.addEventListener('pointerdown', go); b.addEventListener('click', go); // on press: the sound wakes on the same touch
  document.body.appendChild(b);
}
if (window.Bell) Bell.onchange = () => setTimeout(bellPrompt, 0); // after the press has been handled
/** a customer rang from the menu: the table bell, for as long as they held it (bell.js) */
function bell(ms, msg) {
  if (!window.Bell) return ding(msg);
  bellPrompt(); // the sound could not play yet: the button stays up until someone taps
  try { navigator.vibrate && navigator.vibrate(ms > 600 ? [Math.min(ms, 3000)] : [180, 90, 180]); } catch (e) { }
  Bell.ring(ms); if (msg) toast(msg);
}
/** called by the data layer before a collection is replaced (boot.js) */
function restoWatch(col, docs) {
  if (!isResto() || !K.member) return;
  if (col === 'rorders') {
    const nw = docs.filter((o) => o.status === 'new'); const acc = docs.filter((o) => o.status === 'accepted');
    if (_seen.ro && (can('serve') || can('bills'))) { const f = nw.filter((o) => !_seen.ro.has(o.id) && (forMe(o) || can('tables'))); if (f.length) ding('New order · ' + (f[0].tableLabel || 'Counter') + (f[0].customerName ? ' · ' + f[0].customerName : '')); }
    if (_seen.kds && can('kds') && !can('serve')) { const f = acc.filter((o) => !_seen.kds.has(o.id)); if (f.length) ding('New ticket · ' + (f[0].tableLabel || 'Counter')); }
    _seen.ro = new Set(nw.map((o) => o.id)); _seen.kds = new Set(acc.map((o) => o.id));
  }
  if (col === 'sales' && can('bills') && !K._tabSweep) { K._tabSweep = setTimeout(() => { K._tabSweep = null; (K.raw.tabs || []).filter((t) => t.status === 'open' && (t.saleIds || []).length && !dueLines(t).length && tabOwing(t) < 0.5).forEach((t) => save('tabs', Object.assign({}, t, { status: 'paid', closedAt: new Date().toISOString(), closedBy: K.me.name || '' }))); }, 1500); }
  if (col === 'tables') {
    setTimeout(bellPrompt, 0);
    const calls = new Map(docs.filter((t) => t.call && t.call.at).map((t) => [t.id, t.call.at]));
    if (_seen.calls && (can('serve') || can('bills'))) { const f = docs.find((t) => t.call && t.call.at && _seen.calls.get(t.id) !== t.call.at); if (f) bell(f.call.ring, (f.label || 'A table') + (f.call.kind === 'bill' ? ' asks for the bill' : ' is calling the waiter')); }
    _seen.calls = calls;
  }
}
// minutes on tickets move on their own
setInterval(() => { if (isResto() && ['tickets', 'kds', 'floor', 'home'].includes(K.route) && !K.sheets.length) scheduleRender(); }, 30000);

/* ================= HOME: tonight ================= */
function restoHome(hello) {
  const t = todayStr(); const d = periodStats((x) => x === t);
  const tabs = (K.raw.tabs || []).filter((x) => x.status === 'open'); const ords = K.raw.rorders || [];
  const waiting = ords.filter((o) => o.status === 'new'); const late = ords.filter((o) => ['new', 'accepted'].includes(o.status) && mins(o.createdAt) >= lateMins());
  const calls = rTables().filter((x) => x.call && x.call.at);
  const tile = (l, v, cls) => '<div class="sh-k' + (cls ? ' ' + cls : '') + '"><span>' + l + '</span><b class="money">' + v + '</b></div>';
  const act = (href, icon, l, cls) => '<a class="sh-a' + (cls || '') + '" href="#' + href + '">' + ic(icon) + '<span>' + l + '</span></a>';
  const best = {}; visibleSales().filter((s) => saleDate(s) === t && s.status !== 'cancelled').forEach((s) => (s.lines || []).forEach((l) => { if (l.menuId) best[l.name] = (best[l.name] || 0) + num(l.qty); }));
  const top = Object.entries(best).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return '<div class="sh-head"><div><div class="hint">' + fmtDate(t) + ' · ' + esc(KC.VENUE_TYPES.find((v) => v[0] === venue())[1]) + '</div><h1>' + hello + (K.me.name ? ', ' + esc(K.me.name.split(' ')[0]) : '') + '</h1></div><button class="icon-btn sh-help" data-a="tourStart" title="How Aahsso works" aria-label="How Aahsso works">' + ic('help') + '</button></div>' +
    '<div class="sh-acts">' + (navOk('floor') ? act('floor', 'table', 'Tables', ' pri') : '') + (navOk('tickets') ? act('tickets', 'bell', 'Orders' + (waiting.length ? ' · ' + waiting.length : '')) : '') + (navOk('kds') ? act('kds', 'chef', 'Kitchen') : navOk('menu') ? act('menu', 'tag', 'Menu') : '') + '</div>' +
    '<div class="sh-ks">' + tile('Sold today', fmt(d.revenue)) + tile('Open tables', fmt(tabs.length)) + tile('Orders waiting', fmt(waiting.length), waiting.length ? 'warn' : '') + (seeCost() ? tile('Profit today', fmt(d.profit), 'ok') : tile('Cash in today', fmt(d.collected))) + '</div>' +
    (calls.length || late.length ? '<section class="card sh-sec"><div class="sh-sh"><h2>Needs you now</h2></div>' +
      calls.map((x) => '<div class="sh-row todo warn" data-a="tableOpen" data-id="' + x.id + '" role="button"><span class="todo-ic">' + ic('bell', 'sm') + '</span><div class="grow ellipsis">' + esc(x.label) + (x.call.kind === 'bill' ? ' asks for the bill' : ' is calling') + ' <span class="faint">· ' + rAgo(x.call.at) + '</span></div>' + ic('chev', 'sm') + '</div>').join('') +
      late.slice(0, 5).map((o) => '<div class="sh-row todo bad" data-a="go" data-r="tickets" role="button"><span class="todo-ic">' + ic('clock', 'sm') + '</span><div class="grow ellipsis">' + esc(o.tableLabel || 'Counter') + ' · waiting ' + rAgo(o.createdAt) + '</div>' + ic('chev', 'sm') + '</div>').join('') + '</section>' : '') +
    (rMenu().length && can('settings') ? menuCard() : '') +
    (top.length ? '<section class="card sh-sec"><div class="sh-sh"><h2>Selling tonight</h2></div>' + top.map(([n, q]) => '<div class="sh-row"><div class="grow ellipsis">' + esc(n) + '</div><b>' + fmt(q) + '</b></div>').join('') + '</section>' : '') +
    (!rMenu().length && can('menu') ? '<section class="card sh-sec"><div class="sh-sh"><h2>Get started</h2></div><div class="sh-row" data-a="go" data-r="menu" role="button"><div class="grow">1 · Add your menu</div>' + ic('chev', 'sm') + '</div>' + (can('tables') ? '<div class="sh-row" data-a="go" data-r="floor" role="button"><div class="grow">2 · Add your tables and print their QR codes</div>' + ic('chev', 'sm') + '</div>' : '') + '<div class="sh-row" data-a="go" data-r="buy" role="button"><div class="grow">3 · Record the drinks and food you bought</div>' + ic('chev', 'sm') + '</div></section>' : '');
}

/* ================= TABLES (floor) ================= */
function tableState(t) {
  const tab = openTab(t.id);
  if (t.call && t.call.at) return { k: 'call', l: t.call.kind === 'bill' ? 'Bill asked' : 'Calling', tab };
  if (!tab) { const r = bookingFor(t.id); return { k: r ? 'booked' : 'free', l: r ? 'Booked ' + r.time : 'Free', tab }; }
  const os = tabOrders(tab).filter((o) => o.status !== 'rejected');
  if (tab.billAskedAt) return { k: 'call', l: 'Bill asked', tab };
  if (!os.length) return { k: 'served', l: 'Seated', tab };
  if (os.some((o) => o.status === 'new')) return { k: 'new', l: 'New order', tab };
  if (os.some((o) => o.status === 'ready')) return { k: 'ready', l: 'Ready to serve', tab };
  if (os.some((o) => o.status === 'accepted')) return { k: 'prep', l: 'Preparing', tab };
  return { k: 'served', l: 'Served', tab };
}
const tabDue = (tab) => dueLines(tab).reduce((a, l) => a + l.qty * l.price, 0) + tabOwing(tab);
VIEWS.floor = {
  render() {
    if ((!S().menuKey || !S().menuSlug) && can('settings') && settingsLoaded()) setTimeout(ensureMenuKey, 0);
    const areas = rAreas(); const cur = K.ui.floorArea || ''; let ts = rTables(); if (cur) ts = ts.filter((t) => t.areaId === cur);
    if (isWaiterOnly() && K.ui.floorMine !== false) { const mine = rTables().filter((t) => t.waiterId === K.me.id || (rAreas().find((a) => a.id === t.areaId) || { waiterIds: [] }).waiterIds.includes(K.me.id)); if (mine.length) ts = ts.filter((t) => mine.includes(t)); }
    const tops = '<div class="row wrap mb">' + (can('serve') ? '<button class="btn pri" data-a="rNewOrder">' + ic('plus') + 'New order</button>' : '') +
      (has('payFirst') && S().payFirst && can('bills') ? '<button class="btn" data-a="rCounter">' + ic('sell') + 'Counter sale</button>' : '') +
      (can('tables') ? '<button class="btn" data-a="floorSetup">' + ic('gear') + 'Tables & areas</button>' : '') + (can('settings') ? '<button class="btn ghost" data-a="venueSettings">' + ic('gear') + 'Venue settings</button>' : '') + '</div>';
    const chips = menuCard() + (areas.length ? '<div class="chips mb">' + [['', 'All']].concat(areas.map((a) => [a.id, a.name])).map(([k, l]) => '<button class="chip' + (cur === k ? ' on' : '') + '" data-a="floorArea" data-v="' + esc(k) + '">' + esc(l) + '</button>').join('') + '</div>' : '');
    if (!rTables().length) return tops + menuCard() + '<div class="card empty"><div class="big">🍽️</div>No tables yet.' + (can('tables') ? '<div class="mt"><button class="btn pri" data-a="floorSetup">' + ic('plus') + 'Add your tables</button></div>' : '') + '</div>';
    return tops + chips + '<div class="floor">' + ts.map((t) => { const st = tableState(t); const due = st.tab ? tabDue(st.tab) : 0; return '<button type="button" class="tbl tbl-' + st.k + '" data-a="tableOpen" data-id="' + t.id + '"><span class="tbl-l">' + esc(t.label) + '</span><span class="tbl-s">' + esc(st.l) + '</span>' + (st.tab ? '<span class="tbl-m">' + fmt(due) + ' · ' + rAgo(st.tab.openedAt) + '</span>' : '<span class="tbl-m">' + fmt(num(t.seats) || 0) + ' seats</span>') + '</button>'; }).join('') + '</div>' +
      '<div class="tbl-key hint mt">' + [['free', 'Free'], ['new', 'New order'], ['prep', 'Preparing'], ['ready', 'Ready'], ['served', 'Served'], ['call', 'Calling / bill']].map(([k, l]) => '<span><i class="tbl-dot tbl-' + k + '"></i>' + l + '</span>').join('') + '</div>';
  },
};
/* the venue's public menu link: customers open it (or scan its QR poster), pick their table and order */
const menuOrdersOn = () => has('qrOrders') && S().qrOn !== false;
function menuCard() {
  if (!S().menuKey || !(can('tables') || can('settings') || can('menu'))) return '';
  const on = menuOrdersOn(); const pickOn = on && S().pickTable !== false; const link = menuLink();
  const lead = !on ? 'Customers can see your menu here. Ordering from the phone is off.' : pickOn ? 'Customers open this link, choose their table and order. You accept each order.' : 'Customers see the menu here; they order by scanning the QR code on their table.';
  return '<div class="shop-link mb"><div class="lbl">Customer menu</div><div class="hint">' + lead + '</div><div class="shop-url">' + esc(menuLinkShort()) + '</div><div class="shop-acts">' +
    '<a class="btn sm" target="_blank" rel="noopener" href="' + esc(link) + '">Open menu</a><button class="btn sm" data-a="mnLink">' + ic('copy', 'sm') + 'Copy link</button>' +
    '<a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent('See our menu' + (pickOn ? ' and order from your table' : '') + ': ' + link) + '">' + ic('wa', 'sm') + 'Share</a>' +
    '<button class="btn sm" data-a="qrMenuPrint">' + ic('dl', 'sm') + 'QR poster</button>' + (rTables().length && on ? '<button class="btn sm" data-a="qrPrint">' + ic('dl', 'sm') + 'Table QR codes</button>' : '') +
    (can('settings') ? '<button class="btn sm ghost" data-a="menuSlugEdit">' + ic('edit', 'sm') + 'Change address</button>' : '') + '</div></div>';
}
/* the menu address: /m/sky-lounge — checked as you type; earlier addresses keep working */
A.menuSlugEdit = () => {
  const cur = S().menuSlug || KC.shopSlugify(S().businessName);
  const sh = openSheet({ title: 'Menu address', body: '<div class="col">' +
    '<label class="f"><span class="lbl">Your menu address</span><div class="slug-in"><span class="slug-pre">' + esc(location.host) + '/m/</span><input class="inp" id="menuSlug" value="' + esc(cur) + '" maxlength="40" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="your-venue-name"></div>' +
    '<span class="hint slug-msg" id="mSlugMsg">Your venue name, easy to remember and share. Letters, numbers and dashes.</span></label>' +
    '<p class="hint">Links and posters with your earlier address keep working. The QR codes on your tables do not change.</p></div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="msGo">Save</button>' });
  const msg = (t, cls) => { const m = $('#mSlugMsg', sh); if (m) { m.textContent = t; m.className = 'hint slug-msg' + (cls ? ' ' + cls : ''); } };
  let timer = null;
  $('#menuSlug', sh).oninput = (e) => {
    clearTimeout(timer); const slug = KC.shopSlugify(e.target.value); const bad = KC.shopSlugError(slug);
    if (bad) return msg(bad.replace('your shop', 'your menu'), 'bad');
    if (slug === S().menuSlug) return msg('✓ This is your current address', 'ok');
    msg('Checking…');
    timer = setTimeout(async () => {
      try { const r = await K.store.req('GET', '/api/menu-address?slug=' + encodeURIComponent(slug)); if (KC.shopSlugify($('#menuSlug', sh).value) !== r.slug) return;
        msg(r.available ? '✓ Available: ' + location.host + '/m/' + r.slug : (r.reason || 'Not available') + (r.suggestion ? ' — try ' + r.suggestion : ''), r.available ? 'ok' : 'bad'); }
      catch (err) { msg('Could not check right now — it will be checked when you save.'); }
    }, 400);
  };
  $('#menuSlug', sh).onblur = (e) => { const v = KC.shopSlugify(e.target.value); if (v) e.target.value = v; };
  $('#msGo', sh).onclick = async () => {
    const slug = KC.shopSlugify($('#menuSlug', sh).value); $('#menuSlug', sh).value = slug;
    const bad = KC.shopSlugError(slug); if (bad) { msg(bad.replace('your shop', 'your menu'), 'bad'); return; }
    if (slug === S().menuSlug) return closeSheet();
    try { const r = await K.store.req('GET', '/api/menu-address?slug=' + encodeURIComponent(slug)); if (!r.available) { msg((r.reason || 'Not available') + (r.suggestion ? ' — try ' + r.suggestion : ''), 'bad'); return; } } catch (e) { }
    if (await saveSettings({ menuSlug: slug })) { closeSheet(); render(true); toast('Your menu is now at ' + location.host + '/m/' + slug); }
  };
};
A.floorArea = (el) => { K.ui.floorArea = el.dataset.v; render(true); };

/* ---------- one table: its tickets, its bill ---------- */
A.tableOpen = (el) => tableSheet(el.dataset.id);
function tableSheet(id) {
  const sh = openSheet({ title: 'Table', body: '', wide: true });
  sh._refresh = () => {
    const t = (K.raw.tables || []).find((x) => x.id === id); if (!t) return closeSheet();
    const tab = openTab(id); const os = tab ? tabOrders(tab) : []; const lines = tab ? dueLines(tab) : []; const owing = tab ? tabOwing(tab) : 0;
    const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
    $('.sh h2, .sh .t', sh) && ($('.sh h2, .sh .t', sh).textContent = t.label + (t.areaId ? ' · ' + areaName(t.areaId) : ''));
    setSheetBody(sh,
      (t.call && t.call.at ? '<div class="alert warn mb row between"><span>' + ic('bell', 'sm') + ' ' + (t.call.kind === 'bill' ? 'Asks for the bill' : 'Calling the waiter') + (t.call.name ? ' · ' + esc(t.call.name) : '') + ' · ' + rAgo(t.call.at) + '</span><button class="btn sm" data-a="callDone" data-id="' + id + '">Done</button></div>' : '') +
      (!tab ? '<div class="empty small">Free table · ' + fmt(num(t.seats) || 0) + ' seats' + (bookingFor(id) ? '<br>Booked at ' + esc(bookingFor(id).time) + ' for ' + esc(bookingFor(id).name) : '') + '</div>' :
        '<div class="row between mb"><div class="small muted">' + (tab.customerName ? esc(tab.customerName) + ' · ' : '') + 'open ' + rAgo(tab.openedAt) + (tab.waiterId ? ' · ' + esc(personName(tab.waiterId) || 'waiter') : '') + '</div>' + (tab.billAskedAt ? '<span class="badge warn">Bill asked</span>' : '') + '</div>' +
        os.map(ticketCard).join('') +
        '<div class="card pad mt"><div class="row between"><b>' + (owing > 0 ? 'Still to pay' : 'Bill so far') + '</b><b class="money" style="font-size:17px">' + F(total + owing) + '</b></div>' + lines.map((l) => '<div class="row between small"><span>' + fmt(l.qty) + ' × ' + esc(l.name) + '</span><span class="money">' + fmt(l.qty * l.price) + '</span></div>').join('') + '</div>'),
    );
    const foot = $('.sf', sh);
    if (foot) foot.innerHTML = (can('serve') ? '<button class="btn grow" data-a="rAddOrder" data-id="' + id + '">' + ic('plus') + (tab ? 'Add order' : 'New order') + '</button>' : '') +
      (tab && (can('tables') || can('bills')) && has('tabsPlus') ? '<button class="btn" data-a="tabMore" data-id="' + tab.id + '" title="Move, merge, print">' + ic('more') + '</button>' : '') +
      (tab && can('bills') ? '<button class="btn pri grow" data-a="tabPay" data-id="' + tab.id + '">' + ic('wallet') + 'Bill</button>' : '');
  };
  if (!$('.sf', sh)) { const f = document.createElement('div'); f.className = 'sf'; sh.querySelector('.sheet').appendChild(f); }
  sh._refresh();
}
A.callDone = async (el) => { const t = (K.raw.tables || []).find((x) => x.id === el.dataset.id); if (!t) return; const n = Object.assign({}, t); delete n.call; await save('tables', n); const tab = openTab(t.id); if (tab && tab.billAskedAt && t.call && t.call.kind === 'bill') { /* keep billAskedAt until paid */ } refreshSheets(); scheduleRender(); };

/* ---------- tickets: one round of ordering ---------- */
function ticketCard(o) {
  const late = ['new', 'accepted'].includes(o.status) && mins(o.createdAt) >= lateMins();
  const badge = { new: '<span class="badge warn">New</span>', accepted: '<span class="badge info">Preparing</span>', ready: '<span class="badge ok">Ready</span>', served: '<span class="badge">Served</span>', rejected: '<span class="badge bad">Rejected</span>' }[o.status] || '';
  const acts = [];
  if (o.status === 'new' && can('serve')) acts.push('<button class="btn sm" data-a="tkReject" data-id="' + o.id + '">Reject</button><button class="btn sm pri" data-a="tkAccept" data-id="' + o.id + '">' + ic('check', 'sm') + 'Accept</button>');
  if (o.status === 'accepted' && (can('serve') || can('kds')) && (!has('kds') || can('tables'))) acts.push('<button class="btn sm" data-a="tkReady" data-id="' + o.id + '">Ready</button>');
  if (['accepted', 'ready'].includes(o.status) && can('serve')) acts.push('<button class="btn sm pri" data-a="tkServed" data-id="' + o.id + '">' + ic('check', 'sm') + 'Served</button>');
  return '<div class="card tk' + (late ? ' tk-late' : '') + '"><div class="row between"><div><b>' + esc(o.tableLabel || 'Counter') + '</b> <span class="faint small">#' + esc(o.no || '') + (o.customerName ? ' · ' + esc(o.customerName) : '') + (o.source === 'qr' ? ' · QR' : '') + '</span></div><div class="row gap6">' + badge + '<span class="small ' + (late ? 'bad-t' : 'faint') + '">' + rAgo(o.createdAt) + '</span></div></div>' +
    '<div class="tk-lines">' + (o.lines || []).map((l) => '<div><b>' + fmt(l.qty) + '×</b> ' + esc(l.name) + (l.note ? ' <span class="faint">— ' + esc(l.note) + '</span>' : '') + (stations().length > 1 ? ' <span class="tk-st">' + esc(STATION[l.station] || '') + '</span>' : '') + '</div>').join('') + (o.note ? '<div class="faint small">' + esc(o.note) + '</div>' : '') + (o.rejectReason ? '<div class="small bad-t">' + esc(o.rejectReason) + '</div>' : '') + '</div>' +
    (acts.length ? '<div class="row gap6 tk-acts">' + acts.join('') + '</div>' : '') + '</div>';
}
const rOrder = (id) => (K.raw.rorders || []).find((o) => o.id === id);
async function setOrder(o, patch) { const n = Object.assign({}, o, patch); if (await save('rorders', n)) { refreshSheets(); scheduleRender(); return n; } return null; }
A.tkAccept = async (el) => {
  const o = rOrder(el.dataset.id); if (!o || o.status !== 'new') return;
  const st = {}; (o.lines || []).forEach((l) => { st[l.station || KC.stationOf(menuById(l.menuId) || {}, venue())] = { s: 'todo' }; });
  const n = await setOrder(o, { status: 'accepted', acceptedAt: new Date().toISOString(), waiterId: o.waiterId || K.me.id, acceptedBy: K.me.name || '', st });
  const tab = n && (K.raw.tabs || []).find((x) => x.id === o.tabId); if (tab && !tab.waiterId) save('tabs', Object.assign({}, tab, { waiterId: K.me.id }));
  if (n) toast('Accepted · sent to ' + Object.keys(st).map((k) => STATION[k] || k).join(' & '));
};
A.tkReject = async (el) => {
  const o = rOrder(el.dataset.id); if (!o) return;
  const sh = openSheet({ title: 'Reject this order', body: field('Why? (the customer sees it)', sel('why', ['Sold out', 'Kitchen is closed', 'Order sent by mistake', 'Other'], 'Sold out')) + field('Details (optional)', inp('whyMore', '')), foot: '<button class="btn grow" data-a="sheetClose">Back</button><button class="btn danger grow" id="rjGo">Reject</button>' });
  $('#rjGo', sh).onclick = async () => { const v = formVals(sh); await setOrder(o, { status: 'rejected', rejectReason: [v.why, v.whyMore].filter(Boolean).join(' — '), rejectedBy: K.me.name || '', rejectedAt: new Date().toISOString() }); closeSheet(); };
};
A.tkReady = async (el) => { const o = rOrder(el.dataset.id); if (o) await setOrder(o, { status: 'ready', readyAt: new Date().toISOString() }); };
A.tkServed = async (el) => { const o = rOrder(el.dataset.id); if (o) await setOrder(o, { status: 'served', servedAt: new Date().toISOString(), servedBy: K.me.name || '', servedById: K.me.id, waiterId: o.waiterId || K.me.id }); };

/* ================= ORDERS (tickets) ================= */
VIEWS.tickets = {
  render() {
    const tab = K.ui.tkTab || 'live'; const mine = K.ui.tkMine !== undefined ? K.ui.tkMine : isWaiterOnly();
    let list = (K.raw.rorders || []).slice(); if (mine) list = list.filter(forMe);
    const t = todayStr(); const by = { live: (o) => ['new', 'accepted', 'ready'].includes(o.status), new: (o) => o.status === 'new', ready: (o) => o.status === 'ready', done: (o) => ['served', 'rejected'].includes(o.status) && String(o.createdAt).slice(0, 10) === t };
    const n = (k) => list.filter(by[k]).length;
    list = list.filter(by[tab]).sort((a, b) => (tab === 'done' ? String(b.createdAt).localeCompare(String(a.createdAt)) : String(a.createdAt).localeCompare(String(b.createdAt))));
    return '<div class="row wrap between mb"><div class="chips">' + [['live', 'Open'], ['new', 'New'], ['ready', 'Ready'], ['done', 'Done today']].map(([k, l]) => '<button class="chip' + (tab === k ? ' on' : '') + '" data-a="tkTab" data-v="' + k + '">' + l + (k !== 'done' && n(k) ? ' · ' + n(k) : '') + '</button>').join('') + '</div>' +
      '<div class="row gap6">' + (can('serve') && can('tables') ? '<label class="toggle small"><input type="checkbox" data-c="tkMine"' + (mine ? ' checked' : '') + '>Only mine</label>' : '') + (can('serve') ? '<button class="btn pri" data-a="rNewOrder">' + ic('plus') + 'New order</button>' : '') + '</div></div>' +
      (list.length ? '<div class="tk-grid">' + list.map(ticketCard).join('') + '</div>' : '<div class="card empty"><div class="big">🔔</div>' + (tab === 'done' ? 'Nothing served yet today.' : 'No orders waiting.') + '</div>');
  },
};
A.tkTab = (el) => { K.ui.tkTab = el.dataset.v; render(true); };
CH.tkMine = (el) => { K.ui.tkMine = el.checked; render(true); };

/* ================= KITCHEN & BAR SCREEN ================= */
VIEWS.kds = {
  render() {
    const sts = stations(); const st = sts.includes(K.ui.kdsSt) ? K.ui.kdsSt : sts[0];
    const live = (K.raw.rorders || []).filter((o) => o.status === 'accepted' && (o.lines || []).some((l) => (l.station || 'kitchen') === st) && !((o.st || {})[st] && o.st[st].s === 'ready')).sort((a, b) => String(a.acceptedAt || a.createdAt).localeCompare(String(b.acceptedAt || b.createdAt)));
    const done = (K.raw.rorders || []).filter((o) => (o.st || {})[st] && o.st[st].s === 'ready' && String(o.st[st].at || '').slice(0, 10) === todayStr()).sort((a, b) => String(b.st[st].at).localeCompare(String(a.st[st].at))).slice(0, 6);
    return (sts.length > 1 ? '<div class="chips mb">' + sts.map((k) => '<button class="chip' + (k === st ? ' on' : '') + '" data-a="kdsSt" data-v="' + k + '">' + STATION[k] + '</button>').join('') + '</div>' : '') +
      (live.length ? '<div class="kds">' + live.map((o) => { const s = (o.st || {})[st] || {}; const m = mins(o.acceptedAt || o.createdAt); return '<div class="kd' + (m >= lateMins() ? ' late' : s.s === 'started' ? ' go' : '') + '"><div class="kd-h"><b>' + esc(o.tableLabel || 'Counter') + '</b><span>' + m + ' min</span></div><div class="kd-l">' +
        (o.lines || []).filter((l) => (l.station || 'kitchen') === st).map((l) => '<div><b>' + fmt(l.qty) + '</b> ' + esc(l.name) + (l.note ? '<i>' + esc(l.note) + '</i>' : '') + '</div>').join('') + '</div>' +
        '<div class="kd-a">' + (s.s !== 'started' ? '<button class="btn" data-a="kdsGo" data-id="' + o.id + '" data-s="' + st + '" data-v="started">Start</button>' : '') + '<button class="btn pri" data-a="kdsGo" data-id="' + o.id + '" data-s="' + st + '" data-v="ready">' + ic('check') + 'Ready</button></div></div>'; }).join('') + '</div>'
        : '<div class="card empty"><div class="big">👨‍🍳</div>Nothing to prepare at the ' + STATION[st].toLowerCase() + '.</div>') +
      (done.length ? '<h3 class="mt2 mb">Ready</h3><div class="card list">' + done.map((o) => '<div class="li" style="cursor:default"><div class="grow">' + esc(o.tableLabel || 'Counter') + ' <span class="faint">#' + esc(o.no || '') + '</span></div><span class="hint">' + rAgo(o.st[st].at) + ' ago</span></div>').join('') + '</div>' : '');
  },
};
A.kdsSt = (el) => { K.ui.kdsSt = el.dataset.v; render(true); };
A.kdsGo = async (el) => {
  const o = rOrder(el.dataset.id); if (!o) return; const k = el.dataset.s; const now = new Date().toISOString();
  const st = Object.assign({}, o.st || {}, { [k]: { s: el.dataset.v, at: now, by: K.me.name || '' } });
  const need = [...new Set((o.lines || []).map((l) => l.station || 'kitchen'))]; const all = need.every((x) => st[x] && st[x].s === 'ready');
  await setOrder(o, Object.assign({ st }, all ? { status: 'ready', readyAt: now } : {}));
  if (all) toast((o.tableLabel || 'Counter') + ' is ready to serve');
};

/* ================= taking an order (waiter phone, or the counter) ================= */
A.rNewOrder = () => pickTable((t) => composeOrder({ tableId: t.id }));
A.rAddOrder = (el) => composeOrder({ tableId: el.dataset.id });
A.rCounter = () => composeOrder({ counter: true });
function pickTable(cb) {
  const ts = rTables(); if (!ts.length) { if (has('payFirst') && S().payFirst) return composeOrder({ counter: true }); return toast('Add your tables first (Tables → Tables & areas)', true); }
  const sh = openSheet({ title: 'Which table?', body: '<div class="floor floor-sm">' + ts.map((t) => { const st = tableState(t); return '<button type="button" class="tbl tbl-' + st.k + '" data-pick="' + t.id + '"><span class="tbl-l">' + esc(t.label) + '</span><span class="tbl-s">' + esc(st.l) + '</span></button>'; }).join('') + '</div>' });
  sh.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (!b) return; closeSheet(); cb(ts.find((x) => x.id === b.dataset.pick)); });
}
function composeOrder(opt) {
  const items = rMenu().filter((m) => m.active !== false); if (!items.length) return toast('Add your menu first (Menu → New item)', true);
  const cats = [...new Set((S().menuCats || []).concat(items.map((m) => m.category || 'Other')))].filter((c) => items.some((m) => (m.category || 'Other') === c));
  const t = opt.tableId ? (K.raw.tables || []).find((x) => x.id === opt.tableId) : null; const cart = {}; let cat = '', q = '';
  const sh = openSheet({ title: t ? 'Order · ' + t.label : 'Counter sale', wide: true, body: '' });
  const units = (m) => (m.uses && m.uses.length ? KC.menuUnits(K.C, m, K.loc) : Infinity);
  const draw = () => {
    const list = items.filter((m) => (!cat || (m.category || 'Other') === cat) && (!q || m.name.toLowerCase().includes(q)));
    const n = Object.values(cart).reduce((a, c) => a + c.qty, 0); const tot = Object.values(cart).reduce((a, c) => a + c.qty * priceNow(c.m), 0);
    setSheetBody(sh, (t && !openTab(t.id) ? field('Customer name (optional)', inp('custName', K.ui.coName || '', 'placeholder="e.g. Brenda" id="coName"')) : '') +
      '<div class="search mb">' + ic('search') + '<input class="inp" id="coQ" placeholder="Search the menu" value="' + esc(q) + '"></div>' +
      '<div class="chips mb">' + [['', 'All']].concat(cats.map((c) => [c, c])).map(([k, l]) => '<button type="button" class="chip' + (cat === k ? ' on' : '') + '" data-cocat="' + esc(k) + '">' + esc(l) + '</button>').join('') + '</div>' +
      '<div class="card list">' + list.map((m) => { const c = cart[m.id]; const out = m.soldOut || units(m) < 1; const p = priceNow(m); return '<div class="li co-i' + (out ? ' off' : '') + '" style="cursor:default"><div class="grow" style="min-width:0"><div class="t ellipsis">' + esc(m.name) + '</div><div class="tiny muted">' + (p < num(m.price) ? '<s>' + fmt(m.price) + '</s> ' : '') + fmt(p) + (out ? ' · sold out' : units(m) < 6 ? ' · ' + units(m) + ' left' : '') + '</div></div>' +
        (c ? '<div class="stepper"><button type="button" data-co="-" data-id="' + m.id + '">−</button><span class="co-q">' + c.qty + '</span><button type="button" data-co="+" data-id="' + m.id + '">+</button></div>' : '<button type="button" class="btn sm" data-co="+" data-id="' + m.id + '"' + (out ? ' disabled' : '') + '>' + ic('plus', 'sm') + 'Add</button>') + '</div>'; }).join('') + '</div>' +
      (n ? '<div class="card pad mt">' + Object.values(cart).map((c) => '<div class="row between small co-l"><span>' + c.qty + ' × ' + esc(c.m.name) + '</span><input class="inp co-note" data-note="' + c.m.id + '" placeholder="Note (no ice…)" value="' + esc(c.note || '') + '"></div>').join('') + '</div>' : ''));
    $('.sf', sh).innerHTML = '<span class="grow b">' + (n ? n + ' item' + (n === 1 ? '' : 's') + ' · ' + F(tot) : 'Tap items to add them') + '</span><button class="btn pri" id="coGo"' + (n ? '' : ' disabled') + '>' + (opt.counter ? ic('wallet') + 'Pay' : ic('check') + 'Send') + '</button>';
    $('#coGo', sh).onclick = () => (opt.counter ? payCounter(cart, sh) : sendOrder(t, cart, sh));
  };
  if (!$('.sf', sh)) { const f = document.createElement('div'); f.className = 'sf'; sh.querySelector('.sheet').appendChild(f); }
  sh.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cocat]'); if (c) { cat = c.dataset.cocat; draw(); return; }
    const b = e.target.closest('[data-co]'); if (!b) return; const m = items.find((x) => x.id === b.dataset.id); if (!m) return;
    const cur = cart[m.id] || { m, qty: 0 }; cur.qty += b.dataset.co === '+' ? 1 : -1; if (cur.qty <= 0) delete cart[m.id]; else cart[m.id] = cur; draw();
  });
  sh.addEventListener('input', (e) => { if (e.target.id === 'coQ') { q = e.target.value.toLowerCase(); draw(); setTimeout(() => { const i = $('#coQ', sh); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); } if (e.target.dataset.note) { const c = cart[e.target.dataset.note]; if (c) c.note = e.target.value; } if (e.target.id === 'coName') K.ui.coName = e.target.value; });
  draw();
}
const ticketLines = (cart) => Object.values(cart).map((c) => ({ menuId: c.m.id, name: c.m.name, qty: c.qty, price: priceNow(c.m), category: c.m.category || '', station: KC.stationOf(c.m, venue()), note: (c.note || '').slice(0, 120) }));
const shortNo = () => String(Math.floor(100 + Math.random() * 900));
async function sendOrder(t, cart, sh) {
  const now = new Date().toISOString(); let tab = openTab(t.id);
  if (!tab) { tab = { id: uid('tb_'), tableId: t.id, tableLabel: t.label, status: 'open', openedAt: now, customerName: (K.ui.coName || '').trim(), waiterId: K.me.id, source: 'staff' }; if (!(await save('tabs', tab))) return; K.ui.coName = ''; }
  const lines = ticketLines(cart); const st = {}; lines.forEach((l) => (st[l.station] = { s: 'todo' }));
  const o = { id: uid('ro_'), no: shortNo(), tabId: tab.id, tableId: t.id, tableLabel: t.label, areaId: t.areaId || '', source: 'staff', customerName: tab.customerName || '', waiterIds: [K.me.id], waiterId: K.me.id, status: 'accepted', acceptedAt: now, acceptedBy: K.me.name || '', createdAt: now, by: K.me.name || '', lines, st };
  if (await save('rorders', o)) { closeSheet(); toast('Sent to ' + Object.keys(st).map((k) => STATION[k] || k).join(' & ')); refreshSheets(); scheduleRender(); }
}

/* ================= BILL: pay all, pay some items, split equally; tips, service, loyalty ================= */
/** lines of the tab not yet on a sale */
function dueLines(tab) {
  const paid = {}; (tab.saleIds || []).forEach((sid) => { const s = byId('sales', sid); if (s && s.status !== 'cancelled') (s.lines || []).forEach((l) => { if (l.menuId) { const k = l.menuId + '|' + num(l.unitPrice); paid[k] = (paid[k] || 0) + num(l.qty); } }); });
  return KC.tabLines(tab, K.raw.rorders).map((l) => { const k = l.menuId + '|' + l.price; const left = l.qty - (paid[k] || 0); return Object.assign({}, l, { qty: Math.max(0, left) }); }).filter((l) => l.qty > 0);
}
/** what is still owed on the tab's sales (a split bill in progress) */
const tabOwing = (tab, saved) => (tab.saleIds || []).reduce((a, sid) => { const x = saved && saved.id === sid ? KC.saleTotals(saved) : K.C.saleX[sid]; return a + (x && x.status !== 'cancelled' ? Math.max(0, x.balance) : 0); }, 0); // `saved`: the bill just saved (fresher than a data refresh in flight)
const saleNo = () => { const d = new Date(); return 'S' + String(d.getFullYear()).slice(2) + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(); };
A.tabPay = (el) => billSheet(el.dataset.id);
function billSheet(tabId) {
  const tab0 = (K.raw.tabs || []).find((x) => x.id === tabId); if (!tab0) return;
  const svcPct = has('tabsPlus') ? num(S().serviceCharge) : 0; const loyal = has('loyalty') && S().loyaltyOn;
  const ui = { pick: null, split: 1, cust: null, spend: 0 };
  const sh = openSheet({ title: 'Bill · ' + (tab0.tableLabel || 'Counter'), wide: true, body: '' });
  if (!$('.sf', sh)) { const f = document.createElement('div'); f.className = 'sf'; sh.querySelector('.sheet').appendChild(f); }
  sh._refresh = () => {
    const tab = (K.raw.tabs || []).find((x) => x.id === tabId); if (!tab || tab.status !== 'open') return closeSheet();
    const owing = tabOwing(tab); const open = (tab.saleIds || []).map((id) => byId('sales', id)).find((s) => s && K.C.saleX[s.id] && K.C.saleX[s.id].balance > 0.5 && s.status !== 'cancelled');
    const due = dueLines(tab); const pickOn = ui.pick && has('tabsPlus');
    const chosen = due.map((l) => Object.assign({}, l, { qty: pickOn ? Math.min(l.qty, num(ui.pick[l.menuId + '|' + l.price] || 0)) : l.qty })).filter((l) => l.qty > 0);
    const sub = chosen.reduce((a, l) => a + l.qty * l.price, 0); const svc = Math.round(sub * svcPct / 100);
    const pts = ui.cust ? KC.loyaltyPoints(K.raw, ui.cust.id) : 0; const spend = Math.min(num(ui.spend), pts); const spendVal = Math.round(spend * (num(S().pointValue) || 10));
    const total = Math.max(0, sub + svc - spendVal);
    if (open) { // a split bill in progress: take the next payment on it
      setSheetBody(sh, '<div class="alert info mb">Bill ' + esc(open.no) + ': ' + F(K.C.saleX[open.id].net) + ' · paid ' + F(K.C.saleX[open.id].paid) + ' · <b>still ' + F(K.C.saleX[open.id].balance) + '</b></div>' + payFields(Math.round(ui.split > 1 ? Math.min(K.C.saleX[open.id].balance, K.C.saleX[open.id].net / ui.split) : K.C.saleX[open.id].balance), { kind: 'sale' }));
      syncPayCharges(sh);
      $('.sf', sh).innerHTML = '<button class="btn grow" data-a="sheetClose">Later</button><button class="btn pri grow" id="bpGo">' + ic('check') + 'Record payment</button>';
      $('#bpGo', sh).onclick = async () => { const p = readPayment(formVals(sh), 'sale'); if (p === false) return; if (!p) return toast('Enter the amount', true); const s = byId('sales', open.id); const n = Object.assign({}, s, { payments: (s.payments || []).concat([p]) }); if (await save('sales', n)) { recompute(); await closeTabIfDone(tabId, n.id, n); } };
      return;
    }
    setSheetBody(sh,
      (has('tabsPlus') ? '<div class="seg mb"><button type="button" class="' + (!pickOn ? 'on' : '') + '" data-bm="all">Whole bill</button><button type="button" class="' + (pickOn ? 'on' : '') + '" data-bm="pick">Pay some items</button></div>' : '') +
      '<div class="card pad mb">' + due.map((l) => { const k = l.menuId + '|' + l.price; return '<div class="row between small bl-l"><span>' + (pickOn ? '<span class="stepper sm"><button type="button" data-pk="-" data-k="' + esc(k) + '">−</button><span>' + num(ui.pick[k] || 0) + '/' + l.qty + '</span><button type="button" data-pk="+" data-k="' + esc(k) + '" data-max="' + l.qty + '">+</button></span> ' : fmt(l.qty) + ' × ') + esc(l.name) + '</span><span class="money">' + fmt(l.qty * l.price) + '</span></div>'; }).join('') +
        '<div class="bl-t"><div class="row between"><span>Items</span><span class="money">' + F(sub) + '</span></div>' + (svc ? '<div class="row between"><span>Service ' + svcPct + '%</span><span class="money">' + F(svc) + '</span></div>' : '') + (spendVal ? '<div class="row between"><span>Points (' + fmt(spend) + ')</span><span class="money">−' + F(spendVal) + '</span></div>' : '') + '<div class="row between b"><span>To pay</span><span class="money" style="font-size:17px">' + F(total) + '</span></div></div></div>' +
      (loyal ? '<div class="card pad mb"><div class="row between"><b>Loyalty</b>' + (ui.cust ? '<span class="small">' + esc(ui.cust.name) + ' · <b>' + fmt(pts) + '</b> points</span>' : '') + '</div><div class="row mt">' + inp('lyQ', '', 'placeholder="Customer phone or name" id="lyQ"') + '<button type="button" class="btn sm" data-a="lyFind">Find</button></div>' + (ui.cust && pts ? field('Use points (1 point = ' + fmt(num(S().pointValue) || 10) + ')', inp('lySpend', ui.spend || '', 'inputmode="numeric" id="lySpend"')) : '') + (ui.cust ? '<div class="hint">Earns ' + fmt(Math.floor(total / (num(S().loyaltyPer) || 1000))) + ' points on this bill</div>' : '') + '</div>' : '') +
      (has('tabsPlus') ? '<div class="grid2 mb">' + field('Tip (optional)', inp('tip', '', 'inputmode="numeric" placeholder="0"')) + field('Split equally between', sel('split', [1, 2, 3, 4, 5, 6, 8, 10].map((n) => [n, n === 1 ? 'No split' : n + ' people']), ui.split, 'id="bSplit"')) + '</div>' + (ui.split > 1 ? '<div class="alert info mb">Each pays <b>' + F(Math.ceil(total / ui.split)) + '</b>. Take the first payment now, the others one by one.</div>' : '') : '') +
      (tab.deposit && num(tab.deposit.amount) > 0 && !tab.depositUsed ? '<div class="alert ok mb">Deposit from the reservation: ' + F(tab.deposit.amount) + ' (' + esc(tab.deposit.method || 'Cash') + ') — counted in this bill.</div>' : '') +
      (can('discount') ? field('Discount (optional)', inp('disc', '', 'inputmode="numeric" placeholder="0"')) : '') +
      payFields(Math.max(0, Math.round((ui.split > 1 ? Math.ceil(total / ui.split) : total) - (tab.deposit && !tab.depositUsed ? num(tab.deposit.amount) : 0))), { kind: 'sale' }));
    syncPayCharges(sh);
    $('.sf', sh).innerHTML = '<button class="btn grow" data-a="sheetClose">Later</button><button class="btn pri grow" id="bpGo"' + (chosen.length ? '' : ' disabled') + '>' + ic('check') + 'Take payment</button>';
    $('#bpGo', sh).onclick = async () => { const done = await paySale(tab, chosen, { svc, spend, spendVal, cust: ui.cust, total }); if (done) { ui.pick = null; ui.spend = 0; if (K.sheets.includes(sh)) sh._refresh(); } }; // the rest: whole bill again
  };
  sh.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-bm]'); if (m) { ui.pick = m.dataset.bm === 'pick' ? {} : null; sh._refresh(); return; }
    const p = e.target.closest('[data-pk]'); if (p) { const k = p.dataset.k; const v = num(ui.pick[k] || 0) + (p.dataset.pk === '+' ? 1 : -1); ui.pick[k] = Math.max(0, Math.min(v, num(p.dataset.max || v))); sh._refresh(); return; }
    if (e.target.closest('[data-a=lyFind]')) { const qv = ($('#lyQ', sh).value || '').trim().toLowerCase(); if (!qv) return; let c = K.raw.customers.find((x) => (x.phone || '').replace(/\D/g, '').endsWith(qv.replace(/\D/g, '')) && qv.replace(/\D/g, '').length >= 6) || K.raw.customers.find((x) => (x.name || '').toLowerCase().includes(qv));
      if (!c && /\d{8,}/.test(qv.replace(/\D/g, '')) && can('customers')) { c = { id: uid('c_'), name: 'Customer ' + qv.slice(-4), phone: qv, type: 'Retail' }; await save('customers', c); toast('New loyalty customer added'); }
      ui.cust = c || null; if (!c) toast('No customer found', true); sh._refresh(); }
  });
  sh.addEventListener('change', (e) => { if (e.target.id === 'bSplit') { ui.split = num(e.target.value) || 1; sh._refresh(); } if (e.target.id === 'lySpend') { ui.spend = num(e.target.value); sh._refresh(); } });
  sh._refresh();
}
async function paySale(tab, chosen, o) {
  const sh = K.sheets[K.sheets.length - 1]; const v = formVals(sh);
  const p = readPayment(v, 'sale'); if (p === false) return;
  const tip = has('tabsPlus') ? Math.max(0, Math.round(num(v.tip))) : 0; const disc = can('discount') ? Math.max(0, num(v.disc)) : 0;
  const lines = chosen.map((l) => { const m = menuById(l.menuId) || { uses: [] }; return { productId: 'm:' + l.menuId, menuId: l.menuId, name: l.name, qty: l.qty, unitPrice: l.price, category: l.category || m.category || 'Menu', alloc: KC.allocMenu(K.C, K.raw.lots, m, l.qty, K.loc) }; });
  if (o.svc) lines.push({ productId: 'svc', name: 'Service charge', qty: 1, unitPrice: o.svc, category: 'Service', alloc: [] });
  if (tip) lines.push({ productId: 'tip', name: 'Tip', qty: 1, unitPrice: tip, category: 'Tips', alloc: [], tipFor: tab.waiterId || K.me.id });
  const now = new Date(); const payments = [];
  if (tab.deposit && num(tab.deposit.amount) > 0 && !tab.depositUsed) payments.push({ id: uid('p_'), date: tab.deposit.date || todayStr(), method: tab.deposit.method || 'Cash', amount: num(tab.deposit.amount), fee: 0, ref: 'Reservation deposit', by: tab.deposit.by || '' });
  if (p) payments.push(p);
  const cust = o.cust;
  const sale = { id: uid('s_'), no: saleNo(), date: todayStr(), createdAt: now.toISOString(), status: 'open', createdBy: K.me.name || '', createdById: K.me.id || '', customerId: cust ? cust.id : null, customerName: cust ? cust.name : (tab.customerName || (tab.tableLabel ? 'Table ' + tab.tableLabel : 'Counter')), customerPhone: cust ? cust.phone || '' : '',
    lines, discount: disc + num(o.spendVal), payments, locationId: K.loc, delivered: true, source: 'resto', tabId: tab.id, tableLabel: tab.tableLabel || '', waiterId: tab.waiterId || K.me.id };
  if (tip) sale.tip = tip;
  if (cust && has('loyalty') && S().loyaltyOn) sale.loyalty = { earn: Math.floor(Math.max(0, o.total - disc) / (num(S().loyaltyPer) || 1000)), spend: num(o.spend) };
  const t = KC.saleTotals(sale); if (!payments.length && !(await confirmBox('No payment entered. Keep this bill unpaid (the customer owes ' + F(t.due) + ')?', 'Keep unpaid'))) return;
  if (typeof applySaleTxnId === 'function') applySaleTxnId(sale, true);
  if (!(await save('sales', sale))) return;
  const n = Object.assign({}, tab, { saleIds: (tab.saleIds || []).concat([sale.id]) }); if (payments.some((x) => x.ref === 'Reservation deposit')) n.depositUsed = true;
  await save('tabs', n); recompute(); await closeTabIfDone(tab.id, sale.id, sale); return true;
}
async function closeTabIfDone(tabId, saleId, saved) {
  const tab = (K.raw.tabs || []).find((x) => x.id === tabId); if (!tab || tab.status !== 'open') return;
  if (!dueLines(tab).length && tabOwing(tab, saved) < 0.5) {
    await save('tabs', Object.assign({}, tab, { status: 'paid', closedAt: new Date().toISOString(), closedBy: K.me.name || '' }));
    (K.raw.rorders || []).filter((o) => o.tabId === tabId && ['new', 'accepted', 'ready'].includes(o.status)).forEach((o) => save('rorders', Object.assign({}, o, { status: o.status === 'new' ? 'rejected' : 'served', servedAt: o.servedAt || new Date().toISOString(), rejectReason: o.status === 'new' ? 'Bill closed' : o.rejectReason })));
    const t = (K.raw.tables || []).find((x) => x.id === tab.tableId); if (t && t.call) { const c = Object.assign({}, t); delete c.call; save('tables', c); }
    while (K.sheets.length) closeSheet(); toast('Paid · ' + (tab.tableLabel || 'counter') + ' is free'); scheduleRender();
    if (saleId && typeof openSale === 'function') setTimeout(() => openSale(saleId), 300); // receipt: print or WhatsApp
  } else { refreshSheets(); scheduleRender(); toast('Payment recorded'); }
}
/* the counter (pay-first): pay now, then the ticket goes to the bar / kitchen */
function payCounter(cart, sh0) {
  const lines0 = ticketLines(cart); const total = lines0.reduce((a, l) => a + l.qty * l.price, 0);
  const sh = openSheet({ title: 'Counter sale · ' + F(total), body: payFields(total, { kind: 'sale' }), foot: '<button class="btn grow" data-a="sheetClose">Back</button><button class="btn pri grow" id="cpGo">' + ic('check') + 'Paid · send</button>' });
  syncPayCharges(sh);
  $('#cpGo', sh).onclick = async () => {
    const p = readPayment(formVals(sh), 'sale'); if (p === false) return; if (!p) return toast('Enter the amount', true);
    const now = new Date().toISOString(); const tab = { id: uid('tb_'), tableId: '', tableLabel: 'Counter', status: 'open', openedAt: now, waiterId: K.me.id, source: 'counter' };
    const st = {}; lines0.forEach((l) => (st[l.station] = { s: 'todo' }));
    const o = { id: uid('ro_'), no: shortNo(), tabId: tab.id, tableId: '', tableLabel: 'Counter', source: 'counter', waiterIds: [K.me.id], waiterId: K.me.id, status: 'accepted', acceptedAt: now, createdAt: now, by: K.me.name || '', lines: lines0, st, paid: true };
    if (!(await save('tabs', tab)) || !(await save('rorders', o))) return;
    const lines = lines0.map((l) => { const m = menuById(l.menuId) || { uses: [] }; return { productId: 'm:' + l.menuId, menuId: l.menuId, name: l.name, qty: l.qty, unitPrice: l.price, category: l.category || 'Menu', alloc: KC.allocMenu(K.C, K.raw.lots, m, l.qty, K.loc) }; });
    const sale = { id: uid('s_'), no: saleNo(), date: todayStr(), createdAt: now, status: 'open', createdBy: K.me.name || '', createdById: K.me.id || '', customerId: null, customerName: 'Counter', lines, discount: 0, payments: [p], locationId: K.loc, delivered: true, source: 'resto', tabId: tab.id, tableLabel: 'Counter', waiterId: K.me.id };
    if (typeof applySaleTxnId === 'function') applySaleTxnId(sale, true);
    if (!(await save('sales', sale))) return;
    await save('tabs', Object.assign({}, tab, { saleIds: [sale.id], status: 'paid', closedAt: now }));
    while (K.sheets.length) closeSheet(); toast('Paid · ticket #' + o.no + ' sent'); scheduleRender();
  };
}

/* ---------- move, merge, print (tabsPlus) ---------- */
A.tabMore = (el) => {
  const tab = (K.raw.tabs || []).find((x) => x.id === el.dataset.id); if (!tab) return;
  const free = rTables().filter((t) => !openTab(t.id)); const others = (K.raw.tabs || []).filter((x) => x.status === 'open' && x.id !== tab.id && x.tableId);
  const sh = openSheet({ title: tab.tableLabel + ' · more', body: '<div class="col">' + field('Move to a free table', sel('mv', [['', 'Choose…']].concat(free.map((t) => [t.id, t.label])), '')) + field('Merge another table into this bill', sel('mg', [['', 'Choose…']].concat(others.map((x) => [x.id, x.tableLabel + ' · ' + fmt(tabDue(x))])), '')) + '<button type="button" class="btn" data-a="tabPrint" data-id="' + tab.id + '">' + ic('dl') + 'Print the bill</button></div>',
    foot: '<button class="btn grow" data-a="sheetClose">Close</button><button class="btn pri grow" id="tmGo">Apply</button>' });
  $('#tmGo', sh).onclick = async () => {
    const v = formVals(sh);
    if (v.mv) { const t = rTables().find((x) => x.id === v.mv); await save('tabs', Object.assign({}, tab, { tableId: t.id, tableLabel: t.label })); for (const o of (K.raw.rorders || []).filter((x) => x.tabId === tab.id)) await save('rorders', Object.assign({}, o, { tableId: t.id, tableLabel: t.label })); toast('Moved to ' + t.label); }
    if (v.mg) { const b = (K.raw.tabs || []).find((x) => x.id === v.mg); for (const o of (K.raw.rorders || []).filter((x) => x.tabId === b.id)) await save('rorders', Object.assign({}, o, { tabId: tab.id })); await save('tabs', Object.assign({}, b, { status: 'merged', mergedInto: tab.id, closedAt: new Date().toISOString() })); toast(b.tableLabel + ' merged into this bill'); }
    while (K.sheets.length) closeSheet(); scheduleRender();
  };
};
A.tabPrint = (el) => {
  const tab = (K.raw.tabs || []).find((x) => x.id === el.dataset.id); if (!tab) return; const ls = dueLines(tab); const tot = ls.reduce((a, l) => a + l.qty * l.price, 0);
  const w = window.open('', '_blank', 'width=380,height=640'); if (!w) return toast('Allow pop-ups to print', true);
  w.document.write('<!doctype html><meta charset="utf-8"><title>Bill</title><style>body{font:14px system-ui;margin:16px;max-width:300px}h2{margin:0 0 4px;font-size:16px}td{padding:3px 0}.r{text-align:right}hr{border:0;border-top:1px dashed #999}</style><h2>' + esc(S().businessName) + '</h2><div>' + esc(tab.tableLabel) + ' · ' + fmtDT(new Date().toISOString()) + '</div><hr><table style="width:100%">' + ls.map((l) => '<tr><td>' + l.qty + ' × ' + esc(l.name) + '</td><td class="r">' + fmt(l.qty * l.price) + '</td></tr>').join('') + '</table><hr><table style="width:100%"><tr><td><b>Total</b></td><td class="r"><b>' + F(tot) + '</b></td></tr></table><p>' + esc(S().receiptFooter || '') + '</p><script>print()<\/script>');
  w.document.close();
};

/* ================= TABLES & AREAS set-up, QR codes ================= */
A.floorSetup = async () => {
  await ensureMenuKey();
  const sh = openSheet({ title: 'Tables & areas', wide: true, body: '' });
  sh._refresh = () => {
    const lim = planMax('maxTables'); const n = rTables().length;
    setSheetBody(sh, '<div class="row wrap mb"><button class="btn pri" data-a="tblEdit">' + ic('plus') + 'Add a table</button><button class="btn" data-a="tblMany">' + ic('plus') + 'Add several</button><button class="btn" data-a="areaEdit">' + ic('plus') + 'Add an area</button><button class="btn" data-a="qrPrint">' + ic('dl') + 'Print QR codes</button></div>' +
      (lim ? '<div class="hint mb">' + n + ' of ' + lim + ' tables in your plan.</div>' : '') +
      (rAreas().length ? '<h3 class="mb">Areas</h3><div class="card list mb">' + rAreas().map((a) => '<div class="li" data-a="areaEdit" data-id="' + a.id + '"><div class="grow"><div class="t">' + esc(a.name) + '</div><div class="tiny muted">' + ((a.waiterIds || []).map(personName).filter(Boolean).join(', ') || 'Any waiter') + ' · ' + rTables().filter((t) => t.areaId === a.id).length + ' tables</div></div>' + ic('edit', 'sm') + '</div>').join('') + '</div>' : '') +
      '<h3 class="mb">Tables</h3><div class="card list">' + (rTables().map((t) => '<div class="li" data-a="tblEdit" data-id="' + t.id + '"><div class="av">' + esc(String(t.label).slice(0, 3)) + '</div><div class="grow"><div class="t">' + esc(t.label) + '</div><div class="tiny muted">' + [areaName(t.areaId), fmt(num(t.seats)) + ' seats', t.waiterId ? personName(t.waiterId) : ''].filter(Boolean).join(' · ') + '</div></div>' + ic('edit', 'sm') + '</div>').join('') || '<div class="empty small">No tables yet.</div>') + '</div>');
  };
  sh._refresh();
};
A.areaEdit = (el) => {
  const id = el.dataset.id; const a = id ? rAreas().find((x) => x.id === id) : { waiterIds: [] }; const ps = people();
  const sh = openSheet({ title: id ? 'Edit area' : 'New area', body: '<div class="col">' + field('Name', inp('name', a.name, 'placeholder="e.g. Terrace, VIP, Bar counter"')) + '<div class="lbl-t">Waiters for this area <span class="hint">(they get its orders; none = everyone)</span></div><div class="perm-grid">' + ps.map((p) => '<label class="check"><input type="checkbox" name="w_' + p.id + '"' + ((a.waiterIds || []).includes(p.id) ? ' checked' : '') + '> ' + esc(p.name) + '</label>').join('') + '</div></div>',
    foot: (id ? '<button class="btn danger" id="arDel">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="arGo">Save</button>' });
  $('#arGo', sh).onclick = async () => { const v = formVals(sh); if (!(v.name || '').trim()) return toast('Type a name', true); const w = ps.filter((p) => v['w_' + p.id]).map((p) => p.id); if (await save('areas', Object.assign({}, a, { id: id || uid('ar_'), name: v.name.trim(), waiterIds: w }))) { closeSheet(); refreshSheets(); } };
  if (id) $('#arDel', sh).onclick = async () => { if (rTables().some((t) => t.areaId === id)) return toast('Move its tables to another area first', true); if (await confirmBox('Delete ' + a.name + '?', 'Delete', true)) { await remove('areas', id); closeSheet(); refreshSheets(); } };
};
A.tblEdit = (el) => {
  const id = el.dataset.id; const t = id ? (K.raw.tables || []).find((x) => x.id === id) : { seats: 4, areaId: K.ui.floorArea || '' };
  const sh = openSheet({ title: id ? 'Edit ' + t.label : 'New table', body: '<div class="col"><div class="grid2">' + field('Label', inp('label', t.label, 'placeholder="e.g. T4, VIP 2"')) + field('Seats', inp('seats', t.seats, 'inputmode="numeric"')) + '</div>' + field('Area', sel('areaId', [['', 'No area']].concat(rAreas().map((a) => [a.id, a.name])), t.areaId)) + field('Its own waiter (optional)', sel('waiterId', [['', 'The area\'s waiters']].concat(people().map((p) => [p.id, p.name])), t.waiterId || '')) +
      (id && t.token && S().menuKey ? '<div class="hint">QR link: <a href="' + esc(tableLink(t)) + '" target="_blank" rel="noopener">' + esc(tableLink(t)) + '</a></div><button type="button" class="btn sm" data-a="tblNewQr" data-id="' + id + '">New QR code (the old one stops working)</button>' : '') + '</div>',
    foot: (id ? '<button class="btn danger" id="tbDel" title="Remove">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="tbGo">Save</button>' });
  $('#tbGo', sh).onclick = async () => { const v = formVals(sh); const label = (v.label || '').trim(); if (!label) return toast('Type a label', true); if (rTables().some((x) => x.id !== id && x.label.toLowerCase() === label.toLowerCase())) return toast('There is already a table ' + label, true); if (await save('tables', Object.assign({}, t, { id: id || uid('tbl_'), label, seats: num(v.seats) || 0, areaId: v.areaId, waiterId: v.waiterId, token: t.token || tokenId() }))) { closeSheet(); refreshSheets(); scheduleRender(); } };
  if (id) $('#tbDel', sh).onclick = async () => { if (openTab(id)) return toast('Close its bill first', true); if (await confirmBox('Remove table ' + t.label + '? Its QR code stops working.', 'Remove', true)) { await save('tables', Object.assign({}, t, { archived: true })); closeSheet(); refreshSheets(); } };
};
A.tblNewQr = async (el) => { const t = (K.raw.tables || []).find((x) => x.id === el.dataset.id); if (t && await confirmBox('Make a new QR code for ' + t.label + '? Print it again: the old one stops working.', 'New code')) { await save('tables', Object.assign({}, t, { token: tokenId() })); closeSheet(); toast('New QR code ready to print'); } };
A.tblMany = () => {
  const sh = openSheet({ title: 'Add several tables', body: '<div class="col"><div class="grid2">' + field('Label start', inp('pre', 'T', 'placeholder="T"')) + field('How many', inp('n', 10, 'inputmode="numeric"')) + field('First number', inp('from', rTables().length + 1, 'inputmode="numeric"')) + field('Seats each', inp('seats', 4, 'inputmode="numeric"')) + '</div>' + field('Area', sel('areaId', [['', 'No area']].concat(rAreas().map((a) => [a.id, a.name])), '')) + '</div>', foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="tmGo">Add</button>' });
  $('#tmGo', sh).onclick = async () => { const v = formVals(sh); const n = Math.min(100, Math.max(1, num(v.n))); const from = num(v.from) || 1; let made = 0;
    for (let i = 0; i < n; i++) { const label = (v.pre || '') + (from + i); if (rTables().some((x) => x.label.toLowerCase() === label.toLowerCase())) continue; if (!(await save('tables', { id: uid('tbl_'), label, seats: num(v.seats) || 0, areaId: v.areaId, token: tokenId() }))) break; made++; }
    closeSheet(); refreshSheets(); scheduleRender(); toast(made + ' table' + (made === 1 ? '' : 's') + ' added'); };
};
/* QR codes: one card per table, ready to print and stick on the tables */
function loadScript(src) { return new Promise((ok, no) => { if ([...document.scripts].some((s) => s.src === src)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Could not load the QR tool — check the internet')); document.head.appendChild(s); }); }
A.qrPrint = async () => {
  await ensureMenuKey(); const ts = rTables(); if (!ts.length) return toast('Add tables first', true);
  try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'); } catch (e) { return toast(e.message, true); }
  const card = (t) => { const q = qrcode(0, 'M'); q.addData(tableLink(t)); q.make(); return '<div class="c"><div class="b">' + esc(S().businessName) + '</div><img src="' + q.createDataURL(6, 8) + '" alt=""><div class="t">' + esc(t.label) + '</div><div class="s">Scan to see the menu and order</div></div>'; };
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print the QR codes', true);
  w.document.write('<!doctype html><meta charset="utf-8"><title>QR codes</title><style>body{font-family:system-ui;margin:12px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.c{border:1px dashed #aaa;border-radius:12px;padding:14px;text-align:center;break-inside:avoid}.c img{width:170px;height:170px}.b{font-weight:600;font-size:13px}.t{font-size:26px;font-weight:700;margin-top:4px}.s{font-size:12px;color:#555}@media print{.c{border-color:#ccc}}</style><div class="g">' + ts.map(card).join('') + '</div><script>setTimeout(()=>print(),300)<\/script>');
  w.document.close();
};
/* one big QR code for the menu link — for the door, the counter or the bar */
A.qrMenuPrint = async () => {
  await ensureMenuKey();
  try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'); } catch (e) { return toast(e.message, true); }
  const q = qrcode(0, 'M'); q.addData(menuLink()); q.make(); const pickOn = menuOrdersOn() && S().pickTable !== false;
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print the QR code', true);
  w.document.write('<!doctype html><meta charset="utf-8"><title>Menu QR</title><style>body{font-family:system-ui;margin:0;display:grid;place-items:center;min-height:100vh;text-align:center}.b{font-size:28px;font-weight:700}.s{font-size:18px;color:#444;margin-top:8px}img{width:320px;height:320px;margin-top:16px}.u{font-size:13px;color:#777;margin-top:8px}</style><div><div class="b">' + esc(S().businessName) + '</div><img src="' + q.createDataURL(8, 8) + '" alt=""><div class="s">' + (pickOn ? 'Scan to see the menu and order from your table' : 'Scan to see the menu') + '</div><div class="u">' + esc(menuLink()) + '</div></div><script>setTimeout(()=>print(),300)<\/script>');
  w.document.close();
};

/* ================= MENU ================= */
VIEWS.menu = {
  render() {
    const items = rMenu(); const cats = [...new Set((S().menuCats || []).concat(items.map((m) => m.category || 'Other')))]; const cur = K.ui.mnCat || ''; const q = (K.ui.mnQ || '').toLowerCase();
    const list = items.filter((m) => (!cur || (m.category || 'Other') === cur) && (!q || m.name.toLowerCase().includes(q))).sort((a, b) => cats.indexOf(a.category) - cats.indexOf(b.category) || a.name.localeCompare(b.name));
    const kind = { plain: '', stock: 'From stock', portion: 'Glass / shot', recipe: 'Recipe' };
    return '<div class="row wrap mb">' + (can('menu') ? '<button class="btn pri" data-a="mnEdit">' + ic('plus') + 'New item</button><button class="btn" data-a="mnCats">' + ic('tag') + 'Categories</button>' : '') + (S().menuKey ? '<button class="btn ghost" data-a="mnLink">' + ic('copy') + 'Menu link</button>' : '') + '</div>' +
      (hhLive() ? '<div class="alert ok mb">Happy hour now: −' + num(S().happyHour.pct) + '% until ' + esc(S().happyHour.to) + '</div>' : '') +
      '<div class="search mb">' + ic('search') + '<input class="inp" placeholder="Search the menu" value="' + esc(K.ui.mnQ || '') + '" data-c="mnQ"></div>' +
      '<div class="chips mb">' + [['', 'All']].concat(cats.map((c) => [c, c])).map(([k, l]) => '<button class="chip' + (cur === k ? ' on' : '') + '" data-a="mnCat" data-v="' + esc(k) + '">' + esc(l) + '</button>').join('') + '</div>' +
      (list.length ? '<div class="card list">' + list.map((m) => { const u = m.uses && m.uses.length ? KC.menuUnits(K.C, m, K.loc) : null; const out = m.soldOut || u === 0; return '<div class="li mn-i' + (m.active === false ? ' off' : '') + '"' + (can('menu') ? ' data-a="mnEdit" data-id="' + m.id + '"' : '') + '>' + (m.photo ? '<img class="mn-ph" src="' + esc(imgSrc(m.photo)) + '" alt="">' : '<div class="av">' + esc(initials(m.name)) + '</div>') +
        '<div class="grow" style="min-width:0"><div class="t ellipsis">' + esc(m.name) + '</div><div class="tiny muted">' + [esc(m.category || 'Other'), stations().length > 1 ? STATION[KC.stationOf(m, venue())] : '', kind[KC.menuKind(m)], u !== null && u !== Infinity ? (u === 0 ? 'no stock' : u + ' left') : '', m.active === false ? 'hidden' : ''].filter(Boolean).join(' · ') + '</div></div>' +
        '<b class="money">' + fmt(m.price) + '</b>' + (can('menu') || can('serve') ? '<label class="sw" title="Sold out" data-stop><input type="checkbox" data-c="mnOut" data-id="' + m.id + '"' + (out ? '' : ' checked') + (u === 0 ? ' disabled' : '') + '><span></span></label>' : '') + '</div>'; }).join('') + '</div>'
        : '<div class="card empty"><div class="big">🍹</div>' + (items.length ? 'Nothing here.' : 'Your menu is empty.') + (can('menu') && !items.length ? '<div class="mt"><button class="btn pri" data-a="mnEdit">' + ic('plus') + 'Add the first item</button></div>' : '') + '</div>') +
      '<p class="hint mt">The switch on each item: on = served, off = sold out (hidden from the QR menu).</p>';
  },
};
const hhLive = () => has('happyHour') && KC.hhActive(S(), new Date());
A.mnCat = (el) => { K.ui.mnCat = el.dataset.v; render(true); };
CH.mnQ = (el) => { K.ui.mnQ = el.value; render(true); };
CH.mnOut = async (el) => { const m = menuById(el.dataset.id); if (m) { await save('menu', Object.assign({}, m, { soldOut: !el.checked })); toast(m.name + (el.checked ? ' is back on the menu' : ' is sold out')); } };
document.addEventListener('click', (e) => { if (e.target.closest('[data-stop]')) e.stopPropagation(); }, true);
A.mnLink = async () => { await ensureMenuKey(); await copyText(menuLink()); toast('Menu link copied — share it on WhatsApp'); };
A.mnCats = () => {
  const cats = (S().menuCats || []).slice();
  const sh = openSheet({ title: 'Menu categories', body: '<p class="hint">In the order customers see them. One per line.</p><textarea class="inp" id="mcT" rows="10">' + esc(cats.join('\n')) + '</textarea>', foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="mcGo">Save</button>' });
  $('#mcGo', sh).onclick = async () => { const v = [...new Set($('#mcT', sh).value.split('\n').map((x) => x.trim()).filter(Boolean))].slice(0, 40); if (await saveSettings({ menuCats: v })) { closeSheet(); render(true); } };
};
A.mnEdit = (el) => {
  const id = el.dataset.id; const m0 = id ? menuById(id) : { kind: 'plain', category: K.ui.mnCat || (S().menuCats || [])[0] || 'Other', uses: [], active: true }; const m = JSON.parse(JSON.stringify(m0));
  m.kind = KC.menuKind(m); const prods = K.raw.products.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name));
  const kinds = [['plain', 'Simple', 'No stock to follow (e.g. a dish you do not cost)'], ['stock', 'From stock', 'One stock item per serving (a bottle of beer, a can)']].concat(has('portions') ? [['portion', 'Glass / shot', 'Part of a bottle (e.g. 25 shots per bottle)']] : []).concat(has('recipes') ? [['recipe', 'Recipe', 'Made from ingredients in stock']] : []);
  const pOpts = [['', 'Choose a stock item…']].concat(prods.map((p) => [p.id, p.name]));
  const sh = openSheet({ title: id ? 'Edit ' + m.name : 'New menu item', wide: true, body: '' });
  const draw = () => {
    const per = m.kind === 'portion' && m.uses[0] ? Math.round(1 / num(m.uses[0].qty)) : 25;
    setSheetBody(sh, '<div class="col"><div class="grid2">' + field('Name', inp('name', m.name, 'placeholder="e.g. Grilled fish, 33 Export, Glass of red"')) + field('Price (' + baseSym() + ')', inp('price', m.price, 'inputmode="numeric"')) + '</div>' +
      '<div class="grid2">' + field('Category', sel('category', [...new Set((S().menuCats || []).concat([m.category || 'Other']))], m.category)) + (stations().length > 1 ? field('Prepared at', sel('station', [['', 'Automatic']].concat(stations().map((k) => [k, STATION[k]])), m.station || '')) : '<span></span>') + '</div>' +
      field('Description (optional)', inp('desc', m.desc, 'placeholder="What is in it, size…"')) +
      '<div class="lbl-t">Stock</div><div class="biz-pick">' + kinds.map(([k, l, h]) => '<label class="biz-opt"><input type="radio" name="kind" value="' + k + '"' + (m.kind === k ? ' checked' : '') + '><span><b>' + l + '</b><span class="hint">' + h + '</span></span></label>').join('') + '</div>' +
      (m.kind === 'stock' ? field('Stock item', sel('p0', pOpts, (m.uses[0] || {}).productId || '')) : '') +
      (m.kind === 'portion' ? '<div class="grid2">' + field('Bottle (stock item)', sel('p0', pOpts, (m.uses[0] || {}).productId || '')) + field('Servings per bottle', inp('per', per, 'inputmode="numeric"')) + '</div>' : '') +
      (m.kind === 'recipe' ? '<div id="rcp">' + (m.uses.length ? m.uses : [{ productId: '', qty: '' }]).map((u, i) => '<div class="grid2 rcp-r">' + field(i ? '' : 'Ingredient', sel('rp' + i, pOpts, u.productId || '')) + field(i ? '' : 'Quantity per serving', inp('rq' + i, u.qty, 'inputmode="decimal" placeholder="e.g. 0.25"')) + '</div>').join('') + '</div><button type="button" class="btn sm" id="rcAdd">' + ic('plus', 'sm') + 'Add ingredient</button><p class="hint">Quantities are in each stock item\'s unit (kg, piece, bottle…).</p>' : '') +
      '<div class="row wrap">' + (has('photos') ? '<button type="button" class="btn sm" id="mnPh">' + ic('cam', 'sm') + (m.photo ? 'Change photo' : 'Add photo') + '</button>' : '') + '<label class="toggle"><input type="checkbox" name="active"' + (m.active !== false ? ' checked' : '') + '>On the menu</label></div></div>');
    sh.querySelectorAll('[name=kind]').forEach((r) => (r.onchange = () => { keep(); m.kind = r.value; m.uses = []; draw(); }));
    if ($('#rcAdd', sh)) $('#rcAdd', sh).onclick = () => { keep(); m.uses.push({ productId: '', qty: '' }); draw(); };
    if ($('#mnPh', sh)) $('#mnPh', sh).onclick = async () => { const f = await photoPicker(); if (!f) return; keep(); m.photo = await storePhoto(f); draw(); toast('Photo added'); };
  };
  const keep = () => { const v = formVals(sh); ['name', 'price', 'category', 'station', 'desc'].forEach((k) => { if (v[k] !== undefined) m[k] = v[k]; }); m.active = !!v.active;
    if (m.kind === 'stock') m.uses = v.p0 ? [{ productId: v.p0, qty: 1 }] : [];
    if (m.kind === 'portion') m.uses = v.p0 ? [{ productId: v.p0, qty: Math.round(10000 / Math.max(1, num(v.per) || 25)) / 10000 }] : [];
    if (m.kind === 'recipe') { const out = []; for (let i = 0; i < 40; i++) { if (v['rp' + i] === undefined) break; if (v['rp' + i] && num(v['rq' + i]) > 0) out.push({ productId: v['rp' + i], qty: num(v['rq' + i]) }); } m.uses = out; }
    if (m.kind === 'plain') m.uses = []; };
  if (!$('.sf', sh)) { const f = document.createElement('div'); f.className = 'sf'; sh.querySelector('.sheet').appendChild(f); }
  $('.sf', sh).innerHTML = (id ? '<button class="btn danger" id="mnDel">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="mnGo">Save</button>';
  draw();
  $('#mnGo', sh).onclick = async () => { keep(); m.name = (m.name || '').trim(); if (!m.name) return toast('Type the name', true); if (!(num(m.price) > 0)) return toast('Type the price', true); if (['stock', 'portion'].includes(m.kind) && !m.uses.length) return toast('Choose the stock item', true); if (m.kind === 'recipe' && !m.uses.length) return toast('Add at least one ingredient', true);
    m.price = num(m.price); if (await save('menu', Object.assign(m, { id: id || uid('mn_') }))) { closeSheet(); render(true); toast(id ? 'Saved' : m.name + ' added to the menu'); } };
  if (id) $('#mnDel', sh).onclick = async () => { if (await confirmBox('Delete ' + m.name + ' from the menu?', 'Delete', true)) { await remove('menu', id); closeSheet(); render(true); } };
};

/* ================= RESERVATIONS ================= */
const bookingFor = (tableId) => { if (!has('reservations')) return null; const t = todayStr(); const now = new Date(); const hm = now.getHours() * 60 + now.getMinutes(); return (K.raw.reservations || []).find((r) => r.tableId === tableId && r.date === t && r.status === 'booked' && (() => { const [h, m] = String(r.time || '0:0').split(':').map(Number); const x = h * 60 + m; return x >= hm - 30 && x <= hm + 180; })()); };
VIEWS.bookings = {
  render() {
    const d = K.ui.bkDate || todayStr(); const list = (K.raw.reservations || []).filter((r) => r.date === d).sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const badge = { booked: 'info', seated: 'ok', done: '', cancelled: 'bad', noshow: 'warn' };
    return '<div class="row wrap mb"><input type="date" class="inp" style="width:auto" value="' + d + '" data-c="bkDate">' + (can('reservations') ? '<button class="btn pri" data-a="bkEdit">' + ic('plus') + 'New reservation</button>' : '') + '</div>' +
      (list.length ? '<div class="card list">' + list.map((r) => '<div class="li" data-a="bkEdit" data-id="' + r.id + '"><div class="av">' + esc(r.time || '') + '</div><div class="grow" style="min-width:0"><div class="t ellipsis">' + esc(r.name) + ' · ' + fmt(num(r.people)) + ' people</div><div class="tiny muted">' + [r.tableId ? ((K.raw.tables || []).find((t) => t.id === r.tableId) || {}).label : areaName(r.areaId), r.phone, num(r.deposit) ? 'deposit ' + fmt(r.deposit) : ''].filter(Boolean).map(esc).join(' · ') + '</div></div><span class="badge ' + (badge[r.status] || '') + '">' + esc((KC.RESV_STATUSES.find((x) => x[0] === r.status) || [0, r.status])[1]) + '</span></div>').join('') + '</div>'
        : '<div class="card empty"><div class="big">📅</div>No reservations on ' + fmtDate(d) + '.</div>');
  },
};
CH.bkDate = (el) => { K.ui.bkDate = el.value; render(true); };
A.bkEdit = (el) => {
  const id = el.dataset.id; const r = id ? (K.raw.reservations || []).find((x) => x.id === id) : { date: K.ui.bkDate || todayStr(), time: '20:00', people: 2, status: 'booked', depositMethod: 'Cash' };
  const sh = openSheet({ title: id ? r.name : 'New reservation', body: '<div class="col"><div class="grid2">' + field('Name', inp('name', r.name)) + field('Phone', inp('phone', r.phone, 'inputmode="tel"')) + field('Date', inp('date', r.date, 'type="date"')) + field('Time', inp('time', r.time, 'type="time"')) + field('People', inp('people', r.people, 'inputmode="numeric"')) +
      field('Table', sel('tableId', [['', 'Any']].concat(rTables().map((t) => [t.id, t.label])), r.tableId || '')) + field('Deposit (' + baseSym() + ')', inp('deposit', r.deposit || '', 'inputmode="numeric" placeholder="0"')) + field('Paid by', sel('depositMethod', KC.PAY_METHODS, r.depositMethod || 'Cash')) + '</div>' + field('Note', inp('note', r.note, 'placeholder="Birthday, VIP, no smoking…"')) +
      (id ? field('Status', sel('status', KC.RESV_STATUSES, r.status)) : '') + '</div>',
    foot: (id && r.status === 'booked' && r.tableId && can('serve') ? '<button class="btn" id="bkSeat">' + ic('table') + 'Seat now</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="bkGo">Save</button>' });
  $('#bkGo', sh).onclick = async () => { const v = formVals(sh); if (!(v.name || '').trim()) return toast('Type the name', true); if (await save('reservations', Object.assign({}, r, v, { id: id || uid('rv_'), people: num(v.people), deposit: num(v.deposit), by: r.by || K.me.name || '' }))) { closeSheet(); render(true); } };
  if ($('#bkSeat', sh)) $('#bkSeat', sh).onclick = async () => {
    const t = (K.raw.tables || []).find((x) => x.id === r.tableId); if (!t) return; if (openTab(t.id)) return toast(t.label + ' is busy', true);
    const tab = { id: uid('tb_'), tableId: t.id, tableLabel: t.label, status: 'open', openedAt: new Date().toISOString(), customerName: r.name, waiterId: K.me.id, source: 'reservation', reservationId: r.id };
    if (num(r.deposit) > 0) tab.deposit = { amount: num(r.deposit), method: r.depositMethod || 'Cash', date: r.date, by: r.by || '' };
    await save('tabs', tab); await save('reservations', Object.assign({}, r, { status: 'seated', seatedAt: new Date().toISOString() })); closeSheet(); toast(r.name + ' seated at ' + t.label); go('floor');
  };
};

/* ================= VENUE SETTINGS ================= */
A.venueSettings = () => {
  const s = S(); const hh = s.happyHour || { on: false, from: '17:00', to: '19:00', pct: 20, days: [], cats: [] };
  const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const sh = openSheet({ title: 'Venue settings', wide: true, body: '<div class="col">' +
    field('What do you run?', sel('venueType', KC.VENUE_TYPES, venue())) +
    '<label class="toggle"><input type="checkbox" name="qrOn"' + (s.qrOn !== false ? ' checked' : '') + (has('qrOrders') ? '' : ' disabled') + '>Customers can order from their phone' + (has('qrOrders') ? '' : ' <span class="hint">(not in your plan)</span>') + '</label>' +
    (has('qrOrders') ? '<label class="toggle"><input type="checkbox" name="pickTable"' + (s.pickTable !== false ? ' checked' : '') + '>On the menu link, customers choose their table <span class="hint">(off: only the QR code on each table)</span></label>' : '') +
    field('An order is late after (minutes)', inp('lateMins', s.lateMins || 15, 'inputmode="numeric"')) +
    (has('payFirst') ? '<label class="toggle"><input type="checkbox" name="payFirst"' + (s.payFirst ? ' checked' : '') + '>Pay-first counter (order and pay at the counter)</label>' : '') +
    (has('tabsPlus') ? field('Service charge (%)', inp('serviceCharge', s.serviceCharge || '', 'inputmode="decimal" placeholder="0 = none"')) : '') +
    (has('happyHour') ? '<div class="card pad"><label class="toggle"><input type="checkbox" name="hhOn"' + (hh.on ? ' checked' : '') + '><b>Happy hour</b></label><div class="grid3 mt">' + field('From', inp('hhFrom', hh.from, 'type="time"')) + field('To', inp('hhTo', hh.to, 'type="time"')) + field('Discount %', inp('hhPct', hh.pct, 'inputmode="numeric"')) + '</div><div class="row wrap mt">' + D.map((d, i) => '<label class="check"><input type="checkbox" name="hhd' + i + '"' + (!(hh.days || []).length || hh.days.includes(i) ? ' checked' : '') + '> ' + d + '</label>').join('') + '</div>' + field('Only these categories (empty = all)', inp('hhCats', (hh.cats || []).join(', '), 'placeholder="e.g. Beers, Cocktails"')) + '</div>' : '') +
    (has('loyalty') ? '<div class="card pad"><label class="toggle"><input type="checkbox" name="loyaltyOn"' + (s.loyaltyOn ? ' checked' : '') + '><b>Loyalty points</b></label><div class="grid2 mt">' + field('1 point for every (' + baseSym() + ')', inp('loyaltyPer', s.loyaltyPer || 1000, 'inputmode="numeric"')) + field('1 point is worth (' + baseSym() + ')', inp('pointValue', s.pointValue || 10, 'inputmode="numeric"')) + '</div></div>' : '') +
    '</div>', foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="vsGo">Save</button>' });
  $('#vsGo', sh).onclick = async () => {
    const v = formVals(sh); const patch = { venueType: v.venueType, qrOn: !!v.qrOn, lateMins: Math.max(1, num(v.lateMins) || 15) }; if (has('qrOrders')) patch.pickTable = !!v.pickTable;
    if (has('payFirst')) patch.payFirst = !!v.payFirst;
    if (has('tabsPlus')) patch.serviceCharge = Math.max(0, Math.min(30, num(v.serviceCharge)));
    if (has('happyHour')) { const days = D.map((_, i) => i).filter((i) => v['hhd' + i]); patch.happyHour = { on: !!v.hhOn, from: v.hhFrom || '17:00', to: v.hhTo || '19:00', pct: Math.max(0, Math.min(90, num(v.hhPct))), days: days.length === 7 ? [] : days, cats: String(v.hhCats || '').split(',').map((x) => x.trim()).filter(Boolean) }; }
    if (has('loyalty')) { patch.loyaltyOn = !!v.loyaltyOn; patch.loyaltyPer = Math.max(1, num(v.loyaltyPer) || 1000); patch.pointValue = Math.max(0, num(v.pointValue) || 10); }
    if (v.venueType !== venue() && !(S().menuCats || []).length) patch.menuCats = KC.MENU_CATS[v.venueType].slice();
    if (await saveSettings(patch)) { closeSheet(); render(true); toast('Venue settings saved'); }
  };
};

/* ================= WAITER & TABLE REPORTS ================= */
VIEWS.rstats = {
  render() {
    const days = num(K.ui.rsDays) || 7; const from = KC.addDays(todayStr(), -(days - 1));
    const sales = visibleSales().filter((s) => s.source === 'resto' && s.status !== 'cancelled' && saleDate(s) >= from);
    const ords = (K.raw.rorders || []).filter((o) => String(o.createdAt).slice(0, 10) >= from);
    const W = {}; const w = (id) => (W[id] = W[id] || { id, sales: 0, bills: 0, tips: 0, serve: [], tickets: 0 });
    sales.forEach((s) => { const x = w(s.waiterId || s.createdById || '?'); x.sales += K.C.saleX[s.id].net; x.bills++; (s.lines || []).forEach((l) => { if (l.productId === 'tip') x.tips += num(l.unitPrice) * num(l.qty); }); });
    ords.forEach((o) => { if (!o.waiterId) return; const x = w(o.waiterId); x.tickets++; if (o.servedAt && (o.acceptedAt || o.createdAt)) x.serve.push((new Date(o.servedAt) - new Date(o.acceptedAt || o.createdAt)) / 60000); });
    const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
    const tabs = (K.raw.tabs || []).filter((t) => t.status === 'paid' && t.tableId && String(t.closedAt).slice(0, 10) >= from);
    const T = {}; tabs.forEach((t) => { const x = (T[t.tableLabel] = T[t.tableLabel] || { n: 0, m: [] }); x.n++; x.m.push((new Date(t.closedAt) - new Date(t.openedAt)) / 60000); });
    const H = new Array(24).fill(0); sales.forEach((s) => { const h = new Date(s.createdAt).getHours(); H[h] += K.C.saleX[s.id].net; }); const hmax = Math.max(1, ...H);
    return '<div class="chips mb">' + [[1, 'Today'], [7, '7 days'], [30, '30 days']].map(([k, l]) => '<button class="chip' + (days === k ? ' on' : '') + '" data-a="rsDays" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      '<h3 class="mb">Waiters</h3>' + dataTable({ id: 'rsW', rows: Object.values(W), noun: 'waiter', bar: false, cols: [
        { k: 'n', label: 'Waiter', core: true, v: (x) => personName(x.id) || 'Other' },
        { k: 's', label: 'Sales', core: true, money: true, v: (x) => Math.round(x.sales) },
        { k: 'b', label: 'Bills', core: true, st: false, num: true, v: (x) => x.bills },
        { k: 't', label: 'Tips', core: true, money: true, v: (x) => x.tips || '' },
        { k: 'm', label: 'Avg serve (min)', core: true, num: true, v: (x) => avg(x.serve) ?? '' } ] }) +
      '<h3 class="mb mt2">Tables</h3>' + dataTable({ id: 'rsT', rows: Object.entries(T).map(([k, x]) => ({ k, n: x.n, m: avg(x.m) })), noun: 'table', bar: false, cols: [
        { k: 'k', label: 'Table', core: true, v: (x) => x.k }, { k: 'n', label: 'Bills', core: true, num: true, v: (x) => x.n }, { k: 'm', label: 'Avg stay (min)', core: true, num: true, v: (x) => x.m ?? '' } ] }) +
      '<h3 class="mb mt2">Busiest hours</h3><div class="card pad hours">' + H.map((v, h) => (v ? '<div class="hr"><span>' + pad2(h) + 'h</span><i style="width:' + Math.round(v / hmax * 100) + '%"></i><b>' + fmt(v) + '</b></div>' : '')).join('') + '</div>';
  },
};
A.rsDays = (el) => { K.ui.rsDays = el.dataset.v; render(true); };
