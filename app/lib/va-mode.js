"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { lgaForSeason, usageModelFor, usgAdjDelta } from "../scoring";


// --- USG-ADJ mode ------------------------------------------------------------
// One app-wide switch over which baseline the scoring-volume term is measured
// against (see the USG-ADJ block in app/scoring.js and spec §4.6):
//
//   off — μ_PTS, the league's median scoring MINUTE. Volume is paid for.
//   on  — the term pivots about the median minute of possessions USED, paying
//         its volume half at λ. Volume still counts, at half face value.
//
// Scoring only. The playmaking term pays for volume the same way, and three
// usage-adjusted passing baselines were built and measured before that was
// settled; all were dropped once the imbalance turned out to be a PRICE
// problem, fixed in base VA instead (scoring.js::assistPrice, spec §4.2a).
//
// The mode never travels as its own prop. Every VA surface already threads a
// season baseline object around, so the switch simply decides WHICH baseline
// object it hands out — `lgaFor(season)` here instead of a bare
// lgaForSeason(season) — and the mode rides along inside it as `usgModel`.
// The scorer reads that; nothing between here and there has to know the mode
// exists.
//
// The playoff baseline (spec §4.8) rides the same rail. `lgaFor(season, "po")`
// hands back the blended playoff object instead of the regular-season one, and
// again nothing downstream has to know: a scope is a different baseline object,
// not a different scorer. The default stays "rs", so a surface that has not
// been told which side of the season it is scoring keeps the behaviour it had.
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

const DEFAULT = { usgAdj: false, setUsgAdj: () => {}, lgaFor: (s, scope) => lgaForSeason(s, false, scope) };

export function VAModeProvider({ children }) {
  const [usgAdj, setUsgAdj] = useState(false);
  const lgaFor = useCallback((season, scope = "rs") => lgaForSeason(season, usgAdj, scope), [usgAdj]);
  const value = useMemo(() => ({ usgAdj, setUsgAdj, lgaFor }), [usgAdj, lgaFor]);
  return <VAModeContext.Provider value={value}>{children}</VAModeContext.Provider>;
}

// { usgAdj, setUsgAdj, lgaFor } — the whole switch. Outside a provider it
// reports the mode off, so a component can be rendered standalone (tests, a
// future embed) without a provider above it.
export function useVAMode() {
  return useContext(VAModeContext) || DEFAULT;
}

// The switch as a board chip. The page-level control under the tab strip is
// the one that explains itself; this is the same state, reachable from the
// header of a board that is already re-scored by it — By Season and By Player
// both carry one, next to their VA/VA+ chips. Two chips, one mode: it reads
// the context, never a copy of it, so the two can never disagree.
export function UsgAdjChip({ className = "" }) {
  const { usgAdj, setUsgAdj } = useVAMode();
  return (
    <button
      type="button"
      onClick={() => setUsgAdj(!usgAdj)}
      aria-pressed={usgAdj}
      title={usgAdj
        ? "Scoring volume is priced against the possessions used — tap for the league median baseline"
        : "Price scoring volume against the possessions used instead of the median minute"}
      className={`normal-case tracking-normal text-[10px] font-semibold px-1.5 py-0.5 border rounded-sm ${
        usgAdj ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-500 border-stone-300"
      } ${className}`}
    >
      USG-ADJ
    </button>
  );
}

// The season → baselines getter for the active mode. Stable across renders,
// new identity on every toggle: the dependency to list in a useMemo that
// scores rows.
//
// Pass a scope to bind it — `useLgaFor("po")` returns a getter that hands out
// the blended playoff baseline for whatever season it is asked about, so a
// component that scores one side of the season states that once at the top
// rather than at every call. Still stable across renders, and still a new
// identity whenever the mode or the scope changes.
export function useLgaFor(scope = null) {
  const { lgaFor } = useVAMode();
  return useMemo(
    () => (scope == null ? lgaFor : (season, override = scope) => lgaFor(season, override)),
    [lgaFor, scope]);
}

// The baseline scope a board's row scope is scored in. The playoff boards score
// playoff lines; the regular-season and combined boards are scored against the
// regular season (spec §4.8 — a combined row's own minute-weighted mix is
// applied where the split is known, on the board itself).
export const lgaScopeFor = (rowScope) => (rowScope === "playoffs" || rowScope === "po" ? "po" : "rs");

// One season's baselines under the active mode, for the scope being scored —
// "rs" (default) or "po" for the blended playoff baseline.
export function useSeasonLga(season, scope = "rs") {
  const lgaFor = useLgaFor();
  return useMemo(() => lgaFor(season, scope), [lgaFor, season, scope]);
}

// Whether the active mode actually changes anything for a season — false when
// the mode is off, and also when that season has no fitted model. UI that
// explains the mode should stay quiet in both cases.
export function useUsgAdjActive(season) {
  const { usgAdj } = useVAMode();
  return usgAdj && !!usageModelFor(season);
}

// Re-price rows that arrived with `va` already computed server-side (the
// playoff leaderboard route, the /api/players index). The volume term is linear
// in MP and USG, so the two modes differ by a closed form
// (scoring.js::usgAdjDelta) and the other nine categories don't have to be
// re-derived from the box score. Per-game splits carried on a row are re-priced
// the same way, so a row's games still sum to its season.
//
// Returns the input array untouched when the mode is off or the season has no
// model, so callers can wrap unconditionally without copying rows for nothing.
export function usgAdjRows(rows, lga) {
  if (!lga?.usgModel || !Array.isArray(rows)) return rows;
  return rows.map((r) => {
    const row = { ...r, va: (r.va || 0) + usgAdjDelta(r, lga) };
    // A baked per-game figure is the same statistic divided by games, so it
    // moves with the total rather than sitting beside it at the old baseline
    // (the compare picker's season chips and the breakdown's VA/Game tile both
    // read it straight off the row).
    if (r.vaPerG != null) row.vaPerG = r.gp > 0 ? row.va / r.gp : 0;
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
export function usgAdjSeasonRows(rows, usgAdj, scope = "rs") {
  if (!usgAdj || !Array.isArray(rows)) return rows;
  return rows.map((r) => {
    const lga = lgaForSeason(r.season, true, scope);
    if (!lga.usgModel) return r;
    const row = { ...r, va: (r.va || 0) + usgAdjDelta(r, lga) };
    if (r.vaPerG != null) row.vaPerG = r.gp > 0 ? row.va / r.gp : 0;
    return row;
  });
}

// A whole /api/players index, re-priced. This is the one place By Player's
// career table, the league pools the category drill-ins rank against, and the
// closest-comps candidate set all come from, so re-pricing here is what keeps
// those three agreeing with the leaderboard.
export function useUsgAdjIndex(indexPlayers, scope = "rs") {
  const { usgAdj } = useVAMode();
  return useMemo(() => {
    if (!usgAdj || !Array.isArray(indexPlayers)) return indexPlayers;
    // careerVa and the index order are both derived from the season rows the
    // route baked, so they are re-derived here rather than left reading the
    // standard baseline — the career line under a player's name, and which
    // players the search offers first, are the same statistic as the table.
    return indexPlayers
      .map((pl) => {
        const seasons = usgAdjSeasonRows(pl.seasons, true, scope);
        return { ...pl, seasons, careerVa: seasons.reduce((t, s) => t + (s.va || 0), 0) };
      })
      .sort((a, b) => b.careerVa - a.careerVa);
  }, [indexPlayers, usgAdj, scope]);
}
