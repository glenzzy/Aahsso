"""Comprehensive end-to-end audit of the hosted build (claude.ai runtime simulated by shim.js).
Runs every screen and business flow as the owner on a phone, then crawls every screen on desktop,
then repeats the crawl as a sales rep and a custom-role user. Fails on any page error."""
import asyncio, json, sys, os
from playwright.async_api import async_playwright
U = 'http://localhost:8765/index.html'
LIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'node_modules') + '/'
CDN = {'xlsx.full.min.js': LIB + 'xlsx/dist/xlsx.full.min.js', 'jspdf.umd.min.js': LIB + 'jspdf/dist/jspdf.umd.min.js', 'JsBarcode.all.min.js': LIB + 'jsbarcode/dist/JsBarcode.all.min.js'}
RESULTS = []
def ok(name, cond, info=''):
    RESULTS.append((name, bool(cond), info)); print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(info) if info and not cond else ''))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--no-sandbox'])
        async def new_ctx(w=390, h=844):
            ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2)
            await ctx.add_init_script(path='shim.js')
            async def cdn(route):
                name = route.request.url.split('/')[-1]
                await route.fulfill(path=CDN[name], content_type='application/javascript') if name in CDN else await route.abort()
            await ctx.route('https://cdnjs.cloudflare.com/**', cdn)
            await ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            await ctx.route('**/_blob/**', lambda r: r.fulfill(path='fixtures/oats.jpg', content_type='image/jpeg'))
            return ctx
        errs = []
        def watch(pg, who):
            pg.on('pageerror', lambda e: errs.append(who + ' PAGEERROR ' + str(e)))
            pg.on('console', lambda m: errs.append(who + ' CONSOLE ' + m.text) if m.type == 'error' and 'favicon' not in m.text else None)
        async def closeall(pg):
            for _ in range(8):
                if not await pg.query_selector('.scrim'): break
                await pg.click('.scrim >> nth=-1 >> .sh [data-a=sheetClose] >> nth=-1'); await pg.wait_for_timeout(120)
        async def goto(pg, route, who='owner'):
            await pg.goto(U + '?as=' + who + '#' + route); await pg.wait_for_timeout(350)
        async def text(pg, sel='#view'): return await pg.inner_text(sel)
        async def dl(pg, name_part):
            return await pg.evaluate("(n)=>{const k=Object.keys(window.__blobs||{}).find(x=>x.includes(n)); return k ? {name:k, size: window.__blobs[k].size} : null}", name_part)
        async def choose(pg, click_sel, path):
            async with pg.expect_file_chooser() as fc: await pg.click(click_sel)
            await (await fc.value).set_files(path); await pg.wait_for_timeout(500)

        ctx = await new_ctx(); o = await ctx.new_page(); watch(o, 'OWNER')
        # ---------- 1. setup ----------
        await goto(o, 'settings'); await o.wait_for_timeout(900)
        ok('App opens to settings for owner', 'Backup & restore' in await text(o))
        await o.fill('[name=businessName]', 'Bullekam Trading'); await o.fill('[name=phone]', '+237 677 00 00 00')
        await choose(o, '[data-a=logoUp]', 'fixtures/oats.jpg')
        await o.click('[data-a=mmAdd]'); await o.fill('[name=mmNumber0]', '677000111'); await o.fill('[name=mmLabel0]', 'Shop MoMo')
        await o.fill('[name=defaultCreditLimit]', '200000')
        await o.click('[data-a=saveSettings]'); await o.wait_for_timeout(400)
        await o.reload(); await o.wait_for_timeout(1200)
        st = await o.evaluate('JSON.stringify({n:S().businessName, logo: !!S().logo, mm: S().momoAccounts.length, cl: S().defaultCreditLimit})')
        ok('Settings persist after reload (name, logo, MoMo, credit limit)', json.loads(st) == {'n': 'Bullekam Trading', 'logo': True, 'mm': 1, 'cl': 200000}, st)
        await o.click('[data-a=locEdit] >> text=Add branch'); await o.fill('.scrim [name=name]', 'Akwa shop'); await o.click('#lcSave'); await o.wait_for_timeout(300)
        ok('Branch created', 'Akwa shop' in await text(o))
        # ---------- 2. purchases: manual (pack split, photo), import manifest, template ----------
        await goto(o, 'buy'); await o.click('[data-a=tplPurch]'); await o.wait_for_timeout(400)
        ok('Purchase template downloads (xlsx)', await dl(o, 'Purchase-template'))
        await o.click('text=Add purchase'); await o.wait_for_timeout(200)
        await o.fill('[name=vendor]', 'Costco'); await o.fill('[name=poNumber]', 'PO-1001')
        await choose(o, '#lineForm .photo-slot', 'fixtures/oats.jpg')
        await o.fill('#lnName', 'Quaker Oats Old Fashioned'); await o.select_option('#lineForm [name=unit]', 'pack'); await o.fill('#lineForm [name=size]', '2.6'); await o.select_option('#lineForm [name=sizeUnit]', 'kg')
        conv = await o.inner_text('#lineForm [data-conv]'); ok('Unit conversion shown while typing (2.6 kg → lb)', '5.73 lb' in conv, conv)
        await o.fill('#lineForm [name=qty]', '12'); await o.fill('#lineForm [name=regularPrice]', '12.99'); await o.fill('#lineForm [name=unitCost]', '9.98'); await o.fill('#lineForm [name=expiry]', '2027-03-31'); await o.click('#lnAdd')
        await o.fill('#lnName', 'Kirkland Water 40-pack'); await o.fill('#lineForm [name=qty]', '5'); await o.fill('#packOf', '40'); await o.fill('#lineForm [name=unitCost]', '4.99'); await o.click('#lnAdd')
        await o.fill('#lnName', 'Toyota RAV4 2015'); await o.select_option('#lnCat', 'Vehicles'); await o.fill('#lineForm [name=qty]', '1'); await o.fill('#lineForm [name=unitCost]', '6500'); await o.click('#lnAdd')
        await o.click('#puSave'); await o.wait_for_timeout(1500)
        lots = await o.evaluate('JSON.stringify(K.raw.lots.map(l=>[l.qty, Math.round(l.unitCost*1000)/1000]))')
        ok('Purchase saved; 40-pack split into 200 units', '[200,0.125]' in lots, lots)
        await o.click('[data-a=importPurch]') if False else None
        async with o.expect_file_chooser() as fc: await o.click('[data-a=importPurch]')
        await (await fc.value).set_files('fixtures/manifest.xlsx'); await o.wait_for_timeout(800)
        imp = await text(o, '.scrim'); ok('B-Stock manifest read (3 lines)', 'Import 3 lines' in imp, imp[:120])
        await o.fill('[name=lotTotal]', '600'); await o.click('#impGo'); await o.wait_for_timeout(1500)
        spread = await o.evaluate("JSON.stringify(K.raw.lots.filter(l=>l.vendor==='B-Stock').map(l=>Math.round(l.unitCost*l.qty*100)/100))")
        tot = sum(json.loads(spread)); ok('Manifest lot total spread across items = $600', abs(tot - 600) < 0.05, spread)
        # ---------- 3. container: items, costs, statuses, receive ----------
        await goto(o, 'containers'); await o.click('text=New container'); await o.fill('[name=containerNo]', 'MSCU1234567'); await o.fill('[name=bookingNo]', 'BK-889'); await o.click('#sSave'); await o.wait_for_timeout(600)
        await o.click('[data-a=shTab][data-v=items]'); await o.click('[data-a=shAddItems]'); await o.wait_for_timeout(200); await o.click('#afGo'); await o.wait_for_timeout(1200)
        ok('All US-storage items added to container', 'Toyota' in await text(o, '.scrim'))
        await o.click('[data-a=shTab][data-v=costs]')
        for side, amt, cat, unpaid in [('US', '3200', 'Ocean freight', False), ('US', '450', 'Trucking / drayage', True), ('CM', '1800000', 'Customs duties – goods', False)]:
            await o.click(f'[data-a=shCost][data-side={side}]'); await o.wait_for_timeout(150)
            await o.select_option('.scrim >> nth=-1 >> [name=category]', cat); await o.fill('.scrim >> nth=-1 >> [name=amount]', amt)
            if unpaid:
                await o.check('#ccUnpaid'); await o.select_option('#ccSup [name=supplierId]', '__new'); await o.fill('#ccSup [name=newSupplier]', 'Houston Drayage LLC')
            await o.click('#cSave'); await o.wait_for_timeout(500)
        await o.click('[data-a=shCost][data-side=CM]'); await o.select_option('.scrim >> nth=-1 >> [name=category]', 'Customs duties – vehicles'); await o.fill('.scrim >> nth=-1 >> [name=amount]', '2500000')
        car = await o.eval_on_selector('.scrim >> nth=-1 >> [name=appliesTo]', "e=>[...e.options].find(x=>x.text.includes('Toyota')).value"); await o.select_option('.scrim >> nth=-1 >> [name=appliesTo]', car); await o.click('#cSave'); await o.wait_for_timeout(500)
        landed_car = await o.evaluate("Math.round(K.C.lotX[K.raw.lots.find(l=>K.C.prodById[l.productId].name.startsWith('Toyota')).id].landedUnit)")
        ok('Car customs charged to the car only (≥ 6500×600 + 2.5M)', landed_car >= 6500 * 600 + 2500000, landed_car)
        await o.click('[data-a=shTab][data-v=sum]')
        for _ in range(4): await o.click('[data-a=shAdvance]'); await o.wait_for_timeout(300)
        stt = await o.evaluate("K.raw.shipments[0].status"); ok('Container moved through statuses to Cleared', stt == 'cleared', stt)
        sell_before = await o.evaluate("Object.values(K.C.prodX).reduce((a,x)=>a+x.available,0)"); ok('Nothing sellable before receiving', sell_before == 0, sell_before)
        await o.click('[data-a=shTab][data-v=recv]'); await o.wait_for_timeout(200)
        await o.fill('[data-rv=recvMissing] >> nth=0', '1'); await o.fill('[data-rv=recvDamaged] >> nth=1', '2')
        await o.click('[data-a=shReceive]'); await o.click('#cbOk'); await o.wait_for_timeout(800); await closeall(o)
        avail = await o.evaluate("Object.values(K.C.prodX).reduce((a,x)=>a+x.available,0)"); ok('Stock available after receiving (minus missing/damaged)', avail > 200, avail)
        # ---------- 4. prices, labels ----------
        await goto(o, 'stock'); await o.click('[data-a=pricing]'); await o.wait_for_timeout(300)
        await o.fill('#bulkMk', '100'); await o.fill('#bulkMn', '50'); await o.click('#bulkGo'); await o.click('#prSave'); await o.wait_for_timeout(1000)
        pm = await o.evaluate("(()=>{const p=K.raw.products.find(x=>x.name.startsWith('Quaker')); const x=K.C.prodX[p.id]; return [x.priceMax, Math.round(x.avgCost)]})()")
        ok('Bulk 100% markup applied (price ≈ 2 × cost)', pm[0] >= pm[1] * 2 and pm[0] <= pm[1] * 2 + 50, pm)
        await o.click('[data-a=labels]'); await o.wait_for_timeout(300); await o.check('[data-lb] >> nth=0'); await o.click('#lbGo'); await o.wait_for_timeout(1500)
        lb = await dl(o, 'Labels'); ok('Barcode labels PDF generated', lb and lb['size'] > 2000, lb)
        await goto(o, 'stock'); await o.click('#stockList .li >> nth=0'); await o.click('[data-a=itemHistory]'); await o.wait_for_timeout(300)
        ok('Item history opens', 'Purchase history' in await text(o, '.scrim')); await closeall(o)
        # ---------- 5. selling: walk-in, customer, wholesale, deposit, reserved, receipt ----------
        await goto(o, 'customers'); await o.click('[data-a=newCust]'); await o.fill('[name=name]', 'Paul Reseller'); await o.fill('[name=phone]', '677555444'); await o.select_option('.scrim [name=type]', 'Reseller'); await o.click('#cSave'); await o.wait_for_timeout(300)
        async with o.expect_file_chooser() as fc: await o.click('[data-a=importCust]')
        await (await fc.value).set_files('fixtures/customers.xlsx'); await o.wait_for_timeout(500); await o.click('#cbOk'); await o.wait_for_timeout(800)
        ok('Customers imported from Excel', 'Alice Reseller' in await text(o))
        await goto(o, 'sell'); ok('POS starts as Walk-in customer', 'Walk-in customer' in await text(o, '#posCust'))
        await o.click('.pt:has-text("Quaker")'); await o.click('.pt:has-text("Quaker")'); await o.click('#cartbar'); await o.click('.scrim [data-a=checkout]'); await o.wait_for_timeout(200)
        await o.click('[data-a=pmPick][data-v="MTN MoMo"]'); await o.select_option('#payAccount', '677000111'); await o.fill('[name=payRef]', 'MP2611071234')
        await o.click('#doSell'); await o.wait_for_timeout(600); ok('Walk-in MoMo sale → receipt', await o.query_selector('#rcpt'))
        await o.click('[data-a=rcPdf]'); await o.wait_for_timeout(800); rp = await dl(o, 'Receipt-'); ok('Receipt PDF generated', rp and rp['size'] > 1500, rp)
        wa = await o.get_attribute('.scrim a[href*="wa.me"]', 'href'); ok('WhatsApp receipt link prepared', wa and 'text=' in wa)
        await closeall(o)
        # walk-in cannot owe
        await o.click('.pt:has-text("Quaker")'); await o.click('#cartbar'); await o.click('.scrim [data-a=checkout]'); await o.fill('#payAmount', '0'); await o.click('#doSell'); await o.wait_for_timeout(300)
        t = await o.inner_text('.toast'); ok('Walk-in unpaid sale blocked', 'customer' in t.lower(), t); await closeall(o)
        # wholesale customer + deposit + due date
        await o.evaluate("K.cart.customerId = K.raw.customers.find(c=>c.name==='Paul Reseller').id; K.cart.lines.forEach(reprice); refreshPOS()")
        ws = await o.evaluate("(()=>{const l=K.cart.lines[0]; const x=K.C.prodX[l.productId]; return [l.unitPrice, x.priceWholesale, x.priceMax]})()")
        ok('Reseller gets wholesale price automatically', ws[0] == ws[1] and ws[1] < ws[2], ws)
        await o.click('#cartbar'); await o.click('.scrim [data-a=checkout]'); await o.wait_for_timeout(200); await o.fill('#payAmount', '1000'); await o.click('#doSell'); await o.wait_for_timeout(600); await closeall(o)
        dep = await o.evaluate("(()=>{const s=K.raw.sales.find(s=>s.customerName==='Paul Reseller'); return [K.C.saleX[s.id].status, !!s.dueDate]})()")
        ok('Deposit sale: status partial with pay-by date', dep == ['partial', True], dep)
        # add payment to finish
        await goto(o, 'sales'); await o.click('[data-a=salesStatus][data-v=owing]'); await o.click('[data-a=openSale]'); await o.click('[data-a=addPay]'); await o.click('#pSave'); await o.wait_for_timeout(500); await closeall(o)
        dep2 = await o.evaluate("K.C.saleX[K.raw.sales.find(s=>s.customerName==='Paul Reseller').id].status"); ok('Balance paid → Paid', dep2 == 'paid', dep2)
        # reserved order then pickup
        await goto(o, 'sell'); await o.evaluate("K.cart.customerId = K.raw.customers.find(c=>c.name==='Alice Reseller').id; refreshPOS()")
        await o.click('.pt:has-text("Kirkland")'); await o.click('#cartbar'); await o.click('.scrim [data-a=checkout]'); await o.wait_for_timeout(200); await o.select_option('[name=delivered]', 'no'); await o.fill('#payAmount', '0'); await o.click('#doSell'); await o.wait_for_timeout(600); await closeall(o)
        await goto(o, 'sales'); await o.click('[data-a=salesStatus][data-v=pickup]'); ok('Reserved order listed under Awaiting pickup', 'Alice' in await text(o))
        await o.click('[data-a=openSale]'); await o.click('[data-a=markPicked]'); await o.wait_for_timeout(400); await closeall(o)
        # return + cancel with reasons
        await o.click('[data-a=salesStatus][data-v=all]'); await o.click('[data-a=openSale] >> nth=-1'); await o.click('[data-a=returnSale]'); await o.fill('[data-ret] >> nth=0', '1'); await o.click('#rSave'); await o.wait_for_timeout(500); await closeall(o)
        await o.click('[data-a=openSale] >> nth=0'); await o.click('[data-a=cancelSale]'); await o.click('#rsnOk'); await o.wait_for_timeout(500); await closeall(o)
        ok('Return and cancel recorded', await o.evaluate("K.raw.sales.some(s=>s.status==='cancelled') && K.raw.sales.some(s=>s.lines.some(l=>(l.returns||[]).length))"))
        # ---------- 6. money: expense, cash handover, bills, reminders ----------
        await goto(o, 'expenses'); await o.click('[data-a=expEdit]'); await o.fill('.scrim [name=amount]', '25000'); await o.fill('.scrim [name=description]', 'Warehouse guard'); await o.click('#eSave'); await o.wait_for_timeout(400)
        ok('Expense recorded', 'Warehouse guard' in await text(o))
        await goto(o, 'cash'); await o.click('[data-a=hoOpen]'); await o.wait_for_timeout(200); await o.click('#hoSave'); await o.wait_for_timeout(300)
        if await o.query_selector('#cbOk'): await o.click('#cbOk'); await o.wait_for_timeout(300)
        await o.click('[data-a=hoReview]'); await o.click('#hoConfirm'); await o.wait_for_timeout(400); ok('Cash handover submitted & confirmed', 'Confirmed' in await text(o))
        await goto(o, 'suppliers'); ok('Unpaid container cost became a bill', 'Houston Drayage' in await text(o))
        await o.click('.li:has-text("Houston")'); await o.click('#bPay'); await o.click('#bpGo'); await o.wait_for_timeout(400); await closeall(o)
        ok('Bill paid in full', 'Nothing to pay' in await text(o))
        await goto(o, 'reminders'); await o.click('[data-a=remF][data-v=all]'); ok('Reminders screen renders', 'customers owing' in (await text(o)).lower())
        # ---------- 7. transfer + stock count ----------
        await goto(o, 'transfers'); await o.click('[data-a=newTransfer]'); await o.click('[data-tradd] >> nth=0'); await o.fill('[data-trq="0"]', '3'); await o.click('#trGo'); await o.wait_for_timeout(500)
        await o.click('[data-a=openTransfer]'); await o.click('#trRecv'); await o.wait_for_timeout(600); ok('Branch transfer sent and received', 'Received' in await text(o))
        await goto(o, 'audit'); await o.click('[data-a=auditNew]'); await o.click('#auGo'); await o.wait_for_timeout(400)
        await o.fill('[data-cnt] >> nth=0', '0'); await o.press('[data-cnt] >> nth=0', 'Tab'); await o.wait_for_timeout(300); await o.click('#auSubmit'); await o.click('#cbOk'); await o.wait_for_timeout(400); await o.click('#auApply'); await o.wait_for_timeout(700)
        ok('Stock count approved and stock corrected', 'Approved' in await text(o, '.scrim')); await closeall(o)
        # ---------- 8. every report tab + Excel ----------
        await goto(o, 'reports'); tabs = await o.eval_on_selector_all('[data-a=repTab]', 'e=>e.map(x=>x.dataset.v)'); bad = []
        for tb in tabs:
            await o.click(f'[data-a=repTab][data-v={tb}]'); await o.wait_for_timeout(200)
            if 'Report error' in await text(o): bad.append(tb)
        ok('All %d report tabs render' % len(tabs), not bad, bad)
        await o.click('[data-a=repTab][data-v=overview]'); await o.click('[data-a=repXlsx] >> nth=0'); await o.wait_for_timeout(600); ok('Report Excel export', await dl(o, 'Report-overview'))
        # ---------- 9. backup → restore into a fresh database ----------
        await goto(o, 'settings'); await o.click('[data-a=backupJson]'); await o.wait_for_timeout(1500)
        backup = await o.evaluate("(async()=>{const k=Object.keys(window.__blobs).find(x=>x.startsWith('Backup')); return await window.__blobs[k].text()})()")
        bj = json.loads(backup); counts = {k: len(v) for k, v in bj['data'].items()}
        ok('Backup contains every record type', all(counts.get(k, 0) > 0 for k in ['products', 'lots', 'shipments', 'customers', 'sales', 'expenses', 'bills', 'transfers', 'audits', 'handovers']), counts)
        ok('Backup embeds photos so it restores anywhere', all(str(p.get('image', '')).startswith('data:') or not p.get('image') for p in bj['data']['products']))
        await o.click('[data-a=backupXlsx]'); await o.wait_for_timeout(800); ok('All data as Excel', await dl(o, 'All-data'))
        open('/tmp/backup.json', 'w').write(backup)
        ctx2 = await new_ctx(); o2 = await ctx2.new_page(); watch(o2, 'RESTORE')
        await o2.goto(U + '?as=owner#settings'); await o2.wait_for_timeout(900)
        async with o2.expect_file_chooser() as fc: await o2.click('[data-a=restore]')
        await (await fc.value).set_files('/tmp/backup.json'); await o2.wait_for_timeout(300); await o2.click('#cbOk'); await o2.wait_for_timeout(4000)
        same = await o2.evaluate("(c)=>Object.entries(c).filter(([k,n])=>k!=='members' && (K.raw[k]||[]).length!==n && k!=='settings').map(([k,n])=>k+':'+(K.raw[k]||[]).length+'/'+n)", counts)
        ok('Restore into an empty database reproduces every record', not same, same)
        tot1 = await o.evaluate("Object.values(K.C.prodX).reduce((a,x)=>a+x.available,0)"); tot2 = await o2.evaluate("Object.values(K.C.prodX).reduce((a,x)=>a+x.available,0)")
        ok('Stock totals identical after restore', tot1 == tot2, (tot1, tot2))
        await ctx2.close()
        # ---------- 10. crawl every screen: owner phone + desktop, rep, cashier role ----------
        routes = ['home', 'sell', 'sales', 'stock', 'buy', 'containers', 'customers', 'reports', 'expenses', 'cash', 'suppliers', 'reminders', 'assets', 'transfers', 'audit', 'activity', 'team', 'settings']
        for r in routes:
            await goto(o, r); v = await text(o); ok('Owner phone renders #' + r, len(v) > 20 and 'Report error' not in v)
        dctx = await new_ctx(1366, 900); d = await dctx.new_page(); watch(d, 'DESKTOP')
        # share data with desktop context
        await d.goto(U + '?as=owner#home'); await d.evaluate("(b)=>{localStorage.setItem('mockdb', b)}", await o.evaluate("localStorage.getItem('mockdb')")); await d.reload(); await d.wait_for_timeout(1200)
        for r in routes:
            await goto(d, r); v = await text(d); ok('Owner desktop renders #' + r, len(v) > 20)
        await d.screenshot(path='audit_desktop_settings.png')
        await goto(d, 'home'); await d.screenshot(path='audit_desktop_home.png', full_page=True)
        await dctx.close()
        # rep
        r = await ctx.new_page(); watch(r, 'REP'); await r.goto(U + '?as=rep#home'); await r.wait_for_timeout(1200)
        await goto(o, 'team'); await o.click('[data-a=reqApprove]'); await o.click('#mSave'); await o.wait_for_timeout(900)
        await r.reload(); await r.wait_for_timeout(1200)
        allowed = []
        for rt in routes:
            await goto(r, rt, 'rep'); allowed.append((rt, (await r.inner_text('#title'))))
        blocked = [rt for rt, ttl in allowed if ttl == 'Home' and rt != 'home']
        ok('Sales rep is blocked from purchases/containers/reports/suppliers/team/settings', set(['buy', 'containers', 'reports', 'suppliers', 'team', 'settings', 'expenses']).issubset(set(blocked)), blocked)
        await goto(r, 'stock', 'rep'); await r.click('#stockList .li >> nth=0'); sv = await text(r); ok('Sales rep sees no costs', 'landed' not in sv.lower() and 'Stock at cost' not in sv)
        # custom role "Cashier": payments only
        await goto(o, 'team'); await o.click('[data-a=roleEdit]:not([data-k])'); await o.fill('[name=rlName]', 'Cashier')
        for cb in await o.query_selector_all('[data-rp]'): await cb.uncheck()
        await o.check('[data-rp=payments]'); await o.check('[data-rp=salesAll]'); await o.click('#rlSave'); await o.wait_for_timeout(500)
        await o.click('[data-a=memberEdit]'); await o.select_option('#mRole', 'cashier'); await o.click('#mSave'); await o.wait_for_timeout(900)
        await r.reload(); await r.wait_for_timeout(1200); await goto(r, 'sell', 'rep')
        ok('Custom role applied live (Cashier cannot open New sale)', (await r.inner_text('#title')) == 'Home')
        await goto(r, 'sales', 'rep'); ok('Cashier sees all sales to take payments', 'own sales' not in await text(r))
        # oversold detection (two phones sold the last unit while one was offline)
        await o.evaluate("(()=>{const l=K.raw.lots.find(x=>K.C.lotX[x.id].available>0 && !x.reservedFor); return save('adjustments',{id:'a_over',productId:l.productId,lotId:l.id,qty:-(K.C.lotX[l.id].available+2),locationId:K.C.lotX[l.id].home,reason:'Count correction'})})()"); await o.wait_for_timeout(500)
        await goto(o, 'home'); ok('Oversold / negative stock is flagged on Home', 'oversold' in (await text(o)).lower())
        await o.screenshot(path='audit_phone_home.png', full_page=True)
        await goto(o, 'activity'); await o.wait_for_timeout(1500); act = await text(o)
        ok('Activity log shows the day\'s work', 'Purchased' in act and 'Cancelled sale' in act and 'Received transfer' in act)
        print('\n==== ERRORS ====\n' + ('\n'.join(errs) if errs else 'none'))
        fails = [r for r in RESULTS if not r[1]]
        print('\n==== %d checks, %d failed ====' % (len(RESULTS), len(fails)))
        for f in fails: print('FAIL', f[0], f[2])
        await b.close()
        sys.exit(1 if fails or errs else 0)
asyncio.run(main())
