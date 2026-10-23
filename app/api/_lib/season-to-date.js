import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { normalizeName } from "../../lib/format";
import { gamesWithBoxes, playerTotals, teamRecords } from "../../lib/season-to-date";

// The season in progress from its baked box scores (lib/season-to-date.js),
// read off disk: the player totals /api/regular-season serves while
// basketball-reference's table for the season isn't baked, and the games
// /api/projections updates the Look Ahead with.

// Traced into each route that imports this; next.config.js leaves out every
// season but the one in progress, the only one read here.
const DIR = join(process.cwd(), "public", "regular-season-games");
const DATA = join(process.cwd(), "app", "data");
const readJson = async (p) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; } };

const cache = new Map();

// { through, games, players, records } or null when the season isn't baked.
// Cached per index stamp: the bake is part of the deploy, so it only moves
// with a new one.
export async function seasonToDate(season) {
  const index = await readJson(join(DIR, season, "index.json"));
  if (!index?.games?.length) return null;
  const key = `${season}|${index.fetchedAt || index.through}`;
  if (cache.has(key)) return cache.get(key);
  let files = [];
  try { files = (await readdir(join(DIR, season))).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)); } catch { /* none */ }
  const months = (await Promise.all(files.map((f) => readJson(join(DIR, season, f))))).filter(Boolean);
  const games = gamesWithBoxes(index, months);
  const players = await withIds(playerTotals(games), season);
  const out = { season, through: index.through, complete: !!index.complete, games, players, records: teamRecords(games) };
  cache.set(key, out);
  return out;
}

// The box scores have names only; basketball-reference's slug and position
// come from the last two baked seasons, by name — a name two players share is
// left without one rather than guessed. A rookie has neither yet.
async function withIds(rows, season) {
  const y = Number(season.slice(0, 4));
  const prev = [1, 2].map((k) => `${y - k}-${String((y - k + 1) % 100).padStart(2, "0")}`);
  const byName = new Map();
  for (const s of prev.reverse()) {
    for (const p of (await readJson(join(DATA, `regular-season-${s}.json`)))?.players || []) {
      const k = normalizeName(p.name), cur = byName.get(k);
      byName.set(k, cur && cur.slug !== p.slug && cur.season === s ? { slug: null, pos: null, season: s } : { slug: p.slug, pos: p.pos, season: s });
    }
  }
  return rows.map((r) => {
    const id = byName.get(normalizeName(r.name));
    return { ...r, slug: id?.slug || null, pos: id?.pos || null };
  });
}
