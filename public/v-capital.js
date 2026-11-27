/* Aahsso — Capital structure: who funds the business.
   Equity providers (owners, partners, investors) have a stake (%) and a capital account: money put in − money taken out.
   Debt providers (lenders) give loans: amount, interest a year, months → monthly payment and plan; a repayment splits into
   principal (lowers what is owed, not an expense) and interest (an expense, in Profit & loss).
   One "Record financial entry" window for everything; the starting capital is a short step-by-step setup. */

const capS = () => KC.capitalSummary(K.raw, { today: todayStr() });
const funderName = (id) => (byId('funders', id) || {}).name || '—';
const equityFunders = () => K.raw.funders.filter((f) => f.kind !== 'debt' && !f.deleted).sort((a, b) => num(b.stakePct) - num(a.stakePct) || (a.name || '').localeCompare(b.name || ''));
const lenders = () => K.raw.funders.filter((f) => f.kind === 'debt' && !f.deleted).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
const capColor = (i) => ['#0f5e63', '#d9822b', '#5b6ee1', '#2f9e62', '#b5477e', '#7a6a2f', '#3a8fb7', '#9a5bd1'][i % 8];
const ratio = (x) => x == null ? '—' : (Math.round(x * 100) / 100).toFixed(2);
const isCapRow = (e) => e && KC.CAPITAL_TYPES[e.type] && !e.deleted;
/** save after the same checks as the server (this-device mode has no server) */
async function capSave(col, doc) {
  const bad = KC.capitalCheck(col, doc, K.raw); if (bad) { toast(bad, true); return false; }
  return save(col, doc);
}

/* ================= the page ================= */
VIEWS.capital = { render() { return capitalPage(false); } };
/** the capital structure; embedded = inside Financials (its header and starting-capital line are the page's) */
function capitalPage(embedded) {
  {
    const c = capS(); const tab = K.ui.capTab || 'equity'; const owners = equityFunders(); const loans = Object.values(c.loans);
    let html = embedded ? '' : '<div class="cap-head"><div><h2>Capital structure</h2><div class="hint">The owners, investors and loans that fund the business</div></div>' +
      '<div class="row"><button class="btn" data-a="capFunder">' + ic('users', 'sm') + 'Add provider</button><button class="btn pri" data-a="capNew">' + ic('plus', 'sm') + 'Record entry</button></div></div>';
    // starting capital
    if (!embedded) html += c.opening
      ? '<div class="cap-start">' + ic('check', 'sm') + '<span>Starting capital set on <b>' + fmtDate(c.opening.date) + '</b>' + (c.start ? ' · ' + (c.start.earlier >= 0 ? 'profit before: ' : 'loss before: ') + F(Math.abs(c.start.earlier)) : '') + '</span><button class="btn sm ghost" data-a="capOpening">Edit</button></div>'
      : '<div class="cap-cta"><div class="cap-cta-i">' + ic('wallet') + '</div><div class="grow"><b>Set your starting capital</b><div class="tiny muted">What the business had and owed when you started with Aahsso — takes 2 minutes.</div></div><button class="btn pri" data-a="capOpening">Set up</button></div>';
    const late = loans.filter((y) => y.late);
    if (late.length) html += '<div class="alert bad mb">' + ic('clock', 'sm') + '<div><b>' + late.length + ' loan payment' + (late.length === 1 ? '' : 's') + ' overdue</b>: ' + late.map((y) => esc(y.l.name || funderName(y.l.funderId)) + ' — ' + F(y.next.total) + ' since ' + fmtDate(y.next.due)).join('; ') + '</div></div>';
    html += '<div class="kpis mb">' + kpi('Total capital', F(c.total), 'equity + debt', true) + kpi('Total equity', F(c.equity), owners.length + ' provider' + (owners.length === 1 ? '' : 's') + ' · ' + pct(c.equityPct)) +
      kpi('Total debt', F(c.debt), loans.filter((y) => !y.repaid).length + ' active loan(s) · ' + pct(c.debtPct)) + kpi('Leverage (D/E)', ratio(c.de), c.de == null ? (c.debt > 0 ? 'equity is 0 or less' : 'no debt') : fmt(Math.round(c.de * 100)) + ' borrowed per 100 of equity') + '</div>';
    if (c.total > 0) html += '<div class="cap-split mb"><span class="eq" style="width:' + c.equityPct + '%"></span><span class="dt" style="width:' + c.debtPct + '%"></span></div>';
    html += '<div class="cap-tabs mb">' + [['equity', 'Equity (' + owners.length + ')'], ['debt', 'Debt (' + loans.length + ')'], ['history', 'Transactions'], ['statement', 'Statement']].map(([k, l]) => '<button class="' + (tab === k ? 'on' : '') + '" data-a="capTab" data-v="' + k + '">' + l + '</button>').join('') + '</div>';
    if (tab === 'equity') html += capEquity(c); else if (tab === 'debt') html += capDebt(c); else if (tab === 'history') html += capHistory(); else html += capStatement();
    return html;
  }
}
A.capTab = (el) => { K.ui.capTab = el.dataset.v; render(true); };

function capEquity(c) {
  const owners = equityFunders(); const left = Math.max(0, 100 - c.stakeTotal);
  if (!owners.length) return '<div class="card"><div class="empty">' + ic('users') + '<div class="mt">No equity provider yet.</div><button class="btn pri mt" data-a="capFunder" data-k="equity">Add the first owner</button></div></div>';
  return '<div class="card pad mb"><div class="row between mb"><b>Ownership</b><span class="tiny" style="color:var(--' + (left > 0.001 ? 'warn' : 'ink3') + ')">' + (left > 0.001 ? Math.round(left * 100) / 100 + '% unallocated' : '100% allocated') + '</span></div>' +
    '<div class="cap-own">' + owners.map((f, i) => num(f.stakePct) > 0 ? '<span style="width:' + num(f.stakePct) + '%;background:' + capColor(i) + '"></span>' : '').join('') + '</div>' +
    '<div class="cap-leg">' + owners.map((f, i) => '<span><i style="background:' + capColor(i) + '"></i>' + esc(f.name) + ' <b>' + num(f.stakePct) + '%</b></span>').join('') + '</div></div>' +
    '<div class="card cap-tbl"><div class="cap-tr cap-th"><span>Provider</span><span>Stake</span><span class="r">Invested</span><span class="r">Withdrawn</span><span class="r">Net capital</span></div>' +
    owners.map((f, i) => { const x = c.funders[f.id]; return '<div class="cap-tr" data-a="capFunderOpen" data-id="' + f.id + '"><span class="cap-nm"><i class="cap-av" style="background:' + capColor(i) + '">' + esc(initials(f.name)) + '</i><span><b>' + esc(f.name) + '</b><small>' + esc(f.role || 'Owner') + '</small></span></span><span>' + num(f.stakePct) + '%</span><span class="r money">' + fmt(x.putIn) + '</span><span class="r money muted">' + (x.takenOut ? fmt(x.takenOut) : '—') + '</span><span class="r money b">' + fmt(x.balance) + '</span></div>'; }).join('') + '</div>';
}
function capDebt(c) {
  const ys = Object.values(c.loans).sort((a, b) => (a.repaid - b.repaid) || ((a.next || {}).due || '').localeCompare((b.next || {}).due || ''));
  const idle = lenders().filter((f) => !ys.some((y) => y.l.funderId === f.id));
  if (!ys.length) return '<div class="card"><div class="empty">' + ic('card') + '<div class="mt">No loan recorded.</div><button class="btn pri mt" data-a="capNew" data-t="loan">Record a loan</button></div></div>';
  return '<div class="card cap-tbl"><div class="cap-tr cap-tl cap-th"><span>Loan</span><span>Rate · term</span><span class="r">Principal</span><span class="r">Repaid</span><span class="r">Outstanding</span></div>' +
    ys.map((y) => { const l = y.l; const done = y.principal ? Math.min(100, y.paid / y.principal * 100) : 0;
      return '<div class="cap-tr cap-tl" data-a="capLoanOpen" data-id="' + l.id + '"><span class="cap-nm"><i class="cap-av ' + (y.repaid ? 'ok' : y.late ? 'bad' : 'dt') + '">' + ic(y.repaid ? 'check' : 'card', 'sm') + '</i><span><b>' + esc(l.name || 'Loan') + '</b><small>' + esc(funderName(l.funderId)) + (y.repaid ? ' · settled' : y.next ? ' · next ' + fmt(y.next.total) + ' on <em' + (y.late ? ' class="late"' : '') + '>' + fmtDate(y.next.due) + '</em>' : '') + '</small><i class="cap-prog"><i style="width:' + done + '%"></i></i></span></span>' +
        '<span>' + num(l.ratePct) + '% · ' + num(l.termMonths) + ' mo</span><span class="r money">' + fmt(y.principal) + '</span><span class="r money muted">' + fmt(y.paid) + '</span><span class="r money b">' + fmt(y.outstanding) + '</span></div>'; }).join('') + '</div>' +
    (idle.length ? '<div class="tiny muted mt">Lenders with no loan: ' + idle.map((f) => '<a href="#" data-a="capFunderOpen" data-id="' + f.id + '">' + esc(f.name) + '</a>').join(', ') + '</div>' : '');
}
function capEntryRow(e) {
  const out = e.type === 'drawing' || e.type === 'repayment', tr = e.type === 'transfer'; const ln = e.loanId ? byId('loans', e.loanId) || {} : null;
  const who = tr ? funderName(e.funderId) + ' → ' + funderName(e.toFunderId) : ln ? (ln.name || 'Loan') + ' · ' + funderName(ln.funderId || e.funderId) : funderName(e.funderId);
  return '<div class="li"' + (can('capital') ? ' data-a="capEntry" data-id="' + e.id + '"' : ' style="cursor:default"') + '><div class="av ' + (tr ? 'ink' : out ? 'acc' : 'ok') + '">' + ic(CAP_ICON[e.type], 'sm') + '</div><div class="grow"><div class="t">' + esc(CAP_LABEL[e.type]) + (e.opening ? ' <span class="badge">starting</span>' : '') + '</div><div class="tiny muted">' + fmtDate(e.date) + ' · ' + esc(who) + (e.method ? ' · ' + esc(e.method) : '') + (e.ref ? ' · ' + esc(e.ref) : '') + (e.note ? ' · ' + esc(e.note) : '') + '</div></div>' +
    '<div class="right">' + (tr ? '<b>' + num(e.stakePct) + '%</b>' : '<div class="money b" style="color:var(--' + (out ? 'bad' : 'ok') + ')">' + (out ? '−' : '+') + fmt(num(e.amount)) + '</div>' + (e.type === 'repayment' && num(e.interest) ? '<div class="tiny muted">incl. interest ' + fmt(num(e.interest)) + '</div>' : '')) + '</div></div>';
}
function capHistory() {
  const rows = K.raw.capital.filter(isCapRow).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''));
  return '<div class="card list">' + (rows.length ? rows.map(capEntryRow).join('') : '<div class="empty">No transaction yet.</div>') + '</div>';
}
function capStatement() {
  const from = K.ui.capFrom || todayStr().slice(0, 4) + '-01-01', to = K.ui.capTo || todayStr();
  const c = KC.capitalSummary(K.raw, { from, to }); const owners = equityFunders(); const fl = c.flows;
  const tot = owners.reduce((a, f) => { const x = c.funders[f.id]; a.o += x.opening; a.i += x.inPeriod; a.t += x.outPeriod; a.c += x.closing; return a; }, { o: 0, i: 0, t: 0, c: 0 });
  const netIn = fl.putIn + fl.loansIn - fl.takenOut - fl.principalPaid - fl.interestPaid;
  K._capRows = { Equity: owners.map((f) => { const x = c.funders[f.id]; return { Provider: f.name, Role: f.role || '', 'Stake %': num(f.stakePct), ['Opening ' + from]: Math.round(x.opening), Injections: Math.round(x.inPeriod), Withdrawals: Math.round(x.outPeriod), ['Closing ' + to]: Math.round(x.closing) }; }),
    Debt: Object.values(c.loans).map((q) => ({ Loan: q.l.name || '', Lender: funderName(q.l.funderId), Principal: q.principal, 'Rate %': num(q.l.ratePct), Months: num(q.l.termMonths), 'Monthly payment': q.sched.emi, Repaid: Math.round(q.paid), 'Interest paid': Math.round(q.interestPaid), Outstanding: Math.round(q.outstanding) })),
    Transactions: K.raw.capital.filter(isCapRow).map((e) => ({ Date: e.date, Type: CAP_LABEL[e.type], Provider: funderName(e.funderId), Loan: e.loanId ? (byId('loans', e.loanId) || {}).name || '' : '', Amount: num(e.amount), Interest: num(e.interest) || '', 'Stake %': num(e.stakePct) || '', 'Paid by': e.method || '', Reference: e.ref || '', Note: e.note || '', By: e.by || '' })) };
  return '<div class="row wrap mb" style="align-items:flex-end"><label class="f" style="margin:0">From' + inp('capFrom', from, 'type="date" data-c="capFrom"') + '</label><label class="f" style="margin:0">To' + inp('capTo', to, 'type="date" data-c="capTo"') + '</label>' + (can('export') ? '<button class="btn" data-a="capXlsx">' + ic('dl', 'sm') + 'Excel</button>' : '') + '</div>' +
    '<div class="card cap-tbl mb"><div class="cap-tr cap-te cap-th"><span>Statement of changes in equity</span><span class="r">Opening</span><span class="r">Injections</span><span class="r">Withdrawals</span><span class="r">Closing</span></div>' +
    owners.map((f) => { const x = c.funders[f.id]; return '<div class="cap-tr cap-te"><span><b>' + esc(f.name) + '</b> <small class="muted">' + num(f.stakePct) + '%</small></span><span class="r money">' + fmt(x.opening) + '</span><span class="r money">' + fmt(x.inPeriod) + '</span><span class="r money">' + (x.outPeriod ? '−' + fmt(x.outPeriod) : '0') + '</span><span class="r money b">' + fmt(x.closing) + '</span></div>'; }).join('') +
    '<div class="cap-tr cap-te cap-tot"><span>Total equity</span><span class="r money">' + fmt(tot.o) + '</span><span class="r money">' + fmt(tot.i) + '</span><span class="r money">' + (tot.t ? '−' + fmt(tot.t) : '0') + '</span><span class="r money">' + fmt(tot.c) + '</span></div></div>' +
    '<div class="card pad"><b class="mb" style="display:block">Financing cash flow</b>' + [['Capital injections', fl.putIn], ['Loan proceeds', fl.loansIn], ['Withdrawals by owners', -fl.takenOut], ['Loan principal repaid', -fl.principalPaid], ['Loan interest paid', -fl.interestPaid], ['Net financing cash flow', netIn, 1]].map(([l, v, b]) => '<div class="row between cl' + (b ? ' b' : '') + '"><span>' + l + '</span><span class="money">' + F(v) + '</span></div>').join('') + '<div class="tiny muted mt">Interest is also counted as an expense in Profit & loss. Starting capital is not a cash movement and is left out.</div></div>';
}
CH.capFrom = (el) => { K.ui.capFrom = el.value; render(true); };
CH.capTo = (el) => { K.ui.capTo = el.value; render(true); };
A.capXlsx = () => { if (K._capRows) xlsxDownload('Capital-' + todayStr() + '.xlsx', K._capRows); };

/* ================= providers ================= */
A.capFunder = (el) => funderForm(el.dataset.id || null, el.dataset.k || 'equity');
function funderForm(id, kind) {
  const f = id ? Object.assign({}, byId('funders', id)) : { kind, stakePct: '' };
  const used = (k) => equityFunders().filter((x) => x.id !== id).reduce((s, x) => s + num(x.stakePct), 0) + (k ? 0 : 0);
  const left = Math.max(0, Math.round((100 - used()) * 100) / 100);
  const body = '<div class="capf">' +
    (id ? '' : '<div class="cap-seg2">' + [['equity', 'Equity', 'Owner, partner, investor'], ['debt', 'Debt', 'Bank, microfinance, lender']].map(([k, l, s]) => '<button type="button" data-kind="' + k + '" class="' + (f.kind === k ? 'on' : '') + '"><b>' + l + '</b><small>' + s + '</small></button>').join('') + '</div>') +
    '<div class="grid2">' + field('Name', inp('name', f.name, 'placeholder="Person or institution" autocomplete="off"')) + '<label class="f">Type<select class="inp" name="role" id="fuRole"></select></label></div>' +
    '<div class="grid2" id="fuEq">' + field('Stake (%)', inp('stakePct', f.stakePct, 'inputmode="decimal" placeholder="0 – 100"')) + '<div class="cap-left"><span>Allocated <b>' + Math.round(used() * 100) / 100 + '%</b></span><span id="fuLeft">Remaining <b>' + left + '%</b></span></div></div>' +
    '<div class="grid2">' + field('Phone', inp('phone', f.phone, 'inputmode="tel" placeholder="Optional"')) + field('Note', inp('note', f.note, 'placeholder="Optional"')) + '</div></div>';
  const sh = openSheet({ title: id ? 'Edit provider' : 'Add capital provider', body, foot: '<button class="btn pri block lg" id="fuOk">' + ic('check') + (id ? 'Update provider' : 'Save provider') + '</button>' });
  sh.classList.add('cap-sheet');
  const setKind = (k) => { f.kind = k; $$('[data-kind]', sh).forEach((b) => b.classList.toggle('on', b.dataset.kind === k)); $('#fuRole', sh).innerHTML = (k === 'debt' ? KC.LENDER_ROLES : KC.EQUITY_ROLES).map((r) => '<option' + (r === f.role ? ' selected' : '') + '>' + esc(r) + '</option>').join(''); $('#fuEq', sh).classList.toggle('hide', k === 'debt'); };
  setKind(f.kind || 'equity');
  sh.addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) setKind(b.dataset.kind); });
  sh.addEventListener('input', (e) => { if (e.target.name === 'stakePct') { const over = num(e.target.value) > left + 0.001; $('#fuLeft', sh).innerHTML = 'Remaining <b style="color:var(--' + (over ? 'bad' : 'ink') + ')">' + Math.round((left - num(e.target.value)) * 100) / 100 + '%</b>'; } });
  $('#fuOk', sh).onclick = async () => {
    const v = formVals(sh); const doc = Object.assign(f, { name: String(v.name || '').trim(), role: v.role, phone: String(v.phone || '').trim(), note: String(v.note || '').trim() });
    if (doc.kind === 'debt') delete doc.stakePct; else doc.stakePct = Math.round(num(v.stakePct) * 100) / 100;
    if (!doc.id) { doc.id = uid('fu_'); doc.createdAt = new Date().toISOString(); }
    if (await capSave('funders', doc)) { closeSheet(); toast(id ? 'Provider updated' : 'Provider added'); render(true); }
  };
}
A.capFunderOpen = (el) => {
  const f = byId('funders', el.dataset.id); if (!f) return; const c = capS(); const x = c.funders[f.id];
  const rows = x.entries.slice().reverse();
  const used = K.raw.capital.some((e) => isCapRow(e) && (e.funderId === f.id || e.toFunderId === f.id)) || K.raw.loans.some((l) => l.funderId === f.id && !l.deleted);
  const body = (f.kind === 'debt'
    ? '<div class="kpis mb">' + kpi('Outstanding', F(x.debt), '', true) + kpi('Loans', String(K.raw.loans.filter((l) => l.funderId === f.id && !l.deleted).length)) + '</div>'
    : '<div class="kpis mb">' + kpi('Net capital', F(x.balance), '', true) + kpi('Stake', num(f.stakePct) + '%') + kpi('Invested', F(x.putIn)) + kpi('Withdrawn', F(x.takenOut)) + '</div>') +
    '<b class="mb" style="display:block">' + (f.kind === 'debt' ? 'Transactions' : 'Statement of capital account') + '</b><div class="card list">' + (rows.length ? rows.map(capEntryRow).join('') : '<div class="empty">No transaction yet.</div>') + '</div>';
  openSheet({ title: f.name + (f.role ? ' · ' + f.role : ''), wide: true, body,
    foot: can('capital') ? '<button class="btn" data-a="capFunder" data-id="' + f.id + '">' + ic('edit', 'sm') + 'Edit</button>' + (used ? '' : '<button class="btn danger" data-a="capFunderDel" data-id="' + f.id + '">' + ic('trash', 'sm') + '</button>') + '<button class="btn pri grow" data-a="capNew" data-t="' + (f.kind === 'debt' ? 'loan' : 'injection') + '" data-f="' + f.id + '">' + ic('plus', 'sm') + 'Record entry</button>' : '' });
};
A.capFunderDel = async (el) => { const f = byId('funders', el.dataset.id); if (!f || !(await confirmBox('Remove ' + f.name + '?', 'Remove', true))) return; if (await remove('funders', f.id)) { closeSheet(); render(true); } };

/* ================= loans ================= */
A.capLoanOpen = (el) => {
  const l = byId('loans', el.dataset.id); if (!l) return; const c = capS(); const y = c.loans[l.id];
  const pays = y.entries.filter((e) => e.type === 'repayment').slice().reverse(); const sub = K.ui.capLoanTab || 'plan';
  const plan = '<div class="card tw"><table class="t"><thead><tr><th>#</th><th>Due</th><th class="r">Principal</th><th class="r">Interest</th><th class="r">Payment</th><th class="r">Balance</th><th></th></tr></thead><tbody>' +
    y.sched.rows.map((r) => { const paid = r.n <= y.paidRows; const late = !paid && r.due && r.due < todayStr(); return '<tr' + (y.next && y.next.n === r.n ? ' class="cap-now"' : '') + '><td>' + r.n + '</td><td>' + fmtDate(r.due) + '</td><td class="r">' + fmt(r.principal) + '</td><td class="r">' + fmt(r.interest) + '</td><td class="r">' + fmt(r.total) + '</td><td class="r">' + fmt(r.balance) + '</td><td>' + (paid ? '<span class="badge ok">paid</span>' : late ? '<span class="badge bad">late</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  const hist = '<div class="card list">' + (pays.length ? pays.map(capEntryRow).join('') : '<div class="empty">No payment yet.</div>') + '</div>';
  const body = '<div class="kpis mb">' + kpi('Outstanding', F(y.outstanding), y.repaid ? 'settled' : y.next ? 'next ' + fmt(y.next.total) + ' on ' + fmtDate(y.next.due) : '', true) + kpi('Monthly payment', F(y.sched.emi), num(l.ratePct) + '% a year · ' + num(l.termMonths) + ' months') + kpi('Repaid', F(y.paid), 'of ' + F(y.principal)) + kpi('Interest paid', F(y.interestPaid), 'about ' + fmt(y.sched.totalInterest) + ' in total') + '</div>' +
    '<div class="tiny muted mb">' + esc(funderName(l.funderId)) + ' · received ' + fmtDate(l.startDate) + (l.opening ? ' · already running at the start (amount = what was left)' : '') + (l.note ? ' · ' + esc(l.note) : '') + '</div>' +
    '<div class="cap-tabs sm mb">' + [['plan', 'Repayment schedule'], ['hist', 'Payment history (' + pays.length + ')']].map(([k, t]) => '<button class="' + (sub === k ? 'on' : '') + '" data-lt="' + k + '">' + t + '</button>').join('') + '</div><div id="clBody">' + (sub === 'plan' ? plan : hist) + '</div>';
  const sh = openSheet({ title: (l.name || 'Loan'), wide: true, body,
    foot: can('capital') ? '<button class="btn" data-a="capLoanEdit" data-id="' + l.id + '">' + ic('edit', 'sm') + 'Edit</button>' + (pays.length ? '' : '<button class="btn danger" data-a="capLoanDel" data-id="' + l.id + '">' + ic('trash', 'sm') + '</button>') + (y.repaid ? '' : '<button class="btn pri grow" data-a="capNew" data-t="repayment" data-l="' + l.id + '">Record a repayment</button>') : '' });
  sh.addEventListener('click', (e) => { const b = e.target.closest('[data-lt]'); if (!b) return; K.ui.capLoanTab = b.dataset.lt; $$('[data-lt]', sh).forEach((x) => x.classList.toggle('on', x === b)); $('#clBody', sh).innerHTML = b.dataset.lt === 'plan' ? plan : hist; });
};
A.capLoanDel = async (el) => {
  const l = byId('loans', el.dataset.id); if (!l || !(await confirmBox('Delete the loan ' + (l.name || '') + '? Nothing has been repaid on it yet.', 'Delete', true))) return;
  for (const e of K.raw.capital.filter((e) => e.loanId === l.id)) await remove('capital', e.id);
  if (await remove('loans', l.id)) { closeSheet(); render(true); }
};
A.capLoanEdit = (el) => { const l = byId('loans', el.dataset.id); if (!l) return; while (K.sheets.length) closeSheet(); capEntryModal('loan', { entry: K.raw.capital.find((x) => x.type === 'loan' && x.loanId === l.id) || null, loan: l }); };

/* ================= Record financial entry ================= */
const CAP_LABEL = { injection: 'Capital injection', drawing: 'Withdrawal', loan: 'Loan proceed', repayment: 'Loan repayment', transfer: 'Stake transfer' };
const CAP_ICON = { injection: 'plus', drawing: 'minus', loan: 'card', repayment: 'undo', transfer: 'users' };
A.capNew = (el) => { while (K.sheets.length) closeSheet(); capEntryModal(el.dataset.t || 'injection', { funderId: el.dataset.f || '', loanId: el.dataset.l || '' }); };
A.capEntry = (el) => {
  const e = byId('capital', el.dataset.id); if (!e) return;
  if (e.type === 'loan') return A.capLoanEdit({ dataset: { id: e.loanId } });
  if (e.type === 'transfer') return transferView(e);
  capEntryModal(e.type, { entry: e });
};
const opt = (list, v, first) => (first ? '<option value="">' + esc(first) + '</option>' : '') + list.map(([k, l]) => '<option value="' + esc(k) + '"' + (String(k) === String(v || '') ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
/** the fields for one kind of entry, in two tidy columns */
function capFields(type, e, L) {
  const c = capS(); const owners = equityFunders().map((f) => [f.id, f.name + ' · ' + num(f.stakePct) + '%']);
  const sel2 = (name, label, list, v, first, extra) => '<label class="f">' + label + '<select class="inp" name="' + name + '"' + (extra || '') + '>' + opt(list, v, first) + '</select></label>';
  const methods = sel2('method', 'Paid by', KC.CAPITAL_METHODS.map((m) => [m, m]), e.method || 'Cash');
  const date = field('Transaction date', inp('date', e.date || todayStr(), 'type="date"'));
  const ref = field('Reference number', inp('ref', e.ref, 'placeholder="e.g. TXN-100293"'));
  const note = field('Note', inp('note', e.note, 'placeholder="Purpose or special terms…"'));
  if (type === 'injection' || type === 'drawing') return '<div class="grid2">' + sel2('funderId', 'Equity provider', owners.concat([['__new', '+ New owner / partner…']]), e.funderId, 'Select provider') + field('Amount', inp('amount', e.amount, 'inputmode="numeric" placeholder="0" autocomplete="off"')) + '</div>' +
    '<div class="hide" id="cfNew">' + field('New provider name', inp('newName', '', 'placeholder="Full name"')) + '</div>' +
    '<div class="grid2">' + date + methods + '</div>' + '<div class="grid2">' + ref + note + '</div><div class="cap-note hide" id="cfNote"></div>';
  if (type === 'loan') { const l = L || { termMonths: 12, startDate: todayStr(), funderId: e.funderId || '' };
    return '<div class="grid2">' + sel2('funderId', 'Lender', lenders().map((f) => [f.id, f.name]).concat([['__new', '+ New lender…']]), l.funderId, 'Select lender') + field('Loan name', inp('name', l.name, 'placeholder="e.g. Freezer loan 2026"')) + '</div>' +
      '<div class="hide" id="cfNew">' + field('New lender name', inp('newLender', '', 'placeholder="e.g. Afriland First Bank"')) + '</div>' +
      '<div class="grid2">' + field(l.opening ? 'Still to pay at the start' : 'Amount received', inp('principal', l.principal, 'inputmode="numeric" placeholder="0" autocomplete="off"')) + field('Annual interest (%)', inp('ratePct', l.ratePct, 'inputmode="decimal" placeholder="e.g. 12"')) + '</div>' +
      '<div class="grid2">' + field(l.opening ? 'Months left' : 'Term (months)', inp('termMonths', l.termMonths, 'inputmode="numeric" placeholder="e.g. 24"')) + field('Date received', inp('startDate', l.startDate, 'type="date"')) + '</div>' +
      field('Note', inp('note', l.note, 'placeholder="Optional — first payment is due one month after the loan is received"')) + '<div class="cap-note" id="cfNote"></div>'; }
  if (type === 'repayment') { const act = Object.values(c.loans).filter((y) => !y.repaid || y.l.id === e.loanId).map((y) => [y.l.id, (y.l.name || 'Loan') + ' · owes ' + fmt(y.outstanding)]);
    return '<div class="grid2">' + sel2('loanId', 'Loan to repay', act, e.loanId, 'Select loan') + date + '</div>' +
      '<div class="grid2">' + field('Amount paid', inp('amount', e.amount, 'inputmode="numeric" placeholder="0" autocomplete="off"')) + field('Of which interest', inp('interest', e.interest, 'inputmode="numeric" placeholder="0"')) + '</div>' +
      '<div class="grid2">' + methods + ref + '</div><div class="cap-note" id="cfNote"></div>'; }
  // transfer
  return '<div class="grid2">' + sel2('funderId', 'From (equity provider)', owners, e.funderId, 'Select provider') + sel2('toFunderId', 'To', owners.concat([['__new', '+ New partner…']]), '', 'Select recipient') + '</div>' +
    '<div class="hide" id="cfNew">' + field('New partner name', inp('newName', '', 'placeholder="Full name"')) + '</div>' +
    '<div class="grid2">' + field('Stake to transfer (%)', inp('stakePct', '', 'inputmode="decimal" placeholder="e.g. 10"')) + date + '</div>' +
    '<div class="grid2">' + field('Price paid between them', inp('price', '', 'inputmode="numeric" placeholder="Optional"')) + note + '</div><div class="cap-note hide" id="cfNote"></div>';
}
function capEntryModal(type, o) {
  const editing = !!(o.entry || o.loan); const e0 = o.entry ? Object.assign({}, o.entry) : { funderId: o.funderId || '', loanId: o.loanId || '' };
  let T = type; const L = o.loan ? Object.assign({}, o.loan) : null;
  const tiles = editing ? '' : '<div class="cap-tiles">' + Object.keys(CAP_LABEL).map((k) => '<button type="button" data-tile="' + k + '" class="' + (k === T ? 'on' : '') + '"' + ((k === 'repayment' && !Object.values(capS().loans).some((y) => !y.repaid)) || (k === 'transfer' && equityFunders().length < 2) ? ' disabled' : '') + '><i>' + ic(CAP_ICON[k]) + '</i><span>' + CAP_LABEL[k] + '</span></button>').join('') + '</div>';
  const sh = openSheet({ title: editing ? 'Edit · ' + CAP_LABEL[T] : 'Record financial entry',
    body: (editing ? '' : '<p class="cap-sub">Record a capital injection, a withdrawal, a loan received, a loan repayment or a stake transfer.</p>') + tiles + '<div class="capf" id="cfBox"></div>',
    foot: (o.entry && T !== 'loan' ? '<button class="btn danger" id="ceDel">' + ic('trash', 'sm') + '</button>' : '') + '<button class="btn pri block lg grow" id="ceOk">' + ic('check') + (editing ? 'Save changes' : 'Record transaction') + '</button>' });
  sh.classList.add('cap-sheet');
  const box = $('#cfBox', sh); const c = capS();
  const draw = () => {
    const keep = box.innerHTML ? formVals(sh) : {}; box.innerHTML = capFields(T, Object.assign({}, e0, keep.date ? { date: keep.date, amount: keep.amount, note: keep.note, ref: keep.ref } : {}), L);
    if (T === 'repayment' && !o.entry) fillNext(); upd();
  };
  const fillNext = () => { const y = c.loans[($('[name=loanId]', sh) || {}).value]; if (!y || !y.next) return; $('[name=amount]', sh).value = Math.min(y.next.total, Math.round(y.outstanding + y.next.interest)); $('[name=interest]', sh).value = y.next.interest; };
  const note = (html) => { const n = $('#cfNote', sh); if (!n) return; n.classList.toggle('hide', !html); n.innerHTML = html || ''; };
  const upd = () => {
    const v = formVals(sh); const nw = $('#cfNew', sh); if (nw) nw.classList.toggle('hide', v.funderId !== '__new' && v.toFunderId !== '__new');
    if (T === 'drawing') { const x = c.funders[v.funderId]; const bal = x ? x.balance + (o.entry ? num(o.entry.amount) : 0) : 0; note(x ? esc(funderName(v.funderId)) + '’s net capital: <b>' + F(bal) + '</b>' + (num(v.amount) > bal ? ' · <span class="bad-t">more than they put in</span>' : '') : ''); }
    if (T === 'loan') { const s = KC.loanSchedule({ principal: v.principal, ratePct: v.ratePct, termMonths: v.termMonths, startDate: v.startDate, firstDue: L ? L.firstDue : '' }); note(num(v.principal) > 0 ? '<span>Monthly payment</span><b>' + F(s.emi) + '</b><span>' + s.rows.length + ' payments · total interest ≈ ' + fmt(s.totalInterest) + (s.endDate ? ' · last ' + fmtDate(s.endDate) : '') + '</span>' : 'Enter the amount, rate and term to see the monthly payment.'); }
    if (T === 'repayment') { const y = c.loans[v.loanId]; if (!y) return note('Choose the loan to repay.'); const left = y.outstanding + (o.entry && o.entry.loanId === v.loanId ? num(o.entry.amount) - num(o.entry.interest) : 0); const pr = Math.max(0, num(v.amount) - num(v.interest));
      note('<span>Principal</span><b>' + F(pr) + '</b><span>Interest ' + fmt(num(v.interest)) + ' (expense) · outstanding after ' + fmt(Math.max(0, left - pr)) + (pr > left + 1 ? ' · <span class="bad-t">more than owed</span>' : '') + '</span>'); }
    if (T === 'transfer') { const f = byId('funders', v.funderId); note(f ? esc(f.name) + ' holds <b>' + num(f.stakePct) + '%</b>' + (num(v.stakePct) > num(f.stakePct) ? ' · <span class="bad-t">not enough</span>' : '') : ''); }
  };
  sh.addEventListener('click', (ev) => { const t = ev.target.closest('[data-tile]'); if (!t || t.disabled) return; T = t.dataset.tile; $$('[data-tile]', sh).forEach((b) => b.classList.toggle('on', b === t)); draw(); });
  sh.addEventListener('input', upd); sh.addEventListener('change', (ev) => { if (ev.target.name === 'loanId' && !o.entry) fillNext(); upd(); });
  draw();
  const del = $('#ceDel', sh); if (del) del.onclick = async () => { if (!(await confirmBox('Delete this ' + CAP_LABEL[T].toLowerCase() + '?', 'Delete', true))) return; if (await remove('capital', o.entry.id)) { closeSheet(); render(true); } };
  $('#ceOk', sh).onclick = async () => {
    const v = formVals(sh); const now = new Date().toISOString(); const me = { by: K.me.name || '', byId: K.me.id || '' };
    const newFunder = async (name, kind, role, stake) => { const nm = String(name || '').trim(); if (!nm) { toast('Enter the name', true); return null; } const f = { id: uid('fu_'), name: nm, kind, role, createdAt: now }; if (kind === 'equity') f.stakePct = stake || 0; return (await capSave('funders', f)) ? f.id : null; };
    if (T === 'loan') {
      let fid = v.funderId; if (!fid) return toast('Choose the lender', true);
      if (fid === '__new') { fid = await newFunder(v.newLender, 'debt', 'Bank'); if (!fid) return; }
      const loan = Object.assign(L || { id: uid('ln_'), createdAt: now, status: 'active' }, { funderId: fid, name: String(v.name || '').trim() || 'Loan from ' + funderName(fid), principal: Math.round(num(v.principal)), ratePct: Math.round(num(v.ratePct) * 100) / 100, termMonths: Math.round(num(v.termMonths)), startDate: v.startDate || todayStr(), firstDue: (L && L.firstDue) || '', note: String(v.note || '').trim() });
      if (!(await capSave('loans', loan))) return;
      const ent = Object.assign(o.entry ? Object.assign({}, o.entry) : Object.assign({ id: uid('ce_'), at: now }, me), { type: 'loan', date: loan.startDate, loanId: loan.id, funderId: fid, amount: loan.principal, note: loan.note }); if (loan.opening) ent.opening = true;
      if (await capSave('capital', ent)) { closeSheet(); toast('Loan recorded — monthly payment ' + F(KC.loanSchedule(loan).emi)); render(true); }
      return;
    }
    if (T === 'transfer') return saveTransfer(v, now, me, newFunder);
    let fid = v.funderId;
    if (T !== 'repayment') { if (!fid) return toast('Choose the equity provider', true); if (fid === '__new') { if (!(num(v.amount) > 0)) return toast('Enter the amount', true); fid = await newFunder(v.newName, 'equity', equityFunders().length ? 'Partner' : 'Owner', 0); if (!fid) return; } }
    const doc = Object.assign(o.entry ? Object.assign({}, o.entry) : Object.assign({ id: uid('ce_'), at: now }, me), { type: T, date: v.date || todayStr(), amount: Math.round(num(v.amount)), method: v.method || '', ref: String(v.ref || '').trim(), note: String(v.note || '').trim() });
    if (T === 'repayment') { doc.loanId = v.loanId; doc.interest = Math.round(num(v.interest)); doc.funderId = (byId('loans', v.loanId) || {}).funderId || ''; } else doc.funderId = fid;
    if (await capSave('capital', doc)) {
      if (T === 'repayment') { const y = KC.capitalSummary(K.raw).loans[doc.loanId]; const l = byId('loans', doc.loanId); if (y && l && l.status !== (y.repaid ? 'repaid' : 'active')) await save('loans', Object.assign({}, l, { status: y.repaid ? 'repaid' : 'active' })); }
      closeSheet(); toast(CAP_LABEL[T] + ' recorded'); render(true);
    }
  };
}
/* a stake transfer: part of one owner's stake goes to another (or a new partner); no money for the business */
async function saveTransfer(v, now, me, newFunder) {
  const from = byId('funders', v.funderId); const p = Math.round(num(v.stakePct) * 100) / 100;
  if (!from) return toast('Choose who gives the stake', true); if (!(p > 0)) return toast('Enter the stake to transfer', true); if (p > num(from.stakePct) + 0.001) return toast(from.name + ' only holds ' + num(from.stakePct) + '%', true);
  let to = v.toFunderId && v.toFunderId !== '__new' ? byId('funders', v.toFunderId) : null;
  if (!to && v.toFunderId !== '__new') return toast('Choose who receives the stake', true); if (to && to.id === from.id) return toast('Choose two different providers', true);
  if (!to && !String(v.newName || '').trim()) return toast('Enter the new partner’s name', true);
  if (!(await capSave('funders', Object.assign({}, from, { stakePct: Math.round((num(from.stakePct) - p) * 100) / 100 })))) return; // the giver first: never over 100%
  let toId;
  if (!to) { toId = await newFunder(v.newName, 'equity', 'Partner', p); if (!toId) return; }
  else { if (!(await capSave('funders', Object.assign({}, to, { stakePct: Math.round((num(to.stakePct) + p) * 100) / 100 })))) return; toId = to.id; }
  await capSave('capital', Object.assign({ id: uid('ce_'), type: 'transfer', date: v.date || todayStr(), funderId: from.id, toFunderId: toId, stakePct: p, price: Math.round(num(v.price)) || 0, note: String(v.note || '').trim(), at: now }, me));
  closeSheet(); toast('Stake transferred'); render(true);
}
function transferView(e) {
  const sh = openSheet({ title: 'Stake transfer', body: '<div class="cap-note"><span>' + esc(funderName(e.funderId)) + ' → ' + esc(funderName(e.toFunderId)) + '</span><b>' + num(e.stakePct) + '%</b><span>' + fmtDate(e.date) + (num(e.price) ? ' · price ' + fmt(num(e.price)) : '') + (e.note ? ' · ' + esc(e.note) : '') + (e.by ? ' · by ' + esc(e.by) : '') + '</span></div>',
    foot: '<button class="btn grow" data-a="sheetClose">Close</button><button class="btn danger grow" id="trUndo">' + ic('undo', 'sm') + 'Undo transfer</button>' });
  $('#trUndo', sh).onclick = async () => {
    const from = byId('funders', e.funderId), to = byId('funders', e.toFunderId); const p = num(e.stakePct);
    if (!from || !to) return toast('One of the providers was removed', true); if (num(to.stakePct) + 0.001 < p) return toast(to.name + ' no longer holds ' + p + '%', true);
    if (!(await confirmBox('Give ' + p + '% back from ' + to.name + ' to ' + from.name + '?', 'Undo', true))) return;
    if (!(await capSave('funders', Object.assign({}, to, { stakePct: Math.round((num(to.stakePct) - p) * 100) / 100 })))) return;
    await capSave('funders', Object.assign({}, from, { stakePct: Math.round((num(from.stakePct) + p) * 100) / 100 }));
    await remove('capital', e.id); while (K.sheets.length) closeSheet(); render(true);
  };
}

/* ================= starting capital: a short setup ================= */
A.capOpening = () => {
  const op = byId('capital', 'opening');
  if (op) return openingWizard(op.mode || 'existing');
  const sh = openSheet({ title: 'Starting capital', body: '<p class="cap-sub">How is the business starting with Aahsso?</p><div class="cap-choice">' +
    '<button type="button" data-mode="new"><i>' + ic('plus') + '</i><b>New business</b><span>Starting today. Just enter what each owner puts in.</span><em>Start with a clean slate</em></button>' +
    '<button type="button" data-mode="existing"><i>' + ic('chart') + '</i><b>Existing business</b><span>Already running. Enter your money, stock, loans and owners as of a date.</span><em>Run the setup</em></button></div>' });
  sh.classList.add('cap-sheet');
  sh.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) { closeSheet(); openingWizard(b.dataset.mode); } });
};
function openingWizard(mode) {
  const op = byId('capital', 'opening') || {};
  const W = { mode, step: 0, date: op.date || todayStr(), cash: op.cash ?? '', banks: (op.banks || []).map((r) => Object.assign({}, r)), wallets: (op.wallets || []).map((r) => Object.assign({}, r)), stock: op.stock ?? '', equipment: op.equipment ?? '',
    owners: equityFunders().map((f) => { const e = byId('capital', 'opi_' + f.id); return { id: f.id, name: f.name, role: f.role || 'Owner', amount: e ? num(e.amount) : '', stake: num(f.stakePct) }; }), loans: [] };
  if (!W.owners.length) W.owners.push({ id: '', name: K.me.name && K.me.name !== 'Owner' ? K.me.name : '', role: 'Owner', amount: '', stake: 100 });
  const oldLoans = K.raw.loans.filter((l) => l.opening && !l.deleted);
  const stockNow = Math.round(K.raw.products.reduce((s, p) => s + num(((K.C.prodX || {})[p.id] || {}).stockValue), 0));
  const equipNow = K.raw.assets.length ? Math.round(KC.assetTotals(K.raw.assets.filter((a) => !KC.assetGone(a)), S(), W.date, W.date).book) : 0;
  const STEPS = mode === 'new' ? [['owners', 'Owners'], ['review', 'Review']] : [['money', 'Money'], ['assets', 'Stock & equipment'], ['owners', 'Owners'], ['loans', 'Loans'], ['review', 'Review']];
  const sh = openSheet({ title: 'Starting capital', wide: true, body: '<div class="wz-steps"></div><div class="wz-body"></div>', foot: '<button class="btn grow" id="wzBack"></button><button class="btn pri grow" id="wzNext"></button>' });
  sh.classList.add('cap-sheet', 'wz');
  const sumRows = (k) => W[k].reduce((a, r) => a + num(r.amount), 0);
  const totals = () => { const money = mode === 'new' ? sumRows('owners') : num(W.cash) + sumRows('banks') + sumRows('wallets'); const has = money + (mode === 'new' ? 0 : num(W.stock) + num(W.equipment)); const loans = sumRows('loans') + oldLoans.reduce((a, l) => a + num(l.principal), 0); const cap = sumRows('owners'); return { money, has, loans, cap, earlier: has - loans - cap }; };
  const listRows = (k, cols) => '<div class="wz-list" data-list="' + k + '">' + (W[k].length ? '<div class="wz-r wz-h wz-' + k + '">' + cols.map((c) => '<span>' + c[1] + '</span>').join('') + '<span></span></div>' : '') +
    W[k].map((r, i) => '<div class="wz-r wz-' + k + '" data-i="' + i + '">' + cols.map(([f, , ph, kind]) => kind === 'role' ? '<select class="inp" data-f="role">' + KC.EQUITY_ROLES.map((x) => '<option' + (x === r.role ? ' selected' : '') + '>' + x + '</option>').join('') + '</select>' : '<input class="inp" data-f="' + f + '" value="' + esc(r[f] ?? '') + '" placeholder="' + esc(ph) + '"' + (kind === 'num' ? ' inputmode="numeric"' : kind === 'dec' ? ' inputmode="decimal"' : '') + (k === 'owners' && f === 'name' && r.id ? ' readonly' : '') + '>').join('') +
      '<button type="button" class="icon-btn" data-del="' + i + '" aria-label="Remove"' + (k === 'owners' && r.id ? ' disabled' : '') + '>' + ic('x', 'sm') + '</button></div>').join('') + '</div>';
  const add = (k, label) => '<button type="button" class="wz-add" data-add="' + k + '">' + ic('plus', 'sm') + label + '</button>';
  const money = (name, label, hint) => '<label class="f">' + label + '<input class="inp" data-w="' + name + '" inputmode="numeric" placeholder="0" value="' + esc(W[name] ?? '') + '">' + (hint ? '<small class="muted">' + hint + '</small>' : '') + '</label>';
  const STEP = {
    money: () => '<div class="wz-q"><b>What money did the business have?</b><span>Balances on the starting date.</span></div><div class="grid2"><label class="f">Starting date<input class="inp" data-w="date" type="date" value="' + esc(W.date) + '"></label>' + money('cash', 'Cash on hand', 'Till and safe') + '</div>' +
      '<div class="wz-sec">Bank accounts</div>' + listRows('banks', [['name', 'Bank', 'e.g. UBA'], ['amount', 'Balance', '0', 'num']]) + add('banks', 'Add bank account') +
      '<div class="wz-sec">Mobile money</div>' + listRows('wallets', [['name', 'Account', 'e.g. MTN MoMo 677…'], ['amount', 'Balance', '0', 'num']]) + add('wallets', 'Add mobile money account'),
    assets: () => '<div class="wz-q"><b>What else did it own?</b><span>At cost. Leave 0 if none.</span></div><div class="grid2">' + money('stock', 'Stock value') + money('equipment', 'Equipment value') + '</div>' +
      ((stockNow || equipNow) ? '<div class="cap-note"><span>In Aahsso now</span><b>' + F(stockNow + equipNow) + '</b><span>stock ' + fmt(stockNow) + (equipNow ? ' · equipment ' + fmt(equipNow) : '') + ' · <a href="#" id="wzUse">use these</a></span></div>' : ''),
    owners: () => { const st = W.owners.reduce((a, r) => a + num(r.stake), 0);
      return '<div class="wz-q"><b>' + (mode === 'new' ? 'What does each owner put in?' : 'Who owns the business?') + '</b><span>The money each one brought, and their stake.</span></div>' + (mode === 'new' ? '<div class="grid2"><label class="f">Starting date<input class="inp" data-w="date" type="date" value="' + esc(W.date) + '"></label><div></div></div>' : '') +
        listRows('owners', [['name', 'Name', 'Full name'], ['role', 'Role', '', 'role'], ['amount', 'Invested', '0', 'num'], ['stake', 'Stake %', '0', 'dec']]) + add('owners', 'Add owner') +
        '<div class="wz-stake ' + (st > 100.001 ? 'bad' : st < 99.999 ? 'warn' : 'ok') + '"><span>Total stake</span><b>' + Math.round(st * 100) / 100 + '%</b><span>' + (st > 100.001 ? 'more than 100%' : st < 99.999 ? Math.round((100 - st) * 100) / 100 + '% unallocated' : 'fully allocated') + '</span></div>'; },
    loans: () => '<div class="wz-q"><b>Loans still being repaid?</b><span>What was left to pay on the starting date. Skip if none.</span></div>' +
      (oldLoans.length ? '<div class="card list mb">' + oldLoans.map((l) => '<div class="li" style="cursor:default"><div class="grow"><div class="t">' + esc(funderName(l.funderId)) + '</div><div class="tiny muted">' + num(l.ratePct) + '% · ' + num(l.termMonths) + ' months · edit in the Debt tab</div></div><div class="money b">' + fmt(num(l.principal)) + '</div></div>').join('') + '</div>' : '') +
      listRows('loans', [['name', 'Lender', 'e.g. CCA Bank'], ['amount', 'Still to pay', '0', 'num'], ['rate', '% / year', '0', 'dec'], ['months', 'Months left', '12', 'num']]) + add('loans', 'Add loan'),
    review: () => { const t = totals();
      return '<div class="wz-q"><b>Check and save</b><span>Starting position on ' + fmtDate(W.date) + '.</span></div><div class="wz-cards">' +
        '<div><span>What the business had</span><b>' + F(t.has) + '</b><small>' + (mode === 'new' ? 'owners’ money, kept as cash' : 'money ' + fmt(t.money) + ' + stock & equipment ' + fmt(t.has - t.money)) + '</small></div>' +
        '<div><span>Funded by</span><b>' + F(t.cap + t.loans) + '</b><small>owners ' + fmt(t.cap) + ' + loans ' + fmt(t.loans) + '</small></div>' +
        '<div class="' + (Math.abs(t.earlier) < 1 ? 'ok' : t.earlier > 0 ? 'ok' : 'warn') + '"><span>' + (Math.abs(t.earlier) < 1 ? 'Difference' : t.earlier > 0 ? 'Profit made before' : 'Loss made before') + '</span><b>' + F(Math.abs(t.earlier)) + '</b><small>' + (Math.abs(t.earlier) < 1 ? 'balanced' : 'had − loans − owners') + '</small></div></div>' +
        '<div class="cap-tbl card mt"><div class="cap-tr cap-tr3 cap-th"><span>Owner</span><span class="r">Stake</span><span class="r">Invested</span></div>' + W.owners.filter((r) => r.name).map((r) => '<div class="cap-tr cap-tr3"><span><b>' + esc(r.name) + '</b> <small class="muted">' + esc(r.role) + '</small></span><span class="r">' + num(r.stake) + '%</span><span class="r money">' + fmt(num(r.amount)) + '</span></div>').join('') + '</div>' +
        '<p class="tiny muted mt">Customers who owed you and bills you owed suppliers stay in Customers and Suppliers.</p>'; },
  };
  const read = () => {
    $$('[data-w]', sh).forEach((i) => (W[i.dataset.w] = i.value));
    $$('[data-list]', sh).forEach((lst) => { const k = lst.dataset.list; $$('.wz-r[data-i]', lst).forEach((r) => { const o = W[k][+r.dataset.i]; $$('[data-f]', r).forEach((i) => (o[i.dataset.f] = i.value)); }); });
  };
  const show = () => {
    const [k] = STEPS[W.step];
    $('.wz-steps', sh).innerHTML = STEPS.map(([, l], i) => '<span class="' + (i < W.step ? 'done' : i === W.step ? 'on' : '') + '"><i>' + (i < W.step ? ic('check', 'sm') : i + 1) + '</i><em>' + l + '</em></span>').join('');
    $('.wz-body', sh).innerHTML = STEP[k]();
    $('#wzBack', sh).textContent = W.step ? 'Back' : 'Cancel';
    $('#wzNext', sh).innerHTML = k === 'review' ? ic('check') + 'Save starting capital' : 'Next';
  };
  const check = () => {
    const k = STEPS[W.step][0];
    if (k === 'owners') { if (W.owners.some((r) => !String(r.name || '').trim())) return 'Enter each owner’s name'; if (W.owners.reduce((a, r) => a + num(r.stake), 0) > 100.001) return 'The stakes add up to more than 100%'; }
    if (k === 'loans' && W.loans.some((r) => !String(r.name || '').trim() || !(num(r.amount) > 0))) return 'Each loan needs the lender and the amount still to pay';
    return '';
  };
  sh.addEventListener('click', (e) => {
    const a = e.target.closest('[data-add]'); if (a) { read(); const k = a.dataset.add; W[k].push(k === 'owners' ? { role: 'Partner', amount: '', stake: '' } : k === 'loans' ? { name: '', amount: '', rate: '', months: '' } : { name: '', amount: '' }); show(); const r = $$('[data-list="' + k + '"] .wz-r[data-i]', sh).pop(); if (r) $('input', r).focus(); return; }
    const d = e.target.closest('[data-del]'); if (d && !d.disabled) { read(); const k = d.closest('[data-list]').dataset.list; W[k].splice(+d.dataset.del, 1); show(); return; }
    if (e.target.id === 'wzUse') { e.preventDefault(); W.stock = stockNow || ''; W.equipment = equipNow || ''; show(); }
  });
  sh.addEventListener('input', (e) => { if (STEPS[W.step][0] === 'owners' && e.target.dataset.f === 'stake') { read(); const st = W.owners.reduce((a, r) => a + num(r.stake), 0); const box = $('.wz-stake', sh); box.className = 'wz-stake ' + (st > 100.001 ? 'bad' : st < 99.999 ? 'warn' : 'ok'); box.innerHTML = '<span>Total stake</span><b>' + Math.round(st * 100) / 100 + '%</b><span>' + (st > 100.001 ? 'more than 100%' : st < 99.999 ? Math.round((100 - st) * 100) / 100 + '% unallocated' : 'fully allocated') + '</span>'; } });
  $('#wzBack', sh).onclick = () => { read(); if (!W.step) return closeSheet(); W.step--; show(); };
  $('#wzNext', sh).onclick = async () => { read(); const bad = check(); if (bad) return toast(bad, true); if (W.step < STEPS.length - 1) { W.step++; show(); return; } await saveOpening(W, oldLoans, totals()); };
  show();
}
async function saveOpening(W, oldLoans, t) {
  const now = new Date().toISOString(); const date = W.date || todayStr(); const me = { by: K.me.name || '', byId: K.me.id || '' };
  const clean = (rows) => rows.filter((r) => String(r.name || '').trim() || num(r.amount)).map((r) => ({ name: String(r.name || '').trim(), amount: Math.max(0, Math.round(num(r.amount))) }));
  const doc = Object.assign(byId('capital', 'opening') || { createdAt: now }, { id: 'opening', type: 'opening', mode: W.mode, date, by: me.by,
    cash: Math.max(0, Math.round(W.mode === 'new' ? t.money : num(W.cash))), banks: W.mode === 'new' ? [] : clean(W.banks), wallets: W.mode === 'new' ? [] : clean(W.wallets),
    stock: W.mode === 'new' ? 0 : Math.max(0, Math.round(num(W.stock))), equipment: W.mode === 'new' ? 0 : Math.max(0, Math.round(num(W.equipment))) });
  if (!(await capSave('capital', doc))) return;
  // owners: stakes going down first, so the total never passes 100% on the way
  const plan = W.owners.map((r) => ({ r, f: r.id ? byId('funders', r.id) : null })).sort((a, b) => (num(a.r.stake) - num((a.f || {}).stakePct)) - (num(b.r.stake) - num((b.f || {}).stakePct)));
  for (const { r, f } of plan) {
    const fu = Object.assign(f ? Object.assign({}, f) : { id: uid('fu_'), kind: 'equity', createdAt: now }, { name: f ? f.name : String(r.name).trim(), role: r.role || 'Owner', stakePct: Math.round(num(r.stake) * 100) / 100 });
    if (!(await capSave('funders', fu))) return;
    const eid = 'opi_' + fu.id; const amt = Math.max(0, Math.round(num(r.amount)));
    if (amt > 0) { if (!(await capSave('capital', Object.assign(byId('capital', eid) || Object.assign({ at: now }, me), { id: eid, type: 'injection', opening: true, date, funderId: fu.id, amount: amt, method: '', note: 'Starting capital' })))) return; }
    else if (byId('capital', eid)) await remove('capital', eid);
  }
  for (const r of W.loans) {
    const nm = String(r.name).trim(); let f = lenders().find((x) => x.name.toLowerCase() === nm.toLowerCase());
    if (!f) { f = { id: uid('fu_'), name: nm, kind: 'debt', role: 'Bank', createdAt: now }; if (!(await capSave('funders', f))) return; }
    const loan = { id: uid('ln_'), funderId: f.id, name: 'Loan from ' + nm, principal: Math.round(num(r.amount)), ratePct: Math.round(num(r.rate) * 100) / 100, termMonths: Math.max(1, Math.round(num(r.months)) || 12), startDate: date, opening: true, status: 'active', createdAt: now };
    if (!(await capSave('loans', loan))) return;
    await capSave('capital', Object.assign({ id: uid('ce_'), type: 'loan', opening: true, date, loanId: loan.id, funderId: f.id, amount: loan.principal, note: 'Running at the start', at: now }, me));
  }
  closeSheet(); toast('Starting capital saved'); render(true);
}
