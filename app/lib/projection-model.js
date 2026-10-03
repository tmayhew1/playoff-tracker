// The 2026-27 Look Ahead: one player's next season projected from the last
// three, and the awards simulated from those projections.
//
// Pure — no React, no fs — so scripts/fit-projection-model.mjs fits and
// backtests the very functions the page runs, and tests can call them directly.
//
// --- The projection ----------------------------------------------------------
// A box-score line is projected in pieces that each behave like a time series
// of their own, and the line is rebuilt from them:
//
//   per-minute rates   2PA, 3PA, FTA, AST, STL, BLK, TOV, DRB, ORB
//   shooting           2P%, 3P%, FT%
//   playing time       minutes per game, and availability (games / schedule)
//
// Points are not projected directly — they fall out of the attempts and the
// percentages, so a projected line can never score more than its shots allow.
//
// Each piece gets the same three-step estimator (Marcel's, with its constants
// fit rather than assumed):
//
//   1  weighted history   the last three seasons, each worth `w` times the one
//                         after it, and weighted by its sample (minutes for a
//                         rate, attempts for a percentage, games for minutes)
//   2  shrinkage          K phantom units of the player's position at the
//                         league's level, so a small sample regresses hard and
//                         a big one barely at all
//   3  aging              the change players at the same career stage made
//                         from one season to the next, fit by the delta method
//
// Playing time is the exception — see below: minutes and games are a
// regression on their own history, with an intercept per career stage.
//
// Rates are measured as an INDEX — a player's rate over the league's that
// season — and percentages as a difference from the league's, so a 3PA rate
// from 2014 and one from 2025 are on the same footing and the league's own
// drift doesn't masquerade as a player's development. A projection is turned
// back into a box score against the league's most recent season.
//
// Career stage is EXPERIENCE (seasons played so far in the data), not age:
// the baked seasons carry no birth dates. It does most of what age does — the
// rookie-to-sophomore leap and the late-career slide both show plainly — but
// it can't tell a 19-year-old rookie from a 23-year-old one.

export const RATE_KEYS = ["fg2a", "tpa", "fta", "ast", "stl", "blk", "tov", "drb", "orb"];
export const PCT_KEYS = [
  { key: "fg2", made: "fg2m", att: "fg2a" },
  { key: "tp", made: "tpm", att: "tpa" },
  { key: "ft", made: "ftm", att: "fta" },
];
export const HISTORY_SEASONS = 3;
// Playing time looks further back: one bad year shouldn't erase four good ones.
export const TIME_HISTORY = 5;

// A LOST season: under half the schedule while still playing starter minutes
// when on the floor — an injury, not a benching. (A bench player's 20 games
// at 9 minutes is a role, and stays an ordinary season.)
export const LOST_AVAIL = 0.5, LOST_MPG = 20;
export const isLostSeason = (u) => u.avail < LOST_AVAIL && u.mpg >= LOST_MPG;
export const MAX_EXP = 16;

// Games on each season's schedule. The lockout and bubble years were short,
// so availability is games over THIS, not over 82.
const SHORT_SEASONS = { "1998-99": 50, "2011-12": 66, "2019-20": 72, "2020-21": 72 };
export const scheduleLength = (season) => SHORT_SEASONS[season] || 82;

export const nextSeason = (s) => {
  const y = Number(s.slice(0, 4)) + 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};

// G / F / C from a Basketball-Reference position ("PG", "SF-PF", "C").
export function posGroup(pos) {
  const p = (pos || "").split("-")[0];
  if (p === "C") return "C";
  if (p === "PF" || p === "SF" || p === "F") return "F";
  return "G";
}

// The derived columns every piece reads from.
export function expand(r) {
  return {
    ...r,
    fg2m: (r.fgm || 0) - (r.tpm || 0),
    fg2a: (r.fga || 0) - (r.tpa || 0),
  };
}

// League context for one season: per-minute rates and percentages, for the
// whole league and for each position group. Minutes-weighted (totals over
// totals), the same convention league-averages.json uses.
export function leagueContext(rows) {
  const sum = (list) => {
    const t = { mp: 0 };
    for (const k of [...RATE_KEYS, "fg2m", "tpm", "ftm"]) t[k] = 0;
    for (const r of list) {
      t.mp += r.mp || 0;
      for (const k of Object.keys(t)) if (k !== "mp") t[k] += r[k] || 0;
    }
    const rate = Object.fromEntries(RATE_KEYS.map((k) => [k, t.mp > 0 ? t[k] / t.mp : 0]));
    const pct = Object.fromEntries(PCT_KEYS.map(({ key, made, att }) => [key, t[att] > 0 ? t[made] / t[att] : 0]));
    return { rate, pct };
  };
  const xs = rows.map(expand).filter((r) => r.mp > 0);
  const league = sum(xs);
  const pos = {};
  for (const g of ["G", "F", "C"]) {
    const s = sum(xs.filter((r) => posGroup(r.pos) === g));
    // Position level as an index on the league's (rates) and a difference
    // from it (percentages) — the units the projection works in.
    pos[g] = {
      rate: Object.fromEntries(RATE_KEYS.map((k) => [k, league.rate[k] > 0 ? s.rate[k] / league.rate[k] : 1])),
      pct: Object.fromEntries(PCT_KEYS.map(({ key }) => [key, s.pct[key] - league.pct[key]])),
    };
  }
  return { ...league, pos };
}

// One player's history in the projection's units. `seasons` is the player's rows,
// oldest first, each { season, row, ctx } with the league context of that
// season. Only seasons with an appearance are listed — a year lost to injury is a
// gap, not a zero.
function unitsOf({ season, row, ctx }) {
  const r = expand(row);
  const mp = r.mp || 0;
  const idx = Object.fromEntries(RATE_KEYS.map((k) =>
    [k, mp > 0 && ctx.rate[k] > 0 ? (r[k] / mp) / ctx.rate[k] : 0]));
  const pct = Object.fromEntries(PCT_KEYS.map(({ key, made, att }) =>
    [key, { made: r[made] || 0, att: r[att] || 0, lg: ctx.pct[key] }]));
  return {
    season, mp, g: r.g || 0, idx, pct,
    avail: Math.min(1, (r.g || 0) / scheduleLength(season)),
    mpg: r.g > 0 ? mp / r.g : 0,
    pos: posGroup(r.pos),
  };
}

const ageFactor = (table, exp) => {
  if (!table) return null;
  return table[Math.min(Math.max(exp, 1), MAX_EXP)] ?? null;
};

// The projection. `history` is the player's seasons (oldest first, ≥1),
// `exp` how many seasons the player has played before the one projected,
// `params` the fitted constants (data/projection-model.json `params`),
// `target` the league context the result is rebuilt against, `missed` the
// number of whole seasons sat out just before the one projected.
//
// Returns per-game numbers and the season totals they imply — a row with the
// same keys a baked regular-season row has, so lib/va and scoring.js price it
// exactly as they price a real season.
export function projectPlayer(history, exp, params, target, missed = 0) {
  const recent = recentUnits(history); // newest first
  if (!recent.length) return null;
  const pos = recent[0].pos;
  const out = { exp, missed };
  const gap = missed > 0 ? params.gap : null;

  // Rates — an index on the league's.
  const idx = {};
  for (const k of RATE_KEYS) {
    const { w, K } = params.rate[k];
    let num = 0, den = 0;
    recent.forEach((u, i) => { const wt = w ** i * u.mp; num += wt * u.idx[k]; den += wt; });
    const prior = target.pos[pos]?.rate[k] ?? 1;
    const x = (num + K * prior) / (den + K);
    idx[k] = Math.max(0, x * (ageFactor(params.aging.rate[k], exp) ?? 1) * (gap?.rate[k] ?? 1));
  }

  // Percentages — a difference from the league's.
  const pct = {};
  for (const { key } of PCT_KEYS) {
    const { w, K } = params.pct[key];
    let num = 0, den = 0;
    recent.forEach((u, i) => {
      const p = u.pct[key];
      num += w ** i * (p.made - p.lg * p.att);
      den += w ** i * p.att;
    });
    const prior = target.pos[pos]?.pct[key] ?? 0;
    const d = (num + K * prior) / (den + K) + (ageFactor(params.aging.pct[key], exp) ?? 0) + (gap?.pct[key] ?? 0);
    pct[key] = Math.min(0.99, Math.max(0, target.pct[key] + d));
  }

  // Playing time — a regression, not a shrinkage: next season's minutes and
  // availability on the features below, with an intercept per career stage.
  // Fit by least squares in the fit script. (A shrink-then-age estimator was
  // tried first; for minutes it double-counted regression to the mean and
  // projected every star several minutes and a dozen games short.)
  const tf = timeFeatures(timeUnits(history), missed);
  const e = Math.min(Math.max(exp, 1), MAX_EXP);
  const dot = (b, x) => x.reduce((acc, v, i) => acc + v * b.coef[i], 0) + (b.e[e] ?? 0);
  out.mpg = Math.min(40, Math.max(4, dot(params.time.mpg, tf.mpg)));
  out.avail = Math.min(0.98, Math.max(0.05, dot(params.time.avail, tf.avail)));
  out.lostLast = tf.lostLast;

  out.g = Math.max(1, Math.round(out.avail * 82));
  out.idx = idx;
  out.pct = pct;
  out.row = rebuildRow(out, target, out.g);
  return out;
}

// History rows in the projection's units, newest first — exported for the fit.
export const recentUnits = (history) => history.slice(-HISTORY_SEASONS).map(unitsOf).reverse();
export const timeUnits = (history) => history.slice(-TIME_HISTORY).map(unitsOf).reverse();

// The playing-time regressors, from up to TIME_HISTORY seasons (newest first).
//
// The question they answer is the one a lost season raises: was it a one-off,
// or who this player is? So the HEALTHY history — every season in the window
// that wasn't lost — is measured on its own, and when the last season was
// lost, that history stands in for it:
//
//   availability   last season (or the healthy mean, if it was lost),
//                  the healthy mean, a lost-last flag, the number of earlier
//                  lost seasons (chronic), and minutes per game
//   minutes        last season's (or the healthy mean's) and its square,
//                  the healthy mean, the lost-last flag, and availability
//
// Judged on the ten seasons after 2015-16, held out of the fit: a starter
// back from a near-total lost season after years of health was projected 12
// games short on average by the plain last-seasons regression and is about
// even now, and their minutes 2.7 short and now 0.8 — with the error over all
// players unchanged. History buys less than it seems it should: such
// comebacks average ~52 games against ~46 for the chronically hurt, because a
// quarter of them get hurt again.
//
// A season missed ENTIRELY is a different thing again, and leaves no row to
// read: the history just ends a year early. So it arrives as `missed` and
// enters as its own flag, and scaled by the minutes the player had been
// playing — a starter has more to lose. Real returners from a full lost year
// (Wall, Simmons, Bynum, Yao — and Murray, Porziņģis, Leonard, Durant) came
// back to 47 games at 21.5 minutes on average where their last healthy
// season pointed to 64 at 29; the fit learns that gap rather than assuming it.
// The rates take a fitted "rust" factor for the same year (params.gap).
export function timeFeatures(units, missed = 0) {
  const [last, ...prior] = units;
  const lostLast = isLostSeason(last) ? 1 : 0;
  const healthy = prior.filter((u) => !isLostSeason(u));
  const g = healthy.reduce((s, u) => s + u.g, 0);
  const aH = healthy.length ? healthy.reduce((s, u) => s + u.avail, 0) / healthy.length : last.avail;
  const mH = g > 0 ? healthy.reduce((s, u) => s + u.g * u.mpg, 0) / g : last.mpg;
  const aEff = lostLast ? aH : last.avail, mEff = lostLast ? mH : last.mpg;
  const lostBefore = prior.filter(isLostSeason).length;
  const gone = missed > 0 ? 1 : 0;
  return {
    lostLast,
    avail: [aEff, aH, lostLast, lostBefore, mEff / 36, gone, (gone * mEff) / 36],
    // Squared, because minutes regress along a curve: a 36-minute player
    // keeps more of them than a straight line through the bench allows.
    mpg: [mEff, (mEff * mEff) / 36, mH, lostLast, aEff, gone, gone * mEff],
  };
}

// Season totals for a projection at `g` games, rebuilt against `target`.
export function rebuildRow(proj, target, g) {
  const mp = proj.mpg * g;
  const r = Object.fromEntries(RATE_KEYS.map((k) => [k, proj.idx[k] * target.rate[k] * mp]));
  const fg2m = r.fg2a * proj.pct.fg2, tpm = r.tpa * proj.pct.tp, ftm = r.fta * proj.pct.ft;
  return {
    g, mp,
    pts: 2 * fg2m + 3 * tpm + ftm,
    ast: r.ast, stl: r.stl, blk: r.blk, tov: r.tov, drb: r.drb, orb: r.orb,
    fgm: fg2m + tpm, fga: r.fg2a + r.tpa, tpm, tpa: r.tpa, ftm, fta: r.fta,
  };
}

// Scales a season row to `g` games at the same per-game line — how a Monte
// Carlo draw changes a player's availability without touching the rates.
export function scaleRow(row, g) {
  const f = row.g > 0 ? g / row.g : 0;
  const out = { g };
  for (const [k, v] of Object.entries(row)) if (k !== "g" && typeof v === "number") out[k] = v * f;
  return out;
}


// --- The awards --------------------------------------------------------------
// MVP voting, modelled as a conditional logit over the season's leading
// players (fit in scripts/fit-projection-model.mjs on every winner since
// 1980-81): a player's score is
//
//   s = a · VA / 100
//
// and P(the player wins) = exp(s) / Σ exp(s') over the field. Season VA, and nothing
// else, because nothing else earned its place: team strength (the top eight
// on the roster, standing in for the record voters weigh), VA per game, games
// played and a best-record flag were each tried, judged leave-one-season-out,
// and none beat VA alone — once a player's VA is known, the team's quality
// tells you no more about the vote. Reported in the fit log.
//
// A conditional logit is the first pick of a Plackett-Luce ranking, so the
// whole ballot can be drawn the same way: add Gumbel noise to every score and
// sort. That is what simulateAwards does, once per simulated season, and what
// gives All-NBA its odds as well (the top fifteen of the drawn ranking —
// positionless, as the ballot has been since 2023-24).
//
// Since 2023-24 a player needs 65 games to be eligible for either; a simulated
// season below that leaves the player off the ballot.

export const TEAM_TOP_N = 8;
export const AWARD_MIN_GAMES = 65;

export const mvpScore = (model, va) => model.a * (va / 100);

// Team strength from a list of player VA totals, per game of an 82-game
// season — the page's team ranking, and the feature the MVP fit tested.
export function teamStrength(vas, schedule = 82) {
  return [...vas].sort((a, b) => b - a).slice(0, TEAM_TOP_N).reduce((s, v) => s + v, 0) / schedule;
}

// Seeded PRNG (mulberry32), so a page load and a test see the same seasons.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gumbel = (u) => -Math.log(-Math.log(Math.min(1 - 1e-12, Math.max(1e-12, u))));

// Which residual tier a projection draws its errors from — by projected
// minutes, because a starter's miss and a bench player's are different sizes.
export const MPG_TIERS = [0, 16, 24, 30];
export const tierOf = (mpg) => {
  let t = 0;
  for (let i = 0; i < MPG_TIERS.length; i++) if (mpg >= MPG_TIERS[i]) t = i;
  return t;
};

// The season, simulated. `players` are { key, g, va, mpg } — projected games,
// total VA under the awards' baseline, and minutes (which pick the tier). `pool[tier]` holds real backtest
// misses as [ΔVA/G, actual games / projected games] pairs: each simulated
// player draws one whole pair, so a bad year's per-game drop and its missed
// games stay as correlated as they really were.
//
// Returns per player: P(MVP), P(All-NBA), P(1st team), mean finish, and the
// 10th/90th percentile of the simulated VA.
export function simulateAwards(players, model, pool, { sims = 2000, seed = 2627, schedule = 82 } = {}) {
  const rand = rng(seed);
  const n = players.length;
  const tally = players.map(() => ({ mvp: 0, allNba: 0, first: 0, rankSum: 0, ranked: 0, vas: [] }));
  const vpg = players.map((p) => (p.g > 0 ? p.va / p.g : 0));
  const tierPool = players.map((p) => pool[tierOf(p.mpg ?? 0)] || pool[0] || [[0, 1]]);
  const simVa = new Float64Array(n), simG = new Float64Array(n);
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < n; i++) {
      const tp = tierPool[i];
      const [dv, gr] = tp[Math.floor(rand() * tp.length)];
      const g = Math.min(schedule, Math.max(0, Math.round(players[i].g * gr)));
      simG[i] = g;
      simVa[i] = (vpg[i] + dv) * g;
      tally[i].vas.push(simVa[i]);
    }
    const ballot = [];
    for (let i = 0; i < n; i++) {
      if (simG[i] < AWARD_MIN_GAMES) continue;
      ballot.push([mvpScore(model, simVa[i]) + gumbel(rand()), i]);
    }
    ballot.sort((x, y) => y[0] - x[0]);
    ballot.forEach(([, i], r) => {
      if (r === 0) tally[i].mvp++;
      if (r < 5) tally[i].first++;
      if (r < 15) tally[i].allNba++;
      tally[i].rankSum += r + 1;
      tally[i].ranked++;
    });
  }
  return players.map((p, i) => {
    const t = tally[i];
    const v = t.vas.sort((a, b) => a - b);
    const q = (f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
    return {
      key: p.key,
      mvp: t.mvp / sims,
      allNba: t.allNba / sims,
      first: t.first / sims,
      meanRank: t.ranked ? t.rankSum / t.ranked : null,
      eligible: t.ranked / sims,
      vaLo: q(0.1), vaHi: q(0.9),
    };
  });
}

// All-NBA teams from simulated odds: the fifteen likeliest, five a team, in
// order of P(All-NBA) — ties broken by P(1st team).
export function allNbaTeams(results) {
  const ranked = [...results].filter((r) => r.allNba > 0)
    .sort((a, b) => b.allNba - a.allNba || b.first - a.first).slice(0, 15);
  return [ranked.slice(0, 5), ranked.slice(5, 10), ranked.slice(10, 15)];
}


// --- Team context: pooling the shared resources ------------------------------
// Each projection above is one player's history, read alone. But a team only
// has so much to go around: 240 minutes a night, one ball per possession to
// shoot or turn over, one assist per made basket at most, and a share of the
// misses to rebound. Put two players who each used 30% of their old teams'
// possessions on one roster, and they can't both keep doing it.
//
// So once every player is on a roster, each shared resource is pooled:
//
//   minutes     the roster's projected minutes
//   usage       shot attempts (FGA, FTA) and turnovers — possessions used
//   assists
//   rebounds    defensive and offensive, separately
//
// For each, the roster's projected level T — total minutes, or for the others
// the total per roster minute, i.e. how concentrated it is — is compared with
// a typical team's (the median over the league's rosters, measured the same
// way), and every player's share is scaled by
//
//   (T / median) ^ −β
//
// β = 1 would force every team to the same total; β = 0 ignores teammates
// entirely. β is fit per resource (scripts/fit-projection-model.mjs) on how
// players actually did on the rosters they actually played for.
//
// Usage can also bend with the player: with δ > 0 a high-usage player gives up
// a smaller share than a role player beside them — the ball finds the star.
//
// Makes scale with attempts (percentages are unchanged), and points are
// rebuilt from them, so a projection that loses shots loses the points with
// them.

export const POOL_KEYS = ["min", "usg", "ast", "drb", "orb"];
const MIN_TEAMS = 20; // a median needs a league; fewer rosters and pooling is skipped

const usageOf = (r) => (r.fga || 0) + 0.475 * (r.fta || 0) + (r.tov || 0);
const poolTotal = {
  min: (r) => r.mp || 0,
  usg: usageOf,
  ast: (r) => r.ast || 0,
  drb: (r) => r.drb || 0,
  orb: (r) => r.orb || 0,
};

const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

function scaleKeys(r, keys, f) {
  const o = { ...r };
  for (const k of keys) if (typeof o[k] === "number") o[k] *= f;
  return o;
}
const rebuildPts = (r) => ({ ...r, pts: 2 * ((r.fgm || 0) - (r.tpm || 0)) + 3 * (r.tpm || 0) + (r.ftm || 0) });
const COUNTS = ["mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb", "fgm", "fga", "tpm", "tpa", "ftm", "fta"];
const POOL_STATS = {
  usg: ["fga", "fgm", "tpa", "tpm", "fta", "ftm", "tov"],
  ast: ["ast"], drb: ["drb"], orb: ["orb"],
};

// `players` are { team, row } (row: projected season totals). Returns rows in
// the same order, each with `pool` — the multiplier each resource applied.
// Players without a team are passed through untouched, and only count toward
// no one's pool.
export function poolTeams(players, pool) {
  const out = players.map((p) => ({ ...p.row, pool: {} }));
  const teams = [...new Set(players.map((p) => p.team).filter(Boolean))];
  if (!pool || teams.length < MIN_TEAMS) return out;
  const members = Object.fromEntries(teams.map((t) => [t, []]));
  players.forEach((p, i) => { if (p.team) members[p.team].push(i); });
  // Minutes pool on the roster's total; the per-minute resources on its
  // CONCENTRATION — the total per roster minute — so a deep roster isn't
  // mistaken for a crowded one.
  const ratio = (key) => {
    const tot = Object.fromEntries(teams.map((t) => {
      const x = members[t].reduce((s, i) => s + poolTotal[key](out[i]), 0);
      const m = members[t].reduce((s, i) => s + out[i].mp, 0);
      return [t, key === "min" ? x : m > 0 ? x / m : 0];
    }));
    const med = median(Object.values(tot));
    return Object.fromEntries(teams.map((t) => [t, med > 0 && tot[t] > 0 ? tot[t] / med : 1]));
  };

  // Minutes first: they carry every count with them, rates unchanged.
  if (pool.min) {
    const R = ratio("min");
    players.forEach((p, i) => {
      if (!p.team) return;
      const f = R[p.team] ** -pool.min;
      out[i] = { ...scaleKeys(out[i], COUNTS, f), pool: { ...out[i].pool, min: f } };
    });
  }
  // Then each per-minute resource, measured on the minutes just set.
  for (const key of ["usg", "ast", "drb", "orb"]) {
    const beta = pool[key];
    if (!beta) continue;
    const R = ratio(key);
    // Usage bends with the player's own load (δ): a player's usage per minute
    // over the team's, raised to −δ, so the heavier user cedes less.
    const delta = key === "usg" ? pool.usgDelta || 0 : 0;
    const teamRate = {};
    if (delta) for (const t of teams) {
      const m = members[t].reduce((s, i) => s + out[i].mp, 0);
      teamRate[t] = m > 0 ? members[t].reduce((s, i) => s + usageOf(out[i]), 0) / m : 0;
    }
    players.forEach((p, i) => {
      if (!p.team) return;
      let b = beta;
      if (delta && teamRate[p.team] > 0 && out[i].mp > 0) {
        const rel = usageOf(out[i]) / out[i].mp / teamRate[p.team];
        b = beta * Math.max(0.25, Math.min(2, rel)) ** -delta;
      }
      const f = R[p.team] ** -b;
      out[i] = { ...scaleKeys(out[i], POOL_STATS[key], f), pool: { ...out[i].pool, [key]: f } };
    });
  }
  return out.map((r) => (r.pool.usg ? rebuildPts(r) : r));
}


// --- Rookies: translating a college season -----------------------------------
// A rookie has no NBA seasons to read, so the projection starts from the last
// college season instead (data/college-<season>.json) and translates it, piece
// by piece, with relationships fit on past draft classes — each class's final
// college season against its NBA rookie year (scripts/fit-projection-model.mjs):
//
//   rates        log NBA index = a + b · log college index, per stat. Both
//                indexes are on their own league's per-minute rate, and the
//                college one is first shrunk toward 1 by K phantom minutes,
//                so a freshman's 300-minute sample can't promise the moon.
//                b < 1 is the translation's own regression: college outliers
//                arrive as smaller NBA outliers.
//   percentages  NBA gap to the league = a + b · college gap (shrunk the same
//                way, by attempts)
//   time         minutes and availability on college quality (VA per 40)
//                and college minutes per game
//
// Rookies with no college season in the data — internationals, G League,
// players who sat out a year — still can't be projected.

const lnIdx = (x) => Math.log(Math.max(0.05, x));

// College per-minute indexes and percentage gaps for one season row.
export function collegeUnits(c, cctx, K = 0, Kp = 0) {
  const r = expand(c), mp = r.mp || 0;
  const idx = Object.fromEntries(RATE_KEYS.map((k) => {
    const raw = mp > 0 && cctx.rate[k] > 0 ? (r[k] / mp) / cctx.rate[k] : 1;
    return [k, (mp * raw + K) / (mp + K)];
  }));
  const pct = Object.fromEntries(PCT_KEYS.map(({ key, made, att }) => {
    const a = r[att] || 0;
    const gap = a > 0 ? r[made] / a - cctx.pct[key] : 0;
    return [key, (a * gap) / (a + Kp)];
  }));
  const gp = c.gp || c.g || 0;
  return { idx, pct, mpg: gp > 0 ? mp / gp : 0, q: mp > 0 ? ((c.va || 0) / mp) * 40 : 0 };
}

export const rookieTimeFeatures = (u) => [1, u.q, u.mpg];

// One rookie's projected season from a college row. `rk` is params.rookie.
export function projectRookie(c, cctx, rk, target) {
  const u = collegeUnits(c, cctx, rk.K, rk.Kp);
  const idx = Object.fromEntries(RATE_KEYS.map((k) => [k, Math.exp(rk.rate[k][0] + rk.rate[k][1] * lnIdx(u.idx[k]))]));
  const pct = Object.fromEntries(PCT_KEYS.map(({ key }) =>
    [key, Math.min(0.99, Math.max(0, target.pct[key] + rk.pct[key][0] + rk.pct[key][1] * u.pct[key]))]));
  const x = rookieTimeFeatures(u);
  const dot = (b) => x.reduce((s, v, i) => s + v * b[i], 0);
  const out = {
    exp: 0, rookie: true, idx, pct,
    mpg: Math.min(36, Math.max(4, dot(rk.mpg))),
    avail: Math.min(0.98, Math.max(0.05, dot(rk.avail))),
  };
  out.g = Math.max(1, Math.round(out.avail * 82));
  out.row = rebuildRow(out, target, out.g);
  return out;
}
