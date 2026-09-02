/* Horizontal bar chart (model view: error per language). Mounted into
   <div data-bars> hosts carrying a JSON payload. Each bar can carry its rank
   among the models benchmarked on that language and a hollow marker at the
   best model's error, so the gap to the leader is visible. */

import { fmtErr } from '../lib/format';
import { svgEl } from './dom';
import { attachTip, tipShow, type TipRows } from './tooltip';

export interface BarRow {
  label: string;
  value: number;
  tipTitle: string;
  tipRows: TipRows;
  /** rank of this value among `of` models on the language */
  rank?: number;
  of?: number;
  /** the best model's value on the language (hollow marker) */
  ref?: number;
}

export interface BarsPayload {
  ariaLabel: string;
  rows: BarRow[];
}

export function barChartH({ rows, ariaLabel }: BarsPayload): SVGSVGElement {
  const rowH = 24, barH = 15;
  const M = { t: 8, r: 110, b: 30, l: 156 };
  const W = 860;
  const H = M.t + rows.length * rowH + M.b;
  const iw = W - M.l - M.r;
  const vMax = Math.max(...rows.map(r => r.value));
  const step = vMax <= 12 ? 2 : vMax <= 30 ? 5 : vMax <= 60 ? 10 : 25;
  const axMax = Math.ceil(vMax / step) * step;
  const sx = (v: number) => (v / axMax) * iw;

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel });

  for (let v = 0; v <= axMax; v += step) {
    svg.append(svgEl('line', { class: v === 0 ? 'baseline' : 'gridline',
      x1: M.l + sx(v), x2: M.l + sx(v), y1: M.t, y2: M.t + rows.length * rowH }));
    svg.append(svgEl('text', { class: 'tick-label', x: M.l + sx(v), y: M.t + rows.length * rowH + 15,
      'text-anchor': 'middle', text: String(v) }));
  }
  svg.append(svgEl('text', { class: 'axis-label', x: M.l + iw / 2, y: H - 2, 'text-anchor': 'middle',
    text: 'error % (WER; CER where marked)' }));

  rows.forEach((r, i) => {
    const y = M.t + i * rowH + (rowH - barH) / 2;
    const w = Math.max(sx(r.value), 2);
    // rounded data-end, square at the baseline
    const rad = Math.min(4, w);
    const d = `M ${M.l} ${y} h ${w - rad} a ${rad} ${rad} 0 0 1 ${rad} ${rad} v ${barH - 2 * rad} a ${rad} ${rad} 0 0 1 ${-rad} ${rad} h ${-(w - rad)} Z`;
    svg.append(svgEl('path', { d, fill: 'var(--series-1)' }));
    if (r.ref != null) {
      svg.append(svgEl('circle', { class: 'ref-mark', cx: M.l + sx(r.ref), cy: y + barH / 2, r: 4 }));
    }
    svg.append(svgEl('text', { class: 'tick-label', x: M.l - 8, y: y + barH - 3.5, 'text-anchor': 'end', text: r.label }));
    const value = svgEl('text', { class: 'bar-value', x: M.l + w + 8, y: y + barH - 3.5 }, fmtErr(r.value));
    if (r.rank && r.of) value.append(svgEl('tspan', { class: 'bar-rank', text: `  #${r.rank} of ${r.of}` }));
    svg.append(value);
    const hit = svgEl('rect', { x: M.l, y: y - 3, width: iw, height: barH + 6, fill: 'transparent', tabindex: '0' });
    attachTip(hit, () => tipShow(r.tipTitle, r.tipRows));
    svg.append(hit);
  });

  return svg;
}

/** Fill every <div data-bars> host with its chart. */
export function mountBars(root: ParentNode = document): void {
  for (const host of root.querySelectorAll<HTMLElement>('[data-bars]')) {
    const json = host.querySelector('script[type="application/json"]');
    if (!json) continue;
    const payload = JSON.parse(json.textContent || '{}') as BarsPayload;
    host.append(barChartH(payload));
  }
}
