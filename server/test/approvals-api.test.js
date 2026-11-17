// API tests: manager approval on the spot — PIN, approval for one action on one sale, limits from Settings, lockout.
//   AAHSSO_URL=http://localhost:8080 node --test test/approvals-api.test.js
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
const sale = (id, extra) => Object.assign({ no: id, date: '2026-11-07', status: 'open', discount: 0, lines: [{ productId: 'p1', name: 'Oats', qty: 1, unitPrice: 12000, alloc: [{ lotId: 'l1', qty: 1 }], returns: [] }], payments: [{ id: 'pay_' + id, amount: 12000, method: 'Cash', date: '2026-11-07' }] }, extra || {});
const putSale = (tok, id, doc) => call('PUT', '/api/data/sales/' + id, tok, doc);
const getSale = async (id) => (await call('GET', '/api/data/sales', S.own)).body.docs.find((d) => d.id === id);
const cancelOf = (s) => Object.assign({}, s, { status: 'cancelled', payments: s.payments.concat([{ id: 'rf_' + s.no, amount: -12000, method: 'Cash', date: '2026-11-07' }]) });
const approve = (tok, approverId, pin, action, ref) => call('POST', '/api/approvals', tok, { approverId, pin, action, ref });

test('setup: owner, manager, a sales rep and a rep allowed to discount and cancel', async () => {
  const r = await call('POST', '/api/auth/register', null, { businessName: 'Appr Shop ' + rnd, name: 'Owner', login: 'ap' + rnd, password: 'secret1' }); assert.equal(r.status, 200); S.own = r.body.token;
  for (const [k, role, perms] of [['mgr', 'manager'], ['rep', 'sales'], ['plus', 'sales', { discount: true, cancel: true }]]) {
    const u = await call('POST', '/api/users', S.own, { name: k + ' person', login: k + 'a' + rnd, password: 'pass1234', role, perms, sendEmail: false }); assert.equal(u.status, 200, JSON.stringify(u.body));
    S[k] = (await call('POST', '/api/auth/login', null, { login: k + 'a' + rnd, password: 'pass1234' })).body.token; S[k + 'Id'] = u.body.user.id;
  }
  S.ownId = (await call('GET', '/api/me', S.own)).body.user.id;
  assert.equal((await call('PUT', '/api/data/products/p1', S.own, { name: 'Oats', category: 'Food & Snacks', markup: 100 })).status, 200);
  assert.equal((await call('PUT', '/api/data/lots/l1', S.own, { productId: 'p1', qty: 40, unitCost: 10, currency: 'USD', sourceType: 'Local (Cameroon)', inWarehouse: true, purchaseDate: '2026-11-01' })).status, 200);
});

test('approval PIN: only approvers set one, with their password, and not an easy one', async () => {
  assert.equal((await call('POST', '/api/me/approval-pin', S.rep, { pin: '4826', password: 'pass1234' })).status, 403, 'a sales rep does not approve');
  assert.equal((await call('POST', '/api/me/approval-pin', S.mgr, { pin: '1111', password: 'pass1234' })).status, 400, 'too easy');
  assert.equal((await call('POST', '/api/me/approval-pin', S.mgr, { pin: '4826', password: 'wrong' })).status, 400, 'wrong password');
  assert.equal((await call('POST', '/api/me/approval-pin', S.mgr, { pin: '4826', password: 'pass1234' })).status, 200);
  assert.equal((await call('GET', '/api/me', S.mgr)).body.user.approvalPin, true);
  const list = (await call('GET', '/api/approvers?action=cancel', S.rep)).body.approvers;
  assert.ok(list.some((a) => a.id === S.mgrId && a.pin) && list.some((a) => a.id === S.ownId && !a.pin) && !list.some((a) => a.id === S.repId));
});

test('a sales rep cancels a sale with a manager\'s PIN — for that action on that sale only', async () => {
  assert.equal((await putSale(S.rep, 's1', sale('s1'))).status, 200);
  assert.equal((await putSale(S.rep, 's2', sale('s2'))).status, 200);
  const s1 = await getSale('s1');
  const r = await putSale(S.rep, 's1', cancelOf(s1)); assert.equal(r.status, 403); assert.equal(r.body.code, 'approval_required'); assert.deepEqual([r.body.details.action, r.body.details.ref], ['cancel', 's1']);
  assert.equal((await approve(S.rep, S.ownId, '4826', 'cancel', 's1')).status, 400, 'the owner has no PIN yet');
  const bad = await approve(S.rep, S.mgrId, '0000', 'cancel', 's1'); assert.equal(bad.status, 400); assert.match(bad.body.error, /Wrong PIN \(4 tries left\)/);
  const ok = await approve(S.rep, S.mgrId, '4826', 'cancel', 's1'); assert.equal(ok.status, 200); assert.equal(ok.body.by, 'mgr person');
  assert.equal((await putSale(S.rep, 's2', Object.assign(cancelOf(await getSale('s2')), { approval: [ok.body.approval] }))).status, 403, 'not for another sale');
  const disc = await approve(S.rep, S.mgrId, '4826', 'discount', 's1');
  assert.equal((await putSale(S.rep, 's1', Object.assign(cancelOf(s1), { approval: [disc.body.approval] }))).status, 403, 'a discount approval does not cancel');
  assert.equal((await putSale(S.plus, 's1', Object.assign(cancelOf(s1), { approval: [ok.body.approval] }))).status, 403, 'only for the person who asked');
  assert.equal((await putSale(S.rep, 's1', Object.assign(cancelOf(s1), { approval: [ok.body.approval] }))).status, 200);
  const done = await getSale('s1'); assert.equal(done.status, 'cancelled'); assert.equal(done.approval, undefined, 'the approval itself is never stored');
  assert.equal(done.approvals.length, 1); assert.equal(done.approvals[0].by, 'mgr person'); assert.equal(done.approvals[0].action, 'cancel'); assert.equal(done.approvals[0].for, 'rep person');
});

test('limits from Settings: big discounts and every cancellation need a manager, even for staff allowed to do them', async () => {
  const st = (await call('GET', '/api/data/settings', S.own)).body.docs.find((d) => d.id === 'main') || {};
  assert.equal((await call('PUT', '/api/data/settings/main', S.own, Object.assign({}, st, { approvals: { discountPct: 10, refundAbove: null, cancel: true } }))).status, 200);
  assert.equal((await putSale(S.plus, 'd1', sale('d1', { discount: 600 }))).status, 200, '5% is fine');
  const big = await putSale(S.plus, 'd2', sale('d2', { discount: 3000 })); assert.equal(big.status, 403); assert.equal(big.body.code, 'approval_required'); assert.match(big.body.error, /above 10%/);
  const low = await putSale(S.plus, 'd3', sale('d3', { lines: [{ productId: 'p1', name: 'Oats', qty: 1, unitPrice: 1000, alloc: [{ lotId: 'l1', qty: 1 }], returns: [] }], payments: [] })); assert.equal(low.status, 403, 'a price far below the item price');
  const tok = (await approve(S.plus, S.mgrId, '4826', 'discount', 'd2')).body.approval;
  assert.equal((await putSale(S.plus, 'd2', sale('d2', { discount: 3000, approval: tok }))).status, 200);
  assert.equal((await putSale(S.mgr, 'd4', sale('d4', { discount: 6000 }))).status, 200, 'a manager is never stopped');
  const c = await putSale(S.plus, 'd1', cancelOf(await getSale('d1'))); assert.equal(c.status, 403); assert.equal(c.body.details.action, 'cancel');
  assert.equal((await putSale(S.mgr, 'd4', cancelOf(await getSale('d4')))).status, 200, 'a manager cancels freely');
});

test('five wrong PINs lock the approver for a while', async () => {
  for (let i = 0; i < 5; i++) await approve(S.rep, S.mgrId, '9999', 'cancel', 's2');
  const r = await approve(S.rep, S.mgrId, '4826', 'cancel', 's2'); assert.equal(r.status, 429); assert.match(r.body.error, /Too many wrong PINs/);
});
