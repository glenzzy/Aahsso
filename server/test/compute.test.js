// Unit tests for the shared business logic: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const KC = require('../public/compute.js');

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
function base() {
  return {
    settings: { fxRate: 600, defaultMarkup: 100, minMarkup: 50, roundTo: 50 },
    products: [{ id: 'oats', name: 'Oats', category: 'Food & Snacks' }, { id: 'tv', name: 'TV', category: 'Electronics' }, { id: 'car', name: 'Toyota', category: 'Vehicles' }],
    shipments: [{ id: 'c1', status: 'received', fxRate: 600, receivedAt: '2026-10-01', costs: [
      { side: 'US', amount: 1000, currency: 'USD', appliesTo: 'goods' },        // 600,000 F to goods only
      { side: 'CM', amount: 300000, currency: 'XAF', appliesTo: 'l_car' },        // car customs to the car only
    ] }],
    lots: [
      { id: 'l_oats1', productId: 'oats', qty: 10, unitCost: 10, currency: 'USD', shipmentId: 'c1', purchaseDate: '2026-09-01', expiry: '2027-03-01' },
      { id: 'l_oats2', productId: 'oats', qty: 10, unitCost: 9, currency: 'USD', shipmentId: 'c1', purchaseDate: '2026-09-05', expiry: '2026-12-01' },
      { id: 'l_tv', productId: 'tv', qty: 2, unitCost: 310, currency: 'USD', shipmentId: 'c1', purchaseDate: '2026-09-02', recvMissing: 0 },
      { id: 'l_car', productId: 'car', qty: 1, unitCost: 3000, currency: 'USD', shipmentId: 'c1', purchaseDate: '2026-09-03' },
    ],
    sales: [], adjustments: [],
  };
}

test('landed cost: goods-only costs skip vehicles, by value', () => {
  const C = KC.computeAll(base());
  // goods value: oats 10*10*600 + 10*9*600 = 114000; tv 2*310*600 = 372000; total 486000
  near(C.lotX.l_oats1.landedUnit, 6000 + 600000 * 60000 / 486000 / 10);
  near(C.lotX.l_tv.landedUnit, 186000 + 600000 * 372000 / 486000 / 2);
  near(C.lotX.l_car.landedUnit, 1800000 + 300000); // only its own customs
  near(C.shipX.c1.landedX, 486000 + 1800000 + 900000);
});

test('FIFO allocation takes earliest expiry first', () => {
  const raw = base(); const C = KC.computeAll(raw);
  const a = KC.allocate(C, raw.lots, 'oats', 12);
  assert.deepEqual(a, [{ lotId: 'l_oats2', qty: 10 }, { lotId: 'l_oats1', qty: 2 }]);
  assert.equal(KC.allocate(C, raw.lots, 'oats', 21), null);
});

test('sale totals, deposit status, discount spread, returns & restock', () => {
  const raw = base(); let C = KC.computeAll(raw);
  const sale = { id: 's1', date: '2026-11-07', discount: 1000, lines: [{ productId: 'oats', qty: 4, unitPrice: 15000, alloc: KC.allocate(C, raw.lots, 'oats', 4), returns: [] }], payments: [{ id: 'p', amount: 20000 }] };
  raw.sales.push(sale); C = KC.computeAll(raw);
  const x = C.saleX.s1;
  assert.equal(x.total, 59000); assert.equal(x.balance, 39000); assert.equal(x.status, 'partial');
  assert.equal(C.prodX.oats.available, 16);
  sale.lines[0].returns = [{ qty: 1, restock: true, alloc: [{ lotId: 'l_oats2', qty: 1 }] }];
  C = KC.computeAll(raw);
  assert.equal(C.prodX.oats.available, 17);
  near(C.saleX.s1.net, 59000 - 15000 * (59000 / 60000));
  sale.status = 'cancelled'; C = KC.computeAll(raw);
  assert.equal(C.prodX.oats.available, 20); assert.equal(C.saleX.s1.profit, 0);
});

test('validateSale blocks overselling, allows editing own sale', () => {
  const raw = base(); const C = KC.computeAll(raw);
  const s = { id: 's1', lines: [{ productId: 'tv', qty: 2, alloc: KC.allocate(C, raw.lots, 'tv', 2) }] };
  assert.deepEqual(KC.validateSale(raw, s), []);
  raw.sales.push(s);
  assert.deepEqual(KC.validateSale(raw, s), [], 're-saving the same sale is fine');
  const s2 = { id: 's2', lines: [{ productId: 'tv', qty: 1, alloc: [{ lotId: 'l_tv', qty: 1 }] }] };
  assert.equal(KC.validateSale(raw, s2).length, 1);
});

test('stock losses: missing on arrival and adjustments', () => {
  const raw = base(); raw.lots[2].recvMissing = 1; raw.adjustments.push({ lotId: 'l_oats1', qty: -2 });
  const C = KC.computeAll(raw);
  assert.equal(C.prodX.tv.available, 1); assert.equal(C.prodX.oats.available, 18);
  assert.ok(C.shipX.c1.lossX > 0);
});

test('in-transit stock is not sellable', () => {
  const raw = base(); raw.shipments[0].status = 'at_port';
  const C = KC.computeAll(raw);
  assert.equal(C.prodX.oats.available, 0); assert.equal(C.prodX.oats.transit, 20);
});

test('pricing: markup, min, rounding, fixed price', () => {
  const raw = base(); raw.products[0].markup = 50; const C = KC.computeAll(raw);
  const cost = C.prodX.oats.avgCost;
  assert.equal(C.prodX.oats.priceMax, Math.ceil(cost * 1.5 / 50) * 50);
  raw.products[0].priceMax = 20000; const C2 = KC.computeAll(raw);
  assert.equal(C2.prodX.oats.priceMax, 20000); assert.ok(C2.prodX.oats.priceMin <= 20000);
});

test('permissions: role presets and overrides', () => {
  const s = KC.permsFor({ role: 'sales' });
  assert.equal(s.sell, true); assert.equal(s.costs, false); assert.equal(s.salesAll, false);
  const s2 = KC.permsFor({ role: 'sales', perms: { salesAll: true, sell: false } });
  assert.equal(s2.salesAll, true); assert.equal(s2.sell, false);
  assert.equal(KC.permsFor({ role: 'owner', perms: { team: false } }).team, true, 'owner cannot be restricted');
  assert.equal(KC.permsFor({ role: 'manager' }).team, false);
  assert.equal(KC.permsFor({ role: 'admin', active: false }).sell, false);
  assert.equal(KC.permsFor(null).home, undefined);
});

test('unit conversions', () => {
  assert.equal(KC.convertSize(2.6, 'kg'), '5.73 lb');
  assert.equal(KC.convertSize(5, 'lb'), '2.27 kg');
  assert.equal(KC.convertSize(16, 'oz'), '453.59 g');
  assert.equal(KC.convertSize(1, 'gal'), '3.79 L');
  assert.equal(KC.convertSize(500, 'mL'), '16.91 fl oz');
  assert.equal(KC.convertSize(55, 'inch (screen)'), '139.7 cm');
  assert.equal(KC.convertSize('', 'kg'), '');
});

test('analytics: facts, grouping, movers, projections', () => {
  const raw = base(); let C = KC.computeAll(raw);
  const mk = (id, date, pid, qty, price, hour = 10) => { const s = { id, date, createdAt: date + 'T' + String(hour).padStart(2, '0') + ':00:00', createdById: 'u1', createdBy: 'Ann', lines: [{ productId: pid, qty, unitPrice: price, alloc: KC.allocate(C, raw.lots, pid, qty), returns: [] }], payments: [] }; raw.sales.push(s); C = KC.computeAll(raw); };
  mk('a', '2026-11-01', 'oats', 3, 15000); mk('b', '2026-11-02', 'oats', 3, 15000); mk('c', '2026-11-03', 'tv', 1, 450000, 15);
  const f = KC.saleFacts(raw, C, { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(f.length, 3);
  const byCat = KC.groupBy(f, (x) => x.category);
  assert.equal(byCat.find((g) => g.key === 'Electronics').revenue, 450000);
  const sum = KC.summarize(f); assert.equal(sum.n, 3); assert.equal(sum.qty, 7);
  const h = KC.inventoryHealth(raw, C, '2026-11-07');
  const oats = h.find((x) => x.id === 'oats');
  assert.equal(oats.sold30, 6); assert.equal(oats.available, 14); assert.ok(oats.velocity > 0);
  assert.equal(h.find((x) => x.id === 'car').status, 'slow', 'unsold 37 days = slow');
  assert.equal(KC.inventoryHealth(raw, C, '2026-11-20').find((x) => x.id === 'car').status, 'dead', 'unsold 50 days = not selling');
  const P = KC.projections(raw, C, '2026-11-07', h);
  assert.ok(P.projectedMonthRev >= P.mtd.revenue);
  assert.equal(P.containers.length, 1);
  assert.ok(P.reorder.every((r) => r.suggest > 0));
});

test('stress: 3000 products, 9000 lots, 20000 sales computes fast', () => {
  const raw = { settings: {}, products: [], lots: [], shipments: [{ id: 'c', status: 'received', costs: [{ amount: 5000, currency: 'USD' }] }], sales: [], adjustments: [] };
  for (let i = 0; i < 3000; i++) { raw.products.push({ id: 'p' + i, name: 'Item ' + i, category: 'Cat' + (i % 10) }); for (let j = 0; j < 3; j++) raw.lots.push({ id: 'l' + i + '_' + j, productId: 'p' + i, qty: 50, unitCost: 5, currency: 'USD', shipmentId: 'c', purchaseDate: '2026-0' + (j + 1) + '-01' }); }
  for (let k = 0; k < 20000; k++) { const i = k % 3000; raw.sales.push({ id: 's' + k, date: '2026-10-' + String(1 + (k % 28)).padStart(2, '0'), lines: [{ productId: 'p' + i, qty: 1, unitPrice: 6000, alloc: [{ lotId: 'l' + i + '_0', qty: 1 }] }], payments: [{ amount: 6000 }] }); }
  let t = Date.now(); const C = KC.computeAll(raw); const tCompute = Date.now() - t;
  t = Date.now(); const h = KC.inventoryHealth(raw, C, '2026-10-30'); KC.projections(raw, C, '2026-10-30', h); const tAnalytics = Date.now() - t;
  console.log(`    computeAll: ${tCompute} ms · analytics: ${tAnalytics} ms`);
  assert.ok(tCompute < 1500, 'computeAll under 1.5s'); assert.ok(tAnalytics < 4000, 'analytics under 4s');
  assert.equal(C.prodX.p0.available, 150 - 7);
});

test('client orders: lot held for one customer, sellable at sea, invisible to others', () => {
  const raw = base(); raw.shipments.push({ id: 'c2', status: 'in_transit', costs: [] });
  raw.lots.push({ id: 'l_car2', productId: 'car', qty: 1, unitCost: 4000, currency: 'USD', shipmentId: 'c2', reservedFor: 'cust_A', purchaseDate: '2026-10-10' });
  let C = KC.computeAll(raw);
  assert.equal(C.prodX.car.reserved, 1);
  assert.equal(KC.allocate(C, raw.lots, 'car', 2, {}, 'cust_A').length, 2, 'client A can take the general car and their own');
  assert.equal(KC.allocate(C, raw.lots, 'car', 2, {}, 'cust_B'), null, 'client B cannot take A\'s car');
  const a1 = KC.allocate(C, raw.lots, 'car', 1, {}, 'cust_A'); assert.deepEqual(a1, [{ lotId: 'l_car2', qty: 1 }], 'reserved lot is used first for its client');
  const b1 = KC.allocate(C, raw.lots, 'car', 1, {}, 'cust_B'); assert.deepEqual(b1, [{ lotId: 'l_car', qty: 1 }], 'others only get the general car');
  assert.equal(KC.validateSale(raw, { id: 'x', customerId: 'cust_B', lines: [{ productId: 'car', qty: 1, alloc: [{ lotId: 'l_car2', qty: 1 }] }] }).length, 1);
  assert.equal(KC.validateSale(raw, { id: 'x', customerId: 'cust_A', lines: [{ productId: 'car', qty: 1, alloc: [{ lotId: 'l_car2', qty: 1 }] }] }).length, 0);
});
test('credit: limit from customer or default; balance across sales', () => {
  const raw = base(); let C = KC.computeAll(raw);
  raw.sales.push({ id: 's1', customerId: 'A', lines: [{ productId: 'oats', qty: 2, unitPrice: 10000, alloc: [{ lotId: 'l_oats1', qty: 2 }] }], payments: [{ amount: 5000 }] });
  raw.sales.push({ id: 's2', customerId: 'A', status: 'cancelled', lines: [{ productId: 'oats', qty: 1, unitPrice: 10000, alloc: [{ lotId: 'l_oats1', qty: 1 }] }], payments: [] });
  C = KC.computeAll(raw);
  assert.equal(KC.customerBalance(raw, C, 'A'), 15000);
  assert.equal(KC.creditLimitOf({ defaultCreditLimit: 50000 }, { id: 'A' }), 50000);
  assert.equal(KC.creditLimitOf({ defaultCreditLimit: 50000 }, { id: 'A', creditLimit: 0 }), 0);
  assert.equal(KC.creditLimitOf({}, { id: 'A' }), null);
});

test('locations: stock per location, transfers, sales and adjustments per location', () => {
  const raw = base(); raw.transfers = [];
  let C = KC.computeAll(raw);
  assert.equal(C.lotX.l_oats1.byLoc.main, 10);
  raw.transfers.push({ id: 't1', from: 'main', to: 'shop', lines: [{ productId: 'oats', qty: 6, alloc: [{ lotId: 'l_oats1', qty: 6 }] }] });
  C = KC.computeAll(raw);
  assert.equal(C.prodX.oats.byLoc.shop, 6); assert.equal(C.prodX.oats.byLoc.main, 14); assert.equal(C.prodX.oats.available, 20, 'total unchanged');
  assert.equal(KC.allocate(C, raw.lots, 'oats', 7, {}, null, 'shop'), null, 'only 6 at the shop');
  const a = KC.allocate(C, raw.lots, 'oats', 6, {}, null, 'shop'); assert.deepEqual(a, [{ lotId: 'l_oats1', qty: 6 }]);
  raw.sales.push({ id: 's', locationId: 'shop', lines: [{ productId: 'oats', qty: 2, unitPrice: 1, alloc: [{ lotId: 'l_oats1', qty: 2 }] }], payments: [] });
  raw.adjustments.push({ lotId: 'l_oats1', qty: -1, locationId: 'shop' });
  C = KC.computeAll(raw);
  assert.equal(C.prodX.oats.byLoc.shop, 3); assert.equal(C.prodX.oats.byLoc.main, 14);
  assert.equal(KC.validateSale(raw, { id: 'x', locationId: 'shop', lines: [{ productId: 'oats', qty: 4, alloc: [{ lotId: 'l_oats1', qty: 4 }] }] }).length, 1, 'cannot sell 4 at shop');
  assert.equal(KC.validateTransfer(raw, { id: 't2', from: 'shop', to: 'main', lines: [{ alloc: [{ lotId: 'l_oats1', qty: 4 }] }] }).length, 1);
  assert.equal(KC.validateTransfer(raw, { id: 't2', from: 'shop', to: 'main', lines: [{ alloc: [{ lotId: 'l_oats1', qty: 3 }] }] }).length, 0);
  raw.transfers[0].status = 'cancelled'; C = KC.computeAll(raw);
  assert.equal(C.prodX.oats.byLoc.shop || 0, 0, 'cancelled transfer: shop shows no stock (sold items now come from main)');
});
test('wholesale: customer type or bulk quantity picks wholesale price; floor follows', () => {
  const raw = base(); raw.settings.wholesaleMarkup = 40; raw.products[0].bulkQty = 10;
  const C = KC.computeAll(raw); const px = C.prodX.oats;
  assert.ok(px.priceWholesale < px.priceMax);
  assert.equal(KC.autoPrice(C, 'oats', 1, { type: 'Retail' }), px.priceMax);
  assert.equal(KC.autoPrice(C, 'oats', 1, { type: 'Reseller' }), px.priceWholesale);
  assert.equal(KC.autoPrice(C, 'oats', 10, null), px.priceWholesale, 'bulk qty');
  assert.equal(KC.priceFloor(C, 'oats', 1, { type: 'Wholesale' }), Math.min(px.priceMin, px.priceWholesale));
});
test('cash handover: collected per person per day; supplier bill totals; due dates', () => {
  const raw = base(); raw.sales.push({ id: 's', date: '2026-11-07', lines: [], payments: [{ amount: 5000, method: 'Cash', byId: 'u1', date: '2026-11-07' }, { amount: 3000, method: 'MTN MoMo', byId: 'u1', date: '2026-11-07' }, { amount: 2000, method: 'Cash', byId: 'u2', date: '2026-11-07' }, { amount: -1000, method: 'Cash', byId: 'u1', date: '2026-11-07' }] });
  const c = KC.collectedBy(raw, 'u1', '2026-11-07'); assert.equal(c.total, 7000); assert.equal(c.by.Cash, 4000);
  const b = KC.billTotals({ amount: 1000, currency: 'USD', payments: [{ amount: 400 }] }, { fxRate: 600 }); assert.equal(b.balanceX, 360000); assert.equal(b.status, 'partial');
  assert.equal(KC.dueDateOf({ date: '2026-11-07' }, { creditDays: 14 }), '2026-11-21');
});
test('currencies: € purchase converts with container or default rate; base currency can change', () => {
  const raw = base(); raw.settings.fxRates = { USD: 600, EUR: 655.957 };
  raw.lots.push({ id: 'l_eu', productId: 'oats', qty: 1, unitCost: 10, currency: 'EUR', inWarehouse: true, sourceType: 'Local (Cameroon)' });
  let C = KC.computeAll(raw); near(C.lotX.l_eu.unitX, 6559.57);
  raw.shipments[0].fxRates = { USD: 610 }; C = KC.computeAll(raw); near(C.lotX.l_oats1.unitX, 6100, 0.01);
  const ng = { settings: { currency: 'NGN', fxRates: { USD: 1550 } }, products: [{ id: 'p', name: 'x' }], lots: [{ id: 'l', productId: 'p', qty: 1, unitCost: 2, currency: 'USD', inWarehouse: true, sourceType: 'Local (Cameroon)' }, { id: 'l2', productId: 'p', qty: 1, unitCost: 500, currency: 'NGN', inWarehouse: true, sourceType: 'Local (Cameroon)' }], shipments: [], sales: [] };
  const C2 = KC.computeAll(ng); assert.equal(C2.lotX.l.unitX, 3100); assert.equal(C2.lotX.l2.unitX, 500);
});
test('branch transfer in transit: stock leaves source, not yet at destination', () => {
  const raw = base(); raw.transfers = [{ id: 't', from: 'main', to: 'shop', status: 'in_transit', lines: [{ productId: 'oats', qty: 5, alloc: [{ lotId: 'l_oats1', qty: 5 }] }] }];
  let C = KC.computeAll(raw); assert.equal(C.prodX.oats.byLoc.main, 15); assert.equal(C.prodX.oats.byLoc.shop || 0, 0); assert.equal(C.prodX.oats.available, 15); assert.equal(C.prodX.oats.moving, 5);
  raw.transfers[0].status = 'received'; raw.adjustments.push({ lotId: 'l_oats1', qty: -1, locationId: 'shop', reason: 'Missing in transfer' });
  C = KC.computeAll(raw); assert.equal(C.prodX.oats.byLoc.shop, 4); assert.equal(C.prodX.oats.available, 19);
});
test('custom roles: edited and new roles; owner never restricted', () => {
  const roles = { sales: { label: 'Sales rep', perms: ['sell'] }, cashier: { label: 'Cashier', perms: ['payments', 'nonsense'] } };
  assert.equal(KC.permsFor({ role: 'sales' }, roles).payments, false);
  assert.equal(KC.permsFor({ role: 'cashier' }, roles).payments, true); assert.equal(KC.permsFor({ role: 'cashier' }, roles).sell, false);
  assert.equal(KC.permsFor({ role: 'owner' }, { owner: { perms: [] } }).team, true);
  assert.equal(KC.rolesWith(roles).cashier.custom, true);
});
test('MoMo fees: Cameroon tiers, validate txn id, sale totals keep fee separate', () => {
  assert.equal(KC.isMobileMoney('MTN MoMo'), true);
  assert.equal(KC.isMobileMoney('Cash'), false);
  assert.equal(KC.calcMomoFee('Cash', 10000), 0);
  assert.equal(KC.calcMomoFee('MTN MoMo', 2000), 54);
  // 100_000 → 1% + 0.2% tax + 4 = 1000 + 200 + 4 = 1204
  assert.equal(KC.calcMomoFee('MTN MoMo', 100000), 1204);
  assert.equal(KC.calcMomoFee('Orange Money', 400000), 4004);
  // a sale paid by mobile money needs the customer's number or the transaction ID (either one); our receiving number is optional
  assert.match(KC.validatePayment({ method: 'MTN MoMo', amount: 5000, fee: 54, ref: '', account: '677' }), /customer’s mobile money number/);
  assert.equal(KC.validatePayment({ method: 'MTN MoMo', amount: 5000, fee: 54, ref: '', phone: '677123456' }), '');
  assert.equal(KC.validatePayment({ method: 'MTN MoMo', amount: 5000, fee: 54, ref: 'TX1', account: '' }), '');
  assert.equal(KC.validatePayment({ method: 'MTN MoMo', amount: 5000, fee: 54, ref: 'TX1', account: '677' }), '');
  // MTN or Orange from the number; receiving numbers per part of the app
  assert.equal(KC.momoNetwork('677 12 34 56'), 'MTN MoMo'); assert.equal(KC.momoNetwork('+237 699 12 34 56'), 'Orange Money');
  assert.equal(KC.momoNetwork('651234567'), 'MTN MoMo'); assert.equal(KC.momoNetwork('657123456'), 'Orange Money'); assert.equal(KC.momoNetwork('612345678'), null); assert.equal(KC.momoNetwork('12345'), null);
  const accS = { momoAccounts: [{ method: 'MTN MoMo', number: '670000001' }, { method: 'MTN MoMo', number: '670000002', use: 'pos' }, { method: 'Orange Money', number: '690000001', use: 'resto' }] };
  assert.deepEqual(KC.momoAccountsFor(accS, 'pos', 'MTN MoMo').map((a) => a.number), ['670000002']);
  assert.deepEqual(KC.momoAccountsFor(accS, 'sales', 'MTN MoMo').map((a) => a.number), ['670000001']);
  assert.deepEqual(KC.momoAccountsFor(accS, 'pos', 'Orange Money').map((a) => a.number), ['690000001']); // nothing for the POS or everywhere: any Orange number
  assert.equal(KC.validatePayment({ method: 'Cash', amount: 5000 }), '');
  const sale = { no: 'S1', lines: [{ qty: 1, unitPrice: 10000, returns: [] }], payments: [{ id: 'p1', amount: 10000, fee: 1204, method: 'MTN MoMo', ref: 'ABC99', account: '677' }] };
  const t = KC.saleTotals(sale);
  assert.equal(t.paid, 10000); assert.equal(t.fees, 1204); assert.equal(t.balance, 0);
  // every sale has its own transaction id (MoMo refs stay on the payment); older sales fall back to the receipt no
  assert.equal(t.txnId, 'TX-S1');
  assert.equal(KC.saleTxnId(Object.assign({}, sale, { txnId: 'TX261110-ABC123' })), 'TX261110-ABC123');
  assert.match(KC.newTxnId('TX', '2026-11-10'), /^TX261110-[0-9A-Z]{6}$/);
});
test('payment modes: sales are Cash / MTN MoMo / Orange Money; purchases may also use bank', () => {
  assert.deepEqual(KC.SALE_PAY_METHODS, ['Cash', 'MTN MoMo', 'Orange Money']);
  assert.match(KC.validatePayment({ method: 'Bank transfer', amount: 5000 }), /Payment mode must be/);
  assert.equal(KC.validatePayment({ method: 'Bank transfer', amount: 5000 }, {}, 'purchase'), '');
  // refunds may go back by an older mode
  assert.equal(KC.validatePayment({ method: 'Bank transfer', amount: -5000 }), '');
  // purchases by MoMo still need the txn ID, but not a receiving number of ours
  assert.match(KC.validatePayment({ method: 'Orange Money', amount: 5000, fee: 54 }, {}, 'purchase'), /Transaction ID/);
  assert.equal(KC.validatePayment({ method: 'Orange Money', amount: 5000, fee: 54, ref: 'OM1' }, {}, 'purchase'), '');
});
test('supplier bills: charges separate from amount, every bill has a txn id', () => {
  const b = { id: 'b_xyz', amount: 100000, currency: 'XAF', payments: [{ id: 'bp1', amount: 60000, fee: 724, method: 'MTN MoMo', ref: 'M1' }] };
  const x = KC.billTotals(b, KC.DEFAULT_SETTINGS);
  assert.equal(x.paid, 60000); assert.equal(x.fees, 724); assert.equal(x.balance, 40000); assert.equal(x.status, 'partial');
  assert.equal(x.txnId, 'PU-XYZ');
  assert.equal(KC.billTxnId(Object.assign({}, b, { txnId: 'PU261110-AAAAAA' })), 'PU261110-AAAAAA');
});
test('cash handover keeps MoMo charges apart from the money to hand over', () => {
  const raw = { sales: [{ id: 's', no: 'S1', txnId: 'TX1', payments: [{ id: 'p', byId: 'u1', date: '2026-11-10', method: 'MTN MoMo', amount: 10000, fee: 1204 }, { id: 'p2', byId: 'u1', date: '2026-11-10', method: 'Cash', amount: 500 }] }] };
  const c = KC.collectedBy(raw, 'u1', '2026-11-10');
  assert.equal(c.total, 10500); assert.equal(c.fees, 1204); assert.equal(c.feesBy['MTN MoMo'], 1204); assert.equal(c.items[0].txnId, 'TX1');
});
test('activity descriptions: plain words for who-did-what', () => {
  const L = { product: () => 'Oats', customer: () => 'Jenny', loc: (x) => (x === 'shop' ? 'Akwa shop' : 'Main warehouse'), ship: () => 'Container #1', supplier: () => 'Trucker', F: (v) => v + ' F', money: (v, c) => c + ' ' + v };
  const s0 = { no: 'S1', customerName: 'Jenny', lines: [{ productId: 'p', name: 'Oats', qty: 2, unitPrice: 5000, returns: [] }], payments: [] };
  assert.match(KC.describeChange('sales', null, s0, L)[0].text, /Sold 2 × Oats to Jenny — 10000 F/);
  const s1 = JSON.parse(JSON.stringify(s0)); s1.status = 'cancelled'; s1.cancelReason = 'Duplicate sale';
  const c = KC.describeChange('sales', s0, s1, L)[0]; assert.match(c.text, /Cancelled sale S1/); assert.equal(c.reason, 'Duplicate sale');
  const s2 = JSON.parse(JSON.stringify(s0)); s2.payments = [{ id: 'a', amount: 3000, method: 'Orange Money', account: '699' }];
  assert.match(KC.describeChange('sales', s0, s2, L)[0].text, /Received 3000 F by Orange Money to 699/);
  const t0 = { no: 'T1', from: 'main', to: 'shop', status: 'in_transit', reason: 'Restock a branch', lines: [{ productId: 'p', qty: 5 }] };
  assert.match(KC.describeChange('transfers', null, t0, L)[0].text, /Sent 5 × Oats Main warehouse → Akwa shop/);
  const t1 = Object.assign({}, t0, { status: 'received', lines: [{ productId: 'p', qty: 5, receivedQty: 4 }] });
  assert.match(KC.describeChange('transfers', t0, t1, L)[0].text, /1 unit\(s\) missing/);
  const ad = KC.describeChange('adjustments', null, { qty: -2, productId: 'p', locationId: 'shop', reason: 'Missing / theft', notes: 'shelf 3' }, L)[0];
  assert.match(ad.text, /Removed 2 × Oats at Akwa shop/); assert.equal(ad.reason, 'Missing / theft · shelf 3');
  assert.match(KC.describeChange('products', { name: 'Oats', priceMax: 10000 }, { name: 'Oats', priceMax: 12000 }, L)[0].text, /price 10000 → 12000/);
  assert.equal(KC.describeChange('audits', { status: 'draft', counts: {} }, { status: 'draft', counts: { p: 1 } }, L).length, 0, 'typing a count is not noise');
});

test('assets: cost in base currency, straight-line & declining depreciation, disposal gain/loss, P&L totals', () => {
  const S = Object.assign({}, KC.DEFAULT_SETTINGS, { fxRates: { USD: 600 } });
  // Stacker bought in the US for $3,000 + 200,000 F shipping/customs, 5 years, nothing left at the end
  const st = { id: 'a1', name: 'Stacker', category: 'Warehouse equipment', price: 3000, currency: 'USD', extraCosts: 200000, purchaseDate: '2026-01-15', usefulLife: 5, residualValue: 0 };
  assert.equal(KC.assetCost(st, S), 2000000);
  assert.equal(KC.assetCost(Object.assign({}, st, { fxRate: 610 }), S), 3000 * 610 + 200000); // its own rate wins
  const v = KC.assetValue(st, S, '2026-11-30');
  assert.equal(Math.round(v.book), 1649462); assert.equal(KC.assetBookOn(st, S, '2026-01-15'), 2000000); // nothing lost on the day it is bought assert.equal(Math.round(v.monthly), 33333);
  assert.equal(Math.round(KC.assetDepreciation(st, S, '2026-11-01', '2026-11-30')), 33333);
  assert.equal(Math.round(KC.assetDepreciation(st, S, '2026-01-01', '2026-12-31')), 383871); // first month only from the 15th
  assert.equal(Math.round(KC.assetDepreciation(st, S, '2027-01-01', '2027-12-31')), 400000);
  assert.equal(KC.assetDepreciation(st, S, '2025-01-01', '2025-12-31'), 0); // not owned yet
  assert.deepEqual(KC.assetSchedule(st, S).map((r) => [r.year, Math.round(r.depreciation), Math.round(r.book)]), [[2026, 383871, 1616129], [2027, 400000, 1216129], [2028, 400000, 816129], [2029, 400000, 416129], [2030, 400000, 16129], [2031, 16129, 0]]);
  assert.equal(KC.assetValue(st, S, '2035-01-01').book, 0); assert.ok(KC.assetValue(st, S, '2035-01-01').fullyDepreciated);
  // residual value: never goes below it
  assert.equal(Math.round(KC.assetValue(Object.assign({}, st, { residualValue: 500000 }), S, '2040-01-01').book), 500000);
  // declining balance (2/L per year)
  assert.equal(Math.round(KC.assetBookOn(Object.assign({}, st, { depMethod: 'declining' }), S, '2026-12-31')), 1224974);
  // land: no depreciation; default life by category
  const land = { name: 'Plot', category: 'Land', price: 5000000, currency: 'XAF', purchaseDate: '2025-03-01' };
  assert.equal(KC.assetValue(land, S, '2026-11-08').book, 5000000); assert.equal(KC.assetDepreciation(land, S, '2026-01-01', '2026-12-31'), 0);
  assert.equal(KC.assetLife({ category: 'Vehicles' }), 5); assert.equal(KC.assetLife({ category: 'Computers & phones' }), 3);
  // sold on 1 Jan 2027 for 1.5M: book 1.6M → loss 100k; no depreciation after the sale
  const sold = Object.assign({}, st, { status: 'sold', disposal: { date: '2027-01-01', amount: 1500000 } });
  const sv = KC.assetValue(sold, S, '2027-06-30');
  assert.equal(sv.gone, true); assert.equal(sv.book, 0); assert.equal(Math.round(sv.bookAtDisposal), 1615054); assert.equal(Math.round(sv.gain), -115054);
  assert.equal(Math.round(KC.assetDepreciation(sold, S, '2027-02-01', '2027-12-31')), 0);
  const stolen = Object.assign({}, st, { status: 'stolen', disposal: { date: '2026-12-31' } });
  assert.equal(Math.round(KC.assetValue(stolen, S, '2027-01-31').gain), -1616129); // full book value lost
  // totals for a month: only owned & active assets count
  const t = KC.assetTotals([st, land, sold, Object.assign({}, st, { id: 'a9', purchaseDate: '2027-05-01' })], S, '2026-11-01', '2026-11-30');
  assert.equal(t.count, 3); assert.equal(Math.round(t.depreciation), 66667); assert.equal(Math.round(t.cost), 9000000);
  const tj = KC.assetTotals([sold], S, '2027-01-01', '2027-01-31'); assert.equal(tj.disposed, 1); assert.equal(Math.round(tj.gain), -115054); assert.equal(tj.count, 0);
  // permissions & activity log text
  assert.equal(KC.permsFor({ role: 'manager' }).assets, true); assert.equal(KC.permsFor({ role: 'sales' }).assets, false);
  const L = { loc: (id) => (id === 'b2' ? 'Akwa shop' : 'Main warehouse'), F: (v) => Math.round(v) + ' F', money: (v, c) => v + ' ' + c };
  assert.match(KC.describeChange('assets', null, st, L)[0].text, /Registered asset Stacker — bought for 3000 USD \+ 200000 F extra costs/);
  assert.match(KC.describeChange('assets', st, Object.assign({}, st, { locationId: 'b2', assignedTo: 'Paul' }), L).map((x) => x.text).join(' | '), /Moved asset Stacker: Main warehouse → Akwa shop \| Asset Stacker now with Paul/);
  const sl = KC.describeChange('assets', st, Object.assign({}, sold, { disposal: { date: '2027-01-01', amount: 1500000, bookValue: 1615054, buyer: 'Ets Ndi', reason: 'Bought a bigger one' } }), L)[0];
  assert.match(sl.text, /Sold asset Stacker to Ets Ndi for 1500000 F .*loss 115054 F/); assert.equal(sl.reason, 'Bought a bigger one');
});
test('delivery: fee kept apart from the sale amount; owed only when the client pays us', () => {
  const base = { no: 'S9', lines: [{ qty: 2, unitPrice: 10000, returns: [] }], payments: [{ amount: 20000 }] };
  const t = (delivery) => KC.saleTotals(Object.assign({}, base, { delivery }));
  assert.equal(t({ mode: 'agency', fee: 3000, payer: 'client_us' }).net, 20000);           // revenue unchanged
  assert.equal(t({ mode: 'agency', fee: 3000, payer: 'client_us' }).deliveryFee, 3000);
  assert.equal(t({ mode: 'agency', fee: 3000, payer: 'client_us' }).due, 23000);
  assert.equal(t({ mode: 'agency', fee: 3000, payer: 'client_us' }).balance, 3000);
  assert.equal(t({ mode: 'agency', fee: 3000, payer: 'client_us' }).status, 'partial');
  assert.equal(t({ mode: 'agency', fee: 3000, payer: 'client_agency' }).balance, 0);       // client pays the agency directly
  assert.equal(t({ mode: 'local', fee: 1500, payer: 'business' }).balance, 0);             // free delivery for the client
  assert.equal(t({ mode: 'pickup', fee: 9999 }).deliveryFee, 0);
  assert.equal(t(undefined).balance, 0);
  const d = KC.cleanDelivery({ mode: 'agency', agency: ' General Express ', destination: 'Bafoussam', fee: '-50', payer: 'hacker', status: 'weird', recipientName: 'x'.repeat(500) });
  assert.equal(d.agency, 'General Express'); assert.equal(d.fee, 0); assert.equal(d.payer, 'client_us'); assert.equal(d.status, 'to_send'); assert.equal(d.recipientName.length, 80);
  assert.deepEqual(KC.cleanDelivery({ mode: 'pickup', fee: 100 }), { mode: 'pickup' });
  assert.deepEqual(KC.cleanDelivery({ mode: 'teleport' }), { mode: 'pickup' });
});
test('online shop: catalogue hides costs, exact stock only when few; orders checked, prices from the catalogue', () => {
  const raw = { settings: {}, products: [{ id: 'a', name: 'Oats', category: 'Food', priceMax: 5000 }, { id: 'b', name: 'TV', category: 'Electronics', priceMax: 150000 }, { id: 'c', name: 'Hidden', priceMax: 100, shopHidden: true }, { id: 'd', name: 'Gone', priceMax: 100, archived: true }],
    lots: [{ id: 'l1', productId: 'a', qty: 40, unitCost: 1000, inWarehouse: true, locationId: 'main' }, { id: 'l2', productId: 'b', qty: 2, unitCost: 90000, inWarehouse: true, locationId: 'main' }, { id: 'l3', productId: 'c', qty: 5, unitCost: 1, inWarehouse: true }, { id: 'l4', productId: 'd', qty: 5, unitCost: 1, inWarehouse: true }],
    shipments: [], sales: [], adjustments: [], transfers: [] };
  const cat = KC.shopCatalog(raw, KC.computeAll(raw));
  assert.deepEqual(cat.map((i) => i.id).sort(), ['a', 'b']);
  const pub = cat.map(KC.publicItem);
  assert.ok(pub.every((i) => !('available' in i) && !('cost' in i) && !('unitCost' in i)));
  assert.equal(pub.find((i) => i.id === 'a').few, null);   // plenty: no exact number
  assert.equal(pub.find((i) => i.id === 'b').few, 2);      // few left: shown
  const ok = { customer: { name: 'Awa', phone: '+237 677 12 34 56' }, items: [{ productId: 'a', qty: 3, unitPrice: 1 }], delivery: { mode: 'agency', agency: 'General Express', destination: 'Bafoussam', fee: 99999, status: 'delivered' } };
  const r = KC.validateShopOrder(ok, cat);
  assert.equal(r.order.lines[0].unitPrice, 5000);           // client cannot set the price
  assert.equal(r.order.subtotal, 15000);
  assert.equal(r.order.delivery.fee, 0);                    // nor the fee or status
  assert.equal(r.order.delivery.status, 'to_send');
  assert.equal(r.order.delivery.recipientName, 'Awa');      // recipient defaults to the client
  const err = (patch) => KC.validateShopOrder(Object.assign({}, ok, patch), cat).error;
  assert.match(err({ customer: { name: 'A', phone: '677123456' } }), /name/);
  assert.match(err({ customer: { name: 'Awa', phone: '123' } }), /phone/);
  assert.match(err({ items: [] }), /empty/);
  assert.match(err({ items: [{ productId: 'zzz', qty: 1 }] }), /no longer available/);
  assert.match(err({ items: [{ productId: 'b', qty: 3 }] }), /Only 2 left/);
  assert.match(err({ items: [{ productId: 'a', qty: 0 }] }), /quantity/);
  assert.match(err({ items: [{ productId: 'a', qty: 1 }, { productId: 'a', qty: 1 }] }), /Duplicate/);
  assert.match(err({ delivery: { mode: 'agency', destination: 'Bafoussam' } }), /agency/);
  assert.match(err({ delivery: { mode: 'local' } }), /town/);
  assert.equal(KC.validateShopOrder(Object.assign({}, ok, { delivery: { mode: 'pickup' } }), cat).order.delivery.mode, 'pickup');
});

test('purchase tax is shared over lines by value and adds up exactly', () => {
  const lines = [{ unitCost: 10, qty: 3 }, { unitCost: 5, qty: 2 }, { unitCost: 20, qty: 1 }]; // 30 + 10 + 20 = 60
  const t = KC.allocTax(lines, 6); // 10 %
  assert.deepEqual(t, [3, 1, 2]);
  const odd = KC.allocTax([{ unitCost: 1, qty: 1 }, { unitCost: 1, qty: 1 }, { unitCost: 1, qty: 1 }], 1);
  assert.equal(Math.round(odd.reduce((a, v) => a + v, 0) * 100) / 100, 1);
  assert.deepEqual(KC.allocTax(lines, 0), [0, 0, 0]);
});

test('tax is part of the landed cost of each unit', () => {
  const raw = { settings: { fxRates: { USD: 600 }, baseCurrency: 'XAF' }, products: [{ id: 'p' }], shipments: [{ id: 's', status: 'received', costs: [{ id: 'c', side: 'US', amount: 100, currency: 'USD' }] }],
    lots: [{ id: 'l', productId: 'p', shipmentId: 's', currency: 'USD', unitCost: 10, unitTax: 1, qty: 10 }], sales: [] };
  const C = KC.computeAll(raw);
  assert.equal(C.lotX.l.landedUnit, (10 + 1 + 10) * C.lotX.l.fx);
  assert.equal(C.shipX.s.goodsX, 110 * C.lotX.l.fx);
  assert.equal(KC.shipPhase('at_port'), 'receive'); assert.equal(KC.shipPhase('loading'), 'ship'); assert.equal(KC.shipPhase('closed'), 'sell');
});

test('selling prices: fixed prices win, otherwise cost + markup', () => {
  const S = { defaultMarkup: 100, minMarkup: 50, wholesaleMarkup: 70, roundTo: 50 };
  assert.deepEqual(KC.sellingPrices({}, 1000, S), { max: 2000, min: 1500, ws: 1700, markup: 100 });
  assert.equal(KC.sellingPrices({ priceMax: 2500 }, 1000, S).max, 2500);
  assert.equal(KC.sellingPrices({ markup: 20 }, 1000, S).max, 1200);
});

test('promotions: lower the price and the floor while running; ignored when ended or not started', () => {
  const day = KC.localDay();
  const base = () => ({ settings: { defaultMarkup: 100, minMarkup: 50, roundTo: 50 }, products: [{ id: 'a', category: 'Phones', priceMax: 10000, priceMin: 9000 }, { id: 'b', category: 'Food', priceMax: 2000 }],
    lots: [{ id: 'l', productId: 'a', qty: 5, unitCost: 5000, currency: 'XAF', inWarehouse: true }, { id: 'm', productId: 'b', qty: 5, unitCost: 500, currency: 'XAF', inWarehouse: true }], sales: [], promos: [] });
  let raw = base(); raw.promos = [{ id: 'p1', name: 'Black Friday', type: 'pct', value: 20, scope: 'category', category: 'Phones', start: day }];
  let C = KC.computeAll(raw);
  assert.equal(C.prodX.a.promo.price, 8000);
  assert.equal(KC.autoPrice(C, 'a', 1, null), 8000);
  assert.equal(KC.priceFloor(C, 'a', 1, null), 8000);
  assert.equal(C.prodX.b.promo, null); // other category
  raw = base(); raw.promos = [{ id: 'p2', type: 'amount', value: 500, scope: 'items', productIds: ['b'], start: '2000-01-01', end: '2000-01-31' }];
  C = KC.computeAll(raw); assert.equal(C.prodX.b.promo, null); assert.equal(KC.autoPrice(C, 'b', 1, null), 2000);
  raw = base(); raw.promos = [{ id: 'p3', type: 'price', value: 1500, scope: 'all', start: day, status: 'ended' }];
  C = KC.computeAll(raw); assert.equal(C.prodX.b.promo, null);
  assert.equal(KC.promoPriceOf({ type: 'price', value: 99999 }, 2000, {}), 2000); // never above the normal price
  assert.equal(KC.promoStatus({ start: '2999-01-01' }), 'scheduled');
});

test('expense phases: each step belongs to a phase; older expenses are day-to-day', () => {
  assert.deepEqual(KC.expenseStage({ stage: 'loading' }), ['loading', 'Loading', 'Ship']);
  assert.deepEqual(KC.expenseStage({ stage: 'cleared' }).slice(1), ['Customs cleared', 'Receive']);
  assert.equal(KC.expenseStage({ stage: 'closed' })[2], 'Sell');
  assert.equal(KC.expenseStage({ stage: 'buy' })[2], 'Buy');
  assert.equal(KC.expenseStage({})[2], 'Day-to-day');
  assert.deepEqual(KC.EXPENSE_PHASES, ['Buy', 'Ship', 'Receive', 'Sell', 'Day-to-day']);
});

test('delivery payment rules: collect = paid before pickup; our delivery = before or on delivery; customer pays the fee', () => {
  const collect = { delivery: KC.cleanDelivery({ mode: 'collect', recipientName: 'Paul', recipientPhone: '677', fee: 2000, destination: 'x' }) };
  assert.equal(collect.delivery.fee, 0); assert.equal(collect.delivery.destination, '');
  assert.match(KC.handOverBlock(collect, 5000, 'delivered'), /only collect once everything is paid/);
  assert.equal(KC.handOverBlock(collect, 0, 'delivered'), '');
  const before = { delivery: KC.cleanDelivery({ mode: 'local', destination: 'Akwa', fee: 1500 }) };
  assert.equal(before.delivery.payWhen, 'before'); assert.match(KC.handOverBlock(before, 1000, 'sent'), /pays before we send/);
  const onDel = { delivery: KC.cleanDelivery({ mode: 'agency', destination: 'Bafoussam', agency: 'General Express', payWhen: 'on_delivery' }) };
  assert.equal(KC.handOverBlock(onDel, 1000, 'sent'), '');
  assert.match(KC.handOverBlock(onDel, 1000, 'delivered'), /collected on delivery/);
  assert.equal(KC.cleanDelivery({ mode: 'local', destination: 'x', payer: 'business' }).payer, 'client_us'); // no more "we pay"
  assert.ok(!KC.DELIVERY_PAYERS.some((p) => p[0] === 'business'));
  const v = KC.validateShopOrder({ customer: { name: 'Ann', phone: '677000000' }, items: [{ productId: 'a', qty: 1 }], delivery: { mode: 'collect' } }, [{ id: 'a', name: 'A', price: 10, available: 5 }]);
  assert.match(v.error, /person who will collect/);
});

test('editions: Aahsso Store never has Ship or Receive; everything else is up to the plan', () => {
  assert.deepEqual(KC.EDITION_KEYS, ['import', 'store', 'resto']);
  assert.equal(KC.editionOf('nonsense').key, 'import', 'unknown → Import (every business before editions)');
  assert.equal(KC.editionHas('store', 'ship'), false); assert.equal(KC.editionHas('store', 'receive'), false);
  assert.equal(KC.editionHas('store', 'buy'), true); assert.equal(KC.editionHas('store', 'payroll'), true);
  assert.equal(KC.featuresOf('import').length, KC.FEATURES.length - KC.RESTO_FEATURES.length, 'everything but the Bar & Resto tools');
  assert.deepEqual(KC.featuresOf('import').map((f) => f[0]).filter((k) => !KC.featuresOf('store').some((f) => f[0] === k)), ['ship', 'receive']);
  // a Store business's staff never get the container permission, whatever their role says
  const P = KC.permsWithFeatures(KC.permsFor({ role: 'manager', active: true }, {}), { ship: false, receive: false });
  assert.equal(P.containers, false); assert.equal(P.purchases, true);
});

/* ---------- Bar & Resto stock: served = off the shelf; the movement ledger ---------- */
function bar() {
  return {
    settings: {}, products: [{ id: 'beer', name: '33 Export 650ml Bottle', unit: 'bottle' }, { id: 'rum', name: 'Rum 700ml' }],
    lots: [{ id: 'L1', productId: 'beer', purchaseDate: '2026-11-20', createdAt: '2026-11-20T09:00:00.000Z', qty: 36, unitCost: 600, currency: 'XAF', inWarehouse: true, vendor: 'SABC Depot', by: 'Ama' },
      { id: 'L2', productId: 'rum', purchaseDate: '2026-11-20', createdAt: '2026-11-20T09:05:00.000Z', qty: 2, unitCost: 8000, currency: 'XAF', inWarehouse: true }],
    menu: [{ id: 'm33', name: '33 Export', price: 1000, uses: [{ productId: 'beer', qty: 1 }] }, { id: 'shot', name: 'Rum shot', price: 1500, uses: [{ productId: 'rum', qty: 0.04 }] }],
    tabs: [{ id: 'T1', status: 'open', tableLabel: '4', saleIds: [] }],
    rorders: [
      { id: 'o1', no: '12', tabId: 'T1', tableLabel: '4', status: 'served', servedAt: '2026-11-21T19:00:00.000Z', servedBy: 'Bea', lines: [{ menuId: 'm33', name: '33 Export', qty: 3, price: 1000 }, { menuId: 'shot', name: 'Rum shot', qty: 5, price: 1500 }] },
      { id: 'o2', no: '13', tabId: 'T1', tableLabel: '4', status: 'accepted', lines: [{ menuId: 'm33', name: '33 Export', qty: 2, price: 1000 }] },
    ],
    sales: [], adjustments: [], transfers: [],
  };
}
test('Bar & Resto: a served ticket leaves the shelf at once; paying does not take it twice', () => {
  const raw = bar(); let C = KC.computeAll(raw);
  assert.equal(C.prodX.beer.available, 33, '36 bought − 3 served (the 2 not served yet stay)');
  near(C.prodX.rum.available, 1.8); assert.equal(C.prodX.beer.inService, 3);
  // the bill is paid: the sale takes 3 from the lots, nothing is "in service" any more
  raw.sales.push({ id: 'S1', no: '7', date: '2026-11-21', status: 'open', source: 'resto', tabId: 'T1', lines: [{ productId: 'm:m33', menuId: 'm33', name: '33 Export', qty: 3, unitPrice: 1000, alloc: [{ lotId: 'L1', qty: 3 }] }], payments: [{ amount: 3000 }] });
  raw.tabs[0].saleIds = ['S1']; C = KC.computeAll(raw);
  assert.equal(C.prodX.beer.available, 33, 'still 33: paying recorded what was served'); assert.ok(!C.prodX.beer.inService);
  // the bill closes: nothing more
  raw.tabs[0].status = 'paid'; C = KC.computeAll(raw); assert.equal(C.prodX.beer.available, 33);
  // a ticket not served yet takes nothing
  assert.deepEqual(KC.servedUnpaid({ tabs: [{ id: 'X', status: 'open' }], rorders: [{ tabId: 'X', status: 'ready', lines: [{ menuId: 'm33', qty: 9 }] }], menu: raw.menu }), {});
});
test('stock movements: purchase, served, correction, wastage — with before / after per item', () => {
  const raw = bar();
  raw.adjustments.push({ id: 'A1', lotId: 'L1', productId: 'beer', qty: -2, date: '2026-11-21', createdAt: '2026-11-21T20:00:00.000Z', cause: 'damaged', reason: 'Damaged in store', by: 'Cee' });
  raw.adjustments.push({ id: 'A2', lotId: 'L1', productId: 'beer', qty: 1, date: '2026-11-21', createdAt: '2026-11-21T21:00:00.000Z', reason: 'Found / extra', by: 'Cee' });
  const C = KC.computeAll(raw); const rows = KC.stockMovements(raw, C).filter((r) => r.productId === 'beer');
  assert.deepEqual(rows.map((r) => [r.type, r.dir * r.qty, r.before, r.after]), [['purchase', 36, 0, 36], ['served', -3, 36, 33], ['wastage', -2, 33, 31], ['correction', 1, 31, 32]]);
  assert.equal(rows[0].by, 'Ama'); assert.match(rows[1].ref, /Table 4 · order #12/); assert.equal(rows[1].by, 'Bea'); assert.equal(rows[2].ref, 'Damaged in store');
  assert.equal(rows[rows.length - 1].after, C.prodX.beer.available, 'the last balance is what is in stock');
  // paying the bill adds no second movement
  raw.sales.push({ id: 'S1', no: '7', date: '2026-11-21', status: 'open', source: 'resto', tabId: 'T1', lines: [{ productId: 'm:m33', menuId: 'm33', qty: 3, unitPrice: 1000, alloc: [{ lotId: 'L1', qty: 3 }] }] });
  raw.tabs[0].saleIds = ['S1']; const C2 = KC.computeAll(raw);
  assert.equal(KC.stockMovements(raw, C2).filter((r) => r.productId === 'beer').length, 4);
  // a shop sale (not a table bill) is a Sale
  raw.sales.push({ id: 'S2', no: '8', date: '2026-11-21', createdAt: '2026-11-21T22:00:00.000Z', status: 'open', customerName: 'Walk-in', createdBy: 'Dee', lines: [{ productId: 'beer', qty: 6, unitPrice: 900, alloc: [{ lotId: 'L1', qty: 6 }] }] });
  const r3 = KC.stockMovements(raw, KC.computeAll(raw)).filter((r) => r.productId === 'beer'); const last = r3[r3.length - 1];
  assert.deepEqual([last.type, last.qty, last.before, last.after, last.by], ['sale', 6, 32, 26, 'Dee']);
});

test('venue clock: the venue\'s time zone, whatever the phone says', () => {
  const at = new Date('2026-11-21T22:50:00.000Z'); // 23:50 in Douala (UTC+1)
  const d = KC.venueClock({}, at); assert.deepEqual([d.tz, d.date, d.time, d.mins, d.city], ['Africa/Douala', '2026-11-21', '23:50', 23 * 60 + 50, 'Douala']);
  const t = KC.venueClock({ timezone: 'Asia/Tokyo' }, at); assert.deepEqual([t.date, t.time], ['2026-11-22', '07:50'], 'Tokyo is already the next day');
  assert.equal(KC.venueClock({ timezone: 'Not/AZone' }, at).tz, 'Africa/Douala', 'an unknown zone falls back to Douala');
});

test('kitchen: a served dish takes its recipe from stock; it stays orderable; short ingredients are named; kitchen use is a movement', () => {
  const raw = { settings: {}, products: [{ id: 'beef', name: 'Beef', unit: 'kg', ingredient: { sku: 'ING-001' } }, { id: 'maggi', name: 'Maggi cubes', unit: 'cube' }, { id: 'onion', name: 'Onion', unit: 'kg' }],
    lots: [{ id: 'B1', productId: 'beef', qty: 2, unitCost: 3500, currency: 'XAF', inWarehouse: true, purchaseDate: '2026-11-22' }, { id: 'M1', productId: 'maggi', qty: 100, unitCost: 25, currency: 'XAF', inWarehouse: true, purchaseDate: '2026-11-22' }],
    menu: [{ id: 'nd', name: 'Ndolè with beef', price: 2500, kind: 'recipe', uses: [{ productId: 'beef', qty: 0.2 }, { productId: 'maggi', qty: 2 }, { productId: 'onion', qty: 0.1 }] }],
    tabs: [{ id: 'T', status: 'open' }], rorders: [{ id: 'o', tabId: 'T', status: 'served', servedAt: '2026-11-22T12:00:00.000Z', lines: [{ menuId: 'nd', name: 'Ndolè with beef', qty: 3 }] }],
    adjustments: [{ id: 'k1', lotId: 'B1', productId: 'beef', qty: -0.5, date: '2026-11-22', createdAt: '2026-11-22T13:00:00.000Z', cause: 'kitchen', reason: 'Staff meal' }], sales: [], transfers: [] };
  const C = KC.computeAll(raw);
  near(C.prodX.beef.available, 2 - 0.6 - 0.5); assert.equal(C.prodX.maggi.available, 94);
  assert.equal(KC.menuUnits(C, raw.menu[0], null), Infinity, 'a dish is never sold out because of one ingredient');
  assert.deepEqual(KC.recipeShort(C, raw.menu[0], null).map((x) => x.productId), ['onion'], 'onion is short');
  const mv = KC.stockMovements(raw, C).filter((r) => r.productId === 'beef');
  assert.deepEqual(mv.map((r) => r.type), ['purchase', 'served', 'used']); assert.equal(mv[2].ref, 'Staff meal'); near(mv[2].after, 0.9);
});

test('Capital & loans: monthly payment, owners and loans, starting capital, checks', () => {
  const s = KC.loanSchedule({ principal: 1200000, ratePct: 12, termMonths: 12, startDate: '2026-01-10' });
  assert.equal(s.emi, 106619); assert.equal(s.rows.length, 12); assert.equal(s.rows[0].due, '2026-02-10'); assert.equal(s.rows[0].interest, 12000); assert.equal(s.rows[11].balance, 0);
  assert.equal(KC.loanSchedule({ principal: 600000, ratePct: 0, termMonths: 6, startDate: '2026-01-31' }).rows[0].due, '2026-02-28'); // no interest: equal parts; month end kept
  const raw = { funders: [{ id: 'a', name: 'Mado', kind: 'equity', stakePct: 60 }, { id: 'b', name: 'Paul', kind: 'equity', stakePct: 40 }, { id: 'bk', name: 'Bank', kind: 'debt' }],
    loans: [{ id: 'l1', funderId: 'bk', principal: 1200000, ratePct: 12, termMonths: 12, startDate: '2026-01-10' }, { id: 'l0', funderId: 'bk', principal: 300000, ratePct: 10, termMonths: 6, startDate: '2026-01-01', opening: true }],
    capital: [{ id: 'opening', type: 'opening', date: '2026-01-01', cash: 500000, banks: [{ name: 'UBA', amount: 2000000 }], wallets: [{ name: 'MoMo', amount: 100000 }], stock: 1400000, equipment: 0 },
      { id: 'opi_a', type: 'injection', opening: true, date: '2026-01-01', funderId: 'a', amount: 2000000 }, { id: 'opi_b', type: 'injection', opening: true, date: '2026-01-01', funderId: 'b', amount: 1000000 },
      { id: 'e1', type: 'injection', date: '2026-02-01', funderId: 'a', amount: 500000 }, { id: 'e3', type: 'loan', date: '2026-01-10', loanId: 'l1', funderId: 'bk', amount: 1200000 },
      { id: 'e4', type: 'repayment', date: '2026-02-10', loanId: 'l1', amount: 106619, interest: 12000 }, { id: 'e5', type: 'drawing', date: '2026-03-01', funderId: 'a', amount: 200000 }] };
  const c = KC.capitalSummary(raw, { from: '2026-02-01', to: '2026-12-31' });
  assert.equal(c.equity, 3300000); assert.equal(c.debt, 1200000 - 94619 + 300000); assert.equal(c.stakeTotal, 100);
  assert.deepEqual(c.flows, { putIn: 500000, loansIn: 0, takenOut: 200000, principalPaid: 94619, interestPaid: 12000 });
  assert.equal(c.funders.a.opening, 2000000); assert.equal(c.funders.a.closing, 2300000); assert.equal(c.loans.l1.next.n, 2);
  assert.deepEqual(c.start, { money: 2600000, has: 4000000, loans: 300000, capital: 3000000, earlier: 700000 }); // profit kept from before
  assert.equal(KC.capitalInterest(raw, '2026-02-01', '2026-02-28'), 12000); assert.equal(KC.capitalInterest(raw, '2026-03-01', '2026-03-31'), 0);
  assert.match(KC.capitalCheck('funders', { id: 'c', name: 'Eric', kind: 'equity', stakePct: 1 }, raw), /more than 100%/);
  assert.equal(KC.capitalCheck('funders', { id: 'a', name: 'Mado', kind: 'equity', stakePct: 60 }, raw), '');
  assert.match(KC.capitalCheck('capital', { type: 'repayment', date: '2026-03-10', loanId: 'l1', amount: 2000000, interest: 0 }, raw), /more than is still owed/);
  assert.match(KC.capitalCheck('capital', { type: 'repayment', date: '2026-03-10', loanId: 'l1', amount: 1000, interest: 2000 }, raw), /interest part/);
  assert.match(KC.capitalCheck('capital', { type: 'transfer', date: '2026-03-10', funderId: 'a', toFunderId: 'a', stakePct: 5 }, raw), /who gives/);
  assert.match(KC.capitalCheck('loans', { principal: 1000, ratePct: 12, termMonths: 0, funderId: 'bk' }, raw), /between 1 and 600/);
  assert.equal(KC.capitalSummary({ funders: [], loans: [], capital: [] }).de, null);
});

test('Financials: cash ledger from every module, cash flow with carried balances, cash position by account', () => {
  const raw = { settings: { currency: 'XAF' }, suppliers: [{ id: 'sp', name: 'Brasseries' }], funders: [{ id: 'a', name: 'Mado', kind: 'equity', stakePct: 100 }, { id: 'bk', name: 'Bank', kind: 'debt' }], loans: [{ id: 'l1', funderId: 'bk', principal: 100000, ratePct: 12, termMonths: 10, startDate: '2026-02-01' }],
    sales: [{ id: 's1', no: 'S1', tip: 500, lines: [{ productId: 'p', qty: 1, unitPrice: 1000 }], payments: [{ date: '2026-02-03', amount: 1500, method: 'Cash' }] },
      { id: 's2', no: 'S2', lines: [{ productId: 'p', qty: 2, unitPrice: 1000 }], payments: [{ date: '2026-02-05', amount: 2000, method: 'MTN MoMo' }, { date: '2026-03-01', amount: -500, method: 'Cash' }] },
      { id: 's0', no: 'S0', lines: [{ productId: 'p', qty: 1, unitPrice: 9000 }], payments: [{ date: '2025-12-20', amount: 9000, method: 'Cash' }] }], // before the starting position: already in it
    expenses: [{ id: 'e1', date: '2026-02-10', category: 'Rent', amount: 800, method: 'Cash' }, { id: 'e2', date: '2026-03-10', category: 'Salaries & wages', amount: 1200, method: 'Orange Money' }],
    bills: [{ id: 'b1', supplierId: 'sp', amount: 3000, payments: [{ date: '2026-02-11', amount: 1000, method: 'Orange Money', fee: 20 }] }, { id: 'b2', supplierId: 'sp', amount: 50, currency: 'USD', fxRate: 600, payments: [{ date: '2026-03-12', amount: 10, method: 'Bank transfer' }] }, { id: 'bx', status: 'cancelled', payments: [{ date: '2026-02-12', amount: 999 }] }],
    assets: [{ id: 'as', name: 'Freezer', price: 5000, purchaseDate: '2026-03-05', paidBy: 'Cash', disposal: null }],
    claims: [{ id: 'cl', supplierId: 'sp', received: [{ date: '2026-03-15', amount: 300, method: 'Cash' }] }],
    capital: [{ id: 'opening', type: 'opening', date: '2026-01-01', cash: 10000, banks: [{ name: 'UBA', amount: 5000 }], wallets: [{ name: 'Orange Money 69…', amount: 2000 }] },
      { id: 'opi', type: 'injection', opening: true, date: '2026-01-01', funderId: 'a', amount: 17000 },
      { id: 'c1', type: 'injection', date: '2026-03-02', funderId: 'a', amount: 4000, method: 'Bank' }, { id: 'c2', type: 'loan', date: '2026-02-01', loanId: 'l1', funderId: 'bk', amount: 100000, method: 'Bank' },
      { id: 'c3', type: 'repayment', date: '2026-03-01', loanId: 'l1', amount: 10558, interest: 1000, method: 'Bank' }, { id: 'c4', type: 'drawing', date: '2026-03-20', funderId: 'a', amount: 700, method: 'Cash' }] };
  const L = KC.cashLedger(raw, raw.settings);
  assert.equal(L.filter((x) => x.key === 'sales').reduce((a, x) => a + x.amount, 0), 1000 + 2000 + 9000); assert.equal(L.find((x) => x.key === 'tips').amount, 500);
  assert.equal(L.find((x) => x.key === 'refunds').amount, 500); assert.equal(L.find((x) => x.key === 'fees').amount, 20); assert.equal(L.filter((x) => x.key === 'stock').reduce((a, x) => a + x.amount, 0), 1000 + 6000);
  assert.ok(!L.some((x) => x.id === 'bx') && !L.some((x) => x.id === 'opi')); assert.equal(L.find((x) => x.key === 'exp:Salaries & wages').account, 'Orange Money');
  assert.equal(L.find((x) => x.key === 'assetBuy').amount, 5000); assert.equal(L.find((x) => x.key === 'claims').amount, 300);
  assert.equal(L.find((x) => x.key === 'principal').amount, 9558); assert.equal(L.find((x) => x.key === 'interest').amount, 1000);
  const cf = KC.cashFlow(raw, raw.settings, { from: '2026-01-01', to: '2026-03-31', by: 'month' });
  assert.equal(cf.opening, 17000); // the starting money; the December sale is already in it
  const [jan, feb, mar] = cf.periods; assert.equal(jan.net, 0); assert.equal(feb.opening, jan.closing); assert.equal(mar.opening, feb.closing);
  assert.equal(feb.sec.in, 3500); assert.equal(feb.sec.out, -1820); assert.equal(feb.sec.fin, 100000); assert.equal(feb.net, 101680);
  assert.equal(mar.sec.inv, -5000); assert.equal(mar.sec.fin, 4000 - 9558 - 700); assert.equal(Math.round(mar.sec.out), -(500 + 1200 + 6000 + 1000)); assert.equal(mar.sec.in, 300);
  assert.equal(cf.closing, KC.cashPosition(raw, raw.settings).total); // the statement ends where the accounts are
  assert.equal(cf.sections.find((s) => s.key === 'out').rows.find((r) => r.key === 'exp:Rent').cells[1], -800);
  const pos = KC.cashPosition(raw, raw.settings).accounts; assert.equal(pos.Cash, 10000 + 1000 - 800 - 500 - 5000 + 300 - 700 + 500); assert.equal(pos['Orange Money'], 2000 - 1020 - 1200);
  const cash = KC.cashFlow(raw, raw.settings, { from: '2026-01-01', to: '2026-03-31', by: 'quarter', account: 'Cash' }); assert.equal(cash.opening, 10000); assert.equal(cash.closing, pos.Cash);
  assert.equal(KC.cfPeriods('2026-11-01', '2026-11-30', 'day').length, 30); assert.equal(KC.cfPeriods('2026-01-01', '2026-03-31', 'all').length, 1);
});

test('Staff control: clock in only at work, who must clock in, stock caps per role, bar hands out drinks', () => {
  const S = { clockRequired: true, clockGeo: { main: { lat: 4.0511, lng: 9.7679, radius: 30 }, b2: { lat: 4.06, lng: 9.7, radius: 3 } }, roles: { sales: { stockCap: 30 }, viewer: { stockCap: 'hide' } } };
  assert.ok(Math.abs(KC.geoDistance({ lat: 4.0511, lng: 9.7679 }, { lat: 4.0521, lng: 9.7679 }) - 111) < 2);
  assert.equal(KC.clockWhere(S, 'main', { lat: 4.0512, lng: 9.7679 }), ''); // 11 m
  assert.match(KC.clockWhere(S, 'main', { lat: 4.0611, lng: 9.7679 }), /1\.1 km from work/);
  assert.match(KC.clockWhere(S, 'main', null), /Turn on location/);
  assert.equal(KC.clockPlace(S, 'b2').radius, KC.GEO_MIN_RADIUS); // 3 m is below what GPS can do
  assert.equal(KC.clockWhere(S, 'other', null), ''); // no place set: anywhere
  assert.equal(KC.mustClock(S, 'owner'), false); assert.equal(KC.mustClock(S, 'sales'), true); assert.equal(KC.mustClock({}, 'sales'), true); assert.equal(KC.mustClock({ clockRequired: false }, 'sales'), false);
  const now = new Date().toISOString(); const d = KC.localDay(new Date());
  assert.equal(KC.isClockedIn({ attendance: [{ id: 'at_' + d + '_s1', date: d, events: [{ t: 'in', at: now }] }] }, 's1', now, {}), true);
  assert.equal(KC.isClockedIn({ attendance: [{ id: 'at_' + d + '_s1', date: d, events: [{ t: 'in', at: now }, { t: 'break', at: now }] }] }, 's1', now, {}), false); // on a break
  assert.equal(KC.stockCapOf(S, 'sales'), 30); assert.equal(KC.stockCapOf(S, 'viewer'), 0); assert.equal(KC.stockCapOf(S, 'owner'), null); assert.equal(KC.stockCapOf(S, 'manager'), null);
  assert.equal(KC.stockShown(1000, 30), '30+'); assert.equal(KC.stockShown(12, 30), null); assert.equal(KC.stockShown(5, 0), 'In stock'); assert.equal(KC.stockShown(0, 0), 'Sold out'); assert.equal(KC.stockShown(1000, null), null);
  const o = { lines: [{ menuId: 'beer', qty: 2, station: 'bar' }, { menuId: 'fish', qty: 1, station: 'kitchen' }], status: 'ready' };
  assert.equal(KC.serveBlocked(o, { barHandover: true }), true); assert.equal(KC.serveBlocked(o, {}), false);
  assert.deepEqual(KC.orderOuts(o, { barHandover: true }), []); // ordered, not handed: nothing leaves
  const h = Object.assign({}, o, { handedAt: '2026-11-27T10:00:00Z' });
  assert.deepEqual(KC.orderOuts(h, { barHandover: true }).map((g) => [g.key, g.lines.map((l) => l.menuId)]), [['hand', ['beer']]]);
  const sv = Object.assign({}, h, { status: 'served', servedAt: '2026-11-27T10:05:00Z' });
  assert.deepEqual(KC.orderOuts(sv, { barHandover: true }).map((g) => [g.key, g.lines.map((l) => l.menuId)]), [['hand', ['beer']], ['srv', ['fish']]]); // never twice
  assert.deepEqual(KC.orderOuts(sv, {}).map((g) => [g.key, g.lines.length]), [['srv', 2]]); // small bar: all at served, as before
  // stock: a served-unpaid bill with handed drinks takes them off the shelf once
  const raw = { settings: { barHandover: true }, menu: [{ id: 'beer', uses: [{ productId: 'p', qty: 1 }] }], tabs: [{ id: 't', status: 'open', saleIds: [] }], rorders: [Object.assign({ tabId: 't' }, sv)], sales: [], lots: [{ id: 'l', productId: 'p', qty: 10, unitCost: 1, inWarehouse: true, sourceType: 'Local (Cameroon)' }], products: [{ id: 'p', name: 'Beer' }] };
  const C = KC.computeAll(raw); assert.equal(C.prodX.p.inService, 2); assert.equal(C.prodX.p.available, 8);
});
