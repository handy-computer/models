/* Quantization drift: how a model's lower quants compare with its Q8_0
   baseline, language by language, and the per-quant summary the model page
   leads with (file size as a share of the baseline, median drift, how many
   languages sit above the baseline's confidence interval, the worst usable
   language) plus a one-sentence verdict. Languages the site already calls
   unusable (baseline error at or above the experimental ceiling) are kept
   out of the summary and the chart; the per-language table hides them
   behind a disclosure. Isomorphic: the page builds the rows at build time,
   the model page script filters them by the language focus and redraws. */

import type { Metric } from './types';
import type { Derived } from './derive';
import { RECOMMENDATION } from './recommendation';

export const BASE_QUANT = 'Q8_0';

/** a language counts toward the summary only when the baseline is usable */
export const QUANT_USABLE_MAX = RECOMMENDATION.experimentalMaxError;

/** display order; anything else sorts after these by file size */
const QUANT_ORDER = ['F32', 'BF16', 'F16', 'Q8_0', 'Q6_K', 'Q5_K_M', 'Q4_K_M'];

export type VsCi = 'inside' | 'above' | 'below';

export interface QuantCell {
  quant: string;
  err: number;
  lo: number | null;
  hi: number | null;
  /** err / baseline err; above 1 is worse than the baseline */
  ratio: number;
  /** err − baseline err, in error points */
  delta: number;
  /** delta as a percentage of the baseline err */
  rel: number;
  /** where the point estimate sits against the baseline's 95% CI; inside means within noise */
  vsCi: VsCi;
}

export interface QuantRow {
  lang: string;
  /** display name, "(CER)" appended where the language is scored by CER */
  name: string;
  metric: Metric;
  base: { err: number; lo: number | null; hi: number | null; n: number | null };
  /** the baseline is below the experimental ceiling */
  usable: boolean;
  /** quant -> cell; a quant missing here has no result in this language */
  cells: Record<string, QuantCell>;
  /** the largest relative drift over the quants present; rows sort by it */
  worstRel: number;
}

export interface QuantSummary {
  quant: string;
  size_gb: number | null;
  /** file size as a fraction of the baseline's, or null without both sizes */
  sizeFrac: number | null;
  /** usable languages with a result at this quant */
  n: number;
  medianRel: number | null;
  /** the usable language with the largest relative drift, with its absolute numbers */
  worst: { lang: string; name: string; base: number; err: number; delta: number; rel: number } | null;
  /** languages whose error sits above / below the baseline's 95% CI */
  above: number;
  below: number;
  /** median half-width of the baseline CI, as a percentage of the baseline: the typical noise */
  noiseRel: number | null;
}

/** the quants with results for this model other than the baseline, in display order */
export function quantsTested(d: Derived, model: string): string[] {
  const seen = new Set<string>();
  for (const c of d.D.cells) if (c.model === model && c.quant !== BASE_QUANT) seen.add(c.quant);
  const size = (q: string) => d.model(model).quants.find(x => x.quant === q)?.size_gb ?? -1;
  const rank = (q: string) => { const i = QUANT_ORDER.indexOf(q); return i < 0 ? QUANT_ORDER.length : i; };
  return [...seen].sort((a, b) => rank(a) - rank(b) || size(b) - size(a) || a.localeCompare(b));
}

/** file size per quant, the baseline included; null where the database has no file */
export function quantSizes(d: Derived, model: string, quants: string[]): Record<string, number | null> {
  const m = d.model(model);
  const out: Record<string, number | null> = {};
  for (const q of [BASE_QUANT, ...quants]) out[q] = m.quants.find(x => x.quant === q)?.size_gb ?? null;
  return out;
}

/** one row per language the model has a baseline for and at least one of `quants`, worst drift first */
export function quantRows(d: Derived, model: string, quants: string[]): QuantRow[] {
  const rows: QuantRow[] = [];
  for (const b of d.D.cells) {
    if (b.model !== model || b.quant !== BASE_QUANT) continue;
    const cells: Record<string, QuantCell> = {};
    let worstRel = -Infinity;
    for (const q of quants) {
      const c = d.cellIndex.get(`${model}|${b.lang}|${q}`);
      if (!c) continue;
      const delta = c.err - b.err;
      const rel = b.err > 0 ? 100 * delta / b.err : 0;
      const vsCi: VsCi = b.hi != null && c.err > b.hi ? 'above' : b.lo != null && c.err < b.lo ? 'below' : 'inside';
      cells[q] = { quant: q, err: c.err, lo: c.lo, hi: c.hi, ratio: b.err > 0 ? c.err / b.err : 1, delta, rel, vsCi };
      worstRel = Math.max(worstRel, rel);
    }
    if (!Object.keys(cells).length) continue;
    rows.push({
      lang: b.lang,
      name: d.langName(b.lang) + (b.metric === 'cer' ? ' (CER)' : ''),
      metric: b.metric,
      base: { err: b.err, lo: b.lo, hi: b.hi, n: b.n },
      usable: b.err < QUANT_USABLE_MAX,
      cells, worstRel,
    });
  }
  return rows.sort((a, b) => b.worstRel - a.worstRel || a.name.localeCompare(b.name));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** one summary per quant over the usable rows */
export function quantSummaries(rows: QuantRow[], quants: string[], sizes: Record<string, number | null>): QuantSummary[] {
  const baseSize = sizes[BASE_QUANT] ?? null;
  return quants.map(q => {
    const cs = rows.flatMap(r => r.usable && r.cells[q] ? [{ r, c: r.cells[q]! }] : []);
    let worst: typeof cs[number] | null = null;
    for (const x of cs) if (!worst || x.c.rel > worst.c.rel) worst = x;
    const size = sizes[q] ?? null;
    const halfWidths = cs.flatMap(x => x.r.base.hi != null && x.r.base.err > 0 ? [100 * (x.r.base.hi - x.r.base.err) / x.r.base.err] : []);
    return {
      quant: q,
      size_gb: size,
      sizeFrac: size != null && baseSize ? size / baseSize : null,
      n: cs.length,
      medianRel: cs.length ? median(cs.map(x => x.c.rel)) : null,
      worst: worst ? { lang: worst.r.lang, name: worst.r.name, base: worst.r.base.err, err: worst.c.err, delta: worst.c.delta, rel: worst.c.rel } : null,
      above: cs.filter(x => x.c.vsCi === 'above').length,
      below: cs.filter(x => x.c.vsCi === 'below').length,
      noiseRel: halfWidths.length ? median(halfWidths) : null,
    };
  });
}

/** the one-sentence reading of a quant's summary */
export function quantVerdict(s: QuantSummary): string {
  const share = s.sizeFrac != null ? `${Math.round(100 * s.sizeFrac)}% of the ${BASE_QUANT} file` : 'a smaller file';
  if (s.n === 0) return `No usable language has a ${s.quant} result.`;
  const langs = s.n === 1 ? 'the one usable language' : `every one of ${s.n} usable languages`;
  if (s.above === 0) return `${s.quant} is within noise on ${langs}: ${share} for no measurable accuracy cost.`;
  const med = s.medianRel ?? 0;
  if (med < 2) {
    return `${s.quant} is within noise on most languages, measurably worse on ${s.above} of ${s.n}, for ${share}.`;
  }
  return `Expect about ${Math.round(med)}% more errors at ${s.quant}, measurably worse on ${s.above} of ${s.n} usable languages, for ${share}.`;
}

/* Geometry shared with the chart (src/scripts/quantchart.ts) so the page can
   reserve the chart's footprint before the script runs: one strip per quant. */
export const QUANT_STRIP = { w: 860, top: 8, labelBand: 40, dots: 48, gap: 10, bottom: 34 };
export function quantStripHeight(nQuants: number): number {
  const g = QUANT_STRIP;
  return g.top + nQuants * (g.labelBand + g.dots) + Math.max(0, nQuants - 1) * g.gap + g.bottom;
}
