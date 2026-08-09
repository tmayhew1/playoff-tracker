"use client";

import { useState, useMemo, useEffect } from "react";
import { fetchJsonCached } from "../lib/fetch-cache";


// The all-time board. Legacy is deliberately TWO numbers rather than one
// (app/lib/legacy.js): LEGACY is the rank-decayed fold over a career's seasons,
// which spends longevity at diminishing returns, and PEAK/G is the
// leverage-weighted rate over the best seasons. They disagree — Jokić is ninth
// by volume and second by peak — and blending them would hide exactly the
// argument the metric exists to make, so both columns are sortable and neither
// is "the" ranking.
//
// MVP scope: the board at the default dials. The route already answers for any
// alpha/decay, so exposing them is a slider away.

const fmt0 = (n) => Math.round(n).toLocaleString("en-US");

export function LegacyView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("total"); // "total" | "peak"

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
      <div className="mb-3">
        <h2 className="text-base font-bold text-stone-900">Legacy</h2>
        <div className="text-[10px] uppercase tracking-widest text-stone-500 mt-0.5">
          {data.firstSeason}–{data.lastSeason} · {data.qualified.toLocaleString()} careers qualified
        </div>
      </div>

      <p className="text-[11px] text-stone-600 leading-relaxed mb-3">
        Every game a career played, priced by what it was worth to a title, then
        folded best season first so extra years always add — just less each
        time. <span className="font-semibold">Legacy</span> is that total;{" "}
        <span className="font-semibold">Peak/G</span> is the same weighting as a
        rate over the best {data.dials.peakSeasons} seasons. Tap either to sort.
      </p>

      <div className="grid grid-cols-[1.5rem_1fr_2rem_3.5rem_3rem] gap-x-2 items-center text-[10px] uppercase tracking-wider text-stone-400 px-2 pb-1 border-b border-stone-200">
        <span></span><span>Player</span><span className="text-right">Sns</span>
        {head("total", "Legacy")}
        {head("peak", "Peak/G")}
      </div>

      {shown.map((p, i) => (
        <div key={p.slug} className="border-b border-stone-100">
          <div className="grid grid-cols-[1.5rem_1fr_2rem_3.5rem_3rem] gap-x-2 items-center px-2 pt-1.5 text-sm">
            <span className="text-[10px] tabular-nums text-stone-400">{i + 1}</span>
            <span className="min-w-0">
              <span className="font-semibold text-stone-800 block truncate">
                {p.name}{p.truncated ? <span className="text-stone-400"> *</span> : null}
              </span>
              <span className="text-[10px] text-stone-500 tabular-nums">
                {p.span} · {fmt0(p.careerGames)} G
              </span>
            </span>
            <span className="text-right tabular-nums text-stone-600">{p.seasonCount}</span>
            <span className={`text-right tabular-nums font-bold ${sortKey === "total" ? "text-stone-900" : "text-stone-500"}`}>{fmt0(p.total)}</span>
            <span className={`text-right tabular-nums ${sortKey === "peak" ? "text-stone-900 font-bold" : "text-stone-500"}`}>{p.peak.toFixed(1)}</span>
          </div>
          <div className="px-2 pt-1 pb-1.5">
            <div className="h-1 bg-stone-100 rounded-sm overflow-hidden">
              <div className="h-full rounded-sm bg-stone-900" style={{ width: `${Math.max(0, ((p[sortKey] ?? 0) / max) * 100)}%` }} />
            </div>
          </div>
        </div>
      ))}

      <div className="text-[10px] text-stone-400 italic mt-2 leading-relaxed">
        {anyTruncated && (
          <>* career reaches {data.firstSeason}, the first season on record — it may extend
          earlier, in which case only part of it is measured.<br /></>
        )}
        Dials: leverage α {data.dials.alpha}, decay {data.dials.decay} (the best{" "}
        {data.dials.peakSeasons} seasons carry {(data.peakShare * 100).toFixed(0)}% of a
        20-season career). Regular season {data.dials.includeRS ? "included" : "excluded"};
        minimum {data.dials.minSeasons} seasons and {fmt0(data.dials.minGames)} games.
      </div>
    </div>
  );
}
