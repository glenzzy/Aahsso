/* Kargo — the 4-phase flow: Buy → Ship → Receive → Sell.
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
    return '<a class="ph' + (i === ci ? ' on' : '') + (ci >= 0 && i < ci ? ' done' : '') + '" href="#' + p[0] + '"' + (i === ci ? ' aria-current="page"' : '') + '><span class="ph-n">' + (i + 1) + '</span><span class="ph-t"><b>' + p[1] + '</b><span>' + esc(n[p[0]]) + '</span></span></a>';
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
    return '' +
      '<div class="kpis mb2">' + kpi('Bought this month', F(spent), 'tax included') + kpi('Tax this month', F(tax), spent ? pct(tax / Math.max(1, spent - tax) * 100) + ' on average' : '') + kpi('Owed to sellers', F(owed), 'unpaid or part paid') +
        '<div class="card kpi"><div class="l">Waiting to ship</div><div class="v">' + fmt(waitU) + ' <span class="hint">units</span></div><div class="s">' + (waitU && can('containers') ? '<a href="#ship">Put them in a shipment →</a>' : 'bought, not shipped yet') + '</div></div></div>' +
      '<div class="toolbar mb"><button class="btn pri" data-a="newPurchase">' + ic('plus') + 'New purchase</button>' +
        '<div class="search grow">' + ic('search') + '<input class="inp" placeholder="Search seller, item, receipt or txn ID" value="' + esc(K.ui.buyQ || '') + '" data-c="buyQ"></div>' +
        (can('export') ? '<button class="btn ghost" data-a="exportPurch" title="Download as Excel">' + ic('dl') + 'Excel</button>' : '') + '</div>' +
      '<div class="chips mb">' + [['all', 'All'], ['us', 'Waiting to ship'], ['transit', 'Shipping'], ['warehouse', 'In stock']].map(([k, l]) => '<button class="chip' + (f === k ? ' on' : '') + '" data-a="buyF" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      purchaseTable(groups);
  },
};

/* ----- New purchase: seller, items (with tax shared over them), payment ----- */
const defCat = () => (catOpts().includes('Food & Snacks') ? 'Food & Snacks' : catOpts()[0] || 'Other');
const puRow = (o) => Object.assign({ name: '', category: defCat(), subcategory: '', qty: '1', unitCost: '', condition: 'New', working: 'Working', regularPrice: '', packOf: '1', expiry: '', barcode: '', reservedFor: '', notes: '', unit: '', size: null, sizeUnit: '', photo: null, open: false }, o || {});
const SELLER_SUP_TYPE = { Store: 'Store / wholesaler', Online: 'Store / wholesaler', Auction: 'Auction (B-Stock…)', 'Local (Cameroon)': 'Store / wholesaler' };
A.newPurchase = () => purchaseForm();
/* Where it was bought decides the money: abroad = US dollars, in Cameroon = local currency (FCFA). */
const PU_WHERE = {
  abroad: { cur: () => 'USD', methods: ['Cash', 'Bank transfer', 'Zelle / US bank', 'Other'] },
  local: { cur: () => baseCode(), methods: ['Cash', 'MTN MoMo', 'Orange Money', 'Bank transfer'] },
};
/** Sellers you bought from before (newest first), plus the usual US stores; the ones that fit "where" come first. */
function puSellers(where) {
  const m = new Map();
  K.raw.lots.slice().sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || '')).forEach((l) => {
    const n = (l.vendor || '').trim(); if (!n || m.has(n.toLowerCase())) return;
    m.set(n.toLowerCase(), { name: n, type: l.sourceType || '', phone: l.vendorPhone || '', local: l.sourceType === 'Local (Cameroon)' || !!l.inWarehouse || (l.currency || 'USD') === baseCode() });
  });
  (S().vendors || []).forEach((n) => { if (!m.has(n.toLowerCase())) m.set(n.toLowerCase(), { name: n, type: /b-?stock/i.test(n) ? 'Auction' : 'Store', phone: '', local: false }); });
  const all = [...m.values()]; const fits = (v) => (where === 'local') === v.local;
  return all.filter(fits).concat(all.filter((v) => !fits(v)));
}
function purchaseForm() {
  const names = [...new Set(K.raw.products.map((p) => p.name))];
  const usd = num((S().fxRates || {}).USD) || num(S().fxRate) || 0;
  const whereCard = (w, flag, title, sub) => '<button type="button" class="pu-wc' + (w === 'abroad' ? ' on' : '') + '" data-a="puWhere" data-v="' + w + '" aria-pressed="' + (w === 'abroad') + '"><span class="pu-flag" aria-hidden="true">' + flag + '</span><span><b>' + title + '</b><span>' + sub + '</span></span></button>';
  const sh = openSheet({
    title: 'New purchase', wide: true,
    body: '<datalist id="dlNames">' + names.map((n) => '<option value="' + esc(n) + '">').join('') + '</datalist>' +
      // where & seller
      '<section class="pu-sec" id="puHead">' +
        '<div class="pu-where2" role="group" aria-label="Where did you buy?">' + whereCard('abroad', '🇺🇸', 'Bought abroad', 'Prices in US dollars ($)') + whereCard('local', '🇨🇲', 'Bought in Cameroon', 'Prices in ' + esc(baseSym()) + ' · goes straight to stock') + '</div>' +
        '<input type="hidden" name="where" value="abroad"><input type="hidden" name="currency" id="puCur" value="USD">' +
        '<div class="pu-rate hint" id="puRate">' + (usd ? '1 $ = ' + fmt(usd) + ' ' + esc(baseSym()) + ' · <a href="#settings">change rate</a>' : 'Set the dollar rate in <a href="#settings">Settings</a> to see totals in ' + esc(baseSym())) + '</div>' +
        '<div class="pu-seller">' + field('Seller', '<select class="inp" name="vendorPick" id="puSeller"></select>') + field('Bought from', sel('sourceType', KC.SOURCE_TYPES, 'Store', 'id="puSrc"')) + field('Date', inp('purchaseDate', todayStr(), 'type="date"')) + '</div>' +
        '<div class="pu-newsel hide" id="puNewSel"><div class="grid2">' + field('New seller name', inp('vendor', '', 'placeholder="e.g. Mama Ngono, Costco Houston" autocomplete="off"')) + field('Seller phone', inp('vendorPhone', '', 'inputmode="tel" placeholder="Optional"')) + '</div></div>' +
        '<details class="pu-extra"><summary>More details <span class="hint">receipt no., pick-up</span></summary><div class="grid2 mt">' +
          field('Receipt / order no.', inp('poNumber', '', 'placeholder="Optional"')) + field('Collected from the seller?', sel('puCollected', [['yes', 'Yes, we have the goods'], ['no', 'No — pick up later']], 'yes')) + '</div></details></section>' +
      // items
      '<section class="pu-sec"><div class="pu-h2"><h3 class="pu-t3">Items</h3><div class="row gap6"><button type="button" class="btn sm ghost" data-a="puImport">' + ic('up', 'sm') + 'Import Excel</button><button type="button" class="btn sm ghost" data-a="tplPurch">' + ic('dl', 'sm') + 'Template</button></div></div>' +
        '<div class="pu-tw"><table class="t pu-t2"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r" id="puPriceH">Price each</th><th class="r">Total</th><th></th></tr></thead><tbody id="puRows"></tbody></table></div>' +
        '<div class="pu-under"><div class="col" style="gap:10px"><button type="button" class="btn sm" data-a="puAdd" style="align-self:flex-start">' + ic('plus', 'sm') + 'Add item</button><span class="hint">Tip: press Enter in the price to add the next item.</span>' +
          '<div id="puSpread" class="hide"><div class="hint mb">Paid one price for the items without a price?</div><div class="row gap6"><input class="inp" id="puLot" inputmode="decimal" placeholder="Total paid" style="width:140px"><button type="button" class="btn sm" data-a="puSpread">Spread it</button></div></div></div>' +
          '<div class="pu-tot"><div class="row between"><span>Items</span><span class="money" id="puSub"></span></div>' +
            '<div class="row between pu-taxrow"><span class="row gap6"><span>Tax</span><input class="inp" id="puTax" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="Tax"><span class="seg sm" id="puTaxMode"><button type="button" class="on" data-a="puTaxMode" data-v="pct">%</button><button type="button" data-a="puTaxMode" data-v="amt" id="puTaxCur">$</button></span></span><span class="money" id="puTaxV"></span></div>' +
            '<div class="row between pu-grand"><b>Total</b><b class="money" id="puGrand"></b></div><div class="pu-local hint" id="puLocal"></div><div class="hint" id="puTaxHint"></div></div></div></section>' +
      // payment
      '<section class="pu-sec"><h3 class="pu-t3">Payment</h3>' +
        '<div class="seg mb" id="puPaidSeg"><button type="button" class="on" data-a="puPaid" data-v="paid">Paid in full</button><button type="button" data-a="puPaid" data-v="part">Part paid</button>' + (can('suppliers') ? '<button type="button" data-a="puPaid" data-v="credit">Not paid yet</button>' : '') + '</div>' +
        '<div id="puPayBy" class="hide" style="max-width:260px">' + field('Pay the rest by', inp('payBy', KC.addDays(todayStr(), 14), 'type="date"')) + '</div>' +
        '<div id="puPay"></div></section>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="puSave">Save purchase</button>',
  });
  sh._rows = [puRow()]; sh._taxMode = 'pct'; sh._paid = 'paid'; sh._where = 'abroad';
  const cur = () => $('#puCur', sh).value;
  const lineVal = (r) => num(r.qty) * num(r.unitCost);
  const sums = () => {
    const sub = sh._rows.reduce((a, r) => a + lineVal(r), 0); const tv = num($('#puTax', sh).value);
    const tax = sh._taxMode === 'pct' ? Math.round(sub * tv) / 100 : tv;
    return { sub, tax, total: Math.round((sub + tax) * 100) / 100, shares: KC.allocTax(sh._rows.map((r) => ({ unitCost: num(r.unitCost), qty: num(r.qty) })), tax) };
  };
  const m = (v) => money(v, cur());
  const totals = () => {
    const s = sums();
    $$('#puRows tr[data-r]', sh).forEach((tr) => { const i = +tr.dataset.r, r = sh._rows[i]; $('[data-out=total]', tr).textContent = lineVal(r) ? m(lineVal(r)) : '—'; $('[data-out=tax]', tr).textContent = s.shares[i] ? '+ ' + m(s.shares[i]) + ' tax' : ''; });
    const rate = s.sub ? s.tax / s.sub * 100 : 0;
    $('#puSub', sh).textContent = m(s.sub); $('#puTaxV', sh).textContent = m(s.tax); $('#puGrand', sh).textContent = m(s.total);
    const fx = cur() === baseCode() ? 1 : KC.rateOf(S(), cur());
    $('#puLocal', sh).textContent = cur() !== baseCode() && s.total && fx ? '≈ ' + F(s.total * fx) : '';
    $('#puTaxHint', sh).textContent = s.tax && s.sub ? (sh._taxMode === 'pct' ? '' : (Math.round(rate * 100) / 100) + '% · ') + 'shared over the items by value' : '';
    $('#puPriceH', sh).textContent = 'Price each (' + curSym(cur()) + ')'; $('#puTaxCur', sh).textContent = curSym(cur());
    $$('#puRows [data-unit]', sh).forEach((u) => (u.textContent = curSym(cur())));
    $('#puSpread', sh).classList.toggle('hide', !(sh._rows.length > 1 && sh._rows.some((r) => r.name && r.unitCost === '')));
    const short = matchMedia('(max-width: 600px)').matches;
    $('#puSave', sh).textContent = s.total ? (short ? 'Save · ' : 'Save purchase · ') + m(s.total) : 'Save purchase';
    const pa = $('#payAmount', sh); if (pa) { pa.dataset.def = s.total; pa.placeholder = s.total ? fmt(s.total) : 'Total of the receipt'; if (sh._paid === 'paid') pa.value = ''; syncPayCharges(sh); }
  };
  const rowHtml = (r, i) => '<tr data-r="' + i + '"><td><input class="inp" data-f="name" list="dlNames" value="' + esc(r.name) + '" placeholder="Item name" autocomplete="off" aria-label="Item"></td>' +
    '<td data-l="Qty"><input class="inp r" data-f="qty" inputmode="numeric" value="' + esc(r.qty) + '" aria-label="Quantity"></td>' +
    '<td data-l="Price each"><div class="in-unit"><input class="inp r" data-f="unitCost" inputmode="decimal" value="' + esc(r.unitCost) + '" placeholder="0" aria-label="Price each"><span data-unit>' + esc(curSym(cur())) + '</span></div></td>' +
    '<td class="r pu-ltot" data-l="Total"><b class="money" data-out="total">—</b><span class="pu-tx" data-out="tax"></span></td>' +
    '<td class="nowrap r"><button type="button" class="icon-btn' + (r.open ? ' on' : '') + '" data-a="puMore" data-i="' + i + '" title="Category, condition, expiry, barcode, photo…" aria-label="Item details">' + ic('more', 'sm') + '</button><button type="button" class="icon-btn" data-a="puRm" data-i="' + i + '" aria-label="Remove item">' + ic('x', 'sm') + '</button></td></tr>' +
    (r.open ? '<tr class="pu-more" data-m="' + i + '"><td colspan="5"><div class="grid4">' +
      field('Category', sel('cat_' + i, catOpts(), r.category, 'data-f="category"')) + field('Condition', sel('cond_' + i, KC.CONDITIONS, r.condition, 'data-f="condition"')) + field('Working?', sel('work_' + i, KC.WORKING, r.working, 'data-f="working"')) +
      field('Pack of', '<input class="inp" data-f="packOf" inputmode="numeric" value="' + esc(r.packOf) + '" title="Units you will sell for each one bought">') +
      field('Shelf price each', '<input class="inp" data-f="regularPrice" inputmode="decimal" value="' + esc(r.regularPrice) + '" placeholder="Optional">') + field('Expiry date', '<input class="inp" type="date" data-f="expiry" value="' + esc(r.expiry) + '">') + field('Barcode', '<input class="inp" data-f="barcode" value="' + esc(r.barcode) + '" placeholder="Optional">') +
      field('Bought for a client?', sel('res_' + i, custOpts(), r.reservedFor, 'data-f="reservedFor"')) +
      '</div><div class="row mt wrap"><button type="button" class="btn sm" data-a="puPhoto" data-i="' + i + '">' + ic('cam', 'sm') + (r.photo ? 'Change photo' : 'Add photo') + '</button>' + (r.photo ? '<img class="pu-ph" src="' + URL.createObjectURL(r.photo) + '" alt="">' : '') + '<input class="inp grow" data-f="notes" value="' + esc(r.notes) + '" placeholder="Notes (optional)" aria-label="Notes"></div></td></tr>' : '');
  sh._draw = () => { $('#puRows', sh).innerHTML = sh._rows.map(rowHtml).join(''); totals(); };
  // seller dropdown: sellers used before + "+ New seller"
  const drawSellers = (keep) => {
    const list = puSellers(sh._where); const s = $('#puSeller', sh); const v = keep !== undefined ? keep : s.value;
    s.innerHTML = '<option value="">Choose a seller…</option>' + list.map((x) => '<option value="' + esc(x.name) + '">' + esc(x.name) + (x.type && x.type !== 'Store' ? ' · ' + esc(x.type) : '') + '</option>').join('') + '<option value="__new">+ New seller…</option>';
    s.value = list.some((x) => x.name === v) || v === '__new' ? v : '';
  };
  sh._sellers = () => drawSellers();
  $('#puSeller', sh).addEventListener('change', (e) => {
    const v = e.target.value; $('#puNewSel', sh).classList.toggle('hide', v !== '__new');
    if (v === '__new') { $('[name=vendor]', sh).focus(); return; }
    const x = puSellers(sh._where).find((y) => y.name === v); if (!x) return;
    $('[name=vendor]', sh).value = ''; $('[name=vendorPhone]', sh).value = x.phone || '';
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
      if (p) { r.category = p.category || r.category; r.subcategory = p.subcategory || ''; r.condition = p.condition || 'New'; r.unit = p.unit || ''; r.size = p.size ?? null; r.sizeUnit = p.sizeUnit || ''; }
    }
    totals();
  };
  sh.addEventListener('input', onField); sh.addEventListener('change', onField);
  sh.addEventListener('keydown', (e) => { // Enter in a price → next item
    if (e.key !== 'Enter' || !e.target.matches || !e.target.matches('[data-f=unitCost],[data-f=qty]')) return;
    e.preventDefault(); const i = +e.target.closest('tr').dataset.r;
    if (i === sh._rows.length - 1) { sh._rows.push(puRow()); sh._draw(); }
    const ins = $$('#puRows [data-f=name]', sh); if (ins[i + 1]) ins[i + 1].focus();
  });
  $('#puTax', sh).addEventListener('input', totals);
  $('#puSrc', sh).addEventListener('change', (e) => { if (e.target.value === 'Local (Cameroon)') sh._setWhere('local'); });
  $('#puCur', sh).addEventListener('change', () => { setPayCurrency(sh, cur()); totals(); });
  sh._setWhere('abroad');
  sh._sums = sums;
  $('#puSave', sh).onclick = async () => {
    const h = formVals($('#puHead', sh)); const pv = formVals($('#puPay', sh).parentNode); pv.payStatus = sh._paid === 'credit' ? 'credit' : 'paid';
    h.vendor = h.vendorPick && h.vendorPick !== '__new' ? h.vendorPick : (h.vendor || '').trim(); delete h.vendorPick;
    if (!h.vendor) { toast('Choose the seller (or add a new one)', true); $('#puSeller', sh).focus(); return; }
    if (sh._paid === 'paid') { pv.payAmount = ''; pv.payDate = h.purchaseDate; }
    if (sh._paid === 'part' && !(num(pv.payAmount) > 0)) { toast('Type how much you paid', true); const a = $('#payAmount', sh); if (a) a.focus(); return; }
    const rows = sh._rows.filter((r) => r.name.trim() || num(r.unitCost));
    if (!rows.length) { toast('Add at least one item', true); const n = $('[data-f=name]', sh); if (n) n.focus(); return; }
    const bad = rows.findIndex((r) => !r.name.trim() || !(num(r.qty) > 0) || r.unitCost === '');
    if (bad >= 0) { const r = rows[bad]; toast(!r.name.trim() ? 'Item ' + (bad + 1) + ': type the item name' : !(num(r.qty) > 0) ? r.name + ': quantity must be more than 0' : r.name + ': enter the price (0 if free)', true); return; }
    const s = sums();
    if (s.tax < 0) return toast('Tax cannot be negative', true);
    const shares = KC.allocTax(rows.map((r) => ({ unitCost: num(r.unitCost), qty: num(r.qty) })), s.tax);
    const lines = rows.map((r, i) => {
      const pack = Math.max(1, Math.floor(num(r.packOf) || 1)); const qty = Math.floor(num(r.qty)) * pack;
      return { name: r.name.trim(), category: r.category, subcategory: r.subcategory || subOpts(r.category)[0] || '', condition: r.condition, working: r.working, unit: r.unit, size: r.size, sizeUnit: r.sizeUnit,
        regularPrice: num(r.regularPrice) ? num(r.regularPrice) / pack : null, unitCost: num(r.unitCost) / pack, unitTax: qty ? shares[i] / qty : 0, qty,
        expiry: r.expiry, barcode: r.barcode, reservedFor: r.reservedFor || '', notes: [r.notes, pack > 1 ? 'Bought ' + Math.floor(num(r.qty)) + ' pack(s) of ' + pack : ''].filter(Boolean).join(' · '), photo: r.photo };
    });
    const credit = pv.payStatus === 'credit';
    let pay = null;
    if (!credit) { // check the payment before saving anything, so a missing MoMo txn ID never leaves a half-saved purchase
      if (String(pv.payAmount || '').trim() === '') pv.payAmount = s.total;
      pay = readPayment(pv, 'purchase'); if (pay === false) return;
    }
    Object.assign(h, { shipmentId: h.where === 'local' ? '__local' : '', purchaseTxnId: KC.newTxnId('PU', h.purchaseDate) });
    await savePurchaseLines(h, lines);
    if (credit || pay) {
      await createBillFor({ txnId: h.purchaseTxnId, payment: pay, supplierId: (K.raw.suppliers.find((x) => x.name.toLowerCase() === (h.vendor || '').toLowerCase()) || {}).id, newSupplier: h.vendor || h.sourceType || 'Seller', newSupplierType: SELLER_SUP_TYPE[h.sourceType] || 'Other', description: 'Purchase ' + (h.poNumber ? '#' + h.poNumber + ' ' : '') + fmtDate(h.purchaseDate) + (s.tax ? ' (tax ' + money(s.tax, h.currency) + ')' : ''), amount: s.total, currency: h.currency || 'USD', date: h.purchaseDate, dueDate: sh._paid === 'paid' ? h.purchaseDate : pv.payBy });
    }
    closeSheet(); scheduleRender();
    toast(lines.length + ' item' + (lines.length === 1 ? '' : 's') + ' saved' + (h.where === 'local' ? ' · in stock now' : ' · waiting to ship') + (credit ? ' · bill created' : pay && pay.amount < s.total - 0.005 ? ' · part paid, rest added to bills' : ''));
  };
  setTimeout(() => { const v = $('#puSeller', sh); if (v && matchMedia('(min-width: 900px)').matches) v.focus(); }, 60);
}
const puSheet = (el) => el.closest('.scrim');
A.puWhere = (el) => puSheet(el)._setWhere(el.dataset.v);
A.puPaid = (el) => {
  const sh = puSheet(el); const v = el.dataset.v; sh._paid = v; $$('#puPaidSeg button', sh).forEach((b) => b.classList.toggle('on', b === el));
  $('#puPay', sh).classList.toggle('hide', v === 'credit'); $('#puPayBy', sh).classList.toggle('hide', v !== 'part' && v !== 'credit');
  $('#payBox > .grid2', sh).classList.toggle('hide', v !== 'part');
  const a = $('#payAmount', sh); if (a) { a.value = ''; if (v === 'part') a.focus(); } syncPayCharges(sh);
};
A.puAdd = (el) => { const sh = puSheet(el); sh._rows.push(puRow()); sh._draw(); const ins = $$('[data-f=name]', sh); ins[ins.length - 1].focus(); };
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
    name: String(pickCol(r, ['Description', 'Item Description', 'Product Name', 'Title', 'Item', 'Name'])).trim(), category: String(pickCol(r, ['Category', 'Department'])), subcategory: String(pickCol(r, ['Subcategory', 'Sub Category', 'Class'])),
    condition: (() => { const c = String(pickCol(r, ['Condition', 'Grade'])).toLowerCase(); return !c ? 'New' : /open|box/.test(c) ? 'Open box' : /refurb/.test(c) ? 'Refurbished' : /damag|part|salvage/.test(c) ? 'Damaged / Parts' : /used|return/.test(c) ? 'Used' : 'New'; })(),
    regularPrice: num(pickCol(r, ['Regular Price', 'Shelf Price', 'Retail Price', 'MSRP', 'Unit Retail', 'Ext Retail'])) || '', unitCost: pickCol(r, ['Price Paid', 'Price Each', 'Unit Cost', 'Cost', 'Price']), qty: Math.floor(num(pickCol(r, ['Quantity', 'Qty', 'Units']))) || 1,
    expiry: xlDate(pickCol(r, ['Expiry Date', 'Expiry', 'Expiration'])), barcode: String(pickCol(r, ['Barcode', 'UPC', 'EAN'])), notes: String(pickCol(r, ['Notes'])),
    unit: String(pickCol(r, ['Unit', 'Sold By'])), size: num(pickCol(r, ['Size', 'Weight'])) || null, sizeUnit: String(pickCol(r, ['Size Unit', 'Weight Unit'])), packOf: Math.max(1, Math.floor(num(pickCol(r, ['Pack Of', 'Units Per Pack', 'Pack'])) || 1)),
    tax: pickCol(r, ['Tax', 'Tax Rate', 'Tax %']),
  })).filter((l) => l.name);
  lines.forEach((l) => {
    if (!KC.SIZE_UNITS[l.sizeUnit]) { const mm = { kgs: 'kg', lbs: 'lb', ounce: 'oz', liter: 'L', litre: 'L', l: 'L', ml: 'mL', gallon: 'gal', floz: 'fl oz' }[String(l.sizeUnit).toLowerCase().replace(/[^a-z]/g, '')]; l.sizeUnit = mm || ''; }
    if (!catOpts().includes(l.category)) { l.notes = [l.notes, l.category && 'Cat: ' + l.category].filter(Boolean).join(' · '); l.category = /tv|speaker|audio|laptop|phone|electr|computer|tablet/i.test(l.name + l.category) ? (catOpts().includes('Electronics') ? 'Electronics' : defCat()) : (catOpts().includes('Other') ? 'Other' : defCat()); l.subcategory = subOpts(l.category)[0] || ''; }
  });
  return lines;
}
A.puImport = async (el) => {
  const sh = puSheet(el);
  if (!window.XLSX) return toast('Excel library still loading — try again in a moment', true);
  const f = await pickFile('.xlsx,.xls,.csv'); if (!f) return;
  let lines;
  try { const wb = await readSheet(f); const ws = wb.Sheets[wb.SheetNames.find((n) => /purch|manifest|item/i.test(n)) || wb.SheetNames[0]]; lines = parsePurchaseRows(XLSX.utils.sheet_to_json(ws, { defval: '' })); }
  catch (e) { return toast('Could not read this file: ' + e.message, true); }
  if (!lines.length) return toast('No item rows found. Use the template column names.', true);
  const head = $('#puHead', sh); const setIf = (n, v) => { const i = $('[name=' + n + ']', head); if (i && v && (!i.value || (n === 'purchaseDate' && i.value === todayStr()))) i.value = v; };
  const f0 = lines[0];
  const pick = $('#puSeller', sh);
  if (f0.vendor && !pick.value) { // the file names the seller: pick them, or open "New seller" with the name filled in
    const known = [...pick.options].find((o) => o.value.toLowerCase() === f0.vendor.toLowerCase() && o.value !== '__new');
    if (known) pick.value = known.value; else { pick.value = '__new'; $('#puNewSel', sh).classList.remove('hide'); setIf('vendor', f0.vendor); }
  } setIf('poNumber', f0.poNumber); setIf('purchaseDate', f0.purchaseDate);
  if (f0.sourceType && KC.SOURCE_TYPES.includes(f0.sourceType)) $('#puSrc', sh).value = f0.sourceType; else if (/b-?stock|auction/i.test(f0.vendor)) $('#puSrc', sh).value = 'Auction';
  const taxCol = lines.map((l) => String(l.tax).replace('%', '')).find((t) => num(t) > 0); if (taxCol && !$('#puTax', sh).value) $('#puTax', sh).value = taxCol;
  sh._rows = sh._rows.filter((r) => r.name.trim()).concat(lines.map((l) => puRow({ name: l.name, category: l.category, subcategory: l.subcategory, qty: String(l.qty), unitCost: l.unitCost === '' ? '' : String(num(l.unitCost)), condition: l.condition, regularPrice: l.regularPrice === '' ? '' : String(l.regularPrice), packOf: String(l.packOf), expiry: l.expiry, barcode: l.barcode, notes: l.notes, unit: l.unit, size: l.size, sizeUnit: l.sizeUnit })));
  sh._draw();
  const noPrice = lines.filter((l) => l.unitCost === '').length;
  toast(lines.length + ' item' + (lines.length === 1 ? '' : 's') + ' imported' + (noPrice ? ' · ' + noPrice + ' without a price' : '') + ' — check them, then save');
};
A.tplPurch = () => xlsxDownload('Purchase-template.xlsx', { Purchases: [
  { Date: todayStr(), 'Bought From': 'Store', Seller: 'Costco', Receipt: '', Description: 'Quaker Oats Old Fashioned 2x2.6kg', Category: 'Food & Snacks', Subcategory: 'Cereal & Oats', Condition: 'New', 'Shelf Price': 12.99, 'Price Each': 9.98, Quantity: 10, 'Pack Of': 1, Unit: 'pack', Size: 2.6, 'Size Unit': 'kg', 'Expiry Date': '2027-06-30', Barcode: '', 'Tax %': 8.25, Notes: '' },
  { Date: todayStr(), 'Bought From': 'Store', Seller: 'Costco', Receipt: '', Description: 'Kirkland Olive Oil 2L', Category: 'Food & Snacks', Subcategory: '', Condition: 'New', 'Shelf Price': 24.99, 'Price Each': 19.99, Quantity: 6, 'Pack Of': 1, Unit: 'bottle', Size: 2, 'Size Unit': 'L', 'Expiry Date': '', Barcode: '', 'Tax %': '', Notes: '' },
] });

/* ================= 2 · SHIP ================= */
VIEWS.ship = {
  render() {
    const wait = waitingLots().sort((a, b) => (a.purchaseDate || '').localeCompare(b.purchaseDate || ''));
    const waitU = wait.reduce((a, l) => a + num(l.qty), 0);
    const active = shipsIn('ship').sort((a, b) => stIdx(b.status) - stIdx(a.status) || (b.createdAt || '').localeCompare(a.createdAt || ''));
    const later = K.raw.shipments.filter((s) => KC.shipPhase(s.status) !== 'ship').sort((a, b) => (b.receivedAt || b.arrivedAt || b.createdAt || '').localeCompare(a.receivedAt || a.arrivedAt || a.createdAt || ''));
    const waitVal = wait.reduce((a, l) => a + K.C.lotX[l.id].paidX * num(l.qty), 0);
    return '' +
      '<div class="toolbar mb"><button class="btn pri" data-a="newShip">' + ic('plus') + 'New shipment</button></div>' +
      '<section class="card flow-card mb2"><div class="home-card-h"><h2>Waiting to ship</h2><span class="hint">' + (waitU ? fmt(waitU) + ' units · ' + wait.length + ' line' + (wait.length === 1 ? '' : 's') + (seeCost() ? ' · ' + F(waitVal) : '') : '') + '</span></div>' +
        (wait.length ? '<div class="mini-list">' + wait.slice(0, 6).map((l) => { const p = byId('products', l.productId) || {}; return '<div class="mini"><div class="grow"><div class="mini-t">' + esc(p.name || '?') + '</div><div class="mini-d">' + esc([l.vendor, fmtDate(l.purchaseDate)].filter(Boolean).join(' · ')) + '</div></div><div class="mini-v">×' + fmt(l.qty) + '</div></div>'; }).join('') + (wait.length > 6 ? '<div class="hint pad-x">…and ' + (wait.length - 6) + ' more</div>' : '') + '</div>' +
          '<div class="pad row wrap">' + (active.length ? active.slice(0, 3).map((s) => '<button class="btn" data-a="shAddItems" data-id="' + s.id + '">' + ic('plus', 'sm') + 'Add to ' + esc(s.name || s.containerNo || 'shipment') + '</button>').join('') : '<button class="btn pri" data-a="newShip">' + ic('plus') + 'Start a shipment with them</button>') + '</div>'
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
  if (to === 'received') return A.rcvCount(el);
  const dk = { at_port: 'arrivedAt', cleared: 'clearedAt', closed: 'readyAt' }[to];
  const o = Object.assign({}, s, { status: to }); if (dk) o[dk] = todayStr();
  if (await save('shipments', o)) { refreshSheets(); scheduleRender(); toast((s.name || 'Shipment') + ': ' + KC.SHIP_STATUSES[stIdx(to)][1].toLowerCase()); }
};
A.rcvCount = (el) => openShip(el.dataset.id, 'recv');
A.rcvLabels = (el) => { const ids = [...new Set(K.raw.lots.filter((l) => l.shipmentId === el.dataset.id).map((l) => l.productId))]; if (!ids.length) return toast('No items in this shipment', true); labelsSheet(ids); };
