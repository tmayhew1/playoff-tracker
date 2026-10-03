import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { leagueContext, projectRookie } from "../../lib/projection-model";
import { lgaForSeason, valueAdd } from "../../scoring";
import { normalizeName } from "../../lib/format";

// Rookies on the live rosters, projected from their last college season
// (lib/projection-model.js projectRookie, with the translation fit in
// scripts/fit-projection-model.mjs). A roster name is matched to the college
// file only when the name is unique there; anyone not found — internationals,
// G League, players a year removed from college — stays in `unprojected`.

const round1 = (x) => Math.round(x * 10) / 10;

export async function projectRookies(unprojected, baked) {
  const rk = baked.params?.rookie;
  if (!rk || !baked.collegeSeason || !baked.ctx) return { rookies: [], unprojected };
  let college;
  try {
    college = JSON.parse(await readFile(join(process.cwd(), "app", "data", `college-${baked.collegeSeason}.json`), "utf8"));
  } catch {
    return { rookies: [], unprojected };
  }
  const rows = (college.players || []).filter((r) => r.mp > 0);
  const cctx = leagueContext(rows);
  const seen = new Map();
  for (const r of rows) {
    const n = normalizeName(r.name);
    seen.set(n, seen.has(n) ? null : r); // null marks a name that isn't unique
  }
  // Years in college, from the three seasons before (each read only if baked).
  const prior = [];
  for (let y = Number(baked.collegeSeason.slice(0, 4)), i = 1; i <= 3; i++) {
    const s = `${y - i}-${String((y - i + 1) % 100).padStart(2, "0")}`;
    try {
      const d = JSON.parse(await readFile(join(process.cwd(), "app", "data", `college-${s}.json`), "utf8"));
      prior.push(new Set((d.players || []).map((r) => normalizeName(r.name))));
    } catch {
      break;
    }
  }
  const yearsOf = (n) => {
    let y = 1;
    for (const set of prior) { if (!set.has(n)) break; y++; }
    return y;
  };
  const lga = lgaForSeason(baked.base);
  const rookies = [], left = {};
  for (const [team, names] of Object.entries(unprojected)) {
    for (const name of names) {
      const n = normalizeName(name), c = seen.get(n);
      if (!c) { (left[team] ||= []).push(name); continue; }
      const years = yearsOf(n);
      const proj = projectRookie(c, cctx, rk, baked.ctx, years);
      const row = Object.fromEntries(Object.entries(proj.row).map(([k, v]) => [k, k === "g" ? v : round1(v)]));
      rookies.push({
        slug: `ncaa-${c.slug}`, name, team, pos: "G", exp: 0, rookie: true, collegeYears: years,
        mpg: round1(proj.mpg), row, va: round1(valueAdd(proj.row, lga)),
        // The college line, in the shape the page reads a last season in.
        last: {
          season: baked.collegeSeason, team: c.school, college: true,
          g: c.gp, mp: c.mp, pts: c.pts, ast: c.ast, drb: c.drb, orb: c.orb, stl: c.stl, blk: c.blk,
          tov: c.tov, fgm: c.fgm, fga: c.fga, tpm: c.tpm, tpa: c.tpa, ftm: c.ftm, fta: c.fta, va: round1(c.va || 0),
        },
      });
    }
  }
  return { rookies, unprojected: left };
}
