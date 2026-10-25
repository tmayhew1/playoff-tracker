"use client";

import { createContext, useContext } from "react";

// The way into the Awards tab from anywhere on the page: a player card's award
// box calls goToAward({ award: "mvp" | "mip", season, slug }) and the tracker
// switches tabs and hands the target to the Awards view.
const AwardNavContext = createContext(null);

export const AwardNavProvider = AwardNavContext.Provider;
export const useAwardNav = () => useContext(AwardNavContext);

// The same for a 2026-27 card, whose awards haven't been voted: its award box
// calls openLookAhead({ award, slug }) and Explore opens the Look Ahead on that
// board with the player open. Only Explore provides it.
const LookAheadNavContext = createContext(null);

export const LookAheadNavProvider = LookAheadNavContext.Provider;
export const useLookAheadNav = () => useContext(LookAheadNavContext);

// Any player's name in a box score — Live, About Last Night, Explore's games —
// opens their By Player career: openCareer({ name, slug?, season? }). The
// tracker provides it; a page without it (none today) just shows no link.
const PlayerNavContext = createContext(null);

export const PlayerNavProvider = PlayerNavContext.Provider;
export const usePlayerNav = () => useContext(PlayerNavContext);
