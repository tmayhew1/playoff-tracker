export const runtime = "edge";
export const revalidate = 30;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: HEADERS, next: { revalidate: 30 } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const TRICODE_MAP = {
  SAS: "SAS", DEN: "DEN", CLE: "CLE", HOU: "HOU", NYK: "NYK",
  ORL: "ORL", PHI: "PHI", PHX: "PHX", OKC: "OKC", BOS: "BOS",
  MIN: "MIN", DET: "DET", ATL: "ATL", LAL: "LAL", TOR: "TOR",
  POR: "POR",
};

const SERIES_MATCHUPS = {
  E1: ["DET", "ORL"],
  E4: ["CLE", "TOR"],
  E3: ["NYK", "ATL"],
  E2: ["BOS", "PHI"],
  W1: ["OKC", "PHX"],
  W4: ["LAL", "HOU"],
  W3: ["DEN", "MIN"],
  W2: ["SAS", "POR"],
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

  try {
    const url = "https://stats.nba.com/stats/playoffseriesbyround?LeagueID=00&Season=2025-26&RoundNumber=1";
    const data = await fetchJson(url);
    const rs = data.resultSets?.[0];
    if (rs) {
      const cols = rs.headers;
      const idx = (name) => cols.indexOf(name);
      const highTri = idx("HIGH_SEED_TEAM_TRICODE");
      const lowTri = idx("LOW_SEED_TEAM_TRICODE");
      const highWins = idx("HIGH_SEED_WINS");
      const lowWins = idx("LOW_SEED_WINS");
      for (const row of rs.rowSet) {
        const hTri = row[highTri];
        const lTri = row[lowTri];
        const hW = row[highWins] ?? 0;
        const lW = row[lowWins] ?? 0;
        const sid = findSeriesId(hTri, lTri);
        if (sid && TRICODE_MAP[hTri] && TRICODE_MAP[lTri]) {
          gameWins[sid] = { [TRICODE_MAP[hTri]]: hW, [TRICODE_MAP[lTri]]: lW };
        }
      }
    }
  } catch (e) {
    errors.push(`playoffSeriesByRound: ${e.message}`);
  }

  let liveGames = [];
  try {
    const url = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";
    const data = await fetchJson(url);
    const games = data?.scoreboard?.games || [];
    for (const g of games) {
      const home = g.homeTeam?.teamTricode;
      const away = g.awayTeam?.teamTricode;
      const sid = findSeriesId(home, away);
      if (!sid) continue;
      liveGames.push({
        seriesId: sid,
        gameStatus: g.gameStatus,
        gameStatusText: g.gameStatusText,
        period: g.period,
        gameClock: g.gameClock,
        home: { tri: home, score: g.homeTeam?.score ?? 0 },
        away: { tri: away, score: g.awayTeam?.score ?? 0 },
      });
    }
  } catch (e) {
    errors.push(`todaysScoreboard: ${e.message}`);
  }

  return new Response(JSON.stringify({ gameWins, liveGames, errors, fetchedAt: new Date().toISOString() }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
