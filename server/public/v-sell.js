/* Kargo — Point of sale, sales list, receipts, payments, returns */

/* ---------- POS ---------- */
function editingExtra() {
  const ex = {}; const s = K.cart.editingId && byId('sales', K.cart.editingId);
  if (s && s.status !== 'cancelled' && (s.locationId || 'main') === K.loc) (s.lines || []).forEach((ln) => { (ln.alloc || []).forEach((a) => (ex[a.lotId] = (ex[a.lotId] || 0) + num(a.qty))); (ln.returns || []).forEach((r) => r.restock && (r.alloc || []).forEach((a) => (ex[a.lotId] = (ex[a.lotId] || 0) - num(a.qty)))); });
  return ex;
}
function availFor(pid, cust) {
  const px = K.C.prodX[pid]; if (!px) return 0;
  if (cust === undefined) cust = K.cart.customerId;
  const ex = editingExtra(); let n = 0;
  px.lotIds.forEach((id) => { const l = K.C.lotById[id]; if (!l) return; n += Math.max(0, KC.lotCap(K.C, l, cust, K.loc)) + ((!l.reservedFor || l.reservedFor === cust) ? num(ex[id]) : 0); });
  return n;
}
const heldForCart = (pid) => { const c = K.cart.customerId; const px = K.C.prodX[pid]; return !!(c && px && px.lotIds.some((id) => { const l = K.C.lotById[id]; return l && l.reservedFor === c && K.C.lotX[id].clientAvail > 0; })); };
function creditInfo(cu, extraDue) {
  if (!cu) return null; const lim = KC.creditLimitOf(S(), cu); const owed = KC.customerBalance(K.raw, K.C, cu.id);
  return { lim, owed, avail: lim === null ? null : lim - owed - (extraDue || 0) };
}
const cartQty = (pid) => { const l = K.cart.lines.find((x) => x.productId === pid); return l ? num(l.qty) : 0; };
const cartCust = () => K.cart.customerId && byId('customers', K.cart.customerId);
function reprice(l) { if (!l.manual) l.unitPrice = KC.autoPrice(K.C, l.productId, l.qty, cartCust()); }
const isWsLine = (l) => { const px = K.C.prodX[l.productId]; return px && num(l.unitPrice) === px.priceWholesale && px.priceWholesale < px.priceMax; };
const cartTotal = () => K.cart.lines.reduce((a, l) => a + num(l.qty) * num(l.unitPrice), 0);
const cartCount = () => K.cart.lines.reduce((a, l) => a + num(l.qty), 0);

function posProducts() {
  const q = K.ui.posQ.toLowerCase(), cat = K.ui.posCat;
  return K.raw.products.filter((p) => !p.archived && (availFor(p.id) > 0 || cartQty(p.id) > 0))
    .filter((p) => !cat || p.category === cat)
    .filter((p) => !q || (p.name + ' ' + (p.subcategory || '') + ' ' + (p.barcode || '') + ' ' + (p.category || '')).toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function gridHTML() {
  const ps = posProducts();
  if (!ps.length) return '<div class="card empty" style="grid-column:1/-1"><div class="big">📦</div>' + (K.raw.products.length ? (allLocs().length > 1 ? 'Nothing in stock at ' + esc(locName(K.loc)) + ' matches. Check another location or make a transfer.' : 'No items in stock match your search.') : 'No stock yet. Add purchases, then mark the container as received.') + (can('purchases') ? '<div class="mt"><a class="btn pri" href="#buy">' + ic('plus') + 'Add purchases</a></div>' : '') + '</div>';
  return ps.map((p) => {
    const px = K.C.prodX[p.id], q = cartQty(p.id), av = availFor(p.id);
    const src = imgSrc(p.image);
    return '<div class="pt' + (q ? ' incart' : '') + (av - q <= 0 ? ' out' : '') + '" data-a="addCart" data-id="' + p.id + '">' + (q ? '<div class="q" style="z-index:2">' + q + '</div>' : '') +
      (src ? '<div class="pimg"><img src="' + esc(src) + '" alt="" loading="lazy"></div>' : '<div class="pimg ph">' + esc(initials(p.name)) + '</div>') +
      '<div class="nm">' + esc(p.name) + '</div>' + (KC.sizeLabel(p) ? '<div class="tiny muted">' + esc(KC.sizeLabel(p)) + '</div>' : '') + '<div class="row gap6 wrap">' + (p.condition && p.condition !== 'New' ? '<span class="badge acc">' + esc(p.condition) + '</span>' : '') + (heldForCart(p.id) ? '<span class="badge info">Client order</span>' : '') + (px.nextExpiry && daysUntil(px.nextExpiry) <= (num(S().expiryWarnDays) || 60) ? expiryBadge(px.nextExpiry) : '') + '</div>' +
      '<div class="pr money">' + F(px.priceMax) + '</div><div class="st">' + fmt(av - q) + ' in stock</div></div>';
  }).join('');
}
function cartHTML(inSheet) {
  const c = K.cart; const cu = c.customerId && byId('customers', c.customerId);
  const lines = c.lines.map((l, i) => {
    const px = K.C.prodX[l.productId] || {}; const p = byId('products', l.productId) || { name: l.name };
    const price = num(l.unitPrice); let warn = '';
    if (seeCost() && px.avgCost && price < px.avgCost) warn = '<div class="tiny" style="color:var(--bad)">Below cost (' + fmt(px.avgCost) + ')</div>';
    else if (price < KC.priceFloor(K.C, l.productId, l.qty, cartCust())) warn = '<div class="tiny" style="color:' + (can('discount') ? 'var(--warn)' : 'var(--bad)') + '">Below minimum ' + fmt(KC.priceFloor(K.C, l.productId, l.qty, cartCust())) + (can('discount') ? '' : ' — not allowed') + '</div>';
    if (isWsLine(l)) warn += '<div class="tiny" style="color:var(--info)">Wholesale price' + (KC.isWholesale(cartCust()) ? '' : ' (bulk ' + px.bulkQty + '+)') + '</div>';
    return '<div class="cl"><div class="row between">' + thumb(p, 34, 8) + '<div class="grow b ellipsis">' + esc(p.name) + '</div><button class="icon-btn" data-a="cartDel" data-i2="' + i + '">' + ic('trash', 'sm') + '</button></div>' +
      '<div class="row between mt" style="margin-top:6px"><div class="stepper"><button data-a="cartStep" data-i2="' + i + '" data-d="-1">−</button><input inputmode="numeric" value="' + l.qty + '" data-i="cartQty" data-i2="' + i + '"><button data-a="cartStep" data-i2="' + i + '" data-d="1">+</button></div>' +
      '<div class="row gap6"><span class="tiny faint">@</span><input class="inp price-in" inputmode="numeric" value="' + l.unitPrice + '" data-i="cartPrice" data-i2="' + i + '"></div></div>' +
      '<div class="row between"><div>' + warn + (price !== num(px.priceMax) ? '<div class="tiny faint">Usual price ' + fmt(px.priceMax) + '</div>' : '') + '</div><div class="b money" data-lt="' + i + '">' + F(num(l.qty) * price) + '</div></div></div>';
  }).join('');
  return '<div class="' + (inSheet ? '' : 'card pad') + '">' +
    (inSheet ? '' : '<div class="row between mb"><h2>Cart</h2>' + (c.lines.length ? '<button class="btn sm ghost" data-a="cartClear">Clear</button>' : '') + '</div>') +
    (c.editingId ? '<div class="alert info mb">' + ic('edit', 'sm') + '<div>Editing sale ' + esc((byId('sales', c.editingId) || {}).no || '') + '. <a href="#" data-a="cartClear">Stop editing</a></div></div>' : '') +
    '<div class="cust-pill mb" data-a="pickCustomer">' + (cu ? '<div class="av">' + esc(initials(cu.name)) + '</div><div class="grow"><div class="b">' + esc(cu.name) + '</div><div class="tiny muted">' + esc(cu.phone || cu.whatsapp || '') + creditTag(cu) + '</div></div>' : '<div class="av">' + ic('users', 'sm') + '</div><div class="grow b">Select or add customer</div>') + ic('chev', 'sm') + '</div>' +
    (c.lines.length ? lines : '<div class="empty small">Tap items to add them here.</div>') +
    (c.lines.length ? '<hr class="sep"><div class="row between"><span class="muted">' + cartCount() + ' item(s)</span><span class="b money" style="font-size:20px" data-ct>' + F(cartTotal()) + '</span></div><button class="btn pri lg block mt" data-a="checkout">Continue to payment ' + ic('chev') + '</button>' : '') + '</div>';
}
function refreshPOS() {
  if (K.route !== 'sell') return;
  const g = $('#pgrid'); if (g) g.innerHTML = gridHTML();
  const cb = $('#cartbox'); if (cb) cb.innerHTML = cartHTML();
  const pc = $('#posCust'); if (pc) pc.innerHTML = posCustBar();
  const bar = $('#cartbar'); if (bar) { bar.classList.toggle('hide', !K.cart.lines.length); bar.innerHTML = '<div class="av" style="background:var(--accent);color:var(--ink)">' + cartCount() + '</div><div class="grow"><div class="b">View cart</div><div class="tiny" style="color:#aab6c2">' + K.cart.lines.length + ' product(s)</div></div><div class="b money" style="font-size:18px">' + F(cartTotal()) + '</div>'; }
  const sh = K.sheets.find((s) => s._cart); if (sh) setSheetBody(sh, cartHTML(true));
  saveCart();
}
VIEWS.sell = {
  render() {
    const cats = [...new Set(K.raw.products.filter((p) => availFor(p.id) > 0).map((p) => p.category).filter(Boolean))].sort();
    return '<div class="pos"><div><div class="row mb gap6 pos-cust" id="posCust">' + posCustBar() + '</div><div class="search mb">' + ic('search') + '<input class="inp" id="posQ" placeholder="Search item or scan barcode…" value="' + esc(K.ui.posQ) + '" data-i="posQ" autocomplete="off"></div>' +
      (cats.length > 1 ? '<div class="chips mb"><button class="chip' + (!K.ui.posCat ? ' on' : '') + '" data-a="posCat" data-v="">All</button>' + cats.map((c) => '<button class="chip' + (K.ui.posCat === c ? ' on' : '') + '" data-a="posCat" data-v="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>' : '') +
      '<div class="pgrid" id="pgrid">' + gridHTML() + '</div></div><div class="cartbox" id="cartbox">' + cartHTML() + '</div></div><div class="cartbar hide" id="cartbar" data-a="openCart"></div>';
  },
  after() {
    refreshPOS();
    const q = $('#posQ');
    q.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = q.value.trim(); if (!v) return;
      const p = K.raw.products.find((x) => x.barcode && x.barcode === v) || (posProducts().length === 1 ? posProducts()[0] : null);
      if (p) { addToCart(p.id); q.value = ''; K.ui.posQ = ''; refreshPOS(); } else toast('No item with that code', true);
    });
  },
};
I.posQ = (el) => { K.ui.posQ = el.value; const g = $('#pgrid'); if (g) g.innerHTML = gridHTML(); };
A.posCat = (el) => { K.ui.posCat = el.dataset.v; render(true); };
function addToCart(pid) {
  const p = byId('products', pid); if (!p) return;
  const l = K.cart.lines.find((x) => x.productId === pid);
  if (cartQty(pid) + 1 > availFor(pid)) { toast('Only ' + availFor(pid) + ' in stock', true); return; }
  if (l) { l.qty = num(l.qty) + 1; reprice(l); } else { const nl = { productId: pid, name: p.name, qty: 1, unitPrice: 0 }; reprice(nl); K.cart.lines.push(nl); }
  if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) { }
  refreshPOS();
}
A.addCart = (el) => addToCart(el.dataset.id);
A.cartStep = (el) => { const l = K.cart.lines[+el.dataset.i2]; const n = num(l.qty) + num(el.dataset.d); if (n > availFor(l.productId)) return toast('Only ' + availFor(l.productId) + ' in stock', true); if (n <= 0) K.cart.lines.splice(+el.dataset.i2, 1); else { l.qty = n; reprice(l); } refreshPOS(); };
A.cartDel = (el) => { K.cart.lines.splice(+el.dataset.i2, 1); refreshPOS(); };
A.cartClear = () => { K.cart = { lines: [], customerId: null, editingId: null, discount: 0 }; saveCart(); refreshPOS(); };
function liveCartTotals(el, i) {
  const root = el.closest('.sheet') || document; const l = K.cart.lines[i];
  const lt = $('[data-lt="' + i + '"]', root); if (lt) lt.textContent = F(num(l.qty) * num(l.unitPrice));
  $$('[data-ct]').forEach((x) => (x.textContent = F(cartTotal()))); saveCart();
}
I.cartQty = (el) => { const i = +el.dataset.i2, l = K.cart.lines[i]; let n = Math.max(0, Math.floor(num(el.value))); const av = availFor(l.productId); if (n > av) { n = av; el.value = av; toast('Only ' + av + ' in stock', true); } l.qty = n; const before = l.unitPrice; reprice(l); if (before !== l.unitPrice) { const pi = $('[data-i="cartPrice"][data-i2="' + i + '"]', el.closest('.sheet') || document); if (pi) pi.value = l.unitPrice; } liveCartTotals(el, i); };
I.cartPrice = (el) => { const i = +el.dataset.i2; K.cart.lines[i].unitPrice = Math.max(0, num(el.value)); K.cart.lines[i].manual = true; liveCartTotals(el, i); };
A.openCart = () => { const s = openSheet({ title: 'Cart', body: cartHTML(true), onClose: () => refreshPOS() }); s._cart = true; };

/* ---------- customers picker ---------- */
function pickCustomer(cb) {
  const list = (q) => K.raw.customers.filter((c) => !q || (c.name + ' ' + (c.phone || '') + ' ' + (c.whatsapp || '')).toLowerCase().includes(q.toLowerCase())).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 40)
    .map((c) => '<div class="li" data-a="custPick" data-id="' + c.id + '"><div class="av">' + esc(initials(c.name)) + '</div><div class="grow"><div class="t">' + esc(c.name) + '</div><div class="tiny muted">' + esc([c.phone, c.city].filter(Boolean).join(' · ')) + '</div></div></div>').join('') || '<div class="empty small">No customer found.</div>';
  const el = openSheet({ title: 'Customer', body: '<button class="btn pri block mb" data-a="custNewInline">' + ic('plus') + 'New customer</button><button class="btn block mb" data-a="custWalkin">Walk-in (no name)</button><div class="search mb">' + ic('search') + '<input class="inp" id="cq" placeholder="Search name or phone"></div><div class="card list" id="clist">' + list('') + '</div>' });
  el._cb = cb;
  $('#cq', el).addEventListener('input', (e) => ($('#clist', el).innerHTML = list(e.target.value)));
}
A.pickCustomer = () => pickCustomer((id) => { K.cart.customerId = id; K.cart.lines.forEach(reprice); refreshPOS(); refreshSheets(); const c = cartCust(); if (KC.isWholesale(c)) toast('Wholesale prices applied for ' + c.name); });
A.custPick = (el) => { const s = K.sheets[K.sheets.length - 1]; const cb = s._cb; closeSheet(); cb && cb(el.dataset.id); };
A.custWalkin = () => { const s = K.sheets[K.sheets.length - 1]; const cb = s._cb; closeSheet(); cb && cb(null); };
A.custNewInline = () => { const s = K.sheets[K.sheets.length - 1]; const cb = s._cb; closeSheet(); editCustomer(null, (id) => cb && cb(id)); };
function editCustomer(id, after) {
  const c = id ? byId('customers', id) : {};
  const el = openSheet({
    title: id ? 'Edit customer' : 'New customer',
    body: '<div class="col">' + field('Full name *', inp('name', c.name, 'autocomplete="off"')) +
      '<div class="grid2">' + field('Phone *', inp('phone', c.phone, 'inputmode="tel" placeholder="6XX XXX XXX"')) + field('WhatsApp', inp('whatsapp', c.whatsapp, 'inputmode="tel" placeholder="Same as phone if empty"')) + '</div>' +
      '<div class="grid2">' + field('Email (optional)', inp('email', c.email, 'inputmode="email"')) + field('Town / area', inp('city', c.city)) + '</div>' +
      '<div class="grid2">' + field('Customer type', sel('type', ['Retail', 'Wholesale', 'Reseller'], c.type || 'Retail')) + field('Credit limit (F)', inp('creditLimit', c.creditLimit ?? '', 'inputmode="numeric" placeholder="' + (S().defaultCreditLimit !== undefined && S().defaultCreditLimit !== '' && S().defaultCreditLimit !== null ? 'Default ' + fmt(S().defaultCreditLimit) : 'No limit') + '"' + (can('credit') || can('settings') ? '' : ' disabled'))) + '</div>' + field('Notes', '<textarea class="inp" name="notes">' + esc(c.notes || '') + '</textarea>') + '</div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="cSave">Save customer</button>',
  });
  $('#cSave', el).onclick = async () => {
    const v = formVals(el);
    if (!v.name) return toast('Enter the customer name', true);
    const dupe = v.phone && K.raw.customers.find((x) => x.id !== id && phoneWA(x.phone) === phoneWA(v.phone));
    if (dupe && !(await confirmBox('A customer with this phone already exists (' + dupe.name + '). Save anyway?', 'Save anyway'))) return;
    if (!(can('credit') || can('settings'))) delete v.creditLimit; else v.creditLimit = v.creditLimit === '' ? null : num(v.creditLimit);
    const obj = Object.assign({}, c, v, { id: id || uid('c_') });
    if (!obj.whatsapp) obj.whatsapp = obj.phone;
    if (await save('customers', obj)) { closeSheet(); toast('Customer saved'); after && after(obj.id); scheduleRender(); }
  };
}

/* ---------- item condition on each sale line ---------- */
const lineCond = (l) => l.condition || (byId('products', l.productId) || {}).condition || 'New';
const lineWork = (l) => l.working || 'Working';
/** 'Used · Not tested' — only when it is worth saying (anything other than new & working). */
const itemNote = (l) => (lineCond(l) === 'New' && lineWork(l) === 'Working') ? '' : lineCond(l) + ' · ' + lineWork(l);
function cartConditionFields(bare) {
  if (!K.cart.lines.length) return '';
  const opt = (list, v) => list.map((o) => '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>').join('');
  return (bare ? '' : '<h3 class="mt">Items — condition</h3>') + '<div class="' + (bare ? '' : 'card pad ') + 'col" style="gap:8px">' + K.cart.lines.map((l, i) =>
    '<div><div class="b small ellipsis">' + esc(l.name) + ' <span class="muted">× ' + fmt(l.qty) + '</span></div><div class="grid2" style="margin-top:4px">' +
    '<select class="inp" data-lc="' + i + '" data-k="condition" aria-label="Condition of ' + esc(l.name) + '">' + opt(KC.CONDITIONS, lineCond(l)) + '</select>' +
    '<select class="inp" data-lc="' + i + '" data-k="working" aria-label="Is ' + esc(l.name) + ' working?">' + opt(KC.WORKING, lineWork(l)) + '</select></div></div>').join('') + '</div>';
}
document.addEventListener('change', (e) => { const t = e.target; if (!t.dataset || t.dataset.lc === undefined) return; const l = K.cart.lines[+t.dataset.lc]; if (l) { l[t.dataset.k] = t.value; saveCart(); } });

/* ---------- shared payment form (sales AND purchases) ----------
 * Amount and MoMo/OM charges are separate fields/columns. Every payment carries a mode and a transaction ID
 * (required for MoMo / OM). kind 'sale': Cash / MTN MoMo / Orange Money, money goes to one of our numbers.
 * kind 'purchase': purchase modes, money goes to the supplier. */
const payMethodsFor = (kind) => kind === 'purchase' ? KC.PURCHASE_PAY_METHODS : KC.SALE_PAY_METHODS;
function accountOpts(method) {
  const acc = (S().momoAccounts || []).filter((a) => !a.method || a.method === method);
  return [['', method === 'Cash' ? '—' : 'Select receiving number']].concat(acc.map((a) => [a.number, (a.label ? a.label + ' · ' : '') + a.number]));
}
/** Suggested charges only make sense in local currency (the MoMo tariff grid is in F). */
const payFeeSuggest = (method, amount, cur) => (!cur || cur === baseCode()) ? KC.calcMomoFee(method, amount, S()) : 0;
function payFields(defAmount, opts = {}) {
  const kind = opts.kind || 'sale', cur = opts.currency || baseCode(), sym = esc(curSym(cur));
  const methods = payMethodsFor(kind); const defMethod = methods.indexOf(opts.method) >= 0 ? opts.method : 'Cash';
  const mm = KC.isMobileMoney(defMethod), sale = kind === 'sale';
  const sug = mm ? payFeeSuggest(defMethod, defAmount, cur) : 0;
  return '<div class="col" id="payBox" data-kind="' + kind + '" data-cur="' + esc(cur) + '"><div class="grid2">' + field((sale ? 'Sale amount' : 'Amount paid') + ' (' + sym + ')', inp('payAmount', defAmount, 'inputmode="decimal" id="payAmount"')) + field('Date', inp('payDate', todayStr(), 'type="date"')) + '</div>' +
    field('Payment mode', '<div class="seg" id="pm" style="flex-wrap:wrap">' + methods.map((m) => '<button type="button" class="' + (m === defMethod ? 'on' : '') + '" data-a="pmPick" data-v="' + esc(m) + '">' + esc(m) + '</button>').join('') + '</div><input type="hidden" name="payMethod" value="' + esc(defMethod) + '">') +
    '<div id="pmCharges" class="' + (mm ? '' : 'hide') + '">' +
      '<div class="grid2">' + field('Withdrawal / MoMo charges (' + sym + ')', inp('payFee', sug || '', 'inputmode="decimal" id="payFee" placeholder="0"')) +
        field(sale ? 'Customer sends' : 'You send', '<div class="inp" id="payGross" style="display:flex;align-items:center;background:var(--bg, #f6f6f6)">' + money(num(defAmount) + sug, cur) + '</div>') + '</div>' +
    '</div>' +
    '<div class="grid2' + (defMethod === 'Cash' ? ' hide' : '') + '" id="pmExtra">' +
      (sale ? field('Money sent to (number)', '<select class="inp" name="payAccount" id="payAccount">' + accountOpts(defMethod).map(([v, l]) => '<option value="' + esc(v) + '">' + esc(l) + '</option>').join('') + '<option value="__other">Other number…</option></select>')
        : field('Paid to (number / account)', inp('payAccount', opts.account || '', 'placeholder="Optional"'))) +
      field('Transaction ID', inp('payRef', '', 'id="payRef" placeholder="' + (mm ? 'Required — ' + esc(defMethod) + ' txn ID' : 'Optional ref') + '"')) + '</div>' +
    (sale ? '<div id="payAccOther" class="hide">' + field('Other receiving number', inp('payAccountOther', '', 'inputmode="tel"')) + '</div>' : '') + '</div>';
}
/** Change the label text of a field() wrapper around `input` (label text is the first text node). */
function setFieldLabel(input, text) {
  const f = input && input.closest('label.f'); if (f && f.firstChild && f.firstChild.nodeType === 3) f.firstChild.textContent = text;
}
/** Switch the payment form to another currency (purchase currency changed). */
function setPayCurrency(root, cur) {
  const box = $('#payBox', root); if (!box) return; box.dataset.cur = cur;
  setFieldLabel($('#payAmount', root), (box.dataset.kind === 'sale' ? 'Sale amount' : 'Amount paid') + ' (' + curSym(cur) + ')');
  setFieldLabel($('#payFee', root), 'Withdrawal / MoMo charges (' + curSym(cur) + ')');
  syncPayCharges(root);
}
function syncPayCharges(root) {
  if (!root) return;
  const box = $('#payBox', root); if (!box) return;
  const cur = box.dataset.cur;
  const method = ($('[name=payMethod]', root) || {}).value || 'Cash';
  const mm = KC.isMobileMoney(method);
  const ch = $('#pmCharges', root); if (ch) ch.classList.toggle('hide', !mm);
  const amtEl = $('#payAmount', root), feeEl = $('#payFee', root), gross = $('#payGross', root), refEl = $('#payRef', root);
  if (refEl) refEl.placeholder = mm ? 'Required — ' + method + ' txn ID' : 'Optional ref';
  if (!mm) { if (feeEl) feeEl.value = ''; if (gross) gross.textContent = '—'; return; }
  // an empty amount means "the default" (e.g. total of purchase lines) when the form provides one
  const amount = num(amtEl && (amtEl.value !== '' ? amtEl.value : amtEl.dataset.def));
  if (feeEl && (feeEl.dataset.auto !== '0' || feeEl.value === '')) {
    feeEl.value = payFeeSuggest(method, amount, cur) || '';
    feeEl.dataset.auto = '1';
  }
  if (gross) gross.textContent = money(amount + num(feeEl && feeEl.value), cur);
}
A.pmPick = (el) => {
  const root = el.closest('.sheet'); $$('#pm button', root).forEach((b) => b.classList.toggle('on', b === el));
  $('[name=payMethod]', root).value = el.dataset.v;
  const accSel = $('select#payAccount', root);
  if (accSel) { accSel.innerHTML = accountOpts(el.dataset.v).map(([v, l]) => '<option value="' + esc(v) + '">' + esc(l) + '</option>').join('') + '<option value="__other">Other number…</option>'; const o = $('#payAccOther', root); if (o) o.classList.add('hide'); }
  $('#pmExtra', root).classList.toggle('hide', el.dataset.v === 'Cash'); // cash needs no number or transaction ID
  const feeEl = $('#payFee', root); if (feeEl) feeEl.dataset.auto = '1';
  syncPayCharges(root);
};
CH.payAcc = () => { };
document.addEventListener('change', (e) => { if (e.target.id === 'payAccount') { const r = e.target.closest('.sheet'); const o = $('#payAccOther', r); if (o) o.classList.toggle('hide', e.target.value !== '__other'); } });
document.addEventListener('input', (e) => {
  if (e.target.id === 'payAmount') { const r = e.target.closest('.sheet'); const feeEl = $('#payFee', r); if (feeEl) feeEl.dataset.auto = '1'; syncPayCharges(r); }
  if (e.target.id === 'payFee') { e.target.dataset.auto = '0'; const r = e.target.closest('.sheet'); const gross = $('#payGross', r); const box = $('#payBox', r); if (gross) { const a = $('#payAmount', r) || {}; gross.textContent = money(num(a.value !== '' ? a.value : (a.dataset || {}).def) + num(e.target.value), box ? box.dataset.cur : baseCode()); } }
});
/** Read the payment form. null = no amount entered, false = invalid (toast already shown). */
function readPayment(v, kind = 'sale') {
  const amount = num(v.payAmount); if (!amount) return null;
  const method = v.payMethod || 'Cash';
  const fee = KC.isMobileMoney(method) ? Math.max(0, num(v.payFee)) : 0;
  const p = { id: uid(kind === 'sale' ? 'p_' : 'bp_'), date: v.payDate || todayStr(), method, account: v.payAccount === '__other' ? v.payAccountOther || '' : v.payAccount || '', ref: String(v.payRef || '').trim(), amount, fee, by: K.me.name || K.info.userLabel || '', byId: K.me.id || '', at: new Date().toISOString() };
  const err = KC.validatePayment(p, S(), kind);
  if (err) { toast(err, true); return false; }
  return p;
}
/** A refund goes back the way the customer paid and is linked to the sale's transaction ID. */
function refundPayment(sale, method, amount, why) {
  return { id: uid('p_'), date: todayStr(), method, amount: -Math.abs(num(amount)), fee: 0, ref: KC.saleTxnId(sale), note: why || 'Refund', by: K.me.name || '', byId: K.me.id || '', at: new Date().toISOString() };
}
/** Every sale gets a transaction ID when it is created; it never changes afterwards.
 *  Older sales without one keep their fallback id (same rule as the server). */
function applySaleTxnId(sale, isNew) {
  if (!sale.txnId) sale.txnId = isNew ? KC.newTxnId('TX', sale.date) : KC.saleTxnId(sale);
  return sale;
}

/* ---------- delivery at checkout (kept on the cart so it survives redraws and comes back when editing) ---------- */
const cartDelivery = () => (K.cart.delivery = K.cart.delivery || { mode: 'pickup', payer: 'client_us', status: 'to_send' });
function deliveryFields(d, bare) {
  const opt = (list, v) => list.map(([k, l]) => '<option value="' + k + '"' + (k === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
  const f = (k, label, attrs) => field(label, '<input class="inp" data-dl="' + k + '" value="' + esc(d[k] === undefined || d[k] === null || d[k] === 0 ? '' : d[k]) + '" ' + (attrs || '') + '>');
  const s_ = (k, label, list) => field(label, '<select class="inp" data-dl="' + k + '">' + opt(list, d[k]) + '</select>');
  return (bare ? '' : '<h3 class="mt">Delivery</h3>') + '<div class="col" id="dlBox">' + s_('mode', 'How does the client get the goods?', KC.DELIVERY_MODES) +
    '<div id="dlMore" class="col">' +
      '<div class="grid2"><div data-dlshow="agency courier">' + f('agency', 'Agency / company name', 'placeholder="e.g. General Express"') + '</div>' + f('destination', 'Town / area', 'placeholder="e.g. Bafoussam"') + '</div>' +
      f('address', 'Address / landmark (optional)', 'placeholder="e.g. near the main market"') +
      '<div class="grid2">' + f('recipientName', 'Recipient name', 'placeholder="Who receives the parcel"') + f('recipientPhone', 'Recipient phone', 'inputmode="tel" placeholder="6xx xx xx xx"') + '</div>' +
      '<div class="grid2">' + f('fee', 'Delivery fee (F)', 'inputmode="numeric" placeholder="0"') + s_('payer', 'Who pays the delivery?', KC.DELIVERY_PAYERS) + '</div>' +
      '<div class="grid2">' + s_('status', 'Delivery status', KC.DELIVERY_STATUSES) + f('trackingNo', 'Agency receipt / tracking no.', 'placeholder="Optional"') + '</div>' +
    '</div></div>';
}
/** Show / hide delivery fields for the chosen mode and refresh the totals (goods + delivery fee). */
function syncCheckout(root, setPay) {
  if (!root) return; const d = cartDelivery(); const del = d.mode !== 'pickup';
  const more = $('#dlMore', root); if (more) more.classList.toggle('hide', !del);
  $$('[data-dlshow]', root).forEach((e) => e.classList.toggle('hide', !e.dataset.dlshow.split(' ').includes(d.mode)));
  const pf = $('#pickField', root); if (pf) pf.classList.toggle('hide', del);
  if (del) { // the client is usually the recipient
    const cu = K.cart.customerId && byId('customers', K.cart.customerId);
    [['recipientName', cu && cu.name], ['recipientPhone', cu && (cu.whatsapp || cu.phone)]].forEach(([k, v]) => { const i = $('[data-dl=' + k + ']', root); if (i && !i.value && v) { i.value = v; d[k] = v; } });
  }
  const goods = cartTotal() - num(K.cart.discount); const fee = KC.deliveryFeeDue({ delivery: d });
  const tot = $('#totOut', root); if (tot) tot.textContent = F(goods);
  const fr = $('#dlFeeRow', root); if (fr) { fr.classList.toggle('hide', !fee); $('#dlFeeOut', root).textContent = F(fee); $('#dueRow', root).classList.toggle('hide', !fee); $('#dueOut', root).textContent = F(goods + fee); }
  if (setPay) { const pa = $('#payAmount', root); if (pa) { pa.value = Math.max(0, goods + fee - (root._paid || 0)); const feeEl = $('#payFee', root); if (feeEl) feeEl.dataset.auto = '1'; syncPayCharges(root); } }
  saveCart(); coSummaries(root);
}
['input', 'change'].forEach((t) => document.addEventListener(t, (e) => {
  const k = e.target.dataset && e.target.dataset.dl; if (!k) return;
  const d = cartDelivery(); d[k] = k === 'fee' ? Math.max(0, num(e.target.value)) : e.target.value;
  syncCheckout(e.target.closest('.scrim'), k === 'fee' || k === 'payer' || k === 'mode');
}));
/** Delivery details from the cart, checked. Returns { delivery } or { error }. */
function readCartDelivery() {
  const d = KC.cleanDelivery(cartDelivery()) || { mode: 'pickup' };
  if (d.mode === 'pickup') return { delivery: { mode: 'pickup' } };
  if (!d.destination) return { error: 'Type the town / area to deliver to' };
  if (d.mode === 'agency' && !d.agency) return { error: 'Type the travel agency name' };
  if (!d.recipientName || !d.recipientPhone) return { error: 'Type the recipient name and phone' };
  return { delivery: d };
}


/* ---------- checkout: folded sections with a one-line summary ---------- */
function coSection(key, title, body) {
  const open = !!(K.ui.coOpen || {})[key];
  return '<details class="co-sec" data-sec="' + key + '"' + (open ? ' open' : '') + '><summary><span class="co-t">' + title + '</span><span class="co-s" data-sum="' + key + '"></span><span class="co-x">' + (open ? 'Hide' : 'Change') + '</span></summary><div class="co-body">' + body + '</div></details>';
}
document.addEventListener('toggle', (e) => { const d = e.target; if (!d.matches || !d.matches('details.co-sec')) return; (K.ui.coOpen = K.ui.coOpen || {})[d.dataset.sec] = d.open; const x = d.querySelector('.co-x'); if (x) x.textContent = d.open ? 'Hide' : 'Change'; }, true);
function coSummaries(root) {
  if (!root) return; const set = (k, t) => { const e = $('[data-sum="' + k + '"]', root); if (e) e.textContent = t; };
  const d = cartDelivery();
  if (d.mode === 'pickup') { const v = ($('[name=delivered]', root) || {}).value; set('delivery', 'Pickup at the shop · ' + (v === 'no' ? 'to pick up later' : 'collected now')); }
  else set('delivery', KC.deliveryModeLabel(d.mode).replace(/ \(.*\)/, '') + (d.destination ? ' → ' + d.destination : '') + (num(d.fee) ? ' · fee ' + F(d.fee) : ''));
  const odd = K.cart.lines.filter((l) => itemNote(l));
  set('cond', !odd.length ? 'All new and working' : odd.length + ' item' + (odd.length === 1 ? '' : 's') + ': ' + odd.map((l) => itemNote(l)).filter((v, i, a) => a.indexOf(v) === i).join(', '));
  const sd = ($('[name=saleDate]', root) || {}).value; const note = (($('[name=notes]', root) || {}).value || '').trim();
  set('more', (sd && sd !== todayStr() ? fmtDate(sd) : 'Today') + (note ? ' · note added' : ''));
}
['input', 'change'].forEach((t) => document.addEventListener(t, (e) => { if (e.target.closest && e.target.closest('.co-sec')) coSummaries(e.target.closest('.scrim')); }));

/* ---------- checkout ---------- */
A.checkout = () => {
  if (!K.cart.lines.length) return;
  if (K.cart.lines.some((l) => !num(l.qty))) return toast('Remove lines with quantity 0', true);
  const editing = K.cart.editingId && byId('sales', K.cart.editingId);
  const el = openSheet({ title: editing ? 'Update sale ' + editing.no : 'Payment', body: '', foot: '' });
  el._refresh = () => {
    const cu = K.cart.customerId && byId('customers', K.cart.customerId);
    const sub = cartTotal(), disc = num(K.cart.discount), total = sub - disc;
    const t = editing ? KC.saleTotals(editing) : null;
    const dFee = KC.deliveryFeeDue({ delivery: cartDelivery() });
    el._paid = editing ? t.paid : 0;
    const due = total + dFee - el._paid;
    setSheetBody(el, '<div class="col">' +
      '<div class="cust-pill" data-a="pickCustomer">' + (cu ? '<div class="av">' + esc(initials(cu.name)) + '</div><div class="grow"><div class="b">' + esc(cu.name) + '</div><div class="tiny muted">' + esc(cu.phone || '') + creditTag(cu) + '</div></div>' : '<div class="av">' + ic('users', 'sm') + '</div><div class="grow b">Walk-in customer — tap to select</div>') + ic('chev', 'sm') + '</div>' +
      '<div class="card pad"><div class="row between"><span class="muted">Subtotal (' + cartCount() + ' items)</span><span class="money b">' + F(sub) + '</span></div>' +
      (can('discount') ? '<div class="row between mt"><span class="muted">Discount (F)</span><input class="inp price-in" inputmode="numeric" id="discIn" value="' + (disc || '') + '" placeholder="0"></div>' : '') +
      '<hr class="sep"><div class="row between"><span class="b">Total</span><span class="money b" style="font-size:22px" id="totOut">' + F(total) + '</span></div>' +
      '<div id="dlFeeRow" class="row between small mt hide"><span class="muted">Delivery fee</span><span class="money" id="dlFeeOut"></span></div><div id="dueRow" class="row between b mt hide"><span>Total to pay</span><span class="money" id="dueOut"></span></div>' +
      (editing ? '<div class="row between small mt"><span class="muted">Already paid</span><span class="money">' + F(t.paid) + '</span></div>' : '') + '</div>' +
      (can('payments') ? '<div class="co-pay"><h3>Payment' + (editing ? ' <span class="hint">(additional)</span>' : '') + '</h3><span class="hint">Less than the total = deposit · 0 = unpaid order</span></div>' + payFields(Math.max(0, due)) : '<div class="alert info">The order will be saved unpaid. A cashier records the payment.</div>') +
      coSection('delivery', 'Delivery', '<div id="pickField">' + field('Collected by the customer?', sel('delivered', [['yes', 'Yes — collected now'], ['no', 'No — left at the shop, to pick up later']], editing ? (editing.delivered ? 'yes' : 'no') : 'yes')) + '</div>' + deliveryFields(cartDelivery(), true)) +
      coSection('cond', 'Item condition', cartConditionFields(true)) +
      coSection('more', 'Date, pay-by & note', '<div class="grid2">' + field('Sale date', inp('saleDate', editing ? saleDate(editing) : todayStr(), 'type="date"')) + field('If not fully paid: pay by', inp('dueDate', editing && editing.dueDate ? editing.dueDate : KC.addDays(todayStr(), num(S().creditDays) || 14), 'type="date"')) + '</div>' + field('Note (optional)', inp('notes', editing ? editing.notes : ''))) + '</div>');
    if ($('#discIn', el)) $('#discIn', el).addEventListener('input', (e) => { K.cart.discount = Math.max(0, num(e.target.value)); syncCheckout(el, true); });
    syncPayCharges(el); syncCheckout(el, false); coSummaries(el);
  };
  el._refresh();
  $('.sf', el) || el.querySelector('.sheet').insertAdjacentHTML('beforeend', '<div class="sf"></div>');
  $('.sf', el).innerHTML = '<button class="btn grow" data-a="sheetClose">Back</button><button class="btn pri grow lg" id="doSell">' + ic('check') + (editing ? 'Update sale' : 'Complete sale') + '</button>';
  // loading / double-tap protection is handled centrally (setBusy in app-core.js)
  $('#doSell', el).onclick = () => completeSale(formVals(el));
};
async function completeSale(v) {
  const editing = K.cart.editingId && byId('sales', K.cart.editingId);
  const extra = editingExtra();
  if (!can('discount')) {
    const bad = K.cart.lines.find((l) => num(l.unitPrice) < KC.priceFloor(K.C, l.productId, l.qty, cartCust()));
    if (bad) { toast('Price for ' + bad.name + ' is below the minimum. Ask a manager.', true); return false; }
    K.cart.discount = 0;
  }
  const lines = [];
  for (const l of K.cart.lines) {
    const alloc = KC.allocate(K.C, K.raw.lots, l.productId, num(l.qty), extra, K.cart.customerId, K.loc);
    if (!alloc) { toast('Not enough stock for ' + l.name + ' (' + availFor(l.productId) + ' left)', true); return false; }
    lines.push({ productId: l.productId, name: (byId('products', l.productId) || l).name, qty: num(l.qty), unitPrice: num(l.unitPrice), condition: lineCond(l), working: lineWork(l), alloc, returns: [] });
  }
  const cu = K.cart.customerId && byId('customers', K.cart.customerId);
  const dl = readCartDelivery(); if (dl.error) { toast(dl.error, true); return false; }
  let pay = null;
  if (can('payments')) {
    if (num(v.payAmount)) { pay = readPayment(v); if (pay === false) return false; }
  }
  // what the client must pay = goods + delivery fee (when they pay it to us)
  const total = cartTotal() - num(K.cart.discount) + KC.deliveryFeeDue({ delivery: dl.delivery });
  const alreadyPaid = editing ? KC.saleTotals(editing).paid : 0;
  const remaining = total - alreadyPaid - (pay ? pay.amount : 0);
  if (remaining > 0.5 && !cu) { toast('Select the customer — unpaid and deposit sales need a name and phone number', true); return false; }
  if (remaining > 0.5 && cu) {
    const ci = creditInfo(cu); const prevBal = editing ? Math.max(0, KC.saleTotals(editing).balance) : 0;
    if (ci.lim !== null && ci.owed - prevBal + remaining > ci.lim + 0.5) {
      const msg = cu.name + ' would owe ' + F(ci.owed - prevBal + remaining) + ', above their credit limit of ' + F(ci.lim) + '.';
      if (!can('credit')) { toast(msg + ' Ask a manager, or take more payment.', true); return false; }
      if (!(await confirmBox(msg + ' Allow it anyway?', 'Allow credit'))) return false;
    }
  }
  if (pay && pay.amount > total - (editing ? KC.saleTotals(editing).paid : 0) + 0.5) { if (!(await confirmBox('Payment is more than the amount due. Record anyway?', 'Record'))) return false; }
  const d = new Date();
  const sale = Object.assign({}, editing || {
    id: uid('s_'), no: 'S' + String(d.getFullYear()).slice(2) + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(),
    payments: [], status: 'open', createdBy: K.me.name || K.info.userLabel || '', createdById: K.me.id || '',
  });
  Object.assign(sale, {
    date: v.saleDate || todayStr(), customerId: cu ? cu.id : null, customerName: cu ? cu.name : 'Walk-in customer', customerPhone: cu ? cu.whatsapp || cu.phone || '' : '',
    lines, discount: num(K.cart.discount), notes: v.notes || '', locationId: K.loc,
  });
  // delivery: pickup → "collected?" question; delivery → its status (to send / sent / delivered)
  const prevDl = (editing && editing.delivery) || {}; const now = new Date().toISOString();
  sale.delivery = dl.delivery;
  if (dl.delivery.mode === 'pickup') sale.delivered = v.delivered !== 'no';
  else {
    sale.delivered = dl.delivery.status !== 'to_send';
    if (dl.delivery.status !== 'to_send') sale.delivery.sentAt = prevDl.sentAt || now;
    if (dl.delivery.status === 'delivered') sale.delivery.deliveredAt = prevDl.deliveredAt || now;
  }
  if (K.cart.orderId) sale.orderId = K.cart.orderId;
  if (remaining > 0.5) sale.dueDate = v.dueDate || KC.addDays(sale.date, num(S().creditDays) || 14); else delete sale.dueDate;
  sale.payments = (sale.payments || []).slice(); if (pay) sale.payments.push(pay);
  applySaleTxnId(sale, !editing);
  if (!(await save('sales', sale))) return false;
  if (cu) save('customers', Object.assign({}, cu));
  if (sale.orderId) { const o = byId('orders', sale.orderId); if (o && o.status !== 'done') save('orders', Object.assign({}, o, { status: 'done', saleId: sale.id, saleNo: sale.no, handledBy: K.me.name || '', handledAt: new Date().toISOString() })); }
  K.cart = { lines: [], customerId: null, editingId: null, discount: 0 }; saveCart();
  refreshPOS(); scheduleRender();
  while (K.sheets.length) closeSheet();
  showReceipt(sale.id, true);
  return true;
}

/* ---------- receipt ---------- */
function receiptText(s) {
  const st = S(), t = K.C.saleX[s.id] || KC.saleTotals(s);
  const L = ['*' + st.businessName + '*'];
  if (st.phone) L.push('Tel: ' + st.phone);
  L.push('', 'Receipt: ' + s.no, 'Date: ' + fmtDate(saleDate(s)), 'Customer: ' + s.customerName, '');
  (s.lines || []).forEach((l) => L.push('• ' + l.name + (itemNote(l) ? ' (' + itemNote(l) + ')' : '') + '\n   ' + l.qty + ' × ' + fmt(l.unitPrice) + ' = ' + F(l.qty * l.unitPrice)));
  L.push('');
  if (t.discount) L.push('Subtotal: ' + F(t.subtotal), 'Discount: −' + F(t.discount));
  if (t.returned) L.push('Returned: −' + F(t.returned));
  L.push('*TOTAL: ' + F(t.net) + '*');
  if (t.deliveryFee > 0) L.push('Delivery fee: ' + F(t.deliveryFee), '*TOTAL TO PAY: ' + F(t.due) + '*');
  L.push('Paid: ' + F(t.paid));
  if (t.balance > 0) L.push('*Balance due: ' + F(t.balance) + '*');
  (s.payments || []).forEach((p) => L.push('  ' + fmtDate(p.date) + ' ' + p.method + (p.account ? ' → ' + p.account : '') + (p.ref ? ' · txn ' + p.ref : '') + ': ' + F(p.amount) + (num(p.fee) > 0 ? ' + ' + F(p.fee) + ' charges' : '')));
  if (t.fees > 0) L.push('MoMo charges total: ' + F(t.fees));
  if (t.txnId) L.push('Transaction ID: ' + t.txnId);
  if (KC.isDelivery(s)) L.push('', ...deliveryLines(s)); else L.push('Collected: ' + (s.delivered ? 'Yes' : 'No — to pick up at the shop'));
  if (!s.delivered) L.push('', '⏳ Items reserved — awaiting pickup');
  if (st.receiptFooter) L.push('', st.receiptFooter);
  return L.join('\n');
}
function receiptHTML(s) {
  const st = S(), t = K.C.saleX[s.id] || KC.saleTotals(s);
  return '<div class="receipt" id="rcpt"><div class="rh"><div class="rlogo">' + (st.logo ? '<img src="' + esc(st.logo) + '">' : esc(initials(st.businessName).slice(0, 2))) + '</div><div class="b" style="font-size:17px">' + esc(st.businessName) + '</div>' +
    (st.tagline ? '<div class="tiny muted">' + esc(st.tagline) + '</div>' : '') + '<div class="tiny muted">' + esc([st.address, st.phone].filter(Boolean).join(' · ')) + '</div></div>' +
    '<div class="row between small"><span class="muted">Receipt</span><b>' + esc(s.no) + '</b></div><div class="row between small"><span class="muted">Date</span><span>' + fmtDate(saleDate(s)) + '</span></div><div class="row between small mb"><span class="muted">Customer</span><span class="b">' + esc(s.customerName) + '</span></div>' +
    '<table>' + (s.lines || []).map((l) => { const rq = (l.returns || []).reduce((a, r) => a + num(r.qty), 0); return '<tr><td><div class="b">' + esc(l.name) + '</div><div class="tiny muted">' + l.qty + ' × ' + fmt(l.unitPrice) + (itemNote(l) ? ' · ' + esc(itemNote(l)) : '') + (rq ? ' · ' + rq + ' returned' : '') + '</div></td><td class="right money nowrap">' + fmt(l.qty * l.unitPrice) + '</td></tr>'; }).join('') +
    (t.discount ? '<tr><td class="muted">Discount</td><td class="right money">−' + fmt(t.discount) + '</td></tr>' : '') + (t.returned ? '<tr><td class="muted">Returns</td><td class="right money">−' + fmt(t.returned) + '</td></tr>' : '') +
    '<tr class="tot"><td>TOTAL</td><td class="right money">' + F(t.net) + '</td></tr>' + (t.deliveryFee > 0 ? '<tr><td class="muted">Delivery fee</td><td class="right money">' + F(t.deliveryFee) + '</td></tr><tr class="tot"><td>TOTAL TO PAY</td><td class="right money">' + F(t.due) + '</td></tr>' : '') + '<tr><td class="muted">Paid</td><td class="right money">' + F(t.paid) + '</td></tr>' +
    (t.balance > 0 ? '<tr><td class="b" style="color:var(--bad)">Balance due</td><td class="right money b" style="color:var(--bad)">' + F(t.balance) + '</td></tr>' : '') + '</table>' +
    ((s.payments || []).length ? '<div class="tiny muted mt">' + s.payments.map((p) => esc(fmtDate(p.date) + ' · ' + p.method + (p.account ? ' → ' + p.account : '') + (p.ref ? ' · txn ' + p.ref : '') + ': ' + F(p.amount) + (num(p.fee) > 0 ? ' + ' + F(p.fee) + ' charges' : ''))).join('<br>') + (t.fees > 0 ? '<br>MoMo charges total: ' + F(t.fees) : '') + '</div>' : '') +
    (KC.isDelivery(s) ? '<div class="tiny mt" style="border-top:1px dashed var(--line);padding-top:8px">' + deliveryLines(s).map(esc).join('<br>') + '</div>' : '') +
    '<div class="center mt"><span class="stamp ' + t.status + '">' + ({ paid: 'PAID', partial: 'DEPOSIT', unpaid: 'UNPAID', cancelled: 'CANCELLED' }[t.status]) + '</span>' + (!s.delivered && t.status !== 'cancelled' ? '<div class="tiny mt b" style="color:var(--warn)">Reserved — awaiting pickup</div>' : '') + '</div>' +
    (st.receiptFooter ? '<div class="tiny muted center mt">' + esc(st.receiptFooter) + '</div>' : '') + '</div>';
}
function showReceipt(id, fresh) {
  const s = byId('sales', id); if (!s) return;
  const wa = phoneWA(s.customerPhone);
  const el = openSheet({
    title: fresh ? '✓ Sale recorded' : 'Receipt ' + s.no,
    body: receiptHTML(s) + '<div class="tiny faint center mt">Tip: take a screenshot, or use the buttons below.</div>',
    foot: '<a class="btn grow" style="background:#25D366;border-color:#25D366;color:#fff" target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent(receiptText(s)) + '">' + ic('wa') + 'WhatsApp</a><button class="btn" data-a="rcCopy" data-id="' + id + '">' + ic('copy') + '<span class="desk-only">Copy</span></button><button class="btn" data-a="rcPdf" data-id="' + id + '">' + ic('dl') + 'PDF</button>' + (fresh ? '<button class="btn pri" data-a="rcNew">New sale</button>' : ''),
  });
  return el;
}
A.rcCopy = (el) => copyText(receiptText(byId('sales', el.dataset.id)));
A.rcNew = () => { closeSheet(); go('sell'); };
A.rcPdf = (el) => receiptPDF(byId('sales', el.dataset.id));
function receiptPDF(s) {
  if (!window.jspdf) return toast('PDF library still loading — try again', true);
  const st = S(), t = K.C.saleX[s.id];
  const lines = s.lines || [];
  const h = 95 + lines.length * 9 + (s.payments || []).length * 5 + (KC.isDelivery(s) ? 30 : 0);
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: [80, Math.max(140, h)] });
  let y = 8; const c = 40;
  if (st.logo) { try { doc.addImage(st.logo, st.logo.includes('image/png') ? 'PNG' : 'JPEG', c - 8, y, 16, 16); y += 19; } catch (e) { } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(st.businessName, c, y, { align: 'center' }); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  [st.tagline, st.address, st.phone].filter(Boolean).forEach((x) => { doc.text(String(x), c, y, { align: 'center' }); y += 4; });
  y += 2; doc.line(5, y, 75, y); y += 5;
  doc.text('Receipt: ' + s.no, 5, y); doc.text(fmtDate(saleDate(s)), 75, y, { align: 'right' }); y += 4;
  doc.text('Customer: ' + s.customerName, 5, y); y += 6;
  lines.forEach((l) => {
    doc.setFont('helvetica', 'bold'); doc.text(doc.splitTextToSize(l.name, 50)[0], 5, y);
    doc.text(fmt(l.qty * l.unitPrice), 75, y, { align: 'right' }); y += 4;
    doc.setFont('helvetica', 'normal'); doc.text(l.qty + ' x ' + fmt(l.unitPrice) + (itemNote(l) ? '  ' + itemNote(l) : ''), 5, y); y += 5;
  });
  doc.line(5, y, 75, y); y += 5;
  const row = (a, b, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.text(a, 5, y); doc.text(b, 75, y, { align: 'right' }); y += 5; };
  if (t.discount) row('Discount', '-' + fmt(t.discount));
  if (t.returned) row('Returns', '-' + fmt(t.returned));
  doc.setFontSize(11); row('TOTAL (' + baseCode() + ')', fmt(t.net), true); doc.setFontSize(8);
  if (t.deliveryFee > 0) { row('Delivery fee', fmt(t.deliveryFee)); doc.setFontSize(10); row('TOTAL TO PAY', fmt(t.due), true); doc.setFontSize(8); }
  row('Paid', fmt(t.paid)); if (t.balance > 0) row('Balance due', fmt(t.balance), true);
  deliveryLines(s).forEach((ln) => { doc.text(doc.splitTextToSize(ln, 70)[0], 5, y); y += 4; });
  (s.payments || []).forEach((p) => { doc.text(fmtDate(p.date) + ' ' + p.method + (p.ref ? ' #' + p.ref : '') + ': ' + fmt(p.amount) + (num(p.fee) > 0 ? ' +fee ' + fmt(p.fee) : ''), 5, y); y += 4; });
  if (t.txnId) { doc.text('Txn ID: ' + t.txnId, 5, y); y += 4; }
  y += 3; doc.setFont('helvetica', 'bold'); doc.text(({ paid: 'PAID', partial: 'DEPOSIT PAID', unpaid: 'UNPAID', cancelled: 'CANCELLED' }[t.status]) + (!s.delivered ? ' - RESERVED' : ''), c, y, { align: 'center' }); y += 6;
  doc.setFont('helvetica', 'normal'); if (st.receiptFooter) doc.text(doc.splitTextToSize(st.receiptFooter, 68), c, y, { align: 'center' });
  saveFile('Receipt-' + s.no + '.pdf', doc.output('blob'));
}

/* ---------- sales list ---------- */
function salesInRange() {
  const r = K.ui.salesRange, t = todayStr(); const y = todayStr(new Date(Date.now() - 864e5)); const w = todayStr(new Date(Date.now() - 6 * 864e5)); const m = monthStr();
  return visibleSales().filter((s) => { const d = saleDate(s); return r === 'all' || (r === 'today' && d === t) || (r === 'yday' && d === y) || (r === 'week' && d >= w) || (r === 'month' && d.slice(0, 7) === m); });
}
VIEWS.sales = {
  render() {
    let list = K.ui.salesStatus === 'owing' || K.ui.salesStatus === 'pickup' || K.ui.salesStatus === 'deliver' ? visibleSales().slice() : salesInRange();
    const st = K.ui.salesStatus, q = K.ui.salesQ.toLowerCase();
    list = list.filter((s) => { const x = K.C.saleX[s.id]; return st === 'all' ? true : st === 'owing' ? x.status === 'partial' || x.status === 'unpaid' : st === 'pickup' ? !KC.isDelivery(s) && !s.delivered && x.status !== 'cancelled' : st === 'deliver' ? KC.isDelivery(s) && s.delivery.status !== 'delivered' && x.status !== 'cancelled' : st === 'cancelled' ? x.status === 'cancelled' : true; })
      .filter((s) => !q || (s.no + ' ' + KC.saleTxnId(s) + ' ' + s.customerName + ' ' + s.customerPhone + ' ' + (s.payments || []).map((p) => p.ref || '').join(' ') + ' ' + (s.lines || []).map((l) => l.name).join(' ')).toLowerCase().includes(q))
      .sort((a, b) => (saleDate(b) + b.createdAt).localeCompare(saleDate(a) + a.createdAt));
    const live = list.filter((s) => K.C.saleX[s.id].status !== 'cancelled');
    const tot = live.reduce((a, s) => a + K.C.saleX[s.id].net, 0), paid = live.reduce((a, s) => a + K.C.saleX[s.id].paid, 0), bal = live.reduce((a, s) => a + Math.max(0, K.C.saleX[s.id].balance), 0), prof = live.reduce((a, s) => a + K.C.saleX[s.id].profit, 0);
    const R = [['today', 'Today'], ['yday', 'Yesterday'], ['week', '7 days'], ['month', 'This month'], ['all', 'All']];
    const SS = [['all', 'All'], ['owing', 'Owing'], ['pickup', 'Awaiting pickup'], ['deliver', 'To deliver'], ['cancelled', 'Cancelled']];
    return (!can('salesAll') ? '<div class="alert info mb">Showing your own sales only.</div>' : '') + '<div class="row wrap between mb"><div class="seg">' + R.map(([k, l]) => '<button class="' + (K.ui.salesRange === k ? 'on' : '') + '" data-a="salesRange" data-v="' + k + '">' + l + '</button>').join('') + '</div>' + (can('export') ? '<button class="btn ghost" data-a="exportSales">' + ic('dl') + 'Excel</button>' : '') + '</div>' +
      '<div class="chips mb">' + SS.map(([k, l]) => '<button class="chip' + (st === k ? ' on' : '') + '" data-a="salesStatus" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      '<div class="kpis mb">' + kpi('Sales', F(tot), live.length + ' receipt(s)', true) + kpi('Collected', F(paid)) + kpi('Balance owed', F(bal)) + (seeCost() ? kpi('Gross profit', F(prof), tot ? pct(prof / tot * 100) + ' margin' : '') : kpi('Items', fmt(live.reduce((a, s) => a + (s.lines || []).reduce((b, l) => b + num(l.qty), 0), 0)))) + '</div>' +
      '<div class="search mb">' + ic('search') + '<input class="inp" placeholder="Search customer, receipt no., item" value="' + esc(K.ui.salesQ) + '" data-i="salesQ"></div>' +
      salesRows(list);
  },
};
/** Compact sales list for narrow places (home "Recent sales", customer panel). The Sales page uses the table below. */
function saleCards(list) {
  if (!list.length) return '<div class="empty"><div class="big">🧾</div>No sales here yet.</div>';
  return list.slice(0, 300).map((s) => {
    const x = K.C.saleX[s.id]; const n = (s.lines || []).reduce((a, l) => a + num(l.qty), 0);
    return '<div class="li" data-a="openSale" data-id="' + s.id + '"><div class="av">' + esc(initials(s.customerName)) + '</div><div class="grow" style="min-width:0"><div class="t ellipsis">' + esc(s.customerName) + '</div><div class="tiny muted ellipsis">' + esc(s.no) + (x.txnId ? ' · txn ' + esc(x.txnId) : '') + ' · ' + fmtDate(saleDate(s)) + ' · ' + n + ' item(s)</div></div>' +
      '<div class="right"><div class="b money">' + F(x.net) + '</div><div class="row gap4" style="justify-content:flex-end;margin-top:3px">' + (allLocs().length > 1 ? '<span class="badge">' + esc(locName(s.locationId)) + '</span>' : '') + (!s.delivered && x.status !== 'cancelled' ? '<span class="badge info">Pickup</span>' : '') + statusBadge(x.status) + '</div>' + (x.balance > 0 && x.status !== 'cancelled' ? '<div class="tiny" style="color:var(--bad)">owes ' + fmt(x.balance) + (KC.dueDateOf(s, S()) < todayStr() ? ' · overdue' : '') + '</div>' : '') + '</div></div>';
  }).join('');
}
/** '2026-11-10' → '10 Nov' (year shown separately to keep table columns narrow). */
const dayMon = (d) => fmtDate(d).split(' ').slice(0, 2).join(' ');
/** Sales as a table: one row per sale, every important figure in its own column. */
function salesRows(list) {
  const multi = allLocs().length > 1, cost = seeCost(), today = todayStr();
  const X = (s) => K.C.saleX[s.id]; const live = (s) => X(s).status !== 'cancelled';
  const pays = (s) => (s.payments || []).filter((p) => num(p.amount) > 0);
  const qty = (s) => (s.lines || []).reduce((a, l) => a + num(l.qty), 0);
  const sumLive = (f) => (rows) => fmt(dtSum(rows.filter(live), f));
  const owes = (s) => live(s) && X(s).balance > 0;
  return dataTable({
    id: 'salesList', rows: list, noun: 'sale', limit: 300,
    empty: '<div class="big">🧾</div>No sales here yet.',
    rowAttr: (s) => ' data-a="openSale" data-id="' + s.id + '"', rowClass: (s) => live(s) ? '' : 'cx',
    cols: [
      { k: 'date', label: 'Date', core: true, v: (s) => saleDate(s), html: (s) => dtDate(saleDate(s)) },
      { k: 'no', label: 'Receipt', core: true, v: (s) => s.no, html: (s) => '<b>' + esc(s.no) + '</b>' },
      { k: 'txn', label: 'Transaction ID', v: (s) => KC.saleTxnId(s), cls: 'mut' },
      { k: 'cust', label: 'Customer', core: true, v: (s) => s.customerName },
      { k: 'phone', label: 'Phone', v: (s) => s.customerPhone || '', cls: 'mut' },
      { k: 'items', label: 'Items', wrap: true, v: (s) => (s.lines || []).map((l) => l.name + ' ×' + l.qty + (itemNote(l) ? ' (' + itemNote(l) + ')' : '')).join(', ') },
      { k: 'qty', label: 'Qty', num: true, v: qty, total: sumLive(qty) },
      { k: 'mode', label: 'Payment mode', v: (s) => [...new Set(pays(s).map((p) => p.method || 'Cash'))].join(', ') },
      { k: 'ref', label: 'Payment txn ID', v: (s) => pays(s).map((p) => p.ref).filter(Boolean).join(', '), cls: 'mut' },
      { k: 'total', label: 'Total', core: true, money: true, cls: 'b', v: (s) => X(s).net, total: sumLive((s) => X(s).net) },
      { k: 'paid', label: 'Paid', core: true, money: true, v: (s) => X(s).paid, total: sumLive((s) => X(s).paid) },
      { k: 'fees', label: 'MoMo charges', money: true, v: (s) => X(s).fees || '', total: sumLive((s) => X(s).fees || 0) },
      { k: 'bal', label: 'Balance', core: true, money: true, v: (s) => owes(s) ? X(s).balance : '', html: (s) => owes(s) ? '<span style="color:var(--bad);font-weight:700">' + fmt(X(s).balance) + '</span>' : dtNil, total: sumLive((s) => Math.max(0, X(s).balance)) },
      { k: 'due', label: 'Pay by', v: (s) => owes(s) ? KC.dueDateOf(s, S()) : '', html: (s) => { if (!owes(s)) return dtNil; const d = KC.dueDateOf(s, S()); return d < today ? '<span class="badge bad">Overdue · ' + esc(dayMon(d)) + '</span>' : dtDate(d); } },
      cost ? { k: 'profit', label: 'Profit', money: true, v: (s) => live(s) ? X(s).profit : '', total: sumLive((s) => X(s).profit) } : null,
      { k: 'status', label: 'Status', core: true, v: (s) => X(s).status, html: (s) => statusBadge(X(s).status) },
      { k: 'coll', label: 'Collected / delivery', v: (s) => !live(s) ? '' : KC.isDelivery(s) ? s.delivery.status || 'to_send' : (s.delivered ? 'Yes' : 'No'), html: (s) => !live(s) ? dtNil : KC.isDelivery(s) ? dlStatusBadge(s.delivery.status) : s.delivered ? '<span class="badge">Yes</span>' : '<span class="badge info">No · at shop</span>' },
      { k: 'dmode', label: 'Delivery', v: (s) => KC.isDelivery(s) ? KC.deliveryModeLabel(s.delivery.mode).replace(/ \(.*\)/, '') : '' },
      { k: 'agency', label: 'Agency', v: (s) => KC.isDelivery(s) ? s.delivery.agency || '' : '' },
      { k: 'dest', label: 'Town / area', v: (s) => KC.isDelivery(s) ? s.delivery.destination || '' : '' },
      { k: 'rname', label: 'Recipient', v: (s) => KC.isDelivery(s) ? s.delivery.recipientName || '' : '' },
      { k: 'rphone', label: 'Recipient phone', v: (s) => KC.isDelivery(s) ? s.delivery.recipientPhone || '' : '', cls: 'mut' },
      { k: 'dfee', label: 'Delivery fee', money: true, v: (s) => KC.isDelivery(s) && num(s.delivery.fee) ? num(s.delivery.fee) : '', total: sumLive((s) => KC.isDelivery(s) ? num(s.delivery.fee) : 0) },
      { k: 'by', label: 'Sold by', v: (s) => s.createdBy || '', cls: 'mut' },
      multi ? { k: 'branch', label: 'Branch', v: (s) => locName(s.locationId), cls: 'mut' } : null,
    ],
  });
}
A.salesRange = (el) => { K.ui.salesRange = el.dataset.v; if (['owing', 'pickup', 'deliver'].includes(K.ui.salesStatus)) K.ui.salesStatus = 'all'; render(true); };
A.salesStatus = (el) => { K.ui.salesStatus = el.dataset.v; render(true); };
I.salesQ = (el) => { K.ui.salesQ = el.value; clearTimeout(I._sq); I._sq = setTimeout(() => dtRefresh('salesList'), 150); };

/* ---------- sale detail ---------- */
A.openSale = (el) => openSale(el.dataset.id);
function openSale(id) {
  const el = openSheet({ title: 'Sale', body: '', wide: false });
  el._refresh = () => {
    const s = byId('sales', id); if (!s) return closeSheet();
    const x = K.C.saleX[s.id]; const cancelled = x.status === 'cancelled';
    const hasReturns = (s.lines || []).some((l) => (l.returns || []).length);
    $('.sh h2', el).textContent = 'Sale ' + s.no;
    setSheetBody(el, '<div class="row between mb"><div><div class="b" style="font-size:17px">' + esc(s.customerName) + '</div><div class="tiny muted">' + fmtDate(saleDate(s)) + ' · by ' + esc(s.createdBy || '—') + (s.customerPhone ? ' · ' + esc(s.customerPhone) : '') + (allLocs().length > 1 ? ' · ' + esc(locName(s.locationId)) : '') + (x.txnId ? ' · txn ' + esc(x.txnId) : '') + (x.balance > 0 && !cancelled ? ' · <b>pay by ' + fmtDate(KC.dueDateOf(s, S())) + '</b>' : '') + '</div></div><div class="col gap4" style="align-items:flex-end">' + statusBadge(x.status) + (!cancelled ? (s.delivered ? '<span class="badge">Collected' + (s.pickedUpAt ? ' ' + esc(dayMon(s.pickedUpAt.slice(0, 10))) : '') + '</span>' : '<span class="badge info">Not collected — at shop</span>') : '') + '</div></div>' +
      '<div class="card"><table class="t"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead><tbody>' +
      (s.lines || []).map((l) => { const rq = (l.returns || []).reduce((a, r) => a + num(r.qty), 0); return '<tr><td>' + esc(l.name) + '<div class="tiny muted">' + esc(lineCond(l) + ' · ' + lineWork(l)) + '</div>' + (rq ? '<div class="tiny" style="color:var(--warn)">' + rq + ' returned</div>' : '') + '</td><td class="r">' + l.qty + '</td><td class="r money">' + fmt(l.unitPrice) + '</td><td class="r money">' + fmt(l.qty * l.unitPrice) + '</td></tr>'; }).join('') +
      '</tbody></table><div class="pad"><div class="row between small"><span class="muted">Subtotal</span><span class="money">' + F(x.subtotal) + '</span></div>' + (x.discount ? '<div class="row between small"><span class="muted">Discount</span><span class="money">−' + F(x.discount) + '</span></div>' : '') + (x.returned ? '<div class="row between small"><span class="muted">Returns</span><span class="money">−' + F(x.returned) + '</span></div>' : '') +
      '<div class="row between b mt"><span>Total</span><span class="money" style="font-size:18px">' + F(x.net) + '</span></div>' + (x.deliveryFee > 0 ? '<div class="row between small"><span class="muted">Delivery fee</span><span class="money">' + F(x.deliveryFee) + '</span></div><div class="row between b"><span>Total to pay</span><span class="money">' + F(x.due) + '</span></div>' : '') + '<div class="row between small"><span class="muted">Paid</span><span class="money">' + F(x.paid) + '</span></div>' + (x.fees > 0 ? '<div class="row between small"><span class="muted">MoMo charges</span><span class="money">' + F(x.fees) + '</span></div>' : '') + (x.balance > 0 && !cancelled ? '<div class="row between b" style="color:var(--bad)"><span>Balance due</span><span class="money">' + F(x.balance) + '</span></div>' : '') +
      (seeCost() && !cancelled ? '<div class="row between small mt"><span class="muted">Cost of goods · profit</span><span class="money">' + F(x.cogs) + ' · <b style="color:var(--ok)">' + F(x.profit) + '</b></span></div>' : '') + '</div></div>' +
      deliveryCard(s) + '<h3 class="mt mb">Payments</h3><div class="card list">' + ((s.payments || []).length ? s.payments.map((p) => '<div class="li" style="cursor:default"><div class="av ' + (p.amount < 0 ? 'acc' : '') + '">' + ic('wallet', 'sm') + '</div><div class="grow"><div class="t">' + esc(p.method) + (p.amount < 0 ? ' (refund)' : '') + '</div><div class="tiny muted">' + fmtDate(p.date) + (p.account ? ' · to ' + esc(p.account) : '') + (p.ref ? ' · txn ' + esc(p.ref) : '') + (p.note ? ' &middot; ' + esc(p.note) : '') + (p.by ? ' · ' + esc(p.by) : '') + (num(p.fee) > 0 ? ' · charges ' + F(p.fee) : '') + '</div></div><div class="right"><div class="b money">' + F(p.amount) + '</div>' + (num(p.fee) > 0 ? '<div class="tiny muted">+' + fmt(p.fee) + ' fee</div>' : '') + '</div>' + (can('cancel') ? '<button class="icon-btn" data-a="payDel" data-s="' + s.id + '" data-p="' + p.id + '">' + ic('trash', 'sm') + '</button>' : '') + '</div>').join('') : '<div class="empty small">No payment yet.</div>') + '</div>' +
      (s.notes ? '<div class="alert info mt">' + esc(s.notes) + '</div>' : '') +
      '<div class="grid2 mt2">' +
      (!cancelled && x.balance > 0 && can('payments') ? '<button class="btn pri" data-a="addPay" data-id="' + s.id + '">' + ic('wallet') + 'Add payment</button>' : '') +
      (!cancelled && KC.isDelivery(s) ? deliveryButtons(s) : '') + (!cancelled && !KC.isDelivery(s) && !s.delivered ? '<button class="btn" data-a="markPicked" data-id="' + s.id + '">' + ic('check') + 'Mark picked up</button>' : '') +
      '<button class="btn" data-a="openReceipt" data-id="' + s.id + '">' + ic('sales') + 'Receipt</button>' + (can('activity') ? '<button class="btn" data-a="actFor" data-q="' + esc(s.no) + '">' + ic('clock') + 'History</button>' : '') +
      (!cancelled && !hasReturns && can('sell') && (can('salesAll') || s.createdById === K.me.id) ? '<button class="btn" data-a="editSale" data-id="' + s.id + '">' + ic('edit') + 'Edit items</button>' : '') +
      (!cancelled && can('returns') ? '<button class="btn" data-a="returnSale" data-id="' + s.id + '">' + ic('undo') + 'Return items</button>' : '') +
      (!cancelled && can('cancel') ? '<button class="btn danger" data-a="cancelSale" data-id="' + s.id + '">' + ic('x') + 'Cancel sale</button>' : '') + '</div>');
  };
  el._refresh();
}
A.openReceipt = (el) => showReceipt(el.dataset.id);
A.markPicked = async (el) => { const s = byId('sales', el.dataset.id); await save('sales', Object.assign({}, s, { delivered: true, pickedUpAt: new Date().toISOString() })); refreshSheets(); scheduleRender(); toast('Marked as picked up'); };
A.editSale = (el) => {
  const s = byId('sales', el.dataset.id);
  if (K.cart.lines.length && K.cart.editingId !== s.id) { toast('Finish or clear the current cart first', true); return; }
  K.cart = { editingId: s.id, customerId: s.customerId, discount: num(s.discount), delivery: s.delivery ? JSON.parse(JSON.stringify(s.delivery)) : null, lines: s.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, condition: l.condition, working: l.working, manual: true })) };
  if ((s.locationId || 'main') !== K.loc) { if (!myLocs().find((x) => x.id === (s.locationId || 'main'))) { toast('This sale belongs to another location', true); K.cart = { lines: [], customerId: null, editingId: null, discount: 0 }; return; } K.loc = s.locationId || 'main'; fixLoc(); }
  saveCart(); while (K.sheets.length) closeSheet(); go('sell');
};
A.cancelSale = async (el) => {
  const s = byId('sales', el.dataset.id); const x = K.C.saleX[s.id];
  const why = await askReason('Cancel sale ' + s.no + '? Items go back to stock.' + (x.paid > 0 ? ' A refund of ' + F(x.paid) + ' will be recorded.' : ''), ['Customer changed mind', 'Wrong entry / mistake', 'Duplicate sale', 'Customer did not pay', 'Other'], 'Cancel sale'); if (why === null) return;
  // refund each way the customer paid (MoMo back to MoMo, cash back as cash) so cash handovers stay correct
  const pays = (s.payments || []).slice(); const byM = {}; pays.forEach((p) => (byM[p.method || 'Cash'] = (byM[p.method || 'Cash'] || 0) + num(p.amount)));
  Object.entries(byM).forEach(([m, amt]) => { if (amt > 0.5) pays.push(refundPayment(s, m, amt, 'Refund on cancel')); });
  await save('sales', Object.assign({}, s, { status: 'cancelled', payments: pays, cancelledAt: new Date().toISOString(), cancelReason: why, cancelledBy: K.me.name || '' })); refreshSheets(); scheduleRender(); toast('Sale cancelled');
};
A.payDel = async (el) => {
  const why = await askReason('Delete this payment?', ['Entered by mistake', 'Duplicate', 'Payment reversed / bounced', 'Other'], 'Delete payment'); if (why === null) return;
  const s = byId('sales', el.dataset.s);
  await save('sales', applySaleTxnId(Object.assign({}, s, { payments: s.payments.filter((p) => p.id !== el.dataset.p), lastPaymentDeleteReason: why })));
  refreshSheets(); scheduleRender();
};
A.addPay = (el) => {
  const s = byId('sales', el.dataset.id); const x = K.C.saleX[s.id];
  const sh = openSheet({ title: 'Add payment · ' + s.no, body: '<div class="alert info mb">Balance due: <b class="money">' + F(x.balance) + '</b></div>' + payFields(x.balance), foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="pSave">Save payment</button>' });
  syncPayCharges(sh);
  $('#pSave', sh).onclick = async () => {
    const p = readPayment(formVals(sh)); if (p === false) return; if (!p) return toast('Enter an amount', true);
    const cur = byId('sales', s.id);
    const next = applySaleTxnId(Object.assign({}, cur, { payments: (cur.payments || []).concat([p]) }));
    if (await save('sales', next)) { closeSheet(); refreshSheets(); scheduleRender(); toast('Payment recorded'); }
  };
};
A.returnSale = (el) => {
  const s = byId('sales', el.dataset.id); const x = K.C.saleX[s.id];
  const rows = s.lines.map((l, i) => { const done = (l.returns || []).reduce((a, r) => a + num(r.qty), 0); const max = num(l.qty) - done; return max > 0 ? '<div class="row between cl"><div class="grow"><div class="b">' + esc(l.name) + '</div><div class="tiny muted">Sold ' + l.qty + ' × ' + fmt(l.unitPrice) + (done ? ' · ' + done + ' already returned' : '') + '</div></div><input class="inp" style="width:80px" inputmode="numeric" data-ret="' + i + '" data-max="' + max + '" placeholder="0"></div>' : ''; }).join('');
  const sh = openSheet({
    title: 'Return items · ' + s.no,
    body: '<div class="card pad">' + (rows || '<div class="empty small">Everything was already returned.</div>') + '</div><div class="col mt">' + field('Returned items go', sel('restock', [['yes', 'Back to stock (resellable)'], ['no', 'Damaged — write off']], 'yes')) +
      '<div class="grid2">' + field('Refund amount (F)', inp('refund', '', 'inputmode="numeric" id="refundAmt"')) + field('Refund mode', sel('refMethod', KC.SALE_PAY_METHODS, ((s.payments || []).find((p) => num(p.amount) > 0 && KC.SALE_PAY_METHODS.includes(p.method)) || {}).method || 'Cash')) + '</div><div class="tiny muted">Leave refund at 0 for an exchange or credit.</div>' + field('Reason', sel('reason', KC.RETURN_REASONS, KC.RETURN_REASONS[0])) + field('Details (optional)', inp('reasonNote', '')) + '</div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="rSave">Record return</button>',
  });
  const calc = () => { let v = 0; $$('[data-ret]', sh).forEach((i) => { const l = s.lines[+i.dataset.ret]; v += Math.min(num(i.value), num(i.dataset.max)) * num(l.unitPrice) * x.factor; }); $('#refundAmt', sh).value = Math.round(Math.min(v, Math.max(0, x.paid))); };
  $$('[data-ret]', sh).forEach((i) => i.addEventListener('input', calc));
  $('#rSave', sh).onclick = async () => {
    const v = formVals(sh); const cur = JSON.parse(JSON.stringify(byId('sales', s.id))); let any = false;
    $$('[data-ret]', sh).forEach((i) => {
      const q = Math.min(Math.floor(num(i.value)), num(i.dataset.max)); if (q <= 0) return; any = true;
      const l = cur.lines[+i.dataset.ret];
      const usedByLot = {}; (l.returns || []).forEach((r) => (r.alloc || []).forEach((a) => (usedByLot[a.lotId] = (usedByLot[a.lotId] || 0) + num(a.qty))));
      let need = q; const alloc = [];
      for (const a of l.alloc.slice().reverse()) { if (need <= 0) break; const free = num(a.qty) - (usedByLot[a.lotId] || 0); const take = Math.min(free, need); if (take > 0) { alloc.push({ lotId: a.lotId, qty: take }); need -= take; } }
      l.returns = (l.returns || []).concat([{ id: uid('r_'), date: todayStr(), qty: q, restock: v.restock === 'yes', alloc, reason: v.reason || '', note: v.reasonNote || '', by: K.me.name || '', locationId: K.loc }]);
    });
    if (!any) return toast('Enter a quantity to return', true);
    if (num(v.refund) > 0) cur.payments = (cur.payments || []).concat([refundPayment(cur, v.refMethod, v.refund, 'Refund: ' + (v.reason || 'return'))]);
    if (await save('sales', cur)) { closeSheet(); refreshSheets(); scheduleRender(); toast('Return recorded'); }
  };
};

A.exportSales = () => xlsxDownload('Sales-' + todayStr() + '.xlsx', { Sales: visibleSales().map(saleRow) });

function creditTag(cu) { const c = creditInfo(cu); if (!c) return ''; return (c.owed > 0 ? ' · owes ' + fmt(c.owed) : '') + (c.lim !== null ? ' · credit left ' + fmt(Math.max(0, c.lim - c.owed)) : ''); }

function posCustBar() {
  const cu = cartCust();
  return '<div class="cust-pill grow" data-a="pickCustomer" style="padding:8px 12px">' + (cu ? '<div class="av" style="width:32px;height:32px">' + esc(initials(cu.name)) + '</div><div class="grow" style="min-width:0"><div class="b ellipsis">' + esc(cu.name) + (KC.isWholesale(cu) ? ' <span class="badge info">' + esc(cu.type) + ' prices</span>' : '') + '</div><div class="tiny muted ellipsis">' + esc(cu.phone || '') + creditTag(cu) + '</div></div>' : '<div class="av" style="width:32px;height:32px">' + ic('users', 'sm') + '</div><div class="grow"><div class="b">Walk-in customer</div><div class="tiny muted">Tap to choose a customer</div></div>') + ic('chev', 'sm') + '</div>' +
    (cu ? '<button class="btn" data-a="custWalkinNow" title="Back to walk-in">' + ic('x') + '</button>' : '') + ((can('customers') || can('sell')) ? '<button class="btn pri" data-a="custQuickNew">' + ic('plus') + '<span class="desk-only">New customer</span></button>' : '');
}
A.custWalkinNow = () => { K.cart.customerId = null; K.cart.lines.forEach(reprice); refreshPOS(); };
A.custQuickNew = () => editCustomer(null, (id) => { K.cart.customerId = id; K.cart.lines.forEach(reprice); refreshPOS(); refreshSheets(); });

/* ---------- delivery on a sale: card, status buttons, update sheet ---------- */
/** Receipt lines for a delivery: ['Delivery: Travel agency · General Express → Bafoussam', 'Recipient: …', …] */
function deliveryLines(s) {
  if (!KC.isDelivery(s)) return [];
  const d = s.delivery; const st = (KC.DELIVERY_STATUSES.find((x) => x[0] === d.status) || [0, 'To send'])[1];
  return ['Delivery: ' + KC.deliveryModeLabel(d.mode).replace(/ \(.*\)/, '') + (d.agency ? ' · ' + d.agency : '') + (d.destination ? ' → ' + d.destination : ''),
    'Recipient: ' + [d.recipientName, d.recipientPhone].filter(Boolean).join(' · '),
    d.trackingNo ? 'Agency receipt: ' + d.trackingNo : '', 'Delivery status: ' + st].filter(Boolean);
}
const dlStatusBadge = (st) => ({ to_send: '<span class="badge warn">To send</span>', sent: '<span class="badge info">Sent</span>', delivered: '<span class="badge ok">Delivered</span>' }[st || 'to_send']);
function deliveryCard(s) {
  if (!KC.isDelivery(s)) return '';
  const d = s.delivery; const row = (l, v) => v ? '<div class="row between small cl"><span class="muted">' + l + '</span><span class="b" style="text-align:right">' + v + '</span></div>' : '';
  return '<h3 class="mt mb">Delivery</h3><div class="card pad">' +
    row('Mode', esc(KC.deliveryModeLabel(d.mode))) + row('Agency', esc(d.agency)) + row('Town / area', esc(d.destination)) + row('Address', esc(d.address)) +
    row('Recipient', esc(d.recipientName)) + row('Recipient phone', esc(d.recipientPhone)) +
    row('Delivery fee', num(d.fee) ? F(d.fee) + ' · ' + esc((KC.DELIVERY_PAYERS.find((x) => x[0] === d.payer) || [0, ''])[1]) : '') +
    row('Tracking / receipt no.', esc(d.trackingNo)) + row('Status', dlStatusBadge(d.status)) +
    row('Sent', d.sentAt ? esc(fmtDT(d.sentAt)) : '') + row('Delivered', d.deliveredAt ? esc(fmtDT(d.deliveredAt)) : '') + '</div>';
}
function deliveryButtons(s) {
  const st = s.delivery.status || 'to_send';
  return (st === 'to_send' ? '<button class="btn" data-a="dlSet" data-id="' + s.id + '" data-v="sent">' + ic('ship') + 'Mark sent</button>' : '') +
    (st !== 'delivered' ? '<button class="btn" data-a="dlSet" data-id="' + s.id + '" data-v="delivered">' + ic('check') + 'Mark delivered</button>' : '') +
    '<button class="btn" data-a="dlEdit" data-id="' + s.id + '">' + ic('edit') + 'Update delivery</button>';
}
async function saveDelivery(saleId, patch) {
  const cur = byId('sales', saleId); const d = Object.assign({}, cur.delivery, patch); const now = new Date().toISOString();
  if (d.status !== 'to_send' && !d.sentAt) d.sentAt = now;
  if (d.status === 'delivered' && !d.deliveredAt) d.deliveredAt = now;
  const ok = await save('sales', Object.assign({}, cur, { delivery: KC.cleanDelivery(d), delivered: d.status !== 'to_send' }));
  if (ok) { refreshSheets(); scheduleRender(); }
  return ok;
}
A.dlSet = (el) => saveDelivery(el.dataset.id, { status: el.dataset.v }).then((ok) => ok && toast(el.dataset.v === 'sent' ? 'Marked as sent' : 'Marked as delivered'));
A.dlEdit = (el) => {
  const s = byId('sales', el.dataset.id); const d = s.delivery || {};
  const sh = openSheet({ title: 'Delivery · ' + s.no, body: '<div class="col">' + field('Mode', sel('mode', KC.DELIVERY_MODES, d.mode)) +
    '<div class="grid2">' + field('Agency / company', inp('agency', d.agency)) + field('Town / area', inp('destination', d.destination)) + '</div>' + field('Address / landmark', inp('address', d.address)) +
    '<div class="grid2">' + field('Recipient name', inp('recipientName', d.recipientName)) + field('Recipient phone', inp('recipientPhone', d.recipientPhone, 'inputmode="tel"')) + '</div>' +
    '<div class="grid2">' + field('Delivery fee (F)', inp('fee', d.fee || '', 'inputmode="numeric"')) + field('Who pays', sel('payer', KC.DELIVERY_PAYERS, d.payer || 'client_us')) + '</div>' +
    '<div class="grid2">' + field('Status', sel('status', KC.DELIVERY_STATUSES, d.status || 'to_send')) + field('Agency receipt / tracking no.', inp('trackingNo', d.trackingNo)) + '</div>' + field('Notes', inp('notes', d.notes)) + '</div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="dlSave">Save delivery</button>' });
  $('#dlSave', sh).onclick = async () => {
    const v = formVals(sh); v.fee = num(v.fee);
    if (v.mode === 'pickup') { const cur = byId('sales', s.id); if (await save('sales', Object.assign({}, cur, { delivery: { mode: 'pickup' } }))) { closeSheet(); refreshSheets(); scheduleRender(); } return; }
    if (!v.destination) return toast('Type the town / area', true);
    if (await saveDelivery(s.id, v)) { closeSheet(); toast('Delivery updated'); }
  };
};

/* ================= ONLINE ORDERS (sent by clients from the public shop page) ================= */
const ORDER_ST = { new: '<span class="badge warn">New — to confirm</span>', done: '<span class="badge ok">Sale created</span>', rejected: '<span class="badge">Rejected</span>' };
const newOrders = () => (K.raw.orders || []).filter((o) => o.status === 'new');
const orderItems = (o) => (o.lines || []).map((l) => l.name + ' ×' + l.qty).join(', ');
function ordersTable(list) {
  const dl = (o) => (o.delivery && o.delivery.mode !== 'pickup' ? o.delivery : null);
  return dataTable({
    id: 'orderList', rows: list, noun: 'order', empty: '<div class="big">🛍️</div>No online orders yet. Share your shop link (Settings → Online shop).',
    rowAttr: (o) => ' data-a="openOrder" data-id="' + o.id + '"', rowClass: (o) => o.status === 'rejected' ? 'cx' : '',
    cols: [
      { k: 'at', label: 'Received', core: true, v: (o) => o.createdAt || '', html: (o) => esc(fmtDT(o.createdAt)) },
      { k: 'no', label: 'Order no.', core: true, v: (o) => o.no, html: (o) => '<b>' + esc(o.no) + '</b>' },
      { k: 'cust', label: 'Client', core: true, v: (o) => (o.customer || {}).name || '' },
      { k: 'phone', label: 'Phone', core: true, v: (o) => (o.customer || {}).phone || '' },
      { k: 'items', label: 'Items', wrap: true, v: orderItems },
      { k: 'qty', label: 'Qty', num: true, v: (o) => (o.lines || []).reduce((a, l) => a + num(l.qty), 0) },
      { k: 'total', label: 'Items total', core: true, money: true, cls: 'b', v: (o) => num(o.subtotal), total: (rows) => fmt(dtSum(rows, (o) => o.status === 'rejected' ? 0 : o.subtotal)) },
      { k: 'mode', label: 'Delivery', core: true, v: (o) => KC.deliveryModeLabel((o.delivery || {}).mode || 'pickup').replace(/ \(.*\)/, '') },
      { k: 'dest', label: 'Town / area', v: (o) => dl(o) ? dl(o).destination : '' },
      { k: 'agency', label: 'Agency', v: (o) => dl(o) ? dl(o).agency : '' },
      { k: 'rname', label: 'Recipient', v: (o) => dl(o) ? dl(o).recipientName : '' },
      { k: 'rphone', label: 'Recipient phone', v: (o) => dl(o) ? dl(o).recipientPhone : '', cls: 'mut' },
      { k: 'note', label: 'Note', wrap: true, v: (o) => o.note || '', cls: 'mut' },
      { k: 'status', label: 'Status', core: true, v: (o) => o.status, html: (o) => ORDER_ST[o.status] || esc(o.status) },
      { k: 'sale', label: 'Sale', v: (o) => o.saleNo || '' },
      { k: 'by', label: 'Handled by', v: (o) => o.handledBy || '', cls: 'mut' },
    ],
  });
}
VIEWS.orders = {
  render() {
    const tab = K.ui.ordTab || 'new'; const all = (K.raw.orders || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const list = tab === 'new' ? all.filter((o) => o.status === 'new') : all;
    const link = S().shopEnabled && S().shopId ? shopLink() : '';
    return '<div class="kpis mb">' + kpi('New orders', fmt(newOrders().length), 'waiting to be confirmed', true) + kpi('Value of new orders', F(newOrders().reduce((a, o) => a + num(o.subtotal), 0))) + kpi('Turned into sales', fmt(all.filter((o) => o.status === 'done').length)) + '</div>' +
      (link ? '<div class="alert info mb row between wrap"><span>Your shop: <b>' + esc(link) + '</b></span><span class="row"><button class="btn sm" data-a="shopCopy">' + ic('copy', 'sm') + 'Copy link</button><a class="btn sm" target="_blank" rel="noopener" href="' + esc(link) + '">Open shop</a></span></div>'
        : '<div class="alert mb">' + (can('settings') ? 'Your online shop is off. Turn it on in <a href="#settings">Settings → Online shop</a> and share the link with clients.' : 'The online shop is off. Ask the owner to turn it on in Settings.') + '</div>') +
      '<div class="chips mb">' + [['new', 'To confirm'], ['all', 'All orders']].map(([k, l]) => '<button class="chip' + (tab === k ? ' on' : '') + '" data-a="ordTab" data-v="' + k + '">' + l + '</button>').join('') + '</div>' + ordersTable(list);
  },
};
A.ordTab = (el) => { K.ui.ordTab = el.dataset.v; render(true); };
A.openOrder = (el) => {
  const sh = openSheet({ title: 'Order', body: '', wide: true });
  sh._refresh = () => {
    const o = byId('orders', el.dataset.id); if (!o) return closeSheet(); const c = o.customer || {}; const d = o.delivery || { mode: 'pickup' };
    $('.sh h2', sh).textContent = 'Order ' + o.no;
    const wa = phoneWA(c.whatsapp || c.phone); const row = (l, v) => v ? '<div class="row between small cl"><span class="muted">' + l + '</span><span class="b" style="text-align:right">' + esc(v) + '</span></div>' : '';
    setSheetBody(sh, '<div class="row between mb"><div><div class="b" style="font-size:17px">' + esc(c.name) + '</div><div class="tiny muted">' + esc(c.phone) + ' · received ' + esc(fmtDT(o.createdAt)) + '</div></div>' + (ORDER_ST[o.status] || '') + '</div>' +
      '<div class="card tw mb"><table class="t"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th><th class="r">In stock now</th></tr></thead><tbody>' +
      (o.lines || []).map((l) => { const x = K.C.prodX[l.productId]; const av = x ? x.available : 0; return '<tr><td>' + esc(l.name) + '</td><td class="r">' + l.qty + '</td><td class="r money">' + fmt(l.unitPrice) + '</td><td class="r money b">' + fmt(l.qty * l.unitPrice) + '</td><td class="r"' + (av < l.qty ? ' style="color:var(--bad);font-weight:700"' : '') + '>' + fmt(av) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td colspan="3" class="b">Items total</td><td class="r money b">' + fmt(o.subtotal) + '</td><td></td></tr></tfoot></table></div>' +
      '<h3 class="mb">Delivery</h3><div class="card pad mb">' + row('How', KC.deliveryModeLabel(d.mode)) + row('Town / area', d.destination) + row('Agency', d.agency) + row('Address', d.address) + row('Recipient', d.recipientName) + row('Recipient phone', d.recipientPhone) + '</div>' +
      (o.note ? '<div class="alert info mb">' + esc(o.note) + '</div>' : '') + (o.rejectReason ? '<div class="alert mb">Rejected: ' + esc(o.rejectReason) + '</div>' : '') +
      (o.saleId && byId('sales', o.saleId) ? '<button class="btn mb" data-a="openSale" data-id="' + o.saleId + '">' + ic('sales') + 'Open sale ' + esc(o.saleNo || '') + '</button>' : '') +
      '<div class="row wrap">' + (o.status === 'new' && can('sell') ? '<button class="btn pri" data-a="orderToSale" data-id="' + o.id + '">' + ic('sell') + 'Create sale from this order</button>' : '') +
      (wa ? '<a class="btn" style="background:#25D366;border-color:#25D366;color:#fff" target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent('Hello ' + c.name + ', this is ' + S().businessName + ' about your order ' + o.no + '.') + '">' + ic('wa', 'sm') + 'WhatsApp</a>' : '') +
      (c.phone ? '<a class="btn" href="tel:' + esc(String(c.phone).replace(/\s/g, '')) + '">Call</a>' : '') +
      (o.status === 'new' ? '<button class="btn danger" data-a="orderReject" data-id="' + o.id + '">' + ic('x') + 'Reject</button>' : '') + '</div>');
  };
  sh._refresh();
};
/** Load an order into the cart (customer + items + delivery details) so staff check prices, add the delivery fee and complete the sale. */
A.orderToSale = async (el) => {
  const o = byId('orders', el.dataset.id); if (!o) return;
  if (K.cart.lines.length && K.cart.orderId !== o.id && !(await confirmBox('Your current cart will be replaced by this order. Continue?', 'Replace cart'))) return;
  const c = o.customer || {}; const digits = (p) => String(p || '').replace(/\D/g, '').slice(-9);
  let cu = K.raw.customers.find((x) => digits(x.phone) && digits(x.phone) === digits(c.phone));
  if (!cu) { cu = { id: uid('c_'), name: c.name, phone: c.phone, whatsapp: c.whatsapp || c.phone, city: c.city || '', type: 'Retail', source: 'Online shop' }; if (!(await save('customers', cu))) return; }
  K.cart = { lines: (o.lines || []).map((l) => ({ productId: l.productId, name: l.name, qty: num(l.qty), unitPrice: num(l.unitPrice), manual: true })), customerId: cu.id, editingId: null, discount: 0, orderId: o.id,
    delivery: o.delivery && o.delivery.mode !== 'pickup' ? Object.assign({}, o.delivery, { fee: 0, payer: 'client_us', status: 'to_send' }) : { mode: 'pickup', payer: 'client_us', status: 'to_send' } };
  saveCart(); while (K.sheets.length) closeSheet(); go('sell');
  toast('Order ' + o.no + ' is in the cart — check prices, add the delivery fee at checkout, then Complete sale');
};
A.orderReject = async (el) => {
  const o = byId('orders', el.dataset.id); if (!o) return;
  const why = await askReason('Reject order ' + o.no + '?', ['Out of stock', 'Client not reachable', 'Duplicate order', 'Client cancelled', 'Other'], 'Reject order'); if (why === null) return;
  if (await save('orders', Object.assign({}, o, { status: 'rejected', rejectReason: why, handledBy: K.me.name || '', handledAt: new Date().toISOString() }))) { refreshSheets(); scheduleRender(); toast('Order rejected'); }
};
const shopLink = () => location.origin + '/s/' + S().shopId;
A.shopCopy = () => copyText(shopLink());
