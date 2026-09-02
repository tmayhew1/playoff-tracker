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
import { TreysMark, treysMarkDescender } from "./components/treys-mark";
import { UsageView } from "./components/usage-view";
import { VABaselineToggle } from "./components/va-baseline-toggle";
import { VAModeProvider } from "./lib/va-mode";


// Cap-to-baseline of the handwritten mark comes to about half of this.
const MARK_HEIGHT = 54;

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
        <header className="pt-2 mb-4 text-center">
          {/* "Trey's" rides the eyebrow as the handwritten mark, sitting on the
              same baseline as the small-caps tag; the title drops a step so the
              two lines read more evenly. Both lines centered as a unit.
              The padding is the room the mark's descender hangs into — without
              it the y's loop would land on the title. The header's top padding
              is the same measure taken back, so closing up under the eyebrow
              lowers the eyebrow rather than raising the title. */}
          <div className="flex items-baseline justify-center gap-2.5" style={{ paddingBottom: treysMarkDescender(MARK_HEIGHT) }}>
            <TreysMark height={MARK_HEIGHT} className="text-stone-800" />
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

        {/* A season tab has no selectors of its own, so the switch sits at the
            top of the page. Explore renders its own copy below the By
            Season/By Player and scope rows — see ExploreView. */}
        {seasons.includes(tab) && <VABaselineToggle />}

        {tab === "explore" ? <ExploreView jump={exploreJump} onJumpHandled={clearExploreJump} />
          : tab === "legacy" ? <LegacyView onGoToLeaderboard={goToLeaderboard} /> : tab === "college" ? <CollegeView /> : tab === "drating" ? <DRatingView /> : tab === "usage" ? <UsageView /> : tab === "shotzones" ? <ShotZonesView /> : tab === "info" ? <InfoView /> : <HistoryView season={tab} />}
      </div>
    </div>
  );
}
