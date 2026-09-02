/* The model set view (/models?set=a,b,c&langs=de,fr): two or more models
   side by side. Client-rendered from the inlined dataset; a set of one is
   the static model page (routes.ts) and this script forwards to it.

   DOM contract (see src/pages/models/index.astro):
     #modelset-data              <script type="application/json"> full Dataset
     select[data-set="island"]   the model picker; enhanced here so changes render in place
     select[data-set="filter"]   the optional language focus, same treatment
     #modelset-results           container this script owns
   State lives in the URL. Speed is on the first models-tab rig (the GPU);
   the side-by-side table shows both. */

import type { Cell, Dataset } from '../lib/types';
import { Derived } from '../lib/derive';
import { DEFAULT_MODEL, MODEL_RIGS } from '../lib/config';
import { setUrl, withLangs, parseSet, parseList } from '../lib/routes';
import { features } from '../lib/features';
import { ciOverlap, coverageDiff, featureDiff } from '../lib/standing';
import { seriesColor } from '../lib/palette';
import { fmtErr, fmtGB, fmtX } from '../lib/format';
import { el } from './dom';
import { makeTable, type Col } from './table';
import { attachTip, tipShow, type TipRows } from './tooltip';
import { enhanceCombobox } from './combobox';
import { diffChart, diffLegend, type DiffRow } from './diff';
import { rankStrip, stripLegend, type StripCell } from './rankstrip';
import { speedStrip } from './speedstrip';
import { dotPlot } from './dots';

interface Row { model: string; _partial?: boolean }

export function initModelSet(): void {
  const dataEl = document.getElementById('modelset-data');
  const resultsEl = document.getElementById('modelset-results');
  const sel = document.querySelector<HTMLSelectElement>('select[data-set="island"]');
  const langSel = document.querySelector<HTMLSelectElement>('select[data-set="filter"]');
  if (!dataEl || !resultsEl || !sel) return;
  const results: HTMLElement = resultsEl;
  const d = new Derived(JSON.parse(dataEl.textContent || '{}') as Dataset);

  const params = () => new URLSearchParams(location.search);
  const readNames = () => parseSet(params()).filter(m => d.hasModel(m));
  const readLangs = () => parseList(params(), 'langs').filter(c => d.lang(c)?.tested);
  const url = (ns: string[], ls: string[]) => withLangs(setUrl('/models', ns), ls);
  let names = readNames();
  let langs = readLangs();
  if (names.length < 2) { location.replace(url(names.length ? names : [DEFAULT_MODEL], langs)); return; }
  // canonical URL: unknown models and languages dropped, one form of the query
  if (location.pathname + location.search !== url(names, langs)) history.replaceState(null, '', url(names, langs));

  const picker = enhanceCombobox(sel, { multiple: true, min: 1, onChange: next => {
    if (next.length < 2) { location.href = url(next, langs); return; }
    names = next;
    history.pushState(null, '', url(names, langs));
    render();
  } });
  picker.setValues(names);
  const langPicker = langSel ? enhanceCombobox(langSel, { multiple: true, min: 0, onChange: next => {
    langs = next;
    history.pushState(null, '', url(names, langs));
    render();
  } }) : null;
  langPicker?.setValues(langs);
  window.addEventListener('popstate', () => {
    names = readNames();
    langs = readLangs();
    if (names.length < 2) { location.reload(); return; }
    picker.setValues(names);
    langPicker?.setValues(langs);
    render();
  });

  const rg = MODEL_RIGS[0], rig = rg.id;

  const quant = d.quant;
  const modelHref = (m: string) => '/models/' + encodeURIComponent(m);
  const label = (l: string) => d.langName(l) + (d.lang(l)?.metric === 'cer' ? ' (CER)' : '');
  const ci = (c: Cell) => `${fmtErr(c.err)}% (${fmtErr(c.lo)}–${fmtErr(c.hi)})`;
  const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

  function render(): void {
    results.replaceChildren();
    const k = names.length;
    const cellsOf = new Map<string, Map<string, Cell>>(
      names.map(m => [m, new Map(d.cellsForModel(m).map(c => [c.lang, c]))]));
    const cellOf = (m: string, l: string): Cell | undefined => cellsOf.get(m)!.get(l);
    const errOf = (m: string, l: string): number | null => cellOf(m, l)?.err ?? null;
    const scope = langs.length ? langs : d.testedLangs.map(l => l.code);
    const cov = coverageDiff(d, names, scope);
    const shared = cov.shared;
    const union = scope.filter(l => names.some(m => cellOf(m, l)));
    const focusText = langs.length ? (langs.length === 1 ? d.langName(langs[0]) : `the ${langs.length} chosen languages`) : '';

    /* coverage line: who covers what, counts with the names on hover */
    const covLine = el('p', { class: 'coverage' }, el('strong', { text: 'coverage: ' }));
    const count = (n: number, text: string, list: string[]) => {
      const span = el('span', { class: 'n', text: `${n} ${text}` });
      if (list.length) {
        span.setAttribute('tabindex', '0');
        attachTip(span, () => tipShow(text, list.map(l => [d.langName(l), ''] as [string, string])));
      }
      return span;
    };
    covLine.append(count(shared.length, langs.length ? `of ${scope.length} shared` : 'shared', shared));
    for (const m of names) covLine.append(' · ', count(cov.only[m].length, `only ${m}`, cov.only[m]));
    if (cov.partial.length) covLine.append(' · ', count(cov.partial.length, 'covered by some', cov.partial));
    if (langs.length && cov.none.length) covLine.append(' · ', count(cov.none.length, 'by none of these', cov.none));

    /* head to head over the languages every model covers */
    if (shared.length > 0) {
      const geo = new Map(names.map(m => [m,
        Math.exp(shared.reduce((s, l) => s + Math.log(errOf(m, l)!), 0) / shared.length)]));
      const wins = new Map(names.map(m => [m, 0]));
      const clear = new Map(names.map(m => [m, 0]));
      let ties = 0;
      for (const l of shared) {
        const ranked = [...names].sort((a, b) => errOf(a, l)! - errOf(b, l)!);
        const best = ranked[0], second = ranked[1];
        wins.set(best, wins.get(best)! + 1);
        if (ciOverlap(cellOf(best, l)!, cellOf(second, l)!)) ties++;
        else clear.set(best, clear.get(best)! + 1);
      }
      const winner = [...names].sort((a, b) => geo.get(a)! - geo.get(b)!)[0];
      const stat = (m: string) => el('div', { class: 'pick-stat' },
        el('span', { class: 'k mono', text: m }),
        el('span', { class: 'v', text: fmtErr(geo.get(m)) + '%' }));
      const parts = names.map((m, i) => {
        const w = wins.get(m)!, c = clear.get(m)!;
        return `${m} ahead on ${w}${i === 0 ? ` of ${shared.length}` : ''}${w ? ` (${c} clear of the 95% CI)` : ''}`;
      });
      parts.push(`${plural(ties, 'tie')}`);
      results.append(el('div', { class: 'pick-card' },
        el('div', { class: 'pick-head' },
          el('span', { class: 'pick-label', text: `lowest geomean error · ${shared.length} ${langs.length ? `of ${focusText}` : 'languages'} all ${k} cover` }),
          el('a', { class: 'pick-model', href: modelHref(winner), text: winner })),
        ...names.map(stat),
        el('p', { class: 'pick-verdict' }, el('strong', { text: 'head to head: ' }), parts.join(' · ')),
        covLine));
    } else {
      results.append(el('div', { class: 'pick-card' },
        el('p', { class: 'pick-verdict', text: langs.length
          ? `No language in ${focusText} is benchmarked for every model in the set, so there is no head-to-head.`
          : 'These models share no benchmarked language, so there is no head-to-head.' }),
        covLine));
    }

    /* side by side: speed, size, license, capabilities */
    const cols: Col<Row>[] = [
      { key: 'model', label: 'model', sortVal: r => r.model, render: r => el('span', { class: 'model-label', text: r.model }), tdClass: () => ['model-name'] },
      ...MODEL_RIGS.map((rg): Col<Row> => ({
        key: rg.id, label: rg.short, num: true, title: `${rg.label}, × realtime`,
        sortVal: r => d.perfOf(r.model, rg.id), render: r => fmtX(d.perfOf(r.model, rg.id)),
      })),
      { key: 'size', label: 'size', num: true, title: `${quant} GGUF size`, sortVal: r => d.sizeOf(r.model), render: r => fmtGB(d.sizeOf(r.model)) },
      { key: 'lic', label: 'license', sortVal: r => d.model(r.model).license ?? '',
        render: r => { const lic = d.model(r.model).license; return el('span', { class: 'dim trunc', title: lic, text: lic ?? '?' }); } },
      { key: 'feat', label: 'features', sortVal: r => features(d.model(r.model)).length, tdClass: () => ['nowrap'],
        render: r => { const on = features(d.model(r.model)); return on.length
          ? el('span', null, ...on.map(f => el('span', { class: 'badge', title: f.full, text: f.short })))
          : el('span', { class: 'dim', text: '—' }); } },
    ];
    const side = el('div', { class: 'card' },
      el('h3', { text: 'side by side' }),
      makeTable({ cols, rows: names.map(model => ({ model })), defaultSort: '' }));
    const diffs = featureDiff(d, names);
    if (diffs.length) side.append(el('p', { class: 'card-note' }, el('strong', { text: 'not shared: ' }), diffs.join(' · ')));
    results.append(side);

    /* speed strip: the whole field on the chosen rig, this set highlighted */
    const all: { model: string; x: number }[] = [];
    for (const m of d.modelNames) { const x = d.perfOf(m, rig); if (x != null) all.push({ model: m, x }); }
    const noSpeed = names.filter(m => d.perfOf(m, rig) == null);
    const speedCard = el('div', { class: 'card chart-card' },
      el('p', { class: 'chart-title', text: `speed · all ${all.length} models on the ${rg.short}` }),
      el('p', { class: 'chart-sub', text: '× realtime, log scale. Left of the realtime marker, transcribing takes longer than the recording. Hover a dot for the model.' }),
      speedStrip({ rigLabel: rg.label, all, highlight: names.map((m, i) => ({ model: m, color: seriesColor(i) })),
        ariaLabel: `Speed of every model on the ${rg.label}, ${names.join(', ')} highlighted` }));
    if (noSpeed.length) speedCard.append(el('p', { class: 'hint', text: `no speed data: ${noSpeed.join(', ')}` }));
    results.append(speedCard);

    /* accuracy: a pair gets the difference chart, a larger set the rank strip and the dot plot */
    if (k === 2 && shared.length > 0) {
      const [a, b] = names;
      const rows: DiffRow[] = shared.map(l => {
        const ca = cellOf(a, l)!, cb = cellOf(b, l)!;
        const tie = ciOverlap(ca, cb);
        const tipRows: TipRows = [[a, ci(ca)], [b, ci(cb)], ['95% CIs', tie ? 'overlap · tie' : 'separate']];
        if (ca.note) tipRows.push([`note (${a})`, ca.note]);
        if (cb.note) tipRows.push([`note (${b})`, cb.note]);
        return { label: label(l), value: Math.log2(ca.err / cb.err), tie,
          firstValueText: `${fmtErr(ca.err)}%`, secondValueText: `${fmtErr(cb.err)}%`,
          tipTitle: d.langName(l), tipRows };
      }).sort((x, y) => x.value - y.value);
      results.append(el('div', { class: 'card chart-card' },
        el('p', { class: 'chart-title', text: `where each wins · ${shared.length} shared languages` }),
        el('p', { class: 'chart-sub', text: `Each bar is the ratio of the two error rates, on a log scale: left of center ${a} is ahead, right of center ${b}. The printed error rates use the legend colors: ${a} first, ${b} second. Faded bars are ties, where the 95% confidence intervals overlap. Sorted from ${a}'s biggest lead to ${b}'s. Hover a row for full details.` }),
        diffLegend(`${a} ahead`, `${b} ahead`, seriesColor(0), seriesColor(1)),
        diffChart({ rows, ariaLabel: `${a} against ${b}, per language`,
          leftLabel: `${a} ahead`, rightLabel: `${b} ahead`, leftColor: seriesColor(0), rightColor: seriesColor(1) })));
    }

    if (k >= 3) {
      const stripLangs = scope.filter(l => names.filter(m => cellOf(m, l)).length >= 2);
      if (stripLangs.length) {
        const cells: Record<string, Record<string, StripCell | undefined>> = {};
        for (const m of names) cells[m] = {};
        const wins = new Map(names.map(m => [m, 0]));
        const info = stripLangs.map(l => {
          const ranked = names.filter(m => cellOf(m, l)).sort((x, y) => errOf(x, l)! - errOf(y, l)!);
          const leader = cellOf(ranked[0], l)!, second = cellOf(ranked[1], l)!;
          ranked.forEach((m, i) => {
            const c = cellOf(m, l)!;
            cells[m][l] = {
              rank: i + 1,
              tie: i === 0 ? ciOverlap(leader, second) : ciOverlap(leader, c),
              tipRows: [[c.metric.toUpperCase(), ci(c)], ['in this set', `#${i + 1} of ${ranked.length}`],
                ...(i > 0 ? [['vs the set leader', `${ranked[0]} · ${fmtErr(leader.err)}%`] as [string, string]] : [])],
            };
          });
          wins.set(ranked[0], wins.get(ranked[0])! + 1);
          return { l, winner: ranked[0], margin: second.err / leader.err };
        });
        const order = [...names].sort((x, y) => wins.get(y)! - wins.get(x)! || names.indexOf(x) - names.indexOf(y));
        info.sort((x, y) => order.indexOf(x.winner) - order.indexOf(y.winner) || y.margin - x.margin);
        results.append(el('div', { class: 'card chart-card' },
          el('p', { class: 'chart-title', text: `who wins where · ${stripLangs.length} languages at least two cover` }),
          el('p', { class: 'chart-sub', text: 'Each cell is a model\'s rank within this set on that language, darker is better. Columns are grouped by the winning model, biggest margin first, so each model\'s wins read as a block. Hover a cell for the numbers.' }),
          stripLegend(k),
          rankStrip({ models: order, langs: info.map(i => ({ code: i.l, name: label(i.l) })), cells,
            ariaLabel: `Rank of ${names.join(', ')} within the set, per language` })));
      }

      if (union.length) {
        const spread = (l: string) => {
          const vs = names.map(m => errOf(m, l)).filter((v): v is number => v != null);
          return vs.length > 1 ? Math.max(...vs) / Math.min(...vs) : 0;
        };
        const rows = [...union].sort((x, y) => spread(y) - spread(x)).map(l => ({
          label: label(l),
          values: names.map(m => errOf(m, l)),
          tipTitle: d.langName(l),
          tipRows: names.map(m => {
            const c = cellOf(m, l);
            return [m, c ? ci(c) : (d.claims(m).has(l) ? 'on the card, not benchmarked' : '—')] as [string, string];
          }),
        }));
        const legend = el('div', { class: 'legend' }, ...names.map((m, i) =>
          el('span', { class: 'key mono' }, el('span', { class: 'dot', style: `background:${seriesColor(i)}` }), m)));
        results.append(el('div', { class: 'card chart-card' },
          el('p', { class: 'chart-title', text: `error by language · ${union.length} benchmarked by at least one` }),
          el('p', { class: 'chart-sub', text: 'FLEURS test split on a log axis, the biggest disagreements first. A missing dot means no benchmark for that model. Hover a row for the numbers.' }),
          legend,
          dotPlot({ series: names, rows, log: true, ariaLabel: `Error rate per language for ${names.join(', ')}` })));
      }
    }
  }

  render();
}
