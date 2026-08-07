"use client";

import { LEAGUE_AVERAGES, ZONES, hasZoneData, lgaForSeason, valueAddByCategory } from "../scoring";
import { normalizeName, seasonTag } from "./format";
import { VA_CATEGORY_ORDER, perGameVAVec } from "./va";


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


// --- Matching a run by career year ------------------------------------------
// The compare picker's BEST/YEAR switch. BEST pre-ticks the other player's top
// seasons by VA; YEAR pre-ticks the same CAREER YEARS the selection occupies —
// a player's 3rd through 6th seasons against another's 3rd through 6th, rather
// than his peak against the other's peak.
//
// `selfYears` are 1-based indices into the selecting player's own career
// (season 1 = rookie year), `selfLen` is how many seasons that career runs to,
// and `otherLen` is the compared player's. Returns 1-based indices into the
// compared player's career, one per requested year, in the order asked for.
//
// Two rules, in order:
//
//  1. Same career year, when the other player's career reaches it. Picking
//     someone's first three years should land on the other's first three,
//     whether he played 4 more or 20.
//
//  2. When it does NOT reach — the run sits past the end of a shorter career —
//     the two careers line up by their FINAL season instead, shifting every
//     index back by (selfLen − otherLen). So against a 15-season career,
//     LeBron's years 22-23 become that player's last two, and his 21-22 become
//     the 3rd- and 2nd-to-last. The alternative (shifting back only far enough
//     to fit) would have made both of those the last two, collapsing the
//     distinction between "his final years" and "his second-to-last stretch".
//
// Whatever the shift leaves is then pulled to the CLOSEST career year still
// unused, which is what keeps the two runs the same length when a shift lands
// outside the career entirely — and what stops two requested years from
// collapsing onto one season. A career shorter than the selection simply
// returns as many seasons as it has.
export function matchCareerYears(selfYears, selfLen, otherLen) {
  const want = [...selfYears].sort((a, b) => a - b);
  if (!want.length || !(otherLen > 0)) return [];
  const shift = Math.max(...want) <= otherLen ? 0 : selfLen - otherLen;
  const used = new Set();
  const out = [];
  for (const y of want) {
    const target = y - shift;
    let best = null, bestDist = Infinity;
    for (let i = 1; i <= otherLen; i++) {
      if (used.has(i)) continue;
      const dist = Math.abs(i - target);
      // Ties break low — the earlier season — so a target falling between two
      // free years resolves the same way every time.
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    if (best == null) break; // career exhausted: fewer seasons than asked for
    used.add(best);
    out.push(best);
  }
  return out.sort((a, b) => a - b);
}


// 1-based career-year indices of the selected seasons within a full career.
// Career year is position in the player's own chronology, so both sides are
// read off their seasons sorted oldest-first.
export function careerYearsOf(allSeasons, pickedSeasonKeys) {
  const asc = [...allSeasons].sort((a, b) => a.season.localeCompare(b.season));
  const out = [];
  asc.forEach((s, i) => { if (pickedSeasonKeys.has(s.season)) out.push(i + 1); });
  return out;
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


// --- Similar runs ------------------------------------------------------------
// What the multi-season compare picker opens on: other players' N-season runs
// closest to the selection, N being however many seasons the selection pools.
// The single-season picker leads with closest comps for exactly this reason —
// "who does this look like" is the question you have before you have a name —
// and a run deserves the same answer, just measured over the whole run.
//
// Closeness is the same score the season comps use: cosine of the two per-game
// VA-by-category vectors (does the value come from the same places) × the
// ratio of their magnitudes (is it the same amount of value). Both sides are
// summed from seasons measured against their OWN season's baselines, so the
// comparison is era-fair the way an aggregate row's `catVA` is — a 3-year run
// in 1988 and one in 2024 are each scored against the league they played in.
//
// A "run" here is N seasons adjacent in the player's own career list, after
// seasons too short to say anything (RUN_MIN_GP) are dropped. Career
// adjacency, not calendar adjacency: Jordan's 1992-93 and 1994-95 sit next to
// each other in his career with a retirement in between, and the span label
// prints the gap rather than hiding it. The selection on the other side is
// free to skip a year the same way — the By Player table lets you tick any
// seasons you like.
//
// One run per player: the best-scoring window. Overlapping windows of one
// career (’11–’13, ’12–’14, ’13–’15) are near-copies of each other and would
// crowd every other player out of the list.
export const RUN_MIN_GP = 8;    // a season shorter than this can't carry a run
export const RUN_MPG_BAND = 7;  // same minutes-role gate the season comps use
export const RUN_MIN_COS = 0.3; // below this it's a different archetype, not a comp

export function similarRuns(players, selfRow, { runLen = 1, selfKey = null, perDecade = 8 } = {}) {
  const n = Math.max(1, Math.round(runLen));
  if (!players?.length || !selfRow || !(selfRow.gp > 0) || !(selfRow.mp > 0)) return [];
  const qVec = perGameVAVec(selfRow, lgaForRow(selfRow));
  const qNorm = Math.hypot(...qVec);
  if (!qNorm) return [];
  const qMPG = selfRow.mp / selfRow.gp;
  const dim = VA_CATEGORY_ORDER.length;

  const byDecade = new Map(); // decade -> best run per player, unsorted
  for (const pl of players) {
    if (selfKey && (pl.slug || normalizeName(pl.name)) === selfKey) continue;
    const career = pl.seasons
      .filter((s) => (s.gp || 0) >= RUN_MIN_GP && s.mp > 0)
      .sort((a, b) => a.season.localeCompare(b.season));
    if (career.length < n) continue;
    // Per-season category VA once per season, then a rolling window over it:
    // the expensive part is the same O(pool) valueAddByCategory pass the
    // season comps already do, and the windows themselves are adds and
    // subtracts on a 10-slot accumulator.
    const cats = career.map((s) => {
      const by = valueAddByCategory(s, lgaForSeason(s.season));
      return VA_CATEGORY_ORDER.map((k) => by[k] || 0);
    });
    const sum = new Array(dim).fill(0);
    let gp = 0, mp = 0;
    let best = null;
    for (let i = 0; i < career.length; i++) {
      for (let c = 0; c < dim; c++) sum[c] += cats[i][c];
      gp += career[i].gp || 0;
      mp += career[i].mp || 0;
      if (i >= n) {
        const out = i - n;
        for (let c = 0; c < dim; c++) sum[c] -= cats[out][c];
        gp -= career[out].gp || 0;
        mp -= career[out].mp || 0;
      }
      if (i < n - 1 || !(gp > 0)) continue;
      // A 35-MPG peak shouldn't comp to a 15-MPG bench run even when the
      // per-minute shape matches, so gate on the run's own minutes role.
      if (Math.abs(mp / gp - qMPG) > RUN_MPG_BAND) continue;
      let dot = 0, sq = 0;
      for (let c = 0; c < dim; c++) {
        const v = sum[c] / gp;
        dot += qVec[c] * v;
        sq += v * v;
      }
      const norm = Math.sqrt(sq);
      if (!norm) continue;
      const cos = dot / (qNorm * norm);
      if (cos < RUN_MIN_COS) continue;
      const mag = Math.min(qNorm, norm) / Math.max(qNorm, norm);
      const score = cos * mag;
      if (best && !(score > best.score)) continue;
      const seasons = career.slice(i - n + 1, i + 1);
      best = {
        player: pl,
        seasons,
        team: dominantTeam(seasons),
        span: seasonSpanLabel(seasons),
        gp,
        va: seasons.reduce((t, s) => t + (s.va || 0), 0),
        cos,
        mag,
        score,
      };
    }
    if (!best) continue;
    // Filed under the decade the MIDDLE season falls in, so a run straddling
    // a boundary lands where its weight is rather than always with its first
    // season.
    const mid = best.seasons[(n - 1) >> 1].season;
    const dec = Math.floor(parseInt(mid.slice(0, 4), 10) / 10) * 10;
    let arr = byDecade.get(dec);
    if (!arr) byDecade.set(dec, (arr = []));
    arr.push(best);
  }

  return [...byDecade.entries()]
    .sort((x, y) => y[0] - x[0]) // most recent decade first
    .map(([dec, arr]) => ({
      dec,
      list: arr.sort((x, y) => (y.score - x.score) || (y.cos - x.cos)).slice(0, perDecade),
    }));
}
