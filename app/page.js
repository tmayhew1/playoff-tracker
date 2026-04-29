"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { HISTORY, scoreHistory } from "./historical";
import { TEAMS, BRACKET, ROUND_BASE, STORAGE_KEY } from "./teams";
import { LGA, valueAdd, computePoints } from "./scoring";

const ownerColor = (o) => o === "Spencer" ? "text-amber-700" : "text-teal-700";
const ownerBg = (o) => o === "Spencer" ? "bg-amber-50 border-amber-300" : "bg-teal-50 border-teal-300";
const ownerDot = (o) => o === "Spencer" ? "bg-amber-600" : "bg-teal-600";
const ownerBadge = (o) => o === "Spencer" ? "bg-amber-100 text-amber-800" : o === "Trey" ? "bg-teal-100 text-teal-800" : "bg-stone-100 text-stone-600";

function WinCircles({ value, actualValue, onChange, disabled, owner }) {
  const fillColor = owner === "Spencer" ? "bg-amber-500 border-amber-600" : "bg-teal-500 border-teal-600";
  const whatIfColor = owner === "Spencer" ? "bg-amber-200 border-amber-400" : "bg-teal-200 border-teal-400";
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

function VABreakdown({ p }) {
  const mp = p.mp || 0;
  if (mp <= 0) return null;

  const twoPm = p.fgm - p.tpm, twoPa = p.fga - p.tpa;
  const tpAdd = ((p.tpm / (p.tpa || 1)) - LGA.la3P) * p.tpa;
  const twoAdd = ((twoPm / (twoPa || 1)) - LGA.la2P) * twoPa;
  const ftAdd = ((p.ftm / (p.fta || 1)) - LGA.laFT) * p.fta;

  const categories = [
    { key: "Scoring", value: ((p.pts / mp) - LGA.laPTSperM) * mp, label: `${p.pts} PTS` },
    { key: "3-Pointers", value: 3 * tpAdd, label: `${p.tpm}/${p.tpa} 3P` },
    { key: "2-Pointers", value: 2 * twoAdd, label: `${twoPm}/${twoPa} 2P` },
    { key: "Free Throws", value: ftAdd, label: `${p.ftm}/${p.fta} FT` },
    { key: "Assists", value: ((p.ast / mp) - LGA.laASTperM) * mp * LGA.laPTSperMake * (1 - LGA.laFG), label: `${p.ast} AST` },
    { key: "Steals", value: ((p.stl / mp) - LGA.laSTLperM) * mp * LGA.laPTSperPoss, label: `${p.stl} STL` },
    { key: "Blocks", value: ((p.blk / mp) - LGA.laBLKperM) * mp * LGA.laPTSperPoss * LGA.laDRBrate, label: `${p.blk} BLK` },
    { key: "Turnovers", value: -((p.tov / mp) - LGA.laTOVperM) * mp * LGA.laPTSperPoss, label: `${p.tov} TOV` },
    { key: "D Rebounds", value: ((p.drb / mp) - LGA.laDRBperM) * mp * LGA.laPTSperPoss * LGA.laORBrate, label: `${p.drb} DRB` },
    { key: "O Rebounds", value: ((p.orb / mp) - LGA.laORBperM) * mp * LGA.laPTSperPoss * LGA.laDRBrate, label: `${p.orb} ORB` },
  ].sort((a, b) => b.value - a.value);

  const maxAbs = Math.max(...categories.map((c) => Math.abs(c.value)), 0.5);
  const owner = TEAMS[p.team]?.owner;
  const posColor = owner === "Spencer" ? "bg-amber-500" : "bg-teal-500";

  return (
    <div className="px-2 py-3 bg-stone-50 border-t border-stone-200">
      <div className="text-[9px] uppercase tracking-widest text-stone-500 mb-2 flex items-center justify-between">
        <span>Value Added Breakdown</span>
        <span className="tabular-nums font-bold text-stone-700">Total: {p.va.toFixed(2)}</span>
      </div>
      <div className="space-y-0.5">
        {categories.map((c, i) => {
          const pct = (Math.abs(c.value) / maxAbs) * 45;
          const isPos = c.value >= 0;
          return (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <span className="w-20 text-stone-600 text-right truncate">{c.key}</span>
              <div className="flex-1 flex items-center relative h-4">
                <div className="absolute inset-y-0 left-1/2 w-px bg-stone-300"></div>
                <div
                  className={`absolute inset-y-0.5 ${isPos ? posColor : "bg-stone-400"}`}
                  style={{
                    left: isPos ? "50%" : `${50 - pct}%`,
                    width: `${pct}%`,
                  }}
                ></div>
              </div>
              <span className="w-10 tabular-nums text-right font-semibold text-stone-700">{c.value.toFixed(2)}</span>
              <span className="w-12 text-[9px] text-stone-500 text-right">{c.label}</span>
            </div>
          );
        })}
      </div>
      <div className="text-[9px] text-stone-400 mt-2 text-center italic">Bars show contribution above/below league average</div>
    </div>
  );
}

function getSortedPlayers(box) {
  if (!box) return [];
  return [
    ...(box.away?.players || []).map((p) => ({ ...p, team: box.away.tri })),
    ...(box.home?.players || []).map((p) => ({ ...p, team: box.home.tri })),
  ]
    .filter((p) => (p.mp || 0) > 0)
    .map((p) => ({ ...p, va: valueAdd(p) }))
    .sort((a, b) => b.va - a.va);
}

function PlayerRow({ p, isExpanded, onToggle }) {
  const teamInfo = TEAMS[p.team];
  const owner = teamInfo?.owner;
  return (
    <div className="border-b border-stone-100 last:border-0">
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2 text-[10px] py-1 text-left ${isExpanded ? "bg-stone-100" : ""}`}
      >
        <span className={`w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center ${ownerBadge(owner)}`}>
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
        <span className={`tabular-nums w-8 text-right font-semibold ${p.va > 0 ? "text-stone-900" : "text-stone-400"}`}>
          {p.va.toFixed(1)}
        </span>
      </button>
      {isExpanded && <VABreakdown p={p} />}
    </div>
  );
}

function BoxscoreTable({ rows, expandedKey, setExpandedKey }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 border-b border-stone-200">
        <span className="w-10">Team</span>
        <span className="flex-1">Player</span>
        <span className="w-7 text-right">MIN</span>
        <span className="w-6 text-right">PTS</span>
        <span className="w-5 text-right">REB</span>
        <span className="w-5 text-right">AST</span>
        <span className="w-8 text-right">VA</span>
      </div>
      {rows.map((p, i) => {
        const rowKey = `${p.team}-${p.name}-${i}`;
        return (
          <PlayerRow
            key={rowKey}
            p={p}
            isExpanded={expandedKey === rowKey}
            onToggle={() => setExpandedKey(expandedKey === rowKey ? null : rowKey)}
          />
        );
      })}
    </div>
  );
}

function LiveGameBanner({ liveGame, gameLabel }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState(null);
  const [box, setBox] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadBox = useCallback(async () => {
    if (!liveGame?.gameId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/boxscore?gameId=${liveGame.gameId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBox(data);
    } catch (e) {
      setError(e.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }, [liveGame?.gameId]);

  const isLive = liveGame?.gameStatus === 2;
  const isFinal = liveGame?.gameStatus === 3;

  useEffect(() => {
    if (!liveGame?.gameId) return;
    if (isLive) {
      loadBox();
      const id = setInterval(loadBox, 45000);
      return () => clearInterval(id);
    }
    if (isFinal && expanded) {
      loadBox();
    }
  }, [liveGame?.gameId, isLive, isFinal, expanded, loadBox]);

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

  const liveLabel = isLive
    ? [formatPeriod(period), formatClock(gameClock)].filter(Boolean).join(" ")
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
  if (isFinal && home.score !== away.score) {
    const winnerTri = home.score > away.score ? home.tri : away.tri;
    const winnerOwner = TEAMS[winnerTri]?.owner;
    if (winnerOwner === "Spencer") finalClasses = "bg-amber-50 border-amber-400";
    else if (winnerOwner === "Trey") finalClasses = "bg-teal-50 border-teal-400";
  }

  const sortedPlayers = useMemo(() => getSortedPlayers(box), [box]);
  const top5 = sortedPlayers.slice(0, 5);
  const showTop5 = isLive && sortedPlayers.length > 0 && !expanded;

  return (
    <div className={`mt-1 border ${isLive ? "bg-red-50 border-red-300" : isFinal ? finalClasses : "bg-stone-50 border-stone-200"}`}>
      <button
        onClick={() => canExpand && setExpanded(!expanded)}
        disabled={!canExpand}
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
          {canExpand && <span className="text-stone-400">{expanded ? "▾" : "▸"}</span>}
        </div>
        <div className="tabular-nums font-semibold text-stone-700">
          {away.tri} {away.score} — {home.score} {home.tri}
        </div>
      </button>

      {showTop5 && (
        <div className="px-2 pb-2 border-t border-red-200">
          <div className="text-[9px] uppercase tracking-widest text-stone-500 py-1">Top 5 by Value Added</div>
          <BoxscoreTable rows={top5} expandedKey={expandedPlayer} setExpandedKey={setExpandedPlayer} />
        </div>
      )}

      {expanded && (
        <div className="px-2 pb-2 border-t border-stone-200">
          {loading && !box && <div className="py-2 text-[10px] text-stone-500 italic text-center">Loading stats…</div>}
          {error && <div className="py-2 text-[10px] text-red-600 text-center">{error}</div>}
          {box && sortedPlayers.length > 0 && (
            <div className="mt-2">
              <BoxscoreTable rows={sortedPlayers} expandedKey={expandedPlayer} setExpandedKey={setExpandedPlayer} />
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

function TbdCard({ gameNumbers }) {
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

function TeamButton({ code, selected, disabled, onClick, gamesWon, actualWins, onGamesChange, seriesDecided }) {
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
          <span className={`text-sm font-semibold ${isSel ? ownerColor(t.owner) : "text-stone-900"}`}>{t.name}</span>
          {isSel && <span className="ml-auto text-xs">✓</span>}
        </div>
        <div className="text-[10px] uppercase tracking-wider mt-0.5 flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${ownerDot(t.owner)}`}></span>
          <span className="text-stone-500">{t.owner}</span>
        </div>
      </button>
      {!seriesDecided && <WinCircles value={gamesWon || 0} actualValue={actualWins || 0} onChange={(v) => onGamesChange(code, v)} disabled={disabled} owner={t.owner} />}
    </div>
  );
}

function SeriesRow({ series, matchups, winners, gameWins, actualGameWins, onPick, onGamesChange, liveGame }) {
  const [a, b] = matchups[series.id] || [];
  const winner = winners[series.id];
  const canPick = a && b;
  const games = gameWins[series.id] || {};
  const actualGames = actualGameWins?.[series.id] || {};
  const seriesDecided = !!winner;
  const seriesGames = (liveGame || []).slice().sort((x, y) =>
    (x.gameId || "").localeCompare(y.gameId || "")
  );

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

  return (
    <div className="mb-3 p-2 bg-stone-50 border border-stone-200 rounded">
      <div className="flex gap-1.5 items-stretch">
        <TeamButton code={a} selected={winner} disabled={!canPick} onClick={(code) => onPick(series.id, winner === code ? null : code)} gamesWon={games[a]} actualWins={actualGames[a]} onGamesChange={(code, v) => onGamesChange(series.id, code, v)} seriesDecided={seriesDecided} />
        <div className="flex items-center justify-center px-1 text-[10px] font-bold text-stone-400 tracking-widest">VS</div>
        <TeamButton code={b} selected={winner} disabled={!canPick} onClick={(code) => onPick(series.id, winner === code ? null : code)} gamesWon={games[b]} actualWins={actualGames[b]} onGamesChange={(code, v) => onGamesChange(series.id, code, v)} seriesDecided={seriesDecided} />
      </div>
      {realGames.map((g, i) => {
        const num = i + 1;
        const gameLabel = num <= 7 ? `Game ${num}` : null;
        return <LiveGameBanner key={g.gameId || i} liveGame={g} gameLabel={gameLabel} />;
      })}
      <TbdCard gameNumbers={tbdGameNumbers} />
    </div>
  );
}

function RoundSection({ roundKey, title, series, matchups, winners, gameWins, actualGameWins, onPick, onGamesChange, liveGamesBySeries }) {
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

  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-2.5 pb-1.5 border-b-2 border-stone-900">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900">{title}</h3>
        <span className="text-[10px] uppercase tracking-wider text-stone-500 tabular-nums">+{ROUND_BASE[roundKey]} pt{ROUND_BASE[roundKey] > 1 ? "s" : ""}/win</span>
      </div>
      {sortedSeries.map((s) => (
        <SeriesRow key={s.id} series={s} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} onPick={onPick} onGamesChange={onGamesChange} liveGame={liveGamesBySeries?.[s.id]} />
      ))}
    </div>
  );
}

function ScoreCard({ owner, total, projectedTotal, realProjectedTotal, whatIfTotal, opponentProjected, breakdown, readOnly }) {
  const leading = projectedTotal > opponentProjected;
  const tied = projectedTotal === opponentProjected;
  const realProj = realProjectedTotal ?? projectedTotal;
  const hasRealProjection = !readOnly && Math.abs(realProj - total) > 0.001;
  const hasWhatIf = !readOnly && (whatIfTotal || 0) > 0.001;
  return (
    <div className={`flex-1 p-3 border-2 ${owner === "Spencer" ? "border-amber-600" : "border-teal-600"} bg-white`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${ownerDot(owner)}`}></span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-stone-700">{owner}</span>
        </div>
        {leading && !tied && <span className="text-[9px] font-bold uppercase tracking-wider text-stone-900 bg-stone-900 text-white px-1.5 py-0.5">{readOnly ? "WINNER" : "LEAD"}</span>}
      </div>
      <div className={`text-4xl font-black tabular-nums ${ownerColor(owner)}`}>{total}</div>
      <div className="text-[10px] text-stone-500 uppercase tracking-wider mt-0.5">{breakdown.length} win{breakdown.length === 1 ? "" : "s"}{readOnly ? "" : " · locked"}</div>
      {hasRealProjection && (
        <div className="mt-2 pt-2 border-t border-stone-200">
          <div className="text-[9px] uppercase tracking-widest text-stone-500">Projected</div>
          <div className={`text-lg font-bold tabular-nums ${ownerColor(owner)}`}>{realProj.toFixed(2)}</div>
        </div>
      )}
      {hasWhatIf && (
        <div className="mt-1">
          <div className="text-[9px] uppercase tracking-widest text-stone-400">What If?</div>
          <div className="text-sm font-semibold tabular-nums text-stone-500">+{whatIfTotal.toFixed(2)}</div>
        </div>
      )}
    </div>
  );
}

function BreakdownList({ breakdown, owner }) {
  if (breakdown.length === 0) return <div className="text-xs text-stone-400 italic py-3 text-center">No wins yet</div>;
  return (
    <div className="space-y-1.5">
      {breakdown.map((item, i) => (
        <div key={i} className={`flex items-center justify-between text-xs px-2 py-1.5 ${ownerBg(owner)} border`}>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-stone-900 truncate">({item.team.seed}) {item.team.name}</div>
            <div className="text-[10px] text-stone-500 uppercase tracking-wider">{item.round} · beat ({item.opp.seed}) {item.opp.name}</div>
          </div>
          <div className="text-right ml-2 tabular-nums">
            <div className="font-bold text-sm text-stone-900">{item.total}</div>
            {item.bonus > 0 && <div className="text-[9px] text-stone-500">{item.base}+{item.bonus}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectionList({ projections, owner, label, muted }) {
  if (!projections || projections.length === 0) return null;
  return (
    <div className="mt-3">
      <div className={`text-[10px] uppercase tracking-widest mb-1.5 ${muted ? "text-stone-400" : "text-stone-500"}`}>{label}</div>
      <div className="space-y-1.5">
        {projections.map((item, i) => (
          <div key={i} className={`flex items-center justify-between text-xs px-2 py-1.5 border border-dashed border-stone-300 ${muted ? "bg-stone-50" : "bg-white"}`}>
            <div className="flex-1 min-w-0">
              <div className={`font-semibold truncate ${muted ? "text-stone-600" : "text-stone-900"}`}>({item.team.seed}) {item.team.name}</div>
              <div className="text-[10px] text-stone-500 uppercase tracking-wider">{item.round} · {item.gamesWon}/4 vs ({item.opp.seed}) {item.opp.name}</div>
            </div>
            <div className="text-right ml-2 tabular-nums">
              <div className={`font-bold text-sm ${muted ? "text-stone-600" : ownerColor(owner)}`}>{item.projected.toFixed(2)}</div>
              <div className="text-[9px] text-stone-500">of {item.total}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WhatIfClinchedList({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-widest text-stone-400 mb-1.5">Speculated Series Wins</div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 bg-stone-50 border border-dashed border-stone-300">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-stone-600 truncate">({item.team.seed}) {item.team.name}</div>
              <div className="text-[10px] text-stone-500 uppercase tracking-wider">{item.round} · beat ({item.opp.seed}) {item.opp.name}</div>
            </div>
            <div className="text-right ml-2 tabular-nums">
              <div className="font-bold text-sm text-stone-600">{item.total}</div>
              {item.bonus > 0 && <div className="text-[9px] text-stone-500">{item.base}+{item.bonus}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UpcomingTodayBanner({ liveGamesBySeries, actualWinners }) {
  const now = new Date();
  const allGames = [];
  for (const [sid, games] of Object.entries(liveGamesBySeries || {})) {
    if (actualWinners?.[sid]) continue; // Skip clinched series
    for (const g of games || []) {
      if (g.gameStatus !== 1) continue; // Only upcoming games
      if (!g.gameDateTimeUTC) continue;
      if (g.gameStatusText === "TBD") continue;
      const d = new Date(g.gameDateTimeUTC);
      const sameDay = d.getFullYear() === now.getFullYear() &&
                      d.getMonth() === now.getMonth() &&
                      d.getDate() === now.getDate();
      if (!sameDay || d.getTime() < now.getTime() - 30 * 60 * 1000) continue;
      allGames.push({ ...g, seriesId: sid, tipTime: d });
    }
  }

  if (allGames.length === 0) return null;

  allGames.sort((a, b) => a.tipTime.getTime() - b.tipTime.getTime());

  return (
    <div className="mb-5 p-3 bg-white border border-stone-300">
      <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-2">Today's Upcoming Games</div>
      <div className="space-y-1">
        {allGames.map((g) => {
          const homeOwner = TEAMS[g.home.tri]?.owner;
          const awayOwner = TEAMS[g.away.tri]?.owner;
          const timeStr = g.tipTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          const tv = (g.broadcasters || []).join(", ");
          return (
            <div key={g.gameId} className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="tabular-nums text-[10px] text-stone-500 w-14 shrink-0">{timeStr}</span>
                <span className={`font-semibold tabular-nums ${ownerColor(awayOwner)}`}>{g.away.tri}</span>
                <span className="text-stone-400">@</span>
                <span className={`font-semibold tabular-nums ${ownerColor(homeOwner)}`}>{g.home.tri}</span>
              </div>
              {tv && (
                <span className="text-[9px] uppercase tracking-wider text-stone-500 shrink-0">{tv}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryView({ season }) {
  const data = scoreHistory(season);
  const [showBreakdown, setShowBreakdown] = useState(null);
  if (!data) return <div className="text-stone-500 text-xs italic">No data for {season}</div>;
  const { breakdown, totals, meta } = data;

  return (
    <div>
      <div className="mb-4 p-3 bg-white border border-stone-300">
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-1">Champion</div>
        <div className="text-lg font-bold text-stone-900">{meta.champion}</div>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setShowBreakdown(showBreakdown === "Spencer" ? null : "Spencer")} className="flex-1 text-left">
          <ScoreCard owner="Spencer" total={totals.Spencer} projectedTotal={totals.Spencer} opponentProjected={totals.Trey} breakdown={breakdown.Spencer} readOnly />
        </button>
        <button onClick={() => setShowBreakdown(showBreakdown === "Trey" ? null : "Trey")} className="flex-1 text-left">
          <ScoreCard owner="Trey" total={totals.Trey} projectedTotal={totals.Trey} opponentProjected={totals.Spencer} breakdown={breakdown.Trey} readOnly />
        </button>
      </div>

      {showBreakdown && (
        <div className="mb-5 p-3 bg-white border border-stone-300">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold uppercase tracking-widest text-stone-900">{showBreakdown}'s Points</div>
            <button onClick={() => setShowBreakdown(null)} className="text-stone-400 text-lg leading-none">×</button>
          </div>
          <BreakdownList breakdown={breakdown[showBreakdown]} owner={showBreakdown} />
        </div>
      )}

      <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-2">Rosters</div>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {["Spencer", "Trey"].map((owner) => {
          const teams = Object.entries(meta.teams).filter(([, t]) => t.owner === owner);
          return (
            <div key={owner} className={`p-2 border ${ownerBg(owner)}`}>
              <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${ownerColor(owner)}`}>{owner}</div>
              <div className="space-y-0.5">
                {teams.map(([code, t]) => (
                  <div key={code} className="text-xs flex items-baseline gap-1">
                    <span className="text-[10px] text-stone-500 tabular-nums w-4">{t.seed}</span>
                    <span className="font-semibold text-stone-800">{t.name}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CurrentView() {
  const [winners, setWinners] = useState({});
  const [gameWins, setGameWins] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState(null);
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
          const migrated = {};
          for (const [sid, val] of Object.entries(saved.liveGames)) {
            migrated[sid] = Array.isArray(val) ? val : [val];
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

      setLiveGamesBySeries((prev) => {
        const next = { ...prev };
        (data.liveGames || []).forEach((g) => {
          const existing = next[g.seriesId] || [];
          const idx = existing.findIndex((x) => x.gameId === g.gameId);
          if (idx >= 0) {
            const updated = [...existing];
            updated[idx] = g;
            next[g.seriesId] = updated;
          } else {
            next[g.seriesId] = [...existing, g];
          }
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
          {syncedAt ? (<>Live synced <span className="text-stone-600">{syncedAt.toLocaleTimeString()}</span></>) : (<>Not synced yet</>)}
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
        <RoundSection roundKey="r1" title="First Round" series={BRACKET.r1} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
        <RoundSection roundKey="r2" title="Conference Semifinals" series={BRACKET.r2} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
        <RoundSection roundKey="r3" title="Conference Finals" series={BRACKET.r3} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
        <RoundSection roundKey="r4" title="NBA Finals" series={BRACKET.r4} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
      </div>
    </div>
  );
}

export default function PlayoffTracker() {
  const [tab, setTab] = useState("current");
  const seasons = Object.keys(HISTORY);

  return (
    <div className="min-h-screen bg-stone-100" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <header className="mb-4">
          <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-1">NBA Playoff</div>
          <h1 className="text-3xl font-black text-stone-900 leading-none tracking-tight" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>Draft Tracker</h1>
          <div className="mt-1 text-xs text-stone-600">Spencer <span className="text-stone-400 mx-1">vs</span> Trey</div>
        </header>

        <div className="flex border-b-2 border-stone-900 mb-5">
          <button
            onClick={() => setTab("current")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest ${tab === "current" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            2025-26
          </button>
          {seasons.map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest ${tab === s ? "bg-stone-900 text-white" : "text-stone-500"}`}
            >
              {s}
            </button>
          ))}
        </div>

        {tab === "current" ? <CurrentView /> : <HistoryView season={tab} />}
      </div>
    </div>
  );
}
