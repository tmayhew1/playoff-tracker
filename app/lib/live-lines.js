// The night's games laid over the season in progress's baked totals, so the
// regular-season board moves while they're played
// (/api/regular-season/live). A game still on counts as the share of it
// played so far — Q3 with 6:00 left is 0.625 of a game — so a player's G,
// and every per-game number, reads as of the clock. A game gone final that
// the bake hasn't picked up yet counts whole.
//
// Pure — the route, the board and the tests all share it.

import { normalizeName } from "./format.js";
import { TOTAL_KEYS } from "./season-to-date.js";

const REG_SECS = 12 * 60, OT_SECS = 5 * 60;

// "PT05M21.00S" -> 321; "" -> null.
export function clockSeconds(iso) {
  const m = /^PT(\d+)M([\d.]+)S$/.exec(iso || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// The share of a game played, 0..1, from its period and the clock left in
// it. In overtime the game is that much longer, so the share is of the game
// as it now stands (regulation plus the overtimes reached).
export function gameFraction(g) {
  if (g.gameStatus === 3) return 1;
  if (g.gameStatus !== 2 || !(g.period > 0)) return 0;
  const p = g.period;
  const len = (k) => (k <= 4 ? REG_SECS : OT_SECS);
  let before = 0;
  for (let k = 1; k < p; k++) before += len(k);
  const left = clockSeconds(g.gameClock);
  const played = before + len(p) - Math.min(len(p), left ?? len(p));
  const total = 4 * REG_SECS + Math.max(0, p - 4) * OT_SECS;
  return Math.max(0, Math.min(1, played / total));
}

// Each player's line in the live games, as { name, tri, gameId, date, frac,
// live, ...TOTAL_KEYS }. `games` carry the slate fields (gameStatus, period,
// gameClock) and `box` ({ home, away } with players, as parseBox reads one).
export function liveLines(games) {
  const out = [];
  for (const g of games) {
    if (!g.box) continue;
    const frac = gameFraction(g);
    if (!(frac > 0)) continue;
    for (const side of [g.box.home, g.box.away]) {
      for (const p of side?.players || []) {
        if (!(p.mp > 0) || !p.name) continue;
        const line = { name: p.name, tri: side.tri, gameId: g.gameId, date: g.date || null, frac, live: g.gameStatus === 2 };
        for (const k of TOTAL_KEYS) line[k] = p[k] || 0;
        out.push(line);
      }
    }
  }
  return out;
}

// `players` (regular-season rows, `g` the games played) with `lines` added
// on: totals summed, G up by each game's share, `team` moved to the live
// team, and `live` set ({ gameId, date, frac }) on anyone in a game still on. A
// player the bake hasn't seen yet (a debut tonight) joins as a new row.
export function addLiveLines(players, lines) {
  if (!lines?.length) return players;
  const rows = players.map((p) => ({ ...p }));
  const by = new Map(rows.map((r) => [normalizeName(r.name), r]));
  for (const l of lines) {
    const k = normalizeName(l.name);
    let r = by.get(k);
    if (!r) {
      r = { name: l.name, team: l.tri, slug: null, g: 0 };
      for (const key of TOTAL_KEYS) r[key] = 0;
      rows.push(r);
      by.set(k, r);
    }
    r.team = l.tri;
    r.g = Math.round(((r.g || 0) + l.frac) * 1000) / 1000;
    for (const key of TOTAL_KEYS) r[key] = (r[key] || 0) + (l[key] || 0);
    if (l.live) r.live = { gameId: l.gameId, date: l.date, frac: l.frac };
  }
  return rows;
}
