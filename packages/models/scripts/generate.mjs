#!/usr/bin/env node
// Build catalog.json from three inputs:
//   1. transcribe.cpp's catalog/*.json at the release tag named in curation.yaml
//      (facts: languages, capabilities, licence, files, benchmarks);
//   2. curation.yaml (opinion: which models are curated, names, descriptions,
//      thresholds, the language detector);
//   3. pins.json (Hugging Face revision and per-file sha256, a lock file).
//
//   npm run generate                 offline; fails if a pin is missing or stale
//   npm run generate -- --check      exit 1 when catalog.json is out of date
//   npm run pins                     refresh pins from Hugging Face, then generate
//   npm run pins -- --prefer <catalog.json>   try an app's existing revisions first
//
// A pin only moves when the bytes change. The apps find downloads under
// snapshots/<revision>/, so a new revision with identical files would make
// every existing user download the model again.
//
// The transcribe.cpp checkout defaults to ../../../transcribe.cpp (a sibling
// of this repo); override with --transcribe-cpp <path> or TRANSCRIBE_CPP. It
// needs its release tags (git fetch --tags).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const transcribeCpp = resolve(
  option("--transcribe-cpp") ?? process.env.TRANSCRIBE_CPP ?? resolve(root, "../../../transcribe.cpp"),
);
const updatePins = flag("--update-pins");
const check = flag("--check");
const catalogPath = resolve(root, "catalog.json");
const pinsPath = resolve(root, "pins.json");

const fail = (message) => {
  console.error(`generate: ${message}`);
  process.exit(1);
};

// ─── inputs ────────────────────────────────────────────────────────────────

const curation = parseYaml(readFileSync(resolve(root, "curation.yaml"), "utf8"));
const tag = curation.transcribeCpp;
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) fail(`transcribeCpp must be a release tag like v0.4.0, got ${tag}`);

const git = (...gitArgs) =>
  execFileSync("git", ["-C", transcribeCpp, ...gitArgs], { encoding: "utf8", maxBuffer: 256 << 20 });
if (!existsSync(transcribeCpp)) fail(`no transcribe.cpp checkout at ${transcribeCpp}`);
try {
  git("rev-parse", "--verify", "--quiet", `${tag}^{commit}`);
} catch {
  fail(`${transcribeCpp} has no tag ${tag}; run git fetch --tags there`);
}

const version = (name) => name.replace(/^v/, "").split(".").map(Number);
const compareVersions = (a, b) => {
  const [x, y] = [version(a), version(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

const releases = git("tag", "--list", "v*")
  .split("\n")
  .filter((name) => /^v\d+\.\d+\.\d+$/.test(name) && compareVersions(name, tag) <= 0)
  .sort(compareVersions);

// Each release's catalog records as blob ids, keyed by stem. Listing a tree
// needs no blobs, so this is cheap even in a partial clone.
const catalogBlobs = (ref) =>
  new Map(
    git("ls-tree", ref, "catalog/")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [meta, path] = line.split("\t");
        return [path.replace(/^catalog\//, ""), meta.split(/\s+/)[2]];
      })
      .filter(([name]) => name.endsWith(".json") && !name.startsWith("_"))
      .map(([name, blob]) => [name.slice(0, -".json".length), blob]),
  );
const releaseBlobs = new Map(releases.map((release) => [release, catalogBlobs(release)]));

// In a partial clone (git clone --filter=blob:none, as CI uses) fetch every
// release's catalog files in one round trip instead of one per file.
if (git("config", "--default", "", "--get", "remote.origin.promisor").trim() === "true") {
  const blobs = [...new Set([...releaseBlobs.values()].flatMap((blobs) => [...blobs.values()]))];
  try {
    git("-c", "fetch.negotiationAlgorithm=noop", "fetch", "-q", "--no-tags", "--no-write-fetch-head",
      "--filter=blob:none", "origin", ...blobs);
  } catch {
    // Fall back to git fetching each file on demand.
  }
}

const readBlob = (blob) => JSON.parse(git("cat-file", "blob", blob));
const records = [...(releaseBlobs.get(tag) ?? [])]
  .map(([stem, blob]) => ({ stem, blob, record: readBlob(blob) }))
  .filter(({ record }) => record.published_repo);

// The oldest release, counting back from the tag without a gap, that
// publishes this model with the same files (names and sizes; release catalogs
// carry no hashes). Not the release that first listed the model: a
// re-conversion ships with the engine change it needs, so that release can be
// too old for today's files. Models predating the catalog get the first
// catalogued release, which is conservative.
const downloadsKey = (record) =>
  JSON.stringify((record.downloads ?? []).map(({ filename, size_bytes }) => [filename, size_bytes]).sort());
function minEngine(stem, blob, record) {
  const key = downloadsKey(record);
  let oldest = tag;
  for (const release of releases.filter((name) => compareVersions(name, tag) < 0).reverse()) {
    const earlier = releaseBlobs.get(release).get(stem);
    if (!earlier || (earlier !== blob && downloadsKey(readBlob(earlier)) !== key)) break;
    oldest = release;
  }
  return oldest.replace(/^v/, "");
}

// ─── helpers ───────────────────────────────────────────────────────────────

// Matches the website's claim normalisation: lowercase base subtag with the
// dataset aliases applied.
const DATASET_ALIASES = { jw: "jv", tl: "fil", no: "nb", "zh-cn": "zh" };
function datasetLanguage(code) {
  const lower = code.trim().toLowerCase();
  if (DATASET_ALIASES[lower]) return DATASET_ALIASES[lower];
  const base = lower.split("-")[0];
  return DATASET_ALIASES[base] ?? base;
}

const ACRONYMS = new Set(["asr", "ctc", "rnnt", "tdt", "nar", "mlt", "en", "lid", "vad"]);
function tidyName(id) {
  return id
    .split(/[-_]/)
    .map((word) => {
      if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase();
      if (/^\d+(\.\d+)?[mb]$/i.test(word)) return word.toUpperCase();
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function parameterLabel(params) {
  if (!params) return null;
  return params >= 1e9 ? `${(params / 1e9).toFixed(1)}B` : `${Math.round(params / 1e6)}M`;
}

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

// ─── pins ──────────────────────────────────────────────────────────────────

const pins = existsSync(pinsPath) ? JSON.parse(readFileSync(pinsPath, "utf8")) : {};
const hfHeaders = process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN.trim()}` } : {};

async function hf(path) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`https://huggingface.co/api/${path}`, { headers: hfHeaders });
    if (response.ok) return response.json();
    if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
      await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
      continue;
    }
    throw Object.assign(new Error(`${response.status} ${response.statusText} for ${path}`), { status: response.status });
  }
}

/** Files at a revision, or why they don't match what transcribe.cpp published. */
async function filesAt(repo, revision, downloads) {
  const info = await hf(`models/${repo}/revision/${revision}?blobs=true`);
  const siblings = new Map(info.siblings.map((sibling) => [sibling.rfilename, sibling]));
  const files = {};
  for (const { filename, size_bytes } of downloads) {
    const sibling = siblings.get(filename);
    const size = sibling?.lfs?.size ?? sibling?.size;
    const sha256 = sibling?.lfs?.sha256;
    if (size !== size_bytes || !/^[0-9a-f]{64}$/.test(sha256 ?? "")) {
      return { mismatch: `${filename}: hub ${size ?? "missing"} bytes, transcribe.cpp ${size_bytes}` };
    }
    files[filename] = { size, sha256 };
  }
  return { revision: info.sha, files };
}

/**
 * The newest revision whose files match the sizes the transcribe.cpp release
 * recorded. Usually main; older when a repo was re-uploaded for a later
 * engine release.
 */
async function resolvePin(repo, downloads, preferred) {
  for (const revision of preferred) {
    // A revision the hub doesn't have is just not a candidate; any other
    // failure must not quietly fall through to main.
    const candidate = await filesAt(repo, revision, downloads).catch((error) => {
      if (error.status === 404) return { mismatch: true };
      throw error;
    });
    if (!candidate.mismatch) return candidate;
  }
  const head = await filesAt(repo, "main", downloads);
  if (!head.mismatch) return head;
  const commits = await hf(`models/${repo}/commits/main`);
  for (const commit of commits.slice(1, 30)) {
    const candidate = await filesAt(repo, commit.id, downloads);
    if (!candidate.mismatch) return candidate;
  }
  throw new Error(`${repo}: no revision matches transcribe.cpp ${tag} (${head.mismatch})`);
}

function pinMatches(pin, downloads) {
  return pin && downloads.every(({ filename, size_bytes }) => pin.files[filename]?.size === size_bytes);
}

// Revisions an app already ships, from any catalog with models[].revision and
// an id (Pi Voice) or slug (Handy). Repeatable; earlier files win.
const preferredRevisions = new Map();
for (const [index, value] of args.entries()) {
  if (value !== "--prefer") continue;
  const source = JSON.parse(readFileSync(resolve(args[index + 1]), "utf8"));
  const detectorEntry = source.languageDetector?.repository
    ? [{ ...source.languageDetector, id: source.languageDetector.repository.split("/")[1].replace(/-gguf$/, "") }]
    : [];
  for (const model of [...(source.models ?? []), ...detectorEntry]) {
    const id = model.slug ?? model.id;
    if (!model.revision) continue;
    preferredRevisions.set(id, [...(preferredRevisions.get(id) ?? []), model.revision]);
  }
}

if (updatePins) {
  const queue = records.slice();
  const problems = [];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const { record } = item;
        const repo = record.published_repo;
        const id = repo.split("/")[1].replace(/-gguf$/, "");
        if (pinMatches(pins[id], record.downloads)) continue;
        try {
          const preferred = [...new Set([pins[id]?.revision, ...(preferredRevisions.get(id) ?? [])].filter(Boolean))];
          pins[id] = await resolvePin(repo, record.downloads, preferred);
          console.error(`pinned ${id} @ ${pins[id].revision.slice(0, 12)}`);
        } catch (error) {
          problems.push(error.message);
        }
      }
    }),
  );
  if (problems.length) fail(`could not pin:\n  ${problems.join("\n  ")}`);
}

// ─── models ────────────────────────────────────────────────────────────────

const curated = curation.models ?? {};
const detector = curation.languageDetector;
const quant = curation.benchmarks.quant;
const models = [];
const benchmarks = {};
const problems = [];

for (const { stem, blob, record } of records) {
  const repository = record.published_repo;
  const id = repository.split("/")[1].replace(/-gguf$/, "");
  const role = record.role ?? "asr";
  const editorial = curated[id] ?? (detector.id === id ? detector : undefined);
  const pin = pins[id];
  if (!pinMatches(pin, record.downloads)) {
    problems.push(`${id}: ${pin ? "pin is stale" : "no pin"} for transcribe.cpp ${tag}; run npm run pins`);
    continue;
  }

  const files = record.downloads.map(({ quant: fileQuant, filename, size_bytes }) => ({
    quant: fileQuant,
    filename,
    size: size_bytes,
    sha256: pin.files[filename].sha256,
  }));
  const defaultFile = files.find((file) => file.quant === quant) ?? files[0];
  if (curated[id] && defaultFile.quant !== quant) problems.push(`${id}: curated but has no ${quant} file`);

  const capabilities = record.capabilities ?? {};
  models.push({
    id,
    name: editorial?.name ?? tidyName(id),
    description: editorial?.description ?? "",
    repository,
    revision: pin.revision,
    license: record.license.spdx,
    family: record.family,
    parameters: parameterLabel(record.params),
    languages: record.languages,
    capabilities: {
      streaming: capabilities.streaming?.supported === true,
      translate: capabilities.translate?.supported === true,
      languageDetection: capabilities.lang_detect?.supported === true,
    },
    quant: defaultFile.quant,
    filename: defaultFile.filename,
    size: defaultFile.size,
    sha256: defaultFile.sha256,
    role,
    curated: Boolean(curated[id]),
    minEngine: minEngine(stem, blob, record),
    files,
  });

  // Benchmarks are taken at the default file's quant, so a grade always
  // describes the file a user downloads.
  if (role !== "asr") continue;
  const accuracy = {};
  for (const row of record.accuracy_benchmarks ?? []) {
    if (row.dataset !== curation.benchmarks.accuracy.dataset) continue;
    if (row.split !== curation.benchmarks.accuracy.split || row.quant !== defaultFile.quant) continue;
    if (row.scoring || row.mode) continue;
    const language = datasetLanguage(row.language);
    if (language in accuracy) continue;
    accuracy[language] = { error: row.err_pct, ...(row.ci95?.[0] == null ? {} : { ciLower: row.ci95[0] }) };
  }
  const performance = {};
  for (const [tier, rig] of Object.entries(curation.benchmarks.speed)) {
    const runs = (record.speed_benchmarks ?? []).filter(
      (row) => row.machine === rig.machine && row.backend === rig.backend && row.quant === defaultFile.quant,
    );
    if (runs.length) performance[tier] = Number(average(runs.map((row) => row.xrt_compute)).toFixed(3));
  }
  if (Object.keys(accuracy).length || Object.keys(performance).length) {
    benchmarks[id] = {
      accuracy: Object.fromEntries(Object.entries(accuracy).sort(([a], [b]) => a.localeCompare(b))),
      performance,
    };
  }
}

const byId = new Map(models.map((model) => [model.id, model]));
if (byId.size !== models.length) problems.push("duplicate model ids");
for (const id of Object.keys(curated)) {
  const model = byId.get(id);
  if (!model) problems.push(`curated model ${id} is not published in transcribe.cpp ${tag}`);
  else if (model.role !== "asr") problems.push(`curated model ${id} is a ${model.role} model`);
  else if (!curated[id]?.description) problems.push(`curated model ${id} needs a description`);
}
if (byId.get(detector.id)?.role !== "langid") problems.push(`language detector ${detector.id} is not a langid model`);
if (problems.length) fail(problems.join("\n  "));

// Curated models first, in curation order, then everything else by id.
const order = Object.keys(curated);
models.sort((a, b) => {
  const [x, y] = [order.indexOf(a.id), order.indexOf(b.id)];
  if (x !== y) return (x < 0 ? Infinity : x) - (y < 0 ? Infinity : y);
  return a.id.localeCompare(b.id);
});

const catalog = {
  schema: 1,
  transcribeCpp: tag.replace(/^v/, ""),
  methodology: curation.methodology,
  benchmarks: curation.benchmarks,
  languageDetector: detector.id,
  models,
  results: Object.fromEntries(models.filter((model) => benchmarks[model.id]).map((model) => [model.id, benchmarks[model.id]])),
};

// One model field per line, small objects (cells, files, capabilities) inline.
const text = `${JSON.stringify(catalog, null, 2).replace(
  /\{\n\s+"(?:error|accelerated|cpu|streaming|quant)":[^{}[\]]*?\n\s*\}/g,
  (block) => JSON.stringify(JSON.parse(block)).replaceAll('":', '": ').replaceAll(/,(?=")/g, ", "),
)}\n`;
const pinsText = `${JSON.stringify(Object.fromEntries(Object.entries(pins).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`;

if (check) {
  const current = existsSync(catalogPath) ? readFileSync(catalogPath, "utf8") : "";
  if (current !== text) fail("catalog.json is out of date; run npm run generate");
  console.error("catalog.json is up to date");
} else {
  writeFileSync(catalogPath, text);
  if (updatePins) writeFileSync(pinsPath, pinsText);
  const count = models.filter((model) => model.curated).length;
  console.error(`wrote catalog.json: ${models.length} published, ${count} curated, from transcribe.cpp ${tag}`);
}
