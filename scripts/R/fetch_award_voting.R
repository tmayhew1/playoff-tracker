#!/usr/bin/env Rscript
# Bakes NBA award voting and selections from Basketball-Reference into
# app/data/award-voting.json, merged by season (existing seasons are kept
# unless re-fetched):
#
#   Rscript scripts/R/fetch_award_voting.R 1981 2026   # seasons 1980-81..2025-26
#   Rscript scripts/R/fetch_award_voting.R 2026        # one season
#
#   { "seasons": { "2024-25": {
#       "voting":  { "mvp": [ { "slug": "gilgesh01", "name": "...", "team": "OKC",
#                               "first": 71, "points": 913, "max": 1000,
#                               "share": 0.913 }, ... ],
#                    "mip": [...], "dpoy": [...], "roy": [...], "smoy": [...] },
#       "allNba":  { "1st": ["gilgesh01", ...], "2nd": [...], "3rd": [...] },
#       "allStar": ["...", ...] } } }
#
# The Awards tab (scripts/bake-awards.mjs) fits each award's odds to these: the
# voting shares for MVP and MIP, and the selections for All-NBA and All-Star.
# `slug` is the Basketball-Reference player id, so a vote joins to the NBA
# seasons without matching names. Three page types:
#
#   /awards/awards_<year>.html    one voting table per award
#   /awards/all_league.html       every All-NBA team, one row per team
#   /allstar/NBA_<year>.html      the All-Star rosters (no game in 1999)

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

OUT <- file.path(DATA_DIR, "award-voting.json")
BR <- "https://www.basketball-reference.com"
# Voting tables on the awards page, by table id. Not every award existed every
# year (MIP from 1985-86, Sixth Man from 1982-83); a missing table is skipped.
VOTING <- c(mvp = "mvp", mip = "mip", dpoy = "dpoy", roy = "roy", smoy = "smoy")

slug_of <- function(a) {
  href <- xml2::xml_attr(a, "href")
  ifelse(is.na(href), NA_character_, sub("^.*/players/[a-z]/([^.]+)\\.html$", "\\1", href))
}
player_links <- function(node) {
  a <- xml2::xml_find_all(node, ".//a[contains(@href,'/players/')]")
  unique(slug_of(a[grepl("/players/[a-z]/[^/]+\\.html$", xml2::xml_attr(a, "href"))]))
}
num_or_na <- function(s) suppressWarnings(as.numeric(gsub(",", "", s)))

fetch_voting <- function(year) {
  doc <- parse_html_uncommented(throttled_fetch(sprintf("%s/awards/awards_%d.html", BR, year)))
  out <- list()
  for (award in names(VOTING)) {
    table <- xml2::xml_find_first(doc, sprintf("//table[@id='%s']", VOTING[[award]]))
    if (inherits(table, "xml_missing")) next
    rows <- xml2::xml_find_all(table, ".//tbody/tr[not(contains(@class,'thead'))]")
    votes <- list()
    for (tr in rows) {
      a <- xml2::xml_find_first(tr, ".//*[@data-stat='player']//a")
      if (inherits(a, "xml_missing")) next
      votes[[length(votes) + 1]] <- list(
        slug = slug_of(a),
        name = cell_text(tr, c("player")),
        team = to_nba(cell_text(tr, c("team_id", "team_name_abbr"))),
        first = num_or_na(cell_text(tr, c("votes_first"))),
        points = num_or_na(cell_text(tr, c("points_won"))),
        max = num_or_na(cell_text(tr, c("points_max"))),
        share = num_or_na(cell_text(tr, c("award_share")))
      )
    }
    if (length(votes)) out[[award]] <- votes
  }
  if (is.null(out$mvp)) stop(sprintf("no MVP voting parsed for %d", year))
  out
}

# Every NBA All-NBA team, keyed by season: one row per team, its players as
# links. Fetched once for the whole range.
fetch_all_nba <- function() {
  doc <- parse_html_uncommented(throttled_fetch(sprintf("%s/awards/all_league.html", BR)))
  table <- xml2::xml_find_first(doc, "//table[@id='awards_all_league']")
  if (inherits(table, "xml_missing")) stop("no All-League table")
  out <- list()
  for (tr in xml2::xml_find_all(table, ".//tbody/tr[not(contains(@class,'thead'))]")) {
    if (cell_text(tr, c("lg_id")) != "NBA") next
    season <- cell_text(tr, c("season"))
    team <- cell_text(tr, c("all_team"))
    if (!grepl("^\\d{4}-\\d{2}$", season) || !team %in% c("1st", "2nd", "3rd")) next
    out[[season]][[team]] <- player_links(tr)
  }
  out
}

# The All-Star rosters: every player linked from the page's roster and box
# tables (the line score links no players). NULL for a year with no game.
fetch_all_star <- function(year) {
  html <- tryCatch(throttled_fetch(sprintf("%s/allstar/NBA_%d.html", BR, year)),
                   error = function(e) if (grepl("HTTP 404", conditionMessage(e))) NULL else stop(e))
  if (is.null(html)) return(NULL)
  doc <- parse_html_uncommented(html)
  tables <- xml2::xml_find_all(doc, "//div[@id='content']//table[not(contains(@id,'line_score'))]")
  players <- unique(unlist(lapply(tables, player_links)))
  players[!is.na(players)]
}

main <- function(years) {
  have <- if (file.exists(OUT)) jsonlite::fromJSON(OUT, simplifyVector = FALSE)$seasons else list()
  message("All-NBA teams ...")
  all_nba <- fetch_all_nba()
  for (y in years) {
    season <- make_season(y - 1L)
    message(sprintf("%s ...", season))
    entry <- list(voting = fetch_voting(y))
    if (!is.null(all_nba[[season]])) entry$allNba <- all_nba[[season]]
    stars <- fetch_all_star(y)
    if (length(stars)) {
      if (length(stars) < 20) stop(sprintf("only %d All-Stars parsed for %s", length(stars), season))
      entry$allStar <- stars
    }
    have[[season]] <- entry
    message(sprintf("  %s · All-NBA %d · All-Stars %d",
      paste(sprintf("%s %d", names(entry$voting), lengths(entry$voting)), collapse = ", "),
      length(unlist(entry$allNba)), length(entry$allStar)))
  }
  have <- have[order(names(have))]
  # No fetch timestamp: re-baking the same seasons must write the same bytes,
  # so a re-run (the workflow also fires on pushes to this script) commits
  # nothing.
  write_json_pretty(list(seasons = have, source = "basketball-reference.com"), OUT)
  message(sprintf("Wrote %d seasons -> %s", length(have), OUT))
}

if (sys.nframe() == 0L) {
  args <- commandArgs(trailingOnly = TRUE)
  args <- suppressWarnings(as.integer(args[!grepl("^--", args)]))
  if (!length(args) || any(is.na(args))) stop("Usage: Rscript fetch_award_voting.R <first-end-year> [last-end-year]")
  years <- if (length(args) >= 2) seq(args[1], args[2]) else args[1]
  tryCatch(main(years), error = function(e) {
    message("fetch_award_voting failed: ", conditionMessage(e))
    quit(status = 1)
  })
}
