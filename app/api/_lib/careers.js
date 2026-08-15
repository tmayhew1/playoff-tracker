import fs from "node:fs";
import path from "node:path";
import { gameLeverage, rsCLI } from "../../lib/leverage.js";
import { normalizePosition, modalPosition } from "../../lib/positions.js";
import { valueAddParts, lgaForSeason, baselineCoverage } from "../../scoring.js";

// The player-identity join behind the Legacy board: every baked season folded
// into one career per player, carrying each playoff game's VA alongside the
// championship leverage of the state it was played in, plus that season's
// regular-season VA total.
//
// This lives here rather than in scripts/legacy-report.mjs because the CLI
// report and /api/legacy must rank the same careers — two copies of a join
// this fiddly would drift on the first schema change. The script imports it.
//
// Identity resolves on basketball-reference slug, falling back to a normalized
// name, the same way /api/players does.

// Mirrors normalizeName in app/lib/format.js closely enough for the fallback
// join; slugs cover all but a handful of rows.
const norm = (s) => (s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z ]/g, "").trim();

// The raw stat line, carried alongside the VA so a run can be shown as the
// production it was computed from rather than as a bare score.
const STAT_KEYS = ["mp", "pts", "reb", "ast", "stl", "blk", "tov",
  "fgm", "fga", "tpm", "tpa", "ftm", "fta", "drb", "orb"];

const emptyLine = () => Object.fromEntries([["gp", 0], ...STAT_KEYS.map((k) => [k, 0])]);

function addLine(into, from) {
  into.gp += from.gp || 0;
  for (const k of STAT_KEYS) into[k] += from[k] || 0;
  return into;
}

export function defaultDataDir() {
  return path.join(process.cwd(), "app", "data");
}

// The join is ~4s over ~65MB of JSON and the files are static between bakes, so
// it is built once per server process. Shared here rather than in a route so
// that /api/legacy and /api/legacy/runs pay for it once between them.
let CACHE = null;

export function cachedCareers() {
  if (!CACHE) CACHE = buildCareers();
  return CACHE;
}

export function clearCareerCache() {
  CACHE = null;
}

export function buildCareers({ dataDir = defaultDataDir() } = {}) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
  const exists = (f) => fs.existsSync(path.join(dataDir, f));

  const seasons = fs.readdirSync(dataDir)
    .filter((f) => /^leaderboard-\d{4}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(12, -5)).sort();

  const bySlug = new Map();
  const byName = new Map();
  const keyOf = (slug, name) => {
    if (slug && bySlug.has(slug)) return bySlug.get(slug);
    const n = norm(name);
    if (!slug && byName.has(n)) return byName.get(n);
    const rec = { slug: slug || n, name, teams: new Set(), seasons: new Map() };
    if (slug) bySlug.set(slug, rec);
    if (!byName.has(n)) byName.set(n, rec);
    return rec;
  };

  const depths = new Map();

  const skipped = [];
  for (const season of seasons) {
    // Spec §9.5: never score against a baseline that zero-fills a category.
    // Nothing on disk trips this today; it is the backfill's tripwire.
    const cov = baselineCoverage(lgaForSeason(season));
    if (!cov.complete) { skipped.push({ season, missing: cov.missing }); continue; }
    const hist = read(`history-${season}.json`);
    const lev = gameLeverage(hist.series);
    depths.set(season, lev.shape.depth);
    const seasonCLI = rsCLI(season, lev.shape.depth);
    const anchor = lev.shape.anchor;
    const depth = lev.shape.depth;
    // How long each series actually ran. Series pricing divides a stake by the
    // games the SERIES took, so this is the team's count, not the player's.
    const seriesGames = hist.series.map((s) => (s.games || []).length);

    // Playoffs: per-game VA is already baked, so leverage only reweights it.
    const lb = read(`leaderboard-${season}.json`);
    for (const p of lb.players) {
      const rec = keyOf(p.slug, p.name);
      rec.name = p.name;
      rec.teams.add(p.team);
      const row = rec.seasons.get(season)
        || { season, team: p.team, games: [], rsVA: null, rsGames: 0, rsCLI: seasonCLI, anchor, depth };
      row.po = addLine(row.po || emptyLine(), p);
      for (const g of p.games || []) {
        if (g.va == null) continue;
        const e = lev.map.get(`${g.gameId}|${p.team}`);
        row.games.push({
          gameId: g.gameId, va: g.va, cli: e?.cli ?? 0,
          round: e?.round, a: e?.a, b: e?.b, bestOf: e?.bestOf,
          seriesIdx: e?.seriesIdx, roundsAfter: e?.roundsAfter,
          seriesGames: e?.seriesIdx != null ? seriesGames[e.seriesIdx] : 0,
          // Enough to identify the game on screen without a second lookup.
          opp: g.opp, seriesGameNumber: g.seriesGameNumber,
          line: Object.fromEntries(STAT_KEYS.map((k) => [k, g[k] ?? 0])),
        });
      }
      rec.seasons.set(season, row);
    }

    // Regular season: totals only, so VA is computed here against that
    // season's own baselines (spec §9.2 — the same baselines the playoff
    // numbers already use).
    if (!exists(`regular-season-${season}.json`)) continue;
    const lga = lgaForSeason(season);
    for (const p of read(`regular-season-${season}.json`).players) {
      const rec = keyOf(p.slug, p.name);
      rec.name = p.name;
      if (p.team && !/^(TOT|\dTM)$/.test(p.team)) rec.teams.add(p.team);
      const row = rec.seasons.get(season)
        || { season, team: p.team, games: [], rsVA: null, rsGames: 0, rsCLI: seasonCLI, anchor, depth };
      row.rsVA = valueAddParts(p, lga).va;
      row.rsGames = p.g || 0;
      // The line behind that VA, so a season can be opened up the same way a
      // playoff run can. Assigned rather than accumulated, to stay consistent
      // with rsVA above: where a traded player has several rows, both take the
      // last one rather than double-counting a TOT row against its parts.
      row.rs = { gp: p.g || 0, ...Object.fromEntries(STAT_KEYS.map((k) => [k, p[k] ?? 0])) };
      // Assigned for the same reason as rsVA above rather than accumulated:
      // where a traded player has several rows, the TOT row's minutes already
      // cover the parts, and adding them would weight that season twice in the
      // career position below. Null until the season file has been re-baked
      // with positions — absent, not "unlisted".
      row.pos = normalizePosition(p.pos);
      rec.seasons.set(season, row);
    }
  }

  const scored = seasons.filter((s) => !skipped.some((k) => k.season === s));
  const earliest = scored[0];
  // One position per career, weighted by the minutes behind it. Built from the
  // regular-season rows because those are the only ones carrying a position at
  // all — the playoff files have no such column, and a run is a few games
  // against a career's tens of thousands of minutes either way.
  const careerPosition = (r) => {
    const minutes = new Map();
    for (const s of r.seasons.values()) {
      if (!s.pos) continue;
      minutes.set(s.pos, (minutes.get(s.pos) || 0) + (s.rs?.mp || 0));
    }
    return modalPosition(minutes);
  };

  const players = [...new Set([...bySlug.values(), ...byName.values()])].map((r) => ({
    slug: r.slug,
    name: r.name,
    teams: [...r.teams],
    pos: careerPosition(r),
    // A career that was already running when the corpus starts is measured
    // short. Flagged, never silently ranked as complete.
    truncated: r.seasons.has(earliest),
    seasons: [...r.seasons.values()],
  }));

  return { players, seasons: scored, depths, skipped };
}
