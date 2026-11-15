// API tests: shop address (slug), attendance, leave, employee files, payroll privacy, till takeovers.
//   KARGO_URL=http://localhost:8080 node --test test/staff-api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const B = process.env.KARGO_URL || 'http://localhost:8080';
const rnd = Math.random().toString(36).slice(2, 8);
const today = new Date(); const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const T = ymd(today);

async function call(method, path, token, body, redirect) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token; if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(B + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: redirect || 'follow' });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.text() };
}
const S = {};
const me = async (t) => (await call('GET', '/api/me', t)).body.user;
const sid = (uid) => 'u_' + uid;

test('setup: two businesses, a manager and two cashiers', async () => {
  for (const [k, name] of [['own', 'Mama Beauté ' + rnd], ['own2', 'Other Shop ' + rnd]]) {
    const r = await call('POST', '/api/auth/register', null, { businessName: name, name: 'Owner', login: k + rnd, password: 'secret1' }); assert.equal(r.status, 200); S[k] = r.body.token;
  }
  for (const [k, role] of [['mgr', 'manager'], ['a', 'sales'], ['b', 'sales']]) {
    const u = await call('POST', '/api/users', S.own, { name: k.toUpperCase() + ' person', login: k + rnd, password: 'pass1234', role, sendEmail: false }); assert.equal(u.status, 200, JSON.stringify(u.body));
    S[k] = (await call('POST', '/api/auth/login', null, { login: k + rnd, password: 'pass1234' })).body.token; S[k + 'Id'] = u.body.user.id;
  }
});

test('shop address: made from the name, unique across businesses, old links redirect', async () => {
  const slug = 'mama-beaute-' + rnd;
  const chk = (await call('GET', '/api/shop-address?slug=' + encodeURIComponent('Mama Beauté ' + rnd), S.own)).body;
  assert.equal(chk.slug, slug); assert.equal(chk.available, true);
  assert.equal((await call('PUT', '/api/data/settings/main', S.own, { businessName: 'Mama Beauté ' + rnd, shopEnabled: true, shopId: 'oldkey' + rnd, shopSlug: slug })).status, 200);
  // another business cannot take it (any case)
  const r = await call('PUT', '/api/data/settings/main', S.own2, { businessName: 'Other', shopEnabled: true, shopSlug: slug });
  assert.equal(r.status, 409); assert.match(r.body.error, new RegExp(slug + '-2'));
  const c2 = (await call('GET', '/api/shop-address?slug=' + slug.toUpperCase(), S.own2)).body; assert.equal(c2.available, false); assert.equal(c2.suggestion, slug + '-2');
  assert.equal((await call('GET', '/api/shop-address?slug=' + slug, S.own)).body.available, true, 'your own address is fine for you');
  assert.equal((await call('PUT', '/api/data/settings/main', S.own2, { shopSlug: 'admin' })).status, 400, 'reserved');
  assert.equal((await call('PUT', '/api/data/settings/main', S.own2, { shopSlug: 'a b' })).status, 400, 'invalid');
  assert.equal((await call('PUT', '/api/data/settings/main', S.own2, { shopSlug: 'oldkey' + rnd })).status, 409, 'cannot take another shop\'s old key');
  // the shop answers on the address, on the old key, and in any case
  assert.equal((await call('GET', '/api/shop/' + slug)).status, 200);
  assert.equal((await call('GET', '/api/shop/' + slug.toUpperCase())).status, 200);
  assert.equal((await call('GET', '/api/shop/oldkey' + rnd)).status, 200);
  const red = await call('GET', '/s/oldkey' + rnd, null, null, 'manual'); assert.equal(red.status, 301); assert.equal(red.headers.get('location'), '/s/' + slug);
  assert.equal((await call('GET', '/s/' + slug, null, null, 'manual')).status, 200);
  // a stale settings save without the field keeps the address
  assert.equal((await call('PUT', '/api/data/settings/main', S.own, { businessName: 'Mama Beauté ' + rnd, shopEnabled: true, shopId: 'oldkey' + rnd })).status, 200);
  assert.equal((await call('GET', '/api/shop/' + slug)).status, 200);
});

test('attendance: clock in for yourself only, with the server\'s time; managers correct', async () => {
  const a = await me(S.a); const id = 'at_' + T + '_' + sid(a.id);
  const now = new Date().toISOString();
  assert.equal((await call('PUT', '/api/data/attendance/' + id, S.a, { staffId: sid(a.id), date: T, events: [{ t: 'in', at: now }] })).status, 200);
  assert.equal((await call('PUT', '/api/data/attendance/at_' + T + '_' + sid(S.bId), S.a, { staffId: sid(S.bId), date: T, events: [{ t: 'in', at: now }] })).status, 403, 'not for a colleague');
  assert.equal((await call('PUT', '/api/data/attendance/' + id, S.a, { staffId: sid(a.id), date: T, events: [{ t: 'in', at: new Date(Date.now() - 3600e3).toISOString() }] })).status, 403, 'cannot move an earlier time');
  const future = new Date(Date.now() + 3 * 3600e3).toISOString();
  let doc = (await call('GET', '/api/data/attendance', S.a)).body.docs.find((d) => d.id === id);
  assert.equal((await call('PUT', '/api/data/attendance/' + id, S.a, Object.assign({}, doc, { events: doc.events.concat([{ t: 'break', at: future }]) }))).status, 200);
  doc = (await call('GET', '/api/data/attendance', S.a)).body.docs.find((d) => d.id === id);
  assert.equal(doc.events[1].fixed, true, 'a wrong phone clock is replaced by the server time'); assert.ok(Date.parse(doc.events[1].at) < Date.now() + 60e3);
  assert.equal(doc.events[0].by, 'A person');
  // the phone's copy has no server fields yet: a further tap still works and nothing is duplicated
  const phone = { staffId: sid(a.id), date: T, events: [{ t: 'in', at: now }, { t: 'break', at: future }, { t: 'back', at: new Date().toISOString() }] };
  assert.equal((await call('PUT', '/api/data/attendance/' + id, S.a, phone)).status, 200, 'tap with a stale copy');
  doc = (await call('GET', '/api/data/attendance', S.a)).body.docs.find((d) => d.id === id);
  assert.deepEqual(doc.events.map((e) => e.t), ['in', 'break', 'back']); assert.equal(doc.editedBy, undefined, 'own taps are not corrections');
  assert.equal((await call('PUT', '/api/data/attendance/wrong-id', S.a, { staffId: sid(a.id), date: T, events: [] })).status, 400);
  // B cannot see A's times; the manager can and may correct them
  assert.ok(!(await call('GET', '/api/data/attendance', S.b)).body.docs.some((d) => d.id === id));
  const fix = Object.assign({}, doc, { events: [{ t: 'in', at: T + 'T07:58:00.000Z' }, { t: 'out', at: T + 'T16:00:00.000Z' }], note: 'forgot to clock out' });
  assert.equal((await call('PUT', '/api/data/attendance/' + id, S.mgr, fix)).status, 200);
  doc = (await call('GET', '/api/data/attendance', S.mgr)).body.docs.find((d) => d.id === id);
  assert.equal(doc.editedBy, 'MGR person'); assert.equal(doc.events.length, 2);
  assert.equal(doc.events[1].at, T + 'T16:00:00.000Z', 'a correction keeps the typed time even if later than now');
});

test('leave: ask for yourself; only a manager approves; colleagues see dates, not reasons', async () => {
  const a = await me(S.a);
  const lv = { staffId: sid(a.id), type: 'vacation', from: '2026-12-21', to: '2026-12-24', reason: 'family wedding', status: 'requested' };
  assert.equal((await call('PUT', '/api/data/leaves/lv1' + rnd, S.a, lv)).status, 200);
  assert.equal((await call('PUT', '/api/data/leaves/lv1' + rnd, S.a, Object.assign({}, lv, { status: 'approved' }))).status, 403, 'cannot approve own leave');
  assert.equal((await call('PUT', '/api/data/leaves/lv2' + rnd, S.a, Object.assign({}, lv, { status: 'approved' }))).status, 403, 'cannot create approved leave');
  assert.equal((await call('PUT', '/api/data/leaves/lv3' + rnd, S.a, Object.assign({}, lv, { staffId: sid(S.bId) }))).status, 403, 'not for a colleague');
  assert.equal((await call('PUT', '/api/data/leaves/lv4' + rnd, S.a, Object.assign({}, lv, { type: 'holiday' }))).status, 400);
  assert.equal((await call('PUT', '/api/data/leaves/lv1' + rnd, S.mgr, Object.assign({}, lv, { status: 'approved' }))).status, 200);
  const got = (await call('GET', '/api/data/leaves', S.mgr)).body.docs.find((d) => d.id === 'lv1' + rnd);
  assert.equal(got.decidedBy, 'MGR person'); assert.equal(got.staffName, 'A person');
  const seen = (await call('GET', '/api/data/leaves', S.b)).body.docs.find((d) => d.id === 'lv1' + rnd);
  assert.ok(seen && seen.from === '2026-12-21' && !seen.reason, 'colleague sees who is off, not why');
  assert.equal((await call('PUT', '/api/data/leaves/lv1' + rnd, S.a, Object.assign({}, lv, { status: 'cancelled' }))).status, 403, 'approved leave: ask a manager');
});

test('employee files: salaries only for payroll; payslips private', async () => {
  const a = await me(S.a);
  assert.equal((await call('PUT', '/api/data/staff/' + sid(a.id), S.a, { name: 'x' })).status, 403, 'cashier cannot edit files');
  assert.equal((await call('PUT', '/api/data/staff/' + sid(a.id), S.mgr, { name: 'A person', userId: a.id, title: 'Cashier', pay: { type: 'monthly', rate: 999999 } })).status, 200);
  let f = (await call('GET', '/api/data/staff', S.own)).body.docs.find((d) => d.id === sid(a.id)); assert.equal(f.pay, undefined, 'manager without payroll cannot set pay');
  assert.equal((await call('PUT', '/api/data/staff/' + sid(a.id), S.own, Object.assign({}, f, { pay: { type: 'monthly', rate: 120000 } }))).status, 200);
  assert.equal((await call('PUT', '/api/data/staff/' + sid(a.id), S.mgr, Object.assign({}, f, { title: 'Head cashier' }))).status, 200);
  f = (await call('GET', '/api/data/staff', S.own)).body.docs.find((d) => d.id === sid(a.id)); assert.equal(f.pay.rate, 120000, 'manager edit keeps the pay'); assert.equal(f.title, 'Head cashier');
  assert.equal((await call('GET', '/api/data/staff', S.mgr)).body.docs.find((d) => d.id === sid(a.id)).pay, undefined, 'manager does not see salaries');
  assert.equal((await call('GET', '/api/data/staff', S.a)).body.docs.find((d) => d.id === sid(a.id)).pay.rate, 120000, 'you see your own pay');
  const other = (await call('GET', '/api/data/staff', S.b)).body.docs.find((d) => d.id === sid(a.id)); assert.equal(other.pay, undefined); assert.equal(other.phone, undefined);
  // payslips
  const slip = { type: 'slip', staffId: sid(a.id), staffName: 'A person', month: '2026-11', gross: 120000, deductionsTotal: 0, net: 120000, earnings: [], deductions: [], status: 'draft' };
  assert.equal((await call('PUT', '/api/data/payroll/ps_2026-11_' + sid(a.id), S.mgr, slip)).status, 403, 'manager has no payroll right by default');
  assert.equal((await call('PUT', '/api/data/payroll/ps_2026-11_' + sid(a.id), S.own, slip)).status, 200);
  assert.equal((await call('GET', '/api/data/payroll', S.a)).body.docs.length, 0, 'drafts are not shown to the employee');
  assert.equal((await call('PUT', '/api/data/payroll/ps_2026-11_' + sid(a.id), S.own, Object.assign({}, slip, { status: 'paid', paidAt: T }))).status, 200);
  assert.equal((await call('GET', '/api/data/payroll', S.a)).body.docs.length, 1, 'own paid payslip');
  assert.equal((await call('GET', '/api/data/payroll', S.b)).body.docs.length, 0, 'not a colleague\'s');
});

test('till takeover: count, the next cashier recounts; money moves between their days', async () => {
  const sale = (id, by, amt) => ({ no: id, date: T, status: 'open', discount: 0, lines: [{ productId: 'p1', name: 'Oats', qty: 1, unitPrice: amt, alloc: [{ lotId: 'l1', qty: 1 }], returns: [] }], payments: [{ id: 'pay' + id, amount: amt, method: 'Cash', date: T }] });
  assert.equal((await call('PUT', '/api/data/products/p1', S.own, { name: 'Oats', category: 'Food & Snacks', markup: 100 })).status, 200);
  assert.equal((await call('PUT', '/api/data/lots/l1', S.own, { productId: 'p1', qty: 50, unitCost: 10, currency: 'USD', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-01' })).status, 200);
  assert.equal((await call('PUT', '/api/data/sales/ta1', S.a, sale('ta1', 'a', 12000))).status, 200);
  assert.equal((await call('PUT', '/api/data/sales/ta2', S.a, sale('ta2', 'a', 13000))).status, 200);
  const t = { date: T, fromId: S.aId, toId: S.bId, toName: 'B person', counted: { Cash: 25000 }, expected: { Cash: 1 } };
  assert.equal((await call('PUT', '/api/data/tills/tl1' + rnd, S.b, t)).status, 403, 'cannot hand over someone else\'s till');
  assert.equal((await call('PUT', '/api/data/tills/tl1' + rnd, S.a, t)).status, 200);
  let doc = (await call('GET', '/api/data/tills', S.a)).body.docs.find((d) => d.id === 'tl1' + rnd);
  assert.deepEqual(doc.expected, { Cash: 25000 }, 'expected comes from the server'); assert.equal(doc.status, 'pending'); assert.equal(doc.fromName, 'A person');
  assert.equal((await call('PUT', '/api/data/tills/tl1' + rnd, S.a, Object.assign({}, doc, { status: 'accepted', received: { Cash: 25000 } }))).status, 403, 'only B accepts');
  assert.equal((await call('PUT', '/api/data/tills/tl1' + rnd, S.b, Object.assign({}, doc, { status: 'accepted', received: { Cash: 24000 }, counted: { Cash: 24000 } }))).status, 200);
  doc = (await call('GET', '/api/data/tills', S.b)).body.docs.find((d) => d.id === 'tl1' + rnd);
  assert.equal(doc.status, 'disputed', 'counts differ'); assert.deepEqual(doc.counted, { Cash: 25000 }, 'A\'s count cannot be rewritten');
  assert.equal((await call('PUT', '/api/data/tills/tl1' + rnd, S.b, Object.assign({}, doc, { received: { Cash: 25000 } }))).status, 403, 'closed');
  // end of day: A answers for 1,000; B for 24,000
  const hoA = await call('PUT', '/api/data/handovers/h_' + T + '_' + S.aId, S.a, { date: T, userId: S.aId, declared: { Cash: 0 }, status: 'submitted' });
  assert.equal(hoA.status, 200);
  const hs = (await call('GET', '/api/data/handovers', S.own)).body.docs;
  assert.equal(hs.find((h) => h.userId === S.aId).expectedTotal, 1000);
  assert.equal((await call('PUT', '/api/data/handovers/h_' + T + '_' + S.bId, S.b, { date: T, userId: S.bId, declared: { Cash: 24000 }, status: 'submitted' })).status, 200);
  assert.equal((await call('GET', '/api/data/handovers', S.own)).body.docs.find((h) => h.userId === S.bId).expectedTotal, 24000);
  // C (manager without the handover right? owner) closes the dispute; cashiers see only their own takeovers
  assert.equal((await call('PUT', '/api/data/tills/tl1' + rnd, S.a, Object.assign({}, doc, { status: 'reviewed' }))).status, 403);
  assert.equal((await call('PUT', '/api/data/tills/tl1' + rnd, S.own, Object.assign({}, doc, { status: 'reviewed', reviewNote: 'coin roll miscounted' }))).status, 200);
  assert.equal((await call('GET', '/api/data/tills', S.mgr)).body.docs.length, 1, 'manager sees all');
  const names = (await call('GET', '/api/team-names', S.a)).body.people; assert.ok(names.some((p) => p.name === 'B person') && !names[0].login, 'names only');
});
