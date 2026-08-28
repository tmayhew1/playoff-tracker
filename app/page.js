"use client";

import { useCallback, useState } from "react";
import { HISTORY } from "./historical";
import { CollegeView } from "./components/college-view";
import { DRatingView } from "./components/drating-view";
import { ExploreView } from "./components/explore";
import { HistoryView } from "./components/history";
import { InfoView } from "./components/info-view";
import { LegacyView } from "./components/legacy-view";
import { ShotZonesView } from "./components/shot-zones-view";
import { UsageView } from "./components/usage-view";
import { VAModeProvider, useVAMode } from "./lib/va-mode";


// The USG-ADJ switch (app/lib/va-mode.js, spec §4.6). It sits under the tab
// strip rather than inside any one card because it re-prices every VA on the
// page at once — the leaderboard, the drill-in categories, By Player's career
// table, the box scores — and a control that global reads wrong tucked into a
// card header.
//
// Shown only on the tabs it actually changes. Legacy is baked server-side
// against the standard baseline and College has no fitted model, so on those
// tabs the switch would be a lie; Info explains the mode in prose instead.
function VABaselineToggle() {
  const { usgAdj, setUsgAdj } = useVAMode();
  const cls = (active) =>
    `px-2 py-1 text-[9px] uppercase tracking-[0.15em] border ${active
      ? "bg-stone-900 text-white border-stone-900"
      : "bg-white text-stone-500 border-stone-300 hover:bg-stone-50"}`;
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-[0.2em] text-stone-400 shrink-0">Scoring baseline</span>
        <div className="inline-flex ml-auto shrink-0">
          <button type="button" onClick={() => setUsgAdj(false)} className={cls(!usgAdj)} aria-pressed={!usgAdj}>
            League median
          </button>
          {/* Spelled out here, where there is room for it and where a reader
              meeting the mode for the first time will be looking. The boards
              keep the abbreviation on their own chips (lib/va-mode.js), and
              Info carries the explanation in prose. */}
          <button type="button" onClick={() => setUsgAdj(true)} className={`${cls(usgAdj)} border-l-0`} aria-pressed={usgAdj}>
            Usage-adjusted
          </button>
        </div>
      </div>
    </div>
  );
}


export default function PlayoffTracker() {
  return (
    <VAModeProvider>
      <Tracker />
    </VAModeProvider>
  );
}


function Tracker() {
  const [tab, setTab] = useState("explore");
  const seasons = Object.keys(HISTORY);

  // A cross-tab jump: Legacy hands over a player-season and which half of it
  // was being read, and Explore opens its leaderboard there. Held here because
  // the two tabs are siblings — Explore unmounts while Legacy is showing, so
  // it picks the target up on mount.
  const [exploreJump, setExploreJump] = useState(null);
  const goToLeaderboard = useCallback((target) => {
    if (!target?.season) return;
    setExploreJump(target);
    setTab("explore");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const clearExploreJump = useCallback(() => setExploreJump(null), []);

  return (
    <div className="min-h-screen bg-stone-100">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <header className="mb-4 text-center">
          {/* "Trey's" rides the eyebrow in the serif display face — bigger and
              styled apart from the small-caps tag; the title drops a step so
              the two lines read more evenly. Both lines centered as a unit. */}
          <div className="flex items-baseline justify-center gap-1.5 mb-1">
            <span className="text-xl font-bold italic text-stone-800 leading-none" style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}>Trey&rsquo;s</span>
            <span className="text-xs uppercase tracking-[0.3em] text-stone-500">NBA Box Score</span>
          </div>
          <h1 className="text-2xl font-black text-stone-900 leading-none tracking-tight" style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}>Value Added Tracker</h1>
        </header>

        <div className="flex border-b-2 border-stone-900 mb-5 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setTab("explore")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "explore" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            Explore
          </button>
          {seasons.map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === s ? "bg-stone-900 text-white" : "text-stone-500"}`}
            >
              {s}
            </button>
          ))}
          {/* Legacy is hidden while it's still being worked on — the tab
              button only. The view, its route through the render below, and
              the cross-tab jump it hands back are all left intact, so putting
              it back is this button and nothing else. */}
          <button
            onClick={() => setTab("college")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "college" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            College
          </button>
          <button
            onClick={() => setTab("drating")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "drating" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            D Rating
          </button>
          <button
            onClick={() => setTab("usage")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "usage" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            Usage
          </button>
          <button
            onClick={() => setTab("shotzones")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "shotzones" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            Shot Zones
          </button>
          <button
            onClick={() => setTab("info")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "info" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            Info
          </button>
        </div>

        {(tab === "explore" || seasons.includes(tab)) && <VABaselineToggle />}

        {tab === "explore" ? <ExploreView jump={exploreJump} onJumpHandled={clearExploreJump} />
          : tab === "legacy" ? <LegacyView onGoToLeaderboard={goToLeaderboard} /> : tab === "college" ? <CollegeView /> : tab === "drating" ? <DRatingView /> : tab === "usage" ? <UsageView /> : tab === "shotzones" ? <ShotZonesView /> : tab === "info" ? <InfoView /> : <HistoryView season={tab} />}
      </div>
    </div>
  );
}
