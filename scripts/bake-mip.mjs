#!/usr/bin/env node
// Bake the MIP tab (app/components/mip-view.js): every regular season since
// 1981-82, each returning player's actual VA beside what the Look Ahead model
// (app/lib/projection-model.js) would have projected for them the summer
// before, and a Most Improved Player model fit on every winner since 1985-86.
//
//   npm run bake:mip            (after npm run fit:projections)
//
// The projection is the shipped one: the baked constants in
// projection-<next>.json, each player projected from the seasons before the
// target, placed on the roster they actually played for and team-pooled, and
// priced against the previous season's league, the way the Look Ahead
// backtest prices it. Those constants were fit on these same seasons, so this
// is a little kinder to the model than a true out-of-sample run.
//
// The MIP model is a conditional logit — one winner per season — on a single
// number, the per-game ratio
//
//     (actual VA/G + c) / (expected VA/G + c)
//
// over players who played at least half as many games as the season's leader.
// VA is measured against an average player, so expected VA is zero or
// negative for most role players and a bare ratio is meaningless; the floor c
// fixes that, and is chosen by leave-one-season-out from FLOOR_GRID. Tested
// the same way, the ratio beat the total and per-game deltas, a fitted blend
// of the two, and either delta with the player's expected level beside it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lgaForSeason, valueAdd } from "../app/scoring.js";
import { TIME_HISTORY, leagueContext, nextSeason, poolTeams, projectPlayer } from "../app/lib/projection-model.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

const SEASONS = fs.readdirSync(DATA).map((f) => f.match(/^regular-season-(\d{4}-\d{2})\.json$/)?.[1]).filter(Boolean).sort();
const PROJ = read(`projection-${nextSeason(SEASONS.at(-1))}.json`);
const OUT = path.join(DATA, "mip.json");

// Most Improved Player, by basketball-reference id (nba.com/news/history-most-improved-player-award-winners).
const WINNERS = {
  "1985-86": "roberal01", "1986-87": "ellisda01", "1987-88": "duckwke01", "1988-89": "johnske02",
  "1989-90": "seikaro01", "1990-91": "skilesc01", "1991-92": "ellispe01", "1992-93": "abdulma02",
  "1993-94": "macledo01", "1994-95": "barroda01", "1995-96": "muresgh01", "1996-97": "austiis01",
  "1997-98": "hendeal01", "1998-99": "armstda01", "1999-00": "roseja01", "2000-01": "mcgratr01",
  "2001-02": "onealje01", "2002-03": "arenagi01", "2003-04": "randoza01", "2004-05": "simmobo01",
  "2005-06": "diawbo01", "2006-07": "ellismo01", "2007-08": "turkohe01", "2008-09": "grangda01",
  "2009-10": "brookaa01", "2010-11": "loveke01", "2011-12": "anderry01", "2012-13": "georgpa01",
  "2013-14": "dragigo01", "2014-15": "butleji01", "2015-16": "mccolcj01", "2016-17": "antetgi01",
  "2017-18": "oladivi01", "2018-19": "siakapa01", "2019-20": "ingrabr01", "2020-21": "randlju01",
  "2021-22": "moranja01", "2022-23": "markkla01", "2023-24": "maxeyty01", "2024-25": "daniedy01",
  "2025-26": "alexani01",
};
const FLOOR_GRID = [2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50];
const RIDGE = 0.01;
const TOP = 25;     // rows kept per season and sort
const ALL_TIME = 50;

// --- Load ----------------------------------------------------------------------
const rowsBy = {}, ctxBy = {};
for (const s of SEASONS) {
  rowsBy[s] = read(`regular-season-${s}.json`).players.filter((r) => r.g > 0 && r.mp > 0);
  ctxBy[s] = leagueContext(rowsBy[s]);
}
const careers = new Map(); // slug -> [{ season, row, ctx }], oldest first
for (const s of SEASONS) for (const row of rowsBy[s]) {
  if (!row.slug) continue;
  if (!careers.has(row.slug)) careers.set(row.slug, []);
  careers.get(row.slug).push({ season: s, row, ctx: ctxBy[s] });
}
const missedBefore = (car, i) => SEASONS.indexOf(car[i].season) - SEASONS.indexOf(car[i - 1].season) - 1;
const MULTI_TEAM = /^(TOT|\dTM)$/;

// The Look Ahead's per-game line: MIN PTS REB AST STL BLK TOV FG% 3P% FT%.
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const line = (r) => {
  const g = r.g || 1;
  return [r.mp / g, r.pts / g, (r.drb + r.orb) / g, r.ast / g, r.stl / g, r.blk / g, r.tov / g,
    r.fga > 0 ? (100 * r.fgm) / r.fga : NaN, r.tpa > 0 ? (100 * r.tpm) / r.tpa : NaN, r.fta > 0 ? (100 * r.ftm) / r.fta : NaN].map(r1);
};

// --- Every season, projected the summer before ---------------------------------
const bySeason = {};
for (const season of SEASONS.slice(1)) {
  const prev = SEASONS[SEASONS.indexOf(season) - 1];
  const rows = [];
  for (const [slug, car] of careers) {
    const i = car.findIndex((c) => c.season === season);
    if (i < 1) continue;
    const proj = projectPlayer(car.slice(Math.max(0, i - TIME_HISTORY), i), i, PROJ.params, ctxBy[prev], missedBefore(car, i));
    rows.push({ slug, car, i, proj, team: MULTI_TEAM.test(car[i].row.team) ? null : car[i].row.team });
  }
  const pooled = poolTeams(rows.map((r) => ({ team: r.team, row: r.proj.row })), PROJ.params.pool);
  const lgaS = lgaForSeason(season), lgaP = lgaForSeason(prev);
  const out = rows.map((r, k) => {
    const a = r.car[r.i].row, q = pooled[k], last = r.car[r.i - 1];
    const actual = valueAdd(a, lgaS), proj = valueAdd(q, lgaP);
    return {
      season, slug: r.slug, name: a.name, team: a.team, exp: r.i + 1,
      g: a.g, projG: q.g, actual, proj,
      e: q.g ? proj / q.g : 0, a: actual / a.g,
      last: { season: last.season, team: last.row.team, g: last.row.g, va: valueAdd(last.row, lgaForSeason(last.season)), line: line(last.row) },
      eLine: line(q), aLine: line(a),
    };
  });
  const maxG = Math.max(...out.map((r) => r.g));
  for (const r of out) r.qualified = r.g >= maxG / 2;
  bySeason[season] = out;
}

// --- The MIP model ---------------------------------------------------------------
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const logRatio = (c) => (r) => Math.log(Math.max(0.05, r.a + c) / Math.max(0.05, r.e + c));
const fields = Object.entries(WINNERS).map(([season, slug]) => {
  const pool = bySeason[season].filter((r) => r.qualified || r.slug === slug);
  const win = pool.findIndex((r) => r.slug === slug);
  if (win < 0) throw new Error(`MIP ${season} (${slug}) is not in the data`);
  return { season, pool, win };
});

// One coefficient on one feature: Newton's method with a small ridge and a
// step-halving line search.
function fitBeta(F, x) {
  const X = F.map((f) => f.pool.map(x));
  const ll = (b) => sum(F.map((f, n) => {
    const u = X[n].map((v) => v * b), m = Math.max(...u);
    return u[f.win] - m - Math.log(sum(u.map((v) => Math.exp(v - m))));
  })) - RIDGE * b * b;
  let b = 0, cur = ll(b);
  for (let it = 0; it < 100; it++) {
    let g = -2 * RIDGE * b, h = -2 * RIDGE;
    F.forEach((f, n) => {
      const u = X[n].map((v) => v * b), m = Math.max(...u), w = u.map((v) => Math.exp(v - m)), z = sum(w);
      const mu = sum(X[n].map((v, i) => (w[i] / z) * v));
      g += X[n][f.win] - mu;
      h -= sum(X[n].map((v, i) => (w[i] / z) * (v - mu) ** 2));
    });
    const step = g / h;
    let t = 1, nb, nl;
    do { nb = b - t * step; nl = ll(nb); t /= 2; } while (nl < cur && t > 1e-6);
    const done = Math.abs(nl - cur) < 1e-12;
    b = nb; cur = nl;
    if (done) break;
  }
  return b;
}

// Leave one season out: the rank and probability the model gives the winner.
function loso(x) {
  const ranks = [];
  let ll = 0;
  for (const f of fields) {
    const b = fitBeta(fields.filter((o) => o !== f), x);
    const u = f.pool.map((r) => b * x(r)), m = Math.max(...u);
    ll += u[f.win] - m - Math.log(sum(u.map((v) => Math.exp(v - m))));
    ranks.push(1 + u.filter((v) => v > u[f.win]).length);
  }
  return { ranks, meanP: Math.exp(ll / fields.length) };
}

let best = null;
for (const c of FLOOR_GRID) {
  const res = loso(logRatio(c));
  if (!best || res.meanP > best.res.meanP) best = { c, res };
}
const FLOOR = best.c, ratioOf = logRatio(FLOOR);
const BETA = fitBeta(fields, ratioOf);
const ranks = [...best.res.ranks].sort((a, b) => a - b);
const backtest = {
  seasons: ranks.length,
  top1: ranks.filter((r) => r === 1).length,
  top5: ranks.filter((r) => r <= 5).length,
  top10: ranks.filter((r) => r <= 10).length,
  medianRank: ranks[ranks.length >> 1],
};

// --- Rank every season -----------------------------------------------------------
for (const rows of Object.values(bySeason)) {
  for (const r of rows) { r.lr = ratioOf(r); r.over = r.actual - r.proj; r.overPg = r.a - r.e; }
  const Q = rows.filter((r) => r.qualified), m = Math.max(...Q.map((r) => BETA * r.lr));
  const z = sum(Q.map((r) => Math.exp(BETA * r.lr - m)));
  for (const r of rows) r.mip = r.qualified ? Math.exp(BETA * r.lr - m) / z : null;
}

// Rows are arrays, keyed by FIELDS, so the payload stays small.
const FIELDS = ["name", "team", "season", "slug", "exp", "g", "projG", "actual", "proj", "actualPg", "projPg",
  "ratio", "mip", "eLine", "aLine", "lastSeason", "lastTeam", "lastG", "lastVa", "lastLine"];
const rnd = (x, d) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const rows = [], idx = new Map();
const ref = (r) => {
  const k = `${r.slug}|${r.season}`;
  if (!idx.has(k)) {
    idx.set(k, rows.length);
    rows.push([r.name, r.team, r.season, r.slug, r.exp, r.g, Math.round(r.projG), Math.round(r.actual), Math.round(r.proj),
      rnd(r.a, 2), rnd(r.e, 2), rnd(Math.exp(r.lr), 3), rnd(r.mip, 4), r.eLine, r.aLine,
      r.last.season, r.last.team, r.last.g, Math.round(r.last.va), r.last.line]);
  }
  return idx.get(k);
};
const SORTS = {
  mip: { pool: (r) => r.qualified, key: (r) => r.lr },
  pg: { pool: (r) => r.qualified, key: (r) => r.overPg },
  tot: { pool: () => true, key: (r) => r.over },
};
const ranked = (rs, sort) => rs.filter(SORTS[sort].pool).sort((a, b) => SORTS[sort].key(b) - SORTS[sort].key(a) || b.over - a.over);

const seasons = {};
for (const [season, rs] of Object.entries(bySeason)) {
  const S = { players: rs.length, qualified: rs.filter((r) => r.qualified).length, winner: null };
  const lists = Object.fromEntries(Object.keys(SORTS).map((k) => [k, ranked(rs, k)]));
  for (const [k, L] of Object.entries(lists)) S[k] = L.slice(0, TOP).map((r, i) => [ref(r), i + 1]);
  const w = WINNERS[season];
  if (w) {
    S.winner = { slug: w, name: rs.find((r) => r.slug === w).name };
    // The winner is always listed, below the cut if need be.
    for (const [k, L] of Object.entries(lists)) {
      const i = L.findIndex((r) => r.slug === w);
      S.winner[k] = i >= 0 ? i + 1 : null;
      if (i >= TOP) S[k].push([ref(L[i]), i + 1]);
    }
  }
  seasons[season] = S;
}
const every = Object.values(bySeason).flat();
const allTime = Object.fromEntries(Object.keys(SORTS).map((k) => [k, ranked(every, k).slice(0, ALL_TIME).map((r, i) => [ref(r), i + 1])]));

fs.writeFileSync(OUT, JSON.stringify({
  bakedAt: new Date().toISOString().slice(0, 10),
  model: { floor: FLOOR, beta: rnd(BETA, 4), floorGrid: FLOOR_GRID, backtest },
  fields: FIELDS, rows, seasons, allTime,
}));
console.log(`${OUT}: ${rows.length} rows, ${Object.keys(seasons).length} seasons, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
console.log("model", { floor: FLOOR, beta: rnd(BETA, 3), ...backtest });
