// pawaPay helpers that need no server: phone numbers, network guess, callback checks, messages.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const P = require('../src/pawapay');

test('phone numbers become 2376XXXXXXXX (Cameroon mobile only)', () => {
  assert.equal(P.normalizePhone('6 77 12 34 56'), '237677123456');
  assert.equal(P.normalizePhone('+237 677-12-34-56'), '237677123456');
  assert.equal(P.normalizePhone('00237677123456'), '237677123456');
  assert.equal(P.normalizePhone('237690000000'), '237690000000');
  assert.equal(P.normalizePhone('2 22 12 34 56'), null, 'landline');
  assert.equal(P.normalizePhone('67712345'), null, 'too short');
  assert.equal(P.normalizePhone('+234 803 123 4567'), null, 'other country');
  assert.equal(P.normalizePhone(''), null);
});

test('network guessed from the number', () => {
  assert.equal(P.guessNetwork('677123456'), 'MTN_MOMO_CMR');
  assert.equal(P.guessNetwork('651123456'), 'MTN_MOMO_CMR');
  assert.equal(P.guessNetwork('681123456'), 'MTN_MOMO_CMR');
  assert.equal(P.guessNetwork('699123456'), 'ORANGE_CMR');
  assert.equal(P.guessNetwork('656123456'), 'ORANGE_CMR');
  assert.equal(P.guessNetwork('687123456'), 'ORANGE_CMR');
  assert.equal(P.guessNetwork('662123456'), null, 'Nexttel: not offered');
});

test('callback: shared secret and Content-Digest', () => {
  const body = Buffer.from(JSON.stringify({ depositId: crypto.randomUUID(), status: 'COMPLETED' }));
  process.env.PAWAPAY_CALLBACK_SECRET = 'cb-secret-123';
  try {
    assert.equal(P.verifyCallback({ rawBody: body, headers: {}, query: {} }).ok, false, 'no token');
    assert.equal(P.verifyCallback({ rawBody: body, headers: {}, query: { token: 'nope' } }).ok, false, 'wrong token');
    assert.equal(P.verifyCallback({ rawBody: body, headers: {}, query: { token: 'cb-secret-123' } }).ok, true, 'token in the URL');
    assert.equal(P.verifyCallback({ rawBody: body, headers: { 'x-callback-token': 'cb-secret-123' }, query: {} }).ok, true, 'token in a header');
    const good = 'sha-512=:' + crypto.createHash('sha512').update(body).digest('base64') + ':';
    assert.equal(P.verifyCallback({ rawBody: body, headers: { 'content-digest': good }, query: { token: 'cb-secret-123' } }).ok, true, 'digest matches');
    assert.equal(P.verifyCallback({ rawBody: Buffer.from('{"changed":1}'), headers: { 'content-digest': good }, query: { token: 'cb-secret-123' } }).ok, false, 'body changed');
  } finally { delete process.env.PAWAPAY_CALLBACK_SECRET; }
  assert.equal(P.verifyCallback({ rawBody: body, headers: {}, query: {} }).ok, true, 'no secret set: status is re-checked anyway');
});

test('failure codes become plain words; set-up problems never show technical text', () => {
  assert.match(P.friendly('INSUFFICIENT_BALANCE'), /not enough money/);
  assert.match(P.friendly('PAYMENT_NOT_APPROVED'), /PIN/);
  assert.match(P.friendly('AUTHENTICATION_ERROR', 'Bearer token invalid'), /not set up correctly/);
  assert.doesNotMatch(P.friendly('AUTHENTICATION_ERROR', 'Bearer token invalid'), /Bearer/);
  assert.equal(P.friendly('SOMETHING_NEW', 'Raw message'), 'Raw message');
});

test('off without a token; sandbox unless switched off', () => {
  const keep = { ...process.env };
  try {
    delete process.env.PAWAPAY_API_TOKEN; assert.equal(P.enabled(), false);
    process.env.PAWAPAY_API_TOKEN = 'x'; delete process.env.PAWAPAY_SANDBOX; delete process.env.PAWAPAY_BASE_URL;
    assert.equal(P.enabled(), true); assert.equal(P.cfg().baseUrl, 'https://api.sandbox.pawapay.io');
    process.env.PAWAPAY_SANDBOX = 'false'; assert.equal(P.cfg().baseUrl, 'https://api.pawapay.io');
  } finally { process.env = keep; }
});
