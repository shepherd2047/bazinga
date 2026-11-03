// Record baseline: run the check 2–3 times on a good day, then buildBaseline().
import { load, setBaseline } from '../store.js';
import { mountCheckFlow } from './checkflow.js';
import { buildBaselineSafe, DOMAINS, DOMAIN_LABEL } from './detectors.js';
import { esc, fmtDateTime, toast } from './ui.js';

const MAX_RUNS = 3, MIN_RUNS = 2;

export function render(el) {
  const runs = [];
  let flowCleanup = null;
  const existing = load().baseline;

  el.innerHTML = `<h1>Record your normal</h1>
    <section class="card">
      <p><strong>Why:</strong> everyone's face, voice and arms are a little different — especially after a stroke. SteadyCheck compares each daily check to <em>your</em> normal, not to other people.</p>
      <p>Do the check <strong>${MIN_RUNS}–${MAX_RUNS} times</strong> today, on a day you feel like your usual self. Take a short break between runs.</p>
      ${existing ? `<p class="muted small">A baseline already exists (from ${esc(fmtDateTime(existing.createdAt))}${existing.demo ? ', demo data' : ''}). Saving will replace it.</p>` : ''}
    </section>
    <div id="runs"></div>
    <div id="flow"></div>`;
  const runsEl = el.querySelector('#runs'), flowEl = el.querySelector('#flow');

  function quality(r) {
    return DOMAINS.map((d) => {
      const p = r[d];
      const ok = p && p.metrics && !(p.quality && p.quality.ok === false);
      return `${DOMAIN_LABEL[d]}: ${!p ? 'skipped' : ok ? '✓ measured' : '✕ not measured'}`;
    }).join(' · ');
  }

  function showRuns() {
    runsEl.innerHTML = runs.length ? `<section class="card"><h2 style="margin-top:0">✓ Baseline saved from ${runs.length} run${runs.length > 1 ? 's' : ''}</h2>
      <ol>${runs.map((r) => `<li>${quality(r)}${r.simulated ? ' <span class="demo-tag">simulated</span>' : ''}</li>`).join('')}</ol>
      <p class="small muted">Daily checks now compare to this. ${runs.length < MIN_RUNS ? `Adding ${MIN_RUNS - runs.length} more run makes it more accurate and cuts false alarms.` : ''}</p>
      <div class="btn-row">
        ${runs.length < MAX_RUNS ? `<button class="btn ${runs.length >= MIN_RUNS ? 'secondary' : ''}" id="again">Add run ${runs.length + 1} (recommended)</button>` : ''}
        <a class="btn ${runs.length >= MIN_RUNS ? '' : 'secondary'}" href="#/check">Do a daily check</a>
        <a class="btn secondary" href="#/">Go home</a>
      </div></section>` : '';
    const again = runsEl.querySelector('#again');
    if (again) again.onclick = startRun;
  }

  // Values far outside what healthy people show. Thresholds: face in inter-ocular units
  // (0.08 ≈ 5 mm), pause > 3 s (inappropriate-pause criterion, arXiv 2402.18923),
  // arm drift difference ≥ 0.25 shoulder widths (same as the red rule in scoring.js).
  function unusual(r) {
    const f = (r.face && r.face.metrics) || {}, sp = (r.speech && r.speech.metrics) || {}, a = (r.arms && r.arms.metrics) || {};
    const out = [];
    if (f.mouthAsymRest > 0.08 || f.mouthAsymSmile > 0.1 || (f.smileExcursionRatio != null && f.smileExcursionRatio < 0.6)) out.push('one side of your face moves less than the other');
    if (sp.longestPauseSec > 3) out.push('there was a long pause while you were speaking');
    if (a.dropAsym >= 0.25) out.push('one arm drifted down more than the other');
    return out;
  }

  function confirmResidual(found) {
    runsEl.innerHTML = '';
    flowEl.innerHTML = `<section class="card warn-card">
      <h2 style="margin-top:0">⚠️ Please check: is this how you've been since leaving hospital?</h2>
      <p>Your recording shows that ${found.map(esc).join(', and ')}.</p>
      <p>This can be normal after a stroke. But if it is <strong>new today</strong>, it could be a stroke happening now.</p>
      <div class="btn-row">
        <button class="btn" id="resYes">Yes, this is how I've been</button>
        <button class="btn danger" id="resNo">No, or not sure → Call 911</button>
      </div>
      <p class="small muted">If you answer yes, your care team will see this note in the doctor summary.</p></section>`;
    flowEl.querySelector('#resYes').onclick = () => {
      const b = load().baseline;
      setBaseline({ ...b, residualConfirmed: { at: new Date().toISOString(), findings: found } });
      flowEl.innerHTML = '';
      showRuns();
    };
    flowEl.querySelector('#resNo').onclick = () => {
      // Don't keep a baseline that may have been recorded during a stroke.
      runs.length = 0;
      setBaseline(null);
      location.hash = '#/emergency';
    };
  }

  // Saved after every run, so a baseline exists as soon as one run is done.
  async function save() {
    const { stats, fallback } = await buildBaselineSafe(runs);
    setBaseline({ createdAt: new Date().toISOString(), checks: [...runs], stats, ...(fallback ? { fallbackScoring: true } : {}) });
    toast(`Baseline saved (${runs.length} run${runs.length > 1 ? 's' : ''})`);
  }

  function startRun() {
    if (flowCleanup) flowCleanup();
    runsEl.querySelectorAll('button').forEach((b) => (b.disabled = true));
    flowCleanup = mountCheckFlow(flowEl, {
      mode: 'baseline',
      stats: null,
      intro: `<p><strong>Baseline run ${runs.length + 1} of ${MAX_RUNS}</strong></p>`,
      onComplete: (raw) => {
        runs.push(raw);
        if (flowCleanup) flowCleanup();
        flowCleanup = null;
        flowEl.innerHTML = '';
        save().then(() => (unusual(raw).length ? confirmResidual(unusual(raw)) : showRuns()), (e) => { console.error('baseline save failed', e); toast('Could not save baseline'); });
        runsEl.scrollIntoView({ behavior: 'smooth' });
      },
    });
  }

  // Safety: never record a baseline during new symptoms (it would become "normal").
  function symptomScreen() {
    flowEl.innerHTML = `<section class="card">
      <h2 style="margin-top:0">Before we record: any NEW symptoms today?</h2>
      <ul>
        <li><strong>Balance:</strong> sudden dizziness, trouble walking</li>
        <li><strong>Eyes:</strong> sudden blurry, double or lost vision</li>
        <li><strong>Face:</strong> one side drooping or numb</li>
        <li><strong>Arms or legs:</strong> new weakness or numbness, one side</li>
        <li><strong>Speech:</strong> slurred, confused, or can't find words</li>
      </ul>
      <p class="small muted">Symptoms you've had since leaving hospital are fine. We only ask about anything <em>new</em>.</p>
      <div class="btn-row">
        <button class="btn" id="noSx">No new symptoms — start</button>
        <a class="btn danger" href="#/emergency">Yes, something is new → Call 911</a>
      </div></section>`;
    flowEl.querySelector('#noSx').onclick = startRun;
  }

  symptomScreen();
  return () => { if (flowCleanup) flowCleanup(); };
}
