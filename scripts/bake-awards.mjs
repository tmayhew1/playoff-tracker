#!/usr/bin/env node
// Bake the Awards tab (app/components/awards-view.js) and the award odds the
// player cards show (app/components/award-boxes.js):
//
//   app/data/awards.json       the MVP, MIP, All-NBA and All-Star boards
//   app/data/award-odds.json   each player-season's odds for all four, by slug
//
//   npm run bake:awards         (after npm run fit:projections, and with
//                                app/data/award-voting.json baked by
//                                scripts/R/fetch_award_voting.R)
//
// --- MVP --------------------------------------------------------------------------
// A conditional logit on season VA+ (VA plus the D-rating term), on an 82-game
// footing, over each season's MVP_FIELD best players plus anyone who drew a
// vote (from 2023-24 on, only those who meet the 65-game rule), fit on every
// winner since 1980-81. VA+ beat plain VA held out a season at a time (real
// MVP ranked #1 in 24 of 46 seasons against 22). Fitting to the full vote share
// instead of the winner was tested too: with one input the order can't change,
// and the odds came out flatter and less calibrated to who wins, so the vote
// share is shown on the board rather than fit.
//
// --- All-NBA and All-Star -----------------------------------------------------------
// Each player's chance of being selected: a logistic on season VA+ (per 82
// games), with each season's intercept set so the odds add up to the real
// number of places (10 All-NBA before 1988-89, 15 after; that season's All-Star
// roster, or 24 where it's missing). VA+ beat plain VA, VA per game, games, and
// combinations of them, and filling All-NBA by position (2 G, 2 F, 1 C a team
// before 2023-24) added nothing. All-Star seasons whose roster parsed short
// (the tournament format from 2025) are scored but not fit on.
//
// --- MIP --------------------------------------------------------------------------
// Every regular season since 1981-82, each returning player's actual VA beside
// what the Look Ahead model (app/lib/projection-model.js) would have projected
// for them the summer before, and a Most Improved Player model fit on every
// winner since 1985-86.
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
import { defVAInfo } from "../app/lib/defense-math.js";
import { AWARD_MIN_GAMES, TIME_HISTORY, leagueContext, nextSeason, poolTeams, projectPlayer, scheduleLength } from "../app/lib/projection-model.js";
import { AWARD_RULE_SINCE, MIP_WINNERS, MVP_WINNERS } from "../app/lib/awards.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

const SEASONS = fs.readdirSync(DATA).map((f) => f.match(/^regular-season-(\d{4}-\d{2})\.json$/)?.[1]).filter(Boolean).sort();
const PROJ = read(`projection-${nextSeason(SEASONS.at(-1))}.json`);
const OUT = path.join(DATA, "awards.json");
const VOTES = read("award-voting.json").seasons;
const DEFS = read("def-ratings.json");
const ODDS_OUT = path.join(DATA, "award-odds.json");

const WINNERS = MIP_WINNERS;
const FLOOR_GRID = [2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50];
const RIDGE = 0.01;
const TOP = 25;     // rows kept per season and sort
const ALL_TIME = 50;
const MVP_FIELD = 30;

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
  "ratio", "mip", "eLine", "aLine", "lastSeason", "lastTeam", "lastG", "lastVa", "lastLine", "vote"];
// A player's share of an award's vote that season (0 for none), from the bake.
const voteShare = (season, award) => new Map((VOTES[season]?.voting?.[award] || []).map((v) => [v.slug, v.share ?? 0]));
const rnd = (x, d) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const rows = [], idx = new Map();
const ref = (r) => {
  const k = `${r.slug}|${r.season}`;
  if (!idx.has(k)) {
    idx.set(k, rows.length);
    rows.push([r.name, r.team, r.season, r.slug, r.exp, r.g, Math.round(r.projG), Math.round(r.actual), Math.round(r.proj),
      rnd(r.a, 2), rnd(r.e, 2), rnd(Math.exp(r.lr), 3), rnd(r.mip, 4), r.eLine, r.aLine,
      r.last.season, r.last.team, r.last.g, Math.round(r.last.va), r.last.line, rnd(voteShare(r.season, "mip").get(r.slug) || 0, 3)]);
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

const mip = {
  model: { floor: FLOOR, beta: rnd(BETA, 4), floorGrid: FLOOR_GRID, backtest },
  fields: FIELDS, rows, seasons, allTime,
};

// --- Season VA+ for every player ---------------------------------------------------
// VA plus the D-rating term, per 82 games so the lockout years read the same.
const plusBy = {};
for (const season of SEASONS) {
  const lga = lgaForSeason(season), f = 82 / scheduleLength(season);
  plusBy[season] = rowsBy[season].filter((r) => r.slug).map((r) => {
    const vp = valueAdd(r, lga) + (defVAInfo(r, r.mp, lga, DEFS, season, "rs")?.dva ?? 0);
    return { slug: r.slug, name: r.name, team: r.team, g: r.g, vp, x: (vp * f) / 100, line: line(r) };
  }).sort((a, b) => b.x - a.x);
}
const ruled = (season) => season >= AWARD_RULE_SINCE;
const eligibleFor = (season) => (r) => !ruled(season) || r.g >= AWARD_MIN_GAMES;

// --- MVP ------------------------------------------------------------------------
const mvpBy = {};
for (const season of SEASONS) {
  const voted = voteShare(season, "mvp");
  const el = plusBy[season].filter(eligibleFor(season));
  const field = el.slice(0, MVP_FIELD);
  mvpBy[season] = [...field, ...el.slice(MVP_FIELD).filter((r) => voted.has(r.slug))];
}
const mvpFields = Object.entries(MVP_WINNERS).filter(([s]) => mvpBy[s]).map(([season, slug]) => {
  const pool = mvpBy[season], win = pool.findIndex((r) => r.slug === slug);
  if (win < 0) throw new Error(`MVP ${season} (${slug}) is outside the field`);
  return { season, pool, win };
});
const mvpX = (r) => r.x;
const mvpLoso = (() => {
  const rk = [];
  let ll = 0;
  for (const f of mvpFields) {
    const b = fitBeta(mvpFields.filter((o) => o !== f), mvpX);
    const u = f.pool.map((r) => b * r.x), m = Math.max(...u);
    ll += u[f.win] - m - Math.log(sum(u.map((v) => Math.exp(v - m))));
    rk.push(1 + u.filter((v) => v > u[f.win]).length);
  }
  rk.sort((a, b) => a - b);
  return { seasons: rk.length, top1: rk.filter((r) => r === 1).length, top3: rk.filter((r) => r <= 3).length,
    top5: rk.filter((r) => r <= 5).length, medianRank: rk[rk.length >> 1], meanWinnerP: rnd(Math.exp(ll / rk.length), 3) };
})();
const MVP_BETA = fitBeta(mvpFields, mvpX);
const PICK_FIELDS = ["name", "team", "slug", "g", "vaPlus", "vaPlusPg", "p", "vote", "pick", "line"];
const pickRow = (r, p, vote, pick) => [r.name, r.team, r.slug, r.g, Math.round(r.vp), rnd(r.vp / r.g, 2), rnd(p, 4), vote == null ? null : rnd(vote, 3), pick, r.line];
const mvpSeasons = {};
for (const [season, pool] of Object.entries(mvpBy)) {
  const m = Math.max(...pool.map((r) => MVP_BETA * r.x)), z = sum(pool.map((r) => Math.exp(MVP_BETA * r.x - m)));
  const votes = voteShare(season, "mvp"), w = MVP_WINNERS[season];
  const ranked = pool.map((r) => ({ r, p: Math.exp(MVP_BETA * r.x - m) / z })).sort((a, b) => b.p - a.p);
  mvpSeasons[season] = {
    winner: w ? { slug: w, name: pool.find((r) => r.slug === w).name, rank: ranked.findIndex((e) => e.r.slug === w) + 1 } : null,
    rows: ranked.map(({ r, p }) => pickRow(r, p, votes.get(r.slug) || 0, r.slug === w ? "MVP" : null)),
  };
}
const mvp = { model: { beta: rnd(MVP_BETA, 4), field: MVP_FIELD, ruleSince: AWARD_RULE_SINCE, minGames: AWARD_MIN_GAMES, backtest: mvpLoso }, fields: PICK_FIELDS, seasons: mvpSeasons };

// --- All-NBA and All-Star -------------------------------------------------------------
const SEL_POOL = 80, SEL_SHOWN = 30;
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
// The intercept that makes a season's odds add up to its places, by bisection:
// the sum only rises with the intercept, and Newton's method can stall where
// every probability is pinned near 0 or 1.
function calibrate(z, K) {
  let lo = -Math.max(...z) - 50, hi = -Math.min(...z) + 50;
  for (let it = 0; it < 200 && hi - lo > 1e-10; it++) {
    const a = (lo + hi) / 2;
    let f = -K;
    for (const v of z) f += sigmoid(v + a);
    if (f > 0) hi = a; else lo = a;
  }
  return (lo + hi) / 2;
}
// One slope by Newton's method, each season's intercept recalibrated as it goes.
function fitSel(F) {
  let b = 0;
  for (let it = 0; it < 60; it++) {
    let g = -2 * RIDGE * b, h = -2 * RIDGE;
    for (const f of F) {
      const a = calibrate(f.pool.map((r) => b * r.x), f.K);
      for (const r of f.pool) { const p = sigmoid(a + b * r.x); g += (r.y - p) * r.x; h -= p * (1 - p) * r.x * r.x; }
    }
    const st = g / h;
    b -= st;
    if (Math.abs(st) < 1e-9) break;
  }
  return b;
}
const selProb = (pool, K, b) => { const a = calibrate(pool.map((r) => b * r.x), K); return pool.map((r) => sigmoid(a + b * r.x)); };

function selectionBoard(kind) {
  const seasonsOut = {}, train = [];
  for (const season of SEASONS) {
    const e = VOTES[season];
    if (!e) continue;
    let picks, K, partial = false;
    if (kind === "allnba") {
      picks = new Map(Object.entries(e.allNba || {}).flatMap(([team, slugs]) => slugs.map((s) => [s, team])));
      K = picks.size || 15;
    } else {
      if (!e.allStar) continue; // no game (1998-99)
      picks = new Map(e.allStar.map((s) => [s, "AS"]));
      partial = !!e.allStarPartial;
      K = partial ? 24 : picks.size;
    }
    const el = plusBy[season].filter(kind === "allnba" ? eligibleFor(season) : () => true);
    const pool = [...el.slice(0, SEL_POOL), ...plusBy[season].filter((r) => picks.has(r.slug) && !el.slice(0, SEL_POOL).includes(r))]
      .map((r) => ({ ...r, y: picks.has(r.slug) ? 1 : 0 }));
    seasonsOut[season] = { pool, K, picks, partial };
    if (!partial && picks.size) train.push({ season, pool, K });
  }
  // Held out a season at a time: how many of the K likeliest were picked.
  let hits = 0, places = 0;
  for (const f of train) {
    const p = selProb(f.pool, f.K, fitSel(train.filter((o) => o !== f)));
    hits += f.pool.map((r, i) => [p[i], r.y]).sort((a, c) => c[0] - a[0]).slice(0, f.K).filter(([, y]) => y).length;
    places += f.K;
  }
  const b = fitSel(train);
  const out = {};
  for (const [season, S] of Object.entries(seasonsOut)) {
    const p = selProb(S.pool, S.K, b);
    const ranked = S.pool.map((r, i) => ({ r, p: p[i] })).sort((x, y) => y.p - x.p);
    const shown = ranked.filter((e, i) => i < SEL_SHOWN || S.picks.has(e.r.slug));
    out[season] = {
      places: S.K, partial: S.partial,
      rows: shown.map((e) => pickRow(e.r, e.p, null, S.picks.get(e.r.slug) || null)),
      ranks: shown.map((e) => ranked.indexOf(e) + 1),
    };
  }
  return { model: { beta: rnd(b, 4), pool: SEL_POOL, ruleSince: AWARD_RULE_SINCE, minGames: AWARD_MIN_GAMES,
    backtest: { seasons: train.length, hits, places, rate: rnd(hits / places, 3) } }, fields: PICK_FIELDS, seasons: out };
}
const allnba = selectionBoard("allnba");
const allstar = selectionBoard("allstar");

// --- Card odds --------------------------------------------------------------------
// season -> slug -> [MVP %, MVP rank, MIP %, MIP rank, All-NBA %, rank,
// All-Star %, rank]: the boards' own rounded odds, as percentages, so a card
// and its board always show the same number. A rank is only given where the
// Awards board lists the player, so the card's Go → always lands on a row;
// players under 0.5% and off every board are left out to keep it small.
const odds = {};
const put = (season, slug, k, v) => { ((odds[season] ||= {})[slug] ||= Array(8).fill(null))[k] = v; };
const pctOf = (p) => rnd(rnd(p, 4) * 100, 2);
const P = PICK_FIELDS.indexOf("p"), SLUG = PICK_FIELDS.indexOf("slug");
for (const [season, S] of Object.entries(mvpSeasons)) S.rows.forEach((r, i) => { put(season, r[SLUG], 0, pctOf(r[P])); put(season, r[SLUG], 1, i + 1); });
for (const [season, rs] of Object.entries(bySeason)) {
  const listed = new Map(seasons[season].mip.map(([i, rank]) => [rows[i][FIELDS.indexOf("slug")], rank]));
  for (const r of rs) if (r.mip != null && (r.mip >= 0.005 || listed.has(r.slug))) {
    put(season, r.slug, 2, pctOf(r.mip));
    if (listed.has(r.slug)) put(season, r.slug, 3, listed.get(r.slug));
  }
}
for (const [k, board] of [[4, allnba], [6, allstar]]) {
  for (const [season, S] of Object.entries(board.seasons)) S.rows.forEach((r, i) => { put(season, r[SLUG], k, pctOf(r[P])); put(season, r[SLUG], k + 1, S.ranks[i]); });
}

const bakedAt = new Date().toISOString().slice(0, 10);
fs.writeFileSync(OUT, JSON.stringify({ bakedAt, mvp, mip, allnba, allstar }));
fs.writeFileSync(ODDS_OUT, JSON.stringify({ bakedAt, odds }));
console.log(`${OUT}: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB · ${ODDS_OUT}: ${(fs.statSync(ODDS_OUT).size / 1024).toFixed(0)} KB`);
console.log("MIP", { floor: FLOOR, beta: rnd(BETA, 3), ...backtest });
console.log("MVP", { beta: rnd(MVP_BETA, 3), ...mvpLoso });
console.log("All-NBA", allnba.model.backtest, "All-Star", allstar.model.backtest);
