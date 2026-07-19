"use client";

import { GOLD, withAlpha } from "../lib/format";


export function GameVAChart({ values, color = "#57534e", selected, onSelect, partitions, seriesRange, label = "VA by Game", avgOther = null, avgSelected = null, overlayValues = null, overlayColor = "#57534e" }) {
  const stroke = color;
  // Always show at least 4 game slots; pad with nulls so G1..G4 render even
  // for 1- or 2-game series. The comparison overlay (if any) can be longer
  // than the primary run — the x-domain covers both, aligned at game 1.
  const n = Math.max(values.length, overlayValues?.length || 0, 4);
  const padded = values.length >= n ? values : [...values, ...Array(n - values.length).fill(null)];
  const overlay = overlayValues
    ? (overlayValues.length >= n ? overlayValues : [...overlayValues, ...Array(n - overlayValues.length).fill(null)])
    : null;
  const W = 320, H = 100;
  const pad = { l: 14, r: 10, t: 22, b: 8 };
  // Only the top-scoring dot gets a value label (max anchor for scale).
  let topIdx = -1, topVal = -Infinity;
  padded.forEach((v, i) => { if (v != null && v > topVal) { topVal = v; topIdx = i; } });
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  // Extra strip below the plotting area where the avg-delta label parks,
  // directly beneath the shaded band so it never overlaps the data.
  const STRIP = 13;
  const nums = [...padded, ...(overlay || [])].filter((v) => v != null);
  let vMin = Math.min(0, ...(nums.length ? nums : [0]));
  let vMax = Math.max(0, ...(nums.length ? nums : [0]));
  if (vMin === vMax) { vMin -= 1; vMax += 1; }
  const x = (i) => pad.l + (i / (n - 1)) * innerW;
  const y = (v) => pad.t + (1 - (v - vMin) / (vMax - vMin)) * innerH;
  // color (the player's accent) is already set above as `stroke`.

  let d = "";
  for (let i = 0; i < n; i++) {
    if (padded[i] == null) continue;
    d += `${(i === 0 || padded[i - 1] == null) ? "M" : "L"} ${x(i)} ${y(padded[i])} `;
  }
  let dOverlay = "";
  if (overlay) {
    for (let i = 0; i < n; i++) {
      if (overlay[i] == null) continue;
      dOverlay += `${(i === 0 || overlay[i - 1] == null) ? "M" : "L"} ${x(i)} ${y(overlay[i])} `;
    }
  }

  return (
    <div className="mt-2 mb-3">
      <div className="text-[9px] uppercase tracking-widest text-stone-500 mb-1 text-center">{label}</div>
      <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + STRIP}`} className="w-full block">
        {/* Series-band shading (used when a series is selected but no
            single game has been drilled into) */}
        {selected == null && Array.isArray(seriesRange) && (() => {
          const colW = innerW / (n - 1);
          const [a, b] = seriesRange;
          return (
            <rect
              x={x(a) - colW / 2}
              y={0}
              width={x(b) - x(a) + colW}
              height={H}
              fill={withAlpha(stroke, 0.10)}
              stroke={withAlpha(stroke, 0.30)}
              strokeWidth="1"
            />
          );
        })()}
        {/* Selected column shading sits behind everything else */}
        {selected != null && padded[selected - 1] != null && (() => {
          const colW = innerW / (n - 1);
          return (
            <rect
              x={x(selected - 1) - colW / 2}
              y={0}
              width={colW}
              height={H}
              fill={withAlpha(stroke, 0.12)}
              stroke={withAlpha(stroke, 0.35)}
              strokeWidth="1"
            />
          );
        })()}
        {/* Zero axis: SOLID and marked with a "0" in the left gutter, so
            it's plainly the baseline and never blurs into the dashed/
            dotted gray average reference lines. */}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#78716c" strokeWidth="1" />
        <text x={pad.l - 3} y={y(0)} fontSize="7" textAnchor="end" dominantBaseline="middle" fill="#78716c" className="tabular-nums">0</text>
        {/* Reference: dim full-width line at the average of the "other"
            games (other series in series view, other games in game view). */}
        {avgOther != null && (
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(avgOther)}
            y2={y(avgOther)}
            stroke="#a8a29e"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
        {/* Reference: solid line at the average of the selected series,
            drawn only inside the series band (game-view doesn't get the
            line — its selected column already shows the value). */}
        {avgSelected != null && Array.isArray(seriesRange) && (() => {
          const colW = innerW / (n - 1);
          const [a, b] = seriesRange;
          return (
            <line
              x1={x(a) - colW / 2}
              x2={x(b) + colW / 2}
              y1={y(avgSelected)}
              y2={y(avgSelected)}
              stroke={stroke}
              strokeWidth="1.5"
              opacity="0.85"
            />
          );
        })()}
        {/* Series partitions: dotted vertical between i-1 and i */}
        {(partitions || []).map((j) => {
          if (j <= 0 || j >= n) return null;
          const px = (x(j - 1) + x(j)) / 2;
          return (
            <line
              key={`part-${j}`}
              x1={px} x2={px}
              y1={pad.t - 6}
              y2={H - pad.b + 4}
              stroke="#a8a29e"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          );
        })}
        {/* Comparison overlay run: dashed team-color line with gold-ringed
            dots (the compared player's identity system), under the main line. */}
        {overlay && (
          <>
            <path d={dOverlay} fill="none" stroke={overlayColor} strokeWidth="1.5" strokeDasharray="5 3" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
            {overlay.map((v, i) => v == null ? null : (
              <circle key={`odot-${i}`} cx={x(i)} cy={y(v)} r="2.6" fill={withAlpha(overlayColor, 0.25)} stroke={GOLD} strokeWidth="1.2" />
            ))}
          </>
        )}
        <path d={d} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        {padded.map((v, i) => v == null ? null : (
          <g key={`dot-${i}`}>
            <circle cx={x(i)} cy={y(v)} r={selected === i + 1 ? 5 : 3.5} fill={stroke} stroke={selected === i + 1 ? "#1c1917" : "none"} strokeWidth="1" />
            {i === topIdx && (
              <text x={x(i)} y={y(v) - 9} fontSize="9" textAnchor="middle" fill={v < 0 ? "#dc2626" : "#44403c"} className="tabular-nums">{v.toFixed(1)}</text>
            )}
          </g>
        ))}
        {/* Avg delta, parked in the strip directly beneath the shaded
            band/column so it never collides with the data. The band ties
            it to the selection horizontally; the two avg reference lines
            still carry the gap visually. Centered under the band and
            clamped to stay on-chart. */}
        {avgSelected != null && avgOther != null && avgSelected !== avgOther && (() => {
          let center;
          if (Array.isArray(seriesRange)) {
            center = (x(seriesRange[0]) + x(seriesRange[1])) / 2;
          } else if (selected != null) {
            center = x(selected - 1);
          } else {
            return null;
          }
          const up = avgSelected > avgOther;
          const rounded = Math.round((avgSelected - avgOther) * 10) / 10;
          const signStr = rounded > 0 ? "+" : "";
          const labelX = Math.max(30, Math.min(W - 30, center));
          return (
            <text x={labelX} y={H + 9} fontSize="9" textAnchor="middle" pointerEvents="none" className="tabular-nums">
              <tspan fill={stroke} fontWeight="600">{`${up ? "▲" : "▼"} ${signStr}${rounded.toFixed(1)}`}</tspan>
              <tspan fill="#78716c" dx="2" fontStyle="italic">{up ? "better" : "worse"}</tspan>
            </text>
          );
        })()}
        {/* Full-height column hit zones, layered last so they capture taps */}
        {padded.map((v, i) => {
          const hasData = v != null;
          if (!hasData || !onSelect) return null;
          const isSel = selected === i + 1;
          const colW = innerW / (n - 1);
          return (
            <rect
              key={`hit-${i}`}
              x={x(i) - colW / 2}
              y={0}
              width={colW}
              height={H}
              fill="transparent"
              className="cursor-pointer"
              onClick={() => onSelect(isSel ? null : i + 1)}
            />
          );
        })}
      </svg>
      </div>
    </div>
  );
}
