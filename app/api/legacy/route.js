import { cachedCareers, clearCareerCache } from "../_lib/careers.js";
import { rankLegacy, PEAK_SEASONS_DEFAULT } from "../../lib/legacy.js";
import { ALPHA_DEFAULT, OMEGA_DEFAULT } from "../../lib/leverage.js";
import { normalizeName } from "../../lib/format.js";
import { POSITIONS, matchesPosition } from "../../lib/positions.js";

export const runtime = "nodejs";
export const revalidate = 86400;

// The Legacy board: every career on disk ranked by its leverage-weighted VA,
// summed. See app/lib/legacy.js for the metric and docs/value-added-spec.md
// §7.4 for the dials.
//
// Ranking happens HERE rather than in the browser because the input is the
// whole corpus — every playoff game's VA for every player across 46 seasons,
// tens of megabytes of it. The client gets the board, not the careers.
//
// The dials stay live as query params (?alpha=&omega=) instead of being baked
// into the response: the whole argument of the metric is that a ranking which
// moves under a defensible range of the dials is a ranking with an argument in
// it, so the API has to be able to answer for any setting, not just the default.

// The career join is cached in ../_lib/careers.js and shared with the runs
// route. Only the scoring and the sort re-run per request, which is what makes
// the dials cheap.

// An absent param must fall back to the default, and `Number(null)` is 0 — a
// perfectly finite number that would silently pin every dial to the bottom of
// its range. Missing and empty are checked before the coercion, not after.
const num = (v, dflt) => {
  if (v == null || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export async function GET(request) {
  const q = new URL(request.url).searchParams;

  // Every dial is clamped to the range it is defined on: a negative alpha would
  // invert leverage so a Game 7 counted for less than a Game 1.
  const alpha = clamp(num(q.get("alpha"), ALPHA_DEFAULT), 0, 3);
  // omega is a share, so it is only defined on [0, 1]: 0 splits a series' pot
  // evenly between its two teams, 1 splits it strictly by games won.
  const omega = clamp(num(q.get("omega"), OMEGA_DEFAULT), 0, 1);
  const peakSeasons = clamp(Math.round(num(q.get("peakSeasons"), PEAK_SEASONS_DEFAULT)), 1, 30);
  const includeRS = q.get("rs") !== "0";
  const top = clamp(Math.round(num(q.get("top"), 50)), 1, 500);
  const offset = clamp(Math.round(num(q.get("offset"), 0)), 0, 5000);
  // Sorting server-side so it composes with paging. Sorted client-side it would
  // only ever order the rows already fetched, which reads as a whole-board sort
  // and is not one the moment there is a second page.
  const sort = q.get("sort") === "peak" ? "peak" : "total";
  // Searched here rather than in the browser for the same reason the sort is:
  // the client holds only the pages it has asked for, so filtering there would
  // search a prefix of the board and look like it had searched all of it.
  const query = normalizeName((q.get("q") || "").trim());
  const minGames = clamp(Math.round(num(q.get("minGames"), 400)), 0, 2000);
  // No seasons requirement by default. It was redundant wherever it used to
  // matter — the fewest seasons anyone with 400 games has played is five — and
  // where it was NOT redundant it silently overrode the games control, hiding
  // short careers the reader had just asked to see. The parameter stays for
  // anyone who wants it back.
  const minSeasons = clamp(Math.round(num(q.get("minSeasons"), 1)), 1, 30);
  // Filtered here rather than in the browser for the same reason the search is:
  // the client holds only the pages it has asked for. An unrecognized value
  // falls back to no filter instead of erroring — a stale bookmark should show
  // the board, not a 400.
  const posParam = (q.get("pos") || "").toUpperCase().trim();
  const pos = POSITIONS.includes(posParam) ? posParam : "";

  let built;
  try {
    built = cachedCareers();
  } catch (e) {
    // A missing or half-written data dir is a deploy problem, not a bad
    // request — say so rather than serving an empty board that looks real.
    clearCareerCache();
    return Response.json({ error: `legacy corpus unavailable: ${e.message}` }, { status: 503 });
  }

  const opts = { alpha, omega, includeRS, peakSeasons, minSeasons, minGames };
  const ranked = rankLegacy(built.players, opts);
  // rankLegacy already orders by total; re-sort only when asked for the other
  // axis, and take the rank from THIS order so a row reports where it sits on
  // the column being read.
  const board = sort === "peak" ? [...ranked].sort((a, b) => b.peak - a.peak) : ranked;

  // The season breakdown rides along with the board rather than behind a
  // per-player fetch: it is what the row expands into, and a career is only ~20
  // rows, so the whole top-50 costs less than one round trip per tap would.
  //
  // Rounded on the way out for exactly that reason — full float precision here
  // is ~18 characters per number to render one decimal, and it triples the
  // payload for digits nothing displays.
  const r1 = (n) => Math.round(n * 10) / 10;

  // Rank is fixed against the whole sorted board BEFORE any search narrows it,
  // so a found player reports where he sits all-time rather than his position
  // among the matches.
  // Rank is taken before the position filter as well as before the search, and
  // for the same reason: a guard filtered to guards should still report the
  // place he holds on the whole board, not third among the ones left showing.
  const ranked2 = board.map((pl, i) => ({ pl, rank: i + 1 }));
  const searched = query
    ? ranked2.filter(({ pl }) => normalizeName(pl.name || "").includes(query))
    : ranked2;
  const matched = pos
    ? searched.filter(({ pl }) => matchesPosition(pl.pos, pos))
    : searched;

  // Whether the corpus knows positions at all. The field arrives only on
  // season files baked since the totals scraper started reading it, so until
  // that backfill runs every career answers null — and a filter whose every
  // option empties the board is worse than no filter, so the client hides it.
  const hasPos = board.some((pl) => pl.pos);

  const players = matched.slice(offset, offset + top).map(({ pl, rank }) => ({
    rank,
    slug: pl.slug,
    name: pl.name,
    pos: pl.pos,
    total: pl.total,
    peak: pl.peak,
    peakRaw: pl.peakRaw,
    teams: pl.teams,
    careerGames: pl.careerGames,
    seasonCount: pl.seasonCount,
    span: pl.span,
    truncated: pl.truncated,
    // Already ordered best season first, which is the order the expansion shows
    // them in — a career reads from its peak down.
    seasons: pl.seasons.map((s) => ({
      season: s.season,
      team: s.team,
      rank: s.rank,
      lva: r1(s.lva),
      games: s.games,
      poLVA: r1(s.poLVA),
      poGames: s.poGames,
      rsLVA: r1(s.rsLVA),
      rsGames: s.rsGames,
    })),
  }));

  return Response.json({
    players,
    qualified: board.length,
    matched: matched.length,
    query: q.get("q") || "",
    pos,
    hasPos,
    offset,
    limit: top,
    sort,
    firstSeason: built.seasons[0] ?? null,
    lastSeason: built.seasons[built.seasons.length - 1] ?? null,
    dials: { alpha, omega, includeRS, peakSeasons, minSeasons, minGames },
  }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
