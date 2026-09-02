#!/usr/bin/env Rscript
# DIAGNOSTIC PROBE — writes nothing, prints a reachability/shape report.
#
# app/data/def-ratings.json carries on-court (counted-possession) ratings for
# only 20 of 26 PBP-era regular seasons and 7 of 26 postseasons. Round 1 of
# this probe settled where a second source could come from:
#
#   stats.nba.com    still hard-blocked from Actions (30s, 0 bytes received,
#                    full browser headers) - the ideal source stays unusable
#   sportsdataverse  hoopR-data / hoopR-nba-stats-data publish 0 releases
#   shufinskiy/nba_data  WORKS: raw stats.nba.com play-by-play as static
#                    GitHub files, 1996-97 on, regular season AND playoffs,
#                    0.4-0.6 MB per postseason. EVENTMSGTYPE 8 carries the
#                    substitutions a lineup reconstruction needs.
#   api.pbpstats.com WORKS TODAY on every season that failed in July,
#                    OpponentPoints included - so the gaps are stale, not
#                    permanent - and also serves Points and PlusMinus, from
#                    which points allowed is derivable when it doesn't.
#   basketball-reference /teams/<TM>/<YR>/on-off/  has an `on_off` table back
#                    to 1996-97 and, in 2016, an `on_off_p` playoff table;
#                    the Opponent group's ORtg is the on-court DRtg.
#
# Round 2 asks the two questions those answers opened:
#   A  is pbpstats' recovery real across ALL the gap seasons, or luck?
#   D  how far back does BR's playoff on-off table go, and is the Opponent
#      ORtg column really points allowed per 100 with the player on court?
#
#   Rscript scripts/R/probe_def_sources.R

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

hdr <- function(s) message("\n=== ", s, " ", strrep("=", max(0, 60 - nchar(s))))
ok  <- function(...) message("  [ok]   ", sprintf(...))
bad <- function(...) message("  [FAIL] ", sprintf(...))
inf <- function(...) message("         ", sprintf(...))

num_of <- function(v) suppressWarnings(as.numeric(if (is.null(v)) NA else v))

# --- A: every gap season, not a sample ---------------------------------------
# Also reports the minute-weighted mean rating: a column can be present and
# still be junk, and the bake's own plausibility gate is 95 < wmean < 125.
hdr("A. api.pbpstats.com - all gap seasons")

probe_pbpstats <- function(season, season_type) {
  res <- tryCatch(httr::GET("https://api.pbpstats.com/get-totals/nba",
    query = list(Season = season, SeasonType = season_type, Type = "Player"),
    httr::timeout(60), httr::user_agent(UA),
    httr::add_headers(Accept = "application/json")), error = function(e) e)
  if (inherits(res, "error")) { bad("%s %-15s %s", season, season_type, conditionMessage(res)); return(invisible()) }
  if (httr::status_code(res) != 200) { bad("%s %-15s HTTP %d", season, season_type, httr::status_code(res)); return(invisible()) }
  rows <- jsonlite::fromJSON(httr::content(res, as = "text", encoding = "UTF-8"),
                             simplifyVector = FALSE)$multi_row_table_data
  if (is.null(rows) || !length(rows)) { bad("%s %-15s no rows", season, season_type); return(invisible()) }
  k <- names(rows[[1]])
  direct <- "OpponentPoints" %in% k
  derive <- all(c("Points", "PlusMinus") %in% k)
  # Minute-weighted mean of 100*opp/defposs, opp taken directly or derived as
  # Points - PlusMinus (a player's on-court margin is his team's points minus
  # the opponent's, so the opponent's total falls straight out of the two).
  wsum <- 0; msum <- 0; n <- 0; dmax <- 0
  for (r in rows) {
    dp <- num_of(r$DefPoss); mn <- num_of(r$Minutes)
    opp <- if (direct) num_of(r$OpponentPoints)
           else if (derive) num_of(r$Points) - num_of(r$PlusMinus) else NA
    if (is.na(dp) || dp <= 0 || is.na(opp) || is.na(mn) || mn < 25) next
    wsum <- wsum + mn * 100 * opp / dp; msum <- msum + mn; n <- n + 1
    if (direct && derive) {
      d <- abs(num_of(r$OpponentPoints) - (num_of(r$Points) - num_of(r$PlusMinus)))
      if (!is.na(d) && d > dmax) dmax <- d
    }
  }
  wmean <- if (msum > 0) wsum / msum else NA
  gate <- !is.na(wmean) && wmean > 95 && wmean < 125
  (if (direct && gate) ok else bad)(
    "%s %-15s %4d rows | OpponentPoints:%-3s Points+PlusMinus:%-3s | %d rated, wmean %.1f %s",
    season, season_type, length(rows), if (direct) "yes" else "NO",
    if (derive) "yes" else "NO", n, wmean, if (gate) "(passes gate)" else "(FAILS gate)")
  if (direct && derive) inf("max |OpponentPoints - (Points - PlusMinus)| across rows: %.0f", dmax)
}

RS_GAPS <- c("2000-01", "2005-06", "2009-10", "2011-12", "2014-15", "2016-17")
PO_GAPS <- c("2000-01", "2001-02", "2003-04", "2005-06", "2006-07", "2007-08",
             "2009-10", "2010-11", "2011-12", "2012-13", "2013-14", "2014-15",
             "2016-17", "2018-19", "2019-20", "2020-21", "2021-22", "2022-23",
             "2023-24")
for (s in RS_GAPS) { probe_pbpstats(s, "Regular Season"); Sys.sleep(2) }
for (s in PO_GAPS) { probe_pbpstats(s, "Playoffs"); Sys.sleep(2) }

# --- D: how far back does BR's playoff on-off go? ----------------------------
# BR is scraped by this pipeline daily, so it is the one host whose
# reachability is already proven. The question is coverage.
hdr("D. basketball-reference on-off - playoff table coverage")

br_tables <- function(team, year) {
  h <- tryCatch(parse_html_uncommented(
    throttled_fetch(sprintf("https://www.basketball-reference.com/teams/%s/%d/on-off/", team, year))),
    error = function(e) e)
  if (inherits(h, "error")) { bad("%s %d - %s", team, year, conditionMessage(h)); return(NULL) }
  tabs <- xml2::xml_find_all(h, "//table")
  ids <- xml2::xml_attr(tabs, "id")
  keep <- !is.na(ids)
  ok("%s %d - tables: %s", team, year, paste(ids[keep], collapse = ", "))
  stats::setNames(as.list(tabs[keep]), ids[keep])
}

# Walk back until the playoff table stops appearing. Champions, so the team
# definitely played a postseason in the year probed.
for (ty in list(c("MIA", 2013), c("LAL", 2010), c("SAS", 2007), c("DET", 2004),
                c("LAL", 2001), c("CHI", 1998))) {
  br_tables(ty[[1]], as.integer(ty[[2]]))
}

# --- D2: is Opponent/ORtg really the on-court points allowed per 100? --------
# Print one team's actual rows so the column can be read against a rating that
# is already known: the same team's season DRtg in def-ratings.json.
hdr("D2. basketball-reference on-off - row shape")
tabs <- br_tables("GSW", 2016)
if (!is.null(tabs) && length(tabs)) {
  tb <- tabs[[1]]
  over <- xml2::xml_text(xml2::xml_find_all(tb, ".//thead/tr[1]/th"))
  cols <- xml2::xml_find_all(tb, ".//thead/tr[2]/th")
  inf("over-headers: %s", paste(over, collapse = " | "))
  inf("data-stat keys: %s", paste(xml2::xml_attr(cols, "data-stat"), collapse = ","))
  rows <- xml2::xml_find_all(tb, ".//tbody/tr")
  shown <- 0
  for (r in rows) {
    cells <- xml2::xml_find_all(r, "./th|./td")
    keys <- xml2::xml_attr(cells, "data-stat")
    vals <- xml2::xml_text(cells)
    if (!length(keys) || all(is.na(keys))) next
    inf("%s", paste(sprintf("%s=%s", keys, vals), collapse = " "))
    shown <- shown + 1
    if (shown >= 4) break
  }
}

message("\nProbe complete.")
