// Result: green / yellow (5-minute recheck timer) / red (full-screen, Call 911).
// Never says "you're fine".
import { getCheck } from '../store.js';
import { renderRed } from './redscreen.js';
import { DOMAINS, DOMAIN_LABEL } from './detectors.js';
import { badge, esc, fmtDateTime, isDemoMode } from './ui.js';

const WAIT_MS = 5 * 60 * 1000;

function domainList(score) {
  const d = (score && score.domains) || {};
  return `<ul class="list">${DOMAINS.map((k) => `<li><strong>${DOMAIN_LABEL[k]}</strong> ${badge(d[k] || 'none')}</li>`).join('')}</ul>`;
}
function notes(check) {
  const n = [];
  if (check.simulated) n.push('<span class="demo-tag">Simulated</span> Made-up numbers for the demo — not a real check.');
  if (check.demoStroke) n.push('<span class="demo-tag">Demo control</span> “Simulate stroke signs” was on: the numbers were changed on purpose.');
  if (check.score && check.score.fallback) n.push('<span class="demo-tag">Fallback scoring</span> The main scoring module was unavailable; a simpler built-in rule was used.');
  return n.length ? `<div class="demo-box small">${n.map((x) => `<p>${x}</p>`).join('')}</div>` : '';
}

export function render(el, { params }) {
  const check = getCheck(params.id);
  if (!check) {
    el.innerHTML = `<section class="card"><h1>Result not found</h1><a class="btn" href="#/">Go home</a></section>`;
    return;
  }
  const score = check.score || { level: 'yellow', reasons: ['No score saved'] };
  const reasons = score.reasons || [];

  if (score.level === 'red') {
    return renderRed(el, {
      title: 'Clearly different from your usual',
      lead: 'Call 911 now. These can be signs of a stroke. Every minute counts.',
      reasons,
      emergencyAt: check.emergencyAt,
      extra: notes(check).replace('demo-box', 'panel'),
    });
  }

  if (score.level === 'yellow') {
    let timer = null;
    el.innerHTML = `<section class="result-hero lv-yellow card">
        <span class="hero-icon" aria-hidden="true">!</span>
        <h1>Yellow — a bit different from your usual</h1>
        <p style="font-size:1.15rem"><strong>Sit down and rest for 5 minutes, then redo the check.</strong></p>
        ${reasons.length ? `<p>What looked different:</p><ul>${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        <p>If you notice <strong>any sudden</strong> weakness, numbness, face droop, trouble speaking or seeing, or loss of balance — don't wait: call 911.</p>
        <a class="call911 onlight" href="tel:911"><span aria-hidden="true">☎</span> Call 911</a>
      </section>
      <section class="card">
        <h2 style="margin-top:0">Recheck in 5 minutes</h2>
        <p class="stat" id="tLeft" aria-live="polite">5:00</p>
        <div class="btn-row">
          <button class="btn" id="startT">Start 5-minute timer</button>
          <a class="btn secondary hidden" id="redo" href="#/check?recheck=${encodeURIComponent(check.id)}">Redo check now</a>
          ${isDemoMode() ? '<button class="btn ghost" id="skipT">Skip wait (demo)</button>' : ''}
        </div>
        <p class="muted small">If the recheck is also different, SteadyCheck will tell you to call 911.</p>
      </section>
      <section class="card"><h2 style="margin-top:0">By sign</h2>${domainList(score)}<p class="muted small">Checked ${esc(fmtDateTime(check.at))}</p>${notes(check)}</section>`;
    const tLeft = el.querySelector('#tLeft'), redo = el.querySelector('#redo');
    const done = () => { clearInterval(timer); tLeft.textContent = 'Time to recheck'; redo.classList.remove('hidden'); redo.focus(); };
    el.querySelector('#startT').onclick = (e) => {
      e.target.disabled = true;
      const end = Date.now() + WAIT_MS;
      timer = setInterval(() => {
        const left = end - Date.now();
        if (left <= 0) return done();
        tLeft.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
      }, 250);
    };
    const skip = el.querySelector('#skipT');
    if (skip) skip.onclick = done;
    return () => clearInterval(timer);
  }

  // green
  el.innerHTML = `<section class="result-hero lv-green card">
      <span class="hero-icon" aria-hidden="true">✓</span>
      <h1>Green — same as your usual</h1>
      <p>Today's check looked like your normal. A check can't rule out a stroke: if you feel something is wrong, call 911.</p>
    </section>
    <section class="card"><h2 style="margin-top:0">By sign</h2>${domainList(score)}
      <p class="muted small">Checked ${esc(fmtDateTime(check.at))}. Your family can see this result.</p>${notes(check)}</section>
    <div class="btn-row"><a class="btn" href="#/">Home</a><a class="btn secondary" href="#/log">Log blood pressure</a></div>`;
}
