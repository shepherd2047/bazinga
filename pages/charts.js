// Dependency-free inline SVG line chart (no network needed on stage).
import { esc } from './ui.js';

export function lineChart({
  width = 640, height = 280, xMin, xMax, yMin, yMax, series = [], refLines = [],
  xTicks = [], yTicks = [], xTitle = '', yTitle = '', ariaLabel = 'Chart',
}) {
  const pad = { l: 52, r: 16, t: 16, b: 46 };
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const sx = (x) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * W;
  const sy = (y) => pad.t + H - ((y - yMin) / (yMax - yMin || 1)) * H;
  let g = '';
  for (const t of yTicks) g += `<line x1="${pad.l}" x2="${pad.l + W}" y1="${sy(t)}" y2="${sy(t)}" class="ch-grid"/><text x="${pad.l - 8}" y="${sy(t) + 5}" text-anchor="end" class="ch-tick">${t}</text>`;
  for (const t of xTicks) g += `<text x="${sx(t.x)}" y="${pad.t + H + 22}" text-anchor="middle" class="ch-tick">${esc(t.label)}</text>`;
  for (const r of refLines) {
    g += `<line x1="${pad.l}" x2="${pad.l + W}" y1="${sy(r.y)}" y2="${sy(r.y)}" stroke="${r.color}" stroke-width="2" stroke-dasharray="7 5"/>`;
    g += `<text x="${pad.l + W - 4}" y="${sy(r.y) - 6}" text-anchor="end" class="ch-ref" fill="${r.color}">${esc(r.label)}</text>`;
  }
  for (const s of series) {
    const pts = s.points.filter((p) => p.y != null && isFinite(p.y));
    if (!pts.length) continue;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="3" ${s.dash ? 'stroke-dasharray="4 4"' : ''}/>`;
    for (const p of pts) {
      const shape = s.marker === 'square'
        ? `<rect x="${sx(p.x) - 5}" y="${sy(p.y) - 5}" width="10" height="10" fill="${s.color}"/>`
        : `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="5" fill="${s.color}"/>`;
      g += `<g><title>${esc(s.name)}: ${esc(p.label ?? p.y)}</title>${shape}</g>`;
    }
  }
  if (xTitle) g += `<text x="${pad.l + W / 2}" y="${height - 4}" text-anchor="middle" class="ch-title">${esc(xTitle)}</text>`;
  if (yTitle) g += `<text x="14" y="${pad.t + H / 2}" text-anchor="middle" class="ch-title" transform="rotate(-90 14 ${pad.t + H / 2})">${esc(yTitle)}</text>`;
  const legend = series.map((s) => `<span class="lg"><span class="lg-sw ${s.marker === 'square' ? 'sq' : ''}" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('')
    + refLines.map((r) => `<span class="lg"><span class="lg-sw dash" style="border-color:${r.color}"></span>${esc(r.label)}</span>`).join('');
  return `<figure class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(ariaLabel)}" preserveAspectRatio="xMidYMid meet">${g}</svg><figcaption class="legend">${legend}</figcaption></figure>`;
}

export function niceTicks(min, max, n = 5) {
  const step = Math.pow(10, Math.floor(Math.log10((max - min) / n || 1)));
  const err = ((max - min) / n) / step;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  const st = mult * step; const out = [];
  for (let v = Math.ceil(min / st) * st; v <= max + 1e-9; v += st) out.push(+v.toFixed(6));
  return out;
}
