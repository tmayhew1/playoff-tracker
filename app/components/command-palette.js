"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchBakedJson } from "../lib/fetch-cache";
import { normalizeName, teamColor } from "../lib/format";
import { PlayerAvatar } from "./ui/avatar";
import { Sparkline } from "./ui/sparkline";

// Search every player in the app from one box: a sheet over the page, opened
// by the search bar at the top of Explore, "/" or ⌘K. Results carry the
// player's avatar, teams, career VA and a sparkline of it season by season;
// arrows and Enter pick one. Empty, it offers recent picks and the top
// careers. The index (/api/player-index) loads the first time it opens.

const RECENT_KEY = "cs:recent-players";
const readRecent = () => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
};
const saveRecent = (slug) => {
  try {
    const next = [slug, ...readRecent().filter((s) => s !== slug)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // private mode: no memory of recent picks, nothing else lost
  }
};

export const loadPlayerIndex = () => fetchBakedJson("/api/player-index").then((d) => d.players || []);

const fmt = (n) => (n >= 0 ? "+" : "−") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const yearsOf = (p) => (p.f && p.l ? (p.f === p.l ? p.f : `${p.f.slice(0, 4)}–${String(Number(p.l.slice(0, 4)) + 1).slice(2)}`) : "");

// Rank by how the name matches — a surname or first name that starts with the
// query beats a match mid-word — then by career VA.
function search(index, q) {
  const nq = normalizeName(q);
  if (nq.length < 2) return [];
  const out = [];
  for (const p of index) {
    const n = p._n || (p._n = normalizeName(p.n));
    const at = n.indexOf(nq);
    if (at < 0) continue;
    const wordStart = at === 0 || n[at - 1] === " " || n[at - 1] === "-";
    out.push({ p, score: (at === 0 ? 3 : wordStart ? 2 : 1) * 1e6 + p.c });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.p);
}

export function CommandPalette({ open, onClose, onPick }) {
  const [index, setIndex] = useState(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [recent, setRecent] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQ(""); setSel(0); setRecent(readRecent());
    loadPlayerIndex().then(setIndex).catch(() => setError(true));
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { clearTimeout(t); document.body.style.overflow = prev; };
  }, [open]);

  const bySlug = useMemo(() => new Map((index || []).map((p) => [p.s, p])), [index]);
  const results = useMemo(() => (index ? search(index, q) : []), [index, q]);
  const suggestions = useMemo(() => {
    if (!index || q.trim().length >= 2) return null;
    const rec = recent.map((s) => bySlug.get(s)).filter(Boolean);
    const top = [...index].sort((a, b) => b.c - a.c).slice(0, 6);
    return { rec, top };
  }, [index, q, recent, bySlug]);
  const list = results.length ? results : suggestions ? [...suggestions.rec, ...suggestions.top] : [];

  if (!open || typeof document === "undefined") return null;

  const pick = (p) => {
    saveRecent(p.s);
    onPick({ slug: p.s, name: p.n });
    onClose();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(list.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && list[sel]) { e.preventDefault(); pick(list[sel]); }
  };

  // A plain function, not a component: defined in render, a component would
  // remount every row on each hover and could swallow the click.
  const row = (p, i, key) => {
    const best = p.v.indexOf(Math.max(...p.v));
    const tc = teamColor(p.t[0]);
    return (
      <button
        key={key}
        type="button"
        role="option"
        aria-selected={i === sel}
        onMouseEnter={() => setSel(i)}
        onClick={() => pick(p)}
        className={`cs-press w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left ${i === sel ? "bg-stone-100" : ""}`}
      >
        <PlayerAvatar name={p.n} team={p.t[0]} size={36} />
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-semibold text-stone-900 truncate">{p.n}</span>
          <span className="block text-[11px] text-stone-500 truncate">
            {p.t.slice(0, 4).map((t, ti) => (
              <span key={t}>{ti > 0 && " · "}<span className="font-semibold" style={{ color: teamColor(t) }}>{t}</span></span>
            ))}
            {p.t.length > 4 ? ` +${p.t.length - 4}` : ""} · {yearsOf(p)}
          </span>
        </span>
        <Sparkline values={p.v} highlight={best} color={tc} width={56} height={22} className="cs-wide-only shrink-0" />
        <span className="text-right shrink-0 w-[4.5rem]">
          <span className="block text-[13px] font-bold tabular-nums text-stone-900">{fmt(p.c)}</span>
          <span className="block text-[10px] text-stone-400">career VA</span>
        </span>
      </button>
    );
  };

  // Portaled to <body>, clear of any stacking context on the page.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search players">
      <div className="cs-fade absolute inset-0 bg-stone-900/40 backdrop-blur-[3px]" onClick={onClose} />
      <div className="cs-sheet relative w-full max-w-lg cs-card overflow-hidden" onKeyDown={onKey}>
        <div className="flex items-center gap-2 px-4 border-b border-stone-100">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#78716c" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            placeholder="Search 3,700+ players since 1980…"
            aria-label="Player name"
            className="flex-1 py-4 text-[16px] bg-transparent outline-none text-stone-900 placeholder:text-stone-400"
          />
          <button type="button" onClick={onClose} className="text-[11px] font-semibold text-stone-400 border border-stone-200 rounded-md px-1.5 py-0.5">Esc</button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2" role="listbox">
          {error && <div className="p-6 text-center text-[12px] text-red-600">Couldn’t load the player list.</div>}
          {!index && !error && [0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <span className="cs-skeleton w-9 h-9 rounded-full" />
              <span className="flex-1"><span className="block cs-skeleton h-3 w-2/5 mb-1.5" /><span className="block cs-skeleton h-2.5 w-1/4" /></span>
            </div>
          ))}
          {index && q.trim().length >= 2 && !results.length && (
            <div className="p-6 text-center text-[12px] text-stone-500">No player matches “{q.trim()}”.</div>
          )}
          {results.length > 0 && results.map((p, i) => row(p, i, p.s))}
          {!results.length && suggestions && (
            <>
              {suggestions.rec.length > 0 && <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-stone-400">Recent</div>}
              {suggestions.rec.map((p, i) => row(p, i, `r-${p.s}`))}
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-stone-400">Top careers</div>
              {suggestions.top.map((p, i) => row(p, suggestions.rec.length + i, `t-${p.s}`))}
            </>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-3 px-4 py-2 border-t border-stone-100 text-[11px] text-stone-400">
          <span><kbd className="font-sans">↑↓</kbd> move</span><span><kbd className="font-sans">↵</kbd> open</span><span><kbd className="font-sans">esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
