/* The single model page's client side (see src/pages/models/[model].astro).
   The page is server-rendered for its default state: every language. This
   script re-renders the parts that depend on the language focus
   (?langs=de,fr) and draws the charts. Speed and the frontier count are on
   the first models-tab rig (the GPU); the verdict sentence covers both.

   DOM contract:
     #modelpage-data           JSON { model, rows: StandingRow[], speeds, rigs, quant }
     select[data-set="filter"] the language focus; enhanced here, state in ?langs=
     #verdict                  the verdict sentences
     #frontier-stat            .k / .v of the frontier count
     #standing-title           chart title (carries the language count)
     #standing-chart           host for the difference chart
     #quant-title, #quant-verdict, #quant-tiles, #quant-chart
                               title, verdict sentence, headline tiles and host
                               for the quantization strip (absent when the
                               model has no lower quants)
     #quant-unusable-toggle    shows / hides the unusable rows of the per-language table
     #strip-rig, #speed-strip  rig name in the speed card title, host for the strip */

import type { Rig } from '../lib/config';
import type { StandingRow, SpeedRow } from '../lib/standing';
import { BASE_QUANT, quantSummaries, quantVerdict, type QuantRow, type QuantSummary } from '../lib/quant';
import { verdict } from '../lib/standing';
import { parseList, withLangs } from '../lib/routes';
import { seriesColor } from '../lib/palette';
import { fmtErr, fmtGB, fmtPct, fmtSigned } from '../lib/format';
import type { TipRows } from './tooltip';
import { el } from './dom';
import { enhanceCombobox, type Combobox } from './combobox';
import { diffChart, type DiffRow } from './diff';
import { quantStrip } from './quantchart';
import { speedStrip } from './speedstrip';

interface QuantPayload {
  base: string;
  quants: string[];
  /** every language, worst drift first */
  rows: QuantRow[];
  /** quant -> file size, the baseline included */
  sizes: Record<string, number | null>;
  /** quant -> tooltip rows about the file */
  sizeTip: Record<string, TipRows>;
}

interface Payload {
  model: string;
  rows: StandingRow[];
  speeds: Record<string, SpeedRow>;
  rigs: Rig[];
  quant: QuantPayload | null;
}

export function initModelPage(): void {
  const dataEl = document.getElementById('modelpage-data');
  if (!dataEl) return;
  const P = JSON.parse(dataEl.textContent || '{}') as Payload;
  const $ = (id: string) => document.getElementById(id);
  const verdictEl = $('verdict'), frontierEl = $('frontier-stat'), titleEl = $('standing-title'),
    chartEl = $('standing-chart'), stripEl = $('speed-strip'), stripRigEl = $('strip-rig'),
    quantTitleEl = $('quant-title'), quantVerdictEl = $('quant-verdict'), quantTilesEl = $('quant-tiles'), quantEl = $('quant-chart');

  // the per-language table's unusable rows, behind a disclosure row
  const unusableToggle = $('quant-unusable-toggle');
  unusableToggle?.addEventListener('click', () => {
    const open = unusableToggle.getAttribute('aria-expanded') !== 'true';
    unusableToggle.setAttribute('aria-expanded', String(open));
    const label = unusableToggle.querySelector('span');
    if (label) label.textContent = open ? unusableToggle.dataset.hide ?? '' : unusableToggle.dataset.show ?? '';
    for (const tr of document.querySelectorAll<HTMLElement>('tr.quant-unusable')) tr.hidden = !open;
  });
  const langSel = document.querySelector<HTMLSelectElement>('select[data-set="filter"]');
  const rigInfo = P.rigs[0], rig = rigInfo.id;
  const readLangs = () => parseList(new URLSearchParams(location.search), 'langs');
  let langs = readLangs();
  const pageUrl = () => withLangs(location.pathname, langs);
  if (location.pathname + location.search !== pageUrl()) history.replaceState(null, '', pageUrl());

  let picker: Combobox | null = null;
  if (langSel) {
    picker = enhanceCombobox(langSel, { multiple: true, min: 0, onChange: next => {
      langs = next;
      history.pushState(null, '', pageUrl());
      renderLangs();
    } });
    picker.setValues(langs);
  }
  window.addEventListener('popstate', () => { langs = readLangs(); picker?.setValues(langs); renderLangs(); });

  /** the rows in focus: every language, or the chosen ones */
  const scoped = () => langs.length ? P.rows.filter(r => langs.includes(r.lang)) : P.rows;

  function renderFrontier(rows: StandingRow[]): void {
    if (!frontierEl) return;
    const k = frontierEl.querySelector('.k'), v = frontierEl.querySelector('.v');
    if (k) k.textContent = `frontier · ${rigInfo.short}`;
    if (v) v.textContent = `${rows.filter(x => x.frontier[rig]).length} of ${rows.length}`;
  }

  /** the headline tiles for one quant, the same four the page renders */
  function quantTiles(s: QuantSummary, sizes: Record<string, number | null>): HTMLElement {
    const tile = (k: string, v: (string | Node)[], r: string) =>
      el('div', { class: 'tile' }, el('span', { class: 'k', text: k }), el('span', { class: 'v' }, ...v), el('span', { class: 'r', text: r }));
    const langsText = `${s.n} usable ${s.n === 1 ? 'language' : 'languages'}`;
    const row = el('div', { class: 'tile-row quant-tiles' },
      tile(`${s.quant} file`, [s.sizeFrac != null ? `${Math.round(100 * s.sizeFrac)}% ` : '— ', el('span', { class: 'u', text: `of ${BASE_QUANT}` })],
        `${fmtGB(s.size_gb)} against ${fmtGB(sizes[BASE_QUANT])}`),
      tile('median error change', [fmtPct(s.medianRel)], `over ${langsText}`),
      tile('measurably worse', [`${s.above} `, el('span', { class: 'u', text: `of ${s.n}` })], `above the ${BASE_QUANT} 95% confidence interval`),
      tile('worst usable language', [s.worst ? s.worst.name : '—'],
        s.worst ? `${fmtErr(s.worst.base)} → ${fmtErr(s.worst.err)} (${fmtSigned(s.worst.delta)} pts)` : 'no result'));
    const worstV = row.querySelectorAll('.v')[3];
    worstV?.classList.add('text');
    return row;
  }

  function renderQuant(): void {
    const Q = P.quant;
    if (!Q || !quantEl) return;
    const rows = langs.length ? Q.rows.filter(r => langs.includes(r.lang)) : Q.rows;
    const usable = rows.filter(r => r.usable);
    const summaries = quantSummaries(usable, Q.quants, Q.sizes);
    if (quantTitleEl) {
      const at = `at ${Q.quants.join(', ')}`;
      quantTitleEl.textContent = langs.length
        ? `quantization · ${usable.length} usable of the ${langs.length} chosen ${at}`
        : `quantization · ${usable.length} usable ${usable.length === 1 ? 'language' : 'languages'} ${at}`;
    }
    if (quantVerdictEl) quantVerdictEl.textContent = summaries.map(quantVerdict).join(' ');
    if (quantTilesEl) quantTilesEl.replaceChildren(...summaries.map(s => quantTiles(s, Q.sizes)));
    quantEl.replaceChildren(usable.length
      ? quantStrip({
          rows: usable, quants: Q.quants, summaries, baseQuant: Q.base,
          extraTip: Q.sizeTip,
          ariaLabel: `${P.model}: error change at ${Q.quants.join(', ')} against ${Q.base}, per usable language`,
        })
      : el('p', { class: 'hint', text: langs.length ? 'No usable quantization results for this model in the chosen languages.' : 'No usable quantization results for this model.' }));
  }

  function renderLangs(): void {
    const rows = scoped();
    const v = verdict(rows, P.speeds[P.model] ?? {});
    if (langs.length && !rows.length) v.standing = `No FLEURS benchmark for this model in ${langs.length === 1 ? 'that language' : 'those languages'}.`;
    if (verdictEl) {
      verdictEl.replaceChildren(el('strong', { text: langs.length ? `verdict in ${langs.length === 1 ? 'that language' : 'those languages'}: ` : 'verdict: ' }),
        [v.standing, v.weak, v.speed].filter(Boolean).join(' '));
    }
    if (titleEl) {
      titleEl.textContent = langs.length
        ? `standing by language · ${rows.length} of the ${langs.length} chosen`
        : `standing by language · ${rows.length} benchmarked`;
    }
    if (chartEl) {
      const diffRows: DiffRow[] = rows.filter(r => r.other && r.otherErr != null).map(r => {
        const tipRows: TipRows = [
          [P.model, `${fmtErr(r.err)}% (${fmtErr(r.lo)}–${fmtErr(r.hi)})`],
          [r.other!, `${fmtErr(r.otherErr)}% (${fmtErr(r.otherLo)}–${fmtErr(r.otherHi)})`],
          ['rank', `#${r.rank} of ${r.of}`],
          ['95% CIs', r.tie ? 'overlap · tie' : 'separate'],
        ];
        if (r.note) tipRows.push(['note', r.note]);
        return {
          label: r.name,
          value: Math.log2(r.err / r.otherErr!),
          tie: r.tie,
          firstValueText: `${fmtErr(r.err)}%`,
          secondValueText: `${fmtErr(r.otherErr)}%`,
          tail: r.other!,
          tipTitle: r.name,
          tipRows,
        };
      }).sort((a, b) => a.value - b.value);
      chartEl.replaceChildren(diffRows.length
        ? diffChart({
            rows: diffRows,
            ariaLabel: `${P.model} against the best other model, per language`,
            leftLabel: `${P.model} ahead`, rightLabel: 'best other model ahead',
            leftColor: seriesColor(0), rightColor: seriesColor(1),
          })
        : el('p', { class: 'hint', text: langs.length ? 'No benchmark for this model in the chosen languages.' : 'No benchmark for this model yet.' }));
    }
    renderQuant();
    renderFrontier(rows);
  }

  function renderRig(): void {
    renderFrontier(scoped());
    const r = rigInfo;
    if (stripRigEl) stripRigEl.textContent = r.short;
    if (stripEl) {
      const all: { model: string; x: number }[] = [];
      for (const [m, s] of Object.entries(P.speeds)) {
        const x = s[rig];
        if (x != null) all.push({ model: m, x });
      }
      stripEl.replaceChildren(speedStrip({
        rigLabel: r.label, all,
        highlight: [{ model: P.model, color: seriesColor(0) }],
        ariaLabel: `Speed of every model on the ${r.label}, ${P.model} highlighted`,
      }));
      if (P.speeds[P.model]?.[rig] == null) stripEl.append(el('p', { class: 'hint', text: `No speed data for ${P.model} on this rig.` }));
    }
  }

  renderLangs();
  renderRig();
}
