// Small shared UI helpers.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtDateTime = (iso) => `${fmtDate(iso)}, ${fmtTime(iso)}`;
export const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();

export const LEVEL = {
  green: { icon: '✓', word: 'Green', text: 'Same as your usual' },
  yellow: { icon: '!', word: 'Yellow', text: 'A bit different from your usual' },
  red: { icon: '✕', word: 'Red', text: 'Clearly different — call 911' },
  skipped: { icon: '–', word: 'Skipped', text: 'Not checked' },
  none: { icon: '?', word: 'Not done', text: 'No check yet' },
};

// Color is never the only signal: icon + word always present.
export function badge(level, extra = '') {
  const L = LEVEL[level] || LEVEL.none;
  return `<span class="badge lv-${level || 'none'}"><span class="badge-icon" aria-hidden="true">${L.icon}</span>${L.word}${extra ? ` · ${esc(extra)}` : ''}</span>`;
}

export function isDemoMode() {
  const q = new URLSearchParams(location.search);
  const hq = new URLSearchParams((location.hash.split('?')[1]) || '');
  if (q.get('demo') === '1' || hq.get('demo') === '1') return true;
  try { return localStorage.getItem('steadycheck.demoControls') === '1'; } catch { return false; }
}

export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; }

export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

export function download(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
