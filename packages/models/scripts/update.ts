// The daily update. Moves curation.yaml to the newest transcribe.cpp release,
// refreshes pins, regenerates catalog.json and the picks snapshot, bumps the
// patch version, and writes a plain-words summary for the PR it goes out in.
// Every change is a PR; the summary leads with what needs a closer look:
//
//   needs review       any pick changes, or a curated model's (or the language
//                      detector's) download, licence, languages, capabilities
//                      or minimum engine changes, or a curated model disappears
//   needs a name       published models missing from `names` in curation.yaml
//   not yet public     models left out because their Hugging Face repo is private
//
//   node scripts/update.ts [--transcribe-cpp <path>] [--summary <file>] [--candidates <file>]
//
// --candidates writes a JSON list of new models that would be picked if
// curated ({ id, title, body }), so CI can open one issue per candidate.
// Writes changed/review/title to $GITHUB_OUTPUT when set. Does not commit.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { createCatalog } from "../src/create.ts";
import { compareEngineVersions } from "../src/catalog.ts";
import { languageIdentity } from "../src/languages.ts";
import type { CatalogData, CatalogModel } from "../src/types.ts";
import { describeChanges, type PickSnapshot, pickSnapshot } from "./picks.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const transcribeCpp = resolve(
  option("--transcribe-cpp") ?? process.env.TRANSCRIBE_CPP ?? resolve(root, "../../../transcribe.cpp"),
);
const summaryPath = option("--summary");
const candidatesPath = option("--candidates");
const file = (name: string) => resolve(root, name);
const read = (name: string) => readFileSync(file(name), "utf8");
const run = (command: string, commandArgs: string[], cwd = root) =>
  execFileSync(command, commandArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

// ─── before ────────────────────────────────────────────────────────────────

const tracked = ["curation.yaml", "pins.json", "catalog.json", "test/fixtures/picks.json"];
const before = Object.fromEntries(tracked.map((name) => [name, read(name)]));
const oldCatalog: CatalogData = JSON.parse(before["catalog.json"]!);
const oldPicks: PickSnapshot = JSON.parse(before["test/fixtures/picks.json"]!);

// ─── move to the newest release ────────────────────────────────────────────

const releases = run("git", ["-C", transcribeCpp, "tag", "--list", "v*"])
  .split("\n")
  .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
  .sort(compareEngineVersions);
const latest = releases.at(-1);
const curationText = before["curation.yaml"]!;
const current = /^transcribeCpp:\s*(v\S+)/m.exec(curationText)?.[1];
if (!latest || !current) throw new Error("could not read the transcribe.cpp release tags or curation.yaml");
if (compareEngineVersions(latest, current) > 0) {
  writeFileSync(file("curation.yaml"), curationText.replace(/^transcribeCpp:\s*v\S+/m, `transcribeCpp: ${latest}`));
}

// Pins only move for files that changed; then rebuild everything from them.
// The bot's own pushes skip the check job, so guard the pin history here.
const basePins = join(mkdtempSync(join(tmpdir(), "models-")), "pins.json");
writeFileSync(basePins, before["pins.json"]!);
run("node", ["scripts/generate.mjs", "--update-pins", "--transcribe-cpp", transcribeCpp, "--pins-base", basePins]);

const newCatalog: CatalogData = JSON.parse(read("catalog.json"));
const catalog = createCatalog(newCatalog);
const snapshotOf = (bound: ReturnType<typeof createCatalog>) =>
  pickSnapshot({
    models: bound.curatedModels,
    recommendModels: bound.recommendModels,
    getPreferredRecommendationLanguages: bound.getPreferredRecommendationLanguages,
    languageIdentity,
  });
const newPicks = snapshotOf(catalog);
writeFileSync(file("test/fixtures/picks.json"), `${JSON.stringify(newPicks, null, 1)}\n`);

const changedFiles = tracked.filter((name) => read(name) !== before[name]);
if (changedFiles.length === 0) {
  output({ changed: "false", review: "false", title: "" });
  if (candidatesPath) writeFileSync(candidatesPath, "[]\n");
  console.log("Nothing changed.");
  process.exit(0);
}

// ─── classify ──────────────────────────────────────────────────────────────

const pickChanges = describeChanges(oldPicks, newPicks);
const oldById = new Map(oldCatalog.models.map((model) => [model.id, model]));
const newById = new Map(newCatalog.models.map((model) => [model.id, model]));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// The language detector isn't curated, but every app downloads it.
const reviewedIds = new Set([
  ...[...oldCatalog.models, ...newCatalog.models].filter((m) => m.curated).map((m) => m.id),
  oldCatalog.languageDetector,
  newCatalog.languageDetector,
]);
const curatedChanges: string[] = [];
for (const id of reviewedIds) {
  const [was, now] = [oldById.get(id), newById.get(id)];
  if (!now) {
    curatedChanges.push(`${id}: no longer published by transcribe.cpp`);
    continue;
  }
  if (!was) continue;
  const fields: string[] = [];
  if (was.revision !== now.revision || !same(was.files, now.files)) {
    fields.push(`download (revision ${was.revision.slice(0, 7)} → ${now.revision.slice(0, 7)})`);
  }
  if (was.license !== now.license) fields.push(`licence ${was.license} → ${now.license}`);
  if (!same(was.languages, now.languages)) fields.push(`languages (${was.languages.length} → ${now.languages.length})`);
  if (!same(was.capabilities, now.capabilities)) fields.push("capabilities");
  if (was.minEngine !== now.minEngine) fields.push(`minimum engine ${was.minEngine} → ${now.minEngine}`);
  if (fields.length) curatedChanges.push(`${id}: ${fields.join(", ")}`);
}
const review = pickChanges.length > 0 || curatedChanges.length > 0;

const added = newCatalog.models.filter((model) => !oldById.has(model.id));
const removed = oldCatalog.models.filter((model) => !newById.has(model.id) && !model.curated);
const curatedResultChanges = newCatalog.models.filter(
  (model) => model.curated && oldById.has(model.id) && !same(oldCatalog.results[model.id], newCatalog.results[model.id]),
);
const otherChanged = newCatalog.models.filter((model) => {
  const was = oldById.get(model.id);
  return was && !model.curated && (!same(was, model) || !same(oldCatalog.results[model.id], newCatalog.results[model.id]));
});

// How often each new model would be picked if it were curated: the case for
// promoting it, so curating is a one-line decision.
function wouldBePicked(model: CatalogModel): string[] {
  if (model.role !== "asr" || !newCatalog.results[model.id]) return [];
  const promoted = createCatalog({
    ...newCatalog,
    models: newCatalog.models.map((entry) => (entry.id === model.id ? { ...entry, curated: true } : entry)),
  });
  const picks = snapshotOf(promoted).picks;
  return Object.keys(picks).filter((key) => picks[key]!.split(" ").includes(model.id));
}

// ─── version and summary ───────────────────────────────────────────────────

run("npm", ["version", "patch", "--no-git-tag-version"]);
const version = JSON.parse(read("package.json")).version as string;

const engineMoved = oldCatalog.transcribeCpp !== newCatalog.transcribeCpp;
const title = engineMoved
  ? `models: transcribe.cpp ${newCatalog.transcribeCpp} (${version})`
  : `models: catalog update (${version})`;

const cap = (lines: string[], limit: number) =>
  lines.length > limit ? [...lines.slice(0, limit), `…and ${lines.length - limit} more`] : lines;
const lines: string[] = [`## ${title}`, ""];
if (engineMoved) lines.push(`transcribe.cpp ${oldCatalog.transcribeCpp} → ${newCatalog.transcribeCpp}.`, "");
if (review) {
  lines.push("### Needs review", "");
  if (pickChanges.length) lines.push(`- ${pickChanges.length} pick${pickChanges.length === 1 ? "" : "s"} changed (below)`);
  for (const change of curatedChanges) lines.push(`- ${change}`);
  lines.push("");
}
if (pickChanges.length) lines.push("### Pick changes", "", "```", ...cap(pickChanges, 150), "```", "");
const candidates: { id: string; title: string; body: string }[] = [];
if (added.length) {
  lines.push("### New published models", "", "Searchable in apps, never recommended until added to `curation.yaml`.", "");
  for (const model of added) {
    const picked = wouldBePicked(model);
    if (picked.length) {
      candidates.push({
        id: model.id,
        title: `Curation candidate: ${model.id}`,
        body: [
          `transcribe.cpp ${newCatalog.transcribeCpp} published \`${model.id}\` (${model.parameters ?? "?"} parameters, needs transcribe.cpp ${model.minEngine}).`,
          "",
          `If curated, it would be picked for **${picked.length} language set${picked.length === 1 ? "" : "s"}**:`,
          "",
          picked.join(", "),
          "",
          "To curate it, add it to `packages/models/curation.yaml`, then run `npm run generate && npm run snapshot` and review the pick changes:",
          "",
          "```yaml",
          `  ${model.id}:`,
          `    name: ${model.name}`,
          "    description: ",
          "```",
          "",
          "Close this issue to leave it searchable but never recommended.",
        ].join("\n"),
      });
    }
    const note = picked.length
      ? ` — **would be picked for ${picked.length} language set${picked.length === 1 ? "" : "s"} if curated** (${cap(picked, 8).join(", ")})`
      : model.role === "asr" ? "" : ` (${model.role})`;
    lines.push(`- \`${model.id}\`, needs transcribe.cpp ${model.minEngine}${note}`);
  }
  lines.push("");
}
const names: Record<string, string> = parseYaml(read("curation.yaml")).names ?? {};
const unnamed = newCatalog.models.filter((model) => !(model.id in names));
if (unnamed.length) {
  lines.push("### Needs a name", "", "These use a name tidied from the id. Add them to `names` in `curation.yaml`:", "");
  lines.push("```yaml", ...unnamed.map((model) => `  ${model.id}: ${model.name}`), "```", "");
}
const pins: Record<string, { private?: boolean }> = JSON.parse(read("pins.json"));
const notPublic = Object.keys(pins).filter((id) => pins[id]!.private);
if (notPublic.length) {
  lines.push("### Not yet public", "", `Left out until their Hugging Face repo is public: ${notPublic.join(", ")}.`, "");
}
const other: string[] = [];
if (curatedResultChanges.length) {
  const effect = pickChanges.length ? "" : " without changing a pick";
  other.push(`benchmark numbers changed for ${curatedResultChanges.length} curated model(s)${effect}: ${curatedResultChanges.map((m) => m.id).join(", ")}`);
}
if (otherChanged.length) other.push(`${otherChanged.length} uncurated model(s) changed: ${cap(otherChanged.map((m) => m.id), 10).join(", ")}`);
if (removed.length) other.push(`no longer published: ${removed.map((m) => m.id).join(", ")}`);
if (other.length) lines.push("### Other changes", "", ...other.map((line) => `- ${line}`), "");
lines.push(`Package version ${version}. Files: ${changedFiles.join(", ")}.`);
const summary = `${lines.join("\n")}\n`;

if (summaryPath) writeFileSync(summaryPath, summary);
if (candidatesPath) writeFileSync(candidatesPath, `${JSON.stringify(candidates, null, 2)}\n`);
console.log(summary);
output({ changed: "true", review: String(review), title });

function output(values: Record<string, string>) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
}
