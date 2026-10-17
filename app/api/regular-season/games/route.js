import { groupByMonth, parseScoreboard, seasonMonths } from "../../../lib/regular-season-games";

export const runtime = "nodejs";
export const maxDuration = 15;
export const revalidate = 86400;

// Every finished regular-season game of a season, grouped by month
// (/api/regular-season/games?season=2025-26) — the regular season's answer to
// /api/history's rounds. Read live off ESPN's public scoreboard, one query per
// calendar month run side by side: the NBA blocks server-side requests for
// past seasons, ESPN does not, and its event ids are what /api/boxscore's
// ESPN path opens a game's box score with.

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

async function fetchJsonOnce(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") {
      const err = new Error("timeout");
      err.transient = true;
      throw err;
    }
    if (e.status >= 500 && e.status < 600) e.transient = true;
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Same single retry /api/history gives ESPN's occasional 504s.
async function fetchJson(url, timeoutMs = 6000) {
  try {
    return await fetchJsonOnce(url, timeoutMs);
  } catch (e) {
    if (!e.transient) throw e;
    await new Promise((r) => setTimeout(r, 600));
    return await fetchJsonOnce(url, timeoutMs);
  }
}

function monthUrl(yyyymm) {
  const y = Number(yyyymm.slice(0, 4)), m = Number(yyyymm.slice(4));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard` +
    `?dates=${yyyymm}01-${yyyymm}${last}&seasontype=2&limit=1000`;
}

const SEASON_RE = /^\d{4}-\d{2}$/;

export async function GET(req) {
  const season = new URL(req.url).searchParams.get("season");
  if (!season || !SEASON_RE.test(season)) {
    return Response.json({ error: "valid season required (e.g. 2024-25)" }, { status: 400 });
  }

  const errors = [];
  const results = await Promise.all(seasonMonths(season).map((ym) =>
    fetchJson(monthUrl(ym))
      .then((d) => parseScoreboard(d?.events))
      .catch((e) => { errors.push(`${ym}: ${e.message}`); return []; })));
  const games = results.flat();
  if (!games.length && errors.length) {
    return Response.json({ error: `espn scoreboard: ${errors.join("; ")}` }, { status: 500 });
  }

  // A finished season never changes, so it caches for a week; one still being
  // played (or a fetch that lost a month) is asked again within the hour.
  const finished = Date.now() >= Date.UTC(Number(season.slice(0, 4)) + 1, 6, 1);
  const maxAge = errors.length || !finished ? 3600 : 604800;
  return Response.json(
    { season, months: groupByMonth(games), errors, source: "espn", fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 4}` } },
  );
}
