"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { HISTORY, scoreHistory, historyRounds } from "./historical";
import { TEAMS, TEAM_CONF, BRACKET, ROUND_BASE, STORAGE_KEY } from "./teams";
import { LGA, valueAdd, valueAddParts, valueAddByCategory, computePoints, potentialPoints, lgaForSeason } from "./scoring";
import TEAM_COLORS from "./data/team-colors.json";

// Per-team primary color (hex). Used in Explore and anywhere we don't have
// an owner mapping (e.g. defunct/renamed franchises in old seasons).
const teamColor = (tri) => TEAM_COLORS[tri] || "#78716c";
const withAlpha = (hex, alpha) => {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
  return hex + a;
};

// Loose name match for joining ESPN box-score names with basketball-reference
// names (regular-season reference tick). Strips punctuation, suffixes like
// "Jr."/"III", collapses whitespace, and folds diacritics so "P.J. Tucker"
// matches "PJ Tucker" and "Luka Dončić" matches "Luka Doncic".
const normalizeName = (s) => (s || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[.''`,]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");

// `dim` = lighten owner styling when both teams in a matchup share an owner,
// to flag the side that wins the series for fewer points (no upset bonus).
const ownerColor = (o, dim) => {
  if (o === "Spencer") return dim ? "text-amber-400" : "text-amber-700";
  if (o === "Trey") return dim ? "text-teal-400" : "text-teal-700";
  return "";
};
const ownerBg = (o) => o === "Spencer" ? "bg-amber-50 border-amber-300" : "bg-teal-50 border-teal-300";
const ownerDot = (o, dim) => {
  if (o === "Spencer") return dim ? "bg-amber-300" : "bg-amber-600";
  if (o === "Trey") return dim ? "bg-teal-300" : "bg-teal-600";
  return "";
};
const ownerBadge = (o) => o === "Spencer" ? "bg-amber-100 text-amber-800" : o === "Trey" ? "bg-teal-100 text-teal-800" : "bg-stone-100 text-stone-600";

function WinCircles({ value, actualValue, onChange, disabled, owner, dim }) {
  const fillColor = owner === "Spencer"
    ? (dim ? "bg-amber-300 border-amber-400" : "bg-amber-500 border-amber-600")
    : (dim ? "bg-teal-300 border-teal-400" : "bg-teal-500 border-teal-600");
  const whatIfColor = owner === "Spencer"
    ? (dim ? "bg-amber-100 border-amber-200" : "bg-amber-200 border-amber-400")
    : (dim ? "bg-teal-100 border-teal-200" : "bg-teal-200 border-teal-400");
  return (
    <div className="flex items-center gap-1 mt-1">
      {[1, 2, 3, 4].map((n) => {
        const filled = value >= n;
        const isReal = n <= (actualValue || 0);
        let cls = "bg-white border-stone-300";
        if (filled) cls = isReal ? fillColor : whatIfColor;
        return (
          <button
            key={n}
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              onChange(filled ? n - 1 : n);
            }}
            disabled={disabled}
            className={`w-3.5 h-3.5 rounded-full border transition-colors ${cls} disabled:opacity-40`}
            aria-label={filled ? `Win ${n} (tap to remove)` : `Add win ${n}`}
          />
        );
      })}
    </div>
  );
}

function GameVAChart({ values, color = "#57534e", selected, onSelect, partitions, seriesRange, label = "VA by Game", avgOther = null, avgSelected = null, overlayValues = null, overlayColor = "#57534e" }) {
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

// Fixed display order for the breakdown rows. Partition dividers go AFTER
// each key in PARTITIONS_AFTER (shooting / playmaking / rebounding groups).
const VA_CATEGORY_ORDER = [
  "Points", "2-Pointers", "3-Pointers", "Free Throws",
  "Assists", "Turnovers",
  "D Rebounds", "O Rebounds",
  "Blocks", "Steals",
];
const VA_PARTITIONS_AFTER = new Set(["Free Throws", "Turnovers", "O Rebounds"]);

// --- Category context (By-Player search only) -------------------------------
// Maps a breakdown category to the raw stat(s) needed to show its rate. Counting
// cats render per-36 or per-game (toggle); shooting cats render made/att (pct).
const CAT_COUNTING = {
  "Points": ["pts", "PTS"], "Assists": ["ast", "AST"], "Steals": ["stl", "STL"],
  "Blocks": ["blk", "BLK"], "Turnovers": ["tov", "TOV"],
  "D Rebounds": ["drb", "DRB"], "O Rebounds": ["orb", "ORB"],
};
const CAT_SHOOTING = {
  "3-Pointers": (r) => [r.tpm, r.tpa],
  "2-Pointers": (r) => [r.fgm - r.tpm, r.fga - r.tpa],
  "Free Throws": (r) => [r.ftm, r.fta],
};
// Short label for a category (used in headings — "Pts", "3P", etc.).
const CAT_SHORT = {
  "Points": "Pts", "2-Pointers": "2P", "3-Pointers": "3P", "Free Throws": "FT",
  "Assists": "Ast", "Turnovers": "TO", "D Rebounds": "DReb", "O Rebounds": "OReb",
  "Blocks": "Blk", "Steals": "Stl",
};
// "Basic" grouping: the ten categories folded into the four buckets the
// detail view's dividers already imply. Order matches the on-screen groups.
const VA_GROUPS = [
  { key: "Scoring", cats: ["Points", "2-Pointers", "3-Pointers", "Free Throws"] },
  { key: "Passing", cats: ["Assists", "Turnovers"] },
  { key: "Rebounds", cats: ["D Rebounds", "O Rebounds"] },
  { key: "Defense", cats: ["Blocks", "Steals"] },
];
const VA_GROUP_BY_KEY = Object.fromEntries(VA_GROUPS.map((g) => [g.key, g]));
// Representative counting stat shown next to a group's summed VA.
const GROUP_STAT = {
  "Scoring": [(r) => r.pts || 0, "PTS"],
  "Passing": [(r) => r.ast || 0, "AST"],
  "Rebounds": [(r) => (r.drb || 0) + (r.orb || 0), "REB"],
  "Defense": [(r) => (r.stl || 0) + (r.blk || 0), "STL+BLK"],
};
// Rate label for one player-season in one category or group, respecting the toggle.
function catRateLabel(r, key, rateMode) {
  if (CAT_SHOOTING[key]) {
    const [m, a] = CAT_SHOOTING[key](r);
    return `${m}/${a} (${a > 0 ? ((m / a) * 100).toFixed(1) : "0.0"}%)`;
  }
  const [statOf, tag] = GROUP_STAT[key] || [];
  const v = statOf ? statOf(r) : (r[CAT_COUNTING[key][0]] || 0);
  const t = tag || CAT_COUNTING[key][1];
  return rateMode === "perG"
    ? `${(v / (r.gp || 1)).toFixed(1)} ${t}/G`
    : `${((v / (r.mp || 1)) * 36).toFixed(1)} ${t}/36`;
}
// Total category (or group) VA for one stat line.
function catVATotal(r, lgaX, key) {
  const by = valueAddByCategory(r, lgaX);
  const g = VA_GROUP_BY_KEY[key];
  return g ? g.cats.reduce((s, c) => s + (by[c] || 0), 0) : (by[key] || 0);
}
// Per-game category VA — the metric the context ranks/plots everything on.
function catVAperGame(r, lgaX, key) {
  return catVATotal(r, lgaX, key) / (r.gp || 1);
}
// Per-game VA vector across all ten categories (VA_CATEGORY_ORDER), one
// valueAddByCategory call. This is the "shape" of a player-season used for the
// closest-comps similarity in the compare picker.
function perGameVAVec(r, lgaX) {
  const by = valueAddByCategory(r, lgaX);
  const gp = r.gp || 1;
  return VA_CATEGORY_ORDER.map((k) => (by[k] || 0) / gp);
}
// Identity match between two player-season rows (slug when both have one,
// else normalized name). Rows within a season pool are unique per player.
function samePlayer(a, b) {
  if (a.slug && b.slug) return a.slug === b.slug;
  return normalizeName(a.name || "") === normalizeName(b.name || "");
}

// Promise-cached JSON fetch so By Season and By Player share one network hit
// for the big payloads (player index, per-season leaderboards, rs totals).
const _jsonCache = new Map();
function fetchJsonCached(url) {
  if (!_jsonCache.has(url)) {
    _jsonCache.set(url, fetch(url)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
        return d;
      })
      .catch((e) => { _jsonCache.delete(url); throw e; }));
  }
  return _jsonCache.get(url);
}

// --- D Rating: the fifth category behind VA+ ---------------------------------
// A player's defensive net rating turned into points: how many points his
// defense saves (or gives up) across the possessions he's actually on the
// floor for. The net splits into two parts so a team-rider on an elite
// defense isn't credited like an anchor:
//
//   net  = (teamDRtg − playerDRtg)  +  w × (leagueDRtg − teamDRtg)
//   dVA  = net/100 × laPOSSperM × MP        VA+ = VA + dVA
//
// The first term is the player's edge over his own team's defense; the
// second inherits a share of the team's collective edge vs league. The
// share w is objective: the equal 1-of-5 split scaled by the player's
// stock-rate (STL+BLK per minute) relative to his team's —
//   w = clamp(0.2 × playerStockRate / teamStockRate, 0.05, 1)
// — which conserves the team pot exactly (shares sum to the team's whole
// edge) and routes it to whoever produces the defensive events. Multi-team
// rows (2TM) and seasons without team maps fall back to the plain
// vs-league form (w=1 on the whole net). DRtg is basketball-reference's
// individual Defensive Rating; the league line is laPTSperPoss×100;
// laPOSSperM (pace/48) converts per-possession into per-minute. Null (→
// hidden in the UI) when the player-season has no rating.
const DEF_TEAM_SHARE_BASE = 0.2; // the equal 1-of-5 defender split
const DEF_TEAM_SHARE_MIN = 0.05, DEF_TEAM_SHARE_MAX = 1;
function defVAInfo(row, viewMp, lgaX, defs, season, pref = "rs") {
  const drtg = defRtgFor(defs, season, row?.slug, pref);
  if (drtg == null || !lgaX || !(lgaX.laPOSSperM > 0) || !(lgaX.laPTSperPoss > 0) || !(viewMp > 0)) return null;
  const la = lgaX.laPTSperPoss * 100;
  const e = defs?.[season];
  const tmap = pref === "po" ? (e?.teamPo || e?.team) : (e?.team || e?.teamPo);
  const t = tmap?.[row?.team];
  let net, w = null, teamDrtg = null;
  if (t && t.drtg > 0 && t.stkpm > 0 && row.mp > 0) {
    const ratio = (((row.stl || 0) + (row.blk || 0)) / row.mp) / t.stkpm;
    w = Math.max(DEF_TEAM_SHARE_MIN, Math.min(DEF_TEAM_SHARE_MAX, DEF_TEAM_SHARE_BASE * ratio));
    teamDrtg = t.drtg;
    net = (teamDrtg - drtg) + w * (la - teamDrtg);
  } else {
    net = la - drtg;
  }
  return { dva: (net / 100) * lgaX.laPOSSperM * viewMp, drtg, w, teamDrtg, laDRtg: la };
}

// DRtg lookup for a player-season. `pref` picks the sample: "po" for playoff
// views, "rs" otherwise; the other side is the fallback so a player with only
// one sample still gets a rating.
function defRtgFor(defs, season, slug, pref = "rs") {
  if (!defs || !season || !slug) return null;
  const e = defs[season];
  if (!e) return null;
  const other = pref === "po" ? "rs" : "po";
  return e[pref]?.[slug] ?? e[other]?.[slug] ?? null;
}

// One shared fetch of the baked ratings; components render without them
// (VA+ simply absent) until the map arrives.
function useDefRatings() {
  const [defs, setDefs] = useState(null);
  useEffect(() => {
    let ok = true;
    fetchJsonCached("/api/def-ratings")
      .then((d) => { if (ok) setDefs(d.seasons || {}); })
      .catch(() => {});
    return () => { ok = false; };
  }, []);
  return defs;
}

// Flatten a /api/players index into the pools CategoryContext ranks against:
// every player-season row (all-time pool) plus the same rows grouped by
// season. Rows are tagged with the owner's name + slug for identity checks.
function buildScopePools(indexPlayers) {
  const allRows = [];
  const poolsBySeason = new Map();
  for (const pl of indexPlayers) {
    for (const s of pl.seasons) {
      const row = { ...s, name: pl.name, slug: pl.slug || null };
      allRows.push(row);
      if (!poolsBySeason.has(s.season)) poolsBySeason.set(s.season, []);
      poolsBySeason.get(s.season).push(row);
    }
  }
  return { allRows, poolsBySeason };
}

// Find the index entry for a leaderboard/rs row (slug first, then name).
function findIndexPlayer(indexPlayers, row) {
  if (!indexPlayers) return null;
  if (row.slug) {
    const hit = indexPlayers.find((pl) => pl.slug === row.slug);
    if (hit) return hit;
  }
  const n = normalizeName(row.name || "");
  return indexPlayers.find((pl) => normalizeName(pl.name) === n) || null;
}

// Helper: aggregate raw stat snapshots into a player object matching what
// VABreakdown expects (mp/pts/.../fgm/.../va), preserving identity.
function aggregateSnapshots(base, snapshots) {
  const out = {
    name: base.name, team: base.team,
    gp: 0, va: 0, eff: 0,
    mp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
    fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, drb: 0, orb: 0,
  };
  for (const s of snapshots) {
    if (!s) continue;
    out.gp += 1;
    out.va += s.va || 0;
    for (const k of ["mp", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "drb", "orb"]) {
      out[k] += s[k] || 0;
    }
  }
  return out;
}

function VABreakdown({ p: pSeries, lga = LGA, teams = TEAMS, rate = false, gameNumber, gameSeries, byGame, gameContext, partitions, onPrev, onNext, useTeamColor = false, breakdownTitle, gameTileLabel = "Game", enableSeriesDrill = false, regularSeasonTotals = null, playerConf = null, context = null, season = null, defScope = "rs" }) {
  // Tap a game on the chart to swap in that game's stats. When the chart
  // spans multiple series (playoff leaderboard), tapping is a two-step
  // drill: first tap selects the series the game belongs to (series
  // aggregate), second tap on a game in that series drills into the game.
  const [selectedGame, setSelectedGame] = useState(null);
  const [selectedSeriesIdx, setSelectedSeriesIdx] = useState(null);
  // Tap a category row to swap the spark-line out of total VA and into
  // that category's per-game contribution (e.g. "2-Pointers" → 2P VA in
  // each game). Tap again to clear.
  const [selectedCategory, setSelectedCategory] = useState(null);
  // "basic" folds the ten categories into the four Scoring/Passing/
  // Rebounds/Defense buckets with summed VA; "detail" is the full list.
  const [viewMode, setViewMode] = useState("detail");
  const switchView = (m) => { setViewMode(m); setSelectedCategory(null); };
  // Head-to-head comparison against another player-season from the same scope.
  const [compare, setCompare] = useState(null);
  const [picking, setPicking] = useState(false);
  const [compareMode, setCompareMode] = useState("values"); // "values" | "pct"
  // The compared player's own playoff game log (per-game VA), overlaid onto
  // the VA-by-Game chart above (aligned at game 1) while comparing.
  const [compareRun, setCompareRun] = useState(null);
  useEffect(() => {
    if (!compare) { setCompareRun(null); return; }
    let cancelled = false;
    setCompareRun(null);
    fetchJsonCached(`/api/leaderboard?season=${compare.row.season}`)
      .then((dd) => {
        if (cancelled) return;
        const nn = normalizeName(compare.name || "");
        const pl = (dd.players || []).find((x) => (compare.slug && x.slug === compare.slug) || normalizeName(x.name) === nn);
        const run = (pl?.games || []).filter((g) => g.va != null).map((g) => g.va);
        setCompareRun(run.length ? run : null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [compare]);
  // Per-36 vs per-game normalization for the counting-stat labels (PTS,
  // AST, DRB, etc.). Only meaningful in multi-game series/playoff views;
  // hidden in the single-game drill-in where raw counts are shown.
  const [rateMode, setRateMode] = useState("perG");
  // Baked defensive ratings (the D-Rating category / VA+). Must load before
  // the early returns below — hooks are unconditional.
  const defs = useDefRatings();
  const canSelect = rate && Array.isArray(byGame) && byGame.some((b) => b);
  const canDrillToSeries = enableSeriesDrill && Array.isArray(gameContext);
  // Category rows are tappable when tapping can do something: swap the chart
  // (multi-game views) and/or open the league-context panel.
  const canSelectCategory = canSelect || !!context;
  // The context panel compares season totals against the season pool, so it
  // only renders at the aggregate level — not on a drilled game or series.
  const atSeasonLevel = !selectedGame && selectedSeriesIdx == null;

  let p;
  if (canSelect && selectedGame) {
    p = byGame[selectedGame - 1] || pSeries;
  } else if (canDrillToSeries && selectedSeriesIdx != null && byGame) {
    const subset = byGame.filter((s, i) => s && gameContext[i]?.seriesIdx === selectedSeriesIdx);
    p = aggregateSnapshots(pSeries, subset);
  } else {
    p = pSeries;
  }
  const effectiveGameNumber = selectedGame || gameNumber;

  const mp = p.mp || 0;
  if (mp <= 0) return null;

  // When the user drills into one game we want raw single-game labels
  // ("33 PTS", "3/5 3P"), matching the per-game box-row breakdown — not
  // the per-36 / pct view used for the series aggregate.
  const effectiveRate = rate && !selectedGame;
  // Multi-game views get the VA/Game tile; single-game drill-ins don't
  // (VA/Game would just echo the Total VA banner).
  const multiGame = (p.gp || 1) > 1;

  const twoPm = p.fgm - p.tpm, twoPa = p.fga - p.tpa;
  const tpAdd = ((p.tpm / (p.tpa || 1)) - lga.la3P) * p.tpa;
  const twoAdd = ((twoPm / (twoPa || 1)) - lga.la2P) * twoPa;
  const ftAdd = ((p.ftm / (p.fta || 1)) - lga.laFT) * p.fta;

  // For series: counting stats as per-36 or per-game (user-toggleable),
  // shooting as made/att (pct%). Single-game drill-in keeps raw counts.
  const r36 = (v, tag) => `${(mp > 0 ? (v / mp) * 36 : 0).toFixed(1)} ${tag}/36`;
  const rG  = (v, tag) => `${(p.gp > 0 ? v / p.gp : 0).toFixed(1)} ${tag}/G`;
  const shot = (m, att) => `${m}/${att} (${att > 0 ? ((m / att) * 100).toFixed(1) : "0.0"}%)`;
  const cnt = (v, tag) => {
    if (!effectiveRate) return `${v} ${tag}`;
    return rateMode === "perG" ? rG(v, tag) : r36(v, tag);
  };
  const shoot = (m, att, tag) => (effectiveRate ? shot(m, att) : `${m}/${att} ${tag}`);

  const categories = [
    { key: "Points", value: ((p.pts / mp) - lga.laPTSperM) * mp, label: cnt(p.pts, "PTS") },
    { key: "3-Pointers", value: 3 * tpAdd, label: shoot(p.tpm, p.tpa, "3P") },
    { key: "2-Pointers", value: 2 * twoAdd, label: shoot(twoPm, twoPa, "2P") },
    { key: "Free Throws", value: ftAdd, label: shoot(p.ftm, p.fta, "FT") },
    { key: "Assists", value: ((p.ast / mp) - lga.laASTperM) * mp * lga.laPTSperMake * (1 - lga.laFG), label: cnt(p.ast, "AST") },
    { key: "Steals", value: ((p.stl / mp) - lga.laSTLperM) * mp * lga.laPTSperPoss, label: cnt(p.stl, "STL") },
    { key: "Blocks", value: ((p.blk / mp) - lga.laBLKperM) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.blk, "BLK") },
    { key: "Turnovers", value: -((p.tov / mp) - lga.laTOVperM) * mp * lga.laPTSperPoss, label: cnt(p.tov, "TOV") },
    { key: "D Rebounds", value: ((p.drb / mp) - lga.laDRBperM) * mp * lga.laPTSperPoss * lga.laORBrate, label: cnt(p.drb, "DRB") },
    { key: "O Rebounds", value: ((p.orb / mp) - lga.laORBperM) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.orb, "ORB") },
  ].sort((a, b) => VA_CATEGORY_ORDER.indexOf(a.key) - VA_CATEGORY_ORDER.indexOf(b.key));

  // "Basic" rows: each group's member categories summed, labeled with the
  // group's representative counting stat.
  const groupRows = VA_GROUPS.map((g) => {
    const [statOf, tag] = GROUP_STAT[g.key];
    return {
      key: g.key,
      value: g.cats.reduce((s, k) => s + (categories.find((c) => c.key === k)?.value || 0), 0),
      label: cnt(statOf(p), tag),
    };
  });
  // The fifth category — D Rating — and VA+ (= VA + dVA). The season DRtg
  // (and season stock rate, for the team-share weight) come from the season
  // aggregate; the current view's minutes scale it, so a drilled game shows
  // that game's share. No drill-in: DRtg is one season-level number, not a
  // stat with per-game splits.
  const seasonKey = season || pSeries.season || null;
  const dInfo = defVAInfo(pSeries, mp, lga, defs, seasonKey, defScope);
  const drtg = dInfo?.drtg ?? null;
  const dVA = dInfo?.dva ?? null;
  const vaPlus = dVA != null ? (p.va || 0) + dVA : null;
  if (dVA != null) {
    groupRows.push({ key: "D Rating", value: dVA, label: `${Math.round(drtg)} DRTG`, noDrill: true });
  }
  const activeRows = viewMode === "basic" ? groupRows : categories;

  // Per-game series for the spark line. Defaults to whatever the caller
  // passed (raw per-game VA), but flips to a single category's (or group's)
  // per-game contribution when the user taps a row.
  const chartValues = (selectedCategory && Array.isArray(byGame))
    ? byGame.map((snap) => {
        if (!snap) return null;
        const v = catVATotal(snap, lga, selectedCategory);
        return Number.isFinite(v) ? v : null;
      })
    : gameSeries;
  const chartLabel = selectedCategory ? `${selectedCategory} VA by Game` : "VA by Game";

  // Per-category regular-season reference: the player's RS season VA-per-game
  // scaled to the games shown in the current view (1 when a single game is
  // drilled in, p.gp otherwise). Rendered as a vertical tick on each bar so
  // the reader sees "actual vs. what this player would normally produce".
  // Hidden when the player has no RS sample (rookie, two-way, etc.).
  const referenceScale = selectedGame ? 1 : (p.gp || 1);
  const refByKey = (() => {
    if (!regularSeasonTotals || !(regularSeasonTotals.g > 0) || !(regularSeasonTotals.mp > 0)) return null;
    const full = valueAddByCategory(regularSeasonTotals, lga);
    const out = {};
    for (const k of Object.keys(full)) out[k] = (full[k] / regularSeasonTotals.g) * referenceScale;
    for (const g of VA_GROUPS) out[g.key] = g.cats.reduce((s, c) => s + (out[c] || 0), 0);
    // D Rating reference: the player's rs defensive value over rs minutes,
    // per game — same "what he normally produces" tick the groups get.
    const dRef = defVAInfo(regularSeasonTotals, regularSeasonTotals.mp, lga, defs, seasonKey, "rs")?.dva ?? null;
    if (dRef != null) out["D Rating"] = (dRef / regularSeasonTotals.g) * referenceScale;
    return out;
  })();

  const refMagnitudes = refByKey ? activeRows.map((c) => Math.abs(refByKey[c.key] || 0)) : [];
  const maxAbs = Math.max(...activeRows.map((c) => Math.abs(c.value)), ...refMagnitudes, 0.5);
  const owner = teams[p.team]?.owner;
  // Accent color drives the chart line/dot and the positive bars. Historical
  // and explore contexts use the player's team color; live/draft uses the
  // owner's color so the competition stays the dominant visual.
  const accentColor = useTeamColor
    ? teamColor(p.team)
    : owner === "Spencer" ? "#d97706"
    : owner === "Trey" ? "#0d9488"
    : "#57534e";
  const keyW = effectiveRate ? "w-16" : "w-20";
  const labelW = effectiveRate ? "w-[5.25rem]" : "w-12";

  // Nav: in single-game series view, advance within byGame; otherwise hand
  // off to the parent's prev/next (player navigation). Series-aggregate
  // view hides the nav entirely — chevrons there were too cluttered.
  const inGameNav = canSelect && selectedGame != null;

  // Two-step drill click handler. Without enableSeriesDrill it's the
  // existing toggle. With it: first tap on a game in a different series
  // scopes to that series; another tap on a game in the current series
  // drills into that game; a tap on the currently-selected game clears it.
  const handleChartSelect = (gameIdx) => {
    if (!canSelect) return;
    if (gameIdx == null) {
      setSelectedGame(null);
      return;
    }
    if (!canDrillToSeries) {
      setSelectedGame(selectedGame === gameIdx ? null : gameIdx);
      return;
    }
    const tappedSeriesIdx = gameContext[gameIdx - 1]?.seriesIdx;
    if (selectedSeriesIdx === tappedSeriesIdx) {
      setSelectedGame(selectedGame === gameIdx ? null : gameIdx);
    } else {
      setSelectedSeriesIdx(tappedSeriesIdx);
      setSelectedGame(null);
    }
  };

  // Series band for the chart: highlight all games in the selected series
  // when we're in series-aggregate view (no single game picked).
  let seriesRange = null;
  if (canDrillToSeries && selectedSeriesIdx != null && !selectedGame) {
    const idxs = gameContext
      .map((g, i) => (g?.seriesIdx === selectedSeriesIdx ? i : -1))
      .filter((i) => i >= 0);
    if (idxs.length) seriesRange = [idxs[0], idxs[idxs.length - 1]];
  }
  // Reference averages for the chart. Two modes:
  // - Series selected: avgOther = mean across games NOT in the selected
  //   series (dim dashed line); avgSelected = mean across the selected
  //   series (solid line within the band) + up/down caret vs avgOther.
  // - Single game drilled in: avgOther = mean across the OTHER games
  //   (dim dashed line); avgSelected = the selected game's value
  //   (drives the caret direction).
  // Skipped when there's only one series / one game with data — nothing
  // to compare against.
  let avgOther = null;
  let avgSelected = null;
  if (Array.isArray(chartValues)) {
    const validIdxs = chartValues
      .map((v, i) => (v == null ? -1 : i))
      .filter((i) => i >= 0);
    const mean = (idxs) => idxs.reduce((s, i) => s + chartValues[i], 0) / idxs.length;
    if (canDrillToSeries && selectedSeriesIdx != null && !selectedGame && Array.isArray(gameContext)) {
      const inSel = validIdxs.filter((i) => gameContext[i]?.seriesIdx === selectedSeriesIdx);
      const outSel = validIdxs.filter((i) => gameContext[i]?.seriesIdx !== selectedSeriesIdx);
      if (inSel.length && outSel.length) {
        avgSelected = mean(inSel);
        avgOther = mean(outSel);
      }
    } else if (selectedGame != null) {
      const others = validIdxs.filter((i) => i !== selectedGame - 1);
      const selVal = chartValues[selectedGame - 1];
      if (others.length && selVal != null) {
        avgOther = mean(others);
        avgSelected = selVal;
      }
    }
  }
  const showNav = !rate || inGameNav;
  const findGameWithData = (start, step) => {
    for (let i = start; i >= 0 && i < byGame.length; i += step) {
      if (byGame[i]) return i + 1;
    }
    return null;
  };
  const gameNavPrev = inGameNav ? findGameWithData(selectedGame - 2, -1) : null;
  const gameNavNext = inGameNav ? findGameWithData(selectedGame, 1) : null;
  const canPrev = inGameNav ? gameNavPrev != null : !!onPrev;
  const canNext = inGameNav ? gameNavNext != null : !!onNext;
  const handlePrev = () => inGameNav ? setSelectedGame(gameNavPrev) : onPrev && onPrev();
  const handleNext = () => inGameNav ? setSelectedGame(gameNavNext) : onNext && onNext();

  return (
    <div className="px-2 py-3 border-t border-stone-200">
      <div className="flex items-stretch gap-1">
        {showNav && !inGameNav && (
          <button
            type="button"
            disabled={!canPrev}
            onClick={handlePrev}
            aria-label="Previous player"
            className="w-6 shrink-0 flex items-center justify-center text-stone-500 disabled:text-stone-200 hover:bg-stone-100 disabled:hover:bg-transparent"
          >
            ‹
          </button>
        )}
        <div className="flex-1 min-w-0">
      <div className="mb-3">
        <div className={`mb-2 flex items-center justify-between gap-2 uppercase tracking-widest text-stone-500 ${(selectedGame || (canDrillToSeries && selectedSeriesIdx != null)) ? "text-xs font-semibold text-stone-700" : "text-[9px]"}`}>
          <span>{(() => {
            if (!rate) return "Value Added Breakdown";
            // When a game/series is selected, italicize the matchup so it
            // reads as the active selection: a game italicizes the whole
            // label, a series italicizes just the "vs OPP" tail.
            if (selectedGame) {
              const ctx = gameContext?.[selectedGame - 1];
              const num = ctx?.seriesGameNumber || selectedGame;
              const opp = ctx?.opp;
              return <span className="italic">{`Game ${num}${opp ? ` vs ${opp}` : ""}`}</span>;
            }
            if (canDrillToSeries && selectedSeriesIdx != null) {
              const ctx = gameContext.find((g) => g?.seriesIdx === selectedSeriesIdx);
              const opp = ctx?.opp;
              // Leaderboard-only: replace "Series vs OPP" with round-specific
              // labels — "First Round vs. POR", "Western Semis vs. MIN",
              // "Western Conf Finals vs. OKC", "NBA Finals vs NYK". Falls
              // back to "Series vs OPP" when round info isn't in scope.
              const round = ctx?.round;
              const conf = playerConf === "W" ? "Western" : playerConf === "E" ? "Eastern" : null;
              const oppEm = opp ? <span className="italic">{` vs. ${opp}`}</span> : null;
              if (round === 1) return <>First Round{oppEm}</>;
              if (round === 2 && conf) return <>{conf} Semis{oppEm}</>;
              if (round === 3 && conf) return <>{conf} Conf Finals{oppEm}</>;
              if (round === 4) return <>NBA Finals{oppEm}</>;
              return <>Series{opp ? <span className="italic">{` vs ${opp}`}</span> : null}</>;
            }
            return breakdownTitle || "Series Breakdown";
          })()}</span>
          {(selectedGame || (canDrillToSeries && selectedSeriesIdx != null)) && (
            <button
              onClick={() => {
                if (selectedGame) setSelectedGame(null);
                else setSelectedSeriesIdx(null);
              }}
              className="normal-case tracking-normal text-stone-400 hover:text-stone-700"
            >
              ← back
            </button>
          )}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="sm:order-2 sm:flex-1">
            {/* Total Value Added — label + value inline, no background. While
                comparing, the compared player's figure rides along in gold. */}
            <div className={`flex items-baseline justify-center gap-2 ${vaPlus != null ? "mb-0.5" : "mb-2"}`}>
              <span className="text-[10px] uppercase tracking-widest text-stone-500">Total Value Added</span>
              <span className={`tabular-nums text-lg font-bold leading-none ${p.va < 0 ? "text-red-600" : "text-stone-900"}`}>{p.va.toFixed(2)}</span>
              {compare && atSeasonLevel && (
                <span className="tabular-nums text-sm font-semibold leading-none rounded-sm px-1 py-[1px]" style={{ color: teamColor(compare.row.team), backgroundColor: GOLD_BG }}>{(compare.row.va ?? 0).toFixed(1)}</span>
              )}
            </div>
            {vaPlus != null && (
              <div
                className="flex items-baseline justify-center gap-2 mb-2"
                title={dInfo?.w != null
                  ? `VA+ = VA + defensive net over possessions played: ${Math.round(drtg)} DRTG vs team ${dInfo.teamDrtg.toFixed(1)} + ${(dInfo.w * 100).toFixed(0)}% of team's edge vs league ${dInfo.laDRtg.toFixed(1)} (share = stock-rate × the 1-in-5 split)`
                  : `VA+ = VA + defensive net rating (${Math.round(drtg)} DRTG vs ${(lga.laPTSperPoss * 100).toFixed(1)} league) over the possessions played`}
              >
                <span className="text-[9px] uppercase tracking-widest text-stone-400">VA+</span>
                <span className={`tabular-nums text-sm font-bold leading-none ${vaPlus < 0 ? "text-red-600" : "text-stone-900"}`}>{vaPlus.toFixed(2)}</span>
                <span className={`text-[9px] tabular-nums ${dVA < 0 ? "text-red-500" : "text-stone-400"}`}>D {(dVA > 0 ? "+" : "") + dVA.toFixed(1)}</span>
              </div>
            )}
            <div className={`grid gap-2 items-end ${multiGame ? "grid-cols-3" : "grid-cols-2"}`}>
              <div className="flex flex-col justify-end text-center">
                <div className="text-[9px] uppercase tracking-widest text-stone-500 leading-tight">{effectiveGameNumber ? gameTileLabel : "Games"}</div>
                <div className="tabular-nums text-base font-semibold text-stone-700">{effectiveGameNumber || p.gp || 1}</div>
                {compare && atSeasonLevel && (
                  <div className="tabular-nums text-[10px] font-semibold rounded-sm mx-auto px-1" style={{ color: teamColor(compare.row.team), backgroundColor: GOLD_BG }}>{compare.row.gp || 0}</div>
                )}
              </div>
              <div className="flex flex-col justify-end text-center">
                <div className="text-[9px] uppercase tracking-widest text-stone-500 leading-tight">MIN/G</div>
                <div className="tabular-nums text-base font-semibold text-stone-700">{(mp / (p.gp || 1)).toFixed(1)}</div>
                {compare && atSeasonLevel && (
                  <div className="tabular-nums text-[10px] font-semibold rounded-sm mx-auto px-1" style={{ color: teamColor(compare.row.team), backgroundColor: GOLD_BG }}>{((compare.row.mp || 0) / (compare.row.gp || 1)).toFixed(1)}</div>
                )}
              </div>
              {multiGame && (
                <div className="flex flex-col justify-end text-center">
                  <div className="text-[9px] uppercase tracking-widest text-stone-500 leading-tight">VA / Game</div>
                  <div className={`tabular-nums text-base font-semibold ${(p.va / p.gp) < 0 ? "text-red-600" : "text-stone-700"}`}>{(p.va / p.gp).toFixed(2)}</div>
                  {compare && atSeasonLevel && (
                    <div className="tabular-nums text-[10px] font-semibold rounded-sm mx-auto px-1" style={{ color: teamColor(compare.row.team), backgroundColor: GOLD_BG }}>{(compare.row.vaPerG ?? ((compare.row.va || 0) / (compare.row.gp || 1))).toFixed(2)}</div>
                  )}
                </div>
              )}
            </div>
          </div>
          {rate && gameSeries && gameSeries.length > 0 && (
            <div className="sm:order-1 sm:flex-1 flex items-stretch gap-1">
              {showNav && inGameNav && (
                <button
                  type="button"
                  disabled={!canPrev}
                  onClick={handlePrev}
                  aria-label="Previous game"
                  className="w-6 shrink-0 flex items-center justify-center text-stone-500 disabled:text-stone-200 hover:bg-stone-100 disabled:hover:bg-transparent"
                >
                  ‹
                </button>
              )}
              <div className="flex-1 min-w-0">
                <GameVAChart
                  values={chartValues}
                  color={accentColor}
                  selected={selectedGame}
                  onSelect={canSelect ? handleChartSelect : undefined}
                  partitions={partitions}
                  seriesRange={seriesRange}
                  label={compare && atSeasonLevel && compareRun ? `VA by Game · vs ${shortName(compare.name)} ${seasonTag(compare.row.season)}` : chartLabel}
                  avgOther={avgOther}
                  avgSelected={avgSelected}
                  overlayValues={compare && atSeasonLevel ? compareRun : null}
                  overlayColor={compare ? teamColor(compare.row.team) : undefined}
                />
              </div>
              {showNav && inGameNav && (
                <button
                  type="button"
                  disabled={!canNext}
                  onClick={handleNext}
                  aria-label="Next game"
                  className="w-6 shrink-0 flex items-center justify-center text-stone-500 disabled:text-stone-200 hover:bg-stone-100 disabled:hover:bg-transparent"
                >
                  ›
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {/* Toggle row. Normal view: Basic/By Category left, Compare center,
          Per 36 / Per G right (rate toggle only in multi-game rate mode).
          Comparing: the gold vs-chip takes the left slot and the
          Values/Percentiles mode toggle takes the right; view/rate toggles
          hide since the compare view is Basic-first with its own drill-down. */}
      {compare && context && atSeasonLevel ? (
        <div className="flex justify-between items-center mb-1">
          <CompareButton
            compare={compare}
            picking={picking}
            onOpen={() => setPicking((v) => !v)}
            onClear={() => { setCompare(null); setPicking(false); }}
          />
          <div className="inline-flex items-center border border-stone-300 rounded-sm overflow-hidden text-[9px]">
            <button
              type="button"
              onClick={() => setCompareMode("values")}
              className={`whitespace-nowrap px-1.5 py-0.5 ${compareMode === "values" ? "bg-stone-700 text-white" : "bg-white text-stone-500 hover:text-stone-700"}`}
              aria-pressed={compareMode === "values"}
            >
              Values
            </button>
            <button
              type="button"
              onClick={() => setCompareMode("pct")}
              className={`whitespace-nowrap px-1.5 py-0.5 border-l border-stone-300 ${compareMode === "pct" ? "bg-stone-700 text-white" : "bg-white text-stone-500 hover:text-stone-700"}`}
              aria-pressed={compareMode === "pct"}
            >
              Percentiles
            </button>
          </div>
        </div>
      ) : (
      <div className="flex justify-between items-center mb-1">
        <div className="inline-flex items-center border border-stone-300 rounded-sm overflow-hidden text-[9px]">
          <button
            type="button"
            onClick={() => switchView("basic")}
            className={`whitespace-nowrap px-1.5 py-0.5 ${viewMode === "basic" ? "bg-stone-700 text-white" : "bg-white text-stone-500 hover:text-stone-700"}`}
            aria-pressed={viewMode === "basic"}
          >
            Basic
          </button>
          <button
            type="button"
            onClick={() => switchView("detail")}
            className={`whitespace-nowrap px-1.5 py-0.5 border-l border-stone-300 ${viewMode === "detail" ? "bg-stone-700 text-white" : "bg-white text-stone-500 hover:text-stone-700"}`}
            aria-pressed={viewMode === "detail"}
          >
            By Category
          </button>
        </div>
        {context && atSeasonLevel && (
          <CompareButton
            compare={compare}
            picking={picking}
            onOpen={() => setPicking((v) => !v)}
            onClear={() => { setCompare(null); setPicking(false); }}
          />
        )}
        {effectiveRate && (
          <div className="inline-flex items-center border border-stone-300 rounded-sm overflow-hidden text-[9px]">
            <button
              type="button"
              onClick={() => setRateMode("per36")}
              className={`whitespace-nowrap px-1.5 py-0.5 ${rateMode === "per36" ? "bg-stone-700 text-white" : "bg-white text-stone-500 hover:text-stone-700"}`}
              aria-pressed={rateMode === "per36"}
            >
              Per 36
            </button>
            <button
              type="button"
              onClick={() => setRateMode("perG")}
              className={`whitespace-nowrap px-1.5 py-0.5 border-l border-stone-300 ${rateMode === "perG" ? "bg-stone-700 text-white" : "bg-white text-stone-500 hover:text-stone-700"}`}
              aria-pressed={rateMode === "perG"}
            >
              Per G
            </button>
          </div>
        )}
      </div>
      )}
      {picking && context && atSeasonLevel && (
        <ComparePicker
          context={context}
          self={{ ...pSeries, season: pSeries.season || context.season, name: pSeries.name || context.self?.name, slug: pSeries.slug || context.self?.slug || null }}
          onPick={(sel) => { setCompare(sel); setPicking(false); }}
          onCancel={() => setPicking(false)}
        />
      )}
      {compare && context && atSeasonLevel ? (
        <ComparePanel
          key={`${compare.row.season}:${compare.slug || compare.name}`}
          a={{ ...pSeries, season: pSeries.season || context.season, name: pSeries.name || context.self?.name, slug: pSeries.slug || context.self?.slug || null }}
          b={compare.row}
          bSeasons={compare.seasons}
          context={context}
          rateMode={rateMode}
          mode={compareMode}
          setMode={setCompareMode}
        />
      ) : (
      <>
      <div className="space-y-0.5">
        {activeRows.map((c, i) => {
          const pct = (Math.abs(c.value) / maxAbs) * 45;
          const isPos = c.value >= 0;
          const ref = refByKey ? refByKey[c.key] : null;
          const refMagPct = ref != null && Number.isFinite(ref) ? (Math.abs(ref) / maxAbs) * 45 : null;
          const refLeftPct = refMagPct != null ? (ref >= 0 ? 50 + refMagPct : 50 - refMagPct) : null;
          const isCatSel = selectedCategory === c.key;
          const onCatTap = canSelectCategory && !c.noDrill
            ? () => setSelectedCategory(isCatSel ? null : c.key)
            : undefined;
          // Explicit "+" prefix for positive VA contributions so a row's
          // sign is unambiguous at a glance (negatives already get "-"
          // from toFixed). Skipped at exactly 0 to avoid "+0.00".
          const signed = (v, d) => (v > 0 ? "+" : "") + v.toFixed(d);
          return (
            <React.Fragment key={i}>
              <div
                className={`flex items-center gap-2 text-[10px] -mx-1 px-1 ${onCatTap ? "cursor-pointer" : ""} ${isCatSel ? "bg-stone-200" : ""}`}
                onClick={onCatTap}
                role={onCatTap ? "button" : undefined}
                tabIndex={onCatTap ? 0 : undefined}
                onKeyDown={onCatTap ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCatTap(); } } : undefined}
                aria-pressed={onCatTap ? isCatSel : undefined}
              >
                <span className={`${keyW} text-right truncate ${isCatSel ? "text-stone-900 font-semibold" : "text-stone-600"}`}>{c.key}</span>
                <div className="flex-1 flex items-center relative h-4">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-stone-300"></div>
                  <div
                    className="absolute inset-y-0.5"
                    style={{
                      backgroundColor: isPos ? accentColor : "#a8a29e",
                      left: isPos ? "50%" : `${50 - pct}%`,
                      width: `${pct}%`,
                    }}
                  ></div>
                  {refLeftPct != null && (
                    <div
                      className="absolute inset-y-0 w-0.5"
                      style={{ left: `calc(${refLeftPct}% - 1px)`, backgroundColor: "#1c1917" }}
                      title={`Regular season: ${ref.toFixed(2)}`}
                    />
                  )}
                </div>
                {rate && p.gp > 1 ? (
                  // Portrait phones hide the total + per-game contribution
                  // numbers so the bars (and the rate label) get the room.
                  <>
                    <span className={`portrait:hidden w-10 tabular-nums text-right font-semibold ${c.value < 0 ? "text-red-600" : "text-stone-700"}`}>{signed(c.value, 1)}</span>
                    <span className="portrait:hidden text-stone-300 select-none">|</span>
                    {/* Per-game VA contribution stays visible in portrait too. */}
                    <span className={`w-12 tabular-nums text-right font-semibold ${c.value < 0 ? "text-red-600" : "text-stone-700"}`}>{signed(c.value / p.gp, 2)}</span>
                  </>
                ) : (
                  <span className={`w-10 tabular-nums text-right font-semibold ${c.value < 0 ? "text-red-600" : "text-stone-700"}`}>{signed(c.value, 2)}</span>
                )}
                <span className={`${labelW} text-[9px] text-stone-500 text-right tabular-nums`}>{c.label}</span>
              </div>
              {context && atSeasonLevel && isCatSel && (
                <CategoryContext p={pSeries} catKey={c.key} lga={lga} rateMode={rateMode} context={context} />
              )}
              {viewMode === "detail" && VA_PARTITIONS_AFTER.has(c.key) && <div className="my-1 border-t border-stone-200" />}
            </React.Fragment>
          );
        })}
      </div>
      <div className="mt-2 text-center text-[9px] italic text-stone-400">
        Bars show contribution above/below the league baseline (median rates){context && atSeasonLevel ? " · tap a category for league context" : ""}
      </div>
      </>
      )}
        </div>
        {showNav && !inGameNav && (
          <button
            type="button"
            disabled={!canNext}
            onClick={handleNext}
            aria-label="Next player"
            className="w-6 shrink-0 flex items-center justify-center text-stone-500 disabled:text-stone-200 hover:bg-stone-100 disabled:hover:bg-transparent"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}

function getSortedPlayers(box, lga = LGA) {
  if (!box) return [];
  return [
    ...(box.away?.players || []).map((p) => ({ ...p, team: box.away.tri })),
    ...(box.home?.players || []).map((p) => ({ ...p, team: box.home.tri })),
  ]
    .filter((p) => (p.mp || 0) > 0)
    .map((p) => ({ ...p, va: valueAdd(p, lga) }))
    .sort((a, b) => b.va - a.va);
}

function PlayerRow({ p, isExpanded, onToggle, dimTeam, lga = LGA, teams = TEAMS, gameNumber, onPrev, onNext, useTeamColor }) {
  const teamInfo = teams[p.team];
  const owner = teamInfo?.owner;
  const isDim = p.team === dimTeam;
  const badgeUseTeam = !isDim && !owner;
  const badgeClass = isDim
    ? "bg-white text-stone-500 border border-stone-200"
    : owner ? ownerBadge(owner) : "border";
  const tc = badgeUseTeam ? teamColor(p.team) : null;
  const badgeStyle = badgeUseTeam
    ? { backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) }
    : undefined;
  return (
    <div className="border-b border-stone-100 last:border-0">
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2 text-[10px] py-1 text-left ${isExpanded ? "bg-stone-100" : ""}`}
      >
        <span style={badgeStyle} className={`w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center ${badgeClass}`}>
          {p.team}
        </span>
        <span className={`flex-1 truncate ${p.starter ? "font-semibold text-stone-800" : "text-stone-600"}`}>
          <span className="text-stone-400 mr-1">{isExpanded ? "▾" : "▸"}</span>
          {p.name}
        </span>
        <span className="tabular-nums text-stone-500 w-7 text-right">{Math.round(p.mp)}</span>
        <span className="tabular-nums font-bold text-stone-900 w-6 text-right">{p.pts}</span>
        <span className="tabular-nums text-stone-600 w-5 text-right">{p.reb}</span>
        <span className="tabular-nums text-stone-600 w-5 text-right">{p.ast}</span>
        <span className={`tabular-nums w-8 text-right font-semibold ${p.va < 0 ? "text-red-600" : p.va > 0 ? "text-stone-900" : "text-stone-400"}`}>
          {p.va.toFixed(1)}
        </span>
      </button>
      {isExpanded && <VABreakdown p={p} lga={lga} teams={teams} gameNumber={gameNumber} onPrev={onPrev} onNext={onNext} useTeamColor={useTeamColor} />}
    </div>
  );
}

function BoxscoreTable({ rows, expandedKey, setExpandedKey, dimTeam, partitionOnCourt, lga = LGA, teams = TEAMS, gameNumber, useTeamColor }) {
  // Build a row plus prev/next callbacks that navigate within the same
  // array (partition-aware: nav stays within On Court / Bench).
  const buildRow = (arr) => (p, i) => {
    const rowKey = `${p.team}-${p.name}-${i}`;
    const prev = arr[i - 1];
    const next = arr[i + 1];
    const prevKey = prev ? `${prev.team}-${prev.name}-${i - 1}` : null;
    const nextKey = next ? `${next.team}-${next.name}-${i + 1}` : null;
    return (
      <PlayerRow
        key={rowKey}
        p={p}
        isExpanded={expandedKey === rowKey}
        onToggle={() => setExpandedKey(expandedKey === rowKey ? null : rowKey)}
        dimTeam={dimTeam}
        lga={lga}
        teams={teams}
        gameNumber={gameNumber}
        useTeamColor={useTeamColor}
        onPrev={prevKey ? () => setExpandedKey(prevKey) : undefined}
        onNext={nextKey ? () => setExpandedKey(nextKey) : undefined}
      />
    );
  };

  const header = (
    <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 border-b border-stone-200">
      <span className="w-10">Team</span>
      <span className="flex-1">Player</span>
      <span className="w-7 text-right">MIN</span>
      <span className="w-6 text-right">PTS</span>
      <span className="w-5 text-right">REB</span>
      <span className="w-5 text-right">AST</span>
      <span className="w-8 text-right">VA</span>
    </div>
  );

  if (partitionOnCourt) {
    const onCourt = rows.filter((p) => p.oncourt);
    const bench = rows.filter((p) => !p.oncourt);
    return (
      <div>
        {header}
        {onCourt.length > 0 && (
          <>
            <div className="text-[9px] uppercase tracking-widest text-red-600 font-semibold pt-1.5 pb-0.5 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
              On Court
            </div>
            {onCourt.map(buildRow(onCourt))}
          </>
        )}
        {bench.length > 0 && (
          <>
            <div className="text-[9px] uppercase tracking-widest text-stone-500 pt-2 pb-0.5">Bench</div>
            {bench.map(buildRow(bench))}
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      {header}
      {rows.map(buildRow(rows))}
    </div>
  );
}

function LiveGameBanner({ liveGame, gameLabel, dimTeam, staticBox, lga = LGA, teams = TEAMS, useTeamColor }) {
  const gameNumber = gameLabel ? Number((gameLabel.match(/\d+/) || [])[0]) || null : null;
  const [expanded, setExpanded] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState(null);
  const [box, setBox] = useState(staticBox || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadBox = useCallback(async () => {
    if (!liveGame?.gameId) return;
    setLoading(true);
    setError(null);
    try {
      const dq = liveGame.gameCode ? `&date=${liveGame.gameCode}` : "";
      const res = await fetch(`/api/boxscore?gameId=${liveGame.gameId}${dq}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBox(data);
    } catch (e) {
      setError(e.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }, [liveGame?.gameId]);

  const isLive = liveGame?.gameStatus === 2;
  const isFinal = liveGame?.gameStatus === 3;

  useEffect(() => {
    if (staticBox || !liveGame?.gameId) return; // historical box is supplied inline
    if (isLive) {
      loadBox();
      const id = setInterval(loadBox, 45000);
      return () => clearInterval(id);
    }
    if (isFinal && expanded) {
      loadBox();
    }
  }, [staticBox, liveGame?.gameId, isLive, isFinal, expanded, loadBox]);

  if (!liveGame) return null;
  const { home, away, gameStatus, gameStatusText, gameId, gameDateTimeUTC, period, gameClock } = liveGame;
  const canExpand = !!gameId && (isLive || isFinal);

  const formatPeriod = (p) => {
    if (!p || p < 1) return "";
    if (p <= 4) return `Q${p}`;
    if (p === 5) return "OT";
    return `OT${p - 4}`;
  };

  const formatClock = (iso) => {
    if (!iso) return "";
    const m = iso.match(/PT(\d+)M([\d.]+)S/);
    if (!m) return "";
    const mins = parseInt(m[1], 10);
    const secs = Math.floor(parseFloat(m[2]));
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const liveLabel = isLive
    ? [formatPeriod(period), formatClock(gameClock)].filter(Boolean).join(" ")
    : null;

  let displayStatus = gameStatusText;
  if (gameStatus === 1 && gameDateTimeUTC) {
    const d = new Date(gameDateTimeUTC);
    const isTbd = gameStatusText === "TBD";
    const now = new Date();

    if (isTbd) {
      const etDate = new Date(d.getTime() - 4 * 60 * 60 * 1000);
      const sameDay = etDate.getUTCFullYear() === now.getFullYear() &&
                      etDate.getUTCMonth() === now.getMonth() &&
                      etDate.getUTCDate() === now.getDate();
      displayStatus = sameDay
        ? "Today"
        : `${etDate.getUTCMonth() + 1}/${etDate.getUTCDate()}`;
    } else {
      const sameDay = d.getFullYear() === now.getFullYear() &&
                      d.getMonth() === now.getMonth() &&
                      d.getDate() === now.getDate();
      if (sameDay) {
        const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        displayStatus = `Today ${timeStr}`;
      } else {
        displayStatus = `${d.getMonth() + 1}/${d.getDate()}`;
      }
    }
  }

  let finalClasses = "bg-stone-100 border-stone-300";
  let finalStyle = undefined;
  if (isFinal && home.score !== away.score) {
    const winnerTri = home.score > away.score ? home.tri : away.tri;
    const winnerOwner = teams[winnerTri]?.owner;
    if (winnerOwner === "Spencer") finalClasses = "bg-amber-50 border-amber-400";
    else if (winnerOwner === "Trey") finalClasses = "bg-teal-50 border-teal-400";
    else {
      // No owner context (Explore): tint with the winner's team color.
      const tc = teamColor(winnerTri);
      finalClasses = "border";
      finalStyle = { backgroundColor: withAlpha(tc, 0.08), borderColor: withAlpha(tc, 0.5) };
    }
  }

  const sortedPlayers = useMemo(() => getSortedPlayers(box, lga), [box, lga]);
  const top5 = sortedPlayers.slice(0, 5);
  const showTop5 = isLive && sortedPlayers.length > 0 && !expanded;

  return (
    <div style={isFinal ? finalStyle : undefined} className={`mt-1 border ${isLive ? "bg-red-50 border-red-300" : isFinal ? finalClasses : "bg-stone-50 border-stone-200"}`}>
      <button
        onClick={() => canExpand && setExpanded(!expanded)}
        disabled={!canExpand}
        className="w-full px-2 py-1 text-[10px] flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-1.5">
          {isLive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span>}
          <span className={`font-bold uppercase tracking-wider ${isLive ? "text-red-700" : "text-stone-600"}`}>
            {isLive ? (liveLabel || "LIVE") : isFinal ? "FINAL" : (displayStatus || "SOON")}
          </span>
          {gameLabel && (
            <span className="text-[9px] font-semibold uppercase tracking-wider text-stone-500 px-1 py-0.5 bg-white border border-stone-300">
              {gameLabel}
            </span>
          )}
          {canExpand && <span className="text-stone-400">{expanded ? "▾" : "▸"}</span>}
        </div>
        {isLive && liveGame.broadcasters && liveGame.broadcasters.length > 0 && (
          <span className="text-[9px] uppercase tracking-wider text-stone-500 truncate text-center flex-1 min-w-0">
            {liveGame.broadcasters.join(", ")}
          </span>
        )}
        <div className="tabular-nums font-semibold text-stone-700 shrink-0">
          {away.tri} {away.score} — {home.score} {home.tri}
        </div>
      </button>

      {showTop5 && (
        <div className="px-2 pb-2 border-t border-red-200">
          <div className="text-[9px] uppercase tracking-widest text-stone-500 py-1">Top 5 by Value Added</div>
          <BoxscoreTable rows={top5} expandedKey={expandedPlayer} setExpandedKey={setExpandedPlayer} dimTeam={dimTeam} lga={lga} teams={teams} gameNumber={gameNumber} useTeamColor={useTeamColor} />
        </div>
      )}

      {expanded && (
        <div className="px-2 pb-2 border-t border-stone-200">
          {loading && !box && <div className="py-2 text-[10px] text-stone-500 italic text-center">Loading stats…</div>}
          {error && <div className="py-2 text-[10px] text-red-600 text-center">{error}</div>}
          {box && sortedPlayers.length > 0 && (
            <div className="mt-2">
              <BoxscoreTable rows={sortedPlayers} expandedKey={expandedPlayer} setExpandedKey={setExpandedPlayer} dimTeam={dimTeam} partitionOnCourt={isLive} lga={lga} teams={teams} gameNumber={gameNumber} useTeamColor={useTeamColor} />
            </div>
          )}
          {box && sortedPlayers.length === 0 && (
            <div className="py-2 text-[10px] text-stone-500 italic text-center">No player stats yet</div>
          )}
        </div>
      )}
    </div>
  );
}

function TbdCard({ gameNumbers }) {
  if (!gameNumbers || gameNumbers.length === 0) return null;
  let label;
  if (gameNumbers.length === 1) {
    label = `Game ${gameNumbers[0]} TBD`;
  } else if (gameNumbers.length === 2) {
    label = `Games ${gameNumbers[0]} & ${gameNumbers[1]} TBD`;
  } else {
    const last = gameNumbers[gameNumbers.length - 1];
    const rest = gameNumbers.slice(0, -1).join(", ");
    label = `Games ${rest} & ${last} TBD`;
  }
  return (
    <div className="mt-1 border bg-stone-300 border-stone-400">
      <div className="w-full px-2 py-1 text-[10px] flex items-center justify-between gap-2">
        <span className="font-bold uppercase tracking-wider text-stone-700">{label}</span>
        <span className="text-[9px] uppercase tracking-wider text-stone-600 italic">If necessary</span>
      </div>
    </div>
  );
}

function TeamButton({ code, selected, disabled, onClick, gamesWon, actualWins, onGamesChange, seriesDecided, dim, pointValue }) {
  if (!code) {
    return <div className="flex-1 px-3 py-2.5 text-xs uppercase tracking-widest text-stone-400 italic border border-dashed border-stone-300 bg-stone-50 text-center">TBD</div>;
  }
  const t = TEAMS[code];
  const isSel = selected === code;
  return (
    <div className={`flex-1 px-3 py-2.5 transition-all border ${isSel ? `${ownerBg(t.owner)} border-2 shadow-sm` : "bg-white border-stone-200"} ${disabled ? "opacity-60" : ""}`}>
      <button onClick={() => !disabled && onClick(code)} disabled={disabled} className="w-full text-left">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-stone-500 tabular-nums w-4">{t.seed}</span>
          <span className={`text-sm font-semibold ${isSel ? ownerColor(t.owner, dim) : "text-stone-900"}`}>{t.name}</span>
          {isSel && <span className="ml-auto text-xs">✓</span>}
        </div>
        <div className="text-[10px] uppercase tracking-wider mt-0.5 flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${ownerDot(t.owner, dim)}`}></span>
          <span className="text-stone-500">{t.owner}</span>
        </div>
      </button>
      {!seriesDecided && (
        <>
          <WinCircles value={gamesWon || 0} actualValue={actualWins || 0} onChange={(v) => onGamesChange(code, v)} disabled={disabled} owner={t.owner} dim={dim} />
          {pointValue != null && (
            <div className={`text-[9px] uppercase tracking-wider mt-1 tabular-nums font-semibold ${ownerColor(t.owner, dim)}`}>
              +{pointValue} pt{pointValue === 1 ? "" : "s"}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SeriesRow({ series, roundKey, matchups, winners, gameWins, actualGameWins, onPick, onGamesChange, liveGame }) {
  const [expanded, setExpanded] = useState(false);
  const [a, b] = matchups[series.id] || [];
  const winner = winners[series.id];
  const canPick = a && b;
  const games = gameWins[series.id] || {};
  const actualGames = actualGameWins?.[series.id] || {};
  const seriesDecided = !!winner;
  // A series is "over" when real results give a team 4 wins. Collapse it to a
  // one-line result by default (expandable) so finished series don't crowd the
  // bracket alongside ones still in progress.
  const realWinsA = actualGames[a] || 0;
  const realWinsB = actualGames[b] || 0;
  const isOver = !!(a && b) && (realWinsA >= 4 || realWinsB >= 4);
  const seriesWinner = realWinsA >= 4 ? a : realWinsB >= 4 ? b : null;
  const seriesLoser = seriesWinner === a ? b : a;
  const hiWins = Math.max(realWinsA, realWinsB);
  const loWins = Math.min(realWinsA, realWinsB);
  const seriesGames = (liveGame || []).slice().sort((x, y) =>
    (x.gameId || "").localeCompare(y.gameId || "")
  );

  const teamA = a ? TEAMS[a] : null;
  const teamB = b ? TEAMS[b] : null;
  const ptsA = teamA && teamB ? potentialPoints(teamA, teamB, roundKey).total : null;
  const ptsB = teamA && teamB ? potentialPoints(teamB, teamA, roundKey).total : null;
  // When both teams share an owner, dim the side whose win is worth fewer points.
  const sameOwner = teamA && teamB && teamA.owner === teamB.owner;
  const dimA = sameOwner && ptsA < ptsB;
  const dimB = sameOwner && ptsB < ptsA;
  const dimTeam = dimA ? a : dimB ? b : null;

  const winsA = games[a] || 0;
  const winsB = games[b] || 0;
  const minWins = Math.min(winsA, winsB);
  const lastGuaranteed = seriesDecided ? 0 : 4 + minWins;

  const realGames = [];
  const tbdGames = [];
  seriesGames.forEach((g, i) => {
    const gameNumber = i + 1;
    if (g.gameStatus === 1 && gameNumber > lastGuaranteed) {
      tbdGames.push(g);
    } else {
      realGames.push(g);
    }
  });

  const tbdGameNumbers = tbdGames.map((_, i) => realGames.length + i + 1).filter((n) => n <= 7);

  const body = (
    <>
      <div className="flex gap-1.5 items-stretch">
        <TeamButton code={a} selected={winner} disabled={!canPick} onClick={(code) => onPick(series.id, winner === code ? null : code)} gamesWon={games[a]} actualWins={actualGames[a]} onGamesChange={(code, v) => onGamesChange(series.id, code, v)} seriesDecided={seriesDecided} dim={dimA} pointValue={ptsA} />
        <div className="flex items-center justify-center px-1 text-[10px] font-bold text-stone-400 tracking-widest">VS</div>
        <TeamButton code={b} selected={winner} disabled={!canPick} onClick={(code) => onPick(series.id, winner === code ? null : code)} gamesWon={games[b]} actualWins={actualGames[b]} onGamesChange={(code, v) => onGamesChange(series.id, code, v)} seriesDecided={seriesDecided} dim={dimB} pointValue={ptsB} />
      </div>
      <SeriesAverages games={seriesGames} teamsMap={TEAMS} lga={LGA} dimTeam={dimTeam} season="2025-26" />
      {realGames.map((g, i) => {
        const num = i + 1;
        const gameLabel = num <= 7 ? `Game ${num}` : null;
        return <LiveGameBanner key={g.gameId || i} liveGame={g} gameLabel={gameLabel} dimTeam={dimTeam} />;
      })}
      <TbdCard gameNumbers={tbdGameNumbers} />
    </>
  );

  return (
    <div className="mb-3 bg-stone-50 border border-stone-200 rounded">
      {isOver && (
        <button onClick={() => setExpanded((e) => !e)} className="w-full p-2 flex items-center gap-2 text-left">
          <span className="text-stone-400 text-[10px]">{expanded ? "▾" : "▸"}</span>
          <span className="text-xs">
            <span className="font-semibold text-stone-900">{seriesWinner}</span>
            <span className="text-stone-500"> def. </span>
            <span className="text-stone-600">{seriesLoser}</span>
          </span>
          <span className="ml-auto text-xs font-semibold tabular-nums text-stone-700">{hiWins}–{loWins}</span>
        </button>
      )}
      {(!isOver || expanded) && (
        <div className={isOver ? "px-2 pb-2" : "p-2"}>{body}</div>
      )}
    </div>
  );
}

function RoundSection({ roundKey, title, series, matchups, winners, gameWins, actualGameWins, actualWinners, onPick, onGamesChange, liveGamesBySeries }) {
  const sortedSeries = series.slice().sort((a, b) => {
    const aGames = liveGamesBySeries?.[a.id] || [];
    const bGames = liveGamesBySeries?.[b.id] || [];

    const aHasLive = aGames.some((g) => g.gameStatus === 2);
    const bHasLive = bGames.some((g) => g.gameStatus === 2);
    if (aHasLive && !bHasLive) return -1;
    if (!aHasLive && bHasLive) return 1;

    const latestTime = (games) => {
      const finals = games.filter((g) => g.gameStatus === 3);
      if (finals.length === 0) return 0;
      const withTime = finals
        .map((g) => g.gameDateTimeUTC ? new Date(g.gameDateTimeUTC).getTime() : 0)
        .filter((t) => t > 0);
      if (withTime.length > 0) return Math.max(...withTime);
      const ids = finals.map((g) => parseInt(g.gameId, 10) || 0);
      return Math.max(...ids);
    };
    const aTime = latestTime(aGames);
    const bTime = latestTime(bGames);
    return bTime - aTime;
  });

  // Round is "complete" when every series has a clinched winner from real games
  const allClinched = series.every((s) => actualWinners?.[s.id]);

  // Default open; collapsed if all series in this round are clinched
  const [collapsed, setCollapsed] = useState(allClinched);
  // Re-sync collapse state if the round transitions to fully-clinched
  useEffect(() => { setCollapsed(allClinched); }, [allClinched]);

  return (
    <div className="mb-6">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-baseline justify-between mb-2.5 pb-1.5 border-b-2 border-stone-900 text-left"
      >
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 flex items-center gap-2">
          <span className="text-stone-400 text-[10px]">{collapsed ? "▸" : "▾"}</span>
          {title}
          {allClinched && <span className="text-[9px] uppercase tracking-wider text-stone-500 font-normal">Complete</span>}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-stone-500 tabular-nums">+{ROUND_BASE[roundKey]} pt{ROUND_BASE[roundKey] > 1 ? "s" : ""}/win</span>
      </button>
      {!collapsed && sortedSeries.map((s) => (
        <SeriesRow key={s.id} series={s} roundKey={roundKey} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} onPick={onPick} onGamesChange={onGamesChange} liveGame={liveGamesBySeries?.[s.id]} />
      ))}
    </div>
  );
}

function ScoreCard({ owner, total, projectedTotal, realProjectedTotal, whatIfTotal, opponentProjected, breakdown, readOnly }) {
  const leading = projectedTotal > opponentProjected;
  const tied = projectedTotal === opponentProjected;
  const realProj = realProjectedTotal ?? projectedTotal;
  const hasRealProjection = !readOnly && Math.abs(realProj - total) > 0.001;
  const hasWhatIf = !readOnly && (whatIfTotal || 0) > 0.001;
  return (
    <div className={`flex-1 p-3 border-2 ${owner === "Spencer" ? "border-amber-600" : "border-teal-600"} bg-white`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${ownerDot(owner)}`}></span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-stone-700">{owner}</span>
        </div>
        {leading && !tied && <span className="text-[9px] font-bold uppercase tracking-wider text-stone-900 bg-stone-900 text-white px-1.5 py-0.5">{readOnly ? "WINNER" : "LEAD"}</span>}
      </div>
      <div className={`text-4xl font-black tabular-nums ${ownerColor(owner)}`}>{total}</div>
      <div className="text-[10px] text-stone-500 uppercase tracking-wider mt-0.5">{breakdown.length} win{breakdown.length === 1 ? "" : "s"}{readOnly ? "" : " · locked"}</div>
      {hasRealProjection && (
        <div className="mt-2 pt-2 border-t border-stone-200">
          <div className="text-[9px] uppercase tracking-widest text-stone-500">Projected</div>
          <div className={`text-lg font-bold tabular-nums ${ownerColor(owner)}`}>{realProj.toFixed(2)}</div>
        </div>
      )}
      {hasWhatIf && (
        <div className="mt-1">
          <div className="text-[9px] uppercase tracking-widest text-stone-400">What If?</div>
          <div className="text-sm font-semibold tabular-nums text-stone-500">+{whatIfTotal.toFixed(2)}</div>
        </div>
      )}
    </div>
  );
}

function BreakdownList({ breakdown, owner }) {
  if (breakdown.length === 0) return <div className="text-xs text-stone-400 italic py-3 text-center">No wins yet</div>;
  return (
    <div className="space-y-1.5">
      {breakdown.map((item, i) => (
        <div key={i} className={`flex items-center justify-between text-xs px-2 py-1.5 ${ownerBg(owner)} border`}>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-stone-900 truncate">({item.team.seed}) {item.team.name}</div>
            <div className="text-[10px] text-stone-500 uppercase tracking-wider">{item.round} · beat ({item.opp.seed}) {item.opp.name}</div>
          </div>
          <div className="text-right ml-2 tabular-nums">
            <div className="font-bold text-sm text-stone-900">{item.total}</div>
            {item.bonus > 0 && <div className="text-[9px] text-stone-500">{item.base}+{item.bonus}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectionList({ projections, owner, label, muted }) {
  if (!projections || projections.length === 0) return null;
  return (
    <div className="mt-3">
      <div className={`text-[10px] uppercase tracking-widest mb-1.5 ${muted ? "text-stone-400" : "text-stone-500"}`}>{label}</div>
      <div className="space-y-1.5">
        {projections.map((item, i) => (
          <div key={i} className={`flex items-center justify-between text-xs px-2 py-1.5 border border-dashed border-stone-300 ${muted ? "bg-stone-50" : "bg-white"}`}>
            <div className="flex-1 min-w-0">
              <div className={`font-semibold truncate ${muted ? "text-stone-600" : "text-stone-900"}`}>({item.team.seed}) {item.team.name}</div>
              <div className="text-[10px] text-stone-500 uppercase tracking-wider">{item.round} · {item.gamesWon}/4 vs ({item.opp.seed}) {item.opp.name}</div>
            </div>
            <div className="text-right ml-2 tabular-nums">
              <div className={`font-bold text-sm ${muted ? "text-stone-600" : ownerColor(owner)}`}>{item.projected.toFixed(2)}</div>
              <div className="text-[9px] text-stone-500">of {item.total}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WhatIfClinchedList({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-widest text-stone-400 mb-1.5">Speculated Series Wins</div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 bg-stone-50 border border-dashed border-stone-300">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-stone-600 truncate">({item.team.seed}) {item.team.name}</div>
              <div className="text-[10px] text-stone-500 uppercase tracking-wider">{item.round} · beat ({item.opp.seed}) {item.opp.name}</div>
            </div>
            <div className="text-right ml-2 tabular-nums">
              <div className="font-bold text-sm text-stone-600">{item.total}</div>
              {item.bonus > 0 && <div className="text-[9px] text-stone-500">{item.base}+{item.bonus}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UpcomingTodayBanner({ liveGamesBySeries, actualWinners }) {
  const now = new Date();
  const allGames = [];
  for (const [sid, games] of Object.entries(liveGamesBySeries || {})) {
    if (actualWinners?.[sid]) continue; // Skip clinched series
    for (const g of games || []) {
      if (g.gameStatus !== 1) continue; // Only upcoming games
      if (!g.gameDateTimeUTC) continue;
      if (g.gameStatusText === "TBD") continue;
      const d = new Date(g.gameDateTimeUTC);
      const sameDay = d.getFullYear() === now.getFullYear() &&
                      d.getMonth() === now.getMonth() &&
                      d.getDate() === now.getDate();
      if (!sameDay || d.getTime() < now.getTime() - 30 * 60 * 1000) continue;
      allGames.push({ ...g, seriesId: sid, tipTime: d });
    }
  }

  if (allGames.length === 0) return null;

  allGames.sort((a, b) => a.tipTime.getTime() - b.tipTime.getTime());

  return (
    <div className="mb-5 p-3 bg-white border border-stone-300">
      <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-2">Today's Upcoming Games</div>
      <div className="space-y-1">
        {allGames.map((g) => {
          const homeOwner = TEAMS[g.home.tri]?.owner;
          const awayOwner = TEAMS[g.away.tri]?.owner;
          const timeStr = g.tipTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          const tv = (g.broadcasters || []).join(", ");
          return (
            <div key={g.gameId} className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="tabular-nums text-[10px] text-stone-500 w-14 shrink-0">{timeStr}</span>
                <span className={`font-semibold tabular-nums ${ownerColor(awayOwner)}`}>{g.away.tri}</span>
                <span className="text-stone-400">@</span>
                <span className={`font-semibold tabular-nums ${ownerColor(homeOwner)}`}>{g.home.tri}</span>
              </div>
              {tv && (
                <span className="text-[9px] uppercase tracking-wider text-stone-500 shrink-0">{tv}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryGameList({ games, teamsMap, lga, dimTeam }) {
  return games.map((g, i) => {
    const liveGame = {
      gameId: g.gameId,
      gameCode: g.gameCode,
      gameStatus: 3,
      gameStatusText: "Final",
      gameDateTimeUTC: g.gameDateTimeUTC,
      home: { tri: g.home.tri, score: g.home.score },
      away: { tri: g.away.tri, score: g.away.score },
    };
    const staticBox = g.box
      ? {
          gameId: g.gameId,
          gameStatus: 3,
          home: { tri: g.home.tri, score: g.home.score, players: g.box.home?.players || [] },
          away: { tri: g.away.tri, score: g.away.score, players: g.box.away?.players || [] },
        }
      : null;
    return (
      <LiveGameBanner
        key={g.gameId || i}
        liveGame={liveGame}
        gameLabel={`Game ${i + 1}`}
        staticBox={staticBox}
        lga={lga}
        teams={teamsMap}
        dimTeam={dimTeam}
        useTeamColor
      />
    );
  });
}

function SeriesAverages({ games, teamsMap, lga, dimTeam, boxSrc, useTeamColor, season }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [rsLookup, setRsLookup] = useState(null);
  // Tap a G value to filter to players with ≥ that many GP and re-sort
  // by VA/G; lets you compare efficiency at comparable volume within a
  // series. Same mechanic as the playoff leaderboard.
  const [minGames, setMinGames] = useState(null);
  const [pendingScrollName, setPendingScrollName] = useState(null);

  useEffect(() => {
    if (!pendingScrollName) return;
    const sel = `[data-player-row="${pendingScrollName.replace(/"/g, '\\"')}"]`;
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingScrollName(null);
  }, [pendingScrollName]);

  // Pull regular-season totals lazily when the section is first opened.
  // Name lookup only — the live ESPN box-score path doesn't expose BR slugs.
  useEffect(() => {
    if (!open || rsLookup || !season) return;
    let cancelled = false;
    fetch(`/api/regular-season?season=${season}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d || !Array.isArray(d.players)) return;
        const byName = {}, byNorm = {};
        for (const p of d.players) {
          if (!p.name) continue;
          if (!byName[p.name]) byName[p.name] = p;
          const n = normalizeName(p.name);
          if (n && !byNorm[n]) byNorm[n] = p;
        }
        setRsLookup({ byName, byNorm });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, season, rsLookup]);

  // Only completed games contribute. History games carry no gameStatus
  // (all final); live games do, so require final (3).
  const finalGames = (games || []).filter((g) => g.gameStatus === undefined || g.gameStatus === 3);

  useEffect(() => {
    // Deps are intentionally just [open]: including `loading` makes
    // setLoading(true) re-run the effect, whose cleanup flips `cancelled`
    // and strands it in the loading state forever.
    if (!open || rows) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const q = boxSrc ? `&src=${boxSrc}` : "";
    Promise.all(
      finalGames.map((g) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        return fetch(`/api/boxscore?gameId=${g.gameId}${q}`, { signal: ctrl.signal })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
          .finally(() => clearTimeout(timer));
      })
    )
      .then((boxes) => {
        if (cancelled) return;
        const ok = boxes.filter((b) => b && !b.error);
        if (ok.length === 0) {
          setError("Box scores unavailable");
          setRows([]);
          return;
        }
        const agg = {};
        const N = finalGames.length;
        boxes.forEach((box, idx) => {
          if (!box || box.error) return;
          const players = [
            ...(box.away?.players || []).map((p) => ({ ...p, team: box.away.tri })),
            ...(box.home?.players || []).map((p) => ({ ...p, team: box.home.tri })),
          ];
          for (const p of players) {
            if (!(p.mp > 0)) continue;
            const key = `${p.team}:${p.name}`;
            const a =
              agg[key] ||
              (agg[key] = {
                name: p.name, team: p.team, gp: 0, va: 0, eff: 0,
                mp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0,
                fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, drb: 0, orb: 0,
                games: new Array(N).fill(null),
                byGame: new Array(N).fill(null),
              });
            const { va, efficiency } = valueAddParts(p, lga);
            a.gp += 1;
            a.va += va;
            a.eff += efficiency;
            a.games[idx] = va;
            // Single-game snapshot for the tap-to-drill-in flow.
            a.byGame[idx] = {
              team: p.team, name: p.name, gp: 1, va, eff: efficiency,
              mp: p.mp || 0, pts: p.pts || 0, reb: p.reb || 0, ast: p.ast || 0,
              stl: p.stl || 0, blk: p.blk || 0, tov: p.tov || 0,
              fgm: p.fgm || 0, fga: p.fga || 0, tpm: p.tpm || 0, tpa: p.tpa || 0,
              ftm: p.ftm || 0, fta: p.fta || 0, drb: p.drb || 0, orb: p.orb || 0,
            };
            for (const k of ["mp", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "drb", "orb"]) {
              a[k] += p[k] || 0;
            }
          }
        });
        const list = Object.values(agg)
          .map((a) => ({
            ...a,
            ppg: a.pts / a.gp,
            effpg: a.eff / a.gp,
            rpg: a.reb / a.gp,
            apg: a.ast / a.gp,
            spg: a.stl / a.gp,
            bpg: a.blk / a.gp,
            stk: (a.stl + a.blk) / a.gp,
          }))
          .sort((x, y) => y.va - x.va);
        setRows(list);
      })
      .catch((e) => !cancelled && setError(e.message || "Load failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (finalGames.length === 0) return null;

  return (
    <div className="mt-1 border border-stone-300 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-2 py-1.5 text-[10px] uppercase tracking-widest text-stone-600 font-semibold flex items-center gap-1"
      >
        <span className="text-stone-400">{open ? "▾" : "▸"}</span>
        Series Averages
      </button>
      {open && (
        <div className="px-2 pb-2">
          {loading && <div className="py-2 text-[10px] text-stone-500 italic text-center">Loading…</div>}
          {error && <div className="py-2 text-[10px] text-red-600 text-center">{error}</div>}
          {rows && rows.length > 0 && (() => {
            const sortedRows = minGames != null
              ? [...rows].sort((a, b) => (b.va / Math.max(1, b.gp)) - (a.va / Math.max(1, a.gp)))
              : rows;
            const visibleRows = minGames != null ? sortedRows.filter((p) => p.gp >= minGames) : sortedRows;
            // Width of the per-row VA bar — proportional to abs(VA) over
            // the visible list's max so the leader fills the row and
            // everyone else scales down. Floor at 0.5 to avoid divide-by-
            // zero on series where every player has 0 VA.
            const maxAbsVa = Math.max(...visibleRows.map((p) => Math.abs(p.va || 0)), 0.5);
            return (
            <div>
              {minGames != null && (
                <div className="flex items-center justify-end py-1">
                  <button
                    onClick={() => setMinGames(null)}
                    className="normal-case tracking-normal text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1 bg-stone-100 text-stone-700 border-stone-300"
                    aria-label="Clear min-games filter"
                  >
                    ≥{minGames} games <span className="text-stone-400">×</span>
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 border-b border-stone-200">
                <span className="w-10">Team</span>
                <span className="flex-1">Player</span>
                <span className="hidden sm:block w-6 text-right">G</span>
                <span className="w-8 text-right">PPG</span>
                <span className="hidden sm:block w-9 text-right">EFF</span>
                <span className="w-8 text-right">RPG</span>
                <span className="w-8 text-right">APG</span>
                <span className="hidden sm:block w-8 text-right">SPG</span>
                <span className="hidden sm:block w-8 text-right">BPG</span>
                <span className="sm:hidden w-9 text-right">STK</span>
                <span className="hidden sm:block w-12 text-right">TOT VA</span>
              </div>
              {visibleRows.map((p, i) => {
                const owner = teamsMap[p.team]?.owner;
                const isDim = p.team === dimTeam;
                const badgeUseTeam = !isDim && !owner;
                const badge = isDim
                  ? "bg-white text-stone-500 border border-stone-200"
                  : owner ? ownerBadge(owner) : "border";
                const tc = badgeUseTeam ? teamColor(p.team) : null;
                const badgeStyle = badgeUseTeam
                  ? { backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) }
                  : undefined;
                const rowKey = `${p.team}:${p.name}`;
                const isOpen = expanded === rowKey;
                const barColor = (p.va || 0) >= 0
                  ? withAlpha(tc || teamColor(p.team), 0.16)
                  : withAlpha("#dc2626", 0.10);
                const barPct = (Math.abs(p.va || 0) / maxAbsVa) * 100;
                return (
                  <div key={rowKey} data-player-row={p.name} className="border-b border-stone-100 last:border-0">
                    {/* Bar wraps just the click row, not the expanded
                        breakdown — otherwise the team-color tint bleeds
                        through behind the whole VABreakdown panel. */}
                    <div className="relative overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 pointer-events-none"
                        style={{ width: `${barPct}%`, backgroundColor: barColor }}
                        aria-hidden
                      />
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpanded(isOpen ? null : rowKey)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setExpanded(isOpen ? null : rowKey);
                          }
                        }}
                        className={`relative w-full flex items-center gap-2 text-[10px] py-1 text-left cursor-pointer ${isOpen ? "bg-stone-100/60" : ""}`}
                      >
                      <span style={badgeStyle} className={`w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center ${badge}`}>{p.team}</span>
                      <span className="flex-1 truncate text-stone-800">
                        <span className="text-stone-400 mr-1">{isOpen ? "▾" : "▸"}</span>
                        {p.name}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = minGames === p.gp ? null : p.gp;
                          setMinGames(next);
                          if (next != null) setPendingScrollName(p.name);
                        }}
                        className={`hidden sm:block w-6 text-right tabular-nums cursor-pointer hover:text-stone-900 hover:underline ${minGames === p.gp ? "font-semibold text-stone-900" : "text-stone-500"}`}
                        aria-label={`Filter to players with at least ${p.gp} games`}
                      >{p.gp}</button>
                      <span className="w-8 text-right tabular-nums font-bold text-stone-900">{p.ppg.toFixed(1)}</span>
                      <span className={`hidden sm:block w-9 text-right tabular-nums font-semibold ${p.effpg < 0 ? "text-red-600" : "text-stone-700"}`}>{p.effpg.toFixed(1)}</span>
                      <span className="w-8 text-right tabular-nums text-stone-600">{p.rpg.toFixed(1)}</span>
                      <span className="w-8 text-right tabular-nums text-stone-600">{p.apg.toFixed(1)}</span>
                      <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{p.spg.toFixed(1)}</span>
                      <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{p.bpg.toFixed(1)}</span>
                      <span className="sm:hidden w-9 text-right tabular-nums text-stone-600">{p.stk.toFixed(1)}</span>
                      <span className={`hidden sm:block w-12 text-right tabular-nums font-semibold ${p.va < 0 ? "text-red-600" : "text-stone-900"}`}>{p.va.toFixed(1)}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <VABreakdown
                        p={p}
                        lga={lga}
                        teams={teamsMap}
                        rate
                        season={season}
                        defScope="po"
                        gameSeries={p.games}
                        byGame={p.byGame}
                        useTeamColor={useTeamColor}
                        regularSeasonTotals={rsLookup ? (rsLookup.byName[p.name] || rsLookup.byNorm[normalizeName(p.name)] || null) : null}
                        onPrev={i > 0 ? () => setExpanded(`${visibleRows[i - 1].team}:${visibleRows[i - 1].name}`) : undefined}
                        onNext={i < visibleRows.length - 1 ? () => setExpanded(`${visibleRows[i + 1].team}:${visibleRows[i + 1].name}`) : undefined}
                      />
                    )}
                  </div>
                );
              })}
              <div className="text-[9px] text-stone-400 mt-1.5 text-center italic">Sorted by {minGames != null ? "VA / Game" : "total Value Added"} · STK = steals + blocks · tap a row for VA breakdown</div>
            </div>
            );
          })()}
          {rows && rows.length === 0 && !error && (
            <div className="py-2 text-[10px] text-stone-500 italic text-center">No stats</div>
          )}
        </div>
      )}
    </div>
  );
}

function HistorySeriesRow({ s, teamsMap, lga, roundKey, season }) {
  const ta = teamsMap[s.teams[0]];
  const tb = teamsMap[s.teams[1]];
  const sameOwner = ta && tb && ta.owner === tb.owner;
  const ptsA = ta && tb ? potentialPoints(ta, tb, roundKey).total : null;
  const ptsB = ta && tb ? potentialPoints(tb, ta, roundKey).total : null;
  const dimA = sameOwner && ptsA < ptsB;
  const dimB = sameOwner && ptsB < ptsA;
  const dimTeam = dimA ? s.teams[0] : dimB ? s.teams[1] : null;

  const teamCell = (code) => {
    const t = teamsMap[code];
    if (!t) return <div className="flex-1 px-2 py-1.5 border border-stone-200 bg-white text-xs text-stone-400">{code}</div>;
    const isWinner = s.winner === code;
    const dim = code === dimTeam;
    // Dimmed (top seed in a same-owner series) gets a white card even when it won.
    const cellBg = isWinner ? (dim ? "bg-white border-stone-300 border-2" : `${ownerBg(t.owner)} border-2`) : "bg-white border-stone-200";
    return (
      <div className={`flex-1 px-2 py-1.5 border ${cellBg}`}>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-stone-500 tabular-nums w-4">{t.seed}</span>
          <span className={`text-xs font-semibold ${isWinner ? ownerColor(t.owner, dim) : "text-stone-900"}`}>{t.name}</span>
          {isWinner && <span className="ml-auto text-[10px]">✓</span>}
        </div>
        <div className="text-[9px] uppercase tracking-wider mt-0.5 flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${ownerDot(t.owner, dim)}`}></span>
          <span className="text-stone-500">{t.owner}</span>
        </div>
      </div>
    );
  };
  return (
    <div className="mb-3 p-2 bg-stone-50 border border-stone-200 rounded">
      <div className="flex gap-1.5 items-stretch">
        {teamCell(s.teams[0])}
        <div className="flex items-center justify-center px-1 text-[10px] font-bold text-stone-400 tracking-widest">VS</div>
        {teamCell(s.teams[1])}
      </div>
      {s.games.length > 0 ? (
        <>
          <SeriesAverages games={s.games} teamsMap={teamsMap} lga={lga} dimTeam={dimTeam} boxSrc="espn" useTeamColor season={season} />
          <HistoryGameList games={s.games} teamsMap={teamsMap} lga={lga} dimTeam={dimTeam} />
        </>
      ) : (
        <div className="mt-1 text-[10px] text-stone-400 italic text-center py-1">Game data not available</div>
      )}
    </div>
  );
}

function HistoryRoundSection({ round, teamsMap, lga, season }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-baseline justify-between mb-2 pb-1.5 border-b-2 border-stone-900 text-left"
      >
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 flex items-center gap-2">
          <span className="text-stone-400 text-[10px]">{open ? "▾" : "▸"}</span>
          {round.label}
        </h3>
      </button>
      {open && round.series.map((s, i) => (
        <HistorySeriesRow key={i} s={s} teamsMap={teamsMap} lga={lga} roundKey={round.key} season={season} />
      ))}
    </div>
  );
}

function HistoryView({ season }) {
  const data = scoreHistory(season);
  const [showBreakdown, setShowBreakdown] = useState(null);
  const [histGames, setHistGames] = useState(null);
  const [gamesError, setGamesError] = useState(null);
  const [gamesLoading, setGamesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHistGames(null);
    setGamesError(null);
    setGamesLoading(true);
    fetch(`/api/history?season=${season}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
        return d;
      })
      .then((d) => {
        if (!cancelled) setHistGames(d);
      })
      .catch((e) => !cancelled && setGamesError(e.message || "Load failed"))
      .finally(() => !cancelled && setGamesLoading(false));
    return () => { cancelled = true; };
  }, [season]);

  if (!data) return <div className="text-stone-500 text-xs italic">No data for {season}</div>;
  const { breakdown, totals, meta } = data;
  const rounds = historyRounds(season, histGames);
  const lga = lgaForSeason(season);
  const hasGames = rounds?.some((r) => r.series.some((s) => s.games.length > 0));

  return (
    <div>
      <div className="mb-4 p-3 bg-white border border-stone-300">
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-1">Champion</div>
        <div className="text-lg font-bold text-stone-900">{meta.champion}</div>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setShowBreakdown(showBreakdown === "Spencer" ? null : "Spencer")} className="flex-1 text-left">
          <ScoreCard owner="Spencer" total={totals.Spencer} projectedTotal={totals.Spencer} opponentProjected={totals.Trey} breakdown={breakdown.Spencer} readOnly />
        </button>
        <button onClick={() => setShowBreakdown(showBreakdown === "Trey" ? null : "Trey")} className="flex-1 text-left">
          <ScoreCard owner="Trey" total={totals.Trey} projectedTotal={totals.Trey} opponentProjected={totals.Spencer} breakdown={breakdown.Trey} readOnly />
        </button>
      </div>

      {showBreakdown && (
        <div className="mb-5 p-3 bg-white border border-stone-300">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold uppercase tracking-widest text-stone-900">{showBreakdown}'s Points</div>
            <button onClick={() => setShowBreakdown(null)} className="text-stone-400 text-lg leading-none">×</button>
          </div>
          <BreakdownList breakdown={breakdown[showBreakdown]} owner={showBreakdown} />
        </div>
      )}

      <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-2">Rosters</div>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {["Spencer", "Trey"].map((owner) => {
          const teams = Object.entries(meta.teams).filter(([, t]) => t.owner === owner);
          return (
            <div key={owner} className={`p-2 border ${ownerBg(owner)}`}>
              <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${ownerColor(owner)}`}>{owner}</div>
              <div className="space-y-0.5">
                {teams.map(([code, t]) => (
                  <div key={code} className="text-xs flex items-baseline gap-1">
                    <span className="text-[10px] text-stone-500 tabular-nums w-4">{t.seed}</span>
                    <span className="font-semibold text-stone-800">{t.name}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-2">Game Results</div>
        {gamesLoading && (
          <div className="text-[10px] text-stone-500 italic py-2 text-center">Loading games…</div>
        )}
        {gamesError && !gamesLoading && (
          <div className="text-[10px] text-red-600 py-2 text-center px-2 break-words">Couldn’t load games — {gamesError}</div>
        )}
        {!gamesLoading && !gamesError && !hasGames && (
          <div className="text-[10px] text-stone-400 italic py-2 text-center">No game data</div>
        )}
        {hasGames && rounds.map((r) => (
          <HistoryRoundSection key={r.key} round={r} teamsMap={meta.teams} lga={lga} season={season} />
        ))}
      </div>
    </div>
  );
}

const ROUND_LABELS = { r1: "First Round", r2: "Conf Semis", r3: "Conf Finals", r4: "Finals" };

function ExploreSeriesRow({ s, lga, season }) {
  const teamCell = (code, isWinner) => {
    const c = teamColor(code);
    const style = isWinner
      ? { backgroundColor: withAlpha(c, 0.14), borderColor: c }
      : { backgroundColor: "#ffffff", borderColor: withAlpha(c, 0.35) };
    return (
      <div
        style={style}
        className={`flex-1 px-2 py-1.5 border ${isWinner ? "border-2" : ""}`}
      >
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
          <span className="text-sm font-semibold" style={{ color: isWinner ? c : "#1c1917" }}>{code}</span>
          {isWinner && <span className="ml-auto text-[10px]" style={{ color: c }}>✓</span>}
        </div>
      </div>
    );
  };
  return (
    <div className="mb-3 p-2 bg-stone-50 border border-stone-200 rounded">
      <div className="flex gap-1.5 items-stretch">
        {teamCell(s.teams[0], s.winner === s.teams[0])}
        <div className="flex items-center justify-center px-1 text-[10px] font-bold text-stone-400 tracking-widest">VS</div>
        {teamCell(s.teams[1], s.winner === s.teams[1])}
      </div>
      {s.games.length > 0 ? (
        <>
          <SeriesAverages games={s.games} teamsMap={{}} lga={lga} boxSrc="espn" useTeamColor season={season} />
          {s.games.map((g, i) => {
            const liveGame = {
              gameId: g.gameId,
              gameCode: g.gameCode,
              gameStatus: 3,
              gameStatusText: "Final",
              gameDateTimeUTC: g.gameDateTimeUTC,
              home: { tri: g.home.tri, score: g.home.score },
              away: { tri: g.away.tri, score: g.away.score },
            };
            return (
              <LiveGameBanner
                key={g.gameId || i}
                liveGame={liveGame}
                gameLabel={`Game ${i + 1}`}
                lga={lga}
                teams={{}}
                useTeamColor
              />
            );
          })}
        </>
      ) : (
        <div className="mt-1 text-[10px] text-stone-400 italic text-center py-1">No games</div>
      )}
    </div>
  );
}

function ExploreRoundSection({ roundKey, series, lga, season }) {
  const [open, setOpen] = useState(false);
  if (series.length === 0) return null;
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-baseline justify-between mb-2 pb-1.5 border-b-2 border-stone-900 text-left"
      >
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 flex items-center gap-2">
          <span className="text-stone-400 text-[10px]">{open ? "▾" : "▸"}</span>
          {ROUND_LABELS[roundKey] || roundKey}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-stone-400">{series.length} series</span>
      </button>
      {open && series.map((s, i) => (
        <ExploreSeriesRow key={i} s={s} lga={lga} season={season} />
      ))}
    </div>
  );
}

// Seasons available in the picker. ESPN's NBA scoreboard reliably covers
// 1999-00 onward; earlier seasons return empty/erroring responses.
function exploreSeasonList() {
  // Synchronous fallback used until /api/seasons resolves. Covers the same
  // ESPN-supported range the route emits (1999-00 onward, newest first).
  const seasons = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 1; y >= 1999; y--) {
    const end = String((y + 1) % 100).padStart(2, "0");
    seasons.push(`${y}-${end}`);
  }
  return seasons;
}

function PlayoffLeaderboard({ season, lga, scope = "playoffs" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rsError, setRsError] = useState(null);
  const [rsLoading, setRsLoading] = useState(false);
  // Full regular-season rows; feeds the rs/combined scopes AND the per-36
  // reference tick in the playoff drill-in.
  const [rsData, setRsData] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [teamFilter, setTeamFilter] = useState(null);
  const [expanded, setExpanded] = useState(null);
  // Tap a column header (TOT VA, VA/G) to override the composite default
  // sort. Toggles back to composite if the same column is tapped twice.
  // When the min-games filter is active it forces VA/G ordering regardless
  // — keeps the filter coherent.
  const [sortMode, setSortMode] = useState("composite");
  // When set, leaderboard re-sorts by VA/G and trims to players with at
  // least `minGames` GP — the "show me efficiency at comparable volume"
  // filter, tap a G value to set it.
  const [minGames, setMinGames] = useState(null);
  // Name of the player whose G cell was just tapped, so we can scroll
  // their row into view after the list re-sorts/filters.
  const [pendingScrollName, setPendingScrollName] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setShowAll(false);
    setTeamFilter(null);
    setSortMode("composite");
    setMinGames(null);
    setPendingScrollName(null);
    setExpanded(null);
    setRsData(null);
    setRsError(null);
    setLoading(true);
    setRsLoading(true);
    fetchJsonCached(`/api/leaderboard?season=${season}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => !cancelled && setError(e.message || "Load failed"))
      .finally(() => !cancelled && setLoading(false));
    // Regular-season totals load independently so a slow BR fetch doesn't
    // block the playoff leaderboard; in playoff scope they only feed the
    // reference tick, in the other scopes they're the data itself.
    fetchJsonCached(`/api/regular-season?season=${season}`)
      .then((d) => { if (!cancelled && Array.isArray(d.players)) setRsData(d); })
      .catch((e) => !cancelled && setRsError(e.message || "Load failed"))
      .finally(() => !cancelled && setRsLoading(false));
    return () => { cancelled = true; };
  }, [season]);

  // Regular-season rows in leaderboard shape: gp/reb aliases plus VA + EFF
  // computed against the season's league baselines (rs bakes don't carry VA).
  const rsPlayers = useMemo(() => {
    if (!rsData?.players?.length) return null;
    return rsData.players.map((p) => {
      const parts = valueAddParts(p, lga);
      return { ...p, gp: p.g, reb: (p.drb || 0) + (p.orb || 0), va: parts.va, eff: parts.efficiency, games: [] };
    });
  }, [rsData, lga]);

  const rsLookup = useMemo(() => {
    if (!rsData?.players?.length) return null;
    const bySlug = {}, byName = {}, byNorm = {};
    for (const p of rsData.players) {
      if (p.slug) bySlug[p.slug] = p;
      // Multiple players can share a name; the leaderboard prefers slug,
      // but a name lookup is the fallback for the ESPN/live path where
      // we don't have a BR slug. Keeping the *first* row is fine — the
      // bake/route already prefers the TOT row when one exists.
      if (!p.name) continue;
      if (!byName[p.name]) byName[p.name] = p;
      const n = normalizeName(p.name);
      if (n && !byNorm[n]) byNorm[n] = p;
    }
    return { bySlug, byName, byNorm };
  }, [rsData]);

  // Combined scope: playoff rows absorb their regular-season counterpart
  // (slug join, then normalized name), regular-season-only players are kept,
  // VA/EFF recomputed on the summed totals. If the season has no rs bake yet
  // this falls back to the playoff rows alone.
  const combinedPlayers = useMemo(() => {
    if (!data?.players?.length) return null;
    const bySlug = new Map(), byNorm = new Map();
    for (const r of rsPlayers || []) {
      if (r.slug) bySlug.set(r.slug, r);
      const n = normalizeName(r.name);
      if (n && !byNorm.has(n)) byNorm.set(n, r);
    }
    const used = new Set();
    const rows = data.players.map((p) => {
      const r = (p.slug && bySlug.get(p.slug)) || byNorm.get(normalizeName(p.name)) || null;
      if (r) used.add(r);
      const sum = { name: p.name, slug: p.slug || r?.slug, team: p.team, gp: (p.gp || 0) + (r?.gp || 0), games: [] };
      for (const k of ["mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb", "fgm", "fga", "tpm", "tpa", "ftm", "fta"]) {
        sum[k] = (p[k] || 0) + (r ? r[k] || 0 : 0);
      }
      sum.reb = sum.drb + sum.orb;
      const parts = valueAddParts(sum, lga);
      sum.va = parts.va;
      sum.eff = parts.efficiency;
      return sum;
    });
    for (const r of rsPlayers || []) {
      if (!used.has(r)) rows.push(r);
    }
    return rows;
  }, [data, rsPlayers, lga]);

  // League-context pools for the category drill-ins (same panel as By
  // Player). The scope index is a multi-MB payload, so it's fetched lazily on
  // first row expand and cached per scope — and shared with By Player through
  // fetchJsonCached, so whichever view loads it first pays the cost.
  const [ctxByScope, setCtxByScope] = useState({});
  const ctxPlayers = ctxByScope[scope] || null;
  useEffect(() => {
    if (expanded == null || ctxByScope[scope]) return;
    let cancelled = false;
    fetchJsonCached(`/api/players?scope=${scope}`)
      .then((d) => { if (!cancelled) setCtxByScope((c) => ({ ...c, [scope]: d.players || [] })); })
      .catch(() => {}); // context is an enhancement; the breakdown works without it
    return () => { cancelled = true; };
  }, [expanded, scope, ctxByScope]);
  const ctxPools = useMemo(() => (ctxPlayers ? buildScopePools(ctxPlayers) : null), [ctxPlayers]);
  const contextFor = (p) => {
    if (!ctxPools) return null;
    const self = findIndexPlayer(ctxPlayers, p);
    if (!self) return null;
    return { ...ctxPools, self, scope, season };
  };

  useEffect(() => {
    if (!pendingScrollName) return;
    const sel = `[data-player-row="${pendingScrollName.replace(/"/g, '\\"')}"]`;
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingScrollName(null);
  }, [pendingScrollName]);

  const title = scope === "regular" ? "Regular Season Leaderboard"
    : scope === "combined" ? "Combined Leaderboard"
    : "Playoff Leaderboard";
  // What has to finish before this scope can render.
  const scopeLoading = scope === "regular" ? rsLoading : scope === "combined" ? (loading || rsLoading) : loading;
  const scopeError = scope === "regular" ? rsError : error;
  if (scopeLoading) {
    return (
      <div className="mb-4 p-3 bg-white border border-stone-300">
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-2">{title}</div>
        <div className="text-[10px] text-stone-500 italic py-2 text-center">Aggregating box scores… (first load may take ~10s)</div>
      </div>
    );
  }
  if (scopeError) {
    return (
      <div className="mb-4 p-3 bg-white border border-stone-300">
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-2">{title}</div>
        <div className="text-[10px] text-red-600 py-2 text-center px-2 break-words">Couldn’t load — {scopeError}</div>
      </div>
    );
  }

  const all = scope === "regular" ? rsPlayers : scope === "combined" ? combinedPlayers : data?.players;
  if (!all?.length) return null;
  // Composite default sort: each axis (Total VA, VA/G) is scored as a
  // fraction of that axis's leader, then summed. So a player at half
  // the leader's volume scores 0.5 on Total VA — not just "rank #2" —
  // and the gap between adjacent finishers tracks the actual magnitude
  // difference rather than a flat one-rank penalty. Negative values
  // stay negative (a -10 VA against a max of 100 scores -0.10 on that
  // axis), which pulls the composite down to match below-replacement
  // production. Higher composite = better.
  //
  // Two axes, not three: an earlier version added a third "VA/G vs
  // peers with >= my GP" axis, but with magnitude scoring it just
  // doubled the rate signal — high-GP players almost always max their
  // own narrow cohort (free 1.0) and low-GP players' cohort is everyone
  // (so it equals the overall VA/G score exactly). Volume + rate is
  // the clean orthogonal split.
  const vaPerG = (p) => p.va / Math.max(1, p.gp);
  const safeRatio = (v, max) => (max > 0 ? v / max : 0);
  const maxVA = Math.max(...all.map((p) => p.va));
  const maxVAperG = Math.max(...all.map((p) => vaPerG(p)));
  const composite = (p) =>
    safeRatio(p.va, maxVA) + safeRatio(vaPerG(p), maxVAperG);

  // Min-games filter forces VA/G order. Otherwise honour the column
  // header the user clicked (composite by default). Total VA is the
  // explicit tiebreaker for the composite + VA/G sorts so the order
  // doesn't quietly drift if the server-side input order ever shifts.
  const effectiveSort = minGames != null ? "vaPerG" : sortMode;
  const sortedAll =
    effectiveSort === "totalVA" ? [...all].sort((a, b) => b.va - a.va) :
    effectiveSort === "vaPerG"  ? [...all].sort((a, b) => vaPerG(b) - vaPerG(a) || b.va - a.va) :
                                  [...all].sort((a, b) => composite(b) - composite(a) || b.va - a.va);
  const teamFiltered = teamFilter ? sortedAll.filter((p) => p.team === teamFilter) : sortedAll;
  const filtered = minGames != null ? teamFiltered.filter((p) => p.gp >= minGames) : teamFiltered;
  const shown = (showAll || teamFilter || minGames != null) ? filtered : filtered.slice(0, 10);

  // seriesIdx → round lookup, so each game row can carry its round into
  // the VABreakdown drill-in title ("Western Semis vs. MIN" etc.). `data` can
  // still be null here in regular scope, which doesn't wait for the (slow)
  // playoff aggregation it doesn't use.
  const roundBySeries = Object.fromEntries(
    (data?.series || []).map((s) => [s.idx, s.round])
  );

  return (
    <div className="mb-4 border border-stone-300 bg-white">
      <div className="px-3 pt-2.5 pb-1.5 text-[10px] uppercase tracking-[0.3em] text-stone-500 border-b border-stone-200 flex items-center justify-between gap-2">
        <span>{title}</span>
        <div className="flex items-center gap-1.5">
          {minGames != null && (
            <button
              onClick={() => setMinGames(null)}
              className="normal-case tracking-normal text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1 bg-stone-100 text-stone-700 border-stone-300"
              aria-label="Clear min-games filter"
            >
              ≥{minGames} games <span className="text-stone-400">×</span>
            </button>
          )}
          {teamFilter && (() => {
            const c = teamColor(teamFilter);
            return (
              <button
                onClick={() => setTeamFilter(null)}
                className="normal-case tracking-normal text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1"
                style={{ backgroundColor: withAlpha(c, 0.14), color: c, borderColor: withAlpha(c, 0.4) }}
                aria-label={`Clear ${teamFilter} filter`}
              >
                {teamFilter} <span className="text-stone-400">×</span>
              </button>
            );
          })()}
        </div>
      </div>
      {scope === "combined" && !rsPlayers && (
        <div className="px-3 py-1.5 text-[9px] italic text-stone-400 border-b border-stone-200">
          Regular-season totals aren’t baked for {season} yet — showing playoff stats only.
        </div>
      )}
      <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 px-2 border-b border-stone-200">
        <span className="w-6 text-right">#</span>
        <span className="w-10">Team</span>
        <span className="flex-1">Player</span>
        <span className="w-6 text-right">G</span>
        <span className="hidden sm:block w-8 text-right">PPG</span>
        <span className="hidden sm:block w-9 text-right">EFF</span>
        <span className="hidden sm:block w-8 text-right">RPG</span>
        <span className="hidden sm:block w-8 text-right">APG</span>
        <span className="hidden sm:block w-8 text-right">SPG</span>
        <span className="hidden sm:block w-8 text-right">BPG</span>
        <button
          type="button"
          onClick={() => {
            setMinGames(null);
            setSortMode(sortMode === "totalVA" ? "composite" : "totalVA");
          }}
          className={`w-12 text-right uppercase tracking-wider cursor-pointer hover:text-stone-900 ${effectiveSort === "totalVA" ? "text-stone-900 font-semibold" : ""}`}
          aria-label="Sort by total VA"
          aria-pressed={effectiveSort === "totalVA"}
        >
          TOT VA{effectiveSort === "totalVA" ? " ▼" : ""}
        </button>
        <button
          type="button"
          onClick={() => {
            setMinGames(null);
            setSortMode(sortMode === "vaPerG" ? "composite" : "vaPerG");
          }}
          className={`w-10 text-right uppercase tracking-wider cursor-pointer hover:text-stone-900 ${effectiveSort === "vaPerG" ? "text-stone-900 font-semibold" : ""}`}
          aria-label="Sort by VA per game"
          aria-pressed={effectiveSort === "vaPerG"}
        >
          VA/G{effectiveSort === "vaPerG" ? " ▼" : ""}
        </button>
      </div>
      {(() => {
        // VA bar scale — proportional to abs(VA) over the visible list.
        // Computed once per render so all rows share the same denominator.
        const maxAbsVa = Math.max(...shown.map((p) => Math.abs(p.va || 0)), 0.5);
        return shown.map((p, i) => {
        // Keep the overall rank (1, 7, 13…) even when filters trim the
        // visible list. With the min-games filter on, "overall" means
        // ranked by VA/G, since that's how the list is now ordered.
        const rank = sortedAll.indexOf(p) + 1;
        const rowKey = `${p.team}:${p.name}`;
        const isOpen = expanded === rowKey;
        const tc = teamColor(p.team);
        const badgeStyle = { backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) };
        const barColor = p.va >= 0
          ? withAlpha(tc, 0.16)
          : withAlpha("#dc2626", 0.10);
        const barPct = (Math.abs(p.va || 0) / maxAbsVa) * 100;
        // Player's playoff games already chronological from server, with
        // null-va slots for games they sat out inside a series they played
        // (kept so the chart shows a gap and the title uses the true series
        // game number, not the player's appearance count).
        const values = p.games.map((g) => g.va);
        const byGame = p.games.map((g) => g.va == null ? null : ({
          team: p.team, name: p.name, gp: 1, va: g.va,
          mp: g.mp, pts: g.pts, reb: g.reb, drb: g.drb, orb: g.orb,
          ast: g.ast, stl: g.stl, blk: g.blk, tov: g.tov,
          fgm: g.fgm, fga: g.fga, tpm: g.tpm, tpa: g.tpa, ftm: g.ftm, fta: g.fta,
        }));
        const gameContext = p.games.map((g) => ({ opp: g.opp, seriesIdx: g.seriesIdx, seriesGameNumber: g.seriesGameNumber, round: roundBySeries[g.seriesIdx] }));
        const partitions = [];
        for (let j = 1; j < p.games.length; j++) {
          if (p.games[j].seriesIdx !== p.games[j - 1].seriesIdx) partitions.push(j);
        }
        const vaPerG = p.gp > 0 ? p.va / p.gp : 0;
        return (
          <div key={rowKey} data-player-row={p.name} className="border-b border-stone-100 last:border-0">
            {/* Bar wraps just the click row, not the expanded breakdown —
                otherwise the team-color tint bleeds through behind the
                whole VABreakdown panel. */}
            <div className="relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 pointer-events-none"
                style={{ width: `${barPct}%`, backgroundColor: barColor }}
                aria-hidden
              />
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(isOpen ? null : rowKey)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded(isOpen ? null : rowKey);
                }
              }}
              className={`relative w-full flex items-center gap-2 text-[10px] py-1.5 px-2 text-left cursor-pointer ${isOpen ? "bg-stone-100/60" : ""}`}
            >
              <span className="w-6 text-right tabular-nums text-stone-500">{rank}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTeamFilter(teamFilter === p.team ? null : p.team);
                }}
                style={badgeStyle}
                className="w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center border hover:brightness-95"
                aria-label={`Filter by ${p.team}`}
              >{p.team}</button>
              <span className="flex-1 truncate text-stone-800">
                <span className="text-stone-400 mr-1">{isOpen ? "▾" : "▸"}</span>
                {p.name}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = minGames === p.gp ? null : p.gp;
                  setMinGames(next);
                  if (next != null) setPendingScrollName(p.name);
                }}
                className={`w-6 text-right tabular-nums cursor-pointer hover:text-stone-900 hover:underline ${minGames === p.gp ? "font-semibold text-stone-900" : "text-stone-500"}`}
                aria-label={`Filter to players with at least ${p.gp} games`}
              >{p.gp}</button>
              <span className="hidden sm:block w-8 text-right tabular-nums font-bold text-stone-900">{(p.pts / p.gp).toFixed(1)}</span>
              <span className={`hidden sm:block w-9 text-right tabular-nums font-semibold ${p.eff / p.gp < 0 ? "text-red-600" : "text-stone-700"}`}>{(p.eff / p.gp).toFixed(1)}</span>
              <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(p.reb / p.gp).toFixed(1)}</span>
              <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(p.ast / p.gp).toFixed(1)}</span>
              <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(p.stl / p.gp).toFixed(1)}</span>
              <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(p.blk / p.gp).toFixed(1)}</span>
              <span className={`w-12 text-right tabular-nums font-bold ${p.va < 0 ? "text-red-600" : "text-stone-900"}`}>{p.va.toFixed(1)}</span>
              <span className={`w-10 text-right tabular-nums ${vaPerG < 0 ? "text-red-600" : "text-stone-700"}`}>{vaPerG.toFixed(2)}</span>
              </div>
            </div>
            {isOpen && (scope === "playoffs" ? (
              <VABreakdown
                p={p}
                lga={lga}
                teams={{}}
                rate
                season={season}
                defScope={scope === "playoffs" ? "po" : "rs"}
                gameSeries={values}
                byGame={byGame}
                gameContext={gameContext}
                partitions={partitions}
                useTeamColor
                breakdownTitle="Playoff Breakdown"
                gameTileLabel="Playoff Game"
                enableSeriesDrill
                playerConf={TEAM_CONF[p.team] || TEAMS[p.team]?.conf || null}
                regularSeasonTotals={rsLookup ? (rsLookup.bySlug[p.slug] || rsLookup.byName[p.name] || rsLookup.byNorm[normalizeName(p.name)] || null) : null}
                context={contextFor(p)}
                onPrev={i > 0 ? () => setExpanded(`${shown[i - 1].team}:${shown[i - 1].name}`) : undefined}
                onNext={i < shown.length - 1 ? () => setExpanded(`${shown[i + 1].team}:${shown[i + 1].name}`) : undefined}
              />
            ) : (
              // No per-game logs outside the playoffs — show the season-total
              // per-category breakdown instead, with the same category
              // context drill-ins as the playoff view.
              <VACategoryBreakdown player={p} lga={lga} baseline="NBA" context={contextFor(p)} />
            ))}
          </div>
        );
      });
      })()}
      {!teamFilter && minGames == null && all.length > 10 && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="w-full text-center py-2 text-[10px] uppercase tracking-widest text-stone-500 hover:text-stone-900 border-t border-stone-200"
        >
          {showAll ? "Show top 10" : `Show all (${all.length})`}
        </button>
      )}
    </div>
  );
}

function ExploreView() {
  // Season list is fetched from /api/seasons so newly-baked old seasons
  // (filled in by the daily-backfill workflow) show up automatically on
  // next deploy. exploreSeasonList() is the synchronous fallback used
  // until the fetch resolves so the picker isn't empty on first paint.
  const FALLBACK = useMemo(() => exploreSeasonList(), []);
  const [seasons, setSeasons] = useState(FALLBACK);
  const [season, setSeason] = useState(FALLBACK[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("season"); // "season" | "player"
  // Which games count: regular season, playoffs, or both summed. Applies to
  // both By Season and By Player.
  const [scope, setScope] = useState("playoffs"); // "regular" | "playoffs" | "combined"

  useEffect(() => {
    let cancelled = false;
    fetch("/api/seasons")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d?.seasons?.length) return;
        setSeasons(d.seasons);
        // Switch the default to the newest entry the route reports, but
        // only if the user hasn't already navigated somewhere else.
        setSeason((cur) => (cur === FALLBACK[0] ? d.seasons[0] : cur));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [FALLBACK]);

  useEffect(() => {
    // Series box scores only exist for the playoffs; the other scopes render
    // just the leaderboard.
    if (mode !== "season" || scope !== "playoffs") return;
    let cancelled = false;
    setData(null);
    setError(null);
    setLoading(true);
    fetch(`/api/history?season=${season}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
        return d;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => !cancelled && setError(e.message || "Load failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [season, mode, scope]);

  const lga = lgaForSeason(season);
  const byRound = useMemo(() => {
    const out = { r1: [], r2: [], r3: [], r4: [] };
    for (const s of data?.series || []) {
      if (out[s.round]) out[s.round].push(s);
    }
    return out;
  }, [data]);

  const tabCls = (active) =>
    `flex-1 text-[10px] uppercase tracking-[0.2em] px-3 py-2 border ${active ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"}`;

  const scopeCls = (active) =>
    `flex-1 text-[9px] uppercase tracking-[0.15em] px-2 py-1.5 border ${active ? "bg-stone-700 text-white border-stone-700" : "bg-white text-stone-500 border-stone-300 hover:bg-stone-50"}`;

  return (
    <div>
      <div className="mb-2 flex gap-2">
        <button onClick={() => setMode("season")} className={tabCls(mode === "season")}>By Season</button>
        <button onClick={() => setMode("player")} className={tabCls(mode === "player")}>By Player</button>
      </div>
      <div className="mb-4 flex gap-1.5">
        <button onClick={() => setScope("combined")} className={scopeCls(scope === "combined")}>Combined</button>
        <button onClick={() => setScope("regular")} className={scopeCls(scope === "regular")}>Regular Season</button>
        <button onClick={() => setScope("playoffs")} className={scopeCls(scope === "playoffs")}>Playoffs</button>
      </div>

      {mode === "player" ? (
        <PlayerExplorer scope={scope} />
      ) : (
        <>
          <div className="mb-4 p-3 bg-white border border-stone-300">
            <label className="text-[10px] uppercase tracking-[0.3em] text-stone-500 block mb-1">Season</label>
            <select
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              className="w-full text-sm font-bold text-stone-900 bg-white border border-stone-300 px-2 py-1.5"
            >
              {seasons.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div className="text-[10px] text-stone-400 mt-1 italic">Box scores via ESPN and Basketball-Reference.</div>
          </div>

          {scope !== "playoffs" ? (
            <PlayoffLeaderboard season={season} lga={lga} scope={scope} />
          ) : (
            <>
              {loading && <div className="text-[10px] text-stone-500 italic py-4 text-center">Loading {season} playoffs…</div>}
              {error && !loading && <div className="text-[10px] text-red-600 py-4 text-center px-2 break-words">Couldn’t load games — {error}</div>}
              {!loading && !error && data && (
                <>
                  <PlayoffLeaderboard season={season} lga={lga} scope={scope} />
                  {(["r1", "r2", "r3", "r4"]).map((rk) => (
                    <ExploreRoundSection key={rk} roundKey={rk} series={byRound[rk]} lga={lga} season={season} />
                  ))}
                  {data.series && data.series.length === 0 && (
                    <div className="text-[10px] text-stone-400 italic py-4 text-center">No playoff games found for {season}</div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// "By Player" mode: search the cross-season index from /api/players and show a
// single player's playoff seasons ranked by Value Added.
function PlayerExplorer({ scope = "playoffs" }) {
  // One index per scope, cached so flipping the selector doesn't refetch.
  // fetchJsonCached also shares the payload with the By Season context fetch.
  const [cache, setCache] = useState({});
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState(null);
  const selectPlayer = (k) => setSelectedKey(k);
  const index = cache[scope] || null;
  const loading = !index && !error;

  useEffect(() => {
    if (cache[scope]) return;
    let cancelled = false;
    setError(null);
    fetchJsonCached(`/api/players?scope=${scope}`)
      .then((d) => { if (!cancelled) setCache((c) => ({ ...c, [scope]: d.players || [] })); })
      .catch((e) => { if (!cancelled) setError(e.message || "Load failed"); });
    return () => { cancelled = true; };
  }, [scope, cache]);

  const keyOf = (p) => p.slug || p.name;

  const matches = useMemo(() => {
    if (!index) return [];
    const q = normalizeName(query.trim());
    if (q.length < 2) return [];
    return index
      .filter((p) => normalizeName(p.name).includes(q))
      .sort((a, b) => b.bestVa - a.bestVa)
      .slice(0, 30);
  }, [index, query]);

  const player = useMemo(
    () => (index && selectedKey ? index.find((p) => keyOf(p) === selectedKey) || null : null),
    [index, selectedKey]
  );

  // Cross-season/-player pools that power the per-category "league context"
  // dropdown. Each player-season row is tagged with the owner's name + slug so
  // the context can rank, place, and find the player within a season or all-time.
  const contextData = useMemo(() => (index ? buildScopePools(index) : null), [index]);

  if (loading) return <div className="text-[10px] text-stone-500 italic py-6 text-center">Loading player index…</div>;
  if (error) return <div className="text-[10px] text-red-600 py-6 text-center px-2 break-words">Couldn’t load players — {error}</div>;

  if (player) {
    // Keyed so sort/filter/expanded state resets when the player or scope changes.
    return (
      <PlayerDetail
        key={`${keyOf(player)}:${scope}`}
        player={player}
        scope={scope}
        contextData={contextData}
        onBack={() => selectPlayer(null)}
      />
    );
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a player…"
        autoFocus
        className="w-full text-sm text-stone-900 bg-white border border-stone-300 px-3 py-2 mb-3"
      />
      {query.trim().length < 2 ? (
        <div className="text-[10px] text-stone-400 italic py-6 text-center">
          Type a name to see their {scope === "playoffs" ? "playoff runs" : scope === "regular" ? "regular seasons" : "combined seasons"} ranked by Value Added.
        </div>
      ) : matches.length === 0 ? (
        <div className="text-[10px] text-stone-400 italic py-6 text-center">No players match “{query.trim()}”.</div>
      ) : (
        matches.map((p) => (
          <button
            key={keyOf(p)}
            onClick={() => selectPlayer(keyOf(p))}
            className="w-full flex items-baseline justify-between gap-2 px-2 py-2 border-b border-stone-100 text-left hover:bg-stone-50"
          >
            <span className="text-sm font-semibold text-stone-800">{p.name}</span>
            <span className="text-[10px] uppercase tracking-wider text-stone-400 shrink-0">
              {p.seasons.length} {scope === "playoffs" ? "run" : "season"}{p.seasons.length === 1 ? "" : "s"} ·{" "}
              {p.teams.map((t, ti) => (
                <React.Fragment key={t}>
                  {ti > 0 && "/"}
                  <span className="font-semibold" style={{ color: teamColor(t) }}>{t}</span>
                </React.Fragment>
              ))}{" "}
              · best <span className="tabular-nums text-stone-600">{p.bestVa.toFixed(1)}</span>
            </span>
          </button>
        ))
      )}
    </div>
  );
}

// One player's seasons for the selected scope, rendered with the exact same
// treatment as the By Season leaderboard: composite default sort with
// tappable TOT VA / VA/G column headers, team-color badges that filter, a
// min-games filter on the G column, team-tinted VA bars behind rows, and the
// landscape-only per-game stat columns. Rows expand to the same drill-ins.
function PlayerDetail({ player, scope, contextData, onBack }) {
  const [openSeason, setOpenSeason] = useState(null);
  const [sortMode, setSortMode] = useState("composite");
  const [teamFilter, setTeamFilter] = useState(null);
  const [minGames, setMinGames] = useState(null);

  const runNoun = scope === "playoffs" ? "playoff run" : scope === "regular" ? "regular season" : "combined season";
  const seasons = player.seasons;

  // Same composite scoring as the By Season leaderboard: each axis as a
  // fraction of that axis's leader, summed.
  const vaPerG = (x) => x.va / Math.max(1, x.gp);
  const safeRatio = (v, max) => (max > 0 ? v / max : 0);
  const maxVA = Math.max(...seasons.map((x) => x.va));
  const maxVAperG = Math.max(...seasons.map(vaPerG));
  const composite = (x) => safeRatio(x.va, maxVA) + safeRatio(vaPerG(x), maxVAperG);

  const effectiveSort = minGames != null ? "vaPerG" : sortMode;
  const sortedAll =
    effectiveSort === "totalVA" ? [...seasons].sort((a, b) => b.va - a.va) :
    effectiveSort === "vaPerG"  ? [...seasons].sort((a, b) => vaPerG(b) - vaPerG(a) || b.va - a.va) :
                                  [...seasons].sort((a, b) => composite(b) - composite(a) || b.va - a.va);
  const teamFiltered = teamFilter ? sortedAll.filter((x) => x.team === teamFilter) : sortedAll;
  const shown = minGames != null ? teamFiltered.filter((x) => x.gp >= minGames) : teamFiltered;
  const maxAbsVa = Math.max(...shown.map((x) => Math.abs(x.va || 0)), 0.5);

  const contextFor = (s) =>
    contextData ? { ...contextData, self: player, scope, season: s.season } : null;
  const navFor = (i) => ({
    onPrev: i > 0 ? () => setOpenSeason(shown[i - 1].season) : undefined,
    onNext: i < shown.length - 1 ? () => setOpenSeason(shown[i + 1].season) : undefined,
  });

  return (
    <div>
      <button
        onClick={onBack}
        className="text-[10px] uppercase tracking-widest text-stone-500 hover:text-stone-900 mb-3"
      >
        ‹ Back to search
      </button>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-stone-900">{player.name}</h3>
          <div className="text-[10px] uppercase tracking-widest text-stone-500 mt-0.5">
            {player.seasons.length} {runNoun}{player.seasons.length === 1 ? "" : "s"} · {player.teams.join(" / ")} · career VA{" "}
            <span className="tabular-nums text-stone-700 font-semibold">{player.careerVa.toFixed(1)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 pt-1">
          {minGames != null && (
            <button
              onClick={() => setMinGames(null)}
              className="text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1 bg-stone-100 text-stone-700 border-stone-300"
              aria-label="Clear min-games filter"
            >
              ≥{minGames} games <span className="text-stone-400">×</span>
            </button>
          )}
          {teamFilter && (() => {
            const c = teamColor(teamFilter);
            return (
              <button
                onClick={() => setTeamFilter(null)}
                className="text-[10px] font-semibold px-1.5 py-0.5 border inline-flex items-center gap-1"
                style={{ backgroundColor: withAlpha(c, 0.14), color: c, borderColor: withAlpha(c, 0.4) }}
                aria-label={`Clear ${teamFilter} filter`}
              >
                {teamFilter} <span className="text-stone-400">×</span>
              </button>
            );
          })()}
        </div>
      </div>
      <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-stone-400 py-1 px-2 border-b border-stone-200">
        <span className="w-6 text-right">#</span>
        <span className="w-10">Team</span>
        <span className="flex-1">Season</span>
        <span className="w-6 text-right">G</span>
        <span className="hidden sm:block w-8 text-right">PPG</span>
        <span className="hidden sm:block w-9 text-right">EFF</span>
        <span className="hidden sm:block w-8 text-right">RPG</span>
        <span className="hidden sm:block w-8 text-right">APG</span>
        <span className="hidden sm:block w-8 text-right">SPG</span>
        <span className="hidden sm:block w-8 text-right">BPG</span>
        <button
          type="button"
          onClick={() => {
            setMinGames(null);
            setSortMode(sortMode === "totalVA" ? "composite" : "totalVA");
          }}
          className={`w-12 text-right uppercase tracking-wider cursor-pointer hover:text-stone-900 ${effectiveSort === "totalVA" ? "text-stone-900 font-semibold" : ""}`}
          aria-label="Sort by total VA"
          aria-pressed={effectiveSort === "totalVA"}
        >
          TOT VA{effectiveSort === "totalVA" ? " ▼" : ""}
        </button>
        <button
          type="button"
          onClick={() => {
            setMinGames(null);
            setSortMode(sortMode === "vaPerG" ? "composite" : "vaPerG");
          }}
          className={`w-10 text-right uppercase tracking-wider cursor-pointer hover:text-stone-900 ${effectiveSort === "vaPerG" ? "text-stone-900 font-semibold" : ""}`}
          aria-label="Sort by VA per game"
          aria-pressed={effectiveSort === "vaPerG"}
        >
          VA/G{effectiveSort === "vaPerG" ? " ▼" : ""}
        </button>
      </div>
      {shown.map((s, i) => {
        const rank = sortedAll.indexOf(s) + 1;
        const sOpen = openSeason === s.season;
        const tc = teamColor(s.team);
        const badgeStyle = { backgroundColor: withAlpha(tc, 0.14), color: tc, borderColor: withAlpha(tc, 0.4) };
        const barColor = s.va >= 0 ? withAlpha(tc, 0.16) : withAlpha("#dc2626", 0.10);
        const barPct = (Math.abs(s.va || 0) / maxAbsVa) * 100;
        const gp = s.gp || 1;
        const eff = valueAddParts(s, lgaForSeason(s.season)).efficiency;
        return (
          <div key={s.season} className="border-b border-stone-100 last:border-0">
            <div className="relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 pointer-events-none"
                style={{ width: `${barPct}%`, backgroundColor: barColor }}
                aria-hidden
              />
              <div
                role="button"
                tabIndex={0}
                onClick={() => setOpenSeason(sOpen ? null : s.season)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenSeason(sOpen ? null : s.season);
                  }
                }}
                className={`relative w-full flex items-center gap-2 text-[10px] py-1.5 px-2 text-left cursor-pointer ${sOpen ? "bg-stone-100/60" : ""}`}
              >
                <span className="w-6 text-right tabular-nums text-stone-500">{rank}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTeamFilter(teamFilter === s.team ? null : s.team);
                  }}
                  style={badgeStyle}
                  className="w-10 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 text-center border hover:brightness-95"
                  aria-label={`Filter by ${s.team}`}
                >{s.team}</button>
                <span className="flex-1 truncate text-stone-800 font-semibold tabular-nums">
                  <span className="text-stone-400 mr-1 font-normal">{sOpen ? "▾" : "▸"}</span>
                  {s.season}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMinGames(minGames === s.gp ? null : s.gp);
                  }}
                  className={`w-6 text-right tabular-nums cursor-pointer hover:text-stone-900 hover:underline ${minGames === s.gp ? "font-semibold text-stone-900" : "text-stone-500"}`}
                  aria-label={`Filter to seasons with at least ${s.gp} games`}
                >{s.gp}</button>
                <span className="hidden sm:block w-8 text-right tabular-nums font-bold text-stone-900">{(s.pts / gp).toFixed(1)}</span>
                <span className={`hidden sm:block w-9 text-right tabular-nums font-semibold ${eff / gp < 0 ? "text-red-600" : "text-stone-700"}`}>{(eff / gp).toFixed(1)}</span>
                <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{((s.drb + s.orb) / gp).toFixed(1)}</span>
                <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(s.ast / gp).toFixed(1)}</span>
                <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(s.stl / gp).toFixed(1)}</span>
                <span className="hidden sm:block w-8 text-right tabular-nums text-stone-600">{(s.blk / gp).toFixed(1)}</span>
                <span className={`w-12 text-right tabular-nums font-bold ${s.va < 0 ? "text-red-600" : "text-stone-900"}`}>{s.va.toFixed(1)}</span>
                <span className={`w-10 text-right tabular-nums ${s.vaPerG < 0 ? "text-red-600" : "text-stone-700"}`}>{s.vaPerG.toFixed(2)}</span>
              </div>
            </div>
            {sOpen && (scope === "playoffs" ? (
              <PlayerSeasonDrill s={s} indexPlayer={player} context={contextFor(s)} {...navFor(i)} />
            ) : (
              <VACategoryBreakdown player={s} lga={lgaForSeason(s.season)} baseline="NBA" context={contextFor(s)} />
            ))}
          </div>
        );
      })}
      <div className="text-[10px] text-stone-400 italic mt-2 px-2">Tap a season for the per-stat breakdown, then a category for its league context.</div>
    </div>
  );
}

// By Player playoff drill-in: lazily fetch the season's leaderboard (which
// carries the per-game logs and series list) plus the rs totals, then render
// the exact game-chart VABreakdown the By Season leaderboard uses. Falls back
// to the season-totals category breakdown when no game log exists.
function PlayerSeasonDrill({ s, indexPlayer, context, onPrev, onNext }) {
  const season = s.season;
  const lgaS = lgaForSeason(season);
  const [lb, setLb] = useState(null);
  const [rs, setRs] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLb(null);
    setRs(null);
    setFailed(false);
    fetchJsonCached(`/api/leaderboard?season=${season}`)
      .then((d) => { if (!cancelled) setLb(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    fetchJsonCached(`/api/regular-season?season=${season}`)
      .then((d) => { if (!cancelled) setRs(d); })
      .catch(() => {}); // reference ticks are optional
    return () => { cancelled = true; };
  }, [season]);

  const row = useMemo(() => {
    if (!lb?.players) return null;
    const n = normalizeName(indexPlayer.name);
    return lb.players.find((p) =>
      (indexPlayer.slug && p.slug === indexPlayer.slug) || normalizeName(p.name) === n
    ) || null;
  }, [lb, indexPlayer]);

  if (failed || (lb && (!row || !row.games?.length))) {
    return <VACategoryBreakdown player={s} lga={lgaS} baseline="NBA playoff" context={context} />;
  }
  if (!lb) {
    return <div className="px-2 py-3 text-[10px] text-stone-500 italic text-center border-t border-stone-200">Loading game log…</div>;
  }

  const roundBySeries = Object.fromEntries((lb.series || []).map((x) => [x.idx, x.round]));
  const values = row.games.map((g) => g.va);
  const byGame = row.games.map((g) => g.va == null ? null : ({
    team: row.team, name: row.name, gp: 1, va: g.va,
    mp: g.mp, pts: g.pts, reb: g.reb, drb: g.drb, orb: g.orb,
    ast: g.ast, stl: g.stl, blk: g.blk, tov: g.tov,
    fgm: g.fgm, fga: g.fga, tpm: g.tpm, tpa: g.tpa, ftm: g.ftm, fta: g.fta,
  }));
  const gameContext = row.games.map((g) => ({ opp: g.opp, seriesIdx: g.seriesIdx, seriesGameNumber: g.seriesGameNumber, round: roundBySeries[g.seriesIdx] }));
  const partitions = [];
  for (let j = 1; j < row.games.length; j++) {
    if (row.games[j].seriesIdx !== row.games[j - 1].seriesIdx) partitions.push(j);
  }
  const rsTotals = rs?.players
    ? (rs.players.find((p) => (row.slug && p.slug === row.slug))
      || rs.players.find((p) => p.name === row.name)
      || rs.players.find((p) => normalizeName(p.name) === normalizeName(row.name))
      || null)
    : null;

  return (
    <VABreakdown
      p={row}
      lga={lgaS}
      teams={{}}
      rate
      season={season}
      defScope="po"
      gameSeries={values}
      byGame={byGame}
      gameContext={gameContext}
      partitions={partitions}
      useTeamColor
      breakdownTitle="Playoff Breakdown"
      gameTileLabel="Playoff Game"
      enableSeriesDrill
      playerConf={TEAM_CONF[row.team] || TEAMS[row.team]?.conf || null}
      regularSeasonTotals={rsTotals}
      context={context}
      onPrev={onPrev}
      onNext={onNext}
    />
  );
}

function CurrentView() {
  const [winners, setWinners] = useState({});
  const [gameWins, setGameWins] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState(null);
  const [syncSource, setSyncSource] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [liveGamesBySeries, setLiveGamesBySeries] = useState({});
  const [actualGameWins, setActualGameWins] = useState({});
  const [actualWinners, setActualWinners] = useState({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.winners) setWinners(saved.winners);
        if (saved.gameWins) setGameWins(saved.gameWins);
        if (saved.liveGames) {
          // Drop stale cached games: anything not from the current April-June window.
          // Otherwise prior-season playoff games that once slipped past the API
          // filter will haunt the UI until the user hits Reset.
          const cutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;
          const migrated = {};
          for (const [sid, val] of Object.entries(saved.liveGames)) {
            const arr = Array.isArray(val) ? val : [val];
            const fresh = arr.filter((g) => {
              if (!g.gameDateTimeUTC) return false;
              const d = new Date(g.gameDateTimeUTC);
              const m = d.getUTCMonth();
              return m >= 3 && m <= 5 && d.getTime() >= cutoff;
            });
            if (fresh.length) migrated[sid] = fresh;
          }
          setLiveGamesBySeries(migrated);
        }
      }
    } catch (e) {}
    setLoaded(true);
  }, []);

  const persist = useCallback((w, g) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, winners: w, gameWins: g }));
    } catch (e) {}
  }, []);

  const syncLive = useCallback(async (override = false) => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/scores", { cache: "no-store" });
      if (!res.ok) throw new Error(`Proxy ${res.status}`);
      const data = await res.json();

      setLiveGamesBySeries(() => {
        // Treat the API response as authoritative so stale games (e.g. ones a
        // tightened filter no longer matches) drop out instead of lingering.
        const next = {};
        (data.liveGames || []).forEach((g) => {
          if (!next[g.seriesId]) next[g.seriesId] = [];
          next[g.seriesId].push(g);
        });
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          const saved = raw ? JSON.parse(raw) : {};
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, liveGames: next }));
        } catch (e) {}
        return next;
      });

      const actualWinsNext = { ...(data.gameWins || {}) };
      const actualWinnersNext = {};
      Object.entries(actualWinsNext).forEach(([sid, w]) => {
        Object.entries(w).forEach(([team, wins]) => {
          if (wins >= 4) actualWinnersNext[sid] = team;
        });
      });
      setActualGameWins(actualWinsNext);
      setActualWinners(actualWinnersNext);

      setGameWins((prev) => {
        const next = { ...prev };
        Object.entries(actualWinsNext).forEach(([sid, liveWins]) => {
          const cur = prev[sid];
          const curSum = cur ? Object.values(cur).reduce((a, b) => a + b, 0) : 0;
          const liveSum = Object.values(liveWins).reduce((a, b) => a + b, 0);
          if (override || !cur || liveSum >= curSum) next[sid] = liveWins;
        });
        setWinners((prevW) => {
          const nextW = { ...prevW };
          Object.entries(next).forEach(([sid, w]) => {
            Object.entries(w).forEach(([team, wins]) => {
              if (wins >= 4 && nextW[sid] !== team) nextW[sid] = team;
            });
          });
          persist(nextW, next);
          return nextW;
        });
        return next;
      });
      setSyncedAt(new Date(data.fetchedAt || Date.now()));
      setSyncSource(data.source || null);
      if (data.errors && data.errors.length) setSyncError(data.errors.join("; "));
    } catch (e) {
      setSyncError(e.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [persist]);

  useEffect(() => { if (loaded) syncLive(false); }, [loaded, syncLive]);

  useEffect(() => {
    const hasLive = Object.values(liveGamesBySeries).some((arr) =>
      (arr || []).some((g) => g.gameStatus === 2)
    );
    if (!hasLive) return;
    const id = setInterval(() => syncLive(false), 60000);
    return () => clearInterval(id);
  }, [liveGamesBySeries, syncLive]);

  const setWinner = (seriesId, teamCode) => {
    setWinners((prev) => {
      const next = { ...prev };
      if (teamCode === null) delete next[seriesId];
      else next[seriesId] = teamCode;
      const clearDownstream = (id) => {
        const deps = [
          ...BRACKET.r2.filter((s) => s.from.includes(id)),
          ...BRACKET.r3.filter((s) => s.from.includes(id)),
          ...BRACKET.r4.filter((s) => s.from.includes(id)),
        ];
        deps.forEach((d) => {
          if (next[d.id] !== undefined) {
            const newTeams = d.from.map((f) => next[f]);
            if (!newTeams.includes(next[d.id])) {
              delete next[d.id];
              clearDownstream(d.id);
            }
          }
        });
      };
      clearDownstream(seriesId);
      persist(next, gameWins);
      return next;
    });
  };

  const setSeriesGames = (seriesId, teamCode, newValue) => {
    setGameWins((prev) => {
      const nextSeries = { ...(prev[seriesId] || {}) };
      nextSeries[teamCode] = newValue;
      const nextAll = { ...prev, [seriesId]: nextSeries };
      let nextWinners = winners;
      if (newValue >= 4 && winners[seriesId] !== teamCode) {
        nextWinners = { ...winners, [seriesId]: teamCode };
        setWinners(nextWinners);
      }
      persist(nextWinners, nextAll);
      return nextAll;
    });
  };

  const resetAll = () => {
    if (confirm("Reset all picks and re-sync from live data?")) {
      setWinners({});
      setGameWins({});
      setLiveGamesBySeries({});
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ winners: {}, gameWins: {}, liveGames: {} }));
      } catch (e) {}
      syncLive(true);
    }
  };

  const { breakdown, whatIfClinched, projections, whatIfProj, totals, realProjectedTotals, projectedTotals, whatIfTotals, matchups } = useMemo(
    () => computePoints(winners, gameWins, actualGameWins, actualWinners),
    [winners, gameWins, actualGameWins, actualWinners]
  );

  if (!loaded) {
    return <div className="text-stone-500 text-xs uppercase tracking-widest py-12 text-center">Loading…</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-[10px] uppercase tracking-widest text-stone-400 leading-tight">
          {syncedAt ? (<>{syncSource === "baked" ? "Synced" : "Live synced"} <span className="text-stone-600">{syncedAt.toLocaleTimeString()}</span>{syncSource === "baked" && <span className="text-stone-400"> · stored results</span>}</>) : (<>Not synced yet</>)}
          {syncError && <div className="text-red-600 normal-case mt-0.5 tracking-normal">{syncError}</div>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => syncLive(true)} disabled={syncing} className="text-[10px] uppercase tracking-widest text-stone-600 border border-stone-400 px-2 py-1.5 bg-white hover:bg-stone-50 disabled:opacity-50">
            {syncing ? "Syncing…" : "↻ Sync"}
          </button>
          <button onClick={resetAll} className="text-[10px] uppercase tracking-widest text-stone-500 hover:text-stone-900 border border-stone-300 px-2 py-1.5 bg-white">
            Reset
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setShowBreakdown(showBreakdown === "Spencer" ? null : "Spencer")} className="flex-1 text-left">
          <ScoreCard owner="Spencer" total={totals.Spencer} projectedTotal={projectedTotals.Spencer} realProjectedTotal={realProjectedTotals.Spencer} whatIfTotal={whatIfTotals.Spencer} opponentProjected={projectedTotals.Trey} breakdown={breakdown.Spencer} />
        </button>
        <button onClick={() => setShowBreakdown(showBreakdown === "Trey" ? null : "Trey")} className="flex-1 text-left">
          <ScoreCard owner="Trey" total={totals.Trey} projectedTotal={projectedTotals.Trey} realProjectedTotal={realProjectedTotals.Trey} whatIfTotal={whatIfTotals.Trey} opponentProjected={projectedTotals.Spencer} breakdown={breakdown.Trey} />
        </button>
      </div>

      {showBreakdown && (
        <div className={`mb-5 p-3 border-2 ${showBreakdown === "Spencer" ? "bg-amber-50 border-amber-600" : "bg-teal-50 border-teal-600"}`}>
          <div className="flex items-center justify-between mb-2">
            <div className={`text-xs font-bold uppercase tracking-widest ${ownerColor(showBreakdown)}`}>{showBreakdown}'s Points</div>
            <button onClick={() => setShowBreakdown(null)} className="text-stone-400 text-lg leading-none">×</button>
          </div>

          <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1.5">Actual Results</div>
          <BreakdownList breakdown={breakdown[showBreakdown]} owner={showBreakdown} />
          <ProjectionList projections={projections[showBreakdown]} owner={showBreakdown} label="In-Progress Projections" />

          {(whatIfClinched[showBreakdown].length > 0 || whatIfProj[showBreakdown].length > 0) && (
            <div className="mt-4 pt-3 border-t-2 border-dashed border-stone-300">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-stone-500">What If?</div>
                <div className="text-[10px] tabular-nums font-bold text-stone-500">+{whatIfTotals[showBreakdown].toFixed(2)} pts</div>
              </div>
              <WhatIfClinchedList items={whatIfClinched[showBreakdown]} />
              <ProjectionList projections={whatIfProj[showBreakdown]} owner={showBreakdown} label="Speculated Game Wins" muted />
            </div>
          )}
        </div>
      )}

      <details className="mb-5 text-xs text-stone-600 border-l-2 border-stone-300 pl-3">
        <summary className="cursor-pointer font-semibold uppercase tracking-wider text-stone-700 text-[10px]">Scoring rules</summary>
        <div className="mt-2 space-y-1 leading-relaxed">
          <div>R1: 1 pt · R2: 2 pts · CF: 4 pts · Finals: 8 pts</div>
          <div>Upset bonus: winner's seed minus loser's seed (when winner is the lower seed).</div>
          <div>Projection: series-win value × (games won ÷ 4) for any in-progress series.</div>
          <div className="text-stone-400 italic">Solid circles = actual series wins. Pale circles = your speculation. Tap a game banner for box score. Tap any player row for VA breakdown.</div>
        </div>
      </details>

      <UpcomingTodayBanner liveGamesBySeries={liveGamesBySeries} actualWinners={actualWinners} />

      <div>
        <RoundSection roundKey="r1" title="First Round" series={BRACKET.r1} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} actualWinners={actualWinners} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
        <RoundSection roundKey="r2" title="Conference Semifinals" series={BRACKET.r2} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} actualWinners={actualWinners} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
        <RoundSection roundKey="r3" title="Conference Finals" series={BRACKET.r3} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} actualWinners={actualWinners} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
        <RoundSection roundKey="r4" title="NBA Finals" series={BRACKET.r4} matchups={matchups} winners={winners} gameWins={gameWins} actualGameWins={actualGameWins} actualWinners={actualWinners} onPick={setWinner} onGamesChange={setSeriesGames} liveGamesBySeries={liveGamesBySeries} />
      </div>

      <div className="mt-6">
        <PlayoffLeaderboard season="2025-26" lga={LGA} />
      </div>
    </div>
  );
}

function timeAgo(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

// Informational page: data freshness, how the pipeline loads data, and the
// Value Added formula (mirrored from app/scoring.js).
function InfoView() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/data-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setStatus(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const refreshed = status?.lastRefresh ? new Date(status.lastRefresh) : null;

  // Constants are 2025-26 league baselines (per-minute / per-attempt rates).
  const SCORING = [
    { label: "Scoring volume", f: "( PTS/min − 0.409 ) × min" },
    { label: "3-pt shooting", f: "3 × ( 3PM/3PA − 0.360 ) × 3PA" },
    { label: "2-pt shooting", f: "2 × ( 2PM/2PA − 0.548 ) × 2PA" },
    { label: "Free throws", f: "( FTM/FTA − 0.789 ) × FTA" },
  ];
  const PLAYDEF = [
    { label: "Assists", f: "( AST/min − 0.083 ) × min × 2.316 × (1 − 0.470)" },
    { label: "Steals", f: "( STL/min − 0.032 ) × min × 1.014" },
    { label: "Blocks", f: "( BLK/min − 0.014 ) × min × 1.014 × 0.738" },
    { label: "Turnovers", f: "−( TOV/min − 0.052 ) × min × 1.014" },
  ];
  const REB = [
    { label: "Def. rebounds", f: "1.25 × ( DRB/min − 0.122 ) × min × 1.014 × 0.262" },
    { label: "Off. rebounds", f: "1.25 × ( ORB/min − 0.038 ) × min × 1.014 × 0.738" },
  ];

  const Group = ({ title, items }) => (
    <div className="mb-3">
      <div className="text-[9px] uppercase tracking-widest text-stone-400 mb-1">{title}</div>
      {items.map((it) => (
        <div key={it.label} className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 py-1 border-b border-stone-100">
          <span className="text-xs font-semibold text-stone-700">{it.label}</span>
          <span className="text-[11px] tabular-nums text-stone-500" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{it.f}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <section className="p-3 bg-white border border-stone-300">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 mb-2">Data status</h2>
        {status ? (
          <div className="space-y-1 text-sm text-stone-700">
            <div>
              Last refreshed: <span className="font-semibold text-stone-900">{refreshed ? refreshed.toLocaleString() : "—"}</span>
              {refreshed && <span className="text-stone-400"> ({timeAgo(status.lastRefresh)})</span>}
            </div>
            <div className="text-xs text-stone-500">
              {status.seasonsBaked} season{status.seasonsBaked === 1 ? "" : "s"} stored
              {status.earliestSeason && ` (${status.earliestSeason} – ${status.latestSeason})`}
              {status.latestRefreshedSeason && `, most recent bake: ${status.latestRefreshedSeason}.`}
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-stone-400 italic">Checking…</div>
        )}
      </section>

      <section className="p-3 bg-white border border-stone-300 text-sm text-stone-700 leading-relaxed">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 mb-2">How the data loads</h2>
        <p className="mb-2"><span className="font-semibold">Historical playoffs</span> are scraped from <span className="font-semibold">basketball-reference.com</span> by an R pipeline and stored permanently as JSON in the repo. A scheduled job runs <span className="font-semibold">every morning</span>, refreshing the current season and filling in older seasons.</p>
        <p className="mb-2"><span className="font-semibold">Live games</span> — while a series is in progress — come straight from the NBA feed. When that feed is unavailable, the app falls back to the stored results.</p>
        <p>Box scores, leaderboards, and the Value Added numbers below are all computed from this same stored data, so what you see is reproducible and consistent across seasons.</p>
      </section>

      <section className="p-3 bg-white border border-stone-300">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 mb-1">Value Added (VA)</h2>
        <p className="text-sm text-stone-600 mb-3">Points a player creates above — or below — the typical NBA player, given the same workload. Every skill follows one shape:</p>
        <div className="p-2 mb-3 bg-stone-50 border border-stone-200 rounded text-center text-xs text-stone-700" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          ( player rate − <span className="text-amber-700 font-semibold">league rate</span> ) × opportunity × point value
        </div>
        <Group title="Scoring" items={SCORING} />
        <Group title="Playmaking &amp; Defense" items={PLAYDEF} />
        <Group title="Rebounding" items={REB} />
        <p className="text-[10px] text-stone-400 mt-2 leading-relaxed">VA is the sum of all ten. Per-minute baselines are the league&apos;s <span className="font-semibold">minutes-weighted median</span> rates (half of all NBA minutes are played above them, half below) so a few high-usage stars can&apos;t skew the bar; shooting percentages and the conversion constants (points per possession, points per made shot, DRB%/ORB%) are league aggregates. Baselines are season-accurate, so older eras are measured against their own league — not today&apos;s.</p>
      </section>
    </div>
  );
}

// Top college players for the season, ranked by Value Added. Data comes from
// /api/college (baked by scripts/R/fetch_college.R via the bake-college run).
// Per-category VA breakdown for one college player, mirroring the NBA
// VABreakdown: diverging +/- bars (per-GAME contribution above/below the D-I
// average), grouped with separators, plus a Per 36 / Per G stat-label toggle.
// "’26" for "2025-26" — season's end year, short form.
const seasonTag = (s) => "’" + (s || "").slice(5);

// Chip-sized surname: the last token, keeping generational suffixes attached
// ("Trey Murphy III" -> "Murphy III", "Gary Payton II" -> "Payton II",
// "Tim Hardaway Jr." -> "Hardaway Jr.").
function shortName(name) {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length <= 1) return name || "";
  const last = parts[parts.length - 1];
  if (parts.length >= 3 && /^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(last)) {
    return parts.slice(-2).join(" ");
  }
  return last;
}

// Like shortName but prefixed with the first initial ("Trey Murphy III" ->
// "T. Murphy III"), so comp chips disambiguate same-surname players.
function compName(name) {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length <= 1) return name || "";
  return `${parts[0].charAt(0).toUpperCase()}. ${shortName(name)}`;
}

// Compare-side gold, shared by the chip, wrappers, and highlights.
const GOLD = "#f59e0b";                    // border-amber-500
const GOLD_BG = withAlpha("#fbbf24", 0.28); // bg-amber-400, translucent

// Percentile display honoring significant digits at the top end: integers up
// to 99, then 99.5–99.9, then 99.95–99.99. A flat 100 is reserved for the #1
// player-season in the category (isTop).
function formatPercentile(p, isTop) {
  if (p == null) return "–";
  if (isTop) return "100";
  if (p >= 99.95) return Math.min(p, 99.99).toFixed(2);
  if (p >= 99.5) return Math.min(p, 99.9).toFixed(1);
  return String(Math.min(Math.round(p), 99));
}

// --- Compare (both breakdowns) ----------------------------------------------
// Group the context pools back into players for the Compare picker.
function buildComparePlayers(allRows) {
  const m = new Map();
  for (const r of allRows) {
    const k = r.slug || "n:" + normalizeName(r.name);
    let e = m.get(k);
    if (!e) m.set(k, (e = { name: r.name, slug: r.slug || null, seasons: [] }));
    e.seasons.push(r);
    if (r.season > (e._latest || "")) { e.name = r.name; e._latest = r.season; }
  }
  const out = [...m.values()];
  for (const e of out) {
    delete e._latest;
    e.seasons.sort((x, y) => y.season.localeCompare(x.season));
    e.bestVa = Math.max(...e.seasons.map((s) => s.va || 0));
  }
  return out;
}

// The three ways to rank/label closest comps. Order matches the toggle.
const COMP_METRIC_OPTS = [
  { key: "imp", label: "Imp", word: "impact", title: "Impact — how close their overall per-game VA level is to this player's" },
  { key: "sim", label: "Sim", word: "similarity", title: "Similarity — cosine match of the two VA-by-category profiles" },
  { key: "impsim", label: "Imp×Sim", word: "imp×sim", title: "Impact × Similarity — the two combined into one closeness score" },
];
const COMP_METRIC_WORD = Object.fromEntries(COMP_METRIC_OPTS.map((o) => [o.key, o.word]));

// Inline picker: search a player from the scope index, then tap one of their
// seasons. onPick gets { name, slug, seasons, row }.
function ComparePicker({ context, self = null, onPick, onCancel }) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(null);
  const players = useMemo(() => buildComparePlayers(context.allRows), [context]);
  const matches = useMemo(() => {
    const q = normalizeName(query.trim());
    if (q.length < 2) return [];
    return players
      .filter((pl) => normalizeName(pl.name).includes(q))
      .sort((a, b) => b.bestVa - a.bestVa)
      .slice(0, 12);
  }, [players, query]);

  // Closest comps: the nearest player-seasons to `self` by per-game VA-category
  // shape — the full ranked list per decade, best match first. Similarity =
  // cosine of the two 10-dim VA vectors (a dot product of unit vectors);
  // magnitude-weighted score breaks ties so equal-% chips still order by how
  // close the overall level is. The ±7 MPG band keeps comps in a similar
  // minutes role. Shown before searching. The single O(pool) similarity pass
  // is unchanged; keeping 12 per decade instead of 1 costs nothing extra.
  const COMPS_PER_DECADE = 12;
  // Which quantity the comps are ranked/shown by (see COMP_METRIC_OPTS):
  //   sim    — cosine similarity (archetype match)
  //   imp    — magnitude similarity (how close their overall VA level is)
  //   impsim — the two multiplied (holistic closeness)
  const [compMetric, setCompMetric] = useState("impsim");

  // The expensive O(pool) similarity pass. Each surviving candidate carries all
  // three ranking values so the metric toggle can re-sort without recomputing
  // any dot products. Keyed only on [self, context], so toggling is cheap.
  const rawComps = useMemo(() => {
    if (!self || !(self.mp > 0)) return [];
    const qVec = perGameVAVec(self, lgaForSeason(self.season));
    const qNorm = Math.hypot(...qVec);
    if (!qNorm) return [];
    const selfSlug = self.slug || null;
    const selfNormName = normalizeName(self.name || "");
    // Only comp players in a similar minutes role: a 35-MPG star shouldn't
    // match a 15-20 MPG bench player even if their per-minute shape is close.
    const qMPG = self.mp / (self.gp || 1);
    const MPG_BAND = 7;
    const byDecade = new Map(); // decade -> [{r, cos, mag, score}]
    for (const r of context.allRows) {
      if ((r.gp || 0) < 8 || !(r.mp > 0)) continue;
      if (selfSlug ? r.slug === selfSlug : normalizeName(r.name) === selfNormName) continue;
      if (Math.abs(r.mp / (r.gp || 1) - qMPG) > MPG_BAND) continue;
      const v = perGameVAVec(r, lgaForSeason(r.season));
      const n = Math.hypot(...v);
      if (!n) continue;
      let dot = 0;
      for (let i = 0; i < qVec.length; i++) dot += qVec[i] * v[i];
      const cos = dot / (qNorm * n);
      if (cos < 0.3) continue; // clearly different archetype — never a "comp"
      const mag = Math.min(qNorm, n) / Math.max(qNorm, n);
      const dec = Math.floor(parseInt(r.season.slice(0, 4), 10) / 10) * 10;
      let arr = byDecade.get(dec);
      if (!arr) byDecade.set(dec, (arr = []));
      arr.push({ r, cos, mag, score: cos * mag });
    }
    return [...byDecade.entries()].sort((x, y) => y[0] - x[0]); // most recent decade first
  }, [self, context]);

  // Value of the currently selected metric for a candidate.
  const metricVal = (o) => (compMetric === "imp" ? o.mag : compMetric === "impsim" ? o.score : o.cos);

  // Re-rank each decade by the selected metric (no dot products — just a sort).
  const comps = useMemo(() => {
    return rawComps.map(([dec, arr]) => ({
      dec,
      list: [...arr]
        .sort((x, y) => (metricVal(y) - metricVal(x)) || (y.cos - x.cos))
        .slice(0, COMPS_PER_DECADE),
    }));
  }, [rawComps, compMetric]);

  const compKey = (r) => r.season + (r.slug || r.name);
  // The single best comp across every decade by the selected metric — gold-lit
  // so the strongest match stands out no matter which decade row it lands in.
  const bestCompKey = useMemo(() => {
    let key = null, best = -Infinity;
    for (const { list } of comps) {
      for (const item of list) {
        const v = metricVal(item);
        if (v > best) { best = v; key = compKey(item.r); }
      }
    }
    return key;
  }, [comps, compMetric]);

  const pickComp = (r) => {
    const pl = players.find((p) => (r.slug ? p.slug === r.slug : normalizeName(p.name) === normalizeName(r.name)));
    const row = (pl && pl.seasons.find((s) => s.season === r.season)) || r;
    onPick({ name: pl?.name || r.name, slug: pl?.slug || r.slug || null, seasons: pl?.seasons || [r], row });
  };

  // On mobile the on-screen keyboard covers the lower half of the viewport,
  // which would bury the results that render below the search box. Pin the
  // picker to the top of the viewport when the field gains focus so the
  // matches/comps stay visible above the keyboard. Deferred so the scroll runs
  // after the keyboard has begun opening.
  const panelRef = useRef(null);
  const onSearchFocus = () => {
    setTimeout(() => panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 300);
  };

  return (
    <div ref={panelRef} className="my-1.5 px-2 py-2 bg-white border border-amber-400 rounded text-[10px] scroll-mt-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="uppercase tracking-wider text-[9px] text-stone-500">Compare against…</span>
        <button onClick={onCancel} className="text-stone-400 hover:text-stone-700 px-1" aria-label="Cancel compare">✕</button>
      </div>
      {!sel ? (
        <>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={onSearchFocus}
            placeholder="Search a player…"
            autoFocus
            className="w-full text-xs text-stone-900 bg-white border border-stone-300 px-2 py-1 mb-1"
          />
          {query.trim() === "" && comps.length > 0 && (
            <div className="mb-1">
              <div className="flex items-center justify-between gap-2 mt-1 mb-0.5">
                <span className="uppercase tracking-wider text-[8px] text-stone-400 shrink-0">Closest comps · by decade</span>
                <div className="flex shrink-0 border border-stone-200 rounded-sm overflow-hidden">
                  {COMP_METRIC_OPTS.map((o) => (
                    <button
                      key={o.key}
                      onClick={() => setCompMetric(o.key)}
                      title={o.title}
                      className={`px-1.5 py-0.5 text-[8px] uppercase tracking-wider ${compMetric === o.key ? "bg-amber-400 text-amber-950 font-semibold" : "bg-white text-stone-400 hover:bg-amber-50"}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              {comps.map(({ dec, list }) => (
                <div key={dec} className="flex items-center gap-1.5 py-0.5 border-b border-stone-100 last:border-0">
                  <span className="shrink-0 w-7 text-[8px] uppercase tracking-wider text-stone-400 tabular-nums">’{String(dec).slice(2)}s</span>
                  <div className="flex gap-1 overflow-x-auto min-w-0 pb-0.5">
                    {list.map((item) => {
                      const { r } = item;
                      const pct = Math.min(99, Math.round(metricVal(item) * 100));
                      const isBest = compKey(r) === bestCompKey;
                      return (
                        <button
                          key={compKey(r)}
                          onClick={() => pickComp(r)}
                          className={`shrink-0 px-1.5 py-0.5 border rounded-sm hover:border-amber-500 hover:bg-amber-50 whitespace-nowrap ${isBest ? "border-amber-500" : "border-stone-200"}`}
                          style={isBest ? { backgroundColor: GOLD_BG, borderColor: GOLD } : undefined}
                          title={`${r.name} ${r.season} · ${r.team} · ${pct}% ${COMP_METRIC_WORD[compMetric]}${isBest ? " · best match" : ""}`}
                        >
                          <span className="font-semibold" style={{ color: teamColor(r.team) }}>{compName(r.name)}</span>
                          <span className="text-stone-400"> {seasonTag(r.season)}</span>
                          <span className="text-stone-500 tabular-nums text-[9px]"> {pct}%</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {matches.map((pl) => (
            <button
              key={pl.slug || pl.name}
              onClick={() => setSel(pl)}
              className="w-full flex items-baseline justify-between gap-2 px-1 py-1 border-b border-stone-100 last:border-0 text-left hover:bg-stone-50"
            >
              <span className="font-semibold text-stone-800">{pl.name}</span>
              <span className="text-[9px] text-stone-400">{pl.seasons.length} seasons · best <span className="tabular-nums text-stone-600">{pl.bestVa.toFixed(1)}</span></span>
            </button>
          ))}
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between mb-1">
            <span className="font-semibold text-stone-800">{sel.name}</span>
            <button onClick={() => setSel(null)} className="text-[9px] text-stone-400 hover:text-stone-700">‹ change player</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {sel.seasons.map((s) => (
              <button
                key={s.season}
                onClick={() => onPick({ name: sel.name, slug: sel.slug, seasons: sel.seasons, row: s })}
                className="px-1.5 py-0.5 border border-stone-300 hover:border-amber-500 hover:bg-amber-50 tabular-nums"
                style={{ color: teamColor(s.team) }}
              >
                {seasonTag(s.season)} {s.team} <span className="text-stone-500">{(s.vaPerG ?? 0).toFixed(1)}/G</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Head-to-head comparison of two player-seasons, each measured against their
// OWN season's league baselines (era-fair). Three pieces: a category-win
// tally, per-category paired team-color bars (or per-season-percentile dots),
// and a career-year VA/G overlay.
// Raw-stats drill for one category, laid out as metric-ROWS × player-COLUMNS
// (the winner of each row is flagged so the UI can circle it). Counting cats:
// per-game / per-36 / total; shooting cats: made-att per game / pct / total
// makes. Fewer turnovers wins.
function compareStatRows(a, b, key) {
  const rows = [];
  const push = (label, aDisp, bDisp, aCmp, bCmp, lowerBetter = false) => {
    let win = null;
    if (aCmp !== bCmp) {
      const aBetter = lowerBetter ? aCmp < bCmp : aCmp > bCmp;
      win = aBetter ? "a" : "b";
    }
    rows.push({ label, a: aDisp, b: bDisp, win });
  };
  if (CAT_SHOOTING[key]) {
    // "2PM/2PA · 2P% · TOT 2PM" (per-game made/att in the first row).
    const t = CAT_SHORT[key]; // 2P / 3P / FT
    const [am, aa] = CAT_SHOOTING[key](a), [bm, ba] = CAT_SHOOTING[key](b);
    const agp = a.gp || 1, bgp = b.gp || 1;
    push(`${t}M/${t}A`, `${(am / agp).toFixed(1)}/${(aa / agp).toFixed(1)}`,
      `${(bm / bgp).toFixed(1)}/${(ba / bgp).toFixed(1)}`, am / agp, bm / bgp);
    push(`${t}%`, `${aa > 0 ? ((am / aa) * 100).toFixed(1) : "0.0"}%`,
      `${ba > 0 ? ((bm / ba) * 100).toFixed(1) : "0.0"}%`, aa > 0 ? am / aa : 0, ba > 0 ? bm / ba : 0);
    push(`TOT ${t}M`, String(Math.round(am)), String(Math.round(bm)), am, bm);
    return rows;
  }
  // "PTS/G · PTS/36 · TOT PTS" (AST, TOV, DRB, ORB, STL, BLK likewise).
  const tag = CAT_COUNTING[key] ? CAT_COUNTING[key][1] : (GROUP_STAT[key] || [null, ""])[1];
  const statOf = CAT_COUNTING[key] ? (r) => (r[CAT_COUNTING[key][0]] || 0) : (GROUP_STAT[key] || [() => 0])[0];
  const av = statOf(a), bv = statOf(b);
  const lower = key === "Turnovers";
  push(`${tag}/G`, (av / (a.gp || 1)).toFixed(1), (bv / (b.gp || 1)).toFixed(1), av / (a.gp || 1), bv / (b.gp || 1), lower);
  push(`${tag}/36`, ((av / (a.mp || 1)) * 36).toFixed(1), ((bv / (b.mp || 1)) * 36).toFixed(1), (av / (a.mp || 1)) * 36, (bv / (b.mp || 1)) * 36, lower);
  push(`TOT ${tag}`, String(Math.round(av)), String(Math.round(bv)), av, bv, lower);
  return rows;
}

function ComparePanel({ a, b, bSeasons, context, rateMode, mode, setMode }) {
  // The compare view is Basic-first: the four groups are the top level, a tap
  // on a group drops down its member categories, and a tap on a member opens
  // the raw-stats table. (The Basic/By Category and Per 36/Per G toggles are
  // hidden while comparing; the Values/Percentiles mode lives in the parent's
  // toggle row.)
  // Groups AND raw-stats cards are independent accordions — any number can be
  // open at once, and they stay open for the life of this comparison (the
  // panel is keyed by the comparison at its call sites, so picking a different
  // player-season or season row resets everything).
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const [openKeys, setOpenKeys] = useState(() => new Set()); // member categories with raw stats open
  const toggleGroup = (gk, cats) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(gk)) {
        next.delete(gk);
        // Closing a group hides its members, so drop open raw cards inside it.
        setOpenKeys((ks) => {
          const nk = new Set(ks);
          for (const c of cats) nk.delete(c);
          return nk;
        });
      } else {
        next.add(gk); // insertion order = most-recently-opened last (drives the chart)
      }
      return next;
    });
  };
  const toggleKey = (k) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const lgaA = lgaForSeason(a.season);
  const lgaB = lgaForSeason(b.season);
  const ca = teamColor(a.team);
  const cb = teamColor(b.team);
  // The comparison side is "wrapped in gold" (the Compare-chip amber) with a
  // light team-color fill inside — see GOLD/GOLD_BG.
  const cbFill = withAlpha(cb, 0.25);
  const cbEdge = `1px solid ${GOLD}`;

  const GROUP_KEYS = VA_GROUPS.map((g) => g.key);
  const ALL_KEYS = [...GROUP_KEYS, ...VA_CATEGORY_ORDER];

  const d = useMemo(() => {
    // Percentiles rank against EVERY indexed player-season (all-time pool),
    // each row measured era-fair against its own season's baselines. One pass
    // over the pool computes every group + category at once; the >=5 G floor
    // matches the all-time rank in the context card. The pool max per key
    // marks the #1 season, the only one allowed to display a flat 100.
    const pool = context.allRows.filter((r) => (r.gp || 0) >= 5 && r.mp > 0);
    const maxByKey = {};
    const poolVals = pool.map((r) => {
      const lgaX = lgaForSeason(r.season);
      const out = {};
      for (const key of ALL_KEYS) {
        out[key] = catVAperGame(r, lgaX, key);
        if (maxByKey[key] == null || out[key] > maxByKey[key]) maxByKey[key] = out[key];
      }
      return out;
    });
    const pctFor = (v, key) => {
      if (!poolVals.length) return null;
      let below = 0;
      for (const pv of poolVals) if (pv[key] < v) below++;
      return (below / poolVals.length) * 100;
    };
    const rows = {};
    for (const key of ALL_KEYS) {
      const av = catVAperGame(a, lgaA, key);
      const bv = catVAperGame(b, lgaB, key);
      rows[key] = {
        key, av, bv,
        apct: pctFor(av, key), bpct: pctFor(bv, key),
        // #1 in the category = at least the pool max. Epsilon absorbs the tiny
        // mp-rounding gap between a leaderboard row (full-precision minutes)
        // and its own copy in the index pool (minutes rounded to 0.1).
        atop: maxByKey[key] != null && av >= maxByKey[key] - 1e-6,
        btop: maxByKey[key] != null && bv >= maxByKey[key] - 1e-6,
      };
    }
    const diff = GROUP_KEYS.reduce((s, k) => s + rows[k].av - rows[k].bv, 0);
    return { rows, diff };
  }, [a, b, lgaA, lgaB, context]);

  const sgn = (v, dp = 2) => (v > 0 ? "+" : "") + v.toFixed(dp);
  const leader = d.diff >= 0 ? a : b;
  // Bars scale per level: groups against groups, members against their group.
  const scaleFor = (ks) => Math.max(...ks.flatMap((k) => [Math.abs(d.rows[k].av), Math.abs(d.rows[k].bv)]), 0.1);

  // Career overlay: both players' seasons aligned by career year, showing
  // TOTAL VA per season. With a category selected it shows that category's
  // total VA per season (era-fair: each season vs its own baselines).
  // Diverging from a shared zero baseline, since category VA (Turnovers!)
  // can be negative season after season.
  const aSeasons = [...(context.self?.seasons || [])].sort((x, y) => x.season.localeCompare(y.season));
  const bAll = [...bSeasons].sort((x, y) => x.season.localeCompare(y.season));
  const slots = Math.max(aSeasons.length, bAll.length);
  // Deepest selection wins: an open member category, else the open group.
  // The career overlay follows the deepest interaction: an open raw-stats card
  // wins; otherwise the most-recently-opened group (Set insertion order).
  const activeKey = ([...openKeys].at(-1) ?? null) || ([...openGroups].at(-1) ?? null);
  const careerVal = (s) => (activeKey ? catVATotal(s, lgaForSeason(s.season), activeKey) : (s.va || 0));
  const cvals = [...aSeasons, ...bAll].map(careerVal);
  const cHi = Math.max(0, ...cvals), cLo = Math.min(0, ...cvals);
  const cSpan = (cHi - cLo) || 1;
  const cZeroPct = (cHi / cSpan) * 100; // baseline's offset from the top
  const careerLabel = activeKey ? `${CAT_SHORT[activeKey] || activeKey} total VA by career year` : "Total VA by career year";

  const Swatch = ({ color, outline }) => (
    <span
      className="inline-block w-2 h-2 rounded-sm align-middle mx-1"
      style={outline ? { backgroundColor: withAlpha(color, 0.25), border: `1px solid ${GOLD}` } : { backgroundColor: color }}
    />
  );

  return (
    <div className="text-[10px]">
      {/* Legend + tally (the head-to-head scorecard header) */}
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="font-semibold truncate" style={{ color: ca }}><Swatch color={ca} />{a.name} {seasonTag(a.season)}</span>
        <span className="text-stone-400 shrink-0">vs</span>
        <span className="font-semibold truncate text-right rounded-sm px-1 py-[1px]" style={{ color: cb, backgroundColor: GOLD_BG, border: `1px solid ${withAlpha(GOLD, 0.5)}` }}>{b.name} {seasonTag(b.season)}<Swatch color={cb} outline /></span>
      </div>
      <div className="text-center text-[9px] mb-1.5 font-semibold" style={{ color: d.diff >= 0 ? ca : cb }}>
        {seasonTag(leader.season)} {leader.name} <span className="tabular-nums">{sgn(Math.abs(d.diff))} VA/G</span>
      </div>
      {/* Rows flanked by a slim vertical Expand All / Collapse All rail that
          opens (or closes) every group and every raw-stats card at once. */}
      <div className="flex items-stretch gap-1">
      {(() => {
        const allOpen = openGroups.size >= VA_GROUPS.length && openKeys.size >= VA_CATEGORY_ORDER.length;
        const toggleAll = () => {
          if (allOpen) {
            setOpenGroups(new Set());
            setOpenKeys(new Set());
          } else {
            setOpenGroups(new Set(GROUP_KEYS));
            setOpenKeys(new Set(VA_CATEGORY_ORDER));
          }
        };
        return (
          <button
            type="button"
            onClick={toggleAll}
            aria-pressed={allOpen}
            className="shrink-0 w-4 rounded-sm border border-stone-200 bg-white text-[8px] uppercase tracking-[0.15em] text-stone-400 hover:text-stone-700 hover:border-stone-300 flex items-center justify-center"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            {allOpen ? "Collapse All" : "Expand All"}
          </button>
        );
      })()}
      <div className="flex-1 min-w-0">
      {VA_GROUPS.map((g) => {
        const groupOpen = openGroups.has(g.key);
        const rowFor = (key, scale, member) => {
          const r = d.rows[key];
          const isOpen = member ? openKeys.has(key) : groupOpen;
          const toggle = member
            ? () => toggleKey(key)
            : () => toggleGroup(g.key, g.cats);
          return (
            <React.Fragment key={key}>
              <div
                className={`flex items-center gap-2 py-[1px] -mx-1 px-1 cursor-pointer ${isOpen ? "bg-stone-200" : ""}`}
                onClick={toggle}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
                aria-pressed={isOpen}
              >
                <span className={`w-[4.5rem] shrink-0 text-right ${member ? "" : "font-semibold"} ${isOpen ? "text-stone-900 font-semibold" : member ? "text-stone-500" : "text-stone-700"}`}>
                  {!member && <span className="text-stone-400 mr-0.5 font-normal">{isOpen ? "▾" : "▸"}</span>}{key}
                </span>
                {mode === "values" ? (
                  <>
                    <div className="flex-1 relative h-5" title={`${a.name}: ${catRateLabel(a, key, rateMode)} · ${b.name}: ${catRateLabel(b, key, rateMode)}`}>
                      <div className="absolute inset-y-0 left-1/2 w-px bg-stone-300" />
                      <div className="absolute h-[7px] top-[3px]" style={{ backgroundColor: ca, left: r.av >= 0 ? "50%" : `${50 - (Math.abs(r.av) / scale) * 45}%`, width: `${(Math.abs(r.av) / scale) * 45}%` }} />
                      <div className="absolute h-[7px] bottom-[3px] box-border" style={{ backgroundColor: cbFill, border: cbEdge, left: r.bv >= 0 ? "50%" : `${50 - (Math.abs(r.bv) / scale) * 45}%`, width: `${(Math.abs(r.bv) / scale) * 45}%` }} />
                    </div>
                    <span className="w-10 shrink-0 tabular-nums text-right font-semibold" style={{ color: ca }}>{sgn(r.av)}</span>
                    <span className="w-10 shrink-0 tabular-nums text-right font-semibold rounded-sm pr-0.5" style={{ color: cb, backgroundColor: GOLD_BG }}>{sgn(r.bv)}</span>
                  </>
                ) : (
                  <>
                    <div className="flex-1 relative h-4">
                      <div className="absolute top-1/2 -translate-y-1/2 inset-x-0 h-1 bg-stone-200 rounded-full" />
                      {r.apct != null && <div className="absolute top-1/2 w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 ring-1 ring-white" style={{ left: `${r.apct}%`, backgroundColor: ca }} />}
                      {r.bpct != null && <div className="absolute top-1/2 w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 box-border" style={{ left: `${r.bpct}%`, backgroundColor: cbFill, border: cbEdge }} />}
                    </div>
                    <span className="w-10 shrink-0 tabular-nums text-right font-semibold" style={{ color: ca }}>{formatPercentile(r.apct, r.atop)}</span>
                    <span className="w-10 shrink-0 tabular-nums text-right font-semibold rounded-sm pr-0.5" style={{ color: cb, backgroundColor: GOLD_BG }}>{formatPercentile(r.bpct, r.btop)}</span>
                  </>
                )}
              </div>
              {member && isOpen && (() => {
                // Flipped raw-stats card: player columns, metric rows, the
                // leader of each row circled (per the mock). B column keeps the
                // gold identity tint.
                const rows = compareStatRows(a, b, key);
                const head = (row, color, gold) => (
                  <div className={`min-w-0 px-1 py-0.5 rounded-sm ${gold ? "" : ""}`} style={gold ? { backgroundColor: GOLD_BG } : undefined}>
                    <div className="flex items-center gap-0.5 justify-end">
                      <Swatch color={color} outline={gold} />
                      <span className="truncate font-semibold text-[10px] leading-tight" style={{ color }}>{row.name}</span>
                    </div>
                    <div className="text-[8px] text-stone-400 text-right leading-tight">{seasonTag(row.season)} · {row.gp || 0} G</div>
                  </div>
                );
                const cell = (disp, win, gold) => (
                  <div className="px-1 py-[1px] rounded-sm text-right" style={gold ? { backgroundColor: GOLD_BG } : undefined}>
                    <span className={`inline-block tabular-nums text-[10px] leading-tight ${win ? "font-bold text-stone-900 ring-1 ring-stone-500 rounded-full px-1.5 py-[1px]" : "text-stone-600 px-1.5 py-[1px]"}`}>{disp}</span>
                  </div>
                );
                return (
                  <div className="my-1 px-1.5 py-1.5 bg-white border border-stone-200 rounded">
                    <div className="grid grid-cols-[3.4rem_1fr_1fr] gap-x-1 items-end pb-1 border-b border-stone-100">
                      <span></span>
                      {head(a, ca, false)}
                      {head(b, cb, true)}
                    </div>
                    {rows.map((r) => (
                      <div key={r.label} className="grid grid-cols-[3.4rem_1fr_1fr] gap-x-1 items-center py-[2px]">
                        <span className="text-[8px] uppercase tracking-wider text-stone-400 text-right">{r.label}</span>
                        {cell(r.a, r.win === "a", false)}
                        {cell(r.b, r.win === "b", true)}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </React.Fragment>
          );
        };
        return (
          <React.Fragment key={g.key}>
            {rowFor(g.key, scaleFor(GROUP_KEYS), false)}
            {groupOpen && (
              <div className="ml-3 pl-1 border-l-2 border-stone-200 my-0.5">
                {g.cats.map((ck) => rowFor(ck, scaleFor(g.cats), true))}
              </div>
            )}
          </React.Fragment>
        );
      })}
      </div>
      </div>
      <div className="mt-1 text-center text-[9px] italic text-stone-400">
        {(mode === "values"
          ? "Per-game VA, each vs their own season’s league baseline"
          : "Percentile across every indexed player-season, ≥5 G, each vs their own era") + " · tap a group for its categories, a category for raw stats"}
      </div>

      {/* Career-year overlay */}
      {slots > 1 && (
        <div className="mt-2 pt-2 border-t border-stone-100">
          <div className="uppercase tracking-wider text-[9px] text-stone-400 mb-1">{careerLabel}</div>
          <div className="flex items-stretch gap-[2px] h-16 px-1">
            {Array.from({ length: slots }, (_, i) => {
              const as = aSeasons[i], bs = bAll[i];
              const bar = (s, color, side) => {
                if (!s) return null;
                const v = careerVal(s);
                const h = (Math.abs(v) / cSpan) * 100;
                const topPct = v >= 0 ? cZeroPct - h : cZeroPct;
                const isSel = s.season === (side === "a" ? a.season : b.season);
                const fill = side === "a"
                  ? { backgroundColor: color }
                  : { backgroundColor: withAlpha(color, 0.25), border: `1px solid ${GOLD}` };
                return (
                  <div
                    className={`absolute box-border ${side === "a" ? "left-[8%] w-[38%]" : "right-[8%] w-[38%]"}`}
                    style={{ top: `${topPct}%`, height: `${Math.max(h, 1.5)}%`, ...fill, opacity: isSel ? 1 : 0.4 }}
                    title={`${s.season}: ${v.toFixed(1)}${activeKey ? ` ${CAT_SHORT[activeKey] || activeKey}` : ""} VA`}
                  />
                );
              };
              return (
                <div key={i} className="flex-1 relative min-w-0">
                  <div className="absolute inset-x-0 h-px bg-stone-200" style={{ top: `${cZeroPct}%` }} />
                  {bar(as, ca, "a")}
                  {bar(bs, cb, "b")}
                </div>
              );
            })}
          </div>
          <div className="flex gap-[2px] px-1 mt-0.5">
            {Array.from({ length: slots }, (_, i) => (
              <span key={i} className="flex-1 min-w-0 text-center text-[7px] tabular-nums text-stone-400">{i + 1}</span>
            ))}
          </div>
          <div className="text-center text-[8px] italic text-stone-400 mt-0.5">Seasons aligned by career year · compared seasons at full strength</div>
        </div>
      )}
    </div>
  );
}

// Gold Compare chip for the breakdown toggle rows: opens the picker, then
// shows the active comparison with a clear ✕.
function CompareButton({ compare, picking, onOpen, onClear }) {
  if (compare) {
    // Active chip wears the same LIGHT gold as the compared player's wrappers.
    return (
      <button
        onClick={onClear}
        className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border font-semibold inline-flex items-center gap-1 text-amber-900"
        style={{ backgroundColor: GOLD_BG, borderColor: withAlpha(GOLD, 0.5) }}
        aria-label="Clear comparison"
      >
        vs {shortName(compare.name)} {seasonTag(compare.row.season)} <span className="opacity-60">✕</span>
      </button>
    );
  }
  return (
    <button
      onClick={onOpen}
      className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border font-semibold ${picking ? "border-amber-500 bg-amber-100 text-amber-700" : "border-amber-500 bg-amber-400 text-stone-900 hover:bg-amber-300"}`}
      aria-pressed={picking}
    >
      Compare
    </button>
  );
}

// League context for one category of one player-season (By-Player search only).
// Everything is computed from the /api/players index passed in via `context`:
//   poolsBySeason  Map<season, row[]>  every player-season, grouped by season
//   allRows        row[]               every player-season, flat (all-time pool)
//   self           the player object   (name, slug, seasons[]) for identity/trend
// The ranking metric is per-game category VA so longevity doesn't dominate a
// per-game breakdown; the >=1/3-GP floor guards against tiny-sample outliers.
function CategoryContext({ p, catKey, lga, rateMode, context }) {
  const { poolsBySeason, allRows, self } = context;
  // Leaderboard rows don't carry a season field (the whole board is one
  // season) — the caller passes it on the context instead.
  const seasonKey = p.season || context.season;
  const selfRow = { ...p, name: self.name, slug: self.slug || null };
  // Pools follow the Explore scope selector; say so in the fine print.
  const scopeNoun = context.scope === "regular" ? "regular-season"
    : context.scope === "combined" ? "combined (RS+PO)" : "playoff";

  const d = useMemo(() => {
    // Every rank/percentile/trend in this card is TOTAL category VA (not
    // per-game), matching the leaderboard's own ordering — so a full season
    // outranks a half one at the same rate.
    // Season pool (views 1 & 2): qualified = played >= 1/3 of this player's GP.
    const floor = Math.max(1, Math.ceil((p.gp || 1) / 3));
    const pool = (poolsBySeason.get(seasonKey) || [])
      .filter((r) => (r.gp || 0) >= floor && r.mp > 0)
      .map((r) => ({ r, m: catVATotal(r, lga, catKey) }))
      .sort((a, b) => b.m - a.m);
    const N = pool.length;
    const selfIdx = pool.findIndex((x) => samePlayer(x.r, selfRow));
    const selfM = selfIdx >= 0 ? pool[selfIdx].m : catVATotal(selfRow, lga, catKey);
    // "Better than X% of the N qualified" — strictly-below count over the full
    // pool, so the top player reads ~99%, not a self-inclusive 100%.
    const below = pool.filter((x) => x.m < selfM).length;
    const pctile = N > 0 ? (below / N) * 100 : 0;
    const vals = pool.map((x) => x.m);
    const min = N ? vals[N - 1] : 0, max = N ? vals[0] : 0, med = N ? vals[Math.floor(N / 2)] : 0;
    let lo = Math.max(0, selfIdx - 2), hi = Math.min(N, lo + 5); lo = Math.max(0, hi - 5);
    const win = pool.slice(lo, hi).map((x, i) => ({ ...x, rank: lo + i + 1 }));

    // All-time (view 4): every player-season, season-accurate baselines.
    const floorA = Math.min(5, p.gp || 1);
    const all = allRows
      .filter((r) => (r.gp || 0) >= floorA && r.mp > 0)
      .map((r) => ({ r, m: catVATotal(r, lgaForSeason(r.season), catKey) }))
      .sort((a, b) => b.m - a.m);
    const allN = all.length;
    const allIdx = all.findIndex((x) => x.r.season === seasonKey && samePlayer(x.r, selfRow));
    const top = all.slice(0, 3).map((x, i) => ({ ...x, rank: i + 1 }));
    const selfAll = allIdx >= 0 ? { ...all[allIdx], rank: allIdx + 1 } : null;

    // Trend (view 6): this player's own seasons over time.
    const mine = [...(self.seasons || [])]
      .filter((s) => s.mp > 0)
      .map((s) => ({ season: s.season, m: catVATotal(s, lgaForSeason(s.season), catKey) }))
      .sort((a, b) => a.season.localeCompare(b.season));

    return { floor, N, rank: selfIdx + 1, selfM, pctile, min, max, med, win,
             floorA, allN, allRank: allIdx + 1, top, selfAll, mine };
  }, [seasonKey, p.gp, catKey, poolsBySeason, allRows, self, lga, selfRow]);

  const short = CAT_SHORT[catKey] || catKey;
  // Total VA is a whole-season figure, so one decimal (matches the leaderboard).
  const sgn = (v, dp = 1) => (v > 0 ? "+" : "") + v.toFixed(dp);
  const mpg = (r) => ((r.mp || 0) / (r.gp || 1)).toFixed(1);
  const posOf = (v) => (d.max > d.min ? ((v - d.min) / (d.max - d.min)) * 100 : 50);

  // Trend bars: one bar per season, diverging from a shared zero baseline.
  const ms = d.mine.map((x) => x.m);
  const tLo = Math.min(0, ...ms), tHi = Math.max(0, ...ms);
  const tSpan = (tHi - tLo) || 1;
  const zeroPct = (tHi / tSpan) * 100; // baseline's offset from the top
  const curIdx = d.mine.findIndex((x) => x.season === seasonKey);
  // "2000-01" -> ’01 (season's end year)
  const yearTag = (season) => `’${season.slice(5)}`;

  const Row = ({ rank, r, m, isSelf }) => (
    <div className={`grid grid-cols-[1.4rem_1fr_1.4rem_2rem_2.9rem_3.6rem] gap-x-1 items-center px-1 py-[2px] tabular-nums ${isSelf ? "bg-stone-800 text-white rounded-sm" : "text-stone-600"}`}>
      <span className="text-right text-[9px] opacity-70">{rank}</span>
      <span className="truncate text-[10px] font-medium">{r.name}</span>
      <span className="text-right text-[9px]">{r.gp}</span>
      <span className="text-right text-[9px]">{mpg(r)}</span>
      <span className={`text-right text-[10px] font-semibold ${!isSelf && m < 0 ? "text-red-600" : ""}`}>{sgn(m)}</span>
      <span className={`text-right text-[9px] ${isSelf ? "text-stone-200" : "text-stone-500"}`}>{catRateLabel(r, catKey, rateMode)}</span>
    </div>
  );

  return (
    <div className="my-1.5 px-2 py-2 bg-white border border-stone-200 rounded text-[10px] space-y-3">
      {/* View 1 — rank + mini leaderboard */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className="uppercase tracking-wider text-[9px] text-stone-400">{short} VA rank · {seasonKey}</span>
          <span className="text-stone-800 font-bold">#{d.rank}<span className="text-stone-400 font-normal"> of {d.N}</span></span>
        </div>
        <div className="grid grid-cols-[1.4rem_1fr_1.4rem_2rem_2.9rem_3.6rem] gap-x-1 px-1 pb-0.5 text-[8px] uppercase tracking-wider text-stone-400 border-b border-stone-100">
          <span className="text-right">#</span><span>Player</span><span className="text-right">G</span><span className="text-right">MPG</span><span className="text-right">VA</span><span className="text-right">{short}</span>
        </div>
        {d.win.map((x) => (
          <Row key={x.rank} rank={x.rank} r={x.r} m={x.m} isSelf={x.rank === d.rank} />
        ))}
        <div className="text-[8px] italic text-stone-400 mt-0.5 px-1">Ranked by total {short} VA among {scopeNoun} players with ≥{d.floor} G ({short} = {rateMode === "perG" ? "per-game" : "per-36"} rate).</div>
      </div>

      {/* View 2 — percentile + distribution strip. The percentile reads as a
          single number floating right above the player's dot on the strip. */}
      <div className="border-t border-stone-100 pt-2">
        <div className="uppercase tracking-wider text-[9px] text-stone-400 mb-5">Percentile</div>
        <div className="relative h-2 bg-gradient-to-r from-stone-200 via-stone-300 to-stone-400 rounded-full mx-1">
          <div className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-stone-500/60" style={{ left: `${posOf(d.med)}%` }} title="median" />
          <div className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-stone-900 ring-2 ring-white -translate-x-1/2 -translate-y-1/2" style={{ left: `${posOf(d.selfM)}%` }} />
          <span className="absolute -top-4 -translate-x-1/2 text-[11px] font-bold text-stone-800 tabular-nums leading-none" style={{ left: `${posOf(d.selfM)}%` }}>{d.pctile.toFixed(0)}</span>
        </div>
        {/* "med" sits under the median tick's actual position on the strip
            (clamped a little off the edges so it can't collide with low/high). */}
        <div className="relative h-3 text-[8px] text-stone-400 mt-0.5 px-1 tabular-nums">
          <span className="absolute left-1">low {sgn(d.min)}</span>
          <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${Math.min(82, Math.max(18, posOf(d.med)))}%` }}>med {sgn(d.med)}</span>
          <span className="absolute right-1">high {sgn(d.max)}</span>
        </div>
      </div>

      {/* View 4 — all-time rank */}
      <div className="border-t border-stone-100 pt-2">
        <div className="flex items-baseline justify-between mb-1">
          <span className="uppercase tracking-wider text-[9px] text-stone-400">All-time {short} VA</span>
          <span className="text-stone-800 font-bold">#{d.allRank}<span className="text-stone-400 font-normal"> of {d.allN}</span></span>
        </div>
        {d.top.map((x) => (
          <div key={"t" + x.rank} className={`grid grid-cols-[1.4rem_1fr_2.9rem] gap-x-1 items-center px-1 py-[2px] tabular-nums ${d.selfAll && x.rank === d.selfAll.rank ? "bg-stone-800 text-white rounded-sm" : "text-stone-600"}`}>
            <span className="text-right text-[9px] opacity-70">{x.rank}</span>
            <span className="truncate text-[10px]">{x.r.name} <span className="opacity-60">{x.r.season}</span></span>
            <span className="text-right text-[10px] font-semibold">{sgn(x.m)}</span>
          </div>
        ))}
        {d.selfAll && d.allRank > 3 && (
          <>
            <div className="text-center text-stone-300 leading-none">⋯</div>
            <div className="grid grid-cols-[1.4rem_1fr_2.9rem] gap-x-1 items-center px-1 py-[2px] tabular-nums bg-stone-800 text-white rounded-sm">
              <span className="text-right text-[9px] opacity-70">{d.selfAll.rank}</span>
              <span className="truncate text-[10px]">{d.selfAll.r.name} <span className="opacity-60">{d.selfAll.r.season}</span></span>
              <span className="text-right text-[10px] font-semibold">{sgn(d.selfAll.m)}</span>
            </div>
          </>
        )}
        <div className="text-[8px] italic text-stone-400 mt-0.5 px-1">Across all {d.allN} indexed {scopeNoun} seasons (≥{d.floorA} G).</div>
      </div>

      {/* View 6 — trend across this player's seasons, one labeled bar each */}
      <div className="border-t border-stone-100 pt-2">
        <div className="uppercase tracking-wider text-[9px] text-stone-400 mb-1">{short} VA by season</div>
        {d.mine.length === 0 ? (
          <div className="text-[9px] italic text-stone-400 px-1">No seasons on record.</div>
        ) : (
          <>
            <div className="flex items-stretch gap-[2px] h-20 px-1">
              {d.mine.map((x, i) => {
                const hPct = (Math.abs(x.m) / tSpan) * 100;
                const topPct = x.m >= 0 ? zeroPct - hPct : zeroPct;
                return (
                  <div key={x.season} className="flex-1 relative min-w-0" title={`${x.season}: ${sgn(x.m)}`}>
                    <div className="absolute inset-x-0 h-px bg-stone-200" style={{ top: `${zeroPct}%` }} />
                    <div
                      className="absolute inset-x-[12%]"
                      style={{ top: `${topPct}%`, height: `${Math.max(hPct, 1)}%`, backgroundColor: i === curIdx ? "#1c1917" : "#a8a29e" }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-[2px] px-1 mt-0.5">
              {d.mine.map((x, i) => (
                <span
                  key={x.season}
                  className={`flex-1 min-w-0 text-center text-[7px] tabular-nums leading-tight ${i === curIdx ? "text-stone-900 font-bold" : "text-stone-400"}`}
                >
                  {yearTag(x.season)}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function VACategoryBreakdown({ player: p, lga, context = null, baseline = null }) {
  const [rateMode, setRateMode] = useState("perG");
  const [openCat, setOpenCat] = useState(null);
  // "basic" folds the ten categories into Scoring/Passing/Rebounds/Defense.
  const [viewMode, setViewMode] = useState("detail");
  // Head-to-head comparison against another player-season from the same scope.
  const [compare, setCompare] = useState(null);
  const [picking, setPicking] = useState(false);
  const [compareMode, setCompareMode] = useState("values"); // "values" | "pct"
  // Baked defensive ratings (D-Rating category / VA+); college rows simply
  // never match and VA+ stays hidden there.
  const defs = useDefRatings();
  const switchView = (m) => { setViewMode(m); setOpenCat(null); };
  if (p.ast == null || !lga || !(p.mp > 0)) {
    return <div className="px-2 py-2 text-[10px] text-stone-400 italic">Per-stat breakdown needs the latest data — re-run the college bake.</div>;
  }
  const mp = p.mp, gp = p.gp || 1;
  const twoPm = p.fgm - p.tpm, twoPa = p.fga - p.tpa;
  const tpAdd = ((p.tpm / (p.tpa || 1)) - lga.la3P) * p.tpa;
  const twoAdd = ((twoPm / (twoPa || 1)) - lga.la2P) * twoPa;
  const ftAdd = ((p.ftm / (p.fta || 1)) - lga.laFT) * p.fta;
  const r36 = (v, tag) => `${((v / mp) * 36).toFixed(1)} ${tag}/36`;
  const rG = (v, tag) => `${(v / gp).toFixed(1)} ${tag}/G`;
  const shot = (m, att) => `${m}/${att} (${att > 0 ? ((m / att) * 100).toFixed(1) : "0.0"}%)`;
  const cnt = (v, tag) => (rateMode === "perG" ? rG(v, tag) : r36(v, tag));

  const cats = [
    { key: "Points", value: ((p.pts / mp) - lga.laPTSperM) * mp, label: cnt(p.pts, "PTS") },
    { key: "3-Pointers", value: 3 * tpAdd, label: shot(p.tpm, p.tpa) },
    { key: "2-Pointers", value: 2 * twoAdd, label: shot(twoPm, twoPa) },
    { key: "Free Throws", value: ftAdd, label: shot(p.ftm, p.fta) },
    { key: "Assists", value: ((p.ast / mp) - lga.laASTperM) * mp * lga.laPTSperMake * (1 - lga.laFG), label: cnt(p.ast, "AST") },
    { key: "Steals", value: ((p.stl / mp) - lga.laSTLperM) * mp * lga.laPTSperPoss, label: cnt(p.stl, "STL") },
    { key: "Blocks", value: ((p.blk / mp) - lga.laBLKperM) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.blk, "BLK") },
    { key: "Turnovers", value: -((p.tov / mp) - lga.laTOVperM) * mp * lga.laPTSperPoss, label: cnt(p.tov, "TOV") },
    { key: "D Rebounds", value: ((p.drb / mp) - lga.laDRBperM) * mp * lga.laPTSperPoss * lga.laORBrate, label: cnt(p.drb, "DRB") },
    { key: "O Rebounds", value: ((p.orb / mp) - lga.laORBperM) * mp * lga.laPTSperPoss * lga.laDRBrate, label: cnt(p.orb, "ORB") },
  ].sort((a, b) => VA_CATEGORY_ORDER.indexOf(a.key) - VA_CATEGORY_ORDER.indexOf(b.key));
  // "Basic" rows: group members summed, labeled with the group's
  // representative counting stat.
  const groupRows = VA_GROUPS.map((g) => {
    const [statOf, tag] = GROUP_STAT[g.key];
    return {
      key: g.key,
      value: g.cats.reduce((s, k) => s + (cats.find((c) => c.key === k)?.value || 0), 0),
      label: cnt(statOf(p), tag),
    };
  });
  // Fifth category: D Rating — the player's edge over his own team's
  // defense plus his stock-rate share of the team's edge vs league (see
  // defVAInfo) — and VA+ = VA + dVA. Regular-season rating; no drill-in
  // (one number, no per-game splits).
  const dInfo = defVAInfo(
    { ...p, slug: p.slug || context?.self?.slug },
    mp, lga, defs, p.season || context?.season, "rs"
  );
  const drtg = dInfo?.drtg ?? null;
  const dVA = dInfo?.dva ?? null;
  const vaPlus = dVA != null ? (p.va || 0) + dVA : null;
  if (dVA != null) {
    groupRows.push({ key: "D Rating", value: dVA, label: `${Math.round(drtg)} DRTG`, noDrill: true });
  }
  const activeRows = viewMode === "basic" ? groupRows : cats;
  const maxAbs = Math.max(...activeRows.map((c) => Math.abs(c.value)), 0.1);
  const signed = (v, d) => (v > 0 ? "+" : "") + v.toFixed(d);
  // Primary row for the compare panel — leaderboard rows carry no season/name
  // of their own; the context fills the gaps.
  const aRow = { ...p, season: p.season || context?.season, name: p.name || context?.self?.name, slug: p.slug || context?.self?.slug || null };

  return (
    <div className="px-2 py-2 bg-stone-50 border-t border-stone-100">
      {compare && context ? (
        // Comparison toggle row: the gold vs-chip left (where Basic/By
        // Category lives) and Values/Percentiles right (where Per 36/Per G
        // lives); the view/rate toggles hide while comparing.
        <div className="flex justify-between items-center gap-1 mb-1.5">
          <CompareButton
            compare={compare}
            picking={picking}
            onOpen={() => setPicking((v) => !v)}
            onClear={() => { setCompare(null); setPicking(false); }}
          />
          <div className="inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
            <button onClick={() => setCompareMode("values")} className={`px-1.5 py-0.5 ${compareMode === "values" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Values</button>
            <button onClick={() => setCompareMode("pct")} className={`px-1.5 py-0.5 border-l border-stone-300 ${compareMode === "pct" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Percentiles</button>
          </div>
        </div>
      ) : (
      <div className="flex justify-between items-center gap-1 mb-1.5">
        <div className="inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
          <button onClick={() => switchView("basic")} className={`px-1.5 py-0.5 ${viewMode === "basic" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Basic</button>
          <button onClick={() => switchView("detail")} className={`px-1.5 py-0.5 border-l border-stone-300 ${viewMode === "detail" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>By Category</button>
        </div>
        {context && (
          <CompareButton
            compare={compare}
            picking={picking}
            onOpen={() => setPicking((v) => !v)}
            onClear={() => { setCompare(null); setPicking(false); }}
          />
        )}
        <div className="inline-flex text-[9px] uppercase tracking-wider border border-stone-300 rounded-sm overflow-hidden">
          <button onClick={() => setRateMode("per36")} className={`px-1.5 py-0.5 ${rateMode === "per36" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Per 36</button>
          <button onClick={() => setRateMode("perG")} className={`px-1.5 py-0.5 border-l border-stone-300 ${rateMode === "perG" ? "bg-stone-700 text-white" : "bg-white text-stone-500"}`}>Per G</button>
        </div>
      </div>
      )}
      {picking && context && (
        <ComparePicker
          context={context}
          self={aRow}
          onPick={(sel) => { setCompare(sel); setPicking(false); }}
          onCancel={() => setPicking(false)}
        />
      )}
      {compare && context ? (
        <ComparePanel key={`${compare.row.season}:${compare.slug || compare.name}`} a={aRow} b={compare.row} bSeasons={compare.seasons} context={context} rateMode={rateMode} mode={compareMode} setMode={setCompareMode} />
      ) : (
      <>
      {vaPlus != null && (
        <div
          className="text-center text-[9px] mb-1"
          title={dInfo?.w != null
            ? `VA+ = VA + defensive net over possessions played: ${Math.round(drtg)} DRTG vs team ${dInfo.teamDrtg.toFixed(1)} + ${(dInfo.w * 100).toFixed(0)}% of team's edge vs league ${dInfo.laDRtg.toFixed(1)} (share = stock-rate × the 1-in-5 split)`
            : `VA+ = VA + defensive net rating (${Math.round(drtg)} DRTG vs ${(lga.laPTSperPoss * 100).toFixed(1)} league) over the possessions played`}
        >
          <span className="uppercase tracking-widest text-stone-400 mr-1.5">VA+</span>
          <span className={`tabular-nums font-bold ${vaPlus < 0 ? "text-red-600" : "text-stone-800"}`}>{vaPlus.toFixed(1)}</span>
          <span className={`tabular-nums ${dVA < 0 ? "text-red-500" : "text-stone-400"}`}> · D {(dVA > 0 ? "+" : "") + dVA.toFixed(1)}</span>
        </div>
      )}
      {activeRows.map((c) => {
        const pct = (Math.abs(c.value) / maxAbs) * 45;
        const isPos = c.value >= 0;
        const perG = c.value / gp;
        const catOpen = context && openCat === c.key;
        // Whole row is the tap target (same as the playoff breakdown), with
        // the selected row highlighted.
        const onCatTap = context && !c.noDrill ? () => setOpenCat(catOpen ? null : c.key) : undefined;
        return (
          <React.Fragment key={c.key}>
            <div
              className={`flex items-center gap-2 text-[10px] py-[1px] -mx-1 px-1 ${onCatTap ? "cursor-pointer" : ""} ${catOpen ? "bg-stone-200" : ""}`}
              onClick={onCatTap}
              role={onCatTap ? "button" : undefined}
              tabIndex={onCatTap ? 0 : undefined}
              onKeyDown={onCatTap ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCatTap(); } } : undefined}
              aria-pressed={onCatTap ? catOpen : undefined}
            >
              <span className={`w-[4.5rem] shrink-0 text-right ${catOpen ? "text-stone-900 font-semibold" : "text-stone-600"}`}>{c.key}</span>
              <div className="flex-1 relative h-4">
                <div className="absolute inset-y-0 left-1/2 w-px bg-stone-300" />
                <div className="absolute inset-y-0.5" style={{ backgroundColor: isPos ? "#1c1917" : "#a8a29e", left: isPos ? "50%" : `${50 - pct}%`, width: `${pct}%` }} />
              </div>
              <span className={`w-9 shrink-0 tabular-nums text-right font-semibold ${perG < 0 ? "text-red-600" : "text-stone-700"}`}>{signed(perG, 2)}</span>
              <span className="w-[5.5rem] shrink-0 text-[9px] text-stone-500 text-right tabular-nums">{c.label}</span>
            </div>
            {catOpen && <CategoryContext p={p} catKey={c.key} lga={lga} rateMode={rateMode} context={context} />}
            {viewMode === "detail" && VA_PARTITIONS_AFTER.has(c.key) && <div className="my-1 border-t border-stone-200" />}
          </React.Fragment>
        );
      })}
      <div className="mt-2 text-center text-[9px] italic text-stone-400">
        Bars show per-game contribution above / below the {baseline || (context ? "NBA playoff" : "D-I")} baseline{context ? " · tap a category for league context" : ""}
      </div>
      </>
      )}
    </div>
  );
}

function CollegeView() {
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

// Data-browser tab for the D-Rating / VA+ decomposition: every player-season
// laid out as DRTG · team DRTG · team-share w · the two net terms · dVA/G, so
// the composite is inspectable without tooltips (useless on touch). IND is
// the player's per-100 edge over his own team's defense; TM+ is his
// stock-rate share of the team's edge vs the league line; NET/G applies
// IND+TM+ over his possessions. Rows sort by dVA per game.
function DRatingView() {
  const defs = useDefRatings();
  const seasons = useMemo(() => Object.keys(defs || {}).sort().reverse(), [defs]);
  const [season, setSeason] = useState(null);
  const [scope, setScope] = useState("rs"); // "rs" | "po"
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState(null);
  const sel = season || seasons[0] || null;

  useEffect(() => {
    if (!sel) return;
    let cancelled = false;
    setRows(null);
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
    const minMp = scope === "po" ? 40 : 100;
    const out = [];
    for (const r of rows) {
      if (!(r.mp > 0)) continue;
      if (q ? !normalizeName(r.name || "").includes(q) : r.mp < minMp) continue;
      const info = defVAInfo(r, r.mp, lga, defs, sel, scope);
      if (!info) continue;
      const gp = r.gp ?? r.g ?? 0;
      out.push({
        r, gp, info,
        within: info.teamDrtg != null ? info.teamDrtg - info.drtg : null,
        tmShare: info.teamDrtg != null ? info.w * (info.laDRtg - info.teamDrtg) : null,
        perG: gp > 0 ? info.dva / gp : 0,
      });
    }
    out.sort((a, b) => b.perG - a.perG);
    return out;
  }, [rows, defs, sel, lga, query, scope]);

  const sgn1 = (v) => (v > 0 ? "+" : "") + v.toFixed(1);
  const cols = "grid grid-cols-[1.5rem_minmax(0,1fr)_2.2rem_2.2rem_2rem_2.3rem_2.3rem_2.6rem] gap-x-1 items-center";

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
          IND = player vs own team's D · TM+ = W% (stock-rate share of the 1-in-5 split) × team's edge vs league ·
          both per 100 poss · D/G = (IND+TM+) over possessions per game · LG = no single-team context (traded)
        </div>
      )}
      <div className={`${cols} text-[8px] uppercase tracking-wider text-stone-400 border-b border-stone-300 pb-0.5`}>
        <span>#</span><span>Player</span>
        <span className="text-right">DRTG</span><span className="text-right">Team</span>
        <span className="text-right">W</span><span className="text-right">IND</span>
        <span className="text-right">TM+</span><span className="text-right">D/G</span>
      </div>
      {!list && <div className="py-4 text-center text-stone-400 italic">Loading…</div>}
      {list && list.length === 0 && <div className="py-4 text-center text-stone-400 italic">No players match.</div>}
      {list && list.map(({ r, info, within, tmShare, perG }, i) => (
        <div key={(r.slug || r.name) + (r.team || "")} className={`${cols} py-[2px] border-b border-stone-100 last:border-0 ${i % 2 ? "bg-stone-50" : ""}`}>
          <span className="text-stone-400 tabular-nums">{i + 1}</span>
          <span className="truncate font-semibold" style={{ color: teamColor(r.team) }}>
            {r.name} <span className="text-stone-400 font-normal text-[8px]">{r.team}</span>
          </span>
          <span className="text-right tabular-nums text-stone-700">{Math.round(info.drtg)}</span>
          <span className="text-right tabular-nums text-stone-500">{info.teamDrtg != null ? info.teamDrtg.toFixed(1) : "–"}</span>
          <span className="text-right tabular-nums text-stone-500">{info.w != null ? `${Math.round(info.w * 100)}%` : "LG"}</span>
          <span className={`text-right tabular-nums ${within != null && within < 0 ? "text-red-600" : "text-stone-700"}`}>{within != null ? sgn1(within) : "–"}</span>
          <span className={`text-right tabular-nums ${tmShare != null && tmShare < 0 ? "text-red-600" : "text-stone-700"}`}>{tmShare != null ? sgn1(tmShare) : "–"}</span>
          <span className={`text-right tabular-nums font-semibold ${perG < 0 ? "text-red-600" : "text-stone-900"}`}>{(perG > 0 ? "+" : "") + perG.toFixed(2)}</span>
        </div>
      ))}
      {list && list.length > 0 && (
        <div className="mt-2 text-center text-[9px] italic text-stone-400">
          {query.trim() === "" ? `Min ${scope === "po" ? 40 : 100} minutes · search to include everyone · ` : ""}sorted by defensive VA per game
        </div>
      )}
    </div>
  );
}

export default function PlayoffTracker() {
  const [tab, setTab] = useState("explore");
  const seasons = Object.keys(HISTORY);

  return (
    <div className="min-h-screen bg-stone-100" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <header className="mb-4">
          <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mb-1">NBA Box Score</div>
          <h1 className="text-3xl font-black text-stone-900 leading-none tracking-tight" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>Value Added Tracker</h1>
        </header>

        <div className="flex border-b-2 border-stone-900 mb-5 overflow-x-auto">
          <button
            onClick={() => setTab("explore")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "explore" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            Explore
          </button>
          <button
            onClick={() => setTab("current")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "current" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            2025-26
          </button>
          {seasons.map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === s ? "bg-stone-900 text-white" : "text-stone-500"}`}
            >
              {s}
            </button>
          ))}
          <button
            onClick={() => setTab("college")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "college" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            College
          </button>
          <button
            onClick={() => setTab("drating")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "drating" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            D Rating
          </button>
          <button
            onClick={() => setTab("info")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${tab === "info" ? "bg-stone-900 text-white" : "text-stone-500"}`}
          >
            Info
          </button>
        </div>

        {tab === "current" ? <CurrentView /> : tab === "explore" ? <ExploreView /> : tab === "college" ? <CollegeView /> : tab === "drating" ? <DRatingView /> : tab === "info" ? <InfoView /> : <HistoryView season={tab} />}
      </div>
    </div>
  );
}
