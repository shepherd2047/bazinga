// Setup: name, family contacts, meds. "Load demo data". Reset.
import { load, setProfile, seedDemoData, clearAll, uid } from '../store.js';
import { esc, fmtDateTime, toast } from './ui.js';

export function render(el, { query }) {
  const s = load();
  const p = JSON.parse(JSON.stringify(s.profile));
  p.familyContacts = p.familyContacts || [];
  p.meds = p.meds || [];
  const first = query.get('first') === '1';

  const draw = () => {
    el.innerHTML = `
      <h1>${first ? 'Welcome to SteadyCheck' : 'Settings'}</h1>
      ${first ? '<p>Set up takes 2 minutes. Or press <strong>Load demo data</strong> to try it with 14 days of example history.</p>' : ''}
      <section class="card demo-box" style="background:#fff">
        <span class="demo-tag">Demo</span>
        <div class="btn-row"><button class="btn secondary" id="seed">Load demo data</button></div>
        <p class="small muted">Fills 14 days of example blood pressure, medicines and green checks (replaces current data).</p>
      </section>

      <section class="card">
        <h2 style="margin-top:0">Who is this for?</h2>
        <label for="name">Name the app should use</label>
        <input id="name" type="text" value="${esc(p.name)}" placeholder="e.g. Dad">
      </section>

      <section class="card">
        <h2 style="margin-top:0">Family to alert</h2>
        <ul class="list">${p.familyContacts.map((c, i) => `<li><span><strong>${esc(c.name)}</strong> ${esc(c.phone)}</span><button class="btn ghost" data-delc="${i}">Remove</button></li>`).join('') || '<li class="muted">None yet</li>'}</ul>
        <div class="row">
          <div><label for="cName">Name</label><input id="cName" type="text" placeholder="e.g. Maya (daughter)"></div>
          <div><label for="cPhone">Phone</label><input id="cPhone" type="tel" placeholder="555-0142"></div>
          <button class="btn secondary" id="addC">Add</button>
        </div>
      </section>

      <section class="card">
        <h2 style="margin-top:0">Medicines</h2>
        <ul class="list">${p.meds.map((m, i) => `<li><span><strong>${esc(m.name)}</strong> ${esc(m.dose)} · ${esc((m.times || []).join(', '))}</span><button class="btn ghost" data-delm="${i}">Remove</button></li>`).join('') || '<li class="muted">None yet</li>'}</ul>
        <div class="row">
          <div><label for="mName">Medicine</label><input id="mName" type="text" placeholder="e.g. Amlodipine"></div>
          <div><label for="mDose">Dose</label><input id="mDose" type="text" placeholder="5 mg"></div>
          <div><label for="mTimes">Times</label><input id="mTimes" type="text" placeholder="08:00, 20:00"></div>
          <button class="btn secondary" id="addM">Add</button>
        </div>
      </section>

      <div class="btn-row"><button class="btn" id="save">Save</button></div>

      <section class="card">
        <h2 style="margin-top:0">Your baseline</h2>
        <p>${s.baseline ? `Recorded ${esc(fmtDateTime(s.baseline.createdAt))}${s.baseline.demo ? ' (demo data)' : ''}.` : 'Not recorded yet.'}</p>
        <a class="btn secondary" href="#/baseline">${s.baseline ? 'Re-record baseline' : 'Record baseline'}</a>
      </section>

      <section class="card">
        <h2 style="margin-top:0">Reset</h2>
        <p class="muted small">Removes everything stored on this device.</p>
        <button class="btn ghost" id="reset">Clear all data</button>
      </section>`;

    const $ = (q) => el.querySelector(q);
    $('#name').oninput = (e) => (p.name = e.target.value);
    $('#addC').onclick = () => { const n = $('#cName').value.trim(); if (!n) return; p.familyContacts.push({ name: n, phone: $('#cPhone').value.trim() }); draw(); };
    $('#addM').onclick = () => {
      const n = $('#mName').value.trim(); if (!n) return;
      const times = $('#mTimes').value.split(',').map((t) => t.trim()).filter(Boolean);
      p.meds.push({ id: uid(), name: n, dose: $('#mDose').value.trim(), times: times.length ? times : ['08:00'] }); draw();
    };
    el.querySelectorAll('[data-delc]').forEach((b) => (b.onclick = () => { p.familyContacts.splice(+b.dataset.delc, 1); draw(); }));
    el.querySelectorAll('[data-delm]').forEach((b) => (b.onclick = () => { p.meds.splice(+b.dataset.delm, 1); draw(); }));
    $('#save').onclick = () => {
      if (!p.name.trim()) { toast('Please enter a name'); $('#name').focus(); return; }
      setProfile(p); toast('Saved');
      location.hash = load().baseline ? '#/' : '#/baseline';
    };
    $('#seed').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Loading…';
      await seedDemoData(); toast('Demo data loaded'); location.hash = '#/';
    };
    $('#reset').onclick = () => {
      if (!confirm('Clear all SteadyCheck data on this device?')) return;
      clearAll(); toast('All data cleared'); location.hash = '#/setup?first=1';
    };
  };
  draw();
}
