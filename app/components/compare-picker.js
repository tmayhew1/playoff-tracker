"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { shootProfileVec } from "../scoring";
import { GOLD, GOLD_BG, compName, normalizeName, seasonTag, shortName, teamColor } from "../lib/format";
import { aggregateSeasons, careerDebuts, careerStageCenter, careerStageFactor, careerStageLabel, careerStageOf, matchCareerYears, similarRuns } from "../lib/multi-season";
import { perGameVAVec, tunnelBreak, vaComposition } from "../lib/va";
import { useRowLga } from "../lib/va-mode";
import { COMP_METRIC_OPTS, COMP_METRIC_WORD, buildComparePlayers, comparePlayerKey } from "./compare";


// The compare pickers: the single-season ComparePicker (search a player,
// tap a season) and the multi-season MultiComparePicker with its suggested
// comps. Split out of compare.js, which keeps the head-to-head ComparePanel
// and the small controls around it.


// "4" for one career year, "4–5" for a run's span. Rounded: a two-season
// window's stage is the middle of it, and half a career year is not a thing
// anyone says.
const stageDigits = (from, to = from, atLeast = false) => {
  const a = Math.round(from), b = Math.round(to);
  return `${a === b ? a : `${a}–${b}`}${atLeast ? "+" : ""}`;
};

// The career-stage clause of a comp chip's tooltip: which years of his own
// career the comp covers, which of yours the selection does, and — when the
// distance between them actually cost the comp something — what it matched on
// the box score alone before that discount. Nothing at all when the stage is
// unknown (a scope that carries the player for one season only tells us that
// season was his first in it).
function stageNote({ from, to = from, atLeast = false, selfFrom = null, selfTo = selfFrom, selfAtLeast = false, shape = null, stageF = 1 }) {
  if (from == null) return null;
  const parts = [careerStageLabel(from, to, atLeast)];
  if (selfFrom != null) parts.push(`yours: ${stageDigits(selfFrom, selfTo, selfAtLeast)}`);
  if (shape != null && stageF < 0.98) parts.push(`${Math.min(99, Math.round(shape * 100))}% before the career-stage discount`);
  return parts.join(" · ");
}


// Inline picker: search a player from the scope index, then tap one of their
// seasons. onPick gets { name, slug, seasons, row }.
export function ComparePicker({ context, self = null, onPick, onCancel }) {
  // Baselines under the active USG-ADJ mode; the comp shapes below are
  // per-category VA, so they move with it (lib/va-mode.js). Per ROW rather
  // than per season: on the Combined board a row summed a regular season and a
  // playoff run and is scored against its own minute-weighted mix of the two,
  // which a season lookup cannot answer — it would price both sides of the
  // comparison against the regular season alone and disagree with the very
  // bars this panel draws underneath.
  const lgaOf = useRowLga(context?.scope);
  const [query, setQuery] = useState("");
  // The chosen player is held by KEY and looked up in the pool on every render:
  // holding the object would freeze his season rows at the baseline they
  // carried when he was chosen, and the season chips below print those rows'
  // VA/G (lib/va-mode.js re-prices the whole pool on a USG-ADJ toggle).
  const [selKey, setSelKey] = useState(null);
  const players = useMemo(() => buildComparePlayers(context.allRows), [context.allRows]);
  const sel = useMemo(
    () => (selKey ? players.find((pl) => comparePlayerKey(pl) === selKey) || null : null),
    [players, selKey]
  );
  const matches = useMemo(() => {
    const q = normalizeName(query.trim());
    if (q.length < 2) return [];
    return players
      .filter((pl) => normalizeName(pl.name).includes(q))
      .sort((a, b) => b.bestVa - a.bestVa)
      .slice(0, 12);
  }, [players, query]);

  // A player CAN be compared against himself — his ’19 against his ’26 is one
  // of the readings this card is for — but never against the very season the
  // card is about: that comparison is all zeros, and every bar, percentile and
  // career bar below it would say nothing. So when the player chosen here is
  // the one under the card, the season(s) the card is already reading are shown
  // locked rather than offered.
  const selfKey = self ? comparePlayerKey(self) : null;
  const selfSeasonKeys = self
    ? new Set(self.multi ? [...(self.seasonKeys || [])] : self.season ? [self.season] : [])
    : null;
  const selIsSelf = !!(sel && selfKey && comparePlayerKey(sel) === selfKey);

  // Career stage: which year of his own career each candidate season was, and
  // which year of his this one is (lib/multi-season.js). The comps below are
  // discounted by the distance between the two, so "who does this look like"
  // is answered from the same point in a career rather than by a 15-year
  // veteran whose box score happens to land in the same place.
  const debutBy = useMemo(() => careerDebuts(players, comparePlayerKey), [players]);
  const selfDebut = self ? debutBy.get(comparePlayerKey(self)) || null : null;
  const selfStage = self?.season ? careerStageOf(self.season, selfDebut?.year ?? null) : null;
  const selfStageAtLeast = !!selfDebut?.censored;

  // Closest comps: the nearest player-seasons to `self` by per-game VA-category
  // shape — the full ranked list per decade, best match first. Similarity =
  // cosine of the two 10-dim VA vectors (a dot product of unit vectors);
  // magnitude-weighted score breaks ties so equal-% chips still order by how
  // close the overall level is. Shown before searching. The single O(pool)
  // similarity pass is unchanged; keeping 12 per decade instead of 1 costs
  // nothing extra.
  //
  // Two ADMISSIBILITY gates run before any of that, because neither is a
  // matter of degree. The ±7 MPG band keeps comps in a similar minutes role,
  // and the composition tunnel (lib/va.js) keeps them in the same parts of the
  // game — a scorer whose value is 92% offense is not a 95% match for a big
  // who gets a third of his on the glass and at the rim, however close the two
  // vectors' angle comes out. The cosine cannot see that on its own: it is
  // dominated by whichever category is largest, which for both of those is
  // scoring volume.
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
  const selfShootVec = self ? shootProfileVec(self, lgaOf(self)) : null;
  const selfShootNorm = selfShootVec ? Math.hypot(...selfShootVec) : 0;
  const rawComps = useMemo(() => {
    if (!self || !(self.mp > 0)) return [];
    const qVec = perGameVAVec(self, lgaOf(self));
    const qNorm = Math.hypot(...qVec);
    if (!qNorm) return [];
    const qComp = vaComposition(qVec);
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
      const v = perGameVAVec(r, lgaOf(r));
      const n = Math.hypot(...v);
      if (!n) continue;
      let dot = 0;
      for (let i = 0; i < qVec.length; i++) dot += qVec[i] * v[i];
      const cos = dot / (qNorm * n);
      if (cos < 0.3) continue; // clearly different archetype — never a "comp"
      // Built out of the same parts of the game, level by level? Recorded
      // rather than skipped on: the Shooting lens asks a different question of
      // the same pool (whose gate is the 3PA rate below), so only the box-score
      // ranking drops what the tunnel refuses.
      const tunnel = tunnelBreak(qComp, vaComposition(v));
      const mag = Math.min(qNorm, n) / Math.max(qNorm, n);
      // Where this season sat in his career, and what the distance from the
      // selection's own stage costs it. Both metrics are discounted by the
      // same factor — a shooting profile from year 18 answers as different a
      // question as a box score from year 18.
      const rDebut = debutBy.get(comparePlayerKey(r)) || null;
      const stage = careerStageOf(r.season, rDebut?.year ?? null);
      const stageAtLeast = !!rDebut?.censored;
      const stageF = careerStageFactor(selfStage, stage, { aAtLeast: selfStageAtLeast, bAtLeast: stageAtLeast });
      let shootCos = null, shootMag = null, shootScore = null, shootShape = null;
      const r3Rate = r.fga > 0 ? r.tpa / r.fga : 0;
      if (shootOk && Math.abs(r3Rate - q3Rate) <= THREE_RATE_BAND) {
        const zv = shootProfileVec(r, lgaOf(r));
        const zn = zv ? Math.hypot(...zv) : 0;
        if (zn > 0) {
          let zdot = 0;
          for (let i = 0; i < selfShootVec.length; i++) zdot += selfShootVec[i] * zv[i];
          const zc = zdot / (selfShootNorm * zn);
          if (zc >= 0.3) { // same "clearly different archetype" floor, on the shooting profile
            shootCos = zc;
            shootMag = Math.min(selfShootNorm, zn) / Math.max(selfShootNorm, zn);
            shootShape = shootCos * shootMag;
            shootScore = shootShape * stageF;
          }
        }
      }
      const dec = Math.floor(parseInt(r.season.slice(0, 4), 10) / 10) * 10;
      let arr = byDecade.get(dec);
      if (!arr) byDecade.set(dec, (arr = []));
      // `score`/`shootScore` rank and print; `shape`/`shootShape` are the same
      // match before the career-stage discount, which the tooltip still credits.
      arr.push({ r, cos, mag, shape: cos * mag, score: cos * mag * stageF, stage, stageAtLeast, stageF, tunnel, shootCos, shootMag, shootShape, shootScore });
    }
    return [...byDecade.entries()].sort((x, y) => y[0] - x[0]); // most recent decade first
  }, [self, context, selfShootVec, selfShootNorm, lgaOf, debutBy, selfStage, selfStageAtLeast]);

  // Value of the currently selected metric for a candidate.
  const metricVal = (o) => (
    compMetric === "shoot" ? (o.shootScore ?? -Infinity) : o.score
  );

  // Re-rank each decade by the selected metric (no dot products — just a
  // sort), each lens dropping what it has no answer for rather than showing it
  // at the bottom with a meaningless number: "Box Score VA" drops what the
  // composition tunnel refused, "Shooting" drops candidates with no zone-VA
  // overlap. A decade left with nothing is dropped whole — a bare decade label
  // over an empty strip reads as a rendering fault, where no row at all is the
  // honest "this decade held no comparable season".
  const comps = useMemo(() => {
    return rawComps
      .map(([dec, arr]) => ({
        dec,
        list: [...arr]
          .filter((o) => (compMetric === "shoot" ? o.shootScore != null : !o.tunnel))
          .sort((x, y) => (metricVal(y) - metricVal(x)) || (y.cos - x.cos))
          .slice(0, COMPS_PER_DECADE),
      }))
      .filter(({ list }) => list.length > 0);
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
          {query.trim() === "" && comps.length === 0 && self && (
            <div className="mb-1 py-1 text-[9px] text-stone-400 leading-snug">
              No closest comps: no season in the index draws its value from the
              same parts of the game at a similar minutes load. Search for a
              player above to compare anyway.
            </div>
          )}
          {query.trim() === "" && comps.length > 0 && (
            <div className="mb-1">
              <div className="flex items-center justify-between gap-2 mt-1 mb-0.5">
                <span
                  className="uppercase tracking-wider text-[8px] text-stone-400 shrink-0"
                  title={`Ranked by how close the season is AND how close it sits to the same point in a career${selfStage != null ? ` — this one is your career year ${stageDigits(selfStage, selfStage, selfStageAtLeast)}` : ""}. Only seasons built out of the same parts of the game are eligible at all, so a decade with nothing comparable in it is left out rather than filled. Hover a comp for the career year it came from.`}
                >Closest comps · by decade</span>
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
                      const note = stageNote({
                        from: item.stage,
                        atLeast: item.stageAtLeast,
                        selfFrom: selfStage,
                        selfAtLeast: selfStageAtLeast,
                        shape: compMetric === "shoot" ? item.shootShape : item.shape,
                        stageF: item.stageF,
                      });
                      return (
                        <button
                          key={compKey(r)}
                          onClick={() => pickComp(r)}
                          className={`shrink-0 px-1.5 py-0.5 border rounded-sm hover:border-amber-500 hover:bg-amber-50 whitespace-nowrap ${isBest ? "border-amber-500" : "border-stone-200"}`}
                          style={isBest ? { backgroundColor: GOLD_BG, borderColor: GOLD } : undefined}
                          title={[
                            `${r.name} ${r.season}`, r.team,
                            `${pct}% ${COMP_METRIC_WORD[compMetric]}`,
                            note,
                            isBest ? "best match" : null,
                          ].filter(Boolean).join(" · ")}
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
              onClick={() => setSelKey(comparePlayerKey(pl))}
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
            <button onClick={() => setSelKey(null)} className="text-[9px] text-stone-400 hover:text-stone-700">‹ change player</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {sel.seasons.map((s) => {
              // The card's own season, when he is being searched against
              // himself: greyed and inert, so the one chip that would compare a
              // season with itself can't be tapped.
              const isSelf = selIsSelf && !!selfSeasonKeys?.has(s.season);
              return (
                <button
                  key={s.season}
                  onClick={() => onPick({ name: sel.name, slug: sel.slug, seasons: sel.seasons, row: s })}
                  disabled={isSelf}
                  aria-disabled={isSelf}
                  title={isSelf ? "The season this card is already reading — pick another of his seasons" : undefined}
                  className={`px-1.5 py-0.5 border tabular-nums ${isSelf ? "border-stone-200 bg-stone-50 text-stone-300 cursor-not-allowed" : "border-stone-300 hover:border-amber-500 hover:bg-amber-50"}`}
                  style={isSelf ? undefined : { color: teamColor(s.team) }}
                >
                  {seasonTag(s.season)} {s.team} <span className={isSelf ? "text-stone-300" : "text-stone-500"}>{(s.vaPerG ?? 0).toFixed(1)}/G</span>
                </button>
              );
            })}
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
export function MultiComparePicker({ context, self = null, selfRow = null, onPick, onCancel, suggestCount = 3, selfYears = null, selfCareerLen = 0, selfSeasons = null, asked = false }) {
  // As in ComparePicker: run shapes are per-category VA, so they follow the
  // active baseline (lib/va-mode.js).
  const lgaOf = useRowLga(context?.scope);
  const [query, setQuery] = useState("");
  // The chosen player by KEY, looked up in the pool below — held this way for
  // the same reason as in ComparePicker: the pool is rebuilt under a running
  // selection whenever USG-ADJ is toggled, and the ticked seasons print their
  // rows' VA/G.
  const [selKey, setSelKey] = useState(null);
  const [picked, setPicked] = useState(null); // Set of season strings
  // How the other player's seasons are pre-ticked. One switch, cycling:
  //   best — his highest-VA seasons, the same number as the selection
  //   year — the same CAREER years the selection occupies (matchCareerYears)
  //   same — the same CALENDAR seasons, whatever career year those fell in
  const [matchMode, setMatchMode] = useState("best");
  const canMatchYear = !!selfYears?.length && selfCareerLen > 0;
  const players = useMemo(() => buildComparePlayers(context.allRows), [context.allRows]);
  const sel = useMemo(
    () => (selKey ? players.find((pl) => comparePlayerKey(pl) === selKey) || null : null),
    [players, selKey]
  );
  const selfKey = self ? (self.slug || normalizeName(self.name || "")) : null;

  // The suggestions this picker opens on: the closest runs of the same length
  // as the selection, best match first within each decade (see similarRuns).
  // Tapping one goes straight to the comparison with those exact seasons
  // pooled — the same one-tap shortcut the season picker's comps give.
  const RUNS_PER_DECADE = 8;
  const runLen = Math.max(1, suggestCount);
  // Where the ticked run sits in this player's own career, in years since his
  // first indexed season (lib/multi-season.js). Handed to similarRuns, it
  // discounts candidate runs by how far their own stage is from it — the
  // suggestions for a 2-year run in years 4-5 lead with other players' years
  // 4-5, not with a 37-year-old's last two.
  const debutBy = useMemo(() => careerDebuts(players, comparePlayerKey), [players]);
  const selfDebut = self ? debutBy.get(comparePlayerKey(self)) || null : null;
  const selfStageAtLeast = !!selfDebut?.censored;
  const selfRunRows = useMemo(
    () => selfRow?.seasons || (selfRow?.season ? [selfRow] : []),
    [selfRow]
  );
  const selfStages = useMemo(
    () => selfRunRows.map((x) => careerStageOf(x.season, selfDebut?.year ?? null)).filter((y) => y != null).sort((a, b) => a - b),
    [selfRunRows, selfDebut]
  );
  const selfStage = useMemo(
    () => careerStageCenter(selfRunRows, selfDebut?.year ?? null),
    [selfRunRows, selfDebut]
  );
  const runComps = useMemo(
    () => similarRuns(players, selfRow, { runLen, selfKey, perDecade: RUNS_PER_DECADE, lgaOf, selfStage, selfStageAtLeast }),
    [players, selfRow, runLen, selfKey, lgaOf, selfStage, selfStageAtLeast]
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
      row: aggregateSeasons(run.seasons, { name: pl.name, slug: pl.slug || null }, lgaOf),
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
    setSelKey(comparePlayerKey(pl));
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
      // Scored at the ACTIVE baseline, like the run suggestions above — the
      // aggregate carries its own blended lga and per-category vector, and
      // building those against the standard baseline under USG-ADJ would hand
      // the panel a row in the wrong currency.
      row: aggregateSeasons(chosen, { name: sel.name, slug: sel.slug || null }, lgaOf),
    });
  };

  const panelRef = useRef(null);
  // Coming to the panel is for the reader who ASKED for it — the # tap. When
  // it lets itself in on the second ticked season it never moves the page,
  // however far down the table it landed: ticking a season is a thing you do
  // to the table you are reading, and taking the page out from under that is
  // worse than a panel waiting quietly below until you scroll to it.
  //
  // Asked for, it still only moves when it has to. Already in view — a short
  // career, or a reader down near the foot of a long one — and the scroll
  // position is theirs to keep. `nearest` then travels the shortest distance
  // that puts the panel on screen instead of hauling it to the top.
  useEffect(() => {
    const el = panelRef.current;
    if (!asked || !el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    // Taller than the viewport counts as on screen once its top is: there is
    // no scroll position that shows all of it, and the top is where it reads.
    if (r.top >= 0 && (r.bottom <= vh || r.height >= vh)) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [asked]);
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
                  <div
                    className="uppercase tracking-wider text-[8px] text-stone-400 mt-1 mb-0.5"
                    title={`Ranked by how close the run is AND how close it sits to the same point in a career${selfStages.length ? ` — this one is your career year${selfStages.length > 1 ? "s" : ""} ${stageDigits(selfStages[0], selfStages[selfStages.length - 1], selfStageAtLeast)}` : ""}. Hover a run for the career years it came from.`}
                  >
                    {runLen === 1 ? "Closest seasons" : `Closest ${runLen}-year runs`} · by decade
                  </div>
                  {runComps.map(({ dec, list }) => (
                    <div key={dec} className="flex items-center gap-1.5 py-0.5 border-b border-stone-100 last:border-0">
                      <span className="shrink-0 w-7 text-[8px] uppercase tracking-wider text-stone-400 tabular-nums">’{String(dec).slice(2)}s</span>
                      <div className="flex gap-1 overflow-x-auto no-scrollbar min-w-0 pb-0.5">
                        {list.map((run) => {
                          const pct = Math.min(99, Math.round(run.score * 100));
                          const isBest = runKey(run) === bestRunKey;
                          const note = stageNote({
                            from: run.stageFrom,
                            to: run.stageTo,
                            atLeast: run.stageAtLeast,
                            selfFrom: selfStages[0] ?? null,
                            selfTo: selfStages[selfStages.length - 1] ?? null,
                            selfAtLeast: selfStageAtLeast,
                            shape: run.shape,
                            stageF: run.shape > 0 ? run.score / run.shape : 1,
                          });
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
                                note,
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
            <button onClick={() => { setSelKey(null); setPicked(null); }} className="text-[9px] text-stone-400 hover:text-stone-700">‹ change player</button>
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
