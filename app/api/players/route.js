import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const revalidate = 86400;

// Cross-season player index built from every baked leaderboard-<season>.json.
// Players are joined across seasons by their basketball-reference slug. Older
// bakes sometimes lack a slug; those seasons are merged into the slugged player
// of the same (normalized) name so a player isn't split into two entries. Each
// season carries its raw totals so the UI can render the per-category VA
// breakdown.

const FILE_RE = /^leaderboard-(\d{4}-\d{2})\.json$/;
const r2 = (n) => Math.round((n || 0) * 100) / 100;
// Normalize a name for slug-less joins: strip diacritics + punctuation, lower.
const norm = (s) => (s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const RAW_KEYS = ["mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb",
  "fgm", "fga", "tpm", "tpa", "ftm", "fta"];

export async function GET() {
  const dir = join(process.cwd(), "app", "data");
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    files = [];
  }
  const lbFiles = files.filter((f) => FILE_RE.test(f));

  // Pass 1: gather every player-season row.
  const rows = [];
  for (const f of lbFiles) {
    let data;
    try {
      data = JSON.parse(await readFile(join(dir, f), "utf8"));
    } catch {
      continue; // skip an unreadable/partial file rather than fail the index
    }
    const season = data.season || f.match(FILE_RE)[1];
    for (const p of data.players || []) {
      if (p.name) rows.push({ season, p });
    }
  }

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
    for (const k of RAW_KEYS) raw[k] = p[k] || 0;
    e.seasons.push({
      season,
      team: p.team,
      gp: p.gp || 0,
      va: r2(p.va),
      vaPerG: p.gp ? r2(p.va / p.gp) : 0,
      ...raw,
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

  return new Response(JSON.stringify({ players, seasonsIndexed: lbFiles.length }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
