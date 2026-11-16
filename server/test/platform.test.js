// Unit tests: authenticator codes (RFC 6238), secret encryption, recovery codes, billing periods.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'unit-test-admin-secret-0123456789abcdef';
const totp = require('../src/totp');
const { addPeriod } = require('../src/billing');

test('TOTP matches the RFC 6238 test vectors', () => {
  const secret = totp.b32encode(Buffer.from('12345678901234567890'));
  for (const [t, code] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
    assert.equal(totp.codeAt(secret, Math.floor(t / 30), 8), code);
  }
});
test('TOTP accepts one step of drift, refuses reuse and garbage', () => {
  const s = totp.newSecret(); const now = Date.now(); const step = totp.stepNow(now);
  assert.equal(totp.verify(s, totp.codeAt(s, step), null, now), step);
  assert.equal(totp.verify(s, totp.codeAt(s, step - 1), null, now), step - 1, '30 s late is fine');
  assert.equal(totp.verify(s, totp.codeAt(s, step - 3), null, now), null, '90 s late is not');
  assert.equal(totp.verify(s, totp.codeAt(s, step), step, now), null, 'already used');
  assert.equal(totp.verify(s, '12345', null, now), null); assert.equal(totp.verify(s, 'abcdef', null, now), null);
  assert.equal(totp.b32decode(totp.b32encode(Buffer.from('hello world'))).toString(), 'hello world');
});
test('secrets are encrypted and tamper-proof', () => {
  const sealed = totp.seal('JBSWY3DPEHPK3PXP'); assert.ok(sealed.startsWith('v1.') && !sealed.includes('JBSWY3DP'));
  assert.equal(totp.open(sealed), 'JBSWY3DPEHPK3PXP');
  const parts = sealed.split('.'); parts[3] = Buffer.from('x' + Buffer.from(parts[3], 'base64url').toString('latin1')).toString('base64url');
  assert.throws(() => totp.open(parts.join('.')));
  assert.notEqual(totp.seal('same'), totp.seal('same'), 'a fresh IV every time');
});
test('recovery codes: 10 unique, stored as hashes, case and dashes ignored', () => {
  const { plain, hashes } = totp.recoveryCodes();
  assert.equal(new Set(plain).size, 10); assert.ok(plain.every((c) => /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)));
  assert.equal(totp.hashCode(plain[0].toLowerCase().replace(/-/g, ' ')), hashes[0]);
});
test('billing periods: month ends and leap years', () => {
  const d = (s) => new Date(s + 'T10:00:00Z');
  assert.equal(addPeriod(d('2026-01-31'), 'monthly').toISOString().slice(0, 10), '2026-02-28');
  assert.equal(addPeriod(d('2028-01-31'), 'monthly').toISOString().slice(0, 10), '2028-02-29');
  assert.equal(addPeriod(d('2026-03-15'), 'monthly').toISOString().slice(0, 10), '2026-04-15');
  assert.equal(addPeriod(d('2026-12-20'), 'monthly').toISOString().slice(0, 10), '2027-01-20');
  assert.equal(addPeriod(d('2028-02-29'), 'yearly').toISOString().slice(0, 10), '2029-02-28');
  assert.equal(addPeriod(d('2026-06-01'), 'yearly').toISOString().slice(0, 10), '2027-06-01');
});

const KC = require('../public/compute.js');
test('plan features: permissions and pages of a feature that is off disappear', () => {
  const off = { payroll: false, buy: false, attendance: false, leave: false };
  assert.equal(KC.featureOn(null, 'payroll'), true, 'no plan info (trial / this device) = everything on');
  assert.equal(KC.featureOn(off, 'payroll'), false); assert.equal(KC.featureOn(off, 'sell'), true);
  const owner = KC.permsFor({ role: 'owner' }, {});
  const cut = KC.permsWithFeatures(owner, off);
  assert.equal(cut.payroll, false); assert.equal(cut.purchases, false); assert.equal(cut.sell, true);
  assert.equal(cut.hr, false, 'attendance, leave and payroll all off → the staff permission is off');
  assert.equal(KC.permFeatureOn({ payroll: false }, 'hr'), true, 'still on while attendance or leave is in the plan');
  assert.equal(KC.permFeatureOn({ attendance: false, leave: false, payroll: false }, 'hr'), false);
  assert.equal(KC.routeFeatureOn(off, 'buy'), false); assert.equal(KC.routeFeatureOn(off, 'ship'), true);
  assert.equal(KC.routeFeatureOn({ cashHandover: false }, 'cash'), true, 'cash page stays for till takeover');
  assert.equal(KC.routeFeatureOn({ cashHandover: false, tills: false }, 'cash'), false);
  assert.ok(KC.FEATURE_KEYS.length >= 25); assert.equal(new Set(KC.FEATURE_KEYS).size, KC.FEATURE_KEYS.length);
  Object.values(KC.PERM_FEATURE).flat().concat(Object.values(KC.ROUTE_FEATURE).flat(), Object.values(KC.COLLECTION_FEATURE).flat()).forEach((k) => assert.ok(KC.FEATURE_KEYS.includes(k), 'known feature ' + k));
});
test('roles: new granular permissions; roles saved before them keep working; edited roles are exact', () => {
  assert.equal(KC.permsFor({ role: 'sales' }, {}).orders, true);
  assert.equal(KC.permsFor({ role: 'sales' }, {}).promos, false);
  assert.equal(KC.permsFor({ role: 'manager' }, {}).promos, true);
  assert.equal(KC.permsFor({ role: 'cashier' }, { cashier: { label: 'Cashier', perms: ['sell', 'payments'] } }).orders, true, 'old custom role');
  assert.equal(KC.permsFor({ role: 'cashier' }, { cashier: { label: 'Cashier', perms: ['sell', 'payments'], v: 2 } }).orders, false, 'saved with the new editor: exactly what was ticked');
});
