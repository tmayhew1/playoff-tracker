// ESPN's box score for one event, read into the app's stat-line shape.
// Shared by /api/boxscore (a single game) and /api/regular-season/lines (a
// day's games at once). NBA blocks server-side requests for past games;
// ESPN does not.

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  Accept: "application/json, text/plain, */*",
};

const ESPN_TO_NBA = { GS: "GSW", NJ: "NJN", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
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

export function parseBox(data) {
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
  // The stat labels ESPN sent, kept for diagnosing a box that parses wrong.
  const labels = (teamsBox[0]?.statistics?.[0]?.names || []).join(",");
  return { a, b, labels };
}

// The two places ESPN keeps a box score: the site API summary first, the
// CDN core (gamepackageJSON) for the older events whose summary comes back
// with empty player blocks. scripts/bake-regular-season-games.mjs walks the
// same pair with its own retrying fetch.
export const espnBoxUrls = (eventId) => [
  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`,
  `https://cdn.espn.com/core/nba/boxscore?xhr=1&gameId=${eventId}`,
];

// Some ESPN summaries list every player with no minutes (seen across
// 2012-13 to 2017-18), and a line with no minutes is left out downstream, so
// such a box is only used when no other source does better.
export const boxHasMinutes = (parsed) =>
  !!parsed && [parsed.a, parsed.b].every((side) => side.players.some((p) => p.mp > 0));

// A fetched ESPN payload (either source) -> { a, b } sides, or null.
export const parseEspnPayload = (d) => parseBox(d?.boxscore ? d : { boxscore: d?.gamepackageJSON?.boxscore || null });

async function fetchEspn(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal, cache: "no-store" });
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
export async function fetchEspnBox(eventId) {
  let parsed = null;
  try {
    const summary = await fetchEspn(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`);
    parsed = parseBox(summary);
  } catch {}
  if (!boxHasMinutes(parsed)) {
    try {
      const core = await fetchEspn(`https://cdn.espn.com/core/nba/boxscore?xhr=1&gameId=${eventId}`);
      const box = core?.gamepackageJSON?.boxscore || core?.boxscore || null;
      const fromCore = box ? parseBox({ boxscore: box }) : null;
      if (fromCore && (!parsed || boxHasMinutes(fromCore))) parsed = fromCore;
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
