// Fit the in-season update (app/lib/in-season.js) on past seasons and write
// app/data/in-season-model.json.
//
//   npm run fit:in-season
//
// For every season from FIRST to the last one baked whole, every player is
// projected as of the summer before (lib/projection-model.js projectPlayer,
// with the baked projection's constants), and the season's own box scores
// (public/regular-season-games) are cut at checkpoints — the nights the
// median team reached 5, 10, 20, 30, 41, 55 and 70 games. At each one the
// season so far is mixed with the projection, and each piece's W is the
// weight that best predicts the rest of that season:
//
//   rates and VA per minute   in minutes, error weighted by minutes still to come
//   percentages               in attempts, weighted by attempts still to come
//   minutes per game          in games, weighted by games still to come
//   availability              in team games, weighted by team games still to come
//
// The preseason projections here use constants fit through the last season
// (the bake's), so they read each past season a little better than they could
// have at the time — which, if anything, leaves the W's a touch high: the
// update believes the preseason slightly longer than it should.
//
// The team weight is derived rather than searched: the wins model's miss is
// partly the luck of an 82-game record (binomial) and partly what the model
// got wrong about the team; a season's point margin, per game, reads the team
// with a noise measured from every game baked. W is the number of games of
// margin worth as much as the preseason read.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { leagueContext, projectPlayer, TIME_HISTORY, PCT_KEYS, RATE_KEYS } from "../app/lib/projection-model.js";
import { gamesWithBoxes, playerTotals, teamRecords } from "../app/lib/season-to-date.js";
import { updatePlayer } from "../app/lib/in-season.js";
import { lgaForSeason, valueAdd } from "../app/scoring.js";
import { normalizeName } from "../app/lib/format.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const GAMES = path.join(ROOT, "public", "regular-season-games");
const OUT = path.join(DATA, "in-season-model.json");
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const t0 = Date.now();

const PROJ = fs.readdirSync(DATA).filter((f) => /^projection-\d{4}-\d{2}\.json$/.test(f)).sort().at(-1);
const { params, wins } = read(path.join(DATA, PROJ));
const FIRST = "2016-17";
const CHECKS = [5, 10, 20, 30, 41, 55, 70];

// --- Careers (as fit-projection-model.mjs builds them) -----------------------
const SEASONS = fs.readdirSync(DATA).map((f) => f.match(/^regular-season-(\d{4}-\d{2})\.json$/)?.[1]).filter(Boolean).sort();
const rowsBy = {}, ctxBy = {};
for (const s of SEASONS) {
  rowsBy[s] = read(path.join(DATA, `regular-season-${s}.json`)).players.filter((r) => r.g > 0 && r.mp > 0);
  ctxBy[s] = leagueContext(rowsBy[s]);
}
const careers = new Map();
for (const s of SEASONS) for (const row of rowsBy[s]) {
  if (!row.slug) continue;
  if (!careers.has(row.slug)) careers.set(row.slug, []);
  careers.get(row.slug).push({ season: s, row, ctx: ctxBy[s] });
}

const baked = (s) => {
  const dir = path.join(GAMES, s);
  if (!fs.existsSync(path.join(dir, "index.json"))) return null;
  const index = read(path.join(dir, "index.json"));
  if (!index.complete) return null;
  const months = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => read(path.join(dir, f)));
  return gamesWithBoxes(index, months);
};

// The first night the median team had played n games.
function checkpointDates(games) {
  const dates = [...new Set(games.map((g) => g.date))].sort();
  const count = {};
  const out = {};
  let gi = 0;
  for (const d of dates) {
    while (gi < games.length && games[gi].date <= d) {
      for (const t of [games[gi].home.tri, games[gi].away.tri]) count[t] = (count[t] || 0) + 1;
      gi++;
    }
    const v = Object.values(count).sort((a, b) => a - b);
    const med = v[Math.floor(v.length / 2)] || 0;
    for (const n of CHECKS) if (!out[n] && med >= n) out[n] = d;
  }
  return out;
}

// --- Samples -----------------------------------------------------------------
const samples = []; // { n, prior, healthyG, ytd, rest, played, restTG, lgaPrev, lga }
const teamSeasons = []; // { mov, wp, g }
const marginResid = [];
for (const S of SEASONS.filter((s) => s >= FIRST)) {
  const games = baked(S);
  if (!games) continue;
  const prev = SEASONS[SEASONS.indexOf(S) - 1];
  // Names → slugs, from the season's own table; a shared name is left out.
  const slugOf = new Map();
  for (const r of rowsBy[S]) { const k = normalizeName(r.name); slugOf.set(k, slugOf.has(k) ? null : r.slug); }
  const final = new Map(playerTotals(games).map((r) => [normalizeName(r.name), r]));
  const finalRec = teamRecords(games);
  const priors = new Map();
  for (const [k] of final) {
    const slug = slugOf.get(k);
    const car = slug && careers.get(slug);
    const i = car ? car.findIndex((c) => c.season === S) : -1;
    if (i < 1) continue;
    const hist = car.slice(0, i);
    const missed = SEASONS.indexOf(S) - SEASONS.indexOf(hist.at(-1).season) - 1;
    const proj = projectPlayer(hist.slice(-TIME_HISTORY), hist.length, params, ctxBy[prev], missed);
    if (proj) priors.set(k, proj);
  }
  const dates = checkpointDates(games);
  for (const n of CHECKS) {
    const d = dates[n];
    if (!d) continue;
    const ytdBy = new Map(playerTotals(games, d).map((r) => [normalizeName(r.name), r]));
    const rec = teamRecords(games, d);
    for (const [k, fin] of final) {
      const proj = priors.get(k);
      if (!proj) continue;
      const ytd = ytdBy.get(k) || null;
      const team = ytd?.team || fin.teams[0];
      const played = rec[team]?.g || 0, restTG = (finalRec[team]?.g || 0) - played;
      const rest = Object.fromEntries(["g", "mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb", "fgm", "fga", "tpm", "tpa", "ftm", "fta"]
        .map((c) => [c, (fin[c] || 0) - (ytd?.[c] || 0)]));
      samples.push({ n, prior: proj.row, healthyG: proj.g, ytd, rest, played, restTG, lgaPrev: lgaForSeason(prev), lga: lgaForSeason(S) });
    }
  }
  // Teams: final winning percentage on margin per game, and each game's margin
  // around what the two teams' season margins say.
  const mov = Object.fromEntries(Object.entries(finalRec).map(([t, r]) => [t, (r.pf - r.pa) / r.g]));
  for (const [t, r] of Object.entries(finalRec)) teamSeasons.push({ mov: mov[t], wp: r.w / r.g, g: r.g });
  for (const g of games) {
    if (!(g.home.score > 0)) continue;
    marginResid.push((g.home.score - g.away.score) - (mov[g.home.tri] - mov[g.away.tri]) / 2);
  }
}
console.log(`${samples.length} player-checkpoints, ${teamSeasons.length} team-seasons, ${marginResid.length} games`);

// --- Grid searches -------------------------------------------------------------
function search(grid, errOf) {
  let best = null;
  const errs = grid.map((W) => { const e = errOf(W); if (!best || e < best.e) best = { W, e }; return e; });
  return { W: best.W, e: best.e, errs };
}
const G_RATE = [0, 50, 100, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000, 8000, 15000, 1e9];
const G_PCT = [0, 25, 50, 100, 150, 200, 300, 500, 800, 1200, 2000, 4000, 1e9];
const G_MPG = [0, 1, 2, 3, 4, 6, 8, 12, 16, 25, 40, 1e9];
const G_AVAIL = [0, 2, 4, 6, 8, 12, 16, 25, 40, 60, 100, 1e9];
const fg2 = (r) => ({ fg2m: (r.fgm || 0) - (r.tpm || 0), fg2a: (r.fga || 0) - (r.tpa || 0) });
for (const s of samples) { Object.assign(s.prior, fg2(s.prior)); if (s.ytd) Object.assign(s.ytd, fg2(s.ytd)); Object.assign(s.rest, fg2(s.rest)); }

const MIN_REST_MP = 100;
const rate = {}, pct = {}, report = {};
const skill = (r) => (r.errs.at(-1) > 0 ? round(1 - r.e / r.errs.at(-1), 3) : 0); // error cut vs. the preseason alone
for (const k of RATE_KEYS) {
  const xs = samples.filter((s) => s.ytd?.mp > 0 && s.rest.mp >= MIN_REST_MP && s.prior.mp > 0);
  const r = search(G_RATE, (W) => xs.reduce((e, s) => {
    const pred = (W * s.prior[k] / s.prior.mp + s.ytd[k]) / (W + s.ytd.mp);
    return e + s.rest.mp * (pred - s.rest[k] / s.rest.mp) ** 2;
  }, 0) / xs.reduce((w, s) => w + s.rest.mp, 0));
  rate[k] = r.W;
  report[k] = { W: r.W, vsPreseason: skill(r), vsSeasonOnly: round(1 - r.e / r.errs[0], 3) };
}
for (const { key, made, att } of PCT_KEYS) {
  const xs = samples.filter((s) => s.ytd?.[att] > 0 && s.rest[att] >= 20 && s.prior[att] > 0);
  const r = search(G_PCT, (W) => xs.reduce((e, s) => {
    const pred = (W * s.prior[made] / s.prior[att] + s.ytd[made]) / (W + s.ytd[att]);
    return e + s.rest[att] * (pred - s.rest[made] / s.rest[att]) ** 2;
  }, 0) / xs.reduce((w, s) => w + s.rest[att], 0));
  pct[key] = r.W;
  report[key] = { W: r.W, vsPreseason: skill(r), vsSeasonOnly: round(1 - r.e / r.errs[0], 3) };
}
const mpgFit = (() => {
  const xs = samples.filter((s) => s.ytd?.g > 0 && s.rest.g >= 5 && s.prior.g > 0);
  return search(G_MPG, (W) => xs.reduce((e, s) => {
    const pred = (W * s.prior.mp / s.prior.g + s.ytd.mp) / (W + s.ytd.g);
    return e + s.rest.g * (pred - s.rest.mp / s.rest.g) ** 2;
  }, 0) / xs.reduce((w, s) => w + s.rest.g, 0));
})();
const availFit = (() => {
  const xs = samples.filter((s) => s.restTG >= 10 && s.played > 0);
  return search(G_AVAIL, (W) => xs.reduce((e, s) => {
    const pred = Math.min(1, (W * Math.min(1, s.healthyG / 82) + (s.ytd?.g || 0)) / (W + s.played));
    return e + s.restTG * (pred - s.rest.g / s.restTG) ** 2;
  }, 0) / xs.reduce((w, s) => w + s.restTG, 0));
})();
// VA per minute, for how far a projection's miss still reaches (missShrink).
const vaFit = (() => {
  const xs = samples.filter((s) => s.ytd?.mp > 0 && s.rest.mp >= MIN_REST_MP && s.prior.mp > 0).map((s) => ({
    w: s.rest.mp, mp: s.ytd.mp,
    p0: valueAdd(s.prior, s.lgaPrev) / s.prior.mp,
    y: valueAdd(s.ytd, s.lga), r: valueAdd(s.rest, s.lga) / s.rest.mp,
  }));
  return search(G_RATE, (W) => xs.reduce((e, s) => e + s.w * ((W * s.p0 + s.y) / (W + s.mp) - s.r) ** 2, 0) / xs.reduce((w, s) => w + s.w, 0));
})();
report.mpg = { W: mpgFit.W, vsPreseason: skill(mpgFit), vsSeasonOnly: round(1 - mpgFit.e / mpgFit.errs[0], 3) };
report.avail = { W: availFit.W, vsPreseason: skill(availFit), vsSeasonOnly: round(1 - availFit.e / availFit.errs[0], 3) };
report.va = { W: vaFit.W, vsPreseason: skill(vaFit), vsSeasonOnly: round(1 - vaFit.e / vaFit.errs[0], 3) };

// --- The team weight -------------------------------------------------------------
const slope = teamSeasons.reduce((s, t) => s + t.mov * (t.wp - 0.5), 0) / teamSeasons.reduce((s, t) => s + t.mov * t.mov, 0);
const sigma = Math.sqrt(marginResid.reduce((s, x) => s + x * x, 0) / marginResid.length);
const luck = teamSeasons.reduce((s, t) => s + t.wp * (1 - t.wp), 0) / teamSeasons.length / 82;
const tau2 = Math.max(1e-4, (wins.rmseWins / 82) ** 2 - luck);
const teamW = (slope * sigma) ** 2 / tau2;

const model = {
  fittedAt: new Date().toISOString().slice(0, 10),
  projection: PROJ,
  seasons: SEASONS.filter((s) => s >= FIRST && fs.existsSync(path.join(GAMES, s, "index.json"))),
  checkpoints: CHECKS,
  samples: samples.length,
  rate, pct, mpg: mpgFit.W, avail: availFit.W, va: vaFit.W,
  team: { W: round(teamW, 1), slope: round(slope, 5), sigma: round(sigma, 2), priorSd: round(Math.sqrt(tau2) * 82, 2) },
  report,
};
// --- Validation ---------------------------------------------------------------------
// The update as the page runs it — every piece mixed on its own and the line
// rebuilt — against the preseason line and against mixing VA per minute
// directly, on VA per 36 over the rest of the season, by checkpoint. The
// composed line beats the direct mix: how a player's VA moves depends on which
// of its pieces moved, and the pieces don't all firm up at the same speed.
model.validation = {};
{
  const by = {};
  for (const s of samples) {
    if (!(s.ytd?.mp > 0) || s.rest.mp < MIN_REST_MP || !(s.prior.mp > 0)) continue;
    const u = updatePlayer({ prior: s.prior, healthyG: s.healthyG, ytd: s.ytd, team: { played: s.played } }, model);
    if (!(u.rest.mp > 0)) continue;
    const p0 = valueAdd(s.prior, s.lgaPrev) / s.prior.mp;
    const direct = (model.va * p0 + valueAdd(s.ytd, s.lga)) / (model.va + s.ytd.mp);
    const actual = valueAdd(s.rest, s.lga) / s.rest.mp;
    const composed = valueAdd(u.rest, s.lga) / u.rest.mp;
    const b = (by[s.n] ||= { w: 0, pre: 0, comp: 0, dir: 0 });
    b.w += s.rest.mp;
    b.pre += s.rest.mp * (p0 - actual) ** 2;
    b.comp += s.rest.mp * (composed - actual) ** 2;
    b.dir += s.rest.mp * (direct - actual) ** 2;
  }
  const r36 = (x, w) => round(36 * Math.sqrt(x / w), 3);
  for (const [n, b] of Object.entries(by)) model.validation[n] = { preseason: r36(b.pre, b.w), updated: r36(b.comp, b.w), directVa: r36(b.dir, b.w) };
}

fs.writeFileSync(OUT, JSON.stringify(model, null, 2) + "\n");
console.log(JSON.stringify(model, null, 2));
console.log(`wrote ${path.relative(ROOT, OUT)} in ${((Date.now() - t0) / 1000).toFixed(1)}s (${model.seasons.length} seasons)`);

