// Shareable links: the URL format (app/lib/share-params.js) and the numbers a
// link preview shows (app/api/_lib/share-card.js).
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShareParams, shareQuery } from "../app/lib/share-params.js";
import { playerSeasonCard, careerCard, shareSummary } from "../app/api/_lib/share-card.js";
import { GET as playersGET } from "../app/api/players/route.js";

const parse = (q) => parseShareParams(new URLSearchParams(q));

test("a link survives parse -> build unchanged", () => {
  for (const q of [
    "?scope=playoffs&season=2015-16&p=jamesle01&vs=curryst01:2015-16",
    "?view=player&p=jokicni01&ps=2024-25&b=usg",
    "?view=player&scope=regular&p=jokicni01",
    "?season=2025-26",
    "?tab=legacy",
    "?tab=2025-26&b=usg",
    "",
  ]) {
    assert.equal(shareQuery(parse(q)), q);
  }
});

test("defaults are left out of a link", () => {
  assert.equal(shareQuery({ tab: "explore", view: "season", scope: "combined", usg: false }), "");
  // Explore's keys don't ride along on another tab.
  assert.equal(shareQuery({ tab: "legacy", p: "jamesle01", season: "2015-16" }), "?tab=legacy");
  // A compare needs a player to compare.
  assert.equal(shareQuery({ season: "2015-16", vs: { slug: "curryst01", season: "2015-16" } }), "?season=2015-16");
});

test("malformed values are dropped, never passed through", () => {
  const st = parse("p=../../etc/passwd&season=2015&scope=all&vs=curryst01&tab=<script>&ps=x&b=yes");
  assert.deepEqual(st, {
    tab: null, view: "season", scope: "combined", season: null, p: null, ps: null, vs: null, usg: false,
  });
  // shareQuery holds component-supplied values to the same patterns.
  assert.equal(shareQuery({ p: "a&b=c", season: "2015-16" }), "?season=2015-16");
});

// The preview must show the page's numbers. /api/players is what By Player
// renders, so a card has to agree with it season for season, in every scope.
test("preview numbers match /api/players", async () => {
  for (const scope of ["playoffs", "regular", "combined"]) {
    const res = await playersGET(new Request(`http://x/api/players?scope=${scope}`));
    const { players } = await res.json();
    for (const slug of ["jokicni01", "jamesle01", "curryst01"]) {
      const idx = players.find((p) => p.slug === slug);
      for (const s of idx.seasons.slice(0, 4)) {
        const card = await playerSeasonCard({ slug, season: s.season, scope });
        assert.ok(card, `${scope} ${slug} ${s.season}: no card`);
        assert.ok(Math.abs(card.va - s.va) < 0.01, `${scope} ${slug} ${s.season}: card ${card.va}, page ${s.va}`);
        assert.equal(card.gp, s.gp);
      }
      const career = await careerCard(slug, scope);
      assert.ok(Math.abs(career.va - idx.careerVa) < 0.05, `${scope} ${slug} career: card ${career.va}, page ${idx.careerVa}`);
      assert.equal(career.seasons, idx.seasons.length);
    }
  }
});

test("a link to nothing gets no preview text", async () => {
  assert.equal(await shareSummary(parse("p=nobodyxx01&season=2015-16")), null);
  assert.equal(await shareSummary(parse("tab=legacy")), null);
  assert.equal(await shareSummary(parse("")), null);
});
