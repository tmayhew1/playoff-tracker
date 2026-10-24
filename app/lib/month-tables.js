// The regular season's Month Averages tables and VA-by-month chart, computed
// once and kept for the session — and, for a baked season, computed ahead of
// time while the page is idle (warmSeason), so tapping a month's averages or a
// player's row shows what is already there instead of fetching and scoring
// then.
//
// Everything is keyed by season and month, and the scored tables also by the
// baseline they were priced against: the USG-ADJ switch gets its own tables,
// and switching back finds the first ones still here.

import { bakedIndex, loadBoxes } from "./baked-games";
import { fetchBakedJson } from "./fetch-cache";
import { monthTotals } from "./regular-season-games";

// A baseline as a cache key: a few hundred characters, and two components
// handed equal baselines as different objects still share one entry.
export const lgaKey = (lga) => JSON.stringify(lga ?? null);

// A small LRU: scored tables are a few hundred KB each, and a long session
// can open many seasons under both modes.
function lru(limit) {
  const m = new Map();
  return {
    get(k) {
      if (!m.has(k)) return undefined;
      const v = m.get(k);
      m.delete(k);
      m.set(k, v);
      return v;
    },
    set(k, v) {
      m.delete(k);
      m.set(k, v);
      while (m.size > limit) m.delete(m.keys().next().value);
    },
    delete: (k) => m.delete(k),
  };
}

// --- Box scores ---------------------------------------------------------------

const boxPromises = new Map(); // season|month -> Promise<boxes>
const boxValues = lru(48);     // season|month -> boxes, once loaded in full

const monthId = (season, month) => `${season}|${month.key}`;

// A month's box scores, loaded once for every caller. A load that comes back
// short (a live day that failed) is handed out but not kept, so the next open
// asks again — the requests underneath are cached, so only the lost ones repeat.
export function monthBoxes(season, month, onProgress = () => {}) {
  const id = monthId(season, month);
  const done = boxValues.get(id);
  if (done) return Promise.resolve(done);
  if (!boxPromises.has(id)) {
    boxPromises.set(id, Promise.all([loadBoxes(season, month.games, onProgress, () => false), bakedIndex(season)])
      .then(([boxes, index]) => {
        boxPromises.delete(id);
        // Games the bake knows have no box score anywhere don't count against
        // a month being complete.
        const none = new Set(index?.noBox || []);
        if (boxes.length >= month.games.filter((g) => !none.has(g.gameId)).length) boxValues.set(id, boxes);
        return boxes;
      }, (e) => {
        boxPromises.delete(id);
        throw e;
      }));
  }
  return boxPromises.get(id);
}

// Already-loaded box scores, or null — for a component's first render.
export const peekBoxes = (season, month) => boxValues.get(monthId(season, month)) || null;

// --- Scored tables --------------------------------------------------------------

const rowCache = lru(48); // season|month|lga -> monthTotals rows

// A month's table (lib/regular-season-games.js monthTotals), scored once per
// baseline.
export function monthRows(season, month, boxes, lga) {
  const k = `${monthId(season, month)}|${lgaKey(lga)}`;
  let rows = rowCache.get(k);
  if (!rows) {
    rows = monthTotals(boxes, lga);
    rowCache.set(k, rows);
  }
  return rows;
}

export function peekRows(season, month, lga) {
  return rowCache.get(`${monthId(season, month)}|${lgaKey(lga)}`) || null;
}

// The season's VA per game by month for every player — the open row's
// VA-by-month chart — built from the months' own tables rather than scoring
// the season a second time: { months: [{ key, label }], byName: Map(name ->
// [{ vapg, gp } | null per month]) }, each month with its short label and year.
const monthlyCache = lru(12);
const monthlyKey = (season, allMonths, lga) => `${season}|${allMonths.map((m) => m.key).join(",")}|${lgaKey(lga)}`;

function buildMonthly(season, allMonths, lga) {
  const byName = new Map();
  allMonths.forEach((m, i) => {
    const boxes = peekBoxes(season, m);
    if (!boxes) return;
    for (const r of monthRows(season, m, boxes, lga)) {
      if (!byName.has(r.name)) byName.set(r.name, allMonths.map(() => null));
      byName.get(r.name)[i] = { vapg: r.vapg, gp: r.gp };
    }
  });
  return { months: allMonths.map((m) => ({ key: m.key, label: m.label.slice(0, 3), year: m.key.slice(0, 4) })), byName };
}

export function peekMonthly(season, allMonths, lga) {
  return allMonths?.length ? monthlyCache.get(monthlyKey(season, allMonths, lga)) || null : null;
}

// Loads whatever months aren't in yet (onProgress: { done, total } months),
// then builds the chart's data. Months that can't be loaded chart as empty.
export async function seasonMonthly(season, allMonths, lga, onProgress = () => {}) {
  const k = monthlyKey(season, allMonths, lga);
  const hit = monthlyCache.get(k);
  if (hit) return hit;
  let done = 0;
  onProgress({ done, total: allMonths.length });
  await Promise.all(allMonths.map((m) => monthBoxes(season, m)
    .catch(() => null)
    .then(() => onProgress({ done: ++done, total: allMonths.length }))));
  const out = buildMonthly(season, allMonths, lga);
  monthlyCache.set(k, out);
  return out;
}

// --- Warming ahead of time ---------------------------------------------------------

const idle = () => new Promise((resolve) => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 2000 });
  else setTimeout(resolve, 50);
});

// While the page sits idle: a baked season's box scores, one month at a time,
// each month's table under `lga`, the season chart, and the two payloads a
// player's breakdown asks for (defensive ratings, season totals). Only for a
// baked season — warming an unbaked one would mean hundreds of live requests
// for months nobody opened. Returns a cancel function for the effect that
// started it.
export function warmSeason(season, allMonths, lga) {
  let cancelled = false;
  (async () => {
    const index = await bakedIndex(season);
    if (cancelled || !index || !allMonths?.length) return;
    await idle();
    if (cancelled) return;
    // Small, shared with other tabs, and asked for by the first breakdown.
    fetchBakedJson("/api/def-ratings").catch(() => {});
    fetchBakedJson(`/api/regular-season?season=${season}`).catch(() => {});
    const through = index.complete ? "9999-12-31" : index.through || "";
    for (const m of allMonths) {
      // Months past the bake would go to the live routes: leave those for a tap.
      if (m.games.some((g) => g.date > through)) continue;
      await idle();
      if (cancelled) return;
      const boxes = await monthBoxes(season, m).catch(() => null);
      if (cancelled) return;
      if (!boxes) continue;
      await idle();
      if (cancelled) return;
      monthRows(season, m, boxes, lga);
    }
    await idle();
    if (cancelled) return;
    if (allMonths.every((m) => peekBoxes(season, m))) await seasonMonthly(season, allMonths, lga);
  })().catch(() => {});
  return () => { cancelled = true; };
}
