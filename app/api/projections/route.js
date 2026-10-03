import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeName } from "../../lib/format";

export const runtime = "nodejs";
export const maxDuration = 15;
// Rosters move all offseason; the projection itself only changes with a bake.
export const revalidate = 21600;

// The 2026-27 Look Ahead: the baked projection (scripts/fit-projection-model.mjs)
// with every player placed on their team as of NOW.
//
// The bake knows each player's last team, which misses every offseason move
// and every traded player's final stop (a "2TM" row has no single team). So
// the current rosters are read from ESPN at request time and joined to the
// projection by name. A player on no roster — retired, unsigned, overseas —
// comes back with `team: null`; a roster player the projection has never
// seen (a rookie, a returnee from abroad) is listed under `unprojected`, since
// with no NBA seasons there is nothing to project from.
//
// When ESPN can't be reached the response says so (`rosters: "baked"`) and
// every player keeps their last team, so the page still renders.

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const ESPN_TO_NBA = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
const MULTI = /^(TOT|\dTM)$/;

async function fetchJson(url, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, next: { revalidate } });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// { NBA tricode: [display names] } for all 30 teams, or null.
async function liveRosters() {
  try {
    const list = await fetchJson(`${ESPN}/teams`);
    const teams = (list?.sports?.[0]?.leagues?.[0]?.teams || []).map((t) => t.team).filter((t) => t?.id);
    if (teams.length < 30) return null;
    const out = {};
    await Promise.all(teams.map(async (t) => {
      const d = await fetchJson(`${ESPN}/teams/${t.id}/roster`);
      const tri = ESPN_TO_NBA[t.abbreviation] || t.abbreviation;
      out[tri] = (d?.athletes || []).map((a) => a.fullName || a.displayName).filter(Boolean);
    }));
    // A partial answer would quietly drop whole teams' players — all or nothing.
    return Object.keys(out).length >= 30 && Object.values(out).every((r) => r.length) ? out : null;
  } catch {
    return null;
  }
}

// Joins roster names to projected players: an exact normalized-name match
// first, then for whoever is left, surname + first initial when that pair is
// unique on both sides ("Nic Claxton" / "Nicolas Claxton").
function joinRosters(players, rosters) {
  const byName = new Map();
  for (const [team, names] of Object.entries(rosters)) {
    for (const n of names) byName.set(normalizeName(n), { team, name: n, used: false });
  }
  const teamOf = new Map();
  for (const p of players) {
    const hit = byName.get(normalizeName(p.name));
    if (hit && !hit.used) { hit.used = true; teamOf.set(p.slug, hit.team); }
  }
  const loose = (n) => {
    const parts = normalizeName(n).split(" ");
    return parts.length > 1 ? `${parts[0][0]} ${parts.slice(1).join(" ")}` : null;
  };
  const count = (list, key) => list.reduce((m, x) => { const k = key(x); if (k) m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());
  const openRoster = [...byName.values()].filter((r) => !r.used);
  const openPlayers = players.filter((p) => !teamOf.has(p.slug));
  const rc = count(openRoster, (r) => loose(r.name)), pc = count(openPlayers, (p) => loose(p.name));
  for (const p of openPlayers) {
    const k = loose(p.name);
    if (!k || rc.get(k) !== 1 || pc.get(k) !== 1) continue;
    const r = openRoster.find((x) => loose(x.name) === k);
    r.used = true;
    teamOf.set(p.slug, r.team);
  }
  const unprojected = {};
  for (const r of byName.values()) if (!r.used) (unprojected[r.team] ||= []).push(r.name);
  return { teamOf, unprojected };
}

export async function GET() {
  let baked;
  try {
    baked = JSON.parse(await readFile(join(process.cwd(), "app", "data", "projection-2026-27.json"), "utf8"));
  } catch {
    return Response.json({ error: "projection not baked — run npm run fit:projections" }, { status: 500 });
  }
  const rosters = await liveRosters();
  let players, unprojected = {};
  if (rosters) {
    const j = joinRosters(baked.players, rosters);
    unprojected = j.unprojected;
    players = baked.players.map((p) => ({ ...p, team: j.teamOf.get(p.slug) || null }));
  } else {
    players = baked.players.map((p) => ({ ...p, team: MULTI.test(p.team) ? null : p.team }));
  }
  return Response.json(
    { ...baked, players, unprojected, rosters: rosters ? "live" : "baked", rostersAt: new Date().toISOString() },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400" } },
  );
}
