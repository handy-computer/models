import { modelsForEngine } from "./catalog.ts";
import * as detection from "./language-detection.ts";
import * as method from "./recommendations.ts";
import type { CatalogData, CatalogModel, MachineTier } from "./types.ts";

export type Catalog = ReturnType<typeof createCatalog>;

/**
 * Bind the recommendation method to one catalog. The package's top-level
 * exports are this, bound to the bundled catalog.json; call it yourself to use
 * other data (a newer catalog fetched at runtime, or a test fixture).
 */
export function createCatalog(data: CatalogData) {
  if (data.schema !== 2) throw new Error(`Unsupported catalog schema ${String(data.schema)}`);
  const byId = new Map(data.models.map((model) => [model.id, model]));
  const languageDetectionModel = byId.get(data.languageDetector);
  if (!languageDetectionModel) throw new Error(`Catalog has no language detector ${data.languageDetector}`);
  const context: method.RecommendationContext = {
    methodology: data.methodology,
    results: data.results,
    detectorCodes: detection.detectorCodes(languageDetectionModel),
  };
  const curatedModels = data.models.filter((model) => model.curated && model.role === "asr");

  return {
    data,
    /** The transcribe.cpp release this catalog was built from. */
    transcribeCpp: data.transcribeCpp,
    methodology: data.methodology,
    /** Every published model, curated or not, of every role. */
    models: data.models,
    /** Shown by default and the only models ever recommended. */
    curatedModels,
    /** The shared spoken-language detector. */
    languageDetectionModel,
    getModel: (id: string): CatalogModel | undefined => byId.get(id),

    /**
     * Best, Fast and Accurate for these languages, from the curated models
     * this engine can load. The robust default: use this unless you need to
     * recommend from a different pool.
     */
    recommend: (languages: readonly string[], options: { engineVersion?: string } = {}) =>
      method.recommendModels(
        context,
        options.engineVersion ? modelsForEngine(curatedModels, options.engineVersion) : curatedModels,
        languages,
      ),
    recommendModels: (models: readonly CatalogModel[], languages: readonly string[]) =>
      method.recommendModels(context, models, languages),
    benchmarkModels: (models: readonly CatalogModel[], languages: readonly string[]) =>
      method.benchmarkModels(context, models, languages),
    getPreferredRecommendationLanguages: (models: readonly CatalogModel[] = curatedModels) =>
      method.getPreferredRecommendationLanguages(context, models),
    languageAccuracyGrade: (model: CatalogModel, language: string) =>
      method.languageAccuracyGrade(context, model, language),
    modelWaitSeconds: (model: CatalogModel, tier?: MachineTier) =>
      method.modelWaitSeconds(context, model, tier),
    /** Wait-time cutoff used by the overall pick, as a real-time factor. */
    comfortableRealTimeFactor: method.comfortableRealTimeFactor(data.methodology),
    experimentalMaxErrorPercent: data.methodology.experimentalMaxErrorPercent,

    detectorLanguageCode: (language: string) =>
      detection.detectorLanguageCode(context.detectorCodes, language),
    undetectablePreferences: (model: detection.LanguageModel, preferred: readonly string[]) =>
      detection.undetectablePreferences(context.detectorCodes, model, preferred),
    autoLanguagePolicy: (model: detection.LanguageModel, preferred: readonly string[]) =>
      detection.autoLanguagePolicy(context.detectorCodes, model, preferred),
  };
}
