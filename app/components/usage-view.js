"use client";

import { useState, useMemo, useEffect } from "react";
import { USAGE_MODELS, USG_FTA_W, lgaForSeason, possUsed, usageModelFor, volumeVA } from "../scoring";
import { fetchJsonCached } from "../lib/fetch-cache";
import { normalizeName, teamColor } from "../lib/format";


// Data-browser tab for the USG-ADJ scoring baseline (spec §4.6): every
// player-season laid out as the two baselines and what each pays, so the
// switch on the Explore boards is inspectable rather than something the
// numbers just do.
//
//   PTS/M  what he actually scored per minute
//   PRED   what the season's fitted line predicts at HIS usage — a + b·(USG/MP)
//   VA     the scoring-volume category on the standard baseline, (PTS/M − μ_PTS)·MP
//   USG    the same category on the fitted line, PTS − (a·MP + b·USG)
//   Δ      USG − VA, which is exactly what flipping the switch moves his total by
//
// PTS/M and PRED are per-minute by construction; the three point columns
// follow the TOT ⁄ per-game switch. The nine other categories are identical
// in both modes, so Δ here IS the whole difference between a player's two VA
// totals — this table explains the entire gap between the two boards.
export function UsageView() {
  // Only seasons with a fitted model (data/usage-model.json). A season the
  // fit hasn't reached has no second baseline to compare against, so it isn't
  // offered rather than shown against μ_PTS twice.
  const seasons = useMemo(() => Object.keys(USAGE_MODELS).sort().reverse(), []);
  const [season, setSeason] = useState(null);
  const [scope, setScope] = useState("rs"); // "rs" | "po"
  const [perGame, setPerGame] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState(null);
  // Column sort: every column is tappable; first tap uses the column's
  // natural direction (name ascending, everything else descending), second
  // tap flips it. Δ opens the tab because "who does this switch move, and
  // which way" is the question the table exists to answer.
  const [sort, setSort] = useState({ key: "delta", dir: 1 });
  // Min-minutes filter, same two-step arming as the D Rating tab: tap the MP
  // header to arm, then a row's MP to keep only players with at least that
  // many minutes.
  const [minMpFilter, setMinMpFilter] = useState(null);
  const [mpArmed, setMpArmed] = useState(false);
  const sel = season || seasons[0] || null;

  useEffect(() => {
    if (!sel) return;
    let cancelled = false;
    setRows(null);
    setMinMpFilter(null);
    setMpArmed(false);
    // The same two bakes the other tabs read, so this costs nothing extra
    // once either has been visited (fetchJsonCached shares the payload).
    fetchJsonCached(scope === "po" ? `/api/leaderboard?season=${sel}` : `/api/regular-season?season=${sel}`)
      .then((d) => { if (!cancelled) setRows(d.players || []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [sel, scope]);

  const lga = sel ? lgaForSeason(sel) : null;
  const lgaUsg = sel ? lgaForSeason(sel, true) : null;
  const model = sel ? usageModelFor(sel) : null;

  const list = useMemo(() => {
    if (!rows || !lga || !lgaUsg?.usgModel) return null;
    const q = normalizeName(query.trim());
    // Without a search, keep to rotation-sized samples so noise doesn't crowd
    // the top; a search shows anyone. A user-set filter replaces the floor.
    const minMp = minMpFilter ?? (scope === "po" ? 40 : 100);
    const out = [];
    for (const r of rows) {
      if (!(r.mp > 0)) continue;
      if (q && !normalizeName(r.name || "").includes(q)) continue;
      if (minMpFilter != null ? r.mp < minMpFilter : (!q && r.mp < minMp)) continue;
      const gp = r.gp ?? r.g ?? 0;
      const usgPerM = possUsed(r) / r.mp;
      // Both baselines through the one shared definition (scoring.js), so a
      // row here can never disagree with the same player's card.
      const va = volumeVA(r, lga);
      const usgVa = volumeVA(r, lgaUsg);
      out.push({
        r, gp, usgPerM,
        ptsPerM: (r.pts || 0) / r.mp,
        pred: lgaUsg.usgModel.a + lgaUsg.usgModel.b * usgPerM,
        va, usgVa, delta: usgVa - va,
      });
    }
    // The three point columns sort on the scale they are DISPLAYED at, so
    // switching to /G re-orders them rather than leaving per-game numbers
    // ordered by season totals.
    const scaled = (v, gp) => (perGame ? (gp > 0 ? v / gp : 0) : v);
    const val = (x) => (
      sort.key === "name" ? (x.r.name || "")
      : sort.key === "ptsPerM" ? x.ptsPerM
      : sort.key === "pred" ? x.pred
      : sort.key === "va" ? scaled(x.va, x.gp)
      : sort.key === "usgVa" ? scaled(x.usgVa, x.gp)
      : scaled(x.delta, x.gp)
    );
    out.sort((a, b) => {
      const av = val(a), bv = val(b);
      const c = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return c !== 0 ? sort.dir * c : scaled(b.usgVa, b.gp) - scaled(a.usgVa, a.gp);
    });
    return out;
  }, [rows, lga, lgaUsg, query, scope, sort, minMpFilter, perGame]);

  // The three point columns share one scale: totals, or divided by games.
  const pts = (v, gp) => (perGame ? (gp > 0 ? v / gp : 0) : v);
  const sgn = (v) => (v > 0 ? "+" : "") + v.toFixed(perGame ? 2 : 1);
  const cols = "grid grid-cols-[1.4rem_minmax(0,1fr)_2.1rem_2.3rem_2.3rem_2.9rem_2.9rem_2.7rem] gap-x-1 items-center";

  return (
    <div className="text-[10px]">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <select
          value={sel || ""}
          onChange={(e) => setSeason(e.target.value)}
          className="text-[10px] bg-white border border-stone-300 px-1.5 py-1"
        >
          {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
          <button onClick={() => setScope("rs")} className={`px-1.5 py-0.5 ${scope === "rs" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Regular</button>
          <button onClick={() => setScope("po")} className={`px-1.5 py-0.5 border-l border-stone-300 ${scope === "po" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Playoffs</button>
        </div>
        <div className="inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
          <button onClick={() => setPerGame(false)} className={`px-1.5 py-0.5 ${!perGame ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Tot</button>
          <button onClick={() => setPerGame(true)} className={`px-1.5 py-0.5 border-l border-stone-300 ${perGame ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>/G</button>
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
      {model && lga && (
        <div className="text-[9px] text-stone-400 mb-1.5">
          {sel} line <span className="tabular-nums text-stone-600">
            PTS/min ≈ {model.b.toFixed(3)} × (poss. used/min) {model.a >= 0 ? "+" : "−"} {Math.abs(model.a).toFixed(3)}
          </span> (R² <span className="tabular-nums text-stone-600">{model.r2.toFixed(2)}</span>,
          fit on {model.n} player-seasons) · poss. used = FGA + {USG_FTA_W} × FTA ·
          PRED = that line at this player&apos;s own usage, against the flat median
          {" "}<span className="tabular-nums text-stone-600">{lga.laPTSperM.toFixed(3)}</span> PTS/min ·
          VA = scoring volume on the median baseline, USG = the same on the fitted line,
          Δ = USG − VA, which is exactly what the USG-ADJ switch moves this player&apos;s
          total VA by (the other nine categories don&apos;t change)
          {scope === "po" && " · playoff rows are scored against the season's regular-season line, as all VA baselines are"}
        </div>
      )}
      {(() => {
        const NATURAL = { name: 1, ptsPerM: -1, pred: -1, va: -1, usgVa: -1, delta: -1 };
        const H = ({ k, label, right = true, title }) => (
          <button
            type="button"
            onClick={() => setSort((p) => ({ key: k, dir: p.key === k ? -p.dir : NATURAL[k] }))}
            className={`${right ? "text-right" : "text-left"} uppercase tracking-wider cursor-pointer hover:text-stone-900 ${sort.key === k ? "text-stone-900 font-semibold" : ""}`}
            aria-pressed={sort.key === k}
            title={title}
          >
            {label}{sort.key === k ? (sort.dir < 0 ? "▾" : "▴") : ""}
          </button>
        );
        return (
          <div className={`${cols} text-[8px] uppercase tracking-wider text-stone-400 border-b border-stone-300 pb-0.5`}>
            <span>#</span><H k="name" label="Player" right={false} />
            {/* MP header arms the min-minutes filter (two-step, like the
                D Rating tab) rather than sorting; a second tap disarms.
                Sorting by minutes stays available through the /G switch's
                own ordering of the point columns. */}
            <button
              type="button"
              onClick={() => setMpArmed((v) => !v)}
              className={`text-right uppercase tracking-wider cursor-pointer hover:text-stone-900 ${mpArmed ? "text-stone-900 font-bold underline" : ""}`}
              title="Tap, then tap a player's MP to filter to at least that many minutes"
              aria-pressed={mpArmed}
            >
              MP
            </button>
            <H k="ptsPerM" label="PTS/M" title="Points per minute" />
            <H k="pred" label="Pred" title="Points per minute the season's line predicts at this player's usage" />
            <H k="va" label="VA" title="Scoring volume against the league's median minute" />
            <H k="usgVa" label="USG" title="Scoring volume against the fitted line at his own usage" />
            <H k="delta" label="Δ" title="USG − VA: what the switch moves his total by" />
          </div>
        );
      })()}
      {!list && <div className="py-4 text-center text-stone-400 italic">Loading…</div>}
      {list && list.length === 0 && <div className="py-4 text-center text-stone-400 italic">No players match.</div>}
      {list && list.map(({ r, gp, ptsPerM, pred, usgPerM, va, usgVa, delta }, i) => (
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
          <span className="text-right tabular-nums text-stone-700">{ptsPerM.toFixed(3)}</span>
          {/* The usage this prediction was read off, on the cell it produced —
              the model's one input, and the reason two players with the same
              PTS/min can carry different baselines. */}
          <span
            className="text-right tabular-nums text-stone-500"
            title={`${usgPerM.toFixed(3)} possessions used per minute`}
          >{pred.toFixed(3)}</span>
          <span className={`text-right tabular-nums ${va < 0 ? "text-red-600" : "text-stone-700"}`}>{sgn(pts(va, gp))}</span>
          <span className={`text-right tabular-nums ${usgVa < 0 ? "text-red-600" : "text-stone-700"}`}>{sgn(pts(usgVa, gp))}</span>
          <span className={`text-right tabular-nums font-semibold ${delta < 0 ? "text-red-600" : "text-stone-900"}`}>{sgn(pts(delta, gp))}</span>
        </div>
      ))}
      {list && list.length > 0 && (
        <div className="mt-2 text-center text-[9px] italic text-stone-400">
          {minMpFilter != null
            ? `Min ${minMpFilter} minutes · `
            : query.trim() === "" ? `Min ${scope === "po" ? 40 : 100} minutes · search to include everyone · ` : ""}
          {perGame ? "per game" : "season totals"} · tap a column to sort · tap MP, then a player&rsquo;s MP, to filter by minutes
        </div>
      )}
    </div>
  );
}
