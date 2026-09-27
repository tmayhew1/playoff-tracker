import { GET as playersGET } from "../players/route";

export const runtime = "nodejs";

// A slim index of every player, for Explore's search palette: name, slug,
// teams (latest first), career and best VA, first/last season, and VA season
// by season for the sparkline. Derived from /api/players' combined index —
// the same numbers By Player shows — at a fraction of its weight (that one
// carries every raw stat for every season, ~1.4 MB gzipped).

let cached = null;

async function build() {
  const res = await playersGET(new Request("http://local/api/players?scope=combined"));
  const { players } = await res.json();
  return players.map((p) => {
    const bySeason = [...p.seasons].sort((a, b) => a.season.localeCompare(b.season));
    const teams = [];
    for (const s of [...bySeason].reverse()) if (!/^(TOT|\dTM)$/.test(s.team) && !teams.includes(s.team)) teams.push(s.team);
    return {
      s: p.slug, n: p.name, t: teams,
      c: Math.round(p.careerVa * 10) / 10,
      b: Math.round(p.bestVa * 10) / 10,
      f: bySeason[0]?.season || null,
      l: bySeason[bySeason.length - 1]?.season || null,
      v: bySeason.map((s) => Math.round(s.va)),
    };
  });
}

export async function GET() {
  if (!cached) cached = build().catch((e) => { cached = null; throw e; });
  const players = await cached;
  return Response.json(
    { players },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000" } },
  );
}
