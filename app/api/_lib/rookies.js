import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { leagueContext, projectRookie, UNDRAFTED_PICK } from "../../lib/projection-model";
import { lgaForSeason, valueAdd } from "../../scoring";
import { normalizeName } from "../../lib/format";

// Rookies on the live rosters, projected from draft night (lib/projection-model.js
// projectRookie, fit in scripts/fit-projection-model.mjs): a drafted rookie
// from the pick in this year's draft (data/draft-picks.json), an undrafted one
// from the last college season (matched when the college file has the name
// exactly once). An undrafted rookie with no college season stays in
// `unprojected`.

const round1 = (x) => Math.round(x * 10) / 10;

export async function projectRookies(unprojected, baked) {
  const rk = baked.params?.rookie;
  if (!rk || !baked.ctx) return { rookies: [], unprojected };
  const readData = (f) => readFile(join(process.cwd(), "app", "data", f), "utf8").then(JSON.parse).catch(() => null);
  const college = baked.collegeSeason ? await readData(`college-${baked.collegeSeason}.json`) : null;
  const draft = (await readData("draft-picks.json"))?.years?.[baked.draftYear] || [];
  const pickOf = new Map(draft.map((d) => [normalizeName(d.name), d.pick]));
  const rows = (college?.players || []).filter((r) => r.mp > 0);
  const cctx = leagueContext(rows);
  const seen = new Map();
  for (const r of rows) {
    const n = normalizeName(r.name);
    seen.set(n, seen.has(n) ? null : r); // null marks a name that isn't unique
  }
  // Years in college, from the three seasons before (each read only if baked).
  const prior = [];
  for (let y = Number((baked.collegeSeason || "0").slice(0, 4)), i = 1; college && i <= 3; i++) {
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
      const n = normalizeName(name), c = seen.get(n) || null;
      const pick = pickOf.get(n) ?? UNDRAFTED_PICK;
      // Same rule as the fit (scripts/fit-projection-model.mjs rookieSrc):
      // drafted → the pick alone, which beat pick + college on held-out
      // lottery picks; undrafted → the college model; neither → unprojected.
      const src = pick < UNDRAFTED_PICK && rk.pickOnly ? { college: null, pick }
        : c && rk.college ? { college: c, cctx, years: yearsOf(n), pick } : null;
      if (!src) { (left[team] ||= []).push(name); continue; }
      const years = src.years ?? null;
      const proj = projectRookie(src, rk, baked.ctx);
      const row = Object.fromEntries(Object.entries(proj.row).map(([k, v]) => [k, k === "g" ? v : round1(v)]));
      rookies.push({
        slug: c ? `ncaa-${c.slug}` : `pick-${baked.draftYear}-${pick}`, name, team, pos: "G", exp: 0, rookie: true,
        collegeYears: years, pick: pick < UNDRAFTED_PICK ? pick : null, model: src.college ? "college" : "pick",
        mpg: round1(proj.mpg), row, va: round1(valueAdd(proj.row, lga)),
        // The college line, in the shape the page reads a last season in —
        // shown for reference even when the projection used the pick alone.
        last: c && {
          season: baked.collegeSeason, team: c.school, college: true,
          g: c.gp, mp: c.mp, pts: c.pts, ast: c.ast, drb: c.drb, orb: c.orb, stl: c.stl, blk: c.blk,
          tov: c.tov, fgm: c.fgm, fga: c.fga, tpm: c.tpm, tpa: c.tpa, ftm: c.ftm, fta: c.fta, va: round1(c.va || 0),
        },
      });
    }
  }
  return { rookies, unprojected: left };
}
