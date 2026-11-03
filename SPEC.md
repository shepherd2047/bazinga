# SteadyCheck — architecture spec

Hackathon build (~2 h). Stroke aftercare web app for a survivor (e.g. a dad home after a minor stroke) and their family.
Two jobs: **prevent** the next stroke (BP + meds log) and **detect early** (60-second daily face / speech / arm check vs. the person's own baseline).
It never predicts, never diagnoses, never reassures. Permanent banner: "Any sudden symptoms → call 911 now. Don't wait for this app."

## Tech constraints
- Plain static site, **no build step**, ES modules (`<script type="module">`). Served by `python3 -m http.server 8000` from the project root; open `http://localhost:8000`.
- Laptop Chrome is the demo target (webcam + mic). Must still lay out OK at phone width.
- External scripts only from cdn.jsdelivr.net / cdnjs, pinned versions:
  - MediaPipe: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14` (FaceLandmarker, PoseLandmarker; WASM at `.../wasm`, models from `https://storage.googleapis.com/mediapipe-models/...`).
  - Charts (optional): Chart.js 4.4.1 from cdn.jsdelivr.
- **Privacy:** video/audio are processed in the browser and never stored or uploaded. Only numeric metrics go to localStorage. No Web Speech API (Chrome sends audio to Google).

## File layout and ownership
```
index.html            UI agent   – app shell, nav, banner, mounts pages
styles.css            UI agent
app.js                UI agent   – hash router + page renderers
store.js              UI agent   – localStorage wrapper (schema below) + seedDemoData()
pages/*.js            UI agent   – one module per page (optional split)
detect/face.js        Logic agent
detect/speech.js      Logic agent
detect/arms.js        Logic agent
detect/scoring.js     Logic agent
detect/validation.js  Logic agent
detect/test.html      Logic agent – standalone harness to exercise the detectors
SCIENCE.md            Logic agent – which paper backs each metric/threshold
```
Neither agent edits the other's files. If a contract below must change, keep it backward compatible and note it at the bottom of this file under "Contract changes".

## Detection API (contract between the two agents)
All functions are async, take a live `<video>` element that the UI already attached to `getUserMedia`, and never store media.

```js
// detect/face.js
export async function initFace()                       // loads FaceLandmarker once
export async function runFaceCheck(video, { durationMs = 12000, onPhase, onFrame } = {})
//  Guides two phases: 'rest' (first half) then 'smile' (second half). onPhase('rest'|'smile') lets UI show the prompt.
//  onFrame(landmarks) optional, for drawing an overlay.
//  → { metrics: { mouthAsymRest, mouthAsymSmile, smileExcursionRatio, eyeAsym }, quality: { framesUsed, faceFoundPct, ok } }

// detect/speech.js
export async function runSpeechCheck({ durationMs = 10000, onLevel } = {})
//  Opens the mic itself, records the user reading the fixed sentence, Web Audio energy analysis only.
//  export const SENTENCE = "You can't teach an old dog new tricks."   (or similar fixed sentence)
//  onLevel(0..1) for a live meter.
//  → { metrics: { speechSec, pauseCount, longestPauseSec, syllableRate, onsetLatencySec }, quality: { ok, peakLevel } }

// detect/arms.js
export async function initPose()
export async function runArmCheck(video, { durationMs = 10000, onFrame } = {})
//  User holds both arms out, palms up, eyes closed. Measures wrist/elbow drop relative to shoulders.
//  → { metrics: { leftDrop, rightDrop, dropAsym }, quality: { framesUsed, ok } }

// detect/scoring.js
export function buildBaseline(checks)        // checks: array of { face, speech, arms } results → baseline { mean, sd, n } per metric
export function scoreCheck(check, baseline)  // → { level: 'green'|'yellow'|'red', z: {metric: number}, reasons: [plain-English strings], domains: { face, speech, arms } each 'green'|'yellow'|'red'|'skipped' }
export const SD_FLOOR                         // per-metric minimum SD so a 1–3 sample baseline doesn't false-alarm

// detect/validation.js
export function syntheticDroopSeries(baseLandmarks, mmSteps)   // graded artificial droop → asymmetry scores, for the dose-response chart
export function checksToCSV(checks)                             // export for the mini-study / false-alarm count
```

Level rules (logic agent finalizes and documents in SCIENCE.md): compare to own baseline (z-scores with SD floors); a single domain clearly off → yellow ("rest, redo in 5 min"); a strong face change, or two domains off, or yellow twice in a row → red. Red never downgrades. Missing/poor-quality data is **never** treated as green.

## Data (store.js, localStorage key `steadycheck.v1`)
```js
{
  profile:  { name, familyContacts: [{ name, phone }], meds: [{ id, name, dose, times: ["08:00"] }] },
  baseline: { createdAt, checks: [check], stats },     // stats = buildBaseline(checks)
  checks:   [{ id, at, face, speech, arms, score }],   // score = scoreCheck(...)
  bp:       [{ at, sys, dia, pulse }],
  doses:    [{ at, medId, taken: true }],
  alerts:   [{ at, kind: 'red'|'yellow'|'missed'|'emergency', note }],
  emergencies: [{ at, symptomNoticedAt }]
}
```
`seedDemoData()` fills ~14 days of plausible history (BP drifting slightly high, a couple of missed doses, green checks) so the dashboard demos well.

## Pages (hash routes)
| Route | Page | Purpose |
|---|---|---|
| `#/` | **Home** | Two big buttons: red **"Feeling something wrong right now?"** → `#/emergency` (no test!), and **"Do my daily check"** → `#/check`. Today's status (check done? color), meds to take today (tap to mark taken), quick BP entry. |
| `#/setup` | **Setup** | Name, family contacts, meds list. First-run redirect target. "Load demo data" button. |
| `#/baseline` | **Record baseline** | Explains why ("we compare you to *your* normal"). Runs the check flow 2–3 times, saves `baseline`. |
| `#/check` | **Daily check** | Stepper: Face (rest → smile) → Speech (read sentence) → Arms (optional, skippable) → computes score → `#/result/:id`. Live camera with landmark overlay, mic meter, countdowns. |
| `#/result/:id` | **Result** | Green: "Same as your usual." Yellow: "A bit different — rest and redo in 5 min" + timer button. Red: full-screen, **Call 911** (`tel:911`), records `symptomNoticedAt`, shows "Family alerted" (simulated), lists which signs changed in plain English. Never says "you're fine". |
| `#/emergency` | **Emergency** | Immediate Call 911, records time noticed, alerts family (simulated), BE-FAST reminder (balance, eyes, face, arms, speech, time). Note: "Note the time — doctors need it." |
| `#/log` | **Prevention log** | BP entry + 14-day chart with 130/80 target line; meds checklist + adherence %. |
| `#/family` | **Family view** | Feed: "Dad checked in, green, 8:01", alerts, missed checks; check-result trend per domain. |
| `#/report` | **Doctor summary** | One-page printable weekly summary (BP trend, adherence, check results, alerts). Plain language. |
| `#/validation` | **Validation** (hidden link in footer) | Dose-response chart from `syntheticDroopSeries`; false-alarm count over stored green-day checks; CSV export. |
| `#/science` | **Science** | Plain-language evidence table with citations (from SCIENCE.md). |

Persistent elements: top 911 banner, bottom nav (Home, Log, Family, Report), footer links to Science and Validation.

## Contract changes
(none yet)

### Logic agent additions (all backward compatible — nothing removed or renamed)
- All three detector results gain an optional `detail` object. face: `{ weakerSide, lowerCornerSide, excursionLeft, excursionRight, restFrames, smileFrames }`; speech: `{ syllables, expectedSyllables, voicedSec, noiseFloorDb, thresholdDb }`; arms: `{ weakerSide, earlyFrames, lateFrames }`. Sides are the PERSON's left/right. Store the whole result object so `scoreCheck` can name the side in reasons.
- face `quality` also has `smileSeen` (false → smileExcursionRatio is `null`, scored as "couldn't measure, redo"). speech `quality` also has `truncated` and `reason: 'no-speech'`. When speech quality fails, metric values are `null`.
- `scoreCheck(check, baseline, opts?)`: `baseline` may be the stats object, the `{ stats }` wrapper, or an array of baseline checks. Optional `opts = { previous: lastStoredCheck /* {at, score} */, now }` turns on the "yellow twice in a row → red" and "red never downgrades" rules (2 h window). The return value also has `offDomains` and `unmeasured` counts. `check.arms` = `null`/`undefined` → domain `'skipped'`.
- Extra exports: scoring `METRICS, Z_OFF (3), Z_STRONG (5)`; speech `SENTENCE_SYLLABLES, analyzeEnergy`; validation `defaultFaceLandmarks, IPD_MM`; face/arms pure helpers (`faceFrameFeatures, summarizeFace, armFrame, summarizeArms`).
- `syntheticDroopSeries(baseLandmarks, mmSteps, opts?)`: `baseLandmarks` may be `null` (built-in synthetic face) or the last array from face `onFrame`. `mmSteps` defaults to `[0,0.5,1,1.5,2,3,4,5,6,8,10]`; `opts = { W, H }` is the video size. Returns `[{ mm, mouthAsymRest, mouthAsymSmile, smileExcursionRatio, eyeAsym, zRest, zSmileAsym, zExcursion, level }]`. Plot `mm` against `zExcursion`/`zRest`, with yellow at 3 and red at 5.
- Call `initFace()` / `initPose()` early: each model load takes about 4–5 s on first use.
