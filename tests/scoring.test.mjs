// Unit tests for the Value Added math (app/scoring.js) against the baked data.
//
//   npm test
//
// Two kinds of check. Invariants hold for every player-season and should never
// need editing. Pinned values lock specific numbers so a formula change can't
// slip through unnoticed — when a change is intended, update the pin in the
// same commit and say why.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  valueAdd, valueAddParts, valueAddByCategory, VA_CATEGORY_KEYS,
  lgaForSeason, baselineCoverage,
} from "../app/scoring.js";
import { defVAInfo, leagueDRtgLine } from "../app/lib/defense-math.js";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "data");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const seasonsOf = (re) => fs.readdirSync(DATA).map((f) => f.match(re)?.[1]).filter(Boolean).sort();
const LB_SEASONS = seasonsOf(/^leaderboard-(\d{4}-\d{2})\.json$/);
const RS_SEASONS = seasonsOf(/^regular-season-(\d{4}-\d{2})\.json$/);
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test("every baked season has a baseline for all ten categories", () => {
  assert.ok(RS_SEASONS.length >= 40, `only ${RS_SEASONS.length} regular-season files`);
  for (const s of RS_SEASONS) {
    const c = baselineCoverage(lgaForSeason(s));
    assert.ok(c.complete, `${s} is missing ${c.missing.join(", ")}`);
  }
});

test("the ten categories sum to the season's VA", () => {
  for (const s of RS_SEASONS) {
    const lga = lgaForSeason(s);
    for (const p of read(`regular-season-${s}.json`).players) {
      const cats = valueAddByCategory(p, lga);
      assert.deepEqual(Object.keys(cats).sort(), [...VA_CATEGORY_KEYS].sort());
      const sum = Object.values(cats).reduce((a, b) => a + b, 0);
      assert.ok(close(sum, valueAdd(p, lga)), `${s} ${p.name}: ${sum} vs ${valueAdd(p, lga)}`);
    }
  }
});

// The same check as `npm run rebake:va -- --check`: the playoff VA written into
// each leaderboard by the R bake must be what scoring.js computes today. A
// failure means the JS math and the baked data have drifted apart.
test("baked playoff VA matches scoring.js", () => {
  for (const s of LB_SEASONS) {
    const lga = lgaForSeason(s, false, "po");
    for (const p of read(`leaderboard-${s}.json`).players) {
      if (p.va == null) continue;
      const va = valueAddParts(p, lga).va;
      assert.ok(close(p.va, va, 1e-6), `${s} ${p.name}: baked ${p.va}, computed ${va}`);
    }
  }
});

test("pinned: LeBron James 2015-16 playoffs", () => {
  const p = read("leaderboard-2015-16.json").players.find((r) => r.slug === "jamesle01");
  const lga = lgaForSeason("2015-16", false, "po");
  assert.ok(close(valueAdd(p, lga), 439.75, 0.01), String(valueAdd(p, lga)));
  const cats = valueAddByCategory(p, lga);
  assert.ok(close(cats.Points, 230.86, 0.01), String(cats.Points));
  assert.ok(close(cats.Assists, 127.59, 0.01), String(cats.Assists));
});

test("pinned: Stephen Curry 2015-16 regular season", () => {
  const p = read("regular-season-2015-16.json").players.find((r) => r.slug === "curryst01");
  const va = valueAdd(p, lgaForSeason("2015-16"));
  assert.ok(close(va, 2068.17, 0.01), String(va));
});

test("a player who never plays adds nothing", () => {
  const va = valueAdd({ mp: 0, pts: 0, ast: 0, stl: 0, blk: 0, tov: 0, drb: 0, orb: 0,
    fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 }, lgaForSeason("2015-16"));
  assert.ok(close(va, 0), String(va));
});

test("defVAInfo stays out of the way without ratings", () => {
  const p = read("regular-season-2015-16.json").players[0];
  assert.equal(defVAInfo(p, p.mp, lgaForSeason("2015-16"), null, "2015-16"), null);
  assert.equal(defVAInfo(p, p.mp, lgaForSeason("2015-16"), {}, "2015-16"), null);
});

test("a season in progress regresses its D Rating by the games played so far", () => {
  const lga = lgaForSeason("2015-16");
  const p = read("regular-season-2015-16.json").players.find((r) => r.g >= 70);
  const season = { rs: { [p.slug]: 95 } };
  const done = { "2015-16": season };
  const live = { "2015-16": { ...season, inProgress: true } };
  const net = (defs, g) => defVAInfo({ ...p, g }, p.mp, lga, defs, "2015-16").dva;
  // Two games in, about an eighth of the edge counts; the full schedule, all of it.
  const early = net(live, 2) / net(done, 2);
  assert.ok(early > 0.1 && early < 0.15, String(early));
  assert.ok(close(net(live, 82), net(done, 82)));
  // A finished season is untouched whatever the games, and the weight grows with them.
  assert.ok(close(net(done, 2), net(done, 60)));
  assert.ok(net(live, 2) < net(live, 20) && net(live, 20) < net(live, 60));
});

test("the D Rating league line is the average team, so an average team's edge is zero", () => {
  const lga = lgaForSeason("2015-16");
  const team = { AAA: { drtg: 104, stlpm: 0.03, blkpm: 0.02, g: 82 }, BBB: { drtg: 106, stlpm: 0.03, blkpm: 0.02, g: 82 } };
  for (let i = 0; i < 8; i++) team[`T${i}`] = { drtg: 105, stlpm: 0.03, blkpm: 0.02, g: 82 };
  // Line from the team map, not the per-possession figure (a different possession count).
  assert.ok(close(leagueDRtgLine(team, lga), 105));
  assert.ok(close(leagueDRtgLine({ AAA: team.AAA }, lga), lga.laPTSperPoss * 100));
  // A player rated exactly at his average team's line nets nothing.
  const p = { slug: "x", team: "T0", g: 82, mp: 2000, stl: 60, blk: 40 };
  const defs = { "2015-16": { rs: { x: 105 }, team } };
  const info = defVAInfo(p, p.mp, lga, defs, "2015-16");
  assert.ok(close(info.laDRtg, 105) && close(info.dva, 0), JSON.stringify(info));
});

test("in progress, the team's edge over the league is charged once, not again inside IND", () => {
  const lga = lgaForSeason("2015-16");
  const team = { BAD: { drtg: 110, stlpm: 0.03, blkpm: 0.02, g: 16 } };
  for (let i = 0; i < 9; i++) team[`T${i}`] = { drtg: 105, stlpm: 0.03, blkpm: 0.02, g: 16 };
  // On a bad defence, a player exactly as good as his team: IND is zero, so
  // all of his dVA is his share of the team's deficit — not more.
  const p = { slug: "x", team: "BAD", g: 16, mp: 500, stl: 15, blk: 10 };
  const defs = { "2015-16": { rs: { x: 110 }, rsOn: { x: 110 }, teamOn: { BAD: 110 }, team, inProgress: true } };
  const i = defVAInfo(p, p.mp, lga, defs, "2015-16");
  assert.ok(close(i.teamDrtg - i.drtg, 0), JSON.stringify(i));
  assert.ok(close(i.dva, (i.w * (i.laDRtg - i.teamDrtg) / 100) * lga.laPOSSperM * p.mp));
});
