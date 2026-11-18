/* Aahsso — cash handover, suppliers & bills, debt reminders, locations */

/* ================= CASH HANDOVER ================= */
const hoId = (date, uid_) => 'h_' + date + '_' + String(uid_).replace(/[^A-Za-z0-9_\-]/g, '');
const sumObj = (o) => Object.values(o || {}).reduce((a, v) => a + num(v), 0);
VIEWS.cash = {
  render() {
    const d = K.ui.cashDate || todayStr();
    const mine = KC.collectedBy(K.raw, K.me.id, d);
    const ho = byId('handovers', hoId(d, K.me.id));
    let html = '<div class="row wrap mb"><input type="date" class="inp" style="width:auto" value="' + d + '" data-c="cashDate"><span class="small muted">' + fmtDate(d) + '</span></div>';
    if (has('tills')) { html += tillIncoming(); loadPeople(); }
    if (can('payments')) {
      html += '<div class="card pad2 mb"><div class="row between mb"><h2>My cash & mobile money</h2>' + (ho ? hoBadge(ho) : '') + '</div>' +
        '<div class="tiny muted mb">Everything you recorded today, by method. Count your cash and check your MoMo/OM balances, then hand over.</div>' +
        (mine.items.length || mine.moves.length ? (mine.moves.length ? '<div class="row between cl"><span>Collected by you</span><span class="money">' + F(mine.collected) + '</span></div>' + mine.moves.map((x) => '<div class="row between cl small"><span>' + (x.dir === 'in' ? 'Till taken over from ' + esc(x.t.fromName || 'colleague') : 'Till handed to ' + esc(x.t.toName || 'colleague')) + ' · ' + hm(x.t.acceptedAt) + (x.t.status === 'disputed' ? ' <span class="badge bad">difference</span>' : '') + '</span><span class="money">' + (x.dir === 'in' ? '+ ' : '− ') + fmt(sumObj(x.t.received)) + '</span></div>').join('') + '<div class="tiny muted mt mb">Now in your hands, by method:</div>' : '') + Object.entries(mine.by).map(([m, v]) => '<div class="row between cl"><span>' + esc(m) + (mine.feesBy[m] ? ' <span class="tiny muted">+ ' + F(mine.feesBy[m]) + ' charges</span>' : '') + '</span><b class="money">' + F(v) + '</b></div>').join('') + '<div class="row between cl b"><span>' + (mine.moves.length ? 'To hand over' : 'Total collected') + '</span><span class="money">' + F(mine.total) + '</span></div>' : '<div class="muted small">You recorded no payments on this day.</div>') +
        (has('tills') ? tillOutgoing(d, mine) : '') +
        (ho ? '<div class="alert ' + (Math.abs(ho.diff) < 1 ? 'info' : 'bad') + ' mt">Handed over ' + F(sumObj(ho.declared) + num(ho.payouts)) + ' · ' + diffText(ho.diff) + (ho.status === 'confirmed' ? ' · confirmed by ' + esc(ho.confirmedBy || '') : ' · waiting for manager') + '</div>' : '') +
        dayWatchHTML(dayWatch(d, K.me.id), true) +
        (has('cashHandover') && (!ho || ho.status !== 'confirmed') ? '<button class="btn pri block mt" data-a="hoOpen" data-d="' + d + '">' + ic('wallet') + (ho ? 'Update my handover' : 'Close my day & hand over') + '</button>' : '') + '</div>';
    }
    if (can('handover') && has('cashHandover')) {
      const people = {};
      K.raw.sales.forEach((s) => (s.payments || []).forEach((p) => { if (p.date === d && p.byId) people[p.byId] = people[p.byId] || p.by || 'Staff'; }));
      K.raw.handovers.filter((h) => h.date === d).forEach((h) => (people[h.userId] = people[h.userId] || h.userName));
      const rows = Object.entries(people).map(([id, name]) => ({ id, name, exp: KC.collectedBy(K.raw, id, d), ho: byId('handovers', hoId(d, id)) }));
      const all = dayWatch(d, null); const done = rows.filter((r) => r.ho && r.ho.status === 'confirmed').length; const diff = rows.reduce((a, r) => a + (r.ho ? num(r.ho.diff) : 0), 0);
      html += '<section class="card pad2 mb day-glance"><div class="row between wrap mb"><h2>Day at a glance · ' + esc(fmtDate(d)) + '</h2><button class="btn sm" data-a="dayCopy" data-d="' + d + '">' + ic('copy', 'sm') + 'Copy day report</button></div>' +
        '<div class="kpis mb">' + kpi('Sales', F(all.revenue), all.receipts + ' receipt' + (all.receipts === 1 ? '' : 's'), true) + kpi('Handovers', done + ' / ' + rows.length, rows.length ? (done === rows.length ? 'all confirmed' : (rows.length - done) + ' still open') : 'nobody collected money') + (rows.some((r) => r.ho) ? kpi('Cash difference', Math.abs(diff) < 1 ? 'None' : F(diff), Math.abs(diff) < 1 ? 'balanced so far' : diff < 0 ? 'short' : 'over') : kpi('Cash difference', '—', 'nobody handed over yet')) + kpi('Losses recorded', String(all.losses), all.lossValue && seeCost() ? F(all.lossValue) : '') + '</div>' +
        dayWatchHTML(all, false) + '</section>';
      html += '<h2 class="mb">Team handovers · ' + fmtDate(d) + '</h2><div class="mb">' + hoTable(rows, d) + '</div>';
      const tl = (K.raw.tills || []).filter((x) => x.date === d && x.status !== 'cancelled');
      if (tl.length) html += '<h2 class="mb">Till takeovers · ' + fmtDate(d) + '</h2><div class="mb">' + tillTable(tl) + '</div>';
      // shortages over 30 days
      const from = KC.addDays(todayStr(), -29); const agg = {};
      K.raw.handovers.filter((h) => h.date >= from).forEach((h) => { const o = (agg[h.userId] = agg[h.userId] || { name: h.userName, short: 0, over: 0, days: 0 }); o.days++; if (h.diff < 0) o.short += -h.diff; else o.over += h.diff; });
      const ag = Object.values(agg);
      if (ag.length) html += '<div class="card pad mb"><h3 class="mb">Last 30 days — differences by person</h3>' + ag.sort((a, b) => b.short - a.short).map((o) => '<div class="row between cl"><span>' + esc(o.name) + ' <span class="tiny faint">' + o.days + ' day(s)</span></span><span class="small">' + (o.short ? '<b style="color:var(--bad)">short ' + F(o.short) + '</b>' : '<span style="color:var(--ok)">no shortage</span>') + (o.over ? ' · over ' + F(o.over) : '') + '</span></div>').join('') + '</div>';
    }
    return html;
  },
};
/** What happened during a day, for one person (userId) or the whole shop (null): items sold and the risky moments. */
function dayWatch(d, userId) {
  const mineS = (s) => !userId || s.createdById === userId;
  const live = K.raw.sales.filter((s) => saleDate(s) === d && mineS(s) && (K.C.saleX[s.id] || {}).status !== 'cancelled');
  const items = new Map(); let revenue = 0, discounts = 0;
  live.forEach((s) => { revenue += (K.C.saleX[s.id] || {}).net || 0; discounts += num(s.discount); (s.lines || []).forEach((l) => { const back = (l.returns || []).reduce((a, r) => a + num(r.qty), 0); const q = num(l.qty) - back; if (q > 0) items.set(l.productId, (items.get(l.productId) || 0) + q); const full = (K.C.prodX[l.productId] || {}).priceMax; if (full && num(l.unitPrice) < full) discounts += (full - num(l.unitPrice)) * num(l.qty); }); });
  let refunds = 0; K.raw.sales.forEach((s) => (s.payments || []).forEach((p) => { if (p.date === d && num(p.amount) < 0 && (!userId || p.byId === userId)) refunds += -num(p.amount); }));
  const cancelled = K.raw.sales.filter((s) => String(s.cancelledAt || '').slice(0, 10) === d && (!userId || s.createdById === userId));
  const approvals = []; K.raw.sales.forEach((s) => (s.approvals || []).forEach((a) => { if (String(a.at).slice(0, 10) === d && (!userId || a.forId === userId)) approvals.push(Object.assign({ no: s.no }, a)); }));
  const ls = (K.raw.losses || []).filter((L) => L.date === d && L.status !== 'rejected' && L.status !== 'withdrawn' && (!userId || L.reportedById === userId));
  return { d, receipts: live.length, revenue, items: [...items].sort((a, b) => b[1] - a[1]), units: [...items.values()].reduce((a, b) => a + b, 0), discounts: Math.round(discounts), refunds, cancelled, approvals, losses: ls.length, lossValue: ls.reduce((a, L) => a + (typeof lossValue === 'function' ? lossValue(L) : 0), 0) };
}
function dayWatchHTML(w, mine) {
  const WHAT = { cancel: 'cancellation', returns: 'refund', discount: 'discount', credit: 'credit over the limit' };
  const flags = [
    w.discounts ? ['Discounts & lower prices', F(w.discounts)] : null,
    w.refunds ? ['Refunds paid', F(w.refunds)] : null,
    w.cancelled.length ? ['Cancelled sales', w.cancelled.length + ' (' + w.cancelled.map((s) => s.no).slice(0, 3).join(', ') + (w.cancelled.length > 3 ? '…' : '') + ')'] : null,
    w.approvals.length ? ['Manager approvals', w.approvals.map((a) => a.by + ': ' + (WHAT[a.action] || a.action) + (mine ? '' : ' for ' + a.for)).slice(0, 4).join(' · ')] : null,
    !mine && w.losses ? ['Losses recorded', String(w.losses)] : null,
  ].filter(Boolean);
  return '<details class="day-watch mt"' + (mine ? '' : ' open') + '><summary>' + (mine ? 'What I sold today' : 'Items sold') + ' <span class="hint">— ' + fmt(w.units) + ' unit' + (w.units === 1 ? '' : 's') + ', ' + w.items.length + ' item' + (w.items.length === 1 ? '' : 's') + (flags.length ? ' · ' + flags.length + ' thing' + (flags.length === 1 ? '' : 's') + ' to check' : '') + '</span></summary>' +
    (flags.length ? '<div class="day-flags">' + flags.map(([k, v]) => '<div class="row between cl"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>').join('') + '</div>' : '') +
    (w.items.length ? '<div class="day-items">' + w.items.map(([pid, q]) => { const p = byId('products', pid) || {}; return '<div class="row between cl small"><span class="ellipsis">' + esc(p.name || '?') + '</span><b>' + q + (KC.packText(p, q) ? ' <span class="tiny muted">(' + esc(KC.packText(p, q)) + ')</span>' : '') + '</b></div>'; }).join('') + '</div>' : '<div class="tiny muted">Nothing sold.</div>') + '</details>';
}
A.dayCopy = (el) => {
  const d = el.dataset.d; const w = dayWatch(d, null); const c = typeof dayClose === 'function' ? dayClose(d) : null;
  const t = (c ? dayCloseText(c) : '*Day ' + fmtDate(d) + '*') + '\n\n*Items sold (' + fmt(w.units) + ')*\n' + w.items.map(([pid, q]) => '  ' + ((byId('products', pid) || {}).name || '?') + ': ' + q).join('\n') +
    (w.discounts ? '\nDiscounts & lower prices: ' + F(w.discounts) : '') + (w.refunds ? '\nRefunds: ' + F(w.refunds) : '') + (w.cancelled.length ? '\nCancelled sales: ' + w.cancelled.length : '') + (w.approvals.length ? '\nManager approvals: ' + w.approvals.length : '') + (w.losses ? '\nLosses recorded: ' + w.losses : '');
  copyText(t);
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
    '<div class="grid2 mt">' + field('Cash paid out today (' + baseSym() + ')', inp('payouts', prev.payouts ?? (myCash.total || ''), 'inputmode="numeric" placeholder="e.g. transport, food"')) + field('What for', inp('payoutNote', prev.payoutNote ?? myCash.note)) + '</div>' + field('Note', inp('notes', prev.notes || ''), 'mt') +
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

/* ================= TILL TAKEOVER (one cashier hands the till to another during the day) ================= */
const tillMethods = (o) => Array.from(new Set(['Cash'].concat(Object.keys(o || {}).filter((m) => num(o[m]) !== 0))));
const tillDiff = (t) => sumObj(t.received) - sumObj(t.counted);
function tillIncoming() {
  const mine = (K.raw.tills || []).filter((t) => t.toId === K.me.id && t.status === 'pending');
  return mine.map((t) => '<div class="card pad2 mb till-in"><div class="row between wrap"><div><h2>' + esc(t.fromName || 'A colleague') + ' is handing you the till</h2><div class="small muted">' + fmtDate(t.date) + ' · ' + hm(t.createdAt) + '. Count everything yourself — without looking at their figures — then accept.</div></div>' +
    '<button class="btn pri" data-a="tillAccept" data-id="' + t.id + '">' + ic('check') + 'Count and accept</button></div></div>').join('');
}
function tillOutgoing(d, mine) {
  if (d !== todayStr()) return '';
  const out = (K.raw.tills || []).filter((t) => t.fromId === K.me.id && t.date === d && t.status === 'pending');
  if (out.length) return out.map((t) => '<div class="alert info mt">Waiting for <b>' + esc(t.toName) + '</b> to count and accept the till (you counted ' + F(sumObj(t.counted)) + '). <button class="btn sm" data-a="tillCancel" data-id="' + t.id + '">Cancel</button></div>').join('');
  return '<button class="btn block mt" data-a="tillGive" data-d="' + d + '">' + ic('users') + 'Hand the till to a colleague</button>';
}
A.tillGive = async (el) => {
  if (K.info.mode === 'saas' && !K._people) await loadPeople();
  const d = el.dataset.d; const exp = KC.collectedBy(K.raw, K.me.id, d);
  const ppl = teamPeople().filter((p) => p.id !== K.me.id).sort((a, b) => ((b.locationId || 'main') === K.loc) - ((a.locationId || 'main') === K.loc) || a.name.localeCompare(b.name));
  if (!ppl.length) return toast('Add the colleague to your team first (Team & access)', true);
  const methods = tillMethods(exp.by);
  const paid = K.raw.expenses.filter((e) => e.date === d && e.byId === K.me.id && (e.method || 'Cash') === 'Cash').reduce((a, e) => a + num(e.amount), 0);
  const sh = openSheet({ title: 'Hand the till to a colleague', body: '<div class="col">' + field('Who takes over', sel('tlTo', [['', 'Choose…']].concat(ppl.map((p) => [p.id, p.name])), '')) +
    '<div class="tiny muted">Count what is in the till now. Your colleague counts it again on their phone before accepting.</div>' +
    methods.map((m) => '<div class="row between cl"><div class="grow"><div class="b">' + esc(m) + '</div><div class="tiny muted">Should be: ' + F(exp.by[m] || 0) + (m === 'Cash' && paid ? ' (you paid out ' + F(paid) + ' today — that stays on your day)' : '') + '</div></div><input class="inp price-in" inputmode="numeric" data-tc="' + esc(m) + '" value=""></div>').join('') +
    '<div class="card pad small"><div class="row between"><span>Should be in the till</span><b class="money">' + F(exp.total) + '</b></div><div class="row between"><span>You counted</span><b class="money" id="tlSum">—</b></div><div class="row between b"><span>Difference</span><span id="tlDiff">—</span></div></div>' +
    field('Note (optional)', inp('tlNote', '')) + '</div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="tlSave">Hand over</button>' });
  const calc = () => { const c = $$('[data-tc]', sh).reduce((a, i) => a + num(i.value), 0); const df = c - exp.total; $('#tlSum', sh).textContent = F(c); const o = $('#tlDiff', sh); o.textContent = diffText(df); o.style.color = Math.abs(df) < 1 ? 'var(--ok)' : df < 0 ? 'var(--bad)' : 'var(--warn)'; return df; };
  sh.addEventListener('input', calc); calc();
  $('#tlSave', sh).onclick = async () => {
    const v = formVals(sh); if (!v.tlTo) return toast('Choose who takes over', true);
    if ($$('[data-tc]', sh).every((i) => i.value === '')) return toast('Type what you counted (0 if empty)', true);
    const counted = {}; $$('[data-tc]', sh).forEach((i) => (counted[i.dataset.tc] = num(i.value)));
    const df = calc(); const to = ppl.find((p) => p.id === v.tlTo);
    if (Math.abs(df) >= 1 && !(await confirmBox('Your count is ' + diffText(df) + ' compared with what the till should hold. Hand over anyway?', 'Hand over'))) return;
    if (await save('tills', { id: uid('tl_'), date: d, fromId: K.me.id, fromName: K.me.name || 'Cashier', toId: to.id, toName: to.name, locationId: K.loc, expected: exp.by, counted, note: v.tlNote, status: 'pending', createdAt: new Date().toISOString() })) { closeSheet(); scheduleRender(); toast(to.name + ' must now count and accept the till'); }
  };
};
A.tillCancel = async (el) => { const t = byId('tills', el.dataset.id); if (t && (await confirmBox('Cancel handing the till to ' + t.toName + '?', 'Cancel handover', true))) { if (await save('tills', Object.assign({}, t, { status: 'cancelled' }))) scheduleRender(); } };
A.tillAccept = (el) => {
  const t = byId('tills', el.dataset.id); if (!t) return;
  const methods = tillMethods(t.counted);
  const sh = openSheet({ title: 'Count the till from ' + (t.fromName || 'your colleague'), body: '<div class="col"><div class="alert info">Count everything in the till now and type what you find. You become responsible for this money.</div>' +
    methods.map((m) => '<div class="row between cl"><div class="grow b">' + esc(m) + '</div><input class="inp price-in" inputmode="numeric" data-tr="' + esc(m) + '" value=""></div>').join('') +
    '<div class="row between card pad small"><span>You counted</span><b class="money" id="trSum">—</b></div>' + field('Note (optional)', inp('trNote', '')) + '</div>',
    foot: '<button class="btn grow" data-a="sheetClose">Not now</button><button class="btn pri grow" id="trSave">' + ic('check') + 'Accept the till</button>' });
  sh.addEventListener('input', () => ($('#trSum', sh).textContent = F($$('[data-tr]', sh).reduce((a, i) => a + num(i.value), 0))));
  $('#trSave', sh).onclick = async () => {
    if ($$('[data-tr]', sh).every((i) => i.value === '')) return toast('Type what you counted (0 if empty)', true);
    const received = {}; $$('[data-tr]', sh).forEach((i) => (received[i.dataset.tr] = num(i.value)));
    const same = Object.keys(Object.assign({}, t.counted, received)).every((m) => Math.abs(num(t.counted[m]) - num(received[m])) < 1);
    if (!same && !(await confirmBox('Your count (' + F(sumObj(received)) + ') is different from ' + t.fromName + "'s count (" + F(sumObj(t.counted)) + '). Accept with your count? The difference is flagged for the manager.', 'Accept my count'))) return;
    if (await save('tills', Object.assign({}, t, { received, status: same ? 'accepted' : 'disputed', acceptedAt: new Date().toISOString(), toName: K.me.name || t.toName, receiveNote: formVals(sh).trNote }))) { closeSheet(); scheduleRender(); toast(same ? 'Till accepted — counts match ✓' : 'Till accepted — difference sent to the manager'); }
  };
};
const tillBadge = (t) => ({ pending: '<span class="badge warn">Waiting</span>', accepted: '<span class="badge ok">Accepted</span>', disputed: '<span class="badge bad">Difference</span>', reviewed: '<span class="badge">Checked</span>' })[t.status] || '';
function tillTable(rows) {
  return dataTable({ id: 'tillList', rows, noun: 'takeover', rowAttr: (t) => ' data-a="tillReview" data-id="' + t.id + '"', cols: [
    { k: 'at', label: 'Time', core: true, v: (t) => t.createdAt || '', html: (t) => hm(t.createdAt) },
    { k: 'who', label: 'From → to', core: true, v: (t) => (t.fromName || '') + ' → ' + (t.toName || '') },
    { k: 'e', label: 'Should be', money: true, v: (t) => sumObj(t.expected) },
    { k: 'c', label: 'Handed over', money: true, v: (t) => sumObj(t.counted) },
    { k: 'r', label: 'Received', core: true, money: true, v: (t) => t.status === 'pending' ? '' : sumObj(t.received) },
    { k: 'd', label: 'Difference', core: true, v: (t) => t.status === 'pending' ? '' : tillDiff(t), html: (t) => t.status === 'pending' ? '—' : '<span style="color:' + (Math.abs(tillDiff(t)) < 1 ? 'var(--ok)' : 'var(--bad)') + '">' + diffText(tillDiff(t)) + '</span>' },
    { k: 's', label: 'Status', core: true, v: (t) => t.status, html: tillBadge },
  ] });
}
A.tillReview = (el) => {
  const t = byId('tills', el.dataset.id); if (!t) return;
  const ms = tillMethods(Object.assign({}, t.expected, t.counted, t.received));
  const sh = openSheet({ title: (t.fromName || '') + ' → ' + (t.toName || '') + ' · ' + hm(t.createdAt), wide: true, body:
    '<div class="card tw mb"><table class="t"><thead><tr><th>Method</th><th class="r">Should be</th><th class="r">' + esc(t.fromName || 'Out') + ' counted</th><th class="r">' + esc(t.toName || 'In') + ' counted</th></tr></thead><tbody>' +
    ms.map((m) => '<tr><td>' + esc(m) + '</td><td class="r money">' + fmt(num((t.expected || {})[m])) + '</td><td class="r money">' + fmt(num((t.counted || {})[m])) + '</td><td class="r money">' + (t.status === 'pending' ? '—' : fmt(num((t.received || {})[m]))) + '</td></tr>').join('') + '</tbody></table></div>' +
    (t.note ? '<div class="small mb"><b>' + esc(t.fromName) + ':</b> ' + esc(t.note) + '</div>' : '') + (t.receiveNote ? '<div class="small mb"><b>' + esc(t.toName) + ':</b> ' + esc(t.receiveNote) + '</div>' : '') +
    (t.status === 'disputed' ? '<div class="alert bad mb">The two counts differ by ' + F(Math.abs(tillDiff(t))) + '. The money counted by ' + esc(t.toName) + ' is what moved; any shortage stays on ' + esc(t.fromName) + '\'s day.</div>' + field('What you found (optional)', inp('rvNote', '')) : '') +
    (t.reviewedBy ? '<div class="tiny muted">Checked by ' + esc(t.reviewedBy) + (t.reviewNote ? ': ' + esc(t.reviewNote) : '') + '</div>' : ''),
    foot: t.status === 'disputed' && can('handover') ? '<button class="btn grow" data-a="sheetClose">Close</button><button class="btn pri grow" id="rvSave">' + ic('check') + 'Mark as checked</button>' : '' });
  if ($('#rvSave', sh)) $('#rvSave', sh).onclick = async () => { if (await save('tills', Object.assign({}, t, { status: 'reviewed', reviewedBy: K.me.name || 'Manager', reviewNote: formVals(sh).rvNote }))) { closeSheet(); scheduleRender(); toast('Takeover checked'); } };
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
    if (isStore()) return storeSuppliers();
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
  if (isStore()) return storeSupOpen(el.dataset.id, el.dataset.n);
  const s = byId('suppliers', el.dataset.id); const bills = K.raw.bills.filter((b) => b.supplierId === s.id).sort((a, b) => billDue(b).localeCompare(billDue(a)));
  openSheet({ title: s.name, body: '<div class="row wrap mb"><button class="btn" data-a="supEdit" data-id="' + s.id + '">' + ic('edit') + 'Edit</button><button class="btn pri" data-a="billNew" data-sup="' + s.id + '">' + ic('plus') + 'New bill</button></div><div class="tiny muted mb">' + esc([s.type, s.phone, s.notes].filter(Boolean).join(' · ')) + '</div>' + kpi('You owe', F(supplierOwed(s.id)), bills.length + ' bill(s)', true) + '<div class="card list mt">' + (bills.map(billRow).join('') || '<div class="empty small">No bills.</div>') + '</div>' });
};
A.supEdit = (el) => supForm(el.dataset.id);
function supForm(id) {
  if (isStore()) return storeSupForm(id);
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
/* ================= Aahsso Store: suppliers, like customers =================
 * One list: who you buy from, their phone, how much you bought and what you still owe them. Tap one to call,
 * WhatsApp, pay a bill, see every purchase, or buy from them again. Purchases are matched by the supplier's name. */
const supKey = (n) => String(n || '').trim().toLowerCase();
function supPurchases(s) { const k = supKey(s.name); return purchaseGroups(K.raw.lots.filter((l) => supKey(l.vendor) === k)).sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
function storeSupStats() {
  const by = {}; purchaseGroups(K.raw.lots).forEach((g) => { const k = supKey(g.vendor); if (!k) return; const o = (by[k] = by[k] || { bought: 0, n: 0, last: '' }); o.bought += g.totalX; o.n++; if ((g.date || '') > o.last) o.last = g.date || ''; });
  return (s) => by[supKey(s.name)] || { bought: 0, n: 0, last: '' };
}
function storeSuppliers() {
  const q = supKey(K.ui.supQ); const st = storeSupStats();
  // anyone you bought from without a supplier card yet gets one in the list too (saved when you open or edit it)
  const known = new Set(K.raw.suppliers.map((s) => supKey(s.name)));
  const extra = []; K.raw.lots.forEach((l) => { const k = supKey(l.vendor); if (k && !known.has(k)) { known.add(k); extra.push({ id: '', name: l.vendor.trim(), phone: l.vendorPhone || '', _new: true }); } });
  const list = K.raw.suppliers.concat(extra).filter((s) => !q || (s.name + ' ' + (s.phone || '') + ' ' + (s.city || '')).toLowerCase().includes(q))
    .sort((a, b) => supplierOwed(b.id) - supplierOwed(a.id) || (st(b).last || '').localeCompare(st(a).last || '') || a.name.localeCompare(b.name));
  return '<div class="kpis mb">' + kpi('You owe suppliers', F(totalOwedSuppliers()), '', true) + kpi('Suppliers', fmt(K.raw.suppliers.length + extra.length)) + '</div>' +
    '<div class="row wrap mb"><button class="btn pri" data-a="supNew">' + ic('plus') + 'New supplier</button></div>' +
    '<div class="search mb">' + ic('search') + '<input class="inp" placeholder="Search name, phone, town" value="' + esc(K.ui.supQ || '') + '" data-c="supQ"></div>' +
    dataTable({
      id: 'supList', rows: list, noun: 'supplier', empty: '<div class="big">🚚</div>No suppliers yet. Add one, or record a purchase — its supplier shows up here.',
      rowAttr: (s) => ' data-a="supOpen" data-id="' + esc(s.id) + '" data-n="' + esc(s.name) + '"',
      cols: [
        { k: 'name', label: 'Name', core: true, v: (s) => s.name, html: (s) => '<b>' + esc(s.name) + '</b>' },
        { k: 'phone', label: 'Phone', core: true, v: (s) => s.phone || '' },
        { k: 'bought', label: 'Bought', core: true, money: true, v: (s) => Math.round(st(s).bought) || '', total: (rows) => fmt(dtSum(rows, (s) => st(s).bought)) },
        { k: 'owed', label: 'You owe', core: true, money: true, v: (s) => supplierOwed(s.id) || '', html: (s) => supplierOwed(s.id) > 0 ? '<span style="color:var(--bad);font-weight:600">' + fmt(supplierOwed(s.id)) + '</span>' : dtNil, total: (rows) => fmt(dtSum(rows, (s) => supplierOwed(s.id))) },
      ],
    });
}
CH.supQ = (el) => { K.ui.supQ = el.value; render(true); };
/** a supplier seen only on purchases: make its card first */
async function supEnsure(id, name) {
  if (id) return id; const ex = K.raw.suppliers.find((s) => supKey(s.name) === supKey(name)); if (ex) return ex.id;
  const l = K.raw.lots.find((x) => supKey(x.vendor) === supKey(name)) || {};
  const s = { id: uid('su_'), name: String(name).trim(), type: 'Store / wholesaler', phone: l.vendorPhone || '' };
  return (await save('suppliers', s)) ? s.id : null;
}
async function storeSupOpen(id0, name) {
  const id = id0 || (await supEnsure('', name || '')); if (!id) return;
  const sh = openSheet({ title: 'Supplier', body: '' });
  sh._refresh = () => {
    const s = byId('suppliers', id); if (!s) return closeSheet();
    const groups = supPurchases(s); const bills = K.raw.bills.filter((b) => b.supplierId === id && b.status !== 'cancelled');
    const open = bills.filter((b) => billX(b).balance > 0.005).sort((a, b) => billDue(a).localeCompare(billDue(b)));
    const bought = groups.reduce((a, g) => a + g.totalX, 0); const wa = phoneWA(s.phone); const tel = String(s.phone || '').replace(/[^\d+]/g, '');
    setSheetBody(sh, '<div class="row mb"><div class="av acc" style="width:44px;height:44px;font-size:15px">' + esc(initials(s.name)) + '</div><div class="grow"><div class="b" style="font-size:16px">' + esc(s.name) + '</div><div class="small muted">' + esc([s.phone, s.city].filter(Boolean).join(' · ') || 'No phone yet') + '</div></div></div>' +
      '<div class="row wrap mb">' + (can('purchases') ? '<button class="btn pri" data-a="supBuy" data-id="' + id + '">' + ic('buy') + 'New purchase</button>' : '') +
        (wa ? '<a class="btn" style="background:#25D366;border-color:#25D366;color:#fff" target="_blank" rel="noopener" href="https://wa.me/' + wa + '">' + ic('wa') + 'WhatsApp</a>' : '') +
        (tel ? '<a class="btn" href="tel:' + esc(tel) + '">' + ic('user') + 'Call</a>' : '') +
        (can('suppliers') ? '<button class="btn" data-a="supEdit" data-id="' + id + '">' + ic('edit') + 'Edit</button>' : '') + '</div>' +
      '<div class="sh-ks sup-ks">' + [['Bought', fmt(bought), ''], ['Purchases', fmt(groups.length), ''], ['You owe', fmt(supplierOwed(id)), supplierOwed(id) > 0 ? ' warn' : '']].map(([l, v, c]) => '<div class="sh-k' + c + '"><span>' + l + '</span><b class="money">' + v + '</b></div>').join('') + '</div>' +
      (s.notes ? '<div class="alert info mb">' + esc(s.notes) + '</div>' : '') +
      (open.length ? '<h3 class="mb">To pay</h3><div class="card list mb">' + open.map(billRow).join('') + '</div>' : '') +
      '<h3 class="mb">Purchases</h3><div class="card list">' + (groups.length ? groups.slice(0, 100).map((g) => '<div class="li" data-a="openPurchase" data-k="' + esc(g.key) + '"><div class="grow" style="min-width:0"><div class="t ellipsis">' + esc(g.lots.map((l) => ((byId('products', l.productId) || {}).name || '?') + ' ×' + fmt(l.qty)).join(', ')) + '</div><div class="tiny muted">' + fmtDate(g.date) + (g.po ? ' · #' + esc(g.po) : '') + '</div></div><div class="right"><div class="b money">' + fmt(g.totalX) + '</div>' + (g.bx && g.bx.balanceX > 0.5 ? '<div class="tiny" style="color:var(--bad)">owe ' + fmt(g.bx.balanceX) + '</div>' : '') + '</div></div>').join('') : '<div class="empty small">Nothing bought from them yet.</div>') + '</div>');
  };
  sh._refresh();
}
/** New purchase with this supplier already chosen */
A.supBuy = (el) => {
  const s = byId('suppliers', el.dataset.id); if (!s) return; closeSheet(); purchaseForm();
  const p = $('#puSeller'); if (!p) return;
  if (![...p.options].some((o) => o.value === s.name)) { const o = document.createElement('option'); o.value = o.textContent = s.name; p.insertBefore(o, p.options[1] || null); }
  p.value = s.name; p.dispatchEvent(new Event('change', { bubbles: true }));
};
function storeSupForm(id) {
  const s = id ? byId('suppliers', id) : {};
  const used = id && (K.raw.bills.some((b) => b.supplierId === id) || supPurchases(s).length);
  const sh = openSheet({ title: id ? 'Edit supplier' : 'New supplier', body: '<div class="col">' + field('Name', inp('name', s.name, 'placeholder="e.g. Santa Lucia Akwa"')) + '<div class="grid2">' + field('Phone', inp('phone', s.phone, 'inputmode="tel" placeholder="6XX XX XX XX"')) + field('Town / area', inp('city', s.city, 'placeholder="e.g. Akwa, Douala"')) + '</div>' + field('Notes', inp('notes', s.notes, 'placeholder="What they sell, days they deliver…"')) + '</div>',
    foot: (id && !used ? '<button class="btn danger" id="suDel" title="Delete">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="suSave">' + ic('check') + 'Save</button>' });
  $('#suSave', sh).onclick = async () => {
    const v = formVals(sh); v.name = (v.name || '').trim(); if (!v.name) return toast('Enter a name', true);
    if (K.raw.suppliers.some((x) => x.id !== id && supKey(x.name) === supKey(v.name))) return toast('You already have a supplier called ' + v.name, true);
    const old = s.name; const rec = Object.assign({ type: 'Store / wholesaler' }, s, v, { id: id || uid('su_') });
    if (!(await save('suppliers', rec))) return;
    // renamed: keep its purchases with it
    if (id && old && supKey(old) !== supKey(v.name)) for (const l of K.raw.lots.filter((x) => supKey(x.vendor) === supKey(old))) await save('lots', Object.assign({}, l, { vendor: v.name }));
    closeSheet(); scheduleRender(); toast(id ? 'Supplier saved' : 'Supplier added');
  };
  if ($('#suDel', sh)) $('#suDel', sh).onclick = async () => { if (await confirmBox('Delete ' + s.name + '?', 'Delete', true)) { await remove('suppliers', id); closeSheet(); closeSheet(); scheduleRender(); } };
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
      (K.info.mode === 'saas' ? '<div class="card pad mb auto-rem"><div class="row between"><div><h3>Automatic reminders</h3><div class="tiny muted">Sent by the server every day at the chosen hour (provider: <b id="remProv">…</b>).</div></div>' + (can('settings') ? '<label class="toggle"><input type="checkbox" id="autoRem"' + (S().autoReminders ? ' checked' : '') + '>On</label>' : '') + '</div>' + (can('settings') ? '<div class="row wrap mt"><span class="small">Send at</span><select class="inp" style="width:auto" id="remHour">' + Array.from({ length: 15 }, (_, i) => i + 7).map((h) => '<option value="' + h + '"' + (num(S().reminderHour ?? 9) === h ? ' selected' : '') + '>' + h + ':00</option>').join('') + '</select><button class="btn sm" data-a="remRun" data-dry="1">Preview</button><button class="btn sm pri" data-a="remRun">Send now</button></div>' : '') + '</div>' : '') +
      '<div class="chips mb">' + [['due', 'To remind today'], ['overdue', 'Overdue'], ['all', 'Everyone owing']].map(([k, l]) => '<button class="chip' + (f === k ? ' on' : '') + '" data-a="remF" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      remTable(list);
  },
};
A.remF = (el) => { K.ui.remF = el.dataset.v; render(true); };
document.addEventListener('click', (e) => { const a = e.target.closest('[data-a2="remLog"]'); if (!a) return; const bal = num(a.dataset.bal); setTimeout(() => save('reminders', { id: uid('rm_'), customerId: a.dataset.c, channel: a.dataset.ch, balance: bal, at: new Date().toISOString(), by: K.me.name || '', auto: false }).then(() => scheduleRender()), 300); }, true);
A.remCopy = async (el) => { const o = owingCustomers().find((x) => x.id === el.dataset.c); await copyText(reminderText(o)); await save('reminders', { id: uid('rm_'), customerId: o.id, channel: 'copied', balance: Math.round(o.balance), at: new Date().toISOString(), by: K.me.name || '' }); };

/* ================= LOCATIONS (settings card) ================= */
function locationsCard() {
  return '<div class="card pad2 mb"><h2 class="mb">Branches & warehouses</h2><div class="tiny muted mb">Each branch keeps its own stock. Move stock with Branch transfers. Staff can be tied to one branch in Team & access.</div><div class="card list loc-list">' +
    allLocs().map((l) => '<div class="li" data-a="locEdit" data-id="' + l.id + '"><div class="av">' + ic('home', 'sm') + '</div><div class="grow"><div class="t">' + esc(l.name) + '</div><div class="tiny muted">' + (l.id === 'main' ? 'Main location — containers unload here by default' : esc(l.type || 'Shop') + (l.address ? ' · ' + esc(l.address) : '')) + '</div></div>' + ic('edit', 'sm') + '</div>').join('') + '</div><div class="loc-acts"><button class="btn" data-a="locEdit">' + ic('plus') + 'Add branch</button></div></div>';
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

/* stock counts: see v-count.js */
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
      { k: 'diff', label: 'Difference', core: true, money: true, v: (r) => r.ho ? Math.round(diff(r)) : '', html: (r) => !r.ho ? dtNil : '<span style="font-weight:600;color:' + (Math.abs(diff(r)) < 1 ? 'var(--ok)' : diff(r) < 0 ? 'var(--bad)' : 'var(--warn)') + '">' + (Math.abs(diff(r)) < 1 ? 'Balanced' : fmt(diff(r))) + '</span>' },
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
      { k: 'owed', label: 'Owed', core: true, money: true, v: (b) => owed(b) || '', html: (b) => owed(b) ? '<span style="color:var(--bad);font-weight:600">' + money(owed(b), b.currency) + '</span>' : dtNil },
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
      { k: 'owed', label: 'You owe', core: true, money: true, v: (s) => supplierOwed(s.id) || '', html: (s) => supplierOwed(s.id) > 0 ? '<span style="color:var(--bad);font-weight:600">' + fmt(supplierOwed(s.id)) + '</span>' : dtNil, total: (rows) => fmt(dtSum(rows, (s) => supplierOwed(s.id))) },
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
      { k: 'bal', label: 'Owes', core: true, money: true, v: (o) => o.balance, html: (o) => '<span style="color:var(--bad);font-weight:600">' + fmt(o.balance) + '</span>', total: (rows) => fmt(dtSum(rows, (o) => o.balance)) },
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

