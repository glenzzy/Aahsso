/* Kargo — public online shop. Clients browse items in stock, fill a basket and send their order with their own
 * delivery details (mode, agency, town, recipient name and phone). No login. Talks to /api/shop/<key>. */
(function () {
  'use strict';
  const KEY = (location.pathname.match(/\/s\/([A-Za-z0-9]+)/) || [])[1] || new URLSearchParams(location.search).get('s') || '';
  const API = '/api/shop/' + encodeURIComponent(KEY);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
  const CART_KEY = 'kargo-shop-cart-' + KEY, ME_KEY = 'kargo-shop-me';
  const S = { biz: null, items: [], delivery: { modes: [], agencies: [] }, cart: store.get(CART_KEY, {}), q: '', cat: '', mode: 'pickup' };
  const fmt = (v) => Math.round(Number(v) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const money = (v) => fmt(v) + ' ' + (S.biz ? S.biz.symbol : 'F');
  const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const img = (ref) => !ref ? '' : /^(data:|https?:)/.test(ref) ? ref : '/api/images/' + encodeURIComponent(ref);
  const byId = (id) => S.items.find((i) => i.id === id);
  const saveCart = () => store.set(CART_KEY, S.cart);
  const cartLines = () => Object.entries(S.cart).map(([id, q]) => ({ item: byId(id), qty: q })).filter((l) => l.item && l.qty > 0);
  const cartTotal = () => cartLines().reduce((a, l) => a + l.qty * l.item.price, 0);
  const cartCount = () => cartLines().reduce((a, l) => a + l.qty, 0);
  const maxQty = (it) => it.few || 999;
  const app = $('#app');

  async function load() {
    if (!KEY) { app.innerHTML = '<div class="card pad2 center" style="margin-top:40px"><h2>Shop link incomplete</h2><p class="muted">Ask the shop for its full link.</p></div>'; return; }
    try {
      const r = await fetch(API, { headers: { Accept: 'application/json' } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'This shop is not available right now');
      S.biz = j.business; S.items = j.items || []; S.delivery = j.delivery || S.delivery;
      Object.keys(S.cart).forEach((id) => { const it = byId(id); if (!it) delete S.cart[id]; else S.cart[id] = Math.min(S.cart[id], maxQty(it)); }); saveCart();
      document.title = S.biz.name + ' — shop';
      render();
    } catch (e) { app.innerHTML = '<div class="card pad2 center" style="margin-top:40px"><h2>Shop unavailable</h2><p class="muted">' + esc(e.message) + '</p><button class="btn" id="retry">Try again</button></div>'; $('#retry').onclick = load; }
  }

  function card(it) {
    const q = S.cart[it.id] || 0;
    return '<article class="pcard"><div class="pim">' + (it.image ? '<img loading="lazy" alt="" src="' + esc(img(it.image)) + '" onerror="this.remove()">' : '') + (it.image ? '' : esc(initials(it.name))) + '</div><div class="pb">' +
      '<div class="pn">' + esc(it.name) + '</div>' +
      '<div class="pm">' + (it.condition && it.condition !== 'New' ? '<span class="badge warn">' + esc(it.condition) + '</span>' : '') + (it.size ? '<span class="badge">' + esc(it.size) + '</span>' : '') + (it.few ? '<span class="badge bad">Only ' + it.few + ' left</span>' : '') + '</div>' +
      '<div class="pp">' + money(it.price) + (it.unit && it.unit !== 'piece' ? ' <span class="tiny muted">/ ' + esc(it.unit) + '</span>' : '') + '</div>' +
      '<div class="pa">' + (q ? qtyCtl(it.id, q) : '<button class="btn pri block" data-add="' + esc(it.id) + '">Add to basket</button>') + '</div></div></article>';
  }
  const qtyCtl = (id, q) => '<div class="qty"><button type="button" data-dec="' + esc(id) + '" aria-label="Less">−</button><input class="inp" inputmode="numeric" data-q="' + esc(id) + '" value="' + q + '" aria-label="Quantity"><button type="button" data-inc="' + esc(id) + '" aria-label="More">+</button></div>';

  function render() {
    const b = S.biz; const cats = [...new Set(S.items.map((i) => i.category))];
    const q = S.q.toLowerCase();
    const list = S.items.filter((i) => (!S.cat || i.category === S.cat) && (!q || (i.name + ' ' + i.category + ' ' + i.subcategory).toLowerCase().includes(q)));
    app.innerHTML = '<header class="shop-head"><div class="shop-logo">' + (b.logo ? '<img alt="" src="' + esc(img(b.logo)) + '">' : esc(initials(b.name))) + '</div><div class="grow"><h1>' + esc(b.name) + '</h1>' + (b.tagline ? '<div class="small muted">' + esc(b.tagline) + '</div>' : '') + '<div class="tiny muted">' + esc([b.address, b.phone].filter(Boolean).join(' · ')) + '</div></div></header>' +
      (b.message ? '<div class="alert info mb">' + esc(b.message) + '</div>' : '') +
      '<div class="shop-tools"><div class="search grow" style="min-width:200px"><input class="inp" id="q" placeholder="Search items" value="' + esc(S.q) + '" aria-label="Search items"></div></div>' +
      (cats.length > 1 ? '<div class="chips mb">' + [['', 'All']].concat(cats.map((c) => [c, c])).map(([k, l]) => '<button class="chip' + (S.cat === k ? ' on' : '') + '" data-cat="' + esc(k) + '">' + esc(l) + '</button>').join('') + '</div>' : '') +
      (list.length ? '<div class="shop-grid" id="grid">' + list.map(card).join('') + '</div>' : '<div class="card empty">' + (S.items.length ? 'Nothing matches your search.' : 'No items available right now. Please check again soon.') + '</div>') +
      basketBar();
  }
  const basketBar = () => cartCount() ? '<div class="basketbar"><div class="grow"><div class="b">' + cartCount() + ' item(s) in your basket</div><div class="small" style="opacity:.8">' + money(cartTotal()) + ' + delivery</div></div><button class="btn acc" id="openBasket">Order now →</button></div>' : '';
  function refreshCards() { const y = window.scrollY; render(); window.scrollTo(0, y); }
  function setQty(id, q) { const it = byId(id); if (!it) return; q = Math.max(0, Math.min(maxQty(it), Math.floor(Number(q) || 0))); if (q) S.cart[id] = q; else delete S.cart[id]; saveCart(); }

  /* ---------- basket + order form ---------- */
  function openBasket() {
    const me = store.get(ME_KEY, {}); S.mode = me.mode || S.mode;
    const panel = document.createElement('div'); panel.className = 'panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Your order');
    panel.innerHTML = '<div class="sheet"><div class="row between mb"><h2>Your order</h2><button class="icon-btn" id="closeP" aria-label="Close" style="font-size:22px">×</button></div><div id="pbody"></div></div>';
    document.body.appendChild(panel); document.body.style.overflow = 'hidden';
    const close = () => { panel.remove(); document.body.style.overflow = ''; refreshCards(); };
    panel.addEventListener('mousedown', (e) => { if (e.target === panel) close(); }); $('#closeP', panel).onclick = close;
    const f = (name, label, val, attrs) => '<label class="f">' + label + '<input class="inp" name="' + name + '" value="' + esc(val || '') + '" ' + (attrs || '') + '></label>';
    const draw = () => {
      const lines = cartLines(); if (!lines.length) return close();
      const modes = (S.delivery.modes || []).map(([k, l]) => { const [t, sub] = l.split(' ('); return '<button type="button" class="mode' + (S.mode === k ? ' on' : '') + '" data-mode="' + k + '"><b>' + esc(t) + '</b>' + (sub ? '<span>' + esc(sub.replace(')', '')) + '</span>' : '') + '</button>'; }).join('');
      const del = S.mode !== 'pickup'; const meR = me.selfRecipient !== false;
      $('#pbody', panel).innerHTML =
        '<div class="card pad mb">' + lines.map((l) => '<div class="bl"><div class="grow"><div class="b small">' + esc(l.item.name) + '</div><div class="tiny muted">' + money(l.item.price) + ' each</div></div>' + qtyCtl(l.item.id, l.qty) + '<div class="b" style="width:92px;text-align:right">' + money(l.qty * l.item.price) + '</div></div>').join('') +
        '<div class="row between mt b"><span>Items</span><span>' + money(cartTotal()) + '</span></div><div class="tiny muted">' + (del ? 'The delivery fee is confirmed by ' + esc(S.biz.name) + ' when they call you back.' : 'Pay when you pick up, by cash or mobile money.') + '</div></div>' +
        '<form id="of" class="col" novalidate>' +
        '<h3>Your details</h3><div class="grid2">' + f('name', 'Your name *', me.name, 'autocomplete="name" required') + f('phone', 'Phone / WhatsApp *', me.phone, 'inputmode="tel" autocomplete="tel" required') + '</div>' +
        '<h3 class="mt">How do you get your order?</h3><div class="modes">' + modes + '</div>' +
        '<div id="dl" class="col' + (del ? '' : ' hide') + '">' +
          '<div class="grid2">' + f('destination', 'Town / area to deliver to *', me.destination, 'placeholder="e.g. Bafoussam"') + '<div id="agWrap" class="' + (S.mode === 'agency' || S.mode === 'courier' ? '' : 'hide') + '">' + f('agency', S.mode === 'courier' ? 'Courier company' : 'Travel agency *', me.agency, 'list="agList" placeholder="e.g. General Express"') + '</div></div>' +
          '<datalist id="agList">' + (S.delivery.agencies || []).map((a) => '<option value="' + esc(a) + '">').join('') + '</datalist>' +
          f('address', 'Address / landmark', me.address, 'placeholder="e.g. near the main market"') +
          '<label class="toggle"><input type="checkbox" id="selfR"' + (meR ? ' checked' : '') + '> I will receive the parcel myself</label>' +
          '<div id="rWrap" class="grid2' + (meR ? ' hide' : '') + '">' + f('recipientName', 'Recipient name *', me.recipientName) + f('recipientPhone', 'Recipient phone *', me.recipientPhone, 'inputmode="tel"') + '</div>' +
        '</div>' +
        '<label class="f">Note for the shop (optional)<textarea class="inp" name="note" rows="2" maxlength="500" placeholder="Colour, size, best time to call…"></textarea></label>' +
        '<div class="err" id="oerr" role="alert"></div>' +
        '<button class="btn pri lg block" id="send" type="submit">Send my order · ' + money(cartTotal()) + '</button>' +
        '<div class="tiny muted center">' + esc(S.biz.name) + ' will call or WhatsApp you to confirm the price, delivery fee and payment.</div></form>';
      const form = $('#of', panel);
      $$('[data-mode]', panel).forEach((b) => (b.onclick = () => { keep(); S.mode = b.dataset.mode; draw(); }));
      $('#selfR', panel).onchange = (e) => $('#rWrap', panel).classList.toggle('hide', e.target.checked);
      form.onsubmit = (e) => { e.preventDefault(); send(); };
      function keep() { const v = Object.fromEntries(new FormData(form)); Object.assign(me, v, { mode: S.mode, selfRecipient: $('#selfR', panel).checked }); delete me.note; store.set(ME_KEY, me); }
      async function send() {
        keep(); const v = Object.fromEntries(new FormData(form)); const errEl = $('#oerr', panel); errEl.textContent = '';
        if ((v.name || '').trim().length < 2) return (errEl.textContent = 'Please type your name');
        if ((v.phone || '').replace(/\D/g, '').length < 8) return (errEl.textContent = 'Please type a phone number we can call or WhatsApp');
        if (S.mode !== 'pickup' && !(v.destination || '').trim()) return (errEl.textContent = 'Please type the town / area to deliver to');
        if (S.mode === 'agency' && !(v.agency || '').trim()) return (errEl.textContent = 'Please type the travel agency name');
        const self = $('#selfR', panel).checked;
        if (S.mode !== 'pickup' && !self && (!(v.recipientName || '').trim() || !(v.recipientPhone || '').trim())) return (errEl.textContent = 'Please type the recipient name and phone');
        const btn = $('#send', panel); btn.disabled = true; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true');
        const body = { customer: { name: v.name, phone: v.phone }, items: cartLines().map((l) => ({ productId: l.item.id, qty: l.qty })), note: v.note,
          delivery: S.mode === 'pickup' ? { mode: 'pickup' } : { mode: S.mode, destination: v.destination, agency: v.agency || '', address: v.address || '', recipientName: self ? v.name : v.recipientName, recipientPhone: self ? v.phone : v.recipientPhone } };
        try {
          const r = await fetch(API + '/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'Could not send your order. Please try again.');
          const summary = cartLines(); S.cart = {}; saveCart();
          done(j, summary, body);
        } catch (e) { errEl.textContent = e.message; btn.disabled = false; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); }
      }
    };
    function done(j, lines, body) {
      const wa = String(j.whatsapp || '').replace(/\D/g, '');
      const text = 'Hello ' + (j.business || '') + ', I just sent order ' + j.no + ':\n' + lines.map((l) => '• ' + l.item.name + ' × ' + l.qty).join('\n') + '\nTotal items: ' + money(j.total) +
        (body.delivery.mode !== 'pickup' ? '\nDelivery to ' + body.delivery.destination + (body.delivery.agency ? ' via ' + body.delivery.agency : '') + '\nRecipient: ' + body.delivery.recipientName + ' · ' + body.delivery.recipientPhone : '\nI will pick it up at the shop.');
      $('#pbody', panel).innerHTML = '<div class="done"><div class="big">✅</div><h2 class="mt">Order sent!</h2><p>Your order number is <b>' + esc(j.no) + '</b>.</p><p class="muted">' + esc(j.business || S.biz.name) + ' will call or WhatsApp you to confirm the price, delivery fee and payment.</p>' +
        (wa ? '<a class="btn block mt" style="background:#25D366;border-color:#25D366;color:#fff" target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent(text) + '">Send it on WhatsApp too</a>' : '') +
        '<button class="btn block mt" id="again">Back to the shop</button></div>';
      $('#again', panel).onclick = () => { close(); load(); };
    }
    // basket quantity changes inside the panel
    panel.addEventListener('click', (e) => { const t = e.target.closest('[data-inc],[data-dec]'); if (!t) return; const id = t.dataset.inc || t.dataset.dec; setQty(id, (S.cart[id] || 0) + (t.dataset.inc ? 1 : -1)); draw(); });
    panel.addEventListener('change', (e) => { if (e.target.dataset.q) { setQty(e.target.dataset.q, e.target.value); draw(); } });
    draw();
  }

  /* ---------- events on the shop page ---------- */
  app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-cat],#openBasket'); if (!t) return;
    if (t.id === 'openBasket') return openBasket();
    if (t.dataset.cat !== undefined) { S.cat = t.dataset.cat; return refreshCards(); }
    const id = t.dataset.add || t.dataset.inc || t.dataset.dec;
    setQty(id, (S.cart[id] || 0) + (t.dataset.dec ? -1 : 1)); refreshCards();
  });
  app.addEventListener('change', (e) => { if (e.target.dataset.q) { setQty(e.target.dataset.q, e.target.value); refreshCards(); } });
  let qt; app.addEventListener('input', (e) => { if (e.target.id === 'q') { S.q = e.target.value; clearTimeout(qt); qt = setTimeout(() => { render(); const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200); } });
  load();
})();
