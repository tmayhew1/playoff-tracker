// Recomputes the baked `va` in every leaderboard-<season>.json from the raw box
// scores those files already carry, using the shipped scorer.
//
// The playoff bake is normally written by the R pipeline
// (scripts/R/scrape_common.R::value_add_parts). When a VA formula changes and R
// isn't available to re-run the scrape, this rewrites just the derived numbers
// — `va` and `eff` per player-season and `va` per game — from the raw counts,
// which are untouched. Same formula, same source data, no refetch.
//
// It matters that these stay current: /api/players reads the baked `va`
// directly for the playoffs scope (route.js: `scope === "playoffs" ? p.va : …`),
// so a stale file would leave By Player and the leaderboard disagreeing.
//
// Playoff lines, so the blended playoff baseline (spec §4.8). That blend is
// measured from the RAW stats in these same files, never from the `va` this
// script rewrites, so re-baking cannot move the baseline it was baked against —
// no iteration, and a second run is a no-op. Run
// scripts/bake-playoff-averages.mjs first if the raw rows have changed.
//
// Usage: node scripts/rebake-leaderboard-va.mjs [--check]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");

// app/scoring.js is authored for the bundler (JSON import assertions, a
// ./teams import for the bracket helpers). Load it here by rewriting those two
// things, so this script and the app can never drift to different formulas.
const shim = path.join(DATA, ".scoring-shim.mjs");
fs.writeFileSync(shim, 'import fs from "node:fs";\n' +
  fs.readFileSync(path.join(ROOT, "app", "scoring.js"), "utf8")
    .replace(/import (\w+) from "\.\/data\/(.*?)\.json";/g,
      (_m, v, f) => `const ${v} = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(DATA, f + ".json"))}, "utf8"));`)
    .replace(/import \{[^}]*\} from "\.\/teams";/,
      "const TEAMS = {}, BRACKET = { r1: [], r2: [], r3: [], r4: [] }, ROUND_BASE = {}, ROUND_LABEL = {};"));
const { valueAddParts, lgaForSeason } = await import(pathToFileURL(shim).href);
fs.unlinkSync(shim);

const check = process.argv.includes("--check");
const files = fs.readdirSync(DATA).filter((f) => /^leaderboard-\d{4}-\d{2}\.json$/.test(f)).sort();
let changed = 0, maxDelta = 0;

for (const f of files) {
  const full = path.join(DATA, f);
  const data = JSON.parse(fs.readFileSync(full, "utf8"));
  const lga = lgaForSeason(data.season, false, "po");
  for (const p of data.players || []) {
    const before = p.va || 0;
    // The season row is scored from the SUMMED season line, and each game from
    // its own line — reproducing exactly what the R bake writes today. Those
    // two are not equal (a season's VA is not the sum of its games' because the
    // rebound credit gamma is non-linear in a player's own rate), and
    // /api/leaderboard builds its season number the other way, by summing
    // games. That divergence is pre-existing and deliberately left alone here:
    // this script re-scores against a different BASELINE and changes nothing
    // else, so the diff stays attributable to one thing.
    for (const g of p.games || []) {
      if (g.va == null) continue;
      g.va = valueAddParts(g, lga).va;
    }
    const r = valueAddParts(p, lga);
    p.va = r.va; p.eff = r.efficiency;
    maxDelta = Math.max(maxDelta, Math.abs(r.va - before));
  }
  // Two-space indent and a trailing newline, matching what jsonlite writes on
  // the R side. Not byte-identical to it — R prints floats at 17 significant
  // digits (803.95000000000005) where JS prints the shortest round-trip form
  // (803.95); the doubles are the same, only the text differs — but keeping the
  // STRUCTURE identical is what matters: it keeps the diff line-level and
  // readable, and it keeps the daily R backfill merging cleanly instead of
  // conflicting on one enormous minified line.
  if (!check) fs.writeFileSync(full, JSON.stringify(data, null, 2) + "\n");
  changed++;
}
console.log(`${check ? "would rewrite" : "rewrote"} ${changed} leaderboard files; largest season-VA change ${maxDelta.toFixed(1)}`);
