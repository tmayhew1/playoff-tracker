"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { BRACKET, STORAGE_KEY } from "../teams";
import { LGA, computePoints } from "../scoring";
import { RoundSection } from "./bracket";
import { PlayoffLeaderboard } from "./leaderboard";
import { BreakdownList, ProjectionList, ScoreCard, UpcomingTodayBanner, WhatIfClinchedList } from "./scoreboard";
import { ownerColor } from "../lib/format";


// Live-season bracket picker + scoreboard. Currently unwired: the 2025-26
// playoffs are over and that tab now renders through HistoryView like every
// other finished season. Re-wire this (new teams.js draft + a "current" tab
// in PlayoffTracker) when the 2026-27 playoffs start.
export function CurrentView() {
  const [winners, setWinners] = useState({});
  const [gameWins, setGameWins] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState(null);
  const [syncSource, setSyncSource] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [liveGamesBySeries, setLiveGamesBySeries] = useState({});
  const [actualGameWins, setActualGameWins] = useState({});
  const [actualWinners, setActualWinners] = useState({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.winners) setWinners(saved.winners);
        if (saved.gameWins) setGameWins(saved.gameWins);
        if (saved.liveGames) {
          // Drop stale cached games: anything not from the current April-June window.
          // Otherwise prior-season playoff games that once slipped past the API
          // filter will haunt the UI until the user hits Reset.
          const cutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;
          const migrated = {};
          for (const [sid, val] of Object.entries(saved.liveGames)) {
            const arr = Array.isArray(val) ? val : [val];
            const fresh = arr.filter((g) => {
              if (!g.gameDateTimeUTC) return false;
              const d = new Date(g.gameDateTimeUTC);
              const m = d.getUTCMonth();
              return m >= 3 && m <= 5 && d.getTime() >= cutoff;
            });
            if (fresh.length) migrated[sid] = fresh;
          }
          setLiveGamesBySeries(migrated);
        }
      }
    } catch (e) {}
    setLoaded(true);
  }, []);

  const persist = useCallback((w, g) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, winners: w, gameWins: g }));
    } catch (e) {}
  }, []);

  const syncLive = useCallback(async (override = false) => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/scores", { cache: "no-store" });
      if (!res.ok) throw new Error(`Proxy ${res.status}`);
      const data = await res.json();

      setLiveGamesBySeries(() => {
        // Treat the API response as authoritative so stale games (e.g. ones a
        // tightened filter no longer matches) drop out instead of lingering.
        const next = {};
        (data.liveGames || []).forEach((g) => {
          if (!next[g.seriesId]) next[g.seriesId] = [];
          next[g.seriesId].push(g);
        });
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          const saved = raw ? JSON.parse(raw) : {};
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, liveGames: next }));
        } catch (e) {}
        return next;
      });

      const actualWinsNext = { ...(data.gameWins || {}) };
      const actualWinnersNext = {};
      Object.entries(actualWinsNext).forEach(([sid, w]) => {
        Object.entries(w).forEach(([team, wins]) => {
          if (wins >= 4) actualWinnersNext[sid] = team;
        });
      });
      setActualGameWins(actualWinsNext);
      setActualWinners(actualWinnersNext);

      setGameWins((prev) => {
        const next = { ...prev };
        Object.entries(actualWinsNext).forEach(([sid, liveWins]) => {
          const cur = prev[sid];
          const curSum = cur ? Object.values(cur).reduce((a, b) => a + b, 0) : 0;
          const liveSum = Object.values(liveWins).reduce((a, b) => a + b, 0);
          if (override || !cur || liveSum >= curSum) next[sid] = liveWins;
        });
        setWinners((prevW) => {
          const nextW = { ...prevW };
          Object.entries(next).forEach(([sid, w]) => {
            Object.entries(w).forEach(([team, wins]) => {
              if (wins >= 4 && nextW[sid] !== team) nextW[sid] = team;
            });
          });
          persist(nextW, next);
          return nextW;
        });
        return next;
      });
      setSyncedAt(new Date(data.fetchedAt || Date.now()));
      setSyncSource(data.source || null);
      if (data.errors && data.errors.length) setSyncError(data.errors.join("; "));
    } catch (e) {
      setSyncError(e.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [persist]);

  useEffect(() => { if (loaded) syncLive(false); }, [loaded, syncLive]);

  useEffect(() => {
    const hasLive = Object.values(liveGamesBySeries).some((arr) =>
      (arr || []).some((g) => g.gameStatus === 2)
    );
    if (!hasLive) return;
    const id = setInterval(() => syncLive(false), 60000);
    return () => clearInterval(id);
  }, [liveGamesBySeries, syncLive]);

  const setWinner = (seriesId, teamCode) => {
    setWinners((prev) => {
      const next = { ...prev };
      if (teamCode === null) delete next[seriesId];
      else next[seriesId] = teamCode;
      const clearDownstream = (id) => {
        const deps = [
          ...BRACKET.r2.filter((s) => s.from.includes(id)),
          ...BRACKET.r3.filter((s) => s.from.includes(id)),
          ...BRACKET.r4.filter((s) => s.from.includes(id)),
        ];
        deps.forEach((d) => {
          if (next[d.id] !== undefined) {
            const newTeams = d.from.map((f) => next[f]);
            if (!newTeams.includes(next[d.id])) {
              delete next[d.id];
              clearDownstream(d.id);
            }
          }
        });
      };
      clearDownstream(seriesId);
      persist(next, gameWins);
      return next;
    });
  };

  const setSeriesGames = (seriesId, teamCode, newValue) => {
    setGameWins((prev) => {
      const nextSeries = { ...(prev[seriesId] || {}) };
      nextSeries[teamCode] = newValue;
      const nextAll = { ...prev, [seriesId]: nextSeries };
      let nextWinners = winners;
      if (newValue >= 4 && winners[seriesId] !== teamCode) {
        nextWinners = { ...winners, [seriesId]: teamCode };
        setWinners(nextWinners);
      }
      persist(nextWinners, nextAll);
      return nextAll;
    });
  };

  const resetAll = () => {
    if (confirm("Reset all picks and re-sync from live data?")) {
      setWinners({});
      setGameWins({});
      setLiveGamesBySeries({});
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ winners: {}, gameWins: {}, liveGames: {} }));
      } catch (e) {}
      syncLive(true);
    }
  };

  const { breakdown, whatIfClinched, projections, whatIfProj, totals, realProjectedTotals, projectedTotals, whatIfTotals, matchups } = useMemo(
    () => computePoints(winners, gameWins, actualGameWins, actualWinners),
    [winners, gameWins, actualGameWins, actualWinners]
  );

  if (!loaded) {
    return <div className="text-stone-500 text-xs uppercase tracking-widest py-12 text-center">Loading…</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-[10px] uppercase tracking-widest text-stone-400 leading-tight">
          {syncedAt ? (<>{syncSource === "baked" ? "Synced" : "Live synced"} <span className="text-stone-600">{syncedAt.toLocaleTimeString()}</span>{syncSource === "baked" && <span className="text-stone-400"> · stored results</span>}</>) : (<>Not synced yet</>)}
          {syncError && <div className="text-red-600 normal-case mt-0.5 tracking-normal">{syncError}</div>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => syncLive(true)} disabled={syncing} className="text-[10px] uppercase tracking-widest text-stone-600 border border-stone-400 px-2 py-1.5 bg-white hover:bg-stone-50 disabled:opacity-50">
            {syncing ? "Syncing…" : "↻ Sync"}
          </button>
          <button onClick={resetAll} className="text-[10px] uppercase tracking-widest text-stone-500 hover:text-stone-900 border border-stone-300 px-2 py-1.5 bg-white">
            Reset
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setShowBreakdown(showBreakdown === "Spencer" ? null : "Spencer")} className="flex-1 text-left">
          <ScoreCard owner="Spencer" total={totals.Spencer} projectedTotal={projectedTotals.Spencer} realProjectedTotal={realProjectedTotals.Spencer} whatIfTotal={whatIfTotals.Spencer} opponentProjected={projectedTotals.Trey} breakdown={breakdown.Spencer} />
        </button>
        <button onClick={() => setShowBreakdown(showBreakdown === "Trey" ? null : "Trey")} className="flex-1 text-left">
          <ScoreCard owner="Trey" total={totals.Trey} projectedTotal={projectedTotals.Trey} realProjectedTotal={realProjectedTotals.Trey} whatIfTotal={whatIfTotals.Trey} opponentProjected={projectedTotals.Spencer} breakdown={breakdown.Trey} />
        </button>
      </div>

      {showBreakdown && (
        <div className={`mb-5 p-3 border-2 ${showBreakdown === "Spencer" ? "bg-amber-50 border-amber-600" : "bg-teal-50 border-teal-600"}`}>
          <div className="flex items-center justify-between mb-2">
            <div className={`text-xs font-bold uppercase tracking-widest ${ownerColor(showBreakdown)}`}>{showBreakdown}'s Points</div>
            <button onClick={() => setShowBreakdown(null)} className="text-stone-400 text-lg leading-none">×</button>
          </div>

          <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1.5">Actual Results</div>
          <BreakdownList breakdown={breakdown[showBreakdown]} owner={showBreakdown} />
          <ProjectionList projections={projections[showBreakdown]} owner={showBreakdown} label="In-Progress Projections" />

          {(whatIfClinched[showBreakdown].length > 0 || whatIfProj[showBreakdown].length > 0) && (
            <div className="mt-4 pt-3 border-t-2 border-dashed border-stone-300">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-stone-500">What If?</div>
                <div className="text-[10px] tabular-nums font-bold text-stone-500">+{whatIfTotals[showBreakdown].toFixed(2)} pts</div>
              </div>
              <WhatIfClinchedList items={whatIfClinched[showBreakdown]} />
              <ProjectionList projections={whatIfProj[showBreakdown]} owner={showBreakdown} label="Speculated Game Wins" muted />
            </div>
          )}
        </div>
      )}

      <details className="mb-5 text-xs text-stone-600 border-l-2 border-stone-300 pl-3">
        <summary className="cursor-pointer font-semibold uppercase tracking-wider text-stone-700 text-[10px]">Scoring rules</summary>
        <div className="mt-2 space-y-1 leading-relaxed">
          <div>R1: 1 pt · R2: 2 pts · CF: 4 pts · Finals: 8 pts</div>
          <div>Upset bonus: winner's seed minus loser's seed (when winner is the lower seed).</div>
          <div>Projection: series-win value × (games won ÷ 4) for any in-progress series.</div>
          <div className="text-stone-400 italic">Solid circles = actual series wins. Pale circles = your speculation. Tap a game banner for box score. Tap any player row for VA breakdown.</div>
        </div>
      </details>

      <UpcomingTodayBanner liveGamesBySeries={liveGamesBySeries} actualWinners={actualWinners} />

      <div>
        <RoundSection roundKey="r1" title="First Round" series={BRACKET.r1} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} actualWinners={actualWinners} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
        <RoundSection roundKey="r2" title="Conference Semifinals" series={BRACKET.r2} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} actualWinners={actualWinners} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
        <RoundSection roundKey="r3" title="Conference Finals" series={BRACKET.r3} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} actualWinners={actualWinners} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
        <RoundSection roundKey="r4" title="NBA Finals" series={BRACKET.r4} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} actualWinners={actualWinners} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
      </div>

      <div className="mt-6">
        <PlayoffLeaderboard season="2025-26" lga={LGA} />
      </div>
    </div>
  );
}
