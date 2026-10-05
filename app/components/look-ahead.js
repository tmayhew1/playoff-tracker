"use client";

import { useEffect, useMemo, useState } from "react";
import { valueAdd } from "../scoring";
import { fetchBakedJson } from "../lib/fetch-cache";
import { splitName, teamColor, withAlpha } from "../lib/format";
import { useSeasonLga, useVAMode } from "../lib/va-mode";
import { allNbaTeams, projectWins, simulateAwards, vaPlus } from "../lib/projection-model";
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

const pct = (x) => (x >= 0.995 ? ">99%" : x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
const fmt1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "–");

function TeamChip({ team, onClick, active = false }) {
  if (!team) {
    return <span className="w-8 sm:w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center border border-stone-200 text-stone-400 shrink-0">FA</span>;
  }
  const tc = teamColor(team);
  const style = { backgroundColor: withAlpha(tc, active ? 0.3 : 0.14), color: tc, borderColor: withAlpha(tc, active ? 0.8 : 0.4) };
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      style={style}
      className="w-8 sm:w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center border shrink-0 hover:brightness-95"
      aria-label={onClick ? `Filter by ${team}` : undefined}
    >{team}</Tag>
  );
}

function Name({ name }) {
  const { first, last } = splitName(name);
  return (
    <span className="min-w-0 flex flex-col sm:flex-row sm:items-baseline sm:gap-1 leading-[1.1]">
      {first && <span className="truncate text-[8px] text-stone-500 sm:text-[10px] sm:shrink-0">{first}</span>}
      <span className="truncate text-[10px]">{last}</span>
    </span>
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

  const awards = useMemo(() => {
    if (!data) return null;
    const field = [...players].sort((a, b) => b.va - a.va).slice(0, SIM_FIELD);
    const rookiePool = data.params?.rookie?.pool;
    const res = simulateAwards(field.map((p) => ({ key: p.slug, g: p.row.g, va: p.va, mpg: p.mpg, pool: p.rookie ? rookiePool : null })),
      data.mvp.model, data.pool, { sims: SIMS });
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
      const top = [...list].sort((a, b) => vaPlus(b.va, b.dpm, b.row.mp) - vaPlus(a.va, a.dpm, a.row.mp)).slice(0, 5);
      return { team: t, conf: TEAM_CONF[t] || "?", wins: proj[t]?.wins ?? 41, last: rec[t] || null, top };
    }).sort((a, b) => b.wins - a.wins);
  }, [data, players]);

  if (error) return <div className="text-[10px] text-red-600 py-4 text-center px-2 break-words">Couldn’t load the projection — {error}</div>;
  if (!data || !awards) return <div className="text-[10px] text-stone-500 italic py-4 text-center">Projecting 2026-27…</div>;

  const pBySlug = Object.fromEntries(players.map((p) => [p.slug, p]));
  const mvpList = awards.res.filter((r) => r.mvp > 0).sort((a, b) => b.mvp - a.mvp).slice(0, 10);
  const maxMvp = mvpList[0]?.mvp || 1;
  const allNba = allNbaTeams(awards.res);
  const bt = data.backtest;

  const rows = team ? players.filter((p) => p.team === team) : players;
  const visible = showAll || team ? rows : rows.slice(0, PAGE);
  const maxAbs = Math.max(1, ...rows.map((p) => Math.abs(p.vaShown)));
  const rankOf = new Map(players.map((p, i) => [p.slug, i + 1]));

  return (
    <div>
      {/* Masthead */}
      <div className="mb-4 p-3 bg-white border border-stone-300">
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500">2026-27 · Look Ahead</div>
        <div className="text-sm font-bold text-stone-900 mt-1 leading-snug">Every roster’s 2026-27 record, every player’s season, and the MVP and All-NBA races simulated {SIMS.toLocaleString()} times.</div>
        <div className="text-[10px] text-stone-500 mt-1.5 leading-snug">
          {data.rosters === "live"
            ? <>Rosters live from ESPN. Rookies are projected from their draft slot (undrafted ones from college); undrafted rookies with no college season here aren’t.</>
            : <>Live rosters unavailable — players shown on their last {data.base} team; offseason moves aren’t reflected.</>}
        </div>
      </div>

      {/* Teams */}
      <div className="mb-4 border border-stone-300 bg-white">
        <SectionHead
          title="Projected Standings"
          note={data.wins
            ? `Wins from each roster’s VA+ (VA after the team context, plus projected defense), best player to worst, and last season’s record · typical miss ±${Math.round(data.wins.rmseWins)} wins · tap a team for its projected roster`
            : "Wins model not fit yet"}
        />
        {["E", "W"].map((conf) => {
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
                        <span className="flex-1 min-w-0 text-stone-600 leading-snug">
                          <span className="text-stone-400 mr-1" aria-hidden>{isOpen ? "▾" : "▸"}</span>
                          {t.top.map((p) => splitName(p.name).last).join(" · ")}
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
                            withVaPlus
                            key={p.slug} p={p} rank={rankOf.get(p.slug)} maxAbs={rosterMax} lga={lga} sim={awards.bySlug[p.slug]}
                            isOpen={expanded === p.slug} onToggle={() => setExpanded(expanded === p.slug ? null : p.slug)}
                          />
                        ))}
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

      {/* MVP */}
      <div className="mb-4 border border-stone-300 bg-white">
        <SectionHead title="MVP Odds" note={`Share of ${SIMS.toLocaleString()} simulated seasons won · 65-game rule applied${usgAdj ? " · priced on LG AVG" : ""}`} />
        {mvpList.map((r, i) => {
          const p = pBySlug[r.key];
          if (!p) return null;
          const tc = p.team ? teamColor(p.team) : "#78716c";
          return (
            <div key={r.key} className="relative overflow-hidden border-b border-stone-100 last:border-0">
              <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${(r.mvp / maxMvp) * 100}%`, backgroundColor: withAlpha(tc, 0.16) }} aria-hidden />
              <div className="relative flex items-center gap-1.5 sm:gap-2 text-[10px] py-1.5 px-1.5 sm:px-2">
                <span className="w-5 sm:w-6 text-right tabular-nums text-stone-500">{i + 1}</span>
                <TeamChip team={p.team} />
                <span className="flex-1 min-w-0 text-stone-800"><Name name={p.name} /></span>
                <span className="w-14 text-right tabular-nums text-stone-500">{Math.round(p.va)} VA</span>
                <span className="w-10 text-right tabular-nums font-bold text-stone-900">{pct(r.mvp)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* All-NBA */}
      <div className="mb-4 border border-stone-300 bg-white">
        <SectionHead title="Preseason All-NBA" note="The fifteen likeliest selections, by share of simulations · positionless, as voted since 2023-24" />
        {allNba.map((tm, ti) => (
          <div key={ti} className="border-b border-stone-200 last:border-0">
            <div className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-stone-700">{["First", "Second", "Third"][ti]} Team</div>
            {tm.map((r) => {
              const p = pBySlug[r.key];
              if (!p) return null;
              return (
                <div key={r.key} className="flex items-center gap-1.5 sm:gap-2 text-[10px] py-1 px-1.5 sm:px-2">
                  <span className="w-5 sm:w-6" />
                  <TeamChip team={p.team} />
                  <span className="flex-1 min-w-0 text-stone-800"><Name name={p.name} /></span>
                  <span className="w-16 text-right tabular-nums text-stone-500">{p.row.g} G proj</span>
                  <span className="w-10 text-right tabular-nums font-bold text-stone-900">{pct(r.allNba)}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

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
  );
}


// VA+ on the scale the page is showing: the shown VA (LG AVG or USG-ADJ)
// plus projected defense.
const vaPlusShown = (p) => vaPlus(p.vaShown, p.dpm, p.row.mp);

// One projected player: the bar, the line, and — tapped — the projected
// season beside the one it grew from. Shared by the leaders table and the
// roster each standings row drops open.
function LeaderRow({ p, rank, maxAbs, lga, sim, isOpen, onToggle, activeTeam = null, onTeam = null, withVaPlus = false }) {
  const tc = p.team ? teamColor(p.team) : "#78716c";
  // In a team's roster the bar and the order are VA+ — VA plus projected
  // defense, the number the standings are built from — and the team chip,
  // the same on every row, gives its room to the VA+ column.
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
            <Name name={p.name} />
            {p.rookie && <span className="ml-1 shrink-0 text-[8px] font-bold uppercase tracking-wider px-1 border border-amber-400 text-amber-700 bg-amber-50">R</span>}
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
  const lastVa = L ? valueAdd(L, lga) : null;
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
      <div className="mt-1.5 text-[9px] text-stone-500 leading-snug">
        {p.rookie
          ? <>Rookie{p.pick ? ` · No. ${p.pick} pick` : " · undrafted"} · {p.row.g} games at {fmt1(p.mpg)} min · {fmt1(p.vaShown)} VA, {p.model === "pick"
              ? <>projected from the draft slot{L ? <> (the {L.team} line is shown for reference)</> : null}</>
              : <>projected from {L.g} games at {L.team} — undrafted, so there’s no pick to go on, and college stats alone predict little</>}</>
          : <>{p.row.g} games at {fmt1(p.mpg)} min · {fmt1(p.vaShown)} VA, from {fmt1(lastVa)} in {L.g} games last time</>}
        {p.missedLast && <> · missed all of 2025-26 — projected from earlier seasons, with the drop full-season returners have historically shown</>}
        {p.lostLast && <> · last season cut short by injury — minutes and games projected from the healthy seasons before it</>}
        <TeamContext p={p} lga={lga} />
        {p.dpm != null && p.row.mp > 0 && <> · projected defense {p.dpm * p.row.mp >= 0 ? "+" : "−"}{fmt1(Math.abs(p.dpm * p.row.mp))} VA (VA+ {fmt1(vaPlus(p.va, p.dpm, p.row.mp))})</>}
        {sim && <> · 80% of simulated seasons land between <span className="font-semibold text-stone-700">{Math.round(sim.vaLo)}</span> and <span className="font-semibold text-stone-700">{Math.round(sim.vaHi)}</span> VA</>}
        {sim && sim.allNba > 0.005 && <> · All-NBA {pct(sim.allNba)}</>}
      </div>
    </div>
  );
}


// What sharing a roster did to the projection: each pooled resource's
// multiplier, shown when it moved by at least 1%, and the VA it cost or added.
const CONTEXT_LABEL = { min: "minutes", usg: "shots & turnovers", ast: "assists", drb: "def. rebounds", orb: "off. rebounds" };
function TeamContext({ p, lga }) {
  if (!p.pool || !p.solo) return null;
  const moved = Object.entries(p.pool).filter(([, f]) => Math.abs(f - 1) >= 0.01);
  if (!moved.length) return null;
  const dva = p.vaShown - valueAdd(p.solo, lga);
  return (
    <> · team context on {p.team}: {moved.map(([k, f], i) => (
      <span key={k}>{i ? ", " : ""}{CONTEXT_LABEL[k]} {f < 1 ? "−" : "+"}{Math.round(Math.abs(f - 1) * 100)}%</span>
    ))} (<span className={`font-semibold ${dva < 0 ? "text-red-600" : "text-stone-700"}`}>{dva >= 0 ? "+" : ""}{fmt1(dva)} VA</span> vs. projected alone)</>
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
      <p><span className="font-semibold text-stone-800">The awards.</span> MVP voting is modelled as a logit on season VA, fit on all {m.seasons} winners since 1980-81 (team strength, VA per game and games played were tested and added nothing out of sample). Each simulated season draws every player’s miss from the real misses this projection made in past seasons — per-game VA and games missed together — applies the 65-game rule, and draws a ballot. All-NBA is the top fifteen of that ballot.</p>
      <p><span className="font-semibold text-stone-800">Blind spots.</span> Career stage is seasons played, not age (the data has no birth dates). Undrafted rookies with no college season in the data aren’t projected. A season lost entirely to injury isn’t one of the outcomes drawn. And the league is assumed to look like {data.base}’s.</p>
      <p className="text-[9px] italic text-stone-400">Fit {data.fittedAt} · npm run fit:projections</p>
    </div>
  );
}
