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
  const S = { d: null, cart: store.get(CART_KEY, {}), cat: '', name: store.get('aahsso-menu-name', ''), note: '', status: null, tableId: '', sending: false };
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
    document.title = S.d.business.name + ' · Menu'; draw(); if (S.d.canOrder) poll();
  }
  const status = () => req('GET', '/status?' + tq() + '&d=' + encodeURIComponent(DEV));
  async function poll() { if (tableNow()) { try { S.status = await status(); drawMine(); } catch (e) { } } setTimeout(poll, 10000); }

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
          (!d.table && d.canOrder && !picked() ? '<button class="m-pick" data-pick><span><b>Order from your table</b><span>Choose your table, add what you want, send — your waiter brings it.</span></span><i>›</i></button>' : '') +
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
    const q = S.cart[i.id] || 0; const can = S.d.canOrder && !i.soldOut;
    return '<div class="m-item' + (i.soldOut ? ' off' : '') + (q ? ' in' : '') + '">' +
      (i.photo ? '<img class="m-ph" src="' + esc(img(i.photo)) + '" alt="" loading="lazy">' : '<div class="m-ph">' + esc(initials(i.name)) + '</div>') +
      '<div class="m-info"><div class="m-n">' + esc(i.name) + '</div>' + (i.desc ? '<div class="m-d">' + esc(i.desc) + '</div>' : '') +
        '<div class="m-p">' + (i.priceNow < i.price ? '<s>' + fmt(i.price) + '</s>' : '') + money(i.priceNow) + (i.soldOut ? ' <em>· sold out</em>' : '') + '</div></div>' +
      (can ? (q ? stepper(i.id, q) : '<button class="m-add" data-q="+" data-id="' + esc(i.id) + '">Add</button>') : '') + '</div>';
  }
  const stepper = (id, q) => '<div class="m-qty"><button data-q="-" data-id="' + esc(id) + '" aria-label="One less">−</button><b>' + q + '</b><button class="plus" data-q="+" data-id="' + esc(id) + '" aria-label="One more">+</button></div>';

  /* ---------- your orders (status) ---------- */
  function mineHtml() {
    if (!S.d.canOrder || !tableNow()) return '';
    const st = S.status; const calls = '<div class="m-calls"><button data-call="waiter">🔔 Call the waiter</button><button data-call="bill">🧾 Ask for the bill</button></div>';
    if (!st || !st.orders || !st.orders.length) return st && st.open ? calls : '';
    return '<div class="m-card"><div class="m-ln" style="padding-top:0"><h2 style="margin:0">Your orders</h2>' + (st.total ? '<span class="m-muted">Bill so far: <b style="color:var(--ink)">' + money(st.total) + '</b></span>' : '') + '</div>' +
      st.orders.map((o) => '<div class="m-ln"><div class="grow"><div>' + o.lines.map((l) => l.qty + '× ' + esc(l.name)).join(', ') + '</div><div class="m-muted">#' + esc(o.no) + (o.reason ? ' · <span style="color:var(--bad)">' + esc(o.reason) + '</span>' : '') + '</div></div><span class="m-st ' + esc(o.status) + '">' + esc(LBL[o.status] || o.status) + '</span></div>').join('') +
      (st.billAsked ? '<div class="m-muted" style="color:var(--ok);margin-top:6px">Your waiter is bringing the bill.</div>' : '') + '</div>' + calls;
  }

  /* ---------- your basket: the same form in the side card (wide) and the sheet (phone) ---------- */
  function cartHtml(inSheet) {
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
    if (bar) bar.innerHTML = S.d.canOrder && n ? '<button data-open><span class="c">' + n + '</span><span>View order</span><span>' + money(total()) + '</span></button>' : '';
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

  async function send(btn) {
    const box = btn.closest('.m-card, .m-pane'); const err = (t) => { const e = $('[data-err]', box); if (e) e.textContent = t; };
    const tb = $('[data-f=table]', box); if (tb) { if (!tb.value) return err('Please choose your table'); if (tb.value !== S.tableId) pick(tb.value); }
    const name = S.name.trim(); if (name.length < 2) { err('Please type your name'); const n = $('[data-f=name]', box); if (n) n.focus(); return; }
    store.set('aahsso-menu-name', name); S.sending = true; btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await req('POST', '/orders', { ...tbody(), name, note: S.note, device: DEV, items: lines().map((l) => ({ menuId: l.it.id, qty: l.q })) });
      S.cart = {}; S.note = ''; save(); S.sending = false; closeSheets(); toast('Order #' + r.no + ' sent — your waiter is on it');
      S.status = await status().catch(() => S.status); draw(); if (!wide()) window.scrollTo(0, 0);
    } catch (e) { S.sending = false; btn.disabled = false; btn.textContent = 'Send order · ' + money(total()); err(e.message); }
  }
  function bump(id, d) { S.cart[id] = Math.max(0, Math.min(50, (S.cart[id] || 0) + (d === '+' ? 1 : -1))); if (!S.cart[id]) delete S.cart[id]; save(); }
  function toast(t) { $$('.m-toast').forEach((x) => x.remove()); const x = document.createElement('div'); x.className = 'm-toast'; x.setAttribute('role', 'status'); x.textContent = t; document.body.appendChild(x); setTimeout(() => x.remove(), 3500); }

  /* ---------- one listener for everything ---------- */
  document.addEventListener('input', (e) => {
    const f = e.target.dataset && e.target.dataset.f; if (!f) return;
    if (f === 'name') S.name = e.target.value; else if (f === 'note') S.note = e.target.value;
    $$('[data-f=' + f + ']').forEach((x) => { if (x !== e.target) x.value = e.target.value; });
  });
  document.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.f === 'table' && e.target.value) { pick(e.target.value); draw(); status().then((x) => { S.status = x; drawMine(); }).catch(() => {}); } });
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const c = t.closest('[data-cat]'); if (c) { S.cat = c.dataset.cat; draw(); const top = $('.m-main'); if (top && window.scrollY > top.offsetTop) window.scrollTo(0, 0); return; }
    if (t.closest('[data-close]')) { closeSheets(); return; }
    const tb = t.closest('[data-tb]'); if (tb) { pick(tb.dataset.tb); closeSheets(); draw(); status().then((x) => { S.status = x; drawMine(); }).catch(() => {}); return; }
    if (t.closest('[data-pick]')) { pickSheet(); return; }
    if (t.closest('[data-open]')) { sheet(cartHtml(true), 'basket'); return; }
    const sb = t.closest('[data-send]'); if (sb) { send(sb); return; }
    const call = t.closest('[data-call]'); if (call) { call.disabled = true; try { await req('POST', '/call', { ...tbody(), kind: call.dataset.call, name: S.name }); toast(call.dataset.call === 'bill' ? 'Your waiter is bringing the bill' : 'Your waiter is coming'); } catch (err) { toast(err.message); } setTimeout(() => (call.disabled = false), 20000); return; }
    const b = t.closest('[data-q]'); if (b) { const id = b.dataset.id; bump(id, b.dataset.q); const it = item(id); const card = $$('.m-main .m-item [data-id]').find((x) => x.dataset.id === id); if (it && card) card.closest('.m-item').outerHTML = row(it); drawSide(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });
  load();
})();
