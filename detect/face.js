// detect/face.js — face droop check (rest → smile) with MediaPipe FaceLandmarker.
// All geometry is done in the FACE's own frame: origin = midpoint of the two eye
// centres, x-axis = person's right eye → person's left eye, y-axis = perpendicular
// (pointing down the face), unit = inter-ocular distance (IOD). That makes every
// metric scale-invariant and tolerant to head roll / distance from the camera.
//
// LEFT/RIGHT always mean the PERSON's left/right. MediaPipe landmarks come from the
// raw (un-mirrored) camera frame, where the person's right side is on the image's
// left. CSS mirroring of the preview does not affect the frames we analyse.
// (A camera that mirrors in hardware would swap sides — rare on laptops.)

export const TASKS_VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Landmark indices (MediaPipe 468/478 face mesh). "R" = person's right.
export const FACE_IDX = {
  rEyeOuter: 33, rEyeInner: 133, lEyeOuter: 263, lEyeInner: 362,
  rLidUp: 159, rLidLo: 145, lLidUp: 386, lLidLo: 374,
  rMouth: 61, lMouth: 291, noseTip: 1,
  // lower-lip points next to each corner, nearest first (used by validation.js)
  lLowerLip: [375, 321, 405], rLowerLip: [146, 91, 181],
};

let visionPromise = null;
export function loadVision() {
  visionPromise ??= (async () => {
    const mod = await import(TASKS_VISION);
    const fileset = await mod.FilesetResolver.forVisionTasks(`${TASKS_VISION}/wasm`);
    return { mod, fileset };
  })().catch(e => { visionPromise = null; throw e; });
  return visionPromise;
}

// Create a MediaPipe task with GPU delegate, falling back to CPU.
export async function createTask(cls, modelAssetPath, extra = {}) {
  const { mod, fileset } = await loadVision();
  const opts = delegate => ({ baseOptions: { modelAssetPath, delegate }, runningMode: 'VIDEO', ...extra });
  try { return await mod[cls].createFromOptions(fileset, opts('GPU')); }
  catch (e) {
    console.warn(`[SteadyCheck] ${cls} GPU delegate failed, using CPU`, e);
    return mod[cls].createFromOptions(fileset, opts('CPU'));
  }
}

let facePromise = null;
export function initFace() {
  facePromise ??= createTask('FaceLandmarker', FACE_MODEL, { numFaces: 1 })
    .catch(e => { facePromise = null; throw e; });
  return facePromise;
}

// Run fn(timestampMs, elapsedMs) once per new video frame for durationMs.
export async function videoLoop(video, durationMs, fn) {
  if (video.readyState < 2) await new Promise(r => video.addEventListener('loadeddata', r, { once: true }));
  const t0 = performance.now();
  let lastVideoTime = -1, lastTs = 0;
  for (;;) {
    const now = performance.now();
    const elapsed = now - t0;
    if (elapsed >= durationMs) break;
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      lastTs = Math.max(now, lastTs + 1); // MediaPipe needs strictly increasing timestamps
      try { fn(lastTs, elapsed); } catch (e) { console.warn('[SteadyCheck] frame error', e); }
    }
    // rAF, with a timeout fallback so a background tab can't hang the check forever
    await new Promise(r => { const id = setTimeout(r, 100); requestAnimationFrame(() => { clearTimeout(id); r(); }); });
  }
}

// ---------- pure geometry (no DOM; reused by validation.js and node tests) ----------

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Per-frame features in face-normalised coordinates. pts = normalised landmarks,
// W/H = video size in pixels (needed because x and y are normalised separately).
export function faceFrameFeatures(pts, W = 640, H = 480) {
  const p = i => [pts[i].x * W, pts[i].y * H];
  const I = FACE_IDX;
  const rEye = mid(p(I.rEyeOuter), p(I.rEyeInner));
  const lEye = mid(p(I.lEyeOuter), p(I.lEyeInner));
  const iod = dist(rEye, lEye) || 1;
  const xa = [(lEye[0] - rEye[0]) / iod, (lEye[1] - rEye[1]) / iod];
  const ya = [-xa[1], xa[0]]; // points down the face
  const o = mid(rEye, lEye);
  const loc = q => {
    const d = [q[0] - o[0], q[1] - o[1]];
    return { u: (d[0] * xa[0] + d[1] * xa[1]) / iod, v: (d[0] * ya[0] + d[1] * ya[1]) / iod };
  };
  const rC = loc(p(I.rMouth)), lC = loc(p(I.lMouth));
  return {
    rC, lC,
    nose: loc(p(I.noseTip)),
    mouthW: lC.u - rC.u,
    eyeR: dist(p(I.rLidUp), p(I.rLidLo)) / iod,
    eyeL: dist(p(I.lLidUp), p(I.lLidLo)) / iod,
    iodPx: iod,
  };
}

// Mean after dropping the top and bottom 10% (outlier trimming).
export function trimmedMean(xs, trim = 0.1) {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const k = Math.floor(a.length * trim);
  const b = a.length - 2 * k > 0 ? a.slice(k, a.length - k) : a;
  return b.reduce((s, x) => s + x, 0) / b.length;
}
const median = xs => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
const r4 = x => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);

// Frames where the head is turned a lot (nose far off the eye midline) are dropped.
export const MAX_YAW_U = 0.25;
const frontal = f => Math.abs(f.nose.u) < MAX_YAW_U;

// Turn rest-phase and smile-phase frame features into the four face metrics.
export function summarizeFace(restFrames, smileFrames) {
  const rest = restFrames.filter(frontal);
  let smile = smileFrames.filter(frontal);
  // keep the "peak" half of the smile (widest mouth) — ignores lag before the smile
  if (smile.length >= 4) { const mw = median(smile.map(f => f.mouthW)); smile = smile.filter(f => f.mouthW >= mw); }
  const meanPt = (fs, k) => ({ u: trimmedMean(fs.map(f => f[k].u)), v: trimmedMean(fs.map(f => f[k].v)) });

  // signed vertical offset: + means the person's LEFT corner sits lower
  const restSigned = trimmedMean(rest.map(f => f.lC.v - f.rC.v));
  const smileSigned = trimmedMean(smile.map(f => f.lC.v - f.rC.v));

  let smileExcursionRatio = null, exL = NaN, exR = NaN;
  if (rest.length && smile.length) {
    const rR = meanPt(rest, 'rC'), rL = meanPt(rest, 'lC'), sR = meanPt(smile, 'rC'), sL = meanPt(smile, 'lC');
    exR = Math.hypot(sR.u - rR.u, sR.v - rR.v);
    exL = Math.hypot(sL.u - rL.u, sL.v - rL.v);
    const mx = Math.max(exL, exR);
    if (mx >= 0.03) smileExcursionRatio = Math.min(exL, exR) / mx; // else: no real smile seen
  }

  // eye opening asymmetry at rest, ignoring blink frames
  const open = rest.map(f => (f.eyeR + f.eyeL) / 2);
  const mo = median(open);
  const eyesOpen = rest.filter((f, i) => open[i] >= 0.6 * mo);
  const eyeAsym = Math.abs(trimmedMean(eyesOpen.map(f => f.eyeR - f.eyeL))) / (trimmedMean(eyesOpen.map((f, i) => (f.eyeR + f.eyeL) / 2)) || 1);

  return {
    metrics: {
      mouthAsymRest: r4(Math.abs(restSigned)),
      mouthAsymSmile: r4(Math.abs(smileSigned)),
      smileExcursionRatio: r4(smileExcursionRatio),
      eyeAsym: r4(eyeAsym),
    },
    detail: {
      lowerCornerSide: restSigned > 0 ? 'left' : 'right', // person's side
      weakerSide: Number.isFinite(exL) ? (exL < exR ? 'left' : 'right') : null, // side that moved less
      excursionLeft: r4(exL), excursionRight: r4(exR),
      restFrames: rest.length, smileFrames: smile.length,
    },
  };
}

// ---------- the check ----------

export async function runFaceCheck(video, { durationMs = 12000, onPhase, onFrame } = {}) {
  const landmarker = await initFace();
  const half = durationMs / 2;
  const W = video.videoWidth || 640, H = video.videoHeight || 480;
  const rest = [], smile = [];
  let frames = 0, found = 0, phase = null;

  onPhase?.('rest'); phase = 'rest';
  await videoLoop(video, durationMs, (ts, el) => {
    const p = el < half ? 'rest' : 'smile';
    if (p !== phase) { phase = p; onPhase?.(p); }
    frames++;
    const pts = landmarker.detectForVideo(video, ts).faceLandmarks?.[0];
    if (!pts) return;
    found++;
    onFrame?.(pts);
    const f = faceFrameFeatures(pts, W, H);
    if (p === 'rest' && el > 800) rest.push(f);           // skip settling-in
    if (p === 'smile' && el > half + 1200) smile.push(f); // skip the time it takes to smile
  });

  const { metrics, detail } = summarizeFace(rest, smile);
  const faceFoundPct = frames ? found / frames : 0;
  return {
    metrics,
    detail,
    quality: {
      framesUsed: detail.restFrames + detail.smileFrames,
      faceFoundPct: Math.round(faceFoundPct * 100) / 100,
      smileSeen: metrics.smileExcursionRatio !== null,
      ok: faceFoundPct >= 0.6 && detail.restFrames >= 5 && detail.smileFrames >= 3,
    },
  };
}
