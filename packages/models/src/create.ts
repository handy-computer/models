import { modelsForEngine } from "./catalog.ts";
import * as detection from "./language-detection.ts";
import * as method from "./recommendations.ts";
import type { CatalogData, CatalogModel, MachineTier, Platform } from "./types.ts";

export type Catalog = ReturnType<typeof createCatalog>;
export type PlatformCatalog = ReturnType<Catalog["forPlatform"]>;

/**
 * Bind the recommendation method to one catalog. The package's top-level
 * exports are this, bound to the bundled catalog.json; call it yourself to use
 * other data (a newer catalog fetched at runtime, or a test fixture).
 *
 * Everything here holds on every platform. Anything that depends on speed
 * (picks, benchmarks, waits) comes from `forPlatform(platform)`.
 */
export function createCatalog(data: CatalogData) {
  if (data.schema !== 3) throw new Error(`Unsupported catalog schema ${String(data.schema)}`);
  const byId = new Map(data.models.map((model) => [model.id, model]));
  const languageDetectionModel = byId.get(data.languageDetector);
  if (!languageDetectionModel) throw new Error(`Catalog has no language detector ${data.languageDetector}`);
  const context: method.CatalogContext = {
    methodology: data.methodology,
    results: data.results,
    detectorCodes: detection.detectorCodes(languageDetectionModel),
  };
  const curatedModels = data.models.filter((model) => model.curated && model.role === "asr");
  const platforms = Object.keys(data.benchmarks.platforms) as Platform[];

  /** The speed-dependent half of the catalog, judged on one platform's reference machine. */
  function bindPlatform(platform: Platform) {
    const tiers = data.benchmarks.platforms[platform];
    if (!tiers) throw new Error(`Catalog has no benchmarks for platform ${platform}; it has ${platforms.join(", ")}`);
    const bound: method.RecommendationContext = {
      ...context,
      platform,
      fastTier: tiers.cpu ? "cpu" : "accelerated",
    };
    return {
      ...base,
      platform,
      /**
       * Best, Fast and Accurate for these languages, from the curated models
       * this engine can load. The robust default: use this unless you need to
       * recommend from a different pool.
       */
      recommend: (languages: readonly string[], options: { engineVersion?: string } = {}) =>
        method.recommendModels(
          bound,
          options.engineVersion ? modelsForEngine(curatedModels, options.engineVersion) : curatedModels,
          languages,
        ),
      recommendModels: (models: readonly CatalogModel[], languages: readonly string[]) =>
        method.recommendModels(bound, models, languages),
      benchmarkModels: (models: readonly CatalogModel[], languages: readonly string[]) =>
        method.benchmarkModels(bound, models, languages),
      getPreferredRecommendationLanguages: (models: readonly CatalogModel[] = curatedModels) =>
        method.getPreferredRecommendationLanguages(bound, models),
      modelWaitSeconds: (model: CatalogModel, tier?: MachineTier) =>
        method.modelWaitSeconds(bound, model, tier),
    };
  }
  const bound = new Map<Platform, ReturnType<typeof bindPlatform>>();

  const base = {
    data,
    /** The transcribe.cpp release this catalog was built from. */
    transcribeCpp: data.transcribeCpp,
    methodology: data.methodology,
    /** The platforms this catalog has speeds for. */
    platforms,
    /** Every published model, curated or not, of every role. */
    models: data.models,
    /** Shown by default and the only models ever recommended. */
    curatedModels,
    /** The shared spoken-language detector. */
    languageDetectionModel,
    getModel: (id: string): CatalogModel | undefined => byId.get(id),

    languageAccuracyGrade: (model: CatalogModel, language: string) =>
      method.languageAccuracyGrade(context, model, language),
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

  return {
    ...base,
    /**
     * The picks, benchmarks and waits for the platform the app runs on. The
     * app says which: "apple-silicon" on an arm64 Mac (check the hardware, not
     * the process, which reports x64 under Rosetta), "other" anywhere else.
     */
    forPlatform: (platform: Platform) => {
      let entry = bound.get(platform);
      if (!entry) bound.set(platform, (entry = bindPlatform(platform)));
      return entry;
    },
  };
}
