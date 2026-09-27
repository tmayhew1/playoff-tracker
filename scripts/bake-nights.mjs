#!/usr/bin/env node
// Bake last night's box scores: every finished game's player lines, from the
// NBA's live CDN, into app/data/nights/<YYYY-MM-DD>.json. The Explore tab's
// "Last night" card (/api/nights) scores and ranks them.
//
//   npm run bake:nights                     # the last 3 nights not yet baked
//   npm run bake:nights -- --date 2026-10-21 [--date …] [--force]
//
// Run by the daily workflow at 7am ET, when the previous night's games are
// final. Looking back 3 nights (instead of 1) means a missed or failed run
// is caught up by the next one. A night is written only once every game on
// it is final, and is left alone after that unless --force.
//
// NIGHTS_FIXTURES=<dir> reads schedule.json and boxscore_<gameId>.json from
// that directory instead of the network — how the tests run it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapPlayer } from "../app/api/_lib/nba-box.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const OUT_DIR = process.env.NIGHTS_OUT || path.join(DATA, "nights");
const FIXTURES = process.env.NIGHTS_FIXTURES || null;
const LOOKBACK = 3;

const SCHEDULE_URL = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json";
const BOX_URL = (id) => `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${id}.json`;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
};

// Which games count. The id's first three digits are the game type: 002
// regular season (NBA Cup group games included), 004 playoffs, 005 play-in,
// 006 the Cup final. Preseason (001) and the All-Star game (003) don't.
const KINDS = { "002": "regular", "004": "playoffs", "005": "play-in", "006": "cup-final" };

async function getJson(url) {
  if (FIXTURES) {
    const name = url === SCHEDULE_URL ? "schedule.json" : path.basename(url);
    return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// A game's date in US Eastern time — the NBA's "night" — from the fields the
// schedule carries, most reliable first.
function gameDate(g, gd) {
  const code = /^(\d{4})(\d{2})(\d{2})\//.exec(g.gameCode || "");
  if (code) return `${code[1]}-${code[2]}-${code[3]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(g.gameDateEst || "")) return g.gameDateEst.slice(0, 10);
  const us = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(gd?.gameDate || "");
  return us ? `${us[3]}-${us[1]}-${us[2]}` : null;
}

// "2026-10-21" -> "2026-27": a season starts in October.
export function seasonOf(date) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const start = m >= 9 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// Today's date in US Eastern time.
function todayEt() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").trim();

// basketball-reference slugs for the season's players, so a line can link to
// the player's page. Matched by name, and only where the name is unambiguous.
function slugIndex(season) {
  const file = path.join(DATA, `regular-season-${season}.json`);
  const byName = new Map();
  if (!fs.existsSync(file)) return byName;
  for (const p of JSON.parse(fs.readFileSync(file, "utf8")).players || []) {
    const k = norm(p.name);
    byName.set(k, byName.has(k) && byName.get(k) !== p.slug ? null : p.slug);
  }
  return byName;
}

async function bakeNight(date, schedule, force) {
  const out = path.join(OUT_DIR, `${date}.json`);
  if (!force && fs.existsSync(out)) return `${date}: already baked`;
  const games = [];
  for (const gd of schedule?.leagueSchedule?.gameDates || []) {
    for (const g of gd.games || []) {
      const kind = KINDS[String(g.gameId || "").slice(0, 3)];
      if (kind && gameDate(g, gd) === date) games.push({ g, kind });
    }
  }
  if (!games.length) return `${date}: no games`;
  const unfinished = games.filter(({ g }) => Number(g.gameStatus) !== 3);
  if (unfinished.length) return `${date}: ${unfinished.length} of ${games.length} games not final yet - skipped`;

  const season = seasonOf(date);
  const slugs = slugIndex(season);
  const outGames = [], players = [];
  for (const { g, kind } of games) {
    const box = (await getJson(BOX_URL(g.gameId)))?.game;
    if (!box) throw new Error(`${g.gameId}: no box score`);
    const home = box.homeTeam, away = box.awayTeam;
    outGames.push({
      gameId: g.gameId, kind,
      home: { tri: home.teamTricode, score: home.score ?? 0 },
      away: { tri: away.teamTricode, score: away.score ?? 0 },
    });
    for (const [team, opp] of [[home, away], [away, home]]) {
      for (const raw of team.players || []) {
        const p = mapPlayer(raw);
        if (!(p.mp > 0)) continue;
        // "On court" is a live-game field; a finished night has no one on court.
        const line = { ...p };
        delete line.oncourt;
        players.push({ ...line, slug: slugs.get(norm(p.name)) || null, team: team.teamTricode, opp: opp.teamTricode, gameId: g.gameId });
      }
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    date, season, games: outGames, players,
    source: "cdn.nba.com", fetchedAt: new Date().toISOString(),
  }, null, 2) + "\n");
  const linked = players.filter((p) => p.slug).length;
  return `${date}: ${outGames.length} games, ${players.length} player lines (${linked} linked to a player page)`;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dates = args.flatMap((a, i) => (a === "--date" ? [args[i + 1]] : [])).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || ""));
  const targets = dates.length ? dates : Array.from({ length: LOOKBACK }, (_, i) => addDays(todayEt(), -(i + 1)));
  const schedule = await getJson(SCHEDULE_URL);
  for (const d of targets) console.log(await bakeNight(d, schedule, force));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
