/* The recommendation policy ported from pi-transcribe. Keep product rules
   here so the website can visualize and tune them before they are copied back.

   A "wait" is processing time after a 30-second dictation on the Ryzen 4750U.
   Overall and Accurate use Vulkan; Fast uses CPU. Accuracy across a language
   set is its geometric mean, while quality gates use the worst language. */

import type { Cell } from './types';
import type { Derived } from './derive';

export const RECOMMENDATION = {
  gpuRigId: 'r-gpu',
  cpuRigId: 'r-cpu',
  dictationS: 30,
  freeWaitS: 3,
  waitWeight: 0.5,
  maxError: 20,
  experimentalMaxError: 30,
  overallMaxWaitS: 5,
  fastMaxWaitS: 4,
  accurateMaxWaitS: 10,
} as const;

/** Benchmarked here, but absent from pi-transcribe's current curated catalog. */
export const RECOMMENDATION_EXCLUDED_MODELS = new Set([
  'MOSS-Transcribe-Diarize',
  'parakeet-primeline',
]);

export type RecommendationStatus = 'supported' | 'experimental' | 'unsupported' | 'unbenchmarked';
export type RecommendationReason = 'recommended' | 'experimental-error' | 'error-too-high' | 'no-benchmark-data';

export interface RecommendedModel {
  model: string;
  /** Geometric mean error over all selected languages. */
  err: number;
  /** Highest error on any selected language. */
  worstErr: number;
  worstLanguage: string;
  worstCiLower: number | null;
  gpuXrt: number;
  gpuWait: number;
  cpuXrt: number | null;
  cpuWait: number | null;
  /** Error plus the accelerated wait penalty. */
  score: number;
  cells: Cell[];
}

export interface Picks {
  overall: RecommendedModel | null;
  accurate: RecommendedModel | null;
  fast: RecommendedModel | null;
  status: RecommendationStatus;
  reason: RecommendationReason;
  /** True when a multi-language recommendation had to use manual switching. */
  manualSwitch: boolean;
  /** Complete-coverage models missing required accelerated speed data. */
  unscored: string[];
}

const empty = (reason: RecommendationReason, status: RecommendationStatus = 'unbenchmarked'): Picks => ({
  overall: null,
  accurate: null,
  fast: null,
  status,
  reason,
  manualSwitch: false,
  unscored: [],
});

function waitFor(d: Derived, model: string, rigId: string): { xrt: number | null; wait: number | null } {
  const xrt = d.perfOf(model, rigId);
  return xrt == null || xrt <= 0
    ? { xrt: null, wait: null }
    : { xrt, wait: RECOMMENDATION.dictationS / xrt };
}

function first(
  pool: RecommendedModel[],
  value: (candidate: RecommendedModel) => number,
): RecommendedModel | null {
  let best: RecommendedModel | null = null;
  for (const candidate of pool) {
    if (best == null || value(candidate) < value(best)) best = candidate;
  }
  return best;
}

/** Recommend overall, fast, and accurate models for exactly this language set. */
export function recommendModels(d: Derived, languages: string[]): Picks {
  const langs = [...new Set(languages.map(language => d.canonicalLanguage(language)))];
  if (!langs.length || langs.some(lang => !d.lang(lang)?.tested)) {
    return empty('no-benchmark-data');
  }

  const candidates: RecommendedModel[] = [];
  const unscored: string[] = [];
  for (const model of d.modelNames) {
    if (RECOMMENDATION_EXCLUDED_MODELS.has(model)) continue;
    if (!langs.every(lang => d.claimsLanguage(model, lang))) continue;
    const cells = langs.map(lang => d.cell(model, lang));
    if (cells.some(cell => cell == null)) continue;
    const complete = cells as Cell[];
    const gpu = waitFor(d, model, RECOMMENDATION.gpuRigId);
    if (gpu.xrt == null || gpu.wait == null) {
      unscored.push(model);
      continue;
    }
    const cpu = waitFor(d, model, RECOMMENDATION.cpuRigId);
    const errors = complete.map(cell => cell.err);
    const err = Math.exp(
      errors.reduce((sum, error) => sum + Math.log(Math.max(error, Number.EPSILON)), 0) /
        errors.length,
    );
    const worstErr = Math.max(...errors);
    const worstIndex = errors.indexOf(worstErr);
    const gpuWait = gpu.wait;
    candidates.push({
      model,
      err,
      worstErr,
      worstLanguage: langs[worstIndex]!,
      worstCiLower: complete[worstIndex]!.lo,
      gpuXrt: gpu.xrt,
      gpuWait,
      cpuXrt: cpu.xrt,
      cpuWait: cpu.wait,
      score:
        err +
        RECOMMENDATION.waitWeight *
          Math.max(0, gpuWait - RECOMMENDATION.freeWaitS),
      cells: complete,
    });
  }
  if (!candidates.length) {
    return { ...empty('no-benchmark-data'), unscored };
  }

  // Quality outranks latency and automatic switching. Automatic switching is
  // preferred when a model with it clears the floor; otherwise a usable
  // manual model beats an automatic model over the floor.
  const withinFloor = candidates.filter(
    candidate => candidate.worstErr < RECOMMENDATION.maxError,
  );
  const detectingWithinFloor = langs.length > 1
    ? withinFloor.filter(candidate => d.model(candidate.model).lang_detect === true)
    : withinFloor;
  const hasUsableModel = withinFloor.length > 0;
  const pool = detectingWithinFloor.length
    ? detectingWithinFloor
    : hasUsableModel
      ? withinFloor
      : candidates;
  const manualSwitch =
    hasUsableModel &&
    langs.length > 1 &&
    detectingWithinFloor.length === 0;

  if (!hasUsableModel) {
    // Primarily minimize the weakest language, with aggregate accuracy as a
    // small deterministic tie-breaker. No unusable fast/accurate alternatives
    // are produced.
    const fallback = first(
      pool,
      candidate => candidate.worstErr + candidate.err / 1000,
    )!;
    const experimental =
      fallback.worstErr < RECOMMENDATION.experimentalMaxError ||
      (fallback.worstCiLower != null &&
        fallback.worstCiLower <= RECOMMENDATION.experimentalMaxError);
    if (!experimental) {
      return {
        ...empty('error-too-high', 'unsupported'),
        unscored,
      };
    }
    return {
      overall: fallback,
      accurate: fallback,
      fast: fallback,
      status: 'experimental',
      reason: 'experimental-error',
      manualSwitch: langs.length > 1 && d.model(fallback.model).lang_detect !== true,
      unscored,
    };
  }

  const overallOnTarget = pool.filter(
    candidate => candidate.gpuWait <= RECOMMENDATION.overallMaxWaitS,
  );
  const overall = first(
    overallOnTarget.length ? overallOnTarget : pool,
    candidate => candidate.score,
  );

  const withCpuSpeed = pool.filter(
    (candidate): candidate is RecommendedModel & { cpuWait: number } =>
      candidate.cpuWait != null,
  );
  const fastOnTarget = withCpuSpeed.filter(
    candidate => candidate.cpuWait <= RECOMMENDATION.fastMaxWaitS,
  );
  const fast =
    first(fastOnTarget, candidate => candidate.err) ??
    first(withCpuSpeed, candidate => candidate.cpuWait! + candidate.err / 1000) ??
    overall;

  const accurateOnTarget = pool.filter(
    candidate => candidate.gpuWait <= RECOMMENDATION.accurateMaxWaitS,
  );
  const accurate =
    first(accurateOnTarget, candidate => candidate.err) ??
    first(pool, candidate => candidate.err) ??
    overall;

  return {
    overall,
    accurate,
    fast,
    status: 'supported',
    reason: 'recommended',
    manualSwitch,
    unscored: [
      ...unscored,
      ...pool.filter(candidate => candidate.cpuWait == null).map(candidate => candidate.model),
    ],
  };
}

export type PickKey = 'overall' | 'accurate' | 'fast';

export interface PickTag {
  key: PickKey;
  label: string;
  tip?: string;
}

export function pickTagsFor(picks: Picks, model: string): PickTag[] {
  const out: PickTag[] = [];
  const add = (key: PickKey, label: string, pick: RecommendedModel | null, tip?: string) => {
    if (pick?.model === model) out.push({ key, label, tip });
  };
  add(
    'overall',
    picks.status === 'experimental' ? 'experimental pick' : 'overall pick',
    picks.overall,
    picks.status === 'experimental'
      ? 'No model stays below 20% error; this has the lowest worst-language error.'
      : 'The best accuracy and GPU-speed balance, targeting a wait of 5 seconds or less.',
  );
  add('accurate', 'accurate pick', picks.accurate);
  add('fast', 'fast pick', picks.fast);
  return out;
}
