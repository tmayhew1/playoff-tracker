#!/usr/bin/env Rscript
# Offline test for the college totals parser + VA ranking. Builds a synthetic
# CBB season-totals page, stubs the network, and checks fetch_player_totals
# parses every player and that VA ranks the dominant player first. No network.
#
#   Rscript scripts/R/test-fetch-college.R

dir <- dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))
source(file.path(dir, "scrape_common.R"))
source(file.path(dir, "fetch_college.R"))  # guarded: defines functions only

row <- function(slug, name, school, g, mp, pts, ast, stl, blk, tov, drb, orb, fg, fga, fg3, fg3a, ft, fta)
  sprintf(paste0(
    '<tr><th data-stat="player"><a href="/cbb/players/%s.html">%s</a></th>',
    '<td data-stat="school_name"><a href="/cbb/schools/x/2026.html">%s</a></td>',
    '<td data-stat="g">%d</td><td data-stat="mp">%d</td><td data-stat="pts">%d</td>',
    '<td data-stat="ast">%d</td><td data-stat="stl">%d</td><td data-stat="blk">%d</td>',
    '<td data-stat="tov">%d</td><td data-stat="drb">%d</td><td data-stat="orb">%d</td>',
    '<td data-stat="fg">%d</td><td data-stat="fga">%d</td><td data-stat="fg3">%d</td>',
    '<td data-stat="fg3a">%d</td><td data-stat="ft">%d</td><td data-stat="fta">%d</td></tr>'),
    slug, name, school, g, mp, pts, ast, stl, blk, tov, drb, orb, fg, fga, fg3, fg3a, ft, fta)

# header row carries the data-stat columns find_totals_table looks for
thead <- '<thead><tr><th data-stat="player">Player</th><th data-stat="g">G</th><th data-stat="mp">MP</th><th data-stat="pts">PTS</th></tr></thead>'
rows <- paste0(
  row("starxx-1", "Star Player", "Duke", 34, 1150, 820, 150, 60, 40, 70, 180, 40, 280, 520, 90, 220, 170, 200),
  # repeated mid-table header (must be skipped)
  '<tr class="thead"><td>x</td></tr>',
  row("rolexx-1", "Role Player", "UCLA", 33, 900, 360, 90, 30, 15, 55, 120, 30, 130, 300, 40, 120, 60, 90),
  row("benchxx-1", "Bench Guy", "Iowa", 30, 400, 120, 40, 10, 5, 40, 60, 20, 45, 130, 15, 55, 15, 30)
)
html <- paste0('<html><body><table id="totals">', thead, '<tbody>', rows, '</tbody></table></body></html>')

throttled_fetch <- function(url) html   # network stub (page 2 dedupes -> stop)

players <- fetch_player_totals(2026)
cat(sprintf("parsed players: %d\n", length(players)))
stopifnot(length(players) == 3)
star <- Filter(function(p) p$name == "Star Player", players)[[1]]
stopifnot(star$school == "Duke", star$gp == 34, star$pts == 820, star$slug == "starxx-1")

# League baselines from the summed totals, then VA per player.
totals <- list(mp = 0, pts = 0, ast = 0, stl = 0, blk = 0, tov = 0, drb = 0,
               orb = 0, fgm = 0, fga = 0, tpm = 0, tpa = 0, ftm = 0, fta = 0)
for (p in players) for (k in names(totals)) totals[[k]] <- totals[[k]] + (p[[k]] %||% 0)
lga <- lga_from_totals(totals)
ranked <- players
ranked <- ranked[order(vapply(ranked, function(p) value_add_parts(p, lga)$va, numeric(1)), decreasing = TRUE)]
cat("VA order:", paste(vapply(ranked, function(p) p$name, ""), collapse = " > "), "\n")
# The dominant player must rank first; relative order of the rest depends on the
# (tiny, synthetic) league baselines and isn't a meaningful invariant here.
stopifnot(ranked[[1]]$name == "Star Player", length(ranked) == 3)

cat("ALL ASSERTIONS PASSED\n")
