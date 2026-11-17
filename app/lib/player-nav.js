"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchBakedJson } from "./fetch-cache";
import { normalizeName } from "./format";

// The way into Explore's By Player from anywhere on the page: a table's armed
// Player header (a box score's, a category card's rankings) calls
// goToPlayer({ name, slug, season, scope }) and the tracker switches to
// Explore, which opens that player's career with the season drilled in.
// `season` and `scope` are optional — without them the career just opens.
const PlayerNavContext = createContext(null);

export const PlayerNavProvider = PlayerNavContext.Provider;
export const usePlayerNav = () => useContext(PlayerNavContext);

// The header cell itself, shared so every table arms the same way: tap Player,
// then a name. Without a provider above it there is nowhere to go, and it
// stays the plain label it always was.
export function PlayerHeader({ armed, onArm, className = "" }) {
  const go = usePlayerNav();
  if (!go) return <span className={className}>Player</span>;
  return (
    <button
      type="button"
      onClick={onArm}
      className={`${className} text-left uppercase tracking-wider cursor-pointer hover:text-stone-900 ${armed ? "text-stone-900 font-bold underline" : ""}`}
      title="Tap, then tap a player to open their By Player career in Explore"
      aria-pressed={armed}
    >
      Player
    </button>
  );
}


// Everything a table needs to link its names, in one place:
//   header(className)  the Player header cell (a plain label without a provider)
//   armed              true while the header is armed
//   open(target)       go to that player ({ name, slug, season, scope }) and disarm
//   nameClass(target)  the dotted underline a name wears while it can be opened
//   name(target, props, children)
//                      a plain-text name that becomes a button while armed
//   rowClick(target, fallback)
//                      a row's click handler: armed, the tap opens the player;
//                      otherwise it does what the row always did
// Who By Player can open: every player in its regular-season index (anyone
// with an NBA game), by slug and by folded name. Loaded the first time a
// header is armed, and shared by every table after that.
let knownPromise = null;
function loadKnown() {
  return (knownPromise ||= fetchBakedJson("/api/players?scope=regular").then((d) => {
    const slugs = new Set(), names = new Set();
    for (const p of d.players || []) { if (p.slug) slugs.add(p.slug); names.add(normalizeName(p.name)); }
    return { slugs, names };
  }).catch((e) => { knownPromise = null; throw e; }));
}

export function usePlayerArm() {
  const go = usePlayerNav();
  const [on, setOn] = useState(false);
  const [known, setKnown] = useState(null);
  const armed = on && !!go;
  useEffect(() => {
    if (!armed || known) return;
    let cancelled = false;
    loadKnown().then((k) => { if (!cancelled) setKnown(k); }).catch(() => {});
    return () => { cancelled = true; };
  }, [armed, known]);
  // A name is tappable only once it is known to be in By Player: a college
  // player who never reached the league, or a rookie yet to play, isn't, and
  // tapping it would only land on an empty search.
  const can = (t) => armed && !!known && !!t && ((t.slug && known.slugs.has(t.slug)) || known.names.has(normalizeName(t.name)));
  const open = useCallback((target) => { setOn(false); go?.(target); }, [go]);
  const header = (className = "") => <PlayerHeader armed={armed} onArm={() => setOn((v) => !v)} className={className} />;
  const rowClick = (target, fallback) => (e) => {
    if (can(target)) { e?.stopPropagation?.(); open(target); return; }
    fallback?.(e);
  };
  // For a table whose names are plain text: while armed (and the player is
  // in By Player) the name is a button that opens them, otherwise a span.
  const name = (target, { className = "", style } = {}, children) => (can(target)
    ? <button type="button" onClick={() => open(target)} className={`${className} text-left underline decoration-dotted`} style={style} aria-label={`Open ${target.name} in By Player`}>{children}</button>
    : <span className={className} style={style}>{children}</span>);
  const nameClass = (target) => (can(target) ? "underline decoration-dotted text-stone-900" : "");
  return { armed, open, header, rowClick, name, nameClass, canOpen: can, disarm: () => setOn(false) };
}
