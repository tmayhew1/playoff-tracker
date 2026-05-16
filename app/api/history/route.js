export const runtime = "nodejs";
export const maxDuration = 15;
// History never changes; let the platform cache aggressively.
export const revalidate = 86400;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
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
  const startYear = season.slice(0, 4); // "2024-25" -> "2024"

  try {
    // data.nba.com is CDN-backed and reachable server-side (unlike stats.nba.com).
    const url = `https://data.nba.com/prod/v1/${startYear}/schedule.json`;
    const data = await fetchJson(url);
    const standard = data?.league?.standard || [];

    const all = [];
    for (const g of standard) {
      const gameId = g.gameId || "";
      // seasonStageId 4 = postseason; gameId "004…" = main bracket (excludes
      // Play-In "005…", regular season "002…", preseason "001…").
      if (g.seasonStageId !== 4 || !gameId.startsWith("004")) continue;
      // gameUrlCode: "YYYYMMDD/AWAYHOME" e.g. "20250420/MIACLE"
      const [datePart, codePart] = (g.gameUrlCode || "").split("/");
      if (!datePart || !codePart || codePart.length !== 6) continue;
      const away = codePart.slice(0, 3);
      const home = codePart.slice(3, 6);
      const hScore = Number(g.hTeam?.score);
      const vScore = Number(g.vTeam?.score);
      if (!Number.isFinite(hScore) || !Number.isFinite(vScore)) continue;
      all.push({
        gameId,
        gameCode: datePart,
        startTimeUTC: g.startTimeUTC || null,
        date: datePart,
        home: { tri: home, score: hScore, win: hScore > vScore },
        away: { tri: away, score: vScore, win: vScore > hScore },
      });
    }

    all.sort((a, b) => a.date.localeCompare(b.date) || a.gameId.localeCompare(b.gameId));

    // Cluster by team pair; order series by start; standard 8/4/2/1 bracket.
    const byPair = new Map();
    for (const g of all) {
      const key = [g.home.tri, g.away.tri].sort().join("-");
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push(g);
    }
    const seriesList = [...byPair.values()]
      .map((gs) => ({ games: gs, start: gs[0].date }))
      .sort((a, b) => a.start.localeCompare(b.start));
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
          gameCode: g.gameCode,
          gameDateTimeUTC: g.startTimeUTC,
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
