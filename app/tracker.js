"use client";

import { useCallback, useEffect, useState } from "react";
import { HISTORY } from "./historical";
import dynamic from "next/dynamic";
import { ExploreView } from "./components/explore";
import { VABaselineToggle } from "./components/va-baseline-toggle";
import { VAModeProvider, useVAMode } from "./lib/va-mode";
import { shareQuery } from "./lib/share-params";
import { ShareProvider, useShareStore } from "./lib/share-state";
import { AwardNavProvider } from "./lib/award-nav";

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
const DraftView = lazyView(() => import("./components/draft-view").then((m) => m.DraftView));
const AwardsView = lazyView(() => import("./components/awards-view").then((m) => m.AwardsView));
const LiveView = lazyView(() => import("./components/live-view").then((m) => m.LiveView));


// `initial` is the link this page was opened from, parsed on the server
// (app/page.js) so the first render is already the linked view.
export function PlayoffTracker({ initial = null }) {
  return (
    <VAModeProvider initialUsgAdj={!!initial?.usg}>
      <Tracker initial={initial} />
    </VAModeProvider>
  );
}


const SEASONS = Object.keys(HISTORY);
const TABS = [
  ["explore", "Explore"],
  ["live", "Live"],
  ["tvs", "Trey vs Spencer"],
  ["draft", "Draft"],
  ["legacy", "Legacy"],
  ["awards", "Awards"],
  ["college", "College"],
  ["drating", "D Rating"],
  ["usage", "Usage"],
  ["shotzones", "Shot Zones"],
  ["info", "Info"],
];
const TAB_IDS = new Set(TABS.map(([id]) => id));
// Trey vs Spencer holds every draft season under one tab; a link still names
// the season itself (?tab=2025-26), so links from before the merge open it.
const tabFromLink = (t) => (SEASONS.includes(t) ? "tvs" : TAB_IDS.has(t) ? t : "explore");


function Tracker({ initial }) {
  const [tab, setTab] = useState(() => tabFromLink(initial?.tab));
  const [tvsSeason, setTvsSeason] = useState(() => (SEASONS.includes(initial?.tab) ? initial.tab : SEASONS[0]));
  // Explore's part of the opening link, handed over once: ExploreView starts
  // from it on its first mount and clears it, so coming back to Explore later
  // resumes normally instead of re-opening the link.
  const [exploreInit, setExploreInit] = useState(() => (initial && !initial.tab ? initial : null));
  const clearExploreInit = useCallback(() => setExploreInit(null), []);

  // The address bar always holds a link to what's on screen: every view
  // reports its part (lib/share-state.js) and the merged state is written
  // here. That makes any URL shareable, and keeps the view across a reload —
  // BuildWatch reloads an open tab whenever a new deployment lands.
  // replaceState, so navigating inside the page doesn't stack history entries.
  const { state: share, report } = useShareStore();
  const { usgAdj } = useVAMode();
  const query = shareQuery({ ...share, tab: tab === "tvs" ? tvsSeason : tab, usg: usgAdj });
  useEffect(() => {
    try {
      if (window.location.search !== query) {
        window.history.replaceState(null, "", window.location.pathname + query);
      }
    } catch {
      // sandboxed frames can refuse history writes — the view still works
    }
  }, [query]);

  // A cross-tab jump: Legacy (and MIP) hand over a player-season and which half of it
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

  // The other direction: a player card's award box (award-boxes.js) opens the
  // Awards tab on that award, season and player.
  const [awardFocus, setAwardFocus] = useState(null);
  const goToAward = useCallback((target) => {
    if (!target?.season || !target?.award) return;
    setAwardFocus(target);
    setTab("awards");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [setTab]);
  const clearAwardFocus = useCallback(() => setAwardFocus(null), []);

  // The Live tab reads "Up Next" once the night's games are over (see
  // LiveView). Asked once here so the label is right before the tab is
  // opened; LiveView keeps it current from its own polling after that.
  const [liveMode, setLiveMode] = useState("live");
  useEffect(() => {
    fetch("/api/live").then((r) => r.json()).then((d) => d?.mode && setLiveMode(d.mode)).catch(() => {});
  }, []);

  return (
    <ShareProvider value={report}>
    <AwardNavProvider value={goToAward}>
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

        {/* Share sits at the strip's right end, outside the scrolling part, so
            it stays put while the tabs scroll under it. */}
        <div className="flex items-center border-b-2 border-stone-900 mb-5">
        <div className="flex flex-1 min-w-0 overflow-x-auto no-scrollbar">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === id ? "bg-stone-900 text-white" : "text-stone-500"}`}
            >
              {id === "live" && liveMode === "live" && <span className="text-red-600 mr-1" aria-hidden="true">•</span>}
              {id === "live" && liveMode === "upnext" ? "Up Next" : label}
            </button>
          ))}
        </div>
        <ShareButton query={query} />
        </div>

        {/* Trey vs Spencer: which draft season, then the baseline switch (a
            season page has no selectors of its own). Explore renders its own
            copy of the switch below the By Season/By Player and scope rows —
            see ExploreView. */}
        {tab === "tvs" && (
          <>
            <div className="mb-2 flex gap-1.5" role="tablist" aria-label="Draft season">
              {SEASONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={tvsSeason === s}
                  onClick={() => setTvsSeason(s)}
                  className={`flex-1 text-[10px] font-bold uppercase tracking-[0.2em] px-3 py-2 border ${tvsSeason === s ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"}`}
                >{s}</button>
              ))}
            </div>
            <VABaselineToggle />
          </>
        )}

        {tab === "explore" ? <ExploreView jump={exploreJump} onJumpHandled={clearExploreJump} initial={exploreInit} onInitHandled={clearExploreInit} />
          : tab === "legacy" ? <LegacyView onGoToLeaderboard={goToLeaderboard} /> : tab === "awards" ? <AwardsView onGoToLeaderboard={goToLeaderboard} focus={awardFocus} onFocusHandled={clearAwardFocus} /> : tab === "college" ? <CollegeView /> : tab === "drating" ? <DRatingView /> : tab === "live" ? <LiveView onMode={setLiveMode} /> : tab === "usage" ? <UsageView /> : tab === "draft" ? <DraftView /> : tab === "shotzones" ? <ShotZonesView /> : tab === "info" ? <InfoView /> : <HistoryView season={tvsSeason} />}
      </div>
    </div>
    </AwardNavProvider>
    </ShareProvider>
  );
}


// Shares the current view: the phone's share sheet where there is one (the
// link then previews in Messages, Slack, …), otherwise a copy to the
// clipboard. The URL is the address bar's, which already describes the view.
function ShareButton({ query }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const onShare = async () => {
    const url = window.location.origin + window.location.pathname + query;
    if (navigator.share && window.matchMedia?.("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: "Value Added Tracker", url });
        return;
      } catch (e) {
        if (e?.name === "AbortError") return; // the reader closed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };
  return (
    <button
      type="button"
      onClick={onShare}
      aria-label="Share a link to this view"
      className="shrink-0 ml-1 flex items-center gap-1 pl-2 pr-1 py-2 text-[11px] font-bold uppercase tracking-widest text-stone-500 border-l border-stone-300 hover:text-stone-900"
    >
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 10V2M4.5 5.5 8 2l3.5 3.5M3 9v4.5h10V9" />
      </svg>
      {copied ? "Copied" : "Share"}
    </button>
  );
}
