"use client";

import { useState, useEffect } from "react";
import { fetchJsonCached } from "./fetch-cache";


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
// share w is objective and direction-aware, built from the EARNED share —
// the equal 1-of-5 split scaled by the player's stock-rate relative to his
// team's, with stocks valued exactly as VA values them: a steal ends the
// possession outright, a block only when the defense rebounds it, so
// blocks weigh laDRBrate (~0.7) of a steal —
//   stockRate = (STL + laDRBrate × BLK) per minute
//   earned    = clamp(0.2 × playerStockRate / teamStockRate, 0.05, 1)
//   team edge ≥ 0 (credit is EARNED): w = earned — the collective edge
//     flows to whoever produces the defensive events;
//   team edge < 0 (blame SHRINKS with activity): w = clamp(0.4 − earned)
//     — the earned share mirrored around the 1-in-5 split, so contesting
//     shields you from the collective failure and passivity draws more
//     of it. (A flat split punished nobody but also shielded nobody; a
//     stock-share split punished activity outright.)
// Both branches conserve the team pot exactly up to the clamps (mirrored
// shares also average 1-in-5 across a roster) and the contribution is
// continuous at edge = 0. Multi-team rows (2TM) and seasons without team
// maps fall back to the plain vs-league form (w=1 on the whole net). DRtg
// is a Bayesian posterior: basketball-reference's box-score-estimated
// Defensive Rating is the prior (worth DEF_PBP_PRIOR_POSS possessions of
// evidence), updated by the actual on-court play-by-play rating (points
// allowed per 100 possessions while on the floor, 2000-01+) in proportion
// to the possessions the player really logged — see defRtgEntryFor and the
// pbpW weight below. Pre-2000 (and unbaked/unjoined) seasons are simply
// all-prior. The league line is laPTSperPoss×100; laPOSSperM (pace/48)
// converts per-possession into per-minute. Null (→ hidden in the UI) when
// the player-season has no rating from either source.
export const DEF_TEAM_SHARE_BASE = 0.2; // the equal 1-of-5 defender split

export const DEF_TEAM_SHARE_MIN = 0.05, DEF_TEAM_SHARE_MAX = 1;

// Bayesian prior weight for the on-court rating, in defensive possessions:
// the box-score estimate acts as an informed prior worth ~1,500 possessions
// (~730 minutes) of evidence, and the play-by-play data overtakes it as real
// possessions accrue. A full-time starter (~4,500-5,000 poss) is ~75-77% PBP;
// a 300-minute injury season stays ~70% estimate — which is what keeps a
// 20-pts/100 small-sample on-court fluke from lapping the leaderboard.
export const DEF_PBP_PRIOR_POSS = 1500;

export function defVAInfo(row, viewMp, lgaX, defs, season, pref = "rs") {
  const ent = defRtgEntryFor(defs, season, row?.slug, pref);
  if (!ent || !lgaX || !(lgaX.laPOSSperM > 0) || !(lgaX.laPTSperPoss > 0) || !(viewMp > 0)) return null;
  const la = lgaX.laPTSperPoss * 100;
  const e = defs?.[season];
  const tmap = pref === "po" ? (e?.teamPo || e?.team) : (e?.team || e?.teamPo);
  const t = tmap?.[row?.team];
  // Posterior weight on the PBP rating: poss / (poss + prior). Pure est when
  // no PBP sample exists (pre-2000, unbaked seasons, unjoined names); pure
  // PBP in the rare case the estimate is missing.
  const poss = row?.mp > 0 ? row.mp * lgaX.laPOSSperM : 0;
  const pbpW =
    ent.pbp != null && ent.est != null ? poss / (poss + DEF_PBP_PRIOR_POSS)
    : ent.pbp != null ? 1
    : 0;
  const drtg = pbpW * (ent.pbp ?? 0) + (1 - pbpW) * (ent.est ?? 0);
  // The team baseline blends with the SAME weights so IND subtracts like
  // from like at both extremes (counted vs estimated possessions sit ~1
  // pt/100 apart). Stock rates still come from the BR team map (plain box
  // stats, identical either way).
  const pbpTmap = pref === "po" ? (e?.teamPoPbp || e?.teamPbp) : (e?.teamPbp || e?.teamPoPbp);
  const pbpTeamDrtg = pbpW > 0 ? pbpTmap?.[row?.team] : null;
  // Blocks weigh what VA says they're worth: laDRBrate of a steal.
  const bw = lgaX.laDRBrate > 0 ? lgaX.laDRBrate : 1;
  const teamStockRate = t ? (t.stlpm || 0) + bw * (t.blkpm || 0) : 0;
  let net, w = null, teamDrtg = null;
  if (t && t.drtg > 0 && teamStockRate > 0 && row.mp > 0) {
    teamDrtg = pbpTeamDrtg > 0 ? pbpW * pbpTeamDrtg + (1 - pbpW) * t.drtg : t.drtg;
    const edge = la - teamDrtg;
    const clampW = (v) => Math.max(DEF_TEAM_SHARE_MIN, Math.min(DEF_TEAM_SHARE_MAX, v));
    const ratio = (((row.stl || 0) + bw * (row.blk || 0)) / row.mp) / teamStockRate;
    const earned = clampW(DEF_TEAM_SHARE_BASE * ratio);
    w = edge >= 0 ? earned : clampW(2 * DEF_TEAM_SHARE_BASE - earned);
    net = (teamDrtg - drtg) + w * edge;
  } else {
    net = la - drtg;
  }
  return { dva: (net / 100) * lgaX.laPOSSperM * viewMp, drtg, w, teamDrtg, laDRtg: la, pbpW };
}


// DRtg sources for a player-season, kept separate so defVAInfo can do the
// Bayesian blend: `pbp` is the on-court play-by-play rating (rsPbp/poPbp —
// actual points allowed per 100 possessions while on the floor, baked from
// api.pbpstats.com for 2000-01+), `est` is basketball-reference's box-score
// estimate. Within each source, `pref` picks the sample ("po" for playoff
// views, "rs" otherwise) and the other side backstops it so a player with
// only one sample still gets a rating. Null when neither source has one.
export function defRtgEntryFor(defs, season, slug, pref = "rs") {
  if (!defs || !season || !slug) return null;
  const e = defs[season];
  if (!e) return null;
  const other = pref === "po" ? "rs" : "po";
  const pbp = e[pref + "Pbp"]?.[slug] ?? e[other + "Pbp"]?.[slug] ?? null;
  const est = e[pref]?.[slug] ?? e[other]?.[slug] ?? null;
  return pbp != null || est != null ? { pbp, est } : null;
}


// One shared fetch of the baked ratings; components render without them
// (VA+ simply absent) until the map arrives.
export function useDefRatings() {
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
