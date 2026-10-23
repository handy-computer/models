# @handy-computer/models

The speech-to-text model catalog and the recommendation method shared by
Handy, Pi Voice, and models.handy.computer. Same package version, same engine,
same languages: same picks everywhere.

## Four levels

| Level | What it is | Where it comes from |
|---|---|---|
| Loadable | Anything the app's engine can open, including a GGUF from disk | the app, at runtime |
| Published | Every model transcribe.cpp publishes (`ALL_MODELS`) | transcribe.cpp `catalog/` |
| Curated | Shown by default and the only models ever recommended (`CURATED_MODELS`) | `curation.yaml` |
| Recommended | Best, Fast and Accurate for the user's languages | computed by `recommend()`, never stored |

Each app chooses how far past Curated it goes. Pi Voice shows Curated; Handy
can also search Published. A model that leaves Curated stays Published, so a
saved setting that points at it keeps resolving through `getModel(id)`.

## Use

```ts
import { forPlatform, CURATED_MODELS, getModel, modelFile, languageAccuracyGrade,
  speedMeterLevel, autoLanguagePolicy, LANGUAGE_DETECTION_MODEL } from "@handy-computer/models";

// Speeds are judged on the platform the app runs on; the app says which.
const models = forPlatform(isAppleSilicon ? "apple-silicon" : "other");

// Best/Fast/Accurate from the curated models this engine can load.
const picks = models.recommend(["en", "de"], { engineVersion: transcribeVersion() });
for (const pick of picks) {
  pick.roles;          // ["best"], ["fast", "accurate"], ...
  pick.status;         // eligible | experimental | unsupported | unbenchmarked
  const file = modelFile(pick.model); // the default (benchmarked) file: files[quant]
  pick.model.repository, pick.model.revision, file.filename, file.size, file.sha256;
}
```

Download from `https://huggingface.co/<repository>/resolve/<revision>/<filename>`
and verify `sha256`. `files` holds every published file, keyed by quant;
`quant` names the default.

`previousRevisions` lists the revisions this model was pinned to before
`revision`, most recently replaced first, and only ever grows. A download at
one of them was shipped before, but may contain identical model bytes (for
example, after a file relocation). Compare hashes before treating it as a
model update. A download at neither isn't one the catalog ever shipped.
Cache reuse and migration are the app's responsibility.

Rust (Handy) reads the same file: `@handy-computer/models/catalog.json`.
Unknown fields can be ignored; the `schema` number changes on any breaking
change.

### Platforms

Accuracy is measured once and holds everywhere. Speed is not: a model that
keeps a 4750U waiting is quick on Apple Silicon, so waits, the speed meter
and the picks are judged on the reference machine of the platform the app runs
on:

| Platform | Reference | Best, Accurate, speed meter | Fast |
|---|---|---|---|
| `apple-silicon` | base Apple M4 | Metal | Metal |
| `other` | AMD Ryzen 4750U | Vulkan | CPU |

The app says which platform it is: `"apple-silicon"` on an arm64 Mac,
`"other"` anywhere else, Intel Macs included. Check the hardware rather than
the process: Node under Rosetta reports `x64` on an Apple Silicon Mac. In Rust,
`cfg!(all(target_os = "macos", target_arch = "aarch64"))`.

`forPlatform(platform)` returns everything the speeds touch (`recommend`,
`recommendModels`, `benchmarkModels`, `getPreferredRecommendationLanguages`,
`modelWaitSeconds`) along with everything that holds on every platform, so an
app can keep just that object. The platform-independent half is also exported
directly: `getModel`, `languageAccuracyGrade`, `autoLanguagePolicy`,
`undetectablePreferences`, `ALL_MODELS`, `CURATED_MODELS`, ... .

In `catalog.json`, `results[id].performance` holds real-time factors by
platform, then tier: `{ "apple-silicon": { accelerated }, other: { accelerated,
cpu } }`. `benchmarks.platforms` names the machine and backend behind each. A
platform without a `cpu` tier judges Fast on `accelerated`.

The rest of Pi Voice's functions keep their names and behaviour
(`frontierModelIds`, `accuracyGrade`, `speedMeterLevel`, `autoLanguagePolicy`,
`undetectablePreferences`, `rankCatalogModels`, ...); on the `other` platform
the picks are exactly Pi Voice's. `createCatalog(data)` binds them all to a
different catalog, e.g. one fetched at runtime; `.forPlatform()` works on it
the same way.

### Grades and the speed meter

Grades are on measured error at the benchmarked quant: A under 5%, B under
10%, C under 20%, D under 30%, F beyond; each `+`/`-` step is a factor of
∛2. The speed meter counts how many of 1.5, 3, 5, 10 and 20 seconds the
model beats when processing a 30-second dictation on the platform's
accelerated benchmark.

## curation.yaml

The hand-edited editorial configuration. It holds:

- `transcribeCpp`: the transcribe.cpp release to build from. Use the engine
  version the apps ship; benchmarks can change with engine behaviour.
- `benchmarks`: which quant and dataset the picks are judged on, and each
  platform's reference machine and backends. Every curated model needs
  every platform's speeds.
- `methodology`: the recommendation thresholds.
- `languageDetector`: the shared spoken-language detector.
- `models`: the curated models, by Hugging Face repo name without `-gguf`,
  each with a `description`. Listing a model is what makes it curated;
  removing it makes it Published only.
- `names`: the display name of every published model, curated or not. A
  model missing here gets a name tidied from its id, and the daily PR lists
  it.

Everything else (languages, capabilities, licence, files, sizes, benchmarks)
comes from transcribe.cpp. If a fact is wrong, fix it in transcribe.cpp.
Byte-identical download relocations can be recorded in `pins.json` as described below.

## Updating

```sh
npm run pins       # after changing transcribeCpp: pin new or re-uploaded files
npm run generate   # rebuild catalog.json from curation.yaml + transcribe.cpp + pins.json
npm run snapshot   # print every pick that changed per platform, and accept the new snapshots
npm test
```

`generate` reads a transcribe.cpp checkout (default `../../../transcribe.cpp`,
or `--transcribe-cpp`/`TRANSCRIBE_CPP`) at the tag in `curation.yaml`, and
needs its tags. It is offline: Hugging Face is only contacted by `npm run
pins`.

`pins.json` is a lock file. Automatic refresh keeps an existing pin while
its file paths and sizes match the release. Otherwise it tries the existing
and preferred revisions, then the newest matching revision. The old revision
moves to the pin's `previous` list. CI fails any change that drops a revision.

A byte-identical file relocation does not need an engine release. After
verifying every relocated file's SHA-256 and size on Hugging Face, update the
pin's `revision`, retain the old revision in `previous`, and add `filename`
to each relocated file entry with its new repository-relative path. Keep the
entry's key as the path from the engine release and keep its hash and size
unchanged. Run `npm run generate` to emit the new download paths. Regular pin
refresh preserves these entries; a later engine release with new paths can
resolve them normally. Revision-based caches may need migration, but matching
hashes mean the existing model bytes remain valid.

When Hugging Face spells a repo differently from transcribe.cpp (after a
rename or a case change, which only redirect), the pin records Hugging Face's
spelling and the catalog's `repository` uses it, since Hugging Face tools name
cache folders after it. The id stays transcribe.cpp's.

A public Hugging Face repo counts as released. A model whose repo is still
private is pinned with `"private": true` and left out of the catalog; a
later `pins` picks it up once the repo is public.

## Automation (`.github/workflows/models.yml`)

Every day the workflow runs `npm run update`: it moves `curation.yaml` to the
newest transcribe.cpp release, refreshes pins, regenerates, re-snapshots the
picks, bumps the patch version, and tests. In practice it only finds
something when transcribe.cpp tags a new release. Then:

| What changed | What happens |
|---|---|
| Nothing | nothing |
| Anything | opens (or refreshes) one PR, `bot/models-catalog`, with the changes in words; merging publishes |
| A new model that would be picked if curated | an issue per model with the evidence and the YAML to paste; close it to say no |

The PR leads with what needs a closer look: pick changes; a curated model's
(or the language detector's) download, licence, languages, capabilities or
minimum engine; models that need a name; and models left out because their
repo is still private. Nothing reaches main or npm without a merge, and every
release is a patch.

PRs and pushes run `generate --check`, the tests and the build. A push to main
with a new `version` in package.json publishes, so a hand edit (curating a
model, changing a threshold) is: edit `curation.yaml`, `npm run generate &&
npm run snapshot`, bump the version, open a PR.

To decline a review PR, change `curation.yaml` or the method on main;
closing the PR alone means the same update reopens it the next day.

One-time setup:

1. Repository Settings → Actions → General → Workflow permissions: allow
   GitHub Actions to create and approve pull requests.
2. Publish 0.1.0 by hand once (`npm publish --access public` from this
   folder), then on npmjs.com add a trusted publisher for the package:
   GitHub Actions, `handy-computer/models`, workflow
   `models.yml`. Trusted publishing needs no token to rotate. Alternatively,
   set an `NPM_TOKEN` repository secret.
3. Optional: an `HF_TOKEN` secret, if Hugging Face rate-limits the pin step.

`test/fixtures/pi-voice-picks.json` and `pi-voice-data.json` record Pi
Voice's picks and data at the time of the move; `parity.test.ts` proves this
code reproduces them exactly (as the `other` platform). `picks/<platform>.json`
are this package's own snapshots, one per platform.
