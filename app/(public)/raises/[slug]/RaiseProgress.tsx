'use client';

export function RaiseProgress({
  pct,
  committed,
  target
}: {
  pct: number;
  committed: number;
  target: number;
}) {
  return (
    <div>
      <div className="flex justify-between text-[11.5px] text-[#7a899e] mb-1.5">
        <span>{pct}% filled</span>
        <span>${formatAmount(Math.max(0, target - committed))} remaining</span>
      </div>
      <div className="h-2 w-full rounded-full bg-white/[0.07] overflow-hidden">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#3B74F0,#22d3ee)] transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
