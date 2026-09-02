/* Dot plot: one row per category, one dot per series. The model set view
   uses it for error per language across several models; dots in a row are
   joined by a hairline so the spread reads at a glance, and a missing dot
   means that model has no benchmark there. A log axis spreads the low end,
   where the close fights are, and compresses the outliers. */

import { seriesColor } from '../lib/palette';
import { svgEl } from './dom';
import { attachTip, tipShow, type TipRows } from './tooltip';

export interface DotRow {
  label: string;
  /** one value per series, null where the series has no data */
  values: (number | null)[];
  tipTitle: string;
  tipRows: TipRows;
}

export interface DotsPayload {
  series: string[];
  rows: DotRow[];
  ariaLabel: string;
  /** log axis from 1% up */
  log?: boolean;
}

const LOG_TICKS = [1, 2, 5, 10, 20, 50, 100, 200, 500];

export function dotPlot({ rows, ariaLabel, log = false }: DotsPayload): SVGSVGElement {
  const rowH = 24;
  const M = { t: 8, r: 24, b: 30, l: 156 };
  const W = 860;
  const H = M.t + rows.length * rowH + M.b;
  const iw = W - M.l - M.r;
  const vals = rows.flatMap(r => r.values.filter((v): v is number => v != null));
  const vMax = Math.max(1, ...vals);
  let sx: (v: number) => number;
  let ticks: number[];
  if (log) {
    const hi = LOG_TICKS.find(t => t >= vMax) ?? LOG_TICKS[LOG_TICKS.length - 1];
    sx = v => M.l + (Math.log10(Math.max(1, v)) / Math.log10(hi)) * iw;
    ticks = LOG_TICKS.filter(t => t <= hi);
  } else {
    const step = vMax <= 12 ? 2 : vMax <= 30 ? 5 : vMax <= 60 ? 10 : 25;
    const axMax = Math.ceil(vMax / step) * step;
    sx = v => M.l + (v / axMax) * iw;
    ticks = [];
    for (let v = 0; v <= axMax; v += step) ticks.push(v);
  }

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel });

  // zebra rows so the eye can track across
  rows.forEach((_, i) => {
    if (i % 2 === 1) svg.append(svgEl('rect', { class: 'zebra', x: M.l - 150, y: M.t + i * rowH, width: iw + 150 + 12, height: rowH }));
  });
  ticks.forEach((v, i) => {
    svg.append(svgEl('line', { class: i === 0 ? 'baseline' : 'gridline', x1: sx(v), x2: sx(v), y1: M.t, y2: M.t + rows.length * rowH }));
    svg.append(svgEl('text', { class: 'tick-label', x: sx(v), y: M.t + rows.length * rowH + 15, 'text-anchor': 'middle', text: String(v) }));
  });
  svg.append(svgEl('text', { class: 'axis-label', x: M.l + iw / 2, y: H - 2, 'text-anchor': 'middle',
    text: `error % (WER; CER where marked${log ? '; log scale' : ''})` }));

  rows.forEach((r, i) => {
    const cy = M.t + i * rowH + rowH / 2;
    const present = r.values.filter((v): v is number => v != null);
    if (present.length > 1) {
      svg.append(svgEl('line', { class: 'spread', x1: sx(Math.min(...present)), x2: sx(Math.max(...present)), y1: cy, y2: cy }));
    }
    svg.append(svgEl('text', { class: 'tick-label', x: M.l - 8, y: cy + 3.5, 'text-anchor': 'end', text: r.label }));
    r.values.forEach((v, si) => {
      if (v == null) return;
      svg.append(svgEl('circle', { cx: sx(v), cy, r: 5, fill: seriesColor(si), stroke: 'var(--surface)', 'stroke-width': 1.5 }));
    });
    const hit = svgEl('rect', { x: M.l - 150, y: cy - rowH / 2, width: iw + 150 + 12, height: rowH, fill: 'transparent', tabindex: '0',
      'aria-label': `${r.tipTitle}: ${r.tipRows.map(t => t.join(' ')).join(', ')}` });
    attachTip(hit, () => tipShow(r.tipTitle, r.tipRows));
    svg.append(hit);
  });

  return svg;
}
