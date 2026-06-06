import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const maxDuration = 15;
export const revalidate = 86400;

// Bake-first lookup: if `app/data/history-<season>.json` exists, the
// scripts/fetch-historical.mjs pipeline has produced canonical data and we
// serve that. Otherwise fall back to the live ESPN logic below.
async function loadBaked(season) {
  try {
    const path = join(process.cwd(), "app", "data", `history-${season}.json`);
    const buf = await readFile(path, "utf8");
    return JSON.parse(buf);
  } catch {
    return null;
  }
}

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

// ESPN NBA abbreviations -> the tricodes used in this app's bracket data.
const ESPN_TO_NBA = {
  GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS",
};
const toNba = (abbr) => ESPN_TO_NBA[abbr] || abbr;

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

// ESPN's scoreboard occasionally returns 504s on long date-range queries
// (older seasons hit slower upstream caches). Retry transient failures
// once with a short backoff — caps total wall time at ~timeoutMs+700ms+
// timeoutMs, still inside our 15s maxDuration.
async function fetchJson(url, timeoutMs = 7000) {
  try {
    return await fetchJsonOnce(url, timeoutMs);
  } catch (e) {
    if (!e.transient) throw e;
    await new Promise((r) => setTimeout(r, 600));
    return await fetchJsonOnce(url, timeoutMs);
  }
}

const SEASON_RE = /^\d{4}-\d{2}$/;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const season = searchParams.get("season");
  if (!season || !SEASON_RE.test(season)) {
    return new Response(JSON.stringify({ error: "valid season required (e.g. 2024-25)" }), { status: 400 });
  }

  // Prefer baked static JSON when available — produced by the bake script.
  const baked = await loadBaked(season);
  if (baked) {
    return new Response(JSON.stringify(baked), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000",
      },
    });
  }

  // Playoffs happen in the season's *ending* calendar year: 2024-25 -> 2025.
  const endYear = Number(season.slice(0, 4)) + 1;

  try {
    // NBA blocks server-side requests for past seasons (403). ESPN's public
    // scoreboard does not. Date range covers any playoff window; seasontype=3
    // dates range + seasontype=3. Note: ESPN ignores seasontype when an
    // explicit date range is given, so it also returns early-April regular
    // season games — we filter those out by the playoff series note below.
    // 2019-20 played in the COVID bubble: late August through mid-October
    // 2020. Special-case the window for that season; everyone else uses
    // the normal April–July range.
    const isBubble = season === "2019-20";
    const startMD = isBubble ? "0801" : "0401";
    const endMD = isBubble ? "1015" : "0720";
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard` +
      `?dates=${endYear}${startMD}-${endYear}${endMD}&seasontype=3&limit=1000`;
    const data = await fetchJson(url);
    const events = data?.events || [];

    const seen = new Set();
    const all = [];
    for (const ev of events) {
      const comp = ev.competitions?.[0];
      if (!comp || !(comp.status?.type?.completed ?? ev.status?.type?.completed)) continue;
      // Identify playoff games: ESPN flags them with season.type === 3, but
      // older seasons sometimes omit the per-event note. Accept either signal.
      // Always exclude play-in via the note when present.
      const note = (comp.notes?.[0]?.headline || comp.notes?.[0]?.type || "").toString();
      if (/play[- ]?in/i.test(note)) continue;
      const isPostseason = ev.season?.type === 3 || comp.season?.type === 3;
      if (!isPostseason && !note) continue;
      const cs = comp.competitors || [];
      const h = cs.find((c) => c.homeAway === "home");
      const a = cs.find((c) => c.homeAway === "away");
      if (!h?.team?.abbreviation || !a?.team?.abbreviation) continue;
      const hScore = Number(h.score);
      const aScore = Number(a.score);
      if (!Number.isFinite(hScore) || !Number.isFinite(aScore)) continue;
      const id = String(ev.id);
      if (seen.has(id)) continue; // ESPN can repeat an event across pages
      seen.add(id);
      const iso = ev.date || comp.date;
      all.push({
        gameId: id,
        gameDateTimeUTC: iso,
        date: (iso || "").slice(0, 10),
        home: { tri: toNba(h.team.abbreviation), score: hScore, win: hScore > aScore },
        away: { tri: toNba(a.team.abbreviation), score: aScore, win: aScore > hScore },
      });
    }

    all.sort((x, y) => x.date.localeCompare(y.date) || x.gameId.localeCompare(y.gameId));

    // Cluster by team pair.
    const byPair = new Map();
    for (const g of all) {
      const key = [g.home.tri, g.away.tri].sort().join("-");
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push(g);
    }

    // Real best-of-7 series have a 4-win team; this drops Play-In games
    // (1 game, never 4 wins) that ESPN also tags as postseason.
    const realSeries = [];
    for (const games of byPair.values()) {
      const wins = {};
      for (const g of games) {
        const w = g.home.win ? g.home.tri : g.away.tri;
        wins[w] = (wins[w] || 0) + 1;
      }
      const top = Object.entries(wins).sort((p, q) => q[1] - p[1])[0];
      if (top && top[1] >= 4) realSeries.push({ games, winner: top[0], start: games[0].date });
    }
    realSeries.sort((p, q) => p.start.localeCompare(q.start));
    const roundForIndex = (i) => (i < 8 ? "r1" : i < 12 ? "r2" : i < 14 ? "r3" : "r4");

    const series = realSeries.map((s, i) => ({
      round: roundForIndex(i),
      teams: [s.games[0].home.tri, s.games[0].away.tri],
      winner: s.winner,
      games: s.games.map((g) => ({
        gameId: g.gameId,
        gameDateTimeUTC: g.gameDateTimeUTC,
        home: { tri: g.home.tri, score: g.home.score },
        away: { tri: g.away.tri, score: g.away.score },
      })),
    }));

    return new Response(JSON.stringify({ season, series, source: "espn", fetchedAt: new Date().toISOString() }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `espn scoreboard: ${e.message}` }), { status: 500 });
  }
}
