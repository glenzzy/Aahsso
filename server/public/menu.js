/* Aahsso Bar & Resto — the menu customers open on their phone.
 * /t/<menuKey>/<tableToken>: the QR code on a table — menu + ordering (name only) + their orders' progress + call the waiter / ask for the bill.
 * /m/<menuKey>: the venue's public menu — the customer picks their table, then orders the same way (or only browses
 * when the venue switched that off). Prices always come from the server. No login.
 * Layout: one column on phones (basket in a bar + sheet); categories · dishes · your order side by side on wide screens. */
(function () {
  'use strict';
  const m = location.pathname.match(/^\/(t|m)\/([A-Za-z0-9][A-Za-z0-9-]*)(?:\/([A-Za-z0-9]+))?/) || [];
  const KEY = m[2] || '', TOKEN = m[1] === 't' ? m[3] || '' : '';
  const API = '/api/menu/' + encodeURIComponent(KEY);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
  const DEV = store.get('aahsso-menu-dev', '') || (() => { const d = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('aahsso-menu-dev', d); return d; })();
  const CART_KEY = 'aahsso-menu-cart-' + KEY + '-' + TOKEN;
  const S = { d: null, cart: store.get(CART_KEY, {}), cat: '', name: store.get('aahsso-menu-name', ''), note: '', status: null, tableId: '', sending: false,
    mode: TOKEN ? 'table' : store.get('aahsso-menu-mode-' + KEY, ''), phone: store.get('aahsso-menu-phone', ''), addr: store.get('aahsso-menu-addr-' + KEY, ''), zone: store.get('aahsso-menu-zone-' + KEY, ''),
    who: 'me', byName: '', byPhone: '', when: 'asap', pay: 'Cash', payRef: '', track: null };
  /* delivery & pickup: the orders this phone sent (kept a day) and their progress */
  const AWAY_KEY = 'aahsso-menu-away-' + KEY;
  const awayIds = () => store.get(AWAY_KEY, []).filter((x) => Date.now() - x.at < 24 * 3600e3);
  const tw = () => (S.d && !TOKEN ? S.d.takeaway : null);
  const away = () => S.mode === 'delivery' || S.mode === 'pickup';
  const canAdd = () => (away() ? !!tw() : S.d.canOrder);
  const fee = () => { const t = tw(); if (!t || S.mode !== 'delivery') return 0; if (t.zones && t.zones.length) { const z = t.zones.find((x) => x.name === S.zone); return z ? z.fee : 0; } return t.fee || 0; };
  const setMode = (m) => { S.mode = m; store.set('aahsso-menu-mode-' + KEY, m); };
  /* the table picked on the public link is remembered for one evening (8 hours) */
  const PICK_KEY = 'aahsso-menu-table-' + KEY;
  if (!TOKEN) { const p = store.get(PICK_KEY, null); if (p && p.id && Date.now() - (p.at || 0) < 8 * 3600e3) S.tableId = p.id; }
  const picked = () => (S.d && S.d.tables || []).find((x) => x.id === S.tableId) || null;
  const tableNow = () => (S.d && S.d.table) || picked();
  const tq = () => (TOKEN ? 't=' + encodeURIComponent(TOKEN) : 'table=' + encodeURIComponent(S.tableId));
  const tbody = () => (TOKEN ? { t: TOKEN } : { table: S.tableId });
  const pick = (id) => { S.tableId = id; store.set(PICK_KEY, id ? { id, at: Date.now() } : null); S.status = null; };
  const fmt = (v) => Math.round(Number(v) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const money = (v) => fmt(v) + ' ' + (S.d ? S.d.business.symbol : 'FCFA');
  const img = (ref) => !ref ? '' : /^(data:|https?:)/.test(ref) ? ref : '/api/images/' + encodeURIComponent(ref);
  const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const item = (id) => S.d.items.find((i) => i.id === id);
  const lines = () => Object.entries(S.cart).map(([id, q]) => ({ it: item(id), q })).filter((l) => l.it && l.q > 0 && !l.it.soldOut);
  const total = () => lines().reduce((a, l) => a + l.q * l.it.priceNow, 0);
  const count = () => lines().reduce((a, l) => a + l.q, 0);
  const save = () => store.set(CART_KEY, S.cart);
  const app = $('#app');
  const req = async (method, path, body) => { const r = await fetch(API + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong — try again'); return j; };
  const LBL = { new: 'Received', accepted: 'Being prepared', ready: 'On its way', served: 'Served', rejected: 'Not possible' };
  const wide = () => window.matchMedia('(min-width:1000px)').matches;

  async function load() {
    try { S.d = await req('GET', TOKEN ? '?t=' + encodeURIComponent(TOKEN) : ''); }
    catch (e) { app.innerHTML = '<div class="m-empty"><div style="font-size:34px">🍽️</div>' + esc(e.message) + '</div>'; return; }
    if (!TOKEN && S.tableId && !picked()) pick(''); // that table is gone
    const t = tw(); const modes = (S.d.canOrder ? ['table'] : []).concat(t && t.delivery ? ['delivery'] : []).concat(t && t.pickup ? ['pickup'] : []);
    if (!TOKEN && !modes.includes(S.mode)) setMode(modes[0] || 'table');
    if (t && t.pay && !t.pay.some((p) => p.method === S.pay)) S.pay = 'Cash';
    document.title = S.d.business.name + ' · Menu'; draw(); if (S.d.canOrder || t || awayIds().length) poll();
  }
  const status = () => req('GET', '/status?' + tq() + '&d=' + encodeURIComponent(DEV));
  async function poll() {
    if (tableNow() && S.mode === 'table') { try { S.status = await status(); drawMine(); } catch (e) { } }
    const ids = awayIds(); if (ids.length) { try { S.track = await req('GET', '/track?o=' + ids.map((x) => x.id).join(',') + '&d=' + encodeURIComponent(DEV)); drawMine(); } catch (e) { } }
    setTimeout(poll, 10000);
  }

  /* ---------- the page ---------- */
  function draw() {
    const d = S.d; const b = d.business; const tbl = tableNow();
    const cats = d.cats.filter((c) => d.items.some((i) => i.category === c));
    if (S.cat && !cats.includes(S.cat)) S.cat = '';
    const shown = cats.filter((c) => !S.cat || c === S.cat);
    const catBtns = [['', 'All']].concat(cats.map((c) => [c, c])).map(([k, l]) => '<button class="m-chip' + (S.cat === k ? ' on' : '') + '" data-cat="' + esc(k) + '">' + esc(l) + '</button>').join('');
    const y = window.scrollY;
    app.innerHTML =
      '<header class="m-top"><div class="m-top-in"><div class="m-logo">' + (b.logo ? '<img src="' + esc(img(b.logo)) + '" alt="">' : esc(initials(b.name))) + '</div>' +
        '<div class="m-name"><h1>' + esc(b.name) + '</h1><div>' + esc(b.tagline || 'Menu') + '</div></div>' +
        (tbl ? (d.table ? '<span class="m-tbl">' + esc(tbl.label) + '</span>' : '<button class="m-tbl" data-pick aria-label="Change table">' + esc(tbl.label) + ' ▾</button>') : '') + '</div></header>' +
      '<div class="m-wrap">' +
        '<nav class="m-side" aria-label="Categories"><div class="m-side-h">Menu</div>' + catBtns + '</nav>' +
        '<main class="m-main">' +
          (d.happyHour ? '<div class="m-hh">Happy hour: −' + d.happyHour.pct + '% until ' + esc(d.happyHour.to) + '</div>' : '') +
          (tw() ? '<div class="m-modes" role="tablist" aria-label="How do you want it?">' + [['table', '🍽️', 'At a table', d.canOrder], ['delivery', '🛵', 'Delivery', tw().delivery], ['pickup', '🛍️', 'Pickup', tw().pickup]].filter((x) => x[3]).map(([k, i, l]) => '<button role="tab" aria-selected="' + (S.mode === k) + '" class="' + (S.mode === k ? 'on' : '') + '" data-mode="' + k + '"><span>' + i + '</span>' + l + '</button>').join('') + '</div>' +
            (away() ? '<div class="m-note m-away">' + (S.mode === 'delivery' ? 'We bring it to you' + (tw().zones && tw().zones.length ? '' : tw().fee ? ' · delivery ' + money(tw().fee) : ' · free delivery') : 'Order now, collect it at ' + esc(tw().address || 'the restaurant')) + ' · ready in about ' + tw().prepMins + ' min' + (tw().minOrder ? ' · minimum ' + money(tw().minOrder) : '') + '</div>' : '') : '') +
          (S.mode === 'table' && !d.table && d.canOrder && !picked() ? '<button class="m-pick" data-pick><span><b>Order from your table</b><span>Choose your table, add what you want, send — your waiter brings it.</span></span><i>›</i></button>' : '') +
          (d.table && !d.canOrder ? '<div class="m-note">Ordering from the phone is off. Your waiter will take your order.</div>' : '') +
          '<div class="m-mine-box"></div>' +
          '<div class="m-chips">' + catBtns + '</div>' +
          shown.map((c) => '<div class="m-sec">' + esc(c) + '</div><div class="m-grid">' + d.items.filter((i) => i.category === c).map(row).join('') + '</div>').join('') +
          (shown.length ? '' : '<div class="m-empty">Nothing here yet.</div>') +
          '<div class="m-foot">Powered by Aahsso</div>' +
        '</main>' +
        '<aside class="m-cart" aria-label="Your order"><div class="m-mine-box"></div><div class="m-cart-body"></div></aside>' +
      '</div>' +
      '<div class="m-bar"></div>';
    window.scrollTo(0, y);
    drawSide();
  }
  function row(i) {
    const q = S.cart[i.id] || 0; const can = canAdd() && !i.soldOut;
    return '<div class="m-item' + (i.soldOut ? ' off' : '') + (q ? ' in' : '') + '">' +
      (i.photo ? '<img class="m-ph" src="' + esc(img(i.photo)) + '" alt="" loading="lazy">' : '<div class="m-ph">' + esc(initials(i.name)) + '</div>') +
      '<div class="m-info"><div class="m-n">' + esc(i.name) + '</div>' + (i.desc ? '<div class="m-d">' + esc(i.desc) + '</div>' : '') +
        '<div class="m-p">' + (i.priceNow < i.price ? '<s>' + fmt(i.price) + '</s>' : '') + money(i.priceNow) + (i.soldOut ? ' <em>· sold out</em>' : '') + '</div></div>' +
      (can ? (q ? stepper(i.id, q) : '<button class="m-add" data-q="+" data-id="' + esc(i.id) + '">Add</button>') : '') + '</div>';
  }
  const stepper = (id, q) => '<div class="m-qty"><button data-q="-" data-id="' + esc(id) + '" aria-label="One less">−</button><b>' + q + '</b><button class="plus" data-q="+" data-id="' + esc(id) + '" aria-label="One more">+</button></div>';

  /* ---------- your orders (status) ---------- */
  function trackHtml() {
    const os = (S.track && S.track.orders) || []; if (!os.length) return '';
    const ST = { new: '', prep: 'prep', ready: 'ready', out: 'ready', done: 'served', rejected: 'rejected' };
    return '<div class="m-card"><h2 style="margin:0 0 4px">Your ' + (os.every((o) => o.mode === 'pickup') ? 'pickup' : 'delivery') + ' orders</h2>' + os.map((o) => '<div class="m-ln"><div class="grow"><div>' + (o.mode === 'delivery' ? '🛵 ' : '🛍️ ') + esc(o.lines.map((l) => l.qty + '× ' + l.name).join(', ')) + '</div><div class="m-muted">' + esc(o.no) + ' · ' + money(o.total) + (o.reason ? ' · <span style="color:var(--bad)">' + esc(o.reason) + '</span>' : '') + '</div></div><span class="m-st ' + (ST[o.stage] || '') + '">' + esc(o.label) + '</span></div>').join('') +
      (S.d.business.phone ? '<div class="m-muted" style="margin-top:6px">Questions? Call <a href="tel:' + esc(S.d.business.phone) + '">' + esc(S.d.business.phone) + '</a></div>' : '') + '</div>';
  }
  function mineHtml() {
    if (away() || !tableNow()) return trackHtml();
    if (!S.d.canOrder) return trackHtml();
    const st = S.status; const calls = callsHtml();
    if (!st || !st.orders || !st.orders.length) return st && st.open ? calls : '';
    return '<div class="m-card"><div class="m-ln" style="padding-top:0"><h2 style="margin:0">Your orders</h2>' + (st.total ? '<span class="m-muted">Bill so far: <b style="color:var(--ink)">' + money(st.total) + '</b></span>' : '') + '</div>' +
      st.orders.map((o) => '<div class="m-ln"><div class="grow"><div>' + o.lines.map((l) => l.qty + '× ' + esc(l.name)).join(', ') + '</div><div class="m-muted">' + esc(o.no) + (o.reason ? ' · <span style="color:var(--bad)">' + esc(o.reason) + '</span>' : '') + '</div></div><span class="m-st ' + esc(o.status) + '">' + esc(LBL[o.status] || o.status) + '</span></div>').join('') +
      (st.billAsked ? '<div class="m-muted" style="color:var(--ok);margin-top:6px">Your waiter is bringing the bill.</div>' : '') + '</div>' + calls;
  }

  /* ---------- calling staff: tap = one ring, hold = the staff bell rings for as long as you held (silent on the customer's phone) ---------- */
  const RING_MIN = 650, RING_MAX = 8000; // the same as Bell.EVERY / Bell.MAX in bell.js (staff app)
  const CALLS = [['waiter', '🔔 Call the waiter'], ['bill', '🧾 Ask for the bill']];
  let hold = null; const callWait = {};
  function callsHtml() {
    return '<div class="m-calls">' + CALLS.map(([k, l]) => '<button data-call="' + k + '"' + (hold && hold.kind === k ? ' class="ringing"' : '') + ((callWait[k] || 0) > Date.now() ? ' disabled' : '') + '>' + l + '</button>').join('') + '</div>' +
      '<div class="m-calls-hint">Tap to call · hold to ring longer</div>';
  }
  const ringing = (k) => $$('[data-call]').forEach((b) => b.classList.toggle('ringing', b.dataset.call === k));
  function holdStart(b) {
    if (hold || b.disabled) return;
    hold = { kind: b.dataset.call, t0: Date.now(), cap: setTimeout(() => holdEnd(), RING_MAX) };
    ringing(hold.kind);
  }
  function holdEnd() {
    if (!hold) return; const h = hold; hold = null; clearTimeout(h.cap); ringing(null);
    callSend(h.kind, Date.now() - h.t0);
  }
  async function callSend(kind, ms) {
    callWait[kind] = Date.now() + 20000; drawMine(); setTimeout(drawMine, 20100);
    const ring = ms >= RING_MIN ? Math.min(RING_MAX, Math.round(ms)) : 0;
    try { await req('POST', '/call', { ...tbody(), kind, name: S.name, ring }); toast(kind === 'bill' ? 'Your waiter is bringing the bill' : 'Your waiter is coming'); }
    catch (err) { callWait[kind] = 0; drawMine(); toast(err.message); }
  }
  document.addEventListener('pointerdown', (e) => { const b = e.target.closest && e.target.closest('[data-call]'); if (b && e.button === 0) { e.preventDefault(); holdStart(b); } });
  ['pointerup', 'pointercancel'].forEach((ev) => document.addEventListener(ev, holdEnd));
  window.addEventListener('blur', holdEnd);
  document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('[data-call]')) e.preventDefault(); });

  /* ---------- your basket: the same form in the side card (wide) and the sheet (phone) ---------- */
  function awayForm(inSheet) {
    const t = tw(); const ls = lines(); const del = S.mode === 'delivery'; const sub = total(); const f = fee();
    if (!ls.length) return inSheet ? '' : '<div class="m-card"><h2>Your order</h2><div class="m-cart-empty">Tap <b>Add</b> on what you want' + (del ? ', then tell us where to bring it.' : ', then come and collect it.') + '</div></div>';
    const slots = (() => { const out = [['asap', 'As soon as possible (about ' + t.prepMins + ' min)']]; const d = new Date(Date.now() + t.prepMins * 60e3); d.setMinutes(Math.ceil(d.getMinutes() / 30) * 30, 0, 0); for (let i = 0; i < 10 && d.getHours() < 23 && d.getDate() === new Date().getDate(); i++) { const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); out.push([hm, 'At ' + hm]); d.setMinutes(d.getMinutes() + 30); } return out; })();
    const pm = t.pay.find((p) => p.method === S.pay) || t.pay[0];
    return '<div class="' + (inSheet ? '' : 'm-card') + '"><h2>Your order · ' + (del ? '🛵 Delivery' : '🛍️ Pickup') + '</h2>' +
      ls.map((l) => '<div class="m-ln"><div class="grow"><div>' + esc(l.it.name) + '</div><div class="m-muted">' + money(l.it.priceNow * l.q) + '</div></div>' + stepper(l.it.id, l.q) + '</div>').join('') +
      '<div class="m-sum m-sub"><span>Items</span><span>' + money(sub) + '</span></div>' + (del ? '<div class="m-sum m-sub"><span>Delivery</span><span>' + (t.zones && t.zones.length && !S.zone ? 'choose your area' : f ? money(f) : 'free') + '</span></div>' : '') +
      '<div class="m-sum"><span>Total</span><span>' + money(sub + f) + '</span></div>' + (t.minOrder && sub < t.minOrder ? '<div class="m-err">Minimum order: ' + money(t.minOrder) + '</div>' : '') +
      '<label class="m-f">Your name<input data-f="name" value="' + esc(S.name) + '" autocomplete="name" maxlength="60" placeholder="Your name"></label>' +
      '<label class="m-f">Your phone<input data-f="phone" value="' + esc(S.phone) + '" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="6 77 12 34 56 — we call you if needed"></label>' +
      (del ? (t.zones && t.zones.length ? '<label class="m-f">Your area<select data-f="zone"><option value="">Choose your area…</option>' + t.zones.map((z) => '<option value="' + esc(z.name) + '"' + (S.zone === z.name ? ' selected' : '') + '>' + esc(z.name) + ' · ' + money(z.fee) + '</option>').join('') + '</select></label>' : '') +
        '<label class="m-f">Where do we deliver?<input data-f="addr" value="' + esc(S.addr) + '" maxlength="200" placeholder="Street, building, a landmark (e.g. behind Total Akwa)"></label>'
        : '<div class="m-f"><span>Who comes to collect?</span><div class="m-seg"><button type="button" data-who="me" class="' + (S.who === 'me' ? 'on' : '') + '">Me</button><button type="button" data-who="other" class="' + (S.who === 'other' ? 'on' : '') + '">Someone else</button></div></div>' +
          (S.who === 'other' ? '<div class="m-2"><label class="m-f">Their name<input data-f="byName" value="' + esc(S.byName) + '" maxlength="60"></label><label class="m-f">Their phone<input data-f="byPhone" value="' + esc(S.byPhone) + '" type="tel" inputmode="tel" maxlength="20"></label></div>' : '')) +
      '<label class="m-f">When?<select data-f="when">' + slots.map(([k, l]) => '<option value="' + k + '"' + (S.when === k ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>' +
      '<div class="m-f"><span>How will you pay?</span><div class="m-pays">' + t.pay.map((p) => '<label class="m-pay' + (pm.method === p.method ? ' on' : '') + '"><input type="radio" name="mpay" data-f="pay" value="' + esc(p.method) + '"' + (pm.method === p.method ? ' checked' : '') + '><span><b>' + (p.method === 'Cash' ? (del ? 'Cash on delivery' : 'Cash at pickup') : esc(p.method)) + '</b>' + (p.method === 'Cash' ? '<span>Pay when you get it</span>' : '<span>Send to ' + esc(p.number) + (p.label ? ' (' + esc(p.label) + ')' : '') + '</span>') + '</span></label>').join('') + '</div></div>' +
      (pm.method !== 'Cash' ? '<div class="m-momo">Send <b>' + money(sub + f) + '</b> by ' + esc(pm.method) + ' to <b>' + esc(pm.number) + '</b>' + (pm.label ? ' (' + esc(pm.label) + ')' : '') + ', then type the transaction ID from your SMS.<input data-f="payRef" value="' + esc(S.payRef) + '" maxlength="40" placeholder="Transaction ID (e.g. MP2611…)"></div>' : '') +
      '<label class="m-f">Note (optional)<input data-f="note" value="' + esc(S.note) + '" placeholder="Not too spicy, extra pepper…" maxlength="200"></label>' +
      '<div class="m-err" data-err></div>' +
      '<button class="m-send" data-send' + (S.sending ? ' disabled' : '') + '>' + (S.sending ? 'Sending…' : (del ? 'Order delivery · ' : 'Order for pickup · ') + money(sub + f)) + '</button>' +
      (inSheet ? '<button class="m-back" data-close>Add more</button>' : '') +
      '<div class="m-hint">The restaurant confirms your order and calls you if needed.</div></div>';
  }
  function cartHtml(inSheet) {
    if (away()) return awayForm(inSheet);
    const ls = lines(); const tbl = tableNow();
    if (!S.d.canOrder) return '';
    if (!ls.length) return inSheet ? '' : '<div class="m-card"><h2>Your order</h2><div class="m-cart-empty">Tap <b>Add</b> on what you want.' + (tbl ? '' : ' Then choose your table and send.') + '</div></div>';
    return '<div class="' + (inSheet ? '' : 'm-card') + '"><h2>Your order' + (tbl ? ' · ' + esc(tbl.label) : '') + '</h2>' +
      ls.map((l) => '<div class="m-ln"><div class="grow"><div>' + esc(l.it.name) + '</div><div class="m-muted">' + money(l.it.priceNow * l.q) + '</div></div>' + stepper(l.it.id, l.q) + '</div>').join('') +
      '<div class="m-sum"><span>Total</span><span>' + money(total()) + '</span></div>' +
      (S.d.table ? '' : '<label class="m-f">Your table<select data-f="table"><option value="">Choose your table…</option>' + S.d.tables.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === S.tableId ? ' selected' : '') + '>' + esc(x.label) + (x.area ? ' · ' + esc(x.area) : '') + '</option>').join('') + '</select></label>') +
      '<label class="m-f">Your name<input data-f="name" value="' + esc(S.name) + '" placeholder="So the waiter knows who ordered" autocomplete="given-name" maxlength="60"></label>' +
      '<label class="m-f">Note for the kitchen (optional)<input data-f="note" value="' + esc(S.note) + '" placeholder="No ice, well done…" maxlength="200"></label>' +
      '<div class="m-err" data-err></div>' +
      '<button class="m-send" data-send' + (S.sending ? ' disabled' : '') + '>' + (S.sending ? 'Sending…' : 'Send order · ' + money(total())) + '</button>' +
      (inSheet ? '<button class="m-back" data-close>Add more</button>' : '') +
      '<div class="m-hint">You pay at the end, with your waiter.</div></div>';
  }
  /* the order status refreshes every 10 s on its own, so it never redraws a form someone is typing in */
  function drawMine() { const mine = mineHtml(); $$('.m-mine-box').forEach((x) => (x.innerHTML = mine)); }
  function drawSide() {
    drawMine();
    const cart = $('.m-cart-body'); if (cart) cart.innerHTML = cartHtml(false);
    const bar = $('.m-bar'); const n = count();
    if (bar) bar.innerHTML = canAdd() && n ? '<button data-open><span class="c">' + n + '</span><span>View order</span><span>' + money(total()) + '</span></button>' : '';
    const sh = $('.m-scr[data-basket] .m-pane'); if (sh) { const h = cartHtml(true); if (!h) closeSheets(); else sh.innerHTML = h; }
  }
  const closeSheets = () => $$('.m-scr').forEach((x) => x.remove());
  function sheet(html, kind) {
    closeSheets(); const scr = document.createElement('div'); scr.className = 'm-scr'; scr.setAttribute('data-' + kind, '');
    scr.innerHTML = '<div class="m-pane" role="dialog" aria-modal="true">' + html + '</div>';
    scr.addEventListener('click', (e) => { if (e.target === scr) scr.remove(); });
    document.body.appendChild(scr); return scr;
  }
  function pickSheet() {
    const ts = S.d.tables || []; const areas = [...new Set(ts.map((x) => x.area))];
    sheet('<h2>Which table are you at?</h2><p class="m-muted" style="margin:0 0 12px">The number is on your table. Ask your waiter if you are not sure.</p>' +
      areas.map((a) => (a || areas.length > 1 ? '<div class="m-sec">' + esc(a || 'Other tables') + '</div>' : '') + '<div class="m-tpick">' + ts.filter((x) => x.area === a).map((x) => '<button class="' + (x.id === S.tableId ? 'on' : '') + '" data-tb="' + esc(x.id) + '">' + esc(x.label) + '</button>').join('') + '</div>').join('') +
      (ts.length ? '' : '<div class="m-empty">No tables yet — please order with your waiter.</div>') + '<button class="m-back" data-close>Back</button>', 'pick');
  }

  async function sendAway(btn, box, err) {
    const t = tw(); const del = S.mode === 'delivery'; const name = S.name.trim();
    if (name.length < 2) return err('Please type your name');
    if (String(S.phone).replace(/\D/g, '').length < 8) return err('Please type your phone number');
    if (del && t.zones && t.zones.length && !S.zone) return err('Please choose your area');
    if (del && S.addr.trim().length < 4) return err('Please say where to deliver');
    if (S.mode === 'pickup' && S.who === 'other' && S.byName.trim().length < 2) return err('Please type the name of the person who will come');
    if (t.minOrder && total() < t.minOrder) return err('The minimum order is ' + money(t.minOrder));
    store.set('aahsso-menu-name', name); store.set('aahsso-menu-phone', S.phone); store.set('aahsso-menu-addr-' + KEY, S.addr); store.set('aahsso-menu-zone-' + KEY, S.zone);
    S.sending = true; btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await req('POST', '/takeaway', { mode: S.mode, name, phone: S.phone, address: S.addr, zone: S.zone, who: S.who, byName: S.byName, byPhone: S.byPhone, when: S.when, pay: S.pay, payRef: S.payRef, note: S.note, device: DEV, items: lines().map((l) => ({ menuId: l.it.id, qty: l.q })) });
      store.set(AWAY_KEY, awayIds().concat([{ id: r.orderId, at: Date.now() }]).slice(-10));
      S.cart = {}; S.note = ''; S.payRef = ''; save(); S.sending = false; closeSheets(); toast('Order ' + (r.no || '') + ' sent — ' + (del ? 'we will bring it to you' : 'we will tell you when it is ready'));
      try { S.track = await req('GET', '/track?o=' + awayIds().map((x) => x.id).join(',') + '&d=' + encodeURIComponent(DEV)); } catch (e) { }
      draw(); window.scrollTo(0, 0);
    } catch (e) { S.sending = false; btn.disabled = false; btn.textContent = (del ? 'Order delivery · ' : 'Order for pickup · ') + money(total() + fee()); err(e.message); }
  }
  async function send(btn) {
    const box = btn.closest('.m-card, .m-pane'); const err = (t) => { const e = $('[data-err]', box); if (e) e.textContent = t; };
    if (away()) return sendAway(btn, box, err);
    const tb = $('[data-f=table]', box); if (tb) { if (!tb.value) return err('Please choose your table'); if (tb.value !== S.tableId) pick(tb.value); }
    const name = S.name.trim(); if (name.length < 2) { err('Please type your name'); const n = $('[data-f=name]', box); if (n) n.focus(); return; }
    store.set('aahsso-menu-name', name); S.sending = true; btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await req('POST', '/orders', { ...tbody(), name, note: S.note, device: DEV, items: lines().map((l) => ({ menuId: l.it.id, qty: l.q })) });
      S.cart = {}; S.note = ''; save(); S.sending = false; closeSheets(); toast('Order ' + (r.no || '') + ' sent — your waiter is on it');
      S.status = await status().catch(() => S.status); draw(); if (!wide()) window.scrollTo(0, 0);
    } catch (e) { S.sending = false; btn.disabled = false; btn.textContent = 'Send order · ' + money(total()); err(e.message); }
  }
  function bump(id, d) { S.cart[id] = Math.max(0, Math.min(50, (S.cart[id] || 0) + (d === '+' ? 1 : -1))); if (!S.cart[id]) delete S.cart[id]; save(); }
  function toast(t) { $$('.m-toast').forEach((x) => x.remove()); const x = document.createElement('div'); x.className = 'm-toast'; x.setAttribute('role', 'status'); x.textContent = t; document.body.appendChild(x); setTimeout(() => x.remove(), 3500); }

  /* ---------- one listener for everything ---------- */
  document.addEventListener('input', (e) => {
    const f = e.target.dataset && e.target.dataset.f; if (!f) return;
    if (f === 'name') S.name = e.target.value; else if (f === 'note') S.note = e.target.value; else if (['phone', 'addr', 'byName', 'byPhone', 'payRef'].includes(f)) S[f] = e.target.value;
    $$('[data-f=' + f + ']').forEach((x) => { if (x !== e.target) x.value = e.target.value; });
  });
  document.addEventListener('change', (e) => { const f = e.target.dataset && e.target.dataset.f; if (['zone', 'when', 'pay'].includes(f)) { S[f] = e.target.value; drawSide(); return; } });
  document.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.f === 'table' && e.target.value) { pick(e.target.value); draw(); status().then((x) => { S.status = x; drawMine(); }).catch(() => {}); } });
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const c = t.closest('[data-cat]'); if (c) { S.cat = c.dataset.cat; draw(); const top = $('.m-main'); if (top && window.scrollY > top.offsetTop) window.scrollTo(0, 0); return; }
    if (t.closest('[data-close]')) { closeSheets(); return; }
    const md = t.closest('[data-mode]'); if (md) { setMode(md.dataset.mode); draw(); return; }
    const wh = t.closest('[data-who]'); if (wh) { S.who = wh.dataset.who; drawSide(); return; }
    const tb = t.closest('[data-tb]'); if (tb) { pick(tb.dataset.tb); closeSheets(); draw(); status().then((x) => { S.status = x; drawMine(); }).catch(() => {}); return; }
    if (t.closest('[data-pick]')) { pickSheet(); return; }
    if (t.closest('[data-open]')) { sheet(cartHtml(true), 'basket'); return; }
    const sb = t.closest('[data-send]'); if (sb) { send(sb); return; }
    const call = t.closest('[data-call]'); if (call) { if (e.detail === 0 && !call.disabled) callSend(call.dataset.call, 0); return; } // keyboard; touch and mouse ring on press
    const b = t.closest('[data-q]'); if (b) { const id = b.dataset.id; bump(id, b.dataset.q); const it = item(id); const card = $$('.m-main .m-item [data-id]').find((x) => x.dataset.id === id); if (it && card) card.closest('.m-item').outerHTML = row(it); drawSide(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });
  load();
})();
