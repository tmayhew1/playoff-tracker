// Fits the Guards / Wings / Bigs role model (app/lib/role-model.js) and writes
// app/data/role-model.json.
//
// Two minutes-weighted, L2-regularized logistic regressions over every
// regular-season player-season with a shot-location split (1996-97 on) and at
// least MIN_MP minutes, each feature taken relative to its own season's league
// average (seasonBaseline):
//
//   inside  P(PF/C)  from the six shot-distance shares
//   guard   P(PG/SG) from AST and TOV shares of plays, fit only on the seasons stage 1
//           calls OUTSIDE — the split it is actually asked to make
//
// Labels are basketball-reference's listed position (primary listing). The
// model is not meant to reproduce them: it is meant to say which group a
// player's game looks like, so a listed SF who lives at the rim reads as a big
// and a listed SG who never creates reads as a wing.
//
// Usage: npm run fit:roles  [-- --check]
//   --check  prints the fit and spot checks and writes nothing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seasonBaseline, shotFeatures, playFeatures, logit, classifyRole, SHOT_KEYS } from "../app/lib/role-model.js";
import { normalizePosition } from "../app/lib/positions.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const OUT = path.join(DATA, "role-model.json");
const CHECK = process.argv.includes("--check");

const MIN_MP = 500;
const L2 = 1e-3; // per unit of (normalized) weight — light; the features are few

const ZONES = [["z03", "z03m", "z03a"], ["z310", "z310m", "z310a"], ["z1016", "z1016m", "z1016a"], ["z16xp", "z16xpm", "z16xpa"]];

// Every regular-season row with its zone attempts joined on (slug first).
function loadSeason(season) {
  const rsFile = path.join(DATA, `regular-season-${season}.json`);
  const shFile = path.join(DATA, `shooting-${season}.json`);
  if (!fs.existsSync(rsFile) || !fs.existsSync(shFile)) return null;
  const rs = JSON.parse(fs.readFileSync(rsFile, "utf8")).players || [];
  const sh = JSON.parse(fs.readFileSync(shFile, "utf8")).rs?.players || [];
  const bySlug = new Map(sh.filter((p) => p.slug).map((p) => [p.slug, p]));
  // A traded player has a TOT row plus one per team; keep the TOT line only.
  const seen = new Set();
  const rows = [];
  for (const p of rs) {
    const key = p.slug || p.name;
    if (seen.has(key)) continue;
    seen.add(key);
    const z = bySlug.get(p.slug);
    const row = { ...p, season };
    for (const [zk, mk, ak] of ZONES) { row[mk] = z?.[zk]?.fgm || 0; row[ak] = z?.[zk]?.fga || 0; }
    rows.push(row);
  }
  return rows;
}

// Minutes-weighted logistic regression on standardized features, by Newton's
// method (the problems are tiny: a handful of features, ~10k rows).
function fitLogistic(X, y, w) {
  const k = X[0].length, n = X.length;
  const W = w.reduce((a, b) => a + b, 0);
  const mu = new Array(k).fill(0), sd = new Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) mu[j] += (w[i] * X[i][j]) / W;
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) sd[j] += (w[i] * (X[i][j] - mu[j]) ** 2) / W;
  for (let j = 0; j < k; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((x) => [1, ...x.map((v, j) => (v - mu[j]) / sd[j])]);
  const beta = new Array(k + 1).fill(0);
  for (let it = 0; it < 50; it++) {
    const g = new Array(k + 1).fill(0);
    const H = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
    for (let i = 0; i < n; i++) {
      const z = Z[i].reduce((t, v, j) => t + v * beta[j], 0);
      const p = 1 / (1 + Math.exp(-z));
      const wi = w[i] / W;
      for (let a = 0; a <= k; a++) {
        g[a] += wi * (p - y[i]) * Z[i][a];
        for (let b = 0; b <= k; b++) H[a][b] += wi * p * (1 - p) * Z[i][a] * Z[i][b];
      }
    }
    for (let a = 1; a <= k; a++) { g[a] += L2 * beta[a]; H[a][a] += L2; }
    const step = solve(H, g);
    let maxStep = 0;
    for (let a = 0; a <= k; a++) { beta[a] -= step[a]; maxStep = Math.max(maxStep, Math.abs(step[a])); }
    if (maxStep < 1e-9) break;
  }
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  return { b0: r6(beta[0]), w: beta.slice(1).map(r6), mu: mu.map(r6), sd: sd.map(r6) };
}

// Gaussian elimination with partial pivoting.
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

const seasons = fs.readdirSync(DATA)
  .map((f) => f.match(/^shooting-(\d{4}-\d{2})\.json$/)?.[1]).filter(Boolean).sort();
const bySeason = new Map();
for (const s of seasons) { const rows = loadSeason(s); if (rows) bySeason.set(s, rows); }
const bases = new Map([...bySeason].map(([s, rows]) => [s, seasonBaseline(rows)]));

// Training rows: complete seasons only (the one in progress is a few weeks'
// sample, and its listed positions are the ones we'd be predicting).
const lastSeason = seasons[seasons.length - 1];
const train = [];
for (const [s, rows] of bySeason) {
  if (s === lastSeason) continue;
  for (const r of rows) {
    const pos = normalizePosition(r.pos);
    if (!pos || (r.mp || 0) < MIN_MP) continue;
    const xs = shotFeatures(r, bases.get(s));
    const xp = playFeatures(r, bases.get(s));
    if (!xs || !xp) continue;
    train.push({ r, pos, xs, xp, w: r.mp });
  }
}

const inside = fitLogistic(train.map((t) => t.xs), train.map((t) => (t.pos === "PF" || t.pos === "C" ? 1 : 0)), train.map((t) => t.w));
const outside = train.filter((t) => logit(inside, t.xs) < 0.5);
const guard = fitLogistic(outside.map((t) => t.xp), outside.map((t) => (t.pos === "PG" || t.pos === "SG" ? 1 : 0)), outside.map((t) => t.w));
const model = {
  fit: "minutes-weighted L2 logistic regressions on season-relative features; inside = P(PF/C) from shot shares [" + SHOT_KEYS.join(", ") + "], guard = P(PG/SG) from AST and TOV shares of plays among stage-1 outside",
  generatedAt: new Date().toISOString(),
  seasons: [seasons[0], seasons[seasons.length - 2]],
  n: train.length,
  inside, guard,
};

// How well each stage recovers BR's listing (minutes-weighted).
const acc = (rows, pred, truth) => {
  let ok = 0, all = 0;
  for (const t of rows) { all += t.w; if (pred(t) === truth(t)) ok += t.w; }
  return (100 * ok / all).toFixed(1) + "%";
};
console.log(`fit on ${train.length} player-seasons, ${model.seasons.join("–")}`);
console.log("inside", JSON.stringify(inside));
console.log("guard ", JSON.stringify(guard));
console.log("stage 1 accuracy (PF/C vs rest):", acc(train, (t) => logit(inside, t.xs) >= 0.5, (t) => t.pos === "PF" || t.pos === "C"));
console.log("stage 2 accuracy (PG/SG vs SF/PF, outside):", acc(outside, (t) => logit(guard, t.xp) >= 0.5, (t) => t.pos === "PG" || t.pos === "SG"));
const share = { G: 0, W: 0, B: 0 };
for (const t of train) share[classifyRole(t.r, bases.get(t.r.season), model)] += t.w;
const tot = share.G + share.W + share.B;
console.log("minutes by role:", Object.fromEntries(Object.entries(share).map(([k, v]) => [k, (100 * v / tot).toFixed(1) + "%"])));
for (const name of ["LaMelo Ball", "Nikola Jokić", "Jaylen Brown", "Stephen Curry", "LeBron James", "Giannis Antetokounmpo", "Kevin Durant", "Draymond Green", "Rudy Gobert", "Jayson Tatum", "Chris Paul", "Mikal Bridges", "Shaquille O'Neal", "Kawhi Leonard", "Ben Simmons", "Brook Lopez"]) {
  const line = [];
  for (const [s, rows] of bySeason) {
    const r = rows.find((x) => x.name === name);
    if (r && r.mp >= MIN_MP) line.push(`${s.slice(5)}${classifyRole(r, bases.get(s), model)}`);
  }
  if (line.length) console.log(name.padEnd(22), line.join(" "));
}

if (!CHECK) {
  fs.writeFileSync(OUT, JSON.stringify(model, null, 2) + "\n");
  console.log("wrote", path.relative(ROOT, OUT));
}
