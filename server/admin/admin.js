/* Kargo platform admin — dashboard. No inline scripts or handlers (strict CSP); every action goes through data-act. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { me: null, plans: null };
  const num = (v) => Number(v) || 0;
  const money = (n, cur) => (n === null || n === undefined ? '—' : String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' ' + (!cur || cur === 'XAF' ? 'FCFA' : cur));
  const fmtD = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const fmtDT = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const ago = (d) => { if (!d) return 'never'; const s = (Date.now() - new Date(d).getTime()) / 1000; if (s < 90) return 'just now'; if (s < 5400) return Math.round(s / 60) + ' min ago'; if (s < 129600) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' days ago'; };
  const daysLeft = (d) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 864e5) : null);
  const can = (p) => !!S.me && (S.me.admin.perms.includes('*') || S.me.admin.perms.includes(p));
  const STATUS = { trialing: ['Free trial', 'info'], active: ['Active', 'ok'], past_due: ['Payment overdue', 'warn'], expired: ['Expired', 'bad'], suspended: ['Suspended', 'bad'], cancelled: ['Cancelled', 'warn'] };
  const stBadge = (s) => { const x = STATUS[s] || [s || '—', '']; return '<span class="badge ' + x[1] + '">' + esc(x[0]) + '</span>'; };
  const INV = { open: 'warn', paid: 'ok', void: '' }; const PAY = { pending: 'warn', confirmed: 'ok', rejected: 'bad' };
  const badge = (t, cls) => '<span class="badge ' + (cls || '') + '">' + esc(t) + '</span>';
  const METHODS = ['MTN MoMo', 'Orange Money', 'Bank transfer', 'Cash', 'Other'];

  /* ---------- toasts, modals, forms ---------- */
  function toast(msg, bad) { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; $('#toasts').appendChild(t); setTimeout(() => t.remove(), bad ? 6000 : 3500); }
  let modalDone = null;
  function modal({ title, body, foot, wide }) {
    const m = $('#modal');
    m.innerHTML = '<div class="box' + (wide ? ' wide' : '') + '"><header><h2 id="mTitle">' + esc(title) + '</h2><button class="btn ghost sm" data-close aria-label="Close">✕</button></header><div class="body">' + body + '</div>' + (foot ? '<footer>' + foot + '</footer>' : '') + '</div>';
    m.classList.remove('hide'); const f = $('input:not([type=hidden]):not([disabled]), select, textarea', m); setTimeout(() => (f || $('[data-close]', m)).focus(), 20);
    return $('.box', m);
  }
  function closeModal() { $('#modal').classList.add('hide'); $('#modal').innerHTML = ''; if (modalDone) { const d = modalDone; modalDone = null; d(false); } }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').classList.contains('hide')) closeModal(); });
  const field = (label, html, cls) => '<label class="f' + (cls ? ' ' + cls : '') + '">' + esc(label) + html + '</label>';
  const inp = (name, val, attrs) => '<input class="inp" name="' + name + '" value="' + esc(val === null || val === undefined ? '' : val) + '" ' + (attrs || '') + '>';
  const sel = (name, opts, val, attrs) => '<select class="inp" name="' + name + '" ' + (attrs || '') + '>' + opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return '<option value="' + esc(v) + '"' + (String(v) === String(val === null || val === undefined ? '' : val) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') + '</select>';
  const vals = (root) => { const o = {}; $$('[name]', root).forEach((el) => { o[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); }); return o; };
  async function busy(btn, fn) { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { if (!e.quiet) toast(e.message, true); } finally { if (btn) btn.disabled = false; } }
  const table = (cols, rows, opts = {}) => rows.length ? '<div class="tw"><table class="t"><thead><tr>' + cols.map((c) => '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.label) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map((r) => '<tr' + (opts.href ? ' class="click" data-go="' + esc(opts.href(r)) + '" tabindex="0"' : '') + '>' + cols.map((c) => '<td' + (c.num ? ' class="num"' : '') + '>' + c.v(r) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '<div class="empty">' + esc(opts.empty || 'Nothing here yet.') + '</div>';

  /* ---------- API ---------- */
  async function api(method, path, body, retry = true) {
    const r = await fetch('/api/admin' + path, { method, credentials: 'same-origin', headers: Object.assign({ 'x-kargo-admin': '1' }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const j = (r.headers.get('content-type') || '').includes('json') ? await r.json().catch(() => ({})) : {};
    if (r.status === 404 && S.me && !path.startsWith('/auth/')) { S.me = null; closeModal(); renderLogin('Your session ended. Please sign in again.'); throw Object.assign(new Error('signed out'), { quiet: true }); }
    if (r.status === 403 && j.code === 'reauth' && retry) { if (await reauth()) return api(method, path, body, false); throw Object.assign(new Error('cancelled'), { quiet: true }); }
    if (r.status === 403 && j.code === 'change_password') { renderChangePw(); throw Object.assign(new Error(''), { quiet: true }); }
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong (' + r.status + ')'), { status: r.status, code: j.code });
    return j;
  }
  /** risky actions: confirm with the authenticator code, then the action is retried */
  function reauth() {
    return new Promise((resolve) => {
      if (!S.me.twoFactor) { // TODO(2FA): password confirmation until two-step sign-in is back
        const box = modal({ title: 'Confirm it is you', body: '<p class="muted small" style="margin-top:0">This is a sensitive action. Type your password to continue.</p>' + field('Password', inp('password', '', 'type="password" autocomplete="current-password"')),
          foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="raGo">Confirm</button>' });
        modalDone = resolve;
        const go = () => busy($('#raGo', box), async () => { await api('POST', '/auth/reauth', { password: vals(box).password }, false); modalDone = null; closeModal(); resolve(true); });
        $('#raGo', box).onclick = go; box.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        return;
      }
      const box = modal({ title: 'Confirm it is you', body: '<p class="muted small" style="margin-top:0">This action needs a fresh code from your authenticator app.</p>' +
        '<div id="raCode">' + field('6-digit code', inp('code', '', 'class="inp otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*"')) + '</div>' +
        '<div id="raRec" class="hide">' + field('Recovery code', inp('recoveryCode', '', 'autocomplete="off" spellcheck="false"')) + '</div>' +
        '<button type="button" class="link small mt" data-act="raToggle">Use a recovery code instead</button>',
        foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="raGo">Confirm</button>' });
      modalDone = resolve;
      const go = () => busy($('#raGo', box), async () => {
        const v = vals(box); const rec = !$('#raRec', box).classList.contains('hide');
        await api('POST', '/auth/reauth', rec ? { recoveryCode: v.recoveryCode } : { code: v.code }, false);
        modalDone = null; closeModal(); resolve(true);
      });
      $('#raGo', box).onclick = go; box.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  }
  ACT_raToggle = () => { $('#raCode').classList.toggle('hide'); $('#raRec').classList.toggle('hide'); const f = $('#raRec').classList.contains('hide') ? $('#raCode input') : $('#raRec input'); f.focus(); };

  /* ---------- sign-in ---------- */
  const authShell = (inner) => { $('#app').className = ''; $('#app').innerHTML = '<main class="auth"><div class="auth-card"><div class="auth-brand"><div class="mark">K</div><div><b>Kargo</b><div class="tiny faint">Platform admin</div></div></div>' + inner + '</div></main>'; };
  async function pub(path, body) {
    const r = await fetch('/api/admin' + path, { method: 'POST', credentials: 'same-origin', headers: { 'x-kargo-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j;
  }
  function renderLogin(msg) {
    authShell('<h1>Sign in</h1><p class="sub">Restricted area. Every sign-in is recorded.</p>' + (msg ? '<div class="alert warn mb">' + esc(msg) + '</div>' : '') +
      '<form id="lf" class="col" novalidate>' + field('Email', inp('email', '', 'type="email" autocomplete="username" required')) + field('Password', inp('password', '', 'type="password" autocomplete="current-password" required')) +
      '<div class="alert bad hide" id="lerr" role="alert"></div><button class="btn pri block" id="lgo">Continue</button></form>');
    $('#lf').onsubmit = (e) => { e.preventDefault(); const v = vals($('#lf')); if (!v.email || !v.password) return showErr('#lerr', 'Type your email and password.');
      busy($('#lgo'), async () => { try { const r = await pub('/auth/login', v); if (r.next === 'done') return boot(); r.next === 'setup' ? renderSetup(r) : renderCode(r.ticket); } catch (er) { showErr('#lerr', er.message); } }); };
    $('[name=email]').focus();
  }
  const showErr = (sel1, m) => { const e = $(sel1); e.textContent = m; e.classList.remove('hide'); };
  function codeForm(id, withRecovery) {
    return '<form id="' + id + '" class="col" novalidate><div id="cBox">' + field('6-digit code from your authenticator app', inp('code', '', 'class="inp otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*"')) + '</div>' +
      (withRecovery ? '<div id="rBox" class="hide">' + field('Recovery code', inp('recoveryCode', '', 'autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX"')) + '</div><button type="button" class="link small" data-act="recToggle">Lost your phone? Use a recovery code</button>' : '') +
      '<div class="alert bad hide" id="cerr" role="alert"></div><button class="btn pri block" id="cgo">Verify</button></form>';
  }
  ACT_recToggle = (el) => { const r = $('#rBox').classList.toggle('hide'); $('#cBox').classList.toggle('hide'); el.textContent = r ? 'Lost your phone? Use a recovery code' : 'Use the authenticator code'; $(r ? '#cBox input' : '#rBox input').focus(); };
  function renderCode(ticket) {
    authShell('<h1>Two-step verification</h1><p class="sub">Open your authenticator app and type the current code for Kargo Admin.</p>' + codeForm('cf', true));
    const go = () => { const v = vals($('#cf')); const rec = $('#rBox') && !$('#rBox').classList.contains('hide');
      busy($('#cgo'), async () => { try { after(await pub('/auth/verify', rec ? { ticket, recoveryCode: v.recoveryCode } : { ticket, code: v.code })); } catch (er) { showErr('#cerr', er.message); if (/expired/i.test(er.message)) setTimeout(() => renderLogin(er.message), 1200); } }); };
    $('#cf').onsubmit = (e) => { e.preventDefault(); go(); }; $('[name=code]').focus();
    $('[name=code]').addEventListener('input', (e) => { if (/^\d{6}$/.test(e.target.value)) go(); });
  }
  function renderSetup(d) {
    authShell('<h1>Set up two-step verification</h1><p class="sub">Required for every admin. It protects the platform even if your password leaks.</p>' +
      '<ol class="small muted" style="padding-left:18px;margin:0 0 12px"><li>Install an authenticator app (Google Authenticator, Microsoft Authenticator, Authy or 1Password).</li><li>Scan this code with it — or type the key below.</li><li>Type the 6-digit code it shows.</li></ol>' +
      '<div class="qr" aria-label="QR code to scan with your authenticator app">' + d.qr + '</div><div class="secret mb" title="Setup key">' + esc(d.secret) + '</div>' + codeForm('sf', false));
    const go = () => { const v = vals($('#sf')); busy($('#cgo'), async () => { try { after(await pub('/auth/verify', { ticket: d.ticket, code: v.code })); } catch (er) { showErr('#cerr', er.message); } }); };
    $('#sf').onsubmit = (e) => { e.preventDefault(); go(); }; $('[name=code]').focus();
  }
  function after(r) { if (r.recoveryCodes) return renderRecovery(r.recoveryCodes, boot); boot(); }
  function renderRecovery(codes, next) {
    authShell('<h1>Save your recovery codes</h1><p class="sub">If you lose your phone, each code lets you sign in once. They are shown only now — store them in a password manager or print them.</p>' +
      '<div class="codes mb">' + codes.map((c) => '<span>' + esc(c) + '</span>').join('') + '</div>' +
      '<div class="row mb"><button class="btn sm" data-act="copyCodes">Copy</button><button class="btn sm" data-act="dlCodes">Download .txt</button></div>' +
      '<label class="check mb"><input type="checkbox" id="saved"> I have saved these codes somewhere safe</label><button class="btn pri block" id="rgo" disabled>Continue</button>');
    S.codes = codes; $('#saved').onchange = (e) => ($('#rgo').disabled = !e.target.checked); $('#rgo').onclick = () => { S.codes = null; next(); };
  }
  ACT_copyCodes = () => navigator.clipboard.writeText(S.codes.join('\n')).then(() => toast('Copied'), () => toast('Copy failed — select and copy them', true));
  ACT_dlCodes = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['Kargo admin recovery codes — ' + new Date().toISOString().slice(0, 10) + '\nEach code works once.\n\n' + S.codes.join('\n') + '\n'], { type: 'text/plain' })); a.download = 'kargo-admin-recovery-codes.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  function renderChangePw() {
    authShell('<h1>Choose your password</h1><p class="sub">Replace the temporary password. Use at least 12 characters — a few random words work well.</p>' +
      '<form id="pf" class="col" novalidate>' + field('Temporary / current password', inp('current', '', 'type="password" autocomplete="current-password"')) + field('New password', inp('password', '', 'type="password" autocomplete="new-password" minlength="12"')) + field('Type it again', inp('password2', '', 'type="password" autocomplete="new-password"')) +
      '<div class="alert bad hide" id="perr" role="alert"></div><button class="btn pri block" id="pgo">Save password</button></form>');
    $('#pf').onsubmit = (e) => { e.preventDefault(); const v = vals($('#pf'));
      if (v.password.length < 12) return showErr('#perr', 'Use at least 12 characters.'); if (v.password !== v.password2) return showErr('#perr', 'The two passwords are not the same.');
      busy($('#pgo'), async () => { try { await pub('/auth/password', { current: v.current, password: v.password }); toast('Password saved'); boot(); } catch (er) { showErr('#perr', er.message); } }); };
    $('[name=current]').focus();
  }

  /* ---------- shell & routing ---------- */
  const NAV = [['overview', 'Overview', 'tenants.view'], ['tenants', 'Businesses', 'tenants.view'], ['plans', 'Plans', 'plans.view'], ['billing', 'Billing', 'billing'], ['support', 'Support', 'support'], ['health', 'Health', 'health.view'], ['security', 'Security', ''], ['settings', 'Settings', 'plans.view']];
  async function boot() {
    try { S.me = await api('GET', '/me'); } catch (e) { if (!e.quiet) renderLogin(); return; }
    if (S.me.admin.mustChangePassword) return renderChangePw();
    shell(); route();
  }
  function shell() {
    const a = S.me.admin;
    $('#app').className = ''; $('#app').innerHTML = '<div class="shell"><aside class="side" id="side"><div class="brand"><div class="mark">K</div><div>Kargo<small>Platform admin</small></div></div><nav id="nav" class="col" style="gap:2px"></nav><div class="sp"></div>' +
      '<div class="who"><b>' + esc(a.name) + '</b>' + esc(a.email) + ' · ' + esc(a.role) + '<div class="mt"><button class="btn sm block" data-act="logout">Sign out</button></div></div></aside>' +
      '<div class="main"><header class="top"><button class="btn sm menu-btn" data-act="menu" aria-label="Menu">☰</button><h1 id="title"></h1><span class="tiny faint" id="idle"></span></header><main class="view" id="view"></main></div></div>';
    drawNav();
  }
  async function drawNav(counts) {
    const r = (location.hash.slice(2).split('/')[0]) || 'overview';
    $('#nav').innerHTML = NAV.filter(([, , p]) => !p || can(p)).map(([k, l]) => '<a class="nav' + (k === r ? ' on' : '') + '" href="#/' + k + '">' + l + (counts && counts[k] ? '<span class="n">' + counts[k] + '</span>' : '') + '</a>').join('');
  }
  window.addEventListener('hashchange', () => { if (S.me) route(); });
  async function route() {
    if (!S.me) return;
    $('#side') && $('#side').classList.remove('open');
    const parts = location.hash.slice(2).split('/'); let r = parts[0] || 'overview';
    const n = NAV.find((x) => x[0] === r); if (!n || (n[2] && !can(n[2]))) r = can('tenants.view') ? 'overview' : 'security';
    $('#title').textContent = r === 'tenants' && parts[1] ? 'Business' : (NAV.find((x) => x[0] === r) || [0, 'Admin'])[1];
    drawNav(S.counts); const view = $('#view'); view.innerHTML = '<div class="empty">Loading…</div>';
    try { await PAGES[r](view, parts.slice(1)); } catch (e) { if (!e.quiet) view.innerHTML = '<div class="alert bad">' + esc(e.message) + '</div>'; }
    view.focus && window.scrollTo(0, 0);
  }

  /* ---------- pages ---------- */
  const PAGES = {};
  const kpi = (l, v, s, cls, href) => (href ? '<a href="' + href + '" class="card kpi ' + (cls || '') + '" style="text-decoration:none;color:inherit">' : '<div class="card kpi ' + (cls || '') + '">') + '<div class="l">' + esc(l) + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + (href ? '</a>' : '</div>');
  PAGES.overview = async (v) => {
    const d = await api('GET', '/overview'); const st = d.statuses || {};
    S.counts = { billing: d.pendingPayments, support: d.openTickets }; drawNav(S.counts);
    const conv = d.conversion.total ? Math.round(d.conversion.paid / d.conversion.total * 100) + '%' : '—';
    const max = Math.max(1, ...d.revenue.map((x) => x.v));
    const months = []; for (let i = 5; i >= 0; i--) { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - i); months.push(x.toISOString().slice(0, 7)); }
    v.innerHTML =
      '<div class="kpis mb2">' + kpi('Monthly recurring revenue', money(d.mrr), 'active + overdue subscriptions') + kpi('Collected this month', money(d.collectedMonth)) +
      kpi('Paying businesses', (st.active || 0) + (st.past_due || 0), (st.past_due || 0) + ' overdue') + kpi('On free trial', st.trialing || 0, d.signups30 + ' new in 30 days') +
      kpi('Trial → paid', conv, 'last 180 days') + kpi('Lost in 30 days', d.lost30, 'expired or cancelled') +
      kpi('Due this week', money(d.due.week_amount), d.due.week + ' invoice(s)' + (d.due.overdue ? ' · <b style="color:var(--bad)">' + d.due.overdue + ' overdue</b>' : ''), d.due.overdue ? 'alert' : '', can('billing') ? '#/billing/invoices' : '') +
      kpi('Payments to check', d.pendingPayments, 'businesses say they paid', d.pendingPayments ? 'alert' : '', can('billing') ? '#/billing' : '') +
      kpi('Support', d.openTickets, 'open tickets', d.openTickets ? 'alert' : '', can('support') ? '#/support' : '') + kpi('Expired / suspended', (st.expired || 0) + (st.suspended || 0), 'read-only') + '</div>' +
      '<div class="grid2 mb2"><section class="card pad2"><h2 class="mb">Revenue · last 6 months</h2><div class="bars">' + months.map((m) => { const x = d.revenue.find((r) => r.m === m); const val = x ? x.v : 0; return '<div class="bar" title="' + esc(money(val)) + '"><small>' + (val ? esc(Math.round(val / 1000) + 'k') : '') + '</small><span style="height:' + Math.round(val / max * 100) + '%"></span><small>' + esc(new Date(m + '-01').toLocaleDateString('en-GB', { month: 'short' })) + '</small></div>'; }).join('') + '</div></section>' +
      '<section class="card pad2"><h2 class="mb">Newest businesses</h2>' + table([{ label: 'Business', v: (r) => esc(r.name) }, { label: 'Status', v: (r) => stBadge(r.status) }, { label: 'Joined', v: (r) => esc(ago(r.created_at)) }], d.recentSignups, { href: (r) => '#/tenants/' + r.id, empty: 'No businesses yet.' }) + '</section></div>' +
      '<section class="card pad2"><h2 class="mb">Latest payments</h2>' + table([{ label: 'Business', v: (r) => esc(r.tenant) }, { label: 'Amount', num: true, v: (r) => esc(money(r.amount, r.currency)) }, { label: 'Method', v: (r) => esc(r.method) }, { label: 'Paid on', v: (r) => esc(fmtD(r.paid_on)) }, { label: 'Status', v: (r) => badge(r.status, PAY[r.status]) }], d.recentPayments, { href: (r) => '#/tenants/' + r.tenant_id, empty: 'No payments yet.' }) + '</section>';
  };

  PAGES.tenants = async (v, [id]) => {
    if (id) return tenantPage(v, id);
    const f = S.tf || (S.tf = { q: '', status: '', plan: '' }); await plans();
    v.innerHTML = '<div class="row mb"><input class="inp grow" id="tq" placeholder="Search business, owner name, login or email" value="' + esc(f.q) + '" style="max-width:420px">' +
      sel('ts', [['', 'All statuses']].concat(Object.entries(STATUS).map(([k, x]) => [k, x[0]])), f.status, 'id="ts" style="width:auto"') +
      sel('tp', [['', 'All plans']].concat(S.plans.map((p) => [p.id, p.name])), f.plan, 'id="tp" style="width:auto"') +
      '<span class="grow"></span><a class="btn sm" href="/api/admin/export/tenants">Export CSV</a></div><div class="card" id="tl"><div class="empty">Loading…</div></div>';
    let page = 0; let timer;
    const load = async (more) => {
      page = more ? page + 1 : 0;
      const d = await api('GET', '/tenants?q=' + encodeURIComponent(f.q) + '&status=' + f.status + '&plan=' + f.plan + '&page=' + page);
      const html = table([
        { label: 'Business', v: (r) => '<b>' + esc(r.name) + '</b><div class="tiny faint">' + esc(r.owner_name || '') + ' · ' + esc(r.owner_email || r.owner_login || '') + '</div>' },
        { label: 'Plan', v: (r) => esc(r.status === 'trialing' ? 'Trial' : r.plan_name || '—') + (r.price ? '<div class="tiny faint">' + esc(money(r.price)) + ' / ' + (r.cycle === 'yearly' ? 'yr' : 'mo') + '</div>' : '') },
        { label: 'Status', v: (r) => stBadge(r.status) },
        { label: 'Renews / ends', v: (r) => { const dd = r.status === 'trialing' ? r.trial_ends_at : r.current_period_end; const n = daysLeft(dd); return esc(fmtD(dd)) + (n !== null ? '<div class="tiny ' + (n < 0 ? '' : 'faint') + '" style="' + (n < 0 ? 'color:var(--bad)' : '') + '">' + (n < 0 ? Math.abs(n) + ' days ago' : 'in ' + n + ' days') + '</div>' : ''); } },
        { label: 'Users', num: true, v: (r) => esc(r.users) }, { label: 'Last activity', v: (r) => esc(ago(r.last_activity)) }, { label: 'Joined', v: (r) => esc(fmtD(r.created_at)) },
      ], d.tenants, { href: (r) => '#/tenants/' + r.id, empty: 'No business matches.' });
      if (more) { $('#tl tbody').insertAdjacentHTML('beforeend', html.split('<tbody>')[1].split('</tbody>')[0]); } else $('#tl').innerHTML = html;
      $('#tmore') && $('#tmore').remove(); if (d.more) $('#tl').insertAdjacentHTML('afterend', '<div class="row mt"><button class="btn" id="tmore">Show more</button></div>');
      if ($('#tmore')) $('#tmore').onclick = () => load(true);
    };
    $('#tq').oninput = (e) => { f.q = e.target.value; clearTimeout(timer); timer = setTimeout(() => load(), 250); };
    $('#ts').onchange = (e) => { f.status = e.target.value; load(); }; $('#tp').onchange = (e) => { f.plan = e.target.value; load(); };
    await load();
  };
  async function plans(force) { if (!S.plans || force) S.plans = (await api('GET', '/plans')).plans; return S.plans; }
  async function tenantPage(v, id) {
    const d = await api('GET', '/tenants/' + id); const s = d.subscription || {}; const t = d.tenant; S.t = d; await plans();
    $('#title').textContent = t.name;
    const end = s.status === 'trialing' ? s.trial_ends_at : s.current_period_end; const n = daysLeft(end);
    const A = (act, label, cls, perm) => (can(perm) ? '<button class="btn sm ' + (cls || '') + '" data-act="' + act + '">' + label + '</button>' : '');
    const lim = d.limits || {}; const LBL = { maxUsers: 'Team members', maxLocations: 'Branches', maxProducts: 'Items' };
    v.innerHTML = '<div class="row between mb"><div class="row"><a class="btn sm" href="#/tenants">← Businesses</a>' + stBadge(s.status) + (s.suspended_reason ? '<span class="small muted">' + esc(s.suspended_reason) + '</span>' : '') + '</div>' +
      '<div class="row">' + A('tViewAs', 'View as owner', '', 'tenants.impersonate') + A('tResetPw', 'Reset owner password', '', 'tenants.resetOwner') + '</div></div>' +
      '<div class="grid2 mb2"><section class="card pad2"><div class="row between mb"><h2>Subscription</h2><div class="row">' + A('tPlan', 'Change plan', '', 'subs.write') + A('tExtend', 'Extend', '', 'subs.write') + '</div></div>' +
        '<dl class="kv"><dt>Plan</dt><dd>' + esc(s.status === 'trialing' ? 'Free trial' : s.plan_name || '—') + (s.price !== null && s.price !== undefined && s.status !== 'trialing' ? ' · ' + esc(money(s.price, s.currency)) + ' / ' + (s.cycle === 'yearly' ? 'year' : 'month') : '') + '</dd>' +
        '<dt>' + (s.status === 'trialing' ? 'Trial ends' : 'Paid until') + '</dt><dd>' + esc(fmtD(end)) + (n !== null ? ' <span class="faint small">(' + (n < 0 ? Math.abs(n) + ' days ago' : 'in ' + n + ' days') + ')</span>' : '') + '</dd>' +
        '<dt>Grace period</dt><dd>' + esc(s.grace_days) + ' days ' + (can('subs.write') ? '<button class="link small" data-act="tGrace">change</button>' : '') + '</dd><dt>Joined</dt><dd>' + esc(fmtD(t.created_at)) + '</dd>' +
        '<dt>Shop</dt><dd>' + (d.settings.shopSlug ? esc('/s/' + d.settings.shopSlug) + (d.settings.shopEnabled ? '' : ' (off)') : '—') + '</dd><dt>Records</dt><dd>' + esc((d.counts.products || 0) + ' items · ' + (d.counts.sales || 0) + ' sales · ' + (d.counts.customers || 0) + ' customers') + '</dd></dl>' +
        '<div class="row mt">' + (s.status === 'suspended' ? A('tReactivate', 'Reactivate', 'pri', 'tenants.suspend') : A('tSuspend', 'Suspend', 'danger', 'tenants.suspend')) + (s.plan_id && !['cancelled', 'expired', 'suspended'].includes(s.status) ? A('tCancel', 'Cancel at period end', '', 'subs.write') : '') + '</div></section>' +
      '<section class="card pad2"><h2 class="mb">Usage</h2>' + Object.entries(LBL).map(([k, l]) => { const used = d.usage[k]; const max = lim[k]; const pct = max ? Math.min(100, used / max * 100) : 0; return '<div class="mb"><div class="row between small"><span>' + l + '</span><b>' + esc(used) + (max ? ' / ' + esc(max) : ' · unlimited') + '</b></div>' + (max ? '<div class="meter' + (used >= max ? ' full' : '') + '"><span style="width:' + pct + '%"></span></div>' : '') + '</div>'; }).join('') +
        '<div class="small muted">' + ['onlineShop', 'payroll', 'autoReminders'].map((k) => ({ onlineShop: 'Online shop', payroll: 'Payroll', autoReminders: 'Auto reminders' })[k] + ': ' + (lim[k] === false ? '✕' : '✓')).join(' · ') + (s.status === 'trialing' ? ' — everything is open during the trial' : '') + '</div>' +
        '<h3 class="mt2 mb">Owner & team</h3>' + table([{ label: 'Name', v: (u) => esc(u.name) + (u.active ? '' : ' <span class="badge">disabled</span>') }, { label: 'Login', v: (u) => esc(u.email || u.login) }, { label: 'Role', v: (u) => esc(u.role) }, { label: 'Last sign-in', v: (u) => esc(ago(u.last_login_at)) }], d.users) + '</section></div>' +
      '<section class="card pad2 mb2"><div class="row between mb"><h2>Invoices</h2><div class="row">' + A('tInvoice', 'New invoice', '', 'billing.write') + A('tPay', 'Record payment', 'pri', 'billing.write') + '</div></div>' +
        table([{ label: 'Number', v: (i) => '<span class="mono">' + esc(i.number) + '</span>' }, { label: 'Plan', v: (i) => esc((i.plan_name || i.plan_id || '') + ' · ' + i.cycle) }, { label: 'Period', v: (i) => esc(fmtD(i.period_start) + ' → ' + fmtD(i.period_end)) }, { label: 'Amount', num: true, v: (i) => esc(money(i.amount, i.currency)) }, { label: 'Due', v: (i) => esc(fmtD(i.due_date)) }, { label: 'Status', v: (i) => badge(i.status, INV[i.status]) + (i.void_reason ? '<div class="tiny faint">' + esc(i.void_reason) + '</div>' : '') }, { label: '', v: (i) => (i.status === 'open' && can('billing.write') ? '<button class="btn sm" data-act="iVoid" data-id="' + i.id + '">Void</button>' : '') }], d.invoices, { empty: 'No invoices yet.' }) + '</section>' +
      '<section class="card pad2 mb2"><h2 class="mb">Payments</h2>' + payTable(d.payments, false) + '</section>' +
      '<div class="grid2"><section class="card pad2"><h2 class="mb">Recent activity in the business</h2>' + table([{ label: 'When', v: (a) => esc(fmtDT(a.at)) }, { label: 'Who', v: (a) => esc(a.user_name || '') }, { label: 'What', v: (a) => esc(a.action + (a.collection ? ' ' + a.collection : '')) }], d.activity, { empty: 'No activity yet.' }) + '</section>' +
      '<section class="card pad2"><h2 class="mb">Admin actions on this business</h2>' + table([{ label: 'When', v: (a) => esc(fmtDT(a.at)) }, { label: 'Admin', v: (a) => esc(a.admin_email || '') }, { label: 'Action', v: (a) => esc(a.action.replace(/_/g, ' ')) + (a.reason ? '<div class="tiny faint">' + esc(a.reason) + '</div>' : '') }], d.adminLog, { empty: 'None.' }) +
        (d.tickets.length ? '<h3 class="mt2 mb">Support tickets</h3>' + table([{ label: 'Topic', v: (k) => esc(k.topic) }, { label: 'Status', v: (k) => badge(k.status, k.status === 'open' ? 'warn' : '') }, { label: 'Opened', v: (k) => esc(fmtD(k.created_at)) }], d.tickets, { href: (k) => '#/support/' + k.id }) : '') + '</section></div>';
  }
  const payTable = (rows, withTenant) => table([
    withTenant && { label: 'Business', v: (p) => '<a href="#/tenants/' + esc(p.tenant_id) + '">' + esc(p.tenant) + '</a>' },
    { label: 'Paid on', v: (p) => esc(fmtD(p.paid_on)) }, { label: 'Amount', num: true, v: (p) => esc(money(p.amount, p.currency)) }, { label: 'Method', v: (p) => esc(p.method) },
    { label: 'Reference', v: (p) => '<span class="mono">' + esc(p.reference || '—') + '</span>' }, withTenant && { label: 'Invoice', v: (p) => '<span class="mono">' + esc(p.invoice_number || '—') + '</span>' },
    { label: 'Status', v: (p) => badge(p.status, PAY[p.status]) + (p.claimed_by ? '<div class="tiny faint">reported by ' + esc(p.claimed_by) + '</div>' : '') + (p.note ? '<div class="tiny faint">' + esc(p.note) + '</div>' : '') },
    { label: '', v: (p) => (p.status === 'pending' && can('billing.write') ? '<div class="row" style="flex-wrap:nowrap"><button class="btn sm pri" data-act="pConfirm" data-id="' + p.id + '">Confirm</button><button class="btn sm" data-act="pReject" data-id="' + p.id + '">Reject</button></div>' : '') },
  ].filter(Boolean), rows, { empty: 'No payments.' });
  const reasonField = (req) => field('Reason' + (req ? '' : ' (optional)') + ' — kept in the audit log', '<textarea class="inp" name="reason" rows="2" maxlength="300"></textarea>');
  async function subAction(body, okMsg) { await api('POST', '/tenants/' + S.t.tenant.id + '/subscription', body); closeModal(); toast(okMsg); route(); }
  const planOpts = () => S.plans.filter((p) => p.active).map((p) => [p.id, p.name + (p.price_monthly !== null ? ' · ' + money(p.price_monthly) + '/mo' : '') + (p.price_yearly !== null ? ' · ' + money(p.price_yearly) + '/yr' : '')]);
  const ACT = {
    menu: () => $('#side').classList.toggle('open'),
    logout: async () => { await api('POST', '/auth/logout').catch(() => { }); S.me = null; renderLogin('You are signed out.'); },
    tPlan: () => { const s = S.t.subscription; const box = modal({ title: 'Change plan', body: '<div class="col">' + field('Plan', sel('planId', planOpts(), s.plan_id || '')) + '<div class="grid2">' + field('Billed', sel('cycle', [['monthly', 'Monthly'], ['yearly', 'Yearly']], s.cycle)) + field('Price for this business (FCFA)', inp('price', '', 'inputmode="numeric" placeholder="Plan price"')) + '</div>' + field('Paid until (optional)', inp('periodEnd', '', 'type="date"')) + '<div class="tiny muted">Without a date: the current paid period is kept, or one period starts today.</div>' + reasonField(true) + '</div>', foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Change plan</button>' });
      $('#go', box).onclick = (e) => busy(e.target, () => subAction(Object.assign({ action: 'change_plan' }, vals(box)), 'Plan changed')); },
    tExtend: () => { const s = S.t.subscription; const trial = s.status === 'trialing' || (!s.plan_id); const box = modal({ title: trial ? 'Extend the free trial' : 'Extend the paid period', body: '<div class="col">' + field('Days to add', inp('days', '14', 'inputmode="numeric"')) + '<div class="tiny muted">' + (trial ? 'Counted from the trial end (or today if it already ended).' : 'Counted from the paid-until date (or today if it passed). No invoice is made.') + '</div>' + reasonField(false) + '</div>', foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Extend</button>' });
      $('#go', box).onclick = (e) => busy(e.target, () => subAction(Object.assign({ action: trial ? 'extend_trial' : 'extend_period' }, vals(box)), 'Extended')); },
    tGrace: () => { const box = modal({ title: 'Grace period', body: field('Days the business keeps working after the paid period ends', inp('days', S.t.subscription.grace_days, 'inputmode="numeric"')), foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Save</button>' });
      $('#go', box).onclick = (e) => busy(e.target, () => subAction(Object.assign({ action: 'grace' }, vals(box)), 'Saved')); },
    tSuspend: () => { const box = modal({ title: 'Suspend ' + S.t.tenant.name, body: '<div class="alert bad mb">They can still sign in, view and export their data, but cannot record anything until reactivated.</div>' + reasonField(true), foot: '<button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Suspend</button>' });
      $('#go', box).onclick = (e) => busy(e.target, () => subAction(Object.assign({ action: 'suspend' }, vals(box)), 'Suspended')); },
    tReactivate: () => { const box = modal({ title: 'Reactivate ' + S.t.tenant.name, body: reasonField(true), foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Reactivate</button>' });
      $('#go', box).onclick = (e) => busy(e.target, () => subAction(Object.assign({ action: 'reactivate' }, vals(box)), 'Reactivated')); },
    tCancel: () => { const box = modal({ title: 'Cancel at the end of the period', body: '<p class="muted small">They keep full access until ' + esc(fmtD(S.t.subscription.current_period_end)) + ', then the account becomes read-only. No renewal invoice is made.</p>' + reasonField(true), foot: '<button class="btn" data-close>Keep it</button><button class="btn danger" id="go">Cancel subscription</button>' });
      $('#go', box).onclick = (e) => busy(e.target, () => subAction(Object.assign({ action: 'cancel' }, vals(box)), 'Cancelled at period end')); },
    tInvoice: () => { const s = S.t.subscription; const box = modal({ title: 'New invoice', body: '<div class="col">' + field('Plan', sel('planId', planOpts(), s.plan_id || '')) + '<div class="grid2">' + field('Billed', sel('cycle', [['monthly', 'Monthly'], ['yearly', 'Yearly']], s.cycle)) + field('Amount (leave empty for the price)', inp('amount', '', 'inputmode="numeric"')) + '</div>' + field('Due in (days)', inp('dueDays', '7', 'inputmode="numeric"')) + '<label class="check"><input type="checkbox" name="send" checked> Email it to the owner</label></div>', foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Create invoice</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { const r = await api('POST', '/tenants/' + S.t.tenant.id + '/invoices', vals(box)); closeModal(); toast('Invoice ' + r.invoice.number + ' created'); route(); }); },
    tPay: () => payModal(S.t.tenant.id, S.t.invoices.filter((i) => i.status === 'open')),
    iVoid: (el) => { const box = modal({ title: 'Void invoice', body: '<p class="muted small">A void invoice cannot be paid. Pending payment reports on it are rejected.</p>' + reasonField(true), foot: '<button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Void</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { await api('POST', '/invoices/' + el.dataset.id + '/void', vals(box)); closeModal(); toast('Invoice voided'); route(); }); },
    pConfirm: (el) => busy(el, async () => { const r = await api('POST', '/payments/' + el.dataset.id + '/confirm'); toast(r.invoice && r.invoice.status === 'paid' ? 'Confirmed — subscription active until ' + fmtD(r.invoice.period_end) : 'Confirmed'); route(); }),
    pReject: (el) => { const box = modal({ title: 'Reject payment report', body: '<p class="muted small">Only when the money did not arrive. The business sees the reason.</p>' + field('Reason', '<textarea class="inp" name="reason" rows="2"></textarea>'), foot: '<button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Reject</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { await api('POST', '/payments/' + el.dataset.id + '/reject', vals(box)); closeModal(); toast('Rejected'); route(); }); },
    tResetPw: () => { const box = modal({ title: 'Reset the owner password', body: '<p class="muted small">A temporary password is set and emailed to the owner (if they have an email). The business sees this in its activity log.</p>' + reasonField(true), foot: '<button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Reset password</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { const r = await api('POST', '/tenants/' + S.t.tenant.id + '/reset-owner-password', vals(box));
        modal({ title: 'New temporary password', body: '<p class="small">Login: <b>' + esc(r.login) + '</b></p><div class="secret mb">' + esc(r.password) + '</div><p class="small muted">' + (r.emailed === 'sent' ? 'Emailed to ' + esc(r.emailTo) + '.' : 'Not emailed — give it to the owner yourself after checking who they are.') + ' It is not shown again.</p>', foot: '<button class="btn pri" data-close>Done</button>' }); }); },
    tViewAs: () => { const box = modal({ title: 'View as owner (read-only)', body: '<p class="muted small">Opens the business app as its owner for 30 minutes. Nothing can be changed. The business sees “Kargo support viewed your account” with your reason in its activity log.</p>' + reasonField(true), foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Open read-only view</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { const r = await api('POST', '/tenants/' + S.t.tenant.id + '/view', vals(box)); closeModal(); const w = window.open(r.url, '_blank', 'noopener'); if (!w) modal({ title: 'Open the view', body: '<p class="small">Your browser blocked the new tab. <a href="' + esc(r.url) + '" target="_blank" rel="noopener">Open the read-only view</a> (valid 30 minutes).</p>' }); }); },
  };
  function payModal(tenantId, openInvoices) {
    const today = new Date().toISOString().slice(0, 10);
    const box = modal({ title: 'Record a payment', body: '<div class="col">' + field('For invoice', sel('invoiceId', openInvoices.map((i) => [i.id, i.number + ' · ' + money(i.amount, i.currency)]).concat([['', 'No invoice (does not change the subscription)']]), openInvoices[0] ? openInvoices[0].id : '')) +
      '<div class="grid2">' + field('Amount (FCFA)', inp('amount', openInvoices[0] ? openInvoices[0].amount : '', 'inputmode="numeric"')) + field('Paid on', inp('paidOn', today, 'type="date" max="' + today + '"')) + '</div>' +
      '<div class="grid2">' + field('Method', sel('method', METHODS, 'MTN MoMo')) + field('Transaction reference', inp('reference', '', 'autocomplete="off"')) + '</div>' + field('Note (optional)', inp('note', '')) +
      '<div class="tiny muted">Check that the money arrived on your account before recording it. A full payment marks the invoice paid and extends the subscription.</div></div>', foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Record payment</button>' });
    $('[name=invoiceId]', box).onchange = (e) => { const i = openInvoices.find((x) => x.id === e.target.value); if (i) $('[name=amount]', box).value = i.amount; };
    $('#go', box).onclick = (e) => busy(e.target, async () => { const r = await api('POST', '/payments', Object.assign({ tenantId }, vals(box))); closeModal(); toast(r.invoice && r.invoice.status === 'paid' ? 'Recorded — active until ' + fmtD(r.invoice.period_end) : 'Payment recorded'); route(); });
  }

  PAGES.plans = async (v) => {
    const d = await api('GET', '/plans'); S.plans = d.plans; S.limitKeys = d.limitKeys;
    const lim = (p) => { const L = p.limits || {}; const parts = []; Object.entries(d.limitKeys.counts).forEach(([k, l]) => parts.push((L[k] ? L[k] : '∞') + ' ' + l.split(' (')[0])); Object.entries(d.limitKeys.features).forEach(([k, l]) => { if (L[k] === false) parts.push('no ' + l.toLowerCase()); }); return parts.join(' · '); };
    v.innerHTML = '<div class="row between mb"><p class="muted small" style="margin:0">Businesses keep the price they signed up at; new prices apply to new subscriptions and plan changes. During the free trial everything is open.</p>' + (can('plans.write') ? '<button class="btn pri" data-act2="planNew">New plan</button>' : '') + '</div>' +
      '<div class="card">' + table([
        { label: 'Plan', v: (p) => '<b>' + esc(p.name) + '</b> <span class="tiny faint mono">' + esc(p.id) + '</span><div class="tiny faint">' + esc(p.description) + '</div>' },
        { label: 'Monthly', num: true, v: (p) => esc(p.price_monthly === null ? '—' : money(p.price_monthly, p.currency)) }, { label: 'Yearly', num: true, v: (p) => esc(p.price_yearly === null ? '—' : money(p.price_yearly, p.currency)) },
        { label: 'Limits', v: (p) => '<span class="small">' + esc(lim(p)) + '</span>' }, { label: 'Subscribers', num: true, v: (p) => esc(p.subscribers) },
        { label: 'Shown', v: (p) => (p.active ? (p.public ? badge('Public', 'ok') : badge('Hidden')) : badge('Retired', 'bad')) },
        { label: '', v: (p) => (can('plans.write') ? '<button class="btn sm" data-act2="planEdit" data-id="' + esc(p.id) + '">Edit</button>' : '') },
      ], d.plans) + '</div>';
  };
  function planModal(p) {
    const isNew = !p; p = p || { limits: {}, features: [], active: true, public: false, sort: (S.plans || []).length + 1 }; const L = p.limits || {};
    const box = modal({ title: isNew ? 'New plan' : 'Edit ' + p.name, wide: true, body: '<div class="col">' +
      '<div class="grid2">' + (isNew ? field('Code (cannot change later)', inp('id', '', 'placeholder="e.g. pro" autocapitalize="off"')) : '') + field('Name', inp('name', p.name)) + '</div>' + field('Short description', inp('description', p.description)) +
      '<div class="grid3">' + field('Monthly price (FCFA)', inp('price_monthly', p.price_monthly, 'inputmode="numeric" placeholder="not sold monthly"')) + field('Yearly price (FCFA)', inp('price_yearly', p.price_yearly, 'inputmode="numeric" placeholder="not sold yearly"')) + field('Order', inp('sort', p.sort, 'inputmode="numeric"')) + '</div>' +
      '<h3>Limits <span class="tiny faint">(empty = unlimited)</span></h3><div class="grid3">' + Object.entries(S.limitKeys.counts).map(([k, l]) => field(l[0].toUpperCase() + l.slice(1), inp('L_' + k, L[k] || '', 'inputmode="numeric" placeholder="unlimited"'))).join('') + '</div>' +
      '<div class="row">' + Object.entries(S.limitKeys.features).map(([k, l]) => '<label class="check"><input type="checkbox" name="F_' + k + '"' + (L[k] === false ? '' : ' checked') + '> ' + esc(l) + '</label>').join('') + '</div>' +
      field('Lines on the plan card (one per line)', '<textarea class="inp" name="features" rows="4">' + esc((p.features || []).join('\n')) + '</textarea>') +
      '<div class="row"><label class="check"><input type="checkbox" name="active"' + (p.active ? ' checked' : '') + '> Can be chosen</label><label class="check"><input type="checkbox" name="public"' + (p.public ? ' checked' : '') + '> Shown to businesses</label></div></div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">' + (isNew ? 'Create plan' : 'Save plan') + '</button>' });
    $('#go', box).onclick = (e) => busy(e.target, async () => {
      const v = vals(box); const limits = {};
      Object.keys(S.limitKeys.counts).forEach((k) => { if (v['L_' + k] !== '') limits[k] = Number(v['L_' + k]); });
      Object.keys(S.limitKeys.features).forEach((k) => { if (!v['F_' + k]) limits[k] = false; });
      const body = { id: v.id, name: v.name, description: v.description, price_monthly: v.price_monthly, price_yearly: v.price_yearly, sort: v.sort, active: v.active, public: v.public, limits, features: v.features.split('\n') };
      if (isNew) await api('POST', '/plans', body); else await api('PUT', '/plans/' + encodeURIComponent(p.id), body);
      closeModal(); toast('Plan saved'); S.plans = null; route();
    });
  }
  const ACT2 = { planNew: () => planModal(null), planEdit: (el) => planModal(S.plans.find((p) => p.id === el.dataset.id)) };

  PAGES.billing = async (v, [tab]) => {
    tab = tab || 'check';
    const tabs = [['check', 'To check'], ['invoices', 'Invoices'], ['payments', 'Payments']];
    let html = '<nav class="tabs">' + tabs.map(([k, l]) => '<a href="#/billing/' + k + '" class="' + (k === tab ? 'on' : '') + '">' + l + '</a>').join('') + '</nav>';
    if (tab === 'check') {
      const d = await api('GET', '/payments?status=pending');
      html += '<p class="muted small">Businesses tapped “I have paid”. Check the money arrived on your MoMo / Orange Money / bank account with the reference, then confirm.</p><div class="card">' + payTable(d.payments, true) + '</div>';
    } else if (tab === 'invoices') {
      const f = S.if || (S.if = ''); const d = await api('GET', '/invoices?status=' + f);
      html += '<div class="row mb">' + sel('if', [['', 'All'], ['open', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']], f, 'id="if" style="width:auto"') + '<span class="grow"></span><a class="btn sm" href="/api/admin/export/invoices">Export CSV</a></div><div class="card">' +
        table([{ label: 'Number', v: (i) => '<span class="mono">' + esc(i.number) + '</span>' }, { label: 'Business', v: (i) => '<a href="#/tenants/' + esc(i.tenant_id) + '">' + esc(i.tenant) + '</a>' }, { label: 'Plan', v: (i) => esc((i.plan_name || '') + ' · ' + i.cycle) }, { label: 'Amount', num: true, v: (i) => esc(money(i.amount, i.currency)) }, { label: 'Due', v: (i) => esc(fmtD(i.due_date)) + (i.status === 'open' && daysLeft(i.due_date + 'T23:59:59') < 0 ? ' <span class="badge bad">overdue</span>' : '') }, { label: 'Status', v: (i) => badge(i.status, INV[i.status]) }, { label: 'By', v: (i) => '<span class="tiny faint">' + esc(i.created_by) + '</span>' }], d.invoices, { empty: 'No invoices.' }) + '</div>';
    } else {
      const d = await api('GET', '/payments');
      html += '<div class="row mb"><span class="grow"></span><a class="btn sm" href="/api/admin/export/payments">Export CSV</a></div><div class="card">' + payTable(d.payments, true) + '</div>';
    }
    v.innerHTML = html;
    if ($('#if')) $('#if').onchange = (e) => { S.if = e.target.value; route(); };
  };

  PAGES.support = async (v, [id]) => {
    if (id) {
      const d = await api('GET', '/support/' + id); const k = d.ticket;
      v.innerHTML = '<div class="row between mb"><a class="btn sm" href="#/support">← Support</a><div class="row">' + badge(k.status, k.status === 'open' ? 'warn' : k.status === 'answered' ? 'info' : '') + ['open', 'closed'].filter((s) => s !== k.status).map((s) => '<button class="btn sm" data-act3="kStatus" data-v="' + s + '">' + (s === 'open' ? 'Reopen' : 'Close') + '</button>').join('') + '</div></div>' +
        '<section class="card pad2 mb"><h2>' + esc(k.topic) + '</h2><div class="small muted mb">' + esc(k.user_name || '') + ' · ' + (k.tenant ? '<a href="#/tenants/' + esc(k.tenant_id) + '">' + esc(k.tenant) + '</a>' : '') + ' · ' + esc(k.email || 'no email — they will not get a reply by email') + (k.page ? ' · screen: ' + esc(k.page) : '') + '</div>' +
        '<div class="thread">' + d.messages.map((m) => '<div class="msg ' + m.author + '"><div class="meta">' + esc(m.author_name || m.author) + ' · ' + esc(fmtDT(m.created_at)) + '</div>' + esc(m.body) + '</div>').join('') + '</div></section>' +
        '<section class="card pad2"><label class="f">Reply' + '<textarea class="inp" id="kBody" rows="5" placeholder="Your answer is emailed to them"></textarea></label><div class="row mt" style="justify-content:flex-end"><button class="btn" data-act3="kReply" data-close-ticket="1">Send and close</button><button class="btn pri" data-act3="kReply">Send reply</button></div></section>';
      S.ticket = k; return;
    }
    const f = S.sf === undefined ? (S.sf = 'open') : S.sf; const d = await api('GET', '/support?status=' + f);
    v.innerHTML = '<nav class="tabs">' + [['open', 'Open'], ['answered', 'Answered'], ['closed', 'Closed'], ['', 'All']].map(([k2, l]) => '<a href="#/support" data-act3="sTab" data-v="' + k2 + '" class="' + (k2 === f ? 'on' : '') + '">' + l + '</a>').join('') + '</nav><div class="card">' +
      table([{ label: 'Topic', v: (k) => '<b>' + esc(k.topic) + '</b><div class="tiny faint">' + esc((k.last || '').slice(0, 90)) + '</div>' }, { label: 'Business', v: (k) => esc(k.tenant || '') }, { label: 'From', v: (k) => esc(k.user_name || '') }, { label: 'Status', v: (k) => badge(k.status, k.status === 'open' ? 'warn' : '') }, { label: 'Updated', v: (k) => esc(ago(k.updated_at)) }], d.tickets, { href: (k) => '#/support/' + k.id, empty: 'No tickets.' }) + '</div>';
  };
  const ACT3 = {
    sTab: (el, e) => { e.preventDefault(); S.sf = el.dataset.v; route(); },
    kStatus: (el) => busy(el, async () => { await api('POST', '/support/' + S.ticket.id + '/status', { status: el.dataset.v }); route(); }),
    kReply: (el) => busy(el, async () => { const body = $('#kBody').value.trim(); if (body.length < 2) return toast('Write a reply first', true); const r = await api('POST', '/support/' + S.ticket.id + '/reply', { body, close: !!el.dataset.closeTicket }); toast(r.emailed === 'sent' ? 'Reply sent by email' : r.emailed === 'no_email' ? 'Saved — they have no email address' : 'Saved (email ' + r.emailed + ')'); route(); }),
  };

  PAGES.health = async (v) => {
    const d = await api('GET', '/health'); const up = d.uptimeS > 86400 ? Math.round(d.uptimeS / 86400) + ' days' : Math.round(d.uptimeS / 3600) + ' h';
    v.innerHTML = '<div class="kpis mb2">' + kpi('Server up for', esc(up), esc('Node ' + d.node)) + kpi('Database size', esc(d.dbSize)) + kpi('Emails sent (7 days)', esc(d.emails7d.sent || 0), esc((d.emails7d.skipped || 0) + ' not sent (no key) · ' + (d.emails7d.failed || 0) + ' failed'), d.emails7d.failed ? 'alert' : '') + kpi('Latest migration', '<span class="small">' + esc((d.migrations[0] || {}).name || '—') + '</span>') + '</div>' +
      '<div class="grid2 mb2"><section class="card pad2"><h2 class="mb">Security setup</h2><div class="check-list">' + d.security.map((x) => '<div><span class="dot' + (x.ok ? ' ok' : '') + '"></span>' + esc(x.label) + '</div>').join('') + '</div><p class="tiny muted mt">Set these in the server environment (.env). The access gate (Cloudflare Access) and its own host are the strongest layers.</p></section>' +
      '<section class="card pad2"><h2 class="mb">Automatic reminders (latest runs)</h2>' + table([{ label: 'Day', v: (r) => esc(fmtD(r.run_date)) }, { label: 'Business', v: (r) => esc(r.name) }, { label: 'Sent', num: true, v: (r) => esc(r.sent) }], d.reminderRuns, { empty: 'No runs yet.' }) + '</section></div>' +
      '<section class="card pad2"><h2 class="mb">Email failures</h2>' + table([{ label: 'When', v: (r) => esc(fmtDT(r.created_at)) }, { label: 'Kind', v: (r) => esc(r.kind) }, { label: 'To', v: (r) => esc(r.to_addr) }, { label: 'Error', v: (r) => '<span class="small">' + esc(r.error) + '</span>' }], d.emailFailures, { empty: 'No failures. 👍' }) + '</section>';
  };

  PAGES.security = async (v) => {
    const a = S.me.admin; const d = await api('GET', '/admins');
    let html = '<div class="grid2 mb2"><section class="card pad2"><h2 class="mb">My account</h2><dl class="kv"><dt>Name</dt><dd>' + esc(a.name) + '</dd><dt>Email</dt><dd>' + esc(a.email) + '</dd><dt>Role</dt><dd>' + esc(a.role) + '</dd>' + (S.me.twoFactor ? '<dt>Recovery codes left</dt><dd>' + esc(a.recoveryLeft) + (a.recoveryLeft < 3 ? ' <span class="badge warn">make new ones</span>' : '') + '</dd>' : '<dt>Two-step sign-in</dt><dd><span class="badge warn">Off for now</span></dd>') + '</dl>' +
      '<div class="row mt"><button class="btn" data-act4="myPw">Change password</button>' + (S.me.twoFactor ? '<button class="btn" data-act4="myCodes">New recovery codes</button>' : '') + '</div></section>' +
      '<section class="card pad2"><h2 class="mb">Active sessions</h2>' + table([{ label: 'Admin', v: (s) => esc(s.email) + (s.current ? ' <span class="badge ok">this one</span>' : '') }, { label: 'Device', v: (s) => '<span class="tiny">' + esc((s.user_agent || '').slice(0, 60)) + '</span><div class="tiny faint">' + esc(s.ip) + '</div>' }, { label: 'Seen', v: (s) => esc(ago(s.last_seen_at)) }, { label: '', v: (s) => (s.current ? '' : '<button class="btn sm" data-act4="endSession" data-id="' + esc(s.id) + '">End</button>') }], d.sessions) + '</section></div>';
    if (can('admins.manage')) {
      html += '<section class="card pad2 mb2"><div class="row between mb"><h2>Admins</h2><button class="btn pri" data-act4="admAdd">Add admin</button></div>' +
        table([{ label: 'Admin', v: (x) => '<b>' + esc(x.name) + '</b><div class="tiny faint">' + esc(x.email) + '</div>' }, { label: 'Role', v: (x) => esc(x.role) }, { label: 'Two-step', v: (x) => (!S.me.twoFactor ? badge('Off for now') : x.totp_enabled ? badge('On', 'ok') : badge('Not set up', 'warn')) },
          { label: 'Last sign-in', v: (x) => esc(ago(x.last_login_at)) + (x.last_login_ip ? '<div class="tiny faint">' + esc(x.last_login_ip) + '</div>' : '') }, { label: 'Status', v: (x) => (x.active ? (x.locked_until && new Date(x.locked_until) > new Date() ? badge('Locked', 'bad') : badge('Active', 'ok')) : badge('Disabled')) },
          { label: '', v: (x) => (x.id === a.id ? '' : '<div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act4="admRole" data-id="' + x.id + '" data-role="' + esc(x.role) + '" data-name="' + esc(x.name) + '">Change role</button>' + (x.locked_until && new Date(x.locked_until) > new Date() ? '<button class="btn sm" data-act4="adm" data-v="unlock" data-id="' + x.id + '">Unlock</button>' : '') + (S.me.twoFactor ? '<button class="btn sm" data-act4="adm" data-v="reset-2fa" data-id="' + x.id + '">Reset 2-step</button>' : '') + (x.active ? '<button class="btn sm danger" data-act4="adm" data-v="deactivate" data-id="' + x.id + '">Disable</button>' : '<button class="btn sm" data-act4="adm" data-v="reactivate" data-id="' + x.id + '">Enable</button>') + '</div>') }], d.admins) + '</section>';
    }
    if (can('audit.view')) {
      const f = S.af || (S.af = { action: '', admin: '' }); const au = await api('GET', '/audit?action=' + encodeURIComponent(f.action) + '&admin=' + encodeURIComponent(f.admin));
      html += '<section class="card pad2"><div class="row between mb"><h2>Audit log</h2><div class="row">' + inp('afA', f.action, 'placeholder="Action starts with… (e.g. login)" id="afA" style="width:220px"') + inp('afW', f.admin, 'placeholder="Admin email" id="afW" style="width:200px"') + '</div></div>' +
        table([{ label: 'When', v: (e) => esc(fmtDT(e.at)) }, { label: 'Admin', v: (e) => esc(e.admin_email || '') }, { label: 'Action', v: (e) => '<b>' + esc(e.action.replace(/_/g, ' ')) + '</b>' + (e.reason ? '<div class="tiny faint">“' + esc(e.reason) + '”</div>' : '') }, { label: 'Business / target', v: (e) => esc([e.tenant, e.target].filter(Boolean).join(' · ')) }, { label: 'From', v: (e) => '<span class="tiny">' + esc(e.ip || '') + '</span>' }], au.entries) + '<p class="tiny muted mt">Entries can never be changed or deleted.</p></section>';
    }
    v.innerHTML = html;
    let t; ['afA', 'afW'].forEach((id) => { const el = $('#' + id); if (el) el.oninput = () => { clearTimeout(t); t = setTimeout(() => { S.af = { action: $('#afA').value.trim(), admin: $('#afW').value.trim() }; route(); }, 400); }; });
  };
  const ROLE_HELP = { owner: 'Owner — everything, including plans, prices, settings and admins', support: 'Support — businesses, view as owner, owner password resets, support inbox', finance: 'Finance — invoices, payments, subscriptions' };
  const ACT4 = {
    admAdd: () => {
      const box = modal({ title: 'Add an admin', body: '<div class="col">' + field('Full name', inp('name', '', 'autocomplete="off"')) + field('Email', inp('email', '', 'type="email" autocomplete="off"')) +
        field('Role', sel('role', Object.entries(ROLE_HELP), 'support')) + '<label class="check"><input type="checkbox" name="sendEmail" checked> Email them their sign-in details</label>' +
        '<div class="tiny muted">They get a temporary password and choose their own at the first sign-in. Give only the access they need.</div></div>',
        foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Add admin</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => {
        const r = await api('POST', '/admins', vals(box));
        modal({ title: 'Admin added', body: '<p class="small"><b>' + esc(r.admin.name) + '</b> · ' + esc(r.admin.email) + ' · ' + esc(r.admin.role) + '</p><p class="small muted">Temporary password (shown only now):</p><div class="secret mb">' + esc(r.password) + '</div>' +
          '<p class="small muted">' + (r.emailed === 'sent' ? 'Their sign-in details were emailed to them.' : 'Not emailed' + (r.emailed === 'skipped' ? ' (email is not set up on the server)' : '') + ' — send them the address <b>' + esc(r.url) + '</b> and this password in a private way.') + '</p>',
          foot: '<button class="btn pri" data-close>Done</button>' });
        route();
      });
    },
    admRole: (el) => {
      const box = modal({ title: 'Change role · ' + el.dataset.name, body: field('Role', sel('role', Object.entries(ROLE_HELP), el.dataset.role)), foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Save</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { await api('POST', '/admins/' + el.dataset.id + '/role', vals(box)); closeModal(); toast('Role changed'); route(); });
    },
    myPw: () => { const box = modal({ title: 'Change password', body: '<div class="col">' + field('Current password', inp('current', '', 'type="password" autocomplete="current-password"')) + field('New password (12+ characters)', inp('password', '', 'type="password" autocomplete="new-password"')) + field('Type it again', inp('password2', '', 'type="password" autocomplete="new-password"')) + '<div class="tiny muted">Your other sessions are signed out.</div></div>', foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Save</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { const v = vals(box); if (v.password !== v.password2) throw new Error('The two passwords are not the same'); await api('POST', '/auth/password', { current: v.current, password: v.password }); closeModal(); toast('Password changed'); route(); }); },
    myCodes: (el) => busy(el, async () => { const r = await api('POST', '/auth/recovery-codes'); S.codes = r.recoveryCodes; S.me.admin.recoveryLeft = r.recoveryCodes.length;
      modal({ title: 'New recovery codes', body: '<p class="small muted">Your old codes no longer work. Save these now — they are not shown again.</p><div class="codes mb">' + r.recoveryCodes.map((c) => '<span>' + esc(c) + '</span>').join('') + '</div><div class="row"><button class="btn sm" data-act="copyCodes">Copy</button><button class="btn sm" data-act="dlCodes">Download .txt</button></div>', foot: '<button class="btn pri" data-close>I saved them</button>' }); }),
    endSession: (el) => busy(el, async () => { await api('POST', '/sessions/' + el.dataset.id + '/revoke'); toast('Session ended'); route(); }),
    adm: (el) => { const labels = { deactivate: 'Disable this admin (signs them out everywhere)?', reactivate: 'Enable this admin again?', 'reset-2fa': 'Reset two-step verification? They set it up again at next sign-in, and are signed out now.', unlock: 'Unlock this admin?' };
      const box = modal({ title: 'Please confirm', body: '<p>' + esc(labels[el.dataset.v]) + '</p>', foot: '<button class="btn" data-close>Cancel</button><button class="btn ' + (el.dataset.v === 'deactivate' ? 'danger' : 'pri') + '" id="go">Confirm</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { await api('POST', '/admins/' + el.dataset.id + '/' + el.dataset.v); closeModal(); toast('Done'); route(); }); },
  };

  PAGES.settings = async (v) => {
    const s = (await api('GET', '/settings')).settings; const p = s.paymentInstructions; const ro = can('settings.write') ? '' : ' disabled';
    v.innerHTML = '<form id="setf" class="col" style="max-width:760px"><section class="card pad2"><h2 class="mb">How businesses pay you</h2><p class="small muted" style="margin-top:0">Shown on the Billing page in the app and on every invoice email.</p><div class="grid2">' +
      field('MTN MoMo number', inp('momoNumber', p.momoNumber, 'inputmode="tel"' + ro)) + field('MTN MoMo account name', inp('momoName', p.momoName, ro)) + field('Orange Money number', inp('omNumber', p.omNumber, 'inputmode="tel"' + ro)) + field('Orange Money account name', inp('omName', p.omName, ro)) + '</div>' +
      field('Bank details', '<textarea class="inp" name="bank" rows="2"' + ro + '>' + esc(p.bank) + '</textarea>', 'mt') + field('Note to businesses', inp('note', p.note, 'placeholder="e.g. Put your business name in the payment message"' + ro), 'mt') + '</section>' +
      '<section class="card pad2"><h2 class="mb">Subscription rules</h2><div class="grid2">' + field('Free trial for new businesses (days)', inp('trialDays', s.trialDays, 'inputmode="numeric"' + ro)) + field('Grace period after the paid period (days)', inp('graceDays', s.graceDays, 'inputmode="numeric"' + ro)) +
      field('Renewal invoice sent … days before the end', inp('renewalNoticeDays', s.renewalNoticeDays, 'inputmode="numeric"' + ro)) + field('Invoices are due after (days)', inp('invoiceDueDays', s.invoiceDueDays, 'inputmode="numeric"' + ro)) + '</div>' +
      '<p class="tiny muted">The grace period applies to new subscriptions; change it for one business on its page.</p></section>' + (ro ? '' : '<div><button class="btn pri" id="sgo">Save settings</button></div>') + '</form>';
    if (!ro) $('#setf').onsubmit = (e) => { e.preventDefault(); const x = vals($('#setf')); busy($('#sgo'), async () => { await api('PUT', '/settings', { paymentInstructions: { momoNumber: x.momoNumber, momoName: x.momoName, omNumber: x.omNumber, omName: x.omName, bank: x.bank, note: x.note }, trialDays: x.trialDays, graceDays: x.graceDays, renewalNoticeDays: x.renewalNoticeDays, invoiceDueDays: x.invoiceDueDays }); toast('Settings saved'); }); };
  };

  /* ---------- one click handler for everything ---------- */
  var ACT_raToggle, ACT_recToggle, ACT_copyCodes, ACT_dlCodes; // assigned above (hoisted names)
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]'); if (go && !e.target.closest('a,button')) { location.hash = go.dataset.go; return; }
    const el = e.target.closest('[data-act],[data-act2],[data-act3],[data-act4]'); if (!el) return;
    const k = el.dataset.act || el.dataset.act2 || el.dataset.act3 || el.dataset.act4;
    const fn = { raToggle: ACT_raToggle, recToggle: ACT_recToggle, copyCodes: ACT_copyCodes, dlCodes: ACT_dlCodes }[k] || ACT[k] || ACT2[k] || ACT3[k] || ACT4[k];
    if (fn) { if (el.tagName === 'A') e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('tr[data-go]')) location.hash = e.target.dataset.go; });
  boot();
})();
