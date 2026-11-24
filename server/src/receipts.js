// Reads receipts and invoices (photos or PDFs) with Claude and returns their lines in the purchase-import shape.
// The app turns the result into the same rows as the Excel receipt template, so the purchase screen, the
// "one purchase per receipt" queue, Brand / Model, tax per line and ⚠ Check all work the same way.
//
// Settings (environment):
//   ANTHROPIC_API_KEY        required — without it scanning is "not set up" (503)
//   RECEIPT_MODEL            default claude-opus-5-5
//   RECEIPT_EFFORT           default low (reading, not reasoning: faster and cheaper)
//   ANTHROPIC_BASE_URL       optional (tests point it at a local mock)
//
// Testing through OpenRouter before having an Anthropic key (receipts then go to OpenRouter as well as Anthropic):
//   ANTHROPIC_BASE_URL=https://openrouter.ai/api   ANTHROPIC_AUTH_TOKEN=<OpenRouter key>   (leave ANTHROPIC_API_KEY empty)
//   RECEIPT_MODEL=anthropic/claude-opus-5.5        — the model name defaults to this when the address is OpenRouter
//
// Cheap testing: RECEIPT_MODEL=anthropic/claude-haiku-5.5 (or claude-haiku-5-5 direct) costs ~40× less than Opus 5.5.
//   RECEIPT_MAX_TOKENS caps the answer (default: 6000 for one file, +2000 per extra file, at most 16000). OpenRouter holds
//   back credit for the whole cap before reading, so a low balance needs a lower cap or a cheaper model.
const Anthropic = require('@anthropic-ai/sdk');

const VIA_OPENROUTER = /openrouter\.ai/i.test(process.env.ANTHROPIC_BASE_URL || '') || process.env.RECEIPT_PROVIDER === 'openrouter';
const MODEL = process.env.RECEIPT_MODEL || (VIA_OPENROUTER ? 'anthropic/claude-opus-5.5' : 'claude-opus-5-5');
const EFFORT = process.env.RECEIPT_EFFORT || 'low';
const IS_DEFAULT_MODEL = !process.env.RECEIPT_MODEL; // the refusal fallback only for the default (Opus): a cheap test model must not fall back to a 40× dearer one
/* room for the answer: a receipt of ~40 lines is ~3000 tokens of JSON plus a little thinking at low effort */
const maxTokensFor = (files) => Math.min(Number(process.env.RECEIPT_MAX_TOKENS) || 16000, 6000 + 2000 * (files - 1), 16000);
const MAX_FILES = 8; // several photos of one long receipt, or a few receipts at once
const MAX_BYTES = 4 * 1024 * 1024; // all files together (the hosting platform takes ~4.5 MB per request)
const DEADLINE_MS = Number(process.env.RECEIPT_DEADLINE_MS || 55e3); // the hosting platform stops a request at 60 s

let client = null;
const configured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const api = () => client || (client = new Anthropic({ timeout: DEADLINE_MS, maxRetries: 2 }));

/* the file types we accept, by their first bytes (not by name or the type the browser claims) */
function sniff(buf) {
  if (buf.length > 4 && buf.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return 'image/gif';
  return null;
}

/** [{data: base64}] → content blocks; throws {status, message} for anything we do not take */
function blocksOf(files) {
  if (!Array.isArray(files) || !files.length) throw Object.assign(new Error('Add a photo or PDF of the receipt'), { status: 400 });
  if (files.length > MAX_FILES) throw Object.assign(new Error('At most ' + MAX_FILES + ' files at a time'), { status: 400 });
  let total = 0;
  return files.map((f, i) => {
    const b64 = String((f && f.data) || '').replace(/^data:[^,]*,/, '');
    const buf = Buffer.from(b64, 'base64'); total += buf.length;
    if (!buf.length) throw Object.assign(new Error('File ' + (i + 1) + ' is empty'), { status: 400 });
    if (total > MAX_BYTES) throw Object.assign(new Error('The files are too large together — at most 4 MB. Take the photos again or send fewer pages.'), { status: 413 });
    const type = sniff(buf);
    if (!type) throw Object.assign(new Error('File ' + (i + 1) + ' is not a photo (JPG, PNG, WEBP) or a PDF'), { status: 415 });
    return type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: type, data: buf.toString('base64') } }
      : { type: 'image', source: { type: 'base64', media_type: type, data: buf.toString('base64') } };
  });
}

/* what Claude returns: one entry per receipt or invoice; numbers are null when they cannot be read */
const NUM = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const STR = { type: 'string' };
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['receipts', 'unreadable'],
  properties: {
    unreadable: { type: 'string', description: 'Empty when the files show a receipt or invoice. Otherwise one short sentence saying why nothing could be read (not a receipt, too blurry, cut off…).' },
    receipts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['seller', 'date', 'receiptNo', 'currency', 'lines', 'subtotal', 'tax', 'total', 'checks'],
        properties: {
          seller: STR, date: { type: 'string', description: 'YYYY-MM-DD, or empty' }, receiptNo: STR,
          currency: { type: 'string', description: 'ISO code: XAF for FCFA / CFA, USD for $, EUR for €… Empty if not shown.' },
          subtotal: NUM, tax: NUM, total: NUM,
          checks: { type: 'array', items: STR, description: 'Problems with the receipt as a whole (e.g. a page seems missing).' },
          lines: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              required: ['description', 'brand', 'model', 'category', 'quantity', 'unit', 'unitPrice', 'lineTotal', 'taxPct', 'taxAmount', 'checks'],
              properties: {
                description: STR, brand: STR, model: STR,
                category: { type: 'string', description: 'One of the business categories given, or empty' },
                quantity: NUM, unit: { type: 'string', description: 'piece, pack, box, bottle, carton, kg, litre… or empty' },
                unitPrice: NUM, lineTotal: NUM, taxPct: NUM, taxAmount: NUM,
                checks: {
                  type: 'array',
                  items: { type: 'object', additionalProperties: false, required: ['field', 'reason'], properties: { field: STR, reason: STR } },
                  description: 'Each value you are not sure of: field (Description, Brand, Model, Qty, Price, Total, Tax…) and why.',
                },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You read photos and PDFs of purchase receipts and supplier invoices for a business in Cameroon, so its purchases can be entered without typing. Receipts may be in French or English, printed, thermal (faded) or handwritten, and prices are often in FCFA (XAF) with spaces or dots between thousands ("1 500", "12.500" mean 1500 and 12500).

Rules:
- One entry in "receipts" per receipt or invoice. Several photos or pages of the same receipt are one entry.
- One line per item bought. Skip totals, payment lines, change given, loyalty points and adverts.
- Never guess. A value you cannot read is null (numbers) or empty (text), with an entry in that line's "checks" saying which field and why. Also add a check when you read a value but are not sure of it.
- quantity, unitPrice, lineTotal: as printed. lineTotal is quantity × unit price before tax. If only one of unitPrice / lineTotal is printed, give that one and leave the other null.
- taxPct / taxAmount: only when the receipt shows tax for that line (or one rate for the whole receipt, e.g. TVA 19.25 %). Otherwise null.
- description: the item as a person would name it, expanding obvious abbreviations; keep sizes ("65cl", "5L", "25kg"). If you expanded a cryptic abbreviation, add a check.
- brand and model: only when they are clear from the receipt.
- category: pick from the business categories given, or leave empty.
- date as YYYY-MM-DD (receipts in Cameroon write day/month/year).
- If the files are not a receipt or invoice, or nothing can be read, return no receipts and say why in "unreadable".`;

/** the receipts in the files: {receipts, unreadable, usage} — or throws {status, message} */
async function readReceipts(files, { categories = [], currency = '' } = {}) {
  if (!configured()) throw Object.assign(new Error('Receipt scanning is not set up yet — please contact support'), { status: 503 });
  const blocks = blocksOf(files);
  const hint = 'Business categories: ' + (categories.filter((c) => typeof c === 'string').slice(0, 80).map((c) => c.slice(0, 60)).join(', ') || '(none)') +
    '\nThe business usually pays in: ' + (String(currency).slice(0, 8) || 'XAF') + '\n\nRead the receipt(s) in these files.';
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), DEADLINE_MS);
  let r;
  try {
    const body = {
      model: MODEL, max_tokens: maxTokensFor(blocks.length), system: SYSTEM,
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: blocks.concat([{ type: 'text', text: hint }]) }],
    };
    r = VIA_OPENROUTER
      // OpenRouter: its own fallback list, and the schema repeated in the prompt in case the format is not enforced there
      ? await api().messages.create(Object.assign(body, IS_DEFAULT_MODEL ? { fallbacks: [{ model: 'anthropic/claude-opus-5' }] } : {}, {
        system: SYSTEM + '\n\nReply with only a JSON object (no other text) that follows this JSON schema:\n' + JSON.stringify(SCHEMA),
      }), { signal: ac.signal })
      : await (IS_DEFAULT_MODEL ? api().beta.messages.create(Object.assign(body, {
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', // a false-positive safety decline is retried on another model instead of failing
      }), { signal: ac.signal }) : api().messages.create(body, { signal: ac.signal }));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw Object.assign(new Error('Receipt reading is busy — try again in a minute'), { status: 503, cause: e });
    if (e instanceof Anthropic.BadRequestError) throw Object.assign(new Error('These files could not be read — try a clearer photo or a smaller PDF'), { status: 422, cause: e });
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw Object.assign(new Error('Receipt scanning is not set up correctly — please contact support'), { status: 503, cause: e });
    if (e instanceof Anthropic.APIUserAbortError || e instanceof Anthropic.APIConnectionTimeoutError) throw Object.assign(new Error('Reading took too long — try fewer pages at a time'), { status: 504, cause: e });
    if (e instanceof Anthropic.APIError && e.status === 402) throw Object.assign(new Error('Receipt reading is out of credit — please contact support'), { status: 503, cause: e }); // OpenRouter: balance too low
    if (e instanceof Anthropic.APIError) throw Object.assign(new Error('Receipt reading is not available right now — try again in a moment'), { status: 502, cause: e });
    throw e;
  } finally { clearTimeout(timer); }
  const usage = { model: r.model || MODEL, input: (r.usage && r.usage.input_tokens) || 0, output: (r.usage && r.usage.output_tokens) || 0 };
  if (r.stop_reason === 'refusal') throw Object.assign(new Error('These files could not be read as a receipt'), { status: 422, usage });
  if (r.stop_reason === 'max_tokens') throw Object.assign(new Error('This receipt is too long to read at once — send fewer pages at a time'), { status: 422, usage });
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out; try { out = JSON.parse(text); } catch (e) { out = null; }
  if (!out) try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) { // a reply wrapped in ```json … ``` or a sentence: the object inside it
    throw Object.assign(new Error('The receipt could not be read — try again'), { status: 502, usage }); }
  return { receipts: clean(out.receipts), unreadable: typeof out.unreadable === 'string' ? out.unreadable.slice(0, 300) : '', usage };
}

/* the schema guarantees the shape; this keeps sizes and types sane before the app sees it */
const s = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const n = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
function clean(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map((x) => ({
    seller: s(x.seller), date: /^\d{4}-\d{2}-\d{2}$/.test(s(x.date)) ? s(x.date) : '', receiptNo: s(x.receiptNo, 80), currency: s(x.currency, 8).toUpperCase(),
    subtotal: n(x.subtotal), tax: n(x.tax), total: n(x.total), checks: (Array.isArray(x.checks) ? x.checks : []).map((c) => s(c, 200)).filter(Boolean).slice(0, 10),
    lines: (Array.isArray(x.lines) ? x.lines : []).slice(0, 300).map((l) => ({
      description: s(l.description), brand: s(l.brand, 80), model: s(l.model, 80), category: s(l.category, 80), unit: s(l.unit, 30),
      quantity: n(l.quantity), unitPrice: n(l.unitPrice), lineTotal: n(l.lineTotal), taxPct: n(l.taxPct), taxAmount: n(l.taxAmount),
      checks: (Array.isArray(l.checks) ? l.checks : []).map((c) => ({ field: s(c && c.field, 40), reason: s(c && c.reason, 200) })).filter((c) => c.field || c.reason).slice(0, 10),
    })).filter((l) => l.description),
  })).filter((x) => x.lines.length);
}

module.exports = { readReceipts, configured, sniff, SCHEMA, MODEL, VIA_OPENROUTER, maxTokensFor };
