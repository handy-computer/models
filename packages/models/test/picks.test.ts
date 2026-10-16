// Every pick for every language, single and paired, against the committed
// snapshot. A failure is not necessarily a bug: run `npm run snapshot` to see
// the changes in words, and commit the new snapshot if they are intended.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CURATED_MODELS,
  getPreferredRecommendationLanguages,
  languageIdentity,
  recommendModels,
} from "../src/index.ts";
import { pickSnapshot } from "../scripts/picks.ts";
import expected from "./fixtures/picks.json" with { type: "json" };

test("picks match the committed snapshot (npm run snapshot to review changes)", () => {
  const actual = pickSnapshot({ models: CURATED_MODELS, recommendModels, getPreferredRecommendationLanguages, languageIdentity });
  assert.deepEqual(actual.preferredLanguages, expected.preferredLanguages);
  assert.deepEqual(actual.picks, expected.picks);
});
