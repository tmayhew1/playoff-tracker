import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const revalidate = 86400;

// Serves the baked per-player Defensive Ratings (basketball-reference DRtg,
// points allowed per 100 possessions) behind the D-Rating category / VA+:
//   { seasons: { "<season>": { rs: { "<slug>": drtg }, po: { ... } }, ... } }
// Baked by scripts/R/fetch_def_ratings.R; an empty map just means the bake
// hasn't run yet, and the app hides VA+ rather than erroring.
export async function GET() {
  let seasons = {};
  try {
    const path = join(process.cwd(), "app", "data", "def-ratings.json");
    seasons = JSON.parse(await readFile(path, "utf8"));
  } catch {
    // fall through to the empty map
  }
  return Response.json(
    { seasons },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}
