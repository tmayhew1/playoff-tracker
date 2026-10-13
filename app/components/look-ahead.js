"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { valueAdd } from "../scoring";
import { fetchBakedJson } from "../lib/fetch-cache";
import { splitName, teamColor, withAlpha } from "../lib/format";
import { Name, TeamChip } from "./player-chips";
import { useSeasonLga, useVAMode } from "../lib/va-mode";
import { allNbaTeams, posGroup, projectWins, simulateAwards, vaPlus } from "../lib/projection-model";
import { TEAM_CONF } from "../teams";

// The 2026-27 Look Ahead, Explore's projected season (lib/projection-model.js
// for the model, scripts/fit-projection-model.mjs for the fit, and
// /api/projections for the live rosters it is placed on).
//
// The awards are simulated here rather than baked, because they depend on
// who is on a roster: a player the live rosters don't list (retired,
// unsigned) is out of the running. Seeded, so every visit sees the same odds.

export const LOOK_AHEAD_SEASON = "2026-27";

const SIMS = 2000;
// Only the top of the board is simulated: past this the projection is so far
// from fifteenth that a draw never gets there.
const SIM_FIELD = 200;
const PAGE = 25;
// The All-Star roster: 24, as the Awards tab assumes for the tournament years.
const ALL_STAR_PLACES = 24;

const pct = (x) => (x >= 0.995 ? ">99%" : x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
const fmt1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "–");
const fmtDate = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const POS_ORDER = { G: 0, F: 1, C: 2 };
// How many characters of surnames and dots a standings row's line holds at
// phone width, before the line would cut off.
const LINEUP_LINE = 28;
// A standings row's five surnames as two lines: three over two when the first
// three fit, otherwise two over three.
function lineupRows(top) {
  const names = top.map((p) => splitName(p.name).last);
  const width = (xs) => xs.join(" · ").length;
  const k = names.length > 3 && width(names.slice(0, 3)) <= LINEUP_LINE ? 3 : 2;
  return [names.slice(0, k), names.slice(k)].filter((r) => r.length);
}

// The Look Ahead's way to its own awards board (LookAhead owns the board's
// state): goToAward(award, slug) switches the board and opens the player.
const AwardGo = createContext(null);
const AWARD_KEY = { MVP: "mvp", ROY: "roy", "All-NBA": "allnba", "All-Star": "allstar" };

function InjuredOut({ list }) {
  if (!list?.length) return null;
  return (
    <div className="px-3 py-2 text-[9px] text-stone-500 border-t border-stone-200 leading-snug">
      <span className="uppercase tracking-wider text-red-400">Out for the season: </span>
      {list.map((x) => `${x.name} (${x.injury})`).join(", ")}
    </div>
  );
}

function SectionHead({ title, note }) {
  return (
    <div className="px-3 pt-2.5 pb-1.5 border-b border-stone-200">
      <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500">{title}</div>
      {note && <div className="text-[9px] italic text-stone-400 mt-0.5">{note}</div>}
    </div>
  );
}

export function LookAhead() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [team, setTeam] = useState(null);
  const [openTeam, setOpenTeam] = useState(null); // the standings row dropped open
  const [expanded, setExpanded] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  // The awards board's tab and open row live here, so an award card anywhere
  // on the page can switch the board to that award and open the player on it.
  const [awardSub, setAwardSub] = useState("mvp");
  const [awardOpen, setAwardOpen] = useState(null);
  const goToAward = useCallback((award, slug) => {
    setAwardSub(award);
    setAwardOpen(slug);
    requestAnimationFrame(() => (document.getElementById(`la-award-${slug}`) || document.getElementById("la-awards"))
      ?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, []);
  const { usgAdj } = useVAMode();

  useEffect(() => {
    let cancelled = false;
    fetchBakedJson("/api/projections")
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message || "Load failed"); });
    return () => { cancelled = true; };
  }, []);

  // The table follows the LG AVG / USG-ADJ switch, priced against the last
  // season played. The awards don't: the MVP model was fit on plain VA.
  const lga = useSeasonLga(data?.base || "2025-26");
  const players = useMemo(() => {
    if (!data) return [];
    // A player on no current roster stays in the data (the live join can miss
    // a name) but leaves the board and the awards; listed separately below.
    const live = data.rosters === "live";
    return data.players
      .filter((p) => !live || p.team)
      .map((p) => ({ ...p, vaShown: valueAdd(p.row, lga) }))
      .sort((a, b) => b.vaShown - a.vaShown);
  }, [data, lga]);
  const offRoster = useMemo(() => (data?.rosters === "live"
    ? data.players.filter((p) => !p.team && p.va > 150).sort((a, b) => b.va - a.va) : []), [data]);

  // The season simulated on the Awards tab's own models (scripts/bake-awards.mjs,
  // served with the projection as `awardModels`): the ballot reads VA+, as
  // theirs do, and every rookie is in the field so ROY has its whole class.
  // Without them, the MVP model fit with the projection, on plain VA.
  const awards = useMemo(() => {
    if (!data) return null;
    const am = data.awardModels;
    const ballotVa = (p) => (am ? vaPlus(p.va, p.dpm, p.row.mp) : p.va);
    const byBallot = [...players].sort((a, b) => ballotVa(b) - ballotVa(a));
    const field = [...byBallot.slice(0, SIM_FIELD), ...byBallot.slice(SIM_FIELD).filter((p) => p.rookie)];
    const rookiePool = data.params?.rookie?.pool;
    const res = simulateAwards(field.map((p) => ({ key: p.slug, g: p.row.g, va: ballotVa(p), rangeVa: p.va, mpg: p.mpg, rookie: !!p.rookie, conf: TEAM_CONF[p.team] || null, pool: p.rookie ? rookiePool : null })),
      am ? { a: am.mvp.beta } : data.mvp.model, data.pool,
      { sims: SIMS, roy: am?.roy || null, allStar: am ? { beta: am.allstar.beta, places: ALL_STAR_PLACES } : null });
    return { bySlug: Object.fromEntries(res.map((r) => [r.key, r])), res };
  }, [data, players]);

  // Projected standings (lib/projection-model.js projectWins): each roster's
  // VA+ — VA after the team context plus projected defense — best to worst,
  // and the record the team is coming off. Priced on LG AVG, which the wins
  // model was fit on, whatever the switch says.
  const teams = useMemo(() => {
    if (!data) return [];
    const by = {};
    for (const p of players) if (p.team) (by[p.team] ||= []).push(p);
    const rec = data.lastRecords || {};
    const lastPct = (t) => (rec[t] ? rec[t].w / (rec[t].w + rec[t].l) : 0.5);
    const proj = data.wins ? projectWins(data.wins, Object.fromEntries(Object.entries(by).map(([t, list]) =>
      [t, { vaPlus: list.map((p) => vaPlus(p.va, p.dpm, p.row.mp)), lastPct: lastPct(t) }]))) : {};
    return Object.entries(by).map(([t, list]) => {
      // The row's five names: the five with the most projected minutes, laid
      // out like a lineup — guards, then forwards, then centers.
      const top = [...list].sort((a, b) => b.row.mp - a.row.mp).slice(0, 5)
        .sort((a, b) => POS_ORDER[posGroup(a.pos)] - POS_ORDER[posGroup(b.pos)]);
      return { team: t, conf: TEAM_CONF[t] || "?", wins: proj[t]?.wins ?? 41, last: rec[t] || null, top };
    }).sort((a, b) => b.wins - a.wins);
  }, [data, players]);

  if (error) return <div className="text-[10px] text-red-600 py-4 text-center px-2 break-words">Couldn’t load the projection — {error}</div>;
  if (!data || !awards) return <div className="text-[10px] text-stone-500 italic py-4 text-center">Projecting 2026-27…</div>;

  const pBySlug = Object.fromEntries(players.map((p) => [p.slug, p]));
  const bt = data.backtest;

  const rows = team ? players.filter((p) => p.team === team) : players;
  const visible = showAll || team ? rows : rows.slice(0, PAGE);
  const maxAbs = Math.max(1, ...rows.map((p) => Math.abs(p.vaShown)));
  const rankOf = new Map(players.map((p, i) => [p.slug, i + 1]));

  return (
    <AwardGo.Provider value={goToAward}>
    <div>
      {/* Teams */}
      <div className="mb-4 border border-stone-300 bg-white">
        <SectionHead
          title="Projected Standings"
          note={data.wins
            ? `Wins from each roster’s VA+ (VA after the team context, plus projected defense), best player to worst, and last season’s record · typical miss ±${Math.round(data.wins.rmseWins)} wins · tap a team for its projected roster${data.injuries && data.injuries !== "none" ? " · known injuries taken out" : ""}${data.rosters === "live" ? "" : ` · live rosters unavailable, so players are on their last ${data.base} team`}`
            : "Wins model not fit yet"}
        />
        {["W", "E"].map((conf) => {
          const list = teams.filter((t) => t.conf === conf);
          if (!list.length) return null;
          const maxW = Math.max(1, ...teams.map((t) => t.wins));
          return (
            <div key={conf} className="border-b border-stone-200 last:border-0">
              <div className="px-3 pt-2 pb-1 flex items-baseline justify-between text-[9px] uppercase tracking-[0.2em]">
                <span className="font-bold text-stone-700">{conf === "E" ? "East" : "West"}</span>
                <span className="text-stone-400 tracking-wider">Proj · Last</span>
              </div>
              {list.map((t, i) => {
                const tc = teamColor(t.team), w = Math.round(t.wins), isOpen = openTeam === t.team;
                const roster = isOpen ? players.filter((p) => p.team === t.team).sort((a, b) => vaPlusShown(b) - vaPlusShown(a)) : [];
                const rosterMax = Math.max(1, ...roster.map((p) => Math.abs(vaPlusShown(p))));
                return (
                  <div key={t.team} className={i === 5 || i === 9 ? "border-b border-dashed border-stone-300" : "border-b border-stone-100"}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => { setOpenTeam(isOpen ? null : t.team); setExpanded(null); }}
                      className="relative w-full overflow-hidden text-left"
                    >
                      <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${(t.wins / maxW) * 100}%`, backgroundColor: withAlpha(tc, isOpen ? 0.3 : 0.16) }} aria-hidden />
                      <div className="relative flex items-center gap-1.5 sm:gap-2 text-[10px] py-1.5 px-1.5 sm:px-2">
                        <span className="w-5 sm:w-6 text-right tabular-nums text-stone-500">{i + 1}</span>
                        <TeamChip team={t.team} active={isOpen} />
                        {/* Always two lines: three names over two, the perimeter players
                            on top — or two over three, the guards on top, when three
                            surnames won't fit on one line. */}
                        <span className="flex-1 min-w-0 min-h-[2.75em] flex items-center text-stone-600 leading-snug">
                          <span className="min-w-0">
                            {lineupRows(t.top).map((row, r) => (
                              <span key={r} className="block truncate">
                                {r === 0 && <span className="text-stone-400 mr-1" aria-hidden>{isOpen ? "▾" : "▸"}</span>}
                                {row.join(" · ")}
                              </span>
                            ))}
                          </span>
                        </span>
                        <span className="w-12 text-right tabular-nums font-bold text-stone-900 shrink-0">{w}–{82 - w}</span>
                        <span className="w-10 text-right tabular-nums text-stone-400 shrink-0">{t.last ? `${t.last.w}–${t.last.l}` : "—"}</span>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="bg-stone-50/60 border-t border-stone-200 pl-2 sm:pl-4">
                        <div className="flex items-center gap-1.5 sm:gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 px-1.5 sm:px-2 border-b border-stone-200">
                          <span className="w-5 sm:w-6 text-right">#</span>
                          <span className="flex-1">Player</span>
                          <span className="w-6 text-right">G</span>
                          <span className="w-12 text-right">VA</span>
                          <span className="w-12 text-right">VA+</span>
                          <span className="w-10 text-right">VA+/G</span>
                        </div>
                        {roster.map((p) => (
                          <LeaderRow
                            withVaPlus starter={t.top.includes(p)}
                            key={p.slug} p={p} rank={rankOf.get(p.slug)} maxAbs={rosterMax} lga={lga} sim={awards.bySlug[p.slug]}
                            isOpen={expanded === p.slug} onToggle={() => setExpanded(expanded === p.slug ? null : p.slug)}
                          />
                        ))}
                        <InjuredOut list={data.injuredOut?.[t.team]} />
                        {data.unprojected?.[t.team]?.length > 0 && (
                          <div className="px-3 py-2 text-[9px] text-stone-500 border-t border-stone-200 leading-snug">
                            <span className="uppercase tracking-wider text-stone-400">Not projected: </span>
                            {data.unprojected[t.team].join(", ")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <AwardsBoard awards={awards} pBySlug={pBySlug} lga={lga} hasModels={!!data.awardModels} usgAdj={usgAdj}
        sub={awardSub} setSub={setAwardSub} open={awardOpen} setOpen={setAwardOpen} />

      {/* Projected leaders */}
      <div className="mb-4 border border-stone-300 bg-white">
        <div className="px-3 pt-2.5 pb-1.5 border-b border-stone-200 flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500">Projected Leaders</div>
          <select
            value={team || ""}
            onChange={(e) => { setTeam(e.target.value || null); setExpanded(null); }}
            className="text-[10px] font-semibold text-stone-700 bg-white border border-stone-300 px-1.5 py-0.5"
            aria-label="Filter by team"
          >
            <option value="">All teams</option>
            {[...teams].sort((a, b) => a.team.localeCompare(b.team)).map((t) => <option key={t.team} value={t.team}>{t.team}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 px-1.5 sm:px-2 border-b border-stone-200">
          <span className="w-5 sm:w-6 text-right">#</span>
          <span className="w-8 sm:w-10">Team</span>
          <span className="flex-1">Player</span>
          <span className="w-6 text-right">G</span>
          <span className="w-12 text-right">VA</span>
          <span className="w-10 text-right">VA/G</span>
        </div>
        {visible.map((p) => (
          <LeaderRow
            key={p.slug} p={p} rank={rankOf.get(p.slug)} maxAbs={maxAbs} lga={lga} sim={awards.bySlug[p.slug]}
            isOpen={expanded === p.slug} onToggle={() => setExpanded(expanded === p.slug ? null : p.slug)}
            activeTeam={team} onTeam={(t) => { setTeam(team === t ? null : t); setExpanded(null); }}
          />
        ))}
        {!team && rows.length > PAGE && (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="w-full text-center py-2 text-[10px] uppercase tracking-widest text-stone-500 hover:text-stone-900 border-t border-stone-200"
          >{showAll ? `Show top ${PAGE}` : `Show all ${rows.length}`}</button>
        )}
        {team && <InjuredOut list={data.injuredOut?.[team]} />}
        {team && data.unprojected?.[team]?.length > 0 && (
          <div className="px-3 py-2 text-[9px] text-stone-500 border-t border-stone-200 leading-snug">
            <span className="uppercase tracking-wider text-stone-400">Not projected (no NBA seasons): </span>
            {data.unprojected[team].join(", ")}
          </div>
        )}
      </div>

      {offRoster.length > 0 && (
        <div className="mb-4 px-3 py-2 bg-white border border-stone-300 text-[9px] text-stone-500 leading-snug">
          <span className="uppercase tracking-wider text-stone-400">Projected, but on no current roster: </span>
          {offRoster.slice(0, 20).map((p) => p.name).join(", ")}{offRoster.length > 20 ? `, +${offRoster.length - 20} more` : ""}
        </div>
      )}

      {/* Accuracy */}
      <div className="mb-4 p-3 bg-white border border-stone-300">
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500">How accurate</div>
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
          {[
            ["VA correlation", bt.corr.toFixed(2), bt.corrNaive.toFixed(2)],
            ["Avg miss (VA)", Math.round(bt.mae), Math.round(bt.maeNaive)],
            ["Top-25 hits", bt.top25Hit, bt.top25HitNaive],
          ].map(([label, model, naive]) => (
            <div key={label} className="border border-stone-200 bg-stone-50 px-1 py-1.5">
              <div className="text-[8px] uppercase tracking-wider text-stone-400">{label}</div>
              <div className="text-sm font-bold tabular-nums text-stone-900">{model}</div>
              <div className="text-[8px] text-stone-400 tabular-nums">vs {naive} naive</div>
            </div>
          ))}
        </div>
        <div className="text-[9px] italic text-stone-400 mt-1">
          Backtest: {bt.season} projected from data through the season before, {bt.players} players with {bt.minMinutes}+ min. “Naive” repeats each player’s previous season.
        </div>
      </div>

      {/* Method */}
      <div className="mb-4 border border-stone-300 bg-white">
        <button type="button" onClick={() => setShowMethod((s) => !s)} className="w-full px-3 py-2 text-left text-[10px] uppercase tracking-[0.3em] text-stone-500 flex items-center gap-2">
          <span className="text-stone-400 text-[10px]">{showMethod ? "▾" : "▸"}</span> How this works
        </button>
        {showMethod && <Method data={data} />}
      </div>
    </div>
    </AwardGo.Provider>
  );
}


// The projected awards, laid out like the Awards tab's boards: one sub-page per
// award, each player's odds beside their projected VA+ and games (minutes for
// ROY), tap a player for the projected line. MIP has no board here — it's
// scored against the projection itself, so there's nothing to look ahead with.
const AWARD_SUBS = [["mvp", "MVP"], ["roy", "ROY"], ["allnba", "All-NBA"], ["allstar", "All-Star"]];
const BOARD = {
  mvp: { title: "Most Valuable", col: "MVP%", odds: (r) => r.mvp, note: "The likeliest winners · 65-game rule applied" },
  roy: { title: "Rookie of the Year", col: "ROY%", odds: (r) => r.roy, rookies: true, minutes: true, note: "Every projected rookie · from VA+ and minutes per game" },
  allnba: { title: "All-NBA", col: "Odds", odds: (r) => r.allNba, note: "The fifteen likeliest, five a team · positionless, as voted since 2023-24 · 65-game rule applied" },
  allstar: { title: "All-Star", col: "Odds", odds: (r, split) => (split ? r.allStarConf : r.allStar), cut: ALL_STAR_PLACES,
    note: (split) => (split ? `Chance of a selection · ${ALL_STAR_PLACES / 2} West, ${ALL_STAR_PLACES / 2} East` : `Chance of a selection · ${ALL_STAR_PLACES} places, either conference`) },
};
const BOARD_SHOWN = 30;
const fmtInt = (x) => `${x < 0 ? "−" : ""}${Math.round(Math.abs(x)).toLocaleString()}`;

function AwardsBoard({ awards, pBySlug, lga, hasModels, usgAdj, sub, setSub, open, setOpen }) {
  // All-Star: 12 a conference, as the roster is picked, or the 24 likeliest league-wide.
  const [split, setSplit] = useState(true);
  const subs = hasModels ? AWARD_SUBS : AWARD_SUBS.filter(([k]) => k === "mvp" || k === "allnba");
  const cfg = BOARD[sub];
  const entries = awards.res.map((r) => ({ r, p: pBySlug[r.key], odds: cfg.odds(r, split) || 0 }))
    .filter((e) => e.p && (!cfg.rookies || e.p.rookie));
  const vpOf = (p) => vaPlus(p.va, p.dpm, p.row.mp);
  // All-NBA keeps its three teams on top; everyone else goes by odds.
  const teams = sub === "allnba" ? allNbaTeams(awards.res) : null;
  const onTeams = new Set(teams ? teams.flat().map((r) => r.key) : []);
  const ranked = entries.filter((e) => !onTeams.has(e.r.key))
    .sort((a, b) => b.odds - a.odds || vpOf(b.p) - vpOf(a.p));
  const bySplit = sub === "allstar" && split;
  const groups = teams
    ? [...teams.map((tm, ti) => ({ head: `${["First", "Second", "Third"][ti]} Team`, rows: tm.map((r) => entries.find((e) => e.r.key === r.key)).filter(Boolean) })),
      { head: "Next in line", rows: ranked.slice(0, BOARD_SHOWN - onTeams.size) }]
    : bySplit
    ? [["W", "West"], ["E", "East"]].map(([c, head]) => ({
      head, restart: true, cut: ALL_STAR_PLACES / 2,
      rows: ranked.filter((e) => TEAM_CONF[e.p.team] === c).slice(0, BOARD_SHOWN / 2),
    }))
    : [{ rows: ranked.slice(0, BOARD_SHOWN), cut: cfg.cut }];
  const max = Math.max(1e-9, ...groups.flatMap((g) => g.rows.map((e) => e.odds)));
  const subCls = (active) =>
    `text-[10px] font-bold uppercase tracking-wider px-0.5 py-2 border whitespace-nowrap ${active ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"}`;
  let rank = 0;
  return (
    <div id="la-awards" className="mb-4">
      <div className={`mb-2 grid gap-1 ${subs.length === 4 ? "grid-cols-4" : "grid-cols-2"}`} role="tablist" aria-label="Award">
        {subs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={sub === k} onClick={() => { setSub(k); setOpen(null); }} className={subCls(sub === k)}>{label}</button>
        ))}
      </div>
      <div className="border border-stone-300 bg-white">
        <div className="px-3 pt-2.5 pb-1.5 border-b border-stone-200">
          <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500">{cfg.title} · {LOOK_AHEAD_SEASON}</div>
          <div className="text-[9px] italic text-stone-400 mt-0.5">{typeof cfg.note === "function" ? cfg.note(split) : cfg.note} · share of {SIMS.toLocaleString()} simulated seasons{usgAdj ? " · priced on LG AVG" : ""} · tap a player for the projected line</div>
          {sub === "allstar" && (
            <div className="mt-1.5 flex border border-stone-300" role="group" aria-label="All-Star places">
              {[[true, `${ALL_STAR_PLACES / 2} West / ${ALL_STAR_PLACES / 2} East`], [false, `${ALL_STAR_PLACES} Total`]].map(([v, label]) => (
                <button key={label} type="button" aria-pressed={split === v} onClick={() => { setSplit(v); setOpen(null); }}
                  className={`flex-1 text-[9px] font-bold uppercase tracking-wider px-2 py-1 ${split === v ? "bg-stone-900 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 px-1.5 sm:px-2 border-b border-stone-200">
          <span className="w-5 sm:w-6 text-right">#</span>
          <span className="w-8 sm:w-10">Team</span>
          <span className="flex-1">Player</span>
          <span className="w-10 text-right text-stone-900 font-semibold">{cfg.col} ▾</span>
          <span className="w-11 text-right">VA+</span>
          <span className={`${cfg.minutes ? "w-8" : "w-6"} text-right`}>{cfg.minutes ? "MIN" : "G"}</span>
        </div>
        {groups.map((g, gi) => (
          <div key={gi} className={gi ? "border-t border-dashed border-stone-300" : ""}>
            {g.head && <div className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-stone-700">{g.head}</div>}
            {g.rows.map((e, k) => {
              if (g.restart && k === 0) rank = 0;
              rank++;
              const { p, r, odds } = e, tc = p.team ? teamColor(p.team) : "#78716c", isOpen = open === r.key, vp = vpOf(p);
              const cut = g.cut && k === g.cut;
              return (
                <div key={r.key} id={`la-award-${r.key}`} className={`border-b border-stone-100 last:border-0 ${cut ? "border-t border-dashed border-t-stone-300" : ""}`}>
                  <div className="relative overflow-hidden">
                    <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${(odds / max) * 100}%`, backgroundColor: withAlpha(tc, isOpen ? 0.3 : 0.16) }} aria-hidden />
                    <div
                      role="button" tabIndex={0} aria-expanded={isOpen}
                      aria-label={`${p.name} — ${isOpen ? "hide" : "show"} projected line`}
                      onClick={() => setOpen(isOpen ? null : r.key)}
                      onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setOpen(isOpen ? null : r.key); } }}
                      className="relative w-full flex items-center gap-1.5 sm:gap-2 text-[10px] py-1.5 px-1.5 sm:px-2 cursor-pointer"
                    >
                      <span className="w-5 sm:w-6 text-right tabular-nums text-stone-500">{rank}</span>
                      <TeamChip team={p.team} active={isOpen} />
                      <span className="flex-1 min-w-0 flex items-center text-stone-800">
                        <span className="text-stone-400 mr-1 shrink-0" aria-hidden>{isOpen ? "▾" : "▸"}</span>
                        <Name name={p.name} />
                        {p.injury && <span className="ml-1 shrink-0 text-[8px] font-bold uppercase tracking-wider px-1 border border-red-300 text-red-700 bg-red-50">INJ</span>}
                      </span>
                      <span className="w-10 text-right tabular-nums font-bold text-stone-900">{pct(odds)}</span>
                      <span className={`w-11 text-right tabular-nums ${vp < 0 ? "text-red-600" : "text-stone-700"}`}>{fmtInt(vp)}</span>
                      {cfg.minutes
                        ? <span className="w-8 text-right tabular-nums text-stone-500">{fmt1(p.mpg)}</span>
                        : <span className="w-6 text-right tabular-nums text-stone-500">{p.row.g}</span>}
                    </div>
                  </div>
                  {isOpen && <ProjectedLine p={p} sim={r} lga={lga} />}
                </div>
              );
            })}
          </div>
        ))}
        {!groups.some((g) => g.rows.length) && <div className="px-3 py-3 text-[10px] italic text-stone-400">No projected {sub === "roy" ? "rookies" : "players"} yet.</div>}
      </div>
    </div>
  );
}


// VA+ on the scale the page is showing: the shown VA (LG AVG or USG-ADJ)
// plus projected defense.
const vaPlusShown = (p) => vaPlus(p.vaShown, p.dpm, p.row.mp);

// One projected player: the bar, the line, and — tapped — the projected
// season beside the one it grew from. Shared by the leaders table and the
// roster each standings row drops open.
function LeaderRow({ p, rank, maxAbs, lga, sim, isOpen, onToggle, activeTeam = null, onTeam = null, withVaPlus = false, starter = false }) {
  const tc = p.team ? teamColor(p.team) : "#78716c";
  // In a team's roster the bar and the order are VA+ — VA plus projected
  // defense, the number the standings are built from — and the team chip,
  // the same on every row, gives its room to the VA+ column; the five named on
// the standings row (`starter`) are in bold.
  const vp = vaPlusShown(p);
  const barVal = withVaPlus ? vp : p.vaShown;
  return (
    <div className="border-b border-stone-100 last:border-0">
      <div className="relative overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 pointer-events-none"
          style={{ width: `${(Math.abs(barVal) / maxAbs) * 100}%`, backgroundColor: barVal >= 0 ? withAlpha(tc, 0.16) : withAlpha("#dc2626", 0.1) }}
          aria-hidden
        />
        <div
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
          aria-label={`${p.name} — ${isOpen ? "hide" : "show"} projected line`}
          onClick={onToggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
          className={`relative w-full flex items-center gap-1.5 sm:gap-2 text-[10px] py-1.5 px-1.5 sm:px-2 text-left cursor-pointer ${isOpen ? "bg-stone-100/60" : ""}`}
        >
          <span className="w-5 sm:w-6 text-right tabular-nums text-stone-500">{rank}</span>
          {!withVaPlus && <TeamChip team={p.team} active={activeTeam === p.team} onClick={onTeam && p.team ? (e) => { e.stopPropagation(); onTeam(p.team); } : undefined} />}
          <span className="flex-1 min-w-0 flex items-center text-stone-800">
            <span className="text-stone-400 mr-1 shrink-0" aria-hidden>{isOpen ? "▾" : "▸"}</span>
            {starter ? <span className="font-bold min-w-0"><Name name={p.name} /></span> : <Name name={p.name} />}
            {p.rookie && <span className="ml-1 shrink-0 text-[8px] font-bold uppercase tracking-wider px-1 border border-amber-400 text-amber-700 bg-amber-50">R</span>}
            {p.injury && <span title={`${p.injury.injury} — out ${p.injury.missed} games`} className="ml-1 shrink-0 text-[8px] font-bold uppercase tracking-wider px-1 border border-red-300 text-red-700 bg-red-50">INJ</span>}
          </span>
          <span className="w-6 text-right tabular-nums text-stone-500">{p.row.g}</span>
          <span className={`w-12 text-right tabular-nums ${withVaPlus ? "text-stone-600" : "font-bold"} ${p.vaShown < 0 ? "text-red-600" : withVaPlus ? "" : "text-stone-900"}`}>{fmt1(p.vaShown)}</span>
          {withVaPlus && <span className={`w-12 text-right tabular-nums font-bold ${vp < 0 ? "text-red-600" : "text-stone-900"}`}>{fmt1(vp)}</span>}
          <span className="w-10 text-right tabular-nums text-stone-700">{((withVaPlus ? vp : p.vaShown) / p.row.g).toFixed(2)}</span>
        </div>
      </div>
      {isOpen && <ProjectedLine p={p} sim={sim} lga={lga} />}
    </div>
  );
}


// The expanded row: the projected per-game line beside the season it grew
// from, and the 80% range of the simulated VA.
function ProjectedLine({ p, sim, lga }) {
  const L = p.last;
  const line = (r, g) => [
    ["MIN", r.mp / g], ["PTS", r.pts / g], ["REB", (r.drb + r.orb) / g], ["AST", r.ast / g],
    ["STL", r.stl / g], ["BLK", r.blk / g], ["TOV", r.tov / g],
    ["FG%", r.fga > 0 ? (100 * r.fgm) / r.fga : NaN], ["3P%", r.tpa > 0 ? (100 * r.tpm) / r.tpa : NaN], ["FT%", r.fta > 0 ? (100 * r.ftm) / r.fta : NaN],
  ];
  const proj = line(p.row, p.row.g), last = L ? line(L, L.g) : null;
  return (
    <div className="px-2 sm:px-3 py-2 bg-stone-50 border-t border-stone-200">
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full text-[9px] tabular-nums">
          <thead>
            <tr className="text-stone-400 uppercase tracking-wider">
              <th className="text-left font-normal pr-1"></th>
              {proj.map(([k]) => <th key={k} className="text-right font-normal px-1">{k}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="font-bold text-stone-900">
              <td className="text-left pr-1 whitespace-nowrap">’27 proj</td>
              {proj.map(([k, v]) => <td key={k} className="text-right px-1">{fmt1(v)}</td>)}
            </tr>
            {L && (
              <tr className="text-stone-500">
                <td className="text-left pr-1 whitespace-nowrap">’{L.season.slice(5)} {L.college ? <span title={L.team}>NCAA</span> : L.team}</td>
                {last.map(([k, v]) => <td key={k} className="text-right px-1">{fmt1(v)}</td>)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Cards p={p} sim={sim} lga={lga} />
    </div>
  );
}


// The notes under the line, one short card each: a tag that says what the
// card is about and a few words on what it did to the projection. The long
// version of each lives in the card's tooltip. Each card is a player row tall
// and grows to fill its line, content centred, so the rows run edge to edge.
function Card({ tag, tagClass = "", tagStyle, title, tight = false, className = "", onClick = null, children }) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick || undefined} title={title} className={`${className} ${onClick ? "hover:bg-stone-100 cursor-pointer" : ""} flex items-center justify-center min-h-8 border border-stone-200 bg-white py-1 text-[10px] text-stone-600 tabular-nums whitespace-nowrap ${tight ? "flex-1 min-w-0 gap-1 px-1" : "flex-auto gap-1.5 px-2"}`}>
      <span style={tagStyle} className={`text-[9px] font-bold uppercase px-1 py-0.5 border ${tight ? "tracking-normal" : "tracking-wider"} ${tagClass}`}>{tag}</span>
      <span>{children}</span>
    </Tag>
  );
}

const TAG = {
  red: "border-red-300 text-red-700 bg-red-50",
  amber: "border-amber-400 text-amber-700 bg-amber-50",
  stone: "border-stone-300 text-stone-600 bg-stone-50",
};
const signed = (x, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}`;
const shortDate = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const CONTEXT_LABEL = { min: "MIN", usg: "USG", ast: "AST", drb: "DRB", orb: "ORB" };
const CONTEXT_LONG = { min: "minutes", usg: "shots & turnovers", ast: "assists", drb: "def. rebounds", orb: "off. rebounds" };

function Cards({ p, sim, lga }) {
  const goToAward = useContext(AwardGo);
  const L = p.last, inj = p.injury;
  // What sharing a roster did: every pooled resource, biggest move first, and
  // the VA it cost or added against the player projected alone.
  const moved = p.pool && p.solo ? Object.entries(p.pool).sort(([, a], [, b]) => Math.abs(b - 1) - Math.abs(a - 1)) : [];
  const dva = moved.length ? p.vaShown - valueAdd(p.solo, lga) : null;
  const ctxPct = (f) => { const x = (f - 1) * 100; return `${signed(x, Math.abs(x) < 1 && x !== 0 ? 1 : 0)}%`; };
  // A rookie has no NBA defense to project from, so — as in VA+ and the
  // standings — they're taken as average: VA+ is their VA, defense zero.
  const def = p.row.mp > 0 && (p.dpm != null || p.rookie) ? (p.dpm || 0) * p.row.mp : null;
  const tc = p.team ? teamColor(p.team) : "#78716c";
  // Every VA on a card is per game, like the VA/G column; totals are in the tooltips.
  const g = p.row.g;
  const vpTot = def != null ? vaPlus(p.va, p.dpm, p.row.mp) : null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {/* The team context on the left, two cards tall — the team centred, its
          resources listed down (scrolling when there are more than fit) — with
          VA+ and what the roster did stacked beside it. */}
      {moved.length > 0 ? (
        <div className="basis-full grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-1">
          <div title={`Team context on ${p.team}: ${moved.map(([k, f]) => `${CONTEXT_LONG[k]} ${ctxPct(f)}`).join(", ")}`}
            className="row-span-2 h-[4.25rem] flex flex-col items-center justify-center gap-1 border border-stone-200 bg-white px-2 py-0.5 text-[10px] text-stone-600 tabular-nums">
            <span style={{ backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) }} className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 border">{p.team}</span>
            {/* Exactly three lines tall, the rest a scroll away, snapping a line at a time. */}
            <span className="w-full h-[3.6em] overflow-y-auto no-scrollbar snap-y snap-mandatory leading-[1.2] text-center">
              {moved.map(([k, f]) => <span key={k} className="block snap-start whitespace-nowrap">{ctxPct(f)} {CONTEXT_LABEL[k]}</span>)}
            </span>
          </div>
          {def != null && <Defense def={def} g={g} vpTot={vpTot} rookie={p.dpm == null} />}
          {/* No projected defense (a rookie): the situation fills both rows. */}
          <Situation dva={dva} g={g} className={def != null ? "" : "row-span-2"} />
        </div>
      ) : def != null && <Defense def={def} g={g} vpTot={vpTot} rookie={p.dpm == null} />}
      {sim?.hist && <Spread sim={sim} g={g} tc={tc} />}
      {sim && (() => {
        const odds = [["MVP", sim.mvp], ["ROY", p.rookie ? sim.roy : 0], ["All-NBA", sim.allNba], ["All-Star", sim.allStar]].filter(([, x]) => x > 0.005);
        return odds.length > 0 && (
          <div className="basis-full flex gap-1">
            {odds.map(([k, x]) => (
              <Card key={k} tight tag={k} tagClass={TAG.amber} title={`${k} board`}
                onClick={goToAward ? () => goToAward(AWARD_KEY[k], p.slug) : null}>
                {pct(x)} <span className="text-stone-400" aria-hidden>→</span>
              </Card>
            ))}
          </div>
        );
      })()}
      {/* Who the player is coming in as — rookie, injured, back from a lost
          season — together on one row at the bottom, wrapping only if they must. */}
      {(p.rookie || inj || p.missedLast || p.lostLast) && (
        <div className="basis-full flex flex-wrap gap-1">
          {p.rookie && (
            <Card tag="R" tagClass={TAG.amber} title={p.model === "profile"
              ? `Minutes and games from the draft slot, each stat from the slot and ${L.g} games at ${L.team}`
              : p.model === "pick" ? "Projected from the draft slot"
              : `Projected from ${L.g} games at ${L.team} — undrafted, so there’s no pick to go on`}>
              {p.pick ? `Rookie, No. ${p.pick} pick-scaled` : "Rookie, undrafted"}
            </Card>
          )}
          {inj && (
            <Card tag="INJ" tagClass={TAG.red} title={`${inj.injury} — ${p.row.g} of a healthy ${inj.healthyG} games (${fmt1(inj.healthyVa)} VA)${inj.note ? ` · ${inj.note}` : ""}${inj.asOf ? ` (as of ${fmtDate(inj.asOf)})` : ""}`}>
              assumes {inj.missed} G missed{inj.return ? ` · Ret. ${shortDate(inj.return)}` : ""}
            </Card>
          )}
          {p.missedLast && <Card tag="Out ’26" tagClass={TAG.red} title="Missed all of 2025-26 — projected from earlier seasons, with the drop full-season returners have historically shown">from prior years</Card>}
          {p.lostLast && <Card tag="Hurt ’26" tagClass={TAG.red} title="Last season cut short by injury — minutes and games projected from the healthy seasons before it">assumes a healthy year</Card>}
        </div>
      )}
    </div>
  );
}


// What the roster did to the player, against them projected alone. The arrow
// stays small and uncoloured: the number carries it.
function Situation({ dva, g, className = "" }) {
  return (
    <Card className={className} tag={dva >= 0 ? "▲" : "▼"} tagClass={`${TAG.stone} !text-[7px] !px-0.5 !py-0 leading-none`} title={`${signed(dva)} VA over the season on this roster vs. the same player projected alone`}>
      <span className={`font-semibold ${dva < 0 ? "text-red-600" : "text-stone-700"}`}>{signed(dva / g, 2)} VA/G</span> {dva >= 0 ? "better" : "worse"} situation
    </Card>
  );
}

// VA+ per game, with the defense that takes VA there beside it.
function Defense({ def, g, vpTot, rookie = false }) {
  return (
    <Card tag="VA+" tagClass={TAG.stone} title={rookie
      ? "VA+ per game: a rookie has no NBA defense to project from, so it's taken as average and VA+ is their VA"
      : `VA+ per game: VA plus projected defense (${signed(def)} VA over the season, ${fmt1(vpTot)} VA+)`}>
      <span className="font-semibold text-stone-700">{(vpTot / g).toFixed(1)}</span> (Def: {rookie ? "avg" : <span className={def < 0 ? "text-red-600" : ""}>{signed(def / g, 2)}</span>})
    </Card>
  );
}

// The simulated season's VA/G as a histogram, its middle 60% — 20th to 80th
// percentile — drawn in the team's colour with the two ends named either side.
function Spread({ sim, g, tc }) {
  const { lo, hi, counts } = sim.hist, w = (hi - lo) / counts.length;
  const top = Math.max(1e-9, ...counts);
  const end = (label, x) => (
    <span className="flex flex-col items-center leading-none shrink-0">
      <span className="text-[7px] uppercase tracking-wider text-stone-400">{label}</span>
      <span className="mt-0.5 font-semibold text-stone-700">{(x / g).toFixed(2)}</span>
    </span>
  );
  return (
    <span title={`60% of simulated seasons land between ${(sim.va20 / g).toFixed(2)} and ${(sim.va80 / g).toFixed(2)} VA/G (20th to 80th percentile, ${Math.round(sim.va20)}–${Math.round(sim.va80)} VA over the ${g} projected games)`}
      className="basis-full flex items-center gap-2 min-h-8 border border-stone-200 bg-white px-2 py-1 text-[10px] tabular-nums">
      {end("20th", sim.va20)}
      <span className="flex-1 flex items-end gap-px h-5" aria-hidden>
        {counts.map((c, i) => {
          const mid = lo + (i + 0.5) * w, inside = mid >= sim.va20 && mid <= sim.va80;
          return <span key={i} className="flex-1" style={{ height: `${Math.max(4, (c / top) * 100)}%`, backgroundColor: withAlpha(inside ? tc : "#a8a29e", inside ? 0.7 : 0.35) }} />;
        })}
      </span>
      {end("80th", sim.va80)}
      <span className="text-stone-400 shrink-0">VA/G</span>
    </span>
  );
}


function Method({ data }) {
  const m = data.mvp;
  return (
    <div className="px-3 pb-3 text-[10px] text-stone-600 leading-relaxed space-y-2">
      <p><span className="font-semibold text-stone-800">The line.</span> Each player’s box score is projected in pieces — per-minute shot attempts, assists, steals, blocks, turnovers and rebounds; 2P%, 3P% and FT%; minutes per game; and games played — and rebuilt into a season line. Points come from the projected shots and percentages, never on their own.</p>
      <p><span className="font-semibold text-stone-800">The time series.</span> Every rate and percentage is a weighted average of the last three seasons (each counting a fitted fraction of the one after it, and weighted by its minutes or attempts), shrunk toward the player’s position by a fitted number of phantom minutes or attempts, then aged along a curve fit by career stage. Minutes and games are a regression on the last five seasons, which treats a season lost to injury (under half the schedule at starter minutes) as an injury rather than as the new normal: the healthy seasons around it stand in for it, and a fitted adjustment prices in the risk of getting hurt again. Repeated lost seasons count against a player. Every constant was fit on {data.base === "2025-26" ? "1985-86 through 2025-26" : `seasons through ${data.base}`}, judged on how well it predicted the next season.</p>
      <p><span className="font-semibold text-stone-800">The team context.</span> A team only has so much to share — 240 minutes a night, one shot or turnover per possession, assists off its own baskets, and its share of the rebounds. So once players are placed on their current rosters, each of those is pooled: a roster projected to play more minutes than a typical team, or to use possessions, assist or rebound at a hotter rate per minute, has every player’s share scaled back toward the league’s norm (and a thin roster’s scaled up). How hard each resource pools was fit on how players actually did on the rosters they played for since 1995-96 — usage pools the most, and a team’s heaviest user gives up the least of it, while rebounds pool only lightly. Who takes the possessions that remain is split by each player’s own projected volume raised to a fitted power slightly above one, so stars draw a little more than their proportion — a rank-based curve (best player X shots, second fewer, and so on) was tested against it and fit the data clearly worse. On held-out 2025-26, it cut the usage error for players on new teams by about 5% and the assist error by 3%.</p>
      {data.params?.rookie && (() => {
        const b = data.params.rookie.backtest || {}, L = b.lottery || {};
        return (
          <p><span className="font-semibold text-stone-800">The rookies.</span> A drafted rookie is projected from the pick — the strongest public signal of the role a rookie walks into — with every piece of the line (minutes, games, each per-minute rate and percentage) fit on how past rookies at that slot played. The college season was tested on top of it, translated stat by stat and adjusted for years in college, and it made the projections worse: the pick already carries what scouts saw in that season. College stats are used only for undrafted rookies, where there is no pick — and there they predict little.{b.players ? ` Projecting each rookie class from a fit on the others, it correlated ${b.corr.toFixed(2)} with what ${b.players} rookies actually did, missing by ${Math.round(b.mae)} VA on average against ${Math.round(b.maeNaive)} for “every rookie is average”${L.players >= 10 ? `; for lottery picks, ${Math.round(L.mae)} against ${Math.round(L.maeNaive)}` : ""}. Rookie seasons are the least predictable on the page, and their simulated ranges are drawn from rookie misses to match.` : ""}</p>
        );
      })()}
      {data.wins && (
        <p><span className="font-semibold text-stone-800">The standings.</span> A team’s wins come from its players’ projected VA+ — VA after the team context, plus a projection of each player’s defense — taken best to worst with each player counting {Math.round(data.wins.rho * 100)}% of the one ahead, and from the record it’s coming off, which carries coaching, system and health that rosters can’t. It was fit on every season since 1990-91, each roster projected from what was known the summer before: it misses by {data.wins.rmseWins.toFixed(1)} wins on average, against {data.wins.rmseLastRecord.toFixed(1)} for last season’s record alone and {data.wins.rmseConstant.toFixed(1)} for calling every team 41–41. VA+ beat plain VA and USG-ADJ VA, the gentle decay beat a top-eight sum and a free weight per rank, and offense and defense, fit separately, came out weighted alike. The dashed lines mark the sixth and tenth seeds.</p>
      )}
      <p><span className="font-semibold text-stone-800">The price.</span> The projected line is scored with the same Value Added formula as every other season here, against the {data.base} league.</p>
      <p><span className="font-semibold text-stone-800">The awards.</span> The same models as the Awards tab, run on the projected season. Each simulated season draws every player’s miss from the real misses this projection made in past seasons — per-game VA and games missed together — and then draws each ballot from the player’s VA+: MVP from a logit on VA+, fit on {data.awardModels ? "every winner since 1980-81" : `all ${m.seasons} winners since 1980-81 (on plain VA)`}, with the 65-game rule; All-NBA as the top fifteen of that ballot{data.awardModels ? <>; Rookie of the Year among the projected rookies from VA+ and minutes per game; and All-Star as the {ALL_STAR_PLACES} likeliest selections from a logit on VA+, each fit on the real picks</> : ""}. Most Improved has no board here: it is scored against this projection, so there is nothing to look ahead with.</p>
      <p><span className="font-semibold text-stone-800">Injuries.</span> A player already reported out is projected for the games left after the expected return: the projected availability applied to what remains of the schedule, at the same per-game line, so someone out until March keeps their rate but loses most of their total. The minutes they give up go to their teammates in the team context. Return dates come from {data.injuries === "live" ? "ESPN’s injury report, read live, and " : ""}reporting collected {data.injuriesAsOf ? `as of ${fmtDate(data.injuriesAsOf)}` : "before the season"} (the newer of the two wins), taking the middle of a reported range; day-to-day listings are left to the projected availability. A player out for the season is off the board and named under their team.</p>
      <p><span className="font-semibold text-stone-800">Blind spots.</span> Career stage is seasons played, not age (the data has no birth dates). Undrafted rookies with no college season in the data aren’t projected. A season lost entirely to injury isn’t one of the outcomes drawn. And the league is assumed to look like {data.base}’s.</p>
      <p className="text-[9px] italic text-stone-400">Fit {data.fittedAt} · npm run fit:projections</p>
    </div>
  );
}
