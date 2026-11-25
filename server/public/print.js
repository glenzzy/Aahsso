/* Aahsso — receipt printing for counters and POS terminals. Settings are per device (each till has its own printer):
 *  - 'browser': the device's own print (Windows/Android touch PC + USB printer, Sunmi / iMin / Telpo built-in printer
 *    through their print service). The receipt is laid out for a 58 mm or 80 mm roll.
 *  - 'rawbt':  Android phone / tablet + Bluetooth thermal printer through the free RawBT app (ESC/POS, prints and cuts).
 * Works offline: nothing here needs the server. */
const Printer = (() => {
  const KEY = 'aahsso-printer';
  const DEF = { paper: 80, method: 'browser', auto: false };
  function prefs() { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return Object.assign({}, DEF); } }
  function setPrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(Object.assign(prefs(), p))); } catch (e) { } }
  const cols = () => (prefs().paper === 58 ? 32 : 48); // characters per line on the roll

  /** the receipt as plain lines: [{t: text, a: 'l'|'c'|'r', b: bold, big: double size}] — one layout for both printers */
  function lines(s, extra = {}) {
    const st = S(), t = (K.C.saleX && K.C.saleX[s.id]) || KC.saleTotals(s); const W = cols(); const out = [];
    // a line is text, or two columns (left · right): the Bluetooth printer pads them with spaces, the browser lays them out
    const L = (t, o = {}) => out.push(Object.assign(typeof t === 'object' ? t : { t: String(t) }, o));
    const two = (a, b) => { a = String(a); b = String(b); const sp = W - a.length - b.length; return { left: a, right: b, t: sp >= 1 ? a + ' '.repeat(sp) + b : a + '\n' + ' '.repeat(Math.max(0, W - b.length)) + b }; };
    const rule = () => L({ t: '-'.repeat(W), rule: true });
    L(st.businessName || 'Receipt', { a: 'c', b: true, big: true });
    if (st.tagline) L(st.tagline, { a: 'c' });
    [st.address, st.phone].filter(Boolean).forEach((x) => L(x, { a: 'c' }));
    rule();
    L(two('Receipt', s.no || '')); L(two('Date', fmtDate(saleDate(s)) + (s.createdAt ? ' ' + new Date(s.createdAt).toTimeString().slice(0, 5) : '')));
    if (s.customerName && s.customerName !== 'Walk-in customer') L('Customer: ' + s.customerName);
    if (s.createdBy) L('Served by: ' + s.createdBy);
    rule();
    (s.lines || []).forEach((l) => {
      const q = KC.lineQtyText(l, fmt); const tot = fmt(num(l.qty) * num(l.unitPrice));
      L(l.name, { b: true }); L(two('  ' + q, tot));
    });
    rule();
    if (t.discount) { L(two('Subtotal', fmt(t.subtotal))); L(two('Discount', '-' + fmt(t.discount))); }
    if (t.returned) L(two('Returned', '-' + fmt(t.returned)));
    L(two('TOTAL', F(t.net)), { b: true, big: W >= 40 });
    if (t.deliveryFee > 0) { L(two('Delivery fee', fmt(t.deliveryFee))); L(two('TO PAY', F(t.due)), { b: true }); }
    (s.payments || []).forEach((p) => L(two(p.method + (p.ref ? ' ' + p.ref : ''), fmt(p.amount))));
    if (extra.tendered) { L(two('Cash received', fmt(extra.tendered))); L(two('Change', F(extra.tendered - t.net)), { b: true }); }
    if (t.balance > 0) L(two('BALANCE DUE', F(t.balance)), { b: true });
    rule();
    L({ paid: 'PAID', partial: 'DEPOSIT', unpaid: 'UNPAID', cancelled: 'CANCELLED' }[t.status] || '', { a: 'c', b: true });
    if (t.txnId) L('Txn ' + t.txnId, { a: 'c' });
    if (st.receiptFooter) L(st.receiptFooter, { a: 'c' });
    L('Thank you!', { a: 'c' });
    return out;
  }

  /* ---------- the device's own print (USB printer, built-in POS printers) ---------- */
  function printBrowser(s, extra) {
    const mm = prefs().paper; const ls = lines(s, extra);
    let area = document.getElementById('printArea');
    if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
    area.style.width = (mm === 58 ? 48 : 72) + 'mm'; // printable width of the roll
    area.classList.toggle('pr-58', mm === 58);
    area.innerHTML = ls.map((l) => l.rule ? '<div class="pr-rule"></div>' : '<div class="pr-l pr-' + (l.a || 'l') + (l.b ? ' pr-b' : '') + (l.big ? ' pr-big' : '') + (l.left !== undefined ? ' pr-2' : '') + '">' + (l.left !== undefined ? '<span>' + esc(l.left) + '</span><span>' + esc(l.right) + '</span>' : esc(l.t).replace(/\n/g, '<br>')) + '</div>').join('');
    // the page is exactly as long as the receipt: no metres of blank paper on roll printers
    const hmm = Math.ceil(area.scrollHeight * 25.4 / 96) + 12;
    let pg = document.getElementById('printPage'); if (!pg) { pg = document.createElement('style'); pg.id = 'printPage'; document.head.appendChild(pg); }
    pg.textContent = '@page{size:' + mm + 'mm ' + hmm + 'mm;margin:0}';
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); setTimeout(done, 60000);
    setTimeout(() => window.print(), 50);
  }

  /* ---------- Bluetooth printer through the RawBT app (Android): ESC/POS ---------- */
  const ascii = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[−–—]/g, '-').replace(/[   ]/g, ' ').replace(/[^\x0a\x20-\x7e]/g, '?');
  function escpos(ls) {
    const b = [0x1b, 0x40]; const push = (...x) => b.push(...x); const text = (x) => { for (const ch of ascii(x)) b.push(ch.charCodeAt(0)); };
    ls.forEach((l) => {
      push(0x1b, 0x61, l.a === 'c' ? 1 : l.a === 'r' ? 2 : 0); push(0x1b, 0x45, l.b ? 1 : 0); push(0x1d, 0x21, l.big ? 0x11 : 0x00);
      text(l.big && l.a !== 'c' ? l.t.replace(/ {2,}/g, (m) => ' '.repeat(Math.max(1, Math.floor(m.length / 2)))) : l.t); push(0x0a);
    });
    push(0x1d, 0x21, 0x00, 0x1b, 0x45, 0x00, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00); // feed and cut
    return b;
  }
  function printRawBT(s, extra) {
    const bytes = escpos(lines(s, extra)); let bin = ''; bytes.forEach((x) => { bin += String.fromCharCode(x); });
    const url = 'intent:base64,' + btoa(bin) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
    if (!/android/i.test(navigator.userAgent)) { toast('RawBT works on Android. On this device choose “This device’s printer” in Printer settings.', true); return; }
    location.href = url;
  }

  function print(s, extra) {
    if (!s) return;
    try { (prefs().method === 'rawbt' ? printRawBT : printBrowser)(s, extra); } catch (e) { toast('Could not print: ' + (e.message || e), true); }
  }
  const sample = () => ({ id: 'test', no: 'TEST-001', date: todayStr(), createdAt: new Date().toISOString(), createdBy: K.me.name || '', customerName: 'Walk-in customer', status: 'paid', discount: 0,
    lines: [{ name: 'Castel Beer 650ml', qty: 2, unitPrice: 700 }, { name: 'Coca-Cola 330ml Can', qty: 1, unitPrice: 500 }], payments: [{ method: 'Cash', amount: 1900, date: todayStr() }], delivered: true });

  /** printer settings for this device */
  function settings() {
    const p = prefs();
    const sh = openSheet({ title: 'Receipt printer (this device)',
      body: '<div class="col">' +
        field('How this device prints', '<div class="pr-opt">' +
          '<label class="pr-ch"><input type="radio" name="prMethod" value="browser"' + (p.method === 'browser' ? ' checked' : '') + '><span><b>This device’s printer</b><span class="tiny muted">USB printer on a touch PC · built-in printer of Sunmi, iMin, Telpo POS · any printer in the print dialog</span></span></label>' +
          '<label class="pr-ch"><input type="radio" name="prMethod" value="rawbt"' + (p.method === 'rawbt' ? ' checked' : '') + '><span><b>Bluetooth printer (RawBT app)</b><span class="tiny muted">Android phone or tablet with a Bluetooth thermal printer — install the free “RawBT” app and pair the printer in it once</span></span></label></div>') +
        field('Paper width', '<div class="seg" id="prPaper">' + [58, 80].map((w) => '<button type="button" data-w="' + w + '" class="' + (p.paper === w ? 'on' : '') + '">' + w + ' mm</button>').join('') + '</div>') +
        '<label class="toggle"><input type="checkbox" name="prAuto"' + (p.auto ? ' checked' : '') + '>Print the receipt automatically after each sale</label>' +
        (typeof posPrefs === 'function' ? '<label class="toggle"><input type="checkbox" name="prPosStart"' + (posPrefs().start ? ' checked' : '') + '>Open the POS screen when this device starts (a dedicated till)</label>' : '') +
        '<p class="tiny muted">Saved on this device only — each till can have its own printer.</p></div>',
      foot: '<button class="btn grow" id="prTest">' + ic('check', 'sm') + 'Test print</button><button class="btn pri grow" id="prSave">Save</button>' });
    let paper = p.paper;
    $('#prPaper', sh).addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (!b) return; paper = +b.dataset.w; $$('#prPaper button', sh).forEach((x) => x.classList.toggle('on', x === b)); });
    const read = () => { const v = formVals(sh); if (typeof setPosPrefs === 'function') setPosPrefs({ start: !!v.prPosStart }); return { method: v.prMethod || 'browser', paper, auto: !!v.prAuto }; };
    $('#prTest', sh).onclick = () => { setPrefs(read()); print(sample()); };
    $('#prSave', sh).onclick = () => { setPrefs(read()); closeSheet(); toast('Printer saved for this device'); if (typeof posRefresh === 'function') posRefresh(); };
  }
  return { prefs, setPrefs, print, settings, lines, escpos };
})();
A.rcPrint = (el) => Printer.print(byId('sales', el.dataset.id));
A.printerSettings = () => Printer.settings();
