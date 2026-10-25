// The app's one switch: a row of options, the picked one filled in black.
// `options` is [[value, label], …]. `size` "sm" is for a card's header row,
// where the switch shares a line with a title.
export function Seg({ value, onChange, options, size = "md", className = "", label }) {
  const pad = size === "sm" ? "px-1.5 py-0.5 text-[13px]" : "px-2.5 py-1 text-[14px]";
  return (
    <div role="group" aria-label={label} className={`inline-flex shrink-0 border border-stone-300 bg-white ${className}`}>
      {options.map(([v, l], i) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`${pad} leading-tight whitespace-nowrap ${i ? "border-l border-stone-300" : ""} ${value === v ? "bg-stone-900 text-white font-bold" : "text-stone-600 hover:bg-stone-50"}`}
        >{l}</button>
      ))}
    </div>
  );
}
