// Creates a demo business with realistic data so a developer can explore every screen.
// Usage: node scripts/seed-demo.js   → owner demo@aahsso.app · manager manager@aahsso.app · sales rep jenny@aahsso.app (password demo1234 for all)
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { tx, pool } = require('../src/db');
const KC = require('../public/compute.js');

const LOGIN = process.env.DEMO_LOGIN || 'demo@aahsso.app', PASS = process.env.DEMO_PASS || 'demo1234';
const d = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
const id = (p) => p + Math.random().toString(36).slice(2, 10);

(async () => {
  await tx(async (c) => {
    const old = (await c.query('SELECT tenant_id FROM users WHERE login=$1', [LOGIN])).rows[0];
    if (old) await c.query('DELETE FROM tenants WHERE id=$1', [old.tenant_id]);
    const t = (await c.query("INSERT INTO tenants(name, trial_ends_at) VALUES ('Demo Imports SARL', now() + interval '30 days') RETURNING id")).rows[0].id;
    const owner = (await c.query("INSERT INTO users(tenant_id,name,login,password_hash,role) VALUES ($1,'Demo Owner',$2,$3,'owner') RETURNING id", [t, LOGIN, await bcrypt.hash(PASS, 10)])).rows[0].id;
    await c.query("DELETE FROM users WHERE login IN ('jenny@aahsso.app','manager@aahsso.app')");
    await c.query("INSERT INTO users(tenant_id,name,login,password_hash,role,location_id) VALUES ($1,'Jenny (sales)','jenny@aahsso.app',$2,'sales','akwa')", [t, await bcrypt.hash(PASS, 10)]);
    await c.query("INSERT INTO users(tenant_id,name,login,password_hash,role) VALUES ($1,'Mike (manager)','manager@aahsso.app',$2,'manager')", [t, await bcrypt.hash(PASS, 10)]);
    const put = (col, doc) => c.query('INSERT INTO documents(tenant_id,collection,id,data,updated_by) VALUES ($1,$2,$3,$4,$5)', [t, col, doc.id, JSON.stringify(Object.assign({}, doc, { id: undefined, createdAt: new Date().toISOString() })), owner]);
    const raw = { settings: Object.assign({}, KC.DEFAULT_SETTINGS, { id: 'main', businessName: 'Demo Imports SARL', phone: '+237 677 00 00 00', momoAccounts: [{ method: 'MTN MoMo', number: '677000111', label: 'Shop MoMo' }], defaultCreditLimit: 300000 }), products: [], lots: [], shipments: [], sales: [], adjustments: [], transfers: [] };
    await put('settings', raw.settings);
    await put('locations', { id: 'akwa', name: 'Akwa shop', type: 'Shop' });
    const items = [
      ['Quaker Oats Old Fashioned 2.6kg', 'Food & Snacks', 'Cereal & Oats', 9.98, 12.99, 40, d(140)], ['Blue Diamond Almonds 1.36kg', 'Food & Snacks', 'Nuts & Dried Fruit', 11.49, 15.99, 30, d(45)],
      ['Kirkland Water 40-pack (per bottle)', 'Beverages', 'Water', 0.125, 0.16, 400, d(300)], ['Nutella 1kg', 'Food & Snacks', 'Sauces & Spices', 7.5, 9.49, 36, d(20)],
      ['Samsung 55" Crystal UHD TV', 'Electronics', 'TV', 380, 499, 4, ''], ['JBL Flip 6 Speaker', 'Electronics', 'Speakers & Audio', 62, 129.99, 8, ''],
      ['Tide Pods 81ct', 'Household', 'Laundry', 18.99, 24.99, 24, ''], ['Toyota RAV4 2015', 'Vehicles', 'Car', 6500, 0, 1, ''],
    ];
    const ship = { id: 'sh_demo1', name: 'Container #1 – demo', containerNo: 'MSCU1234567', bookingNo: 'BK-889', size: "40' HC", carrier: 'MSC', origin: 'Houston, TX', destination: 'Douala, Cameroon', status: 'received', receivedAt: d(-20), locationId: 'main', fxRates: { USD: 600 }, fxRate: 600,
      costs: [{ id: 'k1', side: 'US', category: 'Ocean freight', amount: 3200, currency: 'USD', appliesTo: 'all' }, { id: 'k2', side: 'US', category: 'BESC (cargo tracking note)', amount: 400, currency: 'USD', appliesTo: 'all' }, { id: 'k3', side: 'CM', category: 'Customs duties – goods', amount: 1800000, currency: 'XAF', appliesTo: 'goods' }] };
    raw.shipments.push(ship);
    items.forEach(([name, cat, sub, cost, reg, qty, exp]) => {
      const p = { id: id('pr_'), name, category: cat, subcategory: sub, condition: 'New', unit: 'piece' }; raw.products.push(p);
      raw.lots.push({ id: id('l_'), productId: p.id, purchaseDate: d(-60), sourceType: 'Store', vendor: cat === 'Electronics' ? 'B-Stock' : 'Costco', currency: 'USD', unitCost: cost, regularPrice: reg || null, qty, expiry: exp, condition: 'New', shipmentId: ship.id });
    });
    const car = raw.lots.find((l) => raw.products.find((p) => p.id === l.productId).category === 'Vehicles');
    ship.costs.push({ id: 'k4', side: 'CM', category: 'Customs duties – vehicles', amount: 2500000, currency: 'XAF', appliesTo: car.id });
    // a second container still at sea
    const ship2 = { id: 'sh_demo2', name: 'Container #2 – at sea', containerNo: 'MSCU7654321', status: 'in_transit', fxRates: { USD: 605 }, fxRate: 605, costs: [{ id: 'k5', side: 'US', category: 'Ocean freight', amount: 3300, currency: 'USD', appliesTo: 'all' }] };
    raw.shipments.push(ship2); raw.lots.push({ id: id('l_'), productId: raw.products[0].id, purchaseDate: d(-10), sourceType: 'Store', vendor: 'Costco', currency: 'USD', unitCost: 9.49, regularPrice: 12.99, qty: 60, shipmentId: ship2.id });
    for (const s of raw.shipments) await put('shipments', s);
    for (const p of raw.products) await put('products', p);
    for (const l of raw.lots) await put('lots', l);
    // transfer to the shop
    let C = KC.computeAll(raw);
    const tr = { id: 'tr_demo', no: 'T-DEMO', date: d(-15), from: 'main', to: 'akwa', status: 'received', reason: 'Restock a branch', lines: [{ productId: raw.products[0].id, qty: 10, receivedQty: 10, alloc: KC.allocate(C, raw.lots, raw.products[0].id, 10, {}, null, 'main') }] };
    raw.transfers.push(tr); await put('transfers', tr);
    // customers
    const custs = [['Paul Reseller', '677555444', 'Reseller'], ['Marie Ngo', '699111222', 'Retail'], ['Alice Boutique', '670101010', 'Wholesale']].map(([name, phone, type]) => ({ id: id('c_'), name, phone, whatsapp: phone, type, city: 'Douala' }));
    for (const cu of custs) await put('customers', cu);
    // 30 days of sales
    C = KC.computeAll(raw);
    const methods = ['Cash', 'MTN MoMo', 'Orange Money'];
    for (let i = 0; i < 45; i++) {
      C = KC.computeAll(raw);
      const p = raw.products[i % 7]; const px = C.prodX[p.id]; const qty = 1 + (i % 3); const loc = i % 4 === 0 ? 'akwa' : 'main';
      const cu = i % 3 === 0 ? custs[i % custs.length] : null;
      const alloc = KC.allocate(C, raw.lots, p.id, qty, {}, cu ? cu.id : null, loc); if (!alloc) continue;
      const price = KC.autoPrice(C, p.id, qty, cu); const total = price * qty; const paid = cu && i % 6 === 0 ? Math.round(total / 2) : total;
      const date = d(-(i % 28)); const s = { id: id('s_'), no: 'S-DEMO-' + (100 + i), date, createdAt: date + 'T' + String(9 + (i % 9)).padStart(2, '0') + ':15:00.000Z', createdBy: 'Demo Owner', createdById: owner, locationId: loc, customerId: cu ? cu.id : null, customerName: cu ? cu.name : 'Walk-in customer', customerPhone: cu ? cu.phone : '', status: 'open', delivered: true, discount: 0,
        lines: [{ productId: p.id, name: p.name, qty, unitPrice: price, alloc, returns: [] }], payments: [{ id: id('p_'), date, method: methods[i % 3], amount: paid, by: 'Demo Owner', byId: owner }] };
      if (paid < total) s.dueDate = d(-(i % 28) + 14);
      raw.sales.push(s); await put('sales', s);
    }
    await put('adjustments', { id: 'a_demo', date: d(-3), productId: raw.products[1].id, lotId: raw.lots[1].id, qty: -1, locationId: 'main', reason: 'Missing / theft', notes: 'demo' });
    await put('expenses', { id: 'e_demo', date: d(-2), category: 'Warehouse rent', amount: 150000, method: 'Cash', description: 'Monthly rent', locationId: 'main' });
    await put('suppliers', { id: 'su_demo', name: 'Houston Drayage LLC', type: 'Trucker' });
    // business assets (equipment & vehicles the business uses)
    await put('assets', { id: 'as_demo1', tag: 'A-0001', name: 'Electric stacker 1.5 t', category: 'Warehouse equipment', make: 'Toyota', serialNo: 'SN-77881', condition: 'Used', purchaseDate: d(-200), vendor: "Sam's Club Houston", price: 3000, currency: 'USD', extraCosts: 200000, shipmentId: 'sh_demo1', paidBy: 'Card / US account', locationId: 'main', assignedTo: 'Mike (manager)', status: 'in_use', depMethod: 'straight', usefulLife: 7, nextServiceDate: d(12), history: [{ id: 'h1', date: d(-200), by: 'Demo Owner', text: 'Registered at Main warehouse' }] });
    await put('assets', { id: 'as_demo2', tag: 'A-0002', name: 'Toyota Dyna delivery truck', category: 'Vehicles', serialNo: 'LT 456 AB', condition: 'Used', purchaseDate: d(-90), vendor: 'Garage Akwa', price: 8500000, currency: 'XAF', paidBy: 'Not paid yet', locationId: 'akwa', assignedTo: 'Driver Paul', status: 'in_use', depMethod: 'straight', usefulLife: 5, insuranceUntil: d(20), history: [{ id: 'h2', date: d(-90), by: 'Demo Owner', text: 'Registered at Akwa shop' }] });
    await put('assets', { id: 'as_demo3', tag: 'A-0003', name: 'Generator 20 kVA', category: 'Generators & power', purchaseDate: d(-400), price: 2400000, currency: 'XAF', paidBy: 'Cash', locationId: 'main', status: 'in_use', usefulLife: 5 });
    await put('suppliers', { id: 'su_garage', name: 'Garage Akwa', type: 'Other' });
    await put('bills', { id: 'b_truck', supplierId: 'su_garage', description: 'Asset: Toyota Dyna delivery truck (A-0002)', amount: 8500000, currency: 'XAF', date: d(-90), dueDate: d(30), assetId: 'as_demo2', payments: [{ id: 'bp1', amount: 3000000, method: 'Bank transfer', date: d(-60) }] });
    await put('expenses', { id: 'e_fuel', date: d(-4), category: 'Fuel', amount: 60000, method: 'Cash', description: 'Diesel 80 L', locationId: 'akwa', assetId: 'as_demo2' });
    await put('bills', { id: 'b_demo', supplierId: 'su_demo', description: 'Trucking for container #2', amount: 450, currency: 'USD', date: d(-10), dueDate: d(4), shipmentId: ship2.id, payments: [] });
  });
  console.log('Demo business ready → owner: ' + LOGIN + ' / ' + PASS + '   manager: manager@aahsso.app / ' + PASS + '   sales rep: jenny@aahsso.app / ' + PASS);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
