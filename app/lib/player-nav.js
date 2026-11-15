"use client";

import { createContext, useContext } from "react";

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
