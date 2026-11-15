"use client";

import React, { useEffect, useRef, useState } from "react";

// Stacked pinned rows. While the reader scrolls down through an open drill-in,
// the rows that say what it is — the player's board row, the open category
// row, the card's own rank row — stay pinned under the board's pinned header,
// one beneath the other, each until the block it heads has scrolled away
// (whose end pushes it off).
//
// Like the pinned headers (leaderboard.js), each is a position:fixed mirror
// mounted on demand rather than position:sticky, which leaves a ghost bar on
// iOS Safari. One scroll listener measures every registered row in layer
// order off the in-flow elements, so a row's resting place never depends on
// whether the mirror above it has been committed yet.

const entries = new Set();
let raf = 0;
let ro = null;

const same = (a, b) => a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.clip === b.clip);

function tick() {
  raf = 0;
  const header = document.querySelector("[data-pinned-header]");
  let offset = header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 0;
  const layers = [...new Set([...entries].map((e) => e.layer))].sort((a, b) => a - b);
  for (const layer of layers) {
    let next = offset;
    for (const e of entries) {
      if (e.layer !== layer) continue;
      const row = e.rowRef.current, region = e.regionRef.current;
      let pin = null;
      if (row && region) {
        const r = row.getBoundingClientRect();
        const end = region.getBoundingClientRect().bottom;
        if (r.height > 0 && r.top < offset && end > offset) {
          const top = Math.min(offset, end - r.height);
          pin = { top, left: Math.round(r.left), width: Math.round(r.width), clip: offset };
          next = Math.max(next, top + r.height);
        }
      }
      e.set((prev) => (same(prev, pin) ? prev : pin));
    }
    offset = next;
  }
}

// Re-measure on the next frame. Exported for the pinned headers, which mount
// and unmount on their own schedule and change where the stack starts.
export function repin() {
  if (!raf && typeof window !== "undefined") raf = requestAnimationFrame(tick);
}

function register(entry) {
  if (entries.size === 0) {
    window.addEventListener("scroll", repin, { passive: true });
    window.addEventListener("resize", repin, { passive: true });
    // Opening a row or a card moves everything below it without a scroll.
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(repin);
      ro.observe(document.body);
    }
  }
  entries.add(entry);
  repin();
  return () => {
    entries.delete(entry);
    if (entries.size === 0) {
      window.removeEventListener("scroll", repin);
      window.removeEventListener("resize", repin);
      if (ro) { ro.disconnect(); ro = null; }
    }
  };
}

// `rowRef` goes on the in-flow row, `regionRef` on the element whose bottom
// edge ends the pin. `pin` is the mirror's geometry, or null when it's down.
export function usePin(layer, active = true) {
  const rowRef = useRef(null);
  const regionRef = useRef(null);
  const [pin, setPin] = useState(null);
  useEffect(() => {
    if (!active) { setPin(null); return undefined; }
    return register({ layer, rowRef, regionRef, set: setPin });
  }, [layer, active]);
  // Re-points, toggles and re-sorts move the row without a scroll event.
  useEffect(() => { if (active) repin(); });
  return { rowRef, regionRef, pin: active ? pin : null };
}

// The mirror itself. Clipped at the bottom edge of whatever is pinned above,
// so the end of its block slides it out underneath rather than over it.
export function Pinned({ pin, layer, children }) {
  if (!pin) return null;
  return (
    <div
      className="fixed bg-white shadow-sm"
      style={{
        top: pin.top,
        left: pin.left,
        width: pin.width,
        zIndex: 29 - layer,
        clipPath: pin.top < pin.clip ? `inset(${pin.clip - pin.top}px 0 0 0)` : undefined,
      }}
    >
      {children}
    </div>
  );
}

// A row that pins for as long as the block under it (`children`) is on screen.
export function PinnedRow({ layer, active, row, children }) {
  const { rowRef, regionRef, pin } = usePin(layer, !!active);
  if (!active) return <>{row}{children}</>;
  return (
    <>
      <div ref={rowRef}>{row}</div>
      <Pinned pin={pin} layer={layer}>{row}</Pinned>
      <div ref={regionRef}>{children}</div>
    </>
  );
}
