"use client";

import React, { useState, useMemo, useEffect } from "react";
import { TEAMS } from "../teams";
import { LGA, valueAddByCategory, playmakingVA, reboundGamma, volumeVA } from "../scoring";
import { GameVAChart } from "./charts";
import { CompareButton, ComparePanel, resolveCompareTarget, useFreshRows } from "./compare";
import { ComparePicker } from "./compare-picker";
import { defVAInfo, teamLineNote, useDefRatings } from "../lib/defense";
import { fetchBakedJson } from "../lib/fetch-cache";
import { comparePalette, normalizeName, seasonTag, shortName, teamColor } from "../lib/format";
import { aggregateSnapshots } from "../lib/players";
import { GROUP_STAT, VA_CATEGORY_ORDER, VA_GROUPS, VA_PARTITIONS_AFTER, catVATotal } from "../lib/va";
import { useLgaFor, usgAdjRows } from "../lib/va-mode";
import { useCompareReport } from "../lib/share-state";
import { CategoryContext } from "./category-context";


export function VABreakdown({ p: pSeries, lga = LGA, rsLga = null, teams = TEAMS, rate = false, gameNumber, gameSeries, byGame, gameContext, partitions, onPrev, onNext, useTeamColor = false, breakdownTitle, gameTileLabel = "Game", enableSeriesDrill = false, regularSeasonTotals = null, playerConf = null, context = null, season = null, defScope = "rs", showDRating = true, pendingCompare = null, onCompareHandled = null }) {
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
  // Into the page's link, when this breakdown is a board's open row.
  useCompareReport(compare);
  const [picking, setPicking] = useState(false);
  // "values" | "pct". A comparison opens on PERCENTILES: two raw VA figures
  // only say who was bigger, while the percentile pair says how big each was
  // against everyone who ever played the category — which is the thing the
  // card is for. Values is one tap away for the reader who wants the margin.
  const [compareMode, setCompareMode] = useState("pct");
  // A career-year selection made inside the compare panel's chart, reported up
  // so the vs-chip above can name it instead of the seasons the comparison
  // opened on. ComparePanel owns it; this only mirrors it for the chip.
  const [careerPick, setCareerPick] = useState(null);
  // A comparison handed in by the navigation that opened this card — the
  // compare panel's career-year gate asks for the page to move to one player's
  // season and land already comparing against the other's. Resolved against
  // this card's own context pool; a target the scope doesn't carry is simply
  // dropped rather than opening a half-built comparison.
  useEffect(() => {
    if (!pendingCompare || !context) return;
    const sel = resolveCompareTarget(context, pendingCompare);
    if (sel) { setCompare(sel); setPicking(false); }
    onCompareHandled?.();
  }, [pendingCompare, context, onCompareHandled]);
  // Season baselines under the active USG-ADJ mode (lib/va-mode.js).
  const lgaFor = useLgaFor();
  // The comparison is held in state as it was when it was made, so the tiles
  // below read the compared player out of the LIVE pool instead of that
  // snapshot: the USG-ADJ switch re-prices this card's own figures, and the
  // gold ones beside them have to move with it (see useFreshRows). The panel
  // further down does the same for itself.
  const { freshSide } = useFreshRows(context);
  const cmpRow = useMemo(() => (compare ? freshSide(compare.row) : null), [compare, freshSide]);
  // The compared player's own playoff game log (per-game VA), overlaid onto
  // the VA-by-Game chart above (aligned at game 1) while comparing. The route
  // bakes plain VA on every game split, so the log is re-priced here against
  // the COMPARED season's baselines under the active mode — those bars share
  // an axis with this card's own re-priced ones, and one side moving with the
  // USG-ADJ switch while the other doesn't is two currencies on one chart.
  //
  // Keyed on the compared player's identity, not on the selection object: that
  // object takes a new identity on every toggle (it is re-resolved against the
  // live pool above), and the season's log is the same fetch either way.
  const [compareRun, setCompareRun] = useState(null);
  const cmpSeason = compare?.row?.season || null;
  const cmpSlug = compare?.slug || null;
  const cmpName = compare?.name || null;
  useEffect(() => {
    if (!cmpSeason) { setCompareRun(null); return; }
    let cancelled = false;
    setCompareRun(null);
    fetchBakedJson(`/api/leaderboard?season=${cmpSeason}`)
      .then((dd) => {
        if (cancelled) return;
        const nn = normalizeName(cmpName || "");
        const pl = (dd.players || []).find((x) => (cmpSlug && x.slug === cmpSlug) || normalizeName(x.name) === nn);
        // A playoff game log, so the compared season's PLAYOFF baseline — the
        // same one /api/leaderboard baked it against.
        const priced = pl ? usgAdjRows([pl], lgaFor(cmpSeason, "po"))[0] : null;
        const run = (priced?.games || []).filter((g) => g.va != null).map((g) => g.va);
        setCompareRun(run.length ? run : null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [cmpSeason, cmpSlug, cmpName, lgaFor]);
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
  // shooting as made/att (pct%) on that same toggle. Single-game drill-in
  // keeps raw counts.
  const r36 = (v, tag) => `${(mp > 0 ? (v / mp) * 36 : 0).toFixed(1)} ${tag}/36`;
  const rG  = (v, tag) => `${(p.gp > 0 ? v / p.gp : 0).toFixed(1)} ${tag}/G`;
  // Made/attempted follows the same per-game / per-36 toggle as the counting
  // rows (and as the context card's M/A) — season totals ran to four figures
  // for a high-volume 2P line and overflowed the row. Pct is scale-invariant.
  const shot = (m, att) => {
    const div = rateMode === "perG" ? (p.gp || 1) : (mp / 36);
    return `${(m / div).toFixed(1)}/${(att / div).toFixed(1)} (${att > 0 ? ((m / att) * 100).toFixed(1) : "0.0"}%)`;
  };
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
    { key: "Points", value: volumeVA(p, lga), label: cnt(p.pts, "PTS") },
    { key: "3-Pointers", value: 3 * tpAdd, label: shoot(p.tpm, p.tpa, "3P") },
    { key: "2-Pointers", value: 2 * twoAdd, label: shoot(twoPm, twoPa, "2P") },
    { key: "Free Throws", value: ftAdd, label: shoot(p.ftm, p.fta, "FT") },
    { key: "Assists", value: playmakingVA(p, lga), label: cnt(p.ast, "AST") },
    { key: "Steals", value: ((p.stl / mp) - lga.laSTLperM) * mp * lga.laPTSperPoss, label: cnt(p.stl, "STL") },
    { key: "Blocks", value: ((p.blk / mp) - lga.laBLKperM) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.blk, "BLK") },
    { key: "Turnovers", value: -((p.tov / mp) - lga.laTOVperM) * mp * lga.laPTSperPoss, label: cnt(p.tov, "TOV") },
    { key: "D Rebounds", value: ((p.drb / mp) - lga.laDRBperM) * reboundGamma(p.drb, mp, lga, lga.laDRBrate) * mp * lga.laPTSperPoss * lga.laORBrate, label: cnt(p.drb, "DRB") },
    { key: "O Rebounds", value: ((p.orb / mp) - lga.laORBperM) * reboundGamma(p.orb, mp, lga, lga.laORBrate) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.orb, "ORB") },
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
    // These are the player's REGULAR-SEASON totals, so they are scored against
    // the regular-season baseline even when the panel above them is a playoff
    // run on the playoff-blended one (spec §4.8). The tick means "what this
    // player normally produces", and it would stop meaning that if his regular
    // season were charged a playoff bar. `rsLga` falls back to `lga` for
    // callers that are already on the regular season.
    const refLga = rsLga || lga;
    const full = valueAddByCategory(regularSeasonTotals, refLga);
    const out = {};
    for (const k of Object.keys(full)) out[k] = (full[k] / regularSeasonTotals.g) * referenceScale;
    for (const g of VA_GROUPS) out[g.key] = g.cats.reduce((s, c) => s + (out[c] || 0), 0);
    // D Rating reference: the player's rs defensive value over rs minutes,
    // per game — same "what he normally produces" tick the groups get.
    const dRef = defVAInfo(regularSeasonTotals, regularSeasonTotals.mp, refLga, defs, seasonKey, "rs")?.dva ?? null;
    if (dRef != null) out["D Rating"] = (dRef / regularSeasonTotals.g) * referenceScale;
    return out;
  })();

  const refMagnitudes = refByKey ? activeRows.map((c) => Math.abs(refByKey[c.key] || 0)) : [];
  const maxAbs = Math.max(...activeRows.map((c) => Math.abs(c.value)), ...refMagnitudes, 0.5);
  // First row that actually draws a reference tick — it gets the caption that
  // names what every tick below it means. -1 when no row has one.
  const firstRefIdx = refByKey
    ? activeRows.findIndex((c) => refByKey[c.key] != null && Number.isFinite(refByKey[c.key]))
    : -1;
  const owner = teams[p.team]?.owner;
  // Accent color drives the chart line/dot and the positive bars. Historical
  // and explore contexts use the player's team color; live/draft uses the
  // owner's color so the competition stays the dominant visual.
  const accentColor = useTeamColor
    ? teamColor(p.team)
    : owner === "Spencer" ? "#d97706"
    : owner === "Trey" ? "#0d9488"
    : "#57534e";
  // The compared player's palette, picked against this card's own accent — his
  // team color, or the alternate/gold when that one would read as the same
  // color as the accent (see comparePalette). Everything the comparison wears
  // up here — the chip, the tucked-in figures, the chart's overlay run — comes
  // out of it, so it matches the panel below.
  const cmpPal = compare ? comparePalette(compare.row.team, accentColor) : null;
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
                <span className="tabular-nums text-sm font-semibold leading-none rounded-sm px-1 py-[1px]" style={{ color: cmpPal.ink, backgroundColor: cmpPal.bg }}>{(cmpRow.va ?? 0).toFixed(1)}</span>
              )}
            </div>
            {vaPlus != null && (
              <div
                className="flex items-baseline justify-center gap-2 mb-2"
                title={dInfo?.w != null
                  ? `VA+ = VA + defensive net over possessions played: ${Math.round(drtg)} DRTG vs team ${dInfo.teamDrtg.toFixed(1)} + ${(dInfo.w * 100).toFixed(0)}% of team's edge vs league ${dInfo.laDRtg.toFixed(1)} (plus edges earned by stock rate; minus edges shrink with activity: 40% − earned)${teamLineNote(dInfo, p.team)}`
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
                  <div className="tabular-nums text-[10px] font-semibold rounded-sm mx-auto px-1" style={{ color: cmpPal.ink, backgroundColor: cmpPal.bg }}>{cmpRow.gp || 0}</div>
                )}
              </div>
              <div className="flex flex-col justify-end text-center">
                <div className="text-[9px] uppercase tracking-widest text-stone-500 leading-tight">MIN/G</div>
                <div className="tabular-nums text-base font-semibold text-stone-700">{(mp / (p.gp || 1)).toFixed(1)}</div>
                {compare && atSeasonLevel && (
                  <div className="tabular-nums text-[10px] font-semibold rounded-sm mx-auto px-1" style={{ color: cmpPal.ink, backgroundColor: cmpPal.bg }}>{((cmpRow.mp || 0) / (cmpRow.gp || 1)).toFixed(1)}</div>
                )}
              </div>
              {multiGame && (
                <div className="flex flex-col justify-end text-center">
                  <div className="text-[9px] uppercase tracking-widest text-stone-500 leading-tight">VA / Game</div>
                  <div className={`tabular-nums text-base font-semibold ${(p.va / p.gp) < 0 ? "text-red-600" : "text-stone-700"}`}>{(p.va / p.gp).toFixed(2)}</div>
                  {compare && atSeasonLevel && (
                    <div className="tabular-nums text-[10px] font-semibold rounded-sm mx-auto px-1" style={{ color: cmpPal.ink, backgroundColor: cmpPal.bg }}>{(cmpRow.vaPerG ?? ((cmpRow.va || 0) / (cmpRow.gp || 1))).toFixed(2)}</div>
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
                  overlayColor={cmpPal ? cmpPal.base : undefined}
                  overlayFill={cmpPal ? cmpPal.light : undefined}
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
            careerPick={careerPick}
            onOpen={() => setPicking((v) => !v)}
            onClear={() => { setCompare(null); setPicking(false); }}
          />
          <div className="shrink-0 inline-flex items-center border border-stone-300 rounded-sm overflow-hidden text-[9px]">
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
        <div className="shrink-0 inline-flex items-center border border-stone-300 rounded-sm overflow-hidden text-[9px]">
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
          <div className="shrink-0 inline-flex items-center border border-stone-300 rounded-sm overflow-hidden text-[9px]">
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
          defs={defs}
          defActive={dVA != null}
          defScope={defScope}
          onPickChange={setCareerPick}
        />
      ) : (
      <>
      {/* Extra headroom when the tick caption is showing, so "Reg. Season Avg"
          has somewhere to sit above the first row without crowding the toggles. */}
      <div className={`space-y-0.5 ${firstRefIdx >= 0 ? "pt-3.5" : ""}`}>
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
                  {/* Caption for the tick marks, printed once directly above the
                      topmost tick so the column of marks is self-explanatory. */}
                  {refLeftPct != null && i === firstRefIdx && (
                    <div
                      className="absolute bottom-full mb-0.5 -translate-x-1/2 whitespace-nowrap text-[8px] leading-none text-stone-400 pointer-events-none"
                      style={{ left: `${refLeftPct}%` }}
                    >
                      Reg. Season Avg
                    </div>
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
        Bars show contribution above/below the league baseline ({lga?.usgModel ? "median rates, scoring usage-adjusted" : "median rates"}){context && atSeasonLevel ? " · tap a category for league context" : ""}
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


export function VACategoryBreakdown({ player: p, lga, context = null, baseline = null, showDRating = true, pendingCompare = null, onCompareHandled = null }) {
  const [rateMode, setRateMode] = useState("perG");
  const [openCat, setOpenCat] = useState(null);
  // "basic" folds the ten categories into Scoring/Passing/Rebounds/Defense.
  const [viewMode, setViewMode] = useState("basic");
  // Head-to-head comparison against another player-season from the same scope.
  const [compare, setCompare] = useState(null);
  // Into the page's link, when this breakdown is a board's open row.
  useCompareReport(compare);
  const [picking, setPicking] = useState(false);
  // "values" | "pct". A comparison opens on PERCENTILES: two raw VA figures
  // only say who was bigger, while the percentile pair says how big each was
  // against everyone who ever played the category — which is the thing the
  // card is for. Values is one tap away for the reader who wants the margin.
  const [compareMode, setCompareMode] = useState("pct");
  // Mirrors the compare panel's career-year selection so the vs-chip can name
  // it in place of the comparison's own seasons (see ComparePanel).
  const [careerPick, setCareerPick] = useState(null);
  // Baked defensive ratings (D-Rating category / VA+); college rows simply
  // never match and VA+ stays hidden there.
  const defs = useDefRatings();
  // A comparison handed in by the navigation that opened this card — see the
  // matching effect in VABreakdown. Must sit above the early return below;
  // hooks are unconditional.
  useEffect(() => {
    if (!pendingCompare || !context) return;
    const sel = resolveCompareTarget(context, pendingCompare);
    if (sel) { setCompare(sel); setPicking(false); }
    onCompareHandled?.();
  }, [pendingCompare, context, onCompareHandled]);
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
  // M/A on the same toggle as the counting rows — see VABreakdown above.
  const shot = (m, att) => {
    const div = rateMode === "perG" ? gp : (mp / 36);
    return `${(m / div).toFixed(1)}/${(att / div).toFixed(1)} (${att > 0 ? ((m / att) * 100).toFixed(1) : "0.0"}%)`;
  };
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
    { key: "Points", value: volumeVA(p, lga), label: cnt(p.pts, "PTS") },
    { key: "3-Pointers", value: 3 * tpAdd, label: shot(p.tpm, p.tpa) },
    { key: "2-Pointers", value: 2 * twoAdd, label: shot(twoPm, twoPa) },
    { key: "Free Throws", value: ftAdd, label: shot(p.ftm, p.fta) },
    { key: "Assists", value: playmakingVA(p, lga), label: cnt(p.ast, "AST") },
    { key: "Steals", value: ((p.stl / mp) - lga.laSTLperM) * mp * lga.laPTSperPoss, label: cnt(p.stl, "STL") },
    { key: "Blocks", value: ((p.blk / mp) - lga.laBLKperM) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.blk, "BLK") },
    { key: "Turnovers", value: -((p.tov / mp) - lga.laTOVperM) * mp * lga.laPTSperPoss, label: cnt(p.tov, "TOV") },
    { key: "D Rebounds", value: ((p.drb / mp) - lga.laDRBperM) * reboundGamma(p.drb, mp, lga, lga.laDRBrate) * mp * lga.laPTSperPoss * lga.laORBrate, label: cnt(p.drb, "DRB") },
    { key: "O Rebounds", value: ((p.orb / mp) - lga.laORBperM) * reboundGamma(p.orb, mp, lga, lga.laORBrate) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.orb, "ORB") },
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
            careerPick={careerPick}
            onOpen={() => setPicking((v) => !v)}
            onClear={() => { setCompare(null); setPicking(false); }}
          />
          <div className="shrink-0 inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
            <button onClick={() => setCompareMode("values")} className={`px-1.5 py-0.5 ${compareMode === "values" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Values</button>
            <button onClick={() => setCompareMode("pct")} className={`px-1.5 py-0.5 border-l border-stone-300 ${compareMode === "pct" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Percentiles</button>
          </div>
        </div>
      ) : (
      <div className="flex justify-between items-center gap-1 mb-1.5">
        <div className="shrink-0 inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
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
        <div className="shrink-0 inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
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
        <ComparePanel key={`${compare.row.season}:${compare.slug || compare.name}`} a={aRow} b={compare.row} bSeasons={compare.seasons} context={context} rateMode={rateMode} mode={compareMode} setMode={setCompareMode} defs={defs} defActive={dVA != null} defScope="rs" onPickChange={setCareerPick} />
      ) : (
      <>
      {vaPlus != null && (
        <div
          className="text-center text-[9px] mb-1"
          title={dInfo?.w != null
            ? `VA+ = VA + defensive net over possessions played: ${Math.round(drtg)} DRTG vs team ${dInfo.teamDrtg.toFixed(1)} + ${(dInfo.w * 100).toFixed(0)}% of team's edge vs league ${dInfo.laDRtg.toFixed(1)} (plus edges earned by stock rate; minus edges shrink with activity: 40% − earned)${teamLineNote(dInfo, p.team)}`
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
        Bars show per-game contribution above / below the {baseline || (context ? "NBA playoff" : "D-I")} baseline{lga?.usgModel ? ", scoring usage-adjusted" : ""}{context ? " · tap a category for league context" : ""}
      </div>
      </>
      )}
    </div>
  );
}
