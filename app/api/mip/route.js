import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const revalidate = 86400;

// Serves the baked MIP tab (scripts/bake-mip.mjs): every season's returning
// players, actual VA beside the summer-before projection, ranked by the MIP
// model. Immutable within a deployment.
export async function GET() {
  try {
    const body = await readFile(join(process.cwd(), "app", "data", "mip.json"), "utf8");
    return new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    });
  } catch {
    return Response.json({ error: "MIP data not baked yet" }, { status: 503 });
  }
}
