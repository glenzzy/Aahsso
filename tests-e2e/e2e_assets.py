"""End-to-end test of the business assets register (hosted build, claude.ai runtime simulated by shim.js).
Register (foreign currency + extra costs, photo, on credit → supplier bill, land without depreciation), value today
and yearly schedule, running costs → expenses & P&L, move / hand over, reminders on Home, depreciation and
sale gain/loss in Profit & loss, undo, delete with reason, filters & search, Excel, offline + resync,
activity log, backup/restore, sales rep has no access, phone + desktop screens. Fails on any page error."""
import asyncio, json, sys, os, datetime
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
U = 'http://localhost:8765/index.html'
LIB = os.path.join(HERE, 'node_modules') + '/'
CDN = {'xlsx.full.min.js': LIB + 'xlsx/dist/xlsx.full.min.js', 'jspdf.umd.min.js': LIB + 'jspdf/dist/jspdf.umd.min.js', 'JsBarcode.all.min.js': LIB + 'jsbarcode/dist/JsBarcode.all.min.js'}
RESULTS = []
def ok(name, cond, info=''):
    RESULTS.append((name, bool(cond), info)); print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(info) if info and not cond else ''))
fmt = lambda n: '{:,}'.format(round(n)).replace(',', ' ')

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
            await ctx.route('**/_blob/**', lambda r: r.fulfill(path='fixtures/tv.jpg', content_type='image/jpeg'))
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
            await pg.goto(U + '?as=' + who + '#' + route); await pg.wait_for_timeout(400)
        async def text(pg, sel='#view'): return await pg.inner_text(sel)
        async def top(pg): return await pg.inner_text('.scrim >> nth=-1')
        async def dl(pg, name_part):
            return await pg.evaluate("(n)=>{const k=Object.keys(window.__blobs||{}).find(x=>x.includes(n)); return k ? {name:k, size: window.__blobs[k].size} : null}", name_part)
        today = datetime.date.today().isoformat()
        soon = (datetime.date.today() + datetime.timedelta(days=10)).isoformat()

        ctx = await new_ctx(); o = await ctx.new_page(); watch(o, 'OWNER')
        await goto(o, 'settings'); await o.wait_for_timeout(900)
        await o.evaluate("save('locations', {id:'akwa', name:'Akwa shop', type:'Shop'})"); await o.wait_for_timeout(300)

        # ---------- empty state & menu ----------
        await goto(o, 'assets'); v = await text(o)
        ok('Assets screen explains what to register when empty', 'Register what the business owns' in v and 'stacker' in v)
        await o.click('[data-a=moreMenu]'); more = await top(o); await closeall(o)
        ok('Assets is in the menu for the owner', 'Assets' in more)

        # ---------- 1. stacker bought in USD + extra costs, with photo ----------
        await o.click('[data-a=assetNew]'); await o.wait_for_timeout(300)
        ok('Asset number suggested automatically', await o.input_value('.scrim [name=tag]') == 'A-0001')
        await o.fill('.scrim [name=name]', 'Electric stacker 1.5 t'); await o.select_option('.scrim [name=category]', 'Warehouse equipment')
        await o.fill('.scrim [name=make]', 'Toyota'); await o.fill('.scrim [name=serialNo]', 'SN-77881')
        await o.fill('.scrim [name=purchaseDate]', '2026-01-15'); await o.fill('.scrim [name=vendor]', "Sam's Club Houston")
        await o.fill('.scrim [name=price]', '3000'); await o.select_option('.scrim [name=currency]', 'USD'); await o.fill('.scrim [name=extraCosts]', '200000')
        await o.fill('.scrim [name=assignedTo]', 'Paul'); await o.wait_for_timeout(200)
        prev = await o.inner_text('#asPrev')
        ok('Live preview: full cost $3 000 × 600 + 200 000 = 2 000 000', '2 000 000' in prev, prev)
        ok('Live preview: loses 33 333 a month over 7 years by default?', ('33 333' in prev) or ('23 810' in prev), prev)
        await o.fill('.scrim [name=usefulLife]', '5'); await o.wait_for_timeout(150); prev = await o.inner_text('#asPrev')
        ok('Preview updates when life changes to 5 years (33 333 / month)', '33 333' in prev, prev)
        async with o.expect_file_chooser() as fc: await o.click('#asPhoto')
        await (await fc.value).set_files('fixtures/tv.jpg'); await o.wait_for_timeout(700)
        await o.click('#asSave'); await o.wait_for_timeout(700)
        det = await top(o)
        exp_book = await o.evaluate("Math.round(KC.assetValue(K.raw.assets[0], S(), todayStr()).book)")
        ok('Asset saved and its page opens', 'Electric stacker' in det and 'A-0001' in det)
        ok('Value today shown and correct (' + fmt(exp_book) + ')', fmt(exp_book) in det, det[:300])
        ok('Year-by-year schedule: 400 000 per year down to 0', det.count('400 000') >= 4 and '2030' in det)
        ok('Photo stored with the asset', await o.evaluate("!!K.raw.assets[0].image"))
        ok('History records who registered it', 'Registered, with Paul' in det)
        await closeall(o)

        # ---------- 2. truck on credit → supplier bill; insurance reminder ----------
        await o.click('[data-a=assetNew]'); await o.wait_for_timeout(300)
        await o.fill('.scrim [name=name]', 'Toyota Dyna truck'); await o.select_option('.scrim [name=category]', 'Vehicles')
        ok('Default life follows the type (vehicles 5 yrs)', await o.input_value('.scrim [name=usefulLife]') == '5')
        await o.select_option('.scrim [name=currency]', 'XAF'); await o.fill('.scrim [name=price]', '8500000'); await o.fill('.scrim [name=serialNo]', 'LT 456 AB')
        await o.select_option('.scrim [name=payMode]', '__credit'); await o.select_option('.scrim [name=supplierId]', '__new'); await o.fill('.scrim [name=newSupplier]', 'Garage Akwa')
        await o.fill('.scrim [name=insuranceUntil]', soon); await o.click('#asSave'); await o.wait_for_timeout(900); await closeall(o)
        ok('Second asset numbered A-0002', await o.evaluate("K.raw.assets.find(a=>a.name==='Toyota Dyna truck').tag") == 'A-0002')
        await goto(o, 'suppliers'); v = await text(o)
        ok('"Not paid yet" created a bill to the seller', 'Garage Akwa' in v and '8 500 000' in v, v[:400])
        await goto(o, 'home'); v = await text(o)
        ok('Home warns about the insurance ending', 'asset reminder' in v and 'Insurance ends' in v, v[:500])

        # ---------- 3. land: no depreciation; duplicate number refused ----------
        await goto(o, 'assets'); await o.click('[data-a=assetNew]'); await o.wait_for_timeout(300)
        await o.fill('.scrim [name=name]', 'Plot at Bonaberi'); await o.select_option('.scrim [name=category]', 'Land')
        ok('Land switches to no depreciation', await o.input_value('.scrim [name=depMethod]') == 'none')
        await o.select_option('.scrim [name=currency]', 'XAF'); await o.fill('.scrim [name=price]', '15000000'); await o.fill('.scrim [name=tag]', 'A-0001')
        await o.click('#asSave'); await o.wait_for_timeout(400)
        ok('Duplicate asset number is refused', len(await o.query_selector_all('.scrim')) >= 1 and await o.evaluate("K.raw.assets.length") == 2)
        await o.fill('.scrim [name=tag]', 'A-0003'); await o.click('#asSave'); await o.wait_for_timeout(700)
        ok('Land keeps its full value', '15 000 000' in await top(o) and 'no depreciation' in (await top(o)).lower()); await closeall(o)

        # ---------- 4. KPIs, filters, search ----------
        await goto(o, 'assets'); v = await text(o)
        tot = await o.evaluate("(()=>{const m=monthStr(); const t=KC.assetTotals(K.raw.assets,S(),m+'-01',monthEnd(m)); return [Math.round(t.book), Math.round(t.cost), Math.round(t.depreciation)]})()")
        ok('KPI: value today of all assets', fmt(tot[0]) in v, (tot, v[:300]))
        ok('KPI: bought for (25.5 M incl. extra costs)', fmt(tot[1]) in v and tot[1] == 25500000, tot)
        ok('KPI: this month\'s depreciation', fmt(tot[2]) in v, tot)
        await o.fill('[data-i=assetQ]', 'LT 456'); await o.wait_for_timeout(300); lst = await text(o, '#assetList')
        ok('Search finds by plate number', 'Toyota Dyna' in lst and 'stacker' not in lst)
        await o.fill('[data-i=assetQ]', ''); await o.wait_for_timeout(250)
        await o.select_option('[data-c=assetCat]', 'Vehicles'); await o.wait_for_timeout(300); lst = await text(o, '#assetList')
        ok('Filter by type', 'Toyota Dyna' in lst and 'Plot' not in lst)
        await o.select_option('[data-c=assetCat]', ''); await o.wait_for_timeout(300)

        # ---------- 5. running cost → expense; move / hand over ----------
        sid = await o.evaluate("K.raw.assets.find(a=>a.tag==='A-0001').id")
        await o.evaluate("(id)=>assetOpen(id)", sid); await o.wait_for_timeout(300)
        await o.click('.scrim >> nth=-1 >> [data-a=assetCost] >> nth=0'); await o.wait_for_timeout(200)
        await o.fill('.scrim >> nth=-1 >> [name=amount]', '45000'); await o.fill('.scrim >> nth=-1 >> [name=description]', 'New battery')
        await o.fill('.scrim >> nth=-1 >> [name=nextService]', soon); await o.click('#acGo'); await o.wait_for_timeout(600)
        det = await top(o)
        ok('Repair saved on the asset page', 'New battery' in det and '45 000' in det)
        ok('Next service date updated on the asset', await o.evaluate("(id)=>byId('assets',id).nextServiceDate", sid) == soon)
        await o.click('.scrim >> nth=-1 >> [data-a=assetMove]'); await o.wait_for_timeout(200)
        await o.select_option('.scrim >> nth=-1 >> [name=locationId]', 'akwa'); await o.fill('.scrim >> nth=-1 >> [name=assignedTo]', 'Jenny'); await o.fill('.scrim >> nth=-1 >> [name=note]', 'Unloading at the shop')
        await o.click('#amGo'); await o.wait_for_timeout(600); det = await top(o)
        ok('Move + hand over recorded in history with the reason', 'Moved Main warehouse → Akwa shop' in det and 'Given to Jenny' in det and 'Unloading at the shop' in det, det[-600:])
        await closeall(o)
        await goto(o, 'expenses'); v = await text(o)
        ok('The repair also appears in Expenses, linked to the asset', 'Repairs & maintenance' in v and 'Electric stacker' in v)
        await o.click('[data-a=expEdit]'); ok('Expense form offers "For asset"', await o.query_selector('.scrim [name=assetId]') is not None); await closeall(o)

        # ---------- 6. Profit & loss ----------
        await goto(o, 'reports'); await o.click('[data-a=repTab][data-v=monthly]'); await o.wait_for_timeout(500); v = await text(o)
        dep = await o.evaluate("(()=>{const m=monthStr(); return Math.round(KC.assetTotals(K.raw.assets,S(),m+'-01',monthEnd(m)).depreciation)})()")
        ok('P&L shows depreciation of assets (' + fmt(dep) + ')', 'Depreciation of assets' in v and fmt(dep) in v, v[:800])

        # ---------- 7. sell: reason required, gain/loss, undo ----------
        await o.evaluate("(id)=>assetOpen(id)", sid); await o.wait_for_timeout(300)
        await o.click('.scrim >> nth=-1 >> [data-a=assetDispose]'); await o.wait_for_timeout(200)
        await o.fill('.scrim >> nth=-1 >> [name=amount]', '1500000'); await o.fill('.scrim >> nth=-1 >> [name=buyer]', 'Ets Ndi'); await o.wait_for_timeout(150)
        pv = await o.inner_text('#adPrev'); book_today = await o.evaluate("(id)=>Math.round(KC.assetBookOn(byId('assets',id), S(), todayStr()))", sid)
        ok('Sale preview shows book value and the loss', fmt(book_today) in pv and 'Loss' in pv and fmt(book_today - 1500000) in pv, pv)
        await o.click('#adGo'); await o.wait_for_timeout(300)
        ok('Cannot sell without a reason', await o.evaluate("(id)=>byId('assets',id).status||'in_use'", sid) == 'in_use')
        await o.fill('.scrim >> nth=-1 >> [name=reason]', 'Replaced by a bigger stacker'); await o.click('#adGo'); await o.wait_for_timeout(700)
        det = await top(o)
        ok('Asset marked Sold with buyer, price and loss', 'Sold on' in det and 'Ets Ndi' in det and 'loss ' + fmt(book_today - 1500000) in det, det[:500])
        await closeall(o)
        await goto(o, 'assets'); v = await text(o)
        ok('Sold asset leaves the "Owned now" list', 'Electric stacker' not in await text(o, '#assetList'))
        await o.click('[data-a=assetF][data-v=gone]'); await o.wait_for_timeout(300)
        ok('…and is listed under Sold / written off', 'Electric stacker' in await text(o, '#assetList') and 'sold for' in await text(o, '#assetList'))
        await goto(o, 'reports'); await o.click('[data-a=repTab][data-v=monthly]'); await o.wait_for_timeout(500); v = await text(o)
        ok('P&L shows the loss on the asset sold', 'Loss on assets sold' in v and fmt(book_today - 1500000) in v, v[:900])
        net = await o.evaluate("""(()=>{const m=monthStr(); const t=KC.assetTotals(K.raw.assets,S(),m+'-01',monthEnd(m)); return [Math.round(t.depreciation), Math.round(t.gain)]})()""")
        ok('Depreciation stops at the sale date', net[0] < dep or dep == 0, (net, dep))
        await o.evaluate("(id)=>assetOpen(id)", sid); await o.wait_for_timeout(300)
        await o.click('.scrim >> nth=-1 >> [data-a=assetUndo]'); await o.wait_for_timeout(200); await o.click('#rsnOk'); await o.wait_for_timeout(600)
        ok('Undo puts it back in use', await o.evaluate("(id)=>byId('assets',id).status", sid) == 'in_use' and 'Put back in use' in await top(o))
        # write off as stolen
        await o.click('.scrim >> nth=-1 >> [data-a=assetDispose]'); await o.wait_for_timeout(200)
        await o.select_option('.scrim >> nth=-1 >> [name=type]', 'stolen'); await o.fill('.scrim >> nth=-1 >> [name=reason]', 'Police report 2026/114'); await o.click('#adGo'); await o.wait_for_timeout(600)
        ok('Stolen write-off: full book value lost', await o.evaluate("(id)=>{const a=byId('assets',id); return a.status==='stolen' && Math.round(KC.assetValue(a,S(),todayStr()).gain)===-Math.round(a.disposal.bookValue)}", sid))
        await closeall(o)

        # ---------- 8. delete: blocked when linked, allowed with reason otherwise ----------
        lid = await o.evaluate("K.raw.assets.find(a=>a.category==='Land').id")
        await o.evaluate("(id)=>assetForm(id)", lid); await o.wait_for_timeout(300); await o.click('#asDel'); await o.wait_for_timeout(200); await o.click('#rsnOk'); await o.wait_for_timeout(500)
        ok('Asset registered by mistake can be deleted (with a reason)', await o.evaluate("(id)=>!byId('assets',id)", lid))
        await closeall(o)
        tid = await o.evaluate("K.raw.assets.find(a=>a.tag==='A-0002').id")
        await o.evaluate("(id)=>assetForm(id)", tid); await o.wait_for_timeout(300); await o.click('#asDel'); await o.wait_for_timeout(300)
        ok('Asset with a bill linked cannot be deleted', await o.evaluate("(id)=>!!byId('assets',id)", tid)); await closeall(o)

        # ---------- 9. offline register → resync ----------
        await goto(o, 'assets'); await ctx.set_offline(True); await o.wait_for_timeout(200)
        await o.click('[data-a=assetNew]'); await o.wait_for_timeout(300); await o.fill('.scrim [name=name]', 'Generator 20 kVA'); await o.select_option('.scrim [name=category]', 'Generators & power')
        await o.select_option('.scrim [name=currency]', 'XAF'); await o.fill('.scrim [name=price]', '2400000'); await o.click('#asSave'); await o.wait_for_timeout(900); await closeall(o)
        sync = await o.inner_text('#sync'); ok('Registered while offline — waiting to sync', 'to sync' in sync, sync)
        await ctx.set_offline(False); await o.wait_for_timeout(3000)
        stored = await o.evaluate("(JSON.parse(localStorage.getItem('mockdb')||'{}').assets||{})")
        ok('Offline asset reached the shared database after reconnecting', any(x.get('name') == 'Generator 20 kVA' for x in (stored.values() if isinstance(stored, dict) else stored)), str(stored)[:300])

        # ---------- 10. Excel, activity, backup ----------
        await goto(o, 'assets'); await o.click('[data-a=assetXlsx]'); await o.wait_for_timeout(800)
        ok('Excel register downloads', await dl(o, 'Assets-'))
        await goto(o, 'activity'); await o.wait_for_timeout(1500); act = await text(o)
        ok('Activity log: registered, moved, sold, written off', 'Registered asset Electric stacker' in act and 'Moved asset' in act and 'Sold asset Electric stacker 1.5 t to Ets Ndi' in act and 'next service ' + soon in act and 'Wrote off asset' in act, act[act.find('action(s)'):][:3000])
        await goto(o, 'settings'); await o.click('[data-a=backupJson]'); await o.wait_for_timeout(1500)
        bj = json.loads(await o.evaluate("(async()=>{const k=Object.keys(window.__blobs).filter(x=>x.startsWith('Backup')).pop(); return await window.__blobs[k].text()})()"))
        ok('Backup contains the assets', len(bj['data'].get('assets', [])) == 3, len(bj['data'].get('assets', [])))
        open('/tmp/backup_assets.json', 'w').write(json.dumps(bj))
        ctx2 = await new_ctx(); o2 = await ctx2.new_page(); watch(o2, 'RESTORE')
        await o2.goto(U + '?as=owner#settings'); await o2.wait_for_timeout(900)
        async with o2.expect_file_chooser() as fc: await o2.click('[data-a=restore]')
        await (await fc.value).set_files('/tmp/backup_assets.json'); await o2.wait_for_timeout(300); await o2.click('#cbOk'); await o2.wait_for_timeout(3500)
        ok('Restore brings the assets back with the same values', await o2.evaluate("K.raw.assets.length") == 3 and await o2.evaluate("Math.round(K.raw.assets.reduce((s,a)=>s+KC.assetValue(a,S(),todayStr()).book,0))") == await o.evaluate("Math.round(K.raw.assets.reduce((s,a)=>s+KC.assetValue(a,S(),todayStr()).book,0))"))
        await ctx2.close()

        # ---------- 11. sales rep: no access ----------
        r = await ctx.new_page(); watch(r, 'REP'); await r.goto(U + '?as=rep#home'); await r.wait_for_timeout(1200)
        await goto(o, 'team'); await o.click('[data-a=reqApprove]'); await o.click('#mSave'); await o.wait_for_timeout(900)
        await r.reload(); await r.wait_for_timeout(1200)
        await r.click('[data-a=moreMenu]'); more = await top(r); await closeall(r)
        ok('Sales rep does not see Assets in the menu', 'Assets' not in more)
        await r.goto(U + '?as=rep#assets'); await r.wait_for_timeout(500)
        ok('Sales rep sent to Home if opening #assets', (await r.inner_text('#title')) == 'Home')

        # ---------- 12. screens: phone + desktop ----------
        await goto(o, 'assets'); await o.screenshot(path='assets_phone.png', full_page=True)
        await o.evaluate("(id)=>assetOpen(id)", tid); await o.wait_for_timeout(300); await o.screenshot(path='assets_phone_detail.png'); await closeall(o)
        dctx = await new_ctx(1366, 900); d = await dctx.new_page(); watch(d, 'DESKTOP')
        await d.goto(U + '?as=owner#home'); await d.evaluate("(b)=>{localStorage.setItem('mockdb', b)}", await o.evaluate("localStorage.getItem('mockdb')")); await d.reload(); await d.wait_for_timeout(1200)
        await goto(d, 'assets'); v = await text(d); ok('Desktop renders Assets', 'Toyota Dyna' in v)
        await d.screenshot(path='assets_desktop.png', full_page=True)
        await d.evaluate("(id)=>assetOpen(id)", tid); await d.wait_for_timeout(300); await d.screenshot(path='assets_desktop_detail.png')
        await dctx.close()

        print('\n==== ERRORS ====\n' + ('\n'.join(errs) if errs else 'none'))
        fails = [r for r in RESULTS if not r[1]]
        print('\n==== %d checks, %d failed ====' % (len(RESULTS), len(fails)))
        for f in fails: print('FAIL', f[0], f[2])
        await b.close()
        sys.exit(1 if fails or errs else 0)
asyncio.run(main())
