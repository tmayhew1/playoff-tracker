"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchBakedJson } from "./fetch-cache";
import { buildScopePools, findIndexPlayer } from "./players";
import { useRowLga, useUsgAdjIndex, lgaScopeFor } from "./va-mode";

// A player's season so far, for a single game's card (the Live tab's): his
// row for `season` out of the same /api/players index every league-context
// drill-in ranks against, with the pools CategoryContext wants and the
// baseline his row is priced on. `want` is { scope, season } (scope as the
// index takes it: "regular" / "playoffs") or null; nothing loads until
// `enabled`. Returns null while there's nothing to ask for, { loading } until
// the index is in, then { row, context, lga } — `row` null when the index has
// no line for him this season yet.

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
      .then((d) => { if (!cancelled) setRaw({ scope, players: d.players || [] }); })
      .catch(() => { if (!cancelled) setRaw({ scope, players: [] }); });
    return () => { cancelled = true; };
  }, [enabled, scope]);
  const index = useUsgAdjIndex(raw?.scope === scope ? raw.players : null, lgaScopeFor(scope));
  const rowLga = useRowLga(scope);
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
