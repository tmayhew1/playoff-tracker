import { headers } from "next/headers";
import { PlayoffTracker } from "./tracker";
import { parseShareParams, shareQuery } from "./lib/share-params";
import { shareSummary } from "./api/_lib/share-card";

// A shared link opens here with its view in the query string (format in
// lib/share-params.js). Parsed on the server for two reasons: the page's first
// render is already the linked view, and the link's preview — title,
// description, and the /api/og card image — is built from the same state.

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID || "";

function origin() {
  const h = headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

export async function generateMetadata({ searchParams }) {
  const st = parseShareParams(searchParams);
  const query = shareQuery(st);
  const base = origin();
  // The build id rides along so a new deployment's card is a new URL — the
  // same pinning lib/fetch-cache.js gives the data routes.
  const image = `${base}/api/og${query || "?"}${query ? "&" : ""}${BUILD ? `v=${BUILD.slice(0, 12)}` : ""}`;
  const sum = await shareSummary(st).catch(() => null);
  const title = sum?.title || "NBA Box Score Value Added Tracker";
  const description = sum?.description || "Value Added across every NBA season";
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${base}/${query}`,
      siteName: "Trey’s NBA Box Score · Value Added Tracker",
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function Page({ searchParams }) {
  return <PlayoffTracker initial={parseShareParams(searchParams)} />;
}
