#!/usr/bin/env node
// Calibrates the Legacy fold's decay against the corpus and writes
// app/data/legacy-dials.json, which app/lib/legacy.js reads as DECAY_DEFAULT.
//
//   node scripts/calibrate-legacy.mjs          # write
//   node scripts/calibrate-legacy.mjs --check  # report without writing
//
// Run it after the bake adds seasons. The value it produces is the D whose
// ranking is equidistant — by Kendall tau over every qualifying career —
// between the fold's two parameter-free endpoints: a plain career sum (D = 1,
// pure longevity) and the single best season (D -> 0, pure peak). See
// decayForBalance in app/lib/legacy.js.
//
// This replaces a hand-set 0.94, which came from asserting that the best 7 of
// 20 seasons should carry half the weight — three invented constants that
// between them produced a board sitting tau 0.94 from pure longevity and only
// tau 0.75 from pure peak.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCareers } from "../app/api/_lib/careers.js";
import { decayForBalance, rankLegacy } from "../app/lib/legacy.js";
import { ALPHA_DEFAULT } from "../app/lib/leverage.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const OUT = path.join(DATA, "legacy-dials.json");

const check = process.argv.includes("--check");

const built = buildCareers({ dataDir: DATA });
if (built.skipped.length) {
  console.error(`  note: ${built.skipped.length} season(s) skipped — incomplete baseline`);
}

// The pool the board itself uses; calibrating on a different one would tune the
// dial to careers the board never shows.
const opts = { alpha: ALPHA_DEFAULT, includeRS: true, minSeasons: 3, minGames: 400 };

console.log("calibrating decay against " + built.seasons.length + " seasons…");
const t0 = Date.now();
const r = decayForBalance(built.players, opts);
console.log(`  D* = ${r.decay.toFixed(4)}  (${r.pool} careers, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log(`  tau to a plain career sum : ${r.tau.toFixed(4)}`);
console.log(`  tau to the best season    : ${r.tauPeak.toFixed(4)}`);

const board = rankLegacy(built.players, { ...opts, decay: r.decay });
console.log("\n  top 10 at D*:");
board.slice(0, 10).forEach((p, i) =>
  console.log(`   ${String(i + 1).padStart(2)}. ${p.name.padEnd(22)} ${Math.round(p.total).toLocaleString().padStart(7)}`));

const payload = {
  decay: Number(r.decay.toFixed(4)),
  method: "kendall-tau balance between a plain career sum (D=1) and the best season (D->0)",
  pool: r.pool,
  tau: Number(r.tau.toFixed(4)),
  seasons: built.seasons.length,
  firstSeason: built.seasons[0],
  lastSeason: built.seasons[built.seasons.length - 1],
};

if (check) {
  const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const moved = Math.abs(prev.decay - payload.decay);
  console.log(`\n  on disk ${prev.decay} · computed ${payload.decay} · drift ${moved.toFixed(4)}`);
  process.exit(moved > 0.0001 ? 1 : 0);
}

fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
console.log(`\n  wrote ${path.relative(ROOT, OUT)}`);
