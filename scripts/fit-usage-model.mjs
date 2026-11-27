// Fits the usage-adjusted scoring baseline used by USG-ADJ mode (VA spec §4.6)
// and writes app/data/usage-model.json.
//
// For each season, over EVERY player-season in that season's regular-season
// totals, a minutes-weighted least-squares line
//
//   PTS/MP  ~  a  +  b · USG/MP,      USG = FGA + 0.475 · FTA
//
// is fit. USG-ADJ mode then charges a player a + b·(USG/MP) points per minute
// instead of the flat league median mu_PTS: the baseline becomes "what the
// league scores on the possessions he actually used", so scoring volume is
// only paid for above the going rate for that workload.
//
// Per season, not pooled: the league scored 0.84 points per possession in
// 1970-71 and 1.12 in 2024-25, so one pooled line would hand every modern
// player a surplus and every old one a deficit — an era artifact, and a
// violation of spec invariant 2 (baselines are season-local). Playoff runs are
// scored against their own season's regular-season fit, exactly as la2P/la3P
// and mu_PTS already are.
//
// Minutes-weighted, matching weighted_median_rate in scripts/R/scrape_common.R:
// the line describes the median league MINUTE, not the median roster spot, so a
// 40-minute call-up cannot outvote a starter. The skew argument that made
// mu_PTS a median rather than a mean does not carry over — what skewed the mean
// upward was the handful of high-usage stars, and usage is now a regressor
// rather than an omitted variable.
//
// Usage: npm run usage:fit  [-- --check]
//   --check  compares the fit against the existing baseline and writes nothing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const OUT = path.join(DATA, "usage-model.json");

// Possessions a free-throw attempt uses — Hollinger's coefficient, the same one
// the possession estimate Pi already uses everywhere else in this repo
// (scrape_common.R::lga_from_totals, spec section 1.2). Sharing it is the point:
// USG is then denominated in the same possessions that pi prices, rather than in
// a second, private currency. KEEP IN SYNC with USG_FTA_W in app/scoring.js —
// the fit and the scorer have to index usage the same way or the baseline means
// nothing.
const FTA_W = 0.475;

const usg = (p) => (p.fga || 0) + FTA_W * (p.fta || 0);


// Minutes-weighted OLS of y = PTS/MP on x = USG/MP. Returns the line plus the
// weighted R^2 and the sample it was fit on.
function fitSeason(players) {
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, n = 0;
  for (const p of players) {
    const mp = p.mp || 0;
    if (!(mp > 0)) continue;
    const x = usg(p) / mp, y = (p.pts || 0) / mp, w = mp;
    sw += w; sx += w * x; sy += w * y;
    sxx += w * x * x; sxy += w * x * y; syy += w * y * y;
    n++;
  }
  if (!(sw > 0) || n < 2) return null;
  const mx = sx / sw, my = sy / sw;
  const vxx = sxx / sw - mx * mx, vxy = sxy / sw - mx * my, vyy = syy / sw - my * my;
  if (!(vxx > 0)) return null;
  const b = vxy / vxx;
  return {
    a: my - b * mx,
    b,
    r2: vyy > 0 ? (vxy * vxy) / (vxx * vyy) : 0,
    n,
    mp: Math.round(sw),
  };
}

// Minutes-weighted median of a per-minute rate — the same statistic
// league-averages.json's mu_PTS is (scrape_common.R::weighted_median_rate),
// reused here to report where the fitted line sits at the median MINUTE of
// usage. That comparison is the sanity check on the whole exercise: a line
// that does not pass near (mu_USG, mu_PTS) is not a refinement of the existing
// baseline, it is a different baseline.
function weightedMedianRate(players, of) {
  const rows = players.filter((p) => p.mp > 0)
    .map((p) => ({ rate: of(p) / p.mp, mp: p.mp }))
    .sort((x, y) => x.rate - y.rate);
  const total = rows.reduce((s, r) => s + r.mp, 0);
  let cum = 0;
  for (const r of rows) { cum += r.mp; if (cum >= total / 2) return r.rate; }
  return 0;
}

const round = (v, d) => Number(v.toFixed(d));

// --- The replacement possession (spec §4.9) ----------------------------------
// The one-baseline candidate charges every possession a player uses beyond a
// median minute's share at e_m, what a TEAMMATE would have scored with it. Its
// volume credit is then not a taste but a measurement, λ* = 1 − e_m/ē, and e_m
// is the usage–efficiency trade-off read at the median minute:
//
//   e_m = ē · (1 + k),   k = d(efficiency) / d(usage), both relative to the
//                        season's own ē and ū, so one k spans every era
//
// k is estimated from players who stayed on one team in consecutive seasons,
// first-differenced (which removes the player's own talent), with the change
// in his TEAMMATES' usage rate as the instrument for the change in his own. A
// player's own usage is endogenous to his shooting (a hot season earns more
// shots, biasing a plain regression toward k = 0 from below); his teammates'
// usage is the zero-sum pressure on it from outside. The first stage is the
// zero-sum itself: when teammates use more, he uses less.
//
// Pooled, not per season: a single season pair is ~200 players, and its IV
// estimate swings from −0.4 to +0.6 on first stages as weak as −0.1. The era
// adjustment rides on ē, which IS per season.
const REPL_MIN_MP = 500, REPL_MIN_USG = 50, REPL_BOOT = 500;

function replacementRows(players, muUsg, eBar) {
  // Traded rows (2TM/3TM/…) carry no team, so they can't be placed among
  // teammates; their minutes are also left out of the team totals.
  const rows = players.filter((p) => p.mp > 0 && p.team && !/TM$|^TOT$/.test(p.team));
  const team = new Map();
  for (const p of rows) {
    const t = team.get(p.team) || { u: 0, mp: 0 };
    t.u += usg(p); t.mp += p.mp; team.set(p.team, t);
  }
  const out = new Map();
  for (const p of rows) {
    const u = usg(p);
    if (p.mp < REPL_MIN_MP || u < REPL_MIN_USG) continue;
    const t = team.get(p.team);
    if (!(t.mp - p.mp > 0)) continue;
    out.set(p.slug, {
      w: p.mp,
      u: u / p.mp / muUsg,
      e: (p.pts || 0) / u / eBar,
      z: (t.u - u) / (t.mp - p.mp) / muUsg,
    });
  }
  return out;
}

// Weighted covariance over an index list.
function wcov(P, ix, x, y) {
  let sw = 0, sx = 0, sy = 0, sxy = 0;
  for (const i of ix) {
    const w = P.w[i]; sw += w; sx += w * P[x][i]; sy += w * P[y][i]; sxy += w * P[x][i] * P[y][i];
  }
  return sxy / sw - (sx / sw) * (sy / sw);
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fitReplacement(bySeason) {
  const P = { w: [], du: [], de: [], dz: [] };
  const names = [...bySeason.keys()].sort();
  for (let i = 1; i < names.length; i++) {
    const a = bySeason.get(names[i - 1]), b = bySeason.get(names[i]);
    for (const [slug, r1] of b) {
      const r0 = a.get(slug);
      if (!r0) continue;
      P.w.push(Math.min(r0.w, r1.w));
      P.du.push(r1.u - r0.u); P.de.push(r1.e - r0.e); P.dz.push(r1.z - r0.z);
    }
  }
  const n = P.w.length;
  if (n < 500) return null;
  const all = Array.from({ length: n }, (_, i) => i);
  const iv = (ix) => wcov(P, ix, "dz", "de") / wcov(P, ix, "dz", "du");
  const k = iv(all);
  const rand = mulberry32(20261127);
  const boot = [];
  for (let b = 0; b < REPL_BOOT; b++) {
    const ix = Array.from({ length: n }, () => Math.floor(rand() * n));
    boot.push(iv(ix));
  }
  boot.sort((x, y) => x - y);
  const q = (f) => boot[Math.floor(f * (boot.length - 1))];
  // λ* = 1 − e_m/ē = −k. A positive k (efficiency RISES with usage) would make
  // λ negative — charging a player for carrying load — which no reading of the
  // counterfactual supports, so it is floored at zero rather than extrapolated.
  const lam = (kk) => Math.min(1, Math.max(0, -kk));
  return {
    k: round(k, 4),
    kCI: [round(q(0.025), 4), round(q(0.975), 4)],
    kOLS: round(wcov(P, all, "du", "de") / wcov(P, all, "du", "du"), 4),
    firstStage: round(wcov(P, all, "dz", "du") / wcov(P, all, "dz", "dz"), 3),
    pairs: n,
    lambda: round(lam(k), 4),
    lambdaCI: [round(lam(q(0.975)), 4), round(lam(q(0.025)), 4)],
  };
}

const check = process.argv.includes("--check");
const lga = JSON.parse(fs.readFileSync(path.join(DATA, "league-averages.json"), "utf8"));
const seasons = fs.readdirSync(DATA)
  .filter((f) => /^regular-season-\d{4}-\d{2}\.json$/.test(f))
  .map((f) => f.replace(/^regular-season-|\.json$/g, ""))
  .sort();

const out = {};
const rows = [];
const replBySeason = new Map();
for (const season of seasons) {
  const players = JSON.parse(fs.readFileSync(path.join(DATA, `regular-season-${season}.json`), "utf8")).players || [];
  const f = fitSeason(players);
  if (!f) { console.warn(`  !! ${season}: no usable rows — skipped`); continue; }
  const muUsg = weightedMedianRate(players, usg);
  const atMedian = f.a + f.b * muUsg;
  const muPts = lga[season]?.laPTSperM ?? null;
  // A season whose line lands nowhere near its own median-minute scoring rate
  // means a mis-parsed source table on one side or the other. The band is
  // wide (mu_PTS itself is gated to 0.33-0.52); this catches junk, not drift.
  if (!(atMedian > 0.3 && atMedian < 0.6)) {
    console.warn(`  !! ${season}: line at median usage = ${atMedian.toFixed(4)} — implausible, skipped`);
    continue;
  }
  out[season] = {
    a: round(f.a, 8), b: round(f.b, 8),
    r2: round(f.r2, 4), n: f.n, mp: f.mp,
    muUsg: round(muUsg, 6),
    atMuUsg: round(atMedian, 6),
  };
  rows.push({ season, ...f, muUsg, atMedian, muPts });
  if (muPts > 0 && muUsg > 0) replBySeason.set(season, replacementRows(players, muUsg, muPts / muUsg));
}

console.log("season    a        b       R^2    med USG/m  line@med   mu_PTS    diff    n");
for (const r of rows) {
  console.log(
    `${r.season}  ${r.a.toFixed(4)}  ${r.b.toFixed(4)}  ${r.r2.toFixed(3)}  ` +
    `${r.muUsg.toFixed(4)}     ${r.atMedian.toFixed(4)}  ` +
    `${r.muPts == null ? "   -  " : r.muPts.toFixed(4)}  ` +
    `${r.muPts == null ? "   -  " : (r.atMedian - r.muPts >= 0 ? "+" : "") + (r.atMedian - r.muPts).toFixed(4)}  ${r.n}`
  );
}
const diffs = rows.filter((r) => r.muPts != null).map((r) => r.atMedian - r.muPts);
if (diffs.length) {
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const worst = diffs.reduce((m, d) => (Math.abs(d) > Math.abs(m) ? d : m), 0);
  console.log(`\n${rows.length} seasons, ${rows.reduce((s, r) => s + r.n, 0)} player-seasons.`);
  console.log(`At median usage the fit sits ${mean >= 0 ? "+" : ""}${mean.toFixed(4)} from mu_PTS on average ` +
              `(worst ${worst >= 0 ? "+" : ""}${worst.toFixed(4)}) — the median-usage player is scored the same either way.`);
}

const replacement = fitReplacement(replBySeason);
if (replacement) {
  console.log(`\nReplacement possession: k = ${replacement.k} (95% ${replacement.kCI.join(" to ")}), ` +
    `plain FD ${replacement.kOLS}, first stage ${replacement.firstStage}, ${replacement.pairs} player pairs`);
  console.log(`  -> e_m = ${(1 + replacement.k).toFixed(3)} x e-bar, lambda* = ${replacement.lambda} ` +
    `(95% ${replacement.lambdaCI.join(" to ")})`);
}

if (check) { console.log("\n--check: nothing written."); process.exit(0); }

// The season in progress is fit elsewhere (lib/season-to-date.js, baked with
// `inSeason: true`) from a table this script never reads; carry it over rather
// than silently dropping it on a refit.
const prior = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")).seasons || {} : {};
for (const [season, m] of Object.entries(prior)) {
  if (m?.inSeason && !out[season]) out[season] = m;
}

fs.writeFileSync(OUT, JSON.stringify({
  ftaWeight: FTA_W,
  fit: "minutes-weighted OLS of PTS/MP on (FGA + 0.475*FTA)/MP, per season, over that season's regular-season player-seasons",
  generatedAt: new Date().toISOString(),
  replacement: replacement && {
    fit: "pooled first-difference IV of relative efficiency on relative usage, instrumented by teammates' usage rate; same-team consecutive seasons, >=500 MP and >=50 poss. used both years, weighted by the smaller MP; 95% CI by bootstrap",
    ...replacement,
  },
  seasons: out,
}, null, 2) + "\n");
console.log(`\nwrote ${path.relative(ROOT, OUT)} (${Object.keys(out).length} seasons)`);
