#!/usr/bin/env node
/**
 * Scrapes basketball-reference's team-totals table for each season and
 * derives the league-wide rates the VA formula uses, merging into
 * app/data/league-averages.json. One-shot tool — run when you need to
 * extend coverage backward so the playoff bake can produce meaningful
 * VA for older seasons.
 *
 *   node scripts/fetch-league-averages.mjs <startSeason> [endSeason]
 *
 *   node scripts/fetch-league-averages.mjs 1979-80
 *   node scripts/fetch-league-averages.mjs 1970-71 1995-96
 *
 * Pulls from:
 *   https://www.basketball-reference.com/leagues/NBA_<endYear>.html
 *
 * Existing entries are preserved unless --force is passed.
 */

import { writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "app", "data");
const LGA_PATH = join(DATA_DIR, "league-averages.json");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 2500;
let lastRequest = 0;

const SEASON_RE = /^\d{4}-\d{2}$/;

const args = process.argv.slice(2);
const force = args.includes("--force");
const positional = args.filter((a) => !a.startsWith("--"));
if (positional.length < 1 || positional.length > 2) {
  console.error("Usage: node scripts/fetch-league-averages.mjs <startSeason> [endSeason] [--force]");
  process.exit(1);
}
const [startSeason, endSeason = positional[0]] = positional;
for (const s of [startSeason, endSeason]) {
  if (!SEASON_RE.test(s)) {
    console.error(`Bad season "${s}" — expected YYYY-YY`);
    process.exit(1);
  }
}
const startYear = Number(startSeason.slice(0, 4));
const endYear = Number(endSeason.slice(0, 4));
if (endYear < startYear) {
  console.error(`endSeason (${endSeason}) is before startSeason (${startSeason})`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => {
  const n = parseFloat(String(v).trim());
  return Number.isFinite(n) ? n : 0;
};

async function throttledFetch(url) {
  const wait = Math.max(0, REQUEST_DELAY_MS - (Date.now() - lastRequest));
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (res.status === 429 || res.status === 503) {
    console.warn(`  ${res.status} on ${url} — sleeping 60s`);
    await sleep(60_000);
    return throttledFetch(url);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

// Find the team-totals table on the season page. BR's table ids have
// churned (totals-team, team_totals, team-stats-base). Fall back to any
// table whose <thead> shows fg/fga and mp columns and whose tbody has
// roughly the right number of rows (between 8 and 60 — covers ABA-era
// merged tables and modern 30-team seasons).
function findTotalsTable($) {
  const ids = ["totals-team", "team_totals", "team-stats-base", "totals_team"];
  for (const id of ids) {
    const t = $(`table#${id}`);
    if (t.length) return t;
  }
  let found = null;
  $("table").each((_, el) => {
    if (found) return;
    const t = $(el);
    const head = t.find("thead");
    if (!head.length) return;
    const hasFga = head.find("[data-stat='fga']").length > 0;
    const hasMp = head.find("[data-stat='mp']").length > 0;
    const hasPts = head.find("[data-stat='pts']").length > 0;
    const rowCount = t.find("tbody tr").length;
    if (hasFga && hasMp && hasPts && rowCount >= 8 && rowCount <= 60) found = t;
  });
  return found;
}

async function fetchLeagueTotals(season) {
  const yearEnd = Number(season.slice(0, 4)) + 1;
  const url = `https://www.basketball-reference.com/leagues/NBA_${yearEnd}.html`;
  console.log(`Fetching ${url}`);
  const html = await throttledFetch(url);
  const $ = cheerio.load(html.replace(/<!--([\s\S]*?)-->/g, "$1"));
  const table = findTotalsTable($);
  if (!table || !table.length) throw new Error("team totals table not found");

  const totals = {
    mp: 0, pts: 0, ast: 0, stl: 0, blk: 0, tov: 0, drb: 0, orb: 0,
    fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
  };
  let rows = 0;
  table.find("tbody tr").each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass("thead")) return;
    const cell = (...keys) => {
      for (const k of keys) {
        const v = $tr.find(`[data-stat='${k}']`).first().text().trim();
        if (v !== "") return v;
      }
      return "";
    };
    const teamName = cell("team", "team_id", "team_name", "team_name_abbr");
    // Skip "League Average" / "League Total" summary rows; we sum the
    // per-team rows ourselves to keep this consistent.
    if (/league/i.test(teamName)) return;
    const mp = num(cell("mp"));
    if (mp <= 0) return;
    rows++;
    totals.mp  += mp;
    totals.pts += num(cell("pts"));
    totals.ast += num(cell("ast"));
    totals.stl += num(cell("stl"));
    totals.blk += num(cell("blk"));
    totals.tov += num(cell("tov"));
    totals.drb += num(cell("drb"));
    totals.orb += num(cell("orb"));
    totals.fgm += num(cell("fg"));
    totals.fga += num(cell("fga"));
    totals.tpm += num(cell("fg3"));
    totals.tpa += num(cell("fg3a"));
    totals.ftm += num(cell("ft"));
    totals.fta += num(cell("fta"));
  });
  if (rows < 8) throw new Error(`only ${rows} team rows parsed; table layout may have changed`);
  return totals;
}

function lgaFromTotals(t) {
  const safe = (a, b) => (b > 0 ? a / b : 0);
  const twoPm = t.fgm - t.tpm;
  const twoPa = t.fga - t.tpa;
  const reb = t.drb + t.orb;
  // Standard possessions estimate (Hollinger): FGA - ORB + TO + 0.475*FTA.
  const poss = t.fga - t.orb + t.tov + 0.475 * t.fta;
  return {
    la3P: safe(t.tpm, t.tpa),
    la2P: safe(twoPm, twoPa),
    laFT: safe(t.ftm, t.fta),
    laFG: safe(t.fgm, t.fga),
    laPTSperM: safe(t.pts, t.mp),
    laASTperM: safe(t.ast, t.mp),
    laSTLperM: safe(t.stl, t.mp),
    laBLKperM: safe(t.blk, t.mp),
    laTOVperM: safe(t.tov, t.mp),
    laDRBperM: safe(t.drb, t.mp),
    laORBperM: safe(t.orb, t.mp),
    laPTSperMake: safe(t.pts, t.fgm),
    laPTSperPoss: safe(t.pts, poss),
    laDRBrate: safe(t.drb, reb),
    laORBrate: safe(t.orb, reb),
  };
}

async function main() {
  let existing = {};
  try {
    existing = JSON.parse(await readFile(LGA_PATH, "utf8"));
  } catch {
    console.log("No existing league-averages.json — starting fresh");
  }

  const seasons = [];
  for (let y = startYear; y <= endYear; y++) {
    const end = String((y + 1) % 100).padStart(2, "0");
    seasons.push(`${y}-${end}`);
  }

  let added = 0, skipped = 0, failed = 0;
  for (const season of seasons) {
    if (existing[season] && !force) {
      console.log(`  Skipping ${season} (already present; pass --force to overwrite)`);
      skipped++;
      continue;
    }
    try {
      const totals = await fetchLeagueTotals(season);
      const lga = lgaFromTotals(totals);
      existing[season] = lga;
      added++;
      console.log(`  ✓ ${season} — laPTSperM=${lga.laPTSperM.toFixed(3)}, la3P=${lga.la3P.toFixed(3)}, laFG=${lga.laFG.toFixed(3)}`);
    } catch (e) {
      console.warn(`  ✗ ${season} — ${e.message}`);
      failed++;
    }
  }

  // Sort keys for a clean diff.
  const sorted = Object.fromEntries(Object.keys(existing).sort().map((k) => [k, existing[k]]));
  await writeFile(LGA_PATH, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Wrote ${LGA_PATH} (${Object.keys(sorted).length} seasons; +${added} new, ${skipped} skipped, ${failed} failed)`);
}

main().catch((e) => {
  console.error("\n========== FETCH FAILED ==========");
  console.error(e?.stack || e?.message || String(e));
  console.error("==================================\n");
  process.exit(1);
});
