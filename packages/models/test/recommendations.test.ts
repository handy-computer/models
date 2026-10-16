// Ported from Pi Voice's test/recommendations.test.ts and test/model-ratings.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accuracyGrade,
  catalog,
  compareEngineVersions,
  CURATED_MODELS,
  EXPERIMENTAL_MAX_ERROR_PERCENT,
  getPreferredRecommendationLanguages,
  languageAccuracyGrade,
  languageIdentity,
  modelsForEngine,
  modelWaitSeconds,
  recommend,
  recommendModels,
  speedMeterLevel,
} from "../src/index.ts";

const ALL_ROLES = ["accurate", "best", "fast"];
const languages = [
  ...new Set(CURATED_MODELS.flatMap((model) => model.languages.map(languageIdentity))),
];

test("every role is assigned and usable models never mix with fallback alternatives", () => {
  for (const language of languages) {
    for (const wanted of [[language], ["en", language]]) {
      const picks = recommendModels(CURATED_MODELS, wanted);
      assert.deepEqual(picks.flatMap((pick) => pick.roles).sort(), ALL_ROLES, wanted.join("+"));
      if (picks.some((pick) => pick.status === "eligible")) {
        assert.ok(picks.every((pick) => pick.status === "eligible" && !pick.overFloor));
        assert.ok(
          picks.every((pick) => pick.worstError! < catalog.methodology.maxLanguageErrorPercent),
        );
      } else {
        assert.equal(picks.length, 1, "fallbacks carry all roles");
      }
    }
  }
});

test("language aliases produce identical recommendations", () => {
  for (const [alias, canonical] of [["tl", "fil"], ["no", "nb"]] as const) {
    assert.deepEqual(
      recommendModels(CURATED_MODELS, ["en", alias]),
      recommendModels(CURATED_MODELS, ["en", canonical]),
    );
  }
});

test("fallback statuses and preferred-language visibility follow the methodology", () => {
  const preferred = new Set(getPreferredRecommendationLanguages(CURATED_MODELS));
  for (const language of languages) {
    const pick = recommendModels(CURATED_MODELS, [language])[0]!;
    if (pick.error === undefined) assert.equal(pick.status, "unbenchmarked");
    else if (pick.overFloor) {
      const lower = catalog.data.results[pick.model.id]?.accuracy[pick.worstLanguage!]?.ciLower;
      const experimental = pick.worstError! < EXPERIMENTAL_MAX_ERROR_PERCENT ||
        (lower !== undefined && lower <= EXPERIMENTAL_MAX_ERROR_PERCENT);
      assert.equal(pick.status, experimental ? "experimental" : "unsupported");
    }
    assert.equal(preferred.has(language), ["eligible", "experimental"].includes(pick.status));
  }

  const unmeasured = { ...CURATED_MODELS[0]!, id: "unmeasured" };
  assert.equal(recommendModels([unmeasured], ["en"])[0]?.status, "unbenchmarked");
  assert.deepEqual(recommendModels([], ["en"]), []);
});

test("recommend() only picks curated models the engine can load", () => {
  const published = catalog.models.filter((model) => model.role === "asr");
  for (const language of ["en", "ko", "vi", "cy"]) {
    for (const pick of recommend([language])) assert.ok(pick.model.curated, pick.model.id);
  }
  assert.ok(published.length > CURATED_MODELS.length, "the published tier is larger than the curated one");

  assert.deepEqual(recommend(["en"], { engineVersion: "0.0.1" }), [], "an engine older than every model gets no picks");
  // The curated model needing the newest engine is recommendable on that
  // engine and never on the one before it.
  const newest = [...CURATED_MODELS].sort((a, b) => compareEngineVersions(b.minEngine!, a.minEngine!))[0]!;
  const language = newest.languages[0]!;
  const inPool = (engineVersion: string) =>
    modelsForEngine(CURATED_MODELS, engineVersion).some((model) => model.id === newest.id);
  assert.ok(inPool(newest.minEngine!));
  assert.ok(recommend([language], { engineVersion: newest.minEngine! }).length > 0);
  const [major, minor, patch] = newest.minEngine!.split(".").map(Number) as [number, number, number];
  const before = patch > 0 ? `${major}.${minor}.${patch - 1}` : minor > 0 ? `${major}.${minor - 1}.99` : `${major - 1}.99.99`;
  assert.ok(!inPool(before), `${newest.id} needs ${newest.minEngine}, not ${before}`);
});

test("accuracy letters and modifiers change at the documented proportional boundaries", () => {
  const step = Math.cbrt(2);
  const boundaries: [number, string, string][] = [
    [5 / step ** 2, "A+", "A"],
    [5 / step, "A", "A-"],
    [5, "A-", "B+"],
    [10 / step ** 2, "B+", "B"],
    [10 / step, "B", "B-"],
    [10, "B-", "C+"],
    [20 / step ** 2, "C+", "C"],
    [20 / step, "C", "C-"],
    [20, "C-", "D"],
    [30, "D", "F"],
  ];
  assert.equal(accuracyGrade(0).label, "A+");
  for (const [boundary, below, at] of boundaries) {
    assert.equal(accuracyGrade(boundary - 1e-8).label, below);
    assert.equal(accuracyGrade(boundary).label, at);
  }
  assert.equal(accuracyGrade(150).label, "F");
  assert.equal(languageAccuracyGrade({ ...CURATED_MODELS[0]!, id: "unmeasured" }, "en"), undefined);
});

test("speed bars distinguish all six measured levels and unmeasured speed", () => {
  assert.equal(speedMeterLevel(0), 5);
  for (const [index, boundary] of [1.5, 3, 5, 10, 20].entries()) {
    assert.equal(speedMeterLevel(boundary - 1e-8), 5 - index);
    assert.equal(speedMeterLevel(boundary), 4 - index);
  }
  assert.equal(speedMeterLevel(100), 0);
  assert.equal(modelWaitSeconds({ ...CURATED_MODELS[0]!, id: "unmeasured" }), undefined);
});
