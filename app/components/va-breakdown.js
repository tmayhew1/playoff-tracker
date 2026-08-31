"use client";

import React, { useState, useMemo, useEffect } from "react";
import { TEAMS } from "../teams";
import { LGA, ZONES, valueAddByCategory, lgaForSeason, playmakingVA, reboundGamma, volumeVA, zoneShotValue, hasZoneData } from "../scoring";
import { GameVAChart } from "./charts";
import { CompareButton, ComparePanel, ComparePicker, PerGameToggle, resolveCompareTarget, useFreshRows } from "./compare";
import { DEF_TEAM_NOTE_W, defVAInfo, teamLineNote, useDefRatings } from "../lib/defense";
import { fetchJsonCached } from "../lib/fetch-cache";
import { GOLD, GOLD_BG, compName, comparePalette, normalizeName, seasonTag, shortName, teamColor, withAlpha } from "../lib/format";
import { useGatedGo } from "../lib/gated-go";
import { aggregateSnapshots } from "../lib/players";
import { CAT_COUNTING, CAT_SHOOTING, CAT_SHORT, GROUP_STAT, VA_CATEGORY_ORDER, VA_GROUP_BY_KEY, VA_GROUPS, VA_PARTITIONS_AFTER, catRateLabel, catVATotal, catVAperGame, samePlayer } from "../lib/va";
import { useLgaFor, usgAdjRows } from "../lib/va-mode";


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
    fetchJsonCached(`/api/leaderboard?season=${cmpSeason}`)
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


// Shot-distance range per zone key ("z03" -> "0-3 ft"), so the shot-distance
// bars can print the actual range under their nickname ("Rim", "Float", …)
// without restating the boundaries ZONES already owns.
const ZONE_DIST = Object.fromEntries(ZONES.map((z) => [z.key, z.label]));

// Short label printed under a category's bar in the split row below a Basic
// group's rankings ("Assists" -> AST). Box-score tags rather than CAT_SHORT's
// prose so the bars read like a stat line.
// Which of a two-stat group's components goes on which axis of its scatter,
// as [x, y]. Assists is the headline stat of the pair it belongs to, so it
// takes the vertical; the others follow the order they're listed in.
const SCATTER_AXES = {
  "Passing": ["Turnovers", "Assists"],
  "Rebounds": ["D Rebounds", "O Rebounds"],
  "Defense": ["Blocks", "Steals"],
};

const SEG_SUB = {
  "Points": "PTS", "2-Pointers": "2P", "3-Pointers": "3P", "Free Throws": "FT",
  "Assists": "AST", "Turnovers": "TOV", "D Rebounds": "DRB", "O Rebounds": "ORB",
  "Blocks": "BLK", "Steals": "STL", "D Rating": "D Rtg",
};

// Bar order for a group's split row, where it differs from the group's member
// list. Scoring's zone form runs FT · rim · float · mid · deep mid · 3PT — free
// throws first, then out to the arc. Its pre-1996-97 fallback (no shot-location
// data to split 2P by) keeps that same shape, PTS · FT · 2P · 3P, so the card
// doesn't reshuffle as the reader walks a career back across 1996-97.
const SEG_ORDER = {
  "Scoring": ["Points", "Free Throws", "2-Pointers", "3-Pointers"],
};


// Dot radius and the tap radius around a finger press, in viewBox units. The
// tap radius is generous on purpose — the cloud is dense, and catching several
// players at once is a menu, not a miss.
const DOT_R = 0.85, TAP_R = 3.4;

// Symmetric dot plot ("collapse onto one axis"). Values are binned along the
// axis and each bin's dots stack outward from the centre line in alternating
// directions — 0, +1, −1, +2, −2 … — so a column's height reads as the count at
// that value and the whole thing is a mirrored histogram. The card's own player
// takes the centre slot of his bin so he's never buried mid-stack. Stack
// spacing shrinks if the tallest column would overflow the cross-axis.
//
// `entries` are { key, v } with v the value; `selfKey` marks the card's player.
// Returns viewBox positions for a plot of value-axis length L and cross-axis
// width C, both measured from the origin corner.
function dotPlotLayout(entries, selfKey, range, L, C) {
  const span = (range[1] - range[0]) || 1;
  const bins = Math.max(12, Math.round(L / 1.9));
  const along = (v) => ((v - range[0]) / span) * L;
  const byBin = new Map();
  for (const e of entries) {
    const b = Math.max(0, Math.min(bins - 1, Math.floor(((e.v - range[0]) / span) * bins)));
    if (!byBin.has(b)) byBin.set(b, []);
    byBin.get(b).push(e);
  }
  // Spacing that keeps the tallest column inside the cross-axis, capped at a
  // dot's own diameter so a sparse plot doesn't spread into a smear. The dots
  // then size themselves to whichever gap is tighter — the space between
  // columns or between the dots stacked within one — so a dense middle stays a
  // column of dots instead of fusing into a solid bar.
  const tallest = Math.max(1, ...[...byBin.values()].map((g) => g.length));
  const spacing = Math.min(2.2, (C * 0.92) / Math.max(1, tallest));
  const r = Math.max(0.28, Math.min(DOT_R, 0.45 * Math.min(L / bins, spacing)));
  const out = [];
  for (const [b, group] of byBin) {
    // Sort so a column is built from a stable order, then float the card's own
    // player to the front — the front of the queue is the centre slot.
    const g = [...group].sort((m, n) => m.v - n.v);
    const mine = g.findIndex((e) => e.key === selfKey);
    if (mine > 0) g.unshift(g.splice(mine, 1)[0]);
    const centre = ((b + 0.5) / bins) * L;
    g.forEach((e, i) => {
      // 0, +1, −1, +2, −2 … in units of `spacing`.
      const step = Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1);
      out.push({ ...e, along: centre, cross: C / 2 + step * spacing });
    });
  }
  // `along` rides along so a caller can place a reference of its own on the
  // value axis (the team-rating line on the D Rating plot).
  return { positions: out, zero: along(0), r, along };
}


// The two-stat groups' split. By default a scatter of the two stats against
// each other — every qualified player in the season in grey, the card's player
// in black. Selecting one stat collapses the cloud onto that stat's axis as a
// symmetric dot plot; selecting a stat with no axis of its own (Defense's D
// Rating) collapses horizontally. Tapping a grey dot re-points the whole card
// at that player, and a tap that catches several raises a menu to pick from.
// See the `scatter` memo in CategoryContext for what the axes are and why.
function ScatterSplit({ scatter, segData, height, xi, yi, selIdx, selectedSeg, onSelect, onPickPlayer, sgn, name, refLine = null }) {
  const { rows, me, ranges } = scatter;
  // Which players a tap landed on, and where to hang the menu.
  const [menu, setMenu] = useState(null);
  const svgRef = React.useRef(null);
  const collapsed = selIdx >= 0;
  // A collapsed plot runs along the axis the selected stat already owns, so the
  // cloud visibly falls onto it: the vertical stat collapses to a vertical dot
  // plot, the horizontal one (and the axis-less D Rating chip) to a horizontal.
  const vertical = collapsed && selIdx === yi;

  // Every dot's viewBox position, plus the value-axis zero, for whichever mode
  // is showing. Both modes produce the same shape so hit-testing, the grey
  // cloud and the black dot are all written once.
  const view = useMemo(() => {
    const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
    if (collapsed) {
      const L = vertical ? height : 100, C = vertical ? 100 : height;
      const entries = [
        ...rows.map((q, i) => ({ key: i, v: q.v[selIdx], all: q.v, row: q.row })),
        { key: "self", v: me[selIdx], all: me, row: null },
      ];
      const { positions, zero, r, along } = dotPlotLayout(entries, "self", ranges[selIdx], L, C);
      const place = (p) => vertical
        ? { cx: clamp(p.cross, 100), cy: clamp(height - p.along, height) }
        : { cx: clamp(p.along, 100), cy: clamp(p.cross, height) };
      const dots = positions.map((p) => ({ ...place(p), row: p.row, v: p.all, self: p.key === "self" }));
      // A second line the caller can put anywhere on the value axis, with a
      // label hung off the plot's edge beside it (see refLine).
      const refAt = refLine ? clamp(along(refLine.v), L) : null;
      return {
        dots, r,
        self: dots.find((dt) => dt.self),
        guides: vertical
          ? [{ x1: 0, y1: height - zero, x2: 100, y2: height - zero }]
          : [{ x1: zero, y1: 0, x2: zero, y2: height }],
        // The label is centred on the line, so its own anchor is kept a little
        // off each edge — the line can sit at the extremes, the text can't
        // hang off the card.
        ref: refAt == null ? null : (vertical
          ? { line: { x1: 0, y1: height - refAt, x2: 100, y2: height - refAt }, left: 0, top: ((height - refAt) / height) * 100, vertical: true }
          : { line: { x1: refAt, y1: 0, x2: refAt, y2: height }, left: Math.max(8, Math.min(92, refAt)), top: 0, vertical: false }),
      };
    }
    const pos = (i, v) => ((v - ranges[i][0]) / ((ranges[i][1] - ranges[i][0]) || 1));
    const place = (v) => ({ cx: clamp(pos(xi, v[xi]) * 100, 100), cy: clamp(height - pos(yi, v[yi]) * height, height) });
    const dots = rows.map((q) => ({ ...place(q.v), row: q.row, v: q.v, self: false }));
    const self = { ...place(me), row: null, v: me, self: true };
    return {
      dots: [...dots, self],
      self,
      r: DOT_R,
      // The reference is a point on ONE stat's axis, so it only means something
      // once the plot has collapsed onto that stat.
      ref: null,
      guides: [
        { x1: clamp(pos(xi, 0) * 100, 100), y1: 0, x2: clamp(pos(xi, 0) * 100, 100), y2: height },
        { x1: 0, y1: clamp(height - pos(yi, 0) * height, height), x2: 100, y2: clamp(height - pos(yi, 0) * height, height) },
      ],
    };
  }, [rows, me, ranges, collapsed, vertical, selIdx, xi, yi, height, refLine]);

  // Turn a tap into the players under it. The SVG scales uniformly from a
  // 100-wide viewBox, so client coordinates map straight back through its box.
  const handleTap = (e) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    const vx = ((e.clientX - box.left) / box.width) * 100;
    const vy = ((e.clientY - box.top) / box.height) * height;
    const hits = view.dots
      .filter((dt) => !dt.self && dt.row)
      .map((dt) => ({ dt, d: Math.hypot(dt.cx - vx, dt.cy - vy) }))
      .filter((h) => h.d <= TAP_R)
      .sort((a, b) => a.d - b.d);
    if (!hits.length) { setMenu(null); return; }
    if (hits.length === 1) { setMenu(null); onPickPlayer(hits[0].dt.row); return; }
    // Several players under one finger — ask rather than guess. Anchored at the
    // tap and clamped so the list stays on the card.
    setMenu({
      left: Math.max(4, Math.min(96, vx)),
      top: (Math.max(0, Math.min(height, vy)) / height) * 100,
      flip: vy > height * 0.55,
      items: hits.slice(0, 6).map((h) => h.dt),
    });
  };

  const [segX, segY] = [segData[xi], segData[yi]];
  const selSeg = collapsed ? segData[selIdx] : null;
  // Value-added color band, matching the bars: green above +0.05, red below
  // −0.05, grey in the neutral middle.
  const vaColor = (v) => (v > 0.05 ? "text-green-600" : v < -0.05 ? "text-red-600" : "text-stone-400");
  const label = collapsed
    ? `${selSeg.sub} value added — ${name} at ${sgn(me[selIdx])} against ${scatter.n} qualified players`
    : `${segY.sub} against ${segX.sub} value added — ${name} at ${sgn(me[xi])} ${segX.sub}, ${sgn(me[yi])} ${segY.sub}, among ${scatter.n} qualified players`;

  return (
    <>
      {/* No axis titles on the plot itself — a corner label lands right where
          the extremes of the other axis sit. The chips below name both axes
          and carry the arrow of the one they own. */}
      {/* Headroom for the reference line's label, so it sits clear of the plot
          rather than on top of the dots. */}
      <div className={`relative mt-1 ${view.ref ? "pt-3" : ""}`}>
        {view.ref && refLine.label && (
          <div
            className={`absolute text-[7px] leading-none font-semibold text-stone-500 whitespace-nowrap pointer-events-none ${view.ref.vertical ? "-translate-y-full" : "-translate-x-1/2"}`}
            style={{ left: `${view.ref.left}%`, top: view.ref.vertical ? `${view.ref.top}%` : 0 }}
            title={refLine.title || undefined}
          >
            {refLine.label}
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 100 ${height}`}
          className="w-full block overflow-visible touch-manipulation"
          onClick={handleTap}
          role="img"
          aria-label={`${label}. Tap a grey dot to open that player; the ranking table above lists the same players as buttons.`}
        >
          {/* League baseline — where the stat is worth exactly nothing. */}
          {view.guides.map((g, i) => (
            <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#e7e5e4" strokeWidth="0.4" />
          ))}
          {view.dots.filter((dt) => !dt.self).map((dt, i) => (
            <circle key={i} cx={dt.cx} cy={dt.cy} r={view.r} fill="#d6d3d1" fillOpacity="0.8" />
          ))}
          {/* Reference line, drawn over the cloud so it reads against it. */}
          {view.ref && (
            <line
              x1={view.ref.line.x1} y1={view.ref.line.y1} x2={view.ref.line.x2} y2={view.ref.line.y2}
              stroke="#57534e" strokeWidth="0.4" strokeDasharray="2 1.5" strokeOpacity="0.8"
            />
          )}
          {/* Guides dropping the player's point onto the axes, so the chips
              below read as the coordinates of the black dot. */}
          {!collapsed && (
            <>
              <line x1={view.self.cx} y1={view.self.cy} x2={view.self.cx} y2={height} stroke="#1c1917" strokeWidth="0.25" strokeDasharray="1.5 1.5" strokeOpacity="0.45" />
              <line x1={view.self.cx} y1={view.self.cy} x2="0" y2={view.self.cy} stroke="#1c1917" strokeWidth="0.25" strokeDasharray="1.5 1.5" strokeOpacity="0.45" />
            </>
          )}
          <circle cx={view.self.cx} cy={view.self.cy} r="2.4" fill="#fff" />
          <circle cx={view.self.cx} cy={view.self.cy} r="1.5" fill="#1c1917" />
        </svg>
        {menu && (
          // Disambiguation menu: one tap landed on several players, so name
          // them and let the next tap choose. Anything else dismisses.
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} aria-hidden />
            <div
              className={`absolute z-20 ${menu.flip ? "-translate-y-full -mt-2" : "mt-2"} ${menu.left > 60 ? "-translate-x-full" : ""}`}
              style={{ left: `${menu.left}%`, top: `${menu.top}%` }}
            >
              <div className="min-w-[7.5rem] rounded-sm border border-stone-300 bg-white shadow-md overflow-hidden">
                <div className="px-1.5 py-0.5 text-[7px] uppercase tracking-wider text-stone-400 border-b border-stone-100">{menu.items.length} players here</div>
                {menu.items.map((dt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setMenu(null); onPickPlayer(dt.row); }}
                    className="w-full flex items-baseline justify-between gap-2 px-1.5 py-1 text-left hover:bg-stone-100 focus-visible:outline-none focus-visible:bg-stone-100"
                  >
                    <span className="truncate text-[9px] font-medium text-stone-800">{dt.row.name}</span>
                    <span className="shrink-0 text-[8px] tabular-nums text-stone-500">{collapsed ? sgn(dt.v[selIdx]) : `${sgn(dt.v[yi])} / ${sgn(dt.v[xi])}`}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      {/* Stat chips — the selectors the bars used to be. Each carries the
          player's rate (black) and his value added, and the two axis chips are
          flagged with the arrow of the axis they own. */}
      <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${segData.length}, minmax(0, 1fr))` }}>
        {segData.map((seg, i) => {
          const isSel = selectedSeg === seg.key;
          const shown = Math.abs(seg.selfV) < 0.005 ? 0 : seg.selfV;
          const axis = i === xi ? "→" : i === yi ? "↑" : null;
          return (
            <button
              key={seg.key}
              type="button"
              onClick={() => onSelect(seg.key)}
              aria-pressed={isSel}
              title={`${seg.cat || seg.sub} — ${isSel ? "back to the scatter" : "collapse the plot onto this stat and filter the card"}`}
              className={`flex flex-col items-center gap-0.5 min-w-0 rounded px-1 py-1 border transition-colors ${isSel ? "bg-stone-200 border-stone-800 ring-1 ring-stone-800" : "bg-white border-stone-200 hover:bg-stone-100"}`}
            >
              <span className="text-[7px] uppercase tracking-wide text-stone-400 leading-none">{seg.sub}{axis && !collapsed ? ` ${axis}` : ""}</span>
              <span className="text-[11px] font-bold text-stone-900 tabular-nums leading-none">{seg.head == null ? "–" : seg.head}</span>
              <span className={`text-[8px] font-semibold tabular-nums leading-none ${vaColor(shown)}`}>{sgn(shown)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}


// League context for one category of one player-season (By-Player search only).
// Everything is computed from the /api/players index passed in via `context`:
//   poolsBySeason  Map<season, row[]>  every player-season, grouped by season
//   allRows        row[]               every player-season, flat (all-time pool)
//   self           the player object   (name, slug, seasons[]) for identity/trend
// The ranking metric is per-game category VA so longevity doesn't dominate a
// per-game breakdown; the >=1/3-GP floor guards against tiny-sample outliers.
export function CategoryContext({ p: pProp, catKey, lga, rateMode, context, defs = null, defActive = false, defScope = "rs" }) {
  // The pools below are scored season by season, so they need the same
  // baseline getter the card above them was handed (lib/va-mode.js) — a rank
  // computed against the standard baseline under a USG-ADJ card would be a
  // different statistic from the value it ranks.
  const lgaFor = useLgaFor();
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

  // Tapping a bar in the by-season trend (View 6) arms a "Go →" popup for that
  // season. Unlike the mini leaderboard above — which re-points the card in
  // place — this navigates the page itself to that player-season (the By
  // Season leaderboard switches season/team and opens the row; By Player opens
  // the season). That's a big enough jump to gate behind the same two-step
  // confirmation the compare panel's compared-player chip uses; useGatedGo
  // owns the shared mechanics.
  const seasonGo = useGatedGo();

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
  // Split filter. Tapping a bar in View 2 scopes the WHOLE card — season
  // leaderboard, all-time board, and the by-season trend — to that single
  // component's value added (one shot distance, or one stat) instead of the
  // rolled-up category. null = the normal rolled-up view.
  const [selectedSeg, setSelectedSeg] = useState(null);
  // When VA+ is the active metric, the Defense drill-in folds D Rating into
  // every ranking/percentile/all-time/trend figure — so the context matches
  // the Defense group's VA+ total (Blocks + Steals + D Rating), not just the
  // two box-score stocks. Only the Defense group carries it; individual
  // Blocks/Steals drill-ins stay pure box-score VA.
  const withDef = defActive && catKey === "Defense" && !!defs;

  // Made/attempted (FG%) label honoring the card's /G toggle: per-game to one
  // decimal when on (matching the per-game VA values), whole-season totals when
  // off. The FG% is scale-invariant, so it's unchanged either way.
  const maLabel = (made, att, gp) => {
    const pct = att > 0 ? ((made / att) * 100).toFixed(1) : "0.0";
    return perGame
      ? `${(made / (gp || 1)).toFixed(1)}/${(att / (gp || 1)).toFixed(1)} (${pct}%)`
      : `${made}/${att} (${pct}%)`;
  };

  // Split breakdown. Every "Basic" group card swaps the single percentile strip
  // for a row of vertical value-added bars — one per component of the group —
  // so the reader sees WHERE the group's value comes from:
  //   Scoring     the six shot distances (FT · rim / floater / mid / deep mid ·
  //               3PT), or its four scoring categories when the season has no
  //               shot-location bake
  //   2-Pointers  its four 2-point distances
  //   Passing     Assists · Turnovers
  //   Rebounds    D Rebounds · O Rebounds
  //   Defense     Blocks · Steals (· D Rating, when VA+ is the active metric)
  // Each bar is a value-added distribution strip against the same season field
  // the rankings above use, headlined by the player's own rate at that
  // component and labeled with his value added — so a card's bars sum to the
  // value the rolled-up row already shows, split by where it comes from. A
  // single (non-group) category has nothing to split, so its card skips the
  // section entirely rather than falling back to a lone percentile strip.
  // Defined before `metric` so a selected bar can drive every ranking below;
  // each `val` takes the season's league averages so the all-time/trend
  // rankings stay era-fair.
  //
  // Shot distances are deliberately kept out of the core VA vectors (no
  // shot-location data before 1996-97), which is why the zone split is gated on
  // the season carrying a zoneFG baseline and the player carrying zone attempts.
  const showZones = (catKey === "Scoring" || catKey === "2-Pointers") && !!lga?.zoneFG && hasZoneData(p);
  const SEGMENTS = useMemo(() => {
    if (showZones) {
      // group: "ft" | "2p" | "3p" — drives the section headers and the
      // 2-Pointers-only filter. m/a pull the made/attempted for the FG%
      // headline. dist is the shot-distance range printed under the nickname
      // (2-point zones only — "FT" and "3PT" are distances in themselves).
      // era gates the all-time/trend pools: the four 2-point zones only exist
      // from 1996-97 on, while FT and 3PT are defined every season.
      const zone = (key, sub, group, extra) => ({
        key, sub, group, dist: ZONE_DIST[key],
        era: group === "2p" ? (s) => !!lgaForSeason(s)?.zoneFG : undefined,
        eraNote: group === "2p" ? " with shot-location data (1996-97 on)" : "",
        note: "FG% at that distance",
        head: (r) => (extra.a(r) > 0 ? `${((extra.m(r) / extra.a(r)) * 100).toFixed(0)}%` : null),
        rate: (r) => maLabel(extra.m(r), extra.a(r), r.gp),
        ...extra,
      });
      const all = [
        zone("ft",    "FT",       "ft", { m: (r) => r.ftm || 0,    a: (r) => r.fta || 0,    val: (r, lx = lga) => ((r.ftm / (r.fta || 1)) - lx.laFT) * (r.fta || 0) }),
        zone("z03",   "Rim",      "2p", { m: (r) => r.z03m || 0,   a: (r) => r.z03a || 0,   val: (r, lx = lga) => zoneShotValue(r.z03m || 0, r.z03a || 0, lx.zoneFG?.z03) }),
        zone("z310",  "Float",    "2p", { m: (r) => r.z310m || 0,  a: (r) => r.z310a || 0,  val: (r, lx = lga) => zoneShotValue(r.z310m || 0, r.z310a || 0, lx.zoneFG?.z310) }),
        zone("z1016", "Mid",      "2p", { m: (r) => r.z1016m || 0, a: (r) => r.z1016a || 0, val: (r, lx = lga) => zoneShotValue(r.z1016m || 0, r.z1016a || 0, lx.zoneFG?.z1016) }),
        zone("z16xp", "Deep Mid", "2p", { m: (r) => r.z16xpm || 0, a: (r) => r.z16xpa || 0, val: (r, lx = lga) => zoneShotValue(r.z16xpm || 0, r.z16xpa || 0, lx.zoneFG?.z16xp) }),
        zone("tp",    "3PT",      "3p", { m: (r) => r.tpm || 0,    a: (r) => r.tpa || 0,    val: (r, lx = lga) => 3 * ((r.tpm / (r.tpa || 1)) - lx.la3P) * (r.tpa || 0) }),
      ];
      return catKey === "2-Pointers" ? all.filter((s) => s.group === "2p") : all;
    }
    const grp = VA_GROUP_BY_KEY[catKey];
    if (!grp) return null;
    // One bar per member category. Value added is the category's own VA, so the
    // bars sum to exactly the group row that opened this card. The headline is
    // the player's rate at that stat, on the card's /G toggle — FG% for the
    // shooting categories, the counting rate otherwise.
    const segs = (SEG_ORDER[catKey] || grp.cats).map((cat) => ({
      key: cat, sub: SEG_SUB[cat] || cat, cat,
      note: CAT_SHOOTING[cat] ? "FG%" : `${rateMode === "perG" ? "per-game" : "per-36"} rate`,
      head: (r) => {
        if (CAT_SHOOTING[cat]) {
          const [m, a] = CAT_SHOOTING[cat](r);
          return a > 0 ? `${((m / a) * 100).toFixed(0)}%` : null;
        }
        const v = r[CAT_COUNTING[cat][0]] || 0;
        return perGame ? (v / (r.gp || 1)).toFixed(1) : String(v);
      },
      rate: (r) => (CAT_SHOOTING[cat] ? maLabel(...CAT_SHOOTING[cat](r), r.gp) : catRateLabel(r, cat, rateMode)),
      val: (r, lx = lga) => catVATotal(r, lx, cat),
    }));
    // D Rating is the Defense group's fifth stat whenever VA+ is the active
    // metric — without it the bars would fall short of the row they explain.
    // Rated seasons only (2000-01 on for play-by-play, earlier where the
    // box-score estimate is baked), so it gates the all-time/trend pools.
    if (withDef) {
      segs.push({
        key: "D Rating", sub: SEG_SUB["D Rating"], cat: "D Rating",
        era: (s) => !!defs?.[s],
        eraNote: " with defensive ratings",
        note: "defensive rating",
        head: (r, lx = lga, s = seasonKey) => {
          const dr = defVAInfo(r, r.mp, lx, defs, s, defScope)?.drtg;
          return dr == null ? null : String(Math.round(dr));
        },
        rate: (r, lx = lga, s = seasonKey) => {
          const dr = defVAInfo(r, r.mp, lx, defs, s, defScope)?.drtg;
          return dr == null ? "–" : `${Math.round(dr)} DRTG`;
        },
        val: (r, lx = lga, s = seasonKey) => defVAInfo(r, r.mp, lx, defs, s, defScope)?.dva ?? 0,
      });
    }
    return segs;
  }, [lga, catKey, showZones, perGame, rateMode, withDef, defs, defScope, seasonKey]);
  // The two headline totals over the six shot-distance bars are readings in
  // their own right, so they select exactly like a bar does — the season
  // leaderboard, the all-time board and the by-season trend all re-rank on
  // them. Having no bar of their own is the only thing that sets them apart:
  //   EFF     3P + 2P + FT value added, the scoring rows' shooting value
  //   IMPACT  the six shot-distance values summed
  // EFF is box-score shooting value, defined for every season, so it ranks
  // against the whole index. IMPACT is only as old as shot-location data, so
  // it carries the same era gate the four 2-point zones do.
  const TOTAL_SEGMENTS = useMemo(() => {
    if (!SEGMENTS || !showZones || catKey === "2-Pointers") return null;
    // True shooting — points per shooting possession — is the rate column for
    // both: they are two readings of scoring efficiency, and TS% is the one
    // rate the whole six-distance row is about. (Scale-free, so the card's /G
    // toggle leaves it alone, same as every other FG% on the card.)
    const ts = (r) => {
      const den = 2 * ((r.fga || 0) + 0.44 * (r.fta || 0));
      return den > 0 ? `${(((r.pts || 0) / den) * 100).toFixed(1)}% TS` : "–";
    };
    return [
      {
        key: "eff", sub: "Eff", note: "3P + 2P + FT value added", rate: ts,
        // One valueAddByCategory per row (the same call catVATotal makes),
        // three keys off it — the all-time pool runs to five figures.
        val: (r, lx = lga) => {
          const by = r?.catVA || valueAddByCategory(r, lx);
          return (by["3-Pointers"] || 0) + (by["2-Pointers"] || 0) + (by["Free Throws"] || 0);
        },
      },
      {
        key: "impact", sub: "Impact", note: "the six shot-distance values summed", rate: ts,
        era: (s) => !!lgaForSeason(s)?.zoneFG,
        eraNote: " with shot-location data (1996-97 on)",
        val: (r, lx = lga, s = seasonKey) => SEGMENTS.reduce((t, seg) => t + seg.val(r, lx, s), 0),
      },
    ];
  }, [SEGMENTS, showZones, catKey, lga, seasonKey]);
  // The component the card is currently filtered to (null unless a bar — or
  // one of the two totals — is tapped). Clears itself if the segment list no
  // longer holds the key (e.g. switching from Scoring to 2-Pointers with
  // FT/3PT selected).
  const selSeg = (selectedSeg
    && [...(SEGMENTS || []), ...(TOTAL_SEGMENTS || [])].find((s) => s.key === selectedSeg)) || null;
  // Seasons a filtered card can rank against — everything, unless the selected
  // component only exists for part of league history.
  const segEra = (season) => !selSeg?.era || selSeg.era(season);
  // The selected component's rate, replacing the rolled-up category's rate
  // label in the mini leaderboard while filtered. That board is one season, so
  // the card's own league averages apply to every row on it.
  const segRateLabel = (r) => selSeg.rate(r, lga, seasonKey);

  // The metric the entire card ranks and displays on, respecting the toggle
  // (and folding in each row's D Rating when withDef). When a bar in the split
  // row is selected it becomes that component's value added instead — same
  // per-game / total treatment as the rolled-up category.
  const metric = (r, lgaX, seasonOf = seasonKey) => {
    if (selSeg) {
      // A component the season predates (a 2-point zone before 1996-97, a
      // defensive rating before the bake) has no league baseline; treat it as
      // no value rather than comparing against a 0% league FG%.
      if (!segEra(seasonOf)) return 0;
      const v = selSeg.val(r, lgaX, seasonOf);
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
  // Same selector as the scope buttons at the top of the page, for the ranking
  // header (the card already names the player and season above, so the header
  // says WHICH pool the rank is against instead of repeating them). Combined
  // abbreviates "Regular Season" — spelled out it wraps to two lines beside the
  // rank on a phone.
  const scopeTitle = context.scope === "regular" ? "Regular Season"
    : context.scope === "combined" ? "Reg Seas & Playoffs" : "Playoffs";
  // Which baseline this pool's rows are scored against (spec §4.8). A playoff
  // pool is playoff lines and takes the blended playoff baseline; the other two
  // stay on the regular season. Combined rows are a summed regular season plus
  // playoff run whose minute split the pooled index does not carry, so they are
  // ranked on the regular-season baseline — every row in the pool the same way,
  // which is what a ranking needs, even though the board they came from prices
  // each row's own mix (scoring.js::combinedLga).
  const poolScope = context.scope === "playoffs" ? "po" : "rs";

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
    let lo = Math.max(0, selfIdx - 2), hi = Math.min(N, lo + 5); lo = Math.max(0, hi - 5);
    const win = pool.slice(lo, hi).map((x, i) => ({ ...x, rank: lo + i + 1 }));

    // All-time (view 4): every player-season, season-accurate baselines. When
    // a 2-point distance is selected, seasons without shot-location data drop
    // out (their zone value is undefined, not zero).
    const floorA = Math.min(5, p.gp || 1);
    const all = allRows
      .filter((r) => (r.gp || 0) >= floorA && r.mp > 0 && segEra(r.season))
      .map((r) => ({ r, m: metric(r, lgaFor(r.season, poolScope), r.season) }))
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
        const lgaS = lgaFor(s.season, poolScope);
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
        // team rides along so a tapped bar can hand the navigation target a
        // complete player-season (season + team + identity).
        return { season: s.season, team: s.team || null, m, rank, poolN: seasonPool.length };
      });

    return { floor, N, rank: selfIdx + 1, win,
             floorA, allN, allRank: allIdx + 1, top, selfAll, mine };
  }, [seasonKey, p.gp, catKey, poolsBySeason, allRows, self, lga, lgaFor, selfRow, perGame, withDef, defScope, selSeg]);

  const segData = useMemo(() => {
    if (!SEGMENTS) return null;
    // Same season field and ≥1/3-GP floor as the ranking pool above.
    const floor = Math.max(1, Math.ceil((p.gp || 1) / 3));
    const pool = (poolsBySeason.get(seasonKey) || []).filter((r) => (r.gp || 0) >= floor && r.mp > 0);
    const N = pool.length;
    return SEGMENTS.map((seg) => {
      const per = (r) => { const v = seg.val(r, lga, seasonKey); return perGame ? v / (r.gp || 1) : v; };
      const vals = pool.map(per).sort((a, b) => a - b);
      const selfV = per(selfRow);
      const min = N ? vals[0] : 0, max = N ? vals[N - 1] : 0, med = N ? vals[Math.floor(N / 2)] : 0;
      // The player's own rate at this component (null when there's nothing to
      // show — never shot from here, no rating — so it reads "–" rather than a
      // misleading 0%).
      const head = seg.head(selfRow, lga, seasonKey);
      return { ...seg, selfV, min, max, med, head };
    });
  }, [SEGMENTS, poolsBySeason, seasonKey, p.gp, selfRow, perGame, lga]);

  // Scatter plot — the split row's form for the three two-stat groups. A
  // Passing card's two bars are really one relationship (the creator's
  // trade-off: more assists, more turnovers), and a bar apiece can't show it.
  // So Passing / Rebounds / Defense plot their first two components against
  // each other instead: every qualified player in the season in grey, the
  // card's player in black, crosshair at the league baseline. Scoring is left
  // on bars — six shot distances (or four scoring categories pre-1996-97)
  // aren't two axes — and so is the 2-Pointers card.
  //
  // Axes are value added, on the card's /G toggle, exactly like everything else
  // here: that puts the league baseline at the origin and makes up-and-right
  // unambiguously better on both axes (fewer turnovers = positive TOV value).
  // The chips below carry the underlying rates, so nothing is lost. Defense's
  // third component under VA+ (D Rating) has no axis to sit on — it stays a
  // chip, and the caption says it's in the total but not on the plot.
  const SCATTER_H = 58; // viewBox height; width is a fixed 100 so dots stay round
  const axisKeys = SCATTER_AXES[catKey] || null;
  const scatter = useMemo(() => {
    if (!segData || !axisKeys || segData.length < 2) return null;
    const floor = Math.max(1, Math.ceil((p.gp || 1) / 3));
    const pool = (poolsBySeason.get(seasonKey) || []).filter((r) => (r.gp || 0) >= floor && r.mp > 0);
    const per = (seg, r) => { const v = seg.val(r, lga, seasonKey); return perGame ? v / (r.gp || 1) : v; };
    // A value per segment for every player, so the scatter, either collapsed
    // dot plot, and the disambiguation menu all read off one pass.
    const rows = pool
      .filter((r) => !samePlayer(r, selfRow))
      .map((r) => ({ row: r, v: segData.map((s) => per(s, r)) }));
    const me = segData.map((s) => s.selfV);
    // Always include the origin so the baseline is on-plot, and always the
    // player's own point so he can't fall outside his own chart.
    const extent = (vals, mine) => {
      const lo = Math.min(0, mine, ...vals), hi = Math.max(0, mine, ...vals);
      const pad = (hi - lo) * 0.08 || 1;
      return [lo - pad, hi + pad];
    };
    return {
      rows, me, n: pool.length,
      ranges: segData.map((s, i) => extent(rows.map((q) => q.v[i]), me[i])),
    };
  }, [segData, axisKeys, poolsBySeason, seasonKey, p.gp, selfRow, perGame, lga]);
  // Where the player's own team defense falls on the collapsed D Rating plot.
  // That plot's axis is value ADDED, not rating, so the team enters it as the
  // value this player would post if he rated exactly as his team does: his edge
  // over the team is zero and all that's left is his share of the team's edge
  // vs league (see defVAInfo). It's the line that separates "better than his
  // own team's defense" from "worse" — right of it, he out-defends his team.
  // Absent for multi-team (2TM) rows and seasons with no team map, where the
  // rating carries no team term to draw.
  const teamRefLine = useMemo(() => {
    if (!selSeg || selSeg.key !== "D Rating") return null;
    const info = defVAInfo(selfRow, selfRow.mp, lga, defs, seasonKey, defScope);
    if (!info || info.w == null || info.teamDrtg == null || !(lga?.laPOSSperM > 0)) return null;
    const v = ((info.w * (info.laDRtg - info.teamDrtg)) / 100) * lga.laPOSSperM * selfRow.mp;
    const drtg = Math.round(info.teamDrtg);
    return {
      v: perGame ? v / (selfRow.gp || 1) : v,
      drtg,
      team: selfRow.team || null,
      weighted: info.teamW < DEF_TEAM_NOTE_W ? (selfRow.gp || selfRow.g || 0) : 0,
      label: `${selfRow.team || "TEAM"} ${drtg}`,
      title: `The team defense ${self.name} is measured against (${drtg} DRTG vs ${info.laDRtg.toFixed(1)} league) — he lands right of this line when he defends better than it${teamLineNote(info, selfRow.team)}`,
    };
  }, [selSeg, selfRow, lga, defs, seasonKey, defScope, perGame, self.name]);

  // Which segment sits on which axis, and which one the card is filtered to
  // (−1 when the plot is showing both). Defense's D Rating chip is on neither
  // axis, so a selection of it matches neither index and collapses horizontally.
  const axisIdx = (k, fallback) => {
    const i = scatter ? segData.findIndex((s) => s.key === k) : -1;
    return i >= 0 ? i : (scatter ? fallback : -1);
  };
  const xi = axisIdx(axisKeys?.[0], 0);
  const yi = axisIdx(axisKeys?.[1], 1);
  const selIdx = scatter && selSeg ? segData.findIndex((s) => s.key === selSeg.key) : -1;

  // Headline total(s) for the split row, shown inline with its section heading.
  // Everywhere but the six-bar Scoring card the bars are the group's own
  // categories, so they sum to exactly the row that opened the card: one
  // "Total". The Scoring card gets two, because its bars re-split 2-point value
  // by shot location and a season's zone attempts don't always reconcile with
  // its total 2PA — Efficiency is the scoring-efficiency component of VA
  // (3P + 2P + FT value added, what the three shooting rows sum to) and Impact
  // is the six distance bars summed. The 2-Pointers card is a partial split of
  // one category, so it gets neither.
  const segTotals = useMemo(() => {
    if (!segData || catKey === "2-Pointers") return null;
    // Collapse a value that rounds to zero so a sliver-negative total doesn't
    // read as a red "-0.00" (same treatment the bars get).
    const zeroed = (v) => (Math.abs(v) < 0.005 ? 0 : v);
    const impact = zeroed(segData.reduce((s, seg) => s + seg.selfV, 0));
    if (!showZones) return { total: impact };
    const by = valueAddByCategory(selfRow, lga);
    const eff = (by["3-Pointers"] || 0) + (by["2-Pointers"] || 0) + (by["Free Throws"] || 0);
    const scale = perGame ? (selfRow.gp || 1) : 1;
    return { efficiency: zeroed(eff / scale), impact };
  }, [segData, catKey, showZones, selfRow, lga, perGame]);

  const short = CAT_SHORT[catKey] || catKey;
  // While a bar in the split row is selected, every heading/column reads as
  // that component ("RIM", "AST") instead of the rolled-up category.
  const metricLabel = selSeg ? selSeg.sub.toUpperCase() : short;
  // Heading for the split row, naming what the card is divided by — the two
  // plotted axes on a scatter, the kind of split otherwise.
  const segHeading = showZones
    ? (catKey === "2-Pointers" ? "2-Pointers · by distance" : "Scoring · by shot distance")
    : scatter ? (selIdx >= 0 ? `${catKey} · ${segData[selIdx].sub} spread` : `${catKey} · ${segData[yi].sub} vs ${segData[xi].sub}`)
    : `${catKey} · by stat`;
  // Total VA is a whole-season figure, so one decimal (matches the leaderboard);
  // per-game figures are an order of magnitude smaller, so show two.
  const sgn = (v, dp = perGame ? 2 : 1) => (v > 0 ? "+" : "") + v.toFixed(dp);
  const mpg = (r) => ((r.mp || 0) / (r.gp || 1)).toFixed(1);

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

  // Trend bars navigate only when the parent handed the card a navigation
  // handler — the same context.onNavigateToPlayer the compare chip uses. The
  // bar for the season you're already reading isn't a target; when the card is
  // focused on another player, though, every one of THEIR seasons is elsewhere,
  // current one included.
  const canGoSeason = !!context?.onNavigateToPlayer;
  const goToSeason = (x) => context.onNavigateToPlayer({
    season: x.season,
    team: x.team || (focused ? p.team : null) || null,
    name: self.name,
    slug: self.slug || null,
  });
  // Never leave a bar armed after the chart underneath it has changed.
  useEffect(() => {
    seasonGo.disarm();
  }, [seasonGo.disarm, self.name, self.slug, catKey, seasonKey, perGame, selectedSeg, focused]);

  // Card owner identity, for the "tapped the owner's own row → go back" check.
  const ownerRow = { name: ownerSelf?.name, slug: ownerSelf?.slug || null };
  const rowGrid = "grid grid-cols-[1.4rem_1fr_1.4rem_2rem_2.9rem_3.6rem] gap-x-1 items-center px-1 py-[2px] tabular-nums";
  // The all-time pool runs to five figures, and a fixed rank track lets
  // "19040" run straight into the name beside it. Size the track to the
  // longest rank the board actually prints — shared by every row, so the
  // names stay flush with each other whatever the widths work out to.
  const allRankChars = Math.max(
    1,
    ...(d?.top || []).map((x) => String(x.rank).length),
    d?.selfAll ? String(d.selfAll.rank).length : 1,
  );
  // ~0.36rem a digit at this size plus a constant of slack, which lands on the
  // stock 1.4rem for the three-digit ranks the season boards print and grows
  // from there, so short ranks look exactly as they always have.
  const allRowGrid = { gridTemplateColumns: `${Math.max(1.4, allRankChars * 0.36 + 0.3).toFixed(2)}rem 1fr 2.9rem` };
  const Row = ({ rank, r, m, isSelf }) => {
    const cells = (
      <>
        <span className="text-right text-[9px] opacity-70">{rank}</span>
        {/* First initial + surname ("S. Gilgeous-Alexander"). The name column
            is the only elastic one in a six-column row, and full given names
            were truncating mid-word on a phone; the initial still separates
            same-surname players. Full names stay in the aria-label below. */}
        <span className="truncate text-[10px] font-medium" title={r.name}>{compName(r.name)}</span>
        <span className="text-right text-[9px]">{r.gp}</span>
        <span className="text-right text-[9px]">{mpg(r)}</span>
        <span className={`text-right text-[10px] font-semibold ${!isSelf && m < 0 ? "text-red-600" : ""}`}>{sgn(m)}</span>
        <span className={`text-right text-[9px] ${isSelf ? "text-stone-200" : "text-stone-500"}`}>{selSeg ? segRateLabel(r) : CAT_SHOOTING[catKey] ? maLabel(...CAT_SHOOTING[catKey](r), r.gp) : catRateLabel(r, catKey, rateMode)}</span>
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
  // all-time, trend, and shown values). The same control the compare panel
  // carries — see PerGameToggle.
  const gToggle = (
    <PerGameToggle
      perGame={perGame}
      onToggle={() => setPerGame((v) => !v)}
      title={perGame ? "Ranking and values shown per game — tap for season totals" : "Rank and show values per game instead of season totals"}
    />
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
        <div className="text-[8px] italic text-stone-400 mt-0.5 px-1 leading-[1.3] min-h-[2.6em]">Ranked by {perGame ? "per-game" : "total"} {metricLabel} VA among {scopeNoun} players with ≥{d.floor} G ({selSeg ? `${metricLabel} = ${selSeg.note}` : `${short} = ${rateMode === "perG" ? "per-game" : "per-36"} rate`}) · tap a player for their card.</div>
      </div>

      {/* View 2 — the split row. Every Basic group card fans its total out into
          one value-added bar per component so the reader sees WHERE the value
          comes from: Scoring by shot distance (FT · four 2-point zones · 3PT,
          or its four scoring categories when the season has no shot-location
          bake), Passing into AST/TOV, Rebounds into DRB/ORB, Defense into
          BLK/STL (+ D Rating on VA+). Each bar is a value-added distribution
          strip headlined by the player's own rate. A single category has
          nothing to split — apart from 2-Pointers, which still divides into its
          four distances — so those cards skip the section. */}
      {segData && (
        <div className="border-t border-stone-100 pt-2">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="uppercase tracking-wider text-[9px] text-stone-400 truncate">{segHeading}</span>
            <div className="shrink-0 flex items-baseline gap-2">
              {segTotals && (segTotals.total != null ? (
                <span
                  className="uppercase tracking-wider text-[8px] text-stone-400 whitespace-nowrap"
                  title={`${catKey} value added${perGame ? " per game" : ""} — the bars below, summed`}
                >
                  Total <span className={`text-[9px] font-bold tabular-nums ${segTotals.total > 0.05 ? "text-green-600" : segTotals.total < -0.05 ? "text-red-600" : "text-stone-500"}`}>{sgn(segTotals.total)}</span>
                </span>
              ) : (
                // Both totals SELECT, the same way a distance bar does: the
                // whole card — season leaderboard, all-time board, trend —
                // re-ranks the league on that reading. Same pressed styling
                // the bars wear, so it's clear they're the same control.
                <>
                  {[
                    { key: "eff", label: "Eff", v: segTotals.efficiency, title: `Efficiency — 3-point + 2-point + free-throw value added${perGame ? " per game" : ""} (the scoring rows' shooting value)` },
                    { key: "impact", label: "Impact", v: segTotals.impact, title: `Relative impact — the six shot-distance values below, summed${perGame ? " (per game)" : ""}` },
                  ].map((t) => {
                    const isSel = selectedSeg === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setSelectedSeg(isSel ? null : t.key)}
                        aria-pressed={isSel}
                        title={`${t.title} — tap to rank the card on it`}
                        className={`uppercase tracking-wider text-[8px] whitespace-nowrap rounded px-1 -mx-0.5 py-0.5 -my-0.5 transition-colors ${isSel ? "bg-stone-200 ring-1 ring-stone-800 text-stone-700" : "text-stone-400 hover:bg-stone-100"}`}
                      >
                        {t.label} <span className={`text-[9px] font-bold tabular-nums ${t.v > 0.05 ? "text-green-600" : t.v < -0.05 ? "text-red-600" : "text-stone-500"}`}>{sgn(t.v)}</span>
                      </button>
                    );
                  })}
                </>
              ))}
              {selSeg && (
                <button
                  type="button"
                  onClick={() => setSelectedSeg(null)}
                  className="normal-case tracking-normal text-[9px] text-stone-400 hover:text-stone-700"
                >
                  {metricLabel} ✕
                </button>
              )}
            </div>
          </div>
          {scatter ? (
            <ScatterSplit
              key={`${catKey}:${selectedSeg || ""}:${self.slug || self.name}`}
              scatter={scatter}
              segData={segData}
              height={SCATTER_H}
              xi={xi}
              yi={yi}
              selIdx={selIdx}
              selectedSeg={selectedSeg}
              onSelect={(k) => setSelectedSeg(selectedSeg === k ? null : k)}
              onPickPlayer={(r) => setFocusRow(samePlayer(r, ownerRow) ? null : r)}
              sgn={sgn}
              name={self.name}
              refLine={teamRefLine}
            />
          ) : (
          <>
          {/* Section headers spanning their bars: FT · 2-Pointers (×4) · 3PT.
              Only the six-bar Scoring card needs them — every other split is
              all one section, so its per-bar sub-labels are enough. */}
          {showZones && catKey !== "2-Pointers" && (
            <div className="grid grid-cols-6 gap-1 text-[7px] uppercase tracking-wider text-stone-400">
              <div className="col-span-1 text-center">FT</div>
              <div className="col-span-4 text-center border-x border-stone-200">2-Pointers</div>
              <div className="col-span-1 text-center">3PT</div>
            </div>
          )}
          {/* One equal column per bar (2 to 6). A two- or three-bar split gets
              its columns capped near the width the six-bar shooting card uses
              and the row centered, so an AST/TOV pair reads as the same chart
              rather than two lonely strips stretched across the card. */}
          <div
            className="grid gap-1 items-start mt-1 mx-auto"
            style={{
              gridTemplateColumns: `repeat(${segData.length}, minmax(0, 1fr))`,
              maxWidth: segData.length < 4 ? `${segData.length * 28}%` : undefined,
            }}
          >
            {segData.map((seg) => {
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
              const isSel = selectedSeg === seg.key;
              return (
                <div
                  key={seg.key}
                  onClick={() => setSelectedSeg(isSel ? null : seg.key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedSeg(isSel ? null : seg.key); } }}
                  aria-pressed={isSel}
                  title={`${seg.cat || seg.sub}${seg.dist ? ` (${seg.dist})` : ""} — filter the card to this ${seg.group ? "distance" : "stat"}`}
                  className={`flex flex-col items-center min-w-0 cursor-pointer rounded py-1 -my-1 transition-colors ${isSel ? "bg-stone-200 ring-1 ring-stone-800" : "hover:bg-stone-100"}`}
                >
                  {/* The player's own rate at this component — FG% for a shot
                      distance or a shooting category, the counting rate (on the
                      card's /G toggle) otherwise. */}
                  <span className="text-[10px] font-bold text-stone-800 tabular-nums leading-none">{seg.head == null ? "–" : seg.head}</span>
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
          </>
          )}
          <div className="text-[8px] italic text-stone-400 mt-1.5 px-1 leading-[1.3]">
            {scatter
              ? `Every ${scopeNoun} player with ≥${d.floor} G this season in grey, ${shortName(self.name)} in black — tap a dot to open that player · ${selIdx >= 0 ? `each column is the count at that ${segData[selIdx].sub} value, mirrored` : "axes"} = ${perGame ? "per-game" : "total"} value added, line = the league baseline${teamRefLine ? `, dashed = the ${teamRefLine.team || "team"} defense he is held to at ${teamRefLine.drtg} DRTG${teamRefLine.weighted ? ` (their season line weighted for his ${teamRefLine.weighted} G)` : ""} (right of it he out-defends it)` : ""} · tap a stat to ${selIdx >= 0 ? "go back to the scatter" : "collapse the plot onto it and filter the card"}. Total = the ${segData.length} stats summed — the ${catKey} row above${segData.length > 2 ? ", including the D Rating chip (no axis of its own)" : ""}.`
              : <>Top = {showZones ? "FG%" : "rate"} · bar = {perGame ? "per-game" : "total"} value added {showZones ? "vs. league FG% at each distance" : "at each stat"} among the {scopeNoun} field (dot = player, tick = median) · number below = value added · tap a {showZones ? "distance" : "stat"} to filter the card.{segTotals?.total != null ? ` Total = the ${segData.length} bars summed — the ${catKey} row above.` : segTotals ? " Eff = 3P + 2P + FT value added; Impact = the six bars summed — tap either to rank the card on it." : ""}</>}
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
          <div key={"t" + x.rank} style={allRowGrid} className={`grid gap-x-1 items-center px-1 py-[2px] tabular-nums ${d.selfAll && x.rank === d.selfAll.rank ? "bg-stone-800 text-white rounded-sm" : "text-stone-600"}`}>
            <span className="text-right text-[9px] opacity-70">{x.rank}</span>
            <span className="truncate text-[10px]" title={x.r.name}>{compName(x.r.name)} <span className="opacity-60">{x.r.season}</span></span>
            <span className="text-right text-[10px] font-semibold">{sgn(x.m)}</span>
          </div>
        ))}
        {d.selfAll && d.allRank > 3 && (
          <>
            <div className="text-center text-stone-300 leading-none">⋯</div>
            <div style={allRowGrid} className="grid gap-x-1 items-center px-1 py-[2px] tabular-nums bg-stone-800 text-white rounded-sm">
              <span className="text-right text-[9px] opacity-70">{d.selfAll.rank}</span>
              <span className="truncate text-[10px]" title={d.selfAll.r.name}>{compName(d.selfAll.r.name)} <span className="opacity-60">{d.selfAll.r.season}</span></span>
              <span className="text-right text-[10px] font-semibold">{sgn(d.selfAll.m)}</span>
            </div>
          </>
        )}
        <div className="text-[8px] italic text-stone-400 mt-0.5 px-1">Across all {d.allN} indexed {scopeNoun} seasons (≥{d.floorA} G){selSeg?.eraNote || ""}.</div>
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
                // Where you already are — marked, not a link to itself.
                const isHere = !focused && x.season === seasonKey;
                const navigable = canGoSeason && !isHere;
                const isArmed = seasonGo.isArmed(x.season);
                // Popup anchor: columns cap at 10% of the row, so a short
                // career sits entirely on the left. Keep the popup inside the
                // card by left-aligning it near the left edge and
                // right-aligning it near the right, centering it in between.
                const frac = (i + 0.5) * Math.min(1 / d.mine.length, 0.1);
                const anchor = frac < 0.2 ? "left-0" : frac > 0.8 ? "right-0" : "left-1/2 -translate-x-1/2";
                return (
                  <div key={x.season} className="flex-1 relative min-w-0" style={{ maxWidth: "10%" }} title={`${x.season}: ${sgn(x.m)}${topRank ? ` · #${topRank} in league` : ""}${navigable ? " · tap to open" : ""}`}>
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
                    {navigable && (
                      // Full-column tap target laid over the bar (a sibling of
                      // the popup, not its parent — the popup carries its own
                      // button and buttons can't nest).
                      <button
                        type="button"
                        onClick={() => seasonGo.arm(x.season)}
                        aria-label={`${self.name} ${x.season}, ${metricLabel} value added ${sgn(x.m)} — tap to confirm opening it`}
                        aria-expanded={isArmed}
                        className={`absolute inset-0 rounded-sm cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500 ${isArmed ? "bg-stone-900/10" : "hover:bg-stone-900/5"}`}
                      />
                    )}
                    {isArmed && (
                      // The gate: the armed bar raises this popup, and only its
                      // "Go →" navigates. Anything else disarms (useGatedGo
                      // swallows that tap, so it can't also open a row).
                      // It hangs BELOW the bar (over the year labels, which it
                      // restates) rather than above it — there's only the
                      // header gap up there, and covering the section title
                      // reads worse than covering three axis ticks.
                      <div className={`absolute top-full mt-1 z-20 ${anchor}`}>
                        <span
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 py-[2px] shadow-sm"
                          style={{ backgroundColor: GOLD_BG, border: `1px solid ${withAlpha(GOLD, 0.5)}` }}
                        >
                          <span className="text-[9px] font-semibold tabular-nums text-stone-700">{x.season}</span>
                          {x.team && (
                            <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: teamColor(x.team) }}>{x.team}</span>
                          )}
                          <span className={`text-[9px] font-semibold tabular-nums ${x.m < 0 ? "text-red-600" : "text-stone-700"}`}>{sgn(x.m)}</span>
                          <button
                            ref={seasonGo.goRef}
                            type="button"
                            onClick={() => seasonGo.confirm(() => goToSeason(x))}
                            className="text-[9px] font-semibold inline-flex items-center gap-0.5 rounded-sm bg-stone-900 text-white px-1.5 py-[1px] hover:brightness-125 touch-manipulation"
                            title={`Open ${self.name} ${x.season}`}
                          >
                            Go <span aria-hidden>→</span>
                          </button>
                        </span>
                      </div>
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
            {canGoSeason && (
              <div className="text-[8px] italic text-stone-400 mt-1 px-1">Tap a season, then <span className="font-semibold not-italic">Go →</span>, to open that {focused ? `${shortName(self.name)} ` : ""}season.</div>
            )}
          </>
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
