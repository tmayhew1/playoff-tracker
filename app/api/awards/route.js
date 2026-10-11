import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const revalidate = 86400;

// Serves the baked Awards tab (scripts/bake-awards.mjs), one award at a time —
// ?award=mvp|mip|roy|allnba|allstar — so a sub-page loads only its own board.
// Immutable within a deployment.
const AWARDS = new Set(["mvp", "mip", "roy", "allnba", "allstar"]);
let cache = null;

export async function GET(request) {
  const award = new URL(request.url).searchParams.get("award");
  if (!AWARDS.has(award)) return Response.json({ error: "Unknown award" }, { status: 400 });
  try {
    cache ||= JSON.parse(await readFile(join(process.cwd(), "app", "data", "awards.json"), "utf8"));
    return Response.json({ bakedAt: cache.bakedAt, ...cache[award] }, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    });
  } catch {
    return Response.json({ error: "Awards not baked yet" }, { status: 503 });
  }
}
