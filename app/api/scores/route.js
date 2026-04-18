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

  // Try primary source: playoff series summary (sometimes blocks edge/serverless)
  let gotSeriesData = false;
  try {
    const url = "https://stats.nba.com/stats/playoffseriesbyround?LeagueID=00&Season=2025-26&RoundNumber=1";
    const data = await fetchJson(url, 4500);
    const rs = data.resultSets?.[0];
    if (rs) {
      const cols = rs.headers;
      const idx = (n) => cols.indexOf(n);
      const highTri = idx("HIGH_SEED_TEAM_TRICODE");
      const lowTri = idx("LOW_SEED_TEAM_TRICODE");
      const highWins = idx("HIGH_SEED_WINS");
      const lowWins = idx("LOW_SEED_WINS");
      for (const row of rs.rowSet) {
        const hTri = row[highTri], lTri = row[lowTri];
        const sid = findSeriesId(hTri, lTri);
        if (sid && TRICODE_MAP[hTri] && TRICODE_MAP[lTri]) {
          gameWins[sid] = { [TRICODE_MAP[hTri]]: row[highWins] ?? 0, [TRICODE_MAP[lTri]]: row[lowWins] ?? 0 };
          gotSeriesData = true;
        }
      }
    }
  } catch (e) {
    errors.push(`series: ${e.message}`);
  }

  // Pull today's games (lightweight CDN, very reliable)
  let liveGames = [];
  let todaysFinals = [];
  try {
    const url = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";
    const data = await fetchJson(url, 4500);
    const games = data?.scoreboard?.games || [];
    for (const g of games) {
      const home = g.homeTeam?.teamTricode;
      const away = g.awayTeam?.teamTricode;
      const sid = findSeriesId(home, away);
      if (!sid) continue;
      const homeScore = g.homeTeam?.score ?? 0;
      const awayScore = g.awayTeam?.score ?? 0;
      liveGames.push({
        seriesId: sid,
        gameStatus: g.gameStatus,
        gameStatusText: g.gameStatusText,
        period: g.period,
        gameClock: g.gameClock,
        home: { tri: home, score: homeScore },
        away: { tri: away, score: awayScore },
      });
      if (g.gameStatus === 3 && homeScore !== awayScore) {
        todaysFinals.push({
          sid,
          winnerTri: homeScore > awayScore ? home : away,
        });
      }
    }
  } catch (e) {
    errors.push(`scoreboard: ${e.message}`);
  }

  // Fallback: if we didn't get series data but we have today's finals,
  // nudge the winning team's count up by 1 above the baseline.
  // (This only covers today — series data is needed for full history.)
  if (!gotSeriesData && todaysFinals.length > 0) {
    for (const f of todaysFinals) {
      const code = TRICODE_MAP[f.winnerTri];
      if (code && gameWins[f.sid]) {
        gameWins[f.sid][code] = Math.max(gameWins[f.sid][code], 1);
      }
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
