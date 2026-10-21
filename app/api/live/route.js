import { LEAGUE_AVERAGES } from "../../scoring";
import { mergeSlates, parseEspnScoreboard, parseNbaScoreboard, seasonOf } from "../_lib/live-games";

export const runtime = "nodejs";
export const maxDuration = 15;

// Today's games for the Live tab: every game on the slate, live ones first,
// with the score, period and clock. The NBA's live scoreboard is the source;
// ESPN's stands in when the NBA refuses the request (it can 403 a datacenter
// IP) and lends its national TV listings either way. See _lib/live-games.js.
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

  return new Response(JSON.stringify({
    date: day, season, baselineSeason, games, source,
    errors: failed ? errors : [],
    fetchedAt: new Date().toISOString(),
  }), {
    status: failed ? 502 : 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": failed ? "no-store" : "public, s-maxage=15, stale-while-revalidate=30",
    },
  });
}
