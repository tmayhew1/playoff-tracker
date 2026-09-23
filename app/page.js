"use client";

import { useCallback, useEffect, useState } from "react";
import { HISTORY } from "./historical";
import dynamic from "next/dynamic";
import { ExploreView } from "./components/explore";
import { VABaselineToggle } from "./components/va-baseline-toggle";
import { VAModeProvider } from "./lib/va-mode";

// Explore is the landing tab and ships in the page bundle. Every other tab's
// code loads the first time that tab is opened, so a visit that never leaves
// Explore doesn't download it.
const TabLoading = () => (
  <div className="py-10 text-center text-[11px] uppercase tracking-widest text-stone-400">Loading…</div>
);
const lazyView = (load) => dynamic(load, { loading: TabLoading });
const CollegeView = lazyView(() => import("./components/college-view").then((m) => m.CollegeView));
const DRatingView = lazyView(() => import("./components/drating-view").then((m) => m.DRatingView));
const HistoryView = lazyView(() => import("./components/history").then((m) => m.HistoryView));
const InfoView = lazyView(() => import("./components/info-view").then((m) => m.InfoView));
const LegacyView = lazyView(() => import("./components/legacy-view").then((m) => m.LegacyView));
const ShotZonesView = lazyView(() => import("./components/shot-zones-view").then((m) => m.ShotZonesView));
const UsageView = lazyView(() => import("./components/usage-view").then((m) => m.UsageView));


export default function PlayoffTracker() {
  return (
    <VAModeProvider>
      <Tracker />
    </VAModeProvider>
  );
}


const SEASONS = Object.keys(HISTORY);
const TABS = [
  ["explore", "Explore"],
  ...SEASONS.map((s) => [s, s]),
  ["legacy", "Legacy"],
  ["college", "College"],
  ["drating", "D Rating"],
  ["usage", "Usage"],
  ["shotzones", "Shot Zones"],
  ["info", "Info"],
];
const TAB_IDS = new Set(TABS.map(([id]) => id));


function Tracker() {
  const [tab, setTabState] = useState("explore");

  // The tab rides the URL hash so a reload keeps it — BuildWatch reloads an
  // open tab whenever a new deployment lands, which otherwise dropped the
  // reader back on Explore — and so a view can be linked to directly.
  // replaceState rather than a hash assignment: switching tabs shouldn't
  // stack up history entries. Read after mount to keep hydration clean.
  useEffect(() => {
    const read = () => {
      const h = decodeURIComponent(window.location.hash.slice(1));
      setTabState(TAB_IDS.has(h) ? h : "explore");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const setTab = useCallback((id) => {
    setTabState(id);
    try {
      window.history.replaceState(null, "", id === "explore" ? window.location.pathname + window.location.search : `#${id}`);
    } catch {
      // sandboxed frames can refuse history writes — the tab still switches
    }
  }, []);

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
  }, [setTab]);
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
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === id ? "bg-stone-900 text-white" : "text-stone-500"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* A season tab has no selectors of its own, so the switch sits at the
            top of the page. Explore renders its own copy below the By
            Season/By Player and scope rows — see ExploreView. */}
        {SEASONS.includes(tab) && <VABaselineToggle />}

        {tab === "explore" ? <ExploreView jump={exploreJump} onJumpHandled={clearExploreJump} />
          : tab === "legacy" ? <LegacyView onGoToLeaderboard={goToLeaderboard} /> : tab === "college" ? <CollegeView /> : tab === "drating" ? <DRatingView /> : tab === "usage" ? <UsageView /> : tab === "shotzones" ? <ShotZonesView /> : tab === "info" ? <InfoView /> : <HistoryView season={tab} />}
      </div>
    </div>
  );
}
