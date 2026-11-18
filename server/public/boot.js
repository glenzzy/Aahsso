/* Aahsso — startup, access gate, login (SaaS mode) */
function renderLogin() {
  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) return renderAuthAlt('reset', resetToken);
  document.title = 'Sign in · Aahsso';
  document.body.className = 'auth-body';
  const pw = (name, ac) => '<div class="auth-pw"><input class="inp" name="' + name + '" type="password" autocomplete="' + ac + '"><button type="button" class="auth-eye" id="pwEye" aria-label="Show password">Show</button></div>';
  document.body.innerHTML = '<main class="auth"><div class="auth-in">' +
    '<div class="auth-brand"><div class="auth-mark" aria-hidden="true">A</div><div class="auth-name">Aahsso</div><div class="auth-tag">Buy, stock &amp; sell</div></div>' +
    '<form class="auth-card" id="aForm" novalidate>' +
      '<h1 id="aTitle">Welcome back</h1><p class="auth-sub" id="aSub">Sign in to your business account.</p>' +
      '<div id="fReg" class="auth-fields hide">' + field('Business name', inp('businessName', '', 'autocomplete="organization"')) + field('Your name', inp('name', '', 'autocomplete="name"')) + '</div>' +
      '<div class="auth-fields" id="fCore">' + field('Email or phone', inp('login', '', 'autocomplete="username" autocapitalize="off" spellcheck="false"')) + field('Password', pw('password', 'current-password')) + '</div>' +
      '<div id="fRegMail" class="auth-fields hide">' + field('Email for password reset (optional)', inp('email', '', 'type="email" autocomplete="email" inputmode="email" autocapitalize="off" placeholder="Only if you sign in with a phone number"')) + '</div>' +
      '<div id="fEd" class="auth-ed hide" role="radiogroup" aria-label="What will you use Aahsso for?"></div>' +
      '<div class="auth-forgot" id="fgRow"><button type="button" class="auth-link" id="tForgot">Forgot password?</button></div>' +
      '<div class="auth-err hide" id="err" role="alert"></div>' +
      '<button type="submit" class="btn pri lg block auth-go" id="go">Sign in</button>' +
    '</form>' +
    '<div class="auth-switch"><span id="swLogin">New to Aahsso? <button type="button" class="auth-link" id="tReg">Create a business</button></span>' +
      '<span id="swReg" class="hide">Already have an account? <button type="button" class="auth-link" id="tLogin">Sign in</button></span></div>' +
  '</div><footer class="auth-foot">© ' + new Date().getFullYear() + ' Aahsso</footer></main>';
  let reg = false, step = 1, eds = null, edPick = '';
  const err = (m) => { const e = $('#err'); e.textContent = m || ''; e.classList.toggle('hide', !m); };
  const apiBase = () => (window.AAHSSO_CONFIG.api || location.origin).replace(/\/$/, '');
  /** Aahsso Import / Aahsso Store: the ones the platform has open for sign-up */
  const loadEds = async () => { if (eds) return eds; try { const r = await fetch(apiBase() + '/api/signup-options'); if (r.ok) eds = (await r.json()).editions || []; } catch (e) { } return eds; };
  const drawEds = () => {
    $('#fEd').innerHTML = (eds || []).map((e) => '<button type="button" class="auth-edc' + (edPick === e.key ? ' on' : '') + '" role="radio" aria-checked="' + (edPick === e.key) + '" data-ed="' + esc(e.key) + '">' +
      '<span class="auth-edt"><b>' + esc(e.label) + '</b><span>' + esc(e.tag) + '</span></span><ul>' + (e.points || []).map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul></button>').join('') +
      '<p class="auth-edn">If your business changes later, our team can switch it for you.</p><button type="button" class="auth-link" id="edBack">← Back to your details</button>';
    $$('#fEd [data-ed]').forEach((b) => (b.onclick = () => { edPick = b.dataset.ed; err(''); drawEds(); const c = $('#fEd [data-ed].on'); if (c) c.focus(); }));
    $('#edBack').onclick = () => goStep(1);
  };
  /** sign-up: 1 = your details, 2 = what you will use Aahsso for */
  const goStep = (n) => {
    step = n; err(''); const two = n === 2;
    ['#fReg', '#fCore', '#fRegMail'].forEach((s) => $(s).classList.toggle('hide', two)); $('#fEd').classList.toggle('hide', !two);
    $('#aTitle').textContent = two ? 'What will you use Aahsso for?' : 'Create your business';
    $('#aSub').textContent = two ? 'Pick the one that fits. Aahsso shows only what you need.' : 'Takes a minute. You will be the owner.';
    $('#go').textContent = two ? 'Create account' : (eds && eds.length > 1 ? 'Continue' : 'Create account');
    if (two) { drawEds(); const f = $('#fEd [data-ed]'); if (f) f.focus(); } else $('[name=businessName]').focus();
  };
  const sw = (r) => {
    reg = r; err(''); if (step === 2) goStep(1);
    $('#fReg').classList.toggle('hide', !r); $('#fRegMail').classList.toggle('hide', !r); $('#fgRow').classList.toggle('hide', r); $('#swLogin').classList.toggle('hide', r); $('#swReg').classList.toggle('hide', !r);
    $('#aTitle').textContent = r ? 'Create your business' : 'Welcome back';
    $('#aSub').textContent = r ? 'Takes a minute. You will be the owner.' : 'Sign in to your business account.';
    $('#go').textContent = r ? (eds && eds.length > 1 ? 'Continue' : 'Create account') : 'Sign in';
    if (r) loadEds().then(() => { if (reg && step === 1) $('#go').textContent = eds && eds.length > 1 ? 'Continue' : 'Create account'; });
    $('[name=password]').setAttribute('autocomplete', r ? 'new-password' : 'current-password');
    document.title = (r ? 'Create account' : 'Sign in') + ' · Aahsso';
    (r ? $('[name=businessName]') : $('[name=login]')).focus();
  };
  $('#tLogin').onclick = () => sw(false); $('#tReg').onclick = () => sw(true);
  $('#tForgot').onclick = () => renderAuthAlt('forgot', null, $('[name=login]').value);
  $('#pwEye').onclick = () => { const i = $('[name=password]'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('#pwEye').textContent = show ? 'Hide' : 'Show'; $('#pwEye').setAttribute('aria-label', show ? 'Hide password' : 'Show password'); i.focus(); };
  $('#aForm').onsubmit = (e) => { e.preventDefault(); $('#go').click(); }; // Enter key: same path as clicking (loading state included)
  $('#go').onclick = async (e) => {
    e.preventDefault(); err('');
    const v = formVals(document.body); const api = (window.AAHSSO_CONFIG.api || location.origin).replace(/\/$/, '');
    const need = (reg ? [['businessName', 'your business name'], ['name', 'your name']] : []).concat([['login', 'your email or phone'], ['password', 'your password']]);
    const miss = need.find(([k]) => !String(v[k] || '').trim());
    if (miss) { err('Please enter ' + miss[1] + '.'); if (step === 2) goStep(1); $('[name=' + miss[0] + ']').focus(); return; }
    if (reg) {
      if (step === 1 && String(v.password).length < 6) { err('Use at least 6 characters for the password.'); $('[name=password]').focus(); return; }
      await loadEds();
      if (eds && eds.length > 1) { if (step === 1) return goStep(2); if (!edPick) { err('Choose one to continue.'); return; } v.edition = edPick; }
      else if (eds && eds.length === 1) v.edition = eds[0].key;
    }
    try {
      if (!reg) delete v.email;
      if (reg) { try { localStorage.setItem('aahsso-choose-plan', '1'); } catch (e) { } } // a new business goes straight to Choose your plan
      const r = await fetch(api + (reg ? '/api/auth/register' : '/api/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      localStorage.setItem('aahsso-token', j.token); location.reload();
      return new Promise(() => { }); // keep the button loading until the page reloads into the app
    } catch (e2) { err(e2 instanceof TypeError ? 'Cannot reach the server. Check your connection.' : e2.message); }
  };
  $('[name=login]').focus();
}
/** "Forgot password" (ask for a link by email) and "Choose a new password" (open from that link). */
function renderAuthAlt(mode, token, login) {
  const forgot = mode === 'forgot';
  document.title = (forgot ? 'Reset password' : 'New password') + ' · Aahsso';
  document.body.className = 'auth-body';
  document.body.innerHTML = '<main class="auth"><div class="auth-in">' +
    '<div class="auth-brand"><div class="auth-mark" aria-hidden="true">A</div><div class="auth-name">Aahsso</div></div>' +
    '<form class="auth-card" id="aForm" novalidate>' +
      '<h1>' + (forgot ? 'Forgot your password?' : 'Choose a new password') + '</h1>' +
      '<p class="auth-sub">' + (forgot ? 'Type the email or phone you sign in with. If your account has an email address, we will send you a link to choose a new password.' : 'At least 6 characters. You will be signed in right after.') + '</p>' +
      '<div class="auth-fields" id="afBody">' + (forgot ? field('Email or phone', inp('login', login || '', 'autocomplete="username" autocapitalize="off" spellcheck="false"'))
        : field('New password', inp('password', '', 'type="password" autocomplete="new-password"')) + field('Type it again', inp('password2', '', 'type="password" autocomplete="new-password"'))) + '</div>' +
      '<div class="auth-err hide" id="err" role="alert"></div><div class="auth-ok hide" id="ok" role="status"></div>' +
      '<button type="submit" class="btn pri lg block auth-go" id="go">' + (forgot ? 'Send me a link' : 'Save and sign in') + '</button>' +
    '</form>' +
    '<div class="auth-switch"><button type="button" class="auth-link" id="tBack">Back to sign in</button></div>' +
  '</div><footer class="auth-foot">© ' + new Date().getFullYear() + ' Aahsso</footer></main>';
  const err = (m) => { const e = $('#err'); e.textContent = m || ''; e.classList.toggle('hide', !m); };
  $('#tBack').onclick = () => { if (!forgot) history.replaceState(null, '', location.pathname); renderLogin(); };
  $('#aForm').onsubmit = (e) => { e.preventDefault(); $('#go').click(); };
  $('#go').onclick = async (e) => {
    e.preventDefault(); err('');
    const v = formVals(document.body); const api = (window.AAHSSO_CONFIG.api || location.origin).replace(/\/$/, '');
    if (forgot && !String(v.login || '').trim()) { err('Please enter your email or phone.'); return $('[name=login]').focus(); }
    if (!forgot && String(v.password || '').length < 6) { err('Use at least 6 characters.'); return $('[name=password]').focus(); }
    if (!forgot && v.password !== v.password2) { err('The two passwords are not the same.'); return $('[name=password2]').focus(); }
    $('#go').disabled = true;
    try {
      const r = await fetch(api + (forgot ? '/api/auth/forgot' : '/api/auth/reset'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(forgot ? { login: v.login } : { token, password: v.password }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      if (forgot) {
        $('#afBody').classList.add('hide'); $('#go').classList.add('hide');
        const ok = $('#ok'); ok.textContent = 'Check your inbox (and spam folder). If this account has an email address, a link is on its way — it works for 1 hour. No email? Ask the business owner to set a new password for you.'; ok.classList.remove('hide');
        return;
      }
      localStorage.setItem('aahsso-token', j.token); location.replace(location.pathname);
      return new Promise(() => { });
    } catch (e2) { err(e2 instanceof TypeError ? 'Cannot reach the server. Check your connection.' : e2.message); }
    $('#go').disabled = false;
  };
  $(forgot ? '[name=login]' : '[name=password]').focus();
}

VIEWS.pending = {
  render() {
    if (K.sync === 'loading') return '<div class="empty"><div class="big">⏳</div>Checking your access…</div>';
    if (!K.me.id) return '<div class="card pad2" style="max-width:520px;margin:20px auto"><h2>Please sign in</h2><p class="muted">Sign in to claude.ai, then open this link again.</p></div>';
    const sent = K._reqSent;
    return '<div class="card pad2" style="max-width:520px;margin:20px auto"><div class="big center" style="font-size:40px">🔐</div><h2 class="center">Waiting for access</h2>' +
      '<p class="muted center">Hi ' + esc(K.me.name || 'there') + '. The business owner needs to approve you and choose your role (sales, manager…).</p>' +
      '<div class="alert info">' + (sent ? '✓ Your request was sent. Ask the owner to open <b>Team & access</b> and approve <b>' + esc(K.me.name || 'you') + '</b>.' : 'Tap below to send your request.') + '</div>' +
      '<button class="btn pri block mt" data-a="reqAccess">' + (sent ? 'Send again' : 'Request access') + '</button></div>';
  },
};
A.reqAccess = async () => {
  try { await K.store.requestAccess(K.me.id, K.me.name); K._reqSent = true; toast('Request sent'); }
  catch (e) { toast('Could not send the request — ask the owner to add you.', true); }
  render(true);
};

(async function boot() {
  // read-only support view opened from the Aahsso admin: the token stays in this tab only
  const imp = (location.hash.match(/^#imp=([A-Za-z0-9._-]+)/) || [])[1];
  if (imp) { try { sessionStorage.setItem('aahsso-imp', imp); } catch (e) { } history.replaceState(null, '', location.pathname); }
  const { store, info } = await createStore();
  if (info.mode === 'login' || (info.mode === 'saas' && new URLSearchParams(location.search).get('reset'))) return renderLogin();
  if (info.mode === 'signedout') { $('#view').innerHTML = '<div class="card pad2" style="max-width:520px;margin:20px auto"><h2>Please sign in</h2><p class="muted">Sign in to claude.ai, then open this link again.</p></div>'; $('#title').textContent = 'Aahsso'; return; }
  K.store = store; K.info = info; K.me = info.me || { id: null, name: '' };
  K.sync = info.mode === 'local' ? 'local' : 'loading';
  loadOutbox();
  const cachedAt = info.mode === 'local' ? null : loadCache();
  if (cachedAt) K.sync = 'offline';
  if (info.mode === 'saas') A.logout = () => { if (info.supportView) { sessionStorage.removeItem('aahsso-imp'); window.close(); return location.reload(); } localStorage.removeItem('aahsso-token'); location.reload(); };
  if (info.supportView) supportBanner(info.supportView);
  try { if (info.mode === 'saas' && localStorage.getItem('aahsso-choose-plan')) { localStorage.removeItem('aahsso-choose-plan'); history.replaceState(null, '', '#plans'); } } catch (e) { }
  resolveAccess(); if (info.mode === 'cloud' && !cachedAt) K.member = null; // decided once the team list loads (or from the cached copy)
  if (cachedAt) recompute();
  const cols = COLLECTIONS.concat(info.mode === 'cloud' ? TEAM_COLLECTIONS : []);
  const waiting = new Set(cols);
  const timer = setTimeout(() => { if (waiting.size && (K.sync === 'loading' || K.sync === 'offline')) { K.sync = cachedAt ? 'offline' : 'err'; render(true); } }, 10000);
  let lastAccess = null;
  cols.forEach((col) => store.subscribe(col, (docs) => {
    docs = applyOutbox(col, docs);
    if (col === 'settings') K.raw.settings = docs.find((d) => d.id === 'main') || {};
    else K.raw[col] = docs;
    waiting.delete(col);
    if (!waiting.size && info.mode !== 'local') { if (K.sync !== 'ok') { setTimeout(flushOutbox, 300); if (info.mode === 'cloud' && info.isOwner && K.me.id && K.raw.settings.ownerId !== K.me.id) setTimeout(() => saveSettings({ ownerId: K.me.id, ownerName: K.me.name || 'Owner' }), 1500); } K.sync = 'ok'; clearTimeout(timer); }
    cacheSoon();
    if (info.mode !== 'cloud' || !waiting.has('members')) {
      resolveAccess();
      const sig = JSON.stringify(K.member);
      if (sig !== lastAccess) {
        const first = lastAccess === null; lastAccess = sig;
        if (!K.member && info.mode === 'cloud' && K.me.id && first && !K._reqSent) { store.requestAccess(K.me.id, K.me.name).then(() => { K._reqSent = true; render(true); }).catch(() => { }); }
        recompute(); route(); return;
      }
    }
    recompute(); scheduleRender();
  }, (e) => { console.warn(col, e); if (waiting.has(col)) { waiting.delete(col); if (col === 'requests') return; } K.sync = 'err'; scheduleRender(); }));
  window.addEventListener('hashchange', route);
  route();
  if (info.mode === 'saas' && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { }); // app opens even with no network
  if (info.mode === 'local') setTimeout(() => toast('Not connected — data is saved on this device only. Use Backup often.'), 800);
})();
