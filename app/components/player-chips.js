"use client";

import { splitName, teamColor, withAlpha } from "../lib/format";

// The team badge and two-line name the Look Ahead and MIP tables share.

export function TeamChip({ team, onClick, active = false }) {
  if (!team) {
    return <span className="w-8 sm:w-10 text-[11px] font-bold px-1 py-0.5 text-center border border-stone-200 text-stone-400 shrink-0">FA</span>;
  }
  const tc = teamColor(team);
  const style = { backgroundColor: withAlpha(tc, active ? 0.3 : 0.14), color: tc, borderColor: withAlpha(tc, active ? 0.8 : 0.4) };
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      style={style}
      className="w-8 sm:w-10 text-[11px] font-bold px-1 py-0.5 text-center border shrink-0 hover:brightness-95"
      aria-label={onClick ? `Filter by ${team}` : undefined}
    >{team}</Tag>
  );
}

export function Name({ name }) {
  const { first, last } = splitName(name);
  return (
    <span className="min-w-0 flex flex-col sm:flex-row sm:items-baseline sm:gap-1 leading-[1.1]">
      {first && <span className="truncate text-[10px] text-stone-500 sm:text-[12px] sm:shrink-0">{first}</span>}
      <span className="truncate text-[12px]">{last}</span>
    </span>
  );
}
