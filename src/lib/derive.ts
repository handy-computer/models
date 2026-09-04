/* Derived indexes over a Dataset. Isomorphic: used by pages at build time and
   by the set island in the browser. */

import type { Cell, Dataset, LangInfo, ModelInfo } from './types';
import { RIGS, rigById } from './config';

export interface LangEntry extends LangInfo {
  code: string;
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

  canonicalLanguage(code: string): string {
    let current = code.trim().toLowerCase().split('-', 1)[0] || code.trim().toLowerCase();
    const seen = new Set<string>();
    while (this.D.languageAliases[current] && !seen.has(current)) {
      seen.add(current);
      current = this.D.languageAliases[current]!;
    }
    return current;
  }

  lang(code: string): LangInfo | undefined { return this.D.languages[this.canonicalLanguage(code)]; }
  langName(code: string): string { return this.lang(code)?.name ?? code; }
  model(name: string): ModelInfo { return this.D.models[name] ?? EMPTY_MODEL; }
  hasModel(name: string): boolean { return name in this.D.models; }
  claims(model: string): Set<string> { return this.claimsSet.get(model) ?? new Set(); }
  claimsLanguage(model: string, language: string): boolean {
    const wanted = this.canonicalLanguage(language);
    return [...this.claims(model)].some(code => this.canonicalLanguage(code) === wanted);
  }

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
