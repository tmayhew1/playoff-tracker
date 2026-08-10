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
//   VOLUME  a rank-decayed fold over a player's seasons, ordered best-first.
//           D = 1 is a plain career sum; D -> 0 keeps only the best season.
//   RATE    leverage-weighted VA per weighted game over the best N seasons.
//
// The fold is the honest way to spend a longevity dial. Extra seasons only
// ever ADD (every term is positive when the season was), but each adds less
// than the one above it, so hanging on for three replacement-level years is
// neither rewarded much nor punished — it lands at the bottom of the sort
// where D^k has already made it small.

// D is calibrated against the corpus by scripts/calibrate-legacy.mjs and read
// from disk, so the balance point is a measurement rather than a taste — see
// decayForBalance below for what is being measured. Regenerate with
// `npm run legacy:calibrate` whenever the bake adds seasons.
export const DECAY_DEFAULT = DIALS.decay;
export const PEAK_SEASONS_DEFAULT = 7;

// The share of total weight the best k of n seasons carry at a given D. This
// is a READOUT, not a derivation — it is how the dial gets labelled, and the
// mistake it used to encode was running it backwards to set D.
export function peakShareAt(decay, k = PEAK_SEASONS_DEFAULT, n = 20) {
  if (decay >= 1) return k / n;
  return (1 - Math.pow(decay, k)) / (1 - Math.pow(decay, n));
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
// Sort descending, then weight the k-th best season by D^(k-1). Returns the
// ranked terms as well as the total so a career can be shown as the sum it is
// rather than as an opaque number.
export function legacyFold(lvas, decay = DECAY_DEFAULT) {
  const sorted = [...lvas].sort((a, b) => b - a);
  const terms = sorted.map((lva, i) => {
    const weight = Math.pow(decay, i);
    return { lva, rank: i + 1, weight, contribution: weight * lva };
  });
  return { total: terms.reduce((s, t) => s + t.contribution, 0), terms };
}


// --- One career -------------------------------------------------------------
// `player.seasons` is an array of season rows already carrying resolved
// per-game weights (see buildCareers in scripts/legacy-report.mjs, which is
// where the data join lives).
export function playerLegacy(player, {
  alpha = ALPHA_DEFAULT,
  decay = DECAY_DEFAULT,
  includeRS = true,
  peakSeasons = PEAK_SEASONS_DEFAULT,
} = {}) {
  const rows = (player.seasons || []).map((s) => ({
    season: s.season,
    team: s.team,
    ...seasonLVA(s, { alpha, includeRS }),
  }));

  rows.sort((a, b) => b.lva - a.lva);

  const fold = legacyFold(rows.map((r) => r.lva), decay);
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
    .map((p) => playerLegacy(p, opts))
    .filter((p) => p.seasonCount >= minSeasons && p.careerGames >= minGames)
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

export function decayForBalance(players, opts = {}) {
  const ranks = (decay) => new Map(
    rankLegacy(players, { ...opts, decay }).map((p, i) => [p.slug, i + 1]));

  const longevity = ranks(1);
  const peak = ranks(1e-9);
  const pool = [...longevity.keys()].filter((s) => peak.has(s));
  if (pool.length < 2) return DECAY_DEFAULT;

  // Monotone in D: more decay pulls the ranking toward peak, less toward the
  // plain sum. Bisect on the difference.
  const f = (d) => {
    const m = ranks(d);
    return rankTau(m, longevity, pool) - rankTau(m, peak, pool);
  };
  let lo = 0.05, hi = 0.999;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid; else lo = mid;
  }
  const decay = (lo + hi) / 2;
  const m = ranks(decay);
  return {
    decay,
    pool: pool.length,
    tau: rankTau(m, longevity, pool),
    tauPeak: rankTau(m, peak, pool),
  };
}


// --- The dial sweep ---------------------------------------------------------
// Sweeps one dial across its range and reports each tracked player's score and
// rank at every step, plus the exact dial values where two of the leaders swap
// order. The crossings are the point: a ranking that changes under a defensible
// range of the dial is a ranking with an argument in it, and hiding that behind
// one default would be dishonest.
export function dialSweep(players, {
  dial = "decay",
  alpha = ALPHA_DEFAULT,
  decay = DECAY_DEFAULT,
  includeRS = true,
  from = dial === "decay" ? 0.5 : 0,
  to = dial === "decay" ? 1 : 1,
  steps = 51,
  topN = 12,
} = {}) {
  const xs = Array.from({ length: steps }, (_, i) => from + ((to - from) * i) / (steps - 1));

  const base = rankLegacy(players, { alpha, decay, includeRS }).slice(0, topN);
  const tracked = base.map((p) => p.slug);
  const byStep = xs.map((x) => {
    const o = dial === "decay" ? { alpha, decay: x } : { alpha: x, decay };
    const board = rankLegacy(players, { ...o, includeRS });
    const rank = new Map(board.map((p, i) => [p.slug, i + 1]));
    const score = new Map(board.map((p) => [p.slug, p.total]));
    return { rank, score };
  });

  const series = base.map((p) => ({
    slug: p.slug,
    name: p.name,
    scores: byStep.map((s) => s.score.get(p.slug) ?? 0),
    ranks: byStep.map((s) => s.rank.get(p.slug) ?? Infinity),
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
