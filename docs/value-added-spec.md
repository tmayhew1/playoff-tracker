# Value Added (VA) — Formal Specification

**Version 2 (playoff-tracker).** Supersedes the v1 definition shipped in
`nba-projects` (R Shiny); divergences between the two are itemized in §8.

> **Rendered version: [`value-added-spec.html`](./value-added-spec.html).** This
> Markdown file uses LaTeX blocks, which only render where a viewer supports
> KaTeX/MathJax (GitHub's web UI does; most editors and previewers do not). The
> HTML companion renders identical notation in plain HTML + CSS — no external
> scripts, fonts, or stylesheets — so it displays anywhere a browser opens it.

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

$$
\Lambda \;=\; \frac{5 \sum \mathrm{TRB}}{\sum \mathrm{MP}} \quad \text{(rebound opportunities per on-court minute, at one end)}
$$

$\Lambda$ is used only by the rebound credit (§4.3) and $\nu$ only by the
defensive extension (§6). Because $\sum \mathrm{MP}$
counts *player* minutes (five per team-minute), the factor of 5 converts to
possessions per **team**-minute.

---

## 2. The minutes-weighted median

For $N$ players in season $y$ with stat totals $X_i$ and minutes $m_i > 0$, let
$r_i = X_i / m_i$ and let $(\cdot)$ denote the ordering $r_{(1)} \le r_{(2)} \le \dots \le r_{(N)}$.
Then

$$
\mu_X \;=\; r_{(k^{*})}, \qquad
k^{*} \;=\; \min\Bigl\{\, k \;:\; \sum_{j \le k} m_{(j)} \;\ge\; \tfrac{1}{2}\sum_{j=1}^{N} m_j \,\Bigr\}.
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

where the rebound credit $\gamma$ is **per-player**, not a constant — it is the
one price that depends on the player's own rate as well as the league's. See
§4.3.

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
  boards are rarer and scale by the larger $\rho_D$. $\gamma = 5/4$ is not a
  fitted constant — it is the "one of five claimants" correction derived in
  §4.4.
- **Volume and efficiency are separate terms, not a net.** A high-usage scorer
  at league efficiency has done something real (absorbed difficulty); a
  low-usage scorer at elite efficiency has also done something real. Netting
  them erases both. VA pays for each.

### 4.3 The rebound credit $\gamma$

$\gamma$ answers a question the other nine terms never have to ask: **a rebound
is the one box-score event that is guaranteed to be allocated and rivalrous.**
Every miss produces exactly one rebound, and exactly one of ten players on the
floor gets it. So "would this have happened anyway?" has a real answer.

**The contest.** Under a Luce/Bradley–Terry model, give each of the five
defenders a claim weight $d$ and each of the five offensive players a claim
weight $o$. Then $\mathbb{P}(\text{defense secures}) = 5d/(5d+5o) = \rho_D$, and
the team's securing **odds** are $\Omega = \rho_D/\rho_O = d/o$. Remove one of
the five defenders and $\Omega' = 4d/5o = \tfrac{4}{5}\Omega$, so the odds of
*losing* the possession rise by exactly $5/4$ — independent of $\rho$, of era,
and of which team is rebounding.

**But VA multiplies a probability, not an odds**, and the two differ. Working in
probability space, and generalizing off the "exactly one fifth" assumption to a
player who claims a fraction $q$ of the boards available at his end:

$$
\boxed{\;\gamma \;=\; \frac{1}{1-q}\;}
\qquad
q \;=\; \frac{\mathrm{REB}/\mathrm{MP}}{\Lambda}
$$

where $\Lambda$ is the season's **rebound opportunity rate** — chances per
on-court minute at one end:

$$
\Lambda \;=\; \frac{5\sum \mathrm{TRB}}{\sum \mathrm{MP}}
\qquad (\texttt{laREBoppPerM};\ 0.9071 \text{ in } 2025\text{-}26)
$$

Every miss is rebounded at one end or the other, so a player on the floor sees
$\Lambda$ chances per minute at his own end. The construction is self-checking:
$d/(d+o)$ recomputed from these same sums returns $\rho_D$ exactly.

**$\rho$ cancels out of the correction.** Substituting $q = s\rho$ (where $s$ is
the player's share of his *team's* boards) into $1/(1-s\rho)$ gives the same
expression with no $\rho$ in it. $\rho$ still prices the board — $\pi\rho_O$ for
a defensive rebound, $\pi\rho_D$ for an offensive one — but it plays no part in
the credit. One formula covers both ends.

**It needs no team data.** $\Lambda$ is a league quantity, so $q$ comes straight
off the player's own line. This matters: every other VA term reads only the
player's stat line and league baselines, which is what makes a 1987 season
comparable to a 2026 one. A team-relative $\gamma$ would break that — measured
on 2025-26, players inside a narrow DRB/min band saw 5–7% $\gamma$ swings from
teammates alone, so identical production would have scored differently on
different rosters. It doesn't here.

**Special cases.** The league-average rebounder has $q = 0.2\rho$, giving

$$
\gamma = \frac{1}{1-0.2\rho} = \frac{5}{5-\rho}
\;\;\Longrightarrow\;\;
\gamma_{\mathrm{DRB}} \approx 1.174,\quad \gamma_{\mathrm{ORB}} \approx 1.053
$$

— the "one of five" constant, and the fallback for any season baked before
$\Lambda$ existed. The **odds-space** $5/4 = 1.25$ that VA shipped through
July 2026 is the $\rho \to 1$ limit of that expression: correct as an odds
ratio, but used as though it were a probability, which overstated defensive
credit ~6% and offensive credit ~19%. At the top of the distribution the
per-player form runs the other way — a player covering a third of his end
reaches $\gamma \approx 1.5$.

**Estimation.** $q$ is unshrunk by design, matching every other VA category
(none of which is shrunk). A season is 1,400–2,300 opportunities, putting
binomial error on $\gamma$ under 1.5%; a single game is ~32 and swings hard,
exactly as one night's shooting does in the efficiency terms. $q$ is clamped to
$[0, 0.5]$ so $\gamma \le 2$ stays finite on 1-minute garbage-time lines — the
only rows where the clamp ever binds.

### 4.4 What $\gamma$ assumes

Three assumptions remain, each a place the model could still be wrong.

1. **Independence of irrelevant alternatives.** Removing a claimant
   redistributes his share proportionally across the other nine. Real rebounding
   is closer to matched pairs — the opposing big absorbs most of a removed
   center's share, not the floor uniformly.
2. **A league-uniform opportunity rate.** $\Lambda$ is a league constant, but
   the boards available at a given player's end depend on his team's pace and
   his opponents' shooting. Using the team's own rate instead moves $\gamma$ by
   a median of 0.74% (p90 2.11%, $r = 0.985$) — less than the binomial noise
   already in $q$, and it would cost the context-freedom above. Deliberately
   traded away.
3. **The marginal board is an average board.** $q$ counts an uncontested carom
   the same as a won contest, and most defensive rebounds are uncontested. The
   boards a strong rebounder adds are drawn from the contested tail, where
   recovery risk is far above $\rho_O$ — which argues every $\gamma$ here is
   *understated* for players who actually box out. This is the one objection no
   version of the model addresses; closing it needs contested-rebound data the
   box score does not carry.

One interaction is worth flagging: $\mu_{\mathrm{DRB}}$ (minutes-weighted
median) sits ~11% below the league aggregate rate because rebounding is
right-skewed and positionally concentrated. The median baseline already tilts
this term toward bigs, and $\gamma$ widens the same spread. Separately, the
league earns roughly **1.8× more positive VA from offensive rebounds than
defensive ones** — an artifact of two similarly-sized populations of
over-performers being paid at $\rho_D/\rho_O \approx 2.85$ different rates. That
is a baseline question, not a $\gamma$ question, and it remains open.

### 4.5 Rate forms

$$
\mathrm{VA}/\mathrm{G} = \frac{\mathrm{VA}}{\mathrm{G}}, \qquad
\mathrm{VA}/36 = 36\,\frac{\mathrm{VA}}{\mathrm{MP}}
$$

### 4.6 USG-ADJ — the usage-adjusted scoring baseline

An optional reading of the **scoring-volume term only**, selected by a switch in
the app (Explore and the season tabs). Everything else in §4 is unchanged.

**The gap it closes.** The volume term charges $\mu_{\mathrm{PTS}}$ per minute
to a 32%-usage guard and a play-finishing centre alike. That is deliberate
(§4.2, *volume and efficiency are separate terms*) — absorbing possessions is
real work — but the term never asks the other question: *was the volume worth
having?* USG-ADJ asks that one instead.

**Usage.** Possessions used by a stat line:

$$
\mathrm{USG} \;=\; \mathrm{FGA} \;+\; 0.475\,\mathrm{FTA}.
$$

$0.475$ is Hollinger's free-throw coefficient — the same one the possession
estimate $\Pi$ uses in §1.2. Sharing it is deliberate: $\mathrm{USG}$ is then
denominated in the possessions $\pi$ already prices, not in a second private
currency. It is the player-side half of $\Pi$, minus the turnovers (a turnover
is a possession used, but it produces no shot, and it is already paid for in its
own category).

**The model.** For each season $y$, over **every** player-season $i$ in that
season's regular-season table, with minutes $m_i$ as weights:

$$
(\hat a_y, \hat b_y) \;=\; \arg\min_{a,b} \sum_i m_i \left(\frac{\mathrm{PTS}_i}{m_i} - a - b\,\frac{\mathrm{USG}_i}{m_i}\right)^{\!2}
$$

fit by `scripts/fit-usage-model.mjs` into `app/data/usage-model.json`. The
scoring-volume term then reads

$$
\mathrm{VA}_{\text{Points}}^{\,\mathrm{USG}} \;=\; \mathrm{PTS} \;-\; \bigl(\hat a_y\,\mathrm{MP} \;+\; \hat b_y\,\mathrm{USG}\bigr)
\qquad\text{in place of}\qquad
\bigl(\tfrac{\mathrm{PTS}}{\mathrm{MP}} - \mu_{\mathrm{PTS}}\bigr)\mathrm{MP}.
$$

**Why the fit is per season and minutes-weighted.** Per season because the
league scored $\pi = 0.845$ points per possession in 1970-71 and $1.117$ in
2024-25: one pooled line would hand every modern player a surplus and every
older one a deficit, which is invariant 2 broken by construction. Playoff runs
use their own season's regular-season fit, exactly as $p_2,p_3,\mu_{\mathrm{PTS}}$
already do. Minutes-weighted for the reason §2 gives, one level up: the line
describes the median *minute*, not the median roster spot. The skew argument
that made $\mu_{\mathrm{PTS}}$ a median rather than a mean does **not** carry
over — what skewed that mean was precisely the high-usage stars, and usage is
now a regressor rather than an omitted variable.

**Two properties that make it safe to bolt on.**

1. **Linearity.** The baseline is $\hat a\,\mathrm{MP} + \hat b\,\mathrm{USG}$,
   linear in both, so the term is additive over games exactly as
   $\mu_{\mathrm{PTS}}\mathrm{MP}$ is: a season's baseline is the sum of its
   games', and the volume-weighted blend a multi-season selection uses
   (`lib/multi-season.js`) reproduces the per-season sum with no drift —
   $\hat a^{*}$ weighted by MP and $\hat b^{*}$ by USG. It also gives a closed
   form for converting a VA that was computed the standard way,
   $\Delta = \mu_{\mathrm{PTS}}\mathrm{MP} - (\hat a\,\mathrm{MP} + \hat b\,\mathrm{USG})$,
   which is how server-baked rows are re-priced client-side without re-deriving
   the other nine categories.
2. **It refines the baseline rather than replacing it.** Over the 46 baked
   seasons, evaluated at each season's median MINUTE of usage, the fitted line
   sits $+0.002$ pts/min from $\mu_{\mathrm{PTS}}$ on average (worst $+0.016$,
   1995-96). The median-usage player is scored essentially the same either way:
   the mode redistributes value across the usage curve instead of moving the
   whole league. Fit quality is $R^2 = 0.90$–$0.94$ per season.

**What $\hat b$ is, and what the residual still carries.** The fitted slope runs
$\hat b \approx 1.16$–$1.18$ in recent seasons, a little **above** that season's
$\pi$ ($1.117$ in 2024-25). That is the turnover exclusion showing up where it
should: a possession that reaches a shot or a foul is worth more than the
average possession, because the average includes the ones that end in a
giveaway.

The residual is not white. Its minutes-weighted correlation with
$\mathrm{FTA}/\mathrm{FGA}$ is $+0.34$ pooled across seasons: players who get to
the line score **above** the line fit to their usage. That is a real property of
the shot mix rather than an indexing error — a trip to the line returns about
$2 p_F \approx 1.56$ points per possession against a league $\pi \approx 1.12$ —
and USG-ADJ paying for it is the intended behaviour, since the Free Throws
category prices only the *conversion* ($\mathrm{FTM}/\mathrm{FTA}$ vs $p_F$) and
never the rate at which a player draws the attempt. Under $\mu_{\mathrm{PTS}}$
that skill was invisible in the volume term; under USG-ADJ it is paid.

(The weight was 2.2 in the first cut of this section, which inverted the sign:
at 2.2 a free-throw attempt costs $\approx 1.5$ baseline points against the
$\approx 0.78$ it returns, the residual correlation is $-0.57$, and
$R^2$ falls to $0.88$. Foul-drawing was being charged as if it were the most
expensive way to use a possession. Hollinger's $0.475$ is both the better fit
and the one that agrees with $\Pi$; $1/2.2 = 0.4545$ lands within
$0.0014$ of it on $R^2$.)

The weight is a single constant (`USG_FTA_W`, mirrored in the fit script);
changing it requires a re-bake, since $\hat a,\hat b$ are fit to it.

**Reading it.** The Usage tab (`app/components/usage-view.js`) is the audit
surface: per season and scope, every player-season's $\mathrm{PTS}/\mathrm{MP}$,
the line's prediction $\hat a + \hat b\,(\mathrm{USG}/\mathrm{MP})$ at his own
usage, the scoring-volume term under each baseline, and their difference —
which, because the other nine categories are identical in both modes, is the
whole gap between a player's two VA totals.

**Scope.** The switch re-prices Explore (both boards, every scope), the season
tabs, and everything derived from them — category breakdowns, league pools and
percentile ranks, closest comps, multi-season selections. It does **not** touch
Legacy (leverage-weighted career numbers are baked server-side against the
standard baseline) or College (no fitted model exists for the college
population). A season with no fitted model reads as *mode unavailable* and
keeps $\mu_{\mathrm{PTS}}$ — never a zero baseline (invariant 5).

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
\hat{D} \;=\; \theta\,D_{\text{pbp}} \;+\; (1-\theta)\,D^{*}_{\text{est}},
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

### 6.1a Calibrating the prior

A blend is only meaningful if its inputs share a scale. Regressing $D_{\text{pbp}}$
on $D_{\text{est}}$ across the 20 play-by-play seasons (RS, $\mathrm{MP}\ge500$,
minute-weighted) separates into a calibrated team component and a badly
inflated individual one:

| component | regression | slope | $r$ |
|---|---|---|---|
| team | $T_{\text{est}} - L \;\to\; T_{\text{pbp}} - L$ | 0.963 | 0.986 |
| individual | $D_{\text{est}} - T_{\text{est}} \;\to\; D_{\text{pbp}} - T_{\text{pbp}}$ | 0.14 – 0.21 | ≈ 0.25 |

Only about a fifth of a player's *estimated* separation from his own teammates
survives as real separation, and the slope **falls** to 0.144 above 2000 MP —
where the play-by-play side is least noisy — so this is miscalibration, not
measurement error. More than half the variance of that deviation is the
player's stock rate ($r = 0.75$ against $(\mathrm{STL} + \rho_D\mathrm{BLK})/\mathrm{MP}$),
which §4 already pays out as its own categories.

Because $\theta$ is what mixes the two, the inflation lands entirely on the
seasons with no play-by-play to correct it: the same defender scored ~1.5×
higher pre-2000 (99th percentile of $\mathrm{dVA}/\mathrm{G}$: 3.77 before
2000-01, 2.49 after). The estimate's within-team deviation is therefore
rescaled before use, leaving the team rating — already measured — alone:

$$
D^{*}_{\text{est}} \;=\;
\begin{cases}
T_{\text{est}} + \kappa\,\bigl(D_{\text{est}} - T_{\text{est}}\bigr), & \kappa = 0.5 \\[4pt]
L + \kappa_L\,\bigl(D_{\text{est}} - L\bigr), & \kappa_L = 0.646 \quad \text{(no team baseline)}
\end{cases}
$$

$\kappa$ is fixed by **era parity** rather than by the raw slope: at $0.5$ the
estimate-only era and the play-by-play era produce the same distribution of
extremes (99th-percentile ratio 1.03, max ratio 1.29), which is the property an
all-time leaderboard needs. The raw within-team slope ($\approx0.19$) would
treat raw on-court rating as ground truth for individual defense — it is not,
since teammate overlap makes on/off understate a lone anchor — and at that
value pre-2000 defense collapses into noise and the tail inverts. The fallback
$\kappa_L$ (multi-team rows, ~11% of seasons) is the pooled slope of the same
regression, which is just the two components above mixed in their observed
variance shares: $0.58(0.96) + 0.42(0.19) \approx 0.65$.

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

### 7.4 Championship leverage and Legacy

§4 deliberately prices a possession the same in October and June. That is what
makes a season comparable to a season. It is also what makes career VA the
wrong instrument for an all-time ranking, which has to answer two questions VA
declines to: whether a game mattered, and whether a career was tall or long.

Legacy answers both **outside** $\mathcal{C}$, exactly as §7.1 does. It
reweights an existing per-game VA decomposition and never re-scores anything,
so §9.1 holds unchanged on every existing surface and no bake is affected.
Implementations: `app/lib/leverage.js` and `app/lib/legacy.js`.

#### 7.4.1 Game leverage

For a series in state $a\text{–}b$ (the score **before** the game) under a
best-of-$n$ format, let $W(a,b)$ be the probability of winning the series with
every game an independent coin:

$$
W(a,b) = \tfrac12 W(a+1,b) + \tfrac12 W(a,b+1), \qquad
W(k,\cdot) = 1,\;\; W(\cdot,k) = 0, \quad k = \left\lfloor n/2 \right\rfloor + 1 .
$$

The game's **series swing** and its **championship leverage** are

$$
\sigma(a,b) \;=\; W(a+1,b) - W(a,b+1),
\qquad
\boxed{\;\mathrm{cLI} \;=\; \sigma(a,b)\,2^{-\rho}\;}
$$

where $\rho$ is the number of rounds still to be won *after* this one. In a
best-of-7, $\sigma$ is $0.3125$ at 0-0, $0.375$ at 1-1 and 2-1, $0.25$ at 2-0,
$0.5$ at 2-2 and 3-2, $0.125$ at 3-0, and exactly $1$ at 3-3 — a Game 7 swings
the whole series by construction, which is the identity the rest rests on.

Neutrality ($p = \tfrac12$) is deliberate, and is the same commitment §4 makes:
a player is not paid more for having been on a favourite, and the quantity
needs no seed, venue or roster data, so it is portable to any era.

The ordering this produces is not the obvious one. Writing $\mathrm{R}k$ for
round $k$ of a four-round bracket:

| game | $\sigma$ | $\rho$ | cLI | weight at $\alpha = \tfrac12$ |
|---|---|---|---|---|
| R1 G1 | 0.3125 | 3 | 0.0391 | 1.000 |
| R1 G5 at 2-2 | 0.5 | 3 | 0.0625 | 1.265 |
| R2 G1 | 0.3125 | 2 | 0.0781 | 1.414 |
| R1 G7 | 1.0 | 3 | 0.1250 | 1.789 |
| R2 G7 | 1.0 | 2 | 0.2500 | 2.530 |
| Finals G1 | 0.3125 | 0 | 0.3125 | 2.828 |
| Finals G7 | 1.0 | 0 | 1.0000 | 5.060 |

A Round-2 opener outranks a tied Round-1 Game 5, but only by $1.25\times$; a
Round-1 Game 7 outranks both. Nothing here is asserted — it falls out of
$\sigma \cdot 2^{-\rho}$.

#### 7.4.2 The unit, and the regular season

Weights are expressed against **that season's own opening playoff game**:

$$
\mathrm{cLI}_{\mathrm{ref}} = \sigma(0,0)\,2^{-(d-1)},
\qquad
w \;=\; \left(\frac{\mathrm{cLI}}{\mathrm{cLI}_{\mathrm{ref}}}\right)^{\alpha}
$$

for a bracket of depth $d$. Anchoring per season rather than globally is what
keeps eras honest: a 1960 title required two series won, not four, so a global
anchor would pay the eight-team league roughly $4\times$ for clearing a
shallower field. For 1980-2026 every bracket is four rounds deep and
$\mathrm{cLI}_{\mathrm{ref}} = 0.0390625$ throughout, so the correction is a
no-op on the current corpus and matters only under backfill.

The regular season is priced in the same currency rather than by a separate
dial. Across a full season a team travels from undetermined to holding a
berth, and a berth is worth $2^{-d}$ of a title:

$$
\mathrm{cLI}_{\mathrm{RS}} \;=\; \frac{2^{-d}}{G_{\text{season}}}
\;=\; \frac{0.0625}{82} \;=\; 0.000762
\quad\Longrightarrow\quad
w_{\mathrm{RS}} = 0.13969 \;\text{ at } \alpha = \tfrac12 .
$$

About $1/51$ of a playoff opener raw, about $1/7$ after compression. $G$ is
tabulated, not measured: `max(g)` over a season's totals overshoots, because a
traded player's TOT row sums his games across teams (1999-00 and 2003-04 both
report 85).

$\alpha$ is **a taste parameter, not a derivation** — the first of the two the
leverage half spends (§7.4.2a names the other). $\alpha = 1$ is raw
championship leverage, under which a Finals Game 7 is worth 25.6 openers and
the regular season all but disappears; $\alpha = 0$ is flat and reproduces
context-free VA exactly. The default $\tfrac12$ says importance counts at
diminishing returns.

$$
\mathrm{LVA}(\text{season}) \;=\; \sum_{g \in \text{playoffs}} w(g)\,\mathrm{VA}(g)
\;+\; w_{\mathrm{RS}}\,\mathrm{VA}_{\mathrm{RS}}
$$

#### 7.4.2a Stakes belong to the series, not the game state

The $w(g)$ above is **not** the per-game weight of §7.4.1. cLI prices a *game*
by the score it was played at, which is the right answer to "how much did this
game matter" and the wrong one to "how good was this player", because a team
removes the stakes by winning early. A sweep is played entirely at 0-0, 1-0,
2-0, 3-0 — weights $1.00, 1.00, 0.89, 0.63$, the bottom of the round's range —
while a seven-game series averages $1.21$ across seven games. Winning fast cost
roughly $2.4\times$ the weighted volume: charged once for playing fewer games,
and again for the games being cheap.

So a series is priced **ex ante and once**. Under the same neutral coin,
winning it moves a title by $2^{-\rho}$ whatever score it reaches, and that
stake is spread across however many games $m$ the series actually took:

$$
w_{\text{series}} \;=\; \left(\frac{2^{-\rho}}{2^{-(d-1)}}\right)^{\!\alpha}
\cdot \frac{E}{m},
\qquad
E \;=\; \textstyle\sum_m m\,\Pr(m) \;=\; 5.8125
$$

where $E$ is the expected length of a best-of-7 under the fair coin
($\Pr = \tfrac18, \tfrac14, \tfrac5{16}, \tfrac5{16}$ for $m = 4,5,6,7$).
Dividing by $m$ and multiplying by $E$ holds the unit: a round-1 series of
expected length still prices its games at exactly $1.00$, the same opener
§7.4.1's weights are quoted against. This is already how the regular season is
priced — a berth worth $2^{-d}$, divided by the schedule — so the playoffs were
the inconsistent half. A game whose series cannot be resolved, a bracket still
in progress, falls back to its own cLI.

**Who the stake goes to.** Pricing the series ex ante fixed the fast winner and
broke the fast loser in the same stroke: both sides of a sweep drew the same
$1.4531$ per game, the top of the round's range, so being swept in four became
the most expensive basketball a round had to offer — each of those games priced
$1.75\times$ a Game 7 of the same round.

No amount of leverage arithmetic separates them. Since $W(a,b)$ is the average
of its two children, a game moves the two teams' title probability by

$$
W(a{+}1,b) - W(a,b) \;=\; W(a,b) - W(a,b{+}1) \;=\; \tfrac12\,\sigma(a,b),
$$

equal in size and opposite in sign, in every game of every series. The winner
and the loser of a sweep each moved a title by the same $0.5$ of a round-1
unit. **Championship leverage is symmetric**, and deliberately so: it prices
the event, and both teams played it.

The asymmetry is therefore asserted, and named as such. $\omega$ is the second
taste parameter, and reads the way $\alpha$ does — $0$ is the outcome not
counting at all. The series pot is conserved either way; $\omega$ only says
how much of it is handed out by who won the games rather than shared evenly:

$$
\boxed{\;s \;=\; \omega\,\frac{k}{m} \;+\; (1-\omega)\,\tfrac12\;}
\qquad
w(g) \;=\; 2\,s\;w_{\text{series}}
$$

for a team that won $k$ of the series' $m$ games. The two teams' shares sum to
$1$ at every $\omega$, so the pot is exactly conserved. The factor $2$ is
there because the pot is quoted against an even split, which makes $\omega=0$
identical to the scheme it replaces; an unresolved series takes $s = \tfrac12$.

$\omega = 1$ hands the pot out strictly in proportion to games won, which
overpays — at $1$ a low-VA role player on a dynasty rides his teammates' share
up 45 places on the board. The default $\tfrac12$ buys the two orderings the
construction wants and nothing beyond them:

| round-1 best-of-7 | won, per game | won, series | lost, per game | lost, series |
|---|---|---|---|---|
| 4-0 | 2.180 | 8.72 | 0.727 | 2.91 |
| 4-1 | 1.511 | 7.56 | 0.814 | 4.07 |
| 4-2 | 1.130 | 6.78 | 0.807 | 4.84 |
| 4-3 | 0.890 | 6.23 | 0.771 | 5.40 |

Winning in four still concentrates value over winning in seven ($8.72$ against
$6.23$), so closing a team out is never charged for; and losing in seven now
beats being swept ($5.40$ against $2.91$), so taking a team the distance beats
not troubling them. A win outprices the loss it was at every round and length.

This is the one place a **team** outcome enters an individual metric, and it is
deliberate. The outcome was already in there as a cliff — the winner advances
and plays another, dearer series, the loser goes home — and $\omega$ makes it
continuous across the series boundary rather than opening a second channel.

#### 7.4.3 Peak and longevity

Order a player's seasons by LVA descending and fold with geometric decay:

$$
\mathrm{Legacy} \;=\; \sum_{k \ge 1} D^{\,k-1}\, \mathrm{LVA}_{(k)} .
$$

$D = 1$ is a plain career sum (pure longevity); $D \to 0$ keeps only the best
season (pure peak). Every term is positive when the season was, so extra
seasons only ever add — but they add geometrically less, so a long tail of
replacement-level years is neither rewarded nor punished much.

$D$ is pinned rather than chosen, by stating what share of a career the peak
should carry. "The best $K$ of $N$ seasons carry half the weight" is

$$
\frac{1 - D^{K}}{1 - D^{N}} = \tfrac12
\quad\Longrightarrow\quad
D = 0.938068 \;\;\text{at}\;\; (K,N) = (7,20),
$$

hence the default $D = 0.94$.

The second axis is the **rate**: LVA per weighted game across the best $K$
seasons. Weighted, not raw — if leverage prices the total it must price the
rate, or the two halves of the metric disagree about what a game is worth. The
two axes are reported side by side rather than blended, because any blend needs
both normalized against the pool leader, which would make a career number move
when an unrelated rookie debuts.

#### 7.4.4 What this does to the Jordan/LeBron question

Over their best seven seasons Jordan leads on raw per-game VA, $23.19$ to
$21.75$. He does not lead once the games are priced by what was at stake: the
two cross at $\alpha \approx 0.27$, and at the default $\alpha = \tfrac12$
LeBron leads $21.84$ to $21.26$. The crossing sits in the same place on best-8
($0.279$) and best-10 ($0.257$), so it is not an artifact of $K$.

On the volume axis there is **no** crossing at all: LeBron leads at every $D$
from $0.5$ to $1$, because his best leveraged seasons are also better, and the
margin widens with $D$. The dials move the board substantially further down —
Harden falls from 3rd to 23rd as $\alpha$ runs 0 to 1, Magic climbs 13th to
4th, Duncan 16th to 7th — which is the metric separating profiles, and is worth
reading as the result rather than tuning away.

#### 7.4.5 A known inexactness

Legacy sums the **per-game** VA decomposition. That is not identical to the
baked season-total VA: $\gamma$ (§4.3) is non-linear in $\mathrm{REB}/\mathrm{MP}$,
so evaluating it once on season totals differs from evaluating it per game and
summing — a mean gap of 1.8% on meaningful seasons, systematically upward for
rebounding bigs, up to $+11.9$ (1980-81 Moses Malone). Legacy takes the
per-game aggregation, on the grounds that $\gamma$ is defined on a stat line
and a game *is* a stat line. So $\alpha = 0$ reproduces a career's *summed
per-game* VA exactly, and its summed *season-total* VA only to about 1.8%.

#### 7.4.6 Coverage, and what a backfill has to solve

Legacy currently spans **1980-81 to 2025-26**, the seasons with player data on
disk. A career already running in 1980-81 is measured short and is flagged as
such rather than ranked as complete; Magic Johnson and Larry Bird sit in the
top 15 missing their rookie year, and Kareem Abdul-Jabbar appears with 848 of
his games.

Extending back is a data problem, not a formula problem. The leverage
construction already generalizes: bracket depth is read per season, so a
two-round 1950s postseason scores its Finals Game 7 at the same $\mathrm{cLI} = 1$,
and the per-season anchor of §7.4.2 makes its opening game worth exactly the
same as a modern one. Byes need no special case. What does not generalize is
the **category set**:

| era | state | what it needs |
|---|---|---|
| 1979-80 | complete; the 3-point line arrives | the existing bake, run |
| 1973-74 – 1978-79 | complete box score, no 3-point line ($\lambda_{3} = 0$ against $\mathrm{3PA} = 0$, so the term is exactly zero) | the existing bake; verify TOV provenance, which BR carries per player only from 1977-78 |
| 1970-71 – 1972-73 | **baselines are zero-filled and unusable** — $\mu_{\mathrm{DRB}} = \mu_{\mathrm{ORB}} = \rho_D = 0$, because rebounds were not split until 1973-74 | a reduced-category variant, and rebuilt baselines |
| 1949-50 – 1969-70 | no baselines at all; no rebound split, no steals/blocks/turnovers, possessions need imputing | v1's $\mathrm{VA}_3$ and its OLS possession estimate, both dropped in v2 |

The third row is a live §9.5 violation sitting in `league-averages.json`
already: those entries exist and are wrong, and a zero baseline is not a
harmless zero — at $\mu_{\mathrm{DRB}} = 0$ a player is credited his entire
rebounding rate as surplus, and at $\rho_D = 0$ the block term multiplies to
nothing. Nothing reads them today because no player data predates 1980-81, so
`baselineCoverage()` in `app/scoring.js` refuses any season whose baseline
cannot price all ten categories, and Legacy skips it loudly rather than
scoring it. That is the tripwire the backfill will meet first.

The comparability caveat is the real cost, and it should not be buried: a
season scored on seven of ten categories is **not the same currency** as one
scored on ten, and §9.5 forbids making up the difference. Any backfilled era
that loses categories needs to carry how many it measured, and be shown as its
own class rather than mixed into one column.

---

## 8. v1 → v2 divergences

`nba-projects` (R Shiny, 2024) established the framework; `playoff-tracker`
(2026) revised it. Numbers from the two apps are **not** interchangeable.

| | v1 — nba-projects | v2 — playoff-tracker |
|---|---|---|
| Per-minute baseline | unweighted median across players | **minutes-weighted** median (§2) |
| Possessions | $\mathrm{2PA}+\mathrm{3PA}+\mathrm{TOV}+\mathrm{FTA}/2.1$; pre-1973 imputed by OLS on $\mu_{\mathrm{PTS}},\mu_{\mathrm{TRB}}$ | Hollinger: $\mathrm{FGA}-\mathrm{ORB}+\mathrm{TOV}+0.475\,\mathrm{FTA}$ |
| Rebound credit | $\gamma = 1$ | per-player $\gamma = 1/(1-q)$ (§4.3); was a flat $5/4$ through July 2026 |
| Coverage | 1949-50+, via three nested variants ($\mathrm{VA}_1$ full; $\mathrm{VA}_2$ drops TOV for 1974-77; $\mathrm{VA}_3$ drops TOV/STL/BLK and estimates rebound splits for 1952-73), selected by `coalesce()` | 1979-80+, single variant, complete box score |
| Playoffs | separate tab | first-class scope, scored against that season's **regular-season** baselines |
| Defense | box-score events only | $\mathrm{VA}^{+}$ (§6) |
| Shot location | Four Factors visuals | zone VA + Shooting comps (§7.1–7.2) |
| Non-NBA | — | NCAA D-I on college-derived baselines |
| All-time ranking | career VA, summed | Legacy: championship-leverage weighted, peak/longevity dialled (§7.4) |

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
6. USG-ADJ (§4.6) replaces the baseline $\lambda_{\text{Points}}$ and nothing
   else. It is a per-player baseline, like $\gamma$ is a per-player price, so
   invariant 1 holds within either mode; the two modes are separate currencies
   and their numbers are never mixed on one surface, nor with a Legacy or
   College number.
7. Championship leverage **reweights** the decomposition and never enters it, so
   invariant 1 holds unchanged on every surface (§7.4). Within a series its
   weight is conserved: the two teams' shares sum to $1$ at every $\omega$, so
   $\omega$ only redistributes the pot and can never create weight.
