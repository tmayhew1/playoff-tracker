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

# --- Value Added -----------------------------------------------------------
# Translated 1:1 from app/scoring.js valueAddParts (and the matching copy in
# app/api/leaderboard/route.js). KEEP IN SYNC with those JS definitions.
# `lga` is one season's entry from league-averages.json.
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
  astVal <- ((p$ast / mp) - lga$laASTperM) * mp * lga$laPTSperMake * (1 - lga$laFG)
  stlVal <- ((p$stl / mp) - lga$laSTLperM) * mp * lga$laPTSperPoss
  blkVal <- ((p$blk / mp) - lga$laBLKperM) * mp * lga$laPTSperPoss * lga$laDRBrate
  tovVal <- -((p$tov / mp) - lga$laTOVperM) * mp * lga$laPTSperPoss
  drbVal <- ((p$drb / mp) - lga$laDRBperM) * 1.25 * mp * lga$laPTSperPoss * lga$laORBrate
  orbVal <- ((p$orb / mp) - lga$laORBperM) * 1.25 * mp * lga$laPTSperPoss * lga$laDRBrate
  list(va = volume + efficiency + astVal + stlVal + blkVal + tovVal + drbVal + orbVal,
       efficiency = efficiency)
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
