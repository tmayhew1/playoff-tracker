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
// cats render per-36 or per-game (toggle); shooting cats render made/att (pct).
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
  "Defense": [(r) => (r.stl || 0) + (r.blk || 0), "STL+BLK"],
};

// Rate label for one player-season in one category or group, respecting the toggle.
export function catRateLabel(r, key, rateMode) {
  if (CAT_SHOOTING[key]) {
    const [m, a] = CAT_SHOOTING[key](r);
    return `${m}/${a} (${a > 0 ? ((m / a) * 100).toFixed(1) : "0.0"}%)`;
  }
  const [statOf, tag] = GROUP_STAT[key] || [];
  const v = statOf ? statOf(r) : (r[CAT_COUNTING[key][0]] || 0);
  const t = tag || CAT_COUNTING[key][1];
  return rateMode === "perG"
    ? `${(v / (r.gp || 1)).toFixed(1)} ${t}/G`
    : `${((v / (r.mp || 1)) * 36).toFixed(1)} ${t}/36`;
}

// Total category (or group) VA for one stat line.
export function catVATotal(r, lgaX, key) {
  const by = valueAddByCategory(r, lgaX);
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
  const by = valueAddByCategory(r, lgaX);
  const gp = r.gp || 1;
  return VA_CATEGORY_ORDER.map((k) => (by[k] || 0) / gp);
}

// Identity match between two player-season rows (slug when both have one,
// else normalized name). Rows within a season pool are unique per player.
export function samePlayer(a, b) {
  if (a.slug && b.slug) return a.slug === b.slug;
  return normalizeName(a.name || "") === normalizeName(b.name || "");
}
