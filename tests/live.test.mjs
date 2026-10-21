// The Live tab's slate (app/api/_lib/live-games.js): the NBA and ESPN
// scoreboards read into one game shape, merged, and ordered live-first.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { isoClock, mergeSlates, parseEspnScoreboard, parseNbaScoreboard, seasonOf } from "../app/api/_lib/live-games.js";

const nbaGame = (gameId, status, away, home, extra = {}) => ({
  gameId, gameCode: `20261021/${away}${home}`, gameStatus: status, gameStatusText: extra.text || "",
  period: extra.period || 0, gameClock: extra.clock || "", gameTimeUTC: extra.tip || "2026-10-21T23:30:00Z",
  awayTeam: { teamTricode: away, score: extra.as ?? 0, wins: 1, losses: 0 },
  homeTeam: { teamTricode: home, score: extra.hs ?? 0, wins: 0, losses: 1 },
});
const NBA = {
  scoreboard: {
    gameDate: "2026-10-21",
    games: [
      nbaGame("0022600010", 3, "BOS", "NYK", { text: "Final", as: 110, hs: 104, tip: "2026-10-21T23:00:00Z" }),
      nbaGame("0022600012", 1, "LAL", "GSW", { text: "10:00 pm ET", tip: "2026-10-22T02:00:00Z" }),
      nbaGame("0022600011", 2, "SAS", "DAL", { text: "Q3 5:21", period: 3, clock: "PT05M21.00S", as: 71, hs: 68 }),
      nbaGame("0012600001", 1, "OKC", "HOU", { tip: "2026-10-22T00:00:00Z" }),
    ],
  },
};

const espnEvent = (id, state, away, home, extra = {}) => ({
  id, date: extra.tip || "2026-10-21T23:30Z", season: { type: extra.type ?? 2 },
  competitions: [{
    status: { period: extra.period || 0, displayClock: extra.clock || "0:00", type: { state, name: extra.name || "", shortDetail: extra.detail || "" } },
    competitors: [
      { homeAway: "home", score: String(extra.hs ?? 0), team: { abbreviation: home }, records: [{ type: "total", summary: "0-1" }] },
      { homeAway: "away", score: String(extra.as ?? 0), team: { abbreviation: away }, records: [{ type: "total", summary: "1-0" }] },
    ],
    geoBroadcasts: extra.tv ? [{ market: { type: "National" }, media: { shortName: extra.tv } }, { market: { type: "Home" }, media: { shortName: "KSAT" } }] : [],
  }],
});
const ESPN = {
  day: { date: "2026-10-21" },
  events: [
    espnEvent("401800010", "post", "BOS", "NY", { as: 110, hs: 104, detail: "Final" }),
    espnEvent("401800011", "in", "SA", "DAL", { period: 3, clock: "5:21", as: 71, hs: 68, detail: "5:21 - 3rd", tv: "ESPN" }),
    espnEvent("401800012", "pre", "LAL", "GS", { tip: "2026-10-22T02:00Z", tv: "TNT" }),
    espnEvent("401800013", "in", "MIA", "ORL", { period: 2, name: "STATUS_HALFTIME", detail: "Halftime" }),
  ],
};

test("seasons turn over in the fall", () => {
  assert.equal(seasonOf("2026-10-21"), "2026-27");
  assert.equal(seasonOf("2027-06-10"), "2026-27");
});

test("ESPN's clock reads as the NBA's ISO duration", () => {
  assert.equal(isoClock("5:21"), "PT05M21.00S");
  assert.equal(isoClock("12:00"), "PT12M00.00S");
  assert.equal(isoClock("45.2"), "PT00M45.20S");
  assert.equal(isoClock(""), "");
});

test("the NBA scoreboard: status, clock, records and stage", () => {
  const { date, games } = parseNbaScoreboard(NBA);
  assert.equal(date, "2026-10-21");
  const sas = games.find((g) => g.gameId === "0022600011");
  assert.equal(sas.gameStatus, 2);
  assert.equal(sas.period, 3);
  assert.equal(sas.gameClock, "PT05M21.00S");
  assert.deepEqual(sas.away, { tri: "SAS", score: 71, record: "1-0" });
  assert.equal(sas.boxSrc, null);
  assert.equal(sas.kind, "regular");
  assert.equal(games.find((g) => g.gameId === "0012600001").kind, "preseason");
});

test("the ESPN scoreboard: NBA tricodes, national TV, halftime", () => {
  const { games } = parseEspnScoreboard(ESPN);
  const sas = games.find((g) => g.gameId === "401800011");
  assert.equal(sas.gameStatus, 2);
  assert.equal(sas.away.tri, "SAS");
  assert.equal(sas.gameClock, "PT05M21.00S");
  assert.deepEqual(sas.broadcasters, ["ESPN"]);
  assert.equal(sas.boxSrc, "espn");
  assert.equal(games.find((g) => g.gameId === "401800012").home.tri, "GSW");
  assert.equal(games.find((g) => g.gameId === "401800013").gameStatusText, "Half");
  assert.equal(games.find((g) => g.gameId === "401800010").gameStatus, 3);
});

test("merged: the NBA's games with ESPN's TV, live first, then by tip, then finals", () => {
  const m = mergeSlates(parseNbaScoreboard(NBA), parseEspnScoreboard(ESPN));
  assert.equal(m.source, "nba");
  assert.deepEqual(m.games.map((g) => g.gameId), ["0022600011", "0012600001", "0022600012", "0022600010"]);
  assert.deepEqual(m.games[0].broadcasters, ["ESPN"]);
  assert.deepEqual(m.games[2].broadcasters, ["TNT"]);
});

test("the NBA feed down: ESPN's slate alone", () => {
  const m = mergeSlates(null, parseEspnScoreboard(ESPN));
  assert.equal(m.source, "espn");
  assert.equal(m.games.length, 4);
  assert.ok(m.games.every((g) => g.boxSrc === "espn"));
  assert.equal(m.games[0].gameStatus, 2);
});

test("both feeds down: nothing, and no source", () => {
  const m = mergeSlates(null, null);
  assert.equal(m.source, null);
  assert.deepEqual(m.games, []);
});

test("an empty NBA night is still the NBA's answer", () => {
  const m = mergeSlates({ date: "2026-07-04", games: [] }, null);
  assert.equal(m.source, "nba");
  assert.deepEqual(m.games, []);
});
