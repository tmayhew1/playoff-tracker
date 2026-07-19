"use client";

import React, { useState, useMemo, useEffect } from "react";
import { TEAMS, TEAM_CONF } from "../teams";
import { valueAddParts, lgaForSeason } from "../scoring";
import { VABreakdown, VACategoryBreakdown } from "./va-breakdown";
import { fetchJsonCached } from "../lib/fetch-cache";
import { normalizeName, teamColor, withAlpha } from "../lib/format";
import { buildScopePools } from "../lib/players";


// "By Player" mode: search the cross-season index from /api/players and show a
// single player's playoff seasons ranked by Value Added.
export function PlayerExplorer({ scope = "playoffs" }) {
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
export function PlayerDetail({ player, scope, contextData, onBack }) {
  const [openSeason, setOpenSeason] = useState(null);
  const [sortMode, setSortMode] = useState("composite");
  const [teamFilter, setTeamFilter] = useState(null);
  // Min-games filter is a two-step tap (arm on the G header, then a row's G)
  // so a stray tap on a G value opens the row instead of filtering. Matches
  // the By Season leaderboard.
  const [minGames, setMinGames] = useState(null);
  const [gArmed, setGArmed] = useState(false);

  const runNoun = scope === "playoffs" ? "playoff run" : scope === "regular" ? "regular season" : "combined season";
  const seasons = player.seasons;

  // Same composite scoring as the By Season leaderboard: each axis as a
  // fraction of that axis's leader, summed.
  const vaPerG = (x) => x.va / Math.max(1, x.gp);
  const safeRatio = (v, max) => (max > 0 ? v / max : 0);
  const maxVA = Math.max(...seasons.map((x) => x.va));
  const maxVAperG = Math.max(...seasons.map(vaPerG));
  const composite = (x) => safeRatio(x.va, maxVA) + safeRatio(vaPerG(x), maxVAperG);

  const effectiveSort = minGames != null ? "vaPerG" : sortMode;
  const sortedAll =
    effectiveSort === "totalVA" ? [...seasons].sort((a, b) => b.va - a.va) :
    effectiveSort === "vaPerG"  ? [...seasons].sort((a, b) => vaPerG(b) - vaPerG(a) || b.va - a.va) :
                                  [...seasons].sort((a, b) => composite(b) - composite(a) || b.va - a.va);
  const teamFiltered = teamFilter ? sortedAll.filter((x) => x.team === teamFilter) : sortedAll;
  const shown = minGames != null ? teamFiltered.filter((x) => x.gp >= minGames) : teamFiltered;
  const maxAbsVa = Math.max(...shown.map((x) => Math.abs(x.va || 0)), 0.5);

  const contextFor = (s) =>
    contextData ? { ...contextData, self: player, scope, season: s.season } : null;
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
        <div>
          <h3 className="text-base font-bold text-stone-900">{player.name}</h3>
          <div className="text-[10px] uppercase tracking-widest text-stone-500 mt-0.5">
            {player.seasons.length} {runNoun}{player.seasons.length === 1 ? "" : "s"} · {player.teams.join(" / ")} · career VA{" "}
            <span className="tabular-nums text-stone-700 font-semibold">{player.careerVa.toFixed(1)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 pt-1">
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
        <span className="w-6 text-right">#</span>
        <span className="w-10">Team</span>
        <span className="flex-1">Season</span>
        <button
          type="button"
          onClick={() => setGArmed((v) => !v)}
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
        const tc = teamColor(s.team);
        const badgeStyle = { backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) };
        const barColor = s.va >= 0 ? withAlpha(tc, 0.16) : withAlpha("#dc2626", 0.10);
        const barPct = (Math.abs(s.va || 0) / maxAbsVa) * 100;
        const gp = s.gp || 1;
        const eff = valueAddParts(s, lgaForSeason(s.season)).efficiency;
        return (
          <div key={s.season} className="border-b border-stone-100 last:border-0">
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
                <span className="w-6 text-right tabular-nums text-stone-500">{rank}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTeamFilter(teamFilter === s.team ? null : s.team);
                  }}
                  style={badgeStyle}
                  className="w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center border hover:brightness-95"
                  aria-label={`Filter by ${s.team}`}
                >{s.team}</button>
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
              <PlayerSeasonDrill s={s} indexPlayer={player} context={contextFor(s)} {...navFor(i)} />
            ) : (
              <VACategoryBreakdown player={s} lga={lgaForSeason(s.season)} baseline="NBA" context={contextFor(s)} />
            ))}
          </div>
        );
      })}
      <div className="text-[10px] text-stone-400 italic mt-2 px-2">Tap a season for the per-stat breakdown, then a category for its league context.</div>
    </div>
  );
}


// By Player playoff drill-in: lazily fetch the season's leaderboard (which
// carries the per-game logs and series list) plus the rs totals, then render
// the exact game-chart VABreakdown the By Season leaderboard uses. Falls back
// to the season-totals category breakdown when no game log exists.
export function PlayerSeasonDrill({ s, indexPlayer, context, onPrev, onNext }) {
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
    return <VACategoryBreakdown player={s} lga={lgaS} baseline="NBA playoff" context={context} />;
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
      onPrev={onPrev}
      onNext={onNext}
    />
  );
}
