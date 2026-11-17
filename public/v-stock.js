/* Aahsso — Stock, products, pricing, labels, purchases, containers */

const catOpts = () => Object.keys(S().categories || KC.CATEGORIES);
const subOpts = (cat) => ((S().categories || KC.CATEGORIES)[cat] || []);
const lotStageBadge = (l) => { const x = K.C.lotX[l.id]; if (!x) return ''; return x.stage === 'warehouse' ? '<span class="badge ok">Warehouse</span>' : x.stage === 'transit' ? '<span class="badge info">' + esc((KC.SHIP_STATUSES.find((s) => s[0] === (byId('shipments', l.shipmentId) || {}).status) || [0, 'In transit'])[1]) + '</span>' : '<span class="badge acc">Waiting to ship</span>'; };
const shipName = (id) => { const s = id && byId('shipments', id); return s ? (s.name || s.containerNo || 'Container') : '—'; };

/* ---------- stock ---------- */
function stockList() {
  const f = K.ui.stockFilter, q = K.ui.stockQ.toLowerCase(), cat = K.ui.stockCat; const low = num(S().lowStock) || 3; const w = num(S().expiryWarnDays) || 60;
  return K.raw.products.filter((p) => !p.archived || f === 'archived').filter((p) => {
    const x = K.C.prodX[p.id];
    if (f === 'archived') return p.archived;
    if (f === 'all') return x.available > 0 || x.reserved > 0;
    if (f === 'transit') return x.transit + x.us > 0;
    if (f === 'low') return x.available > 0 && x.available <= low;
    if (f === 'expiring') return x.available > 0 && x.nextExpiry && daysUntil(x.nextExpiry) <= w;
    if (f === 'out') return x.available <= 0 && x.transit + x.us <= 0;
    if (f === 'problems') return x.oversold > 0;
    return true;
  }).filter((p) => !cat || p.category === cat).filter((p) => !q || (p.name + ' ' + (p.subcategory || '') + ' ' + (p.barcode || '')).toLowerCase().includes(q))
    .sort((a, b) => f === 'expiring' ? (K.C.prodX[a.id].nextExpiry || '').localeCompare(K.C.prodX[b.id].nextExpiry || '') : a.name.localeCompare(b.name));
}
VIEWS.stock = {
  render() {
    const F_ = [['all', 'In stock'], ['transit', 'Incoming'], ['low', 'Low stock'], ['expiring', 'Expiring'], ['out', 'Sold out'], ['every', 'All items'], ['archived', 'Archived']].concat(K.raw.products.some((p) => (K.C.prodX[p.id] || {}).oversold > 0) ? [['problems', '⚠ Oversold']] : []);
    const list = stockList();
    const tot = K.raw.products.reduce((a, p) => { const x = K.C.prodX[p.id]; a.u += x.available; a.c += x.stockValue; a.r += x.retailValue; a.t += x.transit + x.us; return a; }, { u: 0, c: 0, r: 0, t: 0 });
    return (seeCost() ? '<div class="kpis mb">' + kpi('Units in stock', fmt(tot.u), fmt(tot.t) + ' incoming', true) + kpi('Stock at cost', F(tot.c)) + kpi('Stock at selling price', F(tot.r)) + kpi('Potential profit', F(tot.r - tot.c), tot.c ? pct((tot.r - tot.c) / tot.c * 100) + ' markup' : '') + '</div>' : '') +
      '<div class="row wrap mb">' + (can('stockEdit') ? '<button class="btn pri" data-a="pricing">' + ic('tag') + 'Set prices / markup</button><button class="btn" data-a="labels">' + ic('barcode') + 'Barcode labels</button>' : '') + (can('export') ? '<button class="btn" data-a="exportStock">' + ic('dl') + 'Excel</button>' : '') + '</div>' +
      '<div class="chips mb">' + F_.map(([k, l]) => '<button class="chip' + (K.ui.stockFilter === k ? ' on' : '') + '" data-a="stockFilter" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      '<div class="row mb"><div class="search grow">' + ic('search') + '<input class="inp" placeholder="Search item or barcode" value="' + esc(K.ui.stockQ) + '" data-i="stockQ"></div><select class="inp" style="width:auto;max-width:44%" data-c="stockCat"><option value="">All categories</option>' + catOpts().map((c) => '<option' + (K.ui.stockCat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select></div>' +
      stockRows(list);
  },
};
function stockRows(list) {
  const X = (p) => K.C.prodX[p.id]; const multi = allLocs().length > 1; const cost = seeCost();
  const low = num(S().lowStock) || 3; const w = num(S().expiryWarnDays) || 60;
  const here = (p) => multi ? (X(p).byLoc[K.loc] || 0) : X(p).available;
  // one status per item: the most important thing to know
  const status = (p) => { const x = X(p); if (x.oversold > 0) return ['Oversold', 'bad']; if (x.available <= 0) return ['Sold out', '']; if (x.nextExpiry && daysUntil(x.nextExpiry) <= w) return ['Expiring', 'warn']; if (x.available <= low) return ['Low', 'warn']; return ['In stock', 'ok']; };
  return dataTable({
    id: 'stockList', rows: list, noun: 'item', limit: 400,
    empty: '<div class="big">📦</div>Nothing here.' + (can('purchases') && !K.raw.products.length ? '<div class="mt"><a class="btn pri" href="#buy">Record your first purchase</a></div>' : ''),
    rowAttr: (p) => ' data-a="toggleX" data-k="p' + p.id + '"',
    expand: { key: (p) => 'p' + p.id, html: (p) => productExpand(p) },
    cols: [
      { k: 'photo', label: 'Photo', core: true, cls: 'thumbc', v: () => '', html: (p) => thumb(p, 36, 9) },
      { k: 'name', label: 'Item', core: true, v: (p) => p.name, html: (p) => '<b>' + esc(p.name) + '</b>' },
      { k: 'cat', label: 'Category', core: true, v: (p) => p.category || '' },
      { k: 'sub', label: 'Subcategory', v: (p) => p.subcategory || '', cls: 'mut' },
      { k: 'cond', label: 'Condition', v: (p) => p.condition || 'New' },
      { k: 'size', label: 'Size', v: (p) => KC.sizeLabel(p) || '' },
      { k: 'unit', label: 'Unit', v: (p) => p.unit || '', cls: 'mut' },
      { k: 'barcode', label: 'Barcode', v: (p) => p.barcode || '', cls: 'mut' },
      { k: 'qty', label: multi ? 'In stock here' : 'In stock', core: true, num: true, cls: 'b', v: here, html: (p) => fmt(here(p)) + (KC.packText(p, here(p)) ? '<div class="tiny muted pk-t">' + esc(KC.packText(p, here(p))) + '</div>' : ''), total: (rows) => fmt(dtSum(rows, here)) },
      multi ? { k: 'all', label: 'All branches', num: true, v: (p) => X(p).available } : null,
      { k: 'inc', label: 'Incoming', core: true, num: true, v: (p) => X(p).transit + X(p).us || '', total: (rows) => fmt(dtSum(rows, (p) => X(p).transit + X(p).us)) },
      { k: 'held', label: 'Held for clients', num: true, v: (p) => X(p).reserved || '' },
      { k: 'price', label: 'Price', core: true, money: true, v: (p) => X(p).promo ? X(p).promo.price : X(p).priceMax, html: (p) => X(p).promo ? '<span class="promo-p">' + fmt(X(p).promo.price) + '</span> <s class="faint">' + fmt(X(p).priceMax) + '</s>' : fmt(X(p).priceMax) },
      { k: 'ws', label: 'Wholesale price', money: true, v: (p) => X(p).priceWholesale },
      { k: 'min', label: 'Lowest price', money: true, v: (p) => X(p).priceMin },
      cost ? { k: 'avg', label: 'Avg landed cost', money: true, v: (p) => Math.round(X(p).avgCost) } : null,
      cost ? { k: 'val', label: 'Stock value (cost)', money: true, v: (p) => Math.round(X(p).stockValue), total: (rows) => fmt(dtSum(rows, (p) => X(p).stockValue)) } : null,
      { k: 'sold', label: 'Sold', num: true, v: (p) => X(p).sold || '' },
      { k: 'exp', label: 'Next expiry', v: (p) => X(p).nextExpiry || '', html: (p) => X(p).nextExpiry ? expiryBadge(X(p).nextExpiry) : dtNil },
      { k: 'status', label: 'Status', core: true, v: (p) => status(p)[0], html: (p) => '<span class="badge ' + status(p)[1] + '">' + status(p)[0] + '</span>' },
    ],
  });
}
function productExpand(p) {
  const x = K.C.prodX[p.id]; const lots = x.lotIds.map((id) => byId('lots', id)).filter(Boolean).sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''));
  const src = imgSrc(p.image);
  const locRow = allLocs().length > 1 ? '<div class="row wrap gap6 mb">' + allLocs().map((L) => '<span class="badge' + (L.id === K.loc ? ' brand' : '') + '">' + esc(L.name) + ': ' + fmt(x.byLoc[L.id] || 0) + '</span>').join('') + '</div>' : '';
  return '<div class="expand">' + locRow + '<div class="row mb" style="align-items:flex-start">' + (src ? '<img src="' + esc(src) + '" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:14px;flex:none">' : '') + '<div class="small col gap4">' + (KC.sizeLabel(p) ? '<div><span class="faint">Size:</span> <b>' + esc(KC.sizeLabel(p)) + '</b></div>' : '') + '<div><span class="faint">Sold by:</span> <b>' + esc(p.unit || 'piece') + '</b></div>' + ((can('stockEdit') || can('purchases')) ? '<button class="btn sm" data-a="quickPhoto" data-id="' + p.id + '">' + ic('cam', 'sm') + (src ? 'Change photo' : 'Add photo') + '</button>' : '') + '</div></div><div class="grid4 small">' +
    (seeCost() ? '<div><div class="faint tiny">Avg landed cost</div><div class="b money">' + F(x.avgCost) + '</div></div><div><div class="faint tiny">Markup</div><div class="b">' + (x.priceManual ? 'Fixed price' : pct(x.markup)) + '</div></div>' : '') +
    '<div><div class="faint tiny">Price (max)</div><div class="b money">' + F(x.priceMax) + '</div></div><div><div class="faint tiny">Wholesale' + (x.bulkQty ? ' / ' + x.bulkQty + '+' : '') + '</div><div class="b money">' + F(x.priceWholesale) + '</div></div><div><div class="faint tiny">Lowest allowed</div><div class="b money">' + F(x.priceMin) + '</div></div>' +
    (seeCost() ? '<div><div class="faint tiny">Sold</div><div class="b">' + fmt(x.sold) + '</div></div><div><div class="faint tiny">Revenue</div><div class="b money">' + F(x.revenue) + '</div></div><div><div class="faint tiny">Profit</div><div class="b money" style="color:var(--ok)">' + F(x.profit) + '</div></div><div><div class="faint tiny">Margin</div><div class="b">' + (x.revenue ? pct(x.profit / x.revenue * 100) : '—') + '</div></div>' : '') + '</div>' +
    (p.barcode ? '<div class="tiny muted mt">Barcode: <b>' + esc(p.barcode) + '</b></div>' : '') +
    '<div class="tw mt"><table class="t"><thead><tr><th>Bought</th><th>Where</th><th>Container</th><th class="r">Qty</th><th class="r">Left</th>' + (seeCost() ? '<th class="r">Paid</th><th class="r">Landed/unit</th>' : '') + '<th>Expiry</th></tr></thead><tbody>' +
    lots.map((l) => { const lx = K.C.lotX[l.id]; return '<tr><td class="nowrap">' + fmtDate(l.purchaseDate) + '</td><td>' + esc(l.vendor || l.sourceType || '') + '</td><td>' + esc(shipName(l.shipmentId)) + '<br>' + lotStageBadge(l) + (l.reservedFor ? '<br><span class="badge acc">For ' + esc(custName(l.reservedFor)) + '</span>' : '') + '</td><td class="r">' + l.qty + (lx.received < num(l.qty) ? '<div class="tiny" style="color:var(--bad)">−' + (num(l.qty) - lx.received) + ' lost</div>' : '') + '</td><td class="r b">' + (l.reservedFor ? lx.clientAvail : lx.stage === 'warehouse' ? lx.available : '—') + '</td>' + (seeCost() ? '<td class="r money">' + money(l.unitCost, l.currency) + '</td><td class="r money">' + fmt(lx.landedUnit) + '</td>' : '') + '<td class="nowrap">' + (l.expiry ? fmtDate(l.expiry) : '—') + '</td></tr>'; }).join('') +
    '</tbody></table></div><div class="row wrap mt">' + (can('stockEdit') ? '<button class="btn sm" data-a="editProduct" data-id="' + p.id + '">' + ic('edit', 'sm') + 'Edit / price</button>' : '') + (can('lossReport') || can('stockEdit') ? '<button class="btn sm" data-a="lossNew" data-id="' + p.id + '">' + ic('alert', 'sm') + 'Record loss</button>' : '') + (can('stockEdit') ? '<button class="btn sm" data-a="adjustStock" data-id="' + p.id + '">' + ic('check', 'sm') + 'Correct count</button>' : '') + '<button class="btn sm" data-a="itemHistory" data-id="' + p.id + '">' + ic('clock', 'sm') + 'History</button><button class="btn sm" data-a="labelOne" data-id="' + p.id + '">' + ic('barcode', 'sm') + 'Label</button>' + (x.available > 0 ? '<button class="btn sm pri" data-a="sellThis" data-id="' + p.id + '">' + ic('sell', 'sm') + 'Sell</button>' : '') + '</div></div>';
}
A.stockFilter = (el) => { K.ui.stockFilter = el.dataset.v; render(true); };
CH.stockCat = (el) => { K.ui.stockCat = el.value; render(true); };
I.stockQ = (el) => { K.ui.stockQ = el.value; clearTimeout(I._st); I._st = setTimeout(() => dtRefresh('stockList'), 120); };
A.sellThis = (el) => { A.newSale(); addToCart(el.dataset.id); };
A.exportStock = () => {
  const rows = K.raw.products.map((p) => { const x = K.C.prodX[p.id]; const r = { Item: p.name, Category: p.category, Subcategory: p.subcategory, Condition: p.condition, Barcode: p.barcode || '', 'In stock': x.available, Incoming: x.transit + x.us, ['Price max (' + baseSym() + ')']: x.priceMax, ['Price min (' + baseSym() + ')']: x.priceMin, 'Next expiry': x.nextExpiry || '' }; if (seeCost()) Object.assign(r, { ['Avg landed cost (' + baseSym() + ')']: Math.round(x.avgCost), ['Stock value (' + baseSym() + ')']: Math.round(x.stockValue), 'Units sold': x.sold, ['Revenue (' + baseSym() + ')']: Math.round(x.revenue), ['Profit (' + baseSym() + ')']: Math.round(x.profit) }); return r; });
  xlsxDownload('Stock-' + todayStr() + '.xlsx', { Stock: rows });
};

/* ---------- product edit ---------- */
A.editProduct = (el) => editProduct(el.dataset.id);
function editProduct(id) {
  const p = byId('products', id); const x = K.C.prodX[id];
  const sh = openSheet({
    title: 'Edit item',
    body: '<div class="col"><div class="row"><div class="photo-slot" data-a="pickPhoto">' + (imgSrc(p.image) ? '<img src="' + esc(imgSrc(p.image)) + '">' : ic('cam')) + '</div><div class="grow">' + field('Item name', inp('name', p.name)) + '</div></div>' + unitFields(p) + packFields(p) + '<div class="grid2">' + field('Category', sel('category', !p.category || catOpts().includes(p.category) ? catOpts() : [p.category].concat(catOpts()), p.category, 'id="pCat"')) + field('Subcategory', sel('subcategory', subOpts(p.category), p.subcategory, 'id="pSub"')) + '</div>' +
      '<div class="grid2">' + field('Condition', sel('condition', KC.CONDITIONS, p.condition || 'New')) + field('Barcode', '<div class="row gap6">' + inp('barcode', p.barcode, 'id="pBar" placeholder="Scan or generate"') + '<button class="btn sm" type="button" data-a="genBar">Gen</button></div>') + '</div>' +
      '<div class="card pad"><h3>Pricing</h3><div class="tiny muted mb">Average landed cost: <b class="money">' + F(x.avgCost) + '</b>. Leave fixed prices empty to follow the markup.</div><div class="grid2">' +
      field('Markup % (max price)', inp('markup', p.markup ?? '', 'inputmode="decimal" placeholder="Default ' + S().defaultMarkup + '"')) + field('Min markup % (bulk)', inp('minMarkup', p.minMarkup ?? '', 'inputmode="decimal" placeholder="Default ' + S().minMarkup + '"')) +
      field('Fixed max price (' + baseSym() + ')', inp('priceMax', p.priceMax || '', 'inputmode="numeric" placeholder="Auto: ' + fmt(x.priceMax) + '"')) + field('Fixed min price (' + baseSym() + ')', inp('priceMin', p.priceMin || '', 'inputmode="numeric" placeholder="Auto: ' + fmt(x.priceMin) + '"')) + '</div>' +
      '<h3 class="mt">Wholesale / bulk</h3><div class="tiny muted mb">Used automatically for Wholesale & Reseller customers, or when a line reaches the bulk quantity.</div><div class="grid3">' + field('Wholesale markup %', inp('wholesaleMarkup', p.wholesaleMarkup ?? '', 'inputmode="decimal" placeholder="Default ' + S().wholesaleMarkup + '"')) + field('Fixed wholesale price', inp('priceWholesale', p.priceWholesale || '', 'inputmode="numeric" placeholder="Auto: ' + fmt(x.priceWholesale) + '"')) + field('Bulk from qty', inp('bulkQty', p.bulkQty || '', 'inputmode="numeric" placeholder="' + (S().bulkQty ? 'Default ' + S().bulkQty : 'Off') + '"')) + '</div></div>' +
      field('Notes', '<textarea class="inp" name="notes">' + esc(p.notes || '') + '</textarea>') + '<label class="toggle"><input type="checkbox" name="archived" ' + (p.archived ? 'checked' : '') + '>Archive (hide from lists)</label></div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="pSave">Save</button>',
  });
  $('#pCat', sh).onchange = (e) => ($('#pSub', sh).innerHTML = subOpts(e.target.value).map((s) => '<option>' + esc(s) + '</option>').join(''));
  $('#pSave', sh).onclick = async () => {
    const v = formVals(sh);
    ['markup', 'minMarkup', 'wholesaleMarkup'].forEach((k) => (v[k] = v[k] === '' ? null : num(v[k])));
    ['priceMax', 'priceMin', 'priceWholesale', 'bulkQty'].forEach((k) => (v[k] = v[k] === '' ? null : num(v[k])));
    if (v.barcode && K.raw.products.some((o) => o.id !== id && o.barcode === v.barcode)) return toast('Another item already uses this barcode', true);
    v.size = v.size === '' ? null : num(v.size);
    const packs = readPacks(sh); if (typeof packs === 'string') return toast(packs, true); v.packs = packs; ['pkName0', 'pkSize0', 'pkPrice0', 'pkName1', 'pkSize1', 'pkPrice1', 'pkName2', 'pkSize2', 'pkPrice2'].forEach((k) => delete v[k]);
    if (sh._photo) { try { v.image = await storePhoto(sh._photo); } catch (e) { toast(e.message, true); } }
    if (await save('products', withPriceLog(p, Object.assign({}, p, v), 'Edit item'))) { closeSheet(); scheduleRender(); refreshSheets(); toast('Saved'); }
  };
}
A.genBar = (el) => { const i = $('#pBar', el.closest('.sheet')); i.value = genBarcode(); };
function genBarcode() { let c; do { c = '20' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'); } while (K.raw.products.some((p) => p.barcode === c)); return c; }

/* ---------- adjustments ---------- */
A.adjustStock = (el) => {
  const p = byId('products', el.dataset.id); const x = K.C.prodX[p.id];
  const here = (l) => K.C.lotX[l.id].byLoc[K.loc] || 0;
  const lots = x.lotIds.map((id) => byId('lots', id)).filter((l) => K.C.lotX[l.id].stage === 'warehouse' && !l.reservedFor);
  const sys = lots.reduce((a, l) => a + Math.max(0, here(l)), 0);
  if (!lots.length) return toast('No stock of this item in the warehouse yet', true);
  const sh = openSheet({
    title: 'Correct stock count · ' + p.name,
    body: '<div class="alert info mb">System stock at ' + esc(locName(K.loc)) + ': <b>' + sys + '</b>. Count what is on the shelf; the difference is recorded. For something stolen, damaged or eaten by pests, use <b>Record loss</b> instead.</div>' +
      '<div class="col">' + field('Quantity counted on shelf', inp('countQty', '', 'inputmode="numeric"')) +
      field('Reason', sel('reason', ['Count correction', 'Stock count difference', 'Found / extra', 'Unaccounted for'], 'Count correction')) + field('Date', inp('date', todayStr(), 'type="date"')) + field('Notes', inp('notes', '')) + '</div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="aSave">Save</button>',
  });
  sh._mode = 'count';
  $('#aSave', sh).onclick = async () => {
    const v = formVals(sh); const diff = num(v.countQty) - sys;
    if (v.countQty === '') return toast('Enter the counted quantity', true);
    if (!diff) { closeSheet(); return toast('No difference — nothing to record'); }
    // spread across lots: losses from lots with most recent purchase first; gains to newest lot
    const ordered = lots.slice().sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''));
    const adj = []; let left = diff;
    if (diff > 0) adj.push({ lotId: ordered[0].id, qty: diff });
    else for (const l of ordered) { if (left >= 0) break; const av = Math.max(0, here(l)); const take = Math.min(av, -left); if (take > 0) { adj.push({ lotId: l.id, qty: -take }); left += take; } }
    if (left < 0 && diff < 0 && !adj.length) return toast('Nothing in stock to remove', true);
    for (const a of adj) await save('adjustments', { id: uid('a_'), date: v.date || todayStr(), productId: p.id, lotId: a.lotId, qty: a.qty, locationId: K.loc, byId: K.me.id || '', reason: v.reason, cause: a.qty < 0 ? 'count' : undefined, notes: v.notes, by: K.info.userLabel || '' });
    closeSheet(); scheduleRender(); toast('Stock updated (' + (diff > 0 ? '+' : '') + diff + ')');
  };
};

/* ---------- pricing tool ---------- */
A.pricing = (el) => {
  const sh = openSheet({ title: 'Prices & markup', wide: true, body: '', foot: '<button class="btn grow" data-a="sheetClose">Close</button><button class="btn pri grow" id="prSave">Save changes</button>' });
  sh._f = { cat: '', ship: (el && el.dataset && el.dataset.ship) || '', q: '' }; sh._chg = {};
  const ships = K.raw.shipments.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const rowsFor = () => K.raw.products.filter((p) => !p.archived).filter((p) => { const x = K.C.prodX[p.id]; return x.available + x.transit + x.us > 0; })
    .filter((p) => !sh._f.cat || p.category === sh._f.cat).filter((p) => !sh._f.ship || K.C.prodX[p.id].lotIds.some((id) => (byId('lots', id) || {}).shipmentId === sh._f.ship))
    .filter((p) => !sh._f.q || p.name.toLowerCase().includes(sh._f.q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const preview = (p) => { const c = sh._chg[p.id] || {}; const m = Object.assign({}, p, c); const x = K.C.prodX[p.id]; const mk = m.markup ?? S().defaultMarkup; const mn = m.minMarkup ?? S().minMarkup; const mx = num(m.priceMax) > 0 ? num(m.priceMax) : KC.roundTo(x.avgCost * (1 + num(mk) / 100), S().roundTo); const mi = num(m.priceMin) > 0 ? num(m.priceMin) : Math.min(mx, KC.roundTo(x.avgCost * (1 + num(mn) / 100), S().roundTo)); return { mk, mn, mx, mi, prof: x.avgCost ? (mx - x.avgCost) / x.avgCost * 100 : 0 }; };
  const draw = () => {
    const rows = rowsFor();
    setSheetBody(sh, '<div class="alert info mb">Your target: mark everything up (e.g. 100%), then adjust individual items. Prices round up to the nearest ' + S().roundTo + ' ' + baseSym() + '. Fixed prices override markup.</div>' +
      '<div class="row wrap mb"><select class="inp" style="width:auto" id="fCat"><option value="">All categories</option>' + catOpts().map((c) => '<option' + (sh._f.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select><select class="inp" style="width:auto" id="fShip"><option value="">All shipments</option>' + ships.map((s) => '<option value="' + s.id + '"' + (sh._f.ship === s.id ? ' selected' : '') + '>' + esc(s.name || s.containerNo) + '</option>').join('') + '</select><input class="inp grow" style="min-width:140px" id="fQ" placeholder="Search" value="' + esc(sh._f.q) + '"></div>' +
      '<div class="card pad mb row wrap"><span class="b">Apply to all ' + rows.length + ' shown:</span><input class="inp" style="width:90px" id="bulkMk" inputmode="decimal" placeholder="100"><span>% markup</span><input class="inp" style="width:90px" id="bulkMn" inputmode="decimal" placeholder="' + S().minMarkup + '"><span>% min</span><button class="btn acc" id="bulkGo">Apply</button></div>' +
      '<div class="tw card"><table class="t"><thead><tr><th>Item</th><th class="r">Stock</th><th class="r">Cost</th><th class="r">Markup %</th><th class="r">Max price</th><th class="r">Min price</th><th class="r">Wholesale</th><th class="r">Profit</th></tr></thead><tbody>' +
      rows.map((p) => { const x = K.C.prodX[p.id], pv = preview(p), c = Object.assign({}, p, sh._chg[p.id] || {}); return '<tr><td style="min-width:150px">' + esc(p.name) + '</td><td class="r">' + x.available + (x.transit + x.us ? '<span class="faint">+' + (x.transit + x.us) + '</span>' : '') + '</td><td class="r money">' + fmt(x.avgCost) + '</td>' +
        '<td class="r"><input class="inp price-in" style="width:76px" inputmode="decimal" data-pr="markup" data-id="' + p.id + '" value="' + (c.markup ?? '') + '" placeholder="' + S().defaultMarkup + '"></td><td class="r"><input class="inp price-in" inputmode="numeric" data-pr="priceMax" data-id="' + p.id + '" value="' + (num(c.priceMax) || '') + '" placeholder="' + fmt(pv.mx) + '"></td><td class="r"><input class="inp price-in" inputmode="numeric" data-pr="priceMin" data-id="' + p.id + '" value="' + (num(c.priceMin) || '') + '" placeholder="' + fmt(pv.mi) + '"></td><td class="r"><input class="inp price-in" inputmode="numeric" data-pr="priceWholesale" data-id="' + p.id + '" value="' + (num(c.priceWholesale) || '') + '" placeholder="' + fmt(x.priceWholesale) + '"></td><td class="r b" style="color:' + (pv.prof < 0 ? 'var(--bad)' : 'var(--ok)') + '">' + pct(pv.prof) + '</td></tr>'; }).join('') + '</tbody></table></div>');
    $('#fCat', sh).onchange = (e) => { sh._f.cat = e.target.value; draw(); };
    $('#fShip', sh).onchange = (e) => { sh._f.ship = e.target.value; draw(); };
    $('#fQ', sh).onchange = (e) => { sh._f.q = e.target.value; draw(); };
    $('#bulkGo', sh).onclick = () => { const mk = $('#bulkMk', sh).value, mn = $('#bulkMn', sh).value; if (mk === '' && mn === '') return; rows.forEach((p) => { const c = (sh._chg[p.id] = sh._chg[p.id] || {}); if (mk !== '') { c.markup = num(mk); c.priceMax = null; } if (mn !== '') { c.minMarkup = num(mn); c.priceMin = null; } }); draw(); toast('Applied — tap Save changes'); };
    $$('[data-pr]', sh).forEach((i) => i.addEventListener('change', () => { const c = (sh._chg[i.dataset.id] = sh._chg[i.dataset.id] || {}); c[i.dataset.pr] = i.value === '' ? null : num(i.value); }));
  };
  draw();
  $('#prSave', sh).onclick = async () => {
    const ids = Object.keys(sh._chg); if (!ids.length) return closeSheet();
    let n = 0; for (const id of ids) { const p = byId('products', id); if (p && await save('products', withPriceLog(p, Object.assign({}, p, sh._chg[id]), 'Prices & markup'))) n++; }
    closeSheet(); scheduleRender(); toast(n + ' item(s) repriced');
  };
};

/* ---------- barcode labels ---------- */
A.labelOne = (el) => labelsSheet([el.dataset.id]);
A.labels = () => labelsSheet(null);
function labelsSheet(preIds) {
  const prods = K.raw.products.filter((p) => !p.archived && (preIds ? preIds.includes(p.id) : K.C.prodX[p.id].available > 0)).sort((a, b) => a.name.localeCompare(b.name));
  const sh = openSheet({
    title: 'Print barcode labels', wide: true,
    body: '<div class="alert info mb">Pick items and how many labels. Items without a barcode get one generated automatically. The PDF prints on A4 sticker sheets (3×8) or a label printer (50×30 mm).</div>' +
      '<div class="row wrap mb">' + field('Format', sel('fmt', [['a4', 'A4 sheet · 24 labels'], ['roll', 'Label printer · 50×30 mm']], 'a4')) + '<label class="toggle" style="margin-top:18px"><input type="checkbox" name="showPrice" checked>Show price</label></div>' +
      '<div class="card list">' + prods.map((p) => '<div class="li" style="cursor:default"><input type="checkbox" data-lb="' + p.id + '" ' + (preIds ? 'checked' : '') + ' style="width:20px;height:20px;accent-color:var(--brand)"><div class="grow"><div class="t">' + esc(p.name) + '</div><div class="tiny muted">' + (p.barcode ? esc(p.barcode) : 'No barcode yet') + ' · ' + F(K.C.prodX[p.id].priceMax) + '</div></div><input class="inp" style="width:70px" inputmode="numeric" data-lq="' + p.id + '" value="' + Math.max(1, preIds ? 1 : K.C.prodX[p.id].available) + '"></div>').join('') + '</div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="lbGo">' + ic('dl') + 'Download labels PDF</button>',
  });
  $('#lbGo', sh).onclick = async () => {
    if (!window.jspdf || !window.JsBarcode) return toast('Label tools still loading — try again', true);
    const v = formVals(sh); const pick = $$('[data-lb]', sh).filter((c) => c.checked).map((c) => ({ p: byId('products', c.dataset.lb), n: Math.max(1, Math.floor(num($('[data-lq="' + c.dataset.lb + '"]', sh).value))) }));
    if (!pick.length) return toast('Select at least one item', true);
    for (const it of pick) if (!it.p.barcode) { it.p = Object.assign({}, it.p, { barcode: genBarcode(), useBarcode: true }); await save('products', it.p); }
    const roll = v.fmt === 'roll';
    const doc = roll ? new window.jspdf.jsPDF({ unit: 'mm', format: [50, 30], orientation: 'landscape' }) : new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const W = roll ? 50 : 70, H = roll ? 30 : 37.125; let k = 0;
    const cv = document.createElement('canvas');
    for (const it of pick) {
      JsBarcode(cv, it.p.barcode, { format: 'CODE128', displayValue: true, fontSize: 18, height: 60, margin: 4 });
      const img = cv.toDataURL('image/png');
      for (let n = 0; n < it.n; n++) {
        let x0, y0;
        if (roll) { if (k) doc.addPage([50, 30], 'landscape'); x0 = 0; y0 = 0; }
        else { const pos = k % 24; if (k && pos === 0) doc.addPage(); x0 = (pos % 3) * W; y0 = Math.floor(pos / 3) * H; }
        doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.text(S().businessName.slice(0, 34), x0 + 3, y0 + 4);
        doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.text(doc.splitTextToSize(it.p.name, W - 6)[0], x0 + 3, y0 + 8);
        doc.addImage(img, 'PNG', x0 + 3, y0 + 9.5, W - 6, H - (v.showPrice ? 17 : 12));
        if (v.showPrice) { doc.setFontSize(10); doc.text(fmt(K.C.prodX[it.p.id].priceMax) + ' ' + baseCode(), x0 + W / 2, y0 + H - 2.5, { align: 'center' }); }
        k++;
      }
    }
    saveFile('Labels-' + todayStr() + '.pdf', doc.output('blob')); closeSheet();
  };
}

/* ---------- purchases ---------- */
/* One purchase = all lines saved together. New purchases share a transaction ID (lot.purchaseTxnId, same as their
 * bill); older ones are grouped by date + store + order no. as before. */
const purchKey = (l) => l.purchaseTxnId || ('old|' + (l.purchaseDate || '') + '|' + (l.vendor || l.sourceType || '') + '|' + (l.poNumber || ''));
function purchaseGroups(lots) {
  const billByTxn = {}; (K.raw.bills || []).forEach((b) => { if (b.txnId) billByTxn[b.txnId] = b; });
  const m = new Map();
  lots.forEach((l) => { const k = purchKey(l); if (!m.has(k)) m.set(k, []); m.get(k).push(l); });
  return [...m.entries()].map(([key, ls]) => {
    const f = ls[0]; const cur = f.currency || 'USD';
    const sub = ls.reduce((a, l) => a + num(l.unitCost) * num(l.qty), 0), tax = ls.reduce((a, l) => a + num(l.unitTax) * num(l.qty), 0);
    const total = sub + tax;
    const totalX = ls.reduce((a, l) => a + K.C.lotX[l.id].paidX * num(l.qty), 0);
    const units = ls.reduce((a, l) => a + num(l.qty), 0);
    const bill = f.purchaseTxnId ? billByTxn[f.purchaseTxnId] : null;
    const bx = bill ? billX(bill) : null;
    const stages = {}; ls.forEach((l) => { const s = K.C.lotX[l.id].stage; stages[s] = (stages[s] || 0) + 1; });
    const ships = [...new Set(ls.map((l) => l.shipmentId).filter(Boolean))].map((id) => shipName(id));
    const atSeller = ls.filter((l) => l.collected === false).length; // older lines (no field) count as collected
    return { atSeller, key, lots: ls, first: f, date: f.purchaseDate || '', vendor: f.vendor || '', source: f.sourceType || '', po: f.poNumber || '', txnId: f.purchaseTxnId || '', cur, sub, tax, total, totalX, units, bill, bx, stages, ships };
  }).sort((a, b) => (b.date + (b.first.createdAt || '')).localeCompare(a.date + (a.first.createdAt || '')));
}
const STAGE_BADGE = { us: '<span class="badge acc">Waiting to ship</span>', transit: '<span class="badge info">Shipping</span>', warehouse: '<span class="badge ok">In stock</span>' };
const STAGE_NAME = { us: 'Waiting to ship', transit: 'Shipping', warehouse: 'In stock' };
function purchaseTable(groups) {
  const today = todayStr();
  const pays = (g) => g.bill ? (g.bill.payments || []).filter((p) => num(p.amount) > 0) : [];
  const owed = (g) => g.bx && g.bill.status !== 'cancelled' && g.bx.balance > 0.005 ? g.bx.balance : 0;
  const items = (g) => { const m = new Map(); g.lots.forEach((l) => { const n = (byId('products', l.productId) || {}).name || '?'; m.set(n, (m.get(n) || 0) + num(l.qty)); }); return [...m].map(([n, q]) => n + ' ×' + q).join(', '); };
  const oneCur = new Set(groups.map((g) => g.cur)).size === 1 ? (groups[0] || {}).cur : null; // totals in purchase currency only when all the same
  const curTotal = (f) => (rows) => oneCur ? money(dtSum(rows, f), oneCur) : '';
  return dataTable({
    id: 'buyList', rows: groups, noun: 'purchase', limit: 300,
    empty: '<div class="big">🛒</div>No purchases here. Tap <b>New purchase</b> after each store run, or import an Excel list inside it.',
    rowAttr: (g) => ' data-a="openPurchase" data-k="' + esc(g.key) + '"',
    cols: [
      { k: 'date', label: 'Date', core: true, v: (g) => g.date, html: (g) => dtDate(g.date) },
      { k: 'po', label: 'Receipt no.', v: (g) => g.po },
      { k: 'txn', label: 'Transaction ID', v: (g) => g.txnId, cls: 'mut' },
      { k: 'vendor', label: 'Seller', core: true, v: (g) => g.vendor || g.source },
      { k: 'source', label: 'Bought from', v: (g) => g.source, cls: 'mut' },
      { k: 'phone', label: 'Seller phone', v: (g) => g.first.vendorPhone || '', cls: 'mut' },
      { k: 'items', label: 'Items', core: true, wrap: true, v: items },
      { k: 'lines', label: 'Lines', num: true, v: (g) => g.lots.length, total: (rows) => fmt(dtSum(rows, (g) => g.lots.length)) },
      { k: 'units', label: 'Units', num: true, v: (g) => g.units, total: (rows) => fmt(dtSum(rows, (g) => g.units)) },
      { k: 'cur', label: 'Currency', v: (g) => g.cur, cls: 'mut' },
      { k: 'subt', label: 'Before tax', money: true, v: (g) => g.sub, html: (g) => money(g.sub, g.cur), total: curTotal((g) => g.sub) },
      { k: 'tax', label: 'Tax', money: true, v: (g) => g.tax || '', html: (g) => g.tax ? money(g.tax, g.cur) : dtNil, total: curTotal((g) => g.tax) },
      { k: 'total', label: 'Total', core: true, money: true, cls: 'b', v: (g) => g.total, html: (g) => money(g.total, g.cur), total: curTotal((g) => g.total) },
      { k: 'totalx', label: 'Total (' + baseCode() + ')', money: true, v: (g) => Math.round(g.totalX), total: (rows) => fmt(dtSum(rows, (g) => g.totalX)) },
      { k: 'mode', label: 'Payment mode', v: (g) => pays(g).length ? [...new Set(pays(g).map((p) => p.method || 'Cash'))].join(', ') : g.bill ? 'Not paid' : '', html: (g) => pays(g).length ? esc([...new Set(pays(g).map((p) => p.method || 'Cash'))].join(', ')) : g.bill ? '<span class="badge warn">Not paid</span>' : dtNil },
      { k: 'ref', label: 'Payment txn ID', v: (g) => pays(g).map((p) => p.ref).filter(Boolean).join(', '), cls: 'mut' },
      { k: 'paid', label: 'Paid', core: true, money: true, v: (g) => g.bx ? g.bx.paid : '', html: (g) => g.bx ? money(g.bx.paid, g.cur) : dtNil, total: curTotal((g) => g.bx ? g.bx.paid : 0) },
      { k: 'fees', label: 'MoMo charges', money: true, v: (g) => g.bx && g.bx.fees > 0 ? g.bx.fees : '', html: (g) => g.bx && g.bx.fees > 0 ? money(g.bx.fees, g.cur) : dtNil },
      { k: 'owed', label: 'Owed', core: true, money: true, v: (g) => owed(g) || '', html: (g) => owed(g) ? '<span style="color:var(--bad);font-weight:700">' + money(owed(g), g.cur) + '</span>' : dtNil, total: curTotal(owed) },
      { k: 'due', label: 'Pay by', v: (g) => owed(g) ? (g.bill.dueDate || g.bill.date) : '', html: (g) => { if (!owed(g)) return dtNil; const d = g.bill.dueDate || g.bill.date; return d < today ? '<span class="badge bad">Overdue · ' + esc(dayMon(d)) + '</span>' : dtDate(d); } },
      { k: 'where', label: 'Where', core: true, v: (g) => Object.keys(g.stages).map((s) => STAGE_NAME[s]).join(', '), html: (g) => Object.keys(g.stages).map((s) => STAGE_BADGE[s] || '').join(' ') },
      { k: 'coll', label: 'Collected', v: (g) => g.atSeller ? 'No' : 'Yes', html: (g) => g.atSeller ? '<span class="badge warn">' + (g.atSeller === g.lots.length ? 'No · at seller' : 'Partly') + '</span>' : '<span class="badge">Yes</span>' },
      { k: 'ship', label: 'Shipment', v: (g) => g.ships.join(', '), cls: 'mut' },
    ],
  });
}
function purchaseRow(g) { // Excel row
  const pays = g.bill ? (g.bill.payments || []).filter((p) => num(p.amount) > 0) : [];
  return { Date: g.date, 'Transaction ID': g.txnId, 'Receipt no': g.po, Seller: g.vendor, 'Bought from': g.source, 'Seller phone': g.first.vendorPhone || '', 'Items (before tax)': Math.round(g.sub * 100) / 100, Tax: Math.round(g.tax * 100) / 100, Items: g.lots.map((l) => ((byId('products', l.productId) || {}).name || '?') + ' x' + num(l.qty)).join('; '), Lines: g.lots.length, Units: g.units, Currency: g.cur, Total: Math.round(g.total * 100) / 100, ['Total (' + baseCode() + ')']: Math.round(g.totalX), 'Payment mode': [...new Set(pays.map((p) => p.method))].join(', '), 'Payment txn IDs': pays.map((p) => p.ref).filter(Boolean).join(', '), Paid: g.bx ? g.bx.paid : '', 'MoMo charges': g.bx ? g.bx.fees : '', Owed: g.bx ? Math.max(0, g.bx.balance) : '', Shipment: g.ships.join(', '), 'Collected from seller': g.atSeller ? (g.atSeller === g.lots.length ? 'No' : 'Partly') : 'Yes' };
}
A.purchCollected = async (el) => {
  const g = purchaseGroups(K.raw.lots).find((x) => x.key === el.dataset.k); if (!g) return;
  const at = new Date().toISOString();
  for (const l of g.lots.filter((x) => x.collected === false)) await save('lots', Object.assign({}, byId('lots', l.id), { collected: true, collectedAt: at, collectedBy: K.me.name || '' }));
  refreshSheets(); scheduleRender(); toast('Marked as collected');
};
A.exportPurch = () => xlsxDownload('Purchases-' + todayStr() + '.xlsx', { Purchases: (K._buyGroups || []).map(purchaseRow), 'Purchase lines': (K._buyGroups || []).flatMap((g) => g.lots.map((l) => ({ 'Transaction ID': g.txnId, Date: l.purchaseDate, Store: l.vendor || '', 'Order no': l.poNumber || '', Item: (byId('products', l.productId) || {}).name || '', Qty: num(l.qty), Currency: l.currency, 'Weight each (kg)': num(l.weightKg) || '', 'Price paid': num(l.unitCost), 'Tax each': Math.round(num(l.unitTax) * 100) / 100, 'Regular price': num(l.regularPrice) || '', 'Line total': Math.round((num(l.unitCost) + num(l.unitTax)) * num(l.qty) * 100) / 100, Condition: l.condition || 'New', Working: l.working || 'Working', Collected: l.collected === false ? 'No' : 'Yes', Shipment: shipName(l.shipmentId), Stage: STAGE_NAME[K.C.lotX[l.id].stage] }))) });
/** One purchase: its lines (tap a line to edit it) and how it was paid. */
A.openPurchase = (el) => {
  const key = el.dataset.k;
  const g0 = purchaseGroups(K.raw.lots).find((x) => x.key === key); if (!g0) return;
  const sh = openSheet({ title: (g0.vendor || 'Purchase') + (g0.po ? ' · #' + g0.po : ''), wide: true, body: '' });
  // redrawn after a line is edited or deleted (refreshSheets), so figures stay correct
  sh._refresh = () => {
  const g = purchaseGroups(K.raw.lots).find((x) => x.key === key); if (!g) return closeSheet();
  const cur = (v) => money(v, g.cur);
  setSheetBody(sh,
    '<div class="small muted mb">' + fmtDate(g.date) + (g.source ? ' · ' + esc(g.source) : '') + (g.first.vendorPhone ? ' · ' + esc(g.first.vendorPhone) : '') + (g.txnId ? ' · txn ' + esc(g.txnId) : '') + ' · collected from seller: <b>' + (g.atSeller ? (g.atSeller === g.lots.length ? 'No' : 'partly (' + (g.lots.length - g.atSeller) + ' of ' + g.lots.length + ' lines)') : 'Yes') + '</b></div>' +
    (g.atSeller ? '<div class="alert info mb row between"><span>Goods still at the seller — pick them up later.</span><button class="btn sm pri" data-a="purchCollected" data-k="' + esc(g.key) + '">' + ic('check', 'sm') + 'Mark collected</button></div>' : '') +
    '<div class="grid4 mb">' + kpi('Total', cur(g.total), g.tax ? 'incl. ' + cur(g.tax) + ' tax' : g.cur !== baseCode() ? F(g.totalX) : '') + kpi('Paid', g.bx ? cur(g.bx.paid) : '—', g.bx && g.bx.fees > 0 ? '+ ' + cur(g.bx.fees) + ' MoMo charges' : '') + kpi('Owed', g.bx ? cur(Math.max(0, g.bx.balance)) : '—') + kpi('Units', fmt(g.units), g.lots.length + ' line(s)') + '</div>' +
    '<div class="card tw mb"><table class="t sales"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Weight</th><th class="r">Price paid</th><th class="r">Tax share</th><th class="r">Line total</th><th>Where</th></tr></thead><tbody>' +
    g.lots.map((l) => { const p = byId('products', l.productId) || { name: '?' }; const sv = num(l.regularPrice) > num(l.unitCost) ? Math.round((1 - num(l.unitCost) / num(l.regularPrice)) * 100) : 0; return '<tr data-a="editLot" data-id="' + l.id + '"><td class="wrap">' + esc(p.name) + '<span class="sub">' + esc([l.condition || p.condition || 'New', l.working || 'Working', l.collected === false ? 'at seller' : '', l.expiry ? 'exp ' + fmtDate(l.expiry) : '', l.reservedFor ? 'for ' + custName(l.reservedFor) : ''].filter(Boolean).join(' · ')) + '</span></td><td class="r">' + fmt(l.qty) + '</td><td class="r">' + (num(l.weightKg) ? fmtKg(num(l.weightKg) * num(l.qty)) : '<span class="faint">—</span>') + '</td><td class="r money">' + cur(l.unitCost) + '</td><td class="r money">' + (num(l.unitTax) ? cur(num(l.unitTax) * num(l.qty)) : '<span class="faint">—</span>') + (sv ? '<span class="sub">−' + sv + '% vs shelf</span>' : '') + '</td><td class="r money b">' + cur((num(l.unitCost) + num(l.unitTax)) * num(l.qty)) + '</td><td class="st">' + lotStageBadge(l) + '<span class="sub">' + esc(shipName(l.shipmentId)) + '</span></td></tr>'; }).join('') +
    '</tbody></table></div>' +
    (g.bill ? '<h3 class="mb">Payments</h3><div class="card list mb">' + ((g.bill.payments || []).map((p) => billPayRow(p, cur)).join('') || '<div class="empty small">No payment yet.</div>') + '</div><button class="btn" data-a="billOpen" data-id="' + g.bill.id + '">' + ic('wallet') + 'Open bill' + (g.bx.balance > 0.005 ? ' · record payment' : '') + '</button>' : '<div class="tiny muted">Payment details are recorded for purchases added from now on.</div>'));
  };
  sh._refresh();
};
A.buyF = (el) => { K.ui.buyF = el.dataset.v; render(true); };
CH.buyQ = (el) => { K.ui.buyQ = el.value; render(true); };

function findOrCreateProduct(name, cat, sub, cond, barcode) {
  const n = name.trim().toLowerCase();
  let p = K.raw.products.find((x) => x.name.trim().toLowerCase() === n && (x.condition || 'New') === (cond || 'New'));
  if (p) { if (barcode && !p.barcode) { p = Object.assign({}, p, { barcode }); return { p, isNew: false, changed: true }; } return { p, isNew: false }; }
  p = { id: uid('pr_'), name: name.trim(), category: cat || 'Other', subcategory: sub || '', condition: cond || 'New', barcode: barcode || '', markup: null, minMarkup: null, priceMax: null, priceMin: null };
  return { p, isNew: true };
}
const shipOptions = (val) => [['', 'Waiting to ship'], ['__local', 'In Cameroon — in stock']].concat(K.raw.shipments.filter((s) => s.status !== 'closed').map((s) => [s.id, (s.name || s.containerNo || 'Container') + ' · ' + (KC.SHIP_STATUSES.find((x) => x[0] === s.status) || [0, ''])[1]]));

async function savePurchaseLines(h, lines) {
  for (const l of lines) {
    const r = findOrCreateProduct(l.name, l.category, l.subcategory, l.condition, l.barcode);
    if (r.isNew) Object.assign(r.p, { unit: l.unit || 'piece', size: l.size || null, sizeUnit: l.sizeUnit || '' });
    if (num(l.pack) > 1 && !KC.packsOf(r.p).some((k) => k.size === num(l.pack))) { r.p = Object.assign({}, r.p, { packs: ((r.p.packs || []).concat([{ name: 'pack', size: Math.floor(num(l.pack)), price: null }])).slice(0, 3) }); r.changed = true; } // bought by the pack: sell by the pack too
    else if (!r.p.size && l.size) { r.p = Object.assign({}, r.p, { size: l.size, sizeUnit: l.sizeUnit, unit: r.p.unit || l.unit }); r.changed = true; }
    if (l.photo) { try { r.p = Object.assign({}, r.p, { image: await storePhoto(l.photo) }); r.changed = true; } catch (e) { toast('Photo not saved: ' + e.message, true); } }
    if (r.isNew || r.changed) { await save('products', r.p); }
    const local = h.shipmentId === '__local' || h.sourceType === 'Local (Cameroon)';
    await save('lots', { id: uid('l_'), productId: r.p.id, purchaseDate: l.purchaseDate || h.purchaseDate || todayStr(), sourceType: l.sourceType || h.sourceType, vendor: l.vendor || h.vendor || '', vendorPhone: h.vendorPhone || '', weightKg: num(l.weightKg) || null, poNumber: l.poNumber || h.poNumber || '', lotNumber: l.lotNumber || h.lotNumber || '', currency: h.currency || 'USD', regularPrice: l.regularPrice, unitCost: l.unitCost, unitTax: num(l.unitTax) || 0, qty: l.qty, expiry: l.expiry || '', condition: l.condition || 'New', working: l.working || 'Working', collected: h.puCollected !== 'no', shipmentId: local ? '' : (l.shipmentId || h.shipmentId || ''), inWarehouse: local, locationId: local ? K.loc : '', reservedFor: l.reservedFor || '', notes: l.notes || '', purchaseTxnId: h.purchaseTxnId || '' });
  }
}
A.editLot = (el) => {
  const l = byId('lots', el.dataset.id); const p = byId('products', l.productId) || {}; const x = K.C.lotX[l.id];
  const sh = openSheet({
    title: 'Purchase line',
    body: '<div class="col"><div class="b">' + esc(p.name) + '</div>' + (l.purchaseTxnId ? '<div class="tiny muted">Purchase txn ' + esc(l.purchaseTxnId) + '</div>' : '') + '<div class="grid2">' + field('Date', inp('purchaseDate', l.purchaseDate, 'type="date"')) + field('Bought from', sel('sourceType', KC.SOURCE_TYPES.includes(l.sourceType) || !l.sourceType ? KC.SOURCE_TYPES : KC.SOURCE_TYPES.concat([l.sourceType]), l.sourceType)) + field('Seller', inp('vendor', l.vendor)) + field('Receipt / order no.', inp('poNumber', l.poNumber)) +
      field('Regular price / unit', inp('regularPrice', l.regularPrice ?? '', 'inputmode="decimal"')) + field('Price paid / unit (' + curSym(l.currency) + ')', inp('unitCost', l.unitCost, 'inputmode="decimal"')) + field('Tax / unit (' + curSym(l.currency) + ')', inp('unitTax', l.unitTax ? Math.round(num(l.unitTax) * 10000) / 10000 : '', 'inputmode="decimal" placeholder="0"')) + field('Quantity', inp('qty', l.qty, 'inputmode="numeric"')) + field('Expiry date', inp('expiry', l.expiry, 'type="date"')) + '</div>' +
      '<div class="grid3">' + field('Condition', sel('condition', KC.CONDITIONS, l.condition || 'New')) + field('Working?', sel('working', KC.WORKING, l.working || 'Working')) + field('Collected from seller?', sel('collected', [['yes', 'Yes'], ['no', 'No — still at the seller']], l.collected === false ? 'no' : 'yes')) + '</div>' +
      field('Shipment', sel('shipmentId', shipOptions(l.shipmentId), l.inWarehouse ? '__local' : l.shipmentId || '')) + field('Bought for client', sel('reservedFor', custOpts(), l.reservedFor || '')) + field('Notes', inp('notes', l.notes)) +
      (seeCost() ? '<div class="alert info">Landed cost per unit: <b class="money">' + F(x.landedUnit) + '</b> (' + F(x.unitX) + ' item' + (x.taxX ? ' + ' + F(x.taxX) + ' tax' : '') + ' + ' + F(x.landedUnit - x.paidX) + ' shipping & customs share)</div>' : '') + '</div>',
    foot: '<button class="btn danger" id="lDel">' + ic('trash') + '</button><button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="lSave">Save</button>',
  });
  $('#lSave', sh).onclick = async () => { const v = formVals(sh); const local = v.shipmentId === '__local'; Object.assign(v, { regularPrice: num(v.regularPrice) || null, unitCost: num(v.unitCost), unitTax: num(v.unitTax) || 0, qty: Math.floor(num(v.qty)), shipmentId: local ? '' : v.shipmentId, inWarehouse: local, collected: v.collected !== 'no' }); if (await save('lots', Object.assign({}, l, v))) { closeSheet(); refreshSheets(); scheduleRender(); } };
  $('#lDel', sh).onclick = async () => { if (x.sold > 0) return toast('This line has sales — adjust quantity instead of deleting', true); if (await confirmBox('Delete this purchase line?', 'Delete', true)) { await remove('lots', l.id); closeSheet(); refreshSheets(); scheduleRender(); } };
};
function pickCol(row, names) { const keys = Object.keys(row); for (const n of names) { const k = keys.find((k) => k.toLowerCase().replace(/[^a-z]/g, '') === n.toLowerCase().replace(/[^a-z]/g, '')); if (k && row[k] !== '' && row[k] != null) return row[k]; } for (const n of names) { const k = keys.find((k) => k.toLowerCase().includes(n.toLowerCase())); if (k && row[k] !== '' && row[k] != null) return row[k]; } return ''; }
function xlDate(v) { if (!v) return ''; if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); } const d = new Date(v); return isNaN(d) ? String(v) : todayStr(d); }
async function readSheet(file) { const buf = await file.arrayBuffer(); const wb = XLSX.read(buf, { type: 'array' }); return wb; }
/* ---------- containers ---------- */
const stIdx = (st) => KC.SHIP_STATUSES.findIndex((s) => s[0] === st);
A.newShip = () => shipForm(null);
function shipForm(id) {
  const s = id ? byId('shipments', id) : { status: 'planning', origin: 'Houston, TX', destination: 'Douala, Cameroon', size: "40' HC", fxRates: Object.assign({}, S().fxRates || { USD: S().fxRate }) };
  const n = K.raw.shipments.length + 1;
  const sh = openSheet({
    title: id ? 'Edit shipment' : 'New shipment',
    body: '<div class="col">' + field('Name', inp('name', s.name || 'Shipment #' + n + ' – ' + MONTHS[new Date().getMonth()] + ' ' + new Date().getFullYear())) + (id ? '' : shipPickHTML()) + '<h3 class="mt">Container</h3><div class="grid2">' + field('Booking no.', inp('bookingNo', s.bookingNo)) + field('Container no.', inp('containerNo', s.containerNo, 'placeholder="MSCU1234567"')) + field('Seal no.', inp('sealNo', s.sealNo)) + field('Size', sel('size', ["20'", "40'", "40' HC", "45' HC"], s.size)) +
      field('Shipping line', inp('carrier', s.carrier, 'placeholder="MSC, Maersk, CMA CGM…"')) + field('Clearing agent (Douala)', inp('agent', s.agent)) + field('Ship from', inp('origin', s.origin)) + field('Ship to', inp('destination', s.destination)) + '</div><h3 class="mt">Progress</h3><div class="grid2">' +
      field('Step', sel('status', KC.SHIP_STATUSES, s.status)) + field('Loaded on', inp('loadedAt', s.loadedAt, 'type="date"')) + field('ETA / arrived in Cameroon', inp('arrivedAt', s.arrivedAt, 'type="date"')) + field('Customs cleared on', inp('clearedAt', s.clearedAt, 'type="date"')) + field('Unloaded in warehouse', inp('receivedAt', s.receivedAt, 'type="date"')) + '</div>' + field('Notes', '<textarea class="inp" name="notes">' + esc(s.notes || '') + '</textarea>') + '</div>',
    foot: (id ? '<button class="btn danger" id="sDel">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="sSave">Save</button>',
  });
  $('#sSave', sh).onclick = async () => { const v = formVals(sh); Object.keys(v).filter((k) => k.startsWith('sq_') || k.startsWith('sp_')).forEach((k) => delete v[k]); v.fxRates = Object.assign({}, s.fxRates || S().fxRates || {}); v.fxRate = v.fxRates.USD || num(s.fxRate) || num(S().fxRate) || 600; const o = Object.assign({ costs: [] }, s, v, { id: id || uid('sh_') }); const pick = id ? [] : readShipPick(sh);
    if (pick === false) return;
    if (await save('shipments', o)) { for (const [lid, q] of pick) { const l = byId('lots', lid); if (l) await shipUnits(l, q, o.id); } closeSheet(); scheduleRender(); refreshSheets(); if (!id) { openShip(o.id); toast(pick.length ? fmt(pick.reduce((a, x) => a + x[1], 0)) + ' units put in ' + (o.name || 'the shipment') : 'Shipment created — add its items on the Items tab'); } } };
  if (!id) wireShipPick(sh);
  if (id) $('#sDel', sh).onclick = async () => { if (K.raw.lots.some((l) => l.shipmentId === id)) return toast('Remove its items first', true); if (await confirmBox('Delete this shipment?', 'Delete', true)) { await remove('shipments', id); while (K.sheets.length) closeSheet(); scheduleRender(); } };
}
A.openShip = (el) => openShip(el.dataset.id);
function openShip(id, tab) {
  const sh = openSheet({ title: 'Shipment', wide: true, body: '' }); sh._tab = tab || 'sum';
  sh._refresh = () => {
    const s = byId('shipments', id); if (!s) return closeSheet(); const x = K.C.shipX[s.id];
    $('.sh h2', sh).textContent = s.name || 'Shipment';
    const lots = K.raw.lots.filter((l) => l.shipmentId === id);
    const T = [['sum', 'Overview'], ['items', 'Items (' + lots.length + ')'], ['costs', 'Costs (' + (s.costs || []).length + ')'], ['recv', 'Unload & count']];
    let body = '<div class="row wrap between mb"><div class="seg">' + T.map(([k, l]) => '<button class="' + (sh._tab === k ? 'on' : '') + '" data-a="shTab" data-v="' + k + '">' + l + '</button>').join('') + '</div><button class="btn sm" data-a="editShip" data-id="' + id + '">' + ic('edit', 'sm') + 'Details</button></div>';
    if (sh._tab === 'sum') {
      const i = stIdx(s.status);
      body += '<div class="card pad mb"><div class="row between"><div><div class="tiny muted">' + esc([s.containerNo, s.size, s.carrier].filter(Boolean).join(' · ') || 'Add container details') + '</div><div class="b">' + esc(s.origin || '') + ' → ' + esc(s.destination || '') + '</div></div><span class="badge brand">' + esc(KC.SHIP_STATUSES[i][1]) + '</span></div>' + shipSteps(i) +
        '<div class="row wrap mt">' + (i < 6 ? '<button class="btn sm pri" data-a="shAdvance" data-id="' + id + '">Next: ' + esc(KC.SHIP_STATUSES[i + 1][1]) + ' ' + ic('chev', 'sm') + '</button>' : '') + '</div></div>' +
        '<div class="kpis mb">' + kpi('Goods cost', F(x.goodsX), 'tax included, in ' + baseCode()) + kpi('Shipping & receiving', F(x.costsX), 'shipping ' + fmt(x.usX) + ' · receiving ' + fmt(x.cmX)) + kpi('Total landed', F(x.landedX), x.units ? fmt(x.landedX / x.units) + ' F / unit avg' : '') + kpi('Discount captured', F(Math.max(0, x.regularX - x.goodsX)), 'vs regular prices') + '</div>' +
        '<div class="kpis mb">' + kpi('Units', fmt(x.units), fmt(x.unitsSold) + ' sold') + kpi('Revenue', F(x.revenue)) + kpi('Gross profit', F(x.revenue - x.cogs), x.revenue ? pct((x.revenue - x.cogs) / x.revenue * 100) + ' margin' : '') + kpi('Losses', F(x.lossX), 'missing, damaged, theft') + '</div>' +
        '<div class="card pad"><div class="row between"><b>Recovered so far</b><b>' + (x.landedX ? pct(x.revenue / x.landedX * 100) : '—') + ' of landed cost</b></div><div class="bar mt"><i style="width:' + Math.min(100, x.landedX ? x.revenue / x.landedX * 100 : 0) + '%;background:var(--accent)"></i></div><div class="tiny muted mt">Remaining stock from this container: ' + F(x.stockX) + ' at cost.</div></div>' +
        (x.unalloc ? '<div class="alert mt">' + F(x.unalloc) + ' of costs could not be assigned to items (e.g. "vehicles only" but no vehicle in the container).</div>' : '');
    } else if (sh._tab === 'items') {
      const free = K.raw.lots.filter((l) => K.C.lotX[l.id].stage === 'us');
      body += '<div class="row wrap mb"><button class="btn pri" data-a="shAddItems" data-id="' + id + '"' + (free.length ? '' : ' disabled') + '>' + ic('plus') + 'Add items waiting to ship (' + free.length + ')</button></div>' +
        '<div class="tiny muted mb">' + (lots.some((l) => num(l.weightKg)) ? 'Total weight: <b>' + fmtKg(lots.reduce((a, l) => a + num(l.weightKg) * num(l.qty), 0)) + '</b> · ' : '') + 'Tip: if you don\'t know exactly what went in, add everything you bought. Record what was missing on the <b>Receive</b> tab or later with a stock count.</div>' +
        '<div class="card tw"><table class="t"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Paid</th><th class="r">Landed/unit</th><th class="r">Sold</th><th></th></tr></thead><tbody>' +
        lots.map((l) => { const p = byId('products', l.productId) || {}; const lx = K.C.lotX[l.id]; return '<tr><td>' + esc(p.name) + '<div class="tiny faint">' + esc(l.vendor || '') + ' · ' + fmtDate(l.purchaseDate) + '</div></td><td class="r">' + (stIdx(s.status) < 5 && can('containers') ? '<input class="inp sq-in" inputmode="numeric" data-shq="' + l.id + '" value="' + num(l.qty) + '" aria-label="Units shipped">' + (waitOf(l) ? '<div class="tiny faint">+' + fmt(waitOf(l)) + ' waiting</div>' : '') : fmt(l.qty)) + '</td><td class="r money">' + money(l.unitCost, l.currency) + '</td><td class="r money">' + fmt(lx.landedUnit) + '</td><td class="r">' + lx.sold + '</td><td><button class="icon-btn" data-a="shRemoveLot" data-id="' + l.id + '">' + ic('x', 'sm') + '</button></td></tr>'; }).join('') + '</tbody></table>' + (lots.length ? '' : '<div class="empty small">No items yet.</div>') + '</div>';
    } else if (sh._tab === 'costs') {
      const fx = x.fx; const cs = s.costs || [];
      const grp_ = (side) => cs.filter((c) => (c.side || 'US') === side);
      const tbl = (side) => { const g = grp_(side); return '<div class="card mb"><div class="pad row between" style="padding-bottom:4px"><b>' + (side === 'US' ? 'Shipping costs <span class="hint">consolidation, loading, freight, BESC, tests…</span>' : 'Receiving costs <span class="hint">customs, clearing, offloading…</span>') + '</b><b class="money">' + F(g.reduce((a, c) => a + num(c.amount) * KC.rateOf(S(), c.currency || 'USD', s), 0)) + '</b></div><div class="list">' + (g.length ? g.map((c) => '<div class="li" data-a="shCost" data-s="' + id + '" data-c="' + c.id + '"><div class="grow"><div class="t">' + esc(c.category) + '</div><div class="tiny muted">' + esc([c.label, c.paidTo, c.payment ? c.payment.method + (c.payment.ref ? ' txn ' + c.payment.ref : '') + (num(c.payment.fee) > 0 ? ' + ' + money(c.payment.fee, c.currency) + ' charges' : '') : c.billed ? 'on bills to pay' : '', c.date && fmtDate(c.date), { all: 'all items', goods: 'goods only', vehicles: 'vehicles only' }[c.appliesTo || 'all'] || 'one item'].filter(Boolean).join(' · ')) + '</div></div><div class="right b money">' + money(c.amount, c.currency) + '</div></div>').join('') : '<div class="empty small">No costs yet.</div>') + '</div></div>'; };
      body += '<div class="row wrap mb"><button class="btn pri" data-a="shCost" data-s="' + id + '" data-side="US">' + ic('plus') + 'Shipping cost</button><button class="btn pri" data-a="shCost" data-s="' + id + '" data-side="CM">' + ic('plus') + 'Receiving cost</button></div>' +
        '<div class="tiny muted mb">Costs are spread over the items by purchase value, so expensive items carry more of the freight and customs. Car customs can be charged to the car only.</div>' + tbl('US') + tbl('CM');
    } else {
      body += '<div class="alert info mb">Enter what was <b>missing</b> or <b>damaged</b> on arrival. Then tap <b>Confirm received in warehouse</b> — items become available for sale.</div>' +
        '<div class="card tw"><table class="t"><thead><tr><th>Item</th><th class="r">Shipped</th><th class="r">Missing</th><th class="r">Damaged</th></tr></thead><tbody>' +
        lots.map((l) => { const p = byId('products', l.productId) || {}; return '<tr><td>' + esc(p.name) + '</td><td class="r">' + l.qty + '</td><td class="r"><input class="inp" style="width:70px;min-height:36px" inputmode="numeric" data-rv="recvMissing" data-id="' + l.id + '" value="' + (l.recvMissing || '') + '" placeholder="0"></td><td class="r"><input class="inp" style="width:70px;min-height:36px" inputmode="numeric" data-rv="recvDamaged" data-id="' + l.id + '" value="' + (l.recvDamaged || '') + '" placeholder="0"></td></tr>'; }).join('') + '</tbody></table></div>' +
        (allLocs().length > 1 ? '<div class="mt">' + field('Unload into', sel('recvLoc', allLocs().map((L) => [L.id, L.name]), s.locationId || K.loc, 'id="recvLoc"')) + '</div>' : '') +
        '<div class="row wrap mt"><button class="btn" data-a="shSaveRecv" data-id="' + id + '">Save counts</button>' + (stIdx(s.status) < 5 ? '<button class="btn pri" data-a="shReceive" data-id="' + id + '">' + ic('check') + 'Confirm received in warehouse</button>' : '<span class="badge ok">Received ' + fmtDate(s.receivedAt) + '</span>') + '</div>';
    }
    setSheetBody(sh, body);
  };
  sh._refresh();
}
A.shTab = (el) => { const sh = el.closest('.scrim'); sh._tab = el.dataset.v; sh._refresh(); };
A.editShip = (el) => shipForm(el.dataset.id);
/** Items in a shipment; moving an empty shipment forward is what left goods "waiting to ship" for ever. */
const shipLots = (sid) => K.raw.lots.filter((l) => l.shipmentId === sid);
function needsItems(s) {
  if (shipLots(s.id).length) return false;
  const w = K.raw.lots.filter((l) => K.C.lotX[l.id].stage === 'us').length;
  toast((s.name || 'This shipment') + ' is empty — add its items first' + (w ? ' (' + w + ' line' + (w === 1 ? '' : 's') + ' waiting to ship)' : ''), true);
  if (w && can('containers')) A.shAddItems({ dataset: { id: s.id } }); return true;
}
A.shAdvance = async (el) => { const s = byId('shipments', el.dataset.id); if (needsItems(s)) return; const i = stIdx(s.status); const next = KC.SHIP_STATUSES[i + 1][0]; if (next === 'received') return A.shReceive(el); const dk = { loading: 'loadedAt', in_transit: 'departedAt', at_port: 'arrivedAt', cleared: 'clearedAt', closed: 'readyAt' }[next]; const o = Object.assign({}, s, { status: next }); if (dk && !o[dk]) o[dk] = todayStr(); await save('shipments', o); refreshSheets(); scheduleRender(); };
A.shReceive = async (el) => { const s = byId('shipments', el.dataset.id); if (needsItems(s)) return; await saveRecv(el); if (!(await confirmBox('Mark "' + (s.name || 'container') + '" as unloaded in the warehouse? Its items become available for sale.', 'Confirm received'))) return; const rl = $('#recvLoc', el.closest('.scrim') || document); await save('shipments', Object.assign({}, byId('shipments', s.id), { status: 'received', receivedAt: todayStr(), locationId: rl ? rl.value : (s.locationId || K.loc) })); refreshSheets(); scheduleRender(); toast('Items are now in stock'); };
async function saveRecv(el) { const sh = el.closest('.scrim'); for (const i of $$('[data-rv]', sh)) { const l = byId('lots', i.dataset.id); const v = Math.max(0, Math.floor(num(i.value))); if (num(l[i.dataset.rv]) !== v) await save('lots', Object.assign({}, byId('lots', l.id), { [i.dataset.rv]: v })); } }
A.shSaveRecv = async (el) => { await saveRecv(el); refreshSheets(); scheduleRender(); toast('Counts saved'); };
A.shRemoveLot = async (el) => { const l = byId('lots', el.dataset.id); if (K.C.lotX[l.id].sold > 0) return toast('Item already has sales', true); await unshipUnits(l, num(l.qty)); refreshSheets(); scheduleRender(); toast('Back to waiting to ship'); };
A.shAddItems = (el) => {
  const id = el.dataset.id; const free = K.raw.lots.filter((l) => K.C.lotX[l.id].stage === 'us');
  if (!free.length) return toast('Nothing is waiting to ship. Record what you bought abroad in Buy first.', true);
  const sx = byId('shipments', id);
  const sh = openSheet({ title: 'Add items to ' + ((sx && sx.name) || 'the shipment'), body: shipPickHTML(true), foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="afGo">Add to shipment</button>' });
  wireShipPick(sh);
  $('#afGo', sh).onclick = async () => {
    const pick = readShipPick(sh); if (pick === false) return; if (!pick.length) return toast('Choose at least one item', true);
    if (sx && stIdx(sx.status) >= 3 && !(await confirmLocalAdd(sx, pick))) return; // already in Cameroon: say what this does first
    for (const [lid, q] of pick) { const l = byId('lots', lid); if (l) await shipUnits(l, q, id); }
    closeSheet(); refreshSheets(); scheduleRender(); const units = pick.reduce((x, p) => x + p[1], 0);
    toast(fmt(units) + ' unit' + (units === 1 ? '' : 's') + ' added' + (sx && stIdx(sx.status) >= 5 ? ' — already in the warehouse, ready to sell' : ''));
  };
};
A.shCost = (el) => {
  const s = byId('shipments', el.dataset.s); const c = el.dataset.c ? (s.costs || []).find((x) => x.id === el.dataset.c) : { side: el.dataset.side, currency: el.dataset.side === 'CM' ? baseCode() : 'USD', appliesTo: 'all', date: todayStr() };
  const cats = KC.COST_CATEGORIES.filter((x) => x[0] === c.side).map((x) => x[1]); if (c.category && !cats.includes(c.category)) cats.push(c.category);
  const lots = K.raw.lots.filter((l) => l.shipmentId === s.id);
  const sh = openSheet({
    title: (c.id ? 'Edit ' : 'Add ') + (c.side === 'US' ? 'shipping cost' : 'receiving cost'),
    body: '<div class="col">' + field('Cost type', sel('category', cats, c.category || cats[0])) + field('Description', inp('label', c.label, 'placeholder="e.g. Houston port → Katy and back"')) + '<div class="grid2">' + field('Amount', inp('amount', c.amount, 'inputmode="decimal"')) + field('Currency', sel('currency', curOptions(), c.currency)) + field('Paid to', inp('paidTo', c.paidTo)) + field('Date', inp('date', c.date, 'type="date"')) + '</div>' +
      (!c.id && can('suppliers') ? '<div class="card pad"><label class="toggle"><input type="checkbox" name="unpaid" id="ccUnpaid">Not paid yet — add to bills to pay</label><div id="ccSup" class="hide mt">' + supplierSelect('') + '<div class="grid2 mt hide" id="newSup">' + field('New supplier name', inp('newSupplier', c.paidTo || '')) + field('Type', sel('newSupplierType', SUP_TYPES, c.side === 'CM' ? 'Clearing agent' : 'Trucker')) + '</div>' + field('Pay by', inp('billDue', KC.addDays(todayStr(), 14), 'type="date"'), 'mt') + '</div></div>' : '') +
      (!c.id ? '<div id="ccPay"><h3 class="mb">How it was paid</h3>' + payFields(c.amount || '', { kind: 'purchase', currency: c.currency }) + '</div>' : c.payment ? '<div class="alert info">Paid by ' + esc(c.payment.method) + (c.payment.ref ? ' · txn ' + esc(c.payment.ref) : '') + (num(c.payment.fee) > 0 ? ' · charges ' + money(c.payment.fee, c.currency) : '') + (c.txnId ? ' · cost txn ' + esc(c.txnId) : '') + '</div>' : '') +
      field('Charge this cost to', sel('appliesTo', [['all', 'All items in the shipment (by value)'], ['goods', 'Goods only (not vehicles)'], ['vehicles', 'Vehicles only']].concat(lots.map((l) => [l.id, 'Only: ' + ((byId('products', l.productId) || {}).name || '')])), c.appliesTo || 'all')) + '</div>',
    foot: (c.id ? '<button class="btn danger" id="cDel">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="cSave">Save cost</button>',
  });
  if ($('#ccPay', sh)) {
    // amount & date come from the cost itself; the payment block only asks mode, charges, txn ID
    $('#ccPay #payBox > .grid2', sh).classList.add('hide');
    setFieldLabel($('#ccPay [name=payAccount]', sh), 'MoMo number / account paid to');
    const mirror = () => { $('#payAmount', sh).value = $('[name=amount]', sh).value; setPayCurrency(sh, $('[name=currency]', sh).value); };
    $('[name=amount]', sh).addEventListener('input', mirror); $('[name=currency]', sh).addEventListener('change', mirror); mirror();
  }
  if ($('#ccUnpaid', sh)) { $('#ccUnpaid', sh).onchange = (e) => { $('#ccSup', sh).classList.toggle('hide', !e.target.checked); if ($('#ccPay', sh)) $('#ccPay', sh).classList.toggle('hide', e.target.checked); }; $('#ccSup [name=supplierId]', sh).onchange = (e) => $('#newSup', sh).classList.toggle('hide', e.target.value !== '__new'); }
  $('#cSave', sh).onclick = async () => { const v = formVals(sh); v.amount = num(v.amount); if (!v.amount) return toast('Enter an amount', true); const unpaid = v.unpaid; const bill = { supplierId: v.supplierId, newSupplier: v.newSupplier || v.paidTo, newSupplierType: v.newSupplierType, dueDate: v.billDue }; let pay = null; if (!c.id && !unpaid) { pay = readPayment(Object.assign({}, v, { payAmount: v.amount, payDate: v.date }), 'purchase'); if (pay === false) return; }
    ['unpaid', 'supplierId', 'newSupplier', 'newSupplierType', 'billDue', 'payAmount', 'payDate', 'payMethod', 'payFee', 'payAccount', 'payAccountOther', 'payRef'].forEach((k) => delete v[k]); const cur = byId('shipments', s.id); const cost = Object.assign({}, c, v, { id: c.id || uid('k_') });
    if (!cost.txnId) cost.txnId = KC.newTxnId('PU', cost.date); if (pay) { cost.payment = pay; if (!cost.paidTo && pay.account) cost.paidTo = pay.account; }
    if (unpaid) { if (!bill.supplierId || bill.supplierId === '__new') { if (!bill.newSupplier) return toast('Choose or name the supplier', true); bill.supplierId = '__new'; } const ok = await createBillFor(Object.assign(bill, { description: cost.category + (cost.label ? ' — ' + cost.label : '') + ' · ' + (cur.name || ''), amount: cost.amount, currency: cost.currency, date: cost.date, shipmentId: s.id, costId: cost.id, txnId: cost.txnId })); if (!ok) return; cost.billed = true; }
    const costs = (cur.costs || []).filter((x) => x.id !== c.id).concat([cost]); if (await save('shipments', Object.assign({}, cur, { costs }))) { closeSheet(); refreshSheets(); scheduleRender(); if (unpaid) toast('Cost added and bill created'); } };
  if (c.id) $('#cDel', sh).onclick = async () => { const cur = byId('shipments', s.id); await save('shipments', Object.assign({}, cur, { costs: cur.costs.filter((x) => x.id !== c.id) })); closeSheet(); refreshSheets(); scheduleRender(); };
};

/* ---------- packs (carton, box…): sold whole, stock kept in pieces ---------- */
function packFields(p) {
  const pk = (p.packs || []).slice(0, 3); while (pk.length < 2) pk.push({});
  const x = K.C.prodX[p.id] || {};
  return '<div class="card pad mt"><h3>Packs <span class="tiny muted">(optional)</span></h3><div class="tiny muted mb">Sell a whole carton or box at once. Stock stays counted in ' + esc(plural2(p.unit || 'piece')) + '. Leave the price empty to use the bulk price.</div>' +
    pk.map((k, i) => '<div class="pk-row">' + sel('pkName' + i, [['', '—']].concat(KC.PACK_NAMES.map((n) => [n, n[0].toUpperCase() + n.slice(1)])), k.name || '') +
      '<label class="pk-of"><span>of</span><input class="inp" name="pkSize' + i + '" inputmode="numeric" data-nofmt value="' + esc(k.size || '') + '" placeholder="24"></label>' +
      '<input class="inp" name="pkPrice' + i + '" inputmode="numeric" value="' + esc(k.price || '') + '" placeholder="' + (x.priceMax ? 'Auto' : 'Price') + '" aria-label="Pack price"></div>').join('') +
    (pk.length < 3 ? '<div class="tiny muted">Up to 3 pack sizes.</div>' : '') + '</div>';
}
const plural2 = (w) => /(s|x|ch|sh)$/.test(w) ? w + 'es' : w + 's';
function readPacks(sh) {
  const v = formVals(sh); const out = [];
  for (let i = 0; i < 3; i++) {
    const name = v['pkName' + i]; const size = Math.floor(num(v['pkSize' + i])); const price = v['pkPrice' + i] === '' || v['pkPrice' + i] === undefined ? null : num(v['pkPrice' + i]);
    if (!name && !size) continue;
    if (!name) return 'Choose the pack name (carton, box…)';
    if (!(size > 1)) return 'A ' + name + ' holds at least 2 pieces';
    if (out.some((o) => o.size === size)) return 'Two packs with the same size';
    out.push({ name, size, price: price > 0 ? price : null });
  }
  return out;
}

/* ---------- units & photos ---------- */
function unitFields(p) {
  return '<div class="grid2 mt">' + field('Sold by (unit)', sel('unit', KC.SELL_UNITS, p.unit || 'piece')) + field('Size / weight', '<div class="row gap6"><input class="inp" name="size" value="' + esc(p.size ?? '') + '" inputmode="decimal" placeholder="2.6" style="min-width:0;flex:1">' + sel('sizeUnit', [['', '—']].concat(Object.keys(KC.SIZE_UNITS)), p.sizeUnit || '', 'style="width:auto;flex:none"') + '</div>') + '</div><div class="tiny muted" data-conv style="margin-top:4px"></div>';
}
document.addEventListener('input', (e) => { if (e.target.name === 'size' || e.target.name === 'sizeUnit') convHint(e.target); });
document.addEventListener('change', (e) => { if (e.target.name === 'sizeUnit') convHint(e.target); });
function convHint(el) { const root = el.closest('.card,.sb') || document; const sz = $('[name=size]', root), su = $('[name=sizeUnit]', root), out = $('[data-conv]', root); if (sz && su && out) { const c = KC.convertSize(sz.value, su.value); out.textContent = c ? '= ' + c : ''; } }
A.pickPhoto = async (el) => {
  const f = await photoPicker(); if (!f) return;
  const sh = el.closest('.scrim'); sh._photo = f;
  el.innerHTML = '<img src="' + URL.createObjectURL(f) + '">';
};
A.quickPhoto = async (el) => {
  const f = await photoPicker(); if (!f) return;
  const p = byId('products', el.dataset.id); toast('Saving photo…');
  try { const ref = await storePhoto(f); await save('products', Object.assign({}, p, { image: ref })); scheduleRender(); toast('Photo saved'); } catch (e) { toast(e.message, true); }
};

const custOpts = () => [['', '— For stock (anyone can buy) —']].concat(K.raw.customers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.id, c.name + (c.phone ? ' · ' + c.phone : '')]));
const custName = (id) => (byId('customers', id) || {}).name || 'customer';

/* ---------- item history: purchases & sales ---------- */
const stats = (arr) => arr.length ? { min: Math.min(...arr), max: Math.max(...arr), avg: arr.reduce((a, b) => a + b, 0) / arr.length, last: arr[arr.length - 1] } : null;
A.itemHistory = (el) => {
  const p = byId('products', el.dataset.id); const x = K.C.prodX[p.id]; const c = seeCost();
  const lots = x.lotIds.map((id) => byId('lots', id)).filter(Boolean).sort((a, b) => (a.purchaseDate || '').localeCompare(b.purchaseDate || ''));
  const buys = lots.map((l) => ({ l, lx: K.C.lotX[l.id] }));
  const buyPrices = buys.map((b) => b.lx.unitX), landed = buys.map((b) => b.lx.landedUnit);
  const sales = []; visibleSales().forEach((s) => { const t = K.C.saleX[s.id]; if (t.status === 'cancelled') return; (s.lines || []).forEach((ln) => { if (ln.productId !== p.id) return; const rq = (ln.returns || []).reduce((a, r) => a + num(r.qty), 0); sales.push({ s, date: saleDate(s), qty: num(ln.qty) - rq, price: num(ln.unitPrice), customer: s.customerName, customerId: s.customerId || s.customerName }); }); });
  sales.sort((a, b) => a.date.localeCompare(b.date));
  const sp = stats(sales.map((r) => r.price)), bp = stats(buyPrices), lp = stats(landed);
  const byCust = {}; sales.forEach((r) => { const o = (byCust[r.customerId] = byCust[r.customerId] || { name: r.customer, times: 0, qty: 0, total: 0, last: '' }); o.times++; o.qty += r.qty; o.total += r.qty * r.price; if (r.date > o.last) o.last = r.date; });
  const byMonth = {}; sales.forEach((r) => { const m = r.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + r.qty; });
  const totalSoldQty = sales.reduce((a, r) => a + r.qty, 0), totalBought = lots.reduce((a, l) => a + num(l.qty), 0);
  const sb = (l, v) => '<div><div class="faint tiny">' + l + '</div><b class="money">' + v + '</b></div>';
  K._histRows = { Purchases: buys.map(({ l, lx }) => Object.assign({ Date: l.purchaseDate, Store: l.vendor, Source: l.sourceType, 'Order no': l.poNumber, Container: shipName(l.shipmentId), Qty: l.qty, 'For client': l.reservedFor ? custName(l.reservedFor) : '' }, c ? { ['Paid each (' + baseSym() + ')']: Math.round(lx.unitX), ['Landed each (' + baseSym() + ')']: Math.round(lx.landedUnit) } : {})), Sales: sales.map((r) => ({ Date: r.date, Receipt: r.s.no, Customer: r.customer, Qty: r.qty, ['Price (' + baseSym() + ')']: r.price })), Customers: Object.values(byCust).map((o) => ({ Customer: o.name, Times: o.times, Qty: o.qty, ['Total (' + baseSym() + ')']: Math.round(o.total), 'Last bought': o.last })) };
  K._histRows['Price changes'] = (p.priceHistory || []).slice().reverse().map((e) => Object.assign({ When: e.at, By: e.by, How: e.how, Reason: e.note || '', ['Selling before']: e.before.max, ['Selling after']: e.after.max, ['Lowest before']: e.before.min, ['Lowest after']: e.after.min, ['Wholesale before']: e.before.ws, ['Wholesale after']: e.after.ws }, c && e.cost != null ? { ['Landed cost then']: e.cost } : {}));
  const hs = openSheet({ title: p.name, wide: true, body:
    '<div class="row mb">' + thumb(p, 64, 14) + '<div><div class="b">' + esc(p.name) + '</div><div class="tiny muted">' + esc([p.category, p.subcategory, KC.sizeLabel(p)].filter(Boolean).join(' · ')) + '</div>' + (can('export') ? '<button class="btn sm mt" data-a="histXlsx" data-n="' + esc(p.name.replace(/\W+/g, '-')) + '">' + ic('dl', 'sm') + 'Excel</button>' : '') + '</div></div>' +
    priceHistoryCard(p) +
    '<div class="kpis mb">' + kpi('Times bought', fmt(lots.length), fmt(totalBought) + ' units total', true) + kpi('Times sold', fmt(sales.length), fmt(totalSoldQty) + ' units') + kpi('Customers', fmt(Object.keys(byCust).length)) + kpi('In stock', fmt(x.available), x.reserved ? x.reserved + ' held for clients' : '') + '</div>' +
    '<div class="card pad mb"><h3 class="mb">Selling prices</h3>' + (sp ? '<div class="grid4 small">' + sb('Lowest', F(sp.min)) + sb('Average', F(sp.avg)) + sb('Highest', F(sp.max)) + sb('Last', F(sp.last)) + '</div>' : '<div class="muted small">Not sold yet.</div>') +
    (c ? '<h3 class="mb mt">Buying prices (per unit)</h3>' + (bp ? '<div class="grid4 small">' + sb('Lowest paid', F(bp.min)) + sb('Average paid', F(bp.avg)) + sb('Highest paid', F(bp.max)) + sb('Last paid', F(bp.last)) + '</div><div class="grid4 small mt">' + sb('Lowest landed', F(lp.min)) + sb('Average landed', F(lp.avg)) + sb('Highest landed', F(lp.max)) + sb('Last landed', F(lp.last)) + '</div>' + (sp ? '<div class="alert info mt"><div>Average margin on this item: <b>' + pct((sp.avg - lp.avg) / sp.avg * 100) + '</b> (' + F(sp.avg - lp.avg) + ' per unit)</div></div>' : '') : '') : '') + '</div>' +
    '<div class="card mb"><div class="pad"><h3>Who buys it</h3></div><div class="tw"><table class="t"><thead><tr><th>Customer</th><th class="r">Times</th><th class="r">Units</th><th class="r">Total</th><th>Last</th></tr></thead><tbody>' + Object.values(byCust).sort((a, b) => b.qty - a.qty).map((o) => '<tr><td>' + esc(o.name) + '</td><td class="r">' + o.times + '</td><td class="r">' + fmt(o.qty) + '</td><td class="r money">' + fmt(o.total) + '</td><td class="nowrap">' + fmtDate(o.last) + '</td></tr>').join('') + '</tbody></table>' + (sales.length ? '' : '<div class="empty small">No sales yet.</div>') + '</div></div>' +
    (Object.keys(byMonth).length > 1 ? '<div class="card pad mb"><h3>Units sold per month</h3>' + vbars(Object.entries(byMonth).sort().slice(-12).map(([k, v]) => ({ key: k, qty: v })), (r) => MONTHS[+r.key.slice(5) - 1], 'qty') + '</div>' : '') +
    '<div class="card mb"><div class="pad"><h3>Purchase history</h3></div><div class="tw"><table class="t"><thead><tr><th>Date</th><th>Where</th><th>Container</th><th class="r">Qty</th>' + (c ? '<th class="r">Paid</th><th class="r">Landed</th>' : '') + '</tr></thead><tbody>' + buys.slice().reverse().map(({ l, lx }) => '<tr><td class="nowrap">' + fmtDate(l.purchaseDate) + '</td><td>' + esc(l.vendor || l.sourceType || '') + (l.reservedFor ? '<div class="tiny">for ' + esc(custName(l.reservedFor)) + '</div>' : '') + '</td><td>' + esc(shipName(l.shipmentId)) + '</td><td class="r">' + l.qty + '</td>' + (c ? '<td class="r money">' + money(l.unitCost, l.currency) + '</td><td class="r money">' + fmt(lx.landedUnit) + '</td>' : '') + '</tr>').join('') + '</tbody></table></div></div>' +
    '<div class="card mb"><div class="pad"><h3>Sales history</h3></div><div class="tw"><table class="t"><thead><tr><th>Date</th><th>Customer</th><th class="r">Qty</th><th class="r">Price</th></tr></thead><tbody>' + sales.slice().reverse().slice(0, 200).map((r) => '<tr><td class="nowrap">' + fmtDate(r.date) + '</td><td>' + esc(r.customer) + '</td><td class="r">' + r.qty + '</td><td class="r money">' + fmt(r.price) + '</td></tr>').join('') + '</tbody></table></div></div>' });
  hs._hist = p.id;
};
/* ---------- selling prices: every change is logged on the item (who, when, before → after) ---------- */
/** Return newP with a price-history entry when its selling prices differ from oldP's (kept to the last 200). */
function withPriceLog(oldP, newP, how, note) {
  const px = K.C.prodX[oldP.id] || {}; const cost = px.avgCost || 0;
  const b = KC.sellingPrices(oldP, cost, S()), a = KC.sellingPrices(newP, cost, S());
  if (b.max === a.max && b.min === a.min && b.ws === a.ws) return newP;
  const e = { at: new Date().toISOString(), by: K.me.name || K.info.userLabel || '', byId: K.me.id || '', how, note: note || '', before: { max: b.max, min: b.min, ws: b.ws }, after: { max: a.max, min: a.min, ws: a.ws }, cost: Math.round(cost) };
  return Object.assign({}, newP, { priceHistory: (oldP.priceHistory || []).concat([e]).slice(-200) });
}
/** One price cell: the new price on top; under it the old price and the change (or just the price when unchanged). */
const priceCell = (b, a) => {
  if (b === a) return '<span class="pc-v same">' + fmt(a) + '</span><span class="pc-s">no change</span>';
  const ch = b ? (a - b) / b * 100 : 0; const r = Math.abs(ch) >= 100 ? Math.round(Math.abs(ch)) : Math.round(Math.abs(ch) * 10) / 10;
  return '<span class="pc-v ' + (a > b ? 'up' : 'down') + '">' + fmt(a) + '</span><span class="pc-s">was ' + fmt(b) + '</span>' + (b ? '<span class="pc-d ' + (a > b ? 'up' : 'down') + '">' + (ch > 0 ? '+' : '−') + r + '%</span>' : '');
};
function priceHistoryCard(p) {
  const x = K.C.prodX[p.id]; const hist = (p.priceHistory || []).slice().reverse();
  const promos = (K.raw.promos || []).filter((pr) => KC.promoCovers(pr, p)).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  const chip = (l, v, cls) => '<div class="pchip' + (cls ? ' ' + cls : '') + '"><span>' + l + '</span><b>' + F(v) + '</b></div>';
  return '<section class="card mb ph-card"><div class="ph-head"><h3>Prices</h3><div class="row wrap gap6">' + (can('stockEdit') ? '<button class="btn sm pri" data-a="priceSet" data-id="' + p.id + '">' + ic('tag', 'sm') + 'Change price</button><button class="btn sm" data-a="promoFor" data-id="' + p.id + '">Launch a promotion</button>' : '') + '</div></div>' +
    '<div class="pchips">' + (x.promo ? chip('Promo price · ' + esc(x.promo.name), x.promo.price, 'promo') : '') + chip('Selling price', x.priceMax) + chip('Lowest allowed', x.priceMin) + chip('Wholesale', x.priceWholesale) + (seeCost() ? chip('Landed cost', x.avgCost, 'cost') : '') + '</div>' +
    '<div class="ph-sub">Price changes' + (hist.length ? ' <span class="hint">(' + hist.length + ')</span>' : '') + '</div>' +
    (hist.length ? '<div class="ph-tw"><table class="pch-t"><colgroup><col class="c-when"><col class="c-pr"><col class="c-pr"><col class="c-pr"><col class="c-by"><col class="c-how"></colgroup>' +
      '<thead><tr><th class="w-when">When</th><th class="r w-pr">Selling</th><th class="r w-pr">Lowest</th><th class="r w-pr">Wholesale</th><th class="w-by">Changed by</th><th class="w-how">How · reason</th></tr></thead><tbody>' +
      hist.map((e) => { const d = new Date(e.at); return '<tr>' +
        '<td><span class="pc-v">' + esc(fmtDate(e.at.slice(0, 10))) + '</span><span class="pc-s">' + (isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')) + '</span></td>' +
        '<td class="r">' + priceCell(e.before.max, e.after.max) + '</td><td class="r">' + priceCell(e.before.min, e.after.min) + '</td><td class="r">' + priceCell(e.before.ws, e.after.ws) + '</td>' +
        '<td><span class="pc-v ell" title="' + esc(e.by || '') + '">' + esc(e.by || '—') + '</span></td>' +
        '<td><span class="pc-v">' + esc(e.how || '—') + '</span>' + (e.note ? '<span class="pc-s wrap">' + esc(e.note) + '</span>' : '') + '</td></tr>'; }).join('') +
      '</tbody></table></div>'
      : '<div class="hint ph-empty">No price changes recorded yet. Changes made from now on appear here with who made them.</div>') +
    (promos.length ? '<div class="ph-sub">Promotions</div><div class="mini-list">' + promos.map((pr) => { const st = KC.promoStatus(pr); return '<div class="mini" data-a="promoOpen" data-id="' + pr.id + '" role="button" tabindex="0"><div class="grow"><div class="mini-t">' + esc(pr.name || 'Promotion') + '</div><div class="mini-d">' + esc(promoDesc(pr)) + ' · ' + esc(promoDates(pr)) + '</div></div><div class="right"><div class="mini-v">' + F(KC.promoPriceOf(pr, x.priceMax, S())) + '</div>' + promoBadge(st) + '</div></div>'; }).join('') + '</div>' : '') +
    '</section>';
}
A.priceSet = (el) => {
  const p = byId('products', el.dataset.id); const x = K.C.prodX[p.id];
  const sh = openSheet({ title: 'Change price · ' + p.name, body: '<div class="col">' +
    (seeCost() ? '<div class="hint">Landed cost: <b>' + F(x.avgCost) + '</b> per unit</div>' : '') +
    '<div class="grid3">' + field('Selling price (' + baseSym() + ')', inp('pmax', x.priceMax, 'inputmode="numeric" id="psMax"')) + field('Lowest allowed', inp('pmin', x.priceMin, 'inputmode="numeric"')) + field('Wholesale', inp('pws', x.priceWholesale, 'inputmode="numeric"')) + '</div>' +
    '<div class="hint" id="psMargin"></div>' +
    field('Reason <span class="hint">(optional)</span>', inp('note', '', 'placeholder="e.g. new stock cost more, market price, clearing old stock"')) + '</div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="psSave">Save price</button>' });
  const margin = () => { const m = $('#psMargin', sh); if (!m || !seeCost() || !x.avgCost) return; const v = num($('#psMax', sh).value); m.textContent = v ? 'Profit per unit: ' + F(v - x.avgCost) + ' (' + pct((v - x.avgCost) / x.avgCost * 100) + ' markup)' : ''; };
  $('#psMax', sh).addEventListener('input', margin); margin();
  setTimeout(() => { const i = $('#psMax', sh); i.focus(); i.select(); }, 60);
  $('#psSave', sh).onclick = async () => {
    const v = formVals(sh); const mx = num(v.pmax), mn = num(v.pmin), ws = num(v.pws);
    if (!(mx > 0)) return toast('Type the selling price', true);
    if (mn > mx) return toast('The lowest price cannot be above the selling price', true);
    if (ws > mx) return toast('The wholesale price cannot be above the selling price', true);
    const np = Object.assign({}, p, { priceMax: mx, priceMin: mn || null, priceWholesale: ws || null });
    const logged = withPriceLog(p, np, 'Price change', v.note);
    if (logged === np) { closeSheet(); return toast('No change'); }
    if (await save('products', logged)) { closeSheet(); scheduleRender(); reopenHistory(p.id); toast('Price saved · ' + F(mx)); }
  };
};
/** Redraw an open history modal for this item (prices changed). */
function reopenHistory(pid) { const h = K.sheets.find((s) => s._hist === pid); if (!h) return; const i = K.sheets.indexOf(h); while (K.sheets.length > i) closeSheet(); A.itemHistory({ dataset: { id: pid } }); }
A.histXlsx = (el) => xlsxDownload('History-' + el.dataset.n + '.xlsx', K._histRows);

/* ---------- transfers between branches (send → receive) ---------- */
const trBadge = (t) => t.status === 'cancelled' ? '<span class="badge">Cancelled</span>' : t.status === 'in_transit' ? '<span class="badge info">On the way</span>' : (t.lines || []).some((l) => l.receivedQty !== undefined && num(l.receivedQty) < num(l.qty)) ? '<span class="badge bad">Received short</span>' : '<span class="badge ok">Received</span>';
VIEWS.transfers = {
  render() {
    const L = allLocs();
    if (L.length < 2) return '<div class="card pad2"><h2>One branch</h2><p class="muted">Add your branches and warehouses in <a href="#settings">Settings → Branches & warehouses</a>, then move stock between them here.</p></div>';
    const list = K.raw.transfers.slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
    const waiting = list.filter((t) => t.status === 'in_transit' && t.to === K.loc);
    const row = (t) => { const n = (t.lines || []).reduce((a, l) => a + num(l.qty), 0); return '<div class="li" data-a="openTransfer" data-id="' + t.id + '"><div class="av' + (t.status === 'cancelled' ? ' ink' : '') + '">' + ic('ship', 'sm') + '</div><div class="grow"><div class="t">' + esc(locName(t.from)) + ' → ' + esc(locName(t.to)) + '</div><div class="tiny muted">' + fmtDate(t.date) + ' · ' + n + ' unit(s) · ' + esc(t.reason || '') + (t.by ? ' · ' + esc(t.by) : '') + '</div></div>' + trBadge(t) + '</div>'; };
    return '<div class="alert info mb">Stock leaves the sending branch when you tap <b>Send</b>, and arrives only when the receiving branch counts it and taps <b>Receive</b>. Anything missing is recorded as a loss.</div>' +
      (waiting.length ? '<h2 class="mb">Arriving at ' + esc(locName(K.loc)) + '</h2>' + trTable(waiting, 'trWaiting') : '') +
      (can('transfers') ? '<div class="row wrap mb"><button class="btn pri" data-a="newTransfer">' + ic('plus') + 'Send stock to a branch</button></div>' : '') +
      trTable(list, 'trList');
  },
};
A.newTransfer = () => {
  const L = myLocs().length > 1 || can('allLocations') ? allLocs() : allLocs(); const st = { from: K.loc, to: (L.find((l) => l.id !== K.loc) || {}).id, lines: [] };
  const sh = openSheet({ title: 'Send stock', wide: true, body: '', foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="trGo">' + ic('ship') + 'Send</button>' });
  const availAt = (pid, loc) => { const x = K.C.prodX[pid]; return x ? Math.max(0, x.byLoc[loc] || 0) : 0; };
  const fromOpts = can('allLocations') ? L : L.filter((l) => l.id === K.loc);
  const draw = (q) => {
    const prods = K.raw.products.filter((p) => availAt(p.id, st.from) > 0 && (!q || p.name.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60);
    setSheetBody(sh, '<div class="grid2 mb">' + field('From', sel('from', fromOpts.map((l) => [l.id, l.name]), st.from, 'id="trFrom"')) + field('To', sel('to', L.filter((l) => l.id !== st.from).map((l) => [l.id, l.name]), st.to, 'id="trTo"')) + field('Reason', sel('reason', KC.TRANSFER_REASONS, st.reason || KC.TRANSFER_REASONS[0], 'id="trReason"')) + field('Carried by (driver / staff)', inp('carrier', st.carrier || '', 'id="trCarrier"')) + '</div>' +
      (st.lines.length ? '<div class="card pad mb"><h3 class="mb">Sending</h3>' + st.lines.map((l, i) => '<div class="row between cl"><span>' + esc((byId('products', l.productId) || {}).name) + ' <span class="tiny faint">of ' + availAt(l.productId, st.from) + '</span></span><div class="row gap6"><input class="inp" style="width:80px" inputmode="numeric" value="' + l.qty + '" data-trq="' + i + '"><button class="icon-btn" data-trrm="' + i + '">' + ic('trash', 'sm') + '</button></div></div>').join('') + '</div>' : '') +
      '<div class="search mb">' + ic('search') + '<input class="inp" id="trQ" placeholder="Search item at ' + esc(locName(st.from)) + '" value="' + esc(q || '') + '"></div><div class="card list">' + (prods.map((p) => '<div class="li" data-tradd="' + p.id + '">' + thumb(p, 36, 9) + '<div class="grow t">' + esc(p.name) + '</div><span class="small muted">' + availAt(p.id, st.from) + ' here</span>' + ic('plus', 'sm') + '</div>').join('') || '<div class="empty small">No stock at this branch.</div>') + '</div>');
    $('#trFrom', sh).onchange = (e) => { st.from = e.target.value; st.lines = []; if (st.to === st.from) st.to = (L.find((l) => l.id !== st.from) || {}).id; draw(); };
    $('#trTo', sh).onchange = (e) => { st.to = e.target.value; };
    $('#trReason', sh).onchange = (e) => { st.reason = e.target.value; };
    $('#trCarrier', sh).oninput = (e) => { st.carrier = e.target.value; };
    $('#trQ', sh).oninput = (e) => { clearTimeout(sh._t); sh._t = setTimeout(() => { draw(e.target.value); const i = $('#trQ', sh); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    $$('[data-tradd]', sh).forEach((el) => (el.onclick = () => { const pid = el.dataset.tradd; const ex = st.lines.find((l) => l.productId === pid); if (ex) ex.qty = Math.min(ex.qty + 1, availAt(pid, st.from)); else st.lines.push({ productId: pid, qty: 1 }); draw($('#trQ', sh).value); }));
    $$('[data-trq]', sh).forEach((el) => (el.oninput = () => { const l = st.lines[+el.dataset.trq]; l.qty = Math.max(0, Math.min(Math.floor(num(el.value)), availAt(l.productId, st.from))); }));
    $$('[data-trrm]', sh).forEach((el) => (el.onclick = () => { st.lines.splice(+el.dataset.trrm, 1); draw($('#trQ', sh).value); }));
  };
  draw();
  $('#trGo', sh).onclick = async (e) => {
    if (!st.to || st.from === st.to) return toast('Choose two different branches', true);
    const lines = []; for (const l of st.lines.filter((x) => x.qty > 0)) { const alloc = KC.allocate(K.C, K.raw.lots, l.productId, l.qty, {}, null, st.from); if (!alloc) return toast('Not enough ' + (byId('products', l.productId) || {}).name + ' at ' + locName(st.from), true); lines.push({ productId: l.productId, qty: l.qty, alloc }); }
    if (!lines.length) return toast('Add items to send', true);
    e.target.disabled = true;
    const d = new Date();
    if (await save('transfers', { id: uid('t_'), no: 'T' + String(d.getFullYear()).slice(2) + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(), date: todayStr(), from: st.from, to: st.to, reason: st.reason || KC.TRANSFER_REASONS[0], carrier: st.carrier || '', lines, status: 'in_transit', by: K.me.name || '', byId: K.me.id || '', sentAt: d.toISOString() })) { closeSheet(); scheduleRender(); toast('Sent — ' + locName(st.to) + ' must receive it'); }
    e.target.disabled = false;
  };
};
A.openTransfer = (el) => {
  const t = byId('transfers', el.dataset.id);
  const canReceive = t.status === 'in_transit' && (can('transfers') || K.loc === t.to);
  const sh = openSheet({ title: (t.no ? t.no + ' · ' : '') + locName(t.from) + ' → ' + locName(t.to), body: '<div class="row between mb"><div class="tiny muted">' + fmtDate(t.date) + ' · sent by ' + esc(t.by || '—') + (t.carrier ? ' · carried by ' + esc(t.carrier) : '') + ' · ' + esc(t.reason || '') + (t.receivedBy ? '<br>Received by ' + esc(t.receivedBy) + ' ' + fmtDT(t.receivedAt) : '') + '</div>' + trBadge(t) + '</div>' +
    (canReceive ? '<div class="alert info mb">Count what actually arrived. Anything missing is recorded as a loss at ' + esc(locName(t.to)) + '.</div>' : '') +
    '<div class="card list">' + (t.lines || []).map((l, i) => { const p = byId('products', l.productId) || {}; return '<div class="li" style="cursor:default">' + thumb(p, 36, 9) + '<div class="grow"><div class="t">' + esc(p.name) + '</div><div class="tiny muted">Sent ' + l.qty + (l.receivedQty !== undefined ? ' · received ' + l.receivedQty : '') + '</div></div>' + (canReceive ? '<input class="inp" style="width:80px" inputmode="numeric" data-rq="' + i + '" value="' + l.qty + '">' : '<b>' + (l.receivedQty !== undefined ? l.receivedQty : l.qty) + '</b>') + '</div>'; }).join('') + '</div>' + (canReceive ? field('Note', inp('rnote', ''), 'mt') : ''),
    foot: (t.status === 'in_transit' && can('transfers') ? '<button class="btn danger" id="trCancel">Cancel</button>' : '') + (canReceive ? '<button class="btn pri grow" id="trRecv">' + ic('check') + 'Receive at ' + esc(locName(t.to)) + '</button>' : '') });
  if ($('#trCancel', sh)) $('#trCancel', sh).onclick = async () => { if (await confirmBox('Cancel this transfer? Stock goes back to ' + locName(t.from) + '.', 'Cancel transfer', true)) { await save('transfers', Object.assign({}, t, { status: 'cancelled' })); closeSheet(); scheduleRender(); } };
  if ($('#trRecv', sh)) $('#trRecv', sh).onclick = async (e) => {
    const cur = JSON.parse(JSON.stringify(byId('transfers', t.id))); let short = 0; const adjs = [];
    $$('[data-rq]', sh).forEach((inp_) => { const l = cur.lines[+inp_.dataset.rq]; const got = Math.max(0, Math.min(num(l.qty), Math.floor(num(inp_.value)))); l.receivedQty = got; let miss = num(l.qty) - got; short += miss;
      for (const a of l.alloc.slice().reverse()) { if (miss <= 0) break; const take = Math.min(miss, num(a.qty)); adjs.push({ lotId: a.lotId, productId: l.productId, qty: -take }); miss -= take; } });
    if (short > 0 && !(await confirmBox(short + ' unit(s) missing. They will be recorded as a loss (missing in transfer). Continue?', 'Receive'))) return;
    e.target.disabled = true;
    cur.status = 'received'; cur.receivedAt = new Date().toISOString(); cur.receivedBy = K.me.name || ''; cur.receivedById = K.me.id || ''; cur.receiveNote = formVals(sh).rnote || '';
    if (await save('transfers', cur)) {
      if (K.info.mode !== 'saas') for (const [ai, a] of adjs.entries()) await save('adjustments', { id: 'a_tr_' + t.id + '_' + ai, date: todayStr(), productId: a.productId, lotId: a.lotId, qty: a.qty, locationId: t.to, reason: 'Missing in transfer', notes: 'Transfer ' + (t.no || t.id) + ' from ' + locName(t.from) + (t.carrier ? ', carried by ' + t.carrier : ''), byId: K.me.id || '', by: K.me.name || '' });
      closeSheet(); scheduleRender(); toast(short ? 'Received — ' + short + ' missing recorded' : 'Received in full');
    }
    e.target.disabled = false;
  };
};

/* ---------- tables: containers, transfers ---------- */
function shipTable(ships, tid) {
  const X = (s) => K.C.shipX[s.id]; const cost = seeCost();
  const stLabel = (s) => (KC.SHIP_STATUSES.find((q) => q[0] === s.status) || [0, s.status || ''])[1];
  const pctSold = (s) => X(s).units ? X(s).unitsSold / X(s).units * 100 : 0;
  return dataTable({
    id: tid || 'shipList', rows: ships, noun: 'shipment', empty: '<div class="big">🚢</div>No shipments in progress. Tap <b>New shipment</b> when you start consolidating goods.',
    rowAttr: (s) => ' data-a="openShip" data-id="' + s.id + '"',
    cols: [
      { k: 'name', label: 'Shipment', core: true, v: (s) => s.name || 'Container', html: (s) => '<b>' + esc(s.name || 'Container') + '</b>' },
      { k: 'no', label: 'Container no.', core: true, v: (s) => s.containerNo || '', cls: 'mut' },
      { k: 'book', label: 'Booking no.', v: (s) => s.bookingNo || '', cls: 'mut' },
      { k: 'carrier', label: 'Carrier', v: (s) => s.carrier || '' },
      { k: 'origin', label: 'From', v: (s) => s.origin || '' },
      { k: 'dest', label: 'To', v: (s) => s.destination || '' },
      { k: 'status', label: 'Step', core: true, v: (s) => stIdx(s.status), html: (s) => '<span class="badge ' + (s.status === 'received' || s.status === 'closed' ? 'ok' : 'info') + '">' + esc(stLabel(s)) + '</span>' },
      { k: 'loaded', label: 'Loaded', v: (s) => s.loadedAt || '', html: (s) => dtDate(s.loadedAt) },
      { k: 'arrived', label: 'Arrived', v: (s) => s.arrivedAt || '', html: (s) => dtDate(s.arrivedAt) },
      { k: 'units', label: 'Units', core: true, num: true, v: (s) => X(s).units, total: (rows) => fmt(dtSum(rows, (s) => X(s).units)) },
      { k: 'goods', label: 'Goods', money: true, v: (s) => Math.round(X(s).goodsX) },
      { k: 'us', label: 'Shipping costs', core: true, money: true, v: (s) => Math.round(X(s).usX) },
      { k: 'cm', label: 'Receiving costs', money: true, v: (s) => Math.round(X(s).cmX) },
      { k: 'landed', label: 'Landed cost', core: true, money: true, cls: 'b', v: (s) => Math.round(X(s).landedX), total: (rows) => fmt(dtSum(rows, (s) => X(s).landedX)) },
      { k: 'rev', label: 'Revenue', money: true, v: (s) => Math.round(X(s).revenue), total: (rows) => fmt(dtSum(rows, (s) => X(s).revenue)) },
      cost ? { k: 'gp', label: 'Gross profit', money: true, v: (s) => Math.round(X(s).revenue - X(s).cogs) } : null,
      { k: 'loss', label: 'Losses', money: true, v: (s) => Math.round(X(s).lossX) || '' },
      { k: 'left', label: 'Stock left (cost)', money: true, v: (s) => Math.round(X(s).stockX) },
      { k: 'sold', label: 'Sold', core: true, num: true, v: (s) => Math.round(pctSold(s)), html: (s) => X(s).units ? '<span class="dt-pct"><i style="width:' + Math.min(100, pctSold(s)) + '%"></i></span>' + Math.round(pctSold(s)) + '%' : dtNil },
    ],
  });
}
function trTable(list, id) {
  const units = (t) => (t.lines || []).reduce((a, l) => a + num(l.qty), 0);
  const got = (t) => t.status === 'received' ? (t.lines || []).reduce((a, l) => a + num(l.receivedQty ?? l.qty), 0) : '';
  return dataTable({
    id, rows: list, noun: 'transfer', empty: 'No transfers yet.',
    rowAttr: (t) => ' data-a="openTransfer" data-id="' + t.id + '"', rowClass: (t) => t.status === 'cancelled' ? 'cx' : '',
    cols: [
      { k: 'date', label: 'Date', core: true, v: (t) => t.date, html: (t) => dtDate(t.date) },
      { k: 'from', label: 'From', core: true, v: (t) => locName(t.from), html: (t) => '<b>' + esc(locName(t.from)) + '</b>' },
      { k: 'to', label: 'To', core: true, v: (t) => locName(t.to), html: (t) => '<b>' + esc(locName(t.to)) + '</b>' },
      { k: 'items', label: 'Items', wrap: true, v: (t) => (t.lines || []).map((l) => ((byId('products', l.productId) || {}).name || l.name || '?') + ' ×' + l.qty).join(', ') },
      { k: 'units', label: 'Units', core: true, num: true, v: units, total: (rows) => fmt(dtSum(rows, units)) },
      { k: 'got', label: 'Received', num: true, v: got },
      { k: 'short', label: 'Short', num: true, v: (t) => got(t) === '' ? '' : (units(t) - got(t)) || '', html: (t) => got(t) !== '' && units(t) - got(t) > 0 ? '<span class="badge bad">' + (units(t) - got(t)) + ' missing</span>' : dtNil },
      { k: 'reason', label: 'Reason', core: true, v: (t) => t.reason || '' },
      { k: 'status', label: 'Status', core: true, v: (t) => t.status || '', html: (t) => trBadge(t) },
      { k: 'by', label: 'Sent by', core: true, v: (t) => t.by || '', cls: 'mut' },
      { k: 'rby', label: 'Received by', v: (t) => t.receivedBy || '', cls: 'mut' },
    ],
  });
}

/** The 7 steps of a shipment, grouped by phase (Ship · Receive · Sell). */
function shipSteps(i) {
  const ph = { ship: 'Ship', receive: 'Receive', sell: 'Sell' };
  return '<ol class="ssteps">' + KC.SHIP_STATUSES.map(([k, l], j) => '<li class="' + (j < i ? 'done' : j === i ? 'on' : '') + '"><span class="ss-p">' + (j === 0 || KC.shipPhase(KC.SHIP_STATUSES[j - 1][0]) !== KC.shipPhase(k) ? ph[KC.shipPhase(k)] : '') + '</span><span class="ss-d"></span><span class="ss-l">' + esc(l) + '</span></li>').join('') + '</ol>';
}

/* ---------- choosing what goes in a shipment: whole lines or part of them ---------- */
/** Items waiting to ship with a tick and a "units to ship" box each (all units by default). */
function shipPickHTML(inSheet) {
  const free = K.raw.lots.filter((l) => K.C.lotX[l.id].stage === 'us').sort((a, b) => (a.purchaseDate || '').localeCompare(b.purchaseDate || ''));
  if (!free.length) return '<div class="alert info">' + ic('buy', 'sm') + '<div>Nothing is waiting to ship yet. You can add items to this shipment later, once you record purchases made abroad.</div></div>';
  const units = free.reduce((a, l) => a + num(l.qty), 0);
  return '<div class="sp-box' + (inSheet ? ' bare' : '') + '"><div class="row between wrap"><b>' + (inSheet ? 'Waiting to ship' : 'What goes in this shipment') + '</b><label class="toggle"><input type="checkbox" id="spAll" checked> All · <span id="spSum">' + fmt(units) + ' of ' + fmt(units) + ' units</span></label></div>' +
    '<div class="sp-head"><span></span><span>Item</span><span class="r">Units to ship</span></div>' +
    '<div class="sp-list">' + free.map((l) => { const p = byId('products', l.productId) || {}; return '<label class="sp-it"><input type="checkbox" data-sp="' + l.id + '" checked><span class="grow">' + esc(p.name || '?') + '<span class="sub">' + esc([l.vendor, fmtDate(l.purchaseDate)].filter(Boolean).join(' · ')) + '</span></span>' +
      '<span class="sp-q"><input class="inp" inputmode="numeric" data-sq="' + l.id + '" data-max="' + num(l.qty) + '" value="' + num(l.qty) + '" aria-label="Units of ' + esc(p.name || '') + ' to ship"><span class="sp-of">of ' + fmt(l.qty) + '</span></span></label>'; }).join('') + '</div>' +
    '</div>';
}
function wireShipPick(sh) {
  const sum = () => { let n = 0, t = 0; $$('[data-sq]', sh).forEach((i) => { t += num(i.dataset.max); const c = $('[data-sp="' + i.dataset.sq + '"]', sh); if (c && c.checked) n += Math.min(num(i.dataset.max), Math.max(0, Math.floor(num(i.value)))); }); const e = $('#spSum', sh); if (e) e.textContent = fmt(n) + ' of ' + fmt(t) + ' units'; };
  const all = $('#spAll', sh); if (all) all.onchange = (e) => { $$('[data-sp]', sh).forEach((c) => (c.checked = e.target.checked)); sum(); };
  sh.addEventListener('input', (e) => { const i = e.target; if (!i.dataset || !i.dataset.sq) return; const c = $('[data-sp="' + i.dataset.sq + '"]', sh); const q = Math.floor(num(i.value)); if (c) c.checked = q > 0; sum(); });
  sh.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.sp) sum(); });
  // typing in the box should not toggle the tick (it sits inside the label)
  sh.addEventListener('click', (e) => { if (e.target.dataset && e.target.dataset.sq) e.preventDefault(); });
}
/** [[lotId, units]] for the ticked lines, or false when a quantity is wrong (message shown). */
function readShipPick(sh) {
  const out = [];
  for (const c of $$('[data-sp]', sh)) {
    if (!c.checked) continue; const i = $('[data-sq="' + c.dataset.sp + '"]', sh); const max = num(i.dataset.max); const q = Math.floor(num(i.value));
    const name = (byId('products', (byId('lots', c.dataset.sp) || {}).productId) || {}).name || 'an item';
    if (!(q > 0)) { toast('Type how many units of ' + name + ' to ship (or untick it)', true); i.focus(); return false; }
    if (q > max) { toast('Only ' + fmt(max) + ' units of ' + name + ' are waiting', true); i.focus(); return false; }
    out.push([c.dataset.sp, q]);
  }
  return out;
}
/* A purchase line can travel in parts: the units shipped become their own line (same purchase, price, tax and
 * receipt), the rest stays waiting. Totals, bills and landed costs stay the same because units × price is unchanged. */
const lotGroup = (l) => l.splitFrom || l.id;
const waitingSibling = (l) => K.raw.lots.find((x) => x.id !== l.id && lotGroup(x) === lotGroup(l) && (K.C.lotX[x.id] || {}).stage === 'us');
const waitOf = (l) => { const w = waitingSibling(l); return w ? num(w.qty) : 0; };
async function shipUnits(lot, qty, sid) {
  qty = Math.floor(qty); const total = num(lot.qty); if (qty <= 0) return;
  if (qty >= total) return save('lots', Object.assign({}, lot, { shipmentId: sid }));
  const part = Object.assign({}, lot, { id: uid('l_'), qty, shipmentId: sid, splitFrom: lotGroup(lot) }); delete part.createdAt; delete part.updatedAt;
  await save('lots', Object.assign({}, lot, { qty: total - qty }));
  await save('lots', part);
}
/** Take `qty` units of a shipped line back to "waiting to ship" (joins the waiting part of the same line). */
async function unshipUnits(lot, qty) {
  qty = Math.min(Math.floor(qty), num(lot.qty)); if (qty <= 0) return;
  const w = waitingSibling(lot);
  if (qty >= num(lot.qty)) {
    if (w && can('purchases')) { await save('lots', Object.assign({}, w, { qty: num(w.qty) + qty })); await remove('lots', lot.id); }
    else await save('lots', Object.assign({}, lot, { shipmentId: '' }));
    return;
  }
  await save('lots', Object.assign({}, lot, { qty: num(lot.qty) - qty }));
  if (w) await save('lots', Object.assign({}, w, { qty: num(w.qty) + qty }));
  else { const back = Object.assign({}, lot, { id: uid('l_'), qty, shipmentId: '', splitFrom: lotGroup(lot) }); delete back.createdAt; delete back.updatedAt; ['recvMissing', 'recvDamaged'].forEach((k) => delete back[k]); await save('lots', back); }
}
/** Change how many units of a line travel in its shipment (before it is unloaded). */
async function setShipQty(lot, n) {
  n = Math.max(0, Math.floor(n)); const cur = num(lot.qty); const x = K.C.lotX[lot.id] || {};
  if (n === cur) return;
  if (n < cur) { if (n < num(x.sold) + num(x.out || 0)) return toast('Some units are already sold to a client', true); return unshipUnits(lot, cur - n); }
  const w = waitingSibling(lot); const can_ = w ? num(w.qty) : 0; const add = Math.min(n - cur, can_);
  if (!add) return toast('No more units of this line are waiting to ship', true);
  if (add >= can_ && can('purchases')) { await save('lots', Object.assign({}, lot, { qty: cur + add })); await remove('lots', w.id); }
  else { await save('lots', Object.assign({}, w, { qty: can_ - add })); await save('lots', Object.assign({}, lot, { qty: cur + add })); }
  if (add < n - cur) toast('Only ' + fmt(add) + ' more were waiting', true);
}
document.addEventListener('change', async (e) => {
  const i = e.target; if (!i.dataset || !i.dataset.shq) return;
  const l = byId('lots', i.dataset.shq); if (!l) return;
  await setShipQty(l, num(i.value)); refreshSheets(); scheduleRender();
});

/** Adding to a shipment that already reached Cameroon: show what changes, then ask. Resolves true to go ahead. */
function confirmLocalAdd(sx, pick) {
  return new Promise((res) => {
    const inStock = stIdx(sx.status) >= 5; const loc = sx.locationId || 'main';
    const st = KC.SHIP_STATUSES[stIdx(sx.status)][1];
    const by = {}; pick.forEach(([lid, q]) => { const l = byId('lots', lid); if (!l) return; by[l.productId] = (by[l.productId] || 0) + q; });
    const units = Object.values(by).reduce((a, q) => a + q, 0);
    const rows = Object.entries(by).map(([pid, q]) => { const p = byId('products', pid) || {}; const x = K.C.prodX[pid] || {}; const now = Math.max(0, (x.byLoc || {})[loc] || 0);
      return '<tr><td>' + esc(p.name || '?') + '</td><td class="r b">+' + fmt(q) + '</td>' + (inStock ? '<td class="r">' + fmt(now) + '</td><td class="r b">' + fmt(now + q) + '</td>' : '') + '</tr>'; }).join('');
    const el = openSheet({
      title: inStock ? 'Add to the stock you already have?' : 'Add to a shipment already in Cameroon?',
      body: '<div class="lw">' +
        '<div class="lw-box' + (inStock ? ' strong' : '') + '">' + ic('alert') + '<div><b>' + esc(sx.name || 'This shipment') + '</b> is already <b>' + esc(st.toLowerCase()) + '</b>' + (allLocs().length > 1 && inStock ? ' at ' + esc(locName(loc)) : '') + '.<br>' +
          (inStock ? 'These ' + fmt(units) + ' unit' + (units === 1 ? '' : 's') + ' will be added to your stock in Cameroon straight away and can be sold at once.' : 'These ' + fmt(units) + ' unit' + (units === 1 ? '' : 's') + ' will be added to it and counted when you unload it.') + '</div></div>' +
        '<div class="lw-tw"><table class="lw-t"><thead><tr><th>Item</th><th class="r">Adding</th>' + (inStock ? '<th class="r">In stock now</th><th class="r">After</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="hint">Only do this if these goods really travelled in ' + esc(sx.name || 'this shipment') + '. Otherwise go back and start a new shipment.</p></div>',
      foot: '<button class="btn grow" id="lwNo">Go back</button><button class="btn pri grow" id="lwYes">' + ic('check', 'sm') + (inStock ? 'Yes, add ' + fmt(units) + ' to stock' : 'Yes, add ' + fmt(units) + ' units') + '</button>',
      onClose: () => res(false),
    });
    $('#lwNo', el).onclick = () => closeSheet();
    $('#lwYes', el).onclick = () => { el._onClose = null; closeSheet(); res(true); };
  });
}
