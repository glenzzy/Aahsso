/* Aahsso — branded receipts for counters and POS terminals.
 * The design (logo, welcome message, business details, NIU / RCCM, QR code, thank-you message, "Powered by Aahsso …")
 * is set once for the business in "Receipt design" (S().receipt); the printer is set per device:
 *  - 'browser': the device's own print (Windows/Android touch PC + USB printer, Sunmi / iMin / Telpo built-in printer
 *    through their print service). The receipt is laid out for a 58 mm or 80 mm roll.
 *  - 'rawbt':  Android phone / tablet + Bluetooth thermal printer through the free RawBT app (ESC/POS: logo, QR, cut).
 * Works offline: nothing here needs the server (the QR library is kept by the app). */
const Printer = (() => {
  const KEY = 'aahsso-printer';
  const DEF = { paper: 80, method: 'browser', auto: false };
  const QR_JS = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  function prefs() { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return Object.assign({}, DEF); } }
  function setPrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(Object.assign(prefs(), p))); } catch (e) { } }
  const cols = (paper) => ((paper || prefs().paper) === 58 ? 32 : 48); // characters per line on the roll (Bluetooth)
  /** the business's receipt design, with defaults */
  const design = (st) => Object.assign({ logo: true, header: '', niu: '', rccm: '', whatsapp: '', web: '', showStaff: true, showCustomer: true, showTxn: true, qr: 'none', qrUrl: '', qrText: '' }, (st || S()).receipt || {});
  const product = () => KC.editionOf(K.info && K.info.edition).label; // "Aahsso Bar & Resto", "Aahsso Store"…
  function qrLink(d) {
    if (d.qr === 'menu' && typeof menuLink === 'function' && (S().menuSlug || S().menuKey)) return menuLink();
    if (d.qr === 'shop' && typeof shopLink === 'function' && (S().shopSlug || S().shopId)) return shopLink();
    if (d.qr === 'whatsapp' && (d.whatsapp || S().phone)) return 'https://wa.me/' + phoneWA(d.whatsapp || S().phone);
    if (d.qr === 'custom' && /^https?:\/\//.test(d.qrUrl || '')) return d.qrUrl;
    return '';
  }
  const QR_CAP = { menu: 'Scan to see our menu', shop: 'Scan to shop with us online', whatsapp: 'Scan to chat with us on WhatsApp', custom: 'Scan me' };

  /** the receipt as a list of blocks, one layout for both printers:
   *  text {t, a: 'l'|'c'|'r', b, big, small, inv}, two columns {left, right}, {rule}, {logo}, {qr, cap} */
  function blocks(s, extra = {}, paper, draft) {
    const st = draft ? Object.assign({}, S(), draft) : S(), d = design(st), t = (K.C.saleX && K.C.saleX[s.id]) || KC.saleTotals(s); const W = cols(paper); const out = [];
    const L = (x, o = {}) => out.push(Object.assign(typeof x === 'object' ? x : { t: String(x) }, o));
    const two = (a, b, o = {}) => { a = String(a); b = String(b); const sp = W - a.length - b.length; L(Object.assign({ left: a, right: b, t: sp >= 1 ? a + ' '.repeat(sp) + b : a + '\n' + ' '.repeat(Math.max(0, W - b.length)) + b }, o)); };
    const rule = () => L({ t: '-'.repeat(W), rule: true });
    // the business
    if (d.logo && st.logo) L({ logo: st.logo });
    L(st.businessName || 'Receipt', { a: 'c', b: true, big: true, name: true });
    if (st.tagline) L(st.tagline, { a: 'c', small: true });
    // on a 58 mm roll each detail gets its own line, so a phone number is never cut in two
    const join = (xs) => { xs = xs.filter(Boolean); return W < 40 ? xs : [xs.join(' · ')]; };
    [st.address, ...join([st.phone ? 'Tel ' + st.phone : '', d.whatsapp ? 'WhatsApp ' + d.whatsapp : '']), d.web, ...join([d.niu ? 'NIU ' + d.niu : '', d.rccm ? 'RCCM ' + d.rccm : ''])].filter(Boolean).forEach((x) => L(x, { a: 'c', small: true }));
    if (d.header) { L({ t: '', gap: true }); L(d.header, { a: 'c', b: true, hi: true }); }
    L({ t: ' SALES RECEIPT ', a: 'c', b: true, inv: true });
    // the sale
    const meta = { meta: true };
    two('Receipt', s.no || '', meta); two('Date', fmtDate(saleDate(s)) + (s.createdAt ? ' ' + new Date(s.createdAt).toTimeString().slice(0, 5) : ''), meta);
    if (d.showStaff && s.createdBy) two('Served by', s.createdBy, meta);
    if (d.showCustomer && s.customerName && s.customerName !== 'Walk-in customer') two('Customer', s.customerName, meta);
    rule();
    // one item: the name, and under it the quantity × price with the amount on the right
    (s.lines || []).forEach((l) => { const q = KC.lineQtyText(l, fmt), amt = fmt(num(l.qty) * num(l.unitPrice)), sp = W - 2 - q.length - amt.length;
      L({ item: true, name: l.name, sub: q, amt, t: l.name + '\n' + (sp >= 1 ? '  ' + q + ' '.repeat(sp) + amt : '  ' + q + '\n' + ' '.repeat(Math.max(0, W - amt.length)) + amt) }); });
    rule();
    if (t.discount) { two('Subtotal', fmt(t.subtotal), meta); two('Discount', '-' + fmt(t.discount), meta); }
    if (t.returned) two('Returned', '-' + fmt(t.returned), meta);
    two('TOTAL', F(t.net), { b: true, big: true, total: true });
    if (t.deliveryFee > 0) { two('Delivery fee', fmt(t.deliveryFee), meta); two('TO PAY', F(t.due), { b: true }); }
    (s.payments || []).forEach((p) => two(p.method, fmt(p.amount), meta));
    if (extra.tendered) { two('Cash received', fmt(extra.tendered), meta); two('Change', F(extra.tendered - t.net), { b: true, chg: true }); }
    if (t.balance > 0) two('BALANCE DUE', F(t.balance), { b: true, chg: true });
    L({ paid: 'PAID', partial: 'DEPOSIT', unpaid: 'UNPAID', cancelled: 'CANCELLED' }[t.status] || '', { a: 'c', b: true, stamp: true, st: t.status });
    if (d.showTxn && t.txnId) L('Txn ' + t.txnId, { a: 'c', small: true });
    // the goodbye
    if (st.receiptFooter) L(st.receiptFooter, { a: 'c', thx: true });
    const q = qrLink(d); if (q) L({ qr: q, cap: d.qrText || QR_CAP[d.qr] || '' });
    rule();
    L('Powered by ' + product(), { a: 'c', small: true, brand: true });
    return out;
  }

  /* ---------- the receipt as HTML: the print-out of "this device's printer" and the preview in Receipt design ---------- */
  async function qrImg(url) {
    if (!window.qrcode) { try { await loadScript(QR_JS); } catch (e) { return ''; } } // kept on the phone by the app (offline too)
    try { const q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createDataURL(4, 0); } catch (e) { return ''; }
  }
  async function html(bs) {
    const parts = [];
    for (const l of bs) {
      if (l.logo) { parts.push('<div class="pr-logo"><img src="' + esc(imgSrc(l.logo) || l.logo) + '" alt=""></div>'); continue; }
      if (l.qr) { const src = await qrImg(l.qr); if (src) parts.push('<div class="pr-qr"><img src="' + src + '" alt=""><div>' + esc(l.cap || '') + '</div></div>'); continue; }
      if (l.rule) { parts.push('<div class="pr-rule"></div>'); continue; }
      if (l.gap) { parts.push('<div class="pr-gap"></div>'); continue; }
      if (l.item) { parts.push('<div class="rcp-it"><div class="rcp-in">' + esc(l.name) + '</div><div class="rcp-ia">' + esc(l.amt) + '</div><div class="rcp-iq">' + esc(l.sub) + '</div></div>'); continue; }
      if (l.brand) { const p = esc(l.t).replace(/^Powered by /, ''); parts.push('<div class="pr-brand"><span>Powered by</span> ' + p.replace(/^Aahsso/, '<b>Aahsso</b>') + '</div>'); continue; }
      const cls = 'pr-l pr-' + (l.a || 'l') + (l.b ? ' pr-b' : '') + (l.big ? ' pr-big' : '') + (l.small ? ' pr-s' : '') + (l.inv ? ' pr-inv' : '') + (l.stamp ? ' pr-stamp' : '') + (l.total ? ' pr-total' : '') + (l.left !== undefined ? ' pr-2' : '') + (l.meta ? ' pr-m' : '') + (l.chg ? ' pr-chg' : '') + (l.name ? ' pr-name' : '') + (l.hi ? ' pr-hi' : '') + (l.thx ? ' pr-thx' : '') + (l.st ? ' pr-st-' + l.st : '');
      parts.push('<div class="' + cls + '">' + (l.left !== undefined ? '<span>' + esc(l.left) + '</span><span>' + esc(l.right) + '</span>' : esc(l.t.trim()).replace(/\n/g, '<br>')) + '</div>');
    }
    return parts.join('');
  }
  async function printBrowser(s, extra, ready) {
    const mm = prefs().paper;
    let area = document.getElementById('printArea');
    if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
    area.className = 'rcp' + (mm === 58 ? ' rcp-58' : '');
    area.innerHTML = await html(ready || blocks(s, extra, mm));
    await Promise.all([...area.querySelectorAll('img')].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })));
    document.body.classList.add('printing');
    // the page is exactly as long as the receipt: one piece of paper, no metres of blank roll.
    // The print area is hidden on screen (it only shows when printing), so it is measured shown but out of sight.
    const keep = area.style.cssText; area.style.cssText = 'display:block;position:absolute;left:-10000px;top:0;visibility:hidden';
    const hpx = area.getBoundingClientRect().height; area.style.cssText = keep;
    const hmm = Math.ceil(hpx * 25.4 / 96) + 12;
    let pg = document.getElementById('printPage'); if (!pg) { pg = document.createElement('style'); pg.id = 'printPage'; document.head.appendChild(pg); }
    pg.textContent = '@page{size:' + mm + 'mm ' + hmm + 'mm;margin:0}';
    const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); setTimeout(done, 60000);
    setTimeout(() => window.print(), 50);
  }

  /* ---------- Bluetooth printer through the RawBT app (Android): ESC/POS with the logo and a QR code ---------- */
  const ascii = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[−–—]/g, '-').replace(/[   ]/g, ' ').replace(/·/g, '-').replace(/[^\x0a\x20-\x7e]/g, '?');
  /** a picture as printer dots (black / white), at most `maxW` dots wide: GS v 0 raster */
  async function raster(src, maxW) {
    const img = await new Promise((ok) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
    if (!img || !img.width) return [];
    const w = (Math.min(maxW, img.width) & ~7) || 8; const h = Math.max(1, Math.min(240, Math.round(img.height * w / img.width)));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    let px; try { px = g.getImageData(0, 0, w, h).data; } catch (e) { return []; } // a picture from another site that does not allow it
    const bw = w / 8; const out = [0x1d, 0x76, 0x30, 0x00, bw & 255, bw >> 8, h & 255, h >> 8];
    for (let y = 0; y < h; y++) for (let xb = 0; xb < bw; xb++) {
      let byte = 0; for (let b = 0; b < 8; b++) { const i = (y * w + xb * 8 + b) * 4; const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; if (lum < 150) byte |= 0x80 >> b; }
      out.push(byte);
    }
    return out;
  }
  /** the printer draws the QR code itself (GS ( k, model 2) */
  function qrCmd(url) {
    const data = [...ascii(url)].map((c) => c.charCodeAt(0)); const n = data.length + 3;
    return [0x1d, 0x28, 0x6b, 4, 0, 49, 65, 50, 0, 0x1d, 0x28, 0x6b, 3, 0, 49, 67, 6, 0x1d, 0x28, 0x6b, 3, 0, 49, 69, 49,
      0x1d, 0x28, 0x6b, n & 255, n >> 8, 49, 80, 48, ...data, 0x1d, 0x28, 0x6b, 3, 0, 49, 81, 48];
  }
  async function escpos(bs, paper) {
    const dots = (paper || prefs().paper) === 58 ? 384 : 576; const W = cols(paper);
    const b = [0x1b, 0x40]; const push = (...x) => { for (const v of x) b.push(v); }; const text = (x) => { for (const ch of ascii(x)) b.push(ch.charCodeAt(0)); };
    for (const l of bs) {
      if (l.logo) { const r = await raster(imgSrc(l.logo) || l.logo, Math.round(dots * 0.55)); if (r.length) { push(0x1b, 0x61, 1); push(...r); push(0x0a); } continue; }
      if (l.qr) { push(0x1b, 0x61, 1); push(...qrCmd(l.qr)); push(0x0a); if (l.cap) { text(l.cap); push(0x0a); } continue; }
      if (l.gap) { push(0x0a); continue; }
      if (l.item) { const [n, ...rest] = l.t.split('\n'); push(0x1b, 0x61, 0, 0x1d, 0x21, 0, 0x1d, 0x42, 0, 0x1b, 0x45, 1); text(n); push(0x0a, 0x1b, 0x45, 0); text(rest.join('\n')); push(0x0a); continue; }
      push(0x1b, 0x61, l.a === 'c' ? 1 : l.a === 'r' ? 2 : 0); push(0x1b, 0x45, l.b ? 1 : 0); push(0x1d, 0x42, l.inv ? 1 : 0);
      const big = l.big && (l.a === 'c' || W >= 40); push(0x1d, 0x21, big ? 0x11 : 0x00);
      let s = l.t; if (big && l.left !== undefined) { const half = Math.floor(W / 2); const sp = half - l.left.length - l.right.length; s = sp >= 1 ? l.left + ' '.repeat(sp) + l.right : l.left + '\n' + l.right; }
      if (l.inv) s = s.length < W ? ' '.repeat(Math.floor((W - s.length) / 2)) + s + ' '.repeat(Math.ceil((W - s.length) / 2)) : s;
      text(s); push(0x0a);
    }
    push(0x1d, 0x21, 0x00, 0x1b, 0x45, 0x00, 0x1d, 0x42, 0x00, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00); // feed and cut
    return b;
  }
  async function printRawBT(s, extra) {
    if (!/android/i.test(navigator.userAgent)) { toast('RawBT works on Android. On this device choose “This device’s printer” in Printer settings.', true); return; }
    const bytes = await escpos(blocks(s, extra)); let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    location.href = 'intent:base64,' + btoa(bin) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
  }

  async function print(s, extra) {
    if (!s) return;
    try { await (prefs().method === 'rawbt' ? printRawBT : printBrowser)(s, extra); } catch (e) { toast('Could not print: ' + (e.message || e), true); }
  }
  const sample = () => ({ id: 'test', no: 'S-0001', date: todayStr(), createdAt: new Date().toISOString(), createdBy: K.me.name || 'Cashier', customerName: 'Walk-in customer', status: 'paid', discount: 0, txnId: 'TX-SAMPLE',
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
        (can('settings') ? '<button type="button" class="btn mt" id="prDesign">' + ic('edit', 'sm') + 'Design the receipt (logo, messages, QR code…)</button>' : '') +
        '<p class="tiny muted">Saved on this device only — each till can have its own printer.</p></div>',
      foot: '<button class="btn grow" id="prTest">' + ic('check', 'sm') + 'Test print</button><button class="btn pri grow" id="prSave">Save</button>' });
    let paper = p.paper;
    $('#prPaper', sh).addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (!b) return; paper = +b.dataset.w; $$('#prPaper button', sh).forEach((x) => x.classList.toggle('on', x === b)); });
    const read = () => { const v = formVals(sh); if (typeof setPosPrefs === 'function') setPosPrefs({ start: !!v.prPosStart }); return { method: v.prMethod || 'browser', paper, auto: !!v.prAuto }; };
    $('#prTest', sh).onclick = () => { setPrefs(read()); print(sample()); };
    $('#prSave', sh).onclick = () => { setPrefs(read()); closeSheet(); toast('Printer saved for this device'); if (typeof posRefresh === 'function') posRefresh(); };
    if ($('#prDesign', sh)) $('#prDesign', sh).onclick = () => { setPrefs(read()); designer(); };
  }

  /** Receipt design (for the whole business): what is printed on every receipt, with a live preview */
  function designer() {
    if (!can('settings')) return toast('Only someone who can change Settings can design the receipt', true);
    const d = design(); const st = S(); let paper = prefs().paper;
    const qrOpts = [['none', 'No QR code']].concat(typeof menuLink === 'function' && (st.menuSlug || st.menuKey) ? [['menu', 'Our menu (customers order from their phone)']] : [], (st.shopSlug || st.shopId) && typeof shopLink === 'function' ? [['shop', 'Our online shop']] : [], [['whatsapp', 'Chat with us on WhatsApp'], ['custom', 'A link of my choice (Facebook, Instagram, website…)']]);
    const sh = openSheet({ title: 'Receipt design', wide: true,
      body: '<div class="rd">' +
        '<div class="rd-form col">' +
          '<p class="small muted">Printed on every receipt, on every till. Business name, logo, tagline, address and phone come from <a href="#settings" data-a="sheetClose">Settings → Business</a>.</p>' +
          '<label class="toggle"><input type="checkbox" name="rdLogo"' + (d.logo ? ' checked' : '') + (st.logo ? '' : ' disabled') + '>Print the logo' + (st.logo ? '' : ' <span class="tiny muted">(add one in Settings → Business)</span>') + '</label>' +
          field('Welcome message (top)', inp('rdHeader', d.header, 'maxlength="60" placeholder="e.g. Bienvenue ! · Welcome to Chez Mado"')) +
          '<div class="grid2">' + field('WhatsApp number', inp('rdWa', d.whatsapp, 'inputmode="tel" placeholder="e.g. 677 00 00 00"')) + field('Website / Facebook / Instagram', inp('rdWeb', d.web, 'placeholder="e.g. facebook.com/chezmado"')) + '</div>' +
          '<div class="grid2">' + field('Taxpayer number (NIU)', inp('rdNiu', d.niu, 'placeholder="Optional"')) + field('RCCM', inp('rdRccm', d.rccm, 'placeholder="Optional"')) + '</div>' +
          field('Thank-you message (bottom)', inp('rdFooter', st.receiptFooter || '', 'maxlength="120" placeholder="e.g. Merci et à bientôt ! Goods sold are not returned."')) +
          field('QR code at the bottom', sel('rdQr', qrOpts, qrOpts.some((o) => o[0] === d.qr) ? d.qr : 'none')) +
          '<div id="rdQrMore" class="' + (d.qr === 'custom' ? '' : 'hide') + '">' + field('Link', inp('rdQrUrl', d.qrUrl, 'placeholder="https://…"')) + '</div>' +
          '<div id="rdQrCap" class="' + (d.qr === 'none' ? 'hide' : '') + '">' + field('Text under the QR code', inp('rdQrText', d.qrText, 'maxlength="50" placeholder="' + esc(QR_CAP[d.qr] || 'Scan me') + '"')) + '</div>' +
          '<div class="row wrap gap6"><label class="toggle"><input type="checkbox" name="rdStaff"' + (d.showStaff ? ' checked' : '') + '>Who served</label><label class="toggle"><input type="checkbox" name="rdCust"' + (d.showCustomer ? ' checked' : '') + '>Customer name</label><label class="toggle"><input type="checkbox" name="rdTxn"' + (d.showTxn ? ' checked' : '') + '>Transaction ID</label></div>' +
        '</div>' +
        '<div class="rd-prev"><div class="row between mb"><b class="small">Preview</b><div class="seg sm" id="rdPaper">' + [58, 80].map((w) => '<button type="button" data-w="' + w + '" class="' + (paper === w ? 'on' : '') + '">' + w + ' mm</button>').join('') + '</div></div><div class="rd-paper"><div class="rcp" id="rdOut"></div></div><p class="tiny muted center mt">Every receipt ends with “Powered by ' + esc(product()) + '”.</p></div>' +
      '</div>',
      foot: '<button class="btn grow" id="rdTest">' + ic('check', 'sm') + 'Test print</button><button class="btn pri grow" id="rdSave">Save the design</button>' });
    sh.classList.add('rd-sheet');
    const read = () => { const v = formVals(sh); return { receipt: { logo: !!v.rdLogo, header: v.rdHeader, whatsapp: v.rdWa, web: v.rdWeb, niu: v.rdNiu, rccm: v.rdRccm, qr: v.rdQr || 'none', qrUrl: v.rdQrUrl, qrText: v.rdQrText, showStaff: !!v.rdStaff, showCustomer: !!v.rdCust, showTxn: !!v.rdTxn }, receiptFooter: v.rdFooter }; };
    const draftBlocks = (p) => blocks(sample(), { tendered: 2000 }, p, read()); // the preview, before saving
    let tmr; const draw = () => { clearTimeout(tmr); tmr = setTimeout(async () => {
      const bs = draftBlocks(paper); const r = read();
      const out = $('#rdOut', sh); if (!out) return; out.className = 'rcp' + (paper === 58 ? ' rcp-58' : ''); out.innerHTML = await html(bs);
      $('#rdQrMore', sh).classList.toggle('hide', r.receipt.qr !== 'custom'); $('#rdQrCap', sh).classList.toggle('hide', r.receipt.qr === 'none');
    }, 120); };
    sh.addEventListener('input', draw); sh.addEventListener('change', draw);
    $('#rdPaper', sh).addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (!b) return; paper = +b.dataset.w; $$('#rdPaper button', sh).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    $('#rdSave', sh).onclick = async () => { const r = read(); if (r.receipt.qr === 'custom' && !/^https?:\/\//.test(r.receipt.qrUrl || '')) return toast('Type the full link, starting with https://', true); if (await saveSettings(r)) { closeSheet(); toast('Receipt design saved — every till prints it'); } };
    $('#rdTest', sh).onclick = () => printBlocks(draftBlocks());
    draw();
  }
  /** print ready-made blocks (the designer's test print, with the design not saved yet) */
  async function printBlocks(bs) {
    if (prefs().method === 'rawbt') { if (!/android/i.test(navigator.userAgent)) return toast('RawBT works on Android.', true); const bytes = await escpos(bs); let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); location.href = 'intent:base64,' + btoa(bin) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;'; return; }
    await printBrowser(null, null, bs);
  }
  return { prefs, setPrefs, print, settings, designer, blocks, escpos, html };
})();
A.rcPrint = (el) => Printer.print(byId('sales', el.dataset.id));
A.printerSettings = () => Printer.settings();
A.receiptDesign = () => Printer.designer();
