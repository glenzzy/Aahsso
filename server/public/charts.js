/* Aahsso — charts for the reports and the module pages, no library: HTML + CSS + a little SVG, so they work offline,
 * follow the app's colours (charts.css) and stay readable on a 360px phone and a POS touch screen.
 *   columns · trend · donut · heat (the first ones)  +  hbar · stacked · combo · kpi / kpis · spark · gauge
 * Every bar / point / slice / cell carries data-tip: tapping it shows the exact value in a small floating label
 * (one listener for the whole app), and title= keeps the hover text on a computer.
 * Colours: one series = the brand colour; several series = the categorical slots --cs1…--cs8 in a fixed order
 * (validated for colour-blind readers); green / amber / red are kept for good / warning / bad, never for a series. */
const Charts = (() => {
  const nice = (v) => { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };
  const short = (v) => { const a = Math.abs(v); return a >= 1e6 ? +(v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e3 ? +(v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : String(Math.round(v)); };
  const none = (msg) => '<div class="muted small ch-none">' + esc(msg || 'No data for this period.') + '</div>';
  const tip = (t) => ' data-tip="' + esc(t) + '" title="' + esc(t) + '"';
  const yAxis = (top) => '<div class="ch-y" aria-hidden="true">' + [1, 0.5, 0].map((t) => '<span style="bottom:' + t * 100 + '%">' + short(top * t) + '</span>').join('') + '</div>';
  const grid = '<i class="ch-g" style="bottom:100%"></i><i class="ch-g" style="bottom:50%"></i><i class="ch-g ch-g0" style="bottom:0"></i>';
  const xLabels = (rows, max) => { const every = Math.max(1, Math.ceil(rows.length / (max || 12))); return '<div class="ch-x" aria-hidden="true">' + rows.map((r, i) => '<span>' + (i % every ? '' : esc(r.label)) + '</span>').join('') + '</div>'; };
  const SLOTS = 8; const cs = (i) => 'var(--cs' + ((i % SLOTS) + 1) + ')';
  const legend = (keys) => '<div class="ch-key">' + keys.map((k, i) => '<span><i class="ch-sw" style="background:' + (k.color || cs(i)) + '"></i>' + esc(k.label) + '</span>').join('') + '</div>';

  /** columns: rows [{label, value, tip?}] — the highest is highlighted and labelled */
  function columns(rows, o = {}) {
    if (!rows.length || !rows.some((r) => r.value > 0)) return none(o.empty);
    const f = o.fmt || fmt; const top = nice(Math.max(...rows.map((r) => r.value)));
    const hi = rows.reduce((b, r, i) => (r.value > rows[b].value ? i : b), 0);
    return '<div class="ch ch-cols" role="img" aria-label="' + esc(o.title || 'Chart') + '">' + yAxis(top) + '<div class="ch-main"><div class="ch-plot">' + grid +
      rows.map((r, i) => '<div class="ch-c' + (i === hi ? ' hi' : '') + '"' + tip(r.label + ': ' + f(r.value) + (r.tip ? ' · ' + r.tip : '')) + '><b style="height:' + Math.max(0, r.value / top * 100) + '%">' + (i === hi ? '<em>' + esc(short(r.value)) + '</em>' : '') + '</b></div>').join('') +
      '</div>' + xLabels(rows, o.maxLabels) + '</div></div>';
  }
  /** a trend: rows [{label, value}], prev (same length, optional) drawn dashed — "this period vs the one before" */
  function trend(rows, o = {}) {
    if (!rows.length || !rows.some((r) => r.value > 0)) return none(o.empty);
    const f = o.fmt || fmt; const prev = o.prev && o.prev.length === rows.length ? o.prev : null;
    const top = nice(Math.max(...rows.map((r) => r.value), ...(prev || []).map((r) => r.value)));
    const W = 600, H = 200, n = rows.length; const X = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W), Y = (v) => H - (v / top) * H;
    const line = (rs) => rs.map((r, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(r.value).toFixed(1)).join(' ');
    const svg = '<svg class="ch-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + line(rows) + ' L' + X(n - 1) + ' ' + H + ' L' + X(0) + ' ' + H + ' Z" class="ch-area"/>' +
      (prev ? '<path d="' + line(prev) + '" class="ch-prev" vector-effect="non-scaling-stroke"/>' : '') +
      '<path d="' + line(rows) + '" class="ch-line" vector-effect="non-scaling-stroke"/></svg>';
    const best = rows.reduce((b, r, i) => (r.value > rows[b].value ? i : b), 0);
    const hits = '<div class="ch-hits">' + rows.map((r, i) => '<span' + tip(r.label + ': ' + f(r.value) + (prev ? ' · before: ' + f(prev[i].value) : '')) + '>' + (i === best ? '<i class="ch-dot" style="bottom:' + (r.value / top * 100) + '%"></i>' : '') + '</span>').join('') + '</div>';
    return '<div class="ch ch-trend" role="img" aria-label="' + esc(o.title || 'Trend') + '">' + yAxis(top) + '<div class="ch-main"><div class="ch-plot">' + grid + svg + hits + '</div>' + xLabels(rows, o.maxLabels) + '</div></div>' +
      (prev ? '<div class="ch-key"><span><i class="ch-k1"></i>' + esc(o.nowLabel || 'This period') + '</span><span><i class="ch-k2"></i>' + esc(o.prevLabel || 'Period before') + '</span></div>' : '');
  }
  /** a donut with its legend: parts [{label, value}] (past 6, the small ones become "Other") */
  function donut(parts, o = {}) {
    const f = o.fmt || fmt; let ps = parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
    if (!ps.length) return none(o.empty);
    if (ps.length > 7) { const rest = ps.slice(6).reduce((a, p) => a + p.value, 0); ps = ps.slice(0, 6).concat([{ label: 'Other', value: rest, other: true }]); }
    const tot = ps.reduce((a, p) => a + p.value, 0); let at = 0;
    const col = (p, i) => (p.other ? 'var(--cs-other)' : cs(i));
    const arcs = ps.map((p, i) => { const pc = (p.value / tot) * 100; const t = p.label + ': ' + f(p.value) + ' (' + Math.round(pc) + '%)'; const s = '<circle r="15.9155" cx="21" cy="21" fill="none" stroke="' + col(p, i) + '" stroke-width="6" stroke-dasharray="' + Math.max(0, pc - (ps.length > 1 ? 0.6 : 0)).toFixed(2) + ' ' + (100 - pc + (ps.length > 1 ? 0.6 : 0)).toFixed(2) + '" stroke-dashoffset="' + (25 - at).toFixed(2) + '" data-tip="' + esc(t) + '"><title>' + esc(t) + '</title></circle>'; at += pc; return s; }).join('');
    return '<div class="ch-donut"><svg viewBox="0 0 42 42" role="img" aria-label="' + esc(o.title || 'Share') + '"><circle r="15.9155" cx="21" cy="21" fill="none" stroke="var(--line2)" stroke-width="6"/>' + arcs +
      '<text x="21" y="21.6" class="ch-dt" font-size="' + (short(tot).length > 4 ? 5.2 : 6) + '" font-weight="800">' + esc(short(tot)) + '</text><text x="21" y="26" class="ch-ds" font-size="2.6" font-weight="600">' + esc(String(o.centre || 'total').slice(0, 10)) + '</text></svg>' +
      '<div class="ch-legend">' + ps.map((p, i) => '<div class="ch-li"' + tip(p.label + ': ' + f(p.value)) + '><i style="background:' + col(p, i) + '"></i><span class="ellipsis">' + esc(p.label) + '</span><b class="money">' + esc(f(p.value)) + '</b><span class="muted">' + Math.round((p.value / tot) * 100) + '%</span></div>').join('') + '</div></div>';
  }
  /** a heat map: cells[row][col] numbers; rowLabels (e.g. Mon…Sun), colLabels (e.g. hours) */
  function heat(cells, rowLabels, colLabels, o = {}) {
    const f = o.fmt || fmt; const max = Math.max(0, ...cells.flat()); if (!max) return none(o.empty);
    const every = o.every || 3; const nc = colLabels.length;
    return '<div class="ch-heat" style="--nc:' + nc + '" role="img" aria-label="' + esc(o.title || 'Busy times') + '"><span></span>' + colLabels.map((c, j) => '<span class="ch-hx">' + (j % every ? '' : esc(c)) + '</span>').join('') +
      cells.map((row, i) => '<span class="ch-hy">' + esc(rowLabels[i]) + '</span>' + row.map((v, j) => '<i style="--a:' + (v ? (0.12 + 0.88 * v / max).toFixed(3) : 0) + '"' + tip(rowLabels[i] + ' ' + colLabels[j] + ': ' + (v ? f(v) : 'nothing')) + '></i>').join('')).join('') +
      '</div><div class="ch-hk"><span>Quiet</span><i></i><span>Busiest</span></div>';
  }

  /** ranked horizontal bars: rows [{label, value, sub?, tip?}] — the first (biggest) in the accent colour, values at the end.
   *  o: { fmt, max (rows shown, default 8), tone: 'bad' (owed / losses) , empty } */
  function hbar(rows, o = {}) {
    const f = o.fmt || fmt; const rs = rows.filter((r) => r.value > 0).slice(0, o.max || 8);
    if (!rs.length) return none(o.empty);
    const top = Math.max(...rs.map((r) => r.value));
    return '<div class="ch-hb' + (o.tone ? ' t-' + o.tone : '') + '" role="list">' + rs.map((r, i) => '<div class="ch-hr' + (i === 0 ? ' hi' : '') + '" role="listitem"' + tip(r.label + ': ' + f(r.value) + (r.tip ? ' · ' + r.tip : '')) + '>' +
      '<div class="ch-hl"><span class="ellipsis">' + esc(r.label) + '</span>' + (r.sub ? '<span class="ch-hs ellipsis">' + esc(r.sub) + '</span>' : '') + '</div>' +
      '<div class="ch-ht"><i style="width:' + Math.max(1.5, r.value / top * 100).toFixed(1) + '%"></i></div><b class="ch-hv money">' + esc(f(r.value)) + '</b></div>').join('') + '</div>';
  }
  /** stacked columns: rows [{label, parts: {key: value}}], keys [{key, label, color?}] — e.g. cash / MoMo / OM per day */
  function stacked(rows, keys, o = {}) {
    const f = o.fmt || fmt; const tot = (r) => keys.reduce((a, k) => a + Math.max(0, num(r.parts[k.key])), 0);
    if (!rows.length || !rows.some((r) => tot(r) > 0)) return none(o.empty);
    const top = nice(Math.max(...rows.map(tot)));
    return '<div class="ch ch-cols ch-stk" role="img" aria-label="' + esc(o.title || 'Chart') + '">' + yAxis(top) + '<div class="ch-main"><div class="ch-plot">' + grid +
      rows.map((r) => { const t = tot(r); return '<div class="ch-c"' + tip(r.label + ': ' + f(t) + (t ? ' — ' + keys.filter((k) => num(r.parts[k.key]) > 0).map((k) => k.label + ' ' + f(num(r.parts[k.key]))).join(', ') : '')) + '><b class="ch-sb" style="height:' + (t / top * 100) + '%">' +
        keys.map((k, i) => { const v = Math.max(0, num(r.parts[k.key])); return v ? '<span style="flex:' + v + ';background:' + (k.color || cs(i)) + '"></span>' : ''; }).reverse().join('') + '</b></div>'; }).join('') +
      '</div>' + xLabels(rows, o.maxLabels) + '</div></div>' + legend(keys);
  }
  /** columns + a line on ONE scale (same unit, e.g. sales and profit in F) — never two axes */
  function combo(rows, o = {}) {
    if (!rows.length || !rows.some((r) => r.a > 0 || r.b > 0)) return none(o.empty);
    const f = o.fmt || fmt; const top = nice(Math.max(...rows.map((r) => Math.max(r.a || 0, r.b || 0))));
    const n = rows.length, W = 600, H = 200; const X = (i) => ((i + 0.5) / n) * W, Y = (v) => H - (Math.max(0, v) / top) * H;
    const line = rows.map((r, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(r.b || 0).toFixed(1)).join(' ');
    return '<div class="ch ch-cols ch-combo" role="img" aria-label="' + esc(o.title || 'Chart') + '">' + yAxis(top) + '<div class="ch-main"><div class="ch-plot">' + grid +
      rows.map((r) => '<div class="ch-c"' + tip(r.label + ': ' + (o.aLabel || 'A') + ' ' + f(r.a || 0) + ' · ' + (o.bLabel || 'B') + ' ' + f(r.b || 0)) + '><b style="height:' + Math.max(0, (r.a || 0) / top * 100) + '%"></b></div>').join('') +
      '<svg class="ch-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + line + '" class="ch-line2" vector-effect="non-scaling-stroke"/></svg>' +
      '</div>' + xLabels(rows, o.maxLabels) + '</div></div>' +
      '<div class="ch-key"><span><i class="ch-sw" style="background:var(--cs-bar)"></i>' + esc(o.aLabel || 'A') + '</span><span><i class="ch-k3"></i>' + esc(o.bLabel || 'B') + '</span></div>';
  }
  /** a tiny line of the recent values (no axes) — inside a KPI tile */
  function spark(vals, o = {}) {
    const v = (vals || []).map((x) => num(x)); if (v.length < 2 || !v.some((x) => x)) return '';
    const W = 100, H = 28, mx = Math.max(...v), mn = Math.min(0, ...v), sp = mx - mn || 1;
    const pts = v.map((x, i) => (i / (v.length - 1) * W).toFixed(1) + ',' + (H - 2 - ((x - mn) / sp) * (H - 4)).toFixed(1));
    const lastY = +pts[pts.length - 1].split(',')[1]; // the last value: a round dot (HTML, so the stretched SVG does not squash it)
    return '<div class="ch-spark-w' + (o.tone ? ' t-' + o.tone : '') + '"><svg class="ch-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts.join(' ') + '" vector-effect="non-scaling-stroke"/></svg><i style="top:' + (lastY / H * 100).toFixed(1) + '%"></i></div>';
  }
  /** the change from the period before: ▲ 12% (green when it is good news, red when bad; downGood for costs, losses…) */
  function change(now, before, downGood) {
    if (!(before > 0)) return '';
    const p = (now - before) / before * 100; if (!isFinite(p)) return '';
    const up = p >= 0; const good = Math.abs(p) < 0.5 ? null : downGood ? !up : up;
    return '<span class="ch-chg ' + (good === null ? 'flat' : good ? 'good' : 'bad') + '">' + (Math.abs(p) < 0.5 ? '= ' : up ? '▲ ' : '▼ ') + Math.round(Math.abs(p)) + '%</span>';
  }
  /** a KPI tile: { label, value (text), now, prev (numbers, for the change), spark [numbers], sub, downGood, hero, tone } */
  function kpi(t) {
    return '<div class="ch-kpi card' + (t.hero ? ' hero' : '') + '"' + (t.tipText ? tip(t.tipText) : '') + '><div class="ch-kl">' + esc(t.label) + '</div><div class="ch-kv' + (t.tone ? ' t-' + t.tone : '') + '">' + t.value + '</div>' +
      '<div class="ch-ks">' + (t.prev !== undefined ? change(num(t.now), num(t.prev), t.downGood) : '') + (t.sub ? '<span class="ellipsis">' + t.sub + '</span>' : '') + '</div>' + (t.spark ? spark(t.spark, { tone: t.downGood ? 'cost' : '' }) : '') + '</div>';
  }
  const kpis = (list) => '<div class="ch-kpis">' + list.filter(Boolean).map(kpi).join('') + '</div>';
  /** progress / gauge: how far value is of max — { label, fmt, tone: 'ok'|'warn'|'bad'|'', sub, marker (0..1) } */
  function gauge(value, max, o = {}) {
    const f = o.fmt || fmt; const p = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    return '<div class="ch-gauge' + (o.tone ? ' t-' + o.tone : '') + '"' + tip((o.label ? o.label + ': ' : '') + f(value) + ' of ' + f(max) + ' (' + Math.round(p * 100) + '%)') + '>' +
      (o.label ? '<div class="ch-gl"><span class="ellipsis">' + esc(o.label) + '</span><b>' + Math.round(p * 100) + '%</b></div>' : '') +
      '<div class="ch-gt"><i style="width:' + (p * 100).toFixed(1) + '%"></i>' + (o.marker > 0 && o.marker < 1 ? '<em style="left:' + (o.marker * 100).toFixed(1) + '%"></em>' : '') + '</div>' +
      (o.sub ? '<div class="ch-gs">' + o.sub + '</div>' : '') + '</div>';
  }

  /* ---------- the floating value label: tap (phone / POS) or click a mark; hover keeps the title tooltip ---------- */
  let tipEl = null, tipFor = null;
  const hideTip = () => { if (tipEl) tipEl.hidden = true; if (tipFor) tipFor.classList.remove('ch-on'); tipFor = null; };
  function showTip(el) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'ch-tip'; tipEl.setAttribute('role', 'status'); document.body.appendChild(tipEl); }
    if (tipFor) tipFor.classList.remove('ch-on');
    tipFor = el; el.classList.add('ch-on'); tipEl.textContent = el.getAttribute('data-tip'); tipEl.hidden = false;
    const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = r.left + r.width / 2 - w / 2; x = Math.max(8, Math.min(innerWidth - w - 8, x));
    let y = r.top - h - 8; if (y < 8) y = r.bottom + 8;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      if (!el) return hideTip();
      if (el === tipFor) return hideTip();
      showTip(el);
    }, true);
    ['scroll', 'resize'].forEach((ev) => addEventListener(ev, hideTip, { passive: true, capture: true }));
    addEventListener('hashchange', hideTip);
  }
  return { columns, trend, donut, heat, hbar, stacked, combo, spark, change, kpi, kpis, gauge, short, hideTip };
})();
