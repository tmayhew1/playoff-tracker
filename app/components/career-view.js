"use client";

import { Fragment, useState, useEffect } from "react";
import { fetchJsonCached } from "../lib/fetch-cache";
import { teamColor } from "../lib/format";
import { anchorCLI, gameWeight, rsCLI, seriesGameWeight, ALPHA_DEFAULT } from "../lib/leverage";
import { weightForShare, P_DEFAULT, PEAK_SEASONS_DEFAULT } from "../lib/legacy";
import { positionChips, positionParent } from "../lib/positions";


// The all-time board. Legacy is deliberately TWO numbers rather than one
// (app/lib/legacy.js): LEGACY is a value-weighted fold over a career's seasons,
// which spends longevity at diminishing returns, and PEAK/G is the
// leverage-weighted rate over the best seasons. They disagree — Jokić is ninth
// by volume and third by peak — and blending them would hide exactly the
// argument the metric exists to make, so both columns are sortable and neither
// is "the" ranking.
//
// Tapping a row opens the fold itself. A career total is otherwise a number you
// have to take on faith; the expansion shows it as the sum it is — every
// season, ordered by value, with the weight that season earned and the
// playoff/regular-season split underneath. Tapping a season goes one further,
// to the stat lines behind both halves of it and every game of the run — which
// is where the weighting stops being an assertion and becomes checkable.
//
// MVP scope: the board at the default dials. The route already answers for any
// alpha/p, so exposing them is a slider away.

const fmt0 = (n) => Math.round(n).toLocaleString("en-US");
// Big numbers don't need a decimal and can't spare the width on a phone; small
// ones are unreadable without it (a 4.0 season and a 4.4 season are not the
// same season).
const fmtN = (n) => (Math.abs(n) >= 100 ? fmt0(n) : n.toFixed(1));

const COLS = "grid grid-cols-[1.1rem_1fr_3rem_2.7rem_3.2rem] gap-x-1.5 items-baseline";

// The board's five columns, shared by the header and every row so the two
// cannot drift apart. Legacy and Peak are given the same width: they are peers
// — neither is "the" ranking — and each holds its label, its sort caret and its
// digits with slack left over, which is the point. A header measured to fit
// exactly is one that breaks on the first handset whose font is a shade wider,
// which is how the caret ended up on its own line here once already.
//
// The gutter pays for that room rather than the name does: four gaps a step
// tighter — the same 1.5 the season fold uses — give back exactly what the
// wider column costs, so a long name truncates no earlier than it did before.
const BOARD_COLS = "grid grid-cols-[1.5rem_1fr_2rem_3.5rem_3.5rem] gap-x-1.5 items-center";

// Careers per page. A row carries its whole season fold, so the pages are kept
// small and asked for one at a time.
const PAGE = 50;

// The career-length gate, surfaced rather than left implicit. 400 games is
// about five full seasons and stays the default — a board about careers should
// not rank a rookie by accident — but a floor that high also hides everyone
// still early in one, and a filter you can see beats a player's unexplained
// absence.
const GAME_FLOORS = [
  [400, "400+ games"],
  [300, "300+ games"],
  [200, "200+ games"],
  [100, "100+ games"],
  [0, "No minimum"],
];


// A season row's team code is the team the row was built from: the playoff team
// where there was a run, otherwise whatever the regular-season file carried —
// which for a player traded mid-year is a "2TM"/"3TM" total rather than a
// franchise. Those keep their code but take a neutral grey: the season happened,
// it just cannot be attributed to one set of colors.
const isMultiTeam = (t) => !t || /^(TOT|\d+TM)$/.test(t);
const barColor = (t) => (isMultiTeam(t) ? "#a8a29e" : teamColor(t));


// The career bar, split by who the career was played for.
//
// Widths are shares of whatever the bar is currently drawn on, not of some third
// quantity: under Legacy that is the weighted contribution — the column that
// sums to the total — and under Peak/G it is the leveraged VA of the peak
// seasons the rate is computed over. Either way the colors partition the number
// underneath them rather than a different one.
//
// Ordered by first season, so a career reads left to right the way it was
// played. That order is taken from the WHOLE career even when only the peak
// seasons are being measured — LeBron's peak window opens in Miami, and sorting
// on it would put Miami ahead of Cleveland and reshuffle the colors the moment
// the reader switched columns.
function teamSegments(seasons, sortKey, peakSeasons) {
  const all = seasons || [];
  const scored = sortKey === "peak" ? all.slice(0, peakSeasons) : all;
  const by = new Map();
  const at = (key) => {
    if (!by.has(key)) by.set(key, { team: key, value: 0, first: null, seasons: 0 });
    return by.get(key);
  };
  for (const s of all) {
    const t = at(s.team || "—");
    if (t.first == null || s.season < t.first) t.first = s.season;
  }
  for (const s of scored) {
    const t = at(s.team || "—");
    t.value += sortKey === "peak" ? s.lva : s.contribution;
    t.seasons += 1;
  }

  // A stint a player spent below replacement subtracts from the total; it cannot
  // subtract from the bar, which has no negative length. Clamped away and the
  // rest renormalized, so the segments still fill exactly the bar they sit in.
  const segs = [...by.values()]
    .filter((t) => t.value > 0)
    .sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0));
  const sum = segs.reduce((s, t) => s + t.value, 0);
  if (!(sum > 0)) return [];
  return segs.map((t) => ({ ...t, share: t.value / sum }));
}


// One bar, `pct` wide, divided among the franchises that earned it. A hairline
// of the track shows between segments because several teams are within a shade
// of black of each other — Spurs, Nets and Nuggets would otherwise read as one
// unbroken run.
function CareerBar({ segments, pct }) {
  return (
    <div className="h-1 bg-stone-100 rounded-sm overflow-hidden flex gap-px">
      {segments.length ? segments.map((t) => (
        <div
          key={t.team}
          className="h-full"
          style={{ width: `${pct * t.share}%`, backgroundColor: barColor(t.team) }}
          title={`${t.team} · ${t.seasons} season${t.seasons === 1 ? "" : "s"} · ${(t.share * 100).toFixed(0)}% of the bar`}
        />
      )) : (
        // Nothing positive to split — a career that nets out at or below zero
        // still gets its bar, just without an attribution it hasn't earned.
        <div className="h-full rounded-sm bg-stone-900" style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}


// Sends the reader to the season leaderboard this half of the season came
// from — the playoff board or the regular-season one — filtered to the team
// and opened on the player. Absent a handler (nothing to navigate to) it
// simply doesn't render, so the panel is unchanged where the jump has no home.
//
// It rides in the stat strip's last cell rather than out on the heading, which
// is where it used to sit: eleven stats in a six-wide grid leave a twelfth cell
// empty after free throws, and a button parked there is both clear of the
// heading it was crowding and closer to the numbers it is offering more of.
function GoToBoard({ onGo, run, scope }) {
  if (!onGo || !run?.season) return null;
  return (
    <button
      type="button"
      onClick={() => onGo({
        season: run.season, team: run.team || null,
        name: run.name || null, slug: run.slug || null, scope,
      })}
      className="text-[9px] font-bold uppercase tracking-widest text-stone-400 hover:text-stone-900 whitespace-nowrap"
      title={`Open the ${scope === "regular" ? "regular-season" : "playoff"} leaderboard for ${run.team || "this team"}, ${run.season}`}
    >Go →</button>
  );
}


// One career, opened up: the summary the board has no room for, then every
// season in the order the fold consumes them.
function CareerFold({ p, weightAtHalf, segments, onGoToLeaderboard }) {
  const best = Math.max(...p.seasons.map((s) => s.contribution), 0.1);
  const [openSeason, setOpenSeason] = useState(null);

  // Why the column starts where it does. A weight is a season measured against
  // the career TOTAL, not against the best season — which it has to be, or the
  // weighted column would stop summing to Legacy. So the top weight reads how
  // concentrated a career is: recover that share by inverting the exponent.
  const topWeight = p.seasons[0]?.lva > 0 ? p.seasons[0].weight : null;
  const topShare = topWeight && P_DEFAULT > 1
    ? Math.pow(topWeight, 1 / (P_DEFAULT - 1)) : null;

  return (
    <div className="px-2 pb-3 pt-1 bg-stone-50 border-t border-stone-200">
      <div className="grid grid-cols-4 gap-x-2 py-2 text-center">
        {[
          ["Career LVA", fmt0(p.careerLVA)],
          ["Folded", fmt0(p.total)],
          ["Peak/G", p.peak.toFixed(1)],
          ["Raw/G", p.peakRaw.toFixed(1)],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="text-[9px] uppercase tracking-wider text-stone-400">{label}</div>
            <div className="text-sm font-bold text-stone-900 tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-stone-500 leading-relaxed mb-2">
        {p.seasonCount} seasons · {fmt0(p.careerGames)} games · {p.span}
        {/* The same franchises, in the same order, as the segments of the bar
            on the row above — so the colors up there can be read off. */}
        {segments?.length ? (
          <> · {segments.map((t, i) => (
            <Fragment key={t.team}>
              {i ? ", " : ""}
              <span className="font-semibold" style={{ color: barColor(t.team) }}>{t.team}</span>
            </Fragment>
          ))}</>
        ) : p.teams?.length ? <> · {p.teams.join(", ")}</> : null}. Each season is weighted by
        how good it was, not by where it lands in the sort — a season worth half his best
        carries about{" "}
        <span className="tabular-nums font-semibold">{(weightAtHalf * 100).toFixed(0)}%</span>{" "}
        of its weight, one worth a tenth carries half.{" "}
        <span className="font-semibold">Weighted</span> is the column that sums to Legacy.
        Tap any season for the stat lines behind it and every game of the run.
      </p>

      {topShare != null && (
        <p className="text-[9px] text-stone-400 leading-relaxed mb-2">
          The weights are against the career <em>total</em>, not against his best season, so
          they start below 1 and start lower the deeper the career: his best is{" "}
          <span className="tabular-nums">{(topShare * 100).toFixed(0)}%</span> of the whole,
          which puts the column at{" "}
          <span className="tabular-nums">{topWeight.toFixed(3)}</span>. That is what keeps
          Weighted summing to Legacy — the ratios between his own seasons are unaffected.
        </p>
      )}

      <div className={`${COLS} text-[9px] uppercase tracking-wider text-stone-400 pb-1 border-b border-stone-200`}>
        <span>#</span><span>Season</span>
        <span className="text-right">LVA</span>
        <span className="text-right">×W</span>
        <span className="text-right">Wtd.</span>
      </div>

      {p.seasons.map((s) => {
        // A negative season still belongs on the board — it is part of the
        // career — but it has no meaningful playoff/RS split to draw, so it
        // gets one red bar instead of two stacked ones.
        const down = s.lva <= 0;
        const width = Math.min(100, (Math.abs(s.contribution) / best) * 100);
        const poShare = down ? 0 : Math.max(0, Math.min(1, s.poLVA / s.lva));
        const seasonOpen = openSeason === s.season;
        return (
          <div key={s.season} className="pt-1 pb-1.5 border-b border-stone-100 last:border-0">
            <button
              type="button"
              aria-expanded={seasonOpen}
              onClick={() => setOpenSeason(seasonOpen ? null : s.season)}
              className={`${COLS} text-[11px] w-full text-left ${seasonOpen ? "" : "hover:bg-stone-100/70"}`}
            >
              <span className="tabular-nums text-stone-400">{s.rank}</span>
              <span className="min-w-0">
                <span className="text-stone-400 text-[8px] mr-0.5">{seasonOpen ? "▾" : "▸"}</span>
                <span className="font-semibold text-stone-800">{s.season}</span>
                {/* A season with no playoff run says "82 RS", not "0 PO · 82 RS" —
                    missing the playoffs is already legible from the empty dark
                    segment on the bar. */}
                <span className="text-[9px] text-stone-500 tabular-nums">
                  {s.team ? ` ${s.team}` : ""}
                  {[s.poGames ? `${s.poGames} PO` : null, s.rsGames ? `${s.rsGames} RS` : null]
                    .filter(Boolean).map((part) => ` · ${part}`).join("")}
                </span>
              </span>
              <span className={`text-right tabular-nums ${down ? "text-red-600" : "text-stone-600"}`}>{fmtN(s.lva)}</span>
              <span className="text-right tabular-nums text-stone-400">{s.weight.toFixed(3)}</span>
              <span className={`text-right tabular-nums font-bold ${down ? "text-red-600" : "text-stone-900"}`}>{fmtN(s.contribution)}</span>
            </button>
            <div className="h-1 mt-1 bg-stone-200/60 rounded-sm overflow-hidden flex">
              {down ? (
                <div className="h-full bg-red-500" style={{ width: `${width}%` }} />
              ) : (
                <>
                  {/* The playoff half takes the team's colors, so a season bar
                      says who it was played for without reading the row. The
                      regular season stays grey for every team: coloring both
                      halves would cost the split the contrast it exists for. */}
                  <div
                    className="h-full"
                    style={{ width: `${width * poShare}%`, backgroundColor: barColor(s.team) }}
                  />
                  <div className="h-full bg-stone-400" style={{ width: `${width * (1 - poShare)}%` }} />
                </>
              )}
            </div>
            {seasonOpen && (
              <SeasonPanel slug={p.slug} season={s.season} onGoToLeaderboard={onGoToLeaderboard} />
            )}
          </div>
        );
      })}

      <p className="text-[9px] text-stone-400 leading-relaxed mt-2">
        Bars are each season&apos;s discounted value against this career&apos;s best — the
        colored part is the playoff run, in that season&apos;s team colors;{" "}
        <span className="text-stone-500 font-semibold">grey</span> is the regular season.
        The playoffs are a fraction of the games and usually most of the bar; that
        is leverage doing its job, not a scaling error.
      </p>
    </div>
  );
}


// The production behind half a season, with what each part of it was worth.
// Every column maps to exactly one VA category, so the bottom line reads as the
// decomposition it is — and the ten of them sum to the run's VA/G.
//
// Eleven columns do not fit a portrait phone, so it wraps to two rows and opens
// out to one the moment the handset is turned — see the `tilt` screen in
// tailwind.config.js, which keys off orientation rather than width because a
// landscape phone can be narrower than any width breakpoint.
const STAT_COLS = [
  ["MPG", "mpg", null],
  ["PTS", "pts", "Points"],
  ["DRB", "drb", "D Rebounds"],
  ["ORB", "orb", "O Rebounds"],
  ["AST", "ast", "Assists"],
  ["STL", "stl", "Steals"],
  ["BLK", "blk", "Blocks"],
  ["TOV", "tov", "Turnovers"],
  ["2P%", "tw", "2-Pointers"],
  ["3P%", "tp", "3-Pointers"],
  ["FT%", "ft", "Free Throws"],
];

// Decimals the VA line prints at. The comparison below rounds to it before
// deciding, so the arrow always agrees with the two numbers on screen: a pair
// that both print -0.7 gets the neutral dash rather than an arrow tracking a
// difference in a digit the reader is never shown.
const VA_DP = 1;

// Which way a playoff category moved against the same category in the regular
// season. Higher VA is better for every one of them — a turnover line costs
// points, so -1.9 against -2.2 is a category he gave away LESS of, and reads as
// up. That makes a plain numeric comparison the right one throughout; no column
// needs its sense inverted.
function vaTrend(va, prior) {
  if (va == null || prior == null) return null;
  const now = Number(va.toFixed(VA_DP));
  const then = Number(prior.toFixed(VA_DP));
  return now > then ? "up" : now < then ? "down" : "flat";
}

const TREND = {
  up: ["↑", "more than"],
  down: ["↓", "less than"],
  flat: ["—", "the same as"],
};

function StatStrip({ stats, compareTo, action, note }) {
  if (!stats) return null;
  return (
    <div className="block px-2 pb-2 overflow-x-auto">
      {/* Eleven stats over six columns leave the twelfth cell empty, and that
          is where `action` goes. Turned sideways the row opens to twelve so the
          button keeps its place at the end of the line rather than dropping to
          a row of its own; with nothing to put there it stays eleven, so the
          strip does not carry a blank column it has no use for. */}
      <div className={`grid grid-cols-6 ${action ? "tilt:grid-cols-12" : "tilt:grid-cols-11"} gap-x-1 gap-y-2`}>
        {STAT_COLS.map(([label, key, cat]) => {
          const v = stats[key];
          const va = cat ? stats.va?.[cat] : null;
          const prior = cat && compareTo ? compareTo.va?.[cat] : null;
          const trend = vaTrend(va, prior);
          const [glyph, phrase] = trend ? TREND[trend] : [];
          return (
            <div key={label} className="text-center">
              <div className="text-[8px] uppercase tracking-wider text-stone-400">{label}</div>
              <div className="text-[11px] font-semibold text-stone-800 tabular-nums leading-tight">
                {v == null ? "—" : v.toFixed(key.endsWith("%") || cat === "2-Pointers" || cat === "3-Pointers" || cat === "Free Throws" ? 1 : 1)}
              </div>
              <div
                className={`text-[9px] tabular-nums leading-tight ${
                  va == null ? "text-stone-300"
                    : va < 0 ? "text-red-600" : "text-stone-500"}`}
                title={trend ? `${label}: worth ${phrase} in the playoffs (${va.toFixed(VA_DP)}) as in the regular season (${prior.toFixed(VA_DP)})` : undefined}
              >
                {va == null ? "·" : (va > 0 ? "+" : "") + va.toFixed(VA_DP)}
                {/* Grey whichever way it points. The number beside it is already
                    red when the category cost him points, and a second colour
                    saying something else about the same figure would read as
                    disagreeing with the first. */}
                {glyph && <span className="ml-[1px] text-stone-400" aria-hidden="true">{glyph}</span>}
              </div>
            </div>
          );
        })}
        {action && <div className="text-center self-center">{action}</div>}
      </div>
      <div className="text-[8px] text-stone-400 mt-1">
        {note || "Per game, with the Value Added each one contributed underneath — the ten add up to VA/G."}
      </div>
    </div>
  );
}


// One season, opened all the way up: the production behind both halves of it,
// and every game of the playoff run underneath.
//
// All of it comes from one response — /api/legacy/runs with a slug and a season
// carries the playoff line, the regular season beside it, and the game log —
// so the fold asks once and shows the lot.
function SeasonPanel({ slug, season, onGoToLeaderboard }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Cleared on the way in: without this a panel reopened on a different
    // season shows the previous one's numbers until the fetch lands.
    setD(null);
    setError(null);
    fetchJsonCached(`/api/legacy/runs?slug=${encodeURIComponent(slug)}&season=${encodeURIComponent(season)}`)
      .then((r) => { if (!cancelled) setD(r); })
      .catch((e) => { if (!cancelled) setError(e.message || "Load failed"); });
    return () => { cancelled = true; };
  }, [slug, season]);

  if (error) return <div className="px-2 py-2 text-[10px] text-red-600">Couldn’t load — {error}</div>;
  if (!d) return <div className="px-2 py-2 text-[10px] text-stone-500 italic">Loading…</div>;

  const po = d.run.stats, rs = d.run.rsStats;
  const games = d.games || [];
  // Asked once here rather than inside the button: the strip has to size its
  // grid around whether there is a button to place, before it renders one.
  const canGo = !!(onGoToLeaderboard && d.run?.season);
  const best = Math.max(...games.map((g) => Math.abs(g.contribution)), 0.1);
  const ROUND = { 1: "R1", 2: "R2", 3: "CF", 4: "F" };

  return (
    <div className="bg-white border-t border-b border-stone-200 pt-2 mt-1 mb-1">
      {po && (
        <>
          <div className="px-2 text-[9px] uppercase tracking-widest text-stone-500">
            {/* Where the run sits among every postseason run on record — the
                one number here that is about the field rather than about this
                career. */}
            Playoffs · {po.games} games{d.run.rank ? ` · #${d.run.rank.toLocaleString()} all time` : ""}
          </div>
          {/* Drawn against the regular season below it wherever there is one:
              each playoff VA carries an arrow saying whether that part of his
              game was worth more in the postseason than over the winter. */}
          <StatStrip
            stats={po}
            compareTo={rs}
            action={canGo ? <GoToBoard onGo={onGoToLeaderboard} run={d.run} scope="playoffs" /> : null}
            note={rs
              ? "Per game, with the Value Added each contributed underneath — the ten sum to the run’s VA/G. The arrow reads each against the same category in the regular season below; both are per game, so heavier playoff minutes lift the lot."
              : "Per game, with the Value Added each contributed underneath — the ten sum to the run’s VA/G."}
          />
        </>
      )}

      {rs && (
        <>
          <div className="px-2 text-[9px] uppercase tracking-widest text-stone-500">
            Regular season · {rs.games} games
          </div>
          <StatStrip
            stats={rs}
            action={canGo ? <GoToBoard onGo={onGoToLeaderboard} run={d.run} scope="regular" /> : null}
            note="Computed on season totals, the same way the regular season’s VA is."
          />
        </>
      )}

      {!po && !rs && (
        <div className="px-2 py-2 text-[10px] text-stone-400 italic">No stat line on record for this season.</div>
      )}

      {/* Every game of the run, heaviest contribution first. This is where the
          weighting becomes checkable — a bigger night in an earlier round can
          sit below a quieter one in the Finals, and here you can see why. */}
      {games.length > 0 && (
        <div className="px-2 pb-3 pt-2 mt-1 bg-stone-50 border-t border-stone-200">
          <p className="text-[10px] text-stone-500 leading-relaxed mb-2">
            {games.length} games, biggest contribution first. Every game of a series
            carries the same weight, so the order is what he did times what the series
            was worth — <span className="font-semibold">VA × weight</span>.
          </p>

          <div className="grid grid-cols-[4.6rem_1fr_2.6rem_2.4rem_3rem] gap-x-1.5 text-[9px] uppercase tracking-wider text-stone-400 pb-1 border-b border-stone-200">
            <span>Game</span><span>Line</span>
            <span className="text-right">VA</span>
            <span className="text-right">×W</span>
            <span className="text-right">Total</span>
          </div>

          {games.map((g) => {
            const down = g.contribution < 0;
            return (
              <div key={g.gameId} className="pt-1 pb-1.5 border-b border-stone-100 last:border-0">
                <div className="grid grid-cols-[4.6rem_1fr_2.6rem_2.4rem_3rem] gap-x-1.5 items-baseline text-[11px]">
                  <span className="tabular-nums text-stone-700 font-semibold">
                    {ROUND[g.round] || `R${g.round}`} {g.opp}
                    <span className="text-stone-400 font-normal"> G{g.gameNo}</span>
                  </span>
                  <span className="text-[10px] text-stone-500 tabular-nums truncate">
                    {g.pts}p {g.reb}r {g.ast}a
                    {g.stl ? ` ${g.stl}s` : ""}{g.blk ? ` ${g.blk}b` : ""}
                    {" · "}{g.fgm}/{g.fga}{g.fta ? ` ${g.ftm}/${g.fta}ft` : ""}
                    {" · "}{Math.round(g.mp)}m
                  </span>
                  <span className={`text-right tabular-nums ${g.va < 0 ? "text-red-600" : "text-stone-600"}`}>{g.va.toFixed(1)}</span>
                  <span className="text-right tabular-nums text-stone-400">{g.weight.toFixed(2)}</span>
                  <span className={`text-right tabular-nums font-bold ${down ? "text-red-600" : "text-stone-900"}`}>{g.contribution.toFixed(0)}</span>
                </div>
                <div className="h-1 mt-1 bg-stone-200/60 rounded-sm overflow-hidden">
                  <div className={`h-full rounded-sm ${down ? "bg-red-500" : "bg-stone-900"}`}
                    style={{ width: `${(Math.abs(g.contribution) / best) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// The positional filter, as a drill-down rather than eight chips in a row.
//
// Position is a hierarchy the reader already holds — a point guard is a guard —
// and laying all eight out flat both fills the width on a phone and makes "the
// guards" and "the point guards" read as unrelated choices rather than one
// inside the other. So the row starts at the three buckets and opens the one
// that gets picked: G becomes PG/SG/F/C, and picking PG leaves SG/F/C — his
// sibling, and the buckets to switch to. positionChips() in app/lib/positions.js
// is the rule; this only draws it.
//
// The active chip leads the row and steps back OUT one level when tapped (PG to
// all guards, G to the whole board), so the same gesture that climbed the ladder
// walks it back down. A plain clear would strand a reader two levels in with no
// way back to "all guards" except starting over.
function PositionFilter({ value, onChange }) {
  const parent = positionParent(value);
  return (
    // shrink-0 throughout: the row sits in an overflow-x-auto parent, and
    // without it a narrow phone compresses the chips into unreadable slivers
    // instead of letting the row scroll.
    <div className="flex items-center gap-1 w-max">
      <label className="text-[10px] uppercase tracking-widest text-stone-400 shrink-0">Pos</label>
      {value && (
        <button
          onClick={() => onChange(parent)}
          className="text-[11px] px-2 py-1.5 border border-stone-900 bg-stone-900 text-white shrink-0"
          title={parent ? `Back to all ${parent}` : "Show every position"}
        >{value} ✕</button>
      )}
      {positionChips(value).map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className="text-[11px] px-2 py-1.5 border border-stone-300 bg-white text-stone-700 hover:border-stone-500 hover:text-stone-900 shrink-0"
          title={`Filter to ${c}`}
        >{c}</button>
      ))}
    </div>
  );
}

function CareersBoard({ onGoToLeaderboard }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("total"); // "total" | "peak"
  const [open, setOpen] = useState(null);          // expanded player's slug

  // Pages accumulate rather than being refetched at a bigger size: a career
  // carries its whole season fold, so re-asking for the first fifty every time
  // would re-download the expensive part of the list on every tap.
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [minGames, setMinGames] = useState(400);
  const [pos, setPos] = useState("");

  const url = (offset) => `/api/legacy?top=${PAGE}&offset=${offset}&sort=${sortKey}`
    + `&q=${encodeURIComponent(query.trim())}&minGames=${minGames}&pos=${pos}`;

  // Debounced so a typed name is one request, not one per keystroke. Any change
  // to the sort or the search starts the list again from the first page.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      fetchJsonCached(url(0))
        .then((d) => { if (!cancelled) { setData(d); setRows(d.players || []); setError(null); } })
        .catch((e) => { if (!cancelled) setError(e.message || "Load failed"); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, query ? 220 : 0);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey, query, minGames, pos]);

  useEffect(() => { setOpen(null); }, [sortKey, query, minGames, pos]);

  const more = () => {
    if (loading) return;
    setLoading(true);
    fetchJsonCached(url(rows.length))
      .then((d) => {
        // Discard a page that lands after the sort or the search moved on.
        if (d.sort !== sortKey || d.offset !== rows.length
          || (d.query || "") !== query.trim()
          || (d.pos || "") !== pos
          || d.dials?.minGames !== minGames) return;
        setRows((prev) => [...prev, ...(d.players || [])]);
      })
      .catch((e) => setError(e.message || "Load failed"))
      .finally(() => setLoading(false));
  };

  const shown = rows;

  if (error) return <div className="text-[10px] text-red-600 py-6 text-center px-2 break-words">Couldn’t load — {error}</div>;
  if (!data) return <div className="text-[10px] text-stone-500 italic py-6 text-center">Ranking careers…</div>;
  const total = data.matched ?? data.qualified;

  // The board arrives sorted, so the leader is the scale for every bar — it
  // stays put as more pages land instead of rescaling the rows already read.
  const max = Math.max(shown[0]?.[sortKey] ?? 0, 0.1);
  const anyTruncated = shown.some((p) => p.truncated);
  const head = (key, label) => (
    <button
      onClick={() => setSortKey(key)}
      className={`text-right uppercase tracking-wider whitespace-nowrap ${sortKey === key ? "text-stone-900 font-bold" : "text-stone-400 hover:text-stone-600"}`}
    >{/* A non-breaking space, and nowrap on top of it: the caret belongs to the
         label it marks, and a column narrow enough to break between them would
         drop it onto a second line and push the header row taller than the
         rule under it. */}
      {label}{sortKey === key ? "\u00A0▾" : ""}</button>
  );

  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-3">
        {data.firstSeason}–{data.lastSeason} · {data.qualified.toLocaleString()} careers qualified
      </div>

      <p className="text-[11px] text-stone-600 leading-relaxed mb-3">
        <span className="font-semibold">Legacy</span> is a career&apos;s value with every game
        priced by what was at stake; <span className="font-semibold">Peak</span> is the same
        weighting as a per-game rate over the best {data.dials.peakSeasons} seasons. Tap either to sort,
        or a player for the season-by-season fold — and the{" "}
        <span className="font-bold">i</span> above for how the number is built. Each bar is
        split into the franchises that built it, earliest first.
      </p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a player…"
        className="w-full text-sm text-stone-900 bg-white border border-stone-300 px-3 py-2 mb-2"
      />

      <div className="flex items-center gap-2 mb-2">
        <label className="text-[10px] uppercase tracking-widest text-stone-400">Min</label>
        <select
          value={minGames}
          onChange={(e) => setMinGames(Number(e.target.value))}
          className="text-[11px] bg-white border border-stone-300 px-2 py-1.5 text-stone-800"
          title="Career games a player must have played to appear"
        >
          {GAME_FLOORS.map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        {minGames !== 400 && (
          <button
            onClick={() => setMinGames(400)}
            className="text-[10px] uppercase tracking-widest text-stone-400 hover:text-stone-700"
          >✕ Reset</button>
        )}
        <span className="ml-auto text-[10px] text-stone-400 tabular-nums">
          {query.trim() || pos
            ? `${total.toLocaleString()} of ${data.qualified.toLocaleString()}`
            : `${data.qualified.toLocaleString()} careers`}
        </span>
      </div>

      {/* Hidden until the corpus actually carries positions: the field lands
          season by season as the backfill runs, and a filter whose every option
          empties the board would read as a broken board rather than a pending
          one. */}
      {data.hasPos && (
        <div className="mb-2 overflow-x-auto">
          <PositionFilter value={pos} onChange={setPos} />
        </div>
      )}

      <div className={`${BOARD_COLS} text-[10px] uppercase tracking-wider text-stone-400 px-2 pb-1 border-b border-stone-200`}>
        <span></span><span>Player</span><span className="text-right">Yr</span>
        {head("total", "Legacy")}
        {/* "Peak", not "Peak/G": the per-game part is spelled out in the
            paragraph above the board and in the fold's own tile, and four
            characters plus a sort caret fit any handset's idea of this font
            with room to spare. */}
        {head("peak", "Peak")}
      </div>

      {!shown.length && (
        <div className="text-[10px] text-stone-400 italic py-6 text-center">
          {/* Name the filter that actually emptied the board — with a position
              on, "no careers qualified" reads as a broken board rather than as
              a search the reader can widen. */}
          {query.trim()
            ? <>No {pos ? `${pos} ` : ""}careers match &ldquo;{query.trim()}&rdquo;.</>
            : pos ? `No ${pos} careers at this games minimum.` : "No careers qualified."}
        </div>
      )}

      {shown.map((p) => {
        const isOpen = open === p.slug;
        const segments = teamSegments(p.seasons, sortKey, data.dials.peakSeasons);
        return (
          <div key={p.slug} className="border-b border-stone-100">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : p.slug)}
              className={`w-full text-left ${BOARD_COLS} px-2 pt-1.5 text-sm ${isOpen ? "bg-stone-50" : "hover:bg-stone-50"}`}
            >
              {/* The rank the server assigned in the sorted order, not the row's
                  position in whatever has been paged in so far. */}
              <span className="text-[10px] tabular-nums text-stone-400">{p.rank.toLocaleString()}</span>
              <span className="min-w-0">
                <span className="font-semibold text-stone-800 block truncate">
                  <span className="text-stone-400 text-[9px] mr-1">{isOpen ? "▾" : "▸"}</span>
                  {p.name}{p.truncated ? <span className="text-stone-400"> *</span> : null}
                </span>
                <span className="text-[10px] text-stone-500 tabular-nums">
                  {p.span} · {fmt0(p.careerGames)} G
                </span>
              </span>
              <span className="text-right tabular-nums text-stone-600">{p.seasonCount}</span>
              <span className={`text-right tabular-nums font-bold ${sortKey === "total" ? "text-stone-900" : "text-stone-500"}`}>{fmt0(p.total)}</span>
              <span className={`text-right tabular-nums ${sortKey === "peak" ? "text-stone-900 font-bold" : "text-stone-500"}`}>{p.peak.toFixed(1)}</span>
            </button>
            <div className={`px-2 pt-1 ${isOpen ? "pb-2" : "pb-1.5"}`}>
              <CareerBar segments={segments} pct={Math.max(0, ((p[sortKey] ?? 0) / max) * 100)} />
            </div>
            {isOpen && (
              <CareerFold
                p={p}
                weightAtHalf={data.weightAtHalf}
                segments={segments}
                onGoToLeaderboard={onGoToLeaderboard}
              />
            )}
          </div>
        );
      })}

      {shown.length < total ? (
        <button
          onClick={more}
          disabled={loading}
          className="w-full mt-2 py-2 text-[10px] font-bold uppercase tracking-widest text-stone-500 border border-stone-300 hover:bg-stone-50 disabled:text-stone-300"
        >
          {loading
            ? "Loading…"
            : `Show more · ${shown.length.toLocaleString()} of ${total.toLocaleString()}`}
        </button>
      ) : (
        shown.length > 0 && (
          <div className="text-[10px] text-stone-400 italic mt-2 text-center">
            {query.trim()
              ? `All ${total.toLocaleString()} matching careers shown.`
              : `All ${total.toLocaleString()} qualifying careers shown.`}
          </div>
        )
      )}

      <div className="text-[10px] text-stone-400 italic mt-2 leading-relaxed">
        {anyTruncated && (
          <>* career reaches {data.firstSeason}, the first season on record — it may extend
          earlier, in which case only part of it is measured.<br /></>
        )}
        Seasons are weighted by value, not rank: one worth a share s of a career&apos;s best
        carries s<sup>{(data.dials.p - 1).toFixed(3)}</sup> of its weight (p = {data.dials.p}).
        {data.calibration?.isDefault ? (
          <> That is set by one stated rule — a season worth a tenth of your best should still
          carry half the weight — rather than chosen, and it means the weights adapt to the
          career instead of being imposed on it.</>
        ) : null}{" "}
        Leverage α {data.dials.alpha}; regular season{" "}
        {data.dials.includeRS ? "included" : "excluded"}; minimum{" "}
        {data.dials.minSeasons > 1 ? `${data.dials.minSeasons} seasons and ` : ""}
        {fmt0(data.dials.minGames)} career games.
      </div>
    </div>
  );
}



// What the score is made of, in the order it is built. Every number below is
// computed from the shipped functions rather than typed in, so the explanation
// cannot drift away from the metric it describes.
const ROUND_LABELS = [["Round 1", 3], ["Round 2", 2], ["Conf. finals", 1], ["Finals", 0]];
const shadeFor = (w) => (w >= 2.9 ? "bg-stone-900 text-white"
  : w >= 2.0 ? "bg-stone-700 text-white"
  : w >= 1.4 ? "bg-stone-500 text-white"
  : w >= 1.0 ? "bg-stone-300 text-stone-900"
  : "bg-stone-200 text-stone-900");

function LegacyInfo({ dials }) {
  const alpha = dials?.alpha ?? ALPHA_DEFAULT;
  const p = dials?.p ?? P_DEFAULT;
  // A modern bracket: four rounds deep, quoted against its own opening series.
  const rsW = gameWeight(rsCLI("2015-16", 4), alpha, anchorCLI(4, 7));
  const shares = [1, 0.5, 0.25, 0.1];

  return (
    <div className="mb-3 p-3 bg-white border border-stone-300 text-[11px] text-stone-600 leading-relaxed">
      <p className="mb-2">
        Legacy answers one question with two instruments. <span className="font-semibold">Value
        Added</span> says what a stat line was worth in points above the league&apos;s typical
        minute. <span className="font-semibold">Championship leverage</span> says what the game
        it happened in was worth — how much winning moves the probability of a title, under a
        neutral coin where every game and every future series is a 50/50. Multiply, and add up.
      </p>

      <div className="text-[9px] uppercase tracking-widest text-stone-400 mt-3 mb-1">
        1 · What a playoff game is worth
      </div>
      <p className="mb-2">
        The stake belongs to the <span className="font-semibold">series</span>, not the score
        it reaches. Winning one moves a title by half for every round still to come, and that
        stake is shared across however many games the series takes — so closing a team out in
        four concentrates it rather than forfeiting it.
      </p>
      <div className="grid grid-cols-[3.9rem_repeat(4,1fr)] gap-[2px] mb-1">
        <span />
        {[4, 5, 6, 7].map((n) => (
          <span key={n} className="text-[8px] uppercase tracking-wider text-stone-400 text-center">{n} gm</span>
        ))}
        {ROUND_LABELS.map(([label, ra]) => (
          <Fragment key={label}>
            <span className="text-[9px] text-stone-500 flex items-center">{label}</span>
            {[4, 5, 6, 7].map((n) => {
              const w = seriesGameWeight(ra, 4, n, alpha);
              return (
                <span key={n} className={`text-[10px] font-bold tabular-nums text-center py-1 ${shadeFor(w)}`}>
                  {w.toFixed(2)}
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>
      <p className="text-[9px] text-stone-400 mb-2">
        Each game of that series, against a round-1 series of average length = 1.00.
      </p>

      <div className="text-[9px] uppercase tracking-widest text-stone-400 mt-3 mb-1">
        2 · What a regular-season game is worth
      </div>
      <p className="mb-2">
        Priced the same way. A whole winter plays for a playoff berth, which under the same
        coin is <span className="font-semibold">one sixteenth of a title</span>; spread across
        82 games that comes to <span className="font-bold tabular-nums text-stone-900">{rsW.toFixed(2)}</span> a
        night — about a seventh of a playoff opener, and a twenty-ninth of a Finals game closed
        out in four.
      </p>

      <div className="text-[9px] uppercase tracking-widest text-stone-400 mt-3 mb-1">
        3 · How the seasons add up
      </div>
      <p className="mb-2">
        A career is folded by <span className="font-semibold">how good each season was</span>,
        not by where it ranks — a rank rule would count your eighth-best season the same
        fraction whether it was nearly your best or nearly worthless. One rule sets the curve:
        a season worth a tenth of your best still carries half the weight.
      </p>
      <div className="mb-1">
        {shares.map((sh) => {
          const w = weightForShare(sh, p);
          return (
            <div key={sh} className="grid grid-cols-[4.6rem_1fr_2rem] gap-2 items-center py-[2px]">
              <span className="text-[9px] text-stone-500 text-right tabular-nums">{sh * 100}% as good</span>
              <span className="h-1.5 bg-stone-100 rounded-sm overflow-hidden">
                <span className="block h-full bg-stone-900 rounded-sm" style={{ width: `${w * 100}%` }} />
              </span>
              <span className="text-[10px] font-bold tabular-nums text-stone-900">{w.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[9px] text-stone-400 mb-2">
        Weight relative to a career&apos;s own best season{p ? ` (p = ${p})` : ""}. The shape adapts:
        many near-peak years all count, a lone towering season doesn&apos;t lift the rest.
      </p>

      <div className="text-[9px] uppercase tracking-widest text-stone-400 mt-3 mb-1">
        4 · Two numbers, not one
      </div>
      <p className="mb-0">
        <span className="font-semibold">Legacy</span> is that folded total — how much a career
        produced when its games are priced by what was at stake.{" "}
        <span className="font-semibold">Peak/G</span> is the same weighting as a rate over the
        best {dials?.peakSeasons ?? PEAK_SEASONS_DEFAULT} seasons. They disagree, and the disagreement is the
        point: sort by either.
      </p>
    </div>
  );
}


// The career board. Legacy is deliberately two numbers rather than one, the
// board makes that argument, and a career opens into the seasons it was folded
// from — each of those into the stat lines and the games behind them.
export function CareerView({ onGoToLeaderboard = null }) {
  const [info, setInfo] = useState(false);

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-base font-bold text-stone-900">Career</h2>
        <button
          onClick={() => setInfo((v) => !v)}
          aria-expanded={info}
          aria-label="How the Legacy score is calculated"
          title="How the Legacy score is calculated"
          className={`w-4 h-4 shrink-0 self-center rounded-full border text-[9px] font-bold leading-none flex items-center justify-center ${
            info
              ? "bg-stone-900 border-stone-900 text-white"
              : "border-stone-400 text-stone-500 hover:border-stone-900 hover:text-stone-900"}`}
        >i</button>
      </div>

      {info && <LegacyInfo />}

      <CareersBoard onGoToLeaderboard={onGoToLeaderboard} />
    </div>
  );
}
