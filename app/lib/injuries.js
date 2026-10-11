// Known injuries on the Look Ahead: a player reported out to start the season
// is projected for only the games left after the estimated return.
//
// Pure — no fs, no fetch — so /api/projections and the tests run the same code.
// Two sources, merged by name (mergeInjuries):
//
//   data/injuries.json   a curated list from injury reporting, each entry dated
//   the ESPN feed        read live at request time (parseEspnInjuries)
//
// The newer report on a player wins. Day-to-day listings are ignored: they
// cost a game or two, which the projected availability already prices in.
//
// The projection's games are its availability (games / schedule) applied to
// the schedule left after the return, so a player projected for 70 of 82 who
// is out the first 41 comes back to 35: the per-game line stays, and the
// minutes given up go to teammates in the team context that runs next.

import { normalizeName } from "./format.js";
import { scaleRow } from "./projection-model.js";

const DAY = 86400000;
const toTime = (s) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

// Regular-season games played before `date`, at an even pace from start to end.
export function gamesMissed(date, { seasonStart, seasonEnd, schedule = 82 }) {
  const t = toTime(date), a = toTime(seasonStart), b = toTime(seasonEnd);
  if (t == null || a == null || b == null || b <= a) return 0;
  const f = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return Math.round(schedule * f);
}

// A player's row with `missed` games taken off the front of the schedule.
export function applyInjury(row, missed, schedule = 82) {
  if (!(missed > 0) || !(row?.g > 0)) return row;
  const g = Math.round(row.g * Math.max(0, schedule - missed) / schedule);
  const out = scaleRow(row, g);
  for (const k of Object.keys(out)) if (k !== "g") out[k] = Math.round(out[k] * 10) / 10;
  return out;
}

const OUT_FOR_SEASON = /\b(out for the (rest of the )?season|miss the (entire |rest of the )?(\d{4}-\d{2} )?season|season-ending)\b/i;

// ESPN's site API injuries feed → [{ name, status, injury, return, out, asOf, note, source }].
// Read defensively: a field ESPN drops just leaves that entry less specific.
export function parseEspnInjuries(json, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const out = [];
  for (const team of json?.injuries || []) {
    for (const it of team?.injuries || []) {
      const name = it?.athlete?.displayName || it?.athlete?.fullName;
      const status = String(it?.status || it?.type?.description || "");
      if (!name || !/^out$/i.test(status.trim())) continue; // Day-To-Day, Questionable, … aren't absences to plan around
      const d = it.details || {};
      const comment = `${it.longComment || ""} ${it.shortComment || ""}`;
      const ofs = /^OFS$/i.test(d.fantasyStatus?.abbreviation || d.fantasyStatus?.description || "") || OUT_FOR_SEASON.test(comment);
      const parts = [d.type, d.detail && d.detail !== d.type ? d.detail : null, d.side && d.side !== "Not Specified" ? d.side.toLowerCase() : null].filter(Boolean);
      out.push({
        name, status: "Out",
        injury: parts.length ? `${parts[0]}${parts.length > 1 ? ` (${parts.slice(1).join(", ")})` : ""}` : "Undisclosed",
        out: ofs ? "season" : undefined,
        return: !ofs && toTime(d.returnDate) != null ? String(d.returnDate).slice(0, 10) : undefined,
        asOf: toTime(it.date) != null ? String(it.date).slice(0, 10) : today,
        note: (it.shortComment || "").trim() || undefined,
        source: "espn",
      });
    }
  }
  return out;
}

// One entry per player: the most recent report, the curated list winning a tie
// (it was written from the fuller reporting). A live "Out" with no date and no
// curated entry is taken as two weeks from now.
export function mergeInjuries(curated, live, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const by = new Map();
  for (const e of curated?.players || []) by.set(normalizeName(e.name), { ...e, source: e.source || "reported" });
  for (const e of live || []) {
    const k = normalizeName(e.name), cur = by.get(k);
    if (cur && (toTime(cur.asOf) ?? 0) >= (toTime(e.asOf) ?? 0)) continue;
    // A live listing that adds no timetable doesn't undo a dated one.
    if (cur && !e.out && !e.return) continue;
    by.set(k, e.out || e.return ? e : { ...e, return: new Date(toTime(today) + 14 * DAY).toISOString().slice(0, 10) });
  }
  return by;
}

// Places the merged injuries on the projected players: each matched row is cut
// to the games left (VA re-priced by `vaOf`), and the player carries `injury`
// for the page to show. A player out for the season comes back with no games;
// the route takes them off the board rather than leave a zero-game row.
export function withInjuries(players, injuries, season, vaOf = null) {
  const schedule = season.schedule || 82;
  return players.map((p) => {
    const e = injuries.get(normalizeName(p.name));
    if (!e) return p;
    const missed = e.out === "season" ? schedule : gamesMissed(e.return, season);
    if (!(missed > 0)) return p;
    const row = applyInjury(p.row, missed, schedule);
    return {
      ...p, row,
      va: vaOf && row.g > 0 ? Math.round(vaOf(row) * 10) / 10 : row.g > 0 ? p.va : 0,
      mpg: row.g > 0 ? Math.round((row.mp / row.g) * 10) / 10 : p.mpg,
      injury: {
        injury: e.injury, note: e.note || null, out: e.out || null, return: e.out ? null : e.return,
        missed, healthyG: p.row.g, healthyVa: p.va, asOf: e.asOf || null, source: e.source,
      },
    };
  });
}
