// The regular-season bake (scripts/bake-regular-season-games.mjs) against a
// stubbed ESPN: what it writes, how a season in progress tops up, and that
// the packed box scores read back as the lines /api/regular-season/lines
// gives.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allSeasons, bakeSeason, seasonDays, seasonOf } from "../scripts/bake-regular-season-games.mjs";
import { bakedThrough, unpackMonth } from "../app/lib/regular-season-games.js";

const ev = (id, date, home, hs, away, as, { type = 2, completed = true, state } = {}) => ({
  id, date, season: { type },
  competitions: [{
    status: { type: { completed, state: state || (completed ? "post" : "pre") } },
    notes: [],
    competitors: [
      { homeAway: "home", score: String(hs), team: { abbreviation: home } },
      { homeAway: "away", score: String(as), team: { abbreviation: away } },
    ],
  }],
});

// ESPN's summary: away side first, a starter, a bench player and a DNP each.
const summary = (away, home) => ({
  boxscore: {
    players: [away, home].map((abbr) => ({
      team: { abbreviation: abbr },
      statistics: [{
        names: ["MIN", "FG", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-", "PTS"],
        athletes: [
          { athlete: { displayName: `${abbr} Star` }, starter: true, stats: ["36", "10-20", "3-7", "5-6", "1", "7", "8", "6", "2", "1", "3", "2", "+9", "28"] },
          { athlete: { displayName: "Shared Name" }, starter: false, stats: ["12:30", "2-4", "0-1", "0-0", "0", "2", "2", "1", "0", "0", "1", "1", "-3", "4"] },
          { athlete: { displayName: `${abbr} Bench` }, didNotPlay: true, stats: [] },
        ],
      }],
    })),
  },
});

// A fake ESPN: `days` maps YYYYMMDD -> events; every event has a box score
// except the ids in `noBox`. Records every URL asked.
function espn(days, { noBox = [], failDays = [] } = {}) {
  const asked = [];
  const getJson = async (url) => {
    asked.push(url);
    const day = /dates=(\d{8})/.exec(url)?.[1];
    if (day) {
      if (failDays.includes(day)) throw new Error("HTTP 503");
      return { events: days[day] || [] };
    }
    const id = /event=(\d+)|gameId=(\d+)/.exec(url).slice(1).find(Boolean);
    if (noBox.includes(id)) throw new Error("HTTP 404");
    const e = Object.values(days).flat().find((x) => x.id === id);
    const [h, a] = e.competitions[0].competitors;
    return summary(a.team.abbreviation, h.team.abbreviation);
  };
  return { getJson, asked };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rs-bake-"));
const read = (dir, ...p) => JSON.parse(fs.readFileSync(path.join(dir, ...p), "utf8"));

test("seasons and their days", () => {
  assert.equal(seasonOf("2026-10-17"), "2026-27");
  assert.equal(seasonOf("2026-08-01"), "2025-26");
  const days = seasonDays("2025-26");
  assert.equal(days[0], "2025-10-01");
  assert.equal(days.at(-1), "2026-05-31");
  assert.equal(seasonDays("2019-20").at(-1), "2020-08-31");
  const all = allSeasons("2026-10-17");
  assert.equal(all[0], "1999-00");
  assert.equal(all.at(-1), "2026-27");
});

test("a finished season bakes whole: index, months, packed box scores", async () => {
  const out = tmp();
  const { getJson, asked } = espn({
    20251022: [ev("401", "2025-10-22T23:30Z", "NY", 110, "BOS", 104), ev("400", "2025-10-08T23:00Z", "LAL", 99, "GS", 101, { type: 1 })],
    20251101: [ev("402", "2025-11-01T02:30Z", "UTAH", 100, "WSH", 98)], // 10:30pm ET Oct 31
    20251203: [ev("403", "2025-12-04T00:00Z", "SA", 120, "GS", 118)],
  }, { noBox: ["403"] });
  const log = await bakeSeason("2025-26", { getJson, outDir: out, today: "2026-10-17" });
  assert.match(log, /\+3 games \(2 with box scores\) through 2026-05-31, complete; 3 total, 1 without a box score/);
  assert.equal(asked.filter((u) => u.includes("scoreboard")).length, seasonDays("2025-26").length);

  const index = read(out, "2025-26", "index.json");
  assert.equal(index.complete, true);
  assert.equal(bakedThrough(index), "9999-12-31");
  assert.deepEqual(index.games.map((g) => [g.gameId, g.date, g.home.tri, g.away.tri]), [
    ["401", "2025-10-22", "NYK", "BOS"], ["402", "2025-10-31", "UTA", "WAS"], ["403", "2025-12-03", "SAS", "GSW"],
  ]);
  assert.deepEqual(index.noBox, ["403"]);
  assert.deepEqual(fs.readdirSync(path.join(out, "2025-26")).sort(), ["2025-10.json", "2025-12.json", "index.json"]);
  assert.equal(unpackMonth(read(out, "2025-26", "2025-12.json")).size, 0, "every month with games has a file, even boxless");

  const oct = unpackMonth(read(out, "2025-26", "2025-10.json"));
  assert.deepEqual([...oct.keys()].sort(), ["401", "402"]);
  const g = oct.get("402");
  assert.deepEqual([g.home.tri, g.home.score, g.away.tri, g.away.score], ["UTA", 100, "WAS", 98]);
  assert.deepEqual(g.home.players.map((p) => p.name), ["UTAH Star", "Shared Name"], "the DNP is left out");
  const star = g.home.players[0];
  assert.deepEqual(
    [star.starter, star.mp, star.pts, star.reb, star.drb, star.orb, star.ast, star.fgm, star.fga, star.tpm, star.tpa, star.ftm, star.fta, star.plusMinus],
    [true, 36, 28, 8, 7, 1, 6, 10, 20, 3, 7, 5, 6, 9],
  );
  assert.equal(g.away.players[1].mp, 12.5, "MM:SS minutes");
  assert.equal(g.away.players[1].starter, false);
  assert.equal(read(out, "2025-26", "2025-10.json").names.filter((n) => n === "Shared Name").length, 1, "names stored once a month");
});

test("a baked season is left alone, except to retry its missing box scores", async () => {
  const out = tmp();
  const days = { 20260110: [ev("501", "2026-01-11T00:00Z", "DEN", 120, "PHX", 110), ev("502", "2026-01-11T03:00Z", "LAL", 101, "MIN", 99)] };
  await bakeSeason("2025-26", { ...espn(days, { noBox: ["502"] }), outDir: out, today: "2026-10-17" });
  assert.deepEqual(read(out, "2025-26", "index.json").noBox, ["502"]);

  const index = fs.readFileSync(path.join(out, "2025-26", "index.json"), "utf8");
  assert.match(await bakeSeason("2025-26", { ...espn(days, { noBox: ["502"] }), outDir: out, today: "2026-10-17" }), /retried 1 missing box scores, 0 found/);
  assert.equal(fs.readFileSync(path.join(out, "2025-26", "index.json"), "utf8"), index, "a fruitless retry writes nothing");

  const retry = espn(days);
  assert.match(await bakeSeason("2025-26", { getJson: retry.getJson, outDir: out, today: "2026-10-17" }), /retried 1 missing box scores, 1 found/);
  assert.ok(!retry.asked.some((u) => u.includes("scoreboard")), "no scoreboard re-read");
  assert.ok(retry.asked.every((u) => u.includes("502")));
  assert.deepEqual(read(out, "2025-26", "index.json").noBox, []);
  assert.deepEqual([...unpackMonth(read(out, "2025-26", "2026-01.json")).keys()].sort(), ["501", "502"]);

  const again = espn(days);
  assert.match(await bakeSeason("2025-26", { getJson: again.getJson, outDir: out, today: "2026-10-17" }), /already baked \(2 games\)/);
  assert.equal(again.asked.length, 0);
});

test("a finished season with a day ESPN won't answer is not written", async () => {
  const out = tmp();
  const { getJson } = espn({ 20260110: [ev("501", "2026-01-11T00:00Z", "DEN", 120, "PHX", 110)] }, { failDays: ["20260214"] });
  await assert.rejects(bakeSeason("2025-26", { getJson, outDir: out, today: "2026-10-17" }), /scoreboard 2026-02-14 failed/);
  assert.ok(!fs.existsSync(path.join(out, "2025-26", "index.json")));
});

test("the season in progress tops up through yesterday, stopping at an unsettled day", async () => {
  const out = tmp();
  const days = {
    20261021: [ev("601", "2026-10-21T23:30Z", "NY", 110, "CLE", 104)],
    20261022: [ev("602", "2026-10-22T23:30Z", "BOS", 99, "PHI", 97), ev("603", "2026-10-23T02:00Z", "LAL", 0, "GS", 0, { completed: false, state: "in" })],
    20261023: [ev("604", "2026-10-23T23:30Z", "MIA", 101, "ORL", 100)],
  };
  assert.match(await bakeSeason("2026-27", { ...espn(days), outDir: out, today: "2026-09-30" }), /not started/);

  let log = await bakeSeason("2026-27", { ...espn(days), outDir: out, today: "2026-10-24" });
  assert.match(log, /\+1 games \(1 with box scores\) through 2026-10-21; 1 total/);
  let index = read(out, "2026-27", "index.json");
  assert.equal(index.complete, false);
  assert.equal(bakedThrough(index), "2026-10-21");

  days[20261022][1] = ev("603", "2026-10-23T02:00Z", "LAL", 115, "GS", 112);
  const next = espn(days);
  log = await bakeSeason("2026-27", { getJson: next.getJson, outDir: out, today: "2026-10-25" });
  assert.match(log, /\+3 games \(3 with box scores\) through 2026-10-24; 4 total/);
  assert.ok(!next.asked.some((u) => /dates=202610(0\d|1\d|2[01])$/.test(u)), "baked days aren't asked again");
  index = read(out, "2026-27", "index.json");
  assert.deepEqual(index.games.map((g) => g.gameId), ["601", "602", "603", "604"]);
  assert.deepEqual([...unpackMonth(read(out, "2026-27", "2026-10.json")).keys()].sort(), ["601", "602", "603", "604"]);
});

test("the page reads a baked season, and asks live only past it", async (t) => {
  const out = tmp();
  const days = {
    20251022: [ev("701", "2025-10-22T23:30Z", "NY", 110, "BOS", 104)],
    20251105: [ev("702", "2025-11-05T23:30Z", "DEN", 120, "PHX", 110), ev("703", "2025-11-06T00:30Z", "MIA", 99, "ATL", 97)],
  };
  await bakeSeason("2025-26", { ...espn(days, { noBox: ["703"] }), outDir: out, today: "2026-10-17" });
  const { bakedBox, loadBoxes, seasonGames } = await import("../app/lib/baked-games.js");

  const asked = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    asked.push(url);
    const m = /^\/regular-season-games\/(.+)$/.exec(url);
    const file = m && path.join(out, m[1]);
    if (file && fs.existsSync(file)) return new Response(fs.readFileSync(file), { status: 200 });
    if (url.startsWith("/api/regular-season/lines")) {
      return new Response(JSON.stringify({ games: [{ gameId: "999", home: { tri: "CLE", players: [] }, away: { tri: "DET", players: [] } }] }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });

  const liveMonths = [];
  const { games, baked } = await seasonGames("2025-26", ["202510", "202511"], async (m) => { liveMonths.push(m); return { games: [] }; });
  assert.equal(baked, true);
  assert.deepEqual(liveMonths, [], "a complete season asks nothing live");
  assert.deepEqual(games.map((g) => g.gameId), ["701", "702", "703"]);

  const progress = [];
  const boxes = await loadBoxes("2025-26", games, (p) => progress.push(p), () => false);
  assert.deepEqual(boxes.map((b) => [b.gameId, b.date]), [["701", "2025-10-22"], ["702", "2025-11-05"]]);
  assert.ok(!asked.some((u) => u.startsWith("/api/")), "no live call: 703 is known to have no box");
  assert.deepEqual(progress.at(-1), { done: 2, total: 2 });

  const box = await bakedBox("2025-26", games[1]);
  assert.deepEqual([box.gameId, box.home.tri, box.status, box.home.players[0].name], ["702", "DEN", "Final", "DEN Star"]);
  assert.equal(await bakedBox("2025-26", { gameId: "999", date: "2025-12-01" }), null);

  // A season that isn't baked: every month live, every box score live.
  const live = await seasonGames("2024-25", ["202410"], async () => ({ games: [{ gameId: "999", date: "2024-10-30" }] }));
  assert.equal(live.baked, false);
  const liveBoxes = await loadBoxes("2024-25", live.games, () => {}, () => false);
  assert.deepEqual(liveBoxes.map((b) => b.gameId), ["999"]);
  assert.ok(asked.includes("/api/regular-season/lines?ids=999"));
});
