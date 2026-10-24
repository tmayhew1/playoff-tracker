import { addDays, parseEspnScoreboard, seasonOf, sortSlate } from "../../_lib/live-games";
import { espnBoxUrls, fetchEspn, parseBox } from "../../_lib/espn-box";
import { liveLines, gameFraction } from "../../../lib/live-lines";

export const runtime = "nodejs";
export const maxDuration = 15;

// The regular-season games the bake hasn't caught up to yet
// (/api/regular-season/live?season=2026-27&through=2026-10-22): every game
// on or after the day after `through` that has tipped, read off ESPN's
// scoreboard a day at a time, with each one's box score as it stands. The
// board adds the lines onto its baked totals (lib/live-lines.js), a game in
// progress counting as the share of it played.
//
// `through` is the last day the caller's own totals cover — its copy of
// /api/regular-season's — so a game is never counted twice, however stale
// either cache is.

const SEASON_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A bake that has stalled longer than this is past topping up live.
const MAX_DAYS = 7;

const todayEt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const dayUrl = (d) => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d.replaceAll("-", "")}`;

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const season = params.get("season");
  const through = params.get("through");
  if (!season || !SEASON_RE.test(season) || !through || !DATE_RE.test(through)) {
    return Response.json({ error: "season (2026-27) and through (YYYY-MM-DD) required" }, { status: 400 });
  }
  const today = todayEt();
  const days = [];
  for (let d = addDays(through, 1); d <= today && days.length < MAX_DAYS; d = addDays(d, 1)) {
    if (seasonOf(d) === season) days.push(d);
  }
  if (!days.length) {
    return Response.json({ season, through, days, games: [], lines: [], fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
  }

  const errors = [];
  const slates = await Promise.all(days.map((d) =>
    fetchEspn(dayUrl(d), 5000)
      .then((data) => (parseEspnScoreboard(data)?.games || []).map((g) => ({ ...g, date: d })))
      .catch((e) => { errors.push(`${d}: ${e.message}`); return []; })));
  const started = slates.flat().filter((g) => g.kind === "regular" && g.gameStatus !== 1);

  // The site summary carries a game in progress; the CDN core is the
  // fallback, as for any ESPN box.
  const boxed = await Promise.all(started.map(async (g) => {
    let why = "no box score players";
    for (const url of espnBoxUrls(g.gameId)) {
      try {
        const data = await fetchEspn(url, 5000);
        const parsed = parseBox(data?.boxscore ? data : { boxscore: data?.gamepackageJSON?.boxscore || null });
        if (parsed) {
          const sides = { [parsed.a.tri]: parsed.a, [parsed.b.tri]: parsed.b };
          return { ...g, box: { home: sides[g.home.tri] || parsed.b, away: sides[g.away.tri] || parsed.a } };
        }
      } catch (e) {
        why = e.message;
      }
    }
    errors.push(`${g.gameId}: ${why}`);
    return { ...g, box: null };
  }));

  const games = sortSlate(boxed.map(({ box, ...g }) => ({ ...g, frac: gameFraction(g), boxed: !!box })));
  const lines = liveLines(boxed);
  const anyLive = games.some((g) => g.gameStatus === 2);
  return Response.json(
    { season, through, days, games, lines, errors, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": anyLive || errors.length ? "public, s-maxage=20, stale-while-revalidate=40" : "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
