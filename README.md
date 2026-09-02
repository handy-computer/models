# models.handy.computer

The speech-to-text model benchmarks for [Handy](https://handy.computer):
which model to run, per language and per machine. Accuracy currently comes
from the FLEURS test split in `wer.db`; the schema can hold more datasets,
rigs, quantizations and evaluations without changing the site identity.

Built with Astro. Every page is pre-rendered directly from `wer.db`; there is
no export step or second data format. Deployed as Cloudflare Workers static
assets on `models.handy.computer` (worker `models-handy-computer`, custom
domain in `wrangler.jsonc`).

## Run it

```sh
bun install
bun run dev        # http://localhost:4321
bun run build      # -> dist/
bun run preview    # serve dist/ locally
bun run check      # astro check (types)
bun run deploy     # build + wrangler deploy (needs `wrangler login` once)
```

Drop a new `wer.db` in the repo root and rebuild. `MODELS_DB=/path/to.db`
overrides the location.

## Layout

```
wer.db                     normalized benchmark database (rebuilt upstream)
astro.config.mjs           static output configuration
wrangler.jsonc             Cloudflare Workers static assets (./dist)
src/
  lib/
    db.ts                  ALL SQL lives here (node:sqlite, build time only).
                           Adapts wer.db into the Dataset consumed by the site.
    types.ts               Dataset / Cell / ModelInfo / LangInfo …
    derive.ts              indexes over a Dataset (cell lookup, claims, perf,
                           sorted language lists). Runs on server and client.
    standing.ts            a model against the field: per-language standing vs
                           the best other model, CI-overlap ties, frontier
                           counts, the verdict text, compare-with suggestions,
                           coverage and feature diffs of a set. Isomorphic.
    config.ts              site identity (name, URL, title, description,
                           pageTitle()), default routes, RIGS (and MODEL_RIGS,
                           the subset the tables show), chart caps
    format.ts  palette.ts  number formatting, heatmap ramp
  layouts/Layout.astro     head (title, description, canonical, OpenGraph),
                           header, tabs, footer, shared tooltip element
  components/              LanguageView, ClaimedOnlyLanguage, Scatter, Bars,
                           ErrCell, FeatureBadges, LanguageSelect, ModelSelect,
                           LanguageFilter (the ?langs= focus on
                           the model views), HandyHand (the mascot by the
                           wordmark, copied from handy.computer)
  pages/
    index.astro            default leaderboard (+ forwards old #hash URLs)
    languages/[lang].astro one page per language (benchmarked + card-only)
    languages/index.astro  the set view (2+ languages): client island,
                           state in ?set=de,fr,ja
    models/[model].astro   one page per model
    models/index.astro     the model set view (2+ models): client island,
                           state in ?set=a,b,c
    matrix.astro           heatmap, fully server-rendered
  scripts/                 browser code: tooltip, sortable tables, scatter,
                           bars, dot plot, diff (diverging difference chart),
                           rankstrip, speedstrip, rigpref (the remembered
                           rig), the model page script (modelpage) and the two
                           set islands (langset, modelset), searchable
                           combobox (single and multi/token modes), select
                           navigation
  styles/global.css        the stylesheet (Handy brand + data palette)
```

Tables, cards, chips and the heatmap are server-rendered HTML and work without
JavaScript. Charts, tooltips, table sorting, the pickers and the set view are
small client scripts that hydrate from JSON blocks inlined into the page.

## Views

- **languages** (`/languages/de`) — leaderboard for one language: top-pick
  card, accuracy-vs-speed scatter with the Pareto frontier highlighted,
  sortable table, and the list of models that claim the language on their card
  without a benchmark. The 63 card-only languages (Whisper's long tail) have
  pages too — they show which models claim them, with speed/size/license.
  The picker is a searchable token field: add a second language and the same
  page becomes the **set view** (`/languages?set=de,fr,ja`) — models covering
  the whole set ranked by the geometric mean of their error, with per-language
  numbers and ranks, a top pick for the set, and the geomean scatter. Card-only
  languages act as coverage-only constraints. A toggle reveals partial-coverage
  models. Within a set, changes render in place; going to or from a single
  language is a page load.
- **models** (`/models/whisper-large-v3`) — one model against the field.
  A sticker with its speed on the AMD Ryzen 4750U (GPU and CPU), size, how many
  languages it is on the accuracy-vs-speed frontier for, a three-sentence
  verdict (how often it leads or ties the leader, where it trails most,
  whether it runs faster than realtime), and the card facts. Then the
  standing chart: one diverging bar per language, the log ratio of its error
  to the best other model's, that model named on the row; faded bars are
  ties (overlapping 95% CIs). A speed strip puts every model on a log axis
  with this one highlighted. "Compare with" links suggest family siblings,
  the model that beats it most often, and the closest coverage. The language
  picker is a focus, not a navigation: choose a few and the verdict, chart
  and frontier count restrict to them (`?langs=de,fr`). Speed and the
  frontier count are on the 4750U GPU. M4 numbers are not shown in any table
  for now; only the scatter's rig picker offers them.
  Add a second model in the model picker and the page becomes the **model
  set view** (`/models?set=a,b`): head-to-head over the languages every
  model covers (geomean, who is ahead on how many, how many of those are
  clear of the 95% CI, how many ties), a coverage line (shared / only-A /
  only-B, names on hover), a side-by-side spec table with the capabilities
  that differ called out, the speed strip with the set highlighted, and for
  a pair the same diverging chart head to head. Three or more models get a
  rank strip (rows models, columns languages grouped by winner, cell colour
  the rank within the set) and a dot plot on a log axis sorted by
  disagreement. The language focus applies here too.
- **matrix** (`/matrix`) — the whole models × languages grid as a heatmap; a
  ring marks claimed-but-unbenchmarked cells.

Every state is a real URL. The database contains several quantizations; the
site currently renders Q8_0. Quant can become a route dimension later.

## Picks

The language tables (single and set) tag three rows, computed in
`src/lib/derive.ts` (`pickThree`, `pickTagsFor`) from the constants in
`src/lib/config.ts` (`SCORE`, `PICK_RIG`). Speed is taken on the Ryzen 4750U
GPU (Vulkan). Tagged rows are tinted; only the overall pick has a tooltip.

- **overall pick** — lowest `error + 2 × wait`, where wait is the seconds a
  user waits after a 10 s dictation (`10 / xrt`). Streaming models that keep
  up with realtime count as waiting 0.3 s. In a language set, models without
  automatic language detection are not eligible (Handy cannot switch
  languages for them); the tag falls back to the whole field only if no
  eligible model covers the set.
- **most accurate** — lowest error among models that wait under 5 s.
- **fast pick** — the same score with the wait weighted 3× more.

One model can carry more than one tag. Multi-language models without
automatic language detection show a "!" icon after their name
(`AutoDetectBadge.astro`, `autoDetectNote` in `derive.ts`); the tooltip
explains, and on multi-language sets it says Handy cannot switch languages for
them. In the set view a visible line above the table repeats the caveat for
any tagged model (the fast pick, typically). Single-language models are
exempt: there is nothing to detect.

## Notes on the database

`wer.db` is normalized around `datasets`, `results`, `models`, `quants`,
`rigs` and `perf`. `src/lib/db.ts` currently selects FLEURS accuracy at Q8_0
and averages the Q8_0 sample measurements into one speed per rig/backend.
All language names, including claimed-but-unbenchmarked languages, come from
the database.

- Some FLEURS error rates exceed 100% (WER can); charts cap the axis at 50 and
  pin those points as open triangles, with exact values in the tables.
- The geometric mean in the set view blends WER and CER when a set mixes
  them (e.g. German + Japanese); the UI flags this but it is worth keeping in
  mind when reading the composite.
