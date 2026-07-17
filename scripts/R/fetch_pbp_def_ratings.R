#!/usr/bin/env Rscript
# Fetches ACTUAL on-court defensive ratings — points allowed per 100
# possessions while the player is on the floor, counted from play-by-play
# rather than estimated from box scores — and merges them into
# app/data/def-ratings.json alongside the basketball-reference DRtg
# estimates that fetch_def_ratings.R bakes:
#
#   { "<season>": { "rs":       { "<slug>": <bbrefDrtg>, ... },   (existing)
#                   "po":       { ... },                          (existing)
#                   "team":     { "<abbr>": {...} },              (existing)
#                   "teamPo":   { ... },                          (existing)
#                   "rsPbp":    { "<slug>": <onCourtDrtg>, ... }, (this script)
#                   "poPbp":    { ... },                          (this script)
#                   "teamPbp":  { "<abbr>": <teamDrtg>, ... },    (this script)
#                   "teamPoPbp": { ... } } }                      (this script)
#
#   Rscript scripts/R/fetch_pbp_def_ratings.R 2000-01 2025-26
#   Rscript scripts/R/fetch_pbp_def_ratings.R 2025-26 --force
#
# Source: api.pbpstats.com (public play-by-play API; stats.nba.com would be
# the obvious source but hangs every request from automated environments —
# a full CI run produced nothing but 45s timeouts, see bake run #2's log).
# pbpstats' NBA play-by-play coverage starts 2000-01, so 1996-2000 stays on
# the box-score estimate; the app falls back per player-season anyway.
#
# The app prefers the *Pbp keys, so modern players get their real floor
# impact (a rim-protector's blocks no longer flatter him beyond what
# opponents actually scored), while earlier seasons keep the estimate.
# Team on-court ratings ride along because counted and estimated
# possessions sit ~1 pt/100 apart, and IND (player vs own team) must
# subtract like from like.
#
# pbpstats names are joined to bbref slugs through the sibling season bakes
# (regular-season-<season>.json / leaderboard-<season>.json), the same join
# fetch_shooting_splits.R uses. Unmatched names are logged and skipped.
# Traded players appear once per team; their opponent-points and defensive
# possessions are summed before the rating is taken, so the baked number is
# the full-season on-court rate.
#
# Existing *Pbp entries are preserved unless --force is passed. A playoffs
# fetch that fails leaves poPbp absent for that season (non-fatal).

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

DEF_PATH <- file.path(DATA_DIR, "def-ratings.json")
FIRST_PBP_SEASON <- 2000L  # 2000-01: first season of pbpstats NBA coverage

args <- commandArgs(trailingOnly = TRUE)
force <- "--force" %in% args
positional <- args[!grepl("^--", args)]
if (length(positional) < 1 || length(positional) > 2) {
  stop("Usage: Rscript fetch_pbp_def_ratings.R <startSeason> [endSeason] [--force]")
}
start_season <- positional[1]
end_season   <- if (length(positional) >= 2) positional[2] else positional[1]
SEASON_RE <- "^[0-9]{4}-[0-9]{2}$"
for (s in c(start_season, end_season)) {
  if (!grepl(SEASON_RE, s)) stop(sprintf('Bad season "%s" - expected YYYY-YY', s))
}
start_year <- max(as.integer(substr(start_season, 1, 4)), FIRST_PBP_SEASON)
end_year   <- as.integer(substr(end_season, 1, 4))
if (end_year < start_year) {
  stop(sprintf("No PBP-era seasons in %s..%s (pbpstats coverage starts 2000-01)",
               start_season, end_season))
}

# --- api.pbpstats.com fetch -------------------------------------------------
pbp_fetch_json <- function(params) {
  url <- "https://api.pbpstats.com/get-totals/nba"
  for (attempt in 1:3) {
    res <- tryCatch(
      httr::GET(url, query = params, httr::timeout(60),
                httr::user_agent(UA), httr::add_headers(Accept = "application/json")),
      error = function(e) e
    )
    if (!inherits(res, "error")) {
      st <- httr::status_code(res)
      if (st == 200) {
        return(jsonlite::fromJSON(httr::content(res, as = "text", encoding = "UTF-8"),
                                  simplifyVector = FALSE))
      }
      message(sprintf("  HTTP %d from pbpstats (attempt %d)", st, attempt))
    } else {
      message(sprintf("  %s fetching pbpstats (attempt %d)", conditionMessage(res), attempt))
    }
    Sys.sleep(10 * attempt)
  }
  stop("api.pbpstats.com unreachable after 3 attempts")
}

# First value among candidate keys; the miss error carries the row's actual
# keys so a schema drift is diagnosable straight from the CI log.
pick <- function(row, candidates, required = TRUE) {
  for (k in candidates) {
    v <- row[[k]]
    if (!is.null(v)) return(v)
  }
  if (required) {
    stop(sprintf("none of [%s] present; row keys: %s",
                 paste(candidates, collapse = ", "),
                 paste(sort(names(row)), collapse = ",")))
  }
  NULL
}

rows_of <- function(d) {
  rows <- d$multi_row_table_data
  if (is.null(rows)) {
    stop(sprintf("no multi_row_table_data in response; top-level keys: %s",
                 paste(sort(names(d)), collapse = ",")))
  }
  rows
}

# --- slug join (same sibling-bake join as fetch_shooting_splits.R) ---------
norm_name <- function(s) {
  s <- tryCatch(iconv(s, to = "ASCII//TRANSLIT"), error = function(e) s, warning = function(w) s)
  tolower(trimws(gsub("[^a-zA-Z0-9]+", " ", s %||% "")))
}

load_slug_map <- function(season, scope) {
  path <- file.path(DATA_DIR, if (scope == "po") sprintf("leaderboard-%s.json", season)
                               else sprintf("regular-season-%s.json", season))
  if (!file.exists(path)) return(NULL)
  d <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  by_name <- new.env(parent = emptyenv())
  for (p in (if (is.null(d$players)) list() else d$players)) {
    slug <- p$slug
    if (is.null(slug) || is.na(slug) || !nzchar(slug)) next
    nm <- norm_name(p$name %||% "")
    if (nzchar(nm) && !exists(nm, envir = by_name, inherits = FALSE)) assign(nm, slug, envir = by_name)
  }
  by_name
}

# --- per-scope fetch+join ---------------------------------------------------
# Tiny-minute samples are noise (a 5-minute stint can "allow" 150/100), so
# require a full game's worth before a rating is baked.
MIN_MINUTES <- 25

num_of <- function(v) suppressWarnings(as.numeric(v %||% NA))

# Players: slug -> on-court DRTG (1 decimal). pbpstats splits traded players
# into one row per team, so opponent points and defensive possessions are
# accumulated per normalized name first and the rating taken from the sums.
fetch_players <- function(season, season_type, slugmap) {
  d <- pbp_fetch_json(list(Season = season, SeasonType = season_type, Type = "Player"))
  acc <- new.env(parent = emptyenv())  # norm name -> c(opp, poss, min)
  for (row in rows_of(d)) {
    nm <- norm_name(pick(row, c("Name", "EntityName", "PlayerName")) %||% "")
    if (!nzchar(nm)) next
    poss <- num_of(pick(row, c("DefPoss", "TotalPoss"), required = TRUE))
    opp  <- num_of(pick(row, c("OpponentPoints", "PtsAllowed", "OppPts"), required = TRUE))
    mins <- num_of(pick(row, c("Minutes", "SecondsPlayed"), required = FALSE) %||% 0)
    if (is.na(poss) || poss <= 0 || is.na(opp) || opp < 0) next
    prev <- if (exists(nm, envir = acc, inherits = FALSE)) get(nm, envir = acc, inherits = FALSE) else c(0, 0, 0)
    assign(nm, prev + c(opp, poss, if (is.na(mins)) 0 else mins), envir = acc)
  }
  out <- list(); unmatched <- 0; total_min <- 0; wsum <- 0
  for (nm in ls(acc)) {
    v <- get(nm, envir = acc, inherits = FALSE)
    if (v[3] < MIN_MINUTES) next
    drtg <- 100 * v[1] / v[2]
    if (!exists(nm, envir = slugmap, inherits = FALSE)) { unmatched <- unmatched + 1; next }
    out[[get(nm, envir = slugmap, inherits = FALSE)]] <- round(drtg, 1)
    total_min <- total_min + v[3]; wsum <- wsum + v[3] * drtg
  }
  list(map = out, unmatched = unmatched,
       wmean = if (total_min > 0) wsum / total_min else NA)
}

# Teams: abbr -> on-court DRTG. Team rows carry their own abbreviation.
fetch_teams <- function(season, season_type) {
  d <- pbp_fetch_json(list(Season = season, SeasonType = season_type, Type = "Team"))
  out <- list()
  for (row in rows_of(d)) {
    abbr <- pick(row, c("TeamAbbreviation", "Abbreviation", "Name"), required = TRUE)
    poss <- num_of(pick(row, c("DefPoss", "TotalPoss"), required = TRUE))
    opp  <- num_of(pick(row, c("OpponentPoints", "PtsAllowed", "OppPts"), required = TRUE))
    if (is.null(abbr) || !nzchar(abbr) || nchar(abbr) > 3 || is.na(poss) || poss <= 0 || is.na(opp)) next
    out[[abbr]] <- round(100 * opp / poss, 1)
  }
  out
}

# On-court ratings are anchored to real scoring, so the minutes-weighted
# league mean must sit where points-per-100 actually lived. Outside the band
# means a parse/scale bug — refuse to write.
pbp_plausible <- function(res, min_rows) {
  length(res$map) >= min_rows && !is.na(res$wmean) && res$wmean > 95 && res$wmean < 125
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
    # (Not %||%: is.na() on a multi-element season entry errors on R >= 4.3.)
    entry <- existing[[season]]
    if (is.null(entry)) entry <- list()
    if (!is.null(entry$rsPbp) && !force) {
      message(sprintf("  Skipping %s (rsPbp already present; pass --force to overwrite)", season))
      skipped <- skipped + 1
      next
    }
    rs_slugs <- load_slug_map(season, "rs")
    if (is.null(rs_slugs)) {
      message(sprintf("  x %s - no regular-season-%s.json bake to join against", season, season))
      failed <- failed + 1
      next
    }
    res <- tryCatch({
      message(sprintf("Fetching %s regular season (api.pbpstats.com)", season))
      rs <- fetch_players(season, "Regular Season", rs_slugs)
      if (!pbp_plausible(rs, 250)) {
        stop(sprintf("implausible RS on-court set (%d rows, wmean %.1f); refusing to write",
                     length(rs$map), rs$wmean))
      }
      team_rs <- fetch_teams(season, "Regular Season")
      if (length(team_rs) < 20) stop(sprintf("only %d RS team ratings", length(team_rs)))

      po <- tryCatch({
        po_slugs <- load_slug_map(season, "po")
        if (is.null(po_slugs)) stop("no playoff bake to join against")
        p <- fetch_players(season, "Playoffs", po_slugs)
        if (!pbp_plausible(p, 60)) stop(sprintf("only %d playoff rows", length(p$map)))
        team_po <- fetch_teams(season, "Playoffs")
        list(players = p, teams = team_po)
      }, error = function(e) {
        message(sprintf("  (no playoff on-court ratings for %s - %s)", season, conditionMessage(e)))
        NULL
      })

      entry$rsPbp <- rs$map
      entry$teamPbp <- team_rs
      if (!is.null(po)) {
        entry$poPbp <- po$players$map
        if (length(po$teams) >= 8) entry$teamPoPbp <- po$teams
      }
      message(sprintf("  ok %s - %d rs players (wmean %.1f, %d unjoined), %d teams%s",
                      season, length(rs$map), rs$wmean, rs$unmatched, length(team_rs),
                      if (is.null(po)) "" else sprintf(", %d po players", length(po$players$map))))
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
    Sys.sleep(2)  # politeness between seasons
  }

  existing <- existing[order(names(existing))]
  write_json_pretty(existing, DEF_PATH)
  message(sprintf("Wrote %s (%d seasons; +%d new pbp, %d skipped, %d failed)",
                  DEF_PATH, length(existing), added, skipped, failed))
}

main()
