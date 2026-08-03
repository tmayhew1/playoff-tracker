# Executive Summary — Technical & Ideological Portfolio

**Trey Mayhew** · Two NBA analytics systems, 2024 – present
`nba-projects` (R Shiny, Nov 2024) → `playoff-tracker` (Next.js + R pipeline, 2026)

---

## 1. The headline

Designed and built an original basketball valuation framework — **Value Added
(VA)** — that re-expresses every box-score contribution in a single unit,
*points produced above the league's typical minute*, and shipped it twice: first
as a public R Shiny application covering every NBA season since 1949-50, then as
a production web application with an automated data pipeline, a Bayesian
defensive layer, and shot-location analysis across 46 seasons. The work spans
the full stack of an analytics product: the metric's derivation, the statistical
methodology behind its baselines, the ingestion and reproducibility
infrastructure, and the interface that makes the number arguable rather than
merely displayed.

---

## 2. Ideological inventions — the theses the systems are built to defend

These are the opinionated positions that distinguish the work from an
off-the-shelf metric. Each is implemented, not merely asserted.

**1. Commensurability over composite scoring.** The prevailing choices are an
opaque single number (PER, BPM, Win Shares) or an array of stats the reader must
weight themselves — the first sacrifices interpretability, the second
decisiveness. VA takes a third path: convert every event into *points* using
only baselines the data themselves provide. The result is additive,
interpretable term by term, and decomposable at every level of aggregation.

**2. The right counterfactual is the minute, not the game or the position.**
Per-game comparison double-counts playing time; positional baselines import a
structural assumption the data do not require. VA asks a cleaner question: *you
played these minutes — what would the league have produced in them?*

**3. "Typical" and "value" are different measurements and must be computed
differently.** The baseline that defines a typical player is a
**minutes-weighted median** (skew-resistant, and weighted so a 40-minute call-up
cannot outvote a starter); the constants that convert an event into points are
league aggregates, because a possession is worth what the league actually scores
on it. Conflating the two is the most common quiet error in this class of
metric.

**4. Volume and efficiency are both real and must not be netted.** A high-usage
scorer at league efficiency has absorbed difficulty; a low-usage scorer at elite
efficiency has created surplus on every touch. VA pays each as a separate term.

**5. Era-locality is non-negotiable.** Every season is scored against its own
league; playoff runs are scored against their own season's regular-season
baselines. Cross-era comparison is earned by construction rather than asserted
by adjustment. The formula is portable to other populations (NCAA D-I); the
baselines never are.

**6. Credit should be earned, and blame should be escapable.** In the defensive
layer, a share of a team's collective edge flows to the players who actually
generate defensive events — and when a team defense is bad, the share of blame
*shrinks* with activity rather than growing. Both branches conserve the team's
total and meet continuously at zero.

**7. Belief should scale with evidence.** A defensive rating is a posterior, not
a reading: the box-score estimate is an informed prior worth a fixed number of
possessions, and real on-court data overtakes it in proportion to the
possessions a player actually logged.

**8. Absence is not zero.** Where a source has no data — shot location before
1996-97, on-court tracking before 2000-01 — the feature is withheld rather than
zero-filled, so a missing measurement can never read as below-average
performance.

---

## 3. Technical inventions

| Invention | What it is |
|---|---|
| **Value Added (VA)** | A ten-term linear valuation in points, each term of the form *(player rate − league rate) × opportunity × price*, with derived prices for assists ($\kappa(1-p_G)$), steals/blocks (possession value, blocks discounted by defensive-rebound rate), turnovers, and cross-weighted rebounds. |
| **Per-player rebound credit** | Each rebound is priced by what the player's own absence would cost: γ = 1/(1 − q), where q is his share of the boards available at his end. Derived from a Luce contest rather than fitted, computed without team data so identical production always scores identically, and reducing to the "one of five" constant 5/(5−ρ) at the league-average rate. |
| **Minutes-weighted median baselines** | A season baseline defined as the rate of the *median league minute* — the cumulative-minutes crossing point — rather than the aggregate mean or per-player median. |
| **Exact category decomposition** | The ten category terms sum to the headline to the decimal on every surface — leaderboard, compare header, stacked bars, percentiles, similarity vectors — enforced as a product invariant with a single shared source of truth. |
| **VA+ and the Bayesian D Rating** | A fifth, non-box-score defensive category: a possession-weighted posterior blend of box-score estimate and on-court play-by-play rating, split into an individual term (edge over own team) and an *earned-share* team term with a mirrored blame branch. |
| **Shot-zone value** | 2-point shooting valued separately at four distances against zone-specific league accuracy, so a rim finisher and a mid-range surgeon earn credit for different skills instead of one blended 2P%. |
| **Closest comps (cosine × magnitude)** | Player-season similarity as archetype match (cosine of the 10-dimensional per-game VA vector) times level match (magnitude ratio), gated on minutes role — plus a second lens over a 6-dimensional shooting profile gated on shot diet. |
| **Multi-era graceful degradation** | In v1, three nested formula variants selected by data availability, extending coverage to 1949-50 without penalizing players for events their era did not record. |
| **Draft scoring engine** | A live playoff-draft scoreboard: round-based points with an upset bonus paid on seed differential, linear in-series projection, and strict separation of real results from user speculation in parallel ledgers. |

**Position relative to prior art (stated honestly).** VA belongs to the
linear-weights family that includes Points Created and the possession logic
behind Win Shares. Its contribution is not the existence of weights but the
combination of: a points unit end to end, baselines constructed on two distinct
principles for two distinct jobs, an exact-decomposition guarantee treated as a
product requirement, and era-local baselines applied uniformly across regular
season, playoffs, and college.

---

## 4. Systems and engineering

**v2 — `playoff-tracker`** (Next.js 14 / React 18 / Tailwind on Vercel; R
ingestion; GitHub Actions)

- ~9,000 lines of application JavaScript across 15 feature modules and 11 API
  routes; ~2,300 lines of R across 9 ingestion scripts.
- **46 seasons baked to versioned JSON** (1979-80 → 2025-26): playoff and
  regular-season totals, per-game playoff logs, per-season league baselines,
  shooting splits, defensive ratings, and college — 172 data files, ~65 MB,
  reproducible from source at any time.
- **Five scheduled/dispatchable GitHub Actions bakes**, including a daily cron
  that re-bakes the live season, backfills gaps, and recomputes derived values
  so nothing can drift from the raw data.
- **Four upstream sources reconciled** (Basketball-Reference, the live NBA feed,
  pbpstats.com, Sports-Reference CBB), joined by stable ID where available and
  normalized name otherwise.
- **Defense-in-depth ingestion**: throttled scraping, layout-agnostic table
  discovery with ordered fallbacks, minimum-row assertions, and a plausibility
  gate that refuses to write a baseline outside its historically observed band —
  a mis-parsed page fails loudly instead of silently corrupting a season.
- **Dual-implementation parity**: the VA formula exists in R (bake) and
  JavaScript (client) and is held line-for-line equivalent, verified to the
  decimal against baked values.
- Delivered across **150+ reviewed pull requests**, each scoped to one behavioral
  change with the rationale recorded in the commit body.

**v1 — `nba-projects`** (R Shiny on shinyapps.io)

- ~4,300 lines of R; a six-tab analytics application — Player Comparison, Four
  Factors Comparison, Leaderboard, Game Lookup, Date Lookup, Career Comparison
  — backed by ten analysis modules covering season leaders, playoff splits,
  peak-season value breakdown, and player profiles.
- Season totals and shooting splits back to **1949-50**, with daily refresh.
- A **published methodology site** specifying the framework, every component
  formula, the tab-by-tab analytical guide, worked examples, the variable
  glossary, and an explicit limitations section.

---

## 5. Methods and practices worth naming

- **Specification-first metric design.** Every weight is derived from a stated
  model rather than fitted: the assist discount from the share of baskets that
  would not have fallen anyway, the block/steal asymmetry from whether the
  possession actually ends, the rebound credit from the odds of a
  lineup losing a board when a claimant who covers share *q* of the glass is
  removed — 1/(1 − *q*), read off the player's own line against a league
  opportunity rate, so it stays team-independent. Each derivation is
  recorded with its assumptions at the point of implementation, so a reader can
  critique the model instead of reverse-engineering the number.
- **Invariants as tests.** Decomposition exactness, season-locality, and
  source-fidelity coverage gating are stated as invariants the codebase must
  preserve, and divergences are treated as defects (one such: a 25% rebound
  discrepancy between two views, traced and reconciled across three
  computation sites).
- **Reproducibility over convenience.** Data is baked into the repository as
  versioned JSON rather than fetched live, making every published number
  auditable and every historical result re-derivable.
- **Documentation as product.** Both applications ship an in-product methodology
  surface written for a basketball-literate reader — the metric is meant to be
  argued with, which requires that it be legible.
- **Spec-driven AI-assisted development.** v2 was built in a
  one-change-per-PR workflow with agentic tooling under human review, with
  design rationale captured in commit history — an operating model for shipping
  a large surface area at high velocity without losing traceability.

---

## 6. Résumé bullets

> **NBA Value Added Framework** — *Independent analytics work, 2024 – present*
>
> - Designed **Value Added (VA)**, an original ten-component basketball
>   valuation metric expressing every box-score contribution in points above a
>   minutes-scaled league baseline; specified the full derivation, including a
>   minutes-weighted-median baseline construction that resists both star skew
>   and small-sample noise.
> - Shipped the framework as two public applications — an R Shiny app covering
>   every NBA season since **1949-50**, and a Next.js/React app covering **46
>   seasons** of regular-season, playoff, and NCAA D-I play — with per-category
>   decomposition, all-time percentile context, and similarity-based player
>   comparison.
> - Built an **automated R ingestion pipeline** across four data sources with
>   five scheduled GitHub Actions bakes, plausibility gating, and versioned
>   JSON output (172 files, ~65 MB), making every published figure reproducible
>   from source.
> - Extended the metric with **VA+**, a defensive layer that blends box-score
>   and play-by-play defensive ratings as a possession-weighted **Bayesian
>   posterior**, and attributes team defensive edge by an *earned share* model
>   that credits event generation and shrinks blame with activity.
> - Added **shot-location valuation** (four distance zones priced against
>   zone-specific league accuracy) and a **cosine × magnitude similarity engine**
>   matching player-seasons on both archetype and level within a comparable
>   minutes role.
> - Maintained an **exact-decomposition invariant** — ten category terms
>   reconcile to the headline metric to the decimal across every view — with the
>   formula implemented in parallel in R and JavaScript and verified for parity.
> - Delivered **150+ reviewed pull requests** in a one-change-per-PR workflow,
>   with design rationale and trade-offs recorded in commit history and a
>   published methodology document.

---

## 7. Scope at a glance

| | v1 — nba-projects | v2 — playoff-tracker |
|---|---|---|
| Started | Nov 2024 | Spring 2026 |
| Stack | R, Shiny, tidyverse, ggplot2, DT | Next.js 14, React 18, Tailwind, R, GitHub Actions, Vercel |
| Coverage | 1949-50 → present | 1979-80 → 2025-26 (46 seasons) + NCAA D-I |
| Code | ~4,300 lines R | ~9,000 lines JS + ~2,300 lines R |
| Data | 107 season CSVs, daily refresh | 172 baked JSON files (~65 MB), 5 automated bakes |
| Surfaces | 6 tabs + published methodology site | 5 top-level tabs (Explore → By Season / By Player / Compare, College, D Rating, Shot Zones, Info) + a tab per completed season |
| Sources | Basketball-Reference | Basketball-Reference, NBA live feed, pbpstats.com, Sports-Reference CBB |

---

*Companion document: [`value-added-spec.md`](./value-added-spec.md) (rendered:
[`value-added-spec.html`](./value-added-spec.html)) — the
formal mathematical specification of VA, VA+, zone value, similarity, and draft
scoring, including the v1 → v2 divergence table.*
