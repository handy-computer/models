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
import { recommend, CURATED_MODELS, getModel, languageAccuracyGrade, modelWaitSeconds,
  speedMeterLevel, autoLanguagePolicy, LANGUAGE_DETECTION_MODEL } from "@handy-computer/models";

// Best/Fast/Accurate from the curated models this engine can load.
const picks = recommend(["en", "de"], { engineVersion: transcribeVersion() });
for (const pick of picks) {
  pick.roles;          // ["best"], ["fast", "accurate"], ...
  pick.status;         // eligible | experimental | unsupported | unbenchmarked
  pick.model.repository, pick.model.revision, pick.model.filename, pick.model.sha256;
}
```

Download from `https://huggingface.co/<repository>/resolve/<revision>/<filename>`
and verify `sha256`. `files` lists every quant; `quant`/`filename`/`size`/
`sha256` at the top level are the default (benchmarked) file.

Rust (Handy) reads the same file: `@handy-computer/models/catalog.json`.
Unknown fields can be ignored; the `schema` number changes on any breaking
change.

The functions Pi Voice had keep their names and behaviour (`recommendModels`,
`benchmarkModels`, `frontierModelIds`, `accuracyGrade`, `languageAccuracyGrade`,
`speedMeterLevel`, `modelWaitSeconds`, `getPreferredRecommendationLanguages`,
`autoLanguagePolicy`, `undetectablePreferences`, `rankCatalogModels`, ...).
`createCatalog(data)` binds them all to a different catalog, e.g. one fetched
at runtime.

### Grades and the speed meter

Grades are on measured error at the benchmarked quant: A under 5%, B under
10%, C under 20%, D under 30%, F beyond; each `+`/`-` step is a factor of
∛2. The speed meter counts how many of 1.5, 3, 5, 10 and 20 seconds the
model beats when processing a 30-second dictation on the benchmark GPU.

## curation.yaml

The only hand-edited file. It holds:

- `transcribeCpp`: the transcribe.cpp release to build from. Use the engine
  version the apps ship; benchmarks can change with engine behaviour.
- `benchmarks`: which quant, dataset and machines the picks are judged on.
- `methodology`: the recommendation thresholds.
- `languageDetector`: the shared spoken-language detector.
- `models`: the curated models, by Hugging Face repo name without `-gguf`,
  each with a `description` and optionally a `name`. Listing a model is what
  makes it curated; removing it makes it Published only.

Everything else (languages, capabilities, licence, files, sizes, benchmarks)
comes from transcribe.cpp and is never written here. If a fact is wrong, fix
it in transcribe.cpp.

## Updating

```sh
npm run pins       # after changing transcribeCpp: pin new or re-uploaded files
npm run generate   # rebuild catalog.json from curation.yaml + transcribe.cpp + pins.json
npm run snapshot   # print every pick that changed, and accept the new snapshot
npm test
```

`generate` reads a transcribe.cpp checkout (default `../../../transcribe.cpp`,
or `--transcribe-cpp`/`TRANSCRIBE_CPP`) at the tag in `curation.yaml`, and
needs its tags. It is offline: Hugging Face is only contacted by `npm run
pins`.

`pins.json` is a lock file. A pin moves only when the bytes change: apps
find downloads under `snapshots/<revision>/`, so a new revision with identical
files would make every user download the model again. When transcribe.cpp
re-uploads a model, `pins` picks the newest revision whose file sizes match
the release.

## Automation (`.github/workflows/models.yml`)

Every day the workflow runs `npm run update`: it moves `curation.yaml` to the
newest transcribe.cpp release, refreshes pins, regenerates, re-snapshots the
picks, bumps the patch version, and tests. Then:

| What changed | What happens |
|---|---|
| Nothing | nothing |
| New published models, benchmark numbers that move no pick, uncurated models | lands on main and publishes to npm |
| Any pick, or a curated model's (or the language detector's) download, licence, languages, capabilities or minimum engine | opens (or refreshes) one PR, `bot/models-catalog`, with the changes in words; merging publishes |
| A new model that would be picked if curated | an issue per model with the evidence and the YAML to paste; close it to say no |

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
code reproduces them exactly. `picks.json` is this package's own snapshot.
