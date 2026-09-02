/* The single model page's client side (see src/pages/models/[model].astro).
   The page is server-rendered for its default state: every language. This
   script re-renders the parts that depend on the language focus
   (?langs=de,fr) and draws the charts. Speed and the frontier count are on
   the first models-tab rig (the GPU); the verdict sentence covers both.

   DOM contract:
     #modelpage-data           JSON { model, rows: StandingRow[], speeds, rigs }
     select[data-set="filter"] the language focus; enhanced here, state in ?langs=
     #verdict                  the verdict sentences
     #frontier-stat            .k / .v of the frontier count
     #standing-title           chart title (carries the language count)
     #standing-chart           host for the difference chart
     #strip-rig, #speed-strip  rig name in the speed card title, host for the strip */

import type { Rig } from '../lib/config';
import type { StandingRow, SpeedRow } from '../lib/standing';
import { verdict } from '../lib/standing';
import { parseList, withLangs } from '../lib/routes';
import { seriesColor } from '../lib/palette';
import { fmtErr } from '../lib/format';
import type { TipRows } from './tooltip';
import { el } from './dom';
import { enhanceCombobox, type Combobox } from './combobox';
import { diffChart, type DiffRow } from './diff';
import { speedStrip } from './speedstrip';

interface Payload {
  model: string;
  rows: StandingRow[];
  speeds: Record<string, SpeedRow>;
  rigs: Rig[];
}

export function initModelPage(): void {
  const dataEl = document.getElementById('modelpage-data');
  if (!dataEl) return;
  const P = JSON.parse(dataEl.textContent || '{}') as Payload;
  const $ = (id: string) => document.getElementById(id);
  const verdictEl = $('verdict'), frontierEl = $('frontier-stat'), titleEl = $('standing-title'),
    chartEl = $('standing-chart'), stripEl = $('speed-strip'), stripRigEl = $('strip-rig');
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
