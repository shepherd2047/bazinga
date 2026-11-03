// Daily check: stepper → score vs own baseline → save → #/result/:id
import { load, addCheck, addAlert, addEmergency, lastCheck, update } from '../store.js';
import { mountCheckFlow } from './checkflow.js';
import { getScorer, scoreSafe, applyDemoStroke } from './detectors.js';
import { isDemoMode } from './ui.js';

const ESCALATE_WINDOW_MS = 30 * 60 * 1000;

export function render(el, { query }) {
  const s = load();
  if (!s.baseline || !s.baseline.stats) {
    el.innerHTML = `<section class="card"><h1>First, record your normal</h1>
      <p>The daily check compares you to <em>your own</em> usual face, speech and arms. We need 2–3 baseline recordings on a good day first.</p>
      <div class="btn-row"><a class="btn" href="#/baseline">Record my baseline</a><a class="btn secondary" href="#/setup">Load demo data</a></div>
      <p class="muted">Feeling something wrong right now? <a href="#/emergency">Go to emergency help</a> — don't do a check.</p></section>`;
    return;
  }
  const recheck = query.get('recheck');
  el.innerHTML = `<h1>${recheck ? 'Recheck' : 'Daily check'}</h1>
    ${recheck ? '<p class="warn">This is your recheck after resting. If anything feels worse, stop and call 911.</p>' : ''}
    ${isDemoMode() ? '<p class="small muted"><span class="demo-tag">Demo controls on</span> Turn them off in the footer.</p>' : ''}
    <div id="flow"></div>`;

  return mountCheckFlow(el.querySelector('#flow'), {
    mode: 'daily',
    stats: s.baseline.stats,
    onComplete: async (raw, { demoStroke }) => {
      let c = { face: raw.face, speech: raw.speech, arms: raw.arms };
      if (demoStroke) {
        const sc = await getScorer();
        c = applyDemoStroke(c, s.baseline.stats, sc.SD_FLOOR);
      }
      const prev = lastCheck();
      const score = await scoreSafe({ face: c.face, speech: c.speech, arms: c.arms }, s.baseline.stats, { previous: prev, now: Date.now() });
      score.reasons = [...(score.reasons || [])];

      // scoring.js applies the history rules itself; this is only for the built-in fallback scorer.
      const recent = score.fallback && prev && Date.now() - new Date(prev.at).getTime() < ESCALATE_WINDOW_MS;
      if (recent && prev.score && prev.score.level === 'yellow' && score.level === 'yellow') {
        score.level = 'red'; score.escalated = true;
        score.reasons.push('Different from your usual twice in a row');
      } else if (recent && prev.score && prev.score.level === 'red' && score.level !== 'red') {
        score.reasons.push(`A red result at ${new Date(prev.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} is not cancelled by a later check`);
        score.level = 'red'; score.escalated = true;
      }

      const check = addCheck({
        face: c.face, speech: c.speech, arms: c.arms, score,
        ...(raw.simulated ? { simulated: true } : {}),
        ...(c.demoStroke ? { demoStroke: true } : {}),
        ...(recheck ? { recheckOf: recheck } : {}),
      });
      if (score.level === 'red') {
        const em = addEmergency(new Date().toISOString());
        update((st) => { const x = st.checks.find((k) => k.id === check.id); if (x) x.emergencyAt = em.at; });
        addAlert('red', `Daily check red: ${score.reasons.join('; ') || 'clearly different from usual'}`);
      } else if (score.level === 'yellow') {
        addAlert('yellow', `Daily check yellow: ${score.reasons.join('; ') || 'a bit different from usual'}`);
      }
      location.hash = `#/result/${check.id}`;
    },
  });
}
