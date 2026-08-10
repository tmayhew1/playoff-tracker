// Championship leverage (cLI) — how much a single game moves a title.
//
// VA is context-free by design: identical production scores identically
// whoever the opponent is and whatever is at stake (see the reboundGamma
// comment in ../scoring.js). That is right for a season metric and wrong for
// an all-time one, where Game 7 of the Finals and Game 82 of a lottery season
// are plainly not the same event.
//
// So leverage is a SEPARATE instrument that reweights an existing VA
// decomposition. It never touches valueAddParts, so spec §9.1 (Σ_c VA_c = VA)
// holds on every existing surface and no leaderboard needs re-baking. The
// precedent is spec §7.1, which holds shot-zone VA outside the core category
// vector for the same structural reason.
//
// The question leverage answers is the one Tom Tango's championship leverage
// index asks in baseball: how much does winning THIS game, rather than losing
// it, change the probability the team ends up champion?
//
//   cLI = [P(title | win) − P(title | loss)]
//
// evaluated under a neutral coin: every game 50/50, every future series 50/50.
// Neutrality is deliberate and matches the VA design philosophy — a player is
// not credited more for having been on a favorite, or less for a road game,
// and the number is portable across eras with no seeding data.
//
// This module is isomorphic (no "use client"): ../scoring.js is the precedent,
// and both API routes and client components need the bracket derivation.

// --- Series win probability -------------------------------------------------
// Backward induction on the series state. `a`-`b` is the score BEFORE the game
// from the perspective of the team being measured.

const winProbCache = new Map();

export function seriesWinProb(a, b, bestOf) {
  const need = Math.floor(bestOf / 2) + 1;
  if (a >= need) return 1;
  if (b >= need) return 0;
  const key = `${bestOf}:${a}:${b}`;
  const hit = winProbCache.get(key);
  if (hit !== undefined) return hit;
  const v = 0.5 * seriesWinProb(a + 1, b, bestOf) + 0.5 * seriesWinProb(a, b + 1, bestOf);
  winProbCache.set(key, v);
  return v;
}

// How much of the SERIES this one game swings. In a best-of-7 this is 0.3125
// at 0-0, 0.375 at 1-1 and 2-1, 0.25 at 2-0 (the leader is already most of the
// way there), 0.5 at 2-2 and 3-2, 0.125 at 3-0, and exactly 1 at 3-3 — a
// Game 7 swings the whole series by definition, which is the sanity check the
// whole construction rests on.
export function swing(a, b, bestOf) {
  return seriesWinProb(a + 1, b, bestOf) - seriesWinProb(a, b + 1, bestOf);
}

// Series swing discounted by the rounds still to be won after this one. Under
// the neutral coin each remaining series is another factor of 1/2.
export function cLI(a, b, bestOf, roundsAfter) {
  return swing(a, b, bestOf) * Math.pow(0.5, roundsAfter);
}


// --- The anchor -------------------------------------------------------------
// Weights are expressed relative to ONE unit: that season's own opening
// playoff game. Anchoring PER SEASON rather than to a global constant is what
// keeps eras comparable. A 1960 title needed two series won, not four, so its
// games carry far more raw cLI; a global anchor would hand the eight-team
// league ~4x credit for clearing a shallower field. Dividing by the season's
// own opener removes exactly that, and is a no-op for 1980-2026, where every
// bracket is four rounds deep and every reference equals 0.0390625.

export function anchorCLI(depth, bestOfRound1) {
  return cLI(0, 0, bestOfRound1, depth - 1);
}

export const ALPHA_DEFAULT = 0.5;

// Compression. ALPHA = 1 is raw championship leverage, where a Finals Game 7
// is worth 25.6 openers and the regular season all but vanishes; ALPHA = 0 is
// flat, every game equal. The default 0.5 says importance counts, at
// diminishing returns — a Finals Game 7 lands at ~5.1 openers. This is the
// one free dial in the leverage half, and it is a taste parameter, not a
// derivation. It is named as such in docs/value-added-spec.md §7.4.
export function gameWeight(cli, alpha = ALPHA_DEFAULT, anchor) {
  if (!(anchor > 0) || !(cli > 0)) return 0;
  if (alpha === 0) return 1;
  return Math.pow(cli / anchor, alpha);
}


// --- Stakes belong to the series, not the game state ------------------------
// cLI above prices a GAME by the score it was played at. That is the right
// answer to "how much did this game matter" and the wrong one to "how good was
// this player", because a team removes the stakes by winning early. A sweep is
// played entirely at 0-0, 1-0, 2-0, 3-0 — weights 1.00, 1.00, 0.89, 0.63, the
// bottom of the round's range — while a seven-game grind averages 1.21 across
// seven games. Winning fast therefore cost roughly 2.4x the weighted volume:
// charged once for playing fewer games, and again for the games being cheap.
//
// So a series is priced ex ante and once. Under the same neutral coin, winning
// it moves a title by 0.5^roundsAfter whatever the score becomes, and that
// stake is spread across however many games it actually took. This is already
// how the regular season is priced below — a berth worth 0.5^depth, divided by
// the schedule — so the playoffs were the inconsistent half.

// The stake of winning a series: rounds still to be won after it, halved each.
export function seriesStake(roundsAfter) {
  return Math.pow(0.5, roundsAfter);
}

// The unit: a round-1 series in a bracket this deep.
export function seriesAnchor(depth) {
  return Math.pow(0.5, depth - 1);
}

// Expected games in a best-of-7 under the fair coin the rest of the module
// already assumes: 4g .125, 5g .25, 6g .3125, 7g .3125. Dividing the series
// stake by the games played and multiplying by this holds the unit — a
// round-1 series of expected length still prices its games at exactly 1.00,
// the same opener the state-based weights were quoted against. A shorter
// series concentrates that total into fewer games; a longer one dilutes it.
export const EXPECTED_SERIES_GAMES = 5.8125;

// What one game of a series is worth. `seriesGames` is the length the series
// actually ran — the TEAM's games, not the player's, so sitting one out
// dilutes his share rather than flattering it.
export function seriesGameWeight(roundsAfter, depth, seriesGames, alpha = ALPHA_DEFAULT) {
  if (!(seriesGames > 0)) return 0;
  const anchor = seriesAnchor(depth);
  if (!(anchor > 0)) return 0;
  const stake = seriesStake(roundsAfter);
  const w = alpha === 0 ? 1 : Math.pow(stake / anchor, alpha);
  return w * (EXPECTED_SERIES_GAMES / seriesGames);
}


// --- The regular season -----------------------------------------------------
// Priced in the same currency rather than by a separate taste dial. Across the
// whole regular season a team goes from undetermined to holding a playoff
// berth, and under the neutral coin a berth is worth 0.5^depth of a title.
// Spread that over the season's games:
//
//   cLI_RS = 0.5^depth / gamesInSeason
//
// For a normal 82-game, four-round season that is 0.000762 — about 1/51 of a
// playoff opener raw, and about 1/7 of one at ALPHA = 0.5. Over a long career
// this leaves the playoffs carrying roughly 2-3x the total weight of the
// regular season, which is the intended balance for a legacy metric: the
// regular season is not noise, and it is not the point either.

// Schedule length by season. NOT derivable from the data: max(g) in
// regular-season-<season>.json overshoots, because a traded player's TOT row
// sums his games across teams (1999-00 and 2003-04 both show 85). Anything
// absent here played the standard 82.
export const RS_SCHEDULE = {
  "1998-99": 50, // lockout
  "2011-12": 66, // lockout
  "2019-20": 71, // COVID stoppage; teams played 64-75, this is the mean
  "2020-21": 72, // COVID-shortened
};

export const RS_SCHEDULE_DEFAULT = 82;

export function rsGamesFor(season) {
  return RS_SCHEDULE[season] ?? RS_SCHEDULE_DEFAULT;
}

export function rsCLI(season, depth = 4) {
  return Math.pow(0.5, depth) / rsGamesFor(season);
}


// --- Bracket reconstruction -------------------------------------------------
// Everything above needs two facts per series that the baked JSON does not
// carry honestly: how long the series was, and how many rounds remained after
// it. Both are derivable from the games themselves, which is strictly better
// than the positional rule this replaces (`i < 8 ? 1 : i < 12 ? 2 : ...`),
// since that rule assumes an 8-4-2-1 bracket and is simply wrong for the
// 12-team brackets of 1980-81 through 1982-83.

// Rounds in a modern bracket. Used only where a bracket cannot be measured —
// i.e. one still in progress.
const DEFAULT_DEPTH = 4;

const triOf = (side) => side?.tri ?? side;

// Baked history files order games by `gameCode` ("19980423"); the live ESPN
// paths in /api/history and /api/leaderboard carry `date` ("2016-04-17") or an
// ISO `gameDateTimeUTC` instead. All three sort lexicographically, and one
// series never mixes them, so a plain string compare orders any of them.
const gameKey = (g) => String(g.gameCode ?? g.date ?? g.gameDateTimeUTC ?? "");

function gameWinner(g) {
  const h = g.home, a = g.away;
  if (!h || !a) return null;
  if (h.win === true) return triOf(h);
  if (a.win === true) return triOf(a);
  if (!Number.isFinite(h.score) || !Number.isFinite(a.score)) return null;
  if (h.score === a.score) return null;
  return h.score > a.score ? triOf(h) : triOf(a);
}

export function seriesWins(series) {
  const wins = new Map();
  for (const g of series.games || []) {
    const w = gameWinner(g);
    if (w) wins.set(w, (wins.get(w) || 0) + 1);
  }
  return wins;
}

export function seriesWinner(series) {
  if (series.winner) return series.winner;
  const wins = seriesWins(series);
  let best = null, n = -1;
  for (const [tri, c] of wins) if (c > n) { best = tri; n = c; }
  return best;
}

// bestOf = 2 x (games the series winner won) − 1. A completed series ends the
// moment its winner reaches the clinching number, so his win total IS that
// number. Yields exactly {3, 5, 7} across all 651 series in the corpus and
// reproduces every era rule without one being written down: best-of-3 first
// rounds through 1982-83, best-of-5 from 1983-84 to 2001-02, best-of-7
// everywhere from 2002-03 on.
export function seriesBestOf(series) {
  const wins = seriesWins(series);
  let top = 0;
  for (const c of wins.values()) if (c > top) top = c;
  if (top <= 0) return 7;
  return 2 * top - 1;
}

const firstCode = (s) => (s.games || []).reduce(
  (m, g) => (m === null || gameKey(g) < m ? gameKey(g) : m), null);
const lastCode = (s) => (s.games || []).reduce(
  (m, g) => (m === null || gameKey(g) > m ? gameKey(g) : m), null);

// Rounds remaining AFTER each series, by following each winner forward to his
// next series. Only the champion has no next series, so a completed bracket
// has exactly one terminal — true for all 46 seasons on disk.
//
// Byes fall out for free, which is the whole reason to do it this way: a 1981
// Boston, idle through the opening round, enters at the second series with
// roundsAfter = 2, so its first game correctly carries 0.5^2 and not 0.5^3.
export function bracketShape(historySeries) {
  const list = historySeries || [];
  const n = list.length;
  const winner = list.map(seriesWinner);
  const starts = list.map(firstCode);
  const ends = list.map(lastCode);
  let bestOf = list.map(seriesBestOf);

  // next[i] = index of the earliest-starting later series containing i's winner
  const next = list.map((_, i) => {
    const w = winner[i];
    if (!w) return -1;
    let pick = -1;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const teams = list[j].teams || [];
      if (!teams.includes(w)) continue;
      if (ends[i] && starts[j] && starts[j] < ends[i]) continue;
      if (pick === -1 || (starts[j] || "") < (starts[pick] || "")) pick = j;
    }
    return pick;
  });

  const terminals = next.reduce((c, j) => c + (j === -1 ? 1 : 0), 0);
  const exact = terminals === 1;

  let roundsAfter;
  if (exact) {
    roundsAfter = new Array(n).fill(-1);
    const walk = (i, seen) => {
      if (roundsAfter[i] >= 0) return roundsAfter[i];
      if (seen.has(i)) return 0; // cycle guard; unreachable on real brackets
      seen.add(i);
      const j = next[i];
      const v = j === -1 ? 0 : walk(j, seen) + 1;
      roundsAfter[i] = v;
      return v;
    };
    for (let i = 0; i < n; i++) walk(i, new Set());
  } else {
    // In progress: several series still have no winner, so the chain has no
    // single terminal to anchor on. Count the series each team has already
    // CLOSED OUT instead, and read the round off that.
    //
    // seriesBestOf cannot be trusted here — it reads the clinching number off
    // the winner's win total, and a series sitting at 2-0 looks exactly like a
    // finished best-of-3. So this branch assumes best-of-7 throughout, which
    // holds for every bracket a live feed can serve (ESPN coverage starts
    // 1999-00; the last best-of-5 first round was 2001-02).
    bestOf = list.map(() => 7);
    // Series each team has closed out, with when it started. A series must not
    // count toward its own round, so only STRICTLY EARLIER ones are counted —
    // otherwise a completed opening-round series reads as a second-round one.
    const closed = new Map();
    list.forEach((s, i) => {
      for (const [tri, c] of seriesWins(s)) {
        if (c < 4) continue;
        if (!closed.has(tri)) closed.set(tri, []);
        closed.get(tri).push(starts[i] || "");
      }
    });
    roundsAfter = list.map((s, i) => {
      const prior = Math.max(...(s.teams || []).map((t) =>
        (closed.get(t) || []).filter((st) => st < (starts[i] || "")).length), 0);
      return Math.max(DEFAULT_DEPTH - 1 - prior, 0);
    });
  }

  // A finished bracket's depth is its longest chain; an in-progress one has no
  // measurable depth yet, so it takes the modern four.
  const depth = exact ? Math.max(...roundsAfter, 0) + 1 : DEFAULT_DEPTH;
  const round = roundsAfter.map((ra) => depth - ra);

  // The season's own opening playoff game — the unit every weight is in.
  let bestOfRound1 = 7;
  for (let i = 0; i < n; i++) if (round[i] === 1) { bestOfRound1 = bestOf[i]; break; }

  return {
    round, roundsAfter, bestOf, depth, exact,
    bestOfRound1,
    anchor: anchorCLI(depth, bestOfRound1),
  };
}


// --- Per-game leverage ------------------------------------------------------
// Walks each series forward, recording the state BEFORE each game. Games are
// chronological in every history file on disk, but sort defensively — it costs
// nothing and a mis-ordered series would silently corrupt every weight in it.

export function gameLeverage(historySeries) {
  const shape = bracketShape(historySeries);
  const map = new Map();

  (historySeries || []).forEach((series, si) => {
    const teams = series.teams || [];
    const bestOf = shape.bestOf[si];
    const roundsAfter = shape.roundsAfter[si];
    const games = [...(series.games || [])].sort(
      (x, y) => gameKey(x).localeCompare(gameKey(y)));

    const wins = new Map(teams.map((t) => [t, 0]));
    for (const g of games) {
      const home = triOf(g.home), away = triOf(g.away);
      for (const [me, opp] of [[home, away], [away, home]]) {
        const a = wins.get(me) || 0;
        const b = wins.get(opp) || 0;
        map.set(`${g.gameId}|${me}`, {
          cli: cLI(a, b, bestOf, roundsAfter),
          seriesIdx: si,
          round: shape.round[si],
          roundsAfter, bestOf, a, b,
        });
      }
      const w = gameWinner(g);
      if (w) wins.set(w, (wins.get(w) || 0) + 1);
    }
  });

  return { shape, map };
}

// Convenience: the weight for one player-game, given a leverage map.
export function weightForGame(lev, gameId, tri, alpha = ALPHA_DEFAULT) {
  const e = lev.map.get(`${gameId}|${tri}`);
  if (!e) return null;
  return gameWeight(e.cli, alpha, lev.shape.anchor);
}
