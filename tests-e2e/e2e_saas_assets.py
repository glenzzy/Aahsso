"""SaaS build: register an asset through the screens (photo uploaded to the server), add a cost, sell it,
check P&L, the server activity log, and that a sales rep cannot reach it. Needs the server on :8090."""
import asyncio, random, string, sys
from playwright.async_api import async_playwright
U = 'http://localhost:8090/'; rnd = ''.join(random.choice(string.ascii_lowercase) for _ in range(5))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--no-sandbox']); errs = []; checks = []
        def ok(n, c, i=''): checks.append((n, bool(c))); print(('PASS ' if c else 'FAIL ') + n + ('' if c else ' — ' + str(i)[:400]))
        oc = await b.new_context(viewport={'width': 390, 'height': 844}); o = await oc.new_page(); o.on('pageerror', lambda e: errs.append('OWNER ' + str(e)))
        async def closeall(pg):
            while await pg.query_selector('.scrim'): await pg.click('.scrim >> nth=-1 >> .sh [data-a=sheetClose] >> nth=-1'); await pg.wait_for_timeout(150)
        await o.goto(U); await o.wait_for_timeout(500)
        await o.click('#tReg'); await o.fill('[name=businessName]', 'Asset Biz'); await o.fill('[name=name]', 'Owner A'); await o.fill('[name=login]', 'a' + rnd); await o.fill('[name=password]', 'secret1'); await o.click('#go'); await o.wait_for_timeout(2500)
        await o.goto(U + '#team'); await o.wait_for_timeout(1200)
        await o.click('[data-a=saasAdd]'); await o.fill('[name=mName]', 'Rep R'); await o.fill('[name=mLogin]', 'ra' + rnd); await o.fill('[name=mPass]', 'pass123'); await o.click('#mSave'); await o.wait_for_timeout(1000)
        await o.goto(U + '#assets'); await o.wait_for_timeout(1000); await o.click('[data-a=assetNew]'); await o.wait_for_timeout(300)
        await o.fill('.scrim [name=name]', 'Forklift 2.5 t'); await o.select_option('.scrim [name=category]', 'Warehouse equipment')
        await o.fill('.scrim [name=price]', '5000'); await o.select_option('.scrim [name=currency]', 'USD'); await o.fill('.scrim [name=extraCosts]', '500000'); await o.fill('.scrim [name=purchaseDate]', '2026-06-10')
        async with o.expect_file_chooser() as fc: await o.click('#asPhoto')
        await (await fc.value).set_files('fixtures/tv.jpg'); await o.wait_for_timeout(1200)
        await o.click('#asSave'); await o.wait_for_timeout(1500)
        img = await o.evaluate("K.raw.assets[0] && K.raw.assets[0].image"); ok('Photo uploaded to the server (not inline)', img and not str(img).startswith('data:'), img)
        ok('Photo displays', await o.evaluate("(()=>{const i=document.querySelector('.scrim img.thumb'); return !!(i && i.complete && i.naturalWidth>0)})()"))
        det = await o.inner_text('.scrim >> nth=-1'); ok('Saved on the server and opened', 'Forklift' in det and '3 500 000' in det, det[:300])
        await o.click('.scrim >> nth=-1 >> [data-a=assetCost] >> nth=0'); await o.fill('.scrim >> nth=-1 >> [name=amount]', '30000'); await o.click('#acGo'); await o.wait_for_timeout(1200)
        await o.click('.scrim >> nth=-1 >> [data-a=assetDispose]'); await o.fill('.scrim >> nth=-1 >> [name=amount]', '2900000'); await o.fill('.scrim >> nth=-1 >> [name=reason]', 'Upgrade'); await o.click('#adGo'); await o.wait_for_timeout(1500)
        await closeall(o); await o.reload(); await o.wait_for_timeout(2000)
        a = await o.evaluate("K.raw.assets[0]"); ok('Sale stored on the server with server-computed book value', a['status'] == 'sold' and a['disposal']['bookValue'] > 0, a.get('disposal'))
        await o.goto(U + '#reports'); await o.wait_for_timeout(800); await o.click('[data-a=repTab][data-v=monthly]'); await o.wait_for_timeout(800); v = await o.inner_text('#view')
        ok('P&L shows depreciation and the gain/loss', 'Depreciation of assets' in v and 'on assets sold' in v, v[:600])
        await o.goto(U + '#activity'); await o.wait_for_timeout(2000); v = await o.inner_text('#view')
        ok('Server activity log has the asset entries', 'Registered asset Forklift' in v and 'Sold asset Forklift' in v, v[:500])
        rc = await b.new_context(viewport={'width': 390, 'height': 844}); r = await rc.new_page(); r.on('pageerror', lambda e: errs.append('REP ' + str(e)))
        await r.goto(U); await r.wait_for_timeout(500); await r.fill('[name=login]', 'ra' + rnd); await r.fill('[name=password]', 'pass123'); await r.click('#go'); await r.wait_for_timeout(2500)
        ok('Rep receives no assets from the server', await r.evaluate("K.raw.assets.length") == 0)
        await r.goto(U + '#assets'); await r.wait_for_timeout(600); ok('Rep cannot open Assets', (await r.inner_text('#title')) == 'Home')
        print('ERRORS:', errs or 'none'); fails = [c for c in checks if not c[1]]; print('==== %d checks, %d failed ====' % (len(checks), len(fails)))
        await b.close(); sys.exit(1 if fails or errs else 0)
asyncio.run(main())
