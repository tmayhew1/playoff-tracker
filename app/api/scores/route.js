export const runtime = "nodejs";
export const maxDuration = 15;
export const revalidate = 30;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

async function fetchJson(url, timeoutMs = 5000) {
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

const TRICODE_MAP = {
  SAS: "SAS", DEN: "DEN", CLE: "CLE", HOU: "HOU", NYK: "NYK",
  ORL: "ORL", PHI: "PHI", PHX: "PHX", OKC: "OKC", BOS: "BOS",
  MIN: "MIN", DET: "DET", ATL: "ATL", LAL: "LAL", TOR: "TOR", POR: "POR",
};

const SERIES_MATCHUPS = {
  E1: ["DET", "ORL"], E4: ["CLE", "TOR"], E3: ["NYK", "ATL"], E2: ["BOS", "PHI"],
  W1: ["OKC", "PHX"], W4: ["LAL", "HOU"], W3: ["DEN", "MIN"], W2: ["SAS", "POR"],
};

function findSeriesId(tri1, tri2) {
  for (const [id, teams] of Object.entries(SERIES_MATCHUPS)) {
    if ((teams[0] === tri1 && teams[1] === tri2) || (teams[0] === tri2 && teams[1] === tri1)) return id;
  }
  return null;
}

export async function GET() {
  const gameWins = {};
  const errors = [];
  for (const [id, [a, b]] of Object.entries(SERIES_MATCHUPS)) {
    gameWins[id] = { [a]: 0, [b]: 0 };
  }

  // --- 1. Pull the full season schedule (includes every playoff game) ---
  let scheduleGames = [];
  try {
    const url = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json";
    const data = await fetchJson(url, 6000);
    const gameDates = data?.leagueSchedule?.gameDates || [];
    for (const gd of gameDates) {
      for (const g of gd.games || []) {
        const hasSeries = g.seriesText || g.seriesGameNumber > 0;
        if (!hasSeries) continue;
        const home = g.homeTeam?.teamTricode;
        const away = g.awayTeam?.teamTricode;
        const sid = findSeriesId(home, away);
        if (!sid) continue;
        const homeScore = g.homeTeam?.score ?? 0;
        const awayScore = g.awayTeam?.score ?? 0;

        // Pull national TV + national streaming only (skip radio & local markets)
        const bc = g.broadcasters || {};
        const natTv = (bc.nationalBroadcasters || []).map((b) => b.broadcasterDisplay).filter(Boolean);
        const natOtt = (bc.nationalOttBroadcasters || []).map((b) => b.broadcasterDisplay).filter(Boolean);
        const broadcasters = [...new Set([...natTv, ...natOtt])];

        scheduleGames.push({
          seriesId: sid,
          gameId: g.gameId,
          gameStatus: g.gameStatus, // 1=scheduled, 2=in-progress, 3=final
          gameStatusText: g.gameStatusText,
          gameDateTimeUTC: g.gameDateTimeUTC,
          home: { tri: home, score: homeScore },
          away: { tri: away, score: awayScore },
          broadcasters,
        });
      }
    }
  } catch (e) {
    errors.push(`schedule: ${e.message}`);
  }

  // --- 2. Pull today's live scoreboard for in-progress scores (overrides schedule) ---
  let liveToday = [];
  try {
    const url = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";
    const data = await fetchJson(url, 4500);
    const games = data?.scoreboard?.games || [];
    for (const g of games) {
      const home = g.homeTeam?.teamTricode;
      const away = g.awayTeam?.teamTricode;
      const sid = findSeriesId(home, away);
      if (!sid) continue;
      liveToday.push({
        seriesId: sid,
        gameId: g.gameId,
        gameStatus: g.gameStatus,
        gameStatusText: g.gameStatusText,
        period: g.period,
        gameClock: g.gameClock,
        home: { tri: home, score: g.homeTeam?.score ?? 0 },
        away: { tri: away, score: g.awayTeam?.score ?? 0 },
      });
    }
  } catch (e) {
    errors.push(`scoreboard: ${e.message}`);
  }

  // --- 3. Merge: schedule provides history + broadcasters, scoreboard overrides today's live data ---
  const liveById = new Map(liveToday.map((g) => [g.gameId, g]));

  const liveGames = scheduleGames.map((g) => {
    const live = liveById.get(g.gameId);
    if (!live) return g;
    // Merge: live data wins for scores/status, but keep schedule's date + broadcasters
    return {
      ...live,
      gameDateTimeUTC: g.gameDateTimeUTC,
      broadcasters: g.broadcasters,
    };
  });

  // Also include any live games that weren't in the schedule yet
  for (const lg of liveToday) {
    if (!liveGames.some((g) => g.gameId === lg.gameId)) {
      liveGames.push(lg);
    }
  }

  // --- 4. Derive gameWins from finalized games in the schedule ---
  const finals = liveGames.filter(
    (g) => g.gameStatus === 3 && g.home.score !== g.away.score
  );
  for (const f of finals) {
    const winnerTri = f.home.score > f.away.score ? f.home.tri : f.away.tri;
    const code = TRICODE_MAP[winnerTri];
    if (code && gameWins[f.seriesId]) {
      gameWins[f.seriesId][code] = (gameWins[f.seriesId][code] || 0) + 1;
    }
  }

  return new Response(JSON.stringify({ gameWins, liveGames, errors, fetchedAt: new Date().toISOString() }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
