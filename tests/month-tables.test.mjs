// Month Averages' shared cache (app/lib/month-tables.js), run against a real
// baked season (public/regular-season-games/2024-25): warming loads and
// scores it ahead of time, the cached tables are the ones the page computed
// on a tap before, and a tap after warming asks the network for nothing.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groupByMonth, monthlyVA, monthTotals } from "../app/lib/regular-season-games.js";
import { lgaForSeason } from "../app/scoring.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEASON = "2024-25";
const BAKED = path.join(ROOT, "public", "regular-season-games");

const asked = [];
globalThis.fetch = async (url) => {
  asked.push(url);
  const m = /^\/regular-season-games\/([^?]+)/.exec(url);
  const file = m && path.join(BAKED, m[1]);
  if (file && fs.existsSync(file)) return new Response(fs.readFileSync(file), { status: 200 });
  return new Response("{}", { status: 404 });
};

const { monthBoxes, monthRows, peekBoxes, peekMonthly, peekRows, seasonMonthly, warmSeason } = await import("../app/lib/month-tables.js");
const index = JSON.parse(fs.readFileSync(path.join(BAKED, SEASON, "index.json"), "utf8"));
const months = groupByMonth(index.games);
const lga = lgaForSeason(SEASON);

const until = async (cond, ms = 20000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

test("warming loads and scores a baked season ahead of any tap", { skip: !fs.existsSync(path.join(BAKED, SEASON)) }, async () => {
  assert.equal(peekMonthly(SEASON, months, lga), null);
  warmSeason(SEASON, months, lga);
  await until(() => peekMonthly(SEASON, months, lga));
  for (const m of months) {
    assert.ok(peekBoxes(SEASON, m), `${m.key} box scores loaded`);
    assert.ok(peekRows(SEASON, m, lga), `${m.key} table scored`);
  }
  const files = asked.filter((u) => u.startsWith("/regular-season-games/"));
  assert.equal(files.length, months.length + 1, "the index and each month once");
  assert.ok(asked.includes("/api/def-ratings"), "the breakdown's ratings fetched ahead");

  // The same answers the page computed on a tap before.
  const jan = months.find((m) => m.key === "2025-01");
  const boxes = peekBoxes(SEASON, jan);
  assert.equal(boxes.length, jan.games.length);
  assert.deepEqual(peekRows(SEASON, jan, lga), monthTotals(boxes, lga));
  const before = monthlyVA(months.map((m) => ({ key: m.key, boxes: peekBoxes(SEASON, m) })), lga);
  const chart = peekMonthly(SEASON, months, lga);
  assert.deepEqual(chart.months.map((m) => m.label), ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"]);
  assert.deepEqual([...chart.byName.entries()].sort(), [...before.entries()].sort());

  // A tap now: nothing asked of the network, the same objects handed back.
  const n = asked.length;
  assert.equal(await monthBoxes(SEASON, jan), boxes);
  assert.equal(monthRows(SEASON, jan, boxes, lga), peekRows(SEASON, jan, lga));
  assert.equal(await seasonMonthly(SEASON, months, lga), chart);
  assert.equal(asked.length, n);
});

test("another baseline is scored separately, and an equal one shares the cache", { skip: !fs.existsSync(path.join(BAKED, SEASON)) }, async () => {
  const jan = months.find((m) => m.key === "2025-01");
  const boxes = peekBoxes(SEASON, jan) || await monthBoxes(SEASON, jan);
  const other = { ...lga, la3P: lga.la3P + 0.02 };
  assert.equal(peekRows(SEASON, jan, other), null);
  const rows = monthRows(SEASON, jan, boxes, other);
  assert.deepEqual(rows, monthTotals(boxes, other));
  assert.equal(monthRows(SEASON, jan, boxes, { ...other }), rows, "an equal baseline object hits the same entry");
});

test("a season that isn't baked isn't warmed", async () => {
  const n = asked.length;
  const fake = [{ key: "2030-11", label: "November", games: [{ gameId: "1", date: "2030-11-01" }] }];
  warmSeason("2030-31", fake, lga);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(asked.slice(n).filter((u) => !u.startsWith("/regular-season-games/2030-31/index.json")), [], "only the index is asked");
  assert.equal(peekBoxes("2030-31", fake[0]), null);
});
