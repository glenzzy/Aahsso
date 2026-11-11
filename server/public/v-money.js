/* Kargo — cash handover, suppliers & bills, debt reminders, locations */

/* ================= CASH HANDOVER ================= */
const hoId = (date, uid_) => 'h_' + date + '_' + String(uid_).replace(/[^A-Za-z0-9_\-]/g, '');
const sumObj = (o) => Object.values(o || {}).reduce((a, v) => a + num(v), 0);
VIEWS.cash = {
  render() {
    const d = K.ui.cashDate || todayStr();
    const mine = KC.collectedBy(K.raw, K.me.id, d);
    const ho = byId('handovers', hoId(d, K.me.id));
    let html = '<div class="row wrap mb"><input type="date" class="inp" style="width:auto" value="' + d + '" data-c="cashDate"><span class="small muted">' + fmtDate(d) + '</span></div>';
    if (can('payments')) {
      html += '<div class="card pad2 mb"><div class="row between mb"><h2>My cash & mobile money</h2>' + (ho ? hoBadge(ho) : '') + '</div>' +
        '<div class="tiny muted mb">Everything you recorded today, by method. Count your cash and check your MoMo/OM balances, then hand over.</div>' +
        (mine.items.length ? Object.entries(mine.by).map(([m, v]) => '<div class="row between cl"><span>' + esc(m) + (mine.feesBy[m] ? ' <span class="tiny muted">+ ' + F(mine.feesBy[m]) + ' charges</span>' : '') + '</span><b class="money">' + F(v) + '</b></div>').join('') + '<div class="row between cl b"><span>Total collected</span><span class="money">' + F(mine.total) + '</span></div>' : '<div class="muted small">You recorded no payments on this day.</div>') +
        (ho ? '<div class="alert ' + (Math.abs(ho.diff) < 1 ? 'info' : 'bad') + ' mt">Handed over ' + F(sumObj(ho.declared) + num(ho.payouts)) + ' · ' + diffText(ho.diff) + (ho.status === 'confirmed' ? ' · confirmed by ' + esc(ho.confirmedBy || '') : ' · waiting for manager') + '</div>' : '') +
        (!ho || ho.status !== 'confirmed' ? '<button class="btn pri block mt" data-a="hoOpen" data-d="' + d + '">' + ic('wallet') + (ho ? 'Update my handover' : 'Close my day & hand over') + '</button>' : '') + '</div>';
    }
    if (can('handover')) {
      const people = {};
      K.raw.sales.forEach((s) => (s.payments || []).forEach((p) => { if (p.date === d && p.byId) people[p.byId] = people[p.byId] || p.by || 'Staff'; }));
      K.raw.handovers.filter((h) => h.date === d).forEach((h) => (people[h.userId] = people[h.userId] || h.userName));
      const rows = Object.entries(people).map(([id, name]) => ({ id, name, exp: KC.collectedBy(K.raw, id, d), ho: byId('handovers', hoId(d, id)) }));
      html += '<h2 class="mb">Team handovers · ' + fmtDate(d) + '</h2><div class="mb">' + hoTable(rows, d) + '</div>';
      // shortages over 30 days
      const from = KC.addDays(todayStr(), -29); const agg = {};
      K.raw.handovers.filter((h) => h.date >= from).forEach((h) => { const o = (agg[h.userId] = agg[h.userId] || { name: h.userName, short: 0, over: 0, days: 0 }); o.days++; if (h.diff < 0) o.short += -h.diff; else o.over += h.diff; });
      const ag = Object.values(agg);
      if (ag.length) html += '<div class="card pad mb"><h3 class="mb">Last 30 days — differences by person</h3>' + ag.sort((a, b) => b.short - a.short).map((o) => '<div class="row between cl"><span>' + esc(o.name) + ' <span class="tiny faint">' + o.days + ' day(s)</span></span><span class="small">' + (o.short ? '<b style="color:var(--bad)">short ' + F(o.short) + '</b>' : '<span style="color:var(--ok)">no shortage</span>') + (o.over ? ' · over ' + F(o.over) : '') + '</span></div>').join('') + '</div>';
    }
    return html;
  },
};
CH.cashDate = (el) => { K.ui.cashDate = el.value; render(true); };
const hoBadge = (h) => h.status === 'confirmed' ? '<span class="badge ok">Confirmed</span>' : '<span class="badge info">Submitted</span>';
const diffText = (d) => Math.abs(d) < 1 ? 'balanced ✓' : d < 0 ? 'short ' + F(-d) : 'over ' + F(d);
A.hoOpen = (el) => {
  const d = el.dataset.d; const exp = KC.collectedBy(K.raw, K.me.id, d); const prev = byId('handovers', hoId(d, K.me.id)) || {};
  // cash expenses this person recorded today (End of day) are what they paid out of the till
  const mine = K.raw.expenses.filter((e) => e.date === d && e.byId === K.me.id && (e.method || 'Cash') === 'Cash');
  const myCash = { total: mine.reduce((a, e) => a + num(e.amount), 0), note: mine.map((e) => e.category + (e.description ? ' (' + e.description + ')' : '')).join(', ') };
  const methods = Array.from(new Set(Object.keys(exp.by).concat(['Cash'])));
  const sh = openSheet({ title: 'Hand over · ' + fmtDate(d), body: '<div class="alert info mb">Enter what you actually have — counted cash, and the MoMo / OM amounts you can see on the phone.</div>' +
    methods.map((m) => '<div class="row between cl"><div class="grow"><div class="b">' + esc(m) + '</div><div class="tiny muted">Recorded: ' + F(exp.by[m] || 0) + (exp.feesBy[m] ? ' · charges received on top: ' + F(exp.feesBy[m]) : '') + '</div></div><input class="inp price-in" inputmode="numeric" data-dm="' + esc(m) + '" value="' + ((prev.declared || {})[m] ?? (exp.by[m] || '')) + '"></div>').join('') +
    '<div class="grid2 mt">' + field('Cash paid out today (F)', inp('payouts', prev.payouts ?? (myCash.total || ''), 'inputmode="numeric" placeholder="e.g. transport, food"')) + field('What for', inp('payoutNote', prev.payoutNote ?? myCash.note)) + '</div>' + field('Note', inp('notes', prev.notes || ''), 'mt') +
    '<div class="card pad mt"><div class="row between"><span>Recorded</span><b class="money">' + F(exp.total) + '</b></div><div class="row between"><span>Handing over + paid out</span><b class="money" id="hoDecl">—</b></div><div class="row between b mt"><span>Difference</span><span id="hoDiff">—</span></div></div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="hoSave">Submit handover</button>' });
  const calc = () => { const decl = $$('[data-dm]', sh).reduce((a, i) => a + num(i.value), 0) + num($('[name=payouts]', sh).value); const diff = decl - exp.total; $('#hoDecl', sh).textContent = F(decl); const o = $('#hoDiff', sh); o.textContent = diffText(diff); o.style.color = Math.abs(diff) < 1 ? 'var(--ok)' : diff < 0 ? 'var(--bad)' : 'var(--warn)'; return diff; };
  sh.addEventListener('input', calc); calc();
  $('#hoSave', sh).onclick = async () => {
    const v = formVals(sh); const declared = {}; $$('[data-dm]', sh).forEach((i) => (declared[i.dataset.dm] = num(i.value)));
    const diff = calc();
    if (Math.abs(diff) >= 1 && !(await confirmBox('There is a difference: ' + diffText(diff) + '. Submit anyway?', 'Submit'))) return;
    if (await save('handovers', { id: hoId(d, K.me.id), date: d, userId: K.me.id, userName: K.me.name || 'Staff', locationId: K.loc, expected: exp.by, expectedTotal: exp.total, declared, payouts: num(v.payouts), payoutNote: v.payoutNote, notes: v.notes, diff, status: 'submitted', submittedAt: new Date().toISOString() })) { closeSheet(); scheduleRender(); toast('Handover submitted'); }
  };
};
A.hoReview = (el) => {
  const d = el.dataset.d, uidv = el.dataset.u; const exp = KC.collectedBy(K.raw, uidv, d); const ho = byId('handovers', hoId(d, uidv));
  const methods = Array.from(new Set(Object.keys(exp.by).concat(Object.keys((ho && ho.declared) || {}))));
  const sh = openSheet({ title: (ho ? ho.userName : 'Staff') + ' · ' + fmtDate(d), wide: true, body:
    '<div class="card tw mb"><table class="t"><thead><tr><th>Method</th><th class="r">Recorded</th><th class="r">Handed over</th><th class="r">Difference</th></tr></thead><tbody>' + methods.map((m) => { const e = exp.by[m] || 0, h = ho ? num((ho.declared || {})[m]) : 0; return '<tr><td>' + esc(m) + '</td><td class="r money">' + fmt(e) + '</td><td class="r money">' + (ho ? fmt(h) : '—') + '</td><td class="r b" style="color:' + (!ho || Math.abs(h - e) < 1 ? 'inherit' : h < e ? 'var(--bad)' : 'var(--warn)') + '">' + (ho ? fmt(h - e) : '') + '</td></tr>'; }).join('') +
    (ho && num(ho.payouts) ? '<tr><td>Paid out: ' + esc(ho.payoutNote || '') + '</td><td></td><td class="r money">' + fmt(ho.payouts) + '</td><td></td></tr>' : '') + '</tbody></table></div>' +
    (ho ? '<div class="alert ' + (Math.abs(ho.diff) < 1 ? 'info' : 'bad') + ' mb"><b>' + diffText(sumObj(ho.declared) + num(ho.payouts) - exp.total) + '</b>' + (ho.notes ? ' · ' + esc(ho.notes) : '') + (Math.abs(exp.total - num(ho.expectedTotal)) >= 1 ? '<br>Note: payments changed after they submitted (was ' + F(ho.expectedTotal) + ').' : '') + '</div>' : '<div class="alert mb">Not handed over yet.</div>') +
    '<h3 class="mb">Payments recorded</h3><div class="card list">' + exp.items.map((it) => '<div class="li" data-a="openSale" data-id="' + it.saleId + '"><div class="grow"><div class="t">' + esc(it.customer) + '</div><div class="tiny muted">' + esc(it.no) + ' · ' + esc(it.txnId) + ' · ' + esc(it.p.method) + (it.p.account ? ' → ' + esc(it.p.account) : '') + (it.p.ref ? ' · txn ' + esc(it.p.ref) : '') + (num(it.p.fee) > 0 ? ' · charges ' + F(it.p.fee) : '') + '</div></div><b class="money">' + F(it.p.amount) + '</b></div>').join('') + '</div>',
    foot: ho && ho.status !== 'confirmed' ? '<button class="btn grow" data-a="sheetClose">Close</button><button class="btn pri grow" id="hoConfirm">' + ic('check') + 'Confirm money received</button>' : '' });
  if ($('#hoConfirm', sh)) $('#hoConfirm', sh).onclick = async () => { const diff = sumObj(ho.declared) + num(ho.payouts) - exp.total; if (await save('handovers', Object.assign({}, ho, { status: 'confirmed', confirmedBy: K.me.name || 'Manager', confirmedById: K.me.id, confirmedAt: new Date().toISOString(), diff, expectedTotal: exp.total }))) { closeSheet(); scheduleRender(); toast('Handover confirmed'); } };
};

/* ================= SUPPLIERS & BILLS ================= */
const SUP_TYPES = ['Store / wholesaler', 'Auction (B-Stock…)', 'Shipping line', 'Trucker', 'Loading / unloading crew', 'Clearing agent', 'Customs / port', 'Other'];
const supName = (id) => (byId('suppliers', id) || {}).name || '—';
const billX = (b) => KC.billTotals(b, S());
const billDue = (b) => b.dueDate || b.date;
function supplierOwed(id) { return K.raw.bills.filter((b) => b.supplierId === id && b.status !== 'cancelled').reduce((a, b) => a + Math.max(0, billX(b).balanceX), 0); }
const totalOwedSuppliers = () => K.raw.bills.filter((b) => b.status !== 'cancelled').reduce((a, b) => a + Math.max(0, billX(b).balanceX), 0);
VIEWS.suppliers = {
  render() {
    const tab = K.ui.supTab || 'open'; const t = todayStr();
    const open = K.raw.bills.filter((b) => b.status !== 'cancelled' && billX(b).balance > 0.005);
    const overdue = open.filter((b) => billDue(b) < t);
    const m = monthStr(); const paidMonth = K.raw.bills.reduce((a, b) => a + (b.payments || []).filter((p) => (p.date || '').slice(0, 7) === m).reduce((s, p) => s + num(p.amount) * (num(b.fxRate) || KC.rateOf(S(), b.currency)), 0), 0);
    let body = '';
    if (tab === 'suppliers') {
      body = supTable();
    } else {
      const list = (tab === 'open' ? open : K.raw.bills.slice()).sort((a, b) => billDue(a).localeCompare(billDue(b)));
      body = billsTable(list, tab === 'open' ? '<div class="big">🧾</div>Nothing to pay. 🎉' : 'No bills yet.');
    }
    return '<div class="kpis mb">' + kpi('You owe suppliers', F(totalOwedSuppliers()), open.length + ' open bill(s)', true) + kpi('Overdue', F(overdue.reduce((a, b) => a + billX(b).balanceX, 0)), overdue.length + ' bill(s)') + kpi('Paid this month', F(paidMonth)) + '</div>' +
      '<div class="row wrap mb"><button class="btn pri" data-a="billNew">' + ic('plus') + 'New bill</button><button class="btn" data-a="supNew">' + ic('plus') + 'New supplier</button></div>' +
      '<div class="chips mb">' + [['open', 'To pay'], ['all', 'All bills'], ['suppliers', 'Suppliers']].map(([k, l]) => '<button class="chip' + (tab === k ? ' on' : '') + '" data-a="supTab" data-v="' + k + '">' + l + '</button>').join('') + '</div>' + body;
  },
};
A.supTab = (el) => { K.ui.supTab = el.dataset.v; render(true); };
function billRow(b) {
  const x = billX(b); const due = billDue(b); const od = x.balance > 0.005 && due < todayStr() && b.status !== 'cancelled';
  return '<div class="li" data-a="billOpen" data-id="' + b.id + '"><div class="av acc">' + esc(initials(supName(b.supplierId))) + '</div><div class="grow" style="min-width:0"><div class="t ellipsis">' + esc(supName(b.supplierId)) + '</div><div class="tiny muted ellipsis">' + esc(x.txnId) + ' · ' + esc(b.description || '') + (b.shipmentId ? ' · ' + esc((byId('shipments', b.shipmentId) || {}).name || '') : '') + ' · due ' + fmtDate(due) + '</div></div><div class="right"><div class="b money">' + money(x.balance, b.currency) + '</div>' + (b.status === 'cancelled' ? '<span class="badge">Cancelled</span>' : x.status === 'paid' ? '<span class="badge ok">Paid</span>' : od ? '<span class="badge bad">Overdue</span>' : x.status === 'partial' ? '<span class="badge warn">Part paid</span>' : '<span class="badge">Unpaid</span>') + '</div></div>';
}
function supplierSelect(val) { return sel('supplierId', [['', 'Choose supplier…']].concat(K.raw.suppliers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => [s.id, s.name])).concat([['__new', '+ New supplier']]), val || ''); }
async function ensureSupplier(v) { if (v.supplierId && v.supplierId !== '__new') return v.supplierId; const name = (v.newSupplier || '').trim(); if (!name) return null; const ex = K.raw.suppliers.find((s) => s.name.toLowerCase() === name.toLowerCase()); if (ex) return ex.id; const s = { id: uid('su_'), name, type: v.newSupplierType || 'Other' }; await save('suppliers', s); return s.id; }
A.supNew = () => supForm(null);
A.supOpen = (el) => {
  const s = byId('suppliers', el.dataset.id); const bills = K.raw.bills.filter((b) => b.supplierId === s.id).sort((a, b) => billDue(b).localeCompare(billDue(a)));
  openSheet({ title: s.name, body: '<div class="row wrap mb"><button class="btn" data-a="supEdit" data-id="' + s.id + '">' + ic('edit') + 'Edit</button><button class="btn pri" data-a="billNew" data-sup="' + s.id + '">' + ic('plus') + 'New bill</button></div><div class="tiny muted mb">' + esc([s.type, s.phone, s.notes].filter(Boolean).join(' · ')) + '</div>' + kpi('You owe', F(supplierOwed(s.id)), bills.length + ' bill(s)', true) + '<div class="card list mt">' + (bills.map(billRow).join('') || '<div class="empty small">No bills.</div>') + '</div>' });
};
A.supEdit = (el) => supForm(el.dataset.id);
function supForm(id) {
  const s = id ? byId('suppliers', id) : { type: 'Other' };
  const sh = openSheet({ title: id ? 'Edit supplier' : 'New supplier', body: '<div class="col">' + field('Name', inp('name', s.name)) + field('Type', sel('type', SUP_TYPES, s.type)) + field('Phone', inp('phone', s.phone, 'inputmode="tel"')) + field('Notes', inp('notes', s.notes)) + '</div>', foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="suSave">Save</button>' });
  $('#suSave', sh).onclick = async () => { const v = formVals(sh); if (!v.name) return toast('Enter a name', true); if (await save('suppliers', Object.assign({}, s, v, { id: id || uid('su_') }))) { closeSheet(); scheduleRender(); } };
}
A.billNew = (el) => billForm(null, el && el.dataset ? { supplierId: el.dataset.sup } : {});
function billForm(id, pre) {
  const b = id ? byId('bills', id) : Object.assign({ date: todayStr(), dueDate: KC.addDays(todayStr(), 14), currency: baseCode() }, pre || {});
  const sh = openSheet({ title: id ? 'Edit bill' : 'New bill to pay', body: '<div class="col">' + field('Supplier', supplierSelect(b.supplierId)) + '<div class="grid2 hide" id="newSup">' + field('New supplier name', inp('newSupplier', '')) + field('Type', sel('newSupplierType', SUP_TYPES, 'Other')) + '</div>' +
    field('What for', inp('description', b.description, 'placeholder="e.g. Trucking Houston → Katy, container #3"')) + '<div class="grid2">' + field('Amount', inp('amount', b.amount, 'inputmode="decimal"')) + field('Currency', sel('currency', curOptions(), b.currency)) + field('Bill date', inp('date', b.date, 'type="date"')) + field('Pay by', inp('dueDate', b.dueDate, 'type="date"')) + '</div>' +
    field('Container (optional)', sel('shipmentId', [['', '—']].concat(K.raw.shipments.map((s) => [s.id, s.name || s.containerNo])), b.shipmentId || '')) + field('Notes', inp('notes', b.notes)) + '</div>',
    foot: (id ? '<button class="btn danger" id="bDel">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="bSave">Save bill</button>' });
  $('[name=supplierId]', sh).onchange = (e) => $('#newSup', sh).classList.toggle('hide', e.target.value !== '__new');
  $('#bSave', sh).onclick = async () => { const v = formVals(sh); v.amount = num(v.amount); if (!v.amount) return toast('Enter the amount', true); const sid = await ensureSupplier(v); if (!sid) return toast('Choose or add the supplier', true); delete v.newSupplier; delete v.newSupplierType; v.supplierId = sid; if (await save('bills', Object.assign({ payments: [] }, b, v, { id: id || uid('b_'), txnId: b.txnId || (id ? KC.billTxnId(b) : KC.newTxnId('PU', v.date)) }))) { closeSheet(); scheduleRender(); toast('Bill saved'); } };
  if (id) $('#bDel', sh).onclick = async () => { if ((b.payments || []).length) { if (await confirmBox('This bill has payments. Mark it cancelled instead?', 'Cancel bill', true)) { await save('bills', Object.assign({}, b, { status: 'cancelled' })); closeSheet(); scheduleRender(); } return; } if (await confirmBox('Delete this bill?', 'Delete', true)) { await remove('bills', id); closeSheet(); scheduleRender(); } };
}
/** One line of a bill's payment list: mode, txn ID, paid-to, amount and MoMo charges as separate figures. */
function billPayRow(p, cur) {
  return '<div class="li" style="cursor:default"><div class="av">' + ic('wallet', 'sm') + '</div><div class="grow"><div class="t">' + esc(p.method || 'Cash') + '</div><div class="tiny muted">' + fmtDate(p.date) + (p.account ? ' · to ' + esc(p.account) : '') + (p.ref ? ' · txn ' + esc(p.ref) : '') + (p.by ? ' · ' + esc(p.by) : '') + (num(p.fee) > 0 ? ' · charges ' + cur(p.fee) : '') + '</div></div><div class="right"><div class="b money">' + cur(p.amount) + '</div>' + (num(p.fee) > 0 ? '<div class="tiny muted">+' + cur(p.fee) + ' fee</div>' : '') + '</div></div>';
}
A.billOpen = (el) => {
  const b = byId('bills', el.dataset.id); const x = billX(b); const cur = (v) => money(v, b.currency);
  const sh = openSheet({ title: supName(b.supplierId), body: '<div class="small muted mb">' + esc(b.description || '') + ' · billed ' + fmtDate(b.date) + ' · due ' + fmtDate(billDue(b)) + ' · txn ' + esc(x.txnId) + '</div><div class="grid3 mb">' + kpi('Amount', cur(x.amount)) + kpi('Paid', cur(x.paid), x.fees > 0 ? '+ ' + cur(x.fees) + ' MoMo charges' : '') + kpi('Still owed', cur(x.balance), '', true) + '</div>' +
    '<h3 class="mb">Payments</h3><div class="card list mb">' + ((b.payments || []).map((p) => billPayRow(p, cur)).join('') || '<div class="empty small">No payment yet.</div>') + '</div>',
    foot: '<button class="btn" data-a="billEdit" data-id="' + b.id + '">' + ic('edit') + '</button>' + (x.balance > 0.005 && b.status !== 'cancelled' ? '<button class="btn pri grow" id="bPay">' + ic('wallet') + 'Record payment</button>' : '') });
  if ($('#bPay', sh)) $('#bPay', sh).onclick = () => {
    const ps = openSheet({ title: 'Pay ' + supName(b.supplierId), body: '<div class="alert info mb">Still owed: <b class="money">' + cur(x.balance) + '</b> · bill txn ' + esc(x.txnId) + '</div>' + payFields(Math.round(x.balance * 100) / 100, { kind: 'purchase', currency: b.currency }), foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="bpGo">Save payment</button>' });
    syncPayCharges(ps);
    $('#bpGo', ps).onclick = async () => {
      const p = readPayment(formVals(ps), 'purchase'); if (p === false) return; if (!p) return toast('Enter an amount', true);
      const curB = byId('bills', b.id);
      if (p.amount > billX(curB).balance + 0.005 && !(await confirmBox('Payment is more than what is still owed. Record anyway?', 'Record'))) return;
      if (await save('bills', Object.assign({}, curB, { txnId: curB.txnId || KC.billTxnId(curB), payments: (curB.payments || []).concat([p]) }))) { closeSheet(); closeSheet(); scheduleRender(); toast('Payment recorded'); }
    };
  };
};
A.billEdit = (el) => billForm(el.dataset.id);
/** Called from purchases, container costs & assets. Creates a bill (every purchase gets a transaction ID).
 *  Pass `payment` (from readPayment(…, 'purchase')) when it was paid on the spot: the bill is then saved already paid. */
async function createBillFor({ supplierId, newSupplier, newSupplierType, description, amount, currency, date, dueDate, shipmentId, costId, assetId, payment, txnId }) {
  const sid = await ensureSupplier({ supplierId, newSupplier, newSupplierType }); if (!sid) return false;
  const bill = { id: uid('b_'), txnId: txnId || KC.newTxnId('PU', date), supplierId: sid, description, amount: num(amount), currency, date: date || todayStr(), dueDate: dueDate || KC.addDays(date || todayStr(), 14), shipmentId: shipmentId || '', costId: costId || '', payments: payment ? [payment] : [] };
  if (assetId) bill.assetId = assetId;
  return (await save('bills', bill)) ? bill : false;
}
/* ================= DEBT REMINDERS ================= */
function owingCustomers() {
  const m = {};
  K.raw.sales.forEach((s) => { const x = K.C.saleX[s.id]; if (!s.customerId || x.status === 'cancelled' || x.balance <= 0) return; const o = (m[s.customerId] = m[s.customerId] || { id: s.customerId, balance: 0, sales: [], due: null }); o.balance += x.balance; o.sales.push(s); const d = KC.dueDateOf(s, S()); if (!o.due || d < o.due) o.due = d; });
  return Object.values(m).map((o) => { const c = byId('customers', o.id) || { name: o.sales[0].customerName, phone: o.sales[0].customerPhone }; const last = K.raw.reminders.filter((r) => r.customerId === o.id).sort((a, b) => (b.at || '').localeCompare(a.at || ''))[0]; const daysLate = -daysUntil(o.due); return Object.assign(o, { c, last, daysLate, needs: (daysLate >= 0 || daysLate >= -2) && (!last || daysUntil(String(last.at).slice(0, 10)) <= -(num(S().reminderEvery) || 7)) }); });
}
function reminderText(o) {
  const st = S(); const momo = (st.momoAccounts || []).map((a) => a.method + ' ' + a.number).join(', ') || st.phone || '';
  return String(st.reminderTemplate || KC.DEFAULT_SETTINGS.reminderTemplate).replace(/\{name\}/g, o.c.name || '').replace(/\{balance\}/g, F(o.balance)).replace(/\{due\}/g, fmtDate(o.due)).replace(/\{business\}/g, st.businessName).replace(/\{momo\}/g, momo).replace(/\{receipts\}/g, o.sales.map((s) => s.no).join(', '));
}
VIEWS.reminders = {
  render() {
    const f = K.ui.remF || 'due'; const all = owingCustomers();
    const list = all.filter((o) => f === 'all' ? true : f === 'overdue' ? o.daysLate > 0 : o.needs).sort((a, b) => b.daysLate - a.daysLate || b.balance - a.balance);
    return '<div class="kpis mb">' + kpi('Customers owing', fmt(all.length), F(all.reduce((a, o) => a + o.balance, 0)), true) + kpi('Overdue', fmt(all.filter((o) => o.daysLate > 0).length), F(all.filter((o) => o.daysLate > 0).reduce((a, o) => a + o.balance, 0))) + kpi('Need a reminder today', fmt(all.filter((o) => o.needs).length)) + '</div>' +
      '<div class="alert info mb">' + ic('wa', 'sm') + '<div>Tap <b>WhatsApp</b> or <b>SMS</b> — the message is ready, you just press send. Each reminder is logged so nobody is reminded twice in ' + (num(S().reminderEvery) || 7) + ' days. Fully automatic sending runs in the full version of the app. Edit the message in Settings.</div></div>' +
      (K.info.mode === 'saas' ? '<div class="card pad mb"><div class="row between"><div><h3>Automatic reminders</h3><div class="tiny muted">Sent by the server every day at the chosen hour (provider: <b id="remProv">…</b>).</div></div>' + (can('settings') ? '<label class="toggle"><input type="checkbox" id="autoRem"' + (S().autoReminders ? ' checked' : '') + '>On</label>' : '') + '</div>' + (can('settings') ? '<div class="row wrap mt"><span class="small">Send at</span><select class="inp" style="width:auto" id="remHour">' + Array.from({ length: 15 }, (_, i) => i + 7).map((h) => '<option value="' + h + '"' + (num(S().reminderHour ?? 9) === h ? ' selected' : '') + '>' + h + ':00</option>').join('') + '</select><button class="btn sm" data-a="remRun" data-dry="1">Preview</button><button class="btn sm pri" data-a="remRun">Send now</button></div>' : '') + '</div>' : '') +
      '<div class="chips mb">' + [['due', 'To remind today'], ['overdue', 'Overdue'], ['all', 'Everyone owing']].map(([k, l]) => '<button class="chip' + (f === k ? ' on' : '') + '" data-a="remF" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      remTable(list);
  },
};
A.remF = (el) => { K.ui.remF = el.dataset.v; render(true); };
document.addEventListener('click', (e) => { const a = e.target.closest('[data-a2="remLog"]'); if (!a) return; const bal = num(a.dataset.bal); setTimeout(() => save('reminders', { id: uid('rm_'), customerId: a.dataset.c, channel: a.dataset.ch, balance: bal, at: new Date().toISOString(), by: K.me.name || '', auto: false }).then(() => scheduleRender()), 300); }, true);
A.remCopy = async (el) => { const o = owingCustomers().find((x) => x.id === el.dataset.c); await copyText(reminderText(o)); await save('reminders', { id: uid('rm_'), customerId: o.id, channel: 'copied', balance: Math.round(o.balance), at: new Date().toISOString(), by: K.me.name || '' }); };

/* ================= LOCATIONS (settings card) ================= */
function locationsCard() {
  return '<div class="card pad2 mb"><h2 class="mb">Branches & warehouses</h2><div class="tiny muted mb">Each branch keeps its own stock. Move stock with Branch transfers. Staff can be tied to one branch in Team & access.</div><div class="card list mb">' +
    allLocs().map((l) => '<div class="li" data-a="locEdit" data-id="' + l.id + '"><div class="av">' + ic('home', 'sm') + '</div><div class="grow"><div class="t">' + esc(l.name) + '</div><div class="tiny muted">' + (l.id === 'main' ? 'Main location — containers unload here by default' : esc(l.type || 'Shop') + (l.address ? ' · ' + esc(l.address) : '')) + '</div></div>' + ic('edit', 'sm') + '</div>').join('') + '</div><button class="btn" data-a="locEdit">' + ic('plus') + 'Add branch</button></div>';
}
A.locEdit = (el) => {
  const id = el.dataset.id; const isMain = id === 'main'; const l = isMain ? { name: S().mainLocationName || 'Main warehouse' } : id ? byId('locations', id) : { type: 'Shop' };
  const sh = openSheet({ title: id ? 'Edit branch' : 'New branch', body: '<div class="col">' + field('Name', inp('name', l.name, 'placeholder="e.g. Akwa shop"')) + (isMain ? '' : field('Type', sel('type', ['Shop', 'Warehouse', 'Market stall', 'Depot'], l.type)) + field('Address', inp('address', l.address))) + '</div>', foot: (id && !isMain ? '<button class="btn danger" id="lcArch">Archive</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="lcSave">Save</button>' });
  $('#lcSave', sh).onclick = async () => { const v = formVals(sh); if (!v.name) return toast('Enter a name', true); const ok = isMain ? await saveSettings({ mainLocationName: v.name }) : await save('locations', Object.assign({}, l, v, { id: id || uid('loc_') })); if (ok) { closeSheet(); render(true); } };
  if ($('#lcArch', sh)) $('#lcArch', sh).onclick = async () => { const st = K.raw.products.reduce((a, p) => a + Math.max(0, (K.C.prodX[p.id].byLoc || {})[id] || 0), 0); if (st > 0) return toast('Move its ' + st + ' unit(s) of stock first', true); await save('locations', Object.assign({}, l, { archived: true })); closeSheet(); render(true); };
};

VIEWS.reminders.after = () => {
  if (K.info.mode !== 'saas') return;
  K.store.req('GET', '/api/reminders/provider').then((r) => { const el = $('#remProv'); if (el) el.textContent = r.provider === 'console' ? 'not set up yet — ask your developer' : r.provider; }).catch(() => { });
  const a = $('#autoRem'), h = $('#remHour');
  if (a) a.onchange = () => saveSettings({ autoReminders: a.checked }).then(() => toast(a.checked ? 'Automatic reminders on' : 'Automatic reminders off'));
  if (h) h.onchange = () => saveSettings({ reminderHour: num(h.value) });
};
A.remRun = async (el) => {
  const dry = !!el.dataset.dry;
  if (!dry && !(await confirmBox('Send reminders now to everyone who is due?', 'Send'))) return;
  try {
    const r = await K.store.req('POST', '/api/reminders/run', { dryRun: dry });
    openSheet({ title: dry ? 'Would send ' + r.count + ' reminder(s)' : 'Sent ' + r.sent + ', failed ' + r.failed, body: '<div class="card list">' + (r.items.map((i) => '<div class="li" style="cursor:default"><div class="grow"><div class="t">' + esc(i.name) + ' · ' + esc(i.phone || '') + '</div><div class="tiny muted">' + esc(i.text) + '</div>' + (i.error ? '<div class="tiny" style="color:var(--bad)">' + esc(i.error) + '</div>' : '') + '</div>' + (i.status ? '<span class="badge ' + (i.status === 'sent' ? 'ok' : 'bad') + '">' + i.status + '</span>' : '') + '</div>').join('') || '<div class="empty small">Nobody is due a reminder.</div>') + '</div>' });
    if (!dry) scheduleRender();
  } catch (e) { toast(e.message, true); }
};

/* ================= STOCK COUNT (INVENTORY AUDIT) ================= */
VIEWS.audit = {
  render() {
    const list = K.raw.audits.slice().sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    const open = list.find((a) => a.status === 'draft' && a.locationId === K.loc);
    return '<div class="alert info mb">Count everything on the shelves at <b>' + esc(locName(K.loc)) + '</b>. The app compares your count with what it expects and shows the difference in quantity and money. A manager then approves the differences.</div>' +
      '<div class="row wrap mb">' + (open ? '<button class="btn pri" data-a="auditGo" data-id="' + open.id + '">' + ic('check') + 'Continue counting (' + Object.keys(open.counts || {}).length + ' counted)</button>' : '<button class="btn pri" data-a="auditNew">' + ic('plus') + 'Start a stock count</button>') + '</div>' +
      '<h2 class="mb">Counts</h2>' + auditTable(list);
  },
};
function auditSummary(a) {
  const lines = a.lines || Object.entries(a.counts || {}).map(([pid, c]) => ({ productId: pid, counted: c, system: null }));
  let diffQty = 0, diffValue = 0, short = 0, over = 0;
  lines.forEach((l) => { if (l.system === null || l.system === undefined) return; const d = num(l.counted) - num(l.system); diffQty += d; const v = d * num(l.unitCost); diffValue += v; if (d < 0) short += -v; else over += v; });
  return { counted: lines.length, diffQty, diffValue, short, over, lines };
}
const sysAt = (pid, loc) => { const x = K.C.prodX[pid]; return x ? Math.max(0, x.byLoc[loc] || 0) : 0; };
A.auditNew = () => {
  const cats = Array.from(new Set(K.raw.products.map((p) => p.category).filter(Boolean))).sort();
  const sh = openSheet({ title: 'New stock count · ' + locName(K.loc), body: '<div class="col">' + field('What to count', sel('category', [['', 'Everything at this branch']].concat(cats.map((c) => [c, c])), '')) + '<label class="toggle"><input type="checkbox" name="blind" checked>Blind count (hide the expected quantity while counting — recommended)</label></div>', foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="auGo">Start</button>' });
  $('#auGo', sh).onclick = async () => { const v = formVals(sh); const a = { id: uid('au_'), locationId: K.loc, category: v.category, blind: v.blind, status: 'draft', counts: {}, startedAt: new Date().toISOString(), by: K.me.name || '', byId: K.me.id || '' }; if (await save('audits', a)) { closeSheet(); openAudit(a.id); } };
};
A.auditGo = (el) => openAudit(el.dataset.id);
function openAudit(id) {
  const sh = openSheet({ title: 'Stock count', wide: true, body: '' });
  sh._q = '';
  sh._refresh = () => {
    const a = byId('audits', id); if (!a) return closeSheet();
    $('.sh h2', sh).textContent = 'Stock count · ' + locName(a.locationId);
    if (a.status !== 'draft') return drawAuditResult(sh, a);
    const prods = K.raw.products.filter((p) => !p.archived && (!a.category || p.category === a.category) && (sysAt(p.id, a.locationId) > 0 || (a.counts || {})[p.id] !== undefined)).sort((x, y) => x.name.localeCompare(y.name));
    const shown = prods.filter((p) => !sh._q || (p.name + ' ' + (p.barcode || '')).toLowerCase().includes(sh._q.toLowerCase()));
    const done = Object.keys(a.counts || {}).length;
    setSheetBody(sh, '<div class="row between mb"><span class="small"><b>' + done + '</b> of ' + prods.length + ' counted' + (a.blind ? ' · blind count' : '') + '</span><div class="bar grow" style="max-width:200px"><i style="width:' + (prods.length ? done / prods.length * 100 : 0) + '%"></i></div></div>' +
      '<div class="search mb">' + ic('search') + '<input class="inp" id="auQ" placeholder="Search or scan barcode" value="' + esc(sh._q) + '"></div>' +
      '<div class="card list">' + shown.map((p) => { const c = (a.counts || {})[p.id]; const sys = sysAt(p.id, a.locationId); return '<div class="li" style="cursor:default">' + thumb(p, 40, 10) + '<div class="grow" style="min-width:0"><div class="t ellipsis">' + esc(p.name) + '</div><div class="tiny muted">' + (a.blind && !can('stockEdit') ? 'Count it' : 'Expected ' + sys) + (c !== undefined && (!a.blind || can('stockEdit')) && num(c) !== sys ? ' · <b style="color:' + (num(c) < sys ? 'var(--bad)' : 'var(--warn)') + '">' + (num(c) - sys > 0 ? '+' : '') + (num(c) - sys) + '</b>' : '') + '</div></div><input class="inp" style="width:84px;' + (c !== undefined ? 'border-color:var(--ok)' : '') + '" inputmode="numeric" data-cnt="' + p.id + '" value="' + (c ?? '') + '" placeholder="—"></div>'; }).join('') + '</div>' +
      '<div class="tiny muted mt">Items you leave empty are not counted. Your count is saved as you type, so you can stop and continue later.</div>');
    const q = $('#auQ', sh); q.oninput = () => { clearTimeout(sh._t); sh._t = setTimeout(() => { sh._q = q.value; sh._refresh(); const qq = $('#auQ', sh); qq.focus(); qq.setSelectionRange(qq.value.length, qq.value.length); }, 300); };
    q.onkeydown = (e) => { if (e.key === 'Enter') { const p = K.raw.products.find((x) => x.barcode && x.barcode === q.value.trim()); if (p) { const cur = JSON.parse(JSON.stringify(byId('audits', id))); cur.counts[p.id] = num(cur.counts[p.id]) + 1; save('audits', cur).then(() => { sh._q = ''; sh._refresh(); toast(p.name + ': ' + cur.counts[p.id]); }); } } };
    $$('[data-cnt]', sh).forEach((i) => (i.onchange = async () => { const cur = JSON.parse(JSON.stringify(byId('audits', id))); if (i.value === '') delete cur.counts[i.dataset.cnt]; else cur.counts[i.dataset.cnt] = Math.max(0, Math.floor(num(i.value))); await save('audits', cur); i.style.borderColor = i.value === '' ? '' : 'var(--ok)'; }));
  };
  sh.querySelector('.sheet').insertAdjacentHTML('beforeend', '<div class="sf"><button class="btn grow" data-a="sheetClose">Save & close</button><button class="btn pri grow" id="auSubmit">' + ic('check') + 'Finish count</button></div>');
  $('#auSubmit', sh).onclick = async () => {
    const a = byId('audits', id); if (a.status !== 'draft') return closeSheet();
    const n = Object.keys(a.counts || {}).length; if (!n) return toast('Count at least one item', true);
    if (!(await confirmBox('Finish the count of ' + n + ' item(s)? Expected quantities are frozen now.', 'Finish'))) return;
    const lines = Object.entries(a.counts).map(([pid, c]) => ({ productId: pid, name: (byId('products', pid) || {}).name, counted: num(c), system: sysAt(pid, a.locationId), unitCost: Math.round((K.C.prodX[pid] || {}).avgCost || 0) }));
    await save('audits', Object.assign({}, a, { status: 'submitted', lines, submittedAt: new Date().toISOString(), submittedBy: K.me.name || '' }));
    sh._refresh();
  };
  sh._refresh();
}
function drawAuditResult(sh, a) {
  const s = auditSummary(a); const diffs = s.lines.filter((l) => num(l.counted) !== num(l.system));
  const f = $('.sf', sh); if (f) f.innerHTML = a.status === 'submitted' && can('stockEdit') ? '<button class="btn grow" data-a="sheetClose">Close</button><button class="btn pri grow" id="auApply">' + ic('check') + 'Approve & update stock</button>' : '<button class="btn grow" data-a="sheetClose">Close</button>';
  setSheetBody(sh, '<div class="kpis mb">' + kpi('Items counted', fmt(s.counted), diffs.length + ' with a difference', true) + kpi('Units', (s.diffQty > 0 ? '+' : '') + fmt(s.diffQty), 'counted minus expected') + (seeCost() ? kpi('Missing (value)', F(s.short), 'at cost') + kpi('Extra found', F(s.over)) : '') + '</div>' +
    (a.status === 'applied' ? '<div class="alert info mb">Approved by ' + esc(a.appliedBy || '') + ' on ' + fmtDT(a.appliedAt) + '. Stock was updated; differences show in Reports → Losses.</div>' : a.status === 'submitted' ? '<div class="alert mb">' + (can('stockEdit') ? 'Check the differences, then approve to correct the stock.' : 'Waiting for a manager to approve.') + '</div>' : '') +
    '<div class="card tw"><table class="t"><thead><tr><th>Item</th><th class="r">Expected</th><th class="r">Counted</th><th class="r">Difference</th>' + (seeCost() ? '<th class="r">Value</th>' : '') + '</tr></thead><tbody>' +
    s.lines.slice().sort((x, y) => (num(x.counted) - num(x.system)) - (num(y.counted) - num(y.system))).map((l) => { const d = num(l.counted) - num(l.system); return '<tr><td>' + esc(l.name || (byId('products', l.productId) || {}).name) + '</td><td class="r">' + l.system + '</td><td class="r">' + l.counted + '</td><td class="r b" style="color:' + (d < 0 ? 'var(--bad)' : d > 0 ? 'var(--warn)' : 'var(--ok)') + '">' + (d > 0 ? '+' : '') + d + '</td>' + (seeCost() ? '<td class="r money">' + fmt(d * num(l.unitCost)) + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>' +
    (a.status === 'submitted' && can('stockEdit') ? field('Reason for missing stock', sel('auReason', ['Stock count difference', 'Missing / theft', 'Unaccounted for', 'Damaged', 'Expired'], 'Stock count difference', 'id="auReason"'), 'mt') : ''));
  if ($('#auApply', sh)) $('#auApply', sh).onclick = async (e) => {
    e.target.disabled = true; const reason = $('#auReason', sh).value; let n = 0;
    for (const l of diffs) {
      let d = num(l.counted) - num(l.system); const x = K.C.prodX[l.productId]; if (!x) continue;
      const lots = x.lotIds.map((lid) => byId('lots', lid)).filter((lt) => lt && !lt.reservedFor && K.C.lotX[lt.id].stage === 'warehouse').sort((p1, p2) => (p2.purchaseDate || '').localeCompare(p1.purchaseDate || ''));
      if (!lots.length) continue;
      if (d > 0) { await save('adjustments', { id: uid('a_'), date: todayStr(), productId: l.productId, lotId: lots[0].id, qty: d, locationId: a.locationId, reason: 'Found / extra', notes: 'Stock count ' + fmtDate(a.startedAt.slice(0, 10)), byId: K.me.id || '', by: K.me.name || '' }); n++; continue; }
      for (const lt of lots) { if (d >= 0) break; const av = Math.max(0, K.C.lotX[lt.id].byLoc[a.locationId] || 0); const take = Math.min(av, -d); if (take > 0) { await save('adjustments', { id: uid('a_'), date: todayStr(), productId: l.productId, lotId: lt.id, qty: -take, locationId: a.locationId, reason: d < 0 ? reason : 'Found / extra', notes: 'Stock count ' + fmtDate(a.startedAt.slice(0, 10)), byId: K.me.id || '', by: K.me.name || '' }); d += take; n++; } }
    }
    await save('audits', Object.assign({}, byId('audits', a.id), { status: 'applied', appliedAt: new Date().toISOString(), appliedBy: K.me.name || '', adjustments: n }));
    toast('Stock updated (' + n + ' correction(s))'); sh._refresh(); scheduleRender();
  };
}

/* ---------- tables: cash handover, bills, suppliers, reminders ---------- */
function hoTable(rows, d) {
  const decl = (r) => r.ho ? sumObj(r.ho.declared) + num(r.ho.payouts) : null;
  const diff = (r) => r.ho ? decl(r) - r.exp.total : null;
  const modes = [...new Set(['Cash'].concat(...rows.map((r) => Object.keys(r.exp.by))))];
  return dataTable({
    id: 'hoList', rows, noun: 'person', empty: 'No payments recorded on this day.',
    rowAttr: (r) => ' data-a="hoReview" data-u="' + esc(r.id) + '" data-d="' + d + '"',
    cols: [
      { k: 'name', label: 'Person', core: true, v: (r) => r.name, html: (r) => '<b>' + esc(r.name) + '</b>' },
      ...modes.map((m) => ({ k: 'm_' + m, label: m, money: true, v: (r) => r.exp.by[m] || '', total: (rs) => fmt(dtSum(rs, (r) => r.exp.by[m] || 0)) })),
      { k: 'coll', label: 'Collected', core: true, money: true, cls: 'b', v: (r) => r.exp.total, total: (rs) => fmt(dtSum(rs, (r) => r.exp.total)) },
      { k: 'fees', label: 'MoMo charges', money: true, v: (r) => r.exp.fees || '' },
      { k: 'out', label: 'Paid out', core: true, money: true, v: (r) => r.ho ? num(r.ho.payouts) : '' },
      { k: 'handed', label: 'Handed over', core: true, money: true, v: (r) => r.ho ? sumObj(r.ho.declared) : '', total: (rs) => fmt(dtSum(rs, (r) => r.ho ? sumObj(r.ho.declared) : 0)) },
      { k: 'diff', label: 'Difference', core: true, money: true, v: (r) => r.ho ? Math.round(diff(r)) : '', html: (r) => !r.ho ? dtNil : '<span style="font-weight:700;color:' + (Math.abs(diff(r)) < 1 ? 'var(--ok)' : diff(r) < 0 ? 'var(--bad)' : 'var(--warn)') + '">' + (Math.abs(diff(r)) < 1 ? 'Balanced' : fmt(diff(r))) + '</span>' },
      { k: 'status', label: 'Status', core: true, v: (r) => r.ho ? r.ho.status : 'pending', html: (r) => r.ho ? hoBadge(r.ho) : '<span class="badge warn">Pending</span>' },
      { k: 'at', label: 'Submitted', v: (r) => r.ho ? r.ho.submittedAt || '' : '', html: (r) => r.ho && r.ho.submittedAt ? esc(fmtDT(r.ho.submittedAt)) : dtNil },
      { k: 'conf', label: 'Confirmed by', v: (r) => r.ho ? r.ho.confirmedBy || '' : '', cls: 'mut' },
    ],
  });
}
const billStatus = (b) => { const x = billX(b); const od = x.balance > 0.005 && billDue(b) < todayStr() && b.status !== 'cancelled'; return b.status === 'cancelled' ? ['cancelled', '<span class="badge">Cancelled</span>'] : x.status === 'paid' ? ['paid', '<span class="badge ok">Paid</span>'] : od ? ['overdue', '<span class="badge bad">Overdue</span>'] : x.status === 'partial' ? ['partial', '<span class="badge warn">Part paid</span>'] : ['unpaid', '<span class="badge">Unpaid</span>']; };
function billsTable(list, empty) {
  const owed = (b) => b.status !== 'cancelled' && billX(b).balance > 0.005 ? billX(b).balance : 0;
  const pays = (b) => (b.payments || []).filter((p) => num(p.amount) > 0);
  return dataTable({
    id: 'billList', rows: list, noun: 'bill', empty: empty || 'No bills yet.',
    rowAttr: (b) => ' data-a="billOpen" data-id="' + b.id + '"', rowClass: (b) => b.status === 'cancelled' ? 'cx' : '',
    cols: [
      { k: 'sup', label: 'Supplier', core: true, v: (b) => supName(b.supplierId), html: (b) => '<b>' + esc(supName(b.supplierId)) + '</b>' },
      { k: 'txn', label: 'Transaction ID', v: (b) => KC.billTxnId(b), cls: 'mut' },
      { k: 'desc', label: 'What for', core: true, v: (b) => b.description || '' },
      { k: 'date', label: 'Bill date', v: (b) => b.date, html: (b) => dtDate(b.date) },
      { k: 'due', label: 'Pay by', core: true, v: (b) => billDue(b), html: (b) => dtDate(billDue(b)) },
      { k: 'cur', label: 'Currency', v: (b) => b.currency || baseCode(), cls: 'mut' },
      { k: 'amt', label: 'Amount', core: true, money: true, cls: 'b', v: (b) => num(b.amount), html: (b) => money(b.amount, b.currency) },
      { k: 'paid', label: 'Paid', core: true, money: true, v: (b) => billX(b).paid, html: (b) => money(billX(b).paid, b.currency) },
      { k: 'fees', label: 'MoMo charges', money: true, v: (b) => billX(b).fees || '', html: (b) => billX(b).fees > 0 ? money(billX(b).fees, b.currency) : dtNil },
      { k: 'owed', label: 'Owed', core: true, money: true, v: (b) => owed(b) || '', html: (b) => owed(b) ? '<span style="color:var(--bad);font-weight:700">' + money(owed(b), b.currency) + '</span>' : dtNil },
      { k: 'owedx', label: 'Owed (' + baseCode() + ')', money: true, v: (b) => owed(b) ? Math.round(billX(b).balanceX) : '', total: (rows) => fmt(dtSum(rows, (b) => owed(b) ? billX(b).balanceX : 0)) },
      { k: 'mode', label: 'Payment mode', v: (b) => [...new Set(pays(b).map((p) => p.method))].join(', ') },
      { k: 'last', label: 'Last payment', v: (b) => (pays(b).slice(-1)[0] || {}).date || '', html: (b) => dtDate((pays(b).slice(-1)[0] || {}).date) },
      { k: 'ship', label: 'Container', v: (b) => b.shipmentId ? (byId('shipments', b.shipmentId) || {}).name || '' : '', cls: 'mut' },
      { k: 'status', label: 'Status', core: true, v: (b) => billStatus(b)[0], html: (b) => billStatus(b)[1] },
    ],
  });
}
function supTable() {
  const bills = (s) => K.raw.bills.filter((b) => b.supplierId === s.id && b.status !== 'cancelled');
  return dataTable({
    id: 'supList', rows: K.raw.suppliers.slice().sort((a, b) => supplierOwed(b.id) - supplierOwed(a.id)), noun: 'supplier', empty: 'No suppliers yet.',
    rowAttr: (s) => ' data-a="supOpen" data-id="' + s.id + '"',
    cols: [
      { k: 'name', label: 'Supplier', core: true, v: (s) => s.name, html: (s) => '<b>' + esc(s.name) + '</b>' },
      { k: 'type', label: 'Type', core: true, v: (s) => s.type || '' },
      { k: 'phone', label: 'Phone', core: true, v: (s) => s.phone || '' },
      { k: 'n', label: 'Bills', core: true, num: true, v: (s) => bills(s).length },
      { k: 'open', label: 'Open bills', core: true, num: true, v: (s) => bills(s).filter((b) => billX(b).balance > 0.005).length },
      { k: 'owed', label: 'You owe', core: true, money: true, v: (s) => supplierOwed(s.id) || '', html: (s) => supplierOwed(s.id) > 0 ? '<span style="color:var(--bad);font-weight:700">' + fmt(supplierOwed(s.id)) + '</span>' : dtNil, total: (rows) => fmt(dtSum(rows, (s) => supplierOwed(s.id))) },
      { k: 'notes', label: 'Notes', v: (s) => s.notes || '', cls: 'mut' },
    ],
  });
}
function remTable(list) {
  const act = (o) => { const wa = phoneWA(o.c.whatsapp || o.c.phone); const txt = reminderText(o); return '<div class="act">' +
    (wa ? '<a class="btn sm" style="background:#25D366;border-color:#25D366;color:#fff" target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent(txt) + '" data-a2="remLog" data-c="' + o.id + '" data-ch="whatsapp" data-bal="' + Math.round(o.balance) + '">' + ic('wa', 'sm') + 'WhatsApp</a>' : '') +
    (o.c.phone ? '<a class="btn sm" href="sms:' + esc(String(o.c.phone).replace(/\s/g, '')) + '?body=' + encodeURIComponent(txt) + '" data-a2="remLog" data-c="' + o.id + '" data-ch="sms" data-bal="' + Math.round(o.balance) + '">SMS</a>' : '') +
    '<button class="btn sm" data-a="remCopy" data-c="' + o.id + '" title="Copy message">' + ic('copy', 'sm') + '</button></div>'; };
  return dataTable({
    id: 'remList', rows: list, noun: 'customer', empty: '<div class="big">🎉</div>Nobody to remind.',
    cols: [
      { k: 'name', label: 'Customer', core: true, v: (o) => o.c.name, html: (o) => '<b>' + esc(o.c.name) + '</b>' },
      { k: 'phone', label: 'Phone', core: true, v: (o) => o.c.phone || '' },
      { k: 'bal', label: 'Owes', core: true, money: true, v: (o) => o.balance, html: (o) => '<span style="color:var(--bad);font-weight:700">' + fmt(o.balance) + '</span>', total: (rows) => fmt(dtSum(rows, (o) => o.balance)) },
      { k: 'n', label: 'Sales', num: true, v: (o) => o.sales.length },
      { k: 'rc', label: 'Receipts', wrap: true, v: (o) => o.sales.map((s) => s.no).join(', '), cls: 'mut' },
      { k: 'due', label: 'Due', core: true, v: (o) => o.due, html: (o) => dtDate(o.due) },
      { k: 'late', label: 'Days late', core: true, num: true, v: (o) => o.daysLate > 0 ? o.daysLate : '', html: (o) => o.daysLate > 0 ? '<span class="badge bad">' + o.daysLate + ' days</span>' : dtNil },
      { k: 'last', label: 'Last reminded', core: true, v: (o) => o.last ? o.last.at : '', html: (o) => o.last ? esc(fmtDT(o.last.at)) : '<span class="mut">Never</span>' },
      { k: 'ch', label: 'Channel', v: (o) => o.last ? o.last.channel || '' : '', cls: 'mut' },
      { k: 'by', label: 'Reminded by', v: (o) => o.last ? o.last.by || (o.last.auto ? 'Automatic' : '') : '', cls: 'mut' },
      { k: 'act', label: 'Send reminder', core: true, cls: 'actc', v: () => '', html: act },
    ],
  });
}

function auditTable(list) {
  const S_ = (a) => auditSummary(a); const cost = seeCost();
  const ST = { draft: '<span class="badge info">Counting</span>', submitted: '<span class="badge warn">To approve</span>', applied: '<span class="badge ok">Applied</span>' };
  return dataTable({
    id: 'auditList', rows: list, noun: 'count', empty: 'No counts yet.',
    rowAttr: (a) => ' data-a="auditGo" data-id="' + a.id + '"',
    cols: [
      { k: 'at', label: 'Started', core: true, v: (a) => a.startedAt || '', html: (a) => esc(fmtDT(a.startedAt)) },
      { k: 'loc', label: 'Branch', core: true, v: (a) => locName(a.locationId), html: (a) => '<b>' + esc(locName(a.locationId)) + '</b>' },
      { k: 'cat', label: 'Category', core: true, v: (a) => a.category || 'Everything' },
      { k: 'n', label: 'Items counted', core: true, num: true, v: (a) => S_(a).counted },
      { k: 'dq', label: 'Difference (units)', core: true, num: true, v: (a) => S_(a).diffQty || '', html: (a) => S_(a).diffQty ? '<span style="font-weight:700;color:' + (S_(a).diffQty < 0 ? 'var(--bad)' : 'var(--ok)') + '">' + (S_(a).diffQty > 0 ? '+' : '') + fmt(S_(a).diffQty) + '</span>' : dtNil },
      cost ? { k: 'dv', label: 'Difference (value)', money: true, v: (a) => Math.round(S_(a).diffValue) || '', html: (a) => S_(a).diffValue ? '<span style="font-weight:700;color:' + (S_(a).diffValue < 0 ? 'var(--bad)' : 'var(--ok)') + '">' + fmt(S_(a).diffValue) + '</span>' : dtNil } : null,
      cost ? { k: 'short', label: 'Missing (value)', money: true, v: (a) => Math.round(S_(a).short) || '' } : null,
      { k: 'status', label: 'Status', core: true, v: (a) => a.status || '', html: (a) => ST[a.status] || '' },
      { k: 'by', label: 'Counted by', core: true, v: (a) => a.by || '', cls: 'mut' },
    ],
  });
}
