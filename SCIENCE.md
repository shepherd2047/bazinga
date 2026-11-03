# SteadyCheck: the science behind each signal

SteadyCheck **does not diagnose and is not a medical device**. It compares today's face, speech and arm measurements with the person's **own** recent baseline and escalates when something changes. **Comparing a person at home with their own baseline is an unvalidated hypothesis.** The papers below support *which signs* matter (face, arm, speech: the Cincinnati / FAST items). None of them validates this app or a webcam measured against a personal baseline. Any sudden symptom means calling 911 straight away, without doing the check first.

## Why these three signs

| Claim | Source | Status |
|---|---|---|
| Face droop, arm drift and abnormal speech are the three prehospital stroke signs. Any one abnormal item gives sensitivity ≈66% and specificity ≈87% for stroke. Inter-rater ICC: face 0.75, arm 0.91, speech 0.84. | Kothari et al., *Ann Emerg Med* 1999 (Cincinnati Prehospital Stroke Scale) | verified |
| FAST alone misses about 14% of strokes, mainly posterior strokes that show up as balance or vision problems. Adding Balance and Eyes (BE-FAST) catches more. **SteadyCheck does not test balance or eyes (vision).** | Aroor et al., *Stroke* 2017 | verified (this is a limitation) |
| Every minute an untreated large-vessel stroke goes on costs about 1.9 million neurons, so fast escalation matters. | Saver, *Stroke* 2006, "Time is brain—quantified" | verified |
| After a TIA or minor stroke, the risk of a stroke is 1.5% at 2 days, 2.1% at 7 days, 3.7% at 90 days and 5.1% at 1 year. That makes early daily monitoring a reasonable thing to try. | Amarenco et al., *NEJM* 2016 (TIAregistry.org) | verified |
| Automated facial asymmetry from landmarks (Emotrics, 68 points) agrees with clinician eFACE grading. | Guarin, Hadlock et al., *JAMA Facial Plast Surg* 2018 | verified |
| In post-stroke dysarthria, inappropriate pauses (longer than 3 s, or in the middle of a word) are a marker that can be detected automatically. | ICASSP 2024, arXiv 2402.18923 | verified |
| An app reading face, arm and speech (FAST.AI, UCLA, Raychev) reported about 97% accuracy for face asymmetry, about 72% for arm and about 75% for speech. | ISC 2023 conference abstract | **conference only, no peer-reviewed paper found** |
| Syllable nuclei can be counted as intensity peaks that rise at least 2 dB above the preceding dip. | de Jong & Wempe, *Behav Res Methods* 2009 (Praat syllable-nuclei script) | from general knowledge, unverified |
| Pronator drift, where an outstretched arm drifts down with palms up and eyes closed, is a sensitive sign of upper-limb weakness. | Standard neurological exam (NIHSS item 5 uses a 10 s hold) | from general knowledge, unverified |

## Metrics and thresholds

All face metrics are measured in the face's own frame: the eye axis plus the perpendicular midline, scaled by inter-ocular distance (IOD ≈ 63 mm). This keeps them independent of camera distance and head roll. Frames where the head is turned (nose more than 0.25 IOD off the midline) are dropped. Per-frame values are combined with a 10% trimmed mean. Arm metrics use the shoulder line and shoulder width (≈ 40 cm). "Left" and "right" always mean the **person's** sides. MediaPipe works on the raw, un-mirrored camera frame, so mirroring the preview has no effect.

| Metric | What it measures | Worse when | SD floor | Paper backing | Threshold rationale |
|---|---|---|---|---|---|
| `mouthAsymRest` | Vertical offset between the two mouth corners, measured relative to the eye line, at rest (IOD units) | higher | 0.02 (≈1.3 mm) | Kothari 1999 (face droop); Guarin 2018 (landmark asymmetry) | Webcam landmark jitter after averaging is ≈1 mm, so the floor sits just above it. |
| `mouthAsymSmile` | The same offset at peak smile | higher | 0.03 (≈1.9 mm) | same | Smiles vary more from day to day than the resting face. |
| `smileExcursionRatio` | min/max of how far the left and right mouth corners move from rest to smile (1.0 = symmetric) | lower | 0.10 | Kothari 1999 ("show teeth or smile"); FAST.AI (conference) | **Most stroke-relevant face signal**: one-sided weakness shows up in movement. Yellow at a drop of 0.3 below baseline, red at 0.5. Below 0.03 IOD of movement counts as "no smile seen", and the check must be redone. |
| `eyeAsym` | Relative difference between left and right eyelid opening at rest, ignoring blinks | higher | 0.08 | from general knowledge, unverified (ptosis is not a CPSS item) | Contributes to yellow only, never to red on its own. |
| `speechSec` | Time from first speech onset to last speech offset for the fixed CPSS sentence | higher | 0.4 s | Kothari 1999 (speech item) | Slurred or slowed speech takes longer. |
| `pauseCount` | Silent gaps of 250 ms or more between speech segments | higher | 0.7 | ICASSP 2024 (pauses in dysarthria) | Normal readers make 0–2 pauses in this sentence. |
| `longestPauseSec` | Longest such gap | higher | 0.3 s | ICASSP 2024 (>3 s = inappropriate) | Relative to baseline. A pause over 3 s will almost always exceed z 3. |
| `syllableRate` | Syllable nuclei per second of voiced time (articulation rate) | lower | 0.6 syl/s | de Jong & Wempe 2009 (unverified) | Typical rate is ≈4–5 syl/s, so the floor is ≈13%. No pitch check, so counts are approximate. |
| `onsetLatencySec` | Time from start of recording to first speech | higher | 0.8 s | from general knowledge, unverified | This is behavioral and noisy, so the floor is large. |
| `leftDrop` / `rightDrop` | Fall in wrist height below the shoulder line, from the 1st second (after a 1.5 s settle) to the last second (shoulder widths) | higher | 0.08 (≈3 cm) | Kothari 1999 (arm drift, ICC 0.91) | A floor of ≈3 cm means yellow needs about 10 cm more drift than usual. |
| `dropAsym` | \|leftDrop − rightDrop\| | higher | 0.08 | same | Drift on one side is the stroke pattern. Both arms tiring together is not. |

**Speech pipeline.** Mic audio is cut into ~20 ms RMS frames and smoothed over 60 ms. The noise floor adapts: it is the median of the first 0.5 s, capped at the 10th percentile of the whole take. Speech starts at the floor + max(10 dB, 35% of the dynamic range) and has 4 dB of hysteresis. Gaps under 250 ms are merged and blips under 80 ms are dropped. Audio is never stored, and Web Speech API is never used.

## Level rules (`detect/scoring.js`)

- `z = direction × (value − baseline mean) / max(baseline SD, SD floor)`. Only worsening counts.
- A metric is **off** when z ≥ **3**. A domain is **yellow** if any of its metrics is off.
- **Red** applies when any of the following holds:
  - a face-asymmetry metric (`mouthAsymRest`, `mouthAsymSmile`, `smileExcursionRatio`) reaches z ≥ **5** (strong face change);
  - `dropAsym` reaches z ≥ 5 **and** is at least 0.25 shoulder widths;
  - **two or more domains** are off;
  - the previous check within 2 h was yellow because of a real change and this one is yellow again ("yellow twice in a row");
  - the previous check within 2 h was red ("red never downgrades").
- **Never green on missing data.** Poor quality, a missing face or speech result, no baseline, or no visible smile gives yellow with a "couldn't measure, please redo" reason. Measurement failures alone never escalate to red. Arms are optional: skipping them gives `skipped`, not yellow.
- The SD floors mean a 1–3-check baseline (where the sample SD is about 0) can't false-alarm on ordinary jitter.

**Synthetic dose-response** (`syntheticDroopSeries`, built-in face, single baseline): pulling the left mouth corner down and weakening that side's smile turns the score yellow at about **3 mm** and red at about **4–5 mm** of droop. This only checks the measurement pipeline. It is not clinical validation.

## Known limitations

- No balance or eye (vision) testing; BE-FAST shows FAST alone misses about 14% of strokes.
- Thresholds are engineering choices. They have not been tuned on patients and the false-alarm rate is unknown. The Validation page's false-alarm count on the person's own green days is the only in-app check.
- Lighting, glasses, beards, facial palsy from an earlier stroke, dentures, a cold, and fatigue can all shift the measurements.
- Syllable counting has no voicing check, so background noise can add false "syllables".
