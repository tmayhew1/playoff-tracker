#!/usr/bin/env node
// Fit the 2026-27 Look Ahead (app/lib/projection-model.js) on every baked
// regular season, backtest it, and write app/data/projection-<season>.json.
//
//   npm run fit:projections
//
// What it fits, in order:
//
//   1  aging curves       per piece, by the delta method: how a stat moved
//                         from one season to the next for players at each
//                         career stage, weighted by the smaller of the two
//                         samples (harmonic mean)
//   2  w and K            per piece, by grid search: the history decay and the
//                         shrinkage that best predict the NEXT season, error
//                         weighted by its sample
//   3  the MVP model      a conditional logit on season VA over each season's
//                         leading players, fit on every winner since 1980-81
//
// The backtest is honest about time: 1 and 2 are fit on target seasons up to
// 2024-25, then used to project 2025-26 from what was known in the summer of
// 2025 (and priced against 2024-25's league) — those are the accuracy numbers
// the page reports, beside the naive "same as last year" forecast. Then
// everything is refit through 2025-26 for the real projection.
//
// Players whose first baked season is 1980-81 are left out of fitting: their
// careers started before the data did, so their experience isn't known.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lgaForSeason, valueAdd } from "../app/scoring.js";
import { normalizeName } from "../app/lib/format.js";
import {
  MAX_EXP, MPG_TIERS, PCT_KEYS, RATE_KEYS, TIME_HISTORY,
  collegeUnits, expand, leagueContext, nextSeason, poolTeams, posGroup, projectPlayer, projectRookie,
  rookieRateFeatures, rookieTimeFeatures, timeFeatures, timeUnits, UNDRAFTED_PICK,
  scheduleLength, simulateAwards, allNbaTeams, tierOf,
} from "../app/lib/projection-model.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

const SEASONS = fs.readdirSync(DATA).map((f) => f.match(/^regular-season-(\d{4}-\d{2})\.json$/)?.[1]).filter(Boolean).sort();
const BASE = SEASONS.at(-1);            // the last season played
const TARGET = nextSeason(BASE);        // the one being projected
const HOLDOUT = BASE;                   // backtested from the season before
const FIRST_FIT_TARGET = "1985-86";
const OUT = path.join(DATA, `projection-${TARGET}.json`);

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
const censored = new Set(rowsBy[SEASONS[0]].map((r) => r.slug));

// Whole seasons sat out between a player's appearance i-1 and appearance i.
const missedBefore = (car, i) => SEASONS.indexOf(car[i].season) - SEASONS.indexOf(car[i - 1].season) - 1;

// Every (history → next season) pair the fit can learn from.
function targetsUpTo(lastTarget) {
  const out = [];
  for (const [slug, car] of careers) {
    if (censored.has(slug)) continue;
    for (let i = 1; i < car.length; i++) {
      const t = car[i];
      if (t.season < FIRST_FIT_TARGET || t.season > lastTarget) continue;
      // The projection is made in the summer before the target: its history is
      // what came before, its league is the season just played.
      const prev = SEASONS[SEASONS.indexOf(t.season) - 1];
      out.push({ slug, history: car.slice(Math.max(0, i - TIME_HISTORY), i), exp: i, actual: t, ctxPrev: ctxBy[prev], prevSeason: prev, missed: missedBefore(car, i) });
    }
  }
  return out;
}

// --- 1. Aging, by the delta method ---------------------------------------------
const harm = (a, b) => (a > 0 && b > 0 ? (2 * a * b) / (a + b) : 0);

function fitAging(lastTarget) {
  const acc = {
    rate: Object.fromEntries(RATE_KEYS.map((k) => [k, {}])),
    pct: Object.fromEntries(PCT_KEYS.map(({ key }) => [key, {}])),
  };
  const add = (bucket, e, num, den) => {
    const b = (bucket[e] ||= { num: 0, den: 0 });
    b.num += num; b.den += den;
  };
  for (const [slug, car] of careers) {
    if (censored.has(slug)) continue;
    for (let i = 1; i < car.length; i++) {
      const a = car[i - 1], b = car[i];
      if (b.season > lastTarget) continue;
      const e = Math.min(i, MAX_EXP);
      const ra = expand(a.row), rb = expand(b.row);
      const h = harm(ra.mp, rb.mp);
      if (ra.mp >= 300 && rb.mp >= 300) {
        for (const k of RATE_KEYS) {
          const ia = ra[k] / ra.mp / a.ctx.rate[k], ib = rb[k] / rb.mp / b.ctx.rate[k];
          if (Number.isFinite(ia) && Number.isFinite(ib)) add(acc.rate[k], e, h * ib, h * ia);
        }
      }
      for (const { key, made, att } of PCT_KEYS) {
        const ha = harm(ra[att], rb[att]);
        if (ra[att] < 25 || rb[att] < 25) continue;
        const da = ra[made] / ra[att] - a.ctx.pct[key], db = rb[made] / rb[att] - b.ctx.pct[key];
        add(acc.pct[key], e, ha * (db - da), ha);
      }
    }
  }
  // A ratio (rates) or a mean difference (the rest) per career stage,
  // smoothed over its neighbours — the late-career buckets are thin.
  const finish = (bucket, ratio) => {
    const raw = {};
    for (let e = 1; e <= MAX_EXP; e++) {
      const b = bucket[e];
      raw[e] = b && b.den > 0 ? { v: ratio ? b.num / b.den : b.num / b.den, w: b.den } : null;
    }
    const out = {};
    for (let e = 1; e <= MAX_EXP; e++) {
      let num = 0, den = 0;
      for (const d of [-1, 0, 1]) {
        const x = raw[e + d];
        if (!x) continue;
        const wt = (d === 0 ? 2 : 1) * x.w;
        num += wt * x.v; den += wt;
      }
      out[e] = den > 0 ? round(num / den, 5) : (ratio ? 1 : 0);
    }
    return out;
  };
  return {
    rate: Object.fromEntries(RATE_KEYS.map((k) => [k, finish(acc.rate[k], true)])),
    pct: Object.fromEntries(PCT_KEYS.map(({ key }) => [key, finish(acc.pct[key], false)])),
  };
}

// --- 2. w and K, by grid search ------------------------------------------------
const W_GRID = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const K_RATE = [0, 100, 250, 500, 1000, 1500, 2500, 4000];
const K_PCT = { fg2: [0, 50, 100, 200, 400, 800], tp: [0, 50, 100, 200, 400, 800, 1200], ft: [0, 50, 100, 200, 400, 800] };
// Weighted least squares, by the normal equations (a little ridge keeps the
// sparse late-career intercepts from wandering).
function wls(X, y, wt, ridge = 1e-6) {
  const d = X[0].length;
  const A = Array.from({ length: d }, () => new Array(d + 1).fill(0));
  X.forEach((x, n) => {
    for (let i = 0; i < d; i++) {
      A[i][d] += wt[n] * x[i] * y[n];
      for (let j = 0; j < d; j++) A[i][j] += wt[n] * x[i] * x[j];
    }
  });
  for (let i = 0; i < d; i++) A[i][i] += ridge;
  for (let c = 0; c < d; c++) {
    let p = c;
    for (let r = c + 1; r < d; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < d; r++) {
      if (r === c || A[c][c] === 0) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= d; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((r, i) => (r[i] ? r[d] / r[i] : 0));
}

// Playing time: next season's minutes per game and availability, each
// regressed on lib/projection-model.js timeFeatures plus an intercept per
// career stage.
function fitTime(targets) {
  const rows = targets.map((t) => {
    const r = t.actual.row;
    return { f: timeFeatures(timeUnits(t.history), t.missed), e: Math.min(t.exp, MAX_EXP), g: r.g, mpg: r.mp / r.g, avail: Math.min(1, r.g / scheduleLength(t.actual.season)) };
  });
  const withStage = (x, e) => [...x, ...Array.from({ length: MAX_EXP }, (_, i) => (e === i + 1 ? 1 : 0))];
  const fit = (key, wt) => {
    const X = rows.map((r) => withStage(r.f[key], r.e));
    const B = wls(X, rows.map((r) => r[key]), rows.map(wt));
    const n = rows[0].f[key].length;
    const err = X.reduce((a, x, i) => a + wt(rows[i]) * (x.reduce((s, v, j) => s + v * B[j], 0) - rows[i][key]) ** 2, 0)
      / rows.reduce((a, r) => a + wt(r), 0);
    return {
      packed: { coef: B.slice(0, n).map((v) => round(v, 5)), e: Object.fromEntries(Array.from({ length: MAX_EXP }, (_, i) => [i + 1, round(B[n + i], 5)])) },
      err,
    };
  };
  const m = fit("mpg", (r) => r.g), a = fit("avail", () => 1);
  return { time: { mpg: m.packed, avail: a.packed }, err: { mpg: m.err, avail: a.err } };
}

function fitParams(targets, aging) {
  const params = {
    rate: Object.fromEntries(RATE_KEYS.map((k) => [k, { w: 0.6, K: 1000 }])),
    pct: Object.fromEntries(PCT_KEYS.map(({ key }) => [key, { w: 0.6, K: 200 }])),
    aging,
    gap: null,
  };
  const { time, err: timeErr } = fitTime(targets);
  params.time = time;
  const actualUnits = targets.map((t) => {
    const r = expand(t.actual.row), c = t.actual.ctx;
    return {
      mp: r.mp,
      idx: Object.fromEntries(RATE_KEYS.map((k) => [k, r[k] / r.mp / c.rate[k]])),
      pct: Object.fromEntries(PCT_KEYS.map(({ key, made, att }) => [key, { att: r[att], d: r[att] > 0 ? r[made] / r[att] - c.pct[key] : 0 }])),
    };
  });
  // Error of one piece under a candidate setting.
  const loss = (piece, key) => {
    let se = 0, wt = 0;
    targets.forEach((t, j) => {
      const a = actualUnits[j];
      const p = projectPlayer(t.history, t.exp, params, t.ctxPrev, t.missed);
      if (piece === "rate") {
        if (a.mp < 200 || !Number.isFinite(a.idx[key])) return;
        se += a.mp * (p.idx[key] - a.idx[key]) ** 2; wt += a.mp;
      } else if (piece === "pct") {
        if (a.pct[key].att < 20) return;
        const d = p.pct[key] - t.ctxPrev.pct[key];
        se += a.pct[key].att * (d - a.pct[key].d) ** 2; wt += a.pct[key].att;
      }
    });
    return se / wt;
  };
  const search = (slot, grid, piece, key) => {
    let best = { l: Infinity };
    for (const cand of grid) {
      Object.assign(slot, cand);
      const l = loss(piece, key);
      if (l < best.l) best = { l, cand };
    }
    Object.assign(slot, best.cand);
    return best.l;
  };
  const cross = (a, b, f) => a.flatMap((x) => b.map((y) => f(x, y)));
  const fitErr = {};
  for (const k of RATE_KEYS) fitErr[k] = search(params.rate[k], cross(W_GRID, K_RATE, (w, K) => ({ w, K })), "rate", k);
  for (const { key } of PCT_KEYS) fitErr[key] = search(params.pct[key], cross(W_GRID, K_PCT[key], (w, K) => ({ w, K })), "pct", key);
  Object.assign(fitErr, timeErr);
  params.gap = fitGap(targets, actualUnits, params);
  return { params, fitErr };
}

// Rust: what a whole season away does to a player's per-minute rates and
// shooting, over and above the projection that ignores it. A minutes-weighted
// ratio (rates) or attempt-weighted difference (percentages) between what the
// returners did and what was projected for them, shrunk toward no effect by
// RUST_K phantom minutes / RUST_KP attempts — the sample is a few hundred
// player-seasons, and not every absence was an injury.
const RUST_K = 5000, RUST_KP = 500;
function fitGap(targets, actualUnits, params) {
  const rate = Object.fromEntries(RATE_KEYS.map((k) => [k, { a: 0, p: 0 }]));
  const pct = Object.fromEntries(PCT_KEYS.map(({ key }) => [key, { d: 0, w: 0 }]));
  let n = 0;
  targets.forEach((t, j) => {
    if (!(t.missed > 0)) return;
    const a = actualUnits[j];
    if (a.mp < 200) return;
    n++;
    const p = projectPlayer(t.history, t.exp, { ...params, gap: null }, t.ctxPrev, t.missed);
    for (const k of RATE_KEYS) if (Number.isFinite(a.idx[k])) { rate[k].a += a.mp * a.idx[k]; rate[k].p += a.mp * p.idx[k]; }
    for (const { key } of PCT_KEYS) {
      const x = a.pct[key];
      if (x.att < 20) continue;
      pct[key].d += x.att * (x.d - (p.pct[key] - t.ctxPrev.pct[key]));
      pct[key].w += x.att;
    }
  });
  return {
    n,
    rate: Object.fromEntries(RATE_KEYS.map((k) => [k, round((rate[k].a + RUST_K) / (rate[k].p + RUST_K), 4)])),
    pct: Object.fromEntries(PCT_KEYS.map(({ key }) => [key, round(pct[key].d / (pct[key].w + RUST_KP), 4)])),
  };
}

// --- 3. The MVP model ------------------------------------------------------------
// Every MVP since 1980-81, by Basketball-Reference slug.
const MVPS = {
  "1980-81": "ervinju01", "1981-82": "malonmo01", "1982-83": "malonmo01", "1983-84": "birdla01",
  "1984-85": "birdla01", "1985-86": "birdla01", "1986-87": "johnsma02", "1987-88": "jordami01",
  "1988-89": "johnsma02", "1989-90": "johnsma02", "1990-91": "jordami01", "1991-92": "jordami01",
  "1992-93": "barklch01", "1993-94": "olajuha01", "1994-95": "robinda01", "1995-96": "jordami01",
  "1996-97": "malonka01", "1997-98": "jordami01", "1998-99": "malonka01", "1999-00": "onealsh01",
  "2000-01": "iversal01", "2001-02": "duncati01", "2002-03": "duncati01", "2003-04": "garneke01",
  "2004-05": "nashst01", "2005-06": "nashst01", "2006-07": "nowitdi01", "2007-08": "bryanko01",
  "2008-09": "jamesle01", "2009-10": "jamesle01", "2010-11": "rosede01", "2011-12": "jamesle01",
  "2012-13": "jamesle01", "2013-14": "duranke01", "2014-15": "curryst01", "2015-16": "curryst01",
  "2016-17": "westbru01", "2017-18": "hardeja01", "2018-19": "antetgi01", "2019-20": "antetgi01",
  "2020-21": "jokicni01", "2021-22": "jokicni01", "2022-23": "embiijo01", "2023-24": "jokicni01",
  "2024-25": "gilgesh01",
};
const FIELD = 30;

// One season's candidates: the FIELD best by VA, put on an 82-game footing so
// the lockout years read on the same scale as the rest.
function mvpField(season) {
  const lga = lgaForSeason(season), f = 82 / scheduleLength(season);
  return rowsBy[season].map((r) => ({ slug: r.slug, x: (valueAdd(r, lga) * f) / 100 }))
    .sort((a, b) => b.x - a.x).slice(0, FIELD);
}

// The one-coefficient conditional logit, by Newton's method.
function fitLogit(fields) {
  let a = 0;
  for (let it = 0; it < 100; it++) {
    let g = 0, h = 1e-9;
    for (const { field, win } of fields) {
      const e = field.map((c) => Math.exp(a * c.x));
      const Z = e.reduce((s, v) => s + v, 0);
      const m = field.reduce((s, c, i) => s + (e[i] / Z) * c.x, 0);
      g += field[win].x - m;
      h += field.reduce((s, c, i) => s + (e[i] / Z) * (c.x - m) ** 2, 0);
    }
    a += g / h;
    if (Math.abs(g / h) < 1e-10) break;
  }
  return a;
}

function fitMvp() {
  const fields = Object.entries(MVPS).map(([season, slug]) => {
    const field = mvpField(season);
    return { season, field, win: field.findIndex((c) => c.slug === slug) };
  }).filter((f) => f.win >= 0);
  // Leave one season out: the probability the model gave the actual winner.
  let logp = 0, hit = 0;
  for (const f of fields) {
    const a = fitLogit(fields.filter((x) => x !== f));
    logp += a * f.field[f.win].x - Math.log(f.field.reduce((s, c) => s + Math.exp(a * c.x), 0));
    if (f.win === 0) hit++;
  }
  return {
    model: { a: round(fitLogit(fields), 4) },
    seasons: fields.length,
    // With one positive coefficient the favourite is always the VA leader.
    looTop1: round(hit / fields.length, 3),
    looMeanWinnerProb: round(Math.exp(logp / fields.length), 3),
  };
}

// --- 4. Team context: how hard each shared resource pools -------------------
// A season's projections, every player on the roster they actually played for:
// everyone with an earlier appearance (censored careers included — they were
// on those rosters too), projected as of the summer before. A traded player's
// "2TM" row has no single team, so it counts toward no pool and is scored
// unpooled.
const MULTI_TEAM = /^(TOT|\dTM)$/;
function seasonProjections(season, params) {
  const prev = SEASONS[SEASONS.indexOf(season) - 1];
  const out = [];
  for (const [slug, car] of careers) {
    const i = car.findIndex((c) => c.season === season);
    if (i < 1) continue;
    const missed = missedBefore(car, i);
    const proj = projectPlayer(car.slice(Math.max(0, i - TIME_HISTORY), i), i, params, ctxBy[prev], missed);
    const prevTeam = car[i - 1].row.team;
    out.push({
      slug, name: car[i].row.name, proj, actual: car[i], prevSeason: prev,
      team: MULTI_TEAM.test(car[i].row.team) ? null : car[i].row.team,
      moved: !MULTI_TEAM.test(prevTeam) && !MULTI_TEAM.test(car[i].row.team) && prevTeam !== car[i].row.team,
    });
  }
  return out;
}

const POOL_FIRST = "1995-96";
const BETA_GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1, 1.2];
const DELTA_GRID = [0, 0.25, 0.5, 1];
const usageRow = (r) => (r.fga || 0) + 0.475 * (r.fta || 0) + (r.tov || 0);

// β per resource, by grid search on the error it is responsible for: minutes
// per game (weighted by games), then each per-minute rate as an index on the
// league's (weighted by minutes). Minutes are fit first because the others
// are measured on the minutes it sets.
function fitPool(lastTarget, params) {
  const seasons = SEASONS.filter((x) => x >= POOL_FIRST && x <= lastTarget)
    .map((x) => ({ season: x, ctx: ctxBy[x], rows: seasonProjections(x, params) }));
  const per = { usg: usageRow, ast: (r) => r.ast, drb: (r) => r.drb, orb: (r) => r.orb };
  const lg = Object.fromEntries(seasons.map(({ season, rows }) => {
    const all = rowsBy[season];
    const mp = all.reduce((a, r) => a + r.mp, 0);
    return [season, Object.fromEntries(Object.entries(per).map(([k, f]) => [k, all.reduce((a, r) => a + f(r), 0) / mp]))];
  }));
  const err = (pool, key) => {
    let se = 0, w = 0;
    for (const { season, rows } of seasons) {
      const pooled = poolTeams(rows.map((r) => ({ team: r.team, row: r.proj.row })), pool);
      rows.forEach((r, i) => {
        const a = r.actual.row, q = pooled[i];
        if (key === "min") {
          se += a.g * (q.mp / q.g - a.mp / a.g) ** 2; w += a.g;
        } else if (a.mp >= 200 && q.mp > 0) {
          se += a.mp * ((per[key](q) / q.mp - per[key](a) / a.mp) / lg[season][key]) ** 2; w += a.mp;
        }
      });
    }
    return se / w;
  };
  const pool = { min: 0, usg: 0, ast: 0, drb: 0, orb: 0, usgDelta: 0 };
  const gain = {};
  for (const key of ["min", "usg", "ast", "drb", "orb"]) {
    const base = err({ ...pool, [key]: 0 }, key);
    let best = { e: base, b: 0, d: 0 };
    for (const b of BETA_GRID) for (const d of key === "usg" ? DELTA_GRID : [0]) {
      const e = err({ ...pool, [key]: b, ...(key === "usg" ? { usgDelta: d } : {}) }, key);
      if (e < best.e) best = { e, b, d };
    }
    pool[key] = best.b;
    if (key === "usg") pool.usgDelta = best.d;
    // How much of that resource's error pooling removed, against none.
    gain[key] = round(1 - best.e / base, 4);
  }
  // Then the split of a roster's possessions (poolTeams usgAlpha), on the
  // same per-minute usage error. Out of sample (fit through 2014-15, scored
  // on the eleven seasons after) it cut that error from 13.5% to 12.9%, and
  // for each team's top two users from 14.5% to 13.5%; a rank curve, and a
  // rank term on top of α, were tested and lost.
  const base = err(pool, "usg");
  let bestA = { e: base, a: 1 };
  for (const a of ALPHA_GRID) {
    const e = err({ ...pool, usgAlpha: a }, "usg");
    if (e < bestA.e) bestA = { e, a };
  }
  pool.usgAlpha = bestA.a;
  gain.usgAlpha = round(1 - bestA.e / base, 4);
  return { ...pool, gain };
}
const ALPHA_GRID = [0.9, 1, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4];

// --- 5. Rookies: draft slot and college → NBA --------------------------------
// Every rookie season whose draft is baked, with the pick and — when the
// previous college season is baked and the name is unique in it — the last
// college season. A name that appears twice is dropped rather than guessed at.
const COLLEGE = fs.readdirSync(DATA).map((f) => f.match(/^college-(\d{4}-\d{2})\.json$/)?.[1]).filter(Boolean).sort();
const collegeBy = Object.fromEntries(COLLEGE.map((x) => {
  const d = read(`college-${x}.json`);
  const rows = (d.players || []).filter((r) => r.mp > 0);
  return [x, { rows, ctx: leagueContext(rows) }];
}));

// Years in college: the seasons, ending at `cSeason`, in which a player's
// (unique) name appears in the baked college files, counting back until a
// season the name is missing from. Seasons before the first baked one are unknown,
// so a class is only fit on once three earlier seasons are baked.
const collegeNames = Object.fromEntries(COLLEGE.map((x) => [x, new Set(collegeBy[x].rows.map((r) => normalizeName(r.name)))]));
function yearsInCollege(name, cSeason) {
  const n = normalizeName(name);
  let y = 0;
  for (let i = COLLEGE.indexOf(cSeason); i >= 0 && collegeNames[COLLEGE[i]].has(n); i--) {
    y++;
    if (i > 0 && nextSeason(COLLEGE[i - 1]) !== COLLEGE[i]) break; // a gap in the bakes
  }
  return y;
}
const yearsKnown = (cSeason) => COLLEGE.indexOf(cSeason) >= 3;

// Draft slots, by Basketball-Reference player id (data/draft-picks.json). A
// player drafted one year and debuting later (a stashed international) keeps
// the pick; anyone missing debuted undrafted.
const DRAFT = fs.existsSync(path.join(DATA, "draft-picks.json")) ? read("draft-picks.json").years || {} : {};
const pickBySlug = new Map();
for (const picks of Object.values(DRAFT)) for (const d of picks) if (d.slug) pickBySlug.set(d.slug, d.pick);
const draftKnown = (nbaSeason) => !!DRAFT[nbaSeason.slice(0, 4)];

// Every rookie season whose draft is baked: the pick, and the last college
// season when one is baked and the name is unique in it.
function rookieSamples() {
  const out = [];
  for (const ns of SEASONS) {
    if (!draftKnown(ns)) continue;
    const cs = SEASONS[SEASONS.indexOf(ns) - 1];
    const col = collegeBy[cs];
    const byName = new Map();
    if (col) for (const r of col.rows) { const n = normalizeName(r.name); byName.set(n, byName.has(n) ? null : r); }
    for (const [slug, car] of careers) {
      if (car[0].season !== ns) continue;
      const a = car[0].row, college = byName.get(normalizeName(a.name)) || null;
      out.push({
        ns, cs, name: a.name, slug, pick: pickBySlug.get(slug) ?? UNDRAFTED_PICK,
        college, cctx: col?.ctx, years: college && yearsKnown(cs) ? yearsInCollege(a.name, cs) : null,
        actual: a, nctx: ctxBy[ns],
      });
    }
  }
  return out;
}

const RK_K = [0, 100, 250, 500, 1000], RK_KP = [0, 50, 100, 200];

// One sub-model (college + pick, or pick alone) by weighted least squares:
// each rate on its log index, each percentage on its gap, minutes (weighted by
// games) and availability.
function fitRookieModel(samples, withCollege) {
  const unitsOf = (x, K, Kp) => (withCollege ? collegeUnits(x.college, x.cctx, K, Kp, x.years) : null);
  const fitWith = (K, Kp) => {
    const rate = {}, pct = {};
    let err = 0;
    for (const k of RATE_KEYS) {
      const use = samples.filter((x) => x.actual.mp >= 200);
      const xs = use.map((x) => { const u = unitsOf(x, K, Kp); return rookieRateFeatures(u, u ? Math.log(Math.max(0.05, u.idx[k])) : 0, x.pick); });
      const ys = use.map((x) => Math.log(Math.max(0.05, expand(x.actual)[k] / x.actual.mp / x.nctx.rate[k])));
      const B = wls(xs, ys, use.map((x) => x.actual.mp), 1e-3);
      const w = use.reduce((acc, x) => acc + x.actual.mp, 0);
      // A fit in log space predicts the geometric mean, which runs below the
      // average a rate actually lands at — every rookie's usage would come out
      // shaved. Duan's smearing factor (the mean exponentiated residual)
      // restores the level, folded into the intercept.
      const smear = use.reduce((acc, x, i) => acc + x.actual.mp * Math.exp(ys[i] - xs[i].reduce((t, v, j) => t + v * B[j], 0)), 0) / w;
      B[0] += Math.log(smear);
      rate[k] = B.map((v) => round(v, 4));
      err += use.reduce((acc, x, i) => acc + x.actual.mp * (Math.exp(xs[i].reduce((t, v, j) => t + v * B[j], 0)) - Math.exp(ys[i])) ** 2, 0) / w;
    }
    for (const { key, made, att } of PCT_KEYS) {
      const use = samples.map((x) => ({ x, a: expand(x.actual) })).filter(({ a }) => a[att] >= 20);
      const B = wls(use.map(({ x }) => { const u = unitsOf(x, K, Kp); return rookieRateFeatures(u, u ? u.pct[key] : 0, x.pick); }),
        use.map(({ x, a }) => a[made] / a[att] - x.nctx.pct[key]), use.map(({ a }) => a[att]), 1e-3);
      pct[key] = B.map((v) => round(v, 4));
    }
    return { rate, pct, err };
  };
  let best = null;
  for (const K of withCollege ? RK_K : [0]) for (const Kp of withCollege ? RK_KP : [0]) {
    const f = fitWith(K, Kp);
    if (!best || f.err < best.err) best = { ...f, K, Kp };
  }
  const X = samples.map((x) => rookieTimeFeatures(unitsOf(x, best.K, best.Kp), x.pick));
  const mpg = wls(X, samples.map((x) => x.actual.mp / x.actual.g), samples.map((x) => x.actual.g), 1e-3).map((v) => round(v, 4));
  const avail = wls(X, samples.map((x) => Math.min(1, x.actual.g / scheduleLength(x.ns))), samples.map(() => 1), 1e-3).map((v) => round(v, 4));
  return { K: best.K, Kp: best.Kp, rate: best.rate, pct: best.pct, mpg, avail, n: samples.length };
}

const usesCollege = (x) => !!(x.college && x.years);
function fitRookie(samples) {
  const col = samples.filter(usesCollege);
  return {
    college: col.length >= 100 ? fitRookieModel(col, true) : null,
    pickOnly: fitRookieModel(samples.filter((x) => x.pick < UNDRAFTED_PICK), false),
  };
}

// Which model a rookie gets. A DRAFTED rookie gets the pick alone: with all
// ten college seasons baked, adding the college translation on top of the
// pick made lottery projections worse, not better (average miss 153.6 vs
// 145.9 for the pick alone, against 150.8 for "average rookie") — the pick
// already carries what the college season says, and the translation adds
// noise. An UNDRAFTED rookie has no pick, so the college + pick model (at
// pick 61) is all there is; one with no college season either isn't projected.
const rookieSrc = (x, rk) => (x.pick < UNDRAFTED_PICK
  ? { college: null, pick: x.pick }
  : usesCollege(x) && rk.college ? { college: x.college, cctx: x.cctx, years: x.years, pick: x.pick } : null);

// Leave one rookie class out: each class projected by models fit on the
// others, priced against the league of the season before (draft night), beside
// "every rookie is the average rookie". Lottery picks reported on their own —
// they're the rookies the page is about.
function rookieBacktest(samples) {
  const classes = [...new Set(samples.map((x) => x.ns))];
  const res = [];
  for (const c of classes) {
    const train = samples.filter((x) => x.ns !== c);
    const rk = fitRookie(train);
    const prev = SEASONS[SEASONS.indexOf(c) - 1];
    const lga = lgaForSeason(prev), lgaT = lgaForSeason(c);
    const meanVa = train.reduce((acc, x) => acc + valueAdd(x.actual, lgaForSeason(x.ns)), 0) / train.length;
    for (const x of samples.filter((y) => y.ns === c)) {
      const src = rookieSrc(x, rk);
      if (!src) continue;
      const proj = projectRookie(src, rk, ctxBy[prev]);
      res.push({ cls: c, name: x.name, pick: x.pick, model: src.college ? "college" : "pick",
        proj: valueAdd(proj.row, lga), projG: proj.g, actual: valueAdd(x.actual, lgaT), mp: x.actual.mp, naive: meanVa,
        g: (x.actual.g * 82) / scheduleLength(c) });
    }
  }
  const score = (rs) => (rs.length < 10 ? { players: rs.length } : {
    players: rs.length,
    corr: round(corr(rs.map((r) => r.proj), rs.map((r) => r.actual)), 3),
    mae: round(mae(rs.map((r) => r.proj), rs.map((r) => r.actual)), 1),
    maeNaive: round(mae(rs.map((r) => r.naive), rs.map((r) => r.actual)), 1),
    bias: round(rs.reduce((acc, r) => acc + r.actual - r.proj, 0) / rs.length, 1),
  });
  const rot = res.filter((r) => r.mp >= 500);
  // The simulation's draws for a rookie: every held-out miss as (ΔVA/G,
  // actual games / projected games), like the veterans' pool.
  const pool = res.map((r) => [round(r.actual / (r.g * scheduleLength(r.cls) / 82) - r.proj / r.projG, 2), round(Math.min(82 / r.projG, r.g / r.projG), 3)]);
  return {
    pool,
    classes: classes.length,
    ...score(rot),
    lottery: score(res.filter((r) => r.pick <= 14)),
    byModel: { college: score(rot.filter((r) => r.model === "college")), pick: score(rot.filter((r) => r.model === "pick")) },
    examples: [...res].sort((a, b) => b.actual - a.actual).slice(0, 10)
      .map((r) => ({ name: r.name, cls: r.cls, pick: r.pick, model: r.model, proj: round(r.proj, 0), actual: round(r.actual, 0), g: r.projG })),
  };
}

// --- Run ------------------------------------------------------------------------
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const t0 = Date.now();

// The backtest: fit through the season before HOLDOUT, project HOLDOUT.
const prevOfHoldout = SEASONS[SEASONS.indexOf(HOLDOUT) - 1];
const btAging = fitAging(prevOfHoldout);
const { params: btParams } = fitParams(targetsUpTo(prevOfHoldout), btAging);
btParams.pool = fitPool(prevOfHoldout, btParams);
// Every 2025-26 player, projected from what was known in the summer of 2025
// and placed on the roster they played for — pooled, and not, so the backtest
// can say what the team context is worth.
const lgaHold = lgaForSeason(HOLDOUT), lgaPrev = lgaForSeason(prevOfHoldout);
const holdRows = seasonProjections(HOLDOUT, btParams);
const holdPooled = poolTeams(holdRows.map((r) => ({ team: r.team, row: r.proj.row })), btParams.pool);
const bt = holdRows.map((t, i) => {
  const last = t.proj && careers.get(t.slug).find((c, j, a) => a[j + 1]?.season === HOLDOUT);
  return {
    slug: t.slug, name: t.name, moved: t.moved,
    proj: valueAdd(holdPooled[i], lgaPrev), solo: valueAdd(t.proj.row, lgaPrev), projG: t.proj.g,
    actual: valueAdd(t.actual.row, lgaHold), actualG: t.actual.row.g, actualMp: t.actual.row.mp,
    // "Same as last year": the last season's VA — the forecast to beat.
    naive: valueAdd(last.row, lgaForSeason(last.season)),
  };
});
const corr = (xs, ys) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
const mae = (xs, ys) => xs.reduce((a, x, i) => a + Math.abs(x - ys[i]), 0) / xs.length;
const rot = bt.filter((b) => b.actualMp >= 500);
const top = (key) => new Set([...bt].sort((a, b) => b[key] - a[key]).slice(0, 25).map((b) => b.slug));
const actualTop = top("actual");
const backtest = {
  season: HOLDOUT,
  players: rot.length,
  minMinutes: 500,
  corr: round(corr(rot.map((b) => b.proj), rot.map((b) => b.actual)), 3),
  corrNaive: round(corr(rot.map((b) => b.naive), rot.map((b) => b.actual)), 3),
  corrSolo: round(corr(rot.map((b) => b.solo), rot.map((b) => b.actual)), 3),
  mae: round(mae(rot.map((b) => b.proj), rot.map((b) => b.actual)), 1),
  maeNaive: round(mae(rot.map((b) => b.naive), rot.map((b) => b.actual)), 1),
  maeSolo: round(mae(rot.map((b) => b.solo), rot.map((b) => b.actual)), 1),
  // The players the team context matters most for: on a new team this year.
  moved: (() => {
    const m = rot.filter((b) => b.moved);
    return {
      players: m.length,
      mae: round(mae(m.map((b) => b.proj), m.map((b) => b.actual)), 1),
      maeSolo: round(mae(m.map((b) => b.solo), m.map((b) => b.actual)), 1),
      bias: round(m.reduce((a, b) => a + b.actual - b.proj, 0) / m.length, 1),
      biasSolo: round(m.reduce((a, b) => a + b.actual - b.solo, 0) / m.length, 1),
    };
  })(),
  // Mean miss (actual − projected) over the 50 best projections — the
  // number that says whether the top of the board is set too low or too high.
  // The rates the team context acts on, per minute as a share of the
  // league's: RMS error pooled vs solo, all rotation players and the movers.
  rates: (() => {
    const per = { usg: usageRow, ast: (r) => r.ast, drb: (r) => r.drb, orb: (r) => r.orb };
    const all = rowsBy[HOLDOUT], lmp = all.reduce((a, r) => a + r.mp, 0);
    const out = {};
    for (const [k, f] of Object.entries(per)) {
      const lg = all.reduce((a, r) => a + f(r), 0) / lmp;
      const rms = (rowOf, only) => {
        let se = 0, w = 0;
        holdRows.forEach((t, i) => {
          const a = t.actual.row, q = rowOf(i);
          if (a.mp < 500 || (only && !t.moved)) return;
          se += a.mp * ((f(q) / q.mp - f(a) / a.mp) / lg) ** 2; w += a.mp;
        });
        return round(Math.sqrt(se / w), 4);
      };
      out[k] = {
        pooled: rms((i) => holdPooled[i]), solo: rms((i) => holdRows[i].proj.row),
        movedPooled: rms((i) => holdPooled[i], true), movedSolo: rms((i) => holdRows[i].proj.row, true),
      };
    }
    return out;
  })(),
  biasTop50: round([...bt].sort((a, b) => b.proj - a.proj).slice(0, 50).reduce((a, b) => a + b.actual - b.proj, 0) / 50, 1),
  biasTop50Naive: round([...bt].sort((a, b) => b.naive - a.naive).slice(0, 50).reduce((a, b) => a + b.actual - b.naive, 0) / 50, 1),
  top25Hit: [...top("proj")].filter((s) => actualTop.has(s)).length,
  top25HitNaive: [...top("naive")].filter((s) => actualTop.has(s)).length,
  topProjected: [...bt].sort((a, b) => b.proj - a.proj).slice(0, 10)
    .map((b) => ({ name: b.name, proj: round(b.proj, 0), actual: round(b.actual, 0) })),
};

// The real fit, through BASE.
const aging = fitAging(BASE);
const { params, fitErr } = fitParams(targetsUpTo(BASE), aging);
params.pool = fitPool(BASE, params);

// Residual pool for the simulation: every projection's miss since 2005-06,
// as (ΔVA/G, actual games / projected games), by projected-minutes tier —
// measured after the team context, the same projection the page shows.
const pool = MPG_TIERS.map(() => []);
for (const season of SEASONS.filter((x) => x >= "2005-06")) {
  const rows = seasonProjections(season, params);
  const pooled = poolTeams(rows.map((r) => ({ team: r.team, row: r.proj.row })), params.pool);
  const lgaP = lgaForSeason(rows[0].prevSeason), lgaT = lgaForSeason(season);
  rows.forEach((r, i) => {
    const q = pooled[i], ar = r.actual.row;
    // Schedule-normalised, so a 66-game season's games read as a share of 82.
    const ag = (ar.g * 82) / scheduleLength(season);
    const dv = valueAdd(ar, lgaT) / ar.g - valueAdd(q, lgaP) / q.g;
    pool[tierOf(q.mp / q.g)].push([round(dv, 2), round(Math.min(82 / q.g, ag / q.g), 3)]);
  });
}

const mvp = fitMvp();

// Rookies, once past drafts are baked.
const samples = rookieSamples();
if (samples.length >= 200) {
  params.rookie = fitRookie(samples);
  const { pool: rookiePool, ...rookieBt } = rookieBacktest(samples);
  params.rookie.backtest = rookieBt;
  params.rookie.pool = rookiePool;
}

// The projection itself: everyone who played in either of the last two
// seasons, rebuilt against BASE's league.
const players = [];
const lgaBase = lgaForSeason(BASE);
for (const [slug, car] of careers) {
  const last = car.at(-1);
  if (last.season !== BASE && last.season !== SEASONS.at(-2)) continue;
  const missed = SEASONS.length - 1 - SEASONS.indexOf(last.season);
  const proj = projectPlayer(car.slice(-TIME_HISTORY), car.length, params, ctxBy[BASE], missed);
  const lastLga = lgaForSeason(last.season);
  players.push({
    slug, name: last.row.name, team: last.row.team, pos: posGroup(last.row.pos), exp: car.length,
    missedLast: last.season !== BASE,
    mpg: round(proj.mpg, 1),
    lostLast: !!proj.lostLast,
    row: Object.fromEntries(Object.entries(proj.row).map(([k, v]) => [k, round(v, k === "g" ? 0 : 1)])),
    va: round(valueAdd(proj.row, lgaBase), 1),
    last: {
      season: last.season, team: last.row.team, g: last.row.g, mp: last.row.mp,
      pts: last.row.pts, ast: last.row.ast, drb: last.row.drb, orb: last.row.orb, stl: last.row.stl, blk: last.row.blk,
      tov: last.row.tov, fgm: last.row.fgm, fga: last.row.fga, tpm: last.row.tpm, tpa: last.row.tpa, ftm: last.row.ftm, fta: last.row.fta,
      va: round(valueAdd(last.row, lastLga), 1),
    },
  });
}
players.sort((a, b) => b.va - a.va);

// A preview of the awards (the page re-runs this against live rosters), so
// the fit log shows what the page will.
// Pooled on the baked teams (the page pools on live rosters).
const previewRows = poolTeams(players.map((p) => ({ team: MULTI_TEAM.test(p.team) ? null : p.team, row: p.row })), params.pool);
const preview = players.map((p, i) => ({ ...p, va: valueAdd(previewRows[i], lgaBase), g: previewRows[i].g, mpg: previewRows[i].mp / previewRows[i].g }));
const sim = simulateAwards(preview.map((p) => ({ key: p.slug, g: p.g, va: p.va, mpg: p.mpg })), mvp.model, pool, { sims: 2000 });
const bySlug = Object.fromEntries(players.map((p) => [p.slug, p]));

fs.writeFileSync(OUT, JSON.stringify({
  season: TARGET, base: BASE, fittedAt: new Date().toISOString().slice(0, 10),
  // The league a projection is rebuilt against — the route needs it to
  // project rookies on the fly.
  ctx: { rate: ctxBy[BASE].rate, pct: ctxBy[BASE].pct },
  collegeSeason: COLLEGE.includes(BASE) ? BASE : null,
  // The incoming class's draft, for the route to look picks up by name.
  draftYear: TARGET.slice(0, 4),
  params,
  fitErr: Object.fromEntries(Object.entries(fitErr).map(([k, v]) => [k, Number(v.toPrecision(4))])),
  mvp, backtest,
  pool,
  players,
}) + "\n");

console.log(`fit ${SEASONS[0]}..${BASE} → ${TARGET} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log("rates", Object.fromEntries(RATE_KEYS.map((k) => [k, `${params.rate[k].w}/${params.rate[k].K}`])));
console.log("pcts ", Object.fromEntries(PCT_KEYS.map(({ key }) => [key, `${params.pct[key].w}/${params.pct[key].K}`])));
console.log("time ", JSON.stringify(params.time));
console.log("gap  ", JSON.stringify(params.gap));
console.log("pool ", JSON.stringify(params.pool));
console.log("rookie", JSON.stringify(params.rookie || "no past college seasons baked"));
console.log("aging tpa", aging.rate.tpa);
console.log("backtest", backtest);
console.log("mvp", mvp);
console.log("pool sizes", pool.map((p) => p.length));
console.log("top projected (pooled, baked teams)", [...preview].sort((a, b) => b.va - a.va).slice(0, 15).map((p) => `${p.name} ${p.team} ${p.va.toFixed(0)} (${p.g}g)`));
console.log("mvp odds", sim.filter((r) => r.mvp > 0.01).sort((a, b) => b.mvp - a.mvp).map((r) => `${bySlug[r.key].name} ${(r.mvp * 100).toFixed(1)}%`));
console.log("all-nba", allNbaTeams(sim).map((t) => t.map((r) => `${bySlug[r.key].name} ${(r.allNba * 100).toFixed(0)}%`)));
console.log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
