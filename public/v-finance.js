/* Aahsso — Financials: one page for the money of the whole business (every module).
   Summary · Transactions (the cash ledger) · Cash Flow (periods as columns) · Profit & Loss · Capital Structure.
   Everything reads KC.cashLedger (sales, supplier bills, expenses incl. salaries, claims, equipment, capital & loans),
   so the tabs always agree; the starting capital gives the opening cash. */

const FIN_TABS = [['summary', 'Summary', 'reports'], ['transactions', 'Transactions', 'reports'], ['cashflow', 'Cash Flow', 'reports'], ['pl', 'Profit & Loss', 'reports'], ['capital', 'Capital Structure', 'capital']];
const finTabs = () => FIN_TABS.filter((t) => can(t[2]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const finLedger = () => KC.cashLedger(K.raw, S());
const sgn = (v, cls) => { const r = Math.round(v); if (!r) return '<span class="fz">–</span>'; return '<span' + (cls ? ' class="' + (r < 0 ? 'f-neg' : 'f-pos') + '"' : '') + '>' + (r < 0 ? '−' : '') + fmt(Math.abs(r)) + '</span>'; };

VIEWS.finance = {
  render() {
    const tabs = finTabs(); if (!tabs.length) return '<div class="card pad">You do not have access to the financials.</div>';
    let tab = K.ui.finTab; if (!tabs.some((t) => t[0] === tab)) tab = tabs[0][0];
    const op = byId('capital', 'opening');
    let html = '<div class="cap-head"><div><h2>Financials</h2><div class="hint">Income, expenses, cash flow and capital — for the whole business</div></div><div class="row">' +
      (can('capital') ? (op ? '' : '<button class="btn desk-only" data-a="capOpening">' + ic('wallet', 'sm') + 'Starting capital</button>') + '<button class="btn pri" data-a="capNew">' + ic('plus', 'sm') + 'Record entry</button>' : '') + '</div></div>';
    if (!op && can('capital')) html += '<div class="cap-cta"><div class="cap-cta-i">' + ic('wallet') + '</div><div class="grow"><b>Set your starting position</b><div class="tiny muted">The cash, bank and mobile money you had when you started with Aahsso — so the cash flow starts from the right balance.</div></div><button class="btn pri" data-a="capOpening">Set up</button></div>';
    html += '<div class="cap-tabs fin-tabs mb">' + tabs.map(([k, l]) => '<button class="' + (tab === k ? 'on' : '') + '" data-a="finTab" data-v="' + k + '">' + l + '</button>').join('') + '</div>';
    if (tab === 'summary') html += finSummary();
    else if (tab === 'transactions') html += finTransactions();
    else if (tab === 'cashflow') html += finCashFlow();
    else if (tab === 'pl') html += repMonthly();
    else html += (op ? '<div class="cap-start">' + ic('check', 'sm') + '<span>Starting capital set on <b>' + fmtDate(op.date) + '</b></span><button class="btn sm ghost" data-a="capOpening">Edit</button></div>' : '') + capitalPage(true);
    return html;
  },
};
VIEWS.finance.after = () => { const s = $('#cfScroll'); if (s && K._cfKey !== s.dataset.key) { K._cfKey = s.dataset.key; finScroll(); } };
A.finTab = (el) => { K.ui.finTab = el.dataset.v; render(true); setTimeout(finScroll, 30); };

/* ---------- a period: month / year / all, with ‹ › ---------- */
function finRange(mode, ref) {
  const d = ref || todayStr(); const y = +d.slice(0, 4), m = +d.slice(5, 7);
  if (mode === 'year') return { from: y + '-01-01', to: y + '-12-31', label: String(y) };
  if (mode === 'all') return { from: '0000-01-01', to: '9999-12-31', label: 'All time' };
  const last = new Date(y, m, 0).getDate(); return { from: d.slice(0, 7) + '-01', to: d.slice(0, 7) + '-' + pad2(last), label: MONTHS[m - 1] + ' ' + y };
}
const shiftRef = (ref, mode, k) => { const d = new Date(+ref.slice(0, 4), +ref.slice(5, 7) - 1, 1); if (mode === 'year') d.setFullYear(d.getFullYear() + k); else d.setMonth(d.getMonth() + k); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-01'; };
function periodBar(key, modes) {
  const mode = K.ui[key + 'Mode'] || modes[0][0]; const ref = K.ui[key + 'Ref'] || todayStr(); const r = finRange(mode, ref);
  return '<div class="fin-bar"><div class="fin-seg">' + modes.map(([k, l]) => '<button class="' + (mode === k ? 'on' : '') + '" data-a="finMode" data-k="' + key + '" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
    (mode === 'all' ? '' : '<div class="fin-step"><button class="icon-btn" data-a="finStep" data-k="' + key + '" data-d="-1" aria-label="Previous">' + ic('chev', 'sm rot180') + '</button><b>' + r.label + '</b><button class="icon-btn" data-a="finStep" data-k="' + key + '" data-d="1" aria-label="Next">' + ic('chev', 'sm') + '</button></div>') + '</div>';
}
A.finMode = (el) => { K.ui[el.dataset.k + 'Mode'] = el.dataset.v; render(true); setTimeout(finScroll, 30); };
A.finStep = (el) => { const k = el.dataset.k; const mode = K.ui[k + 'Mode'] || (k === 'cf' ? 'month' : 'month'); const stepMode = k === 'cf' ? (mode === 'day' ? 'month' : 'year') : mode; K.ui[k + 'Ref'] = shiftRef(K.ui[k + 'Ref'] || todayStr(), stepMode, num(el.dataset.d) * (k === 'cf' && mode === 'year' ? 5 : 1)); render(true); setTimeout(finScroll, 30); };

/* ================= Summary ================= */
function finSummary() {
  const mode = K.ui.sumMode || 'month'; const r = finRange(mode, K.ui.sumRef);
  const inR = (d) => d >= r.from && d <= r.to;
  const st = periodStats((d) => !!d && inR(d)); const L = finLedger(); const live = L.filter((x) => inR(x.date));
  const exps = K.raw.expenses.filter((e) => inR(e.date || '')); const expT = exps.reduce((a, e) => a + num(e.amount), 0);
  const losses = K.raw.adjustments.filter((a) => inR(a.date || '') && num(a.qty) < 0).reduce((a, j) => a + -num(j.qty) * ((K.C.lotX[j.lotId] || {}).landedUnit || 0), 0);
  const at = mode === 'all' ? { depreciation: 0, gain: 0 } : KC.assetTotals(K.raw.assets, S(), r.from, r.to);
  const interest = KC.capitalInterest(K.raw, r.from, r.to);
  const net = st.profit - expT - losses - at.depreciation + at.gain - interest; const seeC = seeCost();
  const cashIn = live.filter((x) => x.section === 'in').reduce((a, x) => a + x.amount, 0), cashOut = live.filter((x) => x.section === 'out').reduce((a, x) => a + x.amount, 0);
  const pos = KC.cashPosition(K.raw, S()); const last = L.length ? L[L.length - 1].date : '';
  const owedUs = receivables(), weOwe = typeof totalOwedSuppliers === 'function' ? totalOwedSuppliers() : 0;
  let h = periodBar('sum', [['month', 'Month'], ['year', 'Year'], ['all', 'All time']]);
  h += '<div class="fin-kpis">' +
    finCard('Total sales', F(st.revenue), st.n + ' sale' + (st.n === 1 ? '' : 's'), 'sky', 'sales') +
    finCard('Total expenses', F(expT), exps.length + ' expense' + (exps.length === 1 ? '' : 's') + (interest ? ' · + interest ' + fmt(interest) : ''), 'rose', 'wallet') +
    (seeC ? finCard(net >= 0 ? 'Net profit' : 'Net loss', F(Math.abs(net)), 'sales − cost of goods − expenses − losses', net >= 0 ? 'emerald' : 'amber', 'chart') : '') +
    finCard('Money received', F(cashIn), 'all money in from operations', 'brand', 'dl') +
    finCard('Money paid out', F(cashOut), 'stock, expenses, refunds, charges', 'violet', 'up') +
    finCard('Cash on hand', F(pos.total), pos.since ? 'since ' + fmtDate(pos.since) : 'set the starting position', pos.total >= 0 ? 'slate' : 'amber', 'wallet') + '</div>';
  // where the money is + who owes
  const accs = Object.entries(pos.accounts).filter(([, v]) => Math.round(v)).sort((a, b) => b[1] - a[1]);
  h += '<div class="fin-row mb"><div class="card pad"><div class="row between mb"><b>Where the money is</b><span class="tiny muted">now</span></div>' +
    (accs.length ? accs.map(([k, v]) => '<div class="row between cl"><span class="fin-acc"><i class="' + finAccCls(k) + '"></i>' + esc(k) + '</span><b class="money' + (v < 0 ? ' f-neg' : '') + '">' + F(v) + '</b></div>').join('') + (accs.some(([, v]) => v < 0) ? '<div class="tiny muted mt">A negative balance means money was paid from an account without its starting balance — check the starting position.</div>' : '') : '<div class="muted small">No money recorded yet.</div>') + '</div>' +
    '<div class="card pad"><b class="mb" style="display:block">Still to collect & to pay</b><div class="row between cl"><span>Customers owe us</span><b class="money">' + F(owedUs) + '</b></div><div class="row between cl"><span>We owe suppliers</span><b class="money">' + F(weOwe) + '</b></div>' +
    (can('capital') ? '<div class="row between cl"><span>Loans still owed</span><b class="money">' + F(KC.capitalSummary(K.raw).debt) + '</b></div>' : '') + '<div class="row between cl"><span class="muted">Last activity</span><span>' + (last ? fmtDate(last) : '—') + '</span></div></div></div>';
  // charts
  const buckets = mode === 'month' ? KC.cfPeriods(r.from, r.to, 'day') : mode === 'year' ? KC.cfPeriods(r.from, r.to, 'month') : KC.cfPeriods(L.length ? L[0].date.slice(0, 7) + '-01' : todayStr(), todayStr(), 'month');
  const flow = buckets.map((b) => { const xs = L.filter((x) => x.date >= b.from && x.date <= b.to); return { label: mode === 'month' ? String(+b.key.slice(8)) : MON[+b.key.slice(5, 7) - 1] + (mode === 'all' ? ' ' + b.key.slice(2, 4) : ''), a: xs.filter((x) => x.dir > 0).reduce((s, x) => s + x.amount, 0), b: xs.filter((x) => x.dir < 0).reduce((s, x) => s + x.amount, 0) }; });
  const byCat = {}; live.filter((x) => x.dir < 0 && x.section !== 'fin').forEach((x) => { const l = KC.cfRow(x.key)[1]; byCat[l] = (byCat[l] || 0) + x.amount; });
  const bySrc = {}; live.filter((x) => x.dir > 0).forEach((x) => { const l = KC.cfRow(x.key)[1]; bySrc[l] = (bySrc[l] || 0) + x.amount; });
  h += '<div class="fin-charts">' +
    rpCard('Money in and out', Charts.combo(flow, { fmt: F, aLabel: 'Money in', bLabel: 'Money out', maxLabels: 12, empty: 'No money moved in this period.' })) +
    rpCard('Where the money went', Charts.hbar(Object.entries(byCat).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value), { fmt: F, max: 8, empty: 'Nothing paid out in this period.' })) +
    rpCard('Where the money came from', Charts.donut(Object.entries(bySrc).map(([label, value]) => ({ label, value })), { fmt: F, empty: 'No money in for this period.' })) +
    (seeC ? rpCard('Profit for the period', finMiniPL(st, expT, losses, at, interest, net)) : '') + '</div>';
  return h;
}
const finCard = (l, v, s, tone, icon) => '<div class="fin-card t-' + tone + '"><div class="fin-ci">' + ic(icon, 'sm') + '</div><div class="fin-cl">' + l + '</div><div class="fin-cv money">' + v + '</div><div class="fin-cs">' + s + '</div></div>';
const finAccCls = (k) => ({ Cash: 'a-cash', 'MTN MoMo': 'a-mtn', 'Orange Money': 'a-om', Bank: 'a-bank' })[k] || 'a-other';
function finMiniPL(st, expT, losses, at, interest, net) {
  return [['Sales', st.revenue], ['− Cost of goods sold', -st.cogs], ['= Gross profit', st.profit, 1], ['− Expenses', -expT], ['− Stock losses', -losses], ...(at.depreciation ? [['− Depreciation', -at.depreciation]] : []), ...(at.gain ? [['+ Gain on equipment sold', at.gain]] : []), ...(interest ? [['− Loan interest', -interest]] : []), ['= Net profit', net, 1]]
    .map(([l, v, b]) => '<div class="row between cl' + (b ? ' b' : '') + '"><span>' + l + '</span><span class="money' + (b && v < 0 ? ' f-neg' : '') + '">' + F(v) + '</span></div>').join('');
}

/* ================= Transactions: the cash ledger ================= */
const FIN_GROUP = { in: ['Income', 'g-in'], out: ['Expense', 'g-out'], inv: ['Investing', 'g-inv'], fin: ['Financing', 'g-fin'] };
function finTransactions() {
  const r = finRange('month', K.ui.txRef); const f = K.ui.txF || 'all'; const q = String(K.ui.txQ || '').toLowerCase(); const acc = K.ui.txAcc || '';
  let rows = finLedger().filter((x) => x.date >= r.from && x.date <= r.to);
  const op = byId('capital', 'opening');
  if (f !== 'all') rows = rows.filter((x) => f === 'in' ? x.section === 'in' : f === 'out' ? x.section === 'out' : x.section === 'inv' || x.section === 'fin');
  if (acc) rows = rows.filter((x) => x.account === acc);
  if (q) rows = rows.filter((x) => [x.label, x.who, x.ref, KC.cfRow(x.key)[1], x.method].join(' ').toLowerCase().includes(q));
  rows = rows.slice().reverse();
  const tIn = rows.reduce((a, x) => a + (x.dir > 0 ? x.amount : 0), 0), tOut = rows.reduce((a, x) => a + (x.dir < 0 ? x.amount : 0), 0);
  K._finTx = rows.map((x) => ({ Date: x.date, Group: FIN_GROUP[x.section][0], Category: KC.cfRow(x.key)[1], Description: x.label, Counterparty: x.who || '', Reference: x.ref || '', Account: x.account, 'Paid by': x.method || '', ['Cash in (' + baseSym() + ')']: x.dir > 0 ? Math.round(x.amount) : '', ['Cash out (' + baseSym() + ')']: x.dir < 0 ? Math.round(x.amount) : '' }));
  let h = '<div class="fin-bar"><div class="search grow" style="min-width:180px">' + ic('search') + '<input class="inp" placeholder="Search the ledger…" value="' + esc(K.ui.txQ || '') + '" data-i="finTxQ" aria-label="Search the ledger"></div>' +
    '<div class="fin-seg">' + [['all', 'All'], ['in', 'Income'], ['out', 'Expense'], ['fin', 'Financing']].map(([k, l]) => '<button class="' + (f === k ? 'on' : '') + '" data-a="finTxF" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
    '<select class="inp fin-sel" data-c="finTxAcc" aria-label="Account"><option value="">All accounts</option>' + ['Cash', 'MTN MoMo', 'Orange Money', 'Bank'].map((a) => '<option' + (acc === a ? ' selected' : '') + '>' + a + '</option>').join('') + '</select>' +
    '<div class="fin-step"><button class="icon-btn" data-a="finTxStep" data-d="-1" aria-label="Previous month">' + ic('chev', 'sm rot180') + '</button><b>' + r.label + '</b><button class="icon-btn" data-a="finTxStep" data-d="1" aria-label="Next month">' + ic('chev', 'sm') + '</button></div>' +
    (can('export') ? '<button class="btn pri" data-a="finTxXlsx">' + ic('dl', 'sm') + 'Export</button>' : '') + '</div>';
  if (op && r.to < op.date) h += '<div class="alert info mb">' + ic('help', 'sm') + '<div>This month is before your starting position (' + fmtDate(op.date) + '): it is not counted in the cash balance.</div></div>';
  h += '<div class="card fin-tx"><div class="fin-scroll"><table class="t fin-ltab"><thead><tr><th>Date</th><th>Group</th><th>Description</th><th>Counterparty</th><th>Account</th><th class="r">Cash in</th><th class="r">Cash out</th></tr></thead><tbody>' +
    (rows.length ? rows.map((x) => '<tr><td class="nw">' + fmtDate(x.date) + '</td><td><span class="fin-g ' + FIN_GROUP[x.section][1] + '">' + FIN_GROUP[x.section][0] + '</span></td><td><div class="fin-d">' + esc(x.label) + '</div><div class="tiny muted">' + esc(KC.cfRow(x.key)[1]) + (x.ref ? ' · ' + esc(x.ref) : '') + '</div></td><td>' + esc(x.who || '—') + '</td><td class="nw"><span class="fin-acc"><i class="' + finAccCls(x.account) + '"></i>' + esc(x.account) + '</span></td><td class="r money f-pos">' + (x.dir > 0 ? fmt(Math.round(x.amount)) : '<span class="fz">–</span>') + '</td><td class="r money f-neg">' + (x.dir < 0 ? fmt(Math.round(x.amount)) : '<span class="fz">–</span>') + '</td></tr>').join('')
      : '<tr><td colspan="7"><div class="empty">No transactions for this period.</div></td></tr>') +
    '</tbody>' + (rows.length ? '<tfoot><tr><td colspan="5"><b>Total</b> · ' + rows.length + ' transaction' + (rows.length === 1 ? '' : 's') + ' · net <b class="' + (tIn - tOut < 0 ? 'f-neg' : 'f-pos') + '">' + (tIn - tOut < 0 ? '−' : '') + fmt(Math.abs(Math.round(tIn - tOut))) + '</b></td><td class="r money f-pos">' + fmt(Math.round(tIn)) + '</td><td class="r money f-neg">' + fmt(Math.round(tOut)) + '</td></tr></tfoot>' : '') + '</table></div></div>' +
    '<div class="tiny muted mt">Built from your sales, supplier payments, expenses (salaries included), equipment and capital. To change a line, change the sale, bill or expense it comes from.</div>';
  return h;
}
I.finTxQ = (el) => { K.ui.txQ = el.value; clearTimeout(I._ftq); I._ftq = setTimeout(() => { const pos = el.selectionStart; render(true); const n = $('[data-i=finTxQ]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* */ } } }, 250); };
A.finTxF = (el) => { K.ui.txF = el.dataset.v; render(true); };
CH.finTxAcc = (el) => { K.ui.txAcc = el.value; render(true); };
A.finTxStep = (el) => { K.ui.txRef = shiftRef(K.ui.txRef || todayStr(), 'month', num(el.dataset.d)); render(true); };
A.finTxXlsx = () => xlsxDownload('Transactions-' + (K.ui.txRef || todayStr()).slice(0, 7) + '.xlsx', { Transactions: K._finTx || [] });

/* ================= Cash Flow: periods as columns ================= */
const CF_MODES = [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['quarter', 'Quarterly'], ['year', 'Yearly'], ['custom', 'Custom']];
const CF_CLASS = { sales: 'Operating income', tips: 'Operating income', claims: 'Operating income', stock: 'Cost of goods', fees: 'Operating expense', refunds: 'Operating expense', interest: 'Finance cost', assetBuy: 'Capital expense', assetSell: 'Capital income', injection: 'Equity financing', drawing: 'Equity financing', loan: 'Debt financing', principal: 'Debt financing' };
function cfSetup() {
  const mode = K.ui.cfMode || 'month'; const ref = K.ui.cfRef || todayStr(); const y = +ref.slice(0, 4);
  if (mode === 'day') { const r = finRange('month', ref); return { mode, by: 'day', from: r.from, to: r.to, label: r.label, col: (p) => String(+p.key.slice(8)) }; }
  if (mode === 'week') return { mode, by: 'week', from: y + '-01-01', to: y + '-12-31', label: String(y), col: (p, i) => 'W' + (i + 1) };
  if (mode === 'quarter') return { mode, by: 'quarter', from: y + '-01-01', to: y + '-12-31', label: String(y), col: (p) => p.key.slice(5) };
  if (mode === 'year') return { mode, by: 'year', from: (y - 4) + '-01-01', to: y + '-12-31', label: (y - 4) + ' – ' + y, col: (p) => p.key };
  if (mode === 'custom') { const from = K.ui.cfFrom || y + '-01-01', to = K.ui.cfTo || todayStr(); return { mode, by: 'all', from, to, label: '', col: () => fmtDate(from) + ' – ' + fmtDate(to) }; }
  return { mode, by: 'month', from: y + '-01-01', to: y + '-12-31', label: String(y), col: (p) => MON[+p.key.slice(5, 7) - 1] };
}
function finCashFlow() {
  const cf0 = cfSetup(); const acc = K.ui.cfAcc || '';
  const cf = KC.cashFlow(K.raw, S(), { from: cf0.from, to: cf0.to, by: cf0.by, account: acc }); const P = cf.periods;
  const cur = todayStr(); const nowIdx = P.findIndex((p) => cur >= p.from && cur <= p.to);
  const cell = (v, color) => '<td class="r">' + sgn(v, color) + '</td>';
  const row = (label, cls, vals, total, opt) => '<tr class="' + (opt && opt.cls || '') + '"><th class="c1">' + label + '</th><td class="c2">' + (cls || '') + '</td>' + vals.map((v) => opt && opt.fmt ? '<td class="r">' + opt.fmt(v) + '</td>' : cell(v, opt && opt.color)).join('') + '<td class="r ct">' + (opt && opt.fmt ? opt.fmt(total) : sgn(total, opt && opt.color)) + '</td></tr>';
  const head = (t) => '<tr class="cf-sec"><td colspan="' + (P.length + 3) + '"><span>' + t + '</span></td></tr>';
  const sec = (k) => cf.sections.find((s) => s.key === k);
  const secRows = (k, empty) => { const s = sec(k); return s.rows.length ? s.rows.map((r) => row(esc(r.label), CF_CLASS[r.key] || (r.key.startsWith('exp:') ? 'Operating expense' : ''), r.cells, r.total)).join('') : '<tr class="cf-none"><th class="c1">' + empty + '</th><td class="c2"></td>' + P.map(() => '<td class="r"><span class="fz">–</span></td>').join('') + '<td class="r ct"><span class="fz">–</span></td></tr>'; };
  const colSec = (k) => P.map((p) => p.sec[k]);
  const opv = P.map((p) => p.operating), netv = P.map((p) => p.net), inv = colSec('in');
  const margin = (o, i) => i ? Math.round(o / i * 1000) / 10 : 0;
  const pctF = (v) => { const r = Math.round(v * 10) / 10; return r ? '<span class="' + (r < 0 ? 'f-neg' : 'f-pos') + '">' + r + '%</span>' : '<span class="fz">–</span>'; };
  const stF = (v) => '<span class="cf-st ' + (v < 0 ? 'f-neg' : 'f-pos') + '">' + (v < 0 ? 'Negative' : 'Positive') + '</span>';
  K._cfRows = cfExportRows(cf, cf0);
  let h = '<div class="fin-bar"><div class="fin-seg">' + CF_MODES.map(([k, l]) => '<button class="' + (cf0.mode === k ? 'on' : '') + '" data-a="finMode" data-k="cf" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
    (cf0.mode === 'custom' ? '<div class="fin-step"><input class="inp" type="date" value="' + cf0.from + '" data-c="cfFrom" aria-label="From"><span class="muted">to</span><input class="inp" type="date" value="' + cf0.to + '" data-c="cfTo" aria-label="To"></div>'
      : '<div class="fin-step"><button class="icon-btn" data-a="finStep" data-k="cf" data-d="-1" aria-label="Previous">' + ic('chev', 'sm rot180') + '</button><b>' + cf0.label + '</b><button class="icon-btn" data-a="finStep" data-k="cf" data-d="1" aria-label="Next">' + ic('chev', 'sm') + '</button></div>') +
    '<select class="inp fin-sel" data-c="cfAcc" aria-label="Account"><option value="">All accounts</option>' + ['Cash', 'MTN MoMo', 'Orange Money', 'Bank'].map((a) => '<option' + (acc === a ? ' selected' : '') + '>' + a + '</option>').join('') + '</select>' +
    '<span class="grow"></span>' + (can('export') ? '<button class="btn pri" data-a="cfXlsx">' + ic('dl', 'sm') + 'Export statement</button>' : '') + '</div>';
  h += '<div class="card cf-wrap"><div class="cf-scroll" id="cfScroll" data-now="' + nowIdx + '" data-key="' + esc(cf0.mode + cf0.from + cf0.to + acc) + '"><table class="cf"><thead><tr><th class="c1">Category</th><th class="c2">Classification</th>' + P.map((p, i) => '<th class="r' + (i === nowIdx ? ' now' : '') + '">' + esc(cf0.col(p, i)) + '</th>').join('') + '<th class="r ct">Total</th></tr></thead><tbody>' +
    head('Income') + secRows('in', 'No money in') + row('Income total', 'Operating income', inv, sec('in').total, { cls: 'cf-tot' }) +
    head('Expenses') + secRows('out', 'No money out') + row('Expenses total', 'OPEX', colSec('out'), sec('out').total, { cls: 'cf-tot' }) +
    row('Operating cash flow', 'Operating cash', opv, cf.totals.operating, { cls: 'cf-tot', color: true }) +
    head('Investing') + secRows('inv', 'No equipment bought or sold') + row('Investing total', 'CAPEX', colSec('inv'), sec('inv').total, { cls: 'cf-tot' }) +
    head('Financing') + secRows('fin', 'No capital or loan movement') + row('Financing total', 'Equity & debt', colSec('fin'), sec('fin').total, { cls: 'cf-tot' }) +
    head('Summary') +
    row('Opening cash balance', 'Cash position', P.map((p) => p.opening), cf.opening, { cls: 'cf-tot' }) +
    row('Net cash movement', 'Net cash', netv, cf.totals.net, { cls: 'cf-tot', color: true }) +
    row('Closing cash balance', 'Cash position', P.map((p) => p.closing), cf.closing, { cls: 'cf-tot cf-close', color: true }) +
    row('Operating margin', 'Profitability KPI', P.map((p) => margin(p.operating, p.sec.in)), margin(cf.totals.operating, cf.totals.in), { cls: 'cf-kpi', fmt: pctF }) +
    row('Cash position status', 'Status', P.map((p) => p.closing), cf.closing, { cls: 'cf-kpi', fmt: stF }) +
    '</tbody></table></div></div>' +
    '<div class="tiny muted mt">' + (cf.startDate ? 'Opening balance = your starting position on ' + fmtDate(cf.startDate) + ' plus every movement since. ' : 'Set your starting position so the opening balance includes the money you already had. ') + 'Tips are collected for staff. Interest is a cost; loan principal is financing.</div>';
  return h;
}
function cfExportRows(cf, cf0) {
  const P = cf.periods; const out = []; const line = (Category, Classification, vals, Total) => { const o = { Category, Classification }; P.forEach((p, i) => (o[cf0.col(p, i)] = Math.round(vals[i]))); o.Total = Math.round(Total); out.push(o); };
  const sec = (k, t, totLabel) => { out.push({ Category: t.toUpperCase() }); const s = cf.sections.find((x) => x.key === k); s.rows.forEach((r) => line(r.label, CF_CLASS[r.key] || 'Operating expense', r.cells, r.total)); line(totLabel, '', P.map((p) => p.sec[k]), s.total); };
  sec('in', 'Income', 'Income total'); sec('out', 'Expenses', 'Expenses total'); line('Operating cash flow', 'Operating cash', P.map((p) => p.operating), cf.totals.operating);
  sec('inv', 'Investing', 'Investing total'); sec('fin', 'Financing', 'Financing total');
  out.push({ Category: 'SUMMARY' }); line('Opening cash balance', 'Cash position', P.map((p) => p.opening), cf.opening); line('Net cash movement', 'Net cash', P.map((p) => p.net), cf.totals.net); line('Closing cash balance', 'Cash position', P.map((p) => p.closing), cf.closing);
  return out;
}
CH.cfFrom = (el) => { K.ui.cfFrom = el.value; render(true); };
CH.cfTo = (el) => { K.ui.cfTo = el.value; render(true); };
CH.cfAcc = (el) => { K.ui.cfAcc = el.value; render(true); setTimeout(finScroll, 30); };
A.cfXlsx = () => { const c = cfSetup(); xlsxDownload('Cash-flow-' + (c.mode === 'custom' ? c.from + '_' + c.to : c.label.replace(/\s/g, '')) + '.xlsx', { 'Cash flow': K._cfRows || [] }); };
/** scroll the cash flow table to the current period */
function finScroll() { const s = $('#cfScroll'); if (!s) return; const i = +s.dataset.now; const th = s.querySelectorAll('thead th')[i + 2]; if (i >= 0 && th) s.scrollLeft = Math.max(0, th.offsetLeft - s.clientWidth / 2); else s.scrollLeft = s.scrollWidth; }
