"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { lgaForSeason, usageModelFor, usgAdjDelta } from "../scoring";


// --- USG-ADJ mode ------------------------------------------------------------
// One app-wide switch over which baseline the scoring-volume term is measured
// against (see the USG-ADJ block in app/scoring.js and spec §4.6):
//
//   off — μ_PTS, the league's median scoring MINUTE. Volume is paid for.
//   on  — a + b·(USG/MP), what the league scores on the possessions this
//         player actually used. Volume is only paid for above the going rate.
//
// The mode never travels as its own prop. Every VA surface already threads a
// season baseline object around, so the switch simply decides WHICH baseline
// object it hands out — `lgaFor(season)` here instead of a bare
// lgaForSeason(season) — and the mode rides along inside it as `usgModel`.
// The scorer reads that; nothing between here and there has to know the mode
// exists.
//
// The getter's identity changes with the mode and the baseline objects
// themselves are cached per season (scoring.js::usgAdjLga), so putting
// `lgaFor` in a useMemo dependency list re-derives exactly once per toggle and
// never on a re-render.
//
// Server routes never see this: they bake plain VA, and the client re-prices
// what they return (usgAdjRows below). A season with no fitted model — the
// college baselines, a season whose regular-season table isn't baked — hands
// back its plain baselines, so the mode is a no-op there rather than a wrong
// number.

const VAModeContext = createContext(null);

const DEFAULT = { usgAdj: false, setUsgAdj: () => {}, lgaFor: (s) => lgaForSeason(s) };

export function VAModeProvider({ children }) {
  const [usgAdj, setUsgAdj] = useState(false);
  const lgaFor = useCallback((season) => lgaForSeason(season, usgAdj), [usgAdj]);
  const value = useMemo(() => ({ usgAdj, setUsgAdj, lgaFor }), [usgAdj, lgaFor]);
  return <VAModeContext.Provider value={value}>{children}</VAModeContext.Provider>;
}

// { usgAdj, setUsgAdj, lgaFor } — the whole switch. Outside a provider it
// reports the mode off, so a component can be rendered standalone (tests, a
// future embed) without a provider above it.
export function useVAMode() {
  return useContext(VAModeContext) || DEFAULT;
}

// The season → baselines getter for the active mode. Stable across renders,
// new identity on every toggle: the dependency to list in a useMemo that
// scores rows.
export function useLgaFor() {
  return useVAMode().lgaFor;
}

// One season's baselines under the active mode.
export function useSeasonLga(season) {
  const lgaFor = useLgaFor();
  return useMemo(() => lgaFor(season), [lgaFor, season]);
}

// Whether the active mode actually changes anything for a season — false when
// the mode is off, and also when that season has no fitted model. UI that
// explains the mode should stay quiet in both cases.
export function useUsgAdjActive(season) {
  const { usgAdj } = useVAMode();
  return usgAdj && !!usageModelFor(season);
}

// Re-price rows that arrived with `va` already computed server-side (the
// playoff leaderboard route, the /api/players index). The volume term is
// linear in MP and USG, so the two modes differ by a closed form
// (scoring.js::usgAdjDelta) and the other nine categories don't have to be
// re-derived from the box score. Per-game splits carried on a row are
// re-priced the same way, so a row's games still sum to its season.
//
// Returns the input array untouched when the mode is off or the season has no
// model, so callers can wrap unconditionally without copying rows for nothing.
export function usgAdjRows(rows, lga) {
  if (!lga?.usgModel || !Array.isArray(rows)) return rows;
  return rows.map((r) => {
    const row = { ...r, va: (r.va || 0) + usgAdjDelta(r, lga) };
    if (Array.isArray(r.games)) {
      row.games = r.games.map((g) => (g && g.va != null ? { ...g, va: g.va + usgAdjDelta(g, lga) } : g));
    }
    return row;
  });
}


// The same re-pricing for rows that each carry their OWN season — a player's
// career table, a pool of player-seasons from /api/players. Each row is
// measured against its own season's model (spec invariant 2), and a row whose
// season has no fit keeps its standard VA.
export function usgAdjSeasonRows(rows, usgAdj) {
  if (!usgAdj || !Array.isArray(rows)) return rows;
  return rows.map((r) => {
    const lga = lgaForSeason(r.season, true);
    return lga.usgModel ? { ...r, va: (r.va || 0) + usgAdjDelta(r, lga) } : r;
  });
}

// A whole /api/players index, re-priced. This is the one place By Player's
// career table, the league pools the category drill-ins rank against, and the
// closest-comps candidate set all come from, so re-pricing here is what keeps
// those three agreeing with the leaderboard.
export function useUsgAdjIndex(indexPlayers) {
  const { usgAdj } = useVAMode();
  return useMemo(() => {
    if (!usgAdj || !Array.isArray(indexPlayers)) return indexPlayers;
    // careerVa and the index order are both derived from the season rows the
    // route baked, so they are re-derived here rather than left reading the
    // standard baseline — the career line under a player's name, and which
    // players the search offers first, are the same statistic as the table.
    return indexPlayers
      .map((pl) => {
        const seasons = usgAdjSeasonRows(pl.seasons, true);
        return { ...pl, seasons, careerVa: seasons.reduce((t, s) => t + (s.va || 0), 0) };
      })
      .sort((a, b) => b.careerVa - a.careerVa);
  }, [indexPlayers, usgAdj]);
}
