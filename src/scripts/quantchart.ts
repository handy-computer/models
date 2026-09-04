/* Quantization strip plot: one strip per quant, one dot per usable language,
   the dot's position the quant's error change against the model's own Q8_0
   result as a percentage of it. A shaded band around zero is the typical
   noise of one measurement (the median half-width of the Q8_0 confidence
   interval). Dots above their own language's confidence interval are wine:
   measurably worse. The rest are grey: within noise. Only the worst few
   are labelled; every dot has a tooltip. */

import { QUANT_STRIP, type QuantRow, type QuantSummary } from '../lib/quant';
import { fmtErr, fmtSigned, fmtPct } from '../lib/format';
import { svgEl } from './dom';
import { attachTip, tipShow, type TipRows } from './tooltip';

export interface QuantStripPayload {
  /** usable rows only */
  rows: QuantRow[];
  /** strip order, top to bottom */
  quants: string[];
  summaries: QuantSummary[];
  baseQuant: string;
  ariaLabel: string;
  /** quant -> extra tooltip rows (file size) */
  extraTip?: Record<string, TipRows>;
}

const R = 4.5;          // dot radius
const LABEL_MAX = 3;    // direct labels per strip

/** a clean axis step for the range */
function niceStep(span: number): number {
  const raw = span / 6;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
}

export function quantStrip({ rows, quants, summaries, baseQuant, ariaLabel, extraTip }: QuantStripPayload): SVGSVGElement {
  const G = QUANT_STRIP;
  const W = G.w;
  const M = { l: 96, r: 28 };
  const iw = W - M.l - M.r;
  const stripH = G.labelBand + G.dots;
  const H = G.top + quants.length * stripH + Math.max(0, quants.length - 1) * G.gap + G.bottom;

  // the axis fits every dot and the noise band, with a little air
  const rels = rows.flatMap(r => quants.flatMap(q => r.cells[q] ? [r.cells[q]!.rel] : []));
  const noise = Math.max(...summaries.map(s => s.noiseRel ?? 0), 0);
  let lo = Math.min(-noise, ...rels, -2), hi = Math.max(noise, ...rels, 5);
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const sx = (v: number) => M.l + (v - lo) / (hi - lo) * iw;

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel });
  const yBot = H - G.bottom;

  // grid, zero line, ticks
  for (let v = lo; v <= hi + 1e-9; v += step) {
    const x = sx(v);
    svg.append(svgEl('line', { class: v === 0 ? 'center' : 'gridline', x1: x, x2: x, y1: G.top, y2: yBot }));
    svg.append(svgEl('text', { class: 'tick-label', x, y: yBot + 15, 'text-anchor': 'middle', text: v === 0 ? baseQuant : fmtSigned(v, 0) + '%' }));
  }
  svg.append(svgEl('text', { class: 'axis-label', x: M.l + iw / 2, y: H - 3, 'text-anchor': 'middle', text: `error change against ${baseQuant}, as a share of the ${baseQuant} error` }));

  quants.forEach((q, qi) => {
    const s = summaries.find(x => x.quant === q);
    const y0 = G.top + qi * (stripH + G.gap);
    const yMid = y0 + G.labelBand + G.dots / 2;

    // typical noise band for this quant, around zero
    if (s?.noiseRel) {
      svg.append(svgEl('rect', { class: 'noise-band', x: sx(-s.noiseRel), y: y0 + G.labelBand, width: sx(s.noiseRel) - sx(-s.noiseRel), height: G.dots, rx: 4 }));
    }
    // strip label
    svg.append(svgEl('text', { class: 'strip-label', x: M.l - 10, y: yMid + 4, 'text-anchor': 'end', text: q }));
    if (s) svg.append(svgEl('text', { class: 'tick-label', x: M.l - 10, y: yMid + 18, 'text-anchor': 'end', text: `${s.n} languages` }));

    // beeswarm: worst first so the labelled dots claim the centre lane
    const pts = rows.flatMap(r => r.cells[q] ? [{ r, c: r.cells[q]! }] : []).sort((a, b) => b.c.rel - a.c.rel);
    const lanes = Math.floor(G.dots / (2 * R + 1));
    const placed: { x: number; lane: number }[] = [];
    const laneOrder = [0];
    for (let k = 1; k <= lanes; k++) laneOrder.push(k, -k);
    const dots = pts.map(p => {
      const x = sx(p.c.rel);
      const lane = laneOrder.find(l => Math.abs(l) * (2 * R + 1) <= G.dots / 2 - R &&
        !placed.some(o => o.lane === l && Math.abs(o.x - x) < 2 * R + 1)) ?? 0;
      placed.push({ x, lane });
      return { ...p, x, y: yMid + lane * (2 * R + 1) };
    });

    for (const d of dots) {
      const worse = d.c.vsCi === 'above';
      svg.append(svgEl('circle', { cx: d.x, cy: d.y, r: R, class: worse ? 'dot-worse' : 'dot-noise' }));
    }
    // labels: the worst few that are measurably worse; failing that, the worst two
    const toLabel = (dots.filter(d => d.c.vsCi === 'above').slice(0, LABEL_MAX));
    if (!toLabel.length) toLabel.push(...dots.slice(0, 2));
    toLabel.forEach((d, i) => {
      const ly = y0 + 11 + i * 12;
      const text = `${d.r.name} ${fmtSigned(d.c.delta)} pts`;
      // to the right of the leader unless that would leave the SVG
      const flip = d.x + 5 + text.length * 6.2 > W - 4;
      svg.append(svgEl('line', { class: 'leader', x1: d.x, y1: d.y - R - 1, x2: d.x, y2: ly + 3 }));
      svg.append(svgEl('text', { class: 'direct-label', x: d.x + (flip ? -5 : 5), y: ly, 'text-anchor': flip ? 'end' : 'start', text }));
    });
    // hit targets and tooltips, on top
    for (const d of dots) {
      const tip: TipRows = [
        [baseQuant, `${fmtErr(d.r.base.err)}%${d.r.base.lo != null ? ` (${fmtErr(d.r.base.lo)}–${fmtErr(d.r.base.hi)})` : ''}`],
        [q, `${fmtErr(d.c.err)}%${d.c.lo != null ? ` (${fmtErr(d.c.lo)}–${fmtErr(d.c.hi)})` : ''}`],
        ['change', `${fmtSigned(d.c.delta)} pts · ${fmtPct(d.c.rel)}`],
        [`vs ${baseQuant} 95% CI`, d.c.vsCi === 'inside' ? 'inside · within noise' : d.c.vsCi],
        ...(extraTip?.[q] ?? []),
      ];
      const hit = svgEl('circle', { cx: d.x, cy: d.y, r: 9, fill: 'transparent', tabindex: '0', role: 'img',
        'aria-label': `${d.r.name} at ${q}: ${tip.map(t => t.join(' ')).join(', ')}` });
      attachTip(hit, () => tipShow(`${d.r.name} · ${q}`, tip));
      svg.append(hit);
    }
  });

  return svg;
}
