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
    recommendation.ts      the complete recommendation policy and thresholds:
                           coverage, error gates, language switching and the
                           overall / fast / accurate CPU budgets.
    standing.ts            a model against the field: per-language standing vs
                           the best other model, CI-overlap ties, frontier
                           counts, the verdict text, compare-with suggestions,
                           coverage and feature diffs of a set. Isomorphic.
    quant.ts               a model's lower quants against its Q8_0 baseline:
                           per-language drift rows and the per-quant summary
                           (median drift, worst language, above-CI count,
                           file size). Isomorphic.
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
    recommendations.astro English and every English-language pair in one table
  scripts/                 browser code: tooltip, sortable tables, scatter,
                           bars, dot plot, diff (diverging difference chart),
                           quantchart (grouped drift bars per language),
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
  page becomes the **set view** (`/languages?set=de,fr,ja`) — models ranked by
  the geometric mean of their error, with per-language numbers and ranks, a top
  pick for the set, and the geomean scatter. Only models covering the complete
  set appear on the page. Models at 30% or worse on any selected language are
  hidden from both chart and table until the table’s disclosure row is opened. Card-only
  languages act as coverage constraints. Within a set, changes render in place;
  going to or from a single language is a page load.
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
  Models with results at lower quantizations get a **quantization** card:
  one group of bars per language, one bar per quant (Q6_K, Q5_K_M, Q4_K_M),
  the log ratio of that quant's error to the model's own Q8_0 result, with
  the Q8_0 95% CI drawn as a band and bars inside it faded. Under the chart a
  summary per quant (file size and share of Q8_0, median drift, the worst
  language with its absolute error before and after, how many languages sit
  above the Q8_0 CI) and a fold-out table of every number. The language
  focus applies to the chart.
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
- **recommendations** (`/recommendations`) — English and each English-language
  pair with a supported model in one full-page table, with overall, fast and
  accurate recommendations, sorted best-to-worst by overall score. Unsupported
  and unbenchmarked pairs are omitted.

Every state is a real URL. The database contains several quantizations; the
site ranks models at Q8_0 and shows the lower quants on the model page. Quant
can become a route dimension later.

## Picks

The complete policy is deliberately isolated in `src/lib/recommendation.ts`.
The language tables and `/recommendations` page use that same function.
Overall and Accurate use the Ryzen 4750U Vulkan GPU; Fast uses its CPU. Wait
means processing after a 30 s dictation (`30 / xrt`).

1. A candidate must be in pi-transcribe's current curated model set, claim and
   have benchmark data for every selected language, and have GPU speed data.
   Database aliases normalize codes such as `tl` → `fil` and `no` → `nb`.
2. If at least one candidate is below 20% error on every language, candidates
   reaching 20% anywhere are discarded.
3. For a multi-language selection, automatically switching models are used if
   any safe one exists; otherwise manual switching is allowed and called out.
4. **Overall** minimizes `geometric-mean error + 0.5 × max(0, GPU wait − 3)`,
   preferring the pool at or under 5 s. **Fast** is the most accurate model at
   or under 4 s on CPU, otherwise the fastest safe CPU model. **Accurate** is
   the most accurate model at or under 10 s on GPU, otherwise the most accurate
   safe model.
5. If no candidate stays below 20%, the candidate with the lowest
   worst-language error is the only fallback. Below 30% it is experimental.
   At 30% or above there is no supported recommendation, except that a lower
   95% confidence bound at or below 30% keeps the fallback experimental.
6. A selection without complete benchmark data gets no recommendation.

One model can carry more than one tag. Multi-language manual-switching picks
show a visible caveat; single-language choices need no language switching.

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
