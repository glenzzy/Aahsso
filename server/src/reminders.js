/* Automatic payment reminders to customers who owe money.
 * Provider is chosen by env REMINDER_PROVIDER:
 *   console (default, logs only) | whatsapp (Meta WhatsApp Cloud API) | twilio (SMS/WhatsApp via Twilio) | http (any SMS gateway taking JSON)
 * Each business turns it on in Settings (settings.autoReminders) and picks the hour (settings.reminderHour, local time). */
const { q, pool } = require('./db');
const KC = require('../public/compute.js');
const mailer = require('./mailer');

const providerName = () => (process.env.REMINDER_PROVIDER || 'console').toLowerCase();
const intl = (p) => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 9 && d[0] === '6') d = '237' + d; return d; }; // Cameroon local → international
const fmtF = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' FCFA';

async function send(to, text, vars) {
  const p = providerName(); const num = intl(to);
  if (!num) throw new Error('no phone number');
  if (p === 'console') { console.log('[reminder:console] to', num, '—', text); return { channel: 'log' }; }
  if (p === 'whatsapp') {
    const body = process.env.WHATSAPP_TEMPLATE
      ? { messaging_product: 'whatsapp', to: num, type: 'template', template: { name: process.env.WHATSAPP_TEMPLATE, language: { code: process.env.WHATSAPP_LANG || 'en' }, components: [{ type: 'body', parameters: [vars.name, vars.balance, vars.due].map((t) => ({ type: 'text', text: String(t) })) }] } }
      : { messaging_product: 'whatsapp', to: num, type: 'text', text: { body: text } }; // free text only works inside the 24h customer window
    const r = await fetch('https://graph.facebook.com/v20.0/' + process.env.WHATSAPP_PHONE_ID + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.WHATSAPP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('WhatsApp API ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return { channel: 'whatsapp' };
  }
  if (p === 'twilio') {
    const sid = process.env.TWILIO_SID, from = process.env.TWILIO_FROM; // e.g. +1555… or whatsapp:+1555…
    const to2 = from.startsWith('whatsapp:') ? 'whatsapp:+' + num : '+' + num;
    const r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + process.env.TWILIO_TOKEN).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ To: to2, From: from, Body: text }) });
    if (!r.ok) throw new Error('Twilio ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return { channel: from.startsWith('whatsapp:') ? 'whatsapp' : 'sms' };
  }
  if (p === 'http') {
    const headers = { 'Content-Type': 'application/json' }; if (process.env.SMS_HTTP_AUTH) headers.Authorization = process.env.SMS_HTTP_AUTH;
    const r = await fetch(process.env.SMS_HTTP_URL, { method: 'POST', headers, body: JSON.stringify({ to: '+' + num, message: text, sender: process.env.SMS_SENDER || undefined }) });
    if (!r.ok) throw new Error('SMS gateway ' + r.status);
    return { channel: 'sms' };
  }
  throw new Error('Unknown REMINDER_PROVIDER ' + p);
}

async function loadTenant(tid) {
  const r = await q("SELECT collection, id, data FROM documents WHERE tenant_id=$1 AND collection IN ('settings','products','lots','shipments','sales','adjustments','transfers','customers','reminders')", [tid]);
  const raw = { settings: {}, products: [], lots: [], shipments: [], sales: [], adjustments: [], transfers: [], customers: [], reminders: [] };
  r.rows.forEach((x) => { const d = Object.assign({}, x.data, { id: x.id }); if (x.collection === 'settings') { if (x.id === 'main') raw.settings = d; } else raw[x.collection].push(d); });
  return raw;
}
const today = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Africa/Douala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Find who needs a reminder and send it. Logs every attempt as a `reminders` document. */
async function runForTenant(tid, opts = {}) {
  const raw = await loadTenant(tid); const C = KC.computeAll(raw); const S = C.S;
  const t = today(S.timezone); const every = KC.num(S.reminderEvery) || 7;
  const owing = {};
  raw.sales.forEach((s) => { const x = C.saleX[s.id]; if (!s.customerId || x.status === 'cancelled' || x.balance <= 0) return; const o = (owing[s.customerId] = owing[s.customerId] || { balance: 0, due: null, nos: [] }); o.balance += x.balance; o.nos.push(s.no); const d = KC.dueDateOf(s, S); if (!o.due || d < o.due) o.due = d; });
  const momo = (S.momoAccounts || []).map((a) => a.method + ' ' + a.number).join(', ') || S.phone || '';
  const items = [];
  for (const [cid, o] of Object.entries(owing)) {
    const c = raw.customers.find((x) => x.id === cid); if (!c || c.noReminders) continue;
    const daysToDue = KC.daysBetween(t, o.due);
    if (daysToDue > 2) continue; // not due yet
    const last = raw.reminders.filter((r) => r.customerId === cid && r.status !== 'failed').sort((a, b) => (b.at || '').localeCompare(a.at || ''))[0];
    if (last && KC.daysBetween(String(last.at).slice(0, 10), t) < every) continue;
    const vars = { name: c.name, balance: fmtF(o.balance), due: o.due, business: S.businessName, momo, receipts: o.nos.join(', ') };
    const text = String(S.reminderTemplate || KC.DEFAULT_SETTINGS.reminderTemplate).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    const item = { customerId: cid, name: c.name, phone: c.whatsapp || c.phone, balance: Math.round(o.balance), due: o.due, text };
    if (!opts.dryRun) {
      let status = 'sent', error = '', channel = providerName();
      try { channel = (await send(item.phone, text, vars)).channel; } catch (e) { status = 'failed'; error = e.message; }
      // customers with an email address also get it by email (it counts as sent if either works)
      const to = mailer.isEmail(c.email) ? c.email : null;
      if (to) {
        const m = await mailer.sendEmail(Object.assign({ to, kind: 'debt_reminder', tenantId: tid, dedupe: 'reminder:' + tid + ':' + cid + ':' + t }, mailer.T.debtReminder({ business: S.businessName, name: c.name, text, balance: vars.balance, due: o.due, phone: S.phone })));
        if (m.status === 'sent' || m.status === 'skipped' || m.status === 'duplicate') { channel = status === 'sent' ? channel + '+email' : 'email'; status = 'sent'; error = ''; item.email = to; }
        else if (status === 'failed') error += ' · email: ' + m.error;
      }
      const doc = { customerId: cid, channel, balance: item.balance, at: new Date().toISOString(), by: opts.by ? opts.by + ' (auto)' : 'Automatic', auto: true, status, error };
      const id = 'rm_auto_' + t + '_' + cid.replace(/[^A-Za-z0-9_\-]/g, '');
      await q(`INSERT INTO documents(tenant_id,collection,id,data) VALUES ($1,'reminders',$2,$3) ON CONFLICT (tenant_id,collection,id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [tid, id, JSON.stringify(doc)]);
      Object.assign(item, { status, error, channel });
    }
    items.push(item);
  }
  return { provider: providerName(), dryRun: !!opts.dryRun, date: t, count: items.length, sent: items.filter((i) => i.status === 'sent').length, failed: items.filter((i) => i.status === 'failed').length, items };
}

/** Send today's reminders for every business that has them switched on — once per day per business.
 *  anyHour=false (long-running server, every 15 min): only at the business's chosen hour (default 9:00 local).
 *  anyHour=true  (Vercel daily cron): whenever it runs; reminder_runs still stops a second send the same day. */
async function runDue({ anyHour = false } = {}) {
  const done = [];
  const rows = (await q("SELECT d.tenant_id, d.data FROM documents d JOIN tenants t ON t.id=d.tenant_id WHERE d.collection='settings' AND d.id='main' AND (d.data->>'autoReminders')::boolean IS TRUE AND t.status <> 'suspended'")).rows;
  for (const r of rows) {
    const tz = r.data.timezone || 'Africa/Douala'; const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()));
    if (!anyHour && hour !== Number(r.data.reminderHour ?? 9)) continue;
    const d = today(tz);
    const ins = await q('INSERT INTO reminder_runs(tenant_id, run_date) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING tenant_id', [r.tenant_id, d]);
    if (!ins.rowCount) continue; // already ran today (also safe with several servers)
    const out = await runForTenant(r.tenant_id, {});
    await q('UPDATE reminder_runs SET sent=$1 WHERE tenant_id=$2 AND run_date=$3', [out.sent, r.tenant_id, d]);
    console.log('[reminders]', r.tenant_id, out.sent, 'sent,', out.failed, 'failed');
    done.push({ tenant: r.tenant_id, sent: out.sent, failed: out.failed });
  }
  return done;
}

/** Long-running server only (Docker / node src/index.js). On Vercel the daily cron calls runDue instead. */
function startScheduler() {
  if (process.env.REMINDERS_DISABLED === 'true') return;
  const tick = () => runDue().catch((e) => console.error('[reminders] scheduler error', e.message));
  setInterval(tick, 15 * 60 * 1000); setTimeout(tick, 20000);
}

module.exports = { runForTenant, runDue, startScheduler, providerName, send };
