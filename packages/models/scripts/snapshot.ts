// Rewrite test/fixtures/picks.json from the current code and catalog.json,
// and print every pick that changed. `npm run snapshot` after a catalog or
// method change; the printed diff is the review.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CURATED_MODELS, getPreferredRecommendationLanguages, languageIdentity, recommendModels } from "../src/index.ts";
import { describeChanges, type PickSnapshot, pickSnapshot } from "./picks.ts";

const path = new URL("../test/fixtures/picks.json", import.meta.url);
const next = pickSnapshot({ models: CURATED_MODELS, recommendModels, getPreferredRecommendationLanguages, languageIdentity });
const previous: PickSnapshot | undefined = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;

if (previous) {
  const changes = describeChanges(previous, next);
  console.log(changes.length ? changes.join("\n") : "No picks changed.");
}
writeFileSync(path, `${JSON.stringify(next, null, 1)}\n`);
