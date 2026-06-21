#!/usr/bin/env Rscript
# Bakes one season's playoff data into static JSON, scraping
# basketball-reference.com (full coverage back to 1949-50, no API key).
#
#   Rscript scripts/R/fetch_historical.R 2014-15
#
# Writes:
#   app/data/history-<season>.json      (rounds -> series -> games)
#   app/data/leaderboard-<season>.json  (per-player playoff aggregates)
#   app/data/regular-season-<season>.json (per-game VA reference, best-effort)
#
# Port of the retired scripts/fetch-historical.mjs. The JSON shape is the
# integration contract the app's bake-first API routes depend on.

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

iso_now <- function() strftime(Sys.time(), "%Y-%m-%dT%H:%M:%OS3Z", tz = "UTC")

# --- Step 1: playoff game URLs from the season's playoff page --------------
fetch_playoff_game_urls <- function(end_year) {
  url <- sprintf("https://www.basketball-reference.com/playoffs/NBA_%d.html", end_year)
  message(sprintf("Fetching %s", url))
  doc <- parse_html_uncommented(throttled_fetch(url))
  # Box-score links live in the main HTML and inside commented-out blocks BR
  # uses to lazy-render tables; un-commenting (above) surfaces both.
  hrefs <- xml2::xml_attr(xml2::xml_find_all(doc, "//a[@href]"), "href")
  box <- unique(hrefs[grepl("^/boxscores/[0-9]{8}0[A-Z]{3}\\.html$", hrefs)])
  paste0("https://www.basketball-reference.com", box)
}

# --- Step 2: fetch + parse one box score ----------------------------------
parse_date_from_box_id <- function(box_id) {
  sprintf("%s-%s-%s", substr(box_id, 1, 4), substr(box_id, 5, 6), substr(box_id, 7, 8))
}

slug_from_href <- function(href) {
  if (is.na(href)) return(NA_character_)
  m <- regmatches(href, regexec("/players/[a-z]/([^.]+)\\.html", href))[[1]]
  if (length(m) >= 2) m[2] else NA_character_
}

# Parse one team's basic box-score table node into a team record: the team's
# final score (from the table's "Team Totals" tfoot row) plus its player rows.
parse_team_table <- function(t, tri) {
  players <- list()
  for (tr in xml2::xml_find_all(t, ".//tbody/tr")) {
    cls <- xml2::xml_attr(tr, "class")
    if (!is.na(cls) && grepl("thead", cls)) next
    player_cell <- xml2::xml_find_first(tr, ".//th[@data-stat='player']")
    name <- xml2::xml_text(player_cell)
    if (is.na(name)) next
    name <- trimws(name)
    if (!nzchar(name)) next
    # DNP rows carry a "reason" cell instead of stats.
    if (nzchar(cell_text(tr, "reason"))) next
    mp <- parse_minutes(cell_text(tr, "mp"))
    if (mp <= 0) next
    href <- xml2::xml_attr(xml2::xml_find_first(player_cell, ".//a"), "href")
    players[[length(players) + 1]] <- list(
      name = name, slug = slug_from_href(href), team = tri, mp = mp,
      pts = num(cell_text(tr, "pts")), reb = num(cell_text(tr, "trb")),
      drb = num(cell_text(tr, "drb")), orb = num(cell_text(tr, "orb")),
      ast = num(cell_text(tr, "ast")), stl = num(cell_text(tr, "stl")),
      blk = num(cell_text(tr, "blk")), tov = num(cell_text(tr, "tov")),
      fgm = num(cell_text(tr, "fg")),  fga = num(cell_text(tr, "fga")),
      tpm = num(cell_text(tr, "fg3")), tpa = num(cell_text(tr, "fg3a")),
      ftm = num(cell_text(tr, "ft")),  fta = num(cell_text(tr, "fta"))
    )
  }
  # Team final score = the tfoot "Team Totals" points. Ties the score to the
  # team via the table id, so it never depends on scorebox ordering.
  score <- num(xml2::xml_text(xml2::xml_find_first(t, ".//tfoot//*[@data-stat='pts']")))
  list(tri = tri, score = score, players = players)
}

# Parse every full-game basic box table on the page into team records,
# deriving the tricode straight from the table id (box-XXX-game-basic).
teams_from_doc <- function(doc) {
  out <- list()
  for (t in xml2::xml_find_all(doc, "//table[contains(@id,'-game-basic')]")) {
    id <- xml2::xml_attr(t, "id")
    m <- regmatches(id, regexec("^box-([A-Z]{3})-game-basic$", id))[[1]]
    if (length(m) < 2) next
    out[[length(out) + 1]] <- parse_team_table(t, m[2])
  }
  out
}

fetch_box <- function(url) {
  box_id <- sub(".*/boxscores/([^/.]+)\\.html.*", "\\1", url)
  date <- parse_date_from_box_id(box_id)
  # Box tables come from the un-commented HTML (BR hides one team's table in an
  # HTML comment). Team identity and scores are taken entirely from these
  # tables + the gameId -- the scorebox is too fragile to trust for either.
  doc <- parse_html_uncommented(throttled_fetch(url))
  teams <- teams_from_doc(doc)
  if (length(teams) < 2) stop(sprintf("box parse found %d teams for %s", length(teams), box_id))
  # BR encodes the HOME team's tricode in the gameId: YYYYMMDD + "0" + TRI.
  home_code <- substr(box_id, 10, 12)
  home_t <- NULL; away_t <- NULL
  for (tm in teams) {
    if (tm$tri == home_code) home_t <- tm else away_t <- tm
  }
  # Fallback (shouldn't trigger for normal games): keep document order.
  if (is.null(home_t) || is.null(away_t)) { away_t <- teams[[1]]; home_t <- teams[[2]] }
  players <- c(away_t$players, home_t$players)
  list(
    gameId = box_id, date = date,
    home = list(tri = to_nba(home_t$tri), score = home_t$score, brTri = home_t$tri),
    away = list(tri = to_nba(away_t$tri), score = away_t$score, brTri = away_t$tri),
    players = lapply(players, function(p) { p$team <- to_nba(p$team); p })
  )
}

# --- Regular-season totals (per-game VA reference tick) --------------------
fetch_regular_season_totals <- function(end_year) {
  url <- sprintf("https://www.basketball-reference.com/leagues/NBA_%d_totals.html", end_year)
  message(sprintf("Fetching %s", url))
  doc <- parse_html_uncommented(throttled_fetch(url))
  table <- NULL
  for (id in c("totals_stats", "players_totals", "totals", "per_game_stats")) {
    t <- xml2::xml_find_first(doc, sprintf("//table[@id='%s']", id))
    if (!inherits(t, "xml_missing")) { table <- t; break }
  }
  if (is.null(table)) {
    for (t in xml2::xml_find_all(doc, "//table")) {
      head <- xml2::xml_find_first(t, ".//thead")
      if (inherits(head, "xml_missing")) next
      hp <- !inherits(xml2::xml_find_first(head, ".//*[@data-stat='pts']"), "xml_missing")
      hg <- !inherits(xml2::xml_find_first(head, ".//*[@data-stat='g']"),   "xml_missing")
      hm <- !inherits(xml2::xml_find_first(head, ".//*[@data-stat='mp']"),  "xml_missing")
      if (hp && hg && hm) { table <- t; break }
    }
  }
  if (is.null(table)) stop("totals table not found")

  by_key <- list(); order_keys <- character(0)
  for (tr in xml2::xml_find_all(table, ".//tbody/tr")) {
    cls <- xml2::xml_attr(tr, "class")
    if (!is.na(cls) && grepl("thead", cls)) next
    name <- cell_text(tr, c("player", "name_display", "name"))
    if (!nzchar(name)) next
    href <- xml2::xml_attr(xml2::xml_find_first(tr, ".//a[contains(@href,'/players/')]"), "href")
    slug <- slug_from_href(href)
    team <- cell_text(tr, c("team_id", "team_name_abbr", "team"))
    g  <- num(cell_text(tr, c("g", "games")))
    mp <- num(cell_text(tr, c("mp", "mp_total")))
    if (g <= 0 || mp <= 0) next
    row <- list(
      slug = slug, name = name, team = to_nba(team), g = g, mp = mp,
      pts = num(cell_text(tr, "pts")), ast = num(cell_text(tr, "ast")),
      stl = num(cell_text(tr, "stl")), blk = num(cell_text(tr, "blk")),
      tov = num(cell_text(tr, "tov")), drb = num(cell_text(tr, "drb")),
      orb = num(cell_text(tr, "orb")), fgm = num(cell_text(tr, "fg")),
      fga = num(cell_text(tr, "fga")), tpm = num(cell_text(tr, "fg3")),
      tpa = num(cell_text(tr, "fg3a")), ftm = num(cell_text(tr, "ft")),
      fta = num(cell_text(tr, "fta"))
    )
    key <- if (!is.na(slug)) slug else name
    is_aggregate <- grepl("^(TOT|[0-9]TM)$", team)
    if (is.null(by_key[[key]])) { order_keys <- c(order_keys, key); by_key[[key]] <- row }
    else if (is_aggregate) by_key[[key]] <- row
  }
  if (length(by_key) == 0) stop("totals table found but parsed 0 player rows")
  unname(by_key[order_keys])
}

# Round bucketing by chronological series index (0-based), 8/4/2/1.
round_key_for_idx <- function(i) if (i < 8) "r1" else if (i < 12) "r2" else if (i < 14) "r3" else "r4"
round_num_for_idx <- function(i) if (i < 8) 1L else if (i < 12) 2L else if (i < 14) 3L else 4L

main <- function(season) {
  if (!grepl("^[0-9]{4}-[0-9]{2}$", season)) stop("Usage: fetch_historical.R <YYYY-YY>")
  end_year <- season_end_year(season)
  lga_all <- load_league_averages()
  lga <- lga_all[[season]]
  if (is.null(lga)) {
    stop(sprintf(paste0("No league averages for %s. Backfill them first:\n",
                        "  Rscript scripts/R/fetch_league_averages.R %s"), season, season))
  }
  message(sprintf("Baking %s from basketball-reference...", season))

  urls <- sort(fetch_playoff_game_urls(end_year))
  message(sprintf("  %d playoff game URLs", length(urls)))
  if (length(urls) == 0) stop("no playoff games discovered")

  message("Fetching box scores...")
  games <- list()
  for (i in seq_along(urls)) {
    g <- tryCatch(fetch_box(urls[i]),
                  error = function(e) { message(sprintf("  failed %s: %s", urls[i], conditionMessage(e))); NULL })
    if (!is.null(g)) games[[length(games) + 1]] <- g
    if (i %% 10 == 0) message(sprintf("  %d/%d", i, length(urls)))
  }
  if (length(games) == 0) stop("no boxes parsed")
  message(sprintf("  %d games parsed", length(games)))

  gd <- vapply(games, function(g) g$date, character(1))
  gi <- vapply(games, function(g) g$gameId, character(1))
  games <- games[order(gd, gi)]

  # Cluster into series by sorted team pair (push order is chronological).
  by_pair <- list(); pair_order <- character(0)
  for (g in games) {
    key <- paste(sort(c(g$home$tri, g$away$tri)), collapse = "-")
    if (is.null(by_pair[[key]])) { pair_order <- c(pair_order, key); by_pair[[key]] <- list() }
    by_pair[[key]][[length(by_pair[[key]]) + 1]] <- g
  }
  series_list <- lapply(pair_order, function(k) list(games = by_pair[[k]], start = by_pair[[k]][[1]]$date))
  series_list <- series_list[order(vapply(series_list, function(s) s$start, character(1)))]

  # Flat chronological list with 0-based series index.
  all_flat <- list()
  for (s_idx in seq_along(series_list)) {
    for (g in series_list[[s_idx]]$games) {
      g$seriesIdx <- s_idx - 1L
      all_flat[[length(all_flat) + 1]] <- g
    }
  }
  fd <- vapply(all_flat, function(g) g$date, character(1))
  fi <- vapply(all_flat, function(g) g$gameId, character(1))
  all_flat <- all_flat[order(fd, fi)]
  game_idx_by_id <- list()
  for (i in seq_along(all_flat)) game_idx_by_id[[all_flat[[i]]$gameId]] <- i - 1L

  # --- history shape ---
  history_series <- lapply(seq_along(series_list), function(i) {
    s <- series_list[[i]]
    wins <- list()
    for (g in s$games) {
      w <- if (g$home$score > g$away$score) g$home$tri else g$away$tri
      wins[[w]] <- (if (is.null(wins[[w]])) 0 else wins[[w]]) + 1
    }
    winner <- NA_character_; bestN <- 0
    for (tname in names(wins)) if (wins[[tname]] > bestN) { winner <- tname; bestN <- wins[[tname]] }
    list(
      round = round_key_for_idx(i - 1L),
      teams = c(s$games[[1]]$home$tri, s$games[[1]]$away$tri),
      winner = winner,
      games = lapply(s$games, function(g) list(
        gameId = g$gameId,
        gameCode = gsub("-", "", g$date),
        gameDateTimeUTC = paste0(g$date, "T00:00:00.000Z"),
        home = list(tri = g$home$tri, score = as.integer(g$home$score)),
        away = list(tri = g$away$tri, score = as.integer(g$away$score))
      ))
    )
  })
  history_out <- list(season = season, series = history_series,
                      source = "basketball-reference", fetchedAt = iso_now())

  # --- per-player aggregation (null slots for missed games in a series) ---
  player_info <- list(); info_order <- character(0); stats_by_game <- list()
  for (r in all_flat) {
    for (p in r$players) {
      key <- paste0(p$team, ":", p$name)
      info <- player_info[[key]]
      if (is.null(info)) {
        info <- list(name = p$name, team = p$team,
                     slug = if (is.na(p$slug)) NA_character_ else p$slug, seriesSet = integer(0))
        info_order <- c(info_order, key)
      } else if (is.na(info$slug) && !is.na(p$slug)) {
        info$slug <- p$slug
      }
      info$seriesSet <- unique(c(info$seriesSet, r$seriesIdx))
      player_info[[key]] <- info
      stats_by_game[[paste0(key, ":", r$gameId)]] <- p
    }
  }
  series_games_by_idx <- list()
  for (r in all_flat) {
    k <- as.character(r$seriesIdx)
    if (is.null(series_games_by_idx[[k]])) series_games_by_idx[[k]] <- list()
    series_games_by_idx[[k]][[length(series_games_by_idx[[k]]) + 1]] <- r
  }

  sum_keys <- c("mp", "pts", "reb", "ast", "stl", "blk", "tov",
                "fgm", "fga", "tpm", "tpa", "ftm", "fta", "drb", "orb")
  agg <- list()
  for (key in info_order) {
    info <- player_info[[key]]
    a <- list(name = info$name, team = info$team,
              slug = if (is.na(info$slug)) NA_character_ else info$slug,
              gp = 0L, va = 0, eff = 0,
              mp = 0, pts = 0, reb = 0, ast = 0, stl = 0, blk = 0, tov = 0,
              fgm = 0, fga = 0, tpm = 0, tpa = 0, ftm = 0, fta = 0, drb = 0, orb = 0,
              games = list())
    for (s_idx in sort(info$seriesSet)) {
      s_games <- series_games_by_idx[[as.character(s_idx)]]
      if (is.null(s_games)) next
      for (i in seq_along(s_games)) {
        r <- s_games[[i]]
        opp <- if (info$team == r$home$tri) r$away$tri else r$home$tri
        gidx <- game_idx_by_id[[r$gameId]]; if (is.null(gidx)) gidx <- 0L
        base <- list(gameId = r$gameId, gameIdx = gidx, seriesIdx = as.integer(s_idx),
                     seriesGameNumber = as.integer(i), opp = opp)
        p <- stats_by_game[[paste0(key, ":", r$gameId)]]
        if (!is.null(p)) {
          vp <- value_add_parts(p, lga)
          a$gp <- a$gp + 1L; a$va <- a$va + vp$va; a$eff <- a$eff + vp$efficiency
          for (kk in sum_keys) a[[kk]] <- a[[kk]] + (if (is.null(p[[kk]])) 0 else p[[kk]])
          a$games[[length(a$games) + 1]] <- c(base, list(
            va = vp$va,
            mp = p$mp, pts = p$pts, reb = p$reb, ast = p$ast, stl = p$stl,
            blk = p$blk, tov = p$tov, fgm = p$fgm, fga = p$fga, tpm = p$tpm,
            tpa = p$tpa, ftm = p$ftm, fta = p$fta, drb = p$drb, orb = p$orb))
        } else {
          a$games[[length(a$games) + 1]] <- c(base, list(
            va = NA_real_, mp = 0, pts = 0, reb = 0, ast = 0, stl = 0, blk = 0,
            tov = 0, fgm = 0, fga = 0, tpm = 0, tpa = 0, ftm = 0, fta = 0, drb = 0, orb = 0))
        }
      }
    }
    agg[[key]] <- a
  }
  players <- unname(agg)
  players <- players[order(vapply(players, function(x) x$va, numeric(1)), decreasing = TRUE)]

  leaderboard_out <- list(
    season = season,
    series = lapply(seq_along(series_list), function(i) list(
      idx = as.integer(i - 1L),
      round = round_num_for_idx(i - 1L),
      teams = c(series_list[[i]]$games[[1]]$home$tri, series_list[[i]]$games[[1]]$away$tri)
    )),
    players = players,
    source = "basketball-reference",
    fetchedAt = iso_now()
  )

  # --- regular-season totals (best-effort) ---
  regular_out <- NULL
  rs <- tryCatch(fetch_regular_season_totals(end_year),
                 error = function(e) { message(sprintf("  regular-season totals failed: %s - skipping reference file", conditionMessage(e))); NULL })
  if (!is.null(rs)) {
    message(sprintf("  %d regular-season players", length(rs)))
    regular_out <- list(season = season, players = rs,
                        source = "basketball-reference", fetchedAt = iso_now())
  }

  dir.create(DATA_DIR, showWarnings = FALSE, recursive = TRUE)
  history_path     <- file.path(DATA_DIR, sprintf("history-%s.json", season))
  leaderboard_path <- file.path(DATA_DIR, sprintf("leaderboard-%s.json", season))
  write_json_pretty(history_out, history_path)
  write_json_pretty(leaderboard_out, leaderboard_path)
  message(sprintf("Wrote %d series, %d players", length(history_series), length(players)))
  message(sprintf("  -> %s", history_path))
  message(sprintf("  -> %s", leaderboard_path))
  if (!is.null(regular_out)) {
    rs_path <- file.path(DATA_DIR, sprintf("regular-season-%s.json", season))
    write_json_pretty(regular_out, rs_path)
    message(sprintf("  -> %s", rs_path))
  }
}

# Only run when invoked as a script (not when sourced for tests).
if (sys.nframe() == 0) {
  season_arg <- commandArgs(trailingOnly = TRUE)
  season_arg <- season_arg[!grepl("^--", season_arg)]
  if (length(season_arg) < 1) stop("Usage: Rscript fetch_historical.R <YYYY-YY>")
  tryCatch(main(season_arg[1]), error = function(e) {
    message("\n========== BAKE FAILED ==========")
    message(conditionMessage(e))
    message("==================================\n")
    quit(status = 1)
  })
}
