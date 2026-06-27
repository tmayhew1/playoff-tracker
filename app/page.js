"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { HISTORY, scoreHistory, historyRounds } from "./historical";
import { TEAMS, TEAM_CONF, BRACKET, ROUND_BASE, STORAGE_KEY } from "./teams";
import { LGA, valueAdd, valueAddParts, valueAddByCategory, computePoints, potentialPoints, lgaForSeason } from "./scoring";
import TEAM_COLORS from "./data/team-colors.json";

// Per-team primary color (hex). Used in Explore and anywhere we don't have
// an owner mapping (e.g. defunct/renamed franchises in old seasons).
const teamColor = (tri) => TEAM_COLORS[tri] || "#78716c";
const withAlpha = (hex, alpha) => {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
  return hex + a;
};

// Loose name match for joining ESPN box-score names with basketball-reference
// names (regular-season reference tick). Strips punctuation, suffixes like
// "Jr."/"III", collapses whitespace, and folds diacritics so "P.J. Tucker"
// matches "PJ Tucker" and "Luka Dončić" matches "Luka Doncic".
const normalizeName = (s) => (s || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[.''`,]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");

// `dim` = lighten owner styling when both teams in a matchup share an owner,
// to flag the side that wins the series for fewer points (no upset bonus).
const ownerColor = (o, dim) => {
  if (o === "Spencer") return dim ? "text-amber-400" : "text-amber-700";
  if (o === "Trey") return dim ? "text-teal-400" : "text-teal-700";
  return "";
};
const ownerBg = (o) => o === "Spencer" ? "bg-amber-50 border-amber-300" : "bg-teal-50 border-teal-300";
const ownerDot = (o, dim) => {
  if (o === "Spencer") return dim ? "bg-amber-300" : "bg-amber-600";
  if (o === "Trey") return dim ? "bg-teal-300" : "bg-teal-600";
  return "";
};
const ownerBadge = (o) => o === "Spencer" ? "bg-amber-100 text-amber-800" : o === "Trey" ? "bg-teal-100 text-teal-800" : "bg-stone-100 text-stone-600";

function WinCircles({ value, actualValue, onChange, disabled, owner, dim }) {
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

function GameVAChart({ values, color = "#57534e", selected, onSelect, partitions, seriesRange, label = "VA by Game", avgOther = null, avgSelected = null }) {
  const stroke = color;
  // Always show at least 4 game slots; pad with nulls so G1..G4 render even
  // for 1- or 2-game series.
  const n = Math.max(values.length, 4);
  const padded = values.length >= n ? values : [...values, ...Array(n - values.length).fill(null)];
  const W = 320, H = 100;
  const pad = { l: 14, r: 10, t: 22, b: 8 };
  // Only the top-scoring dot gets a value label (max anchor for scale).
  let topIdx = -1, topVal = -Infinity;
  padded.forEach((v, i) => { if (v != null && v > topVal) { topVal = v; topIdx = i; } });
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  // Extra strip below the plotting area where the avg-delta label parks,
  // directly beneath the shaded band so it never overlaps the data.
  const STRIP = 13;
  const nums = padded.filter((v) => v != null);
  let vMin = Math.min(0, ...(nums.length ? nums : [0]));
  let vMax = Math.max(0, ...(nums.length ? nums : [0]));
  if (vMin === vMax) { vMin -= 1; vMax += 1; }
  const x = (i) => pad.l + (i / (n - 1)) * innerW;
  const y = (v) => pad.t + (1 - (v - vMin) / (vMax - vMin)) * innerH;
  // color (the player's accent) is already set above as `stroke`.

  let d = "";
  for (let i = 0; i < n; i++) {
    if (padded[i] == null) continue;
    d += `${(i === 0 || padded[i - 1] == null) ? "M" : "L"} ${x(i)} ${y(padded[i])} `;
  }

  return (
    <div className="mt-2 mb-3">
      <div className="text-[9px] uppercase tracking-widest text-stone-500 mb-1 text-center">{label}</div>
      <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + STRIP}`} className="w-full block">
        {/* Series-band shading (used when a series is selected but no
            single game has been drilled into) */}
        {selected == null && Array.isArray(seriesRange) && (() => {
          const colW = innerW / (n - 1);
          const [a, b] = seriesRange;
          return (
            <rect
              x={x(a) - colW / 2}
              y={0}
              width={x(b) - x(a) + colW}
              height={H}
              fill={withAlpha(stroke, 0.10)}
              stroke={withAlpha(stroke, 0.30)}
              strokeWidth="1"
            />
          );
        })()}
        {/* Selected column shading sits behind everything else */}
        {selected != null && padded[selected - 1] != null && (() => {
          const colW = innerW / (n - 1);
          return (
            <rect
              x={x(selected - 1) - colW / 2}
              y={0}
              width={colW}
              height={H}
              fill={withAlpha(stroke, 0.12)}
              stroke={withAlpha(stroke, 0.35)}
              strokeWidth="1"
            />
          );
        })()}
        {/* Zero axis: SOLID and marked with a "0" in the left gutter, so
            it's plainly the baseline and never blurs into the dashed/
            dotted gray average reference lines. */}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#78716c" strokeWidth="1" />
        <text x={pad.l - 3} y={y(0)} fontSize="7" textAnchor="end" dominantBaseline="middle" fill="#78716c" className="tabular-nums">0</text>
        {/* Reference: dim full-width line at the average of the "other"
            games (other series in series view, other games in game view). */}
        {avgOther != null && (
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(avgOther)}
            y2={y(avgOther)}
            stroke="#a8a29e"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
        {/* Reference: solid line at the average of the selected series,
            drawn only inside the series band (game-view doesn't get the
            line — its selected column already shows the value). */}
        {avgSelected != null && Array.isArray(seriesRange) && (() => {
          const colW = innerW / (n - 1);
          const [a, b] = seriesRange;
          return (
            <line
              x1={x(a) - colW / 2}
              x2={x(b) + colW / 2}
              y1={y(avgSelected)}
              y2={y(avgSelected)}
              stroke={stroke}
              strokeWidth="1.5"
              opacity="0.85"
            />
          );
        })()}
        {/* Series partitions: dotted vertical between i-1 and i */}
        {(partitions || []).map((j) => {
          if (j <= 0 || j >= n) return null;
          const px = (x(j - 1) + x(j)) / 2;
          return (
            <line
              key={`part-${j}`}
              x1={px} x2={px}
              y1={pad.t - 6}
              y2={H - pad.b + 4}
              stroke="#a8a29e"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          );
        })}
        <path d={d} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        {padded.map((v, i) => v == null ? null : (
          <g key={`dot-${i}`}>
            <circle cx={x(i)} cy={y(v)} r={selected === i + 1 ? 5 : 3.5} fill={stroke} stroke={selected === i + 1 ? "#1c1917" : "none"} strokeWidth="1" />
            {i === topIdx && (
              <text x={x(i)} y={y(v) - 9} fontSize="9" textAnchor="middle" fill={v < 0 ? "#dc2626" : "#44403c"} className="tabular-nums">{v.toFixed(1)}</text>
            )}
          </g>
        ))}
        {/* Avg delta, parked in the strip directly beneath the shaded
            band/column so it never collides with the data. The band ties
            it to the selection horizontally; the two avg reference lines
            still carry the gap visually. Centered under the band and
            clamped to stay on-chart. */}
        {avgSelected != null && avgOther != null && avgSelected !== avgOther && (() => {
          let center;
          if (Array.isArray(seriesRange)) {
            center = (x(seriesRange[0]) + x(seriesRange[1])) / 2;
          } else if (selected != null) {
            center = x(selected - 1);
          } else {
            return null;
          }
          const up = avgSelected > avgOther;
          const rounded = Math.round((avgSelected - avgOther) * 10) / 10;
          const signStr = rounded > 0 ? "+" : "";
          const labelX = Math.max(30, Math.min(W - 30, center));
          return (
            <text x={labelX} y={H + 9} fontSize="9" textAnchor="middle" pointerEvents="none" className="tabular-nums">
              <tspan fill={stroke} fontWeight="600">{`${up ? "▲" : "▼"} ${signStr}${rounded.toFixed(1)}`}</tspan>
              <tspan fill="#78716c" dx="2" fontStyle="italic">{up ? "better" : "worse"}</tspan>
            </text>
          );
        })()}
        {/* Full-height column hit zones, layered last so they capture taps */}
        {padded.map((v, i) => {
          const hasData = v != null;
          if (!hasData || !onSelect) return null;
          const isSel = selected === i + 1;
          const colW = innerW / (n - 1);
          return (
            <rect
              key={`hit-${i}`}
              x={x(i) - colW / 2}
              y={0}
              width={colW}
              height={H}
              fill="transparent"
              className="cursor-pointer"
              onClick={() => onSelect(isSel ? null : i + 1)}
            />
          );
        })}
      </svg>
      </div>
    </div>
  );
}

// Fixed display order for the breakdown rows. Partition dividers go AFTER
// each key in PARTITIONS_AFTER (shooting / playmaking / rebounding groups).
const VA_CATEGORY_ORDER = [
  "Points", "2-Pointers", "3-Pointers", "Free Throws",
  "Assists", "Turnovers",
  "D Rebounds", "O Rebounds",
  "Blocks", "Steals",
];
const VA_PARTITIONS_AFTER = new Set(["Free Throws", "Turnovers", "O Rebounds"]);

// Helper: aggregate raw stat snapshots into a player object matching what
// VABreakdown expects (mp/pts/.../fgm/.../va), preserving identity.
function aggregateSnapshots(base, snapshots) {
  const out = {
    name: base.name, team: base.team,
    gp: 0, va: 0, eff: 0,
    mp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
    fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, drb: 0, orb: 0,
  };
  for (const s of snapshots) {
    if (!s) continue;
    out.gp += 1;
    out.va += s.va || 0;
    for (const k of ["mp", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "drb", "orb"]) {
      out[k] += s[k] || 0;
    }
  }
  return out;
}

function VABreakdown({ p: pSeries, lga = LGA, teams = TEAMS, rate = false, gameNumber, gameSeries, byGame, gameContext, partitions, onPrev, onNext, useTeamColor = false, breakdownTitle, gameTileLabel = "Game", enableSeriesDrill = false, regularSeasonTotals = null, playerConf = null }) {
  // Tap a game on the chart to swap in that game's stats. When the chart
  // spans multiple series (playoff leaderboard), tapping is a two-step
  // drill: first tap selects the series the game belongs to (series
  // aggregate), second tap on a game in that series drills into the game.
  const [selectedGame, setSelectedGame] = useState(null);
  const [selectedSeriesIdx, setSelectedSeriesIdx] = useState(null);
  // Tap a category row to swap the spark-line out of total VA and into
  // that category's per-game contribution (e.g. "2-Pointers" → 2P VA in
  // each game). Tap again to clear.
  const [selectedCategory, setSelectedCategory] = useState(null);
  // Per-36 vs per-game normalization for the counting-stat labels (PTS,
  // AST, DRB, etc.). Only meaningful in multi-game series/playoff views;
  // hidden in the single-game drill-in where raw counts are shown.
  const [rateMode, setRateMode] = useState("per36");
  const canSelect = rate && Array.isArray(byGame) && byGame.some((b) => b);
  const canDrillToSeries = enableSeriesDrill && Array.isArray(gameContext);
  const canSelectCategory = canSelect;

  let p;
  if (canSelect && selectedGame) {
    p = byGame[selectedGame - 1] || pSeries;
  } else if (canDrillToSeries && selectedSeriesIdx != null && byGame) {
    const subset = byGame.filter((s, i) => s && gameContext[i]?.seriesIdx === selectedSeriesIdx);
    p = aggregateSnapshots(pSeries, subset);
  } else {
    p = pSeries;
  }
  const effectiveGameNumber = selectedGame || gameNumber;

  const mp = p.mp || 0;
  if (mp <= 0) return null;

  // When the user drills into one game we want raw single-game labels
  // ("33 PTS", "3/5 3P"), matching the per-game box-row breakdown — not
  // the per-36 / pct view used for the series aggregate.
  const effectiveRate = rate && !selectedGame;
  // Multi-game views get the VA/Game tile; single-game drill-ins don't
  // (VA/Game would just echo the Total VA banner).
  const multiGame = (p.gp || 1) > 1;

  const twoPm = p.fgm - p.tpm, twoPa = p.fga - p.tpa;
  const tpAdd = ((p.tpm / (p.tpa || 1)) - lga.la3P) * p.tpa;
  const twoAdd = ((twoPm / (twoPa || 1)) - lga.la2P) * twoPa;
  const ftAdd = ((p.ftm / (p.fta || 1)) - lga.laFT) * p.fta;

  // For series: counting stats as per-36 or per-game (user-toggleable),
  // shooting as made/att (pct%). Single-game drill-in keeps raw counts.
  const r36 = (v, tag) => `${(mp > 0 ? (v / mp) * 36 : 0).toFixed(1)} ${tag}/36`;
  const rG  = (v, tag) => `${(p.gp > 0 ? v / p.gp : 0).toFixed(1)} ${tag}/G`;
  const shot = (m, att) => `${m}/${att} (${att > 0 ? ((m / att) * 100).toFixed(1) : "0.0"}%)`;
  const cnt = (v, tag) => {
    if (!effectiveRate) return `${v} ${tag}`;
    return rateMode === "perG" ? rG(v, tag) : r36(v, tag);
  };
  const shoot = (m, att, tag) => (effectiveRate ? shot(m, att) : `${m}/${att} ${tag}`);

  const categories = [
    { key: "Points", value: ((p.pts / mp) - lga.laPTSperM) * mp, label: cnt(p.pts, "PTS") },
    { key: "3-Pointers", value: 3 * tpAdd, label: shoot(p.tpm, p.tpa, "3P") },
    { key: "2-Pointers", value: 2 * twoAdd, label: shoot(twoPm, twoPa, "2P") },
    { key: "Free Throws", value: ftAdd, label: shoot(p.ftm, p.fta, "FT") },
    { key: "Assists", value: ((p.ast / mp) - lga.laASTperM) * mp * lga.laPTSperMake * (1 - lga.laFG), label: cnt(p.ast, "AST") },
    { key: "Steals", value: ((p.stl / mp) - lga.laSTLperM) * mp * lga.laPTSperPoss, label: cnt(p.stl, "STL") },
    { key: "Blocks", value: ((p.blk / mp) - lga.laBLKperM) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.blk, "BLK") },
    { key: "Turnovers", value: -((p.tov / mp) - lga.laTOVperM) * mp * lga.laPTSperPoss, label: cnt(p.tov, "TOV") },
    { key: "D Rebounds", value: ((p.drb / mp) - lga.laDRBperM) * mp * lga.laPTSperPoss * lga.laORBrate, label: cnt(p.drb, "DRB") },
    { key: "O Rebounds", value: ((p.orb / mp) - lga.laORBperM) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.orb, "ORB") },
  ].sort((a, b) => VA_CATEGORY_ORDER.indexOf(a.key) - VA_CATEGORY_ORDER.indexOf(b.key));

  // Per-game series for the spark line. Defaults to whatever the caller
  // passed (raw per-game VA), but flips to a single category's per-game
  // contribution when the user taps a category row.
  const chartValues = (selectedCategory && Array.isArray(byGame))
    ? byGame.map((snap) => {
        if (!snap) return null;
        const v = valueAddByCategory(snap, lga)[selectedCategory];
        return Number.isFinite(v) ? v : null;
      })
    : gameSeries;
  const chartLabel = selectedCategory ? `${selectedCategory} VA by Game` : "VA by Game";

  // Per-category regular-season reference: the player's RS season VA-per-game
  // scaled to the games shown in the current view (1 when a single game is
  // drilled in, p.gp otherwise). Rendered as a vertical tick on each bar so
  // the reader sees "actual vs. what this player would normally produce".
  // Hidden when the player has no RS sample (rookie, two-way, etc.).
  const referenceScale = selectedGame ? 1 : (p.gp || 1);
  const refByKey = (() => {
    if (!regularSeasonTotals || !(regularSeasonTotals.g > 0) || !(regularSeasonTotals.mp > 0)) return null;
    const full = valueAddByCategory(regularSeasonTotals, lga);
    const out = {};
    for (const k of Object.keys(full)) out[k] = (full[k] / regularSeasonTotals.g) * referenceScale;
    return out;
  })();

  const refMagnitudes = refByKey ? Object.values(refByKey).map((v) => Math.abs(v || 0)) : [];
  const maxAbs = Math.max(...categories.map((c) => Math.abs(c.value)), ...refMagnitudes, 0.5);
  const owner = teams[p.team]?.owner;
  // Accent color drives the chart line/dot and the positive bars. Historical
  // and explore contexts use the player's team color; live/draft uses the
  // owner's color so the competition stays the dominant visual.
  const accentColor = useTeamColor
    ? teamColor(p.team)
    : owner === "Spencer" ? "#d97706"
    : owner === "Trey" ? "#0d9488"
    : "#57534e";
  const keyW = effectiveRate ? "w-16" : "w-20";
  const labelW = effectiveRate ? "w-[5.25rem]" : "w-12";

  // Nav: in single-game series view, advance within byGame; otherwise hand
  // off to the parent's prev/next (player navigation). Series-aggregate
  // view hides the nav entirely — chevrons there were too cluttered.
  const inGameNav = canSelect && selectedGame != null;

  // Two-step drill click handler. Without enableSeriesDrill it's the
  // existing toggle. With it: first tap on a game in a different series
  // scopes to that series; another tap on a game in the current series
  // drills into that game; a tap on the currently-selected game clears it.
  const handleChartSelect = (gameIdx) => {
    if (!canSelect) return;
    if (gameIdx == null) {
      setSelectedGame(null);
      return;
    }
    if (!canDrillToSeries) {
      setSelectedGame(selectedGame === gameIdx ? null : gameIdx);
      return;
    }
    const tappedSeriesIdx = gameContext[gameIdx - 1]?.seriesIdx;
    if (selectedSeriesIdx === tappedSeriesIdx) {
      setSelectedGame(selectedGame === gameIdx ? null : gameIdx);
    } else {
      setSelectedSeriesIdx(tappedSeriesIdx);
      setSelectedGame(null);
    }
  };

  // Series band for the chart: highlight all games in the selected series
  // when we're in series-aggregate view (no single game picked).
  let seriesRange = null;
  if (canDrillToSeries && selectedSeriesIdx != null && !selectedGame) {
    const idxs = gameContext
      .map((g, i) => (g?.seriesIdx === selectedSeriesIdx ? i : -1))
      .filter((i) => i >= 0);
    if (idxs.length) seriesRange = [idxs[0], idxs[idxs.length - 1]];
  }
  // Reference averages for the chart. Two modes:
  // - Series selected: avgOther = mean across games NOT in the selected
  //   series (dim dashed line); avgSelected = mean across the selected
  //   series (solid line within the band) + up/down caret vs avgOther.
  // - Single game drilled in: avgOther = mean across the OTHER games
  //   (dim dashed line); avgSelected = the selected game's value
  //   (drives the caret direction).
  // Skipped when there's only one series / one game with data — nothing
  // to compare against.
  let avgOther = null;
  let avgSelected = null;
  if (Array.isArray(chartValues)) {
    const validIdxs = chartValues
      .map((v, i) => (v == null ? -1 : i))
      .filter((i) => i >= 0);
    const mean = (idxs) => idxs.reduce((s, i) => s + chartValues[i], 0) / idxs.length;
    if (canDrillToSeries && selectedSeriesIdx != null && !selectedGame && Array.isArray(gameContext)) {
      const inSel = validIdxs.filter((i) => gameContext[i]?.seriesIdx === selectedSeriesIdx);
      const outSel = validIdxs.filter((i) => gameContext[i]?.seriesIdx !== selectedSeriesIdx);
      if (inSel.length && outSel.length) {
        avgSelected = mean(inSel);
        avgOther = mean(outSel);
      }
    } else if (selectedGame != null) {
      const others = validIdxs.filter((i) => i !== selectedGame - 1);
      const selVal = chartValues[selectedGame - 1];
      if (others.length && selVal != null) {
        avgOther = mean(others);
        avgSelected = selVal;
      }
    }
  }
  const showNav = !rate || inGameNav;
  const findGameWithData = (start, step) => {
    for (let i = start; i >= 0 && i < byGame.length; i += step) {
      if (byGame[i]) return i + 1;
    }
    return null;
  };
  const gameNavPrev = inGameNav ? findGameWithData(selectedGame - 2, -1) : null;
  const gameNavNext = inGameNav ? findGameWithData(selectedGame, 1) : null;
  const canPrev = inGameNav ? gameNavPrev != null : !!onPrev;
  const canNext = inGameNav ? gameNavNext != null : !!onNext;
  const handlePrev = () => inGameNav ? setSelectedGame(gameNavPrev) : onPrev && onPrev();
  const handleNext = () => inGameNav ? setSelectedGame(gameNavNext) : onNext && onNext();

  return (
    <div className="px-2 py-3 border-t border-stone-200">
      <div className="flex items-stretch gap-1">
        {showNav && !inGameNav && (
          <button
            type="button"
            disabled={!canPrev}
            onClick={handlePrev}
            aria-label="Previous player"
            className="w-6 shrink-0 flex items-center justify-center text-stone-500 disabled:text-stone-200 hover:bg-stone-100 disabled:hover:bg-transparent"
          >
            ‹
          </button>
        )}
        <div className="flex-1 min-w-0">
      <div className="mb-3">
        <div className={`mb-2 flex items-center justify-between gap-2 uppercase tracking-widest text-stone-500 ${(selectedGame || (canDrillToSeries && selectedSeriesIdx != null)) ? "text-xs font-semibold text-stone-700" : "text-[9px]"}`}>
          <span>{(() => {
            if (!rate) return "Value Added Breakdown";
            // When a game/series is selected, italicize the matchup so it
            // reads as the active selection: a game italicizes the whole
            // label, a series italicizes just the "vs OPP" tail.
            if (selectedGame) {
              const ctx = gameContext?.[selectedGame - 1];
              const num = ctx?.seriesGameNumber || selectedGame;
              const opp = ctx?.opp;
              return <span className="italic">{`Game ${num}${opp ? ` vs ${opp}` : ""}`}</span>;
            }
            if (canDrillToSeries && selectedSeriesIdx != null) {
              const ctx = gameContext.find((g) => g?.seriesIdx === selectedSeriesIdx);
              const opp = ctx?.opp;
              // Leaderboard-only: replace "Series vs OPP" with round-specific
              // labels — "First Round vs. POR", "Western Semis vs. MIN",
              // "Western Conf Finals vs. OKC", "NBA Finals vs NYK". Falls
              // back to "Series vs OPP" when round info isn't in scope.
              const round = ctx?.round;
              const conf = playerConf === "W" ? "Western" : playerConf === "E" ? "Eastern" : null;
              const oppEm = opp ? <span className="italic">{` vs. ${opp}`}</span> : null;
              if (round === 1) return <>First Round{oppEm}</>;
              if (round === 2 && conf) return <>{conf} Semis{oppEm}</>;
              if (round === 3 && conf) return <>{conf} Conf Finals{oppEm}</>;
              if (round === 4) return <>NBA Finals{oppEm}</>;
              return <>Series{opp ? <span className="italic">{` vs ${opp}`}</span> : null}</>;
            }
            return breakdownTitle || "Series Breakdown";
          })()}</span>
          {(selectedGame || (canDrillToSeries && selectedSeriesIdx != null)) && (
            <button
              onClick={() => {
                if (selectedGame) setSelectedGame(null);
                else setSelectedSeriesIdx(null);
              }}
              className="normal-case tracking-normal text-stone-400 hover:text-stone-700"
            >
              ← back
            </button>
          )}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="sm:order-2 sm:flex-1">
            {/* Total Value Added — label + value inline, no background. */}
            <div className="flex items-baseline justify-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-widest text-stone-500">Total Value Added</span>
              <span className={`tabular-nums text-lg font-bold leading-none ${p.va < 0 ? "text-red-600" : "text-stone-900"}`}>{p.va.toFixed(2)}</span>
            </div>
            <div className={`grid gap-2 items-end ${multiGame ? "grid-cols-3" : "grid-cols-2"}`}>
              <div className="flex flex-col justify-end text-center">
                <div className="text-[9px] uppercase tracking-widest text-stone-500 leading-tight">{effectiveGameNumber ? gameTileLabel : "Games"}</div>
                <div className="tabular-nums text-base font-semibold text-stone-700">{effectiveGameNumber || p.gp || 1}</div>
              </div>
              <div className="flex flex-col justify-end text-center">
                <div className="text-[9px] uppercase tracking-widest text-stone-500 leading-tight">MIN/G</div>
                <div className="tabular-nums text-base font-semibold text-stone-700">{(mp / (p.gp || 1)).toFixed(1)}</div>
              </div>
              {multiGame && (
                <div className="flex flex-col justify-end text-center">
                  <div className="text-[9px] uppercase tracking-widest text-stone-500 leading-tight">VA / Game</div>
                  <div className={`tabular-nums text-base font-semibold ${(p.va / p.gp) < 0 ? "text-red-600" : "text-stone-700"}`}>{(p.va / p.gp).toFixed(2)}</div>
                </div>
              )}
            </div>
          </div>
          {rate && gameSeries && gameSeries.length > 0 && (
            <div className="sm:order-1 sm:flex-1 flex items-stretch gap-1">
              {showNav && inGameNav && (
                <button
                  type="button"
                  disabled={!canPrev}
                  onClick={handlePrev}
                  aria-label="Previous game"
                  className="w-6 shrink-0 flex items-center justify-center text-stone-500 disabled:text-stone-200 hover:bg-stone-100 disabled:hover:bg-transparent"
                >
                  ‹
                </button>
              )}
              <div className="flex-1 min-w-0">
                <GameVAChart
                  values={chartValues}
                  color={accentColor}
                  selected={selectedGame}
                  onSelect={canSelect ? handleChartSelect : undefined}
                  partitions={partitions}
                  seriesRange={seriesRange}
                  label={chartLabel}
                  avgOther={avgOther}
                  avgSelected={avgSelected}
                />
              </div>
              {showNav && inGameNav && (
                <button
                  type="button"
                  disabled={!canNext}
                  onClick={handleNext}
                  aria-label="Next game"
                  className="w-6 shrink-0 flex items-center justify-center text-stone-500 disabled:text-stone-200 hover:bg-stone-100 disabled:hover:bg-transparent"
                >
                  ›
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {/* Per 36 / Per G toggle — sits right above the rate-label column
          on the right, only when the breakdown is in multi-game rate
          mode. Hidden in single-game drill-ins where rate labels show
          raw counts (no toggle would apply). */}
      {effectiveRate && (
        <div className="flex justify-end mb-1">
          <div className="inline-flex items-center border border-stone-300 rounded-sm overflow-hidden text-[9px]">
            <button
              type="button"
              onClick={() => setRateMode("per36")}
              className={`whitespace-nowrap px-1.5 py-0.5 ${rateMode === "per36" ? "bg-stone-700 text-white" : "bg-white text-stone-500 hover:text-stone-700"}`}
              aria-pressed={rateMode === "per36"}
            >
              Per 36
            </button>
            <button
              type="button"
              onClick={() => setRateMode("perG")}
              className={`whitespace-nowrap px-1.5 py-0.5 border-l border-stone-300 ${rateMode === "perG" ? "bg-stone-700 text-white" : "bg-white text-stone-500 hover:text-stone-700"}`}
              aria-pressed={rateMode === "perG"}
            >
              Per G
            </button>
          </div>
        </div>
      )}
      <div className="space-y-0.5">
        {categories.map((c, i) => {
          const pct = (Math.abs(c.value) / maxAbs) * 45;
          const isPos = c.value >= 0;
          const ref = refByKey ? refByKey[c.key] : null;
          const refMagPct = ref != null && Number.isFinite(ref) ? (Math.abs(ref) / maxAbs) * 45 : null;
          const refLeftPct = refMagPct != null ? (ref >= 0 ? 50 + refMagPct : 50 - refMagPct) : null;
          const isCatSel = selectedCategory === c.key;
          const onCatTap = canSelectCategory
            ? () => setSelectedCategory(isCatSel ? null : c.key)
            : undefined;
          // Explicit "+" prefix for positive VA contributions so a row's
          // sign is unambiguous at a glance (negatives already get "-"
          // from toFixed). Skipped at exactly 0 to avoid "+0.00".
          const signed = (v, d) => (v > 0 ? "+" : "") + v.toFixed(d);
          return (
            <React.Fragment key={i}>
              <div
                className={`flex items-center gap-2 text-[10px] -mx-1 px-1 ${onCatTap ? "cursor-pointer" : ""} ${isCatSel ? "bg-stone-200" : ""}`}
                onClick={onCatTap}
                role={onCatTap ? "button" : undefined}
                tabIndex={onCatTap ? 0 : undefined}
                onKeyDown={onCatTap ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCatTap(); } } : undefined}
                aria-pressed={onCatTap ? isCatSel : undefined}
              >
                <span className={`${keyW} text-right truncate ${isCatSel ? "text-stone-900 font-semibold" : "text-stone-600"}`}>{c.key}</span>
                <div className="flex-1 flex items-center relative h-4">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-stone-300"></div>
                  <div
                    className="absolute inset-y-0.5"
                    style={{
                      backgroundColor: isPos ? accentColor : "#a8a29e",
                      left: isPos ? "50%" : `${50 - pct}%`,
                      width: `${pct}%`,
                    }}
                  ></div>
                  {refLeftPct != null && (
                    <div
                      className="absolute inset-y-0 w-0.5"
                      style={{ left: `calc(${refLeftPct}% - 1px)`, backgroundColor: "#1c1917" }}
                      title={`Regular season: ${ref.toFixed(2)}`}
                    />
                  )}
                </div>
                {rate && p.gp > 1 ? (
                  // Portrait phones hide the total + per-game contribution
                  // numbers so the bars (and the rate label) get the room.
                  <>
                    <span className={`portrait:hidden w-10 tabular-nums text-right font-semibold ${c.value < 0 ? "text-red-600" : "text-stone-700"}`}>{signed(c.value, 1)}</span>
                    <span className="portrait:hidden text-stone-300 select-none">|</span>
                    <span className={`portrait:hidden w-12 tabular-nums text-right font-semibold ${c.value < 0 ? "text-red-600" : "text-stone-700"}`}>{signed(c.value / p.gp, 2)}</span>
                  </>
                ) : (
                  <span className={`w-10 tabular-nums text-right font-semibold ${c.value < 0 ? "text-red-600" : "text-stone-700"}`}>{signed(c.value, 2)}</span>
                )}
                <span className={`${labelW} text-[9px] text-stone-500 text-right tabular-nums`}>{c.label}</span>
              </div>
              {VA_PARTITIONS_AFTER.has(c.key) && <div className="my-1 border-t border-stone-200" />}
            </React.Fragment>
          );
        })}
      </div>
      <div className="mt-2 text-center text-[9px] italic text-stone-400">
        Bars show contribution above/below league average
      </div>
        </div>
        {showNav && !inGameNav && (
          <button
            type="button"
            disabled={!canNext}
            onClick={handleNext}
            aria-label="Next player"
            className="w-6 shrink-0 flex items-center justify-center text-stone-500 disabled:text-stone-200 hover:bg-stone-100 disabled:hover:bg-transparent"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}

function getSortedPlayers(box, lga = LGA) {
  if (!box) return [];
  return [
    ...(box.away?.players || []).map((p) => ({ ...p, team: box.away.tri })),
    ...(box.home?.players || []).map((p) => ({ ...p, team: box.home.tri })),
  ]
    .filter((p) => (p.mp || 0) > 0)
    .map((p) => ({ ...p, va: valueAdd(p, lga) }))
    .sort((a, b) => b.va - a.va);
}

function PlayerRow({ p, isExpanded, onToggle, dimTeam, lga = LGA, teams = TEAMS, gameNumber, onPrev, onNext, useTeamColor }) {
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
    <div className="border-b border-stone-100 last:border-0">
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
      {isExpanded && <VABreakdown p={p} lga={lga} teams={teams} gameNumber={gameNumber} onPrev={onPrev} onNext={onNext} useTeamColor={useTeamColor} />}
    </div>
  );
}

function BoxscoreTable({ rows, expandedKey, setExpandedKey, dimTeam, partitionOnCourt, lga = LGA, teams = TEAMS, gameNumber, useTeamColor }) {
  // Build a row plus prev/next callbacks that navigate within the same
  // array (partition-aware: nav stays within On Court / Bench).
  const buildRow = (arr) => (p, i) => {
    const rowKey = `${p.team}-${p.name}-${i}`;
    const prev = arr[i - 1];
    const next = arr[i + 1];
    const prevKey = prev ? `${prev.team}-${prev.name}-${i - 1}` : null;
    const nextKey = next ? `${next.team}-${next.name}-${i + 1}` : null;
    return (
      <PlayerRow
        key={rowKey}
        p={p}
        isExpanded={expandedKey === rowKey}
        onToggle={() => setExpandedKey(expandedKey === rowKey ? null : rowKey)}
        dimTeam={dimTeam}
        lga={lga}
        teams={teams}
        gameNumber={gameNumber}
        useTeamColor={useTeamColor}
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

  if (partitionOnCourt) {
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

function LiveGameBanner({ liveGame, gameLabel, dimTeam, staticBox, lga = LGA, teams = TEAMS, useTeamColor }) {
  const gameNumber = gameLabel ? Number((gameLabel.match(/\d+/) || [])[0]) || null : null;
  const [expanded, setExpanded] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState(null);
  const [box, setBox] = useState(staticBox || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadBox = useCallback(async () => {
    if (!liveGame?.gameId) return;
    setLoading(true);
    setError(null);
    try {
      const dq = liveGame.gameCode ? `&date=${liveGame.gameCode}` : "";
      const res = await fetch(`/api/boxscore?gameId=${liveGame.gameId}${dq}`, { cache: "no-store" });
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
    if (staticBox || !liveGame?.gameId) return; // historical box is supplied inline
    if (isLive) {
      loadBox();
      const id = setInterval(loadBox, 45000);
      return () => clearInterval(id);
    }
    if (isFinal && expanded) {
      loadBox();
    }
  }, [staticBox, liveGame?.gameId, isLive, isFinal, expanded, loadBox]);

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
  const showTop5 = isLive && sortedPlayers.length > 0 && !expanded;

  return (
    <div style={isFinal ? finalStyle : undefined} className={`mt-1 border ${isLive ? "bg-red-50 border-red-300" : isFinal ? finalClasses : "bg-stone-50 border-stone-200"}`}>
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
        {isLive && liveGame.broadcasters && liveGame.broadcasters.length > 0 && (
          <span className="text-[9px] uppercase tracking-wider text-stone-500 truncate text-center flex-1 min-w-0">
            {liveGame.broadcasters.join(", ")}
          </span>
        )}
        <div className="tabular-nums font-semibold text-stone-700 shrink-0">
          {away.tri} {away.score} — {home.score} {home.tri}
        </div>
      </button>

      {showTop5 && (
        <div className="px-2 pb-2 border-t border-red-200">
          <div className="text-[9px] uppercase tracking-widest text-stone-500 py-1">Top 5 by Value Added</div>
          <BoxscoreTable rows={top5} expandedKey={expandedPlayer} setExpandedKey={setExpandedPlayer} dimTeam={dimTeam} lga={lga} teams={teams} gameNumber={gameNumber} useTeamColor={useTeamColor} />
        </div>
      )}

      {expanded && (
        <div className="px-2 pb-2 border-t border-stone-200">
          {loading && !box && <div className="py-2 text-[10px] text-stone-500 italic text-center">Loading stats…</div>}
          {error && <div className="py-2 text-[10px] text-red-600 text-center">{error}</div>}
          {box && sortedPlayers.length > 0 && (
            <div className="mt-2">
              <BoxscoreTable rows={sortedPlayers} expandedKey={expandedPlayer} setExpandedKey={setExpandedPlayer} dimTeam={dimTeam} partitionOnCourt={isLive} lga={lga} teams={teams} gameNumber={gameNumber} useTeamColor={useTeamColor} />
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

function TeamButton({ code, selected, disabled, onClick, gamesWon, actualWins, onGamesChange, seriesDecided, dim, pointValue }) {
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

function SeriesRow({ series, roundKey, matchups, winners, gameWins, actualGameWins, onPick, onGamesChange, liveGame }) {
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

function RoundSection({ roundKey, title, series, matchups, winners, gameWins, actualGameWins, actualWinners, onPick, onGamesChange, liveGamesBySeries }) {
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

function HistoryGameList({ games, teamsMap, lga, dimTeam }) {
  return games.map((g, i) => {
    const liveGame = {
      gameId: g.gameId,
      gameCode: g.gameCode,
      gameStatus: 3,
      gameStatusText: "Final",
      gameDateTimeUTC: g.gameDateTimeUTC,
      home: { tri: g.home.tri, score: g.home.score },
      away: { tri: g.away.tri, score: g.away.score },
    };
    const staticBox = g.box
      ? {
          gameId: g.gameId,
          gameStatus: 3,
          home: { tri: g.home.tri, score: g.home.score, players: g.box.home?.players || [] },
          away: { tri: g.away.tri, score: g.away.score, players: g.box.away?.players || [] },
        }
      : null;
    return (
      <LiveGameBanner
        key={g.gameId || i}
        liveGame={liveGame}
        gameLabel={`Game ${i + 1}`}
        staticBox={staticBox}
        lga={lga}
        teams={teamsMap}
        dimTeam={dimTeam}
        useTeamColor
      />
    );
  });
}

function SeriesAverages({ games, teamsMap, lga, dimTeam, boxSrc, useTeamColor, season }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [rsLookup, setRsLookup] = useState(null);
  // Tap a G value to filter to players with ≥ that many GP and re-sort
  // by VA/G; lets you compare efficiency at comparable volume within a
  // series. Same mechanic as the playoff leaderboard.
  const [minGames, setMinGames] = useState(null);
  const [pendingScrollName, setPendingScrollName] = useState(null);

  useEffect(() => {
    if (!pendingScrollName) return;
    const sel = `[data-player-row="${pendingScrollName.replace(/"/g, '\\"')}"]`;
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingScrollName(null);
  }, [pendingScrollName]);

  // Pull regular-season totals lazily when the section is first opened.
  // Name lookup only — the live ESPN box-score path doesn't expose BR slugs.
  useEffect(() => {
    if (!open || rsLookup || !season) return;
    let cancelled = false;
    fetch(`/api/regular-season?season=${season}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d || !Array.isArray(d.players)) return;
        const byName = {}, byNorm = {};
        for (const p of d.players) {
          if (!p.name) continue;
          if (!byName[p.name]) byName[p.name] = p;
          const n = normalizeName(p.name);
          if (n && !byNorm[n]) byNorm[n] = p;
        }
        setRsLookup({ byName, byNorm });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, season, rsLookup]);

  // Only completed games contribute. History games carry no gameStatus
  // (all final); live games do, so require final (3).
  const finalGames = (games || []).filter((g) => g.gameStatus === undefined || g.gameStatus === 3);

  useEffect(() => {
    // Deps are intentionally just [open]: including `loading` makes
    // setLoading(true) re-run the effect, whose cleanup flips `cancelled`
    // and strands it in the loading state forever.
    if (!open || rows) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const q = boxSrc ? `&src=${boxSrc}` : "";
    Promise.all(
      finalGames.map((g) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        return fetch(`/api/boxscore?gameId=${g.gameId}${q}`, { signal: ctrl.signal })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
          .finally(() => clearTimeout(timer));
      })
    )
      .then((boxes) => {
        if (cancelled) return;
        const ok = boxes.filter((b) => b && !b.error);
        if (ok.length === 0) {
          setError("Box scores unavailable");
          setRows([]);
          return;
        }
        const agg = {};
        const N = finalGames.length;
        boxes.forEach((box, idx) => {
          if (!box || box.error) return;
          const players = [
            ...(box.away?.players || []).map((p) => ({ ...p, team: box.away.tri })),
            ...(box.home?.players || []).map((p) => ({ ...p, team: box.home.tri })),
          ];
          for (const p of players) {
            if (!(p.mp > 0)) continue;
            const key = `${p.team}:${p.name}`;
            const a =
              agg[key] ||
              (agg[key] = {
                name: p.name, team: p.team, gp: 0, va: 0, eff: 0,
                mp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
                fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, drb: 0, orb: 0,
                games: new Array(N).fill(null),
                byGame: new Array(N).fill(null),
              });
            const { va, efficiency } = valueAddParts(p, lga);
            a.gp += 1;
            a.va += va;
            a.eff += efficiency;
            a.games[idx] = va;
            // Single-game snapshot for the tap-to-drill-in flow.
            a.byGame[idx] = {
              team: p.team, name: p.name, gp: 1, va, eff: efficiency,
              mp: p.mp || 0, pts: p.pts || 0, reb: p.reb || 0, ast: p.ast || 0,
              stl: p.stl || 0, blk: p.blk || 0, tov: p.tov || 0,
              fgm: p.fgm || 0, fga: p.fga || 0, tpm: p.tpm || 0, tpa: p.tpa || 0,
              ftm: p.ftm || 0, fta: p.fta || 0, drb: p.drb || 0, orb: p.orb || 0,
            };
            for (const k of ["mp", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "drb", "orb"]) {
              a[k] += p[k] || 0;
            }
          }
        });
        const list = Object.values(agg)
          .map((a) => ({
            ...a,
            ppg: a.pts / a.gp,
            effpg: a.eff / a.gp,
            rpg: a.reb / a.gp,
            apg: a.ast / a.gp,
            spg: a.stl / a.gp,
            bpg: a.blk / a.gp,
            stk: (a.stl + a.blk) / a.gp,
          }))
          .sort((x, y) => y.va - x.va);
        setRows(list);
      })
      .catch((e) => !cancelled && setError(e.message || "Load failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (finalGames.length === 0) return null;

  return (
    <div className="mt-1 border border-stone-300 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-2 py-1.5 text-[10px] uppercase tracking-widest text-stone-600 font-semibold flex items-center gap-1"
      >
        <span className="text-stone-400">{open ? "▾" : "▸"}</span>
        Series Averages
      </button>
      {open && (
        <div className="px-2 pb-2">
          {loading && <div className="py-2 text-[10px] text-stone-500 italic text-center">Loading…</div>}
          {error && <div className="py-2 text-[10px] text-red-600 text-center">{error}</div>}
          {rows && rows.length > 0 && (() => {
            const sortedRows = minGames != null
              ? [...rows].sort((a, b) => (b.va / Math.max(1, b.gp)) - (a.va / Math.max(1, a.gp)))
              : rows;
            const visibleRows = minGames != null ? sortedRows.filter((p) => p.gp >= minGames) : sortedRows;
            // Width of the per-row VA bar — proportional to abs(VA) over
            // the visible list's max so the leader fills the row and
            // everyone else scales down. Floor at 0.5 to avoid divide-by-
            // zero on series where every player has 0 VA.
            const maxAbsVa = Math.max(...visibleRows.map((p) => Math.abs(p.va || 0)), 0.5);
            return (
            <div>
              {minGames != null && (
                <div className="flex items-center justify-end py-1">
                  <button
                    onClick={() => setMinGames(null)}
                    className="normal-case tracking-normal text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1 bg-stone-100 text-stone-700 border-stone-300"
                    aria-label="Clear min-games filter"
                  >
                    ≥{minGames} games <span className="text-stone-400">×</span>
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 border-b border-stone-200">
                <span className="w-10">Team</span>
                <span className="flex-1">Player</span>
                <span className="hidden sm:block w-6 text-right">G</span>
                <span className="w-8 text-right">PPG</span>
                <span className="hidden sm:block w-9 text-right">EFF</span>
                <span className="w-8 text-right">RPG</span>
                <span className="w-8 text-right">APG</span>
                <span className="hidden sm:block w-8 text-right">SPG</span>
                <span className="hidden sm:block w-8 text-right">BPG</span>
                <span className="sm:hidden w-9 text-right">STK</span>
                <span className="hidden sm:block w-12 text-right">TOT VA</span>
              </div>
              {visibleRows.map((p, i) => {
                const owner = teamsMap[p.team]?.owner;
                const isDim = p.team === dimTeam;
                const badgeUseTeam = !isDim && !owner;
                const badge = isDim
                  ? "bg-white text-stone-500 border border-stone-200"
                  : owner ? ownerBadge(owner) : "border";
                const tc = badgeUseTeam ? teamColor(p.team) : null;
                const badgeStyle = badgeUseTeam
                  ? { backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) }
                  : undefined;
                const rowKey = `${p.team}:${p.name}`;
                const isOpen = expanded === rowKey;
                const barColor = (p.va || 0) >= 0
                  ? withAlpha(tc || teamColor(p.team), 0.16)
                  : withAlpha("#dc2626", 0.10);
                const barPct = (Math.abs(p.va || 0) / maxAbsVa) * 100;
                return (
                  <div key={rowKey} data-player-row={p.name} className="border-b border-stone-100 last:border-0">
                    {/* Bar wraps just the click row, not the expanded
                        breakdown — otherwise the team-color tint bleeds
                        through behind the whole VABreakdown panel. */}
                    <div className="relative overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 pointer-events-none"
                        style={{ width: `${barPct}%`, backgroundColor: barColor }}
                        aria-hidden
                      />
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpanded(isOpen ? null : rowKey)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setExpanded(isOpen ? null : rowKey);
                          }
                        }}
                        className={`relative w-full flex items-center gap-2 text-[10px] py-1 text-left cursor-pointer ${isOpen ? "bg-stone-100/60" : ""}`}
                      >
                      <span style={badgeStyle} className={`w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center ${badge}`}>{p.team}</span>
                      <span className="flex-1 truncate text-stone-800">
                        <span className="text-stone-400 mr-1">{isOpen ? "▾" : "▸"}</span>
                        {p.name}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = minGames === p.gp ? null : p.gp;
                          setMinGames(next);
                          if (next != null) setPendingScrollName(p.name);
                        }}
                        className={`hidden sm:block w-6 text-right tabular-nums cursor-pointer hover:text-stone-900 hover:underline ${minGames === p.gp ? "font-semibold text-stone-900" : "text-stone-500"}`}
                        aria-label={`Filter to players with at least ${p.gp} games`}
                      >{p.gp}</button>
                      <span className="w-8 text-right tabular-nums font-bold text-stone-900">{p.ppg.toFixed(1)}</span>
                      <span className={`hidden sm:block w-9 text-right tabular-nums font-semibold ${p.effpg < 0 ? "text-red-600" : "text-stone-700"}`}>{p.effpg.toFixed(1)}</span>
                      <span className="w-8 text-right tabular-nums text-stone-600">{p.rpg.toFixed(1)}</span>
                      <span className="w-8 text-right tabular-nums text-stone-600">{p.apg.toFixed(1)}</span>
                      <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{p.spg.toFixed(1)}</span>
                      <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{p.bpg.toFixed(1)}</span>
                      <span className="sm:hidden w-9 text-right tabular-nums text-stone-600">{p.stk.toFixed(1)}</span>
                      <span className={`hidden sm:block w-12 text-right tabular-nums font-semibold ${p.va < 0 ? "text-red-600" : "text-stone-900"}`}>{p.va.toFixed(1)}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <VABreakdown
                        p={p}
                        lga={lga}
                        teams={teamsMap}
                        rate
                        gameSeries={p.games}
                        byGame={p.byGame}
                        useTeamColor={useTeamColor}
                        regularSeasonTotals={rsLookup ? (rsLookup.byName[p.name] || rsLookup.byNorm[normalizeName(p.name)] || null) : null}
                        onPrev={i > 0 ? () => setExpanded(`${visibleRows[i - 1].team}:${visibleRows[i - 1].name}`) : undefined}
                        onNext={i < visibleRows.length - 1 ? () => setExpanded(`${visibleRows[i + 1].team}:${visibleRows[i + 1].name}`) : undefined}
                      />
                    )}
                  </div>
                );
              })}
              <div className="text-[9px] text-stone-400 mt-1.5 text-center italic">Sorted by {minGames != null ? "VA / Game" : "total Value Added"} · STK = steals + blocks · tap a row for VA breakdown</div>
            </div>
            );
          })()}
          {rows && rows.length === 0 && !error && (
            <div className="py-2 text-[10px] text-stone-500 italic text-center">No stats</div>
          )}
        </div>
      )}
    </div>
  );
}

function HistorySeriesRow({ s, teamsMap, lga, roundKey, season }) {
  const ta = teamsMap[s.teams[0]];
  const tb = teamsMap[s.teams[1]];
  const sameOwner = ta && tb && ta.owner === tb.owner;
  const ptsA = ta && tb ? potentialPoints(ta, tb, roundKey).total : null;
  const ptsB = ta && tb ? potentialPoints(tb, ta, roundKey).total : null;
  const dimA = sameOwner && ptsA < ptsB;
  const dimB = sameOwner && ptsB < ptsA;
  const dimTeam = dimA ? s.teams[0] : dimB ? s.teams[1] : null;

  const teamCell = (code) => {
    const t = teamsMap[code];
    if (!t) return <div className="flex-1 px-2 py-1.5 border border-stone-200 bg-white text-xs text-stone-400">{code}</div>;
    const isWinner = s.winner === code;
    const dim = code === dimTeam;
    // Dimmed (top seed in a same-owner series) gets a white card even when it won.
    const cellBg = isWinner ? (dim ? "bg-white border-stone-300 border-2" : `${ownerBg(t.owner)} border-2`) : "bg-white border-stone-200";
    return (
      <div className={`flex-1 px-2 py-1.5 border ${cellBg}`}>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-stone-500 tabular-nums w-4">{t.seed}</span>
          <span className={`text-xs font-semibold ${isWinner ? ownerColor(t.owner, dim) : "text-stone-900"}`}>{t.name}</span>
          {isWinner && <span className="ml-auto text-[10px]">✓</span>}
        </div>
        <div className="text-[9px] uppercase tracking-wider mt-0.5 flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${ownerDot(t.owner, dim)}`}></span>
          <span className="text-stone-500">{t.owner}</span>
        </div>
      </div>
    );
  };
  return (
    <div className="mb-3 p-2 bg-stone-50 border border-stone-200 rounded">
      <div className="flex gap-1.5 items-stretch">
        {teamCell(s.teams[0])}
        <div className="flex items-center justify-center px-1 text-[10px] font-bold text-stone-400 tracking-widest">VS</div>
        {teamCell(s.teams[1])}
      </div>
      {s.games.length > 0 ? (
        <>
          <SeriesAverages games={s.games} teamsMap={teamsMap} lga={lga} dimTeam={dimTeam} boxSrc="espn" useTeamColor season={season} />
          <HistoryGameList games={s.games} teamsMap={teamsMap} lga={lga} dimTeam={dimTeam} />
        </>
      ) : (
        <div className="mt-1 text-[10px] text-stone-400 italic text-center py-1">Game data not available</div>
      )}
    </div>
  );
}

function HistoryRoundSection({ round, teamsMap, lga, season }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-baseline justify-between mb-2 pb-1.5 border-b-2 border-stone-900 text-left"
      >
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 flex items-center gap-2">
          <span className="text-stone-400 text-[10px]">{open ? "▾" : "▸"}</span>
          {round.label}
        </h3>
      </button>
      {open && round.series.map((s, i) => (
        <HistorySeriesRow key={i} s={s} teamsMap={teamsMap} lga={lga} roundKey={round.key} season={season} />
      ))}
    </div>
  );
}

function HistoryView({ season }) {
  const data = scoreHistory(season);
  const [showBreakdown, setShowBreakdown] = useState(null);
  const [histGames, setHistGames] = useState(null);
  const [gamesError, setGamesError] = useState(null);
  const [gamesLoading, setGamesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHistGames(null);
    setGamesError(null);
    setGamesLoading(true);
    fetch(`/api/history?season=${season}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
        return d;
      })
      .then((d) => {
        if (!cancelled) setHistGames(d);
      })
      .catch((e) => !cancelled && setGamesError(e.message || "Load failed"))
      .finally(() => !cancelled && setGamesLoading(false));
    return () => { cancelled = true; };
  }, [season]);

  if (!data) return <div className="text-stone-500 text-xs italic">No data for {season}</div>;
  const { breakdown, totals, meta } = data;
  const rounds = historyRounds(season, histGames);
  const lga = lgaForSeason(season);
  const hasGames = rounds?.some((r) => r.series.some((s) => s.games.length > 0));

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

      <div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-2">Game Results</div>
        {gamesLoading && (
          <div className="text-[10px] text-stone-500 italic py-2 text-center">Loading games…</div>
        )}
        {gamesError && !gamesLoading && (
          <div className="text-[10px] text-red-600 py-2 text-center px-2 break-words">Couldn’t load games — {gamesError}</div>
        )}
        {!gamesLoading && !gamesError && !hasGames && (
          <div className="text-[10px] text-stone-400 italic py-2 text-center">No game data</div>
        )}
        {hasGames && rounds.map((r) => (
          <HistoryRoundSection key={r.key} round={r} teamsMap={meta.teams} lga={lga} season={season} />
        ))}
      </div>
    </div>
  );
}

const ROUND_LABELS = { r1: "First Round", r2: "Conf Semis", r3: "Conf Finals", r4: "Finals" };

function ExploreSeriesRow({ s, lga, season }) {
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

function ExploreRoundSection({ roundKey, series, lga, season }) {
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
function exploreSeasonList() {
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

function PlayoffLeaderboard({ season, lga }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [teamFilter, setTeamFilter] = useState(null);
  const [expanded, setExpanded] = useState(null);
  // Tap a column header (TOT VA, VA/G) to override the composite default
  // sort. Toggles back to composite if the same column is tapped twice.
  // When the min-games filter is active it forces VA/G ordering regardless
  // — keeps the filter coherent.
  const [sortMode, setSortMode] = useState("composite");
  // When set, leaderboard re-sorts by VA/G and trims to players with at
  // least `minGames` GP — the "show me efficiency at comparable volume"
  // filter, tap a G value to set it.
  const [minGames, setMinGames] = useState(null);
  // Name of the player whose G cell was just tapped, so we can scroll
  // their row into view after the list re-sorts/filters.
  const [pendingScrollName, setPendingScrollName] = useState(null);
  // Regular-season totals load independently so a slow BR fetch doesn't
  // block the leaderboard; the reference tick just appears once it arrives.
  const [rsLookup, setRsLookup] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setShowAll(false);
    setTeamFilter(null);
    setSortMode("composite");
    setMinGames(null);
    setPendingScrollName(null);
    setExpanded(null);
    setRsLookup(null);
    setLoading(true);
    fetch(`/api/leaderboard?season=${season}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
        return d;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => !cancelled && setError(e.message || "Load failed"))
      .finally(() => !cancelled && setLoading(false));
    fetch(`/api/regular-season?season=${season}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d || !Array.isArray(d.players)) return;
        const bySlug = {}, byName = {}, byNorm = {};
        for (const p of d.players) {
          if (p.slug) bySlug[p.slug] = p;
          // Multiple players can share a name; the leaderboard prefers slug,
          // but a name lookup is the fallback for the ESPN/live path where
          // we don't have a BR slug. Keeping the *first* row is fine — the
          // bake/route already prefers the TOT row when one exists.
          if (!p.name) continue;
          if (!byName[p.name]) byName[p.name] = p;
          const n = normalizeName(p.name);
          if (n && !byNorm[n]) byNorm[n] = p;
        }
        setRsLookup({ bySlug, byName, byNorm });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [season]);

  useEffect(() => {
    if (!pendingScrollName) return;
    const sel = `[data-player-row="${pendingScrollName.replace(/"/g, '\\"')}"]`;
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingScrollName(null);
  }, [pendingScrollName]);

  if (loading) {
    return (
      <div className="mb-4 p-3 bg-white border border-stone-300">
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-2">Playoff Leaderboard</div>
        <div className="text-[10px] text-stone-500 italic py-2 text-center">Aggregating box scores… (first load may take ~10s)</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mb-4 p-3 bg-white border border-stone-300">
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-2">Playoff Leaderboard</div>
        <div className="text-[10px] text-red-600 py-2 text-center px-2 break-words">Couldn’t load — {error}</div>
      </div>
    );
  }
  if (!data || !data.players?.length) return null;

  const all = data.players;
  // Composite default sort: each axis (Total VA, VA/G) is scored as a
  // fraction of that axis's leader, then summed. So a player at half
  // the leader's volume scores 0.5 on Total VA — not just "rank #2" —
  // and the gap between adjacent finishers tracks the actual magnitude
  // difference rather than a flat one-rank penalty. Negative values
  // stay negative (a -10 VA against a max of 100 scores -0.10 on that
  // axis), which pulls the composite down to match below-replacement
  // production. Higher composite = better.
  //
  // Two axes, not three: an earlier version added a third "VA/G vs
  // peers with >= my GP" axis, but with magnitude scoring it just
  // doubled the rate signal — high-GP players almost always max their
  // own narrow cohort (free 1.0) and low-GP players' cohort is everyone
  // (so it equals the overall VA/G score exactly). Volume + rate is
  // the clean orthogonal split.
  const vaPerG = (p) => p.va / Math.max(1, p.gp);
  const safeRatio = (v, max) => (max > 0 ? v / max : 0);
  const maxVA = Math.max(...all.map((p) => p.va));
  const maxVAperG = Math.max(...all.map((p) => vaPerG(p)));
  const composite = (p) =>
    safeRatio(p.va, maxVA) + safeRatio(vaPerG(p), maxVAperG);

  // Min-games filter forces VA/G order. Otherwise honour the column
  // header the user clicked (composite by default). Total VA is the
  // explicit tiebreaker for the composite + VA/G sorts so the order
  // doesn't quietly drift if the server-side input order ever shifts.
  const effectiveSort = minGames != null ? "vaPerG" : sortMode;
  const sortedAll =
    effectiveSort === "totalVA" ? [...all].sort((a, b) => b.va - a.va) :
    effectiveSort === "vaPerG"  ? [...all].sort((a, b) => vaPerG(b) - vaPerG(a) || b.va - a.va) :
                                  [...all].sort((a, b) => composite(b) - composite(a) || b.va - a.va);
  const teamFiltered = teamFilter ? sortedAll.filter((p) => p.team === teamFilter) : sortedAll;
  const filtered = minGames != null ? teamFiltered.filter((p) => p.gp >= minGames) : teamFiltered;
  const shown = (showAll || teamFilter || minGames != null) ? filtered : filtered.slice(0, 10);

  // seriesIdx → round lookup, so each game row can carry its round into
  // the VABreakdown drill-in title ("Western Semis vs. MIN" etc.).
  const roundBySeries = Object.fromEntries(
    (data.series || []).map((s) => [s.idx, s.round])
  );

  return (
    <div className="mb-4 border border-stone-300 bg-white">
      <div className="px-3 pt-2.5 pb-1.5 text-[10px] uppercase tracking-[0.3em] text-stone-500 border-b border-stone-200 flex items-center justify-between gap-2">
        <span>Playoff Leaderboard</span>
        <div className="flex items-center gap-1.5">
          {minGames != null && (
            <button
              onClick={() => setMinGames(null)}
              className="normal-case tracking-normal text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1 bg-stone-100 text-stone-700 border-stone-300"
              aria-label="Clear min-games filter"
            >
              ≥{minGames} games <span className="text-stone-400">×</span>
            </button>
          )}
          {teamFilter && (() => {
            const c = teamColor(teamFilter);
            return (
              <button
                onClick={() => setTeamFilter(null)}
                className="normal-case tracking-normal text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1"
                style={{ backgroundColor: withAlpha(c, 0.14), color: c, borderColor: withAlpha(c, 0.4) }}
                aria-label={`Clear ${teamFilter} filter`}
              >
                {teamFilter} <span className="text-stone-400">×</span>
              </button>
            );
          })()}
        </div>
      </div>
      <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 px-2 border-b border-stone-200">
        <span className="w-6 text-right">#</span>
        <span className="w-10">Team</span>
        <span className="flex-1">Player</span>
        <span className="w-6 text-right">G</span>
        <span className="hidden sm:block w-8 text-right">PPG</span>
        <span className="hidden sm:block w-9 text-right">EFF</span>
        <span className="hidden sm:block w-8 text-right">RPG</span>
        <span className="hidden sm:block w-8 text-right">APG</span>
        <span className="hidden sm:block w-8 text-right">SPG</span>
        <span className="hidden sm:block w-8 text-right">BPG</span>
        <button
          type="button"
          onClick={() => {
            setMinGames(null);
            setSortMode(sortMode === "totalVA" ? "composite" : "totalVA");
          }}
          className={`w-12 text-right uppercase tracking-wider cursor-pointer hover:text-stone-900 ${effectiveSort === "totalVA" ? "text-stone-900 font-semibold" : ""}`}
          aria-label="Sort by total VA"
          aria-pressed={effectiveSort === "totalVA"}
        >
          TOT VA{effectiveSort === "totalVA" ? " ▼" : ""}
        </button>
        <button
          type="button"
          onClick={() => {
            setMinGames(null);
            setSortMode(sortMode === "vaPerG" ? "composite" : "vaPerG");
          }}
          className={`w-10 text-right uppercase tracking-wider cursor-pointer hover:text-stone-900 ${effectiveSort === "vaPerG" ? "text-stone-900 font-semibold" : ""}`}
          aria-label="Sort by VA per game"
          aria-pressed={effectiveSort === "vaPerG"}
        >
          VA/G{effectiveSort === "vaPerG" ? " ▼" : ""}
        </button>
      </div>
      {(() => {
        // VA bar scale — proportional to abs(VA) over the visible list.
        // Computed once per render so all rows share the same denominator.
        const maxAbsVa = Math.max(...shown.map((p) => Math.abs(p.va || 0)), 0.5);
        return shown.map((p, i) => {
        // Keep the overall rank (1, 7, 13…) even when filters trim the
        // visible list. With the min-games filter on, "overall" means
        // ranked by VA/G, since that's how the list is now ordered.
        const rank = sortedAll.indexOf(p) + 1;
        const rowKey = `${p.team}:${p.name}`;
        const isOpen = expanded === rowKey;
        const tc = teamColor(p.team);
        const badgeStyle = { backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) };
        const barColor = p.va >= 0
          ? withAlpha(tc, 0.16)
          : withAlpha("#dc2626", 0.10);
        const barPct = (Math.abs(p.va || 0) / maxAbsVa) * 100;
        // Player's playoff games already chronological from server, with
        // null-va slots for games they sat out inside a series they played
        // (kept so the chart shows a gap and the title uses the true series
        // game number, not the player's appearance count).
        const values = p.games.map((g) => g.va);
        const byGame = p.games.map((g) => g.va == null ? null : ({
          team: p.team, name: p.name, gp: 1, va: g.va,
          mp: g.mp, pts: g.pts, reb: g.reb, drb: g.drb, orb: g.orb,
          ast: g.ast, stl: g.stl, blk: g.blk, tov: g.tov,
          fgm: g.fgm, fga: g.fga, tpm: g.tpm, tpa: g.tpa, ftm: g.ftm, fta: g.fta,
        }));
        const gameContext = p.games.map((g) => ({ opp: g.opp, seriesIdx: g.seriesIdx, seriesGameNumber: g.seriesGameNumber, round: roundBySeries[g.seriesIdx] }));
        const partitions = [];
        for (let j = 1; j < p.games.length; j++) {
          if (p.games[j].seriesIdx !== p.games[j - 1].seriesIdx) partitions.push(j);
        }
        const vaPerG = p.gp > 0 ? p.va / p.gp : 0;
        return (
          <div key={rowKey} data-player-row={p.name} className="border-b border-stone-100 last:border-0">
            {/* Bar wraps just the click row, not the expanded breakdown —
                otherwise the team-color tint bleeds through behind the
                whole VABreakdown panel. */}
            <div className="relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 pointer-events-none"
                style={{ width: `${barPct}%`, backgroundColor: barColor }}
                aria-hidden
              />
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(isOpen ? null : rowKey)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded(isOpen ? null : rowKey);
                }
              }}
              className={`relative w-full flex items-center gap-2 text-[10px] py-1.5 px-2 text-left cursor-pointer ${isOpen ? "bg-stone-100/60" : ""}`}
            >
              <span className="w-6 text-right tabular-nums text-stone-500">{rank}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTeamFilter(teamFilter === p.team ? null : p.team);
                }}
                style={badgeStyle}
                className="w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center border hover:brightness-95"
                aria-label={`Filter by ${p.team}`}
              >{p.team}</button>
              <span className="flex-1 truncate text-stone-800">
                <span className="text-stone-400 mr-1">{isOpen ? "▾" : "▸"}</span>
                {p.name}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = minGames === p.gp ? null : p.gp;
                  setMinGames(next);
                  if (next != null) setPendingScrollName(p.name);
                }}
                className={`w-6 text-right tabular-nums cursor-pointer hover:text-stone-900 hover:underline ${minGames === p.gp ? "font-semibold text-stone-900" : "text-stone-500"}`}
                aria-label={`Filter to players with at least ${p.gp} games`}
              >{p.gp}</button>
              <span className="hidden sm:block w-8 text-right tabular-nums font-bold text-stone-900">{(p.pts / p.gp).toFixed(1)}</span>
              <span className={`hidden sm:block w-9 text-right tabular-nums font-semibold ${p.eff / p.gp < 0 ? "text-red-600" : "text-stone-700"}`}>{(p.eff / p.gp).toFixed(1)}</span>
              <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(p.reb / p.gp).toFixed(1)}</span>
              <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(p.ast / p.gp).toFixed(1)}</span>
              <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(p.stl / p.gp).toFixed(1)}</span>
              <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(p.blk / p.gp).toFixed(1)}</span>
              <span className={`w-12 text-right tabular-nums font-bold ${p.va < 0 ? "text-red-600" : "text-stone-900"}`}>{p.va.toFixed(1)}</span>
              <span className={`w-10 text-right tabular-nums ${vaPerG < 0 ? "text-red-600" : "text-stone-700"}`}>{vaPerG.toFixed(2)}</span>
              </div>
            </div>
            {isOpen && (
              <VABreakdown
                p={p}
                lga={lga}
                teams={{}}
                rate
                gameSeries={values}
                byGame={byGame}
                gameContext={gameContext}
                partitions={partitions}
                useTeamColor
                breakdownTitle="Playoff Breakdown"
                gameTileLabel="Playoff Game"
                enableSeriesDrill
                playerConf={TEAM_CONF[p.team] || TEAMS[p.team]?.conf || null}
                regularSeasonTotals={rsLookup ? (rsLookup.bySlug[p.slug] || rsLookup.byName[p.name] || rsLookup.byNorm[normalizeName(p.name)] || null) : null}
                onPrev={i > 0 ? () => setExpanded(`${shown[i - 1].team}:${shown[i - 1].name}`) : undefined}
                onNext={i < shown.length - 1 ? () => setExpanded(`${shown[i + 1].team}:${shown[i + 1].name}`) : undefined}
              />
            )}
          </div>
        );
      });
      })()}
      {!teamFilter && minGames == null && all.length > 10 && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="w-full text-center py-2 text-[10px] uppercase tracking-widest text-stone-500 hover:text-stone-900 border-t border-stone-200"
        >
          {showAll ? "Show top 10" : `Show all (${all.length})`}
        </button>
      )}
    </div>
  );
}

function ExploreView() {
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
    if (mode !== "season") return;
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
  }, [season, mode]);

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

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button onClick={() => setMode("season")} className={tabCls(mode === "season")}>By Season</button>
        <button onClick={() => setMode("player")} className={tabCls(mode === "player")}>By Player</button>
      </div>

      {mode === "player" ? (
        <PlayerExplorer />
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

          {loading && <div className="text-[10px] text-stone-500 italic py-4 text-center">Loading {season} playoffs…</div>}
          {error && !loading && <div className="text-[10px] text-red-600 py-4 text-center px-2 break-words">Couldn’t load games — {error}</div>}
          {!loading && !error && data && (
            <>
              <PlayoffLeaderboard season={season} lga={lga} />
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
    </div>
  );
}

// "By Player" mode: search the cross-season index from /api/players and show a
// single player's playoff seasons ranked by Value Added.
function PlayerExplorer() {
  const [index, setIndex] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState(null);
  const [openSeason, setOpenSeason] = useState(null);
  const selectPlayer = (k) => { setSelectedKey(k); setOpenSeason(null); };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/players")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (!cancelled) { setIndex(d.players || []); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message || "Load failed"); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const keyOf = (p) => p.slug || p.name;

  const matches = useMemo(() => {
    if (!index) return [];
    const q = normalizeName(query.trim());
    if (q.length < 2) return [];
    return index
      .filter((p) => normalizeName(p.name).includes(q))
      .sort((a, b) => b.bestVa - a.bestVa)
      .slice(0, 30);
  }, [index, query]);

  const player = useMemo(
    () => (index && selectedKey ? index.find((p) => keyOf(p) === selectedKey) || null : null),
    [index, selectedKey]
  );

  if (loading) return <div className="text-[10px] text-stone-500 italic py-6 text-center">Loading player index…</div>;
  if (error) return <div className="text-[10px] text-red-600 py-6 text-center px-2 break-words">Couldn’t load players — {error}</div>;

  if (player) {
    return (
      <div>
        <button
          onClick={() => selectPlayer(null)}
          className="text-[10px] uppercase tracking-widest text-stone-500 hover:text-stone-900 mb-3"
        >
          ‹ Back to search
        </button>
        <div className="mb-3">
          <h3 className="text-base font-bold text-stone-900">{player.name}</h3>
          <div className="text-[10px] uppercase tracking-widest text-stone-500 mt-0.5">
            {player.seasons.length} playoff run{player.seasons.length === 1 ? "" : "s"} · {player.teams.join(" / ")} · career VA{" "}
            <span className="tabular-nums text-stone-700 font-semibold">{player.careerVa.toFixed(1)}</span>
          </div>
        </div>
        <div className="grid grid-cols-[1.5rem_1fr_2.5rem_2rem_3rem_3rem] gap-x-2 items-center text-[10px] uppercase tracking-wider text-stone-400 px-2 pb-1 border-b border-stone-200">
          <span></span><span>Season</span><span>Team</span><span className="text-right">GP</span><span className="text-right">VA</span><span className="text-right">VA/G</span>
        </div>
        {player.seasons.map((s, i) => {
          const sOpen = openSeason === s.season;
          return (
            <div key={s.season} className="border-b border-stone-100">
              <div
                onClick={() => setOpenSeason(sOpen ? null : s.season)}
                className="grid grid-cols-[1.5rem_1fr_2.5rem_2rem_3rem_3rem] gap-x-2 items-center px-2 py-1.5 text-sm cursor-pointer hover:bg-stone-50"
              >
                <span className="text-[10px] tabular-nums text-stone-400">{i + 1}</span>
                <span className="font-semibold text-stone-800 tabular-nums">{s.season}</span>
                <span className="text-[11px] text-stone-500">{s.team}</span>
                <span className="text-right tabular-nums text-stone-600">{s.gp}</span>
                <span className={`text-right tabular-nums font-bold ${s.va < 0 ? "text-red-600" : "text-stone-900"}`}>{s.va.toFixed(1)}</span>
                <span className="text-right tabular-nums text-stone-500">{s.vaPerG.toFixed(1)}</span>
              </div>
              {sOpen && <VACategoryBreakdown player={s} lga={lgaForSeason(s.season)} />}
            </div>
          );
        })}
        <div className="text-[10px] text-stone-400 italic mt-2 px-2">Tap a season for the per-stat breakdown.</div>
      </div>
    );
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a player…"
        autoFocus
        className="w-full text-sm text-stone-900 bg-white border border-stone-300 px-3 py-2 mb-3"
      />
      {query.trim().length < 2 ? (
        <div className="text-[10px] text-stone-400 italic py-6 text-center">Type a name to see their playoff seasons ranked by Value Added.</div>
      ) : matches.length === 0 ? (
        <div className="text-[10px] text-stone-400 italic py-6 text-center">No players match “{query.trim()}”.</div>
      ) : (
        matches.map((p) => (
          <button
            key={keyOf(p)}
            onClick={() => selectPlayer(keyOf(p))}
            className="w-full flex items-baseline justify-between gap-2 px-2 py-2 border-b border-stone-100 text-left hover:bg-stone-50"
          >
            <span className="text-sm font-semibold text-stone-800">{p.name}</span>
            <span className="text-[10px] uppercase tracking-wider text-stone-400 shrink-0">
              {p.seasons.length} run{p.seasons.length === 1 ? "" : "s"} · {p.teams.join("/")} · best{" "}
              <span className="tabular-nums text-stone-600">{p.bestVa.toFixed(1)}</span>
            </span>
          </button>
        ))
      )}
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

function timeAgo(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

// Informational page: data freshness, how the pipeline loads data, and the
// Value Added formula (mirrored from app/scoring.js).
function InfoView() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/data-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setStatus(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const refreshed = status?.lastRefresh ? new Date(status.lastRefresh) : null;

  // Constants are 2025-26 league baselines (per-minute / per-attempt rates).
  const SCORING = [
    { label: "Scoring volume", f: "( PTS/min − 0.409 ) × min" },
    { label: "3-pt shooting", f: "3 × ( 3PM/3PA − 0.360 ) × 3PA" },
    { label: "2-pt shooting", f: "2 × ( 2PM/2PA − 0.548 ) × 2PA" },
    { label: "Free throws", f: "( FTM/FTA − 0.789 ) × FTA" },
  ];
  const PLAYDEF = [
    { label: "Assists", f: "( AST/min − 0.083 ) × min × 2.316 × (1 − 0.470)" },
    { label: "Steals", f: "( STL/min − 0.032 ) × min × 1.014" },
    { label: "Blocks", f: "( BLK/min − 0.014 ) × min × 1.014 × 0.738" },
    { label: "Turnovers", f: "−( TOV/min − 0.052 ) × min × 1.014" },
  ];
  const REB = [
    { label: "Def. rebounds", f: "1.25 × ( DRB/min − 0.122 ) × min × 1.014 × 0.262" },
    { label: "Off. rebounds", f: "1.25 × ( ORB/min − 0.038 ) × min × 1.014 × 0.738" },
  ];

  const Group = ({ title, items }) => (
    <div className="mb-3">
      <div className="text-[9px] uppercase tracking-widest text-stone-400 mb-1">{title}</div>
      {items.map((it) => (
        <div key={it.label} className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 py-1 border-b border-stone-100">
          <span className="text-xs font-semibold text-stone-700">{it.label}</span>
          <span className="text-[11px] tabular-nums text-stone-500" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{it.f}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <section className="p-3 bg-white border border-stone-300">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 mb-2">Data status</h2>
        {status ? (
          <div className="space-y-1 text-sm text-stone-700">
            <div>
              Last refreshed: <span className="font-semibold text-stone-900">{refreshed ? refreshed.toLocaleString() : "—"}</span>
              {refreshed && <span className="text-stone-400"> ({timeAgo(status.lastRefresh)})</span>}
            </div>
            <div className="text-xs text-stone-500">
              {status.seasonsBaked} season{status.seasonsBaked === 1 ? "" : "s"} stored
              {status.earliestSeason && ` (${status.earliestSeason} – ${status.latestSeason})`}
              {status.latestRefreshedSeason && `, most recent bake: ${status.latestRefreshedSeason}.`}
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-stone-400 italic">Checking…</div>
        )}
      </section>

      <section className="p-3 bg-white border border-stone-300 text-sm text-stone-700 leading-relaxed">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 mb-2">How the data loads</h2>
        <p className="mb-2"><span className="font-semibold">Historical playoffs</span> are scraped from <span className="font-semibold">basketball-reference.com</span> by an R pipeline and stored permanently as JSON in the repo. A scheduled job runs <span className="font-semibold">every morning</span>, refreshing the current season and filling in older seasons.</p>
        <p className="mb-2"><span className="font-semibold">Live games</span> — while a series is in progress — come straight from the NBA feed. When that feed is unavailable, the app falls back to the stored results.</p>
        <p>Box scores, leaderboards, and the Value Added numbers below are all computed from this same stored data, so what you see is reproducible and consistent across seasons.</p>
      </section>

      <section className="p-3 bg-white border border-stone-300">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 mb-1">Value Added (VA)</h2>
        <p className="text-sm text-stone-600 mb-3">Points a player creates above — or below — a league-average player, given the same workload. Every skill follows one shape:</p>
        <div className="p-2 mb-3 bg-stone-50 border border-stone-200 rounded text-center text-xs text-stone-700" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          ( player rate − <span className="text-amber-700 font-semibold">league rate</span> ) × opportunity × point value
        </div>
        <Group title="Scoring" items={SCORING} />
        <Group title="Playmaking &amp; Defense" items={PLAYDEF} />
        <Group title="Rebounding" items={REB} />
        <p className="text-[10px] text-stone-400 mt-2 leading-relaxed">VA is the sum of all ten. The decimals are 2025-26 league averages (rates per minute or per attempt); 1.014 = league points per possession, 2.316 = points per made shot, 0.738 / 0.262 = league DRB% / ORB%. Baselines are season-accurate, so older eras are measured against their own league — not today&apos;s.</p>
      </section>
    </div>
  );
}

// Top college players for the season, ranked by Value Added. Data comes from
// /api/college (baked by scripts/R/fetch_college.R via the bake-college run).
// Per-category VA breakdown for one college player, mirroring the NBA
// VABreakdown: diverging +/- bars (per-GAME contribution above/below the D-I
// average), grouped with separators, plus a Per 36 / Per G stat-label toggle.
function VACategoryBreakdown({ player: p, lga }) {
  const [rateMode, setRateMode] = useState("per36");
  if (p.ast == null || !lga || !(p.mp > 0)) {
    return <div className="px-2 py-2 text-[10px] text-stone-400 italic">Per-stat breakdown needs the latest data — re-run the college bake.</div>;
  }
  const mp = p.mp, gp = p.gp || 1;
  const twoPm = p.fgm - p.tpm, twoPa = p.fga - p.tpa;
  const tpAdd = ((p.tpm / (p.tpa || 1)) - lga.la3P) * p.tpa;
  const twoAdd = ((twoPm / (twoPa || 1)) - lga.la2P) * twoPa;
  const ftAdd = ((p.ftm / (p.fta || 1)) - lga.laFT) * p.fta;
  const r36 = (v, tag) => `${((v / mp) * 36).toFixed(1)} ${tag}/36`;
  const rG = (v, tag) => `${(v / gp).toFixed(1)} ${tag}/G`;
  const shot = (m, att) => `${m}/${att} (${att > 0 ? ((m / att) * 100).toFixed(1) : "0.0"}%)`;
  const cnt = (v, tag) => (rateMode === "perG" ? rG(v, tag) : r36(v, tag));

  const cats = [
    { key: "Points", value: ((p.pts / mp) - lga.laPTSperM) * mp, label: cnt(p.pts, "PTS") },
    { key: "3-Pointers", value: 3 * tpAdd, label: shot(p.tpm, p.tpa) },
    { key: "2-Pointers", value: 2 * twoAdd, label: shot(twoPm, twoPa) },
    { key: "Free Throws", value: ftAdd, label: shot(p.ftm, p.fta) },
    { key: "Assists", value: ((p.ast / mp) - lga.laASTperM) * mp * lga.laPTSperMake * (1 - lga.laFG), label: cnt(p.ast, "AST") },
    { key: "Steals", value: ((p.stl / mp) - lga.laSTLperM) * mp * lga.laPTSperPoss, label: cnt(p.stl, "STL") },
    { key: "Blocks", value: ((p.blk / mp) - lga.laBLKperM) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.blk, "BLK") },
    { key: "Turnovers", value: -((p.tov / mp) - lga.laTOVperM) * mp * lga.laPTSperPoss, label: cnt(p.tov, "TOV") },
    { key: "D Rebounds", value: ((p.drb / mp) - lga.laDRBperM) * mp * lga.laPTSperPoss * lga.laORBrate, label: cnt(p.drb, "DRB") },
    { key: "O Rebounds", value: ((p.orb / mp) - lga.laORBperM) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.orb, "ORB") },
  ].sort((a, b) => VA_CATEGORY_ORDER.indexOf(a.key) - VA_CATEGORY_ORDER.indexOf(b.key));
  const maxAbs = Math.max(...cats.map((c) => Math.abs(c.value)), 0.1);
  const signed = (v, d) => (v > 0 ? "+" : "") + v.toFixed(d);

  return (
    <div className="px-2 py-2 bg-stone-50 border-t border-stone-100">
      <div className="flex justify-end mb-1.5">
        <div className="inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
          <button onClick={() => setRateMode("per36")} className={`px-1.5 py-0.5 ${rateMode === "per36" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Per 36</button>
          <button onClick={() => setRateMode("perG")} className={`px-1.5 py-0.5 border-l border-stone-300 ${rateMode === "perG" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Per G</button>
        </div>
      </div>
      {cats.map((c) => {
        const pct = (Math.abs(c.value) / maxAbs) * 45;
        const isPos = c.value >= 0;
        const perG = c.value / gp;
        return (
          <React.Fragment key={c.key}>
            <div className="flex items-center gap-2 text-[10px] py-[1px]">
              <span className="w-[4.5rem] shrink-0 text-right text-stone-600">{c.key}</span>
              <div className="flex-1 relative h-4">
                <div className="absolute inset-y-0 left-1/2 w-px bg-stone-300" />
                <div className="absolute inset-y-0.5" style={{ backgroundColor: isPos ? "#1c1917" : "#a8a29e", left: isPos ? "50%" : `${50 - pct}%`, width: `${pct}%` }} />
              </div>
              <span className={`w-9 shrink-0 tabular-nums text-right font-semibold ${perG < 0 ? "text-red-600" : "text-stone-700"}`}>{signed(perG, 2)}</span>
              <span className="w-[5.5rem] shrink-0 text-[9px] text-stone-500 text-right tabular-nums">{c.label}</span>
            </div>
            {VA_PARTITIONS_AFTER.has(c.key) && <div className="my-1 border-t border-stone-200" />}
          </React.Fragment>
        );
      })}
      <div className="mt-2 text-center text-[9px] italic text-stone-400">Bars show per-game contribution above / below D-I average</div>
    </div>
  );
}

function CollegeView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortMode, setSortMode] = useState("va"); // "va" | "vaPerG"
  const [query, setQuery] = useState("");             // player-name search
  const [teamFilter, setTeamFilter] = useState(null); // exact-school filter (set by tapping a team)
  const [expanded, setExpanded] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/college")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message || "Load failed"); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const q = query.trim();
  const shown = useMemo(() => {
    if (!data?.players) return [];
    const metric = (p) => (sortMode === "vaPerG" ? p.vaPerG : p.va) ?? 0;
    let list = data.players;
    if (teamFilter) {
      list = list.filter((p) => p.school === teamFilter);
    } else if (q) {
      const qn = normalizeName(q);
      list = list.filter((p) => normalizeName(p.name).includes(qn));
    }
    list = [...list].sort((a, b) => metric(b) - metric(a));
    return (teamFilter || q) ? list : list.slice(0, 100); // full roster/results when filtering; else top 100
  }, [data, q, teamFilter, sortMode]);

  if (loading) return <div className="text-[10px] text-stone-500 italic py-6 text-center">Loading college players…</div>;
  if (error) return <div className="text-[10px] text-red-600 py-6 text-center px-2 break-words">Couldn’t load — {error}</div>;
  if (!data || data.missing || !(data.players && data.players.length)) {
    return (
      <div className="p-3 bg-white border border-stone-300 text-sm text-stone-600 leading-relaxed">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 mb-2">Top College Players</h2>
        College data hasn’t been baked yet. Run the <span className="font-semibold">“Bake college players”</span> workflow from the Actions tab to populate the 2025-26 men’s D-I leaders by Value Added.
      </div>
    );
  }

  const metricVal = (p) => (sortMode === "vaPerG" ? p.vaPerG : p.va) ?? 0;
  const maxMetric = Math.max(...shown.map(metricVal), 0.1);

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-base font-bold text-stone-900">Top College Players</h2>
        <div className="text-[10px] uppercase tracking-widest text-stone-500 mt-0.5">
          {data.season} men’s D-I{data.playerPool ? ` · ${data.playerPool.toLocaleString()} players` : ""}
        </div>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setTeamFilter(null); setExpanded(null); }}
        placeholder="Search a player…"
        className="w-full text-sm text-stone-900 bg-white border border-stone-300 px-3 py-2 mb-2"
      />
      {teamFilter && (
        <div className="flex items-center gap-2 mb-2 px-2">
          <span className="text-[10px] uppercase tracking-widest text-stone-400">Team</span>
          <span className="text-sm font-semibold text-stone-800">{teamFilter}</span>
          <span className="text-[10px] text-stone-400 tabular-nums">· {shown.length}</span>
          <button onClick={() => setTeamFilter(null)} className="ml-auto text-[10px] uppercase tracking-widest text-stone-400 hover:text-stone-700">✕ Clear</button>
        </div>
      )}
      {q && !teamFilter && (
        <div className="text-[10px] text-stone-400 tabular-nums mb-1 px-2">{shown.length} {shown.length === 1 ? "player" : "players"}</div>
      )}

      {/* Tap VA or VA/G to sort by that column; the caret marks the active sort. */}
      <div className="grid grid-cols-[1.5rem_1fr_2.5rem_3rem_3rem] gap-x-2 items-center text-[10px] uppercase tracking-wider text-stone-400 px-2 pb-1 border-b border-stone-200">
        <span></span><span>Player</span><span className="text-right">G</span>
        <button onClick={() => setSortMode("va")} className={`text-right uppercase tracking-wider ${sortMode === "va" ? "text-stone-900 font-bold" : "text-stone-400 hover:text-stone-600"}`}>VA{sortMode === "va" ? " ▾" : ""}</button>
        <button onClick={() => setSortMode("vaPerG")} className={`text-right uppercase tracking-wider ${sortMode === "vaPerG" ? "text-stone-900 font-bold" : "text-stone-400 hover:text-stone-600"}`}>VA/G{sortMode === "vaPerG" ? " ▾" : ""}</button>
      </div>

      {shown.length === 0 && (
        <div className="text-[10px] text-stone-400 italic py-6 text-center">No players match “{q}”.</div>
      )}

      {shown.map((p, i) => {
        const key = p.slug || p.name;
        const open = expanded === key;
        const pct = (metricVal(p) / maxMetric) * 100;
        return (
          <div key={key} className="border-b border-stone-100">
            <div
              onClick={() => setExpanded(open ? null : key)}
              className="grid grid-cols-[1.5rem_1fr_2.5rem_3rem_3rem] gap-x-2 items-center px-2 pt-1.5 text-sm cursor-pointer hover:bg-stone-50"
            >
              <span className="text-[10px] tabular-nums text-stone-400">{i + 1}</span>
              <span className="min-w-0">
                <span className="font-semibold text-stone-800 block truncate">{p.name}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setTeamFilter(p.school); setQuery(""); setExpanded(null); }}
                  className="text-[10px] text-stone-500 hover:text-stone-900 hover:underline"
                >{p.school}</button>
              </span>
              <span className="text-right tabular-nums text-stone-600">{p.gp ?? 0}</span>
              <span className={`text-right tabular-nums font-bold ${sortMode === "va" ? "text-stone-900" : "text-stone-500"} ${p.va < 0 ? "text-red-600" : ""}`}>{(p.va ?? 0).toFixed(1)}</span>
              <span className={`text-right tabular-nums ${sortMode === "vaPerG" ? "text-stone-900 font-bold" : "text-stone-500"}`}>{(p.vaPerG ?? 0).toFixed(1)}</span>
            </div>
            <div className="px-2 pt-1 pb-1.5">
              <div className="h-1 bg-stone-100 rounded-sm overflow-hidden">
                <div className="h-full rounded-sm" style={{ width: `${Math.max(0, pct)}%`, background: metricVal(p) < 0 ? "#dc2626" : "#1c1917" }} />
              </div>
            </div>
            {open && <VACategoryBreakdown player={p} lga={data.leagueAverages} />}
          </div>
        );
      })}

      <div className="text-[10px] text-stone-400 italic mt-2">Source: College Sports Reference. Tap a player for the per-stat breakdown; tap a team name to see its roster.</div>
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

        <div className="flex border-b-2 border-stone-900 mb-5 overflow-x-auto">
          <button
            onClick={() => setTab("current")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "current" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            2025-26
          </button>
          {seasons.map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === s ? "bg-stone-900 text-white" : "text-stone-500"}`}
            >
              {s}
            </button>
          ))}
          <button
            onClick={() => setTab("explore")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "explore" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            Explore
          </button>
          <button
            onClick={() => setTab("college")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "college" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            College
          </button>
          <button
            onClick={() => setTab("info")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "info" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            Info
          </button>
        </div>

        {tab === "current" ? <CurrentView /> : tab === "explore" ? <ExploreView /> : tab === "college" ? <CollegeView /> : tab === "info" ? <InfoView /> : <HistoryView season={tab} />}
      </div>
    </div>
  );
}
