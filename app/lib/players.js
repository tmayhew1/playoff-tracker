"use client";

import { LGA, valueAdd } from "../scoring";
import { normalizeName } from "./format";


// Flatten a /api/players index into the pools CategoryContext ranks against:
// every player-season row (all-time pool) plus the same rows grouped by
// season. Rows are tagged with the owner's name + slug for identity checks.
export function buildScopePools(indexPlayers) {
  const allRows = [];
  const poolsBySeason = new Map();
  for (const pl of indexPlayers) {
    for (const s of pl.seasons) {
      const row = { ...s, name: pl.name, slug: pl.slug || null };
      allRows.push(row);
      if (!poolsBySeason.has(s.season)) poolsBySeason.set(s.season, []);
      poolsBySeason.get(s.season).push(row);
    }
  }
  return { allRows, poolsBySeason };
}


// Find the index entry for a leaderboard/rs row (slug first, then name).
export function findIndexPlayer(indexPlayers, row) {
  if (!indexPlayers) return null;
  if (row.slug) {
    const hit = indexPlayers.find((pl) => pl.slug === row.slug);
    if (hit) return hit;
  }
  const n = normalizeName(row.name || "");
  return indexPlayers.find((pl) => normalizeName(pl.name) === n) || null;
}


// Helper: aggregate raw stat snapshots into a player object matching what
// VABreakdown expects (mp/pts/.../fgm/.../va), preserving identity.
export function aggregateSnapshots(base, snapshots) {
  const out = {
    name: base.name, team: base.team,
    gp: 0, va: 0, eff: 0,
    mp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
    fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, drb: 0, orb: 0,
  };
  for (const s of snapshots) {
    if (!s) continue;
    out.gp += 1;
    out.va += s.va || 0;
    for (const k of ["mp", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "drb", "orb"]) {
      out[k] += s[k] || 0;
    }
  }
  return out;
}


export function getSortedPlayers(box, lga = LGA) {
  if (!box) return [];
  return [
    ...(box.away?.players || []).map((p) => ({ ...p, team: box.away.tri })),
    ...(box.home?.players || []).map((p) => ({ ...p, team: box.home.tri })),
  ]
    .filter((p) => (p.mp || 0) > 0)
    .map((p) => ({ ...p, va: valueAdd(p, lga) }))
    .sort((a, b) => b.va - a.va);
}
