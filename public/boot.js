/* Kargo — startup, access gate, login (SaaS mode) */
function renderLogin() {
  document.title = 'Sign in · Kargo';
  document.body.className = 'auth-body';
  const pw = (name, ac) => '<div class="auth-pw"><input class="inp" name="' + name + '" type="password" autocomplete="' + ac + '"><button type="button" class="auth-eye" id="pwEye" aria-label="Show password">Show</button></div>';
  document.body.innerHTML = '<main class="auth"><div class="auth-in">' +
    '<div class="auth-brand"><div class="auth-mark" aria-hidden="true">K</div><div class="auth-name">Kargo</div><div class="auth-tag">Import, stock &amp; sales</div></div>' +
    '<form class="auth-card" id="aForm" novalidate>' +
      '<h1 id="aTitle">Welcome back</h1><p class="auth-sub" id="aSub">Sign in to your business account.</p>' +
      '<div id="fReg" class="auth-fields hide">' + field('Business name', inp('businessName', '', 'autocomplete="organization"')) + field('Your name', inp('name', '', 'autocomplete="name"')) + '</div>' +
      '<div class="auth-fields">' + field('Email or phone', inp('login', '', 'autocomplete="username" autocapitalize="off" spellcheck="false"')) + field('Password', pw('password', 'current-password')) + '</div>' +
      '<div class="auth-err hide" id="err" role="alert"></div>' +
      '<button type="submit" class="btn pri lg block auth-go" id="go">Sign in</button>' +
    '</form>' +
    '<div class="auth-switch"><span id="swLogin">New to Kargo? <button type="button" class="auth-link" id="tReg">Create a business</button></span>' +
      '<span id="swReg" class="hide">Already have an account? <button type="button" class="auth-link" id="tLogin">Sign in</button></span></div>' +
  '</div><footer class="auth-foot">© ' + new Date().getFullYear() + ' Kargo</footer></main>';
  let reg = false;
  const err = (m) => { const e = $('#err'); e.textContent = m || ''; e.classList.toggle('hide', !m); };
  const sw = (r) => {
    reg = r; err('');
    $('#fReg').classList.toggle('hide', !r); $('#swLogin').classList.toggle('hide', r); $('#swReg').classList.toggle('hide', !r);
    $('#aTitle').textContent = r ? 'Create your business' : 'Welcome back';
    $('#aSub').textContent = r ? 'Takes a minute. You will be the owner.' : 'Sign in to your business account.';
    $('#go').textContent = r ? 'Create account' : 'Sign in';
    $('[name=password]').setAttribute('autocomplete', r ? 'new-password' : 'current-password');
    document.title = (r ? 'Create account' : 'Sign in') + ' · Kargo';
    (r ? $('[name=businessName]') : $('[name=login]')).focus();
  };
  $('#tLogin').onclick = () => sw(false); $('#tReg').onclick = () => sw(true);
  $('#pwEye').onclick = () => { const i = $('[name=password]'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('#pwEye').textContent = show ? 'Hide' : 'Show'; $('#pwEye').setAttribute('aria-label', show ? 'Hide password' : 'Show password'); i.focus(); };
  $('#aForm').onsubmit = (e) => { e.preventDefault(); $('#go').click(); }; // Enter key: same path as clicking (loading state included)
  $('#go').onclick = async (e) => {
    e.preventDefault(); err('');
    const v = formVals(document.body); const api = (window.KARGO_CONFIG.api || location.origin).replace(/\/$/, '');
    const need = (reg ? [['businessName', 'your business name'], ['name', 'your name']] : []).concat([['login', 'your email or phone'], ['password', 'your password']]);
    const miss = need.find(([k]) => !String(v[k] || '').trim());
    if (miss) { err('Please enter ' + miss[1] + '.'); $('[name=' + miss[0] + ']').focus(); return; }
    try {
      const r = await fetch(api + (reg ? '/api/auth/register' : '/api/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      localStorage.setItem('kargo-token', j.token); location.reload();
      return new Promise(() => { }); // keep the button loading until the page reloads into the app
    } catch (e2) { err(e2 instanceof TypeError ? 'Cannot reach the server. Check your connection.' : e2.message); }
  };
  $('[name=login]').focus();
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
  const { store, info } = await createStore();
  if (info.mode === 'login') return renderLogin();
  if (info.mode === 'signedout') { $('#view').innerHTML = '<div class="card pad2" style="max-width:520px;margin:20px auto"><h2>Please sign in</h2><p class="muted">Sign in to claude.ai, then open this link again.</p></div>'; $('#title').textContent = 'Kargo'; return; }
  K.store = store; K.info = info; K.me = info.me || { id: null, name: '' };
  K.sync = info.mode === 'local' ? 'local' : 'loading';
  loadOutbox();
  const cachedAt = info.mode === 'local' ? null : loadCache();
  if (cachedAt) K.sync = 'offline';
  if (info.mode === 'saas') A.logout = () => { localStorage.removeItem('kargo-token'); location.reload(); };
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
