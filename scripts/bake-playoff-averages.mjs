// Bakes app/data/playoff-league-averages.json — the same league baselines
// league-averages.json carries, measured over PLAYOFF minutes instead of
// regular-season ones.
//
// Why this file exists. VA scores a stat line against "what a typical league
// minute produced" (spec §4.1), and until now that typical minute was always a
// REGULAR-SEASON one, on both sides of the season. But playoff basketball is
// measurably not regular-season basketball: over the 46 baked seasons the
// median playoff MINUTE scores 3.8% less than the median regular-season minute
// (0.0161 pts/min, ~6.6 standard errors from zero, and negative in 38 of 46
// seasons), assists run ~5% lower, and 2P% is lower in most seasons. Scoring a
// playoff run against a regular-season bar therefore charged every playoff
// player for a level of production the playoffs do not produce. See
// docs/value-added-spec.md §4.8 for the measurement and what is done with it.
//
// No network. Every input is already on disk:
//   leaderboard-<season>.json  per-player playoff totals (the same rows the
//                              board ranks), which is exactly the shape
//                              lga_from_players wants.
//   shooting-<season>.json     `po.leagueAvg`, the playoff shot-distance
//                              split, for the zoneFG rates (1996-97+).
//
// KEEP IN SYNC with scripts/R/scrape_common.R::lga_from_players — this is the
// same definition (minutes-weighted MEDIAN per-minute rates; aggregate ratios
// for the conversion constants), just fed playoff rows. recompute_derived.R
// rebuilds this file on the R side after every daily bake.
//
// Usage:
//   node scripts/bake-playoff-averages.mjs [--check] [--window=N]
//
//   --check     report what would change without writing
//   --window=N  average each season's playoff rates over a centered N-season
//               window before writing (N must be odd; default 1 = off). The
//               playoff field is ~7% of a regular season's minutes, so a single
//               season's playoff median carries real sampling noise — see the
//               note on PLAYOFF_WINDOW in app/scoring.js.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const OUT = path.join(DATA, "playoff-league-averages.json");

const args = process.argv.slice(2);
const check = args.includes("--check");
const window = Number((args.find((a) => a.startsWith("--window=")) || "--window=1").slice(9));
if (!Number.isInteger(window) || window < 1 || window % 2 === 0) {
  console.error("--window must be an odd positive integer (1 = off)");
  process.exit(1);
}

const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const exists = (f) => fs.existsSync(path.join(DATA, f));

// --- The baseline definition, mirroring scrape_common.R --------------------

// Minutes-weighted median of a per-minute rate: the rate of the median league
// MINUTE. Splits the league's minutes in half — half of all playoff minutes
// are played at a higher rate, half lower. Same estimator the regular-season
// baselines use, so the two halves of the blend are the same statistic.
function weightedMedianRate(rows, key) {
  const pairs = rows
    .filter((p) => (p.mp || 0) > 0)
    .map((p) => [(p[key] || 0) / p.mp, p.mp])
    .sort((a, b) => a[0] - b[0]);
  if (!pairs.length) return 0;
  const total = pairs.reduce((s, [, m]) => s + m, 0);
  let cum = 0;
  for (const [rate, mp] of pairs) {
    cum += mp;
    if (cum >= total / 2) return rate;
  }
  return pairs[pairs.length - 1][0];
}

const TOTAL_KEYS = ["mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb",
  "fgm", "fga", "tpm", "tpa", "ftm", "fta"];

// Possessions a free-throw attempt uses. KEEP IN SYNC with USG_FTA_W in
// app/scoring.js and FTA_W in scripts/fit-usage-model.mjs — muUsg below is a
// median OF this quantity, and a pivot measured at one weight and read at
// another is not a pivot.
const USG_FTA_W = 0.475;

// The per-minute baselines that are minutes-weighted medians, keyed by the
// raw column they are the median rate of.
const MEDIAN_KEYS = {
  laPTSperM: "pts", laASTperM: "ast", laSTLperM: "stl", laBLKperM: "blk",
  laTOVperM: "tov", laDRBperM: "drb", laORBperM: "orb",
};

function lgaFromPlayers(rows) {
  const s = (a, b) => (b > 0 ? a / b : 0);
  const t = Object.fromEntries(TOTAL_KEYS.map((k) =>
    [k, rows.reduce((sum, p) => sum + (Number(p[k]) || 0), 0)]));
  const twoPm = t.fgm - t.tpm, twoPa = t.fga - t.tpa, reb = t.drb + t.orb;
  // Hollinger possessions: FGA - ORB + TOV + 0.475*FTA.
  const poss = t.fga - t.orb + t.tov + 0.475 * t.fta;
  const base = {
    laPOSSperM: s(5 * poss, t.mp),
    laREBoppPerM: s(5 * reb, t.mp),
    la3P: s(t.tpm, t.tpa),
    la2P: s(twoPm, twoPa),
    laFT: s(t.ftm, t.fta),
    laFG: s(t.fgm, t.fga),
    laPTSperM: s(t.pts, t.mp),
    laASTperM: s(t.ast, t.mp),
    laSTLperM: s(t.stl, t.mp),
    laBLKperM: s(t.blk, t.mp),
    laTOVperM: s(t.tov, t.mp),
    laDRBperM: s(t.drb, t.mp),
    laORBperM: s(t.orb, t.mp),
    laPTSperMake: s(t.pts, t.fgm),
    laFGPTSperMake: s(2 * twoPm + 3 * t.tpm, t.fgm),
    laPTSperPoss: s(t.pts, poss),
    laDRBrate: s(t.drb, reb),
    laORBrate: s(t.orb, reb),
  };
  for (const [out, col] of Object.entries(MEDIAN_KEYS)) base[out] = weightedMedianRate(rows, col);
  // The USG-ADJ pivot over playoff minutes: the minutes-weighted median of
  // USG/MP, the same statistic `muUsg` is in usage-model.json but measured on
  // the playoff field. USG-ADJ prices a used possession at ē = μ_PTS / ū, so a
  // playoff-blended μ_PTS read against a regular-season ū would be two
  // baselines pretending to be one (spec §4.6, §4.8). The fitted line's a and b
  // are NOT re-fit here: they feed only the Usage tab, which is regular-season
  // by construction and never sees a playoff row.
  base.muUsg = weightedMedianRate(
    rows.map((p) => ({ mp: p.mp, usg: (p.fga || 0) + USG_FTA_W * (p.fta || 0) })), "usg");
  return base;
}

// Playoff shot-distance rates, when that season's shooting split is baked.
// Same four zones and the same fgm/fga ratio the regular-season `zoneFG` uses,
// read off `po.leagueAvg` instead of `rs`.
function zoneFgFor(season) {
  if (!exists(`shooting-${season}.json`)) return null;
  const avg = read(`shooting-${season}.json`)?.po?.leagueAvg;
  if (!avg) return null;
  const out = {};
  for (const z of ["z03", "z310", "z1016", "z16xp"]) {
    const a = avg[z];
    if (!(a?.fga > 0)) return null;
    out[z] = a.fgm / a.fga;
  }
  return out;
}

// --- Build ------------------------------------------------------------------

const seasons = fs.readdirSync(DATA)
  .filter((f) => /^leaderboard-\d{4}-\d{2}\.json$/.test(f))
  .map((f) => f.slice(12, -5))
  .sort();

// The same plausibility band the regular-season bake refuses to write outside
// of (scrape_common.R::lga_plausible), widened at the bottom because playoff
// scoring genuinely runs below its season's regular-season rate.
const plausible = (l) => l?.laPTSperM > 0.30 && l.laPTSperM < 0.52;

const raw = new Map();
const skipped = [];
for (const season of seasons) {
  const rows = (read(`leaderboard-${season}.json`).players || []).filter((p) => (p.mp || 0) > 0);
  // A handful of rows is not a league. Spec invariant 5: a baseline we cannot
  // measure must be ABSENT so the blend falls back to the regular season,
  // never a wrong number quietly scored against.
  if (rows.length < 50) { skipped.push([season, `only ${rows.length} playoff rows`]); continue; }
  const lga = lgaFromPlayers(rows);
  if (!plausible(lga)) { skipped.push([season, `implausible laPTSperM=${lga.laPTSperM.toFixed(4)}`]); continue; }
  lga._mp = rows.reduce((s, p) => s + p.mp, 0);
  lga._players = rows.length;
  raw.set(season, lga);
}

// Optional centered smoothing over neighbouring playoff fields. Minutes-
// weighted, so a short 1980s bracket does not outvote a modern one, and
// applied only to seasons with a full window on both sides — an edge season
// smoothed over a truncated window would be a different estimator wearing the
// same name.
const NUMERIC = (l) => Object.keys(l).filter((k) => !k.startsWith("_") && typeof l[k] === "number");
function smooth(season, idx, list) {
  if (window === 1) return raw.get(season);
  const half = (window - 1) / 2;
  const members = [];
  for (let i = idx - half; i <= idx + half; i++) {
    const s = list[i];
    if (i < 0 || i >= list.length || !raw.has(s)) return raw.get(season);
    members.push(raw.get(s));
  }
  const self = raw.get(season);
  const out = { ...self };
  for (const k of NUMERIC(self)) {
    let num = 0, den = 0;
    for (const m of members) { num += m[k] * m._mp; den += m._mp; }
    out[k] = num / den;
  }
  return out;
}

const built = [...raw.keys()].sort();
const out = {};
for (const season of built) {
  const lga = smooth(season, built.indexOf(season), built);
  const entry = {};
  for (const k of Object.keys(lga)) if (!k.startsWith("_")) entry[k] = lga[k];
  const zone = zoneFgFor(season);
  if (zone) entry.zoneFG = zone;
  // What the estimate rests on, so a consumer (and a reader of the diff) can
  // see how thin a season's playoff field was.
  entry.mp = raw.get(season)._mp;
  entry.players = raw.get(season)._players;
  out[season] = entry;
}

const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
const body = JSON.stringify(out, null, 2) + "\n";
const changed = !prev || JSON.stringify(prev) !== JSON.stringify(out);
if (!check) fs.writeFileSync(OUT, body);

for (const [season, why] of skipped) console.log(`  skip ${season} — ${why}`);
console.log(`${check ? "would write" : "wrote"} ${path.relative(ROOT, OUT)}: ${built.length} season(s)` +
  `${window > 1 ? `, ${window}-season centered window` : ""}${changed ? "" : " (no change)"}`);
