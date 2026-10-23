// Rewrite test/fixtures/picks/<platform>.json from the current code and
// catalog.json, and print every pick that changed. `npm run snapshot` after a
// catalog or method change; the printed diff is the review.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { catalog, languageIdentity } from "../src/index.ts";
import { describeChanges, type PickSnapshot, pickSnapshot } from "./picks.ts";

mkdirSync(new URL("../test/fixtures/picks/", import.meta.url), { recursive: true });
for (const platform of catalog.platforms) {
  const path = new URL(`../test/fixtures/picks/${platform}.json`, import.meta.url);
  const bound = catalog.forPlatform(platform);
  const next = pickSnapshot({
    models: bound.curatedModels,
    recommendModels: bound.recommendModels,
    getPreferredRecommendationLanguages: bound.getPreferredRecommendationLanguages,
    languageIdentity,
  });
  const previous: PickSnapshot | undefined = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  if (previous) {
    const changes = describeChanges(previous, next);
    console.log(`${platform}: ${changes.length ? `\n${changes.join("\n")}` : "no picks changed."}`);
  } else {
    console.log(`${platform}: new snapshot, ${Object.keys(next.picks).length} language sets.`);
  }
  writeFileSync(path, `${JSON.stringify(next, null, 1)}\n`);
}
