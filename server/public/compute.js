/* Aahsso — shared business logic (runs in the browser AND on the Node server).
 * Landed-cost allocation, FIFO stock, pricing, sale & report metrics.
 * Pure functions only: no DOM, no network. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const num = (v) => { if (typeof v === 'number') return isFinite(v) ? v : 0; const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
  const roundTo = (v, step) => { step = num(step); return step > 0 ? Math.ceil(v / step) * step : Math.round(v); };

  const CATEGORIES = {
    'Food & Snacks': ['Cereal & Oats', 'Snacks & Chips', 'Nuts & Dried Fruit', 'Canned Food', 'Rice & Pasta', 'Baking', 'Sauces & Spices', 'Candy & Chocolate'],
    'Beverages': ['Water', 'Juice', 'Soda', 'Coffee & Tea', 'Energy Drinks', 'Milk & Dairy', 'Wine & Spirits'],
    'Household': ['Cleaning', 'Paper Products', 'Kitchenware', 'Laundry', 'Storage'],
    'Personal Care': ['Hair Care', 'Skin Care', 'Oral Care', 'Baby Care', 'Vitamins & Supplements', 'Fragrance'],
    'Electronics': ['TV', 'Speakers & Audio', 'Laptops & Computers', 'Phones & Tablets', 'Appliances', 'Gaming', 'Accessories'],
    'Clothing & Shoes': ['Men', 'Women', 'Children', 'Shoes', 'Bags'],
    'Furniture': ['Living Room', 'Bedroom', 'Office', 'Outdoor'],
    'Tools & Hardware': ['Power Tools', 'Hand Tools', 'Auto Parts'],
    'Vehicles': ['Car', 'Motorbike', 'Parts'],
    'Other': ['General'],
  };

  /* Cameroon MoMo withdrawal fee grids (editable in Settings; override with MOMO_FEE_TABLES env on the server).
   * type fixed = flat fee; type pct = pct% of amount + optional taxPct% + taxFixed.
   * Source defaults: MTN Cameroon public withdrawal tariffs (USSD / MoMo App). */
  const DEFAULT_MOMO_FEE_TABLES = {
    'MTN MoMo': [
      { min: 100, max: 4166, type: 'fixed', fee: 54 },
      { min: 4167, max: 333332, type: 'pct', pct: 1, taxPct: 0.2, taxFixed: 4 },
      { min: 333333, max: 500000, type: 'fixed', fee: 4004 },
    ],
    'Orange Money': [
      { min: 100, max: 4166, type: 'fixed', fee: 54 },
      { min: 4167, max: 333332, type: 'pct', pct: 1, taxPct: 0.2, taxFixed: 4 },
      { min: 333333, max: 500000, type: 'fixed', fee: 4004 },
    ],
  };

  const DEFAULT_SETTINGS = {
    approvals: { discountPct: null, refundAbove: null, cancel: false }, // when even staff allowed to do it need a manager's PIN (Settings → Approvals)
    businessName: 'My Business', tagline: '', phone: '', whatsapp: '', address: 'Douala, Cameroon', logo: '',
    fxRate: 600, currency: 'XAF', currencySymbol: 'FCFA', fxRates: { USD: 600, EUR: 655.957 }, defaultMarkup: 100, minMarkup: 50, roundTo: 50, lowStock: 3, expiryWarnDays: 60,
    staffSeeCosts: false, wholesaleMarkup: 60, bulkQty: 0, creditDays: 14,
    reminderTemplate: 'Hello {name}, this is a friendly reminder from {business}. Your balance is {balance} (due {due}). You can pay by Cash or Mobile Money: {momo}. Thank you!',
    reminderEvery: 7, receiptFooter: 'Thank you for your business! Goods sold in good condition.',
    momoAccounts: [], // [{label, method, number}]
    momoFeeTables: DEFAULT_MOMO_FEE_TABLES, // suggested withdrawal charges for MTN / Orange
    categories: CATEGORIES,
    vendors: ['Costco', 'Walmart', "Sam's Club", 'B-Stock', 'Target', 'Amazon', 'BJ\'s'],
  };

  /* Who we buy from. 'Private seller' is the old name for 'Individual' (kept so old purchases still read). */
  const SOURCE_TYPES = ['Store', 'Black market', 'Individual', 'Online', 'Auction', 'Local (Cameroon)'];
  /** Share a purchase's tax over its lines by line value (qty × price). Returns tax per line, in the purchase
   *  currency, rounded to cents; the last line takes the rounding remainder so the shares add up exactly. */
  /** Symbol shown after local amounts. Old accounts saved the bare 'F' for CFA francs: show FCFA instead. */
  function currencySymbolOf(S) {
    S = S || {}; const code = S.currency || 'XAF'; const sym = String(S.currencySymbol || '').trim();
    if (!sym || sym === 'F') return code === 'XAF' ? 'FCFA' : code === 'XOF' ? 'CFA' : (sym || code);
    return sym;
  }
  /** Selling prices of one item: fixed prices win, otherwise landed cost + markup (rounded up to S.roundTo). */
  function sellingPrices(p, avgCost, S) {
    S = S || {}; const has = (v) => v !== undefined && v !== null && v !== '';
    const markup = has(p.markup) ? num(p.markup) : num(S.defaultMarkup);
    const mn = has(p.minMarkup) ? num(p.minMarkup) : num(S.minMarkup);
    const wm = has(p.wholesaleMarkup) ? num(p.wholesaleMarkup) : num(S.wholesaleMarkup);
    const max = num(p.priceMax) > 0 ? num(p.priceMax) : roundTo(avgCost * (1 + markup / 100), S.roundTo);
    const min = num(p.priceMin) > 0 ? num(p.priceMin) : Math.min(max, roundTo(avgCost * (1 + mn / 100), S.roundTo));
    const ws = num(p.priceWholesale) > 0 ? num(p.priceWholesale) : Math.min(max, roundTo(avgCost * (1 + wm / 100), S.roundTo));
    return { max, min, ws, markup };
  }
  /* ---------- promotions: % off, amount off or a promo price, on all items, a category or chosen items ---------- */
  const PROMO_TYPES = [['pct', '% off'], ['amount', 'Amount off'], ['price', 'Promo price']];
  const localDay = (d) => { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  function promoStatus(pr, day) {
    day = day || localDay(); if (!pr) return 'ended';
    if (pr.status === 'ended') return 'ended';
    if (pr.start && pr.start > day) return 'scheduled';
    if (pr.end && pr.end < day) return 'ended';
    return 'running';
  }
  const promoActive = (pr, day) => promoStatus(pr, day) === 'running';
  const promoCovers = (pr, p) => !!pr && !!p && (pr.scope === 'all' ? true : pr.scope === 'category' ? (p.category || '') === (pr.category || '') : (pr.productIds || []).includes(p.id));
  /** Promo price for a normal price; never above it; rounded to the nearest S.roundTo. */
  function promoPriceOf(pr, base, S) {
    const v = num(pr && pr.value); base = num(base);
    let x = pr.type === 'pct' ? base * (1 - v / 100) : pr.type === 'amount' ? base - v : v;
    const step = num(S && S.roundTo); x = step > 0 ? Math.round(x / step) * step : Math.round(x);
    return Math.max(0, Math.min(base, x));
  }
  /* Where in the flow an expense belongs: Buy, the Ship steps, the Receive steps, Sell — or day-to-day running costs. */
  const EXPENSE_STAGES = [
    ['general', 'Day-to-day', 'Day-to-day'], ['buy', 'Buy', 'Buy'],
    ['planning', 'Consolidating', 'Ship'], ['loading', 'Loading', 'Ship'], ['in_transit', 'On the way', 'Ship'],
    ['at_port', 'Arrived in Cameroon', 'Receive'], ['cleared', 'Customs cleared', 'Receive'], ['received', 'In warehouse', 'Receive'],
    ['closed', 'Ready to sell', 'Sell'],
  ];
  const EXPENSE_PHASES = ['Buy', 'Ship', 'Receive', 'Sell', 'Day-to-day'];
  /** [key, step label, phase] of an expense (older expenses have no step: day-to-day). */
  const expenseStage = (e) => EXPENSE_STAGES.find((x) => x[0] === (e && e.stage)) || EXPENSE_STAGES[0];
  function allocTax(lines, taxTotal) {
    const t = Math.round(num(taxTotal) * 100) / 100; const vals = (lines || []).map((l) => Math.max(0, num(l.unitCost) * num(l.qty)));
    const sub = vals.reduce((a, v) => a + v, 0); if (!lines || !lines.length || !(t > 0)) return (lines || []).map(() => 0);
    const out = vals.map((v) => Math.round((sub > 0 ? t * v / sub : t / lines.length) * 100) / 100);
    const diff = Math.round((t - out.reduce((a, v) => a + v, 0)) * 100) / 100;
    if (diff) { let k = vals.lastIndexOf(Math.max(...vals)); if (k < 0) k = out.length - 1; out[k] = Math.round((out[k] + diff) * 100) / 100; }
    return out;
  }
  const CONDITIONS = ['New', 'Open box', 'Used', 'Refurbished', 'Damaged / Parts'];
  /** Does the item work? Recorded per line on sales and purchases. */
  const WORKING = ['Working', 'Not working', 'Not tested'];
  /* Payment modes. Local sales in Cameroon: Cash, MTN MoMo, Orange Money only.
   * Purchases (often US stores / USD) may also use bank transfers. PAY_METHODS = every known mode. */
  const SALE_PAY_METHODS = ['Cash', 'MTN MoMo', 'Orange Money'];
  const PURCHASE_PAY_METHODS = ['Cash', 'MTN MoMo', 'Orange Money', 'Bank transfer', 'Credit card', 'Zelle / US bank', 'Other'];
  const PAY_METHODS = PURCHASE_PAY_METHODS;
  const isMobileMoney = (method) => method === 'MTN MoMo' || method === 'Orange Money';
  /** New transaction id, e.g. TX261110-K3F9QZ (sales) or PU261110-… (purchases). */
  function newTxnId(prefix, date) {
    const d = String(date || new Date().toISOString().slice(0, 10)).replace(/-/g, '').slice(2, 8);
    let r = ''; for (let i = 0; i < 6; i++) r += '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 34)];
    return (prefix || 'TX') + d + '-' + r;
  }
  const feeTablesOf = (S) => { const t = S && S.momoFeeTables; return (t && typeof t === 'object' && !Array.isArray(t) && Object.keys(t).length > 0) ? t : DEFAULT_MOMO_FEE_TABLES; };
  /** Suggested operator charge for a MoMo/OM payment of `amount` (sale portion). Cash/bank → 0. */
  function calcMomoFee(method, amount, S) {
    if (!isMobileMoney(method)) return 0;
    const a = Math.abs(num(amount)); if (a <= 0) return 0;
    const tiers = feeTablesOf(S)[method] || [];
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i]; const lo = num(t.min), hi = t.max == null || t.max === '' ? Infinity : num(t.max);
      if (a < lo || a > hi) continue;
      if (t.type === 'pct' || (t.pct != null && t.pct !== '')) {
        let fee = a * num(t.pct) / 100;
        if (t.taxPct != null && t.taxPct !== '') fee += a * num(t.taxPct) / 100;
        if (t.taxFixed != null && t.taxFixed !== '') fee += num(t.taxFixed);
        return Math.round(fee);
      }
      return Math.round(num(t.fee));
    }
    return 0;
  }
  /** Validate a payment. kind 'sale' (default): Cash / MoMo / OM only, receiving number required for MoMo/OM.
   *  kind 'purchase': any purchase mode, number optional. Refunds (amount < 0) may use any known mode
   *  so older records can still be refunded the way they were paid. Returns '' if ok, else an error message. */
  function validatePayment(p, S, kind) {
    if (!p) return 'Missing payment';
    const method = p.method || 'Cash';
    const amount = num(p.amount), fee = num(p.fee);
    const allowed = amount < 0 ? PAY_METHODS : kind === 'purchase' ? PURCHASE_PAY_METHODS : SALE_PAY_METHODS;
    if (allowed.indexOf(method) < 0) return 'Payment mode must be ' + allowed.join(', ');
    if (!isFinite(amount)) return 'Invalid amount';
    if (fee < 0) return 'Charges cannot be negative';
    if (amount === 0 && fee === 0) return 'Enter an amount';
    if (isMobileMoney(method) && amount > 0) {
      if (!String(p.ref || '').trim()) return 'Transaction ID is required for ' + method;
      if (kind !== 'purchase' && !String(p.account || '').trim()) return 'Receiving MoMo number is required for ' + method;
    }
    return '';
  }
  /** Every sale has a transaction id (assigned when the sale is created, never changed).
   *  Older sales without one fall back to their receipt number. */
  function saleTxnId(s) {
    if (!s) return '';
    if (s.txnId) return String(s.txnId);
    return s.no ? 'TX-' + s.no : '';
  }
  /** Same for purchases / supplier bills. */
  function billTxnId(b) {
    if (!b) return '';
    if (b.txnId) return String(b.txnId);
    return b.id ? 'PU-' + String(b.id).replace(/^b_/, '').toUpperCase() : '';
  }
  function paymentFees(s) { return ((s && s.payments) || []).reduce((a, p) => a + Math.max(0, num(p.fee)), 0); }
  /* One shipment moves through the 4 phases: Ship (consolidating → loading → on the way), Receive (arrived →
   * customs cleared → in warehouse), then Sell (ready to sell). Items become sellable once in the warehouse. */
  const SHIP_STATUSES = [
    ['planning', 'Consolidating'], ['loading', 'Loading'], ['in_transit', 'On the way'], ['at_port', 'Arrived in Cameroon'],
    ['cleared', 'Customs cleared'], ['received', 'In warehouse'], ['closed', 'Ready to sell'],
  ];
  const shipPhase = (st) => (['at_port', 'cleared', 'received'].includes(st) ? 'receive' : st === 'closed' ? 'sell' : 'ship');
  const COST_CATEGORIES = [
    // side 'US' = Ship phase costs (before arrival); side 'CM' = Receive phase costs (in Cameroon)
    ['US', 'Consolidation / storage'], ['US', 'Trucking / drayage'], ['US', 'Loading labor'], ['US', 'Ocean freight'],
    ['US', 'BESC (cargo tracking note)'], ['US', 'Tests & inspection'], ['US', 'Packing materials'], ['US', 'Insurance'], ['US', 'Other shipping cost'],
    ['CM', 'Customs duties – goods'], ['CM', 'Customs duties – vehicles'], ['CM', 'Clearing agent fee'], ['CM', 'Port storage'],
    ['CM', 'Demurrage'], ['CM', 'Transport to warehouse'], ['CM', 'Offloading labor'], ['CM', 'Storage & preparation'], ['CM', 'Other receiving cost'],
  ];
  const ADJ_REASONS = ['Missing / theft', 'Unaccounted for', 'Damaged', 'Expired', 'Missing in transfer', 'Stock count difference', 'Count correction', 'Found / extra', 'Own use / gift'];
  /* ---------------- losses: why stock disappeared ----------------
   * k: stored cause · photo: a photo is required as proof · pick: offered when someone records a loss
   * (the others are set by the app: stock counts, transfers, arrival). */
  const LOSS_CAUSES = [
    { k: 'theft', label: 'Theft / missing', photo: true, pick: true, hint: 'Stolen, or gone without explanation' },
    { k: 'damaged', label: 'Damaged in store', photo: true, pick: true, hint: 'Broken, torn, crushed on the shelf' },
    { k: 'pests', label: 'Rats & pests', photo: true, pick: true, hint: 'Rats, cockroaches, termites, weevils' },
    { k: 'water', label: 'Water, flood or fire', photo: true, pick: true, hint: 'Leaking roof, flood, fire, heat' },
    { k: 'handling', label: 'Broken in handling', photo: true, pick: true, hint: 'Dropped while moving or delivering' },
    { k: 'expired', label: 'Expired / spoiled', photo: false, pick: true, hint: 'Past its date, gone bad' },
    { k: 'ownuse', label: 'Own use, gift or sample', photo: false, pick: true, hint: 'Taken for the shop, given away' },
    { k: 'other', label: 'Other', photo: false, pick: true, hint: 'Explain in the note' },
    { k: 'count', label: 'Missing at stock count', photo: false, pick: false },
    { k: 'transfer', label: 'Missing in a transfer', photo: false, pick: false },
    { k: 'arrival', label: 'Missing or damaged on arrival', photo: false, pick: false },
    { k: 'returned', label: 'Returned, never paid back', photo: false, pick: false },
  ];
  const lossCause = (k) => LOSS_CAUSES.find((c) => c.k === k) || LOSS_CAUSES.find((c) => c.k === 'other');
  /** the cause of a stock correction (older corrections only have a reason text) */
  function lossCauseOf(a) {
    if (a.cause && LOSS_CAUSES.some((c) => c.k === a.cause)) return a.cause;
    const r = String(a.reason || '').toLowerCase();
    if (/theft|stolen|missing \/|unaccounted/.test(r)) return /unaccounted/.test(r) ? 'count' : 'theft';
    if (/rat|pest|termite|cockroach/.test(r)) return 'pests';
    if (/water|flood|fire/.test(r)) return 'water';
    if (/expired|spoil/.test(r)) return 'expired';
    if (/own use|gift|sample/.test(r)) return 'ownuse';
    if (/transfer/.test(r)) return 'transfer';
    if (/count/.test(r)) return 'count';
    if (/handling|transport|dropped/.test(r)) return 'handling';
    if (/damag|broken/.test(r)) return 'damaged';
    return 'other';
  }
  /** a loss report someone wants to save → error text, or '' when it is fine */
  function lossCheck(L) {
    const c = LOSS_CAUSES.find((x) => x.k === L.cause && x.pick);
    if (!c) return 'Choose why the stock was lost';
    const lines = Array.isArray(L.lines) ? L.lines : [];
    if (!lines.length) return 'Add at least one item';
    for (const l of lines) { if (!l || !l.productId) return 'An item is missing'; const q = num(l.qty); if (!(q > 0) || Math.floor(q) !== q) return 'Quantities must be whole numbers above 0'; }
    if (new Set(lines.map((l) => l.productId)).size !== lines.length) return 'Each item only once';
    if (c.photo && !(Array.isArray(L.photos) && L.photos.length)) return 'Add a photo — it is required for ' + c.label.toLowerCase();
    if (c.k === 'other' && String(L.notes || '').trim().length < 3) return 'Explain what happened in the note';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(L.date || ''))) return 'Choose the date';
    return '';
  }
  const RETURN_REASONS = ['Damaged / defective', 'Expired', 'Wrong item given', 'Customer changed mind', 'Not as described', 'Other'];
  const TRANSFER_REASONS = ['Restock a branch', 'Customer order at another branch', 'Return to main warehouse', 'Rebalance slow stock', 'Other'];
  const CURRENCIES = [['XAF', 'FCFA', 'Central African CFA franc (Cameroon, Gabon, Congo, Chad, CAR, Eq. Guinea)'], ['XOF', 'CFA', 'West African CFA franc (Senegal, Côte d\'Ivoire, Mali, Burkina, Benin, Togo, Niger)'], ['NGN', '₦', 'Nigerian naira'], ['GHS', 'GH₵', 'Ghanaian cedi'], ['RWF', 'RF', 'Rwandan franc'], ['GNF', 'FG', 'Guinean franc'], ['KES', 'KSh', 'Kenyan shilling'], ['UGX', 'USh', 'Ugandan shilling'], ['TZS', 'TSh', 'Tanzanian shilling'], ['ZAR', 'R', 'South African rand'], ['CDF', 'FC', 'Congolese franc'], ['USD', '$', 'US dollar'], ['EUR', '€', 'Euro'], ['GBP', '£', 'British pound'], ['CAD', 'C$', 'Canadian dollar'], ['CNY', '¥', 'Chinese yuan'], ['AED', 'AED', 'UAE dirham']];
  // daily running costs first (recorded at the end of each day), then the monthly ones
  const EXPENSE_CATS = ['Food & drinks', 'Water', 'Local transport', 'Fuel', 'Phone & internet', 'Warehouse rent', 'Salaries & wages', 'Electricity & water', 'Marketing', 'Taxes & licences', 'MoMo / bank fees', 'Security', 'Repairs & maintenance', 'Insurance', 'Other'];

  /** Sale totals that don't depend on cost. Payment `amount` pays the sale; `fee` is MoMo/OM charges (separate). */
  /* ---------- delivery (local or to another region) ---------- */
  /* How the goods reach the client. 'collect' = the client sends their own delivery person to the shop. */
  const DELIVERY_MODES = [['pickup', 'Pickup at the shop'], ['collect', 'Customer sends someone to collect'], ['local', 'Local delivery (moto / taxi)'], ['agency', 'Travel agency (other town / region)'], ['courier', 'Courier / parcel service']];
  const OUR_DELIVERY = ['local', 'agency', 'courier']; // we send the goods
  /* The customer always pays the delivery fee: to us (added to the bill) or straight to the agency / driver. */
  const DELIVERY_PAYERS = [['client_us', 'Customer pays us — added to the bill'], ['client_agency', 'Customer pays the agency / driver directly']];
  const DELIVERY_PAY_WHEN = [['before', 'Before delivery'], ['on_delivery', 'On delivery']];
  /** When the customer must have paid: before pickup (their delivery person), before we send it, or on delivery. */
  function deliveryRule(d) {
    if (!d || !d.mode || d.mode === 'pickup') return null;
    if (d.mode === 'collect') return { key: 'before_pickup', text: 'Pay in full before their delivery person collects' };
    return d.payWhen === 'on_delivery' ? { key: 'on_delivery', text: 'Pays before or on delivery' } : { key: 'before', text: 'Pay in full before we send it' };
  }
  /** Why the goods may not be handed over / sent / marked delivered yet ('' = fine). balance = what is still owed. */
  function handOverBlock(sale, balance, toStatus) {
    const d = sale && sale.delivery; const r = deliveryRule(d); if (!r || !(num(balance) > 0.5) || !toStatus || toStatus === 'to_send') return '';
    const left = Math.round(num(balance)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (r.key === 'before_pickup') return 'Not paid in full (' + left + ' left). Their delivery person can only collect once everything is paid.';
    if (r.key === 'before') return 'Not paid in full (' + left + ' left). The customer pays before we send it.';
    if (r.key === 'on_delivery' && toStatus === 'delivered') return 'Record the ' + left + ' collected on delivery before marking it delivered.';
    return '';
  }
  const DELIVERY_STATUSES = [['to_send', 'To send'], ['sent', 'Sent'], ['delivered', 'Delivered']];
  const deliveryModeLabel = (m) => (DELIVERY_MODES.find((x) => x[0] === m) || [0, ''])[1];
  const isDelivery = (s) => !!(s && s.delivery && s.delivery.mode && s.delivery.mode !== 'pickup');
  /** Delivery fee the client owes US (kept apart from the sale amount, like MoMo charges). */
  function deliveryFeeDue(s) { return isDelivery(s) && (s.delivery.payer || 'client_us') === 'client_us' ? Math.max(0, num(s.delivery.fee)) : 0; }
  const cut = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
  /** Normalise delivery details from a form or the public shop. Returns null for "no delivery info". */
  function cleanDelivery(d) {
    if (!d || typeof d !== 'object') return null;
    const mode = DELIVERY_MODES.some((x) => x[0] === d.mode) ? d.mode : 'pickup';
    const out = { mode, agency: cut(d.agency, 80), destination: cut(d.destination, 80), address: cut(d.address, 160), recipientName: cut(d.recipientName, 80), recipientPhone: cut(d.recipientPhone, 30), trackingNo: cut(d.trackingNo, 60), notes: cut(d.notes, 300),
      fee: mode === 'collect' ? 0 : Math.max(0, Math.round(num(d.fee))), payer: DELIVERY_PAYERS.some((x) => x[0] === d.payer) ? d.payer : 'client_us',
      payWhen: mode === 'collect' ? 'before' : d.payWhen === 'on_delivery' ? 'on_delivery' : 'before',
      status: DELIVERY_STATUSES.some((x) => x[0] === d.status) ? d.status : 'to_send' };
    if (mode === 'collect') { out.destination = ''; out.agency = ''; out.address = ''; }
    if (d.sentAt) out.sentAt = cut(d.sentAt, 40); if (d.deliveredAt) out.deliveredAt = cut(d.deliveredAt, 40);
    if (mode === 'pickup') return { mode: 'pickup' };
    return out;
  }

  /* ================= FEATURES (what a subscription plan includes) =================
   * Every business feature has a key. A plan (or a per-business override) turns each one on or off.
   * Off = hidden everywhere in the business app AND refused by the server. Data is kept; turning it back on restores it.
   * Always included (not in this list): Home, stock list & prices, settings, team members, profile, billing, help. */
  const FEATURES = [
    ['buy', 'Purchases', 'Buying', 'Record what you buy, with costs and tax'],
    ['ship', 'Shipments', 'Import flow', 'Group items into shipments and track them to Cameroon'],
    ['receive', 'Receiving', 'Import flow', 'Arrival, customs and putting stock in the warehouse'],
    ['sell', 'Point of sale', 'Sales', 'Sales, receipts, payments, returns'],
    ['delivery', 'Deliveries', 'Sales', 'Delivery details, travel agencies, delivery status'],
    ['onlineShop', 'Online shop & orders', 'Sales', 'Public shop page and online orders'],
    ['promos', 'Promotions', 'Sales', 'Discounts and special prices for a period'],
    ['emailReceipts', 'Email receipts', 'Sales', 'Send receipts by email'],
    ['customers', 'Customers', 'Customers', 'Customer list and history'],
    ['credit', 'Credit sales', 'Customers', 'Sell on credit, credit limits, balances'],
    ['reminders', 'Payment reminders', 'Customers', 'Remind customers who owe money'],
    ['autoReminders', 'Automatic reminders', 'Customers', 'Reminders sent automatically every day'],
    ['stockCount', 'Stock counts', 'Stock', 'Count stock and fix differences'],
    ['branches', 'Branches', 'Stock', 'More than one shop or warehouse'],
    ['transfers', 'Branch transfers', 'Stock', 'Move stock between branches'],
    ['photos', 'Product photos', 'Stock', 'Photos on items and in the online shop'],
    ['labels', 'Barcode labels', 'Stock', 'Print price and barcode labels'],
    ['expenses', 'Expenses', 'Money', 'Record expenses by phase of the flow'],
    ['cashHandover', 'Cash handover', 'Money', 'Close the day and hand cash to a manager'],
    ['tills', 'Till takeover', 'Money', 'Hand the till to a colleague during the day'],
    ['suppliers', 'Suppliers & bills', 'Money', 'Suppliers and bills to pay'],
    ['reports', 'Reports', 'Money', 'Sales, profit and stock reports'],
    ['assets', 'Assets', 'Money', 'Equipment and vehicles the business owns'],
    ['attendance', 'Attendance', 'Staff', 'Clock in/out, breaks, lateness'],
    ['leave', 'Leave', 'Staff', 'Vacation requests and balances'],
    ['payroll', 'Payroll', 'Staff', 'Payslips, advances and salary payments'],
    ['customRoles', 'Custom roles', 'Team', 'Your own roles and per-person permissions'],
    ['activity', 'Activity log', 'Team', 'Who did what, and when'],
    ['excel', 'Excel & backup', 'Team', 'Download Excel files and full backups'],
  ];
  const FEATURE_KEYS = FEATURES.map((f) => f[0]);
  /* ================= EDITIONS (the kind of business) =================
   * Aahsso Brocan: buy abroad, ship, receive, sell. Aahsso Store: buy locally, sell, manage stock.
   * Chosen at sign-up; only the platform admin changes it. Features an edition does not have are off whatever the plan says,
   * and the server refuses them. Plans are made for one edition. */
  const EDITIONS = {
    import: { key: 'import', label: 'Aahsso Brocan', short: 'Brocan', tag: 'Buy abroad, ship, receive and sell', points: ['Buy in dollars or any currency', 'Containers, freight and customs', 'Landed cost on every item'], off: [] },
    store: { key: 'store', label: 'Aahsso Store', short: 'Store', tag: 'Buy locally, sell and manage your stock', points: ['Buy from local suppliers', 'Sell at the till, track stock', 'Simple and quick to learn'], off: ['ship', 'receive'] },
  };
  const EDITION_KEYS = Object.keys(EDITIONS);
  const editionOf = (k) => EDITIONS[k] || EDITIONS.import;
  /** does this edition have this feature at all (before the plan is applied) */
  const editionHas = (ed, key) => !editionOf(ed).off.includes(key);
  /** the plan catalog for one edition */
  const featuresOf = (ed) => FEATURES.filter((f) => editionHas(ed, f[0]));
  /** features: {key: false} map from the server ({} or null = everything on, e.g. the free trial or this-device mode) */
  const featureOn = (features, key) => !features || features[key] !== false;
  const anyOn = (features, keys) => keys.some((k) => featureOn(features, k));
  // which feature each permission belongs to (a permission of a feature that is off is never granted)
  const PERM_FEATURE = { purchases: ['buy'], containers: ['ship', 'receive'], transfers: ['transfers'], audit: ['stockCount'], credit: ['credit'], reminders: ['reminders'],
    expenses: ['expenses'], handover: ['cashHandover'], suppliers: ['suppliers'], reports: ['reports'], assets: ['assets'], payroll: ['payroll'], hr: ['attendance', 'leave', 'payroll'],
    activity: ['activity'], export: ['excel'], allLocations: ['branches'], sell: ['sell'], payments: ['sell'], returns: ['sell'], cancel: ['sell'], discount: ['sell'],
    customers: ['customers'], orders: ['onlineShop'], promos: ['promos'] };
  const permFeatureOn = (features, perm) => !PERM_FEATURE[perm] || anyOn(features, PERM_FEATURE[perm]);
  // which feature each page (route) belongs to
  const ROUTE_FEATURE = { buy: ['buy'], ship: ['ship'], receive: ['receive'], sales: ['sell'], sell: ['sell'], orders: ['onlineShop'], customers: ['customers'], reminders: ['reminders'],
    promos: ['promos'], audit: ['stockCount'], transfers: ['transfers'], expenses: ['expenses'], cash: ['cashHandover', 'tills'], suppliers: ['suppliers'], reports: ['reports'], assets: ['assets'],
    staff: ['attendance'], leave: ['leave'], payroll: ['payroll'], employees: ['attendance', 'leave', 'payroll'], activity: ['activity'] };
  const routeFeatureOn = (features, route) => !ROUTE_FEATURE[route] || anyOn(features, ROUTE_FEATURE[route]);
  // which feature each kind of record belongs to (writes are refused when all of them are off)
  const COLLECTION_FEATURE = { lots: ['buy', 'ship', 'receive'], shipments: ['ship', 'receive'], sales: ['sell'], customers: ['customers'], orders: ['onlineShop'], promos: ['promos'],
    audits: ['stockCount'], transfers: ['transfers'], expenses: ['expenses'], handovers: ['cashHandover'], tills: ['tills'], suppliers: ['suppliers'], bills: ['suppliers'], assets: ['assets'],
    attendance: ['attendance'], leaves: ['leave'], payroll: ['payroll'], staff: ['attendance', 'leave', 'payroll'], reminders: ['reminders'] };
  // records hidden entirely when their feature is off (the core ones — items, stock, sales — are still needed to compute stock)
  const HIDDEN_WHEN_OFF = ['orders', 'promos', 'audits', 'transfers', 'expenses', 'handovers', 'tills', 'suppliers', 'bills', 'assets', 'attendance', 'leaves', 'payroll', 'staff', 'reminders'];
  /** permissions after the plan: a permission whose feature is off is false */
  function permsWithFeatures(perms, features) { const out = Object.assign({}, perms); Object.keys(out).forEach((p) => { if (out[p] && !permFeatureOn(features, p)) out[p] = false; }); return out; }

  /* ---------- online shop address: /s/<slug>, made from the store name, unique across Aahsso ---------- */
  const SHOP_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
  const RESERVED_SLUGS = ['admin', 'api', 'app', 'www', 'aahsso', 'kargo', 'shop', 'shops', 'store', 'stores', 'login', 'signup', 'register', 'help', 'support', 'settings', 'orders', 'static', 'assets', 'new', 'test', 'demo'];
  /** "Mama's Beauté & Co" → "mamas-beaute-and-co" */
  function shopSlugify(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  }
  /** Why a shop address can't be used ('' when fine). */
  function shopSlugError(s) {
    if (!s) return 'Type an address for your shop';
    if (s.length < 3) return 'Use at least 3 letters or numbers';
    if (!SHOP_SLUG_RE.test(s)) return 'Use only letters, numbers and dashes (3 to 40)';
    if (RESERVED_SLUGS.includes(s)) return 'This address is reserved — choose another';
    return '';
  }

  /* ---------- public shop (clients order and type their own details) ---------- */
  /** What clients may see: items in stock with a price. Never costs; exact stock only when few are left. */
  function shopCatalog(raw, C) {
    return (raw.products || []).filter((p) => !p.archived && !p.shopHidden).map((p) => {
      const x = C.prodX[p.id]; if (!x) return null;
      const available = Math.max(0, num(x.available) - num(x.reserved || 0));
      const price = x.promo ? num(x.promo.price) : num(x.priceMax);
      if (available <= 0 || price <= 0) return null;
      return { id: p.id, name: p.name, category: p.category || 'Other', subcategory: p.subcategory || '', condition: p.condition || 'New', unit: p.unit || '', size: sizeLabel(p) || '', price: Math.round(price), was: x.promo ? Math.round(num(x.priceMax)) : null, image: p.image || '', available };
    }).filter(Boolean).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }
  const publicItem = (i) => ({ id: i.id, name: i.name, category: i.category, subcategory: i.subcategory, condition: i.condition, unit: i.unit, size: i.size, price: i.price, was: i.was || null, image: i.image, few: i.available <= 5 ? i.available : null });
  /** Check an order sent from the public shop. Prices come from the catalogue, never from the client. */
  function validateShopOrder(body, catalog) {
    const b = body && typeof body === 'object' ? body : {};
    const c = b.customer || {};
    const name = cut(c.name, 80), phone = cut(c.phone, 30).replace(/[^\d+ ]/g, '');
    if (name.length < 2) return { error: 'Please type your name' };
    if (phone.replace(/\D/g, '').length < 8) return { error: 'Please type a phone number we can call or WhatsApp' };
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) return { error: 'Your basket is empty' };
    if (items.length > 50) return { error: 'Too many different items in one order' };
    const byId = new Map(catalog.map((i) => [i.id, i])); const lines = []; const seen = new Set();
    for (const it of items) {
      const p = byId.get(it && it.productId); const qty = Math.floor(num(it && it.qty));
      if (!p) return { error: 'An item in your basket is no longer available — please refresh the page' };
      if (qty < 1 || qty > 999) return { error: 'Check the quantity for ' + p.name };
      if (seen.has(p.id)) return { error: 'Duplicate item: ' + p.name }; seen.add(p.id);
      if (qty > p.available) return { error: 'Only ' + p.available + ' left of ' + p.name };
      lines.push({ productId: p.id, name: p.name, qty, unitPrice: p.price });
    }
    const delivery = cleanDelivery(Object.assign({}, b.delivery, { fee: 0, payer: 'client_us', status: 'to_send', trackingNo: '', sentAt: '', deliveredAt: '' })) || { mode: 'pickup' };
    if (delivery.mode === 'collect') {
      if (!delivery.recipientName || !delivery.recipientPhone) return { error: 'Please type the name and phone of the person who will collect' };
    } else if (delivery.mode !== 'pickup') {
      if (!delivery.destination) return { error: 'Please type the town / area to deliver to' };
      if (delivery.mode === 'agency' && !delivery.agency) return { error: 'Please type the travel agency name' };
      if (!delivery.recipientName) delivery.recipientName = name;
      if (!delivery.recipientPhone) delivery.recipientPhone = phone;
    }
    return { order: { customer: { name, phone, whatsapp: cut(c.whatsapp, 30).replace(/[^\d+ ]/g, '') || phone, city: cut(c.city, 60) }, lines, subtotal: lines.reduce((a, l) => a + l.qty * l.unitPrice, 0), delivery, note: cut(b.note, 500) } };
  }

  function saleTotals(s) {
    const lines = s.lines || [];
    const subtotal = lines.reduce((a, l) => a + num(l.qty) * num(l.unitPrice), 0);
    const discount = Math.min(num(s.discount), subtotal);
    const total = subtotal - discount;
    const factor = subtotal > 0 ? total / subtotal : 1; // spreads discount across lines
    let returned = 0;
    lines.forEach((l) => (l.returns || []).forEach((r) => { returned += num(r.qty) * num(l.unitPrice) * factor; }));
    const net = total - returned;
    const paid = (s.payments || []).reduce((a, p) => a + num(p.amount), 0);
    const fees = paymentFees(s);
    // delivery fee the client owes us: separate from the sale amount (revenue), but part of what they must pay
    const deliveryFee = deliveryFeeDue(s); const due = net + deliveryFee;
    const balance = Math.round(due - paid);
    let status = s.status === 'cancelled' ? 'cancelled' : balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    return { subtotal, discount, total, factor, returned, net, deliveryFee, due, paid, fees, balance, status, txnId: saleTxnId(s) };
  }

  /** Everything derived from raw collections. */
  function computeAll(raw) {
    const S = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
    const fxDef = num(S.fxRate) || 600;
    const rate = (cur, sh) => rateOf(S, cur, sh);
    const products = raw.products || [], lots = raw.lots || [], shipments = raw.shipments || [];
    const sales = raw.sales || [], adjustments = raw.adjustments || [], transfers = raw.transfers || [];
    const prodById = {}, shipById = {}, lotById = {};
    products.forEach((p) => (prodById[p.id] = p));
    shipments.forEach((s) => (shipById[s.id] = s));
    lots.forEach((l) => (lotById[l.id] = l));

    const lotX = {}, shipX = {}, prodX = {}, saleX = {};
    lots.forEach((l) => {
      const sh = l.shipmentId && shipById[l.shipmentId];
      const fx = rate(l.currency || 'USD', sh);
      const unitX = num(l.unitCost) * fx;
      const regX = num(l.regularPrice) * fx;
      const taxX = num(l.unitTax) * fx; // purchase tax share per unit
      const paidX = unitX + taxX;
      let stage;
      if (sh) stage = sh.status === 'received' || sh.status === 'closed' ? 'warehouse' : 'transit';
      else stage = l.sourceType === 'Local (Cameroon)' || l.inWarehouse ? 'warehouse' : 'us';
      const received = Math.max(0, num(l.qty) - num(l.recvMissing) - num(l.recvDamaged));
      const home = l.locationId || (sh && sh.locationId) || 'main';
      lotX[l.id] = { unitX, taxX, paidX, regX, fx, stage, received, home, locDelta: {}, alloc: 0, out: 0, adj: 0, sold: 0, revenue: 0, cogs: 0 };
    });

    const isVeh = (l) => (prodById[l.productId] || {}).category === 'Vehicles';
    shipments.forEach((sh) => {
      const ls = lots.filter((l) => l.shipmentId === sh.id);
      const fx = rate('USD', sh);
      const val = (l) => lotX[l.id].unitX * num(l.qty);
      let costsX = 0, unalloc = 0, usX = 0, cmX = 0;
      (sh.costs || []).forEach((c) => {
        const amt = num(c.amount) * rate(c.currency || 'USD', sh);
        costsX += amt;
        if (c.side === 'US') usX += amt; else cmX += amt;
        let t = ls;
        if (c.appliesTo === 'goods') t = ls.filter((l) => !isVeh(l));
        else if (c.appliesTo === 'vehicles') t = ls.filter(isVeh);
        else if (c.appliesTo && c.appliesTo !== 'all') t = ls.filter((l) => l.id === c.appliesTo);
        if (!t.length) { unalloc += amt; return; }
        const tv = t.reduce((a, l) => a + val(l), 0), tq = t.reduce((a, l) => a + num(l.qty), 0);
        t.forEach((l) => { lotX[l.id].alloc += tv > 0 ? (amt * val(l)) / tv : tq > 0 ? (amt * num(l.qty)) / tq : 0; });
      });
      const goodsX = ls.reduce((a, l) => a + lotX[l.id].paidX * num(l.qty), 0);
      const regularX = ls.reduce((a, l) => a + lotX[l.id].regX * num(l.qty), 0);
      shipX[sh.id] = { fx, costsX, usX, cmX, unalloc, goodsX, regularX, landedX: goodsX + costsX - unalloc, lotIds: ls.map((l) => l.id),
        units: ls.reduce((a, l) => a + num(l.qty), 0), unitsSold: 0, revenue: 0, cogs: 0, lossX: 0, stockX: 0 };
    });
    lots.forEach((l) => { const x = lotX[l.id], q = num(l.qty); x.landedUnit = x.paidX + (q > 0 ? x.alloc / q : 0); });

    const mv = (x, loc, q) => { x.locDelta[loc] = (x.locDelta[loc] || 0) + q; };
    sales.forEach((s) => {
      const t = saleTotals(s);
      let cogs = 0; const sloc = s.locationId || 'main';
      if (t.status !== 'cancelled') {
        (s.lines || []).forEach((ln) => {
          const netUnit = num(ln.unitPrice) * t.factor;
          (ln.alloc || []).forEach((a) => {
            const x = lotX[a.lotId]; if (!x) return;
            x.out += num(a.qty); mv(x, sloc, -num(a.qty)); x.sold += num(a.qty); x.revenue += num(a.qty) * netUnit;
            x.cogs += num(a.qty) * x.landedUnit; cogs += num(a.qty) * x.landedUnit;
          });
          (ln.returns || []).forEach((r) => (r.alloc || []).forEach((a) => {
            const x = lotX[a.lotId]; if (!x) return;
            x.sold -= num(a.qty); x.revenue -= num(a.qty) * netUnit;
            if (r.restock) { x.out -= num(a.qty); mv(x, sloc, num(a.qty)); x.cogs -= num(a.qty) * x.landedUnit; cogs -= num(a.qty) * x.landedUnit; }
          }));
        });
      }
      saleX[s.id] = Object.assign(t, { cogs, profit: t.status === 'cancelled' ? 0 : t.net - cogs });
    });

    adjustments.forEach((a) => { const x = lotX[a.lotId]; if (x) { x.adj += num(a.qty); mv(x, a.locationId || x.home, num(a.qty)); } });
    transfers.forEach((tr) => { if (tr.status === 'cancelled') return; const moving = tr.status === 'in_transit'; (tr.lines || []).forEach((ln) => (ln.alloc || []).forEach((a) => { const x = lotX[a.lotId]; if (!x) return; mv(x, tr.from || 'main', -num(a.qty)); if (moving) x.moving = (x.moving || 0) + num(a.qty); else mv(x, tr.to || 'main', num(a.qty)); })); });

    products.forEach((p) => (prodX[p.id] = { moving: 0, byLoc: {}, reserved: 0, reservedLots: [], available: 0, transit: 0, us: 0, costSum: 0, costQty: 0, allSum: 0, allQty: 0, nextExpiry: null, lotIds: [], sold: 0, revenue: 0, cogs: 0, lossX: 0 }));
    lots.forEach((l) => {
      const x = lotX[l.id];
      const phys = x.received - x.out + x.adj;
      x.reservedFor = l.reservedFor || '';
      x.available = x.stage === 'warehouse' ? phys : 0;
      x.byLoc = {};
      if (x.stage === 'warehouse') { x.byLoc[x.home] = x.received; Object.keys(x.locDelta).forEach((k) => (x.byLoc[k] = (x.byLoc[k] || 0) + x.locDelta[k])); if (!x.reservedFor) x.available = phys - (x.moving || 0); }
      x.clientAvail = x.reservedFor ? phys : 0; // client orders can be sold (deposits) even while at sea
      x.lossX = (num(l.qty) - x.received) * x.landedUnit + (x.adj < 0 ? -x.adj * x.landedUnit : 0);
      const px = prodX[l.productId];
      if (px) {
        px.lotIds.push(l.id);
        if (x.reservedFor) { px.reserved += Math.max(0, x.clientAvail); if (x.clientAvail > 0) px.reservedLots.push(l.id); }
        else if (x.stage === 'warehouse') {
          const av = Math.max(0, x.available);
          px.available += av;
          Object.keys(x.byLoc).forEach((k) => (px.byLoc[k] = (px.byLoc[k] || 0) + Math.max(0, x.byLoc[k])));
          px.moving += x.moving || 0;
          // sold more than we had (two phones offline, a wrong count…) — must be investigated
          const negLoc = Object.values(x.byLoc).reduce((a, v) => a + Math.min(0, v), 0);
          px.oversold = (px.oversold || 0) + Math.max(-Math.min(0, x.available), -negLoc);
          if (av > 0) { px.costSum += x.landedUnit * av; px.costQty += av; if (l.expiry && (!px.nextExpiry || l.expiry < px.nextExpiry)) px.nextExpiry = l.expiry; }
        } else if (x.stage === 'transit') px.transit += num(l.qty); else px.us += num(l.qty);
        px.allSum += x.landedUnit * num(l.qty); px.allQty += num(l.qty);
        px.sold += x.sold; px.revenue += x.revenue; px.cogs += x.cogs; px.lossX += x.lossX;
      }
      const sx = l.shipmentId && shipX[l.shipmentId];
      if (sx) { sx.unitsSold += x.sold; sx.revenue += x.revenue; sx.cogs += x.cogs; sx.lossX += x.lossX; sx.stockX += Math.max(0, x.available) * x.landedUnit; }
    });
    products.forEach((p) => {
      const px = prodX[p.id];
      px.avgCost = px.costQty > 0 ? px.costSum / px.costQty : px.allQty > 0 ? px.allSum / px.allQty : 0;
      const sp = sellingPrices(p, px.avgCost, S);
      px.markup = sp.markup; px.priceMax = sp.max; px.priceMin = sp.min; px.priceWholesale = sp.ws;
      px.priceManual = num(p.priceMax) > 0;
      px.bulkQty = num(p.bulkQty) || num(S.bulkQty) || 0;
      px.stockValue = px.available * px.avgCost;
      px.retailValue = px.available * px.priceMax;
      px.profit = px.revenue - px.cogs;
    });
    // running promotions: the best (lowest) promo price per item
    const live = (raw.promos || []).filter((pr) => promoActive(pr));
    products.forEach((p) => {
      const px = prodX[p.id]; let best = null;
      live.forEach((pr) => { if (!promoCovers(pr, p)) return; const price = promoPriceOf(pr, px.priceMax, S); if (price < px.priceMax && (!best || price < best.price)) best = { id: pr.id, name: pr.name || 'Promotion', price, type: pr.type, value: num(pr.value), end: pr.end || '' }; });
      px.promo = best;
    });
    return { S, prodById, shipById, lotById, lotX, shipX, prodX, saleX };
  }

  /** FIFO (earliest expiry first, then oldest purchase) allocation of qty for a product.
   *  extra: {lotId: qty} added back (e.g. the sale being edited). Returns alloc[] or null. */
  /** Units of a lot this customer may take: client-order lots only for their customer, other lots once in the warehouse. */
  function lotCap(C, l, customerId, loc) {
    const x = C.lotX[l.id]; if (!x) return 0;
    if (l.reservedFor) return l.reservedFor === customerId ? x.clientAvail : 0;
    if (x.stage !== 'warehouse') return 0;
    return loc ? (x.byLoc[loc] || 0) : x.available;
  }
  function allocate(C, lots, productId, qty, extra, customerId, loc) {
    extra = extra || {};
    const cands = lots.filter((l) => l.productId === productId && C.lotX[l.id])
      .map((l) => ({ l, av: lotCap(C, l, customerId, loc) + ((!l.reservedFor || l.reservedFor === customerId) ? num(extra[l.id]) : 0) }))
      .filter((c) => c.av > 0)
      .sort((a, b) => (!!b.l.reservedFor - !!a.l.reservedFor) || (a.l.expiry || '9999') < (b.l.expiry || '9999') ? -1 : (a.l.expiry || '9999') > (b.l.expiry || '9999') ? 1 : (a.l.purchaseDate || '') < (b.l.purchaseDate || '') ? -1 : 1);
    let need = num(qty); const out = [];
    for (const c of cands) { if (need <= 0) break; const take = Math.min(need, c.av); out.push({ lotId: c.l.id, qty: take }); need -= take; }
    return need > 0 ? null : out;
  }

  /** Server/client check: does this sale fit in stock? Returns list of problems. */
  function validateSale(raw, sale) {
    const others = Object.assign({}, raw, { sales: (raw.sales || []).filter((s) => s.id !== sale.id) });
    const C = computeAll(others);
    const need = {};
    if (sale.status === 'cancelled') return [];
    (sale.lines || []).forEach((ln) => (ln.alloc || []).forEach((a) => { need[a.lotId] = (need[a.lotId] || 0) + num(a.qty); }));
    (sale.lines || []).forEach((ln) => (ln.returns || []).forEach((r) => r.restock && (r.alloc || []).forEach((a) => { need[a.lotId] = (need[a.lotId] || 0) - num(a.qty); })));
    const problems = [];
    Object.keys(need).forEach((id) => {
      const x = C.lotX[id], l = C.lotById[id];
      if (!x) { problems.push('Unknown stock lot ' + id); return; }
      const cap = Math.max(0, lotCap(C, l, sale.customerId, sale.locationId || 'main'));
      if (need[id] > cap + 1e-9) problems.push((l.reservedFor && l.reservedFor !== sale.customerId ? 'Lot ' + id + ' is reserved for another customer' : 'Not enough stock for lot ' + id) + ' (need ' + need[id] + ', have ' + cap + ')');
    });
    return problems;
  }


  /* ---------------- roles & permissions ---------------- */
  const PERMS = [
    ['sell', 'Make sales', 'Sales'], ['salesAll', 'See everyone\'s sales (off = only their own)', 'Sales'],
    ['payments', 'Record payments & deposits', 'Sales'], ['discount', 'Give discounts / sell below minimum price', 'Sales'],
    ['returns', 'Process returns & refunds', 'Sales'], ['cancel', 'Cancel sales & delete payments', 'Sales'],
    ['orders', 'Handle online orders', 'Sales'], ['promos', 'Create promotions', 'Sales'],
    ['customers', 'Add & edit customers', 'Sales'], ['credit', 'Sell beyond a customer\'s credit limit', 'Sales'], ['reminders', 'Send payment reminders to customers', 'Sales'],
    ['stockView', 'See stock list', 'Stock'], ['stockEdit', 'Adjust stock, set prices, photos & labels', 'Stock'],
    ['purchases', 'Record purchases', 'Stock'], ['containers', 'Containers & shipping costs', 'Stock'], ['transfers', 'Move stock between branches', 'Stock'], ['audit', 'Do stock counts (inventory audit)', 'Stock'], ['lossReport', 'Report losses (theft, damage, pests…)', 'Stock'], ['allLocations', 'Work at all locations (off = only their own)', 'Stock'],
    ['costs', 'See costs, margins & profit', 'Money'], ['reports', 'See reports & analytics', 'Money'], ['expenses', 'Record expenses', 'Money'], ['handover', 'Confirm staff cash handovers', 'Money'], ['payroll', 'Payroll: salaries, advances & payslips', 'Money'], ['suppliers', 'Suppliers & bills to pay', 'Money'], ['assets', 'Business assets (equipment, vehicles…)', 'Money'],
    ['approve', 'Approve risky actions for others on the spot (with a PIN)', 'Admin'], ['export', 'Download Excel & backups', 'Admin'], ['activity', 'See the activity log (who did what)', 'Admin'], ['settings', 'Change business settings', 'Admin'], ['team', 'Manage team & permissions', 'Admin'], ['hr', 'Staff: attendance, leave approval & employee files', 'Admin'],
  ];
  const ALL = PERMS.map((p) => p[0]);
  const ROLES = {
    owner: { label: 'Owner', perms: ALL },
    admin: { label: 'Admin', perms: ALL },
    manager: { label: 'Manager', perms: ALL.filter((p) => !['team', 'settings', 'payroll'].includes(p)) },
    sales: { label: 'Sales rep', perms: ['sell', 'payments', 'returns', 'customers', 'stockView', 'orders', 'lossReport'] },
    viewer: { label: 'Viewer (read only)', perms: ['stockView', 'reports', 'salesAll', 'allLocations'] },
  };
  /** member: {role, perms:{perm: true|false overrides}, active} → {perm: bool} */
  /** Role list with the business's own edits (settings.roles) applied. Owner can never be restricted. */
  function rolesWith(custom) {
    const out = {}; Object.entries(ROLES).forEach(([k, r]) => (out[k] = { label: r.label, perms: r.perms.slice() }));
    Object.entries(custom || {}).forEach(([k, r]) => { if (k === 'owner' || !r) return; out[k] = { label: r.label || (out[k] || {}).label || k, perms: Array.isArray(r.perms) ? r.perms.filter((p) => ALL.includes(p)) : (out[k] || { perms: [] }).perms, custom: !ROLES[k], v: r.v }; });
    return out;
  }
  function permsFor(member, customRoles) {
    const out = {}; ALL.forEach((p) => (out[p] = false));
    if (!member || member.active === false) return out;
    if (member.role === 'owner') { ALL.forEach((p) => (out[p] = true)); return out; }
    const R = rolesWith(customRoles);
    const r = R[member.role] || R.sales;
    r.perms.forEach((p) => (out[p] = true));
    if (r.custom !== undefined && !r.v) { // a role saved before 'orders' and 'promos' existed keeps what it could do
      if (out.sell || out.payments) out.orders = true;
      if (out.stockEdit) out.promos = true;
    }
    if (r.custom !== undefined && (r.v || 0) < 3 && (out.sell || out.stockView || out.stockEdit)) out.lossReport = true; // saved before loss reports existed
    if (r.custom !== undefined && (r.v || 0) < 3 && out.cancel && out.discount && out.returns) out.approve = true; // …and before manager approvals
    if (member.role !== 'owner' && member.perms) Object.keys(member.perms).forEach((p) => { if (p in out) out[p] = !!member.perms[p]; });
    return out;
  }

  /* ---------------- packs: buy and sell by the carton, keep stock in pieces ----------------
   * product.packs = [{ name: 'carton', size: 24, price: 30000 | null }]. Stock, sales and counts stay in pieces;
   * a sale line sold by the carton keeps qty in pieces and carries pack: { name, size, price }. */
  const PACK_NAMES = ['pack', 'box', 'case', 'carton', 'crate', 'bag', 'sack', 'bundle', 'dozen', 'set', 'tray', 'roll'];
  const packsOf = (p) => ((p && p.packs) || []).filter((k) => k && num(k.size) > 1).map((k) => ({ name: String(k.name || 'pack'), size: Math.floor(num(k.size)), price: num(k.price) > 0 ? num(k.price) : null })).sort((a, b) => b.size - a.size);
  const plural = (w, n) => n === 1 ? w : /(s|x|ch|sh)$/.test(w) ? w + 'es' : w + 's';
  /** "5 cartons + 3 pieces" (largest pack), or '' when the item has no pack */
  function packText(p, n) {
    const pk = packsOf(p)[0]; n = Math.floor(num(n)); if (!pk || n < pk.size) return '';
    const full = Math.floor(n / pk.size), rest = n - full * pk.size; const u = (p && p.unit && p.unit !== 'unit') ? p.unit : 'piece';
    return full + ' ' + plural(pk.name, full) + (rest ? ' + ' + rest + ' ' + plural(u, rest) : '');
  }
  /** a sale line, in words: "2 × carton of 24 @ 30,000" or "3 × 1,250" */
  const lineQtyText = (l, fmtN) => l.pack && num(l.pack.size) > 1 ? (num(l.qty) / num(l.pack.size)) + ' × ' + l.pack.name + ' of ' + l.pack.size + ' @ ' + fmtN(num(l.unitPrice) * num(l.pack.size)) : l.qty + ' × ' + fmtN(l.unitPrice);

  /* ---------------- units of measure ---------------- */
  const SELL_UNITS = ['piece', 'pack', 'box', 'case', 'carton', 'bottle', 'can', 'jar', 'bag', 'sachet', 'pair', 'set', 'dozen', 'kg', 'lb', 'litre', 'gallon', 'metre', 'unit'];
  const SIZE_UNITS = {
    g: ['mass', 1], kg: ['mass', 1000], oz: ['mass', 28.349523125], lb: ['mass', 453.59237],
    mL: ['vol', 1], L: ['vol', 1000], 'fl oz': ['vol', 29.5735295625], gal: ['vol', 3785.411784],
    cm: ['len', 1], m: ['len', 100], in: ['len', 2.54], ft: ['len', 30.48],
    W: ['power', 1], 'inch (screen)': ['screen', 1], GB: ['data', 1], TB: ['data', 1000],
  };
  const r2 = (v) => Math.round(v * 100) / 100;
  /** Converts a size to the other measurement system. Returns '' if not applicable. */
  function convertSize(size, unit) {
    const v = num(size), u = SIZE_UNITS[unit]; if (!v || !u) return '';
    const base = v * u[1];
    if (u[0] === 'mass') return ['g', 'kg'].includes(unit) ? (base >= 453.6 ? r2(base / 453.59237) + ' lb' : r2(base / 28.349523125) + ' oz') : (base >= 1000 ? r2(base / 1000) + ' kg' : r2(base) + ' g');
    if (u[0] === 'vol') return ['mL', 'L'].includes(unit) ? (base >= 3785 ? r2(base / 3785.411784) + ' gal' : r2(base / 29.5735295625) + ' fl oz') : (base >= 1000 ? r2(base / 1000) + ' L' : r2(base) + ' mL');
    if (u[0] === 'len') return ['cm', 'm'].includes(unit) ? (base >= 30.48 ? r2(base / 30.48) + ' ft' : r2(base / 2.54) + ' in') : (base >= 100 ? r2(base / 100) + ' m' : r2(base) + ' cm');
    if (u[0] === 'screen') return r2(v * 2.54) + ' cm';
    return '';
  }
  function sizeLabel(p) { if (!p || !num(p.size) || !p.sizeUnit) return ''; const c = convertSize(p.size, p.sizeUnit); return num(p.size) + ' ' + p.sizeUnit + (c ? ' (' + c + ')' : ''); }

  /* ---------------- analytics ---------------- */
  const dOf = (s) => String(s.date || s.createdAt || '').slice(0, 10);
  const localDate = (ds) => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d); };
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const addDays = (ds, n) => { const d = localDate(ds); d.setDate(d.getDate() + n); return ymd(d); };
  const daysBetween = (a, b) => Math.round((localDate(b) - localDate(a)) / 864e5);

  /** Line-level sales facts (cancelled excluded). opts.sales lets callers pass a filtered list. */
  function saleFacts(raw, C, opts) {
    opts = opts || {}; const out = [];
    (opts.sales || raw.sales || []).forEach((s) => {
      const t = C.saleX[s.id]; if (!t || t.status === 'cancelled') return;
      const date = dOf(s); if (opts.from && date < opts.from) return; if (opts.to && date > opts.to) return;
      const hour = s.createdAt ? new Date(s.createdAt).getHours() : null;
      (s.lines || []).forEach((ln) => {
        const rq = (ln.returns || []).reduce((a, r) => a + num(r.qty), 0);
        const q = num(ln.qty) - rq;
        let cogs = 0;
        (ln.alloc || []).forEach((a) => { const x = C.lotX[a.lotId]; if (x) cogs += num(a.qty) * x.landedUnit; });
        (ln.returns || []).forEach((r) => r.restock && (r.alloc || []).forEach((a) => { const x = C.lotX[a.lotId]; if (x) cogs -= num(a.qty) * x.landedUnit; }));
        const p = C.prodById[ln.productId] || {};
        const revenue = q * num(ln.unitPrice) * t.factor;
        const client = (ln.alloc || []).some((a) => (C.lotById[a.lotId] || {}).reservedFor);
        out.push({ client, saleId: s.id, date, hour, weekday: localDate(date).getDay(), sellerId: s.createdById || '', seller: s.createdBy || '', customerId: s.customerId || '', customer: s.customerName || '',
          productId: ln.productId, name: p.name || ln.name, category: p.category || 'Other', subcategory: p.subcategory || '', qty: q, revenue, cogs, profit: revenue - cogs });
      });
    });
    return out;
  }
  function groupBy(facts, keyFn, labelFn) {
    const m = {};
    facts.forEach((f) => { const k = keyFn(f); const o = (m[k] = m[k] || { key: k, label: labelFn ? labelFn(f) : k, qty: 0, revenue: 0, cogs: 0, profit: 0, sales: new Set() }); o.qty += f.qty; o.revenue += f.revenue; o.cogs += f.cogs; o.profit += f.profit; o.sales.add(f.saleId); });
    return Object.values(m).map((o) => Object.assign(o, { n: o.sales.size, margin: o.revenue ? (o.profit / o.revenue) * 100 : 0, sales: undefined }));
  }
  function summarize(facts) {
    const r = { revenue: 0, cogs: 0, profit: 0, qty: 0, n: new Set(facts.map((f) => f.saleId)).size };
    facts.forEach((f) => { r.revenue += f.revenue; r.cogs += f.cogs; r.profit += f.profit; r.qty += f.qty; });
    r.margin = r.revenue ? (r.profit / r.revenue) * 100 : 0; r.avgTicket = r.n ? r.revenue / r.n : 0; return r;
  }

  /** Inventory health per product: velocity, days of stock, movers classification. */
  function inventoryHealth(raw, C, today) {
    const facts30 = saleFacts(raw, C, { from: addDays(today, -29), to: today });
    const facts90 = saleFacts(raw, C, { from: addDays(today, -89), to: today });
    const allF = saleFacts(raw, C, {});
    const q30 = {}, q90 = {}, last = {};
    // client orders (bought for one customer) are not demand from the open market
    facts30.forEach((f) => { if (!f.client) q30[f.productId] = (q30[f.productId] || 0) + f.qty; });
    facts90.forEach((f) => { if (!f.client) q90[f.productId] = (q90[f.productId] || 0) + f.qty; });
    allF.forEach((f) => { if (!last[f.productId] || f.date > last[f.productId]) last[f.productId] = f.date; });
    return (raw.products || []).filter((p) => !p.archived).map((p) => {
      const x = C.prodX[p.id]; if (!x) return null;
      let firstIn = null;
      x.lotIds.forEach((id) => { const l = C.lotById[id], lx = C.lotX[id]; if (!l || lx.stage !== 'warehouse') return; const sh = l.shipmentId && C.shipById[l.shipmentId]; const d = (sh && (sh.receivedAt || sh.arrivedAt)) || l.purchaseDate; if (d && (!firstIn || d < firstIn)) firstIn = d; });
      const ageDays = firstIn ? Math.max(0, daysBetween(firstIn, today)) : 0;
      const window = Math.max(1, Math.min(30, ageDays || 30));
      const velocity = (q30[p.id] || 0) / window; // units per day
      const daysOfStock = velocity > 0 ? x.available / velocity : (x.available > 0 ? Infinity : 0);
      const sellThrough = x.sold + x.available > 0 ? (x.sold / (x.sold + x.available)) * 100 : 0;
      const daysSinceSale = last[p.id] ? daysBetween(last[p.id], today) : null;
      let status;
      if (x.available <= 0) status = x.transit + x.us > 0 ? 'incoming' : 'out';
      else if (ageDays < 7 && !q30[p.id]) status = 'new';
      else if (!last[p.id] && ageDays >= 45) status = 'dead';
      else if (velocity === 0) status = ageDays < 21 ? 'new' : 'slow';
      else if (daysOfStock <= 30) status = 'fast';
      else if (daysOfStock <= 90) status = 'steady';
      else status = 'slow';
      return { id: p.id, name: p.name, category: p.category || 'Other', subcategory: p.subcategory || '', available: x.available, incoming: x.transit + x.us,
        sold30: q30[p.id] || 0, sold90: q90[p.id] || 0, soldAll: x.sold, velocity, daysOfStock, sellThrough, lastSale: last[p.id] || null, daysSinceSale, ageDays,
        stockValue: x.stockValue, retailValue: x.retailValue, avgCost: x.avgCost, price: x.priceMax, unitProfit: x.priceMax - x.avgCost,
        margin: x.priceMax ? ((x.priceMax - x.avgCost) / x.priceMax) * 100 : 0, status };
    }).filter(Boolean);
  }

  /** Run-rate projections, container break-even and reorder suggestions. */
  function projections(raw, C, today, health) {
    health = health || inventoryHealth(raw, C, today);
    const f30 = summarize(saleFacts(raw, C, { from: addDays(today, -29), to: today }));
    const fPrev = summarize(saleFacts(raw, C, { from: addDays(today, -59), to: addDays(today, -30) }));
    const monthStart = today.slice(0, 8) + '01';
    const mtd = summarize(saleFacts(raw, C, { from: monthStart, to: today }));
    const d = localDate(today); const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); const left = dim - d.getDate();
    const firstSale = (raw.sales || []).reduce((m, s) => (!m || dOf(s) < m ? dOf(s) : m), null);
    const activeDays = firstSale ? Math.max(7, Math.min(30, daysBetween(firstSale, today) + 1)) : 30; // at least a week, so day-one numbers don't explode
    const dailyRev = f30.revenue / activeDays, dailyProfit = f30.profit / activeDays;
    const yStart = today.slice(0, 4) + '-01-01'; const ytd = summarize(saleFacts(raw, C, { from: yStart, to: today }));
    const daysLeftYear = daysBetween(today, today.slice(0, 4) + '-12-31');
    const stockRetail = health.reduce((a, h) => a + Math.max(0, h.available) * h.price, 0);
    const stockCost = health.reduce((a, h) => a + Math.max(0, h.available) * h.avgCost, 0);
    const containers = (raw.shipments || []).map((s) => {
      const x = C.shipX[s.id]; if (!x) return null;
      let rev30 = 0; const ids = new Set(x.lotIds);
      (raw.sales || []).forEach((sale) => { const t = C.saleX[sale.id]; const ds = dOf(sale); if (!t || t.status === 'cancelled' || ds < addDays(today, -29)) return; (sale.lines || []).forEach((ln) => (ln.alloc || []).forEach((a) => { if (ids.has(a.lotId)) rev30 += num(a.qty) * num(ln.unitPrice) * t.factor; })); });
      const need = Math.max(0, x.landedX - x.revenue); const perDay = rev30 / 30;
      return { id: s.id, name: s.name || s.containerNo || 'Container', landed: x.landedX, revenue: x.revenue, profit: x.revenue - x.cogs, recoveredPct: x.landedX ? (x.revenue / x.landedX) * 100 : 0,
        need, perDay, breakEvenDays: need <= 0 ? 0 : perDay > 0 ? Math.ceil(need / perDay) : null, stockX: x.stockX };
    }).filter(Boolean);
    const reorder = health.filter((h) => h.sold30 > 0 && h.daysOfStock < 75).map((h) => {
      const target = Math.ceil(h.velocity * 90); const suggest = Math.max(0, target - Math.max(0, h.available) - h.incoming);
      return Object.assign({}, h, { suggest, expectedProfit: suggest * Math.max(0, h.unitProfit), score: h.velocity * Math.max(0, h.unitProfit) });
    }).filter((h) => h.suggest > 0).sort((a, b) => b.score - a.score);
    return {
      last30: f30, prev30: fPrev, trendPct: fPrev.revenue ? ((f30.revenue - fPrev.revenue) / fPrev.revenue) * 100 : null,
      dailyRev, dailyProfit, mtd, projectedMonthRev: mtd.revenue + dailyRev * left, projectedMonthProfit: mtd.profit + dailyProfit * left,
      ytd, projectedYearRev: ytd.revenue + dailyRev * daysLeftYear, projectedYearProfit: ytd.profit + dailyProfit * daysLeftYear,
      stockRetail, stockCost, daysToSellStock: dailyRev > 0 ? Math.ceil(stockRetail / dailyRev) : null,
      containers, reorder, stockouts: health.filter((h) => h.available > 0 && h.velocity > 0 && h.daysOfStock <= 21).sort((a, b) => a.daysOfStock - b.daysOfStock),
    };
  }

  /** Local-currency value of 1 unit of `cur`. Purchases may be in $, € or any currency; sales & reports are always in the base currency. */
  function rateOf(S, cur, sh) {
    const base = S.currency || 'XAF'; if (!cur || cur === base) return 1;
    const shr = sh && ((sh.fxRates && num(sh.fxRates[cur])) || (cur === 'USD' && num(sh.fxRate)));
    if (shr) return shr;
    const r = (S.fxRates && num(S.fxRates[cur])) || (cur === 'USD' && num(S.fxRate)) || (cur === 'EUR' && ['XAF', 'XOF'].includes(base) && 655.957);
    return r || 1;
  }
  /** Stock check for a transfer between locations. */
  function validateTransfer(raw, tr) {
    if (tr.status === 'cancelled') return [];
    const C = computeAll(Object.assign({}, raw, { transfers: (raw.transfers || []).filter((t) => t.id !== tr.id) }));
    const need = {}; const problems = [];
    if ((tr.from || 'main') === (tr.to || 'main')) return ['From and to locations must be different'];
    (tr.lines || []).forEach((ln) => (ln.alloc || []).forEach((a) => (need[a.lotId] = (need[a.lotId] || 0) + num(a.qty))));
    Object.keys(need).forEach((id) => { const x = C.lotX[id], l = C.lotById[id]; const cap = x && l && !l.reservedFor && x.stage === 'warehouse' ? Math.max(0, x.byLoc[tr.from || 'main'] || 0) : 0; if (need[id] > cap + 1e-9) problems.push('Not enough stock at source for lot ' + id + ' (need ' + need[id] + ', have ' + cap + ')'); });
    return problems;
  }
  /* wholesale */
  const isWholesale = (c) => !!(c && ['Wholesale', 'Reseller'].includes(c.type));
  /** Price to charge: retail or wholesale, or the running promotion when it is lower. */
  function autoPrice(C, productId, qty, customer) { const px = C.prodX[productId]; if (!px) return 0; const base = isWholesale(customer) || (px.bulkQty > 0 && num(qty) >= px.bulkQty) ? px.priceWholesale : px.priceMax; return px.promo && px.promo.price < base ? px.promo.price : base; }
  /** Lowest price allowed without the discount right; a running promotion lowers it to the promo price. */
  function priceFloor(C, productId, qty, customer) { const px = C.prodX[productId]; if (!px) return 0; const ws = isWholesale(customer) || (px.bulkQty > 0 && num(qty) >= px.bulkQty); const f = ws ? Math.min(px.priceMin, px.priceWholesale) : px.priceMin; return px.promo ? Math.min(f, px.promo.price) : f; }
  /* cash handover: what a person collected on a day, by method */
  function collectedBy(raw, userId, date) {
    const by = {}, feesBy = {}; let total = 0, fees = 0; const items = [];
    (raw.sales || []).forEach((s) => (s.payments || []).forEach((p) => { if (p.byId === userId && p.date === date) { by[p.method] = (by[p.method] || 0) + num(p.amount); total += num(p.amount); const f = Math.max(0, num(p.fee)); if (f) { feesBy[p.method] = (feesBy[p.method] || 0) + f; fees += f; } items.push({ saleId: s.id, no: s.no, txnId: saleTxnId(s), customer: s.customerName, p }); } }));
    // till taken over from / handed to a colleague during the day moves what this person must hand over
    const mv = tillMoves(raw, userId, date); const collected = total;
    Object.entries(mv.into).forEach(([m, v]) => { by[m] = (by[m] || 0) + v; total += v; });
    Object.entries(mv.outOf).forEach(([m, v]) => { by[m] = (by[m] || 0) - v; total -= v; });
    Object.keys(by).forEach((m) => { if (Math.abs(by[m]) < 0.005) delete by[m]; });
    return { by, total, feesBy, fees, items, collected, moves: mv.list };
  }

  /* ================= STAFF: attendance, leave, payroll, till takeovers ================= */
  // Employees with a login have the staff id 'u_<userId>'; people without a login get their own id.
  const staffIdOf = (userId) => 'u_' + String(userId || '').replace(/[^A-Za-z0-9_\-]/g, '');
  const PAY_TYPES = [['monthly', 'Monthly salary'], ['daily', 'Daily rate'], ['hourly', 'Hourly rate']];
  const LEAVE_TYPES = [['vacation', 'Paid vacation', true], ['sick', 'Sick leave (paid)', true], ['unpaid', 'Unpaid leave', false], ['other', 'Other paid leave', true]];
  const LEAVE_STATUS = [['requested', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Declined'], ['cancelled', 'Cancelled']];
  const CLOCK = { in: 'Clocked in', break: 'Break', back: 'Back from break', out: 'Clocked out' };
  const STAFF_DEFAULTS = { workWeek: [1, 2, 3, 4, 5, 6], workStart: '08:00', workEnd: '18:00', lateGraceMin: 10, hoursPerDay: 8, overtimeRate: 1.5, leavePerYear: 18 };
  const staffRules = (S) => { const o = Object.assign({}, STAFF_DEFAULTS, (S && S.staffRules) || {}); o.workWeek = Array.isArray(o.workWeek) && o.workWeek.length ? o.workWeek.map(Number) : STAFF_DEFAULTS.workWeek; return o; };
  const ymdOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const dowOf = (ymd) => new Date(ymd + 'T12:00:00').getDay(); // 0 = Sunday
  const hmMin = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const minOfDay = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
  function datesBetween(from, to) { const out = []; if (!from || !to || to < from) return out; let d = from; for (let i = 0; i < 400 && d <= to; i++) { out.push(d); d = addDays(d, 1); } return out; }
  const monthDays = (month) => { const [y, m] = month.split('-').map(Number); const last = new Date(y, m, 0).getDate(); return datesBetween(month + '-01', month + '-' + String(last).padStart(2, '0')); };
  const isWorkDay = (ymd, R) => R.workWeek.includes(dowOf(ymd));
  /** One person's day from their clock events → state now, worked and break minutes. nowIso: the current time (for someone still working). */
  function dayState(att, nowIso, S) {
    const R = staffRules(S);
    const ev = ((att && att.events) || []).filter((e) => CLOCK[e.t]).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    let state = 'off', since = null, worked = 0, brk = 0, start = null, firstIn = null, lastOut = null, breaks = 0;
    const T = (iso) => new Date(iso).getTime();
    ev.forEach((e) => {
      if (e.t === 'in') { if (state === 'off' || state === 'done') { state = 'in'; start = e.at; since = e.at; if (!firstIn) firstIn = e.at; } }
      else if (e.t === 'break') { if (state === 'in') { worked += T(e.at) - T(start); state = 'break'; start = e.at; since = e.at; breaks++; } }
      else if (e.t === 'back') { if (state === 'break') { brk += T(e.at) - T(start); state = 'in'; start = e.at; since = e.at; } }
      else if (e.t === 'out') { if (state === 'in') worked += T(e.at) - T(start); else if (state === 'break') brk += T(e.at) - T(start); if (state !== 'off') { state = 'done'; since = e.at; lastOut = e.at; start = null; } }
    });
    const today = nowIso ? ymdOf(new Date(nowIso)) : null;
    const open = (state === 'in' || state === 'break') && att && today && att.date < today; // forgot to clock out
    if (state === 'in' && nowIso && !open) worked += Math.max(0, T(nowIso) - T(start));
    if (state === 'break' && nowIso && !open) brk += Math.max(0, T(nowIso) - T(start));
    const lateMin = firstIn ? Math.max(0, minOfDay(firstIn) - hmMin(R.workStart)) : 0;
    return { state, since, workedMin: Math.round(worked / 60000), breakMin: Math.round(brk / 60000), firstIn, lastOut, breaks, open, late: lateMin > R.lateGraceMin, lateMin };
  }
  /** Which clock buttons make sense now. */
  const clockNext = (state) => state === 'in' ? ['break', 'out'] : state === 'break' ? ['back', 'out'] : ['in'];
  /** Working days a leave covers (only the business's working days). */
  function leaveDates(lv, S) { const R = staffRules(S); return datesBetween(lv.from, lv.to || lv.from).filter((d) => isWorkDay(d, R)); }
  const leavePaid = (type) => (LEAVE_TYPES.find((x) => x[0] === type) || [0, 0, true])[2];
  /** Paid-vacation balance for a calendar year: entitlement (pro rata from the start date) − approved − waiting. */
  function leaveBalance(raw, staff, year, S) {
    const R = staffRules(S); const per = num(staff && staff.leavePerYear) || R.leavePerYear;
    let months = 12; const st = staff && staff.startDate;
    if (st && st.slice(0, 4) === String(year)) months = 12 - Number(st.slice(5, 7)) + 1; else if (st && st.slice(0, 4) > String(year)) months = 0;
    const entitled = Math.round(per * months / 12 * 2) / 2;
    let taken = 0, pending = 0;
    (raw.leaves || []).filter((l) => l.staffId === (staff && staff.id) && l.type === 'vacation').forEach((l) => {
      const n = leaveDates(l, S).filter((d) => d.slice(0, 4) === String(year)).length * (l.half ? 0.5 : 1);
      if (l.status === 'approved') taken += n; else if (l.status === 'requested') pending += n;
    });
    return { entitled, taken, pending, left: entitled - taken - pending };
  }
  /** Leave requests that overlap a period for the same person (to stop double booking). */
  const leaveOverlaps = (raw, lv) => (raw.leaves || []).filter((l) => l.id !== lv.id && l.staffId === lv.staffId && ['requested', 'approved'].includes(l.status) && l.from <= (lv.to || lv.from) && (l.to || l.from) >= lv.from);
  /** A month's figures for one employee: worked days/hours, leave, absences, lateness, overtime. */
  function staffMonth(raw, staff, month, S, nowIso) {
    const R = staffRules(S); const today = nowIso ? ymdOf(new Date(nowIso)) : ymdOf(new Date());
    const days = monthDays(month); const sched = days.filter((d) => isWorkDay(d, R));
    const att = {}; (raw.attendance || []).forEach((a) => { if (a.staffId === staff.id && a.date && a.date.slice(0, 7) === month) att[a.date] = a; });
    const leaveOn = {}; (raw.leaves || []).filter((l) => l.staffId === staff.id && l.status === 'approved').forEach((l) => leaveDates(l, S).forEach((d) => { if (d.slice(0, 7) === month) leaveOn[d] = l; }));
    let worked = 0, minutes = 0, ot = 0, late = 0, open = 0, paidLeave = 0, unpaidLeave = 0, absent = 0; const absentDays = [];
    days.forEach((d) => {
      const a = att[d]; const st = a ? dayState(a, nowIso, S) : null;
      if (st && st.workedMin > 0) { worked++; minutes += st.workedMin; ot += Math.max(0, st.workedMin - R.hoursPerDay * 60); if (st.late) late++; if (st.open) open++; }
      const lv = leaveOn[d];
      if (lv && isWorkDay(d, R) && !(st && st.workedMin > 0)) { const n = lv.half ? 0.5 : 1; if (leavePaid(lv.type)) paidLeave += n; else unpaidLeave += n; }
      if (!lv && isWorkDay(d, R) && !(st && st.workedMin > 0) && d < today && (!staff.startDate || d >= staff.startDate)) { absent++; absentDays.push(d); }
    });
    return { month, scheduled: sched.length, worked, hours: Math.round(minutes / 6) / 10, overtimeH: Math.round(ot / 6) / 10, late, open, paidLeave, unpaidLeave, absent, absentDays, tracked: Object.keys(att).length > 0 };
  }
  /** Draft payslip from the month's figures. opts: {deductAbsences, deductShortages, extra:{earnings:[], deductions:[]}} */
  function payslipDraft(raw, staff, month, S, opts = {}, nowIso) {
    const R = staffRules(S); const pay = staff.pay || {}; const rate = num(pay.rate); const type = pay.type || 'monthly';
    const m = staffMonth(raw, staff, month, S, nowIso); const hpd = num(pay.hoursPerDay) || R.hoursPerDay;
    const dayRate = type === 'monthly' ? (m.scheduled ? rate / m.scheduled : 0) : type === 'daily' ? rate : rate * hpd;
    const hourRate = type === 'hourly' ? rate : dayRate / hpd;
    const E = [], D = []; const r0 = (v) => Math.round(v);
    if (type === 'monthly') E.push({ label: 'Monthly salary', amount: r0(rate), auto: true });
    if (type === 'daily') E.push({ label: m.worked + ' day' + (m.worked === 1 ? '' : 's') + ' worked × ' + r0(rate), amount: r0(m.worked * rate), auto: true });
    if (type === 'hourly') E.push({ label: m.hours + ' h worked × ' + r0(rate), amount: r0(m.hours * rate), auto: true });
    if (type !== 'monthly' && m.paidLeave) E.push({ label: m.paidLeave + ' paid leave day' + (m.paidLeave === 1 ? '' : 's'), amount: r0(m.paidLeave * dayRate), auto: true });
    if (pay.overtime && m.overtimeH > 0) { const mult = num(pay.overtimeRate) || R.overtimeRate; E.push({ label: 'Overtime ' + m.overtimeH + ' h × ' + mult, amount: r0(m.overtimeH * hourRate * (type === 'hourly' ? mult - 1 : mult)), auto: true }); }
    if (type === 'monthly' && m.unpaidLeave) D.push({ label: 'Unpaid leave (' + m.unpaidLeave + ' day' + (m.unpaidLeave === 1 ? '' : 's') + ')', amount: r0(m.unpaidLeave * dayRate), auto: true });
    if (type === 'monthly' && m.absent && opts.deductAbsences) D.push({ label: 'Absent without leave (' + m.absent + ' day' + (m.absent === 1 ? '' : 's') + ')', amount: r0(m.absent * dayRate), auto: true });
    (raw.payroll || []).filter((p) => p.type === 'advance' && p.staffId === staff.id && (p.deductMonth || String(p.date).slice(0, 7)) === month && p.status !== 'cancelled')
      .forEach((p) => D.push({ label: 'Advance ' + p.date + (p.note ? ' (' + p.note + ')' : ''), amount: r0(num(p.amount)), auto: true, ref: p.id }));
    if (staff.userId && opts.deductShortages !== false) {
      const sh = (raw.handovers || []).filter((h) => h.userId === staff.userId && h.status === 'confirmed' && String(h.date).slice(0, 7) === month && num(h.diff) <= -1);
      const tot = sh.reduce((a, h) => a - num(h.diff), 0);
      if (tot) D.push({ label: 'Cash shortages (' + sh.length + ' day' + (sh.length === 1 ? '' : 's') + ')', amount: r0(tot), auto: true });
      (raw.audits || []).filter((a) => a.status === 'applied' && a.charge && a.charge.deduct && a.charge.userId === staff.userId && a.charge.month === month && num(a.charge.amount) > 0)
        .forEach((a) => D.push({ label: 'Stock shortage (count ' + String(a.appliedAt || a.submittedAt || '').slice(0, 10) + ')', amount: r0(num(a.charge.amount)), auto: true, ref: a.id }));
    }
    ((opts.extra && opts.extra.earnings) || []).forEach((x) => num(x.amount) && E.push({ label: x.label || 'Bonus', amount: r0(num(x.amount)) }));
    ((opts.extra && opts.extra.deductions) || []).forEach((x) => num(x.amount) && D.push({ label: x.label || 'Deduction', amount: r0(num(x.amount)) }));
    const gross = E.reduce((a, x) => a + x.amount, 0), ded = D.reduce((a, x) => a + x.amount, 0);
    return { month, staffId: staff.id, staffName: staff.name, payType: type, rate, stats: m, earnings: E, deductions: D, gross, deductionsTotal: ded, net: Math.max(0, gross - ded), dayRate: r0(dayRate) };
  }
  /* till takeover: money a person handed to / received from a colleague during the day (by method) */
  function tillMoves(raw, userId, date) {
    const into = {}, outOf = {}; const list = [];
    (raw.tills || []).forEach((t) => {
      if (t.date !== date || !['accepted', 'disputed', 'reviewed'].includes(t.status)) return;
      const got = t.received || {};
      if (t.toId === userId) { Object.entries(got).forEach(([m, v]) => (into[m] = (into[m] || 0) + num(v))); list.push({ dir: 'in', t }); }
      if (t.fromId === userId) { Object.entries(got).forEach(([m, v]) => (outOf[m] = (outOf[m] || 0) + num(v))); list.push({ dir: 'out', t }); }
    });
    return { into, outOf, list };
  }
  /* supplier bills */
  function billTotals(b, S) {
    const fx = num(b.fxRate) || rateOf(S || {}, b.currency || 'XAF'); const toX = (v) => num(v) * fx;
    const amount = num(b.amount), paid = (b.payments || []).reduce((a, p) => a + num(p.amount), 0), balance = amount - paid;
    const fees = paymentFees(b); // MoMo / OM charges we paid on top — separate from the bill amount
    return { amount, paid, balance, fees, amountX: toX(amount), paidX: toX(paid), balanceX: toX(balance), feesX: toX(fees), txnId: billTxnId(b), status: balance <= 0.005 ? 'paid' : paid > 0 ? 'partial' : 'unpaid' };
  }
  /* reminders */
  function dueDateOf(s, S) { return s.dueDate || addDays(String(s.date || s.createdAt || '').slice(0, 10), num((S || {}).creditDays) || 14); }


  /* ---------------- activity log: plain-language description of any change ---------------- */
  const ACT_TYPES = { sales: 'Sales', payments: 'Payments', lots: 'Purchases', products: 'Items & prices', shipments: 'Containers', adjustments: 'Stock & losses', losses: 'Stock & losses', claims: 'Returns & claims', transfers: 'Transfers', audits: 'Stock counts', customers: 'Customers', handovers: 'Cash handover', bills: 'Suppliers & bills', suppliers: 'Suppliers & bills', expenses: 'Expenses', settings: 'Settings & team', members: 'Settings & team', locations: 'Settings & team', reminders: 'Reminders', assets: 'Assets', staff: 'Staff', attendance: 'Attendance', leaves: 'Leave', payroll: 'Payroll', tills: 'Cash handover' };
  /** L = lookups {product(id), customer(id), loc(id), ship(id), F(amount), money(v,cur)} → [{type, text, reason, amount, ref}] (one change can produce several lines) */
  function describeChange(col, b, a, L) {
    const out = []; const type = ACT_TYPES[col] || col; const push = (text, extra) => out.push(Object.assign({ type, text }, extra || {}));
    const n = (x) => num(x); const F = L.F || ((v) => String(Math.round(v)));
    if (col === 'sales' && a && ((a.approvals || []).length > ((b && b.approvals) || []).length)) {
      const WHAT = { cancel: 'a cancellation', returns: 'a return / refund', discount: 'a discount or low price', credit: 'credit over the limit' };
      (a.approvals || []).slice(((b && b.approvals) || []).length).forEach((x) => push(x.by + ' approved ' + (WHAT[x.action] || x.action) + ' for ' + (x.for || 'staff') + ' on sale ' + (a.no || ''), { ref: a.no }));
    }
    if (col === 'sales') {
      const doc = a || b; const ref = doc.no || ''; const cust = doc.customerName || 'Walk-in customer';
      const items = (d) => (d.lines || []).map((l) => n(l.qty) + ' × ' + (l.name || L.product(l.productId))).join(', ');
      const total = (d) => { const t = saleTotals(d); return t.total; };
      if (!b && a) push('Sold ' + items(a) + ' to ' + cust + ' — ' + F(total(a)) + (a.delivered === false ? ' (reserved, not picked up)' : ''), { ref, amount: total(a), reason: a.notes || '' });
      else if (b && !a) push('Deleted sale ' + ref, { ref });
      else {
        if (b.status !== 'cancelled' && a.status === 'cancelled') push('Cancelled sale ' + ref + ' (' + cust + ', ' + F(total(b)) + ')', { ref, reason: a.cancelReason || '', amount: -total(b) });
        const lb = JSON.stringify((b.lines || []).map((l) => [l.productId, l.qty, l.unitPrice])), la = JSON.stringify((a.lines || []).map((l) => [l.productId, l.qty, l.unitPrice]));
        if (lb !== la) push('Changed items on ' + ref + ': ' + items(b) + ' → ' + items(a) + ' (' + F(total(b)) + ' → ' + F(total(a)) + ')', { ref });
        if (n(b.discount) !== n(a.discount)) push('Changed discount on ' + ref + ': ' + F(n(b.discount)) + ' → ' + F(n(a.discount)), { ref });
        const pb = new Map((b.payments || []).map((p) => [p.id, p])), pa = new Map((a.payments || []).map((p) => [p.id, p]));
        pa.forEach((p, id) => { if (!pb.has(id)) out.push({ type: 'Payments', text: (n(p.amount) < 0 ? 'Refunded ' + F(-n(p.amount)) : 'Received ' + F(n(p.amount))) + ' by ' + (p.method || 'Cash') + (p.account ? ' to ' + p.account : '') + (p.ref ? ' (txn ' + p.ref + ')' : '') + (n(p.fee) > 0 ? ' + ' + F(n(p.fee)) + ' charges' : '') + ' — ' + ref + ', ' + cust, ref: p.ref || ref, amount: n(p.amount), reason: n(p.amount) < 0 ? (p.ref || '') : '' }); });
        pb.forEach((p, id) => { if (!pa.has(id)) out.push({ type: 'Payments', text: 'Deleted a payment of ' + F(n(p.amount)) + ' (' + (p.method || '') + ') from ' + ref, ref, amount: -n(p.amount), reason: a.lastPaymentDeleteReason || '' }); });
        (a.lines || []).forEach((l, i) => { const rb = ((b.lines || [])[i] || {}).returns || []; (l.returns || []).slice(rb.length).forEach((r) => push('Return: ' + n(r.qty) + ' × ' + (l.name || L.product(l.productId)) + ' on ' + ref + (r.restock ? ' — back to stock' : ' — written off'), { ref, reason: [r.reason, r.note].filter(Boolean).join(' · ') })); });
        if (!b.delivered && a.delivered && a.status !== 'cancelled') push('Customer picked up ' + ref, { ref });
        if ((b.customerId || '') !== (a.customerId || '')) push('Changed customer on ' + ref + ': ' + (b.customerName || 'Walk-in') + ' → ' + (a.customerName || 'Walk-in'), { ref });
        if (!out.length) push('Updated sale ' + ref, { ref });
      }
      return out;
    }
    if (col === 'adjustments') { const d = a || b; const q = n(d.qty); push((b && !a ? 'Deleted stock correction: ' : q < 0 ? 'Removed ' : 'Added ') + Math.abs(q) + ' × ' + L.product(d.productId) + ' at ' + L.loc(d.locationId), { reason: [d.reason, d.notes].filter(Boolean).join(' · ') }); return out; }
    if (col === 'claims') {
      const d = a || b; const who = (d.party && d.party.name) || ''; const m = (v) => (L.F ? L.F(v) : v);
      if (!b) push((d.kind === 'return' ? 'Sent back to ' : 'Claim against ') + who + ': ' + (d.lines || []).map((l) => n(l.qty) + ' × ' + L.product(l.productId)).join(', ') + ' — ' + m(n(d.amount)) + ' owed', { ref: d.no, reason: d.reason || '' });
      else if (a) { const got = (x) => (x.received || []).reduce((s, r) => s + n(r.amount), 0); if (got(a) > got(b)) push('Received ' + m(got(a) - got(b)) + ' from ' + who, { ref: d.no }); if (a.status === 'closed' && b.status !== 'closed') push((a.outcome === 'writtenOff' ? 'Wrote off ' : 'Settled ') + (d.no || '') + ' with ' + who, { ref: d.no, reason: a.writeOffNote || '' }); }
      return out;
    }
    if (col === 'losses') {
      const d = a || b; const what = (d.lines || []).map((l) => n(l.qty) + ' × ' + L.product(l.productId)).join(', '); const why = lossCause(d.cause).label;
      if (!b) push((a.status === 'approved' ? 'Recorded loss ' : 'Reported loss ') + (d.no || '') + ': ' + what + ' at ' + L.loc(d.locationId), { ref: d.no, reason: [why, d.notes].filter(Boolean).join(' · ') });
      else if (a && b.status !== a.status) push((a.status === 'approved' ? 'Approved' : a.status === 'rejected' ? 'Rejected' : a.status === 'withdrawn' ? 'Withdrew' : 'Updated') + ' loss ' + (d.no || '') + ': ' + what, { ref: d.no, reason: [why, a.decisionNote].filter(Boolean).join(' · ') });
      else if (a) push('Edited loss ' + (d.no || '') + ': ' + what, { ref: d.no, reason: why });
      return out;
    }
    if (col === 'transfers') {
      const d = a || b; const what = (d.lines || []).map((l) => n(l.qty) + ' × ' + L.product(l.productId)).join(', '); const route = L.loc(d.from) + ' → ' + L.loc(d.to);
      if (!b) push('Sent ' + what + ' ' + route + (d.carrier ? ', carried by ' + d.carrier : ''), { ref: d.no, reason: d.reason || '' });
      else if (a && b.status !== a.status && a.status === 'received') { const short = (a.lines || []).reduce((s, l) => s + Math.max(0, n(l.qty) - n(l.receivedQty ?? l.qty)), 0); push('Received transfer ' + (d.no || '') + ' ' + route + (short ? ' — ' + short + ' unit(s) missing' : ' in full'), { ref: d.no, reason: a.receiveNote || '' }); }
      else if (a && a.status === 'cancelled' && b.status !== 'cancelled') push('Cancelled transfer ' + (d.no || '') + ' ' + route, { ref: d.no });
      else push('Updated transfer ' + (d.no || '') + ' ' + route, { ref: d.no });
      return out;
    }
    if (col === 'lots') {
      const d = a || b; const it = L.product(d.productId); const price = L.money ? L.money(d.unitCost, d.currency || 'USD') : d.unitCost;
      if (!b) push('Purchased ' + n(d.qty) + ' × ' + it + ' at ' + (d.vendor || d.sourceType || 'store') + ' — ' + price + ' each' + (d.reservedFor ? ' (for ' + L.customer(d.reservedFor) + ')' : ''), { ref: d.poNumber || '' });
      else if (!a) push('Deleted purchase line ' + n(b.qty) + ' × ' + it);
      else {
        const ch = []; if (n(b.qty) !== n(a.qty)) ch.push('qty ' + n(b.qty) + ' → ' + n(a.qty)); if (n(b.unitCost) !== n(a.unitCost)) ch.push('price ' + n(b.unitCost) + ' → ' + n(a.unitCost));
        if ((b.shipmentId || '') !== (a.shipmentId || '')) ch.push(a.shipmentId ? 'put in ' + L.ship(a.shipmentId) : 'taken out of ' + L.ship(b.shipmentId));
        if (n(b.recvMissing) !== n(a.recvMissing)) ch.push(n(a.recvMissing) + ' missing on arrival'); if (n(b.recvDamaged) !== n(a.recvDamaged)) ch.push(n(a.recvDamaged) + ' damaged on arrival');
        push('Purchase of ' + it + ': ' + (ch.join(', ') || 'edited'));
      }
      return out;
    }
    if (col === 'products') {
      const d = a || b; if (!b) { push('New item: ' + d.name + (d.category ? ' (' + d.category + ')' : '')); return out; } if (!a) { push('Deleted item ' + b.name); return out; }
      const ch = []; [['priceMax', 'price'], ['priceMin', 'minimum price'], ['priceWholesale', 'wholesale price'], ['markup', 'markup %'], ['bulkQty', 'bulk qty']].forEach(([k, l]) => { if ((b[k] ?? '') !== (a[k] ?? '')) ch.push(l + ' ' + (b[k] ?? 'auto') + ' → ' + (a[k] ?? 'auto')); });
      if (b.name !== a.name) ch.push('renamed from "' + b.name + '"'); if ((b.image || '') !== (a.image || '')) ch.push('photo ' + (a.image ? 'changed' : 'removed')); if (!b.archived && a.archived) ch.push('archived'); if ((b.barcode || '') !== (a.barcode || '')) ch.push('barcode ' + (a.barcode || 'removed'));
      push('Item ' + a.name + ': ' + (ch.join(', ') || 'details edited')); return out;
    }
    if (col === 'shipments') {
      const d = a || b; const nm = d.name || d.containerNo || 'container';
      if (!b) { push('Created ' + nm + (d.containerNo ? ' (' + d.containerNo + ')' : '')); return out; } if (!a) { push('Deleted ' + nm); return out; }
      if (b.status !== a.status) push(nm + ' moved to ' + ((SHIP_STATUSES.find((x) => x[0] === a.status) || [0, a.status])[1]) + (a.status === 'received' ? ' at ' + L.loc(a.locationId) : ''));
      const cb = new Map((b.costs || []).map((c) => [c.id, c])), ca = new Map((a.costs || []).map((c) => [c.id, c]));
      ca.forEach((c, id) => { const old = cb.get(id); const amt = L.money ? L.money(c.amount, c.currency) : c.amount; if (!old) push('Added cost to ' + nm + ': ' + c.category + ' ' + amt + (c.paidTo ? ' (paid to ' + c.paidTo + ')' : ''), { reason: c.label || '' }); else if (n(old.amount) !== n(c.amount) || old.currency !== c.currency) push('Changed cost on ' + nm + ': ' + c.category + ' ' + (L.money ? L.money(old.amount, old.currency) : old.amount) + ' → ' + amt); });
      cb.forEach((c, id) => { if (!ca.has(id)) push('Removed cost from ' + nm + ': ' + c.category + ' ' + (L.money ? L.money(c.amount, c.currency) : c.amount)); });
      if (!out.length) push(nm + ' details edited'); return out;
    }
    if (col === 'customers') { const d = a || b; if (!b) push('New customer ' + d.name + (d.phone ? ' (' + d.phone + ')' : '')); else if (!a) push('Deleted customer ' + b.name); else { const ch = []; if ((b.creditLimit ?? '') !== (a.creditLimit ?? '')) ch.push('credit limit ' + (b.creditLimit ?? 'default') + ' → ' + (a.creditLimit ?? 'default')); if (b.phone !== a.phone) ch.push('phone ' + (b.phone || '—') + ' → ' + (a.phone || '—')); if (b.type !== a.type) ch.push('type ' + (b.type || 'Retail') + ' → ' + a.type); if (b.name !== a.name) ch.push('renamed from ' + b.name); if (ch.length) push('Customer ' + a.name + ': ' + ch.join(', ')); } return out; }
    if (col === 'handovers') { const d = a || b; const tot = Object.values(d.declared || {}).reduce((s, v) => s + n(v), 0) + n(d.payouts); if (a && a.status === 'confirmed' && (!b || b.status !== 'confirmed')) push('Confirmed cash handover of ' + (d.userName || 'staff') + ' for ' + d.date + ' — ' + F(tot) + (Math.abs(n(d.diff)) >= 1 ? (n(d.diff) < 0 ? ', short ' + F(-n(d.diff)) : ', over ' + F(n(d.diff))) : ', balanced'), { amount: tot }); else if (a) push('Handed over ' + F(tot) + ' for ' + d.date + (Math.abs(n(d.diff)) >= 1 ? (n(d.diff) < 0 ? ' — short ' + F(-n(d.diff)) : ' — over ' + F(n(d.diff))) : ' — balanced'), { amount: tot, reason: [d.payoutNote && 'paid out: ' + d.payoutNote, d.notes].filter(Boolean).join(' · ') }); return out; }
    if (col === 'bills') { const d = a || b; const sup = L.supplier ? L.supplier(d.supplierId) : ''; const m = (v) => (L.money ? L.money(v, d.currency) : v); if (!b) push('New bill from ' + sup + ': ' + m(d.amount) + (d.description ? ' — ' + d.description : '')); else if (a) { const pb = (b.payments || []).length; (a.payments || []).slice(pb).forEach((p) => push('Paid ' + m(p.amount) + ' to ' + sup + ' by ' + (p.method || '') + (p.ref ? ' (txn ' + p.ref + ')' : '') + (n(p.fee) > 0 ? ' + ' + m(n(p.fee)) + ' charges' : ''), { reason: d.description || '', ref: p.ref || billTxnId(d) })); if (a.status === 'cancelled' && b.status !== 'cancelled') push('Cancelled bill from ' + sup); if (!out.length) push('Edited bill from ' + sup); } else push('Deleted bill from ' + sup); return out; }
    if (col === 'audits') { const d = a || b; if (!b) push('Started a stock count at ' + L.loc(d.locationId) + (d.category ? ' (' + d.category + ')' : '')); else if (a && a.status === 'submitted' && b.status === 'draft') push('Finished stock count at ' + L.loc(d.locationId) + ': ' + (a.lines || []).length + ' item(s), ' + (a.lines || []).filter((l) => n(l.counted) !== n(l.system)).length + ' with a difference'); else if (a && a.status === 'applied' && b.status !== 'applied') push('Approved stock count at ' + L.loc(d.locationId) + ' — stock corrected'); return out; }
    if (col === 'expenses') { const d = a || b; push((b ? (a ? 'Edited' : 'Deleted') : 'Recorded') + ' expense: ' + d.category + ' ' + F(n(d.amount)), { reason: d.description || '', amount: n(d.amount) }); return out; }
    if (col === 'members') { const d = a || b; if (!b) push('Gave ' + d.name + ' access as ' + ((L.role && L.role(d.role)) || (ROLES[d.role] || { label: d.role }).label)); else if (!a) push('Removed ' + b.name + ' from the team'); else { const ch = []; if (b.role !== a.role) ch.push('role ' + ((L.role && L.role(b.role)) || b.role) + ' → ' + ((L.role && L.role(a.role)) || a.role)); if (JSON.stringify(b.perms || {}) !== JSON.stringify(a.perms || {})) ch.push('permissions changed'); if (b.active !== a.active) ch.push(a.active === false ? 'disabled' : 'enabled'); if ((b.locationId || '') !== (a.locationId || '')) ch.push('branch → ' + L.loc(a.locationId)); push('Team: ' + a.name + ' — ' + (ch.join(', ') || 'edited')); } return out; }
    if (col === 'settings') { const keys = Object.keys(Object.assign({}, b || {}, a || {})).filter((k) => !['updatedAt', 'createdAt', 'lastBackup', 'id', 'ownerId', 'ownerName'].includes(k) && JSON.stringify((b || {})[k]) !== JSON.stringify((a || {})[k])); if (keys.length) push('Changed settings: ' + keys.join(', ')); return out; }
    if (col === 'locations') { const d = a || b; push((b ? 'Edited' : 'Added') + ' branch ' + d.name + (a && a.archived ? ' (archived)' : '')); return out; }
    if (col === 'suppliers') { const d = a || b; if (!b) push('New supplier ' + d.name); return out; }
    if (col === 'reminders') { const d = a || b; if (!b) push('Sent payment reminder to ' + L.customer(d.customerId) + ' by ' + (d.channel || '') + ' — owes ' + F(n(d.balance)) + (d.status === 'failed' ? ' (FAILED: ' + d.error + ')' : '')); return out; }
    if (col === 'assets') {
      const d = a || b; const nm = d.name || 'asset'; const st = (k) => (ASSET_STATUSES.find((x) => x[0] === k) || [0, k || 'In use'])[1];
      const price = (x) => (L.money ? L.money(num(x.price), x.currency || '') : num(x.price)) + (num(x.extraCosts) ? ' + ' + F(num(x.extraCosts)) + ' extra costs' : '');
      if (!b) { push('Registered asset ' + nm + (d.tag ? ' (' + d.tag + ')' : '') + ' — bought for ' + price(d) + (d.vendor ? ' from ' + d.vendor : '') + ', at ' + L.loc(d.locationId), { ref: d.tag || '' }); return out; }
      if (!a) { push('Deleted asset ' + nm, { ref: b.tag || '', reason: b.deleteReason || '' }); return out; }
      const ref = a.tag || '';
      if (!ASSET_GONE.includes(b.status) && ASSET_GONE.includes(a.status)) { const x = a.disposal || {}; push((a.status === 'sold' ? 'Sold asset ' + nm + (x.buyer ? ' to ' + x.buyer : '') + ' for ' + F(num(x.amount)) : 'Wrote off asset ' + nm + ' — ' + st(a.status)) + (x.bookValue !== undefined ? ' (value in books ' + F(num(x.bookValue)) + ', ' + (num(x.amount) - num(x.bookValue) >= 0 ? 'gain ' : 'loss ') + F(Math.abs(num(x.amount) - num(x.bookValue))) + ')' : ''), { ref, reason: x.reason || '', amount: num(x.amount) }); return out; }
      if (ASSET_GONE.includes(b.status) && !ASSET_GONE.includes(a.status)) { push('Put asset ' + nm + ' back in use (reversed ' + st(b.status).toLowerCase() + ')', { ref, reason: a.reverseReason || '' }); return out; }
      if ((b.locationId || 'main') !== (a.locationId || 'main')) push('Moved asset ' + nm + ': ' + L.loc(b.locationId) + ' → ' + L.loc(a.locationId), { ref, reason: a.lastMoveNote || '' });
      if ((b.assignedTo || '') !== (a.assignedTo || '')) push('Asset ' + nm + ' now with ' + (a.assignedTo || 'nobody') + (b.assignedTo ? ' (was ' + b.assignedTo + ')' : ''), { ref, reason: a.lastMoveNote || '' });
      if ((b.status || 'in_use') !== (a.status || 'in_use')) push('Asset ' + nm + ': ' + st(b.status) + ' → ' + st(a.status), { ref, reason: a.lastMoveNote || '' });
      const ch = []; if (num(b.price) !== num(a.price) || (b.currency || '') !== (a.currency || '') || num(b.extraCosts) !== num(a.extraCosts)) ch.push('cost ' + price(b) + ' → ' + price(a));
      if ((b.depMethod || '') !== (a.depMethod || '') || num(b.usefulLife) !== num(a.usefulLife) || num(b.residualValue) !== num(a.residualValue)) ch.push('depreciation ' + (a.depMethod === 'none' ? 'off' : num(a.usefulLife) + ' yrs, ' + (a.depMethod || 'straight')));
      if (b.name !== a.name) ch.push('renamed from "' + b.name + '"'); if ((b.image || '') !== (a.image || '')) ch.push('photo ' + (a.image ? 'changed' : 'removed'));
      [['nextServiceDate', 'next service'], ['insuranceUntil', 'insurance until'], ['registrationUntil', 'papers until'], ['warrantyUntil', 'warranty until']].forEach(([k, l]) => { if ((b[k] || '') !== (a[k] || '')) ch.push(l + ' ' + (a[k] || 'removed')); });
      if (ch.length) push('Asset ' + nm + ': ' + ch.join(', '), { ref }); else if (!out.length) push('Asset ' + nm + ' details edited', { ref });
      return out;
    }
    if (col === 'attendance') {
      const d = a || b; const who = d.staffName || 'Staff'; const tm = (iso) => { const x = new Date(iso); return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); };
      if (!a) { push('Deleted the times of ' + who + ' on ' + d.date); return out; }
      const before = (b && b.events) || [], after = a.events || [];
      const added = after.length >= before.length && before.every((e, i) => JSON.stringify(e) === JSON.stringify(after[i])) ? after.slice(before.length) : null;
      if (added && !a.editedAt) added.forEach((e) => push(who + ': ' + (CLOCK[e.t] || e.t).toLowerCase() + ' at ' + tm(e.at)));
      else push('Corrected the times of ' + who + ' on ' + d.date + ': ' + after.map((e) => (CLOCK[e.t] || e.t) + ' ' + tm(e.at)).join(', '), { reason: a.note || '' });
      return out;
    }
    if (col === 'leaves') {
      const d = a || b; const lbl = (LEAVE_TYPES.find((x) => x[0] === d.type) || [0, 'leave'])[1].toLowerCase(); const when = d.from + (d.to && d.to !== d.from ? ' to ' + d.to : '');
      if (!a) push('Deleted ' + lbl + ' of ' + d.staffName + ' (' + when + ')');
      else if (!b) push((a.status === 'requested' ? d.staffName + ' asked for ' : 'Recorded ' ) + lbl + (a.status === 'requested' ? '' : ' for ' + d.staffName) + ': ' + when, { reason: a.reason || '' });
      else if (b.status !== a.status) push({ approved: 'Approved ', rejected: 'Declined ', cancelled: 'Cancelled ' }[a.status] + lbl + ' of ' + d.staffName + ' (' + when + ')');
      else push('Changed ' + lbl + ' of ' + d.staffName + ': ' + when);
      return out;
    }
    if (col === 'staff') { const d = a || b; push(!a ? 'Removed the file of ' + d.name : !b ? 'Added employee ' + a.name : (b.pay && a.pay && (num(b.pay.rate) !== num(a.pay.rate) || b.pay.type !== a.pay.type) ? 'Changed the pay of ' + a.name + ': ' + F(num(b.pay.rate)) + ' → ' + F(num(a.pay.rate)) + ' (' + a.pay.type + ')' : (b.active !== false && a.active === false ? a.name + ' left the business' : 'Updated the file of ' + a.name))); return out; }
    if (col === 'payroll') {
      const d = a || b;
      if (d.type === 'advance') { push(!b ? 'Gave a salary advance of ' + F(num(d.amount)) + ' to ' + d.staffName : a && a.status === 'cancelled' ? 'Cancelled the advance of ' + F(num(d.amount)) + ' to ' + d.staffName : 'Changed the advance of ' + d.staffName, { amount: num(d.amount), reason: d.note || '' }); return out; }
      if (a && a.status === 'paid' && (!b || b.status !== 'paid')) push('Paid ' + d.staffName + ' ' + F(num(a.net)) + ' for ' + d.month, { amount: num(a.net) });
      else if (b && b.status === 'paid' && a && a.status !== 'paid') push('Undid the salary payment of ' + d.staffName + ' for ' + d.month);
      else if (a) push('Saved the payslip draft of ' + d.staffName + ' for ' + d.month + ' — net ' + F(num(a.net)));
      return out;
    }
    if (col === 'tills') {
      const d = a || b; const sum = (o) => Object.values(o || {}).reduce((x, v) => x + num(v), 0);
      if (a && !b) push(d.fromName + ' handed the till to ' + d.toName + ' — counted ' + F(sum(a.counted)), { amount: sum(a.counted), reason: a.note || '' });
      else if (a && b && b.status === 'pending' && ['accepted', 'disputed'].includes(a.status)) push(d.toName + ' accepted the till from ' + d.fromName + ' — counted ' + F(sum(a.received)) + (a.status === 'disputed' ? ' (' + F(Math.abs(sum(a.received) - sum(a.counted))) + (sum(a.received) < sum(a.counted) ? ' less' : ' more') + ' than handed over)' : ''), { amount: sum(a.received), reason: a.receiveNote || '' });
      else if (a && a.status === 'cancelled') push(d.fromName + ' cancelled handing the till to ' + d.toName);
      else if (a && a.status === 'reviewed') push('Checked the till difference between ' + d.fromName + ' and ' + d.toName, { reason: a.reviewNote || '' });
      return out;
    }
    return out;
  }

  /* ---------------- business assets (things the business owns and uses, not for sale) ---------------- */
  const ASSET_CATS = ['Vehicles', 'Warehouse equipment', 'Tanks & storage', 'Generators & power', 'Computers & phones', 'Furniture & fittings', 'Tools & machines', 'Buildings', 'Land', 'Other'];
  const ASSET_LIFE = { Vehicles: 5, 'Warehouse equipment': 7, 'Tanks & storage': 10, 'Generators & power': 5, 'Computers & phones': 3, 'Furniture & fittings': 5, 'Tools & machines': 5, Buildings: 20, Land: 0, Other: 5 };
  const ASSET_STATUSES = [['in_use', 'In use'], ['idle', 'Not in use / stored'], ['repair', 'Under repair'], ['sold', 'Sold'], ['scrapped', 'Scrapped / thrown away'], ['stolen', 'Stolen / lost'], ['donated', 'Given away']];
  const ASSET_GONE = ['sold', 'scrapped', 'stolen', 'donated'];
  const DEP_METHODS = [['straight', 'Straight line — same amount each month'], ['declining', 'Declining — loses more in the first years'], ['none', 'None — keeps its value (land)']];
  /** Full cost in base currency: price × exchange rate + extra costs (shipping, customs, installation…). */
  function assetCost(a, S) { const base = S.currency || 'XAF'; const cur = a.currency || base; const r = cur === base ? 1 : (num(a.fxRate) || rateOf(S, cur)); return num(a.price) * r + num(a.extraCosts); }
  function assetStart(a) { return a.inServiceDate || a.purchaseDate || (a.createdAt || '').slice(0, 10); }
  function assetLife(a) { const v = a.usefulLife; return v === undefined || v === null || v === '' ? (ASSET_LIFE[a.category] ?? 5) : num(v); }
  function assetMethod(a) { return a.depMethod || (assetLife(a) > 0 ? 'straight' : 'none'); }
  /** Months of use from the start date to d. The first month counts only the days after the start; every later month counts as exactly 1 (so monthly charges are equal). */
  function assetMonths(start, d) {
    const [y0, m0, d0] = start.split('-').map(Number); const [y, m, dd] = d.split('-').map(Number);
    const dim0 = new Date(y0, m0, 0).getDate(); const dim = new Date(y, m, 0).getDate();
    if (y === y0 && m === m0) return Math.max(0, dd - d0) / dim0;
    return (dim0 - d0) / dim0 + ((y - y0) * 12 + (m - m0) - 1) + dd / dim;
  }
  /** Value in the books on date d (before any disposal). */
  function assetBookOn(a, S, d) {
    const cost = assetCost(a, S); const res = Math.max(0, Math.min(cost, num(a.residualValue))); const start = assetStart(a); const L = assetLife(a); const m = assetMethod(a);
    if (!start || !d || d < start || m === 'none' || L <= 0) return cost;
    const yrs = assetMonths(start, d) / 12;
    if (m === 'declining') { const r = Math.min(0.95, 2 / L); return Math.max(res, cost * Math.pow(1 - r, yrs)); }
    return Math.max(res, cost - (cost - res) * Math.min(1, yrs / L));
  }
  const assetGone = (a) => ASSET_GONE.includes(a.status);
  const assetDisposalDate = (a) => (assetGone(a) && a.disposal && a.disposal.date) || null;
  /** Everything about an asset's value on date asOf. */
  function assetValue(a, S, asOf) {
    const cost = assetCost(a, S); const start = assetStart(a); const dd = assetDisposalDate(a); const gone = !!(dd && dd <= asOf);
    const end = gone ? dd : asOf; const book = assetBookOn(a, S, end);
    const proceeds = gone ? num((a.disposal || {}).amount) : 0;
    const monthly = (() => { const m = assetMethod(a), L = assetLife(a); if (gone || m === 'none' || L <= 0) return 0; const res = Math.max(0, num(a.residualValue)); if (book <= res + 0.5) return 0; return m === 'declining' ? book * (1 - Math.pow(1 - Math.min(0.95, 2 / L), 1 / 12)) : Math.min(book - res, (cost - res) / (L * 12)); })();
    return { cost, start, owned: !start || start <= asOf, gone, book: gone ? 0 : book, bookAtDisposal: gone ? book : null, accumulated: cost - book, proceeds, gain: gone ? proceeds - book : 0, monthly, fullyDepreciated: assetMethod(a) !== 'none' && book <= Math.max(0, num(a.residualValue)) + 0.5 && cost > 0 };
  }
  /** Depreciation charged between two dates (inclusive), stopping at disposal. */
  function assetDepreciation(a, S, from, to) {
    const start = assetStart(a); const dd = assetDisposalDate(a); const end = dd && dd < to ? dd : to; const before = addDays(from, -1);
    if (!start || end < from || end <= start) return 0;
    const b0 = before < start ? assetCost(a, S) : assetBookOn(a, S, before); const b1 = assetBookOn(a, S, end); return Math.max(0, b0 - b1);
  }
  /** Totals for a set of assets: in use, cost, book value, depreciation and gains in [from, to]. */
  function assetTotals(list, S, from, to) {
    const t = { count: 0, cost: 0, book: 0, depreciation: 0, gain: 0, disposed: 0, proceeds: 0 };
    (list || []).forEach((a) => { const v = assetValue(a, S, to); if (!v.owned) return; t.depreciation += assetDepreciation(a, S, from, to); const dd = assetDisposalDate(a);
      if (dd && dd >= from && dd <= to) { t.gain += v.gain; t.disposed++; t.proceeds += v.proceeds; }
      if (!v.gone) { t.count++; t.cost += v.cost; t.book += v.book; } });
    return t;
  }
  /** Basic checks for a saved asset (used by the server). Returns an error message or ''. */
  function assetCheck(a) {
    if (!a || !String(a.name || '').trim()) return 'Asset name is required';
    for (const k of ['price', 'extraCosts', 'residualValue', 'usefulLife', 'fxRate']) if (a[k] !== undefined && a[k] !== '' && a[k] !== null && !(Number(a[k]) >= 0)) return 'Invalid ' + k;
    if (num(a.usefulLife) > 100) return 'Useful life is too long';
    if (a.status && !ASSET_STATUSES.some((x) => x[0] === a.status)) return 'Unknown asset status';
    if (ASSET_GONE.includes(a.status)) { const d = a.disposal || {}; if (!d.date) return 'Disposal date is required'; if (!String(d.reason || '').trim()) return 'A reason is required to sell or write off an asset'; if (a.purchaseDate && d.date < a.purchaseDate) return 'Disposal date is before the purchase date'; if (!(num(d.amount) >= 0)) return 'Invalid sale amount'; }
    return '';
  }
  /** Year-end book values from purchase until fully depreciated (max 25 rows). */
  function assetSchedule(a, S) {
    const start = assetStart(a); if (!start) return []; const rows = []; const y0 = +start.slice(0, 4); let prev = assetCost(a, S);
    for (let y = y0; y < y0 + 25; y++) { const end = y + '-12-31'; const dd = assetDisposalDate(a); const e = dd && dd < end ? dd : end; const b = assetBookOn(a, S, e); rows.push({ year: y, depreciation: Math.max(0, prev - b), book: b }); prev = b; if ((dd && dd <= end) || b <= Math.max(0, num(a.residualValue)) + 0.5 || assetMethod(a) === 'none') break; }
    return rows;
  }

  /** What a customer owes across open sales. */
  function customerBalance(raw, C, customerId) { return (raw.sales || []).reduce((a, s) => { const x = C.saleX[s.id]; return a + (s.customerId === customerId && x && x.status !== 'cancelled' ? Math.max(0, x.balance) : 0); }, 0); }
  function creditLimitOf(S, c) { if (!c) return null; const v = c.creditLimit; if (v !== undefined && v !== null && v !== '') return num(v); const d = S.defaultCreditLimit; return d !== undefined && d !== null && d !== '' ? num(d) : null; }

  return { ASSET_CATS, ASSET_LIFE, ASSET_STATUSES, ASSET_GONE, DEP_METHODS, assetCost, assetStart, assetLife, assetMethod, assetBookOn, assetValue, assetDepreciation, assetTotals, assetSchedule, assetGone, assetCheck,
    PACK_NAMES, packsOf, packText, lineQtyText, LOSS_CAUSES, lossCause, lossCauseOf, lossCheck, ACT_TYPES, describeChange, rolesWith, rateOf, RETURN_REASONS, TRANSFER_REASONS, CURRENCIES, validateTransfer, isWholesale, autoPrice, priceFloor, collectedBy, billTotals, dueDateOf, lotCap, customerBalance, creditLimitOf, num, roundTo, DEFAULT_SETTINGS, DEFAULT_MOMO_FEE_TABLES, CATEGORIES, SOURCE_TYPES, EXPENSE_STAGES, EXPENSE_PHASES, expenseStage, allocTax, sellingPrices, PROMO_TYPES, promoStatus, promoActive, promoCovers, promoPriceOf, localDay, currencySymbolOf, shipPhase, CONDITIONS, WORKING, DELIVERY_MODES, OUR_DELIVERY, DELIVERY_PAY_WHEN, deliveryRule, handOverBlock, DELIVERY_PAYERS, DELIVERY_STATUSES, deliveryModeLabel, isDelivery, deliveryFeeDue, cleanDelivery, shopCatalog, FEATURES, FEATURE_KEYS, EDITIONS, EDITION_KEYS, editionOf, editionHas, featuresOf, featureOn, anyOn, PERM_FEATURE, permFeatureOn, ROUTE_FEATURE, routeFeatureOn, COLLECTION_FEATURE, HIDDEN_WHEN_OFF, permsWithFeatures, staffIdOf, PAY_TYPES, LEAVE_TYPES, LEAVE_STATUS, CLOCK, STAFF_DEFAULTS, staffRules, dayState, clockNext, leaveDates, leavePaid, leaveBalance, leaveOverlaps, staffMonth, payslipDraft, tillMoves, monthDays, datesBetween, shopSlugify, shopSlugError, SHOP_SLUG_RE, publicItem, validateShopOrder, PAY_METHODS, SALE_PAY_METHODS, PURCHASE_PAY_METHODS, newTxnId, isMobileMoney, calcMomoFee, validatePayment, saleTxnId, billTxnId, paymentFees, SHIP_STATUSES, COST_CATEGORIES, ADJ_REASONS, EXPENSE_CATS, saleTotals, computeAll, allocate, validateSale,
    PERMS, ROLES, permsFor, SELL_UNITS, SIZE_UNITS, convertSize, sizeLabel, saleFacts, groupBy, summarize, inventoryHealth, projections, addDays, daysBetween };
});
