import asyncio, re
from playwright.async_api import async_playwright
U='http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2)
        await ctx.add_init_script(path='shim.js')
        async def blob(route): await route.fulfill(path='fixtures/oats.jpg', content_type='image/jpeg')
        await ctx.route('**/_blob/**', blob)
        errs=[]
        o = await ctx.new_page(); o.on('pageerror', lambda e: errs.append('OWNER '+str(e)))
        async def closeall(pg):
            while await pg.query_selector('.scrim'):
                await pg.click('.scrim >> nth=-1 >> .sh [data-a=sheetClose] >> nth=-1'); await pg.wait_for_timeout(150)
        async def photo(pg, sel, f):
            async with pg.expect_file_chooser() as fc: await pg.click(sel)
            await (await fc.value).set_files(f); await pg.wait_for_timeout(200)
        await o.goto(U+'?as=owner#settings'); await o.wait_for_timeout(800)
        await o.fill('[name=businessName]','Bullekam Trading'); await o.click('[data-a=saveSettings]'); await o.wait_for_timeout(300)
        await o.goto(U+'?as=owner#customers'); await o.wait_for_timeout(300)
        await o.click('[data-a=newCust]'); await o.fill('[name=name]','Garage Client'); await o.fill('[name=phone]','699000111'); await o.fill('[name=creditLimit]','50000'); await o.click('#cSave'); await o.wait_for_timeout(300)
        await o.goto(U+'?as=owner#containers'); await o.wait_for_timeout(300)
        await o.click('text=New container'); await o.fill('[name=containerNo]','MSCU7654321'); await o.click('#sSave'); await o.wait_for_timeout(400); await closeall(o)
        await o.goto(U+'?as=owner#buy'); await o.wait_for_timeout(300)
        await o.click('text=Add purchase'); await o.wait_for_timeout(300)
        await o.fill('[name=vendor]','Costco')
        opts = await o.eval_on_selector('[name=shipmentId]', 'e=>[...e.options].map(x=>x.value)'); await o.select_option('[name=shipmentId]', opts[2])
        lines=[('Quaker Oats Old Fashioned','fixtures/oats.jpg','pack','2.6','kg','5','2','25.98','19.96','2027-01-15','Food & Snacks'),
               ('Blue Diamond Almonds','fixtures/almond.jpg','bag','1.36','kg','6','1','15.99','11.49','2026-12-20','Food & Snacks'),
               ('Samsung 55 inch TV','fixtures/tv.jpg','piece','55','inch (screen)','2','1','499','380','','Electronics'),
               ('Toyota RAV4 2015',None,'piece','','','1','1','','6500','','Vehicles')]
        for n,img,unit,size,su,qty,pack,reg,paid,exp,cat in lines:
            if n.startswith('Toyota'):
                cid = await o.eval_on_selector('#lineForm [name=reservedFor]', "e=>[...e.options].find(x=>x.text.startsWith('Garage')).value"); await o.select_option('#lineForm [name=reservedFor]', cid)
            if img: await photo(o, '#lineForm .photo-slot', img)
            await o.fill('#lnName', n); await o.select_option('#lnCat', cat); await o.select_option('#lineForm [name=unit]', unit); await o.fill('#lineForm [name=size]', size); await o.select_option('#lineForm [name=sizeUnit]', su)
            await o.fill('#lineForm [name=qty]', qty); await o.fill('#packOf', pack); await o.fill('#lineForm [name=regularPrice]', reg); await o.fill('#lineForm [name=unitCost]', paid)
            if exp: await o.fill('#lineForm [name=expiry]', exp)
            await o.click('#lnAdd'); await o.wait_for_timeout(150)
        await o.screenshot(path='h01purchase.png', full_page=True)
        await o.click('#puSave'); await o.wait_for_timeout(1200)
        await o.goto(U+'?as=owner#containers'); await o.wait_for_timeout(300)
        await o.click('[data-a=openShip]'); await o.click('[data-a=shTab][data-v=costs]'); await o.click('[data-a=shCost][data-side=US]'); await o.fill('[name=amount]','900'); await o.click('#cSave'); await o.wait_for_timeout(300)
        await o.click('[data-a=shTab][data-v=recv]'); await o.click('[data-a=shReceive]'); await o.click('#cbOk'); await o.wait_for_timeout(500); await closeall(o)
        await o.goto(U+'?as=owner#stock'); await o.wait_for_timeout(400)
        txt = await o.inner_text('#stockList'); assert '10' in txt, txt
        await o.click('#stockList .li >> nth=0'); await o.wait_for_timeout(200)
        await o.screenshot(path='h02stock.png', full_page=True)
        await o.goto(U+'?as=owner#sell'); await o.wait_for_timeout(400)
        await o.screenshot(path='h03pos.png')
        await o.click('.pt >> nth=0'); await o.click('.pt >> nth=0'); await o.click('.pt >> nth=1')
        await o.click('#cartbar'); await o.click('.scrim [data-a=pickCustomer]'); await o.click('[data-a=custNewInline]'); await o.fill('[name=name]','Jenny Mballa'); await o.fill('[name=phone]','677123456'); await o.click('#cSave'); await o.wait_for_timeout(300)
        await o.click('.scrim [data-a=checkout]'); await o.wait_for_timeout(300); await o.fill('#payAmount','10000'); await o.click('#doSell'); await o.wait_for_timeout(600)
        assert await o.query_selector('#rcpt'), 'receipt shown'
        await o.screenshot(path='h04rcpt.png'); await closeall(o)
        # client order: car hidden until the client is selected; credit limit warning for owner
        await o.goto(U+'?as=owner#sell'); await o.wait_for_timeout(300)
        assert 'Toyota' not in await o.inner_text('#pgrid'), 'reserved car hidden from walk-ins'
        await o.click('#cartbar') if await o.is_visible('#cartbar') else None
        await o.evaluate("K.cart.customerId = K.raw.customers.find(c=>c.name==='Garage Client').id; refreshPOS()"); await o.wait_for_timeout(200)
        grid = await o.inner_text('#pgrid'); assert 'Toyota' in grid and 'Client order' in grid, grid
        await o.click('.pt:has-text("Toyota")'); await o.wait_for_timeout(100)
        await o.click('#cartbar'); await o.click('.scrim [data-a=checkout]'); await o.wait_for_timeout(300); await o.fill('#payAmount','1000000')
        await o.click('#doSell'); await o.wait_for_timeout(400)
        cb = await o.query_selector('#cbOk'); assert cb, 'owner gets credit-limit confirmation'
        await o.screenshot(path='h04bcredit.png')
        await o.click('#cbOk'); await o.wait_for_timeout(600); assert await o.query_selector('#rcpt'); await closeall(o)
        await o.goto(U+'?as=owner#stock'); await o.wait_for_timeout(300)
        await o.click('#stockList .li:has-text("Quaker")'); await o.wait_for_timeout(200); await o.click('[data-a=itemHistory]'); await o.wait_for_timeout(300)
        await o.screenshot(path='h04chistory.png', full_page=True); await closeall(o)
        await o.goto(U+'?as=owner#customers'); await o.wait_for_timeout(300); await o.click('.li:has-text("Garage")'); await o.wait_for_timeout(300)
        await o.screenshot(path='h04dcust.png', full_page=True); await closeall(o)
        # reports: every tab
        await o.goto(U+'?as=owner#reports'); await o.wait_for_timeout(400)
        tabs = await o.eval_on_selector_all('[data-a=repTab]', 'e=>e.map(x=>x.dataset.v)')
        for t in tabs:
            await o.click(f'[data-a=repTab][data-v={t}]'); await o.wait_for_timeout(250)
            body = await o.inner_text('#view'); assert 'Report error' not in body, (t, body[:200])
            if t in ('overview','inventory','forecast','timing','items'): await o.screenshot(path=f'h05rep_{t}.png', full_page=True)
        # sales rep requests access
        r = await ctx.new_page(); r.on('pageerror', lambda e: errs.append('REP '+str(e)))
        await r.goto(U+'?as=rep#home'); await r.wait_for_timeout(1200)
        assert 'Waiting for access' in await r.inner_text('#view')
        await r.screenshot(path='h06pending.png')
        print('ls requests:', await o.evaluate("JSON.stringify((JSON.parse(localStorage.getItem('mockdb')||'{}')).requests)"), 'owner raw:', await o.evaluate('JSON.stringify(K.raw.requests)'), 'rep sync', await r.evaluate('K.sync'), await r.evaluate('K._reqSent'))
        await o.goto(U+'?as=owner#team'); await o.wait_for_timeout(600)
        await o.screenshot(path='h07team.png', full_page=True)
        await o.click('[data-a=reqApprove]'); await o.wait_for_timeout(300)
        await o.screenshot(path='h08approve.png', full_page=True)
        await o.click('#mSave'); await o.wait_for_timeout(800)
        await r.wait_for_timeout(800)
        nav = await r.eval_on_selector_all('#bnav a', 'e=>e.map(x=>x.innerText.trim())'); print('rep bottom nav:', nav)
        await r.click('[data-a=moreMenu]'); await r.wait_for_timeout(200)
        more = await r.inner_text('.scrim'); print('rep more menu:', more.replace('\n',' | ')); await closeall(r)
        assert 'Purchases' not in more and 'Reports' not in more and 'Containers' not in more
        await r.goto(U+'?as=rep#buy'); await r.wait_for_timeout(300); assert (await r.inner_text('#title')) == 'Home', 'blocked from purchases'
        await r.goto(U+'?as=rep#sell'); await r.wait_for_timeout(400)
        await r.click('.pt >> nth=0'); await r.click('#cartbar'); await r.click('.scrim [data-a=checkout]'); await r.wait_for_timeout(300)
        assert not await r.query_selector('#discIn'), 'no discount field for rep'
        await r.click('#doSell'); await r.wait_for_timeout(600); await closeall(r)
        # rep cannot exceed a credit limit
        await r.goto(U+'?as=rep#sell'); await r.wait_for_timeout(300)
        await r.evaluate("K.cart.customerId = K.raw.customers.find(c=>c.name==='Garage Client').id; refreshPOS()")
        await r.click('.pt >> nth=0'); await r.click('#cartbar'); await r.click('.scrim [data-a=checkout]'); await r.wait_for_timeout(300)
        await r.fill('#payAmount','0'); await r.click('#doSell'); await r.wait_for_timeout(300)
        t = await r.inner_text('.toast'); assert 'credit limit' in t, t; print('rep blocked:', t)
        await closeall(r); await r.evaluate("K.cart={lines:[],customerId:null,editingId:null,discount:0}; saveCart()")
        await r.goto(U+'?as=rep#sales'); await r.wait_for_timeout(400)
        st = await r.inner_text('#view'); assert 'own sales' in st and 'Jenny Mballa' not in st, st[:300]
        assert 'Gross profit' not in st
        await r.screenshot(path='h09repsales.png', full_page=True)
        await r.goto(U+'?as=rep#stock'); await r.wait_for_timeout(300); await r.click('#stockList .li >> nth=0'); await r.wait_for_timeout(200)
        sv = await r.inner_text('#view'); assert 'landed' not in sv.lower() and 'Stock at cost' not in sv
        await r.screenshot(path='h10repstock.png', full_page=True)
        # owner grants reports to rep
        await o.goto(U+'?as=owner#team'); await o.wait_for_timeout(400)
        await o.click('[data-a=memberEdit]'); await o.wait_for_timeout(200)
        await o.check('[data-perm=reports]'); await o.click('#mSave'); await o.wait_for_timeout(800)
        await r.wait_for_timeout(600)
        print('rep member doc:', await r.evaluate('JSON.stringify(K.raw.members)'), 'perm reports:', await r.evaluate('K.perms.reports'))
        print('owner member doc:', await o.evaluate('JSON.stringify(K.raw.members)'))
        await r.goto(U+'?as=rep#reports'); await r.wait_for_timeout(500)
        print('hash', await r.evaluate('location.hash'), 'route', await r.evaluate('K.route'), 'navOk', await r.evaluate("navOk('reports')"), 'title', await r.inner_text('#title'))
        rv = await r.inner_text('#view'); assert 'own sales only' in rv and 'Gross profit' not in rv, rv[:300]
        await r.screenshot(path='h11represports.png', full_page=True)
        # owner dashboard
        await o.goto(U+'?as=owner#home'); await o.wait_for_timeout(500); await o.screenshot(path='h12home.png', full_page=True)
        # backup
        await o.goto(U+'?as=owner#settings'); await o.wait_for_timeout(300); await o.click('[data-a=backupJson]'); await o.wait_for_timeout(800)
        print('downloads:', await o.evaluate('window.__downloads'))
        print('ERRORS:', errs or 'none')
        await b.close()
asyncio.run(main())
