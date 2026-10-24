// The season in progress, read off its baked box scores
// (public/regular-season-games, scripts/bake-regular-season-games.mjs): every
// player's totals so far, every team's record, and a league baseline that
// firms up as the games come in.
//
// Pure — no fs, no fetch — so the routes (app/api/_lib/season-to-date.js), the
// fit (scripts/fit-in-season.mjs) and the tests all add up the same lines.

import { normalizeName } from "./format.js";
import { unpackMonth } from "./regular-season-games.js";

export const TOTAL_KEYS = ["mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb",
  "fgm", "fga", "tpm", "tpa", "ftm", "fta"];

// The season's games in date order, each with its box score when the bake
// holds one. `index` is the season's index.json, `months` its month files
// (raw, as baked).
export function gamesWithBoxes(index, months) {
  const boxes = new Map();
  for (const m of months) for (const [id, box] of unpackMonth(m)) boxes.set(id, box);
  return [...(index?.games || [])]
    .sort((a, b) => a.date.localeCompare(b.date) || a.gameDateTimeUTC.localeCompare(b.gameDateTimeUTC))
    .map((g) => ({ ...g, box: boxes.get(g.gameId) || null }));
}

// Every player's totals in `games` (from gamesWithBoxes) on or before
// `through`: the same row shape a baked regular-season-<season>.json carries,
// keyed by name — the box scores carry no ids. `team` is the last team played
// for, `teams` every one in order, `tg` the games that team had played by
// then (the denominator for how often the player has been available).
export function playerTotals(games, through = "9999-12-31") {
  const by = new Map();
  for (const g of games) {
    if (g.date > through || !g.box) continue;
    for (const side of [g.box.home, g.box.away]) {
      for (const p of side.players) {
        if (!(p.mp > 0) || !p.name) continue;
        const k = normalizeName(p.name);
        let r = by.get(k);
        if (!r) {
          r = { name: p.name, team: side.tri, teams: [side.tri], g: 0, gs: 0, last: g.date };
          for (const key of TOTAL_KEYS) r[key] = 0;
          by.set(k, r);
        }
        if (r.team !== side.tri) { r.team = side.tri; r.teams.push(side.tri); }
        r.g += 1;
        if (p.starter) r.gs += 1;
        r.last = g.date;
        for (const key of TOTAL_KEYS) r[key] += p[key] || 0;
      }
    }
  }
  const records = teamRecords(games, through);
  return [...by.values()].map((r) => ({ ...r, mp: Math.round(r.mp * 100) / 100, tg: records[r.team]?.g || r.g }));
}

// { tri: { w, l, g, pf, pa } } for the games on or before `through`.
export function teamRecords(games, through = "9999-12-31") {
  const out = {};
  for (const g of games) {
    if (g.date > through) continue;
    const h = g.home, a = g.away;
    if (!(h?.score > 0 || a?.score > 0)) continue;
    for (const [me, op] of [[h, a], [a, h]]) {
      const r = (out[me.tri] ||= { w: 0, l: 0, g: 0, pf: 0, pa: 0 });
      r.g += 1;
      r.pf += me.score;
      r.pa += op.score;
      if (me.score > op.score) r.w += 1; else r.l += 1;
    }
  }
  return out;
}

// --- The league baseline, while the season is young ---------------------------
// A season's baseline is its own league's (scripts/R/scrape_common.R
// lga_from_players: minutes-weighted MEDIAN per-minute rates, aggregate ratios
// for the conversions). A week in, that is a median over a few games each —
// the median player-minute of a stat most players haven't recorded yet is
// zero, and 2026-27's first entry read blocks as worth nothing. So until the
// season is baked whole, its baseline is the measured one shrunk toward last
// season's by LGA_PRIOR_MP phantom minutes: about a tenth of a season, so the
// season's own league is most of it by mid-November and nearly all of it by
// the new year.
export const LGA_PRIOR_MP = 60000;

// Minutes-weighted median of a per-minute rate. KEEP IN SYNC with
// scripts/bake-playoff-averages.mjs and scrape_common.R.
function weightedMedianRate(rows, key) {
  const pairs = rows.filter((p) => p.mp > 0).map((p) => [(p[key] || 0) / p.mp, p.mp]).sort((a, b) => a[0] - b[0]);
  if (!pairs.length) return 0;
  const total = pairs.reduce((s, [, m]) => s + m, 0);
  let cum = 0;
  for (const [rate, mp] of pairs) { cum += mp; if (cum >= total / 2) return rate; }
  return pairs.at(-1)[0];
}

const MEDIAN_KEYS = {
  laPTSperM: "pts", laASTperM: "ast", laSTLperM: "stl", laBLKperM: "blk",
  laTOVperM: "tov", laDRBperM: "drb", laORBperM: "orb",
};

export function lgaFromPlayers(rows) {
  const s = (a, b) => (b > 0 ? a / b : 0);
  const t = Object.fromEntries(TOTAL_KEYS.map((k) => [k, rows.reduce((sum, p) => sum + (Number(p[k]) || 0), 0)]));
  const twoPm = t.fgm - t.tpm, twoPa = t.fga - t.tpa, reb = t.drb + t.orb;
  const poss = t.fga - t.orb + t.tov + 0.475 * t.fta;
  const base = {
    laPOSSperM: s(5 * poss, t.mp), laREBoppPerM: s(5 * reb, t.mp),
    la3P: s(t.tpm, t.tpa), la2P: s(twoPm, twoPa), laFT: s(t.ftm, t.fta), laFG: s(t.fgm, t.fga),
    laPTSperMake: s(t.pts, t.fgm), laFGPTSperMake: s(2 * twoPm + 3 * t.tpm, t.fgm),
    laPTSperPoss: s(t.pts, poss), laDRBrate: s(t.drb, reb), laORBrate: s(t.orb, reb),
  };
  for (const [out, col] of Object.entries(MEDIAN_KEYS)) base[out] = weightedMedianRate(rows, col);
  return { lga: base, mp: t.mp };
}

// The season-so-far baseline, shrunk toward `prior` (last season's entry).
// Keys the prior carries that aren't measured here (zoneFG) ride along from it.
export function inSeasonLga(rows, prior, priorMp = LGA_PRIOR_MP) {
  const { lga, mp } = lgaFromPlayers(rows);
  if (!prior) return { ...lga };
  const w = mp / (mp + priorMp);
  const out = { ...prior };
  for (const [k, v] of Object.entries(lga)) {
    if (typeof prior[k] === "number") out[k] = w * v + (1 - w) * prior[k];
  }
  return out;
}

// The season-so-far usage model for USG-ADJ (app/data/usage-model.json, spec
// §4.6), shrunk toward last season's the same way: scripts/fit-usage-model.mjs
// fits a season from its regular-season table, which the season in progress
// doesn't have until it's baked whole — so without this the switch reads that
// season as having no model and does nothing. The same minutes-weighted line
// of PTS/MP on USG/MP and the same median-minute usage ū, each blended with
// `prior` (last season's entry) by LGA_PRIOR_MP phantom minutes. `ftaWeight`
// KEEP IN SYNC with FTA_W there.
export function inSeasonUsageModel(rows, prior, ftaWeight, priorMp = LGA_PRIOR_MP) {
  const usg = (p) => (p.fga || 0) + ftaWeight * (p.fta || 0);
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, n = 0;
  for (const p of rows) {
    const mp = p.mp || 0;
    if (!(mp > 0)) continue;
    const x = usg(p) / mp, y = (p.pts || 0) / mp;
    sw += mp; sx += mp * x; sy += mp * y; sxx += mp * x * x; sxy += mp * x * y; syy += mp * y * y;
    n++;
  }
  if (!(sw > 0) || n < 2) return prior ? { ...prior } : null;
  const mx = sx / sw, my = sy / sw;
  const vxx = sxx / sw - mx * mx, vxy = sxy / sw - mx * my, vyy = syy / sw - my * my;
  if (!(vxx > 0)) return prior ? { ...prior } : null;
  const own = { b: vxy / vxx };
  own.a = my - own.b * mx;
  own.muUsg = weightedMedianRate(rows.map((p) => ({ mp: p.mp, usg: usg(p) })), "usg");
  const w = prior ? sw / (sw + priorMp) : 1;
  const mix = (k) => (prior && typeof prior[k] === "number" ? w * own[k] + (1 - w) * prior[k] : own[k]);
  const r = (v, d) => Number(v.toFixed(d));
  const a = mix("a"), b = mix("b"), muUsg = mix("muUsg");
  return {
    a: r(a, 8), b: r(b, 8),
    r2: r(vyy > 0 ? (vxy * vxy) / (vxx * vyy) : 0, 4), n, mp: Math.round(sw),
    muUsg: r(muUsg, 6), atMuUsg: r(a + b * muUsg, 6),
    inSeason: true,
  };
}
