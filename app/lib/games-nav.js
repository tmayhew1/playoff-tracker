"use client";

import { createContext, useContext } from "react";

// The way into a player's recent regular-season games from anywhere on the
// page: a category card's "recent games" calls
// goToRecentGames({ season, team, name, recent: true }) and the tracker
// switches to Explore, which opens By Season's game list on that team's games:
// the player's row open in the month's averages, and his latest game open on
// his team (RegularSeasonMonths resolves the date). `date` may be given
// instead, to open that night's game.
const GamesNavContext = createContext(null);

export const GamesNavProvider = GamesNavContext.Provider;
export const useGamesNav = () => useContext(GamesNavContext);
