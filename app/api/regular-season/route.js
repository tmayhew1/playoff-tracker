import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as cheerio from "cheerio";

export const runtime = "nodejs";
export const maxDuration = 30;
export const revalidate = 86400;

// Bake-first lookup. The bake script writes regular-season-<season>.json
// alongside the playoff data; for in-progress seasons we fall back to
// scraping basketball-reference's totals page directly.
async function loadBaked(season) {
  try {
    const path = join(process.cwd(), "app", "data", `regular-season-${season}.json`);
    const buf = await readFile(path, "utf8");
    return JSON.parse(buf);
  } catch {
    return null;
  }
}

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html",
};

const SEASON_RE = /^\d{4}-\d{2}$/;

// BR uses non-current tricodes for some franchises; map to what the rest of
// the app already knows (mirrors the bake script's BR_TO_NBA).
const BR_TO_NBA = { BRK: "BKN", CHO: "CHA", CHH: "CHA", NOH: "NOP", NOK: "NOP", PHO: "PHX" };
const toNba = (tri) => BR_TO_NBA[tri] || tri;

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

async function fetchTotalsFromBR(endYear) {
  const url = `https://www.basketball-reference.com/leagues/NBA_${endYear}_totals.html`;
  const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  // BR sometimes wraps tables in HTML comments; inline them so cheerio
  // selectors see every row.
  const $ = cheerio.load(html.replace(/<!--([\s\S]*?)-->/g, "$1"));
  const table =
    $("table#totals_stats").length ? $("table#totals_stats") :
    $("table#players_totals").length ? $("table#players_totals") :
    $("table#totals").first();
  if (!table || !table.length) throw new Error("totals table not found");

  const bySlug = new Map();
  table.find("tbody tr").each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass("thead")) return;
    const playerCell = $tr.find("[data-stat='player'], [data-stat='name_display']").first();
    const name = playerCell.text().trim();
    if (!name) return;
    const slug = (playerCell.find("a").attr("href") || "")
      .match(/\/players\/[a-z]\/([^.]+)\.html/)?.[1] || null;
    if (!slug) return;
    const cell = (key) => $tr.find(`[data-stat='${key}']`).first().text().trim();
    const team = cell("team_id") || cell("team_name_abbr") || "";
    const g = num(cell("g"));
    const mp = num(cell("mp"));
    if (g <= 0 || mp <= 0) return;
    const row = {
      slug, name, team: toNba(team),
      g, mp,
      pts: num(cell("pts")),
      ast: num(cell("ast")),
      stl: num(cell("stl")),
      blk: num(cell("blk")),
      tov: num(cell("tov")),
      drb: num(cell("drb")),
      orb: num(cell("orb")),
      fgm: num(cell("fg")),
      fga: num(cell("fga")),
      tpm: num(cell("fg3")),
      tpa: num(cell("fg3a")),
      ftm: num(cell("ft")),
      fta: num(cell("fta")),
    };
    const existing = bySlug.get(slug);
    const isAggregate = /^(TOT|\dTM)$/.test(team);
    if (!existing || isAggregate) bySlug.set(slug, row);
  });
  return [...bySlug.values()];
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const season = searchParams.get("season");
  if (!season || !SEASON_RE.test(season)) {
    return new Response(JSON.stringify({ error: "valid season required (e.g. 2024-25)" }), { status: 400 });
  }

  const baked = await loadBaked(season);
  if (baked) {
    return new Response(JSON.stringify(baked), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000",
      },
    });
  }

  const endYear = Number(season.slice(0, 4)) + 1;
  try {
    const players = await fetchTotalsFromBR(endYear);
    return new Response(JSON.stringify({
      season, players, source: "basketball-reference", fetchedAt: new Date().toISOString(),
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `regular-season: ${e.message}` }), { status: 500 });
  }
}
