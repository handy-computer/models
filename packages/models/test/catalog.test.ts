// Invariants of the generated catalog.json that apps rely on.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALL_MODELS,
  catalog,
  compareEngineVersions,
  CURATED_MODELS,
  LANGUAGE_DETECTION_MODEL,
  modelFile,
  modelsForEngine,
} from "../src/index.ts";

test("ids are unique and every result belongs to a model", () => {
  const ids = new Set(ALL_MODELS.map((model) => model.id));
  assert.equal(ids.size, ALL_MODELS.length);
  for (const id of Object.keys(catalog.data.results)) assert.ok(ids.has(id), `stale result ${id}`);
});

test("every download is pinned and hashed, and the default file is one of them", () => {
  for (const model of ALL_MODELS) {
    assert.match(model.revision, /^[0-9a-f]{40}$/, model.id);
    assert.match(model.repository, /^handy-computer\/.+-gguf$/, model.id);
    assert.equal(modelFile(model), model.files[model.quant], model.id);
    for (const file of Object.values(model.files)) {
      assert.match(file.sha256, /^[0-9a-f]{64}$/, `${model.id} ${file.filename}`);
      assert.ok(file.size > 0);
    }
  }
});

test("Multitalker downloads use root paths without changing model bytes or engine requirements", () => {
  const model = catalog.getModel("multitalker-parakeet-streaming-0.6b-v1")!;
  assert.equal(model.revision, "d9ed2931bc10058f79809bd88139a27c2ef09a53");
  assert.ok(model.previousRevisions.includes("a9a7208d8f205b5816770a6f7fb83afc81a7691b"));
  assert.equal(model.minEngine, "0.2.4");
  const hashes = {
    F32: "1ae09d63777dc4ae061f1f92b8aa0f7336f51bd995860946cc1f120b7e010f16",
    F16: "18116241c595891bccf44cd0207cd749e9ba9e6025ee73ab59606633ec730304",
    Q8_0: "cf83cedc6777d2528a4d2a8a4bf476174ef7e5c65b86bc6c955f4cc9f5951ac5",
    Q6_K: "d8db95ba257e370d910f42e8197dfc65fb5b879e09e4b13aefaac06af3555fa1",
    Q5_K_M: "38c98bc0715ee95b4271952630661050a8c3c37f64b8b178c62b8b699668cbdb",
    Q4_K_M: "d24307ac22e9e691c146a7e2339891638a44a8492a765e4b6c11cff8960cd998",
  };
  assert.equal(Object.keys(model.files).length, 6);
  for (const [quant, sha256] of Object.entries(hashes)) {
    assert.equal(model.files[quant]?.filename, `${model.id}-${quant}.gguf`);
    assert.equal(model.files[quant]?.sha256, sha256);
  }
});

test("previous revisions are distinct commits other than the current one", () => {
  for (const model of ALL_MODELS) {
    for (const revision of model.previousRevisions) assert.match(revision, /^[0-9a-f]{40}$/, model.id);
    const all = [model.revision, ...model.previousRevisions];
    assert.equal(new Set(all).size, all.length, model.id);
  }
});

test("curated models are transcription models with copy, the benchmarked quant, and results", () => {
  assert.ok(CURATED_MODELS.length > 0);
  for (const model of CURATED_MODELS) {
    assert.equal(model.role, "asr");
    assert.ok(model.description, `${model.id} has no description`);
    assert.equal(model.quant, "Q8_0", model.id);
    assert.ok(catalog.data.results[model.id], `${model.id} has no benchmark results`);
  }
  assert.ok(ALL_MODELS.some((model) => !model.curated && model.role === "asr"), "uncurated models stay published");
});

test("the language detector is a published langid model", () => {
  assert.equal(LANGUAGE_DETECTION_MODEL.role, "langid");
  assert.ok(LANGUAGE_DETECTION_MODEL.languages.length > 100);
  assert.equal(LANGUAGE_DETECTION_MODEL.quant, "F16");
  assert.ok(LANGUAGE_DETECTION_MODEL.files.Q8_0, "earlier default stays published");
});

test("engine filtering keeps models whose minimum engine is not newer", () => {
  assert.equal(compareEngineVersions("0.4.0", "v0.4.0"), 0);
  assert.ok(compareEngineVersions("0.10.0", "0.9.9") > 0);
  for (const model of ALL_MODELS) {
    assert.ok(model.minEngine, model.id);
    assert.ok(compareEngineVersions(model.minEngine, catalog.transcribeCpp) <= 0, model.id);
  }
  assert.equal(modelsForEngine(ALL_MODELS, catalog.transcribeCpp).length, ALL_MODELS.length);
  const older = modelsForEngine(ALL_MODELS, "0.3.1");
  assert.ok(older.length < ALL_MODELS.length);
  assert.ok(!older.some((model) => model.id === "parakeet-ultra"), "parakeet-ultra first shipped in 0.4.0");
  // Listed since 0.2.4, but re-converted with an engine change in 0.3.0.
  assert.equal(ALL_MODELS.find((model) => model.id === "canary-180m-flash")?.minEngine, "0.3.0");
});
