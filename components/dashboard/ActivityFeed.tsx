import Link from "next/link";
import { relTime, type ActivityItem, type ActivityKind } from "@/lib/dashboard/institutional";

// The unified live activity feed: one chronological stream merged across every
// system of record — capital events, deals, IC decisions, valuation marks,
// dispatched actions, e-signature envelopes, completed workflows, and resolved
// approvals. Each row carries a system glyph, a headline, an optional detail,
// and a relative timestamp, and links to the originating record. Server-rendered.

const KIND_META: Record<ActivityKind, { glyph: string; ring: string }> = {
  capital: { glyph: "$", ring: "border-gold-500/40 bg-gold-500/10 text-gold-300" },
  deal: { glyph: "◆", ring: "border-neural-500/40 bg-neural-500/10 text-neural-300" },
  ic: { glyph: "⚖", ring: "border-gold-500/40 bg-gold-500/10 text-gold-300" },
  valuation: { glyph: "▲", ring: "border-neural-500/40 bg-neural-500/10 text-neural-300" },
  dispatch: { glyph: "→", ring: "border-line bg-surface-2 text-fg-secondary" },
  envelope: { glyph: "✎", ring: "border-line bg-surface-2 text-fg-secondary" },
  task: { glyph: "✓", ring: "border-status-success/40 bg-status-success/10 text-status-success" },
  approval: { glyph: "⛨", ring: "border-gold-500/40 bg-gold-500/10 text-gold-300" },
};

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No activity recorded yet. As deals move, capital is called, documents are
        signed, and workflows complete, every event streams here in real time.
      </p>
    );
  }

  return (
    <div className="fx-card overflow-hidden">
      <ol className="relative flex flex-col">
        {items.map((item, i) => {
          const meta = KIND_META[item.kind];
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className={`group flex items-start gap-3 px-4 py-3 transition hover:bg-surface-2 ${
                  i > 0 ? "border-t border-line/60" : ""
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] leading-none ${meta.ring}`}
                >
                  {meta.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg-primary group-hover:text-white">
                    {item.title}
                  </span>
                  {item.detail ? (
                    <span className="block truncate text-[11px] text-fg-muted">{item.detail}</span>
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-fg-muted/80">
                  {relTime(item.at)}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
