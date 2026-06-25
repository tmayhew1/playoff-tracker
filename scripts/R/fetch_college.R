#!/usr/bin/env Rscript
# Bakes the top men's Division I college players for a season, ranked by Value
# Added, scraped from College Sports Reference (sports-reference.com/cbb).
#
#   Rscript scripts/R/fetch_college.R 2025-26
#
# Writes app/data/college-<season>.json (top players + the college league
# baselines used to compute VA). League baselines are derived from the summed
# player totals themselves, so this needs only the one season-totals source.
#
# VA uses the same formula as the NBA side (scrape_common.R::value_add_parts),
# just measured against college league rates instead of NBA ones.

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

iso_now <- function() strftime(Sys.time(), "%Y-%m-%dT%H:%M:%OS3Z", tz = "UTC")
TOP_N <- 100

# League rates from summed totals (mirrors fetch_league_averages.R's
# lga_from_totals; kept local so the college pipeline is self-contained).
lga_from_totals <- function(t) {
  safe <- function(a, b) if (b > 0) a / b else 0
  twoPm <- t$fgm - t$tpm
  twoPa <- t$fga - t$tpa
  reb <- t$drb + t$orb
  poss <- t$fga - t$orb + t$tov + 0.475 * t$fta
  list(
    la3P = safe(t$tpm, t$tpa), la2P = safe(twoPm, twoPa),
    laFT = safe(t$ftm, t$fta), laFG = safe(t$fgm, t$fga),
    laPTSperM = safe(t$pts, t$mp), laASTperM = safe(t$ast, t$mp),
    laSTLperM = safe(t$stl, t$mp), laBLKperM = safe(t$blk, t$mp),
    laTOVperM = safe(t$tov, t$mp), laDRBperM = safe(t$drb, t$mp),
    laORBperM = safe(t$orb, t$mp), laPTSperMake = safe(t$pts, t$fgm),
    laPTSperPoss = safe(t$pts, poss), laDRBrate = safe(t$drb, reb),
    laORBrate = safe(t$orb, reb)
  )
}

slug_from_href <- function(href) {
  if (is.na(href)) return(NA_character_)
  m <- regmatches(href, regexec("/cbb/players/([^.]+)\\.html", href))[[1]]
  if (length(m) >= 2) m[2] else NA_character_
}

# Locate the season-totals table (id has churned; fall back to any table whose
# header carries the pts/mp/g columns we need).
find_totals_table <- function(doc) {
  for (id in c("totals", "totals_stats", "players_totals", "per_game")) {
    t <- xml2::xml_find_first(doc, sprintf("//table[@id='%s']", id))
    if (!inherits(t, "xml_missing")) return(t)
  }
  for (t in xml2::xml_find_all(doc, "//table")) {
    head <- xml2::xml_find_first(t, ".//thead")
    if (inherits(head, "xml_missing")) next
    hp <- !inherits(xml2::xml_find_first(head, ".//*[@data-stat='pts']"), "xml_missing")
    hm <- !inherits(xml2::xml_find_first(head, ".//*[@data-stat='mp']"), "xml_missing")
    hg <- !inherits(xml2::xml_find_first(head, ".//*[@data-stat='g']"), "xml_missing")
    if (hp && hm && hg) return(t)
  }
  NULL
}

parse_rows <- function(table) {
  out <- list()
  for (tr in xml2::xml_find_all(table, ".//tbody/tr")) {
    cls <- xml2::xml_attr(tr, "class")
    if (!is.na(cls) && grepl("thead", cls)) next
    player_cell <- xml2::xml_find_first(tr, ".//*[@data-stat='player']")
    name <- xml2::xml_text(player_cell)
    if (is.na(name)) next
    name <- trimws(name)
    if (!nzchar(name)) next
    g  <- num(cell_text(tr, c("g", "games")))
    mp <- num(cell_text(tr, "mp"))
    if (g <= 0 || mp <= 0) next
    href <- xml2::xml_attr(xml2::xml_find_first(player_cell, ".//a"), "href")
    out[[length(out) + 1]] <- list(
      name = name,
      slug = slug_from_href(href),
      school = cell_text(tr, c("school_name", "team_name", "school", "team_id")),
      gp = g, mp = mp,
      pts = num(cell_text(tr, "pts")), ast = num(cell_text(tr, "ast")),
      stl = num(cell_text(tr, "stl")), blk = num(cell_text(tr, "blk")),
      tov = num(cell_text(tr, "tov")), drb = num(cell_text(tr, "drb")),
      orb = num(cell_text(tr, "orb")), fgm = num(cell_text(tr, "fg")),
      fga = num(cell_text(tr, "fga")), tpm = num(cell_text(tr, "fg3")),
      tpa = num(cell_text(tr, "fg3a")), ftm = num(cell_text(tr, "ft")),
      fta = num(cell_text(tr, "fta"))
    )
  }
  out
}

# Pull every player. Pages are followed via ?offset=; we stop when a page adds
# no new players (handles both paginated and single-table layouts robustly).
fetch_player_totals <- function(end_year) {
  base <- sprintf("https://www.sports-reference.com/cbb/seasons/men/%d-totals.html", end_year)
  seen <- new.env(parent = emptyenv())
  players <- list()
  offset <- 0
  repeat {
    url <- if (offset == 0) base else sprintf("%s?offset=%d", base, offset)
    message(sprintf("Fetching %s", url))
    doc <- parse_html_uncommented(throttled_fetch(url))
    table <- find_totals_table(doc)
    if (is.null(table)) {
      if (offset == 0) stop("season totals table not found")
      break
    }
    rows <- parse_rows(table)
    added <- 0
    for (p in rows) {
      key <- if (!is.na(p$slug)) p$slug else paste0(p$name, "|", p$school)
      if (!is.null(seen[[key]])) next
      seen[[key]] <- TRUE
      players[[length(players) + 1]] <- p
      added <- added + 1
    }
    message(sprintf("  +%d new (%d total)", added, length(players)))
    if (added == 0) break          # nothing new -> done (or non-paginated)
    offset <- offset + 100
    if (offset > 8000) break        # safety cap (~8000 D-I players)
  }
  players
}

main <- function(season) {
  if (!grepl("^[0-9]{4}-[0-9]{2}$", season)) stop("Usage: fetch_college.R <YYYY-YY>")
  end_year <- season_end_year(season)
  message(sprintf("Baking %s men's college players from sports-reference.com/cbb...", season))

  players <- fetch_player_totals(end_year)
  if (length(players) == 0) stop("no players parsed")
  message(sprintf("  %d players parsed", length(players)))

  # League baselines from the summed player totals.
  totals <- list(mp = 0, pts = 0, ast = 0, stl = 0, blk = 0, tov = 0, drb = 0,
                 orb = 0, fgm = 0, fga = 0, tpm = 0, tpa = 0, ftm = 0, fta = 0)
  for (p in players) for (k in names(totals)) totals[[k]] <- totals[[k]] + (p[[k]] %||% 0)
  lga <- lga_from_totals(totals)

  ranked <- lapply(players, function(p) {
    vp <- value_add_parts(p, lga)
    list(
      name = p$name, school = p$school, slug = if (is.na(p$slug)) NA_character_ else p$slug,
      gp = as.integer(p$gp), mp = round(p$mp, 1),
      pts = as.integer(p$pts), ppg = round(p$pts / p$gp, 1),
      va = round(vp$va, 2), eff = round(vp$efficiency, 2),
      vaPerG = round(vp$va / p$gp, 2)
    )
  })
  ranked <- ranked[order(vapply(ranked, function(x) x$va, numeric(1)), decreasing = TRUE)]
  top <- ranked[seq_len(min(TOP_N, length(ranked)))]

  out <- list(
    season = season,
    division = "men",
    players = top,
    playerPool = length(players),
    leagueAverages = lga,
    source = "sports-reference.com/cbb",
    fetchedAt = iso_now()
  )
  dir.create(DATA_DIR, showWarnings = FALSE, recursive = TRUE)
  path <- file.path(DATA_DIR, sprintf("college-%s.json", season))
  write_json_pretty(out, path)
  message(sprintf("Wrote top %d of %d players -> %s", length(top), length(players), path))
}

if (sys.nframe() == 0) {
  season_arg <- commandArgs(trailingOnly = TRUE)
  season_arg <- season_arg[!grepl("^--", season_arg)]
  if (length(season_arg) < 1) stop("Usage: Rscript fetch_college.R <YYYY-YY>")
  tryCatch(main(season_arg[1]), error = function(e) {
    message("\n========== COLLEGE BAKE FAILED ==========")
    message(conditionMessage(e))
    message("=========================================\n")
    quit(status = 1)
  })
}
