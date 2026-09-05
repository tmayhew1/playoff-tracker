import { ALPHA_DEFAULT, OMEGA_DEFAULT, gameWeight, seriesGameWeight } from "./leverage";

// Isomorphic (no "use client"), for the same reason ./leverage.js is: the board
// is built server-side in /api/legacy, where the career corpus lives, and a
// client directive here would hand that route a client reference instead of the
// functions. Nothing below touches React or the DOM.


// --- Legacy: peak and longevity on one board --------------------------------
//
// Career VA summed straight is pure longevity: it cannot tell a decade of
// very good from seven years of overwhelming. Career VA/G is pure rate: it
// cannot tell a twenty-year peak from a four-year one. So Legacy is two
// numbers, not one:
//
//   VOLUME  the career's leveraged VA, added up. Every season at face value.
//   RATE    leverage-weighted VA per weighted game over the best N seasons.
//
// The volume axis is a PLAIN SUM. It used to be a value-weighted fold — the
// l_p norm, which discounted a career's lesser seasons against its best — and
// that dial is gone on purpose: what a season was worth is already in its LVA,
// and multiplying it by a second number derived from the same LVA prices the
// same fact twice. The cost is stated rather than hidden: summed straight, the
// volume axis is pure longevity, and an extra good-not-great season always
// helps. That is what the rate axis is beside it for, and neither is "the"
// ranking.
export const PEAK_SEASONS_DEFAULT = 7;


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

// Weights are derived HERE from what the row stores about each game — its cLI,
// its series' length, and how much of that series the team won — never read off
// the row as a resolved number. ALPHA and OMEGA have to stay live dials, and
// precomputing weights at load time silently freezes them: a sweep over either
// would then return the same board at every step.
export function seasonLVA(season, {
  alpha = ALPHA_DEFAULT, omega = OMEGA_DEFAULT, includeRS = true,
} = {}) {
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
  // series therefore carries the same weight for a given team, and a series
  // that ended early carries it in fewer games — so closing a team out
  // concentrates value instead of forfeiting it. The two teams do NOT split
  // that pot evenly: omega hands the side that won more of the games more of
  // it, which is what keeps a sweep from paying its loser like its winner.
  for (const g of season.games || []) {
    if (g.va == null) continue;
    const w = g.seriesGames > 0
      ? seriesGameWeight(g.roundsAfter, depth, g.seriesGames, alpha, g.seriesWins, omega)
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


// --- One career -------------------------------------------------------------
// `player.seasons` is an array of season rows already carrying resolved
// per-game weights (see buildCareers in app/api/_lib/careers.js, which is
// where the data join lives).
export function playerLegacy(player, {
  alpha = ALPHA_DEFAULT,
  omega = OMEGA_DEFAULT,
  includeRS = true,
  peakSeasons = PEAK_SEASONS_DEFAULT,
} = {}) {
  const rows = (player.seasons || []).map((s) => ({
    season: s.season,
    team: s.team,
    ...seasonLVA(s, { alpha, omega, includeRS }),
  }));

  // Best season first. Nothing about the total depends on this order any more —
  // a sum does not care — but it is the order the career reads in, and the
  // order the peak rate below takes its seasons from.
  rows.sort((a, b) => b.lva - a.lva);
  const seasons = rows.map((r, i) => ({ ...r, rank: i + 1 }));

  // The volume axis: every season at face value, positive and negative alike.
  // A season spent below the league's typical minute is a debit of exactly its
  // own size, which is what it cost.
  const total = rows.reduce((s, r) => s + r.lva, 0);

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
    total,
    peak, peakRaw,
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


// --- The dial sweep ---------------------------------------------------------
// Sweeps one dial across its range and reports each tracked player's score and
// rank at every step, plus the exact dial values where two of the leaders swap
// order. The crossings are the point: a ranking that changes under a defensible
// range of the dial is a ranking with an argument in it, and hiding that behind
// one default would be dishonest.
export function dialSweep(players, {
  dial = "alpha",
  alpha = ALPHA_DEFAULT,
  omega = OMEGA_DEFAULT,
  includeRS = true,
  // Both remaining dials are defined on [0, 1] at the end that matters: omega
  // is a share, and alpha's range above 1 is raw leverage rather than a
  // compression of it.
  from = 0,
  to = 1,
  steps = 51,
  topN = 12,
} = {}) {
  const xs = Array.from({ length: steps }, (_, i) => from + ((to - from) * i) / (steps - 1));

  const base = rankLegacy(players, { alpha, omega, includeRS }).slice(0, topN);
  const tracked = base.map((x) => x.slug);
  const byStep = xs.map((x) => {
    // Both dials sweep the same way: hold the other, move this one.
    const board = rankLegacy(players, { alpha, omega, [dial]: x, includeRS });
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
