/* Kargo — shared business logic (runs in the browser AND on the Node server).
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

  const DEFAULT_SETTINGS = {
    businessName: 'My Business', tagline: '', phone: '', whatsapp: '', address: 'Douala, Cameroon', logo: '',
    fxRate: 600, currency: 'XAF', currencySymbol: 'F', fxRates: { USD: 600, EUR: 655.957 }, defaultMarkup: 100, minMarkup: 50, roundTo: 50, lowStock: 3, expiryWarnDays: 60,
    staffSeeCosts: false, wholesaleMarkup: 60, bulkQty: 0, creditDays: 14,
    reminderTemplate: 'Hello {name}, this is a friendly reminder from {business}. Your balance is {balance} (due {due}). You can pay by Cash or Mobile Money: {momo}. Thank you!',
    reminderEvery: 7, receiptFooter: 'Thank you for your business! Goods sold in good condition.',
    momoAccounts: [], // [{label, method, number}]
    categories: CATEGORIES,
    vendors: ['Costco', 'Walmart', "Sam's Club", 'B-Stock', 'Target', 'Amazon', 'BJ\'s'],
  };

  const SOURCE_TYPES = ['Store', 'Auction', 'Online', 'Private seller', 'Local (Cameroon)'];
  const CONDITIONS = ['New', 'Open box', 'Used', 'Refurbished', 'Damaged / Parts'];
  const PAY_METHODS = ['Cash', 'MTN MoMo', 'Orange Money', 'Bank transfer', 'Other'];
  const SHIP_STATUSES = [
    ['planning', 'Planning'], ['loading', 'Loading (US)'], ['in_transit', 'At sea'], ['at_port', 'At port Douala'],
    ['cleared', 'Cleared customs'], ['received', 'In warehouse'], ['closed', 'Closed'],
  ];
  const COST_CATEGORIES = [
    ['US', 'Ocean freight'], ['US', 'Trucking / drayage'], ['US', 'Loading labor'], ['US', 'BESC (cargo tracking note)'],
    ['US', 'Packing materials'], ['US', 'Other US cost'],
    ['CM', 'Customs duties – goods'], ['CM', 'Customs duties – vehicles'], ['CM', 'Clearing agent fee'], ['CM', 'Port storage'],
    ['CM', 'Demurrage'], ['CM', 'Transport to warehouse'], ['CM', 'Unloading labor'], ['CM', 'Other Cameroon cost'],
  ];
  const ADJ_REASONS = ['Missing / theft', 'Unaccounted for', 'Damaged', 'Expired', 'Missing in transfer', 'Stock count difference', 'Count correction', 'Found / extra', 'Own use / gift'];
  const RETURN_REASONS = ['Damaged / defective', 'Expired', 'Wrong item given', 'Customer changed mind', 'Not as described', 'Other'];
  const TRANSFER_REASONS = ['Restock a branch', 'Customer order at another branch', 'Return to main warehouse', 'Rebalance slow stock', 'Other'];
  const CURRENCIES = [['XAF', 'F', 'Central African CFA franc (Cameroon, Gabon, Congo, Chad, CAR, Eq. Guinea)'], ['XOF', 'F', 'West African CFA franc (Senegal, Côte d\'Ivoire, Mali, Burkina, Benin, Togo, Niger)'], ['NGN', '₦', 'Nigerian naira'], ['GHS', 'GH₵', 'Ghanaian cedi'], ['RWF', 'RF', 'Rwandan franc'], ['GNF', 'FG', 'Guinean franc'], ['KES', 'KSh', 'Kenyan shilling'], ['UGX', 'USh', 'Ugandan shilling'], ['TZS', 'TSh', 'Tanzanian shilling'], ['ZAR', 'R', 'South African rand'], ['CDF', 'FC', 'Congolese franc'], ['USD', '$', 'US dollar'], ['EUR', '€', 'Euro'], ['GBP', '£', 'British pound'], ['CAD', 'C$', 'Canadian dollar'], ['CNY', '¥', 'Chinese yuan'], ['AED', 'AED', 'UAE dirham']];
  const EXPENSE_CATS = ['Warehouse rent', 'Salaries & wages', 'Local transport', 'Electricity & water', 'Phone & internet', 'Marketing', 'Taxes & licences', 'MoMo / bank fees', 'Security', 'Repairs & maintenance', 'Fuel', 'Insurance', 'Other'];

  /** Sale totals that don't depend on cost. */
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
    const balance = Math.round(net - paid);
    let status = s.status === 'cancelled' ? 'cancelled' : balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    return { subtotal, discount, total, factor, returned, net, paid, balance, status };
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
      let stage;
      if (sh) stage = sh.status === 'received' || sh.status === 'closed' ? 'warehouse' : 'transit';
      else stage = l.sourceType === 'Local (Cameroon)' || l.inWarehouse ? 'warehouse' : 'us';
      const received = Math.max(0, num(l.qty) - num(l.recvMissing) - num(l.recvDamaged));
      const home = l.locationId || (sh && sh.locationId) || 'main';
      lotX[l.id] = { unitX, regX, fx, stage, received, home, locDelta: {}, alloc: 0, out: 0, adj: 0, sold: 0, revenue: 0, cogs: 0 };
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
      const goodsX = ls.reduce((a, l) => a + val(l), 0);
      const regularX = ls.reduce((a, l) => a + lotX[l.id].regX * num(l.qty), 0);
      shipX[sh.id] = { fx, costsX, usX, cmX, unalloc, goodsX, regularX, landedX: goodsX + costsX - unalloc, lotIds: ls.map((l) => l.id),
        units: ls.reduce((a, l) => a + num(l.qty), 0), unitsSold: 0, revenue: 0, cogs: 0, lossX: 0, stockX: 0 };
    });
    lots.forEach((l) => { const x = lotX[l.id], q = num(l.qty); x.landedUnit = x.unitX + (q > 0 ? x.alloc / q : 0); });

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
      px.markup = p.markup !== undefined && p.markup !== null && p.markup !== '' ? num(p.markup) : num(S.defaultMarkup);
      const mn = p.minMarkup !== undefined && p.minMarkup !== null && p.minMarkup !== '' ? num(p.minMarkup) : num(S.minMarkup);
      px.priceMax = num(p.priceMax) > 0 ? num(p.priceMax) : roundTo(px.avgCost * (1 + px.markup / 100), S.roundTo);
      px.priceMin = num(p.priceMin) > 0 ? num(p.priceMin) : Math.min(px.priceMax, roundTo(px.avgCost * (1 + mn / 100), S.roundTo));
      px.priceManual = num(p.priceMax) > 0;
      const wm = p.wholesaleMarkup !== undefined && p.wholesaleMarkup !== null && p.wholesaleMarkup !== '' ? num(p.wholesaleMarkup) : num(S.wholesaleMarkup);
      px.priceWholesale = num(p.priceWholesale) > 0 ? num(p.priceWholesale) : Math.min(px.priceMax, roundTo(px.avgCost * (1 + wm / 100), S.roundTo));
      px.bulkQty = num(p.bulkQty) || num(S.bulkQty) || 0;
      px.stockValue = px.available * px.avgCost;
      px.retailValue = px.available * px.priceMax;
      px.profit = px.revenue - px.cogs;
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
    ['customers', 'Add & edit customers', 'Sales'], ['credit', 'Sell beyond a customer\'s credit limit', 'Sales'], ['reminders', 'Send payment reminders to customers', 'Sales'],
    ['stockView', 'See stock list', 'Stock'], ['stockEdit', 'Adjust stock, set prices, photos & labels', 'Stock'],
    ['purchases', 'Record purchases', 'Stock'], ['containers', 'Containers & shipping costs', 'Stock'], ['transfers', 'Move stock between branches', 'Stock'], ['audit', 'Do stock counts (inventory audit)', 'Stock'], ['allLocations', 'Work at all locations (off = only their own)', 'Stock'],
    ['costs', 'See costs, margins & profit', 'Money'], ['reports', 'See reports & analytics', 'Money'], ['expenses', 'Record expenses', 'Money'], ['handover', 'Confirm staff cash handovers', 'Money'], ['suppliers', 'Suppliers & bills to pay', 'Money'], ['assets', 'Business assets (equipment, vehicles…)', 'Money'],
    ['export', 'Download Excel & backups', 'Admin'], ['activity', 'See the activity log (who did what)', 'Admin'], ['settings', 'Change business settings', 'Admin'], ['team', 'Manage team & permissions', 'Admin'],
  ];
  const ALL = PERMS.map((p) => p[0]);
  const ROLES = {
    owner: { label: 'Owner', perms: ALL },
    admin: { label: 'Admin', perms: ALL },
    manager: { label: 'Manager', perms: ALL.filter((p) => !['team', 'settings'].includes(p)) },
    sales: { label: 'Sales rep', perms: ['sell', 'payments', 'returns', 'customers', 'stockView'] },
    viewer: { label: 'Viewer (read only)', perms: ['stockView', 'reports', 'salesAll', 'allLocations'] },
  };
  /** member: {role, perms:{perm: true|false overrides}, active} → {perm: bool} */
  /** Role list with the business's own edits (settings.roles) applied. Owner can never be restricted. */
  function rolesWith(custom) {
    const out = {}; Object.entries(ROLES).forEach(([k, r]) => (out[k] = { label: r.label, perms: r.perms.slice() }));
    Object.entries(custom || {}).forEach(([k, r]) => { if (k === 'owner' || !r) return; out[k] = { label: r.label || (out[k] || {}).label || k, perms: Array.isArray(r.perms) ? r.perms.filter((p) => ALL.includes(p)) : (out[k] || { perms: [] }).perms, custom: !ROLES[k] }; });
    return out;
  }
  function permsFor(member, customRoles) {
    const out = {}; ALL.forEach((p) => (out[p] = false));
    if (!member || member.active === false) return out;
    if (member.role === 'owner') { ALL.forEach((p) => (out[p] = true)); return out; }
    const R = rolesWith(customRoles);
    const r = R[member.role] || R.sales;
    r.perms.forEach((p) => (out[p] = true));
    if (member.role !== 'owner' && member.perms) Object.keys(member.perms).forEach((p) => { if (p in out) out[p] = !!member.perms[p]; });
    return out;
  }

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
  function autoPrice(C, productId, qty, customer) { const px = C.prodX[productId]; if (!px) return 0; return isWholesale(customer) || (px.bulkQty > 0 && num(qty) >= px.bulkQty) ? px.priceWholesale : px.priceMax; }
  function priceFloor(C, productId, qty, customer) { const px = C.prodX[productId]; if (!px) return 0; const ws = isWholesale(customer) || (px.bulkQty > 0 && num(qty) >= px.bulkQty); return ws ? Math.min(px.priceMin, px.priceWholesale) : px.priceMin; }
  /* cash handover: what a person collected on a day, by method */
  function collectedBy(raw, userId, date) {
    const by = {}; let total = 0; const items = [];
    (raw.sales || []).forEach((s) => (s.payments || []).forEach((p) => { if (p.byId === userId && p.date === date) { by[p.method] = (by[p.method] || 0) + num(p.amount); total += num(p.amount); items.push({ saleId: s.id, no: s.no, customer: s.customerName, p }); } }));
    return { by, total, items };
  }
  /* supplier bills */
  function billTotals(b, S) {
    const fx = num(b.fxRate) || rateOf(S || {}, b.currency || 'XAF'); const toX = (v) => num(v) * fx;
    const amount = num(b.amount), paid = (b.payments || []).reduce((a, p) => a + num(p.amount), 0), balance = amount - paid;
    return { amount, paid, balance, amountX: toX(amount), paidX: toX(paid), balanceX: toX(balance), status: balance <= 0.005 ? 'paid' : paid > 0 ? 'partial' : 'unpaid' };
  }
  /* reminders */
  function dueDateOf(s, S) { return s.dueDate || addDays(String(s.date || s.createdAt || '').slice(0, 10), num((S || {}).creditDays) || 14); }


  /* ---------------- activity log: plain-language description of any change ---------------- */
  const ACT_TYPES = { sales: 'Sales', payments: 'Payments', lots: 'Purchases', products: 'Items & prices', shipments: 'Containers', adjustments: 'Stock & losses', transfers: 'Transfers', audits: 'Stock counts', customers: 'Customers', handovers: 'Cash handover', bills: 'Suppliers & bills', suppliers: 'Suppliers & bills', expenses: 'Expenses', settings: 'Settings & team', members: 'Settings & team', locations: 'Settings & team', reminders: 'Reminders', assets: 'Assets' };
  /** L = lookups {product(id), customer(id), loc(id), ship(id), F(amount), money(v,cur)} → [{type, text, reason, amount, ref}] (one change can produce several lines) */
  function describeChange(col, b, a, L) {
    const out = []; const type = ACT_TYPES[col] || col; const push = (text, extra) => out.push(Object.assign({ type, text }, extra || {}));
    const n = (x) => num(x); const F = L.F || ((v) => String(Math.round(v)));
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
        pa.forEach((p, id) => { if (!pb.has(id)) out.push({ type: 'Payments', text: (n(p.amount) < 0 ? 'Refunded ' + F(-n(p.amount)) : 'Received ' + F(n(p.amount))) + ' by ' + (p.method || 'Cash') + (p.account ? ' to ' + p.account : '') + (p.ref ? ' (ref ' + p.ref + ')' : '') + ' — ' + ref + ', ' + cust, ref, amount: n(p.amount), reason: n(p.amount) < 0 ? (p.ref || '') : '' }); });
        pb.forEach((p, id) => { if (!pa.has(id)) out.push({ type: 'Payments', text: 'Deleted a payment of ' + F(n(p.amount)) + ' (' + (p.method || '') + ') from ' + ref, ref, amount: -n(p.amount), reason: a.lastPaymentDeleteReason || '' }); });
        (a.lines || []).forEach((l, i) => { const rb = ((b.lines || [])[i] || {}).returns || []; (l.returns || []).slice(rb.length).forEach((r) => push('Return: ' + n(r.qty) + ' × ' + (l.name || L.product(l.productId)) + ' on ' + ref + (r.restock ? ' — back to stock' : ' — written off'), { ref, reason: [r.reason, r.note].filter(Boolean).join(' · ') })); });
        if (!b.delivered && a.delivered && a.status !== 'cancelled') push('Customer picked up ' + ref, { ref });
        if ((b.customerId || '') !== (a.customerId || '')) push('Changed customer on ' + ref + ': ' + (b.customerName || 'Walk-in') + ' → ' + (a.customerName || 'Walk-in'), { ref });
        if (!out.length) push('Updated sale ' + ref, { ref });
      }
      return out;
    }
    if (col === 'adjustments') { const d = a || b; const q = n(d.qty); push((b && !a ? 'Deleted stock correction: ' : q < 0 ? 'Removed ' : 'Added ') + Math.abs(q) + ' × ' + L.product(d.productId) + ' at ' + L.loc(d.locationId), { reason: [d.reason, d.notes].filter(Boolean).join(' · ') }); return out; }
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
    if (col === 'bills') { const d = a || b; const sup = L.supplier ? L.supplier(d.supplierId) : ''; const m = (v) => (L.money ? L.money(v, d.currency) : v); if (!b) push('New bill from ' + sup + ': ' + m(d.amount) + (d.description ? ' — ' + d.description : '')); else if (a) { const pb = (b.payments || []).length; (a.payments || []).slice(pb).forEach((p) => push('Paid ' + m(p.amount) + ' to ' + sup + ' by ' + (p.method || ''), { reason: d.description || '' })); if (a.status === 'cancelled' && b.status !== 'cancelled') push('Cancelled bill from ' + sup); if (!out.length) push('Edited bill from ' + sup); } else push('Deleted bill from ' + sup); return out; }
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
    ACT_TYPES, describeChange, rolesWith, rateOf, RETURN_REASONS, TRANSFER_REASONS, CURRENCIES, validateTransfer, isWholesale, autoPrice, priceFloor, collectedBy, billTotals, dueDateOf, lotCap, customerBalance, creditLimitOf, num, roundTo, DEFAULT_SETTINGS, CATEGORIES, SOURCE_TYPES, CONDITIONS, PAY_METHODS, SHIP_STATUSES, COST_CATEGORIES, ADJ_REASONS, EXPENSE_CATS, saleTotals, computeAll, allocate, validateSale,
    PERMS, ROLES, permsFor, SELL_UNITS, SIZE_UNITS, convertSize, sizeLabel, saleFacts, groupBy, summarize, inventoryHealth, projections, addDays, daysBetween };
});
