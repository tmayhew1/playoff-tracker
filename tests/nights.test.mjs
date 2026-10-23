// "Last night": the nightly bake (scripts/bake-nights.mjs) run against the
// NBA-CDN-shaped fixtures in tests/fixtures/nights, and /api/nights on what
// it writes — and on ESPN's answer for a night not baked yet.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { seasonOf } from "../scripts/bake-nights.mjs";
import { valueAddParts, lgaForSeason } from "../app/scoring.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "nights-"));
const bake = (...args) => execFileSync(process.execPath, [
  "--import", "./scripts/node/register.mjs", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  "scripts/bake-nights.mjs", ...args,
], { cwd: ROOT, env: { ...process.env, NIGHTS_FIXTURES: "tests/fixtures/nights", NIGHTS_OUT: OUT }, encoding: "utf8" });

// No network: ESPN answers whatever `espn` holds, by URL, and nothing else.
// Empty, it's down — so the baked-night tests below never reach it.
let espn = {};
const asked = [];
globalThis.fetch = async (url) => {
  asked.push(url);
  const key = Object.keys(espn).find((k) => url.includes(k));
  if (!key) throw new Error("offline");
  return new Response(JSON.stringify(espn[key]), { status: 200 });
};

// The route reads NIGHTS_DIR when it loads, so set it before importing.
process.env.NIGHTS_DIR = OUT;
const { GET } = await import("../app/api/nights/route.js");
const getRes = (q = "") => GET(new Request(`http://x/api/nights${q}`));
const get = async (q = "") => (await getRes(q)).json();

test("seasons turn over in the fall", () => {
  assert.equal(seasonOf("2026-10-21"), "2026-27");
  assert.equal(seasonOf("2027-04-12"), "2026-27");
  assert.equal(seasonOf("2027-06-18"), "2026-27");
});

test("no nights baked: an empty answer, not an error", async () => {
  const d = await get();
  assert.equal(d.date, null);
  assert.deepEqual(d.dates, []);
});

test("the bake writes finished nights only, once", () => {
  const log = bake("--date", "2026-01-15", "--date", "2026-01-16", "--date", "2025-10-05");
  assert.match(log, /2026-01-15: 2 games, 7 player lines \(6 linked/);
  assert.match(log, /2026-01-16: 1 of 1 games not final yet - skipped/);
  assert.match(log, /2025-10-05: no games/); // preseason doesn't count
  assert.deepEqual(fs.readdirSync(OUT), ["2026-01-15.json"]);
  assert.match(bake("--date", "2026-01-15"), /already baked/);

  const night = JSON.parse(fs.readFileSync(path.join(OUT, "2026-01-15.json"), "utf8"));
  assert.equal(night.season, "2025-26");
  assert.ok(!night.players.some((p) => p.name === "Deep Bench Guy"), "a DNP is left out");
  const jokic = night.players.find((p) => p.slug === "jokicni01");
  assert.equal(jokic.name, "Nikola Jokić");
  assert.deepEqual([jokic.team, jokic.opp, jokic.mp, jokic.pts, jokic.drb, jokic.orb], ["DEN", "NYK", 37, 31, 12, 4]);
});

test("/api/nights scores and ranks the night", async () => {
  const d = await get();
  assert.equal(d.date, "2026-01-15");
  assert.equal(d.baselineSeason, "2025-26");
  assert.equal(d.lines.length, 6, "the line under 12 minutes doesn't qualify");
  assert.ok(d.lines.every((l) => l.mp >= 12));
  for (let i = 1; i < d.lines.length; i++) assert.ok(d.lines[i - 1].va >= d.lines[i].va, "sorted by VA");
  const top = d.lines[0];
  assert.equal(top.slug, "jokicni01");
  assert.equal(top.won, true);
  assert.equal(top.reb, 16);
  const expect = valueAddParts(top, lgaForSeason("2025-26")).va;
  assert.ok(Math.abs(top.va - expect) < 1e-9);
  assert.ok(top.seasonVaPerG > 0, "set against his season average");
  assert.ok(!d.lines.some((l) => l.name === "Two Way Rookie"), "four minutes is under the cut");
});

test("dates step and fall back", async () => {
  fs.copyFileSync(path.join(OUT, "2026-01-15.json"), path.join(OUT, "2026-01-14.json"));
  const latest = await get();
  assert.equal(latest.prev, "2026-01-14");
  assert.equal(latest.next, null);
  const earlier = await get("?date=2026-01-14");
  assert.equal(earlier.next, "2026-01-15");
  assert.equal((await get("?date=../../etc")).date, "2026-01-15");
  const usg = await get("?usg=1");
  assert.equal(usg.usgAdj, true);
  assert.notEqual(usg.lines[0].va, latest.lines[0].va);
});

// ESPN's side of 2026-01-16: one game, DEN 118 at NYK 110.
const event = (state) => ({
  id: "401800001", date: "2026-01-17T00:30Z", season: { type: 2 },
  competitions: [{
    status: { type: { state, completed: state === "post" } },
    competitors: [
      { homeAway: "home", team: { abbreviation: "NY" }, score: "110" },
      { homeAway: "away", team: { abbreviation: "DEN" }, score: "118" },
    ],
  }],
});
const NAMES = ["MIN", "FG", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-", "PTS"];
const athlete = (name, stats) => ({ athlete: { displayName: name }, starter: true, stats });
const summary = {
  boxscore: {
    players: [
      { team: { abbreviation: "DEN" }, statistics: [{ names: NAMES, athletes: [
        athlete("Nikola Jokic", ["38", "12-20", "2-4", "8-9", "3", "11", "14", "12", "2", "1", "3", "2", "+9", "34"]),
        { athlete: { displayName: "Deep Bench Guy" }, didNotPlay: true, stats: [] },
      ] }] },
      { team: { abbreviation: "NY" }, statistics: [{ names: NAMES, athletes: [
        athlete("Jalen Brunson", ["36", "10-22", "3-8", "6-6", "0", "3", "3", "7", "1", "0", "4", "3", "-6", "29"]),
      ] }] },
    ],
  },
};
const espnUp = (state = "post") => {
  espn = { "scoreboard?dates=20260116": { events: [event(state)] }, "summary?event=401800001": summary };
};
// 1am Pacific on Jan 17: the 16th is over out West, and not baked.
const AFTER_MIDNIGHT_PT = Date.parse("2026-01-17T09:00:00Z");

test("after midnight Pacific, last night comes from ESPN until it's baked", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: AFTER_MIDNIGHT_PT });
  espnUp();
  const res = await getRes();
  assert.match(res.headers.get("Cache-Control"), /s-maxage=300\b/);
  const d = await res.json();
  assert.equal(d.date, "2026-01-16");
  assert.equal(d.source, "espn");
  assert.equal(d.prev, "2026-01-15");
  assert.equal(d.next, null);
  assert.deepEqual(d.games, [{ gameId: "401800001", kind: "regular", home: { tri: "NYK", score: 110 }, away: { tri: "DEN", score: 118 } }]);
  assert.equal(d.lines.length, 2, "the DNP is left out");
  const [top, other] = d.lines;
  assert.deepEqual([top.name, top.slug, top.team, top.opp, top.won, top.reb, top.pts], ["Nikola Jokic", "jokicni01", "DEN", "NYK", true, 14, 34]);
  assert.ok(Math.abs(top.va - valueAddParts(top, lgaForSeason("2025-26")).va) < 1e-9);
  assert.equal(other.won, false);

  // Stepping back and forth reaches it too.
  assert.equal((await get("?date=2026-01-15")).next, "2026-01-16");
  assert.equal((await get("?date=2026-01-16")).source, "espn");
});

test("a game still on, or ESPN down, keeps the last baked night", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: AFTER_MIDNIGHT_PT });
  espnUp("in");
  const res = await getRes();
  assert.match(res.headers.get("Cache-Control"), /s-maxage=300\b/, "asked again soon");
  assert.equal((await res.json()).date, "2026-01-15");
  espn = {};
  const d = await get();
  assert.equal(d.date, "2026-01-15");
  assert.equal(d.next, null);
});

test("before midnight Pacific, and once baked, ESPN isn't asked", async (t) => {
  espnUp();
  // 11pm Pacific on the 15th: the 15th is still tonight, and the 14th's
  // successor is baked, so the latest holds until midnight.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-01-16T07:00:00Z") });
  asked.length = 0;
  const res = await getRes();
  assert.equal((await res.json()).date, "2026-01-15");
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=3600, s-maxage=3600");
  assert.equal((await getRes("?date=2026-01-14")).headers.get("Cache-Control"), "public, max-age=3600, s-maxage=86400");
  assert.deepEqual(asked, []);

  t.mock.timers.setTime(AFTER_MIDNIGHT_PT);
  fs.copyFileSync(path.join(OUT, "2026-01-15.json"), path.join(OUT, "2026-01-16.json"));
  const d = await get();
  assert.equal(d.date, "2026-01-16");
  assert.equal(d.source, "cdn.nba.com");
  assert.deepEqual(asked, []);
});
