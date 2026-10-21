"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { TEAMS } from "../teams";
import { LGA } from "../scoring";
import { VABreakdown } from "./va-breakdown";
import { normalizeName, ownerBadge, teamColor, withAlpha } from "../lib/format";
import { getSortedPlayers } from "../lib/players";


export function PlayerRow({ p, rowKey, isExpanded, onToggle, dimTeam, lga = LGA, teams = TEAMS, gameNumber, onPrev, onNext, useTeamColor, singleGame }) {
  const teamInfo = teams[p.team];
  const owner = teamInfo?.owner;
  const isDim = p.team === dimTeam;
  const badgeUseTeam = !isDim && !owner;
  const badgeClass = isDim
    ? "bg-white text-stone-500 border border-stone-200"
    : owner ? ownerBadge(owner) : "border";
  const tc = badgeUseTeam ? teamColor(p.team) : null;
  const badgeStyle = badgeUseTeam
    ? { backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) }
    : undefined;
  return (
    <div className="border-b border-stone-100 last:border-0" data-row-key={rowKey}>
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2 text-[10px] py-1 text-left ${isExpanded ? "bg-stone-100" : ""}`}
      >
        <span style={badgeStyle} className={`w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center ${badgeClass}`}>
          {p.team}
        </span>
        <span className={`flex-1 truncate ${p.starter ? "font-semibold text-stone-800" : "text-stone-600"}`}>
          <span className="text-stone-400 mr-1">{isExpanded ? "▾" : "▸"}</span>
          {p.name}
        </span>
        <span className="tabular-nums text-stone-500 w-7 text-right">{Math.round(p.mp)}</span>
        <span className="tabular-nums font-bold text-stone-900 w-6 text-right">{p.pts}</span>
        <span className="tabular-nums text-stone-600 w-5 text-right">{p.reb}</span>
        <span className="tabular-nums text-stone-600 w-5 text-right">{p.ast}</span>
        <span className={`tabular-nums w-8 text-right font-semibold ${p.va < 0 ? "text-red-600" : p.va > 0 ? "text-stone-900" : "text-stone-400"}`}>
          {p.va.toFixed(1)}
        </span>
      </button>
      {isExpanded && <VABreakdown p={p} lga={lga} teams={teams} gameNumber={gameNumber} onPrev={onPrev} onNext={onNext} useTeamColor={useTeamColor} singleGame={singleGame} />}
    </div>
  );
}


// `gameNumberFor` (a tricode → number), when given, numbers each player's
// card by his own team's game instead of the one `gameNumber`.
export const rowKeyOf = (p, i) => `${p.team}-${p.name}-${i}`;

export function BoxscoreTable({ rows, expandedKey, setExpandedKey, dimTeam, partitionOnCourt, lga = LGA, teams = TEAMS, gameNumber, gameNumberFor, useTeamColor, singleGame }) {
  // Build a row plus prev/next callbacks that navigate within the same
  // array (partition-aware: nav stays within On Court / Bench).
  const buildRow = (arr) => (p, i) => {
    const rowKey = rowKeyOf(p, i);
    const prev = arr[i - 1];
    const next = arr[i + 1];
    const prevKey = prev ? rowKeyOf(prev, i - 1) : null;
    const nextKey = next ? rowKeyOf(next, i + 1) : null;
    return (
      <PlayerRow
        key={rowKey}
        rowKey={rowKey}
        p={p}
        isExpanded={expandedKey === rowKey}
        onToggle={() => setExpandedKey(expandedKey === rowKey ? null : rowKey)}
        dimTeam={dimTeam}
        lga={lga}
        teams={teams}
        gameNumber={gameNumberFor?.(p.team) ?? gameNumber}
        useTeamColor={useTeamColor}
        singleGame={singleGame}
        onPrev={prevKey ? () => setExpandedKey(prevKey) : undefined}
        onNext={nextKey ? () => setExpandedKey(nextKey) : undefined}
      />
    );
  };

  const header = (
    <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 border-b border-stone-200">
      <span className="w-10">Team</span>
      <span className="flex-1">Player</span>
      <span className="w-7 text-right">MIN</span>
      <span className="w-6 text-right">PTS</span>
      <span className="w-5 text-right">REB</span>
      <span className="w-5 text-right">AST</span>
      <span className="w-8 text-right">VA</span>
    </div>
  );

  // ESPN's box carries no on-court flags; without any, a live box would
  // read as all bench.
  if (partitionOnCourt && rows.some((p) => p.oncourt)) {
    const onCourt = rows.filter((p) => p.oncourt);
    const bench = rows.filter((p) => !p.oncourt);
    return (
      <div>
        {header}
        {onCourt.length > 0 && (
          <>
            <div className="text-[9px] uppercase tracking-widest text-red-600 font-semibold pt-1.5 pb-0.5 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
              On Court
            </div>
            {onCourt.map(buildRow(onCourt))}
          </>
        )}
        {bench.length > 0 && (
          <>
            <div className="text-[9px] uppercase tracking-widest text-stone-500 pt-2 pb-0.5">Bench</div>
            {bench.map(buildRow(bench))}
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      {header}
      {rows.map(buildRow(rows))}
    </div>
  );
}


// `boxSrc: "espn"` sends the box-score request straight to ESPN, for games
// whose id is an ESPN event id (the live NBA CDN only 404s on those).
// `boxLoader`, when given, is asked first and resolves to the box score or
// null — a baked regular-season game opens from its static file that way,
// and only a game the bake doesn't hold goes to /api/boxscore.
// `teamFilter` (a tricode) swaps the top five and the full box for that
// team's whole box; tapping the header then calls `onTeamClear` instead of
// opening the full box. `onBox` hears each box as it loads. `singleGame`
// shows player cards as one game's (see VABreakdown), numbered by
// `gameNumberFor`. `focusPlayer`, a name on the `teamFilter` team, opens
// that player's card once the box loads, scrolls to it, then calls
// `onFocusHandled`.
export function LiveGameBanner({ liveGame, gameLabel, dimTeam, staticBox, lga = LGA, teams = TEAMS, useTeamColor, boxSrc, boxLoader, hideScore, teamFilter, onTeamClear, onBox, singleGame, gameNumberFor, focusPlayer, onFocusHandled }) {
  const gameNumber = gameLabel ? Number((gameLabel.match(/\d+/) || [])[0]) || null : null;
  const [expanded, setExpanded] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState(null);
  const [box, setBox] = useState(staticBox || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Read through a ref: callers pass an inline arrow, and a loader that
  // changes every render must not re-trigger the load effect below.
  const boxLoaderRef = useRef(boxLoader);
  boxLoaderRef.current = boxLoader;
  const onBoxRef = useRef(onBox);
  onBoxRef.current = onBox;
  useEffect(() => { onBoxRef.current?.(box); }, [box]);

  const loadBox = useCallback(async () => {
    if (!liveGame?.gameId) return;
    setLoading(true);
    setError(null);
    try {
      const baked = boxLoaderRef.current ? await boxLoaderRef.current().catch(() => null) : null;
      if (baked) {
        setBox(baked);
        return;
      }
      const dq = liveGame.gameCode ? `&date=${liveGame.gameCode}` : "";
      const sq = boxSrc ? `&src=${boxSrc}` : "";
      const lq = liveGame.gameStatus === 2 ? "&live=1" : "";
      const res = await fetch(`/api/boxscore?gameId=${liveGame.gameId}${dq}${sq}${lq}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBox(data);
    } catch (e) {
      setError(e.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }, [liveGame?.gameId, liveGame?.gameCode, liveGame?.gameStatus, boxSrc]);

  const isLive = liveGame?.gameStatus === 2;
  const isFinal = liveGame?.gameStatus === 3;

  useEffect(() => {
    if (staticBox || !liveGame?.gameId) return; // historical box is supplied inline
    if (isLive) {
      loadBox();
      const id = setInterval(loadBox, 45000);
      return () => clearInterval(id);
    }
    if (isFinal && (expanded || teamFilter)) {
      loadBox();
    }
  }, [staticBox, liveGame?.gameId, isLive, isFinal, expanded, teamFilter, loadBox]);

  if (!liveGame) return null;
  const { home, away, gameStatus, gameStatusText, gameId, gameDateTimeUTC, period, gameClock } = liveGame;
  const canExpand = !!gameId && (isLive || isFinal);

  const formatPeriod = (p) => {
    if (!p || p < 1) return "";
    if (p <= 4) return `Q${p}`;
    if (p === 5) return "OT";
    return `OT${p - 4}`;
  };

  const formatClock = (iso) => {
    if (!iso) return "";
    const m = iso.match(/PT(\d+)M([\d.]+)S/);
    if (!m) return "";
    const mins = parseInt(m[1], 10);
    const secs = Math.floor(parseFloat(m[2]));
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Between periods the clock reads 0:00, so the feed's own words
  // ("Half", "End of Q3") say it better.
  const breakText = isLive && /^(half|end)/i.test(gameStatusText || "") ? gameStatusText : null;
  const liveLabel = isLive
    ? breakText || [formatPeriod(period), formatClock(gameClock)].filter(Boolean).join(" ")
    : null;

  let displayStatus = gameStatusText;
  if (gameStatus === 1 && gameDateTimeUTC) {
    const d = new Date(gameDateTimeUTC);
    const isTbd = gameStatusText === "TBD";
    const now = new Date();

    if (isTbd) {
      const etDate = new Date(d.getTime() - 4 * 60 * 60 * 1000);
      const sameDay = etDate.getUTCFullYear() === now.getFullYear() &&
                      etDate.getUTCMonth() === now.getMonth() &&
                      etDate.getUTCDate() === now.getDate();
      displayStatus = sameDay
        ? "Today"
        : `${etDate.getUTCMonth() + 1}/${etDate.getUTCDate()}`;
    } else {
      const sameDay = d.getFullYear() === now.getFullYear() &&
                      d.getMonth() === now.getMonth() &&
                      d.getDate() === now.getDate();
      if (sameDay) {
        const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        displayStatus = `Today ${timeStr}`;
      } else {
        displayStatus = `${d.getMonth() + 1}/${d.getDate()}`;
      }
    }
  }

  let finalClasses = "bg-stone-100 border-stone-300";
  let finalStyle = undefined;
  if (isFinal && home.score !== away.score) {
    const winnerTri = home.score > away.score ? home.tri : away.tri;
    const winnerOwner = teams[winnerTri]?.owner;
    if (winnerOwner === "Spencer") finalClasses = "bg-amber-50 border-amber-400";
    else if (winnerOwner === "Trey") finalClasses = "bg-teal-50 border-teal-400";
    else {
      // No owner context (Explore): tint with the winner's team color.
      const tc = teamColor(winnerTri);
      finalClasses = "border";
      finalStyle = { backgroundColor: withAlpha(tc, 0.08), borderColor: withAlpha(tc, 0.5) };
    }
  }

  const sortedPlayers = useMemo(() => getSortedPlayers(box, lga), [box, lga]);
  const top5 = sortedPlayers.slice(0, 5);
  const teamPlayers = useMemo(() => (teamFilter ? sortedPlayers.filter((p) => p.team === teamFilter) : null), [sortedPlayers, teamFilter]);

  const rootRef = useRef(null);
  const scrollTo = useRef(null);
  useEffect(() => {
    if (!focusPlayer || !box || !teamPlayers) return;
    const i = teamPlayers.findIndex((p) => normalizeName(p.name) === normalizeName(focusPlayer));
    if (i >= 0) {
      scrollTo.current = rowKeyOf(teamPlayers[i], i);
      setExpandedPlayer(scrollTo.current);
    }
    onFocusHandled?.();
  }, [focusPlayer, box, teamPlayers, onFocusHandled]);
  useEffect(() => {
    if (!expandedPlayer || scrollTo.current !== expandedPlayer) return;
    scrollTo.current = null;
    rootRef.current?.querySelector(`[data-row-key="${CSS.escape(expandedPlayer)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [expandedPlayer]);
  const showTop5 = isLive && sortedPlayers.length > 0 && !expanded && !teamFilter;
  const showFull = expanded && !teamFilter;

  return (
    <div ref={rootRef} style={isFinal ? finalStyle : undefined} className={`mt-1 border ${isLive ? "bg-red-50 border-red-300" : isFinal ? finalClasses : "bg-stone-50 border-stone-200"}`}>
      <button
        onClick={() => (teamFilter ? onTeamClear?.() : canExpand && setExpanded(!expanded))}
        disabled={!canExpand && !teamFilter}
        className="w-full px-2 py-1 text-[10px] flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-1.5">
          {isLive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span>}
          <span className={`font-bold uppercase tracking-wider ${isLive ? "text-red-700" : "text-stone-600"}`}>
            {isLive ? (liveLabel || "LIVE") : isFinal ? "FINAL" : (displayStatus || "SOON")}
          </span>
          {gameLabel && (
            <span className="text-[9px] font-semibold uppercase tracking-wider text-stone-500 px-1 py-0.5 bg-white border border-stone-300">
              {gameLabel}
            </span>
          )}
          {(canExpand || teamFilter) && <span className="text-stone-400">{expanded || teamFilter ? "▾" : "▸"}</span>}
        </div>
        {isLive && liveGame.broadcasters && liveGame.broadcasters.length > 0 && (
          <span className="text-[9px] uppercase tracking-wider text-stone-500 truncate text-center flex-1 min-w-0">
            {liveGame.broadcasters.join(", ")}
          </span>
        )}
        {!hideScore && (
          <div className="tabular-nums font-semibold text-stone-700 shrink-0">
            {away.tri} {away.score} — {home.score} {home.tri}
          </div>
        )}
      </button>

      {showTop5 && (
        <div className="px-2 pb-2 border-t border-red-200">
          <div className="text-[9px] uppercase tracking-widest text-stone-500 py-1">Top 5 by Value Added</div>
          <BoxscoreTable rows={top5} expandedKey={expandedPlayer} setExpandedKey={setExpandedPlayer} dimTeam={dimTeam} lga={lga} teams={teams} gameNumber={gameNumber} gameNumberFor={gameNumberFor} useTeamColor={useTeamColor} singleGame={singleGame} />
        </div>
      )}

      {teamFilter && (
        <div className="px-2 pb-2 border-t border-stone-200">
          {loading && !box && <div className="py-2 text-[10px] text-stone-500 italic text-center">Loading stats…</div>}
          {error && <div className="py-2 text-[10px] text-red-600 text-center">{error}</div>}
          {!box && !loading && !error && <div className="py-2 text-[10px] text-stone-500 italic text-center">No box score yet</div>}
          {box && teamPlayers.length > 0 && (
            <div className="mt-2">
              <BoxscoreTable rows={teamPlayers} expandedKey={expandedPlayer} setExpandedKey={setExpandedPlayer} dimTeam={dimTeam} lga={lga} teams={teams} gameNumber={gameNumber} gameNumberFor={gameNumberFor} useTeamColor={useTeamColor} singleGame={singleGame} />
            </div>
          )}
          {box && teamPlayers.length === 0 && (
            <div className="py-2 text-[10px] text-stone-500 italic text-center">No player stats yet</div>
          )}
        </div>
      )}

      {showFull && (
        <div className="px-2 pb-2 border-t border-stone-200">
          {loading && !box && <div className="py-2 text-[10px] text-stone-500 italic text-center">Loading stats…</div>}
          {error && <div className="py-2 text-[10px] text-red-600 text-center">{error}</div>}
          {box && sortedPlayers.length > 0 && (
            <div className="mt-2">
              <BoxscoreTable rows={sortedPlayers} expandedKey={expandedPlayer} setExpandedKey={setExpandedPlayer} dimTeam={dimTeam} partitionOnCourt={isLive} lga={lga} teams={teams} gameNumber={gameNumber} gameNumberFor={gameNumberFor} useTeamColor={useTeamColor} singleGame={singleGame} />
            </div>
          )}
          {box && sortedPlayers.length === 0 && (
            <div className="py-2 text-[10px] text-stone-500 italic text-center">No player stats yet</div>
          )}
        </div>
      )}
    </div>
  );
}
