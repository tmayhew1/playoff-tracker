/** @type {import('next').NextConfig} */

// Identity of this build, inlined into both the client bundle and the
// /api/version route (see app/components/build-watch.js). It MUST come out
// identical every time this file is evaluated — Next evaluates it once per
// compiler pass, so anything time-based (Date.now()) hands the client and the
// route different ids and makes every tab think it's stale.
//
// Vercel sets VERCEL_GIT_COMMIT_SHA on every deployment. The git fallback
// covers local builds; when there's no identity to be had, the empty string
// leaves BuildWatch dormant rather than guessing.
function buildId() {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv;
  try {
    return require("node:child_process")
      .execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

// The season in progress's baked box scores are read off disk by the routes
// that add them up (app/api/_lib/season-to-date.js) — files under public/.
// File tracing follows that directory whole (~40 MB, every season), so the
// finished seasons are left out: those routes only read the one under way.
const GAMES = "public/regular-season-games";
function seasonUnderWay() {
  const d = new Date(), y = d.getUTCFullYear(), start = d.getUTCMonth() >= 9 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
function finishedSeasonGames() {
  try {
    const current = seasonUnderWay();
    return require("node:fs").readdirSync(GAMES).filter((s) => s !== current).map((s) => `./${GAMES}/${s}/**`);
  } catch {
    return [];
  }
}
// Every route that imports it: the two APIs, and the link preview (the page
// and its image).
const inSeasonRoutes = ["/api/regular-season", "/api/projections", "/api/og", "/"];

const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: buildId() },
  experimental: {
    outputFileTracingIncludes: Object.fromEntries(inSeasonRoutes.map((r) => [r, [`./${GAMES}/${seasonUnderWay()}/*.json`]])),
    outputFileTracingExcludes: Object.fromEntries(inSeasonRoutes.map((r) => [r, finishedSeasonGames()])),
  },
};
module.exports = nextConfig;
