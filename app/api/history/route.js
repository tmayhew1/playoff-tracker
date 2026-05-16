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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "timeout" : e.message);
  } finally {
    clearTimeout(t);
  }
}

// Try several known schedule hosts; NBA shuffles which ones are reachable
// server-side. Returns the first that works, else throws with every attempt.
async function fetchSchedule(startYear) {
  const candidates = [
    `https://data.nba.com/data/10s/prod/v1/${startYear}/schedule.json`,
    `https://data.nba.com/prod/v1/${startYear}/schedule.json`,
    `https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_${startYear}.json`,
  ];
  const errors = [];
  for (const url of candidates) {
    try {
      const json = await fetchJson(url);
      return { json, url };
    } catch (e) {
      errors.push(`${url} -> ${e.message}`);
    }
  }
  throw new Error(`all schedule sources failed: ${errors.join(" | ")}`);
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
    const { json: data, url: usedUrl } = await fetchSchedule(startYear);

    // Normalize the two possible shapes into one game list.
    // A) data.nba.com: { league: { standard: [ { gameId, gameUrlCode,
    //    startTimeUTC, hTeam:{score}, vTeam:{score} } ] } }
    // B) scheduleLeagueV2: { leagueSchedule: { gameDates: [ { games: [
    //    { gameId, gameCode, gameDateTimeUTC, homeTeam:{teamTricode,score},
    //    awayTeam:{teamTricode,score} } ] } ] } }
    const raw = [];
    if (data?.league?.standard) {
      for (const g of data.league.standard) {
        const [datePart, codePart] = (g.gameUrlCode || "").split("/");
        raw.push({
          gameId: g.gameId || "",
          datePart,
          codePart,
          startTimeUTC: g.startTimeUTC || null,
          hTri: null,
          vTri: null,
          hScore: Number(g.hTeam?.score),
          vScore: Number(g.vTeam?.score),
        });
      }
    } else if (data?.leagueSchedule?.gameDates) {
      for (const gd of data.leagueSchedule.gameDates) {
        for (const g of gd.games || []) {
          const [datePart, codePart] = (g.gameCode || "").split("/");
          raw.push({
            gameId: g.gameId || "",
            datePart,
            codePart,
            startTimeUTC: g.gameDateTimeUTC || null,
            hTri: g.homeTeam?.teamTricode || null,
            vTri: g.awayTeam?.teamTricode || null,
            hScore: Number(g.homeTeam?.score),
            vScore: Number(g.awayTeam?.score),
          });
        }
      }
    } else {
      throw new Error(`unrecognized schedule shape from ${usedUrl}`);
    }

    const all = [];
    for (const g of raw) {
      // gameId "004…" = main playoff bracket (excludes Play-In "005…",
      // regular season "002…", preseason "001…").
      if (!g.gameId.startsWith("004")) continue;
      if (!g.datePart) continue;
      const away = g.vTri || (g.codePart?.length === 6 ? g.codePart.slice(0, 3) : null);
      const home = g.hTri || (g.codePart?.length === 6 ? g.codePart.slice(3, 6) : null);
      if (!away || !home) continue;
      if (!Number.isFinite(g.hScore) || !Number.isFinite(g.vScore) || (g.hScore === 0 && g.vScore === 0)) continue;
      all.push({
        gameId: g.gameId,
        gameCode: g.datePart,
        startTimeUTC: g.startTimeUTC,
        date: g.datePart,
        home: { tri: home, score: g.hScore, win: g.hScore > g.vScore },
        away: { tri: away, score: g.vScore, win: g.vScore > g.hScore },
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
