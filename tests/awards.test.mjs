// The Awards tab's bake (scripts/bake-awards.mjs → app/data/awards.json and
// app/data/award-odds.json).
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "data");
const AWARDS = JSON.parse(fs.readFileSync(path.join(DATA, "awards.json"), "utf8"));
const ODDS = JSON.parse(fs.readFileSync(path.join(DATA, "award-odds.json"), "utf8")).odds;
const MIP = AWARDS.mip, MVP = AWARDS.mvp;
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

test("each season's MVP odds sum to one over the field, best first, and every winner is in it", () => {
  const at = (k) => MVP.fields.indexOf(k);
  for (const [season, S] of Object.entries(MVP.seasons)) {
    const p = S.rows.map((r) => r[at("mvp")]);
    assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-2, `${season} odds sum to ${p.reduce((a, b) => a + b, 0)}`);
    for (let k = 1; k < p.length; k++) assert.ok(p[k] <= p[k - 1] + 1e-9);
    if (S.winner) assert.equal(S.rows[S.winner.rank - 1][at("slug")], S.winner.slug);
    if (season >= MVP.model.ruleSince) for (const r of S.rows) assert.ok(r[at("g")] >= MVP.model.minGames, `${season} ${r[0]} under the games rule`);
  }
});

test("a card's odds match the boards, and Go → only points at a listed row", () => {
  for (const [season, bySlug] of Object.entries(ODDS)) {
    for (const [slug, [mvpP, mvpRank, mipP, mipRank]] of Object.entries(bySlug)) {
      if (mvpRank != null) {
        const r = MVP.seasons[season].rows[mvpRank - 1];
        assert.equal(r[MVP.fields.indexOf("slug")], slug);
        assert.ok(Math.abs(r[MVP.fields.indexOf("mvp")] * 100 - mvpP) < 1e-6);
      }
      if (mipRank != null) assert.ok(MIP.seasons[season].mip.some(([i, rank]) => rank === mipRank && row(i).slug === slug));
      if (mipP != null && mipRank == null) assert.ok(mipP >= 0.5);
    }
  }
});
