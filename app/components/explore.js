"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { LiveGameBanner } from "./boxscore";
import { SeriesAverages } from "./history";
import { PlayoffLeaderboard } from "./leaderboard";
import { Seg } from "./ui/seg";
import { teamColor, withAlpha } from "../lib/format";
import { useSeasonLga } from "../lib/va-mode";
import { buildScoped, fetchJsonCached } from "../lib/fetch-cache";
import { dayLabel, groupByDay, groupByMonth, playoffsBegun, seasonMonths, seasonOf } from "../lib/regular-season-games";
import dynamic from "next/dynamic";
import { useShareReport } from "../lib/share-state";
import { LookAheadNavProvider } from "../lib/award-nav";
import { LastNight } from "./last-night";
import { GameCard } from "./live-view";
import { MonthAverages } from "./month-averages";
import { bakedBox, seasonGames } from "../lib/baked-games";
import { warmSeason } from "../lib/month-tables";
import { useSeasonContext } from "../lib/use-season-context";

// By Season is the default mode; By Player's code loads when it's first
// opened (see app/page.js for the same treatment of the other tabs).
const PlayerExplorer = dynamic(
  () => import("./player-explorer").then((m) => m.PlayerExplorer),
  { loading: () => <div className="py-10 text-center text-[13px] text-stone-400">Loading…</div> },
);
// The projected season — its own season-picker entry, beside the season it
// projects, rendering its own view instead of the leaderboard. Loaded on
// first pick.
const LookAhead = dynamic(
  () => import("./look-ahead").then((m) => m.LookAhead),
  { loading: () => <div className="py-10 text-center text-[13px] text-stone-400">Loading…</div> },
);
// Kept in step with LOOK_AHEAD_SEASON in ./look-ahead (not imported from it,
// so the picker doesn't pull that chunk into the page bundle). The picker
// holds the projection under its own value, LOOK_AHEAD, so the season itself
// — games, box scores, its leaderboard — is the entry beside it.
const LOOK_AHEAD_SEASON = "2026-27";
const LOOK_AHEAD = "look-ahead";
// The season under way: Explore opens on it, its games listed before its
// leaderboard (the latest night is the news; a finished season's board is
// its summary), and until April it has no playoffs to show.
const CURRENT_SEASON = seasonOf();


export const ROUND_LABELS = { r1: "First Round", r2: "Conf Semis", r3: "Conf Finals", r4: "Finals" };


export function ExploreSeriesRow({ s, lga, season }) {
  const teamCell = (code, isWinner) => {
    const c = teamColor(code);
    const style = isWinner
      ? { backgroundColor: withAlpha(c, 0.14), borderColor: c }
      : { backgroundColor: "#ffffff", borderColor: withAlpha(c, 0.35) };
    return (
      <div
        style={style}
        className={`flex-1 px-2 py-1.5 border ${isWinner ? "border-2" : ""}`}
      >
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
          <span className="text-sm font-semibold" style={{ color: isWinner ? c : "#1c1917" }}>{code}</span>
          {isWinner && <span className="ml-auto text-[12px]" style={{ color: c }}>✓</span>}
        </div>
      </div>
    );
  };
  return (
    <div className="mb-3 p-2 bg-stone-50 border border-stone-200 rounded">
      <div className="flex gap-1.5 items-stretch">
        {teamCell(s.teams[0], s.winner === s.teams[0])}
        <div className="flex items-center justify-center px-1 text-[12px] font-bold text-stone-400">VS</div>
        {teamCell(s.teams[1], s.winner === s.teams[1])}
      </div>
      {s.games.length > 0 ? (
        <>
          <SeriesAverages games={s.games} teamsMap={{}} lga={lga} boxSrc="espn" useTeamColor season={season} />
          {s.games.map((g, i) => {
            const liveGame = {
              gameId: g.gameId,
              gameCode: g.gameCode,
              gameStatus: 3,
              gameStatusText: "Final",
              gameDateTimeUTC: g.gameDateTimeUTC,
              home: { tri: g.home.tri, score: g.home.score },
              away: { tri: g.away.tri, score: g.away.score },
            };
            return (
              <LiveGameBanner
                key={g.gameId || i}
                liveGame={liveGame}
                gameLabel={`Game ${i + 1}`}
                lga={lga}
                teams={{}}
                useTeamColor
              />
            );
          })}
        </>
      ) : (
        <div className="mt-1 text-[12px] text-stone-400 italic text-center py-1">No games</div>
      )}
    </div>
  );
}


export function ExploreRoundSection({ roundKey, series, lga, season }) {
  const [open, setOpen] = useState(false);
  if (series.length === 0) return null;
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-baseline justify-between mb-2 pb-1.5 border-b-2 border-stone-900 text-left"
      >
        <h3 className="text-[13px] font-bold text-stone-900 flex items-center gap-2">
          <span className="text-stone-400 text-[12px]">{open ? "▾" : "▸"}</span>
          {ROUND_LABELS[roundKey] || roundKey}
        </h3>
        <span className="text-[12px] text-stone-400">{series.length} series</span>
      </button>
      {open && series.map((s, i) => (
        <ExploreSeriesRow key={i} s={s} lga={lga} season={season} />
      ))}
    </div>
  );
}


// The regular season's counterpart to the rounds: one collapsible section per
// month, its league-wide averages first, then a card per day holding that
// day's games, newest first. Each game is the Live tab's scoreboard card (the
// winner's side filled in, tap a side for that team's box) over its top five.
// A team picked in the averages' header, by tapping a team in the averages,
// or by tapping a side of a scoreboard narrows both the averages and the days
// to that team's games.
export function ExploreMonthSection({ month, allMonths, lga, season }) {
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState(null);
  const teams = useMemo(() => [...new Set(month.games.flatMap((g) => [g.home?.tri, g.away?.tri]).filter(Boolean))].sort(), [month]);
  const days = useMemo(() => (open
    ? groupByDay(month.games).reverse()
        .map((d) => ({ ...d, games: d.games.filter((g) => !team || g.home?.tri === team || g.away?.tri === team).reverse() }))
        .filter((d) => d.games.length)
    : []), [open, month, team]);
  const teamGames = team ? days.reduce((n, d) => n + d.games.length, 0) : month.games.length;
  const context = useSeasonContext({ enabled: open, season, allMonths, through: month.key, lga });
  const teamControl = teams.length > 1 && (team ? (
    <button
      onClick={() => setTeam(null)}
      style={{ backgroundColor: withAlpha(teamColor(team), 0.14), color: teamColor(team), borderColor: withAlpha(teamColor(team), 0.4) }}
      className="shrink-0 text-[12px] font-bold px-1.5 py-0.5 border inline-flex items-center gap-1"
      aria-label="Clear the team filter"
    >
      {team} <span className="opacity-60">×</span>
    </button>
  ) : (
    <select
      value=""
      onChange={(e) => setTeam(e.target.value || null)}
      className="shrink-0 text-[12px] px-1 py-0.5 border bg-white text-stone-500 border-stone-300 rounded-none"
      aria-label="Filter the month by team"
    >
      <option value="">All teams</option>
      {teams.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  ));
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-baseline justify-between mb-2 pb-1.5 border-b-2 border-stone-900 text-left"
      >
        <h3 className="text-[13px] font-bold text-stone-900 flex items-center gap-2">
          <span className="text-stone-400 text-[12px]">{open ? "▾" : "▸"}</span>
          {month.label} {month.key.slice(0, 4)}
        </h3>
        <span className="text-[12px] text-stone-400">{open ? teamGames : month.games.length} games</span>
      </button>
      {open && <MonthAverages month={month} allMonths={allMonths} lga={lga} season={season} team={team} onTeam={setTeam} teamControl={teamControl} />}
      {open && days.map((d) => (
        <div key={d.date} className="mb-3 p-2 bg-stone-50 border border-stone-200 rounded">
          <div className="flex items-baseline justify-between px-0.5">
            <span className="text-[13px] font-semibold text-stone-900">{dayLabel(d.date)}</span>
            <span className="text-[12px] text-stone-400">{d.games.length} game{d.games.length === 1 ? "" : "s"}</span>
          </div>
          <div className="mt-1.5">
            {d.games.map((g) => (
              <GameCard
                key={g.gameId}
                g={{
                  gameId: g.gameId,
                  kind: "regular",
                  gameStatus: 3,
                  gameStatusText: "Final",
                  gameDateTimeUTC: g.gameDateTimeUTC,
                  boxSrc: "espn",
                  home: g.home,
                  away: g.away,
                }}
                lga={lga}
                boxLoader={() => bakedBox(season, g)}
                onTeamPick={setTeam}
                keepInView
                context={(tri) => context(tri, g.date)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


// Every regular-season game of `season`, by month. A baked season
// (lib/baked-games.js) opens from its static index; months the bake hasn't
// reached — the season in progress, or a season not baked — are asked of
// /api/regular-season/games one calendar month per request, side by side.
// Everything is merged and regrouped here (a game is filed under its own
// Eastern date, whichever source found it). `lga` is the regular-season
// baseline these box scores are priced against. `grouped` folds the months
// under one Reg Season section, for Combined, where the rounds follow them.
export function RegularSeasonMonths({ season, lga, grouped = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    seasonGames(season, seasonMonths(season),
      (m) => fetchJsonCached(`/api/regular-season/games?season=${season}&month=${m}`))
      .then(({ games, errors }) => {
        if (cancelled) return;
        if (!games.length && errors.length) setError(errors[0]);
        else setData({ months: groupByMonth(games), partial: errors.length > 0 });
      });
    return () => { cancelled = true; };
  }, [season]);

  // With the months listed, load and score a baked season's box scores while
  // the page is idle, so a month's averages and a player's chart open at once.
  useEffect(() => (data?.months?.length ? warmSeason(season, data.months, lga) : undefined), [data, season, lga]);
  const [open, setOpen] = useState(false);

  if (error) return <div className="text-[12px] text-red-600 py-4 text-center px-2 break-words">Couldn’t load regular-season games — {error}</div>;
  if (!data) return <div className="text-[12px] text-stone-500 italic py-4 text-center">Loading {season} regular season…</div>;
  if (!data.months.length) return <div className="text-[12px] text-stone-400 italic py-4 text-center">No regular-season games found for {season}</div>;
  const months = (
    <>
      {[...data.months].reverse().map((m) => <ExploreMonthSection key={m.key} month={m} allMonths={data.months} lga={lga} season={season} />)}
      {data.partial && (
        <div className="text-[12px] text-stone-400 italic pb-3 text-center">Some days didn’t load — try again later</div>
      )}
    </>
  );
  if (!grouped) return months;
  // Same header as a month or a round; the months open inside it, set in a step.
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-baseline justify-between mb-2 pb-1.5 border-b-2 border-stone-900 text-left"
      >
        <h3 className="text-[13px] font-bold text-stone-900 flex items-center gap-2">
          <span className="text-stone-400 text-[12px]">{open ? "▾" : "▸"}</span>
          Reg Season
        </h3>
        <span className="text-[12px] text-stone-400">{data.months.reduce((n, m) => n + m.games.length, 0)} games</span>
      </button>
      {open && <div className="pl-3">{months}</div>}
    </div>
  );
}


// Seasons available in the picker. ESPN's NBA scoreboard reliably covers
// 1999-00 onward; earlier seasons return empty/erroring responses.
export function exploreSeasonList() {
  // Synchronous fallback used until /api/seasons resolves. Covers the same
  // ESPN-supported range the route emits (1999-00 onward, newest first).
  const seasons = [];
  for (let y = Number(CURRENT_SEASON.slice(0, 4)); y >= 1999; y--) {
    const end = String((y + 1) % 100).padStart(2, "0");
    seasons.push(`${y}-${end}`);
  }
  return seasons;
}


// `jump` is an arrival from another tab — the Legacy season drop-down asking
// for this board, on a given season, scoped to the half it was read from and
// filtered to that player's team. Same shape the in-tab "Go →" navigations
// already use, plus the scope, since a Legacy season has two halves and the
// caller knows which one was tapped.
//
// `initial` is an opening link's Explore state (lib/share-params.js), read
// once on mount: the view, scope and season it names, and the player — and
// the comparison — to open, handed to the leaderboard / By Player as the
// same pending navigation their own in-page jumps use.
export function ExploreView({ mode = "season", onModeChange, careerJump = null, onCareerJumpHandled = null, jump = null, onJumpHandled = null, initial = null, onInitHandled = null, liveNight = null, onOpenInLive = null }) {
  // Season list is fetched from /api/seasons so newly-baked old seasons
  // (filled in by the daily-backfill workflow) show up automatically on
  // next deploy. exploreSeasonList() is the synchronous fallback used
  // until the fetch resolves so the picker isn't empty on first paint.
  const FALLBACK = useMemo(() => exploreSeasonList(), []);
  const [linked] = useState(initial);
  const [seasons, setSeasons] = useState(() => {
    const base = [LOOK_AHEAD, ...FALLBACK];
    return linked?.season && !base.includes(linked.season)
      ? [...base, linked.season].sort((a, b) => b.localeCompare(a)) : base;
  });
  const [season, setSeason] = useState(linked?.season || FALLBACK[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // "season" | "player" — picked in the tracker's sub-nav, so held there.
  const setMode = onModeChange || (() => {});
  // A 2026-27 card's award box (award-boxes.js) opens that board in the Look
  // Ahead, the player open on it; the target waits here until it's up.
  const [laTarget, setLaTarget] = useState(null);
  const openLookAhead = useCallback((target) => {
    setLaTarget(target);
    setMode("season");
    setSeason(LOOK_AHEAD);
  }, []);
  const clearLaTarget = useCallback(() => setLaTarget(null), []);
  // Which games count: regular season, playoffs, or both summed. Applies to
  // both By Season and By Player.
  // A season in progress before April opens on its regular season, the only
  // games it has; a link names its own.
  const [scope, setScope] = useState(() => { // "regular" | "playoffs" | "combined"
    if (linked && (linked.scope !== "combined" || linked.season || linked.view === "player")) return linked.scope;
    return playoffsBegun(CURRENT_SEASON) ? "combined" : "regular";
  });
  // A pending navigation into By Season, applied by the leaderboard once that
  // season's rows have loaded. Two shapes:
  //   { season, team, name, slug } — a player-season, from a compare panel's
  //     compared-player chip or a By Player team card: filter to their team
  //     and expand their row.
  //   { season, team }             — a team-season with no player attached:
  //     just filter the board to that team.
  // A player-season target may also carry `compare: { season, name, slug }` —
  // the compare panel's career-year gate asking the row it opens to land
  // already comparing against that player-season.
  const linkedCompare = linked?.vs ? { slug: linked.vs.slug, season: linked.vs.season, name: null } : null;
  const [seasonNav, setSeasonNav] = useState(() => (linked?.view !== "player" && linked?.p && linked?.season
    ? { season: linked.season, team: null, name: null, slug: linked.p, compare: linkedCompare } : null));
  // Called by a By Season compare panel (via context.onNavigateToPlayer) when
  // the user taps the compared player's chip: switch the leaderboard to that
  // player's season and hand the target down for the leaderboard to open.
  const navigateSeasonToPlayer = useCallback((target) => {
    if (!target) return;
    setMode("season");
    setSeason(target.season);
    setSeasonNav(target);
  }, []);
  // Called from By Player when the user arms the Team header and taps a team
  // card: cross over to By Season for that card's season, filtered to that
  // team, with the player whose career we were reading opened in place. The
  // scope (regular / playoffs / combined) is whatever By Player was already
  // showing — it's the same selector for both modes, so it just rides along
  // untouched. The player rides along the same way the compare-chip
  // navigation carries one, so the leaderboard has a single nav shape to
  // apply; a target without one still just filters to the team.
  const navigateSeasonToTeam = useCallback((target) => {
    if (!target?.season || !target?.team) return;
    setMode("season");
    setSeason(target.season);
    setSeasonNav({ season: target.season, team: target.team, name: target.name || null, slug: target.slug || null });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const clearSeasonNav = useCallback(() => setSeasonNav(null), []);

  // Apply an arrival from another tab. The season may predate the picker's
  // live fallback range (Legacy reaches back to 1980-81), so it is added to
  // the list rather than left as a value with no option behind it — the
  // /api/seasons fetch will supply it too, just not necessarily first.
  useEffect(() => {
    if (!jump?.season) return;
    setMode("season");
    setScope(jump.scope === "regular" ? "regular" : "playoffs");
    setSeasons((prev) => (prev.includes(jump.season)
      ? prev : [...prev, jump.season].sort((a, b) => b.localeCompare(a))));
    setSeason(jump.season);
    setSeasonNav({
      season: jump.season,
      team: jump.team || null,
      name: jump.name || null,
      slug: jump.slug || null,
    });
    onJumpHandled?.();
  }, [jump, onJumpHandled]);

  // The mirror image of navigateSeasonToTeam: a pending navigation into By
  // Player — { name, slug, season } — applied by the player explorer once its
  // index for the current scope has loaded.
  const [playerNav, setPlayerNav] = useState(() => (linked?.view === "player" && linked?.p
    ? { slug: linked.p, name: null, season: linked.ps || null, compare: linked.ps ? linkedCompare : null } : null));
  // Taken: let the tracker drop it, so a later return to Explore starts fresh.
  useEffect(() => { if (linked) onInitHandled?.(); }, [linked, onInitHandled]);
  // Called from By Season when the user arms the Player header and taps a name:
  // cross over to By Player for that player, with the leaderboard's season
  // already drilled in. Scope rides along untouched (same selector both modes).
  const navigatePlayerToSeason = useCallback((target) => {
    if (!target?.name && !target?.slug) return;
    setMode("player");
    setPlayerNav(target);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  // The same crossing for a RUN — a By Season compare panel's chip pointing at
  // a side that pools several seasons (a compared run, or a selection made in
  // the panel's career chart). There is no single season for the leaderboard to
  // land on, and a run's home is the By Player table with those seasons ticked,
  // so this always crosses over. `seasons` rides along in the same pending
  // target the season crossing uses.
  const navigatePlayerToRun = useCallback((target) => {
    if (!target?.seasons?.length || (!target.name && !target.slug)) return;
    setMode("player");
    setPlayerNav({ name: target.name || null, slug: target.slug || null, season: null, seasons: target.seasons });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const clearPlayerNav = useCallback(() => setPlayerNav(null), []);
  // A box score's player tapped anywhere in the app (lib/award-nav.js
  // PlayerNavContext): the tracker has already switched to By Player.
  useEffect(() => {
    if (!careerJump) return;
    setPlayerNav({ name: careerJump.name || null, slug: careerJump.slug || null, season: careerJump.season || null });
    onCareerJumpHandled?.();
  }, [careerJump, onCareerJumpHandled]);

  useEffect(() => {
    let cancelled = false;
    fetch(buildScoped("/api/seasons"))
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d?.seasons?.length) return;
        setSeasons([LOOK_AHEAD, ...d.seasons.filter((s) => s !== LOOK_AHEAD)]);
        // Switch the default to the newest entry the route reports, but
        // only if the user hasn't already navigated somewhere else.
        // A linked season is a choice too.
        setSeason((cur) => (cur === FALLBACK[0] && !linked?.season ? d.seasons[0] : cur));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [FALLBACK, linked]);

  useEffect(() => {
    // The playoff series show under the Playoffs and Combined scopes; the
    // regular season's months load on their own (RegularSeasonMonths).
    if (mode !== "season" || scope === "regular" || season === LOOK_AHEAD || !playoffsBegun(season)) return;
    let cancelled = false;
    setData(null);
    setError(null);
    setLoading(true);
    fetch(buildScoped(`/api/history?season=${season}`))
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
        return d;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => !cancelled && setError(e.message || "Load failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [season, mode, scope]);

  // Whichever baseline the USG-ADJ switch is on (lib/va-mode.js). Two of them,
  // because this view holds both sides of the season: `lga` is the regular
  // season, which PlayoffLeaderboard needs for its rs/combined scopes (and from
  // which it derives its own playoff baseline), while the series box scores
  // below are playoff games and take the blended playoff baseline (spec §4.8).
  const lgaSeason = season === LOOK_AHEAD ? LOOK_AHEAD_SEASON : season;
  const lga = useSeasonLga(lgaSeason);
  const poLga = useSeasonLga(lgaSeason, "po");
  const byRound = useMemo(() => {
    const out = { r1: [], r2: [], r3: [], r4: [] };
    for (const s of data?.series || []) {
      if (out[s.round]) out[s.round].push(s);
    }
    return out;
  }, [data]);

  useShareReport({ view: mode, scope, season: mode === "season" ? season : null });
  const lookAhead = season === LOOK_AHEAD;
  // No playoffs yet: Combined is the regular season alone, and Playoffs says so.
  const noPlayoffs = !lookAhead && !playoffsBegun(season);
  const inProgress = season === CURRENT_SEASON;

  // The season's VA leaderboard, in whichever scope it's asked for.
  const board = (sc) => (
    <PlayoffLeaderboard season={season} lga={lga} scope={sc} pendingNav={seasonNav} onNavigateToPlayer={navigateSeasonToPlayer} onNavHandled={clearSeasonNav} onOpenPlayerSeason={navigatePlayerToSeason} onOpenPlayerRun={navigatePlayerToRun} onOpenInLive={onOpenInLive} />
  );

  // One line of choices: the season (By Season only) and which games count.
  // The projection is a regular season with no games yet, so the scope has
  // nothing to choose between while it's showing.
  const seasonPicker = (
    <select
      value={season}
      onChange={(e) => setSeason(e.target.value)}
      aria-label="Season"
      className={`min-w-0 text-[16px] font-bold bg-transparent border-0 border-b pr-1 py-0.5 ${lookAhead ? "text-amber-800 border-amber-500" : "text-stone-900 border-stone-900"}`}
    >
      {seasons.map((s) => (
        <option key={s} value={s}>{s === LOOK_AHEAD ? `${LOOK_AHEAD_SEASON} Look Ahead` : s === CURRENT_SEASON ? `${s} (in progress)` : s}</option>
      ))}
    </select>
  );

  return (
    <LookAheadNavProvider value={openLookAhead}>
    <div>
      <LastNight onOpenPlayer={navigatePlayerToSeason} liveNight={liveNight} onOpenInLive={onOpenInLive} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {mode === "season" ? seasonPicker : <span />}
        {!(mode === "season" && lookAhead) && (
          <Seg label="Games counted" value={scope} onChange={setScope}
            options={[["combined", "Combined"], ["regular", "Regular"], ["playoffs", "Playoffs"]]} />
        )}
        {mode === "season" && (lookAhead ? (
          <div className="w-full text-[14px] italic text-amber-800">
            Projected from regular seasons via Basketball-Reference{LOOK_AHEAD_SEASON === CURRENT_SEASON ? `, updated with every ${LOOK_AHEAD_SEASON} game played` : ""}; rosters via ESPN.
          </div>
        ) : (
          <button type="button" onClick={() => setSeason(LOOK_AHEAD)} className="w-full text-left text-[13px] text-amber-800 hover:underline">
            {LOOK_AHEAD_SEASON} Look Ahead: projections, MVP odds, All-NBA →
          </button>
        ))}
      </div>

      {mode === "player" ? (
        <PlayerExplorer
          scope={scope}
          onOpenTeamSeason={navigateSeasonToTeam}
          pendingPlayer={playerNav}
          onPlayerNavHandled={clearPlayerNav}
        />
      ) : (
        <>
          {lookAhead ? (
            <LookAhead target={laTarget} onTargetHandled={clearLaTarget} />
          ) : scope === "regular" || (scope === "combined" && noPlayoffs) ? (
            // The season under way lists its games first, then the board.
            inProgress ? (
              <>
                <RegularSeasonMonths season={season} lga={lga} />
                {board("regular")}
              </>
            ) : (
              <>
                {board("regular")}
                <RegularSeasonMonths season={season} lga={lga} />
              </>
            )
          ) : scope === "playoffs" && noPlayoffs ? (
            <div className="text-[12px] text-stone-400 italic py-4 text-center">The {season} playoffs start in April — the regular season is under way.</div>
          ) : (
            <>
              {/* Combined keeps its leaderboard up while the games load, then
                  runs in calendar order: the regular season's months, then the
                  same bracket the Playoffs scope shows. */}
              {scope === "combined" && (
                <>
                  {board(scope)}
                  <RegularSeasonMonths season={season} lga={lga} grouped />
                </>
              )}
              {loading && <div className="text-[12px] text-stone-500 italic py-4 text-center">Loading {season} playoffs…</div>}
              {error && !loading && <div className="text-[12px] text-red-600 py-4 text-center px-2 break-words">Couldn’t load games — {error}</div>}
              {!loading && !error && data && (
                <>
                  {scope === "playoffs" && board(scope)}
                  {(["r1", "r2", "r3", "r4"]).map((rk) => (
                    <ExploreRoundSection key={rk} roundKey={rk} series={byRound[rk]} lga={poLga} season={season} />
                  ))}
                  {data.series && data.series.length === 0 && (
                    <div className="text-[12px] text-stone-400 italic py-4 text-center">No playoff games found for {season}</div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
    </LookAheadNavProvider>
  );
}
