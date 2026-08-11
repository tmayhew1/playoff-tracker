"use client";

import { useState, useMemo, useEffect } from "react";
import { fetchJsonCached } from "../lib/fetch-cache";


// The all-time board. Legacy is deliberately TWO numbers rather than one
// (app/lib/legacy.js): LEGACY is the rank-decayed fold over a career's seasons,
// which spends longevity at diminishing returns, and PEAK/G is the
// leverage-weighted rate over the best seasons. They disagree — Jokić is ninth
// by volume and third by peak — and blending them would hide exactly the
// argument the metric exists to make, so both columns are sortable and neither
// is "the" ranking.
//
// Tapping a row opens the fold itself. A career total is otherwise a number you
// have to take on faith; the expansion shows it as the sum it is — every
// season, ordered the way the decay is spent, with the discount that season
// took and the playoff/regular-season split underneath.
//
// MVP scope: the board at the default dials. The route already answers for any
// alpha/decay, so exposing them is a slider away.

const fmt0 = (n) => Math.round(n).toLocaleString("en-US");
// Big numbers don't need a decimal and can't spare the width on a phone; small
// ones are unreadable without it (a 4.0 season and a 4.4 season are not the
// same season).
const fmtN = (n) => (Math.abs(n) >= 100 ? fmt0(n) : n.toFixed(1));

const COLS = "grid grid-cols-[1.1rem_1fr_3rem_2.7rem_3.2rem] gap-x-1.5 items-baseline";


// One career, opened up: the summary the board has no room for, then every
// season in the order the fold consumes them.
function CareerFold({ p, decay }) {
  const best = Math.max(...p.seasons.map((s) => s.contribution), 0.1);

  return (
    <div className="px-2 pb-3 pt-1 bg-stone-50 border-t border-stone-200">
      <div className="grid grid-cols-4 gap-x-2 py-2 text-center">
        {[
          ["Career LVA", fmt0(p.careerLVA)],
          ["Folded", fmt0(p.total)],
          ["Peak/G", p.peak.toFixed(1)],
          ["Raw/G", p.peakRaw.toFixed(1)],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="text-[9px] uppercase tracking-wider text-stone-400">{label}</div>
            <div className="text-sm font-bold text-stone-900 tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-stone-500 leading-relaxed mb-2">
        {p.seasonCount} seasons · {fmt0(p.careerGames)} games · {p.span}
        {p.teams?.length ? <> · {p.teams.join(", ")}</> : null}. Every season below is
        weighted <span className="tabular-nums">{decay}</span><sup>rank−1</sup>, so the
        best one counts whole and each next one a little less —{" "}
        <span className="font-semibold">Discounted</span> is the column that sums to
        Legacy.
      </p>

      <div className={`${COLS} text-[9px] uppercase tracking-wider text-stone-400 pb-1 border-b border-stone-200`}>
        <span>#</span><span>Season</span>
        <span className="text-right">LVA</span>
        <span className="text-right">×D</span>
        <span className="text-right">Disc.</span>
      </div>

      {p.seasons.map((s) => {
        // A negative season still belongs on the board — it is part of the
        // career — but it has no meaningful playoff/RS split to draw, so it
        // gets one red bar instead of two stacked ones.
        const down = s.lva <= 0;
        const width = Math.min(100, (Math.abs(s.contribution) / best) * 100);
        const poShare = down ? 0 : Math.max(0, Math.min(1, s.poLVA / s.lva));
        return (
          <div key={s.season} className="pt-1 pb-1.5 border-b border-stone-100 last:border-0">
            <div className={`${COLS} text-[11px]`}>
              <span className="tabular-nums text-stone-400">{s.rank}</span>
              <span className="min-w-0">
                <span className="font-semibold text-stone-800">{s.season}</span>
                {/* A season with no playoff run says "82 RS", not "0 PO · 82 RS" —
                    missing the playoffs is already legible from the empty dark
                    segment on the bar. */}
                <span className="text-[9px] text-stone-500 tabular-nums">
                  {s.team ? ` ${s.team}` : ""}
                  {[s.poGames ? `${s.poGames} PO` : null, s.rsGames ? `${s.rsGames} RS` : null]
                    .filter(Boolean).map((part) => ` · ${part}`).join("")}
                </span>
              </span>
              <span className={`text-right tabular-nums ${down ? "text-red-600" : "text-stone-600"}`}>{fmtN(s.lva)}</span>
              <span className="text-right tabular-nums text-stone-400">{s.weight.toFixed(3)}</span>
              <span className={`text-right tabular-nums font-bold ${down ? "text-red-600" : "text-stone-900"}`}>{fmtN(s.contribution)}</span>
            </div>
            <div className="h-1 mt-1 bg-stone-200/60 rounded-sm overflow-hidden flex">
              {down ? (
                <div className="h-full bg-red-500" style={{ width: `${width}%` }} />
              ) : (
                <>
                  <div className="h-full bg-stone-900" style={{ width: `${width * poShare}%` }} />
                  <div className="h-full bg-stone-400" style={{ width: `${width * (1 - poShare)}%` }} />
                </>
              )}
            </div>
          </div>
        );
      })}

      <p className="text-[9px] text-stone-400 leading-relaxed mt-2">
        Bars are each season&apos;s discounted value against this career&apos;s best —{" "}
        <span className="text-stone-900 font-semibold">dark</span> is the playoff run,{" "}
        <span className="text-stone-500 font-semibold">light</span> the regular season.
        The playoffs are a fraction of the games and usually most of the bar; that
        is leverage doing its job, not a scaling error.
      </p>
    </div>
  );
}


// Every postseason run on record, ranked, searchable. The career board is an
// argument; this is the evidence behind it — the surface where a number can be
// checked against a run you actually watched.
function RunsBoard() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [limit, setLimit] = useState(100);

  // Debounced so a typed name is one request, not one per keystroke. The
  // search runs server-side because it has to reach all 8,917 runs.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      const url = `/api/legacy/runs?limit=${limit}&q=${encodeURIComponent(query.trim())}`;
      fetchJsonCached(url)
        .then((d) => { if (!cancelled) { setData(d); setError(null); } })
        .catch((e) => { if (!cancelled) setError(e.message || "Load failed"); });
    }, query ? 220 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, limit]);

  const runs = data?.runs || [];
  const max = Math.max(...runs.map((r) => r.lva), 0.1);

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setLimit(100); }}
        placeholder="Search a player…"
        className="w-full text-sm text-stone-900 bg-white border border-stone-300 px-3 py-2 mb-2"
      />

      <div className="flex items-baseline gap-2 mb-1 px-2 text-[10px] text-stone-400 tabular-nums">
        {data ? (
          <>
            <span>
              {query.trim()
                ? `${data.matched.toLocaleString()} of ${data.total.toLocaleString()} runs`
                : `${data.total.toLocaleString()} postseason runs`}
            </span>
            <span className="ml-auto uppercase tracking-widest">Ranked by leveraged VA</span>
          </>
        ) : <span>Loading…</span>}
      </div>

      <div className="grid grid-cols-[2.2rem_1fr_2rem_3.2rem_2.6rem] gap-x-2 items-center text-[10px] uppercase tracking-wider text-stone-400 px-2 pb-1 border-b border-stone-200">
        <span>#</span><span>Player</span><span className="text-right">G</span>
        <span className="text-right">LVA</span><span className="text-right">VA/G</span>
      </div>

      {error && <div className="text-[10px] text-red-600 py-6 text-center">Couldn’t load — {error}</div>}
      {data && !runs.length && !error && (
        <div className="text-[10px] text-stone-400 italic py-6 text-center">
          No runs match “{query.trim()}”.
        </div>
      )}

      {runs.map((r) => (
        <div key={`${r.slug}-${r.season}`} className="border-b border-stone-100">
          <div className="grid grid-cols-[2.2rem_1fr_2rem_3.2rem_2.6rem] gap-x-2 items-center px-2 pt-1.5 text-sm">
            {/* The all-time rank, not the rank among matches — searching for a
                player should tell you where his runs sit in the whole list. */}
            <span className="text-[10px] tabular-nums text-stone-400">{r.rank.toLocaleString()}</span>
            <span className="min-w-0">
              <span className="font-semibold text-stone-800 block truncate">{r.name}</span>
              <span className="text-[10px] text-stone-500 tabular-nums">
                {r.season}{r.team ? ` · ${r.team}` : ""}
              </span>
            </span>
            <span className="text-right tabular-nums text-stone-600">{r.games}</span>
            <span className="text-right tabular-nums font-bold text-stone-900">{fmt0(r.lva)}</span>
            <span className="text-right tabular-nums text-stone-500">{r.vaPerG.toFixed(1)}</span>
          </div>
          <div className="px-2 pt-1 pb-1.5">
            <div className="h-1 bg-stone-100 rounded-sm overflow-hidden">
              <div className="h-full rounded-sm bg-stone-900" style={{ width: `${Math.max(0, (r.lva / max) * 100)}%` }} />
            </div>
          </div>
        </div>
      ))}

      {data && data.matched > runs.length && (
        <button
          onClick={() => setLimit((n) => Math.min(500, n + 200))}
          className="w-full mt-2 py-2 text-[10px] font-bold uppercase tracking-widest text-stone-500 border border-stone-300 hover:bg-stone-50"
        >
          Show more ({(data.matched - runs.length).toLocaleString()} left)
        </button>
      )}

      <div className="text-[10px] text-stone-400 italic mt-2 leading-relaxed">
        Playoff runs only — the regular season is excluded, so these are the numbers
        the postseason half of Legacy is built from. <span className="font-semibold">LVA</span> is
        leveraged Value Added over the run; <span className="font-semibold">VA/G</span> is the raw,
        unweighted per-game figure it was built from, for checking one against the other.
      </div>
    </div>
  );
}


function CareersBoard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("total"); // "total" | "peak"
  const [open, setOpen] = useState(null);          // expanded player's slug

  useEffect(() => {
    let cancelled = false;
    fetchJsonCached("/api/legacy?top=50")
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message || "Load failed"); });
    return () => { cancelled = true; };
  }, []);

  const shown = useMemo(() => {
    if (!data?.players) return [];
    return [...data.players].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
  }, [data, sortKey]);

  if (error) return <div className="text-[10px] text-red-600 py-6 text-center px-2 break-words">Couldn’t load — {error}</div>;
  if (!data) return <div className="text-[10px] text-stone-500 italic py-6 text-center">Ranking careers…</div>;
  if (!shown.length) return <div className="text-[10px] text-stone-400 italic py-6 text-center">No careers qualified.</div>;

  const max = Math.max(...shown.map((p) => p[sortKey] ?? 0), 0.1);
  const anyTruncated = shown.some((p) => p.truncated);
  const head = (key, label) => (
    <button
      onClick={() => setSortKey(key)}
      className={`text-right uppercase tracking-wider ${sortKey === key ? "text-stone-900 font-bold" : "text-stone-400 hover:text-stone-600"}`}
    >{label}{sortKey === key ? " ▾" : ""}</button>
  );

  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-3">
        {data.firstSeason}–{data.lastSeason} · {data.qualified.toLocaleString()} careers qualified
      </div>

      <p className="text-[11px] text-stone-600 leading-relaxed mb-3">
        Every series a career played, priced by what winning it was worth to a
        title and shared across the games it took — so closing a team out in
        four concentrates that value instead of forfeiting it. The seasons are
        then folded best first, so extra years always add, just less each time.{" "}
        <span className="font-semibold">Legacy</span> is that total;{" "}
        <span className="font-semibold">Peak/G</span> is the same weighting as a
        rate over the best {data.dials.peakSeasons} seasons. Tap either to sort,
        or a player for the season-by-season fold.
      </p>

      <div className="grid grid-cols-[1.5rem_1fr_2rem_3.5rem_3rem] gap-x-2 items-center text-[10px] uppercase tracking-wider text-stone-400 px-2 pb-1 border-b border-stone-200">
        <span></span><span>Player</span><span className="text-right">Sns</span>
        {head("total", "Legacy")}
        {head("peak", "Peak/G")}
      </div>

      {shown.map((p, i) => {
        const isOpen = open === p.slug;
        return (
          <div key={p.slug} className="border-b border-stone-100">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : p.slug)}
              className={`w-full text-left grid grid-cols-[1.5rem_1fr_2rem_3.5rem_3rem] gap-x-2 items-center px-2 pt-1.5 text-sm ${isOpen ? "bg-stone-50" : "hover:bg-stone-50"}`}
            >
              <span className="text-[10px] tabular-nums text-stone-400">{i + 1}</span>
              <span className="min-w-0">
                <span className="font-semibold text-stone-800 block truncate">
                  <span className="text-stone-400 text-[9px] mr-1">{isOpen ? "▾" : "▸"}</span>
                  {p.name}{p.truncated ? <span className="text-stone-400"> *</span> : null}
                </span>
                <span className="text-[10px] text-stone-500 tabular-nums">
                  {p.span} · {fmt0(p.careerGames)} G
                </span>
              </span>
              <span className="text-right tabular-nums text-stone-600">{p.seasonCount}</span>
              <span className={`text-right tabular-nums font-bold ${sortKey === "total" ? "text-stone-900" : "text-stone-500"}`}>{fmt0(p.total)}</span>
              <span className={`text-right tabular-nums ${sortKey === "peak" ? "text-stone-900 font-bold" : "text-stone-500"}`}>{p.peak.toFixed(1)}</span>
            </button>
            <div className={`px-2 pt-1 ${isOpen ? "pb-2" : "pb-1.5"}`}>
              <div className="h-1 bg-stone-100 rounded-sm overflow-hidden">
                <div className="h-full rounded-sm bg-stone-900" style={{ width: `${Math.max(0, ((p[sortKey] ?? 0) / max) * 100)}%` }} />
              </div>
            </div>
            {isOpen && <CareerFold p={p} decay={data.dials.decay} />}
          </div>
        );
      })}

      <div className="text-[10px] text-stone-400 italic mt-2 leading-relaxed">
        {anyTruncated && (
          <>* career reaches {data.firstSeason}, the first season on record — it may extend
          earlier, in which case only part of it is measured.<br /></>
        )}
        Decay {data.dials.decay}
        {data.calibration?.isDefault && data.calibration.pool ? (
          <> — measured, not chosen: the point where this board sits equidistant between a
          plain career sum and a best-season ranking across all{" "}
          {data.calibration.pool.toLocaleString()} qualifying careers. At it, the best{" "}
          {data.dials.peakSeasons} seasons carry {(data.peakShare * 100).toFixed(0)}% of a
          20-season career.</>
        ) : (
          <> (the best {data.dials.peakSeasons} seasons carry{" "}
          {(data.peakShare * 100).toFixed(0)}% of a 20-season career).</>
        )}{" "}
        Leverage α {data.dials.alpha}; regular season{" "}
        {data.dials.includeRS ? "included" : "excluded"}; minimum{" "}
        {data.dials.minSeasons} seasons and {fmt0(data.dials.minGames)} games.
      </div>
    </div>
  );
}


// Two readings of the same numbers. Careers is the argument the metric makes;
// Runs is the evidence it rests on — one row per postseason run, so a score can
// be checked against a run you remember rather than taken on trust.
export function LegacyView() {
  const [mode, setMode] = useState("careers"); // "careers" | "runs"

  const tab = (key, label) => (
    <button
      onClick={() => setMode(key)}
      className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest border ${
        mode === key
          ? "bg-stone-900 text-white border-stone-900"
          : "text-stone-500 border-stone-300 hover:text-stone-800"}`}
    >{label}</button>
  );

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-base font-bold text-stone-900">Legacy</h2>
        <span className="ml-auto flex gap-1">{tab("careers", "Careers")}{tab("runs", "Runs")}</span>
      </div>
      {mode === "careers" ? <CareersBoard /> : <RunsBoard />}
    </div>
  );
}
