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
      '<div class="sec"><div class="sech"><h2>Recent sales</h2><a href="#sales" class="small b">All</a></div><div class="card list">' + salesRows(recent) + '</div></div>';
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
      '<div class="card list">' + (list.length ? list.map((c) => { const st = stats[c.id] || { n: 0, total: 0, owed: 0 }; return '<div class="li" data-a="openCust" data-id="' + c.id + '"><div class="av">' + esc(initials(c.name)) + '</div><div class="grow" style="min-width:0"><div class="t ellipsis">' + esc(c.name) + (c.type && c.type !== 'Retail' ? ' <span class="badge brand">' + esc(c.type) + '</span>' : '') + '</div><div class="tiny muted">' + esc([c.phone, c.city].filter(Boolean).join(' · ')) + '</div></div><div class="right"><div class="b money">' + F(st.total) + '</div><div class="tiny muted">' + st.n + ' purchase(s)</div>' + (st.owed > 0 ? '<div class="tiny b" style="color:var(--bad)">owes ' + fmt(st.owed) + '</div>' : '') + '</div></div>'; }).join('') : '<div class="empty"><div class="big">👥</div>No customers yet.</div>') + '</div>';
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
      (c.notes ? '<div class="alert info mb">' + esc(c.notes) + '</div>' : '') + '<h3 class="mb">Purchase history</h3><div class="card list">' + salesRows(sales) + '</div>');
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
VIEWS.expenses = {
  render() {
    const m = K.ui.expMonth || monthStr(); const list = K.raw.expenses.filter((e) => (e.date || '').slice(0, 7) === m).sort((a, b) => b.date.localeCompare(a.date));
    return '<div class="row wrap mb"><button class="btn pri" data-a="expEdit">' + ic('plus') + 'Add expense</button><input type="month" class="inp" style="width:auto" value="' + m + '" data-c="expMonth"></div>' +
      '<div class="alert info mb">For running costs in Cameroon (rent, wages, transport, repairs, fuel…). Container costs go inside each container. Buying equipment or a vehicle? Register it under <a href="#assets">Assets</a> instead — it is spread over its life.</div>' +
      '<div class="kpis mb">' + kpi('Expenses this month', F(list.reduce((a, e) => a + num(e.amount), 0)), list.length + ' entries', true) + '</div>' +
      '<div class="card list">' + (list.length ? list.map((e) => '<div class="li" data-a="expEdit" data-id="' + e.id + '"><div class="av ink">' + ic('wallet', 'sm') + '</div><div class="grow"><div class="t">' + esc(e.category) + '</div><div class="tiny muted">' + fmtDate(e.date) + (e.description ? ' · ' + esc(e.description) : '') + (e.assetId ? ' · ' + esc(assetName(e.assetId)) : '') + ' · ' + esc(e.method || '') + '</div></div><b class="money">' + F(e.amount) + '</b></div>').join('') : '<div class="empty small">No expenses this month.</div>') + '</div>';
  },
};
CH.expMonth = (el) => { K.ui.expMonth = el.value; render(true); };
A.expEdit = (el) => {
  const id = el.dataset.id; const e = id ? byId('expenses', id) : { date: todayStr(), method: 'Cash', category: KC.EXPENSE_CATS[0] };
  const sh = openSheet({ title: id ? 'Edit expense' : 'Add expense', body: '<div class="col"><div class="grid2">' + field('Date', inp('date', e.date, 'type="date"')) + field('Amount (F)', inp('amount', e.amount, 'inputmode="numeric"')) + field('Category', sel('category', KC.EXPENSE_CATS, e.category)) + field('Paid by', sel('method', KC.PAY_METHODS, e.method)) + '</div>' + field('Description', inp('description', e.description)) + (K.raw.assets.length ? field('For asset (optional)', sel('assetId', [['', '—']].concat(K.raw.assets.filter((a) => !KC.assetGone(a) || a.id === e.assetId).map((a) => [a.id, a.name + (a.tag ? ' · ' + a.tag : '')])), e.assetId || '')) : '') + '</div>', foot: (id ? '<button class="btn danger" id="eDel">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="eSave">Save</button>' });
  $('#eSave', sh).onclick = async () => { const v = formVals(sh); v.amount = num(v.amount); if (!v.amount) return toast('Enter an amount', true); if (await save('expenses', Object.assign({ locationId: K.loc }, e, v, { id: id || uid('e_') }))) { closeSheet(); scheduleRender(); } };
  if (id) $('#eDel', sh).onclick = async () => { if (await confirmBox('Delete this expense?', 'Delete', true)) { await remove('expenses', id); closeSheet(); scheduleRender(); } };
};

/* ---------- settings + backup ---------- */
VIEWS.settings = {
  form: true,
  render() {
    const s = S();
    if (!can('settings')) return '<div class="card pad2 mb"><h2 class="mb">Downloads</h2><div class="row wrap"><button class="btn" data-a="backupXlsx">' + ic('dl') + 'All data as Excel</button><button class="btn" data-a="backupJson">' + ic('dl') + 'Full backup</button></div></div>';
    return '<div class="card pad2 mb"><h2 class="mb">Backup & restore</h2><p class="muted small" style="margin-top:0">Download <b>all</b> records to keep safe. You can restore this file here or load it into the full version of the app.</p><div class="row wrap"><button class="btn pri" data-a="backupJson">' + ic('dl') + 'Download full backup</button><button class="btn" data-a="backupXlsx">' + ic('dl') + 'All data as Excel</button><button class="btn" data-a="restore">' + ic('up') + 'Restore from backup</button></div><div class="tiny faint mt">Last backup: ' + (s.lastBackup ? fmtDT(s.lastBackup) : 'never') + '</div></div>' +
      '<div class="card pad2 mb" id="setForm"><h2 class="mb">Business</h2><div class="row mb">' + logoHTML('logo" style="width:64px;height:64px;font-size:22px') + '<div class="col gap6"><button class="btn sm" data-a="logoUp">' + ic('up', 'sm') + 'Upload logo</button>' + (s.logo ? '<button class="btn sm ghost" data-a="logoDel">Remove</button>' : '') + '</div></div>' +
      '<div class="grid2">' + field('Business name', inp('businessName', s.businessName)) + field('Tagline', inp('tagline', s.tagline)) + field('Phone (on receipts)', inp('phone', s.phone)) + field('Address', inp('address', s.address)) + '</div>' + field('Receipt footer', inp('receiptFooter', s.receiptFooter), 'mt') +
      currencyBlock(s) + '<h2 class="mt2 mb">Pricing defaults</h2><div class="grid3">' + field('Default markup %', inp('defaultMarkup', s.defaultMarkup, 'inputmode="decimal"')) + field('Minimum markup % (bulk)', inp('minMarkup', s.minMarkup, 'inputmode="decimal"')) + field('Round prices up to (F)', inp('roundTo', s.roundTo, 'inputmode="numeric"')) + field('Low stock alert at', inp('lowStock', s.lowStock, 'inputmode="numeric"')) + field('Expiry warning (days)', inp('expiryWarnDays', s.expiryWarnDays, 'inputmode="numeric"')) + '</div>' +
      '<h2 class="mt2 mb">Wholesale & credit</h2><div class="grid3">' + field('Wholesale markup %', inp('wholesaleMarkup', s.wholesaleMarkup, 'inputmode="decimal"')) + field('Bulk price from qty (0 = off)', inp('bulkQty', s.bulkQty, 'inputmode="numeric"')) + field('Days to pay (credit sales)', inp('creditDays', s.creditDays, 'inputmode="numeric"')) + '</div>' +
      '<div class="grid2 mt">' + field('Default credit limit per customer (F)', inp('defaultCreditLimit', s.defaultCreditLimit ?? '', 'inputmode="numeric" placeholder="Empty = no limit"')) + '<div class="tiny muted" style="align-self:end;padding-bottom:12px">Set a different limit on any customer. 0 = cash only.</div></div>' +
      '<div class="tiny muted mt">Who can see costs and profit is set per person in <a href="#team">Team & access</a>.</div>' +
      '<h2 class="mt2 mb">Mobile money numbers (receiving)</h2><div id="momoList">' + (s.momoAccounts || []).map((a, i) => '<div class="grid3 mb" data-mm="' + i + '">' + sel('mmMethod' + i, ['MTN MoMo', 'Orange Money', 'Bank transfer'], a.method) + inp('mmNumber' + i, a.number, 'placeholder="Number" inputmode="tel"') + inp('mmLabel' + i, a.label, 'placeholder="Label e.g. Boss MoMo"') + '</div>').join('') + '</div><button class="btn sm" data-a="mmAdd">' + ic('plus', 'sm') + 'Add number</button>' +
      '<h2 class="mt2 mb">Payment reminder message</h2><div class="tiny muted mb">Words in braces are filled in: {name} {balance} {due} {business} {momo} {receipts}</div><textarea class="inp" name="reminderTemplate">' + esc(s.reminderTemplate || '') + '</textarea>' + field('Remind the same customer at most every (days)', inp('reminderEvery', s.reminderEvery, 'inputmode="numeric"'), 'mt') +
      '<h2 class="mt2 mb">Stores you buy from</h2>' + field('Comma-separated', inp('vendors', (s.vendors || []).join(', '))) +
      '<h2 class="mt2 mb">Categories</h2><div class="tiny muted mb">One per line: <b>Category: sub1, sub2</b></div><textarea class="inp" name="categories" style="min-height:180px;font-size:14px">' + esc(Object.entries(s.categories || KC.CATEGORIES).map(([k, v]) => k + ': ' + v.join(', ')).join('\n')) + '</textarea>' +
      '<button class="btn pri lg block mt2" data-a="saveSettings">Save settings</button></div>' +
      locationsCard() + (K.info.mode === 'saas' ? '<div class="card pad2 mb"><div class="row between"><div><h2>Account</h2>' + (K.info.tenant ? '<div class="small muted">Plan: <b>' + esc(K.info.tenant.plan) + '</b>' + (K.info.tenant.trialEndsAt ? ' · trial ends ' + fmtDate(String(K.info.tenant.trialEndsAt).slice(0, 10)) : '') + '</div>' : '') + '</div><button class="btn sm" data-a="logout">Sign out</button></div><div class="grid3 mt">' + field('Current password', '<input class="inp" type="password" id="pwOld">') + field('New password', '<input class="inp" type="password" id="pwNew">') + '<button class="btn" style="align-self:end" data-a="pwChange">Change password</button></div></div>' : '');
  },
};
const mmCount = () => $$('[data-mm]').length;
A.mmAdd = () => { $('#momoList').insertAdjacentHTML('beforeend', '<div class="grid3 mb" data-mm="' + mmCount() + '">' + sel('mmMethod' + mmCount(), ['MTN MoMo', 'Orange Money', 'Bank transfer'], 'MTN MoMo') + inp('mmNumber' + mmCount(), '', 'placeholder="Number" inputmode="tel"') + inp('mmLabel' + mmCount(), '', 'placeholder="Label"') + '</div>'); };
async function saveSettings(patch) {
  const cur = Object.assign({}, K.raw.settings, patch, { id: 'main' });
  K.raw.settings = cur; recompute();
  return save('settings', cur);
}
A.saveSettings = async () => {
  const v = formVals($('#setForm'));
  const cats = {}; v.categories.split('\n').forEach((line) => { const [k, rest] = line.split(':'); if (k && k.trim()) cats[k.trim()] = (rest || '').split(',').map((x) => x.trim()).filter(Boolean); });
  const mm = []; for (let i = 0; i < mmCount(); i++) if (v['mmNumber' + i]) mm.push({ method: v['mmMethod' + i], number: v['mmNumber' + i], label: v['mmLabel' + i] });
  const rates = {}; $$('[data-fxc]').forEach((i) => { const c = i.value.trim().toUpperCase(); const r = num($('[data-fxr="' + i.dataset.fxc + '"]').value); if (c && r > 0 && c !== v.baseCurrency) rates[c] = r; });
  const curInfo = KC.CURRENCIES.find((c) => c[0] === v.baseCurrency) || [v.baseCurrency, v.baseCurrency];
  const patch = { currency: v.baseCurrency || 'XAF', currencySymbol: v.currencySymbol || curInfo[1], fxRates: rates, fxRate: rates.USD || num(S().fxRate) || 600, businessName: v.businessName || 'My Business', tagline: v.tagline, phone: v.phone, address: v.address, receiptFooter: v.receiptFooter,  defaultMarkup: num(v.defaultMarkup), minMarkup: num(v.minMarkup), roundTo: num(v.roundTo), lowStock: num(v.lowStock), expiryWarnDays: num(v.expiryWarnDays), wholesaleMarkup: num(v.wholesaleMarkup), bulkQty: num(v.bulkQty), creditDays: num(v.creditDays) || 14, reminderTemplate: v.reminderTemplate, reminderEvery: num(v.reminderEvery) || 7, defaultCreditLimit: v.defaultCreditLimit === '' ? null : num(v.defaultCreditLimit), momoAccounts: mm, vendors: v.vendors.split(',').map((x) => x.trim()).filter(Boolean), categories: Object.keys(cats).length ? cats : KC.CATEGORIES };
  if (await saveSettings(patch)) { toast('Settings saved'); render(true); }
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
function refreshLogo() { const box = $('#setForm .logo'); if (box) box.outerHTML = logoHTML('logo" style="width:64px;height:64px;font-size:22px'); shell(); }
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
    SaleLines: K.raw.sales.flatMap((s) => (s.lines || []).map((l) => ({ receipt: s.no, date: saleDate(s), customer: s.customerName, item: l.name, qty: l.qty, unit_price: l.unitPrice, returned: (l.returns || []).reduce((a, r) => a + num(r.qty), 0) }))),
    Payments: K.raw.sales.flatMap((s) => (s.payments || []).map((p) => ({ receipt: s.no, customer: s.customerName, date: p.date, method: p.method, account: p.account, ref: p.ref, amount: p.amount }))),
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

function currencyBlock(s) {
  const rates = Object.entries(s.fxRates || { USD: s.fxRate || 600 });
  return '<h2 class="mt2 mb">Currency</h2><div class="tiny muted mb">Sales, prices, profit and reports are always in your local currency. Purchases abroad ($, €…) are converted with these rates, or with the rate set on each container.</div>' +
    '<div class="grid2">' + field('Your country\'s currency', '<select class="inp" name="baseCurrency" id="baseCur">' + KC.CURRENCIES.map((c) => '<option value="' + c[0] + '"' + (c[0] === (s.currency || 'XAF') ? ' selected' : '') + '>' + c[0] + ' — ' + esc(c[2]) + '</option>').join('') + '</select>') + field('Symbol on receipts', inp('currencySymbol', s.currencySymbol || 'F', 'id="curSym"')) + '</div>' +
    '<div class="card pad mt" id="fxBox"><div class="b mb">Exchange rates — 1 unit = how much ' + esc(s.currency || 'XAF') + '?</div>' + rates.map(([c, r], i) => '<div class="row mb"><input class="inp" style="width:90px" data-fxc="' + i + '" value="' + esc(c) + '"><span>=</span><input class="inp grow" inputmode="decimal" data-fxr="' + i + '" value="' + r + '"><span class="small muted">' + esc(s.currency || 'XAF') + '</span></div>').join('') +
    '<button class="btn sm" data-a="fxAdd">' + ic('plus', 'sm') + 'Add currency</button></div>';
}
A.fxAdd = () => { const box = $('#fxBox'); const i = $$('[data-fxc]').length; box.querySelector('[data-a=fxAdd]').insertAdjacentHTML('beforebegin', '<div class="row mb"><input class="inp" style="width:90px" data-fxc="' + i + '" placeholder="EUR"><span>=</span><input class="inp grow" inputmode="decimal" data-fxr="' + i + '" placeholder="655.957"><span class="small muted">' + esc(baseCode()) + '</span></div>'); };
document.addEventListener('change', (e) => { if (e.target.id === 'baseCur') { const c = KC.CURRENCIES.find((x) => x[0] === e.target.value); const sy = $('#curSym'); if (c && sy) sy.value = c[1]; } });

/* where every unit is right now: US → container → sea → port → cleared → warehouse/branches */
function journeyCard() {
  const st = [['us', 'Bought, in US storage'], ['planning', 'In a container (planning)'], ['loading', 'Loading in the US'], ['in_transit', 'At sea'], ['at_port', 'At port, Douala'], ['cleared', 'Cleared, on the way'], ['warehouse', 'In warehouse / branches · sellable']];
  const agg = {}; st.forEach(([k]) => (agg[k] = { u: 0, v: 0 }));
  K.raw.lots.forEach((l) => { const x = K.C.lotX[l.id]; if (!x) return; let k; if (x.stage === 'warehouse') k = 'warehouse'; else if (x.stage === 'us') k = 'us'; else k = (byId('shipments', l.shipmentId) || {}).status || 'planning'; if (!agg[k]) return; const u = k === 'warehouse' ? Math.max(0, x.available) + Math.max(0, x.clientAvail || 0) : num(l.qty) - x.sold; agg[k].u += Math.max(0, u); agg[k].v += Math.max(0, u) * x.landedUnit; });
  const max = Math.max(1, ...Object.values(agg).map((a) => a.u));
  return '<div class="sec"><div class="sech"><h2>Where your goods are</h2><a href="#containers" class="small b">Containers</a></div><div class="card pad">' + st.map(([k, l], i) => '<div class="row" style="margin:6px 0;opacity:' + (agg[k].u ? 1 : 0.45) + '"><span class="badge ' + (k === 'warehouse' ? 'ok' : k === 'us' ? 'acc' : 'info') + '" style="min-width:22px;justify-content:center">' + (i + 1) + '</span><span class="grow small">' + l + '</span><span class="small b">' + fmt(agg[k].u) + '</span>' + (seeCost() ? '<span class="tiny muted money" style="width:96px;text-align:right">' + F(agg[k].v) + '</span>' : '') + '</div>').join('') + '<div class="tiny muted mt">Goods can only be sold at step 7, after the container is received.</div></div></div>';
}

A.pwChange = async () => { try { await K.store.req('POST', '/api/me/password', { current: $('#pwOld').value, password: $('#pwNew').value }); $('#pwOld').value = $('#pwNew').value = ''; toast('Password changed'); } catch (e) { toast(e.message, true); } };
