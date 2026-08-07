"use client";

import { LEAGUE_AVERAGES, ZONES, hasZoneData, lgaForSeason, valueAddByCategory } from "../scoring";
import { seasonTag } from "./format";


// --- Multi-season aggregates -------------------------------------------------
// A "multi-season" selection (By Player's # column) collapses several of one
// player's seasons into ONE synthetic row measured against ONE synthetic
// league baseline, so a three-year run can be compared to another player's
// three-year run as a single line rather than three side-by-side ones.
//
// The baseline is blended by the PLAYER'S OWN volume in each season — each
// season's league rate weighted by the denominator that rate divides. For
// three-point percentage that is exactly
//
//   la3P* = Σ(la3P_s · 3PA_s) / Σ 3PA_s
//
// which makes the aggregate's 3-point VA
//
//   3 · (Σ3PM − Σ la3P_s·3PA_s)   ==   3PVA_2024 + 3PVA_2025 + 3PVA_2026
//
// identical to summing the seasons' own era-fair VA. The same holds for
// Points and the other two shooting categories: every term there is linear in
// the season's volume, so a volume-weighted baseline reproduces the per-season
// sum exactly.
//
// The remaining six categories are NOT linear that way. Assists, Steals,
// Blocks and Turnovers each scale their surplus by league constants
// (laPTSperPoss, laPTSperMake, laFG, laDRBrate) that would have to be weighted
// by the SIGNED surplus rather than by volume to reproduce the sum, and the
// two rebound categories additionally run through reboundGamma, which is
// non-linear in REB/MP by construction. Feeding the aggregate row and the
// blended baseline straight through valueAddByCategory drifts from the
// per-season sum by ~0.02% over three adjacent seasons and ~0.2% over a
// career spanning the 1970s to the 1990s — small, but it would leave the
// panel's categories not adding up to the career VA printed above them.
//
// So the aggregate carries `catVA`: the per-category VA summed from the
// seasons themselves, each against its own season's baselines. That is the
// era-fair number by definition, it reconciles exactly with the TOT VA column,
// and catVATotal() in lib/va.js prefers it whenever it's present. `lga` is
// still the real volume-weighted baseline and is what the UI DISPLAYS as the
// selection's league rate — for the shooting categories it is the very rate
// the VA above was computed against.

// Raw box-score totals that sum across seasons. Mirrors RAW_KEYS in
// /api/players (which is what put them on each season row to begin with).
export const AGG_KEYS = [
  "mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb",
  "fgm", "fga", "tpm", "tpa", "ftm", "fta",
  ...ZONES.flatMap((z) => [z.mKey, z.aKey]),
];

// Which of a season row's own numbers weights each league rate — the
// denominator that rate divides in the VA formula. Rates keyed here are
// weighted by that quantity; everything else in the league-average object is
// weighted by minutes, the denominator every per-minute term shares.
const RATE_WEIGHT = {
  la3P: (s) => s.tpa || 0,
  la2P: (s) => (s.fga || 0) - (s.tpa || 0),
  laFT: (s) => s.fta || 0,
  laFG: (s) => s.fga || 0,
};

const MP_WEIGHT = (s) => s.mp || 0;


// Shot-distance zones only exist from 1996-97 (and only where the shooting
// bake has reached), so a selection can straddle the boundary. Summing zones
// across it would produce a breakdown that silently covers only some of the
// seasons while the 2-Pointers total above it covers all of them — the parts
// would not add up to the whole. So zones are all-or-nothing for a selection:
// every season has to carry them, or the aggregate reports none.
//
// A season with no two-point attempts at all counts as covered rather than
// missing — there is nothing there to break down, so it can't be the reason
// the run loses its zone rows.
function zonesComplete(seasons) {
  return seasons.every((s) => hasZoneData(s) || (s.fga || 0) - (s.tpa || 0) <= 0);
}


// The league baseline for a set of one player's seasons: every rate in the
// season league-average object, weighted by the player's own volume behind
// that rate. A weight that sums to zero (no threes attempted across the whole
// selection, say) falls back to minutes, then to a plain mean, so the rate is
// always a real number even when the player never used it.
export function blendLeagueAverages(seasons, withZones = true) {
  const lgas = seasons.map((s) => lgaForSeason(s.season));
  if (lgas.length === 1) return lgas[0];
  // Every key any of the selected seasons defines, so a rate the bake only
  // added later still comes through.
  const keys = new Set();
  for (const l of lgas) for (const k of Object.keys(l)) if (k !== "zoneFG") keys.add(k);

  const weighted = (get, weightOf) => {
    let num = 0, den = 0;
    for (let i = 0; i < seasons.length; i++) {
      const v = get(lgas[i]);
      if (v == null) continue;
      const w = weightOf(seasons[i]);
      num += v * w;
      den += w;
    }
    return den > 0 ? num / den : null;
  };
  const mean = (get) => {
    let sum = 0, n = 0;
    for (const l of lgas) {
      const v = get(l);
      if (v != null) { sum += v; n++; }
    }
    return n > 0 ? sum / n : undefined;
  };
  const blendOne = (get, weightOf) =>
    weighted(get, weightOf) ?? weighted(get, MP_WEIGHT) ?? mean(get);

  const out = {};
  for (const k of keys) out[k] = blendOne((l) => l[k], RATE_WEIGHT[k] || MP_WEIGHT);

  // Shot-distance zones follow the same rule one level down: each zone's
  // league FG% weighted by the attempts the player took from that zone.
  // Present only when at least one selected season has a zoneFG bake, so
  // hasZoneData()-style guards elsewhere still read false for old seasons.
  if (withZones && lgas.every((l) => l.zoneFG)) {
    const zoneFG = {};
    for (const z of ZONES) {
      const v = blendOne((l) => l.zoneFG?.[z.key], (s) => s[z.aKey] || 0);
      if (v != null) zoneFG[z.key] = v;
    }
    if (Object.keys(zoneFG).length) out.zoneFG = zoneFG;
  }
  return out;
}


// "’24" for one season, "’24–’26" for a contiguous span, "’24·’26·’28" for a
// selection with gaps (capped, so a 12-season pick stays chip-sized).
export function seasonSpanLabel(seasons) {
  const yrs = [...seasons].map((s) => s.season).sort();
  if (yrs.length === 0) return "";
  if (yrs.length === 1) return seasonTag(yrs[0]);
  const startYear = (s) => parseInt(s.slice(0, 4), 10);
  const contiguous = yrs.every((s, i) => i === 0 || startYear(s) === startYear(yrs[i - 1]) + 1);
  if (contiguous) return `${seasonTag(yrs[0])}–${seasonTag(yrs[yrs.length - 1])}`;
  if (yrs.length <= 3) return yrs.map(seasonTag).join("·");
  return `${seasonTag(yrs[0])}–${seasonTag(yrs[yrs.length - 1])} (${yrs.length})`;
}


// The team the selection is colored by: the one the player logged the most
// minutes for across the selected seasons. A selection inside one franchise —
// the common case — just gets that team.
function dominantTeam(seasons) {
  const byTeam = new Map();
  for (const s of seasons) {
    if (!s.team) continue;
    byTeam.set(s.team, (byTeam.get(s.team) || 0) + (s.mp || 0));
  }
  let best = null, bestMp = -1;
  for (const [t, mp] of byTeam) if (mp > bestMp) { best = t; bestMp = mp; }
  return best;
}


// Collapse a player's selected season rows into one aggregate row shaped like
// an ordinary player-season, so every existing consumer (compareStatRows,
// catVATotal, perGameVAVec, shootProfileVec, the percentile pool) reads it
// without special-casing. `identity` carries the owning player's name/slug.
//
// The extra fields on top of a normal row:
//   multi      — true, the flag callers branch on
//   seasons    — the source rows, ascending, so the career chart and the
//                D-Rating layer can still work season by season
//   seasonKeys — Set of the selected season strings, for highlighting
//   lga        — the volume-weighted baseline (blendLeagueAverages)
//   catVA      — exact per-category VA, summed from the seasons themselves
//   spanLabel  — "’24–’26"
// `season` is set to the LATEST selected season rather than a made-up span
// string: it's a real season, so any code path that reaches for
// lgaForSeason(row.season) degrades to a sane baseline instead of the default
// one. Display goes through spanLabel.
export function aggregateSeasons(seasonRows, identity = {}) {
  const seasons = [...seasonRows].sort((a, b) => a.season.localeCompare(b.season));
  const row = {
    name: identity.name || seasons[0]?.name || "",
    slug: identity.slug || seasons[0]?.slug || null,
    team: dominantTeam(seasons),
    teams: [...new Set(seasons.map((s) => s.team).filter(Boolean))],
    season: seasons[seasons.length - 1]?.season || null,
    gp: 0,
    va: 0,
  };
  for (const k of AGG_KEYS) row[k] = 0;
  for (const s of seasons) {
    row.gp += s.gp || 0;
    row.va += s.va || 0;
    for (const k of AGG_KEYS) row[k] += s[k] || 0;
  }
  row.vaPerG = row.gp > 0 ? row.va / row.gp : 0;

  // Era-fair per-category totals: each season against its own baselines.
  // These are what catVATotal() reads, so the panel's categories sum to the
  // same VA the career table shows.
  const catVA = {};
  for (const s of seasons) {
    const by = valueAddByCategory(s, lgaForSeason(s.season));
    for (const k of Object.keys(by)) catVA[k] = (catVA[k] || 0) + by[k];
  }

  // Partial zone coverage is dropped rather than shown against a subset of
  // the run (see zonesComplete). Zeroing the row's zone fields is what makes
  // hasZoneData() read false downstream, which is the guard every zone
  // consumer already honors.
  const zonesOk = zonesComplete(seasons);
  if (!zonesOk) for (const z of ZONES) { row[z.mKey] = 0; row[z.aKey] = 0; }

  row.multi = true;
  row.seasons = seasons.map((s) => ({ ...s, name: row.name, slug: row.slug }));
  row.seasonKeys = new Set(seasons.map((s) => s.season));
  row.lga = blendLeagueAverages(seasons, zonesOk);
  row.catVA = catVA;
  row.spanLabel = seasonSpanLabel(seasons);
  return row;
}


// The baseline a row is measured against: an aggregate carries its own blended
// one, an ordinary season row looks its season up.
export function lgaForRow(row) {
  return row?.lga || lgaForSeason(row?.season) || LEAGUE_AVERAGES["2025-26"];
}


// Display label for a row's season(s) — a span for an aggregate, the plain
// season tag otherwise.
export function rowSeasonLabel(row) {
  return row?.multi ? row.spanLabel : seasonTag(row?.season);
}
