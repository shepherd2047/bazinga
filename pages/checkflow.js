// The 60-second check stepper (Face → Speech → Arms), shared by Daily check and Record baseline.
// One getUserMedia video stream is used for face + arms; all tracks are stopped on finish/leave.
import { loadAll, simulateCheck, session } from './detectors.js';
import { esc, isDemoMode } from './ui.js';
import { update } from '../store.js';

const FACE_MS = 12000, SPEECH_MS = 10000, ARMS_MS = 10000;
const ARMS_ENABLED = false;
const FALLBACK_SENTENCE = "You can't teach an old dog new tricks.";

export function mountCheckFlow(root, { mode = 'daily', stats = null, onComplete, intro = '' }) {
  let cancelled = false, armsAborted = false, stream = null, timers = [], fileUrl = null, usingFile = false;
  const demo = isDemoMode();
  root.innerHTML = `
    <ol class="stepper" aria-label="Steps">
      <li data-step="face">1 Face</li><li data-step="speech">2 Speech</li>
    </ol>
    <div class="stage" id="stage">
      <video playsinline muted autoplay></video>
      <canvas aria-hidden="true"></canvas>
      <div class="nocam">Camera is off. It turns on when you press Start.<br>Video stays on this device and is never saved.</div>
      <div class="countdown hidden" aria-live="off"></div>
      <div class="prompt" aria-live="assertive"></div>
    </div>
    <details class="srcpick" id="srcPick">
      <summary>Demo source: <span id="srcLabel">Live camera</span></summary>
      <div class="srcbody">
        <label class="inline-check"><input type="radio" name="src" value="live" checked> Live camera</label>
        <label class="inline-check"><input type="radio" name="src" value="file"> Video file (pre-recorded, plays with sound)</label>
        <input type="file" accept="video/*" id="srcFile" class="hidden">
        <p class="small muted" style="margin:4px 0 0">The file is played on this device only and is not uploaded or saved.</p>
      </div>
    </details>
    <div id="panel"></div>
    ${mode === 'daily' && demo ? `<div class="demo-box"><span class="demo-tag">Demo control</span>
      <label class="inline-check"><input type="checkbox" id="demoStroke"> Simulate stroke signs (for the on-stage demo only — changes the numbers on purpose)</label>
      <button class="btn secondary" id="demoReset" type="button">Clear today's check results (rehearsal reset)</button>
      <p class="small muted" style="margin:4px 0 0">A red result stays red for 2 hours. Clear it after rehearsing so the next normal check can be green.</p></div>` : ''}`;
  const $ = (s) => root.querySelector(s);
  const video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d');
  const promptEl = $('.prompt'), cdEl = $('.countdown'), panel = $('#panel'), nocam = $('.nocam');
  const prompt = (t) => { promptEl.textContent = t || ''; };
  const setStep = (name) => {
    const order = ['face', 'speech', 'arms'];
    root.querySelectorAll('.stepper li').forEach((li) => {
      const i = order.indexOf(li.dataset.step), j = order.indexOf(name);
      li.classList.toggle('active', i === j); li.classList.toggle('done', j > i || name === 'done');
    });
  };
  const demoStroke = () => !!(root.querySelector('#demoStroke') || {}).checked;
  const resetBtn = root.querySelector('#demoReset');
  if (resetBtn) resetBtn.onclick = () => {
    const today = new Date().toDateString();
    update((st) => { st.checks = st.checks.filter((c) => new Date(c.at).toDateString() !== today); });
    resetBtn.textContent = '✓ Cleared';
  };

  // Spoken instructions (browser text-to-speech). Never used while the mic is recording.
  let voiceOn = true;
  try { voiceOn = localStorage.getItem('steadycheck.voice') !== 'off'; } catch {}
  function speak(text) {
    if (!voiceOn || cancelled || !window.speechSynthesis) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.92; u.lang = 'en-US';
      const done = () => { clearTimeout(t); resolve(); };
      // Chrome sometimes never fires onend; fall back to an estimate.
      const t = setTimeout(done, 1500 + text.length * 85);
      u.onend = done; u.onerror = done;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    });
  }
  // Show on screen and say it.
  const say = (text, spoken = text) => { prompt(text); return speak(spoken); };

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; video.srcObject = null;
    if (usingFile) { video.pause(); video.removeAttribute('src'); video.load(); }
    if (fileUrl) { URL.revokeObjectURL(fileUrl); fileUrl = null; }
    usingFile = false; video.muted = true;
    nocam.classList.remove('hidden');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  function clearTimers() { timers.forEach(clearInterval); timers = []; cdEl.classList.add('hidden'); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function runTimer(ms) {
    const end = Date.now() + ms;
    cdEl.classList.remove('hidden');
    const tick = () => { const s = Math.max(0, Math.ceil((end - Date.now()) / 1000)); cdEl.textContent = `${s}s`; };
    tick(); const t = setInterval(tick, 200); timers.push(t);
    return () => { clearInterval(t); cdEl.classList.add('hidden'); };
  }
  async function countdown(text, n = 3) {
    for (let i = n; i > 0 && !cancelled; i--) { prompt(`${text} … ${i}`); await sleep(1000); }
  }
  function beep(freq = 880, ms = 250) {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = freq; g.gain.value = 0.15;
      o.connect(g); g.connect(ac.destination); o.start(); setTimeout(() => { o.stop(); ac.close(); }, ms);
    } catch {}
  }

  function toPoints(lm) {
    if (!lm) return null;
    if (lm.faceLandmarks) lm = lm.faceLandmarks[0];
    else if (lm.landmarks) lm = lm.landmarks[0];
    if (Array.isArray(lm) && Array.isArray(lm[0])) lm = lm[0];
    return Array.isArray(lm) ? lm : null;
  }
  function draw(lm, color, keep) {
    const pts = toPoints(lm);
    if (!pts) return;
    if (keep) session[keep] = pts.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    const w = video.videoWidth || 640, h = video.videoHeight || 480;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = color;
    const r = pts.length > 100 ? 1.6 : 6;
    for (const p of pts) { if (p == null || p.x == null) continue; ctx.beginPath(); ctx.arc(p.x * w, p.y * h, r, 0, 6.283); ctx.fill(); }
  }

  // Low-key demo source switch: live camera or a pre-recorded video file.
  const srcFile = $('#srcFile');
  const srcMode = () => (root.querySelector('input[name=src]:checked') || {}).value || 'live';
  root.querySelectorAll('input[name=src]').forEach((r) => r.addEventListener('change', () => {
    srcFile.classList.toggle('hidden', srcMode() !== 'file');
    if (srcMode() === 'file' && !srcFile.files.length) srcFile.click();
    updateSrcLabel();
  }));
  srcFile.addEventListener('change', updateSrcLabel);
  function updateSrcLabel() {
    const f = srcFile.files && srcFile.files[0];
    $('#srcLabel').textContent = srcMode() === 'file' ? (f ? `Video file — ${f.name}` : 'Video file (choose one)') : 'Live camera';
  }

  let mods = null;
  const result = { face: null, speech: null, arms: null };

  // ---------- intro ----------
  async function showIntro() {
    setStep('none');
    prompt('');
    panel.innerHTML = `
      ${intro}
      <div class="card">
        <h2 style="margin-top:0">About 60 seconds</h2>
        <ol>
          <li><strong>Face:</strong> relax your face, then smile big.</li>
          <li><strong>Speech:</strong> read one sentence out loud.</li>
        </ol>
        <p class="muted small">Sit in good light, face the camera. Camera and microphone are processed on this device only; nothing is recorded or uploaded.</p>
        <label class="inline-check"><input type="checkbox" id="voiceToggle" ${voiceOn ? 'checked' : ''}> 🔊 Read the instructions out loud</label>
        <ul class="status-list" id="modStatus"><li>Loading detectors…</li></ul>
        <div id="introWarn"></div>
        <div class="btn-row"><button class="btn big" id="startBtn" disabled>Start check</button></div>
        <div id="simRow"></div>
      </div>`;
    mods = await loadAll();
    if (cancelled) return;
    // Warm up the models now (each takes ~4–5 s on first use).
    if (mods.face && mods.face.initFace) Promise.resolve().then(() => mods.face.initFace()).catch((e) => console.warn('initFace', e));
    if (mods.arms && mods.arms.initPose) Promise.resolve().then(() => mods.arms.initPose()).catch((e) => console.warn('initPose', e));
    const status = [['face', 'Face detector'], ['speech', 'Speech detector'], ['arms', 'Arm detector'], ['scoring', 'Scoring']];
    $('#modStatus').innerHTML = status.map(([k, l]) => `<li>${mods[k] ? '✓' : '✕'} ${l}: ${mods[k] ? 'ready' : '<strong>unavailable</strong>'}</li>`).join('');
    const missing = status.filter(([k]) => !mods[k]).map(([, l]) => l.toLowerCase());
    const core = mods.face || mods.speech;
    if (missing.length) {
      $('#introWarn').innerHTML = `<div class="warn"><strong>Detector unavailable:</strong> ${esc(missing.join(', '))}. ${core ? 'Parts that cannot be measured will not count as normal.' : 'A real check cannot run right now.'}</div>`;
    }
    $('#voiceToggle').onchange = (e) => {
      voiceOn = e.target.checked;
      try { localStorage.setItem('steadycheck.voice', voiceOn ? 'on' : 'off'); } catch {}
    };
    $('#startBtn').disabled = !core;
    $('#startBtn').onclick = start;
    if (missing.length || demo) {
      $('#simRow').innerHTML = `<div class="demo-box"><span class="demo-tag">Demo</span>
        <p class="small">Produces made-up numbers near ${stats ? 'the saved baseline' : 'typical values'} so the rest of the app can be shown. Not a real check.</p>
        <button class="btn secondary block" id="simBtn">Simulate result (demo)</button></div>`;
      $('#simBtn').onclick = () => finish(simulateCheck(stats, { includeArms: ARMS_ENABLED }), true);
    }
  }

  // ---------- run ----------
  async function start() {
    panel.innerHTML = `<div class="card" id="stepCard"></div>`;
    const file = srcMode() === 'file' && srcFile.files && srcFile.files[0];
    if (srcMode() === 'file' && !file) {
      panel.innerHTML = `<div class="warn">Choose a video file under “Demo source”, or switch back to Live camera.</div><div class="btn-row"><button class="btn" id="retry">Try again</button></div>`;
      $('#srcPick').open = true; $('#retry').onclick = start; return;
    }
    $('#srcPick').classList.add('hidden');
    if (file) {
      try {
        fileUrl = URL.createObjectURL(file); usingFile = true;
        video.srcObject = null; video.muted = false; video.loop = false; video.playsInline = true;
        video.src = fileUrl;
        await new Promise((r, j) => { video.addEventListener('loadeddata', r, { once: true }); video.addEventListener('error', () => j(new Error('This video file cannot be played')), { once: true }); });
        if (cancelled) { stopCamera(); return; }
        video.pause(); video.currentTime = 0; nocam.classList.add('hidden');
      } catch (e) {
        stopCamera(); $('#srcPick').classList.remove('hidden');
        panel.innerHTML = `<div class="warn"><strong>Video file problem.</strong> ${esc(e.message)}</div><div class="btn-row"><button class="btn" id="retry">Try again</button></div>`;
        $('#retry').onclick = start; return;
      }
    } else try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
      if (cancelled) { stopCamera(); return; }
      video.srcObject = stream; nocam.classList.add('hidden');
      await video.play().catch(() => {});
      await new Promise((r) => (video.readyState >= 2 ? r() : video.addEventListener('loadeddata', r, { once: true })));
    } catch (e) {
      console.warn('camera error', e);
      $('#srcPick').classList.remove('hidden');
      panel.innerHTML = `<div class="warn"><strong>Camera not available.</strong> ${esc(e.message || e.name)}. Allow camera access in the browser bar and try again.</div>
        <div class="btn-row"><button class="btn" id="retry">Try again</button><button class="btn secondary" id="sim">Simulate result (demo)</button></div>`;
      $('#retry').onclick = start; $('#sim').onclick = () => finish(simulateCheck(stats, { includeArms: ARMS_ENABLED }), true);
      return;
    }
    await stepFace(); if (cancelled) return;
    await stepSpeech(); if (cancelled) return;
    // Arm test switched off for now (ARMS_ENABLED); stepArms() is kept for later.
    if (ARMS_ENABLED) stepArms(); else { result.arms = null; finish(result, false); }
  }

  async function stepFace() {
    setStep('face');
    const card = $('#stepCard');
    if (!mods.face) { result.face = { metrics: null, quality: { ok: false, reason: 'detector unavailable' } }; return; }
    card.innerHTML = `<h2 style="margin-top:0">Step 1 · Face</h2><p>Look straight at the camera. Follow the words on the screen.</p>`;
    try {
      prompt('Loading face model…');
      await mods.face.initFace();
      if (cancelled) return;
      await say('Look straight at the camera', 'Step one, your face. Look straight at the camera and keep your head still.');
      if (cancelled) return;
      await countdown('Look at the camera');
      if (cancelled) return;
      if (usingFile) await video.play().catch((e) => console.warn('video play', e));
      const stop = runTimer(FACE_MS);
      result.face = await mods.face.runFaceCheck(video, {
        durationMs: FACE_MS,
        onPhase: (p) => (p === 'smile'
          ? say('Now smile big 😁', 'Now give a big smile, show your teeth, and hold it.')
          : say('Relax your face', 'Relax your face.')),
        onFrame: (lm) => draw(lm, '#5fe3a1', 'lastFaceLandmarks'),
      });
      stop();
    } catch (e) {
      console.error('face check failed', e);
      result.face = { metrics: null, quality: { ok: false, reason: String(e.message || e) } };
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (result.face && result.face.quality && result.face.quality.ok === false) prompt('Face not measured well — continuing');
  }

  async function stepSpeech() {
    setStep('speech');
    const card = $('#stepCard');
    if (!mods.speech) { result.speech = { metrics: null, quality: { ok: false, reason: 'detector unavailable' } }; return; }
    const sentence = mods.speech.SENTENCE || FALLBACK_SENTENCE;
    card.innerHTML = `<h2 style="margin-top:0">Step 2 · Speech</h2>
      <p>When the timer starts, read this out loud in your normal voice:</p>
      <div class="sentence">“${esc(sentence)}”</div>
      <p class="small muted" style="margin-bottom:4px">Microphone level</p>
      <div class="meter" role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="100"><div id="lvl"></div></div>`;
    const lvl = $('#lvl'), meter = $('.meter');
    try {
      await say('Get ready to read', `Step two, your speech. You can stop smiling. When the timer starts, read the sentence on the screen out loud in your normal voice: ${sentence}`);
      if (cancelled) return;
      await countdown('Get ready to read');
      if (cancelled) return;
      // The mic records next, so this one is on screen only.
      prompt('🎤 Read the sentence now');
      const stop = runTimer(SPEECH_MS);
      result.speech = await mods.speech.runSpeechCheck({
        durationMs: SPEECH_MS,
        onLevel: (v) => { const p = Math.round(Math.min(1, Math.max(0, v)) * 100); lvl.style.width = p + '%'; meter.setAttribute('aria-valuenow', p); },
      });
      stop();
    } catch (e) {
      console.error('speech check failed', e);
      result.speech = { metrics: null, quality: { ok: false, reason: String(e.message || e) } };
    }
    prompt('');
  }

  function stepArms() {
    setStep('arms');
    const card = $('#stepCard');
    card.innerHTML = `<h2 style="margin-top:0">Step 3 · Arms <span class="muted small">(optional)</span></h2>
      <ol class="arm-steps" id="armSteps">
        <li data-k="frame">Move back until your <strong>shoulders and both hands</strong> are on screen</li>
        <li data-k="raise">Raise <strong>both arms straight out in front</strong>, at shoulder height</li>
        <li data-k="palms">Turn your <strong>palms up</strong> to the ceiling</li>
        <li data-k="eyes"><strong>Close your eyes</strong> and hold still for 10 seconds</li>
        <li data-k="rest">Open your eyes and lower your arms</li>
      </ol>
      <p class="small muted">Sit up straight in a chair. Skip this if you can't do it safely. The voice will guide you, so you don't need to watch the screen.</p>
      ${mods.arms ? '' : '<div class="warn">Arm detector unavailable — this step will be skipped.</div>'}
      <div class="btn-row">
        ${mods.arms ? '<button class="btn" id="armsGo">Start arm check</button>' : ''}
        <button class="btn secondary" id="armsSkip">Skip arms</button>
      </div>`;
    const mark = (k) => {
      let reached = false;
      card.querySelectorAll('#armSteps li').forEach((li) => {
        const cur = li.dataset.k === k;
        li.classList.toggle('active', cur);
        li.classList.toggle('done', !cur && !reached);
        if (cur) reached = true;
      });
    };
    say('Arms: start or skip', 'Step three, your arms. This one is optional. Press start when you are ready, or skip.');
    $('#armsSkip').onclick = () => { speechSynthesis?.cancel(); result.arms = null; finish(result, false); };
    if (mods.arms) $('#armsGo').onclick = async () => {
      const row = card.querySelector('.btn-row');
      row.innerHTML = '<button class="btn secondary" id="armsSkip2">Skip arms</button>';
      $('#armsSkip2').onclick = () => { armsAborted = true; speechSynthesis?.cancel(); result.arms = null; finish(result, false); };
      try {
        prompt('Loading arm model…');
        const pose = await mods.arms.initPose();
        if (cancelled) return;

        // 1. Get shoulders and both hands in the frame.
        mark('frame');
        await say('Move back: shoulders and both hands on screen', 'Move back a little, until your shoulders and both hands are on the screen.');
        if (armsAborted) return;
        if (!(await waitForPose(pose, (s) => !!s, 25000, 'Shoulders and hands not visible yet — move back a little', 'Move back a bit more, I need to see both hands.'))) {
          await say('Could not see your arms — skipping', 'I could not see your arms, so we will skip this step.');
          result.arms = { metrics: null, quality: { ok: false, reason: 'arms not in view' } };
          return finish(result, false);
        }
        if (armsAborted) return;
        // 2. Arms up to shoulder height.
        mark('raise');
        await say('Raise both arms straight out, shoulder height', 'Good. Now raise both arms straight out in front of you, at shoulder height.');
        const level = (s) => s && Math.abs(s.left) < 0.45 && Math.abs(s.right) < 0.45;
        if (!(await waitForPose(pose, level, 20000, 'Raise both hands up to shoulder height', 'A little higher, both hands at shoulder height.'))) {
          await say('Arms not at shoulder height — skipping', 'Your arms did not reach shoulder height, so we will skip this step.');
          result.arms = { metrics: null, quality: { ok: false, reason: 'arms not raised' } };
          return finish(result, false);
        }
        if (armsAborted) return;
        // 3. Palms up. 4. Eyes closed.
        mark('palms');
        await say('Turn your palms up', 'Turn your palms up to the ceiling, like you are holding a tray.');
        await sleep(800);
        mark('eyes');
        await say('Close your eyes and hold still', 'Now close your eyes and hold your arms still. I will tell you when to stop.');
        if (cancelled || armsAborted) return;
        beep(660);
        prompt('Eyes closed… hold still');
        const stop = runTimer(ARMS_MS);
        // Spoken encouragement mid-way (no mic in this step, so voice is safe).
        const cue = setTimeout(() => speak('Keep holding. Five more seconds.'), ARMS_MS / 2 - 1000);
        result.arms = await mods.arms.runArmCheck(video, { durationMs: ARMS_MS, onFrame: (lm) => draw(lm, '#7fc8ff', 'lastPoseLandmarks') });
        clearTimeout(cue);
        stop();
        beep(990, 400);
        mark('rest');
        await say('Done — open your eyes and lower your arms', 'Done. Open your eyes and lower your arms. Well done.');
      } catch (e) {
        console.error('arm check failed', e);
        result.arms = { metrics: null, quality: { ok: false, reason: String(e.message || e) } };
      }
      if (!cancelled && !armsAborted) finish(result, false);
    };
  }

  // Watch the camera until test(armFrame) holds for ~1 s. Re-prompts by voice every few seconds.
  async function waitForPose(pose, test, timeoutMs, hint, spokenHint) {
    const t0 = performance.now();
    let okSince = 0, lastHint = t0, lastTs = 0;
    while (!cancelled && !armsAborted && performance.now() - t0 < timeoutMs) {
      const now = performance.now();
      lastTs = Math.max(now, lastTs + 1);
      const pts = pose.detectForVideo(video, lastTs).landmarks?.[0];
      if (pts) draw(pts, '#7fc8ff');
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
      const s = pts ? mods.arms.armFrame(pts, video.videoWidth || 640, video.videoHeight || 480) : null;
      if (test(s)) {
        okSince ||= now;
        prompt('✓ Hold it there…');
        if (now - okSince > 1000) return true;
      } else {
        okSince = 0;
        prompt(hint);
        if (now - lastHint > 6000) { lastHint = now; speak(spokenHint); }
      }
      await sleep(80);
    }
    return false;
  }

  function finish(check, simulated) {
    clearTimers();
    stopCamera();
    setStep('done');
    prompt('');
    panel.innerHTML = `<div class="card"><p>Working out your result…</p></div>`;
    const out = { face: check.face, speech: check.speech, arms: check.arms };
    if (simulated || check.simulated) out.simulated = true;
    onComplete(out, { demoStroke: demoStroke() });
  }

  showIntro();
  return () => { cancelled = true; clearTimers(); stopCamera(); try { speechSynthesis.cancel(); } catch {} };
}
