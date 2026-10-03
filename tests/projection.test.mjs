// The 2026-27 Look Ahead: the model (app/lib/projection-model.js), its bake
// (app/data/projection-2026-27.json), and the route that places it on rosters.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allNbaTeams, leagueContext, poolTeams, projectPlayer, projectRookie, simulateAwards, AWARD_MIN_GAMES,
} from "../app/lib/projection-model.js";
import { lgaForSeason, valueAdd } from "../app/scoring.js";
import { parseShareParams } from "../app/lib/share-params.js";
import { normalizeName } from "../app/lib/format.js";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "data");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const PROJ = read("projection-2026-27.json");

test("the bake is what the model computes from the baked seasons", () => {
  const seasons = ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"];
  const rows = Object.fromEntries(seasons.map((s) => [s, read(`regular-season-${s}.json`).players]));
  const ctx = Object.fromEntries(seasons.map((s) => [s, leagueContext(rows[s].filter((r) => r.g > 0 && r.mp > 0))]));
  for (const slug of ["jokicni01", "gilgesh01", "wembavi01", "tatumja01", "halibty01"]) {
    const baked = PROJ.players.find((p) => p.slug === slug);
    const history = seasons.map((s) => ({ season: s, row: rows[s].find((r) => r.slug === slug), ctx: ctx[s] })).filter((h) => h.row).slice(-5); // the last five appearances
    const missed = history.at(-1).season === "2025-26" ? 0 : 1;
    const proj = projectPlayer(history, baked.exp, PROJ.params, ctx["2025-26"], missed);
    assert.equal(proj.g, baked.row.g, slug);
    assert.ok(Math.abs(proj.row.pts - baked.row.pts) < 0.06, `${slug} pts`);
    assert.ok(Math.abs(valueAdd(proj.row, lgaForSeason("2025-26")) - baked.va) < 0.06, `${slug} va`);
  }
});

test("a lost season reads as an injury, not as who the player is", () => {
  const p = (slug) => PROJ.players.find((x) => x.slug === slug);
  // Tatum: 72-76 games for years, then 16 back from an Achilles tear.
  // Kessler: 74, 64, 58, then 5. Same lost last season, different histories.
  assert.equal(p("tatumja01").lostLast, true);
  assert.equal(p("kesslwa01").lostLast, true);
  assert.ok(p("tatumja01").row.g > p("kesslwa01").row.g + 3, `${p("tatumja01").row.g} vs ${p("kesslwa01").row.g}`);
  // And it's the healthy years' minutes, not the lost year's, that carry over.
  assert.ok(p("tatumja01").mpg > p("kesslwa01").mpg + 5);
});

test("a season missed entirely isn't invisible", () => {
  // Haliburton tore an Achilles in the 2025 Finals and missed all of 2025-26:
  // the data has no row for that year, so the history just ends at 2024-25.
  const hali = PROJ.players.find((x) => x.slug === "halibty01");
  assert.equal(hali.missedLast, true);
  // Projected from 2024-25 as if nothing happened: 69 games at 32.7
  // minutes; full-season returners have come back well short of that.
  assert.ok(hali.row.g < 65, `${hali.row.g} games`);
  assert.ok(hali.va < hali.last.va, `${hali.va} vs ${hali.last.va}`);
  // The rust adjustment was fit, and moves rates down rather than up.
  const r = PROJ.params.gap.rate;
  assert.ok(PROJ.params.gap.n > 50);
  assert.ok(Object.values(r).reduce((a, b) => a + b, 0) / Object.keys(r).length < 1.02);
});

test("a projected line is internally consistent", () => {
  for (const p of PROJ.players.slice(0, 50)) {
    const r = p.row;
    assert.ok(r.g >= 1 && r.g <= 82, p.name);
    assert.ok(Math.abs(r.mp / r.g - p.mpg) < 0.1, `${p.name} minutes`);
    assert.ok(r.tpm <= r.tpa && r.fgm <= r.fga && r.ftm <= r.fta, `${p.name} makes ≤ attempts`);
    // Points come from the shots, never on their own.
    assert.ok(Math.abs(r.pts - (2 * (r.fgm - r.tpm) + 3 * r.tpm + r.ftm)) < 0.5, `${p.name} points`);
  }
});

test("the backtest beats repeating last season", () => {
  const bt = PROJ.backtest;
  assert.ok(bt.corr > bt.corrNaive);
  assert.ok(bt.mae < bt.maeNaive);
});

test("award simulations are seeded, and their odds add up", () => {
  const field = PROJ.players.slice(0, 120).map((p) => ({ key: p.slug, g: p.row.g, va: p.va, mpg: p.mpg }));
  const a = simulateAwards(field, PROJ.mvp.model, PROJ.pool, { sims: 300 });
  const b = simulateAwards(field, PROJ.mvp.model, PROJ.pool, { sims: 300 });
  assert.deepEqual(a, b);
  const mvp = a.reduce((s, r) => s + r.mvp, 0);
  const allNba = a.reduce((s, r) => s + r.allNba, 0);
  assert.ok(Math.abs(mvp - 1) < 1e-9, `MVP odds sum to ${mvp}`);
  assert.ok(Math.abs(allNba - 15) < 1e-9, `All-NBA odds sum to ${allNba}`);
  const teams = allNbaTeams(a);
  assert.deepEqual(teams.map((t) => t.length), [5, 5, 5]);
  assert.equal(new Set(teams.flat().map((r) => r.key)).size, 15);
});

test("a player who can't reach 65 games is never on the ballot", () => {
  const field = [
    { key: "star", g: 30, va: 2000, mpg: 36 },
    ...Array.from({ length: 20 }, (_, i) => ({ key: `p${i}`, g: 82, va: 500 - i, mpg: 34 })),
  ];
  // A pool that never adds games: the projection is the outcome.
  const pool = [[[0, 1]], [[0, 1]], [[0, 1]], [[0, 1]]];
  const star = simulateAwards(field, PROJ.mvp.model, pool, { sims: 200 }).find((r) => r.key === "star");
  assert.ok(30 < AWARD_MIN_GAMES);
  assert.equal(star.mvp, 0);
  assert.equal(star.allNba, 0);
});

test("the route falls back to the baked teams when rosters can't be fetched", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    const { GET } = await import("../app/api/projections/route.js");
    const d = await (await GET()).json();
    assert.equal(d.rosters, "baked");
    assert.equal(d.players.length, PROJ.players.length);
    // Every row comes back pooled, with the projection-alone kept beside it.
    assert.ok(d.players.every((p) => p.solo && p.pool && Number.isFinite(p.va)));
    // A traded player's "2TM" isn't a team to file anyone under.
    assert.ok(d.players.every((p) => p.team === null || !/^(TOT|\dTM)$/.test(p.team)));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a Look Ahead link parses", () => {
  assert.equal(parseShareParams({ season: "2026-27" }).season, "2026-27");
});

test("live rosters move players to their current team, by name", async () => {
  const TEAMS = ["ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GS","HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NO","NY","OKC","ORL","PHI","PHX","POR","SAC","SA","TOR","UTAH","WSH"];
  const jokic = PROJ.players.find((p) => p.slug === "jokicni01");
  const sga = PROJ.players.find((p) => p.slug === "gilgesh01");
  const [first, ...rest] = sga.name.split(" ");
  const rosters = {
    // Jokić "traded" to Boston; SGA listed under a longer given name.
    BOS: [jokic.name.normalize("NFD").replace(/[̀-ͯ]/g, "")],
    OKC: [`${first}aun ${rest.join(" ")}`],
    SA: ["Brand New Rookie"],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const body = u.endsWith("/teams")
      ? { sports: [{ leagues: [{ teams: TEAMS.map((abbreviation, i) => ({ team: { id: String(i + 1), abbreviation } })) }] }] }
      : { athletes: (rosters[TEAMS[Number(u.match(/teams\/(\d+)\/roster/)[1]) - 1]] || ["Filler Player"]).map((fullName) => ({ fullName })) };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const { GET } = await import("../app/api/projections/route.js");
    const d = await (await GET()).json();
    assert.equal(d.rosters, "live");
    const by = Object.fromEntries(d.players.map((p) => [p.slug, p.team]));
    assert.equal(by.jokicni01, "BOS");
    assert.equal(by.gilgesh01, "OKC");
    assert.equal(by.wembavi01, null); // on no roster in this mock
    assert.deepEqual(d.unprojected.SAS, ["Brand New Rookie"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// A league of 30 identical teams, one of them with two extra high-usage
// players (the 76ers question): ten rotation players each, same minutes.
function league({ stackedUsage = 1 } = {}) {
  const line = (u) => ({ g: 70, mp: 70 * 24, fga: 70 * 10 * u, fgm: 70 * 4.7 * u, tpa: 70 * 3.5 * u, tpm: 70 * 1.3 * u, fta: 70 * 2.5 * u, ftm: 70 * 2 * u, tov: 70 * 1.4 * u, ast: 70 * 2.5, drb: 70 * 3.5, orb: 70 * 1, stl: 70, blk: 35, pts: 0 });
  const players = [];
  for (let t = 0; t < 30; t++) {
    for (let k = 0; k < 10; k++) {
      const hot = t === 0 && k < 2;
      players.push({ team: `T${t}`, row: line(hot ? stackedUsage : 1), hot, k });
    }
  }
  return players;
}

test("team context: no teammates, no effect; β = 0 changes nothing", () => {
  const ps = league({ stackedUsage: 2 });
  const zero = poolTeams(ps, { min: 0, usg: 0, ast: 0, drb: 0, orb: 0 });
  ps.forEach((p, i) => assert.equal(zero[i].fga, p.row.fga));
  // A balanced league is at its own median: everyone's multiplier is 1.
  const even = poolTeams(league(), PROJ.params.pool);
  assert.ok(even.every((r) => Math.abs(r.fga - league()[0].row.fga) < 1e-9));
});

test("team context: a roster crowded with usage gives some of it back", () => {
  const ps = league({ stackedUsage: 2 });
  const out = poolTeams(ps, { min: 0, usg: 0.6, ast: 0, drb: 0, orb: 0, usgDelta: 1 });
  const star = out[0], role = out[5], elsewhere = out[15];
  assert.ok(star.fga < ps[0].row.fga, "the stacked stars shoot less");
  assert.ok(role.fga < ps[5].row.fga, "so do their teammates");
  assert.equal(elsewhere.fga, ps[15].row.fga, "other teams untouched");
  // With δ, the heavier user cedes a smaller share than the role player.
  assert.ok(star.fga / ps[0].row.fga > role.fga / ps[5].row.fga);
  // Makes follow attempts; points are rebuilt from them.
  assert.ok(Math.abs(star.fgm / star.fga - ps[0].row.fgm / ps[0].row.fga) < 1e-9);
  assert.ok(Math.abs(star.pts - (2 * (star.fgm - star.tpm) + 3 * star.tpm + star.ftm)) < 1e-9);
});

test("the fitted pooling is real but partial, and usage pools hardest", () => {
  const p = PROJ.params.pool;
  for (const k of ["min", "usg", "ast", "drb", "orb"]) assert.ok(p[k] >= 0 && p[k] < 1, k);
  assert.ok(p.usg >= p.drb && p.usg >= p.orb);
  // On held-out 2025-26 it improved the usage rate for players on new teams.
  const r = PROJ.backtest.rates.usg;
  assert.ok(r.movedPooled < r.movedSolo);
});

const RK = PROJ.params.rookie;
const DRAFT = fs.existsSync(path.join(DATA, "draft-picks.json")) ? read("draft-picks.json").years : {};
const thisDraft = DRAFT[PROJ.draftYear] || [];
const NO_RK = !RK && "no rookie model fit (drafts or college seasons not baked)";

test("rookies: draft night beats calling everyone an average rookie", { skip: NO_RK }, () => {
  const b = RK.backtest;
  assert.ok(b.players >= 100, `${b.players} rookies in the backtest`);
  assert.ok(b.mae < b.maeNaive, `${b.mae} vs ${b.maeNaive}`);
  assert.ok(b.lottery.mae < b.lottery.maeNaive, `lottery ${b.lottery.mae} vs ${b.lottery.maeNaive}`);
  assert.ok(b.corr > 0.3);
  // An earlier pick means more minutes, in both models.
  for (const m of [RK.pickOnly, RK.college].filter(Boolean)) assert.ok(m.mpg.at(-1) < 0, "log pick lowers minutes");
});

test("rookies: a projected line is a consistent NBA line, and the top pick out-projects the last", { skip: NO_RK }, () => {
  const college = PROJ.collegeSeason ? read(`college-${PROJ.collegeSeason}.json`).players.filter((r) => r.mp > 0) : [];
  const cctx = college.length ? leagueContext(college) : null;
  const lineOf = (d) => {
    const c = college.find((r) => r.name === d.name);
    return projectRookie(c && RK.college ? { college: c, cctx, years: 1, pick: d.pick } : { college: null, pick: d.pick }, RK, PROJ.ctx);
  };
  const first = thisDraft.find((d) => d.pick === 1), last = thisDraft.find((d) => d.pick === 60) || thisDraft.at(-1);
  const a = lineOf(first), z = lineOf(last);
  for (const p of [a, z]) {
    const r = p.row;
    assert.ok(r.g >= 1 && r.g <= 82 && p.mpg >= 4 && p.mpg <= 36);
    assert.ok(r.tpm <= r.tpa && r.fgm <= r.fga && r.ftm <= r.fta);
    assert.ok(Math.abs(r.pts - (2 * (r.fgm - r.tpm) + 3 * r.tpm + r.ftm)) < 1e-6);
  }
  assert.ok(a.mpg > z.mpg, `${first.name} ${a.mpg} min vs ${last.name} ${z.mpg}`);
});

test("rookies on live rosters: the pick, college if undrafted, or unprojected", { skip: NO_RK || (!thisDraft.length && "this year's draft not baked") }, async () => {
  // Matched the way the route matches: normalized ("Mikel Brown Jr." is the
  // college file's "Mikel Brown").
  const college = new Set(read(`college-${PROJ.collegeSeason}.json`).players.map((r) => normalizeName(r.name)));
  const withCollege = thisDraft.find((d) => d.pick <= 10 && college.has(normalizeName(d.name)));
  const noCollege = thisDraft.find((d) => !college.has(normalizeName(d.name)));
  const TEAMS = ["ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GS","HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NO","NY","OKC","ORL","PHI","PHX","POR","SAC","SA","TOR","UTAH","WSH"];
  const rosters = { CHI: [withCollege.name, ...(noCollege ? [noCollege.name] : []), "Undrafted Overseas Signee"] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const body = u.endsWith("/teams")
      ? { sports: [{ leagues: [{ teams: TEAMS.map((abbreviation, i) => ({ team: { id: String(i + 1), abbreviation } })) }] }] }
      : { athletes: (rosters[TEAMS[Number(u.match(/teams\/(\d+)\/roster/)[1]) - 1]] || ["Filler Player"]).map((fullName) => ({ fullName })) };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const { GET } = await import("../app/api/projections/route.js");
    const d = await (await GET()).json();
    const a = d.players.find((p) => p.name === withCollege.name);
    // Drafted: projected from the pick, the college line kept for reference.
    assert.ok(a && a.rookie && a.team === "CHI" && a.pick === withCollege.pick && a.model === "pick" && a.last?.college);
    assert.ok(a.pool && a.solo, "rookies take part in the team context");
    if (noCollege) {
      const b = d.players.find((p) => p.name === noCollege.name);
      assert.ok(b && b.rookie && b.pick === noCollege.pick && !b.last, "a drafted rookie with no college season gets the pick-only model");
    }
    assert.deepEqual(d.unprojected.CHI, ["Undrafted Overseas Signee"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
