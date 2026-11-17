// API tests: loss reports (theft, damage, pests…) — staff report, a manager approves; photo proof.
//   AAHSSO_URL=http://localhost:8080 node --test test/losses-api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const B = process.env.AAHSSO_URL || 'http://localhost:8080';
const rnd = Math.random().toString(36).slice(2, 8);
const T = new Date().toISOString().slice(0, 10);

async function call(method, path, token, body, raw) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token; if (body && !raw) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = 'image/jpeg';
  const r = await fetch(B + path, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}
const S = {};
const put = (tok, id, doc) => call('PUT', '/api/data/losses/' + id, tok, doc);
const get = async (tok, id) => (await call('GET', '/api/data/losses', tok)).body.docs.find((d) => d.id === id);
const loss = (extra) => Object.assign({ date: T, locationId: 'main', cause: 'pests', lines: [{ productId: 'p1', qty: 3 }], photos: ['img1'], notes: 'Rats in the rice', status: 'pending' }, extra);

test('setup: owner, two sales reps', async () => {
  const r = await call('POST', '/api/auth/register', null, { businessName: 'Loss Shop ' + rnd, name: 'Owner', login: 'lo' + rnd, password: 'secret1' }); assert.equal(r.status, 200); S.own = r.body.token;
  for (const k of ['a', 'b']) {
    const u = await call('POST', '/api/users', S.own, { name: k.toUpperCase() + ' rep', login: k + 'l' + rnd, password: 'pass1234', role: 'sales', sendEmail: false }); assert.equal(u.status, 200, JSON.stringify(u.body));
    S[k] = (await call('POST', '/api/auth/login', null, { login: k + 'l' + rnd, password: 'pass1234' })).body.token; S[k + 'Id'] = u.body.user.id;
  }
});

test('a sales rep reports a loss: checked, always waiting for approval, signed by the server', async () => {
  assert.equal((await put(S.a, 'ls1', loss({ photos: [] }))).status, 400, 'pests need a photo');
  assert.equal((await put(S.a, 'ls1', loss({ cause: 'nonsense' }))).status, 400, 'unknown cause');
  assert.equal((await put(S.a, 'ls1', loss({ cause: 'count' }))).status, 400, 'system causes cannot be picked');
  assert.equal((await put(S.a, 'ls1', loss({ lines: [{ productId: 'p1', qty: 1.5 }] }))).status, 400, 'whole numbers');
  assert.equal((await put(S.a, 'ls1', loss({ cause: 'other', photos: [], notes: '' }))).status, 400, 'other needs a note');
  assert.equal((await put(S.a, 'ls1', loss({ status: 'approved' }))).status, 403, 'staff cannot approve');
  const ok = await put(S.a, 'ls1', loss({ reportedById: 'someone-else', reportedBy: 'Fake' })); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const d = await get(S.own, 'ls1'); assert.equal(d.status, 'pending'); assert.equal(d.reportedById, S.aId, 'the server says who reported it'); assert.match(d.no, /^LS\d{6}-/);
  assert.equal((await put(S.a, 'ls2', loss({ cause: 'expired', photos: [] }))).status, 200, 'expired: photo optional');
  assert.equal((await call('PUT', '/api/data/adjustments/x' + rnd, S.a, { date: T, productId: 'p1', lotId: 'l1', qty: -3 })).status, 403, 'staff cannot change stock directly');
});

test('only the reporter (or a manager) changes a pending report; the other rep cannot', async () => {
  const d = await get(S.a, 'ls1');
  assert.equal((await put(S.b, 'ls1', Object.assign({}, d, { notes: 'changed by B' }))).status, 403);
  assert.equal((await put(S.a, 'ls1', Object.assign({}, d, { notes: 'Rats in the rice, back store' }))).status, 200);
  assert.equal((await put(S.b, 'ls2', Object.assign({}, await get(S.a, 'ls2'), { status: 'withdrawn' }))).status, 403, 'only the reporter withdraws');
  assert.equal((await put(S.a, 'ls2', Object.assign({}, await get(S.a, 'ls2'), { status: 'withdrawn' }))).status, 200);
});

test('a manager approves or rejects (with a reason); a decided loss never changes', async () => {
  const d = await get(S.own, 'ls1');
  const ap = await put(S.own, 'ls1', Object.assign({}, d, { status: 'approved' })); assert.equal(ap.status, 200);
  const done = await get(S.own, 'ls1'); assert.equal(done.status, 'approved'); assert.ok(done.decidedAt); assert.equal(done.reportedById, S.aId, 'reporter kept');
  assert.equal((await put(S.own, 'ls1', Object.assign({}, done, { status: 'pending' }))).status, 409, 'cannot reopen');
  assert.equal((await put(S.a, 'ls3', loss({ cause: 'theft' }))).status, 200);
  const p3 = await get(S.own, 'ls3');
  assert.equal((await put(S.own, 'ls3', Object.assign({}, p3, { status: 'rejected' }))).status, 400, 'a reason is needed');
  assert.equal((await put(S.own, 'ls3', Object.assign({}, p3, { status: 'rejected', decisionNote: 'Found in the back store' }))).status, 200);
  assert.equal((await get(S.a, 'ls3')).status, 'rejected');
  assert.equal((await put(S.own, 'ls4', loss({ status: 'approved' }))).status, 200, 'a manager records a loss that applies at once');
  assert.equal((await call('DELETE', '/api/data/losses/ls4', S.own)).status, 403, 'losses are never deleted');
});

test('photo proof: staff may upload it even without the Photos feature, but not product photos', async () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  assert.equal((await call('POST', '/api/images?for=evidence', S.a, jpg, true)).status, 200);
  assert.equal((await call('POST', '/api/images', S.a, jpg, true)).status, 403);
});

test('staff see only their own loss reports, without costs; managers see all', async () => {
  const mine = (await call('GET', '/api/data/losses', S.b)).body.docs; assert.equal(mine.length, 0, 'B reported nothing');
  const a = (await call('GET', '/api/data/losses', S.a)).body.docs; assert.ok(a.length >= 3 && a.every((d) => d.reportedById === S.aId));
  assert.ok(a.every((d) => d.lines.every((l) => !l.unitCost)), 'no costs for staff');
  assert.ok((await call('GET', '/api/data/losses', S.own)).body.docs.length >= 4);
});
