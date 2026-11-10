/* Kargo — startup, access gate, login (SaaS mode) */
function renderLogin() {
  document.body.innerHTML = '<div class="login"><div class="center mb"><div class="logo" style="width:56px;height:56px;margin:0 auto 10px;font-size:22px">K</div><h1>Kargo</h1><div class="muted">Import, stock & sales manager</div></div>' +
    '<div class="card pad2"><div class="seg mb" style="width:100%"><button class="on grow" id="tLogin">Sign in</button><button class="grow" id="tReg">Create business</button></div>' +
    '<div id="fReg" class="col hide">' + field('Business name', inp('businessName', '')) + field('Your name', inp('name', '')) + '</div>' +
    '<div class="col mt">' + field('Email or phone', inp('login', '', 'autocomplete="username"')) + field('Password', inp('password', '', 'type="password" autocomplete="current-password"')) + '<button class="btn pri lg block" id="go">Sign in</button><div class="tiny" id="err" style="color:var(--bad)"></div></div></div></div>';
  let reg = false;
  const sw = (r) => { reg = r; $('#tLogin').classList.toggle('on', !r); $('#tReg').classList.toggle('on', r); $('#fReg').classList.toggle('hide', !r); $('#go').textContent = r ? 'Create account' : 'Sign in'; };
  $('#tLogin').onclick = () => sw(false); $('#tReg').onclick = () => sw(true);
  $('#go').onclick = async () => {
    const v = formVals(document.body); const api = (window.KARGO_CONFIG.api || location.origin).replace(/\/$/, '');
    try {
      const r = await fetch(api + (reg ? '/api/auth/register' : '/api/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed');
      localStorage.setItem('kargo-token', j.token); location.reload();
      return new Promise(() => { }); // keep the button loading until the page reloads into the app
    } catch (e) { $('#err').textContent = e.message; }
  };
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
