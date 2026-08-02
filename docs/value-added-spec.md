# Value Added (VA) — Formal Specification

**Version 2 (playoff-tracker).** Supersedes the v1 definition shipped in
`nba-projects` (R Shiny); divergences between the two are itemized in §8.

Value Added answers one question in one unit:

> How many **points** did this player produce, above or below what the league
> would have produced in the same workload?

Everything below is stated in traditional mathematical notation. The
authoritative implementations are `app/scoring.js` (client), and
`scripts/R/scrape_common.R` (bake); the two are line-for-line equivalent and
agree to the decimal.

---

## 1. Notation

### 1.1 Player observation

A stat line — a game, a playoff run, or a season — is the vector

$$
x \;=\; \bigl(\mathrm{MP},\, \mathrm{G},\, \mathrm{PTS},\, \mathrm{AST},\, \mathrm{STL},\, \mathrm{BLK},\, \mathrm{TOV},\, \mathrm{DRB},\, \mathrm{ORB},\, \mathrm{FGM},\, \mathrm{FGA},\, \mathrm{3PM},\, \mathrm{3PA},\, \mathrm{FTM},\, \mathrm{FTA}\bigr)
$$

with two-point shooting derived rather than sourced:

$$
\mathrm{2PM} = \mathrm{FGM} - \mathrm{3PM}, \qquad
\mathrm{2PA} = \mathrm{FGA} - \mathrm{3PA}.
$$

$\mathrm{VA}(x) \equiv 0$ when $\mathrm{MP} \le 0$.

### 1.2 League baselines

For each season $y$, a baseline vector $\lambda(y)$ is computed once from that
season's *player* season-totals table and stored in
`app/data/league-averages.json`. Two families of quantity, computed two
different ways on purpose (§3):

**Per-minute rate baselines** (minutes-weighted medians — §2):

$$
\mu_{\mathrm{PTS}},\; \mu_{\mathrm{AST}},\; \mu_{\mathrm{STL}},\; \mu_{\mathrm{BLK}},\; \mu_{\mathrm{TOV}},\; \mu_{\mathrm{DRB}},\; \mu_{\mathrm{ORB}}
$$

**Conversion constants** (league aggregate ratios, over all players in season $y$):

$$
p_3 = \frac{\sum \mathrm{3PM}}{\sum \mathrm{3PA}},\qquad
p_2 = \frac{\sum \mathrm{2PM}}{\sum \mathrm{2PA}},\qquad
p_F = \frac{\sum \mathrm{FTM}}{\sum \mathrm{FTA}},\qquad
p_G = \frac{\sum \mathrm{FGM}}{\sum \mathrm{FGA}}
$$

$$
\Pi \;=\; \sum \mathrm{FGA} \;-\; \sum \mathrm{ORB} \;+\; \sum \mathrm{TOV} \;+\; 0.475 \sum \mathrm{FTA}
\qquad \text{(possessions; Hollinger estimator)}
$$

$$
\pi = \frac{\sum \mathrm{PTS}}{\Pi} \quad \text{(points per possession)}, \qquad
\kappa = \frac{\sum \mathrm{PTS}}{\sum \mathrm{FGM}} \quad \text{(points per made FG)}
$$

$$
\rho_D = \frac{\sum \mathrm{DRB}}{\sum \mathrm{TRB}}, \qquad
\rho_O = \frac{\sum \mathrm{ORB}}{\sum \mathrm{TRB}} = 1 - \rho_D
$$

$$
\nu \;=\; \frac{5\,\Pi}{\sum \mathrm{MP}} \quad \text{(possessions per on-court minute; } = \text{pace}/48\text{)}
$$

$\nu$ is used only by the defensive extension (§6). Because $\sum \mathrm{MP}$
counts *player* minutes (five per team-minute), the factor of 5 converts to
possessions per **team**-minute.

---

## 2. The minutes-weighted median

For $N$ players in season $y$ with stat totals $X_i$ and minutes $m_i > 0$, let
$r_i = X_i / m_i$ and let $(\cdot)$ denote the ordering $r_{(1)} \le r_{(2)} \le \dots \le r_{(N)}$.
Then

$$
\mu_X \;=\; r_{(k^\*)}, \qquad
k^\* \;=\; \min\Bigl\{\, k \;:\; \sum_{j \le k} m_{(j)} \;\ge\; \tfrac{1}{2}\sum_{j=1}^{N} m_j \,\Bigr\}.
$$

In words: **the rate of the median league minute.** Half of all NBA minutes are
played above $\mu_X$, half below.

*Why not the two obvious alternatives.* The minutes-weighted **mean** (the
league aggregate rate) is pulled upward by a handful of high-usage stars, so
"average" ends up describing nobody. The unweighted **per-player median** lets
a 40-minute call-up outvote a 2,800-minute starter. Weighting the median by
minutes fixes both: the baseline is the typical *minute of basketball*, which
is exactly the thing VA charges a player for consuming.

---

## 3. Why baselines are computed two ways

The per-minute baselines define **"typical"** — the counterfactual a player is
measured against — so they must be robust to skew, hence the weighted median.

The conversion constants ($\pi$, $\kappa$, $\rho_D$, $\rho_O$, $p_3$, $p_2$,
$p_F$, $p_G$) do not define "typical"; they **translate an event into points**.
A possession is worth the league's actual points-per-possession, not the median
player's. These stay aggregate ratios.

---

## 4. The master equation

Every one of the ten categories has the same shape:

$$
\boxed{\;
\mathrm{VA}(x,\lambda) \;=\; \sum_{c \,\in\, \mathcal{C}} \; w_c \,\bigl(r_c - \lambda_c\bigr)\, n_c
\;}
$$

$$
\text{(player rate} - \text{league rate)} \;\times\; \text{opportunity} \;\times\; \text{price in points}
$$

where $\mathcal{C}$ is the ten categories and each term supplies its own rate
$r_c$, baseline $\lambda_c$, opportunity $n_c$, and price $w_c$:

| $c$ | rate $r_c$ | baseline $\lambda_c$ | opportunity $n_c$ | price $w_c$ |
|---|---|---|---|---|
| Points (volume) | $\mathrm{PTS}/\mathrm{MP}$ | $\mu_{\mathrm{PTS}}$ | $\mathrm{MP}$ | $1$ |
| 3-Pointers | $\mathrm{3PM}/\mathrm{3PA}$ | $p_3$ | $\mathrm{3PA}$ | $3$ |
| 2-Pointers | $\mathrm{2PM}/\mathrm{2PA}$ | $p_2$ | $\mathrm{2PA}$ | $2$ |
| Free Throws | $\mathrm{FTM}/\mathrm{FTA}$ | $p_F$ | $\mathrm{FTA}$ | $1$ |
| Assists | $\mathrm{AST}/\mathrm{MP}$ | $\mu_{\mathrm{AST}}$ | $\mathrm{MP}$ | $\kappa\,(1 - p_G)$ |
| Steals | $\mathrm{STL}/\mathrm{MP}$ | $\mu_{\mathrm{STL}}$ | $\mathrm{MP}$ | $\pi$ |
| Blocks | $\mathrm{BLK}/\mathrm{MP}$ | $\mu_{\mathrm{BLK}}$ | $\mathrm{MP}$ | $\pi\,\rho_D$ |
| Turnovers | $\mathrm{TOV}/\mathrm{MP}$ | $\mu_{\mathrm{TOV}}$ | $\mathrm{MP}$ | $-\pi$ |
| D Rebounds | $\mathrm{DRB}/\mathrm{MP}$ | $\mu_{\mathrm{DRB}}$ | $\mathrm{MP}$ | $\gamma\,\pi\,\rho_O$ |
| O Rebounds | $\mathrm{ORB}/\mathrm{MP}$ | $\mu_{\mathrm{ORB}}$ | $\mathrm{MP}$ | $\gamma\,\pi\,\rho_D$ |

with the rebound credit constant

$$
\gamma = 1.25 .
$$

Attempt-denominators are guarded: $r_c \mathrel{:=} 0$ when $n_c = 0$, so an
unattempted category contributes exactly zero rather than $\mathrm{NaN}$.

### 4.1 Expanded form

$$
\begin{aligned}
\mathrm{VA} \;=\;
&\underbrace{\Bigl(\tfrac{\mathrm{PTS}}{\mathrm{MP}} - \mu_{\mathrm{PTS}}\Bigr)\mathrm{MP}}_{\text{scoring volume}}
\;+\; \underbrace{3\Bigl(\tfrac{\mathrm{3PM}}{\mathrm{3PA}} - p_3\Bigr)\mathrm{3PA}
\;+\; 2\Bigl(\tfrac{\mathrm{2PM}}{\mathrm{2PA}} - p_2\Bigr)\mathrm{2PA}
\;+\; \Bigl(\tfrac{\mathrm{FTM}}{\mathrm{FTA}} - p_F\Bigr)\mathrm{FTA}}_{\text{scoring efficiency}} \\[6pt]
&+\; \underbrace{\Bigl(\tfrac{\mathrm{AST}}{\mathrm{MP}} - \mu_{\mathrm{AST}}\Bigr)\mathrm{MP}\;\kappa\,(1-p_G)}_{\text{playmaking}}
\;+\; \underbrace{\Bigl(\tfrac{\mathrm{STL}}{\mathrm{MP}} - \mu_{\mathrm{STL}}\Bigr)\mathrm{MP}\,\pi
\;+\; \Bigl(\tfrac{\mathrm{BLK}}{\mathrm{MP}} - \mu_{\mathrm{BLK}}\Bigr)\mathrm{MP}\,\pi\,\rho_D}_{\text{defensive events}} \\[6pt]
&-\; \underbrace{\Bigl(\tfrac{\mathrm{TOV}}{\mathrm{MP}} - \mu_{\mathrm{TOV}}\Bigr)\mathrm{MP}\,\pi}_{\text{ball security}}
\;+\; \underbrace{\gamma\Bigl(\tfrac{\mathrm{DRB}}{\mathrm{MP}} - \mu_{\mathrm{DRB}}\Bigr)\mathrm{MP}\,\pi\,\rho_O
\;+\; \gamma\Bigl(\tfrac{\mathrm{ORB}}{\mathrm{MP}} - \mu_{\mathrm{ORB}}\Bigr)\mathrm{MP}\,\pi\,\rho_D}_{\text{rebounding}}
\end{aligned}
$$

### 4.2 Reading the weights

- **Assist.** An assist is worth the field goal it created, $\kappa$, times the
  share of those baskets that would *not* have happened without the pass,
  $(1 - p_G)$. Deliberately opinionated: it refuses to credit the passer for the
  league-baseline conversion the shooter would have managed anyway.
- **Steal vs. block.** A steal ends the possession outright, so it earns a full
  $\pi$. A block only ends it if the defense secures the carom — about $\rho_D$
  of the time — so it earns $\pi\rho_D$. The same asymmetry is reused verbatim
  in the defensive extension (§6.3).
- **Rebound cross-weighting.** A rebound is credited a possession discounted by
  the probability the team *would not* have gotten it anyway. Defensive boards
  are the common outcome, so they are scaled by the smaller $\rho_O$; offensive
  boards are rarer and scale by the larger $\rho_D$. $\gamma = 1.25$ is a
  calibration constant on the rebounding pair, flagged as a judgment call
  rather than a derivation.
- **Volume and efficiency are separate terms, not a net.** A high-usage scorer
  at league efficiency has done something real (absorbed difficulty); a
  low-usage scorer at elite efficiency has also done something real. Netting
  them erases both. VA pays for each.

### 4.3 Rate forms

$$
\mathrm{VA}/\mathrm{G} = \frac{\mathrm{VA}}{\mathrm{G}}, \qquad
\mathrm{VA}/36 = 36\,\frac{\mathrm{VA}}{\mathrm{MP}}
$$

---

## 5. Exact decomposition

The category vector is the summand of the master equation:

$$
\mathrm{VA}_c(x,\lambda) \;=\; w_c\,(r_c - \lambda_c)\,n_c,
\qquad
\sum_{c \in \mathcal{C}} \mathrm{VA}_c \;=\; \mathrm{VA} .
$$

This identity is a **product requirement**, not a happy accident: every UI
surface — leaderboard total, compare-panel header, stacked category bars,
percentile context, comp-shape vectors — is computed from the same ten terms,
so the parts always reconcile to the headline to the decimal.

The per-game category vector used downstream (§7) is

$$
v(x) \;=\; \left(\frac{\mathrm{VA}_c(x,\lambda)}{\mathrm{G}}\right)_{c \in \mathcal{C}} \;\in\; \mathbb{R}^{10}.
$$

---

## 6. VA+ — the defensive extension

Box-score defense is two events wide. VA+ adds a fifth category built from
*points actually allowed*.

### 6.1 Bayesian rating

Each player-season carries two defensive ratings: $D_{\text{est}}$, the
box-score estimate, and $D_{\text{pbp}}$, points allowed per 100 possessions
while on the floor (play-by-play, 2000-01+). With defended possessions
$\;\Pi_p = \mathrm{MP}\cdot\nu\;$ and prior strength $\Pi_0$,

$$
\theta \;=\; \frac{\Pi_p}{\Pi_p + \Pi_0}, \qquad
\hat{D} \;=\; \theta\,D_{\text{pbp}} \;+\; (1-\theta)\,D_{\text{est}},
\qquad
\Pi_0 = \begin{cases} 1500 & \text{regular season} \\ 500 & \text{playoffs} \end{cases}
$$

The estimate is an *informed prior worth $\Pi_0$ possessions of evidence*; real
possessions overtake it as they accrue. A full-time starter lands ~75% on
play-by-play; a 300-minute season stays mostly prior — which is what stops a
small-sample on-court fluke from topping the leaderboard. The lighter playoff
prior reflects both the smaller samples available and the noisier estimate
behind them. Seasons with no play-by-play source are simply all-prior
($\theta = 0$).

The team baseline $\hat{T}$ blends with the **same** $\theta$, so the individual
term below subtracts like from like.

### 6.2 Net rating

With league line $L = 100\pi$ and team edge $E = L - \hat{T}$:

$$
\mathrm{net} \;=\; \underbrace{\bigl(\hat{T} - \hat{D}\bigr)}_{\text{IND: edge over his own team}} \;+\; \underbrace{w\,E}_{\mathrm{TM}^+:\ \text{share of the team's edge vs. league}}
$$

### 6.3 The earned share

Splitting team defense five ways equally credits a passenger like an anchor.
The share is instead *earned*, with stocks priced exactly as VA prices them
(a block is worth $\rho_D$ of a steal):

$$
s \;=\; \frac{\mathrm{STL} + \rho_D\,\mathrm{BLK}}{\mathrm{MP}}, \qquad
w_e \;=\; \mathrm{clamp}\!\left(0.2\,\frac{s}{s_{\text{team}}},\; 0.05,\; 1\right)
$$

$$
w \;=\;
\begin{cases}
w_e, & E \ge 0 \quad \text{(credit is \textbf{earned})} \\[4pt]
\mathrm{clamp}\bigl(0.4 - w_e,\; 0.05,\; 1\bigr), & E < 0 \quad \text{(blame \textbf{shrinks} with activity)}
\end{cases}
$$

The bad-defense branch is the earned share mirrored around the 1-in-5 split:
contesting shields you from a collective failure, passivity draws more of it.
Both branches conserve the team pot up to the clamps and are continuous at
$E = 0$. Multi-team rows fall back to the plain vs-league form ($w = 1$).

### 6.4 Defensive value

$$
\mathrm{dVA} \;=\; \frac{\mathrm{net}}{100}\;\nu\;\mathrm{MP},
\qquad
\boxed{\;\mathrm{VA}^{+} \;=\; \mathrm{VA} \;+\; \mathrm{dVA}\;}
$$

$\mathrm{VA}^{+}$ is undefined (and hidden) when neither rating source exists.

---

## 7. Derived instruments

### 7.1 Shot-zone value (1996-97+)

For zone $z \in \{\text{0-3}, \text{3-10}, \text{10-16}, \text{16 ft-3PT}\}$ with
league zone accuracy $p_z$ — the 2-point term of §4, parameterized by distance:

$$
\mathrm{VA}_z \;=\; 2\Bigl(\tfrac{M_z}{A_z} - p_z\Bigr) A_z
$$

Held deliberately **outside** $\mathcal{C}$: shot-location data begins in
1996-97, and folding it into the core vector would punch holes in every earlier
season's decomposition and career totals.

### 7.2 Closest comps

For player-seasons $a, b$ with vectors $v(a), v(b)$ (§5):

$$
\mathrm{cos}(a,b) = \frac{\langle v(a), v(b)\rangle}{\lVert v(a)\rVert\,\lVert v(b)\rVert},
\qquad
\mathrm{mag}(a,b) = \frac{\min\bigl(\lVert v(a)\rVert, \lVert v(b)\rVert\bigr)}{\max\bigl(\lVert v(a)\rVert, \lVert v(b)\rVert\bigr)}
$$

$$
S(a,b) \;=\; \mathrm{cos}(a,b)\cdot \mathrm{mag}(a,b)
$$

Cosine matches **archetype** (the shape of the value), magnitude matches
**level** (how much of it). Admissible only under
$\lvert \mathrm{MPG}_a - \mathrm{MPG}_b \rvert \le 7$ (same minutes role),
$\mathrm{G} \ge 8$, and $\mathrm{cos} \ge 0.3$ (a clearly different archetype is
never a comp). The **Shooting** lens applies the identical
$\mathrm{cos}\times\mathrm{mag}$ form to the 6-dimensional profile
(4 zones + 3-Pointers + Free Throws), additionally gated on shot diet: writing
$\delta(x) = \mathrm{3PA}/\mathrm{FGA}$ for the share of a player's field-goal
attempts taken from three, a comp is admissible only when
$\lvert \delta(a) - \delta(b) \rvert \le 0.15$. Without that gate, two players
with identical (zero) 3-point *impact* read as shooting twins even when one
lives at the rim and the other is a high-volume league-average bomber.

### 7.3 Draft scoring (the app's origin)

Sixteen playoff teams are drafted eight apiece. For a won series in round $r$
with base $B = (1, 2, 4, 8)$ for rounds 1–4:

$$
P_{\text{series}} \;=\; B_r \;+\; \max\bigl(0,\; \sigma_{\text{winner}} - \sigma_{\text{loser}}\bigr)
$$

(the seed differential pays only on an upset), and a live series projects
linearly in games won:

$$
\hat{P}_{\text{series}} \;=\; P_{\text{series}} \cdot \frac{\text{games won}}{4},
$$

with real results and user "what-if" speculation accumulated in separate
ledgers so the two are never confused.

---

## 8. v1 → v2 divergences

`nba-projects` (R Shiny, 2024) established the framework; `playoff-tracker`
(2026) revised it. Numbers from the two apps are **not** interchangeable.

| | v1 — nba-projects | v2 — playoff-tracker |
|---|---|---|
| Per-minute baseline | unweighted median across players | **minutes-weighted** median (§2) |
| Possessions | $\mathrm{2PA}+\mathrm{3PA}+\mathrm{TOV}+\mathrm{FTA}/2.1$; pre-1973 imputed by OLS on $\mu_{\mathrm{PTS}},\mu_{\mathrm{TRB}}$ | Hollinger: $\mathrm{FGA}-\mathrm{ORB}+\mathrm{TOV}+0.475\,\mathrm{FTA}$ |
| Rebound constant | $\gamma = 1$ | $\gamma = 1.25$ |
| Coverage | 1949-50+, via three nested variants ($\mathrm{VA}_1$ full; $\mathrm{VA}_2$ drops TOV for 1974-77; $\mathrm{VA}_3$ drops TOV/STL/BLK and estimates rebound splits for 1952-73), selected by `coalesce()` | 1979-80+, single variant, complete box score |
| Playoffs | separate tab | first-class scope, scored against that season's **regular-season** baselines |
| Defense | box-score events only | $\mathrm{VA}^{+}$ (§6) |
| Shot location | Four Factors visuals | zone VA + Shooting comps (§7.1–7.2) |
| Non-NBA | — | NCAA D-I on college-derived baselines |

---

## 9. Invariants the implementation must preserve

1. $\sum_c \mathrm{VA}_c = \mathrm{VA}$, to the decimal, on every surface.
2. Baselines are **season-local**: a 1987 season is scored against 1987, never
   against today. Playoff runs use their own season's regular-season baselines,
   so October and June are the same currency.
3. Non-NBA populations get **their own** $\lambda$; the formula is portable, the
   baselines are not.
4. A season is scored by one $\lambda(y)$ from one source table; a plausibility
   gate ($0.33 < \mu_{\mathrm{PTS}} < 0.52$) refuses to write a baseline derived
   from a mis-parsed page.
5. Any category the source does not carry is **absent**, never zero-filled — a
   missing measurement must not read as below-average performance.
