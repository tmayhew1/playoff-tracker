#!/usr/bin/env Rscript
# Fetches basketball-reference's per-100-possessions pages and extracts each
# player's individual Defensive Rating (DRtg — Dean Oliver's estimate of
# points allowed per 100 defensive possessions), merging into
# app/data/def-ratings.json:
#
#   { "<season>": { "rs": { "<slug>": <drtg>, ... },
#                   "po": { "<slug>": <drtg>, ... } }, ... }
#
#   Rscript scripts/R/fetch_def_ratings.R 1979-80 2025-26
#   Rscript scripts/R/fetch_def_ratings.R 2025-26 --force
#
# This powers the app's fifth "D Rating" category / VA+ metric: a player's
# defensive net rating (league DRtg − player DRtg) converted to points per
# game via the league's possessions-per-minute and the player's minutes.
# (The on/off ratings on stats.nba.com would be the other candidate source,
# but they only reach back to 1996-97 and the API is blocked from automated
# environments; BR's box-score-derived DRtg covers every indexed season and
# comes from the site the rest of the pipeline already scrapes.)
#
# Existing entries are preserved unless --force is passed. A playoffs page
# that 404s (or has no qualifying rows) leaves "po" absent for that season.

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

DEF_PATH <- file.path(DATA_DIR, "def-ratings.json")

args <- commandArgs(trailingOnly = TRUE)
force <- "--force" %in% args
positional <- args[!grepl("^--", args)]
if (length(positional) < 1 || length(positional) > 2) {
  stop("Usage: Rscript fetch_def_ratings.R <startSeason> [endSeason] [--force]")
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

# Locate the per-100-possessions table: by known ids first, then by a thead
# that carries a def_rtg column (BR renames table ids across eras).
find_per_poss_table <- function(doc) {
  for (id in c("per_poss_stats", "per_poss")) {
    t <- xml2::xml_find_first(doc, sprintf("//table[@id='%s']", id))
    if (!inherits(t, "xml_missing")) return(t)
  }
  for (t in xml2::xml_find_all(doc, "//table")) {
    head <- xml2::xml_find_first(t, ".//thead")
    if (inherits(head, "xml_missing")) next
    if (!inherits(xml2::xml_find_first(head, ".//*[@data-stat='def_rtg']"), "xml_missing")) return(t)
  }
  NULL
}

# One slug -> DRtg map from a per_poss page. Traded players appear as
# per-team rows plus a TOT aggregate listed first, so the first row per
# player href wins. Rows with no DRtg (BR leaves it blank under ~tiny
# minutes in some eras) are skipped.
parse_def_ratings <- function(url) {
  doc <- parse_html_uncommented(throttled_fetch(url))
  table <- find_per_poss_table(doc)
  if (is.null(table)) stop("per-poss table (def_rtg column) not found")
  seen <- new.env(parent = emptyenv())
  out <- list()
  for (tr in xml2::xml_find_all(table, ".//tbody/tr")) {
    cls <- xml2::xml_attr(tr, "class")
    if (!is.na(cls) && grepl("thead", cls)) next
    name <- cell_text(tr, c("player", "name_display", "name"))
    if (!nzchar(name) || grepl("league average", name, ignore.case = TRUE)) next
    href <- xml2::xml_attr(xml2::xml_find_first(tr, ".//a[contains(@href,'/players/')]"), "href")
    if (is.na(href)) next
    slug <- sub("\\.html$", "", basename(href))
    if (!is.null(seen[[slug]])) next
    seen[[slug]] <- TRUE
    drtg_txt <- cell_text(tr, "def_rtg")
    if (!nzchar(drtg_txt)) next
    drtg <- suppressWarnings(as.numeric(drtg_txt))
    if (is.na(drtg) || drtg <= 0) next
    out[[slug]] <- drtg
  }
  out
}

# Individual DRtg is anchored to real scoring levels, so the league median
# should sit in the same band team ratings do. Way outside means we parsed
# the wrong column or a broken table.
def_plausible <- function(m) {
  v <- unlist(m, use.names = FALSE)
  length(v) >= 30 && {
    med <- stats::median(v)
    med > 85 && med < 130
  }
}

load_def_ratings <- function() {
  if (!file.exists(DEF_PATH)) return(list())
  jsonlite::fromJSON(DEF_PATH, simplifyVector = FALSE)
}

main <- function() {
  existing <- load_def_ratings()
  seasons <- vapply(start_year:end_year, make_season, character(1))

  added <- 0; skipped <- 0; failed <- 0
  for (season in seasons) {
    entry <- existing[[season]]
    if (!is.null(entry$rs) && !force) {
      message(sprintf("  Skipping %s (already present; pass --force to overwrite)", season))
      skipped <- skipped + 1
      next
    }
    year_end <- season_end_year(season)
    # tryCatch RETURNS the entry (NULL on failure); assignment happens out
    # here in main's own scope. (`<<-` inside the expression would search
    # from the global env and miss main's locals — "object not found".)
    res <- tryCatch({
      rs_url <- sprintf("https://www.basketball-reference.com/leagues/NBA_%d_per_poss.html", year_end)
      message(sprintf("Fetching %s", rs_url))
      rs <- parse_def_ratings(rs_url)
      if (!def_plausible(rs)) {
        stop(sprintf("implausible regular-season DRtg set (%d rows); refusing to write", length(rs)))
      }
      po <- tryCatch({
        po_url <- sprintf("https://www.basketball-reference.com/playoffs/NBA_%d_per_poss.html", year_end)
        message(sprintf("Fetching %s", po_url))
        p <- parse_def_ratings(po_url)
        # Playoff fields are small; ~16 teams x ~9 rotation players.
        if (length(p) >= 30) p else NULL
      }, error = function(e) {
        message(sprintf("  (no playoff ratings for %s - %s)", season, conditionMessage(e)))
        NULL
      })
      entry <- list(rs = rs)
      if (!is.null(po)) entry$po <- po
      message(sprintf("  ok %s - %d rs players (median DRtg %.0f)%s",
                      season, length(rs), stats::median(unlist(rs)),
                      if (is.null(po)) "" else sprintf(", %d po players", length(po))))
      entry
    }, error = function(e) {
      message(sprintf("  x %s - %s", season, conditionMessage(e)))
      NULL
    })
    if (!is.null(res)) {
      existing[[season]] <- res
      added <- added + 1
    } else {
      failed <- failed + 1
    }
  }

  existing <- existing[order(names(existing))]
  write_json_pretty(existing, DEF_PATH)
  message(sprintf("Wrote %s (%d seasons; +%d new, %d skipped, %d failed)",
                  DEF_PATH, length(existing), added, skipped, failed))
}

main()
