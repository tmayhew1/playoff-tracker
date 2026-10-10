import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const revalidate = 86400;

// Serves the baked Awards tab (scripts/bake-awards.mjs): the MVP and MIP
// boards for every season. Immutable within a deployment.
export async function GET() {
  try {
    const body = await readFile(join(process.cwd(), "app", "data", "awards.json"), "utf8");
    return new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    });
  } catch {
    return Response.json({ error: "Awards not baked yet" }, { status: 503 });
  }
}
