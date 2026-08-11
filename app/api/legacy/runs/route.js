import { cachedCareers, clearCareerCache } from "../../_lib/careers.js";
import { seasonLVA } from "../../../lib/legacy.js";
import { ALPHA_DEFAULT } from "../../../lib/leverage.js";
import { normalizeName } from "../../../lib/format.js";

export const runtime = "nodejs";
export const revalidate = 86400;

// Every postseason run on record, ranked. The career board answers "who had
// the best career"; this answers "what were the best playoff runs", which is
// the surface you can actually check against memory — if a run you remember as
// overwhelming sits 400th, something is wrong with the metric, not your memory.
//
// Regular seasons are excluded on purpose. A run is a run.
//
// Ranking happens server-side because all 8,917 runs is ~360KB and the search
// has to reach every one of them, not just a prefix the client happens to hold.

// Ranked once per alpha and reused; the corpus behind it is static between
// bakes, so the only thing that can invalidate this is the dial.
const RANKED = new Map();

function rankedRuns(alpha) {
  const key = String(alpha);
  const hit = RANKED.get(key);
  if (hit) return hit;

  const built = cachedCareers();
  const runs = [];
  for (const p of built.players) {
    for (const s of p.seasons || []) {
      const r = seasonLVA(s, { alpha, includeRS: false });
      if (!(r.poGames > 0)) continue;
      runs.push({
        slug: p.slug,
        name: p.name,
        search: normalizeName(p.name || ""),
        season: s.season,
        team: s.team || "",
        games: r.poGames,
        lva: r.poLVA,
        va: r.flatVA,
      });
    }
  }
  runs.sort((a, b) => b.lva - a.lva);
  // Rank is assigned over the WHOLE list, so a searched row still reports where
  // it sits all-time rather than where it sits among the matches.
  runs.forEach((r, i) => { r.rank = i + 1; });

  RANKED.set(key, runs);
  return runs;
}

const num = (v, dflt) => {
  if (v == null || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const alpha = clamp(num(q.get("alpha"), ALPHA_DEFAULT), 0, 3);
  const limit = clamp(Math.round(num(q.get("limit"), 100)), 1, 500);
  const offset = clamp(Math.round(num(q.get("offset"), 0)), 0, 20000);
  const season = (q.get("season") || "").trim();
  const query = normalizeName((q.get("q") || "").trim());

  let all;
  try {
    all = rankedRuns(alpha);
  } catch (e) {
    clearCareerCache();
    RANKED.clear();
    return Response.json({ error: `legacy corpus unavailable: ${e.message}` }, { status: 503 });
  }

  let list = all;
  if (query) list = list.filter((r) => r.search.includes(query));
  if (season) list = list.filter((r) => r.season === season);

  const page = list.slice(offset, offset + limit).map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    season: r.season,
    team: r.team,
    games: r.games,
    lva: Math.round(r.lva * 10) / 10,
    perG: r.games > 0 ? Math.round((r.lva / r.games) * 100) / 100 : 0,
    vaPerG: r.games > 0 ? Math.round((r.va / r.games) * 100) / 100 : 0,
  }));

  return Response.json({
    runs: page,
    matched: list.length,
    total: all.length,
    offset,
    limit,
    alpha,
    query: q.get("q") || "",
    season,
  }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
