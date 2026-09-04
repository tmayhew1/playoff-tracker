// The D Rating math, kept free of React so the app and the calibration script
// share one implementation rather than two that can drift. app/lib/defense.js
// re-exports all of it and adds the client-side fetch hook;
// scripts/fit-def-calibration.mjs imports it directly to refit the constants
// below against the baked data.

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
// of evidence), updated by the actual on-court rating from basketball-
// reference's on-off pages (points allowed per 100 possessions while on the
// floor, 1996-97+) in proportion to the
// possessions the player really logged — see defRtgEntryFor and the pbpW
// weight below. Pre-1997 (and unbaked/unjoined) seasons are simply
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

// --- Calibrating the estimate onto the on-court scale ------------------------
// The blend above only means something if its two inputs measure the same
// thing at the same scale. They don't. Regressing the on-court rating on the
// box-score estimate across all 30 on-court seasons (RS, MP>=500,
// minute-weighted, through the origin) splits cleanly in two:
//
//   team component     (teamEst−L → teamOn−L):   slope 0.976, r = 0.988
//   individual part    (est−teamEst → on−teamOn): slope 0.198, r = 0.26
//
// A team's estimated rating is already a measured quantity and needs nothing.
// But only about a fifth of a player's *estimated* separation from his own
// team-mates survives as real separation — and the slope gets SMALLER with
// minutes (0.188 above 1000 MP, 0.160 above 2000, where the on-court side is
// least noisy), so this is miscalibration and not measurement error.
//
// Left uncorrected the mismatch is an era effect, since the posterior weight
// is what mixes the two: seasons before 1996-97 are all-estimate and modern
// ones ~75% on-court, so the same defender would score far higher in the older
// era. So the estimate's within-team deviation is scaled onto the measured
// scale before it is used as the prior:
//
//   est* = teamEst + DEF_EST_CAL × (est − teamEst)
//
// DEF_EST_CAL is set by era parity rather than by the raw slope: at 0.455 the
// estimate-only era and the on-court era produce the same p99 of dVA/G (ratio
// 1.000, max ratio 1.23), which is the property that makes an all-time
// leaderboard comparable. The raw within-team slope (~0.20) treats the raw
// on-court rating as ground truth for individual defence; it isn't —
// team-mates share possessions, so on/off understates a lone anchor — and at
// that value the older era collapses to noise and the tail inverts.
//
// The parity point is not invariant to the qualifying threshold: it fits at
// 0.479 for MP>=300, 0.455 at 500, 0.435 at 1000, 0.385 at 1500, because a
// higher floor trims the older era's tail faster than the modern one's. 500
// is the threshold the original fit used and the one quoted here; anyone
// re-running this should know the number moves.
//
// Multi-team (2TM) rows and seasons with no team map have no team baseline to
// separate the two components, so they fall back to shrinking the deviation
// from the league line by DEF_EST_CAL_LG — the pooled slope on that same
// regression (0.782, r = 0.830), which is the two components above mixed in
// their observed variance shares (0.75 × 0.976 + 0.25 × 0.198 ≈ 0.78). That
// share is the one number here that moved materially when the on-court source
// became basketball-reference's on-off rather than pbpstats' counted
// possessions: both now share a possession estimator with the box-score
// estimate, which tightens team-level agreement and pushes variance toward the
// team component. Neither component slope moved (0.96 → 0.976, ~0.19 → 0.198)
// — only the mix — so the shrink that matters most, the within-team one, is
// measured the same either way.
//
// Refit with: node --import ./scripts/node/register.mjs scripts/fit-def-calibration.mjs
export const DEF_EST_CAL = 0.455;
export const DEF_EST_CAL_LG = 0.782;

// --- Season coverage: how much of the team's season the player was there for -
// The team terms above — the line IND subtracts, and the edge vs league the
// team-share pays out — are properties of the team's WHOLE season. The player
// is only on the floor for part of it, and the counterfactual dVA is defined
// against is the team's defense over the possessions HE played, not over the
// 82 games the line was averaged from. For a player who dressed every night
// those are the same window and there is nothing to correct. For an 11-game
// player they are not: his team's season line is an estimate of his window
// carrying the full game-to-game spread of team defense, and paying it out at
// face value hands him a full season's worth of team context on a fortnight
// of evidence. (Zach Edey's 2025-26: 82% of his +7.9 net came from the team
// terms, on 11 games — which is what put an 11-game season 3rd all-time.)
//
// So the team terms are weighted by their own reliability. Reading the
// player's window as g of the team's G games, the season line misses the
// window's true level with variance sigma_g^2 (1/g - 1/G) — the finite-
// population form, exactly zero when g = G — against a between-team spread of
// tau^2, so the standard regression-to-the-mean weight is
//
//   teamW = tau^2 / (tau^2 + sigma_g^2 (1/g - 1/G))  =  g / (g + K (1 - g/G))
//
// with K = (sigma_g/tau)^2. Both scales are measured off this repo's own data:
// sigma_g = 11.5 pts/100 is the SD of a team's per-game defensive rating
// around its own mean (5,953 postseason games in history-*.json, scored at
// each season's pace), tau = 3.0 is the SD of team season ratings around
// their league line (1,292 team-seasons in def-ratings.json's team maps).
//
// The weight is a shrink toward the null, not a bias correction: a random
// window's expected level IS the season line. What it says is that a claim
// about one team-season is only worth what the sample supports, so the
// endpoints are the two forms this file already has — teamW = 1 is the
// team-aware branch unchanged (every full-season player, ~4,400 of the 19,387
// indexed seasons, moves by exactly nothing), and teamW -> 0 is the plain
// vs-league fallback the 2TM rows take, reached continuously instead of by a
// switch. Both the prior's anchor (calibratedEst) and the baseline IND
// subtracts ride the same weight, or the low-coverage end would hold a
// cup-of-coffee player to a bad team's line while crediting him against the
// league's.
export const DEF_TEAM_GAME_SD = 11.5;   // per-game team DRtg, SD around its own season
export const DEF_TEAM_SPREAD_SD = 3;    // team-season DRtg, SD around the league line
export const DEF_TEAM_COVERAGE_K =
  (DEF_TEAM_GAME_SD / DEF_TEAM_SPREAD_SD) ** 2; // ~14.7

// g of G games -> the weight the team terms carry. 1 (no shrink) whenever the
// coverage is unknown: seasons baked before the team maps carried games, and
// rows with no game count, keep the un-weighted behaviour.
export function teamCoverageW(games, teamGames) {
  if (!(games > 0) || !(teamGames > 0)) return 1;
  const f = Math.min(1, games / teamGames);
  return games / (games + DEF_TEAM_COVERAGE_K * (1 - f));
}

// The box-score estimate rescaled onto the play-by-play scale, shrunk toward
// the player's own team line when there is one and the league line otherwise.
// teamW slides between the two: the anchor and the slope it is shrunk by are
// both mixed by the coverage weight, so a full-season player gets the team
// form exactly and a cup of coffee gets the league form (see teamCoverageW).
// Passes null through: a missing estimate stays missing.
//
// `slopes` exists so scripts/fit-def-calibration.mjs can sweep the two
// constants through this exact function instead of a copy of it; every caller
// in the app leaves it alone and gets the baked values.
export function calibratedEst(est, teamDrtg, laDRtg, teamW = 1, slopes = null) {
  if (est == null) return null;
  const ind = slopes?.ind ?? DEF_EST_CAL;
  const lg = slopes?.lg ?? DEF_EST_CAL_LG;
  if (!(teamDrtg > 0)) return laDRtg + lg * (est - laDRtg);
  const anchor = teamW * teamDrtg + (1 - teamW) * laDRtg;
  const cal = teamW * ind + (1 - teamW) * lg;
  return anchor + cal * (est - anchor);
}

// One clause explaining the team line a tooltip is quoting, for the views that
// show it. Empty string above DEF_TEAM_NOTE_W, where the weighting moves the
// line by less than the tenth of a point the views print and the caveat would
// be noise — the math itself is continuous and has no such threshold.
export const DEF_TEAM_NOTE_W = 0.95;

export function teamLineNote(info, team) {
  if (!info || !(info.teamW < DEF_TEAM_NOTE_W) || info.teamSeasonDrtg == null) return "";
  return ` — ${team || "the team"} rated ${info.teamSeasonDrtg.toFixed(1)} across the season, carried at ${(info.teamW * 100).toFixed(0)}% for the share of it he played and the rest at the league line`;
}

export function defVAInfo(row, viewMp, lgaX, defs, season, pref = "rs", slopes = null) {
  const ent = defRtgEntryFor(defs, season, row?.slug, pref);
  if (!ent || !lgaX || !(lgaX.laPOSSperM > 0) || !(lgaX.laPTSperPoss > 0) || !(viewMp > 0)) return null;
  const la = lgaX.laPTSperPoss * 100;
  const e = defs?.[season];
  const tmap = pref === "po" ? (e?.teamPo || e?.team) : (e?.team || e?.teamPo);
  const t = tmap?.[row?.team];
  // How much of the team's season this player was actually present for — the
  // weight every team term below carries (see teamCoverageW). Rows carry games
  // as `g` (regular-season bakes) or `gp` (leaderboard/normalised rows).
  const teamW = teamCoverageW(row?.g ?? row?.gp, t?.g);
  // The prior is the CALIBRATED estimate, not the raw one, so the two sides of
  // the blend are on one scale (see DEF_EST_CAL). The team line it shrinks
  // toward is the same box-score team rating the IND term subtracts, and is
  // itself left alone — team ratings are already measured, slope 0.96 — up to
  // the coverage weight, which both sides ride together.
  const est = calibratedEst(ent.est, t?.drtg, la, teamW, slopes);
  // Posterior weight on the on-court rating: poss / (poss + prior). Pure est
  // when no on-court sample exists (pre-1997, unbaked seasons); pure on-court
  // in the rare case the estimate is missing.
  const poss = row?.mp > 0 ? row.mp * lgaX.laPOSSperM : 0;
  const priorPoss = pref === "po" ? DEF_PBP_PRIOR_POSS_PO : DEF_PBP_PRIOR_POSS;
  const pbpW =
    ent.pbp != null && est != null ? poss / (poss + priorPoss)
    : ent.pbp != null ? 1
    : 0;
  const drtg = pbpW * (ent.pbp ?? 0) + (1 - pbpW) * (est ?? 0);
  // The team baseline blends with the SAME weights so IND subtracts like from
  // like at both extremes (the on-court line and the box-score one count
  // possessions differently). Stock rates still come from the BR team map
  // (plain box stats, identical either way). Read off the scope the player's
  // own rating came from, so the two sides of IND are the same sample.
  const pbpTmap = ent.onScope ? e?.[teamOnCourtKey(ent.onScope)] : null;
  const pbpTeamDrtg = pbpW > 0 ? pbpTmap?.[row?.team] : null;
  // Blocks weigh what VA says they're worth: laDRBrate of a steal.
  const bw = lgaX.laDRBrate > 0 ? lgaX.laDRBrate : 1;
  const teamStockRate = t ? (t.stlpm || 0) + bw * (t.blkpm || 0) : 0;
  let net, w = null, teamDrtg = null, teamSeasonDrtg = null;
  if (t && t.drtg > 0 && teamStockRate > 0 && row.mp > 0) {
    teamSeasonDrtg = pbpTeamDrtg > 0 ? pbpW * pbpTeamDrtg + (1 - pbpW) * t.drtg : t.drtg;
    // The season line, weighted by how much of that season the player saw.
    // teamW = 1 leaves it untouched; teamW → 0 walks it to the league line,
    // where both terms below collapse into the plain vs-league fallback.
    teamDrtg = teamW * teamSeasonDrtg + (1 - teamW) * la;
    const edge = la - teamDrtg;
    const clampW = (v) => Math.max(DEF_TEAM_SHARE_MIN, Math.min(DEF_TEAM_SHARE_MAX, v));
    const ratio = (((row.stl || 0) + bw * (row.blk || 0)) / row.mp) / teamStockRate;
    const earned = clampW(DEF_TEAM_SHARE_BASE * ratio);
    w = edge >= 0 ? earned : clampW(2 * DEF_TEAM_SHARE_BASE - earned);
    net = (teamDrtg - drtg) + w * edge;
  } else {
    net = la - drtg;
  }
  return {
    dva: (net / 100) * lgaX.laPOSSperM * viewMp,
    drtg, w, teamDrtg, teamSeasonDrtg, teamW, laDRtg: la, pbpW,
  };
}


// The team on-court map for a scope — teamOn for the regular season,
// teamPoOn for the playoffs, the season-level companions to rsOn and poOn.
export function teamOnCourtKey(scope) {
  return scope === "po" ? "teamPoOn" : "teamOn";
}

// DRtg sources for a player-season, kept separate so defVAInfo can do the
// Bayesian blend: `pbp` is the on-court rating — what opponents actually
// scored per 100 possessions with him on the floor, off basketball-
// reference's on-off pages (rsOn/poOn, 1996-97 on) — and `est` is their
// box-score DRtg estimate. `pref` picks the sample ("po" for playoff views,
// "rs" otherwise) and the other side backstops it, so a player with only one
// sample still gets a rating. `onScope` reports which scope answered, because
// the team line defVAInfo subtracts has to be read from that same scope:
// subtracting a postseason team line from a regular-season player rating
// compares two different samples, which is what it used to do.
export function defRtgEntryFor(defs, season, slug, pref = "rs") {
  if (!defs || !season || !slug) return null;
  const e = defs[season];
  if (!e) return null;
  const other = pref === "po" ? "rs" : "po";
  let pbp = null, onScope = null;
  for (const scope of [pref, other]) {
    const v = e[scope + "On"]?.[slug];
    if (v != null) { pbp = v; onScope = scope; break; }
  }
  const est = e[pref]?.[slug] ?? e[other]?.[slug] ?? null;
  return pbp != null || est != null ? { pbp, est, onScope } : null;
}
