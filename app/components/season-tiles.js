"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchBakedJson } from "../lib/fetch-cache";
import { normalizeName } from "../lib/format";
import { buildScopePools } from "../lib/players";
import { useRowLga, useUsgAdjIndex } from "../lib/va-mode";
import { VACategoryBreakdown } from "./va-breakdown";

// One tile per regular season a player has played ("2025-26"), newest first;
// a tap opens that season's breakdown card — the same one By Player shows,
// league context and all — right under the tiles. Used under a Look Ahead row.

// The pools are built from the whole index, so once per index, not per row.
const poolsCache = new WeakMap();
const poolsFor = (index) => {
  if (!poolsCache.has(index)) poolsCache.set(index, buildScopePools(index));
  return poolsCache.get(index);
};

export function SeasonTiles({ slug = null, name }) {
  const [raw, setRaw] = useState(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchBakedJson("/api/players?scope=regular")
      .then((d) => { if (!cancelled) setRaw(d.players || []); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);
  const index = useUsgAdjIndex(raw, "rs");
  const rowLga = useRowLga("regular");
  const player = useMemo(() => {
    if (!index) return null;
    const n = normalizeName(name || "");
    return index.find((x) => (slug && x.slug === slug)) || index.find((x) => normalizeName(x.name) === n) || null;
  }, [index, slug, name]);
  const seasons = useMemo(
    () => (player ? [...player.seasons].filter((s) => s.mp > 0).sort((a, b) => b.season.localeCompare(a.season)) : []),
    [player]
  );

  if (failed || (index && !seasons.length)) return null;
  if (!index) return <div className="mt-1.5 text-[9px] italic text-stone-400 text-center">Loading seasons…</div>;

  const s = open ? seasons.find((x) => x.season === open) : null;
  const context = s ? { ...poolsFor(index), self: player, scope: "regular", season: s.season } : null;
  return (
    <div className="mt-1.5">
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-1">
        {seasons.map((x) => {
          const on = x.season === open;
          return (
            <button key={x.season} type="button" onClick={() => setOpen(on ? null : x.season)} aria-pressed={on}
              title={`${x.season} · ${x.team} · ${x.gp} G`}
              className={`min-h-8 border px-2 py-1 text-[10px] tabular-nums ${on ? "bg-stone-700 border-stone-700 text-white" : "bg-white border-stone-200 text-stone-600 hover:bg-stone-100"}`}>
              {x.season}
            </button>
          );
        })}
      </div>
      {s && (
        <div className="mt-1 border border-stone-200">
          <VACategoryBreakdown key={s.season} player={s} lga={rowLga(s)} baseline="NBA" context={context} />
        </div>
      )}
    </div>
  );
}
