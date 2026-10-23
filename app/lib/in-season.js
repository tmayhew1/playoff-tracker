// The Look Ahead once the season is under way: the preseason projection
// (lib/projection-model.js) updated with the games already played.
//
// Pure — no fs, no fetch — so scripts/fit-in-season.mjs fits the very
// functions /api/projections runs, and the tests can call them directly.
//
// --- A player ---------------------------------------------------------------
// Each piece of the line the projection is built from is updated on its own,
// the same way: the preseason number counts as W units of evidence, the season
// so far as what it actually is, and the rest of the season is projected at the
// mix —
//
//   per-minute rates   (W·preseason + this season's count) / (W + minutes)
//   percentages        (W·preseason + makes) / (W + attempts)
//   minutes per game   (W·preseason + minutes) / (W + games)
//   availability       (W·preseason + games) / (W + team games)
//
// Each W is fit (scripts/fit-in-season.mjs) on past seasons, at checkpoints
// through each one, by how well the mix predicted the games still to come —
// so how fast a hot start is believed is measured, not assumed. A shooting
// percentage needs far more attempts to move than a rebound rate needs
// minutes, and the fit says so.
//
// The season line is then the games played plus the games left, at the
// updated line: a player's VA so far is banked, only the rest is projected.
//
// --- A team -----------------------------------------------------------------
// The preseason win projection counts as W games, the season so far by its
// point margin — a better read of a team than its record over a few weeks —
// turned into a winning percentage by the league's own slope, and the rest of
// the schedule is played at the mix. W comes from the wins model's own miss:
// the better the preseason read, the longer it holds.

import { PCT_KEYS, RATE_KEYS } from "./projection-model.js";

const SCHEDULE = 82;
const fg2 = (r) => ({ fg2m: (r.fgm || 0) - (r.tpm || 0), fg2a: (r.fga || 0) - (r.tpa || 0) });

// `prior` is the preseason row (season totals, lib/projection-model.js
// rebuildRow's shape) and `healthyG` the games it expects of a healthy season;
// `ytd` this season's totals so far (lib/season-to-date.js playerTotals) or
// null; `team` { played } — the player's team's games so far; `outGames` games
// still to be missed on a known injury; `ctx` the league's percentages, for a
// prior with no attempts at all.
//
// Returns { rest, row, restG, mpg, avail }: the games left as a row, the whole
// season (played + left), and the updated minutes and availability.
export function updatePlayer({ prior, healthyG = prior?.g ?? 0, ytd = null, team = { played: 0 }, outGames = 0, ctx = null }, model) {
  const p = { ...prior, ...fg2(prior) };
  const y = ytd ? { ...ytd, ...fg2(ytd) } : null;
  const ymp = y?.mp || 0, yg = y?.g || 0;
  const played = Math.max(team.played || 0, yg);
  const left = Math.max(0, SCHEDULE - played);

  const rate = {};
  for (const k of RATE_KEYS) {
    const W = model.rate[k];
    const r0 = p.mp > 0 ? (p[k] || 0) / p.mp : 0;
    rate[k] = ymp > 0 ? (W * r0 + (y[k] || 0)) / (W + ymp) : r0;
  }
  const pct = {};
  for (const { key, made, att } of PCT_KEYS) {
    const W = model.pct[key];
    const p0 = p[att] > 0 ? p[made] / p[att] : ctx?.pct?.[key] ?? 0;
    pct[key] = y?.[att] > 0 ? (W * p0 + y[made]) / (W + y[att]) : p0;
  }
  const mpg0 = p.g > 0 ? p.mp / p.g : 0;
  const mpg = yg > 0 ? (model.mpg * mpg0 + ymp) / (model.mpg + yg) : mpg0;
  const a0 = Math.min(1, healthyG / SCHEDULE);
  const avail = played > 0 ? Math.min(1, (model.avail * a0 + yg) / (model.avail + played)) : a0;

  const restG = Math.round(avail * Math.max(0, left - Math.max(0, outGames)));
  const mp = mpg * restG;
  const c = Object.fromEntries(RATE_KEYS.map((k) => [k, rate[k] * mp]));
  const fg2m = c.fg2a * pct.fg2, tpm = c.tpa * pct.tp, ftm = c.fta * pct.ft;
  const rest = {
    g: restG, mp,
    pts: 2 * fg2m + 3 * tpm + ftm,
    ast: c.ast, stl: c.stl, blk: c.blk, tov: c.tov, drb: c.drb, orb: c.orb,
    fgm: fg2m + tpm, fga: c.fg2a + c.tpa, tpm, tpa: c.tpa, ftm, fta: c.fta,
  };
  return { rest, row: addRows(y, rest), restG, mpg, avail };
}

export const ROW_KEYS = ["g", "mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb", "fgm", "fga", "tpm", "tpa", "ftm", "fta"];
export function addRows(a, b) {
  return Object.fromEntries(ROW_KEYS.map((k) => [k, (a?.[k] || 0) + (b?.[k] || 0)]));
}

// How much of a projection's miss is still ahead once `mp` minutes are in:
// the spread of the per-game VA a player can still end up at, as a share of
// the preseason spread. Normal-normal: the preseason read is worth `W` minutes
// of evidence (model.va, fit like the rest), so its uncertainty shrinks by
// √(W / (W + mp)).
export const missShrink = (mp, model) => Math.sqrt(model.va / (model.va + Math.max(0, mp || 0)));

// A team's season: { winPct, wins, restWins } from the preseason winning
// percentage `p0` and the record so far, `rec` { w, l, g, pf, pa }.
export function updateTeam(p0, rec, model) {
  const g = rec?.g || 0;
  if (!g) return { winPct: p0, wins: p0 * SCHEDULE, restWins: p0 * SCHEDULE, pMargin: null };
  const pMargin = Math.min(0.97, Math.max(0.03, 0.5 + model.slope * ((rec.pf - rec.pa) / g)));
  const p = (model.W * p0 + g * pMargin) / (model.W + g);
  const restWins = p * Math.max(0, SCHEDULE - g);
  return { winPct: p, wins: rec.w + restWins, restWins, pMargin };
}
