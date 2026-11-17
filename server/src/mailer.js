/* Emails through Resend (https://resend.com) — plain HTTPS, no extra package.
 *   RESEND_API_KEY   your Resend API key (re_…). Without it emails are not sent: they are logged as "skipped".
 *   EMAIL_FROM       sender, on a domain verified in Resend, e.g. "Aahsso <no-reply@mail.yourshop.com>"
 *   EMAIL_REPLY_TO   optional reply-to address
 *   APP_URL          public address of the app, used in links (e.g. https://aahsso.yourshop.com)
 *   RESEND_API_URL   only for tests (defaults to https://api.resend.com)
 * Every attempt is written to email_log. A `dedupe` key makes automatic emails go out only once. */
const { q } = require('./db');

const API = () => (process.env.RESEND_API_URL || 'https://api.resend.com').replace(/\/$/, '');
const enabled = () => !!process.env.RESEND_API_KEY;
const FROM = () => process.env.EMAIL_FROM || 'Aahsso <onboarding@resend.dev>';
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
    '<tr><td style="padding:22px 28px 0"><span style="display:inline-block;width:34px;height:34px;border-radius:9px;background:#e8a33d;color:#14202e;font-weight:800;text-align:center;line-height:34px;font-size:16px">A</span>' +
      '<span style="font-weight:700;font-size:15px;margin-left:10px;vertical-align:middle">' + esc(business || 'Aahsso') + '</span></td></tr>' +
    '<tr><td style="padding:18px 28px 6px"><h1 style="margin:0 0 10px;font-size:21px;line-height:1.3">' + esc(title) + '</h1>' +
      (intro ? '<p style="margin:0 0 6px;font-size:15px;line-height:1.55;color:#33404d">' + intro + '</p>' : '') + '</td></tr>' +
    (kv ? '<tr><td style="padding:6px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #efede8;border-bottom:1px solid #efede8">' + kv + '</table></td></tr>' : '') +
    (button ? '<tr><td style="padding:18px 28px 4px"><a href="' + esc(button.url) + '" style="display:inline-block;background:#0d5c63;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px">' + esc(button.label) + '</a></td></tr>' : '') +
    (outro ? '<tr><td style="padding:14px 28px 4px"><p style="margin:0;font-size:14px;line-height:1.55;color:#4a5868">' + outro + '</p></td></tr>' : '') +
    '<tr><td style="padding:20px 28px 24px"><p style="margin:0;font-size:12px;color:#8793a1;line-height:1.5">' + (footnote || 'Sent by Aahsso for ' + esc(business || 'your business') + '.') + '</p></td></tr>' +
    '</table></td></tr></table></body></html>';
  const strip = (s) => String(s || '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [title, '', strip(intro), '', ...(rows || []).filter((r) => r && r[1]).map(([k, v]) => k + ': ' + v), button ? '\n' + button.label + ': ' + button.url : '', outro ? '\n' + strip(outro) : '', '', strip(footnote || 'Sent by Aahsso for ' + (business || 'your business') + '.')].join('\n').replace(/\n{3,}/g, '\n\n');
  return { html, text };
}
const payRows = (p) => { p = p || {}; return [['MTN MoMo', p.momoNumber ? p.momoNumber + (p.momoName ? ' (' + p.momoName + ')' : '') : ''], ['Orange Money', p.omNumber ? p.omNumber + (p.omName ? ' (' + p.omName + ')' : '') : ''], ['Bank', p.bank || ''], ['Note', p.note || '']]; };
const ROLE_NAMES = { owner: 'Owner', admin: 'Admin', manager: 'Manager', sales: 'Sales', viewer: 'Viewer' };
const T = {
  /** New team member, or a password reset by the owner / an admin: their login and password. */
  staffAccount({ name, business, login, password, role, url, by, reset }) {
    const subject = reset ? 'Your new password for ' + business : 'Your ' + business + ' account on Aahsso';
    return Object.assign({ subject }, layout({ business, title: reset ? 'Your password was reset' : 'Welcome to ' + business,
      intro: 'Hello ' + esc(name) + ',<br>' + (reset ? esc(by || 'Your manager') + ' set a new password for your account.' : esc(by || 'The owner') + ' created an account for you on Aahsso, the app ' + esc(business) + ' uses for stock and sales.'),
      rows: [['Sign in at', url], ['Login', login, true], [reset ? 'New password' : 'Password', password, true], reset ? null : ['Role', ROLE_NAMES[role] || role]],
      button: { label: 'Sign in to Aahsso', url }, outro: 'Please change this password after you sign in: <b>Settings → Account</b>. Keep it to yourself.',
      footnote: 'You get this email because ' + esc(business) + ' added you to their team. If this is a mistake, you can ignore it.' }));
  },
  welcomeOwner({ name, business, login, trialEnds, url }) {
    return Object.assign({ subject: 'Welcome to Aahsso, ' + name }, layout({ business, title: business + ' is ready',
      intro: 'Hello ' + esc(name) + ',<br>your business is set up on Aahsso. Your goods follow four steps: <b>Buy → Ship → Receive → Sell</b>.',
      rows: [['Sign in at', url], ['Login', login, true], ['Free trial until', trialEnds]],
      button: { label: 'Open Aahsso', url },
      outro: 'Next: add your logo and MoMo numbers in Settings, record your first purchase, then add your team — each person gets their login by email.' }));
  },
  passwordReset({ name, url, minutes }) {
    return Object.assign({ subject: 'Reset your Aahsso password' }, layout({ business: 'Aahsso', title: 'Reset your password',
      intro: 'Hello ' + esc(name) + ',<br>we got a request to reset the password of your Aahsso account. The link works once, for ' + minutes + ' minutes.',
      button: { label: 'Choose a new password', url },
      outro: 'If you did not ask for this, ignore this email — your password stays the same.', footnote: 'Aahsso account security.' }));
  },
  invoiceIssued({ name, business, number, plan, amount, due, period, pay, url }) {
    return Object.assign({ subject: 'Aahsso invoice ' + number + ' — ' + amount }, layout({ business, title: 'Your Aahsso invoice ' + number,
      intro: 'Hello ' + esc(name) + ',<br>here is the invoice for your Aahsso subscription.',
      rows: [['Plan', plan], ['Period', period], ['Amount', amount, true], ['Pay by', due], ...payRows(pay)],
      button: { label: 'View and pay', url },
      outro: 'After paying, open Billing & subscription in Aahsso and tap <b>I have paid</b> with the transaction reference.' }));
  },
  invoiceReminder({ name, business, number, amount, due, days, pay, url }) {
    const when = days > 0 ? 'is due in ' + days + ' days (' + due + ')' : days === 0 ? 'is due today' : 'was due on ' + due;
    return Object.assign({ subject: 'Reminder: Aahsso invoice ' + number + ' ' + when.split(' (')[0] }, layout({ business, title: 'Invoice ' + number + ' ' + when,
      intro: 'Hello ' + esc(name) + ',<br>this is a reminder about your Aahsso subscription.' + (days < 0 ? ' Recording new sales and stock pauses when the grace period ends; your data stays safe and can always be exported.' : ''),
      rows: [['Amount', amount, true], ['Due', due], ...payRows(pay)], button: { label: 'Pay now', url } }));
  },
  subscriptionEnded({ name, business, trial, url }) {
    return Object.assign({ subject: trial ? 'Your Aahsso free trial has ended' : 'Your Aahsso subscription has ended' }, layout({ business, title: trial ? 'Your free trial has ended' : 'Your subscription has ended',
      intro: 'Hello ' + esc(name) + ',<br>' + esc(business) + ' can still open Aahsso and export all its data, but recording new sales and stock is paused.',
      button: { label: 'Choose a plan', url }, outro: 'Your records are kept safe. Pay any time to continue where you left off.' }));
  },
  paymentReceived({ name, business, number, amount, until, url }) {
    return Object.assign({ subject: 'Payment received — thank you (' + number + ')' }, layout({ business, title: 'Payment received — thank you',
      intro: 'Hello ' + esc(name) + ',<br>we received your payment for invoice ' + esc(number) + '.',
      rows: [['Amount', amount, true], ['Subscription active until', until]], button: { label: 'Open Aahsso', url } }));
  },
  paymentClaim({ business, by, number, amount, method, reference, paidOn }) {
    return Object.assign({ subject: '[Aahsso admin] Payment to check — ' + business + ' · ' + amount }, layout({ business: 'Aahsso admin', title: 'A business reported a payment',
      intro: esc(by) + ' from <b>' + esc(business) + '</b> says they paid. Check your ' + esc(method) + ' account, then confirm or reject it in the admin dashboard.',
      rows: [['Invoice', number], ['Amount', amount, true], ['Method', method], ['Reference', reference, true], ['Paid on', paidOn]], footnote: 'Aahsso platform alert.' }));
  },
  adminLogin({ name, when, ip, agent, fresh }) {
    return Object.assign({ subject: (fresh ? 'New device: ' : '') + 'Sign-in to Aahsso admin' }, layout({ business: 'Aahsso admin', title: fresh ? 'Sign-in from a new device' : 'New sign-in to Aahsso admin',
      intro: 'Hello ' + esc(name) + ',<br>your admin account was just used to sign in.', rows: [['When', when], ['IP address', ip], ['Device', agent]],
      outro: 'If this was not you, end all sessions from Security in the admin dashboard and change your password at once — or ask another owner to disable your account.', footnote: 'Aahsso admin security.' }));
  },
  adminInvite({ name, email, role, password, url, by }) {
    return Object.assign({ subject: 'Your Aahsso admin account' }, layout({ business: 'Aahsso admin', title: 'You have an Aahsso admin account',
      intro: 'Hello ' + esc(name) + ',<br>' + esc(by) + ' created an Aahsso platform admin account for you.',
      rows: [['Sign in at', url], ['Email', email], ['Temporary password', password, true], ['Role', role]],
      button: { label: 'Sign in', url },
      outro: 'You will choose your own password the first time you sign in. Never share this account.', footnote: 'Aahsso admin security.' }));
  },
  adminLocked({ name, email, ip, minutes }) {
    return Object.assign({ subject: '[Aahsso admin] Account locked after failed sign-ins' }, layout({ business: 'Aahsso admin', title: 'Admin account locked',
      intro: 'Too many wrong passwords or codes for <b>' + esc(email) + '</b> (' + esc(name) + '). The account is locked for ' + minutes + ' minutes.', rows: [['Last attempt from', ip]], footnote: 'Aahsso admin security.' }));
  },
  supportReply({ name, topic, body, by }) {
    return Object.assign({ subject: 'Re: ' + topic + ' — Aahsso support' }, layout({ business: 'Aahsso support', title: 'Re: ' + topic,
      intro: 'Hello ' + esc(name) + ',<br><br>' + esc(body).replace(/\n/g, '<br>'), footnote: 'Answered by ' + esc(by) + ' from Aahsso support. Reply to this email or use Help & support in the app.' }));
  },
  support({ business, from, login, email, role, plan, topic, message, page, tenantId }) {
    return Object.assign({ subject: '[Aahsso support] ' + topic + ' — ' + business }, layout({ business: 'Aahsso support', title: topic,
      intro: esc(message).replace(/\n/g, '<br>'),
      rows: [['Business', business], ['From', from], ['Login', login], ['Email', email], ['Role', role], ['Plan', plan], ['Screen', page], ['Business id', tenantId]],
      footnote: 'Sent from the Help & Support page. Reply to this email to answer ' + esc(from) + '.' }));
  },
  passwordChanged({ name, business, url, when }) {
    return Object.assign({ subject: 'Your Aahsso password was changed' }, layout({ business, title: 'Your password was changed',
      intro: 'Hello ' + esc(name) + ',<br>the password of your Aahsso account was changed on ' + esc(when) + '.',
      outro: 'If this was not you, ask the owner of ' + esc(business) + ' to reset your password straight away, or use “Forgot password” at <a href="' + esc(url) + '">' + esc(url) + '</a>.',
      footnote: 'Aahsso account security.' }));
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
      footnote: 'Sent by ' + esc(business) + (phone ? ' · ' + esc(phone) : '') + ', through Aahsso.' }));
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
    return Object.assign({ subject: daysLeft > 0 ? 'Your Aahsso trial ends in ' + daysLeft + ' days' : 'Your Aahsso trial ends today' }, layout({ business, title: daysLeft > 0 ? 'Your free trial ends in ' + daysLeft + ' days' : 'Your free trial ends today',
      intro: 'Hello ' + esc(name) + ',<br>' + esc(business) + ' has been using Aahsso on a free trial. To keep recording purchases and sales after it ends, choose a plan. Your data stays safe and you can always view and export it.',
      button: { label: 'Open Aahsso', url } }));
  },
};

module.exports = { sendEmail, enabled, isEmail, emailOf, appUrl, T, FROM };
