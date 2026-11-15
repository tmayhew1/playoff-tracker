// The season in progress's league baseline in app/data/league-averages.json,
// and its USG-ADJ usage model in app/data/usage-model.json,
// measured from its own baked box scores (public/regular-season-games) and
// shrunk toward the season before while the sample is thin
// (lib/season-to-date.js inSeasonLga, inSeasonUsageModel), its shot-distance
// FG% (zoneFG) along with the rest. A finished season
// is left to the R pipeline (recompute_derived.R rebuilds it from
// basketball-reference's table) and scripts/fit-usage-model.mjs, which runs
// before this in the daily workflow and rewrites the usage file without it.
//
// It also marks the season in progress on app/data/def-ratings.json
// (`inProgress`), which regresses its D Ratings toward the line by the games
// played so far (lib/defense-math.js, DEF_SEASON_GAMES), and clears the mark
// once the season is complete or basketball-reference's table is baked. While
// it's marked, the season's `team` map (each team's actual defensive rating so
// far and its stock rates, lib/season-to-date.js teamDefense) is written here
// too: the R pipeline builds that map from the regular-season bake, which a
// season in progress doesn't have, and without it D Rating falls back to
// measuring everyone against the league line.
//
// No network. Run in the daily workflow after the regular-season games bake:
//
//   node --import ./scripts/node/register.mjs scripts/bake-in-season-lga.mjs [--check]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gamesWithBoxes, inSeasonLga, inSeasonUsageModel, playerTotals, teamDefense } from "../app/lib/season-to-date.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LGA_PATH = path.join(ROOT, "app", "data", "league-averages.json");
const USAGE_PATH = path.join(ROOT, "app", "data", "usage-model.json");
const DEF_PATH = path.join(ROOT, "app", "data", "def-ratings.json");
const GAMES = path.join(ROOT, "public", "regular-season-games");
const check = process.argv.includes("--check");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const prevSeason = (s) => { const y = Number(s.slice(0, 4)) - 1; return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; };

// League FG% at each shot distance from shooting-<season>.json's made/attempted
// totals, or null before the season has one.
function zoneRates(season) {
  const p = path.join(ROOT, "app", "data", `shooting-${season}.json`);
  const avg = fs.existsSync(p) ? read(p).rs?.leagueAvg : null;
  if (!avg) return null;
  const out = {};
  for (const [k, z] of Object.entries(avg)) if (z?.fga > 0) out[k] = z.fgm / z.fga;
  return Object.keys(out).length ? out : null;
}

const lgas = read(LGA_PATH);
const usage = read(USAGE_PATH);
const defs = fs.existsSync(DEF_PATH) ? read(DEF_PATH) : null;
const inProgress = new Set();
const teamMaps = {};
let changed = 0, usageChanged = 0;
for (const season of fs.readdirSync(GAMES).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort()) {
  const dir = path.join(GAMES, season);
  const indexPath = path.join(dir, "index.json");
  if (!fs.existsSync(indexPath)) continue;
  const index = read(indexPath);
  if (index.complete) continue;
  if (!fs.existsSync(path.join(ROOT, "app", "data", `regular-season-${season}.json`))) inProgress.add(season);
  const months = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => read(path.join(dir, f)));
  const games = gamesWithBoxes(index, months);
  const rows = playerTotals(games);
  if (inProgress.has(season)) teamMaps[season] = teamDefense(games);
  const prior = lgas[prevSeason(season)];
  if (!rows.length || !prior) continue;
  // The season's own shot-distance split, once fetch_shooting_splits.R has
  // one: read from its shooting file, not the entry here, which already holds
  // yesterday's blend whenever that script didn't run.
  const next = inSeasonLga(rows, prior, zoneRates(season));
  const mp = rows.reduce((s, r) => s + r.mp, 0);
  console.log(`${season}: ${rows.length} players, ${Math.round(mp)} min through ${index.through} — laPTSperM ${next.laPTSperM.toFixed(4)}, laBLKperM ${next.laBLKperM.toFixed(4)}`);
  if (JSON.stringify(lgas[season]) !== JSON.stringify(next)) { lgas[season] = next; changed++; }
  const model = inSeasonUsageModel(rows, usage.seasons[prevSeason(season)], usage.ftaWeight);
  if (model) {
    console.log(`${season}: usage model ū ${model.muUsg.toFixed(4)}, line at ū ${model.atMuUsg.toFixed(4)} vs laPTSperM ${next.laPTSperM.toFixed(4)}`);
    if (JSON.stringify(usage.seasons[season]) !== JSON.stringify(model)) { usage.seasons[season] = model; usageChanged++; }
  }
}
let defsChanged = 0;
for (const [season, entry] of Object.entries(defs || {})) {
  const want = inProgress.has(season);
  // The season in progress's team context — its actual team defensive
  // ratings so far, and stock rates — so D Rating measures each player against
  // his own team's line, as a finished season does, instead of the league's.
  // Rounded so a day's re-run rewrites nothing that didn't move.
  const tm = want ? teamMaps[season] : null;
  if (tm && Object.keys(tm).length) {
    const r = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
    const next = Object.fromEntries(Object.entries(tm).map(([k, v]) => [k, { drtg: r(v.drtg, 2), stlpm: r(v.stlpm, 5), blkpm: r(v.blkpm, 5), g: v.g }]));
    if (JSON.stringify(entry.team) !== JSON.stringify(next)) {
      entry.team = next;
      console.log(`${season}: team defensive context for ${Object.keys(next).length} teams`);
      defsChanged++;
    }
  }
  if (!!entry.inProgress === want) continue;
  if (want) entry.inProgress = true; else delete entry.inProgress;
  console.log(`${season}: D Ratings ${want ? "marked" : "no longer marked"} in progress`);
  defsChanged++;
}
if (changed && !check) fs.writeFileSync(LGA_PATH, JSON.stringify(lgas, null, 2) + "\n");
if (usageChanged && !check) fs.writeFileSync(USAGE_PATH, JSON.stringify(usage, null, 2) + "\n");
if (defsChanged && !check) fs.writeFileSync(DEF_PATH, JSON.stringify(defs, null, 2) + "\n");
console.log(`${check ? "would update" : "updated"} ${changed} season baseline(s), ${usageChanged} usage model(s), ${defsChanged} in-progress def-ratings update(s)`);
