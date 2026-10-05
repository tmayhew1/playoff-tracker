#!/usr/bin/env Rscript
# Bakes NBA draft results — pick, team, player and college — from
# Basketball-Reference's draft pages into app/data/draft-picks.json, merged by
# draft year (existing years are kept unless re-fetched):
#
#   Rscript scripts/R/fetch_draft.R 2016 2026     # every draft 2016..2026
#   Rscript scripts/R/fetch_draft.R 2026          # one draft
#
#   { "years": { "2025": [ { "pick": 1, "team": "DAL", "name": "Cooper Flagg",
#                            "slug": "flaggco01", "college": "Duke" }, ... ] } }
#
# The 2026-27 Look Ahead reads it: a rookie's draft slot is the strongest
# public signal of the role a rookie walks into (scripts/fit-projection-model.mjs).
# `slug` is the Basketball-Reference player id, so a pick joins to the NBA
# seasons without matching names.

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

OUT <- file.path(DATA_DIR, "draft-picks.json")
BR <- "https://www.basketball-reference.com"

fetch_draft <- function(year) {
  doc <- parse_html_uncommented(throttled_fetch(sprintf("%s/draft/NBA_%d.html", BR, year)))
  table <- xml2::xml_find_first(doc, "//table[@id='stats']")
  if (inherits(table, "xml_missing")) stop(sprintf("no draft table for %d", year))
  rows <- xml2::xml_find_all(table, ".//tbody/tr[not(contains(@class,'thead'))]")
  picks <- list()
  for (tr in rows) {
    pick <- suppressWarnings(as.integer(cell_text(tr, c("pick_overall"))))
    if (is.na(pick)) next
    a <- xml2::xml_find_first(tr, ".//*[@data-stat='player']//a")
    href <- xml2::xml_attr(a, "href")
    slug <- if (!is.na(href)) sub("^.*/players/[a-z]/([^.]+)\\.html$", "\\1", href) else NA_character_
    picks[[length(picks) + 1]] <- list(
      pick = pick,
      team = to_nba(cell_text(tr, c("team_id"))),
      name = cell_text(tr, c("player")),
      slug = slug,
      college = cell_text(tr, c("college_name"))
    )
  }
  if (length(picks) < 30) stop(sprintf("only %d picks parsed for %d", length(picks), year))
  picks
}

main <- function(years) {
  have <- if (file.exists(OUT)) jsonlite::fromJSON(OUT, simplifyVector = FALSE)$years else list()
  for (y in years) {
    message(sprintf("Draft %d ...", y))
    have[[as.character(y)]] <- fetch_draft(y)
    message(sprintf("  %d picks", length(have[[as.character(y)]])))
  }
  have <- have[order(names(have))]
  # No fetch timestamp: re-baking the same drafts must write the same bytes,
  # so a re-run (the workflow also fires on pushes to this script) commits
  # nothing.
  write_json_pretty(list(years = have, source = "basketball-reference.com"), OUT)
  message(sprintf("Wrote %d drafts -> %s", length(have), OUT))
}

if (sys.nframe() == 0L) {
  args <- commandArgs(trailingOnly = TRUE)
  args <- suppressWarnings(as.integer(args[!grepl("^--", args)]))
  if (!length(args) || any(is.na(args))) stop("Usage: Rscript fetch_draft.R <first-year> [last-year]")
  years <- if (length(args) >= 2) seq(args[1], args[2]) else args[1]
  tryCatch(main(years), error = function(e) {
    message("fetch_draft failed: ", conditionMessage(e))
    quit(status = 1)
  })
}
