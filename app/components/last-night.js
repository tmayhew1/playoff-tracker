"use client";

import { useEffect, useState } from "react";
import { fetchBakedJson } from "../lib/fetch-cache";
import { useVAMode } from "../lib/va-mode";
import { teamColor } from "../lib/format";
import { PlayerAvatar } from "./ui/avatar";

// "Last night": the night's best Value Added games, top of Explore. Lines are
// baked each morning (scripts/bake-nights.mjs) and scored by /api/nights; the
// arrows step through earlier nights. Tapping a player opens him in By
// Player on that season. Renders nothing until a night has been baked.

const sign = (n, d = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}`;

function nightLabel(date) {
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const today = new Date();
  const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  const ageDays = (Date.parse(`${yesterday}T12:00:00Z`) - d.getTime()) / 864e5;
  return { day, isLastNight: date === yesterday, stale: ageDays > 3 };
}

export function LastNight({ onOpenPlayer }) {
  const { usgAdj } = useVAMode();
  const [date, setDate] = useState(null);
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(null); // null until the first night decides

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams();
    if (date) q.set("date", date);
    if (usgAdj) q.set("usg", "1");
    fetchBakedJson(`/api/nights${q.toString() ? `?${q}` : ""}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        // An old night (the offseason) starts folded, so it doesn't
        // headline the page as if it were news.
        if (d.date) setOpen((o) => (o == null ? !nightLabel(d.latest).stale : o));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [date, usgAdj]);

  if (!data?.date) return null;
  const { day, isLastNight, stale } = nightLabel(data.date);
  const title = isLastNight ? "Last night" : stale && data.date === data.latest ? "Most recent games" : day;
  const step = (d) => { if (d) { setDate(d); setExpanded(false); } };

  const card = (l, i) => {
    const vsAvg = l.seasonVaPerG != null ? l.va - l.seasonVaPerG : null;
    const c = teamColor(l.team);
    return (
      <button key={`${l.gameId}:${l.name}`} type="button"
        onClick={() => l.slug && onOpenPlayer?.({ name: l.name, slug: l.slug, season: data.season })}
        disabled={!l.slug}
        className="cs-press cs-card relative w-full h-full p-3.5 text-left overflow-hidden"
      >
        <span className="absolute inset-x-0 top-0 h-1" style={{ background: c }} aria-hidden />
        <span className="flex items-center gap-2.5">
          <span className="relative">
            <PlayerAvatar name={l.name} team={l.team} personId={l.id} size={46} />
            <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-stone-900 text-white text-[10px] font-black flex items-center justify-center ring-2 ring-white">{i + 1}</span>
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-bold text-stone-900 leading-tight truncate">{l.name}</span>
            <span className="block text-[11px] text-stone-500"><b style={{ color: c }}>{l.team}</b> {l.won ? "W" : "L"} vs {l.opp}</span>
          </span>
        </span>
        <span className="flex items-end justify-between mt-3">
          <span>
            <span className={`block text-[30px] leading-none font-black tabular-nums tracking-tight ${l.va >= 0 ? "text-stone-900" : "text-red-600"}`}>{sign(l.va)}</span>
            <span className="block text-[10px] font-semibold text-stone-400 mt-1">Value Added</span>
          </span>
          {vsAvg != null && (
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${vsAvg >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"}`}>
              {sign(vsAvg)} vs avg
            </span>
          )}
        </span>
        <span className="block mt-3 pt-2.5 border-t border-stone-100 text-[11px] text-stone-600 tabular-nums">
          <b className="text-stone-900">{l.pts}</b> pts · <b className="text-stone-900">{l.reb}</b> reb · <b className="text-stone-900">{l.ast}</b> ast · {l.fgm}-{l.fga} FG
        </span>
      </button>
    );
  };
  const row = (l, i) => (
    <button key={`${l.gameId}:${l.name}`} type="button"
      onClick={() => l.slug && onOpenPlayer?.({ name: l.name, slug: l.slug, season: data.season })}
      disabled={!l.slug}
      className="cs-press w-full flex items-center gap-3 px-3 py-2 text-left rounded-xl hover:bg-stone-50">
      <span className="w-5 text-right text-[11px] text-stone-400 tabular-nums">{i + 1}</span>
      <PlayerAvatar name={l.name} team={l.team} personId={l.id} size={30} />
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-semibold text-stone-900 truncate">{l.name}</span>
        <span className="block text-[10px] text-stone-500 tabular-nums truncate">{l.team} {l.won ? "W" : "L"} vs {l.opp} · {l.pts}p {l.reb}r {l.ast}a · {Math.round(l.mp)} min</span>
      </span>
      <span className={`text-[13px] font-bold tabular-nums ${l.va >= 0 ? "text-stone-900" : "text-red-600"}`}>{sign(l.va)}</span>
    </button>
  );

  return (
    <section className="mb-5" aria-label="Last night's Value Added leaders">
      <div className="flex items-center gap-2 px-1 mb-2">
        <button onClick={() => setOpen(!open)} aria-expanded={!!open} className="flex-1 flex items-baseline gap-2 min-w-0 text-left">
          <span className="text-[20px] font-black text-stone-900 leading-none whitespace-nowrap" style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}>{title}</span>
          <span className="text-[11px] text-stone-500 truncate">
            {title === day ? "" : `${day} · `}{data.games.length} game{data.games.length === 1 ? "" : "s"}
          </span>
          <span className={`text-stone-400 text-[12px] transition-transform duration-200 ${open ? "rotate-90" : ""}`} aria-hidden>›</span>
        </button>
        {["prev", "next"].map((k) => (
          <button key={k} onClick={() => step(data[k])} disabled={!data[k]} aria-label={k === "prev" ? "Earlier night" : "Later night"}
            className="cs-press w-8 h-8 rounded-full bg-white border border-stone-200 text-stone-600 disabled:opacity-30 flex items-center justify-center">
            {k === "prev" ? "‹" : "›"}
          </button>
        ))}
      </div>
      {open && (
        <>
          <div>
            {/* Edge to edge, so the next card peeks in from the side. */}
            <div className="cs-rail gap-3 py-2 -mx-4 px-4 scroll-px-4" key={data.date}>
              {data.lines.slice(0, 8).map((l, i) => <div key={`${l.gameId}:${l.name}`} className="cs-rise w-[68%] min-w-[210px] max-w-[250px]" style={{ animationDelay: `${i * 45}ms` }}>{card(l, i)}</div>)}
            </div>
          </div>
          <div className="flex items-center justify-between px-1 mt-1.5 text-[11px] text-stone-500">
            {data.lines.length > 8 ? (
              <button onClick={() => setExpanded(!expanded)} className="font-semibold text-stone-700 hover:text-stone-900">
                {expanded ? "Hide the full list" : `All ${data.lines.length} players ›`}
              </button>
            ) : <span />}
            <span className="text-stone-400">vs the {data.baselineSeason} baseline{data.baselineSeason !== data.season ? " (this season’s isn’t set yet)" : ""}</span>
          </div>
          {expanded && <div className="cs-card cs-rise mt-2 p-1.5">{data.lines.map(row)}</div>}
        </>
      )}
    </section>
  );
}
