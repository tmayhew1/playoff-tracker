import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const revalidate = 86400;

// Each player-season's MVP % and MIP % (scripts/bake-awards.mjs), for the
// award boxes on a player card — small, so a card needn't load the boards.
export async function GET() {
  try {
    const body = await readFile(join(process.cwd(), "app", "data", "award-odds.json"), "utf8");
    return new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    });
  } catch {
    return Response.json({ odds: {} }, { headers: { "Cache-Control": "no-store" } });
  }
}
