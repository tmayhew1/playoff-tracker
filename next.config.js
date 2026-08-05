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

const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: buildId() },
};
module.exports = nextConfig;
