// Reusable pieces: today's meds checklist, BP entry form, BP chart.
import { load, toggleDose, doseFor, addBP } from '../store.js';
import { esc, fmtDateTime, toast } from './ui.js';
import { lineChart } from './charts.js';

export function mountMeds(container, onChange) {
  const draw = () => {
    const meds = load().profile.meds || [];
    if (!meds.length) { container.innerHTML = '<p class="muted">No medicines saved. <a href="#/setup">Add them in Settings</a>.</p>'; return; }
    const items = [];
    for (const m of meds) for (const t of (m.times && m.times.length ? m.times : [''])) items.push({ m, t });
    items.sort((a, b) => a.t.localeCompare(b.t));
    container.innerHTML = items.map(({ m, t }) => {
      const taken = !!doseFor(m.id, t);
      return `<button class="med-btn ${taken ? 'taken' : ''}" data-med="${esc(m.id)}" data-slot="${esc(t)}" aria-pressed="${taken}">
        <span class="box" aria-hidden="true">${taken ? '✓' : ''}</span>
        <span><strong>${esc(m.name)}</strong> ${esc(m.dose || '')}<br><span class="small muted">${t ? esc(t) + ' · ' : ''}${taken ? 'Taken ✓' : 'Tap when taken'}</span></span>
      </button>`;
    }).join('');
    container.querySelectorAll('.med-btn').forEach((b) => (b.onclick = () => { toggleDose(b.dataset.med, b.dataset.slot); draw(); onChange && onChange(); }));
  };
  draw();
}

export function bpCategory(sys, dia) {
  if (sys >= 180 || dia >= 120) return { word: 'Very high', note: 'Very high. If you also have headache, chest pain, weakness or trouble speaking, call 911. Otherwise rest 5 minutes, measure again, and call your doctor today.', level: 'red' };
  if (sys >= 130 || dia >= 80) return { word: 'Above target', note: 'Above the 130/80 target.', level: 'yellow' };
  return { word: 'At target', note: 'Within the 130/80 target.', level: 'green' };
}

export function mountBPForm(container, onSaved) {
  container.innerHTML = `<form class="bpform" novalidate>
    <div class="row">
      <div><label for="sys">Top number</label><input id="sys" type="number" inputmode="numeric" min="60" max="260" placeholder="e.g. 132" required></div>
      <div><label for="dia">Bottom number</label><input id="dia" type="number" inputmode="numeric" min="30" max="160" placeholder="e.g. 84" required></div>
      <div><label for="pulse">Pulse <span class="muted small">(optional)</span></label><input id="pulse" type="number" inputmode="numeric" min="30" max="220" placeholder="e.g. 72"></div>
      <button class="btn" type="submit">Save</button>
    </div>
    <p class="bpmsg" aria-live="polite"></p>
  </form>`;
  const f = container.querySelector('form');
  f.onsubmit = (e) => {
    e.preventDefault();
    const sys = +f.sys.value, dia = +f.dia.value, pulse = f.pulse.value;
    const msg = f.querySelector('.bpmsg');
    if (!(sys >= 60 && sys <= 260 && dia >= 30 && dia <= 160)) { msg.textContent = 'Please enter both numbers (for example 132 and 84).'; return; }
    addBP(sys, dia, pulse);
    const c = bpCategory(sys, dia);
    msg.innerHTML = `Saved ${sys}/${dia}. <strong>${c.word}.</strong> ${c.level === 'red' ? esc(c.note) : ''}`;
    f.reset();
    toast(`Blood pressure ${sys}/${dia} saved`);
    onSaved && onSaved();
  };
}

export function bpChart(days = 14) {
  const bp = load().bp;
  const now = Date.now(), start = now - days * 864e5;
  const pts = bp.filter((r) => new Date(r.at).getTime() >= start);
  if (!pts.length) return '<p class="muted">No blood pressure readings in the last 14 days yet.</p>';
  const xs = (r) => (new Date(r.at).getTime() - start) / 864e5;
  const ys = pts.flatMap((r) => [r.sys, r.dia]);
  const yMin = Math.min(60, Math.floor(Math.min(...ys) / 10) * 10), yMax = Math.max(160, Math.ceil(Math.max(...ys) / 10) * 10);
  const yTicks = []; for (let v = yMin; v <= yMax; v += 20) yTicks.push(v);
  const xTicks = [];
  for (let i = 0; i <= days; i += days > 7 ? 2 : 1) {
    const d = new Date(start + i * 864e5);
    xTicks.push({ x: i, label: d.toLocaleDateString([], { month: 'numeric', day: 'numeric' }) });
  }
  return lineChart({
    xMin: 0, xMax: days, yMin, yMax, yTicks, xTicks, yTitle: 'mmHg',
    ariaLabel: `Blood pressure, last ${days} days, with 130/80 target lines`,
    series: [
      { name: 'Top (systolic)', color: 'var(--c-sys)', points: pts.map((r) => ({ x: xs(r), y: r.sys, label: `${r.sys}/${r.dia} · ${fmtDateTime(r.at)}` })) },
      { name: 'Bottom (diastolic)', color: 'var(--c-dia)', marker: 'square', points: pts.map((r) => ({ x: xs(r), y: r.dia, label: `${r.sys}/${r.dia} · ${fmtDateTime(r.at)}` })) },
    ],
    refLines: [
      { y: 130, label: 'Target top 130', color: 'var(--c-target)' },
      { y: 80, label: 'Target bottom 80', color: 'var(--c-target)' },
    ],
  });
}

export function bpSummary(days = 14) {
  const since = Date.now() - days * 864e5;
  const pts = load().bp.filter((r) => new Date(r.at).getTime() >= since);
  if (!pts.length) return null;
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  const above = pts.filter((r) => r.sys >= 130 || r.dia >= 80).length;
  return { n: pts.length, sys: avg(pts.map((r) => r.sys)), dia: avg(pts.map((r) => r.dia)), maxSys: Math.max(...pts.map((r) => r.sys)), abovePct: Math.round((above / pts.length) * 100), last: pts[pts.length - 1] };
}
