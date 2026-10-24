"use client";

import { useEffect, useState } from "react";
import { teamColor } from "../lib/format";

// The regular-season board's live feed: /api/regular-season/live polled
// while the board is showing a season still being baked, and the scores it
// brings shown in a strip under the board's header. The lines it carries are
// what PlayoffLeaderboard adds onto the baked totals (lib/live-lines.js).

// Every 30s while a game is on; otherwise every 2 minutes, to catch a tip.
const LIVE_MS = 30000, IDLE_MS = 120000;

// `through` is the last day the board's baked totals cover; null switches
// the feed off (a finished season, or totals not loaded yet).
export function useLiveLines(season, through) {
  const [live, setLive] = useState(null);
  useEffect(() => {
    setLive(null);
    if (!season || !through) return;
    let cancelled = false, timer = null, anyLive = false;
    const url = `/api/regular-season/live?season=${season}&through=${through}`;
    const tick = async () => {
      timer = null;
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await fetch(url, { cache: "no-store" });
        const d = await r.json();
        if (!cancelled && r.ok && Array.isArray(d.lines)) {
          setLive(d);
          anyLive = d.games.some((g) => g.gameStatus === 2);
        }
      } catch { /* the baked board stands on its own */ }
      if (!cancelled) timer = setTimeout(tick, anyLive ? LIVE_MS : IDLE_MS);
    };
    // Back from the background: catch up at once rather than on a stale timer.
    const onVisible = () => {
      if (document.hidden || cancelled) return;
      if (timer) clearTimeout(timer);
      tick();
    };
    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [season, through]);
  return live;
}

const formatPeriod = (p) => (!p || p < 1 ? "" : p <= 4 ? `Q${p}` : p === 5 ? "OT" : `OT${p - 4}`);
const formatClock = (iso) => {
  const m = /PT(\d+)M([\d.]+)S/.exec(iso || "");
  return m ? `${parseInt(m[1], 10)}:${String(Math.floor(parseFloat(m[2]))).padStart(2, "0")}` : "";
};
const statusOf = (g) => {
  if (g.gameStatus === 3) return "Final";
  if (/^(half|end)/i.test(g.gameStatusText || "")) return g.gameStatusText;
  return [formatPeriod(g.period), formatClock(g.gameClock)].filter(Boolean).join(" ") || g.gameStatusText;
};

export function LiveStrip({ live }) {
  const games = live?.games || [];
  if (!games.length) return null;
  const on = games.filter((g) => g.gameStatus === 2).length;
  return (
    <div className="border-b border-stone-200 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-stone-400 mb-1">
        {on > 0 && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" aria-hidden />}
        <span>{on > 0 ? `Live · ${on} on` : "Not yet in the bake"}</span>
        <span className="ml-auto normal-case tracking-normal">ESPN · in G as played</span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-0.5 px-0.5" style={{ scrollbarWidth: "none" }}>
        {games.map((g) => {
          const isLive = g.gameStatus === 2;
          const side = (t, other) => (
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold" style={{ color: teamColor(t.tri) }}>{t.tri}</span>
              <span className={`tabular-nums ${g.gameStatus === 3 && t.score > other.score ? "font-bold text-stone-900" : "text-stone-600"}`}>{t.score}</span>
            </div>
          );
          return (
            <div
              key={g.gameId}
              className={`shrink-0 min-w-[78px] border px-1.5 py-1 text-[10px] leading-tight ${isLive ? "border-red-300 bg-red-50/40" : "border-stone-200"}`}
              title={g.boxed ? undefined : "Box score not available yet — not counted"}
            >
              {side(g.away, g.home)}
              {side(g.home, g.away)}
              <div className={`mt-0.5 text-[8px] uppercase tracking-wider ${isLive ? "text-red-600 font-semibold" : "text-stone-400"}`}>
                {statusOf(g)}{!g.boxed && " · no box"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
