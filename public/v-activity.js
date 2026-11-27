/* Aahsso — Activity log: who did what, where, when and why */
const ACT_RANGES = [['today', 'Today'], ['yday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days'], ['custom', 'Pick dates']];
function actRange() {
  const t = todayStr(), k = K.ui.actR || 'today';
  if (k === 'today') return [t, t]; if (k === 'yday') { const y = KC.addDays(t, -1); return [y, y]; }
  if (k === '7d') return [KC.addDays(t, -6), t]; if (k === '30d') return [KC.addDays(t, -29), t];
  return [K.ui.actFrom || KC.addDays(t, -6), K.ui.actTo || t];
}
async function loadActivity(from, to) {
  if (K.info.mode === 'saas') { const r = await K.store.req('GET', '/api/activity?from=' + from + '&to=' + to); return r.entries; }
  const ids = can('activity') ? Array.from(new Set([K.me.id, K.raw.settings.ownerId].concat(K.raw.members.map((m) => m.id)).filter(Boolean))) : [K.me.id];
  const all = [];
  for (const uidv of ids) { try { (await K.store.query(logPath(uidv), from, to)).forEach((d) => (d.entries || []).forEach((e) => all.push(e))); } catch (e) { console.warn('activity', uidv, e); } }
  // entries made on this phone but not uploaded yet
  K.outbox.filter((o) => String(o.col).startsWith('log/') && o.data).forEach((o) => (o.data.entries || []).forEach((e) => { const d = e.at.slice(0, 10); if (d >= from && d <= to && !all.find((x) => x.at === e.at && x.text === e.text)) all.push(e); }));
  return all;
}
VIEWS.activity = {
  render() {
    const [from, to] = actRange();
    const key = from + '|' + to;
    if (K._actKey !== key && !K._actLoading) {
      K._actLoading = true;
      loadActivity(from, to).then((e) => { K._act = e; K._actKey = key; }).catch((e) => { K._act = []; K._actKey = key; toast('Could not load the activity log: ' + (e.message || e.code), true); }).finally(() => { K._actLoading = false; if (K.route === 'activity') render(true); });
    }
    const all = (K._actKey === key ? K._act : null);
    const q = (K.ui.actQ || '').toLowerCase(), who = K.ui.actWho || '', where = K.ui.actLoc || '', type = K.ui.actType || '';
    const people = all ? Array.from(new Map(all.map((e) => [e.uid || e.user, e.user])).entries()) : [];
    const list = (all || []).filter((e) => (!who || (e.uid || e.user) === who) && (!where || (e.loc || 'main') === where) && (!type || e.type === type) && (!q || (e.text + ' ' + (e.reason || '') + ' ' + (e.ref || '') + ' ' + e.user).toLowerCase().includes(q)))
      .sort((a, b) => b.at.localeCompare(a.at));
    const types = Array.from(new Set(Object.values(KC.ACT_TYPES)));
    const days = {}; list.forEach((e) => { const d = todayStr(new Date(e.at)); (days[d] = days[d] || []).push(e); });
    K._actRows = list;
    return '<div class="alert info mb">' + ic('clock', 'sm') + '<div>Every change in the app, in plain words: <b>who</b> did it, <b>what</b>, <b>where</b> (branch), <b>when</b> and <b>why</b>.' + (K.info.mode === 'saas' ? ' Kept by the server; nobody can change it.' : ' Each person can only write their own history.') + (can('activity') ? '' : ' You are seeing your own activity only.') + '</div></div>' +
      '<div class="seg mb">' + ACT_RANGES.map(([k, l]) => '<button class="' + ((K.ui.actR || 'today') === k ? 'on' : '') + '" data-a="actR" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      (K.ui.actR === 'custom' ? '<div class="row wrap mb"><input type="date" class="inp" style="width:auto" data-c="actFrom" value="' + from + '"><span>to</span><input type="date" class="inp" style="width:auto" data-c="actTo" value="' + to + '"></div>' : '') +
      '<div class="row wrap mb">' + (can('activity') ? '<select class="inp" style="width:auto" data-c="actWho"><option value="">Everyone</option>' + people.map(([id, n]) => '<option value="' + esc(id) + '"' + (who === id ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>' : '') +
      (allLocs().length > 1 ? '<select class="inp" style="width:auto" data-c="actLoc"><option value="">All branches</option>' + allLocs().map((l) => '<option value="' + l.id + '"' + (where === l.id ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select>' : '') +
      '<select class="inp" style="width:auto" data-c="actType"><option value="">Everything</option>' + types.map((t) => '<option' + (type === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>' +
      (can('export') ? '<button class="btn" data-a="actXlsx">' + ic('dl') + 'Excel</button>' : '') + '</div>' +
      '<div class="search mb">' + ic('search') + '<input class="inp" placeholder="Search: receipt no., item, customer, reason…" value="' + esc(K.ui.actQ || '') + '" data-c="actQ"></div>' +
      (!all ? LOADER : !list.length ? '<div class="card empty"><div class="big">🗒️</div>Nothing recorded for this period.</div>' :
        actTable(list));
  },
};
const ACT_ICON = { Sales: 'sell', Payments: 'wallet', Purchases: 'buy', 'Items & prices': 'tag', Containers: 'ship', 'Stock & losses': 'alert', Transfers: 'ship', 'Stock counts': 'check', Customers: 'users', 'Cash handover': 'wallet', 'Suppliers & bills': 'buy', Expenses: 'wallet', 'Settings & team': 'gear', Reminders: 'wa', Staff: 'users', Attendance: 'clock', Leave: 'clock', Payroll: 'wallet' };
function actRow(e, idx) {
  const t = new Date(e.at); const time = pad2(t.getHours()) + ':' + pad2(t.getMinutes());
  const warn = /Cancelled|Deleted|Removed|missing|short|theft|Unaccounted|written off|Refunded/i.test(e.text + ' ' + (e.reason || ''));
  return '<div class="li" data-a="actOpen" data-i="' + idx + '" style="align-items:flex-start"><div style="width:42px;flex:none" class="tiny b muted">' + time + '</div><div class="av' + (warn ? ' acc' : '') + '" style="width:34px;height:34px">' + ic(ACT_ICON[e.type] || 'clock', 'sm') + '</div><div class="grow" style="min-width:0"><div class="small"><b>' + esc(e.user || '—') + '</b> <span class="faint tiny">' + esc(e.role || '') + '</span></div><div style="margin-top:2px">' + esc(e.text) + '</div>' +
    '<div class="row wrap gap4" style="margin-top:5px">' + (allLocs().length > 1 || (e.loc && e.loc !== 'main') ? '<span class="badge">' + ic('home', 'sm') + esc(locName(e.loc)) + '</span>' : '') + (e.reason ? '<span class="badge warn">Why: ' + esc(e.reason) + '</span>' : '') + (e.offline ? '<span class="badge info">made offline</span>' : '') + '<span class="badge">' + esc(e.type) + '</span></div></div></div>';
}
A.actR = (el) => { K.ui.actR = el.dataset.v; render(true); };
['actFrom', 'actTo', 'actWho', 'actLoc', 'actType', 'actQ'].forEach((k) => (CH[k] = (el) => { K.ui[k] = el.value; render(true); }));
A.actFor = (el) => { K.ui.actQ = el.dataset.q; K.ui.actR = '30d'; K.ui.actWho = ''; K.ui.actLoc = ''; K.ui.actType = ''; while (K.sheets.length) closeSheet(); go('activity'); };
A.actOpen = (el) => {
  const e = K._actRows[+el.dataset.i]; if (!e) return;
  const row = (l, v) => v ? '<div class="row between cl"><span class="muted">' + l + '</span><span class="b right" style="max-width:65%">' + esc(v) + '</span></div>' : '';
  openSheet({ title: e.type, body: '<div class="card pad"><div class="b mb" style="font-size:14px">' + esc(e.text) + '</div>' + row('Who', (e.user || '') + (e.role ? ' (' + e.role + ')' : '')) + row('When', new Date(e.at).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'medium' })) + row('Where', locName(e.loc)) + row('Why', e.reason) + row('Reference', e.ref) + (e.amount ? row('Amount', F(e.amount)) : '') + row('Made offline', e.offline ? 'Yes — synced later' : '') + row('Device', e.device) + row('Record', (e.col || '') + ' · ' + (e.id || '')) + '</div>' +
    (e.ref ? '<button class="btn block mt" data-a="actFor" data-q="' + esc(e.ref) + '">' + ic('clock') + 'Everything about ' + esc(e.ref) + '</button>' : '') });
};
A.actXlsx = () => xlsxDownload('Activity-' + actRange().join('_') + '.xlsx', { Activity: (K._actRows || []).map((e) => ({ Date: todayStr(new Date(e.at)), Time: new Date(e.at).toLocaleTimeString('en-GB'), Who: e.user, Role: e.role, Branch: locName(e.loc), Type: e.type, What: e.text, Why: e.reason || '', Reference: e.ref || '', 'Amount': e.amount || '', Offline: e.offline ? 'yes' : '' })) });

function actTable(list) {
  const time = (e) => { const t = new Date(e.at); return pad2(t.getHours()) + ':' + pad2(t.getMinutes()); };
  const warn = (e) => /Cancelled|Deleted|Removed|missing|short|theft|Unaccounted|written off|Refunded/i.test(e.text + ' ' + (e.reason || ''));
  return dataTable({
    id: 'actList', rows: list, noun: 'action', limit: 500,
    rowAttr: (e) => ' data-a="actOpen" data-i="' + list.indexOf(e) + '"',
    cols: [
      { k: 'date', label: 'Date', core: true, v: (e) => e.at, html: (e) => dtDate(todayStr(new Date(e.at))) },
      { k: 'time', label: 'Time', core: true, v: (e) => e.at, html: (e) => '<span class="mut">' + time(e) + '</span>' },
      { k: 'who', label: 'Who', core: true, v: (e) => e.user || '', html: (e) => '<b>' + esc(e.user || '—') + '</b>' },
      { k: 'role', label: 'Role', v: (e) => e.role || '', cls: 'mut' },
      { k: 'type', label: 'Type', core: true, v: (e) => e.type || '', html: (e) => '<span class="badge' + (warn(e) ? ' warn' : '') + '">' + esc(e.type || '') + '</span>' },
      { k: 'what', label: 'What happened', core: true, wrap: true, v: (e) => e.text || '' },
      { k: 'why', label: 'Why', core: true, wrap: true, v: (e) => e.reason || '' },
      { k: 'loc', label: 'Branch', v: (e) => locName(e.loc || 'main'), cls: 'mut' },
      { k: 'ref', label: 'Reference', v: (e) => e.ref || '', cls: 'mut' },
      { k: 'off', label: 'Made offline', v: (e) => e.offline ? 'Yes' : '' },
    ],
  });
}
