import asyncio, random, string, os
from playwright.async_api import async_playwright
U='http://localhost:8090/'; LIB=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'node_modules') + '/'
CDN={'xlsx.full.min.js':LIB+'xlsx/dist/xlsx.full.min.js','jspdf.umd.min.js':LIB+'jspdf/dist/jspdf.umd.min.js','JsBarcode.all.min.js':LIB+'jsbarcode/dist/JsBarcode.all.min.js'}
rnd=''.join(random.choice(string.ascii_lowercase) for _ in range(5))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--no-sandbox'])
        errs=[]; fails=[]
        async def mk():
            c = await b.new_context(viewport={'width':390,'height':844})
            async def cdn(route):
                n=route.request.url.split('/')[-1]; await (route.fulfill(path=CDN[n], content_type='application/javascript') if n in CDN else route.abort())
            await c.route('https://cdnjs.cloudflare.com/**', cdn); await c.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
            pg = await c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); return pg
        o = await mk()
        await o.goto(U); await o.wait_for_timeout(500); await o.click('#tReg'); await o.fill('[name=businessName]','Crawl Biz'); await o.fill('[name=name]','Owner C'); await o.fill('[name=login]','c'+rnd); await o.fill('[name=password]','secret1'); await o.click('#go'); await o.wait_for_timeout(2500)
        routes=['home','sell','sales','stock','buy','containers','customers','reports','expenses','cash','suppliers','reminders','assets','transfers','audit','activity','team','settings']
        for r in routes:
            await o.goto(U+'#'+r); await o.wait_for_timeout(700); v = await o.inner_text('#view')
            if len(v) < 20 or 'Report error' in v: fails.append('owner '+r)
        await o.goto(U+'#activity'); await o.wait_for_timeout(1200); a = await o.inner_text('#view')
        if 'Created the business account' not in a: fails.append('activity from server missing sign-in: '+a[:200])
        await o.goto(U+'#reminders'); await o.wait_for_timeout(1000); rv = await o.inner_text('#view')
        if 'Automatic reminders' not in rv: fails.append('auto reminders card missing')
        await o.goto(U+'#settings'); await o.wait_for_timeout(800); await o.fill('#pwOld','secret1'); await o.fill('#pwNew','secret2'); await o.click('[data-a=pwChange]'); await o.wait_for_timeout(800)
        t = await o.inner_text('.toast') if await o.query_selector('.toast') else ''
        if 'changed' not in t.lower(): fails.append('password change: '+t)
        await o.goto(U+'#team'); await o.wait_for_timeout(1000); await o.click('[data-a=saasAdd]'); await o.fill('[name=mName]','Rep R'); await o.fill('[name=mLogin]','r'+rnd); await o.fill('[name=mPass]','pass123'); await o.click('#mSave'); await o.wait_for_timeout(1000)
        r = await mk(); await r.goto(U); await r.wait_for_timeout(500); await r.fill('[name=login]','r'+rnd); await r.fill('[name=password]','pass123'); await r.click('#go'); await r.wait_for_timeout(2500)
        for rt in routes:
            await r.goto(U+'#'+rt); await r.wait_for_timeout(500)
        await r.goto(U+'#activity'); await r.wait_for_timeout(1200); ra = await r.inner_text('#view')
        if 'Owner C' in ra: fails.append('rep sees owner activity')
        print('FAILS:', fails or 'none'); print('ERRORS:', errs or 'none')
        await b.close()
asyncio.run(main())
