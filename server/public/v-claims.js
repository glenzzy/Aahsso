/* ================= RETURNS TO SUPPLIERS & CLAIMS =================
 * Money you are owed back for goods:
 *  - Return: damaged, defective or wrong goods sent back to the supplier. They leave stock at once (not a loss);
 *    the refund you expect is owed to you until it is paid. If the supplier refuses, writing it off makes it a loss.
 *  - Claim: against a supplier, the shipping company or an insurer — e.g. goods missing or damaged on arrival
 *    (already out of stock when the container was received). Recovered money reduces what you lost.
 * Each record follows the money: received payments, then closed as settled or written off. */
const CL_KIND = { return: 'Return to supplier', claim: 'Claim' };
const CL_PARTY = [['supplier', 'Supplier'], ['shipper', 'Shipping company'], ['insurer', 'Insurer'], ['other', 'Other']];
const CL_REASONS = { return: ['Damaged / defective', 'Wrong item', 'Not as ordered', 'Expired', 'Other'], claim: ['Missing on arrival', 'Damaged on arrival', 'Damaged in transit', 'Short delivery', 'Other'] };
const clCan = () => can('suppliers') || can('purchases') || can('containers') || can('stockEdit');
const clGot = (c) => (c.received || []).reduce((a, r) => a + num(r.amount), 0);
const clLeft = (c) => c.status === 'closed' ? 0 : Math.max(0, num(c.amount) - clGot(c));
function clState(c) {
  if (c.status === 'closed') return c.outcome === 'writtenOff' ? ['Written off', 'bad'] : ['Settled', 'ok'];
  return clGot(c) > 0 ? ['Part paid', 'warn'] : ['Waiting for money', 'info'];
}
const clBadge = (c) => { const s = clState(c); return '<span class="badge ' + s[1] + '">' + s[0] + '</span>'; };
const clItems = (c) => (c.lines || []).map((l) => num(l.qty) + ' × ' + ((byId('products', l.productId) || {}).name || l.name || '?')).join(', ');
const clParty = (c) => (c.party && c.party.name) || '—';

VIEWS.claims = {
  render() {
    const list = K.raw.claims.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
    const y = todayStr().slice(0, 4); const inYear = (d) => String(d || '').slice(0, 4) === y;
    const owed = list.reduce((a, c) => a + clLeft(c), 0);
    const got = list.reduce((a, c) => a + (c.received || []).filter((r) => inYear(r.date)).reduce((t, r) => t + num(r.amount), 0), 0);
    const off = list.filter((c) => c.status === 'closed' && c.outcome === 'writtenOff' && inYear(c.closedAt)).reduce((a, c) => a + Math.max(0, num(c.amount) - clGot(c)), 0);
    return '<div class="row wrap mb">' + (can('stockEdit') ? '<button class="btn pri" data-a="clNew" data-k="return">' + ic('undo') + 'Return goods to a supplier</button>' : '') + (clCan() ? '<button class="btn" data-a="clNew" data-k="claim">' + ic('plus') + 'Make a claim</button>' : '') + '</div>' +
      '<div class="kpis mb">' + kpi('Owed to you', F(owed), list.filter((c) => clLeft(c) > 0).length + ' open', true) + kpi('Recovered ' + y, F(got)) + kpi('Written off ' + y, F(off), 'never paid back') + '</div>' +
      dataTable({
        id: 'clList', rows: list, noun: 'record', empty: '<div class="big">↩️</div>Nothing yet. When goods are faulty, wrong or missing, return them or make a claim here so the money owed to you is not forgotten.',
        rowAttr: (c) => ' data-a="clOpen" data-id="' + esc(c.id) + '"',
        cols: [
          { k: 'date', label: 'Date', core: true, v: (c) => c.date, html: (c) => dtDate(c.date) },
          { k: 'kind', label: 'Kind', core: true, v: (c) => CL_KIND[c.kind] },
          { k: 'party', label: 'Owed by', core: true, v: clParty },
          { k: 'items', label: 'Items', wrap: true, v: clItems },
          { k: 'reason', label: 'Reason', v: (c) => c.reason || '', cls: 'mut' },
          { k: 'amt', label: 'Claimed', money: true, v: (c) => num(c.amount), total: (r) => fmt(dtSum(r, (c) => num(c.amount))) },
          { k: 'got', label: 'Received', money: true, v: clGot, total: (r) => fmt(dtSum(r, clGot)) },
          { k: 'left', label: 'Still owed', core: true, money: true, cls: 'b', v: clLeft, total: (r) => fmt(dtSum(r, clLeft)) },
          { k: 'st', label: 'Status', core: true, v: (c) => clState(c)[0], html: clBadge },
        ],
      });
  },
};

/* ---------- new return / claim ---------- */
A.clNew = (el) => {
  const kind = (el && el.dataset.k) || 'claim'; const loc = K.loc;
  if (kind === 'return' && !can('stockEdit')) return toast('Only a manager can send stock back', true);
  const C = { kind, party: { type: 'supplier', supplierId: '', name: '' }, lines: [], photos: [], reason: CL_REASONS[kind][0], notes: '', date: todayStr(), shipmentId: '', amount: '' };
  const sh = openSheet({ title: CL_KIND[kind] + (kind === 'return' ? ' · ' + locName(loc) : ''), body: '', foot: '<button class="btn" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="clSave">' + (kind === 'return' ? 'Send back' : 'Record claim') + '</button>' });
  sh.classList.add('loss-sheet'); sh._q = '';
  const unit = (pid) => (K.C.prodX[pid] || {}).avgCost || 0;
  const total = () => C.lines.reduce((a, l) => a + num(l.qty) * num(l.unitCost ?? unit(l.productId)), 0);
  const keep = () => { const v = formVals(sh); ['date', 'notes', 'reason'].forEach((k) => { if (v['cl_' + k] !== undefined) C[k] = v['cl_' + k]; }); if (v.cl_ptype !== undefined) C.party.type = v.cl_ptype; if (v.cl_sup !== undefined) C.party.supplierId = v.cl_sup; if (v.cl_pname !== undefined) C.party.name = v.cl_pname; if (v.cl_amount !== undefined) C.amount = v.cl_amount; $$('[data-clq]', sh).forEach((i) => { const l = C.lines[+i.dataset.clq]; if (l) l.qty = Math.max(0, Math.floor(num(i.value))); }); };
  sh._draw = () => {
    const sups = K.raw.suppliers.slice().sort((a, b) => a.name.localeCompare(b.name));
    const matches = sh._q.trim() ? K.raw.products.filter((p) => !p.archived && !C.lines.some((l) => l.productId === p.id) && (p.name + ' ' + (p.barcode || '')).toLowerCase().includes(sh._q.trim().toLowerCase()) && (kind !== 'return' || lossAvail(p.id, loc) > 0)).slice(0, 6) : [];
    const ships = K.raw.shipments.filter((s) => K.raw.lots.some((l) => l.shipmentId === s.id && num(l.recvMissing) + num(l.recvDamaged) > 0));
    setSheetBody(sh,
      '<div class="grid2">' + (kind === 'claim' ? field('Against', sel('cl_ptype', CL_PARTY, C.party.type)) : '') +
        (C.party.type === 'supplier' && sups.length ? field(kind === 'claim' ? 'Supplier' : 'Send back to', sel('cl_sup', [['', 'Choose…']].concat(sups.map((s) => [s.id, s.name])).concat([['__other', 'Someone else…']]), C.party.supplierId)) : '') +
        (C.party.type !== 'supplier' || !sups.length || C.party.supplierId === '__other' ? field('Name', inp('cl_pname', C.party.name, 'placeholder="' + (C.party.type === 'shipper' ? 'e.g. the shipping line or forwarder' : C.party.type === 'insurer' ? 'e.g. the insurance company' : 'Who owes you') + '"')) : '') +
        field('Reason', sel('cl_reason', CL_REASONS[kind], C.reason)) + field('Date', inp('cl_date', C.date, 'type="date"')) + '</div>' +
      (kind === 'claim' && ships.length ? '<div class="cl-ship">' + sel('cl_ship', [['', 'Goods missing or damaged on arrival…']].concat(ships.map((s) => [s.id, (s.name || s.containerNo || 'Shipment')])), C.shipmentId, 'id="clShip"') + '<button type="button" class="btn sm" data-a="clFromShip">Add them</button></div>' : '') +
      '<div class="pay-lbl mt2">Items</div>' +
      (C.lines.length ? '<div class="card list mb">' + C.lines.map((l, i) => { const p = byId('products', l.productId) || {}; return '<div class="li" style="cursor:default">' + thumb(p, 36, 9) + '<div class="grow" style="min-width:0"><div class="t ellipsis">' + esc(p.name || l.name || '?') + '</div><div class="tiny muted">' + (kind === 'return' ? lossAvail(l.productId, loc) + ' in stock here' : l.note || '') + (seeCost() ? ' · ' + F(num(l.unitCost ?? unit(l.productId))) + ' each' : '') + '</div></div><input class="inp loss-qty" inputmode="numeric" data-clq="' + i + '" value="' + esc(l.qty) + '" aria-label="Quantity"><button class="icon-btn" data-a="clDrop" data-i="' + i + '" aria-label="Remove">' + ic('x') + '</button></div>'; }).join('') + '</div>' : '') +
      '<div class="search">' + ic('search') + '<input class="inp" id="clQ" placeholder="Add an item" value="' + esc(sh._q) + '" autocomplete="off"></div>' +
      (matches.length ? '<div class="card list loss-matches">' + matches.map((p) => '<div class="li" data-a="clAdd" data-id="' + esc(p.id) + '">' + thumb(p, 32, 8) + '<div class="grow t ellipsis">' + esc(p.name) + '</div>' + (kind === 'return' ? '<span class="tiny muted">' + lossAvail(p.id, loc) + ' here</span>' : '') + '</div>').join('') + '</div>' : '') +
      '<div class="grid2 mt2">' + field(kind === 'return' ? 'Refund you expect (' + baseSym() + ')' : 'Amount claimed (' + baseSym() + ')', inp('cl_amount', C.amount, 'inputmode="numeric" placeholder="' + (seeCost() ? fmt(total()) + ' at cost' : 'Amount') + '"')) + field('Note (optional)', inp('cl_notes', C.notes, 'placeholder="Reference, who you spoke to…"')) + '</div>' +
      '<div class="pay-lbl">Photos <span class="tiny muted">(optional)</span></div><div class="loss-photos">' + C.photos.map((ph, i) => '<div class="loss-ph"><img src="' + esc(imgSrc(ph)) + '" alt=""><button class="icon-btn" data-a="clPhotoDrop" data-i="' + i + '" aria-label="Remove photo">' + ic('x', 'sm') + '</button></div>').join('') + (C.photos.length < 4 ? '<button type="button" class="loss-ph add" data-a="clPhotoAdd">' + ic('plus') + '<span>Add a photo</span></button>' : '') + '</div>' +
      (kind === 'return' ? '<p class="hint" style="margin:8px 0 0">The items leave stock now. It is not a loss unless the supplier refuses and you write it off.</p>' : ''));
    $$('select', sh).forEach((s) => (s.onchange = () => { keep(); if (s.id !== 'clShip') sh._draw(); else C.shipmentId = s.value; }));
    const q = $('#clQ', sh); q.oninput = () => { keep(); clearTimeout(sh._t); sh._t = setTimeout(() => { sh._q = q.value; sh._draw(); const qq = $('#clQ', sh); qq.focus(); qq.setSelectionRange(qq.value.length, qq.value.length); }, 200); };
  };
  sh._keep = keep; sh._C = C; sh._draw();
  $('#clSave', sh).onclick = async () => {
    keep();
    let name = C.party.name.trim(); if (C.party.type === 'supplier' && C.party.supplierId && C.party.supplierId !== '__other') name = (byId('suppliers', C.party.supplierId) || {}).name || name;
    if (!name) return toast('Say who owes you the money', true);
    const lines = C.lines.filter((l) => num(l.qty) > 0).map((l) => ({ productId: l.productId, name: (byId('products', l.productId) || {}).name || l.name || '', qty: num(l.qty), unitCost: Math.round(num(l.unitCost ?? unit(l.productId))) }));
    if (kind === 'return' && !lines.length) return toast('Add the items you send back', true);
    const short = kind === 'return' && lines.find((l) => l.qty > lossAvail(l.productId, loc)); if (short) return toast('Only ' + lossAvail(short.productId, loc) + ' × ' + short.name + ' in stock here', true);
    const amount = C.amount === '' ? Math.round(lines.reduce((a, l) => a + l.qty * l.unitCost, 0)) : Math.round(num(C.amount));
    if (!(amount > 0)) return toast('Type the amount you are owed', true);
    const doc = { id: uid('cl_'), no: KC.newTxnId(kind === 'return' ? 'RT' : 'CL', C.date), kind, date: C.date, locationId: loc, party: { type: C.party.type, supplierId: C.party.supplierId && C.party.supplierId !== '__other' ? C.party.supplierId : '', name },
      shipmentId: C.shipmentId || '', lines, amount, reason: C.reason, notes: String(C.notes || '').trim(), photos: C.photos.slice(), received: [], status: 'open', by: K.me.name || '', byId: K.me.id || '' };
    if (kind === 'return') { // out of stock now: newest batches first; fixed ids so a retry never doubles it
      for (const [i, l] of lines.entries()) { let left = l.qty, j = 0; for (const lt of lossLots(l.productId, loc)) { if (left <= 0) break; const av = Math.max(0, (K.C.lotX[lt.id].byLoc || {})[loc] || 0); const take = Math.min(av, left); if (take <= 0) continue; if (!(await save('adjustments', { id: 'a_cl_' + doc.id + '_' + i + '_' + j++, date: doc.date, productId: l.productId, lotId: lt.id, qty: -take, locationId: loc, reason: 'Returned to supplier', cause: 'returned', claimId: doc.id, notes: doc.no + ' → ' + name, byId: K.me.id || '', by: K.me.name || '' }))) return; left -= take; } }
    }
    if (!(await save('claims', doc))) return;
    closeSheet(); render(true); toast(kind === 'return' ? 'Sent back — ' + F(amount) + ' owed to you by ' + name : 'Claim recorded — ' + F(amount) + ' owed by ' + name);
  };
};
const clSheet = (el) => el.closest('.scrim');
A.clAdd = (el) => { const sh = clSheet(el); sh._keep(); sh._C.lines.push({ productId: el.dataset.id, qty: 1 }); sh._q = ''; sh._draw(); };
A.clDrop = (el) => { const sh = clSheet(el); sh._keep(); sh._C.lines.splice(+el.dataset.i, 1); sh._draw(); };
A.clPhotoDrop = (el) => { const sh = clSheet(el); sh._keep(); sh._C.photos.splice(+el.dataset.i, 1); sh._draw(); };
A.clPhotoAdd = async (el) => { const sh = clSheet(el); const f = await chooseFile('image/*', 'environment'); if (!f) return; try { const ref = await storeEvidence(f); sh._keep(); sh._C.photos.push(ref); sh._draw(); } catch (e) { toast(e.message || 'Could not add the photo', true); } };
A.clFromShip = (el) => {
  const sh = clSheet(el); sh._keep(); const C = sh._C; const sid = ($('#clShip', sh) || {}).value; if (!sid) return toast('Choose the shipment', true);
  C.shipmentId = sid; let n = 0;
  K.raw.lots.filter((l) => l.shipmentId === sid && num(l.recvMissing) + num(l.recvDamaged) > 0).forEach((l) => {
    const q = num(l.recvMissing) + num(l.recvDamaged); const ex = C.lines.find((x) => x.productId === l.productId);
    const note = [num(l.recvMissing) ? num(l.recvMissing) + ' missing' : '', num(l.recvDamaged) ? num(l.recvDamaged) + ' damaged' : ''].filter(Boolean).join(', ');
    if (ex) ex.qty = num(ex.qty) + q; else C.lines.push({ productId: l.productId, qty: q, unitCost: (K.C.lotX[l.id] || {}).landedUnit || 0, note }); n++;
  });
  if (C.reason === CL_REASONS.claim[0] || !C.reason) C.reason = 'Missing on arrival';
  sh._draw(); toast(n ? n + ' item' + (n === 1 ? '' : 's') + ' added from the shipment' : 'Nothing missing or damaged in that shipment');
};

/* ---------- one record: money received, settle, write off ---------- */
A.clOpen = (el) => {
  const id = el.dataset.id; const sh = openSheet({ title: 'Return / claim', body: '' });
  sh.classList.add('loss-sheet'); sh.querySelector('.sheet').insertAdjacentHTML('beforeend', '<div class="sf"></div>');
  sh._refresh = () => {
    const c = byId('claims', id); if (!c) return closeSheet(); const open = c.status !== 'closed'; const left = clLeft(c);
    $('.sh h2', sh).textContent = CL_KIND[c.kind] + ' ' + (c.no || '');
    setSheetBody(sh, '<div class="row between wrap mb"><b>' + esc(clParty(c)) + '</b>' + clBadge(c) + '</div>' +
      '<div class="kpis mb">' + kpi('Claimed', F(c.amount)) + kpi('Received', F(clGot(c))) + kpi(open ? 'Still owed' : c.outcome === 'writtenOff' ? 'Written off' : 'Settled', F(open ? left : c.outcome === 'writtenOff' ? Math.max(0, num(c.amount) - clGot(c)) : 0), '', true) + '</div>' +
      '<div class="bill-rows small mb">' + [['Date', fmtDate(c.date)], ['Reason', c.reason || '—'], c.shipmentId ? ['Shipment', (byId('shipments', c.shipmentId) || {}).name || '—'] : null, ['Recorded by', c.by || '—'], c.closedAt ? [c.outcome === 'writtenOff' ? 'Written off by' : 'Closed by', (c.closedBy || '') + ' · ' + fmtDT(c.closedAt)] : null].filter(Boolean).map(([k, v]) => '<div class="row between cl"><span class="muted">' + k + '</span><b>' + esc(v) + '</b></div>').join('') + '</div>' +
      (c.notes ? '<div class="loss-note">' + esc(c.notes) + '</div>' : '') + (c.writeOffNote ? '<div class="alert bad mb">Written off: ' + esc(c.writeOffNote) + '</div>' : '') +
      ((c.lines || []).length ? '<div class="card tw mb"><table class="t"><thead><tr><th>Item</th><th class="r">Qty</th>' + (seeCost() ? '<th class="r">At cost</th>' : '') + '</tr></thead><tbody>' + c.lines.map((l) => '<tr><td>' + esc((byId('products', l.productId) || {}).name || l.name) + '</td><td class="r">' + num(l.qty) + '</td>' + (seeCost() ? '<td class="r money">' + fmt(num(l.qty) * num(l.unitCost)) + '</td>' : '') + '</tr>').join('') + '</tbody></table></div>' : '') +
      '<h3 class="mb">Money received</h3>' + ((c.received || []).length ? '<div class="card list mb">' + c.received.map((r) => '<div class="li" style="cursor:default"><div class="grow"><div class="b">' + F(r.amount) + '</div><div class="tiny muted">' + esc(fmtDate(r.date) + ' · ' + (r.method || '') + (r.ref ? ' · ' + r.ref : '') + (r.by ? ' · ' + r.by : '')) + '</div></div></div>').join('') + '</div>' : '<div class="tiny muted mb">Nothing yet.</div>') +
      (open && clCan() ? '<div class="cl-pay">' + field('Amount', inp('clr_amt', left || '', 'inputmode="numeric"')) + field('How', sel('clr_m', ['Bank transfer', 'Cash', 'MTN MoMo', 'Orange Money', 'Credit note / deducted from a bill'], 'Bank transfer')) + field('Reference', inp('clr_ref', '', 'placeholder="Optional"')) + '<button class="btn" data-a="clPay" data-id="' + esc(id) + '">' + ic('check', 'sm') + 'Record</button></div>' : '') +
      ((c.photos || []).length ? '<div class="loss-photos view mt">' + c.photos.map((ph) => '<a class="loss-ph" href="' + esc(imgSrc(ph)) + '" target="_blank" rel="noopener"><img src="' + esc(imgSrc(ph)) + '" alt=""></a>').join('') + '</div>' : ''));
    $('.sf', sh).innerHTML = open && clCan() ? '<button class="btn danger" data-a="clWriteOff" data-id="' + esc(id) + '">Write off</button>' + (clGot(c) > 0 ? '<button class="btn pri grow" data-a="clSettle" data-id="' + esc(id) + '">' + ic('check', 'sm') + 'Close — settled</button>' : '<button class="btn pri grow" data-a="sheetClose">Close</button>') : '<button class="btn pri grow" data-a="sheetClose">Close</button>';
  };
  sh._refresh();
};
A.clPay = async (el) => {
  const c = byId('claims', el.dataset.id); const sh = el.closest('.scrim'); const v = formVals(sh); const amt = Math.round(num(v.clr_amt));
  if (!(amt > 0)) return toast('Type the amount received', true);
  const received = (c.received || []).concat([{ id: uid('cr_'), date: todayStr(), amount: amt, method: v.clr_m, ref: String(v.clr_ref || '').trim(), by: K.me.name || '' }]);
  const done = received.reduce((a, r) => a + num(r.amount), 0) >= num(c.amount);
  if (await save('claims', Object.assign({}, c, { received }, done ? { status: 'closed', outcome: 'settled', closedAt: new Date().toISOString(), closedBy: K.me.name || '' } : {}))) { toast(done ? 'Fully paid back — closed' : F(amt) + ' received'); refreshSheets(); render(true); }
};
A.clSettle = async (el) => {
  const c = byId('claims', el.dataset.id); if (!(await confirmBox('Close it as settled? ' + F(clGot(c)) + ' of ' + F(c.amount) + ' was paid back; the rest is accepted as is.', 'Close'))) return;
  if (await save('claims', Object.assign({}, c, { status: 'closed', outcome: 'settled', closedAt: new Date().toISOString(), closedBy: K.me.name || '' }))) { refreshSheets(); render(true); }
};
A.clWriteOff = async (el) => {
  const c = byId('claims', el.dataset.id);
  const why = await askReason('Write off ' + F(clLeft(c)) + '? It will not be paid back' + (c.kind === 'return' ? ' — the returned goods count as a loss.' : '.'), ['Supplier refused', 'No answer', 'Not worth chasing', 'Other'], 'Write off'); if (why === null) return;
  if (await save('claims', Object.assign({}, c, { status: 'closed', outcome: 'writtenOff', writeOffNote: why, closedAt: new Date().toISOString(), closedBy: K.me.name || '' }))) { toast('Written off'); refreshSheets(); render(true); }
};
