import { sortSlate } from "../../_lib/live-games";
import { unbakedGames } from "../../_lib/unbaked-games";
import { liveLines, gameFraction } from "../../../lib/live-lines";

export const runtime = "nodejs";
export const maxDuration = 15;

// The regular-season games the bake hasn't caught up to yet
// (/api/regular-season/live?season=2026-27&through=2026-10-22): every game
// on or after the day after `through` that has tipped (_lib/unbaked-games.js),
// with each one's box score as it stands. The board adds the lines onto its
// baked totals (lib/live-lines.js), a game in progress counting as the share
// of it played.

const SEASON_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const season = params.get("season");
  const through = params.get("through");
  if (!season || !SEASON_RE.test(season) || !through || !DATE_RE.test(through)) {
    return Response.json({ error: "season (2026-27) and through (YYYY-MM-DD) required" }, { status: 400 });
  }
  const { days, games: boxed, errors } = await unbakedGames(season, through);
  if (!days.length) {
    return Response.json({ season, through, days, games: [], lines: [], fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
  }

  const games = sortSlate(boxed.map(({ box, ...g }) => ({ ...g, frac: gameFraction(g), boxed: !!box })));
  const lines = liveLines(boxed);
  const anyLive = games.some((g) => g.gameStatus === 2);
  return Response.json(
    { season, through, days, games, lines, errors, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": anyLive || errors.length ? "public, s-maxage=20, stale-while-revalidate=40" : "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
