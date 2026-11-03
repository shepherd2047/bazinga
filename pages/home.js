import { load } from '../store.js';
import { badge, esc, fmtTime, isToday } from './ui.js';
import { mountMeds, mountBPForm, bpCategory } from './widgets.js';

export function render(el) {
  const s = load();
  const today = s.checks.filter((c) => isToday(c.at));
  const last = today[today.length - 1];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const lastBP = s.bp[s.bp.length - 1];

  el.innerHTML = `
    <h1>${greet}, ${esc(s.profile.name || 'there')}</h1>
    <div class="home-actions">
      <a class="btn big danger" href="#/emergency">Feeling something wrong right now?<span class="sub">Go straight to Call 911 — no test</span></a>
      <a class="btn big" href="#/check">Do my daily check<span class="sub">About 30 seconds · face and speech</span></a>
    </div>

    <section class="card">
      <h2 style="margin-top:0">Today</h2>
      ${!s.baseline ? '<p>No baseline yet. <a href="#/baseline">Record your normal first</a> so checks have something to compare to.</p>'
        : last ? `<p>Daily check at ${esc(fmtTime(last.at))}: ${badge(last.score && last.score.level)} <a href="#/result/${esc(last.id)}">See result</a></p>`
        : `<p>${badge('none')} Daily check not done yet today.</p>`}
      ${s.baseline && s.baseline.demo ? '<div class="warn">Your checks are compared to a <strong>made-up demo baseline</strong>. Record your own for real results.</div>' : ''}
      ${s.baseline ? `<div class="btn-row"><a class="btn ${s.baseline.demo ? '' : 'secondary'}" href="#/baseline">🎥 Record my baseline</a></div>` : ''}
    </section>

    <div class="grid2">
      <section class="card">
        <h2 style="margin-top:0">Medicines today</h2>
        <div id="meds"></div>
      </section>
      <section class="card">
        <h2 style="margin-top:0">Blood pressure</h2>
        ${lastBP ? `<p class="muted">Last: <strong>${lastBP.sys}/${lastBP.dia}</strong> ${badge(bpCategory(lastBP.sys, lastBP.dia).level, bpCategory(lastBP.sys, lastBP.dia).word)}</p>` : ''}
        <div id="bp"></div>
        <a href="#/log">See 14-day chart →</a>
      </section>
    </div>`;
  mountMeds(el.querySelector('#meds'));
  mountBPForm(el.querySelector('#bp'));
}
