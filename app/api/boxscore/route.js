export const runtime = "nodejs";
export const maxDuration = 15;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
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

// Parse ISO 8601 duration like "PT38M12.00S" to total minutes (as float)
function parseMinutes(iso) {
  if (!iso) return 0;
  const m = /PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(iso);
  if (!m) return 0;
  const mins = parseInt(m[1] || "0", 10);
  const secs = parseFloat(m[2] || "0");
  return mins + secs / 60;
}

// stats.nba.com needs richer headers than the live CDN.
const STATS_HEADERS = {
  ...HEADERS,
  "Accept-Language": "en-US,en;q=0.9",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

// "34:12" or "34.000000:12" -> minutes (float)
function parseClockMinutes(min) {
  if (!min) return 0;
  const [m, s] = String(min).split(":");
  return (parseInt(m, 10) || 0) + (parseFloat(s) || 0) / 60;
}

// Fallback for old games (live CDN only keeps recent games): pull the
// traditional box score from stats.nba.com and reshape to match.
async function fetchStatsBox(gameId) {
  const url =
    `https://stats.nba.com/stats/boxscoretraditionalv2?GameID=${gameId}` +
    `&StartPeriod=0&EndPeriod=10&StartRange=0&EndRange=0&RangeType=0`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  let data;
  try {
    const res = await fetch(url, { headers: STATS_HEADERS, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`stats ${res.status}`);
    data = await res.json();
  } finally {
    clearTimeout(t);
  }
  const ps = (data.resultSets || []).find((r) => r.name === "PlayerStats");
  if (!ps) throw new Error("no PlayerStats");
  const col = {};
  ps.headers.forEach((h, i) => (col[h] = i));
  const teams = [];
  const byTeam = {};
  for (const row of ps.rowSet) {
    const tri = row[col.TEAM_ABBREVIATION];
    if (!byTeam[tri]) {
      byTeam[tri] = [];
      teams.push(tri);
    }
    byTeam[tri].push({
      name: row[col.PLAYER_NAME],
      starter: !!row[col.START_POSITION],
      oncourt: false,
      mp: parseClockMinutes(row[col.MIN]),
      pts: row[col.PTS] ?? 0,
      reb: row[col.REB] ?? 0,
      drb: row[col.DREB] ?? 0,
      orb: row[col.OREB] ?? 0,
      ast: row[col.AST] ?? 0,
      stl: row[col.STL] ?? 0,
      blk: row[col.BLK] ?? 0,
      tov: row[col.TO] ?? 0,
      fgm: row[col.FGM] ?? 0,
      fga: row[col.FGA] ?? 0,
      tpm: row[col.FG3M] ?? 0,
      tpa: row[col.FG3A] ?? 0,
      ftm: row[col.FTM] ?? 0,
      fta: row[col.FTA] ?? 0,
      plusMinus: row[col.PLUS_MINUS] ?? 0,
    });
  }
  // Scores aren't shown inside the table (the banner shows them from the
  // games list), so home/away assignment here is cosmetic.
  const [a, b] = teams;
  return {
    gameId,
    status: "Final",
    gameStatus: 3,
    home: { tri: a, score: 0, players: byTeam[a] || [] },
    away: { tri: b, score: 0, players: byTeam[b] || [] },
    fetchedAt: new Date().toISOString(),
  };
}

function mapPlayer(p) {
  const s = p.statistics || {};
  const mp = parseMinutes(s.minutesCalculated || s.minutes);
  return {
    name: p.name || `${p.firstName || ""} ${p.familyName || ""}`.trim(),
    starter: String(p.starter) === "1" || p.starter === true,
    // NBA returns oncourt as a string ("1"/"0"), so a plain !! coerces "0" to true.
    oncourt: String(p.oncourt) === "1" || p.oncourt === true,
    mp,
    pts: s.points ?? 0,
    reb: (s.reboundsDefensive ?? 0) + (s.reboundsOffensive ?? 0),
    drb: s.reboundsDefensive ?? 0,
    orb: s.reboundsOffensive ?? 0,
    ast: s.assists ?? 0,
    stl: s.steals ?? 0,
    blk: s.blocks ?? 0,
    tov: s.turnovers ?? 0,
    fgm: s.fieldGoalsMade ?? 0,
    fga: s.fieldGoalsAttempted ?? 0,
    tpm: s.threePointersMade ?? 0,
    tpa: s.threePointersAttempted ?? 0,
    ftm: s.freeThrowsMade ?? 0,
    fta: s.freeThrowsAttempted ?? 0,
    plusMinus: s.plusMinusPoints ?? 0,
  };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const gameId = searchParams.get("gameId");
  if (!gameId) return new Response(JSON.stringify({ error: "gameId required" }), { status: 400 });
  let body = null;
  let liveCache = true;
  try {
    const url = `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`;
    const data = await fetchJson(url, 5000);
    const game = data?.game;
    if (!game) throw new Error("no game in response");
    body = {
      gameId,
      status: game.gameStatusText,
      gameStatus: game.gameStatus,
      home: {
        tri: game.homeTeam?.teamTricode,
        score: game.homeTeam?.score ?? 0,
        players: (game.homeTeam?.players || []).map(mapPlayer),
      },
      away: {
        tri: game.awayTeam?.teamTricode,
        score: game.awayTeam?.score ?? 0,
        players: (game.awayTeam?.players || []).map(mapPlayer),
      },
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    // Old game: live CDN 404s. Fall back to stats.nba.com.
    try {
      body = await fetchStatsBox(gameId);
      liveCache = false;
    } catch (e2) {
      return new Response(JSON.stringify({ error: `${e.message} / ${e2.message}` }), { status: 500 });
    }
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Historical box scores are immutable — cache them for a day.
      "Cache-Control": liveCache
        ? "public, s-maxage=20, stale-while-revalidate=60"
        : "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
