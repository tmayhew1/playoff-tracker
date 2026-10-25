// A page's method notes, folded away under one line so the data comes first.
export function HowItWorks({ children, className = "mb-2", label = "How this works" }) {
  return (
    <details className={`group text-[12px] text-stone-500 ${className}`}>
      <summary className="cursor-pointer list-none select-none text-stone-600 hover:text-stone-900 [&::-webkit-details-marker]:hidden">
        <span className="inline-block w-3 text-stone-400 group-open:rotate-90 transition-transform">▸</span>{label}
      </summary>
      <div className="mt-1 pl-3 leading-snug">{children}</div>
    </details>
  );
}
