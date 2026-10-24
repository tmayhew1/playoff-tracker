import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeName } from "../../lib/format";
import { withTeamContext } from "../_lib/team-context";
import { projectRookies, rookieClassNames } from "../_lib/rookies";
import { mergeInjuries, parseEspnInjuries, withInjuries } from "../../lib/injuries";
import { lgaForSeason, valueAdd } from "../../scoring";
import { seasonToDate, withFinals } from "../_lib/season-to-date";
import { unbakedGames } from "../_lib/unbaked-games";
import { withSeasonToDate } from "../_lib/in-season";

export const runtime = "nodejs";
export const maxDuration = 15;
// Re-read every quarter hour, so a game that has gone final since the bake
// moves the projection the same night (the ESPN box scores, below). Rosters
// and injuries move more slowly and keep their own six-hour cache.
export const revalidate = 900;
const ESPN_REVALIDATE = 21600;

// The 2026-27 Look Ahead: the baked projection (scripts/fit-projection-model.mjs)
// with every player placed on their team as of NOW.
//
// The bake knows each player's last team, which misses every offseason move
// and every traded player's final stop (a "2TM" row has no single team). So
// the current rosters are read from ESPN at request time and joined to the
// projection by name. A player on no roster — retired, unsigned, overseas —
// comes back with `team: null`; a roster player the projection has never
// seen is projected from their last college season when the college data has
// them (_lib/rookies.js), and otherwise listed under `unprojected` — an
// international or a G League player has nothing here to project from.
//
// When ESPN can't be reached the response says so (`rosters: "baked"`) and
// every player keeps their last team, so the page still renders.
//
// Injuries (lib/injuries.js) are placed before the team context, so the
// minutes an injured player gives up go to the teammates: ESPN's injury feed
// read live, merged with the reported list in data/injuries.json. A player out
// for the season leaves the board and is listed under `injuredOut`.
//
// The season so far is the baked box scores through last night plus every
// game ESPN has as final since (_lib/unbaked-games.js) — whole games only: the
// in-season weights were fit on finished games, and a game in progress would
// swing the odds one way and back.

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const ESPN_TO_NBA = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
const MULTI = /^(TOT|\dTM)$/;

async function fetchJson(url, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, next: { revalidate: ESPN_REVALIDATE } });
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
// unique on both sides ("Nic Claxton" / "Nicolas Claxton"), never for a name
// in `rookies` (this year's draft class and college players).
function joinRosters(players, rosters, rookies = new Set()) {
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
  const openRoster = [...byName.values()].filter((r) => !r.used && !rookies.has(normalizeName(r.name)));
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

// ESPN's injury listings, parsed, or null when the feed can't be read.
async function liveInjuries() {
  try {
    return parseEspnInjuries(await fetchJson(`${ESPN}/injuries`));
  } catch {
    return null;
  }
}

// The Awards tab's fits (scripts/bake-awards.mjs) — the Look Ahead simulates
// the same MVP, ROY and All-Star models on the projected season.
async function readAwardModels() {
  try {
    const a = JSON.parse(await readFile(join(process.cwd(), "app", "data", "awards.json"), "utf8"));
    return { mvp: { beta: a.mvp.model.beta }, roy: { beta: a.roy.model.beta }, allstar: { beta: a.allstar.model.beta } };
  } catch {
    return null;
  }
}

// How far the season so far moves the projection (scripts/fit-in-season.mjs).
async function readInSeasonModel() {
  try {
    return JSON.parse(await readFile(join(process.cwd(), "app", "data", "in-season-model.json"), "utf8"));
  } catch {
    return null;
  }
}

async function readInjuries() {
  try {
    return JSON.parse(await readFile(join(process.cwd(), "app", "data", "injuries.json"), "utf8"));
  } catch {
    return null;
  }
}

// The baked season so far, with tonight's finals (and any day the bake has
// missed) on top; just the bake when ESPN can't be reached.
async function seasonToDateWithFinals(season) {
  const toDate = await seasonToDate(season);
  if (!toDate || toDate.complete) return toDate;
  try {
    const { games, pending } = await unbakedGames(season, toDate.through, { finalOnly: true });
    const out = await withFinals(toDate, games);
    return out === toDate ? toDate : { ...out, partial: pending.includes(out.through) };
  } catch {
    return toDate;
  }
}

export async function GET() {
  let baked;
  try {
    baked = JSON.parse(await readFile(join(process.cwd(), "app", "data", "projection-2026-27.json"), "utf8"));
  } catch {
    return Response.json({ error: "projection not baked — run npm run fit:projections" }, { status: 500 });
  }
  const [rosters, reported, live, awardModels, toDate, inSeasonModel] = await Promise.all([
    liveRosters(), readInjuries(), liveInjuries(), readAwardModels(), seasonToDateWithFinals(baked.season), readInSeasonModel(),
  ]);
  const curated = reported?.season === baked.season ? reported : null;
  let players, unprojected = {};
  if (rosters) {
    const j = joinRosters(baked.players, rosters, await rookieClassNames(baked));
    unprojected = j.unprojected;
    players = baked.players.map((p) => ({ ...p, team: j.teamOf.get(p.slug) || null }));
    // Rookies join before the team context, so they take their share too.
    const r = await projectRookies(unprojected, baked);
    players = [...players, ...r.rookies];
    unprojected = r.unprojected;
  } else {
    players = baked.players.map((p) => ({ ...p, team: MULTI.test(p.team) ? null : p.team }));
  }
  const injuredOut = {};
  const season = { seasonStart: curated?.seasonStart, seasonEnd: curated?.seasonEnd, schedule: 82 };
  if (curated || live) {
    const lga = lgaForSeason(baked.base);
    players = withInjuries(players, mergeInjuries(curated, live || []), season, (row) => valueAdd(row, lga));
    // Out for the season: off the board, named under the team.
    for (const p of players) {
      if (p.row.g > 0) continue;
      (injuredOut[p.team || "FA"] ||= []).push({ name: p.name, injury: p.injury.injury, note: p.injury.note });
    }
    players = players.filter((p) => p.row.g > 0);
  }
  players = withTeamContext(players, baked);
  // Once games have been played, the projection above is the prior and the
  // season so far is mixed in (lib/in-season.js); a roster player with no
  // projection who is playing joins the board.
  let inSeason = null;
  if (toDate?.players?.length && inSeasonModel) {
    players = withSeasonToDate(players, toDate, inSeasonModel, baked, season);
    const placed = new Set(players.filter((p) => p.unprojected).map((p) => normalizeName(p.name)));
    for (const t of Object.keys(unprojected)) {
      unprojected[t] = unprojected[t].filter((n) => !placed.has(normalizeName(n)));
      if (!unprojected[t].length) delete unprojected[t];
    }
    inSeason = {
      through: toDate.through,
      // Games final since the morning bake, and whether the last day still has
      // games to finish (the label reads "so far" then).
      finals: toDate.finals || 0, partial: !!toDate.partial,
      games: toDate.games.filter((g) => g.home?.score > 0).length,
      records: toDate.records,
      model: { team: inSeasonModel.team, rate: inSeasonModel.rate, pct: inSeasonModel.pct, mpg: inSeasonModel.mpg, avail: inSeasonModel.avail, va: inSeasonModel.va, seasons: inSeasonModel.seasons, report: inSeasonModel.report },
    };
  }
  return Response.json(
    {
      ...baked, players, unprojected, injuredOut, awardModels, inSeason, rosters: rosters ? "live" : "baked", rostersAt: new Date().toISOString(),
      injuries: live ? "live" : curated ? "reported" : "none", injuriesAsOf: curated?.players?.reduce((m, e) => (e.asOf > m ? e.asOf : m), "") || null,
    },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600" } },
  );
}
