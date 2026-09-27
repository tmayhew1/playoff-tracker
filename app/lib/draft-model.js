// The draft assistant's model: how strong each playoff team is, how likely it
// is to win a series, and what it's expected to score in the draft game.
//
// Pure — no React, no fs — so scripts/fit-draft-model.mjs fits the very
// functions the page runs, and tests can call them directly.
//
// Scoring (app/scoring.js potentialPoints): a series win is worth its round's
// base (1/2/4/8) plus the seed gap when the lower seed wins. Points are summed
// team by team, so a roster's expected points is the sum of its teams' — which
// is why ranking by expected points is the right pick order when the goal is
// the most points. Winning the draft is a different goal (it cares about the
// other owner's teams too), which is what simulate() is for.

export const ROUND_KEYS = ["r1", "r2", "r3", "r4"];
export const ROUND_BASE = { r1: 1, r2: 2, r3: 4, r4: 8 };

// Team strength: the top `n` players on the roster by total regular-season
// VA, summed and put per game of the season. Totals rather than per-game VA,
// so a player who missed half the year counts for half — the cross-validated
// fit preferred it (see scripts/fit-draft-model.mjs).
export function rosterStrength(players, seasonGames, n) {
  if (!players?.length || !(seasonGames > 0)) return 0;
  return players.map((p) => p.va || 0).sort((a, b) => b - a).slice(0, n)
    .reduce((a, v) => a + v, 0) / seasonGames;
}

// P(a wins the series). Logistic in the strength gap, plus home court: the
// better seed hosts. Across conferences (the Finals) seeds aren't strictly
// comparable — the better record hosts — but the better seed is the nearest
// thing a bracket knows.
export function seriesWinProb(model, a, b) {
  const home = Math.sign((b.seed ?? 0) - (a.seed ?? 0));
  const z = model.k * ((a.strength || 0) - (b.strength || 0)) + model.h * home;
  return 1 / (1 + Math.exp(-z));
}

export const seriesPoints = (roundKey, winner, loser) =>
  ROUND_BASE[roundKey] + Math.max(0, (winner.seed ?? 0) - (loser.seed ?? 0));

// NBA bracket order within a conference: 1v8 meets 4v5, 2v7 meets 3v6.
const SEED_ORDER = [1, 8, 4, 5, 2, 7, 3, 6];

// The 16 teams as bracket slots: East's eight in SEED_ORDER, then West's.
// Adjacent blocks of 2^r slots meet in round r+1, so the Finals is East's
// block of 8 against West's. null when the field isn't 8 seeded teams a side.
export function bracketSlots(teams) {
  const slots = [];
  for (const conf of ["E", "W"]) {
    const bySeed = {};
    for (const [tri, t] of Object.entries(teams)) if (t.conf === conf) bySeed[t.seed] = tri;
    for (const s of SEED_ORDER) {
      if (!bySeed[s]) return null;
      slots.push(bySeed[s]);
    }
  }
  return slots;
}

// Exact bracket odds, round by round. For each team: P(win round r) for each
// round, P(title), and expected draft points (every possible opponent in
// every round, weighted by the chance that meeting happens and is won).
export function bracketOdds(model, teams) {
  const slots = bracketSlots(teams);
  if (!slots) return null;
  const p = (a, b) => seriesWinProb(model, teams[a], teams[b]);
  let alive = Object.fromEntries(slots.map((t) => [t, 1]));
  const out = Object.fromEntries(slots.map((t) => [t, { win: {}, ep: 0 }]));
  ROUND_KEYS.forEach((rk, r) => {
    const next = {};
    const block = 2 ** (r + 1);
    for (let i = 0; i < slots.length; i++) {
      const t = slots[i];
      const start = Math.floor(i / block) * block;
      const half = block / 2;
      const mine = Math.floor((i - start) / half);
      const opps = slots.slice(start + (1 - mine) * half, start + (2 - mine) * half);
      let w = 0, ep = 0;
      for (const o of opps) {
        const meet = alive[t] * alive[o];
        const beat = meet * p(t, o);
        w += beat;
        ep += beat * seriesPoints(rk, teams[t], teams[o]);
      }
      next[t] = w;
      out[t].win[rk] = w;
      out[t].ep += ep;
    }
    alive = next;
  });
  return out;
}

// Seeded RNG so a page shows the same simulated numbers on every render.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Monte Carlo over the whole bracket: each owner's points in every simulated
// postseason, scored by the draft rules. `owners` maps tri -> owner name;
// unowned teams still play, they just score for nobody. Returns each owner's
// mean points and chance of finishing ahead, plus the chance of a tie.
export function simulate(model, teams, owners, { sims = 20000, seed = 1, names: named = [] } = {}) {
  const slots = bracketSlots(teams);
  if (!slots) return null;
  const rand = mulberry32(seed);
  // `names` lists owners to report even if they hold no team yet.
  const names = [...new Set([...named, ...Object.values(owners).filter(Boolean)])];
  const sum = Object.fromEntries(names.map((n) => [n, 0]));
  const wins = Object.fromEntries(names.map((n) => [n, 0]));
  let ties = 0;
  // Series probabilities don't change between sims; cache them per pair,
  // stored as P(the alphabetically first team wins).
  const pc = new Map();
  const prob = (a, b) => {
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${x}|${y}`;
    if (!pc.has(key)) pc.set(key, seriesWinProb(model, teams[x], teams[y]));
    const v = pc.get(key);
    return a === x ? v : 1 - v;
  };
  for (let s = 0; s < sims; s++) {
    const pts = Object.fromEntries(names.map((n) => [n, 0]));
    let field = slots;
    ROUND_KEYS.forEach((rk) => {
      const next = [];
      for (let i = 0; i < field.length; i += 2) {
        const a = field[i], b = field[i + 1];
        const aWins = rand() < prob(a, b);
        const w = aWins ? a : b, l = aWins ? b : a;
        const o = owners[w];
        if (o) pts[o] += seriesPoints(rk, teams[w], teams[l]);
        next.push(w);
      }
      field = next;
    });
    for (const n of names) sum[n] += pts[n];
    if (names.length === 2) {
      const [x, y] = names;
      if (pts[x] > pts[y]) wins[x]++;
      else if (pts[y] > pts[x]) wins[y]++;
      else ties++;
    }
  }
  return {
    mean: Object.fromEntries(names.map((n) => [n, sum[n] / sims])),
    winProb: Object.fromEntries(names.map((n) => [n, wins[n] / sims])),
    tieProb: ties / sims,
  };
}

// Finish a partial draft the way the advice assumes it goes: the undrafted
// teams alternate, `first` picking first, each side taking the most expected
// points left.
export function completeDraft(odds, owners, first, second) {
  const out = { ...owners };
  const free = Object.keys(odds).filter((t) => !owners[t]).sort((a, b) => odds[b].ep - odds[a].ep);
  free.forEach((t, i) => { out[t] = i % 2 === 0 ? first : second; });
  return out;
}

// The assistant's advice for `me`'s next pick. For every available team:
// its expected points, and `me`'s chance of winning the draft if they take it
// and the rest of the draft then alternates — `them` first — with each side
// taking the best remaining expected points. That lookahead is an assumption
// about the other owner, stated in the UI; it is what lets the win chance see
// what expected points can't, e.g. that two of your teams would meet early.
export function recommend(model, teams, owners, me, them, { sims = 4000 } = {}) {
  const odds = bracketOdds(model, teams);
  if (!odds) return null;
  const free = Object.keys(teams).filter((t) => !owners[t]).sort((a, b) => odds[b].ep - odds[a].ep);
  return free.map((pick) => {
    const o = completeDraft(odds, { ...owners, [pick]: me }, them, me);
    const sim = simulate(model, teams, o, { sims, seed: 7 });
    return { tri: pick, ep: odds[pick].ep, winProb: sim?.winProb[me] ?? null, tieProb: sim?.tieProb ?? null };
  });
}
