/* Aahsso — small charts for the reports, no library: columns, a trend line (with the previous period), a donut and a
 * week × hour heat map. HTML + CSS (and a little SVG), so they work offline, follow the app's colours and stay readable on
 * a phone. Every bar / point / cell has a tooltip with its exact value. */
const Charts = (() => {
  const nice = (v) => { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };
  const short = (v) => { const a = Math.abs(v); return a >= 1e6 ? +(v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e3 ? +(v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : String(Math.round(v)); };
  const none = (msg) => '<div class="muted small ch-none">' + esc(msg || 'No data for this period.') + '</div>';
  const yAxis = (top) => '<div class="ch-y" aria-hidden="true">' + [1, 0.5, 0].map((t) => '<span style="bottom:' + t * 100 + '%">' + short(top * t) + '</span>').join('') + '</div>';
  const grid = '<i class="ch-g" style="bottom:100%"></i><i class="ch-g" style="bottom:50%"></i><i class="ch-g ch-g0" style="bottom:0"></i>';
  const xLabels = (rows, max) => { const every = Math.max(1, Math.ceil(rows.length / (max || 12))); return '<div class="ch-x" aria-hidden="true">' + rows.map((r, i) => '<span>' + (i % every ? '' : esc(r.label)) + '</span>').join('') + '</div>'; };

  /** columns: rows [{label, value, tip?}] — the highest is highlighted and labelled */
  function columns(rows, o = {}) {
    if (!rows.length || !rows.some((r) => r.value > 0)) return none(o.empty);
    const f = o.fmt || fmt; const top = nice(Math.max(...rows.map((r) => r.value)));
    const hi = rows.reduce((b, r, i) => (r.value > rows[b].value ? i : b), 0);
    return '<div class="ch ch-cols" role="img" aria-label="' + esc(o.title || 'Chart') + '">' + yAxis(top) + '<div class="ch-main"><div class="ch-plot">' + grid +
      rows.map((r, i) => '<div class="ch-c' + (i === hi ? ' hi' : '') + '" title="' + esc(r.label + ': ' + f(r.value) + (r.tip ? ' · ' + r.tip : '')) + '"><b style="height:' + Math.max(0, r.value / top * 100) + '%">' + (i === hi ? '<em>' + esc(short(r.value)) + '</em>' : '') + '</b></div>').join('') +
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
    const hits = '<div class="ch-hits">' + rows.map((r, i) => '<span title="' + esc(r.label + ': ' + f(r.value) + (prev ? ' · before: ' + f(prev[i].value) : '')) + '">' + (i === best ? '<i class="ch-dot" style="bottom:' + (r.value / top * 100) + '%"></i>' : '') + '</span>').join('') + '</div>';
    return '<div class="ch ch-trend" role="img" aria-label="' + esc(o.title || 'Trend') + '">' + yAxis(top) + '<div class="ch-main"><div class="ch-plot">' + grid + svg + hits + '</div>' + xLabels(rows, o.maxLabels) + '</div></div>' +
      (prev ? '<div class="ch-key"><span><i class="ch-k1"></i>' + esc(o.nowLabel || 'This period') + '</span><span><i class="ch-k2"></i>' + esc(o.prevLabel || 'Period before') + '</span></div>' : '');
  }
  const COLORS = ['var(--brand)', 'var(--accent)', 'var(--info)', 'var(--ok)', '#8b5cf6', '#ec4899', 'var(--warn)', 'var(--bad)', '#64748b'];
  /** a donut with its legend: parts [{label, value}] (the small ones become "Other") */
  function donut(parts, o = {}) {
    const f = o.fmt || fmt; let ps = parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
    if (!ps.length) return none(o.empty);
    if (ps.length > 7) { const rest = ps.slice(6).reduce((a, p) => a + p.value, 0); ps = ps.slice(0, 6).concat([{ label: 'Other', value: rest }]); }
    const tot = ps.reduce((a, p) => a + p.value, 0); let at = 0;
    const arcs = ps.map((p, i) => { const pc = (p.value / tot) * 100; const s = '<circle r="15.9155" cx="21" cy="21" fill="none" stroke="' + COLORS[i % COLORS.length] + '" stroke-width="6" stroke-dasharray="' + Math.max(0, pc - (ps.length > 1 ? 0.6 : 0)).toFixed(2) + ' ' + (100 - pc + (ps.length > 1 ? 0.6 : 0)).toFixed(2) + '" stroke-dashoffset="' + (25 - at).toFixed(2) + '"><title>' + esc(p.label + ': ' + f(p.value) + ' (' + Math.round(pc) + '%)') + '</title></circle>'; at += pc; return s; }).join('');
    return '<div class="ch-donut"><svg viewBox="0 0 42 42" role="img" aria-label="' + esc(o.title || 'Share') + '"><circle r="15.9155" cx="21" cy="21" fill="none" stroke="var(--line2)" stroke-width="6"/>' + arcs +
      '<text x="21" y="20.5" class="ch-dt">' + esc(short(tot)) + '</text><text x="21" y="25.5" class="ch-ds">' + esc(o.centre || 'total') + '</text></svg>' +
      '<div class="ch-legend">' + ps.map((p, i) => '<div class="ch-li"><i style="background:' + COLORS[i % COLORS.length] + '"></i><span class="ellipsis">' + esc(p.label) + '</span><b class="money">' + esc(f(p.value)) + '</b><span class="muted">' + Math.round((p.value / tot) * 100) + '%</span></div>').join('') + '</div></div>';
  }
  /** a heat map: cells[row][col] numbers; rowLabels (e.g. Mon…Sun), colLabels (e.g. hours) */
  function heat(cells, rowLabels, colLabels, o = {}) {
    const f = o.fmt || fmt; const max = Math.max(0, ...cells.flat()); if (!max) return none(o.empty);
    const every = o.every || 3; const nc = colLabels.length;
    return '<div class="ch-heat" style="--nc:' + nc + '" role="img" aria-label="' + esc(o.title || 'Busy times') + '"><span></span>' + colLabels.map((c, j) => '<span class="ch-hx">' + (j % every ? '' : esc(c)) + '</span>').join('') +
      cells.map((row, i) => '<span class="ch-hy">' + esc(rowLabels[i]) + '</span>' + row.map((v, j) => '<i style="--a:' + (v ? (0.12 + 0.88 * v / max).toFixed(3) : 0) + '" title="' + esc(rowLabels[i] + ' ' + colLabels[j] + ': ' + (v ? f(v) : 'nothing')) + '"></i>').join('')).join('') +
      '</div><div class="ch-hk"><span>Quiet</span><i></i><span>Busiest</span></div>';
  }
  return { columns, trend, donut, heat, short };
})();
