"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoxscoreTable, LiveGameBanner, SHOT_CATS } from "./boxscore";
import { valueAdd, valueAddByCategory } from "../scoring";
import { TeamScoreCard } from "./scoreboard";
import { gameLeader } from "../lib/leader";
import { useVAMode } from "../lib/va-mode";
import { teamColor, trimFixed } from "../lib/format";
import { percentile, teamSums, tapeMeasures } from "../lib/team-context";
import { useSeasonContext } from "../lib/use-season-context";
import { etDate, seasonOf } from "../lib/regular-season-games";

// The Live tab: today's games, the ones on now at the top. Once the day's
// games are over (or before the first tips) it's NBA Today instead: the next
// slate's schedule over the last slate's finals. Built from the
// playoff tracker's live pieces (CurrentView's sync strip, the bracket's game
// banners, the "Today's Upcoming Games" card) with the draft taken out, so it
// works any night of the season. Games come from /api/live; each live banner
// polls its own box score and shows the top five by Value Added (a final
// keeps its top five up too), and tapping one opens the full box with
// players split On Court / Bench. A player's card
// here is one game's: every category, and the game's place in his team's
// season.

// The slate re-polls this often while a game is on, and much less when
// nothing is (so a game tipping off still turns up on its own).
const LIVE_POLL = 30000;
const IDLE_POLL = 5 * 60000;

// Live red, later grey, final black, in the slate summary.
const STATUS_INK = { 1: "text-stone-400", 2: "text-red-600", 3: "text-stone-900" };

const KIND_LABEL = { preseason: "Preseason", playoffs: "Playoffs", playin: "Play-In", allstar: "All-Star" };

function dayLabel(date) {
  if (!date) return "Today";
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

// A slate's heading in NBA Today, by where its day sits from today (Eastern,
// the NBA's day): "Today’s Games", "Yesterday’s Games", or past those the
// weekday.
const todayEt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
function slateTitle(date) {
  const diff = Math.round((Date.parse(date) - Date.parse(todayEt())) / 864e5);
  const day = diff === 0 ? "Today" : diff === -1 ? "Yesterday" : diff === 1 ? "Tomorrow"
    : new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `${day}’s Games`;
}

function TeamTag({ side }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-bold tabular-nums" style={{ color: teamColor(side.tri) }}>{side.tri}</span>
      {side.record && <span className="text-[9px] text-stone-400 tabular-nums">{side.record}</span>}
    </span>
  );
}

function SectionHeader({ title, count, live, sub }) {
  return (
    <div className="flex items-baseline justify-between mb-2.5 pb-1.5 border-b-2 border-stone-900">
      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-900 flex items-center gap-2">
        {live && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span>}
        {title}
        {sub && <span className="font-normal tracking-wider text-stone-500">{sub}</span>}
      </h3>
      <span className="text-[10px] uppercase tracking-wider text-stone-500 tabular-nums">{count} game{count === 1 ? "" : "s"}</span>
    </div>
  );
}

// A tapped team's game beside its opponent's, line by line, for its card's
// tale of the tape: { opp, rows }, each row { key, label, own, opp, share }
// with `share` the selected team's part of the bar, always read as "more is
// better" for it. The measures are lib/team-context.js tapeMeasures: 2P / 3P
// / FT Value Added (with the selected team's makes, attempts and percentage
// beside its figure, and the opponent's makes, attempts and percentage in
// place of its VA), DEF PPP, wTRB% and Poss Ratio — labeled 2P, 3P, FT,
// Def PPP, wTRB and POSS. A shooting bar splits on
// the two teams' percentiles among the season's team-games (`dist`, from the
// card's context): VA sits either side of zero, and two small figures of
// opposite sign would otherwise fill the bar. Without the season to hand it
// splits on the gap between the two, against 10 points of VA. DEF PPP's bar
// is turned round, lower being better.
function teamTape(box, tri, lga, dist) {
  const ownT = [box?.away, box?.home].find((t) => t?.tri === tri);
  const oppT = [box?.away, box?.home].find((t) => t && t.tri !== tri);
  if (!ownT?.players || !oppT?.players) return null;
  const [own, opp] = [teamSums(ownT.players), teamSums(oppT.players)];
  const [o, d] = [tapeMeasures(own, opp, lga), tapeMeasures(opp, own, lga)];
  const shootingShare = (key) => {
    const [po, pd] = [percentile(dist?.[key], o[key]), percentile(dist?.[key], d[key])];
    if (po == null || pd == null) return Math.min(Math.max(0.5 + (o[key] - d[key]) / 20, 0), 1);
    return po + pd > 0 ? po / (po + pd) : 0.5;
  };
  return {
    opp: oppT.tri,
    rows: tapeRows(o, d, own, opp, 1, shootingShare, (v) => v / (v + 1)),
  };
}

// The tape's six lines from the two sides' measures (`o` the tapped team's,
// `d` the other's) and box-score sums (`own`, `opp`, over `gp` games: the
// makes and attempts beside a shooting line are per game). `shootingShare`
// (key) and `possShare` (the tapped team's Poss Ratio) give those lines'
// bars; DEF PPP's is turned round, lower being better, and wTRB's is the
// tapped team's part of the two figures.
function tapeRows(o, d, own, opp, gp, shootingShare, possShare) {
  const split = (a, b) => (Math.abs(a) + Math.abs(b) > 0 ? 0.5 + (a - b) / (2 * (Math.abs(a) + Math.abs(b))) : 0.5);
  const fmt = (v, f) => (v == null ? "–" : f(v));
  const fmtPct = (v) => `${trimFixed(v, 1)}%`;
  const fmtVA = (v) => (trimFixed(v, 1) === "0" ? "0" : `${v >= 0 ? "+" : "−"}${trimFixed(Math.abs(v), 1)}`);
  const line = (made, att) => `${trimFixed(made / gp, 1)}/${trimFixed(att / gp, 1)} · ${att ? fmtPct(100 * made / att) : "–"}`;
  const shooting = (key, [made, att], [oppMade, oppAtt]) => ({
    key, label: key, own: fmtVA(o[key]), note: line(made, att), opp: line(oppMade, oppAtt), share: shootingShare(key),
  });
  return [
    shooting("2P", [own.fgm - own.tpm, own.fga - own.tpa], [opp.fgm - opp.tpm, opp.fga - opp.tpa]),
    shooting("3P", [own.tpm, own.tpa], [opp.tpm, opp.tpa]),
    shooting("FT", [own.ftm, own.fta], [opp.ftm, opp.fta]),
    { key: "def", label: "Def PPP", own: fmt(o.def, (v) => trimFixed(v, 2)), opp: fmt(d.def, (v) => trimFixed(v, 2)), share: split(d.def || 0, o.def || 0) },
    { key: "reb", label: "wTRB", own: fmt(o.reb, fmtPct), opp: fmt(d.reb, fmtPct), share: o.reb != null && d.reb != null ? o.reb / (o.reb + d.reb) : 0.5 },
    { key: "poss", label: "POSS", own: fmt(o.poss, (v) => trimFixed(v, 2)), opp: fmt(d.poss, (v) => trimFixed(v, 2)), share: o.poss ? possShare(o.poss, d.poss) : 0.5 },
  ];
}

// The pregame tape: a team's season so far beside its opponent's, the same
// six lines as a game's (teamTape) but each side's season averages — its
// own measures over its games (lib/team-context.js tapeMeasures), makes and
// attempts per game. The bars split on where the two seasons sit among the
// league's (`teamDist`). Null until both teams have played.
function seasonTape(ownCtx, oppCtx, oppTri, lga) {
  const [a, b] = [ownCtx?.season, oppCtx?.season];
  if (!a?.gp || !b?.gp) return null;
  const [o, d] = [tapeMeasures(a.own, a.opp, lga, a.gp), tapeMeasures(b.own, b.opp, lga, b.gp)];
  const dist = ownCtx.teamDist;
  const shootingShare = (key) => {
    const [po, pd] = [percentile(dist?.[key], o[key]), percentile(dist?.[key], d[key])];
    if (po == null || pd == null) return Math.min(Math.max(0.5 + (o[key] - d[key]) / 20, 0), 1);
    return po + pd > 0 ? po / (po + pd) : 0.5;
  };
  // Per-game lines need each side's own games: scale the opponent's sums to
  // the tapped team's count so tapeRows' one divisor reads both right.
  const scaled = Object.fromEntries(Object.entries(b.own).map(([k, v]) => [k, v * a.gp / b.gp]));
  return { opp: oppTri, rows: tapeRows(o, d, a.own, scaled, a.gp, shootingShare, (x, y) => (y ? x / (x + y) : 0.5)) };
}

// A tape with the opponent's score on the scoreboard (which a live game
// keeps current) for its header.
const withScore = (tape, oppScore) => tape && { ...tape, oppScore };

// A team's game number this season, off its record: the record counts a
// final already, a live game not yet. Unknown for a playoff game (the record
// is the regular season's) or a feed without records.
function teamGameNumber(side, g) {
  const m = (side.record || "").match(/^(\d+)-(\d+)$/);
  if (!m || !["regular", "preseason"].includes(g.kind)) return null;
  return Number(m[1]) + Number(m[2]) + (g.gameStatus === 2 ? 1 : 0) || null;
}

// A game's place on the page, for the slate summary to scroll to.
const gameAnchor = (g) => `live-game-${g.gameId}`;

// One game: the competition's scoreboard, away card beside home card, each
// team's record under its card, then the banner for the clock and the box score.
// Tapping a card narrows the game to that team: its card alone, framed in its
// color with its tale of the tape against the opponent, over its whole box. Tapping it
// again brings the other side back. `focus` (About Last Night's tap) narrows
// the game to the player's team and opens his card. Explore's regular-season
// days use it too, handing in their own `lga` and `boxLoader` (a baked box).
// `context`, when given, is (tri) -> the team's regular season through this
// game (lib/use-season-context.js: { record, place, conf, ranks, dist }) or
// null: its record fills the row under the cards where the feed carries none
// (Explore's games), and a tapped card takes the record inside, beside the
// score, with the conference place under it and the league ranks down its
// tape. `onTeamPick` hears a tapped side's team (Explore's month narrows its
// games to it, the Live tab starts loading the season); with `keepInView`
// the card keeps its place on screen as the games around it come and go.
// Tapping a shooting line of the tape sorts the box below by that
// category's VA, with its makes, attempts and percentage.
export function GameCard({ g, lgaFor, baselineSeason, lga: lgaIn, boxLoader, focus, onFocusHandled, onTeamPick, keepInView, context }) {
  const lga = lgaIn || lgaFor(baselineSeason, g.kind === "playoffs" ? "po" : "rs");
  const kind = KIND_LABEL[g.kind];
  // The index scope and season a player's card reads his season so far from:
  // the regular season's or the playoffs', in the season the game is in.
  const soFarScope = g.kind === "regular" ? "regular" : g.kind === "playoffs" ? "playoffs" : null;
  const soFarDate = g.gameDateTimeUTC ? etDate(g.gameDateTimeUTC) : null;
  const seasonSoFar = useMemo(
    () => (soFarScope && soFarDate ? { scope: soFarScope, season: seasonOf(new Date(`${soFarDate}T12:00:00Z`)) } : null),
    [soFarScope, soFarDate]
  );
  const [team, setTeam] = useState(null);
  const [box, setBox] = useState(null);
  // The shooting category ("2P" / "3P" / "FT") the box is sorted by.
  const [cat, setCat] = useState(null);
  const cardRef = useRef(null);
  useEffect(() => { if (focus) { setTeam(focus.team); onTeamPick?.(focus.team); } }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (tri) => {
    setTeam(tri);
    setCat(null);
    if (!tri) return;
    onTeamPick?.(tri);
    if (keepInView) requestAnimationFrame(() => cardRef.current?.scrollIntoView({ block: "start" }));
  };

  const leader = gameLeader(g);
  const ctxOf = (side) => {
    const c = context?.(side.tri) ?? null;
    return side.record ? { ...c, record: side.record } : c;
  };
  const gameNumberFor = (tri) => {
    const side = [g.away, g.home].find((s) => s.tri === tri);
    return side ? teamGameNumber({ record: ctxOf(side)?.record }, g) : null;
  };
  const ctx = team ? ctxOf([g.away, g.home].find((s) => s.tri === team)) : null;
  const records = team ? [] : [g.away, g.home].map((side) => ctxOf(side)?.record);
  const sides = [[g.away, g.home, false], [g.home, g.away, true]].filter(([side]) => !team || side.tri === team);
  return (
    <div
      id={gameAnchor(g)}
      ref={cardRef}
      className={`mb-3 p-2 rounded scroll-mt-3 ${team ? "bg-white border-2" : "bg-stone-50 border border-stone-200"}`}
      style={team ? { borderColor: teamColor(team) } : undefined}
    >
      <div className="relative flex gap-4">
        {sides.map(([side, other, right]) => (
          <button
            key={side.tri}
            onClick={() => pick(team ? null : side.tri)}
            aria-pressed={!!team}
            className="flex-1 flex text-left"
          >
            <TeamScoreCard side={side} ahead={side.tri === leader} right={right} tape={team ? withScore(teamTape(box, team, lga, ctx?.dist), other.score) : null} context={ctx}
              cat={cat} onCat={(k) => setCat(cat === k ? null : k)} />
          </button>
        ))}
        {/* In the gap, halfway down the cards. */}
        {!team && <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex items-center text-xs font-bold text-stone-400">@</span>}
      </div>
      {records.some(Boolean) && <div className="flex gap-4 text-sm font-bold tabular-nums tracking-widest">
        {sides.map(([side, , right], i) => (
          <div key={side.tri} className={`flex-1 px-3 py-1.5 ${right ? "text-right" : ""}`} style={{ color: teamColor(side.tri) }}>
            {records[i] || "–"}
          </div>
        ))}
      </div>}
      <LiveGameBanner
        liveGame={g}
        gameLabel={kind}
        lga={lga}
        teams={{}}
        useTeamColor
        boxSrc={g.boxSrc || undefined}
        boxLoader={boxLoader}
        hideScore
        teamFilter={team}
        onTeamClear={() => pick(null)}
        teamCat={cat}
        onBox={setBox}
        singleGame
        finalTop5
        seasonSoFar={seasonSoFar}
        gameNumberFor={gameNumberFor}
        focusPlayer={focus?.name}
        onFocusHandled={onFocusHandled}
      />
    </div>
  );
}

// A game yet to tip, narrowed to one team: its card holds the pregame
// projection (lib/team-context.js projectScore) where a game's score would
// be, its opponent's opposite, and its tale of the tape over the two teams'
// seasons so far (seasonTape) with the team's league ranks; under it the
// team's players, each his season per game (seasonLines). Tapping a
// shooting line of the tape sorts the players by that category's VA, with
// their makes, attempts and percentage, as a game's card does its box.
// `context` is the Live tab's (tri, date) -> season so far
// (lib/use-season-context.js), loading until it isn't. Tapping the card
// closes it.
function PregameCard({ g, tri, lga, context, onClose }) {
  const date = g.gameDateTimeUTC ? etDate(g.gameDateTimeUTC) : null;
  const right = tri === g.home.tri;
  const [side, other] = right ? [g.home, g.away] : [g.away, g.home];
  const ctxOf = (s) => {
    const c = context?.(s.tri, date) ?? null;
    return s.record ? { ...c, record: s.record } : c;
  };
  const [ctx, oppCtx] = [ctxOf(side), ctxOf(other)];
  const proj = ctx?.project?.(g.away.tri, g.home.tri);
  const [own, opp] = proj ? (right ? [proj.home, proj.away] : [proj.away, proj.home]) : [null, null];
  const tape = seasonTape(ctx, oppCtx, other.tri, lga);
  const [cat, setCat] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const players = useMemo(() => seasonLines(ctx?.players, lga, cat), [ctx?.players, lga, cat]);
  const seasonSoFar = useMemo(() => (date ? { scope: "regular", season: seasonOf(new Date(`${date}T12:00:00Z`)) } : null), [date]);
  return (
    <div className="my-2 p-2 rounded bg-white border-2" style={{ borderColor: teamColor(tri) }}>
      <button onClick={onClose} className="w-full flex text-left">
        <TeamScoreCard
          side={{ tri, score: own == null ? "–" : Math.round(own) }}
          ahead={own != null && Math.round(own) > Math.round(opp)}
          right={right}
          tape={tape ? { ...tape, oppScore: opp == null ? null : Math.round(opp) } : null}
          context={ctx}
          kicker="Projected"
          cat={cat}
          onCat={(k) => setCat(cat === k ? null : k)}
        />
      </button>
      {players.length > 0 && (
        <div className="mt-2 px-1">
          <div className="text-[9px] uppercase tracking-widest text-stone-500 py-1">Season per game{cat ? ` · by ${cat} VA` : ""}</div>
          <BoxscoreTable rows={players} expandedKey={expanded} setExpandedKey={setExpanded} lga={lga} teams={{}} useTeamColor cat={cat} seasonSoFar={seasonSoFar} />
        </div>
      )}
      {!tape && (
        <div className="pt-2 text-center text-[10px] uppercase tracking-wider text-stone-400">
          {ctx?.project ? "No season averages until both teams have played" : "Loading the season…"}
        </div>
      )}
    </div>
  );
}

// A team's players' season totals (lib/season-to-date.js playerTotals) as
// box-score rows a game per game — counts, minutes and VA each over his own
// games, starting where he started most of them — sorted by VA, or with
// `cat` (a SHOT_CATS key) by that category's VA (`catVA`) then attempts.
function seasonLines(players, lga, cat) {
  const c = cat && SHOT_CATS[cat];
  const rows = (players || []).filter((p) => p.g > 0).map((p) => {
    const row = { name: p.name, team: p.team, gp: p.g, starter: 2 * p.gs >= p.g };
    for (const k of ["mp", "pts", "ast", "stl", "blk", "tov", "drb", "orb", "fgm", "fga", "tpm", "tpa", "ftm", "fta"]) row[k] = (p[k] || 0) / p.g;
    row.reb = row.drb + row.orb;
    row.va = valueAdd(row, lga);
    if (c) row.catVA = valueAddByCategory(row, lga)[c.va];
    return row;
  });
  return c ? rows.sort((a, b) => b.catVA - a.catVA || c.att(b) - c.att(a)) : rows.sort((a, b) => b.va - a.va);
}

// Games yet to tip, a line each. In the regular season, with `context`
// given, a team's name opens its pregame card (PregameCard) under the line,
// `onTeamPick` hearing it; tapping it again, or the card, closes it.
function UpcomingList({ games, lga, context, onTeamPick }) {
  const [open, setOpen] = useState({}); // gameId -> tri
  const toggle = (g, tri) => {
    setOpen((o) => ({ ...o, [g.gameId]: o[g.gameId] === tri ? null : tri }));
    onTeamPick?.(tri);
  };
  return (
    <div className="mb-6 p-3 bg-white border border-stone-300">
      <div className="space-y-1">
        {games.map((g) => {
          const d = g.gameDateTimeUTC ? new Date(g.gameDateTimeUTC) : null;
          const timeStr = d && g.gameStatusText !== "TBD"
            ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
            : "TBD";
          const tv = (g.broadcasters || []).join(", ");
          const tappable = context && g.kind === "regular" && g.gameDateTimeUTC;
          const tag = (side) => (tappable ? (
            <button type="button" onClick={() => toggle(g, side.tri)} aria-pressed={open[g.gameId] === side.tri}
              className={`rounded px-0.5 -mx-0.5 hover:bg-stone-100 ${open[g.gameId] === side.tri ? "bg-stone-100" : ""}`}>
              <TeamTag side={side} />
            </button>
          ) : <TeamTag side={side} />);
          return (
            <div key={g.gameId} id={gameAnchor(g)} className="scroll-mt-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="tabular-nums text-[10px] text-stone-500 w-14 shrink-0">{timeStr}</span>
                  {tag(g.away)}
                  <span className="text-stone-400">@</span>
                  {tag(g.home)}
                </div>
                {tv && <span className="text-[9px] uppercase tracking-wider text-stone-500 shrink-0 truncate max-w-[40%]">{tv}</span>}
              </div>
              {open[g.gameId] && (
                <PregameCard g={g} tri={open[g.gameId]} lga={lga} context={context}
                  onClose={() => setOpen((o) => ({ ...o, [g.gameId]: null }))} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The slate at a glance: its day, how many games are live / later / final,
// and every game's line, colored by where it stands. Tapping a line scrolls
// down to that game.
function SlateSummary({ date, games }) {
  const count = (status) => games.filter((g) => g.gameStatus === status).length;
  return (
    <div className="mb-5 p-3 bg-white border-2 border-stone-900">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-xs uppercase tracking-wider text-stone-500 truncate">{dayLabel(date)}</div>
        <div className="flex gap-2.5 shrink-0 text-xs uppercase tracking-wider text-stone-500 tabular-nums">
          {[["Live", count(2), STATUS_INK[2]], ["Later", count(1), STATUS_INK[1]], ["Final", count(3), STATUS_INK[3]]].map(([label, n, cls]) => (
            <span key={label}><span className={`font-black ${n ? cls : "text-stone-300"}`}>{n}</span> {label}</span>
          ))}
        </div>
      </div>
      {games.length === 0
        ? <div className="mt-1 text-sm font-bold text-stone-900 text-center">No games today</div>
        : (
          // Two halves, filled left-right then top-bottom; each line's @ sits
          // on its half's center line.
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm font-bold tabular-nums">
            {games.map((g) => {
              const ink = STATUS_INK[g.gameStatus] || "text-stone-900";
              const scored = g.gameStatus !== 1;
              return (
                <button
                  key={g.gameId}
                  type="button"
                  onClick={() => document.getElementById(gameAnchor(g))?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className={`grid grid-cols-[1fr_auto_1fr] gap-x-1.5 font-bold hover:opacity-70 ${ink}`}
                >
                  <span className="text-right whitespace-nowrap">{g.away.tri}{scored && ` ${g.away.score}`}</span>
                  <span>@</span>
                  <span className="text-left whitespace-nowrap">{scored && `${g.home.score} `}{g.home.tri}</span>
                </button>
              );
            })}
          </div>
        )}
    </div>
  );
}

export function LiveView({ onData, focus, onFocusHandled }) {
  const { lgaFor } = useVAMode();
  const [data, setData] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState(null);
  const [syncError, setSyncError] = useState(null);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/live", { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d) throw new Error(d?.errors?.join("; ") || `Live feed ${res.status}`);
      setData(d);
      setSyncedAt(new Date(d.fetchedAt || Date.now()));
    } catch (e) {
      setSyncError(e.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => { sync(); }, [sync]);

  const games = data?.games || [];
  const live = games.filter((g) => g.gameStatus === 2);
  const upcoming = games.filter((g) => g.gameStatus === 1);
  const finals = games.filter((g) => g.gameStatus === 3);
  const anyLive = live.length > 0;
  // Nothing on and the day done (or not begun): the next slate and the last.
  const upNext = data?.mode === "upnext";

  useEffect(() => { if (data) onData?.(data); }, [data, onData]);

  // About Last Night's player: his game among the finished ones on show, or,
  // when the tab has moved on to another night, nothing to open.
  const focusSlate = upNext ? data?.prev : data && { date: data.date, games };
  const focusGame = focus && focusSlate?.date === focus.date
    ? focusSlate.games.find((g) => g.gameStatus !== 1 && (g.away.tri === focus.team || g.home.tri === focus.team))
    : null;
  useEffect(() => {
    if (focus && data && !focusGame) onFocusHandled?.();
  }, [focus, data, focusGame, onFocusHandled]);
  // A tapped team's season so far, loaded the first time a card is tapped.
  const [picked, setPicked] = useState(false);
  const context = useSeasonContext({
    enabled: picked, season: seasonOf(), lga: data ? lgaFor(data.baselineSeason, "rs") : null,
  });
  const upcomingList = (list) => (
    <UpcomingList games={list} lga={data ? lgaFor(data.baselineSeason, "rs") : null}
      context={context} onTeamPick={() => setPicked(true)} />
  );
  const gameCard = (g) => (
    <GameCard key={g.gameId} g={g} lgaFor={lgaFor} baselineSeason={data.baselineSeason}
      focus={g === focusGame ? focus : null} onFocusHandled={onFocusHandled}
      onTeamPick={() => setPicked(true)}
      context={g.kind === "regular" && g.gameDateTimeUTC ? (tri) => context(tri, etDate(g.gameDateTimeUTC)) : undefined} />
  );

  useEffect(() => {
    const id = setInterval(sync, anyLive ? LIVE_POLL : IDLE_POLL);
    // A phone that slept through a quarter catches up when it wakes.
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [anyLive, sync]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-[10px] uppercase tracking-widest text-stone-400 leading-tight">
          {syncedAt ? (<>Live synced <span className="text-stone-600">{syncedAt.toLocaleTimeString()}</span></>) : syncing ? "Syncing…" : "Not synced yet"}
          {syncError && <div className="text-red-600 normal-case mt-0.5 tracking-normal">{syncError}</div>}
        </div>
        <button onClick={sync} disabled={syncing} className="shrink-0 text-[10px] uppercase tracking-widest text-stone-600 border border-stone-400 px-2 py-1.5 bg-white hover:bg-stone-50 disabled:opacity-50">
          {syncing ? "Syncing…" : "↻ Sync"}
        </button>
      </div>

      {data && !upNext && <SlateSummary date={data.date} games={games} />}

      {upNext && (
        <>
          <div className="mb-6">
            {data.next ? (
              <>
                <SectionHeader title={slateTitle(data.next.date)} sub={dayLabel(data.next.date)} count={data.next.games.length} />
                {upcomingList(data.next.games)}
              </>
            ) : (
              <>
                <SectionHeader title="Up Next" count={0} />
                <div className="py-4 text-center text-[11px] text-stone-500 border border-dashed border-stone-300 bg-white">Nothing on the schedule this week.</div>
              </>
            )}
          </div>
          {data.prev && (
            <div className="mb-6">
              <SectionHeader title={slateTitle(data.prev.date)} count={data.prev.games.length} />
              {data.prev.games.map(gameCard)}
            </div>
          )}
        </>
      )}

      {data && !upNext && !anyLive && (
        <div className="mb-6 py-4 text-center text-[11px] text-stone-500 border border-dashed border-stone-300 bg-white">
          {upcoming.length
            ? <>No games on right now. Next tip: <span className="font-semibold text-stone-700">{upcomingTip(upcoming[0])}</span></>
            : games.length ? "Tonight's games are done." : "Nothing on the schedule today."}
        </div>
      )}

      {anyLive && (
        <div className="mb-6">
          <SectionHeader title="Live Now" count={live.length} live />
          {live.map(gameCard)}
        </div>
      )}

      {!upNext && upcoming.length > 0 && (
        <>
          <SectionHeader title="Later Today" count={upcoming.length} />
          {upcomingList(upcoming)}
        </>
      )}

      {!upNext && finals.length > 0 && (
        <div className="mb-6">
          <SectionHeader title="Final" count={finals.length} />
          {finals.map(gameCard)}
        </div>
      )}

      {data && (upNext ? data.prev?.games.length : games.length) > 0 && (
        <div className="text-[10px] text-stone-400 italic text-center">
          VA vs the {data.baselineSeason} baseline{data.baselineSeason !== data.season ? " (this season’s isn’t set yet)" : ""}. Tap a game for its box score, a player for his VA breakdown.
        </div>
      )}
    </div>
  );
}

function upcomingTip(g) {
  const d = g.gameDateTimeUTC ? new Date(g.gameDateTimeUTC) : null;
  const time = d && g.gameStatusText !== "TBD" ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "TBD";
  return `${g.away.tri} @ ${g.home.tri}, ${time}`;
}
