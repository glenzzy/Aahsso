/* Aahsso — Team & access: roles, per-person permissions, approvals */
/** permissions of features this business has (Aahsso Store has no containers; a plan can switch features off) */
const teamPerms = () => KC.PERMS.filter(([k]) => KC.permFeatureOn(K.info && K.info.features, k));
const ROLES_NOW = () => KC.rolesWith(S().roles);
const RESTO_ROLES = ['resto_waiter', 'resto_cashier', 'resto_kitchen'];
const roleFits = (k) => !RESTO_ROLES.includes(k) || (K.info && K.info.edition === 'resto');
const ROLE_OPTS = () => Object.entries(has('customRoles') ? ROLES_NOW() : KC.ROLES).filter(([k]) => k !== 'owner' && roleFits(k)).map(([k, r]) => [k, r.label]); // custom roles only in plans that include them
const ROLE_HELP = {
  admin: 'Everything, including settings and team.',
  manager: 'Runs the business day to day: purchases, containers, stock, prices, reports, expenses. No team or settings.',
  sales: 'Sells, takes payments, adds customers, sees stock. Sees only their own sales. No costs or profit.',
  viewer: 'Can look at stock, sales and reports. Cannot change anything.',
};
function permSummary(m) { const p = KC.permsFor(m, S().roles); return teamPerms().filter(([k]) => p[k]).length + ' of ' + teamPerms().length + ' permissions'; }

VIEWS.team = {
  render() {
    if (K.info.mode === 'local') return '<div class="card pad2"><h2>Team</h2><p class="muted">Team access needs the online version of the app.</p></div>';
    if (K.info.mode === 'saas') { setTimeout(loadSaasTeam, 0); return '<div id="saasTeam">' + LOADER + '</div>'; }
    const members = K.raw.members.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const memberIds = new Set(members.map((m) => m.id));
    const reqs = K.raw.requests.filter((r) => !memberIds.has(r.id)).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    if (K.info.mode === 'local') return '<div class="alert info">' + ic('key', 'sm') + '<div><b>Preview mode:</b> data is kept in this browser only, so there is no team here. Run the server build (see START-HERE.md) to add staff with their own logins and roles.</div></div>';
    return '<div class="alert info mb">' + ic('key', 'sm') + '<div><b>How to add someone:</b> share this app from its claude.ai page, then they open the link and tap <b>Request access</b>. Their request appears here; choose their role and approve.</div></div>' +
      (reqs.length ? '<h2 class="mb">Waiting for approval (' + reqs.length + ')</h2><div class="card list mb">' + reqs.map((r) => '<div class="li" style="cursor:default"><div class="av acc">' + esc(initials(r.name || '?')) + '</div><div class="grow"><div class="t">' + esc(r.name || 'Unnamed person') + '</div><div class="tiny muted">Requested ' + fmtDT(r.at) + '</div></div><button class="btn sm" data-a="reqDismiss" data-id="' + r.id + '">Dismiss</button><button class="btn sm pri" data-a="reqApprove" data-id="' + r.id + '">Approve</button></div>').join('') + '</div>' : '') +
      '<h2 class="mb">Team</h2><div class="card list mb"><div class="li" style="cursor:default"><div class="av">' + esc(initials(K.info.isOwner ? K.me.name || 'Owner' : 'Owner')) + '</div><div class="grow"><div class="t">' + (K.info.isOwner ? esc(K.me.name || 'You') + ' (you)' : 'Business owner') + '</div><div class="tiny muted">Owner · full access</div></div></div>' +
      '</div>' + teamTable(members) +
      roleTable();
  },
};
function roleTable() {
  const roles = Object.entries(ROLES_NOW()).filter(([k]) => k !== 'owner' && roleFits(k));
  return '<h2 class="mb mt2">What each role can do</h2><div class="card tw"><table class="t"><thead><tr><th>Permission</th>' + roles.map(([, r]) => '<th class="center">' + esc(r.label.split(' ')[0]) + '</th>').join('') + '</tr></thead><tbody>' +
    teamPerms().map(([k, l]) => '<tr><td>' + esc(l) + '</td>' + roles.map(([, r]) => '<td class="center">' + (r.perms.includes(k) ? '<span style="color:var(--ok)">✓</span>' : '<span class="faint">—</span>') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div><div class="tiny muted mt">Change what a whole role can do with <b>Edit roles</b>, or switch a permission on/off for one person by tapping their name.</div>' +
    (can('team') && can('settings') ? '<div class="row wrap mt"><button class="btn" data-a="roleEdit">' + ic('plus') + 'New role</button>' + roles.map(([k, r]) => '<button class="btn sm" data-a="roleEdit" data-k="' + k + '">' + ic('edit', 'sm') + esc(r.label) + '</button>').join('') + '</div>' : '');
}
/** Sheet to edit a person's role & permissions. onSave(result) gets {name, role, perms, active}. */
function memberSheet(m, title, onSave, onRemove) {
  const sh = openSheet({ title, body: '', foot: (onRemove ? '<button class="btn danger" id="mRm">' + ic('trash') + '</button>' : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="mSave">Save</button>' });
  let role = m.role || 'sales'; let over = Object.assign({}, m.perms || {});
  const keep = () => { const v = formVals(sh); m = Object.assign({}, m, { name: v.mName, login: m.id ? m.login : v.mLogin, email: v.mEmail, mSend: v.mSend, _pass: v.mPass, locationId: v.mLoc || m.locationId }); };
  const draw = () => {
    const eff = KC.permsFor({ role, perms: over }, S().roles);
    const groups = {}; teamPerms().forEach(([k, l, g]) => (groups[g] = groups[g] || []).push([k, l]));
    setSheetBody(sh, '<div class="col">' + field('Name', inp('mName', m.name || '')) + (m.login !== undefined ? field('Login (email or phone)', inp('mLogin', m.login || '', m.id ? 'disabled' : '')) + (m.id ? field('New password (optional)', inp('mPass', m._pass || '', 'type="text" placeholder="Leave empty to keep"')) : field('Password', inp('mPass', m._pass || '', 'type="text"'))) +
        field('Email (optional)', inp('mEmail', m.email || '', 'type="email" inputmode="email" placeholder="Only needed if the login is a phone number"')) +
        '<label class="toggle"><input type="checkbox" name="mSend"' + (m.mSend === false ? '' : ' checked') + '>' + (m.id ? 'Email them the new password (if you set one)' : 'Email them their login and password') + '</label>' : '') +
      (allLocs().length > 1 ? field('Works at', sel('mLoc', allLocs().map((l) => [l.id, l.name]), m.locationId || 'main')) : '') +
      field('Role', sel('mRole', ROLE_OPTS(), role, 'id="mRole"')) + '<div class="tiny muted" style="margin-top:-4px">' + esc(ROLE_HELP[role] || '') + '</div>' +
      '<div class="card pad member-perms"><div class="row between mb"><h3>Permissions</h3>' + (Object.keys(over).length ? '<button class="btn sm ghost" id="mReset">Reset to role</button>' : '') + '</div>' +
      Object.entries(groups).map(([g, ps]) => '<div class="tiny b faint" style="text-transform:uppercase;letter-spacing:.05em;margin-top:8px">' + g + '</div><div class="perm-grid">' + ps.map(([k, l]) => '<label><input type="checkbox" data-perm="' + k + '"' + (eff[k] ? ' checked' : '') + '>' + esc(l) + (k in over ? ' <span class="badge acc">custom</span>' : '') + '</label>').join('') + '</div>').join('') + '</div>' +
      '<label class="toggle"><input type="checkbox" name="mActive"' + (m.active === false ? '' : ' checked') + '>Active (can use the app)</label></div>');
    $('#mRole', sh).onchange = (e) => { keep(); role = e.target.value; over = {}; draw(); };
    if ($('#mReset', sh)) $('#mReset', sh).onclick = () => { over = {}; draw(); };
    $$('[data-perm]', sh).forEach((c) => (c.onchange = () => { const base = KC.permsFor({ role }, S().roles); const k = c.dataset.perm; if (c.checked === base[k]) delete over[k]; else over[k] = c.checked; draw(); }));
  };
  draw();
  $('#mSave', sh).onclick = async (e) => { const v = formVals(sh); e.target.disabled = true; const ok = await onSave({ name: v.mName, login: v.mLogin, password: v.mPass, email: v.mEmail, sendEmail: v.mSend, role, perms: over, active: v.mActive, locationId: v.mLoc || m.locationId || 'main' }); e.target.disabled = false; if (ok !== false) closeSheet(); };
  if (onRemove) $('#mRm', sh).onclick = async () => { if (await confirmBox('Remove ' + (m.name || 'this person') + ' from the team?', 'Remove', true)) { await onRemove(); closeSheet(); } };
}
A.reqApprove = (el) => {
  const r = K.raw.requests.find((x) => x.id === el.dataset.id);
  memberSheet({ id: r.id, name: r.name, role: 'sales' }, 'Approve ' + (r.name || 'person'), async (v) => {
    const ok = await save('members', { id: r.id, name: v.name || r.name || 'Team member', role: v.role, perms: v.perms, active: v.active, locationId: v.locationId, approvedAt: new Date().toISOString(), approvedBy: K.me.name || '' });
    if (ok) { try { await K.store.del('requests', r.id); } catch (e) { } toast('Access granted'); scheduleRender(); }
    return ok;
  });
};
A.reqDismiss = async (el) => { try { await K.store.del('requests', el.dataset.id); K.raw.requests = K.raw.requests.filter((x) => x.id !== el.dataset.id); render(true); } catch (e) { toast('Could not dismiss', true); } };
A.memberEdit = (el) => {
  const m = K.raw.members.find((x) => x.id === el.dataset.id);
  memberSheet(m, 'Edit ' + (m.name || 'member'), async (v) => { const ok = await save('members', Object.assign({}, m, { name: v.name || m.name, role: v.role, perms: v.perms, active: v.active, locationId: v.locationId })); if (ok) { toast('Saved'); scheduleRender(); } return ok; },
    async () => { await remove('members', m.id); scheduleRender(); });
};

/* SaaS server team */
function drawSaasTeam() {
  const box = $('#saasTeam'); if (!box || !K._users) return;
  box.innerHTML = '<div class="row wrap mb"><button class="btn pri" data-a="saasAdd">' + ic('plus') + 'Add team member</button></div><div class="mb">' + teamTable(K._users, { action: 'saasEdit' }) + '</div>' + roleTable();
}
DT_REDRAW.teamList = () => (K.info.mode === 'saas' ? drawSaasTeam() : render(true));
async function loadSaasTeam() {
  const box = $('#saasTeam'); if (!box) return;
  try {
    const r = await K.store.req('GET', '/api/users'); K._users = r.users;
    drawSaasTeam();
  } catch (e) { box.innerHTML = '<div class="alert bad">' + esc(e.message) + '</div>'; }
}
A.saasAdd = () => memberSheet({ role: 'sales', login: '' }, 'Add team member', async (v) => {
  if (!v.name || !v.login || !v.password) { toast('Name, login and password are required', true); return false; }
  try { const r = await K.store.req('POST', '/api/users', { name: v.name, login: v.login, password: v.password, email: v.email, sendEmail: !!v.sendEmail, role: v.role, perms: v.perms, locationId: v.locationId }); emailToast('Added', r.email, 'their login and password'); loadSaasTeam(); }
  catch (e) { toast(e.message, true); return false; }
});
/** Tell the owner whether the login email went out. */
function emailToast(what, e, thing) {
  const st = e && e.status;
  if (st === 'sent' || st === 'duplicate') return toast(what + ' — ' + thing + ' emailed to ' + e.to);
  if (st === 'skipped') return toast(what + ' — email is not set up on the server yet, so give them ' + thing + ' yourself', true);
  if (st === 'failed') return toast(what + ', but the email failed (' + (e.error || 'unknown error') + ') — give them ' + thing + ' yourself', true);
  if (st === 'no_email') return toast(what + ' — add an email address to send ' + thing + ' by email. Give it to them yourself for now.');
  toast(what + (thing === 'their login and password' ? ' — give them their login and password' : ''));
}
A.saasEdit = (el) => {
  const u = K._users.find((x) => x.id === el.dataset.id);
  memberSheet(Object.assign({}, u, { login: u.login }), 'Edit ' + u.name, async (v) => {
    try { const r = await K.store.req('PATCH', '/api/users/' + u.id, { name: v.name, role: v.role, perms: v.perms, active: v.active, locationId: v.locationId, password: v.password || undefined, email: v.email, sendEmail: !!v.sendEmail }); emailToast('Saved', r.email, 'the new password'); loadSaasTeam(); }
    catch (e) { toast(e.message, true); return false; }
  });
};

A.roleEdit = (el) => {
  const key = el.dataset.k; const R = ROLES_NOW(); const r = key ? R[key] : { label: '', perms: KC.ROLES.sales.perms.slice() };
  const builtIn = key && KC.ROLES[key]; const used = key ? K.raw.members.filter((m) => m.role === key).length : 0;
  let perms = new Set(r.perms);
  const sh = openSheet({ title: key ? 'Edit role: ' + r.label : 'New role', body: '', foot: (key ? (builtIn ? '<button class="btn" id="rlReset">Reset to default</button>' : '<button class="btn danger" id="rlDel">' + ic('trash') + '</button>') : '') + '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="rlSave">Save role</button>' });
  const groups = {}; teamPerms().forEach(([k, l, g]) => (groups[g] = groups[g] || []).push([k, l]));
  setSheetBody(sh, '<div class="col">' + field('Role name', inp('rlName', r.label, 'placeholder="e.g. Cashier, Store keeper, Branch manager"')) + (used ? '<div class="tiny muted">' + used + ' person(s) have this role — changes apply to them at once (except their personal on/off switches).</div>' : '') +
    '<div class="card pad">' + Object.entries(groups).map(([g, ps]) => '<div class="tiny b faint" style="text-transform:uppercase;letter-spacing:.05em;margin-top:8px">' + g + '</div><div class="perm-grid">' + ps.map(([k, l]) => '<label><input type="checkbox" data-rp="' + k + '"' + (perms.has(k) ? ' checked' : '') + '>' + esc(l) + '</label>').join('') + '</div>').join('') + '</div></div>');
  const write = async (rolesObj) => { const ok = await saveSettings({ roles: rolesObj }); if (ok) { resolveAccess(); closeSheet(); render(true); toast('Roles saved'); } };
  // how much stock this role may see
  const capNow = r.stockCap === undefined || r.stockCap === null || r.stockCap === '' ? 'all' : r.stockCap === 'hide' ? 'hide' : 'cap';
  $('.col', sh).insertAdjacentHTML('beforeend', '<div class="card pad"><div class="b small mb">Stock this role can see</div><div class="seg" id="rlCapSeg">' + [['all', 'Full counts'], ['cap', 'Up to a number'], ['hide', 'No numbers']].map(([k, l]) => '<button type="button" data-cap="' + k + '" class="' + (capNow === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
    '<div class="row mt' + (capNow === 'cap' ? '' : ' hide') + '" id="rlCapN" style="align-items:center;gap:8px"><span class="small">Show at most</span>' + inp('rlCap', capNow === 'cap' ? r.stockCap : 30, 'inputmode="numeric" style="width:90px"') + '<span class="small">— e.g. 1,000 bottles show as “30+”</span></div>' +
    '<p class="hint mt">People with this role see stock counts this way on the POS, when selling and in the stock list. The owner always sees everything.</p></div>');
  let capMode = capNow; sh.addEventListener('click', (e) => { const b = e.target.closest('[data-cap]'); if (!b) return; capMode = b.dataset.cap; $$('[data-cap]', sh).forEach((x) => x.classList.toggle('on', x === b)); $('#rlCapN', sh).classList.toggle('hide', capMode !== 'cap'); });
  const capVal = () => capMode === 'hide' ? 'hide' : capMode === 'cap' ? Math.max(1, Math.round(num(formVals(sh).rlCap)) || 30) : '';
  $('#rlSave', sh).onclick = async () => {
    const name = formVals(sh).rlName; if (!name) return toast('Give the role a name', true);
    const ps = $$('[data-rp]', sh).filter((c) => c.checked).map((c) => c.dataset.rp);
    const k = key || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || uid('role_');
    if (!key && R[k]) return toast('A role with this name already exists', true);
    const rr = { label: name, perms: ps, v: 3 }; const cv = capVal(); if (cv !== '') rr.stockCap = cv;
    await write(Object.assign({}, S().roles || {}, { [k]: rr }));
  };
  if ($('#rlReset', sh)) $('#rlReset', sh).onclick = async () => { const o = Object.assign({}, S().roles || {}); delete o[key]; await write(o); };
  if ($('#rlDel', sh)) $('#rlDel', sh).onclick = async () => { if (used) return toast('Move its ' + used + ' person(s) to another role first', true); if (!(await confirmBox('Delete the role "' + r.label + '"?', 'Delete', true))) return; const o = Object.assign({}, S().roles || {}); delete o[key]; await write(o); };
};

function teamTable(members, opts = {}) {
  const action = opts.action || 'memberEdit';
  return dataTable({
    id: 'teamList', rows: members, noun: 'team member', empty: 'No team members yet.',
    rowAttr: (m) => m.role === 'owner' ? '' : ' data-a="' + action + '" data-id="' + m.id + '"', rowClass: (m) => m.active === false ? 'cx' : '',
    cols: [
      { k: 'name', label: 'Name', core: true, v: (m) => m.name || '', html: (m) => '<b>' + esc(m.name || 'Team member') + '</b>' + (m.id === K.me.id ? ' <span class="mut">(you)</span>' : '') },
      { k: 'login', label: 'Login', core: true, v: (m) => m.login || m.email || '', cls: 'mut' },
      { k: 'email', label: 'Email', v: (m) => (m.email && m.email !== m.login ? m.email : ''), cls: 'mut' },
      { k: 'role', label: 'Role', core: true, v: (m) => (ROLES_NOW()[m.role] || {}).label || m.role || '' },
      { k: 'custom', label: 'Custom rights', v: (m) => m.perms && Object.keys(m.perms).length ? 'Yes' : '' },
      { k: 'perms', label: 'Permissions', core: true, v: (m) => m.role === 'owner' ? 'Full access' : permSummary(m) },
      { k: 'loc', label: 'Branch', core: true, v: (m) => (m.locationId || m.location_id) ? locName(m.locationId || m.location_id) : 'All branches' },
      { k: 'seen', label: 'Last seen', v: (m) => m.last_login_at || '', html: (m) => m.last_login_at ? esc(fmtDT(m.last_login_at)) : dtNil },
      { k: 'status', label: 'Status', core: true, v: (m) => m.active === false ? 'Disabled' : 'Active', html: (m) => m.active === false ? '<span class="badge bad">Disabled</span>' : '<span class="badge ok">Active</span>' },
    ],
  });
}
