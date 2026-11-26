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

test("a player's recent games: the last ten, his season by month, and a short run's gap", { skip: !fs.existsSync(path.join(BAKED, SEASON)) }, async () => {
  const { recentGames } = await import("../app/lib/month-tables.js");
  await seasonMonthly(SEASON, months, lga);
  const names = [...peekMonthly(SEASON, months, lga).byName.keys()];
  const total = (name) => months.reduce((n, m) => n + (monthRows(SEASON, m, peekBoxes(SEASON, m), lga).find((r) => r.name === name)?.gp || 0), 0);
  const all = names.map((name) => ({ name, r: recentGames(SEASON, months, lga, name, { today: "2099-01-01" }) }));

  // Played into April: his last ten, the line those ten, the bars each whole month.
  const regular = all.find(({ name, r }) => !r.short && total(name) > 40);
  const { r } = regular;
  assert.equal(r.recent.length, 10);
  assert.equal(r.line.length, 10);
  assert.ok(r.line.every(Boolean));
  assert.deepEqual(r.bars.map((b) => b.label), ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"]);
  assert.equal(r.bars.find((b) => b.key === "2025-01").title, "January 2025");
  for (const b of r.bars) {
    const m = months.find((x) => x.key === b.key);
    assert.equal(b.games.length, monthRows(SEASON, m, peekBoxes(SEASON, m), lga).find((x) => x.name === regular.name)?.gp || 0, `${b.key}: the whole month`);
  }
  const dates = r.recent.map((g) => g.date);
  assert.deepEqual(dates, [...dates].sort());

  // Read through January: his last ten as of Jan 31, the bars Oct–Jan.
  const jan = recentGames(SEASON, months, lga, regular.name, { today: "2099-01-01", through: "2025-01" });
  assert.deepEqual(jan.bars.map((b) => b.label), ["Oct", "Nov", "Dec", "Jan"]);
  assert.ok(jan.recent.every((g) => g.date <= "2025-01-31"));
  assert.ok(jan.recent.at(-1).date >= "2025-01-20", "up to the end of the month");

  // Fewer than ten in the season's last two months: those are the last bar,
  // and the line is nine games with one gap where the two months begin.
  const short = all.find(({ r }) => r?.short && r.recent.length < 8);
  assert.ok(short, "some player had a short run");
  const s = short.r;
  const lastNight = index.games.reduce((d, g) => (g.date > d ? g.date : d), "");
  const from = new Date(Date.UTC(+lastNight.slice(0, 4), +lastNight.slice(5, 7) - 3, +lastNight.slice(8, 10))).toISOString().slice(0, 10);
  assert.equal(s.line.length, 10);
  assert.equal(s.line.filter((g) => g === null).length, 1);
  assert.equal(s.line.filter(Boolean).length, 9);
  const gap = s.line.indexOf(null);
  assert.deepEqual(s.line.slice(gap + 1), s.recent);
  assert.ok(s.recent[0].date >= from, "the run is inside the two months before the last night");
  assert.ok(s.line[gap - 1].date < from);
});
