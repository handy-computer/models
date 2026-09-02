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
import { DEFAULT_LANG } from '../lib/config';
import { setUrl, parseSet } from '../lib/routes';
import { fmtErr, fmtGB, fmtX } from '../lib/format';
import { el } from './dom';
import { makeTable, type Col } from './table';
import { buildScatterSection } from './scatter';
import { enhanceCombobox } from './combobox';
import { pickTags, autoDetectBadge, isPick } from './picks';
import { pickTagsFor, type Picks } from '../lib/derive';

interface Row {
  model: string;
  cells: (Cell | null)[];
  geomean: number | null;
  full: boolean;
  have: number;
  _partial: boolean;
  _pick?: boolean;
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

    /* rows: every model benchmarked on at least one selected language, or claiming a coverage language */
    const rows: Row[] = [];
    for (const m of d.modelNames) {
      const cells = langs.map(l => d.cell(m, l) ?? null);
      const have = cells.filter((c): c is Cell => c !== null);
      const claimsAllCoverage = coverageLangs.every(l => d.claims(m).has(l));
      if (have.length === 0 && !(langs.length === 0 && claimsAllCoverage)) continue;
      const full = have.length === langs.length && claimsAllCoverage;
      const geomean = full && langs.length > 0
        ? Math.exp(have.reduce((s, c) => s + Math.log(c.err), 0) / have.length)
        : null;
      rows.push({ model: m, cells, geomean, full, have: have.length, _partial: !full, rank: null, ranks: {} });
    }

    /* ranks within the full-coverage set: overall by geomean, and per language */
    const fullRows = rows.filter(r => r.full);
    fullRows.filter(r => r.geomean != null).sort((a, b) => a.geomean! - b.geomean!)
      .forEach((r, i) => { r.rank = i + 1; });
    langs.forEach((l, i) => {
      fullRows.filter(r => r.cells[i]).sort((a, b) => a.cells[i]!.err - b.cells[i]!.err)
        .forEach((r, ri) => { r.ranks[l] = ri + 1; });
    });

    results.replaceChildren();

    /* picks for the set (tagged in the table): overall / most accurate / fast, see picks.ts */
    const geoRows = fullRows.filter(r => r.geomean != null);
    const picks: Picks = d.pickThree(geoRows.map(r => ({ model: r.model, err: r.geomean! })), { multi: true });
    for (const r of rows) r._pick = isPick(picks, r.model);
    /* tagged models that cannot switch languages on their own get a visible caveat, not just the "!" */
    const caveats = [...new Set([picks.overall, picks.accurate, picks.fast]
      .filter(p => p && d.lacksLangDetect(p.model)).map(p => p!.model))]
      .map(m => el('p', { class: 'hint' }, el('span', { class: 'warn-icon', text: '!' }), ' ',
        `${pickTagsFor(picks, m).map(t => t.label).join(' and ')} ${m} can't switch languages on its own, so you'd set the language in Handy by hand each time you switch.`));
    if (!geoRows.length) {
      results.append(el('p', { class: 'hint', text: 'No model covers this whole set. The table lists partial matches.' }));
    }

    /* geomean scatter over the full-coverage set */
    const geoPts = fullRows.filter(r => r.geomean != null);
    if (geoPts.length > 1) {
      results.append(buildScatterSection({
        langText: `geometric mean over ${langs.map(l => d.langName(l)).join(', ')} · ${geoPts.length} models`,
        points: geoPts.map(r => ({ model: r.model, err: r.geomean!, metricName: 'geomean',
          extraTip: langs.map((l, i) => [d.langName(l), fmtErr(r.cells[i]!.err) + '%'] as [string, string]) })),
        perf: Object.fromEntries(geoPts.map(r => [r.model, d.model(r.model).perf])),
      }));
    }

    /* coverage toggle + table */
    let onlyFull = geoRows.length > 0;
    const controls = el('div', { class: 'filter-row' });
    const toggle = el('button', { class: 'btn', type: 'button', 'aria-pressed': String(onlyFull),
      text: 'only models covering the whole set',
      onclick: () => { onlyFull = !onlyFull; toggle.setAttribute('aria-pressed', String(onlyFull)); drawTable(); } });
    controls.append(toggle);
    if (mixed) controls.append(el('span', { class: 'hint', text: 'the set mixes WER and CER languages; the geometric mean blends both' }));
    results.append(controls, ...caveats);
    const tableHolder = el('div');
    results.append(tableHolder);

    function drawTable(): void {
      const shown = onlyFull ? rows.filter(r => r.full) : rows;
      const cols: Col<Row>[] = [
        { key: 'rank', label: '#', num: true, sortVal: r => r.rank,
          render: r => r.rank ? el('span', { class: 'rank-badge', text: String(r.rank) }) : el('span', { class: 'dim', text: '—' }) },
        { key: 'model', label: 'model', sortVal: r => r.model,
          render: r => el('span', { class: 'model-cell' }, el('span', { class: 'model-label', text: r.model }),
            autoDetectBadge(d, r.model, true), ...pickTags(picks, r.model)),
          tdClass: () => ['model-name'] },
      ];
      if (langs.length > 0) cols.push({
        key: 'geo', label: `geomean ${metricName} %`, num: true, title: 'geometric mean of error across the set',
        sortVal: r => r.geomean,
        render: r => r.geomean != null
          ? el('span', { class: 'err-main', text: fmtErr(r.geomean) })
          : el('span', { class: 'dim', text: `${r.have}/${langs.length} tested` }),
      });
      langs.forEach((l, i) => cols.push({
        key: 'l-' + l, label: `${d.langName(l)} ${d.metricLabel(l)}`, num: true,
        sortVal: r => r.cells[i] ? r.cells[i]!.err : null,
        render: r => {
          // the rank box is always present (empty for partial rows) so the values line up
          const c = r.cells[i];
          if (c) {
            return el('span', null,
              el('span', { text: fmtErr(c.err) }),
              el('span', { class: 'rk', text: r.ranks[l] ? '#' + r.ranks[l] : '' }));
          }
          const claimed = d.claims(r.model).has(l);
          return el('span', { class: 'dim', title: claimed ? 'on the model card, not benchmarked' : 'not supported' },
            claimed ? 'claimed' : '—', el('span', { class: 'rk' }));
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
      tableHolder.replaceChildren(makeTable({ cols, rows: shown, defaultSort: langs.length ? 'geo' : 'rgpu' }));
      if (!shown.length) tableHolder.append(el('p', { class: 'hint', text: 'No model covers this whole set — toggle the coverage filter to see partial matches.' }));
    }
    drawTable();
  }

  render();
}
