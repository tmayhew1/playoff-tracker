// Every regular-season game of a season, read off ESPN's scoreboard and
// grouped the way the playoffs group by round: by month, then by day.
// Shared by /api/regular-season/games (which parses and groups by month) and
// the Explore month sections (which split a month into its days).

import { valueAddParts } from "../scoring";

// ESPN NBA abbreviations -> the tricodes the rest of the app uses.
// ESPN keeps the New Jersey Nets as "NJ" (1999-00 to 2011-12).
const ESPN_TO_NBA = { GS: "GSW", NJ: "NJN", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
const toNba = (abbr) => ESPN_TO_NBA[abbr] || abbr;

// Every franchise tricode ESPN has used since 1999-00, current and relocated.
// A side outside this set is an All-Star or exhibition team, never a
// regular-season game.
const NBA_TEAMS = new Set([
  "ATL", "BOS", "BKN", "NJN", "CHA", "CHH", "CHI", "CLE", "DAL", "DEN", "DET",
  "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "VAN", "MIA", "MIL", "MIN", "NOP",
  "NOH", "NOK", "NYK", "OKC", "SEA", "ORL", "PHI", "PHX", "POR", "SAC", "SAS",
  "TOR", "UTA", "WAS",
]);

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The calendar months a season's regular season can fall in, as YYYYMM.
// October through May covers every season, the lockout and COVID-shortened
// ones included; 2019-20 adds the bubble's seeding games (late July and
// August 2020).
export function seasonMonths(season) {
  const start = Number(season.slice(0, 4));
  const out = [];
  for (const m of [10, 11, 12]) out.push(`${start}${String(m).padStart(2, "0")}`);
  for (const m of [1, 2, 3, 4, 5]) out.push(`${start + 1}${String(m).padStart(2, "0")}`);
  if (season === "2019-20") out.push("202007", "202008");
  return out;
}

// Games are dated by the US Eastern calendar, the way the league lists them: a
// 10:30pm ET tip is already the next day in UTC.
const ET_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
export const etDate = (iso) => ET_DAY.format(new Date(iso));

// ESPN scoreboard events -> finished regular-season games. ESPN ignores
// seasontype on a date-range query, so preseason, play-in and playoff games
// come back too and are filtered here by the event's own season type, with
// the note as the fallback signal on the older events that omit it.
export function parseScoreboard(events, { onSkip = null } = {}) {
  const out = [];
  for (const ev of events || []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const cs = comp.competitors || [];
    const h = cs.find((c) => c.homeAway === "home");
    const a = cs.find((c) => c.homeAway === "away");
    const home = toNba(h?.team?.abbreviation);
    const away = toNba(a?.team?.abbreviation);
    // All-Star and exhibition sides aren't NBA games at all; not reported.
    if (!NBA_TEAMS.has(home) || !NBA_TEAMS.has(away)) continue;
    const note = (comp.notes?.[0]?.headline || comp.notes?.[0]?.type || "").toString();
    const type = ev.season?.type ?? comp.season?.type;
    const hScore = Number(h.score), aScore = Number(a.score);
    const iso = ev.date || comp.date;
    // `onSkip(game, why)` hears about every NBA-vs-NBA event left out, so a
    // bake can record what it dropped and why.
    const skip = (why) => onSkip?.({
      gameId: String(ev.id), date: iso ? etDate(iso) : null, home: `${home} ${h?.score ?? ""}`.trim(), away: `${away} ${a?.score ?? ""}`.trim(),
      type: type ?? null, note: note || null, state: comp.status?.type?.state ?? ev.status?.type?.state ?? null,
    }, why);
    if (type != null ? type !== 2 : !!note) { skip(type != null ? `season type ${type}` : "note on a typeless event"); continue; }
    if (!(comp.status?.type?.completed ?? ev.status?.type?.completed)) { skip("not final"); continue; }
    // The NBA Cup final is the one Cup game that doesn't count toward the
    // regular season; its earlier knockout rounds do.
    // (It was the In-Season Tournament in its first year, 2023-24.)
    if (/cup|in-season tournament/i.test(note) && /championship|\bfinal\b/i.test(note)) { skip("Cup final"); continue; }
    if (!Number.isFinite(hScore) || !Number.isFinite(aScore)) { skip("no score"); continue; }
    // ESPN carries phantom copies of some early-2000s games, marked final at
    // 0-0 beside the real one. No real game ends 0-0.
    if (hScore === 0 && aScore === 0) { skip("0-0"); continue; }
    if (!iso) { skip("no date"); continue; }
    out.push({
      gameId: String(ev.id),
      gameDateTimeUTC: iso,
      date: etDate(iso),
      home: { tri: home, score: hScore },
      away: { tri: away, score: aScore },
    });
  }
  return out;
}

const byTime = (x, y) => x.gameDateTimeUTC.localeCompare(y.gameDateTimeUTC) || x.gameId.localeCompare(y.gameId);

// Games -> [{ key: "YYYY-MM", label, games }], oldest month first. Repeats
// (ESPN can list an event on two pages) are dropped.
export function groupByMonth(games) {
  const seen = new Set();
  const months = new Map();
  for (const g of [...games].sort(byTime)) {
    if (seen.has(g.gameId)) continue;
    seen.add(g.gameId);
    const key = g.date.slice(0, 7);
    if (!months.has(key)) months.set(key, { key, label: MONTH_NAMES[Number(key.slice(5)) - 1], games: [] });
    months.get(key).games.push(g);
  }
  return [...months.values()].sort((x, y) => x.key.localeCompare(y.key));
}

// A month's games -> [{ date: "YYYY-MM-DD", games }], oldest day first.
export function groupByDay(games) {
  const days = new Map();
  for (const g of games) {
    if (!days.has(g.date)) days.set(g.date, { date: g.date, games: [] });
    days.get(g.date).games.push(g);
  }
  return [...days.values()].sort((x, y) => x.date.localeCompare(y.date));
}

// "2026-01-07" -> "Jan 7".
export function shortDay(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// "2025-10-22" -> "Wed, Oct 22".
export function dayLabel(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

const STAT_KEYS = ["mp", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "drb", "orb"];

// A month's box scores, in date order, -> one row per player, best Value
// Added per game first: totals, games played, and each game's own line, VA,
// opponent and date in order (the breakdown's per-game chart). A box carries
// its game's Eastern `date` when the caller knows it. Players are keyed by name, so
// one traded mid-month is a single row under his latest team.
export function monthTotals(boxes, lga) {
  const rows = new Map();
  for (const box of boxes) {
    for (const [side, other] of [[box.away, box.home], [box.home, box.away]]) {
      for (const line of side?.players || []) {
        if (!(line.mp > 0)) continue;
        const { va, efficiency } = valueAddParts(line, lga);
        let r = rows.get(line.name);
        if (!r) {
          r = { name: line.name, gp: 0, va: 0, eff: 0, games: [], byGame: [], gameContext: [] };
          for (const k of STAT_KEYS) r[k] = 0;
          rows.set(line.name, r);
        }
        r.team = side.tri;
        r.gp += 1;
        r.va += va;
        r.eff += efficiency;
        r.games.push(va);
        const snap = { team: side.tri, name: line.name, gp: 1, va, eff: efficiency };
        for (const k of STAT_KEYS) {
          r[k] += line[k] || 0;
          snap[k] = line[k] || 0;
        }
        r.byGame.push(snap);
        r.gameContext.push({ opp: other?.tri, dateLabel: box.date ? shortDay(box.date) : null });
      }
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, vapg: r.va / r.gp, mpg: r.mp / r.gp, ppg: r.pts / r.gp, rpg: r.reb / r.gp, apg: r.ast / r.gp }))
    .sort((x, y) => y.vapg - x.vapg);
}

// The season's months, each with its box scores ({ key, boxes }), -> per
// player, { vapg, gp } for each month in order, null where he didn't play.
export function monthlyVA(months, lga) {
  const out = new Map();
  months.forEach((m, i) => {
    for (const r of monthTotals(m.boxes, lga)) {
      if (!out.has(r.name)) out.set(r.name, months.map(() => null));
      out.get(r.name)[i] = { vapg: r.vapg, gp: r.gp };
    }
  });
  return out;
}

// --- Baked seasons ----------------------------------------------------------
// scripts/bake-regular-season-games.mjs writes every finished regular-season
// game to public/regular-season-games/<season>/: index.json (the game list
// /api/regular-season/games would give, for the whole season) and one
// YYYY-MM.json per month holding that month's box scores. They are static
// files, so a season opens from the CDN with no ESPN call at all.
//
// A month file packs each player line into an array — names once in a table,
// then the fields in LINE_FIELDS order — which keeps a season to a few MB.

export const BAKED_DIR = "regular-season-games";
export const LINE_FIELDS = [
  "name", "starter", "mp", "pts", "reb", "drb", "orb", "ast", "stl", "blk", "tov",
  "fgm", "fga", "tpm", "tpa", "ftm", "fta", "plusMinus",
];

// One side's player line -> its packed row; `nameIndex(name)` -> table slot.
export function packLine(p, nameIndex) {
  return LINE_FIELDS.map((k) => {
    if (k === "name") return nameIndex(p.name);
    if (k === "starter") return p.starter ? 1 : 0;
    if (k === "mp") return Math.round((p.mp || 0) * 100) / 100;
    return p[k] || 0;
  });
}

export function unpackLine(row, names) {
  const p = { oncourt: false };
  LINE_FIELDS.forEach((k, i) => {
    if (k === "name") p.name = names[row[i]];
    else if (k === "starter") p.starter = row[i] === 1;
    else p[k] = row[i];
  });
  return p;
}

// A baked month file -> Map(gameId -> { gameId, home, away }), the shape
// /api/regular-season/lines answers with.
export function unpackMonth(file) {
  const out = new Map();
  const names = file?.names || [];
  for (const [gameId, g] of Object.entries(file?.games || {})) {
    const side = (s) => ({ tri: s.tri, score: s.score ?? 0, players: (s.players || []).map((r) => unpackLine(r, names)) });
    out.set(gameId, { gameId, home: side(g.home), away: side(g.away) });
  }
  return out;
}

// The last Eastern date a baked index covers: every day up to and including
// it is in the bake, so only later days need asking live. A complete season
// covers everything.
export function bakedThrough(index) {
  return index?.complete ? "9999-12-31" : (index?.through || "0000-00-00");
}
