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

# A season counts as "present" only when its LEADERBOARD exists. Some older
# seasons have a history-<season>.json (from the retired pipeline) but no
# leaderboard-, and the cross-season player index is built from leaderboards --
# so keying off history would wrongly skip them. Keying off leaderboard makes
# the gap-fill bake those seasons.
seasons_present <- function() {
  files <- list.files(DATA_DIR, pattern = "^leaderboard-[0-9]{4}-[0-9]{2}\\.json$")
  sort(sub("^leaderboard-(.*)\\.json$", "\\1", files))
}

run <- function(script, args) {
  status <- system2(RSCRIPT, c(shQuote(script), args), stdout = "", stderr = "")
  status == 0
}

# Make sure league averages exist for a season before baking it (the bake
# refuses to run without them, to avoid nonsense VA).
ensure_lga <- function(season) {
  if (!is.null(load_league_averages()[[season]])) return(TRUE)
  message(sprintf("  league averages missing for %s - fetching", season))
  run(LGA_R, c(season, season))
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

  message(sprintf("Done. Backfilled %d past season(s); refreshed %s.", filled, current))
}

main()
