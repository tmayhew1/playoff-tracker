#!/usr/bin/env Rscript
# Bakes every NBA team's regular-season record — wins, losses, margin of
# victory, SRS, offensive/defensive rating, pace — from Basketball-Reference's
# season pages (the "advanced-team" table) into app/data/team-records.json,
# merged by season:
#
#   Rscript scripts/R/fetch_standings.R 1981 2026   # seasons 1980-81..2025-26
#
#   { "seasons": { "2025-26": { "OKC": { "w": 64, "l": 18, "mov": 12.1, ... } } } }
#
# The 2026-27 Look Ahead fits its win projections on these
# (scripts/fit-projection-model.mjs). Team codes go through to_nba(), the
# same mapping the player bakes use, so a season's records and its players
# name teams alike.

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

OUT <- file.path(DATA_DIR, "team-records.json")
BR <- "https://www.basketball-reference.com"

fetch_season <- function(end_year) {
  doc <- parse_html_uncommented(throttled_fetch(sprintf("%s/leagues/NBA_%d.html", BR, end_year)))
  table <- xml2::xml_find_first(doc, "//table[@id='advanced-team']")
  if (inherits(table, "xml_missing")) stop(sprintf("no advanced-team table for %d", end_year))
  rows <- xml2::xml_find_all(table, ".//tbody/tr[not(contains(@class,'thead'))]")
  out <- list()
  for (tr in rows) {
    a <- xml2::xml_find_first(tr, ".//*[@data-stat='team' or @data-stat='team_name']//a")
    href <- xml2::xml_attr(a, "href")
    if (is.na(href)) next  # the League Average row has no team link
    code <- to_nba(sub("^/teams/([A-Z]+)/.*$", "\\1", href))
    w <- suppressWarnings(as.integer(cell_text(tr, c("wins"))))
    l <- suppressWarnings(as.integer(cell_text(tr, c("losses"))))
    if (is.na(w) || is.na(l)) next
    nn <- function(k) suppressWarnings(as.numeric(cell_text(tr, k)))
    out[[code]] <- list(w = w, l = l, mov = nn(c("mov")), srs = nn(c("srs")),
                        ortg = nn(c("off_rtg")), drtg = nn(c("def_rtg")), pace = nn(c("pace")))
  }
  if (length(out) < 20) stop(sprintf("only %d teams parsed for %d", length(out), end_year))
  out
}

main <- function(years) {
  have <- if (file.exists(OUT)) jsonlite::fromJSON(OUT, simplifyVector = FALSE)$seasons else list()
  for (y in years) {
    season <- make_season(y - 1L)
    message(sprintf("%s ...", season))
    have[[season]] <- fetch_season(y)
    message(sprintf("  %d teams", length(have[[season]])))
  }
  have <- have[order(names(have))]
  # No timestamp: re-baking the same seasons writes the same bytes.
  write_json_pretty(list(seasons = have, source = "basketball-reference.com"), OUT)
  message(sprintf("Wrote %d seasons -> %s", length(have), OUT))
}

if (sys.nframe() == 0L) {
  args <- commandArgs(trailingOnly = TRUE)
  args <- suppressWarnings(as.integer(args[!grepl("^--", args)]))
  if (!length(args) || any(is.na(args))) stop("Usage: Rscript fetch_standings.R <first-end-year> [last-end-year]")
  years <- if (length(args) >= 2) seq(args[1], args[2]) else args[1]
  tryCatch(main(years), error = function(e) {
    message("fetch_standings failed: ", conditionMessage(e))
    quit(status = 1)
  })
}
