/* Compact shape produced from wer.db by src/lib/db.ts at build time and
   consumed by the server-rendered pages and client-side set views. */

export type Metric = 'wer' | 'cer';

export interface LangInfo {
  name: string;
  /** FLEURS scoring metric; null for card-only (unbenchmarked) codes. */
  metric: Metric | null;
  /** true when this language has Q8_0 FLEURS results. */
  tested: boolean;
}

export interface QuantInfo {
  quant: string;
  size_gb: number | null;
  filename: string | null;
}

/** rig -> backend -> × realtime */
export type PerfMap = Record<string, Record<string, number>>;

export interface ModelInfo {
  license: string | null;
  streaming: boolean | null;
  translate: boolean | null;
  lang_detect: boolean | null;
  timestamps: string | null;
  n_card_languages: number | null;
  /** language codes the model card claims */
  claims: string[];
  perf: PerfMap;
  quants: QuantInfo[];
}

export interface Cell {
  model: string;
  lang: string;
  quant: string;
  /** how this cell was actually scored */
  metric: Metric;
  err: number;
  lo: number | null;
  hi: number | null;
  n: number | null;
  note: string | null;
}

export interface Dataset {
  meta: Record<string, string>;
  /** Raw model-card code -> benchmark language identity. */
  languageAliases: Record<string, string>;
  languages: Record<string, LangInfo>;
  models: Record<string, ModelInfo>;
  cells: Cell[];
}
