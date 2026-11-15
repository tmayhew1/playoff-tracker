import { liveSlate } from "../_lib/live-games";

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
// Both feeds refusing at once is a 502 with the reasons in `errors`; the Live
// tab then asks ESPN itself, from the browser (liveSlate again).
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

export async function GET() {
  const { failed, ...body } = await liveSlate((url, feed) => fetchJson(url, feed === "nba" ? NBA_HEADERS : ESPN_HEADERS, 4500));
  return new Response(JSON.stringify(body), {
    status: failed ? 502 : 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": failed ? "no-store" : body.mode === "upnext" ? "public, s-maxage=60, stale-while-revalidate=120" : "public, s-maxage=15, stale-while-revalidate=30",
    },
  });
}
