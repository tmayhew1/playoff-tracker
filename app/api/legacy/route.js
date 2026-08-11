import { cachedCareers, clearCareerCache } from "../_lib/careers.js";
import {
  rankLegacy, peakShareAt, DECAY_DEFAULT, PEAK_SEASONS_DEFAULT,
} from "../../lib/legacy.js";
import { ALPHA_DEFAULT } from "../../lib/leverage.js";
import DIALS from "../../data/legacy-dials.json";

export const runtime = "nodejs";
export const revalidate = 86400;

// The Legacy board: every career on disk ranked by leverage-weighted VA folded
// best-season-first. See app/lib/legacy.js for the metric and
// docs/value-added-spec.md §7.4 for the dials.
//
// Ranking happens HERE rather than in the browser because the input is the
// whole corpus — every playoff game's VA for every player across 46 seasons,
// tens of megabytes of it. The client gets the board, not the careers.
//
// The dials stay live as query params (?alpha=&decay=) instead of being baked
// into the response: the whole argument of the metric is that a ranking which
// moves under a defensible range of the dials is a ranking with an argument in
// it, so the API has to be able to answer for any setting, not just the default.

// The career join is cached in ../_lib/careers.js and shared with the runs
// route. Only the fold and the sort re-run per request, which is what makes
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

  // Every dial is clamped to the range it is defined on: decay must stay
  // inside (0, 1] or the fold stops being a discounted sum, and a negative
  // alpha would invert leverage so a Game 7 counted for less than a Game 1.
  const alpha = clamp(num(q.get("alpha"), ALPHA_DEFAULT), 0, 3);
  const decay = clamp(num(q.get("decay"), DECAY_DEFAULT), 0.01, 1);
  const peakSeasons = clamp(Math.round(num(q.get("peakSeasons"), PEAK_SEASONS_DEFAULT)), 1, 30);
  const includeRS = q.get("rs") !== "0";
  const top = clamp(Math.round(num(q.get("top"), 50)), 1, 500);
  const minGames = clamp(Math.round(num(q.get("minGames"), 400)), 0, 2000);
  const minSeasons = clamp(Math.round(num(q.get("minSeasons"), 3)), 1, 30);

  let built;
  try {
    built = cachedCareers();
  } catch (e) {
    // A missing or half-written data dir is a deploy problem, not a bad
    // request — say so rather than serving an empty board that looks real.
    clearCareerCache();
    return Response.json({ error: `legacy corpus unavailable: ${e.message}` }, { status: 503 });
  }

  const opts = { alpha, decay, includeRS, peakSeasons, minSeasons, minGames };
  const board = rankLegacy(built.players, opts);

  // Season folds ride along with the board rather than behind a per-player
  // fetch: they are what the row expands into, and a career is only ~20 rows,
  // so the whole top-50 costs less than one round trip per tap would.
  //
  // Rounded on the way out for exactly that reason — full float precision here
  // is ~18 characters per number to render one decimal, and it triples the
  // payload for digits nothing displays.
  const r1 = (n) => Math.round(n * 10) / 10;
  const r4 = (n) => Math.round(n * 1e4) / 1e4;

  const players = board.slice(0, top).map((p, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    total: p.total,
    peak: p.peak,
    peakRaw: p.peakRaw,
    careerLVA: p.careerLVA,
    teams: p.teams,
    careerGames: p.careerGames,
    seasonCount: p.seasonCount,
    span: p.span,
    truncated: p.truncated,
    // Already ordered best season first — the order the fold spends its decay
    // in, which is the order the expansion has to show them in.
    seasons: p.seasons.map((s) => ({
      season: s.season,
      team: s.team,
      rank: s.rank,
      lva: r1(s.lva),
      weight: r4(s.weight),
      contribution: r1(s.contribution),
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
    firstSeason: built.seasons[0] ?? null,
    lastSeason: built.seasons[built.seasons.length - 1] ?? null,
    dials: { alpha, decay, includeRS, peakSeasons, minSeasons, minGames },
    peakShare: peakShareAt(decay, peakSeasons, 20),
    // How the default decay was arrived at, so the tab can say so rather than
    // presenting a calibrated number as a taste.
    calibration: { ...DIALS, isDefault: decay === DECAY_DEFAULT },
  }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
