"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { TEAMS, TEAM_CONF } from "../teams";
import { valueAddParts, ZONES } from "../scoring";
import { VABreakdown, VACategoryBreakdown } from "./va-breakdown";
import { defVAInfo, useDefRatings } from "../lib/defense";
import { fetchJsonCached } from "../lib/fetch-cache";
import { GOLD, MIDNIGHT_PURPLE, normalizeName, teamColor, withAlpha } from "../lib/format";
import { buildScopePools, findIndexPlayer } from "../lib/players";


export function PlayoffLeaderboard({ season, lga, scope = "playoffs" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rsError, setRsError] = useState(null);
  const [rsLoading, setRsLoading] = useState(false);
  // Full regular-season rows; feeds the rs/combined scopes AND the per-36
  // reference tick in the playoff drill-in.
  const [rsData, setRsData] = useState(null);
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
  // filter — armed by tapping the G header, then a row's G value, so
  // brushing a row's G can't filter by accident.
  const [minGames, setMinGames] = useState(null);
  const [gArmed, setGArmed] = useState(false);
  // Name of the player whose G cell was just tapped, so we can scroll
  // their row into view after the list re-sorts/filters.
  const [pendingScrollName, setPendingScrollName] = useState(null);
  // VA vs VA+ (VA + defensive net rating). VA+ re-scores the whole board:
  // sort, the TOT/VA-G columns, and the bar widths all switch.
  const [metric, setMetric] = useState("va"); // "va" | "vaPlus"
  // Scroll-driven pinned header. Rather than position:sticky (which leaves a
  // ghost white bar on iOS Safari after un-sticking), we render the header a
  // second time in a position:fixed overlay, but ONLY while the card straddles
  // the top of the viewport — mounted on demand and fully unmounted otherwise,
  // so nothing can linger. `fixedBar` holds the overlay's horizontal geometry
  // (matched to the card) or null when it shouldn't show.
  const [fixedBar, setFixedBar] = useState(null);
  const cardElRef = useRef(null);
  const headerFlowRef = useRef(null);
  const [cardMounted, setCardMounted] = useState(false);
  const setCardEl = useCallback((node) => { cardElRef.current = node; setCardMounted(!!node); }, []);
  useEffect(() => {
    if (!cardMounted) return;
    const measure = () => {
      const card = cardElRef.current;
      if (!card) return;
      const r = card.getBoundingClientRect();
      const h = headerFlowRef.current?.offsetHeight || 56;
      // Show once the card's top has scrolled above the viewport, and hide
      // again once its bottom rises past one header's height (so the overlay
      // releases as the leaderboard scrolls off, like a sticky would).
      const show = r.top < 0 && r.bottom > h;
      setFixedBar((prev) => {
        if (!show) return prev === null ? prev : null;
        const next = { left: Math.round(r.left), width: Math.round(r.width) };
        return prev && prev.left === next.left && prev.width === next.width ? prev : next;
      });
    };
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure(); }); };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [cardMounted]);
  const defs = useDefRatings();
  const defScope = scope === "playoffs" ? "po" : "rs";
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setShowAll(false);
    setTeamFilter(null);
    setSortMode("composite");
    setMinGames(null);
    setGArmed(false);
    setPendingScrollName(null);
    setExpanded(null);
    setRsData(null);
    setRsError(null);
    setLoading(true);
    setRsLoading(true);
    fetchJsonCached(`/api/leaderboard?season=${season}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => !cancelled && setError(e.message || "Load failed"))
      .finally(() => !cancelled && setLoading(false));
    // Regular-season totals load independently so a slow BR fetch doesn't
    // block the playoff leaderboard; in playoff scope they only feed the
    // reference tick, in the other scopes they're the data itself.
    fetchJsonCached(`/api/regular-season?season=${season}`)
      .then((d) => { if (!cancelled && Array.isArray(d.players)) setRsData(d); })
      .catch((e) => !cancelled && setRsError(e.message || "Load failed"))
      .finally(() => !cancelled && setRsLoading(false));
    return () => { cancelled = true; };
  }, [season]);

  // Regular-season rows in leaderboard shape: gp/reb aliases plus VA + EFF
  // computed against the season's league baselines (rs bakes don't carry VA).
  const rsPlayers = useMemo(() => {
    if (!rsData?.players?.length) return null;
    return rsData.players.map((p) => {
      const parts = valueAddParts(p, lga);
      return { ...p, gp: p.g, reb: (p.drb || 0) + (p.orb || 0), va: parts.va, eff: parts.efficiency, games: [] };
    });
  }, [rsData, lga]);

  const rsLookup = useMemo(() => {
    if (!rsData?.players?.length) return null;
    const bySlug = {}, byName = {}, byNorm = {};
    for (const p of rsData.players) {
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
    return { bySlug, byName, byNorm };
  }, [rsData]);

  // Combined scope: playoff rows absorb their regular-season counterpart
  // (slug join, then normalized name), regular-season-only players are kept,
  // VA/EFF recomputed on the summed totals. If the season has no rs bake yet
  // this falls back to the playoff rows alone.
  const combinedPlayers = useMemo(() => {
    if (!data?.players?.length) return null;
    const bySlug = new Map(), byNorm = new Map();
    for (const r of rsPlayers || []) {
      if (r.slug) bySlug.set(r.slug, r);
      const n = normalizeName(r.name);
      if (n && !byNorm.has(n)) byNorm.set(n, r);
    }
    const used = new Set();
    const rows = data.players.map((p) => {
      const r = (p.slug && bySlug.get(p.slug)) || byNorm.get(normalizeName(p.name)) || null;
      if (r) used.add(r);
      const sum = { name: p.name, slug: p.slug || r?.slug, team: p.team, gp: (p.gp || 0) + (r?.gp || 0), games: [] };
      // Includes the shot-distance zone m/a keys (z03m/z03a/...) alongside
      // the box-score fields, so this combined row still carries zone data
      // for the compare card's 2-Pointers zone rows and the closest-comps
      // Shoot metric — both were silently disabled here before, since this
      // list predates the zones feature and summed the box score fields
      // only.
      for (const k of ["mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb", "fgm", "fga", "tpm", "tpa", "ftm", "fta",
                        ...ZONES.flatMap((z) => [z.mKey, z.aKey])]) {
        sum[k] = (p[k] || 0) + (r ? r[k] || 0 : 0);
      }
      sum.reb = sum.drb + sum.orb;
      const parts = valueAddParts(sum, lga);
      sum.va = parts.va;
      sum.eff = parts.efficiency;
      return sum;
    });
    for (const r of rsPlayers || []) {
      if (!used.has(r)) rows.push(r);
    }
    return rows;
  }, [data, rsPlayers, lga]);

  // League-context pools for the category drill-ins (same panel as By
  // Player). The scope index is a multi-MB payload, so it's fetched lazily on
  // first row expand and cached per scope — and shared with By Player through
  // fetchJsonCached, so whichever view loads it first pays the cost.
  const [ctxByScope, setCtxByScope] = useState({});
  const ctxPlayers = ctxByScope[scope] || null;
  useEffect(() => {
    if (expanded == null || ctxByScope[scope]) return;
    let cancelled = false;
    fetchJsonCached(`/api/players?scope=${scope}`)
      .then((d) => { if (!cancelled) setCtxByScope((c) => ({ ...c, [scope]: d.players || [] })); })
      .catch(() => {}); // context is an enhancement; the breakdown works without it
    return () => { cancelled = true; };
  }, [expanded, scope, ctxByScope]);
  const ctxPools = useMemo(() => (ctxPlayers ? buildScopePools(ctxPlayers) : null), [ctxPlayers]);
  const contextFor = (p) => {
    if (!ctxPools) return null;
    const self = findIndexPlayer(ctxPlayers, p);
    if (!self) return null;
    return { ...ctxPools, self, scope, season };
  };

  useEffect(() => {
    if (!pendingScrollName) return;
    const sel = `[data-player-row="${pendingScrollName.replace(/"/g, '\\"')}"]`;
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingScrollName(null);
  }, [pendingScrollName]);

  const title = scope === "regular" ? "Regular Season Leaderboard"
    : scope === "combined" ? "Combined Leaderboard"
    : "Playoff Leaderboard";
  // What has to finish before this scope can render.
  const scopeLoading = scope === "regular" ? rsLoading : scope === "combined" ? (loading || rsLoading) : loading;
  const scopeError = scope === "regular" ? rsError : error;
  if (scopeLoading) {
    return (
      <div className="mb-4 p-3 bg-white border border-stone-300">
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-2">{title}</div>
        <div className="text-[10px] text-stone-500 italic py-2 text-center">Aggregating box scores… (first load may take ~10s)</div>
      </div>
    );
  }
  if (scopeError) {
    return (
      <div className="mb-4 p-3 bg-white border border-stone-300">
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-2">{title}</div>
        <div className="text-[10px] text-red-600 py-2 text-center px-2 break-words">Couldn’t load — {scopeError}</div>
      </div>
    );
  }

  const all = scope === "regular" ? rsPlayers : scope === "combined" ? combinedPlayers : data?.players;
  if (!all?.length) return null;
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
  // The active total for a row — VA, or VA+ (VA + dVA) when the toggle is on.
  // dVA is 0 when a player-season has no rating, so VA+ always exists.
  const vaOf = (p) => metric === "vaPlus"
    ? (p.va || 0) + (defVAInfo(p, p.mp, lga, defs, season, defScope)?.dva || 0)
    : (p.va || 0);
  const vaPerG = (p) => vaOf(p) / Math.max(1, p.gp);
  const safeRatio = (v, max) => (max > 0 ? v / max : 0);
  const maxVA = Math.max(...all.map((p) => vaOf(p)));
  const maxVAperG = Math.max(...all.map((p) => vaPerG(p)));
  const composite = (p) =>
    safeRatio(vaOf(p), maxVA) + safeRatio(vaPerG(p), maxVAperG);

  // Min-games filter forces VA/G order. Otherwise honour the column
  // header the user clicked (composite by default). Total VA is the
  // explicit tiebreaker for the composite + VA/G sorts so the order
  // doesn't quietly drift if the server-side input order ever shifts.
  const effectiveSort = minGames != null ? "vaPerG" : sortMode;
  const sortedAll =
    effectiveSort === "totalVA" ? [...all].sort((a, b) => vaOf(b) - vaOf(a)) :
    effectiveSort === "vaPerG"  ? [...all].sort((a, b) => vaPerG(b) - vaPerG(a) || vaOf(b) - vaOf(a)) :
                                  [...all].sort((a, b) => composite(b) - composite(a) || vaOf(b) - vaOf(a));
  const teamFiltered = teamFilter ? sortedAll.filter((p) => p.team === teamFilter) : sortedAll;
  const filtered = minGames != null ? teamFiltered.filter((p) => p.gp >= minGames) : teamFiltered;
  const shown = (showAll || teamFilter || minGames != null) ? filtered : filtered.slice(0, 10);

  // seriesIdx → round lookup, so each game row can carry its round into
  // the VABreakdown drill-in title ("Western Semis vs. MIN" etc.). `data` can
  // still be null here in regular scope, which doesn't wait for the (slow)
  // playoff aggregation it doesn't use.
  const roundBySeries = Object.fromEntries(
    (data?.series || []).map((s) => [s.idx, s.round])
  );

  // The header (title + toggle + filter chips + column labels), rendered both
  // in flow inside the card and again in the fixed overlay while pinned.
  const headerBlock = (
    <>
      <div className="px-3 pt-2.5 pb-1.5 text-[10px] uppercase tracking-[0.3em] text-stone-500 border-b border-stone-200 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span>{title}</span>
        {/* Chip group stays glued together and right-aligned (ml-auto); when
            the title + all three chips can't share one line it wraps to its
            own line as a unit instead of the chips compressing (which used to
            break "≥N games" onto two lines when a team filter was also on). */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {/* VA vs VA+ (adds defensive net rating). Midnight purple when on. */}
          <div className="inline-flex normal-case tracking-normal text-[10px] font-semibold rounded-sm overflow-hidden border" style={{ borderColor: metric === "vaPlus" ? MIDNIGHT_PURPLE : "#d6d3d1" }}>
            <button
              type="button"
              onClick={() => setMetric("va")}
              className="px-1.5 py-0.5"
              style={metric === "va" ? { backgroundColor: MIDNIGHT_PURPLE, color: "#fff" } : { backgroundColor: "#fff", color: "#78716c" }}
              aria-pressed={metric === "va"}
            >VA</button>
            <button
              type="button"
              onClick={() => setMetric("vaPlus")}
              className="px-1.5 py-0.5 border-l"
              style={metric === "vaPlus" ? { backgroundColor: MIDNIGHT_PURPLE, borderColor: MIDNIGHT_PURPLE } : { backgroundColor: "#fff", borderColor: "#d6d3d1" }}
              aria-pressed={metric === "vaPlus"}
            >
              {/* VA+ wears the defensive strip's palette — gold (defense
                  adds) bleeding into red (defense subtracts) — in both
                  states, so the metric is recognizable at a glance. The
                  purple fill, not the text color, marks which side is on. */}
              <span
                style={{
                  backgroundImage: `linear-gradient(100deg, ${GOLD} 20%, #dc2626 90%)`,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  WebkitTextFillColor: "transparent",
                }}
              >VA+</span>
            </button>
          </div>
          {minGames != null && (
            <button
              onClick={() => setMinGames(null)}
              className="normal-case tracking-normal text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1 whitespace-nowrap bg-stone-100 text-stone-700 border-stone-300"
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
                className="normal-case tracking-normal text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1 whitespace-nowrap"
                style={{ backgroundColor: withAlpha(c, 0.14), color: c, borderColor: withAlpha(c, 0.4) }}
                aria-label={`Clear ${teamFilter} filter`}
              >
                {teamFilter} <span className="text-stone-400">×</span>
              </button>
            );
          })()}
        </div>
      </div>
      {scope === "combined" && !rsPlayers && (
        <div className="px-3 py-1.5 text-[9px] italic text-stone-400 border-b border-stone-200">
          Regular-season totals aren’t baked for {season} yet — showing playoff stats only.
        </div>
      )}
      <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 px-2 border-b border-stone-200">
        <span className="w-6 text-right">#</span>
        <span className="w-10">Team</span>
        <span className="flex-1">Player</span>
        {/* Arming step for the min-games filter: tap G here first, then a
            row's G value — a bare row tap should never filter by accident. */}
        <button
          type="button"
          onClick={() => setGArmed((v) => !v)}
          className={`w-6 text-right uppercase tracking-wider cursor-pointer hover:text-stone-900 ${gArmed ? "text-stone-900 font-bold underline" : ""}`}
          title="Tap, then tap a player's G to filter to at least that many games"
          aria-pressed={gArmed}
        >
          G
        </button>
        <span className="hidden sm:block w-8 text-right">PPG</span>
        <span className="hidden sm:block w-9 text-right">EFF</span>
        <span className="hidden sm:block w-8 text-right">RPG</span>
        <span className="hidden sm:block w-8 text-right">APG</span>
        <span className="hidden sm:block w-8 text-right">SPG</span>
        <span className="hidden sm:block w-8 text-right">BPG</span>
        {/* w-14/w-11 (mirrored in the row cells below): "TOT VA+ ▾" needs the
            extra room so the sort caret stays on one line instead of
            stacking under the label in VA+ mode. */}
        <button
          type="button"
          onClick={() => {
            setMinGames(null);
            setSortMode(sortMode === "totalVA" ? "composite" : "totalVA");
          }}
          className={`w-14 text-right whitespace-nowrap uppercase tracking-wider cursor-pointer hover:text-stone-900 ${effectiveSort === "totalVA" ? "text-stone-900 font-semibold" : ""}`}
          aria-label="Sort by total VA"
          aria-pressed={effectiveSort === "totalVA"}
        >
          {metric === "vaPlus" ? "TOT VA+" : "TOT VA"}{effectiveSort === "totalVA" ? " ▾" : ""}
        </button>
        <button
          type="button"
          onClick={() => {
            setMinGames(null);
            setSortMode(sortMode === "vaPerG" ? "composite" : "vaPerG");
          }}
          className={`w-11 text-right whitespace-nowrap uppercase tracking-wider cursor-pointer hover:text-stone-900 ${effectiveSort === "vaPerG" ? "text-stone-900 font-semibold" : ""}`}
          aria-label="Sort by VA per game"
          aria-pressed={effectiveSort === "vaPerG"}
        >
          {metric === "vaPlus" ? "VA+/G" : "VA/G"}{effectiveSort === "vaPerG" ? " ▾" : ""}
        </button>
      </div>
    </>
  );

  return (
    <>
    <div ref={setCardEl} className="mb-4 border border-stone-300 bg-white">
      <div ref={headerFlowRef}>{headerBlock}</div>
      {(() => {
        // Defensive strip (VA view only): a thin underline segment spanning
        // the gap between a player's VA and his VA+, plotted on the SAME
        // scale as the team-color bar — gold extending past the bar's end
        // when defense adds value, red backing into it when it subtracts.
        // VA+ view skips it: its main bar already contains dVA.
        const dvaOf = (p) => defVAInfo(p, p.mp, lga, defs, season, defScope)?.dva ?? null;
        // Bar scale — proportional to abs(VA) over the visible list. In VA
        // view the denominator also covers each player's VA+ so the strips'
        // endpoints fit on-scale (the biggest VA+ reaches full width, and
        // the VA bars shrink a notch to make room).
        const maxAbsVa = Math.max(
          ...shown.map((p) => Math.abs(vaOf(p))),
          ...(metric === "va" ? shown.map((p) => {
            const d = dvaOf(p);
            return d == null ? 0 : Math.abs((p.va || 0) + d);
          }) : []),
          0.5,
        );
        return shown.map((p, i) => {
        // Keep the overall rank (1, 7, 13…) even when filters trim the
        // visible list. With the min-games filter on, "overall" means
        // ranked by VA/G, since that's how the list is now ordered.
        const rank = sortedAll.indexOf(p) + 1;
        const rowKey = `${p.team}:${p.name}`;
        const isOpen = expanded === rowKey;
        const tc = teamColor(p.team);
        const badgeStyle = { backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) };
        const rowVa = vaOf(p);
        const barColor = rowVa >= 0
          ? withAlpha(tc, 0.16)
          : withAlpha("#dc2626", 0.10);
        const barPct = (Math.abs(rowVa) / maxAbsVa) * 100;
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
        const vaPerG = p.gp > 0 ? rowVa / p.gp : 0;
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
              {/* Defensive strip — a full-length VA+ underline on the bar's
                  own scale: it runs from zero to the player's VA+, so its
                  right edge marks VA+ against the bar's end — reaching past
                  it (gold) when defense adds, stopping short (red) when it
                  subtracts. */}
              {metric === "va" && (() => {
                const dva = dvaOf(p);
                if (dva == null || dva === 0) return null;
                return (
                  <div
                    className="absolute bottom-0 left-0 h-[3px] pointer-events-none"
                    style={{
                      width: `${(Math.abs(rowVa + dva) / maxAbsVa) * 100}%`,
                      backgroundColor: dva > 0 ? withAlpha(GOLD, 0.5) : withAlpha("#dc2626", 0.3),
                    }}
                    aria-hidden
                  />
                );
              })()}
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
                  // Unarmed tap on an inactive G is treated as a mis-tap: fall
                  // through (no stopPropagation) so it bubbles to the row and
                  // opens the breakdown, instead of doing nothing.
                  if (!gArmed && minGames !== p.gp) return;
                  e.stopPropagation();
                  const next = minGames === p.gp ? null : p.gp;
                  setMinGames(next);
                  setGArmed(false);
                  if (next != null) setPendingScrollName(p.name);
                }}
                className={`w-6 text-right tabular-nums cursor-pointer ${gArmed || minGames === p.gp ? "hover:text-stone-900 hover:underline" : ""} ${minGames === p.gp ? "font-semibold text-stone-900" : gArmed ? "text-stone-700 underline decoration-dotted" : "text-stone-500"}`}
                aria-label={gArmed ? `Filter to players with at least ${p.gp} games` : `${p.gp} games (tap the G header to enable filtering)`}
              >{p.gp}</button>
              <span className="hidden sm:block w-8 text-right tabular-nums font-bold text-stone-900">{(p.pts / p.gp).toFixed(1)}</span>
              <span className={`hidden sm:block w-9 text-right tabular-nums font-semibold ${p.eff / p.gp < 0 ? "text-red-600" : "text-stone-700"}`}>{(p.eff / p.gp).toFixed(1)}</span>
              <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(p.reb / p.gp).toFixed(1)}</span>
              <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(p.ast / p.gp).toFixed(1)}</span>
              <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(p.stl / p.gp).toFixed(1)}</span>
              <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(p.blk / p.gp).toFixed(1)}</span>
              <span className={`w-14 text-right tabular-nums font-bold ${rowVa < 0 ? "text-red-600" : "text-stone-900"}`}>{rowVa.toFixed(1)}</span>
              <span className={`w-11 text-right tabular-nums ${vaPerG < 0 ? "text-red-600" : "text-stone-700"}`}>{vaPerG.toFixed(2)}</span>
              </div>
            </div>
            {isOpen && (scope === "playoffs" ? (
              <VABreakdown
                p={p}
                lga={lga}
                teams={{}}
                rate
                season={season}
                defScope={scope === "playoffs" ? "po" : "rs"}
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
                context={contextFor(p)}
                onPrev={i > 0 ? () => setExpanded(`${shown[i - 1].team}:${shown[i - 1].name}`) : undefined}
                onNext={i < shown.length - 1 ? () => setExpanded(`${shown[i + 1].team}:${shown[i + 1].name}`) : undefined}
                showDRating={metric === "vaPlus"}
              />
            ) : (
              // No per-game logs outside the playoffs — show the season-total
              // per-category breakdown instead, with the same category
              // context drill-ins as the playoff view.
              <VACategoryBreakdown player={p} lga={lga} baseline="NBA" context={contextFor(p)} showDRating={metric === "vaPlus"} />
            ))}
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
    {/* Pinned header overlay — position:fixed (not sticky) and only in the DOM
        while scrolled into the leaderboard, aligned to the card's width. */}
    {fixedBar && (
      <div
        className="fixed top-0 z-30 bg-white border-x border-b border-stone-300 shadow-sm"
        style={{ left: fixedBar.left, width: fixedBar.width }}
      >
        {headerBlock}
      </div>
    )}
    </>
  );
}
