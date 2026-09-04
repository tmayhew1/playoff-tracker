#!/usr/bin/env Rscript
# Fetches basketball-reference's team On/Off pages and extracts each player's
# ON-COURT defensive rating — the points his opponents actually scored per 100
# possessions while he was on the floor — merging them into
# app/data/def-ratings.json beside the two sources already there:
#
#   { "<season>": { "rs":        { "<slug>": <bbrefDrtgEstimate> },  (box score)
#                   "po":        { ... },                            (box score)
#                   "team":      { "<abbr>": {...} },                (box score)
#                   "teamPo":    { ... },                            (box score)
#                   "rsPbp":     { "<slug>": <onCourtDrtg> },        (pbpstats)
#                   "poPbp":     { ... },                            (pbpstats)
#                   "teamPbp":   { "<abbr>": <teamDrtg> },           (pbpstats)
#                   "teamPoPbp": { ... },                            (pbpstats)
#                   "rsOn":      { "<slug>": <onCourtDrtg> },        (this script)
#                   "poOn":      { ... },                            (this script)
#                   "teamOn":    { "<abbr>": <teamDrtg> },           (this script)
#                   "teamPoOn":  { ... } } }                         (this script)
#
#   Rscript scripts/R/fetch_onoff_def_ratings.R 1996-97 2025-26
#   Rscript scripts/R/fetch_onoff_def_ratings.R 2016-17 --force
#
# WHY A SECOND ON-COURT SOURCE
# fetch_pbp_def_ratings.R gets the same quantity from api.pbpstats.com, and
# where it succeeds its numbers are better: pbpstats COUNTS possessions from
# the play-by-play where basketball-reference ESTIMATES them from the box
# score, and DEF_EST_CAL in app/lib/defense.js was fitted against that counted
# scale. But pbpstats will not serve six regular seasons and seventeen
# postseasons at all — its get-totals endpoint answers those with a degraded
# ~15-column response instead of the full ~230, by request rather than by
# season, and four bake runs including one that spent 55 minutes on patient
# retries recovered two of them. This source covers those holes, reaches back
# to 1996-97 (five seasons past pbpstats), and lives on the host this pipeline
# already scrapes every day.
#
# The app prefers pbpstats per season and per scope, and takes these keys only
# where that source has nothing — see defRtgEntryFor in app/lib/defense.js.
# The choice is made for a whole season-scope rather than per player, because
# the IND term subtracts a player's rating from his own team's and the two
# scales sit ~1 pt/100 apart: mixing them inside one subtraction would push
# that gap straight into the number.
#
# WHERE THE NUMBERS COME FROM
# One page per team-season carries both tables — `on_off` for the regular
# season and `on_off_p` for the postseason — so the playoffs cost no extra
# request. In each, a player has three rows (On Court / Off Court / On - Off);
# the On Court row is the one that matters, and its Opponent-group `opp_off_rtg`
# IS points allowed per 100 possessions with him on the floor (Draymond Green
# 2015-16: 100.2 on, 112.9 off). Rows join by the /players/ href, so there is
# no name matching to lose anyone to.
#
# The team line is taken from those same rows rather than from a separate
# fetch, which keeps it on exactly the scale the player rows are on. Every
# defensive possession is faced by five players at once, so weighting each
# player's rating by the opponent possessions he faced — minutes times the
# opponent pace beside it — and dividing by the total reconstructs the team's
# rate: the factor of five cancels in the ratio.
#
# Traded players appear on both teams' pages; their possessions and points are
# summed before the rate is taken, so a baked number is the full-season rate.
#
# Existing entries are preserved unless --force is passed, and the two sides
# are asked for separately — a season is visited when either rsOn or poOn is
# missing, and each side is written the moment it lands.

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

DEF_PATH <- file.path(DATA_DIR, "def-ratings.json")
# 1996-97 is the first season basketball-reference has play-by-play for, and
# so the first with an on-off page at all.
FIRST_ONOFF_SEASON <- 1996L

args <- commandArgs(trailingOnly = TRUE)
force <- "--force" %in% args
positional <- args[!grepl("^--", args)]
if (length(positional) < 1 || length(positional) > 2) {
  stop("Usage: Rscript fetch_onoff_def_ratings.R <startSeason> [endSeason] [--force]")
}
start_season <- positional[1]
end_season   <- if (length(positional) >= 2) positional[2] else positional[1]
SEASON_RE <- "^[0-9]{4}-[0-9]{2}$"
for (s in c(start_season, end_season)) {
  if (!grepl(SEASON_RE, s)) stop(sprintf('Bad season "%s" - expected YYYY-YY', s))
}
start_year <- max(as.integer(substr(start_season, 1, 4)), FIRST_ONOFF_SEASON)
end_year   <- as.integer(substr(end_season, 1, 4))
if (end_year < start_year) {
  stop(sprintf("No on-off-era seasons in %s..%s (coverage starts 1996-97)",
               start_season, end_season))
}

# Tiny samples are noise (a five-minute stint can "allow" 150/100), so a
# player needs a full game's worth of floor time before a rating is baked.
MIN_MINUTES <- 25

ONOFF_URL <- "https://www.basketball-reference.com/teams/%s/%d/on-off/"

# --- which teams played a season -------------------------------------------
# Taken from the season's own bake rather than a hardcoded list, so the
# abbreviations are the ones the app will look these rows up by, and the
# relocations and renames (NJN/BRK, CHA/CHO, NOH/NOK) come out right for free.
season_teams <- function(season) {
  path <- file.path(DATA_DIR, sprintf("regular-season-%s.json", season))
  if (!file.exists(path)) return(NULL)
  d <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  players <- if (is.null(d$players)) list() else d$players
  ts <- character(0)
  for (p in players) {
    t <- as.character(if (is.null(p$team)) "" else p$team)
    # Multi-team aggregate rows carry no single team.
    if (!nzchar(t) || grepl("TM$", t) || t == "TOT") next
    ts <- c(ts, t)
  }
  sort(unique(ts))
}

# --- one on-off table -> slug -> c(possessions, possessions*rating, minutes) -
parse_onoff <- function(table) {
  out <- list()
  for (tr in xml2::xml_find_all(table, ".//tbody/tr")) {
    cls <- xml2::xml_attr(tr, "class")
    if (!is.na(cls) && grepl("thead", cls)) next
    # Of a player's three rows keep the On Court one. Matching on the prefix
    # and rejecting anything carrying "Off" takes both "Off Court" and the
    # "On - Off" difference row out, whichever dash BR is spelling it with.
    split <- cell_text(tr, "split_id")
    if (!grepl("^On", split) || grepl("Off", split)) next
    href <- xml2::xml_attr(xml2::xml_find_first(tr, ".//a[contains(@href,'/players/')]"), "href")
    if (is.na(href)) next
    slug <- sub("\\.html$", "", basename(href))
    mp   <- num(cell_text(tr, "mp"))
    rtg  <- num(cell_text(tr, "opp_off_rtg"))
    pace <- num(cell_text(tr, "opp_pace"))
    if (mp <= 0 || rtg <= 0) next
    # Pace is per 48 minutes, so this is the opponent possessions he was on
    # the floor for. A missing pace falls back to 100, which only affects how
    # this row is WEIGHTED against its team-mates, never its own rating.
    if (pace <= 0) pace <- 100
    poss <- mp * pace / 48
    prev <- out[[slug]]
    add <- c(poss, poss * rtg, mp)
    out[[slug]] <- if (is.null(prev)) add else prev + add
  }
  out
}

# Possession-weighted mean of a set of rows: the team's own rate when the rows
# are one team's, since each possession is faced by five players at once and
# the five cancels in the ratio.
rate_of <- function(rows) {
  poss <- 0; pts <- 0
  for (a in rows) { poss <- poss + a[1]; pts <- pts + a[2] }
  if (poss <= 0) NA else pts / poss
}

# Accumulated rows -> slug -> rating, dropping anyone under the minutes floor.
finalize_players <- function(acc) {
  out <- list(); wmp <- 0; wsum <- 0
  for (slug in names(acc)) {
    a <- acc[[slug]]
    if (a[3] < MIN_MINUTES || a[1] <= 0) next
    r <- a[2] / a[1]
    out[[slug]] <- round(r, 1)
    wmp <- wmp + a[3]; wsum <- wsum + a[3] * r
  }
  list(map = out, wmean = if (wmp > 0) wsum / wmp else NA)
}

# On-court ratings are anchored to real scoring, so the minutes-weighted league
# mean has to sit where points-per-100 actually lived. Outside the band means a
# parse or scale bug — refuse to write.
plausible <- function(res, min_rows) {
  length(res$map) >= min_rows && !is.na(res$wmean) && res$wmean > 95 && res$wmean < 125
}

merge_acc <- function(acc, rows) {
  for (slug in names(rows)) {
    prev <- acc[[slug]]
    acc[[slug]] <- if (is.null(prev)) rows[[slug]] else prev + rows[[slug]]
  }
  acc
}

load_def_ratings <- function() {
  if (!file.exists(DEF_PATH)) return(list())
  jsonlite::fromJSON(DEF_PATH, simplifyVector = FALSE)
}

# --- one season -------------------------------------------------------------
fetch_season <- function(season, year, want_rs, want_po) {
  teams <- season_teams(season)
  if (is.null(teams) || !length(teams)) {
    message(sprintf("  x %s - no regular-season-%s.json bake to take the team list from",
                    season, season))
    return(NULL)
  }
  rs_acc <- list(); po_acc <- list()
  rs_team <- list(); po_team <- list()
  pages <- 0; misses <- 0
  for (tm in teams) {
    html <- tryCatch(throttled_fetch(sprintf(ONOFF_URL, tm, year)), error = function(e) e)
    if (inherits(html, "error")) {
      message(sprintf("    %s %d - %s", tm, year, conditionMessage(html)))
      misses <- misses + 1
      next
    }
    doc <- parse_html_uncommented(html)
    pages <- pages + 1
    if (want_rs) {
      t <- xml2::xml_find_first(doc, "//table[@id='on_off']")
      if (!inherits(t, "xml_missing")) {
        rows <- parse_onoff(t)
        if (length(rows)) {
          rs_acc <- merge_acc(rs_acc, rows)
          r <- rate_of(rows)
          if (!is.na(r)) rs_team[[tm]] <- round(r, 1)
        }
      }
    }
    if (want_po) {
      # Only teams that played a postseason have this table; its absence is
      # the ordinary case for most of the league, not a failure.
      t <- xml2::xml_find_first(doc, "//table[@id='on_off_p']")
      if (!inherits(t, "xml_missing")) {
        rows <- parse_onoff(t)
        if (length(rows)) {
          po_acc <- merge_acc(po_acc, rows)
          r <- rate_of(rows)
          if (!is.na(r)) po_team[[tm]] <- round(r, 1)
        }
      }
    }
  }
  list(pages = pages, misses = misses,
       rs = finalize_players(rs_acc), rs_team = rs_team,
       po = finalize_players(po_acc), po_team = po_team)
}

main <- function() {
  existing <- load_def_ratings()
  seasons <- vapply(start_year:end_year, make_season, character(1))

  added <- 0; skipped <- 0; failed <- 0
  for (season in seasons) {
    year <- as.integer(substr(season, 1, 4)) + 1L
    # (Not %||%: is.na() on a multi-element season entry errors on R >= 4.3.)
    entry <- existing[[season]]
    if (is.null(entry)) entry <- list()

    need_rs <- force || is.null(entry$rsOn)
    need_po <- force || is.null(entry$poOn)
    if (!need_rs && !need_po) {
      message(sprintf("  Skipping %s (both sides present; pass --force to overwrite)", season))
      skipped <- skipped + 1
      next
    }
    message(sprintf("Fetching %s on-off (basketball-reference, %s%s)", season,
                    if (need_rs) "rs" else "", if (need_po) if (need_rs) "+po" else "po" else ""))

    res <- fetch_season(season, year, need_rs, need_po)
    if (is.null(res)) { failed <- failed + 1; next }

    got <- character(0)
    if (need_rs) {
      if (plausible(res$rs, 200) && length(res$rs_team) >= 20) {
        entry$rsOn <- res$rs$map
        entry$teamOn <- res$rs_team
        got <- c(got, sprintf("%d rs players (wmean %.1f), %d teams",
                              length(res$rs$map), res$rs$wmean, length(res$rs_team)))
      } else {
        message(sprintf("  x %s regular season - implausible set (%d players, wmean %.1f, %d teams)",
                        season, length(res$rs$map), res$rs$wmean, length(res$rs_team)))
      }
    }
    if (need_po) {
      if (plausible(res$po, 60) && length(res$po_team) >= 8) {
        entry$poOn <- res$po$map
        entry$teamPoOn <- res$po_team
        got <- c(got, sprintf("%d po players (wmean %.1f), %d teams",
                              length(res$po$map), res$po$wmean, length(res$po_team)))
      } else {
        message(sprintf("  (no playoff on-off for %s - %d players, wmean %.1f, %d teams)",
                        season, length(res$po$map), res$po$wmean, length(res$po_team)))
      }
    }

    if (length(got)) {
      existing[[season]] <- entry
      # Written as it lands: a full backfill is hundreds of throttled page
      # fetches, and a run that runs out of clock should keep the seasons it
      # already paid for rather than hand them back.
      write_json_pretty(existing[order(names(existing))], DEF_PATH)
      added <- added + 1
      message(sprintf("  ok %s - %s (%d pages, %d unreachable)",
                      season, paste(got, collapse = "; "), res$pages, res$misses))
    } else {
      failed <- failed + 1
    }
  }

  existing <- existing[order(names(existing))]
  write_json_pretty(existing, DEF_PATH)
  message(sprintf("Wrote %s (%d seasons; +%d new on-off, %d skipped, %d failed)",
                  DEF_PATH, length(existing), added, skipped, failed))
}

main()
