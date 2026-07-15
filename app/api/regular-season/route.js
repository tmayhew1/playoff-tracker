import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { loadZoneSide, attachZoneFields } from "../_lib/zones";

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
  let table = null;
  for (const id of ["totals_stats", "players_totals", "totals", "per_game_stats"]) {
    const t = $(`table#${id}`);
    if (t.length) { table = t; break; }
  }
  if (!table) {
    $("table").each((_, el) => {
      if (table) return;
      const t = $(el);
      const head = t.find("thead");
      if (!head.length) return;
      const hasPts = head.find("[data-stat='pts']").length > 0;
      const hasG = head.find("[data-stat='g']").length > 0;
      const hasMp = head.find("[data-stat='mp']").length > 0;
      if (hasPts && hasG && hasMp) table = t;
    });
  }
  if (!table || !table.length) throw new Error("totals table not found");

  const byKey = new Map();
  table.find("tbody tr").each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass("thead")) return;
    const playerCell = $tr.find("[data-stat='player'], [data-stat='name_display'], [data-stat='name']").first();
    const name = playerCell.text().trim();
    if (!name) return;
    const slugHref = $tr.find("a[href*='/players/']").attr("href") || "";
    const slug = slugHref.match(/\/players\/[a-z]\/([^.]+)\.html/)?.[1] || null;
    const cell = (...keys) => {
      for (const k of keys) {
        const v = $tr.find(`[data-stat='${k}']`).first().text().trim();
        if (v !== "") return v;
      }
      return "";
    };
    const team = cell("team_id", "team_name_abbr", "team");
    const g = num(cell("g", "games"));
    const mp = num(cell("mp", "mp_total"));
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
    const key = slug || name;
    const existing = byKey.get(key);
    const isAggregate = /^(TOT|\dTM)$/.test(team);
    if (!existing || isAggregate) byKey.set(key, row);
  });
  if (byKey.size === 0) throw new Error("totals table found but parsed 0 player rows");
  return [...byKey.values()];
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const season = searchParams.get("season");
  if (!season || !SEASON_RE.test(season)) {
    return new Response(JSON.stringify({ error: "valid season required (e.g. 2024-25)" }), { status: 400 });
  }

  const baked = await loadBaked(season);
  if (baked) {
    attachZoneFields(baked.players, await loadZoneSide(season, "rs"));
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
    attachZoneFields(players, await loadZoneSide(season, "rs"));
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
