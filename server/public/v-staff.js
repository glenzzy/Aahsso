/* Aahsso — staff: clock in/out & breaks, attendance, leave, payroll, employee files */

Object.defineProperty(TAB_LABEL, 'payroll', { get: () => (can('payroll') ? 'Payroll' : 'My pay'), configurable: true });

/* ================= who works here ================= */
const meStaffId = () => KC.staffIdOf(K.me.id);
/** Names of everyone with a login (server mode). Loaded once; callers may await it. */
function loadPeople(force) {
  if (K.info.mode !== 'saas') return Promise.resolve();
  if (K._peopleP && !force) return K._peopleP;
  K._peopleP = K.store.req('GET', '/api/team-names').then((r) => { K._people = r.people; scheduleRender(); refreshSheets(); }, () => { K._people = K._people || []; K._peopleP = null; });
  return K._peopleP;
}
/** Everyone with a login (pick who takes over the till; staff lists). */
function teamPeople() {
  if (K.info.mode === 'saas') { loadPeople(); return (K._people || []).filter((p) => p.active !== false); }
  return [{ id: K.me.id, name: K.me.name || 'Owner' }].concat((K.raw.members || []).filter((m) => m.active !== false && m.id !== K.me.id).map((m) => ({ id: m.id, name: m.name || 'Team member', locationId: m.locationId })));
}
/** Employee files, plus people who have a login but no file yet (so they can be set up). */
function roster(all) {
  const files = K.raw.staff.slice();
  teamPeople().forEach((p) => { const sid = KC.staffIdOf(p.id); if (!files.some((f) => f.id === sid)) files.push({ id: sid, name: p.name, userId: p.id, locationId: p.locationId || 'main', _new: true }); });
  return files.filter((f) => all || f.active !== false).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
const staffFile = (sid) => roster(true).find((f) => f.id === sid);
const staffName = (sid) => (staffFile(sid) || {}).name || (K.raw.attendance.find((a) => a.staffId === sid) || {}).staffName || (K.raw.leaves.find((l) => l.staffId === sid) || {}).staffName || 'Staff';
const attId = (date, sid) => 'at_' + date + '_' + sid;
const nowIso = () => new Date().toISOString();
const hm = (iso) => iso ? pad2(new Date(iso).getHours()) + ':' + pad2(new Date(iso).getMinutes()) : '—';
const dur = (min) => { min = Math.max(0, Math.round(min || 0)); const h = Math.floor(min / 60), m = min % 60; return h ? h + 'h' + (m ? ' ' + pad2(m) : '') : m + ' min'; };
const monthLabel = (m) => MONTHS[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4);
const leaveOn = (sid, date) => K.raw.leaves.find((l) => l.staffId === sid && l.status === 'approved' && l.from <= date && (l.to || l.from) >= date);
const leaveType = (t) => (KC.LEAVE_TYPES.find((x) => x[0] === t) || [t, t])[1];
const stateBadge = (st, lv) => st.open ? '<span class="badge bad">Did not clock out</span>' : st.state === 'in' ? '<span class="badge ok">Working</span>' : st.state === 'break' ? '<span class="badge warn">On break</span>' : st.state === 'done' ? '<span class="badge">Left</span>' : lv ? '<span class="badge info">On leave</span>' : '<span class="badge">Not in</span>';
const statChips = (list) => '<div class="st-chips">' + list.map(([l, v, cls]) => '<div class="st-chip' + (cls ? ' ' + cls : '') + '"><div class="st-v">' + v + '</div><div class="st-l">' + l + '</div></div>').join('') + '</div>';

/* ================= clock in / break / back / clock out ================= */
/** Your record for today — or yesterday's if you are still working past midnight. */
function myOpenDay() {
  const sid = meStaffId(); const t = todayStr();
  const td = byId('attendance', attId(t, sid)); if (td) return td;
  const yd = byId('attendance', attId(KC.addDays(t, -1), sid));
  if (yd) { const st = KC.dayState(yd, null, S()); if (st.state === 'in' || st.state === 'break') return yd; }
  return null;
}
const CLOCK_BTN = { in: ['pri', 'Clock in', 'check'], break: ['', 'Start break', 'clock'], back: ['pri', 'Back to work', 'check'], out: ['', 'Clock out', 'back'] };
function clockCard(compact) {
  const day = myOpenDay(); const st = KC.dayState(day, nowIso(), S()); const lv = leaveOn(meStaffId(), todayStr());
  const line = st.state === 'in' ? 'Working since ' + hm(st.since) + ' · ' + dur(st.workedMin) + ' today'
    : st.state === 'break' ? 'On break since ' + hm(st.since) + ' · ' + dur(st.workedMin) + ' worked'
    : st.state === 'done' ? 'Left at ' + hm(st.lastOut) + ' · ' + dur(st.workedMin) + ' worked' + (st.breakMin ? ', ' + dur(st.breakMin) + ' break' : '')
    : lv ? 'You are on leave today (' + leaveType(lv.type).toLowerCase() + ')' : 'Tap Clock in when you start work';
  const title = { off: 'Not clocked in', in: 'Working', break: 'On break', done: 'Clocked out' }[st.state];
  return '<div class="card clock-card' + (compact ? ' compact' : '') + '" id="clockCard"><div class="clock-ic ' + st.state + '">' + ic('clock') + '</div>' +
    '<div class="grow"><div class="b">' + title + (st.late ? ' <span class="badge warn">Late ' + dur(st.lateMin) + '</span>' : '') + '</div><div class="small muted">' + line + '</div></div>' +
    '<div class="clock-btns">' + KC.clockNext(st.state).map((t) => { const [cls, l, i] = CLOCK_BTN[t]; return '<button class="btn ' + cls + '" data-a="clock" data-t="' + t + '">' + ic(i) + l + '</button>'; }).join('') + '</div></div>';
}
A.clock = async (el) => {
  const t = el.dataset.t; const sid = meStaffId();
  let day = myOpenDay();
  if (t === 'in' && day && day.date !== todayStr()) day = null; // a new day
  if (t === 'out' && can('payments')) {
    const d0 = day ? day.date : todayStr(); const held = KC.collectedBy(K.raw, K.me.id, d0);
    if (Math.abs(held.total) >= 1 && !byId('handovers', hoId(d0, K.me.id)) && !(await confirmBox('You still hold ' + F(held.total) + ' from today. Hand the till to a colleague, or close your day in Cash handover. Clock out anyway?', 'Clock out anyway'))) return;
  }
  const d = day ? day.date : todayStr();
  const cur = day || { id: attId(d, sid), staffId: sid, userId: K.me.id, staffName: K.me.name || 'Me', date: d, locationId: K.loc, events: [] };
  const at = nowIso();
  if (await save('attendance', Object.assign({}, cur, { events: (cur.events || []).concat([{ t, at }]) }))) {
    toast({ in: 'Clocked in at ', break: 'Break started at ', back: 'Back at work at ', out: 'Clocked out at ' }[t] + hm(at)); scheduleRender();
  }
};
setInterval(() => { const c = document.getElementById('clockCard'); if (c && !K.sheets.length) c.outerHTML = clockCard(c.classList.contains('compact')); }, 60000);

/* ================= ATTENDANCE ================= */
VIEWS.staff = {
  render() {
    const d = K.ui.attDate || todayStr();
    let html = clockCard();
    if (!can('hr')) return html + myAttendance();
    const rows = roster().map((f) => { const a = byId('attendance', attId(d, f.id)); return { f, a, st: KC.dayState(a, nowIso(), S()), lv: leaveOn(f.id, d) }; });
    const inNow = rows.filter((r) => r.st.state === 'in').length, brk = rows.filter((r) => r.st.state === 'break').length, late = rows.filter((r) => r.st.late).length, off = rows.filter((r) => r.lv).length;
    html += '<div class="row wrap between mb mt2"><h2>' + (d === todayStr() ? 'Team today' : 'Team · ' + fmtDate(d)) + '</h2><div class="row wrap"><input type="date" class="inp" style="width:auto" value="' + d + '" max="' + todayStr() + '" data-c="attDate"><button class="btn" data-a="attAdd">' + ic('edit') + 'Correct or record time</button></div></div>' +
      (d === todayStr() ? statChips([['Working', inNow, 'ok'], ['On break', brk, brk ? 'warn' : ''], ['Late', late, late ? 'warn' : ''], ['On leave', off]]) : '') +
      '<div class="mb">' + dataTable({
        id: 'attBoard', rows, noun: 'person', empty: 'No staff yet. People with a login appear here; add others in <b>Employees</b>.',
        rowAttr: (r) => ' data-a="attEdit" data-s="' + r.f.id + '" data-d="' + d + '"',
        cols: [
          { k: 'name', label: 'Name', core: true, v: (r) => r.f.name },
          { k: 'st', label: 'Status', core: true, v: (r) => r.st.state, html: (r) => stateBadge(r.st, r.lv) },
          { k: 'in', label: 'Arrived', core: true, v: (r) => r.st.firstIn || '', html: (r) => r.st.firstIn ? hm(r.st.firstIn) + (r.st.late ? ' <span class="tiny late-t">+' + dur(r.st.lateMin) + '</span>' : '') : '—' },
          { k: 'out', label: 'Left', core: true, v: (r) => r.st.lastOut || '', html: (r) => hm(r.st.lastOut) },
          { k: 'brk', label: 'Breaks', v: (r) => r.st.breakMin, html: (r) => r.st.breaks ? dur(r.st.breakMin) + ' (' + r.st.breaks + ')' : '—' },
          { k: 'wk', label: 'Worked', core: true, num: true, v: (r) => r.st.workedMin, html: (r) => r.st.workedMin ? dur(r.st.workedMin) : '—' },
          { k: 'ed', label: 'Note', v: (r) => r.a ? [r.a.editedBy ? 'corrected by ' + r.a.editedBy : '', (r.a.events || []).some((e) => e.syncedAt || e.fixed) ? 'sent late (offline)' : '', r.a.note || ''].filter(Boolean).join(' · ') : '', cls: 'mut' },
        ] }) + '</div>';
    const m = K.ui.attMonth || monthStr();
    const ms = roster().map((f) => ({ f, x: KC.staffMonth(K.raw, f, m, S(), nowIso()) }));
    html += '<div class="row wrap between mb mt2"><h2>Month · ' + monthLabel(m) + '</h2><input type="month" class="inp" style="width:auto" value="' + m + '" max="' + monthStr() + '" data-c="attMonth"></div>' +
      dataTable({
        id: 'attMonth', rows: ms, noun: 'person', empty: 'No staff yet.',
        cols: [
          { k: 'name', label: 'Name', core: true, v: (r) => r.f.name },
          { k: 'wd', label: 'Days worked', core: true, num: true, v: (r) => r.x.worked, html: (r) => r.x.worked + ' / ' + r.x.scheduled },
          { k: 'h', label: 'Hours', core: true, num: true, v: (r) => r.x.hours },
          { k: 'late', label: 'Late', core: true, num: true, v: (r) => r.x.late, html: (r) => r.x.late ? '<span class="late-t">' + r.x.late + '</span>' : '0' },
          { k: 'ab', label: 'Absent', core: true, num: true, v: (r) => r.x.absent, html: (r) => r.x.tracked || r.x.absent < r.x.scheduled ? (r.x.absent ? '<span class="bad-t">' + r.x.absent + '</span>' : '0') : '<span class="faint" title="Never clocked in this month">—</span>' },
          { k: 'lv', label: 'Leave days', num: true, v: (r) => r.x.paidLeave + r.x.unpaidLeave },
          { k: 'ot', label: 'Overtime (h)', num: true, v: (r) => r.x.overtimeH },
          { k: 'op', label: 'No clock-out', num: true, v: (r) => r.x.open },
        ] });
    return html;
  },
};
CH.attDate = (el) => { K.ui.attDate = el.value || todayStr(); render(true); };
CH.attMonth = (el) => { K.ui.attMonth = el.value || monthStr(); render(true); };
function myAttendance() {
  const sid = meStaffId(); const me = byId('staff', sid) || { id: sid };
  const x = KC.staffMonth(K.raw, me, monthStr(), S(), nowIso());
  const days = K.raw.attendance.filter((a) => a.staffId === sid).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 31);
  return '<h2 class="mb mt2">My month · ' + monthLabel(monthStr()) + '</h2>' + statChips([['Days worked', x.worked], ['Hours', x.hours], ['Late arrivals', x.late, x.late ? 'warn' : ''], ['Overtime (h)', x.overtimeH]]) +
    '<div class="mt">' + dataTable({
      id: 'myAtt', rows: days, noun: 'day', empty: 'No clock-ins yet.',
      cols: [
        { k: 'd', label: 'Day', core: true, v: (a) => a.date, html: (a) => fmtDate(a.date) },
        { k: 'in', label: 'Arrived', core: true, v: (a) => KC.dayState(a, nowIso(), S()).firstIn || '', html: (a) => { const s = KC.dayState(a, nowIso(), S()); return hm(s.firstIn) + (s.late ? ' <span class="tiny late-t">late</span>' : ''); } },
        { k: 'out', label: 'Left', core: true, v: (a) => KC.dayState(a, nowIso(), S()).lastOut || '', html: (a) => hm(KC.dayState(a, nowIso(), S()).lastOut) },
        { k: 'b', label: 'Breaks', v: (a) => KC.dayState(a, nowIso(), S()).breakMin, html: (a) => dur(KC.dayState(a, nowIso(), S()).breakMin) },
        { k: 'w', label: 'Worked', core: true, num: true, v: (a) => KC.dayState(a, nowIso(), S()).workedMin, html: (a) => dur(KC.dayState(a, nowIso(), S()).workedMin) },
      ] }) + '</div><p class="hint mt">A time is wrong? Ask your manager to correct it.</p>';
}
/* a manager corrects a day, or records time for someone without a login */
A.attEdit = (el) => attSheet(el.dataset.s, el.dataset.d);
A.attAdd = () => attSheet(null, K.ui.attDate || todayStr());
function attSheet(sid0, d0) {
  let sid = sid0, d = d0; const rec = () => sid ? byId('attendance', attId(d, sid)) : null;
  let ev = ((rec() || {}).events || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at))).map((e) => ({ t: e.t, time: hm(e.at) }));
  const sh = openSheet({ title: sid ? staffName(sid) + ' · ' + fmtDate(d) : 'Correct or record time', body: '',
    foot: (rec() ? '<button class="btn danger" id="atDel" title="Delete this day">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="atSave">Save</button>' });
  const draw = () => {
    const a = rec(); const preview = KC.dayState({ date: d, events: ev.filter((e) => e.time).map((e) => ({ t: e.t, at: new Date(d + 'T' + e.time).toISOString() })) }, null, S());
    setSheetBody(sh, '<div class="col">' + (!sid0 ? '<div class="grid2">' + field('Who', sel('atWho', [['', 'Choose…']].concat(roster().map((f) => [f.id, f.name])), sid || '', 'id="atWho"')) + field('Day', '<input type="date" class="inp" id="atDay" value="' + d + '" max="' + todayStr() + '">') + '</div>' : '') +
      (a && a.editedBy ? '<div class="tiny muted">Last corrected by ' + esc(a.editedBy) + ' · ' + esc(fmtDT(a.editedAt)) + '</div>' : '') +
      '<div class="at-rows">' + (ev.length ? ev.map((e, i) => '<div class="at-row"><select class="inp" data-ati="' + i + '" data-k="t">' + Object.entries(KC.CLOCK).map(([k, l]) => '<option value="' + k + '"' + (k === e.t ? ' selected' : '') + '>' + l + '</option>').join('') + '</select><input type="time" class="inp" data-ati="' + i + '" data-k="time" value="' + esc(e.time) + '"><button type="button" class="btn ghost sm" data-atrm="' + i + '" aria-label="Remove">' + ic('x', 'sm') + '</button></div>').join('') : '<div class="muted small">No times recorded for this day.</div>') + '</div>' +
      '<div class="row wrap">' + [['in', 'Arrived'], ['break', 'Break'], ['back', 'Back'], ['out', 'Left']].map(([t, l]) => '<button type="button" class="btn sm" data-atadd="' + t + '">' + ic('plus', 'sm') + l + '</button>').join('') + '</div>' +
      '<div class="card pad small"><div class="row between"><span>Worked</span><b>' + dur(preview.workedMin) + '</b></div><div class="row between"><span>Breaks</span><span>' + dur(preview.breakMin) + '</span></div>' + (preview.late ? '<div class="row between"><span>Late</span><span class="late-t">' + dur(preview.lateMin) + '</span></div>' : '') + '</div>' +
      field('Why it was corrected (optional)', inp('atNote', (a && a.note) || '', 'placeholder="e.g. forgot to clock out, phone was off"')) + '</div>');
  };
  draw();
  sh.addEventListener('change', (e) => {
    const i = e.target.dataset.ati; if (i !== undefined) { ev[i][e.target.dataset.k] = e.target.value; draw(); return; }
    if (e.target.id === 'atWho' || e.target.id === 'atDay') { sid = $('#atWho', sh).value || null; d = $('#atDay', sh).value || d; ev = ((rec() || {}).events || []).map((x) => ({ t: x.t, time: hm(x.at) })); draw(); }
  });
  sh.addEventListener('click', (e) => {
    const add = e.target.closest('[data-atadd]'); const rm = e.target.closest('[data-atrm]');
    if (add) { const last = ev.length ? ev[ev.length - 1].time : ''; ev.push({ t: add.dataset.atadd, time: add.dataset.atadd === 'in' && !last ? S().staffRules?.workStart || '08:00' : last }); draw(); }
    if (rm) { ev.splice(Number(rm.dataset.atrm), 1); draw(); }
  });
  $('#atSave', sh).onclick = async () => {
    if (!sid) return toast('Choose who', true);
    if (ev.some((e) => !e.time)) return toast('Fill in every time', true);
    const f = staffFile(sid) || {}; const a = rec();
    const events = ev.map((e) => ({ t: e.t, at: new Date(d + 'T' + e.time).toISOString() })).sort((x, y) => x.at.localeCompare(y.at));
    const doc = Object.assign({ id: attId(d, sid), staffId: sid, userId: f.userId || '', staffName: f.name || staffName(sid), date: d, locationId: f.locationId || K.loc }, a || {}, { events, note: formVals(sh).atNote, editedBy: K.me.name || 'Manager', editedAt: nowIso() });
    if (await save('attendance', doc)) { closeSheet(); scheduleRender(); toast('Time saved'); }
  };
  if ($('#atDel', sh)) $('#atDel', sh).onclick = async () => { if (await confirmBox('Delete all times for ' + staffName(sid) + ' on ' + fmtDate(d) + '?', 'Delete', true)) { await remove('attendance', attId(d, sid)); closeSheet(); scheduleRender(); } };
}

/* ================= LEAVE ================= */
const lvBadge = (st) => '<span class="badge ' + ({ requested: 'warn', approved: 'ok', rejected: 'bad', cancelled: '' }[st] || '') + '">' + ((KC.LEAVE_STATUS.find((x) => x[0] === st) || [0, st])[1]) + '</span>';
const lvDays = (l) => KC.leaveDates(l, S()).length * (l.half ? 0.5 : 1);
const lvWhen = (l) => fmtDate(l.from) + (l.to && l.to !== l.from ? ' → ' + fmtDate(l.to) : '') + (l.half ? ' (half day)' : '');
VIEWS.leave = {
  render() {
    const sid = meStaffId(); const me = byId('staff', sid) || { id: sid, name: K.me.name }; const y = Number(todayStr().slice(0, 4));
    const b = KC.leaveBalance(K.raw, me, y, S());
    const mine = K.raw.leaves.filter((l) => l.staffId === sid).sort((a, c) => c.from.localeCompare(a.from));
    let html = '<div class="card pad2 mb"><div class="row between wrap mb"><div><h2>My leave · ' + y + '</h2><div class="small muted">Paid vacation days for this year' + (me.startDate && me.startDate.slice(0, 4) === String(y) ? ', counted from your start date' : '') + '.</div></div><button class="btn pri" data-a="lvNew">' + ic('plus') + 'Ask for leave</button></div>' +
      statChips([['Days left', b.left, b.left < 0 ? 'bad' : 'ok'], ['Taken', b.taken], ['Waiting', b.pending, b.pending ? 'warn' : ''], ['Per year', b.entitled]]) +
      (mine.length ? '<div class="mt">' + lvTable('lvMine', mine, false) + '</div>' : '') + '</div>';
    const ahead = K.raw.leaves.filter((l) => l.status === 'approved' && (l.to || l.from) >= todayStr() && l.from <= KC.addDays(todayStr(), 30) && l.staffId !== sid).sort((a, c) => a.from.localeCompare(c.from));
    if (can('hr')) {
      const wait = K.raw.leaves.filter((l) => l.status === 'requested').sort((a, c) => a.from.localeCompare(c.from));
      html += '<div class="row wrap between mb"><h2>Requests to answer</h2><button class="btn" data-a="lvNew" data-hr="1">' + ic('plus') + 'Record leave for someone</button></div>' +
        (wait.length ? '<div class="col mb2">' + wait.map((l) => { const f = staffFile(l.staffId) || { id: l.staffId }; const bb = KC.leaveBalance(K.raw, f, Number(l.from.slice(0, 4)), S()); const clash = K.raw.leaves.filter((o) => o.id !== l.id && o.staffId !== l.staffId && o.status === 'approved' && o.from <= (l.to || l.from) && (o.to || o.from) >= l.from);
          return '<div class="card pad lv-req"><div class="grow"><div class="b">' + esc(l.staffName || staffName(l.staffId)) + ' · ' + esc(leaveType(l.type)) + '</div><div class="small">' + lvWhen(l) + ' · <b>' + lvDays(l) + ' working day' + (lvDays(l) === 1 ? '' : 's') + '</b></div>' +
            (l.type === 'vacation' ? '<div class="tiny muted">Vacation left after this: ' + (bb.left) + ' day(s)</div>' : '') + (l.reason ? '<div class="tiny muted">“' + esc(l.reason) + '”</div>' : '') + (clash.length ? '<div class="tiny late-t">Also off then: ' + esc(clash.map((o) => o.staffName || staffName(o.staffId)).join(', ')) + '</div>' : '') + '</div>' +
            '<div class="row"><button class="btn" data-a="lvDecide" data-id="' + l.id + '" data-v="rejected">Decline</button><button class="btn pri" data-a="lvDecide" data-id="' + l.id + '" data-v="approved">' + ic('check') + 'Approve</button></div></div>'; }).join('') + '</div>' : '<div class="card pad mb2 muted small">No requests waiting.</div>');
      html += '<h2 class="mb">Who is off in the next 30 days</h2>' + (ahead.length ? lvTable('lvAhead', ahead, true) : '<div class="card pad muted small mb2">Nobody.</div>');
      const rows = roster().map((f) => ({ f, b: KC.leaveBalance(K.raw, f, y, S()) }));
      html += '<h2 class="mb mt2">Vacation balances · ' + y + '</h2>' + dataTable({ id: 'lvBal', rows, noun: 'person', cols: [
        { k: 'n', label: 'Name', core: true, v: (r) => r.f.name }, { k: 'e', label: 'Per year', core: true, num: true, v: (r) => r.b.entitled },
        { k: 't', label: 'Taken', core: true, num: true, v: (r) => r.b.taken }, { k: 'p', label: 'Waiting', num: true, v: (r) => r.b.pending },
        { k: 'l', label: 'Left', core: true, num: true, v: (r) => r.b.left, html: (r) => '<b class="' + (r.b.left < 0 ? 'bad-t' : '') + '">' + r.b.left + '</b>' }] }) +
        '<h2 class="mb mt2">All leave</h2>' + lvTable('lvAll', K.raw.leaves.slice().sort((a, c) => c.from.localeCompare(a.from)), true);
    } else if (ahead.length) html += '<h2 class="mb">Colleagues off in the next 30 days</h2>' + lvTable('lvAhead', ahead, true);
    return html;
  },
};
function lvTable(id, rows, withName) {
  return dataTable({ id, rows, noun: 'leave', empty: 'No leave.', rowAttr: (l) => ' data-a="lvOpen" data-id="' + l.id + '"', cols: [
    withName && { k: 'n', label: 'Who', core: true, v: (l) => l.staffName || staffName(l.staffId) },
    { k: 'ty', label: 'Type', core: true, v: (l) => leaveType(l.type) },
    { k: 'w', label: 'When', core: true, v: (l) => l.from, html: (l) => lvWhen(l) },
    { k: 'd', label: 'Days', core: true, num: true, v: (l) => lvDays(l) },
    { k: 's', label: 'Status', core: true, v: (l) => l.status, html: (l) => lvBadge(l.status) },
    { k: 'by', label: 'Answered by', v: (l) => l.decidedBy || '', cls: 'mut' },
  ] });
}
A.lvNew = (el) => lvSheet(null, el && el.dataset.hr === '1');
A.lvOpen = (el) => lvSheet(byId('leaves', el.dataset.id), false);
function lvSheet(l, forOther) {
  const mine = !l ? !forOther : l.staffId === meStaffId();
  const editable = !l || (can('hr') ? ['requested', 'approved'].includes(l.status) : mine && l.status === 'requested');
  const sh = openSheet({ title: l ? (l.staffName || staffName(l.staffId)) + ' · ' + leaveType(l.type) : forOther ? 'Record leave' : 'Ask for leave', body: '',
    foot: (l && editable && (mine || can('hr')) ? '<button class="btn danger" id="lvCancel">' + (l.status === 'approved' ? 'Cancel leave' : 'Withdraw') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Close</button>' + (editable ? '<button class="btn pri grow" id="lvSave">' + (!l && !forOther && !can('hr') ? 'Send request' : 'Save') + '</button>' : '') });
  const v0 = l || { type: 'vacation', from: todayStr(), to: todayStr(), staffId: forOther ? '' : meStaffId() };
  const dis = editable ? '' : ' disabled';
  setSheetBody(sh, '<div class="col">' + (l ? '<div class="row between">' + lvBadge(l.status) + (l.decidedBy ? '<span class="tiny muted">by ' + esc(l.decidedBy) + ' · ' + esc(fmtDT(l.decidedAt)) + '</span>' : '') + '</div>' : '') +
    (forOther ? field('Who', sel('lvWho', [['', 'Choose…']].concat(roster().map((f) => [f.id, f.name])), '')) : '') +
    field('Type', sel('lvType', KC.LEAVE_TYPES.map(([k, lbl]) => [k, lbl]), v0.type, dis)) +
    '<div class="grid2">' + field('First day', '<input type="date" class="inp" name="lvFrom" value="' + esc(v0.from) + '"' + dis + '>') + field('Last day', '<input type="date" class="inp" name="lvTo" value="' + esc(v0.to || v0.from) + '"' + dis + '>') + '</div>' +
    '<label class="toggle" id="lvHalfRow"><input type="checkbox" name="lvHalf"' + (v0.half ? ' checked' : '') + dis + '>Half day</label>' +
    field('Reason (optional)', inp('lvReason', v0.reason || '', 'placeholder="e.g. family event, medical"' + dis)) +
    '<div class="card pad small" id="lvInfo"></div></div>');
  const info = () => {
    const v = formVals(sh); const half = v.lvFrom && v.lvFrom === v.lvTo; $('#lvHalfRow', sh).classList.toggle('hide', !half);
    const who = forOther ? v.lvWho : v0.staffId; const f = staffFile(who) || { id: who };
    const draft = { id: l ? l.id : '_new', staffId: who, from: v.lvFrom, to: v.lvTo || v.lvFrom, half: half && v.lvHalf, type: v.lvType };
    const n = v.lvFrom ? lvDays(draft) : 0; const bb = who ? KC.leaveBalance(Object.assign({}, K.raw, { leaves: K.raw.leaves.filter((x) => !l || x.id !== l.id) }), f, Number((v.lvFrom || todayStr()).slice(0, 4)), S()) : null;
    const ov = who && v.lvFrom ? KC.leaveOverlaps(K.raw, draft) : [];
    $('#lvInfo', sh).innerHTML = '<div class="row between"><span>Working days</span><b>' + n + '</b></div>' + (bb && v.lvType === 'vacation' ? '<div class="row between"><span>Vacation left after</span><b class="' + (bb.left - n < 0 ? 'bad-t' : '') + '">' + (bb.left - n) + '</b></div>' : '') + (!KC.leavePaid(v.lvType) ? '<div class="tiny muted mt">Unpaid: deducted from a monthly salary.</div>' : '') + (ov.length ? '<div class="tiny bad-t mt">Overlaps leave already booked (' + esc(ov.map(lvWhen).join(', ')) + ').</div>' : '');
    return { draft, n, ov, bb };
  };
  sh.addEventListener('input', info); sh.addEventListener('change', info); info();
  if ($('#lvSave', sh)) $('#lvSave', sh).onclick = async () => {
    const v = formVals(sh); const { draft, n, ov, bb } = info();
    if (!draft.staffId) return toast('Choose who', true);
    if (!v.lvFrom || draft.to < draft.from) return toast('Check the dates', true);
    if (!n) return toast('These days are not working days', true);
    if (ov.length) return toast('This overlaps leave already booked', true);
    if (v.lvType === 'vacation' && bb && bb.left - n < 0 && !(await confirmBox('This is ' + (n - bb.left) + ' day(s) more than the vacation left. Continue?', 'Continue'))) return;
    const f = staffFile(draft.staffId) || {};
    const hrSaves = can('hr');
    const doc = Object.assign({}, l || { id: uid('lv_'), requestedAt: nowIso(), requestedBy: K.me.name || '' }, { staffId: draft.staffId, staffName: f.name || staffName(draft.staffId), type: v.lvType, from: draft.from, to: draft.to, half: !!draft.half, reason: v.lvReason, status: l ? l.status : hrSaves ? 'approved' : 'requested' });
    if (!l && hrSaves) { doc.decidedBy = K.me.name || 'Manager'; doc.decidedAt = nowIso(); }
    if (await save('leaves', doc)) { closeSheet(); scheduleRender(); toast(doc.status === 'approved' ? 'Leave saved' : 'Request sent — your manager will answer'); }
  };
  if ($('#lvCancel', sh)) $('#lvCancel', sh).onclick = async () => { if (await confirmBox(l.status === 'approved' ? 'Cancel this approved leave?' : 'Withdraw this request?', 'Yes', true)) { if (await save('leaves', Object.assign({}, l, { status: 'cancelled' }))) { closeSheet(); scheduleRender(); } } };
}
A.lvDecide = async (el) => {
  const l = byId('leaves', el.dataset.id); const v = el.dataset.v;
  if (v === 'rejected' && !(await confirmBox('Decline ' + (l.staffName || 'this') + "'s leave (" + lvWhen(l) + ')?', 'Decline', true))) return;
  if (await save('leaves', Object.assign({}, l, { status: v, decidedBy: K.me.name || 'Manager', decidedAt: nowIso() }))) { toast(v === 'approved' ? 'Leave approved' : 'Leave declined'); scheduleRender(); }
};

/* ================= EMPLOYEE FILES ================= */
const payLabel = (p) => p && num(p.rate) ? F(p.rate) + ' / ' + ({ monthly: 'month', daily: 'day', hourly: 'hour' }[p.type || 'monthly']) : '';
VIEWS.employees = {
  render() {
    const rows = roster(K.ui.empAll);
    return '<div class="row wrap between mb"><div class="row wrap"><button class="btn pri" data-a="empNew">' + ic('plus') + 'Add an employee without a login</button></div><label class="toggle"><input type="checkbox" data-c="empAll"' + (K.ui.empAll ? ' checked' : '') + '>Show people who left</label></div>' +
      '<p class="hint mb">Everyone with a login is listed automatically. Open a person to set their start date' + (can('payroll') ? ', pay' : '') + ' and leave days.</p>' +
      dataTable({ id: 'empList', rows, noun: 'employee', empty: 'No employees yet.', rowAttr: (f) => ' data-a="empOpen" data-id="' + f.id + '"', rowClass: (f) => f.active === false ? 'cx' : '', cols: [
        { k: 'n', label: 'Name', core: true, v: (f) => f.name },
        { k: 't', label: 'Job', core: true, v: (f) => f.title || '', cls: 'mut' },
        { k: 'l', label: 'Login', v: (f) => f.userId ? 'Yes' : 'No', cls: 'mut' },
        allLocs().length > 1 && { k: 'b', label: 'Branch', v: (f) => locName(f.locationId) },
        { k: 's', label: 'Started', v: (f) => f.startDate || '', html: (f) => f.startDate ? fmtDate(f.startDate) : '—' },
        can('payroll') && { k: 'p', label: 'Pay', core: true, v: (f) => num((f.pay || {}).rate), html: (f) => payLabel(f.pay) || '<span class="badge warn">Not set</span>' },
        { k: 'st', label: 'Status', core: true, v: (f) => f._new ? 'new' : f.active === false ? 'left' : 'ok', html: (f) => f._new ? '<span class="badge">No file yet</span>' : f.active === false ? '<span class="badge">Left</span>' : '<span class="badge ok">Active</span>' },
      ] });
  },
};
CH.empAll = (el) => { K.ui.empAll = el.checked; render(true); };
A.empNew = () => empSheet({ id: uid('st_'), _new: true, _manual: true, locationId: K.loc, active: true });
A.empOpen = (el) => empSheet(staffFile(el.dataset.id));
function empSheet(f0) {
  const f = Object.assign({}, f0); const p = Object.assign({ type: 'monthly', rate: '', overtime: false }, f.pay || {}); const R = KC.staffRules(S());
  const sh = openSheet({ title: f._new && f._manual ? 'Add an employee' : f.name || 'Employee', body: '', foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="empSave">Save</button>' });
  const rateLbl = (t) => ({ monthly: 'Monthly salary', daily: 'Pay per day worked', hourly: 'Pay per hour worked' }[t]) + ' (' + baseSym() + ')';
  setSheetBody(sh, '<div class="col">' +
    '<div class="grid2">' + field('Name', inp('eName', f.name || '', f.userId ? 'disabled title="Change the name in Team"' : '')) + field('Job / title', inp('eTitle', f.title || '', 'placeholder="e.g. Cashier, Driver, Warehouse"')) + '</div>' +
    '<div class="grid2">' + field('Phone', inp('ePhone', f.phone || '', 'inputmode="tel"')) + field('Start date', '<input type="date" class="inp" name="eStart" value="' + esc(f.startDate || '') + '">') + '</div>' +
    (allLocs().length > 1 ? field('Works at', sel('eLoc', allLocs().map((l) => [l.id, l.name]), f.locationId || 'main')) : '') +
    '<div class="tiny muted">' + (f.userId ? 'Has a login — clocks in from the app.' : 'No login — a manager records their time in Attendance.') + '</div>' +
    (can('payroll') ? '<div class="card pad"><h3 class="mb">Pay</h3><div class="grid2">' + field('Paid by', sel('pType', KC.PAY_TYPES, p.type, 'id="pType"')) + field('<span id="pRateL">' + rateLbl(p.type) + '</span>', inp('pRate', p.rate || '', 'inputmode="numeric"')) + '</div>' +
      '<div class="grid2">' + field('Hours in a normal day', inp('pHours', p.hoursPerDay || '', 'inputmode="decimal" placeholder="' + R.hoursPerDay + '"')) + field('Overtime pay rate', inp('pOtRate', p.overtimeRate || '', 'inputmode="decimal" placeholder="× ' + R.overtimeRate + '"')) + '</div>' +
      '<label class="toggle"><input type="checkbox" name="pOt"' + (p.overtime ? ' checked' : '') + '>Pay overtime (hours beyond a normal day)</label></div>' : '') +
    field('Paid vacation days per year', inp('eLeave', f.leavePerYear || '', 'inputmode="decimal" placeholder="' + R.leavePerYear + ' (business default)"')) +
    field('Notes', inp('eNotes', f.notes || '')) +
    (!(f._new && f._manual) ? '<label class="toggle"><input type="checkbox" name="eActive"' + (f.active === false ? '' : ' checked') + '>Still works here</label>' : '') + '</div>');
  if ($('#pType', sh)) $('#pType', sh).onchange = (e) => ($('#pRateL', sh).textContent = rateLbl(e.target.value));
  $('#empSave', sh).onclick = async () => {
    const v = formVals(sh); const name = f.userId ? f.name : v.eName;
    if (!name) return toast('Type a name', true);
    const doc = Object.assign({}, f, { name, title: v.eTitle, phone: v.ePhone, startDate: v.eStart, locationId: v.eLoc || f.locationId || 'main', leavePerYear: v.eLeave === '' ? null : num(v.eLeave), notes: v.eNotes, active: v.eActive === undefined ? true : v.eActive });
    if (can('payroll')) doc.pay = { type: v.pType, rate: num(v.pRate), hoursPerDay: v.pHours === '' ? null : num(v.pHours), overtime: !!v.pOt, overtimeRate: v.pOtRate === '' ? null : num(v.pOtRate.replace(/[^\d.]/g, '')) };
    delete doc._new; delete doc._manual;
    if (await save('staff', doc)) { closeSheet(); scheduleRender(); toast('Saved'); }
  };
}

/* ================= PAYROLL ================= */
const slipId = (m, sid) => 'ps_' + m + '_' + sid;
const payOpts = (slip) => Object.assign({ deductAbsences: false, deductShortages: true, extra: { earnings: [], deductions: [] } }, (slip && slip.opts) || {});
function slipFor(f, m) { const saved = byId('payroll', slipId(m, f.id)); if (saved && saved.status === 'paid') return saved; return Object.assign({}, KC.payslipDraft(K.raw, f, m, S(), payOpts(saved), nowIso()), saved ? { status: saved.status, opts: saved.opts } : { status: '' }); }
const slipBadge = (s) => s.status === 'paid' ? '<span class="badge ok">Paid ' + esc(fmtDate(String(s.paidAt).slice(0, 10))) + '</span>' : s.status === 'draft' ? '<span class="badge info">Draft</span>' : '<span class="badge">Not saved</span>';
VIEWS.payroll = {
  render() {
    if (!can('payroll')) return myPay();
    const m = K.ui.payMonth || monthStr();
    const all = roster(); const withPay = all.filter((f) => !f._new && num((f.pay || {}).rate) > 0); const noPay = all.filter((f) => !withPay.includes(f));
    const rows = withPay.map((f) => ({ f, s: slipFor(f, m) }));
    const adv = K.raw.payroll.filter((p) => p.type === 'advance' && (p.deductMonth || String(p.date).slice(0, 7)) === m && p.status !== 'cancelled');
    const net = rows.reduce((a, r) => a + r.s.net, 0), paid = rows.filter((r) => r.s.status === 'paid');
    let html = '<div class="row wrap between mb"><div class="row wrap"><input type="month" class="inp" style="width:auto" value="' + m + '" data-c="payMonth"><button class="btn" data-a="advNew">' + ic('wallet') + 'Give an advance</button>' + (rows.length && can('export') ? '<button class="btn" data-a="payXlsx">' + ic('dl') + 'Excel</button>' : '') + '</div></div>' +
      statChips([['To pay in ' + monthLabel(m), F(net)], ['Paid', paid.length + ' / ' + rows.length, paid.length === rows.length && rows.length ? 'ok' : ''], ['Advances this month', F(adv.reduce((a, p) => a + num(p.amount), 0))]]);
    html += '<div class="mt mb">' + dataTable({ id: 'payList', rows, noun: 'payslip', empty: 'Set each person\'s pay in <a href="#employees">Employees</a> to start.', rowAttr: (r) => ' data-a="payOpen" data-id="' + r.f.id + '"',
      cols: [
        { k: 'n', label: 'Name', core: true, v: (r) => r.f.name },
        { k: 'p', label: 'Pay', v: (r) => r.s.rate, html: (r) => payLabel(r.f.pay) },
        { k: 'w', label: 'Worked', core: true, v: (r) => r.s.stats.worked, html: (r) => r.s.payType === 'hourly' ? r.s.stats.hours + ' h' : r.s.stats.worked + ' / ' + r.s.stats.scheduled + ' days' },
        { k: 'g', label: 'Gross', money: true, v: (r) => r.s.gross },
        { k: 'd', label: 'Deductions', money: true, v: (r) => r.s.deductionsTotal },
        { k: 'net', label: 'Net pay', core: true, money: true, v: (r) => r.s.net, total: (rs) => fmt(rs.reduce((a, r) => a + r.s.net, 0)) },
        { k: 's', label: 'Status', core: true, v: (r) => r.s.status || 'z', html: (r) => slipBadge(r.s) },
      ] }) + '</div>';
    if (noPay.length) html += '<p class="hint">No pay set yet for: ' + noPay.map((f) => '<a href="#" data-a="empOpen" data-id="' + f.id + '">' + esc(f.name) + '</a>').join(', ') + '.</p>';
    if (adv.length) html += '<h2 class="mb mt2">Advances deducted in ' + monthLabel(m) + '</h2>' + dataTable({ id: 'advList', rows: adv, noun: 'advance', rowAttr: (p) => ' data-a="advOpen" data-id="' + p.id + '"', cols: [
      { k: 'n', label: 'Who', core: true, v: (p) => p.staffName || staffName(p.staffId) }, { k: 'd', label: 'Given', core: true, v: (p) => p.date, html: (p) => fmtDate(p.date) },
      { k: 'a', label: 'Amount', core: true, money: true, v: (p) => num(p.amount) }, { k: 'm', label: 'Paid by', v: (p) => p.method || '' }, { k: 'no', label: 'Note', v: (p) => p.note || '', cls: 'mut' }] });
    return html;
  },
};
CH.payMonth = (el) => { K.ui.payMonth = el.value || monthStr(); render(true); };
function myPay() {
  const sid = meStaffId();
  const slips = K.raw.payroll.filter((p) => p.staffId === sid && p.type !== 'advance' && p.status === 'paid').sort((a, b) => b.month.localeCompare(a.month));
  const adv = K.raw.payroll.filter((p) => p.staffId === sid && p.type === 'advance' && p.status !== 'cancelled').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  return '<h2 class="mb">My payslips</h2>' + dataTable({ id: 'mySlips', rows: slips, noun: 'payslip', empty: 'No payslips yet.', rowAttr: (p) => ' data-a="payView" data-id="' + p.id + '"', cols: [
    { k: 'm', label: 'Month', core: true, v: (p) => p.month, html: (p) => monthLabel(p.month) }, { k: 'g', label: 'Gross', money: true, v: (p) => p.gross },
    { k: 'd', label: 'Deductions', money: true, v: (p) => p.deductionsTotal }, { k: 'n', label: 'Net pay', core: true, money: true, v: (p) => p.net }, { k: 'p', label: 'Paid', core: true, v: (p) => p.paidAt, html: (p) => fmtDate(String(p.paidAt).slice(0, 10)) }] }) +
    (adv.length ? '<h2 class="mb mt2">My advances</h2>' + dataTable({ id: 'myAdv', rows: adv, noun: 'advance', cols: [{ k: 'd', label: 'Given', core: true, v: (p) => p.date, html: (p) => fmtDate(p.date) }, { k: 'a', label: 'Amount', core: true, money: true, v: (p) => num(p.amount) }, { k: 'm', label: 'Taken from pay of', core: true, v: (p) => monthLabel(p.deductMonth || p.date.slice(0, 7)) }] }) : '');
}
A.payView = (el) => slipSheet(byId('payroll', el.dataset.id), true);
A.payOpen = (el) => { const f = staffFile(el.dataset.id); const m = K.ui.payMonth || monthStr(); const saved = byId('payroll', slipId(m, f.id)); slipSheet(saved && saved.status === 'paid' ? saved : null, false, f, m); };
function slipLines(list, cls) { return list.map((x) => '<div class="row between cl ' + (cls || '') + '"><span>' + esc(x.label) + '</span><span class="money">' + fmt(x.amount) + '</span></div>').join(''); }
function slipSheet(paid, readOnly, f, m) {
  if (paid) {
    const sh = openSheet({ title: 'Payslip · ' + (paid.staffName || staffName(paid.staffId)) + ' · ' + monthLabel(paid.month), body: slipSummary(paid) + '<div class="alert info mt">Paid on ' + esc(fmtDate(String(paid.paidAt).slice(0, 10))) + (paid.payMethod ? ' by ' + esc(paid.payMethod) : '') + (paid.paidBy ? ' · ' + esc(paid.paidBy) : '') + '</div>',
      foot: (!readOnly && can('payroll') ? '<button class="btn" id="psUndo">Undo payment</button>' : '') + '<button class="btn grow" data-a="sheetClose">Close</button><button class="btn pri grow" id="psPdf">' + ic('dl') + 'PDF</button>' });
    $('#psPdf', sh).onclick = () => payslipPDF(paid);
    if ($('#psUndo', sh)) $('#psUndo', sh).onclick = async () => {
      if (!(await confirmBox('Undo this payment? The salary expense is removed and the payslip goes back to draft.', 'Undo payment', true))) return;
      if (paid.expenseId && byId('expenses', paid.expenseId)) await remove('expenses', paid.expenseId);
      if (await save('payroll', Object.assign({}, paid, { status: 'draft', paidAt: null, expenseId: null }))) { closeSheet(); scheduleRender(); toast('Payment undone'); }
    };
    return;
  }
  const saved = byId('payroll', slipId(m, f.id)); const o = payOpts(saved);
  const extra = { earnings: (o.extra.earnings || []).slice(), deductions: (o.extra.deductions || []).slice() };
  const sh = openSheet({ title: 'Pay · ' + f.name + ' · ' + monthLabel(m), wide: true, body: '',
    foot: '<button class="btn" id="psDraft">Save draft</button><button class="btn grow" id="psPdf">' + ic('dl') + 'PDF</button><button class="btn pri grow" id="psPay">' + ic('check') + 'Mark as paid</button>' });
  const calc = () => KC.payslipDraft(K.raw, f, m, S(), { deductAbsences: o.deductAbsences, deductShortages: o.deductShortages, extra }, nowIso());
  const exRows = (k) => extra[k].map((x, i) => '<div class="ps-ex"><input class="inp" data-ex="' + k + '" data-i="' + i + '" data-f="label" value="' + esc(x.label || '') + '" placeholder="' + (k === 'earnings' ? 'Bonus, commission, transport…' : 'Loan, damage, other…') + '"><input class="inp price-in" inputmode="numeric" data-ex="' + k + '" data-i="' + i + '" data-f="amount" value="' + esc(x.amount || '') + '"><button type="button" class="btn ghost sm" data-exrm="' + k + '" data-i="' + i + '">' + ic('x', 'sm') + '</button></div>').join('');
  const draw = () => {
    const p = calc(); const x = p.stats;
    setSheetBody(sh, statChips([['Worked', p.payType === 'hourly' ? x.hours + ' h' : x.worked + ' / ' + x.scheduled + ' days'], ['Late', x.late, x.late ? 'warn' : ''], ['Absent', x.tracked ? x.absent : '—', x.absent && x.tracked ? 'bad' : ''], ['Leave', x.paidLeave + x.unpaidLeave + ' days'], ['Overtime', x.overtimeH + ' h']]) +
      (!x.tracked ? '<div class="alert mt small">No clock-ins this month — days worked and absences can\'t be counted from Attendance.</div>' : '') +
      '<div class="ps-grid mt"><div class="card pad"><h3 class="mb">Earnings</h3>' + slipLines(p.earnings.filter((e) => e.auto)) + '<div class="ps-exs" id="exE">' + exRows('earnings') + '</div><button type="button" class="btn sm mt" data-exadd="earnings">' + ic('plus', 'sm') + 'Bonus or other pay</button><div class="row between b cl mt"><span>Gross</span><span class="money">' + fmt(p.gross) + '</span></div></div>' +
      '<div class="card pad"><h3 class="mb">Deductions</h3>' + (p.deductions.filter((e) => e.auto).length ? slipLines(p.deductions.filter((e) => e.auto)) : '<div class="muted small">None</div>') + '<div class="ps-exs">' + exRows('deductions') + '</div><button type="button" class="btn sm mt" data-exadd="deductions">' + ic('plus', 'sm') + 'Other deduction</button>' +
      (p.payType === 'monthly' && x.absent && x.tracked ? '<label class="toggle mt"><input type="checkbox" id="psAbs"' + (o.deductAbsences ? ' checked' : '') + '>Deduct ' + x.absent + ' absent day' + (x.absent === 1 ? '' : 's') + ' (' + F(x.absent * p.dayRate) + ')</label>' : '') +
      (f.userId ? '<label class="toggle"><input type="checkbox" id="psShort"' + (o.deductShortages ? ' checked' : '') + '>Deduct confirmed cash shortages</label>' : '') +
      '<div class="row between b cl mt"><span>Total deductions</span><span class="money">' + fmt(p.deductionsTotal) + '</span></div></div></div>' +
      '<div class="card pad mt ps-net"><div class="row between"><span class="b">Net pay</span><b class="money big">' + F(p.net) + '</b></div></div>' +
      '<div class="grid2 mt">' + field('Paid by', sel('psMethod', ['Cash', 'MTN MoMo', 'Orange Money', 'Bank transfer'], (saved && saved.payMethod) || 'Cash')) + field('Payment date', '<input type="date" class="inp" name="psDate" value="' + todayStr() + '">') + '</div>');
  };
  draw();
  sh.addEventListener('change', (e) => {
    if (e.target.id === 'psAbs') { o.deductAbsences = e.target.checked; draw(); }
    if (e.target.id === 'psShort') { o.deductShortages = e.target.checked; draw(); }
    if (e.target.dataset.ex) { const it = extra[e.target.dataset.ex][e.target.dataset.i]; it[e.target.dataset.f] = e.target.dataset.f === 'amount' ? num(e.target.value) : e.target.value; draw(); }
  });
  sh.addEventListener('click', (e) => {
    const a = e.target.closest('[data-exadd]'), r = e.target.closest('[data-exrm]');
    if (a) { extra[a.dataset.exadd].push({ label: '', amount: '' }); draw(); const ins = $$('[data-ex="' + a.dataset.exadd + '"][data-f="label"]', sh); if (ins.length) ins[ins.length - 1].focus(); }
    if (r) { extra[r.dataset.exrm].splice(Number(r.dataset.i), 1); draw(); }
  });
  const record = (status, v) => Object.assign({}, saved || {}, calc(), { id: slipId(m, f.id), type: 'slip', status, opts: { deductAbsences: o.deductAbsences, deductShortages: o.deductShortages, extra }, payMethod: v.psMethod, updatedBy: K.me.name || '' });
  $('#psDraft', sh).onclick = async () => { if (await save('payroll', record('draft', formVals(sh)))) { closeSheet(); scheduleRender(); toast('Draft saved'); } };
  $('#psPdf', sh).onclick = () => payslipPDF(record(saved ? saved.status : 'draft', formVals(sh)));
  $('#psPay', sh).onclick = async () => {
    const v = formVals(sh); const p = calc();
    if (!(await confirmBox('Pay ' + f.name + ' ' + F(p.net) + ' for ' + monthLabel(m) + ' by ' + v.psMethod + '? It is recorded as a salary expense.', 'Mark as paid'))) return;
    const expId = uid('e_');
    const ok = await save('expenses', { id: expId, date: v.psDate || todayStr(), category: 'Salaries & wages', amount: p.net, method: v.psMethod, description: 'Salary ' + monthLabel(m) + ' — ' + f.name, stage: 'general', locationId: f.locationId || K.loc, by: K.me.name || '', byId: K.me.id || '', payrollId: slipId(m, f.id) });
    if (!ok) return;
    if (await save('payroll', Object.assign(record('paid', v), { paidAt: (v.psDate || todayStr()) + 'T' + new Date().toTimeString().slice(0, 8), paidBy: K.me.name || '', expenseId: expId }))) { closeSheet(); scheduleRender(); toast('Paid — ' + F(p.net) + ' recorded as a salary expense'); }
  };
}
function slipSummary(p) {
  return '<div class="ps-grid"><div class="card pad"><h3 class="mb">Earnings</h3>' + slipLines(p.earnings) + '<div class="row between b cl mt"><span>Gross</span><span class="money">' + fmt(p.gross) + '</span></div></div>' +
    '<div class="card pad"><h3 class="mb">Deductions</h3>' + (p.deductions.length ? slipLines(p.deductions) : '<div class="muted small">None</div>') + '<div class="row between b cl mt"><span>Total</span><span class="money">' + fmt(p.deductionsTotal) + '</span></div></div></div>' +
    '<div class="card pad mt ps-net"><div class="row between"><span class="b">Net pay</span><b class="money big">' + F(p.net) + '</b></div></div>';
}
function payslipPDF(p) {
  if (!window.jspdf) return toast('PDF library still loading — try again', true);
  const st = S(); const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a5' }); const W = 148; let y = 14; const f = staffFile(p.staffId) || {};
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(st.businessName || 'Payslip', 12, y);
  doc.setFontSize(11); doc.text('PAYSLIP', W - 12, y, { align: 'right' }); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); [st.address, st.phone].filter(Boolean).forEach((x) => { doc.text(String(x), 12, y); y += 4; });
  y += 3; doc.setDrawColor(200); doc.line(12, y, W - 12, y); y += 6;
  doc.setFontSize(9);
  const kv = (k, v, x) => { doc.setTextColor(120); doc.text(k, x, y); doc.setTextColor(20); doc.text(String(v || '—'), x + 26, y); };
  kv('Employee', p.staffName || f.name, 12); kv('Month', monthLabel(p.month), 80); y += 5;
  kv('Job', f.title, 12); kv('Pay', ({ monthly: 'Monthly', daily: 'Daily', hourly: 'Hourly' }[p.payType]) + ' · ' + fmt(p.rate), 80); y += 5;
  const x = p.stats || {}; kv('Worked', p.payType === 'hourly' ? x.hours + ' h' : (x.worked || 0) + ' of ' + (x.scheduled || 0) + ' days', 12); kv('Leave', (x.paidLeave || 0) + (x.unpaidLeave || 0) + ' days', 80); y += 8;
  const block = (title, list, total, label) => {
    doc.setFont('helvetica', 'bold'); doc.text(title, 12, y); y += 5; doc.setFont('helvetica', 'normal');
    (list.length ? list : [{ label: 'None', amount: 0 }]).forEach((l) => { doc.text(String(l.label).slice(0, 70), 14, y); doc.text(fmt(l.amount), W - 12, y, { align: 'right' }); y += 4.6; });
    doc.setDrawColor(220); doc.line(12, y - 2, W - 12, y - 2); y += 2; doc.setFont('helvetica', 'bold'); doc.text(label, 14, y); doc.text(fmt(total), W - 12, y, { align: 'right' }); doc.setFont('helvetica', 'normal'); y += 8;
  };
  block('Earnings', p.earnings || [], p.gross, 'Gross pay');
  block('Deductions', p.deductions || [], p.deductionsTotal, 'Total deductions');
  doc.setFillColor(240, 238, 232); doc.rect(12, y - 5, W - 24, 10, 'F'); doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text('NET PAY', 15, y + 1.5); doc.text(F(p.net), W - 15, y + 1.5, { align: 'right' }); y += 14;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
  doc.text(p.status === 'paid' ? 'Paid on ' + fmtDate(String(p.paidAt).slice(0, 10)) + (p.payMethod ? ' by ' + p.payMethod : '') : 'Draft — not paid yet', 12, y); y += 14;
  doc.setTextColor(20); doc.text('Employee signature', 12, y); doc.text('For ' + (st.businessName || 'the business'), W - 12, y, { align: 'right' });
  doc.save('Payslip-' + (p.staffName || 'staff').replace(/[^A-Za-z0-9]+/g, '-') + '-' + p.month + '.pdf');
}
/* advances: money given early, taken back from a month's pay */
A.advNew = () => advSheet(null);
A.advOpen = (el) => advSheet(byId('payroll', el.dataset.id));
function advSheet(a) {
  const ppl = roster().filter((f) => !f._new);
  if (!ppl.length) return toast('Add employees first (Employees)', true);
  const v0 = a || { date: todayStr(), method: 'Cash', deductMonth: monthStr() };
  const sh = openSheet({ title: a ? 'Advance · ' + (a.staffName || staffName(a.staffId)) : 'Give a salary advance', body: '<div class="col">' +
    field('Who', sel('aWho', ppl.map((f) => [f.id, f.name]), v0.staffId || '', a ? 'disabled' : '')) +
    '<div class="grid2">' + field('Amount (' + baseSym() + ')', inp('aAmount', v0.amount || '', 'inputmode="numeric"' + (a ? ' disabled' : ''))) + field('Date', '<input type="date" class="inp" name="aDate" value="' + esc(v0.date) + '"' + (a ? ' disabled' : '') + '>') + '</div>' +
    '<div class="grid2">' + field('Paid by', sel('aMethod', ['Cash', 'MTN MoMo', 'Orange Money', 'Bank transfer'], v0.method, a ? 'disabled' : '')) + field('Take it back from the pay of', '<input type="month" class="inp" name="aMonth" value="' + esc(v0.deductMonth || monthStr()) + '">') + '</div>' +
    field('Note', inp('aNote', v0.note || '', 'placeholder="e.g. school fees"')) + '<div class="tiny muted">Recorded as a salary expense now, and deducted automatically from that month\'s payslip.</div></div>',
    foot: (a ? '<button class="btn danger" id="aDel">Cancel advance</button>' : '') + '<button class="btn grow" data-a="sheetClose">Close</button><button class="btn pri grow" id="aSave">Save</button>' });
  $('#aSave', sh).onclick = async () => {
    const v = formVals(sh);
    if (a) { if (await save('payroll', Object.assign({}, a, { deductMonth: v.aMonth, note: v.aNote }))) { closeSheet(); scheduleRender(); } return; }
    const amount = num(v.aAmount); if (!amount) return toast('Enter the amount', true);
    const f = staffFile(v.aWho); const expId = uid('e_'); const id = uid('adv_');
    if (!(await save('expenses', { id: expId, date: v.aDate || todayStr(), category: 'Salaries & wages', amount, method: v.aMethod, description: 'Salary advance — ' + f.name + (v.aNote ? ' (' + v.aNote + ')' : ''), stage: 'general', locationId: f.locationId || K.loc, by: K.me.name || '', byId: K.me.id || '', payrollId: id }))) return;
    if (await save('payroll', { id, type: 'advance', staffId: f.id, staffName: f.name, date: v.aDate || todayStr(), amount, method: v.aMethod, deductMonth: v.aMonth || monthStr(), note: v.aNote, expenseId: expId, by: K.me.name || '' })) { closeSheet(); scheduleRender(); toast('Advance of ' + F(amount) + ' recorded'); }
  };
  if ($('#aDel', sh)) $('#aDel', sh).onclick = async () => {
    const slip = byId('payroll', slipId(a.deductMonth || a.date.slice(0, 7), a.staffId));
    if (slip && slip.status === 'paid') return toast('That month is already paid — undo the payslip first', true);
    if (!(await confirmBox('Cancel this advance? Its expense is removed.', 'Cancel advance', true))) return;
    if (a.expenseId && byId('expenses', a.expenseId)) await remove('expenses', a.expenseId);
    if (await save('payroll', Object.assign({}, a, { status: 'cancelled' }))) { closeSheet(); scheduleRender(); }
  };
}
A.payXlsx = () => {
  const m = K.ui.payMonth || monthStr();
  const rows = roster().filter((f) => !f._new && num((f.pay || {}).rate) > 0).map((f) => { const s = slipFor(f, m); return { Name: f.name, Job: f.title || '', Pay: payLabel(f.pay), 'Days worked': s.stats.worked, Hours: s.stats.hours, Late: s.stats.late, Absent: s.stats.absent, 'Leave days': s.stats.paidLeave + s.stats.unpaidLeave, Gross: s.gross, Deductions: s.deductionsTotal, 'Net pay': s.net, Status: s.status || 'not saved', 'Paid on': s.paidAt ? String(s.paidAt).slice(0, 10) : '' }; });
  xlsxDownload('Payroll-' + m + '.xlsx', { Payroll: rows });
};
