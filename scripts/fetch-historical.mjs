#!/usr/bin/env node
/**
 * Bakes one season's playoff data into static JSON, using stats.nba.com as
 * the source. NBA's API blocks Vercel's IPs (why /api/* falls back to ESPN),
 * but GitHub Actions runners get a different pool — this script runs there
 * via .github/workflows/bake-history.yml.
 *
 * Writes:
 *   app/data/history-<season>.json     (rounds → series → games)
 *   app/data/leaderboard-<season>.json (per-player playoff aggregates)
 *
 * Usage:
 *   node scripts/fetch-historical.mjs 2014-15
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "app", "data");

const season = process.argv[2];
if (!season || !/^\d{4}-\d{2}$/.test(season)) {
  console.error("Usage: node scripts/fetch-historical.mjs <YYYY-YY>");
  process.exit(1);
}

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

// --- League averages for VA -----------------------------------------------
const LGA_ALL = JSON.parse(readFileSync(join(DATA_DIR, "league-averages.json"), "utf8"));
const DEFAULT_LGA = LGA_ALL["2025-26"] || Object.values(LGA_ALL).pop();
const lga = LGA_ALL[season] || DEFAULT_LGA;
if (!LGA_ALL[season]) {
  console.warn(`No league averages for ${season}; falling back to defaults. VA will be approximate.`);
}

// VA, duplicated from app/scoring.js so the script is standalone.
function valueAddParts(p) {
  const { mp, pts, ast, stl, blk, tov, drb, orb, tpm, tpa, fgm, fga, ftm, fta } = p;
  if (!mp || mp <= 0) return { va: 0, efficiency: 0 };
  const twoPm = fgm - tpm, twoPa = fga - tpa;
  const tpAdd = ((tpm / (tpa || 1)) - lga.la3P) * tpa;
  const twoAdd = ((twoPm / (twoPa || 1)) - lga.la2P) * twoPa;
  const ftAdd = ((ftm / (fta || 1)) - lga.laFT) * fta;
  const volume = ((pts / mp) - lga.laPTSperM) * mp;
  const efficiency = 3 * tpAdd + 2 * twoAdd + ftAdd;
  const astVal = ((ast / mp) - lga.laASTperM) * mp * lga.laPTSperMake * (1 - lga.laFG);
  const stlVal = ((stl / mp) - lga.laSTLperM) * mp * lga.laPTSperPoss;
  const blkVal = ((blk / mp) - lga.laBLKperM) * mp * lga.laPTSperPoss * lga.laDRBrate;
  const tovVal = -((tov / mp) - lga.laTOVperM) * mp * lga.laPTSperPoss;
  const drbVal = ((drb / mp) - lga.laDRBperM) * 1.25 * mp * lga.laPTSperPoss * lga.laORBrate;
  const orbVal = ((orb / mp) - lga.laORBperM) * 1.25 * mp * lga.laPTSperPoss * lga.laDRBrate;
  return { va: volume + efficiency + astVal + stlVal + blkVal + tovVal + drbVal + orbVal, efficiency };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseMin(v) {
  if (v == null || v === "") return 0;
  const s = String(v).trim();
  if (s.includes(":")) {
    const [m, sec] = s.split(":");
    return (parseInt(m, 10) || 0) + (parseFloat(sec) || 0) / 60;
  }
  return parseFloat(s) || 0;
}

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 429 || res.status === 503) {
      const wait = Math.min(60_000, 3_000 * attempt);
      console.warn(`  ${res.status}; sleeping ${wait}ms (attempt ${attempt})`);
      await sleep(wait);
      return fetchJson(url, attempt + 1);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${url}\n${body.slice(0, 400)}`);
    }
    return res.json();
  } catch (e) {
    if (attempt < 4 && /fetch|network|ECONN|timeout/i.test(e.message)) {
      console.warn(`  retry ${attempt}: ${e.message}`);
      await sleep(2000 * attempt);
      return fetchJson(url, attempt + 1);
    }
    throw e;
  }
}

function indexer(headers) {
  const idx = {};
  headers.forEach((h, i) => (idx[h] = i));
  return (row, key) => row[idx[key]];
}

async function inBatches(arr, n, fn) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) {
    const chunk = arr.slice(i, i + n);
    const res = await Promise.all(chunk.map(fn));
    out.push(...res);
    if (i + n < arr.length) await sleep(800);
  }
  return out;
}

// --- Main -----------------------------------------------------------------
async function main() {
  console.log(`Baking ${season} from stats.nba.com…`);

  // 1. Playoff game log (team-level rows; 2 rows per game).
  const logUrl =
    `https://stats.nba.com/stats/leaguegamelog?Counter=1000&Direction=ASC` +
    `&LeagueID=00&PlayerOrTeam=T&Season=${season}&SeasonType=Playoffs&Sorter=DATE`;
  const logJson = await fetchJson(logUrl);
  const lg = (logJson.resultSets || []).find((r) => r.name === "LeagueGameLog") || logJson.resultSets?.[0];
  if (!lg) throw new Error("LeagueGameLog result set missing");
  const getLg = indexer(lg.headers);

  // Merge two rows per game into one record.
  const gameMap = new Map();
  for (const row of lg.rowSet) {
    const gameId = getLg(row, "GAME_ID");
    const tri = getLg(row, "TEAM_ABBREVIATION");
    const matchup = getLg(row, "MATCHUP") || "";
    const pts = Number(getLg(row, "PTS")) || 0;
    const date = getLg(row, "GAME_DATE");
    const side = matchup.includes(" vs. ") ? "home" : "away";
    const g = gameMap.get(gameId) || { gameId, date, home: null, away: null };
    g[side] = { tri, score: pts };
    gameMap.set(gameId, g);
  }
  const games = [...gameMap.values()]
    .filter((g) => g.home && g.away)
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.gameId.localeCompare(b.gameId));
  console.log(`  ${games.length} playoff games`);

  // 2. Cluster into series; assign rounds 8/4/2/1.
  const byPair = new Map();
  for (const g of games) {
    const key = [g.home.tri, g.away.tri].sort().join("-");
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(g);
  }
  const seriesList = [...byPair.values()]
    .map((gs) => ({ games: gs, start: gs[0].date }))
    .sort((p, q) => (p.start || "").localeCompare(q.start || ""));
  const roundKeyForIdx = (i) => (i < 8 ? "r1" : i < 12 ? "r2" : i < 14 ? "r3" : "r4");
  const roundNumForIdx = (i) => (i < 8 ? 1 : i < 12 ? 2 : i < 14 ? 3 : 4);

  // Flat chronological list with series index.
  const allGames = [];
  seriesList.forEach((s, sIdx) => {
    for (const g of s.games) allGames.push({ ...g, seriesIdx: sIdx });
  });
  allGames.sort((x, y) => (x.date || "").localeCompare(y.date || "") || x.gameId.localeCompare(y.gameId));
  const gameIdxByGameId = new Map();
  allGames.forEach((g, i) => gameIdxByGameId.set(g.gameId, i));

  // 3. Fetch each game's traditional box score in batches.
  console.log("Fetching box scores…");
  const boxes = await inBatches(allGames, 5, async (g, j) => {
    const url =
      `https://stats.nba.com/stats/boxscoretraditionalv2?GameID=${g.gameId}` +
      `&StartPeriod=0&EndPeriod=10&StartRange=0&EndRange=0&RangeType=0`;
    try {
      const data = await fetchJson(url);
      const ps = (data.resultSets || []).find((r) => r.name === "PlayerStats");
      if (!ps) return null;
      const get = indexer(ps.headers);
      const players = [];
      for (const row of ps.rowSet) {
        const tri = get(row, "TEAM_ABBREVIATION");
        const mp = parseMin(get(row, "MIN"));
        if (mp <= 0) continue;
        players.push({
          name: get(row, "PLAYER_NAME"),
          team: tri,
          starter: !!get(row, "START_POSITION"),
          mp,
          pts: Number(get(row, "PTS")) || 0,
          reb: Number(get(row, "REB")) || 0,
          drb: Number(get(row, "DREB")) || 0,
          orb: Number(get(row, "OREB")) || 0,
          ast: Number(get(row, "AST")) || 0,
          stl: Number(get(row, "STL")) || 0,
          blk: Number(get(row, "BLK")) || 0,
          tov: Number(get(row, "TO")) || 0,
          fgm: Number(get(row, "FGM")) || 0,
          fga: Number(get(row, "FGA")) || 0,
          tpm: Number(get(row, "FG3M")) || 0,
          tpa: Number(get(row, "FG3A")) || 0,
          ftm: Number(get(row, "FTM")) || 0,
          fta: Number(get(row, "FTA")) || 0,
        });
      }
      return { ...g, players };
    } catch (e) {
      console.warn(`  box failed for ${g.gameId}: ${e.message.split("\n")[0]}`);
      return null;
    }
  });

  // 4. Build history JSON (matches /api/history's shape).
  const historySeries = seriesList.map((s, i) => {
    const wins = {};
    for (const g of s.games) {
      const w = g.home.score > g.away.score ? g.home.tri : g.away.tri;
      wins[w] = (wins[w] || 0) + 1;
    }
    let winner = null, bestN = 0;
    for (const [t, n] of Object.entries(wins)) if (n > bestN) { winner = t; bestN = n; }
    return {
      round: roundKeyForIdx(i),
      teams: [s.games[0].home.tri, s.games[0].away.tri],
      winner,
      games: s.games.map((g) => ({
        gameId: g.gameId,
        gameCode: (g.date || "").replace(/-/g, ""),
        gameDateTimeUTC: g.date ? `${g.date}T00:00:00.000Z` : null,
        home: { tri: g.home.tri, score: g.home.score },
        away: { tri: g.away.tri, score: g.away.score },
      })),
    };
  });

  const historyOut = {
    season,
    series: historySeries,
    source: "stats.nba.com",
    fetchedAt: new Date().toISOString(),
  };

  // 5. Aggregate per player across all games for the leaderboard.
  const agg = new Map();
  for (const r of boxes) {
    if (!r) continue;
    for (const p of r.players) {
      const opp = p.team === r.home.tri ? r.away.tri : r.home.tri;
      const { va, efficiency } = valueAddParts(p);
      const key = `${p.team}:${p.name}`;
      const a = agg.get(key) || {
        name: p.name, team: p.team,
        gp: 0, va: 0, eff: 0,
        mp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
        fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, drb: 0, orb: 0,
        games: [],
      };
      a.gp += 1;
      a.va += va;
      a.eff += efficiency;
      for (const k of ["mp", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "drb", "orb"]) {
        a[k] += p[k] || 0;
      }
      a.games.push({
        gameId: r.gameId,
        gameIdx: gameIdxByGameId.get(r.gameId) ?? 0,
        seriesIdx: r.seriesIdx,
        opp,
        va,
        mp: p.mp || 0, pts: p.pts || 0, reb: p.reb || 0, ast: p.ast || 0,
        stl: p.stl || 0, blk: p.blk || 0, tov: p.tov || 0,
        fgm: p.fgm || 0, fga: p.fga || 0, tpm: p.tpm || 0, tpa: p.tpa || 0,
        ftm: p.ftm || 0, fta: p.fta || 0, drb: p.drb || 0, orb: p.orb || 0,
      });
      agg.set(key, a);
    }
  }

  const players = [...agg.values()];
  players.forEach((p) => {
    p.games.sort((x, y) => x.gameIdx - y.gameIdx);
    const counts = {};
    for (const g of p.games) {
      counts[g.seriesIdx] = (counts[g.seriesIdx] || 0) + 1;
      g.seriesGameNumber = counts[g.seriesIdx];
    }
  });
  players.sort((a, b) => b.va - a.va);

  const leaderboardOut = {
    season,
    series: seriesList.map((s, i) => ({
      idx: i,
      round: roundNumForIdx(i),
      teams: [s.games[0].home.tri, s.games[0].away.tri],
    })),
    players,
    source: "stats.nba.com",
    fetchedAt: new Date().toISOString(),
  };

  // 6. Write.
  await mkdir(DATA_DIR, { recursive: true });
  const historyPath = join(DATA_DIR, `history-${season}.json`);
  const leaderboardPath = join(DATA_DIR, `leaderboard-${season}.json`);
  await writeFile(historyPath, JSON.stringify(historyOut, null, 2) + "\n");
  await writeFile(leaderboardPath, JSON.stringify(leaderboardOut, null, 2) + "\n");
  console.log(`Wrote ${historyOut.series.length} series, ${players.length} players`);
  console.log(`  → ${historyPath}`);
  console.log(`  → ${leaderboardPath}`);
}

main().catch((e) => {
  console.error("\n========== BAKE FAILED ==========");
  console.error(e?.stack || e?.message || String(e));
  console.error("==================================\n");
  process.exit(1);
});
