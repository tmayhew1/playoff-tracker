"use client";

import { useEffect, useState } from "react";
import { fetchBakedJson } from "../lib/fetch-cache";
import { useAwardNav, useLookAheadNav } from "../lib/award-nav";

// A player card's award row: one small box per award (MVP, MIP — or ROY for a
// rookie — All-NBA, All-Star) with this player-season's odds, and Go → into that award's page in
// the Awards tab when the board lists them. Odds come from /api/awards/odds (scripts/bake-awards.mjs); a season the
// bake doesn't cover shows no row at all — except the season the Look Ahead
// projects, which reads its simulated odds instead (MIP once games have been
// played, measured against the preseason projection) and goes to its boards
// there.

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

// The odds file is small and local; the Look Ahead's are simulated from
// /api/projections, which reads live rosters and injuries and can take a few
// seconds. Both are promise-cached, so a call here only starts them early.
function loadOdds() {
  return fetchBakedJson("/api/awards/odds").then((d) => d.odds || {});
}
function loadAhead() {
  return import("./look-ahead").then((m) => m.lookAheadOdds());
}

// Starts both loads ahead of any card being opened (Explore calls it once the
// page is idle), so the award row is normally ready by the first tap.
export function prefetchAwardOdds() {
  loadOdds().then((odds) => (odds[LOOK_AHEAD_SEASON] ? null : loadAhead())).catch(() => {});
}

// How long a card waits for its award row before it shows without the
// numbers: past this the row is drawn as placeholders that fill in place.
const HOLD_MS = 3000;

// A player card's award row, worked out before the card is shown. The card
// used to draw first and slot the row in when the odds arrived, pushing
// everything under it down a row — so a tap aimed at Basic / By Category or a
// category bar landed on an award box instead. Now the card asks this first:
//   ready  false while the card should hold back (at most HOLD_MS)
//   boxes  the row to draw, or null for a season with no award row; once the
//          card is showing, whether the row exists never changes, only the
//          numbers in it (placeholder boxes, `pending`, until they arrive)
export function useAwardBoxes({ slug, season, enabled }) {
  const [odds, setOdds] = useState(null);
  const [ahead, setAhead] = useState(null);
  const [aheadFailed, setAheadFailed] = useState(false);
  const [held, setHeld] = useState(true);
  const goToAward = useAwardNav();
  const openLookAhead = useLookAheadNav();
  const on = enabled && !!slug && !!season;
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    loadOdds().then((d) => { if (!cancelled) setOdds(d); }).catch(() => { if (!cancelled) setOdds({}); });
    return () => { cancelled = true; };
  }, [on]);
  // The projected season, until the bake covers it.
  const projected = on && season === LOOK_AHEAD_SEASON && odds && !odds[season];
  useEffect(() => {
    if (!projected) return;
    let cancelled = false;
    loadAhead().then((d) => { if (!cancelled) setAhead(d); }).catch(() => { if (!cancelled) setAheadFailed(true); });
    return () => { cancelled = true; };
  }, [projected]);
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => setHeld(false), HOLD_MS);
    return () => clearTimeout(t);
  }, [on]);

  if (!on) return { ready: true, boxes: null };
  // Whether there is a row at all rests on the odds file alone (small and
  // local); the card always waits for that.
  if (!odds) return { ready: false, boxes: null };
  if (projected) {
    const settled = !!ahead || aheadFailed;
    if (!settled && held) return { ready: false, boxes: null };
    const mine = ahead?.[slug];
    const list = [AWARDS[0], ...(mine?.roy != null ? [ROY] : mine?.mip != null || !settled ? [AWARDS[1]] : []), AWARDS[2], AWARDS[3]];
    return {
      ready: true,
      boxes: list.map((a) => ({
        ...a,
        pending: !settled,
        p: mine ? mine[a.key] * 100 : null,
        go: openLookAhead && mine?.simulated ? () => openLookAhead({ award: a.key, slug }) : null,
        where: `${season} Look Ahead ${a.label} board`,
      })),
    };
  }
  if (!odds[season]) return { ready: true, boxes: null };
  const mine = odds[season][slug] || [];
  return {
    ready: true,
    boxes: AWARDS.map((a) => (a.key === "mip" && mine[ROY.pct] != null ? ROY : a)).map((a) => ({
      ...a,
      p: mine[a.pct],
      go: goToAward && mine[a.rank] != null ? () => goToAward({ award: a.key, season, slug }) : null,
      where: `${season} ${a.label} board`,
    })),
  };
}

// Draws the row useAwardBoxes worked out.
export function AwardBoxes({ boxes }) {
  if (!boxes) return null;
  return (
    // A row across the top; turned sideways, a column down the card's left.
    <div className={`grid ${boxes.length === 3 ? "grid-cols-3" : "grid-cols-4"} gap-1 mb-2 tilt:grid-cols-1 tilt:w-28 tilt:shrink-0 tilt:mb-0`}>
      {boxes.map(({ key, label, p, go, where, pending }) => {
        const Tag = go && !pending ? "button" : "div";
        return (
          <Tag
            key={key}
            type={go ? "button" : undefined}
            onClick={(!pending && go) || undefined}
            className={`min-w-0 flex flex-col px-1.5 py-1 border border-stone-300 bg-white text-left ${go && !pending ? "hover:bg-stone-100 cursor-pointer" : ""}`}
            aria-label={pending ? `${label} odds loading` : go ? `${label} odds ${fmt(p)} — open the ${where}` : undefined}
          >
            <span className="text-[8px] font-bold uppercase tracking-wider text-stone-500 truncate">{label}</span>
            <span className="flex items-baseline justify-between gap-1">
              <span className={`text-[11px] font-bold tabular-nums ${pending ? "text-stone-300" : "text-stone-900"}`}>{pending ? "…" : fmt(p)}</span>
              <span className={`text-[8px] uppercase tracking-wider whitespace-nowrap ${go && !pending ? "text-stone-500" : "text-transparent"}`} aria-hidden>Go →</span>
            </span>
          </Tag>
        );
      })}
    </div>
  );
}
