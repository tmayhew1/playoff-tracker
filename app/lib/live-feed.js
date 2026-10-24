"use client";

import { useEffect, useState } from "react";

// The regular-season board's live feed: /api/regular-season/live polled
// while the board is showing a season still being baked. The lines it
// carries are what PlayoffLeaderboard adds onto the baked totals
// (lib/live-lines.js).

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
