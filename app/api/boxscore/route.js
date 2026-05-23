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

const ESPN_TO_NBA = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
const toNba = (a) => ESPN_TO_NBA[a] || a;
const splitMade = (v) => {
  const [m, a] = String(v || "0-0").split("-");
  return [Number(m) || 0, Number(a) || 0];
};

// ESPN returns MIN as either a plain integer ("38") on modern data or
// "MM:SS" on some older seasons. Handle both.
function parseMin(v) {
  if (v == null || v === "") return 0;
  const s = String(v).trim();
  if (s.includes(":")) {
    const [m, sec] = s.split(":");
    return (parseInt(m, 10) || 0) + (parseFloat(sec) || 0) / 60;
  }
  return parseFloat(s) || 0;
}

// Fallback for old games (live CDN only keeps recent ones): NBA blocks
// server-side historical requests, so use ESPN's summary endpoint. The
// gameId here is an ESPN event id (supplied by /api/history).
async function fetchEspnBox(eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  let data;
  try {
    const res = await fetch(url, { headers: { ...HEADERS, Referer: undefined, Origin: undefined }, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`espn ${res.status}`);
    data = await res.json();
  } finally {
    clearTimeout(t);
  }
  const teamsBox = data?.boxscore?.players || [];
  if (teamsBox.length < 2) throw new Error("no boxscore players");

  const teamOut = (tb) => {
    const tri = toNba(tb.team?.abbreviation);
    const grp = (tb.statistics || [])[0] || {};
    const names = grp.names || [];
    const idx = {};
    names.forEach((n, i) => (idx[n] = i));
    const players = [];
    for (const a of grp.athletes || []) {
      const st = a.stats || [];
      if (!st.length || a.didNotPlay) continue;
      const [fgm, fga] = splitMade(st[idx.FG]);
      const [tpm, tpa] = splitMade(st[idx["3PT"]]);
      const [ftm, fta] = splitMade(st[idx.FT]);
      players.push({
        name: a.athlete?.displayName || "",
        starter: !!a.starter,
        oncourt: false,
        mp: parseMin(st[idx.MIN]),
        pts: Number(st[idx.PTS]) || 0,
        reb: Number(st[idx.REB]) || 0,
        drb: Number(st[idx.DREB]) || 0,
        orb: Number(st[idx.OREB]) || 0,
        ast: Number(st[idx.AST]) || 0,
        stl: Number(st[idx.STL]) || 0,
        blk: Number(st[idx.BLK]) || 0,
        tov: Number(st[idx.TO]) || 0,
        fgm, fga, tpm, tpa, ftm, fta,
        plusMinus: Number(String(st[idx["+/-"]] || "0").replace("+", "")) || 0,
      });
    }
    return { tri, players };
  };

  const a = teamOut(teamsBox[0]);
  const b = teamOut(teamsBox[1]);
  return {
    gameId: String(eventId),
    status: "Final",
    gameStatus: 3,
    home: { tri: b.tri, score: 0, players: b.players },
    away: { tri: a.tri, score: 0, players: a.players },
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
  const src = searchParams.get("src"); // "espn" -> skip the live-CDN attempt
  if (!gameId) return new Response(JSON.stringify({ error: "gameId required" }), { status: 400 });
  let body = null;
  let liveCache = true;

  if (src === "espn") {
    // Historical games are ESPN ids; the CDN always 404s for them, so the
    // detour just adds ~5s of latency per game. Go straight to ESPN.
    try {
      body = await fetchEspnBox(gameId);
      liveCache = false;
    } catch (e) {
      return new Response(JSON.stringify({ error: `espn: ${e.message}` }), { status: 500 });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  }

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
    // Old game: live CDN 404s. Fall back to ESPN (NBA blocks server-side
    // historical requests). gameId is then an ESPN event id.
    try {
      body = await fetchEspnBox(gameId);
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
