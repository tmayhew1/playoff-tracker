#!/usr/bin/env node
// Legacy rankings — the leverage-weighted all-time board.
//
//   node scripts/legacy-report.mjs                     # default dials
//   node scripts/legacy-report.mjs --alpha 1 --decay 1
//   node scripts/legacy-report.mjs --top 40 --no-rs
//   node scripts/legacy-report.mjs --player jamesle01 --player jordami01
//   node scripts/legacy-report.mjs --sweep decay
//   node scripts/legacy-report.mjs --verify
//
// The board also ships as the Legacy tab (/api/legacy), which ranks the same
// careers from the same join — buildCareers lives in app/api/_lib/careers.js so
// there is only one of it. This script stays the sharper instrument: dial
// sweeps, per-player folds, and --verify, none of which the tab exposes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCareers } from "../app/api/_lib/careers.js";
import {
  gameLeverage, bracketShape, swing, cLI, gameWeight, rsCLI, rsGamesFor, anchorCLI,
  ALPHA_DEFAULT,
} from "../app/lib/leverage.js";
import {
  rankLegacy, dialSweep, legacyFold, decayForPeakShare, peakShareAt,
  DECAY_DEFAULT, PEAK_SEASONS_DEFAULT,
} from "../app/lib/legacy.js";
import { lgaForSeason, baselineCoverage } from "../app/scoring.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "app", "data");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

// Mirrors normalizeName in app/lib/format.js closely enough for the --player
// lookup; slugs cover all but a handful of rows.
const norm = (s) => (s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z ]/g, "").trim();


// --- Build careers ----------------------------------------------------------
// The join itself is app/api/_lib/careers.js, shared with /api/legacy. Reading
// from DATA rather than process.cwd() keeps the script runnable from anywhere.

function build() {
  const built = buildCareers({ dataDir: DATA });
  if (built.skipped.length) {
    console.error(`  note: ${built.skipped.length} season(s) skipped — incomplete baseline: `
      + built.skipped.map((s) => `${s.season} (${s.missing.join(", ")})`).join("; "));
  }
  return built;
}


// --- Output -----------------------------------------------------------------

const fmt = (n, w = 8, d = 0) => n.toLocaleString("en-US", {
  minimumFractionDigits: d, maximumFractionDigits: d }).padStart(w);

function printBoard(board, { top, alpha, decay, includeRS, firstSeason }) {
  console.log(`\n=== Legacy — top ${top} `
    + `(alpha ${alpha}, decay ${decay}, regular season ${includeRS ? "in" : "out"}) ===\n`);
  console.log("  #  player                     legacy   peak/g  raw/g   sns  span         games");
  console.log("  " + "-".repeat(83));
  board.slice(0, top).forEach((p, i) => {
    console.log(`${String(i + 1).padStart(3)}. ${(p.name + (p.truncated ? " *" : "")).padEnd(24)}`
      + `${fmt(p.total, 9)} ${fmt(p.peak, 8, 2)} ${fmt(p.peakRaw, 7, 2)} `
      + `${String(p.seasonCount).padStart(4)}  ${p.span}  ${fmt(p.careerGames, 6)}`);
  });
  if (board.slice(0, top).some((p) => p.truncated)) {
    console.log(`\n  * career reaches ${firstSeason}, the first season on record — it may`
      + ` extend earlier, in which case this is measuring only part of it.`);
  }
}

function printPlayer(p) {
  console.log(`\n--- ${p.name}  (${p.span}, ${p.seasonCount} seasons, ${p.careerGames} games) ---`);
  console.log(`    legacy ${p.total.toFixed(0)} · career LVA ${p.careerLVA.toFixed(0)}`
    + ` · peak/g ${p.peak.toFixed(2)} (raw ${p.peakRaw.toFixed(2)})`);
  console.log("    rank  season     LVA    D^(k-1)   contribution");
  for (const s of p.seasons) {
    console.log(`    ${String(s.rank).padStart(4)}  ${s.season}  ${fmt(s.lva, 8, 1)}`
      + `   ${s.weight.toFixed(4)}   ${fmt(s.contribution, 10, 1)}`);
  }
}


// --- Verification -----------------------------------------------------------

function verify({ players, seasons }) {
  let fail = 0;
  const ok = (name, cond, detail = "") => {
    if (cond) console.log(`  ok   ${name}${detail ? "  " + detail : ""}`);
    else { fail++; console.log(`  FAIL ${name}  ${detail}`); }
  };
  const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

  console.log("TIER 1 — leverage math, no data");
  {
    const A = anchorCLI(4, 7);
    ok("anchor (depth 4, best-of-7) = 0.0390625", close(A, 0.0390625));
    for (const [a, b, n, want] of [[0,0,7,0.3125],[1,1,7,0.375],[2,0,7,0.25],[2,2,7,0.5],
                                   [3,3,7,1],[3,0,7,0.125],[0,0,5,0.375],[0,0,3,0.5]]) {
      ok(`swing(${a},${b},bo${n}) = ${want}`, close(swing(a, b, n), want));
    }
    // The orderings the metric exists to produce.
    const w = (a, b, rho) => gameWeight(cLI(a, b, 7, rho), 0.5, A);
    ok("R2 G1 outranks R1 G5 at 2-2", cLI(0,0,7,2) > cLI(2,2,7,3),
      `${cLI(0,0,7,2).toFixed(4)} > ${cLI(2,2,7,3).toFixed(4)}`);
    ok("R1 G7 outranks R2 G1", cLI(3,3,7,3) > cLI(0,0,7,2),
      `${cLI(3,3,7,3).toFixed(4)} > ${cLI(0,0,7,2).toFixed(4)}`);
    ok("w(R1 G1) = 1 by construction", close(w(0,0,3), 1));
    ok("w(R2 G1) = sqrt 2", close(w(0,0,2), Math.SQRT2, 1e-12));
    ok("w(Finals G1) = 2 sqrt 2", close(w(0,0,0), 2 * Math.SQRT2, 1e-12));
    ok("w(Finals G7) = 5.059644", close(w(3,3,0), 5.059644256269407, 1e-12));
    ok("rsGamesFor lockout 2011-12 = 66", rsGamesFor("2011-12") === 66);
    ok("cLI_RS (82 games, depth 4) = 0.0625/82", close(rsCLI("2015-16", 4), 0.0625 / 82));
    ok("w_RS = 0.1396861", close(gameWeight(rsCLI("2015-16", 4), 0.5, A), 0.13968605915391563, 1e-12));
    ok("alpha = 0 flattens every weight", gameWeight(cLI(3,3,7,0), 0, A) === 1);
  }

  console.log("\nTIER 2 — bracket reconstruction across every season");
  {
    let depthBad = [], inexact = [], labelBad = [], boBad = [], orphans = 0, rows = 0;
    const boSeen = new Set();
    for (const season of seasons) {
      const hist = read(`history-${season}.json`);
      const shape = bracketShape(hist.series);
      if (shape.depth !== 4) depthBad.push(`${season}:${shape.depth}`);
      if (!shape.exact) inexact.push(season);
      const y = Number(season.slice(0, 4));
      const wantR1 = y <= 1982 ? 3 : y <= 2001 ? 5 : 7;
      hist.series.forEach((ser, i) => {
        boSeen.add(shape.bestOf[i]);
        if (`r${shape.round[i]}` !== ser.round) labelBad.push(`${season} ${ser.teams.join("-")}`);
        const want = shape.round[i] === 1 ? wantR1 : 7;
        if (shape.bestOf[i] !== want) boBad.push(`${season} r${shape.round[i]} bo${shape.bestOf[i]}`);
      });
      const lev = gameLeverage(hist.series);
      for (const p of read(`leaderboard-${season}.json`).players) {
        for (const g of p.games || []) {
          rows++;
          if (!lev.map.has(`${g.gameId}|${p.team}`)) orphans++;
        }
      }
    }
    ok("every bracket is 4 rounds deep", depthBad.length === 0, depthBad.join(" "));
    ok("every bracket resolves exactly (one terminal series)", inexact.length === 0, inexact.join(" "));
    ok("baked round labels match the derivation", labelBad.length === 0,
      labelBad.slice(0, 5).join(", "));
    ok("series lengths follow the era rule (bo3 -> bo5 -> bo7)", boBad.length === 0,
      boBad.slice(0, 5).join(", "));
    ok("only best-of 3/5/7 appear", [...boSeen].sort().join(",") === "3,5,7", [...boSeen].join(","));
    ok(`every player-game resolves a leverage entry (${rows} rows)`, orphans === 0, `${orphans} orphans`);
  }

  console.log("\nTIER 2b — in-progress brackets (the live-route fallback)");
  {
    const h = read("history-2015-16.json");
    // Round 1 complete, nothing later started.
    const a = bracketShape(h.series.slice(0, 8));
    ok("opening round alone reads as round 1",
      !a.exact && a.depth === 4 && a.round.every((r) => r === 1), a.round.join(","));
    // Round 1 complete, round 2 two games in.
    const b = bracketShape([...h.series.slice(0, 8),
      ...h.series.slice(8, 12).map((x) => ({ ...x, games: x.games.slice(0, 2) }))]);
    ok("round 2 in progress reads as 1,1,...,2,2,2,2",
      !b.exact && b.round.slice(0, 8).every((r) => r === 1)
        && b.round.slice(8).every((r) => r === 2), b.round.join(","));
    ok("in-progress series are treated as best-of-7",
      b.bestOf.every((n) => n === 7));
    // One game into the postseason, nothing decided at all.
    const c = bracketShape(h.series.slice(0, 8).map((x) => ({ ...x, games: x.games.slice(0, 1) })));
    ok("one game in, everything is still round 1",
      !c.exact && c.round.every((r) => r === 1), c.round.join(","));
  }

  console.log("\nTIER 4 — dial identities");
  {
    const lbj = players.find((p) => p.slug === "jamesle01");
    const board = rankLegacy([lbj], { alpha: 0, decay: 1, includeRS: true });
    const direct = lbj.seasons.reduce((s, r) =>
      s + r.games.reduce((t, g) => t + g.va, 0) + (r.rsVA ?? 0), 0);
    ok("alpha=0 => LVA is the unweighted sum", close(board[0].total, direct, 1e-6),
      `${board[0].total.toFixed(6)} vs ${direct.toFixed(6)}`);
  }
  {
    const xs = [12, 400, 3, 900, 75, 220];
    const a = legacyFold(xs, 1).total;
    const b = legacyFold([...xs].reverse(), 1).total;
    ok("decay=1 => fold is order-independent", close(a, b) && close(a, xs.reduce((s, v) => s + v, 0)));
    ok("decay->0 => fold is the max season", close(legacyFold(xs, 1e-12).total, Math.max(...xs), 1e-6));
    let mono = true;
    for (let d = 0.1; d < 1; d += 0.05) {
      if (legacyFold(xs, d + 0.05).total <= legacyFold(xs, d).total) mono = false;
    }
    ok("fold strictly increasing in decay", mono);
  }
  {
    const d = decayForPeakShare(7, 20, 0.5);
    ok("decayForPeakShare(7,20,.5) = 0.938068", close(d, 0.938068, 5e-7), d.toFixed(6));
    ok("peakShareAt is its inverse", close(peakShareAt(d, 7, 20), 0.5, 1e-9));
  }

  console.log("\nTIER 3 — LeBron 2015-16, hand-checkable");
  {
    const lbj = players.find((p) => p.slug === "jamesle01");
    const s = lbj.seasons.find((r) => r.season === "2015-16");
    const fin = s.games.filter((g) => g.round === 4)
      .sort((x, y) => x.gameId.localeCompare(y.gameId));
    const w = (g) => gameWeight(g.cli, 0.5, s.anchor);
    console.log("    game  state  cLI      weight   VA      leveraged");
    fin.forEach((g, i) => {
      console.log(`    G${i + 1}    ${g.a}-${g.b}    ${g.cli.toFixed(4)}   `
        + `${w(g).toFixed(4)}   ${g.va.toFixed(2)}   ${(w(g) * g.va).toFixed(1)}`);
    });
    const g2 = fin[1], g3 = fin[2];
    ok("Finals G3 (down 0-2) weighs less than G2 (down 0-1)", w(g3) < w(g2),
      `${w(g3).toFixed(4)} < ${w(g2).toFixed(4)}`);
    ok("Finals G7 weight = 5.0596", close(w(fin[6]), 5.059644256269407, 1e-9));
    const flatPO = s.games.reduce((t, g) => t + g.va, 0);
    ok("playoff VA sums to 448.83", close(flatPO, 448.83, 0.01), flatPO.toFixed(2));
  }

  console.log("\nTIER 5 — leverage generalizes to other bracket shapes");
  {
    // The backfill targets eras with shallower brackets and shorter series.
    // Nothing on disk exercises those, so assert the math directly.
    const mk = (rounds) => { // rounds: array of [teamA, teamB, winsA, winsB]
      let day = 0;
      return rounds.map(([a, b, wa, wb]) => ({
        teams: [a, b],
        games: [...Array(wa + wb)].map((_, i) => {
          day++;
          const aWins = i < wa;
          return { gameCode: String(20000101 + day),
            home: { tri: a, score: aWins ? 100 : 90 },
            away: { tri: b, score: aWins ? 90 : 100 } };
        }),
      }));
    };
    // A two-round, best-of-7 bracket (the 1950s shape).
    const two = bracketShape(mk([["A","B",4,1],["C","D",4,2],["A","C",4,3]]));
    ok("2-round bracket reads depth 2", two.depth === 2 && two.exact, `depth ${two.depth}`);
    ok("2-round rounds are 1,1,2", two.round.join(",") === "1,1,2", two.round.join(","));
    ok("its Finals G7 is still the maximum leverage",
      close(cLI(3, 3, 7, two.roundsAfter[2]), 1));
    ok("its opening game anchors to 1",
      close(gameWeight(cLI(0, 0, 7, two.roundsAfter[0]), 0.5, two.anchor), 1));
    // A bye: A skips round 1 and enters in round 2.
    const bye = bracketShape(mk([["B","C",3,1],["A","B",4,0],["A","D",4,2],["A","E",4,3]]));
    ok("a bye team's first series is not round 1",
      bye.round[1] === 2 && bye.round[0] === 1, bye.round.join(","));
    ok("best-of-5 opening round is detected", bye.bestOf[0] === 5, `bo${bye.bestOf[0]}`);
    // Depth changes what an opener is worth, which is why the anchor is
    // per season: without it a 2-round era would price ~4x a 4-round one.
    ok("a 2-round opener is worth 4x a 4-round one, before anchoring",
      close(cLI(0, 0, 7, 1) / cLI(0, 0, 7, 3), 4));
    ok("and exactly the same after it",
      close(gameWeight(cLI(0, 0, 7, 1), 0.5, anchorCLI(2, 7)),
            gameWeight(cLI(0, 0, 7, 3), 0.5, anchorCLI(4, 7))));
  }

  console.log("\nTIER 7 — baseline coverage (spec §9.5)");
  {
    const bad = seasons.filter((s) => !baselineCoverage(lgaForSeason(s)).complete);
    ok("every scored season prices all ten categories", bad.length === 0, bad.join(", "));
    // The guard must actually fire on the seasons the backfill will meet.
    const c = baselineCoverage(lgaForSeason("1971-72"));
    ok("1971-72 is correctly refused (no rebound split)",
      !c.complete && c.missing.includes("D Rebounds"), c.missing.join(", "));
    const c74 = baselineCoverage(lgaForSeason("1973-74"));
    ok("1973-74 is accepted (rebound split begins)", c74.complete, c74.missing.join(", "));
    const c78 = baselineCoverage(lgaForSeason("1978-79"));
    ok("1978-79 is accepted despite no 3-point line", c78.complete, c78.missing.join(", "));
  }

  console.log(fail ? `\n${fail} FAILURE(S)` : "\nALL PASS");
  return fail;
}


// --- CLI --------------------------------------------------------------------

function main(argv) {
  const arg = (name, dflt) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
  };
  const has = (name) => argv.includes(`--${name}`);

  const alpha = Number(arg("alpha", ALPHA_DEFAULT));
  const decay = Number(arg("decay", DECAY_DEFAULT));
  const includeRS = !has("no-rs");
  const top = Number(arg("top", 25));
  const minGames = Number(arg("min-games", 400));
  const peakSeasons = Number(arg("peak-seasons", PEAK_SEASONS_DEFAULT));

  const built = build();
  const opts = { alpha, decay, includeRS, peakSeasons, minSeasons: 3, minGames };

  if (has("verify")) process.exit(verify(built) ? 1 : 0);

  const wanted = argv.reduce((acc, a, i) =>
    (a === "--player" ? [...acc, argv[i + 1]] : acc), []);

  if (has("sweep")) {
    const dial = arg("sweep", "decay");
    const sw = dialSweep(built.players.filter((p) =>
      p.seasons.length >= 3), { ...opts, dial, topN: Number(arg("top", 12)) });
    console.log(`\n=== rank vs ${dial} (other dial held at `
      + `${dial === "decay" ? `alpha ${alpha}` : `decay ${decay}`}) ===\n`);
    const head = sw.xs.filter((_, i) => i % 5 === 0);
    console.log("  player".padEnd(26) + head.map((x) => x.toFixed(2).padStart(6)).join(""));
    for (const s of sw.series) {
      console.log("  " + s.name.padEnd(24)
        + s.ranks.filter((_, i) => i % 5 === 0).map((r) => String(r).padStart(6)).join(""));
    }
    if (sw.crossings.length) {
      console.log(`\n  crossings (${sw.crossings.length}):`);
      const nameOf = new Map(sw.series.map((s) => [s.slug, s.name]));
      for (const c of sw.crossings) {
        console.log(`    ${dial} = ${c.x.toFixed(4)}  ${nameOf.get(c.above)}`
          + ` overtakes ${nameOf.get(c.below)}`);
      }
    } else console.log("\n  no crossings among the tracked players over this range.");
    return;
  }

  const board = rankLegacy(built.players, opts);

  if (wanted.length) {
    for (const w of wanted) {
      const p = board.find((x) => x.slug === w) || board.find((x) => norm(x.name) === norm(w));
      if (!p) { console.log(`\n  no player matching "${w}"`); continue; }
      printPlayer(p);
      console.log(`    board rank: ${board.indexOf(p) + 1}`);
    }
    return;
  }

  printBoard(board, { top, alpha, decay, includeRS, firstSeason: built.seasons[0] });
  console.log(`\n  ${board.length} players qualified `
    + `(>= 3 seasons, >= ${minGames} games); peak axis = best ${peakSeasons} seasons.`);
  console.log(`  decay ${decay} => best ${peakSeasons} seasons carry `
    + `${(peakShareAt(decay, peakSeasons, 20) * 100).toFixed(1)}% of a 20-season career.`);
}

main(process.argv.slice(2));
