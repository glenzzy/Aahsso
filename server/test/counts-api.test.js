// API tests: stock counts — two counters at once, handover signatures, approval and shortage charge.
//   AAHSSO_URL=http://localhost:8080 node --test test/counts-api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const B = process.env.AAHSSO_URL || 'http://localhost:8080';
const rnd = Math.random().toString(36).slice(2, 8);

async function call(method, path, token, body) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token; if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(B + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}
const S = {};
const put = (tok, doc) => call('PUT', '/api/data/audits/' + (doc.id || 'au1'), tok, Object.assign({}, doc, { id: undefined }));
const get = async (tok, id = 'au1') => (await call('GET', '/api/data/audits', tok)).body.docs.find((d) => d.id === id);

test('setup: owner, a manager and three sales reps', async () => {
  const r = await call('POST', '/api/auth/register', null, { businessName: 'Count Shop ' + rnd, name: 'Owner', login: 'co' + rnd, password: 'secret1' }); assert.equal(r.status, 200); S.own = r.body.token;
  for (const [k, role] of [['mgr', 'manager'], ['out', 'sales'], ['in', 'sales'], ['x', 'sales']]) {
    const u = await call('POST', '/api/users', S.own, { name: k + ' person', login: k + 'c' + rnd, password: 'pass1234', role, sendEmail: false }); assert.equal(u.status, 200, JSON.stringify(u.body));
    S[k] = (await call('POST', '/api/auth/login', null, { login: k + 'c' + rnd, password: 'pass1234' })).body.token; S[k + 'Id'] = u.body.user.id;
  }
});

test('a handover count: signatures cannot be forged; two counters never overwrite each other', async () => {
  const base = { id: 'au1', kind: 'handover', locationId: 'main', status: 'draft', counts: {}, startedAt: new Date().toISOString(), handover: { fromId: S.outId, fromName: 'out person', fromPresent: true, toId: S.inId, toName: 'in person', toAcceptedAt: '2020-01-01T00:00:00Z' } };
  assert.equal((await put(S.own, base)).status, 200);
  assert.equal((await get(S.own)).handover.toAcceptedAt, undefined, 'a signature cannot be written by someone else');
  // the owner and the manager count at the same time, each from an old copy
  assert.equal((await put(S.own, Object.assign({}, base, { counts: { p1: 3 }, countsPatch: { p1: 3 } }))).status, 200);
  assert.equal((await put(S.mgr, Object.assign({}, base, { counts: { p2: 5 }, countsPatch: { p2: 5 } }))).status, 200);
  let d = await get(S.own); assert.deepEqual(d.counts, { p1: 3, p2: 5 }, 'both counts kept');
  assert.equal((await put(S.own, Object.assign({}, d, { countsPatch: { p2: null } }))).status, 200);
  d = await get(S.own); assert.deepEqual(d.counts, { p1: 3 }, 'a cleared count is removed');
  assert.equal((await put(S.out, Object.assign({}, d, { status: 'submitted' }))).status, 403, 'the outgoing rep cannot touch a count still being counted');
  assert.equal((await put(S.own, Object.assign({}, d, { status: 'submitted', lines: [{ productId: 'p1', counted: 3, system: 5, unitCost: 1000 }] }))).status, 200);
});

test('the incoming person accepts and the outgoing person agrees — each only their own part', async () => {
  const d = await get(S.own);
  assert.equal((await put(S.x, Object.assign({}, d, { handover: Object.assign({}, d.handover, { toAcceptedAt: 'x' }) }))).status, 403, 'someone else in the shop cannot sign');
  // the outgoing rep tries to approve and change the count while agreeing: only the agreement is kept
  assert.equal((await put(S.out, Object.assign({}, d, { status: 'applied', lines: [], handover: Object.assign({}, d.handover, { fromAgreedAt: 'x', toAcceptedAt: 'x' }) }))).status, 200);
  let a = await get(S.own); assert.equal(a.status, 'submitted'); assert.equal(a.lines.length, 1); assert.ok(a.handover.fromAgreedAt); assert.equal(a.handover.toAcceptedAt, undefined);
  assert.notEqual(a.handover.fromAgreedAt, 'x', 'the server writes the time');
  assert.equal((await put(S.in, Object.assign({}, a, { handover: Object.assign({}, a.handover, { toAcceptedAt: 'x' }) }))).status, 200);
  a = await get(S.own); assert.ok(a.handover.toAcceptedAt && a.handover.toAcceptedAt !== 'x');
});

test('a manager approves and charges the shortage; then the count is closed', async () => {
  const a = await get(S.own);
  assert.equal((await put(S.own, Object.assign({}, a, { status: 'applied', charge: { userId: S.outId, name: 'out person', amount: 2000, deduct: true, month: new Date().toISOString().slice(0, 7) } }))).status, 200);
  const done = await get(S.own); assert.equal(done.status, 'applied'); assert.ok(done.appliedAt); assert.equal(done.charge.amount, 2000);
  assert.equal((await put(S.own, Object.assign({}, done, { charge: null }))).status, 409, 'closed');
  assert.equal((await put(S.own, { id: 'au2', kind: 'routine', locationId: 'main', status: 'draft', counts: {}, charge: { userId: S.inId, amount: 1, deduct: true } })).status, 200, 'a manager may');
  assert.equal((await put(S.mgr, Object.assign({}, await get(S.mgr, 'au2'), { status: 'cancelled' }))).status, 200, 'a manager discards a count');
});
