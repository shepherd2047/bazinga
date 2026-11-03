// Prevention log: BP entry + 14-day chart (130/80 target), meds checklist + adherence.
import { adherence } from '../store.js';
import { mountMeds, mountBPForm, bpChart, bpSummary } from './widgets.js';

export function render(el) {
  el.innerHTML = `<h1>Prevention log</h1>
    <p class="muted">Keeping blood pressure under 130/80 and taking medicines every day are the biggest things that lower the chance of another stroke.</p>
    <section class="card"><h2 style="margin-top:0">Add a blood pressure reading</h2><div id="bpf"></div></section>
    <section class="card"><h2 style="margin-top:0">Last 14 days</h2><div id="sum"></div><div id="chart"></div></section>
    <section class="card"><h2 style="margin-top:0">Medicines today</h2><p id="adh" class="stat"></p><div id="meds"></div></section>`;
  const drawChart = () => {
    el.querySelector('#chart').innerHTML = bpChart(14);
    const s = bpSummary(14);
    el.querySelector('#sum').innerHTML = s ? `<p>Average <strong>${s.sys}/${s.dia}</strong> over ${s.n} readings · ${s.abovePct}% above target</p>` : '';
  };
  const drawAdh = () => {
    const a = adherence(14);
    el.querySelector('#adh').innerHTML = a == null ? '' : `${a}% <span class="small muted" style="font-weight:500">of doses marked taken (14 days)</span>`;
  };
  mountBPForm(el.querySelector('#bpf'), drawChart);
  mountMeds(el.querySelector('#meds'), drawAdh);
  drawChart(); drawAdh();
}
