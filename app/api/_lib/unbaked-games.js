import { addDays, parseEspnScoreboard, seasonOf } from "./live-games";
import { espnBoxUrls, fetchEspn, parseBox } from "./espn-box";

// The regular-season games the bake hasn't caught up to: every game on or
// after the day after `through` that has tipped, read off ESPN's scoreboard a
// day at a time, each with its box score as it stands ({ home, away }, each
// { tri, players }, or null when ESPN had none). Shared by
// /api/regular-season/live (the board, games in progress and all) and
// /api/projections (`finalOnly`: the Look Ahead takes whole games only).
//
// `through` is the last day the caller's own totals cover, so a game is never
// counted twice, however stale either cache is.

// A bake that has stalled longer than this is past topping up live.
const MAX_DAYS = 7;

export const todayEt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const dayUrl = (d) => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d.replaceAll("-", "")}`;

export async function unbakedGames(season, through, { finalOnly = false } = {}) {
  const today = todayEt();
  const days = [];
  for (let d = addDays(through, 1); d <= today && days.length < MAX_DAYS; d = addDays(d, 1)) {
    if (seasonOf(d) === season) days.push(d);
  }
  const errors = [];
  if (!days.length) return { days, games: [], errors };
  const slates = await Promise.all(days.map((d) =>
    fetchEspn(dayUrl(d), 5000)
      .then((data) => (parseEspnScoreboard(data)?.games || []).map((g) => ({ ...g, date: d })))
      .catch((e) => { errors.push(`${d}: ${e.message}`); return []; })));
  const slate = slates.flat().filter((g) => g.kind === "regular");
  const started = slate.filter((g) => (finalOnly ? g.gameStatus === 3 : g.gameStatus !== 1));

  // The site summary carries a game in progress; the CDN core is the
  // fallback, as for any ESPN box.
  const games = await Promise.all(started.map(async (g) => {
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
  // Days with a game still to finish, for a caller that only took the finals.
  const pending = [...new Set(slate.filter((g) => g.gameStatus !== 3).map((g) => g.date))];
  return { days, games, errors, pending };
}
