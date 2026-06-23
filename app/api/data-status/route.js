import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const revalidate = 3600;

// Reports when the baked data was last refreshed, for the in-app Info page.
// `fetchedAt` is stamped into each file by the R bake, so the newest one
// across all seasons is effectively "last time the pipeline refreshed data".

const HIST_RE = /^history-(\d{4}-\d{2})\.json$/;
const CURRENT_SEASON = "2025-26";

export async function GET() {
  const dir = join(process.cwd(), "app", "data");
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    files = [];
  }
  const histFiles = files.filter((f) => HIST_RE.test(f));

  let lastRefresh = null;
  let latestRefreshedSeason = null;
  let currentSeasonRefresh = null;

  for (const f of histFiles) {
    try {
      const d = JSON.parse(await readFile(join(dir, f), "utf8"));
      const season = d.season || f.match(HIST_RE)[1];
      if (d.fetchedAt && (!lastRefresh || d.fetchedAt > lastRefresh)) {
        lastRefresh = d.fetchedAt;
        latestRefreshedSeason = season;
      }
      if (season === CURRENT_SEASON) currentSeasonRefresh = d.fetchedAt || null;
    } catch {
      // skip unreadable file
    }
  }

  const seasons = histFiles
    .map((f) => f.match(HIST_RE)[1])
    .sort((a, b) => a.localeCompare(b));

  return new Response(
    JSON.stringify({
      lastRefresh,
      latestRefreshedSeason,
      currentSeasonRefresh,
      seasonsBaked: histFiles.length,
      earliestSeason: seasons[0] || null,
      latestSeason: seasons[seasons.length - 1] || null,
      source: "basketball-reference",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    }
  );
}
