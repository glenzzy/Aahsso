/* Aahsso Bar & Resto — the menu flyer studio: today's dishes on a designed flyer (templates, colour palettes, font
 * pairings, photos, stickers, phone numbers / WhatsApp, address, hours, socials and a QR code to the menu), drawn on a
 * canvas and saved as a PNG or shared. Mobile first: the flyer on top, the tools underneath; tap any part of the flyer to
 * edit it. Undo / redo. Nothing leaves the phone (the business's phone numbers and hours are kept in its settings). */
const Flyer = (() => {
  /* ---------- design library ---------- */
  const SIZES = {
    square: { name: 'Square', hint: 'WhatsApp, Instagram, Facebook', w: 1080, h: 1080 },
    portrait: { name: 'Portrait', hint: 'Instagram & Facebook feed', w: 1080, h: 1350 },
    story: { name: 'Status', hint: 'WhatsApp status, stories', w: 1080, h: 1920 },
    a4: { name: 'A4 poster', hint: 'Print and put up', w: 1240, h: 1754, x: 2 },
    tv: { name: 'TV screen', hint: 'Show on a screen', w: 1920, h: 1080 },
  };
  const PALETTES = {
    green: { name: 'Ndolè green', bg: '#0f3d2e', bg2: '#14533e', ink: '#fdf8ec', accent: '#e9b949', onAccent: '#0f3d2e', surface: '#174a39', surfInk: '#fdf8ec' },
    red: { name: 'Pepper red', bg: '#7a1d12', bg2: '#a3291a', ink: '#fff6ea', accent: '#ffcf70', onAccent: '#5a140c', surface: '#8c2416', surfInk: '#fff6ea' },
    tomato: { name: 'Tomato', bg: '#fff7ee', bg2: '#fdebd8', ink: '#2a1410', accent: '#c0392b', onAccent: '#ffffff', surface: '#ffffff', surfInk: '#2a1410' },
    cream: { name: 'Ivory & gold', bg: '#fbf6ea', bg2: '#f1e7cf', ink: '#2b2418', accent: '#a8802f', onAccent: '#fbf6ea', surface: '#fffdf6', surfInk: '#2b2418' },
    night: { name: 'Night', bg: '#111b2b', bg2: '#1c2c44', ink: '#f4f1ea', accent: '#f0a73a', onAccent: '#111b2b', surface: '#ffffff', surfInk: '#152033' },
    chalk: { name: 'Chalkboard', bg: '#2c3833', bg2: '#1d2522', ink: '#f2f0e6', accent: '#f6d365', onAccent: '#26302c', surface: '#33403a', surfInk: '#f2f0e6' },
    sunshine: { name: 'Street yellow', bg: '#ffd23f', bg2: '#ffc21a', ink: '#1a1a1a', accent: '#e63946', onAccent: '#ffffff', surface: '#fff6d6', surfInk: '#1a1a1a' },
    ocean: { name: 'Ocean', bg: '#f4f8fb', bg2: '#e3eef6', ink: '#0d2a3f', accent: '#0e6ba8', onAccent: '#ffffff', surface: '#ffffff', surfInk: '#0d2a3f' },
    plantain: { name: 'Plantain', bg: '#3b2314', bg2: '#4e2f1b', ink: '#fff3e0', accent: '#ff9f1c', onAccent: '#3b2314', surface: '#4a2c19', surfInk: '#fff3e0' },
    rose: { name: 'Hibiscus', bg: '#fff1f2', bg2: '#ffe4e6', ink: '#4c0519', accent: '#be123c', onAccent: '#ffffff', surface: '#ffffff', surfInk: '#4c0519' },
    fresh: { name: 'Fresh mint', bg: '#fffdf7', bg2: '#f1ece0', ink: '#1d2a26', accent: '#0f766e', onAccent: '#ffffff', surface: '#ffffff', surfInk: '#1d2a26' },
    royal: { name: 'Royal', bg: '#1e1b4b', bg2: '#312e81', ink: '#eef2ff', accent: '#fbbf24', onAccent: '#1e1b4b', surface: '#2a2766', surfInk: '#eef2ff' },
    mono: { name: 'Clean white', bg: '#ffffff', bg2: '#f4f4f2', ink: '#18181b', accent: '#e8590c', onAccent: '#ffffff', surface: '#f4f4f5', surfInk: '#18181b' },
    kente: { name: 'Kente', bg: '#fffaf0', bg2: '#f6ecd6', ink: '#1a1a1a', accent: '#b5121b', onAccent: '#ffffff', surface: '#ffffff', surfInk: '#1a1a1a' },
    neon: { name: 'Neon night', bg: '#0b0b1a', bg2: '#1a0b2e', ink: '#f5f3ff', accent: '#ff3ea5', onAccent: '#0b0b1a', surface: '#16162b', surfInk: '#f5f3ff' },
    retro: { name: 'Retro', bg: '#f6e7c8', bg2: '#efd9ad', ink: '#2b1d14', accent: '#d9480f', onAccent: '#ffffff', surface: '#fff4dc', surfInk: '#2b1d14' },
    tropic: { name: 'Tropical', bg: '#f3fbf4', bg2: '#ddf1e1', ink: '#123524', accent: '#e76f51', onAccent: '#ffffff', surface: '#ffffff', surfInk: '#123524' },
    paper: { name: 'Paper', bg: '#d9d2c5', bg2: '#c9c0b0', ink: '#222222', accent: '#b3261e', onAccent: '#ffffff', surface: '#fffdf7', surfInk: '#222222' },
  };
  const FONTS = {
    modern: { name: 'Modern', head: 'Plus Jakarta Sans', hw: 800, body: 'Plus Jakarta Sans', bw: [500, 700] },
    classic: { name: 'Classic', head: 'DM Serif Display', hw: 400, body: 'DM Sans', bw: [500, 700] },
    elegant: { name: 'Elegant', head: 'Playfair Display', hw: 700, hs: 'italic', body: 'Lato', bw: [400, 700] },
    bold: { name: 'Bold', head: 'Bebas Neue', hw: 400, body: 'Poppins', bw: [500, 700], caps: true },
    strong: { name: 'Strong', head: 'Oswald', hw: 700, body: 'Poppins', bw: [500, 700], caps: true },
    chalk: { name: 'Chalk', head: 'Caveat', hw: 700, body: 'Patrick Hand', bw: [400, 400] },
    fun: { name: 'Fun', head: 'Pacifico', hw: 400, body: 'Poppins', bw: [500, 700] },
    script: { name: 'Script', head: 'Great Vibes', hw: 400, body: 'Lato', bw: [400, 700] },
    retro: { name: 'Retro', head: 'Abril Fatface', hw: 400, body: 'Poppins', bw: [500, 700] },
    mono: { name: 'Typewriter', head: 'Space Mono', hw: 700, body: 'Space Mono', bw: [400, 700], caps: true },
    neon: { name: 'Neon', head: 'Righteous', hw: 400, body: 'Poppins', bw: [500, 700] },
  };
  const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Abril+Fatface&family=Bebas+Neue&family=Caveat:wght@700&family=DM+Sans:wght@500;700&family=DM+Serif+Display&family=Great+Vibes&family=Lato:wght@400;700&family=Oswald:wght@700&family=Pacifico&family=Patrick+Hand&family=Playfair+Display:ital,wght@1,700&family=Poppins:wght@500;700&family=Righteous&family=Space+Mono:wght@400;700&display=swap';
  const BGS = [['gradient', 'Gradient'], ['solid', 'Plain'], ['dots', 'Dots'], ['stripes', 'Stripes'], ['waves', 'Waves'], ['grain', 'Grain']];
  const BADGES = { delivery: ['truck', 'Delivery available'], takeaway: ['bag', 'Takeaway'], newd: ['star', 'New dishes'], open: ['clock', 'Open every day'] };
  const TITLES = ["Today's menu", 'Menu du jour', 'Plat du jour', 'Lunch menu', 'Weekend specials', 'Our menu'];
  const QR_JS = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

  /* ---------- colour and drawing helpers ---------- */
  const hexRgb = (h) => { h = String(h || '#000000').replace('#', ''); if (h.length === 3) h = h.split('').map((x) => x + x).join(''); const n = parseInt(h, 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; };
  const mix = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const lum = (h) => { const [r, g, b] = hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const onColor = (h) => (lum(h) > 0.42 ? '#1a1a1a' : '#ffffff');
  function pal(c) {
    const P = Object.assign({}, PALETTES[c.palette] || PALETTES.green); const u = c.custom || {};
    if (u.bg) { P.bg = u.bg; P.bg2 = mix(u.bg, lum(u.bg) > 0.5 ? '#000000' : '#ffffff', 0.07); P.surface = lum(u.bg) > 0.5 ? '#ffffff' : mix(u.bg, '#ffffff', 0.09); }
    if (u.ink) P.ink = u.ink;
    if (u.accent) { P.accent = u.accent; P.onAccent = onColor(u.accent); }
    if (u.bg || u.ink) P.surfInk = lum(P.surface) > 0.5 ? (lum(P.ink) < 0.4 ? P.ink : '#1a1a1a') : (lum(P.ink) > 0.4 ? P.ink : '#ffffff');
    P.soft = rgba(P.ink, 0.74); P.line = rgba(P.accent, 0.55); P.faint = rgba(P.ink, 0.14);
    return P;
  }
  const fam = (f, fb) => '"' + f + '", ' + fb;
  const hf = (F, s) => (F.hs ? F.hs + ' ' : '') + F.hw + ' ' + Math.round(s) + 'px ' + fam(F.head, 'Georgia, serif');
  const bf = (F, s, bold) => (bold ? F.bw[1] : F.bw[0]) + ' ' + Math.round(s) + 'px ' + fam(F.body, 'system-ui, sans-serif');
  const money = (n) => fmt(n) + ' F';
  const rnd = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  function rr(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function rrTop(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h); ctx.closePath(); }
  function fit(ctx, text, max, size, font) { let s = size; do { ctx.font = font(s); if (ctx.measureText(text).width <= max) break; s -= 2; } while (s > 14); return s; }
  function clip(ctx, text, max) { text = String(text || ''); if (ctx.measureText(text).width <= max) return text; let t = text; while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; }
  function tracked(ctx, t, x, y, px) { if ('letterSpacing' in ctx) { const o = ctx.letterSpacing; ctx.letterSpacing = px + 'px'; const a = ctx.textAlign; if (a === 'center') x += px / 2; ctx.fillText(t, x, y); ctx.letterSpacing = o; } else ctx.fillText(px > 1 ? t.split('').join(String.fromCharCode(8202)) : t, x, y); }
  function cover(ctx, img, x, y, w, h) { const r = Math.max(w / img.width, h / img.height); const sw = w / r, sh = h / r; ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h); }
  function hline(ctx, x1, y, x2, color, lw) { ctx.strokeStyle = color; ctx.lineWidth = lw || 1.5; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); }
  function diamond(ctx, x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); }
  const ICON = {
    phone: 'M6.6 3h3l1.6 4.4-2 1.3a11.5 11.5 0 006.1 6.1l1.3-2 4.4 1.6v3a2 2 0 01-2.2 2A17.5 17.5 0 014.6 5.2 2 2 0 016.6 3z',
    wa: 'M3 21l1.6-4.7A8.5 8.5 0 1120.5 12 8.5 8.5 0 018 19.6L3 21z M9 9.5c.3 2 2.5 4.2 4.5 4.5l1.2-1.2 1.8.8c-.2 1-1 1.7-2 1.7-3 0-6.5-3.5-6.5-6.5 0-1 .7-1.8 1.7-2l.8 1.8L9 9.5z',
    pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z M12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
    clock: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 7.5V12l3 2',
    ig: 'M7.5 3h9A4.5 4.5 0 0121 7.5v9a4.5 4.5 0 01-4.5 4.5h-9A4.5 4.5 0 013 16.5v-9A4.5 4.5 0 017.5 3z M12 8.2a3.8 3.8 0 100 7.6 3.8 3.8 0 000-7.6z M17.2 6.6v.1',
    fb: 'M14.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4a21 21 0 00-2.4-.1c-2.4 0-4 1.4-4 4.1v2.1H8.6v3h2.7V21',
    link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
    truck: 'M2.5 6.5h11v9h-11z M13.5 9.5h4l3 3v3h-7z M6.5 18.5a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2z M17 18.5a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2z',
    bag: 'M5 8h14l-1 12H6L5 8z M9 8V6.5a3 3 0 016 0V8',
  };
  function icon(ctx, n, x, y, s, color) { ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24); ctx.strokeStyle = color; ctx.lineWidth = 2.1; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(new Path2D(ICON[n] || ICON.star)); ctx.restore(); }
  const hit = (D, x, y, w, h, tab, field) => D.hits.push({ x, y, w, h, tab, field });

  /* ---------- building blocks shared by the templates ---------- */
  function txt(D, t, x, y, maxW, font, size, color, o = {}) { // one line of text, shrunk to fit; returns the y under it
    if (!t) return y; const { ctx } = D; const s = fit(ctx, t, maxW, size, font); ctx.fillStyle = color; ctx.textAlign = o.align || 'center';
    const tt = clip(ctx, t, maxW); if (o.track) tracked(ctx, tt, x, y + s * 0.85, o.track * s); else ctx.fillText(tt, x, y + s * 0.85);
    if (o.hit) { const w = Math.min(maxW, ctx.measureText(tt).width); const hx = ctx.textAlign === 'center' ? x - w / 2 : ctx.textAlign === 'right' ? x - w : x; hit(D, hx - 12, y - 4, w + 24, s * 1.15, o.hit[0], o.hit[1]); }
    return y + s * (o.lh || 1.15);
  }
  function wrapLines(ctx, t, maxW) { const L = []; let cur = ''; String(t).split(/\s+/).filter(Boolean).forEach((w) => { const nx = cur ? cur + ' ' + w : w; if (!cur || ctx.measureText(nx).width <= maxW) cur = nx; else { L.push(cur); cur = w; } }); if (cur) L.push(cur); return L; }
  function titleFit(D, t, maxW, size, lines) { // the title's size and lines: as big as possible within `lines` lines
    const { ctx, F } = D; t = F.caps ? String(t).toUpperCase() : String(t); let s = Math.round(size), L;
    for (;;) { ctx.font = hf(F, s); L = wrapLines(ctx, t, maxW); if ((L.length <= lines && L.every((l) => ctx.measureText(l).width <= maxW)) || s <= 18) break; s -= 2; }
    return { s, L: L.slice(0, lines) };
  }
  function title(D, t, x, y, maxW, size, color, o = {}) {
    const { ctx, F } = D; const f = titleFit(D, t, maxW, size, o.lines || 1); const lh = f.s * (o.lh || 1.02);
    ctx.font = hf(F, f.s); ctx.fillStyle = color; ctx.textAlign = o.align || 'center';
    f.L.forEach((l, i) => ctx.fillText(clip(ctx, l, maxW), x, y + f.s * 0.84 + i * lh));
    hit(D, o.align === 'left' ? x : x - maxW / 2, y, maxW, f.L.length * lh, 'text', 'title');
    return y + f.L.length * lh + f.s * 0.12;
  }
  function logo(D, cx, cy, r, ring, fill) {
    const { ctx, c, A, F } = D; if (c.showLogo === false) return false; const bg = fill || D.P.accent;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = bg; ctx.fill();
    if (A.logo) { ctx.clip(); cover(ctx, A.logo, cx - r, cy - r, r * 2, r * 2); }
    else { ctx.fillStyle = onColor(bg); ctx.font = '700 ' + Math.round(r * 0.78) + 'px ' + fam(F.body, 'system-ui, sans-serif'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(initials(c.name || 'A').slice(0, 2), cx, cy + r * 0.04); }
    ctx.restore();
    if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = Math.max(2, r * 0.07); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
    hit(D, cx - r, cy - r, r * 2, r * 2, 'photos'); return true;
  }
  function pattern(D, style, color, x, y, w, h) {
    const { ctx, U } = D; ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (style === 'dots') { ctx.fillStyle = rgba(color, 0.13); const s = U * 0.036; let row = 0; for (let yy = y + s / 2; yy < y + h; yy += s, row++) for (let xx = x + s / 2 + (row % 2 ? s / 2 : 0); xx < x + w; xx += s) { ctx.beginPath(); ctx.arc(xx, yy, U * 0.0042, 0, Math.PI * 2); ctx.fill(); } }
    else if (style === 'stripes') { ctx.strokeStyle = rgba(color, 0.08); ctx.lineWidth = U * 0.012; const s = U * 0.05; for (let d = -h; d < w + h; d += s) { ctx.beginPath(); ctx.moveTo(x + d, y); ctx.lineTo(x + d + h, y + h); ctx.stroke(); } }
    else if (style === 'grain') { const R = rnd(7); ctx.fillStyle = rgba(color, 0.07); for (let i = 0, n = (w * h) / 260; i < n; i++) ctx.fillRect(x + R() * w, y + R() * h, 1.7, 1.7); }
    else if (style === 'waves') { ctx.strokeStyle = rgba(color, 0.16); ctx.lineWidth = U * 0.004; [[y + h * 0.02, 1], [y + h - U * 0.26, -1]].forEach(([y0, dir]) => { for (let i = 0; i < 9; i++) { const yy = y0 + i * U * 0.028; ctx.beginPath(); for (let xx = x; xx <= x + w + 8; xx += 8) { const v = yy + Math.sin(xx / (U * 0.06) + i * 0.5 * dir) * U * 0.012; if (xx === x) ctx.moveTo(xx, v); else ctx.lineTo(xx, v); } ctx.stroke(); } }); }
    else if (style === 'gradient') { ctx.globalAlpha = 0.1; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + w * 0.95, y + h * 0.04, U * 0.34, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(x + w * 0.03, y + h * 0.97, U * 0.3, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function bgFill(D, style) {
    const { ctx, W, H, P, c, A } = D; style = style || c.bgStyle || 'gradient';
    if (style === 'solid') { ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H); }
    else { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, P.bg); g.addColorStop(1, P.bg2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    pattern(D, style, style === 'grain' || style === 'stripes' ? P.ink : P.accent, 0, 0, W, H);
    if (A.bg) { cover(ctx, A.bg, 0, 0, W, H); ctx.fillStyle = rgba(P.bg, c.overlay == null ? 0.6 : c.overlay); ctx.fillRect(0, 0, W, H); }
  }
  function ornament(D, cx, y, half, line, dot, kind) { const { ctx, U } = D; hline(ctx, cx - half, y, cx - U * 0.02, line, 2); hline(ctx, cx + U * 0.02, y, cx + half, line, 2); if (kind === 'diamond') diamond(ctx, cx, y, U * 0.009, dot); else { ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(cx, y, U * 0.006, 0, Math.PI * 2); ctx.fill(); } }
  function badgeList(c) { const l = Object.keys(BADGES).filter((k) => (c.badges || []).includes(k)).map((k) => ({ ic: BADGES[k][0], t: BADGES[k][1] })); if ((c.badgeText || '').trim()) l.push({ ic: 'star', t: c.badgeText.trim() }); return l; }
  /** the stickers ("Delivery available"…) as pills; returns their height */
  function badges(D, x, y, w, o = {}, dry) {
    const l = badgeList(D.c); if (!l.length) return 0; const { ctx, F, U, P } = D; const fs = U * 0.021, ph = fs * 2.05, padX = fs * 0.95, gap = fs * 0.6;
    ctx.font = bf(F, fs, true); const items = l.map((b) => ({ b, w: padX * 2 + fs * 1.4 + ctx.measureText(b.t).width }));
    const rows = [[]]; let rw = 0; items.forEach((it) => { if (rows[rows.length - 1].length && rw + gap + it.w > w) { rows.push([]); rw = 0; } rw += (rows[rows.length - 1].length ? gap : 0) + it.w; rows[rows.length - 1].push(it); });
    const h = rows.length * ph + (rows.length - 1) * gap; if (dry) return h;
    rows.forEach((r, i) => {
      const tw = r.reduce((a, it) => a + it.w, 0) + gap * (r.length - 1); let px = o.align === 'left' ? x : x + (w - tw) / 2; const py = y + i * (ph + gap);
      r.forEach((it) => { ctx.fillStyle = o.bg || P.accent; rr(ctx, px, py, it.w, ph, ph / 2); ctx.fill(); icon(ctx, it.b.ic, px + padX * 0.8, py + (ph - fs * 1.15) / 2, fs * 1.15, o.fg || P.onAccent); ctx.fillStyle = o.fg || P.onAccent; ctx.font = bf(F, fs, true); ctx.textAlign = 'left'; ctx.fillText(it.b.t, px + padX * 0.8 + fs * 1.45, py + ph / 2 + fs * 0.36); px += it.w + gap; });
    });
    hit(D, x, y, w, h, 'extras'); return h;
  }
  /** the dish of the day; returns its height */
  function special(D, x, y, w, o = {}, dry) {
    const { ctx, c, P, F, U, k, A } = D; const sp = c.items.find((it) => it.id === c.special); if (!sp) return 0;
    const ink = o.ink || P.ink, acc = o.accent || P.accent, pr = c.prices ? money(sp.price) : '';
    if (o.center) { // elegant: stacked and centred
      const q = Math.max(0.65, k), h = U * (pr ? 0.18 : 0.13) * q; if (dry) return h; const cx = x + w / 2;
      ctx.fillStyle = acc; ctx.textAlign = 'center'; ctx.font = bf(F, U * 0.019 * q, true); tracked(ctx, '✦  ' + (o.label || "CHEF'S SPECIAL") + '  ✦', cx, y + U * 0.026 * q, U * 0.005);
      txt(D, sp.name, cx, y + U * 0.04 * q, w * 0.9, (s) => hf(F, s), U * 0.058 * q, ink, {});
      if (pr) { ctx.fillStyle = acc; ctx.font = bf(F, U * 0.032 * q, true); ctx.textAlign = 'center'; ctx.fillText(pr, cx, y + h - U * 0.012 * q); }
      hit(D, x, y, w, h, 'dishes', 'special'); return h;
    }
    const q = Math.max(0.6, k), bh = U * 0.15 * q; if (dry) return bh;
    ctx.fillStyle = o.bg || rgba(P.ink, 0.07); rr(ctx, x, y, w, bh, U * 0.024); ctx.fill();
    if (o.stroke !== false) { ctx.save(); if (o.dash) ctx.setLineDash([U * 0.014, U * 0.01]); ctx.strokeStyle = o.line || P.line; ctx.lineWidth = 2.5; ctx.stroke(); ctx.restore(); }
    let tx = x + U * 0.035;
    if (A.photo && o.photo !== false) { const s = bh - U * 0.03; ctx.save(); rr(ctx, x + U * 0.015, y + U * 0.015, s, s, U * 0.018); ctx.clip(); cover(ctx, A.photo, x + U * 0.015, y + U * 0.015, s, s); ctx.restore(); tx = x + U * 0.015 + s + U * 0.03; }
    const ns = U * 0.046 * q; ctx.font = bf(F, ns, true); const pw = pr ? ctx.measureText(pr).width + U * 0.05 : 0;
    ctx.textAlign = 'left'; ctx.fillStyle = acc; ctx.font = bf(F, U * 0.02 * q, true); tracked(ctx, '★  ' + (o.label || 'DISH OF THE DAY'), tx, y + bh * 0.38, U * 0.003);
    ctx.fillStyle = ink; const room = x + w - tx - pw - U * 0.02; fit(ctx, sp.name, room, ns, (s) => bf(F, s, true)); ctx.fillText(clip(ctx, sp.name, room), tx, y + bh * 0.77);
    if (pr) { ctx.textAlign = 'right'; ctx.fillStyle = acc; ctx.font = bf(F, ns, true); ctx.fillText(pr, x + w - U * 0.035, y + bh * 0.66); }
    hit(D, x, y, w, bh, 'dishes', 'special'); return bh;
  }
  /** the dishes by category; one, two or three columns. Planned first: a heading always stays with its first dish, the
   *  columns are balanced, and when not everything fits the last line says "+ N more dishes". */
  function menuList(D, R, o = {}) {
    const { ctx, c, P, F, U } = D; const ink = o.ink || P.ink, acc = o.accent || P.accent, soft = o.soft || rgba(ink, 0.7), style = o.style || 'leader';
    const list = c.items.filter((x) => x.id !== c.special); hit(D, R.x, R.y, R.w, Math.max(0, R.h), 'dishes');
    if (!list.length) { if (!c.items.length) { ctx.textAlign = 'center'; ctx.fillStyle = soft; ctx.font = bf(F, U * 0.03); ctx.fillText("Choose today's dishes", R.x + R.w / 2, R.y + U * 0.08); } return { fits: true }; }
    const groups = []; list.forEach((x) => { let g = groups.find((q) => q.cat === x.category); if (!g) groups.push((g = { cat: x.category, items: [] })); g.items.push(x); });
    const showCats = c.cats !== false && groups.length > 1;
    const entries = []; groups.forEach((g) => { if (showCats) entries.push({ h: g.cat }); g.items.forEach((it) => entries.push({ it })); });
    const lhK = style === 'card' ? 2.1 : style === 'center' ? 1.9 : 1.75, gap = U * 0.05, minF = Math.round(U * 0.023);
    const solve = (cols) => { // the biggest dish text with which everything fits in `cols` columns
      const plan = (fsz, cap) => {
        const slots = Math.max(1, Math.min(cap, Math.floor(R.h / (fsz * lhK)))); const placed = []; let col = 0, n = 0, i = 0;
        for (; i < entries.length; i++) { const e = entries[i]; if (n >= slots || (e.h && n >= slots - 1)) { if (col + 1 < cols) { col++; n = 0; } else break; } placed.push({ e, col, n }); n++; }
        let more = entries.slice(i).filter((x) => x.it).length;
        if (more) { if (n >= slots) { const last = placed.pop(); if (last && last.e.it) more++; } while (placed.length && placed[placed.length - 1].e.h) placed.pop(); }
        const last = placed[placed.length - 1]; return { placed, more, endCol: last ? last.col : 0, endN: last ? last.n + 1 : 0 };
      };
      const balanced = Math.ceil((entries.length + (showCats ? 1 : 0)) / cols);
      let fsz = Math.round(o.fsz || U * 0.04), Pn = plan(fsz, balanced);
      while (Pn.more && fsz > minF) { fsz -= 1; Pn = plan(fsz, balanced); if (Pn.more) { const free = plan(fsz, Infinity); if (!free.more) Pn = free; } }
      if (Pn.more) Pn = plan(fsz, Infinity);
      const cw = (R.w - (cols - 1) * gap) / cols;
      const cut = (z, P) => P.placed.filter(({ e }) => { if (!e.it) return false; ctx.font = bf(F, z, true); const pw = c.prices ? ctx.measureText(money(e.it.price)).width + (style === 'pill' ? z * 1.1 : 0) : 0; ctx.font = bf(F, z, style !== 'plain' && style !== 'center'); return ctx.measureText(e.it.name).width + pw + z * 1.2 > cw; }).length;
      let trunc = cut(fsz, Pn);
      while (trunc && !Pn.more && fsz > minF) { const z = fsz - 1, P2 = plan(z, balanced).more ? plan(z, Infinity) : plan(z, balanced); if (P2.more) break; fsz = z; Pn = P2; trunc = cut(fsz, Pn); } // a little smaller rather than cut-off names
      return { cols, fsz, Pn, trunc, shown: Pn.placed.filter((p) => p.e.it).length };
    };
    const opts = (o.cols ? [o.cols] : [1, 2, 3].filter((n) => n === 1 || (R.w / n >= U * 0.36 && entries.length > 5))).map(solve);
    const sc = (x) => (x.Pn.more ? 0 : 1e6) + x.shown * 1000 + x.fsz - x.trunc * 3; // everything in, then more dishes, then big text without cut-off names
    const best = opts.reduce((a, b) => (sc(b) > sc(a) ? b : a));
    const { cols, fsz, Pn } = best; const colW = (R.w - (cols - 1) * gap) / cols;
    const rowsUsed = Math.max(1, ...Pn.placed.map((p) => p.n + 1), Pn.more ? Pn.endN + 1 : 0);
    const lh = Pn.more ? fsz * lhK : Math.min(fsz * lhK * 1.45, Math.max(fsz * lhK, R.h / rowsUsed)); const xOf = (col) => R.x + col * (colW + gap);
    let nI = 0; Pn.placed.forEach(({ e, col, n }) => {
      const px = xOf(col), cy = R.y + n * lh, base = cy + lh / 2 + fsz * 0.36, center = style === 'center';
      if (e.h) {
        const t = String(e.h || 'Menu'); ctx.fillStyle = o.catColor || acc;
        if (o.cat === 'head') { ctx.font = hf(F, fsz * 1.12); ctx.textAlign = center ? 'center' : 'left'; ctx.fillText(clip(ctx, F.caps ? t.toUpperCase() : t, colW), center ? px + colW / 2 : px, base); }
        else { ctx.font = bf(F, fsz * 0.72, true); ctx.textAlign = center ? 'center' : 'left'; tracked(ctx, clip(ctx, t.toUpperCase(), colW * 0.8), center ? px + colW / 2 : px, base, fsz * 0.1); }
        if (o.catRule && !center) { const tw = ctx.measureText(t.toUpperCase()).width + fsz * 0.8; hline(ctx, px + tw + fsz * 0.4, base - fsz * 0.25, px + colW, rgba(ink, 0.18), 1.5); }
        return;
      }
      const it = e.it; const pr = c.prices ? money(it.price) : '';
      if (center) {
        ctx.font = bf(F, fsz, true); const pw = pr ? ctx.measureText('   ' + pr).width : 0; ctx.font = bf(F, fsz); const nm = clip(ctx, it.name, colW - pw); const nw = ctx.measureText(nm).width;
        let sx = px + (colW - nw - pw) / 2; ctx.textAlign = 'left'; ctx.fillStyle = ink; ctx.fillText(nm, sx, base);
        if (pr) { ctx.fillStyle = acc; ctx.font = bf(F, fsz, true); ctx.fillText('   ' + pr, sx + nw, base); }
        return;
      }
      ctx.font = bf(F, fsz, true); const tw = pr ? ctx.measureText(pr).width : 0; const pw = style === 'pill' && pr ? tw + fsz * 1.1 : tw;
      if (style === 'card') { ctx.fillStyle = o.cardBg || rgba(ink, 0.06); rr(ctx, px, cy + lh * 0.08, colW, lh * 0.84, fsz * 0.45); ctx.fill(); }
      const pad = style === 'card' ? fsz * 0.7 : 0;
      const nx = px + pad + (o.num ? fsz * 1.75 : 0); ctx.textAlign = 'left';
      if (o.num) { ctx.fillStyle = acc; ctx.font = bf(F, fsz * 0.72, true); ctx.fillText(String(++nI).padStart(2, '0'), px + pad, base); }
      ctx.fillStyle = ink; ctx.font = bf(F, fsz, style !== 'plain'); const nm = clip(ctx, it.name, colW - pw - fsz * 1.2 - pad * 2 - (nx - px - pad)); ctx.fillText(nm, nx, base);
      if (!pr) return;
      if (style === 'leader') { const nw = ctx.measureText(nm).width; ctx.fillStyle = o.leader || P.line; for (let d = nx + nw + fsz * 0.45; d < px + colW - pw - fsz * 0.4; d += fsz * 0.42) { ctx.beginPath(); ctx.arc(d, base - fsz * 0.12, Math.max(1.6, fsz * 0.05), 0, Math.PI * 2); ctx.fill(); } }
      if (style === 'plain') hline(ctx, px, cy + lh - 2, px + colW, rgba(ink, 0.1), 1.2);
      if (style === 'pill') { const ph = fsz * 1.55; ctx.fillStyle = o.pillBg || acc; rr(ctx, px + colW - pw, base - fsz * 0.36 - ph / 2, pw, ph, ph / 2); ctx.fill(); ctx.fillStyle = o.pillInk || P.onAccent; ctx.font = bf(F, fsz * 0.92, true); ctx.textAlign = 'center'; ctx.fillText(pr, px + colW - pw / 2, base - fsz * 0.05); return; }
      ctx.textAlign = 'right'; ctx.fillStyle = acc; ctx.font = bf(F, fsz, true); ctx.fillText(pr, px + colW - pad, base);
    });
    if (Pn.more) { ctx.textAlign = 'left'; ctx.fillStyle = soft; ctx.font = 'italic ' + bf(F, fsz); ctx.fillText('+ ' + Pn.more + ' more dish' + (Pn.more === 1 ? '' : 'es') + ' — ask us', xOf(Pn.endCol), R.y + Pn.endN * lh + lh / 2 + fsz * 0.36); }
    return { fits: !Pn.more, fsz, shown: best.shown, more: Pn.more };
  }
  function contactItems(c) {
    const ph = (c.phones || []).filter((p) => p && String(p.n || '').trim()).map((p) => ({ ic: p.t === 'wa' ? ['wa'] : p.t === 'call' ? ['phone'] : ['phone', 'wa'], t: String(p.n).trim() }));
    const rest = [];
    if (c.address) rest.push({ ic: ['pin'], t: c.address });
    if (c.hours) rest.push({ ic: ['clock'], t: c.hours });
    if (c.ig) rest.push({ ic: ['ig'], t: '@' + String(c.ig).replace(/^@/, '') });
    if (c.fb) rest.push({ ic: ['fb'], t: c.fb });
    if (c.link && c.url && !c.qr) rest.push({ ic: ['link'], t: c.urlShort });
    return { ph, rest };
  }
  function drawQR(ctx, q, x, y, s) { const n = q.getModuleCount(), pad = s * 0.07, cell = (s - pad * 2) / n; ctx.fillStyle = '#ffffff'; rr(ctx, x, y, s, s, s * 0.07); ctx.fill(); ctx.fillStyle = '#111111'; for (let r = 0; r < n; r++) for (let cc = 0; cc < n; cc++) if (q.isDark(r, cc)) ctx.fillRect(x + pad + cc * cell, y + pad + r * cell, cell + 0.6, cell + 0.6); }
  /** phones (with call / WhatsApp icons), address, hours, socials, the note and the QR code; returns the height */
  function footer(D, x, y, w, o = {}, dry) {
    const { ctx, c, F, U } = D; const fs = o.fs || U * 0.024, ink = o.ink || D.P.ink, soft = o.soft || rgba(ink, 0.75), icc = o.icon || D.P.accent, align = o.align || 'center';
    const { ph, rest } = contactItems(c); const qr = c.qr && D.A.qr; const note = String(c.note || '').trim();
    if (!ph.length && !rest.length && !note && !qr) return 0;
    const qs = qr ? Math.round(U * (o.stack ? 0.17 : 0.15)) : 0, capH = qr ? fs * 1.35 : 0; const tw = qr && !o.stack ? w - qs - fs * 1.4 : w;
    const rowsOf = (items, size, bold) => {
      ctx.font = bf(F, size, bold); const g = size * 1.3, rows = [[]]; let rw = 0;
      items.forEach((it) => { const iw = Math.min(tw, it.ic.length * size * 1.3 + ctx.measureText(it.t).width); const cur = rows[rows.length - 1]; if (cur.length && rw + g + iw > tw) { rows.push([]); rw = 0; } rw += (rows[rows.length - 1].length ? g : 0) + iw; rows[rows.length - 1].push(Object.assign({ w: iw }, it)); });
      return rows.filter((r) => r.length).map((r) => ({ items: r, size, bold, g, w: r.reduce((a, i) => a + i.w, 0) + g * (r.length - 1) }));
    };
    const rows = rowsOf(ph, fs * 1.14, true).concat(rowsOf(rest, fs * 0.92, false)); const noteH = note ? fs * 1.65 : 0;
    const textH = noteH + rows.reduce((a, r) => a + r.size * 1.62, 0);
    const h = o.stack ? textH + (qr ? qs + capH + fs * 0.6 : 0) : Math.max(textH, qs + capH);
    if (dry) return h;
    hit(D, x, y, w, h, 'contacts');
    let ty = o.stack ? y + (qr ? qs + capH + fs * 0.6 : 0) : y + (h - textH) / 2;
    const ta = align === 'center' ? 'center' : 'left', ax = align === 'center' ? x + tw / 2 : x;
    if (note) { ctx.font = 'italic ' + bf(F, fs, true); ctx.fillStyle = icc; ctx.textAlign = ta; ctx.fillText(clip(ctx, note, tw), ax, ty + fs * 1.05); ty += noteH; }
    rows.forEach((r) => {
      let rx = align === 'center' ? x + (tw - r.w) / 2 : x; const base = ty + r.size * 1.12;
      r.items.forEach((it) => {
        it.ic.forEach((n) => { icon(ctx, n, rx, base - r.size * 0.9, r.size * 1.06, icc); rx += r.size * 1.3; });
        const tW = it.w - it.ic.length * r.size * 1.3; ctx.font = bf(F, r.size, r.bold); ctx.fillStyle = r.bold ? ink : soft; ctx.textAlign = 'left'; ctx.fillText(clip(ctx, it.t, tW), rx, base); rx += tW + r.g;
      });
      ty += r.size * 1.62;
    });
    if (qr) {
      const qx = o.stack ? x + (w - qs) / 2 : x + w - qs, qy = o.stack ? y : y + (h - qs - capH) / 2; drawQR(ctx, D.A.qr, qx, qy, qs);
      ctx.font = bf(F, fs * 0.74, true); ctx.fillStyle = soft; ctx.textAlign = 'center'; ctx.fillText('Scan for the menu', qx + qs / 2, qy + qs + fs * 1.05);
    }
    return h;
  }

  /* ---------- templates ---------- */
  function tClassic(D) {
    const { ctx, W, H, U, M, P, F, c, k } = D; bgFill(D);
    ctx.strokeStyle = P.line; ctx.lineWidth = 3; rr(ctx, M * 0.45, M * 0.45, W - M * 0.9, H - M * 0.9, U * 0.026); ctx.stroke();
    let y = M * (0.65 + 0.45 * k); const L = U * 0.11 * k;
    if (logo(D, W / 2, y + L / 2, L / 2)) y += L + U * 0.026 * k;
    y = txt(D, c.name, W / 2, y, W - M * 2, (s) => bf(F, s, true), U * 0.048 * k, P.ink, { hit: ['text', 'name'] });
    if (c.tagline) y = txt(D, c.tagline, W / 2, y, W - M * 2, (s) => bf(F, s), U * 0.026 * Math.max(0.85, k), P.soft, { lh: 1.5, hit: ['text', 'tagline'] });
    y = title(D, c.title, W / 2, y + U * 0.014 * k, W - M * 2, U * 0.092 * k, P.accent);
    y = txt(D, String(c.date || '').toUpperCase(), W / 2, y + U * 0.004, W - M * 2, (s) => bf(F, s, true), U * 0.025, P.soft, { track: 0.12, lh: 1.6, hit: ['text', 'date'] });
    const bh = badges(D, M, y, W - M * 2, {}, true); if (bh) { badges(D, M, y + U * 0.008, W - M * 2); y += bh + U * 0.03; }
    y += U * 0.012 * k; ornament(D, W / 2, y, U * 0.12, P.line, P.accent); y += U * 0.045 * k;
    const fh = footer(D, M, 0, W - M * 2, {}, true);
    const sh = special(D, M, y, W - M * 2, {}, true); if (sh) { special(D, M, y, W - M * 2); y += sh + U * 0.035 * k; }
    const fy = H - M * 0.95 - fh; const r = menuList(D, { x: M, y, w: W - M * 2, h: (fh ? fy - U * 0.04 : H - M * 1.1) - y }, { style: 'leader' });
    if (fh) { hline(ctx, M, fy - U * 0.018, W - M, P.line, 1.5); footer(D, M, fy, W - M * 2); }
    return r;
  }
  function tElegant(D) {
    const { ctx, W, H, U, M, P, F, c, k, A } = D; bgFill(D);
    ctx.strokeStyle = P.accent; ctx.lineWidth = 2.5; ctx.strokeRect(M * 0.35, M * 0.35, W - M * 0.7, H - M * 0.7); ctx.lineWidth = 1.2; ctx.strokeRect(M * 0.5, M * 0.5, W - M, H - M);
    [[M * 0.5, M * 0.5], [W - M * 0.5, M * 0.5], [M * 0.5, H - M * 0.5], [W - M * 0.5, H - M * 0.5]].forEach(([x, y]) => diamond(ctx, x, y, U * 0.014, P.accent));
    const iw = W - M * 2.4; let y = M * (0.9 + 0.3 * k);
    if (A.logo && c.showLogo !== false) { const L = U * 0.085 * k; logo(D, W / 2, y + L / 2, L / 2, P.accent); y += L + U * 0.022 * k; }
    y = txt(D, String(c.name || '').toUpperCase(), W / 2, y, iw, (s) => bf(F, s, true), U * 0.03 * k, P.ink, { track: 0.22, lh: 1.5, hit: ['text', 'name'] });
    y = title(D, c.title, W / 2, y, iw, U * 0.11 * k, P.accent);
    y = txt(D, c.date, W / 2, y, iw, (s) => 'italic ' + bf(F, s), U * 0.028, P.soft, { lh: 1.5, hit: ['text', 'date'] });
    if (c.tagline) y = txt(D, c.tagline, W / 2, y, iw, (s) => bf(F, s), U * 0.024, P.soft, { lh: 1.5, hit: ['text', 'tagline'] });
    y += U * 0.012; ornament(D, W / 2, y, U * 0.16, P.accent, P.accent, 'diamond'); y += U * 0.04 * k;
    const bh = badges(D, M * 1.2, y, iw, {}, true); if (bh) { badges(D, M * 1.2, y, iw); y += bh + U * 0.03; }
    const fh = footer(D, M * 1.2, 0, iw, {}, true);
    const sh = special(D, M * 1.2, y, iw, { center: true }, true); if (sh) { special(D, M * 1.2, y, iw, { center: true }); y += sh + U * 0.03 * k; }
    const fy = H - M * 1.05 - fh; const r = menuList(D, { x: M * 1.2, y, w: iw, h: (fh ? fy - U * 0.04 : H - M * 1.2) - y }, { style: 'center', cat: 'head' });
    if (fh) { ornament(D, W / 2, fy - U * 0.02, U * 0.1, P.line, P.accent, 'diamond'); footer(D, M * 1.2, fy, iw); }
    return r;
  }
  function tBold(D) {
    const { ctx, W, H, U, M, P, F, c, k, A } = D; bgFill(D);
    const pd = A.photo ? U * 0.3 * Math.max(0.8, k) : 0, L = U * 0.07, tw = W - M * 2 - (pd ? pd + U * 0.04 : 0);
    const tf = titleFit(D, c.title, tw, U * 0.135 * k, 2);
    const contentH = M * 0.7 + L + U * 0.025 * k + tf.L.length * tf.s * 0.95 + tf.s * 0.12 + U * 0.026 * 1.3;
    const bh = Math.max(H * 0.2, contentH + U * 0.035, pd ? pd + U * 0.09 : 0), sl = U * 0.05;
    ctx.fillStyle = P.accent; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, bh); ctx.lineTo(0, bh + sl); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.clip(); pattern(D, 'dots', P.onAccent, 0, 0, W, bh + sl); ctx.restore();
    if (pd) { const cx = W - M - pd / 2, cy = bh * 0.52; ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = U * 0.03; ctx.beginPath(); ctx.arc(cx, cy, pd / 2 + U * 0.012, 0, Math.PI * 2); ctx.fillStyle = P.bg; ctx.fill(); ctx.restore(); ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, pd / 2, 0, Math.PI * 2); ctx.clip(); cover(ctx, A.photo, cx - pd / 2, cy - pd / 2, pd, pd); ctx.restore(); hit(D, cx - pd / 2, cy - pd / 2, pd, pd, 'photos'); }
    let y = M * 0.7, nx = M;
    if (logo(D, M + L / 2, y + L / 2, L / 2, P.onAccent, P.bg)) nx = M + L + U * 0.022;
    txt(D, String(c.name || '').toUpperCase(), nx, y + L / 2 - U * 0.018, tw - (nx - M), (s) => bf(F, s, true), U * 0.03, P.onAccent, { align: 'left', track: 0.08, hit: ['text', 'name'] });
    y += L + U * 0.025 * k;
    y = title(D, c.title, M, y, tw, U * 0.135 * k, P.onAccent, { align: 'left', lines: 2, lh: 0.95 });
    txt(D, c.date, M, y, tw, (s) => bf(F, s, true), U * 0.026, rgba(P.onAccent, 0.85), { align: 'left', hit: ['text', 'date'] });
    y = bh + sl + U * 0.035;
    const bdh = badges(D, M, y, W - M * 2, { align: 'left', bg: P.ink, fg: P.bg }, true); if (bdh) { badges(D, M, y, W - M * 2, { align: 'left', bg: P.ink, fg: P.bg }); y += bdh + U * 0.03; }
    const fo = { ink: P.bg, soft: rgba(P.bg, 0.78), icon: P.accent }; const fh = footer(D, M, 0, W - M * 2, fo, true); const barH = fh ? fh + U * 0.06 : 0;
    const sh = special(D, M, y, W - M * 2, { bg: P.surface, ink: P.surfInk, stroke: false, photo: false }, true); if (sh) { special(D, M, y, W - M * 2, { bg: P.surface, ink: P.surfInk, stroke: false, photo: false }); y += sh + U * 0.035 * k; }
    const r = menuList(D, { x: M, y, w: W - M * 2, h: H - barH - U * 0.035 - y - (barH ? 0 : M * 0.6) }, { style: 'pill', catRule: true });
    if (barH) { ctx.fillStyle = P.ink; ctx.fillRect(0, H - barH, W, barH); footer(D, M, H - barH + U * 0.03, W - M * 2, fo); }
    return r;
  }
  function tPhoto(D) {
    const { ctx, W, H, U, M, P, F, c, k, A } = D; const wide = W / H > 1.3;
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, W, H);
    const hw = wide ? W * 0.46 : W, hh = wide ? H : H * 0.42 * (0.5 + 0.5 * k); const heroInk = A.photo ? '#ffffff' : onColor(P.accent);
    if (A.photo) { cover(ctx, A.photo, 0, 0, hw, hh); const t = ctx.createLinearGradient(0, 0, 0, hh * 0.3); t.addColorStop(0, 'rgba(0,0,0,.5)'); t.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = t; ctx.fillRect(0, 0, hw, hh); const b = ctx.createLinearGradient(0, hh * 0.3, 0, hh); b.addColorStop(0, 'rgba(0,0,0,0)'); b.addColorStop(1, 'rgba(0,0,0,.74)'); ctx.fillStyle = b; ctx.fillRect(0, 0, hw, hh); }
    else { const g = ctx.createLinearGradient(0, 0, hw, hh); g.addColorStop(0, P.accent); g.addColorStop(1, mix(P.accent, '#000000', 0.32)); ctx.fillStyle = g; ctx.fillRect(0, 0, hw, hh); pattern(D, 'dots', heroInk, 0, 0, hw, hh); }
    hit(D, 0, 0, hw, hh, 'photos');
    const L = U * 0.075; let nx = M; if (logo(D, M + L / 2, M * 0.7 + L / 2, L / 2, heroInk)) nx += L + U * 0.022;
    txt(D, c.name, nx, M * 0.7 + L / 2 - U * 0.019, hw - nx - M, (s) => bf(F, s, true), U * 0.032, heroInk, { align: 'left', hit: ['text', 'name'] });
    const tw = hw - M * 2, tf = titleFit(D, c.title, tw, U * 0.115 * k, 2), dateH = U * 0.028 * 1.45;
    let ty = hh - (wide ? M : U * 0.085) - dateH - tf.L.length * tf.s * 1.0;
    ty = title(D, c.title, M, ty, tw, U * 0.115 * k, heroInk, { align: 'left', lines: 2, lh: 1.0 });
    txt(D, c.date, M, ty, tw, (s) => bf(F, s, true), U * 0.028, heroInk === '#ffffff' ? 'rgba(255,255,255,.88)' : rgba(heroInk, 0.8), { align: 'left', hit: ['text', 'date'] });
    const px = wide ? hw : 0, py = wide ? 0 : hh - U * 0.045, pw = W - px;
    ctx.fillStyle = P.surface; if (wide) ctx.fillRect(px, py, pw, H); else { rrTop(ctx, px, py, pw, H - py, U * 0.045); ctx.fill(); }
    const ix = px + M, iw = pw - M * 2; let y = py + (wide ? M * 0.9 : U * 0.06); const ink = P.surfInk;
    const bdh = badges(D, ix, y, iw, { align: 'left' }, true); if (bdh) { badges(D, ix, y, iw, { align: 'left' }); y += bdh + U * 0.03; }
    const fo = { ink, soft: rgba(ink, 0.72), align: wide ? 'left' : 'center' }; const fh = footer(D, ix, 0, iw, fo, true);
    const so = { bg: rgba(ink, 0.06), ink, stroke: false, photo: false }; const sh = special(D, ix, y, iw, so, true); if (sh) { special(D, ix, y, iw, so); y += sh + U * 0.03 * k; }
    const fy = H - M * 0.85 - fh; const r = menuList(D, { x: ix, y, w: iw, h: (fh ? fy - U * 0.04 : H - M) - y }, { style: 'leader', ink, catRule: true });
    if (fh) { hline(ctx, ix, fy - U * 0.018, ix + iw, rgba(ink, 0.14), 1.5); footer(D, ix, fy, iw, fo); }
    return r;
  }
  function tSplit(D) {
    const { ctx, W, H, U, M, P, F, c, k } = D; bgFill(D); const on = P.onAccent, onSoft = rgba(on, 0.8);
    if (W / H >= 0.7) {
      const pw = W * (W / H > 1.3 ? 0.32 : 0.38), pm = U * 0.05, cw = pw - pm * 2, cx = pw / 2;
      ctx.fillStyle = P.accent; ctx.fillRect(0, 0, pw, H); pattern(D, 'dots', on, 0, 0, pw, H);
      let y = M * (0.8 + 0.3 * k); const L = U * 0.13 * k; if (logo(D, cx, y + L / 2, L / 2, on, P.bg)) y += L + U * 0.03 * k;
      y = txt(D, c.name, cx, y, cw, (s) => bf(F, s, true), U * 0.04 * k, on, { hit: ['text', 'name'] });
      if (c.tagline) y = txt(D, c.tagline, cx, y, cw, (s) => bf(F, s), U * 0.022, onSoft, { lh: 1.5, hit: ['text', 'tagline'] });
      y += U * 0.028 * k; hline(ctx, cx - U * 0.05, y, cx + U * 0.05, on, 3); y += U * 0.035 * k;
      y = title(D, c.title, cx, y, cw, U * 0.095 * k, on, { lines: 3, lh: 1.0 });
      y = txt(D, c.date, cx, y + U * 0.005, cw, (s) => bf(F, s, true), U * 0.023, onSoft, { lh: 1.6, hit: ['text', 'date'] });
      const bo = { bg: P.bg, fg: P.ink }; const bdh = badges(D, pm, y, cw, bo, true); if (bdh) badges(D, pm, y + U * 0.01, cw, bo);
      const fo = { ink: on, soft: onSoft, icon: on, fs: U * 0.022, stack: true }; const fh = footer(D, pm, 0, cw, fo, true); if (fh) footer(D, pm, H - M * 0.8 - fh, cw, fo);
      const rx = pw + M * 0.8, rw = W - rx - M * 0.8; let ry = M * 0.9;
      const sh = special(D, rx, ry, rw, {}, true); if (sh) { special(D, rx, ry, rw); ry += sh + U * 0.035; }
      return menuList(D, { x: rx, y: ry, w: rw, h: H - ry - M * 0.9 }, { style: 'leader', catRule: true });
    }
    // tall (status): the coloured panel on top
    const ph = H * 0.34 * (0.85 + 0.15 * k); ctx.fillStyle = P.accent; ctx.fillRect(0, 0, W, ph); pattern(D, 'dots', on, 0, 0, W, ph);
    let y = M * 0.9; const L = U * 0.13 * k; if (logo(D, W / 2, y + L / 2, L / 2, on, P.bg)) y += L + U * 0.03;
    y = txt(D, c.name, W / 2, y, W - M * 2, (s) => bf(F, s, true), U * 0.042, on, { hit: ['text', 'name'] });
    y = title(D, c.title, W / 2, y + U * 0.02, W - M * 2, U * 0.12 * k, on, { lines: 2, lh: 1.0 });
    txt(D, c.date, W / 2, y, W - M * 2, (s) => bf(F, s, true), U * 0.026, onSoft, { hit: ['text', 'date'] });
    y = ph + U * 0.05;
    const bdh = badges(D, M, y, W - M * 2, {}, true); if (bdh) { badges(D, M, y, W - M * 2); y += bdh + U * 0.035; }
    const fh = footer(D, M, 0, W - M * 2, {}, true);
    const sh = special(D, M, y, W - M * 2, {}, true); if (sh) { special(D, M, y, W - M * 2); y += sh + U * 0.04; }
    const fy = H - M - fh; const r = menuList(D, { x: M, y, w: W - M * 2, h: (fh ? fy - U * 0.045 : H - M) - y }, { style: 'leader', catRule: true });
    if (fh) { hline(ctx, M, fy - U * 0.02, W - M, P.faint, 1.5); footer(D, M, fy, W - M * 2); }
    return r;
  }
  function tChalk(D) {
    const { ctx, W, H, U, M, P, F, c, k, A } = D;
    const g = ctx.createRadialGradient(W / 2, H * 0.4, U * 0.1, W / 2, H / 2, Math.max(W, H) * 0.75); g.addColorStop(0, P.bg); g.addColorStop(1, P.bg2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    pattern(D, 'grain', P.ink, 0, 0, W, H);
    const R = rnd(11); for (let i = 0; i < 6; i++) { const x = R() * W, y = R() * H, r = U * (0.18 + R() * 0.2); const s = ctx.createRadialGradient(x, y, 0, x, y, r); s.addColorStop(0, rgba(P.ink, 0.045)); s.addColorStop(1, rgba(P.ink, 0)); ctx.fillStyle = s; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    const fw = M * 0.34; ctx.lineWidth = fw; ctx.strokeStyle = '#7a4e2d'; ctx.strokeRect(fw / 2, fw / 2, W - fw, H - fw); ctx.lineWidth = 3; ctx.strokeStyle = '#a5703f'; ctx.strokeRect(fw * 0.3, fw * 0.3, W - fw * 0.6, H - fw * 0.6); ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.strokeRect(fw, fw, W - fw * 2, H - fw * 2);
    const iw = W - M * 2.2; let y = M * (0.8 + 0.4 * k);
    if (A.logo && c.showLogo !== false) { const L = U * 0.09 * k; logo(D, W / 2, y + L / 2, L / 2, rgba(P.ink, 0.8)); y += L + U * 0.02 * k; }
    y = txt(D, c.name, W / 2, y, iw, (s) => bf(F, s), U * 0.046 * k, P.ink, { hit: ['text', 'name'] });
    const tf = titleFit(D, c.title, W - M * 3, U * 0.15 * k, 1); y = title(D, c.title, W / 2, y, W - M * 3, U * 0.15 * k, P.ink);
    ctx.font = hf(D.F, tf.s); const tw = Math.min(W - M * 3, ctx.measureText(tf.L[0] || '').width);
    ctx.strokeStyle = P.accent; ctx.lineWidth = U * 0.007; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(W / 2 - tw * 0.45, y - U * 0.004); ctx.quadraticCurveTo(W / 2, y + U * 0.022, W / 2 + tw * 0.5, y - U * 0.014); ctx.stroke(); ctx.lineCap = 'butt';
    const st = U * 0.045; icon(ctx, 'star', W / 2 - tw / 2 - st * 1.6, y - tf.s * 0.75, st, rgba(P.accent, 0.85)); icon(ctx, 'star', W / 2 + tw / 2 + st * 0.6, y - tf.s * 0.95, st * 0.8, rgba(P.ink, 0.6));
    y = txt(D, c.date, W / 2, y + U * 0.03, iw, (s) => bf(F, s), U * 0.034, P.soft, { lh: 1.5, hit: ['text', 'date'] });
    if (c.tagline) y = txt(D, c.tagline, W / 2, y, iw, (s) => bf(F, s), U * 0.028, P.soft, { lh: 1.45, hit: ['text', 'tagline'] });
    y += U * 0.015 * k;
    const bo = { bg: P.accent, fg: P.onAccent }; const bdh = badges(D, M * 1.1, y, iw, bo, true); if (bdh) { badges(D, M * 1.1, y, iw, bo); y += bdh + U * 0.03; }
    const fh = footer(D, M * 1.1, 0, iw, {}, true);
    const so = { bg: 'rgba(255,255,255,.04)', line: rgba(P.ink, 0.55), dash: true }; const sh = special(D, M * 1.1, y, iw, so, true); if (sh) { special(D, M * 1.1, y, iw, so); y += sh + U * 0.035 * k; }
    const fy = H - M * 1.05 - fh; const r = menuList(D, { x: M * 1.1, y, w: iw, h: (fh ? fy - U * 0.04 : H - M * 1.2) - y }, { style: 'leader', cat: 'head', leader: rgba(P.ink, 0.42) });
    if (fh) footer(D, M * 1.1, fy, iw);
    return r;
  }
  function halftone(D, cx, cy, rad, color) { const { ctx, U } = D; const s = U * 0.03; ctx.fillStyle = color; for (let y = cy - rad; y <= cy + rad; y += s) for (let x = cx - rad; x <= cx + rad; x += s) { const d = Math.hypot(x - cx, y - cy); if (d > rad) continue; const r = s * 0.42 * (1 - d / rad); if (r < 0.8) continue; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); } }
  function tStreet(D) {
    const { ctx, W, H, U, M, P, F, c, k, A } = D; bgFill(D);
    halftone(D, W, 0, U * 0.5, rgba(P.ink, 0.12)); halftone(D, 0, H, U * 0.45, rgba(P.accent, 0.2));
    let y = M * 0.8; const L = U * 0.085 * k;
    if (logo(D, W / 2, y + L / 2, L / 2, P.ink)) y += L + U * 0.02;
    y = txt(D, String(c.name || '').toUpperCase(), W / 2, y, W - M * 2, (s) => bf(F, s, true), U * 0.042 * k, P.ink, { track: 0.06, hit: ['text', 'name'] });
    const tf = titleFit(D, c.title, W - M * 3.2, U * 0.105 * k, 1), rh = tf.s * 1.5, rw = W - M * 1.4; y += U * 0.02;
    ctx.save(); ctx.translate(W / 2, y + rh / 2); ctx.rotate(-0.035);
    const ribbon = (dx, dy, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-rw / 2 + dx, -rh / 2 + dy); ctx.lineTo(rw / 2 + dx, -rh / 2 + dy); ctx.lineTo(rw / 2 - rh * 0.3 + dx, dy); ctx.lineTo(rw / 2 + dx, rh / 2 + dy); ctx.lineTo(-rw / 2 + dx, rh / 2 + dy); ctx.lineTo(-rw / 2 + rh * 0.3 + dx, dy); ctx.closePath(); ctx.fill(); };
    ribbon(U * 0.01, U * 0.012, P.ink); ribbon(0, 0, P.accent);
    ctx.font = hf(F, tf.s); ctx.fillStyle = P.onAccent; ctx.textAlign = 'center'; ctx.fillText(clip(ctx, tf.L[0] || '', W - M * 3.2), 0, tf.s * 0.33); ctx.restore();
    hit(D, M, y, W - M * 2, rh, 'text', 'title'); y += rh + U * 0.035;
    y = txt(D, String(c.date || '').toUpperCase(), W / 2, y, W - M * 2, (s) => bf(F, s, true), U * 0.026, P.ink, { track: 0.1, lh: 1.6, hit: ['text', 'date'] });
    const bo = { bg: P.ink, fg: P.bg }; const bdh = badges(D, M, y, W - M * 2, bo, true); if (bdh) { badges(D, M, y, W - M * 2, bo); y += bdh + U * 0.03; }
    const sp = c.items.find((it) => it.id === c.special);
    if (sp) { // a price sticker (star burst) next to the dish of the day
      const bd = U * 0.22 * Math.max(0.6, k), bx = W - M - bd / 2, by = y + bd / 2;
      ctx.beginPath(); for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? bd * 0.42 : bd * 0.5; ctx.lineTo(bx + Math.cos(a) * r, by + Math.sin(a) * r); } ctx.closePath(); ctx.fillStyle = P.accent; ctx.fill(); ctx.strokeStyle = P.ink; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = P.onAccent; ctx.textAlign = 'center'; ctx.font = bf(F, bd * 0.11, true); ctx.fillText('ONLY', bx, by - bd * 0.1);
      if (c.prices) { fit(ctx, money(sp.price), bd * 0.74, bd * 0.2, (s) => bf(F, s, true)); ctx.fillText(money(sp.price), bx, by + bd * 0.13); }
      let tx = M; if (A.photo) { const s = bd * 0.86; ctx.save(); ctx.beginPath(); ctx.arc(M + s / 2, by, s / 2, 0, Math.PI * 2); ctx.clip(); cover(ctx, A.photo, M, by - s / 2, s, s); ctx.restore(); ctx.strokeStyle = P.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(M + s / 2, by, s / 2, 0, Math.PI * 2); ctx.stroke(); tx = M + s + U * 0.03; }
      const room = bx - bd / 2 - U * 0.03 - tx; ctx.textAlign = 'left'; ctx.fillStyle = P.accent; ctx.font = bf(F, U * 0.022, true); tracked(ctx, '★ DISH OF THE DAY', tx, by - U * 0.03, U * 0.003);
      ctx.fillStyle = P.ink; fit(ctx, sp.name, room, U * 0.055, (s) => bf(F, s, true)); ctx.fillText(clip(ctx, sp.name, room), tx, by + U * 0.035);
      hit(D, M, y, W - M * 2, bd, 'dishes', 'special'); y += bd + U * 0.035;
    }
    const fo = { ink: P.bg, soft: rgba(P.bg, 0.8), icon: P.bg }; const fh = footer(D, M, 0, W - M * 2, fo, true); const barH = fh ? fh + U * 0.06 : 0;
    const r = menuList(D, { x: M, y, w: W - M * 2, h: H - barH - U * 0.035 - y - (barH ? 0 : M * 0.6) }, { style: 'pill', catColor: P.ink, pillBg: P.ink, pillInk: P.bg });
    if (barH) { ctx.fillStyle = P.ink; ctx.fillRect(0, H - barH, W, barH); ctx.fillStyle = P.accent; ctx.fillRect(0, H - barH, W, U * 0.008); footer(D, M, H - barH + U * 0.03, W - M * 2, Object.assign({}, fo, { icon: P.accent })); }
    return r;
  }
  function tMinimal(D) {
    const { ctx, W, H, U, M, P, F, c, k, A } = D; bgFill(D); const m = M * 1.1, iw = W - m * 2; let y = m; const L = U * 0.075;
    if (A.logo && c.showLogo !== false) logo(D, W - m - L / 2, y + L / 2, L / 2);
    txt(D, String(c.name || '').toUpperCase(), m, y + L / 2 - U * 0.014, iw - L - U * 0.03, (s) => bf(F, s, true), U * 0.026, P.ink, { align: 'left', track: 0.18, hit: ['text', 'name'] });
    y += L + U * 0.05 * k;
    y = title(D, c.title, m, y, iw, U * 0.13 * k, P.ink, { align: 'left', lines: 2, lh: 1.0 });
    ctx.fillStyle = P.accent; ctx.beginPath(); ctx.arc(m + U * 0.009, y + U * 0.021, U * 0.009, 0, Math.PI * 2); ctx.fill();
    y = txt(D, c.date, m + U * 0.032, y, iw, (s) => bf(F, s), U * 0.027, P.soft, { align: 'left', lh: 1.6, hit: ['text', 'date'] });
    if (c.tagline) y = txt(D, c.tagline, m, y, iw, (s) => bf(F, s), U * 0.024, P.soft, { align: 'left', lh: 1.5, hit: ['text', 'tagline'] });
    const bdh = badges(D, m, y + U * 0.01, iw, { align: 'left' }, true); if (bdh) { badges(D, m, y + U * 0.01, iw, { align: 'left' }); y += bdh + U * 0.03; }
    y += U * 0.02; hline(ctx, m, y, W - m, P.faint, 2); y += U * 0.045 * k;
    const fo = { align: 'left' }; const fh = footer(D, m, 0, iw, fo, true);
    const so = { bg: rgba(P.accent, 0.09), stroke: false }; const sh = special(D, m, y, iw, so, true); if (sh) { special(D, m, y, iw, so); y += sh + U * 0.04 * k; }
    const fy = H - m - fh; const r = menuList(D, { x: m, y, w: iw, h: (fh ? fy - U * 0.05 : H - m) - y }, { style: 'plain' });
    if (fh) { hline(ctx, m, fy - U * 0.025, W - m, P.faint, 2); footer(D, m, fy, iw, fo); }
    return r;
  }
  /* ---------- 12 more designs ---------- */
  /** logo · name · tagline · title · date · stickers, centred; returns the y under them */
  function head(D, cx, y, w, o = {}) {
    const { U, F, c, k, P } = D; const ink = o.ink || P.ink, soft = o.soft || rgba(ink, 0.74);
    if (o.logo !== false) { const L = U * (o.L || 0.1) * k; if (logo(D, cx, y + L / 2, L / 2, o.ring, o.logoBg)) y += L + U * 0.024 * k; }
    y = txt(D, o.caps ? String(c.name || '').toUpperCase() : c.name, cx, y, w, (s) => bf(F, s, true), U * (o.ns || 0.044) * k, o.nameInk || ink, { track: o.caps ? 0.14 : 0, hit: ['text', 'name'] });
    if (c.tagline && o.tag !== false) y = txt(D, c.tagline, cx, y, w, (s) => bf(F, s), U * 0.025 * Math.max(0.85, k), soft, { lh: 1.5, hit: ['text', 'tagline'] });
    if (o.titleFn) y = o.titleFn(y + U * 0.012 * k); else y = title(D, c.title, cx, y + U * 0.012 * k, w, U * (o.ts || 0.095) * k, o.title || P.accent, { lines: o.lines || 1 });
    y = txt(D, o.dateCaps ? String(c.date || '').toUpperCase() : c.date, cx, y + U * 0.004, w, (s) => bf(F, s, true), U * 0.025, soft, { track: o.dateCaps ? 0.12 : 0, lh: 1.6, hit: ['text', 'date'] });
    const bo = o.badge || {}; const bh = badges(D, cx - w / 2, y, w, bo, true); if (bh) { badges(D, cx - w / 2, y + U * 0.006, w, bo); y += bh + U * 0.028; }
    return y;
  }
  /** the dish of the day, the dishes, then the contacts at the foot (yEnd); returns the list's result */
  function body(D, x, y, w, yEnd, o = {}) {
    const { U, k } = D; const fo = o.foot || {}; const fh = footer(D, x, 0, w, fo, true);
    const so = o.special || {}; const sh = special(D, x, y, w, so, true); if (sh) { special(D, x, y, w, so); y += sh + U * 0.032 * k; }
    const fy = yEnd - fh; const r = menuList(D, { x, y, w, h: (fh ? fy - U * 0.04 : yEnd) - y }, o.list || {});
    if (fh) { if (o.rule !== false) hline(D.ctx, x, fy - U * 0.018, x + w, o.ruleColor || D.P.line, 1.5); footer(D, x, fy, w, fo); }
    return r;
  }
  function kenteBand(D, y, h) {
    const { ctx, W } = D; const K4 = ['#b5121b', '#f4b400', '#0b8a4a', '#111111']; const s = h * 1.15;
    ctx.save(); ctx.beginPath(); ctx.rect(0, y, W, h); ctx.clip();
    for (let i = 0, x = 0; x < W + s; i++, x += s) {
      ctx.fillStyle = K4[i % 4]; ctx.fillRect(x, y, s, h);
      ctx.fillStyle = K4[(i + 1) % 4]; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + s / 2, y + h * 0.3); ctx.lineTo(x + s, y + h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = K4[(i + 2) % 4]; ctx.fillRect(x + s * 0.4, y + h * 0.08, s * 0.2, h * 0.16);
    }
    ctx.restore(); hline(ctx, 0, y === 0 ? h + 3 : y - 3, W, '#f4b400', 3);
  }
  function tKente(D) {
    const { W, H, U, M, P, k } = D; bgFill(D); const bh = U * 0.065; kenteBand(D, 0, bh); kenteBand(D, H - bh, bh);
    const y = head(D, W / 2, bh + M * (0.35 + 0.3 * k), W - M * 2, { caps: true, ns: 0.038, dateCaps: true });
    return body(D, M, y + U * 0.012, W - M * 2, H - bh - M * 0.55, { list: { style: 'leader', catRule: true } });
  }
  function tCard(D) {
    const { ctx, W, H, U, M, P, k, s } = D; bgFill(D); const L = U * 0.12 * k; const x = M * 0.6, y = M * 0.6 + L * 0.5, w = W - M * 1.2, h = H - y - M * 0.6;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = U * 0.04 * s; ctx.shadowOffsetY = U * 0.012 * s; ctx.fillStyle = P.surface; rr(ctx, x, y, w, h, U * 0.03); ctx.fill(); ctx.restore();
    ctx.strokeStyle = rgba(P.accent, 0.45); ctx.lineWidth = 2; rr(ctx, x + U * 0.016, y + U * 0.016, w - U * 0.032, h - U * 0.032, U * 0.022); ctx.stroke();
    let yy = y + L * 0.5 + U * 0.03; if (!logo(D, W / 2, y, L / 2, P.surface)) yy = y + U * 0.05;
    const ink = P.surfInk, iw = w - U * 0.1, ix = x + U * 0.05;
    yy = head(D, W / 2, yy, iw, { logo: false, ink, ns: 0.04 });
    return body(D, ix, yy + U * 0.01, iw, y + h - U * 0.05, { special: { ink, bg: rgba(ink, 0.05) }, list: { style: 'leader', ink, cat: 'head' }, foot: { ink, soft: rgba(ink, 0.72) } });
  }
  function tDiagonal(D) {
    const { ctx, W, H, U, M, P, F, c, k } = D; bgFill(D); const on = P.onAccent, L = U * 0.075, tw = W - M * 2;
    const tf = titleFit(D, c.title, tw, U * 0.13 * k, 2); const yh = M * 0.7 + L + U * 0.02 + tf.L.length * tf.s * 0.96 + tf.s * 0.12 + U * 0.04;
    ctx.fillStyle = P.accent; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, yh - U * 0.08); ctx.lineTo(0, yh + U * 0.1); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.clip(); pattern(D, 'stripes', on, 0, 0, W, yh + U * 0.1); ctx.restore();
    ctx.strokeStyle = P.accent; ctx.lineWidth = U * 0.008; ctx.beginPath(); ctx.moveTo(0, yh + U * 0.15); ctx.lineTo(W, yh - U * 0.03); ctx.stroke();
    logo(D, W - M - L / 2, M * 0.7 + L / 2, L / 2, on, P.bg);
    txt(D, String(c.name || '').toUpperCase(), M, M * 0.7 + L / 2 - U * 0.017, tw - L - U * 0.03, (s) => bf(F, s, true), U * 0.03, on, { align: 'left', track: 0.1, hit: ['text', 'name'] });
    let y = title(D, c.title, M, M * 0.7 + L + U * 0.02, tw, U * 0.13 * k, on, { align: 'left', lines: 2, lh: 0.96 });
    txt(D, c.date, M, y, tw * 0.7, (s) => bf(F, s, true), U * 0.026, rgba(on, 0.88), { align: 'left', hit: ['text', 'date'] });
    y = yh + U * 0.16; const bh = badges(D, M, y, tw, { align: 'right' }, true); if (bh) { badges(D, M, y, tw, { align: 'right' }); y += bh + U * 0.03; }
    return body(D, M, y, tw, H - M * 0.8, { list: { style: 'leader', catRule: true } });
  }
  function tPlate(D) {
    const { ctx, W, H, U, M, P, F, c, k, A } = D; bgFill(D); const R = U * 0.19 * Math.max(0.6, k), cx = W / 2;
    let y = M * 0.7; y = txt(D, String(c.name || '').toUpperCase(), cx, y, W - M * 2, (s) => bf(F, s, true), U * 0.032 * Math.max(0.8, k), P.ink, { track: 0.16, lh: 1.5, hit: ['text', 'name'] });
    const cy = y + R * 1.14; ctx.save(); ctx.setLineDash([U * 0.012, U * 0.012]); ctx.strokeStyle = P.accent; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = U * 0.03 * D.s; ctx.fillStyle = P.surface; ctx.beginPath(); ctx.arc(cx, cy, R * 1.03, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, 0, Math.PI * 2); ctx.clip();
    if (A.photo) cover(ctx, A.photo, cx - R, cy - R, R * 2, R * 2); else { const g = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R); g.addColorStop(0, mix(P.accent, '#ffffff', 0.2)); g.addColorStop(1, P.accent); ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); }
    ctx.restore(); hit(D, cx - R, cy - R, R * 2, R * 2, 'photos');
    if (!A.photo) { const f = titleFit(D, c.title, R * 1.5, U * 0.08 * k, 2); const th = f.L.length * f.s; title(D, c.title, cx, cy - th / 2 - f.s * 0.05, R * 1.5, U * 0.08 * k, P.onAccent, { lines: 2, lh: 1.0 }); y = cy + R * 1.14 + U * 0.02; }
    else { y = title(D, c.title, cx, cy + R * 1.14 + U * 0.02, W - M * 2, U * 0.085 * k, P.accent); }
    y = txt(D, c.date, cx, y + U * 0.004, W - M * 2, (s) => bf(F, s, true), U * 0.025, P.soft, { lh: 1.6, hit: ['text', 'date'] });
    const bh = badges(D, M, y, W - M * 2, {}, true); if (bh) { badges(D, M, y, W - M * 2); y += bh + U * 0.028; }
    return body(D, M, y + U * 0.01, W - M * 2, H - M * 0.8, { list: { style: 'leader', catRule: true } });
  }
  function tMagazine(D) {
    const { ctx, W, H, U, M, P, F, c, k } = D; bgFill(D); const m = M * 1.05, iw = W - m * 2; let y = m * 0.85;
    txt(D, String(c.name || '').toUpperCase(), m, y, iw * 0.6, (s) => bf(F, s, true), U * 0.024, P.ink, { align: 'left', track: 0.2, hit: ['text', 'name'] });
    txt(D, c.date, W - m, y, iw * 0.4, (s) => bf(F, s), U * 0.024, P.soft, { align: 'right', hit: ['text', 'date'] });
    y += U * 0.045; hline(ctx, m, y, W - m, P.ink, 4); hline(ctx, m, y + U * 0.01, W - m, P.ink, 1.2); y += U * 0.035 * k;
    y = title(D, c.title, m, y, iw, U * 0.15 * k, P.ink, { align: 'left', lines: 2, lh: 0.95 });
    ctx.fillStyle = P.accent; ctx.fillRect(m, y + U * 0.006, U * 0.12, U * 0.012); y += U * 0.03;
    if (c.tagline) y = txt(D, c.tagline, m, y, iw, (s) => 'italic ' + bf(F, s), U * 0.026, P.soft, { align: 'left', lh: 1.3, hit: ['text', 'tagline'] });
    y += U * 0.03 * k; const bh = badges(D, m, y, iw, { align: 'left', bg: P.ink, fg: P.bg }, true); if (bh) { badges(D, m, y, iw, { align: 'left', bg: P.ink, fg: P.bg }); y += bh + U * 0.03; }
    return body(D, m, y, iw, H - m * 0.85, { special: { bg: rgba(P.accent, 0.1), stroke: false }, list: { style: 'plain', num: true, cat: 'head' }, foot: { align: 'left' }, ruleColor: P.ink });
  }
  function tNeon(D) {
    const { ctx, W, H, U, M, P, F, c, k, s } = D;
    const g = ctx.createRadialGradient(W / 2, H * 0.3, U * 0.05, W / 2, H / 2, Math.max(W, H) * 0.8); g.addColorStop(0, P.bg2); g.addColorStop(1, P.bg); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    pattern(D, 'grain', P.ink, 0, 0, W, H); if (D.A.bg) { cover(ctx, D.A.bg, 0, 0, W, H); ctx.fillStyle = rgba(P.bg, c.overlay == null ? 0.7 : c.overlay); ctx.fillRect(0, 0, W, H); }
    const glow = (fn, color, blur) => { ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur * s; fn(); ctx.shadowBlur = blur * 0.4 * s; fn(); ctx.restore(); };
    const cyan = mix(P.accent, '#22d3ee', 0.85);
    glow(() => { ctx.strokeStyle = cyan; ctx.lineWidth = U * 0.006; rr(ctx, M * 0.45, M * 0.45, W - M * 0.9, H - M * 0.9, U * 0.04); ctx.stroke(); }, cyan, U * 0.025);
    const y = head(D, W / 2, M * (0.75 + 0.35 * k), W - M * 2, { caps: true, ns: 0.034, nameInk: cyan, logo: !!D.A.logo, ring: cyan, titleFn: (yy) => {
      const tf = titleFit(D, c.title, W - M * 2.4, U * 0.115 * k, 1); ctx.font = hf(F, tf.s); ctx.textAlign = 'center'; const t = tf.L[0] || '';
      glow(() => { ctx.fillStyle = P.accent; ctx.fillText(t, W / 2, yy + tf.s * 0.84); }, P.accent, U * 0.04);
      ctx.fillStyle = mix(P.accent, '#ffffff', 0.6); ctx.fillText(t, W / 2, yy + tf.s * 0.84); hit(D, M, yy, W - M * 2, tf.s * 1.1, 'text', 'title'); return yy + tf.s * 1.14;
    } });
    return body(D, M, y + U * 0.015, W - M * 2, H - M * 0.85, { special: { bg: rgba(P.accent, 0.08), line: rgba(P.accent, 0.7) }, list: { style: 'leader', leader: rgba(cyan, 0.5), catColor: cyan }, foot: { icon: cyan }, ruleColor: rgba(cyan, 0.4) });
  }
  function leaf(ctx, x, y, len, ang, color) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(len * 0.3, -len * 0.34, len * 0.75, -len * 0.3, len, 0); ctx.bezierCurveTo(len * 0.75, len * 0.3, len * 0.3, len * 0.34, 0, 0); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = Math.max(1.5, len * 0.018); ctx.beginPath(); ctx.moveTo(len * 0.04, 0); ctx.lineTo(len * 0.92, 0); ctx.stroke();
    for (let i = 1; i < 5; i++) { const t = i / 5; ctx.beginPath(); ctx.moveTo(len * t, 0); ctx.lineTo(len * (t + 0.08), -len * 0.12); ctx.moveTo(len * t, 0); ctx.lineTo(len * (t + 0.08), len * 0.12); ctx.stroke(); }
    ctx.restore();
  }
  function tTropical(D) {
    const { ctx, W, H, U, M, P } = D; bgFill(D); const greens = ['#1f7a4d', '#2d9a5f', '#145c3a', '#3fae6e', '#0f5132']; const s = U * 0.3;
    [[0.1, 1], [0.55, 0.85], [1.05, 1.0], [1.5, 0.75], [0.8, 0.6]].forEach(([a, l], i) => leaf(ctx, -U * 0.02, -U * 0.02, s * l, a, greens[i]));
    [[3.25, 1], [3.7, 0.85], [4.2, 1.0], [4.65, 0.75], [3.95, 0.6]].forEach(([a, l], i) => leaf(ctx, W + U * 0.02, H + U * 0.02, s * l, a, greens[(i + 2) % 5]));
    ctx.fillStyle = P.accent; [[U * 0.2, U * 0.06, U * 0.016], [U * 0.17, U * 0.1, U * 0.012], [W - U * 0.2, H - U * 0.07, U * 0.016], [W - U * 0.16, H - U * 0.11, U * 0.011]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); });
    const y = head(D, W / 2, M * 0.85, W - M * 2.6, { ns: 0.04 });
    return body(D, M * 1.1, y + U * 0.01, W - M * 2.2, H - M * 1.15, { special: { bg: P.surface, line: rgba(P.accent, 0.5) }, list: { style: 'leader', cat: 'head' } });
  }
  function tSunburst(D) {
    const { ctx, W, H, U, M, P, F, c, k } = D; bgFill(D);
    const tf = titleFit(D, c.title, W - M * 2, U * 0.13 * k, 2); const cyT = M * 0.7 + U * 0.09 + (tf.L.length * tf.s) / 2;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, cyT + tf.L.length * tf.s * 0.5 + U * 0.14); ctx.clip(); ctx.fillStyle = rgba(P.accent, 0.11); const n = 28, r = Math.max(W, H);
    for (let i = 0; i < n; i++) { const a0 = (i * 2 * Math.PI) / n, a1 = a0 + Math.PI / n; ctx.beginPath(); ctx.moveTo(W / 2, cyT); ctx.arc(W / 2, cyT, r, a0, a1); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    let y = M * 0.7; y = txt(D, '★  ' + String(c.name || '').toUpperCase() + '  ★', W / 2, y, W - M * 2, (s) => bf(F, s, true), U * 0.03 * Math.max(0.8, k), P.ink, { track: 0.1, lh: 1.6, hit: ['text', 'name'] });
    const off = U * 0.008; title(D, c.title, W / 2 + off, y + off, W - M * 2, U * 0.13 * k, P.ink, { lines: 2, lh: 0.98 }); y = title(D, c.title, W / 2, y, W - M * 2, U * 0.13 * k, P.accent, { lines: 2, lh: 0.98 });
    y = txt(D, String(c.date || '').toUpperCase(), W / 2, y + U * 0.01, W - M * 2, (s) => bf(F, s, true), U * 0.026, P.ink, { track: 0.14, lh: 1.6, hit: ['text', 'date'] });
    if (c.tagline) y = txt(D, c.tagline, W / 2, y, W - M * 2, (s) => 'italic ' + bf(F, s), U * 0.024, P.soft, { lh: 1.5, hit: ['text', 'tagline'] });
    const bh = badges(D, M, y + U * 0.01, W - M * 2, {}, true); if (bh) { badges(D, M, y + U * 0.01, W - M * 2); y += bh + U * 0.035; }
    ctx.strokeStyle = P.ink; ctx.lineWidth = 3; rr(ctx, M * 0.4, M * 0.4, W - M * 0.8, H - M * 0.8, U * 0.012); ctx.stroke();
    return body(D, M, y + U * 0.02, W - M * 2, H - M * 0.8, { special: { bg: P.surface, line: P.ink }, list: { style: 'pill', catColor: P.ink }, ruleColor: P.ink });
  }
  function tTicket(D) {
    const { ctx, W, H, U, M, P, F, c, k, s } = D;
    ctx.fillStyle = P.bg2; ctx.fillRect(0, 0, W, H); pattern(D, 'grain', P.ink, 0, 0, W, H);
    const pw = Math.min(W - M * 1.2, W / H > 1.3 ? W * 0.62 : W), x = (W - pw) / 2, y0 = M * 0.45, y1 = H - M * 0.45, t = U * 0.018;
    const paper = () => { ctx.beginPath(); ctx.moveTo(x, y0 + t); for (let xx = x; xx < x + pw; xx += t * 2) { ctx.lineTo(xx + t, y0); ctx.lineTo(Math.min(xx + t * 2, x + pw), y0 + t); } ctx.lineTo(x + pw, y1 - t); for (let xx = x + pw; xx > x; xx -= t * 2) { ctx.lineTo(xx - t, y1); ctx.lineTo(Math.max(xx - t * 2, x), y1 - t); } ctx.closePath(); };
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = U * 0.03 * s; ctx.shadowOffsetY = U * 0.01 * s; ctx.fillStyle = P.surface; paper(); ctx.fill(); ctx.restore();
    const ink = P.surfInk, iw = pw - U * 0.1, ix = x + U * 0.05; const dash = (yy) => { ctx.save(); ctx.setLineDash([U * 0.012, U * 0.009]); hline(ctx, ix, yy, ix + iw, rgba(ink, 0.55), 2); ctx.restore(); };
    let y = head(D, W / 2, y0 + U * 0.05, iw, { ink, caps: true, ns: 0.034, L: 0.085, title: ink, ts: 0.085, dateCaps: true, badge: { bg: ink, fg: P.surface } });
    dash(y + U * 0.005); y += U * 0.03;
    const bars = U * 0.055, r = body(D, ix, y, iw, y1 - U * 0.04 - bars, { special: { ink, bg: rgba(ink, 0.05), line: rgba(ink, 0.5), dash: true }, list: { style: 'leader', ink, leader: rgba(ink, 0.45) }, foot: { ink, soft: rgba(ink, 0.72), icon: P.accent }, ruleColor: rgba(ink, 0.4) });
    const R = rnd(5); let bx = x + pw / 2 - U * 0.16; const by = y1 - U * 0.035 - bars; ctx.fillStyle = ink; while (bx < x + pw / 2 + U * 0.16) { const bw = (1 + Math.floor(R() * 3)) * U * 0.0035; ctx.fillRect(bx, by, bw, bars * 0.8); bx += bw + (1 + Math.floor(R() * 2)) * U * 0.0035; }
    return r;
  }
  function tGlass(D) {
    const { ctx, W, H, U, M, P, c, A } = D; const pic = A.photo || A.bg;
    if (pic) { cover(ctx, pic, 0, 0, W, H); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, 0, W, H); hit(D, 0, 0, W, H, 'photos'); } else { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, P.accent); g.addColorStop(1, P.bg); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); pattern(D, 'waves', P.ink, 0, 0, W, H); }
    const px = M * 0.6, py = M * 0.6, pw = W - M * 1.2, ph = H - M * 1.2;
    ctx.fillStyle = rgba(P.bg, 0.84); rr(ctx, px, py, pw, ph, U * 0.035); ctx.fill(); ctx.strokeStyle = rgba(P.ink, 0.25); ctx.lineWidth = 2; ctx.stroke();
    const y = head(D, W / 2, py + U * 0.05, pw - U * 0.12, { ns: 0.04, L: 0.09 });
    return body(D, px + U * 0.06, y + U * 0.01, pw - U * 0.12, py + ph - U * 0.05, { special: { photo: false }, list: { style: 'leader', cat: 'head' } });
  }
  function tTiles(D) {
    const { ctx, W, H, U, M, P, F, c, k, A } = D; bgFill(D); const iw = W - M * 2, L = U * 0.085; let y = M * 0.8;
    if (c.showLogo !== false && (A.logo || true)) logo(D, W - M - L / 2, y + L / 2, L / 2);
    txt(D, String(c.name || '').toUpperCase(), M, y + L / 2 - U * 0.016, iw - L - U * 0.03, (s) => bf(F, s, true), U * 0.028, P.accent, { align: 'left', track: 0.14, hit: ['text', 'name'] });
    y += L + U * 0.02 * k; y = title(D, c.title, M, y, iw, U * 0.115 * k, P.ink, { align: 'left', lines: 2, lh: 0.98 });
    y = txt(D, c.date, M, y, iw, (s) => bf(F, s), U * 0.027, P.soft, { align: 'left', lh: 1.6, hit: ['text', 'date'] });
    const bh = badges(D, M, y, iw, { align: 'left' }, true); if (bh) { badges(D, M, y, iw, { align: 'left' }); y += bh + U * 0.03; }
    y += U * 0.015;
    return body(D, M, y, iw, H - M * 0.8, { special: { bg: P.accent, ink: P.onAccent, accent: P.onAccent, stroke: false }, list: { style: 'card', cardBg: P.surface === P.bg ? rgba(P.ink, 0.06) : P.surface, catRule: true }, foot: { align: 'left' } });
  }
  function tArch(D) {
    const { ctx, W, H, U, M, P, k } = D; bgFill(D); const x = M * 0.7, w = W - M * 1.4, y = M * 0.6, h = H - y - M * 0.6, r = Math.min(w / 2, h * 0.3);
    ctx.fillStyle = P.surface; rrTop(ctx, x, y, w, h, r); ctx.fill();
    ctx.strokeStyle = P.accent; ctx.lineWidth = 2; rrTop(ctx, x + U * 0.018, y + U * 0.018, w - U * 0.036, h - U * 0.018, Math.max(0, r - U * 0.018)); ctx.stroke();
    const ink = P.surfInk; const yy = head(D, W / 2, y + r * 0.24 + U * 0.02, Math.min(w * 0.78, w - U * 0.12), { ink, ns: 0.036, L: 0.085, ts: 0.1 });
    return body(D, x + U * 0.06, yy + U * 0.01, w - U * 0.12, y + h - U * 0.04, { special: { ink, bg: rgba(P.accent, 0.08), stroke: false }, list: { style: 'center', ink, cat: 'head' }, foot: { ink, soft: rgba(ink, 0.72) }, ruleColor: rgba(P.accent, 0.5) });
  }

  const TEMPLATES = {
    classic: { name: 'Classic', palette: 'green', fonts: 'classic', bgStyle: 'gradient', draw: tClassic },
    elegant: { name: 'Elegant', palette: 'cream', fonts: 'elegant', bgStyle: 'gradient', draw: tElegant },
    bold: { name: 'Bold banner', palette: 'tomato', fonts: 'bold', bgStyle: 'solid', draw: tBold },
    photo: { name: 'Photo', palette: 'night', fonts: 'modern', bgStyle: 'solid', draw: tPhoto },
    split: { name: 'Split', palette: 'ocean', fonts: 'strong', bgStyle: 'solid', draw: tSplit },
    chalk: { name: 'Chalkboard', palette: 'chalk', fonts: 'chalk', bgStyle: 'grain', draw: tChalk },
    street: { name: 'Street food', palette: 'sunshine', fonts: 'fun', bgStyle: 'solid', draw: tStreet },
    minimal: { name: 'Minimal', palette: 'mono', fonts: 'modern', bgStyle: 'solid', draw: tMinimal },
    kente: { name: 'Kente', palette: 'kente', fonts: 'strong', bgStyle: 'solid', draw: tKente },
    card: { name: 'Menu card', palette: 'royal', fonts: 'classic', bgStyle: 'dots', draw: tCard },
    diagonal: { name: 'Diagonal', palette: 'plantain', fonts: 'bold', bgStyle: 'solid', draw: tDiagonal },
    plate: { name: 'Plate', palette: 'tomato', fonts: 'elegant', bgStyle: 'solid', draw: tPlate },
    magazine: { name: 'Magazine', palette: 'cream', fonts: 'classic', bgStyle: 'solid', draw: tMagazine },
    neon: { name: 'Neon', palette: 'neon', fonts: 'neon', bgStyle: 'grain', draw: tNeon },
    tropical: { name: 'Tropical', palette: 'tropic', fonts: 'fun', bgStyle: 'gradient', draw: tTropical },
    sunburst: { name: 'Sunburst', palette: 'retro', fonts: 'retro', bgStyle: 'solid', draw: tSunburst },
    ticket: { name: 'Ticket', palette: 'paper', fonts: 'mono', bgStyle: 'grain', draw: tTicket },
    glass: { name: 'Glass', palette: 'night', fonts: 'elegant', bgStyle: 'solid', draw: tGlass },
    tiles: { name: 'Tiles', palette: 'fresh', fonts: 'modern', bgStyle: 'solid', draw: tTiles },
    arch: { name: 'Arch', palette: 'rose', fonts: 'script', bgStyle: 'gradient', draw: tArch },
  };

  /* ---------- fonts, images, the QR code, rendering ---------- */
  let fontsReady = null; // the stylesheet must be in before document.fonts knows the faces
  async function ensureFonts(F) {
    if (!fontsReady) fontsReady = new Promise((ok) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONT_CSS; l.onload = ok; l.onerror = ok; setTimeout(ok, 4000); document.head.appendChild(l); });
    await fontsReady;
    try { await Promise.race([Promise.all([document.fonts.load(hf(F, 40), 'Aa'), document.fonts.load(bf(F, 20), 'Aa'), document.fonts.load(bf(F, 20, true), 'Aa')]), new Promise((ok) => setTimeout(ok, 2500))]); } catch (e) { }
  }
  const imgs = new Map();
  function loadImg(src) {
    if (!src) return Promise.resolve(null); if (imgs.has(src)) return imgs.get(src);
    const p = new Promise((ok) => { const i = new Image(); if (/^https?:/.test(src) && !src.startsWith(location.origin)) i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
    imgs.set(src, p); return p;
  }
  let qrMemo = { url: '', q: null };
  function qrOf(url) { if (!url || !window.qrcode) return null; if (qrMemo.url !== url) { try { const q = qrcode(0, 'M'); q.addData(url); q.make(); qrMemo = { url, q }; } catch (e) { qrMemo = { url, q: null }; } } return qrMemo.q; }
  async function draw(cv, c, scale = 1) {
    const F = FONTS[c.fonts] || FONTS.modern; await ensureFonts(F);
    const [logoI, photo, bg] = await Promise.all([loadImg(c.logo), loadImg(c.photoSrc), loadImg(c.bgSrc)]);
    const A = { logo: logoI, photo, bg, qr: c.qr ? qrOf(c.url) : null };
    // the biggest header that leaves the dishes comfortably readable; else the best balance of dish text and header (or, when not
    // everything fits, the most dishes shown)
    const KS = [1, 0.88, 0.77, 0.67, 0.58, 0.5], good = (U0) => U0 * 0.029; let best = null, bestK = 1, U0 = 0;
    for (const k of KS) {
      const r = render(cv, c, A, k, scale); U0 = r.U;
      if (r.fits && r.fsz >= good(U0)) return r;
      const score = r.fits ? 1e6 + (Math.min(r.fsz, good(U0)) / good(U0)) * 2 + k : r.shown * 1000 + r.fsz; // comfortable dish text first, then a big header
      if (!best || score > best.score) { best = Object.assign({ score }, r); bestK = k; }
    }
    return bestK === KS[KS.length - 1] ? best : render(cv, c, A, bestK, scale);
  }
  function render(cv, c, A, k, scale) {
    const Z = SIZES[c.size] || SIZES.square; cv.width = Math.round(Z.w * scale); cv.height = Math.round(Z.h * scale);
    const ctx = cv.getContext('2d'); ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.textBaseline = 'alphabetic';
    const W = Z.w, H = Z.h, U = Math.min(W, H);
    const D = { ctx, W, H, U, M: Math.round(U * 0.07), P: pal(c), F: FONTS[c.fonts] || FONTS.modern, c, A, k, s: scale, hits: [] };
    const r = (TEMPLATES[c.template] || TEMPLATES.classic).draw(D) || {};
    if (scale === 1 || !c._hits) c._hits = D.hits;
    return { fits: r.fits !== false, fsz: r.fsz || U, U, shown: r.shown || 0, more: r.more || 0 };
  }

  /* ---------- the studio ---------- */
  const KEY = () => 'aahsso-flyer-' + ((K.info && K.info.tenant && K.info.tenant.id) || '');
  const KEEP = ['template', 'palette', 'fonts', 'bgStyle', 'custom', 'size', 'title', 'prices', 'cats', 'showLogo', 'link', 'qr', 'badges', 'badgeText', 'overlay', 'photoSrc', 'bgSrc', 'name', 'tagline', 'address', 'phones', 'hours', 'ig', 'fb', 'note'];
  const CONTACTS = ['phones', 'hours', 'ig', 'fb', 'note'];
  const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(KEY()) || 'null') || {}; } catch (e) { return {}; } };
  const today = () => (KC.venueClock(S()) || {}).date || todayStr();
  const dateLine = () => new Date(today() + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const pickKeys = (o, keys) => { const r = {}; keys.forEach((k) => { if (o[k] !== undefined) r[k] = o[k]; }); return r; };
  function savePrefs(c) {
    const o = Object.assign(pickKeys(c, KEEP), { extra: { date: today(), items: c.extra }, pick: { date: today(), ids: [...c.pick] }, special: { date: today(), id: c.special } });
    try { localStorage.setItem(KEY(), JSON.stringify(o)); } catch (e) { try { localStorage.setItem(KEY(), JSON.stringify(Object.assign(o, { photoSrc: /^data:/.test(o.photoSrc || '') ? '' : o.photoSrc, bgSrc: '' }))); } catch (e2) { } }
  }
  const SVG = (d) => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const TABS = [
    ['templates', 'Designs', 'M4 4h7v7H4z M13 4h7v4h-7z M13 10h7v10h-7z M4 13h7v7H4z'],
    ['dishes', 'Dishes', 'M4 7h16 M4 12h16 M4 17h10'],
    ['text', 'Text', 'M5 6.5V4.5h14v2 M12 4.5v15 M9 19.5h6'],
    ['contacts', 'Contact', ICON.phone],
    ['style', 'Colours', 'M12 3a9 9 0 100 18c1.1 0 1.6-.8 1.6-1.6 0-1.1-.9-1.4-.9-2.4 0-.8.7-1.5 1.6-1.5H17a4 4 0 004-4C21 6.9 17 3 12 3z M7.5 11.5h.01 M10 7.5h.01 M14.5 7.5h.01'],
    ['fonts', 'Fonts', 'M3 19L8 5l5 14 M4.8 14h6.4 M17.5 19a2.8 2.8 0 110-5.6 2.8 2.8 0 010 5.6z M20.3 13.4V19'],
    ['photos', 'Photos', 'M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M15.5 9.5h.01'],
    ['extras', 'Stickers', ICON.star],
  ];

  function open() {
    const s = S(); const pref = loadPrefs(); const sf = s.flyer || {}; const day = today();
    const menu = rMenu().filter((m) => m.active !== false && !m.soldOut);
    const food = menu.filter((m) => KC.stationOf(m, venue()) === 'kitchen');
    const url = s.menuSlug || s.menuKey ? menuLink() : '';
    const legacy = { green: 'green', red: 'red', night: 'night', fresh: 'fresh' }[pref.theme];
    const c = Object.assign({
      template: 'classic', palette: legacy || 'green', fonts: legacy ? 'modern' : 'classic', bgStyle: 'gradient', custom: null, size: 'square', title: "Today's menu",
      prices: true, cats: true, showLogo: true, link: !!url, qr: false, badges: [], badgeText: '', overlay: 0.6, photoSrc: '', bgSrc: '',
      name: s.businessName || '', tagline: s.tagline || '', address: s.address || '',
      phones: sf.phones && sf.phones.length ? sf.phones : [{ n: s.phone || '', t: 'both' }], hours: sf.hours || '', ig: sf.ig || '', fb: sf.fb || '', note: sf.note || '',
    }, pickKeys(pref, KEEP));
    if (!Array.isArray(c.phones) || !c.phones.length) c.phones = [{ n: '', t: 'both' }];
    c.phones = c.phones.slice(0, 3).map((p) => ({ n: String((p && p.n) || ''), t: ['call', 'wa', 'both'].includes(p && p.t) ? p.t : 'both' }));
    Object.assign(c, { date: dateLine(), logo: s.logo || '', url, urlShort: url.replace(/^https?:\/\//, ''), items: [] });
    c.extra = pref.extra && pref.extra.date === day ? pref.extra.items || [] : [];
    c.pick = new Set(pref.pick && pref.pick.date === day ? pref.pick.ids : (food.length ? food : menu).slice(0, 10).map((m) => m.id).concat(c.extra.map((x) => x.id)));
    c.special = pref.special && pref.special.date === day ? pref.special.id || '' : '';
    let tab = 'templates';
    const all = () => menu.concat(c.extra);
    const catsNow = () => [...new Set((S().menuCats || []).concat(all().map((m) => m.category || 'Other')))].filter((ct) => all().some((m) => (m.category || 'Other') === ct));
    const sync = () => { const cats = catsNow(); c.items = all().filter((m) => c.pick.has(m.id)).sort((a, b) => cats.indexOf(a.category || 'Other') - cats.indexOf(b.category || 'Other')).map((m) => ({ id: m.id, name: m.name, price: m.extra ? num(m.price) : KC.menuPrice(m, S(), new Date(), false), category: m.category || 'Other', photo: m.photo || '' })); if (c.special && !c.pick.has(c.special)) c.special = ''; };

    const sh = openSheet({ title: 'Menu flyer studio', wide: true, body: '' }); sh.classList.add('fl-sheet');
    setSheetBody(sh, '<div class="fs">' +
      '<div class="fs-bar"><button type="button" class="icon-btn" data-act="undo" aria-label="Undo" title="Undo">' + ic('undo') + '</button><button type="button" class="icon-btn fs-redo" data-act="redo" aria-label="Redo" title="Redo">' + ic('undo') + '</button>' +
        '<div class="fs-sizes" role="radiogroup" aria-label="Size">' + Object.entries(SIZES).map(([k, z]) => '<button type="button" role="radio" class="fs-chip" data-act="size" data-v="' + k + '" title="' + esc(z.hint) + '"><i class="fs-ar" style="aspect-ratio:' + z.w + '/' + z.h + '"></i>' + esc(z.name) + '</button>').join('') + '</div></div>' +
      '<div class="fs-stage"><div class="fs-cv"><canvas id="flCv" aria-label="Preview of the flyer — tap a part to edit it"></canvas></div><div class="fs-tip">Tap any part of the flyer to edit it</div></div>' +
      '<div class="fs-panel" id="flPanel"></div>' +
      '<nav class="fs-tabs" role="tablist" aria-label="Design tools">' + TABS.map(([k, l, d]) => '<button type="button" role="tab" class="fs-tab" data-tab="' + k + '">' + SVG(d) + '<span>' + l + '</span></button>').join('') + '</nav></div>');
    const foot = document.createElement('div'); foot.className = 'sf'; foot.innerHTML = '<button class="btn" data-a="sheetClose">Close</button>' + (navigator.canShare ? '<button class="btn grow" id="flShare">' + ic('wa', 'sm') + 'Share</button>' : '') + '<button class="btn pri grow" id="flDl">' + ic('dl', 'sm') + 'Download PNG</button>'; sh.querySelector('.sheet').appendChild(foot);
    const cv = $('#flCv', sh), panel = $('#flPanel', sh);

    /* panels */
    const chip = (act, v, label, on, extra = '') => '<button type="button" class="fs-chip' + (on ? ' on' : '') + '" data-act="' + act + '" data-v="' + esc(v) + '"' + extra + '>' + label + '</button>';
    const tin = (k, label, attrs = '') => field(label, '<input class="inp" data-k="' + k + '" value="' + esc(c[k] ?? '') + '" ' + attrs + '>');
    const tog = (k, label) => '<label class="toggle"><input type="checkbox" data-k="' + k + '"' + (c[k] !== false && c[k] ? ' checked' : '') + '>' + label + '</label>';
    const itemsHtml = () => {
      const cats = catsNow(); if (!all().length) return '<div class="empty small">No dishes yet — add today\'s dishes below.</div>';
      return cats.map((ct) => '<div class="fl-cat">' + esc(ct) + '</div>' + all().filter((m) => (m.category || 'Other') === ct).map((m) => '<label class="fl-it"><input type="checkbox" data-it="' + esc(m.id) + '"' + (c.pick.has(m.id) ? ' checked' : '') + '><span class="grow">' + esc(m.name) + (m.extra ? ' <span class="fl-x">today only</span>' : '') + '</span><b class="money">' + fmt(m.price) + '</b>' + (m.extra ? '<button type="button" class="icon-btn" data-act="xrm" data-v="' + esc(m.id) + '" aria-label="Remove ' + esc(m.name) + '">' + ic('x', 'sm') + '</button>' : '') + '</label>').join('')).join('');
    };
    const spOpts = () => '<option value="">None</option>' + c.items.map((x) => '<option value="' + esc(x.id) + '"' + (c.special === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
    const PANELS = {
      templates: () => '<div class="fs-h">Choose a design</div><div class="fs-tpls">' + Object.entries(TEMPLATES).map(([k, t]) => '<button type="button" class="fs-tpl' + (c.template === k ? ' on' : '') + '" data-act="tpl" data-v="' + k + '" aria-label="' + esc(t.name) + '"><canvas data-thumb="' + k + '" style="aspect-ratio:' + (SIZES[c.size] || SIZES.square).w + '/' + (SIZES[c.size] || SIZES.square).h + '"></canvas><span>' + esc(t.name) + '</span></button>').join('') + '</div><div class="hint">A design brings its own colours and fonts — change them under Colours and Fonts.</div>',
      dishes: () => '<div class="row between"><div class="fs-h" style="margin:0">Today\'s dishes · <span id="flN">' + c.pick.size + '</span></div><span class="row gap6"><button type="button" class="btn sm ghost" data-act="allD">All</button><button type="button" class="btn sm ghost" data-act="noneD">None</button></span></div>' +
        '<div class="fl-items" id="flItems">' + itemsHtml() + '</div>' +
        '<div class="fl-add"><div class="fs-h" style="margin:0 0 6px">Add a dish for today</div><div class="fl-add-r"><input class="inp" id="flXn" placeholder="e.g. Ndomba de poisson" maxlength="60" aria-label="Dish"><input class="inp" id="flXp" inputmode="numeric" placeholder="Price" aria-label="Price"><select class="inp" id="flXc" aria-label="Category">' + [...new Set((S().menuCats || []).concat(catsNow()).concat(['Other']))].map((ct) => '<option>' + esc(ct) + '</option>').join('') + '</select><button type="button" class="btn pri" data-act="xadd">' + ic('plus', 'sm') + 'Add</button></div>' +
          (can('menu') ? '<label class="check fl-add-m"><input type="checkbox" id="flXmenu">Also add it to my menu</label>' : '') + '</div>' +
        field('Dish of the day (optional)', '<select class="inp" data-k="special" id="flSp">' + spOpts() + '</select>') + '<div class="fs-tg">' + tog('prices', 'Show prices') + tog('cats', 'Show categories') + '</div>',
      text: () => tin('title', 'Title', 'maxlength="40"') + '<div class="fs-chips">' + TITLES.map((t) => chip('title', t, esc(t), c.title === t)).join('') + '</div>' +
        tin('date', 'Date line', 'maxlength="50"') + tin('name', 'Business name', 'maxlength="60"') + tin('tagline', 'Tagline', 'maxlength="70" placeholder="e.g. Home cooking since 2010"') +
        tin('note', 'Line above your contacts', 'maxlength="70" placeholder="e.g. Delivery available — order on WhatsApp"'),
      contacts: () => '<div class="fs-h">Phone numbers</div>' + c.phones.map((p, i) => '<div class="fs-ph"><input class="inp" data-pn="' + i + '" value="' + esc(p.n) + '" inputmode="tel" autocomplete="tel" placeholder="e.g. 6 77 12 34 56" aria-label="Phone number ' + (i + 1) + '"><div class="seg sm" role="radiogroup" aria-label="Number ' + (i + 1) + ' is for">' + [['call', 'Call'], ['wa', 'WhatsApp'], ['both', 'Both']].map(([v, l]) => '<button type="button" class="' + (p.t === v ? 'on' : '') + '" data-act="ptype" data-i="' + i + '" data-v="' + v + '">' + l + '</button>').join('') + '</div>' + (c.phones.length > 1 ? '<button type="button" class="icon-btn" data-act="rmPhone" data-i="' + i + '" aria-label="Remove number ' + (i + 1) + '">' + ic('x', 'sm') + '</button>' : '') + '</div>').join('') +
        (c.phones.length < 3 ? '<button type="button" class="btn sm" data-act="addPhone">' + ic('plus', 'sm') + 'Add a number</button>' : '') +
        '<div class="fs-h">Where and when</div>' + tin('address', 'Address', 'maxlength="80" placeholder="e.g. Bonapriso, Douala"') + tin('hours', 'Opening hours', 'maxlength="60" placeholder="e.g. Every day · 10:00 – 23:00"') +
        '<div class="grid2">' + tin('ig', 'Instagram', 'maxlength="40" placeholder="@yourplace"') + tin('fb', 'Facebook', 'maxlength="50" placeholder="Your page"') + '</div>' +
        (c.url ? '<div class="fs-tg">' + tog('qr', 'QR code to the menu') + tog('link', 'Menu link (' + esc(c.urlShort) + ')') + '</div>' : '<div class="hint">Turn on your menu link (Menu → Menu link) to put a QR code on the flyer.</div>') +
        '<div class="hint">Your numbers, hours and pages are kept for next time.</div>',
      style: () => { const P = pal(c); return '<div class="fs-h">Colour palettes</div><div class="fs-pals">' + Object.entries(PALETTES).map(([k, p]) => '<button type="button" class="fs-pal' + (c.palette === k && !c.custom ? ' on' : '') + '" data-act="pal" data-v="' + k + '" title="' + esc(p.name) + '"><span class="sw" style="background:linear-gradient(135deg,' + p.bg + ',' + p.bg2 + ')"><i style="background:' + p.accent + '"></i><i style="background:' + p.ink + '"></i></span><small>' + esc(p.name) + '</small></button>').join('') + '</div>' +
        '<div class="fs-h">Your own colours</div><div class="fs-cols">' + [['bg', 'Background'], ['ink', 'Text'], ['accent', 'Accent']].map(([k, l]) => '<label class="fs-col"><input type="color" data-col="' + k + '" value="' + P[k] + '"><span>' + l + '</span></label>').join('') + (c.custom ? '<button type="button" class="btn sm ghost" data-act="resetCol">Reset</button>' : '') + '</div>' +
        '<div class="fs-h">Background</div><div class="fs-chips">' + BGS.map(([k, l]) => chip('bgs', k, l, c.bgStyle === k)).join('') + '</div>'; },
      fonts: () => '<div class="fs-h">Font pairing</div><div class="fs-fonts">' + Object.entries(FONTS).map(([k, f]) => '<button type="button" class="fs-font' + (c.fonts === k ? ' on' : '') + '" data-act="font" data-v="' + k + '"><b style="font-family:\'' + f.head + '\',Georgia,serif;font-weight:' + f.hw + ';font-style:' + (f.hs || 'normal') + '">' + (f.caps ? "TODAY'S MENU" : "Today's menu") + '</b><span style="font-family:\'' + f.body + '\',system-ui">' + esc(f.name) + ' · Ndolè 3 500 F</span></button>').join('') + '</div>',
      photos: () => { const withPh = menu.filter((m) => m.photo); const up = /^data:/.test(c.photoSrc || '');
        return '<div class="fs-h">Logo</div>' + (c.logo ? '<div class="fs-tg">' + tog('showLogo', 'Show my logo') + '</div>' : '<div class="hint">Add your logo in Settings → Business to put it on the flyer.</div><div class="fs-tg">' + tog('showLogo', 'Show my initials instead') + '</div>') +
        '<div class="fs-h">Feature photo</div><div class="hint">Shown big in the photo designs (Photo, Bold banner, Street food, Plate, Glass), next to the dish of the day in the others.</div><div class="fs-photos">' +
          '<button type="button" class="fs-pho none' + (!c.photoSrc ? ' on' : '') + '" data-act="photo" data-v="">None</button>' +
          withPh.map((m) => { const src = imgSrc(m.photo); return '<button type="button" class="fs-pho' + (c.photoSrc === src ? ' on' : '') + '" data-act="photo" data-v="' + esc(src) + '" title="' + esc(m.name) + '"><img src="' + esc(src) + '" alt=""><small>' + esc(m.name) + '</small></button>'; }).join('') +
          (up ? '<button type="button" class="fs-pho on" data-act="photo" data-v="' + esc(c.photoSrc) + '"><img src="' + esc(c.photoSrc) + '" alt=""><small>Your photo</small></button>' : '') +
          '<button type="button" class="fs-pho add" data-act="upPhoto">' + ic('cam') + '<small>Upload</small></button></div>' +
        '<div class="fs-h">Background photo</div><div class="row wrap gap6"><button type="button" class="btn sm" data-act="upBg">' + ic('up', 'sm') + (c.bgSrc ? 'Change photo' : 'Add a photo') + '</button>' + (c.bgSrc ? '<button type="button" class="btn sm ghost" data-act="rmBg">Remove</button>' : '') + '</div>' +
          (c.bgSrc ? field('Darken the photo so the text reads well', '<input type="range" data-k="overlay" min="0.2" max="0.9" step="0.05" value="' + (c.overlay ?? 0.6) + '">') : '<div class="hint">Used behind most designs (not Photo, Chalkboard, Ticket).</div>'); },
      extras: () => '<div class="fs-h">Stickers</div><div class="fs-chips">' + Object.entries(BADGES).map(([k, b]) => chip('badge', k, esc(b[1]), (c.badges || []).includes(k))).join('') + '</div>' + tin('badgeText', 'Your own sticker', 'maxlength="28" placeholder="e.g. -10% today · Free drink"'),
    };
    const renderPanel = () => {
      panel.innerHTML = '<div class="fs-p">' + PANELS[tab]() + '</div>';
      sh.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
      if (tab === 'templates') thumbs();
    };
    const marks = () => { sh.querySelectorAll('.fs-sizes [data-v]').forEach((b) => { b.classList.toggle('on', b.dataset.v === c.size); b.setAttribute('aria-checked', b.dataset.v === c.size); }); $('[data-act=undo]', sh).disabled = hi <= 0; $('[data-act=redo]', sh).disabled = hi >= hist.length - 1; };

    /* drawing, thumbnails, history */
    let t1, t2, thumbTok = 0;
    const tip = (r) => { const el = $('.fs-tip', sh); if (!el || !r) return; el.classList.toggle('warn', !!r.more); el.textContent = r.more ? '⚠ ' + r.more + ' dish' + (r.more === 1 ? ' does' : 'es do') + ' not fit — try ' + (c.size === 'story' ? 'fewer details' : 'the Portrait or Status size') : 'Tap any part of the flyer to edit it'; };
    const redraw = () => { clearTimeout(t1); t1 = setTimeout(() => draw(cv, c).then(tip), 50); };
    async function thumbs() {
      const tok = ++thumbTok;
      for (const [k, T] of Object.entries(TEMPLATES)) {
        const el = panel.querySelector('[data-thumb="' + k + '"]'); if (!el || tok !== thumbTok) return;
        const cc = Object.assign({}, c, k === c.template ? {} : { template: k, palette: T.palette, fonts: T.fonts, bgStyle: T.bgStyle, custom: null });
        const off = document.createElement('canvas'); await draw(off, cc, 0.26); if (tok !== thumbTok) return;
        el.width = off.width; el.height = off.height; el.getContext('2d').drawImage(off, 0, 0);
      }
    }
    const thumbsSoon = () => { if (tab !== 'templates') return; clearTimeout(t2); t2 = setTimeout(thumbs, 600); };
    const snap = () => JSON.stringify(Object.assign(pickKeys(c, KEEP), { pick: [...c.pick], special: c.special, extra: c.extra, date: c.date }));
    let hist = [snap()], hi = 0, tc;
    const commit = () => { clearTimeout(tc); tc = setTimeout(() => { const v = snap(); if (v === hist[hi]) return; hist = hist.slice(0, hi + 1); hist.push(v); if (hist.length > 80) hist.shift(); hi = hist.length - 1; marks(); savePrefs(c); }, 350); };
    const restore = () => { clearTimeout(tc); const o = JSON.parse(hist[hi]); Object.assign(c, o); c.pick = new Set(o.pick); sync(); renderPanel(); marks(); redraw(); savePrefs(c); };
    const changed = (panelToo) => { sync(); if (panelToo) renderPanel(); redraw(); commit(); thumbsSoon(); };

    /* events */
    sh.addEventListener('input', (e) => {
      const t = e.target, d = t.dataset;
      if (d.it) { if (t.checked) c.pick.add(d.it); else c.pick.delete(d.it); sync(); const sp = $('#flSp', sh); if (sp) sp.innerHTML = spOpts(); const n = $('#flN', sh); if (n) n.textContent = c.pick.size; }
      else if (d.k) {
        c[d.k] = t.type === 'checkbox' ? t.checked : t.type === 'range' ? Number(t.value) : t.value;
        if (d.k === 'special' && c.special && !c.photoSrc) { const it = c.items.find((x) => x.id === c.special); if (it && it.photo) c.photoSrc = imgSrc(it.photo); } // the dish of the day's own photo
        if (d.k === 'qr' && c.qr && !window.qrcode) loadScript(QR_JS).then(redraw).catch((er) => toast(er.message, true));
        if (d.k === 'title') sh.querySelectorAll('[data-act=title]').forEach((b) => b.classList.toggle('on', b.dataset.v === c.title));
      } else if (d.pn != null) c.phones[+d.pn].n = t.value;
      else if (d.col) c.custom = Object.assign({}, c.custom, { [d.col]: t.value });
      else return;
      changed(false);
    });
    sh.addEventListener('click', async (e) => {
      const tb = e.target.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; renderPanel(); panel.scrollTop = 0; return; }
      const b = e.target.closest('[data-act]'); if (!b) return; const v = b.dataset.v, i = +b.dataset.i;
      switch (b.dataset.act) {
        case 'undo': if (hi > 0) { hi--; restore(); } return;
        case 'redo': if (hi < hist.length - 1) { hi++; restore(); } return;
        case 'size': c.size = v; marks(); return changed(tab === 'templates');
        case 'tpl': { const T = TEMPLATES[v]; Object.assign(c, { template: v, palette: T.palette, fonts: T.fonts, bgStyle: T.bgStyle, custom: null }); sh.querySelectorAll('.fs-tpl').forEach((x) => x.classList.toggle('on', x.dataset.v === v)); return changed(false); }
        case 'pal': Object.assign(c, { palette: v, custom: null }); return changed(true);
        case 'resetCol': c.custom = null; return changed(true);
        case 'bgs': c.bgStyle = v; return changed(true);
        case 'font': c.fonts = v; return changed(true);
        case 'title': c.title = v; { const el = $('[data-k=title]', sh); if (el) el.value = v; } sh.querySelectorAll('[data-act=title]').forEach((x) => x.classList.toggle('on', x.dataset.v === v)); return changed(false);
        case 'badge': c.badges = (c.badges || []).includes(v) ? c.badges.filter((x) => x !== v) : (c.badges || []).concat(v); return changed(true);
        case 'ptype': c.phones[i].t = v; return changed(true);
        case 'addPhone': c.phones.push({ n: '', t: 'call' }); changed(true); { const el = sh.querySelector('[data-pn="' + (c.phones.length - 1) + '"]'); if (el) el.focus(); } return;
        case 'rmPhone': c.phones.splice(i, 1); return changed(true);
        case 'photo': c.photoSrc = v; return changed(true);
        case 'upPhoto': case 'upBg': {
          const f = await chooseFile('image/*'); if (!f) return;
          try { const r = await resizeImage(f, 1600, 0.85); if (b.dataset.act === 'upPhoto') c.photoSrc = r.dataUrl; else c.bgSrc = r.dataUrl; } catch (er) { return toast(er.message, true); }
          return changed(true);
        }
        case 'rmBg': c.bgSrc = ''; return changed(true);
        case 'allD': all().forEach((m) => c.pick.add(m.id)); return changed(true);
        case 'noneD': c.pick.clear(); return changed(true);
        case 'xrm': e.preventDefault(); c.extra = c.extra.filter((x) => x.id !== v); c.pick.delete(v); return changed(true);
        case 'xadd': {
          const name = $('#flXn', sh).value.trim(), price = num($('#flXp', sh).value), category = $('#flXc', sh).value || 'Other';
          if (name.length < 2) { toast('Type the dish', true); return $('#flXn', sh).focus(); }
          if (!(price > 0)) { toast('Type the price', true); return $('#flXp', sh).focus(); }
          if (all().some((m) => m.name.trim().toLowerCase() === name.toLowerCase())) return toast(name + ' is already in the list — tick it', true);
          let id = 'fx_' + Date.now().toString(36);
          if ($('#flXmenu', sh) && $('#flXmenu', sh).checked) { const m = { id: uid('mn_'), name, price, category, kind: 'plain', uses: [], active: true }; if (!(await save('menu', m))) return; menu.push(m); id = m.id; toast(name + ' added to your menu'); }
          else c.extra.push({ id, name, price, category, extra: true });
          c.pick.add(id); changed(true); const xn = $('#flXn', sh); if (xn) xn.focus(); return;
        }
      }
    });
    sh.addEventListener('keydown', (e) => {
      if (e.target.id === 'flXn' && e.key === 'Enter') { e.preventDefault(); $('#flXp', sh).focus(); }
      else if (e.target.id === 'flXp' && e.key === 'Enter') { e.preventDefault(); sh.querySelector('[data-act=xadd]').click(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.preventDefault(); sh.querySelector(e.shiftKey ? '[data-act=redo]' : '[data-act=undo]').click(); }
    });
    cv.addEventListener('click', (e) => { // tap a part of the flyer → its tool
      const r = cv.getBoundingClientRect(), Z = SIZES[c.size] || SIZES.square; const x = ((e.clientX - r.left) / r.width) * Z.w, y = ((e.clientY - r.top) / r.height) * Z.h;
      const h = (c._hits || []).filter((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h).sort((a, b) => a.w * a.h - b.w * b.h)[0]; if (!h) return;
      tab = h.tab; renderPanel(); panel.scrollTop = 0;
      const el = h.field && panel.querySelector('[data-k="' + h.field + '"]'); if (el) { el.focus(); if (el.select && el.tagName === 'INPUT') el.select(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      panel.classList.remove('flash'); void panel.offsetWidth; panel.classList.add('flash');
    });

    /* export */
    const fname = () => 'Menu-' + (c.name || 'today').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') + '-' + today() + '.png';
    const keepContacts = () => { savePrefs(c); const f = pickKeys(c, CONTACTS); if (can('settings') && JSON.stringify(f) !== JSON.stringify(pickKeys(S().flyer || {}, CONTACTS))) saveSettings({ flyer: f }).catch(() => { }); };
    const blob = async () => { const off = document.createElement('canvas'); await draw(off, c, (SIZES[c.size] || {}).x || 1); keepContacts(); return new Promise((ok) => { try { off.toBlob(ok, 'image/png'); } catch (e) { ok(null); } }); };
    $('#flDl', foot).onclick = async () => { const b = await blob(); if (!b) return toast('Could not make the image — try another photo', true); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = fname(); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Flyer saved — ' + fname()); };
    if ($('#flShare', foot)) $('#flShare', foot).onclick = async () => { const b = await blob(); if (!b) return toast('Could not make the image — try another photo', true); const f = new File([b], fname(), { type: 'image/png' }); if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: c.title, text: c.title + ' — ' + c.name }); } catch (e) { } } else toast('This phone cannot share images — use Download', true); };

    sync(); renderPanel(); marks(); draw(cv, c).then(tip);
    if (c.qr && c.url) loadScript(QR_JS).then(redraw).catch(() => { });
  }
  return { open, draw, TEMPLATES, PALETTES, FONTS, SIZES };
})();
A.flyer = () => Flyer.open();
