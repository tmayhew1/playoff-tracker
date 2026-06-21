#!/usr/bin/env Rscript
# Offline regression test for the box-score parser. Builds a synthetic BR-like
# box page (deliberately broken scorebox; one team's table hidden in an HTML
# comment, as BR lazy-loads it) and checks fetch_box derives team identity and
# scores from the gameId + table totals -- never the scorebox.
#
#   Rscript scripts/R/test-fetch-box.R
#
# No network. Exits non-zero on any assertion failure.

dir <- dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))
source(file.path(dir, "scrape_common.R"))
source(file.path(dir, "fetch_historical.R"))  # guarded: defines functions only

mk <- function(slug, name, mp, pts, trb, drb, orb, ast, stl, blk, tov, fg, fga, fg3, fg3a, ft, fta)
  sprintf(paste0('<tr><th data-stat="player"><a href="/players/x/%s.html">%s</a></th>',
    '<td data-stat="mp">%s</td><td data-stat="pts">%d</td><td data-stat="trb">%d</td>',
    '<td data-stat="drb">%d</td><td data-stat="orb">%d</td><td data-stat="ast">%d</td>',
    '<td data-stat="stl">%d</td><td data-stat="blk">%d</td><td data-stat="tov">%d</td>',
    '<td data-stat="fg">%d</td><td data-stat="fga">%d</td><td data-stat="fg3">%d</td>',
    '<td data-stat="fg3a">%d</td><td data-stat="ft">%d</td><td data-stat="fta">%d</td></tr>'),
    slug, name, mp, pts, trb, drb, orb, ast, stl, blk, tov, fg, fga, fg3, fg3a, ft, fta)
dnp <- '<tr><th data-stat="player"><a href="/players/x/benchy01.html">Bench Guy</a></th><td data-stat="reason">Did Not Play</td></tr>'
tf <- function(pts) sprintf('<tfoot><tr><th data-stat="player">Team Totals</th><td data-stat="pts">%d</td></tr></tfoot>', pts)
sas <- paste0('<table id="box-SAS-game-basic"><tbody>',
  mk("wembavi01", "Victor Wembanyama", "38:00", 30, 15, 12, 3, 5, 2, 4, 3, 11, 20, 1, 3, 7, 9), dnp,
  '</tbody>', tf(110), '</table>')
por <- paste0('<table id="box-POR-game-basic"><tbody>',
  mk("simonan01", "Anfernee Simons", "36:00", 25, 4, 3, 1, 6, 1, 0, 2, 9, 18, 4, 9, 3, 4),
  '</tbody>', tf(105), '</table>')
# Broken scorebox (both sides POR) to prove we never depend on it.
scorebox <- paste0('<div class="scorebox"><div><a href="/teams/POR/2026.html">POR</a>',
  '<div class="score">105</div></div><div><a href="/teams/POR/2026.html">POR</a>',
  '<div class="score">105</div></div></div>')
# Home (POR) table hidden in a comment, exactly like BR lazy-loads one team.
html <- paste0('<html><body>', scorebox, sas, '<!-- ', por, ' --></body></html>')

throttled_fetch <- function(url) html   # network stub

g <- fetch_box("https://www.basketball-reference.com/boxscores/202604260POR.html")
cat(sprintf("home=%s(%d)  away=%s(%d)  players=%d\n",
            g$home$tri, g$home$score, g$away$tri, g$away$score, length(g$players)))

stopifnot(
  g$home$tri == "POR", g$home$score == 105,   # home from gameId, score from POR tfoot
  g$away$tri == "SAS", g$away$score == 110,    # away is the other table, SAS tfoot
  length(g$players) == 2,                      # DNP excluded; both teams present
  setequal(unique(vapply(g$players, function(p) p$team, "")), c("SAS", "POR"))
)
w <- Filter(function(p) p$name == "Victor Wembanyama", g$players)[[1]]
stopifnot(w$team == "SAS", w$pts == 30, abs(w$mp - 38) < 1e-9, w$slug == "wembavi01")

cat("ALL ASSERTIONS PASSED\n")
