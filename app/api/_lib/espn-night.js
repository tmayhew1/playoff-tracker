import { fetchEspn, fetchEspnBox } from "./espn-box";
import { parseEspnScoreboard } from "./live-games";
import { normName } from "./player-slugs";

// One night of games read off ESPN, in the shape of
// app/data/nights/<date>.json. scripts/bake-nights.mjs writes those files
// with it each morning (readEspnNight), and /api/nights serves it live for
// yesterday from midnight Pacific until that bake is deployed (espnNight),
// so About Last Night is on the new night as soon as the day turns over on
// the West Coast.
//
// Only a night whose every counted game is final comes back; a game still
// on gives a reason to skip, and any box score ESPN fails to give throws.

// The stages the bake counts (bake-nights.mjs KINDS), by the names
// parseEspnScoreboard gives ESPN's season types. Preseason and the All-Star
// game don't count.
const KINDS = { regular: "regular", playoffs: "playoffs", playin: "play-in" };

const scoreboardUrl = (date) =>
  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replaceAll("-", "")}`;

// `slugs`: slugsByName over the season's regular-season players.
// { night } when every counted game is final, { skip: why } otherwise.
export async function readEspnNight(date, season, slugs) {
  const slate = parseEspnScoreboard(await fetchEspn(scoreboardUrl(date)));
  if (!slate) throw new Error(`${date}: no scoreboard from ESPN`);
  const games = slate.games.filter((g) => KINDS[g.kind]);
  if (!games.length) return { skip: "no games" };
  const unfinished = games.filter((g) => g.gameStatus !== 3).length;
  if (unfinished) return { skip: `${unfinished} of ${games.length} games not final yet` };

  const boxes = await Promise.all(games.map((g) => fetchEspnBox(g.gameId)));
  const outGames = [], players = [];
  games.forEach((g, i) => {
    // The box's two sides, matched to the scoreboard's by tricode: the box
    // carries no scores and its order isn't promised to be away, home.
    const sides = [boxes[i].home, boxes[i].away];
    const side = (tri) => sides.find((s) => s.tri === tri);
    const home = side(g.home.tri), away = side(g.away.tri);
    if (!home || !away) throw new Error(`${g.gameId}: box teams don't match the scoreboard`);
    outGames.push({
      gameId: g.gameId, kind: KINDS[g.kind],
      home: { tri: g.home.tri, score: g.home.score },
      away: { tri: g.away.tri, score: g.away.score },
    });
    for (const [team, opp] of [[home, away], [away, home]]) {
      for (const p of team.players) {
        if (!(p.mp > 0)) continue;
        const { oncourt, ...line } = p;
        players.push({ id: null, ...line, slug: slugs.get(normName(p.name)) || null, team: team.tri, opp: opp.tri, gameId: g.gameId });
      }
    }
  });
  return { night: { date, season, games: outGames, players, source: "espn", fetchedAt: new Date().toISOString() } };
}

// The night, or null for any reason it can't be had yet.
export async function espnNight(date, season, slugs) {
  return (await readEspnNight(date, season, slugs)).night || null;
}
