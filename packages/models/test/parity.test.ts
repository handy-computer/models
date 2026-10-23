// Proves the method moved from Pi Voice unchanged: this package's code, fed
// Pi Voice's own data as the "other" platform (its rigs were the 4750U's),
// makes exactly the picks Pi Voice's code makes.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createCatalog, languageIdentity, type CatalogData, type CatalogModel } from "../src/index.ts";
import { pickSnapshot } from "../scripts/picks.ts";
import piVoiceData from "./fixtures/pi-voice-data.json" with { type: "json" };
import piVoicePicks from "./fixtures/pi-voice-picks.json" with { type: "json" };

function piVoiceCatalog(): CatalogData {
  const model = (entry: Omit<CatalogModel, "description" | "repository" | "revision" | "previousRevisions" | "license" | "quant" | "role" | "curated" | "files" | "capabilities"> & { capabilities: Omit<CatalogModel["capabilities"], "timestamps"> }, role: CatalogModel["role"]): CatalogModel => ({
    ...entry,
    // Pi Voice's data predates the timestamps capability.
    capabilities: { ...entry.capabilities, timestamps: false },
    description: "",
    repository: "",
    revision: "",
    previousRevisions: [],
    license: "",
    quant: "Q8_0",
    role,
    curated: role === "asr",
    files: {},
  });
  const detector = piVoiceData.languageDetector;
  const { fastCpuMaxWaitSeconds, ...methodology } = piVoiceData.methodology;
  const rig = { machine: "", backend: "" };
  return {
    schema: 3,
    transcribeCpp: "0.4.0",
    methodology: { ...methodology, fastMaxWaitSeconds: fastCpuMaxWaitSeconds },
    benchmarks: {
      quant: "Q8_0",
      accuracy: { dataset: "fleurs", split: "test" },
      platforms: { other: { accelerated: rig, cpu: rig }, "apple-silicon": { accelerated: rig } },
    },
    languageDetector: detector.id,
    models: [
      ...piVoiceData.models.map((entry) => model(entry, "asr")),
      model({ id: detector.id, name: "detector", family: "", parameters: null, languages: detector.languages, capabilities: { streaming: false, translate: false, languageDetection: true } }, "langid"),
    ],
    results: Object.fromEntries(
      Object.entries(piVoiceData.results).map(([id, { accuracy, performance }]) => [id, { accuracy, performance: { other: performance } }]),
    ),
  };
}

test("the package's code on Pi Voice's data reproduces every Pi Voice pick", () => {
  const catalog = createCatalog(piVoiceCatalog()).forPlatform("other");
  const snapshot = pickSnapshot({
    models: catalog.curatedModels,
    recommendModels: catalog.recommendModels,
    getPreferredRecommendationLanguages: catalog.getPreferredRecommendationLanguages,
    languageIdentity,
  });
  assert.deepEqual(snapshot.preferredLanguages, piVoicePicks.preferredLanguages);
  assert.deepEqual(snapshot.picks, piVoicePicks.picks);
});
