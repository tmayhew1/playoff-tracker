// basketball-reference slugs for a season's players, keyed by name, so a box
// score line (NBA CDN or ESPN, neither of which knows BR's ids) can link to
// the player's page. A name two players share maps to null: better no link
// than the wrong one. Shared by scripts/bake-nights.mjs and /api/nights.

export const normName = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").trim();

// regular-season-<season>.json's players -> Map(normName -> slug | null).
export function slugsByName(players) {
  const byName = new Map();
  for (const p of players || []) {
    const k = normName(p.name);
    byName.set(k, byName.has(k) && byName.get(k) !== p.slug ? null : p.slug);
  }
  return byName;
}
