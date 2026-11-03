// Adapter between the UI and the logic agent's detect/ modules.
// Every detector is loaded with dynamic import() so the app still runs (with a
// clearly-labelled simulation path) if a module is missing or fails to load.

const loaded = {};

export async function loadModule(name) {
  if (loaded[name]) return loaded[name];
  try {
    const m = await import(`../detect/${name}.js`);
    loaded[name] = m;
    return m;
  } catch (e) {
    console.warn(`[SteadyCheck] detect/${name}.js unavailable:`, e && e.message);
    return null; // not cached: the logic agent may ship it later
  }
}

export async function loadAll() {
  const names = ['face', 'speech', 'arms', 'scoring', 'validation'];
  const mods = await Promise.all(names.map(loadModule));
  const out = {};
  names.forEach((n, i) => (out[n] = mods[i]));
  return out;
}

// Metric catalogue. dir = which direction is "worse" (+1 higher is worse, -1 lower is worse).
// typical/typSd are only used for simulated demo data when no real baseline exists.
export const METRICS = {
  face: {
    mouthAsymRest: { dir: 1, label: 'Mouth looks more uneven at rest', typical: 0.02, typSd: 0.006 },
    mouthAsymSmile: { dir: 1, label: 'Smile is more lopsided than usual', typical: 0.03, typSd: 0.008 },
    smileExcursionRatio: { dir: -1, label: 'One side of the smile moves less than usual', typical: 0.92, typSd: 0.03 },
    eyeAsym: { dir: 1, label: 'Eyes look more uneven than usual', typical: 0.02, typSd: 0.006 },
  },
  speech: {
    speechSec: { dir: 1, label: 'Took longer to say the sentence', typical: 3.2, typSd: 0.3 },
    pauseCount: { dir: 1, label: 'More pauses while speaking', typical: 1, typSd: 0.6 },
    longestPauseSec: { dir: 1, label: 'Longer pauses while speaking', typical: 0.35, typSd: 0.1 },
    syllableRate: { dir: -1, label: 'Speech slower than usual', typical: 3.6, typSd: 0.3 },
    onsetLatencySec: { dir: 1, label: 'Slower to start speaking', typical: 0.8, typSd: 0.2 },
  },
  arms: {
    leftDrop: { dir: 1, label: 'Left arm drifted down', typical: 0.03, typSd: 0.01 },
    rightDrop: { dir: 1, label: 'Right arm drifted down', typical: 0.03, typSd: 0.01 },
    dropAsym: { dir: 1, label: 'One arm drifted down more than the other', typical: 0.015, typSd: 0.008 },
  },
};
export const DOMAINS = ['face', 'speech', 'arms'];
export const DOMAIN_LABEL = { face: 'Face', speech: 'Speech', arms: 'Arms' };

// Baseline stats may come back in a few shapes; read them all.
export function statFor(stats, domain, m) {
  if (!stats) return null;
  const c = [stats[m], stats[`${domain}.${m}`], stats[domain] && stats[domain][m]];
  for (const s of c) if (s && typeof s.mean === 'number') return { mean: s.mean, sd: s.sd ?? 0, n: s.n ?? 0 };
  if (stats.mean && typeof stats.mean[m] === 'number') return { mean: stats.mean[m], sd: (stats.sd || {})[m] ?? 0, n: stats.n ?? 0 };
  return null;
}

function floorFor(sdFloor, domain, m, mean) {
  let f = 0;
  if (sdFloor && typeof sdFloor === 'object') f = sdFloor[m] ?? (sdFloor[domain] && sdFloor[domain][m]) ?? 0;
  else if (typeof sdFloor === 'number') f = sdFloor;
  return Math.max(f || 0, Math.abs(mean || 0) * 0.08, 0.01);
}

// ---------- fallback scoring (only used if detect/scoring.js is missing) ----------
export function fallbackBuildBaseline(checks) {
  const stats = {};
  for (const d of DOMAINS) for (const m of Object.keys(METRICS[d])) {
    const xs = checks.map((c) => c && c[d] && c[d].metrics && c[d].metrics[m]).filter((v) => typeof v === 'number');
    if (!xs.length) continue;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)) : 0;
    stats[m] = { mean, sd, n: xs.length };
  }
  return stats;
}

export function fallbackScore(check, stats) {
  const z = {}, reasons = [], domains = {};
  const off = {};
  for (const d of DOMAINS) {
    const part = check[d];
    if (!part || part.skipped) { domains[d] = d === 'arms' ? 'skipped' : 'yellow'; if (d !== 'arms') reasons.push(`${DOMAIN_LABEL[d]} check was not done — not treated as normal`); continue; }
    if (!part.metrics || (part.quality && part.quality.ok === false)) {
      domains[d] = 'yellow'; reasons.push(`${DOMAIN_LABEL[d]} could not be measured well — not treated as normal`); continue;
    }
    let worst = 0;
    for (const [m, info] of Object.entries(METRICS[d])) {
      const v = part.metrics[m]; const s = statFor(stats, d, m);
      if (typeof v !== 'number' || !s) continue;
      const sd = Math.max(s.sd, floorFor(null, d, m, s.mean));
      const zz = (v - s.mean) / sd; z[m] = zz;
      const bad = zz * info.dir;
      if (bad >= 2) reasons.push(info.label);
      worst = Math.max(worst, bad);
    }
    off[d] = worst;
    domains[d] = worst >= 4 ? 'red' : worst >= 2 ? 'yellow' : 'green';
  }
  const offCount = DOMAINS.filter((d) => (off[d] || 0) >= 2).length;
  let level = 'green';
  if (Object.values(domains).some((v) => v === 'yellow' || v === 'red')) level = 'yellow';
  if ((off.face || 0) >= 4 || offCount >= 2) level = 'red';
  return { level, z, reasons, domains, fallback: true };
}

let scorerCache = null;
export async function getScorer() {
  const s = await loadModule('scoring');
  if (s && typeof s.scoreCheck === 'function' && typeof s.buildBaseline === 'function') {
    scorerCache = { buildBaseline: s.buildBaseline, scoreCheck: s.scoreCheck, SD_FLOOR: s.SD_FLOOR, fallback: false };
  } else {
    scorerCache = { buildBaseline: fallbackBuildBaseline, scoreCheck: fallbackScore, SD_FLOOR: null, fallback: true };
  }
  return scorerCache;
}

export async function buildBaselineSafe(checks) {
  const sc = await getScorer();
  try { return { stats: sc.buildBaseline(checks), fallback: sc.fallback }; }
  catch (e) { console.warn('buildBaseline failed, using fallback', e); return { stats: fallbackBuildBaseline(checks), fallback: true }; }
}

export async function scoreSafe(check, stats, opts) {
  const sc = await getScorer();
  try {
    const r = sc.scoreCheck(check, stats, opts);
    if (r && r.level) return { ...r, fallback: sc.fallback };
  } catch (e) { console.warn('scoreCheck failed, using fallback', e); }
  return fallbackScore(check, stats);
}

// ---------- simulation (demo only) ----------
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// A fake check near the person's baseline (or typical values if none). Unit-agnostic.
export function simulateCheck(stats, { noise = 0.6, includeArms = true } = {}) {
  const out = { simulated: true };
  for (const d of DOMAINS) {
    if (d === 'arms' && !includeArms) { out.arms = null; continue; }
    const metrics = {};
    for (const [m, info] of Object.entries(METRICS[d])) {
      const s = statFor(stats, d, m);
      const mean = s ? s.mean : info.typical;
      const sd = s ? Math.max(s.sd, info.typSd * 0.5) : info.typSd;
      let v = mean + gauss() * sd * noise;
      if (m === 'pauseCount') v = Math.max(0, Math.round(v));
      metrics[m] = +Math.max(0, v).toFixed(4);
    }
    out[d] = { metrics, quality: { ok: true, simulated: true, framesUsed: 300, faceFoundPct: 100 } };
  }
  return out;
}

// Demo control: degrade metrics in the "worse" direction so the red flow shows reliably.
const STROKE_SHIFT = { face: 7, speech: 5, arms: 6 };
export function applyDemoStroke(check, stats, sdFloor) {
  const out = { ...check, demoStroke: true };
  for (const d of DOMAINS) {
    if (d === 'arms' && (!check.arms || check.arms.skipped)) continue;
    const src = (check[d] && check[d].metrics) || {};
    const metrics = { ...src };
    for (const [m, info] of Object.entries(METRICS[d])) {
      const s = statFor(stats, d, m);
      const mean = s ? s.mean : info.typical;
      const sd = Math.max(s ? s.sd : info.typSd, floorFor(sdFloor, d, m, mean), info.typSd);
      const base = typeof src[m] === 'number' ? src[m] : mean;
      let v = base + info.dir * STROKE_SHIFT[d] * sd;
      if (m === 'rightDrop') v = base; // one-sided weakness
      metrics[m] = +Math.max(0, v).toFixed(4);
    }
    out[d] = { ...(check[d] || {}), metrics, quality: { ...((check[d] && check[d].quality) || {}), ok: true, smileSeen: true, demoStroke: true } };
  }
  return out;
}

// Shared in-memory spot for the last captured face landmarks (never persisted).
export const session = { lastFaceLandmarks: null, lastPoseLandmarks: null };
