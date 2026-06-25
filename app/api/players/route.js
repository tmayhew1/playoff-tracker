import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const revalidate = 86400;

// Cross-season player index built from every baked leaderboard-<season>.json.
// Players are joined across seasons by their basketball-reference slug (stable
// across seasons; falls back to name when a slug is missing). Each player's
// seasons are returned ranked by playoff Value Added, which is what the
// Explore "By Player" view renders.

const FILE_RE = /^leaderboard-(\d{4}-\d{2})\.json$/;
const r2 = (n) => Math.round((n || 0) * 100) / 100;

export async function GET() {
  const dir = join(process.cwd(), "app", "data");
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    files = [];
  }
  const lbFiles = files.filter((f) => FILE_RE.test(f));

  const idx = new Map();
  for (const f of lbFiles) {
    let data;
    try {
      data = JSON.parse(await readFile(join(dir, f), "utf8"));
    } catch {
      continue; // skip an unreadable/partial file rather than fail the whole index
    }
    const season = data.season || f.match(FILE_RE)[1];
    for (const p of data.players || []) {
      const key = p.slug || p.name;
      if (!key) continue;
      let e = idx.get(key);
      if (!e) {
        e = { slug: p.slug || null, name: p.name, seasons: [] };
        idx.set(key, e);
      }
      // Keep the most recent display name (names occasionally change).
      if (season > (e._latest || "")) { e.name = p.name; e._latest = season; }
      e.seasons.push({
        season,
        team: p.team,
        gp: p.gp || 0,
        va: r2(p.va),
        vaPerG: p.gp ? r2(p.va / p.gp) : 0,
      });
    }
  }

  const players = [...idx.values()];
  for (const e of players) {
    delete e._latest;
    e.seasons.sort((a, b) => b.va - a.va);
    e.bestVa = e.seasons.length ? e.seasons[0].va : 0;
    e.careerVa = r2(e.seasons.reduce((s, x) => s + x.va, 0));
    e.teams = [...new Set(e.seasons.map((x) => x.team))];
  }
  // Default order: biggest career playoff VA first (drives nothing in the UI
  // beyond a stable, sensible initial sort for an empty search).
  players.sort((a, b) => b.careerVa - a.careerVa);

  return new Response(JSON.stringify({ players, seasonsIndexed: lbFiles.length }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
