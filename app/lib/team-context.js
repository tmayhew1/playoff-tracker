// A team's game set against its opponent's, and against the league: the
// measures a tapped team's card compares (its tale of the tape, scoreboard.js
// TeamScoreCard), the same measures summed over the season so far to rank the
// league's teams on, and the conference standings through a day.

import { USG_FTA_W } from "../scoring";
import { TEAM_CONF } from "../teams";

const KEYS = ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "orb", "drb", "tov"];

// A roster's box-score lines summed: { pts, fgm, … }.
export function teamSums(players, into = Object.fromEntries(KEYS.map((k) => [k, 0]))) {
  for (const p of players || []) for (const k of KEYS) into[k] += p[k] || 0;
  return into;
}

// Possessions, FGA − ORB + TOV + 0.475·FTA (the free-throw weight VA uses).
const poss = (t) => t.fga - t.orb + t.tov + USG_FTA_W * t.fta;
// Rebounds priced as Value Added prices them: an offensive board by the
// league's DRB rate, a defensive one by its ORB rate.
const reb = (t, lga) => (lga?.laDRBrate ?? 0.75) * t.orb + (lga?.laORBrate ?? 0.25) * t.drb;

// The tape's measures for `own` against `opp` (one game's sums, or a season's
// over `gp` games): 2P / 3P / FT Value Added per game — points over a
// league-average shooter on the same attempts, the efficiency terms of
// scoring.js — then DEF PPP (the points allowed over the possessions they came
// on), wTRB% (the game's priced rebounds shared out, the two sides adding to
// 100) and Poss Ratio (possessions over the opponent's).
export function tapeMeasures(own, opp, lga, gp = 1) {
  const [ownPoss, oppPoss] = [poss(own), poss(opp)];
  const [ownReb, oppReb] = [reb(own, lga), reb(opp, lga)];
  return {
    "2P": 2 * ((own.fgm - own.tpm) - (lga?.la2P ?? 0) * (own.fga - own.tpa)) / gp,
    "3P": 3 * (own.tpm - (lga?.la3P ?? 0) * own.tpa) / gp,
    FT: (own.ftm - (lga?.laFT ?? 0) * own.fta) / gp,
    def: oppPoss > 0 ? opp.pts / oppPoss : null,
    reb: ownReb + oppReb > 0 ? 100 * ownReb / (ownReb + oppReb) : null,
    poss: oppPoss > 0 ? ownPoss / oppPoss : null,
  };
}

// Which way is better: DEF PPP is points allowed, so lower ranks first.
const LOWER_IS_BETTER = new Set(["def"]);

// Every team's season so far over `boxes`: { [tri]: { own, opp, gp } }, its
// box-score lines and its opponents' summed over its `gp` games.
export function seasonTotals(boxes) {
  const by = {};
  for (const box of boxes) {
    for (const [side, other] of [[box.away, box.home], [box.home, box.away]]) {
      if (!side?.tri || !side.players?.length || !other?.players?.length) continue;
      const t = (by[side.tri] ||= { own: teamSums([]), opp: teamSums([]), gp: 0 });
      teamSums(side.players, t.own);
      teamSums(other.players, t.opp);
      t.gp += 1;
    }
  }
  return by;
}

// Every team's rank (1 = best) in each measure over `boxes` (a season's so
// far, or its seasonTotals): { [tri]: { "2P": 4, … } }. Equal figures share
// a rank.
export function seasonRanks(boxes, lga, totals = seasonTotals(boxes)) {
  const measures = Object.entries(totals).map(([tri, t]) => [tri, tapeMeasures(t.own, t.opp, lga, t.gp)]);
  const out = Object.fromEntries(measures.map(([tri]) => [tri, {}]));
  for (const key of ["2P", "3P", "FT", "def", "reb", "poss"]) {
    const sign = LOWER_IS_BETTER.has(key) ? 1 : -1;
    const vals = measures.filter(([, m]) => m[key] != null).map(([tri, m]) => [tri, m[key]]);
    for (const [tri, v] of vals) out[tri][key] = 1 + vals.filter(([, w]) => sign * (w - v) < 0).length;
  }
  return out;
}

// The conference standings through `date` (Eastern, inclusive) from the
// season's finals: { [tri]: { w, l, place, conf } }. Teams order on win
// percentage (a team yet to play at .500), which between teams with the same
// games played is simply wins, then — at the same percentage over different
// games, 0-1 beside 0-2 — on games behind (wins less losses). Only teams with
// the same record fall back on `projected` wins (the Look Ahead's, for the
// season it projects), then name.
export function standingsThrough(games, date, projected = null) {
  const rec = {};
  for (const tri of Object.keys(TEAM_CONF)) rec[tri] = { w: 0, l: 0 };
  const seen = new Set();
  for (const g of games) {
    if (g.date > date || seen.has(g.gameId)) continue;
    seen.add(g.gameId);
    const [h, a] = [g.home, g.away];
    if (!rec[h.tri] || !rec[a.tri]) continue;
    const homeWon = h.score > a.score;
    rec[h.tri][homeWon ? "w" : "l"] += 1;
    rec[a.tri][homeWon ? "l" : "w"] += 1;
  }
  // Only the franchises in this season's games stand (the legacy tricodes
  // in TEAM_CONF don't, nor a relocated one's old name).
  const playing = new Set(games.flatMap((g) => [g.home.tri, g.away.tri]));
  const pct = (r) => (r.w + r.l ? r.w / (r.w + r.l) : 0.5);
  const out = {};
  for (const conf of ["E", "W"]) {
    const teams = Object.keys(rec).filter((t) => TEAM_CONF[t] === conf && playing.has(t));
    teams.sort((x, y) => pct(rec[y]) - pct(rec[x])
      || (rec[y].w - rec[y].l) - (rec[x].w - rec[x].l)
      || (projected ? (projected[y] ?? 0) - (projected[x] ?? 0) : 0)
      || x.localeCompare(y));
    teams.forEach((t, i) => { out[t] = { ...rec[t], place: i + 1, conf }; });
  }
  return out;
}

// Every team-game's measures over `boxes` (a season's so far), each measure's
// figures sorted: { "2P": [...], … } — the league's spread of single games
// that a game's own figure is placed in (percentile).
export function gameDistributions(boxes, lga) {
  const out = { "2P": [], "3P": [], FT: [], def: [], reb: [], poss: [] };
  for (const box of boxes) {
    for (const [side, other] of [[box.away, box.home], [box.home, box.away]]) {
      if (!side?.players?.length || !other?.players?.length) continue;
      const m = tapeMeasures(teamSums(side.players), teamSums(other.players), lga);
      for (const k of Object.keys(out)) if (m[k] != null) out[k].push(m[k]);
    }
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a - b);
  return out;
}

// Every team's season measures (seasonTotals), each measure's figures
// sorted: the spread of the league's teams that a team's season figure is
// placed in, as gameDistributions does a single game's.
export function seasonDistributions(totals, lga) {
  const out = { "2P": [], "3P": [], FT: [], def: [], reb: [], poss: [] };
  for (const t of Object.values(totals)) {
    const m = tapeMeasures(t.own, t.opp, lga, t.gp);
    for (const k of Object.keys(out)) if (m[k] != null) out[k].push(m[k]);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a - b);
  return out;
}

// The pregame projection. Each side's points are the game's possessions times
// its points per possession, the usual multiplicative matchup:
//   possessions  away pace × home pace ÷ league pace
//   points/poss  its offense × the other side's defense ÷ the league's
// with a team's pace (possessions a game, the two sides' averaged), offense
// (points per own possession) and defense (points allowed per opponent
// possession) its season so far's (seasonTotals), shrunk toward a prior the
// way a few games ought to be: weighted gp / (gp + PRIOR_GAMES), the prior
// carrying the rest. The prior is the league's figure, moved by `priorWins`
// (the Look Ahead's projected wins, when it projects this season) at
// WINS_PER_NET wins to a point of net rating per 100 possessions, split evenly
// between offense and defense. Home court is HOME_EDGE points each way.
// League pace and points per possession are the season's own once it has
// games, `lga`'s before. { away, home, poss } or null with neither.
const PRIOR_GAMES = 10;
const PACE_PRIOR_GAMES = 5;
const WINS_PER_NET = 2.7;
const HOME_EDGE = 1.2;
export function projectScore(totals, away, home, lga, priorWins = null) {
  const all = Object.values(totals || {});
  const sum = (f) => all.reduce((s, t) => s + f(t), 0);
  const games = sum((t) => t.gp);
  const lgPPP = games ? sum((t) => t.own.pts) / sum((t) => poss(t.own)) : lga?.laPTSperPoss;
  const lgPace = games ? sum((t) => (poss(t.own) + poss(t.opp)) / 2) / games : (lga?.laPOSSperM ?? 0) * 48;
  if (!(lgPPP > 0) || !(lgPace > 0)) return null;
  const rate = (tri) => {
    const t = totals?.[tri];
    const gp = t?.gp || 0;
    const net = priorWins?.[tri] != null ? (priorWins[tri] - 41) / WINS_PER_NET : 0;
    const w = gp / (gp + PRIOR_GAMES);
    const shrink = (own, prior) => (gp ? w * own + (1 - w) * prior : prior);
    return {
      off: shrink(gp && t.own.pts / poss(t.own), lgPPP + net / 200),
      def: shrink(gp && t.opp.pts / poss(t.opp), lgPPP - net / 200),
      pace: gp ? ((poss(t.own) + poss(t.opp)) / 2 + PACE_PRIOR_GAMES * lgPace) / (gp + PACE_PRIOR_GAMES) : lgPace,
    };
  };
  const [a, h] = [rate(away), rate(home)];
  const n = a.pace * h.pace / lgPace;
  return {
    away: n * a.off * h.def / lgPPP - HOME_EDGE,
    home: n * h.off * a.def / lgPPP + HOME_EDGE,
    poss: n,
  };
}

// Where `v` sits in `sorted`, 0 to 1 (ties counting half), or null without a
// spread to place it in.
export function percentile(sorted, v) {
  if (!sorted?.length || v == null) return null;
  let below = 0, equal = 0;
  for (const x of sorted) { if (x < v) below += 1; else if (x === v) equal += 1; }
  return (below + equal / 2) / sorted.length;
}

// 1 -> "1st", 22 -> "22nd".
export function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  return `${n}${s}`;
}
