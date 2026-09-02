/* Speed strip: every model's × realtime on one rig along a log axis, the
   models of interest highlighted and labelled, a marker at realtime. Shows
   the shape of the field and where a model sits in it without ranking it
   against models that are not alternatives. */

import { fmtX } from '../lib/format';
import { svgEl } from './dom';
import { attachTip, tipShow } from './tooltip';

export interface SpeedStripPayload {
  rigLabel: string;
  /** every model with a number on this rig */
  all: { model: string; x: number }[];
  highlight: { model: string; color: string }[];
  ariaLabel: string;
}

const LADDER = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
const LEVELS = 3;

export function speedStrip({ rigLabel, all, highlight, ariaLabel }: SpeedStripPayload): SVGSVGElement {
  const W = 860;
  const M = { t: 10 + LEVELS * 13, r: 40, b: 34, l: 40 };
  const H = M.t + 26 + M.b;
  const iw = W - M.l - M.r;
  const xs = all.map(a => a.x);
  const xMin = Math.min(...xs, 1) * 0.8, xMax = Math.max(...xs, 1) * 1.25;
  const lx = (v: number) => M.l + (Math.log10(v) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin)) * iw;
  const cy = M.t + 13;

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel });

  for (const t of LADDER) {
    if (t < xMin || t > xMax) continue;
    svg.append(svgEl('line', { class: 'gridline', x1: lx(t), x2: lx(t), y1: cy - 13, y2: cy + 13 }));
    svg.append(svgEl('text', { class: 'tick-label', x: lx(t), y: cy + 27, 'text-anchor': 'middle', text: t + '×' }));
  }
  if (xMin < 1 && xMax > 1) {
    svg.append(svgEl('line', { class: 'ref-line', x1: lx(1), x2: lx(1), y1: cy - 16, y2: cy + 13 }));
    svg.append(svgEl('text', { class: 'ref-label', x: lx(1) + 4, y: cy - 8, text: 'realtime' }));
  }
  svg.append(svgEl('text', { class: 'axis-label', x: M.l + iw / 2, y: H - 4, 'text-anchor': 'middle',
    text: `${rigLabel} — × realtime (log)` }));

  // one dot per distinct speed; the tooltip lists every model at it
  const groups = new Map<number, string[]>();
  for (const a of all) (groups.get(a.x) ?? groups.set(a.x, []).get(a.x)!).push(a.model);
  for (const [x, ms] of groups) {
    const g = svgEl('g', { tabindex: '0', 'aria-label': `${ms.join(', ')}: ${fmtX(x)}` });
    g.append(svgEl('circle', { cx: lx(x), cy, r: 4.5, fill: 'var(--de-emph)', stroke: 'var(--surface)', 'stroke-width': 1 }));
    g.append(svgEl('circle', { cx: lx(x), cy, r: 10, fill: 'transparent' }));
    attachTip(g, () => tipShow(fmtX(x), ms.map(m => [m, ''] as [string, string])));
    svg.append(g);
  }

  // the models of interest on top, labelled, labels stacked when they collide
  const placed: { level: number; x0: number; x1: number }[] = [];
  const hs = highlight.map(h => ({ ...h, x: all.find(a => a.model === h.model)?.x }))
    .filter((h): h is { model: string; color: string; x: number } => h.x != null)
    .sort((a, b) => a.x - b.x);
  for (const h of hs) {
    const cx = lx(h.x);
    const g = svgEl('g', { tabindex: '0', 'aria-label': `${h.model}: ${fmtX(h.x)}` });
    g.append(svgEl('circle', { cx, cy, r: 6.5, fill: h.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
    g.append(svgEl('circle', { cx, cy, r: 12, fill: 'transparent' }));
    attachTip(g, () => tipShow(h.model, [[rigLabel, fmtX(h.x)]]));
    svg.append(g);
    const wEst = h.model.length * 6.2;
    const start = cx + 9 + wEst < W - 4;
    const x0 = start ? cx + 9 : cx - 9 - wEst, x1 = x0 + wEst;
    let level = 0;
    while (level < LEVELS - 1 && placed.some(p => p.level === level && x0 < p.x1 + 6 && x1 > p.x0 - 6)) level++;
    placed.push({ level, x0, x1 });
    svg.append(svgEl('text', { class: 'direct-label', x: start ? cx + 9 : cx - 9, y: cy - 16 - level * 13,
      'text-anchor': start ? 'start' : 'end', text: h.model }));
  }

  return svg;
}
