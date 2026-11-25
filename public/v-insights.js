/* Aahsso — "Insights": a small strip of charts and numbers at the top of each module page (Stock, Records, Customers,
 * Suppliers, Expenses, Cash, Losses, Staff, Payroll, Menu, Tables / Orders, Bookings). Collapsible; open or closed is
 * remembered per page on this phone. Built from the data already on the phone, so it works offline.
 *   Insights.strip(page) → html ('' when there is nothing to show or the person may not see it) */
const Insights = (() => {
  const KEY = (p) => 'aahsso-ins-' + p;
  const isOpen = (p) => { try { return localStorage.getItem(KEY(p)) !== '0'; } catch (e) { return true; } };
  const today = () => todayStr();
  const daysBack = (n) => { const t = today(); const out = []; for (let i = n - 1; i >= 0; i--) out.push(KC.addDays(t, -i)); return out; };
  const dLab = (d) => String(+d.slice(8));
  const monthsBack = (n) => { const t = today(); const out = []; let y = +t.slice(0, 4), m = +t.slice(5, 7); for (let i = 0; i < n; i++) { out.unshift(y + '-' + pad2(m)); m--; if (!m) { m = 12; y--; } } return out; };
  const mLab = (k) => MONTHS[+k.slice(5) - 1];
  const sum = (a, f) => a.reduce((t, x) => t + (f ? f(x) : x), 0);
  const facts = (from, to) => KC.saleFacts(K.raw, K.C, { from, to, sales: visibleSales() });
  const card = (title, body, cls) => body ? '<div class="card ins-card' + (cls ? ' ' + cls : '') + '"><h4>' + esc(title) + '</h4>' + body + '</div>' : '';
  const tile = (t) => Charts.kpi(t);
  const safe = (fn) => { try { return fn() || ''; } catch (e) { console.warn('insights', e); return ''; } };

  /* ---------- one builder per page: returns { sum: 'short line in the header', parts: [html, …] } ---------- */
  const B = {};
  B.sales = () => {
    const ds = daysBack(14); const per = {}; visibleSales().forEach((s) => { const x = K.C.saleX[s.id]; if (!x || x.status === 'cancelled') return; const d = saleDate(s); if (d >= ds[0]) per[d] = (per[d] || 0) + x.net; });
    const t = per[today()] || 0, y = per[KC.addDays(today(), -1)] || 0; const owed = sum(visibleSales(), (s) => { const x = K.C.saleX[s.id]; return x && x.status !== 'cancelled' ? Math.max(0, x.balance) : 0; });
    const pays = {}; visibleSales().forEach((s) => (s.payments || []).forEach((p) => { if (p.date >= ds[0] && num(p.amount) > 0) pays[p.method || 'Cash'] = (pays[p.method || 'Cash'] || 0) + num(p.amount); }));
    if (!Object.keys(per).length && !owed) return null;
    return { sum: 'Today ' + F(t), parts: [
      tile({ label: 'Sales today', value: F(t), now: t, prev: y, sub: 'vs yesterday', spark: ds.map((d) => per[d] || 0), hero: true }),
      tile({ label: 'Owed to you', value: F(owed), tone: owed > 0 ? 'bad' : '', sub: 'unpaid balances' }),
      card('Sales, last 14 days', Charts.columns(ds.map((d) => ({ label: dLab(d), value: per[d] || 0 })), { fmt: F, maxLabels: 7 }), 'ins-w2'),
    ].concat(Object.keys(pays).length ? [card('Money in by method (14 days)', Charts.donut(Object.entries(pays).map(([k, v]) => ({ label: k, value: v })), { fmt: F, centre: 'in' }), 'ins-w2')] : []) };
  };
  B.stock = () => {
    const h = KC.inventoryHealth(K.raw, K.C, today()); const live = h.filter((x) => x.available > 0); if (!h.length) return null;
    const c = can('costs'); const val = (x) => (c ? x.stockValue : x.retailValue); const tot = sum(live, val);
    const low = h.filter((x) => x.available > 0 && isFinite(x.daysOfStock) && x.daysOfStock <= 7).length, out = h.filter((x) => x.status === 'out').length;
    const byCat = {}; live.forEach((x) => { byCat[x.category] = (byCat[x.category] || 0) + val(x); });
    const counts = {}; h.forEach((x) => (counts[x.status] = (counts[x.status] || 0) + 1));
    return { sum: F(tot) + ' in stock', parts: [
      tile({ label: c ? 'Stock value (cost)' : 'Stock at selling price', value: F(tot), sub: fmt(sum(live, (x) => x.available)) + ' units', hero: true }),
      tile({ label: 'Running low / sold out', value: fmt(low) + ' / ' + fmt(out), tone: low + out ? 'bad' : '', sub: '≤ 7 days left · none left' }),
      card('Value by category', Charts.hbar(Object.entries(byCat).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value), { fmt: F, max: 5 }), 'ins-w2'),
      card('How items sell', Charts.donut(['fast', 'steady', 'slow', 'dead', 'new'].map((k) => ({ label: (STATUS_INFO[k] || [k])[0], value: counts[k] || 0 })), { fmt: (v) => fmt(v) + ' items', centre: 'items' }), 'ins-w2'),
    ] };
  };
  B.customers = () => {
    const ds = daysBack(30); const f = facts(ds[0], today()).filter((x) => x.customerId); const cs = K.raw.customers || []; if (!cs.length && !f.length) return null;
    const top = KC.groupBy(f, (x) => x.customerId, (x) => x.customer).sort((a, b) => b.revenue - a.revenue);
    const firstBuy = {}; visibleSales().forEach((s) => { if (!s.customerId || K.C.saleX[s.id].status === 'cancelled') return; const d = saleDate(s); if (!firstBuy[s.customerId] || d < firstBuy[s.customerId]) firstBuy[s.customerId] = d; });
    const nNew = Object.values(firstBuy).filter((d) => d >= ds[0]).length;
    const age = [[0, 30, '0–30d'], [31, 60, '31–60d'], [61, 90, '61–90d'], [91, 1e9, '90d+']].map(([a, z, l]) => ({ label: l, value: 0, a, z }));
    visibleSales().forEach((s) => { const x = K.C.saleX[s.id]; if (x.status === 'cancelled' || !(x.balance > 0)) return; const d = KC.daysBetween(saleDate(s), today()); const g = age.find((q) => d >= q.a && d <= q.z); if (g) g.value += x.balance; });
    const owed = sum(age, (g) => g.value);
    return { sum: fmt(cs.length) + ' customers', parts: [
      tile({ label: 'Customers', value: fmt(cs.length), sub: nNew + ' new in 30 days', hero: true }),
      tile({ label: 'Owed to you', value: F(owed), tone: owed > 0 ? 'bad' : '', sub: age[3].value > 0 ? F(age[3].value) + ' over 90 days' : 'unpaid balances' }),
      card('Best customers (30 days)', Charts.hbar(top.map((x) => ({ label: x.label, value: x.revenue, sub: x.n + ' visit' + (x.n === 1 ? '' : 's') })), { fmt: F, max: 5, empty: 'No named customers yet.' }), 'ins-w2'),
      owed > 0 ? card('How old the debts are', Charts.columns(age.map((g) => ({ label: g.label, value: g.value })), { fmt: F }), 'ins-w2') : '',
    ] };
  };
  B.suppliers = () => {
    const sup = K.raw.suppliers || []; if (!sup.length) return null; const c = can('costs');
    const owed = sup.map((s) => ({ label: s.name, value: typeof supplierOwed === 'function' ? supplierOwed(s.id) : 0 })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    const ms = monthsBack(6); const per = {}; (K.raw.lots || []).forEach((l) => { const k = String(l.purchaseDate || '').slice(0, 7); if (!ms.includes(k)) return; const x = K.C.lotX[l.id]; per[k] = (per[k] || 0) + (x ? x.paidX * num(l.qty) : 0); });
    const tm = per[ms[5]] || 0, lm = per[ms[4]] || 0; const owedT = sum(owed, (x) => x.value);
    return { sum: owedT ? F(owedT) + ' owed' : fmt(sup.length) + ' suppliers', parts: [
      tile({ label: 'You owe suppliers', value: F(owedT), tone: owedT > 0 ? 'bad' : '', sub: owed.length + ' supplier' + (owed.length === 1 ? '' : 's'), hero: true }),
      c ? tile({ label: 'Bought this month', value: F(tm), now: tm, prev: lm, downGood: true, sub: 'vs last month', spark: ms.map((k) => per[k] || 0) }) : tile({ label: 'Suppliers', value: fmt(sup.length) }),
      card('What you owe, by supplier', Charts.hbar(owed, { fmt: F, max: 5, tone: 'bad', empty: 'You owe no supplier. 🎉' }), 'ins-w2'),
      c ? card('Bought per month', Charts.columns(ms.map((k) => ({ label: mLab(k), value: per[k] || 0 })), { fmt: F }), 'ins-w2') : '',
    ] };
  };
  B.expenses = () => {
    const ex = K.raw.expenses || []; if (!ex.length) return null; const ms = monthsBack(6);
    const per = {}; ex.forEach((e) => { const k = String(e.date || '').slice(0, 7); per[k] = (per[k] || 0) + num(e.amount); });
    const cur = ms[5]; const byCat = {}; ex.filter((e) => String(e.date || '').slice(0, 7) === cur).forEach((e) => { byCat[e.category || 'Other'] = (byCat[e.category || 'Other'] || 0) + num(e.amount); });
    return { sum: F(per[cur] || 0) + ' this month', parts: [
      tile({ label: 'Spent this month', value: F(per[cur] || 0), now: per[cur] || 0, prev: per[ms[4]] || 0, downGood: true, sub: 'vs last month', spark: ms.map((k) => per[k] || 0), hero: true }),
      tile({ label: 'Average per month', value: F(sum(ms, (k) => per[k] || 0) / 6), sub: 'last 6 months' }),
      card('This month by category', Charts.donut(Object.entries(byCat).map(([k, v]) => ({ label: k, value: v })), { fmt: F, centre: 'spent', empty: 'Nothing spent this month.' }), 'ins-w2'),
      card('Per month', Charts.columns(ms.map((k) => ({ label: mLab(k), value: per[k] || 0 })), { fmt: F }), 'ins-w2'),
    ] };
  };
  B.cash = () => {
    const ds = daysBack(14); const keys = new Set(); const per = {};
    visibleSales().forEach((s) => (s.payments || []).forEach((p) => { if (!(p.date >= ds[0]) || num(p.amount) <= 0) return; const m = p.method || 'Cash'; keys.add(m); (per[p.date] = per[p.date] || {})[m] = (per[p.date][m] || 0) + num(p.amount); }));
    if (!keys.size) return null; const tot = (d) => sum(Object.values(per[d] || {}));
    const t = tot(today()), y = tot(KC.addDays(today(), -1)); const cashT = (per[today()] || {}).Cash || 0;
    return { sum: F(t) + ' in today', parts: [
      tile({ label: 'Collected today', value: F(t), now: t, prev: y, sub: 'vs yesterday', spark: ds.map(tot), hero: true }),
      tile({ label: 'Cash in the drawer today', value: F(cashT), sub: F(t - cashT) + ' by mobile money / other' }),
      card('Money in, last 14 days', Charts.stacked(ds.map((d) => ({ label: dLab(d), parts: per[d] || {} })), [...keys].map((k) => ({ key: k, label: k })), { fmt: F, maxLabels: 7 }), 'ins-w2'),
    ] };
  };
  B.losses = () => {
    if (typeof lossEvents !== 'function' || !can('costs')) return null; const ev = lossEvents(); if (!ev.length) return null;
    const ms = monthsBack(6); const per = {}; ev.forEach((e) => { const k = String(e.date || '').slice(0, 7); per[k] = (per[k] || 0) + e.value; });
    const from = KC.addDays(today(), -89); const byC = {}; ev.filter((e) => e.date >= from).forEach((e) => { const l = (KC.lossCause(e.cause) || {}).label || e.cause; byC[l] = (byC[l] || 0) + e.value; });
    return { sum: F(per[ms[5]] || 0) + ' this month', parts: [
      // (the Losses page shows its own totals right below: only the charts here)
      card('What causes them (90 days)', Charts.hbar(Object.entries(byC).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value), { fmt: F, max: 5, tone: 'bad', empty: 'No losses in 90 days. 🎉' }), 'ins-w2'),
      card('Losses per month', Charts.columns(ms.map((k) => ({ label: mLab(k), value: per[k] || 0 })), { fmt: F }), 'ins-w2'),
    ] };
  };
  B.staff = () => {
    const ds = daysBack(30); const f = facts(ds[0], today()); if (!f.length || !can('salesAll')) return null;
    const by = KC.groupBy(f, (x) => x.sellerId || x.seller || '?', (x) => x.seller || 'Unknown').sort((a, b) => b.revenue - a.revenue);
    return { sum: by[0] ? 'Top: ' + by[0].label : '', parts: [
      tile({ label: 'Best seller (30 days)', value: esc(by[0].label), sub: F(by[0].revenue), hero: true }),
      card('Sales by staff (30 days)', Charts.hbar(by.map((x) => ({ label: x.label, value: x.revenue, sub: x.n + ' receipts · avg ' + fmt(x.revenue / Math.max(1, x.n)) })), { fmt: F, max: 6 }), 'ins-w2'),
    ] };
  };
  B.payroll = () => {
    if (!can('payroll')) return null; const slips = (K.raw.payroll || []).filter((p) => p.type === 'slip' || p.net !== undefined); if (!slips.length) return null;
    const ms = monthsBack(6); const per = {}; slips.forEach((p) => { const k = String(p.month || '').slice(0, 7); if (ms.includes(k)) per[k] = (per[k] || 0) + num(p.net); });
    const paid = slips.filter((p) => p.status === 'paid' && String(p.month || '').slice(0, 7) === ms[5]); const due = slips.filter((p) => p.status !== 'paid' && String(p.month || '').slice(0, 7) === ms[5]);
    return { sum: F(per[ms[5]] || 0) + ' this month', parts: [
      tile({ label: 'Pay this month', value: F(per[ms[5]] || 0), now: per[ms[5]] || 0, prev: per[ms[4]] || 0, downGood: true, sub: 'vs last month', spark: ms.map((k) => per[k] || 0), hero: true }),
      tile({ label: 'Paid / still to pay', value: fmt(paid.length) + ' / ' + fmt(due.length), sub: F(sum(due, (p) => num(p.net))) + ' to pay' }),
      card('Pay per month', Charts.columns(ms.map((k) => ({ label: mLab(k), value: per[k] || 0 })), { fmt: F }), 'ins-w2'),
    ] };
  };
  B.menu = () => {
    const ds = daysBack(30); const f = facts(ds[0], today()).filter((x) => String(x.productId).startsWith('m:') || (typeof isDrinkFact === 'function' && isDrinkFact(x)));
    const items = (K.raw.menu || []).filter((m) => m.name); if (!items.length) return null;
    const top = KC.groupBy(f, (x) => x.productId, (x) => x.name).sort((a, b) => b.qty - a.qty);
    const byCat = {}; f.forEach((x) => { byCat[x.category] = (byCat[x.category] || 0) + x.revenue; });
    const off = items.filter((m) => m.soldOut || m.active === false).length;
    return { sum: fmt(items.length) + ' on the menu', parts: [
      tile({ label: 'On the menu', value: fmt(items.length - off), sub: off ? off + ' sold out or hidden' : 'all available', hero: true }),
      tile({ label: 'Sold (30 days)', value: fmt(sum(f, (x) => x.qty)), sub: F(sum(f, (x) => x.revenue)) }),
      card('Most ordered (30 days)', Charts.hbar(top.map((x) => ({ label: x.label, value: x.qty, sub: F(x.revenue) })), { fmt: (v) => fmt(v) + ' sold', max: 5, empty: 'Nothing sold yet.' }), 'ins-w2'),
      Object.keys(byCat).length ? card('Sales by menu category', Charts.donut(Object.entries(byCat).map(([k, v]) => ({ label: k, value: v })), { fmt: F, centre: baseSym() }), 'ins-w2') : '',
    ] };
  };
  B.orders = () => {
    const t = today(); const os = (K.raw.rorders || []).filter((o) => o.status !== 'void' && String(o.createdAt || '').slice(0, 10) === t);
    const tabs = (K.raw.tabs || []).filter((x) => x.status === 'open'); if (!os.length && !tabs.length) return null;
    const H = Array.from({ length: 24 }, (_, i) => (6 + i) % 24); const per = {}; os.forEach((o) => { const w = typeof venueHW === 'function' ? venueHW(o.createdAt) : { h: new Date(o.createdAt).getHours() }; if (w) per[w.h] = (per[w.h] || 0) + 1; });
    const used = H.filter((h) => per[h]); const lo = used.length ? H.indexOf(used[0]) : 0, hi = used.length ? H.indexOf(used[used.length - 1]) : -1;
    const waiting = os.filter((o) => !/served|done|paid|void/.test(o.status || '')).length; const due = typeof tabDue === 'function' ? sum(tabs, tabDue) : 0;
    return { sum: os.length + ' orders today', parts: [
      tile({ label: 'Orders today', value: fmt(os.length), sub: waiting + ' waiting', hero: true }),
      tile({ label: 'Open tables', value: fmt(tabs.length), sub: due ? F(due) + ' to collect' : 'nothing to collect' }),
      used.length ? card('Orders by hour (today)', Charts.columns(H.slice(Math.max(0, lo - 1), hi + 2).map((h) => ({ label: h + 'h', value: per[h] || 0 })), { fmt: (v) => fmt(v) + ' orders', maxLabels: 8 }), 'ins-w2') : '',
    ] };
  };
  B.bookings = () => {
    const rs = (K.raw.reservations || []).filter((r) => r.status !== 'cancelled'); if (!rs.length) return null;
    const t = today(); const next = []; for (let i = 0; i < 14; i++) next.push(KC.addDays(t, i));
    const per = {}, ppl = {}; rs.forEach((r) => { if (next.includes(r.date)) { per[r.date] = (per[r.date] || 0) + 1; ppl[r.date] = (ppl[r.date] || 0) + num(r.people); } });
    const week = next.slice(0, 7);
    return { sum: (per[t] || 0) + ' today', parts: [
      tile({ label: 'Bookings today', value: fmt(per[t] || 0), sub: fmt(ppl[t] || 0) + ' guests', hero: true }),
      tile({ label: 'Next 7 days', value: fmt(sum(week, (d) => per[d] || 0)), sub: fmt(sum(week, (d) => ppl[d] || 0)) + ' guests' }),
      card('Guests per day (next 14 days)', Charts.columns(next.map((d) => ({ label: WD[new Date(d + 'T12:00:00').getDay()].slice(0, 2) + ' ' + dLab(d), value: ppl[d] || 0, tip: (per[d] || 0) + ' bookings' })), { fmt: (v) => fmt(v) + ' guests', maxLabels: 7, empty: 'No bookings in the next 14 days.' }), 'ins-w2'),
    ] };
  };

  function strip(page) {
    if (!B[page] || !K.raw || !K.C) return '';
    const r = safe(() => B[page]()); if (!r || !r.parts) return '';
    const parts = r.parts.filter(Boolean); if (!parts.length) return '';
    const open = isOpen(page);
    return '<section class="ins' + (open ? '' : ' closed') + '" data-ins="' + page + '"><button type="button" class="ins-head" data-a="insToggle" data-v="' + page + '" aria-expanded="' + open + '">' + ic('chev', 'sm') + 'Insights<span class="ins-sum">' + esc(r.sum || '') + '</span></button>' +
      '<div class="ins-body">' + parts.join('') + '</div></section>';
  }
  if (typeof A !== 'undefined') A.insToggle = (el) => {
    const sec = el.closest('.ins'); if (!sec) return; const closed = sec.classList.toggle('closed'); el.setAttribute('aria-expanded', String(!closed));
    try { localStorage.setItem(KEY(el.dataset.v), closed ? '0' : '1'); } catch (e) { }
  };
  /* the strip goes at the top of these pages: each view's render is wrapped once (no edits inside the views) */
  const PAGES = { stock: 'stock', sales: 'sales', customers: 'customers', suppliers: 'suppliers', expenses: 'expenses', cash: 'cash', losses: 'losses', staff: 'staff', payroll: 'payroll', menu: 'menu', floor: 'orders', tickets: 'orders', bookings: 'bookings' };
  if (typeof VIEWS !== 'undefined') Object.entries(PAGES).forEach(([v, page]) => {
    const V = VIEWS[v]; if (!V || typeof V.render !== 'function' || V._ins) return;
    const base = V.render; V._ins = true;
    V.render = function () { const h = base.apply(this, arguments); return typeof h === 'string' ? strip(page) + h : h; };
  });
  return { strip };
})();
