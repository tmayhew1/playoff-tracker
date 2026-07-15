#!/usr/bin/env Rscript
# Fetches basketball-reference's per-season "Shooting" pages (one row per
# qualifying player, league-wide — same shape as the totals/per-poss pages
# fetch_historical.R and fetch_def_ratings.R already parse) and extracts
# each player's 2-point shot distribution/accuracy across four distance
# zones: 0-3, 3-10, 10-16, and 16ft-to-the-3PT-line.
#
#   Rscript scripts/R/fetch_shooting_splits.R 1996-97 2025-26
#   Rscript scripts/R/fetch_shooting_splits.R 2025-26 --force
#
# Writes/merges:
#   app/data/shooting-<season>.json   { season, source, fetchedAt,
#                                        rs: { leagueAvg, players },
#                                        po: { leagueAvg, players } }
#     leagueAvg / each player: { z03: {fgm,fga}, z310: {...}, z1016: {...},
#                                 z16xp: {...} } — zone attempts are derived
#     from BR's "% of FGA by Distance" share of TOTAL field-goal attempts
#     (which is how BR itself defines that column: the six shares — 2P,
#     0-3, 3-10, 10-16, 16-3P, 3P — sum to 100% of ALL fga, not just 2PA),
#     so zoneFga = round(totalFga * pctOfFga) and zoneFgm =
#     round(zoneFga * zoneFgPct). Small rounding noise is expected and
#     tolerated the same way the rest of this pipeline tolerates it.
#   app/data/league-averages.json     season entry gains a "zoneFG" key
#                                      { z03, z310, z1016, z16xp } (RS rates,
#                                      matching how la2P/la3P are already
#                                      RS-baseline for both RS and playoff VA)
#
# Shot-location data on basketball-reference starts with the 1996-97 season;
# earlier seasons are skipped outright (no shooting-<season>.json is
# written). The app already has a precedent for a partial-coverage data
# source — def-ratings.json / the D-Rating category — and treats "no data
# for this season" as "hide the feature", not an error.
#
# The zone columns are resolved by their VISIBLE header text ("0-3", "3-10",
# ...) via scrape_common.R::header_leaf_labels()/cell_text_at(), NOT by
# data-stat attribute names — unlike simpler tables (totals, per-poss),
# this table's internal attribute names for grouped columns aren't
# documented anywhere this pipeline can verify against, while the visible
# labels are stable across BR's markup churn. A structural mismatch fails
# loudly (stop()) rather than silently writing zeros.
#
# Existing entries are preserved unless --force is passed, matching
# fetch_def_ratings.R's merge semantics.

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

SHOOTING_PATH_FOR <- function(season) file.path(DATA_DIR, sprintf("shooting-%s.json", season))
ZONE_KEYS <- c("z03", "z310", "z1016", "z16xp")
ZONE_LABELS <- c(z03 = "0-3", z310 = "3-10", z1016 = "10-16", z16xp = "16-3P")
FIRST_ZONE_YEAR <- 1997L  # season "1996-97" -> season_end_year 1997; BR has no shot-location data before this

args <- commandArgs(trailingOnly = TRUE)
force <- "--force" %in% args
positional <- args[!grepl("^--", args)]
if (length(positional) < 1 || length(positional) > 2) {
  stop("Usage: Rscript fetch_shooting_splits.R <startSeason> [endSeason] [--force]")
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

iso_now <- function() strftime(Sys.time(), "%Y-%m-%dT%H:%M:%OS3Z", tz = "UTC")

# Locate the leaguewide per-player shooting table: known id first, else any
# table whose resolved header carries both a "0-3" and a "10-16" leaf column
# (the two zone labels least likely to collide with anything else on the
# page).
find_shooting_table <- function(doc) {
  t <- xml2::xml_find_first(doc, "//table[@id='shooting_stats']")
  if (!inherits(t, "xml_missing")) return(t)
  for (t in xml2::xml_find_all(doc, "//table")) {
    labels <- norm_label(header_leaf_labels(t))
    if (any(startsWith(labels, "03")) && any(startsWith(labels, "1016"))) return(t)
  }
  NULL
}

# Column indices for the 4 zone pairs (share-of-FGA, FG%) plus total FGA,
# resolved from the header's visible text. BR lists "% of FGA by Distance"
# before "FG% by Distance", both with the same six sub-labels (2P, 0-3,
# 3-10, 10-16, 16-3P, 3P), so the FIRST occurrence of a zone label is the
# share column and the SECOND is the percentage column.
resolve_zone_cols <- function(table) {
  raw_labels <- header_leaf_labels(table)
  labels <- norm_label(raw_labels)
  if (Sys.getenv("SHOOTING_DEBUG_HEADERS", "") == "1") {
    message("  [debug] resolved header labels:")
    message("  ", paste(sprintf("%d:%s(%s)", seq_along(raw_labels), raw_labels, labels), collapse = " | "))
  }
  prefixes <- c(z03 = "03", z310 = "310", z1016 = "1016", z16xp = "163p")
  cols <- list()
  for (k in ZONE_KEYS) {
    hits <- which(startsWith(labels, prefixes[[k]]))
    if (length(hits) < 2) {
      stop(sprintf("expected 2 '%s' columns (share + FG%%), found %d", ZONE_LABELS[[k]], length(hits)))
    }
    cols[[k]] <- list(pct = hits[1], fgpct = hits[2])
  }
  fga_hits <- which(labels == "fga")
  if (length(fga_hits) < 1) stop("FGA column not found")
  cols$fga <- fga_hits[1]
  cols
}

# One player-season row per qualifying player from a shooting page. Traded
# players appear as per-team rows plus a TOT aggregate; keep the aggregate
# when one shows up (mirrors fetch_historical.R::fetch_regular_season_totals,
# which doesn't assume TOT is always listed first).
parse_shooting_page <- function(url) {
  doc <- parse_html_uncommented(throttled_fetch(url))
  table <- find_shooting_table(doc)
  if (is.null(table)) stop("shooting table not found")
  cols <- resolve_zone_cols(table)
  by_key <- list(); order_keys <- character(0)
  for (tr in xml2::xml_find_all(table, ".//tbody/tr")) {
    cls <- xml2::xml_attr(tr, "class")
    if (!is.na(cls) && grepl("thead", cls)) next
    name <- cell_text(tr, c("player", "name_display", "name"))
    if (!nzchar(name) || grepl("league average", name, ignore.case = TRUE)) next
    href <- xml2::xml_attr(xml2::xml_find_first(tr, ".//a[contains(@href,'/players/')]"), "href")
    slug <- if (!is.na(href)) sub("\\.html$", "", basename(href)) else NA_character_
    team <- cell_text(tr, c("team_id", "team_name_abbr", "team"))
    fga <- num(cell_text_at(tr, cols$fga))
    if (fga <= 0) next
    zones <- list()
    for (k in ZONE_KEYS) {
      pct <- num(cell_text_at(tr, cols[[k]]$pct))
      fgpct <- num(cell_text_at(tr, cols[[k]]$fgpct))
      zfga <- round(fga * pct)
      zones[[k]] <- list(fgm = round(zfga * fgpct), fga = zfga)
    }
    row <- c(list(slug = slug, name = name, team = to_nba(team)), zones)
    key <- if (!is.na(slug)) slug else name
    is_aggregate <- grepl("^(TOT|[0-9]TM)$", team)
    if (is.null(by_key[[key]])) { order_keys <- c(order_keys, key); by_key[[key]] <- row }
    else if (is_aggregate) by_key[[key]] <- row
  }
  unname(by_key[order_keys])
}

# Sum a set of player rows' zone makes/attempts into league-wide totals.
league_zone_totals <- function(players) {
  out <- list()
  for (k in ZONE_KEYS) {
    out[[k]] <- list(
      fgm = sum(vapply(players, function(p) p[[k]]$fgm, numeric(1))),
      fga = sum(vapply(players, function(p) p[[k]]$fga, numeric(1)))
    )
  }
  out
}
zone_rates_from_totals <- function(totals) {
  out <- list()
  for (k in ZONE_KEYS) out[[k]] <- if (totals[[k]]$fga > 0) totals[[k]]$fgm / totals[[k]]$fga else 0
  out
}

# Sanity band for league-wide zone FG%: layups/dunks (0-3) run hot, then
# accuracy drops and flattens through mid-range. Values far outside this
# band mean the wrong columns were parsed — refuse to write.
zone_plausible <- function(rates, n_players) {
  n_players >= 100 &&
    rates$z03   > 0.50 && rates$z03   < 0.75 &&
    rates$z310  > 0.25 && rates$z310  < 0.48 &&
    rates$z1016 > 0.28 && rates$z1016 < 0.48 &&
    rates$z16xp > 0.28 && rates$z16xp < 0.48
}

load_shooting <- function(season) {
  p <- SHOOTING_PATH_FOR(season)
  if (!file.exists(p)) return(NULL)
  jsonlite::fromJSON(p, simplifyVector = FALSE)
}

main <- function() {
  lga_all <- load_league_averages()
  seasons <- vapply(start_year:end_year, make_season, character(1))

  added <- 0; skipped <- 0; failed <- 0
  for (season in seasons) {
    year_end <- season_end_year(season)
    if (year_end < FIRST_ZONE_YEAR) {
      message(sprintf("  Skipping %s (before 1996-97 - no shot-location data on BR)", season))
      skipped <- skipped + 1
      next
    }
    if (!is.null(load_shooting(season)) && !force) {
      message(sprintf("  Skipping %s (already present; pass --force to overwrite)", season))
      skipped <- skipped + 1
      next
    }

    res <- tryCatch({
      rs_url <- sprintf("https://www.basketball-reference.com/leagues/NBA_%d_shooting.html", year_end)
      message(sprintf("Fetching %s", rs_url))
      rs_players <- parse_shooting_page(rs_url)
      rs_totals <- league_zone_totals(rs_players)
      rs_rates <- zone_rates_from_totals(rs_totals)
      if (!zone_plausible(rs_rates, length(rs_players))) {
        stop(sprintf(
          "implausible RS zone rates (%d rows, 0-3=%.3f 3-10=%.3f 10-16=%.3f 16-3P=%.3f); refusing to write",
          length(rs_players), rs_rates$z03, rs_rates$z310, rs_rates$z1016, rs_rates$z16xp))
      }
      po_players <- tryCatch({
        po_url <- sprintf("https://www.basketball-reference.com/playoffs/NBA_%d_shooting.html", year_end)
        message(sprintf("Fetching %s", po_url))
        p <- parse_shooting_page(po_url)
        if (length(p) >= 30) p else NULL
      }, error = function(e) {
        message(sprintf("  (no playoff shooting splits for %s - %s)", season, conditionMessage(e)))
        NULL
      })
      list(rs = rs_players, rsTotals = rs_totals, rsRates = rs_rates, po = po_players)
    }, error = function(e) {
      message(sprintf("  x %s - %s", season, conditionMessage(e)))
      NULL
    })
    if (is.null(res)) { failed <- failed + 1; next }

    out <- list(season = season, source = "basketball-reference", fetchedAt = iso_now(),
                rs = list(leagueAvg = res$rsTotals, players = res$rs))
    if (!is.null(res$po)) {
      out$po <- list(leagueAvg = league_zone_totals(res$po), players = res$po)
    }
    write_json_pretty(out, SHOOTING_PATH_FOR(season))
    message(sprintf("  ok %s - %d rs players%s -> %s", season, length(res$rs),
                    if (is.null(res$po)) "" else sprintf(", %d po players", length(res$po)),
                    SHOOTING_PATH_FOR(season)))

    entry <- lga_all[[season]]
    if (!is.null(entry)) {
      entry$zoneFG <- res$rsRates
      lga_all[[season]] <- entry
    } else {
      message(sprintf("  (no league-averages entry for %s yet - zoneFG not merged; run fetch_league_averages.R first)", season))
    }
    added <- added + 1
  }

  lga_all <- lga_all[order(names(lga_all))]
  write_json_pretty(lga_all, LGA_PATH)
  message(sprintf("Done. +%d new, %d skipped, %d failed. Updated %s", added, skipped, failed, LGA_PATH))
}

main()
