#!/usr/bin/env node
// Bake every finished regular-season game, with its box score, from ESPN into
// public/regular-season-games/<season>/ — the Explore tab's regular-season
// months then open from static files instead of asking ESPN a day at a time
// (and every box score again) on each visit.
//
//   npm run bake:regular-season                          # every season not yet baked, + top up the current one
//   npm run bake:regular-season -- --season 2024-25 [--season …] [--force]
//   npm run bake:regular-season -- --max-seasons 5       # stop after five seasons' worth of work
//
// Per season it writes:
//   index.json   — { season, through, complete, games: [...], noBox: [...] }:
//                  the game list /api/regular-season/games gives, for the
//                  whole season. `through` is the last Eastern date covered.
//   YYYY-MM.json — that month's box scores, lines packed as arrays
//                  (app/lib/regular-season-games.js LINE_FIELDS, names once).
//
// A finished season is written once and left alone (unless --force); a later
// run only retries games ESPN had no box score for (`noBox`). The season in
// progress is topped up through yesterday, Eastern: the daily workflow runs
// this after the night's games are final. Days after `through` are what the
// page still asks the live routes for.
//
// ESPN covers 1999-00 onward, the same range the Explore season picker offers.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BAKED_DIR, packLine, parseScoreboard, seasonMonths,
} from "../app/lib/regular-season-games.js";
import { espnBoxUrls, parseEspnPayload } from "../app/api/_lib/espn-box.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = process.env.RS_GAMES_OUT || path.join(ROOT, "public", BAKED_DIR);
const FIRST_SEASON = "1999-00";
const CONCURRENCY = 8;
// Raised whenever a change to what gets kept means seasons baked earlier are
// wrong; a season baked by an older version is rebaked whole. 2: the Nets
// ("NJ" on ESPN) kept, phantom 0-0 finals and repeated games dropped, the
// In-Season Tournament final left out.
export const BAKE_VERSION = 2;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

export const scoreboardUrl = (yyyymmdd) =>
  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${yyyymmdd}`;

// Three tries with backoff; a 4xx other than 429 is ESPN saying no, not a blip.
async function fetchJson(url) {
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.final = res.status >= 400 && res.status < 500 && res.status !== 429;
        throw err;
      }
      return await res.json();
    } catch (e) {
      if (e.final || attempt >= 3) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    } finally {
      clearTimeout(t);
    }
  }
}

// Run fn over items, n at a time, results in order.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export function todayEt(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// "2026-10-21" -> "2026-27".
export function seasonOf(date) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const start = m >= 9 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// Every calendar day a season's regular season can fall on, as YYYY-MM-DD.
export function seasonDays(season) {
  const out = [];
  for (const ym of seasonMonths(season)) {
    const y = Number(ym.slice(0, 4)), m = Number(ym.slice(4));
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= last; d++) out.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

// Seasons from 1999-00 through the one being played on `today`.
export function allSeasons(today) {
  const out = [];
  const last = Number(seasonOf(today).slice(0, 4));
  for (let y = Number(FIRST_SEASON.slice(0, 4)); y <= last; y++) out.push(`${y}-${String((y + 1) % 100).padStart(2, "0")}`);
  return out;
}

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
};

// A day's scoreboard is settled once every event on it is over — final,
// postponed or cancelled. A day with a game still to play stops the bake there.
const daySettled = (events) => (events || []).every((ev) => {
  const st = ev.competitions?.[0]?.status?.type || ev.status?.type || {};
  return st.completed || st.state === "post";
});

// One game's box score from ESPN's summary, falling back to the CDN core.
async function fetchBox(gameId, getJson) {
  for (const url of espnBoxUrls(gameId)) {
    try {
      const parsed = parseEspnPayload(await getJson(url));
      if (parsed) return parsed;
    } catch {
      // try the next source
    }
  }
  return null;
}

// The month files a season's games go in, read back so a top-up appends.
function loadMonths(dir, keys) {
  const months = new Map();
  for (const key of keys) {
    const f = readJson(path.join(dir, `${key}.json`));
    months.set(key, f ? { names: f.names, games: f.games } : { names: [], games: {} });
  }
  return months;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data) + "\n");
  fs.renameSync(tmp, file);
}

// Bake (or top up) one season. Returns a one-line summary. Throws when a past
// season can't be read in full, so a gap is never written as complete.
export async function bakeSeason(season, { getJson = fetchJson, outDir = OUT_DIR, today = todayEt(), force = false } = {}) {
  const dir = path.join(outDir, season);
  const indexFile = path.join(dir, "index.json");
  const stored = readJson(indexFile);
  const prev = force || (stored?.version || 1) < BAKE_VERSION ? null : stored;
  const days = seasonDays(season);
  const lastDay = days[days.length - 1];
  const yesterday = addDays(today, -1);
  const finished = yesterday >= lastDay;

  if (!finished && days[0] > yesterday) return `${season}: not started`;

  // A finished season already baked: only the games ESPN had no box for.
  const retryOnly = prev?.complete;
  if (retryOnly && !(prev.noBox || []).length) return `${season}: already baked (${prev.games.length} games)`;

  let games = prev?.games ? [...prev.games] : [];
  let through = prev?.through || null;
  let complete = false;
  let newGames = [];

  if (retryOnly) {
    const ids = new Set(prev.noBox);
    newGames = games.filter((g) => ids.has(g.gameId));
    complete = true;
  } else {
    const want = days.filter((d) => (!through || d > through) && d <= yesterday);
    const boards = await pool(want, CONCURRENCY, async (d) => {
      try {
        return { d, events: (await getJson(scoreboardUrl(d.replaceAll("-", ""))))?.events || [] };
      } catch (e) {
        return { d, error: e.message };
      }
    });
    for (const b of boards) {
      // A finished season has to be read whole; a season in progress keeps
      // what it has and asks again tomorrow.
      if (b.error) {
        if (finished) throw new Error(`${season}: scoreboard ${b.d} failed — ${b.error}`);
        break;
      }
      if (!daySettled(b.events)) break;
      through = b.d;
      newGames.push(...parseScoreboard(b.events));
    }
    const seen = new Set(games.map((g) => g.gameId));
    newGames = newGames.filter((g) => !seen.has(g.gameId) && seen.add(g.gameId));
    games.push(...newGames);
    complete = finished && through === lastDay;
  }

  // Box scores for the new games, filed into their month.
  const monthKey = (g) => g.date.slice(0, 7);
  // A fresh bake (first time, --force, or an older version) starts its months
  // empty rather than appending to what an earlier bake wrote.
  const keys = [...new Set(newGames.map(monthKey))];
  const months = prev ? loadMonths(dir, keys) : new Map(keys.map((k) => [k, { names: [], games: {} }]));
  const nameIndexes = new Map();
  const nameIndex = (key) => {
    if (!nameIndexes.has(key)) {
      const m = months.get(key);
      nameIndexes.set(key, new Map(m.names.map((n, i) => [n, i])));
    }
    const idx = nameIndexes.get(key);
    return (name) => {
      if (!idx.has(name)) {
        idx.set(name, months.get(key).names.length);
        months.get(key).names.push(name);
      }
      return idx.get(name);
    };
  };
  let boxes = await pool(newGames, CONCURRENCY, (g) => fetchBox(g.gameId, getJson));
  // ESPN sometimes lists one game twice under two ids; only one has a box.
  // A boxless game that repeats another (same day, sides and score) is the
  // copy, and is dropped rather than kept as a game without a box score.
  if (!retryOnly) {
    const sig = (g) => `${g.date}|${g.home.tri}|${g.home.score}|${g.away.tri}|${g.away.score}`;
    const withBox = new Set(newGames.filter((g, i) => boxes[i]).map(sig));
    for (const g of games) if (!newGames.includes(g)) withBox.add(sig(g));
    const copy = new Set(newGames.filter((g, i) => !boxes[i] && withBox.has(sig(g))).map((g) => g.gameId));
    if (copy.size) {
      boxes = boxes.filter((b, i) => !copy.has(newGames[i].gameId));
      newGames = newGames.filter((g) => !copy.has(g.gameId));
      games = games.filter((g) => !copy.has(g.gameId));
    }
  }
  const noBox = new Set(retryOnly ? [] : (prev?.noBox || []));
  newGames.forEach((g, i) => {
    const parsed = boxes[i];
    if (!parsed) { noBox.add(g.gameId); return; }
    const key = monthKey(g);
    const ni = nameIndex(key);
    // ESPN lists the away side first; trust the tricodes over the order.
    let { a: away, b: home } = parsed;
    if (away.tri === g.home.tri && home.tri === g.away.tri) [away, home] = [home, away];
    const side = (s, meta) => ({
      tri: meta.tri, score: meta.score,
      players: s.players.filter((p) => p.mp > 0).map((p) => packLine(p, ni)),
    });
    months.get(key).games[g.gameId] = { home: side(home, g.home), away: side(away, g.away) };
  });

  // A retry that found nothing changes nothing: leave the files (and their
  // timestamps) alone, so a daily run doesn't commit — and redeploy — for it.
  if (retryOnly && newGames.every((g) => noBox.has(g.gameId))) {
    return `${season}: retried ${newGames.length} missing box scores, 0 found`;
  }

  // Months first, the index last: the index is what the page trusts.
  if (!prev && fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) if (/^\d{4}-\d{2}\.json$/.test(f) && !months.has(f.slice(0, 7))) fs.rmSync(path.join(dir, f));
  }
  for (const [key, m] of months) {
    writeJson(path.join(dir, `${key}.json`), { season, month: key, names: m.names, games: m.games });
  }
  games.sort((x, y) => x.gameDateTimeUTC.localeCompare(y.gameDateTimeUTC) || x.gameId.localeCompare(y.gameId));
  if (!games.length && !complete) return `${season}: no games yet`;
  writeJson(indexFile, {
    season,
    version: BAKE_VERSION,
    through,
    complete,
    games,
    noBox: [...noBox].sort(),
    source: "espn",
    fetchedAt: new Date().toISOString(),
  });
  const boxed = newGames.length - newGames.filter((g) => noBox.has(g.gameId)).length;
  return retryOnly
    ? `${season}: retried ${newGames.length} missing box scores, ${boxed} found`
    : `${season}: +${newGames.length} games (${boxed} with box scores) through ${through}${complete ? ", complete" : ""}; ${games.length} total, ${noBox.size} without a box score`;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const named = args.flatMap((a, i) => (a === "--season" ? [args[i + 1]] : [])).filter((s) => /^\d{4}-\d{2}$/.test(s || ""));
  const maxAt = args.indexOf("--max-seasons");
  const max = maxAt >= 0 ? Number(args[maxAt + 1]) : Infinity;
  const today = todayEt();
  // The season in progress first, so a daily run always tops it up.
  const targets = named.length ? named : allSeasons(today).reverse();
  let worked = 0, failed = 0;
  for (const s of targets) {
    if (worked >= max) break;
    try {
      const line = await bakeSeason(s, { force, today });
      console.log(line);
      if (!/already baked|not started|, 0 found$/.test(line)) worked += 1;
    } catch (e) {
      failed += 1;
      worked += 1;
      console.error(e.message);
      // In a workflow, also as an annotation, readable without the full log.
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=${s} not baked::${e.message.replace(/\r?\n/g, " ")}`);
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
