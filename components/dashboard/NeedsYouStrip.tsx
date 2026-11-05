import Link from "next/link";

export interface NeedsYouProps {
  /** Approvals waiting on a decision. */
  approvals: number;
  /** True when `approvals` is a floor (the page only loads the newest few). */
  approvalsCapped?: boolean;
  /** Deals with no activity for two weeks or more. */
  staleDeals: { count: number; oldestDays: number };
  /** The next foundation step, when there is one. */
  readinessNext: { label: string; href: string } | null;
}

interface Item {
  key: string;
  href: string;
  label: string;
  detail: string;
  tone: "urgent" | "normal";
}

/**
 * What needs the operator right now, in one row, each item a link straight to
 * its list. Everything here is already loaded by the dashboard page, so it adds
 * no queries. When nothing is waiting it says so, rather than going blank.
 */
export function NeedsYouStrip({ approvals, approvalsCapped, staleDeals, readinessNext }: NeedsYouProps) {
  const items: Item[] = [];

  if (approvals > 0) {
    items.push({
      key: "approvals",
      href: "/grid/review",
      label: `${approvals}${approvalsCapped ? "+" : ""} approval${approvals === 1 && !approvalsCapped ? "" : "s"} waiting`,
      detail: "Review",
      tone: "urgent",
    });
  }
  if (staleDeals.count > 0) {
    items.push({
      key: "stale",
      href: "/source/deal_pipeline",
      label: `${staleDeals.count} deal${staleDeals.count === 1 ? "" : "s"} gone quiet`,
      detail: `Oldest ${staleDeals.oldestDays} days`,
      tone: "normal",
    });
  }
  if (readinessNext) {
    items.push({
      key: "readiness",
      href: readinessNext.href,
      label: readinessNext.label,
      detail: "Next step",
      tone: "normal",
    });
  }

  return (
    <section aria-label="Needs you" data-testid="needs-you" className="mb-6">
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">Needs you</h2>
      {items.length === 0 ? (
        <p className="fx-card flex items-center gap-2 px-4 py-3 text-sm text-fg-secondary">
          <span aria-hidden className="text-status-success">✓</span>
          Nothing needs you right now.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <li key={it.key}>
              <Link
                href={it.href}
                className={`fx-card fx-card-hover flex min-h-14 items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${
                  it.tone === "urgent" ? "border-gold-500/40" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg-primary">{it.label}</span>
                  <span className="block truncate text-xs text-fg-muted">{it.detail}</span>
                </span>
                <span aria-hidden className="shrink-0 text-gold-300">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
