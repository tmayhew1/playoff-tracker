"use client";

import { useState, useMemo, useEffect } from "react";
import { VACategoryBreakdown } from "./va-breakdown";
import { normalizeName } from "../lib/format";


export function CollegeView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortMode, setSortMode] = useState("va"); // "va" | "vaPerG"
  const [query, setQuery] = useState("");             // player-name search
  const [teamFilter, setTeamFilter] = useState(null); // exact-school filter (set by tapping a team)
  const [expanded, setExpanded] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/college")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message || "Load failed"); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const q = query.trim();
  const shown = useMemo(() => {
    if (!data?.players) return [];
    const metric = (p) => (sortMode === "vaPerG" ? p.vaPerG : p.va) ?? 0;
    let list = data.players;
    if (teamFilter) {
      list = list.filter((p) => p.school === teamFilter);
    } else if (q) {
      const qn = normalizeName(q);
      list = list.filter((p) => normalizeName(p.name).includes(qn));
    }
    list = [...list].sort((a, b) => metric(b) - metric(a));
    return (teamFilter || q) ? list : list.slice(0, 100); // full roster/results when filtering; else top 100
  }, [data, q, teamFilter, sortMode]);

  if (loading) return <div className="text-[10px] text-stone-500 italic py-6 text-center">Loading college players…</div>;
  if (error) return <div className="text-[10px] text-red-600 py-6 text-center px-2 break-words">Couldn’t load — {error}</div>;
  if (!data || data.missing || !(data.players && data.players.length)) {
    return (
      <div className="p-3 bg-white border border-stone-300 text-sm text-stone-600 leading-relaxed">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 mb-2">Top College Players</h2>
        College data hasn’t been baked yet. Run the <span className="font-semibold">“Bake college players”</span> workflow from the Actions tab to populate the 2025-26 men’s D-I leaders by Value Added.
      </div>
    );
  }

  const metricVal = (p) => (sortMode === "vaPerG" ? p.vaPerG : p.va) ?? 0;
  const maxMetric = Math.max(...shown.map(metricVal), 0.1);

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-base font-bold text-stone-900">Top College Players</h2>
        <div className="text-[10px] uppercase tracking-widest text-stone-500 mt-0.5">
          {data.season} men’s D-I{data.playerPool ? ` · ${data.playerPool.toLocaleString()} players` : ""}
        </div>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setTeamFilter(null); setExpanded(null); }}
        placeholder="Search a player…"
        className="w-full text-sm text-stone-900 bg-white border border-stone-300 px-3 py-2 mb-2"
      />
      {teamFilter && (
        <div className="flex items-center gap-2 mb-2 px-2">
          <span className="text-[10px] uppercase tracking-widest text-stone-400">Team</span>
          <span className="text-sm font-semibold text-stone-800">{teamFilter}</span>
          <span className="text-[10px] text-stone-400 tabular-nums">· {shown.length}</span>
          <button onClick={() => setTeamFilter(null)} className="ml-auto text-[10px] uppercase tracking-widest text-stone-400 hover:text-stone-700">✕ Clear</button>
        </div>
      )}
      {q && !teamFilter && (
        <div className="text-[10px] text-stone-400 tabular-nums mb-1 px-2">{shown.length} {shown.length === 1 ? "player" : "players"}</div>
      )}

      {/* Tap VA or VA/G to sort by that column; the caret marks the active sort. */}
      <div className="grid grid-cols-[1.5rem_1fr_2.5rem_3rem_3rem] gap-x-2 items-center text-[10px] uppercase tracking-wider text-stone-400 px-2 pb-1 border-b border-stone-200">
        <span></span><span>Player</span><span className="text-right">G</span>
        <button onClick={() => setSortMode("va")} className={`text-right uppercase tracking-wider ${sortMode === "va" ? "text-stone-900 font-bold" : "text-stone-400 hover:text-stone-600"}`}>VA{sortMode === "va" ? " ▾" : ""}</button>
        <button onClick={() => setSortMode("vaPerG")} className={`text-right uppercase tracking-wider ${sortMode === "vaPerG" ? "text-stone-900 font-bold" : "text-stone-400 hover:text-stone-600"}`}>VA/G{sortMode === "vaPerG" ? " ▾" : ""}</button>
      </div>

      {shown.length === 0 && (
        <div className="text-[10px] text-stone-400 italic py-6 text-center">No players match “{q}”.</div>
      )}

      {shown.map((p, i) => {
        const key = p.slug || p.name;
        const open = expanded === key;
        const pct = (metricVal(p) / maxMetric) * 100;
        return (
          <div key={key} className="border-b border-stone-100">
            <div
              onClick={() => setExpanded(open ? null : key)}
              className="grid grid-cols-[1.5rem_1fr_2.5rem_3rem_3rem] gap-x-2 items-center px-2 pt-1.5 text-sm cursor-pointer hover:bg-stone-50"
            >
              <span className="text-[10px] tabular-nums text-stone-400">{i + 1}</span>
              <span className="min-w-0">
                <span className="font-semibold text-stone-800 block truncate">{p.name}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setTeamFilter(p.school); setQuery(""); setExpanded(null); }}
                  className="text-[10px] text-stone-500 hover:text-stone-900 hover:underline"
                >{p.school}</button>
              </span>
              <span className="text-right tabular-nums text-stone-600">{p.gp ?? 0}</span>
              <span className={`text-right tabular-nums font-bold ${sortMode === "va" ? "text-stone-900" : "text-stone-500"} ${p.va < 0 ? "text-red-600" : ""}`}>{(p.va ?? 0).toFixed(1)}</span>
              <span className={`text-right tabular-nums ${sortMode === "vaPerG" ? "text-stone-900 font-bold" : "text-stone-500"}`}>{(p.vaPerG ?? 0).toFixed(1)}</span>
            </div>
            <div className="px-2 pt-1 pb-1.5">
              <div className="h-1 bg-stone-100 rounded-sm overflow-hidden">
                <div className="h-full rounded-sm" style={{ width: `${Math.max(0, pct)}%`, background: metricVal(p) < 0 ? "#dc2626" : "#1c1917" }} />
              </div>
            </div>
            {open && <VACategoryBreakdown player={p} lga={data.leagueAverages} />}
          </div>
        );
      })}

      <div className="text-[10px] text-stone-400 italic mt-2">Source: College Sports Reference. Tap a player for the per-stat breakdown; tap a team name to see its roster.</div>
    </div>
  );
}
