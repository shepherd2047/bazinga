// Doctor summary: one printable page, plain language.
import { load, adherence } from '../store.js';
import { bpChart, bpSummary } from './widgets.js';
import { badge, esc, fmtDate, fmtDateTime, fmtTime } from './ui.js';

export function render(el) {
  const s = load();
  const since = Date.now() - 7 * 864e5;
  const wk = (a) => a.filter((x) => new Date(x.at).getTime() >= since);
  const checks = wk(s.checks), alerts = wk(s.alerts), ems = wk(s.emergencies);
  const bp = bpSummary(7);
  const adh = adherence(7);
  const counts = { green: 0, yellow: 0, red: 0 };
  checks.forEach((c) => { const l = c.score && c.score.level; if (counts[l] != null) counts[l]++; });

  el.innerHTML = `<div class="btn-row no-print"><button class="btn" id="print">Print / save as PDF</button></div>
    <section class="card">
      <h1>Weekly summary for ${esc(s.profile.name || 'patient')}</h1>
      <p class="muted">${esc(fmtDate(new Date(since).toISOString()))} – ${esc(fmtDate(new Date().toISOString()))}. Made by SteadyCheck from home readings. Not a diagnosis.</p>
    </section>
    <section class="card"><h2 style="margin-top:0">Blood pressure</h2>
      ${bp ? `<p>Average <strong>${bp.sys}/${bp.dia}</strong> mmHg over ${bp.n} home readings. Highest top number: ${bp.maxSys}. ${bp.abovePct}% of readings were above the 130/80 target.</p>` : '<p>No readings this week.</p>'}
      ${bpChart(7)}
    </section>
    <section class="card"><h2 style="margin-top:0">Medicines</h2>
      <p>${adh == null ? 'No medicines listed.' : `<strong>${adh}%</strong> of scheduled doses were marked as taken this week.`}</p>
      <ul>${(s.profile.meds || []).map((m) => `<li>${esc(m.name)} ${esc(m.dose)} — ${esc((m.times || []).join(', '))}</li>`).join('')}</ul>
    </section>
    <section class="card"><h2 style="margin-top:0">Daily face / speech / arm checks</h2>
      <p>${checks.length} checks this week: ${counts.green} same as usual, ${counts.yellow} a bit different, ${counts.red} clearly different. Each check compares the person to their own recorded baseline${s.baseline ? ` (recorded ${esc(fmtDate(s.baseline.createdAt))})` : ''}.</p>
      ${s.baseline && s.baseline.residualConfirmed ? `<p><strong>Note for care team:</strong> at baseline the patient confirmed these are lasting effects since discharge, not new: ${esc(s.baseline.residualConfirmed.findings.join('; '))}.</p>` : ''}
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Result</th><th>What changed</th></tr></thead><tbody>
        ${checks.slice().reverse().map((c) => `<tr><td>${esc(fmtDateTime(c.at))}</td><td>${badge(c.score && c.score.level)}</td><td>${esc(((c.score && c.score.reasons) || []).join('; ') || '—')}${c.simulated ? ' (simulated demo data)' : ''}</td></tr>`).join('') || '<tr><td colspan="3">No checks</td></tr>'}
      </tbody></table></div>
    </section>
    <section class="card"><h2 style="margin-top:0">Alerts and emergencies</h2>
      <ul>${alerts.map((a) => `<li>${esc(fmtDateTime(a.at))} — ${esc(a.kind)}: ${esc(a.note || '')}</li>`).join('') || '<li>None</li>'}
      ${ems.map((e) => `<li>${esc(fmtDateTime(e.at))} — emergency screen opened; symptoms first noticed ${e.symptomNoticedAt ? esc(fmtTime(e.symptomNoticedAt)) : 'not recorded'}</li>`).join('')}</ul>
    </section>`;
  el.querySelector('#print').onclick = () => window.print();
}
