import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { valueAddParts, lgaForSeason } from "../../scoring";

export const runtime = "nodejs";

// Cross-season player index. ?scope= selects which games count:
//   playoffs  (default) built from every baked leaderboard-<season>.json
//   regular   built from every baked regular-season-<season>.json
//   combined  per-season merge of both (raw stats summed, VA recomputed)
// Players are joined across seasons by their basketball-reference slug. Older
// bakes sometimes lack a slug; those seasons are merged into the slugged player
// of the same (normalized) name so a player isn't split into two entries. Each
// season carries its raw totals so the UI can render the per-category VA
// breakdown.

const LB_RE = /^leaderboard-(\d{4}-\d{2})\.json$/;
const RS_RE = /^regular-season-(\d{4}-\d{2})\.json$/;
const r2 = (n) => Math.round((n || 0) * 100) / 100;
const r1 = (n) => Math.round((n || 0) * 10) / 10;
// Normalize a name for slug-less joins: strip diacritics + punctuation, lower.
const norm = (s) => (s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const RAW_KEYS = ["mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb",
  "fgm", "fga", "tpm", "tpa", "ftm", "fta"];

// Every player-season row from files matching `re`. Regular-season bakes call
// games `g` instead of `gp`; normalize here so downstream code sees one shape.
async function loadRows(dir, files, re) {
  const rows = [];
  const matched = files.filter((f) => re.test(f));
  for (const f of matched) {
    let data;
    try {
      data = JSON.parse(await readFile(join(dir, f), "utf8"));
    } catch {
      continue; // skip an unreadable/partial file rather than fail the index
    }
    const season = data.season || f.match(re)[1];
    for (const p of data.players || []) {
      if (!p.name) continue;
      rows.push({ season, p: p.gp == null && p.g != null ? { ...p, gp: p.g } : p });
    }
  }
  return { rows, fileCount: matched.length };
}

// Per-season merge: playoff rows absorb their regular-season counterpart
// (matched by slug, then normalized name); regular-season players with no
// playoff row are kept as-is. Seasons that only have one file contribute
// whatever they have.
function combineRows(lbRows, rsRows) {
  const rsBySeason = new Map();
  for (const { season, p } of rsRows) {
    let m = rsBySeason.get(season);
    if (!m) rsBySeason.set(season, (m = new Map()));
    if (p.slug) m.set("s:" + p.slug, p);
    const n = "n:" + norm(p.name);
    if (!m.has(n)) m.set(n, p);
  }
  const used = new Set();
  const out = [];
  for (const { season, p } of lbRows) {
    const m = rsBySeason.get(season);
    const r = m ? ((p.slug && m.get("s:" + p.slug)) || m.get("n:" + norm(p.name)) || null) : null;
    if (r) used.add(r);
    const sum = { name: p.name, slug: p.slug || (r && r.slug) || undefined, team: p.team, gp: (p.gp || 0) + (r ? r.gp || 0 : 0) };
    for (const k of RAW_KEYS) sum[k] = (p[k] || 0) + (r ? r[k] || 0 : 0);
    out.push({ season, p: sum });
  }
  for (const { season, p } of rsRows) {
    if (!used.has(p)) out.push({ season, p });
  }
  return out;
}

export async function GET(req) {
  const scopeParam = new URL(req.url).searchParams.get("scope") || "playoffs";
  const scope = ["playoffs", "regular", "combined"].includes(scopeParam) ? scopeParam : "playoffs";

  const dir = join(process.cwd(), "app", "data");
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    files = [];
  }

  // Pass 1: gather every player-season row for the requested scope.
  let rows, fileCount;
  if (scope === "regular") {
    ({ rows, fileCount } = await loadRows(dir, files, RS_RE));
  } else if (scope === "combined") {
    const lb = await loadRows(dir, files, LB_RE);
    const rs = await loadRows(dir, files, RS_RE);
    rows = combineRows(lb.rows, rs.rows);
    fileCount = Math.max(lb.fileCount, rs.fileCount);
  } else {
    ({ rows, fileCount } = await loadRows(dir, files, LB_RE));
  }

  // Playoff bakes carry VA; regular/combined rows need it computed against the
  // season's league baselines.
  const vaOf = (season, p) => (scope === "playoffs" ? p.va : valueAddParts(p, lgaForSeason(season)).va);

  // normalized-name -> slug, from rows that DO have a slug. Lets slug-less rows
  // attach to the right player instead of forming a duplicate keyed by name.
  const nameToSlug = new Map();
  for (const { p } of rows) {
    if (p.slug) {
      const n = norm(p.name);
      if (!nameToSlug.has(n)) nameToSlug.set(n, p.slug);
    }
  }

  const idx = new Map();
  for (const { season, p } of rows) {
    const slug = p.slug || nameToSlug.get(norm(p.name)) || null;
    const key = slug || ("name:" + norm(p.name));
    let e = idx.get(key);
    if (!e) {
      e = { slug, name: p.name, seasons: [] };
      idx.set(key, e);
    }
    // Keep the most recent display name (and a real slug if one shows up).
    if (season > (e._latest || "")) { e.name = p.name; e._latest = season; if (p.slug) e.slug = p.slug; }
    const raw = {};
    for (const k of RAW_KEYS) raw[k] = k === "mp" ? r1(p[k]) : (p[k] || 0);
    const va = vaOf(season, p);
    e.seasons.push({
      season,
      team: p.team,
      gp: p.gp || 0,
      va: r2(va),
      vaPerG: p.gp ? r2(va / p.gp) : 0,
      ...raw,
    });
  }

  const players = [...idx.values()];
  for (const e of players) {
    delete e._latest;
    e.seasons.sort((a, b) => b.va - a.va);
    e.bestVa = e.seasons.length ? e.seasons[0].va : 0;
    e.careerVa = r2(e.seasons.reduce((s, x) => s + x.va, 0));
    e.teams = [...new Set(e.seasons.map((x) => x.team))];
  }
  players.sort((a, b) => b.careerVa - a.careerVa);

  return new Response(JSON.stringify({ scope, players, seasonsIndexed: fileCount }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
