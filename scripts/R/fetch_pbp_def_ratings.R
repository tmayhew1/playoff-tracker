#!/usr/bin/env Rscript
# Fetches ACTUAL on-court defensive ratings from stats.nba.com's play-by-play
# derived advanced stats (points allowed per 100 possessions while the player
# is on the floor — counted from real possessions, not estimated from box
# scores) and merges them into app/data/def-ratings.json alongside the
# basketball-reference DRtg estimates that fetch_def_ratings.R bakes:
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
#   Rscript scripts/R/fetch_pbp_def_ratings.R 1996-97 2025-26
#   Rscript scripts/R/fetch_pbp_def_ratings.R 2025-26 --force
#
# The app prefers the *Pbp keys and falls back to the box-score estimate, so
# modern players get their real floor impact (a rim-protector's blocks no
# longer flatter him beyond what opponents actually scored) while pre-1996-97
# seasons — before play-by-play tracking — keep the estimate. Team on-court
# ratings ride along because nba.com counts possessions while
# basketball-reference estimates them; the two scales sit ~1 pt/100 apart,
# and IND (player vs own team) must subtract like from like.
#
# nba.com names are joined to bbref slugs through the sibling season bakes
# (regular-season-<season>.json / leaderboard-<season>.json), the same join
# fetch_shooting_splits.R uses. Unmatched names are logged and skipped.
#
# Existing *Pbp entries are preserved unless --force is passed. A playoffs
# fetch that fails leaves poPbp absent for that season (non-fatal).

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

DEF_PATH <- file.path(DATA_DIR, "def-ratings.json")
FIRST_PBP_SEASON <- 1996L  # 1996-97: first season stats.nba.com has PBP-derived on-court ratings

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
  stop(sprintf("No PBP-era seasons in %s..%s (tracking starts 1996-97)", start_season, end_season))
}

# --- stats.nba.com fetch ----------------------------------------------------
# The API demands browser-shaped headers and hangs (rather than erroring) on
# requests it dislikes, so a hard timeout + a couple of retries is the whole
# strategy; a season that still fails is logged and skipped.
NBA_HEADERS <- httr::add_headers(
  "User-Agent" = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Referer" = "https://www.nba.com/",
  "Origin" = "https://www.nba.com",
  "Accept" = "application/json, text/plain, */*",
  "Accept-Language" = "en-US,en;q=0.9",
  "x-nba-stats-origin" = "stats",
  "x-nba-stats-token" = "true"
)

nba_fetch_json <- function(endpoint, params) {
  url <- paste0("https://stats.nba.com/stats/", endpoint)
  for (attempt in 1:3) {
    res <- tryCatch(
      httr::GET(url, NBA_HEADERS, query = params, httr::timeout(45)),
      error = function(e) e
    )
    if (!inherits(res, "error")) {
      st <- httr::status_code(res)
      if (st == 200) {
        return(jsonlite::fromJSON(httr::content(res, as = "text", encoding = "UTF-8"),
                                  simplifyVector = FALSE))
      }
      message(sprintf("  HTTP %d from %s (attempt %d)", st, endpoint, attempt))
    } else {
      message(sprintf("  %s fetching %s (attempt %d)", conditionMessage(res), endpoint, attempt))
    }
    Sys.sleep(5 * attempt)
  }
  stop(sprintf("stats.nba.com unreachable for %s after 3 attempts", endpoint))
}

# The full parameter set both leaguedash endpoints require (they 400 on
# omissions). Season/SeasonType are filled per call.
nba_params <- function(season, season_type, players = TRUE) {
  p <- list(
    Conference = "", DateFrom = "", DateTo = "", Division = "",
    GameScope = "", GameSegment = "", LastNGames = "0", LeagueID = "00",
    Location = "", MeasureType = "Advanced", Month = "0",
    OpponentTeamID = "0", Outcome = "", PORound = "0", PaceAdjust = "N",
    PerMode = "Totals", Period = "0", PlayerExperience = "",
    PlayerPosition = "", PlusMinus = "N", Rank = "N", Season = season,
    SeasonSegment = "", SeasonType = season_type, ShotClockRange = "",
    StarterBench = "", TeamID = "0", VsConference = "", VsDivision = ""
  )
  if (players) {
    p <- c(p, list(College = "", Country = "", DraftPick = "", DraftYear = "",
                   Height = "", Weight = ""))
  } else {
    p <- c(p, list(TwoWay = "0"))
  }
  p
}

# resultSets[[1]] as {headers, rows}; column indices resolved by name so a
# reordered payload can't silently shift DEF_RATING under another label.
result_table <- function(d) {
  rs <- d$resultSets[[1]]
  list(headers = unlist(rs$headers), rows = rs$rowSet)
}
col_idx <- function(headers, name) {
  i <- match(name, headers)
  if (is.na(i)) stop(sprintf("column %s missing (got: %s)", name, paste(headers, collapse = ",")))
  i
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
# Players: slug -> on-court DRTG (1 decimal). Tiny-minute samples are noise
# (a 5-minute stint can "allow" 150/100), so require a full game's worth.
MIN_MINUTES <- 25

fetch_players <- function(season, season_type, slugmap) {
  d <- nba_fetch_json("leaguedashplayerstats", nba_params(season, season_type, players = TRUE))
  t <- result_table(d)
  iName <- col_idx(t$headers, "PLAYER_NAME"); iMin <- col_idx(t$headers, "MIN")
  iDef <- col_idx(t$headers, "DEF_RATING")
  iTeamId <- col_idx(t$headers, "TEAM_ID"); iAbbr <- col_idx(t$headers, "TEAM_ABBREVIATION")
  out <- list(); unmatched <- 0; total_min <- 0; wsum <- 0
  team_abbr <- new.env(parent = emptyenv())  # TEAM_ID -> abbr, for the team join
  for (row in t$rows) {
    assign(as.character(row[[iTeamId]]), row[[iAbbr]] %||% "", envir = team_abbr)
    mins <- suppressWarnings(as.numeric(row[[iMin]] %||% 0))
    def  <- suppressWarnings(as.numeric(row[[iDef]] %||% NA))
    if (is.na(mins) || mins < MIN_MINUTES || is.na(def) || def <= 0) next
    nm <- norm_name(row[[iName]] %||% "")
    slug <- if (nzchar(nm) && exists(nm, envir = slugmap, inherits = FALSE)) {
      get(nm, envir = slugmap, inherits = FALSE)
    } else NA
    if (is.na(slug)) { unmatched <- unmatched + 1; next }
    out[[slug]] <- round(def, 1)
    total_min <- total_min + mins; wsum <- wsum + mins * def
  }
  list(map = out, unmatched = unmatched,
       wmean = if (total_min > 0) wsum / total_min else NA,
       team_abbr = team_abbr)
}

fetch_teams <- function(season, season_type, team_abbr) {
  d <- nba_fetch_json("leaguedashteamstats", nba_params(season, season_type, players = FALSE))
  t <- result_table(d)
  iTeamId <- col_idx(t$headers, "TEAM_ID"); iDef <- col_idx(t$headers, "DEF_RATING")
  out <- list()
  for (row in t$rows) {
    abbr <- if (exists(as.character(row[[iTeamId]]), envir = team_abbr, inherits = FALSE)) {
      get(as.character(row[[iTeamId]]), envir = team_abbr, inherits = FALSE)
    } else ""
    def <- suppressWarnings(as.numeric(row[[iDef]] %||% NA))
    if (!nzchar(abbr) || is.na(def) || def <= 0) next
    out[[abbr]] <- round(def, 1)
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
    entry <- existing[[season]] %||% list()
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
      message(sprintf("Fetching %s regular season (stats.nba.com)", season))
      rs <- fetch_players(season, "Regular Season", rs_slugs)
      # TEAM_ID -> abbr comes from the player payload; the team endpoint only
      # carries full names.
      team_abbr <- rs$team_abbr
      if (!pbp_plausible(rs, 250)) {
        stop(sprintf("implausible RS on-court set (%d rows, wmean %.1f); refusing to write",
                     length(rs$map), rs$wmean %||% NA))
      }
      team_rs <- fetch_teams(season, "Regular Season", team_abbr)
      if (length(team_rs) < 20) stop(sprintf("only %d RS team ratings joined", length(team_rs)))

      po <- tryCatch({
        po_slugs <- load_slug_map(season, "po")
        if (is.null(po_slugs)) stop("no playoff bake to join against")
        p <- fetch_players(season, "Playoffs", po_slugs)
        if (!pbp_plausible(p, 60)) stop(sprintf("only %d playoff rows", length(p$map)))
        team_po <- fetch_teams(season, "Playoffs", team_abbr)
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
    Sys.sleep(1.5)  # politeness between seasons
  }

  existing <- existing[order(names(existing))]
  write_json_pretty(existing, DEF_PATH)
  message(sprintf("Wrote %s (%d seasons; +%d new pbp, %d skipped, %d failed)",
                  DEF_PATH, length(existing), added, skipped, failed))
}

main()
