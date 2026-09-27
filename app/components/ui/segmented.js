"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Layout effect in the browser (measure before paint, so the thumb never
// flashes in the wrong place); a plain effect on the server, where React
// warns about layout effects.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// A segmented control: a pill track with a white thumb that slides to the
// chosen option. `options` is [{ value, label }]. The thumb is measured from
// the chosen button, so labels of any length line up.
export function Segmented({ options, value, onChange, size = "md", className = "", ariaLabel }) {
  const refs = useRef({});
  const [thumb, setThumb] = useState(null);
  useIsoLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[value];
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [value, options.length]);
  const pad = size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-[12px]";
  return (
    <div role="radiogroup" aria-label={ariaLabel}
      className={`relative inline-flex p-0.5 rounded-full bg-stone-200/70 ${className}`}>
      {thumb && (
        <span
          aria-hidden
          className="absolute top-0.5 bottom-0.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
          style={{ left: thumb.left, width: thumb.width }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[o.value] = el; }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`relative z-10 flex-1 whitespace-nowrap rounded-full font-semibold transition-colors ${pad} ${o.value === value ? "text-stone-900" : "text-stone-500 hover:text-stone-800"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
