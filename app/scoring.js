// Scoring logic: points computation and Value Added (VA) player stat.

import { TEAMS, BRACKET, ROUND_BASE, ROUND_LABEL } from "./teams";
import LEAGUE_AVERAGES_DATA from "./data/league-averages.json";
import USAGE_MODEL_DATA from "./data/usage-model.json";

// League averages per season, used to compute Value Added. Keeping VA
// season-accurate matters for historical box scores (efficiency baselines
// drift year to year). Sourced from data/league-averages.json.
export const LEAGUE_AVERAGES = LEAGUE_AVERAGES_DATA;

// Default (current season) — keeps existing callers unchanged.
export const LGA = LEAGUE_AVERAGES["2025-26"];

// --- USG-ADJ: the usage-adjusted scoring baseline ---------------------------
// The scoring-volume term charges a player the league's per-minute scoring
// rate for the minutes he played: (PTS/MP − μ_PTS) · MP. μ_PTS is the same
// number for a 30%-usage guard and a play-finishing big, which is the whole
// point in the default view — VA pays for absorbing volume — and also its one
// blind spot: it never asks whether the volume was worth having.
//
// USG-ADJ answers that instead, by splitting the term rather than replacing
// it. Write PTS as efficiency × usage and price a used possession at what one
// returns at the league's median MINUTE of usage, ē = μ_PTS / ū (ū = `muUsg`,
// the minutes-weighted median of USG/MP, baked in data/usage-model.json).
// Then today's term splits exactly, with no residual:
//
//   (PTS/MP − μ_PTS)·MP  =  (PTS − ē·USG)  +  ē·(USG − ū·MP)
//                            └ efficiency ┘   └── volume ───┘
//
// — what he scored above the going rate on the possessions he used, and what
// he was worth for carrying more (or less) load than a typical minute. The
// mode pays the second half at VOLUME_CREDIT:
//
//   Points(λ) = efficiency + λ · volume
//
// which as a baseline is one line pivoting about the median-minute point
// (ū, μ_PTS): flat at λ = 1, which is plain VA to the decimal, and through
// the origin at λ = 0, which charges purely per possession used. Shipping at
// λ = ½, so a possession consumed is charged half of what the league gets for
// one and volume still pays — just not at face value.
//
// Two properties make it safe to bolt onto the existing engine:
//
//   • It is exactly linear. Baseline points = ē(1−λ)·USG + λ·μ_PTS·MP, so the
//     term is additive over games the way μ_PTS·MP is — a season's baseline
//     equals the sum of its games', and a multi-season blend
//     (lib/multi-season.js) reproduces the per-season sum exactly. Only γ is
//     non-linear, and it is untouched here.
//   • It is a refinement of the baseline it replaces, not a new one. Every
//     line in the family passes through the median-minute point, so the
//     median-usage player is scored identically at every λ and the dial
//     redistributes rather than re-levels.
//
// The regression that started this — PTS/MP ≈ a + b·(USG/MP), fit per season
// by scripts/fit-usage-model.mjs — is NOT what the mode charges. It is the
// evidence that the relationship is real (R² 0.90–0.94) and one of the
// candidates the Usage tab still plots; only ū is load-bearing here.
//
// The playmaking term gets the same treatment for the same reason — see the
// passing-half block below; adjusting only the scoring side does not price
// volume, it moves value from scorers to passers. Everything else in VA — the
// eight remaining categories, γ, VA+ — is unchanged. The model rides on the
// baseline object as `usgModel`, so any code path that already threads an
// `lga` through picks the mode up with no other change.
export const USAGE_MODELS = USAGE_MODEL_DATA.seasons || {};

// How much of the volume half the mode still pays (spec §4.6). 1 is plain VA,
// 0 charges purely per possession used; a half was chosen by reading the two
// ends against each other on real seasons — it keeps the volume scorers on top
// where they belong while pricing what the possessions returned. ONE dial, read
// by both the scoring and the passing half (§4.7): the two are the same
// question asked of two categories, and giving each its own λ would turn a
// principle into a pair of tuning knobs.
export const VOLUME_CREDIT = 0.5;

// Possessions a free-throw attempt uses: Hollinger's coefficient, the same one
// the possession estimate Π already uses (spec §1.2), so USG is denominated in
// the possessions π prices rather than in a private currency of its own. KEEP
// IN SYNC with FTA_W in scripts/fit-usage-model.mjs — a model fit to one weight
// and read at another is not a baseline.
export const USG_FTA_W = USAGE_MODEL_DATA.ftaWeight ?? 0.475;

// Possessions used by a stat line, the model's one regressor.
export const possUsed = (p) => (p?.fga || 0) + USG_FTA_W * (p?.fta || 0);

// --- The passing half of the same mode -------------------------------------
// The scoring-volume term is not the only one that pays for volume as such.
// The playmaking term charges μ_AST per MINUTE and pays every assist above it
// at face value, so re-denominating only the scoring side leaves the mode
// lopsided: it halves what a scorer earns for carrying load while leaving what
// a passer earns for carrying load untouched. Measured on the positive-VA pool,
// adjusting points alone lifts playmaking's share of a season from ~50% to
// ~62% (1980-81 through 2025-26, +11.7 points on average) — the mode was not
// pricing volume, it was moving value from scorers to passers.
//
// The fix is the same construction, not a new one. A scorer's volume is priced
// against the possessions he used; a passer's is priced against the possessions
// he ENDED WITH A PASS, made or lost:
//
//   CRT = AST + TOV
//
// — the successful half and the failed half, exactly as FGM/FGA split USG. Let
// c̄ (`muCrt`, baked alongside ū) be the minutes-weighted median of CRT/MP and
// ē_A = μ_AST / c̄ the assists one unit of that load returns at the league's
// median minute. Then the playmaking term splits exactly, with no residual, in
// the same two halves:
//
//   (AST/MP − μ_AST)·MP  =  (AST − ē_A·CRT)  +  ē_A·(CRT − c̄·MP)
//                            └ creation ──┘     └─── load ────┘
//
// — what he turned into baskets on the possessions he ran, and what he was
// worth for running more (or less) of them than a typical minute. Both halves
// are then priced at κ(1−p_G) as before, and the load half is paid at the SAME
// λ the scoring side uses. That matters: λ is not a second free parameter to
// tune until the board looks right. One dial — "how much of volume as such do
// we still pay for" — applied to both places volume is paid.
//
// Why CRT and not a fitted line. On the scoring side a regression is
// meaningful because PTS and USG are different quantities. Here AST sits on
// both sides of the equation, so a fitted slope would mostly recover that
// identity. Only the pivot point c̄ is needed, and it is a median like every
// other baseline in §1.2.
//
// The turnover appears twice — once in its own category, once as load here —
// and that is deliberate symmetry rather than an oversight: a missed shot
// already costs twice on the scoring side (the 2P/3P term charges the miss,
// and the attempt still raises USG and so the scoring baseline). A possession
// consumed and a possession lost are two different facts and VA has always
// paid for both.
//
// Evidence it corrects rather than over-corrects: with both halves adjusted,
// playmaking's share of the positive-VA pool averages 47.9% against standard
// VA's 49.9%, and is closer to standard VA than the points-only mode in all 46
// baked seasons. It lands back where the unadjusted metric had it instead of
// overshooting past it, which is the test that separates a correction from a
// thumb on the scale pointing the other way.
//
// A season with no turnovers in its source table (none is baked today; the
// backfill discussed under "Baseline coverage" below would be the first) makes
// CRT = AST, whence c̄ ≈ μ_AST, ē_A ≈ 1 and the creation half ≈ 0 — the term
// collapses back to the standard one at every λ rather than misreading. That is
// the right failure: no load measurement, no load adjustment.
//
// A degenerate check worth knowing: had the load been denominated in MINUTES
// (CRT := MP) the whole construction would collapse to μ_AST·MP at every λ, so
// it is a genuine re-denomination of the opportunity and not a rescaling of the
// price.
export const crtUsed = (p) => (p?.ast || 0) + (p?.tov || 0);

// --- Under review: a passing baseline that does not contain AST ------------
// The objection to CRT is real and worth stating plainly: a player's own
// assists sit in his own baseline, so each marginal assist raises the bar it
// has to clear. Under the shipped baseline he keeps 71% of one (see below).
// The alternative is to predict AST from a quantity he does not control by
// assisting — his turnover rate — so assists are credited at face value and a
// low-turnover passer is charged a lower bar:
//
//   λ_AST(λ) = ē_T(1−λ)·(TOV/MP) + λ·μ_AST,     ē_T = μ_AST / μ_TOV
//
// pivoting about (μ_TOV, μ_AST) exactly as the others do. It needs no bake at
// all: μ_TOV is already `laTOVperM` in league-averages.json.
//
// It is wired to the Usage tab only, and here is why it is not on the switch.
//
//   • It cannot restore the balance at ANY λ. Playmaking's share of the
//     positive-VA pool is 49.9% under standard VA and 61.5% under the
//     points-only mode. This baseline lands at 58.5% at λ=½ and 57.2% even at
//     λ=0, where it charges purely per turnover and grants no minute credit at
//     all. It recovers about a third of the gap and then stops, because the
//     players inflating that pool are elite precisely for having assists WITHOUT
//     turnovers — charging per turnover is designed not to touch them. In
//     1996-97 it returns Stockton (1061) to a tie with Jordan (1067), which is
//     the reading that prompted the whole exercise.
//   • TOV is weak evidence of playmaking load: minutes-weighted R² of AST/MP on
//     TOV/MP averages 0.288 over the 46 baked seasons and ranges 0.09 to 0.52,
//     drifting hard by era. CRT's is 0.951, the scoring side's 0.923. A baseline
//     built on it is charging players against a line that explains a third of
//     the variation.
//   • Not every turnover is a passing turnover. A centre's giveaways are
//     travels, offensive fouls and stripped post-ups; this baseline reads them
//     as evidence he was running the offense and raises his assist bar for it.
//
// And the property it is meant to fix is one the scoring side already has. A
// made 2-pointer raises USG by one, so the shipped scoring baseline pays a
// marginal make 73% of face value (71–75% across seasons); CRT pays a marginal
// assist 71% (67–74%). Being charged for the opportunity your own production
// consumed is the mechanism of the mode, not a defect specific to passing —
// and 71% is a discount, not a bound: assist value stays linear and unbounded
// under both.
export const tovLoad = (p) => (p?.tov || 0);

export function baselineAstTov(p, lga, lambda = VOLUME_CREDIT) {
  const mp = p?.mp || 0;
  if (!(lga?.laTOVperM > 0)) return (lga?.laASTperM || 0) * mp;
  const rate = lga.laASTperM / lga.laTOVperM;   // ē_T — assists per turnover
  return rate * (1 - lambda) * tovLoad(p) + lambda * lga.laASTperM * mp;
}

export function playmakingVATov(p, lga, lambda = VOLUME_CREDIT) {
  if (!(p?.mp > 0)) return 0;
  return ((p.ast || 0) - baselineAstTov(p, lga, lambda)) * lga.laPTSperMake * (1 - lga.laFG);
}

export const usageModelFor = (season) => USAGE_MODELS[season] || null;

// A season's baselines with the usage model attached (or the plain baselines
// back, when that season has no fit — a missing model must read as "mode
// unavailable here", never as a zero baseline; spec invariant 5). Cached so
// repeated calls return the SAME object: the client threads these through
// useMemo dependency lists, which compare by identity.
const usgAdjCache = new Map();

export function usgAdjLga(lga, season) {
  const model = usageModelFor(season);
  // A season fit before `muUsg` existed carries no pivot point, so the mode
  // has nothing to pivot on and the season stays on μ_PTS — absent, never a
  // wrong baseline (spec invariant 5).
  if (!lga || !(model?.muUsg > 0)) return lga;
  // `muCrt` may be absent on a model baked before the passing half existed. The
  // scoring half still applies; baselineAst falls back to μ_AST for that season
  // rather than pivoting on a missing number (spec invariant 5).
  if (!usgAdjCache.has(lga)) {
    usgAdjCache.set(lga, { ...lga, usgModel: model, volumeCredit: VOLUME_CREDIT });
  }
  return usgAdjCache.get(lga);
}

// The fitted line as a baseline in its own right — the λ ≈ 0 cousin the Usage
// tab plots and prices its USG and CAP columns against. Carries the model but
// no volume credit, which is what tells baselinePts to read a and b instead of
// pivoting. Not reachable from the switch; see spec §4.6.
const fittedCache = new Map();

export function fittedLineLga(season) {
  const lga = LEAGUE_AVERAGES[season], model = usageModelFor(season);
  if (!lga || !model) return lga || LGA;
  if (!fittedCache.has(lga)) fittedCache.set(lga, { ...lga, usgModel: model });
  return fittedCache.get(lga);
}

export const lgaForSeason = (season, usgAdj = false) => {
  const lga = LEAGUE_AVERAGES[season] || LGA;
  return usgAdj ? usgAdjLga(lga, season) : lga;
};

// The league's expected POINTS for this workload — the counterfactual the
// scoring-volume term subtracts. μ_PTS · MP normally; the fitted line's
// prediction, a·MP + b·USG, when the baseline carries a usage model.
export function baselinePts(p, lga) {
  const mp = p?.mp || 0;
  const m = lga?.usgModel;
  if (!m) return lga.laPTSperM * mp;
  // No volume credit on the baseline object means the fitted line itself (the
  // Usage tab's USG column); with one, the pivoting family the mode ships.
  const lam = lga.volumeCredit;
  if (lam == null) return m.a * mp + m.b * possUsed(p);
  const rate = m.muUsg > 0 ? lga.laPTSperM / m.muUsg : 0;
  if (!(rate > 0)) return lga.laPTSperM * mp;
  return rate * (1 - lam) * possUsed(p) + lam * lga.laPTSperM * mp;
}

// The scoring-volume category. One definition, shared by valueAddParts,
// valueAddByCategory and the two breakdown panels, so all four agree in both
// modes (spec invariant 1).
export function volumeVA(p, lga) {
  return (p?.pts || 0) - baselinePts(p, lga);
}

// The league's expected ASSISTS for this workload — the counterfactual the
// playmaking term subtracts, on the count scale (the κ(1−p_G) price is applied
// by the caller, as it always was). μ_AST · MP normally; the pivoting family
// above when the baseline carries a usage model with a `muCrt` in it.
export function baselineAst(p, lga) {
  const mp = p?.mp || 0;
  const m = lga?.usgModel, lam = lga?.volumeCredit;
  // No model, no credit (the Usage tab's fitted-line baseline, which is a
  // scoring construct only), or a model baked before muCrt existed: μ_AST · MP.
  if (!m || lam == null || !(m.muCrt > 0)) return lga.laASTperM * mp;
  const rate = lga.laASTperM / m.muCrt;      // ē_A — assists per unit of load
  return rate * (1 - lam) * crtUsed(p) + lam * lga.laASTperM * mp;
}

// The playmaking category, in points. One definition shared by valueAddParts,
// valueAddByCategory and the breakdown panels, so all of them agree in both
// modes (spec invariant 1) — the same contract volumeVA has for Points.
export function playmakingVA(p, lga) {
  if (!(p?.mp > 0)) return 0;
  return ((p.ast || 0) - baselineAst(p, lga)) * lga.laPTSperMake * (1 - lga.laFG);
}

// What USG-ADJ does to a VA total that was computed the standard way. The
// term is linear in MP and USG, so the two modes differ by a closed-form
// amount — which lets a row that arrives with `va` already baked (the playoff
// leaderboard route, the /api/players index) be converted without re-deriving
// the other nine categories from its box score.
// --- Under review: the same model with a ceiling ----------------------------
// A candidate third baseline, wired to nothing but the Usage tab: charge the
// fitted line OR the median minute, whichever is LOWER —
//
//   λ_Points = min( a + b·(USG/MP),  μ_PTS )
//
// so a player is never asked to clear a bar above the league's typical minute,
// and a low-usage player is not charged for scoring he was never given the
// possessions to do. Equivalently (and the identity is worth knowing when
// reading the tab) it is `max` of the two volume terms:
//
//   PTS − min(pred, μ)·MP  =  max( PTS − pred·MP,  PTS − μ·MP )
//
// which is why it can only ever raise a VA, never lower one: every player with
// pred ≥ μ scores exactly the standard number, and everyone else gains.
//
// Two properties differ from USG-ADJ and matter if it is ever promoted to the
// switch. It is continuous in usage (min of two continuous functions), so
// there is no cliff at the threshold — but it is NOT linear, so a season's
// baseline no longer equals the sum of its games' (a player whose game-level
// usage straddles μ picks a different branch game to game; measured on three
// playoff fields, season and Σgames diverge by 3.2 points on average and up to
// 34). The closed-form conversion `usgAdjDelta` relies on that linearity, so
// this baseline would need rows re-scored from the box score rather than
// re-priced.
export function cappedBaselinePts(p, lga) {
  const mp = p?.mp || 0;
  const m = lga?.usgModel;
  if (!m || !(mp > 0)) return (lga?.laPTSperM || 0) * mp;
  return Math.min(m.a + m.b * (possUsed(p) / mp), lga.laPTSperM) * mp;
}

export function cappedVolumeVA(p, lga) {
  return (p?.pts || 0) - cappedBaselinePts(p, lga);
}

// --- Under review: splitting the volume term, and the dial between them -----
// The scoring-volume term already contains both questions; it just answers
// them as one number. Write PTS as efficiency × usage —
//
//   PTS = ē·USG + (PTS − ē·USG),   ē = the points a possession used is worth
//
// — and pick ē so that the league's median minute breaks even, ē = μ_PTS / ū,
// where ū is the minutes-weighted median usage rate (`muUsg`, baked alongside
// the fit). Then the standard term splits EXACTLY, with no residual:
//
//   (PTS/MP − μ)·MP  =  (PTS − ē·USG)  +  ē·(USG − ū·MP)
//                        └ efficiency ┘   └── volume ───┘
//
//   efficiency  what he scored above the going rate on the possessions he used
//   volume      what he was worth for taking on more (or less) of the load
//                than a typical minute carries, priced at that same rate
//
// Neither half is new value: they sum to the number VA already prints. What
// they allow is paying them at different rates —
//
//   Points(λ) = efficiency + λ · volume
//
// — where λ = 1 is today's VA to the decimal, λ = 0 charges purely per
// possession used (no credit for absorbing load at all), and anything between
// is a partial credit. In baseline terms the family is one line pivoting about
// the median-minute point (ū, μ):
//
//   λ_Points(λ) = ē(1−λ)·(USG/MP) + λ·μ      per minute
//
// flat at λ = 1, through the origin at λ = 0. USG-ADJ is close to the λ = 0
// end (it fits its own slope and intercept rather than pivoting through the
// median point), and the capped candidate is a per-player choice between the
// λ = 0 line and the λ = 1 line rather than a fixed λ.
//
// Linear in MP and USG at every λ, so unlike the cap it keeps the additivity
// the rest of VA relies on.
export function usageSplit(p, lga) {
  const mp = p?.mp || 0;
  const m = lga?.usgModel;
  const mu = lga?.laPTSperM || 0;
  if (!m || !(m.muUsg > 0) || !(mp > 0)) return null;
  const rate = mu / m.muUsg;               // ē — points per possession used
  const eff = (p.pts || 0) - rate * possUsed(p);
  const vol = rate * (possUsed(p) - m.muUsg * mp);
  return { eff, vol, rate };
}

// The playmaking term's two halves, on the count scale — the passing mirror of
// usageSplit. `rate` is ē_A, the assists a unit of ball-handling load returns at
// the league's median minute. Null when the season carries no muCrt.
export function passingSplit(p, lga) {
  const mp = p?.mp || 0;
  const m = lga?.usgModel;
  const mu = lga?.laASTperM || 0;
  if (!m || !(m.muCrt > 0) || !(mp > 0)) return null;
  const rate = mu / m.muCrt;
  const eff = (p.ast || 0) - rate * crtUsed(p);
  const vol = rate * (crtUsed(p) - m.muCrt * mp);
  return { eff, vol, rate, price: lga.laPTSperMake * (1 - lga.laFG) };
}

// The playmaking term at a given credit λ, in points. Falls back to the
// standard term when the season carries no muCrt — "no dial here", not zero.
export function splitPlaymakingVA(p, lga, lambda = 1) {
  const s = passingSplit(p, lga);
  return s ? (s.eff + lambda * s.vol) * s.price : playmakingVA(p, { ...lga, usgModel: null });
}

// The volume term at a given credit λ. Falls back to the standard term when
// the season carries no model, so a missing fit reads as "no dial here".
export function splitVolumeVA(p, lga, lambda = 1) {
  const s = usageSplit(p, lga);
  return s ? s.eff + lambda * s.vol : volumeVA(p, { ...lga, usgModel: null });
}

// Both halves of the mode as a single closed-form correction to a standard VA.
// Each is a difference of baselines on its own count scale, so the assist half
// is converted to points here the same way the category is. A row must carry
// `ast` and `tov` for the passing half; every baked row does (leaderboard
// season rows and their per-game splits, /api/players season rows), and
// baselineAst reduces to μ_AST · MP for a season with no muCrt, which makes
// that half exactly zero rather than a wrong number.
export function usgAdjDelta(p, lga) {
  if (!lga?.usgModel || !(p?.mp > 0)) return 0;
  const pts = lga.laPTSperM * p.mp - baselinePts(p, lga);
  const ast = (lga.laASTperM * p.mp - baselineAst(p, lga)) * lga.laPTSperMake * (1 - lga.laFG);
  return pts + ast;
}

// --- Rebound credit (γ) -----------------------------------------------------
// A rebound is the one box-score event that is guaranteed to be allocated and
// rivalrous: every miss produces exactly one, and exactly one of the ten
// players on the floor gets it. So "would the team have gotten it anyway?" has
// a real answer, and it depends on how much of the glass this player himself
// covers. Under a Luce contest, if he claims a fraction q of the boards
// available at his end, removing him raises his team's chance of losing the
// possession by exactly 1/(1 − q) — so each of his boards is worth that much
// more than the flat possession-value discount implies.
//
// q needs no team data. Rebound opportunities at one end are a league quantity
// (laREBoppPerM, ~0.91/min), so q = (REB/MP) / laREBoppPerM straight off the
// player's own line. That keeps VA context-free: identical production always
// scores identically, whoever the other four are.
//
// The league-average player has q = 0.2ρ, giving γ = 1/(1 − 0.2ρ) = 5/(5 − ρ)
// — the "one of five" constant. That is also the fallback when a season
// predates the opportunity-rate bake. (The previous flat γ = 1.25 is this same
// expression in ODDS space, i.e. its ρ → 1 limit; see docs/value-added-spec.md
// §4.3.)
//
// Unshrunk by design, and clamped only to keep γ finite: a season is 1,400+
// opportunities (binomial error on γ under 1.5%), while a single game is ~32
// and swings hard — exactly as every other VA category does on one night's
// shooting. REB_Q_MAX bounds a short line's γ at 2.
export const REB_Q_MAX = 0.5;

export function reboundGamma(reb, mp, lga, rate) {
  const opp = lga?.laREBoppPerM;
  if (!(opp > 0) || !(mp > 0)) return 5 / (5 - rate);
  return 1 / (1 - Math.min(Math.max((reb / mp) / opp, 0), REB_Q_MAX));
}

// Returns the total Value Added plus its efficiency component
// (3·tpAdd + 2·twoAdd + ftAdd), so callers can aggregate either.
export function valueAddParts(p, lga = LGA) {
  const { mp, pts, ast, stl, blk, tov, drb, orb, tpm, tpa, fgm, fga, ftm, fta } = p;
  if (!mp || mp <= 0) return { va: 0, efficiency: 0 };
  const twoPm = fgm - tpm, twoPa = fga - tpa;
  const tpAdd = ((tpm / (tpa || 1)) - lga.la3P) * tpa;
  const twoAdd = ((twoPm / (twoPa || 1)) - lga.la2P) * twoPa;
  const ftAdd = ((ftm / (fta || 1)) - lga.laFT) * fta;
  const volume = volumeVA(p, lga);
  const efficiency = 3 * tpAdd + 2 * twoAdd + ftAdd;
  const astVal = playmakingVA(p, lga);
  const stlVal = ((stl / mp) - lga.laSTLperM) * mp * lga.laPTSperPoss;
  const blkVal = ((blk / mp) - lga.laBLKperM) * mp * lga.laPTSperPoss * lga.laDRBrate;
  const tovVal = -((tov / mp) - lga.laTOVperM) * mp * lga.laPTSperPoss;
  const drbVal = ((drb / mp) - lga.laDRBperM) * reboundGamma(drb, mp, lga, lga.laDRBrate) * mp * lga.laPTSperPoss * lga.laORBrate;
  const orbVal = ((orb / mp) - lga.laORBperM) * reboundGamma(orb, mp, lga, lga.laORBrate) * mp * lga.laPTSperPoss * lga.laDRBrate;
  return { va: volume + efficiency + astVal + stlVal + blkVal + tovVal + drbVal + orbVal, efficiency };
}

export function valueAdd(p, lga = LGA) {
  return valueAddParts(p, lga).va;
}

// Keys for the per-category VA breakdown. Order matches the row order in
// VABreakdown; kept here so the bake and UI share one source of truth.
export const VA_CATEGORY_KEYS = [
  "Points", "3-Pointers", "2-Pointers", "Free Throws",
  "Assists", "Steals", "Blocks", "Turnovers",
  "D Rebounds", "O Rebounds",
];

// Per-category VA from a single stat line. Matches `valueAddParts` exactly —
// including the per-player rebound credit γ (reboundGamma), which is part of
// the VA formula — so the ten categories always sum to the same VA the
// leaderboard shows.
export function valueAddByCategory(p, lga = LGA) {
  const { mp, pts, ast, stl, blk, tov, drb, orb, tpm, tpa, fgm, fga, ftm, fta } = p;
  if (!mp || mp <= 0) {
    return Object.fromEntries(VA_CATEGORY_KEYS.map((k) => [k, 0]));
  }
  const twoPm = fgm - tpm, twoPa = fga - tpa;
  const tpAdd = ((tpm / (tpa || 1)) - lga.la3P) * tpa;
  const twoAdd = ((twoPm / (twoPa || 1)) - lga.la2P) * twoPa;
  const ftAdd = ((ftm / (fta || 1)) - lga.laFT) * fta;
  return {
    "Points": volumeVA(p, lga),
    "3-Pointers": 3 * tpAdd,
    "2-Pointers": 2 * twoAdd,
    "Free Throws": ftAdd,
    "Assists": playmakingVA(p, lga),
    "Steals": ((stl / mp) - lga.laSTLperM) * mp * lga.laPTSperPoss,
    "Blocks": ((blk / mp) - lga.laBLKperM) * mp * lga.laPTSperPoss * lga.laDRBrate,
    "Turnovers": -((tov / mp) - lga.laTOVperM) * mp * lga.laPTSperPoss,
    "D Rebounds": ((drb / mp) - lga.laDRBperM) * reboundGamma(drb, mp, lga, lga.laDRBrate) * mp * lga.laPTSperPoss * lga.laORBrate,
    "O Rebounds": ((orb / mp) - lga.laORBperM) * reboundGamma(orb, mp, lga, lga.laORBrate) * mp * lga.laPTSperPoss * lga.laDRBrate,
  };
}

// --- Baseline coverage -------------------------------------------------
// Spec §9.5: a category the source does not carry must be ABSENT, never
// zero-filled — a missing measurement must not read as below-average
// performance. That invariant is currently violated in the data itself:
// league-averages.json carries entries back to 1970-71, but 1970-71 through
// 1972-73 have laDRBperM = laORBperM = laDRBrate = 0, because the NBA did not
// split rebounds into offensive and defensive until 1973-74.
//
// A zero baseline is not a harmless zero. With λ_DRB = 0 a player is credited
// his ENTIRE defensive rebounding rate as surplus; with ρ_D = 0 the block term
// is multiplied to nothing and the defensive-rebound price ρ_O becomes 1. The
// season would score, and score badly wrong, in silence.
//
// Nothing reads those three seasons today — there is no player data on disk
// before 1980-81 — so this is a guard for the backfill rather than a live bug.
// Any consumer scoring an arbitrary season should check coverage first.

const BASELINE_REQUIRES = {
  "Points": ["laPTSperM"],
  "2-Pointers": ["la2P"],
  "Free Throws": ["laFT"],
  "Assists": ["laASTperM", "laPTSperMake"],
  "Steals": ["laSTLperM", "laPTSperPoss"],
  "Blocks": ["laBLKperM", "laPTSperPoss", "laDRBrate"],
  "Turnovers": ["laTOVperM", "laPTSperPoss"],
  "D Rebounds": ["laDRBperM", "laDRBrate", "laPTSperPoss"],
  "O Rebounds": ["laORBperM", "laDRBrate", "laPTSperPoss"],
  // "3-Pointers" is deliberately absent. la3P = 0 is CORRECT for every season
  // before 1979-80: nobody attempted one, so 3PA = 0 and the term is exactly
  // zero however the baseline is set. A zero there is an era, not a gap.
};

// Which of the ten categories a season's baseline can actually price.
export function baselineCoverage(lga) {
  const measured = [], missing = [];
  for (const [cat, keys] of Object.entries(BASELINE_REQUIRES)) {
    (keys.every((k) => lga?.[k] > 0) ? measured : missing).push(cat);
  }
  if (measured.length === Object.keys(BASELINE_REQUIRES).length) measured.push("3-Pointers");
  return { measured, missing, complete: missing.length === 0 };
}

export const seasonBaselineComplete = (season) =>
  baselineCoverage(LEAGUE_AVERAGES[season]).complete;

// --- Shot-distance zones -----------------------------------------------
// basketball-reference's per-season Shooting page splits 2-point shots into
// four distance zones. Baked by scripts/R/fetch_shooting_splits.R into
// shooting-<season>.json (per-player z03m/z03a etc., merged onto a row's
// raw stats by /api/players) and league-averages.json's `zoneFG` key
// (RS-baseline rates per season, matching how la2P/la3P are already
// RS-baseline for both RS and playoff VA). Deliberately kept OUT of
// VA_CATEGORY_KEYS/valueAddByCategory — basketball-reference has no
// shot-location data before 1996-97, so folding zone VA into the core
// per-category vectors would punch holes in every earlier season's
// closest-comps shape and career totals. This is parallel, informational
// data: a zone breakdown under the 2-Pointers compare card and its own
// searchable "Shot Zones" view, never the existing VA/VA+ numbers.
export const ZONES = [
  { key: "z03", mKey: "z03m", aKey: "z03a", label: "0-3 ft" },
  { key: "z310", mKey: "z310m", aKey: "z310a", label: "3-10 ft" },
  { key: "z1016", mKey: "z1016m", aKey: "z1016a", label: "10-16 ft" },
  { key: "z16xp", mKey: "z16xpm", aKey: "z16xpa", label: "16 ft-3PT" },
];

// Points of value a zone's shooting adds vs. that zone's league-average FG%
// — the same shape as the `twoAdd` term in valueAddParts/valueAddByCategory,
// just parameterized per zone instead of the 2-point shot as a whole.
export function zoneShotValue(fgm, fga, leagueFgPct) {
  return 2 * ((fgm / (fga || 1)) - (leagueFgPct || 0)) * fga;
}

// True when a row carries any shot-distance zone data for its season/scope.
export function hasZoneData(r) {
  return ZONES.some((z) => (r?.[z.aKey] || 0) > 0);
}

// Per-game zone-VA vector (ZONES order), mirroring perGameVAVec's shape
// (app/page.js) but over the 4 shot-distance zones instead of the 10 box
// categories. Null when the row or that season's league averages have no
// zone data — callers hide the feature rather than show a bogus all-zero
// profile (same precedent as defVAInfo() returning null for VA+).
export function zoneVAVec(r, lga) {
  if (!lga?.zoneFG || !hasZoneData(r)) return null;
  const gp = r.gp || 1;
  return ZONES.map((z) => zoneShotValue(r[z.mKey] || 0, r[z.aKey] || 0, lga.zoneFG[z.key]) / gp);
}

// Per-game "shooting profile" vector for the closest-comps SHOOT metric: the
// 4 shot-distance zones plus 3-Pointers and Free Throws, in the same
// "points of value vs league average" units (valueAddByCategory already
// values a 3 at 3x a make-rate delta and a free throw at 1x — same shape as
// zoneShotValue's 2x for a 2-pointer — so this just appends them). A rim-
// running big and a movement shooter should NOT look similar just because
// their 2-point zone mix happens to match; 3-point volume/efficiency is
// often the single biggest differentiator of a "shooting profile" and was
// missing from the zone-only vector. Null under the same condition
// zoneVAVec is null (no shot-distance data for this row/season) — 3P/FT VA
// exists for virtually every season, but a shooting profile without shot-
// location context isn't what this vector is for.
export function shootProfileVec(r, lga) {
  const zv = zoneVAVec(r, lga);
  if (!zv) return null;
  const gp = r.gp || 1;
  const by = valueAddByCategory(r, lga);
  return [...zv, (by["3-Pointers"] || 0) / gp, (by["Free Throws"] || 0) / gp];
}

export function computeMatchups(winners) {
  const t = {};
  BRACKET.r1.forEach((s) => (t[s.id] = s.teams.slice()));
  const resolve = (id) => winners[id];
  BRACKET.r2.forEach((s) => (t[s.id] = s.from.map(resolve)));
  BRACKET.r3.forEach((s) => (t[s.id] = s.from.map(resolve)));
  BRACKET.r4.forEach((s) => (t[s.id] = s.from.map(resolve)));
  return t;
}

export function potentialPoints(winTeam, loseTeam, roundKey) {
  const base = ROUND_BASE[roundKey];
  const diff = winTeam.seed - loseTeam.seed;
  const bonus = diff > 0 ? diff : 0;
  return { base, bonus, total: base + bonus };
}

// Separates real results (from NBA feed) from user "what-if" speculation.
// - actualWins: { seriesId: { teamCode: wins } } derived from live games
// - actualWinners: { seriesId: teamCode } derived from series that clinched
export function computePoints(winners, gameWins, actualWins = {}, actualWinners = {}) {
  const matchups = computeMatchups(winners);
  const breakdown = { Spencer: [], Trey: [] };       // locked, actual series wins
  const whatIfClinched = { Spencer: [], Trey: [] };  // user-selected winners not yet real
  const projections = { Spencer: [], Trey: [] };     // in-progress, from actual wins
  const whatIfProj = { Spencer: [], Trey: [] };      // user-added wins beyond actual

  const rounds = [
    { key: "r1", series: BRACKET.r1 },
    { key: "r2", series: BRACKET.r2 },
    { key: "r3", series: BRACKET.r3 },
    { key: "r4", series: BRACKET.r4 },
  ];

  rounds.forEach(({ key, series }) => {
    series.forEach((s) => {
      const [a, b] = matchups[s.id] || [];
      if (!a || !b) return;

      const winCode = winners[s.id];
      const actualWinCode = actualWinners[s.id];
      const games = gameWins[s.id] || { [a]: 0, [b]: 0 };
      const actualGames = actualWins[s.id] || { [a]: 0, [b]: 0 };

      if (winCode) {
        // Series has a user-selected winner
        const winTeam = TEAMS[winCode];
        const loseCode = a === winCode ? b : a;
        const loseTeam = TEAMS[loseCode];
        if (!winTeam || !loseTeam) return;
        const { base, bonus, total } = potentialPoints(winTeam, loseTeam, key);
        const item = { round: ROUND_LABEL[key], roundKey: key, team: winTeam, opp: loseTeam, base, bonus, total };
        // Actual if real-life agrees; otherwise it's speculation
        if (actualWinCode === winCode) {
          breakdown[winTeam.owner].push(item);
        } else {
          whatIfClinched[winTeam.owner].push(item);
        }
      } else {
        // Series in progress — split wins into real vs. speculated
        [a, b].forEach((code) => {
          const team = TEAMS[code];
          const oppCode = code === a ? b : a;
          const opp = TEAMS[oppCode];
          if (!team || !opp) return;
          const userWins = games[code] || 0;
          const realWins = actualGames[code] || 0;
          if (userWins === 0) return;
          const { total } = potentialPoints(team, opp, key);

          // Real wins → in-progress projection
          if (realWins > 0) {
            projections[team.owner].push({
              round: ROUND_LABEL[key], roundKey: key, team, opp,
              gamesWon: realWins, total, projected: total * (realWins / 4),
            });
          }
          // User-added wins beyond real → what-if
          if (userWins > realWins) {
            whatIfProj[team.owner].push({
              round: ROUND_LABEL[key], roundKey: key, team, opp,
              gamesWon: userWins, realWins, total,
              projected: total * ((userWins - realWins) / 4),
            });
          }
        });
      }
    });
  });

  const totals = {
    Spencer: breakdown.Spencer.reduce((a, x) => a + x.total, 0),
    Trey: breakdown.Trey.reduce((a, x) => a + x.total, 0),
  };
  const realProjectedTotals = {
    Spencer: totals.Spencer + projections.Spencer.reduce((a, x) => a + x.projected, 0),
    Trey: totals.Trey + projections.Trey.reduce((a, x) => a + x.projected, 0),
  };
  const whatIfTotals = {
    Spencer: whatIfClinched.Spencer.reduce((a, x) => a + x.total, 0)
           + whatIfProj.Spencer.reduce((a, x) => a + x.projected, 0),
    Trey: whatIfClinched.Trey.reduce((a, x) => a + x.total, 0)
        + whatIfProj.Trey.reduce((a, x) => a + x.projected, 0),
  };
  const projectedTotals = {
    Spencer: realProjectedTotals.Spencer + whatIfTotals.Spencer,
    Trey: realProjectedTotals.Trey + whatIfTotals.Trey,
  };
  return {
    breakdown, whatIfClinched, projections, whatIfProj,
    totals, realProjectedTotals, projectedTotals, whatIfTotals,
    matchups,
  };
}
