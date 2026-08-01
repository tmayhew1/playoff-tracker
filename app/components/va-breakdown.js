"use client";

import React, { useState, useMemo, useEffect } from "react";
import { TEAMS } from "../teams";
import { LGA, ZONES, valueAddByCategory, lgaForSeason, zoneShotValue, hasZoneData } from "../scoring";
import { GameVAChart } from "./charts";
import { CompareButton, ComparePanel, ComparePicker } from "./compare";
import { defVAInfo, useDefRatings } from "../lib/defense";
import { fetchJsonCached } from "../lib/fetch-cache";
import { GOLD_BG, normalizeName, seasonTag, shortName, teamColor, withAlpha } from "../lib/format";
import { aggregateSnapshots } from "../lib/players";
import { CAT_SHOOTING, CAT_SHORT, GROUP_STAT, VA_CATEGORY_ORDER, VA_GROUPS, VA_PARTITIONS_AFTER, catRateLabel, catVATotal, catVAperGame, samePlayer } from "../lib/va";


export function VABreakdown({ p: pSeries, lga = LGA, teams = TEAMS, rate = false, gameNumber, gameSeries, byGame, gameContext, partitions, onPrev, onNext, useTeamColor = false, breakdownTitle, gameTileLabel = "Game", enableSeriesDrill = false, regularSeasonTotals = null, playerConf = null, context = null, season = null, defScope = "rs", showDRating = true }) {
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
  // "basic" folds the ten categories into the four Scoring/Passing/
  // Rebounds/Defense buckets with summed VA; "detail" is the full list.
  const [viewMode, setViewMode] = useState("basic");
  const switchView = (m) => { setViewMode(m); setSelectedCategory(null); };
  // Head-to-head comparison against another player-season from the same scope.
  const [compare, setCompare] = useState(null);
  const [picking, setPicking] = useState(false);
  const [compareMode, setCompareMode] = useState("values"); // "values" | "pct"
  // The compared player's own playoff game log (per-game VA), overlaid onto
  // the VA-by-Game chart above (aligned at game 1) while comparing.
  const [compareRun, setCompareRun] = useState(null);
  useEffect(() => {
    if (!compare) { setCompareRun(null); return; }
    let cancelled = false;
    setCompareRun(null);
    fetchJsonCached(`/api/leaderboard?season=${compare.row.season}`)
      .then((dd) => {
        if (cancelled) return;
        const nn = normalizeName(compare.name || "");
        const pl = (dd.players || []).find((x) => (compare.slug && x.slug === compare.slug) || normalizeName(x.name) === nn);
        const run = (pl?.games || []).filter((g) => g.va != null).map((g) => g.va);
        setCompareRun(run.length ? run : null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [compare]);
  // Per-36 vs per-game normalization for the counting-stat labels (PTS,
  // AST, DRB, etc.). Only meaningful in multi-game series/playoff views;
  // hidden in the single-game drill-in where raw counts are shown.
  const [rateMode, setRateMode] = useState("perG");
  // Baked defensive ratings (the D-Rating category / VA+). Must load before
  // the early returns below — hooks are unconditional.
  const defs = useDefRatings();
  const canSelect = rate && Array.isArray(byGame) && byGame.some((b) => b);
  const canDrillToSeries = enableSeriesDrill && Array.isArray(gameContext);
  // Category rows are tappable when tapping can do something: swap the chart
  // (multi-game views) and/or open the league-context panel.
  const canSelectCategory = canSelect || !!context;
  // The context panel compares season totals against the season pool, so it
  // only renders at the aggregate level — not on a drilled game or series.
  const atSeasonLevel = !selectedGame && selectedSeriesIdx == null;

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

  // D Rating — the fifth defensive stat, folded in under Defense. Season
  // DRtg (and season stock rate, for the team-share weight) come from the
  // season aggregate; the current view's minutes scale it, so a drilled
  // game shows that game's share. No drill-in: DRtg is one season-level
  // number, not a stat with per-game splits. VA+ = VA + dVA.
  const seasonKey = season || pSeries.season || null;
  // showDRating=false (the leaderboard's VA view) drops the whole D-Rating
  // layer — row, Defense fold-in, VA+ banner — so the card sums to plain VA.
  const dInfo = showDRating ? defVAInfo(pSeries, mp, lga, defs, seasonKey, defScope) : null;
  const drtg = dInfo?.drtg ?? null;
  const dVA = dInfo?.dva ?? null;
  const vaPlus = dVA != null ? (p.va || 0) + dVA : null;

  const categories = [
    { key: "Points", value: ((p.pts / mp) - lga.laPTSperM) * mp, label: cnt(p.pts, "PTS") },
    { key: "3-Pointers", value: 3 * tpAdd, label: shoot(p.tpm, p.tpa, "3P") },
    { key: "2-Pointers", value: 2 * twoAdd, label: shoot(twoPm, twoPa, "2P") },
    { key: "Free Throws", value: ftAdd, label: shoot(p.ftm, p.fta, "FT") },
    { key: "Assists", value: ((p.ast / mp) - lga.laASTperM) * mp * lga.laPTSperMake * (1 - lga.laFG), label: cnt(p.ast, "AST") },
    { key: "Steals", value: ((p.stl / mp) - lga.laSTLperM) * mp * lga.laPTSperPoss, label: cnt(p.stl, "STL") },
    { key: "Blocks", value: ((p.blk / mp) - lga.laBLKperM) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.blk, "BLK") },
    { key: "Turnovers", value: -((p.tov / mp) - lga.laTOVperM) * mp * lga.laPTSperPoss, label: cnt(p.tov, "TOV") },
    { key: "D Rebounds", value: ((p.drb / mp) - lga.laDRBperM) * 1.25 * mp * lga.laPTSperPoss * lga.laORBrate, label: cnt(p.drb, "DRB") },
    { key: "O Rebounds", value: ((p.orb / mp) - lga.laORBperM) * 1.25 * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.orb, "ORB") },
  ].sort((a, b) => VA_CATEGORY_ORDER.indexOf(a.key) - VA_CATEGORY_ORDER.indexOf(b.key));
  // D Rating rides at the very end, after Steals — the last Defense member.
  if (dVA != null) categories.push({ key: "D Rating", value: dVA, label: `${Math.round(drtg)} DRTG`, noDrill: true });

  // "Basic" rows: each group's member categories summed, labeled with the
  // group's representative counting stat. D Rating rides with Defense, so
  // the four groups sum to VA+ (not VA) whenever it's present.
  const groupRows = VA_GROUPS.map((g) => {
    const [statOf, tag] = GROUP_STAT[g.key];
    let value = g.cats.reduce((s, k) => s + (categories.find((c) => c.key === k)?.value || 0), 0);
    if (g.key === "Defense" && dVA != null) value += dVA;
    return { key: g.key, value, label: cnt(statOf(p), tag) };
  });
  const activeRows = viewMode === "basic" ? groupRows : categories;

  // Per-game series for the spark line. Defaults to whatever the caller
  // passed (raw per-game VA), but flips to a single category's (or group's)
  // per-game contribution when the user taps a row.
  const chartValues = (selectedCategory && Array.isArray(byGame))
    ? byGame.map((snap) => {
        if (!snap) return null;
        const v = catVATotal(snap, lga, selectedCategory);
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
    for (const g of VA_GROUPS) out[g.key] = g.cats.reduce((s, c) => s + (out[c] || 0), 0);
    // D Rating reference: the player's rs defensive value over rs minutes,
    // per game — same "what he normally produces" tick the groups get.
    const dRef = defVAInfo(regularSeasonTotals, regularSeasonTotals.mp, lga, defs, seasonKey, "rs")?.dva ?? null;
    if (dRef != null) out["D Rating"] = (dRef / regularSeasonTotals.g) * referenceScale;
    return out;
  })();

  const refMagnitudes = refByKey ? activeRows.map((c) => Math.abs(refByKey[c.key] || 0)) : [];
  const maxAbs = Math.max(...activeRows.map((c) => Math.abs(c.value)), ...refMagnitudes, 0.5);
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
            {/* Total Value Added — label + value inline, no background. While
                comparing, the compared player's figure rides along in gold. */}
            <div className={`flex items-baseline justify-center gap-2 ${vaPlus != null ? "mb-0.5" : "mb-2"}`}>
              <span className="text-[10px] uppercase tracking-widest text-stone-500">Total Value Added</span>
              <span className={`tabular-nums text-lg font-bold leading-none ${p.va < 0 ? "text-red-600" : "text-stone-900"}`}>{p.va.toFixed(2)}</span>
              {compare && atSeasonLevel && (
                <span className="tabular-nums text-sm font-semibold leading-none rounded-sm px-1 py-[1px]" style={{ color: teamColor(compare.row.team), backgroundColor: GOLD_BG }}>{(compare.row.va ?? 0).toFixed(1)}</span>
              )}
            </div>
            {vaPlus != null && (
              <div
                className="flex items-baseline justify-center gap-2 mb-2"
                title={dInfo?.w != null
                  ? `VA+ = VA + defensive net over possessions played: ${Math.round(drtg)} DRTG vs team ${dInfo.teamDrtg.toFixed(1)} + ${(dInfo.w * 100).toFixed(0)}% of team's edge vs league ${dInfo.laDRtg.toFixed(1)} (plus edges earned by stock rate; minus edges shrink with activity: 40% − earned)`
                  : `VA+ = VA + defensive net rating (${Math.round(drtg)} DRTG vs ${(lga.laPTSperPoss * 100).toFixed(1)} league) over the possessions played`}
              >
                <span className="text-[9px] uppercase tracking-widest text-stone-400">VA+</span>
                <span className={`tabular-nums text-sm font-bold leading-none ${vaPlus < 0 ? "text-red-600" : "text-stone-900"}`}>{vaPlus.toFixed(2)}</span>
                <span className={`text-[9px] tabular-nums ${dVA < 0 ? "text-red-500" : "text-stone-400"}`}>D {(dVA > 0 ? "+" : "") + dVA.toFixed(1)}</span>
              </div>
            )}
            <div className={`grid gap-2 items-end ${multiGame ? "grid-cols-3" : "grid-cols-2"}`}>
              <div className="flex flex-col justify-end text-center">
                <div className="text-[9px] uppercase tracking-widest text-stone-500 leading-tight">{effectiveGameNumber ? gameTileLabel : "Games"}</div>
                <div className="tabular-nums text-base font-semibold text-stone-700">{effectiveGameNumber || p.gp || 1}</div>
                {compare && atSeasonLevel && (
                  <div className="tabular-nums text-[10px] font-semibold rounded-sm mx-auto px-1" style={{ color: teamColor(compare.row.team), backgroundColor: GOLD_BG }}>{compare.row.gp || 0}</div>
                )}
              </div>
              <div className="flex flex-col justify-end text-center">
                <div className="text-[9px] uppercase tracking-widest text-stone-500 leading-tight">MIN/G</div>
                <div className="tabular-nums text-base font-semibold text-stone-700">{(mp / (p.gp || 1)).toFixed(1)}</div>
                {compare && atSeasonLevel && (
                  <div className="tabular-nums text-[10px] font-semibold rounded-sm mx-auto px-1" style={{ color: teamColor(compare.row.team), backgroundColor: GOLD_BG }}>{((compare.row.mp || 0) / (compare.row.gp || 1)).toFixed(1)}</div>
                )}
              </div>
              {multiGame && (
                <div className="flex flex-col justify-end text-center">
                  <div className="text-[9px] uppercase tracking-widest text-stone-500 leading-tight">VA / Game</div>
                  <div className={`tabular-nums text-base font-semibold ${(p.va / p.gp) < 0 ? "text-red-600" : "text-stone-700"}`}>{(p.va / p.gp).toFixed(2)}</div>
                  {compare && atSeasonLevel && (
                    <div className="tabular-nums text-[10px] font-semibold rounded-sm mx-auto px-1" style={{ color: teamColor(compare.row.team), backgroundColor: GOLD_BG }}>{(compare.row.vaPerG ?? ((compare.row.va || 0) / (compare.row.gp || 1))).toFixed(2)}</div>
                  )}
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
                  label={compare && atSeasonLevel && compareRun ? `VA by Game · vs ${shortName(compare.name)} ${seasonTag(compare.row.season)}` : chartLabel}
                  avgOther={avgOther}
                  avgSelected={avgSelected}
                  overlayValues={compare && atSeasonLevel ? compareRun : null}
                  overlayColor={compare ? teamColor(compare.row.team) : undefined}
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
      {/* Toggle row. Normal view: Basic/By Category left, Compare center,
          Per 36 / Per G right (rate toggle only in multi-game rate mode).
          Comparing: the gold vs-chip takes the left slot and the
          Values/Percentiles mode toggle takes the right; view/rate toggles
          hide since the compare view is Basic-first with its own drill-down. */}
      {compare && context && atSeasonLevel ? (
        <div className="flex justify-between items-center mb-1">
          <CompareButton
            compare={compare}
            picking={picking}
            onOpen={() => setPicking((v) => !v)}
            onClear={() => { setCompare(null); setPicking(false); }}
          />
          <div className="inline-flex items-center border border-stone-300 rounded-sm overflow-hidden text-[9px]">
            <button
              type="button"
              onClick={() => setCompareMode("values")}
              className={`whitespace-nowrap px-1.5 py-0.5 ${compareMode === "values" ? "bg-stone-700 text-white" : "bg-white text-stone-500 hover:text-stone-700"}`}
              aria-pressed={compareMode === "values"}
            >
              Values
            </button>
            <button
              type="button"
              onClick={() => setCompareMode("pct")}
              className={`whitespace-nowrap px-1.5 py-0.5 border-l border-stone-300 ${compareMode === "pct" ? "bg-stone-700 text-white" : "bg-white text-stone-500 hover:text-stone-700"}`}
              aria-pressed={compareMode === "pct"}
            >
              Percentiles
            </button>
          </div>
        </div>
      ) : (
      <div className="flex justify-between items-center mb-1">
        <div className="inline-flex items-center border border-stone-300 rounded-sm overflow-hidden text-[9px]">
          <button
            type="button"
            onClick={() => switchView("basic")}
            className={`whitespace-nowrap px-1.5 py-0.5 ${viewMode === "basic" ? "bg-stone-700 text-white" : "bg-white text-stone-500 hover:text-stone-700"}`}
            aria-pressed={viewMode === "basic"}
          >
            Basic
          </button>
          <button
            type="button"
            onClick={() => switchView("detail")}
            className={`whitespace-nowrap px-1.5 py-0.5 border-l border-stone-300 ${viewMode === "detail" ? "bg-stone-700 text-white" : "bg-white text-stone-500 hover:text-stone-700"}`}
            aria-pressed={viewMode === "detail"}
          >
            By Category
          </button>
        </div>
        {context && atSeasonLevel && (
          <CompareButton
            compare={compare}
            picking={picking}
            onOpen={() => setPicking((v) => !v)}
            onClear={() => { setCompare(null); setPicking(false); }}
          />
        )}
        {effectiveRate && (
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
        )}
      </div>
      )}
      {picking && context && atSeasonLevel && (
        <ComparePicker
          context={context}
          self={{ ...pSeries, season: pSeries.season || context.season, name: pSeries.name || context.self?.name, slug: pSeries.slug || context.self?.slug || null }}
          onPick={(sel) => { setCompare(sel); setPicking(false); }}
          onCancel={() => setPicking(false)}
        />
      )}
      {compare && context && atSeasonLevel ? (
        <ComparePanel
          key={`${compare.row.season}:${compare.slug || compare.name}`}
          a={{ ...pSeries, season: pSeries.season || context.season, name: pSeries.name || context.self?.name, slug: pSeries.slug || context.self?.slug || null }}
          b={compare.row}
          bSeasons={compare.seasons}
          context={context}
          rateMode={rateMode}
          mode={compareMode}
          setMode={setCompareMode}
        />
      ) : (
      <>
      <div className="space-y-0.5">
        {activeRows.map((c, i) => {
          const pct = (Math.abs(c.value) / maxAbs) * 45;
          const isPos = c.value >= 0;
          const ref = refByKey ? refByKey[c.key] : null;
          const refMagPct = ref != null && Number.isFinite(ref) ? (Math.abs(ref) / maxAbs) * 45 : null;
          const refLeftPct = refMagPct != null ? (ref >= 0 ? 50 + refMagPct : 50 - refMagPct) : null;
          const isCatSel = selectedCategory === c.key;
          const onCatTap = canSelectCategory && !c.noDrill
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
                    {/* Per-game VA contribution stays visible in portrait too. */}
                    <span className={`w-12 tabular-nums text-right font-semibold ${c.value < 0 ? "text-red-600" : "text-stone-700"}`}>{signed(c.value / p.gp, 2)}</span>
                  </>
                ) : (
                  <span className={`w-10 tabular-nums text-right font-semibold ${c.value < 0 ? "text-red-600" : "text-stone-700"}`}>{signed(c.value, 2)}</span>
                )}
                <span className={`${labelW} text-[9px] text-stone-500 text-right tabular-nums`}>{c.label}</span>
              </div>
              {context && atSeasonLevel && isCatSel && (
                <CategoryContext p={pSeries} catKey={c.key} lga={lga} rateMode={rateMode} context={context} defs={defs} defActive={dVA != null} defScope={defScope} />
              )}
              {viewMode === "detail" && VA_PARTITIONS_AFTER.has(c.key) && <div className="my-1 border-t border-stone-200" />}
            </React.Fragment>
          );
        })}
      </div>
      <div className="mt-2 text-center text-[9px] italic text-stone-400">
        Bars show contribution above/below the league baseline (median rates){context && atSeasonLevel ? " · tap a category for league context" : ""}
      </div>
      </>
      )}
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


// Shot-distance range per zone key ("z03" -> "0-3 ft"), so the shot-distance
// bars can print the actual range under their nickname ("Rim", "Float", …)
// without restating the boundaries ZONES already owns.
const ZONE_DIST = Object.fromEntries(ZONES.map((z) => [z.key, z.label]));


// League context for one category of one player-season (By-Player search only).
// Everything is computed from the /api/players index passed in via `context`:
//   poolsBySeason  Map<season, row[]>  every player-season, grouped by season
//   allRows        row[]               every player-season, flat (all-time pool)
//   self           the player object   (name, slug, seasons[]) for identity/trend
// The ranking metric is per-game category VA so longevity doesn't dominate a
// per-game breakdown; the >=1/3-GP floor guards against tiny-sample outliers.
export function CategoryContext({ p: pProp, catKey, lga, rateMode, context, defs = null, defActive = false, defScope = "rs" }) {
  const { poolsBySeason, allRows, self: ownerSelf } = context;
  // The card owner — the player whose breakdown row opened this drill-in.
  const ownerSeasonKey = pProp.season || context.season;

  // Tapping another player's row in the season-rank leaderboard (View 1) below
  // re-points the WHOLE card at them — every view (rank, percentile, all-time,
  // trend) recomputes for that player — without leaving the drill-in. `null`
  // means the card is still showing its owner. Reset whenever the owner or
  // category changes so a reused instance never carries a stale focus.
  const [focusRow, setFocusRow] = useState(null);
  useEffect(() => { setFocusRow(null); }, [ownerSelf?.slug, ownerSelf?.name, ownerSeasonKey, catKey]);
  const focused = !!focusRow;

  // The player every view is about: the owner, or the tapped player. Their
  // identity entry is the owner's index entry by default, or one rebuilt from
  // the all-time pool (name/slug + every matching season) so the trend view
  // still has their whole career to plot.
  const p = focusRow || pProp;
  const self = useMemo(() => {
    if (!focusRow) return ownerSelf;
    const seasons = allRows.filter((r) => samePlayer(r, focusRow));
    return { name: focusRow.name, slug: focusRow.slug || null, seasons };
  }, [focusRow, ownerSelf, allRows]);

  // Leaderboard rows don't carry a season field (the whole board is one
  // season) — the caller passes it on the context instead.
  const seasonKey = p.season || context.season;
  const selfRow = { ...p, name: self.name, slug: self.slug || null };
  // "/G" toggle. On (default): every rank/percentile/trend/value in this card
  // is PER-GAME category VA. Off: the whole card re-sorts and re-labels on
  // TOTAL category VA instead (a full season outranks a half one at the rate).
  const [perGame, setPerGame] = useState(true);
  // Shot-distance filter (the two scoring cards only). Tapping a distance bar
  // in View 2 scopes the WHOLE card — season leaderboard, all-time board, and
  // the by-season trend — to that single distance's value added instead of
  // the rolled-up scoring category. null = the normal rolled-up view.
  const [selectedZone, setSelectedZone] = useState(null);
  // When VA+ is the active metric, the Defense drill-in folds D Rating into
  // every ranking/percentile/all-time/trend figure — so the context matches
  // the Defense group's VA+ total (Blocks + Steals + D Rating), not just the
  // two box-score stocks. Only the Defense group carries it; individual
  // Blocks/Steals drill-ins stay pure box-score VA.
  const withDef = defActive && catKey === "Defense" && !!defs;

  // Shot-distance breakdown. The two scoring cards swap the single percentile
  // strip for a row of vertical value-added bars by shot distance. The Basic
  // "Scoring" group shows all six — free throws, the four 2-point zones (rim /
  // floater / mid-range / deep mid-range), and threes — while the "2-Pointers"
  // category shows only its four 2-point zones. Each bar's value is "points of
  // value vs. that shot's league-average FG%" (the same shape as the
  // twoAdd/tpAdd/ftAdd terms and zoneShotValue), so a card's bars sum to the
  // scoring value the rolled-up row already shows, split by WHERE it comes
  // from. Kept out of the core VA vectors on purpose (no shot-location data
  // before 1996-97), so this is gated on the season carrying a zoneFG baseline
  // and the player carrying any zone attempts. Defined before `metric` so a
  // selected distance can drive every ranking below. Each `val` takes the
  // season's league averages so the all-time/trend rankings stay era-fair.
  const showShots = (catKey === "Scoring" || catKey === "2-Pointers") && !!lga?.zoneFG && hasZoneData(p);
  const SHOT_SEGMENTS = useMemo(() => {
    // group: "ft" | "2p" | "3p" — drives the section headers and the
    // 2-Pointers-only filter. m/a pull the made/attempted for the FG% headline.
    // dist is the shot-distance range printed under the nickname (2-point zones
    // only — "FT" and "3PT" are distances in themselves).
    const all = [
      { key: "ft",    sub: "FT",       group: "ft", m: (r) => r.ftm || 0,    a: (r) => r.fta || 0,    val: (r, lx = lga) => ((r.ftm / (r.fta || 1)) - lx.laFT) * (r.fta || 0) },
      { key: "z03",   sub: "Rim",      group: "2p", dist: ZONE_DIST.z03,   m: (r) => r.z03m || 0,   a: (r) => r.z03a || 0,   val: (r, lx = lga) => zoneShotValue(r.z03m || 0, r.z03a || 0, lx.zoneFG?.z03) },
      { key: "z310",  sub: "Float",    group: "2p", dist: ZONE_DIST.z310,  m: (r) => r.z310m || 0,  a: (r) => r.z310a || 0,  val: (r, lx = lga) => zoneShotValue(r.z310m || 0, r.z310a || 0, lx.zoneFG?.z310) },
      { key: "z1016", sub: "Mid",      group: "2p", dist: ZONE_DIST.z1016, m: (r) => r.z1016m || 0, a: (r) => r.z1016a || 0, val: (r, lx = lga) => zoneShotValue(r.z1016m || 0, r.z1016a || 0, lx.zoneFG?.z1016) },
      { key: "z16xp", sub: "Deep Mid", group: "2p", dist: ZONE_DIST.z16xp, m: (r) => r.z16xpm || 0, a: (r) => r.z16xpa || 0, val: (r, lx = lga) => zoneShotValue(r.z16xpm || 0, r.z16xpa || 0, lx.zoneFG?.z16xp) },
      { key: "tp",    sub: "3PT",      group: "3p", m: (r) => r.tpm || 0,    a: (r) => r.tpa || 0,    val: (r, lx = lga) => 3 * ((r.tpm / (r.tpa || 1)) - lx.la3P) * (r.tpa || 0) },
    ];
    return catKey === "2-Pointers" ? all.filter((s) => s.group === "2p") : all;
  }, [lga, catKey]);
  // The distance the card is currently filtered to (null unless a bar is
  // tapped). Clears itself if the segment list no longer holds the key (e.g.
  // switching from Scoring to 2-Pointers with FT/3PT selected).
  const selSeg = showShots && selectedZone ? SHOT_SEGMENTS.find((s) => s.key === selectedZone) || null : null;
  // The four 2-point distance zones only exist from 1996-97 on; FT and 3PT are
  // defined every season, so only 2-point zones gate the all-time/trend pools.
  const segEra = (season) => !selSeg || selSeg.group !== "2p" || !!lgaForSeason(season)?.zoneFG;
  // Made/attempted (FG%) label honoring the card's /G toggle: per-game to one
  // decimal when on (matching the per-game VA values), whole-season totals when
  // off. The FG% is scale-invariant, so it's unchanged either way.
  const maLabel = (made, att, gp) => {
    const pct = att > 0 ? ((made / att) * 100).toFixed(1) : "0.0";
    return perGame
      ? `${(made / (gp || 1)).toFixed(1)}/${(att / (gp || 1)).toFixed(1)} (${pct}%)`
      : `${made}/${att} (${pct}%)`;
  };
  // Made/attempted (FG%) headline for a leaderboard row at the selected
  // distance — replaces the rolled-up category's rate label while filtered.
  const zoneRateLabel = (r) => maLabel(selSeg.m(r), selSeg.a(r), r.gp);

  // The metric the entire card ranks and displays on, respecting the toggle
  // (and folding in each row's D Rating when withDef). When a shot distance is
  // selected it becomes that distance's value added instead — same per-game /
  // total treatment as the rolled-up category.
  const metric = (r, lgaX, seasonOf = seasonKey) => {
    if (selSeg) {
      // A 2-point zone in a pre-1996-97 season has no league baseline; treat
      // it as no value rather than comparing against a 0% league FG%.
      if (selSeg.group === "2p" && !lgaX?.zoneFG) return 0;
      const v = selSeg.val(r, lgaX);
      return perGame ? v / (r.gp || 1) : v;
    }
    let v = perGame ? catVAperGame(r, lgaX, catKey) : catVATotal(r, lgaX, catKey);
    if (withDef && r.mp > 0) {
      const dva = defVAInfo(r, r.mp, lgaX, defs, seasonOf, defScope)?.dva ?? 0;
      v += perGame ? dva / (r.gp || 1) : dva;
    }
    return v;
  };
  // Pools follow the Explore scope selector; say so in the fine print.
  const scopeNoun = context.scope === "regular" ? "regular-season"
    : context.scope === "combined" ? "combined (RS+PO)" : "playoff";
  // Same selector, spelled the way the scope buttons at the top of the page do,
  // for the ranking header (the card already names the player and season above,
  // so the header says WHICH pool the rank is against instead of repeating them).
  const scopeTitle = context.scope === "regular" ? "Regular Season"
    : context.scope === "combined" ? "Regular Season & Playoffs" : "Playoffs";

  const d = useMemo(() => {
    // Ranking metric — total category VA, or per-game when the /G toggle is on
    // (see `metric`). Season pool (views 1 & 2): qualified = played >= 1/3 of
    // this player's GP.
    const floor = Math.max(1, Math.ceil((p.gp || 1) / 3));
    const pool = (poolsBySeason.get(seasonKey) || [])
      .filter((r) => (r.gp || 0) >= floor && r.mp > 0)
      .map((r) => ({ r, m: metric(r, lga, seasonKey) }))
      .sort((a, b) => b.m - a.m);
    const N = pool.length;
    const selfIdx = pool.findIndex((x) => samePlayer(x.r, selfRow));
    const selfM = selfIdx >= 0 ? pool[selfIdx].m : metric(selfRow, lga, seasonKey);
    // "Better than X% of the N qualified" — strictly-below count over the full
    // pool, so the top player reads ~99%, not a self-inclusive 100%.
    const below = pool.filter((x) => x.m < selfM).length;
    const pctile = N > 0 ? (below / N) * 100 : 0;
    const vals = pool.map((x) => x.m);
    const min = N ? vals[N - 1] : 0, max = N ? vals[0] : 0, med = N ? vals[Math.floor(N / 2)] : 0;
    let lo = Math.max(0, selfIdx - 2), hi = Math.min(N, lo + 5); lo = Math.max(0, hi - 5);
    const win = pool.slice(lo, hi).map((x, i) => ({ ...x, rank: lo + i + 1 }));

    // All-time (view 4): every player-season, season-accurate baselines. When
    // a 2-point distance is selected, seasons without shot-location data drop
    // out (their zone value is undefined, not zero).
    const floorA = Math.min(5, p.gp || 1);
    const all = allRows
      .filter((r) => (r.gp || 0) >= floorA && r.mp > 0 && segEra(r.season))
      .map((r) => ({ r, m: metric(r, lgaForSeason(r.season), r.season) }))
      .sort((a, b) => b.m - a.m);
    const allN = all.length;
    const allIdx = all.findIndex((x) => x.r.season === seasonKey && samePlayer(x.r, selfRow));
    const top = all.slice(0, 3).map((x, i) => ({ ...x, rank: i + 1 }));
    const selfAll = allIdx >= 0 ? { ...all[allIdx], rank: allIdx + 1 } : null;

    // Trend (view 6): this player's own seasons over time. Each season also
    // carries the player's league rank that year on the same metric, so a
    // top-of-league campaign can flag itself above its bar.
    const mine = [...(self.seasons || [])]
      .filter((s) => s.mp > 0 && segEra(s.season))
      .sort((a, b) => a.season.localeCompare(b.season))
      .map((s) => {
        const lgaS = lgaForSeason(s.season);
        // Carry the player's slug onto the season row so metric() can fold in
        // D Rating (defVAInfo keys off slug) — self.seasons rows don't have it.
        const sRow = { ...s, name: self.name, slug: self.slug || null };
        const m = metric(sRow, lgaS, s.season);
        // Rank among that season's qualified field (same ≥1/3-GP floor as the
        // season leaderboard above), by strictly-greater count.
        const floorS = Math.max(1, Math.ceil((s.gp || 1) / 3));
        const seasonPool = (poolsBySeason.get(s.season) || [])
          .filter((r) => (r.gp || 0) >= floorS && r.mp > 0);
        let rank = 1;
        for (const r of seasonPool) if (metric(r, lgaS, s.season) > m) rank += 1;
        return { season: s.season, m, rank, poolN: seasonPool.length };
      });

    return { floor, N, rank: selfIdx + 1, selfM, pctile, min, max, med, win,
             floorA, allN, allRank: allIdx + 1, top, selfAll, mine };
  }, [seasonKey, p.gp, catKey, poolsBySeason, allRows, self, lga, selfRow, perGame, withDef, defScope, selSeg]);

  const zoneData = useMemo(() => {
    if (!showShots) return null;
    // Same season field and ≥1/3-GP floor as the main percentile pool above.
    const floor = Math.max(1, Math.ceil((p.gp || 1) / 3));
    const pool = (poolsBySeason.get(seasonKey) || []).filter((r) => (r.gp || 0) >= floor && r.mp > 0);
    const N = pool.length;
    return SHOT_SEGMENTS.map((seg) => {
      const per = (r) => { const v = seg.val(r, lga); return perGame ? v / (r.gp || 1) : v; };
      const vals = pool.map(per).sort((a, b) => a - b);
      const selfV = per(selfRow);
      const below = vals.filter((v) => v < selfV).length;
      const pctile = N > 0 ? (below / N) * 100 : 0;
      const min = N ? vals[0] : 0, max = N ? vals[N - 1] : 0, med = N ? vals[Math.floor(N / 2)] : 0;
      // FG% headline for the player at this distance (null when he never
      // shot from here, so it reads "–" rather than a misleading 0%).
      const att = seg.a(selfRow), made = seg.m(selfRow);
      const fg = att > 0 ? (made / att) * 100 : null;
      return { ...seg, selfV, pctile, min, max, med, fg };
    });
  }, [showShots, SHOT_SEGMENTS, poolsBySeason, seasonKey, p.gp, selfRow, perGame, lga]);

  // Two headline totals for the six-bar Scoring card, shown inline with the
  // section heading. Efficiency is the scoring-efficiency component of VA —
  // 3P + 2P + FT value added, exactly what the three shooting rows sum to.
  // Relative impact is the six distance bars below, summed. The two differ on
  // purpose: the bars re-split 2-point value by shot location, and a season's
  // zone attempts don't always reconcile with its total 2PA. Only the Scoring
  // card gets them — the 2-Pointers card has no FT/3PT bars to sum.
  const zoneTotals = useMemo(() => {
    if (!zoneData || catKey === "2-Pointers") return null;
    const by = valueAddByCategory(selfRow, lga);
    const eff = (by["3-Pointers"] || 0) + (by["2-Pointers"] || 0) + (by["Free Throws"] || 0);
    const impact = zoneData.reduce((s, seg) => s + seg.selfV, 0);
    const scale = perGame ? (selfRow.gp || 1) : 1;
    // Collapse a value that rounds to zero so a sliver-negative total doesn't
    // read as a red "-0.00" (same treatment the bars get).
    const zeroed = (v) => (Math.abs(v) < 0.005 ? 0 : v);
    return { efficiency: zeroed(eff / scale), impact: zeroed(impact) };
  }, [zoneData, catKey, selfRow, lga, perGame]);

  const short = CAT_SHORT[catKey] || catKey;
  // While a shot distance is selected, every heading/column reads as that
  // distance (e.g. "RIM") instead of the rolled-up scoring category.
  const zoneLabel = selSeg ? selSeg.sub.toUpperCase() : null;
  const metricLabel = zoneLabel || short;
  // Total VA is a whole-season figure, so one decimal (matches the leaderboard);
  // per-game figures are an order of magnitude smaller, so show two.
  const sgn = (v, dp = perGame ? 2 : 1) => (v > 0 ? "+" : "") + v.toFixed(dp);
  const mpg = (r) => ((r.mp || 0) / (r.gp || 1)).toFixed(1);
  const posOf = (v) => (d.max > d.min ? ((v - d.min) / (d.max - d.min)) * 100 : 50);

  // Trend bars: one bar per season, diverging from a shared zero baseline.
  const ms = d.mine.map((x) => x.m);
  const tLo = Math.min(0, ...ms), tHi = Math.max(0, ...ms);
  const tSpan = (tHi - tLo) || 1;
  // Reserve a top band so a rank badge floats ABOVE its bar instead of being
  // clamped down onto it: the plot is squeezed into the lower (100 − HEAD_PCT)%
  // and the tallest bar tops out at HEAD_PCT, leaving room for the "#N" chip.
  const HEAD_PCT = 16;
  const plotScale = (100 - HEAD_PCT) / 100;
  const zeroPct = HEAD_PCT + (tHi / tSpan) * 100 * plotScale; // baseline offset from the top
  const curIdx = d.mine.findIndex((x) => x.season === seasonKey);
  // "2000-01" -> ’01 (season's end year)
  const yearTag = (season) => `’${season.slice(5)}`;

  // Card owner identity, for the "tapped the owner's own row → go back" check.
  const ownerRow = { name: ownerSelf?.name, slug: ownerSelf?.slug || null };
  const rowGrid = "grid grid-cols-[1.4rem_1fr_1.4rem_2rem_2.9rem_3.6rem] gap-x-1 items-center px-1 py-[2px] tabular-nums";
  const Row = ({ rank, r, m, isSelf }) => {
    const cells = (
      <>
        <span className="text-right text-[9px] opacity-70">{rank}</span>
        <span className="truncate text-[10px] font-medium">{r.name}</span>
        <span className="text-right text-[9px]">{r.gp}</span>
        <span className="text-right text-[9px]">{mpg(r)}</span>
        <span className={`text-right text-[10px] font-semibold ${!isSelf && m < 0 ? "text-red-600" : ""}`}>{sgn(m)}</span>
        <span className={`text-right text-[9px] ${isSelf ? "text-stone-200" : "text-stone-500"}`}>{selSeg ? zoneRateLabel(r) : CAT_SHOOTING[catKey] ? maLabel(...CAT_SHOOTING[catKey](r), r.gp) : catRateLabel(r, catKey, rateMode)}</span>
      </>
    );
    // The player the card is currently about is marked, not a link to itself.
    if (isSelf) {
      return <div className={`${rowGrid} bg-stone-800 text-white rounded-sm`} aria-current="true">{cells}</div>;
    }
    // Every other row re-points the card at that player; tapping the owner's
    // own row (visible when focused on someone ranked near them) goes back.
    const isOwner = samePlayer(r, ownerRow);
    return (
      <button
        type="button"
        onClick={() => setFocusRow(isOwner ? null : r)}
        aria-label={`Show ${r.name}, ranked #${rank}, ${metricLabel} value added ${sgn(m)}`}
        className={`${rowGrid} w-full text-left text-stone-600 rounded-sm cursor-pointer hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500`}
      >
        {cells}
      </button>
    );
  };

  // Compact per-game toggle shown in the by-season header. Flips the whole
  // card between total and per-game category VA (sorts, ranks, percentile,
  // all-time, trend, and shown values).
  const gToggle = (
    <button
      type="button"
      onClick={() => setPerGame((v) => !v)}
      aria-pressed={perGame}
      title={perGame ? "Ranking and values shown per game — tap for season totals" : "Rank and show values per game instead of season totals"}
      className={`shrink-0 tabular-nums text-[9px] font-semibold tracking-wide px-1.5 py-0.5 rounded-sm border transition-colors ${perGame ? "bg-stone-800 text-stone-100 border-stone-800" : "bg-white text-stone-500 border-stone-300 hover:text-stone-700"}`}
    >
      /G {perGame ? "ON" : "OFF"}
    </button>
  );

  return (
    <div
      className="my-1.5 px-2 py-2 bg-white border border-stone-200 rounded text-[10px] space-y-3"
      role="group"
      aria-label={`${self.name}, ${seasonKey} — ${metricLabel} value added context`}
    >
      {/* Whose card this is. Pinned at the top so it stays unambiguous even
          after tapping another player's row in the season leaderboard below
          re-points every view at them; the ← control returns to the owner. */}
      <div className="flex items-center gap-1.5">
        {p.team && (() => {
          const tc = teamColor(p.team);
          return (
            <span
              className="shrink-0 text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded-sm border"
              style={{ backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) }}
            >{p.team}</span>
          );
        })()}
        <span className="font-bold text-stone-900 text-[11px] truncate">{self.name}</span>
        <span className="shrink-0 text-stone-400 text-[9px] tabular-nums">{seasonKey}</span>
        {focused && (
          <button
            type="button"
            onClick={() => setFocusRow(null)}
            aria-label={`Back to ${ownerSelf.name}`}
            className="ml-auto shrink-0 inline-flex items-center gap-0.5 normal-case tracking-normal text-[9px] font-semibold text-stone-500 hover:text-stone-900 border border-stone-300 rounded-sm px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500"
          >
            <span aria-hidden>←</span> {shortName(ownerSelf.name)}
          </button>
        )}
      </div>

      {/* View 1 — rank + mini leaderboard */}
      <div>
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="uppercase tracking-wider text-[9px] text-stone-400 min-w-0">{metricLabel} Rankings ({scopeTitle})</span>
          <span className="shrink-0 whitespace-nowrap text-stone-800 font-bold">#{d.rank}<span className="text-stone-400 font-normal"> of {d.N}</span></span>
        </div>
        <div className="grid grid-cols-[1.4rem_1fr_1.4rem_2rem_2.9rem_3.6rem] gap-x-1 px-1 pb-0.5 text-[8px] uppercase tracking-wider text-stone-400 border-b border-stone-100">
          <span className="text-right">#</span><span>Player</span><span className="text-right">G</span><span className="text-right">MPG</span><span className="text-right">VA</span><span className="text-right">{metricLabel}</span>
        </div>
        {d.win.map((x) => (
          <Row key={x.rank} rank={x.rank} r={x.r} m={x.m} isSelf={x.rank === d.rank} />
        ))}
        {/* Fixed two-line height so toggling total↔per-game (which reflows
            "total"/"per-game" across the line break) never shifts the page. */}
        <div className="text-[8px] italic text-stone-400 mt-0.5 px-1 leading-[1.3] min-h-[2.6em]">Ranked by {perGame ? "per-game" : "total"} {metricLabel} VA among {scopeNoun} players with ≥{d.floor} G ({selSeg ? `${metricLabel} = FG% at that distance` : `${short} = ${rateMode === "perG" ? "per-game" : "per-36"} rate`}) · tap a player for their card.</div>
      </div>

      {/* View 2 — percentile. For the two scoring cards this fans out into a
          row of vertical value-added bars by shot distance so the reader sees
          WHERE the scoring value comes from: the Basic "Scoring" group shows
          all six (FT · four 2-point zones · 3PT), the "2-Pointers" category
          shows only its four zones. Each bar is a value-added distribution
          strip; the headline number is the player's FG% at that distance.
          Every other category (and any season with no shot-location bake)
          keeps the single horizontal percentile strip. */}
      {zoneData ? (
        <div className="border-t border-stone-100 pt-2">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="uppercase tracking-wider text-[9px] text-stone-400 truncate">
              {catKey === "2-Pointers" ? "2-Pointers · by distance" : "Scoring · by shot distance"}
            </span>
            <div className="shrink-0 flex items-baseline gap-2">
              {zoneTotals && (
                <>
                  <span
                    className="uppercase tracking-wider text-[8px] text-stone-400 whitespace-nowrap"
                    title={`Efficiency — 3-point + 2-point + free-throw value added${perGame ? " per game" : ""} (the scoring rows' shooting value)`}
                  >
                    Eff <span className={`text-[9px] font-bold tabular-nums ${zoneTotals.efficiency > 0.05 ? "text-green-600" : zoneTotals.efficiency < -0.05 ? "text-red-600" : "text-stone-500"}`}>{sgn(zoneTotals.efficiency)}</span>
                  </span>
                  <span
                    className="uppercase tracking-wider text-[8px] text-stone-400 whitespace-nowrap"
                    title={`Relative impact — the six shot-distance values below, summed${perGame ? " (per game)" : ""}`}
                  >
                    Impact <span className={`text-[9px] font-bold tabular-nums ${zoneTotals.impact > 0.05 ? "text-green-600" : zoneTotals.impact < -0.05 ? "text-red-600" : "text-stone-500"}`}>{sgn(zoneTotals.impact)}</span>
                  </span>
                </>
              )}
              {selSeg && (
                <button
                  type="button"
                  onClick={() => setSelectedZone(null)}
                  className="normal-case tracking-normal text-[9px] text-stone-400 hover:text-stone-700"
                >
                  {metricLabel} ✕
                </button>
              )}
            </div>
          </div>
          {/* Section headers spanning their bars: FT · 2-Pointers (×4) · 3PT.
              Only the six-bar Scoring card needs them — the 2-Pointers card is
              all one section, so its per-bar sub-labels are enough. */}
          {catKey !== "2-Pointers" && (
            <div className="grid grid-cols-6 gap-1 text-[7px] uppercase tracking-wider text-stone-400">
              <div className="col-span-1 text-center">FT</div>
              <div className="col-span-4 text-center border-x border-stone-200">2-Pointers</div>
              <div className="col-span-1 text-center">3PT</div>
            </div>
          )}
          {/* One equal column per bar (4 or 6). */}
          <div className="grid gap-1 items-start mt-1" style={{ gridTemplateColumns: `repeat(${zoneData.length}, minmax(0, 1fr))` }}>
            {zoneData.map((seg) => {
              const span = seg.max - seg.min;
              const clamp = (v) => Math.max(0, Math.min(100, span > 0 ? ((v - seg.min) / span) * 100 : 50));
              const selfPos = clamp(seg.selfV);
              const medPos = clamp(seg.med);
              // Collapse a value that rounds to zero to a clean +0.00 so a
              // sliver-negative zone doesn't read as a red "-0.00".
              const selfShown = Math.abs(seg.selfV) < 0.005 ? 0 : seg.selfV;
              // Value-added color band: green above +0.05, red below −0.05,
              // grey in the neutral middle.
              const vaColor = selfShown > 0.05 ? "text-green-600" : selfShown < -0.05 ? "text-red-600" : "text-stone-400";
              const isSel = selectedZone === seg.key;
              return (
                <div
                  key={seg.key}
                  onClick={() => setSelectedZone(isSel ? null : seg.key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedZone(isSel ? null : seg.key); } }}
                  aria-pressed={isSel}
                  title={`${seg.sub}${seg.dist ? ` (${seg.dist})` : ""} — filter the card to this distance`}
                  className={`flex flex-col items-center min-w-0 cursor-pointer rounded py-1 -my-1 transition-colors ${isSel ? "bg-stone-200 ring-1 ring-stone-800" : "hover:bg-stone-100"}`}
                >
                  {/* FG% headline for the player at this distance. */}
                  <span className="text-[10px] font-bold text-stone-800 tabular-nums leading-none">{seg.fg == null ? "–" : `${seg.fg.toFixed(0)}%`}</span>
                  {/* Value-added strip: low (bottom, light) → high (top, dark),
                      dot = player, tick = field median. The my-2 gutters give
                      the dot room to sit at an extreme without being clipped. */}
                  <div className="relative w-2 h-20 my-2 rounded-full bg-gradient-to-t from-stone-200 to-stone-400 mx-auto">
                    <div className="absolute inset-x-0 h-px bg-stone-500/60" style={{ bottom: `${medPos}%` }} title="median" />
                    <div className="absolute left-1/2 w-2.5 h-2.5 rounded-full bg-stone-900 ring-2 ring-white -translate-x-1/2 translate-y-1/2" style={{ bottom: `${selfPos}%` }} />
                  </div>
                  <span className={`text-[8px] tabular-nums font-semibold leading-none ${vaColor}`}>{sgn(selfShown)}</span>
                  <span className="mt-0.5 text-[7px] uppercase tracking-wide text-stone-400 leading-tight text-center">{seg.sub}</span>
                  {/* The distance the nickname stands for, so "Float" doesn't
                      have to be decoded. Sized down and untracked so the
                      longest range ("16 ft-3PT") clears a sixth of the row. */}
                  {seg.dist && (
                    <span className="text-[6px] uppercase text-stone-400 leading-tight text-center tabular-nums">{seg.dist}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="text-[8px] italic text-stone-400 mt-1.5 px-1 leading-[1.3]">Top = FG% · bar = {perGame ? "per-game" : "total"} value added vs. league FG% at each distance among the {scopeNoun} field (dot = player, tick = median) · number below = value added · tap a distance to filter the card.{zoneTotals ? " Eff = 3P + 2P + FT value added; Impact = the six bars summed." : ""}</div>
        </div>
      ) : (
      <div className="border-t border-stone-100 pt-2">
        <div className="uppercase tracking-wider text-[9px] text-stone-400 mb-5">Percentile</div>
        <div className="relative h-2 bg-gradient-to-r from-stone-200 via-stone-300 to-stone-400 rounded-full mx-1">
          <div className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-stone-500/60" style={{ left: `${posOf(d.med)}%` }} title="median" />
          <div className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-stone-900 ring-2 ring-white -translate-x-1/2 -translate-y-1/2" style={{ left: `${posOf(d.selfM)}%` }} />
          <span className="absolute -top-4 -translate-x-1/2 text-[11px] font-bold text-stone-800 tabular-nums leading-none" style={{ left: `${posOf(d.selfM)}%` }}>{d.pctile.toFixed(0)}</span>
        </div>
        {/* "med" sits under the median tick's actual position on the strip
            (clamped a little off the edges so it can't collide with low/high). */}
        <div className="relative h-3 text-[8px] text-stone-400 mt-0.5 px-1 tabular-nums">
          <span className="absolute left-1">low {sgn(d.min)}</span>
          <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${Math.min(82, Math.max(18, posOf(d.med)))}%` }}>med {sgn(d.med)}</span>
          <span className="absolute right-1">high {sgn(d.max)}</span>
        </div>
      </div>
      )}

      {/* View 4 — all-time rank */}
      <div className="border-t border-stone-100 pt-2">
        <div className="flex items-baseline justify-between mb-1">
          <span className="uppercase tracking-wider text-[9px] text-stone-400">All-time {metricLabel} VA</span>
          <span className="text-stone-800 font-bold">#{d.allRank}<span className="text-stone-400 font-normal"> of {d.allN}</span></span>
        </div>
        {d.top.map((x) => (
          <div key={"t" + x.rank} className={`grid grid-cols-[1.4rem_1fr_2.9rem] gap-x-1 items-center px-1 py-[2px] tabular-nums ${d.selfAll && x.rank === d.selfAll.rank ? "bg-stone-800 text-white rounded-sm" : "text-stone-600"}`}>
            <span className="text-right text-[9px] opacity-70">{x.rank}</span>
            <span className="truncate text-[10px]">{x.r.name} <span className="opacity-60">{x.r.season}</span></span>
            <span className="text-right text-[10px] font-semibold">{sgn(x.m)}</span>
          </div>
        ))}
        {d.selfAll && d.allRank > 3 && (
          <>
            <div className="text-center text-stone-300 leading-none">⋯</div>
            <div className="grid grid-cols-[1.4rem_1fr_2.9rem] gap-x-1 items-center px-1 py-[2px] tabular-nums bg-stone-800 text-white rounded-sm">
              <span className="text-right text-[9px] opacity-70">{d.selfAll.rank}</span>
              <span className="truncate text-[10px]">{d.selfAll.r.name} <span className="opacity-60">{d.selfAll.r.season}</span></span>
              <span className="text-right text-[10px] font-semibold">{sgn(d.selfAll.m)}</span>
            </div>
          </>
        )}
        <div className="text-[8px] italic text-stone-400 mt-0.5 px-1">Across all {d.allN} indexed {scopeNoun} seasons (≥{d.floorA} G){selSeg && selSeg.group === "2p" ? " with shot-location data (1996-97 on)" : ""}.</div>
      </div>

      {/* View 6 — trend across this player's seasons, one labeled bar each */}
      <div className="border-t border-stone-100 pt-2">
        {/* Second /G toggle, in sync with the first, so it's clear the
            by-season bars respond to it too. Extra bottom margin keeps a
            constant gap under the button so a full-height bar never crowds it. */}
        <div className="flex items-center justify-between mb-3">
          <span className="uppercase tracking-wider text-[9px] text-stone-400">{metricLabel} VA by season</span>
          {gToggle}
        </div>
        {d.mine.length === 0 ? (
          <div className="text-[9px] italic text-stone-400 px-1">No seasons on record.</div>
        ) : (
          <>
            {/* justify-start + a 10%-of-graph cap on each column keeps a
                one-to-three-season career from ballooning into a few enormous
                bars; a full career still packs tightly under the cap. */}
            <div className="flex items-stretch justify-start gap-[2px] h-20 px-1">
              {d.mine.map((x, i) => {
                const hPct = (Math.abs(x.m) / tSpan) * 100 * plotScale;
                const topPct = x.m >= 0 ? zeroPct - hPct : zeroPct;
                // Top-9-in-the-league season: flag its rank just above the bar.
                const topRank = x.poolN > 0 && x.rank <= 9 ? x.rank : null;
                return (
                  <div key={x.season} className="flex-1 relative min-w-0" style={{ maxWidth: "10%" }} title={`${x.season}: ${sgn(x.m)}${topRank ? ` · #${topRank} in league` : ""}`}>
                    <div className="absolute inset-x-0 h-px bg-stone-200" style={{ top: `${zeroPct}%` }} />
                    <div
                      className="absolute inset-x-[12%]"
                      style={{ top: `${topPct}%`, height: `${Math.max(hPct, 1)}%`, backgroundColor: i === curIdx ? "#1c1917" : "#a8a29e" }}
                    />
                    {topRank && (
                      // Auto-width chip centered over the bar, floating in the
                      // reserved headroom just above the bar's top — no full-
                      // width background to poke past the bar as a ghost bar.
                      <span
                        className="absolute left-1/2 -translate-x-1/2 text-[7px] font-bold text-stone-900 tabular-nums leading-none whitespace-nowrap"
                        style={{ top: `max(0px, calc(${topPct}% - 9px))` }}
                      >
                        #{topRank}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-start gap-[2px] px-1 mt-0.5">
              {d.mine.map((x, i) => (
                <span
                  key={x.season}
                  style={{ maxWidth: "10%" }}
                  className={`flex-1 min-w-0 text-center text-[7px] tabular-nums leading-tight ${i === curIdx ? "text-stone-900 font-bold" : "text-stone-400"}`}
                >
                  {yearTag(x.season)}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


export function VACategoryBreakdown({ player: p, lga, context = null, baseline = null, showDRating = true }) {
  const [rateMode, setRateMode] = useState("perG");
  const [openCat, setOpenCat] = useState(null);
  // "basic" folds the ten categories into Scoring/Passing/Rebounds/Defense.
  const [viewMode, setViewMode] = useState("basic");
  // Head-to-head comparison against another player-season from the same scope.
  const [compare, setCompare] = useState(null);
  const [picking, setPicking] = useState(false);
  const [compareMode, setCompareMode] = useState("values"); // "values" | "pct"
  // Baked defensive ratings (D-Rating category / VA+); college rows simply
  // never match and VA+ stays hidden there.
  const defs = useDefRatings();
  const switchView = (m) => { setViewMode(m); setOpenCat(null); };
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

  // D Rating — the player's edge over his own team's defense plus his
  // stock-rate share of the team's edge vs league (see defVAInfo). Folded
  // in under Defense; VA+ = VA + dVA. Regular-season rating; no drill-in
  // (one season number, no per-game splits).
  // showDRating=false (the leaderboard's VA view) drops the whole D-Rating
  // layer — row, Defense fold-in, VA+ banner — so the card sums to plain VA.
  const dInfo = showDRating ? defVAInfo(
    { ...p, slug: p.slug || context?.self?.slug },
    mp, lga, defs, p.season || context?.season, "rs"
  ) : null;
  const drtg = dInfo?.drtg ?? null;
  const dVA = dInfo?.dva ?? null;
  const vaPlus = dVA != null ? (p.va || 0) + dVA : null;

  const cats = [
    { key: "Points", value: ((p.pts / mp) - lga.laPTSperM) * mp, label: cnt(p.pts, "PTS") },
    { key: "3-Pointers", value: 3 * tpAdd, label: shot(p.tpm, p.tpa) },
    { key: "2-Pointers", value: 2 * twoAdd, label: shot(twoPm, twoPa) },
    { key: "Free Throws", value: ftAdd, label: shot(p.ftm, p.fta) },
    { key: "Assists", value: ((p.ast / mp) - lga.laASTperM) * mp * lga.laPTSperMake * (1 - lga.laFG), label: cnt(p.ast, "AST") },
    { key: "Steals", value: ((p.stl / mp) - lga.laSTLperM) * mp * lga.laPTSperPoss, label: cnt(p.stl, "STL") },
    { key: "Blocks", value: ((p.blk / mp) - lga.laBLKperM) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.blk, "BLK") },
    { key: "Turnovers", value: -((p.tov / mp) - lga.laTOVperM) * mp * lga.laPTSperPoss, label: cnt(p.tov, "TOV") },
    { key: "D Rebounds", value: ((p.drb / mp) - lga.laDRBperM) * 1.25 * mp * lga.laPTSperPoss * lga.laORBrate, label: cnt(p.drb, "DRB") },
    { key: "O Rebounds", value: ((p.orb / mp) - lga.laORBperM) * 1.25 * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.orb, "ORB") },
  ].sort((a, b) => VA_CATEGORY_ORDER.indexOf(a.key) - VA_CATEGORY_ORDER.indexOf(b.key));
  // D Rating rides at the very end, after Steals — the last Defense member.
  if (dVA != null) cats.push({ key: "D Rating", value: dVA, label: `${Math.round(drtg)} DRTG`, noDrill: true });

  // "Basic" rows: group members summed. D Rating rides with Defense, so the
  // four groups sum to VA+ (not VA) whenever it's present.
  const groupRows = VA_GROUPS.map((g) => {
    const [statOf, tag] = GROUP_STAT[g.key];
    let value = g.cats.reduce((s, k) => s + (cats.find((c) => c.key === k)?.value || 0), 0);
    if (g.key === "Defense" && dVA != null) value += dVA;
    return { key: g.key, value, label: cnt(statOf(p), tag) };
  });
  const activeRows = viewMode === "basic" ? groupRows : cats;
  const maxAbs = Math.max(...activeRows.map((c) => Math.abs(c.value)), 0.1);
  const signed = (v, d) => (v > 0 ? "+" : "") + v.toFixed(d);
  // Primary row for the compare panel — leaderboard rows carry no season/name
  // of their own; the context fills the gaps.
  const aRow = { ...p, season: p.season || context?.season, name: p.name || context?.self?.name, slug: p.slug || context?.self?.slug || null };

  return (
    <div className="px-2 py-2 bg-stone-50 border-t border-stone-100">
      {compare && context ? (
        // Comparison toggle row: the gold vs-chip left (where Basic/By
        // Category lives) and Values/Percentiles right (where Per 36/Per G
        // lives); the view/rate toggles hide while comparing.
        <div className="flex justify-between items-center gap-1 mb-1.5">
          <CompareButton
            compare={compare}
            picking={picking}
            onOpen={() => setPicking((v) => !v)}
            onClear={() => { setCompare(null); setPicking(false); }}
          />
          <div className="inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
            <button onClick={() => setCompareMode("values")} className={`px-1.5 py-0.5 ${compareMode === "values" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Values</button>
            <button onClick={() => setCompareMode("pct")} className={`px-1.5 py-0.5 border-l border-stone-300 ${compareMode === "pct" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Percentiles</button>
          </div>
        </div>
      ) : (
      <div className="flex justify-between items-center gap-1 mb-1.5">
        <div className="inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
          <button onClick={() => switchView("basic")} className={`px-1.5 py-0.5 ${viewMode === "basic" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Basic</button>
          <button onClick={() => switchView("detail")} className={`px-1.5 py-0.5 border-l border-stone-300 ${viewMode === "detail" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>By Category</button>
        </div>
        {context && (
          <CompareButton
            compare={compare}
            picking={picking}
            onOpen={() => setPicking((v) => !v)}
            onClear={() => { setCompare(null); setPicking(false); }}
          />
        )}
        <div className="inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
          <button onClick={() => setRateMode("per36")} className={`px-1.5 py-0.5 ${rateMode === "per36" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Per 36</button>
          <button onClick={() => setRateMode("perG")} className={`px-1.5 py-0.5 border-l border-stone-300 ${rateMode === "perG" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Per G</button>
        </div>
      </div>
      )}
      {picking && context && (
        <ComparePicker
          context={context}
          self={aRow}
          onPick={(sel) => { setCompare(sel); setPicking(false); }}
          onCancel={() => setPicking(false)}
        />
      )}
      {compare && context ? (
        <ComparePanel key={`${compare.row.season}:${compare.slug || compare.name}`} a={aRow} b={compare.row} bSeasons={compare.seasons} context={context} rateMode={rateMode} mode={compareMode} setMode={setCompareMode} />
      ) : (
      <>
      {vaPlus != null && (
        <div
          className="text-center text-[9px] mb-1"
          title={dInfo?.w != null
            ? `VA+ = VA + defensive net over possessions played: ${Math.round(drtg)} DRTG vs team ${dInfo.teamDrtg.toFixed(1)} + ${(dInfo.w * 100).toFixed(0)}% of team's edge vs league ${dInfo.laDRtg.toFixed(1)} (plus edges earned by stock rate; minus edges shrink with activity: 40% − earned)`
            : `VA+ = VA + defensive net rating (${Math.round(drtg)} DRTG vs ${(lga.laPTSperPoss * 100).toFixed(1)} league) over the possessions played`}
        >
          <span className="uppercase tracking-widest text-stone-400 mr-1.5">VA+</span>
          <span className={`tabular-nums font-bold ${vaPlus < 0 ? "text-red-600" : "text-stone-800"}`}>{vaPlus.toFixed(1)}</span>
          <span className={`tabular-nums ${dVA < 0 ? "text-red-500" : "text-stone-400"}`}> · D {(dVA > 0 ? "+" : "") + dVA.toFixed(1)}</span>
        </div>
      )}
      {activeRows.map((c) => {
        const pct = (Math.abs(c.value) / maxAbs) * 45;
        const isPos = c.value >= 0;
        const perG = c.value / gp;
        const catOpen = context && openCat === c.key;
        // Whole row is the tap target (same as the playoff breakdown), with
        // the selected row highlighted.
        const onCatTap = context && !c.noDrill ? () => setOpenCat(catOpen ? null : c.key) : undefined;
        return (
          <React.Fragment key={c.key}>
            <div
              className={`flex items-center gap-2 text-[10px] py-[1px] -mx-1 px-1 ${onCatTap ? "cursor-pointer" : ""} ${catOpen ? "bg-stone-200" : ""}`}
              onClick={onCatTap}
              role={onCatTap ? "button" : undefined}
              tabIndex={onCatTap ? 0 : undefined}
              onKeyDown={onCatTap ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCatTap(); } } : undefined}
              aria-pressed={onCatTap ? catOpen : undefined}
            >
              <span className={`w-[4.5rem] shrink-0 text-right ${catOpen ? "text-stone-900 font-semibold" : "text-stone-600"}`}>{c.key}</span>
              <div className="flex-1 relative h-4">
                <div className="absolute inset-y-0 left-1/2 w-px bg-stone-300" />
                <div className="absolute inset-y-0.5" style={{ backgroundColor: isPos ? "#1c1917" : "#a8a29e", left: isPos ? "50%" : `${50 - pct}%`, width: `${pct}%` }} />
              </div>
              <span className={`w-9 shrink-0 tabular-nums text-right font-semibold ${perG < 0 ? "text-red-600" : "text-stone-700"}`}>{signed(perG, 2)}</span>
              <span className="w-[5.5rem] shrink-0 text-[9px] text-stone-500 text-right tabular-nums">{c.label}</span>
            </div>
            {catOpen && <CategoryContext p={p} catKey={c.key} lga={lga} rateMode={rateMode} context={context} defs={defs} defActive={dVA != null} defScope="rs" />}
            {viewMode === "detail" && VA_PARTITIONS_AFTER.has(c.key) && <div className="my-1 border-t border-stone-200" />}
          </React.Fragment>
        );
      })}
      <div className="mt-2 text-center text-[9px] italic text-stone-400">
        Bars show per-game contribution above / below the {baseline || (context ? "NBA playoff" : "D-I")} baseline{context ? " · tap a category for league context" : ""}
      </div>
      </>
      )}
    </div>
  );
}
