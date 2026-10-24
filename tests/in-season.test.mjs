// The season in progress: its totals from the baked box scores
// (lib/season-to-date.js), and the Look Ahead's update with them
// (lib/in-season.js, data/in-season-model.json).
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gamesWithBoxes, inSeasonLga, inSeasonUsageModel, playerTotals, teamRecords } from "../app/lib/season-to-date.js";
import { addRows, missShrink, updatePlayer, updateTeam } from "../app/lib/in-season.js";
import { simulateAwards } from "../app/lib/projection-model.js";
import { playoffsBegun, seasonOf } from "../app/lib/regular-season-games.js";
import { USG_FTA_W, lgaForSeason, usageModelFor, valueAdd } from "../app/scoring.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), "utf8"));
const MODEL = read("app", "data", "in-season-model.json");

const line = (name, mp, extra = {}) => [name, 1, mp, ...["pts", "reb", "drb", "orb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta"].map((k) => extra[k] || 0), 0];
const tinySeason = () => {
  const index = { games: [
    { gameId: "1", date: "2026-10-20", gameDateTimeUTC: "2026-10-20T23:00Z", home: { tri: "AAA", score: 100 }, away: { tri: "BBB", score: 90 } },
    { gameId: "2", date: "2026-10-22", gameDateTimeUTC: "2026-10-22T23:00Z", home: { tri: "BBB", score: 110 }, away: { tri: "AAA", score: 104 } },
  ] };
  const names = ["Ann One", "Bo Two"];
  const month = { names, games: {
    1: { home: { tri: "AAA", score: 100, players: [[0, 1, 30, 20, 5, 4, 1, 3, 1, 0, 2, 8, 15, 2, 5, 2, 2, 0]] }, away: { tri: "BBB", score: 90, players: [[1, 1, 25, 10, 0, 0, 0, 1, 0, 2, 1, 4, 9, 0, 2, 2, 4, 0]] } },
    2: { home: { tri: "BBB", score: 110, players: [[1, 1, 20, 6, 0, 0, 0, 0, 0, 1, 0, 3, 6, 0, 1, 0, 0, 0]] }, away: { tri: "AAA", score: 104, players: [[0, 1, 34, 30, 5, 4, 1, 5, 2, 0, 3, 11, 18, 4, 8, 4, 4, 0]] } },
  } };
  return gamesWithBoxes(index, [month]);
};

test("a season's totals are its box scores added up", () => {
  const games = tinySeason();
  const ann = playerTotals(games).find((r) => r.name === "Ann One");
  assert.equal(ann.g, 2);
  assert.equal(ann.mp, 64);
  assert.equal(ann.pts, 50);
  assert.equal(ann.tpm, 6);
  assert.equal(ann.tg, 2);
  // Cut at a date: only the games on or before it.
  assert.equal(playerTotals(games, "2026-10-21").find((r) => r.name === "Ann One").pts, 20);
  const rec = teamRecords(games);
  assert.deepEqual(rec.AAA, { w: 1, l: 1, g: 2, pf: 204, pa: 200 });
  assert.equal(teamRecords(games, "2026-10-20").BBB.l, 1);
});

test("2026-27's baked box scores add up to its leaderboard rows", () => {
  const dir = path.join(ROOT, "public", "regular-season-games", "2026-27");
  const index = read("public", "regular-season-games", "2026-27", "index.json");
  const months = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => read("public", "regular-season-games", "2026-27", f));
  const rows = playerTotals(gamesWithBoxes(index, months));
  assert.ok(rows.length > 100);
  // Every player-minute of a game is one of five on the floor for 48+.
  const games = index.games.length, mp = rows.reduce((s, r) => s + r.mp, 0);
  assert.ok(mp >= games * 2 * 240 - 1 && mp < games * 2 * 300, `${mp} minutes over ${games} games`);
});

test("an early-season baseline leans on last season's", () => {
  const prior = lgaForSeason("2025-26");
  const thin = inSeasonLga([{ mp: 30, pts: 10, ast: 2, stl: 0, blk: 0, tov: 1, drb: 4, orb: 1, fgm: 4, fga: 9, tpm: 1, tpa: 4, ftm: 1, fta: 2 }], prior);
  // One game with no blocks doesn't make a block worthless.
  assert.ok(Math.abs(thin.laBLKperM - prior.laBLKperM) / prior.laBLKperM < 0.01);
  // And the baked 2026-27 entry is no longer the zero it was.
  assert.ok(lgaForSeason("2026-27").laBLKperM > 0.005);
});

const PRIOR = { g: 70, mp: 2380, pts: 1750, ast: 420, stl: 80, blk: 40, tov: 200, drb: 400, orb: 70, fgm: 630, fga: 1330, tpm: 175, tpa: 490, ftm: 315, fta: 385 };

test("with no games played the update is the preseason line", () => {
  const u = updatePlayer({ prior: PRIOR, healthyG: 70 }, MODEL);
  assert.equal(u.restG, 70);
  for (const k of ["mp", "pts", "ast", "drb", "fga"]) assert.ok(Math.abs(u.row[k] - PRIOR[k]) < 1e-6, k);
});

test("the games played are banked and the rest is projected at the mix", () => {
  // Ten games of 40 points on 25 shots — far above the preseason line.
  const ytd = { g: 10, mp: 360, pts: 400, ast: 60, stl: 12, blk: 6, tov: 30, drb: 60, orb: 10, fgm: 140, fga: 250, tpm: 40, tpa: 100, ftm: 80, fta: 90 };
  const u = updatePlayer({ prior: PRIOR, healthyG: 70, ytd, team: { played: 10 } }, MODEL);
  assert.equal(u.row.g, 10 + u.restG);
  assert.ok(Math.abs(u.row.pts - (400 + u.rest.pts)) < 1e-6);
  const perMin = (r, k) => r[k] / r.mp;
  // Moved toward the hot start, but not all the way.
  assert.ok(perMin(u.rest, "fga") > perMin(PRIOR, "fga") && perMin(u.rest, "fga") < perMin(ytd, "fga"));
  // Shooting is believed more slowly than shot volume.
  const share = (x0, x1, x) => (x - x0) / (x1 - x0);
  const volMove = share(perMin(PRIOR, "fga"), perMin(ytd, "fga"), perMin(u.rest, "fga"));
  const tpMove = share(PRIOR.tpm / PRIOR.tpa, ytd.tpm / ytd.tpa, u.rest.tpm / u.rest.tpa);
  assert.ok(tpMove < volMove, `${tpMove} vs ${volMove}`);
  // The games left never outrun the schedule.
  assert.ok(u.row.g <= 82);
  // A known injury takes games off what's left.
  const hurt = updatePlayer({ prior: PRIOR, healthyG: 70, ytd, team: { played: 10 }, outGames: 30 }, MODEL);
  assert.ok(hurt.restG < u.restG - 20);
  // And the range narrows as the games come in.
  assert.ok(missShrink(2000, MODEL) < missShrink(200, MODEL) && missShrink(0, MODEL) === 1);
});

test("addRows sums every box-score key", () => {
  const r = addRows({ g: 1, pts: 10, mp: 30 }, { g: 2, pts: 5, mp: 20 });
  assert.equal(r.g, 3);
  assert.equal(r.pts, 15);
  assert.equal(r.ast, 0);
});

test("a team's wins are its record plus the rest at the mix", () => {
  const none = updateTeam(0.6, null, MODEL.team);
  assert.ok(Math.abs(none.wins - 49.2) < 1e-9);
  // 10-0 by 15 a night: well above the preseason read, not yet all the way.
  const hot = updateTeam(0.5, { w: 10, l: 0, g: 10, pf: 1200, pa: 1050 }, MODEL.team);
  assert.ok(hot.winPct > 0.55 && hot.winPct < hot.pMargin);
  assert.ok(Math.abs(hot.wins - (10 + hot.winPct * 72)) < 1e-9);
  assert.ok(MODEL.team.W > 5 && MODEL.team.W < 60, `W = ${MODEL.team.W}`);
});

test("the fitted update beats the preseason line at every checkpoint", () => {
  for (const [n, v] of Object.entries(MODEL.validation)) assert.ok(v.updated < v.preseason, `${n} games: ${v.updated} vs ${v.preseason}`);
  for (const k of ["fg2a", "tpa", "ast", "drb"]) assert.ok(MODEL.report[k].vsPreseason > 0 && MODEL.report[k].vsSeasonOnly > 0, k);
});

test("banked games count toward the 65-game rule and the ballot", () => {
  const pool = [[[0, 1]]];
  const base = { key: "a", g: 20, va: 300, mpg: 34 };
  // Twenty games left can't reach 65 alone…
  const alone = simulateAwards([base, { key: "b", g: 70, va: 500, mpg: 34 }], { a: 0.57 }, pool, { sims: 200 });
  assert.equal(alone[0].mvp, 0);
  // …but with 60 already played, they do; and the banked VA is in the range.
  const banked = simulateAwards([{ ...base, ytd: { g: 60, va: 1500 }, maxG: 22 }, { key: "b", g: 70, va: 500, mpg: 34 }], { a: 0.57 }, pool, { sims: 200 });
  assert.ok(banked[0].mvp > 0.5);
  assert.ok(banked[0].va20 >= 1500);
  // No `ytd` is the preseason simulation exactly.
  assert.deepEqual(simulateAwards([base], { a: 0.57 }, pool, { sims: 50 }), simulateAwards([{ ...base }], { a: 0.57 }, pool, { sims: 50 }));
});

test("the season in progress, and when its playoffs can start", () => {
  assert.equal(seasonOf(new Date("2026-10-23T12:00:00Z")), "2026-27");
  assert.equal(seasonOf(new Date("2027-03-01T12:00:00Z")), "2026-27");
  assert.equal(seasonOf(new Date("2026-08-01T12:00:00Z")), "2025-26");
  assert.equal(playoffsBegun("2026-27", new Date("2026-10-23T12:00:00Z")), false);
  assert.equal(playoffsBegun("2026-27", new Date("2027-04-20T12:00:00Z")), true);
  assert.equal(playoffsBegun("2025-26", new Date("2026-10-23T12:00:00Z")), true);
});

test("a hot start moves the projected season for real players", () => {
  // Priced the way the route prices it, on the bake's own line.
  const PROJ = read("app", "data", "projection-2026-27.json");
  const p = PROJ.players.find((x) => x.slug === "edwaran01") || PROJ.players[0];
  const lga = lgaForSeason(PROJ.base);
  const scale = (k) => (p.row[k] / p.row.mp) * 36 * 1.3;
  const ytd = { g: 1, mp: 36, ...Object.fromEntries(["pts", "ast", "stl", "blk", "tov", "drb", "orb", "fgm", "fga", "tpm", "tpa", "ftm", "fta"].map((k) => [k, scale(k)])) };
  const u = updatePlayer({ prior: p.row, healthyG: p.row.g, ytd, team: { played: 1 } }, MODEL);
  const va = valueAdd(u.row, lga);
  assert.ok(va > p.va, `${va} vs ${p.va}`);
});

test("the season in progress has a USG-ADJ model, leaning on last season's early", () => {
  const prior = usageModelFor("2025-26");
  const thin = inSeasonUsageModel([
    { mp: 30, pts: 30, fga: 20, fta: 6 },
    { mp: 20, pts: 4, fga: 4, fta: 0 },
  ], prior, USG_FTA_W);
  // Fifty minutes barely move it off last season's pivot.
  assert.ok(Math.abs(thin.muUsg - prior.muUsg) / prior.muUsg < 0.01);
  // And the baked 2026-27 entry turns the switch on for that season.
  assert.ok(usageModelFor("2026-27")?.muUsg > 0);
  const row = { mp: 36, pts: 30, fga: 24, fta: 6, fgm: 11, tpm: 2, tpa: 7, ftm: 6, ast: 4, stl: 1, blk: 0, tov: 3, drb: 5, orb: 1 };
  assert.notEqual(valueAdd(row, lgaForSeason("2026-27", true)), valueAdd(row, lgaForSeason("2026-27")));
});
