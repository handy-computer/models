/* Derived indexes over a Dataset. Isomorphic: used by pages at build time and
   by the set island in the browser. */

import type { Cell, Dataset, LangInfo, ModelInfo } from './types';
import { RIGS, rigById, SCORE, PICK_RIG } from './config';

export interface LangEntry extends LangInfo {
  code: string;
}

export interface Scored {
  model: string;
  err: number;
  xrt: number;
  wait: number;
  score: number;
}

export interface Picks {
  overall: Scored | null;
  accurate: Scored | null;
  fast: Scored | null;
  /** models that could not be scored (no speed on the rig) */
  unscored: string[];
}

const EMPTY_MODEL: ModelInfo = {
  license: null, streaming: null, translate: null, lang_detect: null,
  timestamps: null, n_card_languages: null, claims: [], perf: {}, quants: [],
};

export class Derived {
  readonly D: Dataset;
  /** every quant present in cells */
  readonly quants: string[];
  /** the quant this build renders (a URL dimension later, once >1 exists) */
  readonly quant: string;
  readonly cellIndex = new Map<string, Cell>();     // model|lang|quant
  readonly claimsSet = new Map<string, Set<string>>();
  readonly testedLangs: LangEntry[];
  readonly claimedOnlyLangs: LangEntry[];
  readonly modelNames: string[];

  constructor(D: Dataset, preferredQuant = 'Q8_0') {
    this.D = D;
    this.quants = [...new Set(D.cells.map(c => c.quant))].sort();
    this.quant = this.quants.includes(preferredQuant) ? preferredQuant : (this.quants[0] ?? preferredQuant);
    for (const c of D.cells) this.cellIndex.set(`${c.model}|${c.lang}|${c.quant}`, c);
    for (const [m, info] of Object.entries(D.models)) this.claimsSet.set(m, new Set(info.claims));

    const entries = Object.entries(D.languages).map(([code, v]) => ({ code, ...v }));
    const byName = (a: LangEntry, b: LangEntry) => a.name.localeCompare(b.name);
    this.testedLangs = entries.filter(l => l.tested).sort(byName);
    this.claimedOnlyLangs = entries.filter(l => !l.tested).sort(byName);
    this.modelNames = Object.keys(D.models).sort((a, b) => a.localeCompare(b));
  }

  lang(code: string): LangInfo | undefined { return this.D.languages[code]; }
  langName(code: string): string { return this.D.languages[code]?.name ?? code; }
  model(name: string): ModelInfo { return this.D.models[name] ?? EMPTY_MODEL; }
  hasModel(name: string): boolean { return name in this.D.models; }
  claims(model: string): Set<string> { return this.claimsSet.get(model) ?? new Set(); }

  cell(model: string, lang: string): Cell | undefined {
    return this.cellIndex.get(`${model}|${lang}|${this.quant}`);
  }
  cellsForLang(lang: string): Cell[] {
    return this.D.cells.filter(c => c.lang === lang && c.quant === this.quant);
  }
  cellsForModel(model: string): Cell[] {
    return this.D.cells.filter(c => c.model === model && c.quant === this.quant);
  }

  /** × realtime for a model on one of the RIGS ids, or null */
  perfOf(model: string, rigId: string): number | null {
    return perfLookup(this.D.models[model]?.perf, rigId);
  }

  /** GGUF size at the rendered quant, falling back to Q8_0 */
  sizeOf(model: string): number | null {
    const m = this.D.models[model];
    if (!m) return null;
    const q = m.quants.find(x => x.quant === this.quant) || m.quants.find(x => x.quant === 'Q8_0');
    return q ? q.size_gb : null;
  }

  metricLabel(lang: string): string {
    const l = this.D.languages[lang];
    return l && l.metric ? l.metric.toUpperCase() : 'err';
  }

  /** seconds a user waits after speaking for `dictationS` seconds, or null without speed data */
  waitS(model: string, rigId = PICK_RIG, dictationS = SCORE.dictationS): number | null {
    const xrt = this.perfOf(model, rigId);
    if (xrt == null || xrt <= 0) return null;
    if (this.model(model).streaming && xrt >= 1) return SCORE.streamWaitS;
    return dictationS / xrt;
  }

  /** overall / most accurate / fast picks over rows of {model, err}. In a
      language set (`multi`) a model that cannot switch languages on its own
      is not eligible as the overall pick: that tag is a recommendation, while
      the other two only state who is most accurate and who is quickest. */
  pickThree(rows: { model: string; err: number }[], opts: { multi?: boolean; rigId?: string } = {}): Picks {
    const rigId = opts.rigId ?? PICK_RIG;
    const scored: Scored[] = [];
    const unscored: string[] = [];
    for (const r of rows) {
      const xrt = this.perfOf(r.model, rigId);
      const wait = this.waitS(r.model, rigId);
      if (xrt == null || wait == null) { unscored.push(r.model); continue; }
      scored.push({ model: r.model, err: r.err, xrt, wait, score: r.err + SCORE.k * wait });
    }
    const first = (cmp: (a: Scored, b: Scored) => number, pool = scored) => [...pool].sort(cmp)[0] ?? null;
    const eligible = opts.multi ? scored.filter(s => !this.lacksLangDetect(s.model)) : scored;
    const overall = first((a, b) => a.score - b.score, eligible.length ? eligible : scored);
    const usable = scored.filter(s => s.wait <= SCORE.accurateMaxWaitS);
    const accurate = first((a, b) => a.err - b.err, usable.length ? usable : scored);
    const fast = first((a, b) => (a.err + SCORE.fastK * a.wait) - (b.err + SCORE.fastK * b.wait));
    return { overall, accurate, fast, unscored };
  }

  /** the card says no automatic language detection and the model covers more
      than one language; a single-language model has nothing to detect */
  lacksLangDetect(model: string): boolean {
    const m = this.model(model);
    if (m.lang_detect !== false) return false;
    return !(m.n_card_languages === 1 || m.claims.length === 1);
  }

  /** warning text for models without automatic language detection; null if fine/unknown */
  autoDetectNote(model: string, multi = false): string | null {
    if (!this.lacksLangDetect(model)) return null;
    const m = this.model(model);
    let s = multi
      ? 'No automatic language detection. Handy cannot switch languages automatically for this model; the language needs to be set manually.'
      : 'No automatic language detection. The language needs to be set manually in Handy.';
    if (m.translate) s += ' On auto it defaults to English and translates.';
    return s;
  }
}

/** shared with the scatter island, which only has a per-model perf map */
export function perfLookup(perf: Record<string, Record<string, number>> | undefined, rigId: string): number | null {
  const r = rigById(rigId);
  const p = perf?.[r.rig];
  return p ? (p[r.backend] ?? null) : null;
}

export { RIGS };

export type PickKey = 'overall' | 'accurate' | 'fast';

export interface PickTag {
  key: PickKey;
  label: string;
  /** tooltip; only the overall pick has one, the other labels speak for themselves */
  tip?: string;
}

/** the pick tags a model earned; the scoring is documented in the README ("Picks") */
export function pickTagsFor(picks: Picks, model: string): PickTag[] {
  const out: PickTag[] = [];
  const add = (key: PickKey, label: string, s: Scored | null, tip?: string) => {
    if (!s || s.model !== model) return;
    out.push({ key, label, tip });
  };
  add('overall', 'overall pick', picks.overall, 'the best overall blend of accuracy and speed');
  add('accurate', 'most accurate', picks.accurate);
  add('fast', 'fast pick', picks.fast);
  return out;
}
