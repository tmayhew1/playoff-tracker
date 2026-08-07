"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CAREER_B_FILL, GOLD, GOLD_BG, seasonTag, shortName, withAlpha } from "../lib/format";


// League context for a row of the compare panel: where the two compared lines
// fall inside the whole indexed field. It's the same plot the individual card
// hangs under a category — a scatter of a group's two stats, or one stat's
// value-added axis with the field collapsed onto it as a mirrored dot plot —
// with two differences that follow from what a comparison is:
//
//   * the field is EVERY player-season the index carries, not one season's,
//     because the two sides can come from any two eras (or be multi-season
//     runs, which have no single season of their own to be ranked inside);
//   * there are two marked points, not one.
//
// Each pool row is measured against its own season's baselines upstream (see
// the panel's percentile pass, which is where these values come from), so a
// 1987 season and a 2024 one sit on the same axis honestly.
//
// Twenty thousand seasons is more circles than a phone should be asked to
// draw, so the cloud is DENSITY-BINNED: every season is counted, and the ones
// landing in the same sub-dot cell merge into a single mark that darkens and
// grows with the count. The collapsed form quantizes the same way — one dot
// stands for `unit` seasons — so a column's height still reads as how many
// seasons sit at that value, which is the whole point of the mirrored plot.

// viewBox is a fixed 100 wide, so dots stay round whatever width the card is.
const PLOT_H = 58;
// Density cell, in viewBox units: a shade under the dot diameter the season
// scatter uses, so a sparse corner of the cloud still reads as separate dots.
const CELL = 1.5;
// Tap radius around a finger press. Generous on purpose — the cloud is dense,
// and catching several seasons at once is a readout, not a miss.
const TAP_R = 3.4;
const CLOUD_INK = "#57534e";  // stone-600 — the density ramp's ink
const BASELINE = "#e7e5e4";   // stone-200 — the league-baseline guides


const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));


// The axis range for one stat. A pool of twenty thousand seasons has tails
// (a five-game run at +6 a game) that would squash everything else into a
// smear, so the range is the 0.2nd–99.8th percentile rather than the extremes,
// always widened to include zero — the league baseline has to be on the plot —
// and both compared values, since neither side may ever fall off its own chart.
// The handful of seasons outside it clamp into the outermost cells, where the
// density ramp absorbs them.
function axisRange(sorted, include) {
  const q = (p) => sorted[clamp(Math.round(p * (sorted.length - 1)), 0, sorted.length - 1)];
  let lo = sorted.length ? q(0.002) : 0;
  let hi = sorted.length ? q(0.998) : 1;
  for (const v of include) {
    if (!Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  lo = Math.min(0, lo);
  hi = Math.max(0, hi);
  const pad = (hi - lo) * 0.08 || 1;
  return [lo - pad, hi + pad];
}


// Scatter cloud: count the field into a grid of square cells and emit one mark
// per occupied cell. Opacity and radius both ramp with the count, on a log
// scale against a high quantile of the counts — so one enormous cell at the
// middle of the cloud can't wash every other cell out to nothing.
function densityCells(xs, ys, xr, yr, h) {
  const cols = Math.max(1, Math.ceil(100 / CELL));
  const rows = Math.max(1, Math.ceil(h / CELL));
  const counts = new Map();
  const spanX = (xr[1] - xr[0]) || 1;
  const spanY = (yr[1] - yr[0]) || 1;
  for (let i = 0; i < xs.length; i++) {
    const c = clamp(Math.floor((((xs[i] - xr[0]) / spanX) * 100) / CELL), 0, cols - 1);
    const r = clamp(Math.floor(((h - ((ys[i] - yr[0]) / spanY) * h) / CELL)), 0, rows - 1);
    const k = r * cols + c;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const all = [...counts.values()].sort((m, n) => m - n);
  // Where the ramp tops out: dense enough to be worth distinguishing, common
  // enough that most of the cloud sits below it.
  const ceiling = Math.max(2, all[Math.floor(all.length * 0.92)] || 2);
  const denom = Math.log1p(ceiling);
  const cells = [];
  for (const [k, n] of counts) {
    const c = k % cols, r = (k - c) / cols;
    const t = Math.min(1, Math.log1p(n) / denom);
    cells.push({
      cx: (c + 0.5) * CELL,
      cy: (r + 0.5) * CELL,
      n,
      r: CELL * (0.34 + 0.22 * t),
      op: 0.16 + 0.54 * t,
    });
  }
  return cells;
}


// Collapsed form: the field binned along one value axis, each bin's dots
// stacked outward from the centre line in alternating directions — 0, +1, −1,
// +2, −2 … — so a column reads as the count at that value and the whole thing
// is a mirrored histogram. With a whole-index field the columns run to
// thousands, so a dot stands for `unit` seasons rather than one; `unit` is
// whatever keeps the tallest column inside the cross axis at dot spacing.
function dotColumns(vals, range, h) {
  const bins = Math.max(12, Math.round(100 / 1.9));
  const span = (range[1] - range[0]) || 1;
  const counts = new Array(bins).fill(0);
  for (const v of vals) {
    counts[clamp(Math.floor(((v - range[0]) / span) * bins), 0, bins - 1)] += 1;
  }
  const spacing = 2.2;
  const maxDots = Math.max(1, Math.floor((h * 0.92) / spacing));
  const tallest = Math.max(1, ...counts);
  const unit = Math.max(1, Math.ceil(tallest / maxDots));
  const r = Math.max(0.3, Math.min(0.85, 0.45 * Math.min(100 / bins, spacing)));
  const dots = [];
  counts.forEach((n, b) => {
    if (!n) return;
    const centre = ((b + 0.5) / bins) * 100;
    const k = Math.max(1, Math.round(n / unit));
    for (let i = 0; i < k; i++) {
      const step = Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1);
      dots.push({ cx: centre, cy: h / 2 + step * spacing });
    }
  });
  return { dots, r, unit };
}


// One compared line's mark: a white halo so it reads over the densest part of
// the cloud, then the player's own colour. B wears the gold edge it wears
// everywhere else in the panel, with the same fill weight as its career bars.
function Marker({ x, y, color, gold }) {
  return (
    <>
      <circle cx={x} cy={y} r="2.6" fill="#fff" fillOpacity="0.9" />
      <circle
        cx={x}
        cy={y}
        r="1.6"
        fill={gold ? withAlpha(color, CAREER_B_FILL) : color}
        stroke={gold ? GOLD : "#fff"}
        strokeWidth="0.5"
      />
    </>
  );
}


// `field` is { xs, ys, rows }: parallel arrays of the pool's values on each
// axis (ys null when the plot is collapsed onto one stat) and the rows they
// came from, for the tap readout. `a`/`b` are the compared lines:
// { name, label, color, vals }.
export function LeagueContextPlot({ field, a, b, subs, sgn, caption, height = PLOT_H }) {
  const [menu, setMenu] = useState(null);
  const svgRef = useRef(null);
  const collapsed = !field.ys;
  // A readout names what sits at one spot on one plot; flip the /G switch (or
  // anything else that redraws the field) and that spot means something else.
  useEffect(() => { setMenu(null); }, [field]);

  const view = useMemo(() => {
    const { xs, ys } = field;
    // slice().sort() on a typed array sorts numerically, in place, without
    // boxing twenty thousand numbers into a plain array first.
    const xr = axisRange(xs.slice().sort(), [a.vals[0], b.vals[0]]);
    const yr = ys ? axisRange(ys.slice().sort(), [a.vals[1], b.vals[1]]) : null;
    const px = (v) => clamp(((v - xr[0]) / ((xr[1] - xr[0]) || 1)) * 100, 0, 100);
    const py = (v) => clamp(height - ((v - yr[0]) / ((yr[1] - yr[0]) || 1)) * height, 0, height);
    if (!ys) {
      const { dots, r, unit } = dotColumns(xs, xr, height);
      return {
        cloud: dots.map((d) => ({ ...d, r, op: 0.75 })),
        unit,
        guides: [{ x1: px(0), y1: 0, x2: px(0), y2: height }],
        pos: (vx) => ({ x: px(vx), y: height / 2 }),
        px, py: null,
      };
    }
    return {
      cloud: densityCells(xs, ys, xr, yr, height),
      unit: 1,
      guides: [
        { x1: px(0), y1: 0, x2: px(0), y2: height },
        { x1: 0, y1: py(0), x2: 100, y2: py(0) },
      ],
      pos: (vx, vy) => ({ x: px(vx), y: py(vy) }),
      px, py,
    };
    // Depends on the compared VALUES, not the arrays that carry them: the
    // panel rebuilds those on every render and the field behind them is
    // twenty thousand rows to sort.
  }, [field, a.vals[0], a.vals[1], b.vals[0], b.vals[1], height]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where each compared line sits. Collapsed, both ride the centre line, so a
  // pair landing on the same value would hide one behind the other — they part
  // just far enough to both be seen, and each keeps a full-height rule at its
  // own value so the reading never depends on the nudge.
  const aAt = view.pos(a.vals[0], a.vals[1]);
  const bAt = view.pos(b.vals[0], b.vals[1]);
  if (collapsed && Math.abs(aAt.x - bAt.x) < 3) {
    aAt.y -= 2.6;
    bAt.y += 2.6;
  }

  // A tap names the seasons under the finger. The cloud is a density picture,
  // so the hit test runs against the real values behind it rather than the
  // marks: what's under the finger is whichever seasons actually plot there.
  const handleTap = (e) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    const vx = ((e.clientX - box.left) / box.width) * 100;
    const vy = ((e.clientY - box.top) / box.height) * height;
    const { xs, ys, rows } = field;
    const hits = [];
    for (let i = 0; i < xs.length; i++) {
      const x = view.px(xs[i]);
      // Collapsed, a column IS its value: every season in it plots at the same
      // spot on the axis and the stacking is just how the count is drawn, so
      // the tap reads across the column rather than at one dot in it.
      const dist = ys ? Math.hypot(x - vx, view.py(ys[i]) - vy) : Math.abs(x - vx);
      if (dist <= TAP_R) hits.push({ i, dist });
    }
    if (!hits.length) { setMenu(null); return; }
    hits.sort((m, n) => m.dist - n.dist);
    setMenu({
      left: clamp(vx, 4, 96),
      top: (clamp(vy, 0, height) / height) * 100,
      flip: vy > height * 0.55,
      total: hits.length,
      items: hits.slice(0, 6).map(({ i }) => ({
        row: rows[i],
        vals: ys ? [xs[i], ys[i]] : [xs[i]],
      })),
    });
  };

  const axisLabel = collapsed
    ? `${subs[0]} value added`
    : `${subs[1]} against ${subs[0]} value added`;

  return (
    <>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 100 ${height}`}
          className="w-full block overflow-visible touch-manipulation"
          onClick={handleTap}
          role="img"
          aria-label={`${axisLabel} across ${field.xs.length.toLocaleString()} player-seasons — ${a.name} at ${a.vals.map((v) => sgn(v)).join(", ")}, ${b.name} at ${b.vals.map((v) => sgn(v)).join(", ")}. Tap the cloud to name the seasons under it.`}
        >
          {/* League baseline — where the stat is worth exactly nothing. */}
          {view.guides.map((g, i) => (
            <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke={BASELINE} strokeWidth="0.4" />
          ))}
          {view.cloud.map((c, i) => (
            <circle key={i} cx={c.cx} cy={c.cy} r={c.r} fill={CLOUD_INK} fillOpacity={c.op} />
          ))}
          {/* Each compared line's value, carried across the plot: a rule on the
              collapsed axis, a pair of guides dropping to the axes on the
              scatter. Either way the chips below read as the mark's position. */}
          {collapsed ? (
            <>
              <line x1={aAt.x} y1="0" x2={aAt.x} y2={height} stroke={a.color} strokeWidth="0.35" strokeDasharray="1.5 1.5" strokeOpacity="0.75" />
              <line x1={bAt.x} y1="0" x2={bAt.x} y2={height} stroke={b.color} strokeWidth="0.35" strokeDasharray="1.5 1.5" strokeOpacity="0.75" />
            </>
          ) : (
            <>
              <line x1={aAt.x} y1={aAt.y} x2={aAt.x} y2={height} stroke={a.color} strokeWidth="0.25" strokeDasharray="1.5 1.5" strokeOpacity="0.5" />
              <line x1={aAt.x} y1={aAt.y} x2="0" y2={aAt.y} stroke={a.color} strokeWidth="0.25" strokeDasharray="1.5 1.5" strokeOpacity="0.5" />
              <line x1={bAt.x} y1={bAt.y} x2={bAt.x} y2={height} stroke={b.color} strokeWidth="0.25" strokeDasharray="1.5 1.5" strokeOpacity="0.5" />
              <line x1={bAt.x} y1={bAt.y} x2="0" y2={bAt.y} stroke={b.color} strokeWidth="0.25" strokeDasharray="1.5 1.5" strokeOpacity="0.5" />
            </>
          )}
          <Marker x={aAt.x} y={aAt.y} color={a.color} />
          <Marker x={bAt.x} y={bAt.y} color={b.color} gold />
        </svg>
        {menu && (
          // What a tap landed on. Nothing here navigates — the panel is about
          // these two lines, and the readout is there to say what the cloud is
          // made of, not to swap either side out from under the reader.
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} aria-hidden />
            <div
              className={`absolute z-20 ${menu.flip ? "-translate-y-full -mt-2" : "mt-2"} ${menu.left > 60 ? "-translate-x-full" : ""}`}
              style={{ left: `${menu.left}%`, top: `${menu.top}%` }}
            >
              <div className="min-w-[9rem] rounded-sm border border-stone-300 bg-white shadow-md overflow-hidden">
                <div className="px-1.5 py-0.5 text-[7px] uppercase tracking-wider text-stone-400 border-b border-stone-100">
                  {menu.total.toLocaleString()} season{menu.total === 1 ? "" : "s"} here{menu.total > menu.items.length ? ` · nearest ${menu.items.length}` : ""}
                </div>
                {menu.items.map(({ row, vals }, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-2 px-1.5 py-1">
                    <span className="truncate text-[9px] font-medium text-stone-800">
                      {row.name} <span className="text-stone-400 tabular-nums">{seasonTag(row.season)}</span>
                    </span>
                    <span className="shrink-0 text-[8px] tabular-nums text-stone-500">
                      {vals.map((v) => sgn(v)).reverse().join(" / ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      {/* Chips naming the axes and carrying both lines' coordinates — the same
          job the individual card's stat chips do, minus their selector role
          (the rows above already are the selector). */}
      {/* A lone chip capped near the width a pair would give it and centred,
          so a collapsed plot's readout reads as a label under the plot rather
          than a banner stretched across the card. */}
      <div
        className="mt-2 grid gap-1 mx-auto"
        style={{
          gridTemplateColumns: `repeat(${subs.length}, minmax(0, 1fr))`,
          maxWidth: subs.length < 2 ? "48%" : undefined,
        }}
      >
        {subs.map((sub, i) => (
          <div key={sub} className="flex flex-col items-center gap-0.5 min-w-0 rounded px-1 py-1 border border-stone-200 bg-white">
            <span className="text-[7px] uppercase tracking-wide text-stone-400 leading-none">
              {sub}{collapsed ? "" : i === 0 ? " →" : " ↑"}
            </span>
            <span className="text-[10px] font-bold tabular-nums leading-none" style={{ color: a.color }}>{sgn(a.vals[i])}</span>
            <span className="text-[10px] font-bold tabular-nums leading-none rounded-sm px-1" style={{ color: b.color, backgroundColor: GOLD_BG }}>{sgn(b.vals[i])}</span>
          </div>
        ))}
      </div>
      <div className="text-[8px] italic text-stone-400 mt-1.5 px-1 leading-[1.3]">
        {caption}
        {collapsed
          ? ` · each column is the count at that ${subs[0]} value, mirrored${view.unit > 1 ? ` (one dot ≈ ${view.unit.toLocaleString()} seasons)` : ""}`
          : " · darker, bigger marks = more seasons at that spot"}
        {` · ${shortName(a.name)} solid, ${shortName(b.name)} gold-edged · line${view.guides.length > 1 ? "s" : ""} = the league baseline · tap the cloud to name the seasons under it.`}
      </div>
    </>
  );
}


// The panel's wrapper: pull one or two stats' values out of the percentile
// pass the panel already ran (so the field costs nothing to draw), drop the
// rows a stat can't speak for, and hand the arrays to the plot.
//
// `keys` is [stat] for a collapsed plot or [x, y] for a scatter; `poolVals`
// carries every row's value for every key on the panel's current /G setting.
export function CompareLeaguePlot({ keys, subs, pool, poolVals, poolMask = null, a, b, sgn, caption, height = PLOT_H }) {
  const field = useMemo(() => {
    const n = poolVals.length;
    const xs = new Float64Array(n);
    const ys = keys.length > 1 ? new Float64Array(n) : null;
    const rows = new Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (poolMask && !poolMask[i]) continue;
      const v = poolVals[i];
      xs[k] = v[keys[0]];
      if (ys) ys[k] = v[keys[1]];
      rows[k] = pool[i];
      k++;
    }
    return {
      xs: xs.subarray(0, k),
      ys: ys ? ys.subarray(0, k) : null,
      rows: rows.slice(0, k),
    };
    // Same reason as the plot's own memo: `keys` is a fresh array each render,
    // so the stats themselves are the dependency.
  }, [keys[0], keys[1], pool, poolVals, poolMask]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!field.xs.length) {
    return <div className="text-[9px] italic text-stone-400 px-1 py-2 text-center">No indexed seasons to plot this against.</div>;
  }
  return (
    <LeagueContextPlot
      field={field}
      a={a}
      b={b}
      subs={subs}
      sgn={sgn}
      caption={typeof caption === "function" ? caption(field.xs.length) : caption}
      height={height}
    />
  );
}
