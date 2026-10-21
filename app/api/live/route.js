import { LEAGUE_AVERAGES } from "../../scoring";
import { addDays, mergeSlates, parseEspnScoreboard, parseNbaScoreboard, seasonOf, sortSlate, upNextNeeds } from "../_lib/live-games";

export const runtime = "nodejs";
export const maxDuration = 15;

// Today's games for the Live tab: every game on the slate, live ones first,
// with the score, period and clock. The NBA's live scoreboard is the source;
// ESPN's stands in when the NBA refuses the request (it can 403 a datacenter
// IP) and lends its national TV listings either way. See _lib/live-games.js.
//
// When nothing's on and the day's slate is done (or not started), `mode` is
// "upnext" and `next` / `prev` hold the next slate to come and the last one
// played, the one the feed didn't have read from ESPN a day at a time.
//
// `baselineSeason` is the season whose league averages the page scores these
// games against: the slate's own, or on the first nights of a season, before
// its baselines are baked, the one before it.

const NBA_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
};
const ESPN_HEADERS = { "User-Agent": NBA_HEADERS["User-Agent"], Accept: "application/json, text/plain, */*" };

async function fetchJson(url, headers, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const prevSeason = (s) => {
  const y = Number(s.slice(0, 4)) - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};
// How far either way to look for a slate: past the All-Star break.
const LOOK_DAYS = 7;

// The first slate with games, stepping a day at a time from `day`. ESPN takes
// one date per request (a range 400s over a regular season), so the week goes
// out at once and the nearest day with games wins.
async function nearestSlate(day, step) {
  const days = Array.from({ length: LOOK_DAYS }, (_, i) => addDays(day, step * (i + 1)));
  const slates = await Promise.all(days.map((d) =>
    fetchJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d.replaceAll("-", "")}`, ESPN_HEADERS, 4500)
      .then(parseEspnScoreboard)
      .then((s) => (s?.games.length ? { date: d, games: sortSlate(s.games) } : null))
      .catch(() => null)));
  return slates.find(Boolean) || null;
}

const todayEt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

export async function GET() {
  const errors = [];
  const [nba, espn] = await Promise.all([
    fetchJson("https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json", NBA_HEADERS, 4500)
      .then(parseNbaScoreboard)
      .catch((e) => { errors.push(`nba: ${e.message}`); return null; }),
    fetchJson("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard", ESPN_HEADERS, 4500)
      .then(parseEspnScoreboard)
      .catch((e) => { errors.push(`espn: ${e.message}`); return null; }),
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
      needs.next ? nearestSlate(day, 1) : own,
      needs.prev ? nearestSlate(day, -1) : own,
    ]);
  }

  return new Response(JSON.stringify({
    date: day, season, baselineSeason, games, source,
    mode: needs ? "upnext" : "live", next, prev,
    errors: failed ? errors : [],
    fetchedAt: new Date().toISOString(),
  }), {
    status: failed ? 502 : 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": failed ? "no-store" : needs ? "public, s-maxage=60, stale-while-revalidate=120" : "public, s-maxage=15, stale-while-revalidate=30",
    },
  });
}
