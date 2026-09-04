# Caption inventory

Every piece of standing explanatory text in the app — the small grey italic
lines under charts and tables — with where it lives, what it says when it
actually renders, and what is wrong with it. The **Yours** line under each is
blank on purpose.

Tooltips (`title=`) are listed separately in §4; they are cheap and mostly
fine, and several of the fixes below are "move this into a tooltip".

Rendered examples are real: captured from Wembanyama 2024-25, Explore →
By Season → Combined, VA+ on.

---

## 1. The problem, before the list

Open one category context card on a phone and you are shown **127 words** of
8-pixel grey italic — C1 + C2 + C4 + C5 + C7 below — wrapped around roughly
forty numbers. The captions are longer than the thing they caption.

Four habits produce that, and they are worth naming because every rewrite
below is just one of them undone:

**(a) One sentence, three jobs.** Nearly every caption defines the metric,
states the population/filter, *and* lists the tap targets. Those have
completely different lifespans: you read a definition once ever, a population
once per card, and a gesture hint exactly until you have discovered the
gesture. Chaining them means the two you have finished with never go away.

**(b) Middot run-ons.** `·` is doing the work of a full stop in twelve of
these. At 8px on a 430px screen it does not read as a clause boundary — it
reads as texture, and the eye slides off the whole line.

**(c) Gesture hints are permanent.** Nine distinct tap instructions are on
screen forever: *tap a player for their card · tap a dot to open that player ·
tap a stat to collapse the plot onto it · tap a distance to filter the card ·
tap a season, then Go → · tap a category for league context · tap a group for
its categories, a category for raw stats · tap a column to sort · tap MP, then
a player's MP*. Collectively they are the single largest block of caption text
in the app, and they are the one part with a natural expiry.

**(d) Captions patching labels.** C1 spends six words — `(Defense = per-game
rate)` — explaining that a column headed **DEFENSE** contains a stocks rate
and a column headed **VA** contains the Defense value added. Fix the two
column headers (see `toggle-display-audit.md` F4) and those six words delete
themselves. This is the highest-leverage edit on the page and it isn't a
caption edit at all.

**One structural constraint before you cut:** C1 is wrapped in
`min-h-[2.6em]` (`va-breakdown.js:1592`) so that flipping `/G` — which
reflows "per-game" ↔ "total" across the line break — never shifts the page. A
rewrite that lands on one line is fine; just drop the guard with it.

---

## 2. The captions

### C1 — Context card · ranking fine print
`app/components/va-breakdown.js:1592` · shows whenever a context card is open

> Ranked by per-game Defense VA among combined (RS+PO) players with ≥16 G
> (Defense = per-game rate) · tap a player for their card.

**23 words.** Says the population twice over (C2, twelve words later, opens
with the same clause). The parenthesis is a column-header patch (d). The tap
hint is permanent (c).

*Proposed (9):* `Per-game Defense VA · combined (RS+PO), ≥16 G` — with the
column renamed `DEF VA` / `STK/G` and the tap hint moved to the row `title`.

**Yours:**

---

### C2 — Context card · scatter caption
`app/components/va-breakdown.js:1743` · Passing / Rebounds / Defense cards

> Every combined (RS+PO) player with ≥16 G this season in grey, Wembanyama in
> black — tap a dot to open that player · axes = per-game value added, line =
> the league baseline · tap a stat to collapse the plot onto it and filter the
> card. Total = the 3 stats summed — the Defense row above, including the D
> Rating chip (no axis of its own).

**68 words.** The longest standing caption in the app. It restates C1's
population, teaches the plot, teaches two gestures, and reconciles the Total
against the row above. Four captions in a trench coat.

*Proposed:* split by lifespan — legend stays (`axes = per-game value added ·
line = league baseline · grey = the field, black = Wembanyama`, 13 words),
both gestures go to `title`/`aria` (already present there), and the Total
reconciliation moves next to the `Total +5.59` chip it is about, as a tooltip.

**Yours:**

---

### C2b — same caption, plot collapsed onto one stat · **BROKEN, not just long**
same line, `selIdx >= 0` branch

> Every combined (RS+PO) player with ≥20 G this season in grey, Kessler in
> black — tap a dot to open that player · **each column is the count at that D
> Rtg value, mirrored = per-game value added**, line = the league baseline,
> dashed = the UTA defense he is held to at 120 DRTG (right of it he
> out-defends it) · tap a stat to go back to the scatter. Total = the 3 stats
> summed — the Defense row above, including the D Rating chip (no axis of its
> own).

**92 words**, and ungrammatical. The template is
`${collapsed ? "each column is the count at that X value, mirrored" : "axes"} = ${…} value added`
— the `= per-game value added` was written to hang off `axes`, and after the
collapsed substitution it dangles off `mirrored`. This is the one caption on
the list that is a defect rather than a preference; left unedited so the
rewrite is yours.

**Yours:**

---

### C3 — Context card · shot-distance bars caption
`app/components/va-breakdown.js:1744` · Scoring and 2-Pointers cards

> Top = FG% · bar = per-game value added vs. league FG% at each distance among
> the combined (RS+PO) field (dot = player, tick = median) · number below =
> value added · tap a distance to filter the card. Eff = 3P + 2P + FT value
> added; Impact = the six bars summed — tap either to rank the card on it.

**64 words.** Two definitions of the same thing: *bar = … value added* and
*number below = value added*. `Eff`/`Impact` are defined here and again in
their own `title` attributes.

*Proposed (16):* `Top = FG% · dot = player, tick = median · number = per-game
value added` — Eff/Impact keep only their tooltips.

**Yours:**

---

### C4 — Context card · all-time board
`app/components/va-breakdown.js:1772`

> Across all 19428 indexed combined (RS+PO) seasons (≥5 G).

**9 words**, and the third statement of the pool in one card. `19428` also
appears in the `#8 of 19428` line directly above it.

*Proposed:* delete. `#8 of 19428` above already carries it; append `≥5 G` to
the section heading if the floor must be visible.

**Yours:**

---

### C5 — Context card · career trend
`app/components/va-breakdown.js:1883`

> Tap a season, then Go →, to open that season.

**10 words.** Accurate, well-scoped, and the clearest of the gesture hints —
because it teaches a two-step gate that genuinely is not guessable. If any tap
hint survives the cull, this is the one.

**Yours:**

---

### C6 — Playoff breakdown footer
`app/components/va-breakdown.js:680`

> Bars show contribution above/below the league baseline (median rates) · tap
> a category for league context

**16 words.** Under USG-ADJ the parenthesis becomes `median rates, scoring
usage-adjusted`.

*Proposed (8):* `Contribution above / below the league baseline (median
rates)`.

**Yours:**

---

### C7 — Season breakdown footer
`app/components/va-breakdown.js:2078`

> Bars show per-game contribution above / below the NBA baseline · tap a
> category for league context

**17 words.** Same sentence as C6 with different spacing (`above/below` vs
`above / below`) and a different baseline noun. Two captions, one idea, two
spellings — worth unifying whatever you land on.

**Yours:**

---

### C8 — Compare panel · values mode
`app/components/compare.js:1809`

> Per-game VA, each vs their own season's league baseline · Defense carries D
> Rating, so the four groups sum to VA+ · tap a group for its categories, a
> category for raw stats

**33 words.** The middle clause is a footnote about arithmetic that only
matters if you are adding the four groups up by hand.

*Proposed (10):* `Per-game VA, each against their own season's baseline` +
move the VA+ note to the `VA+` chip's tooltip.

**Yours:**

---

### C9 — Compare panel · percentiles mode
`app/components/compare.js:1810`

> Percentile of per-game VA across every indexed player-season, ≥5 G, each vs
> their own era · tap a group for its categories, a category for raw stats

**27 words.** Gains a further 17-word clause when one side is a multi-season
run (*"— a pooled run has no rank against single seasons, so percentiles stay
per game"*). That clause earns its place; it explains why two controls
disagree, which is exactly when a caption is worth having.

**Yours:**

---

### C10 — Compare panel · career chart
`app/components/compare.js:2000`

> Seasons aligned by career year · compared seasons at full strength · tap a
> pair to tick that year, then Compare → to read the ticked years as the
> comparison

**30 words**, of which 20 are the gesture.

**Yours:**

---

### C11 — Compare panel · career chart, same player
`app/components/compare.js:1997`

> One bar per season of his own career · the two compared seasons in color,
> the rest neutral

**18 words.** Fine. Second clause is a legend for something already visually
obvious.

**Yours:**

---

### C12 — Usage tab footer
`app/components/usage-view.js:666`

> Min 100 minutes · search to include everyone · per game · tap a column to
> sort · tap a name to find it in the plot · tap MP, then a player's MP, to
> filter by minutes

**38 words** across five middot-joined clauses — the worst run-on in the app.
`per game` is also unscoped: it describes the seven point columns only (`MP`
stays a season total, `PTS/M` and `Pred` are per-minute). See audit F6.

*Proposed (12):* `Min 100 minutes; search to include everyone. Point columns
per game.` — three tap hints to `title`.

**Yours:**

---

### C13 — D Rating tab footer
`app/components/drating-view.js:209`

> Min 100 minutes · search to include everyone · tap a column to sort · tap
> MP, then a player's MP, to filter by minutes

**25 words.** Same shape as C12 minus the plot clause. These two and C14
should share one sentence pattern; today they share none.

**Yours:**

---

### C14 — Shot Zones tab footer
`app/components/shot-zones-view.js:184`

> Min 50 2-point attempts · search to include everyone · tap a column to sort
> by its zone value

**19 words.** The third variant of the same footer.

**Yours:**

---

### C15 — Leaderboard · missing-data notice
`app/components/leaderboard.js:517`

> Regular-season totals aren't baked for 2025-26 yet — showing playoff stats
> only.

**12 words.** Good: states the condition and the consequence, appears only
when true, and uses no jargon the reader hasn't met. Model for the rest.

**Yours:**

---

### C16 — Reference-tick label
`app/components/va-breakdown.js:652`

> Reg. Season Avg

**3 words**, printed once above the topmost tick. Exemplary — a label sitting
on the thing it names instead of a sentence at the bottom of the card
describing it. More captions should become this.

**Yours:**

---

### C17 — Empty career trend
`app/components/va-breakdown.js:1785`

> No seasons on record.

**4 words.** Fine.

**Yours:**

---

### C18 — Compare panel · multi-season footnote
`app/components/compare.js:1822`

> … — each run vs its own seasons' league averages, weighted by the volume he
> played in them

**16 words**, appended to a line that already names both sides and their
games. Only renders for pooled runs, where it is doing real work.

**Yours:**

---

### C19 — Compare picker · match note
`app/components/compare.js:659` (built), rendered at `:881`

> Selection is career years 3–6; Gobert played 12 seasons, so this is his
> years 3–6

Length varies with the mismatch. Only appears when the matcher couldn't
deliver what its label promised, which is precisely the right trigger. Keep.

**Yours:**

---

## 3. If you only change five things

1. **Rename the two context-card columns** (`DEF VA`, `STK/G`) — deletes C1's
   parenthesis and stops the caption doing a label's job.
2. **Fix C2b's dangling `= per-game value added`.** It is the one broken
   sentence, not just a long one.
3. **Move the nine tap hints to `title`/`aria`.** They are already duplicated
   there in most cases. Keep C5 (the two-step Go → gate) visible.
4. **Say the population once per card**, in C1, and cut it from C2 and C4.
5. **Unify C12 / C13 / C14** into one footer sentence with slots for the
   floor and the sortable-column hint.

Together that is roughly 200 words off the screen without losing a single
fact — every one of them either moves to a tooltip, moves to a label, or was
already said somewhere else on the same card.

---

## 4. Tooltips (`title=`), for reference

These do not compete for screen space, so length matters far less. Worth
knowing about because several fixes above route text here.

| Where | File | Currently says (abridged) |
|---|---|---|
| VA+ banner | `va-breakdown.js:415`, `:2038` | the full D-Rating derivation — team DRTG, league line, the stock-rate weight |
| Reference tick | `va-breakdown.js:643` | `Regular season: +0.42` |
| Stat chip | `va-breakdown.js:981` (scatter), `:1712` (bars) | `Blocks — collapse the plot onto this stat and filter the card` |
| Eff / Impact | `va-breakdown.js:1623` | full definition of each, plus "tap to rank the card on it" |
| Team D line | `va-breakdown.js:1400` | why the dashed line is where it is |
| USG-ADJ chip | `lib/va-mode.js:70` | what the switch does, in both states |
| `/G` switch | `compare.js:2026` | what ON and OFF mean, in both states |
| Compare rows | `compare.js:1708` | both players' rates for that category |
| Trend bar | `va-breakdown.js:1808` | `2024-25: +5.59 · #1 in league · tap to open` |
| Sort headers | `usage-view.js:540+` | one line per column, defining the statistic |

The pattern already in use here — **state what it does in the state it is
in**, e.g. the `/G` tooltip flipping between "shown per game — tap for season
totals" and "shown on season totals — tap for per-game" — is the strongest
copy convention in the codebase. It is worth stealing for the visible
captions too.
