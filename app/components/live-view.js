"use client";

import { useCallback, useEffect, useState } from "react";
import { LiveGameBanner } from "./boxscore";
import { TeamScoreCard } from "./scoreboard";
import { useVAMode } from "../lib/va-mode";
import { teamColor } from "../lib/format";

// The Live tab: today's games, the ones on now at the top. Once the day's
// games are over (or before the first tips) it's NBA Today instead: the next
// slate's schedule over the last slate's finals. Built from the
// playoff tracker's live pieces (CurrentView's sync strip, the bracket's game
// banners, the "Today's Upcoming Games" card) with the draft taken out, so it
// works any night of the season. Games come from /api/live; each live banner
// polls its own box score and shows the top five by Value Added, and tapping
// one opens the full box with players split On Court / Bench. A player's card
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

// A team's 2P / 3P / FT as [label, made, attempted], summed from its box.
function shootingSplits(box, tri) {
  const players = [box?.away, box?.home].find((t) => t?.tri === tri)?.players;
  if (!players) return null;
  const sum = (k) => players.reduce((n, p) => n + (p[k] || 0), 0);
  const [fgm, fga, tpm, tpa] = [sum("fgm"), sum("fga"), sum("tpm"), sum("tpa")];
  return [["2P", fgm - tpm, fga - tpa], ["3P", tpm, tpa], ["FT", sum("ftm"), sum("fta")]];
}

// A team's game number this season, off its record: the record counts a
// final already, a live game not yet. Unknown for a playoff game (the record
// is the regular season's) or a feed without records.
function teamGameNumber(side, g) {
  const m = (side.record || "").match(/^(\d+)-(\d+)$/);
  if (!m || !["regular", "preseason"].includes(g.kind)) return null;
  return Number(m[1]) + Number(m[2]) + (g.gameStatus === 2 ? 1 : 0) || null;
}

// One game: the competition's scoreboard, away card beside home card, each
// team's record under its card, then the banner for the clock and the box score.
// Tapping a card narrows the game to that team: its card alone, framed in its
// color with its shooting down the far side, over its whole box. Tapping it
// again brings the other side back. `focus` (About Last Night's tap) narrows
// the game to the player's team and opens his card.
function GameCard({ g, lgaFor, baselineSeason, focus, onFocusHandled }) {
  const lga = lgaFor(baselineSeason, g.kind === "playoffs" ? "po" : "rs");
  const kind = KIND_LABEL[g.kind];
  const [team, setTeam] = useState(null);
  const [box, setBox] = useState(null);
  useEffect(() => { if (focus) setTeam(focus.team); }, [focus]);
  const gameNumberFor = useCallback((tri) => {
    const side = [g.away, g.home].find((s) => s.tri === tri);
    return side ? teamGameNumber(side, g) : null;
  }, [g]);
  const sides = [[g.away, g.home, false], [g.home, g.away, true]].filter(([side]) => !team || side.tri === team);
  return (
    <div
      className={`mb-3 p-2 rounded ${team ? "bg-white border-2" : "bg-stone-50 border border-stone-200"}`}
      style={team ? { borderColor: teamColor(team) } : undefined}
    >
      <div className="relative flex gap-4">
        {sides.map(([side, opponent, right]) => (
          <button
            key={side.tri}
            onClick={() => setTeam(team ? null : side.tri)}
            aria-pressed={!!team}
            className="flex-1 flex text-left"
          >
            <TeamScoreCard side={side} opponent={opponent} gameStatus={g.gameStatus} right={right} splits={team ? shootingSplits(box, team) : null} />
          </button>
        ))}
        {/* In the gap, halfway down the cards. */}
        {!team && <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex items-center text-xs font-bold text-stone-400">@</span>}
      </div>
      <div className="flex gap-4 text-sm font-bold tabular-nums tracking-widest">
        {sides.map(([side, , right]) => (
          <div key={side.tri} className={`flex-1 px-3 py-1.5 ${right ? "text-right" : ""}`} style={{ color: teamColor(side.tri) }}>
            {side.record || "–"}
          </div>
        ))}
      </div>
      <LiveGameBanner
        liveGame={g}
        gameLabel={kind}
        lga={lga}
        teams={{}}
        useTeamColor
        boxSrc={g.boxSrc || undefined}
        hideScore
        teamFilter={team}
        onTeamClear={() => setTeam(null)}
        onBox={setBox}
        singleGame
        gameNumberFor={gameNumberFor}
        focusPlayer={focus?.name}
        onFocusHandled={onFocusHandled}
      />
    </div>
  );
}

function UpcomingList({ games }) {
  return (
    <div className="mb-6 p-3 bg-white border border-stone-300">
      <div className="space-y-1">
        {games.map((g) => {
          const d = g.gameDateTimeUTC ? new Date(g.gameDateTimeUTC) : null;
          const timeStr = d && g.gameStatusText !== "TBD"
            ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
            : "TBD";
          const tv = (g.broadcasters || []).join(", ");
          return (
            <div key={g.gameId} className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="tabular-nums text-[10px] text-stone-500 w-14 shrink-0">{timeStr}</span>
                <TeamTag side={g.away} />
                <span className="text-stone-400">@</span>
                <TeamTag side={g.home} />
              </div>
              {tv && <span className="text-[9px] uppercase tracking-wider text-stone-500 shrink-0 truncate max-w-[40%]">{tv}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The slate at a glance: its day, how many games are live / later / final,
// and every game's line, colored by where it stands.
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
                <div key={g.gameId} className={`grid grid-cols-[1fr_auto_1fr] gap-x-1.5 ${ink}`}>
                  <span className="text-right whitespace-nowrap">{g.away.tri}{scored && ` ${g.away.score}`}</span>
                  <span>@</span>
                  <span className="whitespace-nowrap">{scored && `${g.home.score} `}{g.home.tri}</span>
                </div>
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
  const gameCard = (g) => (
    <GameCard key={g.gameId} g={g} lgaFor={lgaFor} baselineSeason={data.baselineSeason}
      focus={g === focusGame ? focus : null} onFocusHandled={onFocusHandled} />
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
                <UpcomingList games={data.next.games} />
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
          <UpcomingList games={upcoming} />
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
