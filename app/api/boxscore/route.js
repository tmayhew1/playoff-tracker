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

// "34:12" -> minutes (float)
function parseClockMinutes(min) {
  if (!min) return 0;
  const [m, s] = String(min).split(":");
  return (parseInt(m, 10) || 0) + (parseFloat(s) || 0) / 60;
}

// Fallback for old games (live CDN only keeps recent games): pull the box
// score from data.nba.com (CDN-backed, reachable server-side). Needs the
// game date (YYYYMMDD), supplied by /api/history as gameCode.
async function fetchArchiveBox(gameId, date) {
  if (!date) throw new Error("date required for archive box");
  const url = `https://data.nba.com/prod/v1/${date}/${gameId}_boxscore.json`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  let data;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`archive ${res.status}`);
    data = await res.json();
  } finally {
    clearTimeout(t);
  }
  const basic = data?.basicGameData || {};
  const stats = data?.stats;
  if (!stats?.activePlayers) throw new Error("no activePlayers");
  const triById = {};
  if (basic.hTeam?.teamId) triById[basic.hTeam.teamId] = basic.hTeam.triCode;
  if (basic.vTeam?.teamId) triById[basic.vTeam.teamId] = basic.vTeam.triCode;

  const mapP = (pl) => ({
    name: `${pl.firstName || ""} ${pl.lastName || ""}`.trim(),
    starter: !!pl.pos, // starting position only set for starters
    oncourt: false,
    mp: parseClockMinutes(pl.min),
    pts: Number(pl.points) || 0,
    reb: Number(pl.totReb) || 0,
    drb: Number(pl.defReb) || 0,
    orb: Number(pl.offReb) || 0,
    ast: Number(pl.assists) || 0,
    stl: Number(pl.steals) || 0,
    blk: Number(pl.blocks) || 0,
    tov: Number(pl.turnovers) || 0,
    fgm: Number(pl.fgm) || 0,
    fga: Number(pl.fga) || 0,
    tpm: Number(pl.tpm) || 0,
    tpa: Number(pl.tpa) || 0,
    ftm: Number(pl.ftm) || 0,
    fta: Number(pl.fta) || 0,
    plusMinus: Number(pl.plusMinus) || 0,
  });

  const byTeam = {};
  for (const pl of stats.activePlayers) {
    const tri = triById[pl.teamId];
    if (!tri) continue;
    (byTeam[tri] = byTeam[tri] || []).push(mapP(pl));
  }
  const homeTri = basic.hTeam?.triCode;
  const awayTri = basic.vTeam?.triCode;
  return {
    gameId,
    status: "Final",
    gameStatus: 3,
    home: { tri: homeTri, score: Number(basic.hTeam?.score) || 0, players: byTeam[homeTri] || [] },
    away: { tri: awayTri, score: Number(basic.vTeam?.score) || 0, players: byTeam[awayTri] || [] },
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
  const date = searchParams.get("date"); // YYYYMMDD, for archived games
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
    // Old game: live CDN 404s. Fall back to data.nba.com archive.
    try {
      body = await fetchArchiveBox(gameId, date);
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
