import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { valueAddParts, lgaForSeason } from "../../scoring.js";

// Each team's roster for a season, with every player's regular-season Value
// Added — the input to lib/draft-model.js rosterStrength. Shared by the fit
// (scripts/fit-draft-model.mjs) and /api/draft, so both rate teams alike.
//
// Who is on a team:
//   - once the playoffs have a box score, the players who appeared for it
//     (leaderboard-<season>.json). That is the roster as it stood on draft
//     day: whoever was ruled out never appears, and a mid-season trade is
//     already resolved.
//   - before that — draft day itself — each player's regular-season team, or
//     for a traded player ("2TM") the team he finished with (lastTeam, baked
//     by fetch_historical.R). Nobody is ruled out here; injuries are the
//     reader's to account for.

const DATA = join(process.cwd(), "app", "data");
const readJson = (name) => readFile(join(DATA, name), "utf8").then(JSON.parse).catch(() => null);

export async function seasonRosters(season) {
  const rs = await readJson(`regular-season-${season}.json`);
  if (!rs?.players?.length) return null;
  const lga = lgaForSeason(season);
  const bySlug = new Map();
  let seasonGames = 0;
  for (const r of rs.players) {
    if (!(r.g > 0) || !(r.mp > 0)) continue;
    seasonGames = Math.max(seasonGames, r.g);
    bySlug.set(r.slug, {
      slug: r.slug, name: r.name, g: r.g, mp: r.mp,
      va: valueAddParts(r, lga).va,
      team: /^(TOT|\dTM)$/.test(r.team) ? r.lastTeam || null : r.team,
    });
  }
  const lb = await readJson(`leaderboard-${season}.json`);
  const rosters = {};
  let source;
  if (lb?.players?.length) {
    source = "playoffs";
    for (const p of lb.players) {
      const r = bySlug.get(p.slug);
      if (r) (rosters[p.team] ||= []).push(r);
    }
  } else {
    source = "regular";
    for (const r of bySlug.values()) if (r.team) (rosters[r.team] ||= []).push(r);
  }
  for (const t of Object.keys(rosters)) rosters[t].sort((a, b) => b.va - a.va);
  return { season, seasonGames, rosters, source };
}

// Every series in a season's history file: the two teams, who hosted game 1
// (home court), and the winner. Series with no games or no winner are left
// out — they can't be scored.
export async function seasonSeries(season) {
  const h = await readJson(`history-${season}.json`);
  return (h?.series || [])
    .filter((s) => s.winner && s.games?.length && s.teams?.length === 2)
    .map((s) => ({ round: s.round, teams: s.teams, winner: s.winner, home: s.games[0].home?.tri || null }));
}
