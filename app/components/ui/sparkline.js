// A small line-and-area chart of a series (a career's VA season by season).
// `highlight` marks one point (the best season). Purely presentational.
export function Sparkline({ values, width = 72, height = 22, color = "#1c1917", highlight = null, className = "" }) {
  const v = (values || []).filter((x) => Number.isFinite(x));
  if (v.length < 2) return <svg width={width} height={height} className={className} aria-hidden />;
  const min = Math.min(0, ...v), max = Math.max(...v, 1e-9);
  const x = (i) => (i / (v.length - 1)) * (width - 4) + 2;
  const y = (n) => height - 2 - ((n - min) / (max - min || 1)) * (height - 4);
  const line = v.map((n, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(n).toFixed(1)}`).join("");
  const area = `${line}L${x(v.length - 1).toFixed(1)},${y(min).toFixed(1)}L${x(0).toFixed(1)},${y(min).toFixed(1)}Z`;
  const hi = highlight != null && highlight >= 0 && highlight < v.length ? highlight : null;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <path d={area} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {hi != null && <circle cx={x(hi)} cy={y(v[hi])} r="2.4" fill={color} stroke="#fff" strokeWidth="1" />}
    </svg>
  );
}
