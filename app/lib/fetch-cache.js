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

// --- Pinning the baked payloads to the build that shipped them ---------------
// The /api routes that read app/data are cached hard and long — up to
// s-maxage=604800 at the edge, plus max-age=3600 in the browser — because
// within one deployment their bodies are immutable. Across deployments they
// are not: the whole point of a data bake is that the next build serves
// different bytes from the same path.
//
// Nothing in those URLs changes when a build ships, so both caches keep
// answering with the previous build's data, and a fresh bundle reads a stale
// payload. That is a silent failure rather than a visible one: the new code
// runs, finds the keys it wants missing, and falls back — which is exactly how
// on-off defensive ratings baked into def-ratings.json rendered as the plain
// box-score estimate for a day after they merged, with no error anywhere.
//
// BuildWatch already fixes the same problem one layer up (a restored iOS tab
// running an old bundle), but reloading cannot help here: the reload re-issues
// the identical request and gets the identical cached body back.
//
// So the build id — inlined by next.config.js, the same value BuildWatch
// compares — rides along as a query parameter. Within a build every URL is
// unchanged and both caches work exactly as before; a new build changes every
// URL at once, which is a guaranteed miss in the browser cache and at the
// edge. It is the standard content-hash trick Next already applies to its own
// chunks, applied to the data those chunks read.
//
// Live endpoints are deliberately NOT pinned: /api/scores and the in-progress
// side of /api/boxscore change without a deploy, so a build-scoped URL would
// freeze them for the life of the deployment. /api/version must stay unpinned
// too — it is the question "which build is current?", which cannot be asked
// from a URL that already assumes the answer.
const BUILD = process.env.NEXT_PUBLIC_BUILD_ID || "";

export function buildScoped(url) {
  // No build id (a local `next dev` without the env inlined) — hand back the
  // URL untouched rather than inventing a cache key, the same way BuildWatch
  // stays dormant without one.
  if (!BUILD) return url;
  return `${url}${url.includes("?") ? "&" : "?"}b=${encodeURIComponent(BUILD)}`;
}

// fetchJsonCached for a baked payload: same promise cache, build-scoped URL.
export function fetchBakedJson(url) {
  return fetchJsonCached(buildScoped(url));
}
