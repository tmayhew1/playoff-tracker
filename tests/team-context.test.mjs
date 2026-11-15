// A tapped team's card context (app/lib/team-context.js): the conference
// standings through a day and the league ranks in the card's measures.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedMinutes, lineupFactor, ordinal, percentile, projectScore, seasonRanks, seasonTotals, standingsThrough } from "../app/lib/team-context.js";
import { availability, parseEspnInjuryReport } from "../app/lib/injuries.js";

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

// A ten-game team: a star who shoots a lot and well, four starters, three off
// the bench and one who has barely played.
const LGA = { la2P: 0.54, la3P: 0.36, laFT: 0.78 };
const man = (name, mpg, fga, pct, g = 10) => ({
  name, team: "AAA", g, gs: 0, last: "2026-11-10", mp: mpg * g, pts: 0, orb: 0.02 * mpg * g, tov: 0.05 * mpg * g,
  fga: fga * g, fgm: fga * g * pct, tpa: 0.4 * fga * g, tpm: 0.4 * fga * g * (pct - 0.14), fta: 0.3 * fga * g, ftm: 0.24 * fga * g,
});
const ROSTER = [
  man("Star One", 36, 22, 0.56), man("Two Guard", 34, 14, 0.48), man("Big Man", 30, 10, 0.5), man("Wing Four", 28, 9, 0.46), man("Point Five", 26, 8, 0.45),
  man("Sixth Man", 24, 9, 0.44), man("Bench Seven", 20, 6, 0.43), man("Bench Eight", 18, 5, 0.42), man("Deep Nine", 4, 1, 0.4, 3),
];

test("expectedMinutes: 240 between the players in, a fringe player's by how often he plays, nobody past 40", () => {
  const all = expectedMinutes(ROSTER, 10);
  assert.ok(Math.abs(all.reduce((s, x) => s + x.min, 0) - 240) < 1e-9);
  const min = (list, name) => list.find((x) => x.p.name === name).min;
  assert.ok(min(all, "Deep Nine") < 2, "three games in ten at four minutes is about one");
  const short = expectedMinutes(ROSTER.filter((p) => p.name !== "Star One"), 10);
  assert.ok(Math.abs(short.reduce((s, x) => s + x.min, 0) - 240) < 1e-9);
  assert.ok(min(short, "Two Guard") > min(all, "Two Guard") && min(short, "Two Guard") <= 40 + 1e-9);
});

test("lineupFactor: the season's lineup is even, losing the star costs offense and moves the shots", () => {
  const full = lineupFactor(ROSTER, new Set(), LGA, 10);
  assert.ok(Math.abs(full.factor - 1) < 0.01);
  const short = lineupFactor(ROSTER, new Set(["star one"]), LGA, 10);
  assert.ok(short.factor < 0.99 && short.factor > 0.9, `a few percent, not a collapse: ${short.factor}`);
  assert.equal(short.minutes["Star One"], undefined);
  // Losing the worst shooter on the bench doesn't.
  assert.ok(lineupFactor(ROSTER, new Set(["Bench Eight"]), LGA, 10).factor > short.factor);
  assert.equal(lineupFactor([], new Set(), LGA), null);
});

test("projectScore with lineups: a side without its star scores less, and its shots add up to its score", () => {
  const sums = (list) => {
    const t = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, tov: 0 };
    for (const p of list) for (const k of Object.keys(t)) t[k] += p[k] || 0;
    t.pts = 2 * (t.fgm - t.tpm) + 3 * t.tpm + t.ftm;
    return t;
  };
  const own = sums(ROSTER);
  const totals = { AAA: { own, opp: own, gp: 10 }, BBB: { own, opp: own, gp: 10 } };
  const home = ROSTER.map((p) => ({ ...p, team: "BBB" }));
  const lineups = (out) => ({ AAA: { players: ROSTER, out }, BBB: { players: home, out: new Set() } });
  const full = projectScore(totals, "AAA", "BBB", LGA, null, lineups(new Set()));
  const short = projectScore(totals, "AAA", "BBB", LGA, null, lineups(new Set(["Star One"])));
  assert.ok(short.away < full.away - 1, "the visitors lose points");
  assert.ok(Math.abs(short.home - full.home) < 1e-9, "the home side's own offense is untouched");
  for (const side of ["away", "home"]) {
    const s = short.shots[side];
    assert.ok(Math.abs(2 * (s.fgm - s.tpm) + 3 * s.tpm + s.ftm - short[side]) < 1e-6);
    assert.ok(Math.abs(s.fga - s.orb + s.tov + 0.475 * s.fta - short.poss) < 1e-6, "over the game's possessions");
  }
  // Without the star's attempts the rest take more each, over the same possessions.
  assert.ok(short.minutes.away["Two Guard"] > full.minutes.away["Two Guard"]);
  // No lineups, no shots: the projection as it was.
  assert.equal(projectScore(totals, "AAA", "BBB", LGA).shots, undefined);
});

test("injury report: who is out, who is only listed, and whose listing is stale", () => {
  const feed = { injuries: [{ displayName: "Team A", injuries: [
    { athlete: { displayName: "Star One", team: { abbreviation: "AAA" } }, status: "Out", date: "2026-11-14T18:00Z", details: { type: "Ankle", side: "Left" }, shortComment: "Out Sunday." },
    { athlete: { displayName: "Two Guard", team: { abbreviation: "AAA" } }, status: "Day-To-Day", date: "2026-11-14T18:00Z", details: { type: "Knee" } },
    { athlete: { displayName: "Big Man", team: { abbreviation: "AAA" } }, status: "Out", date: "2026-11-01T18:00Z", details: { type: "Back" } },
    { athlete: { displayName: "New Signing", team: { abbreviation: "AAA" } }, status: "Out", date: "2026-10-01T18:00Z", details: { type: "Achilles", fantasyStatus: { abbreviation: "OFS" } } },
    { athlete: { displayName: "Other Guy", team: { abbreviation: "BBB" } }, status: "Out", date: "2026-11-14T18:00Z" },
  ] }] };
  const report = parseEspnInjuryReport(feed);
  assert.equal(report.length, 5);
  assert.deepEqual(report[0], { name: "Star One", team: "AAA", teamName: "Team A", out: true, status: "Out", injury: "Ankle (left)", note: "Out Sunday.", date: "2026-11-14" });
  const a = availability(ROSTER, report, "AAA");
  assert.deepEqual([...a.out.keys()], ["star one"]);
  assert.deepEqual([...a.listed.keys()], ["two guard"]);
  // Big Man has played (the 10th) since his listing (the 1st): not out.
  assert.deepEqual(a.unplayed.map((e) => e.name), ["New Signing"]);
  // No tricode on the feed: placed by name.
  const bare = availability(ROSTER, report.map((e) => ({ ...e, team: null })), "AAA");
  assert.deepEqual([...bare.out.keys()], ["star one"]);
  assert.equal(bare.unplayed.length, 0);
  assert.equal(availability(ROSTER, null, "AAA").out.size, 0);
});

test("ordinal", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"]);
});

test("percentile: ties count half, nothing to place in is null", () => {
  assert.equal(percentile([1, 2, 3, 4], 3), 0.625);
  assert.equal(percentile([1, 2, 3, 4], 0), 0);
  assert.equal(percentile([], 3), null);
});
