"use client";

import { createContext, useContext } from "react";

// The way into the Awards tab from anywhere on the page: a player card's award
// box calls goToAward({ award: "mvp" | "mip", season, slug }) and the tracker
// switches tabs and hands the target to the Awards view.
const AwardNavContext = createContext(null);

export const AwardNavProvider = AwardNavContext.Provider;
export const useAwardNav = () => useContext(AwardNavContext);
