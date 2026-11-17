/* ================= LOSSES =================
 * Stock that disappears — theft, damage, rats & pests, water, expiry… — is reported as a loss.
 * Staff report it (with a photo for theft, damage and pests); a manager approves it and only then does the stock go
 * down and the loss count in profit. A manager's own loss applies at once. The Losses page shows what each cause costs.
 * Every stock loss in the app counts here: loss reports, stock-count shortages, missing in transfers, and goods
 * missing or damaged when a container arrived. */
const LOSS_ST = { pending: ['Waiting for approval', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'], withdrawn: ['Withdrawn', ''] };
const lossMgr = () => can('stockEdit');
const lossCan = () => can('lossReport') || can('stockEdit');
/** warehouse batches of an item at a branch that a loss can come out of, newest first */
function lossLots(pid, loc) {
  const x = K.C.prodX[pid]; if (!x) return [];
  return x.lotIds.map((id) => byId('lots', id)).filter((l) => l && !l.reservedFor && (K.C.lotX[l.id] || {}).stage === 'warehouse')
    .sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''));
}
const lossAvail = (pid, loc) => lossLots(pid, loc).reduce((a, l) => a + Math.max(0, (K.C.lotX[l.id].byLoc || {})[loc] || 0), 0);
const lossUnit = (pid) => (K.C.prodX[pid] || {}).avgCost || 0;
const lossValue = (L) => (L.lines || []).reduce((a, l) => a + num(l.qty) * (num(l.unitCost) || lossUnit(l.productId)), 0);
const lossItems = (L) => (L.lines || []).map((l) => num(l.qty) + ' × ' + ((byId('products', l.productId) || {}).name || l.name || '?')).join(', ');
const lossBadge = (L) => '<span class="badge ' + LOSS_ST[L.status][1] + '">' + LOSS_ST[L.status][0] + '</span>';
const causeChip = (k) => '<span class="cause-chip c-' + esc(k) + '">' + esc(KC.lossCause(k).label) + '</span>';

/** Every unit of stock lost, as events: {date, productId, qty, value, cause, loc} */
function lossEvents() {
  const out = [];
  K.raw.adjustments.forEach((a) => {
    if (num(a.qty) >= 0) return; const x = K.C.lotX[a.lotId] || {};
    if (a.cause === 'returned') { const c = a.claimId && byId('claims', a.claimId); if (!c || c.outcome !== 'writtenOff') return; } // sent back: a loss only if never paid back
    out.push({ date: a.date || '', productId: a.productId, qty: -num(a.qty), value: -num(a.qty) * (x.landedUnit || 0), cause: KC.lossCauseOf(a), loc: a.locationId || 'main', lossId: a.lossId || '' });
  });
  K.raw.lots.forEach((l) => {
    const q = num(l.recvMissing) + num(l.recvDamaged); if (!q) return; const x = K.C.lotX[l.id] || {};
    const sh = byId('shipments', l.shipmentId) || {};
    out.push({ date: String(sh.receivedAt || sh.arrivedAt || l.purchaseDate || '').slice(0, 10), productId: l.productId, qty: q, value: q * (x.landedUnit || 0), cause: 'arrival', loc: x.home || 'main' });
  });
  return out;
}
function lossRange(p) {
  const t = todayStr(); const m = t.slice(0, 7);
  if (p === 'month') return [m + '-01', t, 'this month'];
  if (p === '3m') { const d = new Date(t); d.setMonth(d.getMonth() - 2); return [d.toISOString().slice(0, 7) + '-01', t, 'the last 3 months']; }
  if (p === 'year') return [t.slice(0, 4) + '-01-01', t, 'this year'];
  return ['0000', '9999', 'all time'];
}
/** the same length of time just before [from, to] (for "up / down" comparisons) */
function lossPrev(from, to) {
  if (from === '0000') return null; const a = new Date(from), b = new Date(to); const days = Math.round((b - a) / 864e5) + 1;
  const pe = new Date(a.getTime() - 864e5), ps = new Date(a.getTime() - days * 864e5); return [ps.toISOString().slice(0, 10), pe.toISOString().slice(0, 10)];
}

VIEWS.losses = {
  render() {
    const mgr = lossMgr(); const mine = (L) => L.reportedById === K.me.id; const locs = myLocs().map((l) => l.id);
    const visible = K.raw.losses.filter((L) => (mgr || mine(L) || can('reports')) && (can('allLocations') || locs.includes(L.locationId || 'main')));
    const pending = visible.filter((L) => L.status === 'pending').sort((a, b) => (a.reportedAt || '').localeCompare(b.reportedAt || ''));
    let html = '<div class="row wrap between mb"><div class="row wrap">' + (lossCan() ? '<button class="btn pri" data-a="lossNew">' + ic('plus') + 'Record a loss</button>' : '') + '</div>' +
      (mgr || can('reports') ? '<div class="seg" role="group" aria-label="Period">' + [['month', 'This month'], ['3m', '3 months'], ['year', 'This year'], ['all', 'All']].map(([k, l]) => '<button class="' + ((K.ui.lossP || 'month') === k ? 'on' : '') + '" data-a="lossP" data-v="' + k + '">' + l + '</button>').join('') + '</div>' : '') + '</div>';
    if (pending.length) {
      html += '<section class="card pad mb loss-pend"><div class="row between mb"><h3>' + (mgr ? 'Waiting for your approval' : 'Your reports waiting for approval') + '</h3><span class="badge warn">' + pending.length + '</span></div>' +
        pending.map((L) => '<div class="loss-row" data-a="lossOpen" data-id="' + esc(L.id) + '" role="button" tabindex="0">' + lossThumb(L) + '<div class="grow" style="min-width:0"><div class="row wrap" style="gap:6px">' + causeChip(L.cause) + '<span class="tiny muted">' + esc(fmtDate(L.date)) + ' · ' + esc(locName(L.locationId)) + '</span></div><div class="t ellipsis">' + esc(lossItems(L)) + '</div><div class="tiny muted">By ' + esc(L.reportedBy || '—') + (seeCost() ? ' · ' + F(lossValue(L)) : '') + '</div></div>' + (mgr ? '<span class="btn sm pri">Review</span>' : '') + '</div>').join('') + '</section>';
    }
    if (mgr || can('reports')) html += lossInsights();
    const rows = visible.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.reportedAt || '').localeCompare(a.reportedAt || ''));
    html += '<h2 class="mb mt2">' + (mgr || can('reports') ? 'Loss reports' : 'Your loss reports') + '</h2>' + dataTable({
      id: 'lossList', rows, noun: 'loss', empty: '<div class="big">📦</div>No losses recorded. When something is stolen, damaged or eaten by rats, tap <b>Record a loss</b>.',
      rowAttr: (L) => ' data-a="lossOpen" data-id="' + esc(L.id) + '"',
      cols: [
        { k: 'date', label: 'Date', core: true, v: (L) => L.date, html: (L) => dtDate(L.date) },
        { k: 'no', label: 'Number', v: (L) => L.no || '', cls: 'mut' },
        { k: 'cause', label: 'Cause', core: true, v: (L) => KC.lossCause(L.cause).label, html: (L) => causeChip(L.cause) },
        { k: 'items', label: 'Items', core: true, wrap: true, v: lossItems },
        { k: 'units', label: 'Units', num: true, v: (L) => (L.lines || []).reduce((a, l) => a + num(l.qty), 0) },
        ...(seeCost() ? [{ k: 'value', label: 'Value at cost', money: true, v: (L) => Math.round(lossValue(L)), total: (r) => fmt(dtSum(r.filter((L) => L.status === 'approved'), lossValue)) }] : []),
        { k: 'loc', label: 'Branch', v: (L) => locName(L.locationId), cls: 'mut' },
        { k: 'by', label: 'Reported by', v: (L) => L.reportedBy || '' },
        { k: 'photo', label: 'Photo', v: (L) => (L.photos || []).length ? 'Yes' : '', cls: 'mut' },
        { k: 'st', label: 'Status', core: true, v: (L) => LOSS_ST[L.status][0], html: lossBadge },
      ],
    });
    return html;
  },
};
const lossThumb = (L) => (L.photos || []).length ? '<img class="loss-thumb" src="' + esc(imgSrc(L.photos[0])) + '" alt="" loading="lazy">' : '<span class="loss-thumb ph">' + ic('alert', 'sm') + '</span>';
A.lossP = (el) => { K.ui.lossP = el.dataset.v; render(true); };

/** what each cause costs, which items go missing, at which branch, and the trend */
function lossInsights() {
  const [from, to, label] = lossRange(K.ui.lossP || 'month'); const locs = can('allLocations') ? null : myLocs().map((l) => l.id);
  const inScope = (e) => (!locs || locs.includes(e.loc));
  const all = lossEvents().filter(inScope); const ev = all.filter((e) => e.date >= from && e.date <= to);
  const cost = seeCost(); const val = (list) => list.reduce((a, e) => a + (cost ? e.value : e.qty), 0); const show = (v) => cost ? F(v) : fmt(v) + ' unit' + (v === 1 ? '' : 's');
  const total = val(ev); const units = ev.reduce((a, e) => a + e.qty, 0);
  const prevR = lossPrev(from, to); const prev = prevR ? val(all.filter((e) => e.date >= prevR[0] && e.date <= prevR[1])) : null;
  const sales = periodStats((d) => d >= from && d <= to).revenue;
  const by = (key) => { const m = new Map(); ev.forEach((e) => m.set(key(e), (m.get(key(e)) || 0) + (cost ? e.value : e.qty))); return [...m].sort((a, b) => b[1] - a[1]); };
  const causes = by((e) => e.cause); const items = by((e) => e.productId).slice(0, 8); const branches = by((e) => e.loc);
  const pend = K.raw.losses.filter((L) => L.status === 'pending' && (!locs || locs.includes(L.locationId || 'main')));
  if (!all.length && !pend.length) return '';
  const bars = (list, name) => list.map(([k, v]) => '<div class="lb"><div class="row between small"><span class="ellipsis">' + name(k) + '</span><b class="money">' + show(v) + '</b></div><div class="bar"><i style="width:' + (total ? Math.max(2, v / list[0][1] * 100) : 0) + '%"></i></div></div>').join('');
  // insight: the biggest cause, and how the total moved against the previous period
  const top = causes[0]; let say = '';
  if (top) say = '<b>' + esc(KC.lossCause(top[0]).label) + '</b> cost you <b>' + show(top[1]) + '</b> ' + esc(label) + (total ? ' — ' + Math.round(top[1] / total * 100) + '% of all losses' : '') + '.';
  if (prev !== null && (prev || total)) { const d = total - prev; say += ' ' + (prev === 0 ? 'Nothing was lost in the period before.' : d === 0 ? 'The same as the period before.' : 'That is <b class="' + (d > 0 ? 'l-up' : 'l-down') + '">' + (d > 0 ? 'up ' : 'down ') + Math.round(Math.abs(d) / prev * 100) + '%</b> on the period before.'); }
  const pests = causes.find(([k]) => k === 'pests'); if (pests && pests[1] / (total || 1) >= 0.15) say += ' Check traps and close gaps in walls and doors.';
  const theft = causes.find(([k]) => k === 'theft' || k === 'count'); if (theft && theft[1] / (total || 1) >= 0.25) say += ' Count high-value items more often and check who held the stock.';
  // last 6 months
  const months = []; const now = new Date(todayStr()); for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1)); }
  const mv = months.map((m) => val(all.filter((e) => e.date.slice(0, 7) === m))); const mmax = Math.max(1, ...mv);
  return '<div class="kpis mb">' + kpi(cost ? 'Lost ' + esc(label) : 'Units lost', cost ? F(total) : fmt(units), cost ? fmt(units) + ' unit' + (units === 1 ? '' : 's') : '', true) +
      (cost && sales ? kpi('Of sales', pct(total / sales * 100), 'lost for every ' + F(1000) + ' sold: ' + F(Math.round(total / sales * 1000))) : '') +
      kpi('Biggest cause', top ? esc(KC.lossCause(top[0]).label) : '—', top ? show(top[1]) : '') +
      kpi('To approve', String(pend.length), pend.length ? (cost ? F(pend.reduce((a, L) => a + lossValue(L), 0)) + ' waiting' : 'reports waiting') : 'nothing waiting') + '</div>' +
    (say ? '<div class="alert info mb loss-say">' + ic('alert', 'sm') + '<div>' + say + '</div></div>' : '') +
    (ev.length ? '<div class="loss-grid mb"><section class="card pad"><h3 class="mb">By cause</h3>' + bars(causes, (k) => esc(KC.lossCause(k).label)) + '</section>' +
      '<section class="card pad"><h3 class="mb">Items lost most</h3>' + bars(items, (k) => esc((byId('products', k) || {}).name || '?')) + '</section>' +
      (branches.length > 1 ? '<section class="card pad"><h3 class="mb">By branch</h3>' + bars(branches, (k) => esc(locName(k))) + '</section>' : '') +
      '<section class="card pad"><h3 class="mb">Last 6 months</h3><div class="loss-trend">' + months.map((m, i) => '<div class="lt"><div class="lt-bar" title="' + esc(show(mv[i])) + '"><i style="height:' + Math.round(mv[i] / mmax * 100) + '%"></i></div><span>' + esc(MONTHS[Number(m.slice(5)) - 1]) + '</span></div>').join('') + '</div></section></div>'
      : '<div class="card pad mb muted small">No stock was lost ' + esc(label) + '.</div>');
}

/* ---------- record a loss ---------- */
A.lossNew = (el) => {
  if (!lossCan()) return toast('You do not have permission to record losses', true);
  const pid = el && el.dataset && el.dataset.id; const loc = K.loc;
  const L = { cause: '', lines: pid ? [{ productId: pid, qty: 1 }] : [], photos: [], date: todayStr(), notes: '', foundBy: K.me.name || '' };
  const sh = openSheet({ title: 'Record a loss · ' + locName(loc), body: '', foot: '<button class="btn" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="lossSave">' + (lossMgr() ? 'Record loss' : 'Send for approval') + '</button>' });
  sh.classList.add('loss-sheet'); sh._L = L; sh._q = '';
  const keep = () => { $$('[data-lq]', sh).forEach((i) => { const l = L.lines[Number(i.dataset.lq)]; if (l) l.qty = i.value === '' ? '' : Math.max(0, Math.floor(num(i.value))); }); const v = formVals(sh); if (v.lossDate !== undefined) L.date = v.lossDate; if (v.lossNotes !== undefined) L.notes = v.lossNotes; if (v.lossFound !== undefined) L.foundBy = v.lossFound; };
  sh._draw = () => {
    const c = L.cause ? KC.lossCause(L.cause) : null; const value = L.lines.reduce((a, l) => a + num(l.qty) * lossUnit(l.productId), 0);
    const matches = sh._q.trim().length < 1 ? [] : K.raw.products.filter((p) => !p.archived && !L.lines.some((l) => l.productId === p.id) && (p.name + ' ' + (p.barcode || '') + ' ' + (p.category || '')).toLowerCase().includes(sh._q.trim().toLowerCase()))
      .sort((a, b) => lossAvail(b.id, loc) - lossAvail(a.id, loc)).slice(0, 6);
    setSheetBody(sh,
      '<div class="pay-lbl">What happened?</div><div class="cause-grid" role="radiogroup" aria-label="Cause">' + KC.LOSS_CAUSES.filter((x) => x.pick).map((x) => '<button type="button" role="radio" aria-checked="' + (L.cause === x.k) + '" class="cause-btn c-' + x.k + (L.cause === x.k ? ' on' : '') + '" data-a="lossCause" data-v="' + x.k + '"><b>' + esc(x.label) + '</b><small>' + esc(x.hint) + '</small></button>').join('') + '</div>' +
      '<div class="pay-lbl mt2">Items lost</div>' +
      (L.lines.length ? '<div class="card list mb">' + L.lines.map((l, i) => { const p = byId('products', l.productId) || {}; const av = lossAvail(l.productId, loc); const over = num(l.qty) > av;
        return '<div class="li" style="cursor:default">' + thumb(p, 40, 10) + '<div class="grow" style="min-width:0"><div class="t ellipsis">' + esc(p.name || '?') + '</div><div class="tiny ' + (over ? '' : 'muted') + '"' + (over ? ' style="color:var(--bad)"' : '') + '>' + av + ' in stock here' + (KC.packsOf(p).length ? ' · 1 ' + esc(KC.packsOf(p)[0].name) + ' = ' + KC.packsOf(p)[0].size : '') + (seeCost() ? ' · ' + F(lossUnit(l.productId)) + ' each' : '') + '</div></div>' +
          '<input class="inp loss-qty" inputmode="numeric" data-lq="' + i + '" value="' + esc(l.qty) + '" aria-label="Quantity lost of ' + esc(p.name || '') + '"><button class="icon-btn" data-a="lossDrop" data-i="' + i + '" aria-label="Remove ' + esc(p.name || '') + '">' + ic('x') + '</button></div>'; }).join('') + '</div>' : '') +
      '<div class="search">' + ic('search') + '<input class="inp" id="lossQ" placeholder="Add an item — type its name or scan the barcode" value="' + esc(sh._q) + '" autocomplete="off"></div>' +
      (matches.length ? '<div class="card list loss-matches">' + matches.map((p) => '<div class="li" data-a="lossAdd" data-id="' + esc(p.id) + '">' + thumb(p, 32, 8) + '<div class="grow t ellipsis">' + esc(p.name) + '</div><span class="tiny muted">' + lossAvail(p.id, loc) + ' here</span></div>').join('') + '</div>' : sh._q.trim() ? '<div class="tiny muted mt">No item matches.</div>' : '') +
      '<div class="pay-lbl mt2">Photo' + (c && c.photo ? ' <span class="badge warn">required</span>' : ' <span class="tiny muted">(optional)</span>') + '</div>' +
      '<div class="loss-photos">' + L.photos.map((ph, i) => '<div class="loss-ph"><img src="' + esc(imgSrc(ph)) + '" alt="Photo ' + (i + 1) + '"><button class="icon-btn" data-a="lossPhotoDrop" data-i="' + i + '" aria-label="Remove photo ' + (i + 1) + '">' + ic('x', 'sm') + '</button></div>').join('') +
        (L.photos.length < 4 ? '<button type="button" class="loss-ph add" data-a="lossPhotoAdd">' + ic('plus') + '<span>Take or add a photo</span></button>' : '') + '</div>' +
      '<div class="grid2 mt2">' + field('Date', inp('lossDate', L.date, 'type="date" max="' + todayStr() + '"')) + field('Found by', inp('lossFound', L.foundBy, 'placeholder="Who noticed it"')) + '</div>' +
      field('Note' + (L.cause === 'other' ? '' : ' (optional)'), inp('lossNotes', L.notes, 'placeholder="' + (L.cause === 'pests' ? 'e.g. rats got into the rice sacks at the back' : L.cause === 'theft' ? 'e.g. shelf near the door, noticed at opening' : 'What happened') + '"')) +
      (seeCost() && value ? '<div class="loss-total"><span>Value at cost</span><b class="money">' + F(value) + '</b></div>' : '') +
      (!lossMgr() ? '<p class="hint" style="margin:6px 0 0">A manager checks it before the stock goes down.</p>' : ''));
    const q = $('#lossQ', sh);
    q.oninput = () => { keep(); clearTimeout(sh._t); sh._t = setTimeout(() => { sh._q = q.value; sh._draw(); const qq = $('#lossQ', sh); qq.focus(); qq.setSelectionRange(qq.value.length, qq.value.length); }, 200); };
    q.onkeydown = (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const code = q.value.trim(); const p = K.raw.products.find((x) => x.barcode && x.barcode === code); if (!p) return; keep(); const have = L.lines.find((l) => l.productId === p.id); if (have) have.qty = num(have.qty) + 1; else L.lines.push({ productId: p.id, qty: 1 }); sh._q = ''; sh._draw(); $('#lossQ', sh).focus(); };
    $$('[data-lq]', sh).forEach((i) => (i.oninput = () => { keep(); const t = $('.loss-total b', sh); if (t) t.textContent = F(L.lines.reduce((a, l) => a + num(l.qty) * lossUnit(l.productId), 0)); }));
  };
  sh._keep = keep; sh._draw();
  $('#lossSave', sh).onclick = async () => {
    keep();
    const doc = { id: uid('ls_'), date: L.date, locationId: loc, cause: L.cause, notes: String(L.notes || '').trim(), foundBy: String(L.foundBy || '').trim(), photos: L.photos.slice(),
      lines: L.lines.filter((l) => num(l.qty) > 0).map((l) => ({ productId: l.productId, name: (byId('products', l.productId) || {}).name || '', qty: num(l.qty), unitCost: lossUnit(l.productId) })),
      status: lossMgr() ? 'approved' : 'pending', reportedById: K.me.id || '', reportedBy: K.me.name || '', reportedAt: new Date().toISOString() };
    doc.no = KC.newTxnId('LS', doc.date);
    const bad = KC.lossCheck(doc); if (bad) return toast(bad, true);
    const short = doc.lines.find((l) => l.qty > lossAvail(l.productId, loc)); if (short) return toast('Only ' + lossAvail(short.productId, loc) + ' × ' + short.name + ' in stock at ' + locName(loc), true);
    if (doc.status === 'approved') { Object.assign(doc, { decidedById: K.me.id || '', decidedBy: K.me.name || '', decidedAt: new Date().toISOString() }); if (!(await lossApply(doc))) return; }
    if (!(await save('losses', doc))) return;
    closeSheet(); render(true);
    toast(doc.status === 'approved' ? 'Loss recorded — stock updated' : 'Loss sent to a manager for approval');
  };
};
const lossSheet = (el) => el.closest('.scrim');
A.lossCause = (el) => { const sh = lossSheet(el); sh._keep(); sh._L.cause = el.dataset.v; sh._draw(); };
A.lossAdd = (el) => { const sh = lossSheet(el); sh._keep(); sh._L.lines.push({ productId: el.dataset.id, qty: 1 }); sh._q = ''; sh._draw(); const q = $$('[data-lq]', sh).pop(); if (q) { q.focus(); q.select(); } };
A.lossDrop = (el) => { const sh = lossSheet(el); sh._keep(); sh._L.lines.splice(Number(el.dataset.i), 1); sh._draw(); };
A.lossPhotoDrop = (el) => { const sh = lossSheet(el); sh._keep(); sh._L.photos.splice(Number(el.dataset.i), 1); sh._draw(); };
A.lossPhotoAdd = async (el) => {
  const sh = lossSheet(el); const f = await chooseFile('image/*', 'environment'); if (!f) return;
  try { const ref = await storeEvidence(f); sh._keep(); sh._L.photos.push(ref); sh._draw(); } catch (e) { toast(e.message || 'Could not add the photo', true); }
};
/** a photo that proves a loss: uploaded when possible (does not need the Photos feature), else kept small inside the record */
async function storeEvidence(file) {
  const big = await resizeImage(file, 1280, 0.8);
  if (K.store.uploadImage) { try { const id = await K.store.uploadImage(big.blob, 'evidence'); if (id) return id; } catch (e) { console.warn('evidence upload failed, keeping it inline', e); } }
  return (await resizeImage(file, 480, 0.7)).dataUrl;
}

/** take the loss out of stock: from the newest batches at the branch. Ids are fixed per loss, so trying again never doubles it. */
async function lossApply(L) {
  for (const [i, l] of (L.lines || []).entries()) {
    let left = num(l.qty); let j = 0;
    for (const lt of lossLots(l.productId, L.locationId)) {
      if (left <= 0) break; const av = Math.max(0, (K.C.lotX[lt.id].byLoc || {})[L.locationId] || 0); const take = Math.min(av, left); if (take <= 0) continue;
      const ok = await save('adjustments', { id: 'a_ls_' + L.id + '_' + i + '_' + j++, date: L.date, productId: l.productId, lotId: lt.id, qty: -take, locationId: L.locationId, reason: KC.lossCause(L.cause).label, cause: L.cause, lossId: L.id, notes: [L.no, L.notes].filter(Boolean).join(' — '), byId: K.me.id || '', by: K.me.name || '' });
      if (!ok) return false; left -= take;
    }
    if (left > 0) { toast('Only ' + (num(l.qty) - left) + ' × ' + ((byId('products', l.productId) || {}).name || '') + ' were in stock — the rest was not removed', true); }
  }
  return true;
}

/* ---------- one loss: details, approve, reject, withdraw ---------- */
A.lossOpen = (el) => {
  const id = el.dataset.id; const sh = openSheet({ title: 'Loss', body: '', foot: '' });
  sh.classList.add('loss-sheet');
  sh._refresh = () => {
    const L = byId('losses', id); if (!L) return closeSheet();
    $('.sh h2', sh).textContent = 'Loss ' + (L.no || '');
    const mgr = lossMgr(), pend = L.status === 'pending', mine = L.reportedById === K.me.id;
    const short = pend ? (L.lines || []).filter((l) => num(l.qty) > lossAvail(l.productId, L.locationId || 'main')) : [];
    setSheetBody(sh, '<div class="row between wrap mb">' + causeChip(L.cause) + lossBadge(L) + '</div>' +
      '<div class="bill-rows small mb">' + [['Date', fmtDate(L.date)], ['Branch', locName(L.locationId)], ['Found by', L.foundBy || '—'], ['Reported by', (L.reportedBy || '—') + ' · ' + fmtDT(L.reportedAt)],
        L.decidedAt ? [L.status === 'approved' ? 'Approved by' : 'Rejected by', (L.decidedBy || '—') + ' · ' + fmtDT(L.decidedAt)] : null].filter(Boolean).map(([k, v]) => '<div class="row between cl"><span class="muted">' + k + '</span><b>' + esc(v) + '</b></div>').join('') + '</div>' +
      (L.notes ? '<div class="loss-note">' + esc(L.notes) + '</div>' : '') +
      (L.status === 'rejected' && L.decisionNote ? '<div class="alert bad mb">Rejected: ' + esc(L.decisionNote) + '</div>' : '') +
      '<div class="card tw mb"><table class="t"><thead><tr><th>Item</th><th class="r">Qty</th>' + (seeCost() ? '<th class="r">Value</th>' : '') + '</tr></thead><tbody>' +
        (L.lines || []).map((l) => '<tr><td>' + esc((byId('products', l.productId) || {}).name || l.name || '?') + '</td><td class="r">' + num(l.qty) + '</td>' + (seeCost() ? '<td class="r money">' + fmt(num(l.qty) * (num(l.unitCost) || lossUnit(l.productId))) + '</td>' : '') + '</tr>').join('') +
        (seeCost() ? '<tr class="b"><td>Total</td><td></td><td class="r money">' + fmt(lossValue(L)) + '</td></tr>' : '') + '</tbody></table></div>' +
      ((L.photos || []).length ? '<div class="loss-photos view">' + L.photos.map((ph, i) => '<a class="loss-ph" href="' + esc(imgSrc(ph)) + '" target="_blank" rel="noopener"><img src="' + esc(imgSrc(ph)) + '" alt="Photo ' + (i + 1) + ' of the loss"></a>').join('') + '</div>' : '<div class="tiny muted mb">No photo.</div>') +
      (short.length && mgr ? '<div class="alert bad mt">Not enough in stock now: ' + short.map((l) => esc((byId('products', l.productId) || {}).name || '') + ' (' + lossAvail(l.productId, L.locationId || 'main') + ' left)').join(', ') + '. Only what is there will be removed.</div>' : '') +
      (pend && !mgr ? '<p class="hint mt">A manager will check it. Stock and profit change only once it is approved.</p>' : ''));
    $('.sf', sh).innerHTML = pend && mgr ? '<button class="btn danger" data-a="lossReject" data-id="' + esc(id) + '">Reject</button><button class="btn pri grow" data-a="lossApprove" data-id="' + esc(id) + '">' + ic('check', 'sm') + 'Approve — remove from stock</button>'
      : pend && mine ? '<button class="btn" data-a="lossWithdraw" data-id="' + esc(id) + '">Withdraw</button><button class="btn pri grow" data-a="sheetClose">Close</button>'
      : '<button class="btn pri grow" data-a="sheetClose">Close</button>';
  };
  sh.querySelector('.sheet').insertAdjacentHTML('beforeend', '<div class="sf"></div>'); sh._refresh();
};
A.lossApprove = async (el) => {
  const L = byId('losses', el.dataset.id); if (!L || L.status !== 'pending') return;
  const done = Object.assign({}, L, { lines: (L.lines || []).map((l) => Object.assign({}, l, { unitCost: num(l.unitCost) || lossUnit(l.productId) })), status: 'approved', decidedById: K.me.id || '', decidedBy: K.me.name || '', decidedAt: new Date().toISOString() });
  if (!(await lossApply(done))) return;
  if (await save('losses', done)) { toast('Loss approved — stock updated'); render(true); refreshSheets(); }
};
A.lossReject = async (el) => {
  const L = byId('losses', el.dataset.id); if (!L || L.status !== 'pending') return;
  const why = await new Promise((res) => {
    const s = openSheet({ title: 'Reject this loss', body: field('Why? The person who reported it sees this', '<textarea class="inp" name="why" rows="3" placeholder="e.g. the items were found in the back store"></textarea>'), foot: '<button class="btn grow" data-a="sheetClose">Back</button><button class="btn danger grow" id="lrOk">Reject</button>', onClose: () => res(null) });
    $('#lrOk', s).onclick = () => { const v = $('[name=why]', s).value.trim(); if (v.length < 3) return toast('Say why it is rejected', true); s._onClose = null; closeSheet(); res(v); };
    setTimeout(() => $('[name=why]', s).focus(), 50);
  });
  if (!why) return;
  if (await save('losses', Object.assign({}, L, { status: 'rejected', decisionNote: why, decidedById: K.me.id || '', decidedBy: K.me.name || '', decidedAt: new Date().toISOString() }))) { toast('Loss rejected — stock unchanged'); render(true); refreshSheets(); }
};
A.lossWithdraw = async (el) => {
  const L = byId('losses', el.dataset.id); if (!L || L.status !== 'pending') return;
  if (!(await confirmBox('Withdraw this loss report?', 'Withdraw'))) return;
  if (await save('losses', Object.assign({}, L, { status: 'withdrawn' }))) { toast('Loss report withdrawn'); render(true); refreshSheets(); }
};
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('.loss-row')) e.target.click(); });
