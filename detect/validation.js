// detect/validation.js — synthetic dose-response + CSV export. Pure, no DOM.
//
// syntheticDroopSeries pulls the person's LEFT mouth corner (and the nearby lower-lip
// points, with decreasing weight) DOWN by graded millimetre amounts, in the face's own
// frame, and runs the exact same metric code as the live check (face.js). It answers:
// "how many mm of droop does it take before our score moves?" — a sanity check of
// the measurement pipeline, NOT clinical validation.

import { FACE_IDX, faceFrameFeatures, summarizeFace } from './face.js';
import { METRICS, SD_FLOOR, Z_OFF, Z_STRONG } from './scoring.js';

export const IPD_MM = 63; // typical adult inter-pupillary distance

// A minimal frontal face (only the landmarks we use), in normalised coords for 640×480.
export function defaultFaceLandmarks(W = 640, H = 480) {
  const px = {
    33: [250, 200], 133: [290, 200], 263: [390, 200], 362: [350, 200],
    159: [270, 193], 145: [270, 207], 386: [370, 193], 374: [370, 207],
    1: [320, 260], 61: [285, 310], 291: [355, 310],
    375: [345, 318], 321: [335, 322], 405: [328, 324],
    146: [295, 318], 91: [305, 322], 181: [312, 324],
  };
  const pts = [];
  for (let i = 0; i < 478; i++) pts.push({ x: 0.5, y: 0.5, z: 0 });
  for (const [i, [x, y]] of Object.entries(px)) pts[i] = { x: x / W, y: y / H, z: 0 };
  return pts;
}

// Move landmark i by (du, dv) millimetres in the face frame (u → person's left, v → down).
function shift(pts, i, du, dv, frame, W, H) {
  const { xa, ya, pxPerMm } = frame;
  const dx = (du * xa[0] + dv * ya[0]) * pxPerMm, dy = (du * xa[1] + dv * ya[1]) * pxPerMm;
  pts[i] = { ...pts[i], x: pts[i].x + dx / W, y: pts[i].y + dy / H };
}

function faceFrame(pts, W, H) {
  const p = i => [pts[i].x * W, pts[i].y * H];
  const I = FACE_IDX;
  const r = [(p(I.rEyeOuter)[0] + p(I.rEyeInner)[0]) / 2, (p(I.rEyeOuter)[1] + p(I.rEyeInner)[1]) / 2];
  const l = [(p(I.lEyeOuter)[0] + p(I.lEyeInner)[0]) / 2, (p(I.lEyeOuter)[1] + p(I.lEyeInner)[1]) / 2];
  const iod = Math.hypot(l[0] - r[0], l[1] - r[1]);
  const xa = [(l[0] - r[0]) / iod, (l[1] - r[1]) / iod];
  return { xa, ya: [-xa[1], xa[0]], pxPerMm: iod / IPD_MM };
}

// baseLandmarks: one FaceLandmarker landmark array (478 points) or null for a built-in face.
// mmSteps: droop amounts in mm. opts: { W, H, smileUpMm, smileOutMm }.
// → [{ mm, mouthAsymRest, mouthAsymSmile, smileExcursionRatio, zRest, zSmileAsym, zExcursion, level }]
//   z values are relative to the 0 mm face using the SD floors (i.e. a 1–3-check baseline);
//   level is what that single face change alone would score (yellow ≥ Z_OFF, red ≥ Z_STRONG).
export function syntheticDroopSeries(baseLandmarks, mmSteps = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10], opts = {}) {
  const { W = 640, H = 480, smileUpMm = 5, smileOutMm = 4 } = opts;
  const base = baseLandmarks?.length >= 468 ? baseLandmarks : defaultFaceLandmarks(W, H);
  const frame = faceFrame(base, W, H);
  const I = FACE_IDX, lipW = [0.6, 0.35, 0.15];

  const rows = mmSteps.map(mm => {
    const rest = base.map(q => ({ ...q }));
    shift(rest, I.lMouth, 0, mm, frame, W, H);
    I.lLowerLip.forEach((i, k) => shift(rest, i, 0, mm * lipW[k], frame, W, H));
    // smile: healthy (right) corner moves up/out fully; drooping (left) side moves less as droop grows
    const k = Math.max(0, 1 - mm / 8);
    const smile = rest.map(q => ({ ...q }));
    shift(smile, I.rMouth, -smileOutMm, -smileUpMm, frame, W, H);
    shift(smile, I.lMouth, smileOutMm * k, -smileUpMm * k, frame, W, H);
    const { metrics } = summarizeFace([faceFrameFeatures(rest, W, H)], [faceFrameFeatures(smile, W, H)]);
    return { mm, ...metrics };
  });

  const z0 = rows[0] ?? {};
  return rows.map(r => {
    const zRest = (r.mouthAsymRest - z0.mouthAsymRest) / SD_FLOOR.mouthAsymRest;
    const zSmileAsym = (r.mouthAsymSmile - z0.mouthAsymSmile) / SD_FLOOR.mouthAsymSmile;
    const zExcursion = ((z0.smileExcursionRatio ?? 0) - (r.smileExcursionRatio ?? 0)) / SD_FLOOR.smileExcursionRatio;
    const zMax = Math.max(zRest, zSmileAsym, zExcursion);
    const round = x => Math.round(x * 100) / 100;
    return {
      ...r, zRest: round(zRest), zSmileAsym: round(zSmileAsym), zExcursion: round(zExcursion),
      level: zMax >= Z_STRONG ? 'red' : zMax >= Z_OFF ? 'yellow' : 'green',
    };
  });
}

// checks: stored checks [{ id, at, face, speech, arms, score }] → CSV string
export function checksToCSV(checks = []) {
  const metricKeys = Object.keys(METRICS);
  const header = ['id', 'at', 'level', 'face', 'speech', 'arms', ...metricKeys,
    ...metricKeys.map(m => `z_${m}`), 'faceOk', 'speechOk', 'armsOk'];
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = checks.map(c => [
    c.id, c.at, c.score?.level, c.score?.domains?.face, c.score?.domains?.speech, c.score?.domains?.arms,
    ...metricKeys.map(m => c[METRICS[m].domain]?.metrics?.[m]),
    ...metricKeys.map(m => c.score?.z?.[m]),
    c.face?.quality?.ok, c.speech?.quality?.ok, c.arms ? c.arms.quality?.ok : '',
  ].map(esc).join(','));
  return [header.join(','), ...lines].join('\n');
}
