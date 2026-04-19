// Scoring logic: points computation and Value Added (VA) player stat.

import { TEAMS, BRACKET, ROUND_BASE, ROUND_LABEL } from "./teams";

// League averages for 2025-26 season, used to compute Value Added
export const LGA = {
  la3P: 0.359686938670772,
  la2P: 0.548356161904934,
  laFT: 0.788506191950464,
  laFG: 0.470335430881713,
  laPTSperM: 0.408655965562845,
  laASTperM: 0.0827805842301779,
  laSTLperM: 0.032258064516129,
  laBLKperM: 0.0143884892086331,
  laTOVperM: 0.0516272842803455,
  laDRBperM: 0.121786420566908,
  laORBperM: 0.0384615384615385,
  laPTSperMake: 2.31624664395461,
  laPTSperPoss: 1.01391216652376,
  laDRBrate: 0.738162582316744,
  laORBrate: 0.261837417683256,
};

export function valueAdd(p) {
  const { mp, pts, ast, stl, blk, tov, drb, orb, tpm, tpa, fgm, fga, ftm, fta } = p;
  if (!mp || mp <= 0) return 0;
  const twoPm = fgm - tpm, twoPa = fga - tpa;
  const tpAdd = ((tpm / (tpa || 1)) - LGA.la3P) * tpa;
  const twoAdd = ((twoPm / (twoPa || 1)) - LGA.la2P) * twoPa;
  const ftAdd = ((ftm / (fta || 1)) - LGA.laFT) * fta;
  const volume = ((pts / mp) - LGA.laPTSperM) * mp;
  const efficiency = 3 * tpAdd + 2 * twoAdd + ftAdd;
  const astVal = ((ast / mp) - LGA.laASTperM) * mp * LGA.laPTSperMake * (1 - LGA.laFG);
  const stlVal = ((stl / mp) - LGA.laSTLperM) * mp * LGA.laPTSperPoss;
  const blkVal = ((blk / mp) - LGA.laBLKperM) * mp * LGA.laPTSperPoss * LGA.laDRBrate;
  const tovVal = -((tov / mp) - LGA.laTOVperM) * mp * LGA.laPTSperPoss;
  const drbVal = ((drb / mp) - LGA.laDRBperM) * ( 1.25 ) * mp * LGA.laPTSperPoss * LGA.laORBrate;
  const orbVal = ((orb / mp) - LGA.laORBperM)* ( 1.25 ) * mp * LGA.laPTSperPoss * LGA.laDRBrate;
  return volume + efficiency + astVal + stlVal + blkVal + tovVal + drbVal + orbVal;
}

export function computeMatchups(winners) {
  const t = {};
  BRACKET.r1.forEach((s) => (t[s.id] = s.teams.slice()));
  const resolve = (id) => winners[id];
  BRACKET.r2.forEach((s) => (t[s.id] = s.from.map(resolve)));
  BRACKET.r3.forEach((s) => (t[s.id] = s.from.map(resolve)));
  BRACKET.r4.forEach((s) => (t[s.id] = s.from.map(resolve)));
  return t;
}

export function potentialPoints(winTeam, loseTeam, roundKey) {
  const base = ROUND_BASE[roundKey];
  const diff = winTeam.seed - loseTeam.seed;
  const bonus = diff > 0 ? diff : 0;
  return { base, bonus, total: base + bonus };
}

// Separates real results (from NBA feed) from user "what-if" speculation.
// - actualWins: { seriesId: { teamCode: wins } } derived from live games
// - actualWinners: { seriesId: teamCode } derived from series that clinched
export function computePoints(winners, gameWins, actualWins = {}, actualWinners = {}) {
  const matchups = computeMatchups(winners);
  const breakdown = { Spencer: [], Trey: [] };       // locked, actual series wins
  const whatIfClinched = { Spencer: [], Trey: [] };  // user-selected winners not yet real
  const projections = { Spencer: [], Trey: [] };     // in-progress, from actual wins
  const whatIfProj = { Spencer: [], Trey: [] };      // user-added wins beyond actual

  const rounds = [
    { key: "r1", series: BRACKET.r1 },
    { key: "r2", series: BRACKET.r2 },
    { key: "r3", series: BRACKET.r3 },
    { key: "r4", series: BRACKET.r4 },
  ];

  rounds.forEach(({ key, series }) => {
    series.forEach((s) => {
      const [a, b] = matchups[s.id] || [];
      if (!a || !b) return;

      const winCode = winners[s.id];
      const actualWinCode = actualWinners[s.id];
      const games = gameWins[s.id] || { [a]: 0, [b]: 0 };
      const actualGames = actualWins[s.id] || { [a]: 0, [b]: 0 };

      if (winCode) {
        // Series has a user-selected winner
        const winTeam = TEAMS[winCode];
        const loseCode = a === winCode ? b : a;
        const loseTeam = TEAMS[loseCode];
        if (!winTeam || !loseTeam) return;
        const { base, bonus, total } = potentialPoints(winTeam, loseTeam, key);
        const item = { round: ROUND_LABEL[key], roundKey: key, team: winTeam, opp: loseTeam, base, bonus, total };
        // Actual if real-life agrees; otherwise it's speculation
        if (actualWinCode === winCode) {
          breakdown[winTeam.owner].push(item);
        } else {
          whatIfClinched[winTeam.owner].push(item);
        }
      } else {
        // Series in progress — split wins into real vs. speculated
        [a, b].forEach((code) => {
          const team = TEAMS[code];
          const oppCode = code === a ? b : a;
          const opp = TEAMS[oppCode];
          if (!team || !opp) return;
          const userWins = games[code] || 0;
          const realWins = actualGames[code] || 0;
          if (userWins === 0) return;
          const { total } = potentialPoints(team, opp, key);

          // Real wins → in-progress projection
          if (realWins > 0) {
            projections[team.owner].push({
              round: ROUND_LABEL[key], roundKey: key, team, opp,
              gamesWon: realWins, total, projected: total * (realWins / 4),
            });
          }
          // User-added wins beyond real → what-if
          if (userWins > realWins) {
            whatIfProj[team.owner].push({
              round: ROUND_LABEL[key], roundKey: key, team, opp,
              gamesWon: userWins, realWins, total,
              projected: total * ((userWins - realWins) / 4),
            });
          }
        });
      }
    });
  });

  const totals = {
    Spencer: breakdown.Spencer.reduce((a, x) => a + x.total, 0),
    Trey: breakdown.Trey.reduce((a, x) => a + x.total, 0),
  };
  const realProjectedTotals = {
    Spencer: totals.Spencer + projections.Spencer.reduce((a, x) => a + x.projected, 0),
    Trey: totals.Trey + projections.Trey.reduce((a, x) => a + x.projected, 0),
  };
  const whatIfTotals = {
    Spencer: whatIfClinched.Spencer.reduce((a, x) => a + x.total, 0)
           + whatIfProj.Spencer.reduce((a, x) => a + x.projected, 0),
    Trey: whatIfClinched.Trey.reduce((a, x) => a + x.total, 0)
        + whatIfProj.Trey.reduce((a, x) => a + x.projected, 0),
  };
  const projectedTotals = {
    Spencer: realProjectedTotals.Spencer + whatIfTotals.Spencer,
    Trey: realProjectedTotals.Trey + whatIfTotals.Trey,
  };
  return {
    breakdown, whatIfClinched, projections, whatIfProj,
    totals, realProjectedTotals, projectedTotals, whatIfTotals,
    matchups,
  };
}
