// Fapshi helpers that need no server: phone numbers, network guess, webhook secret, messages, configuration.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/fapshi');

test('phone numbers become 6XXXXXXXX (Cameroon mobile only)', () => {
  assert.equal(F.normalizePhone('6 77 12 34 56'), '677123456');
  assert.equal(F.normalizePhone('+237 677-12-34-56'), '677123456');
  assert.equal(F.normalizePhone('00237677123456'), '677123456');
  assert.equal(F.normalizePhone('237690000000'), '690000000');
  assert.equal(F.normalizePhone('2 22 12 34 56'), null, 'landline');
  assert.equal(F.normalizePhone('67712345'), null, 'too short');
  assert.equal(F.normalizePhone('+234 803 123 4567'), null, 'other country');
  assert.equal(F.normalizePhone(''), null);
});

test('network guessed from the number (Fapshi test numbers included)', () => {
  for (const n of ['677123456', '651123456', '681123456', '670000000', '650000000']) assert.equal(F.guessNetwork(n), 'mtn', n);
  for (const n of ['699123456', '656123456', '687123456', '690000000', '656000000']) assert.equal(F.guessNetwork(n), 'orange', n);
  assert.equal(F.guessNetwork('662123456'), null, 'Nexttel: not offered');
});

test('webhook: the x-wh-secret header must match when a secret is set', () => {
  process.env.FAPSHI_WEBHOOK_SECRET = 'wh-secret-123';
  try {
    assert.equal(F.verifyWebhook({}), false, 'no secret sent');
    assert.equal(F.verifyWebhook({ 'x-wh-secret': 'nope' }), false, 'wrong secret');
    assert.equal(F.verifyWebhook({ 'x-wh-secret': 'wh-secret-123' }), true);
  } finally { delete process.env.FAPSHI_WEBHOOK_SECRET; }
  assert.equal(F.verifyWebhook({}), true, 'no secret set: the status is re-checked anyway');
});

test('Fapshi errors become plain words; set-up problems never show technical text', () => {
  assert.equal(F.friendly(403, 'Invalid API credentials'), F.MSG.SETUP);
  assert.equal(F.friendly(400, 'IP not whitelisted'), F.MSG.SETUP);
  assert.match(F.friendly(429, ''), /Too many/);
  assert.equal(F.friendly(400, 'Invalid phone number'), 'Invalid phone number');
});

test('off without both keys; sandbox unless switched off', () => {
  const keep = { ...process.env };
  try {
    delete process.env.FAPSHI_API_USER; delete process.env.FAPSHI_API_KEY; assert.equal(F.enabled(), false);
    process.env.FAPSHI_API_USER = 'u'; assert.equal(F.enabled(), false, 'key missing');
    process.env.FAPSHI_API_KEY = 'k'; delete process.env.FAPSHI_SANDBOX; delete process.env.FAPSHI_BASE_URL;
    assert.equal(F.enabled(), true); assert.equal(F.cfg().baseUrl, 'https://sandbox.fapshi.com');
    process.env.FAPSHI_SANDBOX = 'false'; assert.equal(F.cfg().baseUrl, 'https://live.fapshi.com');
  } finally { process.env = keep; }
});
