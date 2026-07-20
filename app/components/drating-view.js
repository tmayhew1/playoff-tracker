"use client";

import { useState, useMemo, useEffect } from "react";
import { lgaForSeason } from "../scoring";
import { defVAInfo, useDefRatings } from "../lib/defense";
import { fetchJsonCached } from "../lib/fetch-cache";
import { normalizeName, teamColor } from "../lib/format";


// Data-browser tab for the D-Rating / VA+ decomposition: every player-season
// laid out as DRTG · team DRTG · team-share w · the two net terms · dVA/G, so
// the composite is inspectable without tooltips (useless on touch). IND is
// the player's per-100 edge over his own team's defense; TM+ is his
// stock-rate share of the team's edge vs the league line; NET/G applies
// IND+TM+ over his possessions. Rows sort by dVA per game.
export function DRatingView() {
  const defs = useDefRatings();
  const seasons = useMemo(() => Object.keys(defs || {}).sort().reverse(), [defs]);
  const [season, setSeason] = useState(null);
  const [scope, setScope] = useState("rs"); // "rs" | "po"
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState(null);
  // Column sort: every numeric column is tappable; first tap uses the
  // column's natural direction (DRTG/TEAM ascending — lower is better —
  // everything else descending), second tap flips it.
  const [sort, setSort] = useState({ key: "perG", dir: -1 });
  // Min-minutes filter, same two-step arming as the leaderboards' G filter:
  // tap the MP header to arm, then a row's MP to keep only players with at
  // least that many minutes (replacing the default rotation floor). Tap the
  // active value again — or the chip — to clear.
  const [minMpFilter, setMinMpFilter] = useState(null);
  const [mpArmed, setMpArmed] = useState(false);
  const sel = season || seasons[0] || null;

  useEffect(() => {
    if (!sel) return;
    let cancelled = false;
    setRows(null);
    setMinMpFilter(null);
    setMpArmed(false);
    fetchJsonCached(scope === "po" ? `/api/leaderboard?season=${sel}` : `/api/regular-season?season=${sel}`)
      .then((d) => { if (!cancelled) setRows(d.players || []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [sel, scope]);

  const lga = sel ? lgaForSeason(sel) : null;
  const list = useMemo(() => {
    if (!rows || !defs || !sel || !lga) return null;
    const q = normalizeName(query.trim());
    // Without a search, keep to rotation-sized samples so noise doesn't
    // crowd the top; a search shows anyone.
    // A user-set min-MP filter replaces the default rotation floor and
    // applies even during a search.
    const minMp = minMpFilter ?? (scope === "po" ? 40 : 100);
    const out = [];
    for (const r of rows) {
      if (!(r.mp > 0)) continue;
      if (q && !normalizeName(r.name || "").includes(q)) continue;
      if (minMpFilter != null ? r.mp < minMpFilter : (!q && r.mp < minMp)) continue;
      const info = defVAInfo(r, r.mp, lga, defs, sel, scope);
      if (!info) continue;
      const gp = r.gp ?? r.g ?? 0;
      // IND and TM+ are the two halves of the defensive net, natively per
      // 100 possessions. `factor` rescales a per-100 rate into points per
      // game (the possessions the player logged, ÷ games), so the two
      // columns land in D/G's units and literally sum to it.
      const factor = gp > 0 ? (lga.laPOSSperM * r.mp) / (100 * gp) : 0;
      out.push({
        r, gp, info,
        indG: info.teamDrtg != null ? (info.teamDrtg - info.drtg) * factor : null,
        tmpG: info.teamDrtg != null ? info.w * (info.laDRtg - info.teamDrtg) * factor : null,
        perG: gp > 0 ? info.dva / gp : 0,
      });
    }
    const val = (x) => (
      sort.key === "name" ? (x.r.name || "")
      : sort.key === "drtg" ? x.info.drtg
      : sort.key === "team" ? x.info.teamDrtg
      : sort.key === "ind" ? x.indG
      : sort.key === "tmp" ? x.tmpG
      : x.perG
    );
    out.sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av == null && bv == null) return b.perG - a.perG;
      if (av == null) return 1; // traded/no-context rows sink regardless of direction
      if (bv == null) return -1;
      const c = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return c !== 0 ? sort.dir * c : b.perG - a.perG;
    });
    return out;
  }, [rows, defs, sel, lga, query, scope, sort, minMpFilter]);

  const sgn2 = (v) => (v > 0 ? "+" : "") + v.toFixed(2);
  const cols = "grid grid-cols-[1.5rem_minmax(0,1fr)_2.4rem_2.2rem_2.2rem_2.6rem_2.6rem_2.6rem] gap-x-1 items-center";

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
          <button onClick={() => setScope("rs")} className={`px-1.5 py-0.5 ${scope === "rs" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Regular</button>
          <button onClick={() => setScope("po")} className={`px-1.5 py-0.5 border-l border-stone-300 ${scope === "po" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Playoffs</button>
        </div>
        {minMpFilter != null && (
          <button
            onClick={() => setMinMpFilter(null)}
            className="text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1 whitespace-nowrap bg-stone-100 text-stone-700 border-stone-300"
            aria-label="Clear min-minutes filter"
          >
            ≥{minMpFilter} min <span className="text-stone-400">×</span>
          </button>
        )}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="flex-1 min-w-[6rem] text-[10px] text-stone-900 bg-white border border-stone-300 px-2 py-1"
        />
      </div>
      {lga && (
        <div className="text-[9px] text-stone-400 mb-1.5">
          League line <span className="tabular-nums text-stone-600">{(lga.laPTSperPoss * 100).toFixed(1)}</span> ·
          DRTG = box-score estimate (prior, ≈1500 poss) updated by on-court play-by-play as possessions accrue (2000-01+; earlier seasons all-estimate) ·
          IND = player's edge over his own team's D · TM+ = his stock-rate share of the team's edge vs the league line ·
          both as points/game, so IND + TM+ = D/G · “–” = no single-team context (traded)
        </div>
      )}
      {(() => {
        const NATURAL = { name: 1, drtg: 1, team: 1, ind: -1, tmp: -1, perG: -1 };
        const H = ({ k, label, right = true }) => (
          <button
            type="button"
            onClick={() => setSort((p) => ({ key: k, dir: p.key === k ? -p.dir : NATURAL[k] }))}
            className={`${right ? "text-right" : "text-left"} uppercase tracking-wider cursor-pointer hover:text-stone-900 ${sort.key === k ? "text-stone-900 font-semibold" : ""}`}
            aria-pressed={sort.key === k}
          >
            {label}{sort.key === k ? (sort.dir < 0 ? "▾" : "▴") : ""}
          </button>
        );
        return (
          <div className={`${cols} text-[8px] uppercase tracking-wider text-stone-400 border-b border-stone-300 pb-0.5`}>
            <span>#</span><H k="name" label="Player" right={false} />
            {/* MP header arms the min-minutes filter (two-step, like the
                leaderboards' G column) instead of sorting; a second tap
                disarms. */}
            <button
              type="button"
              onClick={() => setMpArmed((v) => !v)}
              className={`text-right uppercase tracking-wider cursor-pointer hover:text-stone-900 ${mpArmed ? "text-stone-900 font-bold underline" : ""}`}
              title="Tap, then tap a player's MP to filter to at least that many minutes"
              aria-pressed={mpArmed}
            >
              MP
            </button>
            <H k="drtg" label="DRTG" /><H k="team" label="Team" />
            <H k="ind" label="IND" /><H k="tmp" label="TM+" />
            <H k="perG" label="D/G" />
          </div>
        );
      })()}
      {!list && <div className="py-4 text-center text-stone-400 italic">Loading…</div>}
      {list && list.length === 0 && <div className="py-4 text-center text-stone-400 italic">No players match.</div>}
      {list && list.map(({ r, info, indG, tmpG, perG }, i) => (
        <div key={(r.slug || r.name) + (r.team || "")} className={`${cols} py-[2px] border-b border-stone-100 last:border-0 ${i % 2 ? "bg-stone-50" : ""}`}>
          <span className="text-stone-400 tabular-nums">{i + 1}</span>
          <span className="truncate font-semibold" style={{ color: teamColor(r.team) }}>
            {r.name} <span className="text-stone-400 font-normal text-[8px]">{r.team}</span>
          </span>
          {(() => {
            const mpVal = Math.round(r.mp);
            const isActive = minMpFilter === mpVal;
            return (
              <button
                type="button"
                onClick={() => {
                  // Unarmed tap on an inactive MP is a mis-tap: do nothing
                  // (rows here have no drill-in to fall through to).
                  if (!mpArmed && !isActive) return;
                  setMinMpFilter(isActive ? null : mpVal);
                  setMpArmed(false);
                }}
                className={`text-right tabular-nums ${mpArmed || isActive ? "cursor-pointer hover:text-stone-900 hover:underline" : "cursor-default"} ${isActive ? "font-semibold text-stone-900" : mpArmed ? "text-stone-700 underline decoration-dotted" : "text-stone-500"}`}
                aria-label={mpArmed ? `Filter to players with at least ${mpVal} minutes` : `${mpVal} minutes (tap the MP header to enable filtering)`}
              >{mpVal}</button>
            );
          })()}
          <span className="text-right tabular-nums text-stone-700">{Math.round(info.drtg)}</span>
          <span className="text-right tabular-nums text-stone-500">{info.teamDrtg != null ? info.teamDrtg.toFixed(1) : "–"}</span>
          <span className={`text-right tabular-nums ${indG != null && indG < 0 ? "text-red-600" : "text-stone-700"}`}>{indG != null ? sgn2(indG) : "–"}</span>
          <span className={`text-right tabular-nums ${tmpG != null && tmpG < 0 ? "text-red-600" : "text-stone-700"}`}>{tmpG != null ? sgn2(tmpG) : "–"}</span>
          <span className={`text-right tabular-nums font-semibold ${perG < 0 ? "text-red-600" : "text-stone-900"}`}>{sgn2(perG)}</span>
        </div>
      ))}
      {list && list.length > 0 && (
        <div className="mt-2 text-center text-[9px] italic text-stone-400">
          {minMpFilter != null
            ? `Min ${minMpFilter} minutes · `
            : query.trim() === "" ? `Min ${scope === "po" ? 40 : 100} minutes · search to include everyone · ` : ""}
          tap a column to sort · tap MP, then a player&rsquo;s MP, to filter by minutes
        </div>
      )}
    </div>
  );
}
