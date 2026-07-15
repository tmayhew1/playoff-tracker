import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Shared shot-distance zone merge: every bake-first API route (players,
// leaderboard, regular-season) needs the same "flatten shooting-<season>.json
// onto a player row, joined by slug then normalized name" logic, since
// ComparePanel/compareStatRows and the closest-comps SHOOT metric read
// z03m/z03a/z310m/z310a/z1016m/z1016a/z16xpm/z16xpa off whatever row object
// happened to reach them — regardless of which route it came from.

const norm = (s) => (s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const ZONE_SPEC = [
  ["z03", "z03m", "z03a"], ["z310", "z310m", "z310a"],
  ["z1016", "z1016m", "z1016a"], ["z16xp", "z16xpm", "z16xpa"],
];

export const ZONE_KEYS = ZONE_SPEC.flatMap(([, mk, ak]) => [mk, ak]);

// One side ("rs" or "po") of shooting-<season>.json, keyed "s:<slug>" /
// "n:<normalized name>" -> flat {z03m,z03a,...}. Null if that season has no
// shooting bake yet (pre-1996-97, or not baked) — callers treat a null
// zoneMap as "nothing to attach", not an error.
export async function loadZoneSide(season, side) {
  try {
    const path = join(process.cwd(), "app", "data", `shooting-${season}.json`);
    const data = JSON.parse(await readFile(path, "utf8"));
    const players = data?.[side]?.players;
    if (!players) return null;
    const map = new Map();
    for (const p of players) {
      const flat = {};
      for (const [zk, mk, ak] of ZONE_SPEC) {
        flat[mk] = p[zk]?.fgm || 0;
        flat[ak] = p[zk]?.fga || 0;
      }
      if (p.slug) map.set("s:" + p.slug, flat);
      const n = "n:" + norm(p.name || "");
      if (!map.has(n)) map.set(n, flat);
    }
    return map;
  } catch {
    return null;
  }
}

// Attaches zone fields onto each row in `rows`, IN PLACE, joined by slug
// first then normalized name. Rows with no match are left untouched — every
// consumer already treats a missing zone key as zero (hasZoneData/RAW_KEYS'
// `p[k] || 0`).
export function attachZoneFields(rows, zoneMap) {
  if (!zoneMap || !rows) return;
  for (const p of rows) {
    const flat = (p.slug && zoneMap.get("s:" + p.slug)) || zoneMap.get("n:" + norm(p.name || ""));
    if (flat) Object.assign(p, flat);
  }
}

export { norm as normalizeNameForZones };
