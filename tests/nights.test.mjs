// "Last night": the nightly bake (scripts/bake-nights.mjs) run against the
// NBA-CDN-shaped fixtures in tests/fixtures/nights, and /api/nights on what
// it writes.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { seasonOf } from "../scripts/bake-nights.mjs";
import { valueAddParts, lgaForSeason } from "../app/scoring.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "nights-"));
const bake = (...args) => execFileSync(process.execPath, [
  "--import", "./scripts/node/register.mjs", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  "scripts/bake-nights.mjs", ...args,
], { cwd: ROOT, env: { ...process.env, NIGHTS_FIXTURES: "tests/fixtures/nights", NIGHTS_OUT: OUT }, encoding: "utf8" });

// The route reads NIGHTS_DIR when it loads, so set it before importing.
process.env.NIGHTS_DIR = OUT;
const { GET } = await import("../app/api/nights/route.js");
const get = async (q = "") => (await GET(new Request(`http://x/api/nights${q}`))).json();

test("seasons turn over in the fall", () => {
  assert.equal(seasonOf("2026-10-21"), "2026-27");
  assert.equal(seasonOf("2027-04-12"), "2026-27");
  assert.equal(seasonOf("2027-06-18"), "2026-27");
});

test("no nights baked: an empty answer, not an error", async () => {
  const d = await get();
  assert.equal(d.date, null);
  assert.deepEqual(d.dates, []);
});

test("the bake writes finished nights only, once", () => {
  const log = bake("--date", "2026-01-15", "--date", "2026-01-16", "--date", "2025-10-05");
  assert.match(log, /2026-01-15: 2 games, 7 player lines \(6 linked/);
  assert.match(log, /2026-01-16: 1 of 1 games not final yet - skipped/);
  assert.match(log, /2025-10-05: no games/); // preseason doesn't count
  assert.deepEqual(fs.readdirSync(OUT), ["2026-01-15.json"]);
  assert.match(bake("--date", "2026-01-15"), /already baked/);

  const night = JSON.parse(fs.readFileSync(path.join(OUT, "2026-01-15.json"), "utf8"));
  assert.equal(night.season, "2025-26");
  assert.ok(!night.players.some((p) => p.name === "Deep Bench Guy"), "a DNP is left out");
  const jokic = night.players.find((p) => p.slug === "jokicni01");
  assert.equal(jokic.name, "Nikola Jokić");
  assert.deepEqual([jokic.team, jokic.opp, jokic.mp, jokic.pts, jokic.drb, jokic.orb], ["DEN", "NYK", 37, 31, 12, 4]);
});

test("/api/nights scores and ranks the night", async () => {
  const d = await get();
  assert.equal(d.date, "2026-01-15");
  assert.equal(d.baselineSeason, "2025-26");
  assert.equal(d.lines.length, 7);
  for (let i = 1; i < d.lines.length; i++) assert.ok(d.lines[i - 1].va >= d.lines[i].va, "sorted by VA");
  const top = d.lines[0];
  assert.equal(top.slug, "jokicni01");
  assert.equal(top.won, true);
  assert.equal(top.reb, 16);
  const expect = valueAddParts(top, lgaForSeason("2025-26")).va;
  assert.ok(Math.abs(top.va - expect) < 1e-9);
  assert.ok(top.seasonVaPerG > 0, "set against his season average");
  assert.equal(d.lines.find((l) => !l.slug).seasonVaPerG, null);
});

test("dates step and fall back", async () => {
  fs.copyFileSync(path.join(OUT, "2026-01-15.json"), path.join(OUT, "2026-01-14.json"));
  const latest = await get();
  assert.equal(latest.prev, "2026-01-14");
  assert.equal(latest.next, null);
  const earlier = await get("?date=2026-01-14");
  assert.equal(earlier.next, "2026-01-15");
  assert.equal((await get("?date=../../etc")).date, "2026-01-15");
  const usg = await get("?usg=1");
  assert.equal(usg.usgAdj, true);
  assert.notEqual(usg.lines[0].va, latest.lines[0].va);
});
