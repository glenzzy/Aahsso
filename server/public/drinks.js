/* Aahsso Bar & Resto — the drinks catalog (Cameroon): beers, spirits, wines, soft drinks… with their details.
 * Data: the server's drinks_catalog table (GET /api/drinks; seeded with `npm run seed:drinks`), kept on the phone for offline use. Bars pick from it in Stock, Menu and
 * New purchase; anything missing they type themselves. Prices in it are suggestions only — each bar sets its own. */
const Drinks = (() => {
  let data = null, loading = null;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); // Mützig = mutzig, D'USSÉ = d usse
  async function load() {
    if (data) return data;
    const KEY = 'aahsso-drinks';
    if (!loading) loading = K.store.req('GET', '/api/drinks')
      .then((d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* full: just not offline */ } return d; })
      .catch((e) => { let d = null; try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (x) { } if (d && d.items) return d; throw new Error('The drinks list could not be loaded — check the internet'); })
      .then((d) => { if (!d.items || !d.items.length) throw new Error('The drinks list is empty for now. Add your drinks yourself, or ask the Aahsso team.'); d.items.forEach((x) => { x._q = norm([x.name, x.brand, x.variant, x.sub, x.cat, x.country, x.grape].join(' ')); x._n = norm(x.name); }); data = d; return d; })
      .catch((e) => { loading = null; throw e; });
    return loading;
  }
  const ready = () => data;
  const byName = (name) => { if (!data) return null; const n = norm(name); return data.items.find((x) => x._n === n) || null; };
  const bySku = (sku) => (data && sku ? data.items.find((x) => x.sku === sku) || null : null);
  /** every word must match, in any order: "hennessy vs", "castel 33cl", "mutzig" */
  function find(q, cat) {
    if (!data) return []; const words = norm(q).split(' ').filter(Boolean);
    return data.items.filter((x) => (!cat || x.cat === cat) && words.every((w) => x._q.includes(w)));
  }
  const size = (ml) => (!ml ? '' : ml >= 1000 ? String(ml / 1000) + ' L' : ml % 10 === 0 ? ml / 10 + ' cl' : ml + ' ml'); // 650 → 65 cl, 1500 → 1.5 L
  const packLabel = (d) => d.pack === 'Bottle' ? 'Bottle (returnable)' : d.pack === 'Glass' ? 'Glass bottle' : d.pack === 'Plastic' ? 'Plastic bottle' : d.pack === 'Served' ? 'Prepared to order' : d.pack;
  const metaLine = (d) => [d.sub, packLabel(d), d.abv ? d.abv + '%' : '', d.country].filter(Boolean).join(' · ');
  /** the stock item a drink becomes (no quantity: stock comes from purchases and counts) */
  function toProduct(d, price) {
    const unit = d.pack === 'Can' ? 'can' : d.pack === 'Carton' ? 'carton' : d.pack === 'Served' ? 'piece' : 'bottle';
    const p = { id: uid('pr_'), name: d.name, category: d.cat, subcategory: d.sub || '', condition: 'New', barcode: '', markup: null, minMarkup: null, priceMax: price > 0 ? price : null, priceMin: null,
      unit, size: d.ml ? (d.ml >= 1000 ? d.ml / 1000 : d.ml) : null, sizeUnit: d.ml ? (d.ml >= 1000 ? 'L' : 'mL') : '',
      packs: d.perCase > 1 ? [{ name: d.returnable ? 'crate' : 'case', size: d.perCase, price: null }] : [],
      drink: { sku: d.sku, brand: d.brand || '', pack: d.pack, returnable: !!d.returnable, abv: d.abv || null, country: d.country || '', producer: d.producer || '', supplier: d.supplier || '', pourMl: d.pourMl || null, pours: d.pours || null } };
    return p;
  }
  /** the menu category a drink goes in, from the venue's own categories when one fits */
  const MENU_OF = { Beer: 'Beers', 'Cider & RTD': 'Beers', 'Malt Drinks': 'Soft drinks', Spirits: 'Spirits', 'Liqueurs & Aperitifs': 'Spirits', Wine: 'Wines', 'Sparkling Wine': 'Wines', Champagne: 'Champagne', 'Soft Drinks': 'Soft drinks', Water: 'Soft drinks', 'Energy Drinks': 'Soft drinks', Juices: 'Juices', Traditional: 'Traditional' };
  function menuCat(d, cats) {
    const want = MENU_OF[d.cat] || d.cat; const has = (c) => (cats || []).find((x) => norm(x) === norm(c));
    return has(want) || (['Soft drinks', 'Juices'].includes(want) && has('Drinks')) || (want === 'Champagne' && has('Wines')) || has(d.cat) || has('Drinks') || want;
  }
  /** the stock item already made from this drink (same catalog code, else same name) */
  /** units of this drink in stock now (0 when it was never bought) */
  const inStock = (d) => { const p = productOf(d); return p ? Math.max(0, Math.floor((K.C.prodX[p.id] || {}).available || 0)) : 0; };
  /** on the menu only what can be served: drinks in stock, and what is prepared to order (fresh juice, palm wine) */
  const servable = (d) => d.pack === 'Served' || inStock(d) > 0;
  const productOf = (d) => K.raw.products.find((p) => !p.archived && p.drink && p.drink.sku === d.sku) || K.raw.products.find((p) => !p.archived && norm(p.name) === d._n) || null;
  /** add the drinks' categories to the business's stock categories (so filters and the item editor know them) */
  async function addStockCats(list) {
    const base = S().categories ? JSON.parse(JSON.stringify(S().categories)) : Object.fromEntries(Object.entries(KC.CATEGORIES).filter(([c]) => K.raw.products.some((p) => p.category === c)));
    let changed = false;
    list.forEach((d) => { if (!base[d.cat]) { base[d.cat] = []; changed = true; } if (d.sub && !base[d.cat].includes(d.sub)) { base[d.cat].push(d.sub); changed = true; } });
    if (changed) await saveSettings({ categories: base });
  }

  /* ---------- the picker ---------- */
  const PRICE_LBL = { bar: 'Bar prices', lounge: 'Lounge / hotel prices', none: 'No price yet' };
  function detail(d) {
    const row = (k, v) => (v === '' || v === null || v === undefined ? '' : '<div class="dk-kv"><span>' + k + '</span><b>' + v + '</b></div>');
    const mg = (p) => (d.cost && p ? Math.round((p - d.cost) / p * 100) + '%' : '');
    return '<div class="dk-detail">' +
      row('Code', esc(d.sku)) + row('Brand', esc(d.brand || '')) + row('Expression', esc(d.variant || '')) + row('Category', esc(d.cat + (d.sub ? ' · ' + d.sub : ''))) +
      row('Size', esc(size(d.ml))) + row('Packaging', esc(packLabel(d))) + row('Per case', d.perCase ? d.perCase + (d.returnable ? ' (crate)' : '') : '') + row('Alcohol', d.abv ? d.abv + '%' : '') +
      row('Country', esc(d.country || '')) + row('Region', esc(d.region || '')) + row('Grape / style', esc(d.grape || '')) + row('Sweetness', esc(d.sweetness || '')) +
      row('Producer', esc(d.producer || '')) + row('Usual supplier', esc(d.supplier || '')) + row('Price range', esc(d.tier || '')) +
      (seeCost() ? row('Typical cost', d.cost ? fmt(d.cost) + ' F' : '') : '') + row('Bar price', d.priceBar ? fmt(d.priceBar) + ' F' + (seeCost() && mg(d.priceBar) ? ' · margin ' + mg(d.priceBar) : '') : '') + row('Lounge / hotel price', d.priceLounge ? fmt(d.priceLounge) + ' F' + (seeCost() && mg(d.priceLounge) ? ' · margin ' + mg(d.priceLounge) : '') : '') +
      row('By the glass / shot', d.byGlass ? (d.pourMl ? d.pourMl + ' ml' : 'Yes') + (d.pours ? ' · ' + d.pours + ' per bottle' : '') : '') +
      row('Reliability', esc(d.confidence || '') + (d.confidence && data ? ' <span class="muted" style="font-weight:400">— ' + esc((data.confidence.find((c) => c.key === d.confidence) || {}).desc || '') + '</span>' : '')) +
      (d.notes ? '<div class="dk-note">' + esc(d.notes) + '</div>' : '') + '</div>';
  }
  function about() {
    const n = data.notes.filter((x) => !/^(Editable cells|Changes vs previous list|Item name convention)$/i.test(x.title));
    openSheet({ title: 'About the drinks catalog', wide: true,
      body: '<p class="small">' + esc(data.items.length) + ' drinks sold in Cameroonian bars, lounges, hotels and restaurants. Pick what you sell; add anything missing yourself.</p>' +
        '<h3 class="mt">Packaging</h3><div class="dk-legend">' + data.packaging.map((p) => '<div><b>' + esc(p.key) + '</b><span>' + esc(p.desc) + '</span></div>').join('') + '</div>' +
        '<h3 class="mt">Reliability</h3><div class="dk-legend">' + data.confidence.map((p) => '<div><b>' + esc(p.key) + '</b><span>' + esc(p.desc) + '</span></div>').join('') + '</div>' +
        '<h3 class="mt">Good to know</h3><div class="dk-legend">' + n.map((x) => '<div><b>' + esc(x.title) + '</b><span>' + esc(x.text) + '</span></div>').join('') + '</div>' +
        (data.suppliers.length ? '<h3 class="mt">Usual suppliers</h3><div class="dk-legend">' + data.suppliers.map((s) => '<div><b>' + esc(s.name) + '</b><span>' + esc([s.type, s.products, s.notes].filter(Boolean).join(' — ')) + '</span></div>').join('') + '</div>' : ''),
      foot: '<button class="btn pri grow" data-a="sheetClose">Close</button>' });
  }
  /**
   * opt: { title, many (pick several), prices: ['bar','lounge','none'], taken(d) → label when already added, action(n) → button text,
   *        only(d) → show only these drinks, lead(shown, total) → html above the list, empty → html when \`only\` leaves nothing, note(d) → a line under the name,
   *        onPick(list, { price }) (return false to keep the window open), onOwn(text) — "not in the list? add it yourself" }
   */
  async function picker(opt) {
    const SRC = opt.src || { load, data: () => data, find, bySku, metaLine, detail, about, noun: 'drink', nouns: 'drinks', listName: 'the drinks list', placeholder: 'Search: Castel, Hennessy, Merlot, Mützig…', icon: '🍾' };
    const sh = openSheet({ title: opt.title || 'Choose', wide: true, body: LOADER_IN });
    sh.classList.add('dk-sheet');
    try { await SRC.load(); } catch (e) { setSheetBody(sh, '<div class="alert bad">' + esc(e.message) + '</div>'); return; }
    const st = { q: '', cat: '', sel: new Map(), open: null, price: (opt.prices || ['bar'])[0], limit: 60 };
    const priceOf = (d) => (opt.priceFor && opt.priceFor(d)) || (st.price === 'lounge' ? d.priceLounge : st.price === 'bar' ? d.priceBar : null); // your price first, else the list's
    setSheetBody(sh, '<div class="dk-top"><div class="search">' + ic('search') + '<input class="inp" id="dkQ" placeholder="' + esc(SRC.placeholder) + '" autocomplete="off" aria-label="Search ' + SRC.nouns + '"></div>' +
      '<div class="chips dk-cats" id="dkCats"></div></div><div id="dkList" class="dk-list" role="list"></div>');
    const foot = document.createElement('div'); foot.className = 'sf dk-foot'; sh.querySelector('.sheet').appendChild(foot);
    const listEl = $('#dkList', sh), catsEl = $('#dkCats', sh), qEl = $('#dkQ', sh);
    const pool = (q, cat) => SRC.find(q, cat).filter((d) => !opt.only || opt.only(d));
    const drawCats = () => { const all = pool(st.q, ''); catsEl.innerHTML = [['', 'All', all.length]].concat(SRC.data().categories.map((c) => [c.name, c.name, all.filter((x) => x.cat === c.name).length])).filter((c) => c[0] === '' || c[2] || c[0] === st.cat)
      .map(([k, l, n]) => '<button type="button" class="chip' + (st.cat === k ? ' on' : '') + '" data-dk-cat="' + esc(k) + '">' + esc(l) + ' <span class="dk-n">' + n + '</span></button>').join(''); };
    const drawFoot = () => {
      const n = st.sel.size;
      foot.innerHTML = (opt.prices && opt.prices.length > 1 ? '<label class="dk-price">' + ic('tag', 'sm') + '<select class="inp" id="dkPrice" aria-label="Selling price">' + opt.prices.map((k) => '<option value="' + k + '"' + (st.price === k ? ' selected' : '') + '>' + PRICE_LBL[k] + '</option>').join('') + '</select></label>' : '') +
        '<button type="button" class="btn ghost sm" id="dkAbout">' + ic('info', 'sm') + 'About</button><span class="grow"></span>' +
        (opt.many ? '<button class="btn" data-a="sheetClose">Cancel</button><button class="btn pri" id="dkGo"' + (n ? '' : ' disabled') + '>' + esc(opt.action ? opt.action(n) : 'Add ' + n) + '</button>' : '<button class="btn" data-a="sheetClose">Cancel</button>');
      if ($('#dkPrice', foot)) $('#dkPrice', foot).onchange = (e) => { st.price = e.target.value; drawList(); };
      $('#dkAbout', foot).onclick = SRC.about;
      if ($('#dkGo', foot)) $('#dkGo', foot).onclick = go;
    };
    const drawList = () => {
      const all = pool(st.q, st.cat); const show = all.slice(0, st.limit);
      const lead = opt.lead ? opt.lead(pool('', '').length, SRC.data().items.length) : '';
      if (!all.length && opt.only && !pool('', '').length && opt.empty) { listEl.innerHTML = opt.empty; return; }
      const notBought = !all.length && opt.only && st.q ? SRC.find(st.q, st.cat) : [];
      if (notBought.length) { // in the drinks list, but not in stock: buy it first (never "add it yourself" around the stock)
        listEl.innerHTML = lead + '<div class="empty dk-empty"><div class="big">📦</div><b>Not in your stock yet</b><p class="small muted">' + esc(notBought.slice(0, 3).map((x) => x.name).join(', ') + (notBought.length > 3 ? ' and ' + (notBought.length - 3) + ' more' : '')) + (notBought.length === 1 ? ' is' : ' are') + ' in ' + SRC.listName + ' but not in your stock. Buy ' + (notBought.length === 1 ? 'it' : 'them') + ' first, then add ' + (notBought.length === 1 ? 'it' : 'them') + ' here.</p>' + (opt.lead ? '<div class="mt"><button type="button" class="btn pri" data-a="dkBuy">' + ic('buy', 'sm') + 'Buy ' + SRC.nouns + '</button></div>' : '') + '</div>';
        return;
      }
      if (!all.length) {
        listEl.innerHTML = lead + '<div class="empty dk-empty"><div class="big">' + SRC.icon + '</div>' + (st.q ? 'No ' + SRC.noun + ' matches “' + esc(st.q) + '”.' : 'Nothing here.') + (opt.onOwn && st.q ? '<div class="mt"><button type="button" class="btn pri" id="dkOwn">' + ic('plus', 'sm') + 'Add “' + esc(st.q) + '” yourself</button></div><div class="hint mt">Not every ' + SRC.noun + ' is in the list — add yours with your own name and price.</div>' : '') + '</div>';
        if ($('#dkOwn', listEl)) $('#dkOwn', listEl).onclick = () => { const q = qEl.value.trim(); closeSheet(); opt.onOwn(q); };
        return;
      }
      listEl.innerHTML = lead + show.map((d) => {
        const taken = opt.taken ? opt.taken(d) : null; const on = st.sel.has(d.sku); const p = priceOf(d);
        return '<div class="dk-row' + (on ? ' on' : '') + (taken ? ' taken' : '') + '" role="listitem" data-sku="' + esc(d.sku) + '">' +
          (opt.many ? '<span class="dk-check" aria-hidden="true">' + (taken ? ic('check', 'sm') : on ? ic('check', 'sm') : '') + '</span>' : '') +
          '<div class="grow dk-main"><div class="dk-name">' + esc(d.name) + (d.confidence === 'Verify' ? ' <span class="dk-tag" title="Check this drink before selling it">to check</span>' : '') + '</div><div class="dk-meta">' + esc(SRC.metaLine(d)) + '</div>' +
          (taken ? '<div class="dk-taken">' + esc(taken) + '</div>' : opt.note && opt.note(d) ? '<div class="dk-stock">' + esc(opt.note(d)) + '</div>' : '') + '</div>' +
          '<div class="dk-side">' + (p ? '<b class="money">' + fmt(p) + '</b>' : '') + '<button type="button" class="icon-btn dk-info" data-dk-info aria-label="Details" aria-expanded="' + (st.open === d.sku) + '">' + ic('info', 'sm') + '</button></div>' +
          (st.open === d.sku ? SRC.detail(d) : '') + '</div>';
      }).join('') + (all.length > show.length ? '<button type="button" class="btn ghost dk-more" id="dkMore">Show ' + Math.min(60, all.length - show.length) + ' more of ' + (all.length - show.length) + '</button>' : '') +
        (opt.onOwn ? '<div class="hint dk-own">Not in the list? <button type="button" class="linkish" id="dkOwn2">Add your own ' + SRC.noun + '</button></div>' : '');
      if ($('#dkMore', listEl)) $('#dkMore', listEl).onclick = () => { st.limit += 60; drawList(); };
      if ($('#dkOwn2', listEl)) $('#dkOwn2', listEl).onclick = () => { const q = qEl.value.trim(); closeSheet(); opt.onOwn(q); };
    };
    listEl.addEventListener('click', (e) => {
      const r = e.target.closest('.dk-row'); if (!r) return; const d = SRC.bySku(r.dataset.sku); if (!d) return;
      if (e.target.closest('[data-dk-info]')) { st.open = st.open === d.sku ? null : d.sku; drawList(); return; }
      if (e.target.closest('.dk-detail')) return;
      if (opt.taken && opt.taken(d)) { toast(d.name + ': ' + opt.taken(d)); return; }
      if (!opt.many) { closeSheet(); opt.onPick([d], { price: priceOf(d) }); return; }
      if (st.sel.has(d.sku)) st.sel.delete(d.sku); else st.sel.set(d.sku, d); drawList(); drawFoot();
    });
    catsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-dk-cat]'); if (!b) return; st.cat = b.dataset.dkCat; st.limit = 60; drawCats(); drawList(); listEl.scrollTop = 0; });
    let t; qEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.q = qEl.value; st.limit = 60; drawCats(); drawList(); }, 120); });
    async function go() {
      const list = [...st.sel.values()]; if (!list.length) return; const b = $('#dkGo', foot); b.disabled = true; b.textContent = 'Adding…';
      const keep = await opt.onPick(list, { price: st.price, priceOf }); if (keep === false) { b.disabled = false; drawFoot(); return; }
      closeSheet();
    }
    drawCats(); drawList(); drawFoot(); setTimeout(() => qEl.focus(), 50);
    return sh;
  }
  return { load, ready, find, byName, bySku, norm, size, packLabel, metaLine, toProduct, menuCat, productOf, inStock, servable, addStockCats, picker, about };
})();
