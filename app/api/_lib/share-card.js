import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { valueAddParts, valueAddByCategory, lgaForSeason, combinedLga, VA_CATEGORY_KEYS } from "../../scoring";
import { combineRows } from "./player-rows";
import { SCOPE_LABEL } from "../../lib/share-params";

// The numbers behind a shared link's preview (app/page.js generateMetadata and
// /api/og). Scored exactly as the page scores them: each scope against its own
// baseline, "combined" against the row's own minute split (combineRows is the
// join /api/players uses), USG-ADJ by swapping the baseline.

const DATA = join(process.cwd(), "app", "data");
const fileCache = new Map();

async function readData(name) {
  if (!fileCache.has(name)) {
    fileCache.set(name, readFile(join(DATA, name), "utf8")
      .then((t) => JSON.parse(t))
      .catch(() => null));
  }
  return fileCache.get(name);
}

// One season's rows for a scope, each scored: { row, lga, va }.
async function seasonRows(season, scope, usgAdj) {
  const [po, rs] = await Promise.all([
    scope === "regular" ? null : readData(`leaderboard-${season}.json`),
    scope === "playoffs" ? null : readData(`regular-season-${season}.json`),
  ]);
  const tag = (d) => (d?.players || []).filter((p) => p.name)
    .map((p) => ({ season, p: p.gp == null && p.g != null ? { ...p, gp: p.g } : p }));
  let rows;
  if (scope === "playoffs") {
    if (!po) return null;
    const lga = lgaForSeason(season, usgAdj, "po");
    rows = tag(po).map(({ p }) => ({ row: p, lga }));
  } else if (scope === "regular") {
    if (!rs) return null;
    const lga = lgaForSeason(season, usgAdj);
    rows = tag(rs).map(({ p }) => ({ row: p, lga }));
  } else {
    if (!rs) return null;
    rows = combineRows(tag(po), tag(rs)).map(({ p }) => ({
      row: p,
      lga: p._po || p._rs ? combinedLga(season, p._rs?.mp || 0, p._po?.mp || 0, usgAdj) : lgaForSeason(season, usgAdj),
    }));
  }
  for (const r of rows) r.va = r.row.mp > 0 ? valueAddParts(r.row, r.lga).va : 0;
  return rows.sort((a, b) => b.va - a.va);
}

// A player-season's card: totals, per-game, rank, and per-category VA.
export async function playerSeasonCard({ slug, season, scope, usgAdj = false }) {
  if (!slug || !season) return null;
  const rows = await seasonRows(season, scope, usgAdj);
  if (!rows) return null;
  const i = rows.findIndex((r) => r.row.slug === slug);
  if (i < 0) return null;
  const { row, lga, va } = rows[i];
  const gp = row.gp || 0;
  const byCat = valueAddByCategory(row, lga);
  return {
    slug, season, scope, usgAdj,
    scopeLabel: SCOPE_LABEL[scope],
    name: row.name,
    team: row.team,
    gp,
    va,
    vaPerG: gp ? va / gp : 0,
    rank: i + 1,
    of: rows.length,
    cats: VA_CATEGORY_KEYS.map((k) => ({ key: k, va: byCat[k] || 0, perG: gp ? (byCat[k] || 0) / gp : 0 })),
  };
}

// A season board's card: the top of it by total VA.
export async function seasonCard({ season, scope, usgAdj = false, top = 5 }) {
  if (!season) return null;
  const rows = await seasonRows(season, scope, usgAdj);
  if (!rows?.length) return null;
  return {
    season, scope, usgAdj,
    scopeLabel: SCOPE_LABEL[scope],
    of: rows.length,
    leaders: rows.slice(0, top).map(({ row, va }) => ({
      name: row.name, team: row.team, gp: row.gp || 0, va, vaPerG: row.gp ? va / row.gp : 0,
    })),
  };
}

// The newest season with a baked leaderboard, for links that name no season.
export async function latestSeason() {
  const d = await readData("league-averages.json");
  const seasons = Object.keys(d || {}).filter((s) => /^\d{4}-\d{2}$/.test(s)).sort();
  return seasons[seasons.length - 1] || null;
}

const sign = (n, d = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}`;
export { sign };

// Title/description text for a parsed share state — what shows in the link
// preview's text beside the image. null when the link names nothing specific.
export async function shareSummary(st) {
  const base = st.usg ? " (USG-adjusted)" : "";
  if (st.tab && st.tab !== "explore") return null;
  const season = st.view === "player" ? st.ps : st.season;
  if (st.p) {
    // By Player with no season open is the player's career page: career VA in
    // the text, and the best season's breakdown on the card.
    if (!season) {
      const c = await careerCard(st.p, st.scope, st.usg);
      if (!c) return null;
      return {
        kind: "career", a: c.best, career: c,
        title: `${c.best.name}: ${sign(c.va)} career VA`,
        description: `${c.best.scopeLabel}${base} · ${c.seasons} seasons · best ${c.best.season} ${sign(c.best.va)} (${sign(c.best.vaPerG, 2)} VA/G)`,
      };
    }
    const a = await playerSeasonCard({ slug: st.p, season, scope: st.scope, usgAdj: st.usg });
    if (!a) return null;
    if (st.vs) {
      const b = await playerSeasonCard({ slug: st.vs.slug, season: st.vs.season, scope: st.scope, usgAdj: st.usg });
      if (b) {
        return {
          kind: "compare", a, b,
          title: `${a.name} ’${a.season.slice(5)} vs ${b.name} ’${b.season.slice(5)}`,
          description: `${a.scopeLabel}${base} · ${a.name}: ${sign(a.vaPerG, 2)} VA/G · ${b.name}: ${sign(b.vaPerG, 2)} VA/G`,
        };
      }
    }
    const topCats = [...a.cats].sort((x, y) => y.va - x.va).slice(0, 2)
      .map((c) => `${c.key} ${sign(c.va)}`).join(", ");
    return {
      kind: "player", a,
      title: `${a.name} ${a.season} ${a.scopeLabel}: ${sign(a.va)} VA`,
      description: `${sign(a.vaPerG, 2)} VA/G over ${a.gp} games · #${a.rank} of ${a.of}${base} · ${topCats}`,
    };
  }
  if (st.view !== "player" && st.season) {
    const s = await seasonCard({ season: st.season, scope: st.scope, usgAdj: st.usg });
    if (!s) return null;
    return {
      kind: "season", s,
      title: `${s.season} ${s.scopeLabel} — Value Added leaders`,
      description: s.leaders.slice(0, 3).map((l, i) => `${i + 1}. ${l.name} ${sign(l.va)}`).join(" · ") + base,
    };
  }
  return null;
}

// A player's career in a scope: total VA, season count, and the best season
// (by total VA). Walks every baked season; the files are cached per process.
export async function careerCard(slug, scope, usgAdj = false) {
  const last = await latestSeason();
  if (!last) return null;
  let best = null, va = 0, seasons = 0;
  for (let y = Number(last.slice(0, 4)); y >= 1980; y--) {
    const season = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    const c = await playerSeasonCard({ slug, season, scope, usgAdj });
    if (!c) continue;
    va += c.va; seasons += 1;
    if (!best || c.va > best.va) best = c;
  }
  return best ? { best, va, seasons } : null;
}
