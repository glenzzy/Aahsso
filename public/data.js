/* Aahsso — data layer. Same interface for 3 backends:
 *  - RestStore: the SaaS backend (server/), used when window.AAHSSO_CONFIG.api is set
 *  - ArtifactStore: the hosted claude.ai app's shared database
 *  - LocalStore: this-device-only fallback (preview / offline demo)
 * Interface: init() -> info; subscribe(col, cb(docs), onErr); put(col, id, data); del(col, id);
 *            uploadImage(blob) -> ref|null; imageUrl(ref) -> url; requestAccess(name) */
/* Renamed from Kargo: keep sign-in, unsynced changes and preferences saved under the old name (runs once per browser). */
(function () {
  [typeof localStorage !== 'undefined' && localStorage, typeof sessionStorage !== 'undefined' && sessionStorage].forEach((st) => {
    try { if (!st) return; for (let i = st.length - 1; i >= 0; i--) { const k = st.key(i); if (k && k.startsWith('kargo-')) { const n = 'aahsso-' + k.slice(6); if (st.getItem(n) === null) st.setItem(n, st.getItem(k)); st.removeItem(k); } } } catch (e) { }
  });
  if (window.AAHSSO_CONFIG === undefined && window.KARGO_CONFIG !== undefined) window.AAHSSO_CONFIG = window.KARGO_CONFIG; // an older cached config.js
})();
/* The phone's own storage for the offline copy, the changes waiting to sync and the drinks list: IndexedDB (room for
 * years of records), else localStorage (about 5 MB). Values written by older versions to localStorage move over once. */
const LocalDB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((ok) => {
    try { const r = indexedDB.open('aahsso', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); r.onblocked = () => ok(null); }
    catch (e) { ok(null); }
  }));
  const idb = async (mode, fn) => { const db = await open(); if (!db) return { ok: false };
    return new Promise((res) => { try { const t = db.transaction('kv', mode); const r = fn(t.objectStore('kv')); let v; if (r) r.onsuccess = () => { v = r.result; }; t.oncomplete = () => res({ ok: true, v }); t.onerror = t.onabort = () => res({ ok: false }); } catch (e) { res({ ok: false }); } }); };
  async function get(key) {
    const r = await idb('readonly', (st) => st.get(key));
    if (r.ok && r.v !== undefined) return r.v;
    let s = null; try { s = localStorage.getItem(key); } catch (e) { }
    if (s === null) return undefined;
    let v; try { v = JSON.parse(s); } catch (e) { return undefined; }
    if (r.ok && (await idb('readwrite', (st) => st.put(v, key))).ok) try { localStorage.removeItem(key); } catch (e) { } // moved to the bigger storage
    return v;
  }
  async function set(key, val) {
    if ((await idb('readwrite', (st) => st.put(val, key))).ok) return true;
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }
  async function del(key) { await idb('readwrite', (st) => st.delete(key)); try { localStorage.removeItem(key); } catch (e) { } }
  return { get, set, del };
})();
const OFFLINE_MSG = 'No internet — this needs a connection. Everything else you do is saved on this phone and syncs later.';
const COLLECTIONS = ['settings', 'products', 'lots', 'shipments', 'customers', 'sales', 'adjustments', 'expenses', 'locations', 'transfers', 'handovers', 'suppliers', 'bills', 'reminders', 'audits', 'assets', 'funders', 'loans', 'capital', 'orders', 'promos', 'staff', 'attendance', 'leaves', 'payroll', 'tills', 'losses', 'claims', 'menu', 'areas', 'tables', 'tabs', 'rorders', 'reservations'];
const TEAM_COLLECTIONS = ['members', 'requests']; // hosted mode only (SaaS keeps users in its own table)

class LocalStore {
  constructor() { this.key = 'aahsso-local-v1'; this.subs = {}; try { this.data = JSON.parse(localStorage.getItem(this.key) || '{}'); } catch (e) { this.data = {}; } }
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
  get token() { try { return sessionStorage.getItem('aahsso-imp') || localStorage.getItem('aahsso-token'); } catch (e) { return null; } }
  get supportView() { try { return !!sessionStorage.getItem('aahsso-imp'); } catch (e) { return false; } }
  async req(method, path, body, raw) {
    const headers = { Authorization: 'Bearer ' + this.token };
    if (!raw) headers['Content-Type'] = 'application/json';
    const net = (on) => { try { window.dispatchEvent(new CustomEvent('aahsso-net', { detail: on })); } catch (e) { } };
    if (navigator.onLine === false) { net(false); throw Object.assign(new Error(OFFLINE_MSG), { code: 'network' }); }
    let r; try { r = await fetch(this.api + path, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined }); }
    catch (e) { net(false); throw Object.assign(new Error(OFFLINE_MSG), { code: 'network' }); } // no network: the same clear message everywhere
    net(r.status < 502); // the server answered: online (502/503/504: a proxy says it is not there)
    if (r.status === 401) { if (this.supportView) { sessionStorage.removeItem('aahsso-imp'); alert('The support view has ended.'); window.close(); } else localStorage.removeItem('aahsso-token'); location.reload(); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { code: j.code || 'error', details: j.details });
    return j;
  }
  async init() {
    if (!this.token) return { mode: 'login' };
    let me;
    try { me = await this.req('GET', '/api/me'); if (!this.supportView) try { localStorage.setItem('aahsso-me', JSON.stringify(me)); } catch (e) { } }
    catch (e) { me = JSON.parse(localStorage.getItem('aahsso-me') || 'null'); if (!me) throw e; this.offlineStart = true; } // opened without network: work from the cached copy
    try {
      const es = new EventSource(this.api + '/api/stream?token=' + encodeURIComponent(this.token));
      es.onmessage = (ev) => { try { const m = JSON.parse(ev.data); ((this.events || {})[m.col] || []).forEach((f) => { try { f(m); } catch (e) { } }); if (m.col) this._refresh(m.col); else COLLECTIONS.forEach((c) => this._refresh(c)); } catch (e) { } };
    } catch (e) { }
    setInterval(() => COLLECTIONS.forEach((c) => this.subs[c] && this._refresh(c)), 60000);
    return { mode: 'saas', me: { id: me.user.id, name: me.user.name }, user: me.user, userLabel: me.user.name, tenant: me.tenant, edition: me.edition || (me.tenant && me.tenant.edition) || 'import', emailOn: me.emailEnabled !== false, support: me.support || {}, subscription: me.subscription || null, limits: me.limits || {}, features: me.features || {}, supportView: me.supportView || null, businesses: me.businesses || [], canAddBusiness: !!me.canAddBusiness, receiptScan: !!me.receiptScan };
  }
  /** a live message that is not a collection (e.g. 'billing': a mobile money payment moved on) */
  on(col, f) { this.events = this.events || {}; (this.events[col] = this.events[col] || []).push(f); }
  /* refreshes asked within a moment of each other (start-up, switching business, the minute refresh, live updates) go
     out as ONE request for all of them — one sign-in check and one query on the server instead of ~30 */
  _refresh(col) {
    if (!this.subs[col]) return;
    if (!COLLECTIONS.includes(col)) return this._refreshOne(col);
    (this._want = this._want || new Set()).add(col);
    clearTimeout(this._tq); this._tq = setTimeout(() => this._flushRefresh(), 120);
  }
  async _flushRefresh() {
    const cols = [...(this._want || [])]; this._want = new Set(); if (!cols.length) return;
    try {
      const r = await this.req('GET', '/api/data?cols=' + cols.join(','));
      cols.forEach((c) => (this.subs[c] || []).forEach((cb) => cb((r.cols || {})[c] || [])));
    } catch (e) {
      if (/not found|unknown|which collections/i.test(e.message || '')) return cols.forEach((c) => this._refreshOne(c)); // an older server: one by one
      (this.errs || []).forEach((f) => f(e));
    }
  }
  async _refreshOne(col) {
    try { const r = await this.req('GET', '/api/data/' + col); (this.subs[col] || []).forEach((cb) => cb(r.docs)); }
    catch (e) { (this.errs || []).forEach((f) => f(e)); }
  }
  subscribe(col, cb, onErr) { (this.subs[col] = this.subs[col] || []).push(cb); if (onErr) (this.errs = this.errs || []).push(onErr); this._refresh(col); return () => { }; }
  async put(col, id, data) { const body = JSON.parse(JSON.stringify(data)); delete body.id; await this.req('PUT', '/api/data/' + col + '/' + encodeURIComponent(id), body); this._refresh(col); }
  async del(col, id) { await this.req('DELETE', '/api/data/' + col + '/' + encodeURIComponent(id)); this._refresh(col); }
  async uploadImage(blob, purpose) { const r = await this.req('POST', '/api/images' + (purpose ? '?for=' + encodeURIComponent(purpose) : ''), blob, true); return r.id; }
  imageUrl(ref) { return this.api + '/api/images/' + ref; }
}

async function createStore() {
  const cfg = window.AAHSSO_CONFIG || {};
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
