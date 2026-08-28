"use client";

import { useVAMode } from "../lib/va-mode";


// The USG-ADJ switch (app/lib/va-mode.js, spec §4.6). It lives in its own file
// because it renders in two places: under Explore's mode/scope selectors (the
// board it re-prices sits right below them) and, on a season tab, at the top of
// the page where there are no other selectors to sit under.
//
// It re-prices every VA on the page at once — the leaderboard, the drill-in
// categories, By Player's career table, the box scores — so it stays a
// page-level control rather than a card header's.
//
// Shown only on the tabs it actually changes. Legacy is baked server-side
// against the standard baseline and College has no fitted model, so on those
// tabs the switch would be a lie; Info explains the mode in prose instead.
export function VABaselineToggle({ className = "mb-4" }) {
  const { usgAdj, setUsgAdj } = useVAMode();
  const cls = (active) =>
    `px-2 py-1 text-[9px] uppercase tracking-[0.15em] border ${active
      ? "bg-stone-900 text-white border-stone-900"
      : "bg-white text-stone-500 border-stone-300 hover:bg-stone-50"}`;
  return (
    <div className={className}>
      {/* Wraps rather than overflows: at 375px and below the label plus the
          two spelled-out buttons are wider than the page, and on one line the
          group ran off the right edge (taking the whole page into a sideways
          scroll on the narrowest phones). Wrapped, the pair drops to its own
          line under the label and stays right-aligned. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* "Volume", not "Scoring": the switch re-prices both terms that pay
            for volume as such — scoring and playmaking (spec §4.6-4.7). It was
            accurate when the mode only touched the scoring term. */}
        <span className="text-[9px] uppercase tracking-[0.2em] text-stone-400 shrink-0">Volume baseline</span>
        <div className="inline-flex ml-auto shrink-0">
          <button type="button" onClick={() => setUsgAdj(false)} className={cls(!usgAdj)} aria-pressed={!usgAdj} aria-label="League average volume baseline">
            LG AVG
          </button>
          {/* The boards keep the bare abbreviation on their own chips
              (lib/va-mode.js); Info carries the explanation in prose. */}
          <button type="button" onClick={() => setUsgAdj(true)} className={`${cls(usgAdj)} border-l-0`} aria-pressed={usgAdj} aria-label="Usage-adjusted volume baseline">
            USG-Adjusted
          </button>
        </div>
      </div>
    </div>
  );
}
