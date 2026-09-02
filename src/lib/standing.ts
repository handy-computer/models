/* Model standing: how one model compares with the field, language by
   language, and what the model pages build from it: the verdict sentence,
   frontier counts, compare-with suggestions, and the coverage and feature
   diffs of a set. Isomorphic: pages use it at build time, the model islands
   in the browser. */

import type { Cell, Metric, ModelInfo } from './types';
import type { Derived } from './derive';
import { MODEL_RIGS } from './config';
import { fmtX } from './format';

/** both cells carry a 95% CI and the intervals overlap: a tie, not a win */
export function ciOverlap(a: Cell, b: Cell): boolean {
  if (a.lo == null || a.hi == null || b.lo == null || b.hi == null) return false;
  return a.lo <= b.hi && b.lo <= a.hi;
}

/** models on the accuracy-vs-speed Pareto frontier for one language and rig:
    no other model is both faster and more accurate there */
export function frontierModels(d: Derived, lang: string, rigId: string): Set<string> {
  const pts: { m: string; x: number; y: number }[] = [];
  for (const c of d.cellsForLang(lang)) {
    const x = d.perfOf(c.model, rigId);
    if (x != null) pts.push({ m: c.model, x, y: c.err });
  }
  const out = new Set<string>();
  for (const p of pts) {
    const dominated = pts.some(q => q !== p && q.x >= p.x && q.y <= p.y && (q.x > p.x || q.y < p.y));
    if (!dominated) out.add(p.m);
  }
  return out;
}

export interface StandingRow {
  lang: string;
  /** display name, "(CER)" appended where the language is scored by CER */
  name: string;
  metric: Metric;
  err: number;
  lo: number | null;
  hi: number | null;
  n: number | null;
  note: string | null;
  /** among every model benchmarked on the language */
  rank: number;
  of: number;
  /** the best other model: the leader, or the runner-up when this model leads */
  other: string | null;
  otherErr: number | null;
  otherLo: number | null;
  otherHi: number | null;
  /** 95% CIs overlap with `other` */
  tie: boolean;
  /** err / otherErr; below 1 means ahead */
  ratio: number | null;
  /** rig id -> on the frontier there */
  frontier: Record<string, boolean>;
}

/** one row per language the model is benchmarked on, against the best other model */
export function standingRows(d: Derived, model: string): StandingRow[] {
  return d.cellsForModel(model).map(c => {
    const field = d.cellsForLang(c.lang).sort((a, b) => a.err - b.err);
    const other = field.find(x => x.model !== model) ?? null;
    const frontier: Record<string, boolean> = {};
    for (const r of MODEL_RIGS) frontier[r.id] = frontierModels(d, c.lang, r.id).has(model);
    return {
      lang: c.lang,
      name: d.langName(c.lang) + (c.metric === 'cer' ? ' (CER)' : ''),
      metric: c.metric,
      err: c.err, lo: c.lo, hi: c.hi, n: c.n, note: c.note,
      rank: field.findIndex(x => x.model === model) + 1,
      of: field.length,
      other: other?.model ?? null,
      otherErr: other?.err ?? null,
      otherLo: other?.lo ?? null,
      otherHi: other?.hi ?? null,
      tie: other ? ciOverlap(c, other) : false,
      ratio: other ? c.err / other.err : null,
      frontier,
    };
  });
}

/** rig id -> × realtime */
export type SpeedRow = Record<string, number | null>;

/** every model's speed on the models-tab rigs */
export function speedTable(d: Derived): Record<string, SpeedRow> {
  const out: Record<string, SpeedRow> = {};
  for (const m of d.modelNames) {
    const row: SpeedRow = {};
    for (const r of MODEL_RIGS) row[r.id] = d.perfOf(m, r.id);
    out[m] = row;
  }
  return out;
}

const listNames = (xs: string[]): string =>
  xs.length <= 2 ? xs.join(' and ') : xs.slice(0, -1).join(', ') + ', and ' + xs[xs.length - 1];

export interface Verdict {
  /** how often it leads or ties the leader */
  standing: string;
  /** where it trails the field most; null when there are too few languages to say */
  weak: string | null;
  /** realtime or not on each rig */
  speed: string;
}

/** three plain sentences about a model, from its standing rows and its speeds */
export function verdict(rows: StandingRow[], speed: SpeedRow): Verdict {
  const N = rows.length;
  const firsts = rows.filter(r => r.rank === 1);
  const tied = rows.filter(r => r.rank !== 1 && r.tie);
  const one = N === 1 ? rows[0].name : '';

  let standing: string;
  if (N === 0) {
    standing = 'No FLEURS benchmark for this model yet.';
  } else if (firsts.length === N) {
    standing = N === 1 ? `Best in its one benchmarked language, ${one}.` : `Best in all ${N} of its benchmarked languages.`;
  } else if (firsts.length > 0) {
    standing = `Best in ${firsts.length} of ${N} languages`;
    if (N <= 5) standing += ` (${listNames(firsts.map(r => r.name))})`;
    standing += tied.length
      ? `, and tied with the leader in ${tied.length === 1 ? 'one more' : `${tied.length} more`} (overlapping 95% CIs).`
      : '.';
  } else if (tied.length > 0) {
    standing = N === 1
      ? `Tied with the leader in its one benchmarked language, ${one} (overlapping 95% CIs).`
      : `Never first, but tied with the leader in ${tied.length} of ${N} languages (overlapping 95% CIs).`;
  } else {
    standing = N === 1
      ? `Behind the leader's 95% CI in its one benchmarked language, ${one}.`
      : `Never first, and outside the leader's 95% CI in all ${N} languages.`;
  }

  let weak: string | null = null;
  if (N >= 3) {
    const losses = rows.filter(r => r.rank !== 1 && !r.tie && r.ratio != null).sort((a, b) => b.ratio! - a.ratio!);
    weak = losses.length
      ? `Weakest relative to the field in ${listNames(losses.slice(0, 3).map((r, i) =>
          `${r.name} (${r.ratio!.toFixed(1)}×${i === 0 ? " the leader's error" : ''})`))}.`
      : 'Never clearly behind the leader anywhere.';
  }

  interface Sp { short: string; x: number }
  const have: Sp[] = [];
  for (const r of MODEL_RIGS) {
    const x = speed[r.id];
    if (x != null) have.push({ short: r.short, x });
  }
  const part = (ps: Sp[]) => listNames(ps.map(p => `${p.short} (${fmtX(p.x)})`));
  const fast = have.filter(p => p.x >= 1), slow = have.filter(p => p.x < 1);
  let speedText: string;
  if (!have.length) speedText = 'No speed data on Handy hardware.';
  else if (!slow.length) speedText = `Faster than realtime on the ${part(fast)}.`;
  else if (!fast.length) speedText = `Slower than realtime on the ${part(slow)}.`;
  else speedText = `Fast enough for realtime on the ${part(fast)}, not on the ${part(slow)}.`;

  return { standing, weak, speed: speedText };
}

/** the name up to the first dash: whisper, moonshine, gigaam, parakeet … */
export const familyOf = (model: string): string => model.toLowerCase().split('-')[0];

export interface Suggestion { model: string; why: string }

/** models worth putting next to this one: family first, then the one that
    beats it most often, then the one with the closest coverage */
export function compareSuggestions(d: Derived, model: string, max = 6): Suggestion[] {
  const langsOf = (m: string) => new Set(d.cellsForModel(m).map(c => c.lang));
  const mine = langsOf(model);
  const errOf = new Map(d.cellsForModel(model).map(c => [c.lang, c.err]));
  const out: Suggestion[] = [];
  const taken = new Set<string>([model]);

  const fam = familyOf(model);
  const sibs = d.modelNames.filter(m => m !== model && familyOf(m) === fam)
    .map(m => ({ m, shared: [...langsOf(m)].filter(l => mine.has(l)).length }))
    .sort((a, b) => b.shared - a.shared || a.m.localeCompare(b.m));
  const related = sibs.filter(s => s.shared > 0).slice(0, 4);
  for (const s of related.length ? related : sibs.slice(0, 2)) {
    out.push({ model: s.m, why: 'same family' });
    taken.add(s.m);
  }

  let rival: { m: string; beats: number; shared: number; margin: number } | null = null;
  for (const m of d.modelNames) {
    if (taken.has(m)) continue;
    let shared = 0, beats = 0, logSum = 0;
    for (const c of d.cellsForModel(m)) {
      const e = errOf.get(c.lang);
      if (e == null) continue;
      shared++;
      if (c.err < e) beats++;
      logSum += Math.log(c.err / e);
    }
    if (!shared || !beats) continue;
    const margin = logSum / shared;
    if (!rival || beats > rival.beats || (beats === rival.beats && margin < rival.margin)) rival = { m, beats, shared, margin };
  }
  if (rival) {
    out.push({ model: rival.m, why: rival.shared === 1
      ? `ahead of it in ${d.langName([...mine][0])}`
      : `ahead of it in ${rival.beats} of ${rival.shared} shared languages` });
    taken.add(rival.m);
  }

  let near: { m: string; j: number; shared: number } | null = null;
  for (const m of d.modelNames) {
    if (taken.has(m)) continue;
    const theirs = langsOf(m);
    const shared = [...theirs].filter(l => mine.has(l)).length;
    const union = new Set([...theirs, ...mine]).size;
    const j = union ? shared / union : 0;
    if (shared > 0 && (!near || j > near.j)) near = { m, j, shared };
  }
  if (near) out.push({ model: near.m, why: `closest coverage, ${near.shared} ${near.shared === 1 ? 'language' : 'languages'} in common` });

  return out.slice(0, max);
}

export interface Coverage {
  /** every model in the set is benchmarked here */
  shared: string[];
  /** model -> languages only it covers within the set */
  only: Record<string, string[]>;
  /** covered by two or more, but not all (empty for a pair) */
  partial: string[];
  /** covered by none of the set */
  none: string[];
}

/** who covers what, over the given languages */
export function coverageDiff(d: Derived, names: string[], langs: string[]): Coverage {
  const cov: Coverage = { shared: [], only: {}, partial: [], none: [] };
  for (const m of names) cov.only[m] = [];
  for (const l of langs) {
    const have = names.filter(m => d.cell(m, l));
    if (have.length === names.length) cov.shared.push(l);
    else if (have.length === 1) cov.only[have[0]].push(l);
    else if (have.length === 0) cov.none.push(l);
    else cov.partial.push(l);
  }
  return cov;
}

/** card capabilities not shared by every model in the set, as "translate: a, b only" */
export function featureDiff(d: Derived, names: string[]): string[] {
  const out: string[] = [];
  const flags: [string, (m: ModelInfo) => boolean][] = [
    ['streaming', m => Boolean(m.streaming)],
    ['translate', m => Boolean(m.translate)],
    ['language detection', m => Boolean(m.lang_detect)],
  ];
  for (const [label, has] of flags) {
    const on = names.filter(m => has(d.model(m)));
    if (on.length && on.length < names.length) out.push(`${label}: ${on.join(', ')} only`);
  }
  const ts = names.map(m => d.model(m).timestamps || 'none');
  if (new Set(ts).size > 1) out.push(`timestamps: ${names.map((m, i) => `${m} ${ts[i]}`).join(', ')}`);
  return out;
}
