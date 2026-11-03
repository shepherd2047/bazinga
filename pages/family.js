// Family view: feed of check-ins, alerts, missed checks + per-domain trend.
import { load, dayKey } from '../store.js';
import { DOMAINS, DOMAIN_LABEL } from './detectors.js';
import { badge, esc, fmtDate, fmtTime, LEVEL } from './ui.js';

export function render(el) {
  const s = load();
  const name = s.profile.name || 'They';
  const items = [];
  for (const c of s.checks) {
    const lv = (c.score && c.score.level) || 'none';
    items.push({ at: c.at, html: `${esc(name)} checked in ${badge(lv)}${c.simulated ? ' <span class="demo-tag">sim</span>' : ''} <a href="#/result/${esc(c.id)}">details</a>` });
  }
  for (const a of s.alerts) {
    if (a.kind === 'red' || a.kind === 'yellow') continue; // already shown as the check itself
    const icon = a.kind === 'emergency' ? '☎' : '!';
    items.push({ at: a.at, html: `<strong>${icon} ${a.kind === 'emergency' ? 'Emergency button pressed' : 'Reminder'}</strong> — ${esc(a.note || '')}` });
  }
  for (const e of s.emergencies) {
    if (e.symptomNoticedAt) items.push({ at: e.at, html: `Symptoms first noticed at <strong>${esc(fmtTime(e.symptomNoticedAt))}</strong>` });
  }
  for (const b of s.bp) items.push({ at: b.at, html: `Blood pressure ${b.sys}/${b.dia}` });
  // missed checks in last 14 days
  const checkedDays = new Set(s.checks.map((c) => dayKey(c.at)));
  for (let i = 1; i <= 14; i++) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(12, 0, 0, 0);
    if (s.baseline && new Date(s.baseline.createdAt) < d && !checkedDays.has(dayKey(d))) items.push({ at: d.toISOString(), html: `${badge('none')} No daily check on this day` });
  }
  items.sort((a, b) => b.at.localeCompare(a.at));

  // trend grid, last 14 days
  const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
  const rank = { red: 3, yellow: 2, green: 1, skipped: 0 };
  const cellFor = (d, dom) => {
    const cs = s.checks.filter((c) => dayKey(c.at) === dayKey(d));
    let best = null;
    for (const c of cs) { const v = (c.score && c.score.domains && c.score.domains[dom]) || null; if (v && (!best || (rank[v] ?? 0) > (rank[best] ?? 0))) best = v; }
    const lv = best || 'none';
    return `<div class="cell lv-${lv}" title="${esc(DOMAIN_LABEL[dom])} ${fmtDate(d.toISOString())}: ${LEVEL[lv].word}">${LEVEL[lv].icon}</div>`;
  };
  const cols = `grid-template-columns: 4.5em repeat(14, minmax(18px, 1fr))`;
  const trend = `<div class="trend" style="${cols}">
      <div></div>${days.map((d) => `<div class="day">${d.getDate()}</div>`).join('')}
      ${DOMAINS.map((dom) => `<div class="lbl">${DOMAIN_LABEL[dom]}</div>${days.map((d) => cellFor(d, dom)).join('')}`).join('')}
    </div>
    <p class="small muted">${['green', 'yellow', 'red', 'skipped', 'none'].map((l) => `${LEVEL[l].icon} ${LEVEL[l].word}`).join(' · ')}</p>`;

  el.innerHTML = `<h1>Family view</h1>
    <p class="muted">What ${esc(name)}'s family sees. In this demo, alerts are simulated (no real messages).</p>
    <section class="card"><h2 style="margin-top:0">Check results by sign (14 days)</h2><div class="table-wrap">${trend}</div></section>
    <section class="card"><h2 style="margin-top:0">Feed</h2>
      <ul class="list feed">${items.slice(0, 60).map((i) => `<li><span class="when">${esc(fmtDate(i.at))}<br>${esc(fmtTime(i.at))}</span><span>${i.html}</span></li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul>
    </section>`;
}
