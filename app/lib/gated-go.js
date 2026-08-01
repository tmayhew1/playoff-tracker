"use client";

import { useCallback, useEffect, useRef, useState } from "react";


// Two-step "Go →" confirmation, shared by every control that navigates the
// page out from under the reader (the compare panel's compared-player chip,
// the by-season trend bars). The first tap ARMS a target — the caller renders
// a "Go →" affordance for it — and only a second, deliberate tap on that
// affordance navigates. A tap anywhere else disarms without doing whatever it
// landed on.
//
// Two details the naive version gets wrong, both learned from the compare chip:
//   * The disarming listener attaches in an effect (after the arming tap has
//     already fired) and runs in the CAPTURE phase at the document level, above
//     React's root listener — so the stray tap is swallowed entirely (it can't
//     also open another card or filter a team) and the arming tap itself never
//     immediately disarms.
//   * On touch devices the single tap that arms can synthesize a delayed
//     "ghost" click at the same screen position — which now belongs to the
//     "Go →" button — and would jump instantly. Confirms inside the cooldown
//     window are ignored, so only a real second tap navigates.
//
// Usage:
//   const go = useGatedGo();
//   go.isArmed(key) ? <button ref={go.goRef} onClick={() => go.confirm(fn)}>Go →</button>
//                   : <button onClick={() => go.arm(key)}>…</button>
// `key` is any value that identifies the armed target (a season string, `true`
// when there's only ever one). goRef marks the element(s) an armed tap is
// allowed through to; attach it to the "Go →" button (or a wrapper around it).
export function useGatedGo(cooldownMs = 350) {
  const [armed, setArmed] = useState(null); // null = nothing armed
  const goRef = useRef(null);
  const armedAtRef = useRef(0);

  const arm = useCallback((key = true) => {
    armedAtRef.current = Date.now();
    setArmed(key ?? true);
  }, []);
  const disarm = useCallback(() => setArmed(null), []);
  const isArmed = useCallback((key = true) => armed !== null && armed === key, [armed]);
  const confirm = useCallback((fn) => {
    if (Date.now() - armedAtRef.current < cooldownMs) return; // echo of the arming tap
    setArmed(null);
    fn?.();
  }, [cooldownMs]);

  useEffect(() => {
    if (armed === null) return;
    const onClickCapture = (e) => {
      if (goRef.current && goRef.current.contains(e.target)) return; // let "Go →" through
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setArmed(null);
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [armed]);

  return { armed, isArmed, arm, disarm, confirm, goRef };
}
