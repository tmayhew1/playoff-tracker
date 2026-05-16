#!/usr/bin/env node
// Backfills a past season's playoff games + traditional box scores into
// app/data/history-<season>.json, shaped for the historical games view.
//
//   node scripts/fetch-historical.mjs 2024-25
//
// Run locally — stats.nba.com is not reachable from CI sandboxes. The output
// JSON is committed; history never changes so this is a one-off per season.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const season = process.argv[2] || "2024-25";
const OUT = join(ROOT, "app", "data", `history-${season}.json`);

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt >= 4) throw e;
    const backoff = 1000 * 2 ** (attempt - 1);
    console.warn(`  retry ${attempt} after ${backoff}ms (${e.message})`);
    await sleep(backoff);
    return fetchJson(url, attempt + 1);
  }
}

function indexResult(resultSet) {
  const idx = {};
  resultSet.headers.forEach((h, i) => (idx[h] = i));
  return (row, key) => row[idx[key]];
}

function parseMinutes(min) {
  if (!min) return 0;
  const [m, s] = String(min).split(":");
  return (parseInt(m, 10) || 0) + (parseFloat(s) || 0) / 60;
}

async function main() {
  console.log(`Fetching ${season} playoffs…`);

  // 1. All playoff games (two team rows per game).
  const logUrl =
    `https://stats.nba.com/stats/leaguegamelog?Counter=1000&Direction=ASC` +
    `&LeagueID=00&PlayerOrTeam=T&Season=${season}&SeasonType=Playoffs&Sorter=DATE`;
  const log = await fetchJson(logUrl);
  const lg = log.resultSets.find((r) => r.name === "LeagueGameLog") || log.resultSets[0];
  const get = indexResult(lg);

  const games = new Map(); // gameId -> { date, gameId, home, away }
  for (const row of lg.rowSet) {
    const gameId = get(row, "GAME_ID");
    const tri = get(row, "TEAM_ABBREVIATION");
    const matchup = get(row, "MATCHUP"); // "CLE vs. MIA" (home) | "MIA @ CLE" (away)
    const pts = get(row, "PTS");
    const wl = get(row, "WL");
    const date = get(row, "GAME_DATE");
    const g = games.get(gameId) || { gameId, date, home: null, away: null };
    const side = matchup.includes(" vs. ") ? "home" : "away";
    g[side] = { tri, score: pts, win: wl === "W" };
    games.set(gameId, g);
  }

  const allGames = [...games.values()].sort(
    (a, b) => new Date(a.date) - new Date(b.date) || a.gameId.localeCompare(b.gameId)
  );
  console.log(`  ${allGames.length} games`);

  // 2. Cluster into series by team pair; order by series start; assign rounds.
  const seriesMap = new Map();
  for (const g of allGames) {
    const key = [g.home.tri, g.away.tri].sort().join("-");
    if (!seriesMap.has(key)) seriesMap.set(key, []);
    seriesMap.get(key).push(g);
  }
  const seriesList = [...seriesMap.entries()]
    .map(([key, gs]) => ({ key, games: gs, start: new Date(gs[0].date) }))
    .sort((a, b) => a.start - b.start);

  // Standard bracket: 8 / 4 / 2 / 1 series per round, in start order.
  const roundForIndex = (i) => (i < 8 ? "r1" : i < 12 ? "r2" : i < 14 ? "r3" : "r4");

  // 3. Fetch each game's traditional box score.
  const out = { season, generatedAt: new Date().toISOString(), series: [] };
  for (let si = 0; si < seriesList.length; si++) {
    const s = seriesList[si];
    const round = roundForIndex(si);
    const wins = {};
    for (const g of s.games) {
      const w = g.home.win ? g.home.tri : g.away.tri;
      wins[w] = (wins[w] || 0) + 1;
    }
    const winner = Object.entries(wins).sort((a, b) => b[1] - a[1])[0][0];
    const teams = s.key.split("-");

    const seriesGames = [];
    for (const g of s.games) {
      console.log(`  ${round} ${g.away.tri}@${g.home.tri} ${g.gameId}`);
      const boxUrl =
        `https://stats.nba.com/stats/boxscoretraditionalv2?GameID=${g.gameId}` +
        `&StartPeriod=0&EndPeriod=10&StartRange=0&EndRange=0&RangeType=0`;
      const box = await fetchJson(boxUrl);
      const ps = box.resultSets.find((r) => r.name === "PlayerStats");
      const pget = indexResult(ps);
      const byTeam = { [g.home.tri]: [], [g.away.tri]: [] };
      for (const row of ps.rowSet) {
        const tri = pget(row, "TEAM_ABBREVIATION");
        if (!(tri in byTeam)) continue;
        byTeam[tri].push({
          name: pget(row, "PLAYER_NAME"),
          starter: !!pget(row, "START_POSITION"),
          oncourt: false,
          mp: parseMinutes(pget(row, "MIN")),
          pts: pget(row, "PTS") ?? 0,
          reb: pget(row, "REB") ?? 0,
          drb: pget(row, "DREB") ?? 0,
          orb: pget(row, "OREB") ?? 0,
          ast: pget(row, "AST") ?? 0,
          stl: pget(row, "STL") ?? 0,
          blk: pget(row, "BLK") ?? 0,
          tov: pget(row, "TO") ?? 0,
          fgm: pget(row, "FGM") ?? 0,
          fga: pget(row, "FGA") ?? 0,
          tpm: pget(row, "FG3M") ?? 0,
          tpa: pget(row, "FG3A") ?? 0,
          ftm: pget(row, "FTM") ?? 0,
          fta: pget(row, "FTA") ?? 0,
          plusMinus: pget(row, "PLUS_MINUS") ?? 0,
        });
      }
      seriesGames.push({
        gameId: g.gameId,
        gameDateTimeUTC: new Date(g.date).toISOString(),
        home: { tri: g.home.tri, score: g.home.score },
        away: { tri: g.away.tri, score: g.away.score },
        box: {
          home: { tri: g.home.tri, players: byTeam[g.home.tri] },
          away: { tri: g.away.tri, players: byTeam[g.away.tri] },
        },
      });
      await sleep(700); // be polite to stats.nba.com
    }

    out.series.push({ round, teams, winner, games: seriesGames });
  }

  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${out.series.length} series → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
