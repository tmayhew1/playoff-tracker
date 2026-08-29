# Shared helpers for the R historical-data pipeline.
#
# These mirror the logic the (retired) Node scrapers used so the JSON the
# app reads stays identical in shape. Scrapes basketball-reference.com.
#
# Sourced by fetch_league_averages.R, fetch_historical.R, daily_backfill.R.

suppressWarnings(suppressMessages({
  library(httr)
  library(xml2)
  library(jsonlite)
}))

# --- Paths -----------------------------------------------------------------
# ROOT is resolved relative to this file so the scripts work from any CWD.
.this_file <- local({
  args <- commandArgs(trailingOnly = FALSE)
  m <- grep("^--file=", args, value = TRUE)
  if (length(m)) normalizePath(sub("^--file=", "", m[1]))
  else if (!is.null(sys.frames()[[1]]$ofile)) normalizePath(sys.frames()[[1]]$ofile)
  else file.path(getwd(), "scripts", "R", "scrape_common.R")
})
R_DIR    <- dirname(.this_file)
ROOT     <- normalizePath(file.path(R_DIR, "..", ".."))
DATA_DIR <- file.path(ROOT, "app", "data")
LGA_PATH <- file.path(DATA_DIR, "league-averages.json")

# --- HTTP (polite, throttled, mirrors the Node 2.5s spacing) ---------------
UA <- paste0(
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ",
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
REQUEST_DELAY_MS <- 2500
.last_request <- 0  # epoch ms of the previous request

# GET with BR-friendly throttling. Sleeps to keep >=2.5s between calls and
# backs off 60s on 429/503 (BR's rate-limit responses), then retries.
throttled_fetch <- function(url) {
  wait <- REQUEST_DELAY_MS - (as.numeric(Sys.time()) * 1000 - .last_request)
  if (wait > 0) Sys.sleep(wait / 1000)
  .last_request <<- as.numeric(Sys.time()) * 1000
  res <- httr::GET(url, httr::user_agent(UA), httr::add_headers(Accept = "text/html"))
  st <- httr::status_code(res)
  if (st == 429 || st == 503) {
    message(sprintf("  %d on %s - sleeping 60s", st, url))
    Sys.sleep(60)
    return(throttled_fetch(url))
  }
  if (st >= 400) stop(sprintf("HTTP %d %s", st, url))
  httr::content(res, as = "text", encoding = "UTF-8")
}

# BR defers some tables by wrapping them in HTML comments. Stripping the
# comment markers (keeping the inner markup) makes those tables parseable,
# exactly like the Node `replace(/<!--...-->/, "$1")` trick.
parse_html_uncommented <- function(html) {
  html <- gsub("<!--", "", html, fixed = TRUE)
  html <- gsub("-->",  "", html, fixed = TRUE)
  xml2::read_html(html)
}

# --- Small parsers ---------------------------------------------------------
num <- function(v) {
  n <- suppressWarnings(as.numeric(trimws(as.character(v))))
  if (length(n) == 0 || is.na(n)) 0 else n
}

# "MM:SS" -> minutes as float; bare numbers pass through.
parse_minutes <- function(v) {
  if (is.null(v) || is.na(v) || v == "") return(0)
  s <- trimws(as.character(v))
  if (grepl(":", s, fixed = TRUE)) {
    parts <- strsplit(s, ":", fixed = TRUE)[[1]]
    return((suppressWarnings(as.integer(parts[1])) %||% 0) +
           (suppressWarnings(as.numeric(parts[2])) %||% 0) / 60)
  }
  num(s)
}

`%||%` <- function(a, b) if (is.null(a) || length(a) == 0 || is.na(a)) b else a

# --- Positional (header-driven) column lookup -------------------------------
# Some BR pages (the per-season "Shooting" stats table) group several columns
# under a shared over-header ("% of FGA by Distance", "FG% by Distance"),
# repeating leaf labels ("0-3", "3-10", ...) under each group. The internal
# data-stat attribute names for those leaf columns aren't documented and BR's
# markup has churned before, so cell_text()'s data-stat lookup isn't a safe
# bet here. These two helpers instead resolve columns by their VISIBLE header
# text, which is far more stable, then read body cells by position.

# Normalized form of a header label for fuzzy matching ("16-3P" -> "163p"),
# collapsing hyphen/en-dash/whitespace differences BR might use across eras.
# Vectorized (called on a whole header-label vector), so this can't use the
# scalar %||% helper — ifelse() handles an NA element without erroring.
norm_label <- function(s) tolower(gsub("[^0-9a-zA-Z]", "", ifelse(is.na(s), "", s)))

# Resolve a table's <thead> (one or two header rows) into one leaf label per
# body column, in document order. A single-row header just expands each
# cell's colspan; a two-row header treats the second-to-last row as group
# headers (rowspan=2 cells belong to no group and pass straight through) and
# the last row as the leaf labels filling the remaining (non-rowspan) slots.
# Body rows in these stat tables are always one flat cell per column, so the
# returned index lines up directly with cell_text_at()'s position.
header_leaf_labels <- function(table) {
  head_rows <- xml2::xml_find_all(table, ".//thead/tr")
  if (length(head_rows) == 0) return(character(0))
  get_cells <- function(tr) {
    nodes <- xml2::xml_find_all(tr, "./th | ./td")
    span <- function(attr) vapply(nodes, function(n) {
      v <- xml2::xml_attr(n, attr); if (is.na(v)) 1L else as.integer(v)
    }, integer(1))
    list(text = trimws(xml2::xml_text(nodes)), colspan = span("colspan"), rowspan = span("rowspan"))
  }
  if (length(head_rows) == 1) {
    c1 <- get_cells(head_rows[[1]])
    return(unlist(Map(function(t, n) rep(t, n), c1$text, c1$colspan), use.names = FALSE))
  }
  r1 <- get_cells(head_rows[[length(head_rows) - 1L]])
  r2 <- get_cells(head_rows[[length(head_rows)]])
  labels <- character(0)
  r2_i <- 1L
  for (i in seq_along(r1$text)) {
    if (r1$rowspan[i] >= 2L) {
      labels <- c(labels, rep(r1$text[i], r1$colspan[i]))
    } else {
      for (k in seq_len(r1$colspan[i])) {
        lbl <- if (r2_i <= length(r2$text)) r2$text[r2_i] else r1$text[i]
        labels <- c(labels, lbl)
        r2_i <- r2_i + 1L
      }
    }
  }
  labels
}

# The idx-th (1-based) th/td in a body row's own document order — matches
# header_leaf_labels()'s column index one-for-one.
cell_text_at <- function(tr, idx) {
  nodes <- xml2::xml_find_all(tr, "./th | ./td")
  if (idx < 1 || idx > length(nodes)) return("")
  trimws(xml2::xml_text(nodes[[idx]]))
}

# Text of the first cell matching any of the given data-stat keys, "" if none.
# Matches th or td (player name lives in a th).
cell_text <- function(tr, keys) {
  for (k in keys) {
    n <- xml2::xml_find_first(tr, sprintf(".//*[@data-stat='%s']", k))
    v <- xml2::xml_text(n)
    if (!is.na(v)) {
      v <- trimws(v)
      if (nzchar(v)) return(v)
    }
  }
  ""
}

# --- Tricodes: BR -> the NBA-current set the app knows ---------------------
BR_TO_NBA <- c(BRK = "BKN", CHO = "CHA", CHH = "CHA",
               NOH = "NOP", NOK = "NOP", PHO = "PHX")
to_nba <- function(tri) {
  out <- BR_TO_NBA[tri]
  ifelse(is.na(out), tri, unname(out))
}

# --- Bracket shape ---------------------------------------------------------
# Round and series length, derived from the games rather than from the series'
# position in the list. The positional rule this replaces (i < 8 -> r1,
# i < 12 -> r2, ...) assumed an 8-4-2-1 bracket and mislabelled every 12-team
# season: 1980-81 through 1982-83 ran 4-4-2-1, so their Conference Finals and
# Finals were all tagged as earlier rounds.
#
#   bestOf      = 2 * (games won by the series winner) - 1. A series stops the
#                 moment its winner clinches, so his win total IS the clinching
#                 number. Recovers {3, 5, 7} and every era rule for free.
#   roundsAfter = follow each winner forward to his next series. Only the
#                 champion has none, so a finished bracket has one terminal.
#                 Byes need no special case: a 1981 team idle through the
#                 opening round simply enters with roundsAfter = 2.
#   round       = depth - roundsAfter, depth = max(roundsAfter) + 1
#
# Mirrors app/lib/leverage.js::bracketShape. `series_list` elements need
# $games, each with $date, $home$tri, $home$score, $away$tri, $away$score.
derive_rounds <- function(series_list) {
  n <- length(series_list)
  if (n == 0) return(list(round = integer(0), bestOf = integer(0), depth = 0L))

  game_winner <- function(g) if (g$home$score > g$away$score) g$home$tri else g$away$tri
  wins_of <- function(s) {
    w <- list()
    for (g in s$games) { t <- game_winner(g); w[[t]] <- (w[[t]] %||% 0) + 1 }
    w
  }

  winner <- character(n); best_of <- integer(n)
  starts <- character(n); ends <- character(n)
  teams_of <- vector("list", n)
  for (i in seq_len(n)) {
    s <- series_list[[i]]
    w <- wins_of(s)
    top <- 0; who <- NA_character_
    for (t in names(w)) if (w[[t]] > top) { top <- w[[t]]; who <- t }
    winner[i] <- who
    best_of[i] <- if (top > 0) as.integer(2 * top - 1) else 7L
    d <- vapply(s$games, function(g) as.character(g$date), character(1))
    starts[i] <- min(d); ends[i] <- max(d)
    teams_of[[i]] <- c(s$games[[1]]$home$tri, s$games[[1]]$away$tri)
  }

  nxt <- integer(n)
  for (i in seq_len(n)) {
    nxt[i] <- -1L
    if (is.na(winner[i])) next
    for (j in seq_len(n)) {
      if (j == i) next
      if (!(winner[i] %in% teams_of[[j]])) next
      if (starts[j] < ends[i]) next
      if (nxt[i] == -1L || starts[j] < starts[nxt[i]]) nxt[i] <- j
    }
  }

  rounds_after <- rep(NA_integer_, n)
  walk <- function(i, seen) {
    if (!is.na(rounds_after[i])) return(rounds_after[i])
    if (i %in% seen) return(0L)
    j <- nxt[i]
    v <- if (j == -1L) 0L else walk(j, c(seen, i)) + 1L
    rounds_after[i] <<- v
    v
  }
  for (i in seq_len(n)) walk(i, integer(0))

  depth <- max(rounds_after) + 1L
  list(round = as.integer(depth - rounds_after), bestOf = best_of, depth = depth)
}

# Rebound credit: the multiplier on a board's possession value. If a player
# claims a fraction q of the rebounds available at his end, removing him raises
# his team's chance of losing the possession by exactly 1/(1 - q). q comes off
# his own line against a league opportunity rate (laREBoppPerM), so VA stays
# context-free. The league-average player has q = 0.2 * rho, giving
# 1/(1 - 0.2*rho) = 5/(5 - rho) -- also the fallback for seasons baked before
# laREBoppPerM existed. Mirrors app/scoring.js::reboundGamma exactly.
REB_Q_MAX <- 0.5

rebound_gamma <- function(reb, mp, lga, rate) {
  opp <- lga$laREBoppPerM %||% 0
  if (is.null(opp) || is.na(opp) || opp <= 0 || is.na(mp) || mp <= 0) return(5 / (5 - rate))
  1 / (1 - min(max(((reb %||% 0) / mp) / opp, 0), REB_Q_MAX))
}

# --- Value Added -----------------------------------------------------------
# Translated 1:1 from app/scoring.js valueAddParts (and the matching copy in
# app/api/leaderboard/route.js). KEEP IN SYNC with those JS definitions.
# `lga` is one season's entry from league-averages.json.
#
# The USG-ADJ scoring baseline (spec section 4.6) is deliberately NOT here: it
# is a reading the app switches on at display time, and everything baked stays
# on the standard baseline. The client re-prices what these bakes emit, which
# it can do in closed form because that term is linear in MP and USG. So the
# `volume` line below still matches app/scoring.js with the mode off, which is
# the only mode the bake ever sees.
.den <- function(x) if (is.na(x) || x == 0) 1 else x  # JS `x || 1`

value_add_parts <- function(p, lga) {
  mp <- p$mp
  if (is.null(mp) || is.na(mp) || mp <= 0) return(list(va = 0, efficiency = 0))
  twoPm <- p$fgm - p$tpm; twoPa <- p$fga - p$tpa
  tpAdd  <- ((p$tpm / .den(p$tpa)) - lga$la3P) * p$tpa
  twoAdd <- ((twoPm / .den(twoPa)) - lga$la2P) * twoPa
  ftAdd  <- ((p$ftm / .den(p$fta)) - lga$laFT) * p$fta
  volume <- ((p$pts / mp) - lga$laPTSperM) * mp
  efficiency <- 3 * tpAdd + 2 * twoAdd + ftAdd
  # Assist price (spec section 4.2a): (kappa - pi) * (1 - p_G). An assist does
  # not create a possession -- the possession already existed and would have
  # returned pi -- so the surplus the pass produced is kappa - pi, not kappa,
  # and the passer's share of it is the same (1 - p_G) as before. This is the
  # only event price in VA that was not possession-denominated.
  # KEEP IN SYNC with assistPrice() in app/scoring.js.
  astPrice <- (lga$laPTSperMake - lga$laPTSperPoss) * (1 - lga$laFG)
  astVal <- ((p$ast / mp) - lga$laASTperM) * mp * astPrice
  stlVal <- ((p$stl / mp) - lga$laSTLperM) * mp * lga$laPTSperPoss
  blkVal <- ((p$blk / mp) - lga$laBLKperM) * mp * lga$laPTSperPoss * lga$laDRBrate
  tovVal <- -((p$tov / mp) - lga$laTOVperM) * mp * lga$laPTSperPoss
  drbVal <- ((p$drb / mp) - lga$laDRBperM) * rebound_gamma(p$drb, mp, lga, lga$laDRBrate) * mp * lga$laPTSperPoss * lga$laORBrate
  orbVal <- ((p$orb / mp) - lga$laORBperM) * rebound_gamma(p$orb, mp, lga, lga$laORBrate) * mp * lga$laPTSperPoss * lga$laDRBrate
  list(va = volume + efficiency + astVal + stlVal + blkVal + tovVal + drbVal + orbVal,
       efficiency = efficiency)
}

# League rates from summed raw totals (player- or team-level; only ratios are
# used, so the level doesn't matter). Shared by fetch_league_averages.R and
# recompute_derived.R; fetch_college.R keeps its own copy to stay self-contained.
lga_from_totals <- function(t) {
  safe <- function(a, b) if (b > 0) a / b else 0
  twoPm <- t$fgm - t$tpm
  twoPa <- t$fga - t$tpa
  reb <- t$drb + t$orb
  # Hollinger possessions estimate: FGA - ORB + TO + 0.475*FTA.
  poss <- t$fga - t$orb + t$tov + 0.475 * t$fta
  list(
    # Possessions per on-court minute: mp sums PLAYER minutes (5 per team
    # minute), so 5*poss/mp = possessions per team-minute (= pace/48). This
    # scales a player's minutes into possessions defended — the normalizer
    # for the D-Rating category behind VA+.
    laPOSSperM = safe(5 * poss, t$mp),
    # Rebound opportunities per on-court minute at ONE end: every rebound in
    # the game happens at one end or the other, so a player on the floor sees
    # (TRB per team-minute) chances at his own end. Denominator for the
    # per-player rebound credit (rebound_gamma). Identity check:
    # laDRBrate = d/(d+o) recovers exactly from these sums.
    laREBoppPerM = safe(5 * reb, t$mp),
    la3P = safe(t$tpm, t$tpa),
    la2P = safe(twoPm, twoPa),
    laFT = safe(t$ftm, t$fta),
    laFG = safe(t$fgm, t$fga),
    laPTSperM = safe(t$pts, t$mp),
    laASTperM = safe(t$ast, t$mp),
    laSTLperM = safe(t$stl, t$mp),
    laBLKperM = safe(t$blk, t$mp),
    laTOVperM = safe(t$tov, t$mp),
    laDRBperM = safe(t$drb, t$mp),
    laORBperM = safe(t$orb, t$mp),
    laPTSperMake = safe(t$pts, t$fgm),
    laPTSperPoss = safe(t$pts, poss),
    laDRBrate = safe(t$drb, reb),
    laORBrate = safe(t$orb, reb)
  )
}

# Minutes-weighted median of a per-minute rate: the rate of the median league
# MINUTE. Splits the league's minutes in half - half of all NBA minutes are
# played at a higher rate, half lower. Preferred over the plain per-player
# median because it doesn't let 40-minute-per-season call-ups outvote
# starters, and over the aggregate mean because a handful of high-usage stars
# skew that upward. (To switch to the plain per-player median: replace the
# cumulative-minutes step with the middle element of `rate[o]`.)
weighted_median_rate <- function(stat, mp) {
  keep <- mp > 0
  stat <- stat[keep]; mp <- mp[keep]
  if (!length(mp)) return(0)
  rate <- stat / mp
  o <- order(rate)
  cum <- cumsum(mp[o])
  rate[o][which(cum >= cum[length(cum)] / 2)[1]]
}

# League baselines from per-player season rows. Per-minute baselines are the
# minutes-weighted MEDIAN player rate (skew-resistant, per the app's VA
# definition); shooting percentages and the conversion constants (points per
# make / per possession, rebound shares) stay aggregate ratios, since those
# translate stats into points rather than define "typical".
lga_from_players <- function(players) {
  g <- function(k) vapply(players, function(p) as.numeric(p[[k]] %||% 0), numeric(1))
  mp <- g("mp")
  totals <- list()
  for (k in c("mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb",
              "fgm", "fga", "tpm", "tpa", "ftm", "fta")) {
    totals[[k]] <- sum(g(k))
  }
  base <- lga_from_totals(totals)
  base$laPTSperM <- weighted_median_rate(g("pts"), mp)
  base$laASTperM <- weighted_median_rate(g("ast"), mp)
  base$laSTLperM <- weighted_median_rate(g("stl"), mp)
  base$laBLKperM <- weighted_median_rate(g("blk"), mp)
  base$laTOVperM <- weighted_median_rate(g("tov"), mp)
  base$laDRBperM <- weighted_median_rate(g("drb"), mp)
  base$laORBperM <- weighted_median_rate(g("orb"), mp)
  base
}

# Sanity band for a season's scoring baseline (median points per player-
# minute). Weighted medians across 1980-2026 live between ~0.37 (dead-ball
# early 00s) and ~0.46 (80s pace / modern era); the band catches mis-parsed
# source tables, which land far outside it. Used both to refuse writing junk
# and to spot existing junk that needs a refetch.
lga_plausible <- function(l) {
  !is.null(l) && !is.null(l$laPTSperM) && l$laPTSperM > 0.33 && l$laPTSperM < 0.52
}

# --- League averages -------------------------------------------------------
load_league_averages <- function() {
  if (!file.exists(LGA_PATH)) return(list())
  jsonlite::fromJSON(LGA_PATH, simplifyVector = FALSE)
}

# --- JSON output (matches JSON.stringify(obj, null, 2) + "\n") --------------
# auto_unbox keeps scalars scalar; digits=NA keeps full numeric precision;
# named lists preserve key order; prettify gives stable 2-space indentation.
write_json_pretty <- function(obj, path) {
  # digits=17 is round-trip safe for IEEE doubles (preserves the exact value;
  # the string repr can differ from JS's shortest form, but parses identically).
  js <- jsonlite::toJSON(obj, auto_unbox = TRUE, null = "null",
                         na = "null", digits = 17)
  js <- jsonlite::prettify(js, indent = 2)
  js <- sub("[\r\n]+$", "", js)  # prettify already appends a newline; normalize
  con <- file(path, open = "wb")
  on.exit(close(con))
  writeBin(charToRaw(paste0(js, "\n")), con)
  invisible(path)
}

# Season helpers: "2014-15" <-> end calendar year (2015).
season_end_year <- function(season) as.integer(substr(season, 1, 4)) + 1L
make_season <- function(start_year) {
  sprintf("%d-%02d", start_year, (start_year + 1L) %% 100L)
}
