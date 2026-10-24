"use client";

import { useEffect, useState } from "react";
import { fetchBakedJson } from "../lib/fetch-cache";
import { useAwardNav, useLookAheadNav } from "../lib/award-nav";

// A player card's award row: one small box per award (MVP, MIP — or ROY for a
// rookie — All-NBA, All-Star) with this player-season's odds, and Go → into that award's page in
// the Awards tab when the board lists them. Odds come from /api/awards/odds (scripts/bake-awards.mjs); a season the
// bake doesn't cover shows no row at all — except the season the Look Ahead
// projects, which reads its simulated odds instead (no MIP: it's scored
// against that projection) and goes to its boards there.

// Slots in each award-odds.json entry: [percent, rank on the board].
const AWARDS = [
  { key: "mvp", label: "MVP", pct: 0, rank: 1 },
  { key: "mip", label: "MIP", pct: 2, rank: 3 },
  { key: "allnba", label: "All-NBA", pct: 4, rank: 5 },
  { key: "allstar", label: "All-Star", pct: 6, rank: 7 },
];
// A rookie can't be Most Improved, so his card shows Rookie of the Year there.
const ROY = { key: "roy", label: "ROY", pct: 8, rank: 9 };
// No > or <: a near-lock reads 99%, a long shot 1%, and only a true zero 0%.
const fmt = (p) => (p == null ? "–" : `${p <= 0 ? 0 : Math.min(99, Math.max(1, Math.round(p)))}%`);

// Kept in step with LOOK_AHEAD_SEASON in ./look-ahead, which is only loaded
// (for lookAheadOdds) when a card from that season opens.
const LOOK_AHEAD_SEASON = "2026-27";

export function AwardBoxes({ slug, season }) {
  const [odds, setOdds] = useState(null);
  const [ahead, setAhead] = useState(null);
  const goToAward = useAwardNav();
  const openLookAhead = useLookAheadNav();
  useEffect(() => {
    let cancelled = false;
    fetchBakedJson("/api/awards/odds").then((d) => { if (!cancelled) setOdds(d.odds || {}); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // The projected season, until the bake covers it.
  const projected = season === LOOK_AHEAD_SEASON && odds && !odds[season];
  useEffect(() => {
    if (!projected) return;
    let cancelled = false;
    import("./look-ahead").then((m) => m.lookAheadOdds()).then((d) => { if (!cancelled) setAhead(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [projected]);
  if (!odds || !slug || !season) return null;
  let boxes;
  if (projected) {
    if (!ahead) return null;
    const mine = ahead[slug];
    boxes = [AWARDS[0], ...(mine?.roy != null ? [ROY] : []), AWARDS[2], AWARDS[3]].map((a) => ({
      ...a,
      p: mine ? mine[a.key] * 100 : null,
      go: openLookAhead && mine?.simulated ? () => openLookAhead({ award: a.key, slug }) : null,
      where: `${season} Look Ahead ${a.label} board`,
    }));
  } else {
    if (!odds[season]) return null;
    const mine = odds[season][slug] || [];
    boxes = AWARDS.map((a) => (a.key === "mip" && mine[ROY.pct] != null ? ROY : a)).map((a) => ({
      ...a,
      p: mine[a.pct],
      go: goToAward && mine[a.rank] != null ? () => goToAward({ award: a.key, season, slug }) : null,
      where: `${season} ${a.label} board`,
    }));
  }
  return (
    // A row across the top; turned sideways, a column down the card's left.
    <div className={`grid ${boxes.length === 3 ? "grid-cols-3" : "grid-cols-4"} gap-1 mb-2 tilt:grid-cols-1 tilt:w-28 tilt:shrink-0 tilt:mb-0`}>
      {boxes.map(({ key, label, p, go, where }) => {
        const Tag = go ? "button" : "div";
        return (
          <Tag
            key={key}
            type={go ? "button" : undefined}
            onClick={go || undefined}
            className={`min-w-0 flex flex-col px-1.5 py-1 border border-stone-300 bg-white text-left ${go ? "hover:bg-stone-100 cursor-pointer" : ""}`}
            aria-label={go ? `${label} odds ${fmt(p)} — open the ${where}` : undefined}
          >
            <span className="text-[8px] font-bold uppercase tracking-wider text-stone-500 truncate">{label}</span>
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
