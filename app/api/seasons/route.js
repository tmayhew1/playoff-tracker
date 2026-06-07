import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const revalidate = 86400;

// Union of (a) every season that has a baked history-<season>.json on disk
// (the source-of-truth signal that the bake pipeline succeeded for that
// season) and (b) the ESPN live-fallback range, so seasons that haven't
// been baked yet still appear in the picker and the live /api/history
// route handles them. Returns newest first.

const SEASON_FILE_RE = /^history-(\d{4}-\d{2})\.json$/;

function liveRange() {
  // ESPN's scoreboard endpoint reliably covers 1999-00 onward; older
  // seasons mostly come back with no playoff data, so we don't surface
  // them in the picker unless the bake has produced a file for them.
  const out = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 1; y >= 1999; y--) {
    const end = String((y + 1) % 100).padStart(2, "0");
    out.push(`${y}-${end}`);
  }
  return out;
}

export async function GET() {
  let baked = [];
  try {
    const files = await readdir(join(process.cwd(), "app", "data"));
    baked = files
      .map((f) => f.match(SEASON_FILE_RE)?.[1])
      .filter(Boolean);
  } catch {
    // No data dir on disk (e.g., misconfigured deploy) — fall through to
    // the live range only.
  }

  const all = new Set([...baked, ...liveRange()]);
  const seasons = [...all].sort((a, b) => b.localeCompare(a));
  return new Response(JSON.stringify({ seasons, baked }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
