// The draft assistant's model (app/lib/draft-model.js) and its inputs.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bracketOdds, bracketSlots, completeDraft, recommend, seriesPoints, seriesWinProb, simulate,
} from "../app/lib/draft-model.js";
import { GET as draftGET } from "../app/api/draft/route.js";

const MODEL = JSON.parse(fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "data", "draft-model.json"), "utf8"));
const load = async (season) => (await draftGET(new Request(`http://x/api/draft?season=${season}`))).json();
const ownersOf = (teams) => Object.fromEntries(Object.entries(teams).map(([t, x]) => [t, x.owner]));

test("the bracket pairs seeds the NBA way", async () => {
  const { teams } = await load("2024-25");
  const slots = bracketSlots(teams);
  // West 2024-25: OKC(1) v MEM(8), DEN(4) v LAC(5) -> OKC's side meets DEN's.
  const i = slots.indexOf("OKC");
  assert.equal(slots[i + 1], "MEM");
  assert.deepEqual(slots.slice(i + 2, i + 4).sort(), ["DEN", "LAC"]);
  assert.equal(slots.length, 16);
});

test("series odds are complementary, and home court counts", () => {
  const a = { strength: 10, seed: 2 }, b = { strength: 8, seed: 3 };
  assert.ok(Math.abs(seriesWinProb(MODEL, a, b) + seriesWinProb(MODEL, b, a) - 1) < 1e-12);
  const even = { strength: 10, seed: 4 }, evenLow = { strength: 10, seed: 5 };
  assert.ok(seriesWinProb(MODEL, even, evenLow) > 0.5);
  assert.equal(seriesPoints("r2", { seed: 6 }, { seed: 3 }), 2 + 3);
  assert.equal(seriesPoints("r4", { seed: 1 }, { seed: 3 }), 8);
});

test("bracket odds add up round by round", async () => {
  for (const season of ["2023-24", "2024-25", "2025-26"]) {
    const { teams, model } = await load(season);
    const odds = bracketOdds(model, teams);
    ["r1", "r2", "r3", "r4"].forEach((rk, r) => {
      const total = Object.values(odds).reduce((a, o) => a + o.win[rk], 0);
      assert.ok(Math.abs(total - 8 / 2 ** r) < 1e-9, `${season} ${rk}: ${total}`);
    });
  }
});

// The simulation must agree with the exact calculation: a flipped
// probability anywhere (the bug this guards) shows up as a gap.
test("simulated points match exact expected points", async () => {
  for (const season of ["2023-24", "2024-25", "2025-26"]) {
    const { teams, model } = await load(season);
    const odds = bracketOdds(model, teams);
    const owners = ownersOf(teams);
    const sim = simulate(model, teams, owners, { sims: 60000 });
    for (const o of ["Spencer", "Trey"]) {
      const exact = Object.keys(teams).filter((t) => owners[t] === o).reduce((a, t) => a + odds[t].ep, 0);
      assert.ok(Math.abs(sim.mean[o] - exact) < 0.25, `${season} ${o}: sim ${sim.mean[o]} exact ${exact}`);
    }
    assert.ok(Math.abs(sim.winProb.Spencer + sim.winProb.Trey + sim.tieProb - 1) < 1e-9);
  }
});

test("advice covers every open team and finishes the draft", async () => {
  const { teams, model } = await load("2025-26");
  const recs = recommend(model, teams, {}, "Trey", "Spencer", { sims: 500 });
  assert.equal(recs.length, 16);
  for (const r of recs) assert.ok(r.winProb >= 0 && r.winProb <= 1);
  const done = completeDraft(bracketOdds(model, teams), { OKC: "Trey" }, "Spencer", "Trey");
  const count = (o) => Object.values(done).filter((v) => v === o).length;
  assert.equal(count("Trey"), 8);
  assert.equal(count("Spencer"), 8);
});

test("the fitted model beats home court alone on held-out seasons", () => {
  const { model, homeCourtOnly, coinFlip } = MODEL.fit.heldOut;
  assert.ok(model.logLoss < homeCourtOnly.logLoss, `${model.logLoss} vs ${homeCourtOnly.logLoss}`);
  assert.ok(homeCourtOnly.logLoss < coinFlip.logLoss);
  assert.ok(MODEL.fit.series > 600);
});
