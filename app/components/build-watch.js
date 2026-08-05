"use client";

import { useEffect } from "react";


// Reloads the page when the deployment it came from is no longer the current
// one. Nothing renders — it's mounted once from the root layout.
//
// The problem it solves is specific to using this app from a phone: iOS Safari
// keeps the tab alive for days, and tapping a Home Screen icon usually just
// re-focuses that tab, restoring the rendered page without re-requesting the
// document. Next.js chunk filenames are content-hashed and old chunks stay on
// the CDN, so the restored page keeps working perfectly — as whatever version
// shipped the day the tab was opened. Nothing looks broken; the app is just
// silently old, which is how a merged feature can seem not to have shipped.
//
// So: every time the page comes back to the foreground, ask the server which
// build is current. The fetch is `no-store` because a cached answer would come
// from the same stale place as the page asking the question.

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID || "";
// Per-tab record of the build we've already reloaded for. Keyed by the target
// build, so a second reload for the SAME build never happens: if reloading
// didn't pick up the new bundle, reloading again won't either, and a reload
// loop on a phone is far worse than a stale page.
const RELOADED_FOR = "va:reloaded-for-build";
// A refocus can fire several events at once (visibilitychange, focus, pageshow);
// this keeps that to one request.
const MIN_GAP_MS = 30_000;

const readFlag = () => {
  try {
    return sessionStorage.getItem(RELOADED_FOR);
  } catch {
    return null; // Safari private mode throws on storage access
  }
};
const writeFlag = (v) => {
  try {
    sessionStorage.setItem(RELOADED_FOR, v);
    return true;
  } catch {
    return false; // no storage means no loop protection — don't reload at all
  }
};

export function BuildWatch() {
  useEffect(() => {
    // No build id (a local `next dev` without the env inlined) — nothing to
    // compare, so stay out of the way entirely.
    if (!BUILD) return;
    let last = 0;
    let cancelled = false;

    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < MIN_GAP_MS) return;
      last = now;
      let live;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        live = (await r.json())?.build;
      } catch {
        return; // offline, or the request was blocked — leave the page alone
      }
      if (cancelled || !live || live === BUILD) return;
      if (readFlag() === live) return;
      if (!writeFlag(live)) return;
      window.location.reload();
    };

    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    // Fires on restore from the back/forward cache, which is exactly the
    // "tapped the Home Screen icon and Safari handed back the old tab" path.
    window.addEventListener("pageshow", check);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, []);

  return null;
}
