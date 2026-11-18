/* Aahsso — your account: avatar menu (top right), Profile, Billing & subscription, Help & support */

/* ================= avatar + dropdown ================= */
const canBilling = () => ['owner', 'admin'].includes((K.info.user || {}).role) || (K.info.mode === 'saas' && can('settings'));
const myName = () => K.me.name || K.info.userLabel || 'Me';
const AV_COLORS = 6;
const avColor = (s) => { let h = 0; for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % AV_COLORS; };
const avatarHTML = (name, size) => '<span class="uav uav-c' + avColor(name) + (size ? ' uav-' + size : '') + '" aria-hidden="true">' + esc(initials(name)) + '</span>';
const planName = (p) => ({ trial: 'Free trial', starter: 'Starter', business: 'Business', enterprise: 'Enterprise' })[p] || (p ? p[0].toUpperCase() + p.slice(1) : '');
/** Subscription in plain words: {label, days, tone, ended} */
function subState() {
  const sb = (K._bill && K._bill.subscription) || K.info.subscription;
  if (sb) {
    const d = (x) => (x ? Math.ceil((new Date(x).getTime() - Date.now()) / 864e5) : null);
    if (sb.status === 'trialing') { const n = d(sb.trialEndsAt); return { label: n === null ? 'Free trial' : 'Trial · ' + n + ' day' + (n === 1 ? '' : 's') + ' left', tone: n !== null && n <= 7 ? 'warn' : 'info', days: n }; }
    if (sb.status === 'active') { const n = d(sb.periodEnd); return { label: (sb.planName || 'Active') + (n !== null && n <= 14 ? ' · renews in ' + n + ' day' + (n === 1 ? '' : 's') : ''), tone: n !== null && n <= 7 ? 'warn' : 'ok', days: n }; }
    return { label: sb.statusLabel || sb.status, tone: sb.status === 'cancelled' ? 'warn' : 'bad', ended: ['expired', 'suspended'].includes(sb.status) };
  }
  const t = K.info.tenant || {}; const now = Date.now();
  const left = (d) => d ? Math.ceil((new Date(d).getTime() - now) / 864e5) : null;
  if (t.status === 'suspended') return { label: 'Suspended', tone: 'bad', ended: true };
  if (t.plan === 'trial') { const d = left(t.trialEndsAt); if (d !== null && d <= 0) return { label: 'Trial ended', tone: 'bad', ended: true, days: 0 }; return { label: d === null ? 'Free trial' : 'Trial · ' + d + ' day' + (d === 1 ? '' : 's') + ' left', tone: d !== null && d <= 7 ? 'warn' : 'info', days: d }; }
  const d = left(t.paidUntil);
  if (d !== null && d < -7) return { label: 'Subscription ended', tone: 'bad', ended: true, days: d };
  if (d !== null && d < 0) return { label: 'Payment overdue', tone: 'bad', days: d };
  return { label: planName(t.plan) + (d !== null && d <= 14 ? ' · renews in ' + d + ' day' + (d === 1 ? '' : 's') : ''), tone: d !== null && d <= 7 ? 'warn' : 'ok', days: d };
}
/** the current plan, one line: "Starter · Free trial · 4 days left" */
function planLine() {
  const sb = (K._bill && K._bill.subscription) || K.info.subscription; if (!sb) return '';
  const st = subState(); const name = sb.planName || (sb.status === 'trialing' ? 'Free trial' : 'No plan');
  const left = sb.status === 'trialing' && sb.trialEndsAt ? Math.max(0, Math.ceil((new Date(sb.trialEndsAt).getTime() - Date.now()) / 864e5)) : null;
  const tag = sb.status === 'trialing' ? (sb.planName ? 'Free trial · ' : '') + left + ' day' + (left === 1 ? '' : 's') + ' left' : sb.status === 'active' ? 'Active' : (sb.statusLabel || sb.status);
  return '<div class="pm-plan" role="note"><span class="pm-plan-l">Current plan</span><span class="pm-plan-v"><b>' + esc(name) + '</b> <span class="badge ' + st.tone + '">' + esc(tag) + '</span></span></div>';
}
function drawAvatar() {
  const box = document.getElementById('pmenu'); if (!box) return;
  const name = myName();
  const open = !!document.getElementById('pmPop');
  box.innerHTML = '<button type="button" class="pm-btn" id="pmBtn" aria-haspopup="menu" aria-expanded="' + open + '" aria-controls="pmPop" aria-label="Account menu for ' + esc(name) + '" title="' + esc(name) + '">' + avatarHTML(name) + '</button>';
}
function openPMenu() {
  closePMenu(); const btn = document.getElementById('pmBtn'); if (!btn) return;
  const name = myName(); const u = K.info.user || {}; const saas = K.info.mode === 'saas';
  const sub = saas && canBilling() ? subState() : null;
  const role = K.member ? roleLabel() : 'Waiting for access';
  const item = (href, icon, label, extra) => '<a role="menuitem" tabindex="-1" class="pm-item" href="' + href + '">' + ic(icon) + '<span class="grow">' + label + '</span>' + (extra || '') + '</a>';
  const pop = document.createElement('div');
  pop.id = 'pmPop'; pop.className = 'pm-pop'; pop.setAttribute('role', 'menu'); pop.setAttribute('aria-label', 'Account');
  pop.innerHTML = '<div class="pm-head">' + avatarHTML(name, 'lg') + '<div class="grow" style="min-width:0"><div class="pm-n">' + esc(name) + '</div><div class="pm-s">' + esc(role) + ' · ' + esc(S().businessName || '') + '</div>' + (u.email || u.login ? '<div class="pm-s ellipsis">' + esc(u.email || u.login) + '</div>' : '') + '</div></div>' + (saas ? planLine() : '') +
    (bizCan() ? '<div class="pm-list pm-biz"><div class="pm-sec">Your businesses</div>' + bizRows('pm-item', 'menuitem') + '</div>' : '') +
    '<div class="pm-list">' + item('#profile', 'user', 'Profile') +
      (saas && canBilling() ? item('#billing', 'card', 'Billing & subscription') : '') +
      item('#help', 'help', 'Help & support') + '</div>' +
    (saas ? '<div class="pm-list pm-foot"><button type="button" role="menuitem" tabindex="-1" class="pm-item pm-out" data-a="logoutAsk">' + ic('logout') + '<span class="grow">Log out</span></button></div>' : '');
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  pop.style.top = Math.round(r.bottom + 8) + 'px';
  pop.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
  btn.setAttribute('aria-expanded', 'true');
  const first = pop.querySelector('[role=menuitem]'); if (first) first.focus();
}
function closePMenu(focusBtn) {
  const pop = document.getElementById('pmPop'); if (!pop) return;
  pop.remove(); const btn = document.getElementById('pmBtn');
  if (btn) { btn.setAttribute('aria-expanded', 'false'); if (focusBtn) btn.focus(); }
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#pmBtn')) { e.preventDefault(); if (document.getElementById('pmPop')) closePMenu(true); else openPMenu(); return; }
  const pop = document.getElementById('pmPop'); if (!pop) return;
  if (!pop.contains(e.target)) closePMenu(); else if (e.target.closest('a.pm-item')) setTimeout(() => closePMenu(), 0);
});
document.addEventListener('keydown', (e) => {
  const pop = document.getElementById('pmPop');
  if (!pop) { if (e.target.id === 'pmBtn' && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPMenu(); } return; }
  const items = [...pop.querySelectorAll('[role=menuitem]')]; const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closePMenu(true); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
  else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
  else if (e.key === 'Tab') closePMenu();
});
window.addEventListener('resize', () => closePMenu());
window.addEventListener('hashchange', () => closePMenu());
A.logoutAsk = async () => {
  closePMenu();
  const pend = K.outbox.length;
  if (!(await confirmBox(pend ? 'You have ' + pend + ' change' + (pend === 1 ? '' : 's') + ' not uploaded yet. If you log out now, they are lost. Log out anyway?' : 'Log out of Aahsso on this device?', 'Log out', !!pend))) return;
  try { localStorage.removeItem('aahsso-me'); } catch (e) { }
  A.logout();
};

/* ================= YOUR BUSINESSES: one sign-in, a Brocan and a Store (or more) =================
 * The list sits in the account menu, under the business name in the sidebar, and behind the logo on a phone.
 * Switching reloads the app in the other business; unsent offline changes must be uploaded first. */
const bizList = () => (K.info && K.info.businesses) || [];
const bizCan = () => K.info && K.info.mode === 'saas' && !K.info.supportView && (bizList().length > 1 || !!K.info.canAddBusiness);
const edTag = (ed) => '<span class="biz-ed biz-' + esc(ed) + '">' + esc(KC.editionOf(ed).short) + '</span>';
function bizRows(cls, role) {
  return bizList().map((b) => '<button type="button" class="' + cls + ' biz-row' + (b.current ? ' on' : '') + '"' + (role ? ' role="' + role + '" tabindex="-1"' : '') + ' data-a="bizSwitch" data-id="' + esc(b.id) + '"' + (b.current ? ' aria-current="true"' : '') + '>' +
    '<span class="biz-av">' + esc(initials(b.name).slice(0, 2)) + '</span><span class="grow" style="min-width:0"><span class="biz-n ellipsis">' + esc(b.name) + '</span>' + edTag(b.edition) + '</span>' + (b.current ? ic('check', 'sm') : '') + '</button>').join('') +
    (K.info.canAddBusiness ? '<button type="button" class="' + cls + ' biz-add"' + (role ? ' role="' + role + '" tabindex="-1"' : '') + ' data-a="bizAdd">' + ic('plus') + '<span class="grow">Add a business</span></button>' : '');
}
A.bizSheet = () => { closePMenu(); openSheet({ title: 'Your businesses', body: '<div class="card list biz-list">' + bizRows('li') + '</div><p class="hint mt">One sign-in for all of them. Each business has its own stock, sales, team and plan.</p>' }); };
async function bizEnter(token, name) {
  ['aahsso-me', 'aahsso-cart', 'aahsso-loc', 'aahsso-choose-plan'].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { } });
  try { localStorage.setItem('aahsso-token', token); sessionStorage.setItem('aahsso-switched', name); } catch (e) { }
  location.hash = '#home'; location.reload();
}
A.bizSwitch = async (el) => {
  const b = bizList().find((x) => x.id === el.dataset.id); closePMenu(); if (!b || b.current) return;
  if (K.outbox.length) { await flushOutbox(); if (K.outbox.length) return toast(K.outbox.length + ' change(s) are still waiting to upload. Connect to the internet, then switch.', true); }
  try { const r = await K.store.req('POST', '/api/businesses/switch', { tenantId: b.id }); await bizEnter(r.token, b.name); } catch (e) { toast(e.message, true); }
};
A.bizAdd = async () => {
  closePMenu(); while (K.sheets.length) closeSheet();
  let eds = [], room = {};
  try { const [o, r] = await Promise.all([K.store.req('GET', '/api/signup-options'), K.store.req('GET', '/api/businesses/room')]); eds = o.editions || []; room = r.room || {}; } catch (e) { return toast(e.message, true); }
  if (!eds.length) return toast('New businesses cannot be added right now', true);
  const free = eds.filter((e) => (room[e.key] || {}).ok);
  // most people add the other kind; a kind that is full is shown but cannot be picked
  const other = free.find((e) => e.key !== edition().key) || free[0];
  const count = (e) => { const r = room[e.key] || {}; const L = KC.editionOf(e.key).loc; return r.ok ? (r.max ? 'You have ' + r.used + ' of ' + r.max + ' ' + L.many : r.used ? 'You have ' + r.used + ' · no limit' : '') : ''; };
  const sh = openSheet({ title: 'Add a business', body: '<div class="col">' + field('Business name', inp('bizName', '', 'placeholder="e.g. ' + (other.key === 'store' ? 'Chez Mama Store' : 'Mama Imports') + '" autocomplete="organization"')) +
      '<div class="lbl-t">What is it for?</div><div class="biz-pick">' + eds.map((e) => { const r = room[e.key] || {}; return '<label class="biz-opt' + (r.ok ? '' : ' full') + '"><input type="radio" name="bizEd" value="' + esc(e.key) + '"' + (other && e.key === other.key ? ' checked' : '') + (r.ok ? '' : ' disabled') + '><span><b>' + esc(e.label) + '</b><span class="hint">' + esc(e.tag) + '</span>' + (r.ok ? (count(e) ? '<span class="biz-cnt">' + esc(count(e)) + '</span>' : '') : '<span class="biz-why">' + esc(r.why || 'Not available') + '</span>') + '</span></label>'; }).join('') + '</div>' +
      '<p class="hint">Starts with a ' + 5 + '-day free trial and its own plan. You sign in the same way and switch from your account menu.</p></div>',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="bizGo"' + (free.length ? '' : ' disabled') + '>' + ic('plus') + 'Create and open</button>' });
  $('#bizGo', sh).onclick = async () => {
    const v = formVals(sh); const name = (v.bizName || '').trim(); if (name.length < 2) return toast('Type the name of the business', true); if (!v.bizEd) return toast('Choose what it is for', true);
    if (K.outbox.length) { await flushOutbox(); if (K.outbox.length) return toast('Some changes are still waiting to upload. Connect to the internet first.', true); }
    try { const r = await K.store.req('POST', '/api/businesses', { businessName: name, edition: v.bizEd }); await bizEnter(r.token, name); } catch (e) { toast(e.message, true); }
  };
};
// just switched: say where you are
setTimeout(() => { try { const n = sessionStorage.getItem('aahsso-switched'); if (n) { sessionStorage.removeItem('aahsso-switched'); toast('You are now in ' + n); } } catch (e) { } }, 1500);

/* ================= PROFILE ================= */
VIEWS.profile = {
  form: true, // typing here is never wiped by a background refresh
  render() {
    const saas = K.info.mode === 'saas'; const u = K.info.user || {}; const name = myName();
    const sid = KC.staffIdOf(K.me.id); const day = typeof myOpenDay === 'function' ? myOpenDay() : null; const st = KC.dayState(day, new Date().toISOString(), S());
    const bal = KC.leaveBalance(K.raw, byId('staff', sid) || { id: sid }, Number(todayStr().slice(0, 4)), S());
    const lastPay = K.raw.payroll.filter((p) => p.staffId === sid && p.type !== 'advance' && p.status === 'paid').sort((a, b) => b.month.localeCompare(a.month))[0];
    let html = '<div class="card pad2 mb prof-head">' + avatarHTML(name, 'xl') + '<div class="grow" style="min-width:0"><h2 class="ellipsis">' + esc(name) + '</h2><div class="muted small">' + esc(K.member ? roleLabel() : '') + ' · ' + esc(S().businessName || '') + (allLocs().length > 1 && K.member ? ' · ' + esc(locName((K.member || {}).locationId)) : '') + '</div>' + (u.login ? '<div class="tiny muted">Signs in with ' + esc(u.login) + '</div>' : '') + '</div></div>';
    if (saas) {
      html += '<div class="prof-grid"><section class="card pad2"><h3 class="mb">Your details</h3><div class="col">' +
        field('Name', inp('prName', name, 'autocomplete="name" maxlength="80"')) +
        field('Sign-in (email or phone)', inp('prLogin', u.login || '', 'disabled')) +
        field('Email', '<input class="inp" type="email" name="prEmail" inputmode="email" autocomplete="email" value="' + esc(u.email || '') + '" placeholder="name@example.com">') +
        '<div class="hint" style="margin-top:-6px">For password-reset links' + (can('settings') ? ' and new online orders' : '') + '.' + (K.info.emailOn === false ? ' Emails are not set up on the server yet.' : '') + '</div>' +
        '<button class="btn pri" data-a="profSave">' + ic('check') + 'Save details</button></div></section>' +
        '<section class="card pad2"><h3 class="mb">Password</h3><div class="col">' +
        field('Current password', '<input class="inp" type="password" name="prOld" autocomplete="current-password">') +
        field('New password', '<input class="inp" type="password" name="prNew" autocomplete="new-password" placeholder="At least 6 characters">') +
        field('Type it again', '<input class="inp" type="password" name="prNew2" autocomplete="new-password">') +
        '<button class="btn" data-a="profPw">Change password</button></div></section>' +
        (can('approve') ? '<section class="card pad2"><h3 class="mb">Approval PIN</h3><p class="small muted" style="margin-top:0">' + (u.approvalPin ? 'Your PIN is set. ' : '') + 'You type it on a cashier\'s phone to approve a cancellation, refund, discount or credit over the limit. Keep it to yourself.</p><div class="col">' +
          field(u.approvalPin ? 'New PIN (4 to 6 digits)' : 'PIN (4 to 6 digits)', '<input class="inp" type="password" name="prPin" inputmode="numeric" data-nofmt maxlength="6" autocomplete="off">') +
          field('Your password', '<input class="inp" type="password" name="prPinPw" autocomplete="current-password">') +
          '<button class="btn' + (u.approvalPin ? '' : ' pri') + '" data-a="profPin">' + ic('key', 'sm') + (u.approvalPin ? 'Change PIN' : 'Set PIN') + '</button></div></section>' : '') + '</div>';
    } else html += '<div class="card pad2 mb muted small">' + (K.info.mode === 'local' ? 'This copy of Aahsso works on this device only, so there is no sign-in or password.' : 'Your name and sign-in come from your claude.ai account.') + '</div>';
    html += '<h3 class="mb mt2">My work</h3><div class="prof-links">' +
      (has('attendance') ? '<a class="card pad prof-link" href="#staff">' + ic('clock') + '<div class="grow"><div class="b">Attendance</div><div class="small muted">' + ({ off: 'Not clocked in', in: 'Working since ' + hm(st.since), break: 'On break', done: 'Clocked out at ' + hm(st.lastOut) })[st.state] + '</div></div>' + ic('chev', 'sm') + '</a>' : '') +
      (has('leave') ? '<a class="card pad prof-link" href="#leave">' + ic('clock') + '<div class="grow"><div class="b">Leave</div><div class="small muted">' + bal.left + ' vacation day' + (bal.left === 1 ? '' : 's') + ' left this year</div></div>' + ic('chev', 'sm') + '</a>' : '') +
      (has('payroll') ? '<a class="card pad prof-link" href="#payroll">' + ic('wallet') + '<div class="grow"><div class="b">' + (can('payroll') ? 'Payroll' : 'My pay') + '</div><div class="small muted">' + (lastPay ? 'Last payslip: ' + esc(MONTHS[Number(lastPay.month.slice(5)) - 1] + ' ' + lastPay.month.slice(0, 4)) : 'Payslips and advances') + '</div></div>' + ic('chev', 'sm') + '</a>' : '') + '</div>';
    if (saas) html += '<div class="row mt2"><button class="btn" data-a="logoutAsk">' + ic('logout') + 'Log out</button></div>';
    return html;
  },
};
A.profPin = async () => {
  const v = formVals($('#view'));
  if (!/^\d{4,6}$/.test(v.prPin || '')) return toast('The PIN is 4 to 6 digits', true);
  if (!v.prPinPw) return toast('Type your password to confirm', true);
  try { await K.store.req('POST', '/api/me/approval-pin', { pin: v.prPin, password: v.prPinPw }); K.info.user = Object.assign({}, K.info.user, { approvalPin: true }); toast('Approval PIN saved'); render(true); }
  catch (e) { toast(e.message, true); }
};
A.profSave = async () => {
  const v = formVals($('#view')); const name = (v.prName || '').trim(); const email = (v.prEmail || '').trim();
  if (name.length < 2) return toast('Type your name', true);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Type a valid email address', true);
  try {
    const r = await K.store.req('PATCH', '/api/me', { name, email });
    K.me.name = r.name; K.info.userLabel = r.name; K.info.user = Object.assign({}, K.info.user, { name: r.name, email: r.email || '' });
    try { const c = JSON.parse(localStorage.getItem('aahsso-me') || 'null'); if (c && c.user) { c.user.name = r.name; c.user.email = r.email || ''; localStorage.setItem('aahsso-me', JSON.stringify(c)); } } catch (e) { }
    K._people = null; K._peopleP = null;
    toast('Details saved'); render(true);
  } catch (e) { toast(e.message, true); }
};
A.profPw = async () => {
  const v = formVals($('#view'));
  if (!v.prOld) return toast('Type your current password', true);
  if (String(v.prNew || '').length < 6) return toast('The new password needs at least 6 characters', true);
  if (v.prNew !== v.prNew2) return toast('The two new passwords are not the same', true);
  try { await K.store.req('POST', '/api/me/password', { current: v.prOld, password: v.prNew }); ['prOld', 'prNew', 'prNew2'].forEach((n) => ($('[name=' + n + ']').value = '')); toast('Password changed'); }
  catch (e) { toast(e.message, true); }
};

/* ================= BILLING & SUBSCRIPTION ================= */
function supportLinks(text) {
  const sp = K.info.support || {}; const out = [];
  if (sp.whatsapp) out.push('<a class="btn" target="_blank" rel="noopener" href="https://wa.me/' + esc(sp.whatsapp) + '?text=' + encodeURIComponent(text) + '">' + ic('wa') + 'WhatsApp us</a>');
  if (sp.email) out.push('<a class="btn" href="mailto:' + esc(sp.email) + '?subject=' + encodeURIComponent('Aahsso — ' + (S().businessName || '')) + '&body=' + encodeURIComponent(text) + '">' + ic('mail') + 'Email us</a>');
  return out.join('');
}
const money0 = (n, cur) => (n === null || n === undefined ? '—' : fmt(n) + ' ' + (!cur || cur === 'XAF' ? 'FCFA' : cur));
async function loadBilling() { try { K._bill = await K.store.req('GET', '/api/billing'); K._billErr = null; } catch (e) { K._billErr = e.message; } if (K.route === 'billing') render(true); if (K._bill && typeof payRefresh === 'function') payRefresh(); }
const BILL_INV = { open: ['To pay', 'warn'], paid: ['Paid', 'ok'], void: ['Cancelled', ''] };
VIEWS.billing = {
  render() {
    if (K.info.mode !== 'saas') return '<div class="card pad2 muted">Billing applies to the online version of Aahsso.</div>';
    if (!canBilling()) return '<div class="card pad2 muted">Only the business owner or an admin can see billing. Ask them if you have a question about the subscription.</div>';
    const b = K._bill; if (!b) { loadBilling(); return K._billErr ? '<div class="alert bad">' + esc(K._billErr) + '</div>' : '<div class="empty">Loading…</div>'; }
    const s = b.subscription || {}; const st = subState(); const cyc = K.ui.billCycle || (s.cycle === 'yearly' ? 'yearly' : 'monthly');
    const open = b.invoices.filter((i) => i.status === 'open'); const pendingFor = (i) => b.payments.find((p) => p.invoice_id === i.id && p.status === 'pending'); const rejectedFor = (i) => b.payments.find((p) => p.invoice_id === i.id && p.status === 'rejected');
    const ended = ['expired', 'suspended'].includes(s.status);
    const ask = 'Hello Aahsso team, I am ' + myName() + ' from ' + (S().businessName || '') + '. ';
    // current plan + usage
    const lim = b.limits || {}; const LBL = { maxUsers: 'Team members', maxLocations: 'Branches', maxProducts: 'Items', maxBusinesses: locW().Many };
    let html = '<div class="card pad2 mb bill-cur"><div class="row between wrap"><div><div class="hint">Current plan</div><h2>' + esc(!s.planName ? 'Free trial' : s.planName + (s.status === 'trialing' ? ' · free trial' : '')) + '</h2>' +
      (s.price !== null && s.price !== undefined && s.status !== 'trialing' ? '<div class="small muted">' + money0(s.price, s.currency) + ' / ' + (s.cycle === 'yearly' ? 'year' : 'month') + '</div>' : '') + '</div><span class="badge ' + st.tone + '">' + esc(st.label) + '</span></div>' +
      '<div class="bill-rows mt">' + (s.status === 'trialing' && s.trialEndsAt ? '<div class="row between cl"><span>Trial ends</span><b>' + esc(fmtDate(String(s.trialEndsAt).slice(0, 10))) + '</b></div>' : '') +
        (s.status !== 'trialing' && s.periodEnd ? '<div class="row between cl"><span>' + (s.status === 'cancelled' ? 'Access until' : 'Paid until') + '</span><b>' + esc(fmtDate(String(s.periodEnd).slice(0, 10))) + '</b></div>' : '') + '</div>' +
      (ended ? '<div class="alert bad mt">' + (s.status === 'suspended' ? 'Your account is suspended. Contact the Aahsso team.' : 'Your subscription has ended.') + ' You can still open and export all your data; recording new sales and stock is paused until you pay.</div>'
        : s.status === 'past_due' ? '<div class="alert warn mt">Your payment is overdue. Pay within ' + esc(s.graceDays) + ' days of the end date to keep recording.</div>'
        : s.status === 'trialing' ? '<p class="small muted mt" style="margin-bottom:0">' + (s.planName ? 'You have the features of ' + esc(s.planName) + ' during your free trial. Choose a paid plan below before it ends to keep recording without a break.' : 'Everything is unlocked during the trial. Choose a plan below before it ends to keep recording without a break.') + '</p>' : '') +
      '<div class="mt">' + Object.entries(LBL).map(([k, l]) => { const used = (b.usage || {})[k] || 0; const max = lim[k]; return '<div class="mb"><div class="row between small"><span>' + l + '</span><b>' + used + (max ? ' / ' + max : '') + '</b></div>' + (max ? '<div class="meter' + (used >= max ? ' full' : '') + '"><span style="width:' + Math.min(100, used / max * 100) + '%"></span></div>' : '') + '</div>'; }).join('') + '</div></div>';
    // invoices to pay: a short card; paying happens in the Pay modal
    open.forEach((i) => {
      const pend = pendingFor(i), rej = rejectedFor(i);
      const live = b.payments.find((p) => p.invoice_id === i.id && p.provider === 'fapshi' && p.status === 'processing');
      if (live) momoWatch(live.id);
      const lastAuto = b.payments.find((p) => p.invoice_id === i.id && p.provider === 'fapshi');
      const note = pend ? '<span class="pay-note info">' + ic('clock', 'sm') + 'We are checking your payment' + (pend.reference ? ' · ' + esc(pend.reference) : '') + '</span>'
        : live ? '<span class="pay-note brand"><span class="pay-pulse" aria-hidden="true"></span>Payment in progress</span>'
        : rej ? '<span class="pay-note bad">Your last payment report was not confirmed</span>'
        : lastAuto && lastAuto.status === 'failed' ? '<span class="pay-note bad">The last payment did not go through</span>' : '';
      html += '<div class="card pad2 mb bill-pay" id="inv-' + i.id + '"><div class="row between wrap"><div><div class="hint">Invoice ' + esc(i.number) + '</div><h2>' + money0(i.amount, i.currency) + '</h2><div class="small muted">' + esc((i.plan_name || '') + ' · ' + (i.cycle === 'yearly' ? 'yearly' : 'monthly') + ' · due ' + fmtDate(String(i.due_date).slice(0, 10))) + '</div></div>' +
        '<div class="row"><button class="btn sm" data-a="billPdf" data-id="' + i.id + '">' + ic('dl', 'sm') + 'PDF</button>' + (i.created_by === 'owner' && !pend && !live ? '<button class="btn sm" data-a="billCancel" data-id="' + i.id + '">Cancel</button>' : '') + '</div></div>' +
        '<div class="pay-cta row between wrap mt">' + (note || '<span class="small muted">' + ((b.momo || {}).enabled ? 'Pay with MTN MoMo or Orange Money — your plan starts straight away.' : 'Pay, then send us the reference.') + '</span>') +
        '<button class="btn ' + (pend ? '' : 'pri ') + 'pay-open" data-a="payOpen" data-id="' + i.id + '">' + (pend ? 'View details' : live ? 'View payment' : ic('wallet') + 'Pay now') + '</button></div></div>';
    });
    // plans: the same comparison table as the Choose-your-plan page
    html += '<div class="mt2"></div>' + planTable(b) + '<div class="mb2"></div>';
    // history
    const past = b.invoices.filter((i) => i.status !== 'open');
    if (past.length) html += '<h2 class="mb">Invoices</h2>' + dataTable({ id: 'billInv', rows: past, noun: 'invoice', cols: [
      { k: 'n', label: 'Number', core: true, v: (i) => i.number }, { k: 'p', label: 'Plan', v: (i) => (i.plan_name || '') + ' · ' + i.cycle },
      { k: 'per', label: 'Period', v: (i) => i.period_start || '', html: (i) => esc(fmtDate(String(i.period_start).slice(0, 10)) + ' → ' + fmtDate(String(i.period_end).slice(0, 10))) },
      { k: 'a', label: 'Amount', core: true, money: true, v: (i) => i.amount }, { k: 's', label: 'Status', core: true, v: (i) => i.status, html: (i) => '<span class="badge ' + BILL_INV[i.status][1] + '">' + BILL_INV[i.status][0] + '</span>' },
      { k: 'pdf', label: '', core: true, v: () => '', html: (i) => '<button class="btn sm" data-a="billPdf" data-id="' + i.id + '">' + ic('dl', 'sm') + 'PDF</button>' }] });
    html += '<p class="small muted mt2">Questions about billing? ' + (supportLinks(ask) ? '<span class="row wrap mt">' + supportLinks(ask) + '</span>' : 'See <a href="#help">Help & support</a>.') + '</p>';
    return html;
  },
};
A.billCycle = (el) => { K.ui.billCycle = el.dataset.v; render(true); };
/* ---------- Pay modal: everything about paying one invoice, in one window ----------
 * Mobile Money (Fapshi): the payer types their number, gets a prompt on their phone and approves with their PIN.
 * "Other ways": transfer, bank or cash, then the payer sends us the reference. The modal follows the payment:
 * form → waiting → paid. */
if (!IP.phone) IP.phone = '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>';
if (!IP.bank) IP.bank = '<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>';
const MOMO_KEY = 'aahsso-momo-phone';
const momoSaved = () => { try { return localStorage.getItem(MOMO_KEY) || ''; } catch (e) { return ''; } };
/** network from a Cameroon number: MTN 67x / 650-654 / 680-683, Orange 69x / 655-659 / 686-689 */
function momoGuess(v) {
  let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('237')) d = d.slice(3); if (d.length < 3) return null;
  const p2 = +d.slice(0, 2), p3 = +d.slice(0, 3);
  if (p2 === 67 || (p3 >= 650 && p3 <= 654) || (p3 >= 680 && p3 <= 683)) return 'mtn';
  if (p2 === 69 || (p3 >= 655 && p3 <= 659) || (p3 >= 686 && p3 <= 689)) return 'orange';
  return null;
}
const momoDigits = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.length === 12 && d.startsWith('237')) d = d.slice(3); return d; };
const momoDots = '<span class="momo-dot mtn" aria-hidden="true"></span><span class="momo-dot orange" aria-hidden="true"></span>';
const DIAL = { mtn: '*126#', orange: '#150*50#' };

/** what the modal shows for this invoice right now (used to redraw only when something changed) */
function payState(id) {
  const b = K._bill; const i = b && b.invoices.find((x) => x.id === id); if (!i) return { k: 'gone' };
  if (i.status === 'paid') return { k: 'paid', i };
  if (i.status !== 'open') return { k: 'gone' };
  const pend = b.payments.find((p) => p.invoice_id === id && p.status === 'pending'); if (pend) return { k: 'pending', i, p: pend };
  const live = b.payments.find((p) => p.invoice_id === id && p.provider === 'fapshi' && p.status === 'processing'); if (live) return { k: 'wait', i, p: live };
  const mm = b.momo || {}; const rej = b.payments.find((p) => p.invoice_id === id && p.status === 'rejected');
  const tab = mm.enabled ? K.ui.payTab || (rej ? 'other' : 'momo') : 'other';
  return { k: 'form', i, tab };
}
const payKey = (s) => s.k + '|' + (s.p ? s.p.id + s.p.status : '') + '|' + (s.tab || '') + '|' + (s.i ? s.i.status : '');

function paySummary(i) {
  const b = K._bill; const paid = b.payments.filter((p) => p.invoice_id === i.id && p.status === 'confirmed').reduce((a, p) => a + p.amount, 0);
  return '<div class="pay-sum"><div class="pay-sum-top"><span>' + esc((i.plan_name || 'Aahsso') + ' · ' + (i.cycle === 'yearly' ? 'yearly' : 'monthly')) + '</span><span>' + esc(i.number) + '</span></div>' +
    '<div class="pay-amt">' + fmt(i.amount - paid) + ' <small>' + esc(!i.currency || i.currency === 'XAF' ? 'FCFA' : i.currency) + '</small></div>' +
    '<div class="pay-sum-bot">Due ' + esc(fmtDate(String(i.due_date).slice(0, 10))) + (i.period_start ? ' · covers ' + esc(fmtDate(String(i.period_start).slice(0, 10))) + ' → ' + esc(fmtDate(String(i.period_end).slice(0, 10))) : '') + '</div></div>';
}
const payLeft = (i) => i.amount - K._bill.payments.filter((p) => p.invoice_id === i.id && p.status === 'confirmed').reduce((a, p) => a + p.amount, 0);

function payView(s) {
  const b = K._bill; const mm = b.momo || {}; const i = s.i;
  const close = '<button class="btn grow" data-a="sheetClose">Close</button>';
  if (s.k === 'paid') {
    const sub = b.subscription || {};
    return { body: '<div class="pay-done" role="status"><div class="pay-tick">' + ic('check') + '</div><h2>Payment received</h2><p>Thank you! <b>' + esc(i.plan_name || 'Your plan') + '</b> is active' + (sub.periodEnd ? ' until <b>' + esc(fmtDate(String(sub.periodEnd).slice(0, 10))) + '</b>' : '') + '.</p><p class="small muted">The receipt is in your invoices below.</p></div>',
      foot: '<button class="btn pri grow" data-a="sheetClose">Done</button>' };
  }
  if (s.k === 'pending') {
    return { body: paySummary(i) + '<div class="pay-state"><div class="pay-ic info">' + ic('clock') + '</div><h3>We are checking your payment</h3><p class="small muted">' + esc(s.p.method) + (s.p.reference ? ' · reference <b>' + esc(s.p.reference) + '</b>' : '') + '</p><p class="small">Your plan starts as soon as the Aahsso team confirms it — usually within a few hours. You don\'t need to keep this open.</p></div>', foot: close };
  }
  if (s.k === 'wait') {
    const p = s.p; const net = (mm.networks || []).find((n) => n.code === p.network) || { label: p.method };
    return { body: paySummary(i) + '<div class="pay-state" role="status" aria-live="polite"><div class="pay-phone" aria-hidden="true">' + ic('phone') + '<span class="pay-pulse"></span></div><h3>Check your phone</h3>' +
      '<p class="small">Approve <b>' + money0(p.amount, p.currency) + '</b> with your <b>' + esc(net.label) + '</b> PIN' + (p.phone ? ' on <b>+237 ' + esc(momoPretty(p.phone)) + '</b>' : '') + '.</p>' +
      (DIAL[net.code] ? '<p class="small muted">No message? Dial <b>' + DIAL[net.code] + '</b></p>' : '') + '</div>',
      foot: close + '<button class="btn pri grow" data-a="momoCheck" data-id="' + esc(p.id) + '">I approved — check now</button>' };
  }
  // the form: choose how to pay
  const tabs = mm.enabled ? '<div class="pay-tabs" role="tablist" aria-label="How to pay">' +
    '<button type="button" role="tab" aria-selected="' + (s.tab === 'momo') + '" class="pay-tab' + (s.tab === 'momo' ? ' on' : '') + '" data-a="payTab" data-v="momo"><span class="pay-tab-ic">' + momoDots + '</span><span><b>Mobile Money</b><small>MTN MoMo · Orange Money</small></span></button>' +
    '<button type="button" role="tab" aria-selected="' + (s.tab === 'other') + '" class="pay-tab' + (s.tab === 'other' ? ' on' : '') + '" data-a="payTab" data-v="other"><span class="pay-tab-ic">' + ic('bank') + '</span><span><b>Other ways</b><small>Transfer, bank or cash</small></span></button></div>' : '';
  if (s.tab === 'momo') {
    const last = b.payments.find((p) => p.invoice_id === i.id && p.provider === 'fapshi');
    const failed = last && last.status === 'failed' ? '<div class="alert bad mb">' + esc(last.failure || 'The last mobile money payment did not go through. You can try again.') + '</div>' : '';
    const phone = K.ui.momoPhone !== undefined ? K.ui.momoPhone : momoSaved();
    const left = payLeft(i); const cur = !i.currency || i.currency === 'XAF' ? 'FCFA' : i.currency;
    return { body: paySummary(i) + tabs + failed +
      field('Mobile money number', '<div class="momo-phone"><span aria-hidden="true">+' + esc(mm.prefix) + '</span>' + inp('mp_' + i.id, phone, 'type="tel" inputmode="tel" autocomplete="tel-national" placeholder="6 77 12 34 56" data-momo-phone aria-label="Mobile money number"') + '<em class="momo-tag" data-momo-tag>' + momoTag(phone) + '</em></div>') +
      field('Amount', '<div class="momo-amt"><input class="inp" value="' + esc(fmt(left)) + '" readonly aria-readonly="true" tabindex="-1"><span>' + esc(cur) + '</span></div>'),
      foot: '<button class="btn" data-a="sheetClose">Cancel</button><button class="btn pri grow" data-a="momoPay" data-id="' + esc(i.id) + '">Pay ' + money0(left, i.currency) + '</button>' };
  }
  // other ways: pay by hand, then send the reference
  const pi = b.instructions || {}; const rej = b.payments.find((p) => p.invoice_id === i.id && p.status === 'rejected');
  const lines = [['MTN MoMo', pi.momoNumber, pi.momoName, 'mtn'], ['Orange Money', pi.omNumber, pi.omName, 'orange']].filter((x) => x[1]);
  return { body: paySummary(i) + tabs + (rej ? '<div class="alert bad mb">Your last payment report was not confirmed' + (rej.note ? ': ' + esc(rej.note) : '') + '. Check the reference and send it again.</div>' : '') +
    '<div class="pay-lbl">1. Pay ' + money0(payLeft(i), i.currency) + ' to</div><div class="pay-lines">' + (lines.length || pi.bank ? lines.map(([m, n, nm, c]) => '<div class="pay-line"><span class="momo-dot ' + c + '" aria-hidden="true"></span><div class="grow"><div class="b">' + esc(m) + '</div><div class="small muted">' + esc(n) + (nm ? ' · ' + esc(nm) : '') + '</div></div><button class="btn sm" data-a="billCopy" data-v="' + esc(n) + '">' + ic('copy', 'sm') + 'Copy</button></div>').join('') + (pi.bank ? '<div class="pay-line"><span class="pay-line-ic">' + ic('bank', 'sm') + '</span><div class="grow"><div class="b">Bank</div><div class="small muted">' + esc(pi.bank) + '</div></div></div>' : '') : '<div class="small muted pay-line">Contact the Aahsso team for payment details.</div>') + '</div>' +
    (pi.note ? '<div class="small muted mt">' + esc(pi.note) + '</div>' : '') +
    '<div class="pay-lbl mt2">2. Tell us you paid</div><div class="grid2">' + field('How you paid', sel('pm_' + i.id, b.methods || ['MTN MoMo', 'Orange Money'], 'MTN MoMo')) + field('Transaction reference', inp('pr_' + i.id, K.ui.payRef || '', 'placeholder="From your payment SMS" autocomplete="off"')) + '</div>' +
    '<p class="hint" style="margin-top:0">Your plan starts once the Aahsso team confirms it — usually within a few hours.</p>',
    foot: '<button class="btn" data-a="sheetClose">Cancel</button><button class="btn pri grow" data-a="billClaim" data-id="' + esc(i.id) + '">' + ic('check', 'sm') + 'Send payment details</button>' };
}

/** open the Pay modal for an invoice; it redraws itself when the payment moves on */
function openPay(id) {
  const ex = K.sheets.find((x) => x._pay); if (ex) { if (ex._pay === id) return ex._refresh(true); closeSheet(); }
  const s = payState(id); if (s.k === 'gone') return;
  const v = payView(s);
  const el = openSheet({ title: s.k === 'paid' ? 'All paid' : 'Pay your invoice', body: v.body, foot: v.foot, onClose: () => { K.ui.payTab = undefined; } });
  el.classList.add('pay-sheet'); el._pay = id; el._key = payKey(s);
  el._refresh = (force) => {
    const st = payState(id); if (st.k === 'gone') { if (K.sheets.includes(el)) { el._onClose = null; K.sheets.splice(K.sheets.indexOf(el), 1); el.remove(); if (!K.sheets.length) document.body.style.overflow = ''; } return; }
    const key = payKey(st); if (!force && key === el._key) return; el._key = key;
    const ref = $('[name="pr_' + id + '"]', el); if (ref) K.ui.payRef = ref.value;
    const vv = payView(st); $('.sh h2', el).textContent = st.k === 'paid' ? 'All paid' : 'Pay your invoice'; $('.sb', el).innerHTML = vv.body; $('.sf', el).innerHTML = vv.foot;
  };
  if (s.k === 'wait') momoWatch(s.p.id);
  return el;
}
const payRefresh = () => { const s = K.sheets.find((x) => x._pay); if (s) s._refresh(); };
A.payOpen = (el) => { openPay(el.dataset.id); };
A.payTab = (el) => { const s = K.sheets.find((x) => x._pay); const ref = s && $('[name^="pr_"]', s); if (ref) K.ui.payRef = ref.value; K.ui.payTab = el.dataset.v; if (s) s._refresh(); };
/* show the network (MTN MoMo / Orange Money) as the number is typed */
const momoPretty = (d) => String(d).replace(/^(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4 $5');
function momoTag(v) { const n = (K._bill && K._bill.momo && K._bill.momo.networks || []).find((x) => x.code === momoGuess(v)); return n ? '<span class="momo-dot ' + esc(n.code) + '" aria-hidden="true"></span>' + esc(n.label) : ''; }
document.addEventListener('input', (e) => {
  if (!e.target.matches || !e.target.matches('[data-momo-phone]')) return;
  K.ui.momoPhone = e.target.value; const t = e.target.parentNode.querySelector('[data-momo-tag]'); if (t) t.innerHTML = momoTag(e.target.value);
});
A.momoPay = async (el) => {
  const id = el.dataset.id;
  const box = $('[name="mp_' + id + '"]'); const phone = box ? box.value.trim() : ''; const d = momoDigits(phone);
  if (!/^6\d{8}$/.test(d) || !momoGuess(d)) { toast('Type your MTN MoMo or Orange Money number, e.g. 6 77 12 34 56', true); if (box) box.focus(); return; }
  K.ui.momoPhone = phone; try { localStorage.setItem(MOMO_KEY, phone); } catch (e) { }
  const label = el.innerHTML; el.textContent = 'Sending…';
  try { const r = await K.store.req('POST', '/api/billing/invoices/' + id + '/momo', { phone: d }); if (r.message) toast(r.message); }
  catch (e) { toast(e.message, true); el.innerHTML = label; }
  await loadBilling();
};
A.momoCheck = (el) => { if (K._mmw) clearTimeout(K._mmw.t); K._mmw = null; momoWatch(el.dataset.id, 0); return new Promise((r) => setTimeout(r, 1200)); };
/** ask the server until the payment is settled: every 5 s for 3 minutes, then every 15 s while Billing is open */
function momoWatch(id, first) {
  if (K._mmw && K._mmw.id === id) { if (first !== undefined) { clearTimeout(K._mmw.t); K._mmw.t = setTimeout(K._mmw.tick, first); } return; }
  if (K._mmw) clearTimeout(K._mmw.t);
  const w = K._mmw = { id, start: Date.now() };
  const tick = w.tick = async () => {
    if (K._mmw !== w) return;
    if (K.route !== 'billing') { K._mmw = null; return; }
    try {
      const p = (await K.store.req('GET', '/api/billing/momo/' + id)).payment;
      if (K._mmw !== w) return;
      if (p.status !== 'processing') {
        K._mmw = null; const shown = K.sheets.some((x) => x._pay === p.invoiceId); // the modal shows the outcome itself
        if (p.status === 'confirmed') { if (!shown) toast('Payment received — thank you! Your plan is active.'); await refreshEntitlements(); }
        else if (p.status === 'failed') { if (!shown) toast(p.failure || 'The payment did not go through', true); }
        else if (!shown) toast('Payment received — the Aahsso team is checking it');
        await loadBilling(); return;
      }
    } catch (e) { /* network hiccup: keep asking */ }
    w.t = setTimeout(tick, Date.now() - w.start < 180000 ? 5000 : 15000);
  };
  w.t = setTimeout(tick, first === undefined ? 3000 : first);
}
const isFreePlan = (p) => (p.price_monthly === null || p.price_monthly === undefined) && (p.price_yearly === null || p.price_yearly === undefined);
const ALWAYS = 'Home, stock & prices, settings, team members, profile, billing and help';
/** Plans side by side: limits and every feature, ticked when included. Used on Choose your plan and on Billing. */
function planTable(b) {
  const plans = b.plans || []; const s = b.subscription || {}; const ended = ['expired', 'suspended'].includes(s.status);
  if (!plans.length) return '<div class="card pad2"><div class="small muted mb">Plans are not published yet. Contact the Aahsso team to subscribe.</div><div class="row wrap">' + supportLinks('Hello Aahsso team, I am ' + myName() + ' from ' + (S().businessName || '') + '. I would like to subscribe.') + '</div></div>';
  const hasM = plans.some((p) => p.price_monthly !== null), hasY = plans.some((p) => p.price_yearly !== null);
  let cyc = K.ui.billCycle || (s.cycle === 'yearly' ? 'yearly' : 'monthly'); if (cyc === 'yearly' && !hasY) cyc = 'monthly'; if (cyc === 'monthly' && !hasM && hasY) cyc = 'yearly';
  const save = Math.max(0, ...plans.filter((p) => p.price_monthly > 0 && p.price_yearly !== null).map((p) => Math.round((1 - p.price_yearly / (p.price_monthly * 12)) * 100)));
  const days = b.trialDays || 5;
  const cta = (p) => {
    const cur = p.id === s.planId && !ended;
    if (isFreePlan(p)) {
      if (cur && s.status === 'trialing') return '<button class="btn block" disabled>Your free trial</button>';
      return b.trialAvailable ? '<button class="btn pri block" data-a="billChoose" data-id="' + esc(p.id) + '">Start free trial</button>' : '<button class="btn block" disabled title="Each business gets one free trial">Trial used</button>';
    }
    const price = p['price_' + cyc];
    if (price === null) return '<button class="btn block" disabled>Not sold ' + (cyc === 'yearly' ? 'yearly' : 'monthly') + '</button>';
    if (cur && s.status !== 'trialing' && s.cycle === cyc) return '<button class="btn block" disabled>Current plan</button>';
    return '<button class="btn block ' + (s.status === 'trialing' || ended || !s.planId ? 'pri' : '') + '" data-a="billChoose" data-id="' + esc(p.id) + '">' + (cur ? 'Switch to ' + cyc : 'Choose ' + esc(p.name)) + '</button>';
  };
  const head = (p) => {
    const cur = p.id === s.planId && !ended; const price = p['price_' + cyc];
    const priceHtml = isFreePlan(p) ? '<div class="pt-price">Free</div><div class="pt-sub">' + days + '-day free trial</div>'
      : price === null ? '<div class="pt-price muted">—</div><div class="pt-sub">' + (cyc === 'yearly' ? 'monthly only' : 'yearly only') + '</div>'
      : '<div class="pt-price">' + money0(price, p.currency) + '</div><div class="pt-sub">per ' + (cyc === 'yearly' ? 'year' + (price ? ' · ≈ ' + money0(Math.round(price / 12), p.currency) + '/month' : '') : 'month') + '</div>';
    return '<th scope="col" class="pt-plan' + (cur ? ' cur' : '') + '">' + (cur ? '<span class="badge ok pt-badge">' + (s.status === 'trialing' ? 'Your trial' : 'Your plan') + '</span>' : '') +
      '<div class="pt-name">' + esc(p.name) + '</div>' + (p.description ? '<div class="pt-desc">' + esc(p.description) + '</div>' : '') + priceHtml + '<div class="pt-cta">' + cta(p) + '</div></th>';
  };
  const tick = (on) => '<td class="pt-cell">' + (on ? '<span class="pt-tick" role="img" aria-label="Included">' + ic('check') + '</span>' : '<span class="sr-only">Not included</span>') + '</td>';
  const open = K.ui.ptOpen || (K.ui.ptOpen = { Limits: true }); // which groups are expanded (remembered while the app is open)
  let curG = '';
  const row = (label, cells, desc) => '<tr class="pt-row" data-g="' + esc(curG) + '"' + (open[curG] ? '' : ' hidden') + '><th scope="row" class="pt-feat">' + esc(label) + (desc ? '<span class="pt-fdesc">' + esc(desc) + '</span>' : '') + '</th>' + cells + '</tr>';
  /** a group heading row: click to expand / collapse; when folded, each plan shows how many of the group's features it has */
  const group = (title, keys) => { curG = title; const isOpen = !!open[title];
    return '<tr class="pt-group' + (isOpen ? ' open' : '') + '" data-g="' + esc(title) + '"><th scope="rowgroup" class="pt-gth"><button type="button" class="pt-gbtn" data-a="ptGroup" data-g="' + esc(title) + '" aria-expanded="' + isOpen + '">' + ic('down', 'sm') + '<span>' + esc(title) + '</span>' + (keys ? '<span class="pt-gn">' + keys.length + '</span>' : '') + '</button></th>' +
      plans.map((p) => '<td class="pt-cell pt-gsum">' + (keys ? (() => { const n = keys.filter((k) => (p.modules || {})[k] !== false).length; return '<span class="pt-gcount' + (n === keys.length ? ' all' : n ? '' : ' none') + '">' + n + ' / ' + keys.length + '</span>'; })() : '') + '</td>').join('') + '</tr>'; };
  const lim = (p, k) => { const v = (p.limits || {})[k]; return '<td class="pt-cell pt-val">' + (v ? esc(fmt(v)) : 'Unlimited') + '</td>'; };
  let body = group('Limits') + row('Team members', plans.map((p) => lim(p, 'maxUsers')).join('')) + row(locW().Many, plans.map((p) => lim(p, 'maxBusinesses')).join(''), 'How many ' + edition().short + ' businesses you can have') + row('Branches', plans.map((p) => lim(p, 'maxLocations')).join(''), 'Including the main one') + row('Items', plans.map((p) => lim(p, 'maxProducts')).join(''));
  const groups = {}; (b.catalog || []).forEach(([k, l, g, d]) => (groups[g] = groups[g] || []).push([k, l, d]));
  Object.entries(groups).forEach(([g, items]) => { body += group(g, items.map((x) => x[0])) + items.map(([k, l, d]) => row(l, plans.map((p) => tick((p.modules || {})[k] !== false)).join(''), d)).join(''); });
  body += group('Always included') + row('Essentials', plans.map(() => tick(true)).join(''), ALWAYS);
  const toggle = hasM && hasY ? '<div class="bill-cycle pt-toggle" role="group" aria-label="Billing period"><button class="' + (cyc === 'monthly' ? 'on' : '') + '" data-a="billCycle" data-v="monthly" aria-pressed="' + (cyc === 'monthly') + '">Monthly</button><button class="' + (cyc === 'yearly' ? 'on' : '') + '" data-a="billCycle" data-v="yearly" aria-pressed="' + (cyc === 'yearly') + '">Yearly' + (save > 0 ? ' <span class="pt-save">save up to ' + save + '%</span>' : '') + '</button></div>' : '';
  const allOpen = ['Limits'].concat(Object.keys(groups), ['Always included']).every((g) => open[g]);
  const tools = '<div class="pt-tools">' + toggle + '<div class="pt-fold"><button type="button" class="btn sm" data-a="ptAll" data-v="1"' + (allOpen ? ' disabled' : '') + '>' + ic('down', 'sm') + 'Expand all</button><button type="button" class="btn sm" data-a="ptAll" data-v="0">' + ic('up', 'sm') + 'Collapse all</button></div></div>';
  return tools + '<div class="pt-wrap" role="region" aria-label="Plans compared" tabindex="0"><table class="ptable"><thead><tr><th class="pt-feat pt-corner"><span class="pt-corner-t">Compare plans</span><span class="pt-fdesc">Limits and features of each plan</span></th>' + plans.map(head).join('') + '</tr></thead><tbody>' + body + '</tbody>' +
    '<tfoot><tr><th class="pt-feat"></th>' + plans.map((p) => '<td class="pt-cell">' + cta(p) + '</td>').join('') + '</tr></tfoot></table></div>';
}
/* fold / unfold groups without redrawing the page (keeps the scroll position) */
function ptApply() {
  const open = K.ui.ptOpen || {};
  $$('.ptable .pt-group').forEach((r) => { const g = r.dataset.g; const o = !!open[g]; r.classList.toggle('open', o); const b = $('.pt-gbtn', r); if (b) b.setAttribute('aria-expanded', o); });
  $$('.ptable .pt-row').forEach((r) => { r.hidden = !open[r.dataset.g]; });
  const all = $$('.ptable .pt-group').every((r) => open[r.dataset.g]); const ex = $('[data-a=ptAll][data-v="1"]'); if (ex) ex.disabled = all;
}
A.ptGroup = (el) => { const o = K.ui.ptOpen || (K.ui.ptOpen = {}); o[el.dataset.g] = !o[el.dataset.g]; ptApply(); };
A.ptAll = (el) => { const o = K.ui.ptOpen = {}; if (el.dataset.v === '1') $$('.ptable .pt-group').forEach((r) => (o[r.dataset.g] = true)); ptApply(); if (el.dataset.v === '0') { const w = $('.pt-wrap'); if (w) { w.scrollTop = 0; w.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } } };
/** after sign-up (and from the Home reminder): choose a plan */
VIEWS.plans = {
  render() {
    if (K.info.mode !== 'saas') return '<div class="card pad2 muted">Plans apply to the online version of Aahsso.</div>';
    if (!canBilling()) return '<div class="card pad2 muted">Only the business owner or an admin can choose the plan.</div>';
    const b = K._bill; if (!b) { loadBilling(); return K._billErr ? '<div class="alert bad">' + esc(K._billErr) + '</div>' : '<div class="empty">Loading plans…</div>'; }
    const s = b.subscription || {}; const left = s.trialEndsAt ? Math.ceil((new Date(s.trialEndsAt).getTime() - Date.now()) / 864e5) : null;
    const line = s.status === 'trialing' ? (s.planId ? 'You are on a free trial of ' + esc(s.planName) + (left !== null ? ' — ' + left + ' day' + (left === 1 ? '' : 's') + ' left' : '') + '. Choose a paid plan any time.' : 'Welcome to Aahsso! Pick the plan that fits your business. Free plans start a ' + (b.trialDays || 5) + '-day free trial — no payment needed.')
      : s.status === 'active' ? 'You are on ' + esc(s.planName || 'a paid plan') + '. Compare plans or switch below.' : 'Your subscription has ended. Choose a plan to keep recording — your data is safe.';
    return '<div class="plans-head"><span class="ed-chip">' + esc(KC.editionOf(b.edition || (K.info && K.info.edition)).label) + '</span><h1>Choose your plan</h1><p>' + line + '</p></div>' + planTable(b) +
      '<p class="hint plans-foot">Prices in ' + esc((b.plans[0] || {}).currency === 'XAF' || !(b.plans[0] || {}).currency ? 'FCFA' : b.plans[0].currency) + '. You can change plan later in <a href="#billing">Billing & subscription</a>. ' + (s.status === 'trialing' && !s.planId ? '<a href="#home">Decide later</a>' : '') + '</p>';
  },
};
/** the plan and features changed: reload what the app is allowed to show */
async function refreshEntitlements() {
  try { const me = await K.store.req('GET', '/api/me'); Object.assign(K.info, { features: me.features || {}, subscription: me.subscription || null, limits: me.limits || {}, tenant: me.tenant }); resolveAccess(); } catch (e) { }
}
A.billCopy = (el) => copyText(el.dataset.v);
A.billChoose = async (el) => {
  const p = K._bill.plans.find((x) => x.id === el.dataset.id); const cyc = K.ui.billCycle || 'monthly';
  if (isFreePlan(p)) {
    if (!(await confirmBox('Start your ' + (K._bill.trialDays || 5) + '-day free trial of ' + p.name + '? You get its features straight away — no payment needed.', 'Start free trial'))) return;
    try { const r = await K.store.req('POST', '/api/billing/choose', { planId: p.id }); await refreshEntitlements(); K._bill = null; toast('Your free trial of ' + r.plan + ' has started'); location.hash = '#home'; render(true); }
    catch (e) { toast(e.message, true); }
    return;
  }
  if (!(await confirmBox('Choose ' + p.name + ' (' + money0(p['price_' + cyc], p.currency) + ' / ' + (cyc === 'yearly' ? 'year' : 'month') + ')? An invoice is created for you to pay.', 'Choose plan'))) return;
  try {
    const r = await K.store.req('POST', '/api/billing/choose', { planId: p.id, cycle: cyc });
    if (K.route !== 'billing') location.hash = '#billing';
    await loadBilling(); openPay(r.invoice.id);
  } catch (e) { toast(e.message, true); }
};
A.billClaim = async (el) => {
  const id = el.dataset.id; const method = $('[name=pm_' + id + ']').value; const reference = $('[name=pr_' + id + ']').value.trim();
  if (method !== 'Cash' && reference.length < 4) return toast('Type the transaction reference from your payment SMS', true);
  try { await K.store.req('POST', '/api/billing/invoices/' + id + '/claim', { method, reference }); K.ui.payRef = ''; toast('Thank you — we are checking your payment'); await loadBilling(); }
  catch (e) { toast(e.message, true); }
};
A.billCancel = async (el) => { if (!(await confirmBox('Cancel this invoice?', 'Cancel invoice', true))) return; try { await K.store.req('POST', '/api/billing/invoices/' + el.dataset.id + '/cancel'); await loadBilling(); } catch (e) { toast(e.message, true); } };
A.billPdf = (el) => {
  const i = K._bill.invoices.find((x) => x.id === el.dataset.id); if (!i) return; if (!window.jspdf) return toast('PDF library still loading — try again', true);
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a5' }); const W = 148; let y = 16; const pi = K._bill.instructions || {};
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('Aahsso', 12, y); doc.setFontSize(11); doc.text('INVOICE', W - 12, y, { align: 'right' }); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(i.number, W - 12, y, { align: 'right' }); y += 10;
  const kv = (k, v) => { doc.setTextColor(120); doc.text(k, 12, y); doc.setTextColor(20); doc.text(String(v), 48, y); y += 6; };
  kv('Billed to', S().businessName || ''); kv('Plan', (i.plan_name || '') + ' · ' + (i.cycle === 'yearly' ? 'yearly' : 'monthly'));
  kv('Period', fmtDate(String(i.period_start).slice(0, 10)) + ' to ' + fmtDate(String(i.period_end).slice(0, 10))); kv('Issued', fmtDate(String(i.issued_at).slice(0, 10))); kv('Due', fmtDate(String(i.due_date).slice(0, 10)));
  y += 4; doc.setFillColor(240, 238, 232); doc.rect(12, y - 5, W - 24, 11, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Amount', 15, y + 2); doc.text(money0(i.amount, i.currency), W - 15, y + 2, { align: 'right' }); y += 16;
  doc.setFontSize(10); doc.text(i.status === 'paid' ? 'PAID on ' + fmtDate(String(i.paid_at).slice(0, 10)) : i.status === 'void' ? 'CANCELLED' : 'To pay', 12, y); y += 8;
  if (i.status === 'open') { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); [['MTN MoMo', pi.momoNumber, pi.momoName], ['Orange Money', pi.omNumber, pi.omName]].filter((x) => x[1]).forEach(([m, n, nm]) => { doc.text(m + ': ' + n + (nm ? ' (' + nm + ')' : ''), 12, y); y += 5; }); if (pi.bank) { doc.text(doc.splitTextToSize('Bank: ' + pi.bank, W - 24), 12, y); y += 10; } if (pi.note) doc.text(doc.splitTextToSize(pi.note, W - 24), 12, y); }
  doc.save('Aahsso-' + i.number + '.pdf');
};
/** read-only banner while the Aahsso team looks at the account */
function supportBanner(sv) {
  const bar = document.createElement('div'); bar.className = 'support-bar'; bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>' + ic('alert', 'sm') + ' Aahsso support view · read-only · opened by ' + esc(sv.by) + ' · ends at ' + esc(new Date(sv.until).toTimeString().slice(0, 5)) + '</span><button type="button" id="svEnd">End view</button>';
  document.body.prepend(bar); document.getElementById('svEnd').onclick = () => A.logout();
}

/* ================= HELP & SUPPORT ================= */
const FAQ = [
  ['Getting started', [
    ['How does Aahsso work, step by step?', 'Aahsso follows your goods: <b>Buy</b> (record what you bought abroad or locally) → <b>Ship</b> (put items in a shipment and move it through Consolidating, Loading, On the way) → <b>Receive</b> (Arrived in Cameroon, Customs cleared, In warehouse) → <b>Sell</b>. Tap “How Aahsso works” below for a guided tour.'],
    ['How do I add a team member?', 'Settings → Team → <b>Add team member</b>. Choose their role (manager, sales…). If they have an email address, they receive their login and password by email.'],
    ['Does Aahsso work without internet?', 'Yes. What you record is saved on the phone and uploads by itself when the network is back — the top bar shows “to sync” until then. Avoid logging out while changes are waiting.'],
  ]],
  ['Buying & stock', [
    ['How do I record a purchase?', 'Buy → <b>New purchase</b>: add each item with quantity, weight and cost (with or without tax, in dollars or francs), choose how you paid, then review and save. The items then wait to be shipped.'],
    ['Why can’t I sell items I bought?', 'Items can be sold once they are <b>in the warehouse</b>. Put them in a shipment (Ship), then move the shipment to “In warehouse” on the Receive page.'],
    ['How are selling prices set?', 'From the full cost (purchase, shipping, customs) and your markup in Settings → Pricing. You can change any price in Stock; every change is kept in the item’s price history.'],
  ]],
  ['Selling & money', [
    ['How do I make a sale?', 'Tap <b>Sell</b>, add the items, choose the customer, how they pay (cash, MTN MoMo, Orange Money…) and delivery if needed. Send the receipt by WhatsApp, PDF or email.'],
    ['How do I close my day?', 'Money → Cash handover → <b>Close my day & hand over</b>. Type the cash you counted and your MoMo/OM amounts; a manager confirms. Differences are shown.'],
    ['A colleague takes over the till during the day', 'Money → Cash handover → <b>Hand the till to a colleague</b>. Count the till; your colleague counts it again on their phone and accepts. The money then counts on their day.'],
    ['How do I remind customers who owe money?', 'Customers → Debt reminders. Reminders can also go out automatically at the hour you choose in Settings.'],
  ]],
  ['Staff', [
    ['How do I clock in and take a break?', 'Use the card at the top of Home: Clock in, Start break, Back to work, Clock out. A wrong time can be corrected by a manager in Staff → Attendance.'],
    ['How do I ask for leave?', 'Staff → Leave → <b>Ask for leave</b>. Your manager approves or declines it; you see your vacation days left.'],
    ['How does payroll work?', 'Set each person’s pay in Staff → Employees (monthly, daily or hourly). Staff → Payroll then prepares each payslip from attendance, leave, advances and cash shortages. “Mark as paid” records the salary as an expense.'],
  ]],
  ['Online shop', [
    ['How do I open my online shop?', 'Settings → Online shop: turn it on, choose your shop address (your store name, e.g. /s/your-shop) and share the link. Orders arrive in Sell → Online orders.'],
    ['Can I set the price before the customer pays?', 'Yes. Open the order, adjust prices and the delivery fee, then send the quote to the customer on WhatsApp. When they agree, turn it into a sale.'],
  ]],
  ['Account & data', [
    ['I forgot my password', 'On the sign-in page tap <b>Forgot password?</b> — a link is emailed if your account has an email address. Otherwise ask the owner to set a new password for you in Team.'],
    ['How do I download my data?', 'Settings → Backup downloads everything; most lists also have an <b>Excel</b> button. You can always export, even if the subscription has ended.'],
  ]],
];
VIEWS.help = {
  render() {
    const q = (K.ui.helpQ || '').toLowerCase().trim(); const sp = K.info.support || {}; const saas = K.info.mode === 'saas';
    const groups = FAQ.map(([g, items]) => [g, items.filter(([qq, a]) => !q || (qq + ' ' + a.replace(/<[^>]+>/g, '')).toLowerCase().includes(q))]).filter(([, it]) => it.length);
    let html = '<div class="help-top card pad2 mb"><div class="grow"><h2>How can we help?</h2><p class="small muted" style="margin:4px 0 0">Answers to common questions, a guided tour, and how to reach us.</p></div><button class="btn tour-btn" data-a="tourStart"><span class="tour-q" aria-hidden="true">?</span>How Aahsso works</button></div>' +
      '<div class="help-search mb"><span class="help-ic">' + ic('search') + '</span><input class="inp" type="search" id="helpQ" placeholder="Search help, e.g. close my day, leave, shop" value="' + esc(K.ui.helpQ || '') + '" aria-label="Search help"></div>' +
      '<div id="helpFaq">' + (groups.length ? groups.map(([g, items]) => '<h3 class="help-g">' + esc(g) + '</h3><div class="card help-list">' + items.map(([qq, a]) => '<details class="help-q"' + (q ? ' open' : '') + '><summary>' + esc(qq) + ic('down', 'sm') + '</summary><div class="help-a">' + a + '</div></details>').join('') + '</div>').join('')
        : '<div class="card pad2 muted small">Nothing found for “' + esc(K.ui.helpQ) + '”. Send us your question below.</div>') + '</div>';
    html += '<h2 class="mb mt2">Contact us</h2><div class="card pad2">';
    const links = supportLinks('Hello Aahsso team, I am ' + myName() + ' from ' + (S().businessName || '') + '. ');
    html += links ? '<div class="row wrap mb">' + links + '</div>' : '';
    if (saas && sp.email && K.info.emailOn !== false) {
      html += '<div class="col"><div class="grid2">' + field('Topic', sel('hTopic', ['Question', 'Something is not working', 'Billing & subscription', 'Idea / request'], 'Question')) + field('Your email for the answer', inp('hReply', (K.info.user || {}).email || (/@/.test((K.info.user || {}).login || '') ? K.info.user.login : ''), 'disabled placeholder="Add an email in Profile"')) + '</div>' +
        field('Message', '<textarea class="inp" name="hMsg" rows="4" maxlength="4000" placeholder="What happened, on which screen, and what you expected"></textarea>') +
        '<div class="row between wrap"><span class="tiny muted">We see your business name, your name and the screen you were on — never your passwords.</span><button class="btn pri" data-a="helpSend">' + ic('mail') + 'Send message</button></div></div>';
    } else if (!links) html += '<div class="muted small">Support contacts are not set up on this server yet. ' + (can('team') ? 'Ask the person who installed Aahsso for you.' : 'Ask your business owner.') + '</div>';
    html += '</div>';
    return html;
  },
};
let _helpT;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'helpQ') return;
  K.ui.helpQ = e.target.value; clearTimeout(_helpT);
  _helpT = setTimeout(() => { const box = document.getElementById('helpFaq'); if (!box) return; const tmp = document.createElement('div'); tmp.innerHTML = VIEWS.help.render(); const fresh = tmp.querySelector('#helpFaq'); if (fresh) box.replaceWith(fresh); }, 150);
});
A.helpSend = async () => {
  const v = formVals($('#view')); const msg = (v.hMsg || '').trim();
  if (msg.length < 5) return toast('Tell us a bit more', true);
  try {
    const r = await K.store.req('POST', '/api/support', { topic: v.hTopic, message: msg, page: K.prevRoute || K.route });
    $('[name=hMsg]').value = '';
    toast(r.replyTo ? 'Message sent — we will answer at ' + r.replyTo : 'Message sent. Add an email in Profile so we can answer you by email.');
  } catch (e) { toast(e.message, true); }
};
window.addEventListener('hashchange', (e) => { try { const from = new URL(e.oldURL).hash.slice(1); if (from && from !== 'help') K.prevRoute = from; } catch (er) { } });
