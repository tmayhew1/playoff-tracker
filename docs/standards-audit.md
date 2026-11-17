# Standards audit

A pass over the whole app against the usual web standards — numeric
consistency, accessibility (WCAG 2.2 AA), HTML validity, performance,
security, resilience, metadata and tooling. Written after the context card
was found printing `88.6%` and `57/64 (89.1%)` for the same share of shots.

Status key: **FIXED** (in this change) · **OPEN** (real, not fixed here) ·
**OK** (checked, nothing to do).

How it was checked: the production build served locally and driven with
Playwright at a 402px phone viewport; axe-core 4 (WCAG 2.0–2.2 A/AA plus best
practices) on all eleven tabs; Lighthouse (mobile); html-validate on the
rendered DOM of nine views; ESLint with the React, React Hooks and jsx-a11y
plugins (the repo has no lint config, see T2); `npm audit`; CPU profiles under
4× throttling; and a read of every API route. ESPN and the NBA CDN are not
reachable from the audit environment, so anything that needs a live game was
read, not run.

---

## 1. Numbers that disagree with themselves

### N1 — Share leaderboard: `ATT` percentage worked from rounded counts · **FIXED**
`category-context.js` → `maLabel`, `SHARE_SEGMENTS[].rate`

A shot share's denominator is FGA plus FTA ÷ 2.2 trips, so it is rarely whole
(AJ Green: 64.36). The `DIST.` column divided by it; the `ATT` column rounded
both counts first and divided those — `57 / 64.36 = 88.6%` beside
`57/64 (89.1%)`. `maLabel` now takes the unrounded counts, rounds only what it
prints, and the percentage is the ranked one.

### N2 — The six shot-distribution discs don't share a denominator · **FIXED (follow-up)**

> **Resolved:** every share is now of the box score's shots, a 2-point distance taking its part of the zones applied to the box score's 2PA — the fix proposed below. The six sum to exactly 100% on all 14,910 zoned player-seasons, and the disc labels are rounded together (largest remainder) so the printed numbers do too.

`category-context.js` → `SHARE_SEGMENTS`, `shotTrips`

On the same card Green's discs read 2 + 2 + 0 + 6 + 3 + 89 = **102%**, and the
unrounded shares sum to 101.6%, so it is not display rounding. FT and 3PT are
shares of the box score's shots (64.36). The four 2-point distances are shares
of the zones' own total (65.36), and the zones hold **7** two-point attempts
where the box score has **6**: basketball-reference publishes each distance as
a percentage of FGA, and the bake rebuilds counts as `round(FGA × pct)`
(`scripts/R/fetch_shooting_splits.R`).

Across the regular-season index the rebuilt zones match the box score's 2PA in
13,602 of 14,910 player-seasons (91%), are one off in 870, and further off in
438 — those mostly 2021-22 and 2022-23, where the Shooting page is missing
shots outright (Mitchell 2022-23: 743 located of 767).

The code comment already allows the discs to "sum a hair off 100%" on a row
tonight's games have moved; this is the same effect on rows that are fully
baked. A fix that keeps every reading on one scale: make a 2-point distance's
share its part of the zones (`zone ÷ zone total`) times the box score's
2-point share (`2PA ÷ (FGA + trips)`). The six then sum to exactly 100% on
every row, stale or not. Left open because it changes the ranked statistic on
the distance boards and the attempts printed beside it — a design call, three
commits after that reading was last reworked.

### N3 — Everything else that prints made/attempted beside a percentage · **OK**
`va.js` `catRateLabel`, `va-breakdown.js` (`:185`, `:781`), `compare.js`
(`:127–141`), `live-view.js:121`, `boxscore.js:77–79`, `shot-zones-view.js:176`,
`/api/legacy/runs` `pct()`. Each divides the raw counts and rounds only for
display, so a per-game `3.1/8.8 (35.2%)` cannot be reproduced from its own two
figures but is the right percentage. No second case of N1.

### N4 — Rounded parts beside an unrounded total · **OK, by nature**
A breakdown's four group bars are each rounded to two places and can miss the
`VA/G` above them by 0.01 (Wembanyama 2025-26: 12.69 − 0.66 + 3.57 + 2.27 =
17.87 vs 17.86). That is what rounding independently does; forcing them to sum
would mean printing a part that is not its own value.

### N5 — `VA/G` guards games differently from the columns beside it · **OPEN, edge case**
`leaderboard.js:462`, `:709`, `player-explorer.js:935` divide by
`Math.max(1, gp)`; PPG/RPG on the same row and `VA / Game` in the card divide
by `gp`. They differ only while a player's **first** game of a season is in
progress (`gp` < 1): the row's VA/G is the game so far, its PPG a full-game
pace. Probably deliberate for the sort (a hot three minutes would otherwise top
the board); noted so the two readings are a decision rather than an accident.

### N6 — Combined baseline weights are rounded to a thousandth · **OK**
`scoring.js` → `combinedLgaBase`. The comment says the mixed baseline returns
the two halves "to the decimal"; the weight is rounded to 0.001 to bound the
cache, which moves a 3,500-minute season by a few hundredths of a point.
Below the tenth the board prints.

---

## 2. Performance

### P1 — A date formatter built per player line · **FIXED**
`lib/regular-season-games.js` → `shortDay`, `dayLabel`

`monthTotals` asked `shortDay()` for a label on every player line of every
game — about 26,000 calls a season — and `toLocaleDateString` with options
builds a new `Intl.DateTimeFormat` each time. Profile of opening 2025-26 on
Explore: that one call was 1.46 s of 2.09 s of script. Under 4× CPU throttling
it was ~7.1 s of main-thread blocking in 1–1.5 s freezes, one as each month
file arrived (Lighthouse: TBT 16.9 s with its own overhead). One shared
formatter and a per-date cache: the same load blocks for ~0.1 s, longest task
94 ms.

### P2 — The context card re-scanned the all-time pool on every render · **FIXED**
`category-context.js` → `selfRow` (F10 in `toggle-display-audit.md`)

`selfRow` was a fresh object each render and a dependency of every pool memo,
so arming the Player header or a trend bar re-ran the ~19,000-row scan.
Memoized, and the pool's dependency list completed (it had been relying on
that bust to stay current: `defs` and the pool scope were missing). No-op
interactions inside the card no longer produce a long task; a real toggle
computes the pool once.

### P3 — Components defined during render · **FIXED where it mattered**
Sort headers in Shot Zones, D Rating and Usage, and the context card's ranking
rows, were declared inside their parent's render, so each render was a new
component type and React remounted them (see A6 for what that did to focus).
They now render through `ui/render.js`. The remaining cases
(`compare.js` `Swatch`, `info-view.js` `Group`/`Step`) are static and harmless.

### P4 — Draft tab simulates 20,000 brackets on the main thread · **OPEN, minor**
`lib/draft-model.js` → `simulate`. Two ~350 ms tasks at 4× throttle on opening
the tab and on each owner change. A smaller run, or a worker, if it is ever
felt.

### P5 — Page weight · **OK**
First-load JS 210 kB (page chunk 122 kB), with every tab but Explore
code-split. `/api/def-ratings` is 1 MB of JSON fetched on the first visit and
`/api/players` 2.6 MB on the first drill-in; both are CDN-cached and
compressed in production. Fonts are self-hosted and preloaded. CLS 0.05.

### P6 — Back/forward cache · **OPEN, not actionable as built**
The document is `no-store` because the page reads request headers to build its
link preview, which rules it out of bfcache.

---

## 3. Accessibility (WCAG 2.2 AA)

### A1 — No landmarks; headings skipped a level · **FIXED**
The tab strip is a `<nav>` with the open tab marked `aria-current`, the view a
`<main>`, and section headings follow the `h1` as `h2` (they were `h3`).

### A2 — Selects and search fields with no accessible name · **FIXED**
Thirteen controls (season selects, the search boxes, Legacy's games gate) had
a placeholder at most. Each has a label now; Explore's visible "Season" label
is tied to its select.

### A3 — Button names that hid their own label · **FIXED (partly)**
WCAG 2.5.3: a voice-control user says what they see. `LG AVG`, `USG-Adjusted`,
the `VA/G` / `TOT VA` sort headers and the draft owner chips had an
`aria-label` that did not contain the visible text; each now starts with it.
(Leaderboard's said "Sort by total VA" under VA+ as well.) **Open:** the
leaderboard and Awards rows are `role="button"` with a summary label
("Luka Dončić, LAL — show value added breakdown") over a row of figures.

### A4 — Heading inside a button · **FIXED**
The collapsible round / month / regular-season headers wrapped an `<h2>` in a
`<button>`: invalid, and the heading is dropped from the accessibility tree.
The heading holds the button now, with `aria-expanded`.

### A5 — Duplicate ids · **FIXED**
Each shot-distribution disc defined `#shot-blob-soft` / `#shot-blob-slice`,
six times a card and again in every other open card. One pair per card, ids
from `useId`.

### A6 — Keyboard focus lost on every sort · **FIXED**
Pressing a sort header with Enter re-sorted the table and dropped focus to
`<body>` (the header had been remounted, P3). Verified before and after on
Shot Zones, D Rating and Usage.

### A7 — College rows could not be opened from the keyboard · **FIXED**
The row was a `<div onClick>`. The player's name is a real button now (the row
still takes a tap anywhere).

### A8 — Reduced motion · **FIXED**
`prefers-reduced-motion` stops the live dot and transitions in CSS, and every
scripted smooth scroll asks `lib/motion.js`.

### A9 — Text contrast · **PARTLY FIXED (follow-up)**

> **Resolved for the near-misses:** `stone-500` is `#6f6863` and `red-600` `#d1141b` (both ~5:1 on the page), and team-colored text goes through `teamInk()`, which darkens the 17 team colors that miss 4.5:1 on their chip by the smallest step that passes. `stone-400` captions are left as designed.

The largest remaining class by far. Measured pairs:

| Text | On | Ratio | Needs | Where |
|---|---|---|---|---|
| `stone-400` `#a8a29e` | page / white | 2.3–2.5 | 4.5 | captions, column heads, ranks |
| `stone-500` `#78716c` | page `#f5f5f4` | 4.39 | 4.5 | tab labels, eyebrow, toolbar text |
| `red-600` `#dc2626` | page `#f5f5f4` | 4.42 | 4.5 | negative values on the page background |
| a few team colors | page / `stone-50` | 3.5–4.4 | 4.5 | team-colored names (ATL, OKC, ORL…) |

`stone-500` and `red-600` both pass on white (4.8) and miss only on the
`stone-100` page background. `stone-400` is the app's caption color and fails
everywhere it is used; `stone-500` on white is the nearest passing step.
`readableOn()` in `lib/format.js` already does this job for the compare
palette and could do it for team-colored names.

### A10 — Type size · **OPEN (design)**
Most failing text is 8–10px (captions at 7–8px, distance labels at 6px). WCAG
sets no minimum, and pinch-zoom is left on, but `text-size-adjust: 100%` means
the phone will not help either.

### A11 — Tap targets under 24px · **PARTLY FIXED (follow-up)**

> **Resolved where it costs nothing:** column-header buttons on the leaderboard and By Player get an invisible 26px hit area (`.hit-up`), and the night steppers fill their bar. Dense table rows are left alone: enlarging them would overlap their neighbours.

WCAG 2.5.8. Column-header buttons are 13–15px tall, the night steppers 20px,
the in-table G / MP filter buttons 15px: ~900 instances on Usage and D Rating,
35 on Explore.

### A12 — Interactive controls nested in a `role="button"` row · **OPEN**
Leaderboard rows (and the By Player seasons) are a `div role="button"` holding
the team chip, name and G buttons. It works with a pointer and with Tab, but a
screen reader announces one button and may not reach the ones inside. The
College fix (A7) is the pattern: the name is the button, the row a plain
click target.

### A13 — Pointer-only actions · **OPEN**
A box-score name's "open in By Player" is a `<span onClick>` inside the row's
button (`boxscore.js:66`), and stepping to the previous / next player is a tap
on the card's left or right edge (`va-breakdown.js` `handleSurfaceTap`).
Neither has a keyboard route.

### A14 — `<div>` inside `<button>` · **OPEN, cosmetic**
Score cards and bracket teams wrap block layout in a button. Invalid by the
content model, harmless in every browser; `<span className="block">` is the
fix if a clean validation run is ever wanted. It is the only thing
html-validate reports.

---

## 4. Security

### S1 — `/api/boxscore` forwarded an unchecked `gameId` upstream · **FIXED**
The id was written straight into `cdn.nba.com/…/boxscore_${gameId}.json` and
ESPN's `summary?event=${gameId}`, so `../` or `&` reshaped the upstream
request (the host was fixed, so not a full SSRF). Ids are now held to
`[0-9A-Za-z]{6,16}` — every shape the app sends.

### S2 — `/api/draft?season=constructor` answered 500 · **FIXED**
A plain-object lookup on a user string found `Object.prototype`. Own keys only.

### S3 — No security headers · **FIXED**
Every response now carries `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options:
SAMEORIGIN`, a `Permissions-Policy` denying camera / microphone / location,
HSTS, and a Content-Security-Policy of the directives that cannot break
loading (`frame-ancestors`, `base-uri`, `form-action`, `object-src`).
`X-Powered-By` is off. **Open:** a `script-src` policy. The client talks only
to its own origin and uses no `dangerouslySetInnerHTML`, so
`default-src 'self'` with nonces is achievable, but nonces need middleware.

### S4 — Next.js 14 is end-of-life · **FIXED (follow-up)**

> **Resolved:** upgraded to 15.5.29 with React kept at 18.3.1; `headers()` / `searchParams` awaited, tracing config moved out of `experimental`, PostCSS pinned to 8.5.29. `npm audit`: 0 vulnerabilities.

`next@14.2.35` is the last 14.x release. `npm audit` lists 25 advisories
against it (two rated critical) whose fixes exist only in 15.5.x and 16.x.
Several do not apply here — no middleware, no Server Actions, no `next/image`,
Linux hosting — but the React Server Components denial-of-service and
cache-poisoning ones concern any App Router app. Moving to 15.5.x means React
19, `await` on `headers()` and `searchParams` in `app/page.js`, and
`outputFileTracingIncludes` / `Excludes` out of `experimental`; route handlers
that rely on being static need `revalidate` or `dynamic = "force-static"`
(most already export `revalidate`). Not done here: it is a framework upgrade
that deserves its own change and a look at a preview deployment.

### S5 — Everything else on the routes · **OK**
Seasons, dates, months, slugs, tabs and award names are all pattern- or
set-checked before they reach a file name or a URL; share parameters are
dropped rather than trusted (`lib/share-params.js`); numeric query values are
clamped. No secrets in the repo; nothing user-supplied is rendered as HTML.

### S6 — Workflows · **PARTLY FIXED (follow-up)**

> `ci.yml` now has `permissions: contents: read`. The `inputs.*` interpolation and tag pinning in the bake workflows are still open.

`inputs.*` values are interpolated into `run:` lines in four bake workflows
(pass them through `env:` instead — only someone who can already dispatch a
workflow can use it); `ci.yml` has no `permissions:` block (`contents: read`
is enough); third-party actions are pinned by tag, not commit. Not edited
here: each bake workflow re-runs when its own file changes.

---

## 5. Resilience and correctness

### R1 — Hooks after an early return · **FIXED**
`boxscore.js` → `LiveGameBanner` returned `null` for a missing game *between*
its hooks. A game arriving on a mounted banner would have changed the hook
count, which React answers by throwing. The check is in a wrapper now.

### R2 — No error boundary anywhere · **FIXED**
A render error replaced the whole document with Next's bare "Application
error". There is now a boundary around the open tab (the header and tab strip
stay up, with a retry), an `app/error.js` behind it, and an `app/not-found.js`.

### R3 — A failing test on `main` · **FIXED**
`tests/projection.test.mjs` assumed every row of the Look Ahead board was a
baked projection. Since the 2026-27 box scores began baking, unprojected
players who have played join the board, so the test has failed since — and the
bakes commit with `[skip ci]`, so nothing ran to say so. 134 of 134 pass.

### R4 — TBD game dates assumed UTC−4 · **FIXED**
`boxscore.js` read a TBD game's date with a fixed four-hour offset; the East
is on UTC−5 from November to March. It uses the Eastern-time formatter the
rest of the app already has.

### R5 — The open tab could sit off the tab strip · **FIXED**
A shared link to College or Draft opened with no tab visibly selected on a
phone. The strip scrolls the open tab into view.

### R6 — Upstream failures answer 500 · **FIXED (follow-up)**

> **Resolved:** the six routes that fail on an unreachable ESPN / basketball-reference answer 502.

An unreachable ESPN is a 502 from `/api/live` but a 500 from `/api/leaderboard`,
`/api/history`, `/api/boxscore` and `/api/regular-season`. The client treats
them alike; 502 would be the accurate status. (Their error bodies were JSON
sent as `text/plain` — that part is fixed.)

---

## 6. Metadata

### M1 — No icon of any kind · **FIXED**
Every visit 404'd on `/favicon.ico`, and a Home Screen shortcut got a
screenshot. Added `app/icon.svg`, a 180px touch icon, a manifest
(`display: "browser"`, so it still opens as a tab — the app depends on the
address bar and on BuildWatch) and a theme color. The icon is a placeholder
drawing (three value-added bars); swap in a real one freely.

### M2 — Link previews, language, viewport · **OK**
Open Graph and Twitter cards are generated per shared view, `lang` is set,
and zoom is not locked. Lighthouse SEO: 100.

---

## 7. Tooling

### T1 — No lockfile · **FIXED (follow-up)**

> **Resolved:** `package-lock.json` is committed and CI installs with `npm ci`.

`package-lock.json` is git-ignored, so CI and Vercel resolve dependencies
fresh on every build; `playwright-core` is a caret range and every transitive
dependency floats. Committing the lockfile makes builds reproducible and lets
`npm ci` and `npm audit` mean something.

### T2 — The build's "lint" step does nothing · **FIXED (follow-up)**

> **Resolved:** ESLint 9 with Next's rules and jsx-a11y (`eslint.config.mjs`, `npm run lint`), run by `next build` and as its own CI step. 0 errors; the deliberate existing cases are warnings.

`ci.yml` says the build "also runs Next's lint and type checks", but ESLint is
not installed, so `next build` skips it. An ad hoc run with the React Hooks
and jsx-a11y rules is what found R1, P2, P3/A6 and A7 in a few minutes.
Adding `eslint` + `eslint-config-next` would keep them found. What that run
still reports after this change: 11 `exhaustive-deps` warnings (each read and
judged safe — closures over values that are in the list), 101 buttons with no
`type` (harmless without forms), 6 unused variables.

---

## 8. Scores after this change

| | Before | After |
|---|---|---|
| Unit tests | 133 / 134 | 134 / 134 |
| Main-thread blocking, season load, 4× CPU | ~7,100 ms | ~110 ms |
| Longest task, same load | 1,476 ms | 94 ms |
| axe rule failures, Explore | 8 rules | 4 (contrast, target size, row labels, nested rows) |
| axe: landmarks, headings, select names, duplicate ids | failing | passing on all 11 tabs |
| html-validate | heading-in-button, div-in-button | div-in-button only |
| Lighthouse performance (mobile, 2025-26 on Explore) | 70 (TBT 16,940 ms) | 99 (TBT 100 ms) |
| Lighthouse accessibility / best practices / SEO | 92 / 96 / 100 | 92 / 96 / 100 (what remains is A9–A12, and console errors from the unreachable upstreams) |
