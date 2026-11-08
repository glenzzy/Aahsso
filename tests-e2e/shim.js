// Test-only stand-in for the claude.ai runtime (db, user, assets, downloads), synced across tabs.
(function () {
  const as = new URLSearchParams(location.search).get('as') || 'owner';
  const USERS = { owner: { id: 'u_owner', name: 'Bullekam Owner', isOwner: true, canEdit: true }, rep: { id: 'u_rep', name: 'Jenny Rep', isOwner: false, canEdit: false }, mgr: { id: 'u_mgr', name: 'Paul Manager', isOwner: false, canEdit: false } };
  const me = USERS[as];
  let cache = JSON.parse(localStorage.getItem('mockdb') || '{}');
  const load = () => cache;
  const store = (d) => { cache = d; localStorage.setItem('mockdb', JSON.stringify(d)); bc.postMessage(d); };
  const bc = new BroadcastChannel('mockdb'); const subs = [];
  const emit = () => subs.forEach((s) => s());
  bc.onmessage = (m) => { cache = m.data; emit(); };
  const visible = (col, id) => col !== 'requests' || me.isOwner || id === me.id;
  function collection(col) {
    return {
      doc(id) { return { id, async set(data) { await new Promise((r) => setTimeout(r, 5)); if (!navigator.onLine || window.__offline) throw { code: 'unavailable', message: 'offline' }; const d = JSON.parse(JSON.stringify(load())); (d[col] = d[col] || {})[id] = JSON.parse(JSON.stringify(data)); store(d); emit(); }, async delete() { const d = JSON.parse(JSON.stringify(load())); if (d[col]) delete d[col][id]; store(d); emit(); } }; },
      where(f, op, v) { const q = this._q || []; const c = collection(col); c._q = q.concat([[f, op, v]]); return c; },
      async get() { const d = load()[col] || {}; const ok = (x) => (this._q || []).every(([f, op, v]) => op === '>=' ? x[f] >= v : op === '<=' ? x[f] <= v : x[f] === v); const docs = Object.entries(d).filter(([id, x]) => visible(col, id) && ok(x)).map(([id, v]) => ({ id, exists: true, data: () => v })); return { docs, size: docs.length, empty: !docs.length }; },
      onSnapshot(next) {
        const fire = () => { const d = load()[col] || {}; const docs = Object.entries(d).filter(([id]) => visible(col, id)).map(([id, v]) => ({ id, exists: true, data: () => v, metadata: {} })); next({ docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false }, docChanges: () => [] }); };
        subs.push(fire); setTimeout(fire, 30); return () => { };
      },
    };
  }
  window.__downloads = [];
  window.claude = { use: async (name) => {
    await new Promise((r) => setTimeout(r, 20));
    if (name === 'db') return { collection, doc: (p) => collection(p.split('/')[0]).doc(p.split('/')[1]) };
    if (name === 'user') return { me: async () => ({ id: me.id, name: me.name, isOwner: me.isOwner, canEdit: me.canEdit }), isOwner: async () => me.isOwner, canEdit: async () => me.canEdit, id: async () => me.id };
    if (name === 'assets') return me.isOwner || as === 'mgr' ? { upload: async (blob) => { const id = 'a' + Math.random().toString(36).slice(2, 12); const fr = new FileReader(); const url = await new Promise((r) => { fr.onload = () => r(fr.result); fr.readAsDataURL(blob); }); localStorage.setItem('asset_' + id, url); return { id, url: '/_blob/' + id }; } } : null;
    if (name === 'downloads') return { save: async ({ filename, data }) => { window.__downloads.push(filename); window.__blobs = window.__blobs || {}; window.__blobs[filename] = data; window.__lastBlob = data; } };
    return null;
  } };
})();
