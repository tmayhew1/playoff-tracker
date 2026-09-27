"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { LiveGameBanner } from "./boxscore";
import { SeriesAverages } from "./history";
import { PlayoffLeaderboard } from "./leaderboard";
import { teamColor, withAlpha } from "../lib/format";
import { useSeasonLga } from "../lib/va-mode";
import { buildScoped } from "../lib/fetch-cache";
import dynamic from "next/dynamic";
import { useShareReport } from "../lib/share-state";
import { LastNight } from "./last-night";
import { CommandPalette, loadPlayerIndex } from "./command-palette";
import { Segmented } from "./ui/segmented";
import { useShareState } from "../lib/share-state";
import { useVAMode } from "../lib/va-mode";

// By Season is the default mode; By Player's code loads when it's first
// opened (see app/page.js for the same treatment of the other tabs).
const PlayerExplorer = dynamic(
  () => import("./player-explorer").then((m) => m.PlayerExplorer),
  { loading: () => <div className="py-10 text-center text-[11px] uppercase tracking-widest text-stone-400">Loading…</div> },
);


export const ROUND_LABELS = { r1: "First Round", r2: "Conf Semis", r3: "Conf Finals", r4: "Finals" };


export function ExploreSeriesRow({ s, lga, season }) {
  // Series score from the games themselves, so a best-of-5 reads 3–2.
  const wins = Object.fromEntries(s.teams.map((t) => [t, 0]));
  for (const g of s.games) {
    const w = g.home.score > g.away.score ? g.home.tri : g.away.tri;
    if (w in wins) wins[w]++;
  }
  const side = (code) => {
    const c = teamColor(code);
    const won = s.winner === code;
    return (
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
        style={won ? { background: `linear-gradient(90deg, ${withAlpha(c, 0.16)}, ${withAlpha(c, 0.02)})` } : undefined}>
        <span className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0"
          style={{ background: c, boxShadow: `0 0 0 2px #fff, 0 0 0 3px ${withAlpha(c, 0.35)}` }}>{code}</span>
        <span className={`flex-1 text-[12px] ${won ? "font-semibold text-stone-700" : "text-stone-400"}`}>{s.round === "r4" ? (won ? "Champion" : "Runner-up") : (won ? "Advanced" : "Out")}</span>
        <span className={`text-[22px] font-black tabular-nums ${won ? "" : "text-stone-300"}`} style={won ? { color: c } : undefined}>{wins[code]}</span>
      </div>
    );
  };
  return (
    <div className="cs-card mb-3 p-2">
      <div className="flex flex-col gap-0.5">
        {side(s.teams[0])}
        {side(s.teams[1])}
      </div>
      {s.games.length > 0 ? (
        <>
          <SeriesAverages games={s.games} teamsMap={{}} lga={lga} boxSrc="espn" useTeamColor season={season} />
          {s.games.map((g, i) => {
            const liveGame = {
              gameId: g.gameId,
              gameCode: g.gameCode,
              gameStatus: 3,
              gameStatusText: "Final",
              gameDateTimeUTC: g.gameDateTimeUTC,
              home: { tri: g.home.tri, score: g.home.score },
              away: { tri: g.away.tri, score: g.away.score },
            };
            return (
              <LiveGameBanner
                key={g.gameId || i}
                liveGame={liveGame}
                gameLabel={`Game ${i + 1}`}
                lga={lga}
                teams={{}}
                useTeamColor
              />
            );
          })}
        </>
      ) : (
        <div className="mt-1 text-[10px] text-stone-400 italic text-center py-1">No games</div>
      )}
    </div>
  );
}


export function ExploreRoundSection({ roundKey, series, lga, season }) {
  const [open, setOpen] = useState(false);
  if (series.length === 0) return null;
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="cs-press w-full flex items-center justify-between px-4 py-3 mb-2 rounded-2xl bg-white/70 border border-stone-200 text-left hover:bg-white"
      >
        <h3 className="text-[14px] font-bold text-stone-900">{ROUND_LABELS[roundKey] || roundKey}</h3>
        <span className="flex items-center gap-2 text-[12px] text-stone-500">
          {series.length} series
          <span className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`} aria-hidden>›</span>
        </span>
      </button>
      {open && series.map((s, i) => (
        <ExploreSeriesRow key={i} s={s} lga={lga} season={season} />
      ))}
    </div>
  );
}


// Seasons available in the picker. ESPN's NBA scoreboard reliably covers
// 1999-00 onward; earlier seasons return empty/erroring responses.
export function exploreSeasonList() {
  // Synchronous fallback used until /api/seasons resolves. Covers the same
  // ESPN-supported range the route emits (1999-00 onward, newest first).
  const seasons = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 1; y >= 1999; y--) {
    const end = String((y + 1) % 100).padStart(2, "0");
    seasons.push(`${y}-${end}`);
  }
  return seasons;
}


// `jump` is an arrival from another tab — the Legacy season drop-down asking
// for this board, on a given season, scoped to the half it was read from and
// filtered to that player's team. Same shape the in-tab "Go →" navigations
// already use, plus the scope, since a Legacy season has two halves and the
// caller knows which one was tapped.
//
// `initial` is an opening link's Explore state (lib/share-params.js), read
// once on mount: the view, scope and season it names, and the player — and
// the comparison — to open, handed to the leaderboard / By Player as the
// same pending navigation their own in-page jumps use.
export function ExploreView({ jump = null, onJumpHandled = null, initial = null, onInitHandled = null }) {
  // Season list is fetched from /api/seasons so newly-baked old seasons
  // (filled in by the daily-backfill workflow) show up automatically on
  // next deploy. exploreSeasonList() is the synchronous fallback used
  // until the fetch resolves so the picker isn't empty on first paint.
  const FALLBACK = useMemo(() => exploreSeasonList(), []);
  const [linked] = useState(initial);
  const [seasons, setSeasons] = useState(() => (linked?.season && !FALLBACK.includes(linked.season)
    ? [...FALLBACK, linked.season].sort((a, b) => b.localeCompare(a)) : FALLBACK));
  const [season, setSeason] = useState(linked?.season || FALLBACK[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(linked?.view === "player" ? "player" : "season"); // "season" | "player"
  // Which games count: regular season, playoffs, or both summed. Applies to
  // both By Season and By Player.
  const [scope, setScope] = useState(linked?.scope || "combined"); // "regular" | "playoffs" | "combined"
  // A pending navigation into By Season, applied by the leaderboard once that
  // season's rows have loaded. Two shapes:
  //   { season, team, name, slug } — a player-season, from a compare panel's
  //     compared-player chip or a By Player team card: filter to their team
  //     and expand their row.
  //   { season, team }             — a team-season with no player attached:
  //     just filter the board to that team.
  // A player-season target may also carry `compare: { season, name, slug }` —
  // the compare panel's career-year gate asking the row it opens to land
  // already comparing against that player-season.
  const linkedCompare = linked?.vs ? { slug: linked.vs.slug, season: linked.vs.season, name: null } : null;
  const [seasonNav, setSeasonNav] = useState(() => (linked?.view !== "player" && linked?.p && linked?.season
    ? { season: linked.season, team: null, name: null, slug: linked.p, compare: linkedCompare } : null));
  // Called by a By Season compare panel (via context.onNavigateToPlayer) when
  // the user taps the compared player's chip: switch the leaderboard to that
  // player's season and hand the target down for the leaderboard to open.
  const navigateSeasonToPlayer = useCallback((target) => {
    if (!target) return;
    setMode("season");
    setSeason(target.season);
    setSeasonNav(target);
  }, []);
  // Called from By Player when the user arms the Team header and taps a team
  // card: cross over to By Season for that card's season, filtered to that
  // team, with the player whose career we were reading opened in place. The
  // scope (regular / playoffs / combined) is whatever By Player was already
  // showing — it's the same selector for both modes, so it just rides along
  // untouched. The player rides along the same way the compare-chip
  // navigation carries one, so the leaderboard has a single nav shape to
  // apply; a target without one still just filters to the team.
  const navigateSeasonToTeam = useCallback((target) => {
    if (!target?.season || !target?.team) return;
    setMode("season");
    setSeason(target.season);
    setSeasonNav({ season: target.season, team: target.team, name: target.name || null, slug: target.slug || null });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const clearSeasonNav = useCallback(() => setSeasonNav(null), []);

  // Apply an arrival from another tab. The season may predate the picker's
  // live fallback range (Legacy reaches back to 1980-81), so it is added to
  // the list rather than left as a value with no option behind it — the
  // /api/seasons fetch will supply it too, just not necessarily first.
  useEffect(() => {
    if (!jump?.season) return;
    setMode("season");
    setScope(jump.scope === "regular" ? "regular" : "playoffs");
    setSeasons((prev) => (prev.includes(jump.season)
      ? prev : [...prev, jump.season].sort((a, b) => b.localeCompare(a))));
    setSeason(jump.season);
    setSeasonNav({
      season: jump.season,
      team: jump.team || null,
      name: jump.name || null,
      slug: jump.slug || null,
    });
    onJumpHandled?.();
  }, [jump, onJumpHandled]);

  // The mirror image of navigateSeasonToTeam: a pending navigation into By
  // Player — { name, slug, season } — applied by the player explorer once its
  // index for the current scope has loaded.
  const [playerNav, setPlayerNav] = useState(() => (linked?.view === "player" && linked?.p
    ? { slug: linked.p, name: null, season: linked.ps || null, compare: linked.ps ? linkedCompare : null } : null));
  // Taken: let the tracker drop it, so a later return to Explore starts fresh.
  useEffect(() => { if (linked) onInitHandled?.(); }, [linked, onInitHandled]);
  // Called from By Season when the user arms the Player header and taps a name:
  // cross over to By Player for that player, with the leaderboard's season
  // already drilled in. Scope rides along untouched (same selector both modes).
  const navigatePlayerToSeason = useCallback((target) => {
    if (!target?.name && !target?.slug) return;
    setMode("player");
    setPlayerNav(target);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  // The same crossing for a RUN — a By Season compare panel's chip pointing at
  // a side that pools several seasons (a compared run, or a selection made in
  // the panel's career chart). There is no single season for the leaderboard to
  // land on, and a run's home is the By Player table with those seasons ticked,
  // so this always crosses over. `seasons` rides along in the same pending
  // target the season crossing uses.
  const navigatePlayerToRun = useCallback((target) => {
    if (!target?.seasons?.length || (!target.name && !target.slug)) return;
    setMode("player");
    setPlayerNav({ name: target.name || null, slug: target.slug || null, season: null, seasons: target.seasons });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const clearPlayerNav = useCallback(() => setPlayerNav(null), []);

  useEffect(() => {
    let cancelled = false;
    fetch(buildScoped("/api/seasons"))
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d?.seasons?.length) return;
        setSeasons(d.seasons);
        // Switch the default to the newest entry the route reports, but
        // only if the user hasn't already navigated somewhere else.
        // A linked season is a choice too.
        setSeason((cur) => (cur === FALLBACK[0] && !linked?.season ? d.seasons[0] : cur));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [FALLBACK, linked]);

  useEffect(() => {
    // Series box scores only exist for the playoffs; the other scopes render
    // just the leaderboard.
    if (mode !== "season" || scope !== "playoffs") return;
    let cancelled = false;
    setData(null);
    setError(null);
    setLoading(true);
    fetch(buildScoped(`/api/history?season=${season}`))
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
        return d;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => !cancelled && setError(e.message || "Load failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [season, mode, scope]);

  // Whichever baseline the USG-ADJ switch is on (lib/va-mode.js). Two of them,
  // because this view holds both sides of the season: `lga` is the regular
  // season, which PlayoffLeaderboard needs for its rs/combined scopes (and from
  // which it derives its own playoff baseline), while the series box scores
  // below are playoff games and take the blended playoff baseline (spec §4.8).
  const lga = useSeasonLga(season);
  const poLga = useSeasonLga(season, "po");
  const byRound = useMemo(() => {
    const out = { r1: [], r2: [], r3: [], r4: [] };
    for (const s of data?.series || []) {
      if (out[s.round]) out[s.round].push(s);
    }
    return out;
  }, [data]);

  useShareReport({ view: mode, scope, season: mode === "season" ? season : null });

  const { usgAdj, setUsgAdj } = useVAMode();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  // "/" or ⌘K / Ctrl-K opens search from anywhere on Explore, unless the
  // reader is already typing in a field.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "") || e.target?.isContentEditable;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div>
      <ExploreHero onSearch={openPalette} />
      <LastNight onOpenPlayer={navigatePlayerToSeason} />

      <div className="cs-card p-2 mb-4 flex flex-col gap-2">
        <Segmented
          ariaLabel="Explore by"
          value={mode}
          onChange={setMode}
          options={[{ value: "season", label: "Season leaders" }, { value: "player", label: "Player careers" }]}
          className="w-full"
        />
        <Segmented
          ariaLabel="Which games count"
          size="sm"
          value={scope}
          onChange={setScope}
          options={[{ value: "combined", label: "All games" }, { value: "regular", label: "Regular season" }, { value: "playoffs", label: "Playoffs" }]}
          className="w-full"
        />
        <div className="flex items-center gap-2 pl-2">
          {/* Prices the games the other two choose — the league-median
              minute, or possessions used (lib/va-mode.js). */}
          <span className="text-[11px] text-stone-500 flex-1">Scoring baseline</span>
          <Segmented
            ariaLabel="Scoring baseline"
            size="sm"
            value={usgAdj ? "usg" : "lg"}
            onChange={(v) => setUsgAdj(v === "usg")}
            options={[{ value: "lg", label: "Lg avg" }, { value: "usg", label: "Usg-adj" }]}
            className="ml-auto"
          />
        </div>
      </div>

      {mode === "player" ? (
        <PlayerExplorer
          scope={scope}
          onOpenTeamSeason={navigateSeasonToTeam}
          pendingPlayer={playerNav}
          onPlayerNavHandled={clearPlayerNav}
        />
      ) : (
        <>
          <SeasonRail seasons={seasons} season={season} onChange={setSeason} />

          {scope !== "playoffs" ? (
            <PlayoffLeaderboard season={season} lga={lga} scope={scope} pendingNav={seasonNav} onNavigateToPlayer={navigateSeasonToPlayer} onNavHandled={clearSeasonNav} onOpenPlayerSeason={navigatePlayerToSeason} onOpenPlayerRun={navigatePlayerToRun} />
          ) : (
            <>
              {loading && <BoardSkeleton label={`Loading the ${season} playoffs`} />}
              {error && !loading && <div className="text-[10px] text-red-600 py-4 text-center px-2 break-words">Couldn’t load games — {error}</div>}
              {!loading && !error && data && (
                <>
                  <PlayoffLeaderboard season={season} lga={lga} scope={scope} pendingNav={seasonNav} onNavigateToPlayer={navigateSeasonToPlayer} onNavHandled={clearSeasonNav} onOpenPlayerSeason={navigatePlayerToSeason} onOpenPlayerRun={navigatePlayerToRun} />
                  <h2 className="mt-6 mb-2 px-1 text-[20px] font-black text-stone-900" style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}>The bracket</h2>
                  {(["r1", "r2", "r3", "r4"]).map((rk) => (
                    <ExploreRoundSection key={rk} roundKey={rk} series={byRound[rk]} lga={poLga} season={season} />
                  ))}
                  {data.series && data.series.length === 0 && (
                    <div className="text-[10px] text-stone-400 italic py-4 text-center">No playoff games found for {season}</div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      <ActionDock mode={mode} season={season} onSearch={openPalette}
        onOpenCareer={(slug) => navigatePlayerToSeason({ slug, name: null, season })} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)}
        onPick={({ slug, name }) => navigatePlayerToSeason({ slug, name, season: null })} />
    </div>
  );
}


const display = { fontFamily: "var(--font-playfair), Georgia, serif" };

// The top of Explore: its name, and the way in for anyone who already knows
// who they're looking for. The index starts loading on first touch, so the
// palette usually opens with it already there.
function ExploreHero({ onSearch }) {
  const [count, setCount] = useState(null);
  const warm = () => { loadPlayerIndex().then((p) => setCount(p.length)).catch(() => {}); };
  return (
    <div className="mb-4">
      <div className="flex items-end justify-between px-1 mb-2">
        <h2 className="text-[28px] leading-none font-black text-stone-900 tracking-tight" style={display}>Explore</h2>
        <span className="text-[11px] text-stone-500">Every box score since 1980-81</span>
      </div>
      <button
        type="button"
        onClick={onSearch}
        onPointerEnter={warm}
        onFocus={warm}
        onTouchStart={warm}
        className="cs-press cs-card w-full flex items-center gap-3 px-4 py-3 text-left hover:shadow-md"
        aria-label="Search players"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#57534e" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <span className="flex-1 text-[15px] text-stone-400">Search {count ? `${count.toLocaleString("en-US")} players` : "players"}…</span>
        <kbd className="hidden sm:inline text-[11px] font-sans font-semibold text-stone-400 border border-stone-200 rounded-md px-1.5 py-0.5">/</kbd>
      </button>
    </div>
  );
}

// Seasons as a swipeable rail of chips, newest first, with the chosen one
// kept in view. Decades get a small marker so a long swipe back stays oriented.
function SeasonRail({ seasons, season, onChange }) {
  const railRef = useRef(null);
  useEffect(() => {
    const rail = railRef.current;
    const el = rail?.querySelector(`[data-season="${season}"]`);
    if (!rail || !el) return;
    // Scroll the rail only — scrollIntoView would move the page as well.
    const left = el.offsetLeft - rail.clientWidth / 2 + el.offsetWidth / 2;
    rail.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [season, seasons]);
  return (
    <div className="mb-3">
      {/* Bleeds to the screen edges (-mx-4 against the page's px-4) so the
          next chip peeks in; the padding keeps the first one on the grid. */}
      <div ref={railRef} className="cs-rail gap-1.5 py-2 -mx-4 px-4 scroll-px-4" role="radiogroup" aria-label="Season">
        {seasons.map((s, i) => {
          const on = s === season;
          const decade = i === 0 || s.slice(2, 3) !== seasons[i - 1].slice(2, 3);
          return (
            <button
              key={s}
              data-season={s}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(s)}
              className={`cs-press relative px-3.5 py-2 rounded-full text-[13px] font-semibold tabular-nums whitespace-nowrap border ${on ? "bg-stone-900 text-white border-stone-900 shadow-[0_6px_16px_-8px_rgba(0,0,0,0.6)]" : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"}`}
            >
              {decade && i > 0 && <span className="absolute -top-1.5 left-2 text-[8px] font-bold text-stone-400 bg-[#f5f5f4] px-0.5">{s.slice(0, 3)}0s</span>}
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BoardSkeleton({ label }) {
  return (
    <div className="cs-card p-3 mb-4" role="status" aria-label={label}>
      <div className="cs-skeleton h-4 w-1/3 mb-4" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <span className="cs-skeleton w-8 h-8 rounded-full" />
          <span className="cs-skeleton h-3 flex-1" style={{ maxWidth: `${70 - i * 7}%` }} />
          <span className="cs-skeleton h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

// Floating actions that follow what's on screen: with a player open, share
// him or jump between his season and his career; scrolled deep, search and
// back to the top. It steps up out of the way of the leaderboard's own
// pinned "Show top 10" bar when that's showing.
function ActionDock({ mode, season, onSearch, onOpenCareer }) {
  const share = useShareState();
  const [deep, setDeep] = useState(false);
  const [toast, setToast] = useState(null);
  useEffect(() => {
    const onScroll = () => setDeep(window.scrollY > 700);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);
  const player = share.p || null;
  if ((!player && !deep) || typeof document === "undefined") return null;

  const doShare = async () => {
    const url = window.location.href;
    if (navigator.share && window.matchMedia?.("(pointer: coarse)").matches) {
      try { await navigator.share({ title: "Value Added Tracker", url }); return; } catch (e) { if (e?.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); setToast("Link copied"); } catch { window.prompt("Copy this link:", url); }
  };
  const btn = "cs-press flex items-center gap-1.5 px-3.5 py-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap";
  const Icon = ({ d }) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
  );
  // Portaled to <body>: anything animated above it on the page is its own
  // stacking context, which would trap the dock's z-index beneath later
  // content. Centered by a full-width flex row rather than a translate, which
  // the entrance animation (it ends on transform: none) would undo.
  return createPortal(
    <div
      className="fixed inset-x-0 z-40 flex justify-center pointer-events-none transition-[bottom] duration-300"
      style={{ bottom: `calc(${share.boardPinned ? 64 : 16}px + env(safe-area-inset-bottom))` }}
    >
      <div className="cs-sheet relative pointer-events-auto">
      {toast && <div className="cs-fade absolute -top-9 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-stone-900 text-white text-[11px] font-semibold whitespace-nowrap">{toast}</div>}
      <div className="flex items-center gap-1 p-1 rounded-full bg-stone-900 text-white ring-1 ring-white/10 shadow-[0_14px_36px_-12px_rgba(0,0,0,0.65)]">
        {player && mode === "season" && (
          <button type="button" className={`${btn} bg-white text-stone-900`} onClick={() => onOpenCareer(player)} aria-label="Open this player's career">
            <Icon d="M3 17l6-6 4 4 8-8M14 7h7v7" />Career
          </button>
        )}
        {player && (
          <button type="button" className={`${btn} hover:bg-white/10`} onClick={doShare} aria-label="Share a link to this view">
            <Icon d="M12 15V3M8.5 6.5 12 3l3.5 3.5M5 11v9h14v-9" />Share
          </button>
        )}
        <button type="button" className={`${btn} hover:bg-white/10`} onClick={onSearch} aria-label="Search players">
          <Icon d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-3.5-3.5" />Search
        </button>
        {deep && (
          <button type="button" className={`${btn} hover:bg-white/10 px-3`} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top">
            <Icon d="M12 19V5M5 12l7-7 7 7" />
          </button>
        )}
      </div>
      </div>
    </div>,
    document.body,
  );
}
