"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchBakedJson } from "../lib/fetch-cache";
import { teamColor, withAlpha } from "../lib/format";
import { Name, TeamChip } from "./player-chips";

// The MIP tab: every regular season since 1981-82, each returning player's
// actual VA beside what the Look Ahead model would have projected for them the
// summer before, ranked by a Most Improved Player model fit on every winner
// since 1985-86 (scripts/bake-mip.mjs, served by /api/mip).

const STAT_KEYS = ["MIN", "PTS", "REB", "AST", "STL", "BLK", "TOV", "FG%", "3P%", "FT%"];
// "mip" is the model's order; tapping Over/G or Over sorts by that instead,
// and tapping it again comes back.
const SORT_NOTE = { mip: "Ranked by MIP odds", pg: "Sorted by VA per game over expected", tot: "Sorted by VA over expected" };

const pct = (p) => (p == null ? "–" : p >= 0.995 ? ">99%" : p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);
const num = (x, d = 0) => `${x < 0 ? "−" : ""}${Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const signed = (x, d = 0) => `${x > 0 ? "+" : ""}${num(x, d)}`;
const f1 = (x) => (x == null ? "–" : x.toFixed(1));
const yy = (s) => `’${s.slice(5)}`;

export function MipView({ onGoToLeaderboard = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState("season"); // "season" | "all"
  const [season, setSeason] = useState(null);
  const [sort, setSort] = useState("mip");
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchBakedJson("/api/mip")
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message || "Load failed"); });
    return () => { cancelled = true; };
  }, []);

  const seasons = useMemo(() => (data ? Object.keys(data.seasons).sort() : []), [data]);
  const cur = season || seasons.at(-1);
  // Rows arrive as arrays keyed by data.fields.
  const row = useMemo(() => {
    if (!data) return () => null;
    const F = data.fields;
    return (i) => Object.fromEntries(F.map((k, j) => [k, data.rows[i][j]]));
  }, [data]);

  if (error) return <div className="text-[10px] text-red-600 py-4 text-center px-2 break-words">Couldn’t load the MIP board — {error}</div>;
  if (!data) return <div className="text-[10px] text-stone-500 italic py-4 text-center">Loading MIP…</div>;

  const S = data.seasons[cur];
  const list = (view === "all" ? data.allTime[sort] : S[sort]).map(([i, rank]) => ({ ...row(i), rank, i }));
  const valOf = (r) => (sort === "mip" ? r.mip || 0 : sort === "pg" ? r.actualPg - r.projPg : r.actual - r.proj);
  const maxVal = Math.max(1e-9, ...list.map(valOf));
  const winSlug = view === "season" ? S.winner?.slug : null;
  const i = seasons.indexOf(cur);
  const pick = (s) => { setSeason(s); setOpen(null); };
  const tapSort = (m) => setSort(sort === m ? "mip" : m);

  const tabCls = (active) =>
    `flex-1 text-[10px] uppercase tracking-[0.2em] px-3 py-2 border ${active ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"}`;
  const sortCls = (m) => `text-right whitespace-nowrap uppercase tracking-wider cursor-pointer hover:text-stone-900 ${sort === m ? "text-stone-900 font-semibold" : ""}`;
  const bt = data.model.backtest;

  return (
    <div>
      <div className="mb-2 flex gap-2">
        <button type="button" onClick={() => { setView("season"); setOpen(null); }} className={tabCls(view === "season")}>By Season</button>
        <button type="button" onClick={() => { setView("all"); setOpen(null); }} className={tabCls(view === "all")}>All-Time</button>
      </div>

      {view === "season" && (
        <div className="mb-4 p-3 bg-white border border-stone-300">
          <label className="text-[10px] uppercase tracking-[0.3em] text-stone-500 block mb-1" htmlFor="mip-season">Season</label>
          <div className="flex gap-1.5">
            <button type="button" aria-label="Previous season" disabled={i <= 0} onClick={() => pick(seasons[i - 1])}
              className="w-9 border border-stone-300 bg-white text-stone-700 disabled:text-stone-300">‹</button>
            <select id="mip-season" value={cur} onChange={(e) => pick(e.target.value)}
              className="flex-1 min-w-0 text-sm font-bold text-stone-900 bg-white border border-stone-300 px-2 py-1.5">
              {[...seasons].reverse().map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" aria-label="Next season" disabled={i >= seasons.length - 1} onClick={() => pick(seasons[i + 1])}
              className="w-9 border border-stone-300 bg-white text-stone-700 disabled:text-stone-300">›</button>
          </div>
          <div className="text-[10px] mt-1.5 text-stone-500">
            {S.winner
              ? <span className="inline-block px-1.5 py-0.5 border border-amber-400 bg-amber-50 text-amber-800">MIP: {S.winner.name} · ranked #{S.winner[sort] ?? "–"} of {sort === "tot" ? S.players : S.qualified}</span>
              : <span className="italic text-stone-400">{S.players} returning players · before the award existed</span>}
          </div>
        </div>
      )}

      <div className="mb-4 border border-stone-300 bg-white">
        <div className="px-3 pt-2.5 pb-1.5 border-b border-stone-200">
          <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500">{view === "all" ? "All-Time Top 50" : `Most Improved · ${cur}`}</div>
          <div className="text-[9px] italic text-stone-400 mt-0.5">
            {SORT_NOTE[sort]}{view === "all" && sort === "mip" ? " · biggest per-game ratios; MIP % is within each season" : ""} · tap a player for the expected line beside the actual
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 px-1.5 sm:px-2 border-b border-stone-200">
          <span className="w-5 sm:w-6 text-right">#</span>
          <span className="w-8 sm:w-10">Team</span>
          <span className="flex-1">Player</span>
          <button type="button" onClick={() => tapSort("mip")} aria-pressed={sort === "mip"} className={`w-10 ${sortCls("mip")}`}>MIP%{sort === "mip" ? " ▾" : ""}</button>
          <button type="button" onClick={() => tapSort("pg")} aria-pressed={sort === "pg"} className={`w-12 ${sortCls("pg")}`}>Over/G{sort === "pg" ? " ▾" : ""}</button>
          <button type="button" onClick={() => tapSort("tot")} aria-pressed={sort === "tot"} className={`w-11 ${sortCls("tot")}`}>Over{sort === "tot" ? " ▾" : ""}</button>
        </div>
        {list.map((r, k) => (
          <MipRow
            key={r.i} r={r} withSeason={view === "all"} isWinner={r.slug === winSlug}
            width={Math.max(0, valOf(r)) / maxVal}
            gap={view === "season" && k === 25}
            isOpen={open === r.i} onToggle={() => setOpen(open === r.i ? null : r.i)}
            onGo={onGoToLeaderboard}
          />
        ))}
      </div>

      <div className="mb-4 p-3 bg-white border border-stone-300">
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500">Against the real award</div>
        <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
          {[["#1", bt.top1], ["Top 5", bt.top5], ["Top 10", bt.top10], ["Median", `#${bt.medianRank}`]].map(([k, v]) => (
            <div key={k} className="border border-stone-200 bg-stone-50 px-1 py-1.5">
              <div className="text-[8px] uppercase tracking-wider text-stone-400">{k}</div>
              <div className="text-sm font-bold tabular-nums text-stone-900">{v}</div>
            </div>
          ))}
        </div>
        <div className="text-[9px] italic text-stone-400 mt-1">Where the real winner ranked, {bt.seasons} seasons, each scored by a model fit on the others.</div>
      </div>

      <Method model={data.model} />
    </div>
  );
}

function MipRow({ r, withSeason, isWinner, width, gap, isOpen, onToggle, onGo }) {
  const tc = teamColor(r.team);
  const over = r.actual - r.proj, overPg = r.actualPg - r.projPg;
  return (
    <div className={`border-b border-stone-100 last:border-0 ${gap ? "border-t border-dashed border-t-stone-300" : ""}`}>
      <div className={`relative overflow-hidden ${isWinner ? "bg-amber-50" : ""}`}>
        <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${width * 100}%`, backgroundColor: withAlpha(tc, isOpen ? 0.3 : 0.16) }} aria-hidden />
        <div
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
          aria-label={`${r.name} — ${isOpen ? "hide" : "show"} expected and actual lines`}
          onClick={onToggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
          className={`relative w-full flex items-center gap-1.5 sm:gap-2 text-[10px] py-1.5 px-1.5 sm:px-2 cursor-pointer`}
        >
          <span className="w-5 sm:w-6 text-right tabular-nums text-stone-500">{r.rank}</span>
          <TeamChip team={r.team} active={isOpen} />
          <span className="flex-1 min-w-0 flex items-center text-stone-800">
            <span className="text-stone-400 mr-1 shrink-0" aria-hidden>{isOpen ? "▾" : "▸"}</span>
            <Name name={r.name} />
            {isWinner && <span className="ml-1 shrink-0 text-[8px] font-bold uppercase tracking-wider px-1 border border-amber-400 text-amber-700 bg-amber-50">MIP</span>}
            {withSeason && <span className="ml-1 shrink-0 text-[9px] tabular-nums text-stone-400">{r.season}</span>}
          </span>
          <span className="w-10 text-right tabular-nums font-bold text-stone-900">{pct(r.mip)}</span>
          <span className={`w-12 text-right tabular-nums ${overPg < 0 ? "text-red-600" : "text-stone-700"}`}>{signed(overPg, 2)}</span>
          <span className={`w-11 text-right tabular-nums ${over < 0 ? "text-red-600" : "text-stone-500"}`}>{signed(over)}</span>
        </div>
      </div>
      {isOpen && <Lines r={r} onGo={onGo} />}
    </div>
  );
}

// The Look Ahead's expanded row, with the season it grew from on top: last
// active season, this season's expected line, this season's actual. Games and
// VA lead so the gap the board ranks on is in the line itself. An actual
// cell turns green or red when it beats or trails expected by a tenth or more
// (turnovers count the other way).
function Lines({ r, onGo }) {
  const lines = [
    { key: "prev", label: `${yy(r.lastSeason)} ${r.lastTeam}`, g: r.lastG, va: r.lastVa, stats: r.lastLine, cls: "text-stone-400" },
    { key: "exp", label: `${yy(r.season)} expected`, g: r.projG, va: r.proj, stats: r.eLine, cls: "text-stone-500" },
    { key: "act", label: `${yy(r.season)} actual`, g: r.g, va: r.actual, stats: r.aLine, cls: "font-bold text-stone-900" },
  ];
  const tone = (k, e, a) => {
    if (e == null || a == null || Math.abs(a - e) < 0.1) return "";
    return (k === "TOV" ? a < e : a > e) ? "text-green-700" : "text-red-600";
  };
  return (
    <div className="px-2 sm:px-3 py-2 bg-stone-50 border-t border-stone-200">
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full text-[9px] tabular-nums">
          <thead>
            <tr className="text-stone-400 uppercase tracking-wider">
              <th className="text-left font-normal pr-1"></th>
              <th className="text-right font-normal px-1">G</th>
              <th className="text-right font-normal px-1">VA</th>
              {STAT_KEYS.map((k) => <th key={k} className="text-right font-normal px-1">{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className={l.cls}>
                <td className="text-left pr-1 whitespace-nowrap">{l.label}</td>
                <td className={`text-right px-1 ${l.key === "act" ? tone("G", r.projG, r.g) : ""}`}>{l.g}</td>
                <td className={`text-right px-1 ${l.key === "act" ? tone("VA", r.proj, r.actual) : ""}`}>{num(l.va)}</td>
                {l.stats.map((v, j) => (
                  <td key={j} className={`text-right px-1 ${l.key === "act" ? tone(STAT_KEYS[j], r.eLine[j], v) : ""}`}>{f1(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onGo && (
        <button
          type="button"
          onClick={() => onGo({ season: r.season, slug: r.slug, name: r.name, team: null, scope: "regular" })}
          className="mt-1.5 text-[9px] font-bold uppercase tracking-widest text-stone-400 hover:text-stone-900"
        >{r.season} leaderboard →</button>
      )}
    </div>
  );
}

function Method({ model }) {
  const [show, setShow] = useState(false);
  return (
    <div className="mb-4 border border-stone-300 bg-white">
      <button type="button" onClick={() => setShow((s) => !s)} className="w-full px-3 py-2 text-left text-[10px] uppercase tracking-[0.3em] text-stone-500 flex items-center gap-2">
        <span className="text-stone-400 text-[10px]">{show ? "▾" : "▸"}</span> How this works
      </button>
      {show && (
        <div className="px-3 pb-3 text-[10px] text-stone-600 leading-relaxed space-y-2">
          <p><span className="font-semibold text-stone-800">Expected.</span> The Look Ahead model’s projection from the summer before: the last three seasons’ per-minute rates and percentages, shrunk toward position and aged, plus projected minutes and games, placed on the roster the player actually played for. It’s priced against the previous season’s league, the way the Look Ahead backtest is. Actual is the season’s VA against that season’s league.</p>
          <p><span className="font-semibold text-stone-800">MIP %.</span> Each player’s chance of winning that season’s award, from one number: the per-game ratio (actual VA/G + {model.floor}) ÷ (expected VA/G + {model.floor}), put through a logistic model fit on all {model.backtest.seasons} winners. VA is measured against an average player, so most role players are expected at or below zero; the +{model.floor} floor keeps the ratio meaningful for them, and the model chose it. Going from 0 to 8 VA/G scores ×1.40 while a star going from 17 to 26 scores ×1.24, so a role player’s leap counts for more than a star’s. The ratio beat the total gain, the per-game gain, a blend of the two, and either gain with the player’s starting level beside it.</p>
          <p><span className="font-semibold text-stone-800">Who’s counted.</span> MIP % and Over/G rank players who played at least half as many games as that season’s leader in games played. Over ranks everyone. Rookies have no prior season and aren’t listed.</p>
          <p><span className="font-semibold text-stone-800">Blind spots.</span> The projection’s constants were fit on these same seasons, so it is a little kinder to the model than a true out-of-sample run. VA is box-score offense first, so a defensive leap (Dyson Daniels, 2024-25) ranks lower than it deserves, and a winner whose projection was already high (Julius Randle, 2020-21) is the model’s biggest miss.</p>
        </div>
      )}
    </div>
  );
}
