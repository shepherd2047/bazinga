// detect/scoring.js — compare today's check to the person's OWN baseline.
// Pure functions, no DOM. It never diagnoses; it only decides how loudly to escalate.
//
// z = (value − baseline mean) / max(baseline SD, SD_FLOOR), multiplied by the metric's
// "worse" direction so that only WORSENING gives a positive z.

// dir: +1 = higher is worse, −1 = lower is worse. floor = minimum SD (same units as metric).
export const METRICS = {
  // face — units: inter-ocular distances (1 IOD ≈ 63 mm, so 0.02 ≈ 1.3 mm)
  mouthAsymRest:       { domain: 'face', dir: +1, floor: 0.02 },
  mouthAsymSmile:      { domain: 'face', dir: +1, floor: 0.03 },
  smileExcursionRatio: { domain: 'face', dir: -1, floor: 0.1 },
  eyeAsym:             { domain: 'face', dir: +1, floor: 0.08 },
  // speech — seconds, counts, syllables/second
  speechSec:           { domain: 'speech', dir: +1, floor: 0.4 },
  pauseCount:          { domain: 'speech', dir: +1, floor: 0.7 },
  longestPauseSec:     { domain: 'speech', dir: +1, floor: 0.3 },
  syllableRate:        { domain: 'speech', dir: -1, floor: 0.6 },
  onsetLatencySec:     { domain: 'speech', dir: +1, floor: 0.8 },
  // arms — units: shoulder widths (≈ 40 cm, so 0.08 ≈ 3 cm)
  leftDrop:            { domain: 'arms', dir: +1, floor: 0.08 },
  rightDrop:           { domain: 'arms', dir: +1, floor: 0.08 },
  dropAsym:            { domain: 'arms', dir: +1, floor: 0.08 },
};
export const SD_FLOOR = Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, m.floor]));

export const Z_OFF = 3;      // a metric this far in the worse direction = "clearly off"
export const Z_STRONG = 5;   // a face-asymmetry metric this far off = "strong face change" → red
const FACE_STRONG_KEYS = ['mouthAsymRest', 'mouthAsymSmile', 'smileExcursionRatio'];
const ARMS_STRONG_MIN = 0.25; // arms alone go red only if also ≥ ¼ shoulder width of asymmetric drop
const REPEAT_WINDOW_MS = 2 * 60 * 60 * 1000; // "twice in a row" = within 2 h
const DOMAINS = ['face', 'speech', 'arms'];

const valueOf = (check, m) => check?.[METRICS[m].domain]?.metrics?.[m];
const usable = (check, d) => check?.[d] && check[d].quality?.ok !== false;

// checks: [{ face, speech, arms }] → { metric: { mean, sd, n } }
export function buildBaseline(checks = []) {
  const out = {};
  for (const m of Object.keys(METRICS)) {
    const d = METRICS[m].domain;
    const xs = checks.filter(c => usable(c, d)).map(c => valueOf(c, m)).filter(Number.isFinite);
    if (!xs.length) continue;
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1)) : 0;
    out[m] = { mean, sd, n: xs.length };
  }
  return out;
}

const side = s => (s === 'left' || s === 'right' ? s : null);
const REASONS = {
  mouthAsymRest: c => `One corner of your mouth${side(c.face?.detail?.lowerCornerSide) ? ` (your ${c.face.detail.lowerCornerSide} side)` : ''} sat lower than usual.`,
  mouthAsymSmile: c => `Your smile was less even than usual.`,
  smileExcursionRatio: c => side(c.face?.detail?.weakerSide)
    ? `Your smile was less even on the ${c.face.detail.weakerSide} side than usual.`
    : `Your smile was less even than usual.`,
  eyeAsym: () => `Your eyes looked less evenly open than usual.`,
  speechSec: () => `You took longer than usual to say the sentence.`,
  pauseCount: () => `You paused more often than usual while speaking.`,
  longestPauseSec: () => `You had a longer pause than usual while speaking.`,
  syllableRate: () => `Your speech was slower than usual.`,
  onsetLatencySec: () => `You took longer than usual to start speaking.`,
  leftDrop: () => `Your left arm drifted down more than usual.`,
  rightDrop: () => `Your right arm drifted down more than usual.`,
  dropAsym: c => side(c.arms?.detail?.weakerSide)
    ? `Your ${c.arms.detail.weakerSide} arm drifted down more than the other one.`
    : `One arm drifted down more than the other one.`,
};
const CANT_MEASURE = {
  face: `We couldn't see your face clearly. Please redo the check facing the camera in good light.`,
  speech: `We couldn't hear the sentence clearly. Please redo the check in a quiet room.`,
  arms: `We couldn't see both arms clearly. Please redo the check with your shoulders and hands in view.`,
  smile: `We couldn't see a clear smile. Please redo the check and smile big.`,
  baseline: `There is no usual (baseline) to compare with yet. Please record your baseline.`,
};

// check: { face, speech, arms } (arms may be null = skipped)
// baseline: buildBaseline() output, or { stats }, or an array of baseline checks.
// opts.previous: the last stored check { at, score } — for "yellow twice in a row" and "red never downgrades".
// opts.now: timestamp (ms or ISO) of this check, default Date.now().
export function scoreCheck(check, baseline, opts = {}) {
  const stats = Array.isArray(baseline) ? buildBaseline(baseline) : (baseline?.stats ?? baseline ?? {});
  const z = {}, reasons = [], domains = {};
  let offDomains = 0, unmeasured = 0, strong = false;

  for (const d of DOMAINS) {
    const r = check?.[d];
    if (r == null && d === 'arms') { domains[d] = 'skipped'; continue; }
    if (!usable(check, d)) { domains[d] = 'yellow'; unmeasured++; reasons.push(CANT_MEASURE[d]); continue; }

    const off = [];
    let scored = 0, dStrong = false;
    for (const m of Object.keys(METRICS).filter(k => METRICS[k].domain === d)) {
      const x = r.metrics?.[m], b = stats[m];
      if (!Number.isFinite(x) || !b || !Number.isFinite(b.mean)) continue;
      const zz = METRICS[m].dir * (x - b.mean) / Math.max(b.sd || 0, METRICS[m].floor);
      z[m] = Math.round(zz * 100) / 100;
      scored++;
      if (zz >= Z_OFF) off.push(m);
      if (d === 'face' && FACE_STRONG_KEYS.includes(m) && zz >= Z_STRONG) dStrong = true;
      if (d === 'arms' && m === 'dropAsym' && zz >= Z_STRONG && x >= ARMS_STRONG_MIN) dStrong = true;
    }
    if (!scored) { domains[d] = 'yellow'; unmeasured++; reasons.push(CANT_MEASURE.baseline); continue; }

    off.sort((a, b) => z[b] - z[a]).slice(0, 2).forEach(m => reasons.push(REASONS[m](check)));
    let level = dStrong ? 'red' : off.length ? 'yellow' : 'green';
    if (off.length) offDomains++;
    if (dStrong) strong = true;
    // the smile could not be measured (e.g. no smile) — never let face be green then
    if (d === 'face' && r.metrics?.smileExcursionRatio == null) {
      unmeasured++; reasons.push(CANT_MEASURE.smile);
      if (level === 'green') level = 'yellow';
    }
    domains[d] = level;
  }

  let level = strong || offDomains >= 2 ? 'red' : (offDomains || unmeasured) ? 'yellow' : 'green';

  // history rules
  const prev = opts.previous;
  const now = new Date(opts.now ?? Date.now()).getTime();
  const recent = prev?.score && prev.at && now - new Date(prev.at).getTime() < REPEAT_WINDOW_MS;
  if (recent && prev.score.level === 'red' && level !== 'red') {
    level = 'red'; reasons.unshift(`Your last check was red. Please follow the red steps and call 911.`);
  } else if (recent && prev.score.level === 'yellow' && level === 'yellow' && offDomains >= 1) {
    level = 'red'; reasons.unshift(`This is the second unusual check in a row.`);
  }

  if (level === 'green') reasons.push(`Your results were close to your usual. This check can miss things — if you notice any sudden symptoms, call 911.`);
  if (level === 'red' && strong) reasons.unshift(`This is a big change from your usual.`);
  return { level, z, reasons, domains, offDomains, unmeasured };
}
