import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const maxDuration = 15;

// Basketball-reference box id: YYYYMMDD + "0" + home tricode. This is what
// the R bake writes into history-<season>.json, so it's the id shape every
// historical series in the app carries. Neither the NBA live CDN nor ESPN
// knows these ids — they must be served from the bakes.
const BR_ID_RE = /^(\d{4})(\d{2})\d{2}0[A-Z]{3}$/;

async function readBaked(name) {
  try {
    return JSON.parse(await readFile(join(process.cwd(), "app", "data", name), "utf8"));
  } catch {
    return null;
  }
}

// Reconstruct a full box score for a BR game id from the baked data:
// history-<season>.json pins the matchup + final score, and every player's
// per-game stat line for that gameId lives in leaderboard-<season>.json.
// Season derivation: playoff games always fall in the season's END year
// (Apr-Jun normally, Aug-Oct for the 2020 bubble), so startYear = YYYY - 1.
// Returns null when the id isn't BR-shaped or the season isn't baked, so
// the caller can fall through to the live/ESPN paths.
async function bakedBox(gameId) {
  const m = BR_ID_RE.exec(gameId);
  if (!m) return null;
  const startYear = parseInt(m[1], 10) - 1;
  const season = `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  const [hist, lb] = await Promise.all([
    readBaked(`history-${season}.json`),
    readBaked(`leaderboard-${season}.json`),
  ]);
  if (!hist || !lb) return null;
  let game = null;
  for (const s of hist.series || []) {
    game = (s.games || []).find((g) => g.gameId === gameId);
    if (game) break;
  }
  if (!game) return null;
  const homeTri = game.home?.tri, awayTri = game.away?.tri;
  const home = [], away = [];
  for (const p of lb.players || []) {
    if (p.team !== homeTri && p.team !== awayTri) continue;
    const row = (p.games || []).find((g) => g.gameId === gameId);
    if (!row || !(row.mp > 0)) continue;
    const out = {
      name: p.name,
      // The bake carries no starter/on-court info; both only affect
      // styling (bold names, live partitioning) and neither applies to a
      // finished historical game.
      starter: false,
      oncourt: false,
      mp: row.mp || 0,
      pts: row.pts || 0,
      reb: row.reb || 0,
      drb: row.drb || 0,
      orb: row.orb || 0,
      ast: row.ast || 0,
      stl: row.stl || 0,
      blk: row.blk || 0,
      tov: row.tov || 0,
      fgm: row.fgm || 0,
      fga: row.fga || 0,
      tpm: row.tpm || 0,
      tpa: row.tpa || 0,
      ftm: row.ftm || 0,
      fta: row.fta || 0,
      plusMinus: 0,
    };
    (p.team === homeTri ? home : away).push(out);
  }
  if (!home.length && !away.length) return null;
  return {
    gameId,
    status: "Final",
    gameStatus: 3,
    home: { tri: homeTri, score: game.home?.score ?? 0, players: home },
    away: { tri: awayTri, score: game.away?.score ?? 0, players: away },
    source: "bake",
    fetchedAt: new Date().toISOString(),
  };
}

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

function parseBox(data) {
  const teamsBox = data?.boxscore?.players || [];
  if (teamsBox.length < 2) return null;
  const teamOut = (tb) => {
    const tri = toNba(tb.team?.abbreviation);
    const blocks = Array.isArray(tb.statistics) ? tb.statistics : [];
    const players = [];
    for (const grp of blocks) {
      const names = grp.names || [];
      const idx = {};
      names.forEach((n, i) => (idx[n] = i));
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
    }
    return { tri, players };
  };
  const a = teamOut(teamsBox[0]);
  const b = teamOut(teamsBox[1]);
  if (!a.players.length && !b.players.length) return null;
  return { a, b };
}

async function fetchEspn(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { ...HEADERS, Referer: undefined, Origin: undefined }, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`espn ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Fallback for old games (live CDN only keeps recent ones): NBA blocks
// server-side historical requests, so use ESPN. The gameId here is an ESPN
// event id (supplied by /api/history). The site API summary covers most
// games; some older events return empty player blocks and need the CDN
// core (gamepackageJSON) instead.
async function fetchEspnBox(eventId) {
  let parsed = null;
  try {
    const summary = await fetchEspn(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`);
    parsed = parseBox(summary);
  } catch {}
  if (!parsed) {
    try {
      const core = await fetchEspn(`https://cdn.espn.com/core/nba/boxscore?xhr=1&gameId=${eventId}`);
      const box = core?.gamepackageJSON?.boxscore || core?.boxscore || null;
      if (box) parsed = parseBox({ boxscore: box });
    } catch {}
  }
  if (!parsed) throw new Error("no boxscore players");
  const { a, b } = parsed;
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

  // Bake-first: basketball-reference ids (everything the historical bakes
  // emit) are answered entirely from app/data — the NBA CDN and ESPN would
  // both 404 on them anyway.
  const baked = await bakedBox(gameId);
  if (baked) {
    return new Response(JSON.stringify(baked), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  }

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
