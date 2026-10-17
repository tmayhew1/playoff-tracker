"use client";

import { useEffect, useMemo, useState } from "react";
import { VABreakdown } from "./va-breakdown";
import { fetchBakedJson, fetchJsonCached } from "../lib/fetch-cache";
import { normalizeName, teamColor, withAlpha } from "../lib/format";
import { groupByDay, monthTotals } from "../lib/regular-season-games";

// How many day requests run at once while a month's box scores load.
const CONCURRENCY = 6;
// /api/regular-season/lines takes up to 20 games per request.
const PER_REQUEST = 20;

// A month's league-wide leaders: every player who played in the month, best
// Value Added per game first — the regular season's Series Averages. Box
// scores load the first time the section is opened, a day's games per request
// (/api/regular-season/lines), and are priced here against `lga`, so the
// USG-ADJ switch re-ranks the table without reloading it.
export function MonthAverages({ month, lga, season }) {
  const [open, setOpen] = useState(false);
  const [boxes, setBoxes] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [showAll, setShowAll] = useState(false);
  // A one-game spot-up can top a per-game table, so it opens qualified to
  // players with at least half the month's most games; the chip clears it.
  const [minGames, setMinGames] = useState(undefined);
  const [rsLookup, setRsLookup] = useState(null);

  useEffect(() => {
    if (!open || boxes) return;
    let cancelled = false;
    const requests = [];
    for (const d of groupByDay(month.games)) {
      for (let i = 0; i < d.games.length; i += PER_REQUEST) {
        requests.push(d.games.slice(i, i + PER_REQUEST).map((g) => g.gameId));
      }
    }
    const byId = new Map();
    let done = 0, next = 0;
    setProgress({ done, total: requests.length });
    setError(null);
    const worker = async () => {
      while (!cancelled && next < requests.length) {
        const ids = requests[next++];
        try {
          const d = await fetchJsonCached(`/api/regular-season/lines?ids=${ids.join(",")}`);
          for (const g of d.games || []) byId.set(g.gameId, g);
        } catch {
          // a lost day just leaves its games out; the count below says so
        }
        done += 1;
        if (!cancelled) setProgress({ done, total: requests.length });
      }
    };
    Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(() => {
      if (cancelled) return;
      const ordered = month.games.map((g) => byId.get(g.gameId)).filter(Boolean);
      if (!ordered.length) setError("Box scores unavailable");
      else setBoxes(ordered);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Season totals for the breakdown's season-average reference marks.
  useEffect(() => {
    if (!open || rsLookup || !season) return;
    let cancelled = false;
    fetchBakedJson(`/api/regular-season?season=${season}`)
      .then((d) => {
        if (cancelled || !Array.isArray(d?.players)) return;
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

  const rows = useMemo(() => (boxes ? monthTotals(boxes, lga) : null), [boxes, lga]);
  const qualifier = useMemo(() => (rows?.length ? Math.ceil(Math.max(...rows.map((r) => r.gp)) / 2) : null), [rows]);
  const min = minGames === undefined ? qualifier : minGames;
  const filtered = rows ? (min ? rows.filter((r) => r.gp >= min) : rows) : [];
  const visible = showAll ? filtered : filtered.slice(0, 10);
  const maxAbs = Math.max(...visible.map((r) => Math.abs(r.vapg)), 0.5);

  return (
    <div className="mb-3 border border-stone-300 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-2 py-1.5 text-[10px] uppercase tracking-widest text-stone-600 font-semibold flex items-center gap-1"
      >
        <span className="text-stone-400">{open ? "▾" : "▸"}</span>
        {month.label} Averages
      </button>
      {open && (
        <div className="px-2 pb-2">
          {!rows && !error && progress && (
            <div className="py-2 text-[10px] text-stone-500 italic text-center">
              Loading box scores… {progress.done} of {progress.total} days
            </div>
          )}
          {error && <div className="py-2 text-[10px] text-red-600 text-center">{error}</div>}
          {rows && (
            <div>
              <div className="flex items-center justify-between gap-2 py-1">
                <span className="text-[9px] text-stone-400 italic">
                  {boxes.length < month.games.length ? `${boxes.length} of ${month.games.length} games loaded` : `${month.games.length} games`}
                </span>
                {min ? (
                  <button
                    onClick={() => setMinGames(null)}
                    className="normal-case tracking-normal text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1 bg-stone-100 text-stone-700 border-stone-300"
                    aria-label="Clear the minimum-games filter"
                  >
                    ≥{min} games <span className="text-stone-400">×</span>
                  </button>
                ) : qualifier > 1 && (
                  <button
                    onClick={() => setMinGames(qualifier)}
                    className="normal-case tracking-normal text-[10px] px-1.5 py-0.5 border bg-white text-stone-500 border-stone-300"
                  >
                    Qualify ≥{qualifier} games
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 border-b border-stone-200">
                <span className="w-5 text-right">#</span>
                <span className="w-10">Team</span>
                <span className="flex-1">Player</span>
                <span className="w-5 text-right">G</span>
                <span className="hidden sm:block w-8 text-right">MPG</span>
                <span className="w-8 text-right">PPG</span>
                <span className="w-7 text-right">RPG</span>
                <span className="w-7 text-right">APG</span>
                <span className="hidden sm:block w-12 text-right">TOT VA</span>
                <span className="w-9 text-right">VA/G</span>
              </div>
              {visible.map((p, i) => {
                const tc = teamColor(p.team);
                const isOpen = expanded === p.name;
                const barColor = p.vapg >= 0 ? withAlpha(tc, 0.16) : withAlpha("#dc2626", 0.10);
                const toggle = () => setExpanded(isOpen ? null : p.name);
                return (
                  <div key={p.name} className="border-b border-stone-100 last:border-0">
                    <div className="relative overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 pointer-events-none"
                        style={{ width: `${(Math.abs(p.vapg) / maxAbs) * 100}%`, backgroundColor: barColor }}
                        aria-hidden
                      />
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={toggle}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle();
                          }
                        }}
                        className={`relative w-full flex items-center gap-2 text-[10px] py-1 text-left cursor-pointer ${isOpen ? "bg-stone-100/60" : ""}`}
                      >
                        <span className="w-5 text-right tabular-nums text-stone-400">{i + 1}</span>
                        <span
                          style={{ backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) }}
                          className="w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center border"
                        >{p.team}</span>
                        <span className="flex-1 truncate text-stone-800">
                          <span className="text-stone-400 mr-1">{isOpen ? "▾" : "▸"}</span>
                          {p.name}
                        </span>
                        <span className="w-5 text-right tabular-nums text-stone-500">{p.gp}</span>
                        <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{p.mpg.toFixed(1)}</span>
                        <span className="w-8 text-right tabular-nums text-stone-700">{p.ppg.toFixed(1)}</span>
                        <span className="w-7 text-right tabular-nums text-stone-600">{p.rpg.toFixed(1)}</span>
                        <span className="w-7 text-right tabular-nums text-stone-600">{p.apg.toFixed(1)}</span>
                        <span className={`hidden sm:block w-12 text-right tabular-nums ${p.va < 0 ? "text-red-600" : "text-stone-600"}`}>{p.va.toFixed(1)}</span>
                        <span className={`w-9 text-right tabular-nums font-bold ${p.vapg < 0 ? "text-red-600" : "text-stone-900"}`}>{p.vapg.toFixed(2)}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <VABreakdown
                        p={p}
                        lga={lga}
                        teams={{}}
                        rate
                        season={season}
                        defScope="rs"
                        gameSeries={p.games}
                        byGame={p.byGame}
                        gameContext={p.gameContext}
                        breakdownTitle={`${month.label} Breakdown`}
                        useTeamColor
                        regularSeasonTotals={rsLookup ? (rsLookup.byName[p.name] || rsLookup.byNorm[normalizeName(p.name)] || null) : null}
                        onPrev={i > 0 ? () => setExpanded(visible[i - 1].name) : undefined}
                        onNext={i < visible.length - 1 ? () => setExpanded(visible[i + 1].name) : undefined}
                      />
                    )}
                  </div>
                );
              })}
              {filtered.length > 10 && (
                <button
                  onClick={() => setShowAll((s) => !s)}
                  className="w-full mt-1 py-1.5 text-[10px] uppercase tracking-widest text-stone-500 border border-stone-200 hover:bg-stone-50"
                >
                  {showAll ? "Show top 10" : `Show all (${filtered.length})`}
                </button>
              )}
              <div className="text-[9px] text-stone-400 mt-1.5 text-center italic">Sorted by Value Added per game · tap a row for VA breakdown</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
