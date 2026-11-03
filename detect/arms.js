// detect/arms.js — arm drift check with MediaPipe PoseLandmarker (lite).
// The person holds both arms straight out, palms up, eyes closed, for ~10 s.
// We track each wrist's height relative to the SHOULDER LINE (in the body's own
// frame, so leaning/tilting the camera matters less), normalised by shoulder width.
//
// LEFT/RIGHT = the PERSON's left/right. MediaPipe Pose labels landmarks from the
// subject's point of view (11 = left shoulder, 15 = left wrist) on the raw,
// un-mirrored camera frame; mirroring the preview with CSS doesn't change that.

import { createTask, videoLoop } from './face.js';

const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const L_SH = 11, R_SH = 12, L_WR = 15, R_WR = 16;
const SETTLE_MS = 1500; // time to get the arms up
const WINDOW_MS = 1000; // "first second" and "last second" windows

let posePromise = null;
export function initPose() {
  posePromise ??= createTask('PoseLandmarker', POSE_MODEL, { numPoses: 1 })
    .catch(e => { posePromise = null; throw e; });
  return posePromise;
}

// Wrist heights below the shoulder line, in shoulder widths (+ = lower). Pure.
export function armFrame(pts, W = 640, H = 480) {
  if (![L_SH, R_SH, L_WR, R_WR].every(i => pts[i] && (pts[i].visibility ?? 1) > 0.5)) return null;
  const p = i => [pts[i].x * W, pts[i].y * H];
  const ls = p(L_SH), rs = p(R_SH);
  const sw = Math.hypot(ls[0] - rs[0], ls[1] - rs[1]);
  if (sw < 1) return null;
  const xa = [(ls[0] - rs[0]) / sw, (ls[1] - rs[1]) / sw]; // person's right → left shoulder
  const ya = [-xa[1], xa[0]]; // down the body
  const o = [(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2];
  const v = q => ((q[0] - o[0]) * ya[0] + (q[1] - o[1]) * ya[1]) / sw;
  return { left: v(p(L_WR)), right: v(p(R_WR)) };
}

const median = xs => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
const r4 = x => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);

// samples: [{t (ms since start), left, right}] → metrics. Pure.
export function summarizeArms(samples, framesSeen, durationMs) {
  const early = samples.filter(s => s.t >= SETTLE_MS && s.t < SETTLE_MS + WINDOW_MS);
  const late = samples.filter(s => s.t >= durationMs - WINDOW_MS);
  const drop = side => median(late.map(s => s[side])) - median(early.map(s => s[side]));
  const leftDrop = drop('left'), rightDrop = drop('right');
  const ok = early.length >= 3 && late.length >= 3 && samples.length >= 0.6 * framesSeen;
  return {
    metrics: { leftDrop: r4(leftDrop), rightDrop: r4(rightDrop), dropAsym: r4(Math.abs(leftDrop - rightDrop)) },
    detail: { weakerSide: Number.isFinite(leftDrop - rightDrop) ? (leftDrop > rightDrop ? 'left' : 'right') : null, earlyFrames: early.length, lateFrames: late.length },
    quality: { framesUsed: samples.length, ok },
  };
}

export async function runArmCheck(video, { durationMs = 10000, onFrame } = {}) {
  const pose = await initPose();
  const W = video.videoWidth || 640, H = video.videoHeight || 480;
  const samples = [];
  let frames = 0;
  await videoLoop(video, durationMs, (ts, el) => {
    frames++;
    const pts = pose.detectForVideo(video, ts).landmarks?.[0];
    if (!pts) return;
    onFrame?.(pts);
    const s = armFrame(pts, W, H);
    if (s) samples.push({ t: el, ...s });
  });
  return summarizeArms(samples, frames, durationMs);
}
