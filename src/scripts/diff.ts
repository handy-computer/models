/* Diverging difference chart: one row per language, a bar from the center
   line whose length is the log ratio of two error rates. Left of center the
   first model is ahead, right of center the second; faded bars are ties
   (overlapping 95% CIs). The model page draws it against the best other
   model in each language; the two-model set view draws it head to head. */

import { el, svgEl } from './dom';
import { attachTip, tipShow, type TipRows } from './tooltip';

export interface DiffRow {
  label: string;
  /** log2(a / b): negative means the first model is ahead */
  value: number;
  tie: boolean;
  /** Displayed error rates for the first and second model, respectively. */
  firstValueText: string;
  secondValueText: string;
  /** extra text after the numbers (the model page names the other model here) */
  tail?: string;
  tipTitle: string;
  tipRows: TipRows;
}

export interface DiffPayload {
  ariaLabel: string;
  leftLabel: string;
  rightLabel: string;
  leftColor: string;
  rightColor: string;
  /** in display order */
  rows: DiffRow[];
}

const RATIOS = [1.5, 2, 3, 5, 10, 20, 50, 100];

export function diffChart({ rows, ariaLabel, leftLabel, rightLabel, leftColor, rightColor }: DiffPayload): SVGSVGElement {
  const rowH = 24, barH = 15;
  const M = { t: 26, r: 24, b: 30, l: 156 };
  const W = 860;
  const H = M.t + rows.length * rowH + M.b;
  const iw = W - M.l - M.r;
  const cx0 = M.l + iw / 2;
  const half = iw / 2;
  const vMax = Math.max(Math.log2(1.5), ...rows.map(r => Math.abs(r.value)));
  const axRatio = RATIOS.find(r => Math.log2(r) >= vMax) ?? RATIOS[RATIOS.length - 1];
  const axMax = Math.log2(axRatio);
  const sx = (v: number) => cx0 + (Math.max(-axMax, Math.min(axMax, v)) / axMax) * half;
  const yTop = M.t, yBot = M.t + rows.length * rowH;

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel });

  rows.forEach((_, i) => {
    if (i % 2 === 1) svg.append(svgEl('rect', { class: 'zebra', x: 6, y: M.t + i * rowH, width: W - 12, height: rowH }));
  });
  for (const r of RATIOS) {
    if (r > axRatio) break;
    for (const s of [-1, 1]) {
      const x = sx(s * Math.log2(r));
      svg.append(svgEl('line', { class: 'gridline', x1: x, x2: x, y1: yTop, y2: yBot }));
      svg.append(svgEl('text', { class: 'tick-label', x, y: yBot + 15, 'text-anchor': 'middle', text: `${r}×` }));
    }
  }
  svg.append(svgEl('line', { class: 'center', x1: cx0, x2: cx0, y1: yTop, y2: yBot }));
  svg.append(svgEl('text', { class: 'tick-label', x: cx0, y: yBot + 15, 'text-anchor': 'middle', text: 'same' }));
  svg.append(svgEl('text', { class: 'head-label', x: M.l, y: 16, text: `← ${leftLabel}` }));
  svg.append(svgEl('text', { class: 'head-label', x: W - M.r, y: 16, 'text-anchor': 'end', text: `${rightLabel} →` }));
  svg.append(svgEl('text', { class: 'axis-label', x: cx0, y: H - 2, 'text-anchor': 'middle', text: 'ratio of error rates (log)' }));

  rows.forEach((r, i) => {
    const y = M.t + i * rowH + (rowH - barH) / 2;
    const w = Math.max(Math.abs(sx(r.value) - cx0), 2);
    const left = r.value < 0;
    const fill = r.tie ? 'var(--de-emph)' : left ? leftColor : rightColor;
    const rad = Math.min(4, w);
    // rounded at the data end, square at the center line
    const d = left
      ? `M ${cx0} ${y} h ${-(w - rad)} a ${rad} ${rad} 0 0 0 ${-rad} ${rad} v ${barH - 2 * rad} a ${rad} ${rad} 0 0 0 ${rad} ${rad} h ${w - rad} Z`
      : `M ${cx0} ${y} h ${w - rad} a ${rad} ${rad} 0 0 1 ${rad} ${rad} v ${barH - 2 * rad} a ${rad} ${rad} 0 0 1 ${-rad} ${rad} h ${-(w - rad)} Z`;
    svg.append(svgEl('path', { d, fill }));
    svg.append(svgEl('text', { class: 'tick-label', x: M.l - 8, y: y + barH - 3.5, 'text-anchor': 'end', text: r.label }));
    // the numbers sit on the empty side of the center line
    const value = svgEl('text', { class: 'bar-value', x: left ? cx0 + 8 : cx0 - 8, y: y + barH - 3.5,
      'text-anchor': left ? 'start' : 'end' });
    value.append(
      svgEl('tspan', { class: 'diff-value', fill: leftColor, text: r.firstValueText }),
      svgEl('tspan', { class: 'diff-vs', text: ' vs ' }),
      svgEl('tspan', { class: 'diff-value', fill: rightColor, text: r.secondValueText }),
    );
    const extra = [r.tail, r.tie ? 'tie' : null].filter(Boolean).join(' · ');
    if (extra) value.append(svgEl('tspan', { class: 'bar-rank', text: ` · ${extra}` }));
    svg.append(value);
    const hit = svgEl('rect', { x: M.l, y: y - 3, width: iw, height: barH + 6, fill: 'transparent', tabindex: '0',
      'aria-label': `${r.tipTitle}: ${r.tipRows.map(t => t.join(' ')).join(', ')}` });
    attachTip(hit, () => tipShow(r.tipTitle, r.tipRows));
    svg.append(hit);
  });

  return svg;
}

export function diffLegend(leftLabel: string, rightLabel: string, leftColor: string, rightColor: string): HTMLElement {
  const key = (color: string, text: string) =>
    el('span', { class: 'key' }, el('span', { class: 'dot', style: `background:${color}` }), text);
  return el('div', { class: 'legend' },
    key(leftColor, leftLabel), key(rightColor, rightLabel), key('var(--de-emph)', 'tie: the 95% CIs overlap'));
}
