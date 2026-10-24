"use client";

import { TEAMS } from "../teams";
import { ownerBg, ownerColor, ownerDot, teamColor } from "../lib/format";
import { ordinal } from "../lib/team-context";


// The competition's scoreboard card: a label over a big number, a badge for
// whoever's ahead, and whatever sits under the number. ScoreCard fills it
// with an owner's points; TeamScoreCard with a team's score on the Live tab,
// where `filled` paints the card in the team's color with white details and
// `right` mirrors it for the home side. `aside` sits on the far side of the
// card from the label and number; `totalNote` beside the number, inboard.
function ScoreFrame({ label, dot, accent, filled, right, borderClass, badge, total, totalClass, totalNote, aside, children }) {
  const ink = filled ? "#fff" : accent;
  return (
    <div className={`flex-1 p-3 border-2 flex items-center gap-3 ${right ? "flex-row-reverse" : ""} ${borderClass || ""} ${filled ? "" : "bg-white"}`} style={accent ? { borderColor: accent, backgroundColor: filled ? accent : undefined } : undefined}>
      <div className="flex-1 min-w-0">
      <div className={`flex items-center justify-between mb-1 ${right ? "flex-row-reverse" : ""}`}>
        <div className={`flex items-center gap-1.5 ${right ? "flex-row-reverse" : ""}`}>
          <span className={`w-2 h-2 rounded-full ${dot || ""}`} style={ink ? { backgroundColor: ink } : undefined}></span>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${filled ? "text-stone-100" : "text-stone-700"}`}>{label}</span>
        </div>
        {badge && <span className="text-[9px] font-bold uppercase tracking-wider text-stone-900 bg-stone-900 text-white px-1.5 py-0.5">{badge}</span>}
      </div>
      <div className={`flex items-end gap-3 ${right ? "flex-row-reverse" : ""}`}>
        <div className={`text-4xl font-black tabular-nums ${right ? "text-right" : ""} ${totalClass || ""}`} style={ink ? { color: ink } : undefined}>{total}</div>
        {totalNote}
      </div>
      {children}
      </div>
      {aside}
    </div>
  );
}


export function ScoreCard({ owner, total, projectedTotal, realProjectedTotal, whatIfTotal, opponentProjected, breakdown, readOnly }) {
  const leading = projectedTotal > opponentProjected;
  const tied = projectedTotal === opponentProjected;
  const realProj = realProjectedTotal ?? projectedTotal;
  const hasRealProjection = !readOnly && Math.abs(realProj - total) > 0.001;
  const hasWhatIf = !readOnly && (whatIfTotal || 0) > 0.001;
  return (
    <ScoreFrame
      label={owner}
      dot={ownerDot(owner)}
      borderClass={owner === "Spencer" ? "border-amber-600" : "border-teal-600"}
      badge={leading && !tied ? (readOnly ? "WINNER" : "LEAD") : null}
      total={total}
      totalClass={ownerColor(owner)}
    >
      <div className="text-[10px] text-stone-500 uppercase tracking-wider mt-0.5">{breakdown.length} win{breakdown.length === 1 ? "" : "s"}{readOnly ? "" : " · locked"}</div>
      {hasRealProjection && (
        <div className="mt-2 pt-2 border-t border-stone-200">
          <div className="text-[9px] uppercase tracking-widest text-stone-500">Projected</div>
          <div className={`text-lg font-bold tabular-nums ${ownerColor(owner)}`}>{realProj.toFixed(2)}</div>
        </div>
      )}
      {hasWhatIf && (
        <div className="mt-1">
          <div className="text-[9px] uppercase tracking-widest text-stone-400">What If?</div>
          <div className="text-sm font-semibold tabular-nums text-stone-500">+{whatIfTotal.toFixed(2)}</div>
        </div>
      )}
    </ScoreFrame>
  );
}


// One side of a game on the Live tab, in the team's color. `ahead` (the
// game's leader, lib/leader.js) gets the card filled in.
// `tape`, when given (a tapped team: { opp, rows }), runs under the score as
// a tale of the tape: per line the team's figure (and its `note`, small), a
// tug-of-war bar against the opponent and the opponent's figure. The team
// holds its own end of the card (the home card is mirrored), in solid ink and
// bold; the opponent's end is in its color, its figure small. A tick marks
// even. `context` (the team's season through the game: { record, place,
// conf, ranks }) puts its league rank under each line's label and its record
// and conference place beside its score.
export function TeamScoreCard({ side, ahead, right, tape, context }) {
  const accent = teamColor(side.tri);
  const ink = ahead ? "#fff" : accent;
  const oppColor = tape && teamColor(tape.opp);
  const muted = ahead ? "text-white/70" : "text-stone-400";
  const body = tape && (
    <div className="mt-2.5 space-y-1.5">
      <div className={`flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest ${right ? "flex-row-reverse" : ""}`}>
        <span className="w-16 shrink-0" />
        <span className={`flex-1 flex justify-between ${right ? "flex-row-reverse" : ""}`}>
          <span style={{ color: ink }}>{side.tri}</span>
          <span className={muted}>{tape.opp}</span>
        </span>
      </div>
      {tape.rows.map((r) => {
        const pct = Math.round(Math.min(Math.max(r.share, 0.04), 0.96) * 100);
        return (
          <div key={r.label} className={`flex items-center gap-2 text-xs tabular-nums ${right ? "flex-row-reverse text-right" : ""}`}>
            <span className="w-16 shrink-0 flex flex-col">
              <span className={`text-[9px] font-bold uppercase tracking-wider ${muted}`}>{r.label}</span>
              {context?.ranks?.[r.key] && <span className="text-[10px] font-bold leading-tight" style={{ color: ink }}>{ordinal(context.ranks[r.key])}</span>}
            </span>
            <span className="flex-1 min-w-0">
              <span className={`flex items-baseline justify-between gap-2 ${right ? "flex-row-reverse" : ""}`}>
                <span className="truncate" style={{ color: ink }}>
                  {right && r.note && <span className={`text-[10px] mr-1.5 ${muted}`}>{r.note}</span>}
                  <span className="font-bold">{r.own}</span>
                  {!right && r.note && <span className={`text-[10px] ml-1.5 ${muted}`}>{r.note}</span>}
                </span>
                <span className={`text-[10px] ${muted}`}>{r.opp}</span>
              </span>
              <span className={`relative mt-0.5 flex h-1 gap-px ${right ? "flex-row-reverse" : ""}`}>
                <span style={{ width: `${pct}%`, backgroundColor: ink }} />
                <span className="flex-1" style={{ backgroundColor: oppColor, opacity: 0.55, boxShadow: ahead ? "inset 0 0 0 0.5px rgba(255,255,255,0.6)" : undefined }} />
                <span className={`absolute left-1/2 -top-0.5 -bottom-0.5 w-px ${ahead ? "bg-white/80" : "bg-stone-900/40"}`} />
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
  const standing = context?.record && (
    <div className={`pb-1 leading-tight tabular-nums ${right ? "text-right" : ""}`}>
      <div className="text-sm font-bold" style={{ color: ink }}>{context.record}, {ordinal(context.place)}</div>
      <div className={`text-[9px] font-bold uppercase tracking-wider ${muted}`}>in the {context.conf === "E" ? "East" : "West"}</div>
    </div>
  );
  return <ScoreFrame label={side.tri} accent={accent} filled={ahead} right={right} total={side.score} totalNote={standing}>{body}</ScoreFrame>;
}


export function BreakdownList({ breakdown, owner }) {
  if (breakdown.length === 0) return <div className="text-xs text-stone-400 italic py-3 text-center">No wins yet</div>;
  return (
    <div className="space-y-1.5">
      {breakdown.map((item, i) => (
        <div key={i} className={`flex items-center justify-between text-xs px-2 py-1.5 ${ownerBg(owner)} border`}>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-stone-900 truncate">({item.team.seed}) {item.team.name}</div>
            <div className="text-[10px] text-stone-500 uppercase tracking-wider">{item.round} · beat ({item.opp.seed}) {item.opp.name}</div>
          </div>
          <div className="text-right ml-2 tabular-nums">
            <div className="font-bold text-sm text-stone-900">{item.total}</div>
            {item.bonus > 0 && <div className="text-[9px] text-stone-500">{item.base}+{item.bonus}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}


export function ProjectionList({ projections, owner, label, muted }) {
  if (!projections || projections.length === 0) return null;
  return (
    <div className="mt-3">
      <div className={`text-[10px] uppercase tracking-widest mb-1.5 ${muted ? "text-stone-400" : "text-stone-500"}`}>{label}</div>
      <div className="space-y-1.5">
        {projections.map((item, i) => (
          <div key={i} className={`flex items-center justify-between text-xs px-2 py-1.5 border border-dashed border-stone-300 ${muted ? "bg-stone-50" : "bg-white"}`}>
            <div className="flex-1 min-w-0">
              <div className={`font-semibold truncate ${muted ? "text-stone-600" : "text-stone-900"}`}>({item.team.seed}) {item.team.name}</div>
              <div className="text-[10px] text-stone-500 uppercase tracking-wider">{item.round} · {item.gamesWon}/4 vs ({item.opp.seed}) {item.opp.name}</div>
            </div>
            <div className="text-right ml-2 tabular-nums">
              <div className={`font-bold text-sm ${muted ? "text-stone-600" : ownerColor(owner)}`}>{item.projected.toFixed(2)}</div>
              <div className="text-[9px] text-stone-500">of {item.total}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


export function WhatIfClinchedList({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-widest text-stone-400 mb-1.5">Speculated Series Wins</div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 bg-stone-50 border border-dashed border-stone-300">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-stone-600 truncate">({item.team.seed}) {item.team.name}</div>
              <div className="text-[10px] text-stone-500 uppercase tracking-wider">{item.round} · beat ({item.opp.seed}) {item.opp.name}</div>
            </div>
            <div className="text-right ml-2 tabular-nums">
              <div className="font-bold text-sm text-stone-600">{item.total}</div>
              {item.bonus > 0 && <div className="text-[9px] text-stone-500">{item.base}+{item.bonus}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


export function UpcomingTodayBanner({ liveGamesBySeries, actualWinners }) {
  const now = new Date();
  const allGames = [];
  for (const [sid, games] of Object.entries(liveGamesBySeries || {})) {
    if (actualWinners?.[sid]) continue; // Skip clinched series
    for (const g of games || []) {
      if (g.gameStatus !== 1) continue; // Only upcoming games
      if (!g.gameDateTimeUTC) continue;
      if (g.gameStatusText === "TBD") continue;
      const d = new Date(g.gameDateTimeUTC);
      const sameDay = d.getFullYear() === now.getFullYear() &&
                      d.getMonth() === now.getMonth() &&
                      d.getDate() === now.getDate();
      if (!sameDay || d.getTime() < now.getTime() - 30 * 60 * 1000) continue;
      allGames.push({ ...g, seriesId: sid, tipTime: d });
    }
  }

  if (allGames.length === 0) return null;

  allGames.sort((a, b) => a.tipTime.getTime() - b.tipTime.getTime());

  return (
    <div className="mb-5 p-3 bg-white border border-stone-300">
      <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-2">Today's Upcoming Games</div>
      <div className="space-y-1">
        {allGames.map((g) => {
          const homeOwner = TEAMS[g.home.tri]?.owner;
          const awayOwner = TEAMS[g.away.tri]?.owner;
          const timeStr = g.tipTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          const tv = (g.broadcasters || []).join(", ");
          return (
            <div key={g.gameId} className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="tabular-nums text-[10px] text-stone-500 w-14 shrink-0">{timeStr}</span>
                <span className={`font-semibold tabular-nums ${ownerColor(awayOwner)}`}>{g.away.tri}</span>
                <span className="text-stone-400">@</span>
                <span className={`font-semibold tabular-nums ${ownerColor(homeOwner)}`}>{g.home.tri}</span>
              </div>
              {tv && (
                <span className="text-[9px] uppercase tracking-wider text-stone-500 shrink-0">{tv}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
