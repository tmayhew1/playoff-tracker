#!/usr/bin/env Rscript
# DIAGNOSTIC PROBE — writes nothing, prints a reachability/shape report.
#
# app/data/def-ratings.json has on-court (counted-possession) ratings for only
# 20 of 26 PBP-era regular seasons and 7 of 26 postseasons, because
# api.pbpstats.com's get-totals returns a season-dependent column subset and
# OpponentPoints is permanently absent for some seasons (bake run #6). This
# script asks, from a GitHub Actions runner — the only environment that can
# reach these hosts — which alternative sources are usable:
#
#   A  api.pbpstats.com   which columns each gap season actually serves
#   B  stats.nba.com      still datacenter-IP blocked?
#   C  shufinskiy/nba_data  static raw PBP archives, 1996-97+, RS *and* PO
#   D  basketball-reference /teams/<TM>/<YR>/on-off/  (BR already scrapes fine)
#   E  sportsdataverse    pre-baked release assets
#
#   Rscript scripts/R/probe_def_sources.R

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

hdr <- function(s) message("\n=== ", s, " ", strrep("=", max(0, 60 - nchar(s))))
ok  <- function(...) message("  [ok]   ", sprintf(...))
bad <- function(...) message("  [FAIL] ", sprintf(...))
inf <- function(...) message("         ", sprintf(...))

timed <- function(expr) {
  t0 <- Sys.time()
  res <- tryCatch(expr, error = function(e) e)
  list(res = res, secs = as.numeric(difftime(Sys.time(), t0, units = "secs")))
}

# --- A: what api.pbpstats.com actually serves per season --------------------
# The bake needs points-allowed and defensive possessions. DefPoss is always
# there; the question is whether ANY points-allowed column is, and whether a
# derivation (Points - PlusMinus) is available when it isn't.
hdr("A. api.pbpstats.com get-totals column sets")
WANT_PTS <- c("OpponentPoints", "PtsAllowed", "OppPts")
DERIVE   <- c("Points", "PlusMinus", "OnOffRtg", "DefRtg", "DefEff")

probe_pbpstats <- function(season, season_type) {
  t <- timed(httr::GET("https://api.pbpstats.com/get-totals/nba",
    query = list(Season = season, SeasonType = season_type, Type = "Player"),
    httr::timeout(60), httr::user_agent(UA),
    httr::add_headers(Accept = "application/json")))
  if (inherits(t$res, "error")) { bad("%s %-15s %s", season, season_type, conditionMessage(t$res)); return(invisible()) }
  st <- httr::status_code(t$res)
  if (st != 200) { bad("%s %-15s HTTP %d (%.1fs)", season, season_type, st, t$secs); return(invisible()) }
  d <- jsonlite::fromJSON(httr::content(t$res, as = "text", encoding = "UTF-8"), simplifyVector = FALSE)
  rows <- d$multi_row_table_data
  if (is.null(rows) || !length(rows)) { bad("%s %-15s no rows", season, season_type); return(invisible()) }
  k <- names(rows[[1]])
  pts <- intersect(WANT_PTS, k); der <- intersect(DERIVE, k)
  if (length(pts)) ok("%s %-15s %4d rows, has %s", season, season_type, length(rows), paste(pts, collapse = "/"))
  else bad("%s %-15s %4d rows, NO points-allowed column", season, season_type, length(rows))
  inf("derivable from: %s | DefPoss: %s",
      if (length(der)) paste(der, collapse = ", ") else "(none)",
      if ("DefPoss" %in% k) "yes" else "NO")
}

for (s in c("2000-01", "2009-10", "2016-17")) { probe_pbpstats(s, "Regular Season"); Sys.sleep(2) }
for (s in c("2000-01", "2010-11", "2018-19", "2022-23")) { probe_pbpstats(s, "Playoffs"); Sys.sleep(2) }

# --- B: is stats.nba.com still blocked from Actions? ------------------------
# It is the ideal source (DEF_RATING + POSS, RS and Playoffs, 1996-97+), so
# re-confirm the block rather than inherit the assumption. Full browser
# headers: a bare UA is the classic cause of a hang that isn't really a block.
hdr("B. stats.nba.com leaguedashplayerstats (Advanced)")
t <- timed(httr::GET("https://stats.nba.com/stats/leaguedashplayerstats",
  query = list(Season = "2016-17", SeasonType = "Regular Season", MeasureType = "Advanced",
               PerMode = "Totals", LeagueID = "00", PaceAdjust = "N", PlusMinus = "N",
               Rank = "N", Month = "0", OpponentTeamID = "0", Period = "0",
               LastNGames = "0", TeamID = "0"),
  httr::timeout(30), httr::user_agent(UA),
  httr::add_headers(Accept = "application/json, text/plain, */*",
                    `Accept-Language` = "en-US,en;q=0.9",
                    Referer = "https://www.nba.com/", Origin = "https://www.nba.com",
                    `x-nba-stats-origin` = "stats", `x-nba-stats-token` = "true",
                    Connection = "keep-alive")))
if (inherits(t$res, "error")) bad("blocked/hung after %.1fs - %s", t$secs, conditionMessage(t$res)) else
  ok("HTTP %d in %.1fs, %d bytes", httr::status_code(t$res), t$secs,
     length(httr::content(t$res, as = "raw")))

# --- C: shufinskiy/nba_data static archives ---------------------------------
# Raw stats.nba.com play-by-play, already scraped and committed to a public
# repo: 1996-97 onward, regular season AND playoffs. Static files on GitHub,
# so no rate limit, no IP block, no per-season column roulette. Costs a
# lineup-tracking pass (substitution events) to turn events into per-player
# defensive possessions and points allowed.
hdr("C. shufinskiy/nba_data raw PBP archives")
BASE <- "https://github.com/shufinskiy/nba_data/raw/main/datasets/%s.tar.xz"
for (f in c("nbastats_po_1996", "nbastats_po_2013", "nbastats_po_2022", "nbastats_2016")) {
  t <- timed(httr::HEAD(sprintf(BASE, f), httr::timeout(60), httr::user_agent(UA)))
  if (inherits(t$res, "error")) { bad("%-18s %s", f, conditionMessage(t$res)); next }
  n <- suppressWarnings(as.numeric(httr::headers(t$res)$`content-length`))
  if (length(n) != 1 || is.na(n)) n <- NA_real_
  if (httr::status_code(t$res) == 200) ok("%-18s HTTP 200, %.1f MB", f, n / 1e6)
  else bad("%-18s HTTP %d", f, httr::status_code(t$res))
}

# Pull the smallest one and show the actual columns, so the lineup-tracking
# cost is assessed against real data and not a guess.
tmp <- tempfile(fileext = ".tar.xz")
t <- timed(tryCatch(utils::download.file(sprintf(BASE, "nbastats_po_1996"), tmp, quiet = TRUE), error = function(e) e))
if (!inherits(t$res, "error") && file.exists(tmp) && file.size(tmp) > 1000) {
  ok("downloaded nbastats_po_1996 in %.1fs (%.1f MB)", t$secs, file.size(tmp) / 1e6)
  ex <- file.path(tempdir(), "shuf"); dir.create(ex, showWarnings = FALSE)
  utils::untar(tmp, exdir = ex)
  csvs <- list.files(ex, pattern = "\\.csv$", recursive = TRUE, full.names = TRUE)
  inf("extracted: %s", paste(basename(csvs), collapse = ", "))
  if (length(csvs)) {
    d <- utils::read.csv(csvs[1], nrows = 40000)
    inf("%d rows read; columns: %s", nrow(d), paste(names(d), collapse = ","))
    if ("EVENTMSGTYPE" %in% names(d)) {
      inf("event-type counts (8 = substitution): %s",
          paste(sprintf("%s:%d", names(table(d$EVENTMSGTYPE)), table(d$EVENTMSGTYPE)), collapse = " "))
      subs <- d[d$EVENTMSGTYPE == 8, ]
      inf("substitution rows: %d; sample: %s", nrow(subs),
          if (nrow(subs)) paste(utils::capture.output(utils::str(subs[1, ], give.attr = FALSE)), collapse = " ") else "-")
    }
    gi <- grep("^GAME_ID$", names(d))
    if (length(gi)) inf("distinct GAME_IDs in sample: %d", length(unique(d[[gi[1]]])))
  }
} else bad("download failed: %s", if (inherits(t$res, "error")) conditionMessage(t$res) else "empty")

# --- D: basketball-reference on-off -----------------------------------------
# BR is already scraped by this pipeline every day, so reachability is proven.
# Question is only whether the on-off page carries a per-100-possession team
# DRtg with the player on court, and whether a playoff version exists.
hdr("D. basketball-reference on-off pages")
probe_br <- function(url) {
  h <- tryCatch(parse_html_uncommented(throttled_fetch(url)), error = function(e) e)
  if (inherits(h, "error")) { bad("%s - %s", url, conditionMessage(h)); return(invisible()) }
  tabs <- xml2::xml_find_all(h, "//table")
  ids <- xml2::xml_attr(tabs, "id")
  ok("%s - %d tables: %s", sub(".*basketball-reference.com", "", url), length(tabs),
     paste(ids[!is.na(ids)], collapse = ", "))
  for (i in seq_along(tabs)) {
    if (is.na(ids[i])) next
    ths <- xml2::xml_text(xml2::xml_find_all(tabs[[i]], ".//thead//th"))
    inf("%s headers: %s", ids[i], paste(unique(ths), collapse = " "))
  }
}
probe_br("https://www.basketball-reference.com/teams/BOS/2016/on-off/")
probe_br("https://www.basketball-reference.com/teams/BOS/1997/on-off/")

# --- E: pre-baked sportsdataverse release assets ----------------------------
hdr("E. sportsdataverse release assets")
for (repo in c("sportsdataverse/hoopR-data", "sportsdataverse/hoopR-nba-stats-data")) {
  t <- timed(httr::GET(sprintf("https://api.github.com/repos/%s/releases?per_page=100", repo),
                       httr::timeout(60), httr::user_agent(UA)))
  if (inherits(t$res, "error") || httr::status_code(t$res) != 200) {
    bad("%s - %s", repo, if (inherits(t$res, "error")) conditionMessage(t$res) else
        paste("HTTP", httr::status_code(t$res)))
    next
  }
  rel <- jsonlite::fromJSON(httr::content(t$res, as = "text", encoding = "UTF-8"), simplifyVector = FALSE)
  ok("%s - %d releases", repo, length(rel))
  for (r in rel) inf("tag %-34s %d assets, e.g. %s", r$tag_name, length(r$assets),
                     if (length(r$assets)) r$assets[[1]]$name else "-")
}

message("\nProbe complete.")
