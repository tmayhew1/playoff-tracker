import { poolTeams } from "../../lib/projection-model";
import { lgaForSeason, valueAdd } from "../../scoring";

// The team context (lib/projection-model.js poolTeams) on the rosters just
// placed: each row becomes the pooled one, the projection on its own is kept
// as `solo`, and VA is re-priced. Shared by /api/projections (live rosters)
// and the share card (the baked teams).
export function withTeamContext(players, baked) {
  const pooled = poolTeams(players.map((p) => ({ team: p.team, row: p.row })), baked.params.pool);
  const lga = lgaForSeason(baked.base);
  return players.map((p, i) => {
    const { pool: raw, ...row } = pooled[i];
    const pool = Object.fromEntries(Object.entries(raw).map(([k, f]) => [k, Math.round(f * 1000) / 1000]));
    return { ...p, solo: p.row, soloVa: p.va, row, pool, va: Math.round(valueAdd(row, lga) * 10) / 10, mpg: Math.round((row.mp / row.g) * 10) / 10 };
  });
}
