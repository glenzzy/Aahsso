/* Kargo — dashboard, customers, reports, expenses, settings, backup */

/* ---------- metrics helpers ---------- */
function periodStats(pred) {
  const src = K.route === 'reports' && K.ui.repLoc ? repSales() : visibleSales();
  const live = src.filter((s) => pred(saleDate(s)) && K.C.saleX[s.id].status !== 'cancelled');
  const r = { n: live.length, revenue: 0, cogs: 0, profit: 0, items: 0, collected: 0, byMethod: {}, owed: 0 };
  live.forEach((s) => { const x = K.C.saleX[s.id]; r.revenue += x.net; r.cogs += x.cogs; r.profit += x.profit; r.owed += Math.max(0, x.balance); (s.lines || []).forEach((l) => (r.items += num(l.qty))); });
  src.forEach((s) => (s.payments || []).forEach((p) => { if (pred(p.date)) { r.collected += num(p.amount); r.byMethod[p.method] = (r.byMethod[p.method] || 0) + num(p.amount); } }));
  return r;
}
const receivables = () => visibleSales().reduce((a, s) => { const x = K.C.saleX[s.id]; return a + (x.status !== 'cancelled' ? Math.max(0, x.balance) : 0); }, 0);

/* ---------- dashboard ---------- */
VIEWS.home = {
  render() {
    const t = todayStr(), m = monthStr();
    const d = periodStats((x) => x === t), mo = periodStats((x) => (x || '').slice(0, 7) === m);
    const w = num(S().expiryWarnDays) || 60, low = num(S().lowStock) || 3;
    const exp = K.raw.lots.filter((l) => { const x = K.C.lotX[l.id]; return x.stage === 'warehouse' && x.available > 0 && l.expiry && daysUntil(l.expiry) <= w; });
    const expired = exp.filter((l) => daysUntil(l.expiry) < 0);
    const lowP = K.raw.products.filter((p) => !p.archived && K.C.prodX[p.id].available > 0 && K.C.prodX[p.id].available <= low);
    const pick = visibleSales().filter((s) => !s.delivered && K.C.saleX[s.id].status !== 'cancelled');
    const ships = K.raw.shipments.filter((s) => stIdx(s.status) < 5);
    const stock = K.raw.products.reduce((a, p) => a + K.C.prodX[p.id].stockValue, 0);
    const recent = visibleSales().slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 6);
    const empty = !K.raw.products.length && can('purchases');
    return (empty ? '<div class="card pad2 mb"><h2>Welcome 👋</h2><p class="muted">Set up in 4 steps:</p><div class="list card">' +
      [['settings', '1. Add your business name, logo & MoMo numbers'], ['containers', '2. Create your container'], ['buy', '3. Record purchases (or import a B-Stock manifest)'], ['sell', '4. Start selling']].map(([r, l]) => '<div class="li" data-a="go" data-r="' + r + '"><div class="grow t">' + l + '</div>' + ic('chev', 'sm') + '</div>').join('') + '</div></div>' : '') +
      '<div class="row between mb"><div><div class="tiny muted">' + fmtDate(t) + (can('salesAll') ? '' : ' · your sales') + '</div><h1>' + (K.me.name ? 'Hello, ' + esc(K.me.name.split(' ')[0]) : 'Today') + '</h1></div>' + (can('sell') ? '<a class="btn pri lg desk-only" href="#sell">' + ic('sell') + 'New sale</a>' : '') + '</div>' +
      '<div class="kpis">' + kpi('Sales today', F(d.revenue), d.n + ' receipt(s) · ' + d.items + ' items', true) + kpi('Money collected', F(d.collected), Object.entries(d.byMethod).map(([k, v]) => k + ' ' + fmt(v)).join(' · ') || '—') +
      (seeCost() ? kpi('Profit today', F(d.profit), d.revenue ? pct(d.profit / d.revenue * 100) + ' margin' : '') + kpi('This month', F(mo.revenue), 'profit ' + fmt(mo.profit)) : kpi('This month', F(mo.revenue)) + kpi('Owed to you', F(receivables()))) + '</div>' +
      (seeCost() ? '<div class="kpis mt">' + kpi('Owed to you', F(receivables()), visibleSales().filter((s) => ['partial', 'unpaid'].includes(K.C.saleX[s.id].status)).length + ' open sale(s)') + kpi('Stock value (cost)', F(stock)) + kpi('Month collected', F(mo.collected)) + (can('suppliers') ? kpi('You owe suppliers', F(totalOwedSuppliers())) : kpi('Containers active', fmt(ships.length))) + '</div>' : '') +
      (() => { const extra = []; if (can('reminders')) { const od = owingCustomers().filter((o) => o.daysLate > 0); if (od.length) extra.push('<div class="alert bad" data-a="go" data-r="reminders" style="cursor:pointer">' + ic('wa', 'sm') + '<div><b>' + od.length + ' customer(s) overdue</b> — ' + F(od.reduce((a, o) => a + o.balance, 0)) + '. Send reminders.</div></div>'); }
        if (can('stockView') || can('stockEdit')) { const ov = K.raw.products.filter((p) => (K.C.prodX[p.id] || {}).oversold > 0); if (ov.length) extra.push('<div class="alert bad" data-a="goStock" data-f="problems" style="cursor:pointer">' + ic('alert', 'sm') + '<div><b>' + ov.length + ' item(s) oversold</b> (sold more than in stock): ' + esc(ov.slice(0, 3).map((p) => p.name).join(', ')) + '. Check the sales and do a stock count.</div></div>'); }
        if (can('handover')) { const pend = K.raw.handovers.filter((h) => h.status === 'submitted'); if (pend.length) extra.push('<div class="alert info" data-a="go" data-r="cash" style="cursor:pointer">' + ic('wallet', 'sm') + '<div><b>' + pend.length + ' cash handover(s)</b> waiting for you to confirm.</div></div>'); }
        if (can('suppliers')) { const od = K.raw.bills.filter((b) => b.status !== 'cancelled' && billX(b).balance > 0.005 && billDue(b) < todayStr()); if (od.length) extra.push('<div class="alert" data-a="go" data-r="suppliers" style="cursor:pointer">' + ic('buy', 'sm') + '<div><b>' + od.length + ' supplier bill(s) overdue</b> — ' + F(od.reduce((a, b) => a + billX(b).balanceX, 0)) + '.</div></div>'); }
        if (can('assets')) { const due = K.raw.assets.filter((a) => assetDue(a).length); if (due.length) extra.push('<div class="alert" data-a="go" data-r="assets" style="cursor:pointer">' + ic('truck', 'sm') + '<div><b>' + due.length + ' asset reminder(s)</b> — ' + esc(due.slice(0, 2).map((a) => a.name + ': ' + dueText(assetDue(a)[0])).join('; ')) + '.</div></div>'); }
        if (can('payments') && !byId('handovers', hoId(todayStr(), K.me.id)) && KC.collectedBy(K.raw, K.me.id, todayStr()).total) extra.push('<div class="alert info" data-a="go" data-r="cash" style="cursor:pointer">' + ic('wallet', 'sm') + '<div>You collected <b>' + F(KC.collectedBy(K.raw, K.me.id, todayStr()).total) + '</b> today. Close your day when you finish.</div></div>');
        return extra.length ? '<div class="sec"><div class="col">' + extra.join('') + '</div></div>' : ''; })() +
      ((expired.length || exp.length || lowP.length || pick.length) ? '<div class="sec"><div class="sech"><h2>Needs attention</h2></div><div class="col">' +
        (expired.length ? '<div class="alert bad" data-a="goStock" data-f="expiring" style="cursor:pointer">' + ic('alert', 'sm') + '<div><b>' + expired.length + ' batch(es) expired</b> — remove from sale or discount.</div></div>' : '') +
        (exp.length - expired.length > 0 ? '<div class="alert" data-a="goStock" data-f="expiring" style="cursor:pointer">' + ic('clock', 'sm') + '<div><b>' + (exp.length - expired.length) + ' batch(es) expire within ' + w + ' days.</b> Sell these first.</div></div>' : '') +
        (lowP.length ? '<div class="alert info" data-a="goStock" data-f="low" style="cursor:pointer">' + ic('stock', 'sm') + '<div><b>' + lowP.length + ' item(s) low</b> (≤' + low + ' left): ' + esc(lowP.slice(0, 4).map((p) => p.name).join(', ')) + (lowP.length > 4 ? '…' : '') + '</div></div>' : '') +
        (pick.length ? '<div class="alert info" data-a="goSales" data-f="pickup" style="cursor:pointer">' + ic('clock', 'sm') + '<div><b>' + pick.length + ' reserved order(s)</b> waiting for pickup.</div></div>' : '') + '</div></div>' : '') +
      ((can('containers') || can('purchases')) && K.raw.lots.length ? journeyCard() : '') +
      (ships.length && can('containers') ? '<div class="sec"><div class="sech"><h2>Containers</h2><a href="#containers" class="small b">All</a></div>' + ships.map((s) => { const i = stIdx(s.status); return '<div class="card pad mb" data-a="openShipD" data-id="' + s.id + '" style="cursor:pointer"><div class="row between"><b>' + esc(s.name) + '</b><span class="badge brand">' + esc(KC.SHIP_STATUSES[i][1]) + '</span></div><div class="pipeline">' + KC.SHIP_STATUSES.slice(0, 6).map((_, j) => '<span class="' + (j <= i ? 'on' : '') + '"></span>').join('') + '</div></div>'; }).join('') + '</div>' : '') +
      '<div class="sec"><div class="sech"><h2>Recent sales</h2><a href="#sales" class="small b">All</a></div><div class="card list">' + saleCards(recent) + '</div></div>';
  },
};
A.goStock = (el) => { K.ui.stockFilter = el.dataset.f; go('stock'); };
A.goSales = (el) => { K.ui.salesStatus = el.dataset.f; go('sales'); };
A.openShipD = (el) => openShip(el.dataset.id);

/* ---------- customers ---------- */
VIEWS.customers = {
  render() {
    const q = K.ui.custQ.toLowerCase();
    const stats = {}; visibleSales().forEach((s) => { if (!s.customerId) return; const x = K.C.saleX[s.id]; if (x.status === 'cancelled') return; const o = (stats[s.customerId] = stats[s.customerId] || { n: 0, total: 0, owed: 0, last: '' }); o.n++; o.total += x.net; o.owed += Math.max(0, x.balance); if (saleDate(s) > o.last) o.last = saleDate(s); });
    const list = K.raw.customers.filter((c) => !q || (c.name + ' ' + (c.phone || '') + ' ' + (c.city || '')).toLowerCase().includes(q)).sort((a, b) => ((stats[b.id] || {}).total || 0) - ((stats[a.id] || {}).total || 0));
    return '<div class="row wrap mb">' + (can('customers') ? '<button class="btn pri" data-a="newCust">' : '<button class="btn pri hide">') + '' + ic('plus') + 'New customer</button>' + (can('customers') ? '<button class="btn" data-a="importCust">' + ic('up') + 'Import Excel</button>' : '') + (can('export') ? '<button class="btn" data-a="exportCust">' + ic('dl') + 'Excel</button>' : '') + '</div>' +
      '<div class="search mb">' + ic('search') + '<input class="inp" placeholder="Search name, phone, town" value="' + esc(K.ui.custQ) + '" data-c="custQ"></div>' +
      custTable(list, stats);
  },
};
CH.custQ = (el) => { K.ui.custQ = el.value; render(true); };
A.newCust = () => editCustomer(null);
A.openCust = (el) => {
  const id = el.dataset.id;
  const sh = openSheet({ title: 'Customer', body: '' });
  sh._refresh = () => {
    const c = byId('customers', id); if (!c) return closeSheet();
    const sales = visibleSales().filter((s) => s.customerId === id).sort((a, b) => saleDate(b).localeCompare(saleDate(a)));
    const live = sales.filter((s) => K.C.saleX[s.id].status !== 'cancelled'); const owed = live.reduce((a, s) => a + Math.max(0, K.C.saleX[s.id].balance), 0);
    const wa = phoneWA(c.whatsapp || c.phone);
    setSheetBody(sh, '<div class="row mb"><div class="av" style="width:52px;height:52px;font-size:18px">' + esc(initials(c.name)) + '</div><div class="grow"><div class="b" style="font-size:18px">' + esc(c.name) + '</div><div class="small muted">' + esc([c.phone, c.email, c.city].filter(Boolean).join(' · ')) + '</div></div></div>' +
      '<div class="row wrap mb">' + (wa ? '<a class="btn" style="background:#25D366;border-color:#25D366;color:#fff" target="_blank" rel="noopener" href="https://wa.me/' + wa + '">' + ic('wa') + 'WhatsApp</a>' : '') + '' + (can('customers') ? '<button class="btn" data-a="custEdit" data-id="' + id + '">' + ic('edit') + 'Edit</button>' : '') + (can('sell') ? '<button class="btn pri" data-a="custSell" data-id="' + id + '">' + ic('sell') + 'New sale</button>' : '') + '</div>' +
      '<div class="grid3 mb">' + kpi('Bought', F(live.reduce((a, s) => a + K.C.saleX[s.id].net, 0))) + kpi('Sales', fmt(live.length)) + kpi('Owes', F(owed)) + '</div>' +
      custCredit(c, owed) + custHeld(c) + custItems(live) +
      (c.notes ? '<div class="alert info mb">' + esc(c.notes) + '</div>' : '') + '<h3 class="mb">Purchase history</h3><div class="card list">' + saleCards(sales) + '</div>');
  };
  sh._refresh();
};
A.custEdit = (el) => editCustomer(el.dataset.id, () => refreshSheets());
A.custSell = (el) => { K.cart.customerId = el.dataset.id; saveCart(); while (K.sheets.length) closeSheet(); go('sell'); };
A.exportCust = () => xlsxDownload('Customers-' + todayStr() + '.xlsx', { Customers: K.raw.customers.map((c) => ({ Name: c.name, Phone: c.phone, WhatsApp: c.whatsapp, Email: c.email, City: c.city, Type: c.type, Notes: c.notes })) });
A.importCust = async () => {
  if (!window.XLSX) return toast('Excel library still loading', true);
  const f = await pickFile('.xlsx,.xls,.csv'); if (!f) return;
  const wb = await readSheet(f); const ws = wb.Sheets[wb.SheetNames.find((n) => /cust|client/i.test(n)) || wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const have = new Set(K.raw.customers.map((c) => phoneWA(c.phone)).filter(Boolean));
  const list = rows.map((r) => ({ id: uid('c_'), name: String(pickCol(r, ['Name', 'Customer', 'Full Name'])).trim(), phone: String(pickCol(r, ['Phone', 'Tel', 'Mobile'])), whatsapp: String(pickCol(r, ['WhatsApp', 'WA'])), email: String(pickCol(r, ['Email'])), city: String(pickCol(r, ['City', 'Town', 'Area'])), type: String(pickCol(r, ['Type'])) || 'Retail', notes: String(pickCol(r, ['Notes'])) }))
    .filter((c) => c.name && !(c.phone && have.has(phoneWA(c.phone))));
  list.forEach((c) => { if (!c.whatsapp) c.whatsapp = c.phone; });
  if (!list.length) return toast('No new customers found in the file', true);
  if (!(await confirmBox('Import ' + list.length + ' new customer(s)? Existing phone numbers are skipped.', 'Import'))) return;
  await saveMany('customers', list); scheduleRender(); toast(list.length + ' customers imported');
};

/* ---------- expenses ---------- */
/* ---------- end of day: record the day's expenses and do the subtractions ---------- */
/** Everything for one day: money in (by mode), expenses (by mode), and what is left. */
function dayClose(d) {
  const st = periodStats((x) => x === d);
  const exps = K.raw.expenses.filter((e) => e.date === d).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const expBy = {}; exps.forEach((e) => { const m = e.method || 'Cash'; expBy[m] = (expBy[m] || 0) + num(e.amount); });
  const expT = exps.reduce((a, e) => a + num(e.amount), 0);
  const modes = [...new Set(['Cash'].concat(Object.keys(st.byMethod), Object.keys(expBy)))];
  const perMode = modes.map((m) => ({ m, inn: st.byMethod[m] || 0, out: expBy[m] || 0, left: (st.byMethod[m] || 0) - (expBy[m] || 0) }));
  return { d, st, exps, expT, perMode, left: st.collected - expT, profitLeft: st.profit - expT };
}
function dayCloseText(c) {
  return '*End of day — ' + fmtDate(c.d) + ' · ' + S().businessName + '*\n' +
    'Sales: ' + F(c.st.revenue) + ' (' + c.st.n + ' receipts)\n' +
    'Money collected: ' + F(c.st.collected) + '\n' + c.perMode.filter((r) => r.inn).map((r) => '  ' + r.m + ': ' + F(r.inn)).join('\n') + (c.perMode.some((r) => r.inn) ? '\n' : '') +
    'Expenses: −' + F(c.expT) + '\n' + c.exps.map((e) => '  ' + e.category + (e.description ? ' (' + e.description + ')' : '') + ': ' + F(e.amount)).join('\n') + (c.exps.length ? '\n' : '') +
    '*Left after expenses: ' + F(c.left) + '*\n' +
    c.perMode.filter((r) => r.inn || r.out).map((r) => '  ' + r.m + ' left: ' + F(r.left)).join('\n') +
    (seeCost() ? '\nGross profit: ' + F(c.st.profit) + '\n*Profit after expenses: ' + F(c.profitLeft) + '*' : '');
}
// lines being typed are kept in K.ui.eodDraft, so a background refresh redraws them instead of wiping them
const eodRow = (i, r) => { r = r || {}; return '<div class="grid4 eod-row" data-eod="' + i + '">' + sel('eodCat' + i, KC.EXPENSE_CATS, r.category || (i < 3 ? KC.EXPENSE_CATS[i] : 'Other'), 'aria-label="What for"') +
  inp('eodDesc' + i, r.description || '', 'placeholder="Details (optional)" aria-label="Details"') + inp('eodAmt' + i, r.amount || '', 'inputmode="numeric" placeholder="Amount (F)" aria-label="Amount"') + sel('eodMethod' + i, KC.PAY_METHODS, r.method || 'Cash', 'aria-label="Paid by"') + '</div>'; };
const eodReadRows = () => { const box = $('#eodRows'); if (!box) return []; const v = formVals(box); return $$('[data-eod]', box).map((r) => r.dataset.eod).map((i) => ({ category: v['eodCat' + i], description: v['eodDesc' + i] || '', amount: v['eodAmt' + i] || '', method: v['eodMethod' + i] || 'Cash' })); };
['input', 'change'].forEach((t) => document.addEventListener(t, (e) => { if (e.target.closest && e.target.closest('#eodRows')) K.ui.eodDraft = eodReadRows(); }));
function endOfDayCard() {
  const d = K.ui.eodDate || todayStr(); const c = dayClose(d); const neg = (v) => v < 0 ? ' style="color:var(--bad)"' : '';
  const line = (label, v, opt = {}) => '<div class="row between cl' + (opt.b ? ' b' : '') + '"' + (opt.sub ? ' style="padding-left:14px"' : '') + '><span class="' + (opt.sub ? 'small muted' : '') + '">' + label + '</span><span class="money"' + neg(v) + '>' + F(v) + '</span></div>';
  const draft = K.ui.eodDraft && K.ui.eodDraft.length ? K.ui.eodDraft : [{}, {}, {}];
  return '<div class="card pad2 mb"><div class="row wrap between mb"><h2>End of day</h2><div class="row wrap"><input type="date" class="inp" style="width:auto" value="' + d + '" data-c="eodDate"><button class="btn" data-a="eodCopy">' + ic('copy') + 'Copy for WhatsApp</button></div></div>' +
    '<div class="grid2 eod" style="align-items:start">' +
      // left: add the day's expenses
      '<div><h3 class="mb">Add today\'s expenses</h3><div class="tiny muted mb">Water, food, transport, fuel… one line each. Leave unused lines empty.</div><div id="eodRows" class="col" style="gap:8px">' + draft.map((r, i) => eodRow(i, r)).join('') + '</div>' +
      '<div class="row wrap mt"><button class="btn sm" data-a="eodMore">' + ic('plus', 'sm') + 'Another line</button><button class="btn pri grow" data-a="eodSave">' + ic('check') + 'Save expenses</button></div>' +
      '<h3 class="mt2 mb">Expenses on ' + fmtDate(d) + '</h3>' +
      expTable(c.exps, 'eodList', { noDate: true, empty: 'No expenses recorded for this day yet.' }) + '</div>' +
      // right: the subtractions
      '<div class="card pad" style="background:var(--bg)"><h3 class="mb">The day\'s sums</h3>' +
        line('Sales made · ' + c.st.n + ' receipt(s)', c.st.revenue) +
        line('Money collected', c.st.collected, { b: 1 }) +
        c.perMode.filter((r) => r.inn).map((r) => line(esc(r.m), r.inn, { sub: 1 })).join('') +
        line('Expenses (' + c.exps.length + ')', -c.expT) +
        '<hr class="sep">' + line('= Money left after expenses', c.left, { b: 1 }) +
        c.perMode.filter((r) => r.inn || r.out).map((r) => line(esc(r.m) + ': ' + fmt(r.inn) + ' in − ' + fmt(r.out) + ' spent', r.left, { sub: 1 })).join('') +
        (seeCost() ? '<hr class="sep">' + line('Gross profit on sales', c.st.profit) + line('Expenses', -c.expT) + line('= Profit after expenses', c.profitLeft, { b: 1 }) : '') +
        (c.st.owed > 0 ? '<div class="tiny muted mt">Customers still owe ' + F(c.st.owed) + ' from this day\'s sales (not counted above).</div>' : '') +
      '</div>' +
    '</div></div>';
}
CH.eodDate = (el) => { K.ui.eodDate = el.value; render(true); };
A.eodMore = () => { const box = $('#eodRows'); const i = $$('[data-eod]', box).length; box.insertAdjacentHTML('beforeend', eodRow(i, { category: 'Other' })); K.ui.eodDraft = eodReadRows(); box.lastElementChild.querySelector('[name^=eodAmt]').focus(); };
A.eodCopy = () => copyText(dayCloseText(dayClose(K.ui.eodDate || todayStr())));
A.eodSave = async () => {
  const d = K.ui.eodDate || todayStr();
  const rows = eodReadRows().map((r) => Object.assign(r, { amount: num(r.amount) }));
  if (rows.some((r) => r.amount < 0)) return toast('Amounts cannot be negative', true);
  const noAmt = rows.find((r) => r.description && !r.amount); if (noAmt) return toast('Enter the amount for "' + noAmt.description + '"', true);
  const todo = rows.filter((r) => r.amount > 0);
  if (!todo.length) return toast('Enter at least one amount', true);
  let ok = 0;
  for (const r of todo) if (await save('expenses', Object.assign(r, { id: uid('e_'), date: d, locationId: K.loc, by: K.me.name || '', byId: K.me.id || '' }))) ok++;
  K.ui.eodDraft = null; render(true);
  toast(ok + ' expense(s) saved · ' + F(todo.reduce((a, r) => a + r.amount, 0)));
};
VIEWS.expenses = {
  render() {
    const m = K.ui.expMonth || monthStr(); const list = K.raw.expenses.filter((e) => (e.date || '').slice(0, 7) === m).sort((a, b) => b.date.localeCompare(a.date));
    return endOfDayCard() +
      '<div class="row wrap between mb"><h2>All expenses</h2><div class="row wrap"><input type="month" class="inp" style="width:auto" value="' + m + '" data-c="expMonth"><button class="btn" data-a="expEdit">' + ic('plus') + 'Add one expense</button></div></div>' +
      '<div class="alert info mb">For running costs in Cameroon (rent, wages, transport, repairs, fuel…). Container costs go inside each container. Buying equipment or a vehicle? Register it under <a href="#assets">Assets</a> instead — it is spread over its life.</div>' +
      '<div class="kpis mb">' + kpi('Expenses this month', F(list.reduce((a, e) => a + num(e.amount), 0)), list.length + ' entries', true) + '</div>' +
      expTable(list, 'expList', { empty: 'No expenses this month.' });
  },
};
CH.expMonth = (el) => { K.ui.expMonth = el.value; render(true); };
A.expEdit = (el) => {
  const id = el.dataset.id; const e = id ? byId('expenses', id) : { date: todayStr(), method: 'Cash', category: KC.EXPENSE_CATS[0] };
  const sh = openSheet({ title: id ? 'Edit expense' : 'Add expense', body: '<div class="col"><div class="grid2">' + field('Date', inp('date', e.date, 'type="date"')) + field('Amount (F)', inp('amount', e.amount, 'inputmode="numeric"')) + field('Category', sel('category', KC.EXPENSE_CATS, e.category)) + field('Paid by', sel('method', KC.PAY_METHODS, e.method)) + '</div>' + field('Description', inp('description', e.description)) + (K.raw.assets.length ? field('For asset (optional)', sel('assetId', [['', '—']].concat(K.raw.assets.filter((a) => !KC.assetGone(a) || a.id === e.assetId).map((a) => [a.id, a.name + (a.tag ? ' · ' + a.tag : '')])), e.assetId || '')) : '') + '</div>', foot: (id ? '<button class="btn danger" id="eDel">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="eSave">Save</button>' });
  $('#eSave', sh).onclick = async () => { const v = formVals(sh); v.amount = num(v.amount); if (!v.amount) return toast('Enter an amount', true); if (await save('expenses', Object.assign({ locationId: K.loc }, id ? {} : { by: K.me.name || '', byId: K.me.id || '' }, e, v, { id: id || uid('e_') }))) { closeSheet(); scheduleRender(); } };
  if (id) $('#eDel', sh).onclick = async () => { if (await confirmBox('Delete this expense?', 'Delete', true)) { await remove('expenses', id); closeSheet(); scheduleRender(); } };
};

/* ---------- settings + backup ---------- */
/* ---------- settings page: section menu + one card per section ---------- */
const SET_SECTIONS = [['business', 'Business', 'home'], ['currency', 'Currency', 'wallet'], ['pricing', 'Pricing', 'tag'], ['credit', 'Wholesale & credit', 'users'], ['money', 'Mobile money', 'wallet'], ['reminders', 'Reminders', 'wa'], ['catalogue', 'Stores & categories', 'buy'], ['shop', 'Online shop', 'sell'], ['branches', 'Branches', 'home'], ['backup', 'Backup', 'dl'], ['account', 'Account', 'gear']];
const setCard = (id, title, desc, body, side) => '<section class="card set-card" id="set-' + id + '"><header class="set-head"><div><h2>' + title + '</h2>' + (desc ? '<p>' + desc + '</p>' : '') + '</div>' + (side || '') + '</header>' + body + '</section>';
/** label + input + optional hint (one small grey line). */
const sf = (label, inner, hint, cls) => '<label class="f' + (cls ? ' ' + cls : '') + '"><span class="lbl">' + label + '</span>' + inner + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</label>';
/** input with its unit inside the box: 25 [%], 50 [F], 14 [days] */
const unitIn = (name, val, unit, attrs) => '<div class="in-unit"><input class="inp" name="' + name + '" value="' + esc(val === undefined || val === null ? '' : val) + '" ' + (attrs || 'inputmode="decimal"') + '><span>' + esc(unit) + '</span></div>';
const REM_TOKENS = [['{name}', 'Customer name'], ['{balance}', 'Amount owed'], ['{due}', 'Due date'], ['{business}', 'Your business'], ['{momo}', 'Your MoMo numbers'], ['{receipts}', 'Receipt numbers']];
function fxRow(code, rate, base) {
  const k = 'fx' + Math.random().toString(36).slice(2, 8);
  const opts = KC.CURRENCIES.filter((c) => c[0] !== base).map((c) => '<option value="' + c[0] + '"' + (c[0] === code ? ' selected' : '') + '>' + c[0] + '</option>').join('');
  return '<div class="fx-row" data-fxrow><span class="fx-one">1</span><select class="inp fx-code" data-fxc="' + k + '" aria-label="Foreign currency">' + opts + '</select><span class="fx-eq">=</span>' +
    '<div class="in-unit fx-rate"><input class="inp" inputmode="decimal" data-fxr="' + k + '" value="' + esc(rate === undefined ? '' : rate) + '" placeholder="Rate" aria-label="Exchange rate"><span class="fx-base">' + esc(base) + '</span></div>' +
    '<span class="fx-eg hint"></span><button type="button" class="icon-btn" data-a="fxDel" title="Remove this currency" aria-label="Remove this currency">' + ic('trash', 'sm') + '</button></div>';
}
function mmRow(a) {
  return '<div class="mm-row" data-mm>' + sel('mmMethod', ['MTN MoMo', 'Orange Money', 'Bank transfer'], a.method || 'MTN MoMo', 'aria-label="Type"') +
    '<input class="inp" data-mmn value="' + esc(a.number || '') + '" placeholder="Number, e.g. 677 00 00 00" inputmode="tel" aria-label="Number">' +
    '<input class="inp" data-mml value="' + esc(a.label || '') + '" placeholder="Label, e.g. Shop MoMo" aria-label="Label">' +
    '<button type="button" class="icon-btn" data-a="mmDel" title="Remove this number" aria-label="Remove this number">' + ic('trash', 'sm') + '</button></div>';
}
function currencyBlock(s) {
  const base = s.currency || 'XAF'; const rates = Object.entries(s.fxRates || { USD: s.fxRate || 600 });
  return '<div class="set-grid">' +
    sf('Your currency', '<select class="inp" name="baseCurrency" id="baseCur">' + KC.CURRENCIES.map((c) => '<option value="' + c[0] + '"' + (c[0] === base ? ' selected' : '') + '>' + c[0] + ' — ' + esc(c[2]) + '</option>').join('') + '</select>', 'Sales, prices, profit and reports are always in this currency.', 'span2') +
    sf('Symbol on receipts', '<input class="inp" name="currencySymbol" id="curSym" value="' + esc(s.currencySymbol || 'F') + '" maxlength="5">', 'Prices show as <b id="curEg">25 000 ' + esc(s.currencySymbol || 'F') + '</b>') + '</div>' +
    '<div class="set-sub"><h3>Exchange rates</h3><p class="hint">For purchases made abroad ($, €…). A rate set on a container is used instead for that container.</p>' +
    '<div id="fxBox">' + rates.map(([c, r]) => fxRow(c, r, base)).join('') + '</div><button type="button" class="btn sm" data-a="fxAdd">' + ic('plus', 'sm') + 'Add a currency</button></div>';
}
VIEWS.settings = {
  form: true,
  render() {
    const s = S();
    K.ui.feeDraft = feeCopy(s.momoFeeTables);
    K.ui.storeDraft = (s.vendors || []).slice(); K.ui.catDraft = catDraftFrom(s.categories); K.ui.catOpen = K.ui.catOpen || {}; K.ui.catRen = null;
    if (!can('settings')) return '<div class="card pad2 mb"><h2 class="mb">Downloads</h2><div class="row wrap"><button class="btn" data-a="backupXlsx">' + ic('dl') + 'All data as Excel</button><button class="btn" data-a="backupJson">' + ic('dl') + 'Full backup</button></div></div>';
    const cats = s.categories || KC.CATEGORIES; const subN = Object.values(cats).reduce((a, v) => a + v.length, 0);
    const secs = SET_SECTIONS.filter(([k]) => k !== 'account' || K.info.mode === 'saas');
    const nav = '<nav class="set-nav" aria-label="Settings sections">' + secs.map(([k, l, i]) => '<button type="button" data-a="setGo" data-v="' + k + '" class="' + (k === 'business' ? 'on' : '') + '">' + ic(i, 'sm') + '<span>' + l + '</span></button>').join('') + '</nav>';
    const form = '<div id="setForm">' +
      setCard('business', 'Business', 'How your business appears on receipts, the shop page and messages to customers.',
        '<div class="logo-row" id="setLogo">' + logoHTML('logo" style="width:64px;height:64px;font-size:22px') + '<div class="logo-txt"><div class="b">Logo</div><div class="hint">Square PNG or JPG works best.</div></div><button type="button" class="btn sm" data-a="logoUp">' + ic('up', 'sm') + 'Upload logo</button>' + (s.logo ? '<button type="button" class="btn sm ghost" data-a="logoDel">Remove</button>' : '') + '</div>' +
        '<div class="set-grid">' + sf('Business name', inp('businessName', s.businessName)) + sf('Tagline', inp('tagline', s.tagline, 'placeholder="e.g. Quality goods from the USA"')) + sf('Phone (on receipts)', inp('phone', s.phone, 'inputmode="tel"')) + sf('Address', inp('address', s.address)) + '</div>' +
        sf('Receipt footer', inp('receiptFooter', s.receiptFooter), 'Printed at the bottom of every receipt.', 'mt')) +
      setCard('currency', 'Currency', 'Your money, and how purchases in other currencies are converted.', currencyBlock(s)) +
      setCard('pricing', 'Pricing', 'How selling prices are worked out from what each item cost you, and when to warn you.',
        '<div class="set-grid">' + sf('Default markup', unitIn('defaultMarkup', s.defaultMarkup, '%'), 'Selling price = landed cost + this %.') + sf('Lowest markup', unitIn('minMarkup', s.minMarkup, '%'), 'Staff cannot sell below this without permission.') + sf('Round prices up to', unitIn('roundTo', s.roundTo, 'F', 'inputmode="numeric"'), 'e.g. 50 → 12 330 becomes 12 350.') +
        sf('Low stock alert at', unitIn('lowStock', s.lowStock, 'units', 'inputmode="numeric"'), 'Items at or below this show as Low.') + sf('Expiry warning', unitIn('expiryWarnDays', s.expiryWarnDays, 'days', 'inputmode="numeric"'), 'Warn this many days before expiry.') + '</div>') +
      setCard('credit', 'Wholesale & credit', 'Prices for resellers and how much customers may owe. Who sees costs and profit is set per person in <a href="#team">Team & access</a>.',
        '<div class="set-grid">' + sf('Wholesale markup', unitIn('wholesaleMarkup', s.wholesaleMarkup, '%'), 'For customers marked Wholesale or Reseller.') + sf('Bulk price from', unitIn('bulkQty', s.bulkQty, 'units', 'inputmode="numeric"'), '0 = off. Buying this many gets the wholesale price.') +
        sf('Days to pay', unitIn('creditDays', s.creditDays, 'days', 'inputmode="numeric"'), 'Default due date for credit sales.') + sf('Credit limit per customer', unitIn('defaultCreditLimit', s.defaultCreditLimit ?? '', 'F', 'inputmode="numeric" placeholder="No limit"'), 'Empty = no limit, 0 = cash only. Can be changed per customer.') + '</div>') +
      setCard('money', 'Mobile money', 'Numbers customers send money to, and the withdrawal charges suggested at payment.',
        '<h3>Receiving numbers</h3><p class="hint" style="margin-top:2px">Shown on receipts and reminders, and chosen when a customer pays.</p><div id="momoList">' + (s.momoAccounts || []).map(mmRow).join('') + '</div><button type="button" class="btn sm" data-a="mmAdd">' + ic('plus', 'sm') + 'Add a number</button>' +
        '<div class="set-sub"><h3>Withdrawal charges</h3><p class="hint">When a customer pays by MTN MoMo or Orange Money, this grid suggests the charge (kept apart from the sale amount). Staff can still change it on each payment.</p>' + feeEditor() + '</div>') +
      setCard('reminders', 'Payment reminders', 'The message sent to customers who owe you money.',
        '<div class="tok-row"><span class="hint">Insert:</span>' + REM_TOKENS.map(([t, l]) => '<button type="button" class="chip" data-a="remTok" data-v="' + t + '" title="' + l + '">' + l + '</button>').join('') + '</div>' +
        '<textarea class="inp" name="reminderTemplate" id="remTpl" rows="3">' + esc(s.reminderTemplate || '') + '</textarea>' +
        '<div class="rem-prev"><div class="hint b">Preview</div><div id="remPrev"></div></div>' +
        '<div class="set-grid mt">' + sf('Remind the same customer at most every', unitIn('reminderEvery', s.reminderEvery, 'days', 'inputmode="numeric"'), 'Nobody is reminded twice within this time.') + '</div>') +
      setCard('catalogue', 'Stores & categories', 'Lists that make adding purchases and items faster.',
        '<h3>Stores you buy from</h3><p class="hint" style="margin:2px 0 10px">Suggested when you add a purchase. Type a name and press Enter.</p>' + storeEditor() +
        '<div class="set-sub"><h3>Categories</h3><p class="hint" style="margin:2px 0 12px">Used to group your items in stock, sales reports and the online shop. Open a category to manage its subcategories.</p>' + catEditor() + '</div>' +
        '<button type="button" class="btn pri lg block mt2" data-a="saveSettings">' + ic('check') + 'Save settings</button>') +
      '</div>';
    const rest = '<div id="set-shop" class="set-anchor">' + shopCard() + '</div><div id="set-branches" class="set-anchor">' + locationsCard() + '</div>' +
      setCard('backup', 'Backup & restore', 'Download all your records to keep them safe. You can restore the file here or load it into the full version of the app.',
        '<div class="row wrap"><button class="btn pri" data-a="backupJson">' + ic('dl') + 'Download full backup</button><button class="btn" data-a="backupXlsx">' + ic('dl') + 'All data as Excel</button><button class="btn" data-a="restore">' + ic('up') + 'Restore from backup</button></div><div class="hint mt">Last backup: ' + (s.lastBackup ? fmtDT(s.lastBackup) : '<b>never</b>') + '</div>') +
      (K.info.mode === 'saas' ? setCard('account', 'Account', K.info.tenant ? 'Plan: <b>' + esc(K.info.tenant.plan) + '</b>' + (K.info.tenant.trialEndsAt ? ' · trial ends ' + fmtDate(String(K.info.tenant.trialEndsAt).slice(0, 10)) : '') : '',
        '<div class="set-grid">' + sf('Current password', '<input class="inp" type="password" id="pwOld" autocomplete="current-password">') + sf('New password', '<input class="inp" type="password" id="pwNew" autocomplete="new-password">') + '<div class="f" style="justify-content:flex-end"><button class="btn" data-a="pwChange">Change password</button></div></div>',
        '<button class="btn sm" data-a="logout">Sign out</button>') : '');
    setTimeout(setAfterRender, 0);
    return '<div class="settings">' + nav + '<div class="set-main">' + form + rest + '</div></div>' +
      '<div class="set-savebar" id="setBar" role="status" aria-live="polite"><span><b>Unsaved changes</b><span class="hint"> — save before leaving this page</span></span><span class="row"><button type="button" class="btn" data-a="setDiscard">Discard</button><button type="button" class="btn pri" data-a="saveSettings">' + ic('check') + 'Save settings</button></span></div>';
  },
};
/* live bits after the page is drawn: exchange-rate examples, reminder preview */
function setAfterRender() { fxExamples(); remPreview(); }
function fxExamples() {
  const base = ($('#baseCur') || {}).value || baseCode(); const sym = ($('#curSym') || {}).value || 'F';
  $$('[data-fxrow]').forEach((r) => { const c = $('select', r).value; const v = num($('[data-fxr]', r).value); const sy = (KC.CURRENCIES.find((x) => x[0] === c) || [0, c])[1]; $('.fx-eg', r).textContent = v > 0 ? sy + ' 100 = ' + fmt(v * 100) + ' ' + sym : ''; $('.fx-base', r).textContent = base; });
  const eg = $('#curEg'); if (eg) eg.textContent = '25 000 ' + sym;
}
function remPreview() {
  const ta = $('#remTpl'), out = $('#remPrev'); if (!ta || !out) return; const st = S();
  const momo = ($$('[data-mm]').map((r) => $('select', r).value + ' ' + $('[data-mmn]', r).value).filter((x) => /\d/.test(x)).join(', ')) || st.phone || '';
  out.textContent = ta.value.replace(/\{name\}/g, 'Jeanne').replace(/\{balance\}/g, F(25000)).replace(/\{due\}/g, fmtDate(KC.addDays(todayStr(), 7))).replace(/\{business\}/g, ($('[name=businessName]') || {}).value || st.businessName).replace(/\{momo\}/g, momo).replace(/\{receipts\}/g, 'S261111-A1B');
}
const setDirty = () => { K.viewDirty = true; const b = $('#setBar'); if (b) b.classList.add('show'); };
['input', 'change'].forEach((t) => document.addEventListener(t, (e) => {
  if (!e.target.closest || !e.target.closest('#setForm')) return;
  if (e.target.matches('#catQ, #catNew, #storeIn, #catRen, [data-subin]')) return;
  setDirty();
  if (e.target.closest('#set-currency')) fxExamples();
  if (e.target.id === 'remTpl' || e.target.closest('#set-money') || e.target.name === 'businessName') remPreview();
}));
A.setGo = (el) => { const t = $('#set-' + el.dataset.v); if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' }); };
A.setDiscard = async () => { if (await confirmBox('Discard the changes you made on this page?', 'Discard', true)) { K.viewDirty = false; render(true); } };
A.fxAdd = () => { const used = $$('[data-fxc]').map((s) => s.value); const base = ($('#baseCur') || {}).value || baseCode(); const next = (KC.CURRENCIES.find((c) => c[0] !== base && !used.includes(c[0])) || ['USD'])[0]; $('#fxBox').insertAdjacentHTML('beforeend', fxRow(next, '', base)); $$('#fxBox [data-fxr]').pop().focus(); setDirty(); fxExamples(); };
A.fxDel = (el) => { el.closest('[data-fxrow]').remove(); setDirty(); };
A.mmAdd = () => { $('#momoList').insertAdjacentHTML('beforeend', mmRow({})); $$('#momoList [data-mmn]').pop().focus(); setDirty(); };
A.mmDel = (el) => { el.closest('[data-mm]').remove(); setDirty(); remPreview(); };
A.remTok = (el) => { const ta = $('#remTpl'); const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a; ta.value = ta.value.slice(0, a) + el.dataset.v + ta.value.slice(b); ta.focus(); ta.setSelectionRange(a + el.dataset.v.length, a + el.dataset.v.length); setDirty(); remPreview(); };
document.addEventListener('change', (e) => { if (e.target.id === 'baseCur') { const c = KC.CURRENCIES.find((x) => x[0] === e.target.value); const sy = $('#curSym'); if (c && sy) sy.value = c[1]; fxExamples(); } });
// highlight the section you are looking at in the menu
window.addEventListener('scroll', () => {
  if (K.route !== 'settings') return; const nav = $('.set-nav'); if (!nav) return;
  let cur = 'business'; for (const [k] of SET_SECTIONS) { const el = $('#set-' + k); if (el && el.getBoundingClientRect().top < 140) cur = k; }
  $$('button', nav).forEach((b) => b.classList.toggle('on', b.dataset.v === cur));
}, { passive: true });
async function saveSettings(patch) {
  const cur = Object.assign({}, K.raw.settings, patch, { id: 'main' });
  K.raw.settings = cur; recompute();
  return save('settings', cur);
}
A.saveSettings = async () => {
  const v = formVals($('#setForm'));
  const cd = catDraftForSave(); const cats = cd.cats;
  if (!Object.keys(cats).length) { toast('Keep at least one category', true); return; }
  if (cd.items.length && !(await confirmBox('Renaming moves ' + cd.items.length + ' item' + (cd.items.length === 1 ? '' : 's') + ' to the new name. Continue?', 'Save and move items'))) return;
  const mm = $$('#momoList [data-mm]').map((r) => ({ method: $('select', r).value, number: $('[data-mmn]', r).value.trim(), label: $('[data-mml]', r).value.trim() })).filter((m) => m.number);
  const fee = feeDraftForSave(); if (fee.error) { toast(fee.error, true); const ed = $('#feeEd'); if (ed) ed.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  const momoFeeTables = fee.tables;
  const rates = {}; $$('[data-fxc]').forEach((i) => { const c = i.value.trim().toUpperCase(); const r = num($('[data-fxr="' + i.dataset.fxc + '"]').value); if (c && r > 0 && c !== v.baseCurrency) rates[c] = r; });
  const curInfo = KC.CURRENCIES.find((c) => c[0] === v.baseCurrency) || [v.baseCurrency, v.baseCurrency];
  const patch = { currency: v.baseCurrency || 'XAF', currencySymbol: v.currencySymbol || curInfo[1], fxRates: rates, fxRate: rates.USD || num(S().fxRate) || 600, businessName: v.businessName || 'My Business', tagline: v.tagline, phone: v.phone, address: v.address, receiptFooter: v.receiptFooter,  defaultMarkup: num(v.defaultMarkup), minMarkup: num(v.minMarkup), roundTo: num(v.roundTo), lowStock: num(v.lowStock), expiryWarnDays: num(v.expiryWarnDays), wholesaleMarkup: num(v.wholesaleMarkup), bulkQty: num(v.bulkQty), creditDays: num(v.creditDays) || 14, reminderTemplate: v.reminderTemplate, reminderEvery: num(v.reminderEvery) || 7, defaultCreditLimit: v.defaultCreditLimit === '' ? null : num(v.defaultCreditLimit), momoAccounts: mm, momoFeeTables, vendors: K.ui.storeDraft.slice(), categories: Object.keys(cats).length ? cats : KC.CATEGORIES };
  if (await saveSettings(patch)) {
    // items that used a renamed category / subcategory follow the new name
    for (const pr of cd.items) { const m = cd.moves.find((x) => (pr.category || 'Other') === x.from && (x.sub === undefined || (pr.subcategory || '') === x.sub)); await save('products', Object.assign({}, pr, { category: m.to }, m.toSub !== undefined ? { subcategory: m.toSub } : {})); }
    toast(cd.items.length ? 'Settings saved · ' + cd.items.length + ' item(s) moved to the new name' : 'Settings saved'); render(true);
  }
};
A.logoUp = async () => {
  const f = await pickFile('image/*'); if (!f) return;
  const img = new Image(); img.src = URL.createObjectURL(f); await img.decode();
  const c = document.createElement('canvas'); const s = 256; c.width = c.height = s; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); const r = Math.min(s / img.width, s / img.height); g.drawImage(img, (s - img.width * r) / 2, (s - img.height * r) / 2, img.width * r, img.height * r);
  // save the logo without re-drawing the form, so unsaved edits on this screen are kept
  if (await saveSettings({ logo: c.toDataURL('image/jpeg', 0.85) })) { toast('Logo updated'); refreshLogo(); }
};
A.logoDel = async () => { await saveSettings({ logo: '' }); refreshLogo(); };
function refreshLogo() { const row = $('#setLogo'); const s = S(); if (row) row.innerHTML = logoHTML('logo" style="width:64px;height:64px;font-size:22px') + '<div class="logo-txt"><div class="b">Logo</div><div class="hint">Square PNG or JPG works best.</div></div><button type="button" class="btn sm" data-a="logoUp">' + ic('up', 'sm') + 'Upload logo</button>' + (s.logo ? '<button type="button" class="btn sm ghost" data-a="logoDel">Remove</button>' : ''); shell(); }
function fullBackup() { const o = { app: 'kargo', version: 1, exportedAt: new Date().toISOString(), business: S().businessName, data: {} }; COLLECTIONS.forEach((c) => (o.data[c] = c === 'settings' ? [Object.assign({ id: 'main' }, K.raw.settings)] : K.raw[c])); if (K.raw.members.length) o.data.members = K.raw.members; return o; }
async function embedPhotos(b) {
  // Photos stored as files are copied into the backup so it restores anywhere.
  const prods = b.data.products.filter((p) => p.image && !String(p.image).startsWith('data:'));
  for (const p of prods) {
    try { const r = await fetch(imgSrc(p.image)); const bl = await r.blob(); p.image = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(bl); }); } catch (e) { }
  }
}
A.backupJson = async () => {
  const b = JSON.parse(JSON.stringify(fullBackup()));
  toast('Preparing backup…'); await embedPhotos(b); await saveFile('Backup-' + S().businessName.replace(/\W+/g, '-') + '-' + todayStr() + '.json', new Blob([JSON.stringify(b)], { type: 'application/json' }));
  if (can('settings')) saveSettings({ lastBackup: new Date().toISOString() });
};
A.backupXlsx = () => {
  const flat = (o) => { const r = {}; Object.entries(o).forEach(([k, v]) => (r[k] = v && typeof v === 'object' ? JSON.stringify(v) : v)); return r; };
  const sheets = {
    Products: K.raw.products.map((p) => Object.assign(flat(p), { in_stock: K.C.prodX[p.id].available, avg_cost: Math.round(K.C.prodX[p.id].avgCost), price_max: K.C.prodX[p.id].priceMax })),
    Purchases: K.raw.lots.map((l) => Object.assign(flat(l), { item: (byId('products', l.productId) || {}).name, landed_unit_cost: Math.round(K.C.lotX[l.id].landedUnit), available: K.C.lotX[l.id].available })),
    Containers: K.raw.shipments.map((s) => flat(s)),
    ContainerCosts: K.raw.shipments.flatMap((s) => (s.costs || []).map((c) => Object.assign({ container: s.name }, c))),
    Customers: K.raw.customers.map(flat), Sales: K.raw.sales.map(saleRow),
    SaleLines: K.raw.sales.flatMap((s) => (s.lines || []).map((l) => ({ receipt: s.no, date: saleDate(s), customer: s.customerName, item: l.name, qty: l.qty, unit_price: l.unitPrice, condition: l.condition || '', working: l.working || '', collected: s.delivered ? 'yes' : 'no', returned: (l.returns || []).reduce((a, r) => a + num(r.qty), 0) }))),
    Payments: K.raw.sales.flatMap((s) => (s.payments || []).map((p) => ({ receipt: s.no, sale_txn_id: KC.saleTxnId(s), customer: s.customerName, date: p.date, mode: p.method, account: p.account, txn_id: p.ref, amount: p.amount, momo_charges: num(p.fee), total_sent: num(p.amount) + Math.max(0, num(p.fee)), note: p.note || '', by: p.by || '' }))),
    SupplierPayments: K.raw.bills.flatMap((b) => (b.payments || []).map((p) => ({ bill_txn_id: KC.billTxnId(b), supplier: (byId('suppliers', b.supplierId) || {}).name || '', description: b.description || '', currency: b.currency, date: p.date, mode: p.method, paid_to: p.account || '', txn_id: p.ref || '', amount: p.amount, momo_charges: num(p.fee), total_sent: num(p.amount) + Math.max(0, num(p.fee)), by: p.by || '' }))),
    Adjustments: K.raw.adjustments.map(flat), Expenses: K.raw.expenses.map(flat),
  };
  if (K.raw.assets.length) sheets.Assets = K.raw.assets.map((a) => { const v = KC.assetValue(a, S(), todayStr()); return Object.assign(flat(a), { full_cost: Math.round(v.cost), value_today: Math.round(v.book), value_lost: Math.round(v.accumulated) }); });
  xlsxDownload('All-data-' + todayStr() + '.xlsx', sheets);
};
A.restore = async () => {
  const f = await pickFile('.json,application/json'); if (!f) return;
  let b; try { b = JSON.parse(await f.text()); } catch (e) { return toast('That file is not a valid backup', true); }
  if (!b || !b.data) return toast('That file is not a Kargo backup', true);
  const counts = COLLECTIONS.map((c) => (b.data[c] || []).length);
  const total = counts.reduce((a, n) => a + n, 0);
  if (!(await confirmBox('Restore ' + total + ' records from ' + (b.business || 'backup') + ' (' + fmtDT(b.exportedAt) + ')? Records with the same ID are overwritten; nothing is deleted.', 'Restore'))) return;
  const sh = openSheet({ title: 'Restoring…', body: '<div class="center"><div class="b" id="rsP">0 / ' + total + '</div><div class="bar mt"><i id="rsB" style="width:0"></i></div><div class="tiny muted mt">Keep this screen open.</div></div>' });
  let n = 0;
  for (const c of COLLECTIONS.concat(K.info.mode === 'cloud' && can('team') ? ['members'] : [])) for (const d of b.data[c] || []) {
    if (!d || !d.id) continue; const o = Object.assign({}, d);
    if (c === 'products' && o.image && String(o.image).startsWith('data:') && K.store.uploadImage) { try { const bl = await (await fetch(o.image)).blob(); const ref = await K.store.uploadImage(bl); if (ref) o.image = ref; } catch (e) { } }
    try { await K.store.put(c, c === 'settings' ? 'main' : o.id, o); } catch (e) { console.warn(e); }
    n++; if (n % 5 === 0) { $('#rsP', sh).textContent = n + ' / ' + total; $('#rsB', sh).style.width = (n / total * 100) + '%'; await new Promise((r) => setTimeout(r, 40)); }
  }
  closeSheet(); toast('Restored ' + n + ' records'); scheduleRender();
};


function custCredit(c, owed) {
  const lim = KC.creditLimitOf(S(), c); if (lim === null && !owed) return '';
  const used = lim ? Math.min(100, owed / lim * 100) : 0;
  return '<div class="card pad mb"><div class="row between"><h3>Credit</h3><span class="small">' + (lim === null ? 'No limit set' : 'Limit ' + F(lim) + (c.creditLimit === undefined || c.creditLimit === null || c.creditLimit === '' ? ' (default)' : '')) + '</span></div>' +
    (lim !== null ? '<div class="bar mt"><i style="width:' + used + '%;background:' + (used >= 100 ? 'var(--bad)' : used > 75 ? 'var(--accent)' : 'var(--brand)') + '"></i></div><div class="row between small mt"><span class="muted">Owes ' + F(owed) + '</span><b>' + F(Math.max(0, lim - owed)) + ' available</b></div>' : '<div class="small muted mt">Owes ' + F(owed) + '</div>') + '</div>';
}
function custHeld(c) {
  const lots = K.raw.lots.filter((l) => l.reservedFor === c.id && K.C.lotX[l.id] && K.C.lotX[l.id].clientAvail > 0);
  if (!lots.length) return '';
  return '<div class="card pad mb"><h3 class="mb">Ordered for this client (not yet sold)</h3>' + lots.map((l) => { const p = byId('products', l.productId) || {}; const x = K.C.lotX[l.id]; return '<div class="row cl">' + thumb(p, 36, 9) + '<div class="grow"><div class="b">' + esc(p.name) + '</div><div class="tiny muted">' + x.clientAvail + ' unit(s) · ' + lotStageBadge(l) + '</div></div>' + (seeCost() ? '<div class="right"><div class="tiny faint">Full landed cost</div><b class="money">' + F(x.landedUnit) + '</b></div>' : '') + '</div>'; }).join('') + '<div class="tiny muted mt">Sell it to them from New sale (select this customer first). Charge at least the full landed cost.</div></div>';
}
function custItems(live) {
  const m = {}; live.forEach((s) => (s.lines || []).forEach((l) => { const o = (m[l.productId] = m[l.productId] || { name: l.name, times: 0, qty: 0, total: 0, last: '', prices: [] }); const rq = (l.returns || []).reduce((a, r) => a + num(r.qty), 0); o.times++; o.qty += num(l.qty) - rq; o.total += (num(l.qty) - rq) * num(l.unitPrice); o.prices.push(num(l.unitPrice)); if (saleDate(s) > o.last) o.last = saleDate(s); }));
  const rows = Object.values(m).sort((a, b) => b.total - a.total); if (!rows.length) return '';
  return '<div class="card mb"><div class="pad"><h3>Items they buy</h3></div><div class="tw"><table class="t"><thead><tr><th>Item</th><th class="r">Times</th><th class="r">Units</th><th class="r">Avg price</th><th class="r">Total</th><th>Last</th></tr></thead><tbody>' +
    rows.map((o) => '<tr><td>' + esc(o.name) + '</td><td class="r">' + o.times + '</td><td class="r">' + fmt(o.qty) + '</td><td class="r money">' + fmt(o.prices.reduce((a, b) => a + b, 0) / o.prices.length) + '</td><td class="r money">' + fmt(o.total) + '</td><td class="nowrap">' + fmtDate(o.last) + '</td></tr>').join('') + '</tbody></table></div></div>';
}


/* where every unit is right now: US → container → sea → port → cleared → warehouse/branches */
function journeyCard() {
  const st = [['us', 'Bought, in US storage'], ['planning', 'In a container (planning)'], ['loading', 'Loading in the US'], ['in_transit', 'At sea'], ['at_port', 'At port, Douala'], ['cleared', 'Cleared, on the way'], ['warehouse', 'In warehouse / branches · sellable']];
  const agg = {}; st.forEach(([k]) => (agg[k] = { u: 0, v: 0 }));
  K.raw.lots.forEach((l) => { const x = K.C.lotX[l.id]; if (!x) return; let k; if (x.stage === 'warehouse') k = 'warehouse'; else if (x.stage === 'us') k = 'us'; else k = (byId('shipments', l.shipmentId) || {}).status || 'planning'; if (!agg[k]) return; const u = k === 'warehouse' ? Math.max(0, x.available) + Math.max(0, x.clientAvail || 0) : num(l.qty) - x.sold; agg[k].u += Math.max(0, u); agg[k].v += Math.max(0, u) * x.landedUnit; });
  const max = Math.max(1, ...Object.values(agg).map((a) => a.u));
  return '<div class="sec"><div class="sech"><h2>Where your goods are</h2><a href="#containers" class="small b">Containers</a></div><div class="card pad">' + st.map(([k, l], i) => '<div class="row" style="margin:6px 0;opacity:' + (agg[k].u ? 1 : 0.45) + '"><span class="badge ' + (k === 'warehouse' ? 'ok' : k === 'us' ? 'acc' : 'info') + '" style="min-width:22px;justify-content:center">' + (i + 1) + '</span><span class="grow small">' + l + '</span><span class="small b">' + fmt(agg[k].u) + '</span>' + (seeCost() ? '<span class="tiny muted money" style="width:96px;text-align:right">' + F(agg[k].v) + '</span>' : '') + '</div>').join('') + '<div class="tiny muted mt">Goods can only be sold at step 7, after the container is received.</div></div></div>';
}

A.pwChange = async () => { try { await K.store.req('POST', '/api/me/password', { current: $('#pwOld').value, password: $('#pwNew').value }); $('#pwOld').value = $('#pwNew').value = ''; toast('Password changed'); } catch (e) { toast(e.message, true); } };

/* ---------- tables: customers, expenses ---------- */
function custTable(list, stats) {
  const st = (c) => stats[c.id] || { n: 0, total: 0, owed: 0, last: '' };
  return dataTable({
    id: 'custList', rows: list, noun: 'customer', empty: '<div class="big">👥</div>No customers yet.',
    rowAttr: (c) => ' data-a="openCust" data-id="' + c.id + '"',
    cols: [
      { k: 'name', label: 'Name', core: true, v: (c) => c.name, html: (c) => '<b>' + esc(c.name) + '</b>' },
      { k: 'phone', label: 'Phone', core: true, v: (c) => c.phone || '' },
      { k: 'wa', label: 'WhatsApp', v: (c) => c.whatsapp && c.whatsapp !== c.phone ? c.whatsapp : '', cls: 'mut' },
      { k: 'type', label: 'Type', core: true, v: (c) => c.type || 'Retail', html: (c) => c.type && c.type !== 'Retail' ? '<span class="badge brand">' + esc(c.type) + '</span>' : '<span class="mut">Retail</span>' },
      { k: 'city', label: 'Town', v: (c) => c.city || '' },
      { k: 'email', label: 'Email', v: (c) => c.email || '', cls: 'mut' },
      { k: 'n', label: 'Purchases', core: true, num: true, v: (c) => st(c).n, total: (rows) => fmt(dtSum(rows, (c) => st(c).n)) },
      { k: 'total', label: 'Total bought', core: true, money: true, cls: 'b', v: (c) => st(c).total, total: (rows) => fmt(dtSum(rows, (c) => st(c).total)) },
      { k: 'owed', label: 'Owes', core: true, money: true, v: (c) => st(c).owed || '', html: (c) => st(c).owed > 0 ? '<span style="color:var(--bad);font-weight:700">' + fmt(st(c).owed) + '</span>' : dtNil, total: (rows) => fmt(dtSum(rows, (c) => st(c).owed)) },
      { k: 'lim', label: 'Credit limit', money: true, v: (c) => { const l = KC.creditLimitOf(S(), c); return l === null ? '' : l; } },
      { k: 'left', label: 'Credit left', money: true, v: (c) => { const l = KC.creditLimitOf(S(), c); return l === null ? '' : Math.max(0, l - st(c).owed); } },
      { k: 'last', label: 'Last purchase', core: true, v: (c) => st(c).last, html: (c) => dtDate(st(c).last) },
      { k: 'since', label: 'Customer since', v: (c) => (c.createdAt || '').slice(0, 10), html: (c) => dtDate((c.createdAt || '').slice(0, 10)) },
    ],
  });
}
function expTable(list, id, opts = {}) {
  return dataTable({
    id, rows: list, noun: 'expense', empty: opts.empty || 'No expenses here.',
    rowAttr: (e) => ' data-a="expEdit" data-id="' + e.id + '"',
    cols: [
      opts.noDate ? null : { k: 'date', label: 'Date', core: true, v: (e) => e.date, html: (e) => dtDate(e.date) },
      { k: 'cat', label: 'What for', core: true, v: (e) => e.category, html: (e) => '<b>' + esc(e.category) + '</b>' },
      { k: 'desc', label: 'Details', core: true, v: (e) => e.description || '' },
      { k: 'method', label: 'Paid by', core: true, v: (e) => e.method || 'Cash' },
      { k: 'amount', label: 'Amount', core: true, money: true, cls: 'b', v: (e) => num(e.amount), total: (rows) => fmt(dtSum(rows, (e) => e.amount)) },
      { k: 'by', label: 'Recorded by', v: (e) => e.by || '', cls: 'mut' },
      allLocs().length > 1 ? { k: 'branch', label: 'Branch', v: (e) => locName(e.locationId || 'main'), cls: 'mut' } : null,
      K.raw.assets.length ? { k: 'asset', label: 'Asset', v: (e) => e.assetId ? assetName(e.assetId) : '', cls: 'mut' } : null,
    ],
  });
}

/* ---------- settings: online shop ---------- */
const newShopKey = () => { const a = new Uint8Array(10); crypto.getRandomValues(a); return Array.from(a, (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join(''); };
function shopCard() {
  const s = S(); const on = !!s.shopEnabled && !!s.shopId;
  if (K.info.mode !== 'saas') return '<div class="card pad2 mb"><h2 class="mb">Online shop</h2><p class="muted small" style="margin:0">Clients can browse your stock and send orders with their delivery details from a public link. This needs the online (server) version of Kargo.</p></div>';
  return '<div class="card pad2 mb" id="shopCard"><div class="row between wrap mb"><h2>Online shop</h2>' + (on ? '<span class="badge ok">On</span>' : '<span class="badge">Off</span>') + '</div>' +
    '<p class="muted small" style="margin-top:0">A public page where clients see items in stock with prices and photos, choose quantities and type their own details: name, phone, delivery (pickup, local, travel agency, courier), town, agency, recipient name and number. Orders arrive under <a href="#orders">Online orders</a> for you to confirm. Costs and exact stock are never shown.</p>' +
    (on ? '<div class="alert info mb row between wrap"><b style="word-break:break-all">' + esc(shopLink()) + '</b><span class="row"><button class="btn sm" data-a="shopCopy">' + ic('copy', 'sm') + 'Copy</button><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent('Order from ' + s.businessName + ' here: ' + shopLink()) + '">' + ic('wa', 'sm') + 'Share</a><a class="btn sm" target="_blank" rel="noopener" href="' + esc(shopLink()) + '">Open</a></span></div>' : '') +
    '<label class="toggle mb"><input type="checkbox" id="shopOn"' + (on ? ' checked' : '') + '> Online shop is on</label>' +
    field('Message at the top of your shop (optional)', '<textarea class="inp" id="shopMsg" rows="2" maxlength="300" placeholder="e.g. Delivery everywhere in Cameroon by travel agency. Pay by MTN MoMo or Orange Money.">' + esc(s.shopMessage || '') + '</textarea>') +
    field('Travel agencies you use (one per line — clients can pick them)', '<textarea class="inp" id="shopAg" rows="3" placeholder="General Express&#10;Buca Voyages&#10;Touristique Express">' + esc((s.shopAgencies || []).join('\n')) + '</textarea>') +
    '<div class="row wrap mt"><button class="btn pri" data-a="shopSave">' + ic('check') + 'Save online shop</button>' + (s.shopId ? '<button class="btn" data-a="shopNewLink">New link</button>' : '') + '</div></div>';
}
A.shopSave = async () => {
  const on = $('#shopOn').checked; const s = S();
  const patch = { shopEnabled: on, shopId: s.shopId || newShopKey(), shopMessage: $('#shopMsg').value.trim().slice(0, 300), shopAgencies: $('#shopAg').value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 30) };
  await saveSettings(patch); toast(on ? 'Online shop is on — copy the link and share it' : 'Online shop saved (off)'); render(true);
};
A.shopNewLink = async () => {
  if (!(await confirmBox('Make a new shop link? The old link will stop working for anyone who has it.', 'New link', true))) return;
  await saveSettings({ shopId: newShopKey() }); toast('New link ready'); render(true);
};

/* ---------- settings: MoMo / Orange Money withdrawal charges (visual editor, no JSON) ---------- */
const FEE_OPS = ['MTN MoMo', 'Orange Money'];
const feeCopy = (t) => JSON.parse(JSON.stringify(t || KC.DEFAULT_MOMO_FEE_TABLES));
/** Problems in one operator's grid. errors block saving; warnings are only shown. */
function feeIssues(tiers) {
  const errors = [], warnings = [];
  const rows = tiers.map((t, i) => Object.assign({ n: i + 1 }, t)).sort((a, b) => num(a.min) - num(b.min));
  tiers.forEach((t, i) => {
    const n = 'Range ' + (i + 1);
    if (t.min === '' || t.min === null || t.min === undefined) errors.push(n + ': type the "From" amount');
    if (t.max !== '' && t.max !== null && t.max !== undefined && num(t.max) < num(t.min)) errors.push(n + ': "To" is below "From"');
    if (t.type === 'pct' ? t.pct === '' || t.pct === undefined || t.pct === null : t.fee === '' || t.fee === undefined || t.fee === null) errors.push(n + ': type the ' + (t.type === 'pct' ? 'percentage' : 'charge'));
    if ([t.min, t.max, t.fee, t.pct, t.taxPct, t.taxFixed].some((v) => v !== '' && v !== null && v !== undefined && num(v) < 0)) errors.push(n + ': amounts cannot be negative');
  });
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i]; const aMax = a.max === '' || a.max == null ? Infinity : num(a.max);
    if (num(b.min) <= aMax) errors.push('Ranges ' + a.n + ' and ' + b.n + ' overlap');
    else if (num(b.min) > aMax + 1) warnings.push('No charge for amounts from ' + fmt(aMax + 1) + ' to ' + fmt(num(b.min) - 1) + ' F');
  }
  // operators have their own minimum and maximum withdrawal, so the outer edges are information, not a problem
  const last = rows[rows.length - 1];
  const covers = rows.length ? fmt(num(rows[0].min)) + ' F – ' + (last.max === '' || last.max == null ? 'no limit' : fmt(num(last.max)) + ' F') : '';
  return { errors, warnings, covers };
}
function feeEditor() { return '<div id="feeEd">' + feeEditorInner() + '</div>'; }
function feeEditorInner() {
  const op = K.ui.feeOp || FEE_OPS[0]; const tiers = K.ui.feeDraft[op] || (K.ui.feeDraft[op] = []);
  const tables = Object.assign({}, K.ui.feeDraft); const iss = feeIssues(tiers);
  const numIn = (i, k, v, unit, ph) => '<div class="fee-in"><input class="inp" inputmode="decimal" data-ft="' + k + '" data-fi="' + i + '" value="' + (v === undefined || v === null ? '' : esc(v)) + '" placeholder="' + (ph || '') + '" aria-label="' + k + ' for range ' + (i + 1) + '"><span>' + unit + '</span></div>';
  const top = (t) => { const hi = t.max === '' || t.max == null ? null : num(t.max); return hi === null ? '—' : fmt(KC.calcMomoFee(op, hi, { momoFeeTables: tables })) + ' F'; };
  const tryAmt = K.ui.feeTry === undefined ? 50000 : K.ui.feeTry; const tryFee = KC.calcMomoFee(op, tryAmt, { momoFeeTables: tables });
  return '<div class="row wrap between mb"><div class="seg" role="tablist">' + FEE_OPS.map((o) => '<button type="button" role="tab" aria-selected="' + (o === op) + '" class="' + (o === op ? 'on' : '') + '" data-a="feeOp" data-v="' + esc(o) + '">' + esc(o) + ' <span class="tiny muted">' + (K.ui.feeDraft[o] || []).length + '</span></button>').join('') + '</div>' +
      '<div class="row wrap"><button type="button" class="btn sm" data-a="feeAdd">' + ic('plus', 'sm') + 'Add a range</button><button type="button" class="btn sm" data-a="feeReset">Reset to standard grid</button></div></div>' +
    (tiers.length ? '<div class="card tw"><table class="t fee-tbl"><thead><tr><th>#</th><th>From</th><th>To</th><th>Charge type</th><th>Charge</th><th>+ Tax</th><th>+ Extra</th><th class="r">Charge at top of range</th><th></th></tr></thead><tbody>' +
      tiers.map((t, i) => { const pct = t.type === 'pct'; return '<tr><td class="muted">' + (i + 1) + '</td>' +
        '<td>' + numIn(i, 'min', t.min, 'F', '0') + '</td><td>' + numIn(i, 'max', t.max, 'F', 'No limit') + '</td>' +
        '<td><select class="inp" data-ft="type" data-fi="' + i + '" aria-label="Charge type for range ' + (i + 1) + '"><option value="fixed"' + (pct ? '' : ' selected') + '>Fixed amount</option><option value="pct"' + (pct ? ' selected' : '') + '>Percentage</option></select></td>' +
        '<td>' + (pct ? numIn(i, 'pct', t.pct, '%', '1') : numIn(i, 'fee', t.fee, 'F', '0')) + '</td>' +
        '<td>' + (pct ? numIn(i, 'taxPct', t.taxPct, '%', '0') : dtNil) + '</td><td>' + (pct ? numIn(i, 'taxFixed', t.taxFixed, 'F', '0') : dtNil) + '</td>' +
        '<td class="r b fee-top" data-top="' + i + '">' + top(t) + '</td>' +
        '<td><button type="button" class="icon-btn" data-a="feeDel" data-i="' + i + '" title="Remove this range" aria-label="Remove range ' + (i + 1) + '">' + ic('trash', 'sm') + '</button></td></tr>'; }).join('') +
      '</tbody></table></div>' : '<div class="card empty small">No ranges for ' + esc(op) + ' — no charge will be suggested. <button type="button" class="btn sm" data-a="feeAdd">Add a range</button></div>') +
    '<div id="feeMsgs">' + feeMsgs(iss) + '</div>' +
    '<div class="card pad mt fee-try"><div class="row wrap"><b>Try it</b><span class="muted small">A customer pays</span><div class="fee-in" style="width:150px"><input class="inp" inputmode="numeric" id="feeTry" value="' + esc(tryAmt) + '" aria-label="Amount to test"><span>F</span></div><span class="muted small">by ' + esc(op) + ' →</span>' +
      '<span>charge <b id="feeTryOut">' + fmt(tryFee) + ' F</b></span><span class="muted small">· customer sends <b id="feeTryGross">' + fmt(num(tryAmt) + tryFee) + ' F</b></span></div></div>';
}
const feeMsgs = (iss) => (iss.errors.length ? '<div class="alert bad mt">' + iss.errors.map(esc).join('<br>') + '</div>' : '') + (iss.warnings.length ? '<div class="alert mt small">' + iss.warnings.map(esc).join('<br>') + '</div>' : '') + (!iss.errors.length && !iss.warnings.length && iss.covers ? '<div class="tiny mt" style="color:var(--ok)">✓ Ranges are complete and do not overlap · covers ' + esc(iss.covers) + '</div>' : '');
/** Refresh the parts that depend on the numbers without redrawing the inputs (keeps the cursor where it is). */
function feeLive() {
  const op = K.ui.feeOp || FEE_OPS[0]; const tables = K.ui.feeDraft; const tiers = tables[op] || [];
  tiers.forEach((t, i) => { const c = $('[data-top="' + i + '"]'); if (c) c.textContent = t.max === '' || t.max == null ? '—' : fmt(KC.calcMomoFee(op, num(t.max), { momoFeeTables: tables })) + ' F'; });
  const m = $('#feeMsgs'); if (m) m.innerHTML = feeMsgs(feeIssues(tiers));
  const amt = num(K.ui.feeTry === undefined ? 50000 : K.ui.feeTry); const f = KC.calcMomoFee(op, amt, { momoFeeTables: tables });
  if ($('#feeTryOut')) { $('#feeTryOut').textContent = fmt(f) + ' F'; $('#feeTryGross').textContent = fmt(amt + f) + ' F'; }
}
const feeRedraw = () => { const e = $('#feeEd'); if (e) e.innerHTML = feeEditorInner(); };
['input', 'change'].forEach((evt) => document.addEventListener(evt, (e) => {
  const t = e.target;
  if (t.id === 'feeTry') { K.ui.feeTry = t.value; return feeLive(); }
  if (!t.dataset || !t.dataset.ft) return;
  const op = K.ui.feeOp || FEE_OPS[0]; const row = (K.ui.feeDraft[op] || [])[+t.dataset.fi]; if (!row) return;
  const k = t.dataset.ft;
  if (k === 'type') { row.type = t.value; if (row.type === 'pct') { delete row.fee; row.pct = row.pct ?? ''; row.taxPct = row.taxPct ?? ''; row.taxFixed = row.taxFixed ?? ''; } else { row.fee = row.fee ?? ''; delete row.pct; delete row.taxPct; delete row.taxFixed; } return feeRedraw(); }
  row[k] = t.value.trim() === '' ? '' : num(t.value); feeLive();
}));
A.feeOp = (el) => { K.ui.feeOp = el.dataset.v; feeRedraw(); };
A.feeAdd = () => {
  const op = K.ui.feeOp || FEE_OPS[0]; const tiers = K.ui.feeDraft[op] || (K.ui.feeDraft[op] = []);
  const last = tiers.slice().sort((a, b) => num(a.min) - num(b.min)).pop(); const from = last ? (last.max === '' || last.max == null ? '' : num(last.max) + 1) : 0;
  tiers.push({ min: from, max: '', type: 'fixed', fee: '' }); K.viewDirty = true; feeRedraw();
  const ins = $$('#feeEd [data-ft="fee"]'); if (ins.length) ins[ins.length - 1].focus();
};
A.feeDel = (el) => { const op = K.ui.feeOp || FEE_OPS[0]; (K.ui.feeDraft[op] || []).splice(+el.dataset.i, 1); K.viewDirty = true; feeRedraw(); };
A.feeReset = async () => {
  const op = K.ui.feeOp || FEE_OPS[0];
  if (!(await confirmBox('Replace the ' + op + ' ranges with the standard Cameroon grid? Your changes for ' + op + ' are lost (only after you press Save).', 'Reset', true))) return;
  K.ui.feeDraft[op] = feeCopy(KC.DEFAULT_MOMO_FEE_TABLES)[op] || []; K.viewDirty = true; feeRedraw();
};
/** The edited grid, cleaned and sorted, or { error } — used by the Settings Save button. */
function feeDraftForSave() {
  const out = {};
  for (const op of Object.keys(K.ui.feeDraft || {})) {
    const iss = feeIssues(K.ui.feeDraft[op]); if (iss.errors.length) return { error: op + ' charges — ' + iss.errors[0] };
    out[op] = K.ui.feeDraft[op].map((t) => t.type === 'pct'
      ? { min: num(t.min), max: t.max === '' || t.max == null ? null : num(t.max), type: 'pct', pct: num(t.pct), taxPct: num(t.taxPct), taxFixed: num(t.taxFixed) }
      : { min: num(t.min), max: t.max === '' || t.max == null ? null : num(t.max), type: 'fixed', fee: num(t.fee) }).sort((a, b) => a.min - b.min);
  }
  return { tables: out };
}

/* ---------- settings: stores (chips) and categories (list editor) ---------- */
// Working copies, refreshed each time Settings is drawn. Saved with the Settings "Save" button.
// Each category / subcategory remembers its original name so renames can move the items that use it.
function catDraftFrom(cats) { return Object.entries(cats || KC.CATEGORIES).map(([name, subs]) => ({ name, orig: name, subs: (subs || []).map((x) => ({ name: x, orig: x })) })); }
const catUse = (cat) => K.raw.products.filter((p) => !p.archived && (p.category || 'Other') === cat).length;
const subUse = (cat, sub) => K.raw.products.filter((p) => !p.archived && (p.category || 'Other') === cat && (p.subcategory || '') === sub).length;
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/* stores: chips + "type and press Enter" */
function storeEditor() {
  return '<div class="tag-box" id="storeBox">' + K.ui.storeDraft.map((s, i) => '<span class="tag">' + esc(s) + '<button type="button" data-a="storeDel" data-i="' + i + '" aria-label="Remove ' + esc(s) + '">×</button></span>').join('') +
    '<input id="storeIn" placeholder="' + (K.ui.storeDraft.length ? 'Add another store…' : 'Type a store and press Enter') + '" aria-label="Add a store" autocomplete="off"></div>';
}
function storeAdd(raw) {
  const names = String(raw || '').split(',').map((x) => x.trim()).filter(Boolean); let added = 0;
  names.forEach((n) => { if (!K.ui.storeDraft.some((s) => sameName(s, n))) { K.ui.storeDraft.push(n.slice(0, 60)); added++; } });
  if (added) { setDirty(); const box = $('#storeBox'); box.outerHTML = storeEditor(); $('#storeIn').focus(); }
  return added;
}
A.storeDel = (el) => { K.ui.storeDraft.splice(+el.dataset.i, 1); setDirty(); $('#storeBox').outerHTML = storeEditor(); $('#storeIn').focus(); };
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'storeIn') {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); const v = e.target.value; if (v.trim()) { if (!storeAdd(v)) { e.target.value = ''; toast('Already in the list'); } } }
    else if (e.key === 'Backspace' && !e.target.value && K.ui.storeDraft.length) { K.ui.storeDraft.pop(); setDirty(); $('#storeBox').outerHTML = storeEditor(); $('#storeIn').focus(); }
  }
});
document.addEventListener('focusout', (e) => { if (e.target.id === 'storeIn' && e.target.value.trim()) storeAdd(e.target.value); });
document.addEventListener('click', (e) => { if (e.target.id === 'storeBox') $('#storeIn').focus(); });

/* categories */
function catEditor() { return '<div id="catEd">' + catEditorInner() + '</div>'; }
function catEditorInner() {
  const d = K.ui.catDraft; const q = (K.ui.catQ || '').trim().toLowerCase();
  const subTotal = d.reduce((a, c) => a + c.subs.length, 0);
  const list = d.map((c, i) => ({ c, i })).filter(({ c }) => !q || c.name.toLowerCase().includes(q) || c.subs.some((s) => s.name.toLowerCase().includes(q)));
  const row = ({ c, i }) => {
    const open = q ? true : !!K.ui.catOpen[c.orig || c.name]; const used = catUse(c.orig || c.name); const renaming = K.ui.catRen === i;
    const subs = c.subs.map((s, j) => { const u = subUse(c.orig || c.name, s.orig || s.name); const hit = q && s.name.toLowerCase().includes(q);
      return '<span class="tag' + (hit ? ' hit' : '') + '">' + esc(s.name) + (u ? '<em>' + u + '</em>' : '') + '<button type="button" data-a="subDel" data-i="' + i + '" data-j="' + j + '" aria-label="Remove ' + esc(s.name) + '">×</button></span>'; }).join('');
    return '<div class="cat-row' + (open ? ' open' : '') + '" data-ci="' + i + '">' +
      '<div class="cat-head">' +
        '<button type="button" class="cat-tog" data-a="catTog" data-i="' + i + '" aria-expanded="' + open + '" aria-label="Show subcategories of ' + esc(c.name) + '">' + ic(open ? 'down' : 'chev', 'sm') + '</button>' +
        (renaming ? '<input class="inp cat-ren" id="catRen" value="' + esc(c.name) + '" aria-label="New name" maxlength="60">' + '<button type="button" class="btn sm pri" data-a="catRenOk" data-i="' + i + '">Save name</button><button type="button" class="btn sm ghost" data-a="catRenNo">Cancel</button>'
          : '<button type="button" class="cat-name" data-a="catTog" data-i="' + i + '">' + esc(c.name) + (c.orig && c.orig !== c.name ? ' <span class="badge info">renamed</span>' : '') + (!c.orig ? ' <span class="badge ok">new</span>' : '') + '</button>' +
            '<span class="cat-meta">' + c.subs.length + ' subcategor' + (c.subs.length === 1 ? 'y' : 'ies') + ' · ' + (used ? used + ' item' + (used === 1 ? '' : 's') : 'no items yet') + '</span>' +
            '<span class="cat-acts"><button type="button" class="btn sm ghost" data-a="catRen" data-i="' + i + '" title="Rename" aria-label="Rename ' + esc(c.name) + '">' + ic('edit', 'sm') + '<span class="ren-t">Rename</span></button><button type="button" class="icon-btn" data-a="catDel" data-i="' + i + '" title="Delete category" aria-label="Delete ' + esc(c.name) + '">' + ic('trash', 'sm') + '</button></span>') +
      '</div>' +
      (open ? '<div class="cat-body"><div class="tag-box">' + subs + '<input data-subin="' + i + '" placeholder="Add a subcategory and press Enter" aria-label="Add a subcategory to ' + esc(c.name) + '" autocomplete="off"></div><div class="hint">Numbers show how many items use each subcategory.</div></div>' : '') + '</div>';
  };
  return '<div class="cat-tools"><div class="search grow">' + ic('search') + '<input class="inp" id="catQ" placeholder="Search categories and subcategories" value="' + esc(K.ui.catQ || '') + '" autocomplete="off"></div>' +
      '<button type="button" class="btn sm" data-a="catSort">Sort A–Z</button><button type="button" class="btn sm" data-a="catSuggest">' + ic('plus', 'sm') + 'Add suggested</button></div>' +
    '<div class="cat-sum hint">' + d.length + ' categories · ' + subTotal + ' subcategories' + (q ? ' · showing ' + list.length + ' matching' : '') + '</div>' +
    '<div class="cat-list">' + (list.length ? list.map(row).join('') : '<div class="empty small">No category or subcategory matches “' + esc(K.ui.catQ) + '”.</div>') + '</div>' +
    '<div class="cat-new"><input class="inp" id="catNew" placeholder="New category, e.g. Baby & Kids" maxlength="60" autocomplete="off" aria-label="New category name"><button type="button" class="btn" data-a="catAdd">' + ic('plus') + 'Add category</button></div>';
}
const catRedraw = (focusSel) => { const e = $('#catEd'); if (!e) return; e.innerHTML = catEditorInner(); if (focusSel) { const f = $(focusSel); if (f) { f.focus(); if (f.select && focusSel === '#catRen') f.select(); } } };
const catExists = (name, exceptIndex) => K.ui.catDraft.some((c, i) => i !== exceptIndex && sameName(c.name, name));
A.catTog = (el) => { const c = K.ui.catDraft[+el.dataset.i]; const k = c.orig || c.name; K.ui.catOpen[k] = !K.ui.catOpen[k]; catRedraw(K.ui.catOpen[k] ? '[data-subin="' + el.dataset.i + '"]' : null); };
A.catAdd = () => {
  const inp_ = $('#catNew'); const name = inp_.value.trim();
  if (!name) { inp_.focus(); return toast('Type the new category name', true); }
  if (catExists(name)) return toast('“' + name + '” already exists', true);
  K.ui.catDraft.push({ name, orig: '', subs: [] }); K.ui.catOpen[name] = true; K.ui.catQ = ''; setDirty();
  catRedraw('[data-subin="' + (K.ui.catDraft.length - 1) + '"]');
};
A.catRen = (el) => { K.ui.catRen = +el.dataset.i; catRedraw('#catRen'); };
A.catRenNo = () => { K.ui.catRen = null; catRedraw(); };
A.catRenOk = (el) => {
  const i = +el.dataset.i; const name = ($('#catRen').value || '').trim();
  if (!name) return toast('The name cannot be empty', true);
  if (catExists(name, i)) return toast('“' + name + '” already exists', true);
  const c = K.ui.catDraft[i]; const k = c.orig || c.name; c.name = name; K.ui.catRen = null; K.ui.catOpen[c.orig || name] = K.ui.catOpen[k]; setDirty(); catRedraw();
};
A.catDel = async (el) => {
  const i = +el.dataset.i; const c = K.ui.catDraft[i]; const used = c.orig ? catUse(c.orig) : 0;
  if (used) return toast(used + ' item' + (used === 1 ? ' uses' : 's use') + ' “' + c.name + '”. Move them to another category first, or rename it instead.', true);
  if (c.subs.length && !(await confirmBox('Delete “' + c.name + '” and its ' + c.subs.length + ' subcategories?', 'Delete', true))) return;
  K.ui.catDraft.splice(i, 1); setDirty(); catRedraw();
};
A.subDel = (el) => {
  const c = K.ui.catDraft[+el.dataset.i]; const s = c.subs[+el.dataset.j]; const used = c.orig && s.orig ? subUse(c.orig, s.orig) : 0;
  if (used) return toast(used + ' item' + (used === 1 ? ' uses' : 's use') + ' “' + s.name + '”. Change them first.', true);
  c.subs.splice(+el.dataset.j, 1); setDirty(); catRedraw('[data-subin="' + el.dataset.i + '"]');
};
A.catSort = () => { K.ui.catDraft.sort((a, b) => a.name.localeCompare(b.name)); K.ui.catDraft.forEach((c) => c.subs.sort((a, b) => a.name.localeCompare(b.name))); setDirty(); catRedraw(); toast('Sorted A–Z'); };
A.catSuggest = () => {
  let nc = 0, ns = 0;
  Object.entries(KC.CATEGORIES).forEach(([name, subs]) => {
    // a category you renamed from a suggested one counts as already there
    let c = K.ui.catDraft.find((x) => sameName(x.name, name) || (x.orig && sameName(x.orig, name)));
    if (!c) { c = { name, orig: '', subs: [] }; K.ui.catDraft.push(c); nc++; }
    subs.forEach((s) => { if (!c.subs.some((x) => sameName(x.name, s))) { c.subs.push({ name: s, orig: '' }); ns++; } });
  });
  if (!nc && !ns) return toast('You already have all the suggested categories');
  setDirty(); catRedraw(); toast('Added ' + nc + ' categor' + (nc === 1 ? 'y' : 'ies') + ' and ' + ns + ' subcategories — press Save to keep them');
};
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.subin !== undefined && (e.key === 'Enter' || e.key === ',')) {
    e.preventDefault(); const i = +t.dataset.subin; const c = K.ui.catDraft[i]; const names = t.value.split(',').map((x) => x.trim()).filter(Boolean);
    if (!names.length) return; let dup = '';
    names.forEach((n) => { if (c.subs.some((s) => sameName(s.name, n))) dup = n; else c.subs.push({ name: n.slice(0, 60), orig: '' }); });
    if (dup) toast('“' + dup + '” is already in ' + c.name);
    setDirty(); catRedraw('[data-subin="' + i + '"]');
  } else if (t.id === 'catNew' && e.key === 'Enter') { e.preventDefault(); A.catAdd(); }
  else if (t.id === 'catRen' && e.key === 'Enter') { e.preventDefault(); A.catRenOk({ dataset: { i: K.ui.catRen } }); }
  else if (t.id === 'catRen' && e.key === 'Escape') { e.preventDefault(); A.catRenNo(); }
});
document.addEventListener('input', (e) => { if (e.target.id === 'catQ') { K.ui.catQ = e.target.value; const pos = e.target.selectionStart; catRedraw('#catQ'); const q = $('#catQ'); if (q) q.setSelectionRange(pos, pos); } });
/** For Save: the categories object, and the renames to apply to items. */
function catDraftForSave() {
  const d = K.ui.catDraft; const cats = {}; const moves = [];
  d.forEach((c) => {
    cats[c.name] = c.subs.map((s) => s.name);
    if (c.orig && c.orig !== c.name) moves.push({ from: c.orig, to: c.name });
    c.subs.forEach((s) => { if (s.orig && s.orig !== s.name) moves.push({ from: c.orig, sub: s.orig, to: c.name, toSub: s.name }); });
  });
  const items = K.raw.products.filter((p) => moves.some((m) => (p.category || 'Other') === m.from && (m.sub === undefined || (p.subcategory || '') === m.sub)));
  return { cats, moves, items };
}
