"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { monthBoxes } from "./month-tables";
import { fetchJsonCached } from "./fetch-cache";
import { seasonGames } from "./baked-games";
import { groupByMonth, seasonMonths } from "./regular-season-games";
import { playerTotals } from "./season-to-date";
import { gameDistributions, projectScore, seasonDistributions, seasonRanks, seasonTotals, standingsThrough } from "./team-context";

// Kept in step with LOOK_AHEAD_SEASON in components/look-ahead.js (not
// imported from it, so this doesn't pull that chunk into the page bundle).
const LOOK_AHEAD_SEASON = "2026-27";

// A team's regular season through a game, for a game card (live-view.js
// GameCard, and the pregame card): (tri, date) -> { record, place, conf,
// ranks, games, dist, season, teamDist, project, players } or null.
// The record and conference place (lib/team-context.js standingsThrough,
// teams on the same record ordered by the Look Ahead's projected wins in the
// season it projects) come off the season's finals as soon as those are in;
// the league ranks in the card's measures and the spread of single games in
// them (seasonRanks, gameDistributions) once the box scores through `through`
// (a month key; all of them without it) have loaded, and are null until
// then, along with the team's season totals (seasonTotals: `season`, its
// `games` the ranks run through), the league's spread of team-seasons
// (`teamDist`) and `project` (away, home) -> the pregame projection
// (projectScore, the Look Ahead's wins its prior), and the team's players'
// season totals (lib/season-to-date.js playerTotals: `players`, each on the
// team he last played for). `allMonths` is the season by month (lib/regular-season-games.js
// groupByMonth) when the caller has it; otherwise it's loaded here. Nothing
// loads until `enabled`. Worked out once per day.
export function useSeasonContext({ enabled, season, allMonths: given = null, through = null, lga }) {
  const [loaded, setLoaded] = useState(null);
  const allMonths = given || loaded;
  const [boxes, setBoxes] = useState(null);
  const [projected, setProjected] = useState(null);

  useEffect(() => {
    if (!enabled || given || !season) return;
    let cancelled = false;
    seasonGames(season, seasonMonths(season),
      (m) => fetchJsonCached(`/api/regular-season/games?season=${season}&month=${m}`))
      .then(({ games }) => { if (!cancelled) setLoaded(groupByMonth(games)); }, () => {});
    return () => { cancelled = true; };
  }, [enabled, given, season]);

  useEffect(() => {
    if (!enabled || !allMonths) return;
    let cancelled = false;
    Promise.all(allMonths.filter((m) => !through || m.key <= through).map((m) => monthBoxes(season, m).catch(() => [])))
      .then((all) => { if (!cancelled) setBoxes(all.flat()); });
    return () => { cancelled = true; };
  }, [enabled, allMonths, through, season]);

  useEffect(() => {
    if (!enabled || season !== LOOK_AHEAD_SEASON) return;
    let cancelled = false;
    import("../components/look-ahead").then((m) => m.lookAheadWins()).then((w) => { if (!cancelled) setProjected(w); }, () => {});
    return () => { cancelled = true; };
  }, [enabled, season]);

  const games = useMemo(() => (allMonths || []).flatMap((m) => m.games), [allMonths]);
  const cache = useMemo(() => new Map(), [games, boxes, projected, lga]); // eslint-disable-line react-hooks/exhaustive-deps
  return useCallback((tri, date) => {
    if (!games.length || !date) return null;
    if (!cache.has(date)) {
      const upTo = boxes?.filter((b) => b.date <= date);
      const totals = upTo ? seasonTotals(upTo) : null;
      cache.set(date, {
        standings: standingsThrough(games, date, projected),
        totals,
        ranks: totals ? seasonRanks(upTo, lga, totals) : null,
        dist: upTo ? gameDistributions(upTo, lga) : null,
        teamDist: totals ? seasonDistributions(totals, lga) : null,
        project: totals ? (away, home) => projectScore(totals, away, home, lga, projected) : null,
        players: upTo ? playerTotals(upTo.map((box) => ({ date: box.date, home: box.home, away: box.away, box }))) : null,
      });
    }
    const { standings, totals, ranks, dist, teamDist, project, players } = cache.get(date);
    const st = standings[tri];
    if (!st) return null;
    return {
      record: `${st.w}-${st.l}`, place: st.place, conf: st.conf, ranks: ranks?.[tri] || null,
      games: totals?.[tri]?.gp ?? null, dist, season: totals?.[tri] || null, teamDist, project,
      players: players?.filter((p) => p.team === tri) || null,
    };
  }, [games, boxes, projected, lga, cache]);
}
