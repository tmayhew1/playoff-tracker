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
# Exists because a mis-parsed team-totals table once poisoned the 1996-97..
# 2025-26 baselines (inflated minutes -> every per-minute rate ~12-19% low),
# which also inflated every baked VA for those seasons. Running this after
# each daily bake keeps baselines and baked VA permanently consistent with
# the raw data.
#
#   Rscript scripts/R/recompute_derived.R
#
# Idempotent: a second run is a no-op.

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

STAT_KEYS <- c("mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb",
               "fgm", "fga", "tpm", "tpa", "ftm", "fta")

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
    totals <- setNames(as.list(rep(0, length(STAT_KEYS))), STAT_KEYS)
    for (p in d$players) {
      for (k in STAT_KEYS) totals[[k]] <- totals[[k]] + (p[[k]] %||% 0)
    }
    lga <- lga_from_totals(totals)
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

main <- function() {
  message("Rebuilding league averages from regular-season bakes ...")
  lgas <- rebuild_lga()
  message("Recomputing baked leaderboard VA ...")
  recompute_leaderboards(lgas)
  message("Done.")
}

if (sys.nframe() == 0) main()
