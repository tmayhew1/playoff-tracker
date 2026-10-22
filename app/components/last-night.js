"use client";

import { useEffect, useState } from "react";
import { fetchBakedJson } from "../lib/fetch-cache";
import { useVAMode } from "../lib/va-mode";
import { teamColor } from "../lib/format";

// "About Last Night": the night's best Value Added games, top of Explore,
// folded until tapped. Lines are baked each morning (scripts/bake-nights.mjs)
// and scored by /api/nights, which reads the new night off ESPN from midnight
// Pacific until that bake lands; the arrows step through earlier nights. Tapping
// a player opens his game's card on the Live tab when that tab is showing
// the same night (`liveNight`), and By Player on that season otherwise.
// Renders nothing until a night has been baked.

const TOP = 5;
const sign = (n, d = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}`;

const nightLabel = (date) => new Date(`${date}T12:00:00Z`)
  .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export function LastNight({ onOpenPlayer, liveNight, onOpenInLive }) {
  const { usgAdj } = useVAMode();
  const [date, setDate] = useState(null);
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams();
    if (date) q.set("date", date);
    if (usgAdj) q.set("usg", "1");
    fetchBakedJson(`/api/nights${q.toString() ? `?${q}` : ""}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [date, usgAdj]);

  if (!data?.date) return null;
  const day = nightLabel(data.date);
  const lines = expanded ? data.lines : data.lines.slice(0, TOP);
  const step = (d) => { if (d) { setDate(d); setExpanded(false); } };
  const openLine = (l) => (data.date === liveNight && onOpenInLive
    ? onOpenInLive({ date: data.date, name: l.name, team: l.team })
    : l.slug && onOpenPlayer?.({ name: l.name, slug: l.slug, season: data.season }));

  return (
    <section className="mb-4 bg-white border-2 border-stone-900" aria-label="Last night's Value Added leaders">
      <div className="flex items-center px-3 py-2 border-b border-stone-200">
        <button onClick={() => setOpen(!open)} className="flex-1 text-left flex items-baseline gap-2 min-w-0">
          <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-stone-900 whitespace-nowrap">About Last Night</span>
          <span className="text-[10px] text-stone-500 truncate">
            {day} · {data.games.length} game{data.games.length === 1 ? "" : "s"}
          </span>
          <span className="text-[10px] text-stone-400">{open ? "▾" : "▸"}</span>
        </button>
        <button onClick={() => step(data.prev)} disabled={!data.prev} aria-label="Earlier night"
          className="px-2 text-sm text-stone-500 disabled:text-stone-200">‹</button>
        <button onClick={() => step(data.next)} disabled={!data.next} aria-label="Later night"
          className="px-2 text-sm text-stone-500 disabled:text-stone-200">›</button>
      </div>
      {open && (
        <div>
          {lines.map((l, i) => {
            const vsAvg = l.seasonVaPerG != null ? l.va - l.seasonVaPerG : null;
            return (
              <button key={`${l.gameId}:${l.name}`} onClick={() => openLine(l)}
                disabled={!l.slug && data.date !== liveNight}
                className="w-full grid grid-cols-[1.2rem_1fr_auto] gap-x-2 items-center px-3 py-1.5 border-b border-stone-100 last:border-0 text-left">
                <span className="text-[10px] text-stone-400 tabular-nums">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-stone-900 truncate">
                    {l.name} <span className="text-[10px] font-bold" style={{ color: teamColor(l.team) }}>{l.team}</span>
                    <span className="text-[10px] text-stone-400 font-normal"> {l.won ? "W" : "L"} vs {l.opp}</span>
                  </span>
                  <span className="block text-[10px] text-stone-500 tabular-nums">
                    {l.pts} pts · {l.reb} reb · {l.ast} ast{l.stl + l.blk > 2 ? ` · ${l.stl} stl · ${l.blk} blk` : ""} · {l.fgm}-{l.fga} FG · {Math.round(l.mp)} min
                  </span>
                </span>
                <span className="text-right">
                  <span className={`block text-[14px] font-black tabular-nums ${l.va >= 0 ? "text-stone-900" : "text-red-600"}`}>{sign(l.va)}</span>
                  {vsAvg != null && (
                    <span className={`block text-[9px] tabular-nums ${vsAvg >= 0 ? "text-emerald-700" : "text-stone-400"}`}>{sign(vsAvg)} vs avg</span>
                  )}
                </span>
              </button>
            );
          })}
          {data.lines.length > TOP && (
            <div className="px-3 py-1.5 text-[10px] text-stone-500">
              <button onClick={() => setExpanded(!expanded)} className="underline">
                {expanded ? "Top 5 only" : `All ${data.lines.length} players`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
