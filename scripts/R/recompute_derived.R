#!/usr/bin/env Rscript
# Rebuilds every DERIVED number from the baked RAW data, no network needed:
#
#   1. league-averages.json — for each season with a regular-season-<season>.json,
#      the league rates are recomputed by summing that file's player totals.
#      (Those files are parsed from BR's player-totals page and verified
#      accurate; entries for seasons without a regular-season bake are left
#      untouched.)
#   2. leaderboard-<season>.json — each player's va/eff and each game's va are
#      recomputed from the file's own raw stats against the (possibly just
#      corrected) season baselines, and players are re-sorted by va.
#
# Exists because the historical baselines mixed two definitions across eras
# (aggregate means before 1996-97, per-player rates after), which made
# cross-era VA comparisons apples-to-oranges. The single definition now lives
# in scrape_common.R::lga_from_players (minutes-weighted MEDIAN per-minute
# rates; aggregate shooting ratios); running this after each daily bake keeps
# baselines and baked VA permanently consistent with the raw data.
#
#   Rscript scripts/R/recompute_derived.R
#
# Idempotent: a second run is a no-op.

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

rs_season_of <- function(f) sub("^regular-season-(.*)\\.json$", "\\1", f)
lb_season_of <- function(f) sub("^leaderboard-(.*)\\.json$", "\\1", f)

# --- 1. League averages from regular-season player sums ---------------------
rebuild_lga <- function() {
  existing <- load_league_averages()
  files <- list.files(DATA_DIR, pattern = "^regular-season-[0-9]{4}-[0-9]{2}\\.json$")
  changed <- 0
  for (f in files) {
    season <- rs_season_of(f)
    d <- jsonlite::fromJSON(file.path(DATA_DIR, f), simplifyVector = FALSE)
    lga <- lga_from_players(d$players)
    if (!lga_plausible(lga)) {
      message(sprintf("  !! %s: rebuilt laPTSperM=%.4f implausible - keeping old entry", season, lga$laPTSperM))
      next
    }
    old <- existing[[season]]
    old_rate <- if (!is.null(old)) old$laPTSperM else NA
    if (is.na(old_rate) || abs(old_rate - lga$laPTSperM) > 1e-12) {
      message(sprintf("  %s: laPTSperM %s -> %.4f", season,
                      if (is.na(old_rate)) "(none)" else sprintf("%.4f", old_rate), lga$laPTSperM))
      changed <- changed + 1
    }
    # zoneFG (shot-distance league averages) isn't derived here - it comes
    # from fetch_shooting_splits.R's own scrape - so carry it through rather
    # than dropping it on every rebuild.
    if (!is.null(old$zoneFG)) lga$zoneFG <- old$zoneFG
    existing[[season]] <- lga
  }
  existing <- existing[order(names(existing))]
  write_json_pretty(existing, LGA_PATH)
  message(sprintf("league-averages.json: %d season(s) updated (of %d rs files)", changed, length(files)))
  existing
}

# --- 2. Baked VA in the leaderboards ----------------------------------------
recompute_leaderboards <- function(lgas) {
  files <- list.files(DATA_DIR, pattern = "^leaderboard-[0-9]{4}-[0-9]{2}\\.json$")
  touched <- 0
  for (f in files) {
    season <- lb_season_of(f)
    lga <- lgas[[season]]
    if (!lga_plausible(lga)) {
      # No trustworthy baseline (e.g. seasons still waiting on a regular-season
      # bake) - leave the file for the daily backfill to re-bake properly.
      message(sprintf("  skip %s - no plausible baseline yet", season))
      next
    }
    path <- file.path(DATA_DIR, f)
    d <- jsonlite::fromJSON(path, simplifyVector = FALSE)
    before <- vapply(d$players, function(p) p$va %||% 0, numeric(1))
    d$players <- lapply(d$players, function(p) {
      vp <- value_add_parts(p, lga)
      p$va <- vp$va
      p$eff <- vp$efficiency
      p$games <- lapply(p$games, function(g) {
        # Sat-out placeholder rows keep va = NULL.
        if (is.null(g$va) || is.null(g$mp) || (g$mp %||% 0) <= 0) return(g)
        g$va <- value_add_parts(g, lga)$va
        g
      })
      p
    })
    d$players <- d$players[order(-vapply(d$players, function(p) p$va, numeric(1)))]
    after <- sort(vapply(d$players, function(p) p$va, numeric(1)), decreasing = TRUE)
    if (max(abs(sort(before, decreasing = TRUE) - after)) > 1e-9) {
      write_json_pretty(d, path)
      touched <- touched + 1
      message(sprintf("  %s: baked VA recomputed (top now %.1f)", season, after[1]))
    }
  }
  message(sprintf("leaderboards: %d file(s) rewritten (of %d)", touched, length(files)))
}

# --- 3. Team defensive context in def-ratings.json --------------------------
# For each season, aggregate the roster into per-team context the app's
# D-Rating composite needs:
#   drtg  — minutes-weighted mean of the members' individual DRtg (this
#           reconstructs the team's defensive rating: Oliver's player DRtg
#           is centered on the team's),
#   stlpm / blkpm — the team's steals and blocks per player-minute, kept
#           separate so the app can weight blocks by that season's
#           laDRBrate (the same valuation VA gives them: a block only ends
#           the possession when the defense rebounds it) when computing
#           each player's stock-rate share of the team's edge.
# "team" comes from the regular-season bake, "teamPo" from the playoff
# leaderboard roster. Derived data, no network; fetch_def_ratings.R only
# writes rs/po, so this pass (re)builds the team maps after every bake.
DEF_PATH <- file.path(DATA_DIR, "def-ratings.json")

def_team_map <- function(players, ratings) {
  acc <- list()
  for (p in players) {
    t <- as.character(p$team %||% "")
    mp <- as.numeric(p$mp %||% 0)
    # Multi-team aggregate rows (2TM/3TM/TOT) carry no single team context.
    if (!nzchar(t) || grepl("TM$", t) || t == "TOT" || mp <= 0) next
    a <- acc[[t]]
    if (is.null(a)) a <- c(0, 0, 0, 0, 0)  # drtg*mp, rated mp, stl, blk, all mp
    v <- ratings[[as.character(p$slug %||% "")]]
    if (!is.null(v)) { a[1] <- a[1] + as.numeric(v) * mp; a[2] <- a[2] + mp }
    a[3] <- a[3] + as.numeric(p$stl %||% 0)
    a[4] <- a[4] + as.numeric(p$blk %||% 0)
    a[5] <- a[5] + mp
    acc[[t]] <- a
  }
  out <- list()
  for (t in sort(names(acc))) {
    a <- acc[[t]]
    if (a[2] <= 0 || a[5] <= 0) next
    out[[t]] <- list(drtg = a[1] / a[2], stlpm = a[3] / a[5], blkpm = a[4] / a[5])
  }
  out
}

rebuild_def_teams <- function() {
  if (!file.exists(DEF_PATH)) {
    message("def-ratings.json not baked yet - skipping team maps")
    return(invisible())
  }
  defs <- jsonlite::fromJSON(DEF_PATH, simplifyVector = FALSE)
  touched <- 0
  for (season in names(defs)) {
    entry <- defs[[season]]
    rs_path <- file.path(DATA_DIR, sprintf("regular-season-%s.json", season))
    lb_path <- file.path(DATA_DIR, sprintf("leaderboard-%s.json", season))
    if (file.exists(rs_path) && !is.null(entry$rs)) {
      rs <- jsonlite::fromJSON(rs_path, simplifyVector = FALSE)
      entry$team <- def_team_map(rs$players, entry$rs)
      touched <- touched + 1
    }
    if (file.exists(lb_path) && !is.null(entry$po)) {
      lb <- jsonlite::fromJSON(lb_path, simplifyVector = FALSE)
      entry$teamPo <- def_team_map(lb$players, entry$po)
    }
    defs[[season]] <- entry
  }
  write_json_pretty(defs, DEF_PATH)
  message(sprintf("def-ratings.json: team context rebuilt for %d season(s)", touched))
}

main <- function() {
  message("Rebuilding league averages from regular-season bakes ...")
  lgas <- rebuild_lga()
  message("Recomputing baked leaderboard VA ...")
  recompute_leaderboards(lgas)
  message("Rebuilding team defensive context ...")
  rebuild_def_teams()
  message("Done.")
}

if (sys.nframe() == 0) main()
