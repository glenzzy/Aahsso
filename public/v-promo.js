/* Kargo — promotions: % off, amount off or a promo price, on all items, one category or chosen items, for a period.
 * The running promotion is applied automatically when selling (New sale, online shop) and saved on each sale line. */
const promoDesc = (pr) => pr.type === 'pct' ? num(pr.value) + '% off' : pr.type === 'amount' ? F(pr.value) + ' off' : 'Promo price ' + F(pr.value);
const promoDates = (pr) => (pr.start ? fmtDate(pr.start) : 'Now') + ' → ' + (pr.end ? fmtDate(pr.end) : 'until ended');
const promoBadge = (st) => st === 'running' ? '<span class="badge ok">Running</span>' : st === 'scheduled' ? '<span class="badge info">Coming</span>' : '<span class="badge">Ended</span>';
const promoScope = (pr) => pr.scope === 'all' ? 'All items' : pr.scope === 'category' ? (pr.category || 'Category') : ((pr.productIds || []).length + ' item' + ((pr.productIds || []).length === 1 ? '' : 's'));
const promoItems = (pr) => K.raw.products.filter((p) => !p.archived && KC.promoCovers(pr, p));
/** Units and money sold at this promotion's price (sale lines carry the promo id). */
function promoSales(pr) {
  let units = 0, revenue = 0, n = 0;
  K.raw.sales.forEach((s) => { if ((K.C.saleX[s.id] || {}).status === 'cancelled') return; let hit = false; (s.lines || []).forEach((l) => { if (l.promoId !== pr.id) return; const q = num(l.qty) - (l.returns || []).reduce((a, r) => a + num(r.qty), 0); units += q; revenue += q * num(l.unitPrice); hit = true; }); if (hit) n++; });
  return { units, revenue, n };
}
VIEWS.promos = {
  render() {
    const list = (K.raw.promos || []).slice(); const order = { running: 0, scheduled: 1, ended: 2 };
    list.sort((a, b) => order[KC.promoStatus(a)] - order[KC.promoStatus(b)] || (b.start || '').localeCompare(a.start || ''));
    const running = list.filter((pr) => KC.promoStatus(pr) === 'running');
    const onPromo = K.raw.products.filter((p) => (K.C.prodX[p.id] || {}).promo).length;
    return '<div class="toolbar mb">' + (can('stockEdit') ? '<button class="btn pri" data-a="promoEdit">' + ic('plus') + 'Launch a promotion</button>' : '') +
        '<span class="hint">' + (running.length ? running.length + ' running · ' + onPromo + ' item' + (onPromo === 1 ? '' : 's') + ' on promotion now' : 'No promotion running') + '</span></div>' +
      dataTable({
        id: 'promoList', rows: list, noun: 'promotion',
        empty: '<div class="big">🏷️</div>No promotions yet. Launch one to put items on sale for a period — prices change by themselves when it starts and ends.',
        rowAttr: (pr) => ' data-a="promoOpen" data-id="' + pr.id + '"',
        cols: [
          { k: 'name', label: 'Promotion', core: true, v: (pr) => pr.name || 'Promotion', html: (pr) => '<b>' + esc(pr.name || 'Promotion') + '</b>' },
          { k: 'disc', label: 'Discount', core: true, v: promoDesc },
          { k: 'scope', label: 'Applies to', core: true, v: promoScope },
          { k: 'items', label: 'Items', num: true, v: (pr) => promoItems(pr).length },
          { k: 'start', label: 'Starts', v: (pr) => pr.start || '', html: (pr) => dtDate(pr.start) },
          { k: 'end', label: 'Ends', core: true, v: (pr) => pr.end || '', html: (pr) => pr.end ? dtDate(pr.end) : '<span class="faint">Until ended</span>' },
          { k: 'status', label: 'Status', core: true, v: (pr) => KC.promoStatus(pr), html: (pr) => promoBadge(KC.promoStatus(pr)) },
          { k: 'units', label: 'Units sold', core: true, num: true, v: (pr) => promoSales(pr).units || '' },
          { k: 'rev', label: 'Sales', core: true, money: true, v: (pr) => Math.round(promoSales(pr).revenue) || '' },
          { k: 'by', label: 'Launched by', v: (pr) => pr.by || '', cls: 'mut' },
        ],
      });
  },
};
/** Categories of the items in stock first, then the rest of the category list. */
const promoCats = () => { const used = [...new Set(K.raw.products.filter((p) => !p.archived && (K.C.prodX[p.id] || {}).available > 0).map((p) => p.category).filter(Boolean))].sort(); return used.concat(catOpts().filter((c) => !used.includes(c))); };
A.promoFor = (el) => promoForm(null, { scope: 'items', productIds: [el.dataset.id] });
A.promoEdit = (el) => promoForm(el && el.dataset && el.dataset.id ? el.dataset.id : null);
function promoForm(id, preset) {
  if (!can('stockEdit')) return toast('Only people who set prices can launch promotions', true);
  const old = id ? byId('promos', id) : null;
  const st = Object.assign({ name: '', type: 'pct', value: '', scope: 'all', category: promoCats()[0] || '', productIds: [], start: todayStr(), end: '', note: '' }, old || {}, preset || {});
  st.productIds = new Set(st.productIds || []);
  const sh = openSheet({ title: old ? 'Edit promotion' : 'Launch a promotion', wide: true, body: '',
    foot: '<button class="btn grow" data-a="sheetClose">Cancel</button><button class="btn pri grow" id="prSave">' + (old ? 'Save promotion' : 'Launch promotion') + '</button>' });
  const segBtns = (name, opts, v) => '<div class="seg" data-seg="' + name + '">' + opts.map(([k, l]) => '<button type="button" class="' + (k === v ? 'on' : '') + '" data-v="' + k + '">' + l + '</button>').join('') + '</div>';
  const stock = () => K.raw.products.filter((p) => !p.archived && ((K.C.prodX[p.id] || {}).available > 0 || st.productIds.has(p.id))).sort((a, b) => a.name.localeCompare(b.name));
  const draw = () => {
    setSheetBody(sh, '<div class="col pr-form">' +
      field('Name', inp('prName', st.name, 'placeholder="e.g. Black Friday, End of year sale, Back to school" id="prName" autocomplete="off"')) +
      '<div><div class="lbl pr-l">Discount</div><div class="row wrap gap6">' + segBtns('type', KC.PROMO_TYPES, st.type) +
        '<div class="fee-in pr-val"><input class="inp" id="prVal" inputmode="decimal" value="' + esc(st.value) + '" placeholder="' + (st.type === 'pct' ? '20' : '0') + '" aria-label="Discount value"><span class="fee-u">' + (st.type === 'pct' ? '%' : esc(baseSym())) + '</span></div></div></div>' +
      '<div><div class="lbl pr-l">Applies to</div>' + segBtns('scope', [['all', 'All items'], ['category', 'A category'], ['items', 'Chosen items']], st.scope) +
        (st.scope === 'category' ? '<div class="mt" style="max-width:320px">' + sel('prCat', promoCats(), st.category, 'id="prCat"') + '</div>' : '') +
        (st.scope === 'items' ? '<div class="pr-pick mt"><div class="search">' + ic('search') + '<input class="inp" id="prQ" placeholder="Search items in stock" autocomplete="off"></div><div class="pr-list" id="prList"></div></div>' : '') + '</div>' +
      '<div class="grid2">' + field('Starts', inp('prStart', st.start, 'type="date" id="prStart"')) + field('Ends · optional', inp('prEnd', st.end, 'type="date" id="prEnd"')) + '</div>' +
      '<div class="pr-prev" id="prPrev"></div></div>');
    if (st.scope === 'items') drawList('');
    preview();
  };
  const drawList = (q) => {
    const L = $('#prList', sh); if (!L) return; const ql = q.toLowerCase();
    const ps = stock().filter((p) => !ql || p.name.toLowerCase().includes(ql)).slice(0, 80);
    L.innerHTML = ps.length ? ps.map((p) => { const x = K.C.prodX[p.id]; const on = st.productIds.has(p.id); return '<label class="pr-it' + (on ? ' on' : '') + '"><input type="checkbox" data-pp="' + p.id + '"' + (on ? ' checked' : '') + '><span class="grow">' + esc(p.name) + '<span class="sub">' + fmt(x.available) + ' in stock</span></span><span class="pr-px">' + (on && num(st.value) ? '<s class="faint">' + fmt(x.priceMax) + '</s> <b>' + fmt(KC.promoPriceOf(st, x.priceMax, S())) + '</b>' : fmt(x.priceMax)) + '</span></label>'; }).join('') : '<div class="hint pad">No item in stock matches.</div>';
  };
  const preview = () => {
    const P = $('#prPrev', sh); if (!P) return;
    const items = K.raw.products.filter((p) => !p.archived && KC.promoCovers(Object.assign({}, st, { productIds: [...st.productIds] }), p) && (K.C.prodX[p.id] || {}).available > 0);
    if (!num(st.value)) { P.innerHTML = '<span class="hint">Type the discount to see the new prices.</span>'; return; }
    if (!items.length) { P.innerHTML = '<span class="hint">No item in stock is covered yet.</span>'; return; }
    const ex = items.slice(0, 3).map((p) => { const x = K.C.prodX[p.id]; return esc(p.name) + ' <s class="faint">' + fmt(x.priceMax) + '</s> → <b>' + F(KC.promoPriceOf(st, x.priceMax, S())) + '</b>'; });
    const under = seeCost() ? items.filter((p) => { const x = K.C.prodX[p.id]; return x.avgCost && KC.promoPriceOf(st, x.priceMax, S()) < x.avgCost; }) : [];
    P.innerHTML = '<div><b>' + items.length + ' item' + (items.length === 1 ? '' : 's') + '</b> in stock on promotion</div><div class="pr-ex">' + ex.join('<br>') + (items.length > 3 ? '<br><span class="faint">…and ' + (items.length - 3) + ' more</span>' : '') + '</div>' +
      (under.length ? '<div class="pr-warn">' + ic('alert', 'sm') + under.length + ' item' + (under.length === 1 ? ' goes' : 's go') + ' below landed cost: ' + esc(under.slice(0, 3).map((p) => p.name).join(', ')) + (under.length > 3 ? '…' : '') + '</div>' : '');
  };
  sh.addEventListener('click', (e) => { const b = e.target.closest('[data-seg] button'); if (!b) return; const k = b.closest('[data-seg]').dataset.seg; st[k] = b.dataset.v; if (k === 'type') st.value = ''; draw(); if (k === 'type') $('#prVal', sh).focus(); });
  sh.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'prName') st.name = t.value; else if (t.id === 'prVal') { st.value = t.value; if (st.scope === 'items') drawList(($('#prQ', sh) || {}).value || ''); preview(); }
    else if (t.id === 'prQ') drawList(t.value); else if (t.id === 'prStart') st.start = t.value; else if (t.id === 'prEnd') st.end = t.value;
  });
  sh.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.pp) { if (t.checked) st.productIds.add(t.dataset.pp); else st.productIds.delete(t.dataset.pp); drawList(($('#prQ', sh) || {}).value || ''); preview(); }
    else if (t.id === 'prCat') { st.category = t.value; preview(); } else if (t.id === 'prStart') st.start = t.value; else if (t.id === 'prEnd') st.end = t.value;
  });
  draw();
  setTimeout(() => { const n = $('#prName', sh); if (n && !st.name) n.focus(); }, 60);
  $('#prSave', sh).onclick = async () => {
    const v = num(st.value);
    if (!st.name.trim()) { toast('Give the promotion a name', true); $('#prName', sh).focus(); return; }
    if (!(v > 0)) { toast('Type the discount', true); $('#prVal', sh).focus(); return; }
    if (st.type === 'pct' && v >= 100) return toast('A percentage must be below 100', true);
    if (st.scope === 'items' && !st.productIds.size) return toast('Choose at least one item', true);
    if (st.end && st.start && st.end < st.start) return toast('The end date is before the start date', true);
    const obj = Object.assign({}, old || {}, { id: id || uid('pr_'), name: st.name.trim(), type: st.type, value: v, scope: st.scope, category: st.scope === 'category' ? st.category : '', productIds: st.scope === 'items' ? [...st.productIds] : [], start: st.start || todayStr(), end: st.end || '' });
    if (!old) Object.assign(obj, { by: K.me.name || K.info.userLabel || '', byId: K.me.id || '', status: '' });
    if (await save('promos', obj)) { closeSheet(); scheduleRender(); refreshSheets(); const hs = K.sheets.find((x) => x._hist); if (hs) reopenHistory(hs._hist); toast(old ? 'Promotion saved' : KC.promoStatus(obj) === 'running' ? obj.name + ' is running — prices updated' : obj.name + ' starts ' + fmtDate(obj.start)); }
  };
}
A.promoOpen = (el) => {
  const id = el.dataset.id;
  const sh = openSheet({ title: 'Promotion', wide: true, body: '' });
  sh._refresh = () => {
    const pr = byId('promos', id); if (!pr) return closeSheet(); const stt = KC.promoStatus(pr); const sales = promoSales(pr);
    $('.sh h2', sh).textContent = pr.name || 'Promotion';
    const items = promoItems(pr).sort((a, b) => a.name.localeCompare(b.name));
    setSheetBody(sh, '<div class="row between wrap mb"><div>' + promoBadge(stt) + ' <span class="muted small">' + esc(promoDesc(pr)) + ' · ' + esc(promoScope(pr)) + ' · ' + esc(promoDates(pr)) + '</span></div>' +
        (can('stockEdit') ? '<div class="row gap6">' + (stt !== 'ended' ? '<button class="btn sm" data-a="promoEdit" data-id="' + id + '">' + ic('edit', 'sm') + 'Edit</button><button class="btn sm danger" data-a="promoEnd" data-id="' + id + '">End now</button>' : '') + (!sales.n ? '<button class="btn sm ghost" data-a="promoDel" data-id="' + id + '">' + ic('trash', 'sm') + 'Delete</button>' : '') + '</div>' : '') + '</div>' +
      '<div class="kpis mb">' + kpi('Items', fmt(items.length)) + kpi('Units sold at promo price', fmt(sales.units), sales.n + ' sale' + (sales.n === 1 ? '' : 's')) + kpi('Sales', F(sales.revenue)) + kpi('Launched by', esc(pr.by || '—'), pr.createdAt ? fmtDT(pr.createdAt) : '') + '</div>' +
      (pr.status === 'ended' && pr.endedBy ? '<div class="hint mb">Ended by ' + esc(pr.endedBy) + (pr.endedAt ? ' · ' + esc(fmtDT(pr.endedAt)) : '') + '</div>' : '') +
      '<div class="card tw"><table class="t"><thead><tr><th>Item</th><th class="r">In stock</th><th class="r">Normal price</th><th class="r">Promo price</th><th class="r">Saving</th>' + (seeCost() ? '<th class="r">Profit / unit</th>' : '') + '</tr></thead><tbody>' +
        items.slice(0, 300).map((p) => { const x = K.C.prodX[p.id]; const pp = KC.promoPriceOf(pr, x.priceMax, S()); return '<tr><td>' + esc(p.name) + '</td><td class="r">' + fmt(x.available) + '</td><td class="r money faint">' + fmt(x.priceMax) + '</td><td class="r money b">' + fmt(pp) + '</td><td class="r">' + (x.priceMax ? pct((x.priceMax - pp) / x.priceMax * 100) : '—') + '</td>' + (seeCost() ? '<td class="r money' + (pp < x.avgCost ? ' neg-t' : '') + '">' + fmt(pp - x.avgCost) + '</td>' : '') + '</tr>'; }).join('') +
      '</tbody></table>' + (items.length ? '' : '<div class="empty small">No items covered.</div>') + '</div>');
  };
  sh._refresh();
};
A.promoEnd = async (el) => {
  const pr = byId('promos', el.dataset.id); if (!pr) return;
  if (!(await confirmBox('End "' + (pr.name || 'this promotion') + '" now? Prices go back to normal straight away.', 'End promotion', true))) return;
  if (await save('promos', Object.assign({}, pr, { status: 'ended', end: pr.end && pr.end < todayStr() ? pr.end : todayStr(), endedAt: new Date().toISOString(), endedBy: K.me.name || K.info.userLabel || '' }))) { refreshSheets(); scheduleRender(); toast('Promotion ended — normal prices are back'); }
};
A.promoDel = async (el) => {
  const pr = byId('promos', el.dataset.id); if (!pr) return;
  if (promoSales(pr).n) return toast('Items were sold with this promotion — end it instead', true);
  if (!(await confirmBox('Delete "' + (pr.name || 'this promotion') + '"?', 'Delete', true))) return;
  await remove('promos', pr.id); while (K.sheets.length) closeSheet(); scheduleRender(); toast('Promotion deleted');
};
