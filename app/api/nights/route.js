import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { LEAGUE_AVERAGES, lgaForSeason, valueAddParts } from "../../scoring";

export const runtime = "nodejs";

// One night of NBA games, every player line scored and ranked by Value Added
// (/api/nights?date=YYYY-MM-DD, or the latest baked night without one).
// Lines come from app/data/nights/<date>.json, baked each morning by
// scripts/bake-nights.mjs. `usg=1` scores against the USG-ADJUSTED baseline.
//
// Each line is scored against its own season's baseline — the playoff blend
// for a playoff game — and set beside the player's season VA per game to
// date, so a big night reads against his norm as well as the league's. On the
// first nights of a season, before its baselines are baked, the previous
// season's stand in and the response says so.

// NIGHTS_DIR lets the tests point it at fixtures.
const DIR = process.env.NIGHTS_DIR || join(process.cwd(), "app", "data", "nights");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const readJson = (path) => readFile(path, "utf8").then(JSON.parse).catch(() => null);

const prevSeason = (s) => {
  const y = Number(s.slice(0, 4)) - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const usgAdj = params.get("usg") === "1";
  let dates = [];
  try {
    dates = (await readdir(DIR)).map((f) => f.replace(/\.json$/, "")).filter((d) => DATE_RE.test(d)).sort();
  } catch {
    // no nights baked yet
  }
  if (!dates.length) return Response.json({ date: null, dates: [] });
  const asked = params.get("date");
  const date = DATE_RE.test(asked || "") && dates.includes(asked) ? asked : dates[dates.length - 1];
  const night = await readJson(join(DIR, `${date}.json`));
  if (!night) return Response.json({ error: "unreadable night" }, { status: 500 });

  const season = night.season;
  const baselineSeason = LEAGUE_AVERAGES[season] ? season : prevSeason(season);
  const lgaFor = (kind) => lgaForSeason(baselineSeason, usgAdj, kind === "playoffs" ? "po" : "rs");

  // Season VA per game to date, by slug, for the "vs his average" column.
  const rs = await readJson(join(process.cwd(), "app", "data", `regular-season-${season}.json`));
  const avg = new Map();
  if (rs && LEAGUE_AVERAGES[season]) {
    const lga = lgaForSeason(season, usgAdj);
    for (const r of rs.players || []) if (r.g > 0 && r.mp > 0) avg.set(r.slug, valueAddParts(r, lga).va / r.g);
  }

  const kindOf = Object.fromEntries(night.games.map((g) => [g.gameId, g.kind]));
  const won = Object.fromEntries(night.games.flatMap((g) => {
    const homeWon = g.home.score > g.away.score;
    return [[`${g.gameId}:${g.home.tri}`, homeWon], [`${g.gameId}:${g.away.tri}`, !homeWon]];
  }));
  const lines = night.players.map((p) => {
    const { va, efficiency } = valueAddParts(p, lgaFor(kindOf[p.gameId]));
    return {
      ...p,
      reb: (p.drb || 0) + (p.orb || 0),
      won: !!won[`${p.gameId}:${p.team}`],
      va,
      eff: efficiency,
      seasonVaPerG: p.slug && avg.has(p.slug) ? avg.get(p.slug) : null,
    };
  }).sort((a, b) => b.va - a.va);

  const i = dates.indexOf(date);
  return Response.json(
    {
      date, season, baselineSeason, usgAdj,
      prev: i > 0 ? dates[i - 1] : null,
      next: i < dates.length - 1 ? dates[i + 1] : null,
      latest: dates[dates.length - 1],
      games: night.games,
      lines,
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}
