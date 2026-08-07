"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { lgaForSeason, ZONES, zoneShotValue, hasZoneData, shootProfileVec } from "../scoring";
import { defVAInfo } from "../lib/defense";
import { GOLD, GOLD_BG, compName, formatPercentile, normalizeName, seasonTag, shortName, teamColor, withAlpha } from "../lib/format";
import { useGatedGo } from "../lib/gated-go";
import { aggregateSeasons, lgaForRow, matchCareerYears, rowSeasonLabel, similarRuns } from "../lib/multi-season";
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


// Rebuild a compare selection ({ name, slug, seasons, row }) from a bare
// { season, name, slug } target — the shape a navigation carries across the
// page. Used when a jump asks for the comparison to survive the landing: the
// card that mounts on the other side resolves the target against its own
// context pool and opens already comparing. Returns null when the scope's
// index doesn't carry that player-season (a different scope, an unbaked year),
// so the landing is just an ordinary card rather than a broken comparison.
export function resolveCompareTarget(context, target) {
  if (!context?.allRows || !target || !target.season) return null;
  const nm = normalizeName(target.name || "");
  const seasons = context.allRows.filter((r) =>
    target.slug ? r.slug === target.slug : (nm && normalizeName(r.name) === nm)
  );
  const row = seasons.find((r) => r.season === target.season);
  if (!row) return null;
  return {
    name: row.name || target.name,
    slug: row.slug || target.slug || null,
    seasons: [...seasons].sort((x, y) => y.season.localeCompare(x.season)),
    row,
  };
}


// The two ways to rank/label closest comps. Order matches the toggle.
export const COMP_METRIC_OPTS = [
  { key: "impsim", label: "Box Score VA", word: "box score VA", title: "Box Score VA — impact (how close their overall per-game VA level is) × similarity (cosine match of the two VA-by-category profiles), combined into one closeness score" },
  { key: "shoot", label: "Shooting", word: "shooting profile", title: "Shooting — cosine × magnitude match of the two shooting profiles (4 shot-distance zones + 3-Pointers + Free Throws; needs zone data, 1996-97+)" },
];

export const COMP_METRIC_WORD = Object.fromEntries(COMP_METRIC_OPTS.map((o) => [o.key, o.word]));


// Team-color alpha inside the comparison side's bars in the career-year chart.
// Deliberately heavier than the 0.25 the category rows use: those bars are ~7px
// tall against a paired solid bar right beside them, where a faint tint still
// reads, while a career bar stands alone at full height and needs to hold its
// own color. See the fill in the chart below.
export const CAREER_B_FILL = 0.6;


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
  //   impsim — "Box Score VA": cosine similarity (archetype match) × magnitude
  //            similarity (how close the overall VA level is)
  //   shoot  — "Shooting": the same product over the shooting-profile vector
  const [compMetric, setCompMetric] = useState("impsim");

  // The expensive O(pool) similarity pass. Each surviving candidate carries
  // both ranking values so the metric toggle can re-sort without
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
    compMetric === "shoot" ? (o.shootScore ?? -Infinity) : o.score
  );

  // Re-rank each decade by the selected metric (no dot products — just a
  // sort). "Shooting" additionally drops candidates with no zone-VA overlap
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
                    // "Shooting" needs self to have zone-shot data for its
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


// Identity of a suggested run. similarRuns keeps one run per player, so the
// player alone would do; the first season is in there so the key still moves
// if the selection's length changes the window under the same name.
const runKey = (run) => `${run.player.slug || run.player.name}:${run.seasons[0].season}`;


// The multi-season half of the Compare picker: search a player from the same
// scope index, then tick as many of their seasons as you want with the same
// ⬜/◼ boxes the By Player table uses. Confirming hands back an aggregate row
// built by aggregateSeasons, which the panel then treats as one line.
//
// Deliberately a separate component from ComparePicker rather than a mode
// inside it: the single-season picker's closest comps rank one season against
// a pool of seasons, which is not the question a three-year run asks. So this
// one opens on its own suggestions — the closest N-season RUNS in the pool,
// N being however many seasons the selection pools (see similarRuns) — and
// once a player is chosen by hand, pre-ticks his best N seasons, which is
// what "compare this run against him" usually means.
export function MultiComparePicker({ context, self = null, selfRow = null, onPick, onCancel, suggestCount = 3, selfYears = null, selfCareerLen = 0, selfSeasons = null, unasked = false }) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(null);       // the chosen player
  const [picked, setPicked] = useState(null); // Set of season strings
  // How the other player's seasons are pre-ticked. One switch, cycling:
  //   best — his highest-VA seasons, the same number as the selection
  //   year — the same CAREER years the selection occupies (matchCareerYears)
  //   same — the same CALENDAR seasons, whatever career year those fell in
  const [matchMode, setMatchMode] = useState("best");
  const canMatchYear = !!selfYears?.length && selfCareerLen > 0;
  const players = useMemo(() => buildComparePlayers(context.allRows), [context]);
  const selfKey = self ? (self.slug || normalizeName(self.name || "")) : null;

  // The suggestions this picker opens on: the closest runs of the same length
  // as the selection, best match first within each decade (see similarRuns).
  // Tapping one goes straight to the comparison with those exact seasons
  // pooled — the same one-tap shortcut the season picker's comps give.
  const RUNS_PER_DECADE = 8;
  const runLen = Math.max(1, suggestCount);
  const runComps = useMemo(
    () => similarRuns(players, selfRow, { runLen, selfKey, perDecade: RUNS_PER_DECADE }),
    [players, selfRow, runLen, selfKey]
  );
  // Gold-lit across every decade row, so the single strongest run stands out
  // wherever it landed.
  const bestRunKey = useMemo(() => {
    let key = null, best = -Infinity;
    for (const { list } of runComps) {
      for (const run of list) {
        if (run.score > best) { best = run.score; key = runKey(run); }
      }
    }
    return key;
  }, [runComps]);
  const pickRun = (run) => {
    const pl = run.player;
    onPick({
      name: pl.name,
      slug: pl.slug || null,
      seasons: pl.seasons,
      row: aggregateSeasons(run.seasons, { name: pl.name, slug: pl.slug || null }),
    });
  };

  const matches = useMemo(() => {
    const q = normalizeName(query.trim());
    if (q.length < 2) return [];
    return players
      .filter((pl) => normalizeName(pl.name).includes(q))
      // Comparing a run against the same player's own run would just be the
      // selection twice; the By Player table is where you change it.
      .filter((pl) => !selfKey || (pl.slug || normalizeName(pl.name)) !== selfKey)
      .sort((a, b) => b.bestVa - a.bestVa)
      .slice(0, 12);
  }, [players, query, selfKey]);

  // SAME SEASON: the calendar seasons the selection covers that this player
  // also played. Deliberately an INTERSECTION and not a same-length match —
  // the two ran alongside each other or they didn't, and a year one of them
  // missed is a fact about the comparison rather than a gap to paper over.
  // So the selection keeps every season it had and this side carries what it
  // has: SGA's 2024-25 + 2025-26 against a Haliburton who missed 2025-26 is
  // two seasons against one, stated plainly in the note below.
  const sameSeasonsFor = (pl) => {
    const have = new Set(pl.seasons.map((s) => s.season));
    return (selfSeasons || []).filter((s) => have.has(s)).sort();
  };
  // With NO overlap at all there is nothing for the mode to mean, so it drops
  // out of the cycle rather than resolving to an empty pick — pick only SGA's
  // 2025-26 against that same Haliburton and the option isn't offered.
  const modeOk = (pl, m) => (
    m === "best" ? true
    : m === "year" ? canMatchYear
    : !!pl && sameSeasonsFor(pl).length > 0
  );

  // The seasons a player opens with, under whichever mode is active. BEST and
  // CAREER YEAR return the selection's own COUNT wherever the career allows,
  // so the two runs start out like-for-like; SAME SEASON returns the overlap,
  // which is the honest answer even when it's shorter.
  const suggestFor = (pl, mode) => {
    if (mode === "same") return sameSeasonsFor(pl);
    if (mode === "year" && canMatchYear) {
      const asc = [...pl.seasons].sort((x, y) => x.season.localeCompare(y.season));
      return matchCareerYears(selfYears, selfCareerLen, asc.length).map((i) => asc[i - 1].season);
    }
    return [...pl.seasons]
      .sort((x, y) => (y.va || 0) - (x.va || 0))
      .slice(0, Math.max(1, suggestCount))
      .map((s) => s.season);
  };
  const choosePlayer = (pl) => {
    // A mode the incoming player can't support falls back rather than
    // carrying over as an empty selection — switching from someone who
    // overlapped the run to someone who never did shouldn't tick nothing.
    const m = modeOk(pl, matchMode) ? matchMode : "best";
    setMatchMode(m);
    setSel(pl);
    setPicked(new Set(suggestFor(pl, m)));
  };
  // Flipping the switch re-picks from scratch. It's a "choose them for me"
  // control, so it has to be able to undo hand-ticking — otherwise tapping it
  // after a manual edit would produce some hybrid of the two. Modes this
  // player can't support are skipped, so the cycle only ever lands somewhere
  // that means something.
  const MATCH_ORDER = ["best", "year", "same"];
  const MATCH_LABEL = { best: "Best", year: "Career Year", same: "Same Season" };
  const switchMatch = () => {
    let i = MATCH_ORDER.indexOf(matchMode);
    for (let n = 0; n < MATCH_ORDER.length; n++) {
      i = (i + 1) % MATCH_ORDER.length;
      if (modeOk(sel, MATCH_ORDER[i])) break;
    }
    const next = MATCH_ORDER[i];
    setMatchMode(next);
    if (sel) setPicked(new Set(suggestFor(sel, next)));
  };
  const toggle = (season) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(season)) next.delete(season); else next.add(season);
      return next;
    });
  };

  const chosen = sel && picked ? sel.seasons.filter((s) => picked.has(s.season)) : [];

  // What the active mode resolved to, said plainly. The cases that earn a note
  // are the ones where the switch could NOT deliver what its label promises —
  // a run reaching past the end of a shorter career, or a season the other
  // player missed — because the panel that follows would otherwise read as a
  // clean match when it quietly isn't.
  const matchNote = useMemo(() => {
    if (!sel) return "";
    const plural = (n) => (n === 1 ? "" : "s");
    if (matchMode === "same") {
      const got = sameSeasonsFor(sel);
      const missing = (selfSeasons || []).filter((s) => !got.includes(s)).sort();
      if (!missing.length) return `Same season${plural(got.length)} — ${got.join(", ")}`;
      return `${got.join(", ")} — ${shortName(sel.name)} has no ${missing.join(", ")} season${plural(missing.length)}, so this is ${got.length} season${plural(got.length)} against your ${(selfSeasons || []).length}`;
    }
    if (matchMode !== "year" || !canMatchYear) return "";
    const len = sel.seasons.length;
    const got = matchCareerYears(selfYears, selfCareerLen, len);
    const want = [...selfYears].sort((a, b) => a - b);
    const list = (a) => (
      a.length === 0 ? "–"
      : a.length === 1 ? `${a[0]}`
      : a.every((v, i) => i === 0 || v === a[i - 1] + 1) ? `${a[0]}–${a[a.length - 1]}`
      : a.join(", ")
    );
    if (got.length === want.length && got.every((v, i) => v === want[i])) {
      return `Career year${plural(want.length)} ${list(want)} — the same the selection covers`;
    }
    return `Selection is career year${plural(want.length)} ${list(want)}; ${shortName(sel.name)} played ${len} season${plural(len)}, so this is his year${plural(got.length)} ${list(got)}`;
  }, [matchMode, canMatchYear, sel, selfYears, selfCareerLen, selfSeasons]);

  const confirm = () => {
    if (!chosen.length) return;
    onPick({
      name: sel.name,
      slug: sel.slug || null,
      seasons: sel.seasons,
      row: aggregateSeasons(chosen, { name: sel.name, slug: sel.slug || null }),
    });
  };

  const panelRef = useRef(null);
  // Coming to the panel is for the case where it turned up UNASKED — ticking
  // a second season brings it out on its own, and off screen it would arrive
  // unnoticed. Asked for by name (the # tap), the page stays where it is:
  // that header sits at the top of the table, so on a long career the panel
  // is off screen by definition at the moment you tap it, and "scroll when
  // off screen" would read as "always throw me to the bottom" — losing the
  // reader's place in the very table they were working through.
  //
  // Even unasked it only moves when it has to: already in view — a short
  // career, or a reader down near the foot of a long one — and the scroll
  // position is theirs to keep. `nearest` then travels the shortest distance
  // that puts the panel on screen instead of hauling it to the top.
  useEffect(() => {
    const el = panelRef.current;
    if (!unasked || !el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    // Taller than the viewport counts as on screen once its top is: there is
    // no scroll position that shows all of it, and the top is where it reads.
    if (r.top >= 0 && (r.bottom <= vh || r.height >= vh)) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [unasked]);
  // The mobile keyboard covers the lower half of the viewport, which would
  // bury the results below the search box, so tapping the field DOES pin the
  // panel to the top — an explicit tap, unlike the panel's own arrival.
  // Deferred so the scroll runs after the keyboard has begun opening.
  const onSearchFocus = () => {
    setTimeout(() => panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 300);
  };

  return (
    <div ref={panelRef} className="my-1.5 px-2 py-2 bg-white border border-amber-400 rounded text-[10px] scroll-mt-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="uppercase tracking-wider text-[9px] text-stone-500">
          {sel ? `Pick ${sel.name}’s seasons…` : "Compare this run against…"}
        </span>
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
            // No autoFocus, deliberately: the panel arrives on its own, and
            // focusing the field would scroll the page to it and open the
            // keyboard over the very suggestions it leads with.
            className="w-full text-xs text-stone-900 bg-white border border-stone-300 px-2 py-1 mb-1"
          />
          {query.trim().length < 2 ? (
            <>
              {runComps.length > 0 && (
                <div className="mb-1">
                  <div className="uppercase tracking-wider text-[8px] text-stone-400 mt-1 mb-0.5">
                    {runLen === 1 ? "Closest seasons" : `Closest ${runLen}-year runs`} · by decade
                  </div>
                  {runComps.map(({ dec, list }) => (
                    <div key={dec} className="flex items-center gap-1.5 py-0.5 border-b border-stone-100 last:border-0">
                      <span className="shrink-0 w-7 text-[8px] uppercase tracking-wider text-stone-400 tabular-nums">’{String(dec).slice(2)}s</span>
                      <div className="flex gap-1 overflow-x-auto no-scrollbar min-w-0 pb-0.5">
                        {list.map((run) => {
                          const pct = Math.min(99, Math.round(run.score * 100));
                          const isBest = runKey(run) === bestRunKey;
                          return (
                            <button
                              key={runKey(run)}
                              onClick={() => pickRun(run)}
                              className={`shrink-0 px-1.5 py-0.5 border rounded-sm hover:border-amber-500 hover:bg-amber-50 whitespace-nowrap ${isBest ? "border-amber-500" : "border-stone-200"}`}
                              style={isBest ? { backgroundColor: GOLD_BG, borderColor: GOLD } : undefined}
                              title={[
                                `${run.player.name} ${run.span}`, run.team,
                                `${run.gp} G`, `${run.va.toFixed(1)} VA`,
                                `${pct}% ${COMP_METRIC_WORD.impsim}`,
                                isBest ? "best match" : null,
                              ].filter(Boolean).join(" · ")}
                            >
                              <span className="font-semibold" style={{ color: teamColor(run.team) }}>{compName(run.player.name)}</span>
                              <span className="text-stone-400"> {run.span}</span>
                              <span className="text-stone-500 tabular-nums text-[9px]"> {pct}%</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[9px] text-stone-400 italic py-2 text-center">
                {runComps.length > 0
                  ? "Or type a name, then tick the seasons of theirs to pool."
                  : "Type a name, then tick the seasons of theirs to pool."}
              </div>
            </>
          ) : matches.length === 0 ? (
            <div className="text-[9px] text-stone-400 italic py-2 text-center">No players match “{query.trim()}”.</div>
          ) : (
            matches.map((pl) => (
              <button
                key={pl.slug || pl.name}
                onClick={() => choosePlayer(pl)}
                className="w-full flex items-baseline justify-between gap-2 px-1 py-1 border-b border-stone-100 last:border-0 text-left hover:bg-stone-50"
              >
                <span className="font-semibold text-stone-800">{pl.name}</span>
                <span className="text-[9px] text-stone-400">{pl.seasons.length} seasons · best <span className="tabular-nums text-stone-600">{pl.bestVa.toFixed(1)}</span></span>
              </button>
            ))
          )}
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between mb-1">
            <span className="font-semibold text-stone-800">{sel.name}</span>
            <button onClick={() => { setSel(null); setPicked(null); }} className="text-[9px] text-stone-400 hover:text-stone-700">‹ change player</button>
          </div>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {[...sel.seasons].sort((x, y) => y.season.localeCompare(x.season)).map((s) => {
              const on = picked.has(s.season);
              const tc = teamColor(s.team);
              return (
                <button
                  key={s.season}
                  onClick={() => toggle(s.season)}
                  role="checkbox"
                  aria-checked={on}
                  className="px-1.5 py-0.5 border tabular-nums inline-flex items-center gap-1 hover:border-amber-500"
                  style={on
                    ? { backgroundColor: GOLD_BG, borderColor: GOLD, color: tc }
                    : { backgroundColor: "#fff", borderColor: "#d6d3d1", color: "#a8a29e" }}
                >
                  <span aria-hidden className="text-[9px] leading-none">{on ? "◼" : "⬜"}</span>
                  {seasonTag(s.season)} {s.team} <span className={on ? "text-stone-500" : "text-stone-300"}>{(s.vaPerG ?? 0).toFixed(1)}/G</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-1.5 border-t border-stone-100 pt-1.5">
            <span className="text-[9px] text-stone-500 tabular-nums min-w-0 truncate">
              {chosen.length === 0
                ? "Pick at least one season"
                : <>{chosen.length} season{chosen.length === 1 ? "" : "s"} · {chosen.reduce((n, s) => n + (s.gp || 0), 0)} G · <span className="font-semibold">{chosen.reduce((n, s) => n + (s.va || 0), 0).toFixed(1)}</span> VA</>}
            </span>
            {(modeOk(sel, "year") || modeOk(sel, "same")) && (
              // Wears the /G switch's shape — same size, same weighting — since
              // it does the same kind of job: one tap, another reading of the
              // same panel. BEST is the default and sits light; the two
              // matched modes are doing something specific and sit dark.
              <button
                type="button"
                onClick={switchMatch}
                aria-pressed={matchMode !== "best"}
                aria-label={`Season matching: ${MATCH_LABEL[matchMode]} — tap to change`}
                title={matchNote
                  ? `${MATCH_LABEL[matchMode]} — ${matchNote}. Tap to change.`
                  : "Showing his best seasons by VA — tap to match the selection’s career years, or the same calendar seasons"}
                className={`shrink-0 whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-sm border transition-colors ${matchMode !== "best" ? "bg-stone-800 text-stone-100 border-stone-800" : "bg-white text-stone-500 border-stone-300 hover:text-stone-700"}`}
              >
                {MATCH_LABEL[matchMode]}
              </button>
            )}
            <button
              onClick={confirm}
              disabled={!chosen.length}
              className={`shrink-0 text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-sm border ${chosen.length ? "border-amber-500 bg-amber-400 text-stone-900 hover:bg-amber-300" : "border-stone-200 bg-stone-50 text-stone-300 cursor-not-allowed"}`}
            >
              Compare →
            </button>
          </div>
          {matchNote && (
            <div className="mt-1 text-center text-[8px] italic text-stone-400">
              {matchNote}
            </div>
          )}
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


export function ComparePanel({ a, b, bSeasons, context, rateMode, mode, setMode, defs = null, defActive = false, defScope = "rs", aSeasons: aSeasonsProp = null }) {
  // Either side may be a multi-season AGGREGATE (lib/multi-season.js) rather
  // than a single player-season: the same rows, the same categories, but one
  // synthetic line measured against one volume-weighted baseline. Almost
  // everything below is indifferent to which it is — the aggregate is shaped
  // like a season row — so the flag only gates the handful of places where a
  // multi-season line genuinely can't mean the same thing: season TOTALS
  // (a 203-game total can't rank against 82-game seasons), and the
  // navigations, which have no way to carry a selection across the page.
  const aMulti = !!a.multi, bMulti = !!b.multi;
  const isMulti = aMulti || bMulti;
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
  // Per-game vs. season-total value added — the same /G ON·OFF switch the
  // individual view's category card carries, and it governs this panel the
  // same way: ON (the default) reads every bar, number, percentile and career
  // bar as per-game VA; OFF re-reads the whole comparison on season totals, so
  // a full season stops being measured against a half one at the same rate.
  // Locked ON while either side is a multi-season aggregate: the percentile
  // pool is single player-seasons, and a three-season total has no meaningful
  // rank against them. Per-game VA is scale-free, so it does.
  const [perGameRaw, setPerGame] = useState(true);
  const perGame = isMulti ? true : perGameRaw;
  // Confirmation step for the compared-player chip: the first tap arms a
  // "Go →" button in the chip's place; only that button navigates, and a tap
  // anywhere else disarms without doing whatever it landed on. The mechanics
  // (capture-phase disarm, touch ghost-click cooldown) live in useGatedGo,
  // shared with the by-season trend bars in the category card.
  const go = useGatedGo();
  const armed = go.isArmed();
  const arm = () => go.arm();
  const confirmGo = () => go.confirm(() =>
    context?.onNavigateToPlayer?.({ season: b.season, team: b.team, name: b.name, slug: b.slug || null })
  );
  // The chip travels to ONE player-season. A multi-season B has no single
  // season to land on, so it stays a plain label rather than a jump that
  // silently picks one.
  const chipNavigates = !!context?.onNavigateToPlayer && !bMulti;
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
  // An aggregate carries its own volume-weighted baseline; a season row looks
  // its season up. Everything downstream reads these two and stays unaware of
  // which kind it got.
  const lgaA = lgaForRow(a);
  const lgaB = lgaForRow(b);
  const ca = teamColor(a.team);
  const cb = teamColor(b.team);
  // The comparison side is "wrapped in gold" (the Compare-chip amber) with a
  // light team-color fill inside — see GOLD/GOLD_BG.
  const cbFill = withAlpha(cb, 0.25);
  const cbEdge = `1px solid ${GOLD}`;

  // D Rating — the fifth defensive stat, the one VA+ adds to VA. Whenever the
  // page is reading VA+ (defActive), the comparison carries it too: it rides at
  // the end of the Defense group as its own row, and Defense itself sums to the
  // VA+ defensive total rather than the two box-score stocks alone — so the
  // four groups still add up to the headline the card above them shows. On
  // plain VA the whole layer is absent, exactly as in the individual card.
  const withDef = defActive && !!defs;
  const DEF_KEY = "D Rating";
  // One player-season's defensive value added, measured in its own season and
  // on the view's scope. A season with no rating (pre-bake, unjoined name)
  // contributes nothing rather than dropping out of the pool.
  //
  // A D Rating is a season-level quantity — it keys off that season's team map
  // and league line — so an aggregate's defensive value is the SUM of its
  // seasons' own, never one rating recomputed off pooled minutes. That also
  // keeps it consistent with the box categories, which sum the same way.
  const dvaOf = (r, lgaX, season) => {
    if (!withDef) return 0;
    if (r?.multi) {
      return r.seasons.reduce((sum, s) => (
        sum + (s.mp > 0 ? (defVAInfo(s, s.mp, lgaForSeason(s.season), defs, s.season, defScope)?.dva ?? 0) : 0)
      ), 0);
    }
    return r?.mp > 0 ? (defVAInfo(r, r.mp, lgaX, defs, season, defScope)?.dva ?? 0) : 0;
  };
  // The full D-Rating detail for one side, in defVAInfo's shape. For an
  // aggregate the ratings themselves (DRTG, team DRTG, the league line) are
  // minute-weighted averages across the selected seasons — the natural way to
  // state "what rating did this run play at" — while dva stays the exact sum
  // above. Null when no selected season has a rating at all.
  const defInfoFor = (r, lgaX) => {
    if (!withDef) return null;
    if (!r?.multi) return r?.mp > 0 ? defVAInfo(r, r.mp, lgaX, defs, r.season, defScope) : null;
    let mp = 0, drtg = 0, teamDrtg = 0, teamMp = 0, laD = 0, dva = 0, any = false;
    for (const s of r.seasons) {
      const info = s.mp > 0 ? defVAInfo(s, s.mp, lgaForSeason(s.season), defs, s.season, defScope) : null;
      if (!info) continue;
      any = true;
      mp += s.mp;
      drtg += info.drtg * s.mp;
      laD += info.laDRtg * s.mp;
      dva += info.dva;
      // Multi-team rows have no team line of their own; they sit out the team
      // average rather than pulling it toward zero.
      if (info.teamDrtg != null) { teamDrtg += info.teamDrtg * s.mp; teamMp += s.mp; }
    }
    if (!any || !(mp > 0)) return null;
    return {
      dva,
      drtg: drtg / mp,
      laDRtg: laD / mp,
      teamDrtg: teamMp > 0 ? teamDrtg / teamMp : null,
      w: null,
    };
  };
  // Leaving VA+ takes the D Rating row away with it, so an open one can't stay
  // selected — it would leave the career chart plotting a row that no longer
  // exists (and reads as a career of zeros).
  useEffect(() => {
    if (withDef) return;
    setOpenKeys((prev) => (prev.has(DEF_KEY) ? new Set([...prev].filter((k) => k !== DEF_KEY)) : prev));
  }, [withDef]);

  const GROUP_KEYS = VA_GROUPS.map((g) => g.key);
  // The Defense group's members gain D Rating under VA+; every other group is
  // its plain category list.
  const catsOf = (g) => (withDef && g.key === "Defense" ? [...g.cats, DEF_KEY] : g.cats);
  const MEMBER_KEYS = withDef ? [...VA_CATEGORY_ORDER, DEF_KEY] : VA_CATEGORY_ORDER;
  const ALL_KEYS = [...GROUP_KEYS, ...MEMBER_KEYS];

  const d = useMemo(() => {
    // Every figure in the panel — bars, numbers and the percentile pool alike
    // — is read on whichever side of the /G switch is showing, so a rank never
    // means one thing in the strip and another in the number beside it. `dva`
    // is the row's defensive value added, computed once per row and folded into
    // both the rows it belongs to (its own, and Defense's total).
    const valOf = (r, lgaX, key, dva) => {
      const v = key === DEF_KEY
        ? dva
        : catVATotal(r, lgaX, key) + (key === "Defense" ? dva : 0);
      return perGame ? v / (r.gp || 1) : v;
    };
    // Percentiles rank against EVERY indexed player-season (all-time pool),
    // each row measured era-fair against its own season's baselines. One pass
    // over the pool computes every group + category at once; the >=5 G floor
    // matches the all-time rank in the context card. The pool max per key
    // marks the #1 season, the only one allowed to display a flat 100.
    const pool = context.allRows.filter((r) => (r.gp || 0) >= 5 && r.mp > 0);
    const maxByKey = {};
    const poolVals = pool.map((r) => {
      const lgaX = lgaForSeason(r.season);
      const dva = dvaOf(r, lgaX, r.season);
      const out = {};
      for (const key of ALL_KEYS) {
        out[key] = valOf(r, lgaX, key, dva);
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
    const adva = dvaOf(a, lgaA, a.season);
    const bdva = dvaOf(b, lgaB, b.season);
    for (const key of ALL_KEYS) {
      const av = valOf(a, lgaA, key, adva);
      const bv = valOf(b, lgaB, key, bdva);
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
  }, [a, b, lgaA, lgaB, context, perGame, withDef, defs, defScope]);

  // Per-game figures are an order of magnitude smaller than season totals, so
  // they carry a second decimal; totals match the leaderboard's one.
  const sgn = (v, dp = perGame ? 2 : 1) => (v > 0 ? "+" : "") + v.toFixed(dp);
  // The tally sums the four groups, so with D Rating folded into Defense it is
  // a VA+ margin and says so.
  const vaUnit = `${withDef ? "VA+" : "VA"}${perGame ? "/G" : ""}`;
  // Season totals run to four figures for a career scoring leader, where the
  // per-game column's width would run the two players' numbers together.
  const valW = perGame ? "w-10" : "w-14";
  const leader = d.diff >= 0 ? a : b;
  // Bars scale per level: groups against groups, members against their group.
  const scaleFor = (ks) => Math.max(...ks.flatMap((k) => [Math.abs(d.rows[k].av), Math.abs(d.rows[k].bv)]), perGame ? 0.1 : 1);

  // Career overlay: both players' seasons aligned by career year, showing VA
  // per season on the card's /G switch. With a category selected it shows that
  // category's VA per season (era-fair: each season vs its own baselines).
  // Diverging from a shared zero baseline, since category VA (Turnovers!)
  // can be negative season after season.
  // The index entry's own season rows carry no identity of their own, and
  // defVAInfo keys off the slug — tag them so the career bars can carry the
  // D-Rating layer too.
  // The chart always plots each player's WHOLE career, not just the selection
  // — that's the point of it. When a side is an aggregate, the seasons inside
  // the selection are drawn at full strength and the rest dimmed, so the run
  // being compared is visible in the shape of the career around it.
  const aSeasons = (aSeasonsProp || context.self?.seasons || [])
    .map((s) => ({ ...s, name: a.name, slug: a.slug || null }))
    .sort((x, y) => x.season.localeCompare(y.season));
  const bAll = [...bSeasons].sort((x, y) => x.season.localeCompare(y.season));
  // Which seasons on each side count as "the compared one" for full opacity.
  const aSel = aMulti ? a.seasonKeys : new Set([a.season]);
  const bSel = bMulti ? b.seasonKeys : new Set([b.season]);
  const slots = Math.max(aSeasons.length, bAll.length);
  // Slots split the row evenly, so a one- or two-year chart would blow its bars
  // up into slabs the width of the card. Cap a slot at the width it would have
  // in a four-year career and centre what's left: a short career then reads as
  // a small chart rather than a distorted one, and two rookies get the same
  // bar width they'd have as sophomores.
  const SLOT_MAX = "25%";
  // Deepest selection wins: an open member category, else the open group.
  // The career overlay follows the deepest interaction: an open raw-stats card
  // wins; otherwise the most-recently-opened group (Set insertion order).
  const activeKey = ([...openKeys].at(-1) ?? null) || ([...openGroups].at(-1) ?? null);
  const careerVal = (s) => {
    const lgaS = lgaForSeason(s.season);
    const dva = (!activeKey || activeKey === "Defense" || activeKey === DEF_KEY) ? dvaOf(s, lgaS, s.season) : 0;
    // No category selected the bars are the season's whole value — VA+ when
    // the D-Rating layer is on, so they match the rows above.
    const v = activeKey === DEF_KEY ? dva
      : activeKey ? catVATotal(s, lgaS, activeKey) + (activeKey === "Defense" ? dva : 0)
      : (s.va || 0) + dva;
    return perGame ? v / (s.gp || 1) : v;
  };
  const cvals = [...aSeasons, ...bAll].map(careerVal);
  const cHi = Math.max(0, ...cvals), cLo = Math.min(0, ...cvals);
  const cSpan = (cHi - cLo) || 1;
  const cZeroPct = (cHi / cSpan) * 100; // baseline's offset from the top
  // An unfiltered career bar carries the whole season, defense included, so it
  // is a VA+ bar under the D-Rating layer; a selected category is always plain
  // category VA.
  const careerUnit = `${!activeKey && withDef ? "VA+" : "VA"}`;
  const careerLabel = `${activeKey ? `${CAT_SHORT[activeKey] || activeKey} ` : ""}${perGame ? `${careerUnit}/G` : `Total ${careerUnit}`} by career year`;

  // Tapping a PAIR of career-year bars re-points the whole page at that year:
  // the comparison becomes each player's season at that career year, and the
  // page behind it follows to player A's side of it — the leaderboard switches
  // season/team and opens their row in By Season, their career view opens that
  // season in By Player. That's the same size of jump as the compared-player
  // chip above, so it's gated the same way: the first tap arms a "Compare Year
  // X?" popup and only its "Go →" travels (see useGatedGo).
  const careerGo = useGatedGo();
  const canCompareYear = !!context?.onNavigateToPlayer;
  const goCompareYear = (as, bs) => context.onNavigateToPlayer({
    season: as.season,
    team: as.team || a.team || null,
    name: a.name,
    slug: a.slug || null,
    // The other half of the jump: whoever lands on the far side re-opens this
    // comparison against player B's season at the same career year.
    compare: { season: bs.season, name: b.name, slug: b.slug || null },
  });
  // A career year only one of them reached has no comparison in it, so tapping
  // that lone bar opens that player's own season card instead — the same jump
  // the compared-player chip makes, with no comparison riding along.
  const goSeason = (s, side) => context.onNavigateToPlayer({
    season: s.season,
    team: s.team || (side === "a" ? a.team : b.team) || null,
    name: side === "a" ? a.name : b.name,
    slug: (side === "a" ? a.slug : b.slug) || null,
  });
  // Never leave a pair armed after the chart underneath it has changed.
  useEffect(() => {
    careerGo.disarm();
  }, [careerGo.disarm, a.season, b.season, activeKey, perGame]);

  // Where a slot's tap goes, if anywhere. A year is a COMPARISON target only
  // when both players have a season in it, and the pair already on screen is
  // where you are, not somewhere to go. A year only one of them reached is a
  // SEASON target instead: its lone bar opens that player's own card. Player
  // A's current season is the page you're already on, so it stays a plain bar.
  const navFor = (i) => {
    const as = aSeasons[i], bs = bAll[i];
    // A career-year jump re-points the page at ONE season on each side. A
    // multi-season selection can't ride along in that shape, so the chart
    // stays a read-only picture of the two careers while one is active.
    if (!canCompareYear || isMulti) return null;
    const isHere = as && bs && as.season === a.season && bs.season === b.season;
    if (as && bs) return isHere ? null : { pair: true };
    const side = as ? "a" : bs ? "b" : null;
    const season = side === "a" ? as : side === "b" ? bs : null;
    if (!season || (side === "a" && season.season === a.season)) return null;
    return { side, season };
  };
  // Two one-season careers put a single pair on the chart — the comparison
  // already on screen — so nothing in it is tappable and the footnote must not
  // promise otherwise.
  const anyNav = Array.from({ length: slots }, (_, i) => navFor(i)).some(Boolean);

  // Rate shown for a row in its tooltip. D Rating has no box-score rate of its
  // own — its "rate" is the rating itself — and catRateLabel only knows the ten
  // box categories, so it's answered here.
  const rateLabelFor = (r, key, lgaX) => {
    // An aggregate has no per-36 sample of its own to speak of beyond its
    // pooled minutes, which catRateLabel already handles; only the rating
    // needs the aggregate-aware lookup.
    if (key !== DEF_KEY) return catRateLabel(r, key, rateMode);
    const drtg = defInfoFor(r, lgaX)?.drtg;
    return drtg == null ? "–" : `${Math.round(drtg)} DRTG`;
  };

  // Raw-stats rows for the D Rating card, in the shape compareStatRows returns
  // (metric rows, one cell per player, the better one flagged). The rating
  // itself is lower-is-better; everything derived from it reads the normal way.
  const defStatRows = () => {
    const ia = defInfoFor(a, lgaA);
    const ib = defInfoFor(b, lgaB);
    const rows = [];
    // Each side is [value the row is won on, what to print]. A side with
    // nothing to show sits out and the row goes unflagged.
    const push = (label, [acmp, adisp], [bcmp, bdisp], lowerBetter = false) => {
      let win = null;
      if (acmp != null && bcmp != null && acmp !== bcmp) win = (lowerBetter ? acmp < bcmp : acmp > bcmp) ? "a" : "b";
      rows.push({ label, a: adisp, b: bdisp, win });
    };
    const none = [null, "–"];
    const r0 = (v) => String(Math.round(v));
    const sg1 = (v) => (v > 0 ? "+" : "") + v.toFixed(1);
    const sg2 = (v) => (v > 0 ? "+" : "") + v.toFixed(2);
    const val = (v, disp) => (v == null ? none : [v, disp(v)]);
    // The player's own team defense: its rating, and how far that sits under
    // (green) or over (red) the season's league line. This is the pot the
    // second half of a D Rating is drawn from — a player earns a share of his
    // team's edge — so it's the context the rating above is read against.
    // Absent for multi-team (2TM) rows and seasons with no team map, where the
    // rating falls back to the plain vs-league form.
    const team = (i) => {
      if (!i || i.teamDrtg == null) return none;
      const edge = i.laDRtg - i.teamDrtg;
      return [edge, (
        <>
          {r0(i.teamDrtg)}{" "}
          <span className={edge >= 0 ? "text-emerald-600" : "text-red-600"}>{sg1(edge)}</span>
        </>
      )];
    };
    push("DRTG", val(ia?.drtg ?? null, r0), val(ib?.drtg ?? null, r0), true);
    push("TM VS LG", team(ia), team(ib));
    push("D VA/G", val(ia ? ia.dva / (a.gp || 1) : null, sg2), val(ib ? ib.dva / (b.gp || 1) : null, sg2));
    push("TOT D VA", val(ia?.dva ?? null, sg1), val(ib?.dva ?? null, sg1));
    return rows;
  };

  const Swatch = ({ color, outline }) => (
    <span
      className="inline-block w-2 h-2 rounded-sm align-middle mx-1"
      style={outline ? { backgroundColor: withAlpha(color, 0.25), border: `1px solid ${GOLD}` } : { backgroundColor: color }}
    />
  );

  // The /G switch rides in the career chart's header — the same place the
  // individual card's category view parks it, above the bars that most visibly
  // answer to it. It still governs the whole panel.
  // Absent entirely while a multi-season run is on screen: per-game is the
  // only reading available there, so a switch that can't move is just a
  // control that doesn't work.
  const gToggle = isMulti ? null : (
    <PerGameToggle
      perGame={perGame}
      onToggle={() => setPerGame((v) => !v)}
      title={perGame
        ? "Comparison shown per game — tap for season totals"
        : "Comparison shown on season totals — tap for per-game"}
    />
  );

  // What the two sides are, spelled out under the rows: a multi-season run
  // says how many seasons and games it pools and that its baseline is the
  // volume-weighted blend of those seasons' leagues.
  const sideSummary = (r, color) => (
    <span style={{ color }}>
      <span className="font-semibold">{shortName(r.name)}</span>{" "}
      {r.multi
        ? `${r.seasons.length} seasons · ${r.gp} G`
        : `${seasonTag(r.season)} · ${r.gp || 0} G`}
    </span>
  );

  return (
    <div className="text-[10px]">
      {/* Legend + tally (the head-to-head scorecard header) */}
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="font-semibold truncate" style={{ color: ca }}><Swatch color={ca} />{a.name} {rowSeasonLabel(a)}</span>
        <span className="text-stone-400 shrink-0">vs</span>
        {/* The compared player's chip links to that player's own card: in By
            Season it opens the Leaderboard for their season filtered to their
            team; in By Player it opens their default career view. Tapping the
            chip first arms a "Go →" confirmation in its place (see `armed`);
            only "Go →" navigates. The parent supplies onNavigateToPlayer via
            context (present whenever comparing); without it the chip stays a
            plain label. */}
        {chipNavigates ? (
          armed ? (
            <button
              ref={go.goRef}
              type="button"
              onClick={confirmGo}
              className="shrink-0 font-semibold rounded-sm px-2 py-[1px] whitespace-nowrap inline-flex items-center gap-1 hover:brightness-95 touch-manipulation"
              style={{ color: cb, backgroundColor: GOLD_BG, border: `1px solid ${withAlpha(GOLD, 0.5)}` }}
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
          <span className="font-semibold truncate text-right rounded-sm px-1 py-[1px]" style={{ color: cb, backgroundColor: GOLD_BG, border: `1px solid ${withAlpha(GOLD, 0.5)}` }}>{b.name} {rowSeasonLabel(b)}<Swatch color={cb} outline /></span>
        )}
      </div>
      {/* Tally. The /G switch lives on the career chart below, which renders for
          any career the index carries — a single season included. Only a pair
          the index has no seasons for at all leaves no chart to hang it on, and
          then it falls back to this row's right edge rather than going missing.
          The tally stays optically centered either way (the button is out of
          flow). */}
      <div className="relative flex items-center justify-center mb-1.5 min-h-[1.1rem]">
        <span className={`text-center text-[9px] font-semibold ${slots > 0 ? "" : "px-14"}`} style={{ color: d.diff >= 0 ? ca : cb }}>
          {rowSeasonLabel(leader)} {leader.name} <span className="tabular-nums">{sgn(Math.abs(d.diff))} {vaUnit}</span>
        </span>
        {slots < 1 && gToggle && <div className="absolute right-0 top-0">{gToggle}</div>}
      </div>
      {/* Rows flanked by a slim vertical Expand All / Collapse All rail that
          opens (or closes) every group and every raw-stats card at once. */}
      <div className="flex items-stretch gap-1">
      {(() => {
        const allOpen = openGroups.size >= VA_GROUPS.length && openKeys.size >= MEMBER_KEYS.length;
        const toggleAll = () => {
          if (allOpen) {
            setOpenGroups(new Set());
            setOpenKeys(new Set());
          } else {
            setOpenGroups(new Set(GROUP_KEYS));
            setOpenKeys(new Set(MEMBER_KEYS));
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
            : () => toggleGroup(g.key, catsOf(g));
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
                    <div className="flex-1 relative h-5" title={`${a.name}: ${rateLabelFor(a, key, lgaA)} · ${b.name}: ${rateLabelFor(b, key, lgaB)}`}>
                      <div className="absolute inset-y-0 left-1/2 w-px bg-stone-300" />
                      <div className="absolute h-[7px] top-[3px]" style={{ backgroundColor: ca, left: r.av >= 0 ? "50%" : `${50 - (Math.abs(r.av) / scale) * 45}%`, width: `${(Math.abs(r.av) / scale) * 45}%` }} />
                      <div className="absolute h-[7px] bottom-[3px] box-border" style={{ backgroundColor: cbFill, border: cbEdge, left: r.bv >= 0 ? "50%" : `${50 - (Math.abs(r.bv) / scale) * 45}%`, width: `${(Math.abs(r.bv) / scale) * 45}%` }} />
                    </div>
                    <span className={`${valW} shrink-0 tabular-nums text-right font-semibold`} style={{ color: ca }}>{sgn(r.av)}</span>
                    <span className={`${valW} shrink-0 tabular-nums text-right font-semibold rounded-sm pr-0.5`} style={{ color: cb, backgroundColor: GOLD_BG }}>{sgn(r.bv)}</span>
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
                const rows = key === DEF_KEY ? defStatRows() : compareStatRows(a, b, key, lgaA, lgaB);
                const head = (row, color, gold) => (
                  <div className={`min-w-0 px-1 py-0.5 rounded-sm ${gold ? "" : ""}`} style={gold ? { backgroundColor: GOLD_BG } : undefined}>
                    <div className="flex items-center gap-0.5 justify-end">
                      <Swatch color={color} outline={gold} />
                      <span className="truncate font-semibold text-[10px] leading-tight" style={{ color }}>{row.name}</span>
                    </div>
                    <div className="text-[8px] text-stone-400 text-right leading-tight">{rowSeasonLabel(row)} · {row.gp || 0} G</div>
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
                {catsOf(g).map((ck) => rowFor(ck, scaleFor(catsOf(g)), true))}
              </div>
            )}
          </React.Fragment>
        );
      })}
      </div>
      </div>
      <div className="mt-1 text-center text-[9px] italic text-stone-400">
        {(mode === "values"
          ? `${perGame ? "Per-game" : "Season-total"} VA, each vs their own ${isMulti ? "run’s blended league baseline" : "season’s league baseline"}`
          : `Percentile of ${perGame ? "per-game" : "season-total"} VA across every indexed player-season, ≥5 G, each vs their own era`)
          + (withDef ? " · Defense carries D Rating, so the four groups sum to VA+" : "")
          + " · tap a group for its categories, a category for raw stats"}
      </div>
      {isMulti && (
        // A multi-season run's baseline is the seasons' own league averages
        // weighted by the player's volume in each — so its 3P% line is
        // Σ(league 3P% × his 3PA) / Σ his 3PA, and the VA above it is exactly
        // what his individual seasons already added up to.
        <div className="mt-0.5 text-center text-[8px] italic text-stone-400">
          {sideSummary(a, ca)} <span className="text-stone-300">·</span> {sideSummary(b, cb)}
          {" — each run vs its own seasons’ league averages, weighted by the volume he played in them"}
        </div>
      )}

      {/* Career-year overlay */}
      {slots > 0 && (
        <div className="mt-2 pt-2 border-t border-stone-100">
          {/* Extra bottom margin keeps a constant gap under the button, so a
              full-height bar never crowds it. */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="uppercase tracking-wider text-[9px] text-stone-400 min-w-0 truncate">{careerLabel}</span>
            {gToggle}
            {/* The tally row's fallback only fires with no chart at all, so
                nothing else needs to hold the toggle's place here. */}
          </div>
          <div className="flex items-stretch justify-center gap-[2px] h-16 px-1">
            {Array.from({ length: slots }, (_, i) => {
              const as = aSeasons[i], bs = bAll[i];
              const bar = (s, color, side) => {
                if (!s) return null;
                const v = careerVal(s);
                const h = (Math.abs(v) / cSpan) * 100;
                const topPct = v >= 0 ? cZeroPct - h : cZeroPct;
                const isSel = (side === "a" ? aSel : bSel).has(s.season);
                // The comparison side reads as a gold-edged bar with the team
                // color inside. At the row strip's 0.25 tint that inside was
                // washing out to near-white at bar width — legible as an
                // outline, but not as a COLOR next to A's solid fill, which
                // made the two sides look like different kinds of thing rather
                // than two players. CAREER_B_FILL halves the lightening (0.25
                // → 0.6 alpha, i.e. 75% → 40% toward white) so the bar carries
                // its team color while the gold edge still identifies it.
                const fill = side === "a"
                  ? { backgroundColor: color }
                  : { backgroundColor: withAlpha(color, CAREER_B_FILL), border: `1px solid ${GOLD}` };
                return (
                  <div
                    className={`absolute box-border ${side === "a" ? "left-[8%] w-[38%]" : "right-[8%] w-[38%]"}`}
                    style={{ top: `${topPct}%`, height: `${Math.max(h, 1.5)}%`, ...fill, opacity: isSel ? 1 : 0.4 }}
                    title={`${s.season}: ${sgn(v)}${activeKey ? ` ${CAT_SHORT[activeKey] || activeKey}` : ""} ${vaUnit}`}
                  />
                );
              };
              const nav = navFor(i);
              const pairNav = nav?.pair === true;
              const loneSide = nav?.side ?? null;
              const loneSeason = nav?.season ?? null;
              const navigable = !!nav;
              const isArmed = careerGo.isArmed(i);
              // Popup anchor: keep it inside the card by left-aligning near the
              // left edge and right-aligning near the right, centering between.
              const frac = (i + 0.5) / slots;
              const anchor = frac < 0.25 ? "left-0" : frac > 0.75 ? "right-0" : "left-1/2 -translate-x-1/2";
              return (
                <div
                  key={i}
                  className="flex-1 relative min-w-0"
                  style={{ maxWidth: SLOT_MAX }}
                  title={`Career year ${i + 1}${as ? ` · ${seasonTag(as.season)} ${sgn(careerVal(as))}` : ""}${bs ? ` · ${seasonTag(bs.season)} ${sgn(careerVal(bs))}` : ""}${pairNav ? " · tap to compare this year" : loneSeason ? " · tap to open that season" : ""}`}
                >
                  <div className="absolute inset-x-0 h-px bg-stone-200" style={{ top: `${cZeroPct}%` }} />
                  {bar(as, ca, "a")}
                  {bar(bs, cb, "b")}
                  {navigable && (
                    // Full-column tap target over the slot (a sibling of the
                    // popup, not its parent — the popup carries its own button
                    // and buttons can't nest).
                    <button
                      type="button"
                      onClick={() => careerGo.arm(i)}
                      aria-label={pairNav
                        ? `Career year ${i + 1} — ${a.name} ${as.season} against ${b.name} ${bs.season}; tap to confirm comparing it`
                        : `Career year ${i + 1} — ${loneSide === "a" ? a.name : b.name} ${loneSeason.season}; tap to confirm opening it`}
                      aria-expanded={isArmed}
                      className={`absolute inset-0 rounded-sm cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500 ${isArmed ? "bg-stone-900/10" : "hover:bg-stone-900/5"}`}
                    />
                  )}
                  {isArmed && (
                    // The gate: the armed slot raises this popup, and only its
                    // "Go →" travels. Anything else disarms (useGatedGo swallows
                    // that tap, so it can't also open a row). It hangs BELOW the
                    // bars, over the career-year ticks it restates.
                    <div className={`absolute top-full mt-1 z-20 ${anchor}`}>
                      <span
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 py-[2px] shadow-sm"
                        style={{ backgroundColor: GOLD_BG, border: `1px solid ${withAlpha(GOLD, 0.5)}` }}
                      >
                        {pairNav ? (
                          <>
                            <span className="text-[9px] font-semibold text-stone-700">Compare Year {i + 1}?</span>
                            <span className="text-[9px] font-semibold tabular-nums" style={{ color: ca }}>{seasonTag(as.season)}</span>
                            <span className="text-[8px] text-stone-400">vs</span>
                            <span className="text-[9px] font-semibold tabular-nums" style={{ color: cb }}>{seasonTag(bs.season)}</span>
                          </>
                        ) : (
                          // Lone bar: the same gate, asking to open one season
                          // rather than to compare a year.
                          <>
                            <span className="text-[9px] font-semibold text-stone-700">
                              Open {shortName(loneSide === "a" ? a.name : b.name)} {seasonTag(loneSeason.season)}?
                            </span>
                            {loneSeason.team && (
                              <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: teamColor(loneSeason.team) }}>{loneSeason.team}</span>
                            )}
                            <span
                              className="text-[9px] font-semibold tabular-nums"
                              style={{ color: careerVal(loneSeason) < 0 ? "#dc2626" : (loneSide === "a" ? ca : cb) }}
                            >{sgn(careerVal(loneSeason))}</span>
                          </>
                        )}
                        <button
                          ref={careerGo.goRef}
                          type="button"
                          onClick={() => careerGo.confirm(() => (pairNav ? goCompareYear(as, bs) : goSeason(loneSeason, loneSide)))}
                          className="text-[9px] font-semibold inline-flex items-center gap-0.5 rounded-sm bg-stone-900 text-white px-1.5 py-[1px] hover:brightness-125 touch-manipulation"
                          title={pairNav
                            ? `Open ${a.name} ${seasonTag(as.season)} compared with ${b.name} ${seasonTag(bs.season)}`
                            : `Open ${loneSide === "a" ? a.name : b.name} ${seasonTag(loneSeason.season)}`}
                        >
                          Go <span aria-hidden>→</span>
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-center gap-[2px] px-1 mt-0.5">
            {Array.from({ length: slots }, (_, i) => (
              <span key={i} className="flex-1 min-w-0 text-center text-[7px] tabular-nums text-stone-400" style={{ maxWidth: SLOT_MAX }}>{i + 1}</span>
            ))}
          </div>
          <div className="text-center text-[8px] italic text-stone-400 mt-0.5">
            Seasons aligned by career year · {isMulti ? "selected seasons at full strength" : "compared seasons at full strength"}{anyNav ? <> · tap a pair to compare that year, a lone bar to open that season, then <span className="font-semibold not-italic">Go →</span></> : null}
          </div>
        </div>
      )}
    </div>
  );
}


// The "/G ON · OFF" switch, shared by the individual view's category card and
// the compare panel so one control means the same thing in both places: ON
// (the default) reads every value, rank and bar as PER-GAME value added; OFF
// re-reads the whole card on season TOTALS, where a full season outweighs a
// half one at the same rate.
export function PerGameToggle({ perGame, onToggle, title }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={perGame}
      title={title || (perGame
        ? "Values shown per game — tap for season totals"
        : "Show values per game instead of season totals")}
      className={`shrink-0 tabular-nums text-[9px] font-semibold tracking-wide px-1.5 py-0.5 rounded-sm border transition-colors ${perGame ? "bg-stone-800 text-stone-100 border-stone-800" : "bg-white text-stone-500 border-stone-300 hover:text-stone-700"}`}
    >
      /G {perGame ? "ON" : "OFF"}
    </button>
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
        vs {shortName(compare.name)} {rowSeasonLabel(compare.row)} <span className="opacity-60">✕</span>
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
