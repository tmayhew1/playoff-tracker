#!/usr/bin/env node
// Fit the draft assistant's series model (app/lib/draft-model.js) on every
// playoff series in app/data, and write app/data/draft-model.json.
//
//   npm run fit:draft
//
// The model: P(A beats B) = logistic(k * (strength_A - strength_B) + h * home)
// with home = +1 when A hosts game 1 (the better record / better seed), -1
// when B does. strength is rosterStrength(): the top n players' total
// regular-season VA per game of the season, n chosen here.
//
// Every choice is judged leave-one-season-out: fit on the other seasons,
// score the held-out one, so the reported numbers are what the model does on
// a postseason it has not seen. Baselines reported beside it: a coin flip,
// and home court alone.
//
// One caveat, recorded in the output: a past season's roster is the players
// who appeared for the team in those playoffs, so a star hurt before game 1
// is already missing. That is knowable on draft day; one hurt mid-series is
// not, and still counts here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seasonRosters, seasonSeries } from "../app/api/_lib/draft-data.js";
import { rosterStrength } from "../app/lib/draft-model.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const OUT = path.join(DATA, "draft-model.json");
const N_GRID = [5, 6, 7, 8, 10, 12];

const seasons = fs.readdirSync(DATA).map((f) => f.match(/^history-(\d{4}-\d{2})\.json$/)?.[1]).filter(Boolean).sort();
const data = [];
for (const s of seasons) {
  const [ros, series] = await Promise.all([seasonRosters(s), seasonSeries(s)]);
  if (ros?.source === "playoffs" && series.length) data.push({ s, ros, series });
}

const rowsFor = (n) => data.flatMap(({ s, ros, series }) => series.map((x) => {
  const [a, b] = x.teams;
  const st = (t) => rosterStrength(ros.rosters[t], ros.seasonGames, n);
  return { s, d: st(a) - st(b), h: x.home === a ? 1 : x.home === b ? -1 : 0, y: x.winner === a ? 1 : 0 };
}));

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// Logistic regression without intercept on (d, h), by Newton's method. Either
// feature can be switched off to fit the baselines.
function fit(rows, useD = true, useH = true) {
  let k = 0, h = 0;
  for (let it = 0; it < 50; it++) {
    let gk = 0, gh = 0, hkk = 1e-9, hkh = 0, hhh = 1e-9;
    for (const r of rows) {
      const p = sigmoid(k * r.d + h * r.h), w = p * (1 - p), e = p - r.y;
      gk += e * r.d; gh += e * r.h;
      hkk += w * r.d * r.d; hkh += w * r.d * r.h; hhh += w * r.h * r.h;
    }
    if (useD && useH) {
      const det = hkk * hhh - hkh * hkh;
      k -= (hhh * gk - hkh * gh) / det;
      h -= (hkk * gh - hkh * gk) / det;
    } else if (useD) k -= gk / hkk;
    else if (useH) h -= gh / hhh;
    if (Math.abs(gk) + Math.abs(gh) < 1e-10) break;
  }
  return { k, h };
}

function score(rows, pOf) {
  let ll = 0, brier = 0, hit = 0;
  for (const r of rows) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, pOf(r)));
    ll -= r.y ? Math.log(p) : Math.log(1 - p);
    brier += (p - r.y) ** 2;
    // A 50/50 call is half right, whichever way it goes.
    hit += p === 0.5 ? 0.5 : (p > 0.5) === (r.y === 1) ? 1 : 0;
  }
  const n = rows.length;
  return { logLoss: +(ll / n).toFixed(4), brier: +(brier / n).toFixed(4), accuracy: +(hit / n).toFixed(4) };
}

function loso(rows, useD, useH) {
  const held = [];
  for (const s of new Set(rows.map((r) => r.s))) {
    const m = fit(rows.filter((r) => r.s !== s), useD, useH);
    for (const r of rows.filter((r) => r.s === s)) held.push({ ...r, p: sigmoid(m.k * r.d + m.h * r.h) });
  }
  return score(held, (r) => r.p);
}

const grid = N_GRID.map((n) => ({ n, cv: loso(rowsFor(n), true, true) }));
const best = grid.reduce((a, b) => (b.cv.logLoss < a.cv.logLoss ? b : a));
const rows = rowsFor(best.n);
const params = fit(rows, true, true);

const out = {
  n: best.n,
  k: +params.k.toFixed(6),
  h: +params.h.toFixed(6),
  fit: {
    seasons: `${data[0].s}..${data[data.length - 1].s}`,
    seasonCount: data.length,
    series: rows.length,
    method: "logistic on (strength gap, home court), leave-one-season-out",
    heldOut: {
      model: best.cv,
      homeCourtOnly: loso(rows, false, true),
      strengthOnly: loso(rows, true, false),
      coinFlip: score(rows, () => 0.5),
    },
    rosterSizes: Object.fromEntries(grid.map((g) => [g.n, g.cv.logLoss])),
    caveat: "past rosters are the players who appeared in those playoffs",
  },
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
