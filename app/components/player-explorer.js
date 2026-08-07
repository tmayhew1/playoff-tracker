"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { TEAMS, TEAM_CONF } from "../teams";
import { valueAddParts, lgaForSeason } from "../scoring";
import { VABreakdown, VACategoryBreakdown } from "./va-breakdown";
import { ComparePanel, MultiComparePicker } from "./compare";
import { defVAInfo, useDefRatings } from "../lib/defense";
import { fetchJsonCached } from "../lib/fetch-cache";
import { GOLD, GOLD_BG, normalizeName, shortName, teamColor, withAlpha } from "../lib/format";
import { aggregateSeasons, careerYearsOf } from "../lib/multi-season";
import { buildScopePools } from "../lib/players";


// "By Player" mode: search the cross-season index from /api/players and show a
// single player's playoff seasons ranked by Value Added.
export function PlayerExplorer({ scope = "playoffs", onOpenTeamSeason = null, pendingPlayer = null, onPlayerNavHandled = null }) {
  // One index per scope, cached so flipping the selector doesn't refetch.
  // fetchJsonCached also shares the payload with the By Season context fetch.
  const [cache, setCache] = useState({});
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState(null);
  const selectPlayer = (k) => setSelectedKey(k);
  const index = cache[scope] || null;
  const loading = !index && !error;

  useEffect(() => {
    if (cache[scope]) return;
    let cancelled = false;
    setError(null);
    fetchJsonCached(`/api/players?scope=${scope}`)
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
    // The season row scrolls itself into view; only a plain career-view jump
    // wants the top of the page.
    if (!target.season && typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
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
      setNavSeason(found.seasons.some((s) => s.season === pendingPlayer.season) ? pendingPlayer.season : null);
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
        onOpenTeamSeason={onOpenTeamSeason}
        pendingSeason={navSeason}
        onNavHandled={clearNavSeason}
        pendingCompare={navCompare}
        onCompareHandled={clearNavCompare}
      />
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
        <div className="text-[10px] text-stone-400 italic py-6 text-center">
          Type a name to see their {scope === "playoffs" ? "playoff runs" : scope === "regular" ? "regular seasons" : "combined seasons"} ranked by Value Added.
        </div>
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
              {p.seasons.length} {scope === "playoffs" ? "run" : "season"}{p.seasons.length === 1 ? "" : "s"} ·{" "}
              {p.teams.map((t, ti) => (
                <React.Fragment key={t}>
                  {ti > 0 && "/"}
                  <span className="font-semibold" style={{ color: teamColor(t) }}>{t}</span>
                </React.Fragment>
              ))}{" "}
              · best <span className="tabular-nums text-stone-600">{p.bestVa.toFixed(1)}</span>
            </span>
          </button>
        ))
      )}
    </div>
  );
}


// One player's seasons for the selected scope, rendered with the exact same
// treatment as the By Season leaderboard: composite default sort with
// tappable TOT VA / VA/G column headers, team-color badges that filter, a
// min-games filter on the G column, team-tinted VA bars behind rows, and the
// landscape-only per-game stat columns. Rows expand to the same drill-ins.
export function PlayerDetail({ player, scope, contextData, onBack, onNavigateToPlayer = null, onOpenTeamSeason = null, pendingSeason = null, onNavHandled = null, pendingCompare = null, onCompareHandled = null }) {
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
  // turns the rank column into check boxes and the seasons become selectable;
  // ticking a run then brings up the picker for the OTHER player's run by
  // itself (see `picking`), and tapping # once more puts it away. The ✕ chip
  // beside the player's name is the way out of the whole mode.
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
  // answer. It appears quietly, in place under the table, and comes to the
  // reader only if it opened off screen (see MultiComparePicker).
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
  const [compareMode, setCompareMode] = useState("values"); // "values" | "pct"
  const defs = useDefRatings();

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
      const next = new Set(prev);
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

  useEffect(() => {
    if (!pendingScroll) return;
    const el = document.querySelector(`[data-season-row="${pendingScroll}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingScroll(null);
  }, [pendingScroll]);

  // Same composite scoring as the By Season leaderboard: each axis as a
  // fraction of that axis's leader, summed.
  const vaPerG = (x) => x.va / Math.max(1, x.gp);
  const safeRatio = (v, max) => (max > 0 ? v / max : 0);
  const maxVA = Math.max(...seasons.map((x) => x.va));
  const maxVAperG = Math.max(...seasons.map(vaPerG));
  const composite = (x) => safeRatio(x.va, maxVA) + safeRatio(vaPerG(x), maxVAperG);

  const effectiveSort = minGames != null ? "vaPerG" : sortMode;
  const sortedAll =
    effectiveSort === "totalVA"    ? [...seasons].sort((a, b) => b.va - a.va) :
    effectiveSort === "vaPerG"     ? [...seasons].sort((a, b) => vaPerG(b) - vaPerG(a) || b.va - a.va) :
    effectiveSort === "seasonDesc" ? [...seasons].sort((a, b) => b.season.localeCompare(a.season)) :
    effectiveSort === "seasonAsc"  ? [...seasons].sort((a, b) => a.season.localeCompare(b.season)) :
                                     [...seasons].sort((a, b) => composite(b) - composite(a) || b.va - a.va);
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
  const barValOf = (x) => (perG ? vaPerG(x) : (x.va || 0));
  const maxAbsVa = Math.max(...shown.map((x) => Math.abs(barValOf(x))), perG ? 0.05 : 0.5);

  // The # header's three steps. Defined here, below `shown`, because the
  // middle one reaches for it.
  //   1. arm — the rank column becomes check boxes
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
      ? aggregateSeasons(selectedSeasons, { name: player.name, slug: player.slug || null })
      : null),
    [selectedSeasons, player.name, player.slug]
  );
  // Playoff runs are rated on the playoff sample; the other two scopes on the
  // regular-season one, matching the drill-ins below.
  const defScope = scope === "playoffs" ? "po" : "rs";
  // Only light the D-Rating layer when a selected season actually has a
  // rating — otherwise the row would read a flat +0.00 and look like a
  // measurement rather than missing data.
  const multiDefActive = useMemo(() => {
    if (!defs || !aggA) return false;
    return aggA.seasons.some((x) => x.mp > 0 && defVAInfo(x, x.mp, lgaForSeason(x.season), defs, x.season, defScope) != null);
  }, [defs, aggA, defScope]);
  const multiContext = useMemo(
    () => (contextData ? { ...contextData, self: player, scope, season: null, onNavigateToPlayer } : null),
    [contextData, player, scope, onNavigateToPlayer]
  );

  const contextFor = (s) =>
    contextData ? { ...contextData, self: player, scope, season: s.season, onNavigateToPlayer } : null;
  const navFor = (i) => ({
    onPrev: i > 0 ? () => setOpenSeason(shown[i - 1].season) : undefined,
    onNext: i < shown.length - 1 ? () => setOpenSeason(shown[i + 1].season) : undefined,
  });

  return (
    <div>
      <button
        onClick={onBack}
        className="text-[10px] uppercase tracking-widest text-stone-500 hover:text-stone-900 mb-3"
      >
        ‹ Back to search
      </button>
      <div className="mb-3 flex items-start justify-between gap-2">
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
                aria-label="Clear season selection"
              >
                {picked.size === 0
                  ? "Pick seasons"
                  : `${picked.size} season${picked.size === 1 ? "" : "s"}`}
                <span className="opacity-60">✕</span>
              </button>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-stone-500 mt-0.5">
            {player.seasons.length} {runNoun}{player.seasons.length === 1 ? "" : "s"} · {player.teams.join(" / ")} · career VA{" "}
            <span className="tabular-nums text-stone-700 font-semibold">{player.careerVa.toFixed(1)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 pt-1 shrink-0">
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
            ? "Tap to pick multiple seasons, then tap # again to compare them against another player’s run"
            : picked.size === 0
            ? `Tick seasons — or tap # again to take all ${shown.length} shown${teamFilter || minGames != null ? " under the current filter" : ""}`
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
      {shown.map((s, i) => {
        const rank = sortedAll.indexOf(s) + 1;
        const sOpen = openSeason === s.season;
        const isPicked = picked.has(s.season);
        const tc = teamColor(s.team);
        // Armed cards wear the team color at full strength — solid border, a
        // deeper fill, a soft ring around it, and a chevron — so it's obvious
        // which cells the next tap acts on and that the tap goes somewhere.
        const badgeStyle = teamArmed
          ? { backgroundColor: withAlpha(tc, 0.26), color: tc, borderColor: tc, boxShadow: `0 0 0 2px ${withAlpha(tc, 0.22)}` }
          : { backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) };
        const barColor = s.va >= 0 ? withAlpha(tc, 0.16) : withAlpha("#dc2626", 0.10);
        const barPct = (Math.abs(barValOf(s)) / maxAbsVa) * 100;
        const gp = s.gp || 1;
        const eff = valueAddParts(s, lgaForSeason(s.season)).efficiency;
        return (
          <div
            key={s.season}
            data-season-row={s.season}
            className="border-b border-stone-100 last:border-0"
            // Picked rows carry a gold left edge so the selection stays legible
            // once the comparison below has pushed the table up the screen.
            style={isPicked ? { boxShadow: `inset 3px 0 0 0 ${GOLD}` } : undefined}
          >
            <div className="relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 pointer-events-none"
                style={{ width: `${barPct}%`, backgroundColor: barColor }}
                aria-hidden
              />
              <div
                role="button"
                tabIndex={0}
                onClick={() => setOpenSeason(sOpen ? null : s.season)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenSeason(sOpen ? null : s.season);
                  }
                }}
                className={`relative w-full flex items-center gap-2 text-[10px] py-1.5 px-2 text-left cursor-pointer ${sOpen ? "bg-stone-100/60" : ""}`}
              >
                {selecting ? (
                  // The rank column becomes the check box while selecting. It
                  // stops propagation so ticking a season never also opens its
                  // breakdown — the rest of the row still does.
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isPicked}
                    aria-label={`${isPicked ? "Remove" : "Add"} ${s.season} ${isPicked ? "from" : "to"} the compared run`}
                    onClick={(e) => { e.stopPropagation(); togglePick(s.season); }}
                    className="w-6 flex items-center justify-end pr-0.5"
                  >
                    <span
                      aria-hidden
                      className="inline-block w-3 h-3 border rounded-[1px]"
                      style={isPicked
                        ? { backgroundColor: tc, borderColor: tc, boxShadow: `0 0 0 2px ${withAlpha(tc, 0.22)}` }
                        : { backgroundColor: "#ffffff", borderColor: "#a8a29e" }}
                    />
                  </button>
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
                  <span className="text-stone-400 mr-1 font-normal">{sOpen ? "▾" : "▸"}</span>
                  {s.season}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    // Unarmed tap on an inactive G is a mis-tap: fall through
                    // (no stopPropagation) so it bubbles to the row and opens
                    // the breakdown, instead of doing nothing.
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
                <span className={`w-12 text-right tabular-nums font-bold ${s.va < 0 ? "text-red-600" : "text-stone-900"}`}>{s.va.toFixed(1)}</span>
                <span className={`w-10 text-right tabular-nums ${s.vaPerG < 0 ? "text-red-600" : "text-stone-700"}`}>{s.vaPerG.toFixed(2)}</span>
              </div>
            </div>
            {sOpen && (scope === "playoffs" ? (
              <PlayerSeasonDrill
                s={s}
                indexPlayer={player}
                context={contextFor(s)}
                pendingCompare={rowCompare?.season === s.season ? rowCompare.compare : null}
                onCompareHandled={clearRowCompare}
                {...navFor(i)}
              />
            ) : (
              <VACategoryBreakdown
                player={s}
                lga={lgaForSeason(s.season)}
                baseline="NBA"
                context={contextFor(s)}
                pendingCompare={rowCompare?.season === s.season ? rowCompare.compare : null}
                onCompareHandled={clearRowCompare}
              />
            ))}
          </div>
        );
      })}
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
          // Whether the panel let itself in. Only then does it come to the
          // reader; a # tap asked for it by name and leaves the page put.
          unasked={!pickAsked}
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
            <button
              onClick={() => setMultiCompare(null)}
              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border font-semibold inline-flex items-center gap-1 text-amber-900"
              style={{ backgroundColor: GOLD_BG, borderColor: withAlpha(GOLD, 0.5) }}
              aria-label="Clear comparison"
            >
              vs {shortName(multiCompare.name)} {multiCompare.row.spanLabel} <span className="opacity-60">✕</span>
            </button>
            <div className="inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
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
          />
        </div>
      )}
      <div className="text-[10px] text-stone-400 italic mt-2 px-2">
        {selecting
          ? picked.size === 0
            ? `Tick the seasons to pool — or tap # again to take all ${shown.length} shown${teamFilter ? ` for ${teamFilter}` : ""}${minGames != null ? ` with ≥${minGames} games` : ""}.`
            : multiCompare
            ? `Pooling ${picked.size} season${picked.size === 1 ? "" : "s"} · ${selectedSeasons.reduce((n, x) => n + (x.gp || 0), 0)} G — tick another season to fold it in, or tap # to change who it’s measured against.`
            : picked.size === 1
            ? "1 season ticked — tick another to pool a run, or tap # to compare this one."
            : picking
            ? `${picked.size} seasons ticked · ${selectedSeasons.reduce((n, x) => n + (x.gp || 0), 0)} G — take a run below to compare against, or tick another season to fold it in.`
            : `${picked.size} seasons ticked · ${selectedSeasons.reduce((n, x) => n + (x.gp || 0), 0)} G — tap # to pick the run to compare against.`
          : "Tap a season for the per-stat breakdown, then a category for its league context."}
      </div>
    </div>
  );
}


// By Player playoff drill-in: lazily fetch the season's leaderboard (which
// carries the per-game logs and series list) plus the rs totals, then render
// the exact game-chart VABreakdown the By Season leaderboard uses. Falls back
// to the season-totals category breakdown when no game log exists.
export function PlayerSeasonDrill({ s, indexPlayer, context, onPrev, onNext, pendingCompare = null, onCompareHandled = null }) {
  const season = s.season;
  const lgaS = lgaForSeason(season);
  const [lb, setLb] = useState(null);
  const [rs, setRs] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLb(null);
    setRs(null);
    setFailed(false);
    fetchJsonCached(`/api/leaderboard?season=${season}`)
      .then((d) => { if (!cancelled) setLb(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    fetchJsonCached(`/api/regular-season?season=${season}`)
      .then((d) => { if (!cancelled) setRs(d); })
      .catch(() => {}); // reference ticks are optional
    return () => { cancelled = true; };
  }, [season]);

  const row = useMemo(() => {
    if (!lb?.players) return null;
    const n = normalizeName(indexPlayer.name);
    return lb.players.find((p) =>
      (indexPlayer.slug && p.slug === indexPlayer.slug) || normalizeName(p.name) === n
    ) || null;
  }, [lb, indexPlayer]);

  if (failed || (lb && (!row || !row.games?.length))) {
    return (
      <VACategoryBreakdown
        player={s}
        lga={lgaS}
        baseline="NBA playoff"
        context={context}
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
      pendingCompare={pendingCompare}
      onCompareHandled={onCompareHandled}
      onPrev={onPrev}
      onNext={onNext}
    />
  );
}
