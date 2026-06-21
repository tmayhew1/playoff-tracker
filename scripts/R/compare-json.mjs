#!/usr/bin/env node
/**
 * Semantic deep-compare of two JSON files, used to verify the R pipeline's
 * output matches a reference (e.g. a previously baked file) regardless of
 * cosmetic number-formatting differences.
 *
 *   node scripts/R/compare-json.mjs <a.json> <b.json> [--tol 1e-6]
 *
 * Numbers are compared within an absolute tolerance; the volatile
 * `fetchedAt` timestamp is ignored. Exits non-zero on any mismatch.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
let TOL = 1e-6;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--tol") { TOL = Number(args[++i]); continue; }
  files.push(args[i]);
}
if (files.length !== 2) {
  console.error("Usage: node compare-json.mjs <a.json> <b.json> [--tol 1e-6]");
  process.exit(2);
}

const a = JSON.parse(readFileSync(files[0], "utf8"));
const b = JSON.parse(readFileSync(files[1], "utf8"));

const diffs = [];
function walk(x, y, path) {
  if (path.endsWith(".fetchedAt")) return;
  if (typeof x === "number" && typeof y === "number") {
    if (Math.abs(x - y) > TOL) diffs.push(`${path}: ${x} vs ${y} (Δ${Math.abs(x - y).toExponential(2)})`);
    return;
  }
  if (Array.isArray(x) || Array.isArray(y)) {
    if (!Array.isArray(x) || !Array.isArray(y)) { diffs.push(`${path}: array/non-array`); return; }
    if (x.length !== y.length) { diffs.push(`${path}: length ${x.length} vs ${y.length}`); return; }
    for (let i = 0; i < x.length; i++) walk(x[i], y[i], `${path}[${i}]`);
    return;
  }
  if (x && y && typeof x === "object" && typeof y === "object") {
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) {
      if (!(k in x) || !(k in y)) { diffs.push(`${path}.${k}: present on one side only`); continue; }
      walk(x[k], y[k], `${path}.${k}`);
    }
    return;
  }
  if (x !== y) diffs.push(`${path}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
}
walk(a, b, "$");

if (diffs.length === 0) {
  console.log(`✓ semantically identical (tolerance ${TOL})`);
  process.exit(0);
}
console.log(`✗ ${diffs.length} difference(s) (tolerance ${TOL}):`);
for (const d of diffs.slice(0, 40)) console.log("  " + d);
if (diffs.length > 40) console.log(`  …and ${diffs.length - 40} more`);
process.exit(1);
