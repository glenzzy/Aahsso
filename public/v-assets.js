/* Aahsso — business assets: things the business owns and uses but does not sell
   (stacker, forklift, truck, motorbike, tank, generator, computers, shelves…).
   Cost (any currency) + extra costs → depreciated over its useful life → value in the books today.
   Running costs (repairs, fuel, insurance) are expenses linked by assetId. Selling / writing off records gain or loss. */

const assetSt = (k) => (KC.ASSET_STATUSES.find((x) => x[0] === (k || 'in_use')) || [0, k])[1];
const assetBadge = (a) => { const k = a.status || 'in_use'; const cls = { in_use: 'ok', idle: '', repair: 'warn', sold: 'info', scrapped: 'bad', stolen: 'bad', donated: 'info' }[k] || ''; return '<span class="badge ' + cls + '">' + esc(assetSt(k)) + '</span>'; };
const assetV = (a, d) => KC.assetValue(a, S(), d || todayStr());
const assetCosts = (id) => K.raw.expenses.filter((e) => e.assetId === id);
const assetName = (id) => { const a = byId('assets', id); return a ? a.name + (a.tag ? ' · ' + a.tag : '') : 'asset'; };
const monthEnd = (m) => { const [y, mm] = m.split('-').map(Number); return m + '-' + pad2(new Date(y, mm, 0).getDate()); };
function nextAssetTag() { let n = 0; K.raw.assets.forEach((a) => { const m = /^A-(\d+)$/.exec(a.tag || ''); if (m) n = Math.max(n, +m[1]); }); return 'A-' + String(n + 1).padStart(4, '0'); }
const ASSET_DATES = [['nextServiceDate', 'Service'], ['insuranceUntil', 'Insurance ends'], ['registrationUntil', 'Papers / registration end'], ['warrantyUntil', 'Warranty ends']];
function assetDue(a) {
  if (KC.assetGone(a)) return [];
  return ASSET_DATES.filter(([k]) => a[k] && daysUntil(a[k]) <= 30).map(([k, l]) => ({ key: k, label: l, date: a[k], days: daysUntil(a[k]) }));
}
const dueText = (x) => x.label + (x.days < 0 ? ' overdue since ' : x.days === 0 ? ' today, ' : ' on ') + fmtDate(x.date);
const teamNames = () => [...new Set([K.me.name].concat(K.raw.members.map((m) => m.name), K.raw.assets.map((a) => a.assignedTo)).filter(Boolean))].sort();
function assetPhoto(a, size) { const src = imgSrc(a && a.image); return src ? '<img class="thumb" src="' + esc(src) + '" alt="" style="width:' + size + 'px;height:' + size + 'px;border-radius:12px;object-fit:cover">' : '<div class="thumb ph" style="width:' + size + 'px;height:' + size + 'px;border-radius:12px;background:' + catColor(a && a.category) + '">' + ic('truck') + '</div>'; }

/* ---------- list ---------- */
function assetList() {
  const f = K.ui.assetF || 'active', cat = K.ui.assetCat || '', loc = K.ui.assetLoc || '', q = (K.ui.assetQ || '').toLowerCase();
  return K.raw.assets.filter((a) => f === 'all' || (f === 'active' ? !KC.assetGone(a) : KC.assetGone(a)))
    .filter((a) => !cat || a.category === cat).filter((a) => !loc || (a.locationId || 'main') === loc)
    .filter((a) => !q || [a.name, a.tag, a.serialNo, a.make, a.model, a.assignedTo, a.vendor].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
function assetRows(list) {
  const V = (a) => assetV(a);
  return dataTable({
    id: 'assetList', rows: list, noun: 'asset', empty: 'No assets match.',
    rowAttr: (a) => ' data-a="assetOpen" data-id="' + a.id + '"',
    cols: [
      { k: 'photo', label: 'Photo', core: true, cls: 'thumbc', v: () => '', html: (a) => assetPhoto(a, 36) },
      { k: 'tag', label: 'Asset no.', core: true, v: (a) => a.tag || '', html: (a) => '<b>' + esc(a.tag || '—') + '</b>' },
      { k: 'name', label: 'Name', core: true, v: (a) => a.name },
      { k: 'cat', label: 'Type', core: true, v: (a) => a.category || '' },
      { k: 'make', label: 'Make', v: (a) => a.make || '' },
      { k: 'model', label: 'Model', v: (a) => a.model || '' },
      { k: 'serial', label: 'Serial / plate', v: (a) => a.serialNo || '', cls: 'mut' },
      { k: 'loc', label: 'Location', core: true, v: (a) => locName(a.locationId || 'main') },
      { k: 'with', label: 'Who has it', v: (a) => a.assignedTo || '' },
      { k: 'bought', label: 'Bought on', v: (a) => a.purchaseDate || '', html: (a) => dtDate(a.purchaseDate) },
      { k: 'cost', label: 'Cost (' + baseCode() + ')', money: true, v: (a) => Math.round(V(a).cost), total: (rows) => fmt(dtSum(rows, (a) => V(a).cost)) },
      { k: 'lost', label: 'Value lost', money: true, v: (a) => Math.round(V(a).accumulated || 0) },
      { k: 'status', label: 'Status', core: true, v: (a) => a.status || 'in_use', html: (a) => assetBadge(a) },
      { k: 'value', label: 'Value today', core: true, money: true, cls: 'b', v: (a) => V(a).gone ? '' : Math.round(V(a).book), total: (rows) => fmt(dtSum(rows, (a) => V(a).gone ? 0 : V(a).book)) },
      { k: 'sold', label: 'Sold for', money: true, v: (a) => V(a).gone && a.status === 'sold' ? Math.round(V(a).proceeds) : '' },
      { k: 'due', label: 'Reminders', wrap: true, v: (a) => assetDue(a).map(dueText).join('; '), html: (a) => assetDue(a).map((x) => '<span class="badge ' + (x.days < 0 ? 'bad' : 'warn') + '">' + esc(dueText(x)) + '</span>').join(' ') || dtNil },
    ],
  });
}
VIEWS.assets = {
  render() {
    const all = K.raw.assets; const loc = K.ui.assetLoc || ''; const m = monthStr();
    const scoped = all.filter((a) => !loc || (a.locationId || 'main') === loc);
    const t = KC.assetTotals(scoped, S(), m + '-01', monthEnd(m));
    const run = K.raw.expenses.filter((e) => e.assetId && (e.date || '').slice(0, 7) === m && (!loc || scoped.some((a) => a.id === e.assetId))).reduce((s, e) => s + num(e.amount), 0);
    const due = scoped.flatMap((a) => assetDue(a).map((x) => Object.assign({ a }, x))).sort((x, y) => x.days - y.days);
    const cats = [...new Set(all.map((a) => a.category).filter(Boolean))].sort();
    let html = '<div class="row wrap between mb"><div class="row wrap"><button class="btn pri" data-a="assetNew">' + ic('plus') + 'Register an asset</button>' +
      (all.length && can('export') ? '<button class="btn" data-a="assetXlsx">' + ic('dl') + 'Excel</button>' : '') + '</div>' +
      (all.length ? '<div class="seg">' + [['active', 'Owned now'], ['gone', 'Sold / written off'], ['all', 'All']].map(([k, l]) => '<button class="' + ((K.ui.assetF || 'active') === k ? 'on' : '') + '" data-a="assetF" data-v="' + k + '">' + l + '</button>').join('') + '</div>' : '') + '</div>';
    if (!all.length) return html + '<div class="card pad2"><h2 class="mb">Register what the business owns</h2><div class="muted mb">Equipment, vehicles and furniture you <b>use</b> but don\'t sell: a stacker or forklift, a pallet jack, a truck or motorbike, water or fuel tanks, a generator, freezers, shelves, computers, phones, a building or a plot of land.</div>' +
      '<div class="small mb">For each one Aahsso keeps:</div><div class="small col" style="gap:6px"><div>• What it cost — in dollars, euros or francs, plus shipping, customs and installation</div><div>• Where it is and who has it, with a photo, serial or plate number</div><div>• Its value today — it loses value each month (depreciation), which is counted as a cost in Profit & loss</div><div>• Repairs, fuel and insurance costs, and reminders for service, insurance and papers</div><div>• Selling it, or writing it off if it is stolen or broken, with the gain or loss</div></div></div>';
    html += '<div class="kpis mb">' + kpi('Value today', F(t.book), t.count + ' asset(s) owned', true) + kpi('Bought for', F(t.cost), 'incl. shipping & extra costs') + kpi('Depreciation · ' + MONTHS[+m.slice(5) - 1], F(t.depreciation), 'counted in Profit & loss') + kpi('Running costs · ' + MONTHS[+m.slice(5) - 1], F(run), 'repairs, fuel, insurance…') + '</div>';
    if (due.length) html += '<div class="alert warn mb">' + ic('clock', 'sm') + '<div><b>' + due.length + ' reminder(s) due</b>: ' + due.slice(0, 4).map((x) => esc(x.a.name) + ' — ' + esc(dueText(x))).join('; ') + (due.length > 4 ? '…' : '') + '</div></div>';
    html += '<div class="row wrap mb"><input class="inp grow" style="min-width:180px" placeholder="Search name, number, serial, person…" value="' + esc(K.ui.assetQ || '') + '" data-i="assetQ">' +
      (cats.length > 1 ? '<select class="inp" style="width:auto" data-c="assetCat"><option value="">All types</option>' + cats.map((c) => '<option' + (K.ui.assetCat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' : '') +
      (allLocs().length > 1 ? '<select class="inp" style="width:auto" data-c="assetLoc"><option value="">All branches</option>' + allLocs().map((l) => '<option value="' + l.id + '"' + (loc === l.id ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select>' : '') + '</div>';
    return html + assetRows(assetList());
  },
};
A.assetF = (el) => { K.ui.assetF = el.dataset.v; render(true); };
CH.assetCat = (el) => { K.ui.assetCat = el.value; render(true); };
CH.assetLoc = (el) => { K.ui.assetLoc = el.value; render(true); };
I.assetQ = (el) => { K.ui.assetQ = el.value; clearTimeout(I._aq); I._aq = setTimeout(() => { dtRefresh('assetList'); }, 120); };

/* ---------- register / edit ---------- */
A.assetNew = () => assetForm(null);
A.assetEdit = (el) => assetForm(el.dataset.id);
function assetForm(id) {
  const a = id ? JSON.parse(JSON.stringify(byId('assets', id))) : { tag: nextAssetTag(), category: KC.ASSET_CATS[1], condition: 'New', purchaseDate: todayStr(), currency: 'USD', locationId: K.loc, status: 'in_use', depMethod: 'straight', usefulLife: KC.ASSET_LIFE[KC.ASSET_CATS[1]], residualValue: '' };
  const isNew = !id; let photo = a.image || '';
  const fx = (c) => c === baseCode() ? '' : ' placeholder="default ' + KC.rateOf(S(), c) + '"';
  const body = '<div class="col">' +
    '<div class="row"><div id="asPh">' + assetPhoto({ image: photo, category: a.category }, 64) + '</div><button class="btn" id="asPhoto" type="button">' + ic('cam') + (photo ? 'Change photo' : 'Add photo') + '</button>' + (photo ? '<button class="btn" id="asPhotoX" type="button">' + ic('trash') + '</button>' : '') + '</div>' +
    '<h3>What is it</h3><div class="grid2">' + field('Name *', inp('name', a.name, 'placeholder="e.g. Electric stacker 1.5 t"')) + field('Type', sel('category', KC.ASSET_CATS, a.category)) +
    field('Asset number', inp('tag', a.tag)) + field('Condition when bought', sel('condition', ['New', 'Used', 'Refurbished'], a.condition)) +
    field('Brand / make', inp('make', a.make)) + field('Model', inp('model', a.model)) + '</div>' + field('Serial / chassis / plate number', inp('serialNo', a.serialNo)) +
    '<h3>Purchase</h3><div class="grid2">' + field('Date bought', inp('purchaseDate', a.purchaseDate, 'type="date"')) + field('Bought from', inp('vendor', a.vendor, 'placeholder="e.g. Sam\'s Club Houston, Ets Fotso"')) +
    field('Price paid', inp('price', a.price, 'inputmode="decimal"')) + field('Currency', sel('currency', curOptions(), a.currency)) + '</div>' +
    '<div class="grid2" id="asFx">' + field('Exchange rate (1 ' + esc(a.currency) + ' = … ' + esc(baseCode()) + ')', inp('fxRate', a.fxRate, 'inputmode="decimal"' + fx(a.currency))) + '<div></div></div>' +
    field('Extra costs in ' + esc(curSym(baseCode())) + ' (shipping, customs, transport, installation)', inp('extraCosts', a.extraCosts, 'inputmode="numeric" placeholder="0"')) +
    '<div class="tiny muted" style="margin-top:-6px">If it came in one of your containers, put its share of shipping and customs here — not in the container costs (those are shared over goods for sale).</div>' +
    (K.raw.shipments.length ? field('Came in container (optional)', sel('shipmentId', [['', '—']].concat(K.raw.shipments.map((s) => [s.id, s.name || s.containerNo])), a.shipmentId || '')) : '') +
    (isNew ? '<div class="grid2">' + field('How was it paid', sel('payMode', [['Cash', 'Paid — cash'], ['MTN MoMo', 'Paid — MTN MoMo'], ['Orange Money', 'Paid — Orange Money'], ['Bank transfer', 'Paid — bank'], ['Card / US account', 'Paid — card / US account'], ['__credit', 'Not paid yet (we owe the seller)']], 'Cash')) + '<div></div></div>' +
      '<div class="grid2 hide" id="asCredit">' + field('Seller (supplier)', supplierSelect('')) + field('Pay by', inp('billDue', KC.addDays(todayStr(), 30), 'type="date"')) + '<div class="hide" id="newSup">' + field('New supplier name', inp('newSupplier', '')) + '</div></div>' : '') +
    '<h3>Where & who</h3><div class="grid2">' + field('Branch / location', sel('locationId', allLocs().map((l) => [l.id, l.name]), a.locationId || 'main')) + field('Who uses / keeps it', inp('assignedTo', a.assignedTo, 'list="dlTeam" placeholder="optional"')) +
    (KC.assetGone(a) ? '' : field('Status', sel('status', KC.ASSET_STATUSES.filter((x) => !KC.ASSET_GONE.includes(x[0])), a.status || 'in_use'))) + '</div>' +
    '<datalist id="dlTeam">' + teamNames().map((n) => '<option value="' + esc(n) + '">').join('') + '</datalist>' +
    '<h3>Value over time</h3><div class="grid2">' + field('Method', sel('depMethod', KC.DEP_METHODS, KC.assetMethod(a))) + field('Useful life (years)', inp('usefulLife', a.usefulLife ?? KC.assetLife(a), 'inputmode="decimal"')) +
    field('Value left at the end (' + esc(curSym(baseCode())) + ')', inp('residualValue', a.residualValue, 'inputmode="numeric" placeholder="0"')) + field('Started using it on', inp('inServiceDate', a.inServiceDate, 'type="date" title="Leave empty = date bought"')) + '</div>' +
    '<div class="alert info" id="asPrev"></div>' +
    '<h3>Reminders (optional)</h3><div class="grid2">' + ASSET_DATES.map(([k, l]) => field(l.replace(' ends', ' until').replace(' end', ' until').replace('Service', 'Next service'), inp(k, a[k], 'type="date"'))).join('') + '</div>' +
    field('Notes', inp('notes', a.notes)) + '</div>';
  const sh = openSheet({ title: isNew ? 'Register an asset' : 'Edit ' + (a.name || 'asset'), wide: true, body,
    foot: (!isNew ? '<button class="btn danger" id="asDel">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="asSave">' + (isNew ? 'Register asset' : 'Save') + '</button>' });
  const val = () => { const v = formVals(sh); return Object.assign({}, a, v, { image: photo }); };
  const preview = () => {
    const v = val(); $('#asFx', sh).classList.toggle('hide', v.currency === baseCode());
    const x = KC.assetValue(v, S(), todayStr()); const life = KC.assetLife(v); const m = KC.assetMethod(v);
    $('#asPrev', sh).innerHTML = '<div>Full cost <b>' + F(x.cost) + '</b>' + (v.currency !== baseCode() && num(v.price) ? ' (' + money(v.price, v.currency) + ' × ' + (num(v.fxRate) || KC.rateOf(S(), v.currency)) + (num(v.extraCosts) ? ' + ' + F(num(v.extraCosts)) : '') + ')' : '') + '. ' +
      (m === 'none' || life <= 0 ? 'Keeps its full value (no depreciation).' : 'Loses about <b>' + F(x.monthly || (x.cost - num(v.residualValue)) / (life * 12)) + '</b> a month for ' + life + ' year(s)' + (m === 'declining' ? ' (more at the start)' : '') + '. ') +
      (x.owned && v.purchaseDate && v.purchaseDate <= todayStr() ? ' Value today: <b>' + F(x.book) + '</b>.' : '') + '</div>';
  };
  $('[name=currency]', sh).onchange = (e) => { const f = $('[name=fxRate]', sh); f.placeholder = e.target.value === baseCode() ? '' : 'default ' + KC.rateOf(S(), e.target.value); $('#asFx label', sh).firstChild.textContent = 'Exchange rate (1 ' + e.target.value + ' = … ' + baseCode() + ')'; preview(); };
  let lifeTouched = !isNew; $('[name=usefulLife]', sh).addEventListener('input', () => (lifeTouched = true));
  $('[name=category]', sh).onchange = (e) => { const c = e.target.value; if (!lifeTouched) { $('[name=usefulLife]', sh).value = KC.ASSET_LIFE[c] ?? 5; $('[name=depMethod]', sh).value = c === 'Land' ? 'none' : 'straight'; } if (!photo) $('#asPh', sh).innerHTML = assetPhoto({ category: c }, 64); preview(); };
  sh.addEventListener('input', preview); sh.addEventListener('change', preview);
  if ($('[name=payMode]', sh)) { $('[name=payMode]', sh).onchange = (e) => { $('#asCredit', sh).classList.toggle('hide', e.target.value !== '__credit'); preview(); }; $('[name=supplierId]', sh).onchange = (e) => $('#newSup', sh).classList.toggle('hide', e.target.value !== '__new'); }
  $('#asPhoto', sh).onclick = async () => { const f = await photoPicker(); if (!f) return; try { photo = await storePhoto(f); $('#asPh', sh).innerHTML = assetPhoto({ image: photo, category: a.category }, 64); toast('Photo added'); } catch (e) { toast(e.message || 'Could not use that photo', true); } };
  if ($('#asPhotoX', sh)) $('#asPhotoX', sh).onclick = () => { photo = ''; $('#asPh', sh).innerHTML = assetPhoto({ category: a.category }, 64); };
  preview();
  $('#asSave', sh).onclick = async () => {
    const v = formVals(sh); const name = (v.name || '').trim(); if (!name) return toast('Enter the asset name', true);
    ['price', 'extraCosts', 'fxRate', 'usefulLife', 'residualValue'].forEach((k) => (v[k] = v[k] === '' ? (k === 'fxRate' || k === 'residualValue' ? '' : 0) : num(v[k])));
    if (v.price < 0 || v.extraCosts < 0) return toast('Amounts cannot be negative', true);
    if (!v.purchaseDate) return toast('Enter the date bought', true);
    if (v.currency === baseCode()) v.fxRate = '';
    if (v.tag && K.raw.assets.some((x) => x.id !== id && (x.tag || '').toLowerCase() === v.tag.toLowerCase())) return toast('Asset number ' + v.tag + ' is already used', true);
    const payMode = v.payMode; const credit = payMode === '__credit'; const sup = { supplierId: v.supplierId, newSupplier: v.newSupplier }; const billDue = v.billDue;
    ['payMode', 'supplierId', 'newSupplier', 'billDue'].forEach((k) => delete v[k]);
    const doc = Object.assign({}, a, v, { name, image: photo, id: id || uid('as_') });
    if (isNew) { doc.paidBy = credit ? 'Not paid yet' : payMode; doc.history = [{ id: uid('h'), date: todayStr(), at: new Date().toISOString(), by: K.me.name || '', text: 'Registered' + (doc.assignedTo ? ', with ' + doc.assignedTo : '') + ' at ' + locName(doc.locationId) }]; }
    else if (!doc.depMethod) doc.depMethod = KC.assetMethod(doc);
    let sid = null;
    if (credit) { sid = await ensureSupplier(sup); if (!sid) return toast('Choose or add the seller', true); }
    if (!(await save('assets', doc))) return;
    if (credit) { const bill = { id: uid('b_'), txnId: KC.newTxnId('PU', doc.purchaseDate), supplierId: sid, description: 'Asset: ' + name + (doc.tag ? ' (' + doc.tag + ')' : ''), amount: num(doc.price), currency: doc.currency, date: doc.purchaseDate, dueDate: billDue || KC.addDays(doc.purchaseDate, 30), assetId: doc.id, payments: [] }; if (await save('bills', bill)) toast('Bill to pay created under Suppliers'); }
    closeSheet(); scheduleRender(); toast(isNew ? 'Asset registered' : 'Saved'); setTimeout(() => assetOpen(doc.id), 80);
  };
  if (!isNew) $('#asDel', sh).onclick = async () => {
    const linked = assetCosts(id).length + K.raw.bills.filter((b) => b.assetId === id).length;
    if (linked || KC.assetGone(a)) return toast(KC.assetGone(a) ? 'Sold or written-off assets stay in the register for your records.' : 'This asset has costs or bills linked. Use "Sell / write off" instead of deleting.', true);
    const why = await askReason('Delete ' + a.name + '?', ['Registered by mistake', 'Duplicate', 'Other'], 'Delete'); if (why === null) return;
    byId('assets', id).deleteReason = why; if (await remove('assets', id)) { closeSheet(); while (K.sheets.length && K.sheets[K.sheets.length - 1]._assetId) closeSheet(); scheduleRender(); toast('Asset deleted'); }
  };
}

/* ---------- detail ---------- */
A.assetOpen = (el) => assetOpen(el.dataset.id);
function assetOpen(id) {
  const a = byId('assets', id); if (!a) return;
  while (K.sheets.length && K.sheets[K.sheets.length - 1]._assetId) closeSheet();
  const sh = openSheet({ title: a.name, wide: true, body: assetDetail(a), foot: assetFoot(a) });
  sh._assetId = id; sh._refresh = () => { const cur = byId('assets', id); if (!cur) return closeSheet(); setSheetBody(sh, assetDetail(cur)); $('.sf', sh).innerHTML = assetFoot(cur); };
}
function assetFoot(a) {
  if (!can('assets')) return '';
  if (KC.assetGone(a)) return '<button class="btn" data-a="assetEdit" data-id="' + a.id + '">' + ic('edit') + 'Edit</button><button class="btn grow" data-a="assetUndo" data-id="' + a.id + '">' + ic('undo') + 'Undo — put back in use</button>';
  return '<button class="btn" data-a="assetEdit" data-id="' + a.id + '">' + ic('edit') + '<span class="desk-only">Edit</span></button><button class="btn grow" data-a="assetMove" data-id="' + a.id + '">' + ic('users') + 'Move / give to</button>' +
    (can('expenses') ? '<button class="btn grow" data-a="assetCost" data-id="' + a.id + '">' + ic('wallet') + 'Add cost</button>' : '') + '<button class="btn danger grow" data-a="assetDispose" data-id="' + a.id + '">Sell / write off</button>';
}
function assetDetail(a) {
  const v = assetV(a); const S_ = S(); const sched = KC.assetSchedule(a, S_); const yr = +todayStr().slice(0, 4);
  const costs = assetCosts(a.id).sort((x, y) => (y.date || '').localeCompare(x.date || '')); const runT = costs.reduce((s, e) => s + num(e.amount), 0);
  const bills = K.raw.bills.filter((b) => b.assetId === a.id && b.status !== 'cancelled'); const owed = bills.reduce((s, b) => s + Math.max(0, billX(b).balanceX), 0);
  const sh = a.shipmentId ? byId('shipments', a.shipmentId) : null; const life = KC.assetLife(a); const m = KC.assetMethod(a); const d = a.disposal || {};
  const row = (l, val) => val ? '<div class="row between cl"><span class="muted">' + l + '</span><span class="right">' + val + '</span></div>' : '';
  return '<div class="row mb" style="align-items:flex-start">' + assetPhoto(a, 84) + '<div class="grow"><div class="row gap6 wrap mb">' + assetBadge(a) + '<span class="badge">' + esc(a.category || '') + '</span>' + (a.tag ? '<span class="badge brand">' + esc(a.tag) + '</span>' : '') + '</div>' +
    '<div class="small">' + esc(locName(a.locationId)) + (a.assignedTo ? ' · with <b>' + esc(a.assignedTo) + '</b>' : '') + '</div>' + assetDue(a).map((x) => '<div class="tiny" style="color:var(--' + (x.days < 0 ? 'bad' : 'warn') + ')">' + esc(dueText(x)) + '</div>').join('') + '</div></div>' +
    (v.gone ? '<div class="alert ' + (v.gain >= 0 ? 'info' : 'bad') + ' mb"><div><b>' + esc(assetSt(a.status)) + ' on ' + fmtDate(d.date) + '</b>' + (a.status === 'sold' ? ' to ' + esc(d.buyer || '—') + ' for <b>' + F(v.proceeds) + '</b> (' + esc(d.method || '') + ')' : '') + '. Value in the books then ' + F(v.bookAtDisposal) + ' → <b>' + (v.gain >= 0 ? 'gain ' : 'loss ') + F(Math.abs(v.gain)) + '</b>.' + (d.reason ? '<div class="tiny">Why: ' + esc(d.reason) + (d.by ? ' · by ' + esc(d.by) : '') + '</div>' : '') + '</div></div>' : '') +
    '<div class="kpis mb">' + kpi(v.gone ? 'Value when it left' : 'Value today', F(v.gone ? v.bookAtDisposal : v.book), v.gone ? '' : (v.monthly ? 'loses ' + F(v.monthly) + ' / month' : v.fullyDepreciated ? 'fully depreciated' : 'no depreciation'), true) + kpi('Bought for', F(v.cost), fmtDate(a.purchaseDate)) + kpi('Value lost so far', F(v.accumulated), v.cost ? pct(v.accumulated / v.cost * 100) : '') + kpi('Running costs', F(runT), costs.length + ' entr' + (costs.length === 1 ? 'y' : 'ies')) + '</div>' +
    '<div class="card pad mb"><h3 class="mb">Details</h3>' + row('Brand / model', esc([a.make, a.model].filter(Boolean).join(' '))) + row('Serial / plate', esc(a.serialNo || '')) + row('Condition when bought', esc(a.condition || '')) +
    row('Bought', fmtDate(a.purchaseDate) + (a.vendor ? ' from ' + esc(a.vendor) : '')) +
    row('Price', (a.currency && a.currency !== baseCode() ? money(a.price, a.currency) + ' × ' + (num(a.fxRate) || KC.rateOf(S_, a.currency)) + ' = ' + F(num(a.price) * (num(a.fxRate) || KC.rateOf(S_, a.currency))) : F(num(a.price)))) +
    row('Extra costs', num(a.extraCosts) ? F(num(a.extraCosts)) : '') + row('Container', sh ? esc(sh.name || sh.containerNo) : '') + row('Paid', esc(a.paidBy || '') + (owed > 0.5 ? ' · <b style="color:var(--bad)">still owe ' + F(owed) + '</b>' : bills.length ? ' · bill paid' : '')) +
    row('Depreciation', m === 'none' || life <= 0 ? 'none — keeps its value' : (m === 'declining' ? 'declining' : 'straight line') + ', ' + life + ' year(s)' + (num(a.residualValue) ? ', ' + F(num(a.residualValue)) + ' left at the end' : '') + ' · from ' + fmtDate(KC.assetStart(a))) +
    ASSET_DATES.map(([k, l]) => row(l, a[k] ? fmtDate(a[k]) : '')).join('') + row('Notes', esc(a.notes || '')) + '</div>' +
    (sched.length > 1 || (sched[0] && sched[0].depreciation) ? '<div class="card tw mb"><table class="t"><thead><tr><th>Year</th><th class="r">Depreciation</th><th class="r">Value at year end</th></tr></thead><tbody>' + sched.map((r) => '<tr' + (r.year === yr ? ' style="font-weight:600"' : '') + '><td>' + r.year + (r.year === yr ? ' (this year)' : '') + '</td><td class="r money">' + fmt(r.depreciation) + '</td><td class="r money">' + fmt(r.book) + '</td></tr>').join('') + '</tbody></table></div>' : '') +
    '<div class="row between mb"><h3>Running costs</h3>' + (can('expenses') && !v.gone ? '<button class="btn sm" data-a="assetCost" data-id="' + a.id + '">' + ic('plus') + 'Add</button>' : '') + '</div><div class="card list mb">' +
    (costs.length ? costs.map((e) => '<div class="li"' + (can('expenses') ? ' data-a="assetCostEdit" data-id="' + e.id + '"' : ' style="cursor:default"') + '><div class="av ink">' + ic('wallet', 'sm') + '</div><div class="grow"><div class="t">' + esc(e.category) + '</div><div class="tiny muted">' + fmtDate(e.date) + (e.description ? ' · ' + esc(e.description) : '') + '</div></div><b class="money">' + F(e.amount) + '</b></div>').join('') : '<div class="empty small">No repairs, fuel or other costs recorded.</div>') + '</div>' +
    '<h3 class="mb">History</h3><div class="card list">' + ((a.history || []).slice().reverse().map((h) => '<div class="li" style="cursor:default"><div class="av ink">' + ic('clock', 'sm') + '</div><div class="grow"><div class="small">' + esc(h.text) + '</div><div class="tiny muted">' + fmtDate(h.date) + (h.by ? ' · ' + esc(h.by) : '') + (h.note ? ' · ' + esc(h.note) : '') + '</div></div></div>').join('') || '<div class="empty small">No history yet.</div>') + '</div>';
}
const histPush = (a, text, note) => (a.history = (a.history || []).concat([{ id: uid('h'), date: todayStr(), at: new Date().toISOString(), by: K.me.name || '', text, note: note || '' }]));

/* ---------- move / give to / status ---------- */
A.assetMove = (el) => {
  const a = byId('assets', el.dataset.id);
  const sh = openSheet({ title: 'Move or hand over · ' + a.name, body: '<div class="col">' + field('Branch / location', sel('locationId', allLocs().map((l) => [l.id, l.name]), a.locationId || 'main')) + field('Who uses / keeps it', inp('assignedTo', a.assignedTo, 'list="dlTeam2" placeholder="nobody"')) +
    '<datalist id="dlTeam2">' + teamNames().map((n) => '<option value="' + esc(n) + '">').join('') + '</datalist>' + field('Status', sel('status', KC.ASSET_STATUSES.filter((x) => !KC.ASSET_GONE.includes(x[0])), a.status || 'in_use')) + field('Note (why)', inp('note', '', 'placeholder="e.g. Sent to Akwa shop for unloading"')) + '</div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="amGo">Save</button>' });
  $('#amGo', sh).onclick = async () => {
    const v = formVals(sh); const cur = JSON.parse(JSON.stringify(byId('assets', a.id))); const ch = [];
    if ((cur.locationId || 'main') !== v.locationId) ch.push('Moved ' + locName(cur.locationId) + ' → ' + locName(v.locationId));
    if ((cur.assignedTo || '') !== v.assignedTo) ch.push(v.assignedTo ? 'Given to ' + v.assignedTo : 'Taken back from ' + cur.assignedTo);
    if ((cur.status || 'in_use') !== v.status) ch.push(assetSt(cur.status) + ' → ' + assetSt(v.status));
    if (!ch.length) return closeSheet();
    Object.assign(cur, { locationId: v.locationId, assignedTo: v.assignedTo, status: v.status, lastMoveNote: v.note }); histPush(cur, ch.join(' · '), v.note);
    if (await save('assets', cur)) { closeSheet(); scheduleRender(); refreshSheets(); toast('Saved'); }
  };
};

/* ---------- running costs (expenses linked to the asset) ---------- */
A.assetCost = (el) => assetCostForm(el.dataset.id, null);
A.assetCostEdit = (el) => { const e = byId('expenses', el.dataset.id); if (e) assetCostForm(e.assetId, e.id); };
function assetCostForm(assetId, expId) {
  const a = byId('assets', assetId); const e = expId ? byId('expenses', expId) : { date: todayStr(), method: 'Cash', category: 'Repairs & maintenance' };
  const sh = openSheet({ title: (expId ? 'Edit cost · ' : 'Add cost · ') + a.name, body: '<div class="col"><div class="grid2">' + field('Date', inp('date', e.date, 'type="date"')) + field('Amount (' + esc(curSym(baseCode())) + ')', inp('amount', e.amount, 'inputmode="numeric"')) +
    field('What for', sel('category', KC.EXPENSE_CATS, e.category)) + field('Paid by', sel('method', KC.PAY_METHODS, e.method)) + '</div>' + field('Description', inp('description', e.description, 'placeholder="e.g. New battery, oil change, 20 L diesel"')) +
    (!expId ? field('Next service date (optional)', inp('nextService', a.nextServiceDate, 'type="date"')) : '') + '<div class="tiny muted">Saved as an expense of ' + esc(locName(a.locationId)) + ', so it shows in Expenses and Profit & loss.</div></div>',
    foot: (expId ? '<button class="btn danger" id="acDel">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="acGo">Save</button>' });
  $('#acGo', sh).onclick = async () => {
    const v = formVals(sh); const amount = num(v.amount); if (!amount || amount < 0) return toast('Enter the amount', true);
    const next = v.nextService; delete v.nextService;
    if (!(await save('expenses', Object.assign({ locationId: a.locationId || 'main' }, e, v, { amount, assetId, id: expId || uid('e_') })))) return;
    if (!expId && next && next !== a.nextServiceDate) { const cur = JSON.parse(JSON.stringify(byId('assets', assetId))); cur.nextServiceDate = next; histPush(cur, 'Next service set to ' + fmtDate(next)); await save('assets', cur); }
    closeSheet(); scheduleRender(); refreshSheets(); toast('Cost saved');
  };
  if (expId) $('#acDel', sh).onclick = async () => { if (await confirmBox('Delete this cost?', 'Delete', true)) { await remove('expenses', expId); closeSheet(); scheduleRender(); refreshSheets(); } };
}

/* ---------- sell / write off / undo ---------- */
A.assetDispose = (el) => {
  const a = byId('assets', el.dataset.id);
  const types = [['sold', 'Sold'], ['scrapped', 'Broken / scrapped'], ['stolen', 'Stolen / lost'], ['donated', 'Given away']];
  const sh = openSheet({ title: 'Sell or write off · ' + a.name, body: '<div class="col"><div class="grid2">' + field('What happened', sel('type', types, 'sold')) + field('Date', inp('date', todayStr(), 'type="date"')) + '</div>' +
    '<div class="grid2" id="adSold">' + field('Sold for (' + esc(curSym(baseCode())) + ')', inp('amount', '', 'inputmode="numeric"')) + field('Paid by', sel('method', KC.PAY_METHODS, 'Cash')) + field('Buyer', inp('buyer', '', 'placeholder="name / phone"')) + '<div></div></div>' +
    field('Reason / details *', inp('reason', '', 'placeholder="e.g. Replaced by a bigger stacker; police report no. …"')) + '<div class="alert info" id="adPrev"></div></div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn danger grow" id="adGo">Confirm</button>' });
  const prev = () => { const v = formVals(sh); const sold = v.type === 'sold'; $('#adSold', sh).classList.toggle('hide', !sold); const book = v.date ? KC.assetBookOn(a, S(), v.date) : 0; const g = (sold ? num(v.amount) : 0) - book;
    $('#adPrev', sh).innerHTML = '<div>Value in the books on ' + fmtDate(v.date) + ': <b>' + F(book) + '</b>. ' + (sold && !num(v.amount) ? 'Enter the price to see the gain or loss.' : (g >= 0 ? 'Gain' : 'Loss') + ' recorded in Profit & loss: <b>' + F(Math.abs(g)) + '</b>.') + '</div>'; };
  sh.addEventListener('input', prev); sh.addEventListener('change', prev); prev();
  $('#adGo', sh).onclick = async () => {
    const v = formVals(sh); if (!v.date) return toast('Enter the date', true); if (v.date < (a.purchaseDate || '')) return toast('That date is before the asset was bought', true);
    if (!v.reason) return toast('Write the reason', true); const sold = v.type === 'sold'; if (sold && !(num(v.amount) > 0)) return toast('Enter the selling price', true);
    const cur = JSON.parse(JSON.stringify(byId('assets', a.id))); const book = KC.assetBookOn(cur, S(), v.date);
    cur.status = v.type; cur.disposal = { type: v.type, date: v.date, amount: sold ? num(v.amount) : 0, method: sold ? v.method : '', buyer: sold ? v.buyer : '', reason: v.reason, bookValue: Math.round(book), by: K.me.name || '', at: new Date().toISOString() };
    histPush(cur, (sold ? 'Sold' + (v.buyer ? ' to ' + v.buyer : '') + ' for ' + F(num(v.amount)) : assetSt(v.type)) + ' (book value ' + F(book) + ')', v.reason);
    if (await save('assets', cur)) { closeSheet(); scheduleRender(); refreshSheets(); toast(sold ? 'Asset sold' : 'Asset written off'); }
  };
};
A.assetUndo = async (el) => {
  const a = byId('assets', el.dataset.id); const why = await askReason('Put ' + a.name + ' back in use?', ['Recorded by mistake', 'Sale cancelled', 'Found / recovered', 'Other'], 'Put back'); if (why === null) return;
  const cur = JSON.parse(JSON.stringify(a)); cur.previousDisposal = cur.disposal; cur.disposal = null; cur.status = 'in_use'; cur.reverseReason = why; histPush(cur, 'Put back in use (was ' + assetSt(a.status).toLowerCase() + ')', why);
  if (await save('assets', cur)) { scheduleRender(); refreshSheets(); toast('Back in use'); }
};

/* ---------- Excel ---------- */
A.assetXlsx = () => {
  const d = todayStr(); const yr = +d.slice(0, 4);
  const reg = K.raw.assets.map((a) => { const v = assetV(a, d); const run = assetCosts(a.id).reduce((s, e) => s + num(e.amount), 0);
    return { 'Asset no.': a.tag || '', Name: a.name, Type: a.category, 'Brand / model': [a.make, a.model].filter(Boolean).join(' '), 'Serial / plate': a.serialNo || '', Status: assetSt(a.status), Branch: locName(a.locationId), 'With': a.assignedTo || '', 'Bought on': a.purchaseDate, 'Bought from': a.vendor || '', Price: num(a.price), Currency: a.currency || baseCode(), 'Rate': a.currency && a.currency !== baseCode() ? (num(a.fxRate) || KC.rateOf(S(), a.currency)) : 1, ['Extra costs (' + baseSym() + ')']: num(a.extraCosts), ['Full cost (' + baseSym() + ')']: Math.round(v.cost), Method: KC.assetMethod(a), 'Life (yrs)': KC.assetLife(a), ['Value lost so far (' + baseSym() + ')']: Math.round(v.accumulated), ['Value today (' + baseSym() + ')']: Math.round(v.book), ['Per month (' + baseSym() + ')']: Math.round(v.monthly), ['Running costs (' + baseSym() + ')']: run, 'Left on': (a.disposal || {}).date || '', ['Sold for (' + baseSym() + ')']: v.gone ? v.proceeds : '', ['Gain / loss (' + baseSym() + ')']: v.gone ? Math.round(v.gain) : '', 'Next service': a.nextServiceDate || '', 'Insurance until': a.insuranceUntil || '', Notes: a.notes || '' }; });
  const sched = []; K.raw.assets.forEach((a) => KC.assetSchedule(a, S()).forEach((r) => sched.push({ 'Asset no.': a.tag || '', Name: a.name, Year: r.year, ['Depreciation (' + baseSym() + ')']: Math.round(r.depreciation), ['Value at year end (' + baseSym() + ')']: Math.round(r.book) })));
  const run = K.raw.expenses.filter((e) => e.assetId).map((e) => ({ Date: e.date, Asset: assetName(e.assetId), Category: e.category, Description: e.description || '', ['Amount (' + baseSym() + ')']: num(e.amount), Method: e.method }));
  const thisYr = KC.assetTotals(K.raw.assets, S(), yr + '-01-01', yr + '-12-31');
  xlsxDownload('Assets-' + d + '.xlsx', { Register: reg, 'Depreciation by year': sched, 'Running costs': run, Summary: [{ Date: d, 'Assets owned': thisYr.count, ['Full cost (' + baseSym() + ')']: Math.round(thisYr.cost), ['Value today (' + baseSym() + ')']: Math.round(K.raw.assets.reduce((s, a) => s + assetV(a, d).book, 0)), ['Depreciation ' + yr + ' (' + baseSym() + ')']: Math.round(thisYr.depreciation), ['Gain / loss on assets ' + yr + ' (' + baseSym() + ')']: Math.round(thisYr.gain) }] });
};
