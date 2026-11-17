"use client";

import { createContext, useCallback, useContext, useState } from "react";

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
//   nameClass          the dotted underline a name wears while armed
//   name(target, props, children)
//                      a plain-text name that becomes a button while armed
//   rowClick(target, fallback)
//                      a row's click handler: armed, the tap opens the player;
//                      otherwise it does what the row always did
export function usePlayerArm() {
  const go = usePlayerNav();
  const [on, setOn] = useState(false);
  const armed = on && !!go;
  const open = useCallback((target) => { setOn(false); go?.(target); }, [go]);
  const header = (className = "") => <PlayerHeader armed={armed} onArm={() => setOn((v) => !v)} className={className} />;
  const rowClick = (target, fallback) => (e) => {
    if (armed) { e?.stopPropagation?.(); open(target); return; }
    fallback?.(e);
  };
  // For a table whose names are plain text: while armed the name is a button
  // that opens the player, otherwise the same text in a span.
  const name = (target, { className = "", style } = {}, children) => (armed
    ? <button type="button" onClick={() => open(target)} className={`${className} text-left underline decoration-dotted`} style={style} aria-label={`Open ${target.name} in By Player`}>{children}</button>
    : <span className={className} style={style}>{children}</span>);
  return { armed, open, header, rowClick, name, disarm: () => setOn(false), nameClass: armed ? "underline decoration-dotted text-stone-900" : "" };
}
