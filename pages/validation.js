// Validation: dose-response from syntheticDroopSeries, false-alarm stats, CSV export.
import { load } from '../store.js';
import { loadModule, session } from './detectors.js';
import { lineChart, niceTicks } from './charts.js';
import { esc, download } from './ui.js';

const MM_STEPS = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10];

function normalizeSeries(raw) {
  // Accept: [number], [{mm, score|asym|value|...}], or { mm:[...], scores:[...] }
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((r, i) => {
      if (typeof r === 'number') return { x: MM_STEPS[i], y: r };
      const x = r.mm ?? r.droopMm ?? r.step ?? MM_STEPS[i];
      const y = r.score ?? r.asym ?? r.asymmetry ?? r.mouthAsym ?? r.mouthAsymRest ?? r.z ?? r.value
        ?? Object.values(r).find((v, k) => typeof v === 'number' && Object.keys(r)[k] !== 'mm');
      return { x, y };
    }).filter((p) => typeof p.y === 'number' && isFinite(p.y));
  }
  const xs = raw.mm || raw.mmSteps || MM_STEPS, ys = raw.scores || raw.asym || raw.values || [];
  return xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => typeof p.y === 'number');
}

function fallbackCSV(checks) {
  const cols = new Set();
  checks.forEach((c) => ['face', 'speech', 'arms'].forEach((d) => Object.keys((c[d] && c[d].metrics) || {}).forEach((m) => cols.add(`${d}.${m}`))));
  const head = ['id', 'at', 'level', 'simulated', ...cols];
  const rows = checks.map((c) => [c.id, c.at, c.score && c.score.level, !!c.simulated, ...[...cols].map((k) => { const [d, m] = k.split('.'); return c[d] && c[d].metrics ? c[d].metrics[m] ?? '' : ''; })]);
  return [head, ...rows].map((r) => r.join(',')).join('\n');
}

export async function render(el) {
  const s = load();
  const checks = s.checks;
  const nonGreen = checks.filter((c) => c.score && c.score.level !== 'green');
  const yellows = nonGreen.filter((c) => c.score.level === 'yellow').length;
  const reds = nonGreen.filter((c) => c.score.level === 'red').length;
  const rate = checks.length ? Math.round((nonGreen.length / checks.length) * 100) : 0;

  el.innerHTML = `<h1>Validation</h1>
    <p class="muted">For judges and clinicians: how the face score responds to a known amount of artificial droop, and how often it raised a flag on ordinary days. Early prototype — not clinically validated.</p>
    <section class="card"><h2 style="margin-top:0">Dose-response: artificial mouth droop</h2>
      <p class="small muted" id="drSrc"></p><div id="dr"><p>Loading…</p></div></section>
    <section class="card"><h2 style="margin-top:0">False alarms on ordinary days</h2>
      <p class="small muted">Every stored check is treated as a normal day (no real stroke happened). Any yellow or red is counted as a false alarm. Includes demo/simulated data if loaded.</p>
      <div class="stats">
        <div><div class="stat">${checks.length}</div>checks stored</div>
        <div><div class="stat">${yellows}</div>yellow (false alarm)</div>
        <div><div class="stat">${reds}</div>red (false alarm)</div>
        <div><div class="stat">${rate}%</div>flag rate</div>
      </div>
      <div class="btn-row"><button class="btn secondary" id="csv">Download checks as CSV</button></div>
    </section>`;

  const v = await loadModule('validation');
  el.querySelector('#csv').onclick = () => {
    let csv;
    try { csv = v && v.checksToCSV ? v.checksToCSV(checks) : fallbackCSV(checks); } catch (e) { console.warn(e); csv = fallbackCSV(checks); }
    download(`steadycheck-checks-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  const dr = el.querySelector('#dr'), src = el.querySelector('#drSrc');
  if (!v || !v.syntheticDroopSeries) { dr.innerHTML = '<div class="warn">Validation module (detect/validation.js) unavailable — chart cannot be drawn yet.</div>'; return; }
  const lm = session.lastFaceLandmarks;
  src.textContent = lm ? 'Using the face landmarks from your last check in this session (kept in memory only).' : 'No face captured this session — using the module\'s default face. Run a daily check first to use your own face.';
  let pts = [], raw = null;
  try { raw = await v.syntheticDroopSeries(lm, MM_STEPS, { W: 640, H: 480 }); pts = normalizeSeries(raw); }
  catch (e) { console.warn('syntheticDroopSeries failed', e); dr.innerHTML = `<div class="warn">Could not compute the series: ${esc(e.message)}</div>`; return; }
  if (!pts.length) { dr.innerHTML = '<div class="warn">The validation module returned no data.</div>'; return; }
  if (Array.isArray(raw) && raw[0] && 'zExcursion' in raw[0]) {
    const ser = (k) => raw.map((r) => ({ x: r.mm, y: r[k], label: `${r.mm} mm → z ${(+r[k]).toFixed(2)} (${r.level || ''})` }));
    const all = raw.flatMap((r) => [r.zExcursion, r.zRest, r.zSmileAsym]).filter(Number.isFinite);
    const yMin = Math.min(0, ...all), yMax = Math.max(6, ...all) * 1.05;
    dr.innerHTML = lineChart({
      xMin: 0, xMax: Math.max(...raw.map((r) => r.mm)), yMin, yMax,
      yTicks: niceTicks(yMin, yMax), xTicks: raw.filter((r) => Number.isInteger(r.mm)).map((r) => ({ x: r.mm, label: String(r.mm) })),
      xTitle: 'Artificial droop of one mouth corner (mm)', yTitle: 'Change vs baseline (z)',
      ariaLabel: 'Face score rises as artificial droop increases; yellow at 3, red at 5',
      series: [
        { name: 'Smile movement (zExcursion)', color: 'var(--c-sys)', points: ser('zExcursion') },
        { name: 'Mouth at rest (zRest)', color: 'var(--c-dia)', marker: 'square', points: ser('zRest') },
      ],
      refLines: [{ y: 3, label: 'Yellow at 3', color: 'var(--yellow-line)' }, { y: 5, label: 'Red at 5', color: 'var(--c-target)' }],
    }) + `<div class="table-wrap"><table><thead><tr><th>Droop (mm)</th><th>zRest</th><th>zSmileAsym</th><th>zExcursion</th><th>Level</th></tr></thead><tbody>${raw.map((r) => `<tr><td>${r.mm}</td><td>${(+r.zRest).toFixed(2)}</td><td>${(+r.zSmileAsym).toFixed(2)}</td><td>${(+r.zExcursion).toFixed(2)}</td><td>${esc(r.level || '')}</td></tr>`).join('')}</tbody></table></div>`;
    return;
  }
  const ys = pts.map((p) => p.y), yMin = Math.min(0, ...ys), yMax = Math.max(...ys) * 1.1 || 1;
  dr.innerHTML = lineChart({
    xMin: Math.min(...pts.map((p) => p.x)), xMax: Math.max(...pts.map((p) => p.x)), yMin, yMax,
    yTicks: niceTicks(yMin, yMax), xTicks: pts.map((p) => ({ x: p.x, label: String(p.x) })),
    xTitle: 'Artificial droop of one mouth corner (mm)', yTitle: 'Asymmetry score',
    ariaLabel: 'Asymmetry score rises as artificial droop increases',
    series: [{ name: 'Face asymmetry score', color: 'var(--c-sys)', points: pts.map((p) => ({ ...p, label: `${p.x} mm → ${(+p.y).toFixed(3)}` })) }],
  }) + `<div class="table-wrap"><table><thead><tr><th>Droop (mm)</th>${pts.map((p) => `<td>${p.x}</td>`).join('')}</tr></thead><tbody><tr><th>Score</th>${pts.map((p) => `<td>${(+p.y).toFixed(3)}</td>`).join('')}</tr></tbody></table></div>`;
}
