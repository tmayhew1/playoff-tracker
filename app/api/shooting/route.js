import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const revalidate = 86400;

const SEASON_RE = /^\d{4}-\d{2}$/;
const FILE_RE = /^shooting-(\d{4}-\d{2})\.json$/;

// No ?season=: list the seasons that have a baked shooting-<season>.json
// (basketball-reference has no shot-location data before 1996-97, and the
// bake may not have reached every season yet — this lets the UI only offer
// seasons that actually have data, same as useDefRatings()'s Object.keys()).
async function listSeasons() {
  const dir = join(process.cwd(), "app", "data");
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    files = [];
  }
  return files.map((f) => f.match(FILE_RE)?.[1]).filter(Boolean).sort();
}

// With ?season=: one season's baked shot-distance zone splits
// (basketball-reference's per-season Shooting page): { season, source,
//   fetchedAt, rs: { leagueAvg, players }, po: { leagueAvg, players } }
// Baked by scripts/R/fetch_shooting_splits.R. A season with no file (before
// 1996-97, or not baked yet) returns null rs/po — the app treats that as
// "hide the feature", same as an absent def-ratings entry.
export async function GET(req) {
  const season = new URL(req.url).searchParams.get("season") || "";
  if (!season) {
    const seasons = await listSeasons();
    return Response.json(
      { seasons },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
    );
  }
  if (!SEASON_RE.test(season)) {
    return Response.json({ error: "Bad ?season=YYYY-YY" }, { status: 400 });
  }
  try {
    const path = join(process.cwd(), "app", "data", `shooting-${season}.json`);
    const data = JSON.parse(await readFile(path, "utf8"));
    return Response.json(data, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    });
  } catch {
    return Response.json(
      { season, rs: null, po: null },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
    );
  }
}
