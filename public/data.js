/* Kargo — data layer. Same interface for 3 backends:
 *  - RestStore: the SaaS backend (server/), used when window.KARGO_CONFIG.api is set
 *  - ArtifactStore: the hosted claude.ai app's shared database
 *  - LocalStore: this-device-only fallback (preview / offline demo)
 * Interface: init() -> info; subscribe(col, cb(docs), onErr); put(col, id, data); del(col, id);
 *            uploadImage(blob) -> ref|null; imageUrl(ref) -> url; requestAccess(name) */
const COLLECTIONS = ['settings', 'products', 'lots', 'shipments', 'customers', 'sales', 'adjustments', 'expenses', 'locations', 'transfers', 'handovers', 'suppliers', 'bills', 'reminders', 'audits', 'assets', 'orders', 'promos'];
const TEAM_COLLECTIONS = ['members', 'requests']; // hosted mode only (SaaS keeps users in its own table)

class LocalStore {
  constructor() { this.key = 'kargo-local-v1'; this.subs = {}; try { this.data = JSON.parse(localStorage.getItem(this.key) || '{}'); } catch (e) { this.data = {}; } }
  async init() { return { mode: 'local', me: { id: 'local', name: 'Owner' }, userLabel: 'This device' }; }
  _save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) { console.warn('local storage full'); } }
  _emit(col) { const docs = Object.entries(this.data[col] || {}).map(([id, d]) => Object.assign({ id }, d)); (this.subs[col] || []).forEach((cb) => cb(docs)); }
  subscribe(col, cb) { (this.subs[col] = this.subs[col] || []).push(cb); setTimeout(() => this._emit(col), 0); return () => { }; }
  async put(col, id, data) { const b = JSON.parse(JSON.stringify(data)); delete b.id; (this.data[col] = this.data[col] || {})[id] = b; this._save(); this._emit(col); }
  async del(col, id) { if (this.data[col]) delete this.data[col][id]; this._save(); this._emit(col); }
  imageUrl(ref) { return ref; }
  async query(col, from, to) { return Object.entries(this.data[col] || {}).map(([id, d]) => Object.assign({ id }, d)).filter((d) => d.date >= from && d.date <= to); }
}

class ArtifactStore {
  async init() {
    if (!window.claude || !window.claude.use) return null;
    this.db = await window.claude.use('db');
    if (!this.db) return null;
    const user = await window.claude.use('user');
    try { this.assets = await window.claude.use('assets'); } catch (e) { this.assets = null; }
    if (!user) return { mode: 'single', me: { id: 'me', name: '' }, isOwner: true, userLabel: '' };
    const me = await user.me();
    return { mode: 'cloud', me: { id: me.id, name: me.name || '' }, isOwner: !!me.isOwner, canEdit: !!me.canEdit, userLabel: me.name || '' };
  }
  subscribe(col, cb, onErr) {
    return this.db.collection(col).onSnapshot(
      (snap) => cb(snap.docs.map((d) => Object.assign({ id: d.id }, d.data())), snap.metadata),
      (e) => onErr && onErr(e));
  }
  async put(col, id, data) {
    const body = JSON.parse(JSON.stringify(data)); delete body.id;
    for (let attempt = 0; ; attempt++) {
      try { await this.db.collection(col).doc(id).set(body); return; }
      catch (e) {
        const retry = e && (e.code === 'unavailable' || e.code === 'resource_exhausted') && attempt < 4;
        if (!retry) throw e;
        await new Promise((r) => setTimeout(r, (attempt + 1) * 900 + Math.random() * 600));
      }
    }
  }
  async del(col, id) { await this.db.collection(col).doc(id).delete(); }
  async uploadImage(blob) { if (!this.assets) return null; const r = await this.assets.upload(blob, { type: 'image/jpeg' }); return r.id; }
  imageUrl(ref) { return '/_blob/' + ref; }
  async query(col, from, to) { const snap = await this.db.collection(col).where('date', '>=', from).where('date', '<=', to).get(); return snap.docs.map((d) => Object.assign({ id: d.id }, d.data())); }
  async requestAccess(id, name) { await this.db.collection('requests').doc(id).set({ name: name || '', at: new Date().toISOString() }); }
}

class RestStore {
  constructor(api) { this.api = api.replace(/\/$/, ''); this.subs = {}; }
  get token() { try { return localStorage.getItem('kargo-token'); } catch (e) { return null; } }
  async req(method, path, body, raw) {
    const headers = { Authorization: 'Bearer ' + this.token };
    if (!raw) headers['Content-Type'] = 'application/json';
    const r = await fetch(this.api + path, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { localStorage.removeItem('kargo-token'); location.reload(); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { code: j.code || 'error', details: j.details });
    return j;
  }
  async init() {
    if (!this.token) return { mode: 'login' };
    let me;
    try { me = await this.req('GET', '/api/me'); try { localStorage.setItem('kargo-me', JSON.stringify(me)); } catch (e) { } }
    catch (e) { me = JSON.parse(localStorage.getItem('kargo-me') || 'null'); if (!me) throw e; this.offlineStart = true; } // opened without network: work from the cached copy
    try {
      const es = new EventSource(this.api + '/api/stream?token=' + encodeURIComponent(this.token));
      es.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.col) this._refresh(m.col); else COLLECTIONS.forEach((c) => this._refresh(c)); } catch (e) { } };
    } catch (e) { }
    setInterval(() => COLLECTIONS.forEach((c) => this.subs[c] && this._refresh(c)), 60000);
    return { mode: 'saas', me: { id: me.user.id, name: me.user.name }, user: me.user, userLabel: me.user.name, tenant: me.tenant, emailOn: me.emailEnabled !== false };
  }
  _refresh(col) {
    if (!this.subs[col]) return;
    clearTimeout(this['_t' + col]);
    this['_t' + col] = setTimeout(async () => {
      try { const r = await this.req('GET', '/api/data/' + col); (this.subs[col] || []).forEach((cb) => cb(r.docs)); }
      catch (e) { (this.errs || []).forEach((f) => f(e)); }
    }, 150);
  }
  subscribe(col, cb, onErr) { (this.subs[col] = this.subs[col] || []).push(cb); if (onErr) (this.errs = this.errs || []).push(onErr); this._refresh(col); return () => { }; }
  async put(col, id, data) { const body = JSON.parse(JSON.stringify(data)); delete body.id; await this.req('PUT', '/api/data/' + col + '/' + encodeURIComponent(id), body); this._refresh(col); }
  async del(col, id) { await this.req('DELETE', '/api/data/' + col + '/' + encodeURIComponent(id)); this._refresh(col); }
  async uploadImage(blob) { const r = await this.req('POST', '/api/images', blob, true); return r.id; }
  imageUrl(ref) { return this.api + '/api/images/' + ref; }
}

async function createStore() {
  const cfg = window.KARGO_CONFIG || {};
  if (cfg.api !== undefined && cfg.api !== null) { const s = new RestStore(cfg.api || location.origin); return { store: s, info: await s.init() }; }
  if (window.claude && window.claude.use) {
    // Inside claude.ai: never fall back to this-device storage, or data would split between phones.
    const a = new ArtifactStore();
    const info = await a.init().catch(() => null);
    if (info) return { store: a, info };
    return { store: null, info: { mode: 'signedout' } };
  }
  const l = new LocalStore();
  return { store: l, info: await l.init() };
}
