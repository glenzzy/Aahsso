/* Authenticator-app codes (TOTP, RFC 6238: SHA-1, 6 digits, 30 s) and encryption of the stored secret.
 * Works with Google Authenticator, Microsoft Authenticator, Authy, 1Password… No extra package needed. */
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function b32decode(str) {
  const s = String(str).toUpperCase().replace(/[^A-Z2-7]/g, ''); let bits = 0, value = 0; const out = [];
  for (const ch of s) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
const newSecret = () => b32encode(crypto.randomBytes(20)); // 160 bits, as the RFC recommends
/** The code for one 30-second step. */
function codeAt(secret, step, digits = 6) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
const stepNow = (ms = Date.now()) => Math.floor(ms / 1000 / 30);
/** Checks a code (allowing one step of clock drift). Returns the matched step, or null. lastStep: refuses a code already used. */
function verify(secret, code, lastStep, ms) {
  const c = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) return null;
  const now = stepNow(ms);
  for (const s of [now, now - 1, now + 1]) {
    if (lastStep !== null && lastStep !== undefined && s <= Number(lastStep)) continue;
    const a = Buffer.from(codeAt(secret, s)), b = Buffer.from(c);
    if (crypto.timingSafeEqual(a, b)) return s;
  }
  return null;
}
const otpauthUrl = (secret, account, issuer = 'Aahsso Admin') => 'otpauth://totp/' + encodeURIComponent(issuer + ':' + account) + '?secret=' + secret + '&issuer=' + encodeURIComponent(issuer) + '&algorithm=SHA1&digits=6&period=30';

/* secrets at rest: AES-256-GCM with a key derived from ADMIN_SECRET */
const key = () => { const s = process.env.ADMIN_SECRET; if (!s || s.length < 32) throw new Error('ADMIN_SECRET must be set (at least 32 characters)'); return crypto.createHash('sha256').update('aahsso-admin:' + s).digest(); };
function seal(text) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'v1.' + iv.toString('base64url') + '.' + c.getAuthTag().toString('base64url') + '.' + enc.toString('base64url');
}
function open(sealed) {
  const [v, iv, tag, enc] = String(sealed || '').split('.'); if (v !== 'v1') throw new Error('bad secret');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}
/** 10 one-time recovery codes like 7H3K-92QD-LM4P. Returns {plain, hashes}. */
function recoveryCodes(n = 10) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const plain = [];
  for (let i = 0; i < n; i++) { const b = crypto.randomBytes(12); let s = ''; for (let j = 0; j < 12; j++) s += A[b[j] % A.length]; plain.push(s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8)); }
  return { plain, hashes: plain.map(hashCode) };
}
const hashCode = (c) => crypto.createHash('sha256').update(String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

module.exports = { newSecret, codeAt, verify, stepNow, otpauthUrl, seal, open, recoveryCodes, hashCode, b32encode, b32decode };
