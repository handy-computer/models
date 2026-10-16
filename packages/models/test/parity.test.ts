// Proves the method moved from Pi Voice unchanged: this package's code, fed
// Pi Voice's own data, makes exactly the picks Pi Voice's code makes.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createCatalog, languageIdentity, type CatalogData, type CatalogModel } from "../src/index.ts";
import { pickSnapshot } from "../scripts/picks.ts";
import piVoiceData from "./fixtures/pi-voice-data.json" with { type: "json" };
import piVoicePicks from "./fixtures/pi-voice-picks.json" with { type: "json" };

function piVoiceCatalog(): CatalogData {
  const model = (entry: Omit<CatalogModel, "description" | "repository" | "revision" | "previousRevisions" | "license" | "quant" | "role" | "curated" | "files"> & { capabilities: CatalogModel["capabilities"] }, role: CatalogModel["role"]): CatalogModel => ({
    ...entry,
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
  return {
    schema: 2,
    transcribeCpp: "0.4.0",
    methodology: piVoiceData.methodology,
    benchmarks: {},
    languageDetector: detector.id,
    models: [
      ...piVoiceData.models.map((entry) => model(entry, "asr")),
      model({ id: detector.id, name: "detector", family: "", parameters: null, languages: detector.languages, capabilities: { streaming: false, translate: false, languageDetection: true } }, "langid"),
    ],
    results: piVoiceData.results,
  };
}

test("the package's code on Pi Voice's data reproduces every Pi Voice pick", () => {
  const catalog = createCatalog(piVoiceCatalog());
  const snapshot = pickSnapshot({
    models: catalog.curatedModels,
    recommendModels: catalog.recommendModels,
    getPreferredRecommendationLanguages: catalog.getPreferredRecommendationLanguages,
    languageIdentity,
  });
  assert.deepEqual(snapshot.preferredLanguages, piVoicePicks.preferredLanguages);
  assert.deepEqual(snapshot.picks, piVoicePicks.picks);
});
