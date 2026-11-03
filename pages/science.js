// Science: render SCIENCE.md (tiny markdown renderer) or a short built-in table.
import { esc } from './ui.js';

const FALLBACK = `
| What we check | Why it matters | Source |
|---|---|---|
| Face, arm, speech changes (BE-FAST) | Adding Balance and Eyes to FAST catches more strokes | Aroor et al., *Stroke* 2017 |
| Calling 911 fast | About 1.9 million brain cells are lost each minute of a large stroke | Saver, *Stroke* 2006 |
| Blood pressure under 130/80 | Recommended for most people after a stroke or TIA | Kleindorfer et al., AHA/ASA guideline, *Stroke* 2021 |
| Daily vigilance after a minor stroke | Risk of another stroke is highest in the first weeks and months | Amarenco et al., *NEJM* 2016 |
| Arm drift with eyes closed | Basis of the "motor arm" item of the NIH Stroke Scale | NIHSS |
`;

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function md(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  let out = '', i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r, k) => !(k === 1 && /^[\s|:-]+$/.test(r)));
      out += `<div class="table-wrap"><table><thead><tr>${cells(body[0]).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.slice(1).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    const hm = l.match(/^(#{1,4})\s+(.*)/);
    if (hm) { const n = Math.min(4, hm[1].length + 1); out += `<h${n}>${inline(hm[2])}</h${n}>`; i++; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l); const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      out += `<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
      continue;
    }
    if (!l.trim() || /^```/.test(l) || /^---+$/.test(l.trim())) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\s*\||\s*[-*]\s|\s*\d+\.\s|```)/.test(lines[i])) para.push(lines[i++]);
    out += `<p>${inline(para.join(' '))}</p>`;
  }
  return out;
}

export async function render(el) {
  el.innerHTML = '<h1>The science</h1><section class="card md" id="sci"><p>Loading…</p></section>';
  let text = null;
  try { const r = await fetch('SCIENCE.md', { cache: 'no-cache' }); if (r.ok) text = await r.text(); } catch {}
  el.querySelector('#sci').innerHTML = text
    ? md(text)
    : `<p class="muted small">Short built-in summary (full SCIENCE.md not available yet).</p>${md(FALLBACK)}
       <p class="small">SteadyCheck compares each person to their own baseline. It does not diagnose, predict or rule out a stroke.</p>`;
}
