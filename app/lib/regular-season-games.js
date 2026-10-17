// Every regular-season game of a season, read off ESPN's scoreboard and
// grouped the way the playoffs group by round: by month, then by day.
// Shared by /api/regular-season/games (which parses and groups by month) and
// the Explore month sections (which split a month into its days).

// ESPN NBA abbreviations -> the tricodes the rest of the app uses.
const ESPN_TO_NBA = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
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
export function parseScoreboard(events) {
  const out = [];
  for (const ev of events || []) {
    const comp = ev.competitions?.[0];
    if (!comp || !(comp.status?.type?.completed ?? ev.status?.type?.completed)) continue;
    const note = (comp.notes?.[0]?.headline || comp.notes?.[0]?.type || "").toString();
    const type = ev.season?.type ?? comp.season?.type;
    if (type != null ? type !== 2 : !!note) continue;
    // The NBA Cup final is the one Cup game that doesn't count toward the
    // regular season; its earlier knockout rounds do.
    if (/cup/i.test(note) && /championship|\bfinal\b/i.test(note)) continue;
    const cs = comp.competitors || [];
    const h = cs.find((c) => c.homeAway === "home");
    const a = cs.find((c) => c.homeAway === "away");
    const home = toNba(h?.team?.abbreviation);
    const away = toNba(a?.team?.abbreviation);
    if (!NBA_TEAMS.has(home) || !NBA_TEAMS.has(away)) continue;
    const hScore = Number(h.score), aScore = Number(a.score);
    if (!Number.isFinite(hScore) || !Number.isFinite(aScore)) continue;
    const iso = ev.date || comp.date;
    if (!iso) continue;
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

// "2025-10-22" -> "Wed, Oct 22".
export function dayLabel(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}
