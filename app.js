// Hash router. Each page module exports render(el, { params, query }) → optional cleanup().
import { isSetUp } from './store.js';

const routes = [
  { re: /^\/?$/, page: 'home', nav: 'home' },
  { re: /^\/setup$/, page: 'setup' },
  { re: /^\/baseline$/, page: 'baseline' },
  { re: /^\/check$/, page: 'check' },
  { re: /^\/result\/([^/]+)$/, page: 'result', keys: ['id'] },
  { re: /^\/emergency$/, page: 'emergency' },
  { re: /^\/log$/, page: 'log', nav: 'log' },
  { re: /^\/family$/, page: 'family', nav: 'family' },
  { re: /^\/report$/, page: 'report', nav: 'report' },
  { re: /^\/validation$/, page: 'validation' },
  { re: /^\/science$/, page: 'science' },
];

const el = document.getElementById('app');
let cleanup = null;
let renderToken = 0;

async function route() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');
  let match = null, params = {};
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) { match = r; (r.keys || []).forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); break; }
  }
  if (!match) { location.hash = '#/'; return; }
  if (match.page === 'home' && !isSetUp()) { location.hash = '#/setup?first=1'; return; }

  if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.warn(e); } }
  cleanup = null;
  const token = ++renderToken;

  document.body.dataset.page = match.page;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === match.nav));
  try {
    const mod = await import(`./pages/${match.page}.js`);
    if (token !== renderToken) return;
    el.innerHTML = '';
    const c = await mod.render(el, { params, query });
    if (token !== renderToken) { if (typeof c === 'function') c(); return; }
    cleanup = c;
  } catch (e) {
    console.error(e);
    el.innerHTML = `<section class="card"><h1>Something went wrong</h1><p>This page could not load. ${String(e && e.message)}</p><a class="btn" href="#/">Go home</a></section>`;
  }
  window.scrollTo(0, 0);
  el.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);

// Footer demo-controls switch (per-viewer convenience only).
const sw = document.getElementById('demoSwitch');
try { sw.checked = localStorage.getItem('steadycheck.demoControls') === '1'; } catch {}
sw.addEventListener('change', () => {
  try { localStorage.setItem('steadycheck.demoControls', sw.checked ? '1' : '0'); } catch {}
  route();
});
if (new URLSearchParams(location.search).get('demo') === '1') sw.checked = true;

route();
