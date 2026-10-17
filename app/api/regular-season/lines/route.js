import { fetchEspnBox } from "../../_lib/espn-box";

export const runtime = "nodejs";
export const maxDuration = 15;

// Several finished games' box scores in one answer
// (/api/regular-season/lines?ids=401810001,401810002,…) — the Month Averages
// table asks for a day's games at a time, so a month is ~30 requests rather
// than one per game. Ids are ESPN event ids, as /api/regular-season/games
// hands them out. Lines come back unscored: the page prices them against
// whichever baseline the USG-ADJ switch is on.

const MAX_IDS = 20;
const ID_RE = /^\d{6,12}$/;

export async function GET(req) {
  const ids = (new URL(req.url).searchParams.get("ids") || "").split(",").filter(Boolean);
  if (!ids.length || ids.length > MAX_IDS || !ids.every((id) => ID_RE.test(id))) {
    return Response.json({ error: `ids: 1 to ${MAX_IDS} ESPN event ids, comma-separated` }, { status: 400 });
  }
  const errors = [];
  const boxes = await Promise.all(ids.map((id) =>
    fetchEspnBox(id).catch((e) => { errors.push(`${id}: ${e.message}`); return null; })));
  const games = boxes.filter(Boolean).map((b) => ({ gameId: b.gameId, home: b.home, away: b.away }));
  if (!games.length) {
    return Response.json({ error: `espn: ${errors.slice(0, 3).join("; ")}` }, { status: 500 });
  }
  // A finished game's box never changes; a partial answer is asked again soon.
  const maxAge = errors.length ? 3600 : 604800;
  return Response.json(
    { games, errors },
    { headers: { "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 4}` } },
  );
}
