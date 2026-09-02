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
# Existing *Pbp entries are preserved unless --force is passed, and the two
# sides are asked for separately: a season is fetched if EITHER rsPbp or
# poPbp is missing, and each side has its own error handler, so a postseason
# that failed is retried on the next run without disturbing a regular season
# that already landed. A playoffs fetch that fails leaves poPbp absent for
# that season (non-fatal) and the regular season is still written.

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
    stop(sprintf("none of [%s] present; %d columns: %s",
                 paste(candidates, collapse = ", "), length(names(row)),
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

# pbpstats' get-totals answers in one of two shapes, and which one you get
# varies BY REQUEST, not by season. A good answer carries ~230 columns
# (236 for a regular season, 221 for a postseason); a bad one carries ~15 —
# DefPoss, OffPoss, TotalPoss, the Penalty family, and the row's identity.
# So the failure is not "OpponentPoints went missing", it is a degraded
# response that omits nine tenths of everything, which reads like a
# server-side aggregation that hasn't finished computing.
#
# Two theories have been tested and are dead. It is not per-season: probe
# round 3 asked for 2005-06 eighteen times and got 236 columns eighteen
# times, seven minutes after a bake had failed the identical query four
# times. And it is not the response cache: plain and cache-busted URLs
# succeeded six for six each in that same round, so run #6's CacheBust was
# neither the cause of the failures nor a cure for them.
#
# What is left is patience. Retry the plain URL — the honest request, and
# the one that can be served from a warm cache — with a backoff long enough
# for a computation to finish rather than the 6/12/18s that only ever
# re-asked a busy server three times in half a minute. A run that still
# misses is no longer stuck either: main() asks per side and per run, so
# the daily backfill retries whatever is outstanding the next day, and
# coverage converges over a few days instead of hanging on one lucky pass.
#
# The final error carries the column COUNT as well as the row keys, because
# the count is what separates a degraded response (~15) from a genuine
# schema change (~230 with a renamed field).

PARSE_BACKOFF <- c(20, 45, 90)  # seconds between attempts; length + 1 = tries

fetch_parsed <- function(params, parse_fn) {
  err <- NULL
  tries <- length(PARSE_BACKOFF) + 1
  for (attempt in seq_len(tries)) {
    d <- pbp_fetch_json(params)
    out <- tryCatch(parse_fn(d), error = function(e) e)
    if (!inherits(out, "error")) return(out)
    err <- out
    if (attempt == tries) break
    message(sprintf("  degraded response (attempt %d/%d), waiting %ds",
                    attempt, tries, PARSE_BACKOFF[attempt]))
    Sys.sleep(PARSE_BACKOFF[attempt])
  }
  stop(conditionMessage(err))
}

# Players: slug -> on-court DRTG (1 decimal). pbpstats splits traded players
# into one row per team, so opponent points and defensive possessions are
# accumulated per normalized name first and the rating taken from the sums.
fetch_players <- function(season, season_type, slugmap) {
  fetch_parsed(list(Season = season, SeasonType = season_type, Type = "Player"),
               function(d) parse_players(d, slugmap))
}

parse_players <- function(d, slugmap) {
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
  fetch_parsed(list(Season = season, SeasonType = season_type, Type = "Team"), parse_teams)
}

parse_teams <- function(d) {
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

    # The two sides are fetched independently, and that is the point. The
    # skip used to test rsPbp alone and the playoff fetch used to sit inside
    # the regular season's error handler, so a postseason could only ever be
    # attempted on the run that first landed its regular season: nineteen of
    # twenty-six sat unfetched behind a regular season that had already
    # succeeded, and the six seasons whose regular season failed lost their
    # playoffs to the same error without either being tried. Neither could be
    # retried except under a --force that also refetched the twenty seasons
    # already sitting there. Now each side asks for itself.
    need_rs <- force || is.null(entry$rsPbp)
    need_po <- force || is.null(entry$poPbp)
    if (!need_rs && !need_po) {
      message(sprintf("  Skipping %s (both sides present; pass --force to overwrite)", season))
      skipped <- skipped + 1
      next
    }

    got <- character(0); lost <- character(0)

    if (need_rs) {
      rs_res <- tryCatch({
        message(sprintf("Fetching %s regular season (api.pbpstats.com)", season))
        slugs <- load_slug_map(season, "rs")
        if (is.null(slugs)) stop(sprintf("no regular-season-%s.json bake to join against", season))
        rs <- fetch_players(season, "Regular Season", slugs)
        if (!pbp_plausible(rs, 250)) {
          stop(sprintf("implausible RS on-court set (%d rows, wmean %.1f); refusing to write",
                       length(rs$map), rs$wmean))
        }
        team_rs <- fetch_teams(season, "Regular Season")
        if (length(team_rs) < 20) stop(sprintf("only %d RS team ratings", length(team_rs)))
        list(players = rs, teams = team_rs)
      }, error = function(e) {
        message(sprintf("  x %s regular season - %s", season, conditionMessage(e)))
        NULL
      })
      if (is.null(rs_res)) {
        lost <- c(lost, "rs")
      } else {
        entry$rsPbp <- rs_res$players$map
        entry$teamPbp <- rs_res$teams
        got <- c(got, sprintf("%d rs players (wmean %.1f, %d unjoined), %d teams",
                              length(rs_res$players$map), rs_res$players$wmean,
                              rs_res$players$unmatched, length(rs_res$teams)))
      }
    }

    if (need_po) {
      po_res <- tryCatch({
        message(sprintf("Fetching %s playoffs (api.pbpstats.com)", season))
        slugs <- load_slug_map(season, "po")
        if (is.null(slugs)) stop(sprintf("no leaderboard-%s.json bake to join against", season))
        p <- fetch_players(season, "Playoffs", slugs)
        # Report both numbers: the gate gets tripped by an implausible mean as
        # readily as by a thin row count, and a message naming only the rows
        # sent an earlier diagnosis after the wrong cause.
        if (!pbp_plausible(p, 60)) {
          stop(sprintf("implausible PO on-court set (%d rows, wmean %.1f); refusing to write",
                       length(p$map), p$wmean))
        }
        list(players = p, teams = fetch_teams(season, "Playoffs"))
      }, error = function(e) {
        message(sprintf("  (no playoff on-court ratings for %s - %s)", season, conditionMessage(e)))
        NULL
      })
      if (is.null(po_res)) {
        lost <- c(lost, "po")
      } else {
        entry$poPbp <- po_res$players$map
        if (length(po_res$teams) >= 8) entry$teamPoPbp <- po_res$teams
        got <- c(got, sprintf("%d po players (wmean %.1f, %d unjoined), %d teams",
                              length(po_res$players$map), po_res$players$wmean,
                              po_res$players$unmatched, length(po_res$teams)))
      }
    }

    # A season counts as added when EITHER side landed, and as failed only
    # when everything it asked for missed — a regular season that arrives
    # beside a postseason that doesn't is progress, and is written.
    if (length(got)) {
      existing[[season]] <- entry
      added <- added + 1
      message(sprintf("  ok %s - %s%s", season, paste(got, collapse = "; "),
                      if (length(lost)) sprintf(" (%s still missing)", paste(lost, collapse = "+")) else ""))
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
