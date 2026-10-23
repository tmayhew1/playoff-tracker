import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { LEAGUE_AVERAGES, lgaForSeason, valueAddParts } from "../../scoring";
import { espnNight } from "../_lib/espn-night";
import { addDays, seasonOf } from "../_lib/live-games";
import { slugsByName } from "../_lib/player-slugs";

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
//
// "Last night" turns over at midnight Pacific, when the West Coast's day ends.
// The daily job doesn't bake that night until about 7am ET, so until its file
// is deployed, yesterday is read live off ESPN (_lib/espn-night.js) and the
// answer carries `source: "espn"`. Should ESPN fail, or a game still be on,
// the last baked night stands in.

// NIGHTS_DIR lets the tests point it at fixtures.
const DIR = process.env.NIGHTS_DIR || join(process.cwd(), "app", "data", "nights");
const MIN_MP = 12;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const readJson = (path) => readFile(path, "utf8").then(JSON.parse).catch(() => null);

// Today's date on the Pacific clock, and the seconds left in it.
const PT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
function pacificToday(now = new Date()) {
  const t = Object.fromEntries(PT.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${t.year}-${t.month}-${t.day}`, secondsLeft: 86400 - (t.hour * 3600 + t.minute * 60 + Number(t.second)) };
}

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
  const asked = params.get("date");
  const today = pacificToday();
  const yesterday = addDays(today.date, -1);
  // Yesterday not baked yet: ESPN fills it in, for the asks that show it or
  // step to it (no date, yesterday's, the last baked night's "next").
  const early = !dates.length || dates[dates.length - 1] < yesterday;
  const checked = early && (!asked || asked === yesterday || asked === dates[dates.length - 1]);
  let live = null;
  if (checked) {
    const ySeason = seasonOf(yesterday);
    const rs = await readJson(join(process.cwd(), "app", "data", `regular-season-${ySeason}.json`));
    live = await espnNight(yesterday, ySeason, slugsByName(rs?.players)).catch(() => null);
    if (live) dates.push(yesterday);
  }
  if (!dates.length) return Response.json({ date: null, dates: [] });
  const date = DATE_RE.test(asked || "") && dates.includes(asked) ? asked : dates[dates.length - 1];
  const night = date === live?.date ? live : await readJson(join(DIR, `${date}.json`));
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
  // Only lines of 12+ minutes qualify: a two-minute cameo can't lead the night.
  const lines = night.players.filter((p) => (p.mp || 0) >= MIN_MP).map((p) => {
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

  // The cache can't outlive what the answer depends on. An answer that asked
  // ESPN is asked again every few minutes until the bake's deploy changes
  // every URL; the latest night (and its `next`) holds until midnight
  // Pacific; any other baked night is fixed for the build.
  const i = dates.indexOf(date);
  const ttl = checked ? 300
    : i === dates.length - 1 ? Math.max(60, Math.min(86400, today.secondsLeft))
    : 86400;
  return Response.json(
    {
      date, season, baselineSeason, usgAdj, source: night.source || "cdn.nba.com",
      prev: i > 0 ? dates[i - 1] : null,
      next: i < dates.length - 1 ? dates[i + 1] : null,
      latest: dates[dates.length - 1],
      games: night.games,
      lines,
    },
    { headers: { "Cache-Control": `public, max-age=${Math.min(3600, ttl)}, s-maxage=${ttl}` } },
  );
}
