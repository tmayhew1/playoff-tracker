import { BRACKET } from "../../teams";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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

// Season this bracket represents (matches R1_MATCHUPS / TRICODE_MAP above).
const CURRENT_SEASON = "2025-26";

// Fallback source when the live NBA feed is unavailable (e.g. 403 from a
// datacenter IP, or simply the offseason): reconstruct finalized playoff games
// from the baked history the R pipeline maintains. All such games are final.
async function loadBakedPlayoffGames() {
  try {
    const path = join(process.cwd(), "app", "data", `history-${CURRENT_SEASON}.json`);
    const data = JSON.parse(await readFile(path, "utf8"));
    const games = [];
    for (const s of data.series || []) {
      for (const g of s.games || []) {
        const home = g.home?.tri, away = g.away?.tri;
        if (!TRICODE_MAP[home] || !TRICODE_MAP[away]) continue;
        games.push({
          gameId: g.gameId,
          gameStatus: 3, // baked games are finalized
          gameStatusText: "Final",
          gameDateTimeUTC: g.gameDateTimeUTC,
          home: { tri: home, score: g.home.score ?? 0 },
          away: { tri: away, score: g.away.score ?? 0 },
          broadcasters: [],
        });
      }
    }
    return games;
  } catch {
    return [];
  }
}

const R1_MATCHUPS = {
  E1: ["DET", "ORL"], E4: ["CLE", "TOR"], E3: ["NYK", "ATL"], E2: ["BOS", "PHI"],
  W1: ["OKC", "PHX"], W4: ["LAL", "HOU"], W3: ["DEN", "MIN"], W2: ["SAS", "POR"],
};

// Iteratively derive matchups for later rounds from R1 finals already on the schedule.
// As R1 series clinch, we know the R2 pairs; as R2 clinches, we know R3; etc.
function buildSeriesMatchups(playoffGames) {
  const matchups = { ...R1_MATCHUPS };
  const winners = {};
  const finals = playoffGames.filter((g) => g.gameStatus === 3 && g.home.score !== g.away.score);

  const computeWinners = () => {
    for (const [sid, [a, b]] of Object.entries(matchups)) {
      if (winners[sid]) continue;
      let aw = 0, bw = 0;
      for (const f of finals) {
        const ht = f.home.tri, at = f.away.tri;
        if ((ht === a && at === b) || (ht === b && at === a)) {
          const winT = f.home.score > f.away.score ? ht : at;
          if (winT === a) aw++;
          else if (winT === b) bw++;
        }
      }
      if (aw >= 4) winners[sid] = a;
      else if (bw >= 4) winners[sid] = b;
    }
  };

  for (const round of [BRACKET.r2, BRACKET.r3, BRACKET.r4]) {
    computeWinners();
    for (const s of round) {
      if (matchups[s.id]) continue;
      const a = winners[s.from[0]], b = winners[s.from[1]];
      if (a && b) matchups[s.id] = [a, b];
    }
  }

  return matchups;
}

export async function GET() {
  const errors = [];
  let usedBaked = false;

  // --- 1. Pull the full season schedule (includes every playoff game) ---
  let rawPlayoffGames = [];
  try {
    const url = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json";
    const data = await fetchJson(url, 6000);
    const gameDates = data?.leagueSchedule?.gameDates || [];
    for (const gd of gameDates) {
      for (const g of gd.games || []) {
        // NBA gameId prefix "004" identifies postseason games — more reliable
        // than seriesText (which has format quirks across rounds and years).
        // "002" = regular season (incl. NBA Cup), "001" = preseason, "005" = Play-In.
        const gameId = g.gameId || "";
        if (!gameId.startsWith("004")) continue;
        const seriesGameNum = g.seriesGameNumber || 0;
        if (seriesGameNum < 1 || seriesGameNum > 7) continue;
        // Date guard so prior-season playoff games (also "004") don't leak in.
        // NBA playoffs run April–June; require games within ~120 days of today.
        if (!g.gameDateTimeUTC) continue;
        const gameDate = new Date(g.gameDateTimeUTC);
        const now = new Date();
        const month = gameDate.getUTCMonth(); // 0 = Jan
        if (month < 3 || month > 5) continue;
        const daysAway = Math.abs(gameDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        if (daysAway > 120) continue;
        const home = g.homeTeam?.teamTricode;
        const away = g.awayTeam?.teamTricode;
        // Restrict to the 16 teams in our bracket
        if (!TRICODE_MAP[home] || !TRICODE_MAP[away]) continue;
        const homeScore = g.homeTeam?.score ?? 0;
        const awayScore = g.awayTeam?.score ?? 0;

        // Pull national TV + national streaming only (skip radio & local markets)
        const bc = g.broadcasters || {};
        const natTv = (bc.nationalBroadcasters || []).map((b) => b.broadcasterDisplay).filter(Boolean);
        const natOtt = (bc.nationalOttBroadcasters || []).map((b) => b.broadcasterDisplay).filter(Boolean);
        const broadcasters = [...new Set([...natTv, ...natOtt])];

        rawPlayoffGames.push({
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

  // Live feed gave us nothing (failed, or offseason) — fall back to the baked
  // playoff history so results still show. Baked data covers us, so the
  // live-feed error is no longer worth surfacing.
  if (rawPlayoffGames.length === 0) {
    const baked = await loadBakedPlayoffGames();
    if (baked.length > 0) {
      rawPlayoffGames = baked;
      usedBaked = true;
      errors.length = 0;
    }
  }

  // --- 2. Build dynamic series matchups (R1 + later rounds as they clinch) ---
  const SERIES_MATCHUPS = buildSeriesMatchups(rawPlayoffGames);

  const findSeriesId = (tri1, tri2) => {
    for (const [id, teams] of Object.entries(SERIES_MATCHUPS)) {
      if ((teams[0] === tri1 && teams[1] === tri2) || (teams[0] === tri2 && teams[1] === tri1)) return id;
    }
    return null;
  };

  const gameWins = {};
  for (const [id, [a, b]] of Object.entries(SERIES_MATCHUPS)) {
    gameWins[id] = { [a]: 0, [b]: 0 };
  }

  // Annotate schedule games with seriesId, drop ones we can't place yet
  // (e.g. R2 game whose feeding R1 series hasn't clinched yet)
  const scheduleGames = rawPlayoffGames
    .map((g) => ({ ...g, seriesId: findSeriesId(g.home.tri, g.away.tri) }))
    .filter((g) => g.seriesId);

  // --- 3. Pull today's live scoreboard for in-progress scores (overrides schedule) ---
  // Skipped when serving baked history: those games are all final, so there's
  // no live scoreboard to merge (and no error to surface).
  let liveToday = [];
  if (!usedBaked) {
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
  }

  // --- 4. Merge: schedule provides history + broadcasters, scoreboard overrides today's live data ---
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

  // --- 5. Derive gameWins from finalized games ---
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

  const source = usedBaked ? "baked" : "live";
  return new Response(JSON.stringify({ gameWins, liveGames, errors, source, fetchedAt: new Date().toISOString() }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
