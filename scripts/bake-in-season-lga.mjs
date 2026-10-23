// The season in progress's league baseline in app/data/league-averages.json,
// measured from its own baked box scores (public/regular-season-games) and
// shrunk toward the season before while the sample is thin
// (lib/season-to-date.js inSeasonLga). A finished season is left to the R
// pipeline (recompute_derived.R rebuilds it from basketball-reference's table).
//
// No network. Run in the daily workflow after the regular-season games bake:
//
//   node --import ./scripts/node/register.mjs scripts/bake-in-season-lga.mjs [--check]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gamesWithBoxes, inSeasonLga, playerTotals } from "../app/lib/season-to-date.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LGA_PATH = path.join(ROOT, "app", "data", "league-averages.json");
const GAMES = path.join(ROOT, "public", "regular-season-games");
const check = process.argv.includes("--check");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const prevSeason = (s) => { const y = Number(s.slice(0, 4)) - 1; return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; };

const lgas = read(LGA_PATH);
let changed = 0;
for (const season of fs.readdirSync(GAMES).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort()) {
  const dir = path.join(GAMES, season);
  const indexPath = path.join(dir, "index.json");
  if (!fs.existsSync(indexPath)) continue;
  const index = read(indexPath);
  if (index.complete) continue;
  const months = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => read(path.join(dir, f)));
  const rows = playerTotals(gamesWithBoxes(index, months));
  const prior = lgas[prevSeason(season)];
  if (!rows.length || !prior) continue;
  const next = inSeasonLga(rows, prior);
  // The season's own shot-distance split, once fetch_shooting_splits.R has one.
  if (lgas[season]?.zoneFG) next.zoneFG = lgas[season].zoneFG;
  const mp = rows.reduce((s, r) => s + r.mp, 0);
  console.log(`${season}: ${rows.length} players, ${Math.round(mp)} min through ${index.through} — laPTSperM ${next.laPTSperM.toFixed(4)}, laBLKperM ${next.laBLKperM.toFixed(4)}`);
  if (JSON.stringify(lgas[season]) !== JSON.stringify(next)) { lgas[season] = next; changed++; }
}
if (changed && !check) fs.writeFileSync(LGA_PATH, JSON.stringify(lgas, null, 2) + "\n");
console.log(`${check ? "would update" : "updated"} ${changed} season(s)`);
