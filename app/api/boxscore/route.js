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

function mapPlayer(p) {
  const s = p.statistics || {};
  const mp = parseMinutes(s.minutesCalculated || s.minutes);
  return {
    name: p.name || `${p.firstName || ""} ${p.familyName || ""}`.trim(),
    starter: !!p.starter,
    oncourt: !!p.oncourt,
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
  try {
    const url = `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`;
    const data = await fetchJson(url, 5000);
    const game = data?.game;
    if (!game) throw new Error("no game in response");
    const body = {
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
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
