"use client";


// Promise-cached JSON fetch so By Season and By Player share one network hit
// for the big payloads (player index, per-season leaderboards, rs totals).
export const _jsonCache = new Map();

export function fetchJsonCached(url) {
  if (!_jsonCache.has(url)) {
    _jsonCache.set(url, fetch(url)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
        return d;
      })
      .catch((e) => { _jsonCache.delete(url); throw e; }));
  }
  return _jsonCache.get(url);
}
