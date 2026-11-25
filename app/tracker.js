"use client";

import { Component, useCallback, useEffect, useRef, useState } from "react";
import { HISTORY } from "./historical";
import dynamic from "next/dynamic";
import { ExploreView } from "./components/explore";
import { VABaselineToggle } from "./components/va-baseline-toggle";
import { VAModeProvider, useVAMode } from "./lib/va-mode";
import { parseShareParams, shareQuery } from "./lib/share-params";
import { ShareProvider, useShareStore } from "./lib/share-state";
import { AwardNavProvider } from "./lib/award-nav";
import { PlayerNavProvider } from "./lib/player-nav";
import { GamesNavProvider } from "./lib/games-nav";
import { scrollBehavior } from "./lib/motion";
import { currentEntryKey, entryFromState, pushJump, replaceUrl, restoreScroll, saveScroll, shownEntryKey } from "./lib/nav-history";

// Explore is the landing tab and ships in the page bundle. Every other tab's
// code loads the first time that tab is opened, so a visit that never leaves
// Explore doesn't download it.
const TabLoading = () => (
  <div className="py-10 text-center text-[11px] uppercase tracking-widest text-stone-400">Loading…</div>
);
const lazyView = (load) => dynamic(load, { loading: TabLoading });

// Catches a render error inside one tab (a data shape nobody expected, a lazy
// chunk that failed to download) so it costs that tab, not the page: the
// header and the tab strip stay up, and the reader can retry or go elsewhere.
// One per mounted tab, so the error stays with the tab it happened in.
class TabBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="p-4 bg-white border border-stone-300 text-center">
        <p className="text-sm text-stone-700 mb-3">This tab hit an error and couldn’t be shown.</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest bg-stone-900 text-white"
        >Try again</button>
      </div>
    );
  }
}
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
  ["legacy", "Legacy"],
  ["awards", "Awards"],
  ["college", "College"],
  ["drating", "D Rating"],
  ["usage", "Usage"],
  ["shotzones", "Shot Zones"],
  ["info", "Info"],
  ["tvs", "Trey vs Spencer"],
  ["draft", "Draft"],
];
const TAB_IDS = new Set(TABS.map(([id]) => id));
// Trey vs Spencer holds every draft season under one tab; a link still names
// the season itself (?tab=2025-26), so links from before the merge open it.
const tabFromLink = (t) => (SEASONS.includes(t) ? "tvs" : TAB_IDS.has(t) ? t : "explore");

// How many tabs a jump leaves mounted behind the one showing, so Back returns
// to them as they were (see Tracker).
const MAX_KEPT = 3;


function Tracker({ initial }) {
  const [tab, setTab] = useState(() => tabFromLink(initial?.tab));
  const tabRef = useRef(tab);
  tabRef.current = tab;
  // The tab strip scrolls sideways on a phone, so the open tab can sit off
  // its edge — a shared link to College or Draft, or a jump from another
  // tab. Bring it into the strip (never the page: only scrollLeft moves).
  const tabStripRef = useRef(null);
  useEffect(() => {
    const strip = tabStripRef.current;
    const cur = strip?.querySelector('[aria-current="page"]');
    if (!strip || !cur) return;
    const lo = cur.offsetLeft - strip.offsetLeft, hi = lo + cur.offsetWidth;
    if (lo < strip.scrollLeft) strip.scrollLeft = lo;
    else if (hi > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = hi - strip.clientWidth;
  }, [tab]);
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
  // replaceState, so navigating inside the page doesn't stack history entries;
  // only a jump adds one (below).
  const { state: share, report } = useShareStore();
  const { usgAdj } = useVAMode();
  const query = shareQuery({ ...share, tab: tab === "tvs" ? tvsSeason : tab, usg: usgAdj });
  useEffect(() => {
    if (window.location.search !== query) replaceUrl(window.location.pathname + query);
  }, [query]);

  // Back and Forward across jumps (lib/nav-history.js). A jump pushes a history
  // entry, and the tab it left from stays mounted, hidden, so going Back shows
  // it exactly as it was: the open career, the paged-in rows, the search typed.
  // `kept` lists those tabs with the entry each belongs to. An entry whose view
  // isn't kept (an older one, a jump inside Explore, a reload since) is rebuilt
  // from its URL the way an opening link is, by remounting that tab.
  const [kept, setKept] = useState([]);
  const keptRef = useRef(kept);
  keptRef.current = kept;
  const [epochs, setEpochs] = useState({});
  useEffect(() => { currentEntryKey(); }, []);
  const startJump = useCallback((toTab) => {
    const from = pushJump();
    if (!from) return;
    const fromTab = tabRef.current;
    if (toTab && toTab !== fromTab) {
      setKept((k) => [{ tab: fromTab, key: from }, ...k.filter((x) => x.tab !== fromTab && x.tab !== toTab)].slice(0, MAX_KEPT));
    }
  }, []);

  const [restore, setRestore] = useState(null);
  useEffect(() => {
    if (!restore) return;
    return restoreScroll(restore.y);
  }, [restore]);
  useEffect(() => {
    const onPop = (e) => {
      const entry = entryFromState(e.state);
      const fromKey = shownEntryKey(), fromTab = tabRef.current;
      const linked = parseShareParams(new URLSearchParams(window.location.search));
      const toTab = tabFromLink(linked.tab);
      const hit = entry?.k ? keptRef.current.find((x) => x.key === entry.k && x.tab === toTab) : null;
      setKept((k) => {
        const rest = k.filter((x) => x.tab !== toTab && x.tab !== fromTab);
        return (fromKey && fromTab !== toTab ? [{ tab: fromTab, key: fromKey }, ...rest] : rest).slice(0, MAX_KEPT);
      });
      if (!hit) {
        // Not kept: rebuild the tab from the entry's URL.
        if (toTab === "explore") setExploreInit(linked);
        if (toTab === "tvs" && SEASONS.includes(linked.tab)) setTvsSeason(linked.tab);
        setEpochs((ep) => ({ ...ep, [toTab]: (ep[toTab] || 0) + 1 }));
      }
      setTab(toTab);
      currentEntryKey();
      setRestore({ y: entry?.y || 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Keep the entry's scroll position current, so Back can return to it.
  useEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    let t = 0;
    const onScroll = () => {
      clearTimeout(t);
      t = setTimeout(() => saveScroll(), 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { clearTimeout(t); window.removeEventListener("scroll", onScroll); };
  }, []);
  // A tap on the tab strip isn't a jump: no history entry, and the tabs kept
  // for Back stay as they are (one tapped back into shows as it was left).

  // A cross-tab jump: Legacy (and MIP) hand over a player-season and which half of it
  // was being read, and Explore opens its leaderboard there. Held here because
  // the two tabs are siblings — Explore unmounts while Legacy is showing, so
  // it picks the target up on mount.
  const [exploreJump, setExploreJump] = useState(null);
  const goToLeaderboard = useCallback((target) => {
    if (!target?.season) return;
    startJump("explore");
    setExploreJump(target);
    setTab("explore");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: scrollBehavior() });
  }, [startJump]);
  const clearExploreJump = useCallback(() => setExploreJump(null), []);

  // The same hand-over into By Player: an armed Player header (a box score's,
  // a category card's rankings — lib/player-nav.js) names a player, and
  // Explore opens their career, on whichever tab the tap happened.
  const [playerJump, setPlayerJump] = useState(null);
  const goToPlayer = useCallback((target) => {
    if (!target?.name && !target?.slug) return;
    startJump("explore");
    setPlayerJump(target);
    setTab("explore");
  }, [startJump]);
  const clearPlayerJump = useCallback(() => setPlayerJump(null), []);

  // And into By Season's game list: a category card's "Recent games" names a
  // player-season and team, and Explore opens that team's games on the
  // player's latest one (lib/games-nav.js).
  const [gameJump, setGameJump] = useState(null);
  const goToRecentGames = useCallback((target) => {
    if (!target?.season || !target?.team) return;
    startJump("explore");
    setGameJump(target);
    setTab("explore");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: scrollBehavior() });
  }, [startJump]);
  const clearGameJump = useCallback(() => setGameJump(null), []);

  // The other direction: a player card's award box (award-boxes.js) opens the
  // Awards tab on that award, season and player.
  const [awardFocus, setAwardFocus] = useState(null);
  const goToAward = useCallback((target) => {
    if (!target?.season || !target?.award) return;
    startJump("awards");
    setAwardFocus(target);
    setTab("awards");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: scrollBehavior() });
  }, [startJump]);
  const clearAwardFocus = useCallback(() => setAwardFocus(null), []);

  // The Live tab reads "NBA Today" once the night's games are over (see
  // LiveView). Asked once here so the label is right before the tab is
  // opened; LiveView keeps it current from its own polling after that.
  // `liveNight` is the finished slate the tab shows box scores for, so
  // About Last Night (Explore) knows when a player's game is over there.
  const [liveMode, setLiveMode] = useState("live");
  const [liveNight, setLiveNight] = useState(null);
  const onLiveData = useCallback((d) => {
    if (!d?.mode) return;
    setLiveMode(d.mode);
    setLiveNight(d.mode === "upnext" ? d.prev?.date || null : d.games?.some((g) => g.gameStatus === 3) ? d.date : null);
  }, []);
  useEffect(() => {
    fetch("/api/live").then((r) => r.json()).then(onLiveData).catch(() => {});
  }, [onLiveData]);
  // About Last Night's tap: the Live tab, with that player's card open.
  const [liveFocus, setLiveFocus] = useState(null);
  const goToLive = useCallback((target) => {
    startJump("live");
    setLiveFocus(target);
    setTab("live");
  }, [startJump]);
  const clearLiveFocus = useCallback(() => setLiveFocus(null), []);

  return (
    <ShareProvider value={report}>
    <AwardNavProvider value={goToAward}>
    <PlayerNavProvider value={goToPlayer}>
    <GamesNavProvider value={goToRecentGames}>
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
        <nav aria-label="Sections" className="flex items-center border-b-2 border-stone-900 mb-5">
        <div ref={tabStripRef} className="flex flex-1 min-w-0 overflow-x-auto no-scrollbar">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === id ? "bg-stone-900 text-white" : "text-stone-500"}`}
            >
              {id === "live" && liveMode === "live" && <span className="text-red-600 mr-1" aria-hidden="true">•</span>}
              {id === "live" && liveMode === "upnext" ? "NBA Today" : label}
            </button>
          ))}
        </div>
        <ShareButton query={query} />
        </nav>

        <main>

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

        {/* The showing tab, and any kept for Back, hidden. One list in a fixed
            order, keyed by tab, so a kept tab coming back into view is the
            same instance rather than a fresh mount. */}
        {TABS.map(([id]) => (id === tab || kept.some((x) => x.tab === id)) && (
          <div key={`${id}:${epochs[id] || 0}`} hidden={id !== tab}>
            <TabBoundary>
              {id === "explore" ? <ExploreView jump={exploreJump} onJumpHandled={clearExploreJump} playerJump={playerJump} onPlayerJumpHandled={clearPlayerJump} gameJump={gameJump} onGameJumpHandled={clearGameJump} initial={exploreInit} onInitHandled={clearExploreInit} liveNight={liveNight} onOpenInLive={goToLive} />
                : id === "legacy" ? <LegacyView onGoToLeaderboard={goToLeaderboard} /> : id === "awards" ? <AwardsView onGoToLeaderboard={goToLeaderboard} focus={awardFocus} onFocusHandled={clearAwardFocus} /> : id === "college" ? <CollegeView /> : id === "drating" ? <DRatingView /> : id === "live" ? <LiveView onData={onLiveData} focus={liveFocus} onFocusHandled={clearLiveFocus} /> : id === "usage" ? <UsageView /> : id === "draft" ? <DraftView /> : id === "shotzones" ? <ShotZonesView /> : id === "info" ? <InfoView /> : <HistoryView season={tvsSeason} />}
            </TabBoundary>
          </div>
        ))}
        </main>
      </div>
    </div>
    </GamesNavProvider>
    </PlayerNavProvider>
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
