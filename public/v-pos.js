/* Aahsso — POS mode: a full-screen counter screen for touch terminals (Android POS, touch PC, tablet) and phones.
 * Big product tiles by category (with "Popular"), a barcode scanner works anywhere on the screen, the cart on the
 * side, one tap to take Cash / MTN MoMo / Orange Money, then the receipt prints (Printer, print.js).
 * Uses the same cart and sale rules as "New sale" (v-sell.js: addToCart, completeSale…), so stock, prices, promotions,
 * approvals and offline saving behave the same. */
const POS_KEY = 'aahsso-pos';
const posPrefs = () => { try { return Object.assign({ start: false }, JSON.parse(localStorage.getItem(POS_KEY) || '{}')); } catch (e) { return { start: false }; } };
const setPosPrefs = (p) => { try { localStorage.setItem(POS_KEY, JSON.stringify(Object.assign(posPrefs(), p))); } catch (e) { } };
// a till set to "open POS on start": straight to the POS screen
try { if (posPrefs().start && (!location.hash || location.hash === '#home')) history.replaceState(null, '', '#pos'); } catch (e) { }

const POS = { cat: '', last: null, wake: null };
/** the most sold items of the last 30 days (the "Popular" tab — what the counter sells all day) */
function posPopular() {
  const from = KC.addDays(todayStr(), -30); const n = {};
  (K.raw.sales || []).forEach((s) => { if (s.status === 'cancelled' || saleDate(s) < from) return; (s.lines || []).forEach((l) => { n[l.productId] = (n[l.productId] || 0) + num(l.qty); }); });
  return Object.keys(n).sort((a, b) => n[b] - n[a]).slice(0, 24);
}
function posItems() {
  K.ui.posCat = POS.cat === '★' ? '' : POS.cat;
  let ps = posProducts();
  if (POS.cat === '★' && !K.ui.posQ) { const top = posPopular(); ps = top.map((id) => ps.find((p) => p.id === id)).filter(Boolean); }
  return ps;
}
function posCats() {
  const inStock = K.raw.products.filter((p) => !p.archived && availFor(p.id) > 0);
  const cats = [...new Set(inStock.map((p) => p.category || 'Other'))].sort();
  return (posPopular().length ? [['★', 'Popular']] : []).concat([['', 'All']], cats.map((c) => [c, c]));
}
function posTiles() {
  const ps = posItems().slice(0, 240);
  if (!ps.length) return '<div class="pos-empty">' + (K.ui.posQ ? 'Nothing in stock matches “' + esc(K.ui.posQ) + '”.' : 'Nothing in stock here yet.' + (can('purchases') ? ' <a href="#buy">Buy stock</a>' : '')) + '</div>';
  return ps.map((p) => {
    const px = K.C.prodX[p.id] || {}; const q = cartQty(p.id); const left = availFor(p.id) - q; const src = imgSrc(p.image);
    const price = px.promo ? px.promo.price : px.priceMax;
    return '<button type="button" class="pos-t' + (q ? ' in' : '') + (left <= 0 ? ' out' : '') + '" data-a="posAdd" data-id="' + p.id + '"' + (left <= 0 ? ' aria-disabled="true"' : '') + '>' +
      (q ? '<span class="pos-q">' + q + '</span>' : '') +
      (src ? '<span class="pos-img"><img src="' + esc(src) + '" alt="" loading="lazy"></span>' : '<span class="pos-img ph" style="background:' + catColor(p.category) + '">' + esc(initials(p.name)) + '</span>') +
      '<span class="pos-n">' + esc(p.name) + '</span><span class="pos-p money">' + fmt(price) + (px.promo ? ' <s>' + fmt(px.priceMax) + '</s>' : '') + '</span>' +
      '<span class="pos-s">' + (left <= 0 ? 'Sold out' : qtyTxt(left, ' left')) + '</span></button>';
  }).join('');
}
function posCartLines() {
  const c = K.cart;
  if (!c.lines.length) return '<div class="pos-cempty">' + ic('sell') + '<div>Tap an item or scan a barcode</div></div>';
  return c.lines.map((l, i) => {
    const p = byId('products', l.productId) || { name: l.name }; const st = lineStep(l); const pks = KC.packsOf(p);
    return '<div class="pos-l"><div class="pos-ln"><b>' + esc(p.name) + '</b><span class="money">' + fmt(num(l.qty) * num(l.unitPrice)) + '</span></div>' +
      '<div class="pos-lr"><div class="pos-step"><button type="button" data-a="cartStep" data-i2="' + i + '" data-d="-1" aria-label="One less">' + ic('minus') + '</button><span>' + (num(l.qty) / st) + (l.pack ? ' ' + esc(l.pack.name) : '') + '</span><button type="button" data-a="cartStep" data-i2="' + i + '" data-d="1" aria-label="One more">' + ic('plus') + '</button></div>' +
      (pks.length ? '<button type="button" class="pos-pk" data-a="posPack" data-i2="' + i + '">' + (l.pack ? 'by ' + esc(p.unit || 'piece') : 'by ' + esc(pks[0].name)) + '</button>' : '') +
      '<span class="tiny muted">@ ' + fmt(num(l.unitPrice) * st) + '</span><button type="button" class="pos-del" data-a="cartDel" data-i2="' + i + '" aria-label="Remove">' + ic('trash', 'sm') + '</button></div></div>';
  }).join('');
}
function posPanel() {
  const c = K.cart; const cu = c.customerId && byId('customers', c.customerId); const sub = cartTotal(); const disc = num(c.discount); const tot = Math.max(0, sub - disc); const n = cartCount();
  const pay = can('payments');
  return '<div class="pos-ch"><button type="button" class="pos-cu" data-a="pickCustomer">' + ic('users', 'sm') + '<span class="ellipsis">' + (cu ? esc(cu.name) : 'Walk-in customer') + '</span></button>' + (c.lines.length ? '<button type="button" class="btn ghost sm" data-a="posClear">Clear</button>' : '') + '</div>' +
    '<div class="pos-lines" id="posLines">' + posCartLines() + '</div>' +
    '<div class="pos-foot">' +
      (disc ? '<div class="pos-row"><span>Subtotal</span><span class="money">' + fmt(sub) + '</span></div><div class="pos-row"><span>Discount</span><span class="money">−' + fmt(disc) + '</span></div>' : '') +
      '<div class="pos-tot"><span>' + (n ? n + ' item' + (n === 1 ? '' : 's') : 'Total') + '</span><b class="money">' + F(tot) + '</b></div>' +
      (pay ? '<div class="pos-pay">' +
        '<button type="button" class="pos-pb cash" data-a="posPay" data-m="Cash"' + (n ? '' : ' disabled') + '>' + ic('wallet') + 'Cash</button>' +
        '<button type="button" class="pos-pb momo" data-a="posPay" data-m="Mobile Money"' + (n ? '' : ' disabled') + '>' + ic('phone') + 'Mobile Money</button></div>' : '') +
      '<div class="pos-more">' + (canOrAsk('discount') ? '<button type="button" class="btn sm" data-a="posDisc"' + (n ? '' : ' disabled') + '>Discount</button>' : '') +
        '<button type="button" class="btn sm" data-a="checkout"' + (n ? '' : ' disabled') + '>' + (pay ? 'Credit, deposit, delivery…' : 'Save for the cashier') + '</button></div>' +
    '</div>';
}
VIEWS.pos = {
  render() {
    if (!can('sell')) return '<div class="card empty">You cannot record sales.</div>';
    const pr = Printer.prefs();
    return '<div class="pos" id="pos">' +
      '<section class="pos-left">' +
        '<div class="pos-bar"><div class="search pos-search">' + ic('search') + '<input class="inp" id="posQ" placeholder="Search or scan a barcode" autocomplete="off" aria-label="Search items" value="' + esc(K.ui.posQ || '') + '"></div>' +
          '<button type="button" class="pos-ib" data-a="printerSettings" title="Receipt printer: ' + (pr.method === 'rawbt' ? 'Bluetooth (RawBT)' : 'this device') + ', ' + pr.paper + ' mm' + (pr.auto ? ', prints after each sale' : '') + '">' + ic('gear') + '<span class="pos-ibt">Printer</span></button>' +
          '<button type="button" class="pos-ib" data-a="posFull" title="Full screen">' + ic('up') + '<span class="pos-ibt">Full screen</span></button>' +
          '<button type="button" class="pos-ib" data-a="posExit" title="Leave POS mode">' + ic('x') + '<span class="pos-ibt">Exit</span></button></div>' +
        '<div class="pos-cats" id="posCats" role="tablist">' + posCats().map(([k, l]) => '<button type="button" role="tab" class="' + (POS.cat === k ? 'on' : '') + '" data-a="posCat" data-v="' + esc(k) + '">' + esc(l) + '</button>').join('') + '</div>' +
        '<div class="pos-grid" id="posGrid">' + posTiles() + '</div>' +
      '</section>' +
      '<aside class="pos-cart" id="posCart">' + posPanel() + '</aside>' +
      '<div class="pos-mbar" id="posMbar"></div>' +
    '</div>';
  },
  after() { posRefresh(); posWake(true); },
};
/** redraw the parts that change on a tap (not the whole page: no flicker, the search keeps its focus) */
function posRefresh() {
  if (K.route !== 'pos' || !$('#pos')) return;
  $('#posGrid').innerHTML = posTiles(); $('#posCart').innerHTML = posPanel();
  const n = cartCount();
  $('#posMbar').innerHTML = n ? '<button type="button" class="pos-mb" data-a="posCartSheet"><span>' + n + ' item' + (n === 1 ? '' : 's') + '</span><b class="money">' + F(Math.max(0, cartTotal() - num(K.cart.discount))) + '</b><span class="pos-mgo">Pay ' + ic('chev', 'sm') + '</span></button>' : '';
  const cs = K.sheets.find((s) => s._posCart); if (cs) setSheetBody(cs, posPanel());
}
A.posAdd = (el) => { if (el.getAttribute('aria-disabled') === 'true') return toast('Sold out', true); addToCart(el.dataset.id); el.classList.add('tap'); setTimeout(() => el.classList.remove('tap'), 180); };
A.posCat = (el) => { POS.cat = el.dataset.v; $$('#posCats button').forEach((b) => b.classList.toggle('on', b === el)); $('#posGrid').innerHTML = posTiles(); $('#posGrid').scrollTop = 0; };
A.posClear = async () => { if (K.cart.lines.length > 1 && !(await confirmBox('Clear the cart?', 'Clear'))) return; A.cartClear(); };
A.posPack = (el) => { const l = K.cart.lines[+el.dataset.i2]; A.cartUnit({ dataset: { i2: el.dataset.i2, v: l.pack ? '-1' : '0' } }); }; // by the bottle ⇄ by the crate
A.posCartSheet = () => { const sh = openSheet({ title: 'Cart', body: posPanel() }); sh._posCart = true; sh.classList.add('pos-sheet'); };
A.posExit = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); go(can('salesAll') || can('payments') ? 'sales' : 'home'); };
A.posFull = () => { const d = document.documentElement; if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); else if (d.requestFullscreen) d.requestFullscreen().catch(() => toast('Full screen is not available on this device', true)); };
A.posDisc = () => {
  const sub = cartTotal();
  const sh = openSheet({ title: 'Discount', body: '<div class="col">' + field('Discount (' + baseSym() + ')', inp('posD', num(K.cart.discount) || '', 'inputmode="numeric" placeholder="0"')) +
    '<div class="row wrap gap6">' + [5, 10, 15, 20].map((p) => '<button type="button" class="btn sm" data-pct="' + p + '">' + p + '%</button>').join('') + '</div>' + (can('discount') ? '' : '<p class="tiny muted">A manager approves it when the sale is saved.</p>') + '</div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="posDOk">Apply</button>' });
  sh.addEventListener('click', (e) => { const b = e.target.closest('[data-pct]'); if (b) $('[name=posD]', sh).value = Math.round(sub * +b.dataset.pct / 100); });
  $('#posDOk', sh).onclick = () => { K.cart.discount = Math.min(sub, Math.max(0, num(formVals(sh).posD))); saveCart(); closeSheet(); posRefresh(); };
};
/** take the payment: cash (with change), or Mobile Money — our number on the screen for the customer to send to, their number (MTN / Orange from it), the transaction ID if they have it; a tip and the customer's name / phone, both optional */
A.posPay = (el) => {
  const mm = el.dataset.m !== 'Cash'; const total = Math.max(0, cartTotal() - num(K.cart.discount)); if (!total) return;
  const cu = K.cart.customerId && byId('customers', K.cart.customerId);
  const notesFor = (due) => [...new Set([due, Math.ceil(due / 500) * 500, Math.ceil(due / 1000) * 1000, Math.ceil(due / 5000) * 5000, Math.ceil(due / 10000) * 10000])].filter((x) => x >= due).slice(0, 5);
  const body = '<div class="pos-due"><span>' + (mm ? 'Mobile Money' : 'Cash') + ' · to pay</span><b class="money" id="posDue">' + F(total) + '</b><span class="pos-dtip tiny" id="posDueTip"></span></div>' +
    tipPicker(total, 0) +
    (mm
    ? '<div class="col">' + momoBox('pos', { phone: cu ? cu.phone || '' : '', cust: !cu }) + '<p class="tiny muted" id="posFee"></p></div>'
    : '<div class="col">' + field('Cash received', inp('posGiven', '', 'inputmode="numeric" id="posGiven" placeholder="' + fmt(total) + '" autocomplete="off"')) +
      '<div class="pos-notes" id="posNotes"></div>' +
      '<div class="pos-change" id="posChange"><span>Change</span><b class="money">' + F(0) + '</b></div></div>') +
    (cu || mm ? '' : custQuick('', '')); // Mobile Money: the name sits beside the number, no second phone
  const sh = openSheet({ title: mm ? 'Mobile Money' : 'Cash payment', body, foot: '<button class="btn grow" data-a="sheetClose">Back</button><button class="btn pri grow lg" id="posOk">' + ic('check') + (mm ? 'Money received — finish' : 'Paid — finish') + '</button>' });
  sh.classList.add('pos-paysheet');
  const due = () => total + tipOf(sh);
  const given = () => num(($('#posGiven', sh) || {}).value) || due();
  const net = () => momoNetOf(sh);
  const showChange = () => { const c = $('#posChange', sh); if (!c) return; const ch = given() - due(); c.classList.toggle('bad', ch < 0); c.innerHTML = '<span>' + (ch < 0 ? 'Missing' : 'Change') + '</span><b class="money">' + F(Math.abs(ch)) + '</b>'; };
  const showDue = () => {
    const d = due(), tp = tipOf(sh); $('#posDue', sh).textContent = F(d); $('#posDueTip', sh).textContent = tp ? 'incl. tip ' + fmt(tp) : '';
    const n = $('#posNotes', sh); if (n) { n.innerHTML = notesFor(d).map((x) => '<button type="button" data-given="' + x + '">' + (x === d ? 'Exact' : fmt(x)) + '</button>').join(''); $('#posGiven', sh).placeholder = fmt(d); }
    const f = $('#posFee', sh); if (f) { const fee = net() ? KC.calcMomoFee(net(), d, S()) : 0; f.textContent = fee ? 'Charges ' + F(fee) + ' — the customer sends ' + F(d + fee) : ''; }
    showChange();
  };
  sh.addEventListener('click', (e) => { const b = e.target.closest('[data-given]'); if (b) { $('#posGiven', sh).value = b.dataset.given; showChange(); } });
  sh.addEventListener('input', (e) => { if (e.target.id === 'posGiven') showChange(); if (e.target.name === 'tip') showDue(); });
  sh.addEventListener('momonet', showDue);
  showDue();
  setTimeout(() => { const f = $('#posGiven', sh) || $('[name=momoPhone]', sh); if (f && matchMedia('(pointer:fine)').matches) f.focus(); }, 80);
  $('#posOk', sh).onclick = async () => {
    const v = formVals(sh); const d = due(); const tip = tipOf(sh);
    if (!mm && given() < d) return toast('The cash received is less than the total — take more, or use “Credit, deposit…”', true);
    if (mm) { const mo = readMomo(v); if (typeof mo === 'string') { toast(mo, true); const p = $('[name=momoPhone]', sh); if (p && !p.value) p.focus(); return; } }
    const tendered = mm ? 0 : given(); const m = mm ? 'Mobile Money' : 'Cash';
    const ok = await completeSale({ payAmount: d, payMethod: m, payDate: todayStr(), momoPhone: v.momoPhone || '', momoNet: v.momoNet || '', momoWhere: 'pos', payRef: mm ? v.payRef : '', payFee: mm && net() ? KC.calcMomoFee(net(), d, S()) : 0, delivered: 'yes', saleDate: todayStr(), dueDate: '', notes: '', tip, qcName: v.qcName, qcPhone: v.qcPhone || (cu ? '' : v.momoPhone) });
    if (ok && tendered) POS.last = Object.assign(POS.last || {}, { tendered });
  };
};
/** after a sale: the change in big, print / WhatsApp, "follow us" (a QR code the customer scans), and straight back to the next customer */
function posDone(sale) {
  POS.last = { id: sale.id, tendered: 0 };
  setTimeout(() => { // completeSale tells us the cash given just after
    const t = (K.C.saleX && K.C.saleX[sale.id]) || KC.saleTotals(sale); const tend = POS.last && POS.last.id === sale.id ? POS.last.tendered : 0; const extra = tend > t.due ? { tendered: tend } : {};
    const pr = Printer.prefs(); if (pr.auto) Printer.print(sale, extra);
    const wa = phoneWA(sale.customerPhone); const so = KC.socialLinks(S());
    const sh = openSheet({ title: '✓ Sale ' + sale.no,
      body: '<div class="pos-ok"><div class="pos-okt">' + ic('check') + '</div><div class="pos-okp">' + esc(F(t.due)) + ' · ' + esc((sale.payments[0] || {}).method || '') + (t.tip ? ' <span class="tiny">(tip ' + esc(fmt(t.tip)) + ')</span>' : '') + '</div>' + (extra.tendered ? '<div class="pos-okc"><span>Change to give</span><b class="money">' + F(extra.tendered - t.due) + '</b></div>' : '') + (pr.auto ? '<div class="tiny muted">Receipt sent to the printer</div>' : '') + '</div>' +
        (so.length ? '<div class="pos-follow"><div class="pos-fh">' + ic('users', 'sm') + '<span>Invite the customer to follow you</span></div><div class="pos-fl">' + so.map((x, i) => '<button type="button" class="pos-fb" data-fi="' + i + '">' + esc(x.label) + '</button>').join('') + '</div><div class="pos-fq" id="posFq" hidden></div></div>' : ''),
      foot: '<button class="btn grow" id="posPr">' + ic('dl', 'sm') + (pr.auto ? 'Print again' : 'Print receipt') + '</button>' + (wa ? '<a class="btn grow" target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent(receiptText(sale)) + '">' + ic('wa', 'sm') + 'WhatsApp</a>' : '') + '<button class="btn pri grow lg" id="posNext">Next customer</button>' });
    sh.classList.add('pos-donesheet');
    sh.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-fi]'); if (!b) return; const x = so[+b.dataset.fi]; const q = $('#posFq', sh);
      const on = b.classList.contains('on'); $$('.pos-fb', sh).forEach((y) => y.classList.toggle('on', !on && y === b));
      if (on) { q.hidden = true; return; }
      const src = await Printer.qrImg(x.url); q.hidden = false;
      q.innerHTML = (src ? '<img src="' + src + '" alt="QR code to ' + esc(x.label) + '">' : '') + '<div><b>Scan to follow us on ' + esc(x.label) + '</b><div class="tiny muted">' + esc(x.handle) + '</div></div>';
    });
    $('#posPr', sh).onclick = () => Printer.print(byId('sales', sale.id) || sale, extra);
    $('#posNext', sh).onclick = () => { closeSheet(); const q = $('#posQ'); if (q && matchMedia('(pointer:fine)').matches) q.focus(); };
    setTimeout(() => { const b = $('#posNext', sh); if (b) b.focus(); }, 60);
  }, 30);
}
/* search box + a barcode scanner anywhere on the screen (scanners type fast and press Enter) */
document.addEventListener('input', (e) => { if (e.target.id === 'posQ') { K.ui.posQ = e.target.value; $('#posGrid').innerHTML = posTiles(); } });
const posScan = (code) => {
  const v = String(code || '').trim(); if (!v) return false;
  const p = K.raw.products.find((x) => !x.archived && x.barcode && x.barcode === v) || (posProducts().length === 1 && K.ui.posQ ? posProducts()[0] : null);
  if (p) { addToCart(p.id); return true; } toast('No item with the code ' + v, true); return false;
};
document.addEventListener('keydown', (e) => {
  if (K.route !== 'pos' || K.sheets.length) return;
  if (e.target.id === 'posQ') { if (e.key === 'Enter') { e.preventDefault(); if (posScan(e.target.value)) { e.target.value = ''; K.ui.posQ = ''; $('#posGrid').innerHTML = posTiles(); } } return; }
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  // keystrokes outside the search box: a scanner (fast) → collect; Enter → look the code up
  const now = Date.now(); POS.buf = now - (POS.at || 0) > 80 ? '' : POS.buf || ''; POS.at = now;
  if (e.key === 'Enter') { if ((POS.buf || '').length >= 4) { e.preventDefault(); posScan(POS.buf); } POS.buf = ''; return; }
  if (e.key.length === 1) POS.buf += e.key;
});
/* the screen stays on while the POS is open (terminals and tablets) */
async function posWake(on) {
  try { if (on && !POS.wake && navigator.wakeLock) { POS.wake = await navigator.wakeLock.request('screen'); POS.wake.addEventListener('release', () => { POS.wake = null; }); } else if (!on && POS.wake) { await POS.wake.release(); POS.wake = null; } } catch (e) { }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && K.route === 'pos') posWake(true); });
