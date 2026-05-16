export const runtime = "nodejs";
export const maxDuration = 15;
// History never changes; let the platform cache aggressively.
export const revalidate = 86400;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const SEASON_RE = /^\d{4}-\d{2}$/;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const season = searchParams.get("season");
  if (!season || !SEASON_RE.test(season)) {
    return new Response(JSON.stringify({ error: "valid season required (e.g. 2024-25)" }), { status: 400 });
  }

  try {
    const url =
      `https://stats.nba.com/stats/leaguegamelog?Counter=1000&Direction=ASC` +
      `&LeagueID=00&PlayerOrTeam=T&Season=${season}&SeasonType=Playoffs&Sorter=DATE`;
    const data = await fetchJson(url);
    const set = (data.resultSets || []).find((r) => r.name === "LeagueGameLog") || data.resultSets?.[0];
    if (!set) throw new Error("no LeagueGameLog");
    const col = {};
    set.headers.forEach((h, i) => (col[h] = i));

    // Two rows per game (one per team) -> one merged game record.
    const games = new Map();
    for (const row of set.rowSet) {
      const gameId = row[col.GAME_ID];
      const tri = row[col.TEAM_ABBREVIATION];
      const matchup = row[col.MATCHUP]; // "CLE vs. MIA" home | "MIA @ CLE" away
      const pts = row[col.PTS];
      const win = row[col.WL] === "W";
      const date = row[col.GAME_DATE];
      const g = games.get(gameId) || { gameId, date, home: null, away: null };
      const side = matchup.includes(" vs. ") ? "home" : "away";
      g[side] = { tri, score: pts, win };
      games.set(gameId, g);
    }

    const all = [...games.values()]
      .filter((g) => g.home && g.away)
      .sort((a, b) => new Date(a.date) - new Date(b.date) || a.gameId.localeCompare(b.gameId));

    // Cluster by team pair; order series by start; standard 8/4/2/1 bracket.
    const byPair = new Map();
    for (const g of all) {
      const key = [g.home.tri, g.away.tri].sort().join("-");
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push(g);
    }
    const seriesList = [...byPair.values()]
      .map((gs) => ({ games: gs, start: new Date(gs[0].date) }))
      .sort((a, b) => a.start - b.start);
    const roundForIndex = (i) => (i < 8 ? "r1" : i < 12 ? "r2" : i < 14 ? "r3" : "r4");

    const series = seriesList.map((s, i) => {
      const wins = {};
      for (const g of s.games) {
        const w = g.home.win ? g.home.tri : g.away.tri;
        wins[w] = (wins[w] || 0) + 1;
      }
      const winner = Object.entries(wins).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      return {
        round: roundForIndex(i),
        teams: [s.games[0].home.tri, s.games[0].away.tri],
        winner,
        games: s.games.map((g) => ({
          gameId: g.gameId,
          gameDateTimeUTC: new Date(g.date).toISOString(),
          home: { tri: g.home.tri, score: g.home.score },
          away: { tri: g.away.tri, score: g.away.score },
        })),
      };
    });

    return new Response(JSON.stringify({ season, series, fetchedAt: new Date().toISOString() }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
