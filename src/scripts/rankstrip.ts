/* Rank strip for a set of three or more models: rows are models, columns
   are languages, each cell colored by the model's rank within the set on
   that language. Columns are grouped by which model wins, biggest margin
   first, so each model's wins read as a block. A dot marks a cell whose
   95% CI overlaps the set leader's; a hollow cell is no benchmark. */

import { RAMP } from '../lib/palette';
import { el, svgEl } from './dom';
import { attachTip, tipShow, type TipRows } from './tooltip';

export interface StripCell { rank: number; tie: boolean; tipRows: TipRows }

export interface StripPayload {
  /** rows, top to bottom */
  models: string[];
  /** columns, left to right */
  langs: { code: string; name: string }[];
  /** cells[model][lang]; missing where the model has no benchmark */
  cells: Record<string, Record<string, StripCell | undefined>>;
  ariaLabel: string;
}

const RANK_COLORS = [RAMP[6], RAMP[4], RAMP[2], RAMP[1], RAMP[0]];
export const rankColor = (rank: number): string => RANK_COLORS[Math.min(rank, RANK_COLORS.length) - 1];

export function rankStrip({ models, langs, cells, ariaLabel }: StripPayload): SVGSVGElement {
  const W = 860;
  const M = { t: 22, r: 24, b: 6, l: 156 };
  const gap = 2;
  const n = Math.max(1, langs.length);
  const cell = Math.max(12, Math.min(26, Math.floor((W - M.l - M.r - gap * (n - 1)) / n)));
  const rowH = cell + gap;
  const H = M.t + models.length * rowH + M.b;
  const x0 = (j: number) => M.l + j * (cell + gap);

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel });

  langs.forEach((l, j) => {
    svg.append(svgEl('text', { class: 'tick-label', x: x0(j) + cell / 2, y: M.t - 6, 'text-anchor': 'middle',
      style: cell < 16 ? 'font-size:8.5px' : null, text: l.code }));
  });
  models.forEach((m, i) => {
    const y = M.t + i * rowH;
    svg.append(svgEl('text', { class: 'direct-label', x: M.l - 8, y: y + cell / 2 + 3.5, 'text-anchor': 'end', text: m }));
    langs.forEach((l, j) => {
      const c = cells[m]?.[l.code];
      const x = x0(j);
      if (!c) {
        svg.append(svgEl('rect', { class: 'strip-empty', x: x + 0.5, y: y + 0.5, width: cell - 1, height: cell - 1, rx: 3 }));
        return;
      }
      const g = svgEl('g', { tabindex: '0', 'aria-label': `${m}, ${l.name}: ${c.tipRows.map(t => t.join(' ')).join(', ')}` });
      g.append(svgEl('rect', { x, y, width: cell, height: cell, rx: 3, fill: rankColor(c.rank) }));
      if (c.tie) g.append(svgEl('circle', { cx: x + cell / 2, cy: y + cell / 2, r: Math.max(1.5, cell / 8), fill: 'var(--surface)' }));
      attachTip(g, () => tipShow(m, [[l.name, ''], ...c.tipRows]));
      svg.append(g);
    });
  });

  return svg;
}

export function stripLegend(k: number): HTMLElement {
  const keys: HTMLElement[] = [];
  for (let r = 1; r <= Math.min(k, RANK_COLORS.length); r++) {
    keys.push(el('span', { class: 'key' }, el('span', { class: 'swatch', style: `background:${rankColor(r)}` }),
      r === 1 ? 'best of the set' : `#${r}`));
  }
  keys.push(el('span', { class: 'key' }, el('span', { class: 'swatch tie-swatch' }), 'dot: within the leader’s 95% CI'));
  keys.push(el('span', { class: 'key' }, el('span', { class: 'swatch empty-swatch' }), 'not benchmarked'));
  return el('div', { class: 'legend' }, ...keys);
}
