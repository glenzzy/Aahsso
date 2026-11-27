/* Aahsso — reports & analytics */
const RP = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom']];
function repRange() {
  const t = todayStr(), k = K.ui.rp || '30d'; let from, to = t;
  if (k === 'today') from = t; else if (k === '7d') from = KC.addDays(t, -6); else if (k === '30d') from = KC.addDays(t, -29); else if (k === '90d') from = KC.addDays(t, -89);
  else if (k === 'month') from = t.slice(0, 8) + '01'; else if (k === 'lastmonth') { const d = new Date(); d.setDate(0); to = todayStr(d); from = to.slice(0, 8) + '01'; }
  else if (k === 'year') from = t.slice(0, 4) + '-01-01'; else if (k === 'custom') { from = K.ui.rpFrom || KC.addDays(t, -29); to = K.ui.rpTo || t; }
  else from = '0000-01-01';
  const span = from === '0000-01-01' ? 0 : KC.daysBetween(from, to) + 1;
  return { from, to, span, prevFrom: span ? KC.addDays(from, -span) : null, prevTo: span ? KC.addDays(from, -1) : null, label: (RP.find((r) => r[0] === k) || [0, ''])[1] };
}
const repSales = () => { const l = K.ui.repLoc || ''; return l ? visibleSales().filter((s) => (s.locationId || 'main') === l) : visibleSales(); };
const facts = (from, to) => KC.saleFacts(K.raw, K.C, { from, to, sales: repSales() });
const delta = (a, b) => b ? '<span style="color:' + (a >= b ? 'var(--ok)' : 'var(--bad)') + '">' + (a >= b ? '▲ ' : '▼ ') + pct(Math.abs((a - b) / b * 100)) + '</span> vs previous' : '';
function hbars(rows, valKey, fmtFn, sub, o) {
  return Charts.hbar(rows.map((r) => ({ label: r.label, value: r[valKey], sub: sub ? String(sub(r)).replace(/<[^>]+>/g, '') : '' })), Object.assign({ fmt: fmtFn, max: rows.length }, o || {}));
}
/** time buckets for a period: by day (up to 62 days) or by month (the last 18) */
function rpBuckets(r, f) {
  const byDay = r.span && r.span <= 62; const keys = [];
  if (byDay) for (let d = r.from; d <= r.to; d = KC.addDays(d, 1)) keys.push(d);
  else keys.push(...[...new Set(f.map((x) => String(x.date || '').slice(0, 7)).filter(Boolean))].sort().slice(-18));
  return { keys, byDay, kf: byDay ? (d) => d : (d) => String(d || '').slice(0, 7), lab: byDay ? (k) => String(+k.slice(8)) : (k) => MONTHS[+k.slice(5) - 1] + (keys.length > 12 ? ' ' + k.slice(2, 4) : '') };
}
/** money in per bucket and payment method (cash / MoMo / OM…) */
function rpPayments(r, b) {
  const per = {}; const tot = {};
  visibleSales().forEach((sa) => (sa.payments || []).forEach((p) => { if (!(p.date >= r.from && p.date <= r.to) || num(p.amount) <= 0) return; const k = b.kf(p.date); const m = p.method || 'Cash'; (per[k] = per[k] || {})[m] = (per[k][m] || 0) + num(p.amount); tot[m] = (tot[m] || 0) + num(p.amount); }));
  const keys = Object.keys(tot).sort((a, c) => tot[c] - tot[a]).map((k) => ({ key: k, label: k }));
  return { rows: b.keys.map((k) => ({ label: b.lab(k), parts: per[k] || {} })), keys };
}
const rpCard = (title, body, note, cls) => '<div class="card pad' + (cls ? ' ' + cls : '') + '"><div class="rp-h"><h3>' + title + '</h3></div>' + (note ? '<div class="rp-note">' + note + '</div>' : '') + body + '</div>';
function vbars(rows, labelFn, valKey) {
  const max = Math.max(1, ...rows.map((r) => r[valKey])); const top = rows.reduce((b, r, i) => (r[valKey] > (rows[b] || {})[valKey] ? i : b), 0);
  return '<div class="vbars">' + rows.map((r, i) => '<div class="vb' + (i === top && r[valKey] > 0 ? ' hi' : '') + '" title="' + esc(labelFn(r) + ': ' + fmt(r[valKey])) + '"><i style="height:' + (r[valKey] / max * 100) + '%"></i><span>' + esc(labelFn(r)) + '</span></div>').join('') + '</div>';
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/* Aahsso Store: five plain reports */
const ST_RTABS = { overview: 'Summary', daily: 'Daily close', items: 'Best sellers', monthly: 'Profit & loss', forecast: 'What to buy' };
/* Aahsso Bar & Resto: what a bar owner reads */
const RS_RTABS = { overview: 'Summary', daily: 'Daily close', items: 'Best sellers', timing: 'Peak times', people: 'Customers & staff', suppliers: 'Suppliers', inventory: 'Stock', monthly: 'Profit & loss', forecast: 'What to buy' };
const RTABS = [['overview', 'Overview'], ['daily', 'Daily close'], ['items', 'Items & categories'], ['timing', 'Best times'], ['people', 'Staff & customers'], ['inventory', 'Fast / slow stock'], ['suppliers', 'Suppliers'], ['forecast', 'Forecast'], ['containers', 'Containers'], ['monthly', 'Profit & loss'], ['expiry', 'Expiry'], ['losses', 'Losses']];
VIEWS.reports = {
  render() {
    const costTabs = ['monthly', 'losses', 'containers'];
    const rs = typeof isResto === 'function' && isResto(); const own = rs ? RS_RTABS : isStore() ? ST_RTABS : null;
    const tabs = (rs ? Object.keys(RS_RTABS).map((k) => [k, RS_RTABS[k]]) : RTABS).filter(([k]) => (can('costs') || !costTabs.includes(k)) && (k !== 'containers' || hasAny('ship', 'receive')) && (k !== 'suppliers' || can('suppliers') || can('purchases')) && (!own || own[k])) // a store has no containers, and only the reports a shop owner reads
      .map(([k, l]) => [k, (own && own[k]) || l]);
    let tab = own && !K.ui.repPicked ? 'overview' : K.ui.repTab; // a store / bar opens on the summary
    if (!tabs.find((t) => t[0] === tab)) tab = K.ui.repTab = 'overview';
    const needsRange = ['overview', 'items', 'timing', 'people', 'suppliers'].includes(tab);
    if (tab === 'daily' && allLocs().length > 1) K._dailyLocSel = true;
    const r = repRange();
    let body = '';
    try {
      body = ({ overview: repOverview, daily: repDaily, items: repItems, timing: repTiming, people: repPeople, suppliers: repSuppliers, inventory: repInventory, forecast: repForecast, containers: repContainers, monthly: repMonthly, expiry: repExpiry, losses: repLosses })[tab](r);
    } catch (e) { console.error(e); body = '<div class="alert bad">Report error: ' + esc(e.message) + '</div>'; }
    return '<div class="chips mb">' + tabs.map(([k, l]) => '<button class="chip' + (tab === k ? ' on' : '') + '" data-a="repTab" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      (needsRange ? '<div class="row wrap mb"><select class="inp" style="width:auto" data-c="rp">' + RP.map(([k, l]) => '<option value="' + k + '"' + ((K.ui.rp || '30d') === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
        ((K.ui.rp === 'custom') ? '<input type="date" class="inp" style="width:auto" data-c="rpFrom" value="' + r.from + '"><input type="date" class="inp" style="width:auto" data-c="rpTo" value="' + r.to + '">' : '<span class="small muted">' + (r.span ? fmtDate(r.from) + ' – ' + fmtDate(r.to) : 'All time') + '</span>') +
        (allLocs().length > 1 ? '<select class="inp" style="width:auto" data-c="repLoc"><option value="">All branches</option>' + allLocs().map((l) => '<option value="' + l.id + '"' + (K.ui.repLoc === l.id ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select>' : '') +
        (can('export') ? '<button class="btn sm" data-a="repXlsx" data-n="Report-' + tab + '-' + todayStr() + '">' + ic('dl', 'sm') + 'Excel</button>' : '') + '</div>' : '') +
      (!can('salesAll') ? '<div class="alert info mb">Reports show your own sales only.</div>' : '') + body;
  },
};
A.repTab = (el) => { K.ui.repTab = el.dataset.v; K.ui.repPicked = true; render(true); };
CH.rp = (el) => { K.ui.rp = el.value; render(true); };
CH.rpFrom = (el) => { K.ui.rpFrom = el.value; render(true); };
CH.rpTo = (el) => { K.ui.rpTo = el.value; render(true); };

function repOverview(r) {
  const f = facts(r.from, r.to), s = KC.summarize(f), pv = r.prevFrom ? KC.summarize(facts(r.prevFrom, r.prevTo)) : null;
  const byDay = KC.groupBy(f, (x) => x.date).sort((a, b) => a.key.localeCompare(b.key));
  let series, lab;
  if (byDay.length <= 31 && r.span && r.span <= 31) { series = []; for (let d = r.from; d <= r.to; d = KC.addDays(d, 1)) { const g = byDay.find((x) => x.key === d); series.push({ key: d, revenue: g ? g.revenue : 0 }); } lab = (x) => String(+x.key.slice(8)); }
  else { series = KC.groupBy(f, (x) => x.date.slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key)).slice(-18); lab = (x) => MONTHS[+x.key.slice(5) - 1]; }
  let prevSeries = null; // the same days of the period before, for the dashed line
  if (r.prevFrom && r.span <= 31 && series.length === r.span) { const pf = facts(r.prevFrom, r.prevTo); const pd = KC.groupBy(pf, (x) => x.date); prevSeries = series.map((_, i) => { const d = KC.addDays(r.prevFrom, i); const g = pd.find((x) => x.key === d); return { value: g ? g.revenue : 0 }; }); }
  const rsx = typeof isResto === 'function' && isResto(); const drinks = rsx ? KC.groupBy(f.filter(isDrinkFact), (x) => x.productId, (x) => x.name).sort((a, b) => b.revenue - a.revenue) : [];
  const food = rsx ? KC.groupBy(f.filter((x) => !isDrinkFact(x) && !/^(svc|tip)$/.test(x.productId)), (x) => x.productId, (x) => x.name).sort((a, b) => b.revenue - a.revenue) : [];
  const items = KC.groupBy(f, (x) => x.productId, (x) => x.name).sort((a, b) => b.revenue - a.revenue);
  const cats = KC.groupBy(f, (x) => x.category).sort((a, b) => b.revenue - a.revenue);
  const pays = {}; let feesTot = 0;
  visibleSales().forEach((sa) => (sa.payments || []).forEach((p) => {
    if (p.date >= r.from && p.date <= r.to) {
      pays[p.method] = (pays[p.method] || 0) + num(p.amount);
      feesTot += Math.max(0, num(p.fee));
    }
  }));
  K._repRows = { Summary: [{ From: r.from, To: r.to, Receipts: s.n, Units: s.qty, ['Revenue (' + baseSym() + ')']: Math.round(s.revenue), ...(can('costs') ? { ['Gross profit (' + baseSym() + ')']: Math.round(s.profit), 'Margin %': Math.round(s.margin) } : {}), ['Average sale (' + baseSym() + ')']: Math.round(s.avgTicket), ['MoMo charges (' + baseSym() + ')']: Math.round(feesTot) }], 'By day': byDay.map((x) => ({ Date: x.key, Receipts: x.n, Units: x.qty, ['Revenue (' + baseSym() + ')']: Math.round(x.revenue), ...(can('costs') ? { ['Profit (' + baseSym() + ')']: Math.round(x.profit) } : {}) })), Items: items.map(itemRow), Categories: cats.map(itemRow) };
  const b = rpBuckets(r, f); const per = {}; f.forEach((x) => { const k = b.kf(x.date); const o = (per[k] = per[k] || { rev: 0, profit: 0, qty: 0, ids: new Set() }); o.rev += x.revenue; o.profit += x.profit; o.qty += x.qty; o.ids.add(x.saleId); });
  const sp = (fn) => b.keys.map((k) => (per[k] ? fn(per[k]) : 0)); const pm = rpPayments(r, b); const c = can('costs');
  const tiles = Charts.kpis([
    { label: 'Sales', value: F(s.revenue), now: s.revenue, prev: pv ? pv.revenue : undefined, sub: pv ? 'vs ' + F(pv.revenue) : s.n + ' receipts', spark: sp((x) => x.rev), hero: true },
    c ? { label: 'Gross profit', value: F(s.profit), now: s.profit, prev: pv ? pv.profit : undefined, sub: pct(s.margin) + ' margin', spark: sp((x) => x.profit) } : null,
    { label: 'Receipts', value: fmt(s.n), now: s.n, prev: pv ? pv.n : undefined, sub: fmt(s.qty) + ' units', spark: sp((x) => x.ids.size) },
    { label: 'Average sale', value: F(s.avgTicket), now: s.avgTicket, prev: pv ? pv.avgTicket : undefined, sub: 'per receipt', spark: sp((x) => (x.ids.size ? x.rev / x.ids.size : 0)) },
  ]);
  const marg = cats.filter((x) => x.revenue > 0).map((x) => ({ label: x.label, value: Math.max(0, x.margin), sub: F(x.profit) + ' profit' })).sort((a, z) => z.value - a.value);
  return '<div class="mb">' + tiles + '</div>' +
    '<div class="card pad mb"><h3>Sales trend</h3>' + (series.length ? Charts.trend(series.map((x) => ({ label: lab(x), value: x.revenue })), { prev: prevSeries, fmt: F, title: 'Sales trend', nowLabel: r.label || 'This period', prevLabel: 'The ' + (r.span || '') + ' days before' }) : '<div class="muted small mt">No sales in this period.</div>') + '</div>' +
    '<div class="rp-grid mb">' + (c ? rpCard('Sales and profit', Charts.combo(b.keys.map((k) => ({ label: b.lab(k), a: per[k] ? per[k].rev : 0, b: per[k] ? per[k].profit : 0 })), { fmt: F, aLabel: 'Sales', bLabel: 'Gross profit', title: 'Sales and profit' }), b.byDay ? 'Per day' : 'Per month') : '') +
      rpCard('Money in, ' + (b.byDay ? 'per day' : 'per month'), Charts.stacked(pm.rows, pm.keys, { fmt: F, empty: 'No payments in this period.' }), 'Cash, MTN MoMo, Orange Money… as collected', c ? '' : 'wide') + '</div>' +
    (rsx ? '<div class="grid2 mb" style="align-items:start"><div class="card pad"><h3 class="mb">🍺 Best drinks</h3>' + hbars(drinks.slice(0, 8), 'revenue', fmt, (x) => fmt(x.qty) + ' sold') + '</div><div class="card pad"><h3 class="mb">🍽 Best dishes</h3>' + hbars(food.slice(0, 8), 'revenue', fmt, (x) => fmt(x.qty) + ' sold') + '</div></div>'
      : '<div class="grid2 mb" style="align-items:start"><div class="card pad"><h3 class="mb">Top items</h3>' + hbars(items.slice(0, 8), 'revenue', fmt, (x) => fmt(x.qty) + ' sold') + '</div><div class="card pad"><h3 class="mb">Top categories</h3>' + hbars(cats.slice(0, 8), 'revenue', fmt, (x) => can('costs') ? pct(x.margin) + ' margin' : fmt(x.qty) + ' units') + '</div></div>') +
    '<div class="grid2 mb" style="align-items:start"><div class="card pad"><h3>Sales by category</h3>' + Charts.donut(cats.map((x) => ({ label: x.label, value: x.revenue })), { fmt: F, centre: baseSym() }) + '</div>' +
    '<div class="card pad"><h3>Money in by method</h3>' + Charts.donut(Object.entries(pays).map(([k, v]) => ({ label: k, value: v })), { fmt: F, centre: 'collected', empty: 'No payments in this period.' }) + (feesTot > 0 ? '<div class="row between cl mt"><span class="muted">MoMo / OM charges (separate)</span><b class="money">' + F(feesTot) + '</b></div>' : '') + '</div></div>' +
    (c && marg.length ? '<div class="card pad mb"><h3>Margin by category</h3><div class="rp-note">Of every 100 sold, what stays after the cost of the goods</div>' + Charts.hbar(marg, { fmt: (v) => pct(v), max: 10 }) + '</div>' : '');
}
function itemRow(x) { return Object.assign({ Name: x.label, Receipts: x.n, Units: x.qty, ['Revenue (' + baseSym() + ')']: Math.round(x.revenue) }, can('costs') ? { ['Cost (' + baseSym() + ')']: Math.round(x.cogs), ['Profit (' + baseSym() + ')']: Math.round(x.profit), 'Margin %': Math.round(x.margin) } : {}); }
function repItems(r) {
  const rsx = typeof isResto === 'function' && isResto(); const kindF = rsx ? K.ui.rkind || 'drinks' : 'all';
  const f = facts(r.from, r.to).filter((x) => !/^(svc|tip)$/.test(x.productId) && (kindF === 'all' || (kindF === 'drinks') === isDrinkFact(x))); const g = K.ui.rgroup || 'item'; let m = K.ui.rmetric || 'revenue'; if (!can('costs') && (m === 'profit' || m === 'margin')) m = 'revenue';
  const key = g === 'item' ? (x) => x.productId : g === 'category' ? (x) => x.category : (x) => x.category + ' › ' + (x.subcategory || '—');
  const lab = g === 'item' ? (x) => x.name : null;
  const rows = KC.groupBy(f, key, lab).sort((a, b) => (m === 'qty' ? b.qty - a.qty : m === 'profit' ? b.profit - a.profit : m === 'margin' ? b.margin - a.margin : b.revenue - a.revenue));
  const M = [['revenue', 'Sales value'], ['qty', 'Units sold']].concat(can('costs') ? [['profit', 'Profit'], ['margin', 'Margin %']] : []);
  K._repRows = { [g]: rows.map(itemRow) };
  const fmtM = m === 'margin' ? (v) => pct(v) : m === 'qty' ? fmt : F;
  const lead = rows[0] ? rows[0] : null;
  return (rsx ? '<div class="seg mb">' + [['drinks', '🍺 Drinks'], ['food', '🍽 Food'], ['all', 'Everything']].map(([k, l]) => '<button class="' + (kindF === k ? 'on' : '') + '" data-a="rkind" data-v="' + k + '">' + l + '</button>').join('') + '</div>' : '') +
    (lead ? '<div class="rp-ins">' + [['Best ' + (kindF === 'drinks' ? 'drink' : kindF === 'food' ? 'dish' : 'seller'), esc(lead.label), fmt(lead.qty) + ' sold · ' + F(lead.revenue)], ['Sold', fmt(rows.reduce((a, x) => a + x.qty, 0)), rows.length + ' different'], ['Sales', F(rows.reduce((a, x) => a + x.revenue, 0)), r.label]].concat(can('costs') && rows.length ? [['Most profit', esc(rows.slice().sort((a, b) => b.profit - a.profit)[0].label), F(rows.slice().sort((a, b) => b.profit - a.profit)[0].profit)]] : []).map(([l, v, s]) => '<div class="rp-in"><div class="l">' + l + '</div><div class="v ellipsis">' + v + '</div><div class="s">' + s + '</div></div>').join('') + '</div>' : '') +
    '<div class="row wrap mb"><div class="seg">' + [['item', 'Item'], ['category', 'Category'], ['sub', 'Subcategory']].map(([k, l]) => '<button class="' + (g === k ? 'on' : '') + '" data-a="rgroup" data-v="' + k + '">' + l + '</button>').join('') + '</div><div class="seg">' + M.map(([k, l]) => '<button class="' + (m === k ? 'on' : '') + '" data-a="rmetric" data-v="' + k + '">' + l + '</button>').join('') + '</div></div>' +
    (rows.length && can('costs') ? '<div class="alert info mb">' + ic('chart', 'sm') + '<div>Most profitable ' + (g === 'item' ? 'item' : 'category') + ': <b>' + esc(rows.slice().sort((a, b) => b.profit - a.profit)[0].label) + '</b> · Best margin: <b>' + esc(rows.filter((x) => x.qty > 0).sort((a, b) => b.margin - a.margin)[0].label) + '</b></div></div>' : '') +
    '<div class="grid2 mb" style="align-items:start;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)"><div class="card pad"><h3 class="mb">Top ' + Math.min(15, rows.length) + '</h3>' + hbars(rows.slice(0, 15), m, fmtM, (x) => fmt(x.qty) + ' sold · ' + F(x.revenue) + (can('costs') ? ' · ' + pct(x.margin) : '')) + '</div>' +
    '<div class="card pad"><h3>Share of sales</h3>' + Charts.donut(rows.map((x) => ({ label: x.label, value: m === 'qty' ? x.qty : x.revenue })), { fmt: m === 'qty' ? fmt : F, centre: m === 'qty' ? 'sold' : baseSym() }) + '</div></div>' +
    '<div class="card tw"><table class="t"><thead><tr><th>' + (g === 'item' ? 'Item' : 'Category') + '</th><th class="r">Units</th><th class="r">Sales</th>' + (can('costs') ? '<th class="r">Profit</th><th class="r">Margin</th>' : '') + '<th class="r">Share</th></tr></thead><tbody>' +
    (() => { const tot = rows.reduce((a, x) => a + x.revenue, 0) || 1; return rows.map((x) => '<tr><td>' + esc(x.label) + '</td><td class="r">' + fmt(x.qty) + '</td><td class="r money">' + fmt(x.revenue) + '</td>' + (can('costs') ? '<td class="r money" style="color:' + (x.profit < 0 ? 'var(--bad)' : 'var(--ok)') + '">' + fmt(x.profit) + '</td><td class="r">' + pct(x.margin) + '</td>' : '') + '<td class="r">' + pct(x.revenue / tot * 100) + '</td></tr>').join(''); })() + '</tbody></table></div>';
}
A.rkind = (el) => { K.ui.rkind = el.dataset.v; render(true); };
A.rgroup = (el) => { K.ui.rgroup = el.dataset.v; render(true); };
A.rmetric = (el) => { K.ui.rmetric = el.dataset.v; render(true); };
/** a sale's hour and weekday on the venue's clock (its time zone), not the phone's */
const venueHW = (() => { let tz, fm; return (iso) => {
  const d = new Date(iso); if (isNaN(d)) return null; const z = (S() && S().timezone) || 'Africa/Douala';
  if (tz !== z) { tz = z; try { fm = new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', hourCycle: 'h23', weekday: 'short' }); } catch (e) { fm = null; } }
  if (!fm) return { h: d.getHours(), wd: d.getDay() }; const p = Object.fromEntries(fm.formatToParts(d).map((x) => [x.type, x.value]));
  return { h: +p.hour % 24, wd: WD.indexOf(p.weekday) };
}; })();
function repTiming(r) {
  const f0 = facts(r.from, r.to); const when = {}; repSales().forEach((s) => { if (s.createdAt) when[s.id] = venueHW(s.createdAt); });
  const f = f0.map((x) => { const w = when[x.saleId]; return w && w.wd >= 0 ? Object.assign({}, x, { hour: w.h, weekday: w.wd }) : x; });
  const wd = [1, 2, 3, 4, 5, 6, 0].map((d) => { const g = f.filter((x) => x.weekday === d); return { d, revenue: g.reduce((a, x) => a + x.revenue, 0), n: new Set(g.map((x) => x.saleId)).size }; });
  const H0 = 6, HOURS = Array.from({ length: 24 }, (_, i) => (H0 + i) % 24); // the day starts at 6 am: a late night stays one night
  const hrs = HOURS.map((h) => { const g = f.filter((x) => x.hour === h); return { h, revenue: g.reduce((a, x) => a + x.revenue, 0), n: new Set(g.map((x) => x.saleId)).size }; });
  const grid = [1, 2, 3, 4, 5, 6, 0].map((d) => HOURS.map((h) => f.filter((x) => x.weekday === d && x.hour === h).reduce((a, x) => a + x.revenue, 0)));
  const orders = (K.raw.rorders || []).filter((o) => o.createdAt && (o.createdAt.slice(0, 10) >= r.from && o.createdAt.slice(0, 10) <= r.to) && o.status !== 'void');
  const ordH = HOURS.map((h) => ({ h, n: orders.filter((o) => { const w = venueHW(o.createdAt); return w && w.h === h; }).length }));
  const dom = []; for (let d = 1; d <= 31; d++) { const g = f.filter((x) => +x.date.slice(8) === d); dom.push({ d, revenue: g.reduce((a, x) => a + x.revenue, 0) }); }
  const all = KC.saleFacts(K.raw, K.C, { sales: visibleSales() });
  const months = KC.groupBy(all, (x) => x.date.slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key)).slice(-12);
  const years = KC.groupBy(all, (x) => x.date.slice(0, 4)).sort((a, b) => a.key.localeCompare(b.key));
  const best = wd.slice().sort((a, b) => b.revenue - a.revenue)[0]; const bestH = hrs.slice().sort((a, b) => b.revenue - a.revenue)[0];
  const weeks = [1, 2, 3, 4].map((w) => ({ w, revenue: dom.filter((x) => Math.min(4, Math.ceil(x.d / 7.75)) === w).reduce((a, x) => a + x.revenue, 0) }));
  K._repRows = { Weekday: wd.map((x) => ({ Day: WD[x.d], Receipts: x.n, ['Revenue (' + baseSym() + ')']: Math.round(x.revenue) })), Hour: hrs.map((x) => ({ Hour: x.h + ':00', Receipts: x.n, ['Revenue (' + baseSym() + ')']: Math.round(x.revenue) })), 'Day × hour': [1, 2, 3, 4, 5, 6, 0].map((d, i) => Object.assign({ Day: WD[d] }, Object.fromEntries(HOURS.map((h, j) => [h + ':00', Math.round(grid[i][j])])))), 'Day of month': dom.map((x) => ({ Day: x.d, ['Revenue (' + baseSym() + ')']: Math.round(x.revenue) })), Months: months.map((x) => ({ Month: x.key, ['Revenue (' + baseSym() + ')']: Math.round(x.revenue), ...(can('costs') ? { ['Profit (' + baseSym() + ')']: Math.round(x.profit) } : {}) })), Years: years.map((x) => ({ Year: x.key, ['Revenue (' + baseSym() + ')']: Math.round(x.revenue), ...(can('costs') ? { ['Profit (' + baseSym() + ')']: Math.round(x.profit) } : {}) })) };
  const hh = (h) => pad2(h) + ':00'; const quiet = wd.filter((x) => x.revenue > 0).sort((a, b) => a.revenue - b.revenue)[0];
  const bestCell = (() => { let b = null; grid.forEach((row, i) => row.forEach((v, j) => { if (v > 0 && (!b || v > b.v)) b = { v, d: [1, 2, 3, 4, 5, 6, 0][i], h: HOURS[j] }; })); return b; })();
  return (f.length ? '<div class="rp-ins">' + [['Busiest day', WD[best.d], F(best.revenue) + ' · ' + best.n + ' bills'], ['Busiest hour', bestH.revenue ? hh(bestH.h) + '–' + hh((bestH.h + 1) % 24) : '—', bestH.revenue ? F(bestH.revenue) : ''], ['Peak of the week', bestCell ? WD[bestCell.d] + ' ' + hh(bestCell.h) : '—', bestCell ? F(bestCell.v) : ''], ['Quietest day', quiet ? WD[quiet.d] : '—', quiet ? F(quiet.revenue) : '']].map(([l, v, s]) => '<div class="rp-in"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>').join('') + '</div>' +
      '<div class="alert info mb">' + ic('clock', 'sm') + '<div>Put your best staff on <b>' + WD[best.d] + '</b>' + (bestH.revenue ? ' around <b>' + hh(bestH.h) + '</b>' : '') + ' and restock before then' + (quiet ? '; try a promotion on <b>' + WD[quiet.d] + '</b>' : '') + '. Times are ' + esc(((KC.venueClock(S()) || {}).city || 'local')) + ' time.</div></div>' : '') +
    '<div class="card pad mb"><h3>When the money comes in</h3><div class="tiny muted">Each square is one hour of one weekday, over ' + esc(r.label || 'the period') + '. Darker = more sales.</div>' + Charts.heat(grid, [1, 2, 3, 4, 5, 6, 0].map((d) => WD[d]), HOURS.map((h) => String(h)), { fmt: F, title: 'Sales by day and hour' }) + '</div>' +
    '<div class="grid2 mb" style="align-items:start"><div class="card pad"><h3>By day of the week</h3>' + Charts.columns(wd.map((x) => ({ label: WD[x.d], value: x.revenue, tip: x.n + ' bills' })), { fmt: F }) + '</div>' +
    '<div class="card pad"><h3>By hour</h3>' + Charts.columns(hrs.map((x) => ({ label: x.h + 'h', value: x.revenue, tip: x.n + ' bills' })), { fmt: F, maxLabels: 8 }) + '</div></div>' +
    (orders.length ? '<div class="card pad mb"><h3>Orders placed, by hour</h3><div class="tiny muted">When waiters and customers send orders (' + orders.length + ' orders) — the real rush, before the bills are paid.</div>' + Charts.columns(ordH.map((x) => ({ label: x.h + 'h', value: x.n })), { fmt: (v) => fmt(v) + ' orders', maxLabels: 8 }) + '</div>' : '') +
    '<div class="grid2 mb" style="align-items:start"><div class="card pad"><h3>By week of the month</h3><div class="tiny muted">Payday weeks are often stronger.</div>' + Charts.columns(weeks.map((x) => ({ label: 'Week ' + x.w, value: x.revenue })), { fmt: F }) + '</div>' +
    '<div class="card pad"><h3>By month (last 12)</h3>' + Charts.trend(months.map((x) => ({ label: MONTHS[+x.key.slice(5) - 1], value: x.revenue })), { fmt: F, empty: 'No data.' }) + '</div></div>' +
    '<div class="card pad mb"><h3 class="mb">By year</h3>' + hbars(years.map((y) => Object.assign(y, { label: y.key })), 'revenue', F, (x) => can('costs') ? 'profit ' + fmt(x.profit) : fmt(x.qty) + ' units') + '</div>';
}
function repPeople(r) {
  const f = facts(r.from, r.to);
  const sellers = KC.groupBy(f, (x) => x.sellerId || x.seller || 'unknown', (x) => x.seller || 'Unknown').sort((a, b) => b.revenue - a.revenue);
  const custs = KC.groupBy(f.filter((x) => x.customerId), (x) => x.customerId, (x) => x.customer).sort((a, b) => b.revenue - a.revenue);
  const owing = {}; visibleSales().forEach((s) => { const x = K.C.saleX[s.id]; if (x.status !== 'cancelled' && x.balance > 0) { const k = s.customerId || s.customerName; owing[k] = owing[k] || { label: s.customerName, balance: 0, n: 0 }; owing[k].balance += x.balance; owing[k].n++; } });
  const ow = Object.values(owing).sort((a, b) => b.balance - a.balance);
  K._repRows = { Staff: sellers.map(itemRow), Customers: custs.map(itemRow), Owing: ow.map((o) => ({ Customer: o.label, 'Open sales': o.n, ['Balance (' + baseSym() + ')']: Math.round(o.balance) })) };
  const named = f.filter((x) => x.customerId).reduce((a, x) => a + x.revenue, 0), walk = f.filter((x) => !x.customerId).reduce((a, x) => a + x.revenue, 0);
  const owedT = ow.reduce((a, o) => a + o.balance, 0); const back = custs.filter((c) => c.n > 1).length;
  const age = [[0, 30, '0–30 days'], [31, 60, '31–60'], [61, 90, '61–90'], [91, 1e9, '90+ days']].map(([a, z, l]) => ({ label: l, value: 0, n: 0, a, z }));
  visibleSales().forEach((sa) => { const x = K.C.saleX[sa.id]; if (x.status === 'cancelled' || !(x.balance > 0)) return; const d = KC.daysBetween(saleDate(sa), todayStr()); const g = age.find((q) => d >= q.a && d <= q.z); if (g) { g.value += x.balance; g.n++; } });
  const firstBuy = {}; visibleSales().forEach((sa) => { if (!sa.customerId || K.C.saleX[sa.id].status === 'cancelled') return; const d = saleDate(sa); if (!firstBuy[sa.customerId] || d < firstBuy[sa.customerId]) firstBuy[sa.customerId] = d; });
  const nNew = custs.filter((c) => (firstBuy[c.key] || '') >= r.from).length;
  const extra = '<div class="rp-grid mb">' + rpCard('How old the unpaid bills are', Charts.columns(age.map((g) => ({ label: g.label, value: g.value, tip: g.n + ' sale' + (g.n === 1 ? '' : 's') })), { fmt: F, empty: 'Nobody owes you. 🎉' }), 'Older debts are harder to collect — call those first') +
    rpCard('New and returning customers', Charts.donut([{ label: 'New in this period', value: nNew }, { label: 'Came before', value: custs.length - nNew }], { fmt, centre: 'customers', empty: 'No known customers in this period.' })) + '</div>';
  return '<div class="rp-ins">' + [['Customers served', fmt(custs.length), back + ' came back more than once'], ['Best customer', custs[0] ? esc(custs[0].label) : '—', custs[0] ? F(custs[0].revenue) : ''], ['Owed to you', F(owedT), ow.length + ' customer' + (ow.length === 1 ? '' : 's')], ['Best staff', sellers[0] ? esc(sellers[0].label) : '—', sellers[0] ? F(sellers[0].revenue) : '']].map(([l, v, s]) => '<div class="rp-in"><div class="l">' + l + '</div><div class="v ellipsis">' + v + '</div><div class="s">' + s + '</div></div>').join('') + '</div>' +
    '<div class="grid2 mb" style="align-items:start"><div class="card pad"><h3>Known customers vs walk-ins</h3>' + Charts.donut([{ label: 'Known customers', value: named }, { label: 'Walk-ins', value: walk }], { fmt: F, centre: baseSym() }) + '</div>' +
    '<div class="card pad"><h3>Who owes you</h3>' + Charts.donut(ow.map((o) => ({ label: o.label, value: o.balance })), { fmt: F, centre: 'owed', empty: 'Nobody owes you. 🎉' }) + '</div></div>' +
    extra + '<div class="card pad mb"><h3 class="mb">Sales by staff member</h3>' + hbars(sellers, 'revenue', F, (x) => x.n + ' receipts · avg ' + fmt(x.revenue / Math.max(1, x.n)) + (can('costs') ? ' · ' + pct(x.margin) + ' margin' : '')) + '</div>' +
    '<div class="card pad mb"><h3 class="mb">Top customers</h3>' + hbars(custs.slice(0, 15), 'revenue', F, (x) => x.n + ' purchase(s)') + '</div>' +
    '<div class="card pad mb"><h3 class="mb">Who owes you (all time)</h3>' + (ow.length ? ow.map((o) => '<div class="row between cl"><span>' + esc(o.label) + ' <span class="tiny faint">' + o.n + ' sale(s)</span></span><b class="money" style="color:var(--bad)">' + F(o.balance) + '</b></div>').join('') : '<div class="muted small">Nobody owes you. 🎉</div>') + '</div>';
}
/** a sold line is a drink: a bar menu item (or a drink category), or a stock item from the drinks list */
function isDrinkFact(x) {
  const id = String(x.productId || '');
  if (id.startsWith('m:')) { const m = typeof menuById === 'function' ? menuById(id.slice(2)) : null; return m ? KC.stationOf(m, typeof venue === 'function' ? venue() : 'both') === 'bar' : KC.DRINK_CATS.includes(x.category); }
  const p = byId('products', id); return !!(p && p.drink) || /beer|wine|spirit|soft|water|juice|drink|champagne|liqueur|malt|energy|cider/i.test(x.category || '');
}
/* Suppliers: what was bought from whom over the period, what is still owed, and the drinks bought most */
function repSuppliers(r) {
  const lots = K.raw.lots.filter((l) => (l.purchaseDate || '') >= r.from && (l.purchaseDate || '') <= r.to);
  const groups = purchaseGroups(lots); const c = can('costs');
  const by = {}; groups.forEach((g) => { const k = supKey(g.vendor) || '—'; const o = (by[k] = by[k] || { label: (g.vendor || 'No supplier').trim(), value: 0, n: 0, last: '', units: 0 }); o.value += g.totalX; o.n++; o.units += g.units; if ((g.date || '') > o.last) o.last = g.date || ''; });
  const sup = Object.values(by).sort((a, b) => b.value - a.value);
  const owed = (K.raw.suppliers || []).map((s) => ({ label: s.name, value: supplierOwed(s.id) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const monthly = r.span && r.span <= 62; const keyOf = (d) => (monthly ? KC.addDays(d, -((new Date(d + 'T12:00:00').getDay() + 6) % 7)) : d.slice(0, 7)); // by week (from Monday) or by month
  const per = {}; groups.forEach((g) => { if (!g.date) return; const k = keyOf(g.date); per[k] = (per[k] || 0) + g.totalX; });
  const series = Object.keys(per).sort().map((k) => ({ label: monthly ? fmtDate(k).split(' ').slice(0, 2).join(' ') : MONTHS[+k.slice(5) - 1] + ' ' + k.slice(2, 4), value: per[k] }));
  const items = {}; lots.forEach((l) => { const p = byId('products', l.productId); const o = (items[l.productId] = items[l.productId] || { label: (p && p.name) || '?', qty: 0, value: 0 }); o.qty += num(l.qty); o.value += K.C.lotX[l.id].paidX * num(l.qty); });
  const top = Object.values(items).sort((a, b) => (c ? b.value - a.value : b.qty - a.qty)).slice(0, 10);
  const total = sup.reduce((a, x) => a + x.value, 0), owedT = owed.reduce((a, x) => a + x.value, 0);
  K._repRows = { Suppliers: sup.map((x) => ({ Supplier: x.label, Purchases: x.n, Units: x.units, ...(c ? { ['Bought (' + baseSym() + ')']: Math.round(x.value) } : {}), 'Last purchase': x.last })), Owed: owed.map((x) => ({ Supplier: x.label, ['Owed (' + baseSym() + ')']: Math.round(x.value) })), 'Bought most': top.map((x) => ({ Item: x.label, Units: x.qty, ...(c ? { ['Cost (' + baseSym() + ')']: Math.round(x.value) } : {}) })) };
  if (!groups.length && !owed.length) return '<div class="card empty"><div class="big">🚚</div>No purchases in this period.</div>';
  return '<div class="rp-ins">' + [c ? ['Bought', F(total), groups.length + ' purchases'] : ['Purchases', fmt(groups.length), r.label], ['Suppliers used', fmt(sup.length), sup[0] ? 'Most: ' + esc(sup[0].label) : ''], ['You owe suppliers', F(owedT), owed.length + ' supplier' + (owed.length === 1 ? '' : 's')], ['Units bought', fmt(sup.reduce((a, x) => a + x.units, 0)), top[0] ? 'Most: ' + esc(top[0].label) : '']].map(([l, v, s]) => '<div class="rp-in"><div class="l">' + l + '</div><div class="v ellipsis">' + v + '</div><div class="s ellipsis">' + s + '</div></div>').join('') + '</div>' +
    (c ? (() => { const tops = sup.slice(0, 4); const keys = tops.map((x) => ({ key: x.label, label: x.label })).concat(sup.length > 4 ? [{ key: '__o', label: 'Other suppliers', color: 'var(--cs-other)' }] : []);
      const per2 = {}; groups.forEach((g) => { if (!g.date) return; const k = keyOf(g.date); const nm = (g.vendor || 'No supplier').trim(); const kk = tops.some((t) => t.label === nm) ? nm : '__o'; (per2[k] = per2[k] || {})[kk] = (per2[k][kk] || 0) + g.totalX; });
      return '<div class="card pad mb"><h3>Buying ' + (monthly ? 'by week' : 'by month') + ', by supplier</h3>' + Charts.stacked(Object.keys(per2).sort().map((k, i) => ({ label: series[i] ? series[i].label : k, parts: per2[k] })), keys, { fmt: F, empty: 'No purchases.' }) + '</div>'; })() : '') +
    '<div class="grid2 mb" style="align-items:start"><div class="card pad"><h3>' + (c ? 'Spend by supplier' : 'Purchases by supplier') + '</h3>' + (c ? Charts.donut(sup.map((x) => ({ label: x.label, value: x.value })), { fmt: F, centre: baseSym() }) : hbars(sup.map((x) => Object.assign({}, x, { value: x.n })), 'value', fmt)) + '</div>' +
    '<div class="card pad"><h3 class="mb">What you owe (today)</h3>' + (owed.length ? hbars(owed, 'value', F) : '<div class="muted small">You owe no supplier. 🎉</div>') + '</div></div>' +
    '<div class="card pad mb"><h3 class="mb">Bought most</h3>' + hbars(top.map((x) => Object.assign({}, x, { v: c ? x.value : x.qty })), 'v', c ? F : fmt, (x) => fmt(x.qty) + ' units') + '</div>' +
    '<div class="card tw mb"><table class="t"><thead><tr><th>Supplier</th><th class="r">Purchases</th><th class="r">Units</th>' + (c ? '<th class="r">Bought</th>' : '') + '<th>Last</th></tr></thead><tbody>' + sup.map((x) => '<tr><td>' + esc(x.label) + '</td><td class="r">' + x.n + '</td><td class="r">' + fmt(x.units) + '</td>' + (c ? '<td class="r money">' + fmt(x.value) + '</td>' : '') + '<td class="nowrap">' + (x.last ? fmtDate(x.last) : '—') + '</td></tr>').join('') + '</tbody></table></div>';
}
const STATUS_INFO = { fast: ['Fast mover', 'ok', 'Sells out in under 30 days — buy more next container.'], steady: ['Steady', 'brand', '1–3 months of stock left at current speed.'], slow: ['Slow mover', 'warn', 'Over 3 months of stock or no recent sales — discount or bundle.'], dead: ['Not selling', 'bad', 'In stock 45+ days and never sold — clear it out.'], new: ['New arrival', 'info', 'Just arrived; give it a week.'], out: ['Sold out', '', ''], incoming: ['Incoming', 'info', ''] };
function repInventory() {
  const h = KC.inventoryHealth(K.raw, K.C, todayStr()); const f = K.ui.invF || 'all';
  const counts = {}; h.forEach((x) => (counts[x.status] = (counts[x.status] || 0) + 1));
  let list = h.filter((x) => f === 'all' ? x.available > 0 : x.status === f);
  list.sort((a, b) => f === 'fast' ? a.daysOfStock - b.daysOfStock : f === 'slow' || f === 'dead' ? b.stockValue - a.stockValue : b.velocity - a.velocity);
  const aging = [[0, 30, '0–30 days'], [31, 60, '31–60 days'], [61, 90, '61–90 days'], [91, 99999, 'Over 90 days']].map(([a, b, l]) => { const g = h.filter((x) => x.available > 0 && x.ageDays >= a && x.ageDays <= b); return { label: l, value: g.reduce((s, x) => s + (can('costs') ? x.stockValue : x.retailValue), 0), n: g.length }; });
  const byCat = {}; h.forEach((x) => { if (x.available <= 0) return; const c = (byCat[x.category] = byCat[x.category] || { label: x.category, value: 0, units: 0 }); c.value += can('costs') ? x.stockValue : x.retailValue; c.units += x.available; });
  K._repRows = { 'Stock movement': h.map((x) => ({ Item: x.name, Category: x.category, Status: STATUS_INFO[x.status][0], 'In stock': x.available, Incoming: x.incoming, 'Sold last 30d': x.sold30, 'Sold last 90d': x.sold90, 'Per day': Math.round(x.velocity * 100) / 100, 'Days of stock left': isFinite(x.daysOfStock) ? Math.round(x.daysOfStock) : 'never', 'Sell-through %': Math.round(x.sellThrough), 'Days in stock': x.ageDays, 'Last sale': x.lastSale || '', ...(can('costs') ? { ['Stock value at cost (' + baseSym() + ')']: Math.round(x.stockValue) } : {}), ['Stock at selling price (' + baseSym() + ')']: Math.round(x.retailValue) })) };
  const F_ = [['all', 'All in stock'], ['fast', 'Fast'], ['steady', 'Steady'], ['slow', 'Slow'], ['dead', 'Not selling'], ['new', 'New']];
  return '<div class="row mb">' + (can('export') ? '<button class="btn sm" data-a="repXlsx" data-n="Stock-movement-' + todayStr() + '">' + ic('dl', 'sm') + 'Excel</button>' : '') + '</div>' +
    '<div class="kpis mb">' + kpi('Fast movers', fmt(counts.fast || 0), 'sell out < 30 days', true) + kpi('Slow movers', fmt(counts.slow || 0), '> 90 days of stock') + kpi('Not selling', fmt(counts.dead || 0), 'never sold, 45+ days') + kpi('Sold out', fmt(counts.out || 0), (counts.incoming || 0) + ' incoming') + '</div>' +
    '<div class="chips mb">' + F_.map(([k, l]) => '<button class="chip' + (f === k ? ' on' : '') + '" data-a="invF" data-v="' + k + '">' + l + (counts[k] ? ' · ' + counts[k] : '') + '</button>').join('') + '</div>' +
    (STATUS_INFO[f] && STATUS_INFO[f][2] ? '<div class="alert info mb">' + esc(STATUS_INFO[f][2]) + '</div>' : '') +
    '<div class="card list mb">' + (list.length ? list.slice(0, 200).map((x) => { const p = byId('products', x.id); const si = STATUS_INFO[x.status]; return '<div class="li" style="cursor:default">' + thumb(p, 40, 10) + '<div class="grow" style="min-width:0"><div class="t ellipsis">' + esc(x.name) + '</div><div class="tiny muted">' + x.sold30 + ' sold in 30 days · ' + (x.velocity ? (Math.round(x.velocity * 10) / 10) + '/day' : 'no recent sales') + ' · in stock ' + x.ageDays + ' days</div></div><div class="right"><span class="badge ' + si[1] + '">' + si[0] + '</span><div class="tiny muted mt" style="margin-top:4px">' + fmt(x.available) + ' left · ' + (isFinite(x.daysOfStock) ? '≈' + Math.round(x.daysOfStock) + ' days' : '—') + '</div></div></div>'; }).join('') : '<div class="empty small">Nothing in this group.</div>') + '</div>' +
    (() => { const tied = h.filter((x) => (x.status === 'slow' || x.status === 'dead') && x.available > 0).map((x) => ({ label: x.name, value: can('costs') ? x.stockValue : x.retailValue, sub: fmt(x.available) + ' left · ' + STATUS_INFO[x.status][0].toLowerCase() })).sort((a, z) => z.value - a.value);
      const mix = ['fast', 'steady', 'slow', 'dead', 'new'].map((k) => ({ label: STATUS_INFO[k][0], value: counts[k] || 0 }));
      return '<div class="rp-grid mb">' + rpCard('Stock value by category', Charts.hbar(Object.values(byCat).map((x) => ({ label: x.label, value: x.value, sub: fmt(x.units) + ' units' })).sort((a, z) => z.value - a.value), { fmt: F, max: 10 }), can('costs') ? 'At cost' : 'At selling price') +
        rpCard('Money stuck in slow stock', Charts.hbar(tied, { fmt: F, max: 8, empty: 'Nothing slow. 🎉' }), 'Discount, bundle or stop buying these') +
        rpCard('How your items sell', Charts.donut(mix, { fmt: (v) => fmt(v) + ' items', centre: 'items' }), '', 'wide') + '</div>'; })() +
    '<div class="grid2" style="align-items:start"><div class="card pad"><h3>How long it has been in stock</h3><div class="tiny muted">' + (can('costs') ? 'Value at cost' : 'Value at selling price') + '</div>' + Charts.columns(aging.map((x) => ({ label: x.label.replace(' days', 'd').replace('Over 90d', '90d+'), value: x.value, tip: x.n + ' item(s)' })), { fmt: F }) + '</div><div class="card pad"><h3>Stock by category</h3>' + Charts.donut(Object.values(byCat).map((x) => ({ label: x.label, value: x.value })), { fmt: F, centre: baseSym() }) + '</div></div>';
}
A.invF = (el) => { K.ui.invF = el.dataset.v; render(true); };
function repForecast() {
  const today = todayStr(); const h = KC.inventoryHealth(K.raw, K.C, today); const P = KC.projections(K.raw, K.C, today, h);
  const c = can('costs');
  K._repRows = { Projections: [{ ['Last 30 days sales (' + baseSym() + ')']: Math.round(P.last30.revenue), ['Previous 30 days (' + baseSym() + ')']: Math.round(P.prev30.revenue), 'Trend %': P.trendPct == null ? '' : Math.round(P.trendPct), ['Average per day (' + baseSym() + ')']: Math.round(P.dailyRev), ['Projected this month (' + baseSym() + ')']: Math.round(P.projectedMonthRev), ['Projected this year (' + baseSym() + ')']: Math.round(P.projectedYearRev), ...(c ? { ['Projected month profit (' + baseSym() + ')']: Math.round(P.projectedMonthProfit), ['Projected year profit (' + baseSym() + ')']: Math.round(P.projectedYearProfit) } : {}), ['Stock at selling price (' + baseSym() + ')']: Math.round(P.stockRetail), 'Days to sell all stock': P.daysToSellStock ?? '' }],
    [isStore() ? 'What to buy next' : 'Buy next container']: P.reorder.map((x) => ({ Item: x.name, Category: x.category, 'Sold per day': Math.round(x.velocity * 100) / 100, 'In stock': x.available, Incoming: x.incoming, 'Suggested qty': x.suggest, ...(c ? { ['Profit per unit (' + baseSym() + ')']: Math.round(x.unitProfit), ['Expected profit (' + baseSym() + ')']: Math.round(x.expectedProfit) } : {}) })),
    'Running out': P.stockouts.map((x) => ({ Item: x.name, 'In stock': x.available, 'Days left': Math.round(x.daysOfStock) })), Containers: P.containers.map((x) => ({ Container: x.name, ['Landed (' + baseSym() + ')']: Math.round(x.landed), ['Revenue (' + baseSym() + ')']: Math.round(x.revenue), 'Recovered %': Math.round(x.recoveredPct), 'Days to break even': x.breakEvenDays ?? '' })) };
  return '<div class="row mb">' + (can('export') ? '<button class="btn sm" data-a="repXlsx" data-n="Forecast-' + today + '">' + ic('dl', 'sm') + 'Excel</button>' : '') + '<span class="small muted">Based on your last 30 days of sales.</span></div>' +
    '<div class="kpis mb">' + kpi('Projected this month', F(P.projectedMonthRev), F(P.mtd.revenue) + ' so far', true) + (c ? kpi('Projected month profit', F(P.projectedMonthProfit)) : '') + kpi('Projected this year', F(P.projectedYearRev), c ? 'profit ≈ ' + fmt(P.projectedYearProfit) : '') + kpi('Trend', P.trendPct == null ? '—' : (P.trendPct >= 0 ? '▲ ' : '▼ ') + pct(Math.abs(P.trendPct)), 'last 30 days vs previous 30') + (!c ? kpi('Per day', F(P.dailyRev)) : '') + '</div>' +
    '<div class="card pad mb"><h3>Current stock</h3><div class="grid3 small mt"><div><div class="faint tiny">At selling price</div><b class="money">' + F(P.stockRetail) + '</b></div>' + (c ? '<div><div class="faint tiny">At cost</div><b class="money">' + F(P.stockCost) + '</b></div><div><div class="faint tiny">Profit still inside</div><b class="money" style="color:var(--ok)">' + F(P.stockRetail - P.stockCost) + '</b></div>' : '') + '</div><div class="small mt">At today\'s speed (' + F(P.dailyRev) + '/day) your stock lasts about <b>' + (P.daysToSellStock ? P.daysToSellStock + ' days' : '—') + '</b>' + (P.daysToSellStock ? ' (until ' + fmtDate(KC.addDays(today, P.daysToSellStock)) + ')' : '') + '. Book the next container about 6–8 weeks before then.</div></div>' +
    '<div class="rp-grid mb">' + rpCard('This month so far', Charts.gauge(P.mtd.revenue, Math.max(P.projectedMonthRev, P.mtd.revenue), { fmt: F, label: F(P.mtd.revenue) + ' of ≈ ' + F(P.projectedMonthRev), marker: (() => { const t = todayStr(); const dd = new Date(+t.slice(0, 4), +t.slice(5, 7), 0).getDate(); return +t.slice(8) / dd; })(), sub: 'The line shows how far into the month we are' })) +
      rpCard('Days of stock left', Charts.hbar(P.stockouts.map((x) => ({ label: x.name, value: Math.max(0.5, Math.round(x.daysOfStock)), sub: fmt(x.available) + ' left' })).sort((a, z) => a.value - z.value), { fmt: (v) => Math.round(v) + ' days', max: 8, tone: 'bad', empty: 'Nothing is about to run out.' }), 'Shortest first — order these now') + '</div>' +
    '<div class="card pad mb"><h3>Running out soon (≤ 21 days)</h3>' + (P.stockouts.length ? P.stockouts.slice(0, 15).map((x) => '<div class="row between cl"><span>' + esc(x.name) + ' <span class="tiny faint">' + fmt(x.available) + ' left</span></span><b style="color:' + (x.daysOfStock <= 7 ? 'var(--bad)' : 'var(--warn)') + '">' + Math.max(0, Math.round(x.daysOfStock)) + ' days</b></div>').join('') : '<div class="muted small mt">Nothing is about to run out.</div>') + '</div>' +
    '<div class="card mb"><div class="pad"><h3>' + (isStore() ? 'What to buy next' : 'What to buy for the next container') + '</h3><div class="tiny muted">Items that sell fast and make good profit, sized for ~90 days of sales minus what you have and what is coming.</div></div><div class="tw"><table class="t"><thead><tr><th>Item</th><th class="r">Per day</th><th class="r">Have</th><th class="r">Buy</th>' + (c ? '<th class="r">Exp. profit</th>' : '') + '</tr></thead><tbody>' +
    (P.reorder.length ? P.reorder.slice(0, 30).map((x) => '<tr><td>' + esc(x.name) + '<div class="tiny faint">' + esc(x.category) + '</div></td><td class="r">' + (Math.round(x.velocity * 10) / 10) + '</td><td class="r">' + fmt(x.available) + (x.incoming ? '+' + x.incoming : '') + '</td><td class="r b">' + fmt(x.suggest) + '</td>' + (c ? '<td class="r money">' + fmt(x.expectedProfit) + '</td>' : '') + '</tr>').join('') : '<tr><td colspan="5" class="muted">Not enough sales history yet.</td></tr>') + '</tbody></table></div></div>' +
    (c && P.containers.length ? '<div class="card pad mb"><h3 class="mb">When will each container pay for itself?</h3>' + P.containers.map((x) => '<div class="cl"><div class="row between"><b>' + esc(x.name) + '</b><span class="small">' + pct(x.recoveredPct) + ' recovered</span></div><div class="bar mt" style="margin-top:6px"><i style="width:' + Math.min(100, x.recoveredPct) + '%;background:' + (x.recoveredPct >= 100 ? 'var(--ok)' : 'var(--accent)') + '"></i></div><div class="tiny muted mt" style="margin-top:4px">' + (x.need <= 0 ? '✓ Cost recovered — profit so far ' + F(x.profit) : x.breakEvenDays ? F(x.need) + ' to go · about ' + x.breakEvenDays + ' days at current speed (' + fmtDate(KC.addDays(today, x.breakEvenDays)) + ')' : F(x.need) + ' to go · no sales in the last 30 days') + '</div></div>').join('') + '</div>' : '');
}

/* ---------- classic reports (daily close, P&L, containers, expiry, losses) ---------- */
CH.repDate = (el) => { K.ui.repDate = el.value; render(true); };
CH.repMonth = (el) => { K.ui.repMonth = el.value; render(true); };
function itemsSold(pred) {
  const m = {}; repSales().forEach((s) => { if (!pred(saleDate(s))) return; const x = K.C.saleX[s.id]; if (x.status === 'cancelled') return; (s.lines || []).forEach((l) => { const rq = (l.returns || []).reduce((a, r) => a + num(r.qty), 0); const o = (m[l.productId] = m[l.productId] || { name: l.name, qty: 0, rev: 0, cogs: 0 }); o.qty += num(l.qty) - rq; o.rev += (num(l.qty) - rq) * num(l.unitPrice) * x.factor; (l.alloc || []).forEach((a) => (o.cogs += num(a.qty) * ((K.C.lotX[a.lotId] || {}).landedUnit || 0))); (l.returns || []).forEach((r) => r.restock && (r.alloc || []).forEach((a) => (o.cogs -= num(a.qty) * ((K.C.lotX[a.lotId] || {}).landedUnit || 0)))); }); });
  return Object.values(m).sort((a, b) => b.rev - a.rev);
}
function repDaily() {
  const d = K.ui.repDate || todayStr(); const st = periodStats((x) => x === d); const items = itemsSold((x) => x === d);
  const sales = repSales().filter((s) => saleDate(s) === d).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const exp = K.raw.expenses.filter((e) => e.date === d).reduce((a, e) => a + num(e.amount), 0);
  const text = '*Daily report — ' + fmtDate(d) + (K.ui.repLoc ? ' · ' + locName(K.ui.repLoc) : '') + '*\nSales: ' + F(st.revenue) + ' (' + st.n + ' receipts, ' + st.items + ' items)\nCollected: ' + F(st.collected) + '\n' + Object.entries(st.byMethod).map(([k, v]) => '  ' + k + ': ' + F(v)).join('\n') + (seeCost() ? '\nGross profit: ' + F(st.profit) : '') + (exp ? '\nExpenses: ' + F(exp) + '\n*Left after expenses: ' + F(st.collected - exp) + '*' : '') + '\nOutstanding today: ' + F(st.owed) + '\n\nTop items:\n' + items.slice(0, 10).map((i) => '  ' + i.name + ' × ' + i.qty + ' = ' + F(i.rev)).join('\n');
  K._repText = text; K._repRows = { Summary: [{ Date: d, Receipts: st.n, Items: st.items, ['Sales (' + baseSym() + ')']: Math.round(st.revenue), ['Collected (' + baseSym() + ')']: Math.round(st.collected), ...Object.fromEntries(Object.entries(st.byMethod).map(([k, v]) => [k + ' (' + baseSym() + ')', v])), ...(seeCost() ? { ['Gross profit (' + baseSym() + ')']: Math.round(st.profit) } : {}), ['Expenses (' + baseSym() + ')']: exp, ['Left after expenses (' + baseSym() + ')']: Math.round(st.collected - exp) }], Items: items.map((i) => ({ Item: i.name, Qty: i.qty, ['Revenue (' + baseSym() + ')']: Math.round(i.rev), ...(seeCost() ? { ['Cost (' + baseSym() + ')']: Math.round(i.cogs), ['Profit (' + baseSym() + ')']: Math.round(i.rev - i.cogs) } : {}) })), Sales: sales.map(saleRow) };
  return '<div class="row wrap mb"><input type="date" class="inp" style="width:auto" value="' + d + '" data-c="repDate">' + (allLocs().length > 1 ? '<select class="inp" style="width:auto" data-c="repLoc"><option value="">All branches</option>' + allLocs().map((l) => '<option value="' + l.id + '"' + (K.ui.repLoc === l.id ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select>' : '') + '<button class="btn" data-a="repCopy">' + ic('copy') + 'Copy for WhatsApp</button><button class="btn" data-a="repXlsx" data-n="Daily-' + d + '">' + ic('dl') + 'Excel</button></div>' +
    '<div class="kpis mb">' + kpi('Sales', F(st.revenue), st.n + ' receipts · ' + st.items + ' items', true) + kpi('Collected', F(st.collected)) + (seeCost() ? kpi('Gross profit', F(st.profit), st.revenue ? pct(st.profit / st.revenue * 100) : '') : '') + kpi('Expenses', F(exp)) + kpi('Left after expenses', F(st.collected - exp), 'collected − expenses') + '</div>' +
    (() => { const hrs = Array.from({ length: 24 }, (_, i) => (6 + i) % 24).map((h) => ({ h, v: 0, n: 0 })); sales.forEach((s) => { const w = s.createdAt && venueHW(s.createdAt); if (!w) return; const o = hrs.find((x) => x.h === w.h); o.v += K.C.saleX[s.id].net; o.n++; });
      const used = hrs.filter((x) => x.v > 0); const lo = used.length ? hrs.indexOf(used[0]) : 0, hi = used.length ? hrs.indexOf(used[used.length - 1]) : -1;
      return sales.length ? '<div class="rp-grid mb">' + rpCard('Sales by hour', Charts.columns(hrs.slice(Math.max(0, lo - 1), hi + 2).map((x) => ({ label: x.h + 'h', value: x.v, tip: x.n + ' receipt' + (x.n === 1 ? '' : 's') })), { fmt: F, maxLabels: 8 })) +
        rpCard('Best sellers today', Charts.hbar(items.map((i) => ({ label: i.name, value: i.rev, sub: fmt(i.qty) + ' sold' })), { fmt: F, max: 6 })) + '</div>' : ''; })() +
    '<div class="card pad mb"><h3 class="mb">Cash & mobile money to reconcile</h3>' + (Object.keys(st.byMethod).length ? Object.entries(st.byMethod).map(([k, v]) => '<div class="row between cl"><span>' + esc(k) + '</span><b class="money">' + F(v) + '</b></div>').join('') : '<div class="muted small">No payments this day.</div>') + '</div>' +
    '<div class="card tw mb"><table class="t"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Revenue</th>' + (seeCost() ? '<th class="r">Profit</th>' : '') + '</tr></thead><tbody>' + items.map((i) => '<tr><td>' + esc(i.name) + '</td><td class="r">' + i.qty + '</td><td class="r money">' + fmt(i.rev) + '</td>' + (seeCost() ? '<td class="r money">' + fmt(i.rev - i.cogs) + '</td>' : '') + '</tr>').join('') + '</tbody></table>' + (items.length ? '' : '<div class="empty small">No sales on this day.</div>') + '</div>';
}
function saleRow(s) { const x = K.C.saleX[s.id]; return { Receipt: s.no, 'Transaction ID': KC.saleTxnId(s), Date: saleDate(s), Customer: s.customerName, Phone: s.customerPhone, Items: (s.lines || []).map((l) => l.name + ' x' + l.qty + (itemNote(l) ? ' (' + itemNote(l) + ')' : '')).join('; '), 'Payment mode': Array.from(new Set((s.payments || []).filter((p) => num(p.amount) > 0).map((p) => p.method))).join(', '), 'Payment txn IDs': (s.payments || []).filter((p) => num(p.amount) > 0 && p.ref).map((p) => p.ref).join(', '), ['Total (' + baseSym() + ')']: Math.round(x.net), ['Paid (' + baseSym() + ')']: Math.round(x.paid), ['MoMo charges (' + baseSym() + ')']: Math.round(x.fees || 0), ['Balance (' + baseSym() + ')']: Math.round(x.balance), Status: x.status, 'Collected': KC.isDelivery(s) ? '' : s.delivered ? 'Yes' : 'No — at shop', 'Delivery': KC.isDelivery(s) ? KC.deliveryModeLabel(s.delivery.mode) : 'Pickup', 'Agency': KC.isDelivery(s) ? s.delivery.agency || '' : '', 'Town / area': KC.isDelivery(s) ? s.delivery.destination || '' : '', 'Recipient': KC.isDelivery(s) ? s.delivery.recipientName || '' : '', 'Recipient phone': KC.isDelivery(s) ? s.delivery.recipientPhone || '' : '', ['Delivery fee (' + baseSym() + ')']: KC.isDelivery(s) ? num(s.delivery.fee) : '', 'Delivery paid by': KC.isDelivery(s) ? (KC.DELIVERY_PAYERS.find((y) => y[0] === s.delivery.payer) || [0, ''])[1] : '', 'Delivery status': KC.isDelivery(s) ? (KC.DELIVERY_STATUSES.find((y) => y[0] === s.delivery.status) || [0, ''])[1] : '', 'Agency receipt no': KC.isDelivery(s) ? s.delivery.trackingNo || '' : '', ...(seeCost() ? { ['Profit (' + baseSym() + ')']: Math.round(x.profit) } : {}) }; }
A.repCopy = () => copyText(K._repText || '');
A.repXlsx = (el) => !can('export') ? toast('You do not have permission to download', true) : xlsxDownload(el.dataset.n + '.xlsx', K._repRows || {});
function repMonthly() {
  const m = K.ui.repMonth || monthStr(); const st = periodStats((x) => (x || '').slice(0, 7) === m);
  const exps = K.raw.expenses.filter((e) => (e.date || '').slice(0, 7) === m && (!K.ui.repLoc || (e.locationId || 'main') === K.ui.repLoc)); const expT = exps.reduce((a, e) => a + num(e.amount), 0);
  const losses = K.raw.adjustments.filter((a) => (a.date || '').slice(0, 7) === m && num(a.qty) < 0).reduce((a, j) => a + -num(j.qty) * ((K.C.lotX[j.lotId] || {}).landedUnit || 0), 0);
  const [y, mm] = m.split('-').map(Number); const days = new Date(y, mm, 0).getDate(); const daily = [];
  for (let i = 1; i <= days; i++) { const d = m + '-' + pad2(i); const s = periodStats((x) => x === d); if (s.n || s.collected) daily.push({ d, ...s }); }
  const items = itemsSold((x) => (x || '').slice(0, 7) === m); const byCat = {}; items.forEach((i) => { const p = K.raw.products.find((p) => p.name === i.name) || {}; const c = p.category || 'Other'; byCat[c] = (byCat[c] || 0) + i.rev; });
  const expByCat = {}; exps.forEach((e) => (expByCat[e.category] = (expByCat[e.category] || 0) + num(e.amount)));
  const aScope = K.raw.assets.filter((a) => !K.ui.repLoc || (a.locationId || 'main') === K.ui.repLoc);
  const at = KC.assetTotals(aScope, S(), m + '-01', m + '-' + pad2(days));
  // MoMo / OM charges WE paid when paying suppliers (sale-side charges are paid by the customer, so not a cost)
  const supFees = K.ui.repLoc ? 0 : K.raw.bills.reduce((a, b) => a + (b.payments || []).filter((p) => (p.date || '').slice(0, 7) === m).reduce((t, p) => t + Math.max(0, num(p.fee)) * (num(b.fxRate) || KC.rateOf(S(), b.currency)), 0), 0);
  // interest paid on the business's loans (Capital & loans) is an expense; the principal repaid is not
  const loanInt = K.ui.repLoc ? 0 : KC.capitalInterest(K.raw, m + '-01', m + '-' + pad2(days));
  const net = st.profit - expT - losses - at.depreciation + at.gain - supFees - loanInt;
  K._repRows = { Summary: [{ Month: m, ['Sales (' + baseSym() + ')']: Math.round(st.revenue), ['Cost of goods (' + baseSym() + ')']: Math.round(st.cogs), ['Gross profit (' + baseSym() + ')']: Math.round(st.profit), ['Expenses (' + baseSym() + ')']: expT, ['Stock losses (' + baseSym() + ')']: Math.round(losses), ['Depreciation of assets (' + baseSym() + ')']: Math.round(at.depreciation), ['Gain / loss on assets sold (' + baseSym() + ')']: Math.round(at.gain), ['MoMo charges on supplier payments (' + baseSym() + ')']: Math.round(supFees), ['Interest on loans (' + baseSym() + ')']: Math.round(loanInt), ['Net profit (' + baseSym() + ')']: Math.round(net), ['Collected (' + baseSym() + ')']: Math.round(st.collected) }], Daily: daily.map((r) => ({ Date: r.d, Receipts: r.n, ['Sales (' + baseSym() + ')']: Math.round(r.revenue), ['Collected (' + baseSym() + ')']: Math.round(r.collected), ['Profit (' + baseSym() + ')']: Math.round(r.profit) })), Items: items.map((i) => ({ Item: i.name, Qty: i.qty, ['Revenue (' + baseSym() + ')']: Math.round(i.rev), ['Cost (' + baseSym() + ')']: Math.round(i.cogs), ['Profit (' + baseSym() + ')']: Math.round(i.rev - i.cogs) })), Expenses: exps.map((e) => ({ Date: e.date, Category: e.category, Description: e.description, ['Amount (' + baseSym() + ')']: e.amount, Method: e.method })) };
  const maxD = Math.max(1, ...daily.map((r) => r.revenue));
  return '<div class="row wrap mb"><input type="month" class="inp" style="width:auto" value="' + m + '" data-c="repMonth">' + (allLocs().length > 1 ? '<select class="inp" style="width:auto" data-c="repLoc"><option value="">All branches</option>' + allLocs().map((l) => '<option value="' + l.id + '"' + (K.ui.repLoc === l.id ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select>' : '') + '<button class="btn" data-a="repXlsx" data-n="Monthly-' + m + '">' + ic('dl') + 'Excel</button></div>' +
    '<div class="kpis mb">' + kpi('Sales', F(st.revenue), st.n + ' receipts', true) + kpi('Gross profit', F(st.profit), st.revenue ? pct(st.profit / st.revenue * 100) + ' margin' : '') + kpi('Expenses, losses & depreciation', F(expT + losses + at.depreciation + supFees + loanInt)) + kpi('Net profit', F(net)) + '</div>' +
    '<div class="card pad mb"><h3 class="mb">Profit & loss</h3>' + [['Sales', st.revenue], ['− Cost of goods sold' + (isStore() ? '' : ' (landed)'), -st.cogs], ['= Gross profit', st.profit, 1], ...Object.entries(expByCat).map(([k, v]) => ['− ' + k, -v]), ['− Stock losses (theft, damage, expiry)', -losses], ...(supFees ? [['− MoMo / OM charges on supplier payments', -supFees]] : []), ...(loanInt ? [['− Interest on loans', -loanInt]] : []), ...(at.depreciation ? [['− Depreciation of assets (equipment, vehicles…)', -at.depreciation]] : []), ...(at.disposed ? [[(at.gain >= 0 ? '+ Gain' : '− Loss') + ' on assets sold / written off', at.gain]] : []), ['= Net profit', net, 1]].map(([l, v, b]) => '<div class="row between cl' + (b ? ' b' : '') + '"><span>' + esc(l) + '</span><span class="money">' + F(v) + '</span></div>').join('') + '</div>' +
    (() => { const all = []; for (let i = 1; i <= days; i++) { const d = m + '-' + pad2(i); const x = daily.find((q) => q.d === d); all.push({ label: String(i), a: x ? x.revenue : 0, b: x ? x.profit : 0 }); }
      const went = [{ label: 'Cost of goods sold', value: st.cogs }].concat(Object.entries(expByCat).map(([k, v]) => ({ label: k || 'Other expenses', value: v })), [{ label: 'Stock losses', value: losses }, { label: 'Depreciation', value: at.depreciation }, { label: 'MoMo / OM charges', value: supFees }, { label: 'Interest on loans', value: loanInt }]).filter((x) => x.value > 0).sort((a, z) => z.value - a.value);
      return rpCard('Sales and profit, day by day', Charts.combo(all, { fmt: F, aLabel: 'Sales', bLabel: 'Gross profit', maxLabels: 10, empty: 'No sales this month.' }), '', 'mb') +
        '<div class="rp-grid mb">' + rpCard('Where the money went', Charts.hbar(went, { fmt: F, max: 10, empty: 'No costs this month.' }), 'Everything that came out of the sales this month') +
        rpCard('Expenses by category', Charts.donut(Object.entries(expByCat).map(([k, v]) => ({ label: k || 'Other', value: v })), { fmt: F, centre: 'spent', empty: 'No expenses this month.' })) +
        rpCard('Sales by category', Charts.hbar(Object.entries(byCat).map(([k, v]) => ({ label: k, value: v })).sort((a, z) => z.value - a.value), { fmt: F, max: 10, empty: 'No sales this month.' }), '', 'wide') + '</div>'; })();
}
function repProducts() {
  const rows = K.raw.products.map((p) => ({ p, x: K.C.prodX[p.id] })).filter((r) => r.x.sold > 0 || r.x.available > 0).sort((a, b) => b.x.profit - a.x.profit);
  K._repRows = { 'Item profit': rows.map(({ p, x }) => ({ Item: p.name, Category: p.category, Sold: x.sold, ['Revenue (' + baseSym() + ')']: Math.round(x.revenue), ['Cost (' + baseSym() + ')']: Math.round(x.cogs), ['Profit (' + baseSym() + ')']: Math.round(x.profit), 'Margin %': x.revenue ? Math.round(x.profit / x.revenue * 100) : '', 'In stock': x.available, ['Avg cost (' + baseSym() + ')']: Math.round(x.avgCost), ['Price (' + baseSym() + ')']: x.priceMax })) };
  return '<div class="row mb"><button class="btn" data-a="repXlsx" data-n="Item-profit-' + todayStr() + '">' + ic('dl') + 'Excel</button></div><div class="card tw"><table class="t"><thead><tr><th>Item</th><th class="r">Sold</th><th class="r">Revenue</th><th class="r">Profit</th><th class="r">Margin</th><th class="r">Stock</th></tr></thead><tbody>' +
    rows.map(({ p, x }) => '<tr><td>' + esc(p.name) + '</td><td class="r">' + fmt(x.sold) + '</td><td class="r money">' + fmt(x.revenue) + '</td><td class="r money b" style="color:' + (x.profit < 0 ? 'var(--bad)' : 'var(--ok)') + '">' + fmt(x.profit) + '</td><td class="r">' + (x.revenue ? pct(x.profit / x.revenue * 100) : '—') + '</td><td class="r">' + fmt(x.available) + '</td></tr>').join('') + '</tbody></table>' + (rows.length ? '' : '<div class="empty small">No data yet.</div>') + '</div>';
}
function repContainers() {
  const rows = K.raw.shipments.map((s) => ({ s, x: K.C.shipX[s.id] }));
  K._repRows = { Containers: rows.map(({ s, x }) => ({ Container: s.name, 'Container no': s.containerNo, Status: s.status, Units: x.units, 'Units sold': x.unitsSold, ['Goods (' + baseSym() + ')']: Math.round(x.goodsX), ['US costs (' + baseSym() + ')']: Math.round(x.usX), ['Cameroon costs (' + baseSym() + ')']: Math.round(x.cmX), ['Landed total (' + baseSym() + ')']: Math.round(x.landedX), ['Revenue (' + baseSym() + ')']: Math.round(x.revenue), ['Gross profit (' + baseSym() + ')']: Math.round(x.revenue - x.cogs), ['Losses (' + baseSym() + ')']: Math.round(x.lossX), ['Stock left at cost (' + baseSym() + ')']: Math.round(x.stockX) })) };
  const cont = rows.length ? '<div class="rp-grid mb">' + rpCard('Gross profit by container', Charts.hbar(rows.map(({ s, x }) => ({ label: s.name, value: x.revenue - x.cogs, sub: F(x.revenue) + ' sold' })).sort((a, z) => z.value - a.value), { fmt: F, max: 10 })) +
    rpCard('Cost recovered', rows.slice(0, 8).map(({ s, x }) => Charts.gauge(x.revenue, x.landedX, { fmt: F, label: s.name, tone: x.revenue >= x.landedX ? 'ok' : '' })).join(''), 'Sales so far against what the container cost to land') + '</div>' : '';
  return '<div class="row mb"><button class="btn" data-a="repXlsx" data-n="Containers-' + todayStr() + '">' + ic('dl') + 'Excel</button></div>' + cont + (rows.length ? rows.map(({ s, x }) => '<div class="card pad mb" data-a="openShipD" data-id="' + s.id + '" style="cursor:pointer"><div class="row between mb"><b>' + esc(s.name) + '</b><span class="badge brand">' + esc((KC.SHIP_STATUSES.find((q) => q[0] === s.status) || [0, ''])[1]) + '</span></div><div class="grid4 small">' +
    [['Landed cost', F(x.landedX)], ['Revenue', F(x.revenue)], ['Gross profit', F(x.revenue - x.cogs)], ['Sold', (x.units ? pct(x.unitsSold / x.units * 100) : '—') + ' of ' + fmt(x.units)], ['Goods', F(x.goodsX)], ['Shipping & customs', F(x.costsX)], ['Losses', F(x.lossX)], ['Stock left', F(x.stockX)]].map(([l, v]) => '<div><div class="faint tiny">' + l + '</div><b class="money">' + v + '</b></div>').join('') + '</div></div>').join('') : '<div class="card empty">No containers yet.</div>');
}
function repExpiry() {
  const lots = K.raw.lots.filter((l) => { const x = K.C.lotX[l.id]; return l.expiry && x.stage === 'warehouse' && x.available > 0; }).sort((a, b) => a.expiry.localeCompare(b.expiry));
  K._repRows = { Expiry: lots.map((l) => ({ Item: (byId('products', l.productId) || {}).name, Expiry: l.expiry, 'Days left': daysUntil(l.expiry), 'Qty left': K.C.lotX[l.id].available, ['Value at cost (' + baseSym() + ')']: Math.round(K.C.lotX[l.id].available * K.C.lotX[l.id].landedUnit), Container: shipName(l.shipmentId) })) };
  const eb = [[-1e9, -1, 'Expired'], [0, 30, '≤ 30 days'], [31, 90, '31–90 days'], [91, 1e9, '90+ days']].map(([a, z, l]) => ({ label: l, value: 0, n: 0, a, z }));
  lots.forEach((l) => { const d = daysUntil(l.expiry); const x = K.C.lotX[l.id]; const g = eb.find((q) => d >= q.a && d <= q.z); if (g) { g.value += x.available * x.landedUnit; g.n += x.available; } });
  return '<div class="row mb"><button class="btn" data-a="repXlsx" data-n="Expiry-' + todayStr() + '">' + ic('dl') + 'Excel</button></div>' +
    (lots.length ? rpCard('Stock value by expiry date', Charts.columns(eb.map((g) => ({ label: g.label, value: g.value, tip: fmt(g.n) + ' units' })), { fmt: F }), 'Sell or discount what expires first', 'mb') : '') +
    '<div class="card tw"><table class="t"><thead><tr><th>Item</th><th>Expiry</th><th class="r">Days</th><th class="r">Left</th><th class="r">Value</th></tr></thead><tbody>' +
    lots.map((l) => { const x = K.C.lotX[l.id]; const d = daysUntil(l.expiry); return '<tr><td>' + esc((byId('products', l.productId) || {}).name) + '<div class="tiny faint">' + esc(shipName(l.shipmentId)) + '</div></td><td>' + expiryBadge(l.expiry) + '</td><td class="r b" style="color:' + (d < 0 ? 'var(--bad)' : d <= 30 ? 'var(--bad)' : 'inherit') + '">' + d + '</td><td class="r">' + x.available + '</td><td class="r money">' + fmt(x.available * x.landedUnit) + '</td></tr>'; }).join('') + '</tbody></table>' + (lots.length ? '' : '<div class="empty small">No items with expiry dates in stock.</div>') + '</div>';
}
function repLosses() {
  const rows = [];
  K.raw.lots.forEach((l) => { const x = K.C.lotX[l.id]; const m = num(l.recvMissing), d = num(l.recvDamaged); if (m) rows.push({ date: (byId('shipments', l.shipmentId) || {}).receivedAt || '', item: (byId('products', l.productId) || {}).name, qty: m, reason: 'Missing on arrival', value: m * x.landedUnit }); if (d) rows.push({ date: (byId('shipments', l.shipmentId) || {}).receivedAt || '', item: (byId('products', l.productId) || {}).name, qty: d, reason: 'Damaged on arrival', value: d * x.landedUnit }); });
  K.raw.adjustments.forEach((a) => { const x = K.C.lotX[a.lotId] || {}; rows.push({ date: a.date, item: (byId('products', a.productId) || {}).name, qty: -num(a.qty), reason: a.reason + (a.notes ? ' — ' + a.notes : ''), value: -num(a.qty) * (x.landedUnit || 0) }); });
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const tot = rows.reduce((a, r) => a + r.value, 0);
  K._repRows = { Losses: rows.map((r) => ({ Date: r.date, Item: r.item, Qty: r.qty, Reason: r.reason, ['Value at cost (' + baseSym() + ')']: Math.round(r.value) })) };
  const byWhy = {}; rows.forEach((r) => { const k = String(r.reason || 'Other').split(' — ')[0]; byWhy[k] = (byWhy[k] || 0) + Math.max(0, r.value); });
  const byM = {}; rows.forEach((r) => { if (!r.date) return; const k = String(r.date).slice(0, 7); byM[k] = (byM[k] || 0) + Math.max(0, r.value); });
  const months = Object.keys(byM).sort().slice(-12);
  return '<div class="row mb"><button class="btn" data-a="repXlsx" data-n="Losses-' + todayStr() + '">' + ic('dl') + 'Excel</button></div><div class="kpis mb">' + kpi('Total losses (net)', F(tot), 'at landed cost', true) + '</div>' +
    (rows.length ? '<div class="rp-grid mb">' + rpCard('What the losses come from', Charts.hbar(Object.entries(byWhy).map(([k, v]) => ({ label: k, value: v })).sort((a, z) => z.value - a.value), { fmt: F, max: 8, tone: 'bad' })) +
      rpCard('Losses per month', Charts.columns(months.map((k) => ({ label: MONTHS[+k.slice(5) - 1], value: byM[k] })), { fmt: F })) + '</div>' : '') +
    '<div class="card tw"><table class="t"><thead><tr><th>Date</th><th>Item</th><th class="r">Qty</th><th>Reason</th><th class="r">Value</th></tr></thead><tbody>' +
    rows.map((r) => '<tr><td class="nowrap">' + fmtDate(r.date) + '</td><td>' + esc(r.item) + '</td><td class="r">' + r.qty + '</td><td>' + esc(r.reason) + '</td><td class="r money">' + fmt(r.value) + '</td></tr>').join('') + '</tbody></table>' + (rows.length ? '' : '<div class="empty small">No losses recorded. 🎉</div>') + '</div>';
}


CH.repLoc = (el) => { K.ui.repLoc = el.value; render(true); };
