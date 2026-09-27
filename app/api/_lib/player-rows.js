import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Player-season rows as the baked files hold them, and the per-season merge
// behind "combined" scope. Shared by /api/players (the cross-season index)
// and the share previews (app/api/_lib/share-card.js), so a preview's numbers
// come from the same join the page shows.

// Normalize a name for slug-less joins: strip diacritics + punctuation, lower.
export const norm = (s) => (s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Shot-distance zone makes/attempts (basketball-reference's Shooting page,
// baked by fetch_shooting_splits.R \u2014 see loadZoneMap/attachZones below).
// Summed generically alongside the rest of RAW_KEYS, so "combined" scope,
// per-season `raw`, and career totals all pick them up for free; seasons
// with no zone data (pre-1996-97, or not yet baked) just stay 0.
export const ZONE_SPEC = [
  ["z03", "z03m", "z03a"], ["z310", "z310m", "z310a"],
  ["z1016", "z1016m", "z1016a"], ["z16xp", "z16xpm", "z16xpa"],
];

export const RAW_KEYS = ["mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb",
  "fgm", "fga", "tpm", "tpa", "ftm", "fta",
  ...ZONE_SPEC.flatMap(([, mk, ak]) => [mk, ak])];

// Every player-season row from files matching `re`. Regular-season bakes call
// games `g` instead of `gp`; normalize here so downstream code sees one shape.
export async function loadRows(dir, files, re) {
  const rows = [];
  const matched = files.filter((f) => re.test(f));
  for (const f of matched) {
    let data;
    try {
      data = JSON.parse(await readFile(join(dir, f), "utf8"));
    } catch {
      continue; // skip an unreadable/partial file rather than fail the index
    }
    const season = data.season || f.match(re)[1];
    for (const p of data.players || []) {
      if (!p.name) continue;
      rows.push({ season, p: p.gp == null && p.g != null ? { ...p, gp: p.g } : p });
    }
  }
  return { rows, fileCount: matched.length };
}

// Per-season merge: playoff rows absorb their regular-season counterpart
// (matched by slug, then normalized name); regular-season players with no
// playoff row are kept as-is. Seasons that only have one file contribute
// whatever they have.
export function combineRows(lbRows, rsRows) {
  const rsBySeason = new Map();
  for (const { season, p } of rsRows) {
    let m = rsBySeason.get(season);
    if (!m) rsBySeason.set(season, (m = new Map()));
    if (p.slug) m.set("s:" + p.slug, p);
    const n = "n:" + norm(p.name);
    if (!m.has(n)) m.set(n, p);
  }
  const used = new Set();
  const out = [];
  for (const { season, p } of lbRows) {
    const m = rsBySeason.get(season);
    const r = m ? ((p.slug && m.get("s:" + p.slug)) || m.get("n:" + norm(p.name)) || null) : null;
    if (r) used.add(r);
    const sum = { name: p.name, slug: p.slug || (r && r.slug) || undefined, team: p.team, gp: (p.gp || 0) + (r ? r.gp || 0 : 0) };
    for (const k of RAW_KEYS) sum[k] = (p[k] || 0) + (r ? r[k] || 0 : 0);
    // The two halves are kept alongside the sum because they are scored against
    // DIFFERENT baselines — regular-season minutes against the regular season,
    // playoff minutes against the playoff blend (spec §4.8). The row still
    // displays as one combined stat line; only its VA is built from the parts.
    sum._po = p;
    sum._rs = r || null;
    out.push({ season, p: sum });
  }
  for (const { season, p } of rsRows) {
    if (!used.has(p)) out.push({ season, p });
  }
  return out;
}
