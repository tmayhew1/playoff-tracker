#!/usr/bin/env Rscript
# Fetches basketball-reference's PLAYER season-totals page for each season and
# derives the league-wide rates the VA formula needs, merging into
# app/data/league-averages.json. Existing entries are preserved unless
# --force is passed.
#
#   Rscript scripts/R/fetch_league_averages.R 1979-80
#   Rscript scripts/R/fetch_league_averages.R 1970-71 1995-96 --force
#
# Why the player-totals page (NBA_<year>_totals.html) and not the season
# index's team-totals table: the team table's id/layout has churned across
# eras and the old fallback quietly matched a table with inflated minutes,
# which poisoned laPTSperM (and every other per-minute rate) for 1996-97
# through 2025-26 — modern baselines implied ~80-97 team PPG when the real
# numbers were ~95-115. The player-totals page is the exact page the
# regular-season bake already parses correctly, and every derived rate is a
# ratio of sums, so player-level totals give identical results. A plausibility
# gate refuses to write junk if the layout ever shifts again.

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

args <- commandArgs(trailingOnly = TRUE)
force <- "--force" %in% args
positional <- args[!grepl("^--", args)]
if (length(positional) < 1 || length(positional) > 2) {
  stop("Usage: Rscript fetch_league_averages.R <startSeason> [endSeason] [--force]")
}
start_season <- positional[1]
end_season   <- if (length(positional) >= 2) positional[2] else positional[1]
SEASON_RE <- "^[0-9]{4}-[0-9]{2}$"
for (s in c(start_season, end_season)) {
  if (!grepl(SEASON_RE, s)) stop(sprintf('Bad season "%s" - expected YYYY-YY', s))
}
start_year <- as.integer(substr(start_season, 1, 4))
end_year   <- as.integer(substr(end_season, 1, 4))
if (end_year < start_year) {
  stop(sprintf("endSeason (%s) is before startSeason (%s)", end_season, start_season))
}

# Locate the per-player season-totals table (same id list the regular-season
# bake in fetch_historical.R uses).
find_totals_table <- function(doc) {
  for (id in c("totals_stats", "players_totals", "totals", "per_game_stats")) {
    t <- xml2::xml_find_first(doc, sprintf("//table[@id='%s']", id))
    if (!inherits(t, "xml_missing")) return(t)
  }
  for (t in xml2::xml_find_all(doc, "//table")) {
    head <- xml2::xml_find_first(t, ".//thead")
    if (inherits(head, "xml_missing")) next
    hp <- !inherits(xml2::xml_find_first(head, ".//*[@data-stat='pts']"), "xml_missing")
    hg <- !inherits(xml2::xml_find_first(head, ".//*[@data-stat='g']"),   "xml_missing")
    hm <- !inherits(xml2::xml_find_first(head, ".//*[@data-stat='mp']"),  "xml_missing")
    if (hp && hg && hm) return(t)
  }
  NULL
}

fetch_league_totals <- function(season) {
  year_end <- season_end_year(season)
  url <- sprintf("https://www.basketball-reference.com/leagues/NBA_%d_totals.html", year_end)
  message(sprintf("Fetching %s", url))
  doc <- parse_html_uncommented(throttled_fetch(url))
  table <- find_totals_table(doc)
  if (is.null(table)) stop("player totals table not found")

  # Sum every player row once: traded players appear as per-team rows plus a
  # TOT aggregate, so keep the first row per player (BR lists TOT first) to
  # avoid double counting.
  totals <- list(mp = 0, pts = 0, ast = 0, stl = 0, blk = 0, tov = 0, drb = 0,
                 orb = 0, fgm = 0, fga = 0, tpm = 0, tpa = 0, ftm = 0, fta = 0)
  seen <- new.env(parent = emptyenv())
  rows <- 0
  for (tr in xml2::xml_find_all(table, ".//tbody/tr")) {
    cls <- xml2::xml_attr(tr, "class")
    if (!is.na(cls) && grepl("thead", cls)) next
    name <- cell_text(tr, c("player", "name_display", "name"))
    if (!nzchar(name) || grepl("league average", name, ignore.case = TRUE)) next
    href <- xml2::xml_attr(xml2::xml_find_first(tr, ".//a[contains(@href,'/players/')]"), "href")
    key <- if (!is.na(href)) href else name
    if (!is.null(seen[[key]])) next
    seen[[key]] <- TRUE
    mp <- num(cell_text(tr, c("mp", "mp_total")))
    if (mp <= 0) next
    rows <- rows + 1
    totals$mp  <- totals$mp  + mp
    totals$pts <- totals$pts + num(cell_text(tr, "pts"))
    totals$ast <- totals$ast + num(cell_text(tr, "ast"))
    totals$stl <- totals$stl + num(cell_text(tr, "stl"))
    totals$blk <- totals$blk + num(cell_text(tr, "blk"))
    totals$tov <- totals$tov + num(cell_text(tr, "tov"))
    totals$drb <- totals$drb + num(cell_text(tr, "drb"))
    totals$orb <- totals$orb + num(cell_text(tr, "orb"))
    totals$fgm <- totals$fgm + num(cell_text(tr, "fg"))
    totals$fga <- totals$fga + num(cell_text(tr, "fga"))
    totals$tpm <- totals$tpm + num(cell_text(tr, "fg3"))
    totals$tpa <- totals$tpa + num(cell_text(tr, "fg3a"))
    totals$ftm <- totals$ftm + num(cell_text(tr, "ft"))
    totals$fta <- totals$fta + num(cell_text(tr, "fta"))
  }
  if (rows < 100) stop(sprintf("only %d player rows parsed; table layout may have changed", rows))
  totals
}

main <- function() {
  existing <- load_league_averages()
  seasons <- vapply(start_year:end_year, make_season, character(1))

  added <- 0; skipped <- 0; failed <- 0
  for (season in seasons) {
    if (!is.null(existing[[season]]) && !force) {
      message(sprintf("  Skipping %s (already present; pass --force to overwrite)", season))
      skipped <- skipped + 1
      next
    }
    res <- tryCatch({
      totals <- fetch_league_totals(season)
      lga <- lga_from_totals(totals)
      if (!lga_plausible(lga)) {
        stop(sprintf("implausible laPTSperM=%.4f (expected 0.36-0.56); refusing to write",
                     lga$laPTSperM))
      }
      existing[[season]] <<- lga
      added <<- added + 1
      message(sprintf("  ok %s - laPTSperM=%.3f, la3P=%.3f, laFG=%.3f",
                      season, lga$laPTSperM, lga$la3P, lga$laFG))
      TRUE
    }, error = function(e) {
      message(sprintf("  x %s - %s", season, conditionMessage(e)))
      failed <<- failed + 1
      FALSE
    })
  }

  # Sort keys for a clean diff.
  existing <- existing[order(names(existing))]
  write_json_pretty(existing, LGA_PATH)
  message(sprintf("Wrote %s (%d seasons; +%d new, %d skipped, %d failed)",
                  LGA_PATH, length(existing), added, skipped, failed))
}

main()
