import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const revalidate = 86400;

// Serves the baked top-college-players file (top men's D-I players for the
// season, ranked by Value Added), produced by scripts/R/fetch_college.R via
// the bake-college workflow. Returns `missing: true` until the bake has run.
const SEASON = "2025-26";

export async function GET() {
  try {
    const path = join(process.cwd(), "app", "data", `college-${SEASON}.json`);
    const data = JSON.parse(await readFile(path, "utf8"));
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new Response(JSON.stringify({ season: SEASON, players: [], missing: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
