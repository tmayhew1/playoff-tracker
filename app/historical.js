// Historical past-year draft results. Each entry's `winners` object encodes
// who won each series. Teams include seed and owner for display & scoring.

export const HISTORY = {
  "2024-25": {
    label: "2024-25 Season",
    champion: "Oklahoma City Thunder",
    teams: {
      // Spencer
      BOS: { name: "Celtics",  seed: 2, owner: "Spencer", conf: "E" },
      MIL: { name: "Bucks",    seed: 5, owner: "Spencer", conf: "E" },
      DEN: { name: "Nuggets",  seed: 4, owner: "Spencer", conf: "W" },
      CLE: { name: "Cavs",     seed: 1, owner: "Spencer", conf: "E" },
      HOU: { name: "Rockets",  seed: 2, owner: "Spencer", conf: "W" },
      MIN: { name: "Wolves",   seed: 6, owner: "Spencer", conf: "W" },
      MEM: { name: "Grizzlies", seed: 8, owner: "Spencer", conf: "W" },
      ORL: { name: "Magic",    seed: 7, owner: "Spencer", conf: "E" },
      // Trey (had 7 teams including both Lakers & Thunder from round 1)
      LAL: { name: "Lakers",   seed: 3, owner: "Trey",    conf: "W" },
      OKC: { name: "Thunder",  seed: 1, owner: "Trey",    conf: "W" },
      GSW: { name: "Warriors", seed: 7, owner: "Trey",    conf: "W" },
      LAC: { name: "Clippers", seed: 5, owner: "Trey",    conf: "W" },
      DET: { name: "Pistons",  seed: 6, owner: "Trey",    conf: "E" },
      NYK: { name: "Knicks",   seed: 3, owner: "Trey",    conf: "E" },
      MIA: { name: "Heat",     seed: 8, owner: "Trey",    conf: "E" },
      IND: { name: "Pacers",   seed: 4, owner: "Trey",    conf: "E" },
    },
    // Bracket structure with winners baked in
    bracket: {
      r1: [
        { teams: ["CLE", "MIA"], winner: "CLE" },
        { teams: ["IND", "MIL"], winner: "IND" },
        { teams: ["NYK", "DET"], winner: "NYK" },
        { teams: ["BOS", "ORL"], winner: "BOS" },
        { teams: ["OKC", "MEM"], winner: "OKC" },
        { teams: ["LAL", "MIN"], winner: "MIN" },
        { teams: ["DEN", "LAC"], winner: "DEN" },
        { teams: ["HOU", "GSW"], winner: "GSW" },
      ],
      r2: [
        { teams: ["CLE", "IND"], winner: "IND" },
        { teams: ["BOS", "NYK"], winner: "NYK" },
        { teams: ["OKC", "DEN"], winner: "OKC" },
        { teams: ["MIN", "GSW"], winner: "MIN" },
      ],
      r3: [
        { teams: ["IND", "NYK"], winner: "IND" },
        { teams: ["OKC", "MIN"], winner: "OKC" },
      ],
      r4: [
        { teams: ["OKC", "IND"], winner: "OKC" },
      ],
    },
  },
};

const ROUND_BASE = { r1: 1, r2: 2, r3: 4, r4: 8 };
const ROUND_LABEL = { r1: "First Round", r2: "Conf Semis", r3: "Conf Finals", r4: "Finals" };

export function scoreHistory(season) {
  const h = HISTORY[season];
  if (!h) return null;
  const breakdown = { Spencer: [], Trey: [] };
  const rounds = [
    { key: "r1", series: h.bracket.r1 },
    { key: "r2", series: h.bracket.r2 },
    { key: "r3", series: h.bracket.r3 },
    { key: "r4", series: h.bracket.r4 },
  ];
  rounds.forEach(({ key, series }) => {
    series.forEach((s) => {
      const winTeam = h.teams[s.winner];
      const loseCode = s.teams[0] === s.winner ? s.teams[1] : s.teams[0];
      const loseTeam = h.teams[loseCode];
      if (!winTeam || !loseTeam) return;
      const base = ROUND_BASE[key];
      const diff = winTeam.seed - loseTeam.seed;
      const bonus = diff > 0 ? diff : 0;
      breakdown[winTeam.owner].push({
        round: ROUND_LABEL[key], roundKey: key,
        team: winTeam, opp: loseTeam, base, bonus, total: base + bonus,
      });
    });
  });
  const totals = {
    Spencer: breakdown.Spencer.reduce((a, x) => a + x.total, 0),
    Trey: breakdown.Trey.reduce((a, x) => a + x.total, 0),
  };
  return { breakdown, totals, meta: h };
}
