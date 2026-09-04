"use client";

import { useState, useEffect } from "react";
import { fetchJsonCached } from "./fetch-cache";

// The math lives in ./defense-math, which imports nothing — that is what lets
// scripts/fit-def-calibration.mjs run the very functions the app renders with
// instead of a copy of them. Re-exported here so components keep importing
// everything defensive from one place.
export * from "./defense-math";

// One shared fetch of the baked ratings; components render without them
// (VA+ simply absent) until the map arrives.
export function useDefRatings() {
  const [defs, setDefs] = useState(null);
  useEffect(() => {
    let ok = true;
    fetchJsonCached("/api/def-ratings")
      .then((d) => { if (ok) setDefs(d.seasons || {}); })
      .catch(() => {});
    return () => { ok = false; };
  }, []);
  return defs;
}
