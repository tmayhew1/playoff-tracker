"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchBakedJson } from "./fetch-cache";
import { buildScopePools, findIndexPlayer } from "./players";
import { useRowLga, useUsgAdjIndex, lgaScopeFor } from "./va-mode";
import { useLiveLines } from "./live-feed";
import { addLiveLinesToIndex } from "./live-lines";
import { lgaForSeason, valueAddParts } from "../scoring";

// A player's season so far, for a single game's card (the Live tab's): his
// row for `season` out of the same /api/players index every league-context
// drill-in ranks against, with the pools CategoryContext wants and the
// baseline his row is priced on. `want` is { scope, season } (scope as the
// index takes it: "regular" / "playoffs") or null; nothing loads until
// `enabled`. Returns null while there's nothing to ask for, { loading } until
// the index is in, then { row, context, lga } — `row` null when the index has
// no line for him this season yet.
//
// In the season in progress the index runs through last night's bake, so
// tonight's games — and any the bake hasn't caught up to — ride on top, the
// same lines and the same addLiveLinesToIndex the regular-season board lays
// over its drill-ins (lib/live-lines.js): a card opened mid-game reads his
// season as of the clock, a game in progress counting as the share of it
// played, and ranks him in a field moved as far.

// The pools are built from the whole index, so once per index, not per card.
const poolsCache = new WeakMap();
const poolsFor = (index) => {
  if (!poolsCache.has(index)) poolsCache.set(index, buildScopePools(index));
  return poolsCache.get(index);
};

export function useSeasonSoFar(p, want, enabled) {
  const scope = want?.scope || null;
  const [raw, setRaw] = useState(null);
  useEffect(() => {
    if (!enabled || !scope) return;
    let cancelled = false;
    fetchBakedJson(`/api/players?scope=${scope}`)
      .then((d) => { if (!cancelled) setRaw({ scope, players: d.players || [], inSeason: d.inSeason || null }); })
      .catch(() => { if (!cancelled) setRaw({ scope, players: [], inSeason: null }); });
    return () => { cancelled = true; };
  }, [enabled, scope]);
  const rowLga = useRowLga(scope);
  // The index says which night its season-so-far rows run through; the
  // lines start the day after. Regular season only — the playoffs have no
  // season-so-far rows to lay them on.
  const own = raw?.scope === scope ? raw : null;
  const liveSeason = enabled && scope === "regular" && own?.inSeason?.season === want?.season ? own.inSeason : null;
  const live = useLiveLines(liveSeason?.season || null, liveSeason?.through || null);
  const moved = useMemo(() => {
    if (!own) return null;
    if (!liveSeason || !live?.lines?.length) return own.players;
    // At the standard baseline, as /api/players priced the rest of the index;
    // useUsgAdjIndex below re-prices every row for the active mode.
    const std = lgaForSeason(liveSeason.season);
    return addLiveLinesToIndex(own.players, liveSeason.season, live.lines, (row) => valueAddParts(row, std).va);
  }, [own, liveSeason, live]);
  const index = useUsgAdjIndex(moved, lgaScopeFor(scope));
  return useMemo(() => {
    if (!enabled || !want) return null;
    if (!index) return { loading: true };
    const self = findIndexPlayer(index, p, want.season);
    const row = self?.seasons.find((s) => s.season === want.season && s.mp > 0) || null;
    if (!row) return { row: null };
    const context = { ...poolsFor(index), self, scope, season: want.season };
    return { row: { ...row, name: self.name, slug: self.slug || null }, context, lga: rowLga(row) };
  }, [enabled, want, index, p, scope, rowLga]);
}
