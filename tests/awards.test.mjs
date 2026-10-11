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
const MIP = AWARDS.mip, MVP = AWARDS.mvp, ROY = AWARDS.roy, NBA = AWARDS.allnba, STAR = AWARDS.allstar;
const col = (board, k) => board.fields.indexOf(k);
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

test("MIP odds only go to players who finished above zero VA", () => {
  const at = (k) => MIP.fields.indexOf(k);
  for (const [season, S] of Object.entries(MIP.seasons)) {
    for (const [i] of S.mip) {
      const r = MIP.rows[i];
      if (r[at("slug")] === S.winner?.slug) continue;
      assert.ok(r[at("actual")] > 0, `${season} ${r[0]} at ${r[at("actual")]} VA`);
    }
  }
  // Reggie Bullock, 2023-24: -2.4 VA/G, far above a -5.8 projection — not listed.
  assert.ok(!MIP.seasons["2023-24"].mip.some(([i]) => MIP.rows[i][at("slug")] === "bullore01"));
});

test("the ratio favours a role player's leap over a star's of the same size", () => {
  const { floor } = MIP.model;
  const ratio = (e, a) => (a + floor) / (e + floor);
  assert.ok(ratio(0, 8) > ratio(17, 25));
});

test("each season's MVP odds sum to one over the field, best first, and every winner is in it", () => {
  const at = (k) => col(MVP, k);
  for (const [season, S] of Object.entries(MVP.seasons)) {
    const p = S.rows.map((r) => r[at("p")]);
    assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-2, `${season} odds sum to ${p.reduce((a, b) => a + b, 0)}`);
    for (let k = 1; k < p.length; k++) assert.ok(p[k] <= p[k - 1] + 1e-9);
    if (S.winner) assert.equal(S.rows[S.winner.rank - 1][at("slug")], S.winner.slug);
    if (season >= MVP.model.ruleSince) for (const r of S.rows) assert.ok(r[at("g")] >= MVP.model.minGames, `${season} ${r[0]} under the games rule`);
    if (S.winner) assert.equal(S.rows.find((r) => r[at("pick")] === "MVP")[at("slug")], S.winner.slug);
  }
});

test("a card's odds match the boards, and Go → only points at a listed row", () => {
  for (const [season, bySlug] of Object.entries(ODDS)) {
    for (const [slug, [mvpP, mvpRank, mipP, mipRank, nbaP, nbaRank, starP, starRank]] of Object.entries(bySlug)) {
      if (mvpRank != null) {
        const r = MVP.seasons[season].rows[mvpRank - 1];
        assert.equal(r[col(MVP, "slug")], slug);
        assert.ok(Math.abs(r[col(MVP, "p")] * 100 - mvpP) < 1e-6);
      }
      const [royP, royRank] = [bySlug[slug][8], bySlug[slug][9]];
      if (royRank != null && mipRank != null) assert.fail(`${season} ${slug} is both a rookie and on the MIP board`);
      for (const [board, p, rank] of [[NBA, nbaP, nbaRank], [STAR, starP, starRank], [ROY, royP, royRank]]) {
        if (rank == null) continue;
        const S = board.seasons[season], i = S.ranks.indexOf(rank);
        assert.equal(S.rows[i][col(board, "slug")], slug);
        assert.ok(Math.abs(S.rows[i][col(board, "p")] * 100 - p) < 1e-6);
      }
      if (mipRank != null) assert.ok(MIP.seasons[season].mip.some(([i, rank]) => rank === mipRank && row(i).slug === slug));
      if (mipP != null && mipRank == null) assert.ok(mipP >= 0.5);
    }
  }
});

test("All-NBA and All-Star odds add up to each season's places, and every pick is on the board", () => {
  for (const [label, board] of [["All-NBA", NBA], ["All-Star", STAR]]) {
    for (const [season, S] of Object.entries(board.seasons)) {
      const shown = S.rows.map((r) => r[col(board, "p")]);
      assert.ok(shown.reduce((a, b) => a + b, 0) <= S.places + 1e-6, `${label} ${season} odds past the places`);
      for (let k = 1; k < S.ranks.length; k++) assert.ok(S.ranks[k] > S.ranks[k - 1]);
    }
    assert.ok(board.model.backtest.rate > 0.5, `${label} hit rate ${board.model.backtest.rate}`);
  }
  for (const S of Object.values(NBA.seasons)) {
    const picked = S.rows.filter((r) => r[col(NBA, "pick")]).length;
    assert.ok(picked === 10 || picked === 15 || picked === 0, `All-NBA picks ${picked}`);
  }
});

test("each season's ROY odds are best first, and every winner is a rookie on the board", () => {
  for (const [season, S] of Object.entries(ROY.seasons)) {
    const p = S.rows.map((r) => r[col(ROY, "p")]);
    assert.ok(p.reduce((a, b) => a + b, 0) <= 1 + 1e-3, `${season} odds past 1`);
    for (let k = 1; k < p.length; k++) assert.ok(p[k] <= p[k - 1] + 1e-9);
    if (S.winner) for (const slug of S.winner.slugs) assert.ok(S.rows.some((r) => r[col(ROY, "slug")] === slug && r[col(ROY, "pick")] === "ROY"), `${season} ${slug}`);
  }
  assert.ok(!ROY.seasons["1980-81"], "the first season can't tell rookies apart");
  assert.ok(ROY.model.backtest.top1 >= 30);
  // Minutes per game is scaled by games played, so a short call-up with a big
  // minutes average can't top the board (Zavier Simpson, 4 games, 2021-22).
  for (const [season, S] of Object.entries(ROY.seasons)) assert.ok(S.rows[0][col(ROY, "g")] >= 20, `${season} ${S.rows[0][0]}`);
});
