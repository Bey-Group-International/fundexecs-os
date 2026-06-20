// components/agenda/AgendaBoard.tsx — the deadlines board.
//
// Presentational server component (no "use client", no hooks). Renders the
// agenda buckets newest-urgency-first: each non-empty section gets a
// mono-uppercase label + count, then one row per obligation — a status dot, the
// title as a deep link, a kind chip, and a right-aligned relative-due label.
// Overdue rows carry a subtle danger tint.
import Link from "next/link";
import {
  relativeDue,
  type Agenda,
  type AgendaItem,
  type AgendaKind,
} from "@/lib/agenda";

const KIND_LABEL: Record<AgendaKind, string> = {
  diligence: "Diligence",
  capital: "Capital",
  deal: "Deal",
};

/** Dot tone: red for overdue/critical, amber for soon/high, gold otherwise. */
function dotClass(item: AgendaItem, overdue: boolean): string {
  if (overdue || item.severity === "critical") return "bg-status-danger";
  if (item.severity === "high") return "bg-status-warning";
  return "bg-gold-400";
}

function ItemRow({ item, overdue }: { item: AgendaItem; overdue: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border p-4 ${
        overdue
          ? "border-status-danger/30 bg-status-danger/10"
          : "border-line bg-surface-1"
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${dotClass(item, overdue)}`}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <Link
          href={item.href}
          className="truncate text-sm font-medium text-fg-primary transition hover:text-gold-300"
        >
          {item.title}
        </Link>
        <span className="shrink-0 rounded-full border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
          {KIND_LABEL[item.kind]}
        </span>
        {item.meta ? (
          <span className="truncate text-xs text-fg-muted">{item.meta}</span>
        ) : null}
      </div>
      <span
        className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${
          overdue ? "text-status-danger" : "text-fg-muted"
        }`}
      >
        {relativeDue(item.when)}
      </span>
    </div>
  );
}

export function AgendaBoard({ agenda }: { agenda: Agenda }) {
  if (agenda.total === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
        Nothing scheduled — you&rsquo;re clear.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {agenda.buckets.map((bucket) => {
        const overdue = bucket.key === "overdue";
        return (
          <section key={bucket.key}>
            <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
              <span className={overdue ? "text-status-danger" : undefined}>
                {bucket.label}
              </span>
              <span className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 text-[9px] tracking-wider text-fg-muted">
                {bucket.items.length}
              </span>
            </h2>
            <div className="flex flex-col gap-2">
              {bucket.items.map((item) => (
                <ItemRow key={item.id} item={item} overdue={overdue} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
