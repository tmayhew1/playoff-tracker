"use client";

import { useState, useEffect } from "react";
import { scoreHistory, historyRounds } from "../historical";
import { valueAddParts, potentialPoints, lgaForSeason } from "../scoring";
import { LiveGameBanner } from "./boxscore";
import { BreakdownList, ScoreCard } from "./scoreboard";
import { VABreakdown } from "./va-breakdown";
import { normalizeName, ownerBadge, ownerBg, ownerColor, ownerDot, teamColor, withAlpha } from "../lib/format";


export function HistoryGameList({ games, teamsMap, lga, dimTeam }) {
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


export function SeriesAverages({ games, teamsMap, lga, dimTeam, boxSrc, useTeamColor, season }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [rsLookup, setRsLookup] = useState(null);
  // Tap the G header to arm, then a G value, to filter to players with
  // ≥ that many GP and re-sort by VA/G; lets you compare efficiency at
  // comparable volume within a series. Same two-step mechanic as the
  // playoff leaderboard, so a stray row tap can't filter by accident.
  const [minGames, setMinGames] = useState(null);
  const [gArmed, setGArmed] = useState(false);
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
                <button
                  type="button"
                  onClick={() => setGArmed((v) => !v)}
                  className={`hidden sm:block w-6 text-right uppercase tracking-wider cursor-pointer hover:text-stone-900 ${gArmed ? "text-stone-900 font-bold underline" : ""}`}
                  title="Tap, then tap a player's G to filter to at least that many games"
                  aria-pressed={gArmed}
                >
                  G
                </button>
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
                        className={`hidden sm:block w-6 text-right tabular-nums cursor-pointer ${gArmed || minGames === p.gp ? "hover:text-stone-900 hover:underline" : ""} ${minGames === p.gp ? "font-semibold text-stone-900" : gArmed ? "text-stone-700 underline decoration-dotted" : "text-stone-500"}`}
                        aria-label={gArmed ? `Filter to players with at least ${p.gp} games` : `${p.gp} games (tap the G header to enable filtering)`}
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
                        season={season}
                        defScope="po"
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


export function HistorySeriesRow({ s, teamsMap, lga, roundKey, season }) {
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


export function HistoryRoundSection({ round, teamsMap, lga, season }) {
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


export function HistoryView({ season }) {
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
