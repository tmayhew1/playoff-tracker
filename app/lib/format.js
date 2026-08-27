import TEAM_COLORS from "../data/team-colors.json";
import TEAM_ALT_COLORS from "../data/team-colors-alt.json";

// Isomorphic (no "use client"): these are pure string and colour helpers with
// no React or DOM in them, and /api/legacy/runs needs normalizeName on the
// server so its search matches the client's spelling exactly. A client
// directive here would hand that route a client reference instead.

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


// Given name / surname, split the way shortName splits ("Shai
// Gilgeous-Alexander" -> { first: "Shai", last: "Gilgeous-Alexander" },
// "Tim Hardaway Jr." -> { first: "Tim", last: "Hardaway Jr." }). A
// single-token name is all surname, so a stacked cell renders one line.
export function splitName(name) {
  const full = (name || "").trim();
  const last = shortName(full);
  const first = last && full.endsWith(last) ? full.slice(0, full.length - last.length).trim() : "";
  return { first, last: last || full };
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

// The rule a below-replacement row wears down its right edge, on both Explore
// boards. A negative row already swaps its bar to a red wash, but a team whose
// primary color IS red — Houston, Toronto, Miami — fills its POSITIVE rows with
// nearly that same wash, so on those rosters the tint can't be read as a sign.
// The rule sits out at the far right where a negative row's stub of a bar never
// reaches, and it is the same color on every team.
export const NEGATIVE_EDGE = withAlpha("#dc2626", 0.45);


// --- Color math (OKLab) ------------------------------------------------------
// The comparison palette has to answer "do these two colors read apart?" and
// "what is this color, but paler / but dark enough to read as text?" — both
// perceptual questions that sRGB arithmetic answers badly (mixing a navy
// toward white in sRGB goes through a muddy blue-gray, and RGB distance calls
// two navies as far apart as a navy and an orange). OKLab is a perceptual
// space where a straight line is a plausible blend and a distance is roughly
// how different two colors look, so every helper below works in it.

const hexToRgb = (hex) => {
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isFinite(n) && full.length === 6
    ? [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    : [0, 0, 0];
};

const rgbToHex = (rgb) => "#" + rgb
  .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0"))
  .join("");

const toLinear = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (c) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

// sRGB hex -> OKLab [L, a, b]. L is 0 (black) to 1 (white); a/b carry the hue
// and how saturated it is (both roughly within ±0.4).
export function toOklab(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

// OKLab -> sRGB hex, clamped back into gamut (a pale or darkened team color can
// land just outside it, and clipping the channel is the right answer there).
export function fromOklab([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return rgbToHex([
    fromLinear(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ]);
}

// How far apart two colors look. Lightness is halved because these colors meet
// as small shapes side by side — a bar's outline against another bar's fill —
// where hue is what separates them and a lighter navy still reads as "the same
// blue as his". Two mid-blues score ~0.1; a purple and a gold, ~0.5.
export function colorDistance(x, y) {
  const [l1, a1, b1] = toOklab(x);
  const [l2, a2, b2] = toOklab(y);
  return Math.hypot((l1 - l2) * 0.5, a1 - a2, b1 - b2);
}

// The same color, paler: lightness lifted toward white with the chroma left
// alone, so it stays recognizably that color rather than becoming a pastel of
// it. This is the wash inside the comparison bars and behind its chips — at
// 0.3 an amber-500 lands on the amber-400 the card used to fill them with.
export function lighten(hex, amount) {
  const [L, A, B] = toOklab(hex);
  return fromOklab([L + (1 - L) * Math.max(0, Math.min(1, amount)), A, B]);
}

// Blend toward white — `amount` 0 keeps the color, 1 is white. Used to work out
// what a translucent color actually looks like over the card's white.
export function tint(hex, amount) {
  const [L, A, B] = toOklab(hex);
  const t = Math.max(0, Math.min(1, amount));
  return fromOklab([L + (1 - L) * t, A * (1 - t), B * (1 - t)]);
}

const relLuminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// WCAG contrast ratio, 1 (identical) to 21 (black on white).
export function contrastRatio(x, y) {
  const a = relLuminance(x), b = relLuminance(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// The same color, darkened just far enough to be readable as text on `bg`.
// A team's own color is often too pale to set type in (a Lakers gold, a Suns
// orange), and swapping in a neutral gray would throw away the identity the
// comparison is being colored by — so we walk its lightness down instead and
// keep the hue.
export function readableOn(hex, bg, minRatio = 4.5) {
  const [L, A, B] = toOklab(hex);
  let out = hex;
  for (let l = L; l > 0.1; l -= 0.03) {
    out = fromOklab([l, A, B]);
    if (contrastRatio(out, bg) >= minRatio) return out;
  }
  return out;
}


// --- Comparison side color ---------------------------------------------------
// The compared player's side of a Compare card used to be gold everywhere, so
// it read as "the thing measured against" rather than as a team. Instead, give
// it a color of its own that stays legible against whoever it is sitting next
// to: many franchises have a second identity color as far from the first as
// anything on the floor (Lakers purple/gold, Suns purple/orange, Knicks
// blue/orange), and when the primary collides with the other side's — Gasol's
// Lakers purple against Stoudemire's Suns purple — the alternate is the one
// that keeps the two runs apart.
export const teamAltColor = (tri) => TEAM_ALT_COLORS[tri] || null;

// How much further from the other side the alternate has to be before it takes
// over. Small, but not zero: the primary is the team's color, and it should not
// lose the side to a rounding difference.
const ALT_GAIN = 0.04;

// Below this the two sides are the same color to the eye — one navy against
// another — and neither of the team's own colors can fix it. The card falls
// back to its old gold there, which is nobody's team and therefore always apart.
const MIN_SEPARATION = 0.17;

// Which color the comparison side wears against `against` (the other side's
// color). Returns the color and which of the three it came from, so a caller
// can explain the choice.
export function compareColor(tri, against) {
  const primary = teamColor(tri);
  const alt = teamAltColor(tri);
  if (!against) return { color: primary, source: "primary" };
  const dPrimary = colorDistance(primary, against);
  const dAlt = alt ? colorDistance(alt, against) : -1;
  const useAlt = alt && dAlt > dPrimary + ALT_GAIN;
  const best = useAlt ? dAlt : dPrimary;
  if (best < MIN_SEPARATION) return { color: GOLD, source: "gold" };
  return { color: useAlt ? alt : primary, source: useAlt ? "alt" : "primary" };
}

// Everything the comparison side is drawn with, derived from that one color:
//   base  — bar outlines, the swatch border, the career bars' edge
//   light — the pale wash the bars are filled with (callers add their own alpha)
//   bg    — chip and value-cell background (what GOLD_BG used to be)
//   edge  — a softer base, for chip borders
//   ink   — the text color, darkened until it reads on `bg`
export function comparePalette(tri, against) {
  const { color, source } = compareColor(tri, against);
  const light = lighten(color, 0.3);
  const bg = withAlpha(light, 0.28);
  // `bg` is translucent, so what the ink actually sits on is that light color
  // 28% over the card's white — the paler surface of the two, and the one the
  // contrast walk has to clear.
  const bgOverCard = tint(light, 0.72);
  return { base: color, light, bg, edge: withAlpha(color, 0.5), ink: readableOn(color, bgOverCard), source };
}


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
