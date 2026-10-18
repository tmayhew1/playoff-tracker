// Regular-season games by month: the ESPN scoreboard parse, the month and day
// grouping, and /api/regular-season/games against a stubbed ESPN.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayLabel, etDate, groupByDay, groupByMonth, monthlyVA, monthTotals, parseScoreboard, seasonMonths,
} from "../app/lib/regular-season-games.js";
import { GET } from "../app/api/regular-season/games/route.js";
import { GET as LINES } from "../app/api/regular-season/lines/route.js";
import { lgaForSeason, valueAddParts } from "../app/scoring.js";

// One ESPN scoreboard event, trimmed to the fields the parse reads.
const ev = (id, date, home, hs, away, as, { type = 2, note = null, completed = true } = {}) => ({
  id,
  date,
  season: type == null ? undefined : { type },
  competitions: [{
    status: { type: { completed } },
    notes: note ? [{ headline: note }] : [],
    competitors: [
      { homeAway: "home", score: String(hs), team: { abbreviation: home } },
      { homeAway: "away", score: String(as), team: { abbreviation: away } },
    ],
  }],
});

test("the parse keeps finished regular-season games only", () => {
  const games = parseScoreboard([
    ev("1", "2025-10-22T23:30Z", "NY", 110, "BOS", 104),
    ev("2", "2025-10-08T23:00Z", "LAL", 99, "GS", 101, { type: 1 }), // preseason
    ev("3", "2026-04-15T23:30Z", "MIA", 120, "CHI", 98, { type: 5, note: "Play-In" }),
    ev("4", "2026-02-15T01:00Z", "EAST", 160, "WEST", 155), // All-Star
    ev("5", "2025-12-16T01:30Z", "OKC", 0, "SA", 0, { completed: false }),
    ev("6", "2025-12-17T01:30Z", "OKC", 111, "SA", 109, { note: "Emirates NBA Cup Championship" }),
    ev("7", "2025-12-10T00:00Z", "OKC", 118, "PHX", 101, { note: "NBA Cup Quarterfinal" }),
    ev("8", "2000-01-05T00:30Z", "SEA", 101, "VAN", 99, { type: null }),
    ev("9", "2000-04-25T00:30Z", "SEA", 101, "UTAH", 99, { type: null, note: "West 1st Round" }),
    ev("10", "1999-11-03T17:00Z", "CHI", 0, "NY", 0, { type: null }), // ESPN's phantom 0-0 copy
    ev("11", "2003-11-05T00:30Z", "NJ", 99, "BOS", 90),
    ev("12", "2023-12-10T01:30Z", "LAL", 123, "IND", 109, { note: "In-Season Tournament Championship" }),
  ]);
  assert.deepEqual(games.map((g) => g.gameId), ["1", "7", "8", "11"]);
  assert.equal(games[3].home.tri, "NJN", "ESPN's NJ is the app's NJN");
  assert.deepEqual(games[0].home, { tri: "NYK", score: 110 });
  assert.deepEqual(games[0].away, { tri: "BOS", score: 104 });
});

test("games are dated by the Eastern calendar", () => {
  assert.equal(etDate("2025-11-01T02:30Z"), "2025-10-31"); // 10:30pm ET Halloween
  assert.equal(etDate("2026-01-15T00:00Z"), "2026-01-14");
  assert.equal(etDate("2026-01-15T17:00Z"), "2026-01-15");
  assert.equal(dayLabel("2025-10-22"), "Wed, Oct 22");
});

test("months and days run oldest first, repeats dropped", () => {
  const games = parseScoreboard([
    ev("3", "2025-11-02T00:00Z", "DEN", 120, "PHX", 110),
    ev("1", "2025-10-22T23:30Z", "NY", 110, "BOS", 104),
    ev("2", "2025-11-01T02:30Z", "LAL", 100, "MIN", 98),
    ev("1", "2025-10-22T23:30Z", "NY", 110, "BOS", 104),
    ev("4", "2026-01-03T00:00Z", "MIA", 101, "ATL", 99),
  ]);
  const months = groupByMonth(games);
  assert.deepEqual(months.map((m) => [m.key, m.label, m.games.map((g) => g.gameId)]), [
    ["2025-10", "October", ["1", "2"]],
    ["2025-11", "November", ["3"]],
    ["2026-01", "January", ["4"]],
  ]);
  assert.deepEqual(groupByDay(months[0].games).map((d) => [d.date, d.games.length]), [
    ["2025-10-22", 1], ["2025-10-31", 1],
  ]);
});

test("a season spans October to May, the bubble to August", () => {
  assert.deepEqual(seasonMonths("2025-26"), ["202510", "202511", "202512", "202601", "202602", "202603", "202604", "202605"]);
  assert.deepEqual(seasonMonths("2019-20").slice(-2), ["202007", "202008"]);
});

const route = (q) => GET(new Request(`http://x/api/regular-season/games${q}`));

test("/api/regular-season/games asks ESPN one day at a time", async (t) => {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    asked.push(url);
    const events = url.endsWith("dates=20260204")
      ? [ev("10", "2026-02-05T00:00Z", "CLE", 112, "DET", 100), ev("11", "2026-02-05T03:00Z", "LAL", 120, "GS", 118)]
      : [];
    return new Response(JSON.stringify({ events }), { status: 200 });
  });
  const res = await route("?season=2025-26&month=202602");
  const d = await res.json();
  assert.equal(asked.length, 28, "every day of February");
  assert.ok(asked.every((u) => /scoreboard\?dates=202602\d\d$/.test(u)), "plain one-day queries");
  assert.deepEqual(d.games.map((g) => [g.gameId, g.date]), [["10", "2026-02-04"], ["11", "2026-02-04"]]);
  assert.deepEqual(d.errors, []);
  assert.match(res.headers.get("Cache-Control"), /s-maxage=604800/);
});

test("/api/regular-season/games: a lost day is reported, losing all is an error", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => (url.endsWith("dates=20251203")
    ? new Response("{\"message\": \"nope\"}", { status: 400 })
    : new Response(JSON.stringify({ events: [ev("10", "2025-12-05T00:00Z", "CLE", 112, "DET", 100)] }), { status: 200 })));
  const partial = await route("?season=2025-26&month=202512");
  assert.equal(partial.status, 200);
  assert.deepEqual((await partial.json()).errors, ['20251203: HTTP 400 {"message": "nope"}']);
  assert.match(partial.headers.get("Cache-Control"), /s-maxage=3600/);

  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 403 }));
  assert.equal((await route("?season=2025-26&month=202512")).status, 500);
  assert.equal((await route("?season=nope&month=202512")).status, 400);
  assert.equal((await route("?season=2025-26&month=202507")).status, 400, "outside the season");
});

// A stat line in the app's shape.
const line = (name, mp, pts, extra = {}) => ({
  name, mp, pts, reb: 0, drb: 0, orb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
  fgm: Math.round(pts / 2), fga: pts, tpm: 0, tpa: 0, ftm: 0, fta: 0, ...extra,
});

test("month totals: one row per player, best VA per game first", () => {
  const lga = lgaForSeason("2025-26");
  const boxes = [
    { gameId: "1", date: "2026-01-07", away: { tri: "BOS", players: [line("Star", 36, 40), line("DNP", 0, 0)] }, home: { tri: "NYK", players: [line("Mover", 20, 8)] } },
    { gameId: "2", away: { tri: "BOS", players: [line("Star", 34, 30)] }, home: { tri: "LAL", players: [line("Mover", 24, 12), line("Cameo", 30, 30)] } },
  ];
  const rows = monthTotals(boxes, lga);
  assert.deepEqual(rows.map((r) => r.name).sort(), ["Cameo", "Mover", "Star"], "a DNP is left out");
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].vapg >= rows[i].vapg, "sorted by VA per game");
  const star = rows.find((r) => r.name === "Star");
  assert.equal(star.gp, 2);
  assert.equal(star.pts, 70);
  const expect = valueAddParts(line("Star", 36, 40), lga).va + valueAddParts(line("Star", 34, 30), lga).va;
  assert.ok(Math.abs(star.va - expect) < 1e-9);
  assert.equal(star.games.length, 2);
  assert.equal(star.byGame[1].pts, 30);
  assert.deepEqual(star.gameContext, [{ opp: "NYK", dateLabel: "Jan 7" }, { opp: "LAL", dateLabel: null }]);
  const mover = rows.find((r) => r.name === "Mover");
  assert.equal(mover.team, "LAL", "a traded player sits under his latest team");
  assert.equal(mover.gp, 2);
});

test("monthly VA: each player's VA per game month by month", () => {
  const lga = lgaForSeason("2025-26");
  const box = (tri, ...players) => ({ away: { tri, players }, home: { tri: "XXX", players: [] } });
  const by = monthlyVA([
    { key: "2025-11", boxes: [box("BOS", line("Star", 36, 40)), box("BOS", line("Star", 34, 30))] },
    { key: "2025-12", boxes: [box("BOS", line("Bench", 12, 4))] },
    { key: "2026-01", boxes: [box("BOS", line("Star", 30, 20))] },
  ], lga);
  const star = by.get("Star");
  assert.equal(star.length, 3);
  assert.equal(star[0].gp, 2);
  assert.equal(star[1], null, "a month he sat out");
  assert.ok(Math.abs(star[2].vapg - valueAddParts(line("Star", 30, 20), lga).va) < 1e-9);
  assert.deepEqual(by.get("Bench").map((m) => m && m.gp), [null, 1, null]);
});

// ESPN's game summary, trimmed to what the box parse reads.
const summary = (away, home) => ({
  boxscore: {
    players: [away, home].map(([abbr, name, pts]) => ({
      team: { abbreviation: abbr },
      statistics: [{
        names: ["MIN", "FG", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-", "PTS"],
        athletes: [{ athlete: { displayName: name }, starter: true, stats: ["30", "8-15", "2-5", "4-4", "1", "5", "6", "3", "1", "0", "2", "2", "+4", String(pts)] }],
      }],
    })),
  },
});

test("/api/regular-season/lines answers several games at once", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.includes("event=401000001")) return new Response(JSON.stringify(summary(["NY", "Brunson", 22], ["SA", "Wemby", 30])), { status: 200 });
    return new Response("", { status: 404 });
  });
  const res = await LINES(new Request("http://x/api/regular-season/lines?ids=401000001,401000002"));
  const d = await res.json();
  assert.equal(d.games.length, 1);
  const g = d.games[0];
  assert.deepEqual([g.gameId, g.away.tri, g.home.tri], ["401000001", "NYK", "SAS"]);
  assert.deepEqual([g.home.players[0].name, g.home.players[0].pts, g.home.players[0].mp], ["Wemby", 30, 30]);
  assert.equal(d.errors.length, 1);
  assert.match(res.headers.get("Cache-Control"), /s-maxage=3600/);

  const lines = (q) => LINES(new Request(`http://x/api/regular-season/lines${q}`));
  assert.equal((await lines("?ids=401000002")).status, 500);
  assert.equal((await lines("?ids=abc")).status, 400);
  assert.equal((await lines("")).status, 400);
  assert.equal((await lines(`?ids=${Array.from({ length: 21 }, (_, i) => 401000000 + i).join(",")}`)).status, 400);
});
