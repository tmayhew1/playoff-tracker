#!/usr/bin/env Rscript
# Daily orchestrator for the historical data pipeline.
#
# Strategy (the "incremental" model):
#   * Completed past seasons are immutable -> scraped once, then left alone.
#   * Each run re-bakes the CURRENT season (to pick up games that finalized
#     on basketball-reference since yesterday) and fills any gaps in the
#     already-covered season range.
#
# Live, in-progress games are NOT this script's job -- the Next.js
# /api/scores + /api/boxscore routes serve those from the NBA feed. This
# script only owns "yesterday and before".
#
# Designed to run daily in GitHub Actions (.github/workflows/daily-backfill.yml).
# Bakes are run as isolated subprocesses so one season's failure can't abort
# the rest.
#
# Env knobs (all optional):
#   DAILY_MIN_SEASON      earliest season to keep complete (default: earliest
#                         season already present in app/data)
#   DAILY_MAX_BACKFILL    cap on missing past seasons baked per run (default 6,
#                         keeps a single run polite + bounded)
#   DAILY_FORCE_CURRENT   "true" to re-bake the current season even if a file
#                         already exists (default "true")

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

RSCRIPT <- file.path(R.home("bin"), "Rscript")
HIST_R  <- file.path(R_DIR, "fetch_historical.R")
LGA_R   <- file.path(R_DIR, "fetch_league_averages.R")
RECOMP_R <- file.path(R_DIR, "recompute_derived.R")
DEF_R   <- file.path(R_DIR, "fetch_def_ratings.R")
PBP_DEF_R <- file.path(R_DIR, "fetch_pbp_def_ratings.R")
SHOOTING_R <- file.path(R_DIR, "fetch_shooting_splits.R")

env_or <- function(name, default) {
  v <- Sys.getenv(name, unset = "")
  if (nzchar(v)) v else default
}

# The NBA season in progress for a given date. Seasons span Oct->Jun, so
# Oct-Dec belongs to the year-just-started; Jan-Sep to the year-before.
current_season_for <- function(d = Sys.Date()) {
  y <- as.integer(format(d, "%Y"))
  m <- as.integer(format(d, "%m"))
  start <- if (m >= 10) y else y - 1L
  make_season(start)
}

# A season counts as "present" only when BOTH its leaderboard AND its
# regular-season file exist. Keying off a single file wrongly skips seasons an
# earlier pipeline left half-baked (history- without leaderboard-, or
# leaderboard- without regular-season-), and the app needs the pair: the
# cross-season player index reads leaderboards, and the Explore scope selector
# reads regular-season totals. Requiring both makes the gap-fill re-bake any
# season missing either.
seasons_present <- function() {
  season_of <- function(pattern, re) sub(re, "\\1", list.files(DATA_DIR, pattern = pattern))
  lb <- season_of("^leaderboard-[0-9]{4}-[0-9]{2}\\.json$", "^leaderboard-(.*)\\.json$")
  rs <- season_of("^regular-season-[0-9]{4}-[0-9]{2}\\.json$", "^regular-season-(.*)\\.json$")
  sort(intersect(lb, rs))
}

run <- function(script, args) {
  status <- system2(RSCRIPT, c(shQuote(script), args), stdout = "", stderr = "")
  status == 0
}

# Make sure PLAUSIBLE league averages exist for a season before baking it (the
# bake refuses to run without them, to avoid nonsense VA). An implausible
# entry (see scrape_common.R::lga_plausible - the 1996-97+ corruption) is
# force-refetched rather than trusted.
ensure_lga <- function(season) {
  l <- load_league_averages()[[season]]
  if (lga_plausible(l)) return(TRUE)
  if (is.null(l)) {
    message(sprintf("  league averages missing for %s - fetching", season))
    return(run(LGA_R, c(season, season)))
  }
  message(sprintf("  league averages for %s implausible (laPTSperM=%.4f) - refetching", season, l$laPTSperM))
  ok <- run(LGA_R, c(season, season, "--force"))
  ok && lga_plausible(load_league_averages()[[season]])
}

bake_season <- function(season) {
  if (!ensure_lga(season)) {
    message(sprintf("  skip %s - could not obtain league averages", season))
    return(FALSE)
  }
  run(HIST_R, season)
}

main <- function() {
  current <- current_season_for()
  present <- seasons_present()
  min_season <- env_or("DAILY_MIN_SEASON",
                       if (length(present)) present[1] else current)
  max_backfill <- as.integer(env_or("DAILY_MAX_BACKFILL", "6"))
  force_current <- tolower(env_or("DAILY_FORCE_CURRENT", "true")) == "true"

  message(sprintf("Daily backfill | current season=%s | covered=%s..%s | min=%s",
                  current,
                  if (length(present)) present[1] else "-",
                  if (length(present)) present[length(present)] else "-",
                  min_season))

  start_year <- as.integer(substr(min_season, 1, 4))
  current_year <- as.integer(substr(current, 1, 4))

  # 1. Fill gaps in [min_season, current-1] (immutable past seasons).
  present_set <- present
  filled <- 0; remaining_gaps <- 0
  for (yr in start_year:(current_year - 1L)) {
    season <- make_season(yr)
    if (season %in% present_set) next
    if (filled >= max_backfill) { remaining_gaps <- remaining_gaps + 1; next }
    message(sprintf("Backfilling missing season %s", season))
    if (bake_season(season)) filled <- filled + 1
  }
  if (remaining_gaps > 0) {
    message(sprintf("  %d more missing season(s) deferred to a later run (cap=%d)",
                    remaining_gaps, max_backfill))
  }

  # 2. Refresh the current season (new games finalize daily).
  if (force_current || !(current %in% present_set)) {
    message(sprintf("Refreshing current season %s", current))
    bake_season(current)
  }

  # 3. Defensive ratings (the D-Rating category behind VA+): refresh the
  # current season and fill any missing past seasons (present ones are
  # skipped without --force, so the range pass is cheap).
  message(sprintf("Refreshing defensive ratings %s", current))
  run(DEF_R, c(current, current, "--force"))
  run(DEF_R, c(min_season, current))

  # 3b. On-court (play-by-play) defensive ratings from api.pbpstats.com —
  # the *Pbp keys the app prefers over the box-score estimate for 2000-01+.
  # run() already treats a failed script as non-fatal, so an unreachable
  # API just keeps yesterday's numbers.
  message(sprintf("Refreshing on-court (PBP) defensive ratings %s", current))
  run(PBP_DEF_R, c(current, current, "--force"))
  run(PBP_DEF_R, c(min_season, current))

  # 4. Consistency pass: rebuild league averages from the regular-season
  # bakes and recompute the baked leaderboard VA against them, so derived
  # numbers can never drift from the raw data again.
  message("Recomputing derived numbers (league averages + baked VA)")
  run(RECOMP_R, character(0))

  # 5. Shot-distance zone splits (0-3/3-10/10-16/16-3P): refresh the current
  # season and fill any missing seasons back to 1996-97 (BR has no
  # shot-location data before that; the script skips earlier seasons
  # itself, so it's safe to just pass the full covered range). Runs after
  # the consistency pass so its zoneFG merge into league-averages.json
  # lands on top of freshly rebuilt baselines, not the other way around
  # (rebuild_lga() also preserves zoneFG on its own if the order ever
  # changes, but this keeps the pipeline's data flow easy to follow).
  message(sprintf("Refreshing shooting splits %s", current))
  run(SHOOTING_R, c(current, current, "--force"))
  run(SHOOTING_R, c(min_season, current))

  message(sprintf("Done. Backfilled %d past season(s); refreshed %s.", filled, current))
}

main()
