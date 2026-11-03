// Full-screen red emergency panel, shared by the red Result and the Emergency page.
import { load, update } from '../store.js';
import { esc, fmtTime } from './ui.js';

export function renderRed(el, { title, lead, reasons = [], emergencyAt, extra = '' }) {
  const s = load();
  const em = s.emergencies.find((e) => e.at === emergencyAt) || {};
  const contacts = s.profile.familyContacts || [];
  const wrap = document.createElement('div');
  wrap.className = 'redscreen';
  wrap.setAttribute('role', 'alertdialog');
  wrap.setAttribute('aria-labelledby', 'redTitle');
  wrap.innerHTML = `<div class="inner">
    <span class="hero-icon" aria-hidden="true">✕</span>
    <h1 id="redTitle">${esc(title)}</h1>
    <p style="font-size:1.15rem">${esc(lead)}</p>
    <a class="call911" href="tel:911"><span aria-hidden="true">☎</span> Call 911 now</a>

    ${reasons.length ? `<div class="panel"><h2 style="margin-top:0">What changed from your usual</h2><ul>${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="small">This is not a diagnosis. Tell the 911 operator: "I think this may be a stroke."</p></div>` : ''}

    <div class="panel">
      <h2 style="margin-top:0">Note the time — doctors need it</h2>
      <p>When did you <strong>first notice</strong> something was wrong? Some treatments only work within hours of that time.</p>
      <p style="font-size:1.3rem;font-weight:800" id="noticedShow">Saved: ${em.symptomNoticedAt ? esc(fmtTime(em.symptomNoticedAt)) : '—'}</p>
      <div class="btn-row">
        <button class="btn secondary" data-ago="0">Just now</button>
        <button class="btn secondary" data-ago="30">About 30 min ago</button>
        <button class="btn secondary" data-ago="120">About 2 hours ago</button>
      </div>
      <label for="noticedAt" style="color:#fff">Or set the exact time</label>
      <input type="time" id="noticedAt">
      <p class="small">Woke up with symptoms? Use the time you were last known to be well (when you went to sleep).</p>
    </div>

    <div class="panel" aria-live="polite">
      <h2 style="margin-top:0">✓ Family alerted <span class="demo-tag" style="background:#fff;color:#8a1410">Simulated</span></h2>
      ${contacts.length ? `<ul>${contacts.map((c) => `<li>Message sent to <strong>${esc(c.name)}</strong> ${c.phone ? `(${esc(c.phone)})` : ''}</li>`).join('')}</ul>`
        : '<p>No family contacts saved yet — add them in Settings.</p>'}
      <p class="small">In this hackathon demo no real message is sent. Call 911 yourself — don't wait for family.</p>
    </div>

    <div class="panel">
      <h2 style="margin-top:0">While you wait</h2>
      <ul>
        <li>Don't drive yourself. Unlock the front door.</li>
        <li>Don't eat, drink or take new medicines unless the 911 operator says so.</li>
        <li>Have your medicine list ready (Report page).</li>
      </ul>
      <p><strong>BE-FAST</strong> signs: <strong>B</strong>alance loss · <strong>E</strong>yes (vision loss) · <strong>F</strong>ace drooping · <strong>A</strong>rm weakness · <strong>S</strong>peech trouble · <strong>T</strong>ime to call 911.</p>
    </div>
    ${extra}
    <div class="btn-row"><a class="btn secondary" href="#/report">Show medicine list</a><a class="btn secondary" href="#/">Back to home</a></div>
  </div>`;
  el.appendChild(wrap);
  document.body.style.overflow = 'hidden';

  const setNoticed = (d) => {
    const iso = d.toISOString();
    update((st) => {
      let e = st.emergencies.find((x) => x.at === emergencyAt);
      if (!e) { e = { at: emergencyAt || new Date().toISOString() }; st.emergencies.push(e); }
      e.symptomNoticedAt = iso;
    });
    wrap.querySelector('#noticedShow').textContent = `Saved: ${fmtTime(iso)}`;
  };
  wrap.querySelectorAll('[data-ago]').forEach((b) => (b.onclick = () => setNoticed(new Date(Date.now() - +b.dataset.ago * 60000))));
  wrap.querySelector('#noticedAt').onchange = (e) => {
    const [hh, mm] = e.target.value.split(':').map(Number);
    if (isNaN(hh)) return;
    const d = new Date(); d.setHours(hh, mm, 0, 0);
    if (d > new Date()) d.setDate(d.getDate() - 1);
    setNoticed(d);
  };
  wrap.querySelector('.call911').focus();
  return () => { document.body.style.overflow = ''; };
}
