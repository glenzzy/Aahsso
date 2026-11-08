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
      (src ? '<div class="pimg"><img src="' + esc(src) + '" alt="" loading="lazy"></div>' : '<div class="pimg ph" style="background:' + catColor(p.category) + '">' + esc(initials(p.name)) + '</div>') +
      '<div class="nm">' + esc(p.name) + '</div>' + (KC.sizeLabel(p) ? '<div class="tiny muted">' + esc(KC.sizeLabel(p)) + '</div>' : '') + '<div class="row gap6 wrap">' + (p.condition && p.condition !== 'New' ? '<span class="badge acc">' + esc(p.condition) + '</span>' : '') + (heldForCart(p.id) ? '<span class="badge info">Client order</span>' : '') + (px.nextExpiry && daysUntil(px.nextExpiry) <= (num(S().expiryWarnDays) || 60) ? expiryBadge(px.nextExpiry) : '') + '</div>' +
      '<div class="pr money">' + F(px.priceMax) + '</div><div class="st">' + (av - q) + ' left' + (px.priceMin < px.priceMax ? ' · min ' + fmt(px.priceMin) : '') + '</div></div>';
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
      '<div class="row between"><div>' + warn + '<div class="tiny faint">Retail ' + fmt(px.priceMax) + ' · wholesale ' + fmt(px.priceWholesale) + ' · ' + availFor(l.productId) + ' here</div></div><div class="b money" data-lt="' + i + '">' + F(num(l.qty) * price) + '</div></div></div>';
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
    return '<div class="pos"><div><div class="row mb gap6" id="posCust">' + posCustBar() + '</div><div class="search mb">' + ic('search') + '<input class="inp" id="posQ" placeholder="Search item or scan barcode…" value="' + esc(K.ui.posQ) + '" data-i="posQ" autocomplete="off"></div>' +
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

/* ---------- checkout ---------- */
function accountOpts(method) {
  const acc = (S().momoAccounts || []).filter((a) => !a.method || a.method === method);
  return [['', method === 'Cash' ? '—' : 'Select receiving number']].concat(acc.map((a) => [a.number, (a.label ? a.label + ' · ' : '') + a.number]));
}
function payFields(defAmount, defMethod = 'Cash') {
  const mm = KC.isMobileMoney(defMethod);
  const sug = mm ? KC.calcMomoFee(defMethod, defAmount, S()) : 0;
  return '<div class="col"><div class="grid2">' + field('Sale amount (F)', inp('payAmount', defAmount, 'inputmode="numeric" id="payAmount"')) + field('Date', inp('payDate', todayStr(), 'type="date"')) + '</div>' +
    field('Payment method', '<div class="seg" id="pm">' + KC.PAY_METHODS.map((m) => '<button type="button" class="' + (m === defMethod ? 'on' : '') + '" data-a="pmPick" data-v="' + m + '">' + m + '</button>').join('') + '</div><input type="hidden" name="payMethod" value="' + defMethod + '">') +
    '<div id="pmCharges" class="' + (mm ? '' : 'hide') + '">' +
      '<div class="grid2">' + field('Withdrawal / MoMo charges (F)', inp('payFee', sug || '', 'inputmode="numeric" id="payFee" placeholder="0"')) +
        '<div class="field"><label class="lbl">Customer sends</label><div class="inp" id="payGross" style="display:flex;align-items:center;background:var(--bg, #f6f6f6)">' + F(num(defAmount) + sug) + '</div></div></div>' +
      '<div class="tiny muted" style="margin-top:-4px;margin-bottom:8px">Sale amount pays the receipt. Charges are the operator fee (MTN / Orange) — kept as a separate column. Suggested from Settings → fee table; you can edit.</div>' +
    '</div>' +
    '<div class="grid2" id="pmExtra">' + field('Money sent to (number)', '<select class="inp" name="payAccount" id="payAccount">' + accountOpts(defMethod).map(([v, l]) => '<option value="' + esc(v) + '">' + esc(l) + '</option>').join('') + '<option value="__other">Other number…</option></select>') +
      field('Transaction ID', inp('payRef', '', 'id="payRef" placeholder="' + (mm ? 'Required — MoMo txn ID' : 'Optional ref') + '"')) + '</div>' +
    '<div id="payAccOther" class="hide">' + field('Other receiving number', inp('payAccountOther', '', 'inputmode="tel"')) + '</div></div>';
}
function syncPayCharges(root) {
  if (!root) return;
  const method = ($('[name=payMethod]', root) || {}).value || 'Cash';
  const mm = KC.isMobileMoney(method);
  const box = $('#pmCharges', root); if (box) box.classList.toggle('hide', !mm);
  const amtEl = $('#payAmount', root), feeEl = $('#payFee', root), gross = $('#payGross', root), refEl = $('#payRef', root);
  if (refEl) refEl.placeholder = mm ? 'Required — MoMo txn ID' : 'Optional ref';
  if (!mm) { if (feeEl) feeEl.value = ''; if (gross) gross.textContent = '—'; return; }
  const amount = num(amtEl && amtEl.value);
  if (feeEl && (feeEl.dataset.auto !== '0' || feeEl.value === '')) {
    feeEl.value = KC.calcMomoFee(method, amount, S()) || '';
    feeEl.dataset.auto = '1';
  }
  if (gross) gross.textContent = F(amount + num(feeEl && feeEl.value));
}
A.pmPick = (el) => {
  const root = el.closest('.sheet'); $$('#pm button', root).forEach((b) => b.classList.toggle('on', b === el));
  $('[name=payMethod]', root).value = el.dataset.v;
  $('#payAccount', root).innerHTML = accountOpts(el.dataset.v).map(([v, l]) => '<option value="' + esc(v) + '">' + esc(l) + '</option>').join('') + '<option value="__other">Other number…</option>';
  $('#pmExtra', root).style.opacity = el.dataset.v === 'Cash' ? .5 : 1;
  const feeEl = $('#payFee', root); if (feeEl) feeEl.dataset.auto = '1';
  syncPayCharges(root);
};
CH.payAcc = () => { };
document.addEventListener('change', (e) => { if (e.target.id === 'payAccount') { const r = e.target.closest('.sheet'); $('#payAccOther', r).classList.toggle('hide', e.target.value !== '__other'); } });
document.addEventListener('input', (e) => {
  if (e.target.id === 'payAmount') { const r = e.target.closest('.sheet'); const feeEl = $('#payFee', r); if (feeEl) feeEl.dataset.auto = '1'; syncPayCharges(r); }
  if (e.target.id === 'payFee') { e.target.dataset.auto = '0'; const r = e.target.closest('.sheet'); const gross = $('#payGross', r); if (gross) gross.textContent = F(num(($('#payAmount', r) || {}).value) + num(e.target.value)); }
});
function readPayment(v) {
  const amount = num(v.payAmount); if (!amount) return null;
  const method = v.payMethod || 'Cash';
  const fee = KC.isMobileMoney(method) ? Math.max(0, num(v.payFee)) : 0;
  const p = { id: uid('p_'), date: v.payDate || todayStr(), method, account: v.payAccount === '__other' ? v.payAccountOther : v.payAccount || '', ref: String(v.payRef || '').trim(), amount, fee, by: K.me.name || K.info.userLabel || '', byId: K.me.id || '', at: new Date().toISOString() };
  const err = KC.validatePayment(p, S());
  if (err) { toast(err, true); return false; }
  return p;
}
function applySaleTxnId(sale) {
  const txn = KC.saleTxnId(sale);
  if (txn) sale.txnId = txn; else delete sale.txnId;
  return sale;
}

A.checkout = () => {
  if (!K.cart.lines.length) return;
  if (K.cart.lines.some((l) => !num(l.qty))) return toast('Remove lines with quantity 0', true);
  const editing = K.cart.editingId && byId('sales', K.cart.editingId);
  const el = openSheet({ title: editing ? 'Update sale ' + editing.no : 'Payment', body: '', foot: '' });
  el._refresh = () => {
    const cu = K.cart.customerId && byId('customers', K.cart.customerId);
    const sub = cartTotal(), disc = num(K.cart.discount), total = sub - disc;
    const t = editing ? KC.saleTotals(editing) : null;
    const due = editing ? total - t.paid : total;
    setSheetBody(el, '<div class="col">' +
      '<div class="cust-pill" data-a="pickCustomer">' + (cu ? '<div class="av">' + esc(initials(cu.name)) + '</div><div class="grow"><div class="b">' + esc(cu.name) + '</div><div class="tiny muted">' + esc(cu.phone || '') + creditTag(cu) + '</div></div>' : '<div class="av">' + ic('users', 'sm') + '</div><div class="grow b">Walk-in customer — tap to select</div>') + ic('chev', 'sm') + '</div>' +
      '<div class="card pad"><div class="row between"><span class="muted">Subtotal (' + cartCount() + ' items)</span><span class="money b">' + F(sub) + '</span></div>' +
      (can('discount') ? '<div class="row between mt"><span class="muted">Discount (F)</span><input class="inp price-in" inputmode="numeric" id="discIn" value="' + (disc || '') + '" placeholder="0"></div>' : '') +
      '<hr class="sep"><div class="row between"><span class="b">Total</span><span class="money b" style="font-size:22px" id="totOut">' + F(total) + '</span></div>' +
      (editing ? '<div class="row between small mt"><span class="muted">Already paid</span><span class="money">' + F(t.paid) + '</span></div>' : '') + '</div>' +
      '<div class="grid2">' + field('Sale date', inp('saleDate', editing ? saleDate(editing) : todayStr(), 'type="date"')) + field('Picked up?', sel('delivered', [['yes', 'Yes, collected now'], ['no', 'No — reserve / hold']], editing ? (editing.delivered ? 'yes' : 'no') : 'yes')) + '</div>' +
      (can('payments') ? '<h3 class="mt">Payment ' + (editing ? '(additional)' : '') + '</h3><div class="tiny muted" style="margin-top:-6px">Enter less than the total for a deposit, or 0 for an unpaid reserved order.</div>' + payFields(Math.max(0, due)) : '<div class="alert info">The order will be saved unpaid. A cashier records the payment.</div>') +
      field('If not fully paid: pay by', inp('dueDate', editing && editing.dueDate ? editing.dueDate : KC.addDays(todayStr(), num(S().creditDays) || 14), 'type="date"')) +
      field('Note (optional)', inp('notes', editing ? editing.notes : '')) + '</div>');
    if ($('#discIn', el)) $('#discIn', el).addEventListener('input', (e) => { K.cart.discount = Math.max(0, num(e.target.value)); const tt = cartTotal() - K.cart.discount; $('#totOut', el).textContent = F(tt); const pa = $('#payAmount', el); if (pa) { pa.value = Math.max(0, editing ? tt - t.paid : tt); const feeEl = $('#payFee', el); if (feeEl) feeEl.dataset.auto = '1'; syncPayCharges(el); } saveCart(); });
    syncPayCharges(el);
  };
  el._refresh();
  $('.sf', el) || el.querySelector('.sheet').insertAdjacentHTML('beforeend', '<div class="sf"></div>');
  $('.sf', el).innerHTML = '<button class="btn grow" data-a="sheetClose">Back</button><button class="btn pri grow lg" id="doSell">' + ic('check') + (editing ? 'Update sale' : 'Complete sale') + '</button>';
  $('#doSell', el).onclick = async (e) => { e.target.disabled = true; const ok = await completeSale(formVals(el)); if (!ok) e.target.disabled = false; };
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
    lines.push({ productId: l.productId, name: (byId('products', l.productId) || l).name, qty: num(l.qty), unitPrice: num(l.unitPrice), alloc, returns: [] });
  }
  const cu = K.cart.customerId && byId('customers', K.cart.customerId);
  let pay = null;
  if (can('payments')) {
    if (num(v.payAmount)) { pay = readPayment(v); if (pay === false) return false; }
  }
  const total = cartTotal() - num(K.cart.discount);
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
    lines, discount: num(K.cart.discount), delivered: v.delivered !== 'no', notes: v.notes || '', locationId: K.loc,
  });
  if (remaining > 0.5) sale.dueDate = v.dueDate || KC.addDays(sale.date, num(S().creditDays) || 14); else delete sale.dueDate;
  sale.payments = (sale.payments || []).slice(); if (pay) sale.payments.push(pay);
  applySaleTxnId(sale);
  if (!(await save('sales', sale))) return false;
  if (cu) save('customers', Object.assign({}, cu));
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
  (s.lines || []).forEach((l) => L.push('• ' + l.name + '\n   ' + l.qty + ' × ' + fmt(l.unitPrice) + ' = ' + F(l.qty * l.unitPrice)));
  L.push('');
  if (t.discount) L.push('Subtotal: ' + F(t.subtotal), 'Discount: −' + F(t.discount));
  if (t.returned) L.push('Returned: −' + F(t.returned));
  L.push('*TOTAL: ' + F(t.net) + '*', 'Paid: ' + F(t.paid));
  if (t.balance > 0) L.push('*Balance due: ' + F(t.balance) + '*');
  (s.payments || []).forEach((p) => L.push('  ' + fmtDate(p.date) + ' ' + p.method + (p.account ? ' → ' + p.account : '') + (p.ref ? ' · txn ' + p.ref : '') + ': ' + F(p.amount) + (num(p.fee) > 0 ? ' + ' + F(p.fee) + ' charges' : '')));
  if (t.fees > 0) L.push('MoMo charges total: ' + F(t.fees));
  if (t.txnId) L.push('Transaction ID: ' + t.txnId);
  if (!s.delivered) L.push('', '⏳ Items reserved — awaiting pickup');
  if (st.receiptFooter) L.push('', st.receiptFooter);
  return L.join('\n');
}
function receiptHTML(s) {
  const st = S(), t = K.C.saleX[s.id] || KC.saleTotals(s);
  return '<div class="receipt" id="rcpt"><div class="rh"><div class="rlogo">' + (st.logo ? '<img src="' + esc(st.logo) + '">' : esc(initials(st.businessName).slice(0, 2))) + '</div><div class="b" style="font-size:17px">' + esc(st.businessName) + '</div>' +
    (st.tagline ? '<div class="tiny muted">' + esc(st.tagline) + '</div>' : '') + '<div class="tiny muted">' + esc([st.address, st.phone].filter(Boolean).join(' · ')) + '</div></div>' +
    '<div class="row between small"><span class="muted">Receipt</span><b>' + esc(s.no) + '</b></div><div class="row between small"><span class="muted">Date</span><span>' + fmtDate(saleDate(s)) + '</span></div><div class="row between small mb"><span class="muted">Customer</span><span class="b">' + esc(s.customerName) + '</span></div>' +
    '<table>' + (s.lines || []).map((l) => { const rq = (l.returns || []).reduce((a, r) => a + num(r.qty), 0); return '<tr><td><div class="b">' + esc(l.name) + '</div><div class="tiny muted">' + l.qty + ' × ' + fmt(l.unitPrice) + (rq ? ' · ' + rq + ' returned' : '') + '</div></td><td class="right money nowrap">' + fmt(l.qty * l.unitPrice) + '</td></tr>'; }).join('') +
    (t.discount ? '<tr><td class="muted">Discount</td><td class="right money">−' + fmt(t.discount) + '</td></tr>' : '') + (t.returned ? '<tr><td class="muted">Returns</td><td class="right money">−' + fmt(t.returned) + '</td></tr>' : '') +
    '<tr class="tot"><td>TOTAL</td><td class="right money">' + F(t.net) + '</td></tr><tr><td class="muted">Paid</td><td class="right money">' + F(t.paid) + '</td></tr>' +
    (t.balance > 0 ? '<tr><td class="b" style="color:var(--bad)">Balance due</td><td class="right money b" style="color:var(--bad)">' + F(t.balance) + '</td></tr>' : '') + '</table>' +
    ((s.payments || []).length ? '<div class="tiny muted mt">' + s.payments.map((p) => esc(fmtDate(p.date) + ' · ' + p.method + (p.account ? ' → ' + p.account : '') + (p.ref ? ' · txn ' + p.ref : '') + ': ' + F(p.amount) + (num(p.fee) > 0 ? ' + ' + F(p.fee) + ' charges' : ''))).join('<br>') + (t.fees > 0 ? '<br>MoMo charges total: ' + F(t.fees) : '') + '</div>' : '') +
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
  const h = 95 + lines.length * 9 + (s.payments || []).length * 5;
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
    doc.setFont('helvetica', 'normal'); doc.text(l.qty + ' x ' + fmt(l.unitPrice), 5, y); y += 5;
  });
  doc.line(5, y, 75, y); y += 5;
  const row = (a, b, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.text(a, 5, y); doc.text(b, 75, y, { align: 'right' }); y += 5; };
  if (t.discount) row('Discount', '-' + fmt(t.discount));
  if (t.returned) row('Returns', '-' + fmt(t.returned));
  doc.setFontSize(11); row('TOTAL (' + baseCode() + ')', fmt(t.net), true); doc.setFontSize(8);
  row('Paid', fmt(t.paid)); if (t.balance > 0) row('Balance due', fmt(t.balance), true);
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
    let list = K.ui.salesStatus === 'owing' || K.ui.salesStatus === 'pickup' ? visibleSales().slice() : salesInRange();
    const st = K.ui.salesStatus, q = K.ui.salesQ.toLowerCase();
    list = list.filter((s) => { const x = K.C.saleX[s.id]; return st === 'all' ? true : st === 'owing' ? x.status === 'partial' || x.status === 'unpaid' : st === 'pickup' ? !s.delivered && x.status !== 'cancelled' : st === 'cancelled' ? x.status === 'cancelled' : true; })
      .filter((s) => !q || (s.no + ' ' + (s.txnId || '') + ' ' + s.customerName + ' ' + s.customerPhone + ' ' + (s.payments || []).map((p) => p.ref || '').join(' ') + ' ' + (s.lines || []).map((l) => l.name).join(' ')).toLowerCase().includes(q))
      .sort((a, b) => (saleDate(b) + b.createdAt).localeCompare(saleDate(a) + a.createdAt));
    const live = list.filter((s) => K.C.saleX[s.id].status !== 'cancelled');
    const tot = live.reduce((a, s) => a + K.C.saleX[s.id].net, 0), paid = live.reduce((a, s) => a + K.C.saleX[s.id].paid, 0), bal = live.reduce((a, s) => a + Math.max(0, K.C.saleX[s.id].balance), 0), prof = live.reduce((a, s) => a + K.C.saleX[s.id].profit, 0);
    const R = [['today', 'Today'], ['yday', 'Yesterday'], ['week', '7 days'], ['month', 'This month'], ['all', 'All']];
    const SS = [['all', 'All'], ['owing', 'Owing'], ['pickup', 'Awaiting pickup'], ['cancelled', 'Cancelled']];
    return (can('sell') ? '<a class="btn pri lg block mb mob-block" href="#sell">' + ic('sell') + 'New sale</a>' : '') + (!can('salesAll') ? '<div class="alert info mb">Showing your own sales only.</div>' : '') + '<div class="row wrap between mb"><div class="seg">' + R.map(([k, l]) => '<button class="' + (K.ui.salesRange === k ? 'on' : '') + '" data-a="salesRange" data-v="' + k + '">' + l + '</button>').join('') + '</div>' + (can('sell') ? '<a class="btn pri" href="#sell">' + ic('plus') + 'New sale</a>' : '') + (can('export') ? '<button class="btn" data-a="exportSales">' + ic('dl') + 'Excel</button>' : '') + '</div>' +
      '<div class="chips mb">' + SS.map(([k, l]) => '<button class="chip' + (st === k ? ' on' : '') + '" data-a="salesStatus" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      '<div class="kpis mb">' + kpi('Sales', F(tot), live.length + ' receipt(s)', true) + kpi('Collected', F(paid)) + kpi('Balance owed', F(bal)) + (seeCost() ? kpi('Gross profit', F(prof), tot ? pct(prof / tot * 100) + ' margin' : '') : kpi('Items', fmt(live.reduce((a, s) => a + (s.lines || []).reduce((b, l) => b + num(l.qty), 0), 0)))) + '</div>' +
      '<div class="search mb">' + ic('search') + '<input class="inp" placeholder="Search customer, receipt no., item" value="' + esc(K.ui.salesQ) + '" data-i="salesQ"></div>' +
      '<div class="card list" id="salesList">' + salesRows(list) + '</div>';
  },
};
function salesRows(list) {
  if (!list.length) return '<div class="empty"><div class="big">🧾</div>No sales here yet.</div>';
  return list.slice(0, 300).map((s) => {
    const x = K.C.saleX[s.id]; const n = (s.lines || []).reduce((a, l) => a + num(l.qty), 0);
    return '<div class="li" data-a="openSale" data-id="' + s.id + '"><div class="av">' + esc(initials(s.customerName)) + '</div><div class="grow" style="min-width:0"><div class="t ellipsis">' + esc(s.customerName) + '</div><div class="tiny muted ellipsis">' + esc(s.no) + (x.txnId ? ' · txn ' + esc(x.txnId) : '') + ' · ' + fmtDate(saleDate(s)) + ' · ' + n + ' item(s)</div></div>' +
      '<div class="right"><div class="b money">' + F(x.net) + '</div><div class="row gap4" style="justify-content:flex-end;margin-top:3px">' + (allLocs().length > 1 ? '<span class="badge">' + esc(locName(s.locationId)) + '</span>' : '') + (!s.delivered && x.status !== 'cancelled' ? '<span class="badge info">Pickup</span>' : '') + statusBadge(x.status) + '</div>' + (x.balance > 0 && x.status !== 'cancelled' ? '<div class="tiny" style="color:var(--bad)">owes ' + fmt(x.balance) + (KC.dueDateOf(s, S()) < todayStr() ? ' · overdue' : '') + '</div>' : '') + '</div></div>';
  }).join('');
}
A.salesRange = (el) => { K.ui.salesRange = el.dataset.v; if (K.ui.salesStatus === 'owing' || K.ui.salesStatus === 'pickup') K.ui.salesStatus = 'all'; render(true); };
A.salesStatus = (el) => { K.ui.salesStatus = el.dataset.v; render(true); };
I.salesQ = (el) => { K.ui.salesQ = el.value; clearTimeout(I._sq); I._sq = setTimeout(() => { const v = VIEWS.sales.render(); const tmp = document.createElement('div'); tmp.innerHTML = v; $('#salesList').innerHTML = $('#salesList', tmp).innerHTML; }, 150); };

/* ---------- sale detail ---------- */
A.openSale = (el) => openSale(el.dataset.id);
function openSale(id) {
  const el = openSheet({ title: 'Sale', body: '', wide: false });
  el._refresh = () => {
    const s = byId('sales', id); if (!s) return closeSheet();
    const x = K.C.saleX[s.id]; const cancelled = x.status === 'cancelled';
    const hasReturns = (s.lines || []).some((l) => (l.returns || []).length);
    $('.sh h2', el).textContent = 'Sale ' + s.no;
    setSheetBody(el, '<div class="row between mb"><div><div class="b" style="font-size:17px">' + esc(s.customerName) + '</div><div class="tiny muted">' + fmtDate(saleDate(s)) + ' · by ' + esc(s.createdBy || '—') + (s.customerPhone ? ' · ' + esc(s.customerPhone) : '') + (allLocs().length > 1 ? ' · ' + esc(locName(s.locationId)) : '') + (x.txnId ? ' · txn ' + esc(x.txnId) : '') + (x.balance > 0 && !cancelled ? ' · <b>pay by ' + fmtDate(KC.dueDateOf(s, S())) + '</b>' : '') + '</div></div><div class="col gap4" style="align-items:flex-end">' + statusBadge(x.status) + (!s.delivered && !cancelled ? '<span class="badge info">Awaiting pickup</span>' : '') + '</div></div>' +
      '<div class="card"><table class="t"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead><tbody>' +
      (s.lines || []).map((l) => { const rq = (l.returns || []).reduce((a, r) => a + num(r.qty), 0); return '<tr><td>' + esc(l.name) + (rq ? '<div class="tiny" style="color:var(--warn)">' + rq + ' returned</div>' : '') + '</td><td class="r">' + l.qty + '</td><td class="r money">' + fmt(l.unitPrice) + '</td><td class="r money">' + fmt(l.qty * l.unitPrice) + '</td></tr>'; }).join('') +
      '</tbody></table><div class="pad"><div class="row between small"><span class="muted">Subtotal</span><span class="money">' + F(x.subtotal) + '</span></div>' + (x.discount ? '<div class="row between small"><span class="muted">Discount</span><span class="money">−' + F(x.discount) + '</span></div>' : '') + (x.returned ? '<div class="row between small"><span class="muted">Returns</span><span class="money">−' + F(x.returned) + '</span></div>' : '') +
      '<div class="row between b mt"><span>Total</span><span class="money" style="font-size:18px">' + F(x.net) + '</span></div><div class="row between small"><span class="muted">Paid</span><span class="money">' + F(x.paid) + '</span></div>' + (x.fees > 0 ? '<div class="row between small"><span class="muted">MoMo charges</span><span class="money">' + F(x.fees) + '</span></div>' : '') + (x.balance > 0 && !cancelled ? '<div class="row between b" style="color:var(--bad)"><span>Balance due</span><span class="money">' + F(x.balance) + '</span></div>' : '') +
      (seeCost() && !cancelled ? '<div class="row between small mt"><span class="muted">Cost of goods · profit</span><span class="money">' + F(x.cogs) + ' · <b style="color:var(--ok)">' + F(x.profit) + '</b></span></div>' : '') + '</div></div>' +
      '<h3 class="mt mb">Payments</h3><div class="card list">' + ((s.payments || []).length ? s.payments.map((p) => '<div class="li" style="cursor:default"><div class="av ' + (p.amount < 0 ? 'acc' : '') + '">' + ic('wallet', 'sm') + '</div><div class="grow"><div class="t">' + esc(p.method) + (p.amount < 0 ? ' (refund)' : '') + '</div><div class="tiny muted">' + fmtDate(p.date) + (p.account ? ' · to ' + esc(p.account) : '') + (p.ref ? ' · txn ' + esc(p.ref) : '') + (p.by ? ' · ' + esc(p.by) : '') + (num(p.fee) > 0 ? ' · charges ' + F(p.fee) : '') + '</div></div><div class="right"><div class="b money">' + F(p.amount) + '</div>' + (num(p.fee) > 0 ? '<div class="tiny muted">+' + fmt(p.fee) + ' fee</div>' : '') + '</div>' + (can('cancel') ? '<button class="icon-btn" data-a="payDel" data-s="' + s.id + '" data-p="' + p.id + '">' + ic('trash', 'sm') + '</button>' : '') + '</div>').join('') : '<div class="empty small">No payment yet.</div>') + '</div>' +
      (s.notes ? '<div class="alert info mt">' + esc(s.notes) + '</div>' : '') +
      '<div class="grid2 mt2">' +
      (!cancelled && x.balance > 0 && can('payments') ? '<button class="btn pri" data-a="addPay" data-id="' + s.id + '">' + ic('wallet') + 'Add payment</button>' : '') +
      (!cancelled && !s.delivered ? '<button class="btn" data-a="markPicked" data-id="' + s.id + '">' + ic('check') + 'Mark picked up</button>' : '') +
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
  K.cart = { editingId: s.id, customerId: s.customerId, discount: num(s.discount), lines: s.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, manual: true })) };
  if ((s.locationId || 'main') !== K.loc) { if (!myLocs().find((x) => x.id === (s.locationId || 'main'))) { toast('This sale belongs to another location', true); K.cart = { lines: [], customerId: null, editingId: null, discount: 0 }; return; } K.loc = s.locationId || 'main'; fixLoc(); }
  saveCart(); while (K.sheets.length) closeSheet(); go('sell');
};
A.cancelSale = async (el) => {
  const s = byId('sales', el.dataset.id); const x = K.C.saleX[s.id];
  const why = await askReason('Cancel sale ' + s.no + '? Items go back to stock.' + (x.paid > 0 ? ' A refund of ' + F(x.paid) + ' will be recorded.' : ''), ['Customer changed mind', 'Wrong entry / mistake', 'Duplicate sale', 'Customer did not pay', 'Other'], 'Cancel sale'); if (why === null) return;
  // refund each way the customer paid (MoMo back to MoMo, cash back as cash) so cash handovers stay correct
  const pays = (s.payments || []).slice(); const byM = {}; pays.forEach((p) => (byM[p.method || 'Cash'] = (byM[p.method || 'Cash'] || 0) + num(p.amount)));
  Object.entries(byM).forEach(([m, amt]) => { if (amt > 0.5) pays.push({ id: uid('p_'), date: todayStr(), method: m, amount: -amt, ref: 'Refund on cancel', by: K.me.name || '', byId: K.me.id || '', at: new Date().toISOString() }); });
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
      '<div class="grid2">' + field('Refund amount (F)', inp('refund', '', 'inputmode="numeric" id="refundAmt"')) + field('Refund method', sel('refMethod', KC.PAY_METHODS, 'Cash')) + '</div><div class="tiny muted">Leave refund at 0 for an exchange or credit.</div>' + field('Reason', sel('reason', KC.RETURN_REASONS, KC.RETURN_REASONS[0])) + field('Details (optional)', inp('reasonNote', '')) + '</div>',
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
    if (num(v.refund) > 0) cur.payments = (cur.payments || []).concat([{ id: uid('p_'), date: todayStr(), method: v.refMethod, amount: -num(v.refund), ref: 'Refund: ' + (v.reason || 'return'), by: K.me.name || '', byId: K.me.id || '', at: new Date().toISOString() }]);
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
