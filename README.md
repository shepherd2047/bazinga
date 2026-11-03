# SteadyCheck (team bazingga)

Stroke aftercare web app for survivors and their families, built at **The AI Will See You Now** hackathon (Nov 2, 2026).

- **Prevent:** blood-pressure log with a 130/80 target, medication checklist, adherence, and a printable weekly summary for the doctor.
- **Detect early:** a 30-second daily face (smile symmetry) and speech (pace, pauses) check, compared to the person's **own baseline** → green / yellow / red. Red shows Call 911, records the time and alerts family (simulated).
- **Safety:** never diagnoses or reassures. "Feeling something wrong?" goes straight to 911 with no test. A symptom screen runs before baseline recording, and an abnormal-looking baseline must be confirmed. Video and audio are processed in the browser and never stored or uploaded.

Science and thresholds: [SCIENCE.md](SCIENCE.md). Architecture: [SPEC.md](SPEC.md).

## Run
```bash
python3 -m http.server 8000
```
Open http://localhost:8000/?demo=1 in Chrome and allow the camera and microphone.

Not a medical device. Prototype only.
