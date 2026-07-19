"use client";

import { useState, useMemo, useEffect } from "react";
import { lgaForSeason, ZONES, zoneShotValue } from "../scoring";
import { fetchJsonCached } from "../lib/fetch-cache";
import { normalizeName, teamColor } from "../lib/format";


// Data-browser tab for shot-distance zone splits (0-3/3-10/10-16/16ft-3PT):
// every player-season laid out as M/A (FG%) per zone plus that zone's
// points of value vs. this SEASON'S REGULAR-SEASON league zone FG% (the
// same era-fair, RS-baseline-for-both-RS-and-playoffs convention VA/VA+
// already use — see lgaForSeason). This is the granular "search shooting
// impact vs league average by distance" view the compare card's zone rows
// (under the 2-Pointers card) don't have room for. Sorted by total zone
// value; season list comes from whichever seasons have a baked
// shooting-<season>.json (basketball-reference has no shot-location data
// before 1996-97).
// Sums two /api/shooting player arrays' zone makes/attempts into one row per
// player, joined by slug then normalized name — mirrors /api/players'
// server-side "combined" scope (which already sums RS+PO zone fields via
// RAW_KEYS), just done client-side since this view fetches straight from
// /api/shooting rather than through /api/players.
export function combineZonePlayers(rsPlayers, poPlayers) {
  const byKey = new Map();
  const add = (p) => {
    const key = p.slug ? "s:" + p.slug : "n:" + normalizeName(p.name || "");
    let e = byKey.get(key);
    if (!e) {
      e = { slug: p.slug || null, name: p.name, team: p.team };
      for (const z of ZONES) e[z.key] = { fgm: 0, fga: 0 };
      byKey.set(key, e);
    }
    for (const z of ZONES) {
      e[z.key].fgm += p[z.key]?.fgm || 0;
      e[z.key].fga += p[z.key]?.fga || 0;
    }
  };
  (rsPlayers || []).forEach(add);
  (poPlayers || []).forEach(add);
  return [...byKey.values()];
}


export function ShotZonesView() {
  const [seasons, setSeasons] = useState([]);
  const [season, setSeason] = useState(null);
  const [scope, setScope] = useState("rs"); // "rs" | "po" | "combined"
  const [query, setQuery] = useState("");
  // Column sort: zone/total value columns are tappable; first tap sorts
  // descending by that column's value, second tap flips it.
  const [sort, setSort] = useState({ key: "total", dir: -1 });
  const [data, setData] = useState(null);
  const sel = season || seasons[0] || null;

  useEffect(() => {
    let cancelled = false;
    fetchJsonCached("/api/shooting")
      .then((d) => { if (!cancelled) setSeasons([...(d.seasons || [])].sort().reverse()); })
      .catch(() => { if (!cancelled) setSeasons([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!sel) return;
    let cancelled = false;
    setData(null);
    fetchJsonCached(`/api/shooting?season=${sel}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData({}); });
    return () => { cancelled = true; };
  }, [sel]);

  const lga = sel ? lgaForSeason(sel) : null;
  const list = useMemo(() => {
    const rows = scope === "combined"
      ? (data?.rs || data?.po ? combineZonePlayers(data?.rs?.players, data?.po?.players) : null)
      : data?.[scope]?.players;
    if (!rows || !lga?.zoneFG) return null;
    const q = normalizeName(query.trim());
    // Without a search, keep to volume-qualified samples (total 2-point
    // attempts across all 4 zones) so noise doesn't crowd the top.
    const minAtt = scope === "po" ? 20 : 50;
    const out = [];
    for (const r of rows) {
      // /api/shooting serves the bake's raw per-zone shape ({fgm,fga} nested
      // under each zone key) — NOT the flattened z03m/z03a fields /api/players
      // merges onto its rows. Read r[z.key].fgm/.fga here, not r[z.mKey]/[z.aKey].
      const totalAtt = ZONES.reduce((s, z) => s + (r[z.key]?.fga || 0), 0);
      if (q ? !normalizeName(r.name || "").includes(q) : totalAtt < minAtt) continue;
      const zones = ZONES.map((z) => {
        const m = r[z.key]?.fgm || 0, att = r[z.key]?.fga || 0;
        return { z, m, att, pct: att > 0 ? m / att : 0, val: zoneShotValue(m, att, lga.zoneFG[z.key]) };
      });
      const total = zones.reduce((s, x) => s + x.val, 0);
      out.push({ r, zones, total });
    }
    const val = (x) => (
      sort.key === "name" ? (x.r.name || "")
      : sort.key === "total" ? x.total
      : x.zones.find((z) => z.z.key === sort.key)?.val ?? 0
    );
    out.sort((a, b) => {
      const av = val(a), bv = val(b);
      const c = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return c !== 0 ? sort.dir * c : b.total - a.total;
    });
    return out;
  }, [data, scope, lga, query, sort]);

  const sgn1 = (v) => (v > 0 ? "+" : "") + v.toFixed(1);
  const cols = "grid grid-cols-[1.4rem_minmax(0,1fr)_2.6rem_2.6rem_2.6rem_2.6rem_2.8rem] gap-x-1 items-center";

  return (
    <div className="text-[10px]">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <select
          value={sel || ""}
          onChange={(e) => { setSeason(e.target.value); }}
          className="text-[10px] bg-white border border-stone-300 px-1.5 py-1"
        >
          {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
          <button onClick={() => setScope("combined")} className={`px-1.5 py-0.5 ${scope === "combined" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Combined</button>
          <button onClick={() => setScope("rs")} className={`px-1.5 py-0.5 border-l border-stone-300 ${scope === "rs" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Regular</button>
          <button onClick={() => setScope("po")} className={`px-1.5 py-0.5 border-l border-stone-300 ${scope === "po" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Playoffs</button>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="flex-1 min-w-[6rem] text-[10px] text-stone-900 bg-white border border-stone-300 px-2 py-1"
        />
      </div>
      {!seasons.length && (
        <div className="py-4 text-center text-stone-400 italic">
          No shooting splits baked yet — basketball-reference only has shot-location data from 1996-97 on.
        </div>
      )}
      {seasons.length > 0 && (
        <>
          <div className="text-[9px] text-stone-400 mb-1.5">
            Each zone shows M/A (FG%) and that zone's points of value vs. {sel}'s league FG% at that distance (regular-season baseline, same as the rest of VA) · Total sums the 4 zones
          </div>
          {(() => {
            const H = ({ k, label, right = true, natural = -1 }) => (
              <button
                type="button"
                onClick={() => setSort((p) => ({ key: k, dir: p.key === k ? -p.dir : natural }))}
                className={`${right ? "text-right" : "text-left"} uppercase tracking-wider cursor-pointer hover:text-stone-900 ${sort.key === k ? "text-stone-900 font-semibold" : ""}`}
                aria-pressed={sort.key === k}
              >
                {label}{sort.key === k ? (sort.dir < 0 ? "▾" : "▴") : ""}
              </button>
            );
            return (
              <div className={`${cols} text-[8px] uppercase tracking-wider text-stone-400 border-b border-stone-300 pb-0.5`}>
                <span>#</span><H k="name" label="Player" right={false} natural={1} />
                {ZONES.map((z) => <H key={z.key} k={z.key} label={z.label} />)}
                <H k="total" label="Total" />
              </div>
            );
          })()}
          {!list && <div className="py-4 text-center text-stone-400 italic">Loading…</div>}
          {list && list.length === 0 && <div className="py-4 text-center text-stone-400 italic">No players match.</div>}
          {list && list.map(({ r, zones, total }, i) => (
            <div key={(r.slug || r.name) + (r.team || "")} className={`${cols} py-[3px] border-b border-stone-100 last:border-0 ${i % 2 ? "bg-stone-50" : ""}`}>
              <span className="text-stone-400 tabular-nums">{i + 1}</span>
              <span className="truncate font-semibold" style={{ color: teamColor(r.team) }}>
                {r.name} <span className="text-stone-400 font-normal text-[8px]">{r.team}</span>
              </span>
              {zones.map(({ z, m, att, pct, val }) => (
                <span key={z.key} className="text-right leading-tight">
                  <span className="block tabular-nums text-stone-500 text-[8px]">{m}/{att} ({(pct * 100).toFixed(0)}%)</span>
                  <span className={`block tabular-nums font-semibold ${val < 0 ? "text-red-600" : "text-stone-900"}`}>{sgn1(val)}</span>
                </span>
              ))}
              <span className={`text-right tabular-nums font-bold ${total < 0 ? "text-red-600" : "text-stone-900"}`}>{sgn1(total)}</span>
            </div>
          ))}
          {list && list.length > 0 && (
            <div className="mt-2 text-center text-[9px] italic text-stone-400">
              {query.trim() === "" ? `Min ${scope === "po" ? 20 : 50} 2-point attempts · search to include everyone · ` : ""}tap a column to sort by its zone value
            </div>
          )}
        </>
      )}
    </div>
  );
}
