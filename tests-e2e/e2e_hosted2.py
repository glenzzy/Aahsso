import asyncio
from playwright.async_api import async_playwright
U='http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2)
        await ctx.add_init_script(path='shim.js')
        await ctx.route('**/_blob/**', lambda r: r.fulfill(path='fixtures/oats.jpg', content_type='image/jpeg'))
        errs=[]; o = await ctx.new_page(); o.on('pageerror', lambda e: errs.append('OWNER '+str(e)))
        async def closeall(pg):
            while await pg.query_selector('.scrim'):
                await pg.click('.scrim >> nth=-1 >> .sh [data-a=sheetClose] >> nth=-1'); await pg.wait_for_timeout(120)
        async def toast(pg):
            t = await pg.query_selector('.toast'); return (await t.inner_text()) if t else ''
        await o.goto(U+'?as=owner#settings'); await o.wait_for_timeout(800)
        await o.fill('[name=businessName]','Bullekam Trading'); await o.click('[data-a=saveSettings]'); await o.wait_for_timeout(300)
        await o.click('[data-a=locEdit] >> text=Add branch'); await o.fill('.scrim [name=name]','Akwa shop'); await o.click('#lcSave'); await o.wait_for_timeout(400)
        assert 'Akwa shop' in await o.inner_text('#view')
        # local purchase, on credit -> bill
        await o.goto(U+'?as=owner#buy'); await o.wait_for_timeout(300); await o.click('text=Add purchase'); await o.wait_for_timeout(200)
        await o.fill('[name=vendor]','Mahima Wholesale'); await o.select_option('[name=shipmentId]','__local'); await o.select_option('.card [name=currency]','XAF'); await o.select_option('[name=payStatus]','credit')
        await o.fill('#lnName','Quaker Oats'); await o.fill('#lineForm [name=qty]','20'); await o.fill('#lineForm [name=unitCost]','5000'); await o.click('#lnAdd')
        await o.fill('#lnName','Malta Guinness 24-pack'); await o.fill('#lineForm [name=qty]','2'); await o.fill('#packOf','24'); await o.fill('#lineForm [name=unitCost]','12000'); await o.click('#lnAdd')
        await o.click('#puSave'); await o.wait_for_timeout(1200)
        st = await o.evaluate("JSON.stringify(K.raw.lots.map(l=>[l.qty,l.unitCost]))"); print('lots (pack split):', st)
        assert '[48,500]' in st, 'pack of 24 split into 48 units at 500'
        # product bulk qty
        pid = await o.evaluate("K.raw.products.find(p=>p.name==='Quaker Oats').id")
        await o.evaluate(f"save('products', Object.assign({{}}, byId('products','{pid}'), {{bulkQty: 10}}))"); await o.wait_for_timeout(300)
        # transfer 5 oats to shop
        await o.goto(U+'?as=owner#transfers'); await o.wait_for_timeout(300); await o.click('[data-a=newTransfer]'); await o.wait_for_timeout(300)
        await o.click('[data-tradd] >> nth=1'); await o.wait_for_timeout(150)
        await o.fill('[name=carrier]','Driver Eric'); await o.fill('[data-trq="0"]','5'); await o.click('#trGo'); await o.wait_for_timeout(600)
        bl = await o.evaluate(f"JSON.stringify(K.C.prodX['{pid}'].byLoc)"); print('after send:', bl); assert '"main":15' in bl
        await o.click('[data-a=openTransfer]'); await o.wait_for_timeout(200); await o.fill('[data-rq="0"]','4'); await o.click('#trRecv'); await o.click('#cbOk'); await o.wait_for_timeout(900)
        bl = await o.evaluate(f"JSON.stringify(K.C.prodX['{pid}'].byLoc)"); print('after receive (1 missing):', bl); assert ':4' in bl
        assert 'Received short' in await o.inner_text('#view')
        # switch to shop and check POS
        await o.click('#locBtn'); await o.click('.scrim .li:has-text("Akwa")'); await o.wait_for_timeout(300)
        await o.goto(U+'?as=owner#sell'); await o.wait_for_timeout(400)
        g = await o.inner_text('#pgrid'); assert '4 left' in g and 'Malta' not in g, g
        # reseller customer -> wholesale price
        await o.goto(U+'?as=owner#customers'); await o.wait_for_timeout(200); await o.click('[data-a=newCust]'); await o.fill('[name=name]','Paul Reseller'); await o.fill('[name=phone]','677555444'); await o.select_option('.scrim [name=type]','Reseller'); await o.click('#cSave'); await o.wait_for_timeout(300)
        await o.goto(U+'?as=owner#sell'); await o.wait_for_timeout(300)
        await o.evaluate("K.cart.customerId = K.raw.customers.find(c=>c.name==='Paul Reseller').id; refreshPOS()")
        await o.click('.pt >> nth=0'); await o.wait_for_timeout(150); await o.click('#cartbar'); await o.wait_for_timeout(200)
        ct = await o.inner_text('.scrim'); assert 'Wholesale price' in ct, ct; print('wholesale applied ✓')
        await o.click('.scrim [data-a=checkout]'); await o.wait_for_timeout(200); await o.fill('#payAmount','0'); await o.click('#doSell'); await o.wait_for_timeout(500)
        assert await o.query_selector('#rcpt'); await closeall(o)
        # OFFLINE sale
        await ctx.set_offline(True); await o.wait_for_timeout(200)
        await o.evaluate("K.cart={lines:[],customerId:null,editingId:null,discount:0}; saveCart(); refreshPOS()")
        await o.click('.pt >> nth=0'); await o.click('#cartbar'); await o.click('.scrim [data-a=checkout]'); await o.wait_for_timeout(200); await o.click('#doSell'); await o.wait_for_timeout(500)
        assert await o.query_selector('#rcpt'), 'receipt works offline'; await closeall(o)
        sync = await o.inner_text('#sync'); print('while offline:', sync); assert 'to sync' in sync
        n_before = await o.evaluate("Object.keys((JSON.parse(localStorage.getItem('mockdb')).sales)||{}).length")
        await ctx.set_offline(False); await o.wait_for_timeout(2500)
        sync2 = await o.inner_text('#sync'); n_after = await o.evaluate("Object.keys((JSON.parse(localStorage.getItem('mockdb')).sales)||{}).length")
        print('after reconnect:', sync2, 'sales in db', n_before, '->', n_after); assert 'Synced' in sync2 and n_after == n_before + 1
        # reload while offline-ish: cached copy shows instantly
        # cash handover
        await o.goto(U+'?as=owner#cash'); await o.wait_for_timeout(300)
        await o.click('[data-a=hoOpen]'); await o.wait_for_timeout(200)
        await o.fill('[data-dm="Cash"]','1000'); await o.wait_for_timeout(100); d = await o.inner_text('#hoDiff'); print('handover diff shown:', d); assert 'short' in d
        await o.click('#hoSave'); await o.click('#cbOk'); await o.wait_for_timeout(500)
        cv = await o.inner_text('#view'); assert 'short' in cv
        await o.click('[data-a=hoReview]'); await o.wait_for_timeout(200); await o.click('#hoConfirm'); await o.wait_for_timeout(400)
        assert 'Confirmed' in await o.inner_text('#view')
        await o.screenshot(path='n01cash.png', full_page=True)
        # container cost unpaid -> bill ; suppliers
        await o.goto(U+'?as=owner#containers'); await o.wait_for_timeout(200); await o.click('text=New container'); await o.click('#sSave'); await o.wait_for_timeout(400)
        await o.click('[data-a=shTab][data-v=costs]'); await o.click('[data-a=shCost][data-side=US]'); await o.wait_for_timeout(200)
        await o.fill('.scrim >> nth=-1 >> [name=amount]','650'); await o.check('#ccUnpaid'); await o.select_option('#ccSup [name=supplierId]','__new'); await o.fill('#ccSup [name=newSupplier]','Houston Trucking LLC'); await o.click('#cSave'); await o.wait_for_timeout(600)
        await closeall(o)
        await o.goto(U+'?as=owner#suppliers'); await o.wait_for_timeout(300)
        sv = await o.inner_text('#view'); print('suppliers view has trucking & mahima:', 'Houston Trucking' in sv, 'Mahima' in sv); assert 'Houston Trucking' in sv and 'Mahima' in sv
        await o.click('.li:has-text("Houston")'); await o.wait_for_timeout(200); await o.click('#bPay'); await o.fill('.scrim >> nth=-1 >> [name=amount]','300'); await o.click('#bpGo'); await o.wait_for_timeout(400)
        assert 'Part paid' in await o.inner_text('#view')
        await o.screenshot(path='n02suppliers.png', full_page=True)
        # reminders: make reseller sale overdue
        await o.evaluate("(()=>{const s=K.raw.sales.find(x=>x.customerName==='Paul Reseller'); return save('sales', Object.assign({}, s, {dueDate:'2026-10-01'}))})()"); await o.wait_for_timeout(300)
        await o.goto(U+'?as=owner#reminders'); await o.wait_for_timeout(300)
        rv = await o.inner_text('#view'); assert 'Paul Reseller' in rv and 'days late' in rv, rv
        href = await o.get_attribute('a[data-a2=remLog]', 'href'); print('whatsapp link:', href[:120]); assert 'wa.me/237677555444' in href
        await o.screenshot(path='n03reminders.png', full_page=True)
        await o.goto(U+'?as=owner#home'); await o.wait_for_timeout(300); await o.screenshot(path='n04home.png', full_page=True)
        hv = await o.inner_text('#view'); assert 'overdue' in hv.lower()
        # stock count at shop: blind count, 1 short, approve
        await o.goto(U+'?as=owner#audit'); await o.wait_for_timeout(300); await o.click('[data-a=auditNew]'); await o.click('#auGo'); await o.wait_for_timeout(500)
        cnt = await o.query_selector_all('[data-cnt]'); print('count lines:', len(cnt))
        await o.fill('[data-cnt] >> nth=0', '2'); await o.press('[data-cnt] >> nth=0', 'Tab'); await o.wait_for_timeout(400)
        await o.click('#auSubmit'); await o.click('#cbOk'); await o.wait_for_timeout(500)
        await o.screenshot(path='n05audit.png', full_page=True)
        await o.click('#auApply'); await o.wait_for_timeout(800)
        assert 'Applied' in await o.inner_text('.scrim') or 'Approved' in await o.inner_text('.scrim'); await closeall(o)
        bl = await o.evaluate(f"JSON.stringify(K.C.prodX['{pid}'].byLoc)"); print('after count:', bl)
        # return with reason
        await o.goto(U+'?as=owner#sales'); await o.wait_for_timeout(300); await o.click('[data-a=salesRange][data-v=all]'); await o.wait_for_timeout(200)
        await o.click('[data-a=openSale] >> nth=0'); await o.wait_for_timeout(200); await o.click('[data-a=returnSale]'); await o.wait_for_timeout(200)
        await o.fill('[data-ret] >> nth=0','1'); await o.select_option('.scrim >> nth=-1 >> [name=reason]','Damaged / defective'); await o.click('#rSave'); await o.wait_for_timeout(500); await closeall(o)
        rr = await o.evaluate("JSON.stringify(K.raw.sales.flatMap(s=>s.lines.flatMap(l=>(l.returns||[]).map(r=>r.reason))))"); print('return reasons:', rr); assert 'Damaged' in rr
        # mobile: New sale button on Sales; walk-in bar + quick new customer
        assert await o.is_visible('a.mob-block'), 'big New sale button visible on phone'
        await o.click('a.mob-block'); await o.wait_for_timeout(300)
        assert 'Walk-in customer' in await o.inner_text('#posCust')
        await o.click('[data-a=custQuickNew]'); await o.fill('[name=name]','Marie Ngo'); await o.fill('[name=phone]','699111222'); await o.click('#cSave'); await o.wait_for_timeout(300)
        assert 'Marie Ngo' in await o.inner_text('#posCust'); print('quick new customer selected ✓')
        await o.click('[data-a=custWalkinNow]'); await o.wait_for_timeout(150); assert 'Walk-in' in await o.inner_text('#posCust')
        await o.screenshot(path='n06pos.png')
        # currency: add EUR rate, buy in EUR
        await o.goto(U+'?as=owner#settings'); await o.wait_for_timeout(300)
        print('fx rows:', len(await o.query_selector_all('[data-fxc]')))
        await o.fill('[data-fxr="1"]','656'); await o.click('[data-a=saveSettings]'); await o.wait_for_timeout(400)
        print('fxRates saved:', await o.evaluate("JSON.stringify(S().fxRates)"))
        await o.goto(U+'?as=owner#buy'); await o.wait_for_timeout(200); await o.click('text=Add purchase'); await o.wait_for_timeout(200)
        await o.select_option('.card [name=currency]','EUR'); await o.select_option('[name=shipmentId]','__local')
        await o.fill('#lnName','Nutella 1kg'); await o.fill('#lineForm [name=qty]','1'); await o.fill('#lineForm [name=unitCost]','10'); await o.click('#lnAdd'); await o.click('#puSave'); await o.wait_for_timeout(800)
        ux = await o.evaluate("K.C.lotX[K.raw.lots.find(l=>l.currency==='EUR').id].unitX"); print('EUR 10 ->', ux); assert ux == 6560
        # custom role
        await o.goto(U+'?as=owner#team'); await o.wait_for_timeout(300); await o.click('[data-a=roleEdit]:not([data-k])'); await o.wait_for_timeout(200)
        await o.fill('[name=rlName]','Cashier'); await o.uncheck('[data-rp=sell]'); await o.click('#rlSave'); await o.wait_for_timeout(500)
        assert 'Cashier' in await o.inner_text('#view'); print('custom role created ✓')
        await o.goto(U+'?as=owner#home'); await o.wait_for_timeout(300); await o.screenshot(path='n07home.png', full_page=True)
        assert 'Where your goods are' in await o.inner_text('#view')
        # rep assigned to shop
        r = await ctx.new_page(); r.on('pageerror', lambda e: errs.append('REP '+str(e)))
        await r.goto(U+'?as=rep#home'); await r.wait_for_timeout(1200)
        await o.goto(U+'?as=owner#team'); await o.wait_for_timeout(500); await o.click('[data-a=reqApprove]'); await o.wait_for_timeout(200)
        loc_id = await o.evaluate("K.raw.locations[0].id"); await o.select_option('[name=mLoc]', loc_id); await o.click('#mSave'); await o.wait_for_timeout(900)
        await r.goto(U+'?as=rep#sell'); await r.wait_for_timeout(600)
        print('rep location chip hidden (single allowed loc):', await r.evaluate("document.getElementById('locBtn').classList.contains('hide')"), 'rep K.loc:', await r.evaluate('K.loc'))
        assert (await r.evaluate('K.loc')) == loc_id
        await r.click('[data-a=moreMenu]'); more = await r.inner_text('.scrim'); print('rep more:', more.replace('\n',' | ')); assert 'Suppliers' not in more and 'Cash handover' in more; await closeall(r)
        print('ERRORS:', errs or 'none')
        await b.close()
asyncio.run(main())
