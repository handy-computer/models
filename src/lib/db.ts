/* Build-time access to wer.db. Server only (node:sqlite); never import from
   a client script. This adapter is the only place the normalized database
   schema is translated into the compact Dataset consumed by the site. */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { Cell, Dataset, LangInfo, Metric, ModelInfo, PerfMap, QuantInfo } from './types';

/** Override with MODELS_DB=/path/to/other.db */
export const DB_PATH = process.env.MODELS_DB ?? path.resolve(process.cwd(), 'wer.db');

type Row = Record<string, string | number | null>;

let cached: Dataset | null = null;

export function loadData(): Dataset {
  if (cached) return cached;
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    cached = read(db);
  } finally {
    db.close();
  }
  return cached;
}

function read(db: DatabaseSync): Dataset {
  const rows = (sql: string): Row[] => db.prepare(sql).all() as Row[];
  const str = (v: string | number | null | undefined): string | null => v == null ? null : String(v);
  const num = (v: string | number | null | undefined): number | null => v == null ? null : Number(v);

  const meta: Record<string, string> = {};
  for (const r of rows('SELECT key, value FROM meta')) meta[String(r.key)] = String(r.value ?? '');

  // All claimed language codes have canonical rows. A language is tested on
  // this site when the DB has at least one Q8_0 FLEURS result for it.
  const languages: Record<string, LangInfo> = {};
  for (const r of rows(`
    SELECT l.lang, l.name,
           (SELECT r.metric
              FROM datasets d JOIN results r ON r.dataset = d.dataset
             WHERE d.lang = l.lang AND d.source = 'fleurs' AND r.quant = 'Q8_0'
             LIMIT 1) AS metric
      FROM languages l
     ORDER BY l.lang
  `)) {
    const metric = str(r.metric) as Metric | null;
    languages[String(r.lang)] = {
      name: String(r.name),
      metric,
      tested: metric !== null,
    };
  }

  const claims: Record<string, string[]> = {};
  for (const r of rows('SELECT model, lang FROM model_languages ORDER BY model, lang')) {
    (claims[String(r.model)] ??= []).push(String(r.lang));
  }

  // The UI currently renders Q8_0. Average the per-sample measurements to
  // preserve the single speed number the site presents for each backend.
  const perf: Record<string, PerfMap> = {};
  for (const r of rows(`
    SELECT model, rig, backend, avg(xrt) AS xrt
      FROM perf
     WHERE quant = 'Q8_0'
     GROUP BY model, rig, backend
  `)) {
    ((perf[String(r.model)] ??= {})[String(r.rig)] ??= {})[String(r.backend)] = Number(r.xrt);
  }

  const quants: Record<string, QuantInfo[]> = {};
  for (const r of rows('SELECT model, quant, filename, size_gb FROM quants ORDER BY model, size_gb DESC')) {
    (quants[String(r.model)] ??= []).push({
      quant: String(r.quant), size_gb: num(r.size_gb), filename: str(r.filename),
    });
  }

  const models: Record<string, ModelInfo> = {};
  for (const r of rows('SELECT * FROM models ORDER BY model')) {
    const m = String(r.model);
    models[m] = {
      license: str(r.license_display) || str(r.license),
      streaming: Boolean(r.streaming),
      translate: Boolean(r.translate),
      lang_detect: Boolean(r.lang_detect),
      timestamps: str(r.timestamps),
      n_card_languages: claims[m]?.length ?? 0,
      claims: claims[m] ?? [],
      perf: perf[m] ?? {},
      quants: quants[m] ?? [],
    };
  }
  // Keep the site resilient if an externally produced DB has an orphan result.
  for (const r of rows('SELECT DISTINCT model FROM results')) {
    const m = String(r.model);
    if (!(m in models)) {
      console.warn(`[db] ${m} has results but no models row`);
      models[m] = {
        license: null, streaming: null, translate: null, lang_detect: null,
        timestamps: null, n_card_languages: null,
        claims: claims[m] ?? [], perf: perf[m] ?? {}, quants: quants[m] ?? [],
      };
    }
  }

  const cells: Cell[] = rows(`
    SELECT r.*, d.lang
      FROM results r JOIN datasets d ON d.dataset = r.dataset
     WHERE d.source = 'fleurs'
  `).map(r => ({
    model: String(r.model), lang: String(r.lang), quant: String(r.quant),
    metric: String(r.metric) as Metric, err: Number(r.err_pct),
    lo: num(r.ci_lo), hi: num(r.ci_hi), n: num(r.n_utts), note: str(r.note) || null,
  }));

  return { meta, languages, models, cells };
}

import { Derived } from './derive';
let derived: Derived | null = null;
/** Cached Derived over loadData(); pages should use this. */
export function loadDerived(): Derived {
  return (derived ??= new Derived(loadData()));
}
