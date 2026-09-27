// The shareable-link format: which view a URL opens, as query parameters.
//
//   /?season=2015-16&scope=playoffs&p=jamesle01&vs=curryst01:2015-16
//   /?view=player&p=jokicni01&ps=2024-25&b=usg
//   /?tab=legacy
//
//   tab    a non-Explore tab ("legacy", "usage", a draft season "2025-26", …)
//   view   "player" for Explore's By Player (By Season is the default)
//   scope  "regular" | "playoffs" (Combined is the default)
//   season By Season's season
//   p      the opened player, by basketball-reference slug
//   ps     By Player: the season row opened under that player
//   vs     the compared player-season, "<slug>:<season>"
//   b      "usg" for the USG-ADJUSTED baseline (LG AVG is the default)
//
// Query parameters rather than the #hash so the server can read them: a link
// preview (app/page.js generateMetadata, /api/og) is built from the same URL
// the reader lands on. Pure — no React, no window — so the server page and
// the client both parse with it.

export const SCOPES = ["combined", "regular", "playoffs"];
export const DEFAULT_SCOPE = "combined";

const SEASON_RE = /^\d{4}-\d{2}$/;
const SLUG_RE = /^[a-z][a-z0-9.'-]{2,15}$/;
const TAB_RE = /^[a-z0-9-]{2,20}$/;

const one = (v) => (Array.isArray(v) ? v[0] : v);
const pick = (v, re) => {
  const s = one(v);
  return typeof s === "string" && re.test(s) ? s : null;
};

// Anything malformed is dropped rather than trusted: the values end up in
// file names on the server and in page text on both sides.
export function parseShareParams(sp) {
  const get = (k) => (sp && typeof sp.get === "function" ? sp.get(k) : sp?.[k]);
  const scope = one(get("scope"));
  const vsRaw = one(get("vs"));
  let vs = null;
  if (typeof vsRaw === "string" && vsRaw.includes(":")) {
    const [slug, season] = vsRaw.split(":");
    if (SLUG_RE.test(slug) && SEASON_RE.test(season)) vs = { slug, season };
  }
  return {
    tab: pick(get("tab"), TAB_RE),
    view: one(get("view")) === "player" ? "player" : "season",
    scope: SCOPES.includes(scope) ? scope : DEFAULT_SCOPE,
    season: pick(get("season"), SEASON_RE),
    p: pick(get("p"), SLUG_RE),
    ps: pick(get("ps"), SEASON_RE),
    vs,
    usg: one(get("b")) === "usg",
  };
}

// The query string for a state, defaults omitted so an untouched page stays a
// bare "/". Explore's keys only ride along on Explore.
//
// Built by hand rather than with URLSearchParams, which would print the ":"
// in vs as %3A. Safe because each value is held to the same patterns
// parseShareParams uses (none admit a character that needs escaping) —
// on the client the values come from component state, not from a parse.
export function shareQuery(input) {
  const ok = (v, re) => (typeof v === "string" && re.test(v) ? v : null);
  const vsOk = ok(input.vs?.slug, SLUG_RE) && ok(input.vs?.season, SEASON_RE);
  const st = {
    tab: ok(input.tab, TAB_RE), view: input.view,
    scope: SCOPES.includes(input.scope) ? input.scope : DEFAULT_SCOPE,
    season: ok(input.season, SEASON_RE), p: ok(input.p, SLUG_RE), ps: ok(input.ps, SEASON_RE),
    vs: vsOk ? input.vs : null, usg: !!input.usg,
  };
  const parts = [];
  const q = { set: (k, v) => parts.push(`${k}=${v}`) };
  const explore = !st.tab || st.tab === "explore";
  if (!explore) q.set("tab", st.tab);
  if (explore) {
    const player = st.view === "player";
    if (player) q.set("view", "player");
    if (st.scope && st.scope !== DEFAULT_SCOPE) q.set("scope", st.scope);
    if (!player && st.season) q.set("season", st.season);
    if (st.p) q.set("p", st.p);
    if (player && st.p && st.ps) q.set("ps", st.ps);
    if (st.p && st.vs?.slug && st.vs?.season) q.set("vs", `${st.vs.slug}:${st.vs.season}`);
  }
  if (st.usg) q.set("b", "usg");
  return parts.length ? `?${parts.join("&")}` : "";
}

export const SCOPE_LABEL = { combined: "Reg Season + Playoffs", regular: "Regular Season", playoffs: "Playoffs" };
