/* The set view (/languages?set=de,fr,ja): the one client-rendered island.
   Which languages are in the set is arbitrary, so the whole dataset is
   inlined into the page and the view is built here. A set of one is a
   static page (routes.ts); this script forwards to it.

   DOM contract (see src/pages/languages/index.astro):
     #langset-data                  <script type="application/json"> full Dataset
     select[data-set="island"]      the picker; enhanced here so changes render in place
     #langset-results               container this script owns
   State lives in the URL. */

import type { Cell, Dataset } from '../lib/types';
import { Derived } from '../lib/derive';
import { DEFAULT_LANG, RIGS } from '../lib/config';
import { paretoFrontier } from '../lib/frontier';
import { setUrl, parseSet } from '../lib/routes';
import { fmtErr, fmtGB, fmtX } from '../lib/format';
import { el, svgEl } from './dom';
import { makeTable, type Col } from './table';
import { buildScatterSection } from './scatter';
import { enhanceCombobox } from './combobox';
import { pickTags, autoDetectBadge, isPick } from './picks';
import { RECOMMENDATION, pickTagsFor, recommendModels, type Picks } from '../lib/recommendation';

interface Row {
  model: string;
  cells: Cell[];
  geomean: number | null;
  _pick?: boolean;
  _frontier?: boolean;
  /** overall rank by geomean within the full-coverage set */
  rank: number | null;
  /** per-language rank within the full-coverage set */
  ranks: Record<string, number>;
}

export function initLangSet(): void {
  const dataEl = document.getElementById('langset-data');
  const resultsEl = document.getElementById('langset-results');
  const sel = document.querySelector<HTMLSelectElement>('select[data-set="island"]');
  if (!dataEl || !resultsEl || !sel) return;
  const results: HTMLElement = resultsEl;
  const D = JSON.parse(dataEl.textContent || '{}') as Dataset;
  const d = new Derived(D);

  const url = (codes: string[]) => setUrl('/languages', codes);
  const readCodes = () => parseSet(new URLSearchParams(location.search)).filter(c => d.lang(c));
  let codes = readCodes();
  if (codes.length < 2) { location.replace(url(codes.length ? codes : [DEFAULT_LANG])); return; }
  // canonical URL: unknown codes dropped, one form of the query
  if (location.pathname + location.search !== url(codes)) history.replaceState(null, '', url(codes));

  const picker = enhanceCombobox(sel, { multiple: true, min: 1, onChange: next => {
    if (next.length < 2) { location.href = url(next); return; }
    codes = next;
    history.pushState(null, '', url(codes));
    render();
  } });
  picker.setValues(codes);
  window.addEventListener('popstate', () => {
    codes = readCodes();
    if (codes.length < 2) { location.reload(); return; }
    picker.setValues(codes);
    render();
  });

  const quant = d.quant;

  function render(): void {
    // the set keeps the order the languages were added in (it's the URL order)
    const langs = codes.filter(c => d.lang(c)!.tested);
    const coverageLangs = codes.filter(c => !d.lang(c)!.tested);
    const mixed = new Set(langs.map(l => d.lang(l)!.metric)).size > 1;
    const metricName = mixed ? 'WER/CER' : langs.length ? d.metricLabel(langs[0]) : 'err';

    /* Only models covering every selected language belong on this page. A
       tested result proves coverage; card-only languages require a claim. */
    const rows: Row[] = [];
    for (const m of d.modelNames) {
      const cells = langs.map(l => d.cell(m, l));
      if (cells.some(c => c == null)) continue;
      if (!coverageLangs.every(l => d.claims(m).has(l))) continue;
      const complete = cells as Cell[];
      const geomean = complete.length > 0
        ? Math.exp(complete.reduce((s, c) => s + Math.log(c.err), 0) / complete.length)
        : null;
      rows.push({ model: m, cells: complete, geomean, rank: null, ranks: {} });
    }

    /* ranks within the complete-coverage set: overall by geomean, and per language */
    rows.filter(r => r.geomean != null).sort((a, b) => a.geomean! - b.geomean!)
      .forEach((r, i) => { r.rank = i + 1; });
    langs.forEach((l, i) => {
      [...rows].sort((a, b) => a.cells[i]!.err - b.cells[i]!.err)
        .forEach((r, ri) => { r.ranks[l] = ri + 1; });
    });

    results.replaceChildren();

    /* picks for the set (tagged in the table): overall / most accurate / fast, see picks.ts */
    const picks: Picks = recommendModels(d, codes);
    for (const r of rows) r._pick = isPick(picks, r.model);
    /* tagged models that cannot switch languages on their own get a visible caveat, not just the "!" */
    const caveats = picks.manualSwitch
      ? [...new Set([picks.overall, picks.accurate, picks.fast]
        .filter(p => p && d.model(p.model).lang_detect !== true).map(p => p!.model))]
        .map(m => el('p', { class: 'hint' }, el('span', { class: 'warn-icon', text: '!' }), ' ',
          `${pickTagsFor(picks, m).map(t => t.label).join(' and ')} ${m} can't switch languages on its own, so you'd set the language in Handy by hand each time you switch.`))
      : [];
    if (picks.reason === 'no-benchmark-data') {
      const text = coverageLangs.length
        ? 'No recommendation: every selected language needs benchmark data. Complete model-card coverage is still listed.'
        : 'No recommendation: no model has benchmark data for this whole set.';
      results.append(el('p', { class: 'hint', text }));
    } else if (picks.reason === 'error-too-high') {
      results.append(el('p', { class: 'hint', text: 'No supported recommendation: the best model is at least 30% wrong on its weakest selected language.' }));
    } else if (picks.status === 'experimental') {
      results.append(el('p', { class: 'hint', text: 'Experimental recommendation: no model stays below 20% error on every selected language.' }));
    }

    /* Models at or beyond the experimental error ceiling stay behind the
       table's disclosure row and are excluded from the chart until it opens.
       Incomplete models are absent from both. */
    const errorCutoff = RECOMMENDATION.experimentalMaxError;
    const defaultRows = rows.filter(r => r.cells.every(c => c.err < errorCutoff));
    const worseRows = rows.filter(r => r.cells.some(c => c.err >= errorCutoff));
    let showWorse = false;
    let onlyHighlighted = false;

    /* frontier rows in the table follow the chart's default rig (the Handy GPU)
       and the chart's error cutoff, so they match the chart on first paint */
    const frontierRig = RIGS[0];
    const frontier = paretoFrontier(rows
      .filter(r => r.geomean != null && r.geomean < RECOMMENDATION.maxError)
      .flatMap(r => { const x = d.perfOf(r.model, frontierRig.id); return x == null ? [] : [{ id: r.model, x, y: r.geomean! }]; }));
    for (const r of rows) r._frontier = frontier.has(r.model);

    const scatterHolder = el('div');
    results.append(scatterHolder);
    function drawScatter(): void {
      const chartRows = showWorse ? rows : defaultRows;
      const geoPts = chartRows.filter(r => r.geomean != null);
      scatterHolder.replaceChildren();
      if (geoPts.length <= 1) return;
      scatterHolder.append(buildScatterSection({
        langText: `geometric mean over ${langs.map(l => d.langName(l)).join(', ')} · ${geoPts.length} models`,
        points: geoPts.map(r => ({ model: r.model, err: r.geomean!, metricName: 'geomean',
          extraTip: langs.map((l, i) => [d.langName(l), fmtErr(r.cells[i]!.err) + '%'] as [string, string]) })),
        perf: Object.fromEntries(geoPts.map(r => [r.model, d.model(r.model).perf])),
      }));
    }
    drawScatter();

    if (mixed) results.append(el('p', { class: 'hint', text: 'The set mixes WER and CER languages; the geometric mean blends both.' }));
    results.append(...caveats);
    const tableHolder = el('div');
    results.append(tableHolder);

    function drawTable(): void {
      const cols: Col<Row>[] = [
        { key: 'rank', label: '#', num: true, sortVal: r => r.rank,
          render: r => r.rank ? el('span', { class: 'rank-badge', text: String(r.rank) }) : el('span', { class: 'dim', text: '—' }) },
        { key: 'model', label: 'model', sortVal: r => r.model,
          render: r => el('span', { class: 'model-cell' },
            el('span', { class: 'model-label', text: r.model }),
            autoDetectBadge(d, r.model, true), ...pickTags(picks, r.model)),
          tdClass: () => ['model-name'] },
      ];
      if (langs.length > 0) cols.push({
        key: 'geo', label: `geomean ${metricName} %`, num: true, title: 'geometric mean of error across the set',
        sortVal: r => r.geomean,
        render: r => r.geomean != null
          ? el('span', { class: 'err-main', text: fmtErr(r.geomean) })
          : el('span', { class: 'dim', text: '—' }),
      });
      langs.forEach((l, i) => cols.push({
        key: 'l-' + l, label: `${d.langName(l)} ${d.metricLabel(l)}`, num: true,
        sortVal: r => r.cells[i] ? r.cells[i]!.err : null,
        render: r => {
          const c = r.cells[i]!;
          return el('span', null,
            el('span', { text: fmtErr(c.err) }),
            el('span', { class: 'rk', text: r.ranks[l] ? '#' + r.ranks[l] : '' }));
        },
      }));
      for (const l of coverageLangs) cols.push({
        key: 'c-' + l, label: `${d.langName(l)} (card)`,
        sortVal: r => d.claims(r.model).has(l) ? 0 : 1,
        render: r => d.claims(r.model).has(l)
          ? el('span', { class: 'badge', text: 'claimed' })
          : el('span', { class: 'dim', text: '—' }),
      });
      cols.push(
        { key: 'rgpu', label: 'AMD 4750U GPU', num: true, title: 'Vulkan, × realtime', sortVal: r => d.perfOf(r.model, 'r-gpu'), render: r => fmtX(d.perfOf(r.model, 'r-gpu')) },
        { key: 'rcpu', label: 'AMD 4750U CPU', num: true, title: '× realtime', sortVal: r => d.perfOf(r.model, 'r-cpu'), render: r => fmtX(d.perfOf(r.model, 'r-cpu')) },
        { key: 'size', label: 'size', num: true, title: `${quant} GGUF size`, sortVal: r => d.sizeOf(r.model), render: r => fmtGB(d.sizeOf(r.model)) },
        { key: 'lic', label: 'license', sortVal: r => d.model(r.model).license ?? '',
          render: r => { const lic = d.model(r.model).license; return el('span', { class: 'dim trunc', title: lic, text: lic ?? '?' }); } },
      );
      if (!rows.length) {
        tableHolder.replaceChildren(el('p', { class: 'hint', text: 'No model covers the complete selected set.' }));
        return;
      }

      const shown = showWorse ? rows : defaultRows;
      const toggle = el('input', { type: 'checkbox', onchange: () => { onlyHighlighted = toggle.checked; } });
      toggle.checked = onlyHighlighted;
      const key = el('div', { class: 'legend table-key' },
        el('span', { class: 'key' }, el('span', { class: 'swatch' }),
          'highlighted rows are recommended picks or on pareto frontier'),
        el('label', { class: 'key table-key-toggle' }, toggle, ' only highlighted rows'));
      const wrap = makeTable({ cols, rows: shown, defaultSort: langs.length ? 'geo' : 'rgpu' });
      const table = wrap.querySelector('table');
      if (table && worseRows.length > 0) {
        const controls = el('tbody', { class: 'model-visibility-controls' });
        const td = el('td', { class: 'model-visibility-cell', colspan: String(cols.length) });
        const action = showWorse ? 'Hide' : 'Show';
        const noun = worseRows.length === 1 ? 'model' : 'models';
        const button = el('button', {
          type: 'button', class: 'model-visibility-button',
          'aria-expanded': String(showWorse),
          onclick: () => { showWorse = !showWorse; drawScatter(); drawTable(); },
        },
        svgEl('svg', { class: 'caret', viewBox: '0 0 16 16', width: '16', height: '16', 'aria-hidden': 'true' },
          svgEl('path', { d: 'M4 6l4 4 4-4', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
        `${action} ${worseRows.length} ${noun} with ${errorCutoff}% or worse ${metricName} on at least one language`);
        td.append(button);
        controls.append(el('tr', null, td));
        table.append(controls);
      }
      tableHolder.replaceChildren(key, wrap);
    }
    drawTable();
  }

  render();
}
