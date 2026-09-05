import { cachedCareers, clearCareerCache } from "../../_lib/careers.js";
import { seasonLVA } from "../../../lib/legacy.js";
import { ALPHA_DEFAULT, OMEGA_DEFAULT, seriesGameWeight, gameWeight } from "../../../lib/leverage.js";
import { normalizeName } from "../../../lib/format.js";
import { valueAddByCategory, VA_CATEGORY_KEYS, lgaForSeason } from "../../../scoring.js";

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

// Ranked once per dial setting and reused; the corpus behind it is static
// between bakes, so the only thing that can invalidate this is the dials.
const RANKED = new Map();

function rankedRuns(alpha, omega) {
  const key = `${alpha}|${omega}`;
  const hit = RANKED.get(key);
  if (hit) return hit;

  const built = cachedCareers();
  const runs = [];
  for (const p of built.players) {
    for (const s of p.seasons || []) {
      const r = seasonLVA(s, { alpha, omega, includeRS: false });
      if (!(r.poGames > 0)) continue;
      // The regular season of the SAME year, priced the same way, so a run can
      // be read against the winter that preceded it.
      const full = seasonLVA(s, { alpha, omega, includeRS: true });
      runs.push({
        slug: p.slug,
        name: p.name,
        search: normalizeName(p.name || ""),
        season: s.season,
        team: s.team || "",
        games: r.poGames,
        lva: r.poLVA,
        va: r.flatVA,
        rsLVA: full.rsLVA,
        rsGames: full.rsGames,
        // Kept off the wire — the page slice reads stats off it on the way out.
        row: s,
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

const r2 = (n) => Math.round(n * 100) / 100;
const pct = (made, att) => (att > 0 ? Math.round((made / att) * 1000) / 10 : null);

// The production behind a run: per-game stats, and what each category of them
// was worth. Computed only for the rows actually being returned.
// Rebounds split and two-point shooting separated from three, so every stat
// shown lines up with exactly one VA category underneath it.
function statsFrom(line, cats) {
  const gp = line?.gp || 0;
  if (!gp) return null;
  return {
    games: gp,
    mpg: r2(line.mp / gp), pts: r2(line.pts / gp),
    drb: r2(line.drb / gp), orb: r2(line.orb / gp),
    ast: r2(line.ast / gp), stl: r2(line.stl / gp), blk: r2(line.blk / gp),
    tov: r2(line.tov / gp),
    tw: pct(line.fgm - line.tpm, line.fga - line.tpa),
    tp: pct(line.tpm, line.tpa),
    ft: pct(line.ftm, line.fta),
    // Per game, to sit in the same units as the stats above them.
    va: Object.fromEntries(VA_CATEGORY_KEYS.map((k) => [k, r2((cats[k] || 0) / gp)])),
  };
}

function runStats(row) {
  // A playoff run, so the playoff-blended baseline (spec §4.8). rsStats below
  // stays on the regular-season one — the two halves of a season are scored
  // against the league each was actually played in.
  const lga = lgaForSeason(row.season, false, "po");
  // Category VA is summed PER GAME so the ten categories add up to the run's
  // own VA. Evaluating them once on the run's totals would come out slightly
  // different — the rebound credit is non-linear in REB/MP (spec §7.4).
  const cats = Object.fromEntries(VA_CATEGORY_KEYS.map((k) => [k, 0]));
  for (const g of row.games || []) {
    const c = valueAddByCategory(g.line, lga);
    for (const k of VA_CATEGORY_KEYS) cats[k] += c[k] || 0;
  }
  return statsFrom(row.po, cats);
}

// The regular season has no per-game lines baked, only totals — which is also
// how its VA is computed, so evaluating the categories on those totals is the
// consistent choice here and they sum to exactly the rsVA the board used.
function rsStats(row) {
  if (!row.rs || !(row.rs.gp > 0)) return null;
  return statsFrom(row.rs, valueAddByCategory(row.rs, lgaForSeason(row.season)));
}

// Every game of one run, heaviest contribution first.
function runGames(row, alpha, omega) {
  const depth = row.depth || 4;
  const lga = lgaForSeason(row.season, false, "po");
  return (row.games || [])
    .filter((g) => g.va != null)
    .map((g) => {
      const w = g.seriesGames > 0
        ? seriesGameWeight(g.roundsAfter, depth, g.seriesGames, alpha, g.seriesWins, omega)
        : gameWeight(g.cli, alpha, row.anchor);
      const l = g.line || {};
      return {
        gameId: g.gameId,
        round: g.round,
        opp: g.opp || "",
        gameNo: g.seriesGameNumber,
        seriesGames: g.seriesGames,
        state: g.a != null && g.b != null ? `${g.a}-${g.b}` : "",
        // How the series came out for this team, which is what set the weight
        // above — the game's own state only names where in it the game fell.
        seriesWins: g.seriesWins ?? null,
        mp: r2(l.mp || 0), pts: l.pts || 0, reb: l.reb || 0, ast: l.ast || 0,
        stl: l.stl || 0, blk: l.blk || 0, tov: l.tov || 0,
        fgm: l.fgm || 0, fga: l.fga || 0, tpm: l.tpm || 0, tpa: l.tpa || 0,
        ftm: l.ftm || 0, fta: l.fta || 0,
        va: r2(g.va),
        weight: Math.round(w * 1000) / 1000,
        contribution: r2(w * g.va),
        cats: Object.fromEntries(
          Object.entries(valueAddByCategory(l, lga)).map(([k, v]) => [k, r2(v)])),
      };
    })
    .sort((a, b) => b.contribution - a.contribution);
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
  const omega = clamp(num(q.get("omega"), OMEGA_DEFAULT), 0, 1);
  const limit = clamp(Math.round(num(q.get("limit"), 100)), 1, 500);
  const offset = clamp(Math.round(num(q.get("offset"), 0)), 0, 20000);
  const season = (q.get("season") || "").trim();
  const team = (q.get("team") || "").trim().toUpperCase();
  const query = normalizeName((q.get("q") || "").trim());

  let all;
  try {
    all = rankedRuns(alpha, omega);
  } catch (e) {
    clearCareerCache();
    RANKED.clear();
    return Response.json({ error: `legacy corpus unavailable: ${e.message}` }, { status: 503 });
  }

  // Detail for one run: every game of it, heaviest first. Fetched on tap
  // rather than shipped with the board — a hundred runs carry roughly two
  // thousand games between them.
  const slug = (q.get("slug") || "").trim();
  if (slug && season) {
    // Looked up against the whole corpus rather than against the ranked runs,
    // so a season the player spent out of the playoffs still opens — the
    // Careers board shows those rows and they have a regular season to explain.
    const pl = cachedCareers().players.find((x) => x.slug === slug);
    const row = pl && (pl.seasons || []).find((s) => s.season === season);
    if (!row) return Response.json({ error: "no such season" }, { status: 404 });
    const ranked = all.find((r) => r.slug === slug && r.season === season);
    return Response.json({
      run: {
        rank: ranked ? ranked.rank : null,
        slug, name: pl.name, season: row.season, team: row.team,
        games: ranked ? ranked.games : 0,
        lva: ranked ? Math.round(ranked.lva * 10) / 10 : 0,
        rsLVA: ranked ? Math.round(ranked.rsLVA * 10) / 10 : null,
        stats: runStats(row),
        rsStats: rsStats(row),
      },
      games: runGames(row, alpha, omega),
      categories: VA_CATEGORY_KEYS,
    }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
  }

  let list = all;
  if (query) list = list.filter((r) => r.search.includes(query));
  if (season) list = list.filter((r) => r.season === season);
  // Team narrows WITHIN a season and only there. A tricode across 46 years is
  // a different question — franchises move, rename, and field unrelated rosters
  // — so without a season the parameter is ignored rather than half-answered.
  if (season && team) list = list.filter((r) => r.team === team);

  // The seasons that actually have runs, and the teams that appear in the
  // selected one. Derived from the ranked list so the controls can never offer
  // a combination that returns nothing.
  const seasons = [...new Set(all.map((r) => r.season))].sort().reverse();
  const teams = season
    ? [...new Set(all.filter((r) => r.season === season).map((r) => r.team).filter(Boolean))].sort()
    : [];

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
    // The same season's regular season, priced the same way — the light bar.
    rsLVA: Math.round(r.rsLVA * 10) / 10,
    rsGames: r.rsGames,
    stats: runStats(r.row),
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
    team: season ? team : "",
    seasons,
    teams,
    categories: VA_CATEGORY_KEYS,
  }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
