// Today's slate for the Live tab, read from two feeds into one game shape:
// the NBA's live scoreboard (cdn.nba.com, todaysScoreboard_00.json) first,
// ESPN's scoreboard as the fallback when the NBA blocks the request, and as
// the source of national TV either way (the NBA scoreboard carries none).
//
// A game comes out the way LiveGameBanner reads one: gameStatus 1/2/3
// (scheduled / in progress / final), the clock as an ISO duration
// ("PT05M21.00S"), and `boxSrc: "espn"` on games whose id is an ESPN event id,
// so the box score request skips the NBA CDN.

import { LEAGUE_AVERAGES } from "../../scoring";

const ESPN_TO_NBA = { GS: "GSW", NJ: "NJN", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
const toNba = (a) => ESPN_TO_NBA[a] || a;

// The NBA's game id prefix names the stage: 001 preseason, 002 regular season
// (NBA Cup included), 003 All-Star, 004 playoffs, 005 play-in. ESPN's season
// type: 1 preseason, 2 regular, 3 postseason, 5 play-in.
const NBA_KIND = { "001": "preseason", "002": "regular", "003": "allstar", "004": "playoffs", "005": "playin" };
const ESPN_KIND = { 1: "preseason", 2: "regular", 3: "playoffs", 4: "allstar", 5: "playin" };

// The season a date belongs to; the new one starts in September.
export function seasonOf(date) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const start = m >= 9 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// ESPN's "5:21" (or "45.2" under a minute) as the NBA's "PT05M21.00S".
export function isoClock(display) {
  if (!display) return "";
  const s = String(display).trim();
  const [m, sec] = s.includes(":") ? s.split(":") : ["0", s];
  const mins = parseInt(m, 10) || 0;
  const secs = parseFloat(sec) || 0;
  return `PT${String(mins).padStart(2, "0")}M${secs.toFixed(2).padStart(5, "0")}S`;
}

export function parseNbaScoreboard(data) {
  const sb = data?.scoreboard;
  if (!sb) return null;
  const side = (t) => ({
    tri: t?.teamTricode || "",
    score: t?.score ?? 0,
    record: t?.wins != null && t?.losses != null ? `${t.wins}-${t.losses}` : null,
  });
  const games = (sb.games || []).map((g) => ({
    gameId: g.gameId,
    gameCode: g.gameCode || null,
    kind: NBA_KIND[String(g.gameId || "").slice(0, 3)] || "regular",
    gameStatus: g.gameStatus,
    gameStatusText: (g.gameStatusText || "").trim(),
    period: g.period || 0,
    gameClock: g.gameClock || "",
    gameDateTimeUTC: g.gameTimeUTC || null,
    home: side(g.homeTeam),
    away: side(g.awayTeam),
    broadcasters: [],
    boxSrc: null,
  }));
  return { date: sb.gameDate || null, games };
}

export function parseEspnScoreboard(data) {
  if (!data || !Array.isArray(data.events)) return null;
  const games = [];
  for (const ev of data.events) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const st = comp.status || ev.status || {};
    const state = st.type?.state;
    const gameStatus = state === "in" ? 2 : state === "post" ? 3 : 1;
    const side = (homeAway) => {
      const c = (comp.competitors || []).find((x) => x.homeAway === homeAway) || {};
      const rec = (c.records || []).find((r) => r.type === "total" || r.name === "overall") || c.records?.[0];
      return { tri: toNba(c.team?.abbreviation || ""), score: Number(c.score) || 0, record: rec?.summary || null };
    };
    // National TV only, the way /api/scores reads the NBA schedule.
    const national = (comp.geoBroadcasts || [])
      .filter((b) => b.market?.type === "National")
      .map((b) => b.media?.shortName)
      .filter(Boolean);
    const broadcasters = national.length ? national : (comp.broadcasts || []).flatMap((b) => b.names || []);
    const halftime = st.type?.name === "STATUS_HALFTIME";
    const endOfPeriod = st.type?.name === "STATUS_END_PERIOD";
    games.push({
      gameId: String(ev.id),
      gameCode: null,
      kind: ESPN_KIND[ev.season?.type] || "regular",
      gameStatus,
      gameStatusText: halftime ? "Half" : endOfPeriod ? `End of Q${st.period}` : st.type?.shortDetail || "",
      period: st.period || 0,
      gameClock: gameStatus === 2 ? isoClock(st.displayClock) : "",
      gameDateTimeUTC: ev.date || comp.date || null,
      home: side("home"),
      away: side("away"),
      broadcasters: [...new Set(broadcasters)],
      boxSrc: "espn",
    });
  }
  const day = data.day?.date || null;
  return { date: day, games };
}

const pairKey = (g) => `${g.away.tri}@${g.home.tri}`;

// The NBA's slate with ESPN's TV listings laid over it; ESPN's slate alone
// when the NBA's didn't load. Live games first, then upcoming by tip, then
// finals, so the page reads top-down as "on now / later / done".
export function mergeSlates(nba, espn) {
  let games;
  let source;
  if (nba?.games?.length || (nba && !espn?.games?.length)) {
    const tv = new Map((espn?.games || []).map((g) => [pairKey(g), g.broadcasters]));
    games = nba.games.map((g) => ({ ...g, broadcasters: tv.get(pairKey(g)) || g.broadcasters }));
    source = "nba";
  } else {
    games = espn?.games || [];
    source = espn ? "espn" : null;
  }
  return { date: (source === "nba" ? nba?.date : espn?.date) || nba?.date || espn?.date || null, games: sortSlate(games), source };
}

export function sortSlate(games) {
  const rank = { 2: 0, 1: 1, 3: 2 };
  const tip = (g) => (g.gameDateTimeUTC ? Date.parse(g.gameDateTimeUTC) : 0);
  return games.sort((a, b) => (rank[a.gameStatus] ?? 3) - (rank[b.gameStatus] ?? 3) || tip(a) - tip(b));
}

// "2026-10-21" moved n days.
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Once nothing is on, the Live tab turns into Up Next: the next slate to
// come and the last one played. Which of the two the feed's own slate is
// depends on where the day stands: every game final, it's the last one played
// and the next is still to find; none started yet (the feed has rolled over
// to a new day), it's the next one and the last is to find; an off day, both
// are. A slate with games both done and to come, or any game on, stays Live.
// Returns null for Live, else which neighbors to look up.
export function upNextNeeds(games) {
  if (games.some((g) => g.gameStatus === 2)) return null;
  if (!games.length) return { next: true, prev: true };
  if (games.every((g) => g.gameStatus === 3)) return { next: true, prev: false };
  if (games.every((g) => g.gameStatus === 1)) return { next: false, prev: true };
  return null;
}

const NBA_SCOREBOARD = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";
const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";

const prevSeason = (s) => {
  const y = Number(s.slice(0, 4)) - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};
// How far either way to look for a slate: past the All-Star break.
const LOOK_DAYS = 7;
const todayEt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

// The first slate with games, stepping a day at a time from `day`. ESPN takes
// one date per request (a range 400s over a regular season), so the week goes
// out at once and the nearest day with games wins.
async function nearestSlate(get, day, step) {
  const days = Array.from({ length: LOOK_DAYS }, (_, i) => addDays(day, step * (i + 1)));
  const slates = await Promise.all(days.map((d) =>
    get(`${ESPN_SCOREBOARD}?dates=${d.replaceAll("-", "")}`, "espn")
      .then(parseEspnScoreboard)
      .then((s) => (s?.games.length ? { date: d, games: sortSlate(s.games) } : null))
      .catch(() => null)));
  return slates.find(Boolean) || null;
}

// What /api/live answers, built over `get(url, feed)` (feed "nba" or "espn",
// resolving to the parsed JSON). The route runs it with its server fetch; the
// Live tab runs it again from the browser, ESPN only (`nba: false`, the NBA
// CDN sends no CORS headers), when the route comes back empty-handed: both
// feeds can 403 a datacenter IP on the same night, and neither does that to a
// phone. `failed` is true when neither feed answered; `errors` then says why.
export async function liveSlate(get, { nba: askNba = true } = {}) {
  const errors = [];
  const [nba, espn] = await Promise.all([
    askNba
      ? get(NBA_SCOREBOARD, "nba").then(parseNbaScoreboard).catch((e) => { errors.push(`nba: ${e.message}`); return null; })
      : null,
    get(ESPN_SCOREBOARD, "espn").then(parseEspnScoreboard).catch((e) => { errors.push(`espn: ${e.message}`); return null; }),
  ]);

  const { date, games, source } = mergeSlates(nba, espn);
  // One feed failing is routine; only report when there's nothing to show.
  const failed = !source;
  const day = date || todayEt();
  const season = seasonOf(day);
  const baselineSeason = LEAGUE_AVERAGES[season] ? season : prevSeason(season);

  const needs = failed ? null : upNextNeeds(games);
  let next = null, prev = null;
  if (needs) {
    const own = games.length ? { date: day, games } : null;
    [next, prev] = await Promise.all([
      needs.next ? nearestSlate(get, day, 1) : own,
      needs.prev ? nearestSlate(get, day, -1) : own,
    ]);
  }

  return {
    date: day, season, baselineSeason, games, source,
    mode: needs ? "upnext" : "live", next, prev,
    errors: failed ? errors : [],
    failed,
    fetchedAt: new Date().toISOString(),
  };
}
