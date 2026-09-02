#!/usr/bin/env Rscript
# DIAGNOSTIC PROBE — writes nothing, prints a report.
#
# Rounds 1-2 settled where a second per-possession source could come from:
#
#   stats.nba.com    STILL BLOCKED from a runner (30s, 0 bytes, under full
#                    browser headers). The ideal source stays unusable.
#   sportsdataverse  hoopR-data / hoopR-nba-stats-data publish 0 releases.
#   basketball-reference/teams/<TM>/<YR>/on-off/   THE SECOND SOURCE. Tables
#                    `on_off` and `on_off_p` on one page, so the postseason
#                    costs no extra request; present for every playoff team
#                    probed back to CHI 1998. The Opponent group's
#                    `opp_off_rtg` on the `On Court` row IS points allowed per
#                    100 possessions with the player on the floor (Draymond
#                    Green 2015-16: 100.2 on, 112.9 off), with `mp` and
#                    `opp_pace` beside it. Reaches 1996-97, five seasons past
#                    pbpstats, on the one host this pipeline already scrapes
#                    daily, and its player cells carry /players/ hrefs so rows
#                    join by slug with no name matching. BR estimates
#                    possessions where pbpstats counts them (~1 pt/100).
#   shufinskiy/nba_data  THE FALLBACK. Raw stats.nba.com play-by-play as
#                    static GitHub files, 1996-97 on, both season types,
#                    0.4-0.6 MB a postseason, sub-second fetches, with
#                    EVENTMSGTYPE 8 substitutions intact — so on-court lineups
#                    are reconstructible with no live API. That reconstruction
#                    is the whole cost, which is why it ranks behind BR.
#
# ROUND 3 — why the bake still can't fetch what this probe can.
#
# Bake run #8 failed 2005-06 with the same missing-OpponentPoints column set
# this probe got a clean answer for 48 minutes earlier, on a byte-identical
# query. So the subsetting is neither per-season nor stale. The one systematic
# difference is what the two do on RETRY: the probe re-asks the same plain
# URL, while fetch_parsed appends a CacheBust param, making every retry a
# first-ever request for a brand-new cache key. If pbpstats computes a cheap
# column subset on a cold key and fills the rest in behind it, then cache
# busting is not a workaround for the failure — it is the cause of it, and
# run #6 fixed the problem in exactly the wrong direction.
#
# So: hammer one known-bad season two ways, plain vs cache-busted, and print
# the column verdict for every single attempt.
#
#   Rscript scripts/R/probe_def_sources.R

source(file.path(dirname(sub("^--file=", "",
  grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "scrape_common.R"))

hdr <- function(s) message("\n=== ", s, " ", strrep("=", max(0, 62 - nchar(s))))
inf <- function(...) message("         ", sprintf(...))

WANT <- c("OpponentPoints", "PtsAllowed", "OppPts")

# One request; returns "yes"/"no"/an error string, plus the column count.
attempt <- function(season, season_type, bust = NULL) {
  q <- list(Season = season, SeasonType = season_type, Type = "Player")
  if (!is.null(bust)) q$CacheBust <- bust
  res <- tryCatch(httr::GET("https://api.pbpstats.com/get-totals/nba", query = q,
    httr::timeout(60), httr::user_agent(UA),
    httr::add_headers(Accept = "application/json")), error = function(e) e)
  if (inherits(res, "error")) return(list(v = "ERR", n = 0, why = conditionMessage(res)))
  if (httr::status_code(res) != 200) return(list(v = "ERR", n = 0, why = paste("HTTP", httr::status_code(res))))
  rows <- jsonlite::fromJSON(httr::content(res, as = "text", encoding = "UTF-8"),
                             simplifyVector = FALSE)$multi_row_table_data
  if (is.null(rows) || !length(rows)) return(list(v = "ERR", n = 0, why = "no rows"))
  k <- names(rows[[1]])
  list(v = if (any(WANT %in% k)) "HAS" else "MISSING", n = length(k), why = "")
}

# Ten attempts, alternating the two retry strategies the bake could use, on a
# season the bake has never once fetched. Same delay either way, so the only
# difference between the two series is the cache key.
run_series <- function(season, season_type, label, bust) {
  hdr(sprintf("%s %s - %s", season, season_type, label))
  for (i in 1:6) {
    a <- attempt(season, season_type, if (bust) sprintf("%d%d", as.integer(Sys.time()), i) else NULL)
    inf("attempt %d: %-7s (%d columns)%s", i, a$v, a$n, if (nzchar(a$why)) paste0(" - ", a$why) else "")
    Sys.sleep(6)
  }
}

run_series("2005-06", "Regular Season", "PLAIN url, repeated verbatim", FALSE)
run_series("2005-06", "Regular Season", "CACHE-BUSTED url (what fetch_parsed does)", TRUE)
run_series("2011-12", "Playoffs", "PLAIN url, repeated verbatim", FALSE)

message("\nProbe complete.")
