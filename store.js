// localStorage wrapper. Key: steadycheck.v1 (schema in SPEC.md). Only numbers/text — never media.
import { simulateCheck, buildBaselineSafe, scoreSafe } from './pages/detectors.js';

const KEY = 'steadycheck.v1';
const empty = () => ({
  profile: { name: '', familyContacts: [], meds: [] },
  baseline: null,
  checks: [],
  bp: [],
  doses: [],
  alerts: [],
  emergencies: [],
});

let cache = null;

export function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch (e) {
    console.warn('store load failed', e);
    cache = empty();
  }
  return cache;
}

export function save(s = cache) {
  cache = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { console.warn('store save failed', e); }
}

export function update(fn) { const s = load(); fn(s); save(s); return s; }
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function clearAll() { cache = empty(); save(cache); }
export function isSetUp() { const s = load(); return !!(s.profile && s.profile.name); }
export function setProfile(profile) { update((s) => { s.profile = { ...s.profile, ...profile }; }); }
export function setBaseline(baseline) { update((s) => { s.baseline = baseline; }); }

export function addCheck(check) {
  const c = { id: uid(), at: new Date().toISOString(), ...check };
  update((s) => s.checks.push(c));
  return c;
}
export function getCheck(id) { return load().checks.find((c) => c.id === id); }
export function lastCheck() { const cs = load().checks; return cs[cs.length - 1] || null; }

export function addAlert(kind, note) { const a = { at: new Date().toISOString(), kind, note }; update((s) => s.alerts.push(a)); return a; }
export function addBP(sys, dia, pulse) {
  const r = { at: new Date().toISOString(), sys: +sys, dia: +dia, pulse: pulse ? +pulse : null };
  update((s) => s.bp.push(r));
  return r;
}
export function addEmergency(symptomNoticedAt) {
  const e = { at: new Date().toISOString(), symptomNoticedAt };
  update((s) => s.emergencies.push(e));
  return e;
}
export function updateLastEmergency(symptomNoticedAt) {
  update((s) => { const e = s.emergencies[s.emergencies.length - 1]; if (e) e.symptomNoticedAt = symptomNoticedAt; });
}

// ---- meds / doses ----
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`; };
export { dayKey };

// A dose record for a med+time slot on a given day. doses entries: { at, medId, slot, taken }
export function doseFor(medId, slot, day = new Date()) {
  const k = dayKey(day);
  return load().doses.find((d) => d.medId === medId && (d.slot || '') === slot && dayKey(d.at) === k && d.taken);
}
export function toggleDose(medId, slot) {
  update((s) => {
    const k = dayKey(new Date());
    const i = s.doses.findIndex((d) => d.medId === medId && (d.slot || '') === slot && dayKey(d.at) === k);
    if (i >= 0) s.doses.splice(i, 1);
    else s.doses.push({ at: new Date().toISOString(), medId, slot, taken: true });
  });
}
export function adherence(days = 14) {
  const s = load();
  const slots = s.profile.meds.reduce((n, m) => n + (m.times && m.times.length ? m.times.length : 1), 0);
  if (!slots) return null;
  const since = Date.now() - days * 864e5;
  const taken = s.doses.filter((d) => d.taken && new Date(d.at).getTime() >= since).length;
  return Math.min(100, Math.round((taken / (slots * days)) * 100));
}

// ---- demo data ----
export async function seedDemoData() {
  const s = empty();
  s.profile = {
    name: 'Dad',
    familyContacts: [{ name: 'Maya (daughter)', phone: '555-0142' }, { name: 'Sam (son)', phone: '555-0178' }],
    meds: [
      { id: 'm1', name: 'Amlodipine (blood pressure)', dose: '5 mg', times: ['08:00'] },
      { id: 'm2', name: 'Aspirin', dose: '81 mg', times: ['08:00'] },
      { id: 'm3', name: 'Atorvastatin (cholesterol)', dose: '40 mg', times: ['20:00'] },
    ],
  };
  const now = new Date();
  const dayAt = (daysAgo, h, m = 0) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.toISOString(); };

  // Baseline: 3 runs, 15 days ago.
  const runs = [0, 1, 2].map(() => simulateCheck(null, { noise: 0.8 }));
  const bl = await buildBaselineSafe(runs);
  s.baseline = { createdAt: dayAt(15, 9), checks: runs, stats: bl.stats, demo: true };

  const missed = new Set(['5-m2', '9-m3', '2-m1']);
  for (let i = 14; i >= 1; i--) {
    // BP drifting slightly high
    const drift = (14 - i) * 0.7;
    s.bp.push({ at: dayAt(i, 8, 5), sys: Math.round(128 + drift + (Math.random() * 8 - 4)), dia: Math.round(80 + drift * 0.4 + (Math.random() * 6 - 3)), pulse: Math.round(70 + Math.random() * 8) });
    for (const med of s.profile.meds) for (const t of med.times) {
      if (missed.has(`${i}-${med.id}`)) continue;
      const [hh, mm] = t.split(':').map(Number);
      s.doses.push({ at: dayAt(i, hh, mm + 4), medId: med.id, slot: t, taken: true });
    }
    if (i === 10) continue; // one missed daily check
    const c = simulateCheck(s.baseline.stats, { noise: 0.5, includeArms: i % 3 === 0 });
    const check = { id: `demo${i}`, at: dayAt(i, 8, Math.floor(Math.random() * 10)), face: c.face, speech: c.speech, arms: c.arms, simulated: true };
    check.score = await scoreSafe(check, s.baseline.stats);
    if (i === 6) {
      // one honest false alarm for the validation page
      check.score = { level: 'yellow', z: {}, reasons: ['Speech slower than usual'], domains: { face: 'green', speech: 'yellow', arms: 'skipped' } };
    }
    s.checks.push(check);
    if (check.score.level !== 'green') s.alerts.push({ at: check.at, kind: check.score.level, note: `Daily check ${check.score.level}: ${check.score.reasons.join('; ') || 'different from usual'}` });
  }
  s.alerts.push({ at: dayAt(5, 9, 30), kind: 'missed', note: 'Morning Aspirin not marked as taken' });
  s.alerts.push({ at: dayAt(10, 11), kind: 'missed', note: 'No daily check by 11:00' });
  s.alerts.sort((a, b) => a.at.localeCompare(b.at));
  save(s);
  return s;
}
