import { normalizeName } from "../../lib/format";
import { gamesMissed } from "../../lib/injuries";
import { missShrink, updatePlayer } from "../../lib/in-season";
import { lgaForSeason, valueAdd } from "../../scoring";

// The Look Ahead's players once the season has started (lib/in-season.js): the
// projection placed on today's rosters, with injuries and the team context
// applied, becomes the PRIOR, and the games already played are mixed in.
//
// Each player comes back with the season line (`row`, games played plus games
// left), its VA, and what it was built from: `ytd` and `ytdVa` (the season so
// far), `rest` and `restVa` (the games left), `preseason` (the line before any
// game was played — the standings' prior reads it), `maxRest` (the games the
// schedule and a known injury leave), and `shrink` (how much of a preseason
// miss is still ahead, for the simulation).
//
// A player on a roster the projection never saw — an international, a
// two-way call-up — who has played MIN_UNPROJECTED minutes joins too, from a
// league-average line at their own minutes: there is nothing else to start
// them from, and the minutes they've played already outweigh it.

export const MIN_UNPROJECTED = 100;
const r1 = (x) => Math.round(x * 10) / 10;
const roundRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, k === "g" ? Math.round(v) : r1(v)]));
const ROW = ["g", "mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb", "fgm", "fga", "tpm", "tpa", "ftm", "fta"];
const pickRow = (r) => Object.fromEntries(ROW.map((k) => [k, r[k] || 0]));

// Surname + first initial, for a box-score name the roster spells differently.
const loose = (n) => {
  const parts = normalizeName(n).split(" ");
  return parts.length > 1 ? `${parts[0][0]} ${parts.slice(1).join(" ")}` : null;
};

export function withSeasonToDate(players, toDate, model, baked, season) {
  const lga = lgaForSeason(baked.base);
  const byName = new Map(), byLoose = new Map();
  for (const r of toDate.players) {
    byName.set(normalizeName(r.name), r);
    const k = `${r.team}|${loose(r.name)}`;
    byLoose.set(k, byLoose.has(k) ? null : r);
  }
  const used = new Set();
  const out = players.map((p) => {
    let ytd = byName.get(normalizeName(p.name)) || null;
    if (!ytd && p.team) ytd = byLoose.get(`${p.team}|${loose(p.name)}`) || null;
    if (ytd && used.has(ytd)) ytd = null;
    if (ytd) used.add(ytd);
    return place(p, ytd, toDate, model, baked, season, lga);
  });
  // The rest of the league's minutes: players the projection has no line for.
  for (const r of toDate.players) {
    if (used.has(r) || r.mp < MIN_UNPROJECTED) continue;
    const g = r.g, mp = r.mp;
    const prior = { g, mp };
    for (const k of ["ast", "stl", "blk", "tov", "drb", "orb", "tpa", "fta"]) prior[k] = baked.ctx.rate[k] * mp;
    prior.fga = (baked.ctx.rate.fg2a + baked.ctx.rate.tpa) * mp;
    prior.tpm = prior.tpa * baked.ctx.pct.tp;
    prior.fgm = baked.ctx.rate.fg2a * mp * baked.ctx.pct.fg2 + prior.tpm;
    prior.ftm = prior.fta * baked.ctx.pct.ft;
    prior.pts = 2 * (prior.fgm - prior.tpm) + 3 * prior.tpm + prior.ftm;
    const played = toDate.records[r.team]?.g || g;
    const base = {
      slug: r.slug || `x-${normalizeName(r.name).replace(/ /g, "-")}`, name: r.name, team: r.team, pos: r.pos || null,
      exp: null, dpm: null, unprojected: true, last: null,
      row: prior, va: valueAdd(prior, lga), mpg: mp / g,
    };
    out.push(place(base, r, toDate, model, baked, season, lga, Math.round((g / played) * 82)));
  }
  return out.filter((p) => p.row.g > 0);
}

function place(p, ytd, toDate, model, baked, season, lga, healthyG = p.injury?.healthyG ?? p.row.g) {
  const team = p.team || ytd?.team || null;
  const played = Math.max(toDate.records[team]?.g || 0, ytd?.g || 0);
  const inj = p.injury;
  const outGames = inj ? (inj.out ? 82 : Math.max(0, gamesMissed(inj.return, season) - played)) : 0;
  const u = updatePlayer({ prior: p.row, healthyG, ytd, team: { played }, outGames, ctx: baked.ctx }, model);
  const row = roundRow(u.row);
  const y = ytd ? pickRow(ytd) : null;
  return {
    ...p,
    team,
    preseason: { row: p.row, va: p.va },
    contextVa: p.soloVa != null ? r1(p.va - p.soloVa) : null,
    ytd: y, ytdVa: y ? r1(valueAdd(y, lga)) : 0,
    rest: roundRow(u.rest), restVa: u.restG > 0 ? r1(valueAdd(u.rest, lga)) : 0,
    maxRest: Math.max(0, 82 - played - outGames),
    shrink: Math.round(missShrink(ytd?.mp, model) * 1000) / 1000,
    row, va: r1(valueAdd(u.row, lga)),
    mpg: row.g > 0 ? r1(row.mp / row.g) : r1(u.mpg),
  };
}
