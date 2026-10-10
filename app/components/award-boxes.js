"use client";

import { useEffect, useState } from "react";
import { fetchBakedJson } from "../lib/fetch-cache";
import { useAwardNav } from "../lib/award-nav";

// A player card's award row: one small box per award (MVP, MIP, All-NBA,
// All-Star) with this player-season's odds, and Go → into that award's page in
// the Awards tab when the board lists them. Odds come from /api/awards/odds (scripts/bake-awards.mjs); a season the
// bake doesn't cover shows no row at all.

// Slots in each award-odds.json entry: [percent, rank on the board].
const AWARDS = [
  { key: "mvp", label: "MVP", pct: 0, rank: 1 },
  { key: "mip", label: "MIP", pct: 2, rank: 3 },
  { key: "allnba", label: "All-NBA", pct: 4, rank: 5 },
  { key: "allstar", label: "All-Star", pct: 6, rank: 7 },
];
const fmt = (p) => (p == null ? "–" : p >= 99.5 ? ">99%" : p < 0.5 ? "<1%" : `${Math.round(p)}%`);

export function AwardBoxes({ slug, season }) {
  const [odds, setOdds] = useState(null);
  const goToAward = useAwardNav();
  useEffect(() => {
    let cancelled = false;
    fetchBakedJson("/api/awards/odds").then((d) => { if (!cancelled) setOdds(d.odds || {}); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!odds || !slug || !season || !odds[season]) return null;
  const mine = odds[season][slug] || [];
  return (
    <div className="grid grid-cols-4 gap-1 mb-2">
      {AWARDS.map((a) => {
        const p = mine[a.pct], rank = mine[a.rank];
        const go = goToAward && rank != null ? () => goToAward({ award: a.key, season, slug }) : null;
        const Tag = go ? "button" : "div";
        return (
          <Tag
            key={a.key}
            type={go ? "button" : undefined}
            onClick={go || undefined}
            className={`min-w-0 flex flex-col px-1.5 py-1 border border-stone-300 bg-white text-left ${go ? "hover:bg-stone-100 cursor-pointer" : ""}`}
            aria-label={go ? `${a.label} odds ${fmt(p)} — open the ${season} ${a.label} board` : undefined}
          >
            <span className="text-[8px] font-bold uppercase tracking-wider text-stone-500 truncate">{a.label}</span>
            <span className="flex items-baseline justify-between gap-1">
              <span className="text-[11px] font-bold tabular-nums text-stone-900">{fmt(p)}</span>
              <span className={`text-[8px] uppercase tracking-wider whitespace-nowrap ${go ? "text-stone-500" : "text-transparent"}`} aria-hidden>Go →</span>
            </span>
          </Tag>
        );
      })}
    </div>
  );
}
