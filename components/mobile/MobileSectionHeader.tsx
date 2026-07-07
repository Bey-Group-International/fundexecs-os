import Link from "next/link";

// Standardized section heading for the mobile command center — a short gold
// tick before a mono-cased label, with an optional "See all" affordance.
export function MobileSectionHeader({
  title,
  count,
  href,
  action = "See all",
}: {
  title: string;
  count?: number;
  href?: string;
  action?: string;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3 px-0.5">
      <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
        <span aria-hidden className="h-3 w-0.5 rounded-full bg-gold-500/70" />
        {title}
        {count != null && count > 0 && (
          <span className="rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-semibold text-fg-secondary">
            {count}
          </span>
        )}
      </h2>
      {href && (
        <Link href={href} className="fx-tap text-[12px] font-medium text-gold-400 transition active:opacity-70">
          {action} ›
        </Link>
      )}
    </div>
  );
}
