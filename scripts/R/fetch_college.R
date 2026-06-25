#!/usr/bin/env Rscript
# Bakes the top men's Division I college players for a season, ranked by Value
# Added, scraped from College Sports Reference (sports-reference.com/cbb).
#
#   Rscript scripts/R/fetch_college.R 2025-26
#
# CBB has no single all-player totals page (that capability is paywalled
# Stathead now), so we walk every D-I school's season page and read its player
# "Totals" table. League baselines are derived from the summed player totals;
# VA uses the shared formula (scrape_common.R::value_add_parts).

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

iso_now <- function() strftime(Sys.time(), "%Y-%m-%dT%H:%M:%OS3Z", tz = "UTC")
TOP_N <- 100
CBB <- "https://www.sports-reference.com/cbb"

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

# Locate the per-PLAYER season-totals table. CBB school pages expose (confirmed
# via the page's table inventory): players_totals / players_per_game (full
# season, per player) alongside team-summary (season-total_*) and
# conference-only (*_conf) variants we must avoid. Returns list(table=,
# per_game=) or NULL; prefers totals, falls back to per-game (caller multiplies
# by games). The name column is data-stat="name_display" on these tables.
find_stats_table <- function(doc) {
  miss <- function(x) inherits(x, "xml_missing")
  t <- xml2::xml_find_first(doc, "//table[@id='players_totals']")
  if (!miss(t)) return(list(table = t, per_game = FALSE))
  t <- xml2::xml_find_first(doc, "//table[@id='players_per_game']")
  if (!miss(t)) return(list(table = t, per_game = TRUE))
  # Fallback: any non-conference table with player links + a bare pts column.
  has <- function(x, q) !miss(xml2::xml_find_first(x, q))
  for (tb in xml2::xml_find_all(doc, "//table")) {
    id <- xml2::xml_attr(tb, "id")
    if (!is.na(id) && grepl("conf", id)) next
    if (has(tb, ".//tbody//a[contains(@href,'/cbb/players/')]") && has(tb, ".//td[@data-stat='pts']"))
      return(list(table = tb, per_game = FALSE))
  }
  NULL
}

# Log the table inventory of a page (first school only) so a failed run reveals
# the real structure instead of guessing blind.
debug_tables <- function(doc, slug) {
  has <- function(t, q) !inherits(xml2::xml_find_first(t, q), "xml_missing")
  for (t in xml2::xml_find_all(doc, "//table")) {
    id <- xml2::xml_attr(t, "id")
    message(sprintf("  [debug %s] table id=%s player=%s pts=%s pts_per_g=%s",
                    slug, if (is.na(id)) "<none>" else id,
                    has(t, ".//*[@data-stat='player']"),
                    has(t, ".//td[@data-stat='pts']"),
                    has(t, ".//td[@data-stat='pts_per_g']")))
  }
}

# Parse a school's stats table into player rows tagged with the school. When the
# table is per-game, each counting stat is multiplied by games to get a total.
parse_player_rows <- function(table, school, per_game) {
  sfx <- function(s) if (per_game) paste0(s, "_per_g") else s
  out <- list()
  for (tr in xml2::xml_find_all(table, ".//tbody/tr")) {
    cls <- xml2::xml_attr(tr, "class")
    if (!is.na(cls) && grepl("thead", cls)) next
    player_cell <- xml2::xml_find_first(tr, ".//*[@data-stat='player' or @data-stat='name_display']")
    if (inherits(player_cell, "xml_missing")) next
    name <- trimws(xml2::xml_text(player_cell))
    if (!nzchar(name)) next
    href <- xml2::xml_attr(xml2::xml_find_first(player_cell, ".//a"), "href")
    slug <- slug_from_href(href)
    if (is.na(slug)) next  # skip team/school summary rows (no player link)
    g <- num(cell_text(tr, c("g", "games")))
    if (g <= 0) next
    mult <- if (per_game) g else 1
    val <- function(stat) num(cell_text(tr, sfx(stat))) * mult
    mp <- val("mp")
    if (mp <= 0) next
    out[[length(out) + 1]] <- list(
      name = name, slug = slug_from_href(href), school = school, gp = g, mp = mp,
      pts = val("pts"), ast = val("ast"), stl = val("stl"), blk = val("blk"),
      tov = val("tov"), drb = val("drb"), orb = val("orb"), fgm = val("fg"),
      fga = val("fga"), tpm = val("fg3"), tpa = val("fg3a"), ftm = val("ft"), fta = val("fta")
    )
  }
  out
}

# All D-I schools for the season, from the school-stats index page.
fetch_school_index <- function(end_year) {
  url <- sprintf("%s/seasons/men/%d-school-stats.html", CBB, end_year)
  message(sprintf("Fetching %s", url))
  doc <- parse_html_uncommented(throttled_fetch(url))
  anchors <- xml2::xml_find_all(doc, "//*[@data-stat='school_name']//a")
  if (length(anchors) == 0) anchors <- xml2::xml_find_all(doc, "//a[contains(@href,'/cbb/schools/')]")
  out <- list()
  seen <- new.env(parent = emptyenv())
  for (a in anchors) {
    href <- xml2::xml_attr(a, "href")
    if (is.na(href)) next
    m <- regmatches(href, regexec("/cbb/schools/([^/]+)/", href))[[1]]
    if (length(m) < 2) next
    slug <- m[2]
    if (!is.null(seen[[slug]])) next
    seen[[slug]] <- TRUE
    nm <- trimws(xml2::xml_text(a)); if (!nzchar(nm)) nm <- slug
    out[[length(out) + 1]] <- list(slug = slug, name = nm)
  }
  out
}

fetch_school_players <- function(school, end_year, debug = FALSE) {
  url <- sprintf("%s/schools/%s/men/%d.html", CBB, school$slug, end_year)
  doc <- parse_html_uncommented(throttled_fetch(url))
  if (debug) debug_tables(doc, school$slug)
  found <- find_stats_table(doc)
  if (is.null(found)) return(list())
  parse_player_rows(found$table, school$name, found$per_game)
}

main <- function(season) {
  if (!grepl("^[0-9]{4}-[0-9]{2}$", season)) stop("Usage: fetch_college.R <YYYY-YY>")
  end_year <- season_end_year(season)
  message(sprintf("Baking %s men's college players from %s ...", season, CBB))

  schools <- fetch_school_index(end_year)
  if (length(schools) == 0) stop("no schools found on the season index")
  message(sprintf("  %d schools", length(schools)))

  players <- list()
  failed <- 0
  for (i in seq_along(schools)) {
    s <- schools[[i]]
    res <- tryCatch(fetch_school_players(s, end_year, debug = (i == 1)),
                    error = function(e) { failed <<- failed + 1; message(sprintf("  ! %s: %s", s$slug, conditionMessage(e))); list() })
    for (p in res) players[[length(players) + 1]] <- p
    if (i %% 25 == 0) message(sprintf("  %d/%d schools, %d players", i, length(schools), length(players)))
  }
  if (length(players) == 0) stop("no players parsed from any school")
  message(sprintf("  %d players from %d schools (%d fetches failed)", length(players), length(schools), failed))

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
    season = season, division = "men", players = top,
    playerPool = length(players), schools = length(schools),
    leagueAverages = lga, source = "sports-reference.com/cbb", fetchedAt = iso_now()
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
