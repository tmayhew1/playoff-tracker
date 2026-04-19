"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { HISTORY, scoreHistory } from "./historical";

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

const LGA = {
  la3P: 0.359686938670772,
  la2P: 0.548356161904934,
  laFT: 0.788506191950464,
  laFG: 0.470335430881713,
  laPTSperM: 0.408655965562845,
  laASTperM: 0.0827805842301779,
  laSTLperM: 0.032258064516129,
  laBLKperM: 0.0143884892086331,
  laTOVperM: 0.0516272842803455,
  laDRBperM: 0.121786420566908,
  laORBperM: 0.0384615384615385,
  laPTSperMake: 2.31624664395461,
  laPTSperPoss: 1.01391216652376,
  laDRBrate: 0.738162582316744,
  laORBrate: 0.261837417683256,
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

function WinCircles({ value, onChange, disabled, owner }) {
  const fillColor = owner === "Spencer" ? "bg-amber-500 border-amber-600" : "bg-teal-500 border-teal-600";
  return (
    <div className="flex items-center gap-1 mt-1">
      {[1, 2, 3, 4].map((n) => {
        const filled = value >= n;
        return (
          <button
            key={n}
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              // Tap filled circle to decrement (set to n-1); tap empty to set to n
              onChange(filled ? n - 1 : n);
            }}
            disabled={disabled}
            className={`w-3.5 h-3.5 rounded-full border transition-colors ${filled ? fillColor : "bg-white border-stone-300"} disabled:opacity-40`}
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

function CombinedBoxscore({ box, isLive }) {
  const [expandedPlayer, setExpandedPlayer] = useState(null);

  if (!box) return null;
  const rows = [
    ...(box.away?.players || []).map((p) => ({ ...p, team: box.away.tri })),
    ...(box.home?.players || []).map((p) => ({ ...p, team: box.home.tri })),
  ]
    .filter((p) => (p.mp || 0) > 0)
    .map((p) => ({ ...p, va: valueAdd(p) }))
    .sort((a, b) => b.va - a.va);

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
        const rowKey = `${p.team}-${p.name}-${i}`;
        const isExpanded = expandedPlayer === rowKey;
        return (
          <div key={rowKey} className="border-b border-stone-100 last:border-0">
            <button
              onClick={() => setExpandedPlayer(isExpanded ? null : rowKey)}
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
      })}
    </div>
  );
}

function LiveGameBanner({ liveGame, gameLabel }) {
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
  const { home, away, gameStatus, gameStatusText, gameId, gameDateTimeUTC } = liveGame;
  const isLive = gameStatus === 2;
  const isFinal = gameStatus === 3;
  const canExpand = !!gameId && (isLive || isFinal);

  // Upcoming: "Today 7:30 PM" if same day, else just "4/22"
  let displayStatus = gameStatusText;
  if (gameStatus === 1 && gameDateTimeUTC) {
    const d = new Date(gameDateTimeUTC);
    const now = new Date();
    const isSameDay = d.getFullYear() === now.getFullYear() &&
                      d.getMonth() === now.getMonth() &&
                      d.getDate() === now.getDate();
    if (isSameDay) {
      const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      displayStatus = `Today ${timeStr}`;
    } else {
      displayStatus = `${d.getMonth() + 1}/${d.getDate()}`;
    }
  }

  let finalClasses = "bg-stone-100 border-stone-300";
  if (isFinal && home.score !== away.score) {
    const winnerTri = home.score > away.score ? home.tri : away.tri;
    const winnerOwner = TEAMS[winnerTri]?.owner;
    if (winnerOwner === "Spencer") finalClasses = "bg-amber-50 border-amber-400";
    else if (winnerOwner === "Trey") finalClasses = "bg-teal-50 border-teal-400";
  }

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
            {isLive ? "LIVE" : isFinal ? "FINAL" : (displayStatus || "SOON")}
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
      {!seriesDecided && <WinCircles value={gamesWon || 0} onChange={(v) => onGamesChange(code, v)} disabled={disabled} owner={t.owner} />}
    </div>
  );
}

function SeriesRow({ series, matchups, winners, gameWins, onPick, onGamesChange, liveGame }) {
  const [a, b] = matchups[series.id] || [];
  const winner = winners[series.id];
  const canPick = a && b;
  const games = gameWins[series.id] || {};
  const seriesDecided = !!winner;
  const seriesGames = (liveGame || []).slice().sort((x, y) =>
    (x.gameId || "").localeCompare(y.gameId || "")
  );

  // Separate scheduled/final/live games from TBD (conditional) games.
  // A game is "TBD" if it has no confirmed date — the schedule gives these
  // a placeholder status text like "PPD" or missing gameDateTimeUTC, and
  // typically gameDateTimeUTC will be null or far in the future.
  const realGames = [];
  const tbdGames = [];
  for (const g of seriesGames) {
    const hasRealDate = !!g.gameDateTimeUTC && !isNaN(new Date(g.gameDateTimeUTC).getTime());
    // A "TBD" game in NBA schedule JSON has gameDateTimeUTC set to a
    // placeholder far-future date (often year 2050+) or missing entirely.
    const isTbd = !hasRealDate || new Date(g.gameDateTimeUTC).getFullYear() > 2040;
    if (g.gameStatus === 1 && isTbd) {
      tbdGames.push(g);
    } else {
      realGames.push(g);
    }
  }

  // Game numbers: real games get numbered first in order, then TBDs continue.
  const tbdGameNumbers = tbdGames.map((_, i) => realGames.length + i + 1).filter((n) => n <= 7);

  return (
    <div className="mb-3 p-2 bg-stone-50 border border-stone-200 rounded">
      <div className="flex gap-1.5 items-stretch">
        <TeamButton code={a} selected={winner} disabled={!canPick} onClick={(code) => onPick(series.id, winner === code ? null : code)} gamesWon={games[a]} onGamesChange={(code, v) => onGamesChange(series.id, code, v)} seriesDecided={seriesDecided} />
        <div className="flex items-center justify-center px-1 text-[10px] font-bold text-stone-400 tracking-widest">VS</div>
        <TeamButton code={b} selected={winner} disabled={!canPick} onClick={(code) => onPick(series.id, winner === code ? null : code)} gamesWon={games[b]} onGamesChange={(code, v) => onGamesChange(series.id, code, v)} seriesDecided={seriesDecided} />
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

function ScoreCard({ owner, total, projectedTotal, opponentProjected, breakdown, readOnly }) {
  const leading = projectedTotal > opponentProjected;
  const tied = projectedTotal === opponentProjected;
  const hasProjection = !readOnly && Math.abs(projectedTotal - total) > 0.001;
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

  const { breakdown, totals, projections, projectedTotals, matchups } = useMemo(
    () => computePoints(winners, gameWins), [winners, gameWins]
  );

  if (!loaded) {
    return <div className="text-stone-500 text-xs uppercase tracking-widest py-12 text-center">Loading…</div>;
  }

  return (
    <div>
      <div className="flex items-start justify-end mb-3">
        <button onClick={() => syncLive(true)} disabled={syncing} className="text-[10px] uppercase tracking-widest text-stone-600 border border-stone-400 px-2 py-1.5 bg-white hover:bg-stone-50 disabled:opacity-50 shrink-0">
          {syncing ? "Syncing…" : "↻ Sync"}
        </button>
      </div>

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
          <div className="text-stone-400 italic">Tap a win circle to count or remove a series win. Tap a game banner for box score. Tap any player row for VA breakdown.</div>
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
