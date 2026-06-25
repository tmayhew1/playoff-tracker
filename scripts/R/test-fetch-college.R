#!/usr/bin/env Rscript
# Offline test for the per-school college scraper. Builds a synthetic school
# index page + a school season page, stubs the network, and checks: the index
# yields school slugs/names, a school's Totals table parses into players tagged
# with their school, and VA ranks the dominant player first. No network.
#
#   Rscript scripts/R/test-fetch-college.R

dir <- dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))
source(file.path(dir, "scrape_common.R"))
source(file.path(dir, "fetch_college.R"))  # guarded: defines functions only

# --- fixtures ---
school_link <- function(slug, name)
  sprintf('<tr><td data-stat="school_name"><a href="/cbb/schools/%s/men/2026.html">%s</a></td><td data-stat="wins">20</td></tr>', slug, name)
index_html <- paste0('<html><body><table id="basic_school_stats"><tbody>',
  school_link("duke", "Duke"), school_link("ucla", "UCLA"), '</tbody></table></body></html>')

prow <- function(slug, name, g, mp, pts, ast, stl, blk, tov, drb, orb, fg, fga, fg3, fg3a, ft, fta)
  sprintf(paste0(
    '<tr><th data-stat="player"><a href="/cbb/players/%s.html">%s</a></th>',
    '<td data-stat="g">%d</td><td data-stat="mp">%d</td><td data-stat="pts">%d</td>',
    '<td data-stat="ast">%d</td><td data-stat="stl">%d</td><td data-stat="blk">%d</td>',
    '<td data-stat="tov">%d</td><td data-stat="drb">%d</td><td data-stat="orb">%d</td>',
    '<td data-stat="fg">%d</td><td data-stat="fga">%d</td><td data-stat="fg3">%d</td>',
    '<td data-stat="fg3a">%d</td><td data-stat="ft">%d</td><td data-stat="fta">%d</td></tr>'),
    slug, name, g, mp, pts, ast, stl, blk, tov, drb, orb, fg, fga, fg3, fg3a, ft, fta)
# A school page carries a per-game table AND a totals table; we must pick totals.
# The totals table is wrapped in a comment, like SR lazy-loads it.
totals_tbl <- paste0('<table id="totals"><tbody>',
  prow("starxx-1", "Star Player", 34, 1150, 820, 150, 60, 40, 70, 180, 40, 280, 520, 90, 220, 170, 200),
  '<tr class="thead"><td>x</td></tr>',
  prow("rolexx-1", "Role Player", 33, 900, 360, 90, 30, 15, 55, 120, 30, 130, 300, 40, 120, 60, 90),
  '</tbody></table>')
school_html <- paste0('<html><body>',
  '<table id="per_game"><tbody>', prow("starxx-1", "Star Player", 34, 34, 24, 4, 2, 1, 2, 5, 1, 8, 15, 3, 6, 5, 6), '</tbody></table>',
  '<!-- ', totals_tbl, ' --></body></html>')

throttled_fetch <- function(url) if (grepl("school-stats", url)) index_html else school_html

# --- index ---
schools <- fetch_school_index(2026)
cat(sprintf("schools: %d -> %s\n", length(schools), paste(vapply(schools, function(s) s$slug, ""), collapse = ", ")))
stopifnot(length(schools) == 2, schools[[1]]$slug == "duke", schools[[1]]$name == "Duke", schools[[2]]$slug == "ucla")

# --- one school's players (must read the TOTALS table, not per_game) ---
players <- fetch_school_players(schools[[1]], 2026)
cat(sprintf("duke players: %d\n", length(players)))
stopifnot(length(players) == 2)
star <- Filter(function(p) p$name == "Star Player", players)[[1]]
stopifnot(star$school == "Duke", star$pts == 820, star$slug == "starxx-1", star$mp == 1150)  # 1150 => totals table, not per_game(34)

# --- VA ranks the dominant player first ---
totals <- list(mp = 0, pts = 0, ast = 0, stl = 0, blk = 0, tov = 0, drb = 0,
               orb = 0, fgm = 0, fga = 0, tpm = 0, tpa = 0, ftm = 0, fta = 0)
for (p in players) for (k in names(totals)) totals[[k]] <- totals[[k]] + (p[[k]] %||% 0)
lga <- lga_from_totals(totals)
ranked <- players[order(vapply(players, function(p) value_add_parts(p, lga)$va, numeric(1)), decreasing = TRUE)]
cat("VA order:", paste(vapply(ranked, function(p) p$name, ""), collapse = " > "), "\n")
stopifnot(ranked[[1]]$name == "Star Player")

cat("ALL ASSERTIONS PASSED\n")
