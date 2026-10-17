import { parseScoreboard, seasonMonths } from "../../../lib/regular-season-games";

export const runtime = "nodejs";
export const maxDuration = 15;
export const revalidate = 86400;

// One calendar month of a season's finished regular-season games
// (/api/regular-season/games?season=2025-26&month=202511). The Explore month
// sections ask for each of seasonMonths(season) side by side and group what
// comes back. Read live off ESPN's public scoreboard: the NBA blocks
// server-side requests for past seasons, ESPN does not, and its event ids are
// what /api/boxscore's ESPN path opens a game's box score with.
//
// ESPN is asked one day at a time — the scoreboard's plain `dates=YYYYMMDD`
// form. A date-range query (`dates=A-B`) answers 400 over a regular-season
// month.

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
      // ESPN's error body says what it objected to; keep the start of it.
      const why = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 120);
      const err = new Error(`HTTP ${res.status}${why ? ` ${why}` : ""}`);
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

// The month's days as YYYYMMDD, stopping at today: a day not yet played has
// nothing finished to find.
function monthDays(yyyymm) {
  const y = Number(yyyymm.slice(0, 4)), m = Number(yyyymm.slice(4));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = [];
  for (let d = 1; d <= last; d++) {
    if (Date.UTC(y, m - 1, d) > Date.now()) break;
    out.push(`${yyyymm}${String(d).padStart(2, "0")}`);
  }
  return out;
}

const dayUrl = (yyyymmdd) =>
  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${yyyymmdd}`;

const SEASON_RE = /^\d{4}-\d{2}$/;

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const season = params.get("season");
  const month = params.get("month");
  if (!season || !SEASON_RE.test(season)) {
    return Response.json({ error: "valid season required (e.g. 2024-25)" }, { status: 400 });
  }
  if (!seasonMonths(season).includes(month)) {
    return Response.json({ error: `month must be one of ${seasonMonths(season).join(", ")}` }, { status: 400 });
  }

  const errors = [];
  const days = monthDays(month);
  const results = await Promise.all(days.map((day) =>
    fetchJson(dayUrl(day))
      .then((d) => parseScoreboard(d?.events))
      .catch((e) => { errors.push(`${day}: ${e.message}`); return []; })));
  const games = results.flat();
  if (!games.length && errors.length) {
    return Response.json({ error: `espn scoreboard: ${errors.slice(0, 3).join("; ")}` }, { status: 500 });
  }

  // A finished season never changes, so it caches for a week; one still being
  // played (or a fetch that lost a day) is asked again within the hour.
  const finished = Date.now() >= Date.UTC(Number(season.slice(0, 4)) + 1, 6, 1);
  const maxAge = errors.length || !finished ? 3600 : 604800;
  return Response.json(
    { season, month, games, errors, source: "espn", fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 4}` } },
  );
}
