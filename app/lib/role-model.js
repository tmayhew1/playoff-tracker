// Role groups — Guards, Wings, Bigs — read off how a player plays rather than
// the position basketball-reference lists.
//
// Two logistic stages, fit by scripts/fit-role-model.mjs and baked into
// data/role-model.json:
//
//   1. INSIDE vs OUTSIDE, from shot distribution — the share of a player's
//      shots from each of the six distances (FT trips · rim · float · mid ·
//      deep mid · 3PT, the same denominators the Shot distribution discs use).
//      Trained against BR's listing: PF/C inside, PG/SG/SF outside.
//   2. GUARD vs WING among the outside players, from AST and TOV — each as a
//      share of the plays a player finishes or sets up (see playFeatures).
//      Trained against BR's listing: PG/SG guards, SF/PF wings.
//
// Every feature is measured against its own season's league average, so the
// model reads "shoots more threes than the league did that year" rather than
// "shoots a lot of threes" — a 1999 big and a 2025 big land on the same side.
// The same functions build the features here and in the fit, so the two can't
// drift apart.

import MODEL from "../data/role-model.json";

export const ROLES = ["G", "W", "B"];
export const ROLE_LABEL = { G: "Guards", W: "Wings", B: "Bigs" };

// Shot distances, in the order the discs show them. FT attempts count as trips
// (÷ 2.2), matching the share readings in the category card.
export const SHOT_KEYS = ["ft", "z03", "z310", "z1016", "z16xp", "tp"];
const shotAtt = (r) => [
  (r.fta || 0) / 2.2, r.z03a || 0, r.z310a || 0, r.z1016a || 0, r.z16xpa || 0, r.tpa || 0,
];

// A row has a shot distribution worth reading only once it carries zone data
// (1996-97 on) — a pre-zone row is all FT and 3PT and would read as a guard.
const hasZones = (r) => ((r.z03a || 0) + (r.z310a || 0) + (r.z1016a || 0) + (r.z16xpa || 0)) > 0;

// One season's league baselines from that season's rows: shot shares pooled
// over every attempt, AST/TOV shares pooled over every play.
export function seasonBaseline(rows) {
  const att = new Array(SHOT_KEYS.length).fill(0);
  let n = 0, ast = 0, tov = 0;
  for (const r of rows) {
    if (!(r.mp > 0)) continue;
    n += plays(r); ast += r.ast || 0; tov += r.tov || 0;
    if (!hasZones(r)) continue;
    shotAtt(r).forEach((v, i) => { att[i] += v; });
  }
  const den = att.reduce((a, b) => a + b, 0);
  return {
    share: att.map((v) => (den > 0 ? v / den : 0)),
    astShare: n > 0 ? ast / n : 0,
    tovShare: n > 0 ? tov / n : 0,
  };
}

// Stage-1 features: shares minus the league's. Null without a zone split.
export function shotFeatures(r, base) {
  if (!hasZones(r)) return null;
  const a = shotAtt(r);
  const den = a.reduce((t, v) => t + v, 0);
  if (!(den > 0)) return null;
  return a.map((v, i) => v / den - base.share[i]);
}

// Possessions a line ended or set up: shots, trips, assists, turnovers. AST and
// TOV are read as shares of it, so a high-usage scorer's assists don't make him
// a guard on volume alone — what separates the groups is how much of a
// player's game is creating for others, not how big his game is.
const plays = (r) => (r.fga || 0) + 0.475 * (r.fta || 0) + (r.ast || 0) + (r.tov || 0);

// Stage-2 features: AST and TOV shares of plays minus the league's.
export function playFeatures(r, base) {
  const n = plays(r);
  if (!(r.mp > 0) || !(n > 0)) return null;
  return [(r.ast || 0) / n - base.astShare, (r.tov || 0) / n - base.tovShare];
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
export const logit = (stage, x) => {
  let z = stage.b0;
  for (let i = 0; i < x.length; i++) z += stage.w[i] * ((x[i] - stage.mu[i]) / stage.sd[i]);
  return sigmoid(z);
};

// The role of one stat line against its season's baseline: "G" | "W" | "B",
// or null when the line has no shot distribution to read.
export function classifyRole(r, base, model = MODEL) {
  const xs = shotFeatures(r, base);
  const xp = playFeatures(r, base);
  if (!xs || !xp || !model?.inside) return null;
  if (logit(model.inside, xs) >= 0.5) return "B";
  return logit(model.guard, xp) >= 0.5 ? "G" : "W";
}

// A player's role over a run of seasons: the role he played the most minutes
// in — the same minutes-weighted summary the position filter uses for careers.
// `baseFor(season)` returns that season's baseline.
export function playerRole(seasons, baseFor, model = MODEL) {
  const mins = new Map();
  for (const s of seasons) {
    const base = baseFor(s.season);
    const role = base ? classifyRole(s, base, model) : null;
    if (role) mins.set(role, (mins.get(role) || 0) + (s.mp || 0));
  }
  let best = null, bestMp = -1;
  for (const [role, mp] of mins) if (mp > bestMp) { best = role; bestMp = mp; }
  return best;
}
