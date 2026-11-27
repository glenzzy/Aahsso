/* Aahsso — Capital & loans: who owns the business and how much they put in, the loans it is repaying, and its starting capital.
   Owners / investors (equity) have a share (%) and a capital account: money put in − money taken out.
   Lenders (debt) give loans: amount, interest a year, months → monthly payment and schedule; each repayment splits into
   principal (reduces what is owed, not an expense) and interest (an expense, in Profit & loss).
   The starting position (cash, bank, mobile money, stock, equipment, owners' capital, running loans) is set once and can be corrected. */

const capS = () => KC.capitalSummary(K.raw, { today: todayStr() });
const funderName = (id) => (byId('funders', id) || {}).name || '—';
const equityFunders = () => K.raw.funders.filter((f) => f.kind !== 'debt' && !f.deleted).sort((a, b) => num(b.stakePct) - num(a.stakePct) || (a.name || '').localeCompare(b.name || ''));
const lenders = () => K.raw.funders.filter((f) => f.kind === 'debt' && !f.deleted).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
const capColor = (i) => ['#0f5e63', '#d9822b', '#5b6ee1', '#2f9e62', '#b5477e', '#7a6a2f', '#3a8fb7', '#9a5bd1'][i % 8];
const ratio = (x) => x == null ? '—' : (Math.round(x * 100) / 100).toFixed(2);
/** save after the same checks as the server (this-device mode has no server) */
async function capSave(col, doc) {
  const bad = KC.capitalCheck(col, doc, K.raw); if (bad) { toast(bad, true); return false; }
  return save(col, doc);
}

VIEWS.capital = {
  render() {
    const c = capS(); const tab = K.ui.capTab || 'owners';
    const owners = equityFunders(); const hasAny = owners.length || K.raw.loans.length || c.opening;
    let html = '<div class="row wrap between mb"><div class="row wrap">' + capActions(c) + '</div>' +
      (hasAny ? '<button class="btn" data-a="capOpening">' + ic('edit', 'sm') + (c.opening ? 'Starting capital' : 'Set starting capital') + '</button>' : '') + '</div>';
    if (!hasAny) return html + capIntro();
    if (!c.opening) html += '<div class="alert info mb">' + ic('help', 'sm') + '<div class="grow"><b>Set your starting capital.</b> Tell Aahsso what the business had when you started using it — cash, bank, mobile money, stock — what each owner put in and the loans you are still repaying.</div><button class="btn sm pri" data-a="capOpening">Set it now</button></div>';
    const late = Object.values(c.loans).filter((y) => y.late);
    if (late.length) html += '<div class="alert bad mb">' + ic('clock', 'sm') + '<div><b>' + late.length + ' loan payment' + (late.length === 1 ? '' : 's') + ' overdue</b>: ' + late.map((y) => esc(y.l.name || funderName(y.l.funderId)) + ' — ' + F(y.next.total) + ' since ' + fmtDate(y.next.due)).join('; ') + '</div></div>';
    const nextPay = Object.values(c.loans).filter((y) => y.next && !y.repaid).sort((a, b) => (a.next.due || '').localeCompare(b.next.due || ''))[0];
    html += '<div class="kpis mb">' + kpi('Total capital', F(c.total), 'owners\' money + loans still owed', true) +
      kpi('Owners\' money (equity)', F(c.equity), owners.length + ' owner' + (owners.length === 1 ? '' : 's') + ' · ' + pct(c.equityPct) + ' of capital') +
      kpi('Loans still owed (debt)', F(c.debt), nextPay ? 'next: ' + F(nextPay.next.total) + ' on ' + fmtDate(nextPay.next.due) : Object.keys(c.loans).length ? 'all repaid' : 'no loans') +
      kpi('Debt / equity', ratio(c.de), c.de == null ? (c.debt > 0 ? 'owners\' money is 0 or less' : 'no loans') : 'borrowed ' + fmt(Math.round(c.de * 100)) + ' for every 100 of owners\' money') + '</div>';
    if (c.total > 0) html += '<div class="cap-split mb" title="Equity ' + pct(c.equityPct) + ' · Debt ' + pct(c.debtPct) + '"><span class="eq" style="width:' + c.equityPct + '%"></span><span class="dt" style="width:' + c.debtPct + '%"></span></div><div class="row between tiny muted mb"><span><i class="cap-dot eq"></i>Owners ' + pct(c.equityPct) + '</span><span><i class="cap-dot dt"></i>Loans ' + pct(c.debtPct) + '</span></div>';
    html += '<div class="seg mb">' + [['owners', 'Owners & investors'], ['loans', 'Loans'], ['history', 'History'], ['statement', 'Statement']].map(([k, l]) => '<button class="' + (tab === k ? 'on' : '') + '" data-a="capTab" data-v="' + k + '">' + l + '</button>').join('') + '</div>';
    if (tab === 'owners') html += capOwners(c);
    else if (tab === 'loans') html += capLoans(c);
    else if (tab === 'history') html += capHistory();
    else html += capStatement();
    return html;
  },
};
A.capTab = (el) => { K.ui.capTab = el.dataset.v; render(true); };
function capActions(c) {
  const o = equityFunders().length, l = Object.values(c.loans).filter((y) => !y.repaid).length;
  return '<button class="btn pri" data-a="capNew" data-t="injection">' + ic('plus') + 'Money put in</button>' +
    '<button class="btn" data-a="capNew" data-t="drawing"' + (o ? '' : ' disabled') + '>Money taken out</button>' +
    '<button class="btn" data-a="capNew" data-t="loan">Loan received</button>' +
    '<button class="btn" data-a="capNew" data-t="repayment"' + (l ? '' : ' disabled') + '>Repay a loan</button>' +
    (o > 1 ? '<button class="btn" data-a="capNew" data-t="transfer">Transfer shares</button>' : '');
}
function capIntro() {
  return '<div class="card pad2"><h2 class="mb">Your capital, owners and loans</h2><div class="muted mb">Keep track of where the business\'s money came from:</div>' +
    '<div class="small col mb" style="gap:6px"><div>• <b>Owners & investors</b> — each one\'s share (%), what they put in and what they took out</div><div>• <b>Loans</b> — from a bank, a microfinance, a njangi or family: the monthly payment, what is left to pay, and the interest (counted in Profit & loss)</div><div>• <b>Starting capital</b> — what the business had when you started with Aahsso</div></div>' +
    '<div class="row wrap"><button class="btn pri" data-a="capOpening">' + ic('check') + 'Set starting capital</button><button class="btn" data-a="capFunder" data-k="equity">' + ic('plus') + 'Add an owner</button><button class="btn" data-a="capNew" data-t="loan">Record a loan</button></div></div>';
}

/* ---------- owners & investors ---------- */
function capOwners(c) {
  const owners = equityFunders(); const left = Math.max(0, 100 - c.stakeTotal);
  let h = '';
  if (owners.length) {
    h += '<div class="card pad mb"><div class="row between mb"><h3>Who owns the business</h3><span class="tiny ' + (left > 0.001 ? 'warn-t' : 'muted') + '">' + (left > 0.001 ? Math.round(left * 100) / 100 + '% not given to anyone' : '100% given') + '</span></div>' +
      '<div class="cap-own">' + owners.map((f, i) => num(f.stakePct) > 0 ? '<span style="width:' + num(f.stakePct) + '%;background:' + capColor(i) + '" title="' + esc(f.name) + ' ' + num(f.stakePct) + '%"></span>' : '').join('') + '</div>' +
      '<div class="cap-leg">' + owners.map((f, i) => '<span><i style="background:' + capColor(i) + '"></i>' + esc(f.name) + ' <b>' + num(f.stakePct) + '%</b></span>').join('') + '</div></div>';
  }
  h += '<div class="row between mb"><h3>Owners & investors</h3><button class="btn sm" data-a="capFunder" data-k="equity">' + ic('plus', 'sm') + 'Add</button></div>';
  h += '<div class="card list mb">' + (owners.length ? owners.map((f, i) => { const x = c.funders[f.id];
    return '<div class="li" data-a="capFunderOpen" data-id="' + f.id + '"><div class="av" style="background:' + capColor(i) + ';color:#fff">' + esc(initials(f.name)) + '</div><div class="grow"><div class="t">' + esc(f.name) + ' <span class="badge">' + esc(f.role || 'Owner') + '</span></div><div class="tiny muted">Share ' + num(f.stakePct) + '% · put in ' + F(x.putIn) + (x.takenOut ? ' · took out ' + F(x.takenOut) : '') + '</div></div><div class="right"><div class="money b">' + F(x.balance) + '</div><div class="tiny muted">capital</div></div></div>'; }).join('')
    : '<div class="empty pad">No owner yet. Add yourself and your partners.</div>') + '</div>';
  const ls = lenders();
  if (ls.length) h += '<div class="row between mb"><h3>Lenders</h3><button class="btn sm" data-a="capFunder" data-k="debt">' + ic('plus', 'sm') + 'Add</button></div><div class="card list">' + ls.map((f) => { const x = c.funders[f.id];
    return '<div class="li" data-a="capFunderOpen" data-id="' + f.id + '"><div class="av ink">' + ic('wallet', 'sm') + '</div><div class="grow"><div class="t">' + esc(f.name) + ' <span class="badge">' + esc(f.role || 'Lender') + '</span></div><div class="tiny muted">' + K.raw.loans.filter((l) => l.funderId === f.id && !l.deleted).length + ' loan(s)</div></div><div class="right"><div class="money b">' + F(x.debt) + '</div><div class="tiny muted">still owed</div></div></div>'; }).join('') + '</div>';
  return h;
}
A.capFunder = (el) => funderForm(el.dataset.id || null, el.dataset.k || 'equity');
function funderForm(id, kind) {
  const f = id ? Object.assign({}, byId('funders', id)) : { kind, role: kind === 'debt' ? 'Bank' : (equityFunders().length ? 'Partner' : 'Owner'), stakePct: '' };
  const used = equityFunders().filter((x) => x.id !== id).reduce((s, x) => s + num(x.stakePct), 0);
  const sh = openSheet({ title: id ? 'Edit ' + f.name : f.kind === 'debt' ? 'Add a lender' : 'Add an owner or investor',
    body: '<div class="col">' + field('Name *', inp('name', f.name, 'placeholder="' + (f.kind === 'debt' ? 'e.g. Afriland First Bank, CCA, njangi of the market' : 'Person or company') + '" autocomplete="off"')) +
      '<div class="grid2">' + field(f.kind === 'debt' ? 'Kind of lender' : 'Role', sel('role', f.kind === 'debt' ? KC.LENDER_ROLES : KC.EQUITY_ROLES, f.role)) +
      (f.kind === 'debt' ? field('Phone', inp('phone', f.phone, 'inputmode="tel"')) : field('Share of the business (%)', inp('stakePct', f.stakePct, 'inputmode="decimal" placeholder="0–100"'), '') ) + '</div>' +
      (f.kind === 'debt' ? '' : '<div class="tiny muted" id="fuLeft" style="margin-top:-6px">Already given to others: ' + Math.round(used * 100) / 100 + '% · left: ' + Math.max(0, Math.round((100 - used) * 100) / 100) + '%</div>' + field('Phone', inp('phone', f.phone, 'inputmode="tel"'))) +
      field('Note', inp('note', f.note, 'placeholder="Optional"')) + '</div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="fuOk">' + ic('check') + 'Save</button>' });
  const st = $('[name=stakePct]', sh); if (st) st.addEventListener('input', () => { const over = used + num(st.value) > 100.001; $('#fuLeft', sh).style.color = over ? 'var(--bad)' : ''; });
  $('#fuOk', sh).onclick = async () => {
    const v = formVals(sh); const doc = Object.assign(f, { name: String(v.name || '').trim(), role: v.role, phone: String(v.phone || '').trim(), note: String(v.note || '').trim() });
    if (doc.kind !== 'debt') doc.stakePct = Math.round(num(v.stakePct) * 100) / 100; if (!doc.id) { doc.id = uid('fu_'); doc.createdAt = new Date().toISOString(); }
    if (await capSave('funders', doc)) { closeSheet(); toast('Saved'); render(true); }
  };
}
A.capFunderOpen = (el) => {
  const f = byId('funders', el.dataset.id); if (!f) return; const c = capS(); const x = c.funders[f.id];
  const rows = x.entries.slice().reverse();
  const body = f.kind === 'debt'
    ? '<div class="kpis mb">' + kpi('Still owed', F(x.debt), '', true) + kpi('Loans', String(K.raw.loans.filter((l) => l.funderId === f.id && !l.deleted).length)) + '</div>' + capLoanRows(c, (y) => y.l.funderId === f.id)
    : '<div class="kpis mb">' + kpi('Capital', F(x.balance), 'put in − taken out', true) + kpi('Share', num(f.stakePct) + '%') + kpi('Put in', F(x.putIn)) + kpi('Taken out', F(x.takenOut)) + '</div>' +
      '<h3 class="mb">Capital account</h3><div class="card list">' + (rows.length ? rows.map(capEntryRow).join('') : '<div class="empty pad">Nothing recorded yet.</div>') + '</div>';
  const used = K.raw.capital.some((e) => isCapRow(e) && (e.funderId === f.id || e.toFunderId === f.id)) || K.raw.loans.some((l) => l.funderId === f.id && !l.deleted);
  openSheet({ title: f.name + ' · ' + (f.role || ''), wide: true, body: (f.phone ? '<div class="small muted mb">' + esc(f.phone) + '</div>' : '') + body,
    foot: can('capital') ? '<button class="btn" data-a="capFunder" data-id="' + f.id + '" data-k="' + f.kind + '">' + ic('edit') + 'Edit</button>' + (used ? '' : '<button class="btn danger" data-a="capFunderDel" data-id="' + f.id + '">' + ic('trash') + 'Remove</button>') +
      (f.kind === 'debt' ? '<button class="btn pri grow" data-a="capNew" data-t="loan" data-f="' + f.id + '">New loan</button>' : '<button class="btn grow" data-a="capNew" data-t="drawing" data-f="' + f.id + '">Taken out</button><button class="btn pri grow" data-a="capNew" data-t="injection" data-f="' + f.id + '">Put in</button>') : '' });
};
A.capFunderDel = async (el) => { const f = byId('funders', el.dataset.id); if (!f || !(await confirmBox('Remove ' + f.name + '?', 'Remove', true))) return; if (await remove('funders', f.id)) { closeSheet(); render(true); } };

/* ---------- loans ---------- */
function capLoans(c) {
  return '<div class="row between mb"><h3>Loans</h3><button class="btn sm" data-a="capNew" data-t="loan">' + ic('plus', 'sm') + 'Loan received</button></div>' + capLoanRows(c, () => true);
}
function capLoanRows(c, keep) {
  const ys = Object.values(c.loans).filter(keep).sort((a, b) => (a.repaid - b.repaid) || ((a.next || {}).due || '').localeCompare((b.next || {}).due || ''));
  if (!ys.length) return '<div class="card"><div class="empty pad">No loan recorded.</div></div>';
  return '<div class="card list">' + ys.map((y) => { const l = y.l; const done = y.principal ? Math.min(100, y.paid / y.principal * 100) : 0;
    return '<div class="li" data-a="capLoanOpen" data-id="' + l.id + '"><div class="av ' + (y.repaid ? 'ok' : y.late ? 'bad' : 'ink') + '">' + ic(y.repaid ? 'check' : 'wallet', 'sm') + '</div><div class="grow"><div class="t">' + esc(l.name || 'Loan') + ' <span class="tiny muted">· ' + esc(funderName(l.funderId)) + '</span></div>' +
      '<div class="tiny muted">' + F(y.principal) + ' · ' + num(l.ratePct) + '% a year · ' + num(l.termMonths) + ' months' + (y.repaid ? ' · <b style="color:var(--ok)">repaid</b>' : y.next ? ' · next ' + F(y.next.total) + ' on <span style="' + (y.late ? 'color:var(--bad);font-weight:600' : '') + '">' + fmtDate(y.next.due) + '</span>' : '') + '</div>' +
      '<div class="cap-prog"><span style="width:' + done + '%"></span></div></div><div class="right"><div class="money b">' + F(y.outstanding) + '</div><div class="tiny muted">still owed</div></div></div>'; }).join('') + '</div>';
}
A.capLoanOpen = (el) => {
  const l = byId('loans', el.dataset.id); if (!l) return; const c = capS(); const y = c.loans[l.id];
  const pays = y.entries.filter((e) => e.type === 'repayment').slice().reverse();
  const body = '<div class="kpis mb">' + kpi('Still owed', F(y.outstanding), y.repaid ? 'repaid' : y.next ? 'next ' + F(y.next.total) + ' on ' + fmtDate(y.next.due) : '', true) + kpi('Monthly payment', F(y.sched.emi), num(l.ratePct) + '% a year · ' + num(l.termMonths) + ' months') + kpi('Paid back', F(y.paid), 'of ' + F(y.principal)) + kpi('Interest paid', F(y.interestPaid), 'of about ' + F(y.sched.totalInterest) + ' in total') + '</div>' +
    '<div class="small muted mb">From <b>' + esc(funderName(l.funderId)) + '</b> · received ' + fmtDate(l.startDate) + (l.opening ? ' · already running when you started with Aahsso (amount = what was left to pay)' : '') + (l.note ? ' · ' + esc(l.note) : '') + '</div>' +
    '<h3 class="mb">Payments made</h3><div class="card list mb">' + (pays.length ? pays.map(capEntryRow).join('') : '<div class="empty pad">No payment yet.</div>') + '</div>' +
    '<h3 class="mb">Repayment plan</h3><div class="card tw"><table class="t"><thead><tr><th>#</th><th>Due</th><th class="r">Principal</th><th class="r">Interest</th><th class="r">Payment</th><th class="r">Left after</th><th></th></tr></thead><tbody>' +
    y.sched.rows.map((r) => { const paid = r.n <= y.paidRows; const late = !paid && r.due && r.due < todayStr(); return '<tr' + (y.next && y.next.n === r.n ? ' style="font-weight:600"' : '') + '><td>' + r.n + '</td><td>' + fmtDate(r.due) + '</td><td class="r">' + fmt(r.principal) + '</td><td class="r">' + fmt(r.interest) + '</td><td class="r">' + fmt(r.total) + '</td><td class="r">' + fmt(r.balance) + '</td><td>' + (paid ? '<span class="badge ok">paid</span>' : late ? '<span class="badge bad">late</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  openSheet({ title: (l.name || 'Loan') + ' · ' + funderName(l.funderId), wide: true, body,
    foot: can('capital') ? '<button class="btn" data-a="capLoanEdit" data-id="' + l.id + '">' + ic('edit') + 'Edit</button>' + (pays.length ? '' : '<button class="btn danger" data-a="capLoanDel" data-id="' + l.id + '">' + ic('trash') + 'Delete</button>') + (y.repaid ? '' : '<button class="btn pri grow" data-a="capNew" data-t="repayment" data-l="' + l.id + '">Record a payment</button>') : '' });
};
A.capLoanDel = async (el) => {
  const l = byId('loans', el.dataset.id); if (!l || !(await confirmBox('Delete the loan ' + (l.name || '') + '? Nothing has been paid on it yet.', 'Delete', true))) return;
  for (const e of K.raw.capital.filter((e) => e.loanId === l.id)) await remove('capital', e.id);
  if (await remove('loans', l.id)) { closeSheet(); render(true); }
};
A.capLoanEdit = (el) => { const l = byId('loans', el.dataset.id); const e = K.raw.capital.find((x) => x.type === 'loan' && x.loanId === l.id); entryForm('loan', { entry: e || null, loan: l }); };

/* ---------- history & statement ---------- */
const isCapRow = (e) => e && KC.CAPITAL_TYPES[e.type] && !e.deleted;
function capEntryRow(e) {
  const out = e.type === 'drawing' || e.type === 'repayment', tr = e.type === 'transfer';
  const who = tr ? funderName(e.funderId) + ' → ' + funderName(e.toFunderId) : e.loanId ? ((byId('loans', e.loanId) || {}).name || 'Loan') + ' · ' + funderName((byId('loans', e.loanId) || {}).funderId || e.funderId) : funderName(e.funderId);
  return '<div class="li"' + (can('capital') ? ' data-a="capEntry" data-id="' + e.id + '"' : ' style="cursor:default"') + '><div class="av ' + (tr ? 'ink' : out ? 'acc' : 'ok') + '">' + ic(tr ? 'users' : out ? 'up' : 'down', 'sm') + '</div><div class="grow"><div class="t">' + esc(KC.CAPITAL_TYPES[e.type]) + (e.opening ? ' <span class="badge">starting</span>' : '') + '</div><div class="tiny muted">' + fmtDate(e.date) + ' · ' + esc(who) + (e.method ? ' · ' + esc(e.method) : '') + (e.ref ? ' · ' + esc(e.ref) : '') + (e.note ? ' · ' + esc(e.note) : '') + (e.by ? ' · by ' + esc(e.by) : '') + '</div></div>' +
    '<div class="right">' + (tr ? '<b>' + num(e.stakePct) + '%</b>' : '<div class="money b" style="color:var(--' + (out ? 'bad' : 'ok') + ')">' + (out ? '−' : '+') + F(num(e.amount)) + '</div>' + (e.type === 'repayment' && num(e.interest) ? '<div class="tiny muted">interest ' + fmt(num(e.interest)) + '</div>' : '')) + '</div></div>';
}
function capHistory() {
  const rows = K.raw.capital.filter(isCapRow).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''));
  return '<div class="card list">' + (rows.length ? rows.map(capEntryRow).join('') : '<div class="empty pad">Nothing recorded yet.</div>') + '</div>';
}
function capStatement() {
  const y = todayStr().slice(0, 4); const from = K.ui.capFrom || y + '-01-01', to = K.ui.capTo || todayStr();
  const c = KC.capitalSummary(K.raw, { from, to }); const owners = equityFunders(); const fl = c.flows;
  const tot = owners.reduce((a, f) => { const x = c.funders[f.id]; a.o += x.opening; a.i += x.inPeriod; a.t += x.outPeriod; a.c += x.closing; return a; }, { o: 0, i: 0, t: 0, c: 0 });
  const netIn = fl.putIn + fl.loansIn - fl.takenOut - fl.principalPaid - fl.interestPaid;
  K._capRows = { 'Owners': owners.map((f) => { const x = c.funders[f.id]; return { Owner: f.name, Role: f.role || '', 'Share %': num(f.stakePct), ['At ' + from]: Math.round(x.opening), 'Put in': Math.round(x.inPeriod), 'Taken out': Math.round(x.outPeriod), ['At ' + to]: Math.round(x.closing) }; }),
    'Loans': Object.values(c.loans).map((q) => ({ Loan: q.l.name || '', Lender: funderName(q.l.funderId), Amount: q.principal, 'Rate %': num(q.l.ratePct), Months: num(q.l.termMonths), 'Monthly payment': q.sched.emi, 'Paid back': Math.round(q.paid), 'Interest paid': Math.round(q.interestPaid), 'Still owed': Math.round(q.outstanding) })),
    'Entries': K.raw.capital.filter(isCapRow).map((e) => ({ Date: e.date, Kind: KC.CAPITAL_TYPES[e.type], Who: funderName(e.funderId), Loan: e.loanId ? (byId('loans', e.loanId) || {}).name || '' : '', Amount: num(e.amount), Interest: num(e.interest) || '', 'Share %': num(e.stakePct) || '', Method: e.method || '', Ref: e.ref || '', Note: e.note || '', By: e.by || '' })) };
  return '<div class="row wrap mb"><label class="f" style="margin:0">From' + inp('capFrom', from, 'type="date" data-c="capFrom"') + '</label><label class="f" style="margin:0">To' + inp('capTo', to, 'type="date" data-c="capTo"') + '</label>' + (can('export') ? '<button class="btn" data-a="capXlsx" style="align-self:flex-end">' + ic('dl') + 'Excel</button>' : '') + '</div>' +
    '<div class="card tw mb"><h3 class="pad" style="padding-bottom:0">Owners\' capital, ' + fmtDate(from) + ' – ' + fmtDate(to) + '</h3><table class="t"><thead><tr><th>Owner</th><th class="r">At the start</th><th class="r">Put in</th><th class="r">Taken out</th><th class="r">At the end</th></tr></thead><tbody>' +
    owners.map((f) => { const x = c.funders[f.id]; return '<tr><td>' + esc(f.name) + ' <span class="tiny muted">' + num(f.stakePct) + '%</span></td><td class="r">' + fmt(x.opening) + '</td><td class="r">' + fmt(x.inPeriod) + '</td><td class="r">' + (x.outPeriod ? '−' + fmt(x.outPeriod) : '0') + '</td><td class="r b">' + fmt(x.closing) + '</td></tr>'; }).join('') +
    '<tr class="b"><td>Total</td><td class="r">' + fmt(tot.o) + '</td><td class="r">' + fmt(tot.i) + '</td><td class="r">' + (tot.t ? '−' + fmt(tot.t) : '0') + '</td><td class="r">' + fmt(tot.c) + '</td></tr></tbody></table></div>' +
    '<div class="card pad"><h3 class="mb">Money in and out (owners & loans)</h3>' + [['+ Money put in by owners', fl.putIn], ['+ Loans received', fl.loansIn], ['− Money taken out by owners', -fl.takenOut], ['− Loans paid back (principal)', -fl.principalPaid], ['− Interest on loans (an expense, in Profit & loss)', -fl.interestPaid], ['= Net', netIn, 1]].map(([l, v, b]) => '<div class="row between cl' + (b ? ' b' : '') + '"><span>' + l + '</span><span class="money">' + F(v) + '</span></div>').join('') + '<div class="tiny muted mt">Starting capital is not counted here: it was already in the business.</div></div>';
}
CH.capFrom = (el) => { K.ui.capFrom = el.value; render(true); };
CH.capTo = (el) => { K.ui.capTo = el.value; render(true); };
A.capXlsx = () => { if (K._capRows) xlsxDownload('Capital-' + todayStr() + '.xlsx', K._capRows); };

/* ---------- one entry: put in, taken out, loan received, repayment, share transfer ---------- */
A.capNew = (el) => {
  const t = el.dataset.t; if (K.sheets.length) closeSheet();
  if ((t === 'injection' || t === 'drawing' || t === 'transfer') && !equityFunders().length) return funderForm(null, 'equity');
  entryForm(t, { funderId: el.dataset.f || '', loanId: el.dataset.l || '' });
};
A.capEntry = (el) => {
  const e = byId('capital', el.dataset.id); if (!e) return;
  if (e.type === 'loan') return A.capLoanEdit({ dataset: { id: e.loanId } });
  if (e.type === 'transfer') return transferView(e);
  entryForm(e.type, { entry: e });
};
const methodSel = (v) => field('Paid by', sel('method', KC.CAPITAL_METHODS, v || 'Cash'));
function entryForm(type, o) {
  const e = o.entry ? Object.assign({}, o.entry) : { type, date: todayStr(), funderId: o.funderId || '', loanId: o.loanId || '', method: 'Cash' };
  const c = capS(); const owners = equityFunders(); const L = o.loan ? Object.assign({}, o.loan) : null;
  if (type === 'transfer') return transferForm(o.funderId);
  const title = (e.id ? 'Edit · ' : '') + KC.CAPITAL_TYPES[type];
  let body = '<div class="col">';
  if (type === 'injection' || type === 'drawing') {
    body += field(type === 'injection' ? 'Who put the money in *' : 'Who took the money *', sel('funderId', [['', 'Choose…']].concat(owners.map((f) => [f.id, f.name + ' · ' + (f.role || '')])), e.funderId)) +
      '<div class="grid2">' + field('Amount *', inp('amount', e.amount, 'inputmode="numeric" autocomplete="off"')) + field('Date', inp('date', e.date, 'type="date"')) + '</div>' +
      '<div class="grid2">' + methodSel(e.method) + field('Reference', inp('ref', e.ref, 'placeholder="Optional"')) + '</div>' + field('Note', inp('note', e.note, 'placeholder="' + (type === 'injection' ? 'e.g. to buy the freezer' : 'e.g. monthly drawing') + '"')) +
      '<div class="tiny muted" id="ceHint"></div>';
  } else if (type === 'loan') {
    const l = L || { startDate: todayStr(), ratePct: '', termMonths: 12, funderId: o.funderId || '' };
    body += '<div class="grid2">' + field('Lender *', sel('funderId', [['', 'Choose…']].concat(lenders().map((f) => [f.id, f.name])).concat([['__new', '+ New lender…']]), l.funderId)) + '<div class="hide" id="ceNewL">' + field('New lender name', inp('newLender', '', 'placeholder="e.g. Afriland First Bank"')) + '</div></div>' +
      field('Name of the loan', inp('name', l.name, 'placeholder="e.g. Freezer loan 2026"')) +
      '<div class="grid2">' + field((l.opening ? 'Still to pay when you started *' : 'Amount received *'), inp('principal', l.principal, 'inputmode="numeric" autocomplete="off"')) + field('Interest (% a year)', inp('ratePct', l.ratePct, 'inputmode="decimal" placeholder="e.g. 12"')) +
      field(l.opening ? 'Months left' : 'Length (months) *', inp('termMonths', l.termMonths, 'inputmode="numeric"')) + field('Date received', inp('startDate', l.startDate, 'type="date"')) +
      field('First payment due', inp('firstDue', l.firstDue || '', 'type="date"')) + (l.opening ? '<div></div>' : methodSel(e.method)) + '</div>' +
      field('Note', inp('note', l.note, 'placeholder="Optional"')) + '<div class="alert info" id="ceEmi"></div>';
  } else if (type === 'repayment') {
    const act = Object.values(c.loans).filter((y) => !y.repaid || y.l.id === e.loanId);
    body += field('Loan *', sel('loanId', [['', 'Choose…']].concat(act.map((y) => [y.l.id, (y.l.name || 'Loan') + ' · ' + funderName(y.l.funderId) + ' · owe ' + fmt(y.outstanding)])), e.loanId)) +
      '<div class="grid2">' + field('Amount paid *', inp('amount', e.amount, 'inputmode="numeric" autocomplete="off"')) + field('Of which interest', inp('interest', e.interest, 'inputmode="numeric" placeholder="0"')) +
      field('Date', inp('date', e.date, 'type="date"')) + methodSel(e.method) + '</div>' + field('Reference', inp('ref', e.ref, 'placeholder="Optional"')) + field('Note', inp('note', e.note, 'placeholder="Optional"')) +
      '<div class="alert info" id="ceRep"></div>';
  }
  body += '</div>';
  const sh = openSheet({ title, body, foot: (e.id && type !== 'loan' ? '<button class="btn danger" id="ceDel">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="ceOk">' + ic('check') + 'Save</button>' });
  const val = () => formVals(sh);
  const upd = () => {
    const v = val();
    if (type === 'drawing' && $('#ceHint', sh)) { const x = c.funders[v.funderId]; const bal = x ? x.balance + (e.id ? num(o.entry.amount) : 0) : 0; $('#ceHint', sh).innerHTML = x ? 'Capital of ' + esc(funderName(v.funderId)) + ': ' + F(bal) + (num(v.amount) > bal ? ' — <b style="color:var(--warn)">this takes out more than they put in</b>' : '') : ''; }
    if (type === 'loan') { $('#ceNewL', sh).classList.toggle('hide', v.funderId !== '__new'); const s = KC.loanSchedule({ principal: v.principal, ratePct: v.ratePct, termMonths: v.termMonths, startDate: v.startDate, firstDue: v.firstDue }); $('#ceEmi', sh).innerHTML = num(v.principal) > 0 ? 'Monthly payment <b>' + F(s.emi) + '</b> for ' + s.rows.length + ' months' + (s.endDate ? ' (last on ' + fmtDate(s.endDate) + ')' : '') + ' · interest in total about <b>' + F(s.totalInterest) + '</b>' : 'Enter the amount to see the monthly payment.'; }
    if (type === 'repayment') { const y = c.loans[v.loanId]; const box = $('#ceRep', sh); if (!y) { box.textContent = 'Choose the loan.'; return; }
      const left = y.outstanding + (e.id && o.entry.loanId === v.loanId ? num(o.entry.amount) - num(o.entry.interest) : 0); const pr = Math.max(0, num(v.amount) - num(v.interest));
      box.innerHTML = 'Principal paid back: <b>' + F(pr) + '</b> · interest (an expense): <b>' + F(num(v.interest)) + '</b><br>Still owed after: <b>' + F(Math.max(0, left - pr)) + '</b>' + (pr > left + 1 ? ' — <b style="color:var(--bad)">more than is owed</b>' : ''); }
  };
  // repayment: fill in the next instalment of the plan
  const fillNext = () => { if (type !== 'repayment' || e.id) return; const y = c.loans[$('[name=loanId]', sh).value]; if (!y || !y.next) return; $('[name=amount]', sh).value = Math.min(y.next.total, Math.round(y.outstanding + y.next.interest)); $('[name=interest]', sh).value = y.next.interest; };
  sh.addEventListener('input', upd); sh.addEventListener('change', (ev) => { if (ev.target.name === 'loanId') fillNext(); upd(); });
  fillNext(); upd();
  const del = $('#ceDel', sh); if (del) del.onclick = async () => { if (!(await confirmBox('Delete this ' + KC.CAPITAL_TYPES[type].toLowerCase() + '?', 'Delete', true))) return; if (await remove('capital', e.id)) { closeSheet(); render(true); } };
  $('#ceOk', sh).onclick = async () => {
    const v = val(); const now = new Date().toISOString();
    if (type === 'loan') {
      let fid = v.funderId;
      if (fid === '__new') { const nm = String(v.newLender || '').trim(); if (!nm) return toast('Enter the lender\'s name', true); const f = { id: uid('fu_'), name: nm, kind: 'debt', role: 'Bank', createdAt: now }; if (!(await capSave('funders', f))) return; fid = f.id; }
      const loan = Object.assign(L || { id: uid('ln_'), createdAt: now, status: 'active' }, { funderId: fid, name: String(v.name || '').trim() || 'Loan from ' + funderName(fid), principal: Math.round(num(v.principal)), ratePct: Math.round(num(v.ratePct) * 100) / 100, termMonths: Math.round(num(v.termMonths)), startDate: v.startDate || todayStr(), firstDue: v.firstDue || '', note: String(v.note || '').trim() });
      if (!(await capSave('loans', loan))) return;
      const ent = Object.assign(e.id ? e : { id: uid('ce_'), at: now }, { type: 'loan', date: loan.startDate, loanId: loan.id, funderId: fid, amount: loan.principal, method: loan.opening ? '' : v.method, note: loan.note }); if (loan.opening) ent.opening = true;
      if (await capSave('capital', ent)) { while (K.sheets.length) closeSheet(); toast('Loan saved — monthly payment ' + F(KC.loanSchedule(loan).emi)); render(true); }
      return;
    }
    const doc = Object.assign(e, { type, date: v.date || todayStr(), amount: Math.round(num(v.amount)), method: v.method || '', ref: String(v.ref || '').trim(), note: String(v.note || '').trim() });
    if (!doc.id) { doc.id = uid('ce_'); doc.at = now; doc.by = K.me.name || ''; doc.byId = K.me.id || ''; }
    if (type === 'repayment') { doc.loanId = v.loanId; doc.interest = Math.round(num(v.interest)); doc.funderId = (byId('loans', v.loanId) || {}).funderId || ''; }
    else doc.funderId = v.funderId;
    if (await capSave('capital', doc)) {
      if (type === 'repayment') { const y = KC.capitalSummary(K.raw).loans[doc.loanId]; const l = byId('loans', doc.loanId); if (y && l) { const st = y.repaid ? 'repaid' : 'active'; if (l.status !== st) await save('loans', Object.assign({}, l, { status: st })); } }
      while (K.sheets.length) closeSheet(); toast('Saved'); render(true);
    }
  };
}
/* a share transfer: one owner gives part of their share to another (or to a new partner); no money for the business */
function transferForm(fromId) {
  const owners = equityFunders();
  const sh = openSheet({ title: 'Transfer shares', body: '<div class="col"><div class="grid2">' + field('From *', sel('funderId', [['', 'Choose…']].concat(owners.map((f) => [f.id, f.name + ' · ' + num(f.stakePct) + '%'])), fromId || '')) +
      field('To *', sel('toFunderId', [['', 'Choose…']].concat(owners.map((f) => [f.id, f.name + ' · ' + num(f.stakePct) + '%'])).concat([['__new', '+ New partner…']]), '')) + '</div>' +
      '<div class="hide" id="trNew">' + field('New partner\'s name', inp('newName', '')) + '</div>' +
      '<div class="grid2">' + field('Share to transfer (%) *', inp('stakePct', '', 'inputmode="decimal"')) + field('Date', inp('date', todayStr(), 'type="date"')) + '</div>' +
      field('Price paid between them (optional)', inp('price', '', 'inputmode="numeric" placeholder="Not money for the business"')) + field('Note', inp('note', '', 'placeholder="Optional"')) + '<div class="tiny muted" id="trHint"></div></div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="trOk">' + ic('check') + 'Transfer</button>' });
  const upd = () => { const v = formVals(sh); $('#trNew', sh).classList.toggle('hide', v.toFunderId !== '__new'); const f = byId('funders', v.funderId); $('#trHint', sh).innerHTML = f ? esc(f.name) + ' has ' + num(f.stakePct) + '%' + (num(v.stakePct) > num(f.stakePct) ? ' — <b style="color:var(--bad)">not enough</b>' : '') : ''; };
  sh.addEventListener('input', upd); sh.addEventListener('change', upd); upd();
  $('#trOk', sh).onclick = async () => {
    const v = formVals(sh); const from = byId('funders', v.funderId); const p = Math.round(num(v.stakePct) * 100) / 100; const now = new Date().toISOString();
    if (!from) return toast('Choose who gives the share', true); if (!(p > 0)) return toast('Enter the share to transfer', true); if (p > num(from.stakePct) + 0.001) return toast(from.name + ' only has ' + num(from.stakePct) + '%', true);
    let to = v.toFunderId === '__new' ? null : byId('funders', v.toFunderId);
    if (!to && v.toFunderId !== '__new') return toast('Choose who receives the share', true); if (to && to.id === from.id) return toast('Choose two different people', true);
    // the giver first, so the shares never add up to more than 100%
    if (!(await capSave('funders', Object.assign({}, from, { stakePct: Math.round((num(from.stakePct) - p) * 100) / 100 })))) return;
    if (!to) { const nm = String(v.newName || '').trim(); if (!nm) return toast('Enter the new partner\'s name', true); to = { id: uid('fu_'), name: nm, kind: 'equity', role: 'Partner', stakePct: p, createdAt: now }; if (!(await capSave('funders', to))) return; }
    else if (!(await capSave('funders', Object.assign({}, to, { stakePct: Math.round((num(to.stakePct) + p) * 100) / 100 })))) return;
    await capSave('capital', { id: uid('ce_'), type: 'transfer', date: v.date || todayStr(), funderId: from.id, toFunderId: to.id, stakePct: p, price: Math.round(num(v.price)) || 0, note: String(v.note || '').trim(), at: now, by: K.me.name || '', byId: K.me.id || '' });
    closeSheet(); toast('Share transferred'); render(true);
  };
}
function transferView(e) {
  const sh = openSheet({ title: 'Share transfer', body: '<div class="col small"><div><b>' + num(e.stakePct) + '%</b> from <b>' + esc(funderName(e.funderId)) + '</b> to <b>' + esc(funderName(e.toFunderId)) + '</b> on ' + fmtDate(e.date) + '</div>' + (num(e.price) ? '<div>Price paid between them: ' + F(num(e.price)) + '</div>' : '') + (e.note ? '<div>' + esc(e.note) + '</div>' : '') + (e.by ? '<div class="muted">Recorded by ' + esc(e.by) + '</div>' : '') + '</div>',
    foot: '<button class="btn grow" data-a="sheetClose">Close</button><button class="btn danger grow" id="trUndo">' + ic('undo') + 'Undo the transfer</button>' });
  $('#trUndo', sh).onclick = async () => {
    const from = byId('funders', e.funderId), to = byId('funders', e.toFunderId); const p = num(e.stakePct);
    if (!from || !to) return toast('One of the owners was removed', true); if (num(to.stakePct) + 0.001 < p) return toast(to.name + ' no longer has ' + p + '%', true);
    if (!(await confirmBox('Give ' + p + '% back from ' + to.name + ' to ' + from.name + '?', 'Undo', true))) return;
    if (!(await capSave('funders', Object.assign({}, to, { stakePct: Math.round((num(to.stakePct) - p) * 100) / 100 })))) return;
    await capSave('funders', Object.assign({}, from, { stakePct: Math.round((num(from.stakePct) + p) * 100) / 100 }));
    await remove('capital', e.id); while (K.sheets.length) closeSheet(); render(true);
  };
}

/* ---------- starting capital (the opening position) ---------- */
A.capOpening = () => {
  const op = Object.assign({ date: todayStr(), cash: '', banks: [], wallets: [], stock: '', equipment: '' }, byId('capital', 'opening') || {});
  const first = !byId('capital', 'opening');
  const stockNow = Math.round(K.raw.products.reduce((s, p) => s + num(((K.C.prodX || {})[p.id] || {}).stockValue), 0));
  const equipNow = K.raw.assets.length ? Math.round(KC.assetTotals(K.raw.assets.filter((a) => !KC.assetGone(a)), S(), op.date, op.date).book) : 0;
  const owners = equityFunders().map((f) => { const e = K.raw.capital.find((x) => x.id === 'opi_' + f.id); return { id: f.id, name: f.name, role: f.role, stake: num(f.stakePct), amount: e ? num(e.amount) : '' }; });
  if (!owners.length) owners.push({ id: '', name: K.me.name || '', role: 'Owner', stake: 100, amount: '' });
  const oldLoans = K.raw.loans.filter((l) => l.opening && !l.deleted);
  const bankRow = (r, k) => '<div class="op-row" data-r="' + k + '"><input class="inp" data-k="name" value="' + esc(r.name || '') + '" placeholder="' + (k === 'banks' ? 'Bank, e.g. UBA' : 'e.g. MTN MoMo 677…') + '"><input class="inp" data-k="amount" inputmode="numeric" value="' + esc(r.amount ?? '') + '" placeholder="Balance"><button type="button" class="icon-btn" data-x title="Remove">' + ic('x', 'sm') + '</button></div>';
  const ownRow = (r) => '<div class="op-row op-own" data-r="owners" data-id="' + esc(r.id || '') + '"><input class="inp" data-k="name" value="' + esc(r.name || '') + '" placeholder="Name"' + (r.id ? ' readonly' : '') + '>' + sel('', KC.EQUITY_ROLES, r.role || 'Owner', 'data-k="role"') + '<input class="inp" data-k="amount" inputmode="numeric" value="' + esc(r.amount ?? '') + '" placeholder="Put in"><input class="inp" data-k="stake" inputmode="decimal" value="' + esc(r.stake ?? '') + '" placeholder="%"><button type="button" class="icon-btn" data-x title="Remove"' + (r.id ? ' disabled' : '') + '>' + ic('x', 'sm') + '</button></div>';
  const loanRow = (r) => '<div class="op-row op-loan" data-r="loans"><input class="inp" data-k="name" placeholder="Lender"><input class="inp" data-k="amount" inputmode="numeric" placeholder="Still to pay"><input class="inp" data-k="rate" inputmode="decimal" placeholder="% / yr"><input class="inp" data-k="months" inputmode="numeric" placeholder="Months left"><button type="button" class="icon-btn" data-x title="Remove">' + ic('x', 'sm') + '</button></div>';
  const body = '<div class="col">' +
    '<p class="small muted" style="margin:0">What the business had and owed on the day you started using Aahsso. A brand-new business: put what the owners brought in. You can correct it later.</p>' +
    field('Starting date', inp('date', op.date, 'type="date"')) +
    '<h3>1 · Money the business had</h3>' + field('Cash (in the till and the safe)', inp('cash', op.cash, 'inputmode="numeric" placeholder="0"')) +
    '<div class="small b">Bank accounts</div><div id="opBanks">' + (op.banks || []).map((r) => bankRow(r, 'banks')).join('') + '</div><button type="button" class="btn sm" data-add="banks">' + ic('plus', 'sm') + 'Add a bank account</button>' +
    '<div class="small b mt">Mobile money</div><div id="opWallets">' + (op.wallets || []).map((r) => bankRow(r, 'wallets')).join('') + '</div><button type="button" class="btn sm" data-add="wallets">' + ic('plus', 'sm') + 'Add a mobile money account</button>' +
    '<h3 class="mt">2 · Stock and equipment</h3><div class="grid2">' + field('Value of stock (at cost)', inp('stock', op.stock, 'inputmode="numeric" placeholder="0"')) + field('Value of equipment', inp('equipment', op.equipment, 'inputmode="numeric" placeholder="0"')) + '</div>' +
    ((stockNow || equipNow) ? '<div class="tiny muted" style="margin-top:-6px">In Aahsso now: stock ' + F(stockNow) + (equipNow ? ', equipment ' + F(equipNow) : '') + ' <button type="button" class="btn sm" id="opUse">Use these</button></div>' : '') +
    '<h3 class="mt">3 · Owners — what each one put in, and their share</h3><div class="op-head op-own"><span>Name</span><span>Role</span><span>Put in</span><span>Share %</span><span></span></div><div id="opOwners">' + owners.map(ownRow).join('') + '</div><button type="button" class="btn sm" data-add="owners">' + ic('plus', 'sm') + 'Add an owner</button><div class="tiny" id="opStake"></div>' +
    '<h3 class="mt">4 · Loans you were still repaying</h3>' + (oldLoans.length ? '<div class="card list mb">' + oldLoans.map((l) => '<div class="li" style="cursor:default"><div class="grow"><div class="t">' + esc(l.name || '') + '</div><div class="tiny muted">' + esc(funderName(l.funderId)) + ' · ' + num(l.ratePct) + '% · ' + num(l.termMonths) + ' months</div></div><div class="money b">' + F(num(l.principal)) + '</div></div>').join('') + '</div><div class="tiny muted">Change these in the Loans tab. Add more here:</div>' : '') +
    '<div class="op-head op-loan"><span>Lender</span><span>Still to pay</span><span>% / yr</span><span>Months left</span><span></span></div><div id="opLoans"></div><button type="button" class="btn sm" data-add="loans">' + ic('plus', 'sm') + 'Add a loan</button>' +
    '<h3 class="mt">5 · Summary</h3><div class="card pad" id="opSum"></div>' +
    '<div class="tiny muted">Customers who owed you money and bills you owed suppliers are recorded in Customers and Suppliers.</div></div>';
  const sh = openSheet({ title: first ? 'Set your starting capital' : 'Starting capital', wide: true, body, foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="opOk">' + ic('check') + 'Save starting capital</button>' });
  const rows = (k) => $$('[data-r="' + k + '"]', sh).map((r) => { const o = { id: r.dataset.id || '' }; $$('[data-k]', r).forEach((i) => (o[i.dataset.k] = i.value)); return o; });
  const sum = () => {
    const v = formVals(sh); const s2 = (k) => rows(k).reduce((a, r) => a + num(r.amount), 0);
    const money = num(v.cash) + s2('banks') + s2('wallets'), has = money + num(v.stock) + num(v.equipment);
    const loans = s2('loans') + oldLoans.reduce((a, l) => a + num(l.principal), 0), cap = s2('owners'), earlier = has - loans - cap;
    const stake = rows('owners').reduce((a, r) => a + num(r.stake), 0);
    $('#opStake', sh).innerHTML = stake > 100.001 ? '<span style="color:var(--bad)">The shares add up to ' + stake + '% — more than 100%</span>' : stake < 99.999 ? '<span style="color:var(--warn)">The shares add up to ' + stake + '% (' + Math.round((100 - stake) * 100) / 100 + '% not given)</span>' : '<span style="color:var(--ok)">Shares: 100%</span>';
    $('#opSum', sh).innerHTML = [['Money (cash, bank, mobile money)', money], ['+ Stock and equipment', num(v.stock) + num(v.equipment)], ['= What the business had', has, 1], ['− Loans still to pay', -loans], ['− What the owners put in', -cap], ['= ' + (earlier >= 0 ? 'Profit made before' : 'Loss made before'), earlier, 1]].map(([l, x, b]) => '<div class="row between cl' + (b ? ' b' : '') + '"><span>' + l + '</span><span class="money">' + F(x) + '</span></div>').join('') +
      '<div class="tiny muted mt">' + (Math.abs(earlier) < 1 ? 'Balanced: everything the business had came from the owners and the loans.' : earlier > 0 ? 'The business had more than the owners and lenders gave it: the difference is profit kept from before.' : 'The business had less than the owners and lenders gave it: the difference was lost or spent before.') + '</div>';
  };
  sh.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-add]'); if (a) { const k = a.dataset.add; const box = $({ banks: '#opBanks', wallets: '#opWallets', owners: '#opOwners', loans: '#opLoans' }[k], sh); box.insertAdjacentHTML('beforeend', k === 'owners' ? ownRow({ role: 'Partner' }) : k === 'loans' ? loanRow({}) : bankRow({}, k)); $$('input', box).slice(-1)[0] && $$('[data-k=name]', box).slice(-1)[0].focus(); sum(); return; }
    const x = ev.target.closest('[data-x]'); if (x && !x.disabled) { x.closest('.op-row').remove(); sum(); }
    if (ev.target.id === 'opUse') { $('[name=stock]', sh).value = stockNow || ''; $('[name=equipment]', sh).value = equipNow || ''; sum(); }
  });
  sh.addEventListener('input', sum); sh.addEventListener('change', sum); sum();
  $('#opOk', sh).onclick = async () => {
    const v = formVals(sh); const now = new Date().toISOString(); const date = v.date || todayStr();
    const clean = (k) => rows(k).filter((r) => String(r.name || '').trim() || num(r.amount)).map((r) => ({ name: String(r.name || '').trim(), amount: Math.max(0, Math.round(num(r.amount))) }));
    const own = rows('owners').filter((r) => r.id || String(r.name || '').trim());
    if (own.some((r) => !r.id && !String(r.name || '').trim())) return toast('Enter each owner\'s name', true);
    const stake = own.reduce((a, r) => a + num(r.stake), 0); if (stake > 100.001) return toast('The owners\' shares add up to more than 100%', true);
    const lns = rows('loans').filter((r) => String(r.name || '').trim() || num(r.amount));
    if (lns.some((r) => !String(r.name || '').trim() || !(num(r.amount) > 0))) return toast('Each loan needs the lender and the amount still to pay', true);
    const doc = Object.assign(byId('capital', 'opening') || { createdAt: now }, { id: 'opening', type: 'opening', date, cash: Math.max(0, Math.round(num(v.cash))), banks: clean('banks'), wallets: clean('wallets'), stock: Math.max(0, Math.round(num(v.stock))), equipment: Math.max(0, Math.round(num(v.equipment))), by: K.me.name || '' });
    if (!(await capSave('capital', doc))) return;
    // owners: shares going down first, so the total never passes 100% on the way
    const plan = own.map((r) => ({ r, f: r.id ? byId('funders', r.id) : null })).sort((a, b) => (num(a.r.stake) - num((a.f || {}).stakePct || 0)) - (num(b.r.stake) - num((b.f || {}).stakePct || 0)));
    for (const { r, f } of plan) {
      const fu = Object.assign(f ? Object.assign({}, f) : { id: uid('fu_'), kind: 'equity', createdAt: now }, { name: f ? f.name : String(r.name).trim(), role: r.role || 'Owner', stakePct: Math.round(num(r.stake) * 100) / 100 });
      if (!(await capSave('funders', fu))) return;
      const eid = 'opi_' + fu.id; const amt = Math.max(0, Math.round(num(r.amount)));
      if (amt > 0) { if (!(await capSave('capital', Object.assign(byId('capital', eid) || { at: now, by: K.me.name || '', byId: K.me.id || '' }, { id: eid, type: 'injection', opening: true, date, funderId: fu.id, amount: amt, method: '', note: 'Starting capital' })))) return; }
      else if (byId('capital', eid)) await remove('capital', eid);
    }
    for (const r of lns) {
      const nm = String(r.name).trim(); let f = lenders().find((x) => x.name.toLowerCase() === nm.toLowerCase());
      if (!f) { f = { id: uid('fu_'), name: nm, kind: 'debt', role: 'Bank', createdAt: now }; if (!(await capSave('funders', f))) return; }
      const loan = { id: uid('ln_'), funderId: f.id, name: 'Loan from ' + nm + ' (running)', principal: Math.round(num(r.amount)), ratePct: Math.round(num(r.rate) * 100) / 100, termMonths: Math.max(1, Math.round(num(r.months)) || 12), startDate: date, opening: true, status: 'active', createdAt: now };
      if (!(await capSave('loans', loan))) return;
      await capSave('capital', { id: uid('ce_'), type: 'loan', opening: true, date, loanId: loan.id, funderId: f.id, amount: loan.principal, note: 'Already running at the start', at: now, by: K.me.name || '', byId: K.me.id || '' });
    }
    closeSheet(); toast('Starting capital saved'); render(true);
  };
};
