// Compact momentum strip for a table-backed module: total volume, what's been
// added recently, and when the module last moved. Gives operators a felt sense
// that the module is compounding rather than just a static list.
function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = Date.now() - then;
  const day = 86_400_000;
  if (diff < 0) return "just now";
  if (diff < 3_600_000) return "today";
  if (diff < day) return "today";
  const days = Math.floor(diff / day);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={`font-display text-lg font-semibold leading-none ${
          accent ? "text-gold-300" : "text-fg-primary"
        }`}
      >
        {value}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{label}</span>
    </div>
  );
}

export function ModuleStatBar({
  total,
  thisWeek,
  lastUpdated,
}: {
  total: number;
  thisWeek: number;
  lastUpdated: string | null;
}) {
  const updated = relativeTime(lastUpdated);
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-surface-1 px-4 py-3">
      <Stat value={String(total)} label={total === 1 ? "record" : "records"} />
      {thisWeek > 0 ? (
        <Stat value={`+${thisWeek}`} label="this week" accent />
      ) : (
        <Stat value="—" label="this week" />
      )}
      {updated ? (
        <div className="ml-auto flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-status-success" aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Updated {updated}
          </span>
        </div>
      ) : null}
    </div>
  );
}
