// Every pick for every language, single and paired, on every platform, against
// the committed snapshots. A failure is not necessarily a bug: run `npm run
// snapshot` to see the changes in words, and commit the new snapshots if they
// are intended.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { catalog, languageIdentity } from "../src/index.ts";
import { pickSnapshot, type PickSnapshot } from "../scripts/picks.ts";

for (const platform of catalog.platforms) {
  test(`${platform} picks match the committed snapshot (npm run snapshot to review changes)`, () => {
    const expected: PickSnapshot = JSON.parse(
      readFileSync(new URL(`./fixtures/picks/${platform}.json`, import.meta.url), "utf8"),
    );
    const bound = catalog.forPlatform(platform);
    const actual = pickSnapshot({
      models: bound.curatedModels,
      recommendModels: bound.recommendModels,
      getPreferredRecommendationLanguages: bound.getPreferredRecommendationLanguages,
      languageIdentity,
    });
    assert.deepEqual(actual.preferredLanguages, expected.preferredLanguages);
    assert.deepEqual(actual.picks, expected.picks);
  });
}
