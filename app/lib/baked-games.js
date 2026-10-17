// Reading the baked regular-season games (public/regular-season-games, written
// by scripts/bake-regular-season-games.mjs) in the page, with the live ESPN
// routes as the fallback for whatever the bake doesn't cover yet: days of the
// season in progress after the last bake, or a season not baked at all.

import { buildScoped, fetchJsonCached } from "./fetch-cache";
import { BAKED_DIR, bakedThrough, groupByDay, unpackMonth } from "./regular-season-games";

// Missing files are remembered as missing (null) for the session, so a season
// that isn't baked costs one 404, not one per section opened.
const _baked = new Map();
function bakedFile(season, file, transform = (d) => d) {
  const url = buildScoped(`/${BAKED_DIR}/${season}/${file}.json`);
  if (!_baked.has(url)) {
    _baked.set(url, fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d ? transform(d) : null))
      .catch(() => {
        _baked.delete(url); // a network blip, not a missing file: ask again next time
        return null;
      }));
  }
  return _baked.get(url);
}

// The season's baked index, or null when it isn't baked.
export const bakedIndex = (season) => bakedFile(season, "index");

// A baked month's box scores as Map(gameId -> box), or null.
const bakedMonth = (season, key) => bakedFile(season, key, unpackMonth);

// The season's games: the baked index, plus a live read of the months the
// bake hasn't reached. `liveMonth(yyyymm)` reads one month live and resolves
// to { games, errors }. Resolves to { games, errors }.
export async function seasonGames(season, months, liveMonth) {
  const index = await bakedIndex(season);
  const thisMonth = new Date().toISOString().slice(0, 7).replace("-", "");
  let live = months;
  if (index) {
    const through = bakedThrough(index).slice(0, 7).replace("-", "");
    live = months.filter((m) => m >= through && m <= thisMonth);
  }
  const errors = [];
  const lists = await Promise.all(live.map((m) => liveMonth(m)
    .then((d) => { errors.push(...(d.errors || [])); return d.games || []; })
    .catch((e) => { errors.push(e.message || "Load failed"); return []; })));
  return { games: [...(index?.games || []), ...lists.flat()], errors, baked: !!index };
}

// How many live day requests run at once, and the most games each answers
// (/api/regular-season/lines takes up to 20).
const CONCURRENCY = 6;
const PER_REQUEST = 20;

// Box scores for `games` (each carrying its Eastern `date`), in their order,
// each tagged with that date. Baked months come from their static file; any
// game the bake doesn't hold is asked of /api/regular-season/lines, a day's
// games per request, CONCURRENCY at once. Requests are cached by URL, so a
// month's table and the season chart share every file and day they both
// need. A game that doesn't load is left out.
export async function loadBoxes(season, games, onProgress, isCancelled) {
  const index = await bakedIndex(season);
  const noBox = new Set(index?.noBox || []);
  const through = bakedThrough(index);
  const byId = new Map();

  const bakedKeys = [...new Set(games.filter((g) => g.date <= through).map((g) => g.date.slice(0, 7)))];
  let done = 0, total = bakedKeys.length;
  const tick = () => { done += 1; if (!isCancelled()) onProgress({ done, total }); };
  onProgress({ done, total });
  await Promise.all(bakedKeys.map(async (key) => {
    const month = await bakedMonth(season, key);
    for (const [id, box] of month || []) byId.set(id, box);
    tick();
  }));

  // Whatever the bake didn't have, asked live.
  const rest = games.filter((g) => !byId.has(g.gameId) && !(g.date <= through && noBox.has(g.gameId)));
  const requests = [];
  for (const d of groupByDay(rest)) {
    for (let i = 0; i < d.games.length; i += PER_REQUEST) {
      requests.push(d.games.slice(i, i + PER_REQUEST).map((g) => g.gameId));
    }
  }
  total += requests.length;
  if (requests.length && !isCancelled()) onProgress({ done, total });
  let next = 0;
  const worker = async () => {
    while (!isCancelled() && next < requests.length) {
      const ids = requests[next++];
      try {
        const d = await fetchJsonCached(`/api/regular-season/lines?ids=${ids.join(",")}`);
        for (const g of d.games || []) byId.set(g.gameId, g);
      } catch {
        // left out below
      }
      tick();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return games.flatMap((g) => (byId.has(g.gameId) ? [{ ...byId.get(g.gameId), date: g.date }] : []));
}

// One game's baked box score, in /api/boxscore's shape, or null when the bake
// doesn't hold it (the banner then asks /api/boxscore).
export async function bakedBox(season, game) {
  if (!game?.date) return null;
  const month = await bakedMonth(season, game.date.slice(0, 7));
  const box = month?.get(game.gameId);
  return box ? { ...box, status: "Final", gameStatus: 3 } : null;
}
