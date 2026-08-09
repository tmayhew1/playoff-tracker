import { ALPHA_DEFAULT, gameWeight } from "./leverage";

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

export const DECAY_DEFAULT = 0.94;
export const PEAK_SEASONS_DEFAULT = 7;


// --- Choosing D -------------------------------------------------------------
// D is not a free parameter — it is pinned by what you believe about peak vs
// longevity. "The best K seasons should carry `share` of the weight of an
// N-season career" is one equation in one unknown:
//
//   (1 - D^K) / (1 - D^N) = share
//
// At K = 7, N = 20, share = 0.5 the root is 0.938068 — hence the 0.94 default.
// Solved by bisection; the left side is continuous and monotone in D on (0,1).
export function decayForPeakShare(k = PEAK_SEASONS_DEFAULT, n = 20, share = 0.5) {
  if (!(k > 0) || !(n > k) || !(share > 0) || !(share < 1)) return DECAY_DEFAULT;
  const f = (d) => {
    if (d >= 1) return k / n;
    return (1 - Math.pow(d, k)) / (1 - Math.pow(d, n));
  };
  let lo = 1e-6, hi = 1 - 1e-12;
  // f(lo) -> 1 (all weight on the first season), f(hi) -> k/n < share.
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > share) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// The share of total weight the best k of n seasons actually carry at a given
// D — the inverse reading, for labelling the dial.
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
  let lva = 0, weightedGames = 0, flatVA = 0, games = 0;

  for (const g of season.games || []) {
    if (g.va == null) continue;
    const w = gameWeight(g.cli, alpha, anchor);
    if (!(w > 0)) continue;
    lva += w * g.va;
    weightedGames += w;
    flatVA += g.va;
    games += 1;
  }

  if (includeRS && season.rsVA != null && season.rsCLI > 0) {
    const w = gameWeight(season.rsCLI, alpha, anchor);
    lva += w * season.rsVA;
    weightedGames += w * (season.rsGames || 0);
    flatVA += season.rsVA;
    games += season.rsGames || 0;
  }

  return { lva, weightedGames, flatVA, games };
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
