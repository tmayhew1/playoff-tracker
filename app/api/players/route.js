import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { valueAddParts, lgaForSeason, combinedLga } from "../../scoring";
import { RAW_KEYS, ZONE_SPEC, combineRows, loadRows, norm } from "../_lib/player-rows";

export const runtime = "nodejs";

// Cross-season player index. ?scope= selects which games count:
//   playoffs  (default) built from every baked leaderboard-<season>.json
//   regular   built from every baked regular-season-<season>.json
//   combined  per-season merge of both (raw stats summed, VA recomputed)
// Players are joined across seasons by their basketball-reference slug. Older
// bakes sometimes lack a slug; those seasons are merged into the slugged player
// of the same (normalized) name so a player isn't split into two entries. Each
// season carries its raw totals so the UI can render the per-category VA
// breakdown.

const LB_RE = /^leaderboard-(\d{4}-\d{2})\.json$/;
const RS_RE = /^regular-season-(\d{4}-\d{2})\.json$/;
const SHOOTING_RE = /^shooting-(\d{4}-\d{2})\.json$/;
const r2 = (n) => Math.round((n || 0) * 100) / 100;
const r1 = (n) => Math.round((n || 0) * 10) / 10;


// season -> "rs"|"po" -> join key -> flat zone fields, from every baked
// shooting-<season>.json. Loaded once per request and consulted by
// attachZones() for both the LB_RE (playoffs) and RS_RE (regular) row sets.
async function loadZoneMap(dir, files) {
  const map = new Map();
  for (const f of files.filter((f) => SHOOTING_RE.test(f))) {
    let data;
    try {
      data = JSON.parse(await readFile(join(dir, f), "utf8"));
    } catch {
      continue;
    }
    const season = data.season;
    if (!season) continue;
    const bySide = map.get(season) || {};
    for (const side of ["rs", "po"]) {
      const players = data[side]?.players;
      if (!players) continue;
      const byKey = new Map();
      for (const p of players) {
        const flat = {};
        for (const [zk, mk, ak] of ZONE_SPEC) {
          flat[mk] = p[zk]?.fgm || 0;
          flat[ak] = p[zk]?.fga || 0;
        }
        const key = p.slug ? "s:" + p.slug : "n:" + norm(p.name || "");
        byKey.set(key, flat);
      }
      bySide[side] = byKey;
    }
    map.set(season, bySide);
  }
  return map;
}

// Attaches one side's ("rs" or "po") zone fields onto rows in place, joined
// by slug first then normalized name — same join key combineRows() already
// uses. Rows with no match (no zone data for that season/player) are left
// untouched; RAW_KEYS' generic `p[k] || 0` summing treats that as zero.
function attachZones(rows, zoneMap, side) {
  for (const { season, p } of rows) {
    const byKey = zoneMap.get(season)?.[side];
    if (!byKey) continue;
    const flat = (p.slug && byKey.get("s:" + p.slug)) || byKey.get("n:" + norm(p.name || ""));
    if (flat) Object.assign(p, flat);
  }
}


export async function GET(req) {
  const scopeParam = new URL(req.url).searchParams.get("scope") || "playoffs";
  const scope = ["playoffs", "regular", "combined"].includes(scopeParam) ? scopeParam : "playoffs";

  const dir = join(process.cwd(), "app", "data");
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    files = [];
  }

  // Pass 1: gather every player-season row for the requested scope, then
  // attach shot-distance zone fields from the matching side ("po" for
  // playoff rows, "rs" for regular-season rows) of each shooting-<season>.json.
  const zoneMap = await loadZoneMap(dir, files);
  let rows, fileCount;
  if (scope === "regular") {
    ({ rows, fileCount } = await loadRows(dir, files, RS_RE));
    attachZones(rows, zoneMap, "rs");
  } else if (scope === "combined") {
    const lb = await loadRows(dir, files, LB_RE);
    attachZones(lb.rows, zoneMap, "po");
    const rs = await loadRows(dir, files, RS_RE);
    attachZones(rs.rows, zoneMap, "rs");
    rows = combineRows(lb.rows, rs.rows);
    fileCount = Math.max(lb.fileCount, rs.fileCount);
  } else {
    ({ rows, fileCount } = await loadRows(dir, files, LB_RE));
    attachZones(rows, zoneMap, "po");
  }

  // Playoff bakes carry VA; regular rows need it computed against the season's
  // regular-season baselines.
  //
  // A combined row summed two lines played in two different leagues, so it is
  // scored against the minutes-weighted mix of the two baselines
  // (scoring.js::combinedLga) — which, every per-minute term being linear in
  // its baseline, is exactly the two halves scored separately and added. That
  // keeps this row agreeing with the playoff board about its playoff minutes
  // and with the regular-season board about the rest, and it is the same
  // baseline the Combined leaderboard scores with client-side.
  const vaOf = (season, p) => {
    if (scope === "playoffs") return p.va;
    const lga = scope === "combined" && (p._po || p._rs)
      ? combinedLga(season, p._rs?.mp || 0, p._po?.mp || 0)
      : lgaForSeason(season);
    return valueAddParts(p, lga).va;
  };

  // normalized-name -> slug, from rows that DO have a slug. Lets slug-less rows
  // attach to the right player instead of forming a duplicate keyed by name.
  const nameToSlug = new Map();
  for (const { p } of rows) {
    if (p.slug) {
      const n = norm(p.name);
      if (!nameToSlug.has(n)) nameToSlug.set(n, p.slug);
    }
  }

  const idx = new Map();
  for (const { season, p } of rows) {
    const slug = p.slug || nameToSlug.get(norm(p.name)) || null;
    const key = slug || ("name:" + norm(p.name));
    let e = idx.get(key);
    if (!e) {
      e = { slug, name: p.name, seasons: [] };
      idx.set(key, e);
    }
    // Keep the most recent display name (and a real slug if one shows up).
    if (season > (e._latest || "")) { e.name = p.name; e._latest = season; if (p.slug) e.slug = p.slug; }
    const raw = {};
    for (const k of RAW_KEYS) raw[k] = k === "mp" ? r1(p[k]) : (p[k] || 0);
    const va = vaOf(season, p);
    e.seasons.push({
      season,
      team: p.team,
      gp: p.gp || 0,
      va: r2(va),
      vaPerG: p.gp ? r2(va / p.gp) : 0,
      ...raw,
      // The playoff half of a combined row's minutes. One number, and it is
      // what lets the client rebuild the exact mixed baseline this row was
      // scored against — without it, re-pricing under USG-ADJ would apply the
      // mode's delta at a baseline the row was never measured on (spec §4.8).
      ...(scope === "combined" && p._po?.mp > 0 ? { mpPo: r1(p._po.mp) } : {}),
    });
  }

  const players = [...idx.values()];
  for (const e of players) {
    delete e._latest;
    e.seasons.sort((a, b) => b.va - a.va);
    e.bestVa = e.seasons.length ? e.seasons[0].va : 0;
    e.careerVa = r2(e.seasons.reduce((s, x) => s + x.va, 0));
    e.teams = [...new Set(e.seasons.map((x) => x.team))];
  }
  players.sort((a, b) => b.careerVa - a.careerVa);

  return new Response(JSON.stringify({ scope, players, seasonsIndexed: fileCount }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
