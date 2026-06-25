#!/usr/bin/env Rscript
# Offline test for the per-school college scraper. Builds synthetic pages,
# stubs the network, and checks: the index yields school slugs/names; the
# column-based table finder prefers the season-TOTALS table (bare data-stat=pts)
# over the per-game table (pts_per_g); and falls back to per-game (x games) when
# only per-game exists. No network.
#
#   Rscript scripts/R/test-fetch-college.R

dir <- dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))
source(file.path(dir, "scrape_common.R"))
source(file.path(dir, "fetch_college.R"))  # guarded: defines functions only

# --- index fixture ---
school_link <- function(slug, name)
  sprintf('<tr><td data-stat="school_name"><a href="/cbb/schools/%s/men/2026.html">%s</a></td><td data-stat="wins">20</td></tr>', slug, name)
index_html <- paste0('<html><body><table id="basic_school_stats"><tbody>',
  school_link("duke", "Duke"), school_link("ucla", "UCLA"), '</tbody></table></body></html>')

# totals row (bare data-stats) and per-game row (_per_g data-stats)
cell <- function(stat, v) sprintf('<td data-stat="%s">%s</td>', stat, v)
trow <- function(slug, name, g, mp, pts, ast, stl, blk, tov, drb, orb, fg, fga, fg3, fg3a, ft, fta)
  paste0(sprintf('<tr><th data-stat="player"><a href="/cbb/players/%s.html">%s</a></th>', slug, name),
    cell("g", g), cell("mp", mp), cell("pts", pts), cell("ast", ast), cell("stl", stl), cell("blk", blk),
    cell("tov", tov), cell("drb", drb), cell("orb", orb), cell("fg", fg), cell("fga", fga),
    cell("fg3", fg3), cell("fg3a", fg3a), cell("ft", ft), cell("fta", fta), '</tr>')
pgrow <- function(slug, name, g, mp, pts)
  paste0(sprintf('<tr><th data-stat="player"><a href="/cbb/players/%s.html">%s</a></th>', slug, name),
    cell("g", g), cell("mp_per_g", mp), cell("pts_per_g", pts), '</tr>')

pg_table <- paste0('<table id="per_game"><tbody>',
  pgrow("starxx-1", "Star Player", 34, 33.8, 24.1), '</tbody></table>')
totals_table <- paste0('<table id="season-totals"><tbody>',
  trow("starxx-1", "Star Player", 34, 1150, 820, 150, 60, 40, 70, 180, 40, 280, 520, 90, 220, 170, 200),
  '<tr class="thead"><td>x</td></tr>',
  trow("rolexx-1", "Role Player", 33, 900, 360, 90, 30, 15, 55, 120, 30, 130, 300, 40, 120, 60, 90),
  '</tbody></table>')
# Per-game visible, totals hidden in a comment (as SR lazy-loads it).
school_html <- paste0('<html><body>', pg_table, '<!-- ', totals_table, ' --></body></html>')
# A school that only exposes a per-game table -> exercises the fallback.
pg_only_html <- paste0('<html><body>', pg_table, '</body></html>')

mode <- "both"
throttled_fetch <- function(url) {
  if (grepl("school-stats", url)) return(index_html)
  if (mode == "pg_only") return(pg_only_html)
  school_html
}

# --- index ---
schools <- fetch_school_index(2026)
cat(sprintf("schools: %d -> %s\n", length(schools), paste(vapply(schools, function(s) s$slug, ""), collapse = ", ")))
stopifnot(length(schools) == 2, schools[[1]]$slug == "duke", schools[[1]]$name == "Duke")

# --- prefers the TOTALS table (bare pts), not per_game ---
players <- fetch_school_players(schools[[1]], 2026)
cat(sprintf("duke players: %d\n", length(players)))
stopifnot(length(players) == 2)
star <- Filter(function(p) p$name == "Star Player", players)[[1]]
stopifnot(star$school == "Duke", star$pts == 820, star$mp == 1150, star$slug == "starxx-1")  # 1150 => totals, not per_game

# --- VA ranks the dominant player first ---
totals <- list(mp = 0, pts = 0, ast = 0, stl = 0, blk = 0, tov = 0, drb = 0,
               orb = 0, fgm = 0, fga = 0, tpm = 0, tpa = 0, ftm = 0, fta = 0)
for (p in players) for (k in names(totals)) totals[[k]] <- totals[[k]] + (p[[k]] %||% 0)
lga <- lga_from_totals(totals)
ranked <- players[order(vapply(players, function(p) value_add_parts(p, lga)$va, numeric(1)), decreasing = TRUE)]
cat("VA order:", paste(vapply(ranked, function(p) p$name, ""), collapse = " > "), "\n")
stopifnot(ranked[[1]]$name == "Star Player")

# --- fallback: per-game-only page reconstructs totals (value x games) ---
mode <- "pg_only"
pg_players <- fetch_school_players(schools[[1]], 2026)
stopifnot(length(pg_players) == 1)
pg_star <- pg_players[[1]]
cat(sprintf("pg fallback: mp=%.1f pts=%.1f (expect ~1149, ~819)\n", pg_star$mp, pg_star$pts))
stopifnot(abs(pg_star$mp - 33.8 * 34) < 0.01, abs(pg_star$pts - 24.1 * 34) < 0.01)

cat("ALL ASSERTIONS PASSED\n")
