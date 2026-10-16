import bundled from "../catalog.json" with { type: "json" };
import { createCatalog } from "./create.ts";
import type { CatalogData } from "./types.ts";

export type * from "./types.ts";
export { createCatalog, type Catalog } from "./create.ts";
export {
  canonicalLanguage,
  languageIdentity,
  resolveModelLanguage,
} from "./languages.ts";
export {
  catalogModelSearchText,
  compareEngineVersions,
  displayLanguage,
  formatBinarySize,
  modelFile,
  modelMatchesLanguage,
  modelsForEngine,
  rankCatalogModels,
} from "./catalog.ts";
export {
  requiresLanguageDetector,
  type AutoLanguagePolicy,
  type DetectPolicy,
  type LanguageModel,
} from "./language-detection.ts";
export {
  accuracyGrade,
  BENCHMARK_DICTATION_SECONDS,
  frontierModelIds,
  SPEED_METER_STEPS,
  speedMeterLevel,
  type AccuracyGrade,
  type AccuracyLetter,
  type ModelBenchmark,
  type ModelRecommendation,
  type RecommendationRole,
  type RecommendationStatus,
} from "./recommendations.ts";

/**
 * The catalog bundled with this package version. TypeScript infers each
 * model's `files` as a different object shape, so the JSON only fits
 * CatalogData through unknown; generate.mjs and the tests vouch for it.
 */
export const catalog = createCatalog(bundled as unknown as CatalogData);

export const TRANSCRIBE_CPP_VERSION = catalog.transcribeCpp;
/** Every published model, curated or not, of every role. */
export const ALL_MODELS = catalog.models;
/** Shown by default and the only models ever recommended. */
export const CURATED_MODELS = catalog.curatedModels;
export const LANGUAGE_DETECTION_MODEL = catalog.languageDetectionModel;
export const COMFORTABLE_REAL_TIME_FACTOR = catalog.comfortableRealTimeFactor;
export const EXPERIMENTAL_MAX_ERROR_PERCENT = catalog.experimentalMaxErrorPercent;
export const {
  getModel,
  recommend,
  recommendModels,
  benchmarkModels,
  getPreferredRecommendationLanguages,
  languageAccuracyGrade,
  modelWaitSeconds,
  detectorLanguageCode,
  undetectablePreferences,
  autoLanguagePolicy,
} = catalog;
