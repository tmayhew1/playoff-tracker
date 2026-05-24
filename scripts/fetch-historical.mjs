#!/usr/bin/env node
/**
 * Bakes one season's playoff data into static JSON, scraping
 * basketball-reference.com (full coverage back to 1949-50, no API key).
 *
 *   node scripts/fetch-historical.mjs 2014-15
 *
 * Designed to run in GitHub Actions (.github/workflows/bake-history.yml).
 * Throttles requests to stay polite (BR's policy is ~20/min; we wait 2.5s
 * between calls).
 *
 * Writes:
 *   app/data/history-<season>.json     (rounds → series → games)
 *   app/data/leaderboard-<season>.json (per-player playoff aggregates)
 *
 * Tricodes are mapped to the NBA-current set the app already knows
 * (e.g. BR's "BRK" → "BKN", "CHO" → "CHA", "PHO" → "PHX").
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "app", "data");

const season = process.argv[2];
if (!season || !/^\d{4}-\d{2}$/.test(season)) {
  console.error("Usage: node scripts/fetch-historical.mjs <YYYY-YY>");
  process.exit(1);
}
const endYear = Number(season.slice(0, 4)) + 1;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// --- League averages for VA -----------------------------------------------
const LGA_ALL = JSON.parse(readFileSync(join(DATA_DIR, "league-averages.json"), "utf8"));
const DEFAULT_LGA = LGA_ALL["2025-26"] || Object.values(LGA_ALL).pop();
const lga = LGA_ALL[season] || DEFAULT_LGA;
if (!LGA_ALL[season]) {
  console.warn(`No league averages for ${season}; falling back to defaults. VA will be approximate.`);
}

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
const BR_TO_NBA = {
  BRK: "BKN",         // Nets (BR uses BRK)
  CHO: "CHA",         // Hornets (post-2014)
  CHH: "CHA",         // original Hornets
  NOH: "NOP",         // New Orleans Hornets
  NOK: "NOP",         // New Orleans/OKC Hornets
  PHO: "PHX",         // Suns (BR uses PHO)
  // Defunct/legacy preserved as-is (SEA, NJN, VAN, WSB) since the app's
  // color map already covers them.
};
const toNba = (tri) => BR_TO_NBA[tri] || tri;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REQUEST_DELAY = 2500; // ms between sequential HTTP calls (BR allows ~20/min)
let lastRequest = 0;

async function throttledFetch(url) {
  const wait = Math.max(0, REQUEST_DELAY - (Date.now() - lastRequest));
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (res.status === 429 || res.status === 503) {
    console.warn(`  ${res.status} on ${url} — sleeping 60s`);
    await sleep(60_000);
    return throttledFetch(url);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function parseMinutes(v) {
  if (v == null || v === "") return 0;
  const s = String(v).trim();
  if (s.includes(":")) {
    const [m, sec] = s.split(":");
    return (parseInt(m, 10) || 0) + (parseFloat(sec) || 0) / 60;
  }
  return parseFloat(s) || 0;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// --- Step 1: list of playoff game URLs from the season's playoff page -----
async function fetchPlayoffGameUrls() {
  const url = `https://www.basketball-reference.com/playoffs/NBA_${endYear}.html`;
  console.log(`Fetching ${url}`);
  const html = await throttledFetch(url);
  const $ = cheerio.load(html);
  const urls = new Set();
  // Box score links live both in the main HTML and inside commented-out blocks
  // BR uses to lazy-render some tables. Extract from both.
  const hrefs = [];
  $("a").each((_, a) => {
    const href = $(a).attr("href");
    if (href && /^\/boxscores\/\d{8}0[A-Z]{3}\.html$/.test(href)) hrefs.push(href);
  });
  // BR wraps some tables in <!-- ... --> to defer rendering; pull boxscore
  // links out of those comments too.
  $("*").contents().each((_, node) => {
    if (node.type === "comment") {
      const text = node.data || "";
      const re = /\/boxscores\/\d{8}0[A-Z]{3}\.html/g;
      let m;
      while ((m = re.exec(text)) !== null) hrefs.push(m[0]);
    }
  });
  for (const h of hrefs) urls.add(`https://www.basketball-reference.com${h}`);
  return [...urls];
}

// --- Step 2: fetch + parse one box score ----------------------------------
function parseDateFromBoxId(boxId) {
  // boxId looks like "201504190GSW" — first 8 chars are YYYYMMDD.
  return `${boxId.slice(0, 4)}-${boxId.slice(4, 6)}-${boxId.slice(6, 8)}`;
}

async function fetchBox(url) {
  const boxId = url.match(/\/boxscores\/([^/.]+)\.html/)?.[1] || "";
  const date = parseDateFromBoxId(boxId);
  const html = await throttledFetch(url);
  const $ = cheerio.load(html);

  // Score boxes: BR has <div class="scorebox"> with two team blocks; each
  // has a <strong><a href="/teams/XXX/...">XXX</a></strong> and a
  // <div class="score">NNN</div>. The first block is the away team, second is home.
  const teamBlocks = $("div.scorebox > div").filter((_, el) => {
    return $(el).find("a[href*='/teams/']").length > 0;
  });
  if (teamBlocks.length < 2) throw new Error(`scorebox parse failed for ${boxId}`);
  const teamAt = (i) => {
    const blk = $(teamBlocks[i]);
    const href = blk.find("a[href*='/teams/']").first().attr("href") || "";
    const m = href.match(/\/teams\/([A-Z]{3})\//);
    const tri = m ? m[1] : "";
    const score = num(blk.find("div.score").first().text());
    return { tri, score };
  };
  const away = teamAt(0);
  const home = teamAt(1);

  // Box score tables: id="box-XXX-game-basic" for each team's basic stats.
  // The DOM sometimes has these tables, sometimes BR wraps them in HTML
  // comments. Reconstruct any commented-out tables.
  const allHtml = $.html();
  // Inline any commented-out tables (they're sentinel-wrapped exactly like
  // their inline counterparts).
  const hydrated = cheerio.load(allHtml.replace(/<!--([\s\S]*?)-->/g, "$1"));

  const playersForTeam = (tri) => {
    const t = hydrated(`table#box-${tri}-game-basic`);
    if (!t.length) return [];
    const out = [];
    t.find("tbody tr").each((_, tr) => {
      const $tr = hydrated(tr);
      if ($tr.hasClass("thead")) return;
      const name = $tr.find("th[data-stat='player']").text().trim();
      if (!name) return;
      // DNP rows have a single cell saying "Did Not Play" etc.
      const reason = $tr.find("td[data-stat='reason']").text().trim();
      if (reason) return;
      const cell = (key) => $tr.find(`td[data-stat='${key}']`).text().trim();
      const mp = parseMinutes(cell("mp"));
      if (mp <= 0) return;
      out.push({
        name,
        team: tri,
        mp,
        pts: num(cell("pts")),
        reb: num(cell("trb")),
        drb: num(cell("drb")),
        orb: num(cell("orb")),
        ast: num(cell("ast")),
        stl: num(cell("stl")),
        blk: num(cell("blk")),
        tov: num(cell("tov")),
        fgm: num(cell("fg")),
        fga: num(cell("fga")),
        tpm: num(cell("fg3")),
        tpa: num(cell("fg3a")),
        ftm: num(cell("ft")),
        fta: num(cell("fta")),
      });
    });
    return out;
  };

  const players = [...playersForTeam(away.tri), ...playersForTeam(home.tri)];
  return {
    gameId: boxId,
    date,
    home: { tri: toNba(home.tri), score: home.score, brTri: home.tri },
    away: { tri: toNba(away.tri), score: away.score, brTri: away.tri },
    players: players.map((p) => ({ ...p, team: toNba(p.team) })),
  };
}

// --- Main -----------------------------------------------------------------
async function main() {
  console.log(`Baking ${season} from basketball-reference…`);

  // 1. All playoff game URLs for the season.
  const urls = await fetchPlayoffGameUrls();
  console.log(`  ${urls.length} playoff game URLs`);
  if (urls.length === 0) throw new Error("no playoff games discovered");

  // 2. Sort by URL (which sorts by date because IDs start with YYYYMMDD).
  urls.sort();

  // 3. Fetch each game's box (sequential — BR throttle is unforgiving).
  console.log("Fetching box scores…");
  const games = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const g = await fetchBox(url);
      games.push(g);
      if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${urls.length}`);
    } catch (e) {
      console.warn(`  failed ${url}: ${e.message}`);
    }
  }
  if (games.length === 0) throw new Error("no boxes parsed");
  console.log(`  ${games.length} games parsed`);

  // 4. Cluster into series; assign rounds 8/4/2/1 by chronological start.
  games.sort((a, b) => a.date.localeCompare(b.date) || a.gameId.localeCompare(b.gameId));
  const byPair = new Map();
  for (const g of games) {
    const key = [g.home.tri, g.away.tri].sort().join("-");
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(g);
  }
  const seriesList = [...byPair.values()]
    .map((gs) => ({ games: gs, start: gs[0].date }))
    .sort((p, q) => p.start.localeCompare(q.start));
  const roundKeyForIdx = (i) => (i < 8 ? "r1" : i < 12 ? "r2" : i < 14 ? "r3" : "r4");
  const roundNumForIdx = (i) => (i < 8 ? 1 : i < 12 ? 2 : i < 14 ? 3 : 4);

  // Flat chronological list with series index (for leaderboard).
  const allGamesFlat = [];
  seriesList.forEach((s, sIdx) => {
    for (const g of s.games) allGamesFlat.push({ ...g, seriesIdx: sIdx });
  });
  allGamesFlat.sort((a, b) => a.date.localeCompare(b.date) || a.gameId.localeCompare(b.gameId));
  const gameIdxByGameId = new Map();
  allGamesFlat.forEach((g, i) => gameIdxByGameId.set(g.gameId, i));

  // 5. Build history JSON shape.
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
        gameCode: g.date.replace(/-/g, ""),
        gameDateTimeUTC: `${g.date}T00:00:00.000Z`,
        home: { tri: g.home.tri, score: g.home.score },
        away: { tri: g.away.tri, score: g.away.score },
      })),
    };
  });
  const historyOut = {
    season,
    series: historySeries,
    source: "basketball-reference",
    fetchedAt: new Date().toISOString(),
  };

  // 6. Aggregate per player across all games for the leaderboard.
  const agg = new Map();
  for (const r of allGamesFlat) {
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
    source: "basketball-reference",
    fetchedAt: new Date().toISOString(),
  };

  // 7. Write.
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
