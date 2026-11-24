/* Aahsso — the 4-phase flow: Buy → Ship → Receive → Sell.
 * Every purchase starts in Buy, waits there until it is put in a shipment (Ship), is received in Cameroon
 * (customs, unloading, preparing — Receive) and then sold (Sell). Goods bought in Cameroon go straight to stock. */

const PHASES = [
  ['buy', 'Buy', 'buy'], ['ship', 'Ship', 'ship'], ['receive', 'Receive', 'check'], ['sell', 'Sell', 'sell'],
];
const shipsIn = (phase) => K.raw.shipments.filter((s) => KC.shipPhase(s.status) === phase);
const waitingLots = () => K.raw.lots.filter((l) => (K.C.lotX[l.id] || {}).stage === 'us');
function phaseNumbers() {
  const waitU = waitingLots().reduce((a, l) => a + num(l.qty), 0);
  const ship = shipsIn('ship'), rec = shipsIn('receive');
  const stockU = K.raw.products.reduce((a, p) => a + Math.max(0, (K.C.prodX[p.id] || {}).available || 0), 0);
  return {
    buy: waitU ? fmt(waitU) + ' unit' + (waitU === 1 ? '' : 's') + ' to ship' : 'Record purchases',
    ship: ship.length ? ship.length + ' shipment' + (ship.length === 1 ? '' : 's') + ' on the way' : 'Nothing on the way',
    receive: rec.length ? rec.length + ' to receive' : 'Nothing to receive',
    sell: fmt(stockU) + ' in stock',
  };
}
/** The flow strip: 1 Buy › 2 Ship › 3 Receive › 4 Sell, with what is waiting at each step. */
function phaseHead(cur, big) {
  const n = phaseNumbers(); const ci = PHASES.findIndex((p) => p[0] === cur);
  const items = PHASES.filter((p) => navOk(p[0]));
  if (items.length < 2) return '';
  return '<nav class="phases' + (big ? ' big' : '') + '" aria-label="Business flow">' + items.map((p) => {
    const i = PHASES.indexOf(p);
    return '<a class="ph' + (i === ci ? ' on' : '') + (ci >= 0 && i < ci ? ' done' : '') + '" href="#' + p[0] + '"' + (i === ci ? ' aria-current="page"' : '') + '><span class="ph-n">' + (items.indexOf(p) + 1) + '</span><span class="ph-t"><b>' + p[1] + '</b><span>' + esc(n[p[0]]) + '</span></span></a>';
  }).join('') + '</nav>';
}

/* ================= 1 · BUY ================= */
VIEWS.buy = {
  render() {
    const q = (K.ui.buyQ || '').toLowerCase(); const f = K.ui.buyF || 'all';
    const lots = K.raw.lots.filter((l) => f === 'all' || K.C.lotX[l.id].stage === f);
    let groups = purchaseGroups(lots);
    if (q) groups = groups.filter((g) => (g.vendor + ' ' + g.po + ' ' + g.txnId + ' ' + g.source + ' ' + (g.first.vendorPhone || '') + ' ' + g.lots.map((l) => ((byId('products', l.productId) || {}).name || '') + ' ' + (l.lotNumber || '')).join(' ') + ' ' + (g.bill ? (g.bill.payments || []).map((p) => p.ref || '').join(' ') : '')).toLowerCase().includes(q));
    K._buyGroups = groups;
    const m = monthStr(); const mLots = K.raw.lots.filter((l) => (l.purchaseDate || '').slice(0, 7) === m);
    const spent = mLots.reduce((a, l) => a + K.C.lotX[l.id].paidX * num(l.qty), 0), tax = mLots.reduce((a, l) => a + K.C.lotX[l.id].taxX * num(l.qty), 0);
    const owed = purchaseGroups(K.raw.lots).reduce((a, g) => a + (g.bx && g.bill.status !== 'cancelled' ? Math.max(0, g.bx.balanceX) : 0), 0);
    const wait = waitingLots(); const waitU = wait.reduce((a, l) => a + num(l.qty), 0);
    if (isStore()) { // Aahsso Store: what you bought, what you owe, and the list — nothing to ship
      const nMonth = purchaseGroups(mLots).length;
      return '<div class="kpis mb2">' + kpi('Bought this month', F(spent), nMonth + ' purchase' + (nMonth === 1 ? '' : 's') + (tax ? ' · tax ' + fmt(tax) : '')) + kpi('Owed to suppliers', F(owed), 'unpaid or part paid') + '</div>' +
        '<div class="toolbar mb"><button class="btn pri" data-a="newPurchase">' + ic('plus') + 'New purchase</button>' + (K.info && K.info.receiptScan && has('receiptScan') ? '<button class="btn" data-a="scanPurchase">' + ic('cam') + 'Scan a receipt</button>' : '') + (typeof isResto === 'function' && isResto() ? '<button class="btn" data-a="buyDrinks">' + ic('glass') + 'Buy drinks</button>' + (typeof hasStation === 'function' && hasStation('kitchen') ? '<button class="btn" data-a="buyIngredients">' + ic('chef') + 'Buy ingredients</button>' : '') : '') +
          '<div class="search grow">' + ic('search') + '<input class="inp" placeholder="Search supplier, item, receipt or txn ID" value="' + esc(K.ui.buyQ || '') + '" data-c="buyQ"></div>' +
          (can('export') ? '<button class="btn ghost" data-a="exportPurch" title="Download as Excel">' + ic('dl') + 'Excel</button>' : '') + '</div>' +
        purchaseTable(groups);
    }
    return '' +
      '<div class="kpis mb2">' + kpi('Bought this month', F(spent), 'tax included') + kpi('Tax this month', F(tax), spent ? pct(tax / Math.max(1, spent - tax) * 100) + ' on average' : '') + kpi('Owed to sellers', F(owed), 'unpaid or part paid') +
        '<div class="card kpi"><div class="l">Waiting to ship</div><div class="v">' + fmt(waitU) + ' <span class="hint">units</span></div><div class="s">' + (waitU && can('containers') ? '<a href="#ship">Put them in a shipment →</a>' : 'bought, not shipped yet') + '</div></div></div>' +
      '<div class="toolbar mb"><button class="btn pri" data-a="newPurchase">' + ic('plus') + 'New purchase</button>' + (K.info && K.info.receiptScan && has('receiptScan') ? '<button class="btn" data-a="scanPurchase">' + ic('cam') + 'Scan a receipt</button>' : '') +
        '<div class="search grow">' + ic('search') + '<input class="inp" placeholder="Search seller, item, receipt or txn ID" value="' + esc(K.ui.buyQ || '') + '" data-c="buyQ"></div>' +
        (can('export') ? '<button class="btn ghost" data-a="exportPurch" title="Download as Excel">' + ic('dl') + 'Excel</button>' : '') + '</div>' +
      '<div class="chips mb">' + [['all', 'All'], ['us', 'Waiting to ship'], ['transit', 'Shipping'], ['warehouse', 'In stock']].map(([k, l]) => '<button class="chip' + (f === k ? ' on' : '') + '" data-a="buyF" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      purchaseTable(groups);
  },
};

/* ----- New purchase: seller, items (with tax shared over them), payment ----- */
const defCat = () => (catOpts().includes('Food & Snacks') ? 'Food & Snacks' : catOpts()[0] || 'Other');
const puRow = (o) => Object.assign({ brand: '', model: '', taxPct: '', check: '', hint: '', dk: '', perCase: 0, packName: '', unitName: '', name: '', category: defCat(), subcategory: '', qty: '1', unitCost: '', weight: '', condition: 'New', working: 'Working', regularPrice: '', packOf: '1', expiry: '', barcode: '', reservedFor: '', notes: '', unit: '', size: null, sizeUnit: '', photo: null, open: false }, o || {});
const SELLER_SUP_TYPE = { Store: 'Store / wholesaler', Online: 'Store / wholesaler', Auction: 'Auction (B-Stock…)', 'Local (Cameroon)': 'Store / wholesaler' };
A.newPurchase = () => purchaseForm();

/* ----- Bar & Resto: buying drinks. Picked from the Cameroon drinks list (or typed), beer, soft drinks, water… are bought
   by the crate or case: "3 crates of 12" → 36 bottles in stock, at the crate price ÷ 12 each. Any row can switch to bottles. ----- */
const CASE_CATS = ['Beer', 'Cider & RTD', 'Soft Drinks', 'Malt Drinks', 'Water', 'Energy Drinks', 'Juices'];
const plural3 = (w, n) => (n === 1 ? w : /(s|x|ch|sh)$/.test(w) ? w + 'es' : w + 's');
/** a purchase row becomes a catalog drink: how it is packed, and bought by the crate when that is the custom */
/** a catalog item by its code: a drink (from the drinks list) or an ingredient (ING-…) */
const catItem = (sku) => (/^ING-/.test(sku || '') ? Ingredients.bySku(sku) : typeof Drinks !== 'undefined' ? Drinks.bySku(sku) : null);
function puDrink(r, d, keepBy) {
  if (/^ING-/.test(d.sku)) { // an ingredient: counted by its unit (kg, bunch, cube…); eggs bought by the tray
    Object.assign(r, { dk: d.sku, perCase: d.pack ? d.pack.size : 0, packName: d.pack ? d.pack.name : '', unitName: d.unit, unit: d.unit, category: d.cat, subcategory: '' });
    if (!keepBy) r.packOf = d.pack && d.pack.default ? String(d.pack.size) : '1';
    r.hint = ''; return r;
  }
  Object.assign(r, { dk: d.sku, perCase: d.perCase > 1 ? d.perCase : 0, packName: d.returnable ? 'crate' : 'case', unitName: d.pack === 'Can' ? 'can' : d.pack === 'Carton' ? 'carton' : 'bottle', category: d.cat, subcategory: d.sub || '' });
  if (!keepBy) r.packOf = r.perCase && CASE_CATS.includes(d.cat) ? String(r.perCase) : '1';
  r.hint = d.cost && seeCost() ? '≈ ' + fmt(d.cost * Math.max(1, num(r.packOf))) : '';
  return r;
}
A.buyDrinks = () => Drinks.picker({
  title: 'Buy drinks', many: true, prices: ['none'],
  note: (d) => { const n = Drinks.inStock(d); return n ? n + ' in stock' : Drinks.productOf(d) ? 'Out of stock' : ''; },
  action: (n) => (n ? 'Buy ' + n + ' drink' + (n === 1 ? '' : 's') : 'Choose drinks'),
  onOwn: (q) => setTimeout(() => purchaseForm({ rows: [{ name: q }] }), 0),
  onPick: (list) => { setTimeout(() => purchaseForm({ rows: list.map((d) => puDrink(puRow({ name: d.name, qty: '' }), d)) }), 0); },
});
/** Bar & Resto kitchens: buy what you cook with, from the Cameroon ingredients list (anything missing: type it) */
A.buyIngredients = () => Ingredients.picker({
  title: 'Buy ingredients', many: true,
  note: (d) => { const n = Ingredients.inStock(d); return n ? fmt(n) + ' ' + d.unit + ' in stock' : Ingredients.productOf(d) ? 'Out of stock' : ''; },
  action: (n) => (n ? 'Buy ' + n + ' ingredient' + (n === 1 ? '' : 's') : 'Choose ingredients'),
  onOwn: (q) => setTimeout(() => purchaseForm({ rows: [{ name: q, unit: 'kg' }] }), 0),
  onPick: (list) => { setTimeout(() => purchaseForm({ rows: list.map((d) => puDrink(puRow({ name: d.name, qty: '' }), d)) }), 0); },
});
/** from the menu ("Buy it first"): the picker over the menu closes, Buy drinks opens */
A.dkBuy = () => { closeSheet(); setTimeout(A.buyDrinks, 0); };
/** a row bought by the crate ↔ by the bottle: quantity and price follow, the total stays the same */
A.puBy = (el) => {
  const sh = puSheet(el); const r = sh._rows[+el.dataset.i]; const pc = r.perCase; if (!pc) return;
  const toPack = el.dataset.v === 'pack'; if (toPack === num(r.packOf) > 1) return;
  const q = num(r.qty), c = r.unitCost === '' ? '' : num(r.unitCost);
  if (toPack) { r.packOf = String(pc); r.qty = q && q % pc === 0 ? String(q / pc) : q ? String(Math.ceil(q / pc)) : r.qty; if (c !== '') r.unitCost = String(Math.round(c * pc)); }
  else { r.packOf = '1'; r.qty = q ? String(q * pc) : r.qty; if (c !== '') r.unitCost = String(Math.round(c / pc * 100) / 100); }
  const d = catItem(r.dk); if (d) puDrink(r, d, true); sh._draw();
};
/* Where it was bought decides the money: abroad = US dollars, in Cameroon = local currency (FCFA). */
const PU_WHERE = {
  abroad: { cur: () => 'USD', methods: ['Cash', 'Credit card', 'Bank transfer', 'Zelle / US bank', 'Other'] },
  local: { cur: () => baseCode(), methods: ['Cash', 'MTN MoMo', 'Orange Money', 'Credit card', 'Bank transfer'] },
};
/** Sellers you bought from before (newest first), plus the usual US stores; the ones that fit "where" come first. */
function puSellers(where) {
  const m = new Map();
  K.raw.lots.slice().sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || '')).forEach((l) => {
    const n = (l.vendor || '').trim(); if (!n || m.has(n.toLowerCase())) return;
    m.set(n.toLowerCase(), { name: n, type: l.sourceType || '', phone: l.vendorPhone || '', local: l.sourceType === 'Local (Cameroon)' || !!l.inWarehouse || (l.currency || 'USD') === baseCode() });
  });
  if (isStore()) K.raw.suppliers.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((s) => { const k = supKey(s.name); if (k && !m.has(k)) m.set(k, { name: s.name.trim(), type: 'Local (Cameroon)', phone: s.phone || '', local: true }); });
  (S().vendors || []).forEach((n) => { if (!m.has(n.toLowerCase())) m.set(n.toLowerCase(), { name: n, type: /b-?stock/i.test(n) ? 'Auction' : 'Store', phone: '', local: false }); });
  const all = [...m.values()]; const fits = (v) => (where === 'local') === v.local;
  return all.filter(fits).concat(all.filter((v) => !fits(v)));
}
function purchaseForm(pre) {
  const names = [...new Set(K.raw.products.map((p) => p.name))];
  // Bar & Resto: drinks from the catalog are suggested too (added to the list once it has loaded)
  if (typeof isResto === 'function' && isResto()) Drinks.load().catch(() => {}); // the drinks list, for the item suggestions
  const usd = num((S().fxRates || {}).USD) || num(S().fxRate) || 0;
  const whereCard = (w, flag, title, sub) => '<button type="button" class="pu-wc' + (w === 'abroad' ? ' on' : '') + '" data-a="puWhere" data-v="' + w + '" aria-pressed="' + (w === 'abroad') + '"><span class="pu-flag" aria-hidden="true">' + flag + '</span><span><b>' + title + '</b><span>' + sub + '</span></span></button>';
  const st = isStore(); const who = st ? 'supplier' : 'seller'; const Who = st ? 'Supplier' : 'Seller'; // Aahsso Store: bought locally, in your money, straight to stock
  const sh = openSheet({
    title: 'New purchase', wide: true,
    body: '' +
      // where & seller
      '<section class="pu-sec" id="puHead">' +
        (st ? '' : '<div class="pu-where2" role="group" aria-label="Where did you buy?">' + whereCard('abroad', '🇺🇸', 'Bought abroad', 'Prices in US dollars ($)') + whereCard('local', '🇨🇲', 'Bought in Cameroon', 'Prices in ' + esc(baseSym()) + ' · goes straight to stock') + '</div>') +
        '<input type="hidden" name="where" value="abroad"><input type="hidden" name="currency" id="puCur" value="USD">' +
        '<div class="pu-rate hint' + (st ? ' hide' : '') + '" id="puRate">' + (usd ? '1 $ = ' + fmt(usd) + ' ' + esc(baseSym()) + ' · <a href="#settings">change rate</a>' : 'Set the dollar rate in <a href="#settings">Settings</a> to see totals in ' + esc(baseSym())) + '</div>' +
        '<div class="pu-seller' + (st ? ' pu-st' : '') + '">' + field(Who, '<select class="inp" name="vendorPick" id="puSeller"></select>') + (st ? '<input type="hidden" name="sourceType" id="puSrc" value="Local (Cameroon)">' : field('Bought from', sel('sourceType', KC.SOURCE_TYPES, 'Store', 'id="puSrc"'))) + field('Date', inp('purchaseDate', todayStr(), 'type="date"')) + '</div>' +
        '<div class="pu-newsel hide" id="puNewSel"><div class="grid2">' + field('New ' + who + ' name', inp('vendor', '', 'placeholder="' + (st ? 'e.g. Mama Ngono, Santa Lucia Akwa' : 'e.g. Mama Ngono, Costco Houston') + '" autocomplete="off"')) + field(Who + ' phone', inp('vendorPhone', '', 'inputmode="tel" placeholder="Optional"')) + '</div></div>' +
        '<details class="pu-extra"><summary>More details <span class="hint">receipt no., pick-up</span></summary><div class="grid2 mt">' +
          field('Receipt / order no.', inp('poNumber', '', 'placeholder="Optional"')) + field('Collected from the ' + who + '?', sel('puCollected', [['yes', 'Yes, we have the goods'], ['no', 'No — pick up later']], 'yes')) + '</div></details></section>' +
      // items
      '<section class="pu-sec"><div class="pu-h2"><h3 class="pu-t3">Items</h3><div class="row gap6">' + (K.info && K.info.receiptScan && has('receiptScan') ? '<button type="button" class="btn sm" data-a="puScan">' + ic('cam', 'sm') + 'Scan receipt</button>' : '') + '<button type="button" class="btn sm ghost" data-a="puImport">' + ic('up', 'sm') + 'Import Excel</button><button type="button" class="btn sm ghost" data-a="tplPurch">' + ic('dl', 'sm') + 'Template</button></div></div>' +
        '<div class="pu-tw"><table class="t pu-t2"><thead><tr><th>Item</th><th class="r">Qty</th>' + (st ? '' : '<th class="r">Weight each</th>') + '<th class="r" id="puPriceH">Price each</th><th class="r">Total</th><th></th></tr></thead><tbody id="puRows"></tbody></table></div>' +
        '<div class="pu-under"><div class="col" style="gap:10px"><button type="button" class="btn sm" data-a="puAdd" style="align-self:flex-start">' + ic('plus', 'sm') + 'Add item</button><span class="hint">Tip: press Enter in the price to add the next item.</span>' +
          '<div id="puSpread" class="hide"><div class="hint mb">Paid one price for the items without a price?</div><div class="row gap6"><input class="inp" id="puLot" inputmode="decimal" placeholder="Total paid" style="width:140px"><button type="button" class="btn sm" data-a="puSpread">Spread it</button></div></div></div>' +
          '<div class="pu-tot"><div class="row between"><span>Items</span><span class="money" id="puSub"></span></div>' +
            '<div class="row between pu-taxrow"><span class="row gap6"><span>Tax</span><input class="inp" id="puTax" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="Tax"><span class="seg sm" id="puTaxMode"><button type="button"' + (st ? '' : ' class="on"') + ' data-a="puTaxMode" data-v="pct">%</button><button type="button"' + (st ? ' class="on"' : '') + ' data-a="puTaxMode" data-v="amt" id="puTaxCur">$</button></span></span><span class="money" id="puTaxV"></span></div>' +
            '<div class="row between hide"><span>Total weight</span><span id="puWt"></span></div><div class="row between pu-grand"><b>Total</b><b class="money" id="puGrand"></b></div><div class="pu-local hint" id="puLocal"></div><div class="hint" id="puTaxHint"></div></div></div></section>' +
      // payment
      '<section class="pu-sec"><h3 class="pu-t3">Payment</h3>' +
        '<div class="seg mb" id="puPaidSeg"><button type="button" class="on" data-a="puPaid" data-v="paid">Paid in full</button><button type="button" data-a="puPaid" data-v="part">Part paid</button>' + (can('suppliers') ? '<button type="button" data-a="puPaid" data-v="credit">Not paid yet</button>' : '') + '</div>' +
        '<div id="puPayBy" class="hide" style="max-width:260px">' + field('Pay the rest by', inp('payBy', KC.addDays(todayStr(), 14), 'type="date"')) + '</div>' +
        '<div id="puPay"></div></section>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="puSave">Review purchase</button>',
  });
  sh._rows = pre && pre.rows && pre.rows.length ? pre.rows.map((r) => puRow(r)) : [puRow()]; sh._taxMode = st ? 'amt' : 'pct'; sh._paid = 'paid'; sh._where = 'abroad';
  const cur = () => $('#puCur', sh).value;
  const lineVal = (r) => num(r.qty) * num(r.unitCost);
  const lineTax = () => sh._rows.some((r) => r.taxPct !== '' && r.taxPct !== undefined); // each line its own rate (from an imported receipt)
  sh._lineTax = lineTax;
  const sums = () => {
    const sub = sh._rows.reduce((a, r) => a + lineVal(r), 0);
    if (lineTax()) { const shares = sh._rows.map((r) => Math.round(lineVal(r) * num(r.taxPct)) / 100); const tax = Math.round(shares.reduce((a, x) => a + x, 0) * 100) / 100; return { sub, tax, total: Math.round((sub + tax) * 100) / 100, shares }; }
    const tv = num($('#puTax', sh).value);
    const tax = sh._taxMode === 'pct' ? Math.round(sub * tv) / 100 : tv;
    return { sub, tax, total: Math.round((sub + tax) * 100) / 100, shares: KC.allocTax(sh._rows.map((r) => ({ unitCost: num(r.unitCost), qty: num(r.qty) })), tax) };
  };
  const m = (v) => money(v, cur());
  const totals = () => {
    const s = sums();
    const fx0 = cur() === baseCode() ? 1 : KC.rateOf(S(), cur());
    $$('#puRows tr[data-r]', sh).forEach((tr) => { const i = +tr.dataset.r, r = sh._rows[i]; const uo = $('[data-out=units]', tr); if (uo) { const n = Math.floor(num(r.qty)) * Math.max(1, Math.floor(num(r.packOf) || 1)); uo.textContent = num(r.packOf) > 1 && n ? fmt(num(r.qty)) + ' ' + plural3(r.packName, num(r.qty)) + ' = ' + fmt(n) + ' ' + plural3(r.unitName, n) + ' in stock' : r.perCase && n ? fmt(n) + ' ' + plural3(r.unitName, n) + ' (not crates)' : ''; } $('[data-out=total]', tr).textContent = lineVal(r) ? m(lineVal(r)) : '—'; $('[data-out=tax]', tr).textContent = s.shares[i] ? '+ ' + m(s.shares[i]) + ' tax' : ''; const cb = $('#puRows tr[data-c="' + i + '"] [data-out=cost]', sh); if (cb) cb.innerHTML = puCostHTML(r, s.shares[i] || 0, cur(), fx0); });
    const wt = sh._rows.reduce((a, r) => a + num(r.qty) * num(r.weight), 0); const we = $('#puWt', sh); if (we) { we.textContent = wt ? fmtKg(wt) : '—'; we.parentNode.classList.toggle('hide', !wt); }
    const rate = s.sub ? s.tax / s.sub * 100 : 0;
    $('#puSub', sh).textContent = m(s.sub); $('#puTaxV', sh).textContent = m(s.tax); $('#puGrand', sh).textContent = m(s.total);
    const fx = cur() === baseCode() ? 1 : KC.rateOf(S(), cur());
    $('#puLocal', sh).textContent = cur() !== baseCode() && s.total && fx ? '≈ ' + F(s.total * fx) : '';
    const lt = lineTax(); $('#puTax', sh).classList.toggle('hide', lt); $('#puTaxMode', sh).classList.toggle('hide', lt);
    $('#puTaxHint', sh).textContent = lt ? 'Tax set on each line (from the file) · change it under ⋯' : s.tax && s.sub ? (sh._taxMode === 'pct' ? '' : (Math.round(rate * 100) / 100) + '% · ') + 'shared over the items by value' : '';
    $('#puPriceH', sh).textContent = 'Price each (' + curSym(cur()) + ')'; $('#puTaxCur', sh).textContent = curSym(cur());
    $$('#puRows [data-unit]', sh).forEach((u) => (u.textContent = u.dataset.per || curSym(cur()))); // a crate / bottle row: "/crate" (the money is in the column title)
    $('#puSpread', sh).classList.toggle('hide', !(sh._rows.length > 1 && sh._rows.some((r) => r.name && r.unitCost === '')));
    const short = matchMedia('(max-width: 600px)').matches;
    $('#puSave', sh).textContent = s.total ? (short ? 'Review · ' : 'Review purchase · ') + m(s.total) : 'Review purchase';
    const pa = $('#payAmount', sh); if (pa) { pa.dataset.def = s.total; pa.placeholder = s.total ? fmt(s.total) : 'Total of the receipt'; if (sh._paid === 'paid') pa.value = ''; syncPayCharges(sh); }
  };
  const rs = typeof isResto === 'function' && isResto(); // Bar & Resto: drinks — no condition, working, shelf price or client
  const byPack = (r) => !!r.perCase && num(r.packOf) > 1;
  const byHtml = (r, i) => !r.perCase ? '' : '<div class="pu-by ' + (byPack(r) ? 'is-pk' : 'is-un') + '"><div class="seg sm" role="group" aria-label="Bought by"><button type="button"' + (byPack(r) ? ' class="on"' : '') + ' data-a="puBy" data-i="' + i + '" data-v="pack" aria-pressed="' + byPack(r) + '">' + esc(r.packName[0].toUpperCase() + r.packName.slice(1)) + 's of ' + r.perCase + '</button><button type="button"' + (byPack(r) ? '' : ' class="on"') + ' data-a="puBy" data-i="' + i + '" data-v="unit" aria-pressed="' + !byPack(r) + '">' + esc(r.unitName[0].toUpperCase() + r.unitName.slice(1)) + 's</button></div><span class="pu-units" data-out="units"></span></div>';
  const qtyL = (r) => (r.perCase ? (byPack(r) ? r.packName[0].toUpperCase() + r.packName.slice(1) + 's' : r.unitName[0].toUpperCase() + r.unitName.slice(1) + 's') : r.unitName ? 'Qty (' + r.unitName + ')' : 'Qty');
  const priceL = (r) => (r.perCase ? 'Price per ' + (byPack(r) ? r.packName : r.unitName) : r.unitName ? 'Price per ' + r.unitName : 'Price each');
  // crates / bottles: the coloured toggle, "3 crates = 36 bottles in stock" and "/crate" on the price say it (no tag in the narrow quantity box)
  const unitTag = (r) => (!r.perCase && r.unitName && !/^(bottle|can|carton)$/.test(r.unitName) ? '<span class="pu-u">' + esc(r.unitName) + '</span>' : ''); // kg, bunch, cube…
  const perTag = (r) => (r.perCase ? '/' + (byPack(r) ? r.packName : r.unitName) : '');
  const rowHtml = (r, i) => '<tr data-r="' + i + '"><td><input class="inp" data-f="name" value="' + esc(r.name) + '" placeholder="' + (typeof isResto === 'function' && isResto() ? 'Search a drink or item' : 'Item name') + '" autocomplete="off" autocapitalize="words" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-label="Item">' + byHtml(r, i) +
      (r.brand || r.model ? '<div class="pu-bm">' + esc([r.brand, r.model].filter(Boolean).join(' · ')) + '</div>' : '') +
      (r.check ? '<div class="pu-check" title="' + esc(r.check) + '">⚠ Check: ' + esc([...new Set((r.check.match(/\[([^\]]+)\]/g) || []).map((x) => x.slice(1, -1)))].join(', ') || 'see notes') + '</div>' : '') + '</td>' +
    '<td data-l="' + qtyL(r) + '"><div class="pu-qw' + (unitTag(r) ? ' has-u' : '') + '"><input class="inp r" data-f="qty" inputmode="decimal" value="' + esc(r.qty) + '" placeholder="' + (r.perCase || r.unitName ? '0' : '') + '" aria-label="' + qtyL(r) + '">' + unitTag(r) + '</div></td>' +
    (st ? '' : '<td data-l="Weight each"><div class="in-unit"><input class="inp r" data-f="weight" inputmode="decimal" value="' + esc(r.weight) + '" placeholder="0" aria-label="Weight of one item in kg"><span>kg</span></div></td>') +
    '<td data-l="' + priceL(r) + '"><div class="in-unit"><input class="inp r" data-f="unitCost" inputmode="decimal" value="' + esc(r.unitCost) + '" placeholder="' + esc(r.hint || '0') + '" aria-label="' + priceL(r) + '"><span data-unit data-per="' + esc(perTag(r)) + '">' + esc(perTag(r) || curSym(cur())) + '</span></div></td>' +
    '<td class="r pu-ltot" data-l="Total"><b class="money" data-out="total">—</b><span class="pu-tx" data-out="tax"></span></td>' +
    '<td class="nowrap r"><button type="button" class="icon-btn' + (r.open ? ' on' : '') + '" data-a="puMore" data-i="' + i + '" title="Category, condition, expiry, barcode, photo…" aria-label="Item details">' + ic('more', 'sm') + '</button><button type="button" class="icon-btn" data-a="puRm" data-i="' + i + '" aria-label="Remove item">' + ic('x', 'sm') + '</button></td></tr>' +
    '<tr class="pu-cost" data-c="' + i + '"><td colspan="' + (st ? 5 : 6) + '"><div class="pu-cb" data-out="cost"></div></td></tr>' +
    (r.open ? '<tr class="pu-more" data-m="' + i + '"><td colspan="' + (st ? 5 : 6) + '"><div class="grid4">' +
      field('Brand', '<input class="inp" data-f="brand" value="' + esc(r.brand || '') + '" placeholder="e.g. Samsung, Nutella" autocomplete="off">') + field('Model', '<input class="inp" data-f="model" value="' + esc(r.model || '') + '" placeholder="e.g. Galaxy A15, UN55" autocomplete="off">') +
      (lineTax() ? field('Tax %', '<input class="inp" data-f="taxPct" inputmode="decimal" value="' + esc(r.taxPct) + '" placeholder="0">') : '') +
      field('Category', sel('cat_' + i, catOpts().includes(r.category) || !r.category ? catOpts() : [r.category].concat(catOpts()), r.category, 'data-f="category"')) + (rs ? '' : field('Condition', sel('cond_' + i, KC.CONDITIONS, r.condition, 'data-f="condition"'))) + (st ? '' : field('Working?', sel('work_' + i, KC.WORKING, r.working, 'data-f="working"'))) +
      (r.perCase ? '' : field('Pack of', '<input class="inp" data-f="packOf" inputmode="numeric" value="' + esc(r.packOf) + '" title="Units you will sell for each one bought">')) +
      (rs ? '' : field('Shelf price each', '<input class="inp" data-f="regularPrice" inputmode="decimal" value="' + esc(r.regularPrice) + '" placeholder="Optional">')) + field('Expiry date', '<input class="inp" type="date" data-f="expiry" value="' + esc(r.expiry) + '">') + field('Barcode', '<input class="inp" data-f="barcode" value="' + esc(r.barcode) + '" placeholder="Optional">') +
      (rs ? '' : field('Bought for a client?', sel('res_' + i, custOpts(), r.reservedFor, 'data-f="reservedFor"'))) +
      '</div><div class="row mt wrap"><button type="button" class="btn sm" data-a="puPhoto" data-i="' + i + '">' + ic('cam', 'sm') + (r.photo ? 'Change photo' : 'Add photo') + '</button>' + (r.photo ? '<img class="pu-ph" src="' + URL.createObjectURL(r.photo) + '" alt="">' : '') + '<input class="inp grow" data-f="notes" value="' + esc(r.notes) + '" placeholder="Notes (optional)" aria-label="Notes"></div></td></tr>' : '');
  sh._draw = () => { $('#puRows', sh).innerHTML = sh._rows.map(rowHtml).join(''); totals(); };
  // seller dropdown: sellers used before + "+ New seller"
  const drawSellers = (keep) => {
    const list = puSellers(sh._where); const s = $('#puSeller', sh); const v = keep !== undefined ? keep : s.value;
    s.innerHTML = '<option value="">Choose a ' + who + '…</option>' + list.filter((x) => !st || x.local).map((x) => '<option value="' + esc(x.name) + '">' + esc(x.name) + (!st && x.type && x.type !== 'Store' ? ' · ' + esc(x.type) : '') + '</option>').join('') + '<option value="__new">+ New ' + who + '…</option>';
    s.value = list.some((x) => x.name === v) || v === '__new' ? v : '';
  };
  sh._sellers = () => drawSellers();
  $('#puSeller', sh).addEventListener('change', (e) => {
    const v = e.target.value; $('#puNewSel', sh).classList.toggle('hide', v !== '__new');
    if (v === '__new') { $('[name=vendor]', sh).focus(); return; }
    const x = puSellers(sh._where).find((y) => y.name === v); if (!x) return;
    $('[name=vendor]', sh).value = ''; $('[name=vendorPhone]', sh).value = x.phone || '';
    if (st) return;
    if (x.type && KC.SOURCE_TYPES.includes(x.type)) $('#puSrc', sh).value = x.type;
    if (x.local !== (sh._where === 'local')) sh._setWhere(x.local ? 'local' : 'abroad');
  });
  // payment block follows where it was bought (mobile money only in Cameroon)
  const drawPay = () => {
    $('#puPay', sh).innerHTML = payFields('', { kind: 'purchase', currency: cur(), methods: PU_WHERE[sh._where].methods });
    $('#payBox > .grid2', sh).classList.toggle('hide', sh._paid !== 'part');
    setPayCurrency(sh, cur());
  };
  sh._setWhere = (w) => {
    if (st) w = 'local'; // a store only buys locally
    if (!PU_WHERE[w]) return; sh._where = w;
    $('[name=where]', sh).value = w; $$('.pu-wc', sh).forEach((b) => { b.classList.toggle('on', b.dataset.v === w); b.setAttribute('aria-pressed', String(b.dataset.v === w)); });
    $('#puCur', sh).value = PU_WHERE[w].cur(); $('#puRate', sh).classList.toggle('hide', w === 'local');
    if (w === 'local' && ['Store', 'Online', 'Auction'].includes($('#puSrc', sh).value) && !$('#puSeller', sh).value) $('#puSrc', sh).value = 'Local (Cameroon)';
    if (w === 'abroad' && $('#puSrc', sh).value === 'Local (Cameroon)') $('#puSrc', sh).value = 'Store';
    drawSellers(); drawPay(); totals();
  };
  sh._draw();
  const onField = (e) => {
    const f = e.target.dataset && e.target.dataset.f; if (!f) return; const tr = e.target.closest('tr[data-r],tr[data-m]'); if (!tr) return;
    const i = +(tr.dataset.r ?? tr.dataset.m); const r = sh._rows[i]; r[f] = e.target.value;
    if (f === 'name' && e.type === 'change') { // a known item: bring back its category, condition and size
      const p = K.raw.products.find((x) => x.name.toLowerCase() === r.name.trim().toLowerCase());
      if (p) { r.category = p.category || r.category; r.subcategory = p.subcategory || ''; r.condition = p.condition || 'New'; r.unit = p.unit || ''; r.size = p.size ?? null; r.sizeUnit = p.sizeUnit || ''; if (!r.brand) r.brand = p.brand || ''; if (!r.model) r.model = p.model || ''; }
      const d = typeof isResto === 'function' && isResto() ? (Drinks.ready() && Drinks.byName(r.name)) || (hasStation('kitchen') && Ingredients.byName(r.name)) || null : null;
      if (d && r.dk !== d.sku) { puDrink(r, d); sh._draw(); return; }
      if (!d && r.dk) { Object.assign(r, { dk: '', perCase: 0, packName: '', unitName: '', packOf: '1', hint: '' }); sh._draw(); return; }
    }
    totals();
  };
  sh.addEventListener('input', onField); sh.addEventListener('change', onField);
  itemSuggest(sh);
  sh.addEventListener('keydown', (e) => { // Enter in a price → next item
    if (e.defaultPrevented || e.key !== 'Enter' || !e.target.matches || !e.target.matches('[data-f=unitCost],[data-f=qty]')) return;
    e.preventDefault(); const i = +e.target.closest('tr').dataset.r;
    if (i === sh._rows.length - 1) { sh._rows.push(puRow()); sh._draw(); }
    const ins = $$('#puRows [data-f=name]', sh); if (ins[i + 1]) ins[i + 1].focus();
  });
  $('#puTax', sh).addEventListener('input', totals);
  $('#puSrc', sh).addEventListener('change', (e) => { if (e.target.value === 'Local (Cameroon)') sh._setWhere('local'); });
  $('#puCur', sh).addEventListener('change', () => { setPayCurrency(sh, cur()); totals(); });
  sh._setWhere(st ? 'local' : 'abroad');
  sh._sums = sums;
  $('#puSave', sh).onclick = async () => {
    const h = formVals($('#puHead', sh)); const pv = formVals($('#puPay', sh).parentNode); pv.payStatus = sh._paid === 'credit' ? 'credit' : 'paid';
    h.vendor = h.vendorPick && h.vendorPick !== '__new' ? h.vendorPick : (h.vendor || '').trim(); delete h.vendorPick;
    if (!h.vendor) { toast('Choose the ' + who + ' (or add a new one)', true); $('#puSeller', sh).focus(); return; }
    if (sh._paid === 'paid') { pv.payAmount = ''; pv.payDate = h.purchaseDate; }
    if (sh._paid === 'part' && !(num(pv.payAmount) > 0)) { toast('Type how much you paid', true); const a = $('#payAmount', sh); if (a) a.focus(); return; }
    const rows = sh._rows.filter((r) => r.name.trim() || num(r.unitCost));
    if (!rows.length) { toast('Add at least one item', true); const n = $('[data-f=name]', sh); if (n) n.focus(); return; }
    const bad = rows.findIndex((r) => !r.name.trim() || !(num(r.qty) > 0) || r.unitCost === '');
    if (bad >= 0) { const r = rows[bad]; toast(!r.name.trim() ? 'Item ' + (bad + 1) + ': type the item name' : !(num(r.qty) > 0) ? r.name + ': quantity must be more than 0' : r.name + ': enter the price (0 if free)', true); return; }
    // bought by the crate: one line to be sure it is crates, not bottles (3 crates of 12 = 36 bottles)
    const crates = rows.filter((r) => r.perCase && num(r.packOf) > 1);
    if (crates.length) {
      const one = (r) => fmt(num(r.qty)) + ' ' + plural3(r.packName, num(r.qty)) + ' of ' + num(r.packOf) + ' (' + fmt(num(r.qty) * num(r.packOf)) + ' ' + plural3(r.unitName, num(r.qty) * num(r.packOf)) + ')' + (crates.length > 1 ? '' : ' of ' + r.name);
      const msg = crates.length === 1 ? 'You are buying ' + one(crates[0]) + '.' : 'You are buying by the crate: ' + crates.map((r) => r.name + ' — ' + one(r)).join('; ') + '.';
      if (!(await confirmBox(msg, 'Yes, ' + (crates.length === 1 ? plural3(crates[0].packName, 2) : 'crates') + ' — continue'))) return;
    }
    const s = sums();
    if (s.tax < 0) return toast('Tax cannot be negative', true);
    const shares = lineTax() ? rows.map((r) => Math.round(num(r.qty) * num(r.unitCost) * num(r.taxPct)) / 100) : KC.allocTax(rows.map((r) => ({ unitCost: num(r.unitCost), qty: num(r.qty) })), s.tax);
    const lines = rows.map((r, i) => {
      const pack = Math.max(1, Math.floor(num(r.packOf) || 1)); const qty = Math.floor(num(r.qty)) * pack;
      return { name: r.name.trim(), brand: String(r.brand || '').trim(), model: String(r.model || '').trim(), category: r.category, subcategory: r.subcategory || subOpts(r.category)[0] || '', condition: r.condition, working: r.working, unit: r.unit, size: r.size, sizeUnit: r.sizeUnit,
        regularPrice: num(r.regularPrice) ? num(r.regularPrice) / pack : null, unitCost: num(r.unitCost) / pack, unitTax: qty ? shares[i] / qty : 0, qty, weightKg: num(r.weight) ? num(r.weight) / pack : null, boughtQty: Math.floor(num(r.qty)), weightEach: num(r.weight) || 0, pack, packName: pack > 1 ? r.packName || '' : '', unitName: r.unitName || '',
        expiry: r.expiry, barcode: r.barcode, reservedFor: r.reservedFor || '', notes: [r.notes, pack > 1 ? 'Bought ' + Math.floor(num(r.qty)) + ' ' + (r.packName ? plural3(r.packName, Math.floor(num(r.qty))) : 'pack(s)') + ' of ' + pack : ''].filter(Boolean).join(' · '), photo: r.photo };
    });
    const credit = pv.payStatus === 'credit';
    let pay = null;
    if (!credit) { // check the payment before saving anything, so a missing MoMo txn ID never leaves a half-saved purchase
      if (String(pv.payAmount || '').trim() === '') pv.payAmount = s.total;
      pay = readPayment(pv, 'purchase'); if (pay === false) return;
    }
    const go = async () => {
    Object.assign(h, { shipmentId: h.where === 'local' ? '__local' : '', purchaseTxnId: KC.newTxnId('PU', h.purchaseDate) });
    await savePurchaseLines(h, lines);
    if (credit || pay) {
      await createBillFor({ txnId: h.purchaseTxnId, payment: pay, supplierId: (K.raw.suppliers.find((x) => x.name.toLowerCase() === (h.vendor || '').toLowerCase()) || {}).id, newSupplier: h.vendor || h.sourceType || 'Seller', newSupplierType: SELLER_SUP_TYPE[h.sourceType] || 'Other', description: 'Purchase ' + (h.poNumber ? '#' + h.poNumber + ' ' : '') + fmtDate(h.purchaseDate) + (s.tax ? ' (tax ' + money(s.tax, h.currency) + ')' : ''), amount: s.total, currency: h.currency || 'USD', date: h.purchaseDate, dueDate: sh._paid === 'paid' ? h.purchaseDate : pv.payBy });
    }
    while (K.sheets.length && K.sheets[K.sheets.length - 1] !== sh) closeSheet(); closeSheet(); scheduleRender();
    if (K._puQueue && K._puQueue.length) { const next = K._puQueue.shift(); const left = K._puQueue.length; setTimeout(() => { const s2 = purchaseForm(); puFill(s2, next, 'Next receipt: ' + receiptLabel(next) + (left ? ' (' + left + ' more after this)' : ' (the last one)') + ' · '); }, 400); }
    toast(lines.length + ' item' + (lines.length === 1 ? '' : 's') + ' saved' + (h.where === 'local' ? (st ? ' · in stock' : ' · in stock now') : ' · waiting to ship') + (credit ? ' · bill created' : pay && pay.amount < s.total - 0.005 ? ' · part paid, rest added to bills' : ''));
    };
    puPreview({ h, lines, s, pay, credit, paid: sh._paid, payBy: pv.payBy, sellerType: h.sourceType }, go);
  };
  setTimeout(() => { const v = $('#puSeller', sh); if (v && matchMedia('(min-width: 900px)').matches) v.focus(); }, 60);
  return sh;
}
const puSheet = (el) => el.closest('.scrim');
A.puWhere = (el) => puSheet(el)._setWhere(el.dataset.v);
A.puPaid = (el) => {
  const sh = puSheet(el); const v = el.dataset.v; sh._paid = v; $$('#puPaidSeg button', sh).forEach((b) => b.classList.toggle('on', b === el));
  $('#puPay', sh).classList.toggle('hide', v === 'credit'); $('#puPayBy', sh).classList.toggle('hide', v !== 'part' && v !== 'credit');
  $('#payBox > .grid2', sh).classList.toggle('hide', v !== 'part');
  const a = $('#payAmount', sh); if (a) { a.value = ''; if (v === 'part') a.focus(); } syncPayCharges(sh);
};
/* ----- item suggestions under the name of a purchase line: your stock first, then (Bar & Resto) the drinks list ----- */
function itemSuggest(sh) {
  const pop = document.createElement('div'); pop.className = 'ac-pop'; pop.setAttribute('role', 'listbox'); pop.hidden = true; sh.appendChild(pop); // inside the window: closes with it
  let inp = null, opts = [], hi = -1;
  const N = (s) => (typeof Drinks !== 'undefined' ? Drinks.norm(s) : String(s || '').toLowerCase());
  const left = (p) => Math.max(0, Math.floor((K.C.prodX[p.id] || {}).available || 0));
  function build(q) {
    const words = N(q).split(' ').filter(Boolean); const hit = (t) => words.every((w) => t.includes(w));
    const mine = K.raw.products.filter((p) => !p.archived && hit(N(p.name + ' ' + (p.category || '')))).sort((a, b) => (left(b) > 0) - (left(a) > 0) || a.name.localeCompare(b.name)).slice(0, words.length ? 6 : 8)
      .map((p) => ({ name: p.name, sub: [p.category, p.subcategory].filter(Boolean).join(' · '), right: left(p) ? left(p) + ' in stock' : 'none in stock', mine: true }));
    const have = new Set(K.raw.products.map((p) => N(p.name)));
    const cat = typeof isResto === 'function' && isResto() && Drinks.ready() && words.length ? Drinks.find(q).filter((d) => !have.has(d._n)).slice(0, 8)
      .map((d) => ({ name: d.name, sub: Drinks.metaLine(d), right: d.perCase > 1 ? (d.returnable ? 'crate' : 'case') + ' of ' + d.perCase : '' })) : [];
    const ing = typeof isResto === 'function' && isResto() && hasStation('kitchen') && words.length ? Ingredients.find(q).filter((d) => !have.has(d._n)).slice(0, 8).map((d) => ({ name: d.name, sub: d.cat, right: 'by the ' + d.unit })) : [];
    const out = [];
    if (mine.length) out.push({ head: 'In your stock' }, ...mine);
    if (ing.length) out.push({ head: 'Ingredients list' }, ...ing);
    if (cat.length) out.push({ head: 'Drinks list' }, ...cat);
    const exact = words.length && [...mine, ...ing, ...cat].some((o) => N(o.name) === N(q));
    if (words.length && !exact) out.push({ own: true, name: q.trim() });
    if (!words.length && typeof isResto === 'function' && isResto()) out.push({ tip: 'Type to search ' + (Drinks.ready() ? Drinks.ready().items.length + ' drinks' : 'the drinks list') + ' — e.g. Castel, 33 Export, Hennessy' });
    return out;
  }
  function place() {
    if (!inp || pop.hidden) return; const r = inp.getBoundingClientRect(); const vh = window.innerHeight; const below = vh - r.bottom; const up = below < 260 && r.top > below;
    Object.assign(pop.style, { left: Math.max(8, r.left) + 'px', width: Math.min(Math.max(r.width, 300), window.innerWidth - 16) + 'px', top: up ? '' : r.bottom + 4 + 'px', bottom: up ? vh - r.top + 4 + 'px' : '', maxHeight: Math.max(160, Math.min(380, (up ? r.top : below) - 16)) + 'px' });
  }
  function draw() {
    opts = build(inp.value); const pick = opts.filter((o) => o.name !== undefined);
    if (!pick.length && !opts.some((o) => o.tip)) return close();
    hi = Math.min(hi, pick.length - 1);
    let k = -1;
    pop.innerHTML = opts.map((o) => {
      if (o.head) return '<div class="ac-h">' + esc(o.head) + '</div>';
      if (o.tip) return '<div class="ac-tip">' + esc(o.tip) + '</div>';
      k++; const on = k === hi;
      if (o.own) return '<div class="ac-o ac-own' + (on ? ' on' : '') + '" role="option" data-k="' + k + '" aria-selected="' + on + '">' + ic('plus', 'sm') + '<span>Add “<b>' + esc(o.name) + '</b>” as a new item</span></div>';
      return '<div class="ac-o' + (on ? ' on' : '') + '" role="option" data-k="' + k + '" aria-selected="' + on + '"><div class="ac-m"><div class="ac-n">' + esc(o.name) + '</div>' + (o.sub ? '<div class="ac-s">' + esc(o.sub) + '</div>' : '') + '</div>' + (o.right ? '<span class="ac-r' + (o.mine && /none/.test(o.right) ? ' out' : '') + '">' + esc(o.right) + '</span>' : '') + '</div>';
    }).join('');
    pop.hidden = false; inp.setAttribute('aria-expanded', 'true'); place();
    const cur = pop.querySelector('.ac-o.on'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function close() { pop.hidden = true; hi = -1; if (inp) inp.setAttribute('aria-expanded', 'false'); }
  function choose(k) {
    const o = opts.filter((x) => x.name !== undefined)[k]; if (!o || !inp) return close();
    const tr = inp.closest('tr[data-r]'); const i = tr ? +tr.dataset.r : -1; close();
    inp.value = o.name; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
    if (i >= 0) setTimeout(() => { const q = sh.querySelectorAll('#puRows tr[data-r]')[i]; const f = q && q.querySelector('[data-f=qty]'); if (f) { f.focus(); f.select && f.select(); } }, 30); // next: how many
  }
  const open = (el) => { inp = el; hi = -1; draw(); };
  sh._suggest = open; // Add item opens it on the new line
  sh.addEventListener('focusin', (e) => { if (e.target.matches && e.target.matches('#puRows [data-f=name]')) open(e.target); });
  sh.addEventListener('click', (e) => { if (e.target.matches && e.target.matches('#puRows [data-f=name]') && pop.hidden) open(e.target); }); // tapped again after closing
  sh.addEventListener('input', (e) => { if (e.target === inp) { hi = 0; draw(); } });
  sh.addEventListener('focusout', (e) => { if (e.target === inp) setTimeout(() => { if (document.activeElement !== inp) close(); }, 120); });
  sh.addEventListener('keydown', (e) => {
    if (e.target !== inp || pop.hidden) return; const n = opts.filter((o) => o.name !== undefined).length;
    if (e.key === 'ArrowDown') { e.preventDefault(); hi = (hi + 1) % n; draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hi = (hi - 1 + n) % n; draw(); }
    else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); choose(hi); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
  }, true);
  pop.addEventListener('pointerdown', (e) => { e.preventDefault(); const o = e.target.closest('.ac-o'); if (o) choose(+o.dataset.k); }); // keeps the focus in the field
  $('.sb', sh).addEventListener('scroll', place, { passive: true }); window.addEventListener('resize', place);
}
A.puAdd = (el) => { const sh = puSheet(el); sh._rows.push(puRow()); sh._draw(); const ins = $$('[data-f=name]', sh); const n = ins[ins.length - 1]; n.focus(); if (sh._suggest) sh._suggest(n); };
A.puRm = (el) => { const sh = puSheet(el); sh._rows.splice(+el.dataset.i, 1); if (!sh._rows.length) sh._rows.push(puRow()); sh._draw(); };
A.puMore = (el) => { const sh = puSheet(el); const r = sh._rows[+el.dataset.i]; r.open = !r.open; sh._draw(); };
A.puPhoto = async (el) => { const sh = puSheet(el); const f = await photoPicker(); if (!f) return; sh._rows[+el.dataset.i].photo = f; sh._draw(); };
A.puTaxMode = (el) => {
  const sh = puSheet(el); if (sh._taxMode === el.dataset.v) return;
  const before = sh._sums(); sh._taxMode = el.dataset.v; $$('#puTaxMode button', sh).forEach((b) => b.classList.toggle('on', b === el));
  const t = $('#puTax', sh); // keep the same tax when switching: 10 % ↔ its amount
  if (before.tax) t.value = el.dataset.v === 'pct' ? String(Math.round(before.tax / Math.max(1e-9, before.sub) * 10000) / 100) : String(Math.round(before.tax * 100) / 100);
  t.placeholder = el.dataset.v === 'pct' ? '0' : '0.00'; t.dispatchEvent(new Event('input', { bubbles: true }));
};
A.puSpread = (el) => {
  const sh = puSheet(el); const total = num($('#puLot', sh).value); if (!(total > 0)) return toast('Type the total paid', true);
  const rows = sh._rows.filter((r) => r.name && r.unitCost === ''); const w = (r) => (num(r.regularPrice) || 1) * Math.max(1, num(r.qty));
  const base = rows.reduce((a, r) => a + w(r), 0);
  rows.forEach((r) => { r.unitCost = String(Math.round(total * w(r) / base / Math.max(1, num(r.qty)) * 100) / 100); });
  $('#puLot', sh).value = ''; sh._draw(); toast('Spread over ' + rows.length + ' item' + (rows.length === 1 ? '' : 's') + (rows.some((r) => num(r.regularPrice)) ? ' by shelf price' : ''));
};
/* Import an Excel list (store receipt, B-Stock manifest…) into the open purchase */
function parsePurchaseRows(rows) {
  const lines = rows.map((r) => ({
    purchaseDate: xlDate(pickCol(r, ['Date', 'Purchase Date'])), sourceType: String(pickCol(r, ['Source', 'Bought From'])), vendor: String(pickCol(r, ['Store', 'Vendor', 'Seller'])), poNumber: String(pickCol(r, ['Order No', 'Receipt', 'PO', 'Order'])),
    name: String(pickCol(r, ['Description', 'Item Description', 'Product Name', 'Title', 'Item', 'Name'])).trim(), brand: String(pickCol(r, ['Brand', 'Make', 'Manufacturer'])).trim(), model: String(pickCol(r, ['Model', 'Model No', 'Model Number', 'MPN'])).trim(), category: String(pickCol(r, ['Category', 'Department'])), subcategory: String(pickCol(r, ['Subcategory', 'Sub Category', 'Class'])),
    condition: (() => { const c = String(pickCol(r, ['Condition', 'Grade'])).toLowerCase(); return !c ? 'New' : /open|box/.test(c) ? 'Open box' : /refurb/.test(c) ? 'Refurbished' : /damag|part|salvage/.test(c) ? 'Damaged / Parts' : /used|return/.test(c) ? 'Used' : 'New'; })(),
    regularPrice: num(pickCol(r, ['Regular Price', 'Shelf Price', 'Retail Price', 'MSRP', 'Unit Retail', 'Ext Retail'])) || '', unitCost: pickCol(r, ['Price Paid', 'Price Each', 'Unit Cost', 'Unit Price', 'Cost', 'Price'], /shelf|retail|regular|msrp|total|tax|ext|amount/i), qty: Math.floor(num(pickCol(r, ['Quantity', 'Qty', 'Units']))) || 1,
    expiry: xlDate(pickCol(r, ['Expiry Date', 'Expiry', 'Expiration'])), barcode: String(pickCol(r, ['Barcode', 'UPC', 'EAN'])), notes: String(pickCol(r, ['Notes'])),
    unit: String(pickCol(r, ['Unit', 'Sold By'])), size: num(pickCol(r, ['Size'])) || null, weight: num(pickCol(r, ['Weight (kg)', 'Weight Kg', 'Weight', 'Kg'])) || '', sizeUnit: String(pickCol(r, ['Size Unit', 'Weight Unit'])), packOf: Math.max(1, Math.floor(num(pickCol(r, ['Pack Of', 'Units Per Pack', 'Pack'])) || 1)),
    tax: pickCol(r, ['Tax %', 'Tax Rate', 'Tax', 'VAT %', 'VAT Rate'], /total|amount|amt/i), currency: String(pickCol(r, ['Currency'])).trim().toUpperCase(), group: r.__scanGroup == null ? '' : String(r.__scanGroup),
    total: pickCol(r, ['Total', 'Line Total', 'Total Price', 'Amount', 'Ext Price', 'Extended Price'], /tax|sub|grand|retail/i), // price × qty, before tax
    taxAmt: pickCol(r, ['Total Tax', 'Tax Amount', 'Tax Total', 'Line Tax', 'VAT Amount'], /^$/), // the receipt's tax in money (see below)
  })).filter((l) => l.name);
  lines.forEach((l) => {
    const u = String(l.unit || '').trim().toLowerCase(); // each / ea / pcs → piece; pk → pack…
    l.unit = KC.SELL_UNITS.includes(u) ? u : ({ each: 'piece', ea: 'piece', pc: 'piece', pcs: 'piece', pce: 'piece', units: 'unit', pk: 'pack', pkt: 'packet', bx: 'box', btl: 'bottle', ltr: 'litre', l: 'litre', liter: 'litre', kgs: 'kg', lbs: 'lb' }[u] || (u ? 'piece' : ''));
    const t = String(l.tax ?? '').replace('%', '').trim(); l.taxPct = t === '' ? '' : String(num(t));
    const ck = (String(l.notes).match(/CHECK \[[^\]]+\][^;|]*/g) || []).map((x) => x.trim());
    // Total (price × qty) and Total Tax: fill what the file leaves out, and flag a line whose figures do not agree
    const q = num(l.qty) || 1, r2 = (v) => Math.round(v * 100) / 100;
    const tot = String(l.total).trim() === '' ? null : num(l.total), tAmt = String(l.taxAmt).trim() === '' ? null : num(l.taxAmt);
    if (String(l.unitCost).trim() === '' && tot > 0) l.unitCost = String(Math.round(tot / q * 1e4) / 1e4); // only the total on the receipt: price each = total ÷ qty
    else if (tot != null && String(l.unitCost).trim() !== '') {
      const calc = num(l.unitCost) * q, ok = (v) => Math.abs(v - tot) <= Math.max(Number.isInteger(tot) ? 0.5 : 0.011, q * 0.005); // rounding: to the franc (whole totals), or half a cent a unit
      if (!ok(calc) && !(num(l.taxPct) && ok(calc * (1 + num(l.taxPct) / 100)))) ck.push('CHECK [Total]: price × qty is ' + r2(calc) + ', the file says ' + tot); // a total with tax in it is fine
    }
    l._lineV = num(l.unitCost) * q; l._tAmt = tAmt;
    l.check = ck.join('; ');
    if (!KC.SIZE_UNITS[l.sizeUnit]) { const mm = { kgs: 'kg', lbs: 'lb', ounce: 'oz', liter: 'L', litre: 'L', l: 'L', ml: 'mL', gallon: 'gal', floz: 'fl oz' }[String(l.sizeUnit).toLowerCase().replace(/[^a-z]/g, '')]; l.sizeUnit = mm || ''; }
    if (!catOpts().includes(l.category)) { l.notes = [l.notes, l.category && 'Cat: ' + l.category].filter(Boolean).join(' · '); l.category = /tv|speaker|audio|laptop|phone|electr|computer|tablet/i.test(l.name + l.category) ? (catOpts().includes('Electronics') ? 'Electronics' : defCat()) : (catOpts().includes('Other') ? 'Other' : defCat()); l.subcategory = subOpts(l.category)[0] || ''; }
  });
  // Total Tax = the tax printed on the receipt, typed on its first line (or the same amount on every line). It is shared
  // over the receipt's lines by their cost (price × qty) — the purchase takes it as a tax amount. Different amounts on
  // different lines = each line's own tax (older files), turned into that line's rate.
  const r2 = (v) => Math.round(v * 100) / 100, near = (a, b) => Math.abs(a - b) <= (Number.isInteger(b) ? 0.5 : 0.011);
  const addCk = (l, m) => { l.check = [l.check, m].filter(Boolean).join('; '); };
  receiptGroups(lines).forEach((g, gi) => {
    const given = g.filter((l) => l._tAmt != null); if (!given.length) return;
    const sub = g.reduce((a, l) => a + l._lineV, 0);
    if (given.every((l) => l._tAmt === given[0]._tAmt)) {
      const T = given[0]._tAmt;
      if (g.some((l) => l.taxPct !== '')) { const calc = r2(g.reduce((a, l) => a + l._lineV * num(l.taxPct) / 100, 0)); if (!near(calc, T)) addCk(g[0], 'CHECK [Tax]: the lines\' tax adds up to ' + calc + ', the receipt says ' + T); }
      else if (sub > 0) g.forEach((l) => { l.receiptTax = T; l.receiptKey = gi; l.taxPct = String(Math.round(T / sub * 1e8) / 1e6); }); // the rate: used when several receipts share one purchase
    } else given.forEach((l) => {
      if (!(l._lineV > 0)) return;
      if (l.taxPct === '') l.taxPct = String(Math.round(l._tAmt / l._lineV * 1e6) / 1e4);
      else { const calc = r2(l._lineV * num(l.taxPct) / 100); if (!near(calc, l._tAmt)) addCk(l, 'CHECK [Tax]: ' + l.taxPct + '% of ' + r2(l._lineV) + ' is ' + calc + ', the file says ' + l._tAmt); }
    });
  });
  return lines;
}
/** the receipts in a file: one per date + seller + receipt number, in the file's order */
function receiptGroups(lines) {
  const m = new Map(); lines.forEach((l) => { const k = [l.purchaseDate, String(l.vendor).toLowerCase().trim(), String(l.poNumber).trim(), l.group || ''].join('|'); if (!m.has(k)) m.set(k, []); m.get(k).push(l); });
  return [...m.values()];
}
const receiptLabel = (g) => [g[0].vendor || 'Seller not given', g[0].purchaseDate ? fmtDate(g[0].purchaseDate) : '', g[0].poNumber ? 'receipt ' + g[0].poNumber : ''].filter(Boolean).join(' · ');
A.puImport = async (el) => {
  const sh = puSheet(el);
  if (!window.XLSX) return toast('Excel library still loading — try again in a moment', true);
  const f = await pickFile('.xlsx,.xls,.csv'); if (!f) return;
  let lines;
  try { const wb = await readSheet(f); const ws = wb.Sheets[wb.SheetNames.find((n) => /purch|manifest|item/i.test(n)) || wb.SheetNames[0]]; lines = parsePurchaseRows(XLSX.utils.sheet_to_json(ws, { defval: '' })); }
  catch (e) { return toast('Could not read this file: ' + e.message, true); }
  if (!lines.length) return toast('No item rows found. Use the template column names.', true);
  puLoad(sh, lines);
};
/** imported lines (Excel or a scanned receipt) into the purchase: several receipts → one purchase each (recommended) or all here */
async function puLoad(sh, lines, from) {
  const groups = receiptGroups(lines);
  if (groups.length > 1) { // several receipts: one purchase each (recommended), or everything here
    const box = openSheet({ title: 'This file has ' + groups.length + ' receipts', body: '<p class="small">Each receipt is its own purchase — its own seller, date, payment and tax.</p><div class="card list">' + groups.map((g, i) => '<div class="li" style="cursor:default"><div class="grow"><b>' + (i + 1) + ' · ' + esc(receiptLabel(g)) + '</b><div class="tiny muted">' + g.length + ' line' + (g.length === 1 ? '' : 's') + ' · ' + fmt(g.reduce((a, l) => a + num(l.qty), 0)) + ' items</div></div></div>').join('') + '</div>',
      foot: '<button class="btn" id="riAll">Put everything in this purchase</button><button class="btn pri grow" id="riOne">One purchase per receipt</button>' });
    const pick = await new Promise((ok) => { $('#riOne', box).onclick = () => ok('one'); $('#riAll', box).onclick = () => ok('all'); box._onClose = () => ok(null); });
    if (K.sheets.includes(box)) { box._onClose = null; closeSheet(); }
    if (!pick) return;
    if (pick === 'one') { K._puQueue = groups.slice(1); lines = groups[0]; return puFill(sh, lines, 'Receipt 1 of ' + groups.length + ' (' + receiptLabel(groups[0]) + ') · '); }
  }
  puFill(sh, lines, from);
}

/* ---------- scan a receipt or invoice (photos or PDF): read by Claude on the server, then the same rows as the Excel template ---------- */
const SCAN_MAX_BYTES = 4 * 1024 * 1024;
/** a photo made lighter for mobile data: at most ~2000 px on the long side and ~3.5 million pixels, JPEG — still sharp enough to read */
async function shrinkPhoto(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height), Math.sqrt(3.5e6 / (bmp.width * bmp.height)));
    if (k === 1 && file.size < 900e3 && /jpe?g|png|webp/.test(file.type)) { bmp.close && bmp.close(); return file; } // already small
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
    return (await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85))) || file;
  } catch (e) { return file; } // a format this browser cannot draw: sent as it is (the server says if it cannot read it)
}
const fileB64 = (b) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => no(new Error('Could not read the file')); r.readAsDataURL(b); });
/** what the AI read → rows with the receipt template's column names (parsePurchaseRows then works exactly as for Excel) */
function scanRows(list) {
  const r2 = (v) => Math.round(v * 100) / 100; const out = [];
  list.forEach((x, ri) => {
    const lineV = (l) => (l.lineTotal != null ? l.lineTotal : l.unitPrice != null ? l.unitPrice * (l.quantity || 1) : 0);
    const sum = x.lines.reduce((a, l) => a + lineV(l), 0);
    const noLineTax = x.lines.every((l) => l.taxPct == null && l.taxAmount == null);
    const rTax = noLineTax && x.tax > 0 ? x.tax : ''; // one tax for the whole receipt: its amount, shared over the lines by cost
    const rc = x.checks.slice();
    const tol = (v) => Math.max(Number.isInteger(v) ? 1 : 0.02, Math.abs(v) * 0.005);
    if (x.subtotal != null && Math.abs(sum - x.subtotal) > tol(x.subtotal)) rc.push('the lines add up to ' + r2(sum) + ', the receipt subtotal is ' + x.subtotal);
    else if (x.subtotal == null && x.total != null && x.tax == null && noLineTax && Math.abs(sum - x.total) > tol(x.total)) rc.push('the lines add up to ' + r2(sum) + ', the receipt total is ' + x.total);
    x.lines.forEach((l, i) => {
      const notes = l.checks.map((c) => 'CHECK [' + (c.field || 'Line').replace(/[\[\];|]/g, ' ').trim() + ']: ' + String(c.reason).replace(/[;|]/g, ','));
      if (i === 0) rc.forEach((m) => notes.push('CHECK [Receipt]: ' + String(m).replace(/[;|]/g, ',')));
      out.push({ __scanGroup: ri, Date: x.date, Seller: x.seller, Receipt: x.receiptNo, Currency: x.currency, Description: l.description, Brand: l.brand, Model: l.model, Category: l.category, Unit: l.unit,
        Quantity: l.quantity == null ? '' : l.quantity, 'Price Each': l.unitPrice == null ? '' : l.unitPrice, Total: l.lineTotal == null ? '' : l.lineTotal,
        'Tax %': l.taxPct != null ? l.taxPct : l.taxAmount != null && lineV(l) > 0 ? Math.round(l.taxAmount / lineV(l) * 1e6) / 1e4 : '', 'Total Tax': rTax, Notes: notes.join(' | ') });
    });
  });
  return out;
}
A.scanPurchase = () => { purchaseForm(); const sh = K.sheets[K.sheets.length - 1]; const b = sh && $('[data-a=puScan]', sh); if (b) A.puScan(b); };
A.puScan = async (el) => {
  const sh = puSheet(el);
  if (!(K.info && K.info.receiptScan)) return toast('Receipt scanning is not set up yet', true);
  const files = await chooseFile('image/*,application/pdf,.pdf', null, true); if (!files) return;
  if (files.length > 8) return toast('At most 8 photos or PDFs at a time', true);
  const wait = openSheet({ title: 'Reading your receipt', body: LOADER_IN + '<p class="small muted" style="text-align:center;margin-top:-60px">This takes about 10 to 30 seconds. Keep this page open.</p>' });
  const done = () => { if (K.sheets.includes(wait)) { wait._onClose = null; closeSheet(); } };
  let r;
  try {
    const parts = []; let size = 0;
    for (const f of files) {
      const b = f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? f : await shrinkPhoto(f);
      size += b.size; if (size > SCAN_MAX_BYTES) throw new Error('The files are too large together (more than 4 MB) — send fewer pages at a time');
      parts.push({ data: await fileB64(b) });
    }
    r = await K.store.req('POST', '/api/purchases/scan', { files: parts, categories: catOpts(), currency: baseCode() });
  } catch (e) { done(); return toast(e.message, true); }
  done();
  if (!K.sheets.includes(sh)) return; // the purchase was closed meanwhile
  if (!r.receipts.length) return toast(r.unreadable || 'No receipt could be read in these files — try a clearer, closer photo', true);
  const lines = parsePurchaseRows(scanRows(r.receipts));
  if (!lines.length) return toast('No items were found on this receipt', true);
  puLoad(sh, lines, 'Read from the receipt · ');
};
/** put imported lines (one receipt) into the purchase: seller, date, receipt no., tax, rows */
function puFill(sh, lines, intro) {
  const head = $('#puHead', sh); const setIf = (n, v) => { const i = $('[name=' + n + ']', head); if (i && v && (!i.value || (n === 'purchaseDate' && i.value === todayStr()))) i.value = v; };
  const f0 = lines[0];
  if (f0.currency && sh._setWhere && !sh._rows.some((r) => r.name.trim())) { if (f0.currency === baseCode() && sh._where !== 'local') sh._setWhere('local'); else if (f0.currency === 'USD' && sh._where !== 'abroad') sh._setWhere('abroad'); } // the receipt's currency: bought in Cameroon / abroad (first, as it redraws the seller list)
  const pick = $('#puSeller', sh);
  if (f0.vendor && !pick.value) { // the file names the seller: pick them, or open "New seller" with the name filled in
    const known = [...pick.options].find((o) => o.value.toLowerCase() === f0.vendor.toLowerCase() && o.value !== '__new');
    if (known) pick.value = known.value; else { pick.value = '__new'; $('#puNewSel', sh).classList.remove('hide'); setIf('vendor', f0.vendor); }
  } setIf('poNumber', f0.poNumber); setIf('purchaseDate', f0.purchaseDate);
  if (f0.sourceType && KC.SOURCE_TYPES.includes(f0.sourceType)) $('#puSrc', sh).value = f0.sourceType; else if (/b-?stock|auction/i.test(f0.vendor)) $('#puSrc', sh).value = 'Auction';
  if (lines[0].receiptTax != null && lines.every((l) => l.receiptKey === lines[0].receiptKey) && !sh._rows.some((r) => r.name.trim()) && !$('#puTax', sh).value) { // one receipt, its tax in money
    A.puTaxMode($('#puTaxMode [data-v=amt]', sh)); $('#puTax', sh).value = String(lines[0].receiptTax); lines.forEach((l) => (l.taxPct = ''));
  }
  const rates = [...new Set(lines.map((l) => l.taxPct).filter((t) => t !== ''))];
  const perLine = rates.length > 1; // different rates on different lines: each line keeps its own
  if (!perLine && rates.length && num(rates[0]) > 0 && !$('#puTax', sh).value) { if (sh._taxMode !== 'pct') A.puTaxMode($('#puTaxMode [data-v=pct]', sh)); $('#puTax', sh).value = rates[0]; } // a rate from the file
  sh._rows = sh._rows.filter((r) => r.name.trim()).concat(lines.map((l) => puRow({ name: l.name, brand: l.brand, model: l.model, taxPct: perLine ? l.taxPct || '0' : '', check: l.check, category: l.category, subcategory: l.subcategory, qty: String(l.qty), unitCost: l.unitCost === '' ? '' : String(num(l.unitCost)), condition: l.condition, regularPrice: l.regularPrice === '' ? '' : String(l.regularPrice), weight: l.weight === '' ? '' : String(l.weight), packOf: String(l.packOf), expiry: l.expiry, barcode: l.barcode, notes: l.notes, unit: l.unit, size: l.size, sizeUnit: l.sizeUnit })));
  sh._draw();
  const noPrice = lines.filter((l) => l.unitCost === '').length;
  const checks = lines.filter((l) => l.check).length;
  toast((intro || '') + lines.length + ' line' + (lines.length === 1 ? '' : 's') + ' imported' + (noPrice ? ' · ' + noPrice + ' without a price' : '') + (checks ? ' · ' + checks + ' to check (⚠)' : '') + ' — check them, then save');
}
/* the template: Total = Price Each × Quantity and Total Tax = the line's tax, as formulas that update while typing */
A.tplPurch = () => {
  const ex = [
    { Date: todayStr(), 'Bought From': 'Store', Seller: 'Costco', Receipt: '', Description: 'Quaker Oats Old Fashioned 2x2.6kg', Category: 'Food & Snacks', Subcategory: 'Cereal & Oats', Brand: 'Quaker', Model: 'Old Fashioned', Condition: 'New', 'Shelf Price': 12.99, 'Price Each': 9.98, Quantity: 10, 'Pack Of': 1, Unit: 'pack', Size: 2.6, 'Size Unit': 'kg', 'Expiry Date': '2027-06-30', Barcode: '', 'Weight (kg)': 2.6, 'Total Tax': 18.13, Notes: '' },
    { Date: todayStr(), 'Bought From': 'Store', Seller: 'Costco', Receipt: '', Description: 'Kirkland Olive Oil 2L', Category: 'Food & Snacks', Subcategory: '', Brand: 'Kirkland', Model: '', Condition: 'New', 'Shelf Price': 24.99, 'Price Each': 19.99, Quantity: 6, 'Pack Of': 1, Unit: 'bottle', Size: 2, 'Size Unit': 'L', 'Expiry Date': '', Barcode: '', 'Weight (kg)': 2, 'Total Tax': '', Notes: '' },
  ];
  const r2 = (v) => Math.round(v * 100) / 100;
  const rows = ex.map((r) => { const o = {}; Object.entries(r).forEach(([k, v]) => { o[k] = v; if (k === 'Quantity') o.Total = r2(r['Price Each'] * r.Quantity); }); return o; });
  const how = [
    { Column: 'One row per item', 'How to fill it': 'Rows with the same Date, Seller and Receipt are one receipt (one purchase).' },
    { Column: 'Total', 'How to fill it': 'Price Each × Quantity, worked out for you. If the receipt only shows the line total, type it here and leave Price Each empty.' },
    { Column: 'Total Tax', 'How to fill it': 'The tax printed on the receipt, in money, typed once on the receipt\'s first row. It is shared over the receipt\'s items by their cost.' },
    { Column: 'Notes', 'How to fill it': 'Anything to remember. "CHECK [Field]: reason" marks the line ⚠ Check.' },
  ];
  xlsxDownload('Purchase-template.xlsx', { Purchases: rows, 'How to fill': how }, { _blank: 50, Purchases: {
    Total: 'IF(OR({Price Each}="",{Quantity}=""),"",ROUND({Price Each}*{Quantity},2))',
  } });
};

/* ================= 2 · SHIP ================= */
VIEWS.ship = {
  render() {
    const wait = waitingLots().sort((a, b) => (a.purchaseDate || '').localeCompare(b.purchaseDate || ''));
    const waitU = wait.reduce((a, l) => a + num(l.qty), 0);
    const active = shipsIn('ship').sort((a, b) => stIdx(b.status) - stIdx(a.status) || (b.createdAt || '').localeCompare(a.createdAt || ''));
    const later = K.raw.shipments.filter((s) => KC.shipPhase(s.status) !== 'ship').sort((a, b) => (b.receivedAt || b.arrivedAt || b.createdAt || '').localeCompare(a.receivedAt || a.arrivedAt || a.createdAt || ''));
    const waitVal = wait.reduce((a, l) => a + K.C.lotX[l.id].paidX * num(l.qty), 0);
    return '' +
      (wait.length ? '' : '<div class="toolbar mb"><button class="btn pri" data-a="newShip">' + ic('plus') + 'Start a shipment</button></div>') +
      '<section class="card flow-card mb2"><div class="home-card-h"><h2>Waiting to ship</h2><span class="hint">' + (waitU ? fmt(waitU) + ' units · ' + wait.length + ' line' + (wait.length === 1 ? '' : 's') + (seeCost() ? ' · ' + F(waitVal) : '') : '') + '</span></div>' +
        (wait.length ? '<div class="mini-list">' + wait.slice(0, 6).map((l) => { const p = byId('products', l.productId) || {}; return '<div class="mini"><div class="grow"><div class="mini-t">' + esc(p.name || '?') + '</div><div class="mini-d">' + esc([l.vendor, fmtDate(l.purchaseDate)].filter(Boolean).join(' · ')) + '</div></div><div class="mini-v">×' + fmt(l.qty) + '</div></div>'; }).join('') + (wait.length > 6 ? '<div class="hint pad-x">…and ' + (wait.length - 6) + ' more</div>' : '') + '</div>' +
          '<div class="pad row wrap">' + (K.raw.shipments.length ? '<select class="inp" id="wtShip" style="width:auto;max-width:100%" aria-label="Shipment to put them in">' + active.concat(later).map((s) => '<option value="' + s.id + '">' + esc(s.name || s.containerNo || 'Shipment') + ' · ' + esc(KC.SHIP_STATUSES[stIdx(s.status)][1]) + '</option>').join('') + '</select><button class="btn pri" data-a="wtAdd">' + ic('plus', 'sm') + 'Put items in this shipment</button><span class="hint">or</span><button class="btn" data-a="newShip">Start a shipment</button>' : '<button class="btn pri" data-a="newShip">' + ic('plus') + 'Start a shipment</button>') + '</div>'
          : '<div class="hint pad">Nothing waiting. Everything you buy abroad appears here until it is put in a shipment. <a href="#buy">Record a purchase</a></div>') + '</section>' +
      '<h2 class="sec-t">Shipments in progress</h2>' + shipTable(active, 'shipActive') +
      (later.length ? '<details class="fold mt2"><summary>Arrived shipments (' + later.length + ')</summary><div class="fold-body">' + shipTable(later, 'shipDone') + '</div></details>' : '');
  },
};

/* ================= 3 · RECEIVE ================= */
const RECV_STEPS = [
  ['at_port', 'Arrived in Cameroon', 'The container is at the port.'],
  ['cleared', 'Customs & clearing paid', 'Duties, clearing agent, port storage…'],
  ['received', 'Unloaded in the warehouse', 'Offload and count what arrived.'],
  ['closed', 'Prepared for sale', 'Check prices, print labels, arrange the storage.'],
];
function recvCard(s) {
  const x = K.C.shipX[s.id]; const i = stIdx(s.status); const cm = (s.costs || []).filter((c) => c.side === 'CM');
  const cmTot = x ? x.cmX : 0; const lots = K.raw.lots.filter((l) => l.shipmentId === s.id);
  const missing = lots.reduce((a, l) => a + num(l.recvMissing) + num(l.recvDamaged), 0);
  const step = (k, n, title, hint) => {
    const si = stIdx(k); const done = i >= si; const now = !done && i === si - 1;
    let act = '';
    if (k === 'at_port' && now) act = '<button class="btn sm pri" data-a="rcvSet" data-id="' + s.id + '" data-v="at_port">Mark arrived</button>';
    if (k === 'cleared') act = '<button class="btn sm" data-a="shCost" data-s="' + s.id + '" data-side="CM">' + ic('plus', 'sm') + 'Add a cost</button>' + (now ? '<button class="btn sm pri" data-a="rcvSet" data-id="' + s.id + '" data-v="cleared">Mark cleared</button>' : '');
    if (k === 'received' && (now || done)) act = '<button class="btn sm' + (now ? ' pri' : '') + '" data-a="rcvCount" data-id="' + s.id + '">' + (done ? 'See counts' : 'Count & unload') + '</button>';
    if (k === 'closed' && i >= stIdx('received')) act = '<button class="btn sm" data-a="pricing" data-ship="' + s.id + '">' + ic('tag', 'sm') + 'Check prices</button><button class="btn sm" data-a="rcvLabels" data-id="' + s.id + '">' + ic('barcode', 'sm') + 'Labels</button>' + (now ? '<button class="btn sm pri" data-a="rcvSet" data-id="' + s.id + '" data-v="closed">Ready to sell</button>' : '');
    const info = k === 'at_port' && s.arrivedAt ? fmtDate(s.arrivedAt) : k === 'cleared' ? (cm.length ? F(cmTot) + ' · ' + cm.length + ' cost' + (cm.length === 1 ? '' : 's') : 'No costs yet') + (s.clearedAt ? ' · ' + fmtDate(s.clearedAt) : '') : k === 'received' && done ? (s.receivedAt ? fmtDate(s.receivedAt) : '') + (missing ? ' · ' + missing + ' missing or damaged' : ' · all there') : k === 'closed' && s.readyAt ? fmtDate(s.readyAt) : '';
    return '<li class="rstep' + (done ? ' done' : now ? ' now' : '') + '"><span class="rs-dot">' + (done ? ic('check', 'sm') : n) + '</span><div class="grow"><div class="rs-t">' + title + '</div><div class="hint">' + esc(info || hint) + '</div></div><div class="row wrap gap6 rs-a">' + act + '</div></li>';
  };
  return '<section class="card recv-card"><div class="recv-h" data-a="openShipD" data-id="' + s.id + '" role="button" tabindex="0"><div class="grow"><b>' + esc(s.name || 'Shipment') + '</b><div class="hint">' + esc([s.containerNo, fmt(x ? x.units : 0) + ' units', s.agent ? 'agent ' + s.agent : ''].filter(Boolean).join(' · ')) + '</div></div><span class="badge ' + (s.status === 'received' ? 'ok' : 'info') + '">' + esc(KC.SHIP_STATUSES[i][1]) + '</span>' + ic('chev', 'sm') + '</div>' +
    (lots.length ? '' : '<div class="alert bad recv-empty">' + ic('alert', 'sm') + '<div><b>This shipment is empty.</b> Put the items you bought in it' + (waitingLots().length ? ' — ' + waitingLots().length + ' line' + (waitingLots().length === 1 ? ' is' : 's are') + ' waiting to ship.' : '.') + '</div>' + (waitingLots().length ? '<button class="btn sm pri" data-a="shAddItems" data-id="' + s.id + '">Add items</button>' : '') + '</div>') +
    '<ol class="rsteps">' + RECV_STEPS.map(([k, t, h], j) => step(k, j + 1, t, h)).join('') + '</ol></section>';
}
VIEWS.receive = {
  render() {
    const rec = shipsIn('receive').sort((a, b) => stIdx(a.status) - stIdx(b.status));
    const coming = K.raw.shipments.filter((s) => s.status === 'in_transit');
    return '' +
      (rec.length ? '<div class="recv-list">' + rec.map(recvCard).join('') + '</div>'
        : '<div class="card pad2 center"><div class="big">' + ic('check') + '</div><h2>Nothing to receive</h2><p class="hint">Shipments appear here when they arrive in Cameroon. Then pay customs and clearing, unload, count and prepare the goods for sale.</p></div>') +
      (coming.length ? '<h2 class="sec-t mt2">Coming next</h2><section class="card"><div class="mini-list">' + coming.map((s) => '<div class="mini"><div class="grow"><div class="mini-t">' + esc(s.name || s.containerNo || 'Shipment') + '</div><div class="mini-d">' + fmt((K.C.shipX[s.id] || {}).units || 0) + ' units' + (s.arrivedAt ? ' · ETA ' + fmtDate(s.arrivedAt) : '') + '</div></div><button class="btn sm" data-a="rcvSet" data-id="' + s.id + '" data-v="at_port">Mark arrived</button></div>').join('') + '</div></section>' : '') +
      '<p class="hint mt2">Bought in Cameroon? Record it in <a href="#buy">Buy</a> with “In Cameroon — straight to stock”; it skips shipping and receiving.</p>';
  },
};
A.rcvSet = async (el) => {
  const s = byId('shipments', el.dataset.id); const to = el.dataset.v;
  if (needsItems(s)) return;
  if (to === 'received') return A.rcvCount(el);
  const dk = { at_port: 'arrivedAt', cleared: 'clearedAt', closed: 'readyAt' }[to];
  const o = Object.assign({}, s, { status: to }); if (dk) o[dk] = todayStr();
  if (await save('shipments', o)) { refreshSheets(); scheduleRender(); toast((s.name || 'Shipment') + ': ' + KC.SHIP_STATUSES[stIdx(to)][1].toLowerCase()); }
};
A.rcvCount = (el) => openShip(el.dataset.id, 'recv');
A.rcvLabels = (el) => { const ids = [...new Set(K.raw.lots.filter((l) => l.shipmentId === el.dataset.id).map((l) => l.productId))]; if (!ids.length) return toast('No items in this shipment', true); labelsSheet(ids); };

A.wtAdd = () => { const s = $('#wtShip'); if (s && s.value) A.shAddItems({ dataset: { id: s.value } }); };

/* ---------- New purchase: costs per item and the review step ---------- */
const fmtKg = (v) => (Math.round(num(v) * 100) / 100).toLocaleString('en-US') + ' kg';
/** Under each item: price each, tax each, each with tax, line with tax — in the purchase currency and in FCFA. */
function puCostHTML(r, share, cur, fx) {
  if (r.unitCost === '' || !(num(r.qty) > 0)) return '<span class="hint">Type the quantity and price to see the cost of each item.</span>';
  const q = num(r.qty), each = num(r.unitCost), taxEach = q ? share / q : 0; const foreign = cur !== baseCode();
  const cell = (l, v, main) => '<div class="cb' + (main ? ' main' : '') + '"><span>' + l + '</span><b>' + money(v, cur) + '</b>' + (foreign && fx ? '<i>' + F(v * fx) + '</i>' : '') + '</div>';
  const pk = Math.max(1, Math.floor(num(r.packOf) || 1)); const per = r.packName && pk > 1 ? r.packName : 'each';
  return cell(per === 'each' ? 'Each, no tax' : 'Per ' + per + ', no tax', each) + cell('Tax ' + (per === 'each' ? 'each' : 'per ' + per), taxEach) + cell(per === 'each' ? 'Each with tax' : 'Per ' + per + ' with tax', each + taxEach, true) + cell('Line with tax', (each + taxEach) * q, true) +
    (per !== 'each' ? cell('Per ' + (r.unitName || 'piece') + ' (' + pk + ' in a ' + per + ')', (each + taxEach) / pk, true) : '') +
    (num(r.weight) ? '<div class="cb"><span>Weight</span><b>' + fmtKg(num(r.weight) * q) + '</b><i>' + fmt(q) + ' × ' + fmtKg(r.weight) + '</i></div>' : '');
}
/** Review everything before it is saved; `go` saves it. */
function puPreview(d, go) {
  const { h, lines, s, pay, credit } = d; const cur = h.currency || 'USD'; const foreign = cur !== baseCode(); const fx = foreign ? KC.rateOf(S(), cur) : 1;
  const m = (v) => money(v, cur); const loc = (v) => foreign ? '<span class="pv-loc">' + F(v * fx) + '</span>' : '';
  const wt = lines.reduce((a, l) => a + num(l.weightEach) * num(l.boughtQty), 0); const st = isStore();
  const kv = (k, v) => v ? '<div class="pv-kv"><span>' + k + '</span><b>' + v + '</b></div>' : '';
  // one fact per line: how it was paid, what is left, when it is due
  const pl = (k, v, cls) => '<div class="pv-pl' + (cls ? ' ' + cls : '') + '"><span>' + k + '</span><b>' + v + '</b></div>';
  const payTxt = credit ? pl('Paid', m(0)) + pl('Balance', m(s.total), 'due') + pl('Due', fmtDate(d.payBy))
    : pay ? pl(esc(pay.method), m(pay.amount)) + (pay.fee ? pl('Charges', m(pay.fee)) : '') + (pay.ref ? pl('Reference', esc(pay.ref)) : '') +
      (pay.amount < s.total - 0.005 ? pl('Balance', m(s.total - pay.amount), 'due') + pl('Due', fmtDate(d.payBy)) : pl('Balance', m(0), 'ok')) : '—';
  const body = '<div class="pv">' +
    '<div class="pv-head">' + (st ? '' : kv('Bought', h.where === 'local' ? '🇨🇲 In Cameroon' : '🇺🇸 Abroad')) + kv(st ? 'Supplier' : 'Seller', esc(h.vendor) + (h.sourceType && !st ? ' <span class="hint">' + esc(h.sourceType) + '</span>' : '')) + kv('Phone', esc(h.vendorPhone || '')) + kv('Date', fmtDate(h.purchaseDate)) + kv('Receipt no.', esc(h.poNumber || '')) + kv('Currency', foreign ? curSym(cur) + ' · 1 ' + curSym(cur) + ' = ' + fmt(fx) + ' ' + esc(baseSym()) : esc(baseSym())) + kv('Collected', h.puCollected === 'no' ? 'No — pick up later' : 'Yes') + '</div>' +
    '<div class="pv-tw"><table class="pv-t"><thead><tr><th class="w-it">Item</th><th class="r">Qty</th>' + (st ? '' : '<th class="r">Weight</th>') + '<th class="r">Each</th><th class="r">Tax each</th><th class="r">Each with tax</th><th class="r">Line total</th></tr></thead><tbody>' +
      lines.map((l) => { const pk = num(l.pack) || 1; const bq = num(l.boughtQty); const each = num(l.unitCost) * pk, tx = num(l.unitTax) * pk; return '<tr><td><span class="pv-n">' + esc(l.name) + '</span><span class="pv-s">' + esc([l.category, l.condition !== 'New' ? l.condition : '', pk > 1 ? (l.packName ? l.packName + ' of ' + pk + ' = ' + fmt(bq * pk) + ' ' + plural3(l.unitName || 'piece', bq * pk) : 'pack of ' + pk) : ''].filter(Boolean).join(' · ')) + '</span></td>' +
        '<td class="r">' + fmt(bq) + (l.packName && pk > 1 ? ' <span class="pv-s">' + plural3(l.packName, bq) + '</span>' : '') + '</td>' + (st ? '' : '<td class="r">' + (num(l.weightEach) ? fmtKg(num(l.weightEach) * bq) : '<span class="faint">—</span>') + '</td>') +
        '<td class="r">' + m(each) + loc(each) + '</td><td class="r">' + m(tx) + loc(tx) + '</td><td class="r b">' + m(each + tx) + loc(each + tx) + '</td><td class="r b">' + m((each + tx) * bq) + loc((each + tx) * bq) + '</td></tr>'; }).join('') +
    '</tbody></table></div>' +
    '<div class="pv-foot"><div class="pv-pay"><div class="pv-l">Payment</div><div>' + payTxt + '</div><div class="pv-l mt">Next</div><div>' + (h.where === 'local' ? 'Goes straight to stock, ready to sell.' : 'Waits in <b>Ship</b> until you put it in a shipment.') + '</div></div>' +
      '<div class="pv-tot">' + '<div class="row between"><span>Items</span><span>' + m(s.sub) + '</span></div><div class="row between"><span>Tax</span><span>' + m(s.tax) + '</span></div>' + (wt ? '<div class="row between"><span>Total weight</span><span>' + fmtKg(wt) + '</span></div>' : '') +
        '<div class="row between pv-grand"><b>Total</b><b>' + m(s.total) + '</b></div>' + (foreign ? '<div class="pv-loc r">≈ ' + F(s.total * fx) + '</div>' : '') + '</div></div></div>';
  const pv = openSheet({ title: 'Review purchase', wide: true, body, foot: '<button class="btn grow" data-a="sheetClose">' + ic('back', 'sm') + 'Back to edit</button><button class="btn pri grow" id="pvGo">' + ic('check', 'sm') + 'Confirm purchase · ' + m(s.total) + '</button>' });
  $('#pvGo', pv).onclick = () => go();
}
