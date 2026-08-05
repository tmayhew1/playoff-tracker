export const runtime = "nodejs";
// Never cached, never prerendered: this route exists to answer "what's the
// newest build?" for a page that may itself be an old build, so a cached
// answer would defeat the entire point.
export const dynamic = "force-dynamic";

// Build identity of the deployment serving this request. BUILD_ID is inlined
// at build time by next.config.js, so the value here belongs to the CURRENT
// deployment while a stale tab's bundle carries whatever it was built with —
// the difference is what BuildWatch compares.

export async function GET() {
  return new Response(JSON.stringify({ build: process.env.NEXT_PUBLIC_BUILD_ID || null }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0, must-revalidate",
    },
  });
}
