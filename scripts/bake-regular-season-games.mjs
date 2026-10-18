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
import { boxHasMinutes, espnBoxUrls, parseEspnPayload } from "../app/api/_lib/espn-box.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = process.env.RS_GAMES_OUT || path.join(ROOT, "public", BAKED_DIR);
const FIRST_SEASON = "1999-00";
const CONCURRENCY = 8;
// Raised whenever a change to what gets kept means seasons baked earlier are
// wrong; a season baked by an older version is rebaked whole. 2: the Nets
// ("NJ" on ESPN) kept, phantom 0-0 finals and repeated games dropped, the
// In-Season Tournament final left out. 3: a finished season reads every day
// (an old event's stale status no longer ends it early), and the index lists
// what was skipped and why. 4: a box score with no minutes falls back to the
// CDN core, and any still without them are listed.
export const BAKE_VERSION = 4;

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

// One game's box score from ESPN's summary, falling back to the CDN core
// when the summary has none, or has one with no minutes in it.
async function fetchBox(gameId, getJson) {
  let best = null;
  for (const url of espnBoxUrls(gameId)) {
    try {
      const parsed = parseEspnPayload(await getJson(url));
      if (boxHasMinutes(parsed)) return parsed;
      best = best || parsed;
    } catch {
      // try the next source
    }
  }
  return best;
}

// --- basketball-reference fallback -----------------------------------------
// For ~165 games a season in 2012-13 to 2017-18 ESPN has only an empty box
// score: every player "--" minutes and zeros. Those games are read from
// basketball-reference instead, at the R pipeline's pace (one page every
// ~3s; BR blocks anything much faster).

const BR_DELAY_MS = Number(process.env.BR_DELAY_MS ?? 3100);
const BR_URL = (brId) => `https://www.basketball-reference.com/boxscores/${brId}.html`;

// The app's tricode -> basketball-reference's, for the season.
export function brTri(tri, season) {
  const y = Number(season.slice(0, 4));
  if (tri === "BKN") return "BRK";
  if (tri === "PHX") return "PHO";
  if (tri === "CHA") return y >= 2014 ? "CHO" : "CHA";
  if (tri === "NOP") return y >= 2013 ? "NOP" : y === 2005 || y === 2006 ? "NOK" : "NOH";
  return tri;
}

const decode = (t) => t.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
const brNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const brMin = (v) => {
  if (!v) return 0;
  if (v.includes(":")) { const [m, sec] = v.split(":"); return (parseInt(m, 10) || 0) + (parseFloat(sec) || 0) / 60; }
  return brNum(v);
};

// One team's basic box table (id box-<TRI>-game-basic) -> its player lines,
// in the shape the ESPN parse gives. Starters are the rows before "Reserves".
export function parseBrSide(html, tri) {
  const start = html.indexOf(`id="box-${tri}-game-basic"`);
  if (start < 0) return null;
  const body = html.slice(start, html.indexOf("</table>", start));
  const tbody = body.slice(body.indexOf("<tbody"), body.indexOf("</tbody>"));
  const players = [];
  let starters = true;
  for (const row of tbody.split(/<tr\b/).slice(1)) {
    if (/class="[^"]*thead/.test(row.slice(0, 80))) { starters = false; continue; }
    const cell = {};
    for (const m of row.matchAll(/data-stat="([a-z0-9_]+)"[^>]*>([\s\S]*?)<\/t[dh]>/g)) cell[m[1]] = decode(m[2]);
    if (!cell.player || cell.reason) continue;
    const mp = brMin(cell.mp);
    if (!(mp > 0)) continue;
    players.push({
      name: cell.player, starter: starters, oncourt: false, mp,
      pts: brNum(cell.pts), reb: brNum(cell.trb), drb: brNum(cell.drb), orb: brNum(cell.orb),
      ast: brNum(cell.ast), stl: brNum(cell.stl), blk: brNum(cell.blk), tov: brNum(cell.tov),
      fgm: brNum(cell.fg), fga: brNum(cell.fga), tpm: brNum(cell.fg3), tpa: brNum(cell.fg3a),
      ftm: brNum(cell.ft), fta: brNum(cell.fta), plusMinus: brNum((cell.plus_minus || "").replace("+", "")),
    });
  }
  return players.length ? players : null;
}

let lastBr = 0;
async function fetchText(url) {
  const wait = BR_DELAY_MS - (Date.now() - lastBr);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastBr = Date.now();
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { ...HEADERS, Accept: "text/html" } });
    if (res.ok) return await res.text();
    // BR's rate limit; back off a minute, as the R pipeline does.
    if ((res.status === 429 || res.status === 503) && attempt < 3) { await new Promise((r) => setTimeout(r, 60000)); continue; }
    throw new Error(`HTTP ${res.status} ${url}`);
  }
}

// A game's box from basketball-reference -> { a: away, b: home }, or null.
// Names are put in ESPN's spelling (`nameFor`), so a player is one row in a
// month whichever source each of his games came from.
async function fetchBrBox(g, season, getText, nameFor) {
  const home = brTri(g.home.tri, season), away = brTri(g.away.tri, season);
  const html = await getText(BR_URL(`${g.date.replaceAll("-", "")}0${home}`));
  const h = parseBrSide(html, home), a = parseBrSide(html, away);
  if (!h || !a) return null;
  const rename = (ps, tri) => ps.map((p) => ({ ...p, name: nameFor(p.name, tri) }));
  return { a: { tri: g.away.tri, players: rename(a, g.away.tri) }, b: { tri: g.home.tri, players: rename(h, g.home.tri) }, labels: "bbref" };
}

// A name folded for matching across sources: accents and the letters that
// don't decompose (ı, ł, ø, đ) dropped to plain ones, suffixes and every
// space and dot gone — "C.J. Miles" and "CJ Miles", "Ömer Aşık" and
// "Omer Asik" fold the same.
export const normName = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/ı/g, "i").replace(/ł/g, "l").replace(/ø/g, "o").replace(/[đð]/g, "d").replace(/ß/g, "ss")
  .toLowerCase().replace(/[\s,]+(jr|sr|ii|iii|iv)\.?$/, "").replace(/[^a-z0-9]/g, "");

// A last name, folded the same way.
const lastName = (s) => normName((s || "").replace(/[\s,]+(jr|sr|ii|iii|iv)\.?$/i, "").trim().split(/\s+/).pop());

// BR name -> the ESPN spelling: the same folded name anywhere in the season,
// or else the one ESPN name on that team with the same last name (Jeff /
// Jeffery Taylor, Slava / Viacheslav Kravtsov), narrowed by first initial
// when the team has two. `espnByTeam` is Map(tri -> Set of ESPN names).
export function espnSpelling(name, tri, spelled, espnByTeam) {
  const exact = spelled.get(normName(name));
  if (exact) return exact;
  const last = lastName(name);
  let hits = [...(espnByTeam.get(tri) || [])].filter((n) => lastName(n) === last);
  if (hits.length > 1) hits = hits.filter((n) => normName(n)[0] === normName(name)[0]);
  return hits.length === 1 ? hits[0] : name;
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
export async function bakeSeason(season, { getJson = fetchJson, getText = fetchText, outDir = OUT_DIR, today = todayEt(), force = false } = {}) {
  const dir = path.join(outDir, season);
  const indexFile = path.join(dir, "index.json");
  const stored = readJson(indexFile);
  const prev = force || (stored?.version || 1) < BAKE_VERSION ? null : stored;
  const days = seasonDays(season);
  const lastDay = days[days.length - 1];
  const yesterday = addDays(today, -1);
  const finished = yesterday >= lastDay;

  if (!finished && days[0] > yesterday) return `${season}: not started`;

  // A finished season already baked: only the games ESPN had no box for, or
  // a box with no minutes.
  const retryOnly = prev?.complete;
  // (A minuteless box already tried at basketball-reference isn't tried
  // again: that's a thousand slow pages a day if BR can't help.)
  const retryIds = new Set([...(prev?.noBox || []), ...(prev?.noMinutes || []).filter((x) => !x.brTried).map((x) => x.gameId)]);
  if (retryOnly && !retryIds.size) return `${season}: already baked (${prev.games.length} games)`;

  let games = prev?.games ? [...prev.games] : [];
  let through = prev?.through || null;
  let complete = false;
  let newGames = [];
  const skipped = [];
  const noMinutes = [];
  const fromBr = [];
  const brErrors = [];

  if (retryOnly) {
    newGames = games.filter((g) => retryIds.has(g.gameId));
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
      // An unsettled day only ends the season in progress: in a finished
      // season it is an old event whose status ESPN never updated.
      if (!finished && !daySettled(b.events)) break;
      through = b.d;
      newGames.push(...parseScoreboard(b.events, {
        // Postseason events (type 3) are expected on these days; the rest
        // are worth a look if a season comes up short.
        onSkip: (g, why) => { if (why !== "season type 3" && why !== "season type 1") skipped.push({ ...g, why }); },
      }));
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
  // ESPN boxes with no minutes: basketball-reference instead, for a finished
  // season. Names map to the ESPN spelling seen anywhere in the season.
  if (finished && boxes.some((b) => b && !boxHasMinutes(b))) {
    const spelled = new Map();
    const espnByTeam = new Map();
    const see = (n, tri) => {
      const k = normName(n);
      if (k && !spelled.has(k)) spelled.set(k, n);
      if (tri) { if (!espnByTeam.has(tri)) espnByTeam.set(tri, new Set()); espnByTeam.get(tri).add(n); }
    };
    for (const b of boxes) if (b && boxHasMinutes(b)) for (const side of [b.a, b.b]) side.players.forEach((p) => see(p.name, side.tri));
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (!/^\d{4}-\d{2}\.json$/.test(f)) continue;
        const m = readJson(path.join(dir, f));
        const fromBr = new Set(prev?.fromBbref || []);
        for (const [id, g] of Object.entries(m?.games || {})) {
          if (fromBr.has(id)) continue;
          for (const side of [g.home, g.away]) for (const r of side.players) see(m.names[r[0]], side.tri);
        }
      }
    }
    const nameFor = (n, tri) => espnSpelling(n, tri, spelled, espnByTeam);
    for (let i = 0; i < newGames.length; i++) {
      if (!boxes[i] || boxHasMinutes(boxes[i])) continue;
      try {
        const br = await fetchBrBox(newGames[i], season, getText, nameFor);
        if (br) { boxes[i] = br; fromBr.push(newGames[i].gameId); }
      } catch (e) {
        brErrors.push(`${newGames[i].gameId}: ${e.message}`);
      }
    }
  }
  const noBox = new Set(retryOnly ? [] : (prev?.noBox || []));
  newGames.forEach((g, i) => {
    const parsed = boxes[i];
    if (!parsed) { noBox.add(g.gameId); return; }
    if (!boxHasMinutes(parsed)) noMinutes.push({ gameId: g.gameId, date: g.date, labels: parsed.labels, sample: parsed.sample, brTried: finished || undefined });
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

  // Months first, the index last: the index is what the page trusts.
  if (!prev && fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) if (/^\d{4}-\d{2}\.json$/.test(f) && !months.has(f.slice(0, 7))) fs.rmSync(path.join(dir, f));
  }
  games.sort((x, y) => x.gameDateTimeUTC.localeCompare(y.gameDateTimeUTC) || x.gameId.localeCompare(y.gameId));
  if (!games.length && finished) throw new Error(`${season}: ESPN listed no regular-season games`);
  if (!games.length && !complete) return `${season}: no games yet`;
  const retried = new Set(newGames.map((g) => g.gameId));
  const index = {
    season,
    version: BAKE_VERSION,
    through,
    complete,
    games,
    noBox: [...noBox].sort(),
    // NBA-vs-NBA events left out, other than preseason and postseason ones.
    skipped: retryOnly ? prev.skipped || [] : [...(prev?.skipped || []), ...skipped],
    // Games whose box score, from either source, has a side with no minutes.
    noMinutes: [...(prev?.noMinutes || []).filter((x) => !retried.has(x.gameId)), ...noMinutes],
    // Games whose box score came from basketball-reference, not ESPN.
    fromBbref: [...new Set([...(prev?.fromBbref || []).filter((id) => !retried.has(id)), ...fromBr])].sort(),
    source: "espn",
  };
  const boxed = newGames.length - newGames.filter((g) => noBox.has(g.gameId)).length;
  const fixed = newGames.filter((g) => !noBox.has(g.gameId) && !noMinutes.some((x) => x.gameId === g.gameId)).length;
  // A retry that changed nothing leaves the files (and their timestamps)
  // alone, so a daily run doesn't commit — and redeploy — for it.
  const { fetchedAt: _, ...prevIndex } = prev || {};
  if (retryOnly && JSON.stringify(index) === JSON.stringify(prevIndex)) {
    return `${season}: retried ${newGames.length} box scores, 0 fixed`;
  }
  for (const [key, m] of months) {
    writeJson(path.join(dir, `${key}.json`), { season, month: key, names: m.names, games: m.games });
  }
  writeJson(indexFile, { ...index, fetchedAt: new Date().toISOString() });
  return retryOnly
    ? `${season}: retried ${newGames.length} box scores, ${fixed} fixed${fromBr.length ? ` (${fromBr.length} from basketball-reference)` : ""}${brErrors.length ? `; BR errors: ${brErrors.slice(0, 2).join("; ")}` : ""}`
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
      if (process.env.GITHUB_ACTIONS && /\+\d+ games/.test(line)) console.log(`::notice title=${s}::${line}`);
      if (!/already baked|not started|, 0 fixed$/.test(line)) worked += 1;
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
