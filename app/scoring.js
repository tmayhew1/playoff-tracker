// Scoring logic: points computation and Value Added (VA) player stat.

import { TEAMS, BRACKET, ROUND_BASE, ROUND_LABEL } from "./teams";

// League averages per season, used to compute Value Added. Keeping VA
// season-accurate matters for historical box scores (efficiency baselines
// drift year to year).
export const LEAGUE_AVERAGES = {
  "2023-24": {
    la3P: 0.364811447114809,
    la2P: 0.544641143904883,
    laFT: 0.783976606126799,
    laFG: 0.473626269663115,
    laPTSperM: 0.379016874541453,
    laASTperM: 0.0805524657026326,
    laSTLperM: 0.0278588533409397,
    laBLKperM: 0.0157268037594516,
    laTOVperM: 0.0450747733303848,
    laDRBperM: 0.119895833333333,
    laORBperM: 0.0338730239673636,
    laPTSperMake: 2.30417294666691,
    laPTSperPoss: 1.0174234902173,
    laDRBrate: 0.757679450396146,
    laORBrate: 0.242320549603854,
  },
  "2024-25": {
    la3P: 0.359834082267542,
    la2P: 0.543853565684437,
    laFT: 0.779493622293183,
    laFG: 0.466469149736644,
    laPTSperM: 0.402475143343264,
    laASTperM: 0.082984050521855,
    laSTLperM: 0.0308587441215225,
    laBLKperM: 0.015065966803802,
    laTOVperM: 0.0485040889833636,
    laDRBperM: 0.123144073124728,
    laORBperM: 0.0402147662584095,
    laPTSperMake: 2.32439120512515,
    laPTSperPoss: 1.00562343231653,
    laDRBrate: 0.747507932253798,
    laORBrate: 0.252492067746202,
  },
  "2025-26": {
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
  },
};

// Default (current season) — keeps existing callers unchanged.
export const LGA = LEAGUE_AVERAGES["2025-26"];

export const lgaForSeason = (season) => LEAGUE_AVERAGES[season] || LGA;

export function valueAdd(p, lga = LGA) {
  const { mp, pts, ast, stl, blk, tov, drb, orb, tpm, tpa, fgm, fga, ftm, fta } = p;
  if (!mp || mp <= 0) return 0;
  const twoPm = fgm - tpm, twoPa = fga - tpa;
  const tpAdd = ((tpm / (tpa || 1)) - lga.la3P) * tpa;
  const twoAdd = ((twoPm / (twoPa || 1)) - lga.la2P) * twoPa;
  const ftAdd = ((ftm / (fta || 1)) - lga.laFT) * fta;
  const volume = ((pts / mp) - lga.laPTSperM) * mp;
  const efficiency = 3 * tpAdd + 2 * twoAdd + ftAdd;
  const astVal = ((ast / mp) - lga.laASTperM) * mp * lga.laPTSperMake * (1 - lga.laFG);
  const stlVal = ((stl / mp) - lga.laSTLperM) * mp * lga.laPTSperPoss;
  const blkVal = ((blk / mp) - lga.laBLKperM) * mp * lga.laPTSperPoss * lga.laDRBrate;
  const tovVal = -((tov / mp) - lga.laTOVperM) * mp * lga.laPTSperPoss;
  const drbVal = ((drb / mp) - lga.laDRBperM) * ( 1.25 ) * mp * lga.laPTSperPoss * lga.laORBrate;
  const orbVal = ((orb / mp) - lga.laORBperM)* ( 1.25 ) * mp * lga.laPTSperPoss * lga.laDRBrate;
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
