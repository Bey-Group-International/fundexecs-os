// Stat strip for the top of a marketplace surface — deals live, countries,
// aggregate value, etc. Native fx styling; no external logos/assets. Renders
// nothing when there are no stats to show.
export type TrustStat = { label: string; value: string; accent?: string };

export function TrustBar({ stats, note }: { stats: TrustStat[]; note?: string }) {
  const shown = stats.filter((s) => s.value && s.value !== "—");
  if (shown.length === 0) return null;
  return (
    <div className="mb-6 animate-fade-up">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {shown.map((s) => (
          <div key={s.label} className="fx-stat">
            <div
              className={`font-display text-2xl font-semibold tracking-tight ${
                s.accent ?? "text-fg-primary"
              }`}
            >
              {s.value}
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
              {s.label}
            </div>
          </div>
        ))}
      </div>
      {note ? <p className="mt-2 text-[11px] leading-snug text-fg-muted">{note}</p> : null}
    </div>
  );
}
