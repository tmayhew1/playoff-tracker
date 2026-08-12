"use client";

import { Fragment, useState, useEffect } from "react";
import { fetchJsonCached } from "../lib/fetch-cache";
import { anchorCLI, gameWeight, rsCLI, seriesGameWeight, ALPHA_DEFAULT } from "../lib/leverage";
import { weightForShare, P_DEFAULT, PEAK_SEASONS_DEFAULT } from "../lib/legacy";


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
// playoff/regular-season split underneath.
//
// MVP scope: the board at the default dials. The route already answers for any
// alpha/p, so exposing them is a slider away.

const fmt0 = (n) => Math.round(n).toLocaleString("en-US");
// Big numbers don't need a decimal and can't spare the width on a phone; small
// ones are unreadable without it (a 4.0 season and a 4.4 season are not the
// same season).
const fmtN = (n) => (Math.abs(n) >= 100 ? fmt0(n) : n.toFixed(1));

const COLS = "grid grid-cols-[1.1rem_1fr_3rem_2.7rem_3.2rem] gap-x-1.5 items-baseline";

// Careers per page. A row carries its whole season fold, so the pages are kept
// small and asked for one at a time.
const PAGE = 50;


// Sends the reader to the season leaderboard this half of the season came
// from — the playoff board or the regular-season one — filtered to the team
// and opened on the player. Absent a handler (nothing to navigate to) it
// simply doesn't render, so the panel is unchanged where the jump has no home.
function GoToBoard({ onGo, run, scope }) {
  if (!onGo || !run?.season) return null;
  return (
    <button
      type="button"
      onClick={() => onGo({
        season: run.season, team: run.team || null,
        name: run.name || null, slug: run.slug || null, scope,
      })}
      className="ml-auto text-[9px] font-bold uppercase tracking-widest text-stone-400 hover:text-stone-900 whitespace-nowrap"
      title={`Open the ${scope === "regular" ? "regular-season" : "playoff"} leaderboard for ${run.team || "this team"}, ${run.season}`}
    >Go →</button>
  );
}


// One season of a career, opened up: the production behind both halves of it.
// Fetched on tap from the same endpoint the runs board uses, so the playoff
// line here is the identical line there — and the regular season, which the
// runs board has no reason to carry, sits beside it.
function SeasonDetail({ slug, season, onGoToLeaderboard }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchJsonCached(`/api/legacy/runs?slug=${encodeURIComponent(slug)}&season=${encodeURIComponent(season)}`)
      .then((r) => { if (!cancelled) setD(r); })
      .catch((e) => { if (!cancelled) setError(e.message || "Load failed"); });
    return () => { cancelled = true; };
  }, [slug, season]);

  if (error) return <div className="px-2 py-2 text-[10px] text-red-600">Couldn’t load — {error}</div>;
  if (!d) return <div className="px-2 py-2 text-[10px] text-stone-500 italic">Loading…</div>;

  const po = d.run.stats, rs = d.run.rsStats;
  return (
    <div className="bg-white border-t border-b border-stone-200 pt-2 mt-1 mb-1">
      {po && (
        <>
          <div className="px-2 flex items-baseline gap-2">
            <span className="text-[9px] uppercase tracking-widest text-stone-500">
              Playoffs · {po.games} games{d.run.rank ? ` · #${d.run.rank.toLocaleString()} all time` : ""}
            </span>
            <GoToBoard onGo={onGoToLeaderboard} run={d.run} scope="playoffs" />
          </div>
          <StatStrip stats={po} always note="Per game, with the Value Added each contributed underneath — the ten sum to the run’s VA/G." />
        </>
      )}
      {rs && (
        <>
          <div className="px-2 flex items-baseline gap-2">
            <span className="text-[9px] uppercase tracking-widest text-stone-500">
              Regular season · {rs.games} games
            </span>
            <GoToBoard onGo={onGoToLeaderboard} run={d.run} scope="regular" />
          </div>
          <StatStrip stats={rs} always note="Computed on season totals, the same way the regular season’s VA is." />
        </>
      )}
      {!po && !rs && (
        <div className="px-2 py-2 text-[10px] text-stone-400 italic">No stat line on record for this season.</div>
      )}
    </div>
  );
}


// One career, opened up: the summary the board has no room for, then every
// season in the order the fold consumes them.
function CareerFold({ p, weightAtHalf, onGoToLeaderboard }) {
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
        {p.teams?.length ? <> · {p.teams.join(", ")}</> : null}. Each season is weighted by
        how good it was, not by where it lands in the sort — a season worth half his best
        carries about{" "}
        <span className="tabular-nums font-semibold">{(weightAtHalf * 100).toFixed(0)}%</span>{" "}
        of its weight, one worth a tenth carries half.{" "}
        <span className="font-semibold">Weighted</span> is the column that sums to Legacy.
        Tap any season for the stat line behind it.
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
                  <div className="h-full bg-stone-900" style={{ width: `${width * poShare}%` }} />
                  <div className="h-full bg-stone-400" style={{ width: `${width * (1 - poShare)}%` }} />
                </>
              )}
            </div>
            {seasonOpen && <SeasonDetail slug={p.slug} season={s.season} onGoToLeaderboard={onGoToLeaderboard} />}
          </div>
        );
      })}

      <p className="text-[9px] text-stone-400 leading-relaxed mt-2">
        Bars are each season&apos;s discounted value against this career&apos;s best —{" "}
        <span className="text-stone-900 font-semibold">dark</span> is the playoff run,{" "}
        <span className="text-stone-500 font-semibold">light</span> the regular season.
        The playoffs are a fraction of the games and usually most of the bar; that
        is leverage doing its job, not a scaling error.
      </p>
    </div>
  );
}


// The production behind a run, with what each part of it was worth. Every
// column maps to exactly one VA category, so the bottom line reads as the
// decomposition it is — and the ten of them sum to the run's VA/G.
//
// Hidden on a portrait phone and shown the moment the handset is turned
// sideways — see the `tilt` screen in tailwind.config.js, which keys off
// orientation rather than width because a landscape phone can be narrower than
// any width breakpoint. It scrolls inside its own box rather than pushing the
// page sideways when the viewport is narrower than the eleven columns need.
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

// `always` drops the orientation gate: on the runs board the strip rides every
// row, so it waits for the phone to be turned; inside a season drop-down it is
// already behind a tap and should just be there.
function StatStrip({ stats, always, note }) {
  if (!stats) return null;
  return (
    <div className={`${always ? "block" : "hidden tilt:block"} px-2 pb-2 overflow-x-auto`}>
      {/* On the runs board the strip is one landscape-only line. Inside a
          season drop-down it has to work in portrait too, so there it wraps to
          two rows rather than scrolling off the edge of a phone. */}
      <div className={always
        ? "grid grid-cols-6 tilt:grid-cols-11 gap-x-1 gap-y-2"
        : "grid grid-cols-11 gap-x-1 min-w-[34rem]"}>
        {STAT_COLS.map(([label, key, cat]) => {
          const v = stats[key];
          const va = cat ? stats.va?.[cat] : null;
          return (
            <div key={label} className="text-center">
              <div className="text-[8px] uppercase tracking-wider text-stone-400">{label}</div>
              <div className="text-[11px] font-semibold text-stone-800 tabular-nums leading-tight">
                {v == null ? "—" : v.toFixed(key.endsWith("%") || cat === "2-Pointers" || cat === "3-Pointers" || cat === "Free Throws" ? 1 : 1)}
              </div>
              <div className={`text-[9px] tabular-nums leading-tight ${
                va == null ? "text-stone-300"
                  : va < 0 ? "text-red-600" : "text-stone-500"}`}>
                {va == null ? "·" : (va > 0 ? "+" : "") + va.toFixed(1)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[8px] text-stone-400 mt-1">
        {note || "Per game, with the Value Added each one contributed underneath — the ten add up to VA/G."}
      </div>
    </div>
  );
}


// One run, opened: every game of it, heaviest contribution first. This is where
// the weighting becomes checkable — a bigger night in an earlier round can sit
// below a quieter one in the Finals, and here you can see exactly why.
function RunGames({ slug, season }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchJsonCached(`/api/legacy/runs?slug=${encodeURIComponent(slug)}&season=${encodeURIComponent(season)}`)
      .then((r) => { if (!cancelled) setD(r); })
      .catch((e) => { if (!cancelled) setError(e.message || "Load failed"); });
    return () => { cancelled = true; };
  }, [slug, season]);

  if (error) return <div className="px-2 py-3 text-[10px] text-red-600">Couldn’t load games — {error}</div>;
  if (!d) return <div className="px-2 py-3 text-[10px] text-stone-500 italic">Loading games…</div>;

  const best = Math.max(...d.games.map((g) => Math.abs(g.contribution)), 0.1);
  const ROUND = { 1: "R1", 2: "R2", 3: "CF", 4: "F" };

  return (
    <div className="px-2 pb-3 pt-1 bg-stone-50 border-t border-stone-200">
      <p className="text-[10px] text-stone-500 leading-relaxed mb-2">
        {d.games.length} games, biggest contribution first. Every game of a series
        carries the same weight, so the order is what he did times what the series
        was worth — <span className="font-semibold">VA × weight</span>.
      </p>

      <div className="grid grid-cols-[4.6rem_1fr_2.6rem_2.4rem_3rem] gap-x-1.5 text-[9px] uppercase tracking-wider text-stone-400 pb-1 border-b border-stone-200">
        <span>Game</span><span>Line</span>
        <span className="text-right">VA</span>
        <span className="text-right">×W</span>
        <span className="text-right">Total</span>
      </div>

      {d.games.map((g) => {
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
  );
}


// Every postseason run on record, ranked, searchable. The career board is an
// argument; this is the evidence behind it — the surface where a number can be
// checked against a run you actually watched.
function RunsBoard() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [limit, setLimit] = useState(100);
  const [open, setOpen] = useState(null); // "<slug>-<season>"
  const [season, setSeason] = useState("");
  // Team only means something inside a season, so it is gated on one and
  // cleared whenever the season changes out from under it.
  const [team, setTeam] = useState("");

  // Debounced so a typed name is one request, not one per keystroke. The
  // search runs server-side because it has to reach all 8,917 runs.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      const url = `/api/legacy/runs?limit=${limit}&q=${encodeURIComponent(query.trim())}`
        + `&season=${encodeURIComponent(season)}&team=${encodeURIComponent(season ? team : "")}`;
      fetchJsonCached(url)
        .then((d) => { if (!cancelled) { setData(d); setError(null); } })
        .catch((e) => { if (!cancelled) setError(e.message || "Load failed"); });
    }, query ? 220 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, limit, season, team]);

  const runs = data?.runs || [];
  // Magnitude, so the scale still means something when a filtered list is all
  // negative — a team whose bench all cost their side points, say.
  const max = Math.max(...runs.map((r) => Math.abs(r.lva)), 0.1);

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setLimit(100); }}
        placeholder="Search a player…"
        className="w-full text-sm text-stone-900 bg-white border border-stone-300 px-3 py-2 mb-2"
      />

      <div className="flex items-center gap-2 mb-2">
        <select
          value={season}
          onChange={(e) => { setSeason(e.target.value); setTeam(""); setLimit(100); setOpen(null); }}
          className="text-[11px] bg-white border border-stone-300 px-2 py-1.5 text-stone-800"
        >
          <option value="">All seasons</option>
          {(data?.seasons || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Disabled until a season is chosen — a team without one would be
            asking a different question than the board can answer. */}
        <select
          value={team}
          disabled={!season}
          onChange={(e) => { setTeam(e.target.value); setLimit(100); setOpen(null); }}
          className={`text-[11px] border px-2 py-1.5 ${
            season
              ? "bg-white border-stone-300 text-stone-800"
              : "bg-stone-100 border-stone-200 text-stone-400 cursor-not-allowed"}`}
          title={season ? "Filter to one team" : "Pick a season first"}
        >
          <option value="">{season ? "All teams" : "Team — pick a season first"}</option>
          {season && (data?.teams || []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        {(season || team) && (
          <button
            onClick={() => { setSeason(""); setTeam(""); setLimit(100); setOpen(null); }}
            className="ml-auto text-[10px] uppercase tracking-widest text-stone-400 hover:text-stone-700"
          >✕ Clear</button>
        )}
      </div>

      <div className="flex items-baseline gap-2 mb-1 px-2 text-[10px] text-stone-400 tabular-nums">
        {data ? (
          <>
            <span>
              {query.trim() || season || team
                ? `${data.matched.toLocaleString()} of ${data.total.toLocaleString()} runs`
                  + (season ? ` · ${season}` : "") + (team ? ` · ${team}` : "")
                : `${data.total.toLocaleString()} postseason runs`}
            </span>
            <span className="ml-auto uppercase tracking-widest">Ranked by leveraged VA</span>
          </>
        ) : <span>Loading…</span>}
      </div>

      <div className="grid grid-cols-[2.2rem_1fr_2rem_3.2rem_2.6rem] gap-x-2 items-center text-[10px] uppercase tracking-wider text-stone-400 px-2 pb-1 border-b border-stone-200">
        <span>#</span><span>Player</span><span className="text-right">G</span>
        <span className="text-right">LVA</span><span className="text-right">VA/G</span>
      </div>

      {error && <div className="text-[10px] text-red-600 py-6 text-center">Couldn’t load — {error}</div>}
      {data && !runs.length && !error && (
        <div className="text-[10px] text-stone-400 italic py-6 text-center">
          No runs match{query.trim() ? ` “${query.trim()}”` : ""}
          {season ? ` in ${season}` : ""}{team ? ` for ${team}` : ""}.
        </div>
      )}

      {runs.map((r) => {
        const isOpen = open === `${r.slug}-${r.season}`;
        return (
          <div key={`${r.slug}-${r.season}`} className="border-b border-stone-100">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : `${r.slug}-${r.season}`)}
              className={`w-full text-left grid grid-cols-[2.2rem_1fr_2rem_3.2rem_2.6rem] gap-x-2 items-center px-2 pt-1.5 text-sm ${isOpen ? "bg-stone-50" : "hover:bg-stone-50"}`}
            >
              {/* The all-time rank, not the rank among matches — searching for a
                  player should tell you where his runs sit in the whole list. */}
              <span className="text-[10px] tabular-nums text-stone-400">{r.rank.toLocaleString()}</span>
              <span className="min-w-0">
                <span className="font-semibold text-stone-800 block truncate">
                  <span className="text-stone-400 text-[9px] mr-1">{isOpen ? "▾" : "▸"}</span>
                  {r.name}
                </span>
                <span className="text-[10px] text-stone-500 tabular-nums">
                  {r.season}{r.team ? ` · ${r.team}` : ""}
                </span>
              </span>
              <span className="text-right tabular-nums text-stone-600">{r.games}</span>
              <span className="text-right tabular-nums font-bold text-stone-900">{fmt0(r.lva)}</span>
              <span className="text-right tabular-nums text-stone-500">{r.vaPerG.toFixed(1)}</span>
            </button>

            {/* Two bars on one scale: the run, and the regular season that led
                into it priced the same way. The light bar's length against the
                dark one is the whole point — for most players the winter is a
                fraction of the fortnight. */}
            <div className="px-2 pt-1 pb-1.5 flex flex-col gap-[2px]">
              {/* A run worth less than nothing draws red at its magnitude, the
                  same as the career fold does. Clamping it to zero width would
                  read as missing data rather than as a negative. */}
              <div className="h-1 bg-stone-100 rounded-sm overflow-hidden">
                <div className={`h-full rounded-sm ${r.lva < 0 ? "bg-red-500" : "bg-stone-900"}`}
                  style={{ width: `${Math.min(100, (Math.abs(r.lva) / max) * 100)}%` }} />
              </div>
              <div className="h-1 bg-stone-100 rounded-sm overflow-hidden" title="Regular season, same scale">
                <div className={`h-full rounded-sm ${r.rsLVA < 0 ? "bg-red-300" : "bg-stone-400"}`}
                  style={{ width: `${Math.max(0, Math.min(100, (Math.abs(r.rsLVA) / max) * 100))}%` }} />
              </div>
            </div>

            <StatStrip stats={r.stats} />
            {isOpen && <RunGames slug={r.slug} season={r.season} />}
          </div>
        );
      })}

      {data && data.matched > runs.length && (
        <button
          onClick={() => setLimit((n) => Math.min(500, n + 200))}
          className="w-full mt-2 py-2 text-[10px] font-bold uppercase tracking-widest text-stone-500 border border-stone-300 hover:bg-stone-50"
        >
          Show more ({(data.matched - runs.length).toLocaleString()} left)
        </button>
      )}

      <div className="text-[10px] text-stone-400 italic mt-2 leading-relaxed">
        Ranked on the playoff run alone. <span className="font-semibold">LVA</span> is
        leveraged Value Added over the run; <span className="font-semibold">VA/G</span> is the raw,
        unweighted per-game figure behind it. The dark bar is the run; the light bar under it
        is that player&apos;s regular season the same year, priced the same way and drawn on the
        same scale. Tap a run for its games; turn the phone sideways for the per-game stat line
        and what each part of it was worth.
      </div>
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

  useEffect(() => {
    let cancelled = false;
    setRows([]);
    setData(null);
    setOpen(null);
    setLoading(true);
    fetchJsonCached(`/api/legacy?top=${PAGE}&offset=0&sort=${sortKey}`)
      .then((d) => { if (!cancelled) { setData(d); setRows(d.players || []); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e.message || "Load failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sortKey]);

  const more = () => {
    if (loading) return;
    setLoading(true);
    fetchJsonCached(`/api/legacy?top=${PAGE}&offset=${rows.length}&sort=${sortKey}`)
      .then((d) => {
        // Guard against a stale page landing after a sort change.
        if (d.sort !== sortKey || d.offset !== rows.length) return;
        setRows((prev) => [...prev, ...(d.players || [])]);
      })
      .catch((e) => setError(e.message || "Load failed"))
      .finally(() => setLoading(false));
  };

  const shown = rows;

  if (error) return <div className="text-[10px] text-red-600 py-6 text-center px-2 break-words">Couldn’t load — {error}</div>;
  if (!data) return <div className="text-[10px] text-stone-500 italic py-6 text-center">Ranking careers…</div>;
  if (!shown.length) return <div className="text-[10px] text-stone-400 italic py-6 text-center">No careers qualified.</div>;

  // The board arrives sorted, so the leader is the scale for every bar — it
  // stays put as more pages land instead of rescaling the rows already read.
  const max = Math.max(shown[0]?.[sortKey] ?? 0, 0.1);
  const anyTruncated = shown.some((p) => p.truncated);
  const head = (key, label) => (
    <button
      onClick={() => setSortKey(key)}
      className={`text-right uppercase tracking-wider ${sortKey === key ? "text-stone-900 font-bold" : "text-stone-400 hover:text-stone-600"}`}
    >{label}{sortKey === key ? " ▾" : ""}</button>
  );

  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-3">
        {data.firstSeason}–{data.lastSeason} · {data.qualified.toLocaleString()} careers qualified
      </div>

      <p className="text-[11px] text-stone-600 leading-relaxed mb-3">
        <span className="font-semibold">Legacy</span> is a career&apos;s value with every game
        priced by what was at stake; <span className="font-semibold">Peak/G</span> is the same
        weighting as a rate over the best {data.dials.peakSeasons} seasons. Tap either to sort,
        or a player for the season-by-season fold — and the{" "}
        <span className="font-bold">i</span> above for how the number is built.
      </p>

      <div className="grid grid-cols-[1.5rem_1fr_2rem_3.5rem_3rem] gap-x-2 items-center text-[10px] uppercase tracking-wider text-stone-400 px-2 pb-1 border-b border-stone-200">
        <span></span><span>Player</span><span className="text-right">Sns</span>
        {head("total", "Legacy")}
        {head("peak", "Peak/G")}
      </div>

      {shown.map((p) => {
        const isOpen = open === p.slug;
        return (
          <div key={p.slug} className="border-b border-stone-100">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : p.slug)}
              className={`w-full text-left grid grid-cols-[1.5rem_1fr_2rem_3.5rem_3rem] gap-x-2 items-center px-2 pt-1.5 text-sm ${isOpen ? "bg-stone-50" : "hover:bg-stone-50"}`}
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
              <div className="h-1 bg-stone-100 rounded-sm overflow-hidden">
                <div className="h-full rounded-sm bg-stone-900" style={{ width: `${Math.max(0, ((p[sortKey] ?? 0) / max) * 100)}%` }} />
              </div>
            </div>
            {isOpen && <CareerFold p={p} weightAtHalf={data.weightAtHalf} onGoToLeaderboard={onGoToLeaderboard} />}
          </div>
        );
      })}

      {shown.length < data.qualified ? (
        <button
          onClick={more}
          disabled={loading}
          className="w-full mt-2 py-2 text-[10px] font-bold uppercase tracking-widest text-stone-500 border border-stone-300 hover:bg-stone-50 disabled:text-stone-300"
        >
          {loading
            ? "Loading…"
            : `Show more · ${shown.length.toLocaleString()} of ${data.qualified.toLocaleString()}`}
        </button>
      ) : (
        <div className="text-[10px] text-stone-400 italic mt-2 text-center">
          All {data.qualified.toLocaleString()} qualifying careers shown.
        </div>
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
        {data.dials.minSeasons} seasons and {fmt0(data.dials.minGames)} games.
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


// Two readings of the same numbers. Careers is the argument the metric makes;
// Runs is the evidence it rests on — one row per postseason run, so a score can
// be checked against a run you remember rather than taken on trust.
export function LegacyView({ onGoToLeaderboard = null }) {
  const [mode, setMode] = useState("careers"); // "careers" | "runs"
  const [info, setInfo] = useState(false);

  const tab = (key, label) => (
    <button
      onClick={() => setMode(key)}
      className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest border ${
        mode === key
          ? "bg-stone-900 text-white border-stone-900"
          : "text-stone-500 border-stone-300 hover:text-stone-800"}`}
    >{label}</button>
  );

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-base font-bold text-stone-900">Legacy</h2>
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
        <span className="ml-auto flex gap-1">{tab("careers", "Careers")}{tab("runs", "Runs")}</span>
      </div>
      {info && <LegacyInfo />}
      {mode === "careers" ? <CareersBoard onGoToLeaderboard={onGoToLeaderboard} /> : <RunsBoard />}
    </div>
  );
}
