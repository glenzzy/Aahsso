/* ================= STOCK COUNT (INVENTORY AUDIT) =================
 * Count what is really on the shelves and compare it with what the app expects.
 *  - Regular counts on a schedule per branch (weekly, monthly…) with "due" and "overdue" on Home, or a spot check any time.
 *  - Handover count: when the person who holds the stock leaves or changes (e.g. an employee quits), the outgoing and
 *    incoming person count together. The incoming person accepts the stock on their own phone; the outgoing person, if
 *    there, agrees or disputes. From then on the incoming person holds the stock at that branch.
 *  - Shortages since the last count are put against whoever held the stock; a manager can deduct them from that
 *    person's next payslip (Payroll picks it up).
 *  - Several people can count at once: each number is merged on the server, nothing is overwritten.
 *  - Blind count: counters don't see what the app expects. A manager approves the differences, which then correct stock. */
const AU_KIND = { routine: 'Regular count', spot: 'Spot check', handover: 'Handover' };
const AU_ST = { draft: ['Counting', 'info'], submitted: ['To approve', 'warn'], applied: ['Approved', 'ok'], cancelled: ['Cancelled', ''] };
const auKind = (a) => a.kind || 'routine';
const auBadge = (a) => '<span class="badge ' + AU_ST[a.status || 'draft'][1] + '">' + AU_ST[a.status || 'draft'][0] + '</span>';
const auWhole = (a) => !a.category;
const auDone = (a) => a.status === 'submitted' || a.status === 'applied';
const auAt = (a) => a.appliedAt || a.submittedAt || a.startedAt || '';
const sysAt = (pid, loc) => { const x = K.C.prodX[pid]; return x ? Math.max(0, x.byLoc[loc] || 0) : 0; };
const EVERY = [[0, 'Not scheduled'], [7, 'Every week'], [14, 'Every 2 weeks'], [30, 'Every month'], [90, 'Every 3 months']];

/** who holds the stock at a branch: the person who took it over in the last approved handover */
function auKeeper(loc) {
  const h = K.raw.audits.filter((a) => a.status === 'applied' && a.handover && a.handover.toId && (a.locationId || 'main') === loc).sort((a, b) => auAt(b).localeCompare(auAt(a)))[0];
  return h ? { id: h.handover.toId, name: h.handover.toName, since: auAt(h) } : null;
}
/** the last finished whole-branch count (optionally before a given one) */
function auLast(loc, beforeId) {
  const me = beforeId && byId('audits', beforeId); const lim = me ? (me.startedAt || '') : '9999';
  return K.raw.audits.filter((a) => a.id !== beforeId && auDone(a) && auWhole(a) && (a.locationId || 'main') === loc && auAt(a) < lim).sort((a, b) => auAt(b).localeCompare(auAt(a)))[0] || null;
}
const auEvery = (loc) => num((S().countEvery || {})[loc]);
/** {every, last, due, days} — days < 0: overdue */
function auDue(loc) {
  const every = auEvery(loc); const last = auLast(loc); if (!every) return { every, last };
  const due = last ? KC.addDays(auAt(last).slice(0, 10), every) : todayStr();
  return { every, last, due, days: KC.daysBetween(todayStr(), due) };
}
const ago = (iso) => { const d = KC.daysBetween(String(iso).slice(0, 10), todayStr()); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; };
function auSummary(a) {
  const lines = a.lines || Object.entries(a.counts || {}).map(([pid, c]) => ({ productId: pid, counted: c, system: null }));
  let diffQty = 0, diffValue = 0, short = 0, over = 0, shortQty = 0;
  lines.forEach((l) => { if (l.system === null || l.system === undefined) return; const d = num(l.counted) - num(l.system); diffQty += d; const v = d * num(l.unitCost); diffValue += v; if (d < 0) { short += -v; shortQty += -d; } else over += v; });
  return { counted: lines.length, diffQty, diffValue, short, over, shortQty, lines };
}
const auditSummary = auSummary; // older name, still used by reports

VIEWS.audit = {
  render() {
    const loc = K.loc; const list = K.raw.audits.slice().sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    const open = list.find((a) => a.status === 'draft' && (a.locationId || 'main') === loc);
    const kp = auKeeper(loc); const due = auDue(loc);
    const dueTxt = !due.every ? '' : due.days < 0 ? '<b class="neg-t">Overdue by ' + -due.days + ' day' + (due.days === -1 ? '' : 's') + '</b>' : due.days === 0 ? '<b class="neg-t">Due today</b>' : 'Next count ' + esc(fmtDate(due.due)) + ' (in ' + due.days + ' day' + (due.days === 1 ? '' : 's') + ')';
    let html = '<section class="card pad mb au-branch"><div class="row between wrap"><div><div class="hint">Stock at</div><h2>' + esc(locName(loc)) + '</h2></div>' +
      '<div class="row wrap">' + (open ? '<button class="btn pri" data-a="auditGo" data-id="' + open.id + '">' + ic('check') + 'Continue counting (' + Object.keys(open.counts || {}).length + ')</button>'
        : '<button class="btn" data-a="auditNew" data-k="handover">' + ic('users', 'sm') + 'Handover count</button><button class="btn pri" data-a="auditNew">' + ic('plus') + 'Start a count</button>') + '</div></div>' +
      '<div class="au-facts">' +
        '<div><span>Held by</span><b>' + (kp ? esc(kp.name) + '</b><small>since ' + esc(fmtDate(kp.since.slice(0, 10))) + '</small>' : '—</b><small>set with a handover count</small>') + '</div>' +
        '<div><span>Last count</span><b>' + (due.last ? esc(fmtDate(auAt(due.last).slice(0, 10))) + '</b><small>' + esc(ago(auAt(due.last))) + ' · ' + esc(AU_KIND[auKind(due.last)]) + '</small>' : 'Never</b><small>count once to start</small>') + '</div>' +
        '<div><span>Schedule</span>' + (can('settings') ? '<select class="inp au-every" data-c="auEvery" aria-label="How often to count ' + esc(locName(loc)) + '">' + EVERY.map(([d, l]) => '<option value="' + d + '"' + (d === due.every ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' : '<b>' + esc((EVERY.find((e) => e[0] === due.every) || [0, 'Every ' + due.every + ' days'])[1]) + '</b>') + '<small>' + (dueTxt || 'counts are not reminded') + '</small></div>' +
      '</div></section>';
    if (can('allLocations') && allLocs().length > 1) {
      html += '<div class="au-others mb">' + allLocs().filter((l) => l.id !== loc).map((l) => { const d = auDue(l.id); const k = auKeeper(l.id); return '<div class="au-other"><b>' + esc(l.name) + '</b><span class="tiny muted">' + (k ? esc(k.name) + ' · ' : '') + (d.last ? 'counted ' + esc(ago(auAt(d.last))) : 'never counted') + '</span>' + (d.every && d.days <= 0 ? '<span class="badge bad">' + (d.days < 0 ? 'Overdue' : 'Due') + '</span>' : '') + '</div>'; }).join('') + '</div>';
    }
    const waiting = list.filter((a) => a.status === 'submitted' && (can('stockEdit') || auSigner(a)));
    if (waiting.length) html += '<section class="card pad mb loss-pend"><h3 class="mb">Waiting</h3>' + waiting.map((a) => '<div class="loss-row" data-a="auditGo" data-id="' + a.id + '" role="button" tabindex="0"><span class="loss-thumb ph">' + ic(a.handover ? 'users' : 'check', 'sm') + '</span><div class="grow" style="min-width:0"><div class="t">' + esc(AU_KIND[auKind(a)]) + ' · ' + esc(locName(a.locationId)) + '</div><div class="tiny muted">' + esc(auWaitText(a)) + '</div></div><span class="btn sm pri">Open</span></div>').join('') + '</section>';
    return html + '<h2 class="mb">Counts</h2>' + auditTable(list);
  },
};
CH.auEvery = async (el) => { const cur = Object.assign({}, S().countEvery || {}); const v = num(el.value); if (v) cur[K.loc] = v; else delete cur[K.loc]; if (await saveSettings({ countEvery: cur })) { toast(v ? 'Count reminder set' : 'Count reminder off'); render(true); } };
const auSigner = (a) => a.handover && ((a.handover.toId === K.me.id && !a.handover.toAcceptedAt) || (a.handover.fromId === K.me.id && !a.handover.fromAgreedAt && !a.handover.fromDisputedAt));
function auWaitText(a) {
  const h = a.handover; const parts = [];
  if (h && !h.toAcceptedAt) parts.push(h.toId === K.me.id ? 'You need to accept the stock' : (h.toName || 'The new holder') + ' has not accepted yet');
  if (h && h.fromId && h.fromPresent !== false && !h.fromAgreedAt && !h.fromDisputedAt) parts.push(h.fromId === K.me.id ? 'Agree or dispute the count' : (h.fromName || 'The outgoing person') + ' has not agreed yet');
  if (h && h.fromDisputedAt) parts.push((h.fromName || 'The outgoing person') + ' disputes it');
  if (can('stockEdit')) parts.push('a manager approves');
  return parts.join(' · ');
}
function auditTable(list) {
  const cost = seeCost(); const S_ = (a) => auSummary(a);
  return dataTable({
    id: 'auditList', rows: list, noun: 'count', empty: 'No counts yet. Count once to know where you start.',
    rowAttr: (a) => ' data-a="auditGo" data-id="' + a.id + '"',
    cols: [
      { k: 'at', label: 'Started', core: true, v: (a) => a.startedAt || '', html: (a) => esc(fmtDT(a.startedAt)) },
      { k: 'kind', label: 'Kind', core: true, v: (a) => AU_KIND[auKind(a)], html: (a) => esc(AU_KIND[auKind(a)]) + (a.handover ? '<div class="tiny muted">' + esc((a.handover.fromName || '—') + ' → ' + (a.handover.toName || '')) + '</div>' : '') },
      { k: 'loc', label: 'Branch', v: (a) => locName(a.locationId) },
      { k: 'cat', label: 'What', v: (a) => a.category || 'Everything', cls: 'mut' },
      { k: 'n', label: 'Items', num: true, v: (a) => S_(a).counted },
      { k: 'dq', label: 'Difference', core: true, num: true, v: (a) => S_(a).diffQty || '', html: (a) => S_(a).diffQty ? '<span class="b" style="color:' + (S_(a).diffQty < 0 ? 'var(--bad)' : 'var(--ok)') + '">' + (S_(a).diffQty > 0 ? '+' : '') + S_(a).diffQty + '</span>' : dtNil },
      cost ? { k: 'short', label: 'Missing (value)', money: true, v: (a) => Math.round(S_(a).short) || '' } : null,
      { k: 'charge', label: 'Charged to', v: (a) => a.charge && a.charge.deduct ? a.charge.name + ' ' + fmt(a.charge.amount) : '', cls: 'mut' },
      { k: 'status', label: 'Status', core: true, v: (a) => (AU_ST[a.status || 'draft'] || [''])[0], html: auBadge },
      { k: 'by', label: 'Counted by', v: (a) => (a.counters && a.counters.length ? a.counters.join(', ') : a.by) || '', cls: 'mut' },
    ].filter(Boolean),
  });
}

/* ---------- start a count ---------- */
A.auditNew = async (el) => {
  if (K.info.mode === 'saas') { try { await loadPeople(); } catch (e) { } } // the people to hand over between
  const loc = K.loc; const cats = Array.from(new Set(K.raw.products.map((p) => p.category).filter(Boolean))).sort();
  const ppl = teamPeople(); const kp = auKeeper(loc);
  const sh = openSheet({ title: 'New stock count · ' + locName(loc), body: '', foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="auGo">Start counting</button>' });
  sh._k = (el && el.dataset && el.dataset.k) || 'routine';
  const draw = () => {
    const v = formVals(sh); const k = sh._k;
    setSheetBody(sh, '<div class="pay-lbl">Kind of count</div><div class="cause-grid au-kinds" role="radiogroup">' + [['routine', 'Regular count', 'The usual count on your schedule'], ['spot', 'Spot check', 'A surprise count, any time'], ['handover', 'Handover', 'Someone leaves or changes: hand the stock to the next person']].map(([kk, l, h]) => '<button type="button" role="radio" aria-checked="' + (k === kk) + '" class="cause-btn' + (k === kk ? ' on' : '') + '" data-a="auKind" data-v="' + kk + '"><b>' + l + '</b><small>' + h + '</small></button>').join('') + '</div>' +
      (k === 'handover' ? '<div class="grid2 mt2">' + field('Handing over (outgoing)', sel('auFrom', [['', 'Nobody / not known']].concat(ppl.map((p) => [p.id, p.name])), v.auFrom !== undefined ? v.auFrom : kp ? kp.id : '')) + field('Taking over (incoming)', sel('auTo', [['', 'Choose…']].concat(ppl.map((p) => [p.id, p.name])), v.auTo || '')) + '</div>' +
        '<label class="toggle"><input type="checkbox" name="auPresent"' + (v.auPresent === false ? '' : ' checked') + '>The outgoing person is here for the count</label>' +
        '<p class="hint" style="margin:6px 0 0">Count everything together. The incoming person then accepts the stock on their phone; shortages until today are put against the outgoing person.</p>' : '') +
      '<div class="col mt2">' + field('What to count', sel('category', [['', 'Everything at this branch']].concat(cats.map((c) => [c, c])), v.category || '')) +
      '<label class="toggle"><input type="checkbox" name="blind"' + (v.blind === false ? '' : ' checked') + '>Blind count — hide the expected quantity while counting (recommended)</label></div>');
  };
  sh._draw = draw; draw();
  $('#auGo', sh).onclick = async () => {
    const v = formVals(sh); const k = sh._k;
    if (k === 'handover') {
      if (!v.auTo) return toast('Choose who takes over the stock', true);
      if (v.auTo === v.auFrom) return toast('The incoming and outgoing person must be different', true);
      if (v.category) return toast('A handover counts everything at the branch', true);
    }
    const name = (id) => (ppl.find((p) => p.id === id) || {}).name || '';
    const prev = auLast(loc);
    const a = { id: uid('au_'), kind: k, locationId: loc, category: v.category, blind: v.blind, status: 'draft', counts: {}, counters: [K.me.name || ''], startedAt: new Date().toISOString(), by: K.me.name || '', byId: K.me.id || '',
      prevId: prev ? prev.id : '', prevAt: prev ? auAt(prev) : '' };
    if (k === 'handover') a.handover = { fromId: v.auFrom || '', fromName: name(v.auFrom), fromPresent: !!v.auFrom && !!v.auPresent, toId: v.auTo, toName: name(v.auTo) };
    else { const kp2 = auKeeper(loc); if (kp2) Object.assign(a, { keeperId: kp2.id, keeperName: kp2.name }); }
    if (await save('audits', a)) { closeSheet(); openAudit(a.id); render(true); }
  };
};
A.auKind = (el) => { const sh = el.closest('.scrim'); sh._k = el.dataset.v; sh._draw(); };
A.auditGo = (el) => openAudit(el.dataset.id);

/* ---------- counting ---------- */
async function auCount(id, pid, n) {
  const cur = JSON.parse(JSON.stringify(byId('audits', id))); if (cur.status !== 'draft') return;
  if (n === null) delete cur.counts[pid]; else cur.counts[pid] = n;
  if (K.info.mode === 'saas') cur.countsPatch = { [pid]: n }; // merged on the server: two counters never overwrite each other
  return save('audits', cur);
}
function openAudit(id) {
  const sh = openSheet({ title: 'Stock count', wide: true, body: '' });
  if (K.info.mode === 'saas' && !K._people) Promise.resolve(loadPeople()).then(() => sh._refresh && K.sheets.includes(sh) && sh._refresh()).catch(() => { });
  sh.querySelector('.sheet').insertAdjacentHTML('beforeend', '<div class="sf"></div>');
  sh._q = '';
  sh._refresh = () => {
    const a = byId('audits', id); if (!a) return closeSheet();
    $('.sh h2', sh).textContent = AU_KIND[auKind(a)] + ' · ' + locName(a.locationId);
    if (a.status !== 'draft') return drawAuditResult(sh, a);
    const loc = a.locationId || 'main'; const seeExp = !a.blind || can('stockEdit');
    const prods = K.raw.products.filter((p) => !p.archived && (!a.category || p.category === a.category) && (sysAt(p.id, loc) > 0 || (a.counts || {})[p.id] !== undefined)).sort((x, y) => x.name.localeCompare(y.name));
    const shown = prods.filter((p) => !sh._q || (p.name + ' ' + (p.barcode || '')).toLowerCase().includes(sh._q.toLowerCase()));
    const done = Object.keys(a.counts || {}).length; const h = a.handover;
    setSheetBody(sh, (h ? '<div class="alert info mb">' + ic('users', 'sm') + '<div><b>' + esc(h.fromName || 'Nobody') + '</b> hands the stock to <b>' + esc(h.toName) + '</b>. Count everything together.</div></div>' : '') +
      '<div class="row between mb"><span class="small"><b>' + done + '</b> of ' + prods.length + ' counted' + (a.blind ? ' · blind count' : '') + ((a.counters || []).length > 1 ? ' · ' + esc(a.counters.join(', ')) : '') + '</span><div class="bar grow" style="max-width:200px"><i style="width:' + (prods.length ? done / prods.length * 100 : 0) + '%"></i></div></div>' +
      '<div class="search mb">' + ic('search') + '<input class="inp" id="auQ" placeholder="Search or scan a barcode (each scan adds 1)" value="' + esc(sh._q) + '"></div>' +
      '<div class="card list">' + shown.map((p) => { const c = (a.counts || {})[p.id]; const sys = sysAt(p.id, loc); return '<div class="li" style="cursor:default">' + thumb(p, 40, 10) + '<div class="grow" style="min-width:0"><div class="t ellipsis">' + esc(p.name) + '</div><div class="tiny muted">' + (seeExp ? 'Expected ' + sys + (KC.packText(p, sys) ? ' (' + esc(KC.packText(p, sys)) + ')' : '') : 'Count it' + (KC.packsOf(p).length ? ' in ' + esc(p.unit && p.unit !== 'unit' ? p.unit : 'piece') + 's — 1 ' + esc(KC.packsOf(p)[0].name) + ' = ' + KC.packsOf(p)[0].size : '')) + (c !== undefined && seeExp && num(c) !== sys ? ' · <b style="color:' + (num(c) < sys ? 'var(--bad)' : 'var(--warn)') + '">' + (num(c) - sys > 0 ? '+' : '') + (num(c) - sys) + '</b>' : '') + '</div></div><input class="inp au-in" style="' + (c !== undefined ? 'border-color:var(--ok)' : '') + '" inputmode="numeric" data-cnt="' + p.id + '" value="' + (c ?? '') + '" placeholder="—" aria-label="Counted ' + esc(p.name) + '"></div>'; }).join('') + (shown.length ? '' : '<div class="empty small">No item matches.</div>') + '</div>' +
      '<div class="tiny muted mt">Items left empty are not counted. Every number is saved as you type — you can stop and continue later, and colleagues can count at the same time.</div>');
    $('.sf', sh).innerHTML = (can('stockEdit') ? '<button class="btn danger" data-a="auditCancel" data-id="' + id + '">Discard</button>' : '') + '<button class="btn grow" data-a="sheetClose">Save & close</button><button class="btn pri grow" data-a="auditFinish" data-id="' + id + '">' + ic('check') + 'Finish count</button>';
    const q = $('#auQ', sh); q.oninput = () => { clearTimeout(sh._t); sh._t = setTimeout(() => { sh._q = q.value; sh._refresh(); const qq = $('#auQ', sh); qq.focus(); qq.setSelectionRange(qq.value.length, qq.value.length); }, 300); };
    q.onkeydown = async (e) => { if (e.key !== 'Enter') return; const p = K.raw.products.find((x) => x.barcode && x.barcode === q.value.trim()); if (!p) return; const n = num((byId('audits', id).counts || {})[p.id]) + 1; await auCount(id, p.id, n); sh._q = ''; sh._refresh(); $('#auQ', sh).focus(); toast(p.name + ': ' + n); };
    $$('[data-cnt]', sh).forEach((i) => (i.onchange = async () => { const v = i.value === '' ? null : Math.max(0, Math.floor(num(i.value))); await auCount(id, i.dataset.cnt, v); i.style.borderColor = v === null ? '' : 'var(--ok)'; }));
  };
  sh._refresh();
}
A.auditFinish = async (el) => {
  const a = byId('audits', el.dataset.id); if (!a || a.status !== 'draft') return;
  const n = Object.keys(a.counts || {}).length; if (!n) return toast('Count at least one item', true);
  const loc = a.locationId || 'main';
  const missed = auWhole(a) ? K.raw.products.filter((p) => !p.archived && sysAt(p.id, loc) > 0 && (a.counts || {})[p.id] === undefined).length : 0;
  if (!(await confirmBox('Finish the count of ' + n + ' item' + (n === 1 ? '' : 's') + '?' + (missed ? ' ' + missed + ' item' + (missed === 1 ? ' was' : 's were') + ' not counted and will not be checked.' : '') + ' Expected quantities are frozen now.', 'Finish'))) return;
  const lines = Object.entries(a.counts).map(([pid, c]) => ({ productId: pid, name: (byId('products', pid) || {}).name, counted: num(c), system: sysAt(pid, loc), unitCost: Math.round((K.C.prodX[pid] || {}).avgCost || 0) }));
  const prev = auLast(loc, a.id);
  if (await save('audits', Object.assign({}, a, { status: 'submitted', lines, missed, submittedAt: new Date().toISOString(), submittedBy: K.me.name || '', prevId: prev ? prev.id : '', prevAt: prev ? auAt(prev) : '' }))) { refreshSheets(); render(true); }
};
A.auditCancel = async (el) => {
  const a = byId('audits', el.dataset.id); if (!a) return;
  if (!(await confirmBox('Discard this count? Nothing changes in stock.', 'Discard', true))) return;
  if (await save('audits', Object.assign({}, a, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: K.me.name || '' }))) { closeSheet(); render(true); toast('Count discarded'); }
};

/** what happened at the branch between the last count and this one (so the unexplained gap stands out) */
function auSince(a) {
  const loc = a.locationId || 'main'; const prev = a.prevId ? byId('audits', a.prevId) : null;
  const from = a.prevAt || (prev && auAt(prev)) || ''; const to = a.submittedAt || a.startedAt || new Date().toISOString();
  const inR = (t) => !!t && (!from || t > from) && t <= to; // exact times, so a count earlier the same day still compares
  const when = (o, ...k) => { for (const x of k) if (o[x]) return String(o[x]); return ''; };
  const counted = new Set((a.lines || []).map((l) => l.productId));
  let sold = 0; K.raw.sales.forEach((s) => { if ((s.locationId || 'main') !== loc || !inR(when(s, 'createdAt', 'date')) || (K.C.saleX[s.id] || {}).status === 'cancelled') return; (s.lines || []).forEach((l) => { if (counted.has(l.productId)) sold += (l.alloc || []).reduce((t, x) => t + num(x.qty), 0); }); });
  let lost = 0, lostV = 0; K.raw.adjustments.forEach((j) => { if (num(j.qty) >= 0 || (j.locationId || 'main') !== loc || !inR(when(j, 'createdAt', 'date')) || !counted.has(j.productId) || j.auditId || String(j.notes || '').startsWith('Stock count')) return; lost += -num(j.qty); lostV += -num(j.qty) * ((K.C.lotX[j.lotId] || {}).landedUnit || 0); });
  let tin = 0, tout = 0; K.raw.transfers.forEach((t) => { (t.lines || []).forEach((l) => { if (!counted.has(l.productId)) return; if (t.to === loc && t.status === 'received' && inR(when(t, 'receivedAt', 'updatedAt'))) tin += num(l.receivedQty ?? l.qty); if (t.from === loc && inR(when(t, 'createdAt', 'date'))) tout += num(l.qty); }); });
  const days = from ? KC.daysBetween(from.slice(0, 10), to.slice(0, 10)) : null;
  return { from: from.slice(0, 10), prev, days, sold, lost, lostV, tin, tout };
}

/* ---------- result: signatures, differences, approval ---------- */
function drawAuditResult(sh, a) {
  const s = auSummary(a); const diffs = s.lines.filter((l) => num(l.counted) !== num(l.system)); const h = a.handover; const cost = seeCost();
  const mgr = can('stockEdit') && a.status === 'submitted'; const since = auSince(a); const loc = a.locationId || 'main';
  const holder = h ? { id: h.fromId, name: h.fromName } : a.keeperId ? { id: a.keeperId, name: a.keeperName } : null;
  const sign = (label, at, extra) => '<div class="au-sign ' + (at ? 'ok' : '') + '"><span class="au-dot">' + (at ? ic('check', 'sm') : '') + '</span><div class="grow"><b>' + label + '</b><div class="tiny muted">' + (at ? 'Signed ' + esc(fmtDT(at)) : 'Waiting') + (extra || '') + '</div></div></div>';
  const me = K.me.id; let signBtns = '';
  if (h && a.status === 'submitted') {
    if (h.toId === me && !h.toAcceptedAt) signBtns += '<button class="btn pri" data-a="auditSign" data-id="' + a.id + '" data-v="accept">' + ic('check', 'sm') + 'I accept this stock</button>';
    if (h.fromId === me && !h.fromAgreedAt && !h.fromDisputedAt) signBtns += '<button class="btn" data-a="auditSign" data-id="' + a.id + '" data-v="dispute">Dispute</button><button class="btn pri" data-a="auditSign" data-id="' + a.id + '" data-v="agree">' + ic('check', 'sm') + 'I agree with the count</button>';
  }
  const people = teamPeople();
  setSheetBody(sh, '<div class="kpis mb">' + kpi('Items counted', fmt(s.counted), diffs.length + ' with a difference' + (a.missed ? ' · ' + a.missed + ' not counted' : ''), true) + kpi('Units', (s.diffQty > 0 ? '+' : '') + fmt(s.diffQty), 'counted minus expected') + (cost ? kpi('Missing (value)', F(s.short), s.shortQty + ' unit' + (s.shortQty === 1 ? '' : 's') + ' at cost') + kpi('Extra found', F(s.over)) : '') + '</div>' +
    (a.status === 'applied' ? '<div class="alert info mb">Approved by ' + esc(a.appliedBy || '') + ' on ' + esc(fmtDT(a.appliedAt)) + '. Stock was corrected; shortages show in Losses.' + (a.charge && a.charge.deduct ? ' ' + esc(F(a.charge.amount)) + ' is deducted from ' + esc(a.charge.name) + '\'s pay for ' + esc(monthLabel(a.charge.month)) + '.' : '') + '</div>'
      : a.status === 'cancelled' ? '<div class="alert mb">Discarded by ' + esc(a.cancelledBy || '') + '. Nothing changed in stock.</div>' : '') +
    (h ? '<section class="card pad mb"><h3 class="mb">Handover · ' + esc(locName(loc)) + '</h3>' +
      sign('Taken over by ' + esc(h.toName), h.toAcceptedAt) +
      (h.fromId ? sign('Handed over by ' + esc(h.fromName), h.fromAgreedAt || h.fromDisputedAt, h.fromDisputedAt ? ' · <b class="neg-t">disputes the count</b>' + (h.fromNote ? ': ' + esc(h.fromNote) : '') : h.fromPresent === false ? ' · was not there' : '') : '<div class="tiny muted">Nobody handed over (outgoing person unknown).</div>') +
      (signBtns ? '<div class="row wrap mt">' + signBtns + '</div>' : '') + '</section>' : '') +
    '<section class="card pad mb"><h3 class="mb">' + (since.from ? 'Since the last count — ' + esc(fmtDate(since.from)) + (since.days ? ' (' + since.days + ' day' + (since.days === 1 ? '' : 's') + ' ago)' : ' (earlier today)') : 'First count at this branch') + '</h3>' +
      (since.from ? '<div class="au-since"><div><span>Sold</span><b>' + fmt(since.sold) + '</b></div><div><span>Losses recorded</span><b>' + fmt(since.lost) + '</b>' + (cost && since.lostV ? '<small>' + F(since.lostV) + '</small>' : '') + '</div><div><span>Transfers in / out</span><b>+' + fmt(since.tin) + ' / −' + fmt(since.tout) + '</b></div><div class="' + (s.shortQty ? 'bad' : '') + '"><span>Missing, not explained</span><b>' + fmt(s.shortQty) + '</b>' + (cost && s.short ? '<small>' + F(s.short) + '</small>' : '') + '</div></div>' +
        (holder && holder.name ? '<p class="small mt" style="margin-bottom:0">The stock was held by <b>' + esc(holder.name) + '</b> during this time.</p>' : '') : '<p class="small muted" style="margin:0">Nothing to compare with yet. From the next count on, you\'ll see what was sold, lost and moved in between.</p>') + '</section>' +
    '<div class="card tw"><table class="t"><thead><tr><th>Item</th><th class="r">Expected</th><th class="r">Counted</th><th class="r">Difference</th>' + (cost ? '<th class="r">Value</th>' : '') + '</tr></thead><tbody>' +
      s.lines.slice().sort((x, y) => (num(x.counted) - num(x.system)) - (num(y.counted) - num(y.system))).map((l) => { const d = num(l.counted) - num(l.system); return '<tr><td>' + esc(l.name || (byId('products', l.productId) || {}).name) + '</td><td class="r">' + l.system + '</td><td class="r">' + l.counted + '</td><td class="r b" style="color:' + (d < 0 ? 'var(--bad)' : d > 0 ? 'var(--warn)' : 'var(--ok)') + '">' + (d > 0 ? '+' : '') + d + '</td>' + (cost ? '<td class="r money">' + fmt(d * num(l.unitCost)) + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>' +
    (mgr ? '<section class="card pad mt2 au-approve"><h3 class="mb">Approve</h3>' +
      (h && !h.toAcceptedAt ? '<div class="alert mb">' + esc(h.toName) + ' has not accepted the stock yet. You can still approve if they agreed in person.</div>' : '') +
      (s.shortQty ? field('Why is stock missing?', sel('auReason', ['Stock count difference', 'Missing / theft', 'Unaccounted for', 'Damaged', 'Expired'], 'Stock count difference')) +
        '<div class="grid2">' + field('Who held this stock?', sel('auWho', [['', 'Nobody / not known']].concat(people.map((p) => [p.id, p.name])), holder ? holder.id : '')) + field('Shortage to deduct from their pay', inp('auAmt', Math.round(s.short), 'inputmode="numeric"' + (cost ? '' : ' placeholder="Amount"'))) + '</div>' +
        '<label class="toggle"><input type="checkbox" name="auDeduct">Deduct it from their pay for ' + esc(monthLabel(todayStr().slice(0, 7))) + ' (Payroll)</label>' : '<p class="small muted" style="margin:0">Nothing is missing.</p>') + '</section>' : '') +
    (a.status === 'submitted' && !mgr && !signBtns ? '<p class="hint mt">' + esc(auWaitText(a)) + '.</p>' : ''));
  const f = $('.sf', sh);
  f.innerHTML = mgr ? '<button class="btn danger" data-a="auditCancel" data-id="' + a.id + '">Discard</button><button class="btn pri grow" data-a="auditApply" data-id="' + a.id + '">' + ic('check') + 'Approve & correct stock</button>' : '<button class="btn pri grow" data-a="sheetClose">Close</button>';
}
A.auditSign = async (el) => {
  const a = byId('audits', el.dataset.id); if (!a || !a.handover) return; const v = el.dataset.v; const h = Object.assign({}, a.handover);
  if (v === 'accept') { if (!(await confirmBox('Accept the stock at ' + locName(a.locationId) + ' as counted? From now on you hold it.', 'Accept'))) return; h.toAcceptedAt = new Date().toISOString(); }
  if (v === 'agree') h.fromAgreedAt = new Date().toISOString();
  if (v === 'dispute') {
    const why = await new Promise((res) => { const s = openSheet({ title: 'Dispute the count', body: field('What is wrong with it?', '<textarea class="inp" name="why" rows="3" placeholder="e.g. 2 cartons of oil were moved to the back store"></textarea>'), foot: '<button class="btn grow" data-a="sheetClose">Back</button><button class="btn danger grow" id="adOk">Dispute</button>', onClose: () => res(null) }); $('#adOk', s).onclick = () => { const t = $('[name=why]', s).value.trim(); if (t.length < 3) return toast('Say what is wrong', true); s._onClose = null; closeSheet(); res(t); }; });
    if (!why) return; Object.assign(h, { fromDisputedAt: new Date().toISOString(), fromNote: why });
  }
  if (await save('audits', Object.assign({}, a, { handover: h }))) { toast(v === 'accept' ? 'You now hold the stock at ' + locName(a.locationId) : v === 'agree' ? 'Thank you — you agreed with the count' : 'Your dispute was recorded'); refreshSheets(); render(true); }
};
A.auditApply = async (el) => {
  const sh = el.closest('.scrim'); const a = byId('audits', el.dataset.id); if (!a || a.status !== 'submitted') return;
  const s = auSummary(a); const diffs = s.lines.filter((l) => num(l.counted) !== num(l.system));
  const v = formVals(sh); const reason = v.auReason || 'Stock count difference'; const loc = a.locationId || 'main';
  let charge = null;
  if (v.auDeduct) {
    const who = teamPeople().find((p) => p.id === v.auWho); const amt = Math.round(num(v.auAmt));
    if (!who) return toast('Choose who held the stock to deduct from their pay', true);
    if (!(amt > 0)) return toast('Type the amount to deduct', true);
    if (!(await confirmBox('Deduct ' + F(amt) + ' from ' + who.name + '\'s pay for ' + monthLabel(todayStr().slice(0, 7)) + '?', 'Deduct'))) return;
    charge = { userId: who.id, name: who.name, amount: amt, deduct: true, month: todayStr().slice(0, 7), by: K.me.name || '' };
  } else if (v.auWho) { const who = teamPeople().find((p) => p.id === v.auWho); if (who) charge = { userId: who.id, name: who.name, amount: Math.round(s.short), deduct: false }; }
  let n = 0; const note = 'Stock count ' + fmtDate(String(a.startedAt).slice(0, 10)) + (a.handover ? ' (handover ' + (a.handover.fromName || '—') + ' → ' + a.handover.toName + ')' : '');
  for (const [li, l] of diffs.entries()) {
    let d = num(l.counted) - num(l.system); const lots = lossLots(l.productId, loc); if (!lots.length) continue;
    const base = { date: todayStr(), productId: l.productId, locationId: loc, notes: note, auditId: a.id, byId: K.me.id || '', by: K.me.name || '' };
    if (d > 0) { if (await save('adjustments', Object.assign({ id: 'a_au_' + a.id + '_' + li, lotId: lots[0].id, qty: d, reason: 'Found / extra' }, base))) n++; continue; }
    let j = 0;
    for (const lt of lots) { if (d >= 0) break; const av = Math.max(0, (K.C.lotX[lt.id].byLoc || {})[loc] || 0); const take = Math.min(av, -d); if (take > 0) { if (await save('adjustments', Object.assign({ id: 'a_au_' + a.id + '_' + li + '_' + j++, lotId: lt.id, qty: -take, reason, cause: reason === 'Stock count difference' || reason === 'Unaccounted for' ? 'count' : KC.lossCauseOf({ reason }) }, base))) n++; d += take; } }
  }
  const done = Object.assign({}, a, { status: 'applied', appliedAt: new Date().toISOString(), appliedBy: K.me.name || '', adjustments: n, reason });
  if (charge) done.charge = charge; else delete done.charge;
  if (await save('audits', done)) { toast('Stock corrected (' + n + ' correction' + (n === 1 ? '' : 's') + ')' + (a.handover ? ' — ' + a.handover.toName + ' now holds the stock' : '')); refreshSheets(); render(true); }
};
