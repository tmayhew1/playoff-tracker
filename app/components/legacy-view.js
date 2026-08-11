"use client";

import { useState, useMemo, useEffect } from "react";
import { fetchJsonCached } from "../lib/fetch-cache";


// The all-time board. Legacy is deliberately TWO numbers rather than one
// (app/lib/legacy.js): LEGACY is the rank-decayed fold over a career's seasons,
// which spends longevity at diminishing returns, and PEAK/G is the
// leverage-weighted rate over the best seasons. They disagree — Jokić is ninth
// by volume and third by peak — and blending them would hide exactly the
// argument the metric exists to make, so both columns are sortable and neither
// is "the" ranking.
//
// Tapping a row opens the fold itself. A career total is otherwise a number you
// have to take on faith; the expansion shows it as the sum it is — every
// season, ordered the way the decay is spent, with the discount that season
// took and the playoff/regular-season split underneath.
//
// MVP scope: the board at the default dials. The route already answers for any
// alpha/decay, so exposing them is a slider away.

const fmt0 = (n) => Math.round(n).toLocaleString("en-US");
// Big numbers don't need a decimal and can't spare the width on a phone; small
// ones are unreadable without it (a 4.0 season and a 4.4 season are not the
// same season).
const fmtN = (n) => (Math.abs(n) >= 100 ? fmt0(n) : n.toFixed(1));

const COLS = "grid grid-cols-[1.1rem_1fr_3rem_2.7rem_3.2rem] gap-x-1.5 items-baseline";


// One career, opened up: the summary the board has no room for, then every
// season in the order the fold consumes them.
function CareerFold({ p, decay }) {
  const best = Math.max(...p.seasons.map((s) => s.contribution), 0.1);

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
        {p.teams?.length ? <> · {p.teams.join(", ")}</> : null}. Every season below is
        weighted <span className="tabular-nums">{decay}</span><sup>rank−1</sup>, so the
        best one counts whole and each next one a little less —{" "}
        <span className="font-semibold">Discounted</span> is the column that sums to
        Legacy.
      </p>

      <div className={`${COLS} text-[9px] uppercase tracking-wider text-stone-400 pb-1 border-b border-stone-200`}>
        <span>#</span><span>Season</span>
        <span className="text-right">LVA</span>
        <span className="text-right">×D</span>
        <span className="text-right">Disc.</span>
      </div>

      {p.seasons.map((s) => {
        // A negative season still belongs on the board — it is part of the
        // career — but it has no meaningful playoff/RS split to draw, so it
        // gets one red bar instead of two stacked ones.
        const down = s.lva <= 0;
        const width = Math.min(100, (Math.abs(s.contribution) / best) * 100);
        const poShare = down ? 0 : Math.max(0, Math.min(1, s.poLVA / s.lva));
        return (
          <div key={s.season} className="pt-1 pb-1.5 border-b border-stone-100 last:border-0">
            <div className={`${COLS} text-[11px]`}>
              <span className="tabular-nums text-stone-400">{s.rank}</span>
              <span className="min-w-0">
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
            </div>
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

function StatStrip({ stats }) {
  if (!stats) return null;
  return (
    <div className="hidden tilt:block px-2 pb-2 overflow-x-auto">
      <div className="grid grid-cols-11 gap-x-1 min-w-[34rem]">
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
        Per game, with the Value Added each one contributed underneath — the ten add up to VA/G.
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


function CareersBoard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("total"); // "total" | "peak"
  const [open, setOpen] = useState(null);          // expanded player's slug

  useEffect(() => {
    let cancelled = false;
    fetchJsonCached("/api/legacy?top=50")
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message || "Load failed"); });
    return () => { cancelled = true; };
  }, []);

  const shown = useMemo(() => {
    if (!data?.players) return [];
    return [...data.players].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
  }, [data, sortKey]);

  if (error) return <div className="text-[10px] text-red-600 py-6 text-center px-2 break-words">Couldn’t load — {error}</div>;
  if (!data) return <div className="text-[10px] text-stone-500 italic py-6 text-center">Ranking careers…</div>;
  if (!shown.length) return <div className="text-[10px] text-stone-400 italic py-6 text-center">No careers qualified.</div>;

  const max = Math.max(...shown.map((p) => p[sortKey] ?? 0), 0.1);
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
        Every series a career played, priced by what winning it was worth to a
        title and shared across the games it took — so closing a team out in
        four concentrates that value instead of forfeiting it. The seasons are
        then folded best first, so extra years always add, just less each time.{" "}
        <span className="font-semibold">Legacy</span> is that total;{" "}
        <span className="font-semibold">Peak/G</span> is the same weighting as a
        rate over the best {data.dials.peakSeasons} seasons. Tap either to sort,
        or a player for the season-by-season fold.
      </p>

      <div className="grid grid-cols-[1.5rem_1fr_2rem_3.5rem_3rem] gap-x-2 items-center text-[10px] uppercase tracking-wider text-stone-400 px-2 pb-1 border-b border-stone-200">
        <span></span><span>Player</span><span className="text-right">Sns</span>
        {head("total", "Legacy")}
        {head("peak", "Peak/G")}
      </div>

      {shown.map((p, i) => {
        const isOpen = open === p.slug;
        return (
          <div key={p.slug} className="border-b border-stone-100">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : p.slug)}
              className={`w-full text-left grid grid-cols-[1.5rem_1fr_2rem_3.5rem_3rem] gap-x-2 items-center px-2 pt-1.5 text-sm ${isOpen ? "bg-stone-50" : "hover:bg-stone-50"}`}
            >
              <span className="text-[10px] tabular-nums text-stone-400">{i + 1}</span>
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
            {isOpen && <CareerFold p={p} decay={data.dials.decay} />}
          </div>
        );
      })}

      <div className="text-[10px] text-stone-400 italic mt-2 leading-relaxed">
        {anyTruncated && (
          <>* career reaches {data.firstSeason}, the first season on record — it may extend
          earlier, in which case only part of it is measured.<br /></>
        )}
        Decay {data.dials.decay}
        {data.calibration?.isDefault && data.calibration.pool ? (
          <> — measured, not chosen: the point where this board sits equidistant between a
          plain career sum and a best-season ranking across all{" "}
          {data.calibration.pool.toLocaleString()} qualifying careers. At it, the best{" "}
          {data.dials.peakSeasons} seasons carry {(data.peakShare * 100).toFixed(0)}% of a
          20-season career.</>
        ) : (
          <> (the best {data.dials.peakSeasons} seasons carry{" "}
          {(data.peakShare * 100).toFixed(0)}% of a 20-season career).</>
        )}{" "}
        Leverage α {data.dials.alpha}; regular season{" "}
        {data.dials.includeRS ? "included" : "excluded"}; minimum{" "}
        {data.dials.minSeasons} seasons and {fmt0(data.dials.minGames)} games.
      </div>
    </div>
  );
}


// Two readings of the same numbers. Careers is the argument the metric makes;
// Runs is the evidence it rests on — one row per postseason run, so a score can
// be checked against a run you remember rather than taken on trust.
export function LegacyView() {
  const [mode, setMode] = useState("careers"); // "careers" | "runs"

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
        <span className="ml-auto flex gap-1">{tab("careers", "Careers")}{tab("runs", "Runs")}</span>
      </div>
      {mode === "careers" ? <CareersBoard /> : <RunsBoard />}
    </div>
  );
}
