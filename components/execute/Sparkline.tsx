// Tiny value-over-time chart — pure SVG, renders server-side with no client JS
// and no charting dependency. Tone follows the trend (up emerald, down danger).
export function Sparkline({
  values,
  width = 120,
  height = 28,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length === 0) return <span className="font-mono text-[11px] text-fg-muted">—</span>;

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const n = values.length;

  // Single point → a flat midline; otherwise a polyline across the width.
  const x = (i: number) => pad + (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => pad + h - ((v - min) / span) * h;

  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = n === 1 ? `${pad},${(pad + h / 2).toFixed(1)} ${(width - pad)},${(pad + h / 2).toFixed(1)}` : pts.join(" ");

  const up = values[n - 1] >= values[0];
  const stroke = n === 1 ? "text-fg-muted" : up ? "text-emerald-400" : "text-status-danger";
  const lastX = x(n - 1);
  const lastY = n === 1 ? pad + h / 2 : y(values[n - 1]);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className ?? "h-7 w-[120px]"} preserveAspectRatio="none" aria-hidden>
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={stroke}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r="1.8" className={stroke} fill="currentColor" />
    </svg>
  );
}
