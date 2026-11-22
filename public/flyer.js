/* Aahsso Bar & Resto — the daily menu flyer: today's dishes, branded with the restaurant's logo, name and contacts,
 * drawn on a canvas and saved as a PNG (square for WhatsApp / Instagram, story, or an A4 poster). Nothing leaves the phone. */
const Flyer = (() => {
  const THEMES = {
    green: { name: 'Ndolè green', bg: ['#0f3d2e', '#14533e'], ink: '#fdf8ec', soft: 'rgba(253,248,236,.72)', accent: '#e9b949', card: 'rgba(255,255,255,.08)', line: 'rgba(233,185,73,.55)' },
    red: { name: 'Pepper red', bg: ['#7a1d12', '#a3291a'], ink: '#fff6ea', soft: 'rgba(255,246,234,.75)', accent: '#ffcf70', card: 'rgba(255,255,255,.09)', line: 'rgba(255,207,112,.6)' },
    night: { name: 'Night', bg: ['#111b2b', '#1c2c44'], ink: '#f4f1ea', soft: 'rgba(244,241,234,.7)', accent: '#f0a73a', card: 'rgba(255,255,255,.07)', line: 'rgba(240,167,58,.55)' },
    fresh: { name: 'Fresh', bg: ['#fffdf7', '#f4efe2'], ink: '#1d2a26', soft: 'rgba(29,42,38,.66)', accent: '#0f766e', card: 'rgba(15,118,110,.07)', line: 'rgba(15,118,110,.45)' },
  };
  const SIZES = { square: { name: 'Square post', hint: 'WhatsApp, Instagram, Facebook', w: 1080, h: 1080 }, story: { name: 'Status / story', hint: 'WhatsApp status, Instagram story', w: 1080, h: 1920 }, a4: { name: 'Poster (A4)', hint: 'Print and put up', w: 1240, h: 1754 } };
  const FONT = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const SERIF = 'Georgia, "Times New Roman", serif';
  const KEY = () => 'aahsso-flyer-' + ((K.info && K.info.tenant && K.info.tenant.id) || '');
  const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(KEY()) || 'null') || {}; } catch (e) { return {}; } };
  const today = () => (KC.venueClock(S()) || {}).date || todayStr();
  const savePrefs = (c) => { try { localStorage.setItem(KEY(), JSON.stringify({ theme: c.theme, size: c.size, prices: c.prices, link: c.link, title: c.title, extra: { date: today(), items: c.extra } })); } catch (e) { } };
  const dateLine = () => { const vc = KC.venueClock(S()) || { date: todayStr() }; const d = new Date(vc.date + 'T12:00:00'); return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); };
  const money = (n) => fmt(n) + ' F';
  function loadImg(src) { return new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }); }

  /* ---------- drawing ---------- */
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function fit(ctx, text, max, size, weight, family) { let s = size; do { ctx.font = weight + ' ' + s + 'px ' + family; if (ctx.measureText(text).width <= max) break; s -= 2; } while (s > 14); return s; }
  function clip(ctx, text, max) { if (ctx.measureText(text).width <= max) return text; let t = text; while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; }
  /** draws the flyer; the header shrinks (k) when the dishes need the room, so nothing ever overlaps */
  async function draw(cv, c) {
    try { await document.fonts.ready; } catch (e) { }
    const logo = await loadImg(c.logo);
    for (const k of [1, 0.82, 0.68]) { const r = render(cv, c, logo, k); if (r.fits || k === 0.68) return; }
  }
  function render(cv, c, logo, k) {
    const Z = SIZES[c.size] || SIZES.square, T = THEMES[c.theme] || THEMES.green; cv.width = Z.w; cv.height = Z.h;
    const ctx = cv.getContext('2d'); const W = Z.w, H = Z.h, M = Math.round(W * 0.075);
    // background, soft shapes
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, T.bg[0]); g.addColorStop(1, T.bg[1]); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalAlpha = 0.09; ctx.fillStyle = T.accent;
    ctx.beginPath(); ctx.arc(W * 0.95, H * 0.04, W * 0.32, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(W * 0.02, H * 0.98, W * 0.28, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.strokeStyle = T.line; ctx.lineWidth = 3; rr(ctx, M * 0.45, M * 0.45, W - M * 0.9, H - M * 0.9, 28); ctx.stroke();
    let y = M * (0.6 + 0.55 * k);
    // logo + name
    const L = Math.round(W * 0.115 * k);
    ctx.save(); ctx.beginPath(); ctx.arc(W / 2, y + L / 2, L / 2, 0, Math.PI * 2); ctx.closePath(); ctx.fillStyle = T.accent; ctx.fill();
    if (logo) { ctx.clip(); const r = Math.max(L / logo.width, L / logo.height); ctx.drawImage(logo, W / 2 - (logo.width * r) / 2, y + L / 2 - (logo.height * r) / 2, logo.width * r, logo.height * r); }
    else { ctx.fillStyle = T.bg[0]; ctx.font = '700 ' + Math.round(L * 0.4) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(initials(c.name || 'A').slice(0, 2), W / 2, y + L / 2 + 2); }
    ctx.restore(); y += L + W * 0.03 * k;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = T.ink;
    let s = fit(ctx, c.name || '', W - M * 2, Math.round(W * 0.05 * k), '800', FONT); ctx.fillText(c.name || '', W / 2, y + s * 0.85); y += s * 1.15;
    if (c.tagline) { ctx.fillStyle = T.soft; s = fit(ctx, c.tagline, W - M * 2, Math.round(W * 0.026 * Math.max(0.85, k)), '500', FONT); ctx.fillText(c.tagline, W / 2, y + s); y += s * 1.6; }
    // title + date
    y += W * 0.02 * k; ctx.fillStyle = T.accent; s = fit(ctx, c.title, W - M * 2, Math.round(W * 0.085 * k), 'italic 700', SERIF); ctx.fillText(c.title, W / 2, y + s * 0.85); y += s * 1.05;
    ctx.fillStyle = T.soft; ctx.font = '600 ' + Math.round(W * 0.026) + 'px ' + FONT; ctx.fillText(c.date.toUpperCase().split('').join(String.fromCharCode(8202)), W / 2, y + W * 0.03); y += W * (0.04 + 0.025 * k);
    // divider
    ctx.strokeStyle = T.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(W / 2 - W * 0.12, y); ctx.lineTo(W / 2 + W * 0.12, y); ctx.stroke(); ctx.fillStyle = T.accent; ctx.beginPath(); ctx.arc(W / 2, y, 6, 0, Math.PI * 2); ctx.fill(); y += W * 0.045 * k;
    // footer height first, so the list knows its room
    const tight = H / W < 1.2; // a square: phone and address on one line
    const foot = tight ? [[c.phone ? '☎  ' + c.phone : '', c.address || ''].filter(Boolean).join('   ·   '), c.link ? c.url : ''].filter(Boolean) : [c.phone ? '☎  ' + c.phone : '', c.address || '', c.link ? c.url : ''].filter(Boolean); const fs = Math.round(W * 0.024); const footH = foot.length ? foot.length * fs * 1.55 + W * 0.04 : 0;
    // dish of the day
    const sp = c.items.find((x) => x.id === c.special);
    if (sp) {
      const bh = W * 0.15 * Math.max(0.75, k); ctx.fillStyle = T.card; rr(ctx, M, y, W - M * 2, bh, 24); ctx.fill(); ctx.strokeStyle = T.line; ctx.lineWidth = 2; ctx.stroke();
      ctx.textAlign = 'left'; ctx.fillStyle = T.accent; ctx.font = '700 ' + Math.round(W * 0.022) + 'px ' + FONT; ctx.fillText('★  DISH OF THE DAY', M + W * 0.035, y + bh * 0.33);
      ctx.fillStyle = T.ink; s = fit(ctx, sp.name, W - M * 2 - W * 0.07 - (c.prices ? W * 0.22 : 0), Math.round(W * 0.045), '800', FONT); ctx.fillText(clip(ctx, sp.name, W - M * 2 - W * 0.3), M + W * 0.035, y + bh * 0.72);
      if (c.prices) { ctx.textAlign = 'right'; ctx.fillStyle = T.accent; ctx.font = '800 ' + Math.round(W * 0.045) + 'px ' + FONT; ctx.fillText(money(sp.price), W - M - W * 0.035, y + bh * 0.62); }
      y += bh + W * 0.04 * k;
    }
    // the dishes, by category; two columns when there is room. Lines are planned first: a heading always stays with its
    // first dish, the columns are balanced, and when not everything fits the last line says "+ N more dishes".
    const list = c.items.filter((x) => x.id !== c.special); const room = H - y - footH - M * 1.1; const minF = Math.round(W * 0.024);
    const groups = []; list.forEach((x) => { let gr = groups.find((q) => q.cat === x.category); if (!gr) groups.push((gr = { cat: x.category, items: [] })); gr.items.push(x); });
    const showCats = groups.length > 1;
    const entries = []; groups.forEach((gr) => { if (showCats) entries.push({ h: gr.cat }); gr.items.forEach((it) => entries.push({ it })); });
    const cols = W / H > 0.9 && entries.length > 7 ? 2 : 1;
    const plan = (fsz, cap) => {
      const slots = Math.max(1, Math.min(cap, Math.floor(room / (fsz * 1.75)))); const placed = []; let col = 0, n = 0, i = 0;
      for (; i < entries.length; i++) {
        const e = entries[i]; if (n >= slots || (e.h && n >= slots - 1)) { if (col + 1 < cols) { col++; n = 0; } else break; }
        placed.push({ e, col, n }); n++;
      }
      let more = entries.slice(i).filter((x) => x.it).length;
      if (more) { if (n >= slots) { const last = placed.pop(); if (last && last.e.it) more++; } while (placed.length && placed[placed.length - 1].e.h) placed.pop(); }
      const last = placed[placed.length - 1]; return { placed, more, endCol: last ? last.col : 0, endN: last ? last.n + 1 : 0 };
    };
    const balanced = Math.ceil((entries.length + (showCats ? 1 : 0)) / cols);
    let fsz = Math.round(W * 0.034), P = plan(fsz, balanced);
    while (P.more && fsz > minF) { fsz -= 1; P = plan(fsz, balanced); if (P.more) { const free = plan(fsz, Infinity); if (!free.more) P = free; } }
    if (P.more) P = plan(fsz, Infinity);
    const fits = !P.more; const lh = fsz * 1.75;
    const colW = (W - M * 2 - (cols - 1) * W * 0.05) / cols; const xOf = (col) => M + col * (colW + W * 0.05);
    P.placed.forEach(({ e, col, n }) => {
      const px = xOf(col), cy = y + n * lh; ctx.textAlign = 'left';
      if (e.h) { ctx.fillStyle = T.accent; ctx.font = '700 ' + Math.round(fsz * 0.72) + 'px ' + FONT; ctx.fillText(String(e.h || 'Menu').toUpperCase(), px, cy + fsz * 0.9); return; }
      const it = e.it; const pr = c.prices ? money(it.price) : ''; ctx.font = '700 ' + fsz + 'px ' + FONT; const pw = pr ? ctx.measureText(pr).width : 0;
      ctx.fillStyle = T.ink; ctx.font = '600 ' + fsz + 'px ' + FONT; const nm = clip(ctx, it.name, colW - pw - fsz * 1.2); ctx.fillText(nm, px, cy + fsz * 0.9);
      if (pr) { const nw = ctx.measureText(nm).width; ctx.fillStyle = T.line; for (let d = px + nw + fsz * 0.4; d < px + colW - pw - fsz * 0.4; d += fsz * 0.42) { ctx.beginPath(); ctx.arc(d, cy + fsz * 0.78, 1.8, 0, Math.PI * 2); ctx.fill(); }
        ctx.textAlign = 'right'; ctx.fillStyle = T.accent; ctx.font = '700 ' + fsz + 'px ' + FONT; ctx.fillText(pr, px + colW, cy + fsz * 0.9); }
    });
    if (P.more) { ctx.textAlign = 'left'; ctx.fillStyle = T.soft; ctx.font = 'italic 600 ' + fsz + 'px ' + FONT; ctx.fillText('+ ' + P.more + ' more dish' + (P.more === 1 ? '' : 'es') + ' — ask us', xOf(P.endCol), y + P.endN * lh + fsz * 0.9); }
    if (!list.length && !sp) { ctx.textAlign = 'center'; ctx.fillStyle = T.soft; ctx.font = '500 ' + Math.round(W * 0.03) + 'px ' + FONT; ctx.fillText('Choose today\'s dishes', W / 2, y + W * 0.08); }
    // contacts
    if (foot.length) { let fy = H - M * 0.95 - footH + W * 0.03; ctx.strokeStyle = T.line; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(M, fy - W * 0.015); ctx.lineTo(W - M, fy - W * 0.015); ctx.stroke();
      ctx.textAlign = 'center'; foot.forEach((t, i) => { ctx.fillStyle = i === 0 ? T.ink : T.soft; ctx.font = (i === 0 ? '700 ' : '500 ') + fs + 'px ' + FONT; ctx.fillText(clip(ctx, t, W - M * 2), W / 2, fy + fs * 1.1); fy += fs * 1.55; }); }
    return { fits };
  }

  /* ---------- the sheet ---------- */
  function open() {
    const s = S(); const pref = loadPrefs(); const menu = rMenu().filter((m) => m.active !== false && !m.soldOut);
    const food = menu.filter((m) => KC.stationOf(m, venue()) === 'kitchen');
    // dishes typed here for today's flyer only (kept until the day ends), next to the menu's own
    const extra = pref.extra && pref.extra.date === today() ? (pref.extra.items || []) : [];
    const all = () => menu.concat(c.extra);
    const catsNow = () => [...new Set((S().menuCats || []).concat(all().map((m) => m.category || 'Other')))].filter((ct) => all().some((m) => (m.category || 'Other') === ct));
    const c = { theme: pref.theme || 'green', size: pref.size || 'square', prices: pref.prices !== false, link: pref.link !== false && !!s.menuSlug, title: pref.title || "Today's menu",
      date: dateLine(), name: s.businessName || '', tagline: s.tagline || '', phone: s.phone || '', address: s.address || '', logo: s.logo || '',
      url: s.menuSlug ? location.host + '/m/' + s.menuSlug : '', pick: new Set((food.length ? food : menu).slice(0, 10).map((m) => m.id).concat(extra.map((x) => x.id))), special: '', extra: extra.slice() };
    c.items = [];
    const sh = openSheet({ title: 'Daily menu flyer', wide: true, body: '' }); sh.classList.add('fl-sheet');
    const sync = () => { const cats = catsNow(); c.items = all().filter((m) => c.pick.has(m.id)).sort((a, b) => cats.indexOf(a.category || 'Other') - cats.indexOf(b.category || 'Other')).map((m) => ({ id: m.id, name: m.name, price: m.extra ? num(m.price) : KC.menuPrice(m, S(), new Date(), false), category: m.category || 'Other' })); if (c.special && !c.pick.has(c.special)) c.special = ''; };
    const body = () => '<div class="fl"><div class="fl-prev"><canvas id="flCv" aria-label="Preview of the flyer"></canvas></div><div class="fl-ctl">' +
      '<div class="fl-sec"><div class="lbl-t">Style</div><div class="fl-themes">' + Object.entries(THEMES).map(([k, t]) => '<button type="button" class="fl-th' + (c.theme === k ? ' on' : '') + '" data-th="' + k + '" title="' + esc(t.name) + '" aria-label="' + esc(t.name) + '" style="background:linear-gradient(135deg,' + t.bg[0] + ',' + t.bg[1] + ');color:' + t.accent + '">Aa</button>').join('') + '</div>' +
        '<div class="fl-sizes">' + Object.entries(SIZES).map(([k, z]) => '<button type="button" class="fl-sz' + (c.size === k ? ' on' : '') + '" data-sz="' + k + '"><b>' + esc(z.name) + '</b><span>' + esc(z.hint) + '</span></button>').join('') + '</div></div>' +
      '<div class="fl-sec"><div class="grid2">' + field('Title', inp('flTitle', c.title)) + field('Date', inp('flDate', c.date)) + '</div></div>' +
      '<div class="fl-sec"><div class="row between"><div class="lbl-t" style="margin:0">Today\'s dishes · <span id="flN">' + c.pick.size + '</span></div><span class="row gap6"><button type="button" class="btn sm ghost" id="flAll">All</button><button type="button" class="btn sm ghost" id="flNone">None</button></span></div>' +
        '<div class="fl-items" id="flItems">' + itemsHtml() + '</div>' +
        '<div class="fl-add"><div class="lbl-t" style="margin:0 0 6px">Add a dish for today</div><div class="fl-add-r"><input class="inp" id="flXn" placeholder="e.g. Ndomba de poisson" maxlength="60" aria-label="Dish"><input class="inp" id="flXp" inputmode="numeric" placeholder="Price" aria-label="Price"><select class="inp" id="flXc" aria-label="Category">' + [...new Set((S().menuCats || []).concat(catsNow()).concat(['Other']))].map((ct) => '<option>' + esc(ct) + '</option>').join('') + '</select><button type="button" class="btn pri" id="flXadd">' + ic('plus', 'sm') + 'Add</button></div>' +
          (can('menu') ? '<label class="check fl-add-m"><input type="checkbox" id="flXmenu">Also add it to my menu</label>' : '') + '</div>' +
        field('Dish of the day (optional)', '<select class="inp" id="flSp"></select>') + '<label class="toggle"><input type="checkbox" id="flPr"' + (c.prices ? ' checked' : '') + '>Show prices</label></div>' +
      '<div class="fl-sec"><div class="lbl-t">Your details on the flyer</div><div class="grid2">' + field('Name', inp('flName', c.name)) + field('Tagline', inp('flTag', c.tagline, 'placeholder="e.g. Home cooking since 2010"')) + field('Phone / WhatsApp', inp('flPhone', c.phone, 'inputmode="tel"')) + field('Address', inp('flAddr', c.address, 'placeholder="e.g. Bonapriso, Douala"')) + '</div>' +
        (c.url ? '<label class="toggle"><input type="checkbox" id="flLink"' + (c.link ? ' checked' : '') + '>Show the menu link (' + esc(c.url) + ')</label>' : '') + (c.logo ? '' : '<div class="hint">Add your logo in Settings → Business to put it on the flyer.</div>') + '</div></div></div>';
    function itemsHtml() {
      const cats = catsNow(); if (!all().length) return '<div class="empty small">No dishes yet — add today\'s dishes below.</div>';
      return cats.map((ct) => '<div class="fl-cat">' + esc(ct) + '</div>' + all().filter((m) => (m.category || 'Other') === ct).map((m) => '<label class="fl-it"><input type="checkbox" data-it="' + esc(m.id) + '"' + (c.pick.has(m.id) ? ' checked' : '') + '><span class="grow">' + esc(m.name) + (m.extra ? ' <span class="fl-x">today only</span>' : '') + '</span><b class="money">' + fmt(m.price) + '</b>' + (m.extra ? '<button type="button" class="icon-btn" data-xrm="' + esc(m.id) + '" aria-label="Remove ' + esc(m.name) + '">' + ic('x', 'sm') + '</button>' : '') + '</label>').join('')).join('');
    }
    setSheetBody(sh, body());
    const foot = document.createElement('div'); foot.className = 'sf'; foot.innerHTML = '<button class="btn grow" data-a="sheetClose">Close</button>' + (navigator.canShare ? '<button class="btn grow" id="flShare">' + ic('wa', 'sm') + 'Share</button>' : '') + '<button class="btn pri grow" id="flDl">' + ic('dl', 'sm') + 'Download PNG</button>'; sh.querySelector('.sheet').appendChild(foot);
    const cv = $('#flCv', sh); let t;
    const spSel = () => { const el = $('#flSp', sh); el.innerHTML = '<option value="">None</option>' + c.items.map((x) => '<option value="' + esc(x.id) + '"' + (c.special === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join(''); };
    const redraw = () => { clearTimeout(t); t = setTimeout(() => draw(cv, c), 60); };
    const read = () => { c.title = $('[name=flTitle]', sh).value || "Today's menu"; c.date = $('[name=flDate]', sh).value; c.name = $('[name=flName]', sh).value; c.tagline = $('[name=flTag]', sh).value; c.phone = $('[name=flPhone]', sh).value; c.address = $('[name=flAddr]', sh).value; c.prices = $('#flPr', sh).checked; c.link = !!($('#flLink', sh) && $('#flLink', sh).checked); c.special = $('#flSp', sh).value; };
    sh.addEventListener('input', () => { read(); redraw(); });
    sh.addEventListener('change', (e) => { const it = e.target.dataset && e.target.dataset.it; if (it) { if (e.target.checked) c.pick.add(it); else c.pick.delete(it); sync(); spSel(); $('#flN', sh).textContent = c.pick.size; } read(); redraw(); });
    sh.addEventListener('click', (e) => {
      const th = e.target.closest('[data-th]'), sz = e.target.closest('[data-sz]');
      if (th) { c.theme = th.dataset.th; sh.querySelectorAll('[data-th]').forEach((b) => b.classList.toggle('on', b === th)); redraw(); }
      if (sz) { c.size = sz.dataset.sz; sh.querySelectorAll('[data-sz]').forEach((b) => b.classList.toggle('on', b === sz)); redraw(); }
    });
    const refreshItems = () => { $('#flItems', sh).innerHTML = itemsHtml(); sync(); spSel(); $('#flN', sh).textContent = c.pick.size; savePrefs(c); redraw(); };
    $('#flXadd', sh).onclick = async () => {
      const name = $('#flXn', sh).value.trim(), price = num($('#flXp', sh).value), category = $('#flXc', sh).value || 'Other';
      if (name.length < 2) { toast('Type the dish', true); return $('#flXn', sh).focus(); }
      if (!(price > 0)) { toast('Type the price', true); return $('#flXp', sh).focus(); }
      if (all().some((m) => m.name.trim().toLowerCase() === name.toLowerCase())) return toast(name + ' is already in the list — tick it', true);
      let id = 'fx_' + Date.now().toString(36);
      if ($('#flXmenu', sh) && $('#flXmenu', sh).checked) { // a real menu item: on the menu link and orderable too
        const m = { id: uid('mn_'), name, price, category, kind: 'plain', uses: [], active: true };
        if (!(await save('menu', m))) return; menu.push(m); id = m.id; toast(name + ' added to your menu');
      } else c.extra.push({ id, name, price, category, extra: true });
      c.pick.add(id); $('#flXn', sh).value = ''; $('#flXp', sh).value = ''; refreshItems(); $('#flXn', sh).focus();
    };
    $('#flXn', sh).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#flXp', sh).focus(); } });
    $('#flXp', sh).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#flXadd', sh).click(); } });
    sh.addEventListener('click', (e) => { const rm = e.target.closest('[data-xrm]'); if (!rm) return; e.preventDefault(); c.extra = c.extra.filter((x) => x.id !== rm.dataset.xrm); c.pick.delete(rm.dataset.xrm); refreshItems(); });
    $('#flAll', sh).onclick = () => { all().forEach((m) => c.pick.add(m.id)); sh.querySelectorAll('[data-it]').forEach((x) => (x.checked = true)); sync(); spSel(); $('#flN', sh).textContent = c.pick.size; redraw(); };
    $('#flNone', sh).onclick = () => { c.pick.clear(); sh.querySelectorAll('[data-it]').forEach((x) => (x.checked = false)); sync(); spSel(); $('#flN', sh).textContent = 0; redraw(); };
    const blob = async () => { read(); await draw(cv, c); savePrefs(c); return new Promise((ok) => cv.toBlob(ok, 'image/png')); };
    const fname = () => 'Menu-' + (c.name || 'today').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') + '-' + ((KC.venueClock(S()) || {}).date || todayStr()) + '.png';
    $('#flDl', foot).onclick = async () => { const b = await blob(); if (!b) return toast('Could not make the image', true); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = fname(); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Flyer saved — ' + fname()); };
    if ($('#flShare', foot)) $('#flShare', foot).onclick = async () => { const b = await blob(); const f = new File([b], fname(), { type: 'image/png' }); if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: c.title, text: c.title + ' — ' + c.name }); } catch (e) { } } else toast('This phone cannot share images — use Download', true); };
    sync(); spSel(); draw(cv, c);
  }
  return { open, draw, THEMES, SIZES };
})();
A.flyer = () => Flyer.open();
