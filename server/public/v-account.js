/* Kargo — your account: avatar menu (top right), Profile, Billing & subscription, Help & support */

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
  pop.innerHTML = '<div class="pm-head">' + avatarHTML(name, 'lg') + '<div class="grow" style="min-width:0"><div class="pm-n">' + esc(name) + '</div><div class="pm-s">' + esc(role) + ' · ' + esc(S().businessName || '') + '</div>' + (u.email || u.login ? '<div class="pm-s ellipsis">' + esc(u.email || u.login) + '</div>' : '') + '</div></div>' +
    '<div class="pm-list">' + item('#profile', 'user', 'Profile') +
      (saas && canBilling() ? item('#billing', 'card', 'Billing & subscription', '<span class="badge ' + sub.tone + '">' + esc(sub.label.replace(/^Trial · /, '')) + '</span>') : '') +
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
  if (!(await confirmBox(pend ? 'You have ' + pend + ' change' + (pend === 1 ? '' : 's') + ' not uploaded yet. If you log out now, they are lost. Log out anyway?' : 'Log out of Kargo on this device?', 'Log out', !!pend))) return;
  try { localStorage.removeItem('kargo-me'); } catch (e) { }
  A.logout();
};

/* ================= PROFILE ================= */
VIEWS.profile = {
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
        '<button class="btn" data-a="profPw">Change password</button></div></section></div>';
    } else html += '<div class="card pad2 mb muted small">' + (K.info.mode === 'local' ? 'This copy of Kargo works on this device only, so there is no sign-in or password.' : 'Your name and sign-in come from your claude.ai account.') + '</div>';
    html += '<h3 class="mb mt2">My work</h3><div class="prof-links">' +
      (has('attendance') ? '<a class="card pad prof-link" href="#staff">' + ic('clock') + '<div class="grow"><div class="b">Attendance</div><div class="small muted">' + ({ off: 'Not clocked in', in: 'Working since ' + hm(st.since), break: 'On break', done: 'Clocked out at ' + hm(st.lastOut) })[st.state] + '</div></div>' + ic('chev', 'sm') + '</a>' : '') +
      (has('leave') ? '<a class="card pad prof-link" href="#leave">' + ic('clock') + '<div class="grow"><div class="b">Leave</div><div class="small muted">' + bal.left + ' vacation day' + (bal.left === 1 ? '' : 's') + ' left this year</div></div>' + ic('chev', 'sm') + '</a>' : '') +
      (has('payroll') ? '<a class="card pad prof-link" href="#payroll">' + ic('wallet') + '<div class="grow"><div class="b">' + (can('payroll') ? 'Payroll' : 'My pay') + '</div><div class="small muted">' + (lastPay ? 'Last payslip: ' + esc(MONTHS[Number(lastPay.month.slice(5)) - 1] + ' ' + lastPay.month.slice(0, 4)) : 'Payslips and advances') + '</div></div>' + ic('chev', 'sm') + '</a>' : '') + '</div>';
    if (saas) html += '<div class="row mt2"><button class="btn" data-a="logoutAsk">' + ic('logout') + 'Log out</button></div>';
    return html;
  },
};
A.profSave = async () => {
  const v = formVals($('#view')); const name = (v.prName || '').trim(); const email = (v.prEmail || '').trim();
  if (name.length < 2) return toast('Type your name', true);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Type a valid email address', true);
  try {
    const r = await K.store.req('PATCH', '/api/me', { name, email });
    K.me.name = r.name; K.info.userLabel = r.name; K.info.user = Object.assign({}, K.info.user, { name: r.name, email: r.email || '' });
    try { const c = JSON.parse(localStorage.getItem('kargo-me') || 'null'); if (c && c.user) { c.user.name = r.name; c.user.email = r.email || ''; localStorage.setItem('kargo-me', JSON.stringify(c)); } } catch (e) { }
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
  if (sp.email) out.push('<a class="btn" href="mailto:' + esc(sp.email) + '?subject=' + encodeURIComponent('Kargo — ' + (S().businessName || '')) + '&body=' + encodeURIComponent(text) + '">' + ic('mail') + 'Email us</a>');
  return out.join('');
}
const money0 = (n, cur) => (n === null || n === undefined ? '—' : fmt(n) + ' ' + (!cur || cur === 'XAF' ? 'FCFA' : cur));
async function loadBilling() { try { K._bill = await K.store.req('GET', '/api/billing'); K._billErr = null; } catch (e) { K._billErr = e.message; } if (K.route === 'billing') render(true); }
const BILL_INV = { open: ['To pay', 'warn'], paid: ['Paid', 'ok'], void: ['Cancelled', ''] };
VIEWS.billing = {
  render() {
    if (K.info.mode !== 'saas') return '<div class="card pad2 muted">Billing applies to the online version of Kargo.</div>';
    if (!canBilling()) return '<div class="card pad2 muted">Only the business owner or an admin can see billing. Ask them if you have a question about the subscription.</div>';
    const b = K._bill; if (!b) { loadBilling(); return K._billErr ? '<div class="alert bad">' + esc(K._billErr) + '</div>' : '<div class="empty">Loading…</div>'; }
    const s = b.subscription || {}; const st = subState(); const cyc = K.ui.billCycle || (s.cycle === 'yearly' ? 'yearly' : 'monthly');
    const open = b.invoices.filter((i) => i.status === 'open'); const pendingFor = (i) => b.payments.find((p) => p.invoice_id === i.id && p.status === 'pending'); const rejectedFor = (i) => b.payments.find((p) => p.invoice_id === i.id && p.status === 'rejected');
    const ended = ['expired', 'suspended'].includes(s.status);
    const ask = 'Hello Kargo team, I am ' + myName() + ' from ' + (S().businessName || '') + '. ';
    // current plan + usage
    const lim = b.limits || {}; const LBL = { maxUsers: 'Team members', maxLocations: 'Branches', maxProducts: 'Items' };
    let html = '<div class="card pad2 mb bill-cur"><div class="row between wrap"><div><div class="hint">Current plan</div><h2>' + esc(s.status === 'trialing' || !s.planName ? 'Free trial' : s.planName) + '</h2>' +
      (s.price !== null && s.price !== undefined && s.status !== 'trialing' ? '<div class="small muted">' + money0(s.price, s.currency) + ' / ' + (s.cycle === 'yearly' ? 'year' : 'month') + '</div>' : '') + '</div><span class="badge ' + st.tone + '">' + esc(st.label) + '</span></div>' +
      '<div class="bill-rows mt">' + (s.status === 'trialing' && s.trialEndsAt ? '<div class="row between cl"><span>Trial ends</span><b>' + esc(fmtDate(String(s.trialEndsAt).slice(0, 10))) + '</b></div>' : '') +
        (s.status !== 'trialing' && s.periodEnd ? '<div class="row between cl"><span>' + (s.status === 'cancelled' ? 'Access until' : 'Paid until') + '</span><b>' + esc(fmtDate(String(s.periodEnd).slice(0, 10))) + '</b></div>' : '') + '</div>' +
      (ended ? '<div class="alert bad mt">' + (s.status === 'suspended' ? 'Your account is suspended. Contact the Kargo team.' : 'Your subscription has ended.') + ' You can still open and export all your data; recording new sales and stock is paused until you pay.</div>'
        : s.status === 'past_due' ? '<div class="alert warn mt">Your payment is overdue. Pay within ' + esc(s.graceDays) + ' days of the end date to keep recording.</div>'
        : s.status === 'trialing' ? '<p class="small muted mt" style="margin-bottom:0">Everything is unlocked during the trial. Choose a plan below before it ends to keep recording without a break.</p>' : '') +
      '<div class="mt">' + Object.entries(LBL).map(([k, l]) => { const used = (b.usage || {})[k] || 0; const max = lim[k]; return '<div class="mb"><div class="row between small"><span>' + l + '</span><b>' + used + (max ? ' / ' + max : '') + '</b></div>' + (max ? '<div class="meter' + (used >= max ? ' full' : '') + '"><span style="width:' + Math.min(100, used / max * 100) + '%"></span></div>' : '') + '</div>'; }).join('') + '</div></div>';
    // invoices to pay
    const pi = b.instructions || {};
    open.forEach((i) => {
      const pend = pendingFor(i), rej = rejectedFor(i);
      html += '<div class="card pad2 mb bill-pay" id="inv-' + i.id + '"><div class="row between wrap mb"><div><div class="hint">Invoice ' + esc(i.number) + '</div><h2>' + money0(i.amount, i.currency) + '</h2><div class="small muted">' + esc((i.plan_name || '') + ' · ' + (i.cycle === 'yearly' ? 'yearly' : 'monthly') + ' · due ' + fmtDate(String(i.due_date).slice(0, 10))) + '</div></div>' +
        '<div class="row"><button class="btn sm" data-a="billPdf" data-id="' + i.id + '">' + ic('dl', 'sm') + 'PDF</button>' + (i.created_by === 'owner' && !pend ? '<button class="btn sm" data-a="billCancel" data-id="' + i.id + '">Cancel</button>' : '') + '</div></div>';
      if (pend) html += '<div class="alert info">We are checking your payment (' + esc(pend.method) + (pend.reference ? ' · ' + esc(pend.reference) : '') + '). Your subscription starts as soon as it is confirmed — usually within a few hours.</div></div>';
      else {
        const lines = [['MTN MoMo', pi.momoNumber, pi.momoName], ['Orange Money', pi.omNumber, pi.omName]].filter((x) => x[1]);
        html += (rej ? '<div class="alert bad mb">Your last payment report was not confirmed' + (rej.note ? ': ' + esc(rej.note) : '') + '. Check the reference and report it again.</div>' : '') +
          '<h3 class="mb">How to pay</h3>' + (lines.length || pi.bank ? lines.map(([m, n, nm]) => '<div class="pay-line"><div><div class="b">' + esc(m) + '</div><div class="small muted">' + esc(n) + (nm ? ' · ' + esc(nm) : '') + '</div></div><button class="btn sm" data-a="billCopy" data-v="' + esc(n) + '">' + ic('copy', 'sm') + 'Copy</button></div>').join('') + (pi.bank ? '<div class="pay-line"><div><div class="b">Bank</div><div class="small muted">' + esc(pi.bank) + '</div></div></div>' : '') : '<div class="small muted mb">Contact the Kargo team for payment details.</div>') +
          (pi.note ? '<div class="small muted mt">' + esc(pi.note) + '</div>' : '') +
          '<h3 class="mb mt2">I have paid</h3><div class="grid2">' + field('How you paid', sel('pm_' + i.id, b.methods || ['MTN MoMo', 'Orange Money'], 'MTN MoMo')) + field('Transaction reference', inp('pr_' + i.id, '', 'placeholder="From your payment SMS" autocomplete="off"')) + '</div>' +
          '<button class="btn pri mt" data-a="billClaim" data-id="' + i.id + '">' + ic('check') + 'Send payment details</button></div>';
      }
    });
    // plans
    const plans = b.plans || [];
    if (plans.length) {
      const hasYear = plans.some((p) => p.price_yearly !== null);
      html += '<div class="row between wrap mb mt2"><h2>Plans</h2>' + (hasYear ? '<div class="bill-cycle" role="group" aria-label="Billing period"><button class="' + (cyc === 'monthly' ? 'on' : '') + '" data-a="billCycle" data-v="monthly">Monthly</button><button class="' + (cyc === 'yearly' ? 'on' : '') + '" data-a="billCycle" data-v="yearly">Yearly</button></div>' : '') + '</div>' +
        '<div class="bill-plans mb2">' + plans.map((p) => {
          const price = p['price_' + cyc]; const cur = p.id === s.planId && s.status !== 'trialing' && !ended; const L = p.limits || {};
          const lims = [L.maxUsers ? L.maxUsers + ' team members' : 'Unlimited team', L.maxLocations ? (L.maxLocations === 1 ? '1 location' : L.maxLocations + ' branches') : 'Unlimited branches', L.maxProducts ? L.maxProducts + ' items' : null].filter(Boolean);
          const off = (b.catalog || []).filter(([k]) => (p.modules || {})[k] === false).map(([, l]) => l);
          return '<div class="card pad2 bill-plan' + (cur ? ' cur' : '') + '"><div class="row between"><h3>' + esc(p.name) + '</h3>' + (cur ? '<span class="badge ok">Your plan</span>' : '') + '</div>' + (p.description ? '<div class="small muted">' + esc(p.description) + '</div>' : '') +
            '<div class="bill-price">' + (price === null ? '<span class="small muted">Not available ' + (cyc === 'yearly' ? 'yearly' : 'monthly') + '</span>' : money0(price, p.currency) + '<span class="small muted"> / ' + (cyc === 'yearly' ? 'year' : 'month') + '</span>') + '</div>' +
            '<ul class="bill-feat">' + (p.features || []).concat(lims).map((f) => '<li>' + ic('check', 'sm') + esc(f) + '</li>').join('') + off.map((f) => '<li class="muted">' + ic('x', 'sm') + esc(f) + ' not included</li>').join('') + '</ul>' +
            (price !== null && !(cur && cyc === s.cycle) ? '<button class="btn block mt ' + (s.status === 'trialing' || ended ? 'pri' : '') + '" data-a="billChoose" data-id="' + esc(p.id) + '">' + (cur ? 'Switch to ' + cyc : s.status === 'trialing' || ended || !s.planId ? 'Choose ' + esc(p.name) : 'Change to ' + esc(p.name)) + '</button>' : '') + '</div>';
        }).join('') + '</div>';
    } else html += '<div class="card pad2 mb2"><div class="small muted mb">Plans are not published yet. Contact the Kargo team to subscribe.</div><div class="row wrap">' + supportLinks(ask + 'I would like to subscribe.') + '</div></div>';
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
A.billCopy = (el) => copyText(el.dataset.v);
A.billChoose = async (el) => {
  const p = K._bill.plans.find((x) => x.id === el.dataset.id); const cyc = K.ui.billCycle || 'monthly';
  if (!(await confirmBox('Choose ' + p.name + ' (' + money0(p['price_' + cyc], p.currency) + ' / ' + (cyc === 'yearly' ? 'year' : 'month') + ')? An invoice is created for you to pay.', 'Choose plan'))) return;
  try { const r = await K.store.req('POST', '/api/billing/choose', { planId: p.id, cycle: cyc }); toast(r.reused ? 'You already have this invoice — pay it below' : 'Invoice ' + r.invoice.number + ' created'); await loadBilling(); const el2 = document.getElementById('inv-' + r.invoice.id); if (el2) el2.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  catch (e) { toast(e.message, true); }
};
A.billClaim = async (el) => {
  const id = el.dataset.id; const method = $('[name=pm_' + id + ']').value; const reference = $('[name=pr_' + id + ']').value.trim();
  if (method !== 'Cash' && reference.length < 4) return toast('Type the transaction reference from your payment SMS', true);
  try { await K.store.req('POST', '/api/billing/invoices/' + id + '/claim', { method, reference }); toast('Thank you — we are checking your payment'); await loadBilling(); }
  catch (e) { toast(e.message, true); }
};
A.billCancel = async (el) => { if (!(await confirmBox('Cancel this invoice?', 'Cancel invoice', true))) return; try { await K.store.req('POST', '/api/billing/invoices/' + el.dataset.id + '/cancel'); await loadBilling(); } catch (e) { toast(e.message, true); } };
A.billPdf = (el) => {
  const i = K._bill.invoices.find((x) => x.id === el.dataset.id); if (!i) return; if (!window.jspdf) return toast('PDF library still loading — try again', true);
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a5' }); const W = 148; let y = 16; const pi = K._bill.instructions || {};
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('Kargo', 12, y); doc.setFontSize(11); doc.text('INVOICE', W - 12, y, { align: 'right' }); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(i.number, W - 12, y, { align: 'right' }); y += 10;
  const kv = (k, v) => { doc.setTextColor(120); doc.text(k, 12, y); doc.setTextColor(20); doc.text(String(v), 48, y); y += 6; };
  kv('Billed to', S().businessName || ''); kv('Plan', (i.plan_name || '') + ' · ' + (i.cycle === 'yearly' ? 'yearly' : 'monthly'));
  kv('Period', fmtDate(String(i.period_start).slice(0, 10)) + ' to ' + fmtDate(String(i.period_end).slice(0, 10))); kv('Issued', fmtDate(String(i.issued_at).slice(0, 10))); kv('Due', fmtDate(String(i.due_date).slice(0, 10)));
  y += 4; doc.setFillColor(240, 238, 232); doc.rect(12, y - 5, W - 24, 11, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Amount', 15, y + 2); doc.text(money0(i.amount, i.currency), W - 15, y + 2, { align: 'right' }); y += 16;
  doc.setFontSize(10); doc.text(i.status === 'paid' ? 'PAID on ' + fmtDate(String(i.paid_at).slice(0, 10)) : i.status === 'void' ? 'CANCELLED' : 'To pay', 12, y); y += 8;
  if (i.status === 'open') { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); [['MTN MoMo', pi.momoNumber, pi.momoName], ['Orange Money', pi.omNumber, pi.omName]].filter((x) => x[1]).forEach(([m, n, nm]) => { doc.text(m + ': ' + n + (nm ? ' (' + nm + ')' : ''), 12, y); y += 5; }); if (pi.bank) { doc.text(doc.splitTextToSize('Bank: ' + pi.bank, W - 24), 12, y); y += 10; } if (pi.note) doc.text(doc.splitTextToSize(pi.note, W - 24), 12, y); }
  doc.save('Kargo-' + i.number + '.pdf');
};
/** read-only banner while the Kargo team looks at the account */
function supportBanner(sv) {
  const bar = document.createElement('div'); bar.className = 'support-bar'; bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>' + ic('alert', 'sm') + ' Kargo support view · read-only · opened by ' + esc(sv.by) + ' · ends at ' + esc(new Date(sv.until).toTimeString().slice(0, 5)) + '</span><button type="button" id="svEnd">End view</button>';
  document.body.prepend(bar); document.getElementById('svEnd').onclick = () => A.logout();
}

/* ================= HELP & SUPPORT ================= */
const FAQ = [
  ['Getting started', [
    ['How does Kargo work, step by step?', 'Kargo follows your goods: <b>Buy</b> (record what you bought abroad or locally) → <b>Ship</b> (put items in a shipment and move it through Consolidating, Loading, On the way) → <b>Receive</b> (Arrived in Cameroon, Customs cleared, In warehouse) → <b>Sell</b>. Tap “How Kargo works” below for a guided tour.'],
    ['How do I add a team member?', 'Settings → Team → <b>Add team member</b>. Choose their role (manager, sales…). If they have an email address, they receive their login and password by email.'],
    ['Does Kargo work without internet?', 'Yes. What you record is saved on the phone and uploads by itself when the network is back — the top bar shows “to sync” until then. Avoid logging out while changes are waiting.'],
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
    let html = '<div class="help-top card pad2 mb"><div class="grow"><h2>How can we help?</h2><p class="small muted" style="margin:4px 0 0">Answers to common questions, a guided tour, and how to reach us.</p></div><button class="btn tour-btn" data-a="tourStart"><span class="tour-q" aria-hidden="true">?</span>How Kargo works</button></div>' +
      '<div class="help-search mb"><span class="help-ic">' + ic('search') + '</span><input class="inp" type="search" id="helpQ" placeholder="Search help, e.g. close my day, leave, shop" value="' + esc(K.ui.helpQ || '') + '" aria-label="Search help"></div>' +
      '<div id="helpFaq">' + (groups.length ? groups.map(([g, items]) => '<h3 class="help-g">' + esc(g) + '</h3><div class="card help-list">' + items.map(([qq, a]) => '<details class="help-q"' + (q ? ' open' : '') + '><summary>' + esc(qq) + ic('down', 'sm') + '</summary><div class="help-a">' + a + '</div></details>').join('') + '</div>').join('')
        : '<div class="card pad2 muted small">Nothing found for “' + esc(K.ui.helpQ) + '”. Send us your question below.</div>') + '</div>';
    html += '<h2 class="mb mt2">Contact us</h2><div class="card pad2">';
    const links = supportLinks('Hello Kargo team, I am ' + myName() + ' from ' + (S().businessName || '') + '. ');
    html += links ? '<div class="row wrap mb">' + links + '</div>' : '';
    if (saas && sp.email && K.info.emailOn !== false) {
      html += '<div class="col"><div class="grid2">' + field('Topic', sel('hTopic', ['Question', 'Something is not working', 'Billing & subscription', 'Idea / request'], 'Question')) + field('Your email for the answer', inp('hReply', (K.info.user || {}).email || (/@/.test((K.info.user || {}).login || '') ? K.info.user.login : ''), 'disabled placeholder="Add an email in Profile"')) + '</div>' +
        field('Message', '<textarea class="inp" name="hMsg" rows="4" maxlength="4000" placeholder="What happened, on which screen, and what you expected"></textarea>') +
        '<div class="row between wrap"><span class="tiny muted">We see your business name, your name and the screen you were on — never your passwords.</span><button class="btn pri" data-a="helpSend">' + ic('mail') + 'Send message</button></div></div>';
    } else if (!links) html += '<div class="muted small">Support contacts are not set up on this server yet. ' + (can('team') ? 'Ask the person who installed Kargo for you.' : 'Ask your business owner.') + '</div>';
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
