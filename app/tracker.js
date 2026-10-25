"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HISTORY } from "./historical";
import dynamic from "next/dynamic";
import { ExploreView } from "./components/explore";
import { VAModeProvider, useVAMode } from "./lib/va-mode";
import { shareQuery } from "./lib/share-params";
import { ShareProvider, useShareStore } from "./lib/share-state";
import { AwardNavProvider, PlayerNavProvider } from "./lib/award-nav";

// Explore is the landing tab and ships in the page bundle. Every other tab's
// code loads the first time that tab is opened, so a visit that never leaves
// Explore doesn't download it.
const TabLoading = () => (
  <div className="py-10 text-center text-[13px] text-stone-400">Loading…</div>
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
// Four sections, each a row of views under it. A view's id is what a link's
// ?tab= names (lib/share-params.js), so links from before the regrouping
// still open the same page. Explore's first two entries aren't tabs of their
// own: they're Explore's By Season / By Player, picked here instead of by a
// switch inside the page.
const SECTIONS = [
  { id: "explore", label: "Explore", views: [["season", "By Season"], ["player", "By Player"], ["legacy", "Legacy"], ["awards", "Awards"]] },
  { id: "live", label: "Live", views: [] },
  { id: "tvs", label: "Trey vs Spencer", views: [...SEASONS.map((s) => [s, s]), ["draft", "Draft"]] },
  { id: "lab", label: "Lab", views: [["college", "College"], ["drating", "D Rating"], ["usage", "Usage"], ["shotzones", "Shot Zones"], ["info", "About"]] },
];
const SECTION_OF = {
  explore: "explore", legacy: "explore", awards: "explore",
  live: "live",
  tvs: "tvs", draft: "tvs",
  college: "lab", drating: "lab", usage: "lab", shotzones: "lab", info: "lab",
};
// Trey vs Spencer holds every draft season under one tab; a link still names
// the season itself (?tab=2025-26), so links from before the merge open it.
const tabFromLink = (t) => (SEASONS.includes(t) ? "tvs" : SECTION_OF[t] ? t : "explore");
// Where each section opens when its tab is tapped: the view last read there.
const FIRST_VIEW = { explore: "explore", live: "live", tvs: "tvs", lab: "college" };


function Tracker({ initial }) {
  const [tab, setTab] = useState(() => tabFromLink(initial?.tab));
  const [tvsSeason, setTvsSeason] = useState(() => (SEASONS.includes(initial?.tab) ? initial.tab : SEASONS[0]));
  // Explore's By Season / By Player, held here because the sub-nav picks it.
  const [exploreMode, setExploreMode] = useState(() => (initial?.view === "player" && !initial?.tab ? "player" : "season"));
  const section = SECTION_OF[tab];
  const [lastView, setLastView] = useState(FIRST_VIEW);
  useEffect(() => { setLastView((v) => (v[section] === tab ? v : { ...v, [section]: tab })); }, [section, tab]);
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

  const toTop = () => { if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" }); };

  // A cross-tab jump: Legacy (and MIP) hand over a player-season and which half of it
  // was being read, and Explore opens its leaderboard there. Held here because
  // the two tabs are siblings — Explore unmounts while Legacy is showing, so
  // it picks the target up on mount.
  const [exploreJump, setExploreJump] = useState(null);
  const goToLeaderboard = useCallback((target) => {
    if (!target?.season) return;
    setExploreJump(target);
    setExploreMode("season");
    setTab("explore");
    toTop();
  }, []);
  const clearExploreJump = useCallback(() => setExploreJump(null), []);

  // Any box score's player — Live, About Last Night, a month's games, a
  // series — opens that player's By Player career: { name, slug?, season? }.
  const [careerJump, setCareerJump] = useState(null);
  const goToCareer = useCallback((target) => {
    if (!target?.name && !target?.slug) return;
    setCareerJump(target);
    setExploreMode("player");
    setTab("explore");
    toTop();
  }, []);
  const clearCareerJump = useCallback(() => setCareerJump(null), []);

  // The other direction: a player card's award box (award-boxes.js) opens the
  // Awards tab on that award, season and player.
  const [awardFocus, setAwardFocus] = useState(null);
  const goToAward = useCallback((target) => {
    if (!target?.season || !target?.award) return;
    setAwardFocus(target);
    setTab("awards");
    toTop();
  }, []);
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
    setLiveFocus(target);
    setTab("live");
  }, []);
  const clearLiveFocus = useCallback(() => setLiveFocus(null), []);

  // The sub-nav's active entry, in its own section's terms.
  const activeView = tab === "explore" ? exploreMode : tab === "tvs" ? tvsSeason : tab;
  const pickView = (id) => {
    if (section === "explore" && (id === "season" || id === "player")) { setExploreMode(id); setTab("explore"); }
    else if (section === "tvs" && SEASONS.includes(id)) { setTvsSeason(id); setTab("tvs"); }
    else setTab(id);
  };
  const views = SECTIONS.find((s) => s.id === section)?.views || [];

  return (
    <ShareProvider value={report}>
    <AwardNavProvider value={goToAward}>
    <PlayerNavProvider value={goToCareer}>
    <div className="min-h-screen bg-stone-100">
      <div className="max-w-2xl mx-auto px-4 py-5">
        <header className="mb-3 text-center">
          <div className="text-[15px] italic text-stone-600 leading-none mb-1">Trey&rsquo;s NBA Box Score</div>
          <h1 className="text-[28px] font-bold text-stone-900 leading-none">Value Added Tracker</h1>
        </header>

        {/* Settings and Share sit at the strip's right end, outside the
            scrolling part, so they stay put while the tabs scroll under them. */}
        <nav className="flex items-end border-b border-stone-900">
          <div className="flex flex-1 min-w-0 overflow-x-auto no-scrollbar">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => (s.id === section ? pickView(s.views[0]?.[0] || s.id) : setTab(lastView[s.id]))}
                aria-current={section === s.id ? "page" : undefined}
                className={`px-2.5 first:pl-0 pb-1.5 pt-1 text-[16px] whitespace-nowrap border-b-[3px] -mb-px ${section === s.id ? "border-stone-900 text-stone-900 font-bold" : "border-transparent text-stone-500 hover:text-stone-900"}`}
              >
                {s.id === "live" && liveMode === "live" && <span className="text-red-600 mr-1" aria-hidden="true">•</span>}
                {s.id === "live" && liveMode === "upnext" ? "NBA Today" : s.label}
              </button>
            ))}
          </div>
          <SettingsButton />
          <ShareButton query={query} />
        </nav>
        {views.length > 0 && (
          <div className="flex gap-4 overflow-x-auto no-scrollbar border-b border-stone-300 mb-4">
            {views.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => pickView(id)}
                aria-current={activeView === id ? "page" : undefined}
                className={`py-2 text-[15px] whitespace-nowrap border-b-2 -mb-px ${activeView === id ? "border-stone-900 text-stone-900 font-bold" : "border-transparent text-stone-500 hover:text-stone-900"}`}
              >{label}</button>
            ))}
          </div>
        )}
        {views.length === 0 && <div className="mb-4" />}

        {tab === "explore" ? <ExploreView mode={exploreMode} onModeChange={setExploreMode} jump={exploreJump} onJumpHandled={clearExploreJump} careerJump={careerJump} onCareerJumpHandled={clearCareerJump} initial={exploreInit} onInitHandled={clearExploreInit} liveNight={liveNight} onOpenInLive={goToLive} />
          : tab === "legacy" ? <LegacyView onGoToLeaderboard={goToLeaderboard} /> : tab === "awards" ? <AwardsView onGoToLeaderboard={goToLeaderboard} focus={awardFocus} onFocusHandled={clearAwardFocus} /> : tab === "college" ? <CollegeView /> : tab === "drating" ? <DRatingView /> : tab === "live" ? <LiveView onData={onLiveData} focus={liveFocus} onFocusHandled={clearLiveFocus} /> : tab === "usage" ? <UsageView /> : tab === "draft" ? <DraftView /> : tab === "shotzones" ? <ShotZonesView /> : tab === "info" ? <InfoView /> : <HistoryView season={tvsSeason} />}
      </div>
    </div>
    </PlayerNavProvider>
    </AwardNavProvider>
    </ShareProvider>
  );
}


// The one app-wide setting: which scoring baseline every VA on the page is
// priced against (lib/va-mode.js). It used to be a switch repeated on each
// tab it applied to; it changes everything at once, so it lives up here.
function SettingsButton() {
  const { usgAdj, setUsgAdj } = useVAMode();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const opt = (on, label, note) => (
    <button
      type="button"
      onClick={() => { setUsgAdj(on); setOpen(false); }}
      aria-pressed={usgAdj === on}
      className={`w-full text-left px-3 py-2 ${usgAdj === on ? "bg-stone-100" : "hover:bg-stone-50"}`}
    >
      <div className={`text-[15px] ${usgAdj === on ? "font-bold text-stone-900" : "text-stone-700"}`}>{usgAdj === on ? "✓ " : ""}{label}</div>
      <div className="text-[14px] text-stone-500 leading-snug">{note}</div>
    </button>
  );
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Settings"
        aria-expanded={open}
        className={`relative p-2 ${open ? "text-stone-900" : "text-stone-500 hover:text-stone-900"}`}
      >
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 4h7M13 4h1M2 12h2M8 12h6" />
          <circle cx="11" cy="4" r="1.8" /><circle cx="6" cy="12" r="1.8" />
        </svg>
        {usgAdj && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-stone-900" aria-hidden="true" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-white border border-stone-300 shadow-lg py-1">
          <div className="px-3 pt-1.5 pb-1 text-[14px] text-stone-500">Scoring baseline</div>
          {opt(false, "League average", "Scoring priced against the league’s median minute")}
          {opt(true, "Usage-adjusted", "Scoring priced against the possessions a player used")}
        </div>
      )}
    </div>
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
      aria-label={copied ? "Link copied" : "Share a link to this view"}
      title={copied ? "Link copied" : "Share"}
      className="shrink-0 p-2 pr-0 text-stone-500 hover:text-stone-900"
    >
      {copied ? (
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5 6.5 12 13 4.5" /></svg>
      ) : (
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 10V2M4.5 5.5 8 2l3.5 3.5M3 9v4.5h10V9" />
        </svg>
      )}
    </button>
  );
}
