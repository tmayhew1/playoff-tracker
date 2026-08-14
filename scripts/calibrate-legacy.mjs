#!/usr/bin/env node
// Calibrates the Legacy fold and writes app/data/legacy-dials.json, which
// app/lib/legacy.js reads as P_DEFAULT.
//
//   node scripts/calibrate-legacy.mjs          # write
//   node scripts/calibrate-legacy.mjs --check  # report without writing
//
// The fold aggregates a career's positive seasons under the l_p norm, so a
// season worth a share s of your best carries s^(p-1) of the weight the best
// one carries. That turns the dial into a single sentence, and setting it into
// a single decision: how deep should the guarantee reach?
//
//   "a season worth a TENTH of your best still carries HALF the weight"
//
// which gives p = 1 + ln(0.5)/ln(0.1) = 1.30103. Both numbers are stated here
// rather than buried in a constant, so changing the principle changes the dial.
//
// This replaces two earlier attempts. A hand-set 0.94 came from asserting that
// the best 7 of 20 seasons carry half the weight — three invented constants
// that did not deliver the balance they claimed. A calibrated 0.8084 fixed the
// arithmetic but kept the deeper problem: weighting by RANK says an eighth-best
// season counts 23% whether it was nearly your best or nearly worthless.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCareers } from "../app/api/_lib/careers.js";
import { balanceOf, rankLegacy, pForHalfWeightAt, weightForShare } from "../app/lib/legacy.js";
import { ALPHA_DEFAULT } from "../app/lib/leverage.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const OUT = path.join(DATA, "legacy-dials.json");

// The principle, stated once.
const HALF_WEIGHT_SHARE = 0.1;
const HALF = 0.5;

const check = process.argv.includes("--check");
const p = pForHalfWeightAt(HALF_WEIGHT_SHARE, HALF);

const built = buildCareers({ dataDir: DATA });
if (built.skipped.length) {
  console.error(`  note: ${built.skipped.length} season(s) skipped — incomplete baseline`);
}
const opts = { alpha: ALPHA_DEFAULT, includeRS: true, minSeasons: 1, minGames: 400, p };

console.log(`principle: a season worth ${HALF_WEIGHT_SHARE * 100}% of your best carries `
  + `${HALF * 100}% of its weight`);
console.log(`  => p = ${p.toFixed(5)}\n`);
console.log("  share of your best   weight it carries");
for (const s of [1, 0.75, 0.5, 0.25, 0.1, 0.05]) {
  console.log(`  ${(s * 100).toFixed(0).padStart(17)}%   ${weightForShare(s, p).toFixed(3)}`);
}

const bal = balanceOf(built.players, opts);
if (bal) {
  console.log(`\n  ${bal.pool} careers · distance from a plain career sum ${bal.tau.toFixed(3)}`
    + ` · from a best-season ranking ${bal.tauPeak.toFixed(3)}`);
  console.log(`  gap ${bal.gap.toFixed(3)} — longevity-tilted, which is the price of keeping`
    + ` the tail alive; no p removes it.`);
}

const board = rankLegacy(built.players, opts);
console.log("\n  top 10:");
board.slice(0, 10).forEach((x, i) =>
  console.log(`   ${String(i + 1).padStart(2)}. ${x.name.padEnd(22)} ${Math.round(x.total).toLocaleString().padStart(7)}`));

const payload = {
  p: Number(p.toFixed(5)),
  method: "l_p norm over positive seasons; p set so a season worth "
    + `${HALF_WEIGHT_SHARE} of the best carries ${HALF} of its weight`,
  halfWeightShare: HALF_WEIGHT_SHARE,
  half: HALF,
  pool: bal ? bal.pool : null,
  gap: bal ? Number(bal.gap.toFixed(4)) : null,
  seasons: built.seasons.length,
  firstSeason: built.seasons[0],
  lastSeason: built.seasons[built.seasons.length - 1],
};

if (check) {
  const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const moved = Math.abs((prev.p ?? 0) - payload.p);
  console.log(`\n  on disk ${prev.p} · computed ${payload.p} · drift ${moved.toFixed(5)}`);
  process.exit(moved > 1e-5 ? 1 : 0);
}

fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
console.log(`\n  wrote ${path.relative(ROOT, OUT)}`);
