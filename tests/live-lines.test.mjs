// Tonight's games on the regular-season board (app/lib/live-lines.js): a game
// in progress counts toward G as the share of it played, and its lines add
// onto the baked totals.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { addLiveLines, clockSeconds, gameFraction, liveLines } from "../app/lib/live-lines.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≉ ${b}`);

test("the clock reads as seconds left", () => {
  assert.equal(clockSeconds("PT05M21.00S"), 321);
  assert.equal(clockSeconds("PT00M45.20S"), 45.2);
  assert.equal(clockSeconds(""), null);
});

test("a game counts as the share of it played", () => {
  close(gameFraction({ gameStatus: 2, period: 1, gameClock: "PT12M00.00S" }), 0);
  close(gameFraction({ gameStatus: 2, period: 2, gameClock: "PT00M00.00S" }), 0.5);
  close(gameFraction({ gameStatus: 2, period: 3, gameClock: "PT06M00.00S" }), 0.625);
  close(gameFraction({ gameStatus: 2, period: 4, gameClock: "PT00M00.00S" }), 1);
  // Overtime: of the game as it now stands, regulation plus one OT.
  close(gameFraction({ gameStatus: 2, period: 5, gameClock: "PT02M30.00S" }), (2880 + 150) / 3180);
  assert.equal(gameFraction({ gameStatus: 3, period: 4 }), 1);
  assert.equal(gameFraction({ gameStatus: 1, period: 0 }), 0);
});

const player = (name, extra = {}) => ({ name, mp: 10, pts: 8, ast: 2, stl: 0, blk: 1, tov: 1, drb: 3, orb: 1, fgm: 3, fga: 6, tpm: 1, tpa: 3, ftm: 1, fta: 2, ...extra });
const GAMES = [
  { gameId: "1", date: "2026-10-23", gameStatus: 2, period: 3, gameClock: "PT06M00.00S",
    box: { home: { tri: "DAL", players: [player("Cooper Flagg"), player("Bench Guy", { mp: 0 })] }, away: { tri: "SAS", players: [player("Victor Wembanyama", { pts: 20 })] } } },
  { gameId: "2", gameStatus: 3, period: 4, gameClock: "",
    box: { home: { tri: "NYK", players: [player("Jalen Brunson")] }, away: { tri: "BOS", players: [] } } },
  { gameId: "3", gameStatus: 2, period: 1, gameClock: "PT08M00.00S", box: null },
];

test("lines come from boxed games, players who've played only", () => {
  const lines = liveLines(GAMES);
  assert.deepEqual(lines.map((l) => l.name), ["Cooper Flagg", "Victor Wembanyama", "Jalen Brunson"]);
  close(lines[0].frac, 0.625);
  assert.equal(lines[0].live, true);
  assert.equal(lines[2].frac, 1);
  assert.equal(lines[2].live, false);
});

test("lines add onto the baked totals; a debut joins as a new row", () => {
  const baked = [
    { name: "Victor Wembanyama", team: "SAS", slug: "wembavi01", g: 2, mp: 60, pts: 50, ast: 4, stl: 2, blk: 8, tov: 5, drb: 20, orb: 4, fgm: 18, fga: 35, tpm: 4, tpa: 12, ftm: 10, fta: 12 },
    { name: "Jalen Brunson", team: "NYK", slug: "brunsja01", g: 2, mp: 70, pts: 60, ast: 14, stl: 1, blk: 0, tov: 4, drb: 5, orb: 1, fgm: 22, fga: 44, tpm: 6, tpa: 16, ftm: 10, fta: 11 },
  ];
  const rows = addLiveLines(baked, liveLines(GAMES));
  const wemby = rows.find((r) => r.name === "Victor Wembanyama");
  assert.equal(wemby.g, 2.625);
  assert.equal(wemby.pts, 70);
  assert.deepEqual(wemby.live, { gameId: "1", date: "2026-10-23", frac: 0.625 });
  const brunson = rows.find((r) => r.name === "Jalen Brunson");
  assert.equal(brunson.g, 3);
  assert.equal(brunson.live, undefined);
  const flagg = rows.find((r) => r.name === "Cooper Flagg");
  assert.equal(flagg.team, "DAL");
  assert.equal(flagg.g, 0.625);
  // The baked rows themselves are left as they were.
  assert.equal(baked[0].g, 2);
  assert.equal(addLiveLines(baked, []), baked);
});
