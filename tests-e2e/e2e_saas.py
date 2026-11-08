import asyncio, random, string
from playwright.async_api import async_playwright
U='http://localhost:8090/'
rnd=''.join(random.choice(string.ascii_lowercase) for _ in range(5))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--no-sandbox'])
        errs=[]
        oc = await b.new_context(viewport={'width':390,'height':844}); o = await oc.new_page(); o.on('pageerror', lambda e: errs.append('OWNER '+str(e)))
        async def closeall(pg):
            while await pg.query_selector('.scrim'):
                await pg.click('.scrim >> nth=-1 >> .sh [data-a=sheetClose] >> nth=-1'); await pg.wait_for_timeout(150)
        await o.goto(U); await o.wait_for_timeout(500)
        await o.click('#tReg'); await o.fill('[name=businessName]','SaaS Biz'); await o.fill('[name=name]','Owner One'); await o.fill('[name=login]','o'+rnd); await o.fill('[name=password]','secret1'); await o.click('#go')
        await o.wait_for_timeout(2500)
        await o.goto(U+'#team'); await o.wait_for_timeout(1200)
        await o.click('[data-a=saasAdd]'); await o.fill('[name=mName]','Rep Two'); await o.fill('[name=mLogin]','r'+rnd); await o.fill('[name=mPass]','pass123'); await o.click('#mSave'); await o.wait_for_timeout(1000)
        assert 'Rep Two' in await o.inner_text('#view')
        await o.goto(U+'#buy'); await o.wait_for_timeout(600)
        await o.click('text=Add purchase'); await o.wait_for_timeout(300)
        await o.select_option('[name=shipmentId]', '__local'); await o.select_option('.card [name=currency]', 'XAF')
        async with o.expect_file_chooser() as fc: await o.click('#lineForm .photo-slot')
        await (await fc.value).set_files('fixtures/oats.jpg')
        await o.fill('#lnName','Peanut Butter 1kg'); await o.fill('#lineForm [name=qty]','8'); await o.fill('#lineForm [name=unitCost]','2000'); await o.click('#lnAdd')
        await o.click('#puSave'); await o.wait_for_timeout(2500)
        await o.goto(U+'#sell'); await o.wait_for_timeout(1500)
        ok = await o.evaluate("(()=>{const i=document.querySelector('.pt .pimg img'); return i && i.complete && i.naturalWidth>0})()"); print('owner photo loads:', ok)
        await o.click('.pt >> nth=0'); await o.click('#cartbar'); await o.click('.scrim [data-a=checkout]'); await o.wait_for_timeout(300); await o.click('#doSell'); await o.wait_for_timeout(1500)
        assert await o.query_selector('#rcpt'); await closeall(o)
        rc = await b.new_context(viewport={'width':390,'height':844}); r = await rc.new_page(); r.on('pageerror', lambda e: errs.append('REP '+str(e)))
        await r.goto(U); await r.wait_for_timeout(500); await r.fill('[name=login]','r'+rnd); await r.fill('[name=password]','pass123'); await r.click('#go'); await r.wait_for_timeout(2500)
        await r.click('[data-a=moreMenu]'); more = await r.inner_text('.scrim'); print('rep more:', more.replace('\n',' | ')); await closeall(r)
        await r.goto(U+'#sell'); await r.wait_for_timeout(1500)
        print('rep photo loads:', await r.evaluate("(()=>{const i=document.querySelector('.pt .pimg img'); return i && i.complete && i.naturalWidth>0})()"))
        print('rep price shown:', (await r.inner_text('.pt .pr')))
        await r.click('.pt >> nth=0'); await r.click('#cartbar'); await r.click('.scrim [data-a=checkout]'); await r.wait_for_timeout(300); await r.click('#doSell'); await r.wait_for_timeout(1500)
        assert await r.query_selector('#rcpt'), 'rep sale ok'; await closeall(r)
        await r.goto(U+'#sales'); await r.wait_for_timeout(1500)
        t = await r.inner_text('#view'); assert 'own sales' in t; print('rep sales count lines:', t.count('Walk-in'))
        await r.goto(U+'#stock'); await r.wait_for_timeout(800); await r.click('#stockList .li >> nth=0'); await r.wait_for_timeout(200)
        sv = await r.inner_text('#view'); assert 'landed' not in sv.lower(); 
        await r.screenshot(path='s_rep_stock.png', full_page=True)
        print('ERRORS:', errs or 'none')
        await b.close()
asyncio.run(main())
