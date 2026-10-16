// Invariants of the generated catalog.json that apps rely on.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALL_MODELS,
  catalog,
  compareEngineVersions,
  CURATED_MODELS,
  LANGUAGE_DETECTION_MODEL,
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
    assert.ok(model.files[model.quant], model.id);
    for (const file of Object.values(model.files)) {
      assert.match(file.sha256, /^[0-9a-f]{64}$/, `${model.id} ${file.filename}`);
      assert.ok(file.size > 0);
    }
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
