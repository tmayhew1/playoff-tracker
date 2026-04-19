"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";

const TEAMS = {
  SAS: { name: "Spurs",    seed: 2, owner: "Spencer", conf: "W" },
  DEN: { name: "Nuggets",  seed: 3, owner: "Spencer", conf: "W" },
  CLE: { name: "Cavs",     seed: 4, owner: "Spencer", conf: "E" },
  HOU: { name: "Rockets",  seed: 5, owner: "Spencer", conf: "W" },
  NYK: { name: "Knicks",   seed: 3, owner: "Spencer", conf: "E" },
  ORL: { name: "Magic",    seed: 8, owner: "Spencer", conf: "E" },
  PHI: { name: "76ers",    seed: 7, owner: "Spencer", conf: "E" },
  PHX: { name: "Suns",     seed: 8, owner: "Spencer", conf: "W" },
  OKC: { name: "Thunder",  seed: 1, owner: "Trey",    conf: "W" },
  BOS: { name: "Celtics",  seed: 2, owner: "Trey",    conf: "E" },
  MIN: { name: "Wolves",   seed: 6, owner: "Trey",    conf: "W" },
  DET: { name: "Pistons",  seed: 1, owner: "Trey",    conf: "E" },
  ATL: { name: "Hawks",    seed: 6, owner: "Trey",    conf: "E" },
  LAL: { name: "Lakers",   seed: 4, owner: "Trey",    conf: "W" },
  TOR: { name: "Raptors",  seed: 5, owner: "Trey",    conf: "E" },
  POR: { name: "Blazers",  seed: 7, owner: "Trey",    conf: "W" },
};

const BRACKET = {
  r1: [
    { id: "E1", teams: ["DET", "ORL"], conf: "E" },
    { id: "E4", teams: ["CLE", "TOR"], conf: "E" },
    { id: "E3", teams: ["NYK", "ATL"], conf: "E" },
    { id: "E2", teams: ["BOS", "PHI"], conf: "E" },
    { id: "W1", teams: ["OKC", "PHX"], conf: "W" },
    { id: "W4", teams: ["LAL", "HOU"], conf: "W" },
    { id: "W3", teams: ["DEN", "MIN"], conf: "W" },
    { id: "W2", teams: ["SAS", "POR"], conf: "W" },
  ],
  r2: [
    { id: "ES1", from: ["E1", "E4"], conf: "E" },
    { id: "ES2", from: ["E2", "E3"], conf: "E" },
    { id: "WS1", from: ["W1", "W4"], conf: "W" },
    { id: "WS2", from: ["W2", "W3"], conf: "W" },
  ],
  r3: [
    { id: "ECF", from: ["ES1", "ES2"], conf: "E" },
    { id: "WCF", from: ["WS1", "WS2"], conf: "W" },
  ],
  r4: [{ id: "F", from: ["ECF", "WCF"], conf: "F" }],
};

const ROUND_BASE = { r1: 1, r2: 2, r3: 4, r4: 8 };
const ROUND_LABEL = { r1: "First Round", r2: "Conf Semis", r3: "Conf Finals", r4: "Finals" };
const STORAGE_KEY = "playoff-draft-v1";

// 2025-26 league averages used in the Value Added calculation.
// These mirror Trey's `lga` tibble in app.R — edit if new season values are available.
const LGA = {
  la3P: 0.366,       // 3P%
  la2P: 0.545,       // 2P%
  laFT: 0.786,       // FT%
  laFG: 0.471,       // FG%
  laPTSperM: 0.548,  // pts per minute (league)
  laASTperM: 0.119,
  laSTLperM: 0.032,
  laBLKperM: 0.024,
  laTOVperM: 0.068,
  laDRBperM: 0.152,
  laORBperM: 0.045,
  laPTSperMake: 2.216,
  laPTSperPoss: 1.135,
  laDRBrate: 0.765,
  laORBrate: 0.235,
};

function valueAdd(p) {
  const { mp, pts, ast, stl, blk, tov, drb, orb, tpm, tpa, fgm, fga, ftm, fta } = p;
  if (!mp || mp <= 0) return 0;
  const twoPm = fgm - tpm, twoPa = fga - tpa;
  const tpAdd = ((tpm / (tpa || 1)) - LGA.la3P) * tpa;
  const twoAdd = ((twoPm / (twoPa || 1)) - LGA.la2P) * twoPa;
  const ftAdd = ((ftm / (fta || 1)) - LGA.laFT) * fta;
  const volume = ((pts / mp) - LGA.laPTSperM) * mp;
  const efficiency = 3 * tpAdd + 2 * twoAdd + ftAdd;
  const astVal = ((ast / mp) - LGA.laASTperM) * mp * LGA.laPTSperMake * (1 - LGA.laFG);
  const stlVal = ((stl / mp) - LGA.laSTLperM) * mp * LGA.laPTSperPoss;
  const blkVal = ((blk / mp) - LGA.laBLKperM) * mp * LGA.laPTSperPoss * LGA.laDRBrate;
  const tovVal = -((tov / mp) - LGA.laTOVperM) * mp * LGA.laPTSperPoss;
  const drbVal = ((drb / mp) - LGA.laDRBperM) * mp * LGA.laPTSperPoss * LGA.laORBrate;
  const orbVal = ((orb / mp) - LGA.laORBperM) * mp * LGA.laPTSperPoss * LGA.laDRBrate;
  return volume + efficiency + astVal + stlVal + blkVal + tovVal + drbVal + orbVal;
}

function computeMatchups(winners) {
  const t = {};
  BRACKET.r1.forEach((s) => (t[s.id] = s.teams.slice()));
  const resolve = (id) => winners[id];
  BRACKET.r2.forEach((s) => (t[s.id] = s.from.map(resolve)));
  BRACKET.r3.forEach((s) => (t[s.id] = s.from.map(resolve)));
  BRACKET.r4.forEach((s) => (t[s.id] = s.from.map(resolve)));
  return t;
}

function potentialPoints(winTeam, loseTeam, roundKey) {
  const base = ROUND_BASE[roundKey];
  const diff = winTeam.seed - loseTeam.seed;
  const bonus = diff > 0 ? diff : 0;
  return { base, bonus, total: base + bonus };
}

function computePoints(winners, gameWins) {
  const matchups = computeMatchups(winners);
  const breakdown = { Spencer: [], Trey: [] };
  const projections = { Spencer: [], Trey: [] };
  const rounds = [
    { key: "r1", series: BRACKET.r1 },
    { key: "r2", series: BRACKET.r2 },
    { key: "r3", series: BRACKET.r3 },
    { key: "r4", series: BRACKET.r4 },
  ];
  rounds.forEach(({ key, series }) => {
    series.forEach((s) => {
      const [a, b] = matchups[s.id] || [];
      if (!a || !b) return;
      const winCode = winners[s.id];
      if (winCode) {
        const winTeam = TEAMS[winCode];
        const loseCode = a === winCode ? b : a;
        const loseTeam = TEAMS[loseCode];
        if (!winTeam || !loseTeam) return;
        const { base, bonus, total } = potentialPoints(winTeam, loseTeam, key);
        breakdown[winTeam.owner].push({ round: ROUND_LABEL[key], roundKey: key, team: winTeam, opp: loseTeam, base, bonus, total });
      } else {
        const games = gameWins[s.id] || { [a]: 0, [b]: 0 };
        [a, b].forEach((code) => {
          const team = TEAMS[code];
          const oppCode = code === a ? b : a;
          const opp = TEAMS[oppCode];
          if (!team || !opp) return;
          const gamesWon = games[code] || 0;
          if (gamesWon === 0) return;
          const { total } = potentialPoints(team, opp, key);
          const projected = total * (gamesWon / 4);
          projections[team.owner].push({ round: ROUND_LABEL[key], roundKey: key, team, opp, gamesWon, total, projected });
        });
      }
    });
  });
  const totals = {
    Spencer: breakdown.Spencer.reduce((a, x) => a + x.total, 0),
    Trey: breakdown.Trey.reduce((a, x) => a + x.total, 0),
  };
  const projectedTotals = {
    Spencer: totals.Spencer + projections.Spencer.reduce((a, x) => a + x.projected, 0),
    Trey: totals.Trey + projections.Trey.reduce((a, x) => a + x.projected, 0),
  };
  return { breakdown, totals, projections, projectedTotals, matchups };
}

const ownerColor = (o) => o === "Spencer" ? "text-amber-700" : "text-teal-700";
const ownerBg = (o) => o === "Spencer" ? "bg-amber-50 border-amber-300" : "bg-teal-50 border-teal-300";
const ownerDot = (o) => o === "Spencer" ? "bg-amber-600" : "bg-teal-600";
const ownerBadge = (o) => o === "Spencer" ? "bg-amber-100 text-amber-800" : o === "Trey" ? "bg-teal-100 text-teal-800" : "bg-stone-100 text-stone-600";

function GameStepper({ value, onChange, disabled, color }) {
  return (
    <div className="flex items-center gap-1 mt-1">
      <button onClick={(e) => { e.stopPropagation(); if (!disabled && value > 0) onChange(value - 1); }} disabled={disabled || value === 0} className="w-5 h-5 flex items-center justify-center border border-stone-300 bg-white text-stone-600 text-sm leading-none disabled:opacity-30">−</button>
      <span className={`text-xs font-bold tabular-nums w-4 text-center ${color}`}>{value}</span>
      <button onClick={(e) => { e.stopPropagation(); if (!disabled && value < 4) onChange(value + 1); }} disabled={disabled || value >= 4} className="w-5 h-5 flex items-center justify-center border border-stone-300 bg-white text-stone-600 text-sm leading-none disabled:opacity-30">+</button>
    </div>
  );
}

function CombinedBoxscore({ box, isLive }) {
  if (!box) return null;
  // Flatten both teams into one array, tag each row with team tri
  const rows = [
    ...(box.away?.players || []).map((p) => ({ ...p, team: box.away.tri })),
    ...(box.home?.players || []).map((p) => ({ ...p, team: box.home.tri })),
  ]
    .filter((p) => (p.mp || 0) > 0) // drop anyone who didn't play
    .map((p) => ({ ...p, va: valueAdd(p) }))
    .sort((a, b) => b.pts - a.pts);

  if (rows.length === 0) {
    return <div className="py-2 text-[10px] text-stone-500 italic text-center">No player stats yet</div>;
  }

  return (
    <div className="mt-2">
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
        const teamInfo = TEAMS[p.team];
        const owner = teamInfo?.owner;
        return (
          <div key={i} className="flex items-center gap-2 text-[10px] py-1 border-b border-stone-100 last:border-0">
            <span className={`w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center ${ownerBadge(owner)}`}>
              {p.team}
            </span>
            <span className={`flex-1 truncate ${p.starter ? "font-semibold text-stone-800" : "text-stone-600"}`}>
              {p.name}{isLive && p.oncourt && <span className="ml-1 text-red-600">●</span>}
            </span>
            <span className="tabular-nums text-stone-500 w-7 text-right">{Math.round(p.mp)}</span>
            <span className="tabular-nums font-bold text-stone-900 w-6 text-right">{p.pts}</span>
            <span className="tabular-nums text-stone-600 w-5 text-right">{p.reb}</span>
            <span className="tabular-nums text-stone-600 w-5 text-right">{p.ast}</span>
            <span className={`tabular-nums w-8 text-right font-semibold ${p.va > 0 ? "text-stone-900" : "text-stone-400"}`}>
              {p.va.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LiveGameBanner({ liveGame }) {
  const [expanded, setExpanded] = useState(false);
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

  useEffect(() => {
    if (!expanded || !liveGame?.gameId) return;
    loadBox();
    if (liveGame.gameStatus === 2) {
      const id = setInterval(loadBox, 45000);
      return () => clearInterval(id);
    }
  }, [expanded, liveGame?.gameId, liveGame?.gameStatus, loadBox]);

  if (!liveGame) return null;
  const { home, away, gameStatus, gameStatusText, gameId } = liveGame;
  const isLive = gameStatus === 2;
  const isFinal = gameStatus === 3;
  const canExpand = !!gameId && (isLive || isFinal);

  return (
    <div className={`mt-1 border ${isLive ? "bg-red-50 border-red-300" : isFinal ? "bg-stone-100 border-stone-300" : "bg-stone-50 border-stone-200"}`}>
      <button
        onClick={() => canExpand && setExpanded(!expanded)}
        disabled={!canExpand}
        className="w-full px-2 py-1 text-[10px] flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-1.5">
          {isLive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span>}
          <span className={`font-bold uppercase tracking-wider ${isLive ? "text-red-700" : "text-stone-600"}`}>
            {isLive ? "LIVE" : isFinal ? "FINAL" : (gameStatusText || "SOON")}
          </span>
          {canExpand && <span className="text-stone-400">{expanded ? "▾" : "▸"}</span>}
        </div>
        <div className="tabular-nums font-semibold text-stone-700">
          {away.tri} {away.score} — {home.score} {home.tri}
        </div>
      </button>
      {expanded && (
        <div className="px-2 pb-2 border-t border-stone-200">
          {loading && !box && <div className="py-2 text-[10px] text-stone-500 italic text-center">Loading stats…</div>}
          {error && <div className="py-2 text-[10px] text-red-600 text-center">{error}</div>}
          {box && <CombinedBoxscore box={box} isLive={isLive} />}
        </div>
      )}
    </div>
  );
}

function TeamButton({ code, selected, disabled, onClick, gamesWon, onGamesChange, seriesDecided }) {
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
      {!seriesDecided && <GameStepper value={gamesWon || 0} onChange={(v) => onGamesChange(code, v)} disabled={disabled} color={ownerColor(t.owner)} />}
    </div>
  );
}

function SeriesRow({ series, matchups, winners, gameWins, onPick, onGamesChange, liveGame }) {
  const [a, b] = matchups[series.id] || [];
  const winner = winners[series.id];
  const canPick = a && b;
  const games = gameWins[series.id] || {};
  const seriesDecided = !!winner;
  return (
    <div className="mb-2">
      <div className="flex gap-1.5 items-stretch">
        <TeamButton code={a} selected={winner} disabled={!canPick} onClick={(code) => onPick(series.id, winner === code ? null : code)} gamesWon={games[a]} onGamesChange={(code, v) => onGamesChange(series.id, code, v)} seriesDecided={seriesDecided} />
        <div className="flex items-center justify-center px-1 text-[10px] font-bold text-stone-400 tracking-widest">VS</div>
        <TeamButton code={b} selected={winner} disabled={!canPick} onClick={(code) => onPick(series.id, winner === code ? null : code)} gamesWon={games[b]} onGamesChange={(code, v) => onGamesChange(series.id, code, v)} seriesDecided={seriesDecided} />
      </div>
      <LiveGameBanner liveGame={liveGame} />
    </div>
  );
}

function RoundSection({ roundKey, title, series, matchups, winners, gameWins, onPick, onGamesChange, liveGamesBySeries }) {
  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-2.5 pb-1.5 border-b-2 border-stone-900">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900">{title}</h3>
        <span className="text-[10px] uppercase tracking-wider text-stone-500 tabular-nums">+{ROUND_BASE[roundKey]} pt{ROUND_BASE[roundKey] > 1 ? "s" : ""}/win</span>
      </div>
      {series.map((s) => (
        <SeriesRow key={s.id} series={s} matchups={matchups} winners={winners} gameWins={gameWins} onPick={onPick} onGamesChange={onGamesChange} liveGame={liveGamesBySeries?.[s.id]} />
      ))}
    </div>
  );
}

function ScoreCard({ owner, total, projectedTotal, opponentProjected, breakdown }) {
  const leading = projectedTotal > opponentProjected;
  const tied = projectedTotal === opponentProjected;
  const hasProjection = Math.abs(projectedTotal - total) > 0.001;
  return (
    <div className={`flex-1 p-3 border-2 ${owner === "Spencer" ? "border-amber-600" : "border-teal-600"} bg-white`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${ownerDot(owner)}`}></span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-stone-700">{owner}</span>
        </div>
        {leading && !tied && <span className="text-[9px] font-bold uppercase tracking-wider text-stone-900 bg-stone-900 text-white px-1.5 py-0.5">LEAD</span>}
      </div>
      <div className={`text-4xl font-black tabular-nums ${ownerColor(owner)}`}>{total}</div>
      <div className="text-[10px] text-stone-500 uppercase tracking-wider mt-0.5">{breakdown.length} win{breakdown.length === 1 ? "" : "s"} · locked</div>
      {hasProjection && (
        <div className="mt-2 pt-2 border-t border-stone-200">
          <div className="text-[9px] uppercase tracking-widest text-stone-500">Projected</div>
          <div className={`text-lg font-bold tabular-nums ${ownerColor(owner)}`}>{projectedTotal.toFixed(2)}</div>
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

function ProjectionList({ projections, owner }) {
  if (projections.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1.5">In-Progress Projections</div>
      <div className="space-y-1.5">
        {projections.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 bg-white border border-dashed border-stone-300">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-stone-900 truncate">({item.team.seed}) {item.team.name}</div>
              <div className="text-[10px] text-stone-500 uppercase tracking-wider">{item.round} · {item.gamesWon}/4 vs ({item.opp.seed}) {item.opp.name}</div>
            </div>
            <div className="text-right ml-2 tabular-nums">
              <div className={`font-bold text-sm ${ownerColor(owner)}`}>{item.projected.toFixed(2)}</div>
              <div className="text-[9px] text-stone-500">of {item.total}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PlayoffTracker() {
  const [winners, setWinners] = useState({});
  const [gameWins, setGameWins] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [liveGamesBySeries, setLiveGamesBySeries] = useState({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.winners) setWinners(saved.winners);
        if (saved.gameWins) setGameWins(saved.gameWins);
      }
    } catch (e) {}
    setLoaded(true);
  }, []);

  const persist = useCallback((w, g) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ winners: w, gameWins: g })); } catch (e) {}
  }, []);

  const syncLive = useCallback(async (override = false) => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/scores", { cache: "no-store" });
      if (!res.ok) throw new Error(`Proxy ${res.status}`);
      const data = await res.json();
      const liveMap = {};
      (data.liveGames || []).forEach((g) => { liveMap[g.seriesId] = g; });
      setLiveGamesBySeries(liveMap);
      setGameWins((prev) => {
        const next = { ...prev };
        Object.entries(data.gameWins || {}).forEach(([sid, liveWins]) => {
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
    const hasLive = Object.values(liveGamesBySeries).some((g) => g.gameStatus === 2);
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
      persist({}, {});
      syncLive(true);
    }
  };

  const { breakdown, totals, projections, projectedTotals, matchups } = useMemo(
    () => computePoints(winners, gameWins), [winners, gameWins]
  );

  if (!loaded) {
    return <div className="min-h-screen flex items-center justify-center bg-stone-100 text-stone-500 text-xs uppercase tracking-widest">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-stone-100" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-1">2026 NBA Playoffs</div>
            <h1 className="text-3xl font-black text-stone-900 leading-none tracking-tight" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>Draft Tracker</h1>
            <div className="mt-1 text-xs text-stone-600">Spencer <span className="text-stone-400 mx-1">vs</span> Trey</div>
          </div>
          <button onClick={() => syncLive(true)} disabled={syncing} className="text-[10px] uppercase tracking-widest text-stone-600 border border-stone-400 px-2 py-1.5 bg-white hover:bg-stone-50 disabled:opacity-50 shrink-0">
            {syncing ? "Syncing…" : "↻ Sync"}
          </button>
        </header>

        <div className="flex gap-2 mb-4">
          <button onClick={() => setShowBreakdown(showBreakdown === "Spencer" ? null : "Spencer")} className="flex-1 text-left">
            <ScoreCard owner="Spencer" total={totals.Spencer} projectedTotal={projectedTotals.Spencer} opponentProjected={projectedTotals.Trey} breakdown={breakdown.Spencer} />
          </button>
          <button onClick={() => setShowBreakdown(showBreakdown === "Trey" ? null : "Trey")} className="flex-1 text-left">
            <ScoreCard owner="Trey" total={totals.Trey} projectedTotal={projectedTotals.Trey} opponentProjected={projectedTotals.Spencer} breakdown={breakdown.Trey} />
          </button>
        </div>

        {showBreakdown && (
          <div className="mb-5 p-3 bg-white border border-stone-300">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold uppercase tracking-widest text-stone-900">{showBreakdown}'s Points</div>
              <button onClick={() => setShowBreakdown(null)} className="text-stone-400 text-lg leading-none">×</button>
            </div>
            <BreakdownList breakdown={breakdown[showBreakdown]} owner={showBreakdown} />
            <ProjectionList projections={projections[showBreakdown]} owner={showBreakdown} />
          </div>
        )}

        <details className="mb-5 text-xs text-stone-600 border-l-2 border-stone-300 pl-3">
          <summary className="cursor-pointer font-semibold uppercase tracking-wider text-stone-700 text-[10px]">Scoring rules</summary>
          <div className="mt-2 space-y-1 leading-relaxed">
            <div>R1: 1 pt · R2: 2 pts · CF: 4 pts · Finals: 8 pts</div>
            <div>Upset bonus: winner's seed minus loser's seed (when winner is the lower seed).</div>
            <div>Projection: series-win value × (games won ÷ 4) for any in-progress series.</div>
            <div className="text-stone-400 italic">Tap a game banner for box score with VA. Red dots (●) mark players currently on the court.</div>
          </div>
        </details>

        <div>
          <RoundSection roundKey="r1" title="First Round" series={BRACKET.r1} matchups={matchups} winners={winners} gameWins={gameWins} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
          <RoundSection roundKey="r2" title="Conference Semifinals" series={BRACKET.r2} matchups={matchups} winners={winners} gameWins={gameWins} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
          <RoundSection roundKey="r3" title="Conference Finals" series={BRACKET.r3} matchups={matchups} winners={winners} gameWins={gameWins} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
          <RoundSection roundKey="r4" title="NBA Finals" series={BRACKET.r4} matchups={matchups} winners={winners} gameWins={gameWins} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
        </div>

        <div className="mt-6 pt-4 border-t border-stone-300 flex justify-between items-center gap-3">
          <div className="text-[10px] uppercase tracking-widest text-stone-400 leading-tight">
            {syncedAt ? (<>Live synced<br /><span className="text-stone-600">{syncedAt.toLocaleTimeString()}</span></>) : (<>Not synced yet</>)}
            {syncError && <div className="text-red-600 normal-case mt-1 tracking-normal">{syncError}</div>}
          </div>
          <button onClick={resetAll} className="text-[10px] uppercase tracking-widest text-stone-500 hover:text-stone-900 border border-stone-300 px-2 py-1 shrink-0">Reset</button>
        </div>
      </div>
    </div>
  );
}
