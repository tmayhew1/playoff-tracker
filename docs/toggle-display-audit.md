# Toggle × display audit

Every control in the app that re-reads numbers already on screen, and every
place a displayed figure either does or does not answer to it. Written after
the context card's stat chips were found showing per-game counts while the
**Per 36** toggle above them was selected.

Status key: **FIXED** (in this change) · **OPEN** (real, not fixed here) ·
**OK** (checked, behaves correctly) · **BY DESIGN** (looks like a bug, isn't).

---

## 1. The controls

| # | Control | Lives in | Governs | State name |
|---|---|---|---|---|
| T1 | **LG AVG / USG-ADJUSTED** (and the `USG-ADJ` chip) | `va-baseline-toggle.js`, `lib/va-mode.js` | which scoring baseline every VA on the page is priced against | `usgAdj` (context) |
| T2 | **VA / VA+** | `leaderboard.js:465`, `player-explorer.js:718` | whether the defensive-rating layer is folded in | `metric` |
| T3 | **Combined / Regular Season / Playoffs** | `explore.js` | which pool every board and drill-in ranks against | `scope` |
| T4 | **By Season / By Player** | `explore.js:277` | which board is showing | `mode` |
| T5 | **Basic / By Category** | `va-breakdown.js:531`, `:2005` | ten rows vs. four grouped rows | `viewMode` |
| T6 | **Per 36 / Per G** | `va-breakdown.js:558`, `:2017` | the normalization of every **raw box-score rate label** | `rateMode` |
| T7 | **/G ON · OFF** | `compare.js:2020` (`PerGameToggle`); mounted at `va-breakdown.js:1538` and `compare.js:1577` | whether **value added** reads per game or as a season total | `perGame` |
| T8 | **Values / Percentiles** | `va-breakdown.js:510`, `:1998` | what the compare rows plot | `compareMode` |
| T9 | **Stat / distance chips** | `CategoryContext` | filters the whole card to one component | `selectedSeg` |
| T10 | **Category row tap** | `VABreakdown`, `VACategoryBreakdown` | opens the context card; swaps the spark line | `selectedCategory` / `openCat` |
| T11 | **Game / series drill** | `VABreakdown` | which stat line the card is about | `selectedGame`, `selectedSeriesIdx` |
| T12 | **Tot / /G** | `usage-view.js:444` | the scale of the seven point columns | `perGame` (local) |
| T13 | Sort headers, arming filters (G, MP, Player, team), Plot on/off, λ dial, Expand/Collapse All, compare `matchMode` | various | ordering / filtering / disclosure only | — |

The two that collide are **T6** and **T7**. They look alike (both are
"per-something" switches), they sit at opposite ends of a long card, and until
this change they each drove a slice of the same numbers.

- **T6 governs raw box-score rates** — `3.8 BLK/G`, `3.1/8.8 (35.2%)`.
- **T7 governs value added** — `+2.77`, `+257.1`, the bar lengths, the ranks.

That split is the rule the rest of this document tests everything against.

---

## 2. Findings

### F1 — Context-card stat chips ignored Per 36 · **FIXED**
`va-breakdown.js` → `CategoryContext` → `SEGMENTS[].head`

The bold headline on each stat chip (`BLK 3.8`) is a raw box-score rate, so it
belongs to T6. It read T7 instead:

```js
return perGame ? (v / (r.gp || 1)).toFixed(1) : String(v);
```

So with **Per 36** selected the chip kept showing 3.8 BLK/G while the fine
print two lines above it said `(Defense = per-36 rate)` and the rate column in
the same card showed `5.4 STK/36`. Three readings of one stat, two of them
wrong for the selected mode.

**Now:** Per 36 wins outright (`4.1`); under Per G the `/G` switch still
chooses between the per-game rate (`3.8`) and the season total (`176`) it sums
to. The chip's own label carries `/36` in that mode — `BLK/36 →` — because a
bare `4.1` under a `BLK` label is not the reading anyone brings to it.

Verified live across all four combinations (Wembanyama 2024-25, combined):

| | /G ON | /G OFF |
|---|---|---|
| **Per G** | `BLK 3.8` | `BLK 176` |
| **Per 36** | `BLK/36 4.1` | `BLK/36 4.1` |

### F2 — Made/attempted rate column followed the wrong toggle · **FIXED**
`va-breakdown.js` → `CategoryContext` → `maLabel`

The rightmost column of the mini leaderboard shows each player's rate at the
open category. For counting categories it called `catRateLabel` (T6, correct).
For the three **shooting** categories and the six shot distances it called
`maLabel`, which read T7 — so one column changed its meaning depending on
which category you had opened, and contradicted its own caption:

> Ranked by … (**3P = per-36 rate**) · tap a player for their card.
> `322  V. Wembanyama  46  33.2  −0.21  3.1/8.8 (35.2%)`   ← per **game**

`maLabel` now takes the row and divides on T6, exactly as `catRateLabel` does.
The column is one statistic again, and with **Per 36** selected the same row
reads `3.3/9.5 (35.2%)`. It also no longer flips to raw season totals when
`/G` is switched off — that column never claimed to show totals.

### F3 — Per 36 / Per G disappears while comparing but keeps acting · **OPEN**
`va-breakdown.js:497–586`, `:1987–2021`; consumed at `compare.js:1516`

Opening a comparison replaces the Basic/By Category and Per 36/Per G toggles
with the vs-chip and Values/Percentiles. `rateMode` is still passed into
`ComparePanel` and still decides the rate tooltip on every row
(`rateLabelFor` → `catRateLabel`), so a hover reads `3.8 BLK/G` or
`4.1 BLK/36` depending on a control that is no longer on screen — and on
whatever the reader happened to leave it at before opening the comparison.

Severity: low (tooltip only; the expanded raw-stats card prints `PTS/G`,
`PTS/36` and `TOT PTS` as three separate rows, so nothing there is ambiguous).

Two clean fixes: keep the toggle visible while comparing, or pin the tooltip to
per-game and drop the prop. The first is better — it is the same numbers.

### F4 — The mini leaderboard's two right-hand columns are named backwards · **OPEN**
`va-breakdown.js:1585` (header), `:1499–1502` (cells)

```
#  PLAYER          G   MPG    VA     DEFENSE
1  V. Wembanyama   46  33.2  +5.59   5.0 STK/G
```

The column headed **VA** holds the *category's* value added (Defense VA, not
total VA), and the column headed **DEFENSE** holds a box-score rate. A reader
scanning the board reasonably reads the last column as the Defense figure. The
caption then has to spend six words undoing it: `(Defense = per-game rate)`.

Renaming the columns — `DEF VA` and `STK/G` (or `STK/36`, which T6 already
knows) — would delete that caption clause entirely and remove the need for the
column header to be interpreted at all. This is the single highest-value
change on this list for the caption budget.

### F5 — `note` says "FG%" where the column shows made/attempted · **OPEN**
`va-breakdown.js:1132`, `:1101`

With a shooting category or a shot distance selected, the caption reads
`FT = FG% at that distance` while the column shows `5.6/6.8 (82.4%)`. The
percentage is in there, so it is not wrong, just under-described. Cheapest fix
is `note: "made/att (FG%)"`.

### F6 — Usage tab: `MP` stays a season total under `/G` · **BY DESIGN, caption OPEN**
`usage-view.js:620–631`, caption at `:666`

The `Tot / /G` switch scales the seven point columns and their sort. `MP` stays
a raw total (it is the axis the min-minutes filter arms against, so it has to)
and `PTS/M` / `Pred` are per-minute, so scale-free. All correct — but the
caption says a flat `per game` with no indication of which columns it covers.
Scope it: `point columns per game`.

### F7 — Per-game columns elsewhere have no toggle at all · **OK**
`leaderboard.js` (PPG/RPG/APG/SPG/BPG), `history.js`, `drating-view.js`,
`shot-zones-view.js`. None of these boards carries a rate switch, so there is
nothing for their labels to disagree with. `grep '/36'` finds per-36 only in
`va-breakdown.js`, `compare.js` and `lib/va.js` — the audit surface for T6 is
exactly those three files.

### F8 — Everything T7 touches, checked · **OK**
`metric`, `segData`, `scatter`, `teamRefLine`, `segTotals` (both `efficiency`
and `impact`), the decimal count in `sgn`, the trend bars and their ranks all
read `perGame`. `mpg()` stays per-game by definition. No leaks.

### F9 — Everything T1 touches, checked · **OK**
The USG-ADJ switch travels inside the baseline object rather than as a prop
(`lib/va-mode.js`), and the one place a held row could have gone stale — a
compared player picked before the switch was flipped — is already re-resolved
against the live pool by `useFreshRows`. The season pool, the all-time pool and
the career trend in `CategoryContext` all score through `lgaFor`, so a rank is
never computed at a different baseline from the value it ranks.

### F10 — `selfRow` is rebuilt every render, so the pools recompute · **OPEN (performance)**
`va-breakdown.js:1045`

```js
const selfRow = { ...p, name: self.name, slug: self.slug || null };
```

A fresh object identity on every render, and it is a dependency of `d`,
`segData`, `scatter` and `teamRefLine`. `d` walks the ~19,400-row all-time pool
calling `valueAddByCategory` per row, so any re-render of an open context card
— not just a toggle — pays for the whole pool again. Wrapping `selfRow` in a
`useMemo` keyed on the fields it actually reads would confine that to the
toggles that genuinely change the answer. Not measured; flagged, not fixed.

---

## 3. The rule, for next time

> A number is governed by the toggle that owns its **unit**, not by the toggle
> that happens to be nearest it in the file.
>
> - counts and shooting lines → **Per 36 / Per G** (T6)
> - value added, ranks, bar lengths → **/G** (T7)
> - percentages, ratings, per-minute figures → neither; they are scale-free
>
> And if a toggle can change a number without changing its label, the label is
> missing a unit.
