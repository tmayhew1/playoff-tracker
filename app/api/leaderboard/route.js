import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lgaForSeason, valueAddParts } from "../../scoring";

export const runtime = "nodejs";
export const maxDuration = 30;
export const revalidate = 86400;

// Bake-first lookup, mirroring /api/history. The bake script produces
// app/data/leaderboard-<season>.json.
async function loadBaked(season) {
  try {
    const path = join(process.cwd(), "app", "data", `leaderboard-${season}.json`);
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

const ESPN_TO_NBA = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
const toNba = (a) => ESPN_TO_NBA[a] || a;

const SEASON_RE = /^\d{4}-\d{2}$/;

async function fetchJson(url, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "timeout" : e.message);
  } finally {
    clearTimeout(t);
  }
}

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

function playersFromBox(box) {
  const teamsBox = box?.boxscore?.players || [];
  if (teamsBox.length < 2) return null;
  const out = [];
  for (const tb of teamsBox) {
    const tri = toNba(tb.team?.abbreviation);
    // Iterate ALL statistics blocks (older summaries split into
    // starters/bench), not just the first one.
    const blocks = Array.isArray(tb.statistics) ? tb.statistics : [];
    for (const grp of blocks) {
      const names = grp.names || [];
      const idx = {};
      names.forEach((n, i) => (idx[n] = i));
      for (const a of grp.athletes || []) {
        const st = a.stats || [];
        if (!st.length || a.didNotPlay) continue;
        const mp = parseMin(st[idx.MIN]);
        if (mp <= 0) continue;
        const [fgm, fga] = splitMade(st[idx.FG]);
        const [tpm, tpa] = splitMade(st[idx["3PT"]]);
        const [ftm, fta] = splitMade(st[idx.FT]);
        out.push({
          name: a.athlete?.displayName || "",
          team: tri,
          mp,
          pts: Number(st[idx.PTS]) || 0,
          reb: Number(st[idx.REB]) || 0,
          drb: Number(st[idx.DREB]) || 0,
          orb: Number(st[idx.OREB]) || 0,
          ast: Number(st[idx.AST]) || 0,
          stl: Number(st[idx.STL]) || 0,
          blk: Number(st[idx.BLK]) || 0,
          tov: Number(st[idx.TO]) || 0,
          fgm, fga, tpm, tpa, ftm, fta,
        });
      }
    }
  }
  return out;
}

async function inBatches(arr, n, fn) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) {
    const chunk = arr.slice(i, i + n);
    const res = await Promise.all(chunk.map(fn));
    out.push(...res);
  }
  return out;
}

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

  const endYear = Number(season.slice(0, 4)) + 1;
  const isBubble = season === "2019-20";
  const startMD = isBubble ? "0801" : "0401";
  const endMD = isBubble ? "1015" : "0720";

  try {
    // 1. Pull every playoff game from ESPN scoreboard (same logic as /api/history).
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard` +
      `?dates=${endYear}${startMD}-${endYear}${endMD}&seasontype=3&limit=1000`;
    const data = await fetchJson(url);
    const events = data?.events || [];

    const seen = new Set();
    const games = [];
    for (const ev of events) {
      const comp = ev.competitions?.[0];
      if (!comp || !(comp.status?.type?.completed ?? ev.status?.type?.completed)) continue;
      // ESPN flags playoffs with season.type === 3; older seasons sometimes
      // omit the per-event note, so accept either signal. Always exclude
      // play-in via the note when present.
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
      if (seen.has(id)) continue;
      seen.add(id);
      const iso = ev.date || comp.date;
      games.push({
        gameId: id,
        date: (iso || "").slice(0, 10),
        home: { tri: toNba(h.team.abbreviation), score: hScore },
        away: { tri: toNba(a.team.abbreviation), score: aScore },
      });
    }
    games.sort((x, y) => x.date.localeCompare(y.date) || x.gameId.localeCompare(y.gameId));

    // 2. Cluster into series (chronological), keep only real best-of-7s.
    const byPair = new Map();
    for (const g of games) {
      const key = [g.home.tri, g.away.tri].sort().join("-");
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push(g);
    }
    // No "must reach 4 wins" filter — for an in-progress season we want
    // series-in-progress to count. Play-in is already excluded upstream by
    // the playoff-note filter.
    const seriesList = [...byPair.values()]
      .map((gs) => ({ games: gs, start: gs[0].date }))
      .sort((p, q) => p.start.localeCompare(q.start));
    const roundFor = (i) => (i < 8 ? 1 : i < 12 ? 2 : i < 14 ? 3 : 4);
    const seriesMeta = seriesList.map((s, i) => ({
      idx: i,
      round: roundFor(i),
      teams: [s.games[0].home.tri, s.games[0].away.tri],
    }));

    // 3. Flat chronological game list with series index.
    const allGames = [];
    seriesList.forEach((s, sIdx) => {
      s.games.forEach((g) => allGames.push({ ...g, seriesIdx: sIdx }));
    });
    allGames.sort((x, y) => x.date.localeCompare(y.date) || x.gameId.localeCompare(y.gameId));
    allGames.forEach((g, i) => { g.gameIdx = i; });

    // 4. Fetch every game's box score, in batches so we don't hammer ESPN.
    // Try the site summary first; fall back to ESPN's CDN core endpoint for
    // older events that summary returns without player blocks.
    const lga = lgaForSeason(season);
    const results = await inBatches(allGames, 10, async (g) => {
      let players = null;
      try {
        const box = await fetchJson(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${g.gameId}`,
          9000
        );
        players = playersFromBox(box);
      } catch {}
      if (!players || players.length === 0) {
        try {
          const core = await fetchJson(
            `https://cdn.espn.com/core/nba/boxscore?xhr=1&gameId=${g.gameId}`,
            9000
          );
          const inner = core?.gamepackageJSON?.boxscore || core?.boxscore;
          if (inner) players = playersFromBox({ boxscore: inner });
        } catch {}
      }
      if (!players || players.length === 0) return null;
      return { ...g, players };
    });

    // 5. Aggregate per player across all playoff games.
    // Walk every game of every series the player participated in (≥1 GP) so
    // missed games surface as null-VA entries — keeps the spark line slot and
    // lets `seriesGameNumber` reflect the true game-within-series, not the
    // player's appearance count. (A player who plays G1/G2, sits G3–G5, and
    // returns for G6 would otherwise have their G6 labelled "Game 3 vs OPP".)
    const playerInfo = new Map();         // key → { name, team, seriesSet }
    const playerStatsByGame = new Map();  // `${key}:${gameId}` → box-score row
    for (const r of results) {
      if (!r) continue;
      for (const p of r.players) {
        const key = `${p.team}:${p.name}`;
        let info = playerInfo.get(key);
        if (!info) {
          info = { name: p.name, team: p.team, seriesSet: new Set() };
          playerInfo.set(key, info);
        }
        info.seriesSet.add(r.seriesIdx);
        playerStatsByGame.set(`${key}:${r.gameId}`, p);
      }
    }
    const seriesGamesByIdx = new Map();
    for (const g of allGames) {
      if (!seriesGamesByIdx.has(g.seriesIdx)) seriesGamesByIdx.set(g.seriesIdx, []);
      seriesGamesByIdx.get(g.seriesIdx).push(g);
    }

    const agg = new Map();
    for (const [key, info] of playerInfo) {
      const a = {
        name: info.name, team: info.team,
        gp: 0, va: 0, eff: 0,
        mp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
        fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, drb: 0, orb: 0,
        games: [],
      };
      const seriesIdxs = [...info.seriesSet].sort((x, y) => x - y);
      for (const sIdx of seriesIdxs) {
        const sGames = seriesGamesByIdx.get(sIdx) || [];
        sGames.forEach((g, i) => {
          const opp = info.team === g.home.tri ? g.away.tri : g.home.tri;
          const seriesGameNumber = i + 1;
          const p = playerStatsByGame.get(`${key}:${g.gameId}`);
          const base = {
            gameId: g.gameId, gameIdx: g.gameIdx, seriesIdx: sIdx,
            seriesGameNumber, opp,
          };
          if (p) {
            const { va, efficiency } = valueAddParts(p, lga);
            a.gp += 1;
            a.va += va;
            a.eff += efficiency;
            for (const k of ["mp", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "drb", "orb"]) {
              a[k] += p[k] || 0;
            }
            a.games.push({
              ...base, va,
              mp: p.mp || 0, pts: p.pts || 0, reb: p.reb || 0, ast: p.ast || 0,
              stl: p.stl || 0, blk: p.blk || 0, tov: p.tov || 0,
              fgm: p.fgm || 0, fga: p.fga || 0, tpm: p.tpm || 0, tpa: p.tpa || 0,
              ftm: p.ftm || 0, fta: p.fta || 0, drb: p.drb || 0, orb: p.orb || 0,
            });
          } else {
            a.games.push({
              ...base, va: null,
              mp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
              fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, drb: 0, orb: 0,
            });
          }
        });
      }
      agg.set(key, a);
    }

    const players = [...agg.values()];
    players.sort((a, b) => b.va - a.va);

    return new Response(JSON.stringify({
      season, series: seriesMeta, players, fetchedAt: new Date().toISOString(),
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `leaderboard: ${e.message}` }), { status: 500 });
  }
}
