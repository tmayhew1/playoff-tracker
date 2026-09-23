"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

// What the page is showing, as the pieces of a shareable link (see
// share-params.js for the format). Each component reports the part it owns —
// the tab strip its tab, Explore its view/scope/season, the leaderboard or By
// Player the open player, a breakdown its comparison — and the tracker writes
// the merged result into the address bar. Reporting rather than reading keeps
// the state where it already lives; nothing about how a view navigates had to
// change to make it linkable.

const ShareContext = createContext(null);

export function useShareStore() {
  const [state, setState] = useState({});
  const report = useCallback((partial) => {
    setState((prev) => {
      let changed = false;
      for (const k of Object.keys(partial)) {
        if (!sameValue(prev[k], partial[k])) { changed = true; break; }
      }
      return changed ? { ...prev, ...partial } : prev;
    });
  }, []);
  return { state, report };
}

const sameValue = (a, b) => (a === b) || (a && b && typeof a === "object" && JSON.stringify(a) === JSON.stringify(b));

export const ShareProvider = ShareContext.Provider;

// Report this component's part of the link while it is mounted; its keys go
// back to null when it unmounts, so a view that closes stops describing
// itself. `value` is compared by content, so an inline object is fine.
export function useShareReport(value) {
  const report = useContext(ShareContext);
  const key = JSON.stringify(value);
  useEffect(() => {
    if (report) report(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, key]);
  useEffect(() => () => {
    if (report) report(Object.fromEntries(Object.keys(value).map((k) => [k, null])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);
}

// The open row's comparison. A board provides a setter around the ONE row it
// has open (the By Season leaderboard, a By Player season), and the breakdown
// inside reports into it; a breakdown anywhere else — a draft-season tab's box
// score — finds no setter and stays out of the link.
const CompareSlot = createContext(null);
export const CompareSlotProvider = CompareSlot.Provider;

export function useCompareReport(compare) {
  const set = useContext(CompareSlot);
  const slug = compare?.slug || null;
  const season = compare?.row?.season || null;
  useEffect(() => {
    if (set) set(slug && season ? { slug, season } : null);
  }, [set, slug, season]);
  useEffect(() => () => { if (set) set(null); }, [set]);
}
