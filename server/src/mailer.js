/* Emails through Resend (https://resend.com) — plain HTTPS, no extra package.
 *   RESEND_API_KEY   your Resend API key (re_…). Without it emails are not sent: they are logged as "skipped".
 *   EMAIL_FROM       sender, on a domain verified in Resend, e.g. "Kargo <no-reply@mail.yourshop.com>"
 *   EMAIL_REPLY_TO   optional reply-to address
 *   APP_URL          public address of the app, used in links (e.g. https://kargo.yourshop.com)
 *   RESEND_API_URL   only for tests (defaults to https://api.resend.com)
 * Every attempt is written to email_log. A `dedupe` key makes automatic emails go out only once. */
const { q } = require('./db');

const API = () => (process.env.RESEND_API_URL || 'https://api.resend.com').replace(/\/$/, '');
const enabled = () => !!process.env.RESEND_API_KEY;
const FROM = () => process.env.EMAIL_FROM || 'Kargo <onboarding@resend.dev>';
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/;
const isEmail = (v) => EMAIL_RE.test(String(v || '').trim());
/** Where to write to a user: their email, or their login when the login is an email. */
const emailOf = (u) => (u && isEmail(u.email) ? String(u.email).trim().toLowerCase() : u && isEmail(u.login) ? String(u.login).trim().toLowerCase() : null);
/** Public address of the app for links (APP_URL, else the address the request came in on). */
function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (req && req.get) return (req.get('x-forwarded-proto') || req.protocol || 'https') + '://' + req.get('host');
  return '';
}
const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, sym) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' ' + (sym || 'FCFA');

/** Send one email. Never throws: returns { status: 'sent' | 'skipped' | 'failed' | 'duplicate', id?, error? }. */
async function sendEmail({ to, subject, html, text, kind = 'other', tenantId = null, dedupe = null, replyTo }) {
  to = String(to || '').trim().toLowerCase();
  if (!isEmail(to)) return { status: 'failed', error: 'no valid email address' };
  if (dedupe) {
    const seen = await q("SELECT 1 FROM email_log WHERE dedupe=$1 AND status <> 'failed' LIMIT 1", [dedupe]).catch(() => ({ rowCount: 0 }));
    if (seen.rowCount) return { status: 'duplicate' };
  }
  let status = 'sent', id = null, error = null;
  if (!enabled()) { status = 'skipped'; error = 'RESEND_API_KEY not set'; console.log('[email:skipped]', kind, '→', to, '·', subject); }
  else {
    try {
      const headers = { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' };
      if (dedupe) headers['Idempotency-Key'] = String(dedupe).slice(0, 256);
      const body = { from: FROM(), to: [to], subject, html, text };
      const rt = replyTo || process.env.EMAIL_REPLY_TO; if (rt && isEmail(rt)) body.reply_to = rt;
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 10000);
      const r = await fetch(API() + '/emails', { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal }).finally(() => clearTimeout(timer));
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { status = 'failed'; error = (j && (j.message || j.error)) || ('Resend ' + r.status); }
      else id = j.id || null;
    } catch (e) { status = 'failed'; error = e.name === 'AbortError' ? 'Resend did not answer in time' : e.message; }
    if (status === 'failed') console.error('[email:failed]', kind, '→', to, '·', error);
  }
  await q('INSERT INTO email_log(tenant_id,kind,dedupe,to_addr,subject,status,provider_id,error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [tenantId, kind, dedupe, to, String(subject || '').slice(0, 300), status, id, error])
    .catch((e) => { if (e.code === '23505') status = 'duplicate'; else console.error('[email:log]', e.message); });
  return { status, id, error };
}

/* ---------- templates: one calm layout, a clear title, a button, short lines ---------- */
function layout({ business, title, intro, rows, button, outro, footnote }) {
  const kv = (rows || []).filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== '').map(([k, v, strong]) =>
    '<tr><td style="padding:8px 0;color:#6b7785;font-size:14px;width:42%;vertical-align:top">' + esc(k) + '</td><td style="padding:8px 0;font-size:15px;color:#14202e;' + (strong ? 'font-weight:700;font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.02em' : 'font-weight:600') + '">' + esc(v) + '</td></tr>').join('');
  const html = '<!doctype html><html><body style="margin:0;background:#f3f2ee;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14202e">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ee;padding:28px 12px"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:14px;border:1px solid #e4e2db">' +
    '<tr><td style="padding:22px 28px 0"><span style="display:inline-block;width:34px;height:34px;border-radius:9px;background:#e8a33d;color:#14202e;font-weight:800;text-align:center;line-height:34px;font-size:16px">K</span>' +
      '<span style="font-weight:700;font-size:15px;margin-left:10px;vertical-align:middle">' + esc(business || 'Kargo') + '</span></td></tr>' +
    '<tr><td style="padding:18px 28px 6px"><h1 style="margin:0 0 10px;font-size:21px;line-height:1.3">' + esc(title) + '</h1>' +
      (intro ? '<p style="margin:0 0 6px;font-size:15px;line-height:1.55;color:#33404d">' + intro + '</p>' : '') + '</td></tr>' +
    (kv ? '<tr><td style="padding:6px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #efede8;border-bottom:1px solid #efede8">' + kv + '</table></td></tr>' : '') +
    (button ? '<tr><td style="padding:18px 28px 4px"><a href="' + esc(button.url) + '" style="display:inline-block;background:#0d5c63;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px">' + esc(button.label) + '</a></td></tr>' : '') +
    (outro ? '<tr><td style="padding:14px 28px 4px"><p style="margin:0;font-size:14px;line-height:1.55;color:#4a5868">' + outro + '</p></td></tr>' : '') +
    '<tr><td style="padding:20px 28px 24px"><p style="margin:0;font-size:12px;color:#8793a1;line-height:1.5">' + (footnote || 'Sent by Kargo for ' + esc(business || 'your business') + '.') + '</p></td></tr>' +
    '</table></td></tr></table></body></html>';
  const strip = (s) => String(s || '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [title, '', strip(intro), '', ...(rows || []).filter((r) => r && r[1]).map(([k, v]) => k + ': ' + v), button ? '\n' + button.label + ': ' + button.url : '', outro ? '\n' + strip(outro) : '', '', strip(footnote || 'Sent by Kargo for ' + (business || 'your business') + '.')].join('\n').replace(/\n{3,}/g, '\n\n');
  return { html, text };
}
const ROLE_NAMES = { owner: 'Owner', admin: 'Admin', manager: 'Manager', sales: 'Sales', viewer: 'Viewer' };
const T = {
  /** New team member, or a password reset by the owner / an admin: their login and password. */
  staffAccount({ name, business, login, password, role, url, by, reset }) {
    const subject = reset ? 'Your new password for ' + business : 'Your ' + business + ' account on Kargo';
    return Object.assign({ subject }, layout({ business, title: reset ? 'Your password was reset' : 'Welcome to ' + business,
      intro: 'Hello ' + esc(name) + ',<br>' + (reset ? esc(by || 'Your manager') + ' set a new password for your account.' : esc(by || 'The owner') + ' created an account for you on Kargo, the app ' + esc(business) + ' uses for stock and sales.'),
      rows: [['Sign in at', url], ['Login', login, true], [reset ? 'New password' : 'Password', password, true], reset ? null : ['Role', ROLE_NAMES[role] || role]],
      button: { label: 'Sign in to Kargo', url }, outro: 'Please change this password after you sign in: <b>Settings → Account</b>. Keep it to yourself.',
      footnote: 'You get this email because ' + esc(business) + ' added you to their team. If this is a mistake, you can ignore it.' }));
  },
  welcomeOwner({ name, business, login, trialEnds, url }) {
    return Object.assign({ subject: 'Welcome to Kargo, ' + name }, layout({ business, title: business + ' is ready',
      intro: 'Hello ' + esc(name) + ',<br>your business is set up on Kargo. Your goods follow four steps: <b>Buy → Ship → Receive → Sell</b>.',
      rows: [['Sign in at', url], ['Login', login, true], ['Free trial until', trialEnds]],
      button: { label: 'Open Kargo', url },
      outro: 'Next: add your logo and MoMo numbers in Settings, record your first purchase, then add your team — each person gets their login by email.' }));
  },
  passwordReset({ name, url, minutes }) {
    return Object.assign({ subject: 'Reset your Kargo password' }, layout({ business: 'Kargo', title: 'Reset your password',
      intro: 'Hello ' + esc(name) + ',<br>we got a request to reset the password of your Kargo account. The link works once, for ' + minutes + ' minutes.',
      button: { label: 'Choose a new password', url },
      outro: 'If you did not ask for this, ignore this email — your password stays the same.', footnote: 'Kargo account security.' }));
  },
  passwordChanged({ name, business, url, when }) {
    return Object.assign({ subject: 'Your Kargo password was changed' }, layout({ business, title: 'Your password was changed',
      intro: 'Hello ' + esc(name) + ',<br>the password of your Kargo account was changed on ' + esc(when) + '.',
      outro: 'If this was not you, ask the owner of ' + esc(business) + ' to reset your password straight away, or use “Forgot password” at <a href="' + esc(url) + '">' + esc(url) + '</a>.',
      footnote: 'Kargo account security.' }));
  },
  newOrder({ business, order, url, sym }) {
    const c = order.customer || {}; const d = order.delivery || {};
    const lines = (order.lines || []).map((l) => esc(l.name) + ' × ' + l.qty + ' — ' + money(l.qty * l.unitPrice, sym)).join('<br>');
    return Object.assign({ subject: 'New online order ' + order.no + ' — ' + (c.name || '') }, layout({ business, title: 'New order from your online shop',
      intro: esc(c.name || 'A customer') + ' sent order <b>' + esc(order.no) + '</b>. Check the prices, then send them the total to pay.<br><br>' + lines,
      rows: [['Customer', c.name], ['Phone', c.phone], ['Items at shop prices', money(order.subtotal, sym)], ['Delivery', d.mode && d.mode !== 'pickup' ? [d.destination, d.agency].filter(Boolean).join(' · ') || d.mode : 'Pickup at the shop'], ['Note', order.note]],
      button: { label: 'Open online orders', url: url + '/#orders' } }));
  },
  debtReminder({ business, name, text, balance, due, phone }) {
    return Object.assign({ subject: 'Payment reminder from ' + business }, layout({ business, title: 'A friendly reminder',
      intro: esc(text).replace(/\n/g, '<br>'), rows: [['Amount due', balance], ['Due date', due]],
      footnote: 'Sent by ' + esc(business) + (phone ? ' · ' + esc(phone) : '') + ', through Kargo.' }));
  },
  receipt({ business, sale, totals, sym, phone, address, footer }) {
    const lines = (sale.lines || []).map((l) => [l.name + ' × ' + l.qty, money(l.qty * l.unitPrice, sym)]);
    const pays = (sale.payments || []).filter((p) => Number(p.amount) > 0).map((p) => [(p.method || 'Cash') + (p.date ? ' · ' + p.date : ''), money(p.amount, sym)]);
    return Object.assign({ subject: 'Your receipt ' + sale.no + ' from ' + business }, layout({ business, title: 'Receipt ' + sale.no,
      intro: 'Thank you' + (sale.customerName ? ', ' + esc(sale.customerName) : '') + '! Here is your receipt from ' + esc(business) + '.',
      rows: [['Date', sale.date], ...lines, totals.discount ? ['Discount', '−' + money(totals.discount, sym)] : null, totals.deliveryFee ? ['Delivery', money(totals.deliveryFee, sym)] : null, ['Total', money(totals.due, sym)], ...pays, ['Balance', totals.balance > 0.5 ? money(totals.balance, sym) : 'Paid in full']],
      outro: esc(footer || ''), footnote: esc(business) + (address ? ' · ' + esc(address) : '') + (phone ? ' · ' + esc(phone) : '') }));
  },
  trialEnding({ name, business, daysLeft, url }) {
    return Object.assign({ subject: daysLeft > 0 ? 'Your Kargo trial ends in ' + daysLeft + ' days' : 'Your Kargo trial ends today' }, layout({ business, title: daysLeft > 0 ? 'Your free trial ends in ' + daysLeft + ' days' : 'Your free trial ends today',
      intro: 'Hello ' + esc(name) + ',<br>' + esc(business) + ' has been using Kargo on a free trial. To keep recording purchases and sales after it ends, choose a plan. Your data stays safe and you can always view and export it.',
      button: { label: 'Open Kargo', url } }));
  },
};

module.exports = { sendEmail, enabled, isEmail, emailOf, appUrl, T, FROM };
