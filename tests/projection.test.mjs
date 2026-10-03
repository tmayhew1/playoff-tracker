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
  allNbaTeams, leagueContext, projectPlayer, simulateAwards, AWARD_MIN_GAMES,
} from "../app/lib/projection-model.js";
import { lgaForSeason, valueAdd } from "../app/scoring.js";
import { parseShareParams } from "../app/lib/share-params.js";

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
