// The NBA live CDN's box score (cdn.nba.com/static/json/liveData/boxscore/
// boxscore_<gameId>.json) read into the app's stat-line shape. Shared by
// /api/boxscore (live games) and scripts/bake-nights.mjs (last night's
// games), so both read a player's line the same way.

// Parse ISO 8601 duration like "PT38M12.00S" to total minutes (as float)
function parseMinutes(iso) {
  if (!iso) return 0;
  const m = /PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(iso);
  if (!m) return 0;
  const mins = parseInt(m[1] || "0", 10);
  const secs = parseFloat(m[2] || "0");
  return mins + secs / 60;
}

export function mapPlayer(p) {
  const s = p.statistics || {};
  const mp = parseMinutes(s.minutesCalculated || s.minutes);
  return {
    // The NBA's own player id: stable, unlike the display name.
    id: p.personId ?? null,
    name: p.name || `${p.firstName || ""} ${p.familyName || ""}`.trim(),
    starter: String(p.starter) === "1" || p.starter === true,
    // NBA returns oncourt as a string ("1"/"0"), so a plain !! coerces "0" to true.
    oncourt: String(p.oncourt) === "1" || p.oncourt === true,
    mp,
    pts: s.points ?? 0,
    reb: (s.reboundsDefensive ?? 0) + (s.reboundsOffensive ?? 0),
    drb: s.reboundsDefensive ?? 0,
    orb: s.reboundsOffensive ?? 0,
    ast: s.assists ?? 0,
    stl: s.steals ?? 0,
    blk: s.blocks ?? 0,
    tov: s.turnovers ?? 0,
    fgm: s.fieldGoalsMade ?? 0,
    fga: s.fieldGoalsAttempted ?? 0,
    tpm: s.threePointersMade ?? 0,
    tpa: s.threePointersAttempted ?? 0,
    ftm: s.freeThrowsMade ?? 0,
    fta: s.freeThrowsAttempted ?? 0,
    plusMinus: s.plusMinusPoints ?? 0,
  };
}
