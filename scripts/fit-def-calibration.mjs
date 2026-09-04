// Refits DEF_EST_CAL and DEF_EST_CAL_LG in app/lib/defense-math.js against the
// baked on-court ratings.
//
// The two constants exist because the D Rating blend mixes two measurements of
// the same thing that are NOT on the same scale: basketball-reference's
// box-score DRtg estimate, and what opponents actually scored per 100
// possessions with the player on the floor. The estimate separates team-mates
// far harder than real on-court play does, so its within-team deviation is
// shrunk onto the measured scale before it is used as the blend's prior:
//
//   est* = anchor + cal x (est - anchor)
//
// with the anchor the player's own team line (DEF_EST_CAL) or, for multi-team
// rows and seasons with no team map, the league line (DEF_EST_CAL_LG).
//
// This reports both halves of the fit:
//
//   1. THE REGRESSION. Splits est-vs-measured into a team component
//      (teamEst-L -> teamOn-L) and an individual one (est-teamEst ->
//      on-teamOn), minute-weighted over qualifying regular seasons, plus the
//      pooled slope the league-anchored fallback uses.
//
//   2. ERA PARITY. The individual slope is NOT what DEF_EST_CAL is set to.
//      Taking the raw on-court rating as ground truth for individual defence
//      would be wrong — team-mates share possessions, so on-court understates
//      a lone anchor — and at the raw slope the pre-on-court era collapses to
//      noise. What the constant is actually set by is the property that makes
//      an all-time leaderboard comparable: the era scored purely from the
//      estimate and the era with real on-court data should produce the same
//      distribution of extremes. So sweep cal and find where the two eras'
//      dVA/G tails agree.
//
// Both halves run through the app's own defVAInfo/calibratedEst rather than a
// restatement of them, which is what app/lib/defense-math.js was split out of
// the client module for.
//
//   node --import ./scripts/node/register.mjs scripts/fit-def-calibration.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defVAInfo, DEF_EST_CAL, DEF_EST_CAL_LG } from "../app/lib/defense-math.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

const defs = read("def-ratings.json");
const lga = read("league-averages.json");

// The estimate is noisy off a handful of minutes and the tail is what both
// halves of this fit are about, so qualify on a real season's floor time.
const MIN_MP = Number(process.env.MIN_MP || 500);

const seasons = Object.keys(defs).sort();
const seasonYear = (s) => Number(s.slice(0, 4));
// 1996-97 is the first season with on-court data at all, so it splits the two
// eras the parity criterion compares.
const FIRST_ON_COURT = 1996;

// --- rows -------------------------------------------------------------------
// Every qualifying regular-season player-season, with the season context the
// app would score it against.
const rows = [];
for (const season of seasons) {
  const bake = path.join(DATA, `regular-season-${season}.json`);
  if (!fs.existsSync(bake)) continue;
  const L = lga[season];
  if (!L?.laPTSperPoss) continue;
  const e = defs[season];
  for (const p of JSON.parse(fs.readFileSync(bake, "utf8")).players) {
    if (!p.slug || !(p.mp >= MIN_MP) || !(p.g > 0)) continue;
    const est = e?.rs?.[p.slug];
    if (est == null) continue;
    rows.push({ season, year: seasonYear(season), p, L,
                est, on: e?.rsOn?.[p.slug] ?? null,
                team: e?.team?.[p.team] ?? null,
                teamOn: e?.teamOn?.[p.team] ?? null });
  }
}
const onCourt = rows.filter((r) => r.on != null && r.team && r.teamOn != null);
console.log(`rows: ${rows.length} qualifying player-seasons (MP >= ${MIN_MP}), ` +
            `${onCourt.length} of them with an on-court rating and a team line`);
console.log(`eras: ${rows.filter(r => r.year < FIRST_ON_COURT).length} estimate-only ` +
            `(pre ${FIRST_ON_COURT}-97), ${rows.filter(r => r.year >= FIRST_ON_COURT).length} on-court\n`);

// --- 1. the regression ------------------------------------------------------
// Weighted least squares through the origin: both axes are deviations from the
// same anchor, so an intercept would only absorb a bias neither side has.
function slopeThroughOrigin(pairs) {
  let sxy = 0, sxx = 0, syy = 0, w = 0;
  for (const [x, y, wt] of pairs) { sxy += wt * x * y; sxx += wt * x * x; syy += wt * y * y; w += wt; }
  return { slope: sxy / sxx, r: sxy / Math.sqrt(sxx * syy), n: pairs.length, w };
}

const teamPairs = [];
const seenTeam = new Set();
for (const r of onCourt) {
  const key = `${r.season}|${r.p.team}`;
  if (seenTeam.has(key)) continue;
  seenTeam.add(key);
  const L = r.L.laPTSperPoss * 100;
  teamPairs.push([r.team.drtg - L, r.teamOn - L, 1]);
}
const indPairs = onCourt.map((r) => [r.est - r.team.drtg, r.on - r.teamOn, r.p.mp]);
const pooledPairs = onCourt.map((r) => {
  const L = r.L.laPTSperPoss * 100;
  return [r.est - L, r.on - L, r.p.mp];
});

const team = slopeThroughOrigin(teamPairs);
const ind = slopeThroughOrigin(indPairs);
const pooled = slopeThroughOrigin(pooledPairs);
console.log("1. REGRESSION (regular season, minute-weighted)");
console.log(`   team component   (teamEst-L -> teamOn-L)    slope ${team.slope.toFixed(3)}  r ${team.r.toFixed(3)}  n ${team.n} team-seasons`);
console.log(`   individual       (est-teamEst -> on-teamOn) slope ${ind.slope.toFixed(3)}  r ${ind.r.toFixed(3)}  n ${ind.n}`);
console.log(`   pooled           (est-L -> on-L)            slope ${pooled.slope.toFixed(3)}  r ${pooled.r.toFixed(3)}  -> DEF_EST_CAL_LG`);

// The individual slope drifts with sample size; the documented fit reported it
// getting SMALLER above 2000 MP, where the on-court side is least noisy, which
// is the evidence that this is miscalibration rather than measurement error.
for (const cut of [1000, 2000]) {
  const sub = onCourt.filter((r) => r.p.mp >= cut);
  if (sub.length < 50) continue;
  const s = slopeThroughOrigin(sub.map((r) => [r.est - r.team.drtg, r.on - r.teamOn, r.p.mp]));
  console.log(`   individual, MP >= ${cut}                    slope ${s.slope.toFixed(3)}  r ${s.r.toFixed(3)}  n ${s.n}`);
}

// --- 2. era parity ----------------------------------------------------------
function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// dVA per game for one candidate calibration, split by era.
function tails(indCal, lgCal) {
  const slopes = { ind: indCal, lg: lgCal };
  const old = [], recent = [];
  for (const r of rows) {
    const info = defVAInfo(r.p, r.p.mp / r.p.g, r.L, defs, r.season, "rs", slopes);
    if (!info) continue;
    (r.year < FIRST_ON_COURT ? old : recent).push(info.dva);
  }
  old.sort((a, b) => a - b); recent.sort((a, b) => a - b);
  return {
    oldP99: quantile(old, 0.99), newP99: quantile(recent, 0.99),
    oldMax: old[old.length - 1], newMax: recent[recent.length - 1],
    oldSd: Math.sqrt(old.reduce((s, v) => s + v * v, 0) / old.length),
    newSd: Math.sqrt(recent.reduce((s, v) => s + v * v, 0) / recent.length),
  };
}

console.log("\n2. ERA PARITY (dVA per game, estimate-only era vs on-court era)");
console.log("   cal    p99 old   p99 new   ratio    max old   max new   ratio    rms ratio");
let best = null;
for (let c = 0.20; c <= 1.001; c += 0.05) {
  const t = tails(c, pooled.slope);
  const ratio = t.oldP99 / t.newP99;
  const line = `   ${c.toFixed(2)}   ${t.oldP99.toFixed(3).padStart(7)}   ${t.newP99.toFixed(3).padStart(7)}   ` +
    `${ratio.toFixed(3).padStart(5)}    ${t.oldMax.toFixed(2).padStart(6)}    ${t.newMax.toFixed(2).padStart(6)}   ` +
    `${(t.oldMax / t.newMax).toFixed(3).padStart(5)}    ${(t.oldSd / t.newSd).toFixed(3)}`;
  console.log(line);
  const d = Math.abs(Math.log(ratio));
  if (!best || d < best.d) best = { c, d, ratio };
}
// Refine on the grid's winner: parity is monotone in cal over this range, so a
// bisection on log-ratio lands the crossing without a search strategy.
let lo = Math.max(0.05, best.c - 0.05), hi = Math.min(1.2, best.c + 0.05);
for (let i = 0; i < 24; i++) {
  const mid = (lo + hi) / 2;
  const t = tails(mid, pooled.slope);
  const ratio = t.oldP99 / t.newP99;
  if (ratio > 1) hi = mid; else lo = mid;
}
const fit = (lo + hi) / 2;
const at = tails(fit, pooled.slope);
console.log(`\n   parity at cal = ${fit.toFixed(3)}  (p99 ratio ${(at.oldP99 / at.newP99).toFixed(3)}, ` +
            `max ratio ${(at.oldMax / at.newMax).toFixed(3)}, rms ratio ${(at.oldSd / at.newSd).toFixed(3)})`);
console.log(`   currently shipping DEF_EST_CAL ${DEF_EST_CAL}, DEF_EST_CAL_LG ${DEF_EST_CAL_LG}`);
console.log(`   fit says               ${fit.toFixed(3)},                 ${pooled.slope.toFixed(3)}`);
