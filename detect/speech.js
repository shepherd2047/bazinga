// detect/speech.js — timing of reading one fixed sentence, from audio ENERGY only.
// No speech recognition, no Web Speech API, nothing recorded or uploaded: we keep a
// list of 20 ms loudness values and throw the audio away immediately.
//
// Syllable counting follows the idea of de Jong & Wempe (2009), "Praat script to
// detect syllable nuclei" (Behavior Research Methods): syllable nuclei are peaks in
// the intensity contour that rise ≥2 dB above the preceding dip. (Cited from general
// knowledge. We have no pitch/voicing check, so this is a simplified version.)

export const SENTENCE = "You can't teach an old dog new tricks."; // Cincinnati Prehospital Stroke Scale sentence
export const SENTENCE_SYLLABLES = 8;

const FRAME_MS = 20;
const MIN_PAUSE_SEC = 0.25; // silent gap that counts as a pause
const MIN_SEG_SEC = 0.08;   // shorter blips are clicks, not speech
const DIP_DB = 2;           // de Jong & Wempe peak/dip criterion

export async function runSpeechCheck({ durationMs = 10000, onLevel } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const n = Math.min(buf.length, Math.round(ctx.sampleRate * FRAME_MS / 1000));
    const frames = [];
    const t0 = performance.now();
    await new Promise(resolve => {
      const id = setInterval(() => {
        const t = performance.now() - t0;
        analyser.getFloatTimeDomainData(buf);
        let s = 0;
        for (let i = buf.length - n; i < buf.length; i++) s += buf[i] * buf[i];
        const rms = Math.sqrt(s / n);
        frames.push({ t: t / 1000, rms });
        onLevel?.(Math.min(1, Math.max(0, (toDb(rms) + 60) / 50)));
        if (t >= durationMs) { clearInterval(id); resolve(); }
      }, FRAME_MS);
    });
    return analyzeEnergy(frames);
  } finally {
    stream.getTracks().forEach(tr => tr.stop()); // release the mic
    ctx.close().catch(() => {});
  }
}

const toDb = rms => 20 * Math.log10(rms + 1e-9);
const pct = (xs, q) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN; };
const r3 = x => Math.round(x * 1000) / 1000;

// Pure analysis of [{t (sec), rms}] frames → metrics. Exported for tests.
export function analyzeEnergy(frames, { noiseWindowSec = 0.5 } = {}) {
  const t = frames.map(f => f.t);
  const raw = frames.map(f => toDb(f.rms));
  // 3-frame (~60 ms) moving average
  const db = raw.map((_, i) => (raw[Math.max(0, i - 1)] + raw[i] + raw[Math.min(raw.length - 1, i + 1)]) / 3);
  const peakLevel = r3(Math.max(0, ...frames.map(f => f.rms)));

  // adaptive noise floor: first 0.5 s, but never above the quietest 10% of the whole take
  const early = db.filter((_, i) => t[i] < noiseWindowSec);
  const floor = Math.min(pct(early.length ? early : db, 0.5), pct(db, 0.1));
  const top = pct(db, 0.98);
  const onTh = floor + Math.max(10, 0.35 * (top - floor));
  const offTh = onTh - 4; // hysteresis
  const empty = (why) => ({
    metrics: { speechSec: null, pauseCount: null, longestPauseSec: null, syllableRate: null, onsetLatencySec: null },
    quality: { ok: false, peakLevel, reason: why },
    detail: { noiseFloorDb: r3(floor) },
  });
  if (!frames.length || !(top - floor >= 12)) return empty('no-speech');

  // voiced segments with hysteresis
  let segs = [], on = false, start = 0;
  db.forEach((d, i) => {
    if (!on && d > onTh) { on = true; start = i; }
    else if (on && d < offTh) { on = false; segs.push([start, i - 1]); }
  });
  const truncated = on;
  if (on) segs.push([start, db.length - 1]);
  const dt = FRAME_MS / 1000;
  // merge gaps shorter than a pause, then drop tiny blips
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && t[s[0]] - t[last[1]] - dt < MIN_PAUSE_SEC) last[1] = s[1];
    else merged.push([...s]);
  }
  segs = merged.filter(([a, b]) => t[b] - t[a] + dt >= MIN_SEG_SEC);
  if (!segs.length) return empty('no-speech');

  const onsetLatencySec = t[segs[0][0]];
  const speechSec = t[segs[segs.length - 1][1]] - onsetLatencySec + dt;
  const pauses = segs.slice(1).map((s, k) => t[s[0]] - t[segs[k][1]] - dt);
  const voicedSec = segs.reduce((s, [a, b]) => s + t[b] - t[a] + dt, 0);

  // syllable nuclei: local maxima above threshold that rise ≥ DIP_DB over the dip since the last nucleus
  let syllables = 0;
  for (const [a, b] of segs) {
    let lastPeak = null, dip = Infinity;
    for (let i = a; i <= b; i++) {
      dip = Math.min(dip, db[i]);
      const isMax = i > a && i < b && db[i] >= db[i - 1] && db[i] > db[i + 1];
      if (!isMax || db[i] < onTh) continue;
      if (lastPeak === null || db[i] - dip >= DIP_DB) { syllables++; lastPeak = db[i]; dip = db[i]; }
      else if (db[i] > lastPeak) { lastPeak = db[i]; dip = db[i]; } // same nucleus, higher top
    }
    if (lastPeak === null) syllables++; // a voiced segment holds at least one syllable
  }

  return {
    metrics: {
      speechSec: r3(speechSec),
      pauseCount: pauses.length,
      longestPauseSec: r3(pauses.length ? Math.max(...pauses) : 0),
      syllableRate: r3(syllables / voicedSec), // articulation rate: syllables per second of voicing
      onsetLatencySec: r3(onsetLatencySec),
    },
    quality: { ok: speechSec >= 0.8, peakLevel, truncated },
    detail: { syllables, expectedSyllables: SENTENCE_SYLLABLES, voicedSec: r3(voicedSec), noiseFloorDb: r3(floor), thresholdDb: r3(onTh) },
  };
}
