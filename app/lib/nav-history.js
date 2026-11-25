"use client";

// Browser history for jumps.
//
// The address bar is rewritten in place (replaceState) as a view changes, so
// scrolling, opening rows and flipping scope never stack up history. A JUMP is
// different — a control that moves the reader somewhere else (a header-armed
// name into By Player, an award box into Awards, Legacy's Go into By Season):
// that should be one step the browser's Back can undo.
//
// So a jump pushes a new entry holding the URL it left from, and the tracker's
// replaceState writes then turn that entry into the landing as it settles. The
// entry left behind still names the source, and carries where it was
// scrolled to.
//
// Every entry the app writes carries `vat: { k, y }` in history.state beside
// Next.js's own keys (the patched pushState/replaceState copy those across):
//   k  a key for the entry, so the tracker can tell which one Back returned to
//      and whether the view it showed is still mounted (see tracker.js)
//   y  the page's scroll position, kept current while the entry is showing

const STATE_KEY = "vat";

const newKey = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const vatOf = (state) => (state && typeof state === "object" && state[STATE_KEY]) || null;

// Next.js's own keys in history.state have to survive every write: on Back,
// an entry without its `__NA` makes Next reload the page. Once Next has
// patched pushState/replaceState (an effect in its router, which runs after
// the page's own mount effects) it copies them across itself, and only does
// its other job — keeping its router's idea of the URL in step — when they're
// missing from what it's given. Before that, the native function would drop
// them, so they're carried over by hand.
const NEXT_KEYS = ["__NA", "__PRIVATE_NEXTJS_INTERNALS_TREE"];
const isNative = (fn) => /\[native code\]/.test(Function.prototype.toString.call(fn));
function historyData(own) {
  const cur = window.history.state || {};
  const data = { ...cur, ...own };
  if (!isNative(window.history.replaceState)) for (const k of NEXT_KEYS) delete data[k];
  return data;
}

const write = (vat, url = window.location.href) => {
  try {
    window.history.replaceState(historyData({ [STATE_KEY]: { ...vatOf(window.history.state), ...vat } }), "", url);
  } catch {
    // sandboxed frames can refuse history writes; Back then just isn't offered
  }
};

// Rewrite the current entry's URL in place, keeping its key and scroll.
export function replaceUrl(url) {
  write({}, url);
}

// The key of the entry the page is showing. Kept here as well as in
// history.state because a popstate handler runs after the browser has already
// moved to the new entry, and needs to know which one it left.
let shown = null;
export const shownEntryKey = () => shown;

// The current entry's key, giving it one if it has none yet (the page's first
// entry, or one written before this existed).
export function currentEntryKey() {
  if (typeof window === "undefined") return null;
  let k = vatOf(window.history.state)?.k;
  if (!k) {
    k = newKey();
    write({ k });
  }
  shown = k;
  return k;
}

export const entryFromState = (state) => vatOf(state);

// Record where the current entry is scrolled to.
export function saveScroll(y = window.scrollY) {
  write({ y: Math.round(y) });
}

// Start a jump: the current entry keeps the source (and its scroll position),
// and a new entry is pushed for the landing. Returns the key of the entry left
// behind, or null where history can't be written.
export function pushJump() {
  if (typeof window === "undefined") return null;
  const from = currentEntryKey();
  saveScroll();
  const k = newKey();
  try {
    window.history.pushState(historyData({ [STATE_KEY]: { k, y: 0 } }), "", window.location.href);
  } catch {
    return null;
  }
  shown = k;
  return from;
}

// Put the page back at `y` once the restored view is tall enough to hold it.
// A view that comes back from its URL loads its data again, so the page grows
// over a few frames; and one that reopens a row may scroll that row into view
// itself. The position is held for a moment after it is first reached, and
// given up the moment the reader scrolls or taps.
export function restoreScroll(y, { holdMs = 900, giveUpMs = 4000 } = {}) {
  if (typeof window === "undefined") return () => {};
  const target = Math.max(0, Math.round(y || 0));
  const start = performance.now();
  let reachedAt = null;
  let raf = 0;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    for (const ev of INPUT_EVENTS) window.removeEventListener(ev, stop, true);
  };
  for (const ev of INPUT_EVENTS) window.addEventListener(ev, stop, { capture: true, passive: true });
  const tick = () => {
    if (done) return;
    const now = performance.now();
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max >= target - 1) {
      if (Math.abs(window.scrollY - target) > 1) window.scrollTo({ top: target, behavior: "instant" });
      reachedAt ??= now;
    }
    if ((reachedAt !== null && now - reachedAt > holdMs) || now - start > giveUpMs) {
      // Out of time before the page grew tall enough: as close as it gets.
      if (reachedAt === null) window.scrollTo({ top: Math.min(target, Math.max(0, max)), behavior: "instant" });
      stop();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
  return stop;
}

const INPUT_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"];
