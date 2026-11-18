/* Aahsso platform admin — dashboard. No inline scripts or handlers (strict CSP); every action goes through data-act. */
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
  const can = (p) => !!S.me && S.me.admin.perms.includes(p); // the server sends the admin's resolved permissions
  const roleName = (id) => (id === 'super' ? 'Super Admin' : ((S.roles || []).find((r) => r.id === id) || {}).name || (S.me && S.me.admin.role === id ? S.me.roleName : id));
  async function loadRoles() { const r = await api('GET', '/roles'); S.roles = r.roles; S.permCatalog = r.catalog; return r; }
  /** grouped checkboxes for a catalog of [key, label, group] */
  const checkGroups = (catalog, isOn, prefix) => { const g = {}; catalog.forEach(([k, l, grp, d]) => (g[grp] = g[grp] || []).push([k, l, d])); return '<div class="cgroups">' + Object.entries(g).map(([grp, items]) => '<fieldset class="cgroup"><legend>' + esc(grp) + ' <button type="button" class="link tiny" data-act="cgAll">all</button></legend>' + items.map(([k, l, d]) => '<label class="check" title="' + esc(d || '') + '"><input type="checkbox" name="' + prefix + k + '"' + (isOn(k) ? ' checked' : '') + '> ' + esc(l) + '</label>').join('') + '</fieldset>').join('') + '</div>'; };
  const STATUS = { trialing: ['Free trial', 'info'], active: ['Active', 'ok'], past_due: ['Payment overdue', 'warn'], expired: ['Expired', 'bad'], suspended: ['Suspended', 'bad'], cancelled: ['Cancelled', 'warn'] };
  const stBadge = (s) => { const x = STATUS[s] || [s || '—', '']; return '<span class="badge ' + x[1] + '">' + esc(x[0]) + '</span>'; };
  const INV = { open: 'warn', paid: 'ok', void: '' }; const PAY = { pending: 'warn', confirmed: 'ok', rejected: 'bad', processing: 'info', failed: 'bad' };
  const PAY_L = { pending: 'to check', processing: 'waiting for the payer', failed: 'failed' };
  const isAuto = (p) => p.provider && p.provider !== 'manual'; // paid through Fapshi, not reported by hand
  const badge = (t, cls) => '<span class="badge ' + (cls || '') + '">' + esc(t) + '</span>';
  /* the two kinds of business: Aahsso Brocan and Aahsso Store */
  const ED = { import: { label: 'Aahsso Brocan', short: 'Brocan', cls: 'info', what: 'buy abroad, ship, receive and sell' }, store: { label: 'Aahsso Store', short: 'Store', cls: 'ok', what: 'buy locally, sell and manage stock' } };
  const edOf = (e) => ED[e] || ED.import;
  const edBadge = (e) => badge(edOf(e).short, edOf(e).cls);
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
  /** four single-digit boxes; onDone(pin) when the 4th digit is typed */
  const pinBoxes = (id) => '<div class="pin" id="' + id + '" role="group" aria-label="4-digit PIN">' + [0, 1, 2, 3].map((i) => '<input class="inp pin-d" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="off" aria-label="Digit ' + (i + 1) + '">').join('') + '</div>';
  function wirePin(box, onDone) {
    const ds = $$('.pin-d', box); const val = () => ds.map((d) => d.value).join('');
    ds.forEach((d, i) => {
      d.addEventListener('input', () => { d.value = d.value.replace(/\D/g, '').slice(-1); if (d.value && ds[i + 1]) ds[i + 1].focus(); if (val().length === 4 && onDone) onDone(val()); });
      d.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !d.value && ds[i - 1]) { ds[i - 1].value = ''; ds[i - 1].focus(); } });
      d.addEventListener('paste', (e) => { const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4); if (t.length) { e.preventDefault(); t.split('').forEach((c, k) => { if (ds[k]) ds[k].value = c; }); (ds[t.length] || ds[3]).focus(); if (t.length === 4 && onDone) onDone(t); } });
    });
    return { val, clear: () => { ds.forEach((d) => (d.value = '')); ds[0].focus(); }, focus: () => ds[0].focus() };
  }
  const vals = (root) => { const o = {}; $$('[name]', root).forEach((el) => { o[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); }); return o; };
  /** a button shows a spinner and cannot be clicked again while its work runs */
  const btnOf = (el) => (el && el.closest ? el.closest('button, a, .btn') : null);
  function setBusy(btn, on) {
    if (!btn) return; const n = (Number(btn.dataset.busy) || 0) + (on ? 1 : -1);
    if (n > 0) { btn.dataset.busy = n; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true'); if (btn.tagName === 'BUTTON') btn.disabled = true; }
    else { delete btn.dataset.busy; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); if (btn.tagName === 'BUTTON') btn.disabled = false; }
  }
  async function busy(el, fn) {
    const btn = btnOf(el); setBusy(btn, true);
    try { return await fn(); } catch (e) { if (!e.quiet) toast(e.message, true); } finally { setBusy(btn, false); }
  }
  const table = (cols, rows, opts = {}) => rows.length ? '<div class="tw"><table class="t"><thead><tr>' + cols.map((c) => '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.label) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map((r) => '<tr' + (opts.href ? ' class="click" data-go="' + esc(opts.href(r)) + '" tabindex="0"' : '') + '>' + cols.map((c) => '<td' + (c.num ? ' class="num"' : '') + '>' + c.v(r) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '<div class="empty">' + esc(opts.empty || 'Nothing here yet.') + '</div>';

  /* ---------- API ---------- */
  async function api(method, path, body, retry = true) {
    const r = await fetch('/api/admin' + path, { method, credentials: 'same-origin', headers: Object.assign({ 'x-aahsso-admin': '1' }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const j = (r.headers.get('content-type') || '').includes('json') ? await r.json().catch(() => ({})) : {};
    if (r.status === 404 && S.me && !path.startsWith('/auth/')) { S.me = null; closeModal(); renderLogin('Your session ended. Please sign in again.'); throw Object.assign(new Error('signed out'), { quiet: true }); }
    if (r.status === 403 && j.code === 'reauth' && retry) { if (await reauth()) return api(method, path, body, false); throw Object.assign(new Error('cancelled'), { quiet: true }); }
    if (r.status === 403 && j.code === 'change_password') { renderChangePw(); throw Object.assign(new Error(''), { quiet: true }); }
    if (r.status === 403 && j.code === 'set_pin') { renderSetPin(); throw Object.assign(new Error(''), { quiet: true }); }
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong (' + r.status + ')'), { status: r.status, code: j.code });
    return j;
  }
  /** risky actions: confirm with the authenticator code, then the action is retried */
  function reauth() {
    return new Promise((resolve) => {
      if (!S.me.twoFactor) { // TODO(2FA): PIN confirmation until two-step sign-in is back
        const box = modal({ title: 'Confirm it is you', body: '<p class="muted small center" style="margin-top:0">This is a sensitive action. Enter your 4-digit PIN.</p>' + pinBoxes('raPin') + '<div class="alert bad hide mt" id="raErr" role="alert"></div>',
          foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="raGo">Confirm</button>' });
        modalDone = resolve; let sending = false;
        const pin = wirePin(box, () => go());
        const go = () => { if (sending || pin.val().length !== 4) return; sending = true; busy($('#raGo', box), async () => {
          try { await api('POST', '/auth/reauth', { pin: pin.val() }, false); modalDone = null; closeModal(); resolve(true); }
          catch (e) { const er = $('#raErr', box); if (er) { er.textContent = e.message; er.classList.remove('hide'); } pin.clear(); }
          finally { sending = false; } }); };
        $('#raGo', box).onclick = go; setTimeout(pin.focus, 30);
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
  const authShell = (inner) => { $('#app').className = ''; $('#app').innerHTML = '<main class="auth"><div class="auth-card"><div class="auth-brand"><div class="mark">A</div><div><b>Aahsso</b><div class="tiny faint">Platform admin</div></div></div>' + inner + '</div></main>'; };
  async function pub(path, body) {
    const r = await fetch('/api/admin' + path, { method: 'POST', credentials: 'same-origin', headers: { 'x-aahsso-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j;
  }
  function renderLogin(msg) {
    authShell('<h1>Sign in</h1>' + (msg ? '<div class="alert warn mb">' + esc(msg) + '</div>' : '') +
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
    authShell('<h1>Two-step verification</h1><p class="sub">Open your authenticator app and type the current code for Aahsso Admin.</p>' + codeForm('cf', true));
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
  ACT_dlCodes = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['Aahsso admin recovery codes — ' + new Date().toISOString().slice(0, 10) + '\nEach code works once.\n\n' + S.codes.join('\n') + '\n'], { type: 'text/plain' })); a.download = 'aahsso-admin-recovery-codes.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  function renderChangePw() {
    authShell('<h1>Choose your password</h1><p class="sub">Replace the temporary password. Use at least 12 characters — a few random words work well.</p>' +
      '<form id="pf" class="col" novalidate>' + field('Temporary / current password', inp('current', '', 'type="password" autocomplete="current-password"')) + field('New password', inp('password', '', 'type="password" autocomplete="new-password" minlength="12"')) + field('Type it again', inp('password2', '', 'type="password" autocomplete="new-password"')) +
      '<div class="alert bad hide" id="perr" role="alert"></div><button class="btn pri block" id="pgo">Save password</button></form>');
    $('#pf').onsubmit = (e) => { e.preventDefault(); const v = vals($('#pf'));
      if (v.password.length < 12) return showErr('#perr', 'Use at least 12 characters.'); if (v.password !== v.password2) return showErr('#perr', 'The two passwords are not the same.');
      busy($('#pgo'), async () => { try { await pub('/auth/password', { current: v.current, password: v.password }); toast('Password saved'); boot(); } catch (er) { showErr('#perr', er.message); } }); };
    $('[name=current]').focus();
  }

  function renderSetPin() {
    authShell('<h1>Create your PIN</h1><p class="sub">Choose 4 digits you will remember. You will enter this PIN to confirm sensitive actions, like changing prices or suspending a business.</p>' +
      '<div class="col"><div><div class="small b mb">New PIN</div>' + pinBoxes('pinA') + '</div><div><div class="small b mb">Type it again</div>' + pinBoxes('pinB') + '</div>' +
      '<div class="alert bad hide" id="perr" role="alert"></div><button class="btn pri block" id="pgo">Save PIN</button><p class="tiny faint" style="margin:0">Not 0000, 1111, 1234 or similar. Never share it.</p></div>');
    const a = wirePin($('#pinA'), () => b.focus()); const b = wirePin($('#pinB'), () => $('#pgo').click());
    $('#pgo').onclick = () => { if (a.val().length !== 4) return showErr('#perr', 'Type 4 digits.'); if (a.val() !== b.val()) { b.clear(); return showErr('#perr', 'The two PINs are not the same.'); }
      busy($('#pgo'), async () => { try { await pub('/auth/pin', { pin: a.val() }); toast('PIN saved'); boot(); } catch (er) { showErr('#perr', er.message); a.clear(); b.clear(); } }); };
    a.focus();
  }

  /* ---------- shell & routing ---------- */
  const NAV = [['overview', 'Overview', 'overview.view', 'home'], ['tenants', 'Businesses', 'tenants.view', 'store'], ['users', 'Users', 'users.view|admins.manage', 'users'], ['plans', 'Plans', 'plans.view', 'tag'], ['billing', 'Billing', 'billing', 'card'], ['support', 'Support', 'support', 'chat'], ['health', 'Health', 'health.view', 'pulse'], ['audit', 'Audit log', 'audit.view', 'list'], ['settings', 'Settings', 'plans.view', 'gear'], ['account', 'My account', '', 'user', true]]; // 5th: not in the menu (avatar menu)
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const canAny = (p) => !p || p.split('|').some(can);
  /* one short line under the title of each page — what it is for */
  const INTRO = { overview: 'Revenue, sign-ups and what needs your attention today.', tenants: 'Every business on Aahsso — search, open one to see its plan, usage and invoices.', users: 'Everyone who signs in to a business — owners and their team. Add, edit, disable, reset passwords.', audit: 'Everything admins did: sign-ins, changes to plans, businesses, users and payments.', account: 'Your details, password, PIN and where you are signed in.', plans: 'What each plan costs and which features and limits it includes.', billing: 'Payments to check, invoices, and money received. Record a payment made outside the app — cash, MoMo, bank.', support: 'Questions and problems sent by businesses from the app.', health: 'Server, database, emails and automatic reminders.', settings: 'How businesses pay you and the subscription rules.' };
  const IC = { home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', store: 'M3 9l1.5-5h15L21 9M3 9h18M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0M5 12v8h14v-8', tag: 'M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01', card: 'M2 6a2 2 0 012-2h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2zM2 10h20M6 15h4', chat: 'M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z', pulse: 'M3 12h4l3-8 4 16 3-8h4', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4', gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z', menu: 'M4 6h16M4 12h16M4 18h16', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4', users: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8', plus: 'M12 5v14M5 12h14', key: 'M15 7a2 2 0 012 2M21 9a6 6 0 01-7.7 5.7L11 17H9v2H7v2H3v-3.6l6.3-6.3A6 6 0 1121 9z', trash: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6', money: 'M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2zM12 15a3 3 0 100-6 3 3 0 000 6zM6 12h.01M18 12h.01', search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3', out: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9' };
  const ic = (n, c) => '<svg class="i' + (c ? ' ' + c : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + IC[n] + '"/></svg>';
  async function boot() {
    try { S.me = await api('GET', '/me'); } catch (e) { if (!e.quiet) renderLogin(); return; }
    if (S.me.admin.mustChangePassword) return renderChangePw();
    if (S.me.admin.needsPin) return renderSetPin();
    shell(); route();
  }
  function shell() {
    const a = S.me.admin;
    $('#app').className = ''; $('#app').innerHTML = '<div class="shell"><aside class="side" id="side" aria-label="Main menu"><div class="brand"><div class="mark">A</div><div>Aahsso<small>Platform admin</small></div></div><nav id="nav" class="col" style="gap:2px"></nav><div class="sp"></div></aside><div class="scrim" id="scrim" data-act="menu"></div>' +
      '<div class="main"><header class="top"><button class="btn sm ghost menu-btn" data-act="menu" aria-label="Open menu" aria-controls="side">' + ic('menu') + '</button><div class="mark tmark" aria-hidden="true">K</div><h1 id="title"></h1><span class="tiny faint" id="idle"></span>' +
      '<div class="am"><button type="button" class="am-btn" id="amBtn" data-act="amToggle" aria-haspopup="menu" aria-expanded="false" aria-controls="amPop" aria-label="Account menu"><span class="uav">' + esc(initials(a.name)) + '</span></button>' +
      '<div class="am-pop hide" id="amPop" role="menu"><div class="am-h"><span class="uav">' + esc(initials(a.name)) + '</span><div class="grow"><b>' + esc(a.name) + '</b><div class="tiny faint am-e">' + esc(a.email) + '</div><span class="badge info mt-s">' + esc(roleName(a.role)) + '</span></div></div>' +
      '<a role="menuitem" href="#/account" class="am-i">' + ic('user', 'sm') + 'My account</a><button type="button" role="menuitem" class="am-i" data-act="logout">' + ic('out', 'sm') + 'Sign out</button></div></div></header><main class="view" id="view" tabindex="-1"></main></div></div>';
    drawNav();
  }
  async function drawNav(counts) {
    const r = (location.hash.slice(2).split('/')[0]) || 'overview';
    $('#nav').innerHTML = NAV.filter(([, , p, , hidden]) => !hidden && canAny(p)).map(([k, l, , i]) => '<a class="nav' + (k === r ? ' on' : '') + '" href="#/' + k + '"' + (k === r ? ' aria-current="page"' : '') + '>' + ic(i) + '<span>' + l + '</span>' + (counts && counts[k] ? '<span class="n">' + counts[k] + '</span>' : '') + '</a>').join('');
  }
  function amOpen(o) { const p = $('#amPop'), b = $('#amBtn'); if (!p) return; p.classList.toggle('hide', !o); b.setAttribute('aria-expanded', o); if (o) $('.am-i', p).focus(); }
  document.addEventListener('click', (e) => { if (!e.target.closest('.am')) amOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#amPop') && !$('#amPop').classList.contains('hide')) { amOpen(false); $('#amBtn').focus(); } });
  window.addEventListener('hashchange', () => { if (S.me) { amOpen(false); route(); } });
  async function route() {
    if (!S.me) return;
    $('#side') && $('#side').classList.remove('open'); $('#scrim') && $('#scrim').classList.remove('on');
    const parts = location.hash.slice(2).split('/'); let r = parts[0] || 'overview';
    if (r === 'security') { r = 'account'; history.replaceState(null, '', '#/account'); } // old link
    const n = NAV.find((x) => x[0] === r); if (!n || !canAny(n[2])) r = can('overview.view') ? 'overview' : can('tenants.view') ? 'tenants' : 'account';
    $('#title').textContent = r === 'tenants' && parts[1] ? 'Business' : (NAV.find((x) => x[0] === r) || [0, 'Admin'])[1];
    drawNav(S.counts); let view = $('#view');
    const soft = view.dataset.page === r && !!$('#tabBody', view); // same page, other tab: keep the header and tabs, reload only the content
    const tb = $('.top'); if (tb) tb.dataset.loading = (Number(tb.dataset.loading) || 0) + 1, tb.classList.add('loading');
    if (!soft) { // a fresh element per page: a slower page that finishes late writes into the old, detached one
      const fresh = view.cloneNode(false); fresh.removeAttribute('data-page'); view.replaceWith(fresh); view = fresh;
      view.innerHTML = '<div class="empty">Loading…</div>';
    }
    try { await PAGES[r](view, parts.slice(1)); if (!soft && INTRO[r] && !(r === 'tenants' && parts[1]) && !$('.page-intro', view)) view.insertAdjacentHTML('afterbegin', '<div class="page-intro"><p>' + esc(INTRO[r]) + '</p></div>'); }
    catch (e) { if (!e.quiet) { const b = $('#tabBody', view); if (b) { b.classList.remove('loading'); b.removeAttribute('aria-busy'); b.innerHTML = '<div class="alert bad">' + esc(e.message) + '</div>'; } else view.innerHTML = '<div class="alert bad">' + esc(e.message) + '</div>'; } }
    finally { if (tb) { const n = Number(tb.dataset.loading) - 1; tb.dataset.loading = n; if (n <= 0) tb.classList.remove('loading'); } }
    if (!soft) window.scrollTo(0, 0);
  }

  /* ---------- tabbed pages: header + tabs drawn once; switching tabs reloads only #tabBody ---------- */
  let tabTok = 0;
  /** returns { body, live(), done(html) }: content is written only while live() — a newer tab click wins */
  function tabbed(v, page, tabs, cur, head) {
    let body = v.dataset.page === page ? $('#tabBody', v) : null;
    if (body) {
      $$('.tabs a', v).forEach((a) => { const on = a.dataset.tab === cur; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      body.classList.add('loading'); body.setAttribute('aria-busy', 'true');
    } else {
      v.innerHTML = (head || '') + (tabs.length > 1 ? '<nav class="tabs" aria-label="Sections">' + tabs.map(([k, l, href]) => '<a href="' + href + '" data-tab="' + esc(k) + '" class="' + (k === cur ? 'on' : '') + '"' + (k === cur ? ' aria-current="page"' : '') + '>' + esc(l) + '</a>').join('') + '</nav>' : '') +
        '<div id="tabBody" class="tab-body"><div class="empty">Loading…</div></div>';
      v.dataset.page = page; body = $('#tabBody', v);
    }
    const tok = ++tabTok;
    const live = () => tok === tabTok && body.isConnected;
    const done = (html) => { if (!live()) return false; body.innerHTML = html; body.classList.remove('loading'); body.removeAttribute('aria-busy'); return true; };
    return { body, live, done };
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
      kpi('Businesses by type', Object.keys(ED).map((k) => '<span title="' + esc(ED[k].label) + '">' + esc(ED[k].short) + ' ' + ((d.editions || {})[k] || 0) + '</span>').join(' · '), Object.keys(ED).map((k) => esc(ED[k].short) + ' ' + ((d.signupsByEdition || {})[k] || 0) + ' new · ' + esc(money((d.mrrByEdition || {})[k] || 0)) + '/mo').join('<br>'), '', '#/tenants') +
      kpi('Trial → paid', conv, 'last 180 days') + kpi('Lost in 30 days', d.lost30, 'expired or cancelled') +
      kpi('Due this week', money(d.due.week_amount), d.due.week + ' invoice(s)' + (d.due.overdue ? ' · <b style="color:var(--bad)">' + d.due.overdue + ' overdue</b>' : ''), d.due.overdue ? 'alert' : '', can('billing') ? '#/billing/invoices' : '') +
      kpi('Payments to check', d.pendingPayments, 'businesses say they paid', d.pendingPayments ? 'alert' : '', can('billing') ? '#/billing' : '') +
      kpi('Support', d.openTickets, 'open tickets', d.openTickets ? 'alert' : '', can('support') ? '#/support' : '') + kpi('Expired / suspended', (st.expired || 0) + (st.suspended || 0), 'read-only') + '</div>' +
      '<div class="grid2 mb2"><section class="card pad2"><h2 class="mb">Revenue · last 6 months</h2><div class="bars">' + months.map((m) => { const x = d.revenue.find((r) => r.m === m); const val = x ? x.v : 0; return '<div class="bar" title="' + esc(money(val)) + '"><small>' + (val ? esc(Math.round(val / 1000) + 'k') : '') + '</small><span style="height:' + Math.round(val / max * 100) + '%"></span><small>' + esc(new Date(m + '-01').toLocaleDateString('en-GB', { month: 'short' })) + '</small></div>'; }).join('') + '</div></section>' +
      '<section class="card pad2"><h2 class="mb">Newest businesses</h2>' + table([{ label: 'Business', v: (r) => esc(r.name) }, { label: 'Type', v: (r) => edBadge(r.edition) }, { label: 'Status', v: (r) => stBadge(r.status) }, { label: 'Joined', v: (r) => esc(ago(r.created_at)) }], d.recentSignups, { href: (r) => '#/tenants/' + r.id, empty: 'No businesses yet.' }) + '</section></div>' +
      '<section class="card pad2"><h2 class="mb">Latest payments</h2>' + table([{ label: 'Business', v: (r) => esc(r.tenant) }, { label: 'Amount', num: true, v: (r) => esc(money(r.amount, r.currency)) }, { label: 'Method', v: (r) => esc(r.method) }, { label: 'Paid on', v: (r) => esc(fmtD(r.paid_on)) }, { label: 'Status', v: (r) => badge(r.status, PAY[r.status]) }], d.recentPayments, { href: (r) => '#/tenants/' + r.tenant_id, empty: 'No payments yet.' }) + '</section>';
  };

  PAGES.tenants = async (v, [id]) => {
    if (id) return tenantPage(v, id);
    const f = S.tf || (S.tf = { q: '', status: '', plan: '', edition: '' }); await plans();
    v.innerHTML = '<div class="row mb toolbar"><label class="search"><span class="sr-only">Search businesses</span>' + ic('search', 'sm') + '<input class="inp" id="tq" type="search" placeholder="Search business, owner, login or email" value="' + esc(f.q) + '"></label>' +
      sel('te', [['', 'Brocan & Store']].concat(Object.entries(ED).map(([k, x]) => [k, x.label])), f.edition, 'id="te" style="width:auto"') +
      sel('ts', [['', 'All statuses']].concat(Object.entries(STATUS).map(([k, x]) => [k, x[0]])), f.status, 'id="ts" style="width:auto"') +
      sel('tp', [['', 'All plans']].concat(S.plans.filter((p) => !f.edition || p.edition === f.edition).map((p) => [p.id, p.name + ' · ' + edOf(p.edition).short])), f.plan, 'id="tp" style="width:auto"') +
      '<span class="grow"></span>' + (can('export') ? '<a class="btn sm" data-act="dl" href="/api/admin/export/tenants">Export CSV</a>' : '') + '</div><div class="card" id="tl"><div class="empty">Loading…</div></div>';
    let page = 0; let timer;
    const load = async (more) => {
      page = more ? page + 1 : 0;
      const d = await api('GET', '/tenants?q=' + encodeURIComponent(f.q) + '&status=' + f.status + '&plan=' + f.plan + '&edition=' + f.edition + '&page=' + page);
      const html = table([
        { label: 'Business', v: (r) => '<b>' + esc(r.name) + '</b><div class="tiny faint">' + esc(r.owner_name || '') + ' · ' + esc(r.owner_email || r.owner_login || '') + '</div>' },
        { label: 'Type', v: (r) => edBadge(r.edition) },
        { label: 'Plan', v: (r) => esc(r.status === 'trialing' ? 'Trial' : r.plan_name || '—') + (r.price ? '<div class="tiny faint">' + esc(money(r.price)) + ' / ' + (r.cycle === 'yearly' ? 'yr' : 'mo') + '</div>' : '') },
        { label: 'Status', v: (r) => stBadge(r.status) },
        { label: 'Renews / ends', v: (r) => { const dd = r.status === 'trialing' ? r.trial_ends_at : r.current_period_end; const n = daysLeft(dd); return esc(fmtD(dd)) + (n !== null ? '<div class="tiny ' + (n < 0 ? '' : 'faint') + '" style="' + (n < 0 ? 'color:var(--bad)' : '') + '">' + (n < 0 ? Math.abs(n) + ' days ago' : 'in ' + n + ' days') + '</div>' : ''); } },
        { label: 'Users', num: true, v: (r) => esc(r.users) }, { label: 'Last activity', v: (r) => esc(ago(r.last_activity)) }, { label: 'Joined', v: (r) => esc(fmtD(r.created_at)) },
      ], d.tenants, { href: (r) => '#/tenants/' + r.id, empty: 'No business matches.' });
      if (more) { $('#tl tbody').insertAdjacentHTML('beforeend', html.split('<tbody>')[1].split('</tbody>')[0]); } else $('#tl').innerHTML = html;
      $('#tmore') && $('#tmore').parentElement.remove(); if (d.more) $('#tl').insertAdjacentHTML('afterend', '<div class="row mt"><button class="btn" id="tmore">Show more</button></div>');
      if ($('#tmore')) $('#tmore').onclick = (e) => busy(e.currentTarget, () => load(true));
    };
    $('#tq').oninput = (e) => { f.q = e.target.value; clearTimeout(timer); timer = setTimeout(() => load(), 250); };
    $('#ts').onchange = (e) => { f.status = e.target.value; load(); }; $('#tp').onchange = (e) => { f.plan = e.target.value; load(); };
    $('#te').onchange = (e) => { f.edition = e.target.value; if (f.plan && (S.plans.find((p) => p.id === f.plan) || {}).edition !== f.edition && f.edition) f.plan = ''; route(); };
    await load();
  };
  async function plans(force) { if (!S.plans || force) S.plans = (await api('GET', '/plans')).plans; return S.plans; }
  async function tenantPage(v, id) {
    const [d] = await Promise.all([api('GET', '/tenants/' + id), plans()]); const s = d.subscription || {}; const t = d.tenant; S.t = d;
    $('#title').textContent = t.name;
    const end = s.status === 'trialing' ? s.trial_ends_at : s.current_period_end; const n = daysLeft(end);
    const A = (act, label, cls, perm) => (can(perm) ? '<button class="btn sm ' + (cls || '') + '" data-act="' + act + '">' + label + '</button>' : '');
    const lim = d.limits || {}; const LBL = { maxUsers: 'Team members', maxLocations: 'Branches', maxProducts: 'Items' };
    v.innerHTML = '<div class="row between mb"><div class="row"><a class="btn sm" href="#/tenants">← Businesses</a>' + stBadge(s.status) + (s.suspended_reason ? '<span class="small muted">' + esc(s.suspended_reason) + '</span>' : '') + '</div>' +
      '<div class="row">' + A('tViewAs', 'View as owner', '', 'tenants.impersonate') + A('tResetPw', 'Reset owner password', '', 'tenants.resetOwner') + (can('users.view') ? '<button class="btn sm" data-act5="uForTenant">' + ic('users', 'sm') + 'Users</button>' : '') + '</div></div>' +
      '<div class="grid2 mb2"><section class="card pad2"><div class="row between mb"><h2>Subscription</h2><div class="row">' + A('tPlan', 'Change plan', '', 'subs.write') + A('tExtend', 'Extend', '', 'subs.write') + '</div></div>' +
        '<dl class="kv"><dt>Type</dt><dd>' + edBadge(t.edition) + ' <span class="small muted">' + esc(edOf(t.edition).what) + '</span> ' + (can('tenants.edition') ? '<button class="link small" data-act="tEdition">switch</button>' : '') + '</dd><dt>Plan</dt><dd>' + esc(s.status === 'trialing' ? 'Free trial' : s.plan_name || '—') + (s.price !== null && s.price !== undefined && s.status !== 'trialing' ? ' · ' + esc(money(s.price, s.currency)) + ' / ' + (s.cycle === 'yearly' ? 'year' : 'month') : '') + '</dd>' +
        '<dt>' + (s.status === 'trialing' ? 'Trial ends' : 'Paid until') + '</dt><dd>' + esc(fmtD(end)) + (n !== null ? ' <span class="faint small">(' + (n < 0 ? Math.abs(n) + ' days ago' : 'in ' + n + ' days') + ')</span>' : '') + '</dd>' +
        '<dt>Grace period</dt><dd>' + esc(s.grace_days) + ' days ' + (can('subs.write') ? '<button class="link small" data-act="tGrace">change</button>' : '') + '</dd><dt>Joined</dt><dd>' + esc(fmtD(t.created_at)) + '</dd>' +
        '<dt>Shop</dt><dd>' + (d.settings.shopSlug ? esc('/s/' + d.settings.shopSlug) + (d.settings.shopEnabled ? '' : ' (off)') : '—') + '</dd><dt>Records</dt><dd>' + esc((d.counts.products || 0) + ' items · ' + (d.counts.sales || 0) + ' sales · ' + (d.counts.customers || 0) + ' customers') + '</dd></dl>' +
        '<div class="row mt">' + (s.status === 'suspended' ? A('tReactivate', 'Reactivate', 'pri', 'tenants.suspend') : A('tSuspend', 'Suspend', 'danger', 'tenants.suspend')) + (s.plan_id && !['cancelled', 'expired', 'suspended'].includes(s.status) ? A('tCancel', 'Cancel at period end', '', 'subs.write') : '') + '</div></section>' +
      '<section class="card pad2"><h2 class="mb">Usage</h2>' + Object.entries(LBL).map(([k, l]) => { const used = d.usage[k]; const max = lim[k]; const pct = max ? Math.min(100, used / max * 100) : 0; return '<div class="mb"><div class="row between small"><span>' + l + '</span><b>' + esc(used) + (max ? ' / ' + esc(max) : ' · unlimited') + '</b></div>' + (max ? '<div class="meter' + (used >= max ? ' full' : '') + '"><span style="width:' + pct + '%"></span></div>' : '') + '</div>'; }).join('') +
        '<div class="row between mt"><h3>Features</h3>' + (can('tenants.features') ? '<button class="btn sm" data-act="tFeatures">Customize for this business</button>' : '') + '</div>' +
        '<div class="small muted mb">' + (s.status === 'trialing' ? 'Everything is open during the free trial.' : 'From the plan' + (Object.keys((s.overrides || {}).modules || {}).length || Object.keys((s.overrides || {}).limits || {}).length ? ', with this business\'s own changes.' : '.')) + '</div>' +
        '<div class="fchips">' + d.catalog.map(([k, l]) => { const on = d.features[k] !== false; const ovr = ((s.overrides || {}).modules || {})[k]; return '<span class="fchip ' + (on ? 'on' : 'off') + '" title="' + esc(ovr === undefined ? 'from the plan' : 'changed for this business') + '">' + (on ? '✓ ' : '✕ ') + esc(l) + (ovr !== undefined ? ' *' : '') + '</span>'; }).join('') + '</div>' +
        '<h3 class="mt2 mb">Owner & team</h3>' + table([{ label: 'Name', v: (u) => esc(u.name) + (u.active ? '' : ' <span class="badge">disabled</span>') }, { label: 'Login', v: (u) => esc(u.email || u.login) }, { label: 'Role', v: (u) => esc(u.role) }, { label: 'Last sign-in', v: (u) => esc(ago(u.last_login_at)) }], d.users) + '</section></div>' +
      '<section class="card pad2 mb2"><div class="row between mb"><h2>Invoices</h2><div class="row">' + A('tInvoice', 'New invoice', '', 'billing.write') + A('tPay', 'Record payment', 'pri', 'billing.write') + '</div></div>' +
        table([{ label: 'Number', v: (i) => '<span class="mono">' + esc(i.number) + '</span>' }, { label: 'Plan', v: (i) => esc((i.plan_name || i.plan_id || '') + ' · ' + i.cycle) }, { label: 'Period', v: (i) => esc(fmtD(i.period_start) + ' → ' + fmtD(i.period_end)) }, { label: 'Amount', num: true, v: (i) => esc(money(i.amount, i.currency)) }, { label: 'Due', v: (i) => esc(fmtD(i.due_date)) }, { label: 'Status', v: (i) => badge(i.status, INV[i.status]) + (i.void_reason ? '<div class="tiny faint">' + esc(i.void_reason) + '</div>' : '') }, { label: '', v: (i) => (i.status === 'open' && can('billing.void') ? '<button class="btn sm" data-act="iVoid" data-id="' + i.id + '">Void</button>' : '') }], d.invoices, { empty: 'No invoices yet.' }) + '</section>' +
      '<section class="card pad2 mb2"><h2 class="mb">Payments</h2>' + payTable(d.payments, false) + '</section>' +
      '<div class="grid2"><section class="card pad2"><h2 class="mb">Recent activity in the business</h2>' + table([{ label: 'When', v: (a) => esc(fmtDT(a.at)) }, { label: 'Who', v: (a) => esc(a.user_name || '') }, { label: 'What', v: (a) => esc(a.action + (a.collection ? ' ' + a.collection : '')) }], d.activity, { empty: 'No activity yet.' }) + '</section>' +
      '<section class="card pad2"><h2 class="mb">Admin actions on this business</h2>' + table([{ label: 'When', v: (a) => esc(fmtDT(a.at)) }, { label: 'Admin', v: (a) => esc(a.admin_email || '') }, { label: 'Action', v: (a) => esc(a.action.replace(/_/g, ' ')) + (a.reason ? '<div class="tiny faint">' + esc(a.reason) + '</div>' : '') }], d.adminLog, { empty: 'None.' }) +
        (d.tickets.length ? '<h3 class="mt2 mb">Support tickets</h3>' + table([{ label: 'Topic', v: (k) => esc(k.topic) }, { label: 'Status', v: (k) => badge(k.status, k.status === 'open' ? 'warn' : '') }, { label: 'Opened', v: (k) => esc(fmtD(k.created_at)) }], d.tickets, { href: (k) => '#/support/' + k.id }) : '') + '</section></div>';
  }
  const payTable = (rows, withTenant) => table([
    withTenant && { label: 'Business', v: (p) => '<a href="#/tenants/' + esc(p.tenant_id) + '">' + esc(p.tenant) + '</a>' },
    { label: 'Paid on', v: (p) => esc(fmtD(p.paid_on)) }, { label: 'Amount', num: true, v: (p) => esc(money(p.amount, p.currency)) }, { label: 'Method', v: (p) => esc(p.method) + (isAuto(p) ? '<div class="tiny faint">automatic' + (p.phone ? ' · ' + esc(String(p.phone).replace(/^237/, '')) : '') + '</div>' : '') },
    { label: 'Reference', v: (p) => '<span class="mono">' + esc(p.provider_txn || p.reference || (isAuto(p) ? String(p.provider_ref || '') : '') || '—') + '</span>' }, withTenant && { label: 'Invoice', v: (p) => '<span class="mono">' + esc(p.invoice_number || '—') + '</span>' },
    { label: 'Status', v: (p) => badge(PAY_L[p.status] || p.status, PAY[p.status]) + (p.failure ? '<div class="tiny faint">' + esc(p.failure) + '</div>' : '') + (p.claimed_by ? '<div class="tiny faint">' + (isAuto(p) ? 'started by ' : 'reported by ') + esc(p.claimed_by) + '</div>' : '') + (p.note ? '<div class="tiny faint">' + esc(p.note) + '</div>' : '') },
    { label: '', v: (p) => (p.status === 'pending' && can('billing.write') ? '<div class="row" style="flex-wrap:nowrap"><button class="btn sm pri" data-act="pConfirm" data-id="' + p.id + '">Confirm</button><button class="btn sm" data-act="pReject" data-id="' + p.id + '">Reject</button></div>' : '') },
  ].filter(Boolean), rows, { empty: 'No payments.' });
  const reasonField = (req) => field('Reason' + (req ? '' : ' (optional)') + ' — kept in the audit log', '<textarea class="inp" name="reason" rows="2" maxlength="300"></textarea>');
  async function subAction(body, okMsg) { await api('POST', '/tenants/' + S.t.tenant.id + '/subscription', body); closeModal(); toast(okMsg); route(); }
  const planOpts = (ed) => S.plans.filter((p) => p.active && p.edition === (ed || S.t.tenant.edition)).map((p) => [p.id, p.name + (p.price_monthly !== null ? ' · ' + money(p.price_monthly) + '/mo' : '') + (p.price_yearly !== null ? ' · ' + money(p.price_yearly) + '/yr' : '')]);
  const ACT = {
    cgAll: (el) => { const fs = el.closest('fieldset'); const boxes = $$('input[type=checkbox]', fs); const all = boxes.every((b) => b.checked); boxes.forEach((b) => (b.checked = !all)); },
    tFeatures: () => {
      const d = S.t; const s = d.subscription; const ov = s.overrides || {}; const om = ov.modules || {}; const ol = ov.limits || {}; const pm = s.status === 'trialing' ? {} : s.modules || {}; const pl = s.status === 'trialing' ? {} : s.limits || {};
      const g = {}; d.catalog.forEach(([k, l, grp]) => (g[grp] = g[grp] || []).push([k, l]));
      const box = modal({ title: 'Features for ' + d.tenant.name, wide: true, body: '<p class="small muted" style="margin-top:0">Start from the plan' + (s.plan_name ? ' (' + esc(s.plan_name) + ')' : '') + ', then give or take away single features for this business only.</p>' +
        '<div class="cgroups">' + Object.entries(g).map(([grp, items]) => '<fieldset class="cgroup"><legend>' + esc(grp) + '</legend>' + items.map(([k, l]) => '<div class="frow"><span class="grow">' + esc(l) + ' <span class="tiny faint">plan: ' + (pm[k] === false ? 'off' : 'on') + '</span></span>' + sel('M_' + k, [['', 'As plan'], ['on', 'On'], ['off', 'Off']], om[k] === true ? 'on' : om[k] === false ? 'off' : '', 'style="width:auto;min-height:34px;padding:4px 8px"') + '</div>').join('') + '</fieldset>').join('') + '</div>' +
        '<h3 class="mt">Limits</h3><div class="grid3">' + [['maxUsers', 'Team members'], ['maxLocations', 'Branches'], ['maxProducts', 'Items']].map(([k, l]) => field(l + ' (plan: ' + (pl[k] || '∞') + ')', inp('L_' + k, ol[k] || '', 'inputmode="numeric" placeholder="as plan"'))).join('') + '</div>' +
        reasonField(false), foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Save</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => {
        const v = vals(box); const modules = {}, limits = {};
        d.catalog.forEach(([k]) => { if (v['M_' + k] === 'on') modules[k] = true; if (v['M_' + k] === 'off') modules[k] = false; });
        ['maxUsers', 'maxLocations', 'maxProducts'].forEach((k) => { if (v['L_' + k] !== '') limits[k] = Number(v['L_' + k]); });
        await api('POST', '/tenants/' + d.tenant.id + '/features', { modules, limits, reason: v.reason }); closeModal(); toast('Saved — the business sees the change within seconds'); route();
      });
    },
    menu: () => { const o = $('#side').classList.toggle('open'); $('#scrim').classList.toggle('on', o); },
    amToggle: () => amOpen($('#amPop').classList.contains('hide')),
    /* CSV export: downloaded through the page so the button can show it is working */
    dl: async (el) => {
      const r = await fetch(el.getAttribute('href'), { credentials: 'same-origin' });
      if (!r.ok) throw new Error(r.status === 404 ? 'Your session ended. Sign in again to export.' : 'The export did not work (' + r.status + ')');
      const name = (/filename="?([^";]+)/.exec(r.headers.get('content-disposition') || '') || [])[1] || 'aahsso-export.csv';
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    },
    logout: async () => { await api('POST', '/auth/logout').catch(() => { }); S.me = null; renderLogin('You are signed out.'); },
    tEdition: () => {
      const t = S.t.tenant; const s = S.t.subscription; const to = t.edition === 'store' ? 'import' : 'store'; const opts = planOpts(to); const needPlan = !!s.plan_id;
      const box = modal({ title: 'Switch ' + t.name + ' to ' + ED[to].label, body: '<div class="col">' +
        '<div class="alert ' + (to === 'store' ? 'warn' : 'info') + '">' + (to === 'store' ? 'The business keeps all its data, but <b>Ship</b> and <b>Receive</b> disappear, purchases are in ' + 'local money only, and import costs are no longer shown. Shipments already recorded stay in their item history.' : 'The business gets <b>Ship</b> and <b>Receive</b>: buying abroad, containers, freight and customs. Everything they recorded stays.') + '</div>' +
        (needPlan ? (opts.length ? field('Their ' + ED[to].label + ' plan (they are on ' + esc(s.plan_name || s.plan_id) + ')', sel('planId', opts, '')) + '<div class="tiny muted">Their paid period and billing cycle stay the same; the plan price for their cycle applies from the next invoice. Open invoices for their old plan are voided.</div>'
          : '<div class="alert bad">There is no active ' + esc(ED[to].label) + ' plan yet. Create one on the Plans page first.</div>')
          : '<div class="small muted">They are on the free trial, so no plan changes. Open invoices for ' + esc(ED[t.edition].label) + ' plans are voided.</div>') +
        reasonField(true) + '</div>', foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go"' + (needPlan && !opts.length ? ' disabled' : '') + '>Switch to ' + esc(ED[to].short) + '</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { const r = await api('POST', '/tenants/' + t.id + '/edition', Object.assign({ edition: to }, vals(box))); closeModal(); toast(t.name + ' now uses ' + ED[to].label + (r.voided && r.voided.length ? ' · voided ' + r.voided.join(', ') : '')); route(); });
    },
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
    tPay: () => payModal({ id: S.t.tenant.id, name: S.t.tenant.name, invoices: S.t.invoices.filter((i) => i.status === 'open') }),
    iVoid: (el) => { const box = modal({ title: 'Void invoice', body: '<p class="muted small">A void invoice cannot be paid. Pending payment reports on it are rejected.</p>' + reasonField(true), foot: '<button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Void</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { await api('POST', '/invoices/' + el.dataset.id + '/void', vals(box)); closeModal(); toast('Invoice voided'); route(); }); },
    pConfirm: (el) => busy(el, async () => { const r = await api('POST', '/payments/' + el.dataset.id + '/confirm'); toast(r.invoice && r.invoice.status === 'paid' ? 'Confirmed — subscription active until ' + fmtD(r.invoice.period_end) : 'Confirmed'); route(); }),
    pReject: (el) => { const box = modal({ title: 'Reject payment report', body: '<p class="muted small">Only when the money did not arrive. The business sees the reason.</p>' + field('Reason', '<textarea class="inp" name="reason" rows="2"></textarea>'), foot: '<button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Reject</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { await api('POST', '/payments/' + el.dataset.id + '/reject', vals(box)); closeModal(); toast('Rejected'); route(); }); },
    tResetPw: () => { const box = modal({ title: 'Reset the owner password', body: '<p class="muted small">A temporary password is set and emailed to the owner (if they have an email). The business sees this in its activity log.</p>' + reasonField(true), foot: '<button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Reset password</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { const r = await api('POST', '/tenants/' + S.t.tenant.id + '/reset-owner-password', vals(box));
        modal({ title: 'New temporary password', body: '<p class="small">Login: <b>' + esc(r.login) + '</b></p><div class="secret mb">' + esc(r.password) + '</div><p class="small muted">' + (r.emailed === 'sent' ? 'Emailed to ' + esc(r.emailTo) + '.' : 'Not emailed — give it to the owner yourself after checking who they are.') + ' It is not shown again.</p>', foot: '<button class="btn pri" data-close>Done</button>' }); }); },
    tViewAs: () => { const box = modal({ title: 'View as owner (read-only)', body: '<p class="muted small">Opens the business app as its owner for 30 minutes. Nothing can be changed. The business sees “Aahsso support viewed your account” with your reason in its activity log.</p>' + reasonField(true), foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Open read-only view</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { const r = await api('POST', '/tenants/' + S.t.tenant.id + '/view', vals(box)); closeModal(); const w = window.open(r.url, '_blank', 'noopener'); if (!w) modal({ title: 'Open the view', body: '<p class="small">Your browser blocked the new tab. <a href="' + esc(r.url) + '" target="_blank" rel="noopener">Open the read-only view</a> (valid 30 minutes).</p>' }); }); },
  };
  /* business picker for modals: type to search, pick from the list */
  const tenantPick = () => field('Business', '<input class="inp" id="tpQ" type="search" placeholder="Type the business name…" autocomplete="off">') + '<select class="inp tp-list" id="tpSel" size="5" aria-label="Matching businesses"></select><input type="hidden" name="tenantId" id="tpId">';
  function wireTenantPick(box, onPick) {
    let timer; const sel2 = $('#tpSel', box);
    const load = async () => { const d = await api('GET', '/tenants?q=' + encodeURIComponent($('#tpQ', box).value.trim())); sel2.innerHTML = d.tenants.length ? d.tenants.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.name) + (t.owner_name ? ' — ' + esc(t.owner_name) : '') + '</option>').join('') : '<option value="" disabled>No business matches</option>'; };
    $('#tpQ', box).oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
    sel2.onchange = () => { if (!sel2.value) return; $('#tpId', box).value = sel2.value; onPick(sel2.value, sel2.selectedOptions[0].textContent.split(' — ')[0]); }; // kept in a hidden field: a late search refresh cannot lose the choice
    return load();
  }
  /** Record a payment received outside the app. pre = { id, name, invoices } when opened from a business page. */
  async function payModal(pre) {
    await plans(); const today = new Date().toISOString().slice(0, 10);
    let ed = pre ? S.t.tenant.edition : 'import'; const sellableAll = () => S.plans.filter((p) => p.active && p.edition === ed && (p.price_monthly !== null || p.price_yearly !== null)); let sellable = sellableAll();
    const box = modal({ title: 'Record a payment', body: '<div class="col">' +
      (pre ? '<input type="hidden" name="tenantId" value="' + esc(pre.id) + '"><div class="small">Business: <b>' + esc(pre.name) + '</b></div>' : '<div id="pyPick">' + tenantPick() + '</div><div class="small hide" id="pyBiz"></div>') +
      '<div id="pyFor"></div>' +
      '<div class="grid2">' + field('Amount received (FCFA)', inp('amount', '', 'inputmode="numeric" autocomplete="off"')) + field('Paid on', inp('paidOn', today, 'type="date" max="' + today + '"')) + '</div>' +
      '<div class="grid2">' + field('Method', sel('method', METHODS, 'Cash')) + field('Transaction reference (optional)', inp('reference', '', 'autocomplete="off" placeholder="MoMo / bank reference"')) + '</div>' + field('Note (optional)', inp('note', '', 'placeholder="e.g. paid at the office"')) +
      '<div class="alert" id="pyHint">Check the money really arrived before recording it.</div></div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go"' + (pre ? '' : ' disabled') + '>Record payment</button>' });
    let invoices = [];
    const sync = () => {
      const f = ($('[name=for]', box) || {}).value || ''; const isPlan = f === 'plan';
      $('#pyPlan', box) && $('#pyPlan', box).classList.toggle('hide', !isPlan);
      const amt = $('[name=amount]', box); let hint = 'The payment is kept on the business. It does not change the subscription.';
      if (f.startsWith('inv:')) { const i = invoices.find((x) => 'inv:' + x.id === f); if (i) amt.value = i.amount; hint = 'A full payment marks the invoice paid and starts / extends the subscription.'; }
      if (isPlan) { const p = S.plans.find((x) => x.id === $('[name=planId]', box).value); const cy = $('[name=cycle]', box).value; const pr = p && p['price_' + cy]; if (pr !== null && pr !== undefined) amt.value = pr; hint = 'Creates a paid invoice and makes the subscription active for ' + (cy === 'yearly' ? 'one year' : 'one month') + ' (after the current paid period if it is the same plan). Change the amount for a discount.'; }
      $('#pyHint', box).textContent = hint + ' Check the money really arrived before recording it.';
    };
    const drawFor = () => {
      const opts = invoices.map((i) => ['inv:' + i.id, 'Invoice ' + i.number + ' · ' + money(i.amount, i.currency) + ' · ' + (i.plan_name || i.plan_id || '') + ' ' + i.cycle]).concat(sellable.length ? [['plan', 'A plan — start or renew their subscription']] : [], [['other', 'Something else — does not change the subscription']]);
      $('#pyFor', box).innerHTML = '<div class="col">' + field('What is it for?', sel('for', opts, invoices[0] ? 'inv:' + invoices[0].id : sellable.length ? 'plan' : 'other')) +
        (sellable.length ? '<div class="grid2" id="pyPlan">' + field('Plan', sel('planId', sellable.map((p) => [p.id, p.name]), sellable[0].id)) + field('Period', sel('cycle', [['monthly', '1 month'], ['yearly', '1 year']], 'monthly')) + '</div>' : '') + '</div>';
      $$('[name=for],[name=planId],[name=cycle]', box).forEach((x) => (x.onchange = sync)); sync();
    };
    const pick = async (id, name) => {
      const d = await api('GET', '/tenants/' + id); invoices = d.invoices.filter((i) => i.status === 'open'); ed = d.tenant.edition; sellable = sellableAll();
      if (!pre) { $('#pyPick', box).classList.add('hide'); $('#pyBiz', box).classList.remove('hide'); $('#pyBiz', box).innerHTML = 'Business: <b>' + esc(name) + '</b> <button type="button" class="link small" id="pyChange">change</button>'; $('#pyChange', box).onclick = () => { $('#tpId', box).value = ''; $('#pyPick', box).classList.remove('hide'); $('#pyBiz', box).classList.add('hide'); $('#pyFor', box).innerHTML = ''; $('#go', box).disabled = true; $('#tpQ', box).focus(); }; }
      drawFor(); $('#go', box).disabled = false;
    };
    if (pre) { invoices = pre.invoices; drawFor(); } else await wireTenantPick(box, pick);
    $('#go', box).onclick = (e) => busy(e.target, async () => {
      const v = vals(box); const f = v.for || 'other'; if (!v.tenantId) throw new Error('Choose the business');
      const body = { tenantId: v.tenantId, amount: v.amount, paidOn: v.paidOn, method: v.method, reference: v.reference, note: v.note };
      if (f.startsWith('inv:')) body.invoiceId = f.slice(4); else if (f === 'plan') { body.planId = v.planId; body.cycle = v.cycle; }
      const r = await api('POST', '/payments', body); closeModal();
      toast(r.invoice && r.invoice.status === 'paid' ? 'Recorded — ' + (r.invoice.plan_name || 'subscription') + ' active until ' + fmtD(r.invoice.period_end) : r.invoice ? 'Recorded — part payment, the invoice stays open' : 'Payment recorded'); route();
    });
  }

  /* ---------- users: people who sign in to businesses ---------- */
  const ROLE_L = { owner: 'Owner', admin: 'Admin', manager: 'Manager', sales: 'Sales rep', viewer: 'Viewer' };
  const userRole = (r) => '<span class="badge' + (r === 'owner' ? ' info' : '') + '">' + esc(ROLE_L[r] || r) + '</span>';
  PAGES.users = async (v, [tab]) => {
    const tabs = USER_TABS(); tab = tabs.some((t) => t[0] === (tab || '')) ? tab || '' : tabs[0][0];
    const T = tabbed(v, 'users', tabs.map(([k, l]) => [k, l, '#/users' + (k ? '/' + k : '')]), tab);
    if (tab === 'admins') return adminsTab(T);
    if (tab === 'roles') return rolesTab(T);
    const f = S.uf || (S.uf = { q: '', status: '', role: '', tenant: '', tenantName: '' });
    if (!T.done('<div class="page-intro"><p>' + esc(INTRO.users) + '</p><div class="acts">' + (can('users.write') ? '<button class="btn pri" data-act5="uAdd">' + ic('plus', 'sm') + 'Add user</button>' : '') + '</div></div>' +
      '<div class="kpis mb2" id="ukpi"></div>' +
      '<div class="row mb toolbar"><label class="search"><span class="sr-only">Search users</span>' + ic('search', 'sm') + '<input class="inp" id="uq" type="search" placeholder="Search name, login, email or business" value="' + esc(f.q) + '"></label>' +
      sel('us', [['', 'Active and disabled'], ['active', 'Active'], ['disabled', 'Disabled']], f.status, 'id="us" style="width:auto"') +
      sel('ur', [['', 'All roles'], ['owner', 'Owners'], ['staff', 'Team members']], f.role, 'id="ur" style="width:auto"') +
      (f.tenant ? '<span class="badge info">' + esc(f.tenantName) + ' <button type="button" class="link tiny" data-act5="uClearT" aria-label="Show all businesses">✕</button></span>' : '') + '</div><div class="card" id="ul"><div class="empty">Loading…</div></div>')) return;
    let page = 0; let timer;
    const load = async (more) => {
      page = more ? page + 1 : 0;
      const d = await api('GET', '/users?q=' + encodeURIComponent(f.q) + '&status=' + f.status + '&role=' + f.role + '&tenant=' + encodeURIComponent(f.tenant) + '&page=' + page);
      if (!T.live() || !$('#ul')) return; // another tab was opened meanwhile
      S.users = more ? (S.users || []).concat(d.users) : d.users; const c = d.counts;
      $('#ukpi').innerHTML = kpi('Users', esc(c.total)) + kpi('Active', esc(c.active), esc(c.total - c.active) + ' disabled') + kpi('Owners', esc(c.owners), 'one per business') + kpi('Signed in · 30 days', esc(c.recent));
      const html = table([
        { label: 'User', v: (u) => '<b>' + esc(u.name) + '</b><div class="tiny faint">' + esc(u.login) + '</div>' },
        { label: 'Business', v: (u) => (can('tenants.view') ? '<a href="#/tenants/' + esc(u.tenant_id) + '">' + esc(u.tenant) + '</a>' : esc(u.tenant)) },
        { label: 'Role', v: (u) => userRole(u.role) },
        { label: 'Email', v: (u) => (u.email ? esc(u.email) : '<span class="faint">—</span>') },
        { label: 'Status', v: (u) => (u.active ? badge('Active', 'ok') : badge('Disabled', 'bad')) },
        { label: 'Last sign-in', v: (u) => esc(ago(u.last_login_at)) },
        { label: '', v: (u) => '<div class="row" style="justify-content:flex-end;flex-wrap:nowrap">' + (can('users.write') ? '<button class="btn sm" data-act5="uEdit" data-id="' + esc(u.id) + '">Manage</button>' : '') + '</div>' },
      ], d.users, { empty: 'No user matches.' });
      if (more) $('#ul tbody').insertAdjacentHTML('beforeend', html.split('<tbody>')[1].split('</tbody>')[0]); else $('#ul').innerHTML = html;
      $('#umore') && $('#umore').parentElement.remove(); if (d.more) $('#ul').insertAdjacentHTML('afterend', '<div class="row mt"><button class="btn" id="umore">Show more</button></div>');
      if ($('#umore')) $('#umore').onclick = (e) => busy(e.currentTarget, () => load(true));
    };
    $('#uq').oninput = (e) => { f.q = e.target.value; clearTimeout(timer); timer = setTimeout(() => load(), 250); };
    $('#us').onchange = (e) => { f.status = e.target.value; load(); }; $('#ur').onchange = (e) => { f.role = e.target.value; load(); };
    await load();
  };
  const roleSel = (roles, val, dis) => sel('role', roles.map((r) => [r.id, r.label + (r.custom ? ' (custom)' : '')]), val, dis ? 'disabled' : '');
  async function userAdd(pre) {
    const box = modal({ title: 'Add a user', body: '<div class="col">' +
      (pre ? '<input type="hidden" name="tenantId" value="' + esc(pre.id) + '"><div class="small">Business: <b>' + esc(pre.name) + '</b></div>' : '<div id="uaPick">' + tenantPick() + '</div><div class="small hide" id="uaBiz"></div>') +
      '<div class="grid2">' + field('Full name', inp('name', '', 'autocomplete="off"')) + field('Role', '<span id="uaRole">' + sel('role', [['', 'Choose the business first']], '', 'disabled') + '</span>') + '</div>' +
      '<div class="grid2">' + field('Login (email or phone)', inp('login', '', 'autocomplete="off" spellcheck="false"')) + field('Email (optional)', inp('email', '', 'type="email" autocomplete="off"')) + '</div>' +
      field('Password (leave empty to make one)', inp('password', '', 'type="text" autocomplete="new-password" spellcheck="false" placeholder="At least 6 characters"')) +
      '<label class="check"><input type="checkbox" name="sendEmail" checked> Email them their login and password</label>' +
      '<div class="tiny muted">Counts towards the business\'s plan limit for team members. The business sees this in its activity log.</div></div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Add user</button>' });
    const pick = async (id, name) => {
      const r = await api('GET', '/users/roles?tenant=' + encodeURIComponent(id)); $('#uaRole', box).innerHTML = roleSel(r.roles, 'sales');
      if (!pre) { $('#uaPick', box).classList.add('hide'); $('#uaBiz', box).classList.remove('hide'); $('#uaBiz', box).innerHTML = 'Business: <b>' + esc(name) + '</b> <button type="button" class="link small" id="uaChange">change</button>'; $('#uaChange', box).onclick = () => { $('#tpId', box).value = ''; $('#uaPick', box).classList.remove('hide'); $('#uaBiz', box).classList.add('hide'); }; }
    };
    if (pre) await pick(pre.id, pre.name); else await wireTenantPick(box, pick);
    $('#go', box).onclick = (e) => busy(e.target, async () => {
      const v = vals(box); if (!v.tenantId) throw new Error('Choose the business');
      const r = await api('POST', '/users', v);
      const mail = r.emailed ? (r.emailed.status === 'sent' ? 'Emailed to ' + esc(r.emailed.to) + '.' : r.emailed.status === 'no_email' ? 'Not emailed — no email address.' : 'The email could not be sent.') : 'Not emailed.';
      if (r.password) modal({ title: 'User added', body: '<p class="small">Login: <b>' + esc(r.user.login) + '</b></p><div class="secret mb">' + esc(r.password) + '</div><p class="small muted">' + mail + ' This password is not shown again — they should change it after signing in.</p>', foot: '<button class="btn pri" data-close>Done</button>' });
      else { closeModal(); toast('User added. ' + mail.replace(/<[^>]+>/g, '')); }
      route();
    });
  }
  async function userEdit(id) {
    const u = (S.users || []).find((x) => x.id === id); if (!u) return;
    const r = await api('GET', '/users/roles?tenant=' + encodeURIComponent(u.tenant_id)); const owner = u.role === 'owner';
    const roles = owner ? [{ id: 'owner', label: 'Owner' }] : r.roles.some((x) => x.id === u.role) ? r.roles : r.roles.concat([{ id: u.role, label: u.role }]);
    const box = modal({ title: u.name, body: '<div class="col"><div class="small muted">' + esc(u.tenant) + ' · joined ' + esc(fmtD(u.created_at)) + ' · last sign-in ' + esc(ago(u.last_login_at)) + '</div>' +
      '<div class="grid2">' + field('Full name', inp('name', u.name)) + field('Role', roleSel(roles, u.role, owner)) + '</div>' +
      '<div class="grid2">' + field('Login (email or phone)', inp('login', u.login, 'spellcheck="false"')) + field('Email', inp('email', u.email || '', 'type="email"')) + '</div>' +
      (owner ? '<div class="tiny muted">The owner keeps the Owner role and cannot be disabled or deleted — suspend the business instead.</div>' : '') +
      '<div class="u-more"><h3>Access</h3><div class="row mt">' +
      ((owner && !can('tenants.resetOwner')) ? '' : '<button type="button" class="btn sm" id="uPw">' + ic('key', 'sm') + 'Reset password</button>') +
      (owner ? '' : '<button type="button" class="btn sm" id="uAct">' + (u.active ? 'Disable' : 'Enable') + '</button>') +
      (owner || !can('users.delete') ? '' : '<button type="button" class="btn sm" id="uDel" style="color:var(--bad)">' + ic('trash', 'sm') + 'Delete</button>') + '</div></div></div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Save changes</button>' });
    $('#go', box).onclick = (e) => busy(e.target, async () => { const v = vals(box); const body = { name: v.name, login: v.login, email: v.email }; if (!owner) body.role = v.role; await api('PATCH', '/users/' + id, body); closeModal(); toast('Saved'); route(); });
    $('#uAct', box) && ($('#uAct', box).onclick = (e) => busy(e.target, async () => { await api('PATCH', '/users/' + id, { active: !u.active }); closeModal(); toast(u.active ? u.name + ' can no longer sign in' : u.name + ' can sign in again'); route(); }));
    $('#uPw', box) && ($('#uPw', box).onclick = () => {
      const b2 = modal({ title: 'Reset ' + u.name + '\'s password', body: '<p class="muted small">A new temporary password is made. The old one stops working right away. The business sees this in its activity log.</p><label class="check"><input type="checkbox" name="sendEmail"' + (u.email ? ' checked' : ' disabled') + '> Email it to ' + esc(u.email || 'them (no email address)') + '</label>', foot: '<button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Reset password</button>' });
      $('#go', b2).onclick = (e) => busy(e.target, async () => { const x = await api('POST', '/users/' + id + '/password', vals(b2));
        modal({ title: 'New temporary password', body: '<p class="small">Login: <b>' + esc(x.login) + '</b></p><div class="secret mb">' + esc(x.password) + '</div><p class="small muted">' + (x.emailed && x.emailed.status === 'sent' ? 'Emailed to ' + esc(x.emailed.to) + '.' : 'Not emailed — give it to them yourself after checking who they are.') + ' It is not shown again.</p>', foot: '<button class="btn pri" data-close>Done</button>' }); });
    });
    $('#uDel', box) && ($('#uDel', box).onclick = () => {
      const b2 = modal({ title: 'Delete ' + u.name + '?', body: '<p class="small">They can no longer sign in to <b>' + esc(u.tenant) + '</b>. What they did stays in the business history. This cannot be undone — <b>Disable</b> keeps the account instead.</p>' + reasonField(true), foot: '<button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Delete user</button>' });
      $('#go', b2).onclick = (e) => busy(e.target, async () => { await api('POST', '/users/' + id + '/delete', vals(b2)); closeModal(); toast('User deleted'); route(); });
    });
  }
  const ACT5 = {
    uAdd: () => userAdd(S.uf && S.uf.tenant ? { id: S.uf.tenant, name: S.uf.tenantName } : null),
    uEdit: (el) => userEdit(el.dataset.id),
    uClearT: () => { S.uf.tenant = ''; S.uf.tenantName = ''; route(); },
    uForTenant: () => { S.uf = { q: '', status: '', role: '', tenant: S.t.tenant.id, tenantName: S.t.tenant.name }; location.hash = '#/users'; },
    payAny: () => payModal(null),
  };

  PAGES.plans = async (v) => {
    const d = await api('GET', '/plans'); S.plans = d.plans; S.limitKeys = d.limitKeys;
    S.catalog = d.catalog; S.editions = d.editions;
    const catOf = (ed) => { const e = d.editions.find((x) => x.key === ed) || d.editions[0]; return d.catalog.filter(([k]) => e.features.includes(k)); };
    const lim = (p) => { const L = p.limits || {}; const cat = catOf(p.edition); const off = cat.filter(([k]) => (p.modules || {})[k] === false).length; return Object.entries(d.limitKeys.counts).map(([k, l]) => (L[k] ? L[k] : '∞') + ' ' + l.split(' (')[0]).join(' · ') + ' · ' + (cat.length - off) + '/' + cat.length + ' features'; };
    v.innerHTML = '<div class="page-intro"><p>What each plan costs and which features and limits it includes. Each plan is for one kind of business: <b>Aahsso Brocan</b> or <b>Aahsso Store</b> — a business only sees the plans of its kind. Businesses keep the price they signed up at; new prices apply to new subscriptions and plan changes.</p>' + (can('plans.write') ? '<button class="btn pri" data-act2="planNew">New plan</button>' : '') + '</div>' +
      d.editions.map((e) => { const rows = d.plans.filter((p) => p.edition === e.key); return '<h2 class="mt2 mb row" style="gap:8px">' + edBadge(e.key) + esc(e.label) + ' plans <span class="small muted" style="font-weight:400">' + esc(edOf(e.key).what) + '</span></h2>' +
      (rows.some((p) => p.public && p.active) ? '' : '<div class="alert warn mb"><b>No ' + esc(e.label) + ' plan is shown to businesses yet.</b> ' + esc(e.short) + ' businesses see an empty Plans page until you click <b>Publish</b> on one.</div>') +
      '<div class="card mb2">' + table([
        { label: 'Plan', v: (p) => '<b>' + esc(p.name) + '</b> <span class="tiny faint mono">' + esc(p.id) + '</span><div class="tiny faint">' + esc(p.description) + '</div>' },
        { label: 'Monthly', num: true, v: (p) => (p.price_monthly === null && p.price_yearly === null ? badge('Free · trial', 'info') : esc(p.price_monthly === null ? '—' : money(p.price_monthly, p.currency))) }, { label: 'Yearly', num: true, v: (p) => esc(p.price_yearly === null ? '—' : money(p.price_yearly, p.currency)) },
        { label: 'Limits', v: (p) => '<span class="small">' + esc(lim(p)) + '</span>' }, { label: 'Subscribers', num: true, v: (p) => esc(p.subscribers) },
        { label: 'On the business Plans page', v: (p) => (!p.active ? badge('Retired', 'bad') : (p.public ? badge('Shown', 'ok') : badge('Hidden', 'warn')) + (can('plans.write') ? ' <button class="btn sm" data-act2="planPublish" data-id="' + esc(p.id) + '">' + (p.public ? 'Hide' : 'Publish') + '</button>' : '')) },
        { label: '', v: (p) => (can('plans.write') ? '<button class="btn sm" data-act2="planEdit" data-id="' + esc(p.id) + '">Edit</button>' : '') },
      ], rows, { empty: 'No ' + esc(e.label) + ' plans yet.' }) + '</div>'; }).join('');
  };
  function planModal(p) {
    const isNew = !p; p = p || { edition: '', limits: {}, modules: {}, features: [], active: true, public: false, sort: (S.plans || []).length + 1 }; const L = p.limits || {}; const Mo = p.modules || {};
    const catOf = (ed) => { const e = (S.editions || []).find((x) => x.key === ed); return e ? S.catalog.filter(([k]) => e.features.includes(k)) : []; };
    const locked = !isNew && p.used > 0; // businesses use it: its kind cannot change
    const box = modal({ title: isNew ? 'New plan' : 'Edit ' + p.name, wide: true, body: '<div class="col">' +
      field('For which businesses?', sel('edition', (isNew ? [['', 'Choose…']] : []).concat(Object.entries(ED).map(([k, x]) => [k, x.label + ' — ' + x.what])), p.edition, locked ? 'disabled' : '')) + (locked ? '<div class="tiny muted">Businesses use this plan, so it stays a ' + esc(edOf(p.edition).label) + ' plan. Make a new plan for the other kind.</div>' : '') +
      '<div class="grid2">' + (isNew ? field('Code (cannot change later)', inp('id', '', 'placeholder="e.g. store-pro" autocapitalize="off"')) : '') + field('Name', inp('name', p.name)) + '</div>' + field('Short description', inp('description', p.description)) +
      '<div class="grid3">' + field('Monthly price (FCFA)', inp('price_monthly', p.price_monthly, 'inputmode="numeric" placeholder="no price"')) + field('Yearly price (FCFA)', inp('price_yearly', p.price_yearly, 'inputmode="numeric" placeholder="no price"')) + '<div class="tiny muted" style="grid-column:1/-1">No price at all = a Free plan: businesses get a free trial on it.</div>' + field('Order', inp('sort', p.sort, 'inputmode="numeric"')) + '</div>' +
      '<h3>Limits <span class="tiny faint">(empty = unlimited)</span></h3><div class="grid3">' + Object.entries(S.limitKeys.counts).map(([k, l]) => field(l[0].toUpperCase() + l.slice(1), inp('L_' + k, L[k] || '', 'inputmode="numeric" placeholder="unlimited"'))).join('') + '</div>' +
      '<h3>Features in this plan <span class="tiny faint">(unticked = hidden from the business)</span></h3><div id="plFeat"></div>' +
      field('Lines on the plan card (one per line)', '<textarea class="inp" name="features" rows="4">' + esc((p.features || []).join('\n')) + '</textarea>') +
      '<div class="row"><label class="check"><input type="checkbox" name="active"' + (p.active ? ' checked' : '') + '> Can be chosen</label><label class="check"><input type="checkbox" name="public"' + (p.public ? ' checked' : '') + '> Show on the business Plans page (published)</label></div></div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">' + (isNew ? 'Create plan' : 'Save plan') + '</button>' });
    const edSel = $('[name=edition]', box);
    const drawFeat = () => { const ed = edSel.value; $('#plFeat', box).innerHTML = ed ? checkGroups(catOf(ed), (k) => Mo[k] !== false, 'F_') + (ed === 'store' ? '<div class="tiny muted mt">Shipments and Receiving are never part of Aahsso Store.</div>' : '') : '<div class="small muted">Choose who the plan is for to pick its features.</div>'; };
    edSel.onchange = () => { $$('#plFeat input[type=checkbox]', box).forEach((c) => { const k = c.name.slice(2); if (!c.checked) Mo[k] = false; else delete Mo[k]; }); drawFeat(); }; drawFeat();
    $('#go', box).onclick = (e) => busy(e.target, async () => {
      const v = vals(box); const limits = {}; const ed = edSel.value; if (!ed) throw new Error('Choose who the plan is for: Aahsso Brocan or Aahsso Store');
      Object.keys(S.limitKeys.counts).forEach((k) => { if (v['L_' + k] !== '') limits[k] = Number(v['L_' + k]); });
      const modules = {}; catOf(ed).forEach(([k]) => { if (!v['F_' + k]) modules[k] = false; });
      const body = { edition: ed, id: v.id, name: v.name, description: v.description, price_monthly: v.price_monthly, price_yearly: v.price_yearly, sort: v.sort, active: v.active, public: v.public, limits, modules, features: v.features.split('\n') };
      if (isNew) await api('POST', '/plans', body); else await api('PUT', '/plans/' + encodeURIComponent(p.id), body);
      closeModal(); toast('Plan saved'); S.plans = null; route();
    });
  }
  const ACT2 = {
    planNew: () => planModal(null), planEdit: (el) => planModal(S.plans.find((p) => p.id === el.dataset.id)),
    planPublish: (el) => busy(el, async () => { // one click: show / hide a plan on the business side
      const p = S.plans.find((x) => x.id === el.dataset.id);
      await api('PUT', '/plans/' + encodeURIComponent(p.id), { edition: p.edition, name: p.name, description: p.description, price_monthly: p.price_monthly, price_yearly: p.price_yearly, sort: p.sort, active: p.active, public: !p.public, limits: p.limits || {}, modules: p.modules || {}, features: p.features || [] });
      toast(p.public ? p.name + ' is hidden from businesses' : p.name + ' is now shown to businesses'); S.plans = null; route();
    }),
  };

  PAGES.billing = async (v, [tab]) => {
    tab = tab || 'check';
    const tabs = [['check', 'To check'], ['invoices', 'Invoices'], ['payments', 'Payments']];
    const T = tabbed(v, 'billing', tabs.map(([k, l]) => [k, l, '#/billing/' + k]), tab, '<div class="page-intro"><p>' + esc(INTRO.billing) + '</p><div class="acts">' + (can('billing.write') ? '<button class="btn pri" data-act5="payAny">' + ic('money', 'sm') + 'Record payment</button>' : '') + '</div></div>');
    let html = '';
    if (tab === 'check') {
      const d = await api('GET', '/payments?status=pending');
      html += '<p class="muted small">Businesses tapped “I have paid”. Check the money arrived on your MoMo / Orange Money / bank account with the reference, then confirm.</p><div class="card">' + payTable(d.payments, true) + '</div>';
    } else if (tab === 'invoices') {
      const f = S.if || (S.if = ''); const d = await api('GET', '/invoices?status=' + f);
      html += '<div class="row mb">' + sel('if', [['', 'All'], ['open', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']], f, 'id="if" style="width:auto"') + '<span class="grow"></span>' + (can('export') ? '<a class="btn sm" data-act="dl" href="/api/admin/export/invoices">Export CSV</a>' : '') + '</div><div class="card">' +
        table([{ label: 'Number', v: (i) => '<span class="mono">' + esc(i.number) + '</span>' }, { label: 'Business', v: (i) => '<a href="#/tenants/' + esc(i.tenant_id) + '">' + esc(i.tenant) + '</a>' }, { label: 'Plan', v: (i) => esc((i.plan_name || '') + ' · ' + i.cycle) }, { label: 'Amount', num: true, v: (i) => esc(money(i.amount, i.currency)) }, { label: 'Due', v: (i) => esc(fmtD(i.due_date)) + (i.status === 'open' && daysLeft(i.due_date + 'T23:59:59') < 0 ? ' <span class="badge bad">overdue</span>' : '') }, { label: 'Status', v: (i) => badge(i.status, INV[i.status]) }, { label: 'By', v: (i) => '<span class="tiny faint">' + esc(i.created_by) + '</span>' }], d.invoices, { empty: 'No invoices.' }) + '</div>';
    } else {
      const d = await api('GET', '/payments');
      html += '<div class="row mb"><span class="grow"></span>' + (can('export') ? '<a class="btn sm" data-act="dl" href="/api/admin/export/payments">Export CSV</a>' : '') + '</div><div class="card">' + payTable(d.payments, true) + '</div>';
    }
    if (!T.done(html)) return;
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

  /* ---------- my account (from the avatar menu) ---------- */
  PAGES.account = async (v) => {
    const a = S.me.admin; const d = await api('GET', '/admins');
    v.innerHTML = '<div class="page-intro"><p>' + esc(INTRO.account) + '</p></div><div class="grid2 mb2" style="align-items:start"><section class="card pad2 acct"><div class="acct-h"><span class="uav lg">' + esc(initials(a.name)) + '</span><div><h2>' + esc(a.name) + '</h2><div class="small muted">' + esc(a.email) + '</div></div></div><dl class="kv"><dt>Role</dt><dd>' + esc(roleName(a.role)) + '</dd>' + (S.me.twoFactor ? '<dt>Recovery codes left</dt><dd>' + esc(a.recoveryLeft) + (a.recoveryLeft < 3 ? ' <span class="badge warn">make new ones</span>' : '') + '</dd>' : '<dt>Two-step sign-in</dt><dd><span class="badge warn">Off for now</span></dd>') + '</dl>' +
      '<h3 class="mt2">Sign-in and PIN</h3><p class="tiny muted" style="margin:4px 0 0">Your PIN confirms sensitive actions (deleting, voiding, password resets…).</p><div class="row mt"><button class="btn" data-act4="myPw">' + ic('key', 'sm') + 'Change password</button><button class="btn" data-act4="myPin">' + ic('lock', 'sm') + 'Change PIN</button>' + (S.me.twoFactor ? '<button class="btn" data-act4="myCodes">New recovery codes</button>' : '') + '</div></section>' +
      '<section class="card pad2"><h2 class="mb">' + (can('admins.manage') ? 'Active sessions · all admins' : 'Your active sessions') + '</h2>' + table([{ label: 'Admin', v: (s) => esc(s.email) + (s.current ? ' <span class="badge ok">this one</span>' : '') }, { label: 'Device', v: (s) => '<span class="tiny">' + esc((s.user_agent || '').slice(0, 60)) + '</span><div class="tiny faint">' + esc(s.ip) + '</div>' }, { label: 'Seen', v: (s) => esc(ago(s.last_seen_at)) }, { label: '', v: (s) => (s.current ? '' : '<button class="btn sm" data-act4="endSession" data-id="' + esc(s.id) + '">End</button>') }], d.sessions) + '</section></div>';
  };
  /* users page: business users, admins, roles */
  const USER_TABS = () => [['', 'Business users', 'users.view'], ['admins', 'Admins', 'admins.manage'], ['roles', 'Roles', 'admins.manage']].filter((t) => can(t[2]));
  async function adminsTab(T) {
    const [, d] = await Promise.all([loadRoles(), api('GET', '/admins')]); const a = S.me.admin; let html = '';
      html += '<div class="page-intro"><p>People who work in this admin. Only you, the Super Admin, add admins and change their roles.</p><div class="acts"><button class="btn pri" data-act4="admAdd">' + ic('plus', 'sm') + 'Add admin</button></div></div><section class="card">' +
        table([{ label: 'Admin', v: (x) => '<b>' + esc(x.name) + '</b><div class="tiny faint">' + esc(x.email) + '</div>' }, { label: 'Role', v: (x) => (x.role === 'super' ? badge('Super Admin', 'info') : esc(roleName(x.role))) }, { label: 'Two-step', v: (x) => (!S.me.twoFactor ? badge('Off for now') : x.totp_enabled ? badge('On', 'ok') : badge('Not set up', 'warn')) },
          { label: 'Last sign-in', v: (x) => esc(ago(x.last_login_at)) + (x.last_login_ip ? '<div class="tiny faint">' + esc(x.last_login_ip) + '</div>' : '') }, { label: 'Status', v: (x) => (x.active ? (x.locked_until && new Date(x.locked_until) > new Date() ? badge('Locked', 'bad') : badge('Active', 'ok')) : badge('Disabled')) },
          { label: '', v: (x) => (x.id === a.id || x.role === 'super' ? '' : '<div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act4="admRole" data-id="' + x.id + '" data-role="' + esc(x.role) + '" data-name="' + esc(x.name) + '">Change role</button>' + (x.locked_until && new Date(x.locked_until) > new Date() ? '<button class="btn sm" data-act4="adm" data-v="unlock" data-id="' + x.id + '">Unlock</button>' : '') + (S.me.twoFactor ? '<button class="btn sm" data-act4="adm" data-v="reset-2fa" data-id="' + x.id + '">Reset 2-step</button>' : '<button class="btn sm" data-act4="adm" data-v="reset-pin" data-id="' + x.id + '"' + (x.has_pin ? '' : ' disabled title="No PIN yet"') + '>Reset PIN</button>') + (x.active ? '<button class="btn sm danger" data-act4="adm" data-v="deactivate" data-id="' + x.id + '">Disable</button>' : '<button class="btn sm" data-act4="adm" data-v="reactivate" data-id="' + x.id + '">Enable</button>') + '</div>') }], d.admins) + '</section>';
    T.done(html);
  }
  async function rolesTab(T) {
    await loadRoles(); let html = '';
      html += '<div class="page-intro"><p>Roles are sets of permissions. Give each admin the role that matches their job.</p><div class="acts"><button class="btn pri" data-act4="roleNew">' + ic('plus', 'sm') + 'New role</button></div></div><section class="card">' +
        table([{ label: 'Role', v: (r) => '<b>' + esc(r.name) + '</b>' + (r.builtin ? ' <span class="badge">built-in</span>' : '') + '<div class="tiny faint">' + esc(r.description) + '</div>' }, { label: 'Permissions', num: true, v: (r) => esc((r.perms || []).length + ' / ' + S.permCatalog.length) }, { label: 'Admins', num: true, v: (r) => esc(r.admins) },
          { label: '', v: (r) => '<div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act4="roleEdit" data-id="' + esc(r.id) + '">Edit</button>' + (r.builtin ? '' : '<button class="btn sm danger" data-act4="roleDel" data-id="' + esc(r.id) + '">Delete</button>') + '</div>' }], S.roles) +
        '<p class="tiny muted pad" style="margin:0">The Super Admin can do everything and is the only one who manages admins and roles.</p></section>';
    T.done(html);
  }
  /* ---------- audit log ---------- */
  PAGES.audit = async (v) => {
    const f = S.af || (S.af = { action: '', admin: '' }); const au = await api('GET', '/audit?action=' + encodeURIComponent(f.action) + '&admin=' + encodeURIComponent(f.admin));
    v.innerHTML = '<div class="page-intro"><p>' + esc(INTRO.audit) + '</p></div><div class="row mb toolbar"><label class="search"><span class="sr-only">Action</span>' + ic('search', 'sm') + inp('afA', f.action, 'placeholder="Action starts with… (e.g. login, user_, payment)" id="afA"') + '</label><label class="search" style="max-width:320px"><span class="sr-only">Admin email</span>' + ic('users', 'sm') + inp('afW', f.admin, 'placeholder="Admin email" id="afW"') + '</label></div><section class="card">' +
        table([{ label: 'When', v: (e) => '<span style="white-space:nowrap">' + esc(fmtDT(e.at)) + '</span>' }, { label: 'Admin', v: (e) => esc(e.admin_email || '') }, { label: 'Action', v: (e) => '<b>' + esc(e.action.replace(/_/g, ' ')) + '</b>' + (e.reason ? '<div class="tiny faint">“' + esc(e.reason) + '”</div>' : '') }, { label: 'Business / target', v: (e) => esc([e.tenant, e.target].filter(Boolean).join(' · ')) }, { label: 'From', v: (e) => '<span class="tiny">' + esc(e.ip || '') + '</span>' }], au.entries) + '</section><p class="tiny muted mt">Showing the latest 300 entries. Entries can never be changed or deleted.</p>';
    let t; ['afA', 'afW'].forEach((id) => { const el = $('#' + id); if (el) el.oninput = () => { clearTimeout(t); t = setTimeout(() => { S.af = { action: $('#afA').value.trim(), admin: $('#afW').value.trim() }; route(); }, 400); }; });
  };
  const roleOpts = () => (S.roles || []).map((r) => [r.id, r.name + (r.description ? ' — ' + r.description : '')]);
  function roleModal(r) {
    const isNew = !r; r = r || { name: '', description: '', perms: [] };
    const box = modal({ title: isNew ? 'New role' : 'Edit role · ' + r.name, wide: true, body: '<div class="col"><div class="grid2">' + field('Name', inp('name', r.name, 'placeholder="e.g. Sales follow-up"')) + field('What it is for', inp('description', r.description)) + '</div>' +
      '<h3>Permissions</h3>' + checkGroups(S.permCatalog, (k) => (r.perms || []).includes(k), 'P_') + '<div class="tiny muted">Admins with this role get exactly these permissions. Managing admins and roles stays with the Super Admin.</div></div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">' + (isNew ? 'Create role' : 'Save role') + '</button>' });
    $('#go', box).onclick = (e) => busy(e.target, async () => {
      const v = vals(box); const perms = S.permCatalog.map(([k]) => k).filter((k) => v['P_' + k]);
      if (isNew) await api('POST', '/roles', { name: v.name, description: v.description, perms }); else await api('PUT', '/roles/' + encodeURIComponent(r.id), { name: v.name, description: v.description, perms });
      closeModal(); toast('Role saved'); route();
    });
  }
  const ACT4 = {
    myPin: () => {
      const box = modal({ title: 'Change your PIN', body: '<div class="col">' + field('Your password', inp('password', '', 'type="password" autocomplete="current-password"')) + '<div><div class="small b mb">New PIN</div>' + pinBoxes('cpA') + '</div><div><div class="small b mb">Type it again</div>' + pinBoxes('cpB') + '</div><div class="alert bad hide" id="cpErr" role="alert"></div></div>',
        foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Save PIN</button>' });
      const a = wirePin($('#cpA', box), () => b.focus()); const b = wirePin($('#cpB', box));
      $('#go', box).onclick = (e) => { const err = (m) => { const x = $('#cpErr', box); x.textContent = m; x.classList.remove('hide'); };
        if (a.val().length !== 4) return err('Type 4 digits.'); if (a.val() !== b.val()) { b.clear(); return err('The two PINs are not the same.'); }
        busy(e.target, async () => { try { await api('POST', '/auth/pin', { pin: a.val(), password: vals(box).password }, false); closeModal(); toast('PIN changed'); } catch (er) { err(er.message); } }); };
    },
    roleNew: () => roleModal(null),
    roleEdit: (el) => roleModal(S.roles.find((r) => r.id === el.dataset.id)),
    roleDel: (el) => { const r = S.roles.find((x) => x.id === el.dataset.id); const box = modal({ title: 'Delete role ' + r.name + '?', body: '<p class="small muted">Only a role nobody has can be deleted.</p>', foot: '<button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Delete</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { await api('DELETE', '/roles/' + encodeURIComponent(r.id)); closeModal(); toast('Role deleted'); route(); }); },
    admAdd: () => {
      const box = modal({ title: 'Add an admin', body: '<div class="col">' + field('Full name', inp('name', '', 'autocomplete="off"')) + field('Email', inp('email', '', 'type="email" autocomplete="off"')) +
        field('Role', sel('role', roleOpts(), (S.roles.find((r) => r.id === 'support') || S.roles[0] || {}).id)) + '<label class="check"><input type="checkbox" name="sendEmail" checked> Email them their sign-in details</label>' +
        '<div class="tiny muted">They get a temporary password and choose their own at the first sign-in. Give only the access they need.</div></div>',
        foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Add admin</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => {
        const r = await api('POST', '/admins', vals(box));
        modal({ title: 'Admin added', body: '<p class="small"><b>' + esc(r.admin.name) + '</b> · ' + esc(r.admin.email) + ' · ' + esc(roleName(r.admin.role)) + '</p><p class="small muted">Temporary password (shown only now):</p><div class="secret mb">' + esc(r.password) + '</div>' +
          '<p class="small muted">' + (r.emailed === 'sent' ? 'Their sign-in details were emailed to them.' : 'Not emailed' + (r.emailed === 'skipped' ? ' (email is not set up on the server)' : '') + ' — send them the address <b>' + esc(r.url) + '</b> and this password in a private way.') + '</p>',
          foot: '<button class="btn pri" data-close>Done</button>' });
        route();
      });
    },
    admRole: (el) => {
      const box = modal({ title: 'Change role · ' + el.dataset.name, body: field('Role', sel('role', roleOpts(), el.dataset.role)), foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Save</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { await api('POST', '/admins/' + el.dataset.id + '/role', vals(box)); closeModal(); toast('Role changed'); route(); });
    },
    myPw: () => { const box = modal({ title: 'Change password', body: '<div class="col">' + field('Current password', inp('current', '', 'type="password" autocomplete="current-password"')) + field('New password (12+ characters)', inp('password', '', 'type="password" autocomplete="new-password"')) + field('Type it again', inp('password2', '', 'type="password" autocomplete="new-password"')) + '<div class="tiny muted">Your other sessions are signed out.</div></div>', foot: '<button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Save</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { const v = vals(box); if (v.password !== v.password2) throw new Error('The two passwords are not the same'); await api('POST', '/auth/password', { current: v.current, password: v.password }); closeModal(); toast('Password changed'); route(); }); },
    myCodes: (el) => busy(el, async () => { const r = await api('POST', '/auth/recovery-codes'); S.codes = r.recoveryCodes; S.me.admin.recoveryLeft = r.recoveryCodes.length;
      modal({ title: 'New recovery codes', body: '<p class="small muted">Your old codes no longer work. Save these now — they are not shown again.</p><div class="codes mb">' + r.recoveryCodes.map((c) => '<span>' + esc(c) + '</span>').join('') + '</div><div class="row"><button class="btn sm" data-act="copyCodes">Copy</button><button class="btn sm" data-act="dlCodes">Download .txt</button></div>', foot: '<button class="btn pri" data-close>I saved them</button>' }); }),
    endSession: (el) => busy(el, async () => { await api('POST', '/sessions/' + el.dataset.id + '/revoke'); toast('Session ended'); route(); }),
    adm: (el) => { const labels = { deactivate: 'Disable this admin (signs them out everywhere)?', reactivate: 'Enable this admin again?', 'reset-2fa': 'Reset two-step verification? They set it up again at next sign-in, and are signed out now.', unlock: 'Unlock this admin?', 'reset-pin': 'Reset their PIN? They create a new one at their next visit.' };
      const box = modal({ title: 'Please confirm', body: '<p>' + esc(labels[el.dataset.v]) + '</p>', foot: '<button class="btn" data-close>Cancel</button><button class="btn ' + (el.dataset.v === 'deactivate' ? 'danger' : 'pri') + '" id="go">Confirm</button>' });
      $('#go', box).onclick = (e) => busy(e.target, async () => { await api('POST', '/admins/' + el.dataset.id + '/' + el.dataset.v); closeModal(); toast('Done'); route(); }); },
  };

  PAGES.settings = async (v) => {
    const s = (await api('GET', '/settings')).settings; const p = s.paymentInstructions; const ro = can('settings.write') ? '' : ' disabled';
    v.innerHTML = '<form id="setf" class="set-grid"><section class="card pad2"><h2 class="mb">How businesses pay you</h2><p class="small muted" style="margin-top:0">Shown on the Billing page in the app and on every invoice email.</p><div class="grid2">' +
      field('MTN MoMo number', inp('momoNumber', p.momoNumber, 'inputmode="tel"' + ro)) + field('MTN MoMo account name', inp('momoName', p.momoName, ro)) + field('Orange Money number', inp('omNumber', p.omNumber, 'inputmode="tel"' + ro)) + field('Orange Money account name', inp('omName', p.omName, ro)) + '</div>' +
      field('Bank details', '<textarea class="inp" name="bank" rows="2"' + ro + '>' + esc(p.bank) + '</textarea>', 'mt') + field('Note to businesses', inp('note', p.note, 'placeholder="e.g. Put your business name in the payment message"' + ro), 'mt') + '</section>' +
      '<section class="card pad2"><h2 class="mb">Subscription rules</h2><div class="grid2">' + field('Grace period after the paid period (days)', inp('graceDays', s.graceDays, 'inputmode="numeric"' + ro)) +
      field('Renewal invoice sent … days before the end', inp('renewalNoticeDays', s.renewalNoticeDays, 'inputmode="numeric"' + ro)) + field('Invoices are due after (days)', inp('invoiceDueDays', s.invoiceDueDays, 'inputmode="numeric"' + ro)) + '</div>' +
      '<p class="tiny muted">The free trial is 5 days (after sign-up, and on Free plans). The grace period applies to new subscriptions; change it for one business on its page.</p></section>' +
      '<section class="card pad2"><h2 class="mb">Sign-up</h2><p class="small muted" style="margin-top:0">What new businesses can choose when they create an account. With only one open, nobody is asked.</p>' +
        Object.entries(ED).map(([k, x]) => '<label class="check mb"><input type="checkbox" name="su_' + k + '"' + ((s.signup || {})[k] !== false ? ' checked' : '') + ro + '> <span><b>' + esc(x.label) + '</b> <span class="small muted">— ' + esc(x.what) + '</span></span></label>').join('') +
        '<p class="tiny muted">Closing one does not touch businesses that already use it.</p></section>' + (ro ? '' : '<div class="set-save"><button class="btn pri" id="sgo">Save settings</button></div>') + '</form>';
    if (!ro) $('#setf').onsubmit = (e) => { e.preventDefault(); const x = vals($('#setf')); busy($('#sgo'), async () => { await api('PUT', '/settings', { paymentInstructions: { momoNumber: x.momoNumber, momoName: x.momoName, omNumber: x.omNumber, omName: x.omName, bank: x.bank, note: x.note }, graceDays: x.graceDays, renewalNoticeDays: x.renewalNoticeDays, invoiceDueDays: x.invoiceDueDays, signup: Object.fromEntries(Object.keys(ED).map((k) => [k, !!x['su_' + k]])) }); toast('Settings saved'); }); };
  };

  /* ---------- one click handler for everything ---------- */
  var ACT_raToggle, ACT_recToggle, ACT_copyCodes, ACT_dlCodes; // assigned above (hoisted names)
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]'); if (go && !e.target.closest('a,button')) { location.hash = go.dataset.go; return; }
    const el = e.target.closest('[data-act],[data-act2],[data-act3],[data-act4],[data-act5]'); if (!el) return;
    const k = el.dataset.act || el.dataset.act2 || el.dataset.act3 || el.dataset.act4 || el.dataset.act5;
    const fn = { raToggle: ACT_raToggle, recToggle: ACT_recToggle, copyCodes: ACT_copyCodes, dlCodes: ACT_dlCodes }[k] || ACT[k] || ACT2[k] || ACT3[k] || ACT4[k] || ACT5[k];
    if (!fn) return; if (el.tagName === 'A') e.preventDefault();
    if (el.dataset.busy) return; // already working
    const out = fn(el, e);
    if (out && typeof out.then === 'function' && !el.dataset.busy) { setBusy(el, true); out.then(() => setBusy(el, false), (er) => { setBusy(el, false); if (er && !er.quiet) toast(er.message, true); }); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('tr[data-go]')) location.hash = e.target.dataset.go; });
  boot();
})();
