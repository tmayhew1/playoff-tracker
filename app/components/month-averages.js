"use client";

import { useEffect, useMemo, useState } from "react";
import { VABreakdown } from "./va-breakdown";
import { MonthlyVAChart } from "./charts";
import { fetchBakedJson } from "../lib/fetch-cache";
import { monthBoxes, monthRows, peekBoxes, peekMonthly, seasonMonthly } from "../lib/month-tables";
import { normalizeName, teamColor, withAlpha } from "../lib/format";
import { catVATotal } from "../lib/va";

// A month's league-wide leaders: every player who played in the month, best
// Value Added per game first — the regular season's Series Averages. Box
// scores and the scored table come from lib/month-tables.js, which for a
// baked season has usually loaded and scored them already while the page was
// idle; otherwise they load the first time the section is opened. They are
// priced against `lga`, so the USG-ADJ switch re-ranks the table without
// reloading it. `allMonths` is the whole season, for an open row's
// VA-by-month chart, whose other months can be tapped to read the player's
// breakdown for that month instead. The month's team filter (`team`,
// `onTeam`) belongs to the month section, which filters its games by it too;
// tapping a row's team sets it from here, and the section's picker
// (`teamControl`) sits in this header beside the minimum-games chip.
const DEFAULT_DISPLAY = { view: "basic", category: null, rate: "perG" };

export function MonthAverages({ month, allMonths, lga, season, team = null, onTeam, teamControl }) {
  const year = month.key.slice(0, 4);
  const [open, setOpen] = useState(true);
  const [boxes, setBoxes] = useState(() => peekBoxes(season, month));
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [showAll, setShowAll] = useState(false);
  // A one-game spot-up can top a per-game table, so it opens qualified to
  // players with at least half the month's most games; the chip clears it.
  const [minGames, setMinGames] = useState(undefined);
  // The month an open row's breakdown reads, when another month's bar was
  // tapped; null reads this month.
  const [viewKey, setViewKey] = useState(null);
  // The open breakdown's Basic / By Category, tapped row and Per 36 / Per G,
  // held here so they carry over when another month's bar swaps the card's
  // month in (the card remounts per month). A new row starts fresh.
  const [display, setDisplay] = useState(DEFAULT_DISPLAY);
  const [rsLookup, setRsLookup] = useState(null);
  // The season's VA per game by month, for an open row's chart: usually
  // built already (lib/month-tables.js warmSeason); otherwise loaded the first
  // time a row is opened, and again under a new baseline.
  const [monthly, setMonthly] = useState(() => peekMonthly(season, allMonths, lga));
  const [seasonProgress, setSeasonProgress] = useState(null);

  useEffect(() => {
    if (!open || boxes) return;
    let cancelled = false;
    setError(null);
    monthBoxes(season, month, (p) => { if (!cancelled) setProgress(p); }).then((loaded) => {
      if (cancelled) return;
      if (!loaded.length) setError("Box scores unavailable");
      else setBoxes(loaded);
    }, () => { if (!cancelled) setError("Box scores unavailable"); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!expanded || !allMonths?.length) return;
    const hit = peekMonthly(season, allMonths, lga);
    if (hit) { setMonthly(hit); return; }
    let cancelled = false;
    setMonthly(null);
    seasonMonthly(season, allMonths, lga, (p) => { if (!cancelled) setSeasonProgress(p); })
      .then((m) => { if (!cancelled) setMonthly(m); });
    return () => { cancelled = true; };
  }, [expanded, allMonths, season, lga]);

  const openRow = (name) => {
    setExpanded(name);
    setViewKey(null);
    setDisplay(DEFAULT_DISPLAY);
  };

  // Another month of the open player's season, once the season is loaded:
  // { month, p } with that month's row, or null to read this month.
  const viewed = (name) => {
    if (!viewKey || !monthly) return null;
    const m = allMonths.find((x) => x.key === viewKey);
    const mBoxes = m && peekBoxes(season, m);
    const p = mBoxes && monthRows(season, m, mBoxes, lga).find((r) => r.name === name);
    return p ? { month: m, p } : null;
  };

  // `category` is the breakdown row tapped below the chart (a group such as
  // "Scoring" or one of its categories): the bars then read that category's
  // VA per game in each month instead of the total, scored off the months'
  // own tables (already loaded, since the season chart is built from them).
  const monthChart = (name, other) => (color, category) => {
    if (!monthly) {
      const note = seasonProgress ? `Loading the season… ${seasonProgress.done} of ${seasonProgress.total} months` : "Loading the season…";
      return <MonthlyVAChart months={[]} note={note} />;
    }
    const series = monthly.byName.get(name) || monthly.months.map(() => null);
    const catVapg = (i) => {
      const m = allMonths[i];
      const mBoxes = m && peekBoxes(season, m);
      const r = mBoxes && monthRows(season, m, mBoxes, lga).find((x) => x.name === name);
      if (!r) return null;
      const v = catVATotal(r, lga, category) / (r.gp || 1);
      return Number.isFinite(v) ? v : null;
    };
    const currentKey = other ? other.month.key : month.key;
    return (
      <>
        {other && (
          <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-widest text-stone-700">
            <span className="italic">{other.month.label} {other.month.key.slice(0, 4)}</span>
            <button
              onClick={() => setViewKey(null)}
              className="normal-case tracking-normal font-normal text-stone-400 hover:text-stone-700"
            >
              ← {month.label.slice(0, 3)} {year}
            </button>
          </div>
        )}
        <MonthlyVAChart
          color={color}
          label={category ? `${category} VA / Game by Month` : undefined}
          months={monthly.months.map((m, i) => ({
            key: m.key,
            label: m.label,
            year: m.year,
            vapg: series[i] ? (category ? catVapg(i) : series[i].vapg) : null,
            gp: series[i]?.gp ?? 0,
            current: m.key === currentKey,
            home: m.key === month.key,
          }))}
          onSelect={(i) => {
            const key = monthly.months[i].key;
            setViewKey(key === month.key ? null : key);
          }}
        />
      </>
    );
  };

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

  const rows = useMemo(() => (boxes ? monthRows(season, month, boxes, lga) : null), [boxes, lga, season, month]);
  const qualifier = useMemo(() => (rows?.length ? Math.ceil(Math.max(...rows.map((r) => r.gp)) / 2) : null), [rows]);
  const min = minGames === undefined ? qualifier : minGames;
  const filtered = rows ? rows.filter((r) => (!min || r.gp >= min) && (!team || r.team === team)) : [];
  const visible = showAll ? filtered : filtered.slice(0, 10);
  const maxAbs = Math.max(...visible.map((r) => Math.abs(r.vapg)), 0.5);

  return (
    <div className="mb-3 border border-stone-300 bg-white">
      <div className="flex items-center gap-1.5 pr-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex-1 min-w-0 px-2 py-1.5 text-[10px] uppercase tracking-widest text-stone-600 font-semibold flex items-center gap-1 text-left"
        >
          <span className="text-stone-400">{open ? "▾" : "▸"}</span>
          {month.label} {year} Averages
        </button>
        {teamControl}
        {open && rows && (min ? (
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
        ))}
      </div>
      {open && (
        <div className="px-2 pb-2">
          {!rows && !error && (
            <div className="py-2 text-[10px] text-stone-500 italic text-center">
              {progress?.total ? `Loading box scores… ${progress.done} of ${progress.total}` : "Loading box scores…"}
            </div>
          )}
          {error && <div className="py-2 text-[10px] text-red-600 text-center">{error}</div>}
          {rows && (
            <div>
              <div className="py-1">
                <span className="text-[9px] text-stone-400 italic">
                  {boxes.length < month.games.length ? `${boxes.length} of ${month.games.length} games loaded` : `${month.games.length} games`}
                </span>
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
                const toggle = () => openRow(isOpen ? null : p.name);
                const other = isOpen ? viewed(p.name) : null;
                const shown = other ? other.p : p;
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
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onTeam?.(team === p.team ? null : p.team);
                          }}
                          style={{ backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) }}
                          className="w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center border"
                          aria-label={team === p.team ? "Show every team" : `Show only ${p.team}`}
                        >{p.team}</button>
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
                        key={other ? other.month.key : month.key}
                        p={shown}
                        lga={lga}
                        teams={{}}
                        rate
                        season={season}
                        defScope="rs"
                        gameSeries={shown.games}
                        byGame={shown.byGame}
                        gameContext={shown.gameContext}
                        breakdownTitle={`${(other ? other.month : month).label} ${(other ? other.month : month).key.slice(0, 4)} Breakdown`}
                        leadChart={monthChart(p.name, other)}
                        display={display}
                        onDisplayChange={setDisplay}
                        useTeamColor
                        regularSeasonTotals={rsLookup ? (rsLookup.byName[p.name] || rsLookup.byNorm[normalizeName(p.name)] || null) : null}
                        onPrev={i > 0 ? () => openRow(visible[i - 1].name) : undefined}
                        onNext={i < visible.length - 1 ? () => openRow(visible[i + 1].name) : undefined}
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
              <div className="text-[9px] text-stone-400 mt-1.5 text-center italic">Sorted by Value Added per game · tap a row for VA breakdown, a team to filter</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
