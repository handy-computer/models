/* Accuracy-vs-speed scatter: log-x (× realtime), linear-y (error %) capped,
   Pareto frontier in wine with direct labels, the rest de-emphasized.
   Mounted into <div data-scatter> hosts carrying a JSON payload. */

import type { PerfMap } from '../lib/types';
import { RIGS, rigById, SCATTER_Y_CAP } from '../lib/config';
import { perfLookup } from '../lib/derive';
import { fmtErr, fmtX } from '../lib/format';
import { el, svgEl } from './dom';
import { attachTip, tipShow, type TipRows } from './tooltip';
import { getRigPref, setRigPref } from './rigpref';

export interface ScatterInput {
  model: string;
  err: number;
  metricName: string;
  extraTip?: [string, string][];
}

export interface ScatterPayload {
  langText: string;
  points: ScatterInput[];
  /** model -> rig -> backend -> × realtime, for the models in `points` */
  perf: Record<string, PerfMap>;
}

interface Pt {
  id: string;
  x: number;
  y: number;
  tipRows: TipRows;
  frontier?: boolean;
  clamped?: boolean;
}

function scatterChart({ points, xAxisLabel, yAxisLabel, yMax }:
  { points: Pt[]; xAxisLabel: string; yAxisLabel: string; yMax: number }): SVGSVGElement {
  const W = 860, H = 380;
  const M = { t: 16, r: 150, b: 46, l: 52 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;

  const xs = points.map(p => p.x);
  const xMin = Math.min(...xs) * 0.8, xMax = Math.max(...xs) * 1.25;
  const lx = (v: number) => M.l + (Math.log10(v) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin)) * iw;
  const ly = (v: number) => M.t + ih - (Math.min(v, yMax) / yMax) * ih;

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': 'Scatter plot of error rate versus speed. The same values appear in the table below.' });

  // y gridlines at clean steps
  const yStep = yMax <= 12 ? 2 : yMax <= 25 ? 5 : 10;
  for (let v = 0; v <= yMax; v += yStep) {
    svg.append(svgEl('line', { class: v === 0 ? 'baseline' : 'gridline', x1: M.l, x2: M.l + iw, y1: ly(v), y2: ly(v) }));
    svg.append(svgEl('text', { class: 'tick-label', x: M.l - 7, y: ly(v) + 3.5, 'text-anchor': 'end', text: String(v) }));
  }

  // x ticks: 1-2-5 ladder within range
  const ticks = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200].filter(t => t >= xMin && t <= xMax);
  for (const t of ticks) {
    svg.append(svgEl('line', { class: 'gridline', x1: lx(t), x2: lx(t), y1: M.t, y2: M.t + ih }));
    svg.append(svgEl('text', { class: 'tick-label', x: lx(t), y: M.t + ih + 15, 'text-anchor': 'middle', text: t + '×' }));
  }

  // realtime reference at 1× (solid muted line + label)
  if (xMin < 1 && xMax > 1) {
    svg.append(svgEl('line', { class: 'ref-line', x1: lx(1), x2: lx(1), y1: M.t, y2: M.t + ih }));
    svg.append(svgEl('text', { class: 'ref-label', x: lx(1) + 4, y: M.t + 10, text: 'realtime' }));
  }

  svg.append(svgEl('text', { class: 'axis-label', x: M.l + iw / 2, y: H - 8, 'text-anchor': 'middle', text: xAxisLabel }));
  svg.append(svgEl('text', { class: 'axis-label', x: 14, y: M.t + ih / 2, 'text-anchor': 'middle',
    transform: `rotate(-90 14 ${M.t + ih / 2})`, text: yAxisLabel }));

  // marks (draw de-emphasized first so frontier sits on top)
  const ordered = [...points].sort((a, b) => (a.frontier ? 1 : 0) - (b.frontier ? 1 : 0));
  const labelBoxes: { y: number; x0: number; x1: number }[] = [];
  for (const p of ordered) {
    const cx = lx(p.x), cy = ly(p.y);
    const g = svgEl('g');
    const fill = p.frontier ? 'var(--series-1)' : 'var(--de-emph)';
    if (p.clamped) {
      // pinned at top edge: open triangle, true value in tooltip + table
      g.append(svgEl('path', { d: `M ${cx} ${cy - 6} L ${cx - 6} ${cy + 5} L ${cx + 6} ${cy + 5} Z`,
        fill: 'var(--surface)', stroke: fill, 'stroke-width': 2 }));
    } else {
      g.append(svgEl('circle', { cx, cy, r: 5.5, fill, stroke: 'var(--surface)', 'stroke-width': 2 }));
    }
    // oversize hit target
    const hit = svgEl('circle', { cx, cy, r: 14, fill: 'transparent', tabindex: '0', role: 'img',
      'aria-label': `${p.id}: ${p.tipRows.map(r => r.join(' ')).join(', ')}` });
    attachTip(hit, () => tipShow(p.id, p.tipRows));
    g.append(hit);
    svg.append(g);
  }

  // direct labels for frontier points, nudged to avoid collisions
  const frontier = points.filter(p => p.frontier).sort((a, b) => ly(a.y) - ly(b.y));
  for (const p of frontier) {
    const cx = lx(p.x), cy = ly(p.y);
    const wEst = p.id.length * 6.2;
    let tx = cx + 10, anchor = 'start';
    if (tx + wEst > W - 4) { tx = cx - 10; anchor = 'end'; }
    let tyy = cy + 3.5;
    const x0 = anchor === 'start' ? tx : tx - wEst;
    for (let guard = 0; guard < 30; guard++) {
      const clash = labelBoxes.find(b => Math.abs(b.y - tyy) < 12 && x0 < b.x1 && x0 + wEst > b.x0);
      if (!clash) break;
      tyy += 13;
    }
    if (tyy > M.t + ih + 12) tyy = cy - 9;
    labelBoxes.push({ y: tyy, x0, x1: x0 + wEst });
    svg.append(svgEl('text', { class: 'direct-label', x: tx, y: tyy, 'text-anchor': anchor, text: p.id }));
  }

  return svg;
}

export function computeFrontier(points: Pt[]): void {
  // frontier: no other point has >= speed AND <= err (with one strict)
  for (const p of points) {
    p.frontier = !points.some(q => q !== p &&
      q.x >= p.x && q.y <= p.y && (q.x > p.x || q.y < p.y));
  }
}

export function buildScatterSection(payload: ScatterPayload): HTMLElement {
  const { points, langText, perf } = payload;
  const card = el('div', { class: 'card chart-card' });
  card.append(el('p', { class: 'chart-title', text: 'accuracy vs speed' }));
  card.append(el('p', { class: 'chart-sub', text: `${langText} · left is slower, down is better · log speed axis` }));

  const controls = el('div', { class: 'filter-row' }, el('label', { text: 'speed on' }));
  const sel = el('select');
  for (const r of RIGS) sel.append(el('option', { value: r.id, text: r.label }));
  sel.value = getRigPref(RIGS.map(r => r.id), RIGS[0].id);
  controls.append(sel);
  const noPerfNote = el('span', { class: 'hint' });
  controls.append(noPerfNote);
  card.append(controls);

  const holder = el('div');
  card.append(holder);

  const clampKey = el('span', { class: 'key', text: '△ above the axis cap — exact value in the table' });
  const legend = el('div', { class: 'legend' },
    el('span', { class: 'key' }, el('span', { class: 'dot', style: 'background:var(--series-1)' }), 'pareto frontier (no model is both faster and more accurate)'),
    el('span', { class: 'key' }, el('span', { class: 'dot', style: 'background:var(--de-emph)' }), 'other models'),
    clampKey);
  card.append(legend);

  function draw() {
    const rigId = sel.value;
    const rig = rigById(rigId);
    const pts: Pt[] = [];
    const missing: string[] = [];
    for (const p of points) {
      const x = perfLookup(perf[p.model], rigId);
      if (x == null) { missing.push(p.model); continue; }
      pts.push({ id: p.model, x, y: p.err, tipRows: [
        [p.metricName, fmtErr(p.err) + '%'],
        [rig.short, fmtX(x)],
        ...(p.extraTip || []),
      ]});
    }
    noPerfNote.textContent = missing.length ? `no speed data: ${missing.join(', ')}` : '';
    holder.replaceChildren();
    if (pts.length === 0) { holder.append(el('p', { class: 'hint', text: 'No models with speed data here.' })); return; }
    const visMax = Math.max(...pts.map(p => p.y));
    let yMax: number;
    clampKey.hidden = visMax <= SCATTER_Y_CAP;
    if (visMax > SCATTER_Y_CAP) {
      yMax = SCATTER_Y_CAP;
      for (const p of pts) if (p.y > SCATTER_Y_CAP) p.clamped = true;
    } else {
      const yStepCand = visMax <= 12 ? 2 : visMax <= 25 ? 5 : 10;
      yMax = Math.max(yStepCand, Math.ceil(visMax / yStepCand) * yStepCand);
    }
    computeFrontier(pts);
    holder.append(scatterChart({
      points: pts,
      xAxisLabel: `${rig.label} — × realtime (log)`,
      yAxisLabel: points[0] ? `${points[0].metricName} %` : 'error %',
      yMax,
    }));
  }

  sel.addEventListener('change', () => { setRigPref(sel.value); draw(); });
  draw();
  return card;
}

/** Replace every <div data-scatter> host with a live chart section. */
export function mountScatters(root: ParentNode = document): void {
  for (const host of root.querySelectorAll<HTMLElement>('[data-scatter]')) {
    const json = host.querySelector('script[type="application/json"]');
    if (!json) continue;
    const payload = JSON.parse(json.textContent || '{}') as ScatterPayload;
    host.replaceWith(buildScatterSection(payload));
  }
}
