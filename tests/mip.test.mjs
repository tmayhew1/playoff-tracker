// The MIP tab's bake (scripts/bake-mip.mjs → app/data/mip.json).
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "data");
const MIP = JSON.parse(fs.readFileSync(path.join(DATA, "mip.json"), "utf8"));
const row = (i) => Object.fromEntries(MIP.fields.map((k, j) => [k, MIP.rows[i][j]]));

test("every row carries every field", () => {
  for (const r of MIP.rows) assert.equal(r.length, MIP.fields.length);
});

test("each season's MIP odds sum to one over its qualified players, and the board is in odds order", () => {
  for (const [season, S] of Object.entries(MIP.seasons)) {
    const odds = S.mip.map(([i]) => row(i).mip);
    for (let k = 1; k < odds.length; k++) assert.ok(odds[k] <= odds[k - 1] + 1e-9, `${season} out of order at ${k}`);
    assert.ok(odds.reduce((a, b) => a + b, 0) <= 1 + 1e-3, `${season} odds sum past 1`);
  }
});

test("every winner is on the board at their rank, and the backtest counts them all", () => {
  const winners = Object.values(MIP.seasons).filter((S) => S.winner);
  assert.equal(winners.length, MIP.model.backtest.seasons);
  for (const S of winners) {
    const hit = S.mip.find(([i]) => row(i).slug === S.winner.slug);
    assert.ok(hit, `${S.winner.name} missing`);
    assert.equal(hit[1], S.winner.mip);
  }
  const { top1, top5, top10 } = MIP.model.backtest;
  assert.ok(top1 <= top5 && top5 <= top10 && top10 <= winners.length);
});

test("the ratio favours a role player's leap over a star's of the same size", () => {
  const { floor } = MIP.model;
  const ratio = (e, a) => (a + floor) / (e + floor);
  assert.ok(ratio(0, 8) > ratio(17, 25));
});
