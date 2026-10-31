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
//   run    By Player: a pooled run of the opened player's seasons, comma-
//          separated ("2025-26,2026-27") — the # column's ticked seasons
//   vs     the compared player-season, "<slug>:<season>" — or, against a
//          run, the compared run, "<slug>:<season>,<season>,…"
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

// Most seasons a run or a compared run carries in a link — a whole career fits.
const MAX_RUN = 30;
const seasonList = (v) => {
  if (typeof v !== "string" || !v) return null;
  const out = [...new Set(v.split(",").filter((x) => SEASON_RE.test(x)))].sort().slice(0, MAX_RUN);
  return out.length ? out : null;
};

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
    const [slug, list] = vsRaw.split(":");
    const seasons = seasonList(list);
    // `season` stays the single-season form every older reader expects; a
    // compared run also carries all of its seasons.
    if (SLUG_RE.test(slug) && seasons) vs = seasons.length === 1 ? { slug, season: seasons[0] } : { slug, season: seasons[seasons.length - 1], seasons };
  }
  return {
    tab: pick(get("tab"), TAB_RE),
    view: one(get("view")) === "player" ? "player" : "season",
    scope: SCOPES.includes(scope) ? scope : DEFAULT_SCOPE,
    season: pick(get("season"), SEASON_RE),
    p: pick(get("p"), SLUG_RE),
    ps: pick(get("ps"), SEASON_RE),
    run: seasonList(one(get("run"))),
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
  const okList = (v) => (Array.isArray(v) ? seasonList(v.join(",")) : null);
  const vsSeasons = okList(input.vs?.seasons) || (ok(input.vs?.season, SEASON_RE) ? [input.vs.season] : null);
  const vsOk = ok(input.vs?.slug, SLUG_RE) && vsSeasons;
  const st = {
    tab: ok(input.tab, TAB_RE), view: input.view,
    scope: SCOPES.includes(input.scope) ? input.scope : DEFAULT_SCOPE,
    season: ok(input.season, SEASON_RE), p: ok(input.p, SLUG_RE), ps: ok(input.ps, SEASON_RE),
    run: okList(input.run),
    vs: vsOk ? { slug: input.vs.slug, seasons: vsSeasons } : null, usg: !!input.usg,
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
    else if (player && st.p && st.run) q.set("run", st.run.join(","));
    if (st.p && st.vs) q.set("vs", `${st.vs.slug}:${st.vs.seasons.join(",")}`);
  }
  if (st.usg) q.set("b", "usg");
  return parts.length ? `?${parts.join("&")}` : "";
}

export const SCOPE_LABEL = { combined: "Reg Season + Playoffs", regular: "Regular Season", playoffs: "Playoffs" };
