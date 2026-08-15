#!/usr/bin/env Rscript
# One-off backfill: add `pos` to regular-season files baked before the totals
# scraper read that column.
#
# This exists because of the pipeline's incremental model (see daily_backfill.R):
# a completed season is scraped once and then left alone, so a new FIELD on an
# old season never arrives on its own. The daily job would pick positions up for
# the current season and no other, leaving the board's filter blind to 45 of the
# 46 seasons on disk.
#
# The alternative was re-running fetch_historical.R for every season, which
# re-crawls every playoff box score -- thousands of throttled requests -- to
# re-derive VA that is already correct and would land byte-identical. This walks
# the one page per season that actually carries the new column and merges it in,
# leaving every other field untouched: ~46 requests, and a diff that is only the
# added lines.
#
# Idempotent: seasons whose players already carry `pos` are skipped unless
# POS_BACKFILL_FORCE=true, so an interrupted run resumes where it stopped.
#
# Usage:
#   Rscript scripts/R/backfill_positions.R              # every season on disk
#   Rscript scripts/R/backfill_positions.R 1996-97 1997-98
#   POS_BACKFILL_FORCE=true Rscript scripts/R/backfill_positions.R 2024-25

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

# fetch_regular_season_totals() lives in the bake script and guards its own
# entry point (sys.nframe() == 0), so sourcing it here runs nothing.
source(file.path(R_DIR, "fetch_historical.R"))

FORCE <- tolower(Sys.getenv("POS_BACKFILL_FORCE", "false")) %in% c("true", "1", "yes")

# Seasons with a regular-season file, oldest first.
seasons_on_disk <- function() {
  files <- list.files(DATA_DIR, pattern = "^regular-season-[0-9]{4}-[0-9]{2}\\.json$")
  sort(sub("^regular-season-(.*)\\.json$", "\\1", files))
}

# Join on slug, falling back to name for the handful of early rows BR gives no
# player link. Only `pos` is written; every other field on the existing row is
# carried through untouched, so a re-run cannot rewrite a stat line.
merge_positions <- function(season) {
  path <- file.path(DATA_DIR, sprintf("regular-season-%s.json", season))
  doc <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  players <- doc$players
  if (length(players) == 0) {
    message(sprintf("%s: no players in file - skipping", season))
    return(invisible(FALSE))
  }

  have <- sum(vapply(players, function(p) {
    !is.null(p$pos) && nzchar(as.character(p$pos))
  }, logical(1)))
  if (have == length(players) && !FORCE) {
    message(sprintf("%s: already has positions (%d players) - skipping", season, have))
    return(invisible(FALSE))
  }

  totals <- fetch_regular_season_totals(season_end_year(season))
  by_slug <- list(); by_name <- list()
  for (row in totals) {
    if (is.null(row$pos) || !nzchar(row$pos)) next
    if (!is.null(row$slug) && !is.na(row$slug)) by_slug[[row$slug]] <- row$pos
    by_name[[tolower(row$name)]] <- row$pos
  }

  hits <- 0
  doc$players <- lapply(players, function(p) {
    pos <- NULL
    if (!is.null(p$slug)) pos <- by_slug[[as.character(p$slug)]]
    if (is.null(pos) && !is.null(p$name)) pos <- by_name[[tolower(as.character(p$name))]]
    if (is.null(pos)) return(p)
    hits <<- hits + 1
    # Insert after `team` so the backfilled files match the key order a fresh
    # bake writes, and the two stay diffable.
    at <- match("team", names(p))
    if (is.na(at)) return(c(p, list(pos = pos)))
    c(p[seq_len(at)], list(pos = pos), p[-seq_len(at)])
  })

  if (hits == 0) {
    message(sprintf("%s: totals page carried no positions - leaving file alone", season))
    return(invisible(FALSE))
  }
  write_json_pretty(doc, path)
  message(sprintf("%s: %d/%d players matched -> %s",
                  season, hits, length(players), basename(path)))
  invisible(TRUE)
}

main <- function(args) {
  seasons <- if (length(args)) args else seasons_on_disk()
  bad <- seasons[!grepl("^[0-9]{4}-[0-9]{2}$", seasons)]
  if (length(bad)) stop(sprintf("bad season argument(s): %s", paste(bad, collapse = ", ")))
  message(sprintf("Backfilling positions for %d season(s)...", length(seasons)))

  written <- 0; failed <- character(0)
  for (s in seasons) {
    ok <- tryCatch(merge_positions(s), error = function(e) {
      # One season's failure must not cost the run the seasons after it: the
      # crawl is throttled and slow, and the merge is idempotent, so a rerun
      # picks up only what is still missing.
      message(sprintf("%s: FAILED - %s", s, conditionMessage(e)))
      failed <<- c(failed, s)
      FALSE
    })
    if (isTRUE(ok)) written <- written + 1
  }

  message(sprintf("\nDone: %d file(s) updated, %d failed.", written, length(failed)))
  if (length(failed)) {
    message(sprintf("Re-run for: %s", paste(failed, collapse = " ")))
    quit(status = 1)
  }
}

if (sys.nframe() == 0) {
  args <- commandArgs(trailingOnly = TRUE)
  main(args[!grepl("^--", args)])
}
