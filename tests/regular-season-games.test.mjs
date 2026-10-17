// Regular-season games by month: the ESPN scoreboard parse, the month and day
// grouping, and /api/regular-season/games against a stubbed ESPN.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayLabel, etDate, groupByDay, groupByMonth, parseScoreboard, seasonMonths,
} from "../app/lib/regular-season-games.js";
import { GET } from "../app/api/regular-season/games/route.js";

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
  ]);
  assert.deepEqual(games.map((g) => g.gameId), ["1", "7", "8"]);
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

test("/api/regular-season/games asks ESPN month by month", async (t) => {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    asked.push(url);
    const events = url.includes("dates=20251101-20251130")
      ? [ev("10", "2025-11-05T00:00Z", "CLE", 112, "DET", 100)]
      : url.includes("dates=20260401-20260430")
        ? [ev("11", "2026-04-12T19:00Z", "SAS", 130, "DEN", 125)]
        : [];
    return new Response(JSON.stringify({ events }), { status: 200 });
  });
  const res = await GET(new Request("http://x/api/regular-season/games?season=2025-26"));
  const d = await res.json();
  assert.equal(asked.length, 8);
  assert.ok(asked.some((u) => u.includes("dates=20260201-20260228")), "month's last day");
  assert.deepEqual(d.months.map((m) => [m.label, m.games.length]), [["November", 1], ["April", 1]]);
  assert.deepEqual(d.errors, []);
  assert.match(res.headers.get("Cache-Control"), /s-maxage=604800/);
});

test("/api/regular-season/games: a lost month is reported, losing all is an error", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => (url.includes("dates=202512")
    ? new Response("", { status: 404 })
    : new Response(JSON.stringify({ events: [ev("10", "2025-11-05T00:00Z", "CLE", 112, "DET", 100)] }), { status: 200 })));
  const partial = await GET(new Request("http://x/api/regular-season/games?season=2025-26"));
  assert.equal(partial.status, 200);
  assert.deepEqual((await partial.json()).errors, ["202512: HTTP 404"]);
  assert.match(partial.headers.get("Cache-Control"), /s-maxage=3600/);

  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 403 }));
  assert.equal((await GET(new Request("http://x/api/regular-season/games?season=2025-26"))).status, 500);
  assert.equal((await GET(new Request("http://x/api/regular-season/games?season=nope"))).status, 400);
});
