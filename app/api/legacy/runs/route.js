import { cachedCareers, clearCareerCache } from "../../_lib/careers.js";
import { seasonLVA } from "../../../lib/legacy.js";
import { ALPHA_DEFAULT, seriesGameWeight, gameWeight } from "../../../lib/leverage.js";
import { normalizeName } from "../../../lib/format.js";
import { POSITIONS, matchesPosition } from "../../../lib/positions.js";
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

// Built once per alpha and reused; the corpus behind it is static between
// bakes, so the only thing that can invalidate this is the dial. BASE holds the
// unordered runs; RANKED holds one ordering per sort, because a rank only means
// anything against the column being read.
const BASE = new Map();
const RANKED = new Map();

function baseRuns(alpha) {
  const key = String(alpha);
  const hit = BASE.get(key);
  if (hit) return hit;

  const built = cachedCareers();
  const runs = [];
  for (const p of built.players) {
    for (const s of p.seasons || []) {
      const r = seasonLVA(s, { alpha, includeRS: false });
      if (!(r.poGames > 0)) continue;
      // The regular season of the SAME year, priced the same way, so a run can
      // be read against the winter that preceded it.
      const full = seasonLVA(s, { alpha, includeRS: true });
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
        // The position he was listed at THAT season, falling back to the
        // career's modal one where the season file predates the column. A run
        // is one year of a career, so the season's own listing is the truer
        // answer wherever the corpus has it.
        pos: s.pos || p.pos || null,
        // Kept off the wire — the page slice reads stats off it on the way out.
        row: s,
      });
    }
  }
  BASE.set(key, runs);
  return runs;
}


// The two columns a run can be read on. LVA is the run's whole leveraged value;
// VA/G is the raw per-game rate behind it — the one that says a short run was
// played at a higher level than a long one that outscores it in total.
// A Map rather than an object literal, so a query string asking for
// "constructor" gets a miss instead of Object.prototype's — an inherited key
// would pass the check below and then be called as a comparator.
const RUN_SORTS = new Map([
  ["lva", (r) => r.lva],
  ["vapg", (r) => (r.games > 0 ? r.va / r.games : 0)],
]);

// One ordering, with the rank it implies. Rank is assigned over the WHOLE list
// before any filter narrows it, so a searched row still reports where it sits
// all-time rather than where it sits among the matches.
//
// Copied rather than ranked in place: the same run objects back every sort, and
// writing `rank` onto them would leave whichever ordering was built last
// stamping its ranks over the other one.
function rankedRuns(alpha, sort) {
  const key = `${alpha}|${sort}`;
  const hit = RANKED.get(key);
  if (hit) return hit;

  const value = RUN_SORTS.get(sort) || RUN_SORTS.get("lva");
  const list = [...baseRuns(alpha)]
    .sort((a, b) => value(b) - value(a))
    .map((r, i) => ({ ...r, rank: i + 1 }));

  RANKED.set(key, list);
  return list;
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
  const lga = lgaForSeason(row.season);
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
// consistent choice here and they sum to exactly the rsVA the fold used.
function rsStats(row) {
  if (!row.rs || !(row.rs.gp > 0)) return null;
  return statsFrom(row.rs, valueAddByCategory(row.rs, lgaForSeason(row.season)));
}

// Every game of one run, heaviest contribution first.
function runGames(row, alpha) {
  const depth = row.depth || 4;
  const lga = lgaForSeason(row.season);
  return (row.games || [])
    .filter((g) => g.va != null)
    .map((g) => {
      const w = g.seriesGames > 0
        ? seriesGameWeight(g.roundsAfter, depth, g.seriesGames, alpha)
        : gameWeight(g.cli, alpha, row.anchor);
      const l = g.line || {};
      return {
        gameId: g.gameId,
        round: g.round,
        opp: g.opp || "",
        gameNo: g.seriesGameNumber,
        seriesGames: g.seriesGames,
        state: g.a != null && g.b != null ? `${g.a}-${g.b}` : "",
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
  const limit = clamp(Math.round(num(q.get("limit"), 100)), 1, 500);
  const offset = clamp(Math.round(num(q.get("offset"), 0)), 0, 20000);
  const season = (q.get("season") || "").trim();
  const team = (q.get("team") || "").trim().toUpperCase();
  const query = normalizeName((q.get("q") || "").trim());
  // Sorted here rather than in the browser for the same reason the careers
  // board is: the client holds only the pages it has asked for, so ordering
  // there would sort a prefix of the board and look like it had sorted all of
  // it. An unrecognized value falls back to LVA rather than erroring.
  const sort = RUN_SORTS.has(q.get("sort")) ? q.get("sort") : "lva";
  // Filtered here for the same reason. Unknown values fall back to no filter,
  // so a stale bookmark shows the board rather than a 400.
  const posParam = (q.get("pos") || "").toUpperCase().trim();
  const pos = POSITIONS.includes(posParam) ? posParam : "";

  let all;
  try {
    all = rankedRuns(alpha, sort);
  } catch (e) {
    clearCareerCache();
    BASE.clear();
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
    // Careers fold shows those rows and they have a regular season to explain.
    const pl = cachedCareers().players.find((x) => x.slug === slug);
    const row = pl && (pl.seasons || []).find((s) => s.season === season);
    if (!row) return Response.json({ error: "no such season" }, { status: 404 });
    // The all-time rank a run detail reports is its LVA rank, not its rank in
    // whatever the board happens to be sorted on — the panel opens from the
    // careers fold too, which has no sort of its own to inherit.
    const ranked = rankedRuns(alpha, "lva").find((r) => r.slug === slug && r.season === season);
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
      games: runGames(row, alpha),
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
  // Position matches the same way it does on the careers board: a bucket keeps
  // everything inside it, and a run whose season carried no position at all
  // matches nothing rather than padding every bucket.
  if (pos) list = list.filter((r) => matchesPosition(r.pos, pos));

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
    pos: r.pos,
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
    sort,
    pos,
    // Whether the corpus knows positions at all — same gate the careers board
    // uses, and for the same reason: a filter whose every option empties the
    // board reads as a broken board rather than a pending backfill.
    hasPos: all.some((r) => r.pos),
    seasons,
    teams,
    categories: VA_CATEGORY_KEYS,
  }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
