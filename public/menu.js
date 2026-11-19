/* Aahsso Bar & Resto — the menu customers open by scanning the QR code on their table.
 * /t/<menuKey>/<tableToken>: menu + ordering (name only) + their orders' progress + call the waiter / ask for the bill.
 * /m/<menuKey>: the menu only. Prices always come from the server. No login. */
(function () {
  'use strict';
  const m = location.pathname.match(/^\/(t|m)\/([a-f0-9]+)(?:\/([A-Za-z0-9]+))?/) || [];
  const KEY = m[2] || '', TOKEN = m[1] === 't' ? m[3] || '' : '';
  const API = '/api/menu/' + KEY;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
  const DEV = store.get('aahsso-menu-dev', '') || (() => { const d = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('aahsso-menu-dev', d); return d; })();
  const CART_KEY = 'aahsso-menu-cart-' + KEY + '-' + TOKEN;
  const S = { d: null, cart: store.get(CART_KEY, {}), cat: '', name: store.get('aahsso-menu-name', ''), status: null };
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

  async function load() {
    try { S.d = await req('GET', TOKEN ? '?t=' + encodeURIComponent(TOKEN) : ''); }
    catch (e) { app.innerHTML = '<div class="empty"><div class="big">🍽️</div>' + esc(e.message) + '</div>'; return; }
    document.title = S.d.business.name + ' · Menu'; draw(); if (S.d.canOrder) poll();
  }
  async function poll() { try { S.status = await req('GET', '/status?t=' + encodeURIComponent(TOKEN) + '&d=' + encodeURIComponent(DEV)); drawMine(); } catch (e) { } setTimeout(poll, 10000); }
  function draw() {
    const d = S.d; const b = d.business;
    const cats = d.cats.filter((c) => d.items.some((i) => i.category === c));
    const list = d.items.filter((i) => !S.cat || i.category === S.cat);
    app.innerHTML = '<div class="mh"><div class="mlogo">' + (b.logo ? '<img src="' + esc(img(b.logo)) + '" alt="">' : esc(initials(b.name))) + '</div><div class="grow"><h1>' + esc(b.name) + '</h1><div class="sub">' + esc(b.tagline || 'Menu') + '</div></div>' + (d.table ? '<span class="mtable">' + esc(d.table.label) + '</span>' : '') + '</div>' +
      (d.happyHour ? '<div class="mhh">Happy hour: −' + d.happyHour.pct + '% until ' + esc(d.happyHour.to) + '</div>' : '') +
      '<div id="mine"></div>' +
      (d.table && !d.canOrder ? '<div class="alert info mb">Ordering from the phone is off. Your waiter will take your order.</div>' : '') +
      '<div class="mcats"><div class="chips">' + [['', 'All']].concat(cats.map((c) => [c, c])).map(([k, l]) => '<button class="chip' + (S.cat === k ? ' on' : '') + '" data-cat="' + esc(k) + '">' + esc(l) + '</button>').join('') + '</div></div>' +
      (S.cat ? '' : '') + cats.filter((c) => !S.cat || c === S.cat).map((c) => '<div class="mcat">' + esc(c) + '</div>' + list.filter((i) => i.category === c).map(row).join('')).join('') +
      (list.length ? '' : '<div class="empty">Nothing here yet.</div>') +
      '<div class="foot">Powered by Aahsso</div>';
    drawMine(); drawBar();
  }
  function row(i) {
    const q = S.cart[i.id] || 0;
    return '<div class="mi' + (i.soldOut ? ' off' : '') + '">' + (i.photo ? '<img src="' + esc(img(i.photo)) + '" alt="" loading="lazy">' : '<div class="ph">' + esc(initials(i.name)) + '</div>') +
      '<div class="grow" style="min-width:0"><div class="n">' + esc(i.name) + '</div>' + (i.desc ? '<div class="d">' + esc(i.desc) + '</div>' : '') + '<div class="p">' + (i.priceNow < i.price ? '<s>' + fmt(i.price) + '</s>' : '') + money(i.priceNow) + (i.soldOut ? ' · sold out' : '') + '</div></div>' +
      (S.d.canOrder && !i.soldOut ? (q ? '<div class="qy"><button data-q="-" data-id="' + i.id + '" aria-label="One less">−</button><b>' + q + '</b><button data-q="+" data-id="' + i.id + '" aria-label="One more">+</button></div>' : '<button class="add" data-q="+" data-id="' + i.id + '">Add</button>') : '') + '</div>';
  }
  function drawMine() {
    const box = $('#mine'); if (!box || !S.d.canOrder) return; const st = S.status;
    const calls = '<div class="calls"><button class="btn" data-call="waiter">🔔 Call the waiter</button><button class="btn" data-call="bill">🧾 Ask for the bill</button></div>';
    if (!st || !st.orders || !st.orders.length) { box.innerHTML = st && st.open ? calls : ''; return; }
    box.innerHTML = '<div class="mine"><div class="row2"><b>Your orders</b><span>' + (st.total ? 'Bill so far: <b>' + money(st.total) + '</b>' : '') + '</span></div>' +
      st.orders.map((o) => '<div class="row2"><span class="small">#' + esc(o.no) + ' · ' + o.lines.map((l) => l.qty + '× ' + esc(l.name)).join(', ') + (o.reason ? '<br><span class="err">' + esc(o.reason) + '</span>' : '') + '</span><span class="st ' + esc(o.status) + '">' + esc(LBL[o.status] || o.status) + '</span></div>').join('') +
      (st.billAsked ? '<div class="small" style="color:var(--ok)">Your waiter is bringing the bill.</div>' : '') + '</div>' + calls;
  }
  function drawBar() {
    let bar = $('#bar'); if (!bar) { bar = document.createElement('div'); bar.id = 'bar'; bar.className = 'bar'; document.body.appendChild(bar); }
    const n = count(); bar.innerHTML = S.d.canOrder && n ? '<button class="btn pri" data-open>' + n + ' item' + (n === 1 ? '' : 's') + ' · ' + money(total()) + ' — View order</button>' : '';
  }
  function basket() {
    const scr = document.createElement('div'); scr.className = 'scr';
    const paint = () => {
      const ls = lines(); if (!ls.length) { scr.remove(); draw(); return; }
      scr.innerHTML = '<div class="pane"><h2>Your order · ' + esc(S.d.table.label) + '</h2>' + ls.map((l) => '<div class="row2"><span>' + esc(l.it.name) + '<br><span class="small muted">' + money(l.it.priceNow) + '</span></span><div class="qy"><button data-q="-" data-id="' + l.it.id + '">−</button><b>' + l.q + '</b><button data-q="+" data-id="' + l.it.id + '">+</button></div></div>').join('') +
        '<div class="row2"><b>Total</b><b>' + money(total()) + '</b></div>' +
        '<label class="f mt">Your name<input class="inp" id="nm" value="' + esc(S.name) + '" placeholder="So the waiter knows who ordered" autocomplete="given-name"></label>' +
        '<label class="f mt">Note for the kitchen (optional)<input class="inp" id="nt" placeholder="No ice, well done…"></label><div class="err" id="er"></div>' +
        '<div class="row mt"><button class="btn grow" data-close>Back</button><button class="btn pri grow" id="go">Send order</button></div><p class="small muted">You pay at the end, with your waiter.</p></div>';
      $('#go', scr).onclick = async (e) => {
        const name = $('#nm', scr).value.trim(); if (name.length < 2) { $('#er', scr).textContent = 'Please type your name'; return; }
        S.name = name; store.set('aahsso-menu-name', name); e.target.disabled = true; e.target.textContent = 'Sending…';
        try { const r = await req('POST', '/orders', { t: TOKEN, name, note: $('#nt', scr).value, device: DEV, items: lines().map((l) => ({ menuId: l.it.id, qty: l.q })) }); S.cart = {}; save(); scr.remove(); toast('Order #' + r.no + ' sent — your waiter is on it'); S.status = await req('GET', '/status?t=' + encodeURIComponent(TOKEN) + '&d=' + encodeURIComponent(DEV)).catch(() => S.status); draw(); window.scrollTo(0, 0); }
        catch (err) { $('#er', scr).textContent = err.message; e.target.disabled = false; e.target.textContent = 'Send order'; }
      };
    };
    scr.addEventListener('click', (e) => { if (e.target === scr || e.target.closest('[data-close]')) { scr.remove(); draw(); return; } const b = e.target.closest('[data-q]'); if (b) { bump(b.dataset.id, b.dataset.q); paint(); } });
    document.body.appendChild(scr); paint();
  }
  function bump(id, d) { S.cart[id] = Math.max(0, Math.min(50, (S.cart[id] || 0) + (d === '+' ? 1 : -1))); if (!S.cart[id]) delete S.cart[id]; save(); }
  function toast(t) { const x = document.createElement('div'); x.className = 'toast'; x.textContent = t; x.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:90px;background:#14202e;color:#fff;padding:10px 16px;border-radius:12px;z-index:40;font-size:14px;max-width:90%'; document.body.appendChild(x); setTimeout(() => x.remove(), 3500); }
  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-cat]'); if (c) { S.cat = c.dataset.cat; draw(); return; }
    if (e.target.closest('[data-open]')) { basket(); return; }
    const call = e.target.closest('[data-call]'); if (call) { call.disabled = true; try { await req('POST', '/call', { t: TOKEN, kind: call.dataset.call, name: S.name }); toast(call.dataset.call === 'bill' ? 'Your waiter is bringing the bill' : 'Your waiter is coming'); } catch (err) { toast(err.message); } setTimeout(() => (call.disabled = false), 20000); return; }
    const b = e.target.closest('#app [data-q]'); if (b) { bump(b.dataset.id, b.dataset.q); draw(); }
  });
  load();
})();
