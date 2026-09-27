"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { TEAMS, TEAM_CONF } from "../teams";
import { valueAddParts } from "../scoring";
import { VABreakdown, VACategoryBreakdown } from "./va-breakdown";
import { CompareChipLabel, ComparePanel } from "./compare";
import { MultiComparePicker } from "./compare-picker";
import { CompareSlotProvider, useShareReport } from "../lib/share-state";
import { PlayerAvatar } from "./ui/avatar";
import { Sparkline } from "./ui/sparkline";
import { defVAInfo, useDefRatings } from "../lib/defense";
import { fetchBakedJson } from "../lib/fetch-cache";
import { GOLD, GOLD_BG, MIDNIGHT_PURPLE, NEGATIVE_EDGE, normalizeName, shortName, teamColor, withAlpha } from "../lib/format";
import { aggregateSeasons, careerYearsOf } from "../lib/multi-season";
import { buildScopePools } from "../lib/players";
import { UsgAdjChip, lgaScopeFor, useRowLga, useSeasonLga, usgAdjRows, useUsgAdjIndex } from "../lib/va-mode";


// "By Player" mode: search the cross-season index from /api/players and show a
// single player's playoff seasons ranked by Value Added.
export function PlayerExplorer({ scope = "playoffs", onOpenTeamSeason = null, pendingPlayer = null, onPlayerNavHandled = null }) {
  // One index per scope, cached so flipping the selector doesn't refetch.
  // fetchBakedJson also shares the payload with the By Season context fetch.
  const [cache, setCache] = useState({});
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState(null);
  const selectPlayer = (k) => setSelectedKey(k);
  // Re-priced once, here, when USG-ADJ is on: this index is the source for the
  // career table, the league pools the drill-ins rank against, and the
  // closest-comps candidates, so one pass keeps all three agreeing with the
  // leaderboard (lib/va-mode.js).
  const index = useUsgAdjIndex(cache[scope] || null, lgaScopeFor(scope));
  const loading = !index && !error;

  useEffect(() => {
    if (cache[scope]) return;
    let cancelled = false;
    setError(null);
    fetchBakedJson(`/api/players?scope=${scope}`)
      .then((d) => { if (!cancelled) setCache((c) => ({ ...c, [scope]: d.players || [] })); })
      .catch((e) => { if (!cancelled) setError(e.message || "Load failed"); });
    return () => { cancelled = true; };
  }, [scope, cache]);

  const keyOf = (p) => p.slug || p.name;

  // A pending "open this season" request riding along with a navigation, from
  // a source that names one — the category card's by-season trend bars. Handed
  // down to PlayerDetail, which opens that season's row; null just lands on the
  // career view.
  const [navSeason, setNavSeason] = useState(null);
  const clearNavSeason = useCallback(() => setNavSeason(null), []);
  // A comparison riding along with that navigation — the compare panel's
  // career-year gate opens one player's season for a career year and wants the
  // card there to already be comparing against the other player's season for
  // the same year. Travels with navSeason and is applied to the same row.
  const [navCompare, setNavCompare] = useState(null);
  const clearNavCompare = useCallback(() => setNavCompare(null), []);
  // A pending "tick this run" request: the seasons a compare panel's chip asked
  // for when the player it points at is a multi-season RUN rather than one
  // season. There is no single row to open, so the landing is the career table
  // with exactly those seasons ticked — the selection you'd have made by hand.
  const [navRun, setNavRun] = useState(null);
  const clearNavRun = useCallback(() => setNavRun(null), []);

  // Jump to a player — invoked from a compare panel's compared-player chip or
  // a trend bar's "Go →" (via context.onNavigateToPlayer). Resolve the target
  // against the loaded index (slug first, then normalized name) and select it;
  // PlayerDetail is keyed by player+scope, so a different player remounts fresh.
  // Without a target season that's the default career view (no season drilled
  // in); with one, PlayerDetail opens it and scrolls it into view — which is
  // also what makes a jump WITHIN the current player's career do something
  // visible, since re-selecting the same player alone changes nothing.
  const navigateToPlayer = (target) => {
    if (!index || !target) return;
    const nm = normalizeName(target.name || "");
    const found = index.find((p) => (target.slug && p.slug === target.slug) || normalizeName(p.name) === nm);
    if (!found) return;
    setSelectedKey(keyOf(found));
    setNavSeason(target.season || null);
    setNavCompare(target.season ? target.compare || null : null);
    setNavRun(null);
    // The season row scrolls itself into view; only a plain legacy-view jump
    // wants the top of the page.
    if (!target.season && typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // The same jump for a RUN — a compared side that pools several seasons. It
  // lands on the player's career table with those seasons ticked rather than on
  // any one row, so ask only for the seasons this scope's index actually has
  // for him; a request that survives none of them is dropped rather than
  // leaving the table in selection mode with nothing in it.
  const navigateToRun = (target) => {
    if (!index || !target?.seasons?.length) return;
    const nm = normalizeName(target.name || "");
    const found = index.find((p) => (target.slug && p.slug === target.slug) || normalizeName(p.name) === nm);
    if (!found) return;
    const have = new Set(found.seasons.map((s) => s.season));
    const seasons = target.seasons.filter((s) => have.has(s));
    if (!seasons.length) return;
    setSelectedKey(keyOf(found));
    setNavSeason(null);
    setNavCompare(null);
    setNavRun(seasons);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Apply an incoming "open this player" navigation from the By Season
  // leaderboard (Player header armed, then a name tapped). This mode only
  // mounts on the switch into By Player, so the index is usually still in
  // flight — hold the request until it lands, then resolve the target the same
  // way navigateToPlayer does and drill straight into the season the
  // leaderboard was showing. The search box is seeded with the name either way,
  // so "‹ Back to search" lands somewhere useful and an unresolvable target
  // (a player the scope's index doesn't carry) still says so on screen.
  useEffect(() => {
    if (!pendingPlayer || !index) return;
    const nm = normalizeName(pendingPlayer.name || "");
    const found = index.find((p) => (pendingPlayer.slug && p.slug === pendingPlayer.slug) || (nm && normalizeName(p.name) === nm));
    setQuery(pendingPlayer.name || "");
    if (found) {
      setSelectedKey(keyOf(found));
      // Only ask for a season the player actually has in this scope; anything
      // else would leave PlayerDetail's pending request permanently unmet.
      const hasSeason = found.seasons.some((s) => s.season === pendingPlayer.season);
      setNavSeason(hasSeason ? pendingPlayer.season : null);
      // A shared link can also name the opened season's comparison.
      setNavCompare(hasSeason ? pendingPlayer.compare || null : null);
      // A crossing that names a RUN (a By Season compare panel's chip pointing
      // at a pooled side) ticks those seasons instead of opening a row — same
      // rule, applied to the whole set.
      const have = new Set(found.seasons.map((s) => s.season));
      const run = (pendingPlayer.seasons || []).filter((s) => have.has(s));
      setNavRun(run.length ? run : null);
    }
    onPlayerNavHandled?.();
  }, [pendingPlayer, index, onPlayerNavHandled]);

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
  // The open player for the page's link; while a navigation is still waiting
  // on the index, its target.
  useShareReport({ p: player?.slug || pendingPlayer?.slug || null });

  // Cross-season/-player pools that power the per-category "league context"
  // dropdown. Each player-season row is tagged with the owner's name + slug so
  // the context can rank, place, and find the player within a season or all-time.
  const contextData = useMemo(() => (index ? buildScopePools(index) : null), [index]);

  if (loading) return <div className="text-[10px] text-stone-500 italic py-6 text-center">Loading player index…</div>;
  if (error) return <div className="text-[10px] text-red-600 py-6 text-center px-2 break-words">Couldn’t load players — {error}</div>;

  if (player) {
    // Keyed so sort/filter/expanded state resets when the player or scope changes.
    return (
      <PlayerDetail
        key={`${keyOf(player)}:${scope}`}
        player={player}
        scope={scope}
        contextData={contextData}
        onBack={() => selectPlayer(null)}
        onNavigateToPlayer={navigateToPlayer}
        onNavigateToRun={navigateToRun}
        onOpenTeamSeason={onOpenTeamSeason}
        pendingSeason={navSeason}
        onNavHandled={clearNavSeason}
        pendingCompare={navCompare}
        onCompareHandled={clearNavCompare}
        pendingRun={navRun}
        onRunHandled={clearNavRun}
      />
    );
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter players by name…"
        autoFocus
        className="w-full text-[15px] text-stone-900 bg-white border border-stone-200 rounded-2xl px-4 py-3 mb-3 outline-none focus:border-stone-400 focus:ring-4 focus:ring-stone-200/60 transition"
      />
      {query.trim().length < 2 ? (
        <div className="text-[12px] text-stone-400 py-8 text-center">
          Type a name to see their {scope === "playoffs" ? "playoff runs" : scope === "regular" ? "regular seasons" : "combined seasons"} ranked by Value Added.
        </div>
      ) : matches.length === 0 ? (
        <div className="text-[12px] text-stone-400 py-8 text-center">No players match “{query.trim()}”.</div>
      ) : (
        <div className="cs-card p-1.5">
          {matches.map((p, i) => {
            const byYear = [...p.seasons].sort((a, b) => a.season.localeCompare(b.season)).map((x) => x.va);
            const lead = p.teams.find((t) => !/^(TOT|\dTM)$/.test(t)) || p.teams[0];
            return (
              <button
                key={keyOf(p)}
                onClick={() => selectPlayer(keyOf(p))}
                className="cs-press cs-rise w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left hover:bg-stone-50"
                style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
              >
                <PlayerAvatar name={p.name} team={lead} size={36} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold text-stone-900 truncate">{p.name}</span>
                  <span className="block text-[11px] text-stone-500 truncate">
                    {p.seasons.length} {scope === "playoffs" ? "run" : "season"}{p.seasons.length === 1 ? "" : "s"} ·{" "}
                    {p.teams.filter((t) => !/^(TOT|\dTM)$/.test(t)).slice(0, 4).map((t, ti) => (
                      <React.Fragment key={t}>
                        {ti > 0 && " · "}
                        <span className="font-semibold" style={{ color: teamColor(t) }}>{t}</span>
                      </React.Fragment>
                    ))}{p.teams.filter((t) => !/^(TOT|\dTM)$/.test(t)).length > 4 ? ` +${p.teams.filter((t) => !/^(TOT|\dTM)$/.test(t)).length - 4}` : ""}
                  </span>
                </span>
                <Sparkline values={byYear} highlight={byYear.indexOf(Math.max(...byYear))} color={teamColor(lead)} width={52} height={22} className="cs-wide-only shrink-0" />
                <span className="text-right shrink-0">
                  <span className="block text-[13px] font-bold tabular-nums text-stone-900">{p.bestVa.toFixed(1)}</span>
                  <span className="block text-[10px] text-stone-400">best</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


// One player's seasons for the selected scope, rendered with the exact same
// treatment as the By Season leaderboard: composite default sort with
// tappable TOT VA / VA/G column headers, team-color badges that filter, a
// min-games filter on the G column, team-tinted VA bars behind rows, and the
// landscape-only per-game stat columns. Rows expand to the same drill-ins.
export function PlayerDetail({ player, scope, contextData, onBack, onNavigateToPlayer = null, onNavigateToRun = null, onOpenTeamSeason = null, pendingSeason = null, onNavHandled = null, pendingCompare = null, onCompareHandled = null, pendingRun = null, onRunHandled = null }) {
  // Season baselines under the active USG-ADJ mode (lib/va-mode.js). The rows
  // themselves arrive already re-priced from the index; this is what scores
  // everything derived from them here — per-season efficiency, the pooled
  // multi-season row, the drill-in cards.
  // Bound to this view's scope, so every season it scores below — the career
  // table, the aggregates, the drill-ins — is measured against the league that
  // side of the season was played in (spec §4.8). Playoff runs take the blended
  // playoff baseline. Per ROW rather than per season, because a combined row
  // summed a regular season and a playoff run and is scored against its own
  // minute-weighted mix of the two, which a season lookup cannot answer; for
  // the playoff and regular-season scopes the two agree exactly.
  const rowLga = useRowLga(scope);
  const [openSeason, setOpenSeason] = useState(null);
  const [sortMode, setSortMode] = useState("composite");
  const [teamFilter, setTeamFilter] = useState(null);
  // Min-games filter is a two-step tap (arm on the G header, then a row's G)
  // so a stray tap on a G value opens the row instead of filtering. Matches
  // the By Season leaderboard.
  const [minGames, setMinGames] = useState(null);
  const [gArmed, setGArmed] = useState(false);
  // Same arming shape on the Team header, for a bigger move: while armed, a
  // team card leaves By Player entirely and opens that team's filter in the
  // By Season leaderboard for that card's season, with this player's row
  // already expanded there. Unarmed, the cards keep their in-place team
  // filter — navigating away is never one stray tap.
  const [teamArmed, setTeamArmed] = useState(false);
  const canOpenTeam = typeof onOpenTeamSeason === "function";
  // The # header's own two-step, and the biggest of the three: the first tap
  // turns the rank column into check boxes and the whole row becomes the tick
  // target; ticking a run then brings up the picker for the OTHER player's run
  // by itself (see `picking`), and tapping # once more puts it away. The ✕ chip
  // beside the player's name is the way out of the whole mode.
  //
  // While it's armed the rows do ONE thing. A 3mm check box inside a row that
  // otherwise opened a breakdown meant every mis-tap while pooling a run threw
  // a chart between the seasons being ticked; now the tap lands wherever it
  // falls on the row. The breakdown isn't gone, it's behind the disarm — the
  // one deliberate tap that says you're done picking.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  // An explicit open/close of the compare picker — the # tap or the picker's
  // own ✕ — remembered against the selection it was pressed for (see
  // `picking` below).
  const [pickOverride, setPickOverride] = useState(null); // { key, open } | null
  // The compared run: { name, slug, seasons, row } where row is the other
  // player's aggregate. Held here rather than inside a season row, because a
  // multi-season comparison belongs to the whole table, not to one line of it.
  const [multiCompare, setMultiCompare] = useState(null);
  // Whether the picker is on screen. It opens ON ITS OWN once a run — two or
  // more seasons — is ticked: at that point choosing who to compare against
  // is the only thing left to do, so asking for it was a tap with no other
  // answer. It appears quietly, in place under the table, and never moves
  // the page to announce itself — only a # tap that asks for it scrolls the
  // reader down to it (see MultiComparePicker).
  //
  // An override still wins, because both ways out of the automatic behavior
  // have to work: tapping # dismisses a picker you didn't want, and tapping
  // it on a single ticked season opens one early. The override is keyed to
  // the exact selection it was pressed for, so changing what's ticked is a
  // new question and hands the panel back to the rule above.
  const pickKey = useMemo(() => [...picked].sort().join("|"), [picked]);
  const pickAsked = pickOverride?.key === pickKey && pickOverride.open;
  const picking = pickOverride?.key === pickKey
    ? pickOverride.open
    : (picked.size >= 2 && !multiCompare);
  // "values" | "pct". A comparison opens on PERCENTILES: two raw VA figures
  // only say who was bigger, while the percentile pair says how big each was
  // against everyone who ever played the category — which is the thing the
  // card is for. Values is one tap away for the reader who wants the margin.
  const [compareMode, setCompareMode] = useState("pct");
  // A career-year selection made in the compare panel's chart, mirrored up here
  // so the card's vs-chip can name it instead of the run it opened on.
  const [careerPick, setCareerPick] = useState(null);
  // The seasons behind that chart's ticks — the years being picked, or the
  // selection already being read — reported by the panel (see its onYearTicks).
  // The table's boxes follow them while they last: a career year ticked down
  // there IS a season up here, and a screen where the chart says six years and
  // the boxes say three is one where neither can be believed. The pool itself
  // (`picked`) is untouched, so the comparison the panel is reading doesn't
  // change under the reader mid-tick; ticking a row adopts what the boxes show
  // (see togglePick) and hands the selection back to the table.
  const [yearTicks, setYearTicks] = useState(null); // Set of season strings | null
  const handleYearTicks = useCallback((list) => {
    setYearTicks(list?.length ? new Set(list) : null);
  }, []);
  // VA vs VA+ (VA + defensive net rating), the same switch the By Season
  // leaderboard carries. VA+ re-scores the whole career table: the sort, the
  // TOT/per-game columns, the bar widths, the career total in the subtitle,
  // and the D-Rating layer inside every drill-in below.
  const [metric, setMetric] = useState("va"); // "va" | "vaPlus"
  // Scroll-driven pinned header, the same mechanism the By Season board uses
  // (leaderboard.js) and for the same reason: who this table is about, which
  // metric it is reading and what the columns mean all scroll off within a
  // couple of rows, and a career opened to its comparison is read entirely
  // below that point. So the header is rendered a SECOND time in a
  // position:fixed overlay, mounted only while the table straddles the top of
  // the viewport and fully unmounted otherwise — position:sticky leaves a ghost
  // white bar on iOS Safari after un-sticking. `fixedBar` holds the overlay's
  // horizontal geometry (matched to the table) or null when it shouldn't show.
  const [fixedBar, setFixedBar] = useState(null);
  const cardElRef = useRef(null);
  const headerFlowRef = useRef(null);
  const [cardMounted, setCardMounted] = useState(false);
  const setCardEl = useCallback((node) => { cardElRef.current = node; setCardMounted(!!node); }, []);
  useEffect(() => {
    if (!cardMounted) return;
    const measure = () => {
      const card = cardElRef.current;
      const head = headerFlowRef.current;
      if (!card || !head) return;
      const r = card.getBoundingClientRect();
      const h = head.offsetHeight || 72;
      // Hand over exactly where the real header leaves: show once the in-flow
      // copy's top has passed above the viewport, and release once the table's
      // bottom rises to within one header's height, so the bar goes away with
      // the thing it heads rather than hanging over what follows.
      const show = head.getBoundingClientRect().top < 0 && r.bottom > h;
      // The table sits in a card inset px-2, and the bar is inset px-2 too,
      // so laid out at the card's own width its CONTENTS line up column for
      // column with the rows scrolling underneath.
      const geom = { left: Math.round(r.left), width: Math.round(r.width) };
      setFixedBar((prev) => {
        if (!show) return prev === null ? prev : null;
        return prev && prev.left === geom.left && prev.width === geom.width ? prev : geom;
      });
    };
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure(); }); };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    // Opening a season, ticking a run, taking a comparison — all resize the
    // table with no scroll event of their own, which would strand the overlay
    // stale (or missing) until the next touch.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onScroll) : null;
    if (ro && cardElRef.current) ro.observe(cardElRef.current);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (ro) ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [cardMounted]);
  const defs = useDefRatings();
  // Playoff runs are rated on the playoff sample; the other two scopes on the
  // regular-season one, matching the drill-ins below.
  const defScope = scope === "playoffs" ? "po" : "rs";

  // Team and G stay mutually exclusive with each other — two dotted-underline
  // hints at once reads as ambiguous about what the next tap does. Selection
  // mode is NOT part of that exclusion: it isn't a one-shot arm but a visible
  // mode with its own affordance in its own column, and it has to compose with
  // both filters. Arming G specifically is the ONLY way to set a min-games
  // threshold, so taking selection down with it would have made "filter by G,
  // then pare the picks to what's left" impossible.
  const armTeam = () => { setGArmed(false); setTeamArmed((v) => !v); };
  const armG = () => { setTeamArmed(false); setGArmed((v) => !v); };

  const togglePick = (season) => {
    setPicked((prev) => {
      // Whatever the boxes are showing is what a tap edits. With the chart's
      // career years mirrored into them, ticking a row starts from THAT shape
      // rather than from the pool it replaced on screen — otherwise a tap on a
      // box you can see ticked would tick it again, and the row selection the
      // reader thought they were editing would jump back into view.
      const next = new Set(yearTicks || prev);
      if (next.has(season)) next.delete(season); else next.add(season);
      return next;
    });
  };
  const exitSelect = () => {
    setSelecting(false);
    setPicked(new Set());
    setPickOverride(null);
    setMultiCompare(null);
  };

  // Season whose row is waiting to be scrolled into view after a navigation.
  const [pendingScroll, setPendingScroll] = useState(null);
  // A comparison the incoming navigation asked the opened season to land in,
  // held as { season, compare } so only that row's breakdown picks it up.
  const [rowCompare, setRowCompare] = useState(null);
  const clearRowCompare = useCallback(() => setRowCompare(null), []);
  // The open season and its comparison, for the page's link — or, while a
  // navigation is still waiting to land, the season and comparison it names.
  const [rowVs, setRowVs] = useState(null);
  useShareReport(openSeason
    ? { ps: openSeason, vs: rowVs || (rowCompare?.season === openSeason ? rowCompare.compare : null) }
    : { ps: pendingSeason || null, vs: pendingSeason ? pendingCompare || null : null });

  const runNoun = scope === "playoffs" ? "playoff run" : scope === "regular" ? "regular season" : "combined season";
  const seasons = player.seasons;

  // Apply an incoming "open this season" navigation (a trend bar's "Go →").
  // Clear the filters first so the target row can't be filtered out from under
  // the request, then open it and queue the scroll. A season this player
  // doesn't have (or that this scope dropped) just leaves the career view as
  // it is.
  useEffect(() => {
    if (!pendingSeason) return;
    if (seasons.some((s) => s.season === pendingSeason)) {
      setTeamFilter(null);
      setMinGames(null);
      setGArmed(false);
      setOpenSeason(pendingSeason);
      setPendingScroll(pendingSeason);
      // A comparison riding along with the request lands on the same row —
      // including when that row is already the open one (the career-year gate
      // can point at the season you're reading), where nothing remounts and
      // the prop change alone has to carry it.
      setRowCompare(pendingCompare ? { season: pendingSeason, compare: pendingCompare } : null);
    }
    onNavHandled?.();
    onCompareHandled?.();
  }, [pendingSeason, pendingCompare, seasons, onNavHandled, onCompareHandled]);

  // Apply an incoming "tick this run" navigation (a compare panel's chip
  // pointing at a pooled side). Same shape as the season jump one level up —
  // clear the filters so no ticked season is hidden, then put the table in
  // selection mode with exactly those seasons ticked, which is the state
  // ticking them by hand would have produced: the run's aggregate below the
  // table, and the picker offering to choose who to measure it against.
  useEffect(() => {
    if (!pendingRun?.length) return;
    const want = new Set(pendingRun.filter((s) => seasons.some((x) => x.season === s)));
    if (want.size) {
      setTeamFilter(null);
      setMinGames(null);
      setGArmed(false);
      setTeamArmed(false);
      setOpenSeason(null);
      setSelecting(true);
      setPicked(want);
      setPickOverride(null);
      setMultiCompare(null);
    }
    onRunHandled?.();
  }, [pendingRun, seasons, onRunHandled]);

  useEffect(() => {
    if (!pendingScroll) return;
    const el = document.querySelector(`[data-season-row="${pendingScroll}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingScroll(null);
  }, [pendingScroll]);

  // Defensive value added, per season, keyed by season string. The index rows
  // carry no slug of their own (the player entry owns it), so the player's is
  // lent to each row for the ratings lookup — the same join aggregateSeasons
  // makes when it pools a run. Seasons with no rating simply stay out of the
  // map: absent, not zero, so the bars below can tell "no defensive data" from
  // "defense was neutral".
  const dvaBySeason = useMemo(() => {
    const m = new Map();
    if (!defs) return m;
    for (const x of seasons) {
      if (!(x.mp > 0)) continue;
      const info = defVAInfo({ ...x, slug: player.slug || null }, x.mp, rowLga(x), defs, x.season, defScope);
      if (info) m.set(x.season, info.dva);
    }
    return m;
  }, [defs, seasons, player.slug, defScope, rowLga]);
  const dvaOf = (x) => (dvaBySeason.has(x.season) ? dvaBySeason.get(x.season) : null);
  // The active total for a row — VA, or VA+ (VA + dVA) when the toggle is on.
  // A season with no rating keeps its plain VA, so VA+ always exists.
  const vaOf = (x) => (metric === "vaPlus" ? (x.va || 0) + (dvaOf(x) || 0) : (x.va || 0));
  // The career line under the name. Whole career, not the filtered view — a
  // team filter narrows the table, never what the player's career added up to.
  const careerTotal = metric === "vaPlus"
    ? seasons.reduce((t, x) => t + vaOf(x), 0)
    : player.careerVa;

  // Same composite scoring as the By Season leaderboard: each axis as a
  // fraction of that axis's leader, summed.
  const vaPerG = (x) => vaOf(x) / Math.max(1, x.gp);
  const safeRatio = (v, max) => (max > 0 ? v / max : 0);
  const maxVA = Math.max(...seasons.map(vaOf));
  const maxVAperG = Math.max(...seasons.map(vaPerG));
  const composite = (x) => safeRatio(vaOf(x), maxVA) + safeRatio(vaPerG(x), maxVAperG);

  const effectiveSort = minGames != null ? "vaPerG" : sortMode;
  const sortedAll =
    effectiveSort === "totalVA"    ? [...seasons].sort((a, b) => vaOf(b) - vaOf(a)) :
    effectiveSort === "vaPerG"     ? [...seasons].sort((a, b) => vaPerG(b) - vaPerG(a) || vaOf(b) - vaOf(a)) :
    effectiveSort === "seasonDesc" ? [...seasons].sort((a, b) => b.season.localeCompare(a.season)) :
    effectiveSort === "seasonAsc"  ? [...seasons].sort((a, b) => a.season.localeCompare(b.season)) :
                                     [...seasons].sort((a, b) => composite(b) - composite(a) || vaOf(b) - vaOf(a));
  // Season header cycles newest-first → oldest-first → off (back to composite).
  const cycleSeasonSort = () => {
    setMinGames(null);
    setSortMode(
      effectiveSort === "seasonDesc" ? "seasonAsc" :
      effectiveSort === "seasonAsc"  ? "composite" :
                                       "seasonDesc"
    );
  };
  const seasonSorted = effectiveSort === "seasonDesc" || effectiveSort === "seasonAsc";
  // One predicate for "is this row on screen", shared by the rendered list and
  // by the selection pruning below so the two can never disagree about what
  // "shown" means.
  const isVisible = useCallback(
    (x) => (!teamFilter || x.team === teamFilter) && (minGames == null || x.gp >= minGames),
    [teamFilter, minGames]
  );
  const shown = sortedAll.filter(isVisible);
  // Bars follow the active sort: ranked by VA/G, the bar lengths switch to the
  // VA/G scale so their widths track the same metric the rows are ordered on.
  const perG = effectiveSort === "vaPerG";
  const scaleVal = (v, x) => (perG ? v / Math.max(1, x.gp) : v);
  const barValOf = (x) => scaleVal(vaOf(x), x);
  // Bar scale — proportional to abs(value) over the visible list. In VA view
  // the denominator also covers each season's VA+, so the defensive strips
  // below fit on-scale (the biggest VA+ reaches full width and the VA bars
  // shrink a notch to make room), exactly as on the By Season board.
  const maxAbsVa = Math.max(
    ...shown.map((x) => Math.abs(barValOf(x))),
    ...(metric === "va" ? shown.map((x) => {
      const d = dvaOf(x);
      return d == null ? 0 : Math.abs(scaleVal((x.va || 0) + d, x));
    }) : []),
    perG ? 0.05 : 0.5,
  );

  // The # header's three steps. Defined here, below `shown`, because the
  // middle one reaches for it.
  //   1. arm — the rank column becomes check boxes, and the table re-sorts by
  //      VA/G descending (the rate you'd be choosing a run on)
  //   2. armed, nothing ticked — take every season CURRENTLY SHOWN, which is
  //      what makes the team badges compose with this: filter to HOU, tap #
  //      twice, and you have his whole Houston run without ticking nine rows
  //      by hand. A min-games filter narrows it the same way.
  //   3. armed, something ticked — show or hide the picker for the run to
  //      compare against. A run of two or more seasons already opens it on
  //      its own, so there the tap reads as "put that away"; on a single
  //      ticked season it's how you ask for it.
  // The ✕ chip beside the player's name is the way out at every step.
  const tapHash = () => {
    if (!selecting) {
      setTeamArmed(false);
      setGArmed(false);
      // Close whatever was open on the way in. The row tap is the tick now, so
      // a breakdown left standing would have no way to shut short of leaving
      // the mode — and the same close happens when a navigation arms selection
      // for us (see the pendingRun effect).
      setOpenSeason(null);
      // Order the table for the job it's about to do. Picking a run is picking
      // the seasons worth pooling, and VA/G is the rate that says which those
      // are — the composite default mixes in volume, so a short monster year
      // sits below a long ordinary one exactly where you're choosing between
      // them. The VA/G header still toggles back to the default sort, and a
      // min-games filter already forces this order anyway (effectiveSort).
      setSortMode("vaPerG");
      setSelecting(true);
      return;
    }
    if (picked.size === 0) {
      if (shown.length) setPicked(new Set(shown.map((x) => x.season)));
      return;
    }
    setPickOverride({ key: pickKey, open: !picking });
  };

  // Narrowing the table drops any pick it hides. A selection you can't see is
  // one you can't correct: filtered to OKC, the chip would read "4 seasons"
  // over three visible ticks, with a LAC year still silently in the pool. So
  // the rule is that the selection never outruns what's on screen — filtering
  // to a team, or to a games threshold, is also a way to pare it down.
  //
  // Widening does NOT tick anything back on. Restoring a hidden pick would
  // undo a removal the filter just made on your behalf, and re-ticking rows is
  // the one direction that's easy to do by hand (or with a second # tap).
  useEffect(() => {
    setPicked((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(seasons.filter(isVisible).map((x) => x.season));
      const next = new Set();
      for (const s of prev) if (visible.has(s)) next.add(s);
      // Same set — hand back the identical object so this can't loop.
      return next.size === prev.size ? prev : next;
    });
  }, [seasons, isVisible]);

  // The A side of a multi-season comparison: the ticked seasons pooled into
  // one row against one volume-weighted baseline (see lib/multi-season.js).
  const selectedSeasons = useMemo(
    () => seasons.filter((x) => picked.has(x.season)),
    [seasons, picked]
  );
  const aggA = useMemo(
    () => (selectedSeasons.length
      ? aggregateSeasons(selectedSeasons, { name: player.name, slug: player.slug || null }, rowLga)
      : null),
    [selectedSeasons, player.name, player.slug, rowLga]
  );
  // What the table SHOWS as ticked, and what the chip counts — the chart's
  // mirrored years while there are any, the pool otherwise. Only the display
  // reads this; `selectedSeasons` and `aggA` above stay the pool, so the
  // comparison being read never shifts under a tick made in the chart.
  const boxPicks = yearTicks || picked;
  const boxSeasons = useMemo(
    () => (yearTicks ? seasons.filter((x) => yearTicks.has(x.season)) : selectedSeasons),
    [yearTicks, seasons, selectedSeasons]
  );
  const boxGames = boxSeasons.reduce((n, x) => n + (x.gp || 0), 0);
  // The chart plots the WHOLE career, so a year ticked down there can belong to
  // a season this table is currently filtering out — a Dallas year under a GSW
  // filter. The box for it simply isn't on screen, which would leave the chip
  // counting more than the reader can see, so the line under the table says how
  // many went that way rather than letting the two numbers quietly disagree.
  const boxHidden = yearTicks ? boxSeasons.filter((x) => !isVisible(x)).length : 0;
  // Only light the D-Rating layer while the table is reading VA+, and then
  // only when a selected season actually has a rating — otherwise the row
  // would read a flat +0.00 and look like a measurement rather than missing
  // data. On plain VA the comparison drops the layer with the rest of the
  // page, so the four groups keep summing to the number the table shows.
  const multiDefActive = useMemo(() => {
    if (!defs || !aggA || metric !== "vaPlus") return false;
    return aggA.seasons.some((x) => x.mp > 0 && defVAInfo(x, x.mp, rowLga(x), defs, x.season, defScope) != null);
  }, [defs, aggA, defScope, metric, rowLga]);
  const multiContext = useMemo(
    () => (contextData ? { ...contextData, self: player, scope, season: null, onNavigateToPlayer, onNavigateToRun } : null),
    [contextData, player, scope, onNavigateToPlayer, onNavigateToRun]
  );

  const contextFor = (s) =>
    contextData ? { ...contextData, self: player, scope, season: s.season, onNavigateToPlayer, onNavigateToRun } : null;
  const navFor = (i) => ({
    onPrev: i > 0 ? () => setOpenSeason(shown[i - 1].season) : undefined,
    onNext: i < shown.length - 1 ? () => setOpenSeason(shown[i + 1].season) : undefined,
  });

  // The player display and the column labels — the header of this table,
  // rendered in flow below and again in the pinned overlay while the table is
  // scrolled past. One block, used twice, so the two copies cannot drift.
  const headerBlock = (
    <>
      {/* Stacked on a phone, side by side from sm up: the chip stack squeezed
          the name column to a third of the width, which wrapped a
          well-travelled career's subtitle into four lines. Given its own row,
          the subtitle reads across the whole card and the chips keep their
          full labels. */}
      <div className="mb-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1.5 sm:gap-2">
        <div className="min-w-0">
          {/* The selection chip rides on the NAME's line rather than in the
              filter stack at the right: the subtitle under it already wraps to
              two lines for a well-travelled career, and a chip squeezed into
              the narrow right-hand column wrapped its own label with it. Here
              it sits beside a short string with the whole row to grow into. */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-base font-bold text-stone-900">{player.name}</h3>
            {selecting && (
              <button
                onClick={exitSelect}
                className="text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1 text-amber-900 whitespace-nowrap shrink-0 self-center"
                style={{ backgroundColor: GOLD_BG, borderColor: withAlpha(GOLD, 0.5) }}
                // The only way out of the mode, and so also the way back to the
                // breakdowns — say both, since the rows no longer open them.
                title={yearTicks
                  ? "The career years ticked in the comparison below — ✕ stops picking seasons and clears the selection"
                  : "Stop picking seasons — rows go back to opening their breakdown"}
                aria-label="Stop picking seasons and clear the selection"
              >
                {/* Counts what the boxes show, so the chip and the ticked rows
                    can never disagree — including while the chart below is
                    driving them. */}
                {boxPicks.size === 0
                  ? "Pick seasons"
                  : `${boxPicks.size} season${boxPicks.size === 1 ? "" : "s"}`}
                <span className="opacity-60">✕</span>
              </button>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-stone-500 mt-0.5">
            {player.seasons.length} {runNoun}{player.seasons.length === 1 ? "" : "s"} · {player.teams.join(" / ")} · career {metric === "vaPlus" ? "VA+" : "VA"}{" "}
            {/* The career line follows the toggle too — a table reading VA+
                under a VA career total would be two different careers. */}
            <span className="tabular-nums text-stone-700 font-semibold">{careerTotal.toFixed(1)}</span>
          </div>
        </div>
        {/* The chip stack wraps rather than compressing: with the metric
            toggle now standing beside a team filter and a games threshold,
            three chips and a long name can't share one line on a phone — so on
            a phone they don't, and the stack takes a row of its own. It stays
            right-aligned in either layout, so the chips sit under the card's
            right edge rather than under the name they no longer sit beside. */}
        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:pt-1 sm:shrink-0">
          {/* Which baseline the scoring-volume term is measured against. Same
              state as the switch under the tab strip, put here because this
              board is one of the things it re-scores — the career total on the
              left included. */}
          <UsgAdjChip />
          {/* VA vs VA+ (adds defensive net rating). Midnight purple when on —
              the same control, in the same palette, as the By Season board's. */}
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
              className="text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1 bg-stone-100 text-stone-700 border-stone-300"
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
                className="text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1"
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
        <button
          type="button"
          onClick={tapHash}
          className={`w-6 text-right uppercase tracking-wider cursor-pointer hover:text-stone-900 ${selecting ? "text-stone-900 font-bold underline" : ""}`}
          title={!selecting
            ? "Tap to pick multiple seasons — the table sorts by VA/G — then tap # again to compare them against another player’s run"
            : picked.size === 0
            ? `Tap seasons to tick them — or tap # again to take all ${shown.length} shown${teamFilter || minGames != null ? " under the current filter" : ""}`
            : `Compare these ${picked.size} seasons against another player’s run`}
          aria-pressed={selecting}
        >
          {selecting && picked.size > 0 ? "▸#" : "#"}
        </button>
        {canOpenTeam ? (
          <button
            type="button"
            onClick={armTeam}
            className={`w-10 text-left uppercase tracking-wider cursor-pointer hover:text-stone-900 ${teamArmed ? "text-stone-900 font-bold underline" : ""}`}
            title="Tap, then tap a team card to open that team’s By Season leaderboard with this player’s row open"
            aria-pressed={teamArmed}
          >
            Team
          </button>
        ) : (
          <span className="w-10">Team</span>
        )}
        <button
          type="button"
          onClick={cycleSeasonSort}
          className={`flex-1 text-left uppercase tracking-wider cursor-pointer hover:text-stone-900 ${seasonSorted ? "text-stone-900 font-semibold" : ""}`}
          title="Sort by season — newest first, then oldest first, then back to the default order"
          aria-label="Sort by season"
          aria-pressed={seasonSorted}
        >
          Season{effectiveSort === "seasonDesc" ? " ▼" : effectiveSort === "seasonAsc" ? " ▲" : ""}
        </button>
        <button
          type="button"
          onClick={armG}
          className={`w-6 text-right uppercase tracking-wider cursor-pointer hover:text-stone-900 ${gArmed ? "text-stone-900 font-bold underline" : ""}`}
          title="Tap, then tap a season's G to filter to at least that many games"
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
        {/* w-14/w-11 (mirrored in the row cells below): "TOT VA+ ▼" needs the
            extra room so the sort caret stays on one line instead of stacking
            under the label in VA+ mode. */}
        <button
          type="button"
          onClick={() => {
            setMinGames(null);
            setSortMode(sortMode === "totalVA" ? "composite" : "totalVA");
          }}
          className={`w-14 text-right whitespace-nowrap uppercase tracking-wider cursor-pointer hover:text-stone-900 ${effectiveSort === "totalVA" ? "text-stone-900 font-semibold" : ""}`}
          aria-label={metric === "vaPlus" ? "Sort by total VA+" : "Sort by total VA"}
          aria-pressed={effectiveSort === "totalVA"}
        >
          {metric === "vaPlus" ? "TOT VA+" : "TOT VA"}{effectiveSort === "totalVA" ? " ▼" : ""}
        </button>
        <button
          type="button"
          onClick={() => {
            setMinGames(null);
            setSortMode(sortMode === "vaPerG" ? "composite" : "vaPerG");
          }}
          className={`w-11 text-right whitespace-nowrap uppercase tracking-wider cursor-pointer hover:text-stone-900 ${effectiveSort === "vaPerG" ? "text-stone-900 font-semibold" : ""}`}
          aria-label={metric === "vaPlus" ? "Sort by VA+ per game" : "Sort by VA per game"}
          aria-pressed={effectiveSort === "vaPerG"}
        >
          {metric === "vaPlus" ? "VA+/G" : "VA/G"}{effectiveSort === "vaPerG" ? " ▼" : ""}
        </button>
      </div>
    </>
  );

  return (
    <>
    <div ref={setCardEl}>
      <button
        onClick={onBack}
        className="cs-press inline-flex items-center gap-1 px-3 py-1.5 mb-3 rounded-full bg-white border border-stone-200 text-[12px] font-semibold text-stone-600 hover:text-stone-900"
      >
        ‹ All players
      </button>
      <PlayerHero
        player={player}
        vaOf={vaOf}
        metric={metric}
        runNoun={runNoun}
        openSeason={openSeason}
        onOpenSeason={(season) => { setOpenSeason(season); setPendingScroll(season); }}
      />
      <div className="cs-card overflow-hidden px-2 pt-3 mb-3">
      <div ref={headerFlowRef}>{headerBlock}</div>
      {shown.map((s, i) => {
        const rank = sortedAll.indexOf(s) + 1;
        const sOpen = openSeason === s.season;
        const isPicked = boxPicks.has(s.season);
        const tc = teamColor(s.team);
        // Armed cards wear the team color at full strength — solid border, a
        // deeper fill, a soft ring around it, and a chevron — so it's obvious
        // which cells the next tap acts on and that the tap goes somewhere.
        const badgeStyle = teamArmed
          ? { backgroundColor: withAlpha(tc, 0.26), color: tc, borderColor: tc, boxShadow: `0 0 0 2px ${withAlpha(tc, 0.22)}` }
          : { backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) };
        const rowVa = vaOf(s);
        const rowVaPerG = rowVa / Math.max(1, s.gp);
        const barColor = rowVa >= 0 ? withAlpha(tc, 0.16) : withAlpha("#dc2626", 0.10);
        const barPct = (Math.abs(barValOf(s)) / maxAbsVa) * 100;
        const rowDva = dvaOf(s);
        const gp = s.gp || 1;
        const eff = valueAddParts(s, rowLga(s)).efficiency;
        // What a tap on the row body does. Armed, the row IS the check box;
        // unarmed it's the disclosure it has always been.
        const activate = () => {
          if (selecting) { togglePick(s.season); return; }
          setOpenSeason(sOpen ? null : s.season);
        };
        return (
          <div
            key={s.season}
            data-season-row={s.season}
            className="border-b border-stone-100 last:border-0"
            // Picked rows carry a gold left edge AND a gold wash so the
            // selection stays legible once the comparison below has pushed the
            // table up the screen. The wash is state, not feedback: it says
            // "this one is in the pool" and nothing about what was touched
            // last. A hover tint said the second thing, and on a touch screen
            // :hover sticks to the last row tapped — so a row you had just
            // UNTICKED kept the highlight as you scrolled away, which is the
            // one thing the color must never claim.
            //
            // It sits on the wrapper, under the team-colored VA bar rather
            // than over it: the bar is the row's measurement and outranks the
            // selection for that space. Lighter than the chip's GOLD_BG too —
            // a whole row of it at chip strength buries the numbers.
            style={isPicked
              ? { boxShadow: `inset 3px 0 0 0 ${GOLD}`, backgroundColor: withAlpha("#fbbf24", 0.16) }
              : undefined}
          >
            <div className="relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 pointer-events-none"
                style={{ width: `${barPct}%`, backgroundColor: barColor }}
                aria-hidden
              />
              {/* Defensive strip (VA view only): a full-length VA+ underline on
                  the bar's own scale, running from zero to the season's VA+ —
                  so its right edge marks VA+ against the bar's end, reaching
                  past it (gold) when defense adds and stopping short (red)
                  when it subtracts. The VA+ view drops it: its main bar
                  already contains dVA. */}
              {metric === "va" && rowDva != null && rowDva !== 0 && (
                <div
                  className="absolute bottom-0 left-0 h-[3px] pointer-events-none"
                  style={{
                    width: `${(Math.abs(scaleVal((s.va || 0) + rowDva, s)) / maxAbsVa) * 100}%`,
                    backgroundColor: rowDva > 0 ? withAlpha(GOLD, 0.5) : withAlpha("#dc2626", 0.3),
                  }}
                  aria-hidden
                />
              )}
              <div
                role={selecting ? "checkbox" : "button"}
                aria-checked={selecting ? isPicked : undefined}
                aria-label={selecting
                  ? `${isPicked ? "Remove" : "Add"} ${s.season} ${isPicked ? "from" : "to"} the compared run — leave season picking to open the breakdown`
                  : `Open the ${s.season} breakdown`}
                tabIndex={0}
                onClick={activate}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activate();
                  }
                }}
                className={`relative w-full flex items-center gap-2 text-[10px] py-1.5 px-2 text-left cursor-pointer ${sOpen ? "bg-stone-100/60" : ""}`}
              >
                {selecting ? (
                  // The rank column becomes the check box while selecting —
                  // painted, not pressed. The row around it carries the tap, so
                  // a control here would only be a second, smaller way to do
                  // the same thing, and a nested one at that.
                  <span className="w-6 flex items-center justify-end pr-0.5" aria-hidden>
                    <span
                      className="inline-block w-3 h-3 border rounded-[1px]"
                      style={isPicked
                        ? { backgroundColor: tc, borderColor: tc, boxShadow: `0 0 0 2px ${withAlpha(tc, 0.22)}` }
                        : { backgroundColor: "#ffffff", borderColor: "#a8a29e" }}
                    />
                  </span>
                ) : (
                  <span className="w-6 text-right tabular-nums text-stone-500">{rank}</span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (teamArmed && canOpenTeam) {
                      setTeamArmed(false);
                      // Carry the player's identity across, not just the
                      // team-season: the crossing is "show me this season
                      // around them", so the leaderboard opens their row
                      // inside the team filter. Slug first (stable across
                      // data sources), name as the fallback join.
                      onOpenTeamSeason({ season: s.season, team: s.team, name: player.name, slug: player.slug || null });
                      return;
                    }
                    setTeamFilter(teamFilter === s.team ? null : s.team);
                  }}
                  style={badgeStyle}
                  className="w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 border hover:brightness-95"
                  aria-label={teamArmed && canOpenTeam
                    ? `Open ${s.team} in the ${s.season} By Season leaderboard with ${player.name}’s row expanded`
                    : `Filter by ${s.team}`}
                >
                  <span className="flex items-center justify-center gap-px leading-none">
                    {s.team}
                    {teamArmed && canOpenTeam && <span className="text-[8px]" aria-hidden>›</span>}
                  </span>
                </button>
                <span className="flex-1 truncate text-stone-800 font-semibold tabular-nums">
                  {/* The disclosure mark goes away while picking. It promises a
                      panel this tap no longer opens, and the check box at the
                      head of the row is the state worth showing there. */}
                  {!selecting && <span className="text-stone-400 mr-1 font-normal">{sOpen ? "▾" : "▸"}</span>}
                  {s.season}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    // Unarmed tap on an inactive G is a mis-tap: fall through
                    // (no stopPropagation) so it bubbles to the row and does
                    // whatever the row does — tick it while picking, open the
                    // breakdown otherwise — instead of doing nothing.
                    if (!gArmed && minGames !== s.gp) return;
                    e.stopPropagation();
                    setMinGames(minGames === s.gp ? null : s.gp);
                    setGArmed(false);
                  }}
                  className={`w-6 text-right tabular-nums cursor-pointer ${gArmed || minGames === s.gp ? "hover:text-stone-900 hover:underline" : ""} ${minGames === s.gp ? "font-semibold text-stone-900" : gArmed ? "text-stone-700 underline decoration-dotted" : "text-stone-500"}`}
                  aria-label={gArmed ? `Filter to seasons with at least ${s.gp} games` : `${s.gp} games (tap the G header to enable filtering)`}
                >{s.gp}</button>
                <span className="hidden sm:block w-8 text-right tabular-nums font-bold text-stone-900">{(s.pts / gp).toFixed(1)}</span>
                <span className={`hidden sm:block w-9 text-right tabular-nums font-semibold ${eff / gp < 0 ? "text-red-600" : "text-stone-700"}`}>{(eff / gp).toFixed(1)}</span>
                <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{((s.drb + s.orb) / gp).toFixed(1)}</span>
                <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(s.ast / gp).toFixed(1)}</span>
                <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(s.stl / gp).toFixed(1)}</span>
                <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(s.blk / gp).toFixed(1)}</span>
                <span className={`w-14 text-right tabular-nums font-bold ${rowVa < 0 ? "text-red-600" : "text-stone-900"}`}>{rowVa.toFixed(1)}</span>
                <span className={`w-11 text-right tabular-nums ${rowVaPerG < 0 ? "text-red-600" : "text-stone-700"}`}>{rowVaPerG.toFixed(2)}</span>
              </div>
              {/* Below replacement: a light rule down the season's right edge.
                  Last in the row so it paints over the open-row wash rather
                  than under it, and pointer-transparent so it stays out of the
                  way of the tap that opens the breakdown or ticks the season. */}
              {rowVa < 0 && (
                <div
                  className="absolute inset-y-0 right-0 w-[3px] pointer-events-none"
                  style={{ backgroundColor: NEGATIVE_EDGE }}
                  aria-hidden
                />
              )}
            </div>
            {sOpen && <CompareSlotProvider value={setRowVs}>{scope === "playoffs" ? (
              <PlayerSeasonDrill
                s={s}
                indexPlayer={player}
                context={contextFor(s)}
                showDRating={metric === "vaPlus"}
                pendingCompare={rowCompare?.season === s.season ? rowCompare.compare : null}
                onCompareHandled={clearRowCompare}
                {...navFor(i)}
              />
            ) : (
              <VACategoryBreakdown
                player={s}
                lga={rowLga(s)}
                baseline="NBA"
                context={contextFor(s)}
                showDRating={metric === "vaPlus"}
                pendingCompare={rowCompare?.season === s.season ? rowCompare.compare : null}
                onCompareHandled={clearRowCompare}
              />
            )}</CompareSlotProvider>}
          </div>
        );
      })}
      </div>
      {picking && multiContext && aggA && (
        <MultiComparePicker
          context={multiContext}
          self={player}
          // The pooled selection itself, for the picker's opening suggestions
          // — the closest runs of the same length have to be measured against
          // the run, not against the player.
          selfRow={aggA}
          suggestCount={selectedSeasons.length}
          // Career years the selection occupies, for the picker's BEST/YEAR
          // switch. Read off the player's WHOLE career, not the filtered view:
          // career year means position in his own chronology, which a team
          // filter on the table doesn't change.
          selfYears={careerYearsOf(seasons, picked)}
          selfCareerLen={seasons.length}
          // The calendar seasons themselves, for the switch's Same Season
          // mode — which asks whether the two were in the league together,
          // not where in either career the run fell.
          selfSeasons={selectedSeasons.map((x) => x.season)}
          // Whether the # tap asked for the panel. Only then does it come to
          // the reader; letting itself in on a second tick never moves the
          // page, however long the career.
          asked={pickAsked}
          // Picking a run leaves the override cleared rather than forced
          // shut: the comparison itself is what keeps the picker away, so
          // clearing the comparison brings it back to choose again.
          onPick={(sel) => { setMultiCompare(sel); setPickOverride(null); }}
          onCancel={() => setPickOverride({ key: pickKey, open: false })}
        />
      )}
      {aggA && multiCompare && multiContext && (
        // The comparison lives under the table, not in place of it: the ticked
        // rows stay on screen above, so a season can be added or dropped and
        // every number here moves with it.
        <div className="mt-3 px-2 py-2 bg-stone-50 border border-stone-200 rounded">
          <div className="flex justify-between items-center gap-1 mb-1.5">
            {/* The comparison's chip — and, while the panel's chart has a
                career-year selection under it, that selection's chip instead:
                the seasons named here stop being what the card measures the
                moment those years replace the two rows, and two chips
                disagreeing about the same comparison is worse than one that
                moves. ✕ then steps back to this comparison rather than
                dropping it. */}
            <button
              onClick={() => (careerPick ? careerPick.clear() : setMultiCompare(null))}
              className="min-w-0 overflow-hidden text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border font-semibold inline-flex items-center gap-1 text-amber-900"
              // Gold in every state, like the Compare button it replaces —
              // the compared player's palette read as his color rather than as
              // a control, and went wrong outright once the chart below
              // repaletted him for a career-year selection.
              style={{ backgroundColor: GOLD_BG, borderColor: withAlpha(GOLD, 0.5) }}
              title={careerPick ? `Back to ${shortName(multiCompare.name)} ${multiCompare.row.spanLabel}` : `vs ${shortName(multiCompare.name)} ${multiCompare.row.spanLabel}`}
              aria-label={careerPick ? "Clear the career-year selection" : "Clear comparison"}
            >
              {/* One line, always — see CompareChipLabel: a long surname
                  wrapped the chip onto a second row and pushed the
                  Values/Percentiles toggle beside it out of line. */}
              <CompareChipLabel
                text={careerPick ? careerPick.label : `vs ${shortName(multiCompare.name)}`}
                tail={careerPick ? null : multiCompare.row.spanLabel}
              />
            </button>
            <div className="shrink-0 inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
              <button onClick={() => setCompareMode("values")} className={`px-1.5 py-0.5 ${compareMode === "values" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Values</button>
              <button onClick={() => setCompareMode("pct")} className={`px-1.5 py-0.5 border-l border-stone-300 ${compareMode === "pct" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Percentiles</button>
            </div>
          </div>
          <ComparePanel
            // Keyed on both selections so changing either side resets the
            // accordions rather than leaving a category open on stale rows.
            key={`${aggA.spanLabel}:${multiCompare.slug || multiCompare.name}:${multiCompare.row.spanLabel}`}
            a={aggA}
            b={multiCompare.row}
            aSeasons={player.seasons}
            bSeasons={multiCompare.seasons}
            context={multiContext}
            rateMode="perG"
            mode={compareMode}
            setMode={setCompareMode}
            defs={defs}
            defActive={multiDefActive}
            defScope={defScope}
            onPickChange={setCareerPick}
            // Career years ticked in the panel's chart, back up to the table's
            // boxes — the same selection, said in both places at once.
            onYearTicks={handleYearTicks}
          />
        </div>
      )}
      <div className="text-[10px] text-stone-400 italic mt-2 px-2">
        {selecting
          // The chart below owns the boxes for as long as its ticks are on
          // them, so the line under the table follows them too. Say which way
          // each tap goes from here: Compare → down there reads the years, a
          // season tapped up here takes them as the pool instead.
          ? yearTicks
            ? `${boxPicks.size} career year${boxPicks.size === 1 ? "" : "s"} ticked below · ${boxGames} G${boxHidden ? ` · ${boxHidden} hidden by the current filter` : ""} — Compare → reads them, or tap a season here to pool exactly these.`
            : picked.size === 0
            // Said once, at the moment the mode is armed and nothing is ticked
            // yet: the rows tick now, and the ✕ is what hands them back.
            ? `Tap any season to tick it — or tap # again to take all ${shown.length} shown${teamFilter ? ` for ${teamFilter}` : ""}${minGames != null ? ` with ≥${minGames} games` : ""}. ✕ to go back to breakdowns.`
            : multiCompare
            ? `Pooling ${picked.size} season${picked.size === 1 ? "" : "s"} · ${selectedSeasons.reduce((n, x) => n + (x.gp || 0), 0)} G — tap another season to fold it in, or tap # to change who it’s measured against.`
            : picked.size === 1
            ? "1 season ticked — tap another to pool a run, or tap # to compare this one."
            : picking
            ? `${picked.size} seasons ticked · ${selectedSeasons.reduce((n, x) => n + (x.gp || 0), 0)} G — take a run below to compare against, or tap another season to fold it in.`
            : `${picked.size} seasons ticked · ${selectedSeasons.reduce((n, x) => n + (x.gp || 0), 0)} G — tap # to pick the run to compare against.`
          : "Tap a season for the per-stat breakdown, then a category for its league context."}
      </div>
    </div>
    {/* Pinned header overlay — position:fixed (not sticky) and only in the DOM
        while scrolled into the career table, aligned to its width. It carries
        the whole player display, so the filters and the metric toggle stay
        reachable from the comparison at the foot of the page, not only from
        the top of it. The white ground and the rule under it are the overlay's
        own: in flow this header sits on the page, with the column labels'
        border for its edge. */}
    {fixedBar && (
      <div
        className="fixed top-0 z-30 bg-white/95 backdrop-blur border-x border-b border-stone-200 rounded-b-2xl shadow-[0_10px_24px_-14px_rgba(0,0,0,0.35)] px-2 pt-2"
        style={{ left: fixedBar.left, width: fixedBar.width }}
      >
        {headerBlock}
      </div>
    )}
    </>
  );
}


// By Player playoff drill-in: lazily fetch the season's leaderboard (which
// carries the per-game logs and series list) plus the rs totals, then render
// the exact game-chart VABreakdown the By Season leaderboard uses. Falls back
// to the season-totals category breakdown when no game log exists.
export function PlayerSeasonDrill({ s, indexPlayer, context, showDRating = true, onPrev, onNext, pendingCompare = null, onCompareHandled = null }) {
  const season = s.season;
  // A playoff run, so the blended playoff baseline — and the regular-season one
  // alongside it for VABreakdown's "what he normally produces" ticks, which are
  // scored on the player's regular-season line (spec §4.8).
  const lgaS = useSeasonLga(season, "po");
  const rsLgaS = useSeasonLga(season);
  const [lb, setLb] = useState(null);
  const [rs, setRs] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLb(null);
    setRs(null);
    setFailed(false);
    fetchBakedJson(`/api/leaderboard?season=${season}`)
      .then((d) => { if (!cancelled) setLb(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    fetchBakedJson(`/api/regular-season?season=${season}`)
      .then((d) => { if (!cancelled) setRs(d); })
      .catch(() => {}); // reference ticks are optional
    return () => { cancelled = true; };
  }, [season]);

  // The route bakes VA against the standard baseline, on the row and on each
  // of its per-game splits; under USG-ADJ both are re-priced here, so this
  // card's header, its bars and its game tiles read the same currency as the
  // career table that opened it (lib/va-mode.js).
  const row = useMemo(() => {
    if (!lb?.players) return null;
    const n = normalizeName(indexPlayer.name);
    const hit = lb.players.find((p) =>
      (indexPlayer.slug && p.slug === indexPlayer.slug) || normalizeName(p.name) === n
    ) || null;
    return hit ? usgAdjRows([hit], lgaS)[0] : null;
  }, [lb, indexPlayer, lgaS]);

  if (failed || (lb && (!row || !row.games?.length))) {
    return (
      <VACategoryBreakdown
        player={s}
        lga={lgaS}
        baseline="NBA playoff"
        context={context}
        showDRating={showDRating}
        pendingCompare={pendingCompare}
        onCompareHandled={onCompareHandled}
      />
    );
  }
  if (!lb) {
    return <div className="px-2 py-3 text-[10px] text-stone-500 italic text-center border-t border-stone-200">Loading game log…</div>;
  }

  const roundBySeries = Object.fromEntries((lb.series || []).map((x) => [x.idx, x.round]));
  const values = row.games.map((g) => g.va);
  const byGame = row.games.map((g) => g.va == null ? null : ({
    team: row.team, name: row.name, gp: 1, va: g.va,
    mp: g.mp, pts: g.pts, reb: g.reb, drb: g.drb, orb: g.orb,
    ast: g.ast, stl: g.stl, blk: g.blk, tov: g.tov,
    fgm: g.fgm, fga: g.fga, tpm: g.tpm, tpa: g.tpa, ftm: g.ftm, fta: g.fta,
  }));
  const gameContext = row.games.map((g) => ({ opp: g.opp, seriesIdx: g.seriesIdx, seriesGameNumber: g.seriesGameNumber, round: roundBySeries[g.seriesIdx] }));
  const partitions = [];
  for (let j = 1; j < row.games.length; j++) {
    if (row.games[j].seriesIdx !== row.games[j - 1].seriesIdx) partitions.push(j);
  }
  const rsTotals = rs?.players
    ? (rs.players.find((p) => (row.slug && p.slug === row.slug))
      || rs.players.find((p) => p.name === row.name)
      || rs.players.find((p) => normalizeName(p.name) === normalizeName(row.name))
      || null)
    : null;

  return (
    <VABreakdown
      p={row}
      lga={lgaS}
      rsLga={rsLgaS}
      teams={{}}
      rate
      season={season}
      defScope="po"
      gameSeries={values}
      byGame={byGame}
      gameContext={gameContext}
      partitions={partitions}
      useTeamColor
      breakdownTitle="Playoff Breakdown"
      gameTileLabel="Playoff Game"
      enableSeriesDrill
      playerConf={TEAM_CONF[row.team] || TEAMS[row.team]?.conf || null}
      regularSeasonTotals={rsTotals}
      context={context}
      showDRating={showDRating}
      pendingCompare={pendingCompare}
      onCompareHandled={onCompareHandled}
      onPrev={onPrev}
      onNext={onNext}
    />
  );
}


// The top of a player's page: who he is at a glance — avatar, teams, the
// career in three numbers — and his career as a bar per season, colored by
// the team he played it for. Tapping a bar opens that season's row below.
function PlayerHero({ player, vaOf, metric, runNoun, openSeason, onOpenSeason }) {
  const seasons = [...player.seasons].sort((a, b) => a.season.localeCompare(b.season));
  const isTeam = (t) => t && !/^(TOT|\dTM)$/.test(t);
  const latestTeam = [...seasons].reverse().map((s) => s.team).find(isTeam) || player.teams[0];
  const teams = [];
  for (const s of seasons) if (isTeam(s.team) && !teams.includes(s.team)) teams.push(s.team);
  const vals = seasons.map((s) => vaOf(s));
  const career = vals.reduce((a, v) => a + v, 0);
  const bestI = vals.indexOf(Math.max(...vals));
  const peak = seasons.filter((s) => s.gp >= 10).reduce((m, s) => Math.max(m, vaOf(s) / s.gp), -Infinity);
  const max = Math.max(...vals.map(Math.abs), 1);
  const hasNeg = vals.some((v) => v < 0);
  const H = 64;
  const label = metric === "vaPlus" ? "VA+" : "VA";
  const c = teamColor(latestTeam);
  const yrs = `${seasons[0]?.season.slice(0, 4)}–${String(Number(seasons[seasons.length - 1]?.season.slice(0, 4)) + 1)}`;
  const tile = (k, v, sub) => (
    <div className="flex-1 min-w-0 rounded-xl bg-stone-50 px-2.5 py-2">
      <div className="text-[10px] font-semibold text-stone-500">{k}</div>
      <div className="text-[18px] font-black tabular-nums text-stone-900 leading-tight truncate">{v}</div>
      {sub && <div className="text-[10px] text-stone-400 truncate">{sub}</div>}
    </div>
  );
  return (
    <div className="cs-card cs-rise overflow-hidden mb-4">
      <div className="relative px-4 pt-4 pb-3" style={{ background: `linear-gradient(135deg, ${withAlpha(c, 0.16)}, ${withAlpha(c, 0.02)} 60%)` }}>
        <div className="flex items-center gap-3.5">
          <PlayerAvatar name={player.name} team={latestTeam} size={68} />
          <div className="min-w-0">
            <div className="text-[24px] leading-tight font-black text-stone-900 truncate" style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}>{player.name}</div>
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {teams.map((t) => (
                <span key={t} className="px-1.5 py-0.5 rounded-md text-[10px] font-bold" style={{ backgroundColor: withAlpha(teamColor(t), 0.14), color: teamColor(t) }}>{t}</span>
              ))}
              <span className="text-[11px] text-stone-500 ml-0.5">{yrs}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-2 px-3 pt-3">
        {tile(`Career ${label}`, career.toFixed(1), `${seasons.length} ${runNoun.includes("run") ? "run" : "season"}${seasons.length === 1 ? "" : "s"}`)}
        {tile("Best season", vals[bestI]?.toFixed(1), seasons[bestI]?.season)}
        {tile(`Peak ${label}/G`, Number.isFinite(peak) ? peak.toFixed(2) : "–", "10+ games")}
      </div>
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-end gap-[3px]" style={{ height: hasNeg ? H + 18 : H }} role="group" aria-label={`${label} by season — tap a bar to open that season`}>
          {seasons.map((s, i) => {
            const v = vals[i];
            const h = Math.max(2, (Math.abs(v) / max) * H);
            const on = openSeason === s.season;
            const tc = isTeam(s.team) ? teamColor(s.team) : "#a8a29e";
            return (
              <button
                key={s.season}
                type="button"
                onClick={() => onOpenSeason(s.season)}
                title={`${s.season} · ${s.team} · ${v.toFixed(1)} ${label}`}
                aria-label={`${s.season}, ${v.toFixed(1)} ${label} — open this season`}
                className="group flex-1 min-w-[4px] h-full flex flex-col justify-end items-stretch"
                style={hasNeg ? { justifyContent: "flex-start", paddingTop: 0 } : undefined}
              >
                {hasNeg ? (
                  <span className="flex flex-col h-full">
                    <span className="flex-1 flex items-end" style={{ flexBasis: H }}>
                      {v >= 0 && <span className="w-full rounded-t-[3px] transition-opacity" style={{ height: h, background: tc, opacity: on || i === bestI ? 1 : 0.55 }} />}
                    </span>
                    <span className="h-[18px]">
                      {v < 0 && <span className="block w-full rounded-b-[3px]" style={{ height: Math.min(18, h), background: "#dc2626", opacity: 0.6 }} />}
                    </span>
                  </span>
                ) : (
                  <span className="w-full rounded-t-[3px] transition-all duration-200 group-hover:opacity-100" style={{ height: h, background: tc, opacity: on || i === bestI ? 1 : 0.55, outline: on ? `2px solid ${tc}` : undefined, outlineOffset: 1 }} />
                )}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-stone-400 tabular-nums">
          <span>{seasons[0]?.season}</span>
          <span>{label} by season · tap a bar</span>
          <span>{seasons[seasons.length - 1]?.season}</span>
        </div>
      </div>
    </div>
  );
}
