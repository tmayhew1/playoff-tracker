"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { lgaForSeason } from "../scoring";
import { LiveGameBanner } from "./boxscore";
import { SeriesAverages } from "./history";
import { PlayoffLeaderboard } from "./leaderboard";
import { PlayerExplorer } from "./player-explorer";
import { teamColor, withAlpha } from "../lib/format";


export const ROUND_LABELS = { r1: "First Round", r2: "Conf Semis", r3: "Conf Finals", r4: "Finals" };


export function ExploreSeriesRow({ s, lga, season }) {
  const teamCell = (code, isWinner) => {
    const c = teamColor(code);
    const style = isWinner
      ? { backgroundColor: withAlpha(c, 0.14), borderColor: c }
      : { backgroundColor: "#ffffff", borderColor: withAlpha(c, 0.35) };
    return (
      <div
        style={style}
        className={`flex-1 px-2 py-1.5 border ${isWinner ? "border-2" : ""}`}
      >
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
          <span className="text-sm font-semibold" style={{ color: isWinner ? c : "#1c1917" }}>{code}</span>
          {isWinner && <span className="ml-auto text-[10px]" style={{ color: c }}>✓</span>}
        </div>
      </div>
    );
  };
  return (
    <div className="mb-3 p-2 bg-stone-50 border border-stone-200 rounded">
      <div className="flex gap-1.5 items-stretch">
        {teamCell(s.teams[0], s.winner === s.teams[0])}
        <div className="flex items-center justify-center px-1 text-[10px] font-bold text-stone-400 tracking-widest">VS</div>
        {teamCell(s.teams[1], s.winner === s.teams[1])}
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
    <div className="mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-baseline justify-between mb-2 pb-1.5 border-b-2 border-stone-900 text-left"
      >
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 flex items-center gap-2">
          <span className="text-stone-400 text-[10px]">{open ? "▾" : "▸"}</span>
          {ROUND_LABELS[roundKey] || roundKey}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-stone-400">{series.length} series</span>
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


export function ExploreView() {
  // Season list is fetched from /api/seasons so newly-baked old seasons
  // (filled in by the daily-backfill workflow) show up automatically on
  // next deploy. exploreSeasonList() is the synchronous fallback used
  // until the fetch resolves so the picker isn't empty on first paint.
  const FALLBACK = useMemo(() => exploreSeasonList(), []);
  const [seasons, setSeasons] = useState(FALLBACK);
  const [season, setSeason] = useState(FALLBACK[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("season"); // "season" | "player"
  // Which games count: regular season, playoffs, or both summed. Applies to
  // both By Season and By Player.
  const [scope, setScope] = useState("playoffs"); // "regular" | "playoffs" | "combined"
  // A pending "open this player" request coming up from a compare panel's
  // compared-player chip while in By Season. It carries the target
  // player-season { season, team, name, slug }; the leaderboard applies it
  // (team filter + expand the row) once that season's rows have loaded.
  const [seasonNav, setSeasonNav] = useState(null);
  // Called by a By Season compare panel (via context.onNavigateToPlayer) when
  // the user taps the compared player's chip: switch the leaderboard to that
  // player's season and hand the target down for the leaderboard to open.
  const navigateSeasonToPlayer = useCallback((target) => {
    if (!target) return;
    setMode("season");
    setSeason(target.season);
    setSeasonNav(target);
  }, []);
  const clearSeasonNav = useCallback(() => setSeasonNav(null), []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/seasons")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d?.seasons?.length) return;
        setSeasons(d.seasons);
        // Switch the default to the newest entry the route reports, but
        // only if the user hasn't already navigated somewhere else.
        setSeason((cur) => (cur === FALLBACK[0] ? d.seasons[0] : cur));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [FALLBACK]);

  useEffect(() => {
    // Series box scores only exist for the playoffs; the other scopes render
    // just the leaderboard.
    if (mode !== "season" || scope !== "playoffs") return;
    let cancelled = false;
    setData(null);
    setError(null);
    setLoading(true);
    fetch(`/api/history?season=${season}`)
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

  const lga = lgaForSeason(season);
  const byRound = useMemo(() => {
    const out = { r1: [], r2: [], r3: [], r4: [] };
    for (const s of data?.series || []) {
      if (out[s.round]) out[s.round].push(s);
    }
    return out;
  }, [data]);

  const tabCls = (active) =>
    `flex-1 text-[10px] uppercase tracking-[0.2em] px-3 py-2 border ${active ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"}`;

  const scopeCls = (active) =>
    `flex-1 text-[9px] uppercase tracking-[0.15em] px-2 py-1.5 border ${active ? "bg-stone-700 text-white border-stone-700" : "bg-white text-stone-500 border-stone-300 hover:bg-stone-50"}`;

  return (
    <div>
      <div className="mb-2 flex gap-2">
        <button onClick={() => setMode("season")} className={tabCls(mode === "season")}>By Season</button>
        <button onClick={() => setMode("player")} className={tabCls(mode === "player")}>By Player</button>
      </div>
      <div className="mb-4 flex gap-1.5">
        <button onClick={() => setScope("combined")} className={scopeCls(scope === "combined")}>Combined</button>
        <button onClick={() => setScope("regular")} className={scopeCls(scope === "regular")}>Regular Season</button>
        <button onClick={() => setScope("playoffs")} className={scopeCls(scope === "playoffs")}>Playoffs</button>
      </div>

      {mode === "player" ? (
        <PlayerExplorer scope={scope} />
      ) : (
        <>
          <div className="mb-4 p-3 bg-white border border-stone-300">
            <label className="text-[10px] uppercase tracking-[0.3em] text-stone-500 block mb-1">Season</label>
            <select
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              className="w-full text-sm font-bold text-stone-900 bg-white border border-stone-300 px-2 py-1.5"
            >
              {seasons.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div className="text-[10px] text-stone-400 mt-1 italic">Box scores via ESPN and Basketball-Reference.</div>
          </div>

          {scope !== "playoffs" ? (
            <PlayoffLeaderboard season={season} lga={lga} scope={scope} pendingNav={seasonNav} onNavigateToPlayer={navigateSeasonToPlayer} onNavHandled={clearSeasonNav} />
          ) : (
            <>
              {loading && <div className="text-[10px] text-stone-500 italic py-4 text-center">Loading {season} playoffs…</div>}
              {error && !loading && <div className="text-[10px] text-red-600 py-4 text-center px-2 break-words">Couldn’t load games — {error}</div>}
              {!loading && !error && data && (
                <>
                  <PlayoffLeaderboard season={season} lga={lga} scope={scope} pendingNav={seasonNav} onNavigateToPlayer={navigateSeasonToPlayer} onNavHandled={clearSeasonNav} />
                  {(["r1", "r2", "r3", "r4"]).map((rk) => (
                    <ExploreRoundSection key={rk} roundKey={rk} series={byRound[rk]} lga={lga} season={season} />
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
    </div>
  );
}
