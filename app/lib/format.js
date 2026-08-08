"use client";

import TEAM_COLORS from "../data/team-colors.json";

// Per-team primary color (hex). Used in Explore and anywhere we don't have
// an owner mapping (e.g. defunct/renamed franchises in old seasons).
export const teamColor = (tri) => TEAM_COLORS[tri] || "#78716c";

export const withAlpha = (hex, alpha) => {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
  return hex + a;
};


// Loose name match for joining ESPN box-score names with basketball-reference
// names (regular-season reference tick). Strips punctuation, suffixes like
// "Jr."/"III", collapses whitespace, and folds diacritics so "P.J. Tucker"
// matches "PJ Tucker" and "Luka Dončić" matches "Luka Doncic".
export const normalizeName = (s) => (s || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[.''`,]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");


// `dim` = lighten owner styling when both teams in a matchup share an owner,
// to flag the side that wins the series for fewer points (no upset bonus).
export const ownerColor = (o, dim) => {
  if (o === "Spencer") return dim ? "text-amber-400" : "text-amber-700";
  if (o === "Trey") return dim ? "text-teal-400" : "text-teal-700";
  return "";
};

export const ownerBg = (o) => o === "Spencer" ? "bg-amber-50 border-amber-300" : "bg-teal-50 border-teal-300";

export const ownerDot = (o, dim) => {
  if (o === "Spencer") return dim ? "bg-amber-300" : "bg-amber-600";
  if (o === "Trey") return dim ? "bg-teal-300" : "bg-teal-600";
  return "";
};

export const ownerBadge = (o) => o === "Spencer" ? "bg-amber-100 text-amber-800" : o === "Trey" ? "bg-teal-100 text-teal-800" : "bg-stone-100 text-stone-600";


export function timeAgo(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}


// Top college players for the season, ranked by Value Added. Data comes from
// /api/college (baked by scripts/R/fetch_college.R via the bake-college run).
// Per-category VA breakdown for one college player, mirroring the NBA
// VABreakdown: diverging +/- bars (per-GAME contribution above/below the D-I
// average), grouped with separators, plus a Per 36 / Per G stat-label toggle.
// "’26" for "2025-26" — season's end year, short form.
export const seasonTag = (s) => "’" + (s || "").slice(5);


// Chip-sized surname: the last token, keeping generational suffixes attached
// ("Trey Murphy III" -> "Murphy III", "Gary Payton II" -> "Payton II",
// "Tim Hardaway Jr." -> "Hardaway Jr.").
export function shortName(name) {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length <= 1) return name || "";
  const last = parts[parts.length - 1];
  if (parts.length >= 3 && /^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(last)) {
    return parts.slice(-2).join(" ");
  }
  return last;
}


// Like shortName but prefixed with the first initial ("Trey Murphy III" ->
// "T. Murphy III"), so comp chips disambiguate same-surname players.
export function compName(name) {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length <= 1) return name || "";
  return `${parts[0].charAt(0).toUpperCase()}. ${shortName(name)}`;
}


// Compare-side gold, shared by the chip, wrappers, and highlights.
export const GOLD = "#f59e0b";                    // border-amber-500

export const GOLD_BG = withAlpha("#fbbf24", 0.28); // bg-amber-400, translucent

export const MIDNIGHT_PURPLE = "#2e1065";          // violet-950 — the VA+ accent


// Percentile display honoring significant digits at the top end: integers up
// to 99, then 99.5–99.9, then 99.95–99.99. A flat 100 is reserved for the #1
// player-season in the category (isTop).
export function formatPercentile(p, isTop) {
  if (p == null) return "–";
  if (isTop) return "100";
  if (p >= 99.95) return Math.min(p, 99.99).toFixed(2);
  if (p >= 99.5) return Math.min(p, 99.9).toFixed(1);
  return String(Math.min(Math.round(p), 99));
}
