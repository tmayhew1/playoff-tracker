"use client";

import { useState, useEffect } from "react";
import { TEAMS, ROUND_BASE } from "../teams";
import { LGA, potentialPoints } from "../scoring";
import { LiveGameBanner } from "./boxscore";
import { SeriesAverages } from "./history";
import { ownerBg, ownerColor, ownerDot } from "../lib/format";


export function WinCircles({ value, actualValue, onChange, disabled, owner, dim }) {
  const fillColor = owner === "Spencer"
    ? (dim ? "bg-amber-300 border-amber-400" : "bg-amber-500 border-amber-600")
    : (dim ? "bg-teal-300 border-teal-400" : "bg-teal-500 border-teal-600");
  const whatIfColor = owner === "Spencer"
    ? (dim ? "bg-amber-100 border-amber-200" : "bg-amber-200 border-amber-400")
    : (dim ? "bg-teal-100 border-teal-200" : "bg-teal-200 border-teal-400");
  return (
    <div className="flex items-center gap-1 mt-1">
      {[1, 2, 3, 4].map((n) => {
        const filled = value >= n;
        const isReal = n <= (actualValue || 0);
        let cls = "bg-white border-stone-300";
        if (filled) cls = isReal ? fillColor : whatIfColor;
        return (
          <button
            key={n}
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              onChange(filled ? n - 1 : n);
            }}
            disabled={disabled}
            className={`w-3.5 h-3.5 rounded-full border transition-colors ${cls} disabled:opacity-40`}
            aria-label={filled ? `Win ${n} (tap to remove)` : `Add win ${n}`}
          />
        );
      })}
    </div>
  );
}


export function TbdCard({ gameNumbers }) {
  if (!gameNumbers || gameNumbers.length === 0) return null;
  let label;
  if (gameNumbers.length === 1) {
    label = `Game ${gameNumbers[0]} TBD`;
  } else if (gameNumbers.length === 2) {
    label = `Games ${gameNumbers[0]} & ${gameNumbers[1]} TBD`;
  } else {
    const last = gameNumbers[gameNumbers.length - 1];
    const rest = gameNumbers.slice(0, -1).join(", ");
    label = `Games ${rest} & ${last} TBD`;
  }
  return (
    <div className="mt-1 border bg-stone-300 border-stone-400">
      <div className="w-full px-2 py-1 text-[10px] flex items-center justify-between gap-2">
        <span className="font-bold uppercase tracking-wider text-stone-700">{label}</span>
        <span className="text-[9px] uppercase tracking-wider text-stone-600 italic">If necessary</span>
      </div>
    </div>
  );
}


export function TeamButton({ code, selected, disabled, onClick, gamesWon, actualWins, onGamesChange, seriesDecided, dim, pointValue }) {
  if (!code) {
    return <div className="flex-1 px-3 py-2.5 text-xs uppercase tracking-widest text-stone-400 italic border border-dashed border-stone-300 bg-stone-50 text-center">TBD</div>;
  }
  const t = TEAMS[code];
  const isSel = selected === code;
  return (
    <div className={`flex-1 px-3 py-2.5 transition-all border ${isSel ? `${ownerBg(t.owner)} border-2 shadow-sm` : "bg-white border-stone-200"} ${disabled ? "opacity-60" : ""}`}>
      <button onClick={() => !disabled && onClick(code)} disabled={disabled} className="w-full text-left">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-stone-500 tabular-nums w-4">{t.seed}</span>
          <span className={`text-sm font-semibold ${isSel ? ownerColor(t.owner, dim) : "text-stone-900"}`}>{t.name}</span>
          {isSel && <span className="ml-auto text-xs">✓</span>}
        </div>
        <div className="text-[10px] uppercase tracking-wider mt-0.5 flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${ownerDot(t.owner, dim)}`}></span>
          <span className="text-stone-500">{t.owner}</span>
        </div>
      </button>
      {!seriesDecided && (
        <>
          <WinCircles value={gamesWon || 0} actualValue={actualWins || 0} onChange={(v) => onGamesChange(code, v)} disabled={disabled} owner={t.owner} dim={dim} />
          {pointValue != null && (
            <div className={`text-[9px] uppercase tracking-wider mt-1 tabular-nums font-semibold ${ownerColor(t.owner, dim)}`}>
              +{pointValue} pt{pointValue === 1 ? "" : "s"}
            </div>
          )}
        </>
      )}
    </div>
  );
}


export function SeriesRow({ series, roundKey, matchups, winners, gameWins, actualGameWins, onPick, onGamesChange, liveGame }) {
  const [expanded, setExpanded] = useState(false);
  const [a, b] = matchups[series.id] || [];
  const winner = winners[series.id];
  const canPick = a && b;
  const games = gameWins[series.id] || {};
  const actualGames = actualGameWins?.[series.id] || {};
  const seriesDecided = !!winner;
  // A series is "over" when real results give a team 4 wins. Collapse it to a
  // one-line result by default (expandable) so finished series don't crowd the
  // bracket alongside ones still in progress.
  const realWinsA = actualGames[a] || 0;
  const realWinsB = actualGames[b] || 0;
  const isOver = !!(a && b) && (realWinsA >= 4 || realWinsB >= 4);
  const seriesWinner = realWinsA >= 4 ? a : realWinsB >= 4 ? b : null;
  const seriesLoser = seriesWinner === a ? b : a;
  const hiWins = Math.max(realWinsA, realWinsB);
  const loWins = Math.min(realWinsA, realWinsB);
  const seriesGames = (liveGame || []).slice().sort((x, y) =>
    (x.gameId || "").localeCompare(y.gameId || "")
  );

  const teamA = a ? TEAMS[a] : null;
  const teamB = b ? TEAMS[b] : null;
  const ptsA = teamA && teamB ? potentialPoints(teamA, teamB, roundKey).total : null;
  const ptsB = teamA && teamB ? potentialPoints(teamB, teamA, roundKey).total : null;
  // When both teams share an owner, dim the side whose win is worth fewer points.
  const sameOwner = teamA && teamB && teamA.owner === teamB.owner;
  const dimA = sameOwner && ptsA < ptsB;
  const dimB = sameOwner && ptsB < ptsA;
  const dimTeam = dimA ? a : dimB ? b : null;

  const winsA = games[a] || 0;
  const winsB = games[b] || 0;
  const minWins = Math.min(winsA, winsB);
  const lastGuaranteed = seriesDecided ? 0 : 4 + minWins;

  const realGames = [];
  const tbdGames = [];
  seriesGames.forEach((g, i) => {
    const gameNumber = i + 1;
    if (g.gameStatus === 1 && gameNumber > lastGuaranteed) {
      tbdGames.push(g);
    } else {
      realGames.push(g);
    }
  });

  const tbdGameNumbers = tbdGames.map((_, i) => realGames.length + i + 1).filter((n) => n <= 7);

  const body = (
    <>
      <div className="flex gap-1.5 items-stretch">
        <TeamButton code={a} selected={winner} disabled={!canPick} onClick={(code) => onPick(series.id, winner === code ? null : code)} gamesWon={games[a]} actualWins={actualGames[a]} onGamesChange={(code, v) => onGamesChange(series.id, code, v)} seriesDecided={seriesDecided} dim={dimA} pointValue={ptsA} />
        <div className="flex items-center justify-center px-1 text-[10px] font-bold text-stone-400 tracking-widest">VS</div>
        <TeamButton code={b} selected={winner} disabled={!canPick} onClick={(code) => onPick(series.id, winner === code ? null : code)} gamesWon={games[b]} actualWins={actualGames[b]} onGamesChange={(code, v) => onGamesChange(series.id, code, v)} seriesDecided={seriesDecided} dim={dimB} pointValue={ptsB} />
      </div>
      <SeriesAverages games={seriesGames} teamsMap={TEAMS} lga={LGA} dimTeam={dimTeam} season="2025-26" />
      {realGames.map((g, i) => {
        const num = i + 1;
        const gameLabel = num <= 7 ? `Game ${num}` : null;
        return <LiveGameBanner key={g.gameId || i} liveGame={g} gameLabel={gameLabel} dimTeam={dimTeam} />;
      })}
      <TbdCard gameNumbers={tbdGameNumbers} />
    </>
  );

  return (
    <div className="mb-3 bg-stone-50 border border-stone-200 rounded">
      {isOver && (
        <button onClick={() => setExpanded((e) => !e)} className="w-full p-2 flex items-center gap-2 text-left">
          <span className="text-stone-400 text-[10px]">{expanded ? "▾" : "▸"}</span>
          <span className="text-xs">
            <span className="font-semibold text-stone-900">{seriesWinner}</span>
            <span className="text-stone-500"> def. </span>
            <span className="text-stone-600">{seriesLoser}</span>
          </span>
          <span className="ml-auto text-xs font-semibold tabular-nums text-stone-700">{hiWins}–{loWins}</span>
        </button>
      )}
      {(!isOver || expanded) && (
        <div className={isOver ? "px-2 pb-2" : "p-2"}>{body}</div>
      )}
    </div>
  );
}


export function RoundSection({ roundKey, title, series, matchups, winners, gameWins, actualGameWins, actualWinners, onPick, onGamesChange, liveGamesBySeries }) {
  const sortedSeries = series.slice().sort((a, b) => {
    const aGames = liveGamesBySeries?.[a.id] || [];
    const bGames = liveGamesBySeries?.[b.id] || [];

    const aHasLive = aGames.some((g) => g.gameStatus === 2);
    const bHasLive = bGames.some((g) => g.gameStatus === 2);
    if (aHasLive && !bHasLive) return -1;
    if (!aHasLive && bHasLive) return 1;

    const latestTime = (games) => {
      const finals = games.filter((g) => g.gameStatus === 3);
      if (finals.length === 0) return 0;
      const withTime = finals
        .map((g) => g.gameDateTimeUTC ? new Date(g.gameDateTimeUTC).getTime() : 0)
        .filter((t) => t > 0);
      if (withTime.length > 0) return Math.max(...withTime);
      const ids = finals.map((g) => parseInt(g.gameId, 10) || 0);
      return Math.max(...ids);
    };
    const aTime = latestTime(aGames);
    const bTime = latestTime(bGames);
    return bTime - aTime;
  });

  // Round is "complete" when every series has a clinched winner from real games
  const allClinched = series.every((s) => actualWinners?.[s.id]);

  // Default open; collapsed if all series in this round are clinched
  const [collapsed, setCollapsed] = useState(allClinched);
  // Re-sync collapse state if the round transitions to fully-clinched
  useEffect(() => { setCollapsed(allClinched); }, [allClinched]);

  return (
    <div className="mb-6">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-baseline justify-between mb-2.5 pb-1.5 border-b-2 border-stone-900 text-left"
      >
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 flex items-center gap-2">
          <span className="text-stone-400 text-[10px]">{collapsed ? "▸" : "▾"}</span>
          {title}
          {allClinched && <span className="text-[9px] uppercase tracking-wider text-stone-500 font-normal">Complete</span>}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-stone-500 tabular-nums">+{ROUND_BASE[roundKey]} pt{ROUND_BASE[roundKey] > 1 ? "s" : ""}/win</span>
      </button>
      {!collapsed && sortedSeries.map((s) => (
        <SeriesRow key={s.id} series={s} roundKey={roundKey} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} onPick={onPick} onGamesChange={onGamesChange} liveGame={liveGamesBySeries?.[s.id]} />
      ))}
    </div>
  );
}
