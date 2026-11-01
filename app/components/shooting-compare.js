"use client";

import React, { useId, useMemo, useState } from "react";
import { ZONES, hasZoneData, valueAddByCategory, zoneShotValue } from "../scoring";
import { compName, comparePalette, seasonTag, shortName, teamColor, withAlpha } from "../lib/format";
import { rowSeasonLabel } from "../lib/multi-season";
import { samePlayer } from "../lib/va";
import { useRowLga } from "../lib/va-mode";
import { B_FILL, useFreshRows } from "./compare";


// The Shooting lens of a comparison: what the closest-comps picker opens when
// its SHOOTING toggle is on and a chip is tapped. The match was made on the
// shooting profile (six shot-distance values — FT, four 2-point zones, 3PT),
// so the comparison it opens is drawn on that same profile: the category
// card's "Scoring · by shot distance" bars and its shot-distribution discs,
// with both players on one chart instead of one.
//
// Same visual grammar as ComparePanel: A in solid team color, B pale inside
// and outlined in its comparePalette color, each side scored against its own
// season's league zone FG% (era-fair), per game.


const ZONE_DIST = Object.fromEntries(ZONES.map((z) => [z.key, z.label]));

// The six columns, FT out to the arc, in the category card's order.
const SHOT_COLS = [
  { key: "ft", sub: "FT", m: (r) => r.ftm || 0, a: (r) => r.fta || 0,
    val: (r, lx) => ((r.ftm / (r.fta || 1)) - lx.laFT) * (r.fta || 0) },
  ...ZONES.map((z, i) => ({
    key: z.key, sub: ["Rim", "Float", "Mid", "Deep Mid"][i], dist: ZONE_DIST[z.key],
    m: (r) => r[z.mKey] || 0, a: (r) => r[z.aKey] || 0,
    val: (r, lx) => zoneShotValue(r[z.mKey] || 0, r[z.aKey] || 0, lx.zoneFG?.[z.key]),
  })),
  { key: "tp", sub: "3PT", m: (r) => r.tpm || 0, a: (r) => r.tpa || 0,
    val: (r, lx) => 3 * ((r.tpm / (r.tpa || 1)) - lx.la3P) * (r.tpa || 0) },
];

// Both rows must carry zone attempts and both seasons a zone baseline —
// otherwise four of the six columns would be blank on one side.
export function canShootCompare(a, b, lgaA, lgaB) {
  return !!(a && b && lgaA?.zoneFG && lgaB?.zoneFG && hasZoneData(a) && hasZoneData(b));
}

// One side's readings: per-game value, FG% and attempt share per column, plus
// the two headline totals the category card prints (Eff, Impact).
function shotSide(r, lx) {
  const gp = r.gp || 1;
  // FTA ÷ 2.2 ≈ trips to the line, as in the category card's distribution.
  const atts = SHOT_COLS.map((c) => c.a(r) / (c.key === "ft" ? 2.2 : 1));
  const tot = atts.reduce((t, x) => t + x, 0) || 1;
  const cols = SHOT_COLS.map((c, i) => {
    const att = c.a(r);
    return {
      v: c.val(r, lx) / gp,
      fg: att > 0 ? c.m(r) / att : null,
      ma: `${(c.m(r) / gp).toFixed(1)}/${(att / gp).toFixed(1)}`,
      share: atts[i] / tot,
    };
  });
  const by = valueAddByCategory(r, lx);
  const eff = ((by["3-Pointers"] || 0) + (by["2-Pointers"] || 0) + (by["Free Throws"] || 0)) / gp;
  const impact = cols.reduce((s, c) => s + c.v, 0);
  return { cols, eff, impact };
}

const zeroed = (v) => (Math.abs(v) < 0.005 ? 0 : v);
const sgn = (v) => { const z = zeroed(v); return (z > 0 ? "+" : "") + z.toFixed(2); };


// Box Score VA ⇄ Shooting switch for an open comparison. Sits at the right
// end of the breakdown's vs-chip row, the same height as the toggles there.
export function CompareLensToggle({ lens, onChange }) {
  const opts = [{ key: "box", label: "Box VA" }, { key: "shoot", label: "Shooting" }];
  return (
    <div className="shrink-0 inline-flex border border-stone-300 rounded-sm overflow-hidden">
      {opts.map((o, i) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={lens === o.key}
          className={`whitespace-nowrap px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${i ? "border-l border-stone-300" : ""} ${lens === o.key ? "bg-amber-400 text-amber-950 font-semibold" : "bg-white text-stone-400 hover:bg-amber-50"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}


// Attempts floor on a zone board — the category card's rule (SHOT_ATT_PER_G
// there): one attempt per game the season has had, i.e. per the most games
// anyone in that season's pool logged. The player himself is always on it.
const SHOT_ATT_PER_G = 1;

// One side's season leaderboard at one distance: the category card's mini
// board (five rows around the player), ranked on per-game value added there.
// Null for a pooled run, which has no single season to rank in.
function zoneBoard(row, col, context, lgaOf) {
  if (!row || row.multi || !row.season) return null;
  const rows = context?.poolsBySeason?.get(row.season) || [];
  let maxGp = 0;
  for (const r of rows) if ((r.gp || 0) > maxGp) maxGp = r.gp;
  const floor = Math.ceil(SHOT_ATT_PER_G * maxGp);
  const pool = rows
    .filter((r) => r.mp > 0 && (col.a(r) >= floor || samePlayer(r, row)))
    .map((r) => ({ r, m: col.val(r, lgaOf(r)) / (r.gp || 1) }))
    .sort((x, y) => y.m - x.m);
  const N = pool.length;
  const idx = pool.findIndex((x) => samePlayer(x.r, row));
  if (idx < 0) return null;
  let lo = Math.max(0, idx - 2);
  const hi = Math.min(N, lo + 5);
  lo = Math.max(0, hi - 5);
  return { N, rank: idx + 1, floor, win: pool.slice(lo, hi).map((x, i) => ({ ...x, rank: lo + i + 1, isSelf: lo + i === idx })) };
}

function ZoneBoard({ board, row, col, color, ink }) {
  const head = (
    <div className="flex items-baseline justify-between gap-1 mb-0.5 min-w-0">
      <span className="truncate font-semibold text-[9px]" style={{ color: ink }}>
        {shortName(row.name)} <span className="font-normal text-stone-400 tabular-nums">{seasonTag(row.season || "")}</span>
      </span>
      {board && <span className="shrink-0 whitespace-nowrap text-stone-800 font-bold text-[9px]">#{board.rank}<span className="text-stone-400 font-normal"> of {board.N}</span></span>}
    </div>
  );
  if (!board) {
    return <div className="min-w-0">{head}<div className="text-[8px] italic text-stone-400 py-2">No single season to rank a run in.</div></div>;
  }
  const grid = "grid grid-cols-[1.1rem_1fr_2.1rem_2.3rem] gap-x-1 items-center px-0.5 py-[2px] tabular-nums";
  return (
    <div className="min-w-0">
      {head}
      <div className={`${grid} !py-0 pb-0.5 text-[7px] uppercase tracking-wider text-stone-400 border-b border-stone-100`}>
        <span className="text-right">#</span><span>Player</span><span className="text-right">VA</span><span className="text-right">{col.sub}</span>
      </div>
      {board.win.map(({ r, m, rank, isSelf }) => {
        const gp = r.gp || 1, att = col.a(r);
        const v = Math.abs(m) < 0.005 ? 0 : m;
        return (
          <div
            key={rank}
            className={`${grid} rounded-sm ${isSelf ? "text-white" : "text-stone-600"}`}
            style={isSelf ? { backgroundColor: color } : undefined}
            title={`${r.name} — ${(col.m(r) / gp).toFixed(1)}/${(att / gp).toFixed(1)} per game at ${col.sub}${col.dist ? ` (${col.dist})` : ""}, ${(v > 0 ? "+" : "") + v.toFixed(2)} VA/G`}
            aria-current={isSelf ? "true" : undefined}
          >
            <span className="text-right text-[8px] opacity-70">{rank}</span>
            <span className="truncate text-[9px] font-medium">{compName(r.name)}</span>
            <span className={`text-right text-[9px] font-semibold ${!isSelf && v < 0 ? "text-red-600" : ""}`}>{(v > 0 ? "+" : "") + v.toFixed(2)}</span>
            <span className={`text-right text-[7px] leading-[1.15] ${isSelf ? "text-white/80" : "text-stone-500"}`}>
              {`${(col.m(r) / gp).toFixed(1)}/${(att / gp).toFixed(1)}`}<br />{att > 0 ? `${((col.m(r) / att) * 100).toFixed(0)}%` : "–"}
            </span>
          </div>
        );
      })}
    </div>
  );
}


export function ShootingCompare({ a: aProp, b: bProp, context }) {
  const lgaOf = useRowLga(context?.scope);
  // Re-resolved against the live pool so the USG-ADJ switch moves both sides
  // together (see useFreshRows).
  const { freshSide } = useFreshRows(context);
  const a = useMemo(() => freshSide(aProp), [freshSide, aProp]);
  const b = useMemo(() => freshSide(bProp), [freshSide, bProp]);
  const lgaA = lgaOf(a), lgaB = lgaOf(b);
  const uid = useId().replace(/:/g, "");
  // A tapped distance column opens both players' season leaderboards at that
  // distance, side by side under the chart. Tap it again to close.
  const [selCol, setSelCol] = useState(null);

  const ok = canShootCompare(a, b, lgaA, lgaB);
  const A = useMemo(() => (ok ? shotSide(a, lgaA) : null), [ok, a, lgaA]);
  const B = useMemo(() => (ok ? shotSide(b, lgaB) : null), [ok, b, lgaB]);

  const ca = teamColor(a.team);
  const pal = useMemo(() => comparePalette(b.team, ca), [b.team, ca]);
  const cbFill = withAlpha(pal.light, B_FILL);

  if (!ok) {
    return (
      <div className="my-1.5 px-2 py-3 bg-white border border-stone-200 rounded text-[10px] text-stone-500 italic text-center">
        No shot-distance data for {!hasZoneData(a) || !lgaA?.zoneFG ? shortName(a.name) : shortName(b.name)} in this season
        (shot locations start in 1996-97) — switch to Box Score VA to compare.
      </div>
    );
  }

  // One scale across all twelve bars so heights compare between columns and
  // between players. The zero line sits where the values need it rather than
  // dead centre: two good shooters rarely dip far below league average, and a
  // mirrored scale would spend half the chart on empty space. Each side keeps
  // some headroom, and the whole span is floored so two near-average shooters
  // don't have their slivers blown up to full height.
  const vals = [...A.cols, ...B.cols].map((c) => zeroed(c.v));
  let up = Math.max(0, ...vals), down = Math.max(0, ...vals.map((v) => -v));
  const span0 = Math.max(0.5, up + down);
  up = Math.max(up, span0 * 0.2);
  down = Math.max(down, span0 * 0.2);
  const span = (up + down) * 1.05;
  const zeroPct = (down * 1.05 / span) * 100; // zero line, from the bottom
  const wins = A.cols.reduce((t, c, i) => {
    const d = zeroed(c.v) - zeroed(B.cols[i].v);
    if (d > 0) t.a += 1; else if (d < 0) t.b += 1;
    return t;
  }, { a: 0, b: 0 });
  const peak = Math.max(...A.cols.map((c) => c.share), ...B.cols.map((c) => c.share));
  const valColor = (v) => (zeroed(v) > 0.05 ? "text-green-600" : zeroed(v) < -0.05 ? "text-red-600" : "text-stone-400");

  // Header swatches: A solid, B pale-with-outline — the bars' own fills.
  const Swatch = ({ side }) => (
    <span
      className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
      style={side === "a" ? { backgroundColor: ca } : { backgroundColor: cbFill, border: `1px solid ${pal.base}` }}
    />
  );
  const sideRow = (side, r, S) => (
    <div className="flex items-center gap-1.5 min-w-0">
      <Swatch side={side} />
      <span className="font-semibold truncate" style={{ color: side === "a" ? ca : pal.ink }}>{shortName(r.name)}</span>
      <span className="shrink-0 text-stone-400 text-[9px] tabular-nums">{rowSeasonLabel(r)}</span>
      <span className="ml-auto shrink-0 flex items-baseline gap-2 text-[8px] uppercase tracking-wider text-stone-400">
        <span title="Efficiency — 3P + 2P + FT value added per game">Eff <span className={`text-[9px] font-bold tabular-nums ${valColor(S.eff)}`}>{sgn(S.eff)}</span></span>
        <span title="Impact — the six shot-distance values below, summed (per game)">Impact <span className={`text-[9px] font-bold tabular-nums ${valColor(S.impact)}`}>{sgn(S.impact)}</span></span>
      </span>
    </div>
  );

  // A pie-slice disc for one side's share at one distance — the category
  // card's shot-distribution glyph, tinted with that side's color.
  const Disc = ({ share, side }) => {
    if (!(share > 0)) return <div className="h-9" />;
    const rel = peak > 0 ? share / peak : 0;
    const d = Math.max(6, 28 * Math.sqrt(rel));
    const th = Math.min(share, 0.9999) * 2 * Math.PI;
    const x0 = 50 - 50 * Math.sin(th / 2), x1 = 50 + 50 * Math.sin(th / 2);
    const y = 50 - 50 * Math.cos(th / 2);
    const slice = side === "a" ? ca : pal.base;
    return (
      <div className="h-9 flex items-center justify-center">
        <svg width={d * 1.4} height={d * 1.4} viewBox="-20 -20 140 140" aria-hidden="true" className="overflow-visible">
          <circle cx="50" cy="50" r="50" className="fill-stone-300" fillOpacity="0.6" filter={`url(#${uid}-soft)`} />
          <path
            d={`M50 50 L${x0} ${y} A50 50 0 ${th > Math.PI ? 1 : 0} 1 ${x1} ${y} Z`}
            fill={side === "a" ? slice : withAlpha(pal.light, 0.85)}
            stroke={side === "a" ? "none" : slice}
            strokeWidth={side === "a" ? 0 : 4}
            fillOpacity={side === "a" ? 0.6 + 0.35 * rel : 1}
            filter={`url(#${uid}-slice)`}
          />
        </svg>
      </div>
    );
  };

  const grid = { gridTemplateColumns: `repeat(${SHOT_COLS.length}, minmax(0, 1fr))` };
  const sel = SHOT_COLS.find((c) => c.key === selCol) || null;
  const boardA = sel ? zoneBoard(a, sel, context, lgaOf) : null;
  const boardB = sel ? zoneBoard(b, sel, context, lgaOf) : null;

  return (
    <div
      className="my-1.5 px-2 py-2 bg-white border border-stone-200 rounded text-[10px] space-y-2"
      role="group"
      aria-label={`Shooting comparison: ${a.name} vs ${b.name}`}
    >
      <div className="space-y-0.5 [&>svg+*]:!mt-0">
        {/* Shared blur filters for every disc in this panel — inside the first
            block so the panel's own spacing doesn't count it as a row. */}
        <svg width="0" height="0" className="absolute" aria-hidden="true">
          <defs>
            <filter id={`${uid}-soft`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12" /></filter>
            <filter id={`${uid}-slice`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2" /></filter>
          </defs>
        </svg>
        {sideRow("a", a, A)}
        {sideRow("b", b, B)}
      </div>

      <div className="border-t border-stone-100 pt-2">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="uppercase tracking-wider text-[9px] text-stone-400 truncate">Scoring · by shot distance</span>
          <span className="shrink-0 text-[8px] uppercase tracking-wider text-stone-400" title="Distances where each side added more value per game">
            Zones{" "}
            <span className="text-[9px] font-bold tabular-nums" style={{ color: ca }}>{wins.a}</span>
            <span className="text-stone-300">–</span>
            <span className="text-[9px] font-bold tabular-nums" style={{ color: pal.ink }}>{wins.b}</span>
          </span>
        </div>
        <div className="grid grid-cols-6 gap-1 text-[7px] uppercase tracking-wider text-stone-400">
          <div className="col-span-1 text-center">FT</div>
          <div className="col-span-4 text-center border-x border-stone-200">2-Pointers</div>
          <div className="col-span-1 text-center">3PT</div>
        </div>
        <div className="grid gap-1 items-start mt-1" style={grid}>
          {SHOT_COLS.map((c, i) => {
            const av = zeroed(A.cols[i].v), bv = zeroed(B.cols[i].v);
            const bar = (v, side) => {
              const h = (Math.abs(v) / span) * 100;
              const style = v >= 0 ? { bottom: `${zeroPct}%`, height: `${h}%` } : { top: `${100 - zeroPct}%`, height: `${h}%` };
              return (
                <div
                  className={`absolute w-2.5 ${v >= 0 ? "rounded-t-sm" : "rounded-b-sm"}`}
                  style={{
                    ...style,
                    left: side === "a" ? "calc(50% - 11px)" : "calc(50% + 1px)",
                    ...(side === "a"
                      ? { backgroundColor: ca }
                      : { backgroundColor: cbFill, border: `1px solid ${pal.base}` }),
                  }}
                />
              );
            };
            const fg = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
            const aWin = av > bv, bWin = bv > av;
            const isSel = selCol === c.key;
            const toggle = () => setSelCol(isSel ? null : c.key);
            return (
              <div
                key={c.key}
                role="button"
                tabIndex={0}
                aria-pressed={isSel}
                onClick={toggle}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
                className={`flex flex-col items-center min-w-0 cursor-pointer rounded py-1 -my-1 transition-colors ${isSel ? "bg-stone-200 ring-1 ring-stone-800" : "hover:bg-stone-100"}`}
                title={`${c.sub}${c.dist ? ` (${c.dist})` : ""} — ${shortName(a.name)} ${A.cols[i].ma} (${fg(A.cols[i].fg)}) ${sgn(av)}/G · ${shortName(b.name)} ${B.cols[i].ma} (${fg(B.cols[i].fg)}) ${sgn(bv)}/G`}
              >
                <span className="text-[10px] font-bold tabular-nums leading-none" style={{ color: ca }}>{fg(A.cols[i].fg)}</span>
                <span className="text-[9px] font-semibold tabular-nums leading-none mt-0.5" style={{ color: pal.ink }}>{fg(B.cols[i].fg)}</span>
                <div className="relative self-stretch -mx-0.5 h-20 my-1.5">
                  <div className="absolute inset-x-0 h-px bg-stone-400" style={{ bottom: `${zeroPct}%` }} title="league average" />
                  {bar(av, "a")}
                  {bar(bv, "b")}
                </div>
                {/* Each side's value in its own color, the zone's winner bold. */}
                <span className={`text-[8px] tabular-nums leading-none ${aWin ? "font-bold" : "font-medium opacity-60"}`} style={{ color: ca }}>{sgn(av)}</span>
                <span className={`text-[8px] tabular-nums leading-none mt-0.5 ${bWin ? "font-bold" : "font-medium opacity-60"}`} style={{ color: pal.ink }}>{sgn(bv)}</span>
                <span className="mt-0.5 text-[7px] uppercase tracking-wide text-stone-400 leading-tight text-center">{c.sub}</span>
                {c.dist && <span className="text-[6px] uppercase text-stone-400 leading-tight text-center tabular-nums">{c.dist}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {sel && (
        <div className="border-t border-stone-100 pt-2">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="uppercase tracking-wider text-[9px] text-stone-400 truncate">
              {sel.sub}{sel.dist ? ` · ${sel.dist}` : ""} rankings · each in his own season
            </span>
            <button type="button" onClick={() => setSelCol(null)} className="shrink-0 text-[9px] text-stone-400 hover:text-stone-700">{sel.sub} ✕</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ZoneBoard board={boardA} row={a} col={sel} color={ca} ink={ca} />
            <ZoneBoard board={boardB} row={b} col={sel} color={pal.base} ink={pal.ink} />
          </div>
          <div className="text-[8px] italic text-stone-400 mt-1 px-0.5 leading-[1.3]">
            Ranked by per-game {sel.sub} value added among that season’s players with ≥1 {sel.key === "ft" ? "FTA" : "attempt"} per team game there{boardA && boardB ? ` (at least ${boardA.floor} and ${boardB.floor} ${sel.key === "ft" ? "FTA" : "attempts"})` : ""} · {sel.sub} column = made/attempted per game and FG%.
          </div>
        </div>
      )}

      <div className="border-t border-stone-100 pt-1.5">
        <div className="uppercase tracking-wider text-[8px] text-stone-400 px-1">Shot distribution</div>
        <div className="grid gap-1 items-center mt-1" style={grid}>
          {SHOT_COLS.map((c, i) => {
            const as = A.cols[i].share, bs = B.cols[i].share;
            const diff = Math.round(as * 100) - Math.round(bs * 100);
            return (
              <div
                key={c.key}
                className="flex flex-col items-center min-w-0"
                title={`${c.sub}: ${shortName(a.name)} ${(as * 100).toFixed(0)}% · ${shortName(b.name)} ${(bs * 100).toFixed(0)}% of shots${c.key === "ft" ? " (FTA ÷ 2.2)" : ""}`}
              >
                <Disc share={as} side="a" />
                <span className="text-[8px] tabular-nums leading-none font-semibold" style={{ color: ca }}>{(as * 100).toFixed(0)}%</span>
                <Disc share={bs} side="b" />
                <span className="text-[8px] tabular-nums leading-none font-semibold" style={{ color: pal.ink }}>{(bs * 100).toFixed(0)}%</span>
                <span className={`mt-1 text-[7px] tabular-nums leading-none ${diff === 0 ? "text-stone-300" : "text-stone-500"}`}>
                  {diff === 0 ? "=" : `${diff > 0 ? "+" : ""}${diff}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-[8px] italic text-stone-400 px-1 leading-[1.3]">
        Per-game value added at each distance, each player against his own season’s league FG% there · bold = the better of the two at that distance · tap a distance for both seasons’ rankings there · bottom line = {shortName(a.name)}’s share minus {shortName(b.name)}’s, in points.
      </div>
    </div>
  );
}
