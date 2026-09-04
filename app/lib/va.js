"use client";

import { valueAddByCategory } from "../scoring";
import { normalizeName } from "./format";


// Fixed display order for the breakdown rows. Partition dividers go AFTER
// each key in PARTITIONS_AFTER (shooting / playmaking / rebounding groups).
export const VA_CATEGORY_ORDER = [
  "Points", "2-Pointers", "3-Pointers", "Free Throws",
  "Assists", "Turnovers",
  "D Rebounds", "O Rebounds",
  "Blocks", "Steals",
];

export const VA_PARTITIONS_AFTER = new Set(["Free Throws", "Turnovers", "O Rebounds"]);


// --- Category context (By-Player search only) -------------------------------
// Maps a breakdown category to the raw stat(s) needed to show its rate. Counting
// cats render per-36 or per-game (toggle); shooting cats render made/att (pct),
// with the made/att also following the per-36 / per-game toggle.
export const CAT_COUNTING = {
  "Points": ["pts", "PTS"], "Assists": ["ast", "AST"], "Steals": ["stl", "STL"],
  "Blocks": ["blk", "BLK"], "Turnovers": ["tov", "TOV"],
  "D Rebounds": ["drb", "DRB"], "O Rebounds": ["orb", "ORB"],
};

export const CAT_SHOOTING = {
  "3-Pointers": (r) => [r.tpm, r.tpa],
  "2-Pointers": (r) => [r.fgm - r.tpm, r.fga - r.tpa],
  "Free Throws": (r) => [r.ftm, r.fta],
};

// Short label for a category (used in headings — "Pts", "3P", etc.).
export const CAT_SHORT = {
  "Points": "Pts", "2-Pointers": "2P", "3-Pointers": "3P", "Free Throws": "FT",
  "Assists": "Ast", "Turnovers": "TO", "D Rebounds": "DReb", "O Rebounds": "OReb",
  "Blocks": "Blk", "Steals": "Stl",
  // Not one of the ten box categories — the VA+ defensive stat, which the
  // compare panel folds into Defense and heads its own charts with.
  "D Rating": "D Rtg",
};

// "Basic" grouping: the ten categories folded into the four buckets the
// detail view's dividers already imply. Order matches the on-screen groups.
export const VA_GROUPS = [
  { key: "Scoring", cats: ["Points", "2-Pointers", "3-Pointers", "Free Throws"] },
  { key: "Passing", cats: ["Assists", "Turnovers"] },
  { key: "Rebounds", cats: ["D Rebounds", "O Rebounds"] },
  { key: "Defense", cats: ["Blocks", "Steals"] },
];

export const VA_GROUP_BY_KEY = Object.fromEntries(VA_GROUPS.map((g) => [g.key, g]));

// Representative counting stat shown next to a group's summed VA.
export const GROUP_STAT = {
  "Scoring": [(r) => r.pts || 0, "PTS"],
  "Passing": [(r) => r.ast || 0, "AST"],
  "Rebounds": [(r) => (r.drb || 0) + (r.orb || 0), "REB"],
  "Defense": [(r) => (r.stl || 0) + (r.blk || 0), "STK"],
};

// Rate label for one player-season in one category or group, respecting the toggle.
export function catRateLabel(r, key, rateMode) {
  if (CAT_SHOOTING[key]) {
    const [m, a] = CAT_SHOOTING[key](r);
    // Makes/attempts follow the same per-game / per-36 toggle as counting
    // stats: divide by games (perG) or minutes/36 (per36). The percentage is
    // scale-invariant, so it's unchanged.
    const div = rateMode === "perG" ? (r.gp || 1) : ((r.mp || 1) / 36);
    return `${(m / div).toFixed(1)}/${(a / div).toFixed(1)} (${a > 0 ? ((m / a) * 100).toFixed(1) : "0.0"}%)`;
  }
  const [statOf, tag] = GROUP_STAT[key] || [];
  const v = statOf ? statOf(r) : (r[CAT_COUNTING[key][0]] || 0);
  const t = tag || CAT_COUNTING[key][1];
  return rateMode === "perG"
    ? `${(v / (r.gp || 1)).toFixed(1)} ${t}/G`
    : `${((v / (r.mp || 1)) * 36).toFixed(1)} ${t}/36`;
}

// Total category (or group) VA for one stat line.
// A multi-season aggregate (lib/multi-season.js) carries `catVA` — the per-
// category totals summed from its own seasons, each measured against its own
// season's baselines. Preferring it keeps a selection's categories adding up
// to exactly the VA the career table showed, which recomputing from the
// aggregate row and a blended baseline would miss by a fraction of a percent
// (the rebound and multiplier terms aren't linear in season volume).
export function catVATotal(r, lgaX, key) {
  const by = r?.catVA || valueAddByCategory(r, lgaX);
  const g = VA_GROUP_BY_KEY[key];
  return g ? g.cats.reduce((s, c) => s + (by[c] || 0), 0) : (by[key] || 0);
}

// Per-game category VA — the metric the context ranks/plots everything on.
export function catVAperGame(r, lgaX, key) {
  return catVATotal(r, lgaX, key) / (r.gp || 1);
}

// Per-game VA vector across all ten categories (VA_CATEGORY_ORDER), one
// valueAddByCategory call. This is the "shape" of a player-season used for the
// closest-comps similarity in the compare picker.
export function perGameVAVec(r, lgaX) {
  const by = r?.catVA || valueAddByCategory(r, lgaX);
  const gp = r.gp || 1;
  return VA_CATEGORY_ORDER.map((k) => (by[k] || 0) / gp);
}

// Identity match between two player-season rows (slug when both have one,
// else normalized name). Rows within a season pool are unique per player.
export function samePlayer(a, b) {
  if (a.slug && b.slug) return a.slug === b.slug;
  return normalizeName(a.name || "") === normalizeName(b.name || "");
}


// --- Composition tunnel ------------------------------------------------------
// A gate on WHERE a player's value comes from, applied before the cosine ever
// gets a say — the admissibility rule the closest-comps score needs and does
// not have.
//
// The cosine in §7.2 measures the angle between two 10-dimensional per-game VA
// vectors, and that vector is dominated by its largest component. For a
// high-volume scorer the Points term alone is ~95% of the vector's LENGTH, so
// the other nine categories decide ~1.5% of the angle: Wembanyama's 2025-26
// (30% of his value on the glass and at the rim) and Danny Granger's 2008-09
// (3%) come out 94% similar, because both are ~11 points of scoring volume
// above baseline per game and the cosine can barely see the rest. Length adds
// in quadrature; value adds linearly. That mismatch is the whole bug.
//
// So closeness is asked hierarchically instead, on SHARES of a player's total
// VA — each category's VA over the sum of all ten in absolute value. Signed on
// top, absolute underneath, and both halves of that matter: the numerator keeps
// value and damage apart (Mark Eaton's 1988-89 scoring is −9.7 points per game
// where Wembanyama's is +10.9, which an unsigned share would file as the same
// 50-odd percent "scoring profile"), while the denominator cannot collapse
// toward zero the way a signed total can for a player whose positives and
// negatives cancel. Two seasons are comparable only if they agree at every
// level of the split, tunnelling down:
//
//   1  offense vs defense       — is your value even in the same half of the game
//   2  scoring vs passing, rebounding vs rim protection — which part of that half
//   3  the ten categories themselves                    — which stat inside that part
//
// Shares are taken of the TOTAL at every level rather than of the parent node,
// which is what makes the deeper levels self-scaling: a blocks-vs-steals split
// inside a group worth 4% of a player's value can differ by at most 4 points
// and cannot fail a gate on its own, while the same split for a rim protector
// carries real weight and can. A level's band widens with depth because the
// levels above it have already constrained the aggregate that level sits in.
//
// Bands are hard gates in the spirit of MPG_BAND, not soft discounts like
// careerStageFactor: a season built somewhere else is not a worse comp, it is
// not a comp. They were fitted against the whole index, over every rotation
// season in it (40+ G at 20+ MPG, 9142 of them), against two competing costs —
// refusing the comps that prompted this, and leaving a reader with nothing.
// At these bands 99.1% of those seasons still find candidates in all five
// decades and none is left with no comp at all, while Wembanyama's 2025-26 vs
// Granger's 2008-09 — 30% of a season's value on the glass and at the rim
// against 3% — is refused at level 1 by 26.9 points against a 20-point band.
// Widening them further buys almost nothing (99.6% at 0.22/0.25/0.30) and
// starts admitting the pure scorers back; tightening to 0.15/0.18/0.22 costs
// 16 seasons their comps entirely for no gain in what the top of a list says.

// The two halves of level 1. O Rebounds rides with the glass rather than with
// scoring: the question this split asks is how much of a player's value comes
// from putting the ball in the basket and moving it, versus from the glass and
// the rim.
const TUNNEL_SIDES = {
  "Offense": ["Scoring", "Passing"],
  "Defense": ["Rebounds", "Defense"],
};

const CAT_INDEX = Object.fromEntries(VA_CATEGORY_ORDER.map((k, i) => [k, i]));
const catsOfGroup = (g) => VA_GROUP_BY_KEY[g].cats.map((c) => CAT_INDEX[c]);

// One level of the tunnel: the band its shares must agree within, and the
// nodes at that depth as [label, category indices]. Built from VA_GROUPS so a
// change to the grouping can never leave the tunnel describing a different
// tree than the breakdown does.
export const VA_TUNNEL_LEVELS = [
  {
    band: 0.20,
    nodes: Object.entries(TUNNEL_SIDES).map(([side, groups]) => [side, groups.flatMap(catsOfGroup)]),
  },
  {
    band: 0.22,
    nodes: VA_GROUPS.map((g) => [g.key, catsOfGroup(g.key)]),
  },
  {
    band: 0.28,
    nodes: VA_CATEGORY_ORDER.map((k) => [k, [CAT_INDEX[k]]]),
  },
];

// A per-game VA vector as the share of value sitting at each node of the
// tunnel, level by level. Shares are signed and run [-1, 1]; they sum, over a
// level, to the season's VA as a fraction of the value it moved either way.
// Null for a row with no value to apportion (an all-zero vector), which
// tunnelBreak reads as "nothing to say" rather than as a mismatch — the same
// rule careerStageFactor uses for an unknown career stage.
export function vaComposition(vec) {
  const total = vec.reduce((s, x) => s + Math.abs(x), 0);
  if (!(total > 0)) return null;
  return VA_TUNNEL_LEVELS.map(({ nodes }) =>
    nodes.map(([, idxs]) => idxs.reduce((s, i) => s + vec[i], 0) / total));
}

// Why two compositions are not comparable, or null when they are. Reports the
// SHALLOWEST level that fails and, within it, the node that fails widest — the
// point where the tunnel closes, which is the honest answer to "why isn't this
// a comp" and the one worth showing a reader.
export function tunnelBreak(a, b) {
  if (!a || !b) return null;
  for (let lv = 0; lv < VA_TUNNEL_LEVELS.length; lv++) {
    const { band, nodes } = VA_TUNNEL_LEVELS[lv];
    let worst = null;
    for (let i = 0; i < nodes.length; i++) {
      const gap = Math.abs(a[lv][i] - b[lv][i]);
      if (gap > band && (!worst || gap > worst.gap)) worst = { level: lv + 1, node: nodes[i][0], gap, band };
    }
    if (worst) return worst;
  }
  return null;
}
