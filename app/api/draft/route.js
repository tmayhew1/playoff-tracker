import { HISTORY, scoreHistory } from "../../historical";
import { rosterStrength } from "../../lib/draft-model";
import { seasonRosters } from "../_lib/draft-data";
import MODEL from "../../data/draft-model.json";

export const runtime = "nodejs";

// The draft assistant's inputs for one draft season (/api/draft?season=…):
// the 16 teams as drafted — seed, conference, owner — each with its strength
// and the players behind it, plus what each team actually scored once the
// season is over. The odds and the advice are computed in the page
// (lib/draft-model.js), so reassigning a team there re-runs them instantly.

export async function GET(req) {
  // No season asked for: the newest draft.
  const season = new URL(req.url).searchParams.get("season") || Object.keys(HISTORY)[0];
  const h = HISTORY[season];
  if (!h) {
    return Response.json({ error: "unknown draft season", seasons: Object.keys(HISTORY) }, { status: 404 });
  }
  const ros = await seasonRosters(season);
  const scored = h.bracket?.r4?.[0]?.winner ? scoreHistory(season) : null;
  const actual = {};
  for (const items of Object.values(scored?.breakdown || {})) {
    for (const x of items) {
      const tri = Object.keys(h.teams).find((t) => h.teams[t] === x.team);
      if (tri) actual[tri] = (actual[tri] || 0) + x.total;
    }
  }
  const teams = {};
  for (const [tri, t] of Object.entries(h.teams)) {
    const roster = ros?.rosters[tri] || [];
    teams[tri] = {
      name: t.name, seed: t.seed, conf: t.conf, owner: t.owner,
      strength: rosterStrength(roster, ros?.seasonGames, MODEL.n),
      top: roster.slice(0, 3).map((p) => ({ name: p.name, slug: p.slug, vaPerG: p.g ? p.va / p.g : 0 })),
      actual: scored ? actual[tri] || 0 : null,
    };
  }
  return Response.json(
    {
      season,
      seasons: Object.keys(HISTORY),
      champion: h.champion || null,
      rosterSource: ros?.source || null,
      model: { n: MODEL.n, k: MODEL.k, h: MODEL.h, fit: MODEL.fit },
      teams,
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}
