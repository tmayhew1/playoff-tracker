# Historical data pipeline (R)

All **historical** NBA playoff data ("yesterday and before") is collected by
these R scripts, scraped from [basketball-reference.com](https://www.basketball-reference.com),
and stored permanently as committed JSON under `app/data/`.

**Live, in-progress games** are *not* handled here — the Next.js
`/api/scores` and `/api/boxscore` routes serve those straight from the NBA
feed. This pipeline owns everything that has already finished.

## The files

| Script | What it does |
| --- | --- |
| `scrape_common.R` | Shared helpers: throttled BR fetch, the "tables hidden in HTML comments" un-wrap, tricode mapping, the **Value Added** formula, and the JSON writer. |
| `fetch_league_averages.R` | Scrapes per-season league totals → `app/data/league-averages.json` (the VA baselines). |
| `fetch_historical.R` | Bakes one season → `history-<season>.json`, `leaderboard-<season>.json`, `regular-season-<season>.json`. |
| `daily_backfill.R` | Orchestrator run daily by CI (see below). |
| `compare-json.mjs` | Semantic diff of two JSON files (number tolerance, ignores `fetchedAt`). Verification helper. |

## Output is a contract

The app reads these JSON files through "bake-first" API routes, so the
**shape must stay identical**. The schema and the VA math are mirrored from
`app/scoring.js`. If you change the VA formula, change it in **both**
`app/scoring.js` *and* `scrape_common.R` (and `app/api/leaderboard/route.js`).

## Running locally

```sh
# One season (needs league averages for that season first):
Rscript scripts/R/fetch_league_averages.R 2014-15
Rscript scripts/R/fetch_historical.R 2014-15

# The daily orchestrator (current season + gap-fill):
Rscript scripts/R/daily_backfill.R
```

Requires R with `httr`, `xml2`, `jsonlite`.

## Daily automation

`.github/workflows/daily-backfill.yml` runs `daily_backfill.R` every day. It:

1. Re-bakes the **current** season (new games finalize on BR daily).
2. Fills any **gaps** in the covered season range (up to `DAILY_MAX_BACKFILL`
   per run — past seasons are immutable, so once baked they're left alone).

Env knobs: `DAILY_MIN_SEASON`, `DAILY_MAX_BACKFILL` (default 6),
`DAILY_FORCE_CURRENT` (default `true`).

## A note on number formatting

R's `jsonlite` can't reproduce JavaScript's shortest round-trip float
strings, so re-baking a season that was originally produced by the old Node
scripts shows last-digit string diffs (e.g. `…512` vs `…51`). These are
**semantically identical** (round-trip-safe doubles; the app displays 1–2
decimals) — verify with `compare-json.mjs`, not a byte diff.

## Migration status

These R scripts replace the Node scrapers (`scripts/fetch-historical.mjs`,
`scripts/fetch-league-averages.mjs`). The Node versions and their manual
workflows are kept until the daily R workflow has a confirmed green run, then
removed.
