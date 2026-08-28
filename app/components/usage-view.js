"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { USAGE_MODELS, USG_FTA_W, VOLUME_CREDIT, cappedVolumeVA, fittedLineLga, lgaForSeason, possUsed, splitVolumeVA, usageModelFor, usageSplit, volumeVA } from "../scoring";
import { fetchJsonCached } from "../lib/fetch-cache";
import { MIDNIGHT_PURPLE, normalizeName, teamColor } from "../lib/format";


// Data-browser tab for the USG-ADJ scoring baseline (spec §4.6): every
// player-season laid out as the two baselines and what each pays, so the
// switch on the Explore boards is inspectable rather than something the
// numbers just do.
//
//   PTS/M  what he actually scored per minute
//   PRED   what the season's fitted line predicts at HIS usage — a + b·(USG/MP)
//   VA     the scoring-volume category on the standard baseline, (PTS/M − μ_PTS)·MP
//   USG    the same category on the fitted line, PTS − (a·MP + b·USG)
//   CAP    the same on the capped baseline min(PRED, μ_PTS) — the candidate
//          under review (scoring.js::cappedVolumeVA), wired to nothing else
//   Δ      the active alternative minus VA: what adopting it would move this
//          player's total VA by
//
// PTS/M and PRED are per-minute by construction; the point columns follow the
// TOT ⁄ per-game switch. The nine other categories are identical under all
// three baselines, so Δ here IS the whole difference between a player's VA
// totals — this table accounts for the entire gap between the boards.
//
// CAP ≥ max(VA, USG) is not a coincidence but the identity in scoring.js:
// capping the baseline means taking whichever of the two terms is larger, so
// the column can only ever sit at or above the other two.
// --- The cloud the line is fit to -------------------------------------------
// PTS/min against possessions used/min, one dot per player-season, with all
// three candidate baselines drawn over it:
//
//   median  a horizontal line at μ_PTS — what VA charges today, the same for
//           everyone regardless of how much of the offense he used
//   fitted  the season's least-squares line, a + b·x — what USG-ADJ charges
//   cap     min(fitted, median): the fitted line up to the crossing, the flat
//           median after it. Drawn thick and underneath, so it reads as a
//           halo along whichever branch is live.
//
// The three coincide except in the shaded region left of the crossing, which
// is the whole of what the capped candidate changes — a player is inside it or
// the cap does nothing for him.
//
// A dot's vertical distance from a line IS its scoring-volume VA per minute
// against that baseline, so "above the line" and "positive Points VA" are the
// same statement, and the gap between the two lines under a dot is its Δ.
// A little taller than wide-screen habit would suggest: a regression cloud
// needs vertical room for "above or below the line" to be readable at a glance.
const DOT_R = 0.7, TAP_R = 3.4, PLOT_H = 70;
// Amber-600 rather than the shared GOLD (amber-500): this is a thin line and
// 7px type on white, where amber-500 is too pale to read.
const CAP_LINE = "#d97706";

function UsageScatter({ rows, model, mu, lambda, selected, onSelect, seasonLabel, scopeLabel }) {
  const svgRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const [hover, setHover] = useState(null);

  const view = useMemo(() => {
    if (!rows.length || !model) return null;
    const xMax = Math.max(...rows.map((r) => r.usgPerM)) * 1.06;
    const yMax = Math.max(...rows.map((r) => r.ptsPerM)) * 1.06;
    // Both axes start at zero: the intercept is a real quantity here (what the
    // line charges a player who uses nothing), and the origin is what makes
    // the slope readable as points per possession used.
    const X = (v) => (v / xMax) * 100;
    const Y = (v) => PLOT_H - (v / yMax) * PLOT_H;
    const dots = rows.map((r) => ({ r, cx: X(r.usgPerM), cy: Y(r.ptsPerM) }));
    // Where the fitted line crosses the median — the kink in the capped
    // baseline, and the usage above which the cap does nothing at all.
    const xStar = model.b !== 0 ? (mu - model.a) / model.b : null;
    const inRange = xStar != null && xStar > 0 && xStar < xMax;
    // The λ family: one line pivoting about the median-minute point (ū, μ),
    // flat at λ = 1 (today's baseline) and through the origin at λ = 0.
    const rate = model.muUsg > 0 ? mu / model.muUsg : 0;
    const lamY = (x) => rate * (1 - lambda) * x + lambda * mu;
    return {
      X, Y, xMax, yMax, dots, xStar, inRange,
      fit: { x1: X(0), y1: Y(model.a), x2: X(xMax), y2: Y(model.a + model.b * xMax) },
      med: Y(mu),
      kinkX: inRange ? X(xStar) : null,
      lam: rate > 0
        ? { x1: X(0), y1: Y(lamY(0)), x2: X(xMax), y2: Y(lamY(xMax)), px: X(model.muUsg), py: Y(mu) }
        : null,
    };
  }, [rows, model, mu, lambda]);

  if (!view) return null;

  // A tap maps straight back through the SVG's box (uniform scale from a
  // 100-wide viewBox), the same hit test the breakdown scatter uses.
  const hits = (e) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box?.width) return [];
    const vx = ((e.clientX - box.left) / box.width) * 100;
    const vy = ((e.clientY - box.top) / box.height) * PLOT_H;
    return view.dots
      .map((d) => ({ d, dist: Math.hypot(d.cx - vx, d.cy - vy) }))
      .filter((h) => h.dist <= TAP_R)
      .sort((a, b) => a.dist - b.dist)
      .map((h) => ({ ...h, vx, vy }));
  };

  const onTap = (e) => {
    const h = hits(e);
    if (!h.length) { setMenu(null); onSelect(null); return; }
    if (h.length === 1) { setMenu(null); onSelect(h[0].d.r); return; }
    setMenu({
      left: Math.max(4, Math.min(96, h[0].vx)),
      top: (Math.max(0, Math.min(PLOT_H, h[0].vy)) / PLOT_H) * 100,
      flip: h[0].vy > PLOT_H * 0.55,
      items: h.slice(0, 6).map((x) => x.d.r),
    });
  };

  const shown = selected || hover;
  const sel = shown ? view.dots.find((d) => d.r.key === shown.key) : null;

  return (
    <div className="mb-2">
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 100 ${PLOT_H}`}
          className="w-full block touch-manipulation"
          onClick={onTap}
          onPointerMove={(e) => { if (e.pointerType === "mouse") setHover(hits(e)[0]?.d.r || null); }}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Points per minute against possessions used per minute, ${rows.length} ${scopeLabel} player-seasons in ${seasonLabel}, with the league-median, fitted and capped baselines drawn over them. The table below lists the same players and the same numbers.`}
        >
          {/* Where the cap differs from today's baseline: left of the crossing
              and nowhere else. */}
          {view.kinkX != null && (
            <rect x="0" y="0" width={view.kinkX} height={PLOT_H} fill="#f59e0b" fillOpacity="0.06" />
          )}
          {/* Frame, kept recessive — the lines below are the ink that matters. */}
          <line x1="0" y1={PLOT_H} x2="100" y2={PLOT_H} stroke="#e7e5e4" strokeWidth="0.3" />
          <line x1="0" y1="0" x2="0" y2={PLOT_H} stroke="#e7e5e4" strokeWidth="0.3" />

          {view.dots.map((d, i) => (
            <circle
              key={i}
              cx={d.cx} cy={d.cy} r={d.r.matched ? DOT_R * 1.5 : DOT_R}
              fill={d.r.matched ? "#1c1917" : "#d6d3d1"}
              fillOpacity={d.r.matched ? 0.9 : 0.75}
            />
          ))}

          {/* Capped baseline first, thick and underneath, so it shows as a halo
              along the fitted line to the left of the kink and along the median
              to the right of it. */}
          <path
            d={view.kinkX == null
              ? `M0 ${view.med} L100 ${view.med}`
              : `M0 ${view.Y(model.a)} L${view.kinkX} ${view.med} L100 ${view.med}`}
            fill="none" stroke={CAP_LINE} strokeWidth="1.6" strokeOpacity="0.55" strokeLinejoin="round"
          />
          <line x1="0" y1={view.med} x2="100" y2={view.med} stroke="#78716c" strokeWidth="0.35" strokeDasharray="2 1.5" />
          {/* The dial, and the point it turns on. At λ = 1 it lies exactly
              under the median line; at λ = 0 it runs through the origin. */}
          {view.lam && (
            <>
              <line x1={view.lam.x1} y1={view.lam.y1} x2={view.lam.x2} y2={view.lam.y2} stroke={MIDNIGHT_PURPLE} strokeWidth="0.45" />
              <circle cx={view.lam.px} cy={view.lam.py} r="0.8" fill="#fff" stroke={MIDNIGHT_PURPLE} strokeWidth="0.35" />
            </>
          )}
          <line x1={view.fit.x1} y1={view.fit.y1} x2={view.fit.x2} y2={view.fit.y2} stroke="#1c1917" strokeWidth="0.45" />
          {view.kinkX != null && (
            <circle cx={view.kinkX} cy={view.med} r="0.9" fill={CAP_LINE} stroke="#fff" strokeWidth="0.3" />
          )}

          {/* Selected/hovered player: white halo, black dot, and dashed drops to
              both axes so the two rates can be read off the frame. */}
          {sel && (
            <>
              <line x1={sel.cx} y1={sel.cy} x2={sel.cx} y2={PLOT_H} stroke="#1c1917" strokeWidth="0.25" strokeDasharray="1.5 1.5" strokeOpacity="0.45" />
              <line x1={sel.cx} y1={sel.cy} x2="0" y2={sel.cy} stroke="#1c1917" strokeWidth="0.25" strokeDasharray="1.5 1.5" strokeOpacity="0.45" />
              <circle cx={sel.cx} cy={sel.cy} r="2.2" fill="#fff" />
              <circle cx={sel.cx} cy={sel.cy} r="1.4" fill="#1c1917" />
            </>
          )}
        </svg>

        {/* The y axis is named where the data never reaches — this
            relationship slopes up, so the top-left corner is always empty. */}
        <div className="absolute left-0 top-0 text-[7px] leading-none text-stone-400 tabular-nums pointer-events-none">
          PTS/MIN ↑ {view.yMax.toFixed(2)}
        </div>

        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} aria-hidden />
            <div
              className={`absolute z-20 ${menu.flip ? "-translate-y-full -mt-2" : "mt-2"} ${menu.left > 60 ? "-translate-x-full" : ""}`}
              style={{ left: `${menu.left}%`, top: `${menu.top}%` }}
            >
              <div className="min-w-[8rem] rounded-sm border border-stone-300 bg-white shadow-md overflow-hidden">
                <div className="px-1.5 py-0.5 text-[7px] uppercase tracking-wider text-stone-400 border-b border-stone-100">{menu.items.length} players here</div>
                {menu.items.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => { setMenu(null); onSelect(r); }}
                    className="w-full flex items-baseline justify-between gap-2 px-1.5 py-1 text-left hover:bg-stone-100"
                  >
                    <span className="truncate text-[9px] font-medium text-stone-800">{r.r.name}</span>
                    <span className="shrink-0 text-[8px] tabular-nums text-stone-500">{r.ptsPerM.toFixed(3)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Axis extremes on the frame — the plot is small, so two numbers an axis
          beats a full tick ladder. */}
      <div className="flex justify-between text-[7px] text-stone-400 tabular-nums -mt-0.5">
        <span>0</span>
        <span className="uppercase tracking-wider">poss. used / min →</span>
        <span>{view.xMax.toFixed(2)}</span>
      </div>

      {/* Legend under the plot rather than over it: three lines that mostly
          overlap need naming, and there is nowhere inside the frame to put the
          names where they don't land on data. Each carries its own dash
          pattern as well as its colour. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[8px] leading-none">
        <span className="text-stone-900"><span className="font-bold">──</span> fitted line</span>
        <span className="text-stone-500"><span className="font-bold">- -</span> median {mu.toFixed(3)}</span>
        <span style={{ color: CAP_LINE }}><span className="font-bold">━</span> cap = the lower of the two
          {view.xStar != null && view.inRange ? `, bending at ${view.xStar.toFixed(2)}` : ""}</span>
        <span style={{ color: MIDNIGHT_PURPLE }}><span className="font-bold">──</span> λ = {lambda.toFixed(2)}, pivoting on the median minute</span>
        {view.inRange && <span className="text-stone-400 italic">shaded = where the cap changes anything</span>}
      </div>

      {/* Readout: the dot under the finger, or the invitation to find one. */}
      <div className="mt-1 h-[2.1rem] text-[9px] leading-tight">
        {shown ? (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-semibold" style={{ color: teamColor(shown.r.team) }}>
              {shown.r.name} <span className="text-stone-400 font-normal text-[8px]">{shown.r.team}</span>
            </span>
            <span className="text-stone-500 tabular-nums">
              {shown.ptsPerM.toFixed(3)} PTS/min on {shown.usgPerM.toFixed(3)} poss/min · line says {shown.pred.toFixed(3)}
            </span>
            <span className="tabular-nums">
              <span className="text-stone-400">VA</span> <span className={shown.va < 0 ? "text-red-600" : "text-stone-700"}>{(shown.va > 0 ? "+" : "") + shown.va.toFixed(1)}</span>
              {" · "}<span className="text-stone-400">USG</span> <span className={shown.usgVa < 0 ? "text-red-600" : "text-stone-700"}>{(shown.usgVa > 0 ? "+" : "") + shown.usgVa.toFixed(1)}</span>
              {" · "}<span className="text-stone-400">CAP</span> <span className={shown.capVa < 0 ? "text-red-600" : "text-stone-700"}>{(shown.capVa > 0 ? "+" : "") + shown.capVa.toFixed(1)}</span>
              {" · "}<span className="text-stone-400">λ</span> <span className={shown.splitVa < 0 ? "text-red-600" : "text-stone-700"}>{(shown.splitVa > 0 ? "+" : "") + shown.splitVa.toFixed(1)}</span>
            </span>
          </div>
        ) : (
          <div className="text-stone-400 italic">
            {rows.length} player-seasons · y = PTS/min, x = poss. used/min · a dot&rsquo;s height above a
            line is its scoring VA per minute against that baseline · tap one to read it, or tap a name
            in the table to find it up here
          </div>
        )}
      </div>
    </div>
  );
}


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
  // Opens on Δ, biggest first — under the capped candidate that is the rows it
  // actually moves (it can only ever raise a VA, so the other direction is a
  // screenful of zeros); under USG-ADJ, tap Δ once to flip to who it costs.
  const [sort, setSort] = useState({ key: "delta", dir: -1 });
  // Which alternative baseline Δ measures against the standard one. Both
  // alternatives always have their own column; this only picks which gap is
  // spelled out and sortable. Opens on the capped candidate — the one being
  // reviewed.
  const [deltaVs, setDeltaVs] = useState("cap"); // "cap" | "usg" | "spl"
  // Which trio of candidate columns the table shows: the three whole baselines,
  // or the split of today's own volume term into what it pays for efficiency
  // and what it pays for load. Nine columns is what fits a phone; twelve is a
  // spreadsheet nobody can read.
  const [colView, setColView] = useState("base"); // "base" | "split"
  // The volume credit λ. 1 is plain VA exactly, 0 charges purely per
  // possession used. Opens where the USG-ADJ switch itself sits, so the λ
  // column reads as what that switch does until the dial is moved.
  const [lambda, setLambda] = useState(VOLUME_CREDIT);
  // Min-minutes filter, same two-step arming as the D Rating tab: tap the MP
  // header to arm, then a row's MP to keep only players with at least that
  // many minutes.
  const [minMpFilter, setMinMpFilter] = useState(null);
  const [mpArmed, setMpArmed] = useState(false);
  // The scatter above the table, and the player picked out of it. The plot is
  // where the baselines are legible as shapes; the table is the same data as
  // numbers, and the two stay pointed at the same player.
  const [showPlot, setShowPlot] = useState(true);
  const [picked, setPicked] = useState(null);
  const sel = season || seasons[0] || null;

  useEffect(() => {
    if (!sel) return;
    let cancelled = false;
    setRows(null);
    setMinMpFilter(null);
    setMpArmed(false);
    setPicked(null);
    // The same two bakes the other tabs read, so this costs nothing extra
    // once either has been visited (fetchJsonCached shares the payload).
    fetchJsonCached(scope === "po" ? `/api/leaderboard?season=${sel}` : `/api/regular-season?season=${sel}`)
      .then((d) => { if (!cancelled) setRows(d.players || []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [sel, scope]);

  const lga = sel ? lgaForSeason(sel) : null;
  // The FITTED-LINE baseline, not the mode's: this tab prices its USG and CAP
  // columns against the regression itself, which the switch no longer uses
  // (it ships the λ pivot — see VOLUME_CREDIT). The λ column below reads the
  // same object, since the split only needs ū and μ off it.
  const lgaUsg = sel ? fittedLineLga(sel) : null;
  const model = sel ? usageModelFor(sel) : null;

  // Every row scored once, tagged with whether it clears the sample floor.
  // Rotation-sized samples only, so noise doesn't crowd the top — except that
  // a search still reaches anyone, which is why the floor is a tag here rather
  // than a filter.
  const minMp = minMpFilter ?? (scope === "po" ? 40 : 100);
  const scored = useMemo(() => {
    if (!rows || !lga || !lgaUsg?.usgModel) return null;
    const out = [];
    for (const r of rows) {
      if (!(r.mp > 0)) continue;
      const gp = r.gp ?? r.g ?? 0;
      const usgPerM = possUsed(r) / r.mp;
      // Both baselines through the one shared definition (scoring.js), so a
      // row here can never disagree with the same player's card.
      const va = volumeVA(r, lga);
      const usgVa = volumeVA(r, lgaUsg);
      const capVa = cappedVolumeVA(r, lgaUsg);
      const sp = usageSplit(r, lgaUsg);
      const splitVa = splitVolumeVA(r, lgaUsg, lambda);
      out.push({
        r, gp, usgPerM,
        eff: sp?.eff ?? 0, vol: sp?.vol ?? 0, splitVa,
        key: (r.slug || r.name) + (r.team || ""),
        qualified: r.mp >= minMp,
        ptsPerM: (r.pts || 0) / r.mp,
        pred: lgaUsg.usgModel.a + lgaUsg.usgModel.b * usgPerM,
        va, usgVa, capVa,
        delta: (deltaVs === "cap" ? capVa : deltaVs === "spl" ? splitVa : usgVa) - va,
      });
    }
    return out;
  }, [rows, lga, lgaUsg, minMp, deltaVs, lambda]);

  // What the plot draws: the qualified field, always — a search picks players
  // OUT of the cloud rather than emptying it, since the cloud is the context
  // the scatter exists to give. The table keeps the opposite behaviour and
  // lists only what matches.
  const plotRows = useMemo(() => {
    if (!scored) return null;
    const q = normalizeName(query.trim());
    return scored
      .filter((x) => x.qualified)
      .map((x) => (q && normalizeName(x.r.name || "").includes(q) ? { ...x, matched: true } : x));
  }, [scored, query]);

  // Bring the picked player's row into view only when the table is short
  // enough that the move is a nudge — a search, or a tight minutes filter. On
  // the full board that row is hundreds down, and scrolling to it would throw
  // the reader off the plot they are working in; the row keeps its highlight
  // for whenever they get there, and the readout under the plot already
  // carries the same numbers.
  useEffect(() => {
    if (!picked || !listRef.current || listRef.current.length > 25) return;
    document.querySelector(`[data-usage-row="${CSS.escape(picked.key)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [picked]);

  const listRef = useRef(null);
  const list = useMemo(() => {
    if (!scored) return null;
    const q = normalizeName(query.trim());
    const out = scored.filter((x) => (q ? normalizeName(x.r.name || "").includes(q) : x.qualified));
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
      : sort.key === "capVa" ? scaled(x.capVa, x.gp)
      : sort.key === "eff" ? scaled(x.eff, x.gp)
      : sort.key === "vol" ? scaled(x.vol, x.gp)
      : sort.key === "splitVa" ? scaled(x.splitVa, x.gp)
      : scaled(x.delta, x.gp)
    );
    out.sort((a, b) => {
      const av = val(a), bv = val(b);
      const c = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return c !== 0 ? sort.dir * c : scaled(b.usgVa, b.gp) - scaled(a.usgVa, a.gp);
    });
    return out;
  }, [scored, query, sort, perGame]);
  listRef.current = list;

  // The three point columns share one scale: totals, or divided by games.
  const pts = (v, gp) => (perGame ? (gp > 0 ? v / gp : 0) : v);
  const sgn = (v) => (v > 0 ? "+" : "") + v.toFixed(perGame ? 2 : 1);
  const cols = "grid grid-cols-[1.2rem_minmax(0,1fr)_1.9rem_2.0rem_2.0rem_2.5rem_2.5rem_2.5rem_2.4rem] gap-x-[3px] items-center";

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
        <button
          type="button"
          onClick={() => setShowPlot((v) => !v)}
          className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 border rounded-sm ${showPlot ? "bg-stone-700 text-white border-stone-700" : "bg-white text-stone-500 border-stone-300"}`}
          aria-pressed={showPlot}
        >Plot</button>
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
      {/* Second row: which candidates the table shows, what Δ measures, and
          the dial. Kept apart from the season/scope controls above — these
          three change what the numbers MEAN, the ones above change which
          numbers. */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden" title="Whole baselines, or today's volume term split into its two halves">
          <button onClick={() => setColView("base")} className={`px-1.5 py-0.5 ${colView === "base" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Baselines</button>
          <button onClick={() => setColView("split")} className={`px-1.5 py-0.5 border-l border-stone-300 ${colView === "split" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Split</button>
        </div>
        <div className="inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden" title="Which candidate the Δ column measures against today's VA">
          <span className="px-1 py-0.5 bg-stone-100 text-stone-400">Δ</span>
          <button onClick={() => setDeltaVs("cap")} className={`px-1.5 py-0.5 border-l border-stone-300 ${deltaVs === "cap" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Cap</button>
          <button onClick={() => setDeltaVs("usg")} className={`px-1.5 py-0.5 border-l border-stone-300 ${deltaVs === "usg" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Usg</button>
          <button onClick={() => setDeltaVs("spl")} className={`px-1.5 py-0.5 border-l border-stone-300 normal-case ${deltaVs === "spl" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>λ</button>
        </div>
        <label className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-stone-500">
          <span>Volume credit <span className="normal-case">λ</span></span>
          <input
            type="range" min="0" max="1" step="0.05" value={lambda}
            onChange={(e) => setLambda(Number(e.target.value))}
            className="w-20 h-1 accent-violet-950"
            aria-label="Volume credit lambda: 1 is today's VA, 0 charges purely per possession used"
          />
          <span className="tabular-nums text-stone-900 font-semibold w-6">{lambda.toFixed(2)}</span>
        </label>
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
          CAP = the same on min(PRED, median) — the capped candidate, which charges the
          fitted line only where it asks LESS than the median minute, so it equals VA for
          everyone at or above median usage and can never lower a player ·
          EFF + VOL is today&apos;s VA split exactly in two — what he scored above the going
          rate on the possessions he used, and what he was worth for carrying more or less
          load than a median minute — and λ pays the second half at the dial&apos;s rate
          (λ=1 is plain VA to the decimal, λ=0 charges purely per possession used;
          the USG-ADJ switch ships λ={VOLUME_CREDIT}) ·
          Δ = {deltaVs === "cap" ? "CAP" : deltaVs === "spl" ? "λ" : "USG"} − VA, exactly what
          adopting that baseline moves this player&apos;s total VA by (the other nine
          categories don&apos;t change)
          {scope === "po" && " · playoff rows are scored against the season's regular-season line, as all VA baselines are"}
        </div>
      )}
      {showPlot && plotRows && plotRows.length > 0 && (
        <UsageScatter
          rows={plotRows}
          model={lgaUsg.usgModel}
          mu={lga.laPTSperM}
          lambda={lambda}
          selected={picked}
          onSelect={setPicked}
          seasonLabel={sel}
          scopeLabel={scope === "po" ? "playoff" : "regular-season"}
        />
      )}
      {(() => {
        const NATURAL = { name: 1, ptsPerM: -1, pred: -1, va: -1, usgVa: -1, capVa: -1, eff: -1, vol: -1, splitVa: -1, delta: -1 };
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
            {colView === "base" ? (
              <>
                <H k="va" label="VA" title="Scoring volume against the league's median minute — today's VA" />
                <H k="usgVa" label="USG" title="Scoring volume against the fitted line at his own usage" />
                <H k="capVa" label="Cap" title="Scoring volume against min(predicted, league median)" />
              </>
            ) : (
              <>
                <H k="eff" label="Eff" title="Points above the going rate on the possessions he used" />
                <H k="vol" label="Vol" title="What he was worth for carrying more (or less) load than a median minute — Eff + Vol = VA exactly" />
                <H
                  k="splitVa"
                  label={<span className="normal-case">λ{lambda === VOLUME_CREDIT ? "*" : ""}</span>}
                  title={`Eff + λ × Vol — plain VA at λ=1, a pure per-possession charge at λ=0${lambda === VOLUME_CREDIT ? ". * this is what the USG-ADJ switch scores" : ""}`}
                />
              </>
            )}
            <H k="delta" label="Δ" title={`${deltaVs === "cap" ? "CAP" : "USG"} − VA: what adopting that baseline moves his total by`} />
          </div>
        );
      })()}
      {!list && <div className="py-4 text-center text-stone-400 italic">Loading…</div>}
      {list && list.length === 0 && <div className="py-4 text-center text-stone-400 italic">No players match.</div>}
      {list && list.map((x, i) => {
        const { r, gp, ptsPerM, pred, usgPerM, va, usgVa, capVa, eff, vol, splitVa, delta, key } = x;
        const isPicked = picked?.key === key;
        return (
        <div
          key={key}
          data-usage-row={key}
          className={`${cols} py-[2px] border-b border-stone-100 last:border-0 ${isPicked ? "bg-amber-50 ring-1 ring-amber-500" : i % 2 ? "bg-stone-50" : ""}`}
        >
          <span className="text-stone-400 tabular-nums">{i + 1}</span>
          {/* The row's name is the other end of the plot's selection: tapping
              it lights the same player's dot, so a name found by searching can
              be located in the cloud. */}
          <button
            type="button"
            onClick={() => setPicked(isPicked ? null : x)}
            className="truncate font-semibold text-left"
            style={{ color: teamColor(r.team) }}
            aria-pressed={isPicked}
            title={isPicked ? "Clear the highlight" : "Highlight this player in the plot"}
          >
            {r.name} <span className="text-stone-400 font-normal text-[8px]">{r.team}</span>
          </button>
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
          {colView === "base" ? (
            <>
              <span className={`text-right tabular-nums ${va < 0 ? "text-red-600" : "text-stone-700"}`}>{sgn(pts(va, gp))}</span>
              <span className={`text-right tabular-nums ${usgVa < 0 ? "text-red-600" : "text-stone-700"}`}>{sgn(pts(usgVa, gp))}</span>
              {/* The capped column is dimmed wherever it is identical to VA —
                  the ~40% of a season's players who sit at or above median
                  usage and whom the candidate leaves alone — so the rows it
                  actually moves are the ones that read as live. */}
              <span
                className={`text-right tabular-nums ${capVa === va ? "text-stone-300" : capVa < 0 ? "text-red-600" : "text-stone-700"}`}
                title={capVa === va ? "At or above median usage — the cap leaves this player on the standard baseline" : undefined}
              >{sgn(pts(capVa, gp))}</span>
            </>
          ) : (
            <>
              <span className={`text-right tabular-nums ${eff < 0 ? "text-red-600" : "text-stone-700"}`}>{sgn(pts(eff, gp))}</span>
              <span className={`text-right tabular-nums ${vol < 0 ? "text-red-600" : "text-stone-700"}`}>{sgn(pts(vol, gp))}</span>
              <span className={`text-right tabular-nums ${splitVa < 0 ? "text-red-600" : "text-stone-700"}`}>{sgn(pts(splitVa, gp))}</span>
            </>
          )}
          <span className={`text-right tabular-nums font-semibold ${delta < 0 ? "text-red-600" : delta === 0 ? "text-stone-300" : "text-stone-900"}`}>{sgn(pts(delta, gp))}</span>
        </div>
        );
      })}
      {list && list.length > 0 && (
        <div className="mt-2 text-center text-[9px] italic text-stone-400">
          {minMpFilter != null
            ? `Min ${minMpFilter} minutes · `
            : query.trim() === "" ? `Min ${scope === "po" ? 40 : 100} minutes · search to include everyone · ` : ""}
          {perGame ? "per game" : "season totals"} · tap a column to sort · tap a name to find it in the plot ·
          tap MP, then a player&rsquo;s MP, to filter by minutes
        </div>
      )}
    </div>
  );
}
