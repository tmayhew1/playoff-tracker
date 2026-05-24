#!/usr/bin/env node
/**
 * Bakes one season's playoff data into static JSON, using balldontlie.io
 * as the source. Writes two files the API routes prefer when present:
 *
 *   app/data/history-<season>.json     (rounds → series → games)
 *   app/data/leaderboard-<season>.json (per-player playoff aggregates)
 *
 * Usage:
 *   BALLDONTLIE_API_KEY=xxx node scripts/fetch-historical.mjs 2014-15
 *
 * Designed to run in GitHub Actions (.github/workflows/bake-history.yml)
 * so it can be triggered from a phone with no local Node setup.
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
  console.error("Usage: BALLDONTLIE_API_KEY=xxx node scripts/fetch-historical.mjs <YYYY-YY>");
  process.exit(1);
}
const seasonStartYear = Number(season.slice(0, 4));

const API_KEY = process.env.BALLDONTLIE_API_KEY;
if (!API_KEY) {
  console.error("BALLDONTLIE_API_KEY env var required (sign up free at balldontlie.io).");
  process.exit(1);
}

const API = "https://api.balldontlie.io/v1";

// --- League averages for VA (same data the app uses) -----------------------
const LGA_ALL = JSON.parse(readFileSync(join(DATA_DIR, "league-averages.json"), "utf8"));
const DEFAULT_LGA = LGA_ALL["2025-26"] || Object.values(LGA_ALL).pop();
const lga = LGA_ALL[season] || DEFAULT_LGA;
if (!LGA_ALL[season]) {
  console.warn(`No league averages for ${season}; falling back to defaults. VA will be approximate.`);
}

// --- VA calc, duplicated from app/scoring.js so the script is standalone ---
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

// --- Helpers --------------------------------------------------------------
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

async function fetchPage(url, attempt = 1) {
  const res = await fetch(url, { headers: { Authorization: API_KEY } });
  if (res.status === 429) {
    const wait = Math.min(60_000, 5_000 * attempt);
    console.warn(`  rate-limited; sleeping ${wait}ms`);
    await sleep(wait);
    return fetchPage(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchAll(path, baseQuery) {
  const out = [];
  let cursor = null;
  while (true) {
    const qs = new URLSearchParams(baseQuery);
    if (cursor != null) qs.set("cursor", String(cursor));
    qs.set("per_page", "100");
    const data = await fetchPage(`${API}${path}?${qs.toString()}`);
    for (const row of data.data || []) out.push(row);
    cursor = data.meta?.next_cursor;
    if (!cursor) return out;
    console.log(`  fetched ${out.length}…`);
  }
}

// --- Main -----------------------------------------------------------------
async function main() {
  console.log(`Baking ${season} playoffs from balldontlie…`);

  // 1. Games.
  const games = await fetchAll("/games", {
    "seasons[]": String(seasonStartYear),
    postseason: "true",
  });
  // Filter to completed games with both team abbreviations.
  const completed = games.filter((g) =>
    g.home_team?.abbreviation && g.visitor_team?.abbreviation &&
    Number.isFinite(g.home_team_score) && Number.isFinite(g.visitor_team_score) &&
    (g.home_team_score > 0 || g.visitor_team_score > 0)
  );
  console.log(`  ${completed.length} completed playoff games`);

  // 2. Cluster by team pair → series. Sort chronologically; rounds 8/4/2/1.
  const byPair = new Map();
  const sortedGames = completed
    .slice()
    .sort((x, y) => (x.date || "").localeCompare(y.date || "") || (x.id - y.id));
  for (const g of sortedGames) {
    const key = [g.home_team.abbreviation, g.visitor_team.abbreviation].sort().join("-");
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(g);
  }
  const seriesList = [...byPair.values()]
    .map((gs) => ({ games: gs, start: gs[0].date }))
    .sort((p, q) => (p.start || "").localeCompare(q.start || ""));
  const roundForIdx = (i) => (i < 8 ? "r1" : i < 12 ? "r2" : i < 14 ? "r3" : "r4");
  const roundNumForIdx = (i) => (i < 8 ? 1 : i < 12 ? 2 : i < 14 ? 3 : 4);

  // gameId → seriesIdx, plus a chronological global gameIdx.
  const seriesIdxByGameId = new Map();
  const dateByGameId = new Map();
  const allGames = [];
  seriesList.forEach((s, sIdx) => {
    for (const g of s.games) {
      seriesIdxByGameId.set(g.id, sIdx);
      dateByGameId.set(g.id, g.date);
      allGames.push({ ...g, seriesIdx: sIdx });
    }
  });
  allGames.sort((x, y) => (x.date || "").localeCompare(y.date || "") || (x.id - y.id));
  const gameIdxByGameId = new Map();
  allGames.forEach((g, i) => gameIdxByGameId.set(g.id, i));

  // 3. Build history JSON shape — what /api/history returns.
  const seriesGames = seriesList.map((s, i) => ({
    round: roundForIdx(i),
    teams: [s.games[0].home_team.abbreviation, s.games[0].visitor_team.abbreviation],
    winner: (() => {
      const wins = {};
      for (const g of s.games) {
        const w = g.home_team_score > g.visitor_team_score
          ? g.home_team.abbreviation
          : g.visitor_team.abbreviation;
        wins[w] = (wins[w] || 0) + 1;
      }
      let best = null, bestN = 0;
      for (const [t, n] of Object.entries(wins)) if (n > bestN) { best = t; bestN = n; }
      return best;
    })(),
    games: s.games.map((g) => ({
      gameId: String(g.id),
      gameCode: (g.date || "").replace(/-/g, ""),
      gameDateTimeUTC: g.status?.includes("T") ? g.status : (g.date ? `${g.date}T00:00:00.000Z` : null),
      home: { tri: g.home_team.abbreviation, score: g.home_team_score },
      away: { tri: g.visitor_team.abbreviation, score: g.visitor_team_score },
    })),
  }));

  const historyOut = {
    season,
    series: seriesGames,
    source: "balldontlie",
    fetchedAt: new Date().toISOString(),
  };

  // 4. Stats → per-player aggregation for leaderboard JSON.
  console.log("Fetching stats…");
  const stats = await fetchAll("/stats", {
    "seasons[]": String(seasonStartYear),
    postseason: "true",
  });
  console.log(`  ${stats.length} stat lines`);

  const agg = new Map();
  for (const s of stats) {
    const gameId = s.game?.id;
    if (gameId == null || !seriesIdxByGameId.has(gameId)) continue; // not a playoff series we care about
    const tri = s.team?.abbreviation;
    if (!tri) continue;
    const mp = parseMin(s.min);
    if (mp <= 0) continue;

    const fgm = s.fgm || 0, fga = s.fga || 0;
    const tpm = s.fg3m || 0, tpa = s.fg3a || 0;
    const ftm = s.ftm || 0, fta = s.fta || 0;
    const pts = s.pts || 0;
    const drb = s.dreb || 0, orb = s.oreb || 0;
    const reb = s.reb != null ? s.reb : (drb + orb);
    const ast = s.ast || 0, stl = s.stl || 0, blk = s.blk || 0;
    const tov = s.turnover || 0;

    const playerObj = {
      mp, pts, reb, drb, orb, ast, stl, blk, tov,
      fgm, fga, tpm, tpa, ftm, fta,
    };
    const { va, efficiency } = valueAddParts(playerObj);

    const name = `${s.player?.first_name || ""} ${s.player?.last_name || ""}`.trim();
    const key = `${tri}:${name}`;
    const a = agg.get(key) || {
      name, team: tri,
      gp: 0, va: 0, eff: 0,
      mp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
      fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, drb: 0, orb: 0,
      games: [],
    };
    a.gp += 1;
    a.va += va;
    a.eff += efficiency;
    for (const k of Object.keys(playerObj)) a[k] += playerObj[k];

    const game = sortedGames.find((g) => g.id === gameId);
    const opp = tri === game?.home_team?.abbreviation
      ? game?.visitor_team?.abbreviation
      : game?.home_team?.abbreviation;
    a.games.push({
      gameId: String(gameId),
      gameIdx: gameIdxByGameId.get(gameId) ?? 0,
      seriesIdx: seriesIdxByGameId.get(gameId),
      opp: opp || "",
      va,
      ...playerObj,
    });
    agg.set(key, a);
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
      teams: [s.games[0].home_team.abbreviation, s.games[0].visitor_team.abbreviation],
    })),
    players,
    source: "balldontlie",
    fetchedAt: new Date().toISOString(),
  };

  // 5. Write both files.
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
  console.error(e);
  process.exit(1);
});
