"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { lgaForSeason, ZONES, zoneShotValue, hasZoneData, shootProfileVec } from "../scoring";
import { GOLD, GOLD_BG, compName, formatPercentile, normalizeName, seasonTag, shortName, teamColor, withAlpha } from "../lib/format";
import { CAT_COUNTING, CAT_SHOOTING, CAT_SHORT, GROUP_STAT, VA_CATEGORY_ORDER, VA_GROUPS, catRateLabel, catVATotal, catVAperGame, perGameVAVec } from "../lib/va";


// --- Compare (both breakdowns) ----------------------------------------------
// Group the context pools back into players for the Compare picker.
export function buildComparePlayers(allRows) {
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


// The four ways to rank/label closest comps. Order matches the toggle.
export const COMP_METRIC_OPTS = [
  { key: "imp", label: "Imp", word: "impact", title: "Impact — how close their overall per-game VA level is to this player's" },
  { key: "sim", label: "Sim", word: "similarity", title: "Similarity — cosine match of the two VA-by-category profiles" },
  { key: "impsim", label: "Imp×Sim", word: "imp×sim", title: "Impact × Similarity — the two combined into one closeness score" },
  { key: "shoot", label: "Shoot", word: "shooting profile", title: "Shoot — cosine × magnitude match of the two shooting profiles (4 shot-distance zones + 3-Pointers + Free Throws; needs zone data, 1996-97+)" },
];

export const COMP_METRIC_WORD = Object.fromEntries(COMP_METRIC_OPTS.map((o) => [o.key, o.word]));


// Inline picker: search a player from the scope index, then tap one of their
// seasons. onPick gets { name, slug, seasons, row }.
export function ComparePicker({ context, self = null, onPick, onCancel }) {
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

  // The expensive O(pool) similarity pass. Each surviving candidate carries
  // all four ranking values so the metric toggle can re-sort without
  // recomputing any dot products. Keyed only on [self, context], so toggling
  // is cheap. shootCos/shootMag/shootScore are the same cosine × magnitude
  // shape as cos/mag/score, just over the 6-dim shooting-profile vector (the
  // 4 shot-distance zones plus 3-Pointers and Free Throws — see
  // shootProfileVec) instead of the 10-dim box-category vector — null when
  // either side has no zone data (pre-1996-97, or a season the
  // shooting-splits bake hasn't reached).
  const selfShootVec = self ? shootProfileVec(self, lgaForSeason(self.season)) : null;
  const selfShootNorm = selfShootVec ? Math.hypot(...selfShootVec) : 0;
  const rawComps = useMemo(() => {
    if (!self || !(self.mp > 0)) return [];
    const qVec = perGameVAVec(self, lgaForSeason(self.season));
    const qNorm = Math.hypot(...qVec);
    if (!qNorm) return [];
    const selfSlug = self.slug || null;
    const selfNormName = normalizeName(self.name || "");
    const shootOk = selfShootVec && selfShootNorm > 0;
    // Only comp players in a similar minutes role: a 35-MPG star shouldn't
    // match a 15-20 MPG bench player even if their per-minute shape is close.
    const qMPG = self.mp / (self.gp || 1);
    const MPG_BAND = 7;
    // Shot diet: share of field-goal attempts taken from three (2PA:3PA in
    // bounded form — 0 for a player who never shoots threes). Two players can
    // post identical 3P *impact* (both ~0 vs league) while taking wildly
    // different shares of their shots from deep — a high-volume league-average
    // bomber vs someone who lives at the rim. Their matching zero 3P-VA makes
    // them look like shooting twins, so gate Shoot comps on a similar 3PA
    // rate, the same way MPG_BAND gates the whole pool on minutes role.
    const q3Rate = self.fga > 0 ? self.tpa / self.fga : 0;
    const THREE_RATE_BAND = 0.15;
    const byDecade = new Map(); // decade -> [{r, cos, mag, score, shootCos, shootMag, shootScore}]
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
      let shootCos = null, shootMag = null, shootScore = null;
      const r3Rate = r.fga > 0 ? r.tpa / r.fga : 0;
      if (shootOk && Math.abs(r3Rate - q3Rate) <= THREE_RATE_BAND) {
        const zv = shootProfileVec(r, lgaForSeason(r.season));
        const zn = zv ? Math.hypot(...zv) : 0;
        if (zn > 0) {
          let zdot = 0;
          for (let i = 0; i < selfShootVec.length; i++) zdot += selfShootVec[i] * zv[i];
          const zc = zdot / (selfShootNorm * zn);
          if (zc >= 0.3) { // same "clearly different archetype" floor, on the shooting profile
            shootCos = zc;
            shootMag = Math.min(selfShootNorm, zn) / Math.max(selfShootNorm, zn);
            shootScore = shootCos * shootMag;
          }
        }
      }
      const dec = Math.floor(parseInt(r.season.slice(0, 4), 10) / 10) * 10;
      let arr = byDecade.get(dec);
      if (!arr) byDecade.set(dec, (arr = []));
      arr.push({ r, cos, mag, score: cos * mag, shootCos, shootMag, shootScore });
    }
    return [...byDecade.entries()].sort((x, y) => y[0] - x[0]); // most recent decade first
  }, [self, context, selfShootVec, selfShootNorm]);

  // Value of the currently selected metric for a candidate.
  const metricVal = (o) => (
    compMetric === "imp" ? o.mag
    : compMetric === "impsim" ? o.score
    : compMetric === "shoot" ? (o.shootScore ?? -Infinity)
    : o.cos
  );

  // Re-rank each decade by the selected metric (no dot products — just a
  // sort). "Shoot" additionally drops candidates with no zone-VA overlap
  // rather than showing them at the bottom with a meaningless score.
  const comps = useMemo(() => {
    return rawComps.map(([dec, arr]) => ({
      dec,
      list: [...arr]
        .filter((o) => compMetric !== "shoot" || o.shootScore != null)
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
                  {COMP_METRIC_OPTS.map((o) => {
                    // "Shoot" needs self to have zone-shot data for its
                    // season (1996-97+, and the shooting-splits bake has to
                    // have reached it) — hide the option rather than show a
                    // toggle that can never produce a match.
                    const disabled = o.key === "shoot" && !(selfShootNorm > 0);
                    return (
                      <button
                        key={o.key}
                        onClick={() => !disabled && setCompMetric(o.key)}
                        disabled={disabled}
                        title={disabled ? "No shot-distance data for this player-season" : o.title}
                        className={`px-1.5 py-0.5 text-[8px] uppercase tracking-wider ${disabled ? "bg-stone-50 text-stone-300 cursor-not-allowed" : compMetric === o.key ? "bg-amber-400 text-amber-950 font-semibold" : "bg-white text-stone-400 hover:bg-amber-50"}`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {comps.map(({ dec, list }) => (
                <div key={dec} className="flex items-center gap-1.5 py-0.5 border-b border-stone-100 last:border-0">
                  <span className="shrink-0 w-7 text-[8px] uppercase tracking-wider text-stone-400 tabular-nums">’{String(dec).slice(2)}s</span>
                  <div className="flex gap-1 overflow-x-auto no-scrollbar min-w-0 pb-0.5">
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
export function compareStatRows(a, b, key, lgaA, lgaB) {
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
    // Shot-distance zone breakdown, under the 2-Pointers card only: per-game
    // made/att (FG%) plus that zone's points of value PER GAME vs. its own
    // season's league zone FG% — matches the M/A row above (already
    // per-game) and every other VA figure in this panel, so a longer
    // sample size never inflates a zone's apparent value.
    if (key === "2-Pointers" && hasZoneData(a) && hasZoneData(b) && lgaA?.zoneFG && lgaB?.zoneFG) {
      const sgn1 = (v) => (v > 0 ? "+" : "") + v.toFixed(1);
      const zoneDisp = (m, att, val) => (
        <>
          {`${m.toFixed(1)}/${att.toFixed(1)} (${att > 0 ? ((m / att) * 100).toFixed(1) : "0.0"}%)`}{" "}
          <span className={val >= 0 ? "text-emerald-600" : "text-red-600"}>{sgn1(val)}</span>
        </>
      );
      for (const z of ZONES) {
        const azm = a[z.mKey] || 0, aza = a[z.aKey] || 0;
        const bzm = b[z.mKey] || 0, bza = b[z.aKey] || 0;
        // Winner is decided by per-game value added vs league, not raw FG% —
        // a higher zone FG% on lower volume can still add less value.
        const aVal = zoneShotValue(azm, aza, lgaA.zoneFG[z.key]) / agp;
        const bVal = zoneShotValue(bzm, bza, lgaB.zoneFG[z.key]) / bgp;
        push(z.label, zoneDisp(azm / agp, aza / agp, aVal), zoneDisp(bzm / bgp, bza / bgp, bVal), aVal, bVal);
      }
    }
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


export function ComparePanel({ a, b, bSeasons, context, rateMode, mode, setMode }) {
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
  // Confirmation step for the compared-player chip: the first tap arms a
  // "Go →" button in the chip's place; only that button navigates. A
  // pointer-down anywhere outside it disarms. The listener attaches in an
  // effect (after the arming tap has already fired) and uses the capture
  // phase, so the very tap that armed it never immediately disarms it.
  const [armed, setArmed] = useState(false);
  const goRef = useRef(null);
  // When the chip was armed. On touch devices the single tap that arms the
  // button can synthesize a second, delayed "ghost" click at the same screen
  // position — which now belongs to "Go →" — and would jump immediately. The
  // confirm ignores any click within this cooldown of arming, so only a
  // deliberate second tap (later than the window) navigates.
  const armedAtRef = useRef(0);
  const GO_COOLDOWN_MS = 350;
  const arm = () => { armedAtRef.current = Date.now(); setArmed(true); };
  const confirmGo = () => {
    if (Date.now() - armedAtRef.current < GO_COOLDOWN_MS) return; // echo of the arming tap
    setArmed(false);
    context?.onNavigateToPlayer?.({ season: b.season, team: b.team, name: b.name, slug: b.slug || null });
  };
  useEffect(() => {
    if (!armed) return;
    const onDown = (e) => {
      if (!goRef.current || !goRef.current.contains(e.target)) setArmed(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [armed]);
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
        {/* The compared player's chip links to that player's own card: in By
            Season it opens the Leaderboard for their season filtered to their
            team; in By Player it opens their default career view. Tapping the
            chip first arms a "Go →" confirmation in its place (see `armed`);
            only "Go →" navigates. The parent supplies onNavigateToPlayer via
            context (present whenever comparing); without it the chip stays a
            plain label. */}
        {context?.onNavigateToPlayer ? (
          armed ? (
            <button
              ref={goRef}
              type="button"
              onClick={confirmGo}
              className="shrink-0 font-semibold rounded-sm px-2 py-[1px] whitespace-nowrap inline-flex items-center gap-1 hover:brightness-95 touch-manipulation"
              style={{ backgroundColor: GOLD, color: "#1c1917", border: `1px solid ${GOLD}` }}
              title={`Open ${b.name} ${seasonTag(b.season)}`}
            >
              Go <span aria-hidden>→</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={arm}
              className="font-semibold truncate text-right rounded-sm px-1 py-[1px] hover:brightness-95 cursor-pointer touch-manipulation"
              style={{ color: cb, backgroundColor: GOLD_BG, border: `1px solid ${withAlpha(GOLD, 0.5)}` }}
              title={`Open ${b.name} ${seasonTag(b.season)}`}
            >
              {b.name} {seasonTag(b.season)}<Swatch color={cb} outline />
            </button>
          )
        ) : (
          <span className="font-semibold truncate text-right rounded-sm px-1 py-[1px]" style={{ color: cb, backgroundColor: GOLD_BG, border: `1px solid ${withAlpha(GOLD, 0.5)}` }}>{b.name} {seasonTag(b.season)}<Swatch color={cb} outline /></span>
        )}
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
                const rows = compareStatRows(a, b, key, lgaA, lgaB);
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
export function CompareButton({ compare, picking, onOpen, onClear }) {
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
