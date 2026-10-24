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
import { GROUP_STAT, VA_CATEGORY_ORDER, VA_GROUPS, VA_PARTITIONS_AFTER, catVATotal, groupOfCat } from "../lib/va";
import { useLgaFor, usgAdjRows } from "../lib/va-mode";
import { useCompareReport } from "../lib/share-state";
import { useSeasonSoFar } from "../lib/season-so-far";
import { CategoryContext } from "./category-context";
import { AwardBoxes } from "./award-boxes";


export function VABreakdown({ p: pSeries, lga = LGA, rsLga = null, teams = TEAMS, rate = false, gameNumber, gameSeries, byGame, gameContext, partitions, onPrev, onNext, useTeamColor = false, breakdownTitle, gameTileLabel = "Game", enableSeriesDrill = false, regularSeasonTotals = null, playerConf = null, context = null, season = null, defScope = "rs", showDRating = true, pendingCompare = null, onCompareHandled = null, leadChart = null, singleGame = false, display = null, onDisplayChange = null, seasonSoFar: seasonWant = null }) {
  // Tap a game on the chart to swap in that game's stats. When the chart
  // spans multiple series (playoff leaderboard), tapping is a two-step
  // drill: first tap selects the series the game belongs to (series
  // aggregate), second tap on a game in that series drills into the game.
  const [selectedGame, setSelectedGame] = useState(null);
  const [selectedSeriesIdx, setSelectedSeriesIdx] = useState(null);
  // Tap a category row to swap the spark-line out of total VA and into
  // that category's per-game contribution (e.g. "2-Pointers" → 2P VA in
  // each game). Tap again to clear.
  const [ownCategory, setOwnCategory] = useState(null);
  // "basic" folds the ten categories into the four Scoring/Passing/
  // Rebounding/Defense buckets with summed VA; "detail" is the full list.
  // A `singleGame` card (the Live tab's) is always the full list, headed by
  // its game number and minutes.
  const [ownView, setOwnView] = useState(singleGame ? "detail" : "basic");
  // Per-36 vs per-game normalization for the counting-stat labels (PTS,
  // AST, DRB, etc.). Only meaningful in multi-game series/playoff views;
  // hidden in the single-game drill-in where raw counts are shown.
  const [ownRate, setOwnRate] = useState("perG");
  // A caller that swaps this card's player row in and out (Month Averages,
  // reading another month) can hold the view, category and rate toggles
  // itself — `display` as { view, category, rate } with `onDisplayChange` —
  // so they carry across the swap instead of resetting with the card.
  const toggles = display || { view: ownView, category: ownCategory, rate: ownRate };
  const setDisplay = (next) => {
    if (display) { onDisplayChange?.({ ...display, ...next }); return; }
    if ("view" in next) setOwnView(next.view);
    if ("category" in next) setOwnCategory(next.category);
    if ("rate" in next) setOwnRate(next.rate);
  };
  const selectedCategory = toggles.category;
  const setSelectedCategory = (c) => setDisplay({ category: c });
  const viewMode = toggles.view;
  const switchView = (m) => setDisplay({ view: m, category: null });
  const rateMode = toggles.rate;
  const setRateMode = (r) => setDisplay({ rate: r });
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
  // Baked defensive ratings (the D-Rating category / VA+). Must load before
  // the early returns below — hooks are unconditional.
  const defs = useDefRatings();
  // A single game's card can hold the player's season so far beside it
  // (`seasonSoFar`, { scope, season }: the Live tab's): a tap in the middle
  // half of a section opens that section's league context on his season
  // to date, the same drill-in the season cards open. The edges keep
  // stepping player to player.
  const [seasonCat, setSeasonCat] = useState(null);
  const soFar = useSeasonSoFar(pSeries, seasonWant, !!seasonWant);
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
  // A game that knows its date (a regular-season month's games) is named by
  // it — "Jan 7" — rather than by its place in the run.
  const selectedDate = selectedGame ? gameContext?.[selectedGame - 1]?.dateLabel : null;

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
  // Player nav, on the plain cards only (a box score's — no chart, no
  // league context): a tap on the card's bare surface steps to the player
  // before or after, by which side of the midline it lands. With the season
  // so far to hand, only the outer quarters step; the middle half opens the
  // tapped section's season context (or closes it). Taps on the card's own
  // controls, and anywhere inside the open context, stay theirs.
  const tapNav = !rate && (onPrev || onNext || seasonWant);
  const handleSurfaceTap = (e) => {
    if (e.target.closest("button, a, input, select, [role=button], [data-season-context]")) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    if (seasonWant && x >= 0.25 && x <= 0.75) {
      const group = e.target.closest("[data-va-group]")?.dataset.vaGroup;
      if (group) setSeasonCat(seasonCat === group ? null : group);
      return;
    }
    const go = x < 0.5 ? onPrev : onNext;
    if (go) go();
  };

  return (
    <div className="px-2 py-3 border-t border-stone-200" onClick={tapNav ? handleSurfaceTap : undefined}>
      {/* A chart the caller leads the card with, in the card's accent and
          kept to a phone card's width (Month Averages: VA / game by month). */}
      {leadChart && (
        <div className="max-w-sm mx-auto">
          {typeof leadChart === "function" ? leadChart(accentColor, selectedCategory) : leadChart}
        </div>
      )}
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
              return <span className="italic">{`${ctx?.dateLabel || `Game ${num}`}${opp ? ` vs ${opp}` : ""}`}</span>;
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
            {/* Value Added — label + value inline, no background. While
                comparing, the compared player's figure rides along in gold. */}
            <div className={`flex items-baseline justify-center gap-2 ${vaPlus != null ? "mb-0.5" : "mb-2"}`}>
              <span className="text-[10px] uppercase tracking-widest text-stone-500">Value Added</span>
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
            {/* A single game's card (the box scores') has no use for the
                game / minutes tiles: its row already shows the minutes. */}
            {!singleGame && <div className={`grid gap-2 items-end ${multiGame ? "grid-cols-3" : "grid-cols-2"}`}>
              <div className="flex flex-col justify-end text-center">
                <div className="text-[9px] uppercase tracking-widest text-stone-500 leading-tight">{selectedDate ? "Date" : effectiveGameNumber || singleGame ? gameTileLabel : "Games"}</div>
                <div className="tabular-nums text-base font-semibold text-stone-700">{selectedDate || effectiveGameNumber || (singleGame ? "–" : p.gp || 1)}</div>
                {compare && atSeasonLevel && (
                  <div className="tabular-nums text-[10px] font-semibold rounded-sm mx-auto px-1" style={{ color: cmpPal.ink, backgroundColor: cmpPal.bg }}>{cmpRow.gp || 0}</div>
                )}
              </div>
              <div className="flex flex-col justify-end text-center">
                <div className="text-[9px] uppercase tracking-widest text-stone-500 leading-tight">{singleGame ? "MIN" : "MIN/G"}</div>
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
            </div>}
          </div>
          {rate && gameSeries && gameSeries.length > 0 && (
            <div className="sm:order-1 sm:flex-1">
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
        {!singleGame && <div className="shrink-0 inline-flex items-center border border-stone-300 rounded-sm overflow-hidden text-[9px]">
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
        </div>}
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
          // By Category with league context: any row of a section selects
          // the whole section (Points/2P/3P/FT -> Scoring scatter), the panel
          // opening under its last row. Without context, rows stay single.
          const byGroup = viewMode === "detail" && !!context && atSeasonLevel;
          const tapKey = byGroup ? groupOfCat(c.key) : c.key;
          const group = groupOfCat(c.key);
          const isCatSel = selectedCategory === tapKey || (!!seasonWant && seasonCat === group);
          const sectionEnd = !byGroup || i === activeRows.length - 1 || groupOfCat(activeRows[i + 1].key) !== tapKey;
          const seasonEnd = i === activeRows.length - 1 || groupOfCat(activeRows[i + 1].key) !== group;
          const onCatTap = canSelectCategory && (!c.noDrill || byGroup)
            ? () => setSelectedCategory(isCatSel ? null : tapKey)
            : undefined;
          // Explicit "+" prefix for positive VA contributions so a row's
          // sign is unambiguous at a glance (negatives already get "-"
          // from toFixed). Skipped at exactly 0 to avoid "+0.00".
          const signed = (v, d) => (v > 0 ? "+" : "") + v.toFixed(d);
          return (
            <React.Fragment key={i}>
              <div
                className={`flex items-center gap-2 text-[10px] -mx-1 px-1 ${onCatTap ? "cursor-pointer" : ""} ${isCatSel ? "bg-stone-200" : ""}`}
                data-va-group={group}
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
              {context && atSeasonLevel && isCatSel && sectionEnd && (
                <CategoryContext p={pSeries} catKey={tapKey} lga={lga} rateMode={rateMode} context={context} defs={defs} defActive={dVA != null} defScope={defScope} />
              )}
              {seasonWant && seasonCat === group && seasonEnd && (
                <SeasonSoFarContext soFar={soFar} game={p} catKey={group} scope={seasonWant.scope} defs={defs} defActive={dVA != null} defScope={defScope} />
              )}
              {viewMode === "detail" && VA_PARTITIONS_AFTER.has(c.key) && <div className="my-1 border-t border-stone-200" />}
            </React.Fragment>
          );
        })}
      </div>
      <div className="mt-2 text-center text-[9px] italic text-stone-400">
        Bars show contribution above/below the league baseline ({lga?.usgModel ? "median rates, scoring usage-adjusted" : "median rates"}){context && atSeasonLevel ? ` · tap a ${viewMode === "detail" ? "section" : "category"} for league context` : ""}
        {seasonWant ? ` · tap a section’s middle for his season so far, an edge for the next player` : ""}
      </div>
      </>
      )}
    </div>
  );
}


// Under a single game's section (see `seasonSoFar` above): the player's
// season to date in that section — its VA per game over his games so far —
// over the league-context drill-in every season card opens.
// `game` is the card's own line, marked on the context's split row.
function SeasonSoFarContext({ soFar, game, catKey, scope, defs, defActive, defScope }) {
  const gameRow = useMemo(() => ({ ...game, gp: 1 }), [game]);
  const note = (text) => <div className="py-2 text-[10px] text-stone-500 italic text-center">{text}</div>;
  const scopeNoun = scope === "playoffs" ? "postseason" : "season";
  let body;
  if (!soFar || soFar.loading) body = note("Loading the season so far…");
  else if (!soFar.row) body = note(`No line yet this ${scopeNoun}.`);
  else {
    const { row, context, lga } = soFar;
    const gp = row.gp || 1;
    const perG = catVATotal(row, lga, catKey) / gp;
    body = (
      <>
        <div className="flex items-baseline justify-between gap-2 text-[9px] uppercase tracking-widest text-stone-500">
          <span>So far this {scopeNoun} · {catKey}</span>
          <span className="tabular-nums normal-case tracking-normal">
            <span className={`font-semibold ${perG < 0 ? "text-red-600" : "text-stone-800"}`}>{(perG > 0 ? "+" : "") + perG.toFixed(2)}</span>
            <span className="text-stone-400"> /G · {Math.round(row.gp * 10) / 10} G · {row.team}</span>
          </span>
        </div>
        <CategoryContext p={row} catKey={catKey} lga={lga} rateMode="perG" context={context} defs={defs} defActive={defActive} defScope={defScope} seasonOnly gameRow={gameRow} />
      </>
    );
  }
  return <div data-season-context className="my-1 -mx-1 px-1 py-1 bg-white border border-stone-200">{body}</div>;
}


export function VACategoryBreakdown({ player: p, lga, context = null, baseline = null, showDRating = true, pendingCompare = null, onCompareHandled = null }) {
  const [rateMode, setRateMode] = useState("perG");
  const [openCat, setOpenCat] = useState(null);
  // "basic" folds the ten categories into Scoring/Passing/Rebounding/Defense.
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
    <div className="px-2 py-2 bg-stone-50 border-t border-stone-100 tilt:flex tilt:items-start tilt:gap-2">
      {/* Award odds lead an NBA regular-season card (the awards are regular
          season); a playoff or college card has none. Sideways they run down
          the left, the breakdown beside them. */}
      {baseline === "NBA" && <AwardBoxes slug={aRow.slug} season={aRow.season} />}
      <div className="tilt:flex-1 tilt:min-w-0">
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
      {activeRows.map((c, i) => {
        const pct = (Math.abs(c.value) / maxAbs) * 45;
        const isPos = c.value >= 0;
        const perG = c.value / gp;
        // By Category: every row of a section opens that section's context
        // (any Points/2P/3P/FT row -> the Scoring scatter), highlighted as a
        // block, with the panel under the section's last row.
        const tapKey = viewMode === "detail" ? groupOfCat(c.key) : c.key;
        const catOpen = context && openCat === tapKey;
        const sectionEnd = viewMode !== "detail" || i === activeRows.length - 1 || groupOfCat(activeRows[i + 1].key) !== tapKey;
        // Whole row is the tap target (same as the playoff breakdown), with
        // the selected row highlighted.
        const onCatTap = context && (!c.noDrill || viewMode === "detail") ? () => setOpenCat(catOpen ? null : tapKey) : undefined;
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
            {catOpen && sectionEnd && <CategoryContext p={p} catKey={tapKey} lga={lga} rateMode={rateMode} context={context} defs={defs} defActive={dVA != null} defScope="rs" />}
            {viewMode === "detail" && VA_PARTITIONS_AFTER.has(c.key) && <div className="my-1 border-t border-stone-200" />}
          </React.Fragment>
        );
      })}
      <div className="mt-2 text-center text-[9px] italic text-stone-400">
        Bars show per-game contribution above / below the {baseline || (context ? "NBA playoff" : "D-I")} baseline{lga?.usgModel ? ", scoring usage-adjusted" : ""}{context ? ` · tap a ${viewMode === "detail" ? "section" : "category"} for league context` : ""}
      </div>
      </>
      )}
      </div>
    </div>
  );
}
