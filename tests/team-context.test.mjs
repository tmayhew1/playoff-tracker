// A tapped team's card context (app/lib/team-context.js): the conference
// standings through a day and the league ranks in the card's measures.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { ordinal, percentile, projectScore, seasonRanks, seasonTotals, standingsThrough } from "../app/lib/team-context.js";

const game = (date, home, hs, away, as, id = `${date}${home}`) => ({ gameId: id, date, home: { tri: home, score: hs }, away: { tri: away, score: as } });

test("standings: percentage, then games behind, then projected wins only for the same record", () => {
  const games = [
    game("2026-10-20", "POR", 110, "SAC", 100),
    game("2026-10-20", "LAL", 110, "GSW", 100),
    game("2026-10-21", "POR", 110, "GSW", 100),
    game("2026-10-21", "DEN", 90, "PHX", 100),
    game("2026-10-22", "SAC", 100, "LAL", 120),
  ];
  const st = standingsThrough(games, "2026-10-21", { PHX: 60, LAL: 10 });
  // 2-0 POR over 1-0 LAL and PHX (games behind); LAL and PHX share a record,
  // so the projection orders them.
  assert.deepEqual(["POR", "PHX", "LAL"].map((t) => st[t].place), [1, 2, 3]);
  // 0-1 DEN and SAC ahead of 0-2 GSW at the same percentage.
  assert.ok(st.DEN.place < st.GSW.place && st.SAC.place < st.GSW.place);
  // Through the day only: LAL's win on the 22nd isn't counted.
  assert.equal(`${st.LAL.w}-${st.LAL.l}`, "1-0");
  assert.equal(st.POR.conf, "W");
});

test("ranks: DEF PPP ranks the lowest first, the rest the highest", () => {
  const line = (pts, fgm, fga) => ({ pts, fgm, fga, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, tov: 0 });
  const box = (a, b) => ({ away: { tri: "AAA", players: [a] }, home: { tri: "BBB", players: [b] } });
  const r = seasonRanks([box(line(120, 60, 90), line(90, 45, 90))], { la2P: 0.5, la3P: 0.35, laFT: 0.78 });
  assert.equal(r.AAA["2P"], 1);
  assert.equal(r.AAA.def, 1);
  assert.equal(r.BBB.def, 2);
  assert.equal(r.AAA.poss, 1);
  assert.equal(r.BBB.poss, 1); // the same possessions: a shared rank
});

test("seasonTotals: each side's lines and its opponents', over its games", () => {
  const line = (pts) => ({ pts, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, tov: 0 });
  const box = (a, ap, b, bp) => ({ away: { tri: a, players: [line(ap)] }, home: { tri: b, players: [line(bp)] } });
  const t = seasonTotals([box("AAA", 100, "BBB", 90), box("CCC", 80, "AAA", 110)]);
  assert.equal(t.AAA.gp, 2);
  assert.equal(t.AAA.own.pts, 210);
  assert.equal(t.AAA.opp.pts, 170);
  assert.equal(t.BBB.gp, 1);
});

test("projectScore: the better side and home court move the score, a few games only so far", () => {
  // AAA scores 1.2 a possession and allows 1.0, BBB the reverse; 100 a game each way.
  const team = (pts, allowed, gp) => ({
    own: { pts: pts * gp, fgm: 0, fga: 100 * gp, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, tov: 0 },
    opp: { pts: allowed * gp, fgm: 0, fga: 100 * gp, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, tov: 0 },
    gp,
  });
  const totals = { AAA: team(120, 100, 10), BBB: team(100, 120, 10) };
  const p = projectScore(totals, "AAA", "BBB");
  assert.ok(p.away > p.home, "the better team is projected ahead on the road");
  assert.ok(Math.abs(p.poss - 100) < 1e-9);
  // Half its own figures, half the league's 1.1 at 10 games: AAA's offense
  // and BBB's defense both 1.15, so 1.15 × 1.15 ÷ 1.1 a possession.
  assert.ok(Math.abs(p.away - (100 * 1.15 * 1.15 / 1.1 - 1.2)) < 1e-9);
  // Even teams split only on home court.
  const even = projectScore({ AAA: team(110, 110, 4), BBB: team(110, 110, 4) }, "AAA", "BBB");
  assert.ok(Math.abs(even.home - even.away - 2.4) < 1e-9);
  // The prior's wins lean a team that hasn't played.
  const fresh = projectScore(totals, "CCC", "DDD", null, { CCC: 60, DDD: 22 });
  assert.ok(fresh.away > fresh.home);
  assert.equal(projectScore({}, "AAA", "BBB", null), null);
});

test("ordinal", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"]);
});

test("percentile: ties count half, nothing to place in is null", () => {
  assert.equal(percentile([1, 2, 3, 4], 3), 0.625);
  assert.equal(percentile([1, 2, 3, 4], 0), 0);
  assert.equal(percentile([], 3), null);
});
