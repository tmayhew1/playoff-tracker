import { ALPHA_DEFAULT, gameWeight, seriesGameWeight } from "./leverage";
import DIALS from "../data/legacy-dials.json";

// Isomorphic (no "use client"), for the same reason ./leverage.js is: the fold
// runs server-side in /api/legacy, where the career corpus lives, and a client
// directive here would hand that route a client reference instead of the
// functions. Nothing below touches React or the DOM.


// --- Legacy: peak and longevity on one board --------------------------------
//
// Career VA summed straight is pure longevity: it cannot tell a decade of
// very good from seven years of overwhelming. Career VA/G is pure rate: it
// cannot tell a twenty-year peak from a four-year one. An all-time ranking
// needs both, and the user's framing is the right one — peak matters about as
// much as longevity, not infinitely more or less.
//
// So Legacy is two numbers, not one:
//
//   VOLUME  a value-weighted fold over a player's seasons (the l_p norm).
//           p = 1 is a plain career sum; p -> infinity keeps only the best.
//   RATE    leverage-weighted VA per weighted game over the best N seasons.
//
// The fold is the honest way to spend a longevity dial. Extra seasons only
// ever ADD (every term is positive when the season was), but each adds in
// proportion to how good it was, so hanging on for three replacement-level
// years is neither rewarded much nor punished — those seasons weigh little
// because they were worth little, not because of where they land in a sort.

// P is read from disk, calibrated by scripts/calibrate-legacy.mjs from a stated
// principle (see pForHalfWeightAt). Regenerate with `npm run legacy:calibrate`.
export const P_DEFAULT = DIALS.p;
export const PEAK_SEASONS_DEFAULT = 7;

// The whole dial in one sentence: a season worth `share` of your best carries
// this much of the weight your best one carries.
export function weightForShare(share, p = P_DEFAULT) {
  if (!(share > 0)) return 0;
  return Math.pow(share, p - 1);
}

// And the inverse, which is how p gets set: pick the share that should still be
// worth half, and p follows. share = 0.1 gives p = 1.30103.
export function pForHalfWeightAt(share, half = 0.5) {
  if (!(share > 0) || share >= 1) return P_DEFAULT;
  return 1 + Math.log(half) / Math.log(share);
}


// --- One season -------------------------------------------------------------
// A season row needs: `games` (playoff games with `va` and a resolved weight)
// and the regular-season VA total. Playoff games a player sat out carry
// va = null in the bake and are skipped — a missed game is not a zero.
//
// Note this sums the PER-GAME VA decomposition, which is not identical to the
// baked season-total VA: reboundGamma is non-linear in REB/MP, so evaluating
// it per game and summing differs from evaluating it once on season totals
// (mean 1.8% relative, always upward for rebounding bigs, up to +11.9 for
// 1980-81 Moses Malone). Legacy uses the per-game aggregation because gamma is
// defined on a stat line and a game IS a stat line. See spec §7.4.

// Weights are derived HERE from each game's stored cLI, not read off the row.
// ALPHA has to stay a live dial — precomputing weights at load time silently
// freezes it, and a sweep over ALPHA then returns the same board every step.
export function seasonLVA(season, { alpha = ALPHA_DEFAULT, includeRS = true } = {}) {
  const anchor = season.anchor;
  const depth = season.depth || 4;
  // The two halves are accumulated apart and summed at the end so a season can
  // be READ as the two things it is — a regular season priced at a playoff
  // berth, and a run priced by the title — rather than as one number that
  // silently mixes them. Nothing downstream changes: lva is still the sum.
  let poLVA = 0, poGames = 0, weightedGames = 0, flatVA = 0;
  let rsLVA = 0, rsGames = 0;

  // Playoff games are priced by the SERIES they belong to, not by the score
  // they were played at (see seriesGameWeight in ./leverage). Every game of a
  // series therefore carries the same weight, and a series that ended early
  // carries it in fewer games — so closing a team out concentrates value
  // instead of forfeiting it.
  for (const g of season.games || []) {
    if (g.va == null) continue;
    const w = g.seriesGames > 0
      ? seriesGameWeight(g.roundsAfter, depth, g.seriesGames, alpha)
      // A game whose series could not be resolved (an in-progress bracket)
      // falls back to its own state rather than scoring zero.
      : gameWeight(g.cli, alpha, anchor);
    if (!(w > 0)) continue;
    poLVA += w * g.va;
    weightedGames += w;
    flatVA += g.va;
    poGames += 1;
  }

  if (includeRS && season.rsVA != null && season.rsCLI > 0) {
    const w = gameWeight(season.rsCLI, alpha, anchor);
    rsLVA += w * season.rsVA;
    weightedGames += w * (season.rsGames || 0);
    flatVA += season.rsVA;
    rsGames += season.rsGames || 0;
  }

  return {
    lva: poLVA + rsLVA, weightedGames, flatVA, games: poGames + rsGames,
    poLVA, poGames, rsLVA, rsGames,
  };
}


// --- The fold ---------------------------------------------------------------
// Weight by VALUE, not by rank.
//
// A rank-decayed fold says your eighth-best season counts 23% whether it was
// nearly your best or nearly worthless. That is the arbitrariness no choice of
// D can remove, because rank is the wrong variable: what should decide a
// season's weight is how good it was.
//
// So the positive seasons aggregate under the l_p norm
//
//     L = ( sum x^p )^(1/p)
//
// which is the CES aggregator from economics, with p as the elasticity of
// substitution between seasons. It needs no invented constants: p = 1 is a
// plain career sum, p -> infinity keeps only the best season, exactly the two
// endpoints the rank-decayed fold had. It is homogeneous of degree 1, so the
// total stays in points; and by Euler's theorem on such functions the
// per-season contributions below sum to it EXACTLY, so a career still reads as
// the sum it is.
//
// The weight that falls out is (x_i / L)^(p-1) — nothing asserted. Relative to
// the best season it is (x_i / x_1)^(p-1), which is the whole dial in a
// sentence, and it adapts: a career with many near-peak years gets a long
// plateau, one built on a single towering season gets a steep drop.
//
// Negative seasons are a linear debit rather than a curved one. Being below
// league average costs a team points at face value; there is no peak to reward
// in it, and a convex transform would pay for it (squared, the worst season on
// the board — Bruce Bowen's -479.5 — becomes +229,948 of credit).
export function legacyFold(lvas, p = P_DEFAULT) {
  const sorted = [...lvas].sort((a, b) => b - a);

  // Factor the best season out before raising anything to p. Summing v^p
  // directly overflows to Infinity for large p — 900^400 is about 10^1181 —
  // and every ratio here is <= 1, so this form cannot. It is also exactly
  // equal: m * (sum (v/m)^p)^(1/p) = (sum v^p)^(1/p).
  let debit = 0, m = 0;
  for (const v of sorted) {
    if (v > 0) { if (v > m) m = v; }
    else debit += -v;
  }
  let ratios = 0;
  if (m > 0) for (const v of sorted) if (v > 0) ratios += Math.pow(v / m, p);
  const norm = m > 0 ? m * Math.pow(ratios, 1 / p) : 0;

  const terms = sorted.map((lva, i) => {
    const weight = lva > 0 ? (norm > 0 ? Math.pow(lva / norm, p - 1) : 0) : 1;
    return { lva, rank: i + 1, weight, contribution: weight * lva };
  });

  return { total: norm - debit, terms, norm, debit };
}


// --- One career -------------------------------------------------------------
// `player.seasons` is an array of season rows already carrying resolved
// per-game weights (see buildCareers in scripts/legacy-report.mjs, which is
// where the data join lives).
export function playerLegacy(player, {
  alpha = ALPHA_DEFAULT,
  p = P_DEFAULT,
  includeRS = true,
  peakSeasons = PEAK_SEASONS_DEFAULT,
} = {}) {
  const rows = (player.seasons || []).map((s) => ({
    season: s.season,
    team: s.team,
    ...seasonLVA(s, { alpha, includeRS }),
  }));

  rows.sort((a, b) => b.lva - a.lva);

  const fold = legacyFold(rows.map((r) => r.lva), p);
  const seasons = rows.map((r, i) => ({ ...r, ...fold.terms[i] }));

  // Peak rate: leverage-weighted VA per weighted game across the best seasons.
  // Weighted, not raw, on purpose — if importance weights the total it has to
  // weight the rate too, or the two halves of the metric disagree about what a
  // game is worth. This is also where the Jordan/LeBron question resolves:
  // Jordan leads on raw per-game VA and trails once the games are priced by
  // what was at stake.
  const top = rows.slice(0, peakSeasons);
  const wg = top.reduce((s, r) => s + r.weightedGames, 0);
  const peak = wg > 0 ? top.reduce((s, r) => s + r.lva, 0) / wg : 0;

  // The same rate unweighted, carried alongside so the divergence stays
  // visible instead of being buried in the choice of axis.
  const rawG = top.reduce((s, r) => s + r.games, 0);
  const peakRaw = rawG > 0 ? top.reduce((s, r) => s + r.flatVA, 0) / rawG : 0;

  return {
    slug: player.slug,
    name: player.name,
    teams: player.teams,
    pos: player.pos ?? null,
    total: fold.total,
    peak, peakRaw,
    careerLVA: rows.reduce((s, r) => s + r.lva, 0),
    careerGames: rows.reduce((s, r) => s + r.games, 0),
    seasonCount: rows.length,
    span: rows.length
      ? `${rows.reduce((m, r) => (r.season < m ? r.season : m), rows[0].season)}–${
          rows.reduce((m, r) => (r.season > m ? r.season : m), rows[0].season)}`
      : "",
    truncated: player.truncated || false,
    seasons,
  };
}


// --- The board --------------------------------------------------------------
// Ranked by the volume axis. `peak` rides alongside rather than being blended
// in: a single composite would need both axes normalized against the pool
// leader, which makes every player's score depend on who else is in the pool —
// fine for a leaderboard, wrong for a career number that should not move when
// a rookie debuts.
export function rankLegacy(players, opts = {}) {
  const { minSeasons = 1, minGames = 0 } = opts;
  return players
    .map((pl) => playerLegacy(pl, opts))
    .filter((pl) => pl.seasonCount >= minSeasons && pl.careerGames >= minGames)
    .sort((a, b) => b.total - a.total);
}


// --- Choosing D, without inventing constants --------------------------------
// The superseded derivation asked "the best K seasons should carry `share` of
// an N-season career" and solved for D. That is three assertions (K, N, share)
// wearing one equation, and it does not deliver what it claims: at the 0.94 it
// produced, the board sits tau 0.94 from a pure career sum but only tau 0.75
// from a pure peak ranking. Half the WEIGHT is not half the INFLUENCE, because
// the tail of a career is many cheap seasons.
//
// The fold has two endpoints that need no constants at all:
//
//   D = 1    a plain career sum          — pure longevity
//   D -> 0   the single best season      — pure peak
//
// So "peak matters about as much as longevity" can be measured instead of
// asserted: take the D whose ranking is equidistant from those two endpoints,
// by rank correlation over the actual careers. One stated symmetry, no
// invented numbers, and the answer moves only when the corpus does.

// Kendall tau-a between two slug -> rank maps, over the slugs they share.
export function rankTau(a, b, pool) {
  let con = 0, dis = 0;
  for (let i = 0; i < pool.length; i++) {
    const ai = a.get(pool[i]), bi = b.get(pool[i]);
    for (let j = i + 1; j < pool.length; j++) {
      const s = (ai - a.get(pool[j])) * (bi - b.get(pool[j]));
      if (s > 0) con++; else if (s < 0) dis++;
    }
  }
  return con + dis === 0 ? 0 : (con - dis) / (con + dis);
}

// Where a given p leaves the board on that axis. This REPORTS rather than
// solves: p is set by the half-weight rule above, and no p balances the two
// distances anyway. Guaranteeing the tail real weight and sitting equidistant
// between peak and longevity are incompatible for careers shaped like these —
// the tails are long, so anything that keeps them alive tilts longevity-ward.
// Worth measuring precisely because it is the cost of the shape.
export function balanceOf(players, opts = {}) {
  const board = rankLegacy(players, opts);
  if (board.length < 2) return null;

  // The two references are computed straight off the season values, not by
  // running this family to its own limits: at large p the fold still carries
  // the negative debit, so it never becomes a clean best-season ranking and
  // using it as one would overstate the gap.
  const rows = board.map((x) => ({
    slug: x.slug,
    here: x.total,
    sum: x.seasons.reduce((s, r) => s + r.lva, 0),
    max: x.seasons.length ? Math.max(...x.seasons.map((r) => r.lva)) : 0,
  }));
  const pool = rows.map((r) => r.slug);
  const rankOf = (key) => new Map(
    [...rows].sort((a, b) => b[key] - a[key]).map((r, i) => [r.slug, i + 1]));

  const here = rankOf("here");
  const tau = rankTau(here, rankOf("sum"), pool);
  const tauPeak = rankTau(here, rankOf("max"), pool);
  return { pool: pool.length, tau, tauPeak, gap: tau - tauPeak };
}


// --- The dial sweep ---------------------------------------------------------
// Sweeps one dial across its range and reports each tracked player's score and
// rank at every step, plus the exact dial values where two of the leaders swap
// order. The crossings are the point: a ranking that changes under a defensible
// range of the dial is a ranking with an argument in it, and hiding that behind
// one default would be dishonest.
export function dialSweep(players, {
  dial = "p",
  alpha = ALPHA_DEFAULT,
  p = P_DEFAULT,
  includeRS = true,
  from = dial === "p" ? 1 : 0,
  to = dial === "p" ? 3 : 1,
  steps = 51,
  topN = 12,
} = {}) {
  const xs = Array.from({ length: steps }, (_, i) => from + ((to - from) * i) / (steps - 1));

  const base = rankLegacy(players, { alpha, p, includeRS }).slice(0, topN);
  const tracked = base.map((x) => x.slug);
  const byStep = xs.map((x) => {
    const o = dial === "p" ? { alpha, p: x } : { alpha: x, p };
    const board = rankLegacy(players, { ...o, includeRS });
    const rank = new Map(board.map((pl, i) => [pl.slug, i + 1]));
    const score = new Map(board.map((pl) => [pl.slug, pl.total]));
    return { rank, score };
  });

  const series = base.map((pl) => ({
    slug: pl.slug,
    name: pl.name,
    scores: byStep.map((s) => s.score.get(pl.slug) ?? 0),
    ranks: byStep.map((s) => s.rank.get(pl.slug) ?? Infinity),
  }));

  // Linear interpolation of the crossing point between adjacent steps.
  const crossings = [];
  for (let a = 0; a < tracked.length; a++) {
    for (let b = a + 1; b < tracked.length; b++) {
      const A = series[a], B = series[b];
      for (let i = 1; i < xs.length; i++) {
        const d0 = A.scores[i - 1] - B.scores[i - 1];
        const d1 = A.scores[i] - B.scores[i];
        if (d0 === 0 || d1 === 0 || d0 > 0 === d1 > 0) continue;
        const t = d0 / (d0 - d1);
        crossings.push({
          x: xs[i - 1] + t * (xs[i] - xs[i - 1]),
          above: d1 > 0 ? A.slug : B.slug,
          below: d1 > 0 ? B.slug : A.slug,
        });
      }
    }
  }
  crossings.sort((p, q) => p.x - q.x);

  return { dial, xs, series, crossings };
}
