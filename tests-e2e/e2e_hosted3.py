import asyncio
from playwright.async_api import async_playwright
U='http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2)
        await ctx.add_init_script(path='shim.js')
        errs=[]; o = await ctx.new_page(); o.on('pageerror', lambda e: errs.append('OWNER '+str(e)))
        async def closeall(pg):
            while await pg.query_selector('.scrim'):
                await pg.click('.scrim >> nth=-1 >> .sh [data-a=sheetClose] >> nth=-1'); await pg.wait_for_timeout(120)
        await o.goto(U+'?as=owner#settings'); await o.wait_for_timeout(900)
        await o.fill('[name=businessName]','Bullekam Trading'); await o.click('[data-a=saveSettings]'); await o.wait_for_timeout(300)
        await o.goto(U+'?as=owner#buy'); await o.wait_for_timeout(300); await o.click('text=Add purchase'); await o.wait_for_timeout(200)
        await o.fill('[name=vendor]','Costco'); await o.select_option('[name=shipmentId]','__local')
        await o.fill('#lnName','Quaker Oats'); await o.fill('#lineForm [name=qty]','10'); await o.fill('#lineForm [name=unitCost]','9.98'); await o.click('#lnAdd'); await o.click('#puSave'); await o.wait_for_timeout(800)
        # sell then cancel with reason
        await o.goto(U+'?as=owner#sell'); await o.wait_for_timeout(300); await o.click('.pt >> nth=0'); await o.click('#cartbar'); await o.click('.scrim [data-a=checkout]'); await o.wait_for_timeout(200); await o.click('#doSell'); await o.wait_for_timeout(500); await closeall(o)
        await o.goto(U+'?as=owner#sales'); await o.wait_for_timeout(300); await o.click('[data-a=openSale]'); await o.wait_for_timeout(200); await o.click('[data-a=cancelSale]'); await o.wait_for_timeout(200)
        await o.select_option('[name=rsn]','Duplicate sale'); await o.fill('[name=rsnNote]','typed twice'); await o.click('#rsnOk'); await o.wait_for_timeout(500); await closeall(o)
        # loss with reason
        await o.goto(U+'?as=owner#stock'); await o.wait_for_timeout(300); await o.click('#stockList .li >> nth=0'); await o.click('[data-a=adjustStock]'); await o.wait_for_timeout(200)
        await o.fill('[name=lossQty]','1'); await o.fill('.scrim [name=notes]','found box torn open'); await o.click('#aSave'); await o.wait_for_timeout(500)
        # rep joins and sells
        r = await ctx.new_page(); r.on('pageerror', lambda e: errs.append('REP '+str(e)))
        await r.goto(U+'?as=rep#home'); await r.wait_for_timeout(1200)
        await o.goto(U+'?as=owner#team'); await o.wait_for_timeout(500); await o.click('[data-a=reqApprove]'); await o.wait_for_timeout(200); await o.click('#mSave'); await o.wait_for_timeout(900)
        await r.goto(U+'?as=rep#sell'); await r.wait_for_timeout(600); await r.click('.pt >> nth=0'); await r.click('#cartbar'); await r.click('.scrim [data-a=checkout]'); await r.wait_for_timeout(200); await r.click('#doSell'); await r.wait_for_timeout(2500); await closeall(r)
        await o.wait_for_timeout(1800)
        # owner activity log
        await o.goto(U+'?as=owner#activity'); await o.wait_for_timeout(1500)
        t = await o.inner_text('#view'); print(t[:1500])
        for must in ['Purchased 10 × Quaker Oats at Costco', 'Cancelled sale', 'Why: Duplicate sale · typed twice', 'Removed 1 × Quaker Oats', 'Why: Missing / theft · found box torn open', 'Jenny Rep', 'Sold 1 × Quaker Oats', 'Gave Jenny Rep access']:
            assert must in t, 'missing: ' + must
        await o.screenshot(path='a01activity.png', full_page=True)
        await o.select_option('[data-c=actWho]', 'u_rep'); await o.wait_for_timeout(300)
        t2 = await o.inner_text('#view'); assert 'Bullekam Owner' not in t2.split('action(s)')[1] and 'Jenny Rep' in t2; print('filter by person ✓')
        await o.click('.li[data-a=actOpen] >> nth=0'); await o.wait_for_timeout(200); d = await o.inner_text('.scrim'); print('detail:', d.replace('\n',' | ')[:300]); await closeall(o)
        # rep sees own only
        await r.goto(U+'?as=rep#activity'); await r.wait_for_timeout(1500)
        rt = await r.inner_text('#view'); assert 'own activity only' in rt and 'Cancelled sale' not in rt and 'Sold 1' in rt; print('rep own-only ✓')
        # sale History button
        await o.goto(U+'?as=owner#sales'); await o.wait_for_timeout(300); await o.click('[data-a=salesRange][data-v=all]'); await o.click('[data-a=openSale] >> nth=-1'); await o.wait_for_timeout(200); await o.click('[data-a=actFor]'); await o.wait_for_timeout(1500)
        ht = await o.inner_text('#view'); print('sale history:', ht[ht.find('action(s)')-5:][:400].replace('\n',' | ') if 'action(s)' in ht else ht[:1500])
        print('ERRORS:', errs or 'none')
        await b.close()
asyncio.run(main())
