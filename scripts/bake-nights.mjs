#!/usr/bin/env node
// Bake last night's box scores: every finished game's player lines, from
// ESPN, into app/data/nights/<YYYY-MM-DD>.json. The Explore tab's "Last
// night" card (/api/nights) scores and ranks them.
//
//   npm run bake:nights                     # every night not yet baked
//   npm run bake:nights -- --date 2026-10-21 [--date …] [--force]
//
// Run by the daily workflow at 7am ET, when the previous night's games are
// final. With no --date it bakes the last 3 nights plus every night since
// the newest one on disk (up to MAX_GAP), so a missed or failed run is
// caught up by the next one. A night is written only once every game on it
// is final, and is left alone after that unless --force.
//
// The NBA's CDN (cdn.nba.com) answered this from GitHub's runners until late
// October 2026, when it began refusing them with 403s. ESPN, which the rest
// of the app's box scores already come from, doesn't.
//
// NIGHTS_FIXTURES=<dir> answers ESPN's scoreboard and summary URLs from
// scoreboard_<YYYYMMDD>.json and summary_<eventId>.json in that directory
// instead of the network — how the tests run it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEspnNight } from "../app/api/_lib/espn-night.js";
import { slugsByName } from "../app/api/_lib/player-slugs.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const OUT_DIR = process.env.NIGHTS_OUT || path.join(DATA, "nights");
const FIXTURES = process.env.NIGHTS_FIXTURES || null;
const LOOKBACK = 3;
const MAX_GAP = 30;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

if (FIXTURES) {
  globalThis.fetch = async (url) => {
    const m = /scoreboard\?dates=(\d{8})|summary\?event=(\d+)/.exec(url);
    const file = m && path.join(FIXTURES, m[1] ? `scoreboard_${m[1]}.json` : `summary_${m[2]}.json`);
    if (!file || !fs.existsSync(file)) return new Response("{}", { status: 404 });
    return new Response(fs.readFileSync(file, "utf8"), { status: 200 });
  };
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

// basketball-reference slugs for the season's players, so a line can link to
// the player's page.
function slugIndex(season) {
  const file = path.join(DATA, `regular-season-${season}.json`);
  if (!fs.existsSync(file)) return new Map();
  return slugsByName(JSON.parse(fs.readFileSync(file, "utf8")).players);
}

// ESPN's one-off hiccups (a timeout, a 5xx) get two more tries.
async function withRetries(fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (FIXTURES || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function bakeNight(date, force) {
  const out = path.join(OUT_DIR, `${date}.json`);
  if (!force && fs.existsSync(out)) return `${date}: already baked`;
  const season = seasonOf(date);
  const { night, skip } = await withRetries(() => readEspnNight(date, season, slugIndex(season)));
  if (skip) return `${date}: ${skip}${skip === "no games" ? "" : " - skipped"}`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(night, null, 2) + "\n");
  const linked = night.players.filter((p) => p.slug).length;
  return `${date}: ${night.games.length} games, ${night.players.length} player lines (${linked} linked to a player page)`;
}

// The nights to try with no --date: the last LOOKBACK, and every one since
// the newest baked night, oldest first.
function defaultTargets() {
  const yesterday = addDays(todayEt(), -1);
  let from = addDays(yesterday, -(LOOKBACK - 1));
  const baked = fs.existsSync(OUT_DIR)
    ? fs.readdirSync(OUT_DIR).map((f) => f.replace(/\.json$/, "")).filter((d) => DATE_RE.test(d)).sort()
    : [];
  const newest = baked[baked.length - 1];
  if (newest && newest < from) from = [addDays(newest, 1), addDays(yesterday, -(MAX_GAP - 1))].sort().pop();
  const out = [];
  for (let d = from; d <= yesterday; d = addDays(d, 1)) out.push(d);
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dates = args.flatMap((a, i) => (a === "--date" ? [args[i + 1]] : [])).filter((d) => DATE_RE.test(d || ""));
  const targets = dates.length ? dates : defaultTargets();
  // One night ESPN fails on doesn't stop the rest; the run still exits 1,
  // with an annotation the workflow's summary shows.
  let failed = 0;
  for (const d of targets) {
    try {
      console.log(await bakeNight(d, force));
    } catch (e) {
      failed++;
      console.error(`${process.env.GITHUB_ACTIONS ? "::error::" : ""}${d}: ${e.message}`);
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
