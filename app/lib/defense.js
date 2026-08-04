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
// Defensive Rating, CALIBRATED onto the play-by-play scale (DEF_EST_CAL —
// the raw estimate separates teammates about five times as hard as real
// on-court play does), is the prior (worth DEF_PBP_PRIOR_POSS possessions
// of evidence), updated by the actual on-court play-by-play rating (points
// allowed per 100 possessions while on the floor, 2000-01+) in proportion
// to the possessions the player really logged — see defRtgEntryFor and the
// pbpW weight below. Pre-2000 (and unbaked/unjoined) seasons are simply
// all-prior, which is exactly why the prior has to be on the right scale.
// The league line is laPTSperPoss×100; laPOSSperM (pace/48) converts
// per-possession into per-minute. Null (→ hidden in the UI) when the
// player-season has no rating from either source.
export const DEF_TEAM_SHARE_BASE = 0.2; // the equal 1-of-5 defender split

export const DEF_TEAM_SHARE_MIN = 0.05, DEF_TEAM_SHARE_MAX = 1;

// Bayesian prior weight for the on-court rating, in defensive possessions:
// the box-score estimate acts as an informed prior worth ~1,500 possessions
// (~730 minutes) of evidence, and the play-by-play data overtakes it as real
// possessions accrue. A full-time starter (~4,500-5,000 poss) is ~75-77% PBP;
// a 300-minute injury season stays ~70% estimate — which is what keeps a
// 20-pts/100 small-sample on-court fluke from lapping the leaderboard.
//
// The playoffs get a lighter prior (~1/3, 500 poss). Two reasons pull the
// same way: playoff samples are inherently small — a first-round exit is
// ~350 possessions, which against the 1,500 RS prior is only ~19% PBP, so
// the "playoff" rating is really just the box-score estimate — and the
// estimate itself is noisier off a handful of games, so it earns less
// deference. At 500 that same short series is ~41% PBP and a full run
// (~1,500 poss) lands ~75%, matching where a RS starter sits.
export const DEF_PBP_PRIOR_POSS = 1500;
export const DEF_PBP_PRIOR_POSS_PO = 500;

// --- Calibrating the estimate onto the play-by-play scale --------------------
// The blend above only means something if its two inputs measure the same
// thing at the same scale. They don't. Regressing the on-court rating on the
// box-score estimate across the 20 baked PBP seasons (RS, MP≥500, minute-
// weighted) splits cleanly in two:
//
//   team component     (teamEst−L → teamPbp−L):  slope 0.96, r = 0.99
//   individual part    (est−teamEst → pbp−teamPbp): slope 0.14–0.21, r ≈ 0.25
//
// A team's estimated rating is already a measured quantity and needs nothing.
// But only about a fifth of a player's *estimated* separation from his own
// teammates survives as real separation — and the slope gets SMALLER (0.144)
// above 2000 MP, where the play-by-play side is least noisy, so this is
// miscalibration and not measurement error. Over half the variance in that
// deviation is just the player's stock rate (r = 0.75 vs (STL+ρ_D·BLK)/MP),
// which VA already pays out in its own Steals and Blocks categories.
//
// Left uncorrected the mismatch is an era effect, since θ is what mixes the
// two: pre-2000 seasons are all-estimate and modern ones ~75% play-by-play,
// so the same defender scored ~1.5× higher in the older era (p99 of dVA/G:
// 3.77 pre-2000 vs 2.49 since). So the estimate's within-team deviation is
// scaled onto the measured scale before it is used as the prior:
//
//   est* = teamEst + DEF_EST_CAL × (est − teamEst)
//
// DEF_EST_CAL is set by era parity rather than by the raw slope: at 0.50 the
// estimate-only era and the play-by-play era produce the same distribution of
// extremes (p99 ratio 1.03, max 1.29), which is the property that makes an
// all-time leaderboard comparable. The raw within-team slope (~0.19) treats
// the raw on-court rating as ground truth for individual defense; it isn't —
// teammates overlap, so on/off understates a lone anchor — and at that value
// pre-2000 defense collapses to noise and the tail inverts.
//
// Multi-team (2TM) rows and seasons with no team map have no team baseline to
// separate the two components, so they fall back to shrinking the deviation
// from the league line by DEF_EST_CAL_LG — the pooled slope measured on that
// same regression (0.646), which is just the two components above mixed in
// their observed variance shares (0.58 × 0.96 + 0.42 × 0.19 ≈ 0.65).
export const DEF_EST_CAL = 0.5;
export const DEF_EST_CAL_LG = 0.646;

// The box-score estimate rescaled onto the play-by-play scale, shrunk toward
// the player's own team line when there is one and the league line otherwise.
// Passes null through: a missing estimate stays missing.
export function calibratedEst(est, teamDrtg, laDRtg) {
  if (est == null) return null;
  return teamDrtg > 0
    ? teamDrtg + DEF_EST_CAL * (est - teamDrtg)
    : laDRtg + DEF_EST_CAL_LG * (est - laDRtg);
}

export function defVAInfo(row, viewMp, lgaX, defs, season, pref = "rs") {
  const ent = defRtgEntryFor(defs, season, row?.slug, pref);
  if (!ent || !lgaX || !(lgaX.laPOSSperM > 0) || !(lgaX.laPTSperPoss > 0) || !(viewMp > 0)) return null;
  const la = lgaX.laPTSperPoss * 100;
  const e = defs?.[season];
  const tmap = pref === "po" ? (e?.teamPo || e?.team) : (e?.team || e?.teamPo);
  const t = tmap?.[row?.team];
  // The prior is the CALIBRATED estimate, not the raw one, so the two sides of
  // the blend are on one scale (see DEF_EST_CAL). The team line it shrinks
  // toward is the same box-score team rating the IND term subtracts, and is
  // itself left alone — team ratings are already measured, slope 0.96.
  const est = calibratedEst(ent.est, t?.drtg, la);
  // Posterior weight on the PBP rating: poss / (poss + prior). Pure est when
  // no PBP sample exists (pre-2000, unbaked seasons, unjoined names); pure
  // PBP in the rare case the estimate is missing.
  const poss = row?.mp > 0 ? row.mp * lgaX.laPOSSperM : 0;
  const priorPoss = pref === "po" ? DEF_PBP_PRIOR_POSS_PO : DEF_PBP_PRIOR_POSS;
  const pbpW =
    ent.pbp != null && est != null ? poss / (poss + priorPoss)
    : ent.pbp != null ? 1
    : 0;
  const drtg = pbpW * (ent.pbp ?? 0) + (1 - pbpW) * (est ?? 0);
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
