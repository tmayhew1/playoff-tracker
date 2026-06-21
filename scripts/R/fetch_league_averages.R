#!/usr/bin/env Rscript
# Scrapes basketball-reference's team-totals table for each season and
# derives the league-wide rates the VA formula needs, merging into
# app/data/league-averages.json. Existing entries are preserved unless
# --force is passed.
#
#   Rscript scripts/R/fetch_league_averages.R 1979-80
#   Rscript scripts/R/fetch_league_averages.R 1970-71 1995-96 --force
#
# Port of the retired scripts/fetch-league-averages.mjs.

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

# Find the team-totals table. BR table ids have churned; fall back to any
# table whose <thead> shows fga/mp/pts and whose tbody has 8-60 rows.
find_totals_table <- function(doc) {
  for (id in c("totals-team", "team_totals", "team-stats-base", "totals_team")) {
    t <- xml2::xml_find_first(doc, sprintf("//table[@id='%s']", id))
    if (!inherits(t, "xml_missing")) return(t)
  }
  tables <- xml2::xml_find_all(doc, "//table")
  for (t in tables) {
    head <- xml2::xml_find_first(t, ".//thead")
    if (inherits(head, "xml_missing")) next
    has_fga <- !inherits(xml2::xml_find_first(head, ".//*[@data-stat='fga']"), "xml_missing")
    has_mp  <- !inherits(xml2::xml_find_first(head, ".//*[@data-stat='mp']"),  "xml_missing")
    has_pts <- !inherits(xml2::xml_find_first(head, ".//*[@data-stat='pts']"), "xml_missing")
    rows <- length(xml2::xml_find_all(t, ".//tbody/tr"))
    if (has_fga && has_mp && has_pts && rows >= 8 && rows <= 60) return(t)
  }
  NULL
}

fetch_league_totals <- function(season) {
  year_end <- season_end_year(season)
  url <- sprintf("https://www.basketball-reference.com/leagues/NBA_%d.html", year_end)
  message(sprintf("Fetching %s", url))
  doc <- parse_html_uncommented(throttled_fetch(url))
  table <- find_totals_table(doc)
  if (is.null(table)) stop("team totals table not found")

  totals <- list(mp = 0, pts = 0, ast = 0, stl = 0, blk = 0, tov = 0, drb = 0,
                 orb = 0, fgm = 0, fga = 0, tpm = 0, tpa = 0, ftm = 0, fta = 0)
  rows <- 0
  trs <- xml2::xml_find_all(table, ".//tbody/tr")
  for (tr in trs) {
    cls <- xml2::xml_attr(tr, "class")
    if (!is.na(cls) && grepl("thead", cls)) next
    team_name <- cell_text(tr, c("team", "team_id", "team_name", "team_name_abbr"))
    # Skip "League Average"/"League Total" summary rows; we sum teams ourselves.
    if (grepl("league", team_name, ignore.case = TRUE)) next
    mp <- num(cell_text(tr, "mp"))
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
  if (rows < 8) stop(sprintf("only %d team rows parsed; table layout may have changed", rows))
  totals
}

lga_from_totals <- function(t) {
  safe <- function(a, b) if (b > 0) a / b else 0
  twoPm <- t$fgm - t$tpm
  twoPa <- t$fga - t$tpa
  reb <- t$drb + t$orb
  # Hollinger possessions estimate: FGA - ORB + TO + 0.475*FTA.
  poss <- t$fga - t$orb + t$tov + 0.475 * t$fta
  list(
    la3P = safe(t$tpm, t$tpa),
    la2P = safe(twoPm, twoPa),
    laFT = safe(t$ftm, t$fta),
    laFG = safe(t$fgm, t$fga),
    laPTSperM = safe(t$pts, t$mp),
    laASTperM = safe(t$ast, t$mp),
    laSTLperM = safe(t$stl, t$mp),
    laBLKperM = safe(t$blk, t$mp),
    laTOVperM = safe(t$tov, t$mp),
    laDRBperM = safe(t$drb, t$mp),
    laORBperM = safe(t$orb, t$mp),
    laPTSperMake = safe(t$pts, t$fgm),
    laPTSperPoss = safe(t$pts, poss),
    laDRBrate = safe(t$drb, reb),
    laORBrate = safe(t$orb, reb)
  )
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
