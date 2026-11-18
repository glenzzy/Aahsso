// API tests: one person, several businesses (an Aahsso Brocan and an Aahsso Store) under one sign-in.
//   AAHSSO_URL=http://localhost:8080 node --test test/businesses-api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const B = process.env.AAHSSO_URL || 'http://localhost:8080';
const rnd = Math.random().toString(36).slice(2, 8);

async function api(method, p, token, body) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token; if (body) headers['content-type'] = 'application/json';
  const r = await fetch(B + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}
const S = { login: 'two' + rnd + '@biz.test' };

test('an owner adds a Store next to their Brocan, with the same sign-in', async () => {
  const r = await api('POST', '/api/auth/register', null, { businessName: 'Mama Imports ' + rnd, name: 'Mama Two', login: S.login, password: 'secret12', edition: 'import' });
  assert.equal(r.status, 200); S.a = r.body.token;
  const me = (await api('GET', '/api/me', S.a)).body; S.aId = me.tenant.id;
  assert.equal(me.businesses.length, 1); assert.equal(me.canAddBusiness, true);
  assert.equal((await api('POST', '/api/businesses', S.a, { businessName: 'x', edition: 'store' })).status, 400, 'needs a name');
  assert.equal((await api('POST', '/api/businesses', S.a, { businessName: 'Chez Mama', edition: 'galaxy' })).status, 400, 'needs a kind');
  const add = await api('POST', '/api/businesses', S.a, { businessName: 'Chez Mama ' + rnd, edition: 'store' });
  assert.equal(add.status, 200, JSON.stringify(add.body)); S.b = add.body.token;
  const mb = (await api('GET', '/api/me', S.b)).body; S.bId = mb.tenant.id;
  assert.equal(mb.edition, 'store'); assert.notEqual(S.bId, S.aId);
  assert.equal(mb.user.role, 'owner'); assert.equal(mb.user.login, S.login, 'shows the person\'s own login');
  assert.equal(mb.subscription.status, 'trialing', 'its own free trial');
  assert.deepEqual(mb.businesses.map((b) => [b.edition, b.current]), [['import', false], ['store', true]]);
});

test('each business keeps its own data; switching needs no password', async () => {
  assert.equal((await api('PUT', '/api/data/products/p1', S.b, { name: 'Rice in the store', category: 'Food & Snacks' })).status, 200);
  assert.equal((await api('GET', '/api/data/products', S.a)).body.docs.length, 0, 'the Brocan does not see the Store\'s items');
  const sw = await api('POST', '/api/businesses/switch', S.b, { tenantId: S.aId }); assert.equal(sw.status, 200);
  assert.equal((await api('GET', '/api/me', sw.body.token)).body.tenant.id, S.aId);
  const back = await api('POST', '/api/businesses/switch', sw.body.token, { tenantId: S.bId });
  assert.equal((await api('GET', '/api/data/products', back.body.token)).body.docs.length, 1);
});

test('nobody switches into a business that is not theirs', async () => {
  const other = await api('POST', '/api/auth/register', null, { businessName: 'Other ' + rnd, name: 'Other', login: 'other' + rnd + '@biz.test', password: 'secret12' });
  const oid = (await api('GET', '/api/me', other.body.token)).body.tenant.id;
  assert.equal((await api('POST', '/api/businesses/switch', S.a, { tenantId: oid })).status, 404);
  assert.equal((await api('POST', '/api/businesses/switch', other.body.token, { tenantId: S.bId })).status, 404);
  // staff of a business cannot add businesses to it
  const st = await api('POST', '/api/users', S.a, { name: 'Clerk', login: 'clerk' + rnd + '@biz.test', password: 'secret12', role: 'sales' });
  assert.equal(st.status, 200, JSON.stringify(st.body));
  const lt = (await api('POST', '/api/auth/login', null, { login: 'clerk' + rnd + '@biz.test', password: 'secret12' })).body.token;
  assert.equal((await api('POST', '/api/businesses', lt, { businessName: 'Clerk shop', edition: 'store' })).status, 403);
  assert.equal((await api('GET', '/api/me', lt)).body.canAddBusiness, false);
});

test('one password and one name for the person, whichever business they are in', async () => {
  assert.equal((await api('POST', '/api/me/password', S.b, { current: 'secret12', password: 'newpass12' })).status, 200, 'changed from the Store');
  assert.equal((await api('POST', '/api/auth/login', null, { login: S.login, password: 'newpass12' })).status, 200, 'signs in with the new one');
  assert.equal((await api('PATCH', '/api/me', S.b, { name: 'Mama Ngono' })).status, 200);
  assert.equal((await api('GET', '/api/me', S.a)).body.user.name, 'Mama Ngono', 'the Brocan shows the new name too');
  const team = (await api('GET', '/api/users', S.b)).body.users; assert.equal(team[0].login, S.login, 'team page shows the real login');
});

test('a person owns at most the platform limit (3 by default)', async () => {
  const third = await api('POST', '/api/businesses', S.a, { businessName: 'Third ' + rnd, edition: 'import' }); assert.equal(third.status, 200);
  const me = (await api('GET', '/api/me', S.a)).body; assert.equal(me.businesses.length, 3); assert.equal(me.canAddBusiness, false);
  const fourth = await api('POST', '/api/businesses', S.a, { businessName: 'Fourth ' + rnd, edition: 'store' });
  assert.equal(fourth.status, 400); assert.equal(fourth.body.code, 'max_businesses');
});
